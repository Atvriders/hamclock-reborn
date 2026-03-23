import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Rectangle,
  Marker,
  Popup,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { DXSpot, SatellitePosition } from '../../types';
import {
  solarElevation,
  getGrayLinePolylines,
  getMaidenheadGrid,
} from '../../utils/solar';
import { latLngToGrid } from '../../utils/hamradio';

// ── Fix Leaflet default icon paths (Vite/Webpack strip them) ──────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Map styles ───────────────────────────────────────────────────
type MapStyle = 'dark' | 'satellite' | 'terrain' | 'light';

const MAP_TILE_URLS: Record<MapStyle, { url: string; subdomains?: string; maxZoom: number; attribution?: string }> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
    subdomains: 'abcd',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 18,
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 17,
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    subdomains: 'abcd',
    maxZoom: 19,
  },
};

// ── Props ─────────────────────────────────────────────────────────
interface WorldMapProps {
  dxSpots: DXSpot[];
  satellites: SatellitePosition[];
  userLat?: number;
  userLng?: number;
  dxLocation?: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
  selectedBand?: string | null;
}

// ── Band → Frequency mapping ──────────────────────────────────────
const BAND_FREQ_MAP: Record<string, number> = {
  '80m': 3.5,
  '40m': 7.0,
  '30m': 10.1,
  '20m': 14.0,
  '17m': 18.0,
  '15m': 21.0,
  '12m': 24.9,
  '10m': 28.0,
  '6m': 50.0,
};

const BAND_COLORS: Record<string, string> = {
  '80m': '#ff4444',
  '40m': '#ff8800',
  '30m': '#ffcc00',
  '20m': '#88ff00',
  '17m': '#00ff88',
  '15m': '#00ddff',
  '12m': '#0088ff',
  '10m': '#8844ff',
  '6m': '#ff44ff',
};

// ── Propagation heat map helpers ──────────────────────────────────

/** Haversine distance in km between two lat/lng points */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => d * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Midpoint of a great circle path */
function midpoint(lat1: number, lng1: number, lat2: number, lng2: number): [number, number] {
  const toRad = (d: number) => d * Math.PI / 180;
  const toDeg = (r: number) => r * 180 / Math.PI;
  const phi1 = toRad(lat1), lam1 = toRad(lng1);
  const phi2 = toRad(lat2), lam2 = toRad(lng2);
  const Bx = Math.cos(phi2) * Math.cos(lam2 - lam1);
  const By = Math.cos(phi2) * Math.sin(lam2 - lam1);
  const phiM = Math.atan2(
    Math.sin(phi1) + Math.sin(phi2),
    Math.sqrt((Math.cos(phi1) + Bx) ** 2 + By ** 2)
  );
  const lamM = lam1 + Math.atan2(By, Math.cos(phi1) + Bx);
  return [toDeg(phiM), toDeg(lamM)];
}

/** Calculate propagation reliability (0-100) from QTH to a target cell */
function calcReliability(
  userLat: number, userLng: number,
  cellLat: number, cellLng: number,
  bandMhz: number, now: Date
): number {
  const distKm = haversineDistance(userLat, userLng, cellLat, cellLng);

  // Skip cells very close to QTH (ground wave, always works)
  if (distKm < 100) return 90;

  // Base reliability — derive from band and time
  // Higher bands need solar ionization (daytime), lower bands prefer night
  let reliability = 55; // baseline "fair"

  // Distance factor: optimal propagation range per band
  let optimalMin: number, optimalMax: number, maxRange: number;
  if (bandMhz <= 5) {        // 80m
    optimalMin = 200; optimalMax = 2000; maxRange = 5000;
  } else if (bandMhz <= 8) {  // 40m
    optimalMin = 500; optimalMax = 4000; maxRange = 8000;
  } else if (bandMhz <= 12) { // 30m
    optimalMin = 500; optimalMax = 5000; maxRange = 10000;
  } else if (bandMhz <= 16) { // 20m
    optimalMin = 1000; optimalMax = 8000; maxRange = 15000;
  } else if (bandMhz <= 19) { // 17m
    optimalMin = 1500; optimalMax = 10000; maxRange = 16000;
  } else if (bandMhz <= 22) { // 15m
    optimalMin = 2000; optimalMax = 12000; maxRange = 18000;
  } else if (bandMhz <= 26) { // 12m
    optimalMin = 2500; optimalMax = 13000; maxRange = 18000;
  } else if (bandMhz <= 30) { // 10m
    optimalMin = 2000; optimalMax = 15000; maxRange = 20000;
  } else {                     // 6m
    optimalMin = 1000; optimalMax = 3000; maxRange = 5000;
  }

  // Distance scoring
  let distFactor: number;
  if (distKm < optimalMin) {
    // Too close for skip — "dead zone"
    distFactor = distKm < 50 ? 0.9 : Math.max(0.05, distKm / optimalMin);
  } else if (distKm <= optimalMax) {
    // Sweet spot
    distFactor = 1.0;
  } else if (distKm <= maxRange) {
    // Beyond optimal but still reachable
    distFactor = Math.max(0, 1 - (distKm - optimalMax) / (maxRange - optimalMax));
  } else {
    distFactor = 0;
  }
  reliability *= (0.2 + 0.8 * distFactor);

  // Time of day factor — check midpoint of path
  const [midLat, midLng] = midpoint(userLat, userLng, cellLat, cellLng);
  const midElev = solarElevation(midLat, midLng, now);
  const isDay = midElev > 0;
  const isTwilight = midElev > -6 && midElev <= 0;

  if (bandMhz >= 14) {
    // Higher bands (20m and up) need daylight ionization
    if (isDay) {
      // Stronger with higher sun
      reliability *= (0.7 + 0.3 * Math.min(1, midElev / 45));
    } else if (isTwilight) {
      reliability *= 0.4;
    } else {
      reliability *= 0.1; // Almost dead at night
    }
    // 6m is especially solar-dependent
    if (bandMhz >= 50 && !isDay) {
      reliability *= 0.05;
    }
  } else {
    // Lower bands (40m, 80m) prefer night
    if (!isDay) {
      reliability *= 1.1; // Boost at night
    } else {
      // D-layer absorption during day kills low bands at distance
      const dayPenalty = bandMhz < 5 ? 0.25 : 0.5;
      reliability *= dayPenalty;
    }
  }

  // 30m is a transition band — moderate in both day and night
  if (bandMhz >= 10 && bandMhz < 12) {
    reliability *= 0.9; // slight penalty — it's a narrow band
  }

  return Math.max(0, Math.min(100, reliability));
}

