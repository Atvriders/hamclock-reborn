import React, { useState } from 'react';
import { PropagationForecast, SatellitePass } from '../../types';

interface PropagationBarProps {
  forecast: PropagationForecast | null;
  nextPass?: SatellitePass | null;
  grayLineActive?: boolean;
  grayLineSunrise?: string;
  grayLineSunset?: string;
  bandsOpen?: string[];
  onBandSelect?: (band: string | null) => void;
}

const COLORS = {
  bg: '#0a0e14',
  green: '#00ff88',
  amber: '#ffb800',
  red: '#ff4444',
  cyan: '#00d4ff',
  muted: '#4a5568',
  border: '#1a2332',
  text: '#8899aa',
};

const ALL_HF_BANDS = ['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m'];

function conditionColor(cond: string): string {
  switch (cond) {
    case 'Good': return COLORS.green;
    case 'Fair': return COLORS.amber;
    case 'Poor': return COLORS.red;
    default: return COLORS.muted;
  }
}

function geomagColor(forecast: string): string {
  switch (forecast) {
    case 'Quiet': return COLORS.green;
    case 'Unsettled': return COLORS.amber;
    case 'Active': case 'Storm': return COLORS.red;
    default: return COLORS.muted;
  }
}

function formatPassCountdown(aosTime: string): string {
  try {
    const aos = new Date(aosTime);
    const now = new Date();
    const diffMs = aos.getTime() - now.getTime();
    if (diffMs < 0) return 'PAST';
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return `${h}h ${m}m`;
  } catch {
    return '--';
  }
}

const PropagationBar: React.FC<PropagationBarProps> = ({
  forecast,
  nextPass,
  grayLineActive = false,
  grayLineSunrise,
  grayLineSunset,
  bandsOpen = [],
  onBandSelect,
}) => {
  const [selectedBand, setSelectedBand] = useState<string | null>(null);

  const handleBandClick = (band: string) => {
    const newBand = selectedBand === band ? null : band;
    setSelectedBand(newBand);
    onBandSelect?.(newBand);
  };
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: 36,
      background: COLORS.bg,
      borderTop: `1px solid ${COLORS.border}`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 24,
      fontFamily: "'Courier New', Courier, monospace",
      zIndex: 1000,
    }}>
      {/* HF / VHF condition labels */}
      {forecast && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ color: COLORS.muted, fontSize: 10, letterSpacing: 1 }}>HF:</span>
            <span style={{
              color: conditionColor(forecast.hfConditions),
              fontSize: 11,
              fontWeight: 'bold',
            }}>
              {forecast.hfConditions}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ color: COLORS.muted, fontSize: 10, letterSpacing: 1 }}>VHF:</span>
            <span style={{
              color: conditionColor(forecast.vhfConditions),
              fontSize: 11,
              fontWeight: 'bold',
            }}>
              {forecast.vhfConditions}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ color: COLORS.muted, fontSize: 10, letterSpacing: 1 }}>GEO:</span>
            <span style={{
              color: geomagColor(forecast.geomagForecast),
              fontSize: 11,
              fontWeight: 'bold',
            }}>
              {forecast.geomagForecast}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ color: COLORS.muted, fontSize: 10, letterSpacing: 1 }}>MUF:</span>
            <span style={{ color: COLORS.cyan, fontSize: 11, fontWeight: 'bold' }}>
              {forecast.muf.toFixed(1)}
            </span>
            <span style={{ color: COLORS.muted, fontSize: 9 }}>MHz</span>
          </div>
        </>
      )}

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: COLORS.border, flexShrink: 0 }} />

      {/* Band pills */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
        {ALL_HF_BANDS.map((band) => {
          const isOpen = bandsOpen.includes(band);
          const isSelected = selectedBand === band;
          return (
            <button
              key={band}
              onClick={() => handleBandClick(band)}
              title={isOpen ? `${band} — OPEN` : `${band} — CLOSED`}
              style={{
                padding: '2px 6px',
                fontSize: 10,
                fontWeight: 'bold',
                borderRadius: 3,
                color: isSelected
                  ? '#0a0e14'
                  : isOpen ? '#0a0e14' : COLORS.muted,
                background: isSelected
                  ? COLORS.cyan
                  : isOpen ? COLORS.green : 'rgba(74, 85, 104, 0.15)',
                letterSpacing: 0.5,
                transition: 'all 0.2s',
                cursor: 'pointer',
                border: isSelected ? `1px solid ${COLORS.cyan}` : '1px solid transparent',
                boxShadow: isSelected ? `0 0 6px ${COLORS.cyan}` : 'none',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 'inherit',
              }}
            >
              {band}
            </button>
          );
        })}
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: COLORS.border, flexShrink: 0 }} />

      {/* Next satellite pass */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ color: COLORS.muted, fontSize: 10, letterSpacing: 1 }}>NEXT SAT:</span>
        {nextPass ? (
          <>
            <span style={{ color: COLORS.cyan, fontSize: 11, fontWeight: 'bold' }}>
              {nextPass.satellite}
            </span>
            <span style={{ color: COLORS.text, fontSize: 10 }}>
              in {formatPassCountdown(nextPass.aosTime)}
            </span>
            <span style={{ color: COLORS.muted, fontSize: 9 }}>
              ({nextPass.maxElevation}&deg; max)
            </span>
          </>
        ) : (
          <span style={{ color: COLORS.muted, fontSize: 10 }}>--</span>
        )}
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: COLORS.border, flexShrink: 0 }} />

      {/* Gray line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ color: COLORS.muted, fontSize: 10, letterSpacing: 1 }}>GRAYLINE:</span>
        <span style={{
          color: grayLineActive ? COLORS.green : COLORS.muted,
          fontSize: 11,
          fontWeight: 'bold',
        }}>
          {grayLineActive ? 'ACTIVE' : 'INACTIVE'}
        </span>
        {grayLineActive && grayLineSunrise && grayLineSunset && (
          <span style={{ color: COLORS.text, fontSize: 9 }}>
            SR {grayLineSunrise} / SS {grayLineSunset}
          </span>
        )}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Status indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: COLORS.green,
          boxShadow: `0 0 4px ${COLORS.green}`,
        }} />
        <span style={{ color: COLORS.muted, fontSize: 9 }}>LIVE</span>
      </div>
    </div>
  );
};

export default PropagationBar;
