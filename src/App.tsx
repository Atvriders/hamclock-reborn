import React, { useState, useCallback, useMemo } from 'react';
import 'leaflet/dist/leaflet.css';
import { useStore as useAppStore } from './hooks/useStore';
import { useDataFetch } from './hooks/useDataFetch';
import SetupScreen from './components/SetupScreen';
import Header from './components/Panels/Header';
import SolarPanel from './components/Panels/SolarPanel';
import BandPanel from './components/Panels/BandPanel';
import DXPanel from './components/Panels/DXPanel';
import PropagationBar from './components/Panels/PropagationBar';
import XRayFlux from './components/Widgets/XRayFlux';
import WorldMap from './components/Map/WorldMap';
import SolarImage from './components/Widgets/SolarImage';
import EnlilWidget from './components/Widgets/EnlilWidget';
import PropPrediction from './components/Widgets/PropPrediction';

// ── Error Boundary ──────────────────────────────────────────────────

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background: '#0a0e14', color: '#ff4444', padding: 40, fontFamily: 'monospace', height: '100vh' }}>
          <h2 style={{ color: '#ffffff', marginBottom: 16 }}>HamClock Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#666', marginTop: 12 }}>{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 20, padding: '8px 16px', background: '#00d4ff', color: '#0a0e14', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── App Inner (main dashboard) ──────────────────────────────────────

function AppInner() {
  const callsign = useAppStore((s) => s.callsign);
  const setCallsign = useAppStore((s) => s.setCallsign);
  const solar = useAppStore((s) => s.solar);
  const bands = useAppStore((s) => s.bands);
  const dxSpots = useAppStore((s) => s.dxSpots);
  const satellites = useAppStore((s) => s.satellites);
  const propagation = useAppStore((s) => s.propagation);
  const userLat = useAppStore((s) => s.userLat);
  const userLng = useAppStore((s) => s.userLng);

  const [selectedBand, setSelectedBand] = useState<string | null>(null);

  useDataFetch();

  // Derive which bands are currently open (day = Good or Fair)
  const bandsOpen = useMemo(() => {
    if (!bands) return [];
    return Object.entries(bands.conditions || {})
      .filter(([, cond]) => cond.day === 'Good' || cond.day === 'Fair')
      .map(([band]) => band);
  }, [bands]);

  // satellites still used by WorldMap for map markers

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: '48px 1fr 36px',
        gridTemplateColumns: '200px 1fr 240px',
        height: '100vh',
        background: '#0a0e14',
        color: '#e0e0e0',
        fontFamily: "'Courier New', Consolas, monospace",
        overflow: 'hidden',
      }}
    >
      {/* Row 1: Header spanning all columns */}
      <div style={{ gridColumn: '1 / -1' }}>
        <Header callsign={callsign} onCallsignChange={setCallsign} />
      </div>

      {/* Row 2, Col 1: Left sidebar — Solar Panel + Solar Image */}
      <div style={{ borderRight: '1px solid #1a2332', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {solar ? (
          <SolarPanel data={solar} />
        ) : (
          <div style={{ padding: 10, fontSize: 11, color: '#4a5568', fontStyle: 'italic' }}>
            Awaiting solar data...
          </div>
        )}
        <EnlilWidget />
        <SolarImage />
      </div>

      {/* Row 2, Col 2: World Map */}
      <WorldMap
        dxSpots={dxSpots}
        satellites={satellites}
        userLat={userLat}
        userLng={userLng}
      />

      {/* Row 2, Col 3: Right sidebar — Band Conditions + DX Cluster + Satellites */}
      <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #1a2332', overflow: 'hidden' }}>
        <div style={{ borderBottom: '1px solid #1a2332', overflow: 'hidden', flexShrink: 0 }}>
          <BandPanel data={bands} />
        </div>
        <div style={{ flex: 1, overflow: 'auto', borderBottom: '1px solid #1a2332' }}>
          <DXPanel spots={dxSpots} />
        </div>
        <div style={{ flexShrink: 0, overflow: 'auto', maxHeight: 200 }}>
          <XRayFlux />
        </div>
        <div style={{ flexShrink: 0, overflow: 'auto', maxHeight: 280 }}>
          <PropPrediction userLat={userLat} userLng={userLng} bands={bands} />
        </div>
      </div>

      {/* Row 3: Propagation bar spanning all columns */}
      <div style={{ gridColumn: '1 / -1' }}>
        <PropagationBar
          forecast={propagation}
          bandsOpen={bandsOpen}
          onBandSelect={setSelectedBand}
        />
      </div>
    </div>
  );
}

// ── App (entry point with setup gate) ───────────────────────────────

export default function App() {
  const callsign = useAppStore((s) => s.callsign);
  const setCallsign = useAppStore((s) => s.setCallsign);
  const setGridSquare = useAppStore((s) => s.setGridSquare);
  const setUserLocation = useAppStore((s) => s.setUserLocation);

  const [setupDone, setSetupDone] = useState(() => {
    return !!localStorage.getItem('hamclock_callsign') || !!localStorage.getItem('hamclock_setup_skipped');
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

  return <ErrorBoundary><AppInner /></ErrorBoundary>;
}
