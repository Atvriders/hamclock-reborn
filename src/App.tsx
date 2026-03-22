import { useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
import { useStore as useAppStore } from './hooks/useStore';
import { useDataFetch } from './hooks/useDataFetch';
import type { SolarData, BandConditions, DXSpot } from './types';

// ── Placeholder sub-components ──────────────────────────────────────
// Each will become its own file under components/ in later steps.

function Header({ callsign, utcTime }: { callsign: string; utcTime: Date }) {
  const utc = utcTime.toISOString().slice(11, 19);
  const local = utcTime.toLocaleTimeString([], { hour12: false });
  const dateStr = utcTime.toISOString().slice(0, 10);

  return (
    <div style={headerStyle}>
      <span style={{ fontSize: 16, fontWeight: 'bold', letterSpacing: 2 }}>
        {callsign || 'HAMCLOCK REBORN'}
      </span>
      <span style={{ fontSize: 13, opacity: 0.7 }}>
        UTC {utc} &nbsp;|&nbsp; Local {local} &nbsp;|&nbsp; {dateStr}
      </span>
    </div>
  );
}

function SolarPanel({ solar }: { solar: SolarData | null }) {
  if (!solar) return <PanelShell title="Solar / Space Wx"><Dim>Awaiting data...</Dim></PanelShell>;
  return (
    <PanelShell title="Solar / Space Wx">
      <Row label="SFI" value={solar.sfi} />
      <Row label="SSN" value={solar.ssn} />
      <Row label="Kp" value={solar.kp} />
      <Row label="A-index" value={solar.aIndex} />
      <Row label="X-ray" value={solar.xray.classification} />
      <Row label="Wind" value={`${solar.solarWind.speed} km/s`} />
      {solar.solarWind.bz != null && <Row label="Bz" value={`${solar.solarWind.bz} nT`} />}
      {solar.geomagField && <Row label="Storm" value={solar.geomagField.stormLevel} />}
    </PanelShell>
  );
}

function BandPanel({ bands }: { bands: BandConditions | null }) {
  if (!bands) return <PanelShell title="Band Conditions"><Dim>Awaiting data...</Dim></PanelShell>;

  const entries = Object.entries(bands.conditions);

  return (
    <PanelShell title="Band Conditions">
      <div style={{ fontSize: 11 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1a3a1a', paddingBottom: 2, marginBottom: 4 }}>
          <span style={{ width: 60 }}>Band</span>
          <span style={{ width: 40, textAlign: 'center' }}>Day</span>
          <span style={{ width: 40, textAlign: 'right' }}>Night</span>
        </div>
        {entries.map(([band, cond]) => (
          <div key={band} style={{ display: 'flex', justifyContent: 'space-between', lineHeight: '18px' }}>
            <span style={{ width: 60 }}>{band}</span>
            <span style={{ width: 40, textAlign: 'center', color: condColor(cond.day) }}>{cond.day}</span>
            <span style={{ width: 40, textAlign: 'right', color: condColor(cond.night) }}>{cond.night}</span>
          </div>
        ))}
      </div>
      {bands.signalNoise && <div style={{ marginTop: 6, fontSize: 10, opacity: 0.6 }}>S/N: {bands.signalNoise}</div>}
    </PanelShell>
  );
}

function DXPanel({ dxSpots }: { dxSpots: DXSpot[] }) {
  return (
    <PanelShell title="DX Cluster">
      {dxSpots.length === 0
        ? <Dim>No spots yet...</Dim>
        : dxSpots.slice(0, 20).map((s) => (
          <div key={s.id} style={{ fontSize: 10, lineHeight: '16px', borderBottom: '1px solid #0f1f0f', paddingBottom: 2, marginBottom: 2 }}>
            <span style={{ color: '#44ff88', marginRight: 6 }}>{s.dx}</span>
            <span style={{ opacity: 0.6 }}>{s.frequency.toFixed(1)}</span>
            <span style={{ opacity: 0.4, marginLeft: 6 }}>{s.spotter}</span>
          </div>
        ))
      }
    </PanelShell>
  );
}

function WorldMap() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#060a10', color: '#1a3a1a', fontSize: 18 }}>
      World Map (Leaflet) -- coming soon
    </div>
  );
}

function PropagationBar({ bands, solar }: { bands: BandConditions | null; solar: SolarData | null }) {
  const openBands = bands
    ? Object.entries(bands.conditions)
        .filter(([, cond]) => cond.day === 'Good' || cond.day === 'Fair')
        .map(([band]) => band)
    : [];

  return (
    <div style={propagationBarStyle}>
      <span style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase' as const, marginRight: 12 }}>Propagation</span>
      {openBands.length > 0
        ? openBands.map((b) => (
            <span key={b} style={{ background: '#0f2f0f', padding: '2px 8px', borderRadius: 3, fontSize: 11, marginRight: 4 }}>{b}</span>
          ))
        : <span style={{ fontSize: 11, opacity: 0.4 }}>No data</span>
      }
      {solar && (
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.5 }}>
          SFI {solar.sfi} | Kp {solar.kp}
        </span>
      )}
    </div>
  );
}

