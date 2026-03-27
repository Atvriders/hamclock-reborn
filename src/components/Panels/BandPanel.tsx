import React, { useState, useEffect } from 'react';
import { BandConditions, ConditionLevel, BandName } from '../../types';

interface BandPanelProps {
  data: BandConditions | null;
}

const C = {
  green: '#00ff88',
  amber: '#ffb800',
  red: '#ff4444',
  labelGray: '#6b7280',
  mutedGray: '#4a5568',
  border: 'rgba(255,255,255,0.06)',
  white: '#ffffff',
  textMuted: '#8899aa',
  rowAlt: 'rgba(255,255,255,0.02)',
};

const DISPLAY_BANDS: BandName[] = [
  '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m',
];

function conditionColor(cond: ConditionLevel): string {
  switch (cond) {
    case 'Good': return C.green;
    case 'Fair': return C.amber;
    case 'Poor': return C.red;
  }
}

function findCondition(
  conditions: Record<string, { day: string; night: string }>,
  band: BandName,
  timeOfDay: 'day' | 'night',
): ConditionLevel {
  const entry = conditions[band];
  if (!entry) return 'Poor';
  const val = timeOfDay === 'day' ? entry.day : entry.night;
  if (val === 'Good' || val === 'Fair' || val === 'Poor') return val;
  return 'Poor';
}

/* Colored dot for condition */
const Dot: React.FC<{ cond: ConditionLevel }> = ({ cond }) => (
  <span style={{
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: conditionColor(cond),
    boxShadow: `0 0 4px ${conditionColor(cond)}40`,
  }} />
);

const BandPanel: React.FC<BandPanelProps> = ({ data }) => {
  const conditions = data?.conditions ?? {};

  const [countdown, setCountdown] = useState(600);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 600 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const countdownLabel = `refresh in ${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div style={{
      background: 'transparent',
      padding: 12,
      boxSizing: 'border-box',
      width: '100%',
    }}>
      {/* Header */}
      <div style={{
        fontSize: 8,
        fontWeight: 600,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        color: C.mutedGray,
        marginBottom: 6,
        paddingBottom: 4,
        borderBottom: `1px solid ${C.border}`,
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}>
        HF BAND CONDITIONS
        <span style={{
          fontSize: 7,
          fontWeight: 400,
          color: C.textMuted,
          marginLeft: 4,
          letterSpacing: 0.5,
        }}>
          {countdownLabel}
        </span>
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        padding: '0 4px 4px 4px',
      }}>
        {['BAND', 'DAY', 'NIGHT'].map((h, i) => (
          <span key={h} style={{
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: 1,
            color: C.labelGray,
            textAlign: i === 0 ? 'left' : 'center',
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            textTransform: 'uppercase',
          }}>
            {h}
          </span>
        ))}
      </div>

      {/* Data rows */}
      {DISPLAY_BANDS.map((band, idx) => {
        const dayC = findCondition(conditions, band, 'day');
        const nightC = findCondition(conditions, band, 'night');
        return (
          <div
            key={band}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              alignItems: 'center',
              height: 22,
              padding: '0 4px',
              borderRadius: 3,
              background: idx % 2 === 1 ? C.rowAlt : 'transparent',
            }}
          >
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              color: C.white,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
            }}>
              {band}
            </span>
            <span style={{ textAlign: 'center' }}>
              <Dot cond={dayC} />
            </span>
            <span style={{ textAlign: 'center' }}>
              <Dot cond={nightC} />
            </span>
          </div>
        );
      })}

      {/* Legend */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 10,
        marginTop: 6,
        paddingTop: 5,
        borderTop: `1px solid ${C.border}`,
      }}>
        {(['Good', 'Fair', 'Poor'] as ConditionLevel[]).map((level) => (
          <span key={level} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 8,
            color: C.labelGray,
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          }}>
            <Dot cond={level} />
            {level}
          </span>
        ))}
      </div>

      {/* Footer: SN */}
      {data && (
        <div style={{
          marginTop: 4,
          textAlign: 'right',
          fontSize: 8,
          color: C.mutedGray,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          letterSpacing: 0.5,
        }}>
          SN {data.signalNoise}
        </div>
      )}
    </div>
  );
};

export default BandPanel;
