import React from 'react';
import { BandConditions, ConditionLevel, BandName } from '../../types';

interface BandPanelProps {
  className?: string;
  data: BandConditions | null;
}

const DISPLAY_BANDS: BandName[] = [
  '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m',
];

type Level = 'good' | 'fair' | 'poor';

function levelClass(cond: ConditionLevel): Level {
  switch (cond) {
    case 'Good': return 'good';
    case 'Fair': return 'fair';
    case 'Poor': return 'poor';
  }
}

function findCondition(
  conditions: Record<string, { day: string; night: string }>,
  band: BandName,
  tod: 'day' | 'night',
): ConditionLevel {
  const entry = conditions[band];
  if (!entry) return 'Poor';
  const val = tod === 'day' ? entry.day : entry.night;
  if (val === 'Good' || val === 'Fair' || val === 'Poor') return val;
  return 'Poor';
}

const StatusChevron: React.FC<{ level: Level }> = ({ level }) => (
  <span
    className={`ob-status-chevron ob-status-chevron--${level}`}
    aria-label={level.toUpperCase()}
  >
    <span className="ob-status-chevron__seg" />
    <span className="ob-status-chevron__seg" />
    <span className="ob-status-chevron__seg" />
  </span>
);

const BandPanel: React.FC<BandPanelProps> = ({ className, data }) => {
  const conditions = data?.conditions ?? {};

  return (
    <div className={`ob-panel ${className ?? ''}`}>
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">HF Band Matrix</span>
          {data?.signalNoise && (
            <span className="ob-panel__head-meta">SN {data.signalNoise}</span>
          )}
        </div>

        <div className="ob-band-row__headings">
          <span className="ob-band-row__heading">Band</span>
          <span className="ob-band-row__heading">Day</span>
          <span className="ob-band-row__heading">Night</span>
        </div>

        <div className="ob-band-list">
          {DISPLAY_BANDS.map((band) => {
            const dayC = findCondition(conditions, band, 'day');
            const nightC = findCondition(conditions, band, 'night');
            return (
              <div key={band} className="ob-band-row">
                <span className="ob-band-row__name">{band}</span>
                <span className="ob-band-row__slot">
                  <StatusChevron level={levelClass(dayC)} />
                  <span className={`ob-band-row__slot-label`} aria-label={dayC}>
                    {dayC}
                  </span>
                </span>
                <span className="ob-band-row__slot">
                  <StatusChevron level={levelClass(nightC)} />
                  <span className={`ob-band-row__slot-label`} aria-label={nightC}>
                    {nightC}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        {data?.timestamp && (
          <div className="ob-panel__foot">
            {new Date(data.timestamp).toISOString().slice(11, 16)}Z
          </div>
        )}
      </div>
    </div>
  );
};

export default BandPanel;