// ── Tiny helpers ─────────────────────────────────────────────────────

function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 10, height: '100%', boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' as const, letterSpacing: 2, color: '#33ff66', borderBottom: '1px solid #1a3a1a', paddingBottom: 3, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, lineHeight: '20px' }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: '#336633', fontStyle: 'italic' }}>{children}</div>;
}

function condColor(c: string): string {
  if (c === 'Good') return '#44ff88';
  if (c === 'Fair') return '#ffcc44';
  if (c === 'Poor') return '#ff4444';
  return '#666';
}

// ── Styles ───────────────────────────────────────────────────────────

const headerStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  background: '#0e1218',
  borderBottom: '1px solid #1a2a1a',
};

const propagationBarStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  padding: '0 16px',
  background: '#0e1218',
  borderTop: '1px solid #1a2a1a',
};

// ── App ──────────────────────────────────────────────────────────────

export default function App() {
  const callsign = useAppStore((s) => s.callsign);
  const solar = useAppStore((s) => s.solar);
  const bands = useAppStore((s) => s.bands);
  const dxSpots = useAppStore((s) => s.dxSpots);
  const utcTime = useAppStore((s) => s.utcTime);
  const setUtcTime = useAppStore((s) => s.setUtcTime);

  useDataFetch();

  // Tick UTC clock every second
  useEffect(() => {
    const id = setInterval(() => setUtcTime(new Date()), 1000);
    return () => clearInterval(id);
  }, [setUtcTime]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: '48px 1fr 36px',
        gridTemplateColumns: '200px 1fr 240px',
        height: '100vh',
        background: '#0a0e14',
        color: '#00ff41',
        fontFamily: "'Courier New', Consolas, monospace",
        overflow: 'hidden',
      }}
    >
      {/* Row 1, col 1-3: Header spanning all columns */}
      <Header callsign={callsign} utcTime={utcTime} />

      {/* Row 2, col 1: Solar panel */}
      <div style={{ borderRight: '1px solid #1a2a1a', overflow: 'hidden' }}>
        <SolarPanel solar={solar} />
      </div>

      {/* Row 2, col 2: World map */}
      <WorldMap />

      {/* Row 2, col 3: Right sidebar -- Band Conditions + DX Cluster */}
      <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #1a2a1a', overflow: 'hidden' }}>
        <div style={{ flex: 1, borderBottom: '1px solid #1a2a1a', overflow: 'hidden' }}>
          <BandPanel bands={bands} />
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DXPanel dxSpots={dxSpots} />
        </div>
      </div>

      {/* Row 3, col 1-3: Propagation bar spanning all columns */}
      <PropagationBar bands={bands} solar={solar} />
    </div>
  );
}
