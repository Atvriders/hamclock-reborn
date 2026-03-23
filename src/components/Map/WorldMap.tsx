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
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
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
  grayLine: true,
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
const CALLSIGN_PREFIXES = [
  { prefix: 'W/K/N', lat: 39.8, lng: -98.6, size: 12 },   // USA
  { prefix: 'VE', lat: 56.1, lng: -106.3, size: 11 },      // Canada
  { prefix: 'G', lat: 52.0, lng: -1.2, size: 10 },          // UK
  { prefix: 'F', lat: 46.2, lng: 2.2, size: 10 },           // France
  { prefix: 'DL', lat: 51.2, lng: 10.4, size: 10 },         // Germany
  { prefix: 'I', lat: 41.9, lng: 12.5, size: 10 },          // Italy
  { prefix: 'EA', lat: 40.4, lng: -3.7, size: 10 },         // Spain
  { prefix: 'JA', lat: 36.2, lng: 138.3, size: 11 },        // Japan
  { prefix: 'VK', lat: -25.3, lng: 134.8, size: 11 },       // Australia
  { prefix: 'ZL', lat: -41.3, lng: 174.8, size: 10 },       // New Zealand
  { prefix: 'PY', lat: -14.2, lng: -51.9, size: 11 },       // Brazil
  { prefix: 'LU', lat: -38.4, lng: -63.6, size: 10 },       // Argentina
  { prefix: 'UA', lat: 55.8, lng: 37.6, size: 11 },         // Russia
  { prefix: 'BY', lat: 35.9, lng: 104.2, size: 11 },        // China
  { prefix: 'HL', lat: 37.6, lng: 127.0, size: 10 },        // South Korea
  { prefix: 'VU', lat: 20.6, lng: 79.0, size: 11 },         // India
  { prefix: 'ZS', lat: -30.6, lng: 22.9, size: 10 },        // South Africa
  { prefix: 'SV', lat: 39.1, lng: 21.8, size: 9 },          // Greece
  { prefix: 'OZ', lat: 56.3, lng: 9.5, size: 9 },           // Denmark
  { prefix: 'SM', lat: 60.1, lng: 18.6, size: 9 },          // Sweden
  { prefix: 'LA', lat: 60.5, lng: 8.5, size: 9 },           // Norway
  { prefix: 'OH', lat: 61.9, lng: 25.7, size: 9 },          // Finland
  { prefix: 'PA', lat: 52.1, lng: 5.3, size: 9 },           // Netherlands
  { prefix: 'ON', lat: 50.5, lng: 4.5, size: 9 },           // Belgium
  { prefix: 'HB', lat: 46.8, lng: 8.2, size: 9 },           // Switzerland
  { prefix: 'OE', lat: 47.5, lng: 14.6, size: 9 },          // Austria
  { prefix: 'SP', lat: 51.9, lng: 19.1, size: 9 },          // Poland
  { prefix: 'OK', lat: 49.8, lng: 15.5, size: 9 },          // Czech Republic
  { prefix: 'HA', lat: 47.2, lng: 19.5, size: 9 },          // Hungary
  { prefix: 'CT', lat: 39.4, lng: -8.2, size: 9 },          // Portugal
  { prefix: 'EI', lat: 53.4, lng: -8.2, size: 9 },          // Ireland
  { prefix: 'XE', lat: 23.6, lng: -102.6, size: 10 },       // Mexico
  { prefix: 'CE', lat: -35.7, lng: -71.5, size: 10 },       // Chile
  { prefix: 'HK', lat: 4.6, lng: -74.1, size: 9 },          // Colombia
  { prefix: 'YB', lat: -0.8, lng: 113.9, size: 10 },        // Indonesia
  { prefix: 'HS', lat: 15.9, lng: 100.5, size: 9 },         // Thailand
  { prefix: '9V', lat: 1.4, lng: 103.8, size: 9 },          // Singapore
  { prefix: '9M', lat: 4.2, lng: 101.7, size: 9 },          // Malaysia
  { prefix: 'DU', lat: 12.9, lng: 121.8, size: 9 },         // Philippines
  { prefix: 'A6', lat: 23.4, lng: 53.8, size: 9 },          // UAE
  { prefix: '4X', lat: 31.0, lng: 34.8, size: 9 },          // Israel
  { prefix: 'TA', lat: 39.9, lng: 32.9, size: 9 },          // Turkey
  { prefix: 'UA0', lat: 55.8, lng: 82.0, size: 9 },         // Russia (east)
  { prefix: 'BV', lat: 25.0, lng: 121.5, size: 9 },         // Taiwan
  { prefix: 'YO', lat: 45.9, lng: 24.9, size: 9 },          // Romania
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

  const markers = useMemo(() =>
    CALLSIGN_PREFIXES.map(({ prefix, lat, lng, size }) =>
      L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'prefix-label',
          html: `<span style="color:#fff;font-size:${size}px;font-weight:700;text-shadow:0 0 4px #000,0 0 2px #000;font-family:monospace;white-space:nowrap">${prefix}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: false,
      })
    ), []
  );

  useEffect(() => {
    if (zoom >= 2 && zoom <= 5) {
      markers.forEach((m) => m.addTo(map));
    }
    return () => {
      markers.forEach((m) => m.removeFrom(map));
    };
  }, [zoom, markers, map]);

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
              Alt: {sat.alt.toFixed(0)} km
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
          background: #0d1117 !important;
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
        {layers.muf && selectedBand && BAND_FREQ_MAP[selectedBand] && userLat != null && userLng != null && (
          <PropagationHeatMap
            userLat={userLat}
            userLng={userLng}
            bandMhz={BAND_FREQ_MAP[selectedBand]}
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
