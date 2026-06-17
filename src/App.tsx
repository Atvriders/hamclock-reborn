import React, { useState, useCallback, useMemo } from 'react';
import 'leaflet/dist/leaflet.css';
import { useStore as useAppStore } from './hooks/useStore';
import { useDataFetch } from './hooks/useDataFetch';
import { useIsMobile } from './hooks/useIsMobile';
import { callsignPrefixToLocation, latLngToGrid } from './utils/hamradio';
import SetupScreen from './components/SetupScreen';
import Header from './components/Panels/Header';
import SolarPanel from './components/Panels/SolarPanel';
import BandPanel from './components/Panels/BandPanel';
import DXPanel from './components/Panels/DXPanel';
import PropagationBar from './components/Panels/PropagationBar';
import BeaconClockPanel from './components/Panels/BeaconClockPanel';
import GreylineDxTile from './components/Panels/GreylineDxTile';
import NextPassTile from './components/Panels/NextPassTile';
import PotaLiveTile from './components/Panels/PotaLiveTile';
import SotaLiveTile from './components/Panels/SotaLiveTile';
import SatDopplerTile from './components/Panels/SatDopplerTile';
import WorldMap from './components/Map/WorldMap';

// ── Error Boundary ──────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="ob-mobile-splash">
          <div className="ob-mobile-splash__brand">HAMCLOCK REBORN</div>
          <div className="ob-mobile-splash__msg">{this.state.error.message}</div>
          <button
            className="ob-pill ob-pill--off"
            onClick={() => this.setState({ error: null })}
          >
            <span className="ob-pill__state">Reset</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── XRayTile — wraps NOAA GOES X-Ray image into an ob-panel tile ────

const XRayTile: React.FC = () => {
  const [errored, setErrored] = useState(false);
  const ts = useMemo(() => Date.now(), []);
  const src = `https://services.swpc.noaa.gov/images/animations/goes-xray/1-day.png?t=${ts}`;
  return (
    <div className="ob-panel ob-inst-tile">
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">X-Ray Flux · GOES</span>
        </div>
        {errored ? (
          <div className="ob-xray-tile-fallback">No data</div>
        ) : (
          <img
            className="ob-xray-tile-img"
            src={src}
            alt="GOES X-Ray Flux"
            onError={() => setErrored(true)}
          />
        )}
      </div>
    </div>
  );
};

// ── App Inner ───────────────────────────────────────────────────────

