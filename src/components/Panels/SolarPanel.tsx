import React, { useState, useEffect } from 'react';
import { SolarData } from '../../types';

interface SolarPanelProps {
  data: SolarData;
}

/* ---------- color helpers ---------- */

const C = {
  green: '#00ff88',
  amber: '#ffb800',
  red: '#ff4444',
  cyan: '#00d4ff',
  labelGray: '#6b7280',
  mutedGray: '#4a5568',
  border: 'rgba(255,255,255,0.06)',
  white: '#ffffff',
  textMuted: '#8899aa',
};

function sfiColor(sfi: number): string {
  if (sfi > 100) return C.green;
  if (sfi >= 70) return C.amber;
  return C.red;
}

function kpColor(kp: number): string {
  if (kp <= 3) return C.green;
  if (kp <= 5) return C.amber;
  return C.red;
}

function aIndexColor(a: number | undefined): string {
  if (a == null) return C.textMuted;
  if (a > 30) return C.red;
  if (a > 15) return C.amber;
  return C.green;
}

function xrayColor(cls: string | undefined): string {
  if (!cls) return C.textMuted;
  const c = cls.charAt(0).toUpperCase();
  if (c === 'A' || c === 'B') return C.green;
  if (c === 'C') return C.cyan;
  if (c === 'M') return C.amber;
  if (c === 'X') return C.red;
  return C.textMuted;
}

function windColor(speed: number): string {
  if (speed > 500) return C.red;
  if (speed > 400) return C.amber;
  return C.green;
}

function bzColor(bz: number): string {
  if (bz < -5) return C.red;
  if (bz < 0) return C.amber;
  return C.green;
}

/* ---------- tiny sub-components ---------- */

const Row: React.FC<{
  label: string;
  value: string | number;
  color: string;
  suffix?: string;
  mono?: boolean;
}> = ({ label, value, color, suffix, mono = true }) => (
  <div style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 0',
  }}>
    <span style={{
      fontSize: 10,
      color: C.labelGray,
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
    <span style={{
      fontSize: 14,
      fontWeight: 700,
      color,
      fontFamily: mono
        ? "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"
        : 'Inter, system-ui, -apple-system, sans-serif',
      letterSpacing: mono ? -0.3 : 0,
    }}>
      {value}
      {suffix && (
        <span style={{ fontSize: 9, fontWeight: 400, color: C.textMuted, marginLeft: 2 }}>
          {suffix}
        </span>
      )}
    </span>
  </div>
);

const SectionLabel: React.FC<{ text: string }> = ({ text }) => (
  <div style={{
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: C.mutedGray,
    marginTop: 10,
    marginBottom: 4,
    paddingBottom: 3,
    borderBottom: `1px solid ${C.border}`,
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  }}>
    {text}
  </div>
);

const KpBar: React.FC<{ kp: number }> = ({ kp }) => {
  const color = kpColor(kp);
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '3px 0 0 0',
    }}>
      <span style={{
        fontSize: 10,
        color: C.labelGray,
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}>
        Kp
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <div style={{ display: 'flex', gap: 1.5 }}>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} style={{
              width: 8,
              height: 10,
              borderRadius: 1.5,
              background: i < kp ? color : 'rgba(255,255,255,0.06)',
              transition: 'background 0.3s ease',
            }} />
          ))}
        </div>
        <span style={{
          fontSize: 14,
          fontWeight: 700,
          color,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
          marginLeft: 4,
          minWidth: 14,
          textAlign: 'right',
        }}>
          {kp}
        </span>
      </div>
    </div>
  );
};

/* ---------- main component ---------- */

const SolarPanel: React.FC<SolarPanelProps> = ({ data }) => {
  const [countdown, setCountdown] = useState(300);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? 300 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Reset countdown when data refreshes
  useEffect(() => {
    setCountdown(300);
  }, [data.timestamp]);

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const countdownText = `refresh in ${minutes}:${seconds.toString().padStart(2, '0')}`;

  const ts = data.timestamp
    ? new Date(data.timestamp).toISOString().slice(11, 16) + 'z'
    : '';

  return (
    <div style={{
      background: 'transparent',
      padding: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      boxSizing: 'border-box',
      width: '100%',
    }}>
      {/* ------- SFI hero value ------- */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 2,
      }}>
        <span style={{
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          color: C.mutedGray,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        }}>
          SOLAR FLUX
          <span style={{
            fontSize: 7,
            fontWeight: 400,
            color: C.textMuted,
            marginLeft: 4,
            letterSpacing: 0.5,
          }}>
            {countdownText}
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
          <span style={{
            fontSize: 26,
            fontWeight: 700,
            color: sfiColor(data.sfi),
            lineHeight: 1,
            letterSpacing: -1,
          }}>
            {data.sfi}
          </span>
          <span style={{ fontSize: 9, color: C.textMuted }}>SFI</span>
        </div>
      </div>

      {/* ------- Solar Activity ------- */}
      <SectionLabel text="Solar Activity" />
      <Row label="SSN" value={data.ssn} color={C.cyan} />
      <Row
        label="X-Ray"
        value={data.xray?.classification ?? '\u2014'}
        color={xrayColor(data.xray?.classification)}
      />

      {/* ------- Geomagnetic ------- */}
      <SectionLabel text="Geomagnetic" />
      <KpBar kp={data.kp} />
      <Row label="A-Index" value={data.aIndex ?? '\u2014'} color={aIndexColor(data.aIndex)} />
      {data.geomagField && (
        <Row
          label="Storm"
          value={data.geomagField.stormLevel}
          color={
            data.geomagField.stormLevel === 'None' || data.geomagField.stormLevel === 'Quiet'
              ? C.green
              : data.geomagField.stormLevel === 'Active'
              ? C.amber
              : C.red
          }
          mono={false}
        />
      )}

      {/* ------- Solar Wind ------- */}
      {data.solarWind && (
        <>
          <SectionLabel text="Solar Wind" />
          <Row
            label="Speed"
            value={data.solarWind.speed}
            color={windColor(data.solarWind.speed)}
            suffix="km/s"
          />
          {data.solarWind.bz != null && (
            <Row
              label="Bz"
              value={data.solarWind.bz.toFixed(1)}
              color={bzColor(data.solarWind.bz)}
              suffix="nT"
            />
          )}
        </>
      )}

      {/* ------- Timestamp ------- */}
      {ts && (
        <div style={{
          marginTop: 10,
          textAlign: 'right',
          fontSize: 8,
          color: C.mutedGray,
          letterSpacing: 0.5,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        }}>
          {ts}
        </div>
      )}
    </div>
  );
};

export default SolarPanel;