/** Map reliability percentage to a semi-transparent color */
function reliabilityColor(pct: number): string {
  if (pct >= 80) return 'rgba(0, 200, 255, 0.35)';   // cyan — excellent
  if (pct >= 60) return 'rgba(0, 255, 100, 0.3)';     // green — good
  if (pct >= 40) return 'rgba(255, 255, 0, 0.25)';    // yellow — fair
  if (pct >= 20) return 'rgba(255, 165, 0, 0.25)';    // orange — marginal
  return 'rgba(255, 50, 50, 0.2)';                      // red — poor
}

/** Heat map cell data */
interface HeatCell {
  lat1: number; lng1: number;
  lat2: number; lng2: number;
  color: string;
}

// ── Sub-component: Propagation heat map ──────────────────────────
function PropagationHeatMap({
  userLat, userLng, bandMhz,
}: {
  userLat: number; userLng: number; bandMhz: number;
}) {
  const [cells, setCells] = useState<HeatCell[]>([]);

  useEffect(() => {
    const compute = () => {
      const now = new Date();
      const step = 10; // 10° grid
      const result: HeatCell[] = [];

      for (let lat = -90; lat < 90; lat += step) {
        for (let lng = -180; lng < 180; lng += step) {
          const cellCenterLat = lat + step / 2;
          const cellCenterLng = lng + step / 2;
          const rel = calcReliability(
            userLat, userLng,
            cellCenterLat, cellCenterLng,
            bandMhz, now
          );
          result.push({
            lat1: lat, lng1: lng,
            lat2: lat + step, lng2: lng + step,
            color: reliabilityColor(rel),
          });
        }
      }
      setCells(result);
    };

    compute();
    const id = setInterval(compute, 300_000); // refresh every 5 min
    return () => clearInterval(id);
  }, [userLat, userLng, bandMhz]);

  return (
    <>
      {cells.map((c, i) => (
        <Rectangle
          key={`prop-${i}`}
          bounds={[[c.lat1, c.lng1], [c.lat2, c.lng2]]}
          pathOptions={{
            fillColor: c.color,
            fillOpacity: 1,
            fill: true,
            stroke: false,
            interactive: false,
            color: c.color,
          }}
        />
      ))}
    </>
  );
}

// ── Layer visibility state ────────────────────────────────────────
interface LayerState {
  dayNight: boolean;
  grayLine: boolean;
  muf: boolean;
  gridSquares: boolean;
  prefixes: boolean;
}

const DEFAULT_LAYERS: LayerState = {
  dayNight: true,
  grayLine: false,
  muf: false,
  gridSquares: false,
  prefixes: true,
};

