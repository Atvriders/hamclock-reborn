import React, { useState, useEffect } from 'react';
import { solarElevation } from '../../utils/solar';

interface PropagationBarProps {
  className?: string;
  userLat?: number;
  userLng?: number;
  bandsOpen?: string[];
  onBandSelect?: (band: string | null) => void;
}

// 9 HF bands per spec (160 → 6m).
const ALL_HF_BANDS = ['160m', '80m', '40m', '20m', '17m', '15m', '12m', '10m', '6m'];

const BAND_FREQ_MAP: Record<string, string> = {
  '160m': '1.8',
  '80m': '3.5',
  '40m': '7.0',
  '20m': '14.0',
  '17m': '18.0',
  '15m': '21.0',
  '12m': '24.9',
  '10m': '28.0',
  '6m': '50.0',
};

const PropagationBar: React.FC<PropagationBarProps> = ({
  className,
  userLat,
  userLng,
  bandsOpen = [],
  onBandSelect,
}) => {
  const [selectedBand, setSelectedBand] = useState<string | null>(null);
  const [grayLineActive, setGrayLineActive] = useState(false);

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
    const next = selectedBand === band ? null : band;
    setSelectedBand(next);
    onBandSelect?.(next);
  };

  return (
    <div className={`ob-panel ob-rail ${className ?? ''}`}>
      <span className="ob-rail__legend">HF Bands</span>

      <div className="ob-rail__pills">
        {ALL_HF_BANDS.map((band) => {
          const isOpen = bandsOpen.includes(band);
          const isSelected = selectedBand === band;
          const stateClass = isSelected
            ? 'ob-pill--selected'
            : isOpen
              ? 'ob-pill--on'
              : 'ob-pill--off';
          return (
            <button
              key={band}
              className={`ob-pill ${stateClass}`}
              onClick={() => handleBandClick(band)}
              aria-pressed={isSelected}
            >
              <span className="ob-pill__band">{band}</span>
              <span className="ob-pill__band">{BAND_FREQ_MAP[band]} MHz</span>
              <span className="ob-pill__state">{isOpen ? 'ON' : 'OFF'}</span>
            </button>
          );
        })}
      </div>

      <div className="ob-rail__status">
        <span>Greyline</span>
        <span
          className={`ob-rail__status-value ${grayLineActive ? 'ob-rail__status-value--on' : 'ob-rail__status-value--off'}`}
        >
          {grayLineActive ? 'ACTIVE' : 'OFF'}
        </span>
        <span>·</span>
        <span>Stream</span>
        <span className="ob-rail__status-value ob-rail__status-value--on">LIVE</span>
      </div>
    </div>
  );
};

export default PropagationBar;
