import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  Rectangle,
  Marker,
  Popup,
  Tooltip,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import type { DXSpot, SatellitePosition } from '../../types';
import {
  getNightPolygon,
  getGrayLinePolygons,
  getMaidenheadGrid,
} from '../../utils/solar';

// ── Fix Leaflet default icon paths (Vite/Webpack strip them) ──────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Props ─────────────────────────────────────────────────────────
interface WorldMapProps {
  dxSpots: DXSpot[];
  satellites: SatellitePosition[];
  userLat?: number;
  userLng?: number;
}

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
function NightOverlay() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nightCoords = useMemo(() => getNightPolygon(now), [now]);
  const grayLine = useMemo(() => getGrayLinePolygons(now), [now]);

  return (
    <>
      {/* Night side */}
      <Polygon
        positions={nightCoords}
        pathOptions={{
          color: 'transparent',
          fillColor: '#000',
          fillOpacity: 0.45,
          interactive: false,
        }}
      />

      {/* Gray line — dawn band */}
      {grayLine.dawn.length > 2 && (
        <Polygon
          positions={grayLine.dawn}
          pathOptions={{
            color: 'transparent',
            fillColor: '#ff6f00',
            fillOpacity: 0.15,
            interactive: false,
          }}
        />
      )}

      {/* Gray line — dusk band */}
      {grayLine.dusk.length > 2 && (
        <Polygon
          positions={grayLine.dusk}
          pathOptions={{
            color: 'transparent',
            fillColor: '#ff6f00',
            fillOpacity: 0.15,
            interactive: false,
          }}
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

// ── Main component ────────────────────────────────────────────────
export default function WorldMap({
  dxSpots,
  satellites,
  userLat,
  userLng,
}: WorldMapProps) {
  const mapRef = useRef<L.Map | null>(null);

  const center: [number, number] = useMemo(
    () => [userLat ?? 20, userLng ?? 0],
    [userLat, userLng]
  );

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
        .dx-tooltip, .sat-tooltip {
          background: rgba(20, 20, 30, 0.92) !important;
          border: 1px solid rgba(255,255,255,0.15) !important;
          border-radius: 4px !important;
          color: #eee !important;
        }
        .dx-tooltip::before, .sat-tooltip::before {
          border-top-color: rgba(20, 20, 30, 0.92) !important;
        }
        .leaflet-container {
          background: #0d1117 !important;
        }
      `}</style>

      <MapContainer
        center={center}
        zoom={2}
        minZoom={2}
        maxZoom={10}
        zoomControl={false}
        attributionControl={false}
        worldCopyJump
        style={{ width: '100%', height: '100%' }}
        ref={mapRef}
      >
        {/* Dark tile layer */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
        />

        {/* Day/Night terminator + gray line */}
        <NightOverlay />

        {/* Maidenhead grid */}
        <MaidenheadGrid />

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
      </MapContainer>
    </div>
  );
}
