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

// ── Mobile Tabbed Panel ─────────────────────────────────────────────

function MobileTabs({ tabs }: { tabs: { label: string; icon: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
      background: '#0a0e14',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #1a2332',
        background: '#080c12',
        flexShrink: 0,
      }}>
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActive(i)}
            style={{
              flex: 1,
              padding: '8px 0 6px',
              fontSize: 10,
              fontFamily: "'Courier New', Consolas, monospace",
              fontWeight: active === i ? 700 : 400,
              color: active === i ? '#00d4ff' : '#4a5568',
              background: active === i ? '#0d1520' : 'transparent',
              border: 'none',
              borderRight: i < tabs.length - 1 ? '1px solid #1a2332' : 'none',
              cursor: 'pointer',
              letterSpacing: 0.5,
              transition: 'color 0.15s, background 0.15s',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>{tab.icon}</span>
            <span style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: 1 }}>{tab.label}</span>
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {tabs[active]?.content}
      </div>
    </div>
  );
}

// ── Mobile Header ───────────────────────────────────────────────────

function MobileHeader({ callsign, onCallsignChange }: { callsign?: string; onCallsignChange?: (cs: string) => void }) {
  const [utcTime, setUtcTime] = useState(new Date());
  const [editing, setEditing] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const timer = setInterval(() => setUtcTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const formatUTC = (d: Date): string => {
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const handleSave = (value: string) => {
    const upper = value.toUpperCase().trim();
    localStorage.setItem('hamclock_callsign', upper);
    setEditing(false);
    onCallsignChange?.(upper);
  };

  return (
    <header style={{
      height: 40,
      background: '#080c12',
      borderBottom: '1px solid #1a2332',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 10px',
      fontFamily: "'Courier New', Courier, monospace",
      boxSizing: 'border-box',
    }}>
      {/* Left: HAMCLOCK + callsign */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          color: '#ffffff',
          fontSize: 11,
          fontWeight: 'bold',
          letterSpacing: 1.5,
          whiteSpace: 'nowrap',
        }}>
          HAMCLOCK
        </span>
        {editing ? (
          <input
            ref={inputRef}
            defaultValue={callsign || ''}
            placeholder="CALL"
            maxLength={10}
            onBlur={(e) => handleSave(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setEditing(false);
            }}
            style={{
              background: '#0d1520',
              border: '1px solid #00d4ff',
              color: '#00d4ff',
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 11,
              padding: '1px 4px',
              width: 70,
              outline: 'none',
              textTransform: 'uppercase',
              borderRadius: 2,
            }}
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            style={{
              color: callsign ? '#00d4ff' : '#4a5568',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {callsign || 'CALL'}
          </span>
        )}
      </div>

      {/* Right: UTC clock */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{
          color: '#ffffff',
          fontSize: 18,
          fontWeight: 'bold',
          letterSpacing: 2,
          fontFamily: "'Courier New', Courier, monospace",
        }}>
          {formatUTC(utcTime)}
        </span>
        <span style={{ color: '#4a5568', fontSize: 8, letterSpacing: 1 }}>UTC</span>
      </div>
    </header>
  );
}

// ── App Inner (main dashboard) ──────────────────────────────────────

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
  const isMobile = useIsMobile();

  const [selectedBand, setSelectedBand] = useState<string | null>(null);
  const [dxLocation, setDxLocation] = useState<{ lat: number; lng: number } | null>(null);

  useDataFetch();

  // Update callsign + grid/location from live database lookup
  const handleCallsignChange = useCallback((cs: string) => {
    setCallsign(cs);
    // Try live API for exact grid
    fetch(`/api/callsign/${encodeURIComponent(cs)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.lat != null && data?.lng != null) {
          setUserLocation(data.lat, data.lng);
          setGridSquare(data.grid || latLngToGrid(data.lat, data.lng));
        } else {
          // Fallback to prefix lookup
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
  }, [setCallsign, setUserLocation, setGridSquare]);

  // Derive which bands are currently open (day = Good or Fair)
  const bandsOpen = useMemo(() => {
    if (!bands) return [];
    return Object.entries(bands.conditions || {})
      .filter(([, cond]) => cond.day === 'Good' || cond.day === 'Fair')
      .map(([band]) => band);
  }, [bands]);

  // ── Mobile layout ───────────────────────────────────────────────
  if (isMobile) {
    const mobileTabs = [
      {
        label: 'Solar',
        icon: '\u2600\uFE0F',
        content: (
          <div style={{ overflow: 'auto' }}>
            {solar ? <SolarPanel data={solar} /> : <div>Awaiting data...</div>}
            <div style={{ borderTop: '1px solid #1a2332' }}>
              <SolarImage />
            </div>
          </div>
        ),
      },
      {
        label: 'Bands',
        icon: '\uD83D\uDCCA',
        content: (
          <div style={{ overflow: 'auto' }}>
            <BandPanel data={bands} />
            <div style={{ borderTop: '1px solid #1a2332' }}>
              <XRayFlux />
            </div>
          </div>
        ),
      },
      {
        label: 'DX',
        icon: '\uD83D\uDCE1',
        content: (
          <div style={{ overflow: 'auto', flex: 1 }}>
            <DXPanel spots={dxSpots} />
          </div>
        ),
      },
      {
        label: 'Space',
        icon: '\uD83C\uDF0D',
        content: (
          <div style={{ overflow: 'auto' }}>
            <EnlilWidget />
            <div style={{ borderTop: '1px solid #1a2332' }}>
              <DRAPWidget />
            </div>
            <div style={{ borderTop: '1px solid #1a2332' }}>
              <AuroraWidget />
            </div>
            <div style={{ borderTop: '1px solid #1a2332' }}>
              <KC2GWidget />
            </div>
          </div>
        ),
      },
      {
        label: 'Tools',
        icon: '\uD83D\uDD27',
        content: (
          <div style={{ overflow: 'auto' }}>
            <ISSPass userLat={userLat} userLng={userLng} />
            <div style={{ borderTop: '1px solid #1a2332' }}>
              <HRDLogGraph />
            </div>
            <div style={{ borderTop: '1px solid #1a2332' }}>
              <PropPrediction userLat={userLat} userLng={userLng} bands={bands} dxLocation={dxLocation} />
            </div>
          </div>
        ),
      },
    ];

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          background: '#1a2332',
          color: '#e0e0e0',
          fontFamily: "'Courier New', Consolas, monospace",
          overflow: 'hidden',
        }}
      >
        {/* Mobile Header — 40px */}
        <MobileHeader callsign={callsign} onCallsignChange={handleCallsignChange} />

        {/* Map — 50vh */}
        <div style={{
          height: '50vh',
          flexShrink: 0,
          background: '#0a0e14',
          overflow: 'hidden',
        }}>
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

        {/* Tabbed panels — remaining space */}
        <MobileTabs tabs={mobileTabs} />

        {/* Propagation bar — compact for mobile */}
        <div style={{
          flexShrink: 0,
          background: '#080c12',
          height: 28,
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}>
          <PropagationBar
            userLat={userLat}
            userLng={userLng}
            bandsOpen={bandsOpen}
            onBandSelect={setSelectedBand}
          />
        </div>

        {/* Mobile scrollbar and layout fixes */}
        <style>{`
          @media (max-width: 767px) {
            .dx-panel-scroll { width: 100% !important; }
            .dx-panel-scroll > div { width: auto !important; }
          }
        `}</style>
      </div>
    );
  }

  // ── Desktop layout (unchanged) ────────────────────────────────────
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: '44px 1fr 32px',
        gridTemplateColumns: '260px 1fr 310px',
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
        <Header callsign={callsign} onCallsignChange={handleCallsignChange} />
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
        {/* Top widget area */}
        <TabbedWidget
          tabs={[
            { label: 'Enlil', content: <EnlilWidget /> },
            { label: 'KC2G', content: <KC2GWidget /> },
            { label: 'DRAP', content: <DRAPWidget /> },
          ]}
        />
        {/* Bottom widget area */}
        <TabbedWidget
          tabs={[
            { label: 'SDO Solar', content: <SolarImage /> },
            { label: 'Aurora', content: <AuroraWidget /> },
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
          gridSquare={gridSquare}
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

        {/* DX Cluster — shares space with tabbed section */}
        <div style={{ flex: 1, overflow: 'auto', borderBottom: '1px solid #1a2332', minHeight: 80, maxHeight: '40%' }}>
          <DXPanel spots={dxSpots} />
        </div>

        {/* ISS Pass — compact */}
        <div style={{ flexShrink: 0, borderBottom: '1px solid #1a2332' }}>
          <ISSPass userLat={userLat} userLng={userLng} />
        </div>

        {/* Tabbed bottom: X-Ray | HRDLog | Propagation — takes remaining space */}
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
          userLat={userLat}
          userLng={userLng}
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
