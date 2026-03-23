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
import DRAPWidget from './components/Widgets/DRAPWidget';
import AuroraWidget from './components/Widgets/AuroraWidget';
import PropPrediction from './components/Widgets/PropPrediction';
import ISSPass from './components/Widgets/ISSPass';
import KC2GWidget from './components/Widgets/KC2GWidget';
import HRDLogGraph from './components/Widgets/HRDLogGraph';

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

// ── Tabbed container for switching between widgets ──────────────────

function TabbedWidget({ tabs }: { tabs: { label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #1a2332', flexShrink: 0 }}>
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActive(i)}
            style={{
              flex: 1,
              padding: '4px 0',
              fontSize: 9,
              fontFamily: "'Courier New', Consolas, monospace",
              fontWeight: active === i ? 700 : 400,
              color: active === i ? '#00d4ff' : '#4a5568',
              background: active === i ? '#0d1520' : 'transparent',
              border: 'none',
              borderRight: i < tabs.length - 1 ? '1px solid #1a2332' : 'none',
              cursor: 'pointer',
              letterSpacing: 1,
              textTransform: 'uppercase',
              transition: 'color 0.15s, background 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {tabs[active]?.content}
      </div>
    </div>
  );
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
  const [dxLocation, setDxLocation] = useState<{ lat: number; lng: number } | null>(null);

  useDataFetch();

  // Derive which bands are currently open (day = Good or Fair)
  const bandsOpen = useMemo(() => {
    if (!bands) return [];
    return Object.entries(bands.conditions || {})
      .filter(([, cond]) => cond.day === 'Good' || cond.day === 'Fair')
      .map(([band]) => band);
  }, [bands]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: '44px 1fr 32px',
        gridTemplateColumns: '260px 1fr 260px',
        height: '100vh',
        background: '#1a2332',
        color: '#e0e0e0',
        fontFamily: "'Courier New', Consolas, monospace",
        overflow: 'hidden',
        gap: 1,
      }}
    >
      {/* Row 1: Header spanning all columns */}
      <div style={{ gridColumn: '1 / -1', background: '#080c12' }}>
        <Header callsign={callsign} onCallsignChange={setCallsign} />
      </div>

      {/* Row 2, Col 1: Left sidebar — Solar Panel + tabbed widgets */}
      <div style={{
        background: '#0a0e14',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {solar ? (
          <SolarPanel data={solar} />
        ) : (
          <div style={{ padding: 10, fontSize: 11, color: '#4a5568', fontStyle: 'italic' }}>
            Awaiting solar data...
          </div>
        )}
        <TabbedWidget
          tabs={[
            { label: 'Enlil', content: <EnlilWidget /> },
            { label: 'SDO Solar', content: <SolarImage /> },
            { label: 'DRAP', content: <DRAPWidget /> },
            { label: 'Aurora', content: <AuroraWidget /> },
            { label: 'KC2G', content: <KC2GWidget /> },
          ]}
        />
      </div>

      {/* Row 2, Col 2: World Map */}
      <div style={{ background: '#0a0e14', overflow: 'hidden' }}>
        <WorldMap
          dxSpots={dxSpots}
          satellites={satellites}
          userLat={userLat}
          userLng={userLng}
          dxLocation={dxLocation}
          onMapClick={(lat, lng) => setDxLocation({ lat, lng })}
          selectedBand={selectedBand}
        />
      </div>

      {/* Row 2, Col 3: Right sidebar — Band Conditions + DX Cluster + ISS + tabbed bottom */}
      <div style={{
        background: '#0a0e14',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Band Conditions — compact, no grow */}
        <div style={{ borderBottom: '1px solid #1a2332', flexShrink: 0, overflow: 'hidden' }}>
          <BandPanel data={bands} />
        </div>

        {/* DX Cluster — scrollable, takes most space */}
        <div style={{ flex: 1, overflow: 'auto', borderBottom: '1px solid #1a2332', minHeight: 0 }}>
          <DXPanel spots={dxSpots} />
        </div>

        {/* ISS Pass — compact */}
        <div style={{ flexShrink: 0, borderBottom: '1px solid #1a2332' }}>
          <ISSPass userLat={userLat} userLng={userLng} />
        </div>

        {/* Tabbed bottom: X-Ray | HRDLog | Propagation */}
        <TabbedWidget
          tabs={[
            { label: 'X-Ray', content: <XRayFlux /> },
            { label: 'HRDLog', content: <HRDLogGraph /> },
            {
              label: 'Propagation',
              content: (
                <PropPrediction
                  userLat={userLat}
                  userLng={userLng}
                  bands={bands}
                  dxLocation={dxLocation}
                />
              ),
            },
          ]}
        />
      </div>

      {/* Row 3: Propagation bar spanning all columns */}
      <div style={{ gridColumn: '1 / -1', background: '#0a0e14' }}>
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