// ── Custom icons ──────────────────────────────────────────────────
const qthIcon = L.divIcon({
  className: 'qth-marker',
  html: `<div style="
    width:14px;height:14px;border-radius:50%;
    background:#00e5ff;border:2px solid #fff;
    box-shadow:0 0 8px #00e5ff, 0 0 16px rgba(0,229,255,0.4);
  "></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const dxIcon = L.divIcon({
  className: 'dx-marker',
  html: `<div style="
    width:10px;height:10px;border-radius:50%;
    background:#ff9100;border:1.5px solid #fff;
    box-shadow:0 0 6px rgba(255,145,0,0.6);
  "></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

const satIcon = L.divIcon({
  className: 'sat-marker',
  html: `<div style="
    width:8px;height:8px;transform:rotate(45deg);
    background:#76ff03;border:1px solid #fff;
    box-shadow:0 0 6px rgba(118,255,3,0.6);
  "></div>`,
  iconSize: [8, 8],
  iconAnchor: [4, 4],
});

// ── Sub-component: auto-update night overlay every 60 s ──────────
// Uses a grid of small Rectangles instead of a polygon to avoid
// Leaflet polygon winding/hole rendering bugs.
function NightOverlay({ showNight, showGray }: { showNight: boolean; showGray: boolean }) {
  const [cells, setCells] = useState<[number, number, number, number][]>([]);
  const [grayLines, setGrayLines] = useState(() => getGrayLinePolylines(new Date()));

  useEffect(() => {
    const update = () => {
      const now = new Date();

      if (showNight) {
        const nightCells: [number, number, number, number][] = [];
        const step = 4; // 4-degree grid
        for (let lat = -90; lat < 90; lat += step) {
          for (let lng = -180; lng < 180; lng += step) {
            const elev = solarElevation(lat + step / 2, lng + step / 2, now);
            if (elev < 0) {
              nightCells.push([lat, lng, lat + step, lng + step]);
            }
          }
        }
        setCells(nightCells);
      } else {
        setCells([]);
      }

      if (showGray) {
        setGrayLines(getGrayLinePolylines(now));
      }
    };

    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [showNight, showGray]);

  // Gray line style: thick semi-transparent amber lines for the terminator
  // and twilight boundaries, creating a visible dawn/dusk band effect
  const grayLineTerminatorStyle = {
    color: '#ffab00',
    weight: 3,
    opacity: 0.7,
    interactive: false,
  };
  const grayLineTwilightStyle = {
    color: '#ff8f00',
    weight: 2,
    opacity: 0.5,
    interactive: false,
    dashArray: '6 4',
  };

  return (
    <>
      {/* Night side — grid of small rectangles */}
      {cells.map(([lat1, lng1, lat2, lng2], i) => (
        <Rectangle
          key={`night-${i}`}
          bounds={[[lat1, lng1], [lat2, lng2]]}
          pathOptions={{
            fillColor: '#000820',
            fillOpacity: 0.45,
            stroke: false,
            interactive: false,
          }}
        />
      ))}

      {/* Gray line — terminator lines (elev = 0) */}
      {showGray && grayLines.terminatorSouth.length > 1 && (
        <Polyline
          positions={grayLines.terminatorSouth}
          pathOptions={grayLineTerminatorStyle}
        />
      )}
      {showGray && grayLines.terminatorNorth.length > 1 && (
        <Polyline
          positions={grayLines.terminatorNorth}
          pathOptions={grayLineTerminatorStyle}
        />
      )}

      {/* Gray line — twilight boundary lines (elev = -6) */}
      {showGray && grayLines.twilightSouth.length > 1 && (
        <Polyline
          positions={grayLines.twilightSouth}
          pathOptions={grayLineTwilightStyle}
        />
      )}
      {showGray && grayLines.twilightNorth.length > 1 && (
        <Polyline
          positions={grayLines.twilightNorth}
          pathOptions={grayLineTwilightStyle}
        />
      )}
    </>
  );
}

// ── Sub-component: Maidenhead grid ────────────────────────────────
function MaidenheadGrid() {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [map]);

  const grid = useMemo(() => getMaidenheadGrid(), []);

  // Only show grid when zoomed in enough to be useful
  if (zoom < 2) return null;

  return (
    <>
      {grid.map(({ bounds, label }) => (
        <Rectangle
          key={label}
          bounds={bounds}
          pathOptions={{
            color: 'rgba(255,255,255,0.15)',
            weight: 0.5,
            fillColor: 'transparent',
            fillOpacity: 0,
            interactive: false,
          }}
        >
          {zoom >= 3 && (
            <Tooltip
              permanent
              direction="center"
              className="grid-label"
            >
              <span
                style={{
                  color: 'rgba(255,255,255,0.35)',
                  fontSize: zoom >= 5 ? '12px' : '10px',
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  textShadow: '0 0 4px rgba(0,0,0,0.8)',
                }}
              >
                {label}
              </span>
            </Tooltip>
          )}
        </Rectangle>
      ))}
    </>
  );
}

// ── Callsign prefix label data ────────────────────────────────────
// Comprehensive ITU callsign prefixes for every country/territory.
// size >= 10 → show at zoom 2+ (major countries)
// size >= 8  → show at zoom 4+ (medium countries)
// size >= 6  → show at zoom 6+ (small countries/territories)
const CALLSIGN_PREFIXES = [
  // ── Americas ─────────────────────────────────────────────────────
  { prefix: 'W/K/N', lat: 39.8, lng: -98.6, size: 11 },    // USA
  { prefix: 'VE', lat: 56.1, lng: -106.3, size: 10 },       // Canada
  { prefix: 'XE', lat: 23.6, lng: -102.6, size: 10 },       // Mexico
  { prefix: 'PY', lat: -14.2, lng: -51.9, size: 10 },       // Brazil
  { prefix: 'LU', lat: -38.4, lng: -63.6, size: 10 },       // Argentina
  { prefix: 'CE', lat: -35.7, lng: -71.5, size: 8 },        // Chile
  { prefix: 'HK', lat: 4.6, lng: -74.1, size: 8 },          // Colombia
  { prefix: 'OA', lat: -12.0, lng: -77.0, size: 8 },        // Peru
  { prefix: 'YV', lat: 10.5, lng: -66.9, size: 8 },         // Venezuela
  { prefix: 'CO', lat: 23.1, lng: -82.4, size: 8 },         // Cuba
  { prefix: 'TI', lat: 9.9, lng: -84.1, size: 6 },          // Costa Rica
  { prefix: 'HP', lat: 9.0, lng: -79.5, size: 6 },          // Panama
  { prefix: 'HI', lat: 18.5, lng: -69.9, size: 6 },         // Dominican Republic
  { prefix: 'YS', lat: 13.7, lng: -89.2, size: 6 },         // El Salvador
  { prefix: 'TG', lat: 14.6, lng: -90.5, size: 6 },         // Guatemala
  { prefix: 'HR', lat: 14.1, lng: -87.2, size: 6 },         // Honduras
  { prefix: 'YN', lat: 12.1, lng: -86.3, size: 6 },         // Nicaragua
  { prefix: 'J7', lat: 15.3, lng: -61.4, size: 6 },         // Dominica
  { prefix: 'VP2', lat: 18.4, lng: -64.6, size: 6 },        // British Virgin Is
  { prefix: 'V2', lat: 17.1, lng: -61.8, size: 6 },         // Antigua & Barbuda
  { prefix: '8P', lat: 13.2, lng: -59.5, size: 6 },         // Barbados
  { prefix: '9Y', lat: 10.7, lng: -61.2, size: 6 },         // Trinidad & Tobago
  { prefix: 'PJ', lat: 12.2, lng: -68.3, size: 6 },         // Netherlands Antilles
  { prefix: 'FG', lat: 16.3, lng: -61.5, size: 6 },         // Guadeloupe
  { prefix: 'FM', lat: 14.6, lng: -61.0, size: 6 },         // Martinique
  { prefix: 'PZ', lat: 5.9, lng: -55.2, size: 6 },          // Suriname
  { prefix: '8R', lat: 6.8, lng: -58.2, size: 6 },          // Guyana
  { prefix: 'CP', lat: -16.5, lng: -68.2, size: 8 },        // Bolivia
  { prefix: 'ZP', lat: -25.3, lng: -57.6, size: 6 },        // Paraguay
  { prefix: 'CX', lat: -34.9, lng: -56.2, size: 6 },        // Uruguay
  { prefix: 'HC', lat: -0.2, lng: -78.5, size: 6 },         // Ecuador
  { prefix: 'HH', lat: 18.5, lng: -72.3, size: 6 },         // Haiti
  { prefix: '6Y', lat: 18.0, lng: -76.8, size: 6 },         // Jamaica

  // ── Europe ───────────────────────────────────────────────────────
  { prefix: 'G/M', lat: 54.0, lng: -2.0, size: 10 },        // UK
  { prefix: 'F', lat: 46.2, lng: 2.2, size: 10 },           // France
  { prefix: 'DL', lat: 51.2, lng: 10.4, size: 10 },         // Germany
  { prefix: 'I', lat: 42.5, lng: 12.5, size: 10 },          // Italy
  { prefix: 'EA', lat: 40.4, lng: -3.7, size: 10 },         // Spain
  { prefix: 'UA', lat: 55.8, lng: 37.6, size: 10 },         // Russia (west)
  { prefix: 'UA0', lat: 62.0, lng: 100.0, size: 8 },        // Russia (east)
  { prefix: 'EI', lat: 53.3, lng: -6.3, size: 8 },          // Ireland
  { prefix: 'CT', lat: 38.7, lng: -9.1, size: 8 },          // Portugal
  { prefix: 'PA', lat: 52.4, lng: 4.9, size: 8 },           // Netherlands
  { prefix: 'ON', lat: 50.8, lng: 4.4, size: 8 },           // Belgium
  { prefix: 'LX', lat: 49.6, lng: 6.1, size: 6 },           // Luxembourg
  { prefix: 'HB', lat: 46.9, lng: 7.4, size: 8 },           // Switzerland
  { prefix: 'OE', lat: 48.2, lng: 16.4, size: 8 },          // Austria
  { prefix: 'OK', lat: 50.1, lng: 14.4, size: 8 },          // Czech Republic
  { prefix: 'SP', lat: 52.2, lng: 21.0, size: 8 },          // Poland
  { prefix: 'HA', lat: 47.5, lng: 19.0, size: 8 },          // Hungary
  { prefix: 'YO', lat: 44.4, lng: 26.1, size: 8 },          // Romania
  { prefix: 'LZ', lat: 42.7, lng: 23.3, size: 8 },          // Bulgaria
  { prefix: 'SV', lat: 37.6, lng: 23.7, size: 8 },          // Greece
  { prefix: '9A', lat: 45.8, lng: 16.0, size: 6 },          // Croatia
  { prefix: 'S5', lat: 46.1, lng: 14.5, size: 6 },          // Slovenia
  { prefix: 'YU', lat: 44.8, lng: 20.5, size: 8 },          // Serbia
  { prefix: 'Z3', lat: 42.0, lng: 21.4, size: 6 },          // North Macedonia
  { prefix: 'ZA', lat: 41.3, lng: 19.8, size: 6 },          // Albania
  { prefix: '4O', lat: 42.4, lng: 19.3, size: 6 },          // Montenegro
  { prefix: 'E7', lat: 43.9, lng: 17.7, size: 6 },          // Bosnia & Herzegovina
  { prefix: 'T7', lat: 43.9, lng: 12.4, size: 6 },          // San Marino
  { prefix: '9H', lat: 35.9, lng: 14.5, size: 6 },          // Malta
  { prefix: 'LA', lat: 59.9, lng: 10.8, size: 8 },          // Norway
  { prefix: 'SM', lat: 59.3, lng: 18.1, size: 8 },          // Sweden
  { prefix: 'OH', lat: 60.2, lng: 24.9, size: 8 },          // Finland
  { prefix: 'OZ', lat: 55.7, lng: 12.6, size: 8 },          // Denmark
  { prefix: 'TF', lat: 64.1, lng: -21.9, size: 6 },         // Iceland
  { prefix: 'ES', lat: 59.4, lng: 24.7, size: 6 },          // Estonia
  { prefix: 'YL', lat: 56.9, lng: 24.1, size: 6 },          // Latvia
  { prefix: 'LY', lat: 54.7, lng: 25.3, size: 6 },          // Lithuania
  { prefix: 'ER', lat: 47.0, lng: 28.8, size: 6 },          // Moldova
  { prefix: 'UR', lat: 50.5, lng: 30.5, size: 8 },          // Ukraine
  { prefix: 'EU', lat: 53.9, lng: 27.6, size: 8 },          // Belarus
  { prefix: 'OM', lat: 48.1, lng: 17.1, size: 6 },          // Slovakia
  { prefix: 'HV', lat: 41.9, lng: 12.5, size: 6 },          // Vatican City
  { prefix: 'SX', lat: 35.5, lng: 24.0, size: 6 },          // Crete (Greece)

  // ── Asia ──────────────────────────────────────────────────────────
  { prefix: 'JA', lat: 36.2, lng: 138.3, size: 10 },        // Japan
  { prefix: 'BY', lat: 35.9, lng: 104.2, size: 10 },        // China
  { prefix: 'VU', lat: 20.6, lng: 79.0, size: 10 },         // India
  { prefix: 'HL', lat: 37.6, lng: 127.0, size: 10 },        // South Korea
  { prefix: 'BV', lat: 25.0, lng: 121.5, size: 8 },         // Taiwan
  { prefix: 'AP', lat: 33.7, lng: 73.1, size: 8 },          // Pakistan
  { prefix: 'S2', lat: 23.8, lng: 90.4, size: 8 },          // Bangladesh
  { prefix: '4S', lat: 6.9, lng: 79.9, size: 6 },           // Sri Lanka
  { prefix: '9N', lat: 27.7, lng: 85.3, size: 6 },          // Nepal
  { prefix: 'VR', lat: 22.3, lng: 114.2, size: 6 },         // Hong Kong
  { prefix: 'XX9', lat: 22.2, lng: 113.5, size: 6 },        // Macau
  { prefix: '9V', lat: 1.3, lng: 103.8, size: 8 },          // Singapore
  { prefix: '9M', lat: 3.1, lng: 101.7, size: 8 },          // Malaysia
  { prefix: 'YB', lat: -6.2, lng: 106.8, size: 10 },        // Indonesia
  { prefix: 'DU', lat: 14.6, lng: 121.0, size: 8 },         // Philippines
  { prefix: 'HS', lat: 13.8, lng: 100.5, size: 8 },         // Thailand
  { prefix: 'XW', lat: 18.0, lng: 102.6, size: 6 },         // Laos
  { prefix: 'XV', lat: 21.0, lng: 105.9, size: 8 },         // Vietnam
  { prefix: 'XU', lat: 11.6, lng: 104.9, size: 6 },         // Cambodia
  { prefix: 'XZ', lat: 19.8, lng: 96.2, size: 8 },          // Myanmar
  { prefix: 'A5', lat: 27.5, lng: 89.6, size: 6 },          // Bhutan
  { prefix: 'EX', lat: 42.9, lng: 74.6, size: 6 },          // Kyrgyzstan
  { prefix: 'UK', lat: 41.3, lng: 69.3, size: 6 },          // Uzbekistan
  { prefix: 'EZ', lat: 37.9, lng: 58.4, size: 6 },          // Turkmenistan
  { prefix: 'UN', lat: 51.2, lng: 71.4, size: 8 },          // Kazakhstan
  { prefix: 'JT', lat: 47.9, lng: 106.9, size: 8 },         // Mongolia
  { prefix: 'EY', lat: 38.6, lng: 68.8, size: 6 },          // Tajikistan

  // ── Middle East ──────────────────────────────────────────────────
  { prefix: '4X', lat: 31.8, lng: 35.2, size: 8 },          // Israel
  { prefix: 'OD', lat: 33.9, lng: 35.5, size: 6 },          // Lebanon
  { prefix: 'YK', lat: 33.5, lng: 36.3, size: 6 },          // Syria
  { prefix: 'HZ', lat: 24.7, lng: 46.7, size: 10 },         // Saudi Arabia
  { prefix: 'A4', lat: 23.6, lng: 58.5, size: 6 },          // Oman
  { prefix: 'A6', lat: 24.5, lng: 54.7, size: 8 },          // UAE
  { prefix: 'A7', lat: 25.3, lng: 51.5, size: 6 },          // Qatar
  { prefix: 'A9', lat: 26.2, lng: 50.6, size: 6 },          // Bahrain
  { prefix: '9K', lat: 29.4, lng: 47.9, size: 6 },          // Kuwait
  { prefix: 'YI', lat: 33.3, lng: 44.4, size: 8 },          // Iraq
  { prefix: 'EP', lat: 35.7, lng: 51.4, size: 8 },          // Iran
  { prefix: 'EK', lat: 40.2, lng: 44.5, size: 6 },          // Armenia
  { prefix: '4J', lat: 40.4, lng: 49.9, size: 6 },          // Azerbaijan
  { prefix: '4L', lat: 41.7, lng: 44.8, size: 6 },          // Georgia
  { prefix: 'TA', lat: 39.9, lng: 32.9, size: 10 },         // Turkey
  { prefix: 'JY', lat: 31.9, lng: 35.9, size: 6 },          // Jordan

  // ── Africa ───────────────────────────────────────────────────────
  { prefix: 'SU', lat: 30.0, lng: 31.2, size: 8 },          // Egypt
  { prefix: 'ST', lat: 15.6, lng: 32.5, size: 8 },          // Sudan
  { prefix: '5A', lat: 32.9, lng: 13.2, size: 8 },          // Libya
  { prefix: '7X', lat: 36.8, lng: 3.0, size: 8 },           // Algeria
  { prefix: 'CN', lat: 34.0, lng: -6.8, size: 8 },          // Morocco
  { prefix: '3V', lat: 36.8, lng: 10.2, size: 6 },          // Tunisia
  { prefix: '5T', lat: 18.1, lng: -15.9, size: 6 },         // Mauritania
  { prefix: '6W', lat: 14.7, lng: -17.5, size: 6 },         // Senegal
  { prefix: 'C5', lat: 13.5, lng: -16.6, size: 6 },         // Gambia
  { prefix: 'EL', lat: 6.3, lng: -10.8, size: 6 },          // Liberia
  { prefix: '5N', lat: 9.1, lng: 7.5, size: 8 },            // Nigeria
  { prefix: 'TU', lat: 6.8, lng: -5.3, size: 6 },           // Ivory Coast
  { prefix: '9G', lat: 5.6, lng: -0.2, size: 8 },           // Ghana
  { prefix: 'XT', lat: 12.4, lng: -1.5, size: 6 },          // Burkina Faso
  { prefix: '5U', lat: 13.5, lng: 2.1, size: 6 },           // Niger
  { prefix: 'TZ', lat: 12.6, lng: -8.0, size: 6 },          // Mali
  { prefix: '5V', lat: 6.1, lng: 1.2, size: 6 },            // Togo
  { prefix: 'TY', lat: 6.5, lng: 2.6, size: 6 },            // Benin
  { prefix: 'D4', lat: 15.0, lng: -23.6, size: 6 },         // Cape Verde
  { prefix: 'J5', lat: 11.9, lng: -15.6, size: 6 },         // Guinea-Bissau
  { prefix: '3X', lat: 9.6, lng: -13.6, size: 6 },          // Guinea
  { prefix: '9L', lat: 8.5, lng: -13.2, size: 6 },          // Sierra Leone
  { prefix: 'ET', lat: 9.0, lng: 38.7, size: 8 },           // Ethiopia
  { prefix: 'E3', lat: 15.3, lng: 38.9, size: 6 },          // Eritrea
  { prefix: 'J2', lat: 11.6, lng: 43.1, size: 6 },          // Djibouti
  { prefix: 'T5', lat: 2.0, lng: 45.3, size: 6 },           // Somalia
  { prefix: '5H', lat: -6.8, lng: 39.3, size: 8 },          // Tanzania
  { prefix: '5Z', lat: -1.3, lng: 36.8, size: 8 },          // Kenya
  { prefix: '5X', lat: 0.3, lng: 32.6, size: 6 },           // Uganda
  { prefix: '9X', lat: -1.9, lng: 29.9, size: 6 },          // Rwanda
  { prefix: '9U', lat: -3.4, lng: 29.4, size: 6 },          // Burundi
  { prefix: '9J', lat: -15.4, lng: 28.3, size: 8 },         // Zambia
  { prefix: '7Q', lat: -13.9, lng: 33.8, size: 6 },         // Malawi
  { prefix: 'C9', lat: -25.9, lng: 32.6, size: 6 },         // Mozambique
  { prefix: 'Z2', lat: -17.8, lng: 31.1, size: 6 },         // Zimbabwe
  { prefix: 'A2', lat: -24.7, lng: 25.9, size: 8 },         // Botswana
  { prefix: 'V5', lat: -22.6, lng: 17.1, size: 8 },         // Namibia
  { prefix: 'ZS', lat: -25.7, lng: 28.2, size: 10 },        // South Africa
  { prefix: '3DA', lat: -26.3, lng: 31.1, size: 6 },        // Eswatini
  { prefix: '7P', lat: -29.3, lng: 28.5, size: 6 },         // Lesotho
  { prefix: '3B', lat: -20.2, lng: 57.5, size: 6 },         // Mauritius
  { prefix: '5R', lat: -18.9, lng: 47.5, size: 8 },         // Madagascar
  { prefix: 'TL', lat: 4.4, lng: 18.6, size: 6 },           // Central African Rep
  { prefix: 'TR', lat: 0.4, lng: 9.5, size: 6 },            // Gabon
  { prefix: 'TN', lat: -4.3, lng: 15.3, size: 6 },          // Congo (Brazzaville)
  { prefix: '9Q', lat: -4.3, lng: 15.3, size: 8 },          // DR Congo
  { prefix: 'TJ', lat: 12.1, lng: 15.0, size: 6 },          // Cameroon
  { prefix: 'D2', lat: -8.8, lng: 13.2, size: 6 },          // Angola
  { prefix: 'S9', lat: 0.3, lng: 6.7, size: 6 },            // Sao Tome

  // ── Oceania ──────────────────────────────────────────────────────
  { prefix: 'VK', lat: -25.3, lng: 134.8, size: 10 },       // Australia
  { prefix: 'ZL', lat: -41.3, lng: 174.8, size: 10 },       // New Zealand
  { prefix: 'P2', lat: -6.2, lng: 147.0, size: 8 },         // Papua New Guinea
  { prefix: 'FK', lat: -22.3, lng: 166.5, size: 6 },        // New Caledonia
  { prefix: 'FO', lat: -17.5, lng: -149.6, size: 6 },       // French Polynesia
  { prefix: 'KH6', lat: 21.3, lng: -157.8, size: 8 },       // Hawaii
  { prefix: 'KL7', lat: 64.2, lng: -152.5, size: 8 },       // Alaska
  { prefix: 'KP4', lat: 18.2, lng: -66.5, size: 6 },        // Puerto Rico
  { prefix: 'V7', lat: 7.1, lng: 171.2, size: 6 },          // Marshall Islands
  { prefix: 'T8', lat: 7.5, lng: 134.6, size: 6 },          // Palau
  { prefix: 'V6', lat: 6.9, lng: 158.2, size: 6 },          // Micronesia
  { prefix: 'H4', lat: -9.4, lng: 160.0, size: 6 },         // Solomon Islands
  { prefix: '3D', lat: -18.1, lng: 178.4, size: 6 },        // Fiji
  { prefix: '5W', lat: -13.8, lng: -171.8, size: 6 },       // Samoa
  { prefix: 'A3', lat: -21.2, lng: -175.2, size: 6 },       // Tonga
  { prefix: 'ZK', lat: -19.1, lng: -169.9, size: 6 },       // Niue
  { prefix: 'E5', lat: -21.2, lng: -159.8, size: 6 },       // Cook Islands
  { prefix: 'T2', lat: -8.5, lng: 179.2, size: 6 },         // Tuvalu
  { prefix: 'T3', lat: 1.3, lng: 173.0, size: 6 },          // Kiribati
  { prefix: 'YJ', lat: -17.7, lng: 168.3, size: 6 },        // Vanuatu
];

// ── Sub-component: Callsign prefix labels ─────────────────────────
function CallsignPrefixLabels() {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [map]);

  const allEntries = useMemo(() =>
    CALLSIGN_PREFIXES.map(({ prefix, lat, lng, size }) => ({
      size,
      marker: L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'prefix-label',
          html: `<span style="color:#fff;font-size:${Math.max(size, 9)}px;font-weight:700;text-shadow:0 0 5px #000,0 0 3px #000,0 1px 2px #000;font-family:monospace;white-space:nowrap;background:rgba(0,0,0,0.4);padding:1px 3px;border-radius:2px">${prefix}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: false,
      }),
    })), []
  );

  useEffect(() => {
    if (zoom >= 2) {
      // size >= 10 at zoom 2+, size >= 8 at zoom 4+, size >= 6 at zoom 6+
      const minSize = zoom >= 6 ? 6 : zoom >= 4 ? 8 : 10;
      allEntries.forEach(({ size, marker }) => {
        if (size >= minSize) {
          marker.addTo(map);
        }
      });
    }
    return () => {
      allEntries.forEach(({ marker }) => marker.removeFrom(map));
    };
  }, [zoom, allEntries, map]);

  // Don't render anything — markers are added imperatively
  return null;
}

// ── Sub-component: DX Spot markers ────────────────────────────────
function DXSpotMarkers({ spots }: { spots: DXSpot[] }) {
  // Only render spots that have coordinates
  const geoSpots = spots.filter(
    (s): s is DXSpot & { lat: number; lng: number } =>
      s.lat != null && s.lng != null
  );

  return (
    <>
      {geoSpots.map((spot) => (
        <Marker key={spot.id} position={[spot.lat, spot.lng]} icon={dxIcon}>
          <Tooltip
            direction="top"
            offset={[0, -8]}
            className="dx-tooltip"
          >
            <div style={{ fontFamily: 'monospace', fontSize: '11px' }}>
              <strong style={{ color: '#ff9100' }}>{spot.dx}</strong>
              <br />
              {spot.frequency.toFixed(1)} kHz
              {spot.mode ? ` ${spot.mode}` : ''}
              <br />
              <span style={{ opacity: 0.7 }}>by {spot.spotter}</span>
            </div>
          </Tooltip>
          <Popup>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.5 }}>
              <strong>{spot.dx}</strong>
              <br />
              Freq: {spot.frequency.toFixed(1)} kHz
              {spot.band ? ` (${spot.band})` : ''}
              <br />
              Mode: {spot.mode || 'Unknown'}
              <br />
              Spotter: {spot.spotter}
              <br />
              {spot.comment && <>Comment: {spot.comment}<br /></>}
              Time: {spot.time}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

// ── Sub-component: Satellite markers ──────────────────────────────
function SatelliteMarkers({ satellites }: { satellites: SatellitePosition[] }) {
  return (
    <>
      {satellites.map((sat) => (
        <Marker
          key={sat.noradId}
          position={[sat.lat, sat.lng]}
          icon={satIcon}
        >
          <Tooltip
            direction="top"
            offset={[0, -6]}
            className="sat-tooltip"
          >
            <div style={{ fontFamily: 'monospace', fontSize: '10px' }}>
              <strong style={{ color: '#76ff03' }}>{sat.name}</strong>
              <br />
              Alt: {typeof sat.alt === 'number' ? sat.alt.toFixed(0) : '?'} km
            </div>
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}

// ── Great circle calculation ──────────────────────────────────────
function greatCirclePoints(
  lat1: number, lng1: number, lat2: number, lng2: number, numPoints: number
): [number, number][] {
  const toRad = (d: number) => d * Math.PI / 180;
  const toDeg = (r: number) => r * 180 / Math.PI;
  const phi1 = toRad(lat1), lam1 = toRad(lng1);
  const phi2 = toRad(lat2), lam2 = toRad(lng2);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((phi2 - phi1) / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2
  ));

  // If points are essentially the same location, return just the two endpoints
  if (d < 1e-10) return [[lat1, lng1], [lat2, lng2]];

  const points: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    const lng = toDeg(Math.atan2(y, x));
    points.push([lat, lng]);
  }
  return points;
}

/** Calculate distance in km and bearing in degrees between two lat/lng points */
function calcDistanceBearing(
  lat1: number, lng1: number, lat2: number, lng2: number
): { distKm: number; bearing: number } {
  const toRad = (d: number) => d * Math.PI / 180;
  const toDeg = (r: number) => r * 180 / Math.PI;
  const R = 6371; // Earth radius in km
  const phi1 = toRad(lat1), phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLam = toRad(lng2 - lng1);

  // Haversine distance
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distKm = R * c;

  // Initial bearing
  const y = Math.sin(dLam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;

  return { distKm, bearing };
}

// ── Sub-component: Map click handler ─────────────────────────────
function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ── DX target marker icon ────────────────────────────────────────
const dxTargetIcon = L.divIcon({
  className: 'dx-target-marker',
  html: `<div style="
    width:14px;height:14px;border-radius:50%;
    background:#ff6d00;border:2px solid #fff;
    box-shadow:0 0 8px #ff6d00, 0 0 16px rgba(255,109,0,0.4);
  "></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// ── Sub-component: DE→DX propagation path ────────────────────────
function DXPropPath({
  userLat,
  userLng,
  dxLocation,
}: {
  userLat: number;
  userLng: number;
  dxLocation: { lat: number; lng: number };
}) {
  const gcPoints = useMemo(
    () => greatCirclePoints(userLat, userLng, dxLocation.lat, dxLocation.lng, 72),
    [userLat, userLng, dxLocation.lat, dxLocation.lng]
  );

  // Split the polyline at the antimeridian to avoid horizontal wrap lines
  const segments = useMemo(() => {
    const segs: [number, number][][] = [];
    let current: [number, number][] = [gcPoints[0]];
    for (let i = 1; i < gcPoints.length; i++) {
      const prevLng = gcPoints[i - 1][1];
      const curLng = gcPoints[i][1];
      // Detect antimeridian crossing (large longitude jump)
      if (Math.abs(curLng - prevLng) > 180) {
        segs.push(current);
        current = [gcPoints[i]];
      } else {
        current.push(gcPoints[i]);
      }
    }
    segs.push(current);
    return segs;
  }, [gcPoints]);

  const { distKm, bearing } = useMemo(
    () => calcDistanceBearing(userLat, userLng, dxLocation.lat, dxLocation.lng),
    [userLat, userLng, dxLocation.lat, dxLocation.lng]
  );

  const grid = useMemo(
    () => latLngToGrid(dxLocation.lat, dxLocation.lng),
    [dxLocation.lat, dxLocation.lng]
  );

  return (
    <>
      {/* Great circle path segments */}
      {segments.map((seg, i) => (
        <Polyline
          key={`gc-seg-${i}`}
          positions={seg}
          pathOptions={{
            color: '#00d4ff',
            weight: 2,
            dashArray: '8,4',
            opacity: 0.85,
            interactive: false,
          }}
        />
      ))}

      {/* DX target marker */}
      <Marker position={[dxLocation.lat, dxLocation.lng]} icon={dxTargetIcon}>
        <Tooltip
          direction="top"
          offset={[0, -10]}
          permanent
          className="dx-target-tooltip"
        >
          <div style={{ fontFamily: 'monospace', fontSize: '10px', lineHeight: '14px' }}>
            <strong style={{ color: '#ff6d00' }}>DX</strong>
            <span style={{ color: '#aaa', marginLeft: 4 }}>{grid}</span>
            <br />
            <span style={{ color: '#00d4ff' }}>{Math.round(distKm).toLocaleString()} km</span>
            <span style={{ color: '#aaa', marginLeft: 6 }}>{Math.round(bearing)}&deg;</span>
          </div>
        </Tooltip>
      </Marker>
    </>
  );
}

// ── Sub-component: Dynamic tile layer (switches base map) ─────────
function BaseTileLayer({ mapStyle }: { mapStyle: MapStyle }) {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }
    const cfg = MAP_TILE_URLS[mapStyle];
    const layer = L.tileLayer(cfg.url, {
      subdomains: cfg.subdomains || 'abc',
      maxZoom: cfg.maxZoom,
      noWrap: true,
      detectRetina: false,
    });
    layer.addTo(map);
    // Make sure it's below all overlays
    layer.bringToBack();
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [mapStyle, map]);

  return null;
}

// ── Sub-component: Layer Control Panel ────────────────────────────
function LayerControlPanel({
  layers,
  onToggle,
  mapStyle,
  onMapStyle,
}: {
  layers: LayerState;
  onToggle: (key: keyof LayerState) => void;
  mapStyle: MapStyle;
  onMapStyle: (style: MapStyle) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  const checkboxRow = (label: string, key: keyof LayerState) => (
    <label
      key={key}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        fontSize: '11px',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: layers[key] ? '#ffffff' : 'rgba(255,255,255,0.55)',
        transition: 'color 0.15s',
        userSelect: 'none',
      }}
    >
      <input
        type="checkbox"
        checked={layers[key]}
        onChange={() => onToggle(key)}
        style={{ display: 'none' }}
      />
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          border: layers[key] ? '1.5px solid #00d4ff' : '1.5px solid rgba(255,255,255,0.3)',
          background: layers[key] ? 'rgba(0,212,255,0.15)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          lineHeight: 1,
          flexShrink: 0,
          transition: 'all 0.15s',
        }}
      >
        {layers[key] ? '\u2713' : ''}
      </span>
      {label}
    </label>
  );

  const styleBtn = (label: string, style: MapStyle) => (
    <button
      key={style}
      onClick={() => onMapStyle(style)}
      style={{
        padding: '3px 7px',
        fontSize: '10px',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        border: mapStyle === style ? '1px solid #00d4ff' : '1px solid rgba(255,255,255,0.2)',
        borderRadius: 3,
        background: mapStyle === style ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.05)',
        color: mapStyle === style ? '#ffffff' : 'rgba(255,255,255,0.6)',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 1000,
        background: 'rgba(10, 14, 10, 0.82)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 8,
        padding: collapsed ? '6px 10px' : '10px 14px',
        minWidth: collapsed ? 'auto' : 170,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
        color: '#eee',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: collapsed ? 0 : 8,
        }}
      >
        <span
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#ffffff',
            opacity: 0.8,
          }}
        >
          Layers
        </span>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: '13px',
            padding: '0 0 0 8px',
            lineHeight: 1,
          }}
        >
          {collapsed ? '\u25BC' : '\u25B2'}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Overlay checkboxes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {checkboxRow('Day/Night', 'dayNight')}
            {checkboxRow('Gray Line', 'grayLine')}
            {checkboxRow('MUF Map', 'muf')}
            {checkboxRow('Grid Squares', 'gridSquares')}
            {checkboxRow('Prefixes', 'prefixes')}
          </div>

          {/* Divider */}
          <div
            style={{
              height: 1,
              background: 'rgba(255,255,255,0.1)',
              margin: '8px 0',
            }}
          />

          {/* Map style buttons */}
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', marginBottom: 5 }}>
            Map Style
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {styleBtn('Dark', 'dark')}
            {styleBtn('Sat', 'satellite')}
            {styleBtn('Topo', 'terrain')}
            {styleBtn('Light', 'light')}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export default function WorldMap({
  dxSpots,
  satellites,
  userLat,
  userLng,
  dxLocation,
  onMapClick,
  selectedBand,
}: WorldMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');

  // Auto-enable MUF layer when a band is selected
  useEffect(() => {
    if (selectedBand && !layers.muf) {
      setLayers((prev) => ({
        ...prev,
        muf: true,
      }));
    }
  }, [selectedBand]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLayer = useCallback((key: keyof LayerState) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <style>{`
        /* Strip default tooltip chrome for our custom labels */
        .grid-label {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
          pointer-events: none !important;
        }
        .grid-label::before {
          display: none !important;
        }
        .dx-tooltip, .sat-tooltip, .dx-target-tooltip {
          background: rgba(20, 20, 30, 0.92) !important;
          border: 1px solid rgba(255,255,255,0.15) !important;
          border-radius: 4px !important;
          color: #eee !important;
        }
        .dx-tooltip::before, .sat-tooltip::before, .dx-target-tooltip::before {
          border-top-color: rgba(20, 20, 30, 0.92) !important;
        }
        .leaflet-container {
          background: #1a1f2e !important;
        }
        .leaflet-tile-pane {
          filter: brightness(1.4) saturate(0.3) !important;
        }
        .prefix-label {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          pointer-events: none !important;
        }
      `}</style>

      {/* Layer control panel (rendered outside MapContainer so it's always on top) */}
      <LayerControlPanel
        layers={layers}
        onToggle={toggleLayer}
        mapStyle={mapStyle}
        onMapStyle={setMapStyle}
      />

      {/* MUF Band Info Overlay — shown when a band is selected and MUF is on */}
      {selectedBand && layers.muf && BAND_FREQ_MAP[selectedBand] && (
        <>
          {/* Selected band info bar at bottom of map */}
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 1000,
              background: 'rgba(10, 14, 20, 0.88)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: `1px solid ${BAND_COLORS[selectedBand] || '#00d4ff'}`,
              borderRadius: 6,
              padding: '6px 16px',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: '11px',
              color: '#e0e0e0',
              textAlign: 'center',
              boxShadow: `0 0 12px rgba(0,0,0,0.5), 0 0 6px ${BAND_COLORS[selectedBand] || '#00d4ff'}44`,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: BAND_COLORS[selectedBand] || '#00d4ff', fontWeight: 700 }}>
              Propagation: {selectedBand} band ({BAND_FREQ_MAP[selectedBand].toFixed(1)} MHz)
            </span>
            <span style={{ color: '#8899aa', marginLeft: 12 }}>
              Cyan=excellent Green=good Yellow=fair Orange=marginal Red=poor
            </span>
          </div>

          {/* Frequency-to-band legend */}
          <div
            style={{
              position: 'absolute',
              bottom: 44,
              left: 10,
              zIndex: 1000,
              background: 'rgba(10, 14, 20, 0.82)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              padding: '6px 10px',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: '9px',
              color: '#aaa',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ fontSize: '8px', color: '#667', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontWeight: 700 }}>
              Band Reference
            </div>
            {Object.entries(BAND_FREQ_MAP).map(([band, freq]) => (
              <div
                key={band}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '1px 0',
                  opacity: band === selectedBand ? 1 : 0.6,
                  fontWeight: band === selectedBand ? 700 : 400,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: BAND_COLORS[band],
                    display: 'inline-block',
                    flexShrink: 0,
                    boxShadow: band === selectedBand ? `0 0 4px ${BAND_COLORS[band]}` : 'none',
                  }}
                />
                <span style={{ color: band === selectedBand ? '#fff' : '#aaa', minWidth: 28 }}>{band}</span>
                <span style={{ color: band === selectedBand ? BAND_COLORS[band] : '#667' }}>{freq.toFixed(1)} MHz</span>
              </div>
            ))}
          </div>
        </>
      )}

      <MapContainer
        center={[20, 0]}
        zoom={2}
        minZoom={2}
        maxZoom={12}
        zoomControl={false}
        attributionControl={false}
        worldCopyJump={false}
        maxBounds={[[-90, -180], [90, 180]]}
        maxBoundsViscosity={1.0}
        style={{ width: '100%', height: '100%' }}
        ref={mapRef}
      >
        {/* Dynamic base tile layer */}
        <BaseTileLayer mapStyle={mapStyle} />

        {/* Day/Night terminator + gray line */}
        <NightOverlay showNight={layers.dayNight} showGray={layers.grayLine} />

        {/* Propagation heat map overlay */}
        {layers.muf && userLat != null && userLng != null && (
          <PropagationHeatMap
            userLat={userLat}
            userLng={userLng}
            bandMhz={BAND_FREQ_MAP[selectedBand ?? '20m'] ?? 14.0}
          />
        )}

        {/* Maidenhead grid */}
        {layers.gridSquares && <MaidenheadGrid />}

        {/* Callsign prefix labels */}
        {layers.prefixes && <CallsignPrefixLabels />}

        {/* DX spots */}
        <DXSpotMarkers spots={dxSpots} />

        {/* Satellites */}
        <SatelliteMarkers satellites={satellites} />

        {/* User QTH marker */}
        {userLat != null && userLng != null && (
          <Marker position={[userLat, userLng]} icon={qthIcon}>
            <Tooltip direction="top" offset={[0, -10]} permanent>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: '#00e5ff',
                  fontWeight: 700,
                }}
              >
                QTH
              </span>
            </Tooltip>
          </Marker>
        )}

        {/* Map click handler for setting DX target */}
        {onMapClick && <MapClickHandler onMapClick={onMapClick} />}

        {/* DE→DX propagation path */}
        {dxLocation && userLat != null && userLng != null && (
          <DXPropPath
            userLat={userLat}
            userLng={userLng}
            dxLocation={dxLocation}
          />
        )}
      </MapContainer>
    </div>
  );
}
