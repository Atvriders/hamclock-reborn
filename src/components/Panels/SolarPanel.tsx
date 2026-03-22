import React from 'react';
import { SolarData } from '../../types';

interface SolarPanelProps {
  data: SolarData;
}

const COLORS = {
  bg: '#0a0e14',
  bgPanel: '#0d1117',
  green: '#00ff88',
  amber: '#ffb800',
  red: '#ff4444',
  cyan: '#00d4ff',
  muted: '#4a5568',
  border: '#1a2332',
  text: '#8899aa',
};

function sfiColor(sfi: number): string {
  if (sfi > 100) return COLORS.green;
  if (sfi >= 70) return COLORS.amber;
  return COLORS.red;
}

function kpColor(kp: number): string {
  if (kp <= 3) return COLORS.green;
  if (kp <= 5) return COLORS.amber;
  return COLORS.red;
}

function xrayColor(xrayFlux: string): string {
  const cls = xrayFlux.charAt(0).toUpperCase();
  switch (cls) {
    case 'A': case 'B': return COLORS.green;
    case 'C': return COLORS.cyan;
    case 'M': return COLORS.amber;
    case 'X': return COLORS.red;
    default: return COLORS.text;
  }
}

function stormColor(level: string): string {
  switch (level) {
    case 'None': return COLORS.green;
    case 'Minor': case 'Moderate': return COLORS.amber;
    default: return COLORS.red;
  }
}

const DataRow: React.FC<{
  label: string;
  value: string | number;
  color: string;
  suffix?: string;
  extra?: React.ReactNode;
}> = ({ label, value, color, suffix, extra }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{
      color: COLORS.muted,
      fontSize: 10,
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginBottom: 2,
    }}>
      {label}
    </div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{
        color,
        fontSize: 22,
        fontWeight: 'bold',
        fontFamily: "'Courier New', Courier, monospace",
        lineHeight: 1,
      }}>
        {value}
      </span>
      {suffix && (
        <span style={{ color: COLORS.text, fontSize: 11 }}>{suffix}</span>
      )}
      {extra}
    </div>
  </div>
);

const KpBar: React.FC<{ kp: number }> = ({ kp }) => (
  <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
    {Array.from({ length: 9 }, (_, i) => (
      <div key={i} style={{
        width: 16,
        height: 6,
        borderRadius: 1,
        background: i < kp ? kpColor(kp) : '#1a2332',
        opacity: i < kp ? 1 : 0.3,
      }} />
    ))}
  </div>
);

const SolarPanel: React.FC<SolarPanelProps> = ({ data }) => {
  const lastUpdateStr = data.timestamp
    ? new Date(data.timestamp).toISOString().slice(11, 16) + ' UTC'
    : '--:-- UTC';

  return (
    <div style={{
      width: 200,
      background: COLORS.bgPanel,
      borderRight: `1px solid ${COLORS.border}`,
      padding: '12px 14px',
      fontFamily: "'Courier New', Courier, monospace",
      overflowY: 'auto',
      height: '100%',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        color: COLORS.green,
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 2,
        marginBottom: 14,
        paddingBottom: 6,
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        SOLAR / SPACE WX
      </div>

      <DataRow
        label="Solar Flux (SFI)"
        value={data.sfi}
        color={sfiColor(data.sfi)}
      />

      <div style={{ marginBottom: 10 }}>
        <div style={{
          color: COLORS.muted,
          fontSize: 10,
          letterSpacing: 1,
          textTransform: 'uppercase',
          marginBottom: 2,
        }}>
          Kp Index
        </div>
        <span style={{
          color: kpColor(data.kp),
          fontSize: 22,
          fontWeight: 'bold',
          fontFamily: "'Courier New', Courier, monospace",
          lineHeight: 1,
        }}>
          {data.kp}
        </span>
        <KpBar kp={data.kp} />
      </div>

      <DataRow
        label="Sunspot Number"
        value={data.ssn}
        color={COLORS.cyan}
      />

      <DataRow
        label="X-Ray Flux"
        value={data.xray.classification}
        color={xrayColor(data.xray.classification)}
      />

      <DataRow
        label="Solar Wind"
        value={data.solarWind.speed}
        color={data.solarWind.speed > 500 ? COLORS.red : data.solarWind.speed > 400 ? COLORS.amber : COLORS.green}
        suffix="km/s"
      />

      <DataRow
        label="A-Index"
        value={data.aIndex}
        color={data.aIndex > 30 ? COLORS.red : data.aIndex > 15 ? COLORS.amber : COLORS.green}
      />

      {data.solarWind.bz != null && (
        <DataRow
          label="Bz"
          value={data.solarWind.bz.toFixed(1)}
          color={data.solarWind.bz < -5 ? COLORS.red : data.solarWind.bz < 0 ? COLORS.amber : COLORS.green}
          suffix="nT"
        />
      )}

      {data.geomagField && (
        <DataRow
          label="Geomag Storm"
          value={data.geomagField.stormLevel}
          color={stormColor(data.geomagField.stormLevel)}
        />
      )}

      {/* Last update */}
      <div style={{
        marginTop: 16,
        paddingTop: 8,
        borderTop: `1px solid ${COLORS.border}`,
        color: COLORS.muted,
        fontSize: 9,
        letterSpacing: 0.5,
      }}>
        Last update: {lastUpdateStr}
      </div>
    </div>
  );
};

export default SolarPanel;
