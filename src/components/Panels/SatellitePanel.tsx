import React from 'react';
import { SatellitePosition, SatellitePass } from '../../types';

interface SatelliteInfo {
  position: SatellitePosition;
  nextPass: SatellitePass | null;
  isVisible: boolean;
}

interface SatellitePanelProps {
  satellites: SatelliteInfo[];
}

const COLORS = {
  bgPanel: '#0d1117',
  green: '#00ff88',
  cyan: '#00d4ff',
  muted: '#4a5568',
  border: '#1a2332',
  text: '#8899aa',
};

function formatNextPass(pass: SatellitePass | null): string {
  if (!pass) return '--';
  try {
    const aos = new Date(pass.aosTime);
    const now = new Date();
    const diffMs = aos.getTime() - now.getTime();
    if (diffMs < 0) return 'NOW';
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return `${h}h ${m}m`;
  } catch {
    return '--';
  }
}

function formatAltitude(alt: number): string {
  if (alt >= 1000) return `${(alt / 1000).toFixed(1)}k`;
  return `${Math.round(alt)}`;
}

const SatellitePanel: React.FC<SatellitePanelProps> = ({ satellites }) => {
  return (
    <div style={{
      background: COLORS.bgPanel,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 4,
      padding: '10px 12px',
      fontFamily: "'Courier New', Courier, monospace",
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
        paddingBottom: 6,
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <span style={{
          color: COLORS.green,
          fontSize: 11,
          fontWeight: 'bold',
          letterSpacing: 1.5,
        }}>
          SATELLITES
        </span>
        <span style={{ color: COLORS.muted, fontSize: 9 }}>
          {satellites.filter(s => s.isVisible).length} visible
        </span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 50px 50px',
        gap: 4,
        marginBottom: 4,
      }}>
        <span style={{ color: COLORS.muted, fontSize: 9, letterSpacing: 0.5 }}>NAME</span>
        <span style={{ color: COLORS.muted, fontSize: 9, letterSpacing: 0.5, textAlign: 'right' }}>ALT</span>
        <span style={{ color: COLORS.muted, fontSize: 9, letterSpacing: 0.5, textAlign: 'right' }}>PASS</span>
      </div>

      {/* Satellite rows */}
      {satellites.length === 0 ? (
        <div style={{ color: COLORS.muted, fontSize: 10, textAlign: 'center', padding: 12 }}>
          No satellites tracked
        </div>
      ) : (
        satellites.map((sat) => {
          const passStr = formatNextPass(sat.nextPass);
          const isNow = passStr === 'NOW';
          return (
            <div
              key={sat.position.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 50px 50px',
                gap: 4,
                padding: '4px 0',
                borderBottom: `1px solid ${COLORS.border}`,
                alignItems: 'center',
              }}
            >
              {/* Name + visibility dot */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                <div style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: sat.isVisible ? COLORS.green : COLORS.muted,
                  boxShadow: sat.isVisible ? `0 0 4px ${COLORS.green}` : 'none',
                  flexShrink: 0,
                }} />
                <span style={{
                  color: sat.isVisible ? '#ffffff' : COLORS.text,
                  fontSize: 11,
                  fontWeight: sat.isVisible ? 'bold' : 'normal',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {sat.position.name}
                </span>
              </div>

              {/* Altitude */}
              <span style={{
                color: COLORS.cyan,
                fontSize: 10,
                textAlign: 'right',
              }}>
                {formatAltitude(sat.position.alt)}km
              </span>

              {/* Next pass */}
              <span style={{
                color: isNow ? COLORS.green : COLORS.text,
                fontSize: 10,
                fontWeight: isNow ? 'bold' : 'normal',
                textAlign: 'right',
              }}>
                {passStr}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
};

export default SatellitePanel;
