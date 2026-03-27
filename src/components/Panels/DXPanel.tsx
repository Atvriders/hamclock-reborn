import React from 'react';
import { DXSpot } from '../../types';

interface DXPanelProps {
  spots: DXSpot[];
  onSpotClick?: (spot: DXSpot) => void;
}

const BAND_COLORS: Record<string, string> = {
  '160m': '#ff6b9d',
  '80m':  '#ff6b6b',
  '40m':  '#ffa07a',
  '30m':  '#ffd700',
  '20m':  '#00ff88',
  '17m':  '#00d4ff',
  '15m':  '#7b68ee',
  '12m':  '#da70d6',
  '10m':  '#ff69b4',
  '6m':   '#e879f9',
  '2m':   '#2dd4bf',
};

function getBandColor(band: string): string {
  return BAND_COLORS[band] || '#8899aa';
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
  if (khz >= 1000) return (khz / 1000).toFixed(3) + ' MHz';
  return khz.toFixed(3) + ' kHz';
}

const scrollbarCSS = `
.dx-panel-scroll::-webkit-scrollbar { width: 4px; }
.dx-panel-scroll::-webkit-scrollbar-track { background: transparent; }
.dx-panel-scroll::-webkit-scrollbar-thumb { background: #1a2332; border-radius: 2px; }
.dx-panel-scroll::-webkit-scrollbar-thumb:hover { background: #2a3a4f; }
`;

const DXPanel: React.FC<DXPanelProps> = ({ spots, onSpotClick }) => {
  const sortedSpots = [...spots].sort((a, b) =>
    new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  return (
    <>
      <style>{scrollbarCSS}</style>
      <div style={{
        width: '100%',
        background: '#0d1117',
        borderLeft: '1px solid #1a2332',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
        boxSizing: 'border-box',
        flex: 1,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 8px',
          borderBottom: '1px solid #1a2332',
          flexShrink: 0,
        }}>
          <span style={{
            color: '#ffffff',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}>
            DX Cluster
          </span>
          <span style={{
            color: '#4a5568',
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}>
            2m
          </span>
          <span style={{
            background: '#1a2332',
            color: '#8899aa',
            fontSize: 9,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 8,
            minWidth: 18,
            textAlign: 'center',
          }}>
            {spots.length}
          </span>
        </div>

        {/* Spot list */}
        <div className="dx-panel-scroll" style={{
          flex: 1,
          overflowY: 'auto',
          padding: '2px 0',
        }}>
          {sortedSpots.length === 0 ? (
            <div style={{
              color: '#4a5568',
              fontSize: 10,
              textAlign: 'center',
              padding: '20px 8px',
              fontStyle: 'italic',
            }}>
              No spots received
            </div>
          ) : (
            sortedSpots.map((spot) => (
              <div
                key={spot.id}
                onClick={() => onSpotClick?.(spot)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 20,
                  padding: '0 8px',
                  cursor: onSpotClick ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                }}
              >
                {/* Frequency */}
                <span style={{
                  color: getBandColor(spot.band),
                  fontSize: 10,
                  fontWeight: 600,
                  width: 72,
                  textAlign: 'right',
                  flexShrink: 0,
                }}>
                  {formatFrequency(spot.frequency)}
                </span>

                {/* Band */}
                <span style={{
                  fontSize: 7,
                  fontWeight: 700,
                  color: getBandColor(spot.band),
                  background: `${getBandColor(spot.band)}18`,
                  padding: '1px 4px',
                  borderRadius: 6,
                  letterSpacing: 0.3,
                  flexShrink: 0,
                  lineHeight: '12px',
                  minWidth: 22,
                  textAlign: 'center',
                }}>
                  {spot.band}
                </span>

                {/* DX Callsign */}
                <span style={{
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: 700,
                  width: 58,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}>
                  {spot.dx}
                </span>

                {/* Spotter */}
                <span style={{
                  color: '#4a5568',
                  fontSize: 9,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}>
                  de {spot.spotter}
                </span>

                {/* Mode badge */}
                {spot.mode && (
                  <span style={{
                    fontSize: 7,
                    fontWeight: 700,
                    color: '#8899aa',
                    background: 'rgba(136,153,170,0.12)',
                    padding: '1px 4px',
                    borderRadius: 6,
                    letterSpacing: 0.3,
                    flexShrink: 0,
                    lineHeight: '12px',
                  }}>
                    {spot.mode}
                  </span>
                )}

                {/* Time */}
                <span style={{
                  color: '#4a5568',
                  fontSize: 9,
                  flexShrink: 0,
                  width: 30,
                  textAlign: 'right',
                }}>
                  {formatSpotTime(spot.time)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default DXPanel;
