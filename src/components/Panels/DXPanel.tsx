import React from 'react';
import { DXSpot } from '../../types';

interface DXPanelProps {
  spots: DXSpot[];
  onSpotClick?: (spot: DXSpot) => void;
}

const COLORS = {
  bgPanel: '#0d1117',
  green: '#00ff88',
  muted: '#4a5568',
  border: '#1a2332',
  text: '#8899aa',
};

const BAND_COLORS: Record<string, string> = {
  '160m': '#ff6b9d',
  '80m':  '#c084fc',
  '40m':  '#60a5fa',
  '30m':  '#22d3ee',
  '20m':  '#34d399',
  '17m':  '#a3e635',
  '15m':  '#fbbf24',
  '12m':  '#fb923c',
  '10m':  '#f87171',
  '6m':   '#e879f9',
  '2m':   '#2dd4bf',
};

function getBandColor(band: string): string {
  return BAND_COLORS[band] || COLORS.text;
}

function formatSpotTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  } catch {
    return '--:--';
  }
}

function formatFrequency(khz: number): string {
  if (khz >= 1000) return (khz / 1000).toFixed(1);
  return khz.toFixed(1);
}

const DXPanel: React.FC<DXPanelProps> = ({ spots, onSpotClick }) => {
  const sortedSpots = [...spots].sort((a, b) =>
    new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  return (
    <div style={{
      width: 220,
      background: COLORS.bgPanel,
      borderLeft: `1px solid ${COLORS.border}`,
      borderTop: `1px solid ${COLORS.border}`,
      padding: '12px 10px',
      fontFamily: "'Courier New', Courier, monospace",
      boxSizing: 'border-box',
      overflowY: 'auto',
      flex: 1,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
        paddingBottom: 6,
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <span style={{
          color: COLORS.green,
          fontSize: 11,
          fontWeight: 'bold',
          letterSpacing: 1.5,
        }}>
          DX CLUSTER
        </span>
        <span style={{ color: COLORS.muted, fontSize: 10 }}>
          {spots.length} spots
        </span>
      </div>

      {/* Spot list */}
      {sortedSpots.length === 0 ? (
        <div style={{ color: COLORS.muted, fontSize: 11, textAlign: 'center', padding: 20 }}>
          No spots received
        </div>
      ) : (
        sortedSpots.map((spot) => (
          <div
            key={spot.id}
            onClick={() => onSpotClick?.(spot)}
            style={{
              padding: '6px 4px',
              borderBottom: `1px solid ${COLORS.border}`,
              cursor: onSpotClick ? 'pointer' : 'default',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'rgba(0, 255, 136, 0.05)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'transparent';
            }}
          >
            {/* Row 1: Freq + Callsign + Time */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{
                  color: getBandColor(spot.band),
                  fontSize: 10,
                  minWidth: 46,
                }}>
                  {formatFrequency(spot.frequency)}
                </span>
                <span style={{
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 'bold',
                  letterSpacing: 0.5,
                }}>
                  {spot.dx}
                </span>
              </div>
              <span style={{ color: COLORS.muted, fontSize: 9 }}>
                {formatSpotTime(spot.time)}
              </span>
            </div>

            {/* Row 2: Spotter + Mode + Comment */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 2,
            }}>
              <span style={{ color: COLORS.text, fontSize: 9 }}>
                de {spot.spotter}
              </span>
              {spot.comment && (
                <span style={{
                  color: COLORS.muted,
                  fontSize: 9,
                  maxWidth: 100,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {spot.comment}
                </span>
              )}
            </div>

            {/* Band + mode badges */}
            <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
              <span style={{
                display: 'inline-block',
                padding: '0 4px',
                fontSize: 8,
                fontWeight: 'bold',
                color: getBandColor(spot.band),
                background: `${getBandColor(spot.band)}15`,
                borderRadius: 2,
                letterSpacing: 0.5,
              }}>
                {spot.band}
              </span>
              {spot.mode && (
                <span style={{
                  display: 'inline-block',
                  padding: '0 4px',
                  fontSize: 8,
                  color: COLORS.muted,
                  background: 'rgba(74, 85, 104, 0.15)',
                  borderRadius: 2,
                }}>
                  {spot.mode}
                </span>
              )}
              {spot.dxcc && (
                <span style={{
                  display: 'inline-block',
                  padding: '0 4px',
                  fontSize: 8,
                  color: COLORS.text,
                  background: 'rgba(136, 153, 170, 0.1)',
                  borderRadius: 2,
                }}>
                  {spot.dxcc}
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default DXPanel;