function AppInner() {
  const callsign = useAppStore((s) => s.callsign);
  const gridSquare = useAppStore((s) => s.gridSquare);
  const setCallsign = useAppStore((s) => s.setCallsign);
  const setGridSquare = useAppStore((s) => s.setGridSquare);
  const setUserLocation = useAppStore((s) => s.setUserLocation);
  const solar = useAppStore((s) => s.solar);
  const bands = useAppStore((s) => s.bands);
  const dxSpots = useAppStore((s) => s.dxSpots);
  const satellites = useAppStore((s) => s.satellites);
  const userLat = useAppStore((s) => s.userLat);
  const userLng = useAppStore((s) => s.userLng);
  const potaSpots = useAppStore((s) => s.potaSpots);
  const sotaSpots = useAppStore((s) => s.sotaSpots);
  const satelliteTles = useAppStore((s) => s.satelliteTles);
  const isMobile = useIsMobile(1366);

  // Has location once the user has set callsign (and we've stored coords).
  // Default coords in the store are 40,-74 — only treat as "located"
  // if the user explicitly went through setup or callsign lookup.
  const hasLocation = !!callsign;

  const [selectedBand, setSelectedBand] = useState<string | null>(null);
  const [dxLocation, setDxLocation] = useState<{ lat: number; lng: number } | null>(null);

  useDataFetch();

  const handleCallsignChange = useCallback(
    (cs: string) => {
      setCallsign(cs);
      fetch(`/api/callsign/${encodeURIComponent(cs)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.lat != null && data?.lng != null) {
            setUserLocation(data.lat, data.lng);
            setGridSquare(data.grid || latLngToGrid(data.lat, data.lng));
          } else {
            const loc = callsignPrefixToLocation(cs);
            if (loc) {
              setUserLocation(loc.lat, loc.lng);
              setGridSquare(latLngToGrid(loc.lat, loc.lng));
            }
          }
        })
        .catch(() => {
          const loc = callsignPrefixToLocation(cs);
          if (loc) {
            setUserLocation(loc.lat, loc.lng);
            setGridSquare(latLngToGrid(loc.lat, loc.lng));
          }
        });
    },
    [setCallsign, setUserLocation, setGridSquare],
  );

  const bandsOpen = useMemo(() => {
    if (!bands) return [];
    return Object.entries(bands.conditions || {})
      .filter(([, cond]) => cond.day === 'Good' || cond.day === 'Fair')
      .map(([band]) => band);
  }, [bands]);

  // Mobile: deferred to Pass 2 — show splash explaining desktop requirement.
  if (isMobile) {
    return (
      <div className="ob-mobile-splash">
        <div className="ob-mobile-splash__brand">HAMCLOCK REBORN</div>
        <div className="ob-mobile-splash__msg">
          Open on a desktop monitor (1366px or wider) for the full Operator's Bench layout.
        </div>
        <div className="ob-mobile-splash__legend">Mobile layout — Pass 2</div>
      </div>
    );
  }

  return (
    <div className="ob-chassis">
      <Header
        className="ob-area-head"
        callsign={callsign}
        onCallsignChange={handleCallsignChange}
        gridSquare={gridSquare}
      />

      <SolarPanel className="ob-area-lt-1" data={solar} />

      <BeaconClockPanel className="ob-area-lt-2" />

      <div className="ob-area-hero ob-panel ob-panel--crosshair">
        <div className="ob-map-host">
          <WorldMap
            dxSpots={dxSpots}
            satellites={satellites}
            userLat={userLat}
            userLng={userLng}
            gridSquare={gridSquare}
            dxLocation={dxLocation}
            onMapClick={(lat, lng) => setDxLocation({ lat, lng })}
            selectedBand={selectedBand}
          />
        </div>
      </div>

      <BandPanel className="ob-area-rt-1" data={bands} />

      <DXPanel className="ob-area-rt-2" spots={dxSpots} />

      <div className="ob-area-inst">
        <GreylineDxTile userLat={userLat} userLng={userLng} />
        <NextPassTile
          tles={satelliteTles}
          userLat={userLat}
          userLng={userLng}
          hasLocation={hasLocation}
        />
        <PotaLiveTile spots={potaSpots} />
        <SotaLiveTile spots={sotaSpots} />
        <SatDopplerTile
          tles={satelliteTles}
          userLat={userLat}
          userLng={userLng}
          hasLocation={hasLocation}
        />
        <XRayTile />
      </div>

      <PropagationBar
        className="ob-area-rail"
        userLat={userLat}
        userLng={userLng}
        bandsOpen={bandsOpen}
        onBandSelect={setSelectedBand}
      />
    </div>
  );
}

// ── App (entry point with setup gate) ───────────────────────────────

export default function App() {
  const setCallsign = useAppStore((s) => s.setCallsign);
  const setGridSquare = useAppStore((s) => s.setGridSquare);
  const setUserLocation = useAppStore((s) => s.setUserLocation);

  const [setupDone, setSetupDone] = useState(() => {
    return (
      !!localStorage.getItem('hamclock_callsign') ||
      !!localStorage.getItem('hamclock_setup_skipped')
    );
  });

  const handleSetupComplete = useCallback(
    (cs: string, grid: string, lat: number, lng: number) => {
      if (cs) {
        setCallsign(cs);
        setGridSquare(grid);
        setUserLocation(lat, lng);
      } else {
        localStorage.setItem('hamclock_setup_skipped', '1');
      }
      setSetupDone(true);
    },
    [setCallsign, setGridSquare, setUserLocation],
  );

  if (!setupDone) {
    return (
      <ErrorBoundary>
        <SetupScreen onComplete={handleSetupComplete} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
