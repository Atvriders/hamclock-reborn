import React, { useState, useEffect } from 'react';
import { solarElevation } from '../../utils/solar';

interface PropagationBarProps {
  userLat?: number;
  userLng?: number;
  bandsOpen?: string[];
  onBandSelect?: (band: string | null) => void;
}

const ALL_HF_BANDS = ['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m'];

const BAND_FREQ_MAP: Record<string, string> = {
  '80m': '3.5',
  '40m': '7.0',
  '30m': '10.1',
  '20m': '14.0',
  '17m': '18.0',
  '15m': '21.0',
  '12m': '24.9',
  '10m': '28.0',
  '6m': '50.0',
};

const PropagationBar: React.FC<PropagationBarProps> = ({
  userLat,
  userLng,
  bandsOpen = [],
  onBandSelect,
}) => {
  const [selectedBand, setSelectedBand] = useState<string | null>(null);
  const [grayLineActive, setGrayLineActive] = useState(false);

  // Check if QTH is in the gray line zone (solar elevation between 0° and -6°)
  useEffect(() => {
    const check = () => {
      if (userLat == null || userLng == null) return;
      const elev = solarElevation(userLat, userLng, new Date());
      setGrayLineActive(elev <= 0 && elev >= -6);
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [userLat, userLng]);

  const handleBandClick = (band: string) => {
    const newBand = selectedBand === band ? null : band;
    setSelectedBand(newBand);
    onBandSelect?.(newBand);
  };

  return (
    <div style={{
      height: '100%',
      background: '#080c12',
      borderTop: '1px solid #1a2332',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      gap: 0,
    }}>
      {/* Left section — spacer to balance the right section */}
      <div style={{
        flex: '0 0 120px',
        display: 'flex',
        alignItems: 'center',
      }}>
        <span style={{
          color: '#2a3a4f',
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}>
          HF BANDS
        </span>
      </div>

      {/* Center section — band pills, centered */}
      <div style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 3,
      }}>
        {ALL_HF_BANDS.map((band) => {
          const isOpen = bandsOpen.includes(band);
          const isSelected = selectedBand === band;
          return (
            <button
              key={band}
              onClick={() => handleBandClick(band)}
              title={`${band} ${BAND_FREQ_MAP[band]} MHz — ${isOpen ? 'OPEN' : 'CLOSED'}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: 18,
                padding: '0 5px',
                fontSize: 9,
                fontWeight: 700,
                borderRadius: 4,
                color: isSelected
                  ? '#00d4ff'
                  : isOpen ? '#00ff88' : '#3a4555',
                background: isSelected
                  ? 'rgba(0,212,255,0.08)'
                  : 'transparent',
                letterSpacing: 0.3,
                transition: 'all 0.15s',
                cursor: 'pointer',
                border: isSelected
                  ? '1px solid #00d4ff'
                  : '1px solid transparent',
                boxShadow: isSelected
                  ? '0 0 6px rgba(0,212,255,0.4)'
                  : 'none',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1,
              }}
            >
              <span>{band}</span>
              <span style={{
                fontSize: 6,
                opacity: 0.5,
                fontWeight: 400,
                marginTop: -1,
                lineHeight: 1,
              }}>
                {BAND_FREQ_MAP[band]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Right section — Grayline status + LIVE indicator */}
      <div style={{
        flex: '0 0 120px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            color: '#4a5568',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: 0.8,
          }}>
            GRAYLINE:
          </span>
          <span style={{
            color: grayLineActive ? '#00ff88' : '#3a4555',
            fontSize: 9,
            fontWeight: 700,
          }}>
            {grayLineActive ? 'ACTIVE' : 'OFF'}
          </span>
        </div>

        {/* Separator dot */}
        <div style={{
          width: 2,
          height: 2,
          borderRadius: '50%',
          background: '#2a3a4f',
          flexShrink: 0,
        }} />

        {/* LIVE indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: '#00ff88',
            boxShadow: '0 0 4px rgba(0,255,136,0.6)',
            animation: 'pulse-live 2s ease-in-out infinite',
          }} />
          <span style={{
            color: '#4a5568',
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: 0.8,
          }}>
            LIVE
          </span>
        </div>
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse-live {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};

export default PropagationBar;
