import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Rectangle,
  Marker,
  Popup,
  Tooltip,
  ImageOverlay,
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

// ── Overlay URLs ─────────────────────────────────────────────────
// KC2G SVG is the only working MUF render (PNG returns 404)
const MUF_OVERLAY_URL = 'https://prop.kc2g.com/renders/current/mufd-normal-now.svg';
const AURORA_OVERLAY_URL = 'https://services.swpc.noaa.gov/images/aurora-forecast-northern-hemisphere.jpg';
const DRAP_OVERLAY_URL = 'https://services.swpc.noaa.gov/images/d-rap/global.png';

const WORLD_BOUNDS: L.LatLngBoundsExpression = [[-90, -180], [90, 180]];
// KC2G SVG has axis labels — extend bounds to compensate for margins
const MUF_BOUNDS: L.LatLngBoundsExpression = [[-100, -200], [100, 200]];
const NORTH_BOUNDS: L.LatLngBoundsExpression = [[0, -180], [90, 180]];

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

// ── Layer visibility state ────────────────────────────────────────
interface LayerState {
  dayNight: boolean;
  grayLine: boolean;
  muf: boolean;
  drap: boolean;
  aurora: boolean;
  gridSquares: boolean;
}

const DEFAULT_LAYERS: LayerState = {
  dayNight: true,
  grayLine: true,
  muf: false,
  drap: false,
  aurora: false,
  gridSquares: false,
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
            {checkboxRow('DRAP', 'drap')}
            {checkboxRow('Aurora', 'aurora')}
            {checkboxRow('Grid Squares', 'gridSquares')}
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
        drap: false,
        aurora: false,
      }));
    }
  }, [selectedBand]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cache-bust overlay URLs every 10 minutes
  const [cacheBust, setCacheBust] = useState(() => Math.floor(Date.now() / 600_000));
  useEffect(() => {
    const id = setInterval(() => setCacheBust(Math.floor(Date.now() / 600_000)), 600_000);
    return () => clearInterval(id);
  }, []);

  // Overlay keys that are mutually exclusive (radio group)
  const OVERLAY_RADIO_KEYS: (keyof LayerState)[] = ['muf', 'drap', 'aurora'];

  const toggleLayer = useCallback((key: keyof LayerState) => {
    setLayers((prev) => {
      // If toggling one of the radio-group overlays, turn off the others
      if (OVERLAY_RADIO_KEYS.includes(key)) {
        const turning_on = !prev[key];
        const updates: Partial<LayerState> = {};
        for (const k of OVERLAY_RADIO_KEYS) {
          updates[k] = k === key ? turning_on : false;
        }
        return { ...prev, ...updates };
      }
      // Independent toggles (dayNight, grayLine, gridSquares)
      return { ...prev, [key]: !prev[key] };
    });
  }, []);

  const mufUrl = `${MUF_OVERLAY_URL}?_=${cacheBust}`;
  const drapUrl = `${DRAP_OVERLAY_URL}?_=${cacheBust}`;
  const auroraUrl = `${AURORA_OVERLAY_URL}?_=${cacheBust}`;

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
              MUF: {selectedBand} band ({BAND_FREQ_MAP[selectedBand].toFixed(1)} MHz)
            </span>
            <span style={{ color: '#8899aa', marginLeft: 12 }}>
              Areas above the {BAND_FREQ_MAP[selectedBand].toFixed(1)} contour line have propagation on {selectedBand}
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
              MUF Contour Legend
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

        {/* MUF overlay */}
        {layers.muf && (
          <ImageOverlay
            url={mufUrl}
            bounds={MUF_BOUNDS}
            opacity={0.95}
            interactive={false}
            className="muf-overlay"
          />
        )}

        {/* DRAP overlay */}
        {layers.drap && (
          <ImageOverlay
            url={drapUrl}
            bounds={WORLD_BOUNDS}
            opacity={0.55}
            interactive={false}
            className="drap-overlay"
          />
        )}

        {/* Aurora overlay (northern hemisphere) */}
        {layers.aurora && (
          <ImageOverlay
            url={auroraUrl}
            bounds={NORTH_BOUNDS}
            opacity={0.5}
            interactive={false}
            className="aurora-overlay"
          />
        )}

        {/* Maidenhead grid */}
        {layers.gridSquares && <MaidenheadGrid />}

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
