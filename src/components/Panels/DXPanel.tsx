import React, { useMemo } from 'react';
import { DXSpot } from '../../types';

interface DXPanelProps {
  className?: string;
  spots: DXSpot[];
  onSpotClick?: (spot: DXSpot) => void;
  maxRows?: number;
}

function formatSpotTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
  } catch {
    return '----';
  }
}

function formatFrequency(khz: number): string {
  if (khz >= 1000) return (khz / 1000).toFixed(3) + ' MHz';
  return khz.toFixed(1) + ' kHz';
}

const DXPanel: React.FC<DXPanelProps> = ({
  className,
  spots,
  onSpotClick,
  maxRows = 12,
}) => {
  const sortedSpots = useMemo(() => {
    return [...spots]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, maxRows);
  }, [spots, maxRows]);

  return (
    <div className={`ob-panel ${className ?? ''}`}>
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">DX Stream</span>
          <span className="ob-panel__head-meta">
            {sortedSpots.length} / {spots.length} spots
          </span>
        </div>

        <div className="ob-dx-headings">
          <span>Time</span>
          <span>Freq</span>
          <span>DX</span>
          <span>Mode</span>
          <span>Spotter</span>
        </div>

        <div className="ob-dx-list">
          {sortedSpots.length === 0 ? (
            <div className="ob-dx-empty">No spots received</div>
          ) : (
            sortedSpots.map((spot) => (
              <div
                key={spot.id}
                className="ob-dx-row ob-selectable"
                onClick={() => onSpotClick?.(spot)}
              >
                <span className="ob-dx-row__time">{formatSpotTime(spot.time)}</span>
                <span className="ob-dx-row__freq">{formatFrequency(spot.frequency)}</span>
                <span className="ob-dx-row__call">{spot.dx}</span>
                <span className="ob-dx-row__mode">{spot.mode || spot.band}</span>
                <span className="ob-dx-row__spotter">{spot.spotter}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default DXPanel;
