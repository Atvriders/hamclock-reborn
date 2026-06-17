import React from 'react';
import { SolarData } from '../../types';

interface SolarPanelProps {
  className?: string;
  data: SolarData | null;
}

type StatusLevel = 'good' | 'fair' | 'poor';

const StatusChevron: React.FC<{ level: StatusLevel }> = ({ level }) => (
  <span
    className={`ob-status-chevron ob-status-chevron--${level}`}
    aria-label={level.toUpperCase()}
  >
    <span className="ob-status-chevron__seg" />
    <span className="ob-status-chevron__seg" />
    <span className="ob-status-chevron__seg" />
  </span>
);

function sfiLevel(sfi: number): StatusLevel {
  if (sfi > 100) return 'good';
  if (sfi >= 70) return 'fair';
  return 'poor';
}
function kpLevel(kp: number): StatusLevel {
  if (kp <= 3) return 'good';
  if (kp <= 5) return 'fair';
  return 'poor';
}
function aLevel(a: number | undefined): StatusLevel {
  if (a == null) return 'fair';
  if (a > 30) return 'poor';
  if (a > 15) return 'fair';
  return 'good';
}
function xrayLevel(cls: string | undefined): StatusLevel {
  if (!cls) return 'fair';
  const c = cls.charAt(0).toUpperCase();
  if (c === 'A' || c === 'B') return 'good';
  if (c === 'C') return 'good';
  if (c === 'M') return 'fair';
  if (c === 'X') return 'poor';
  return 'fair';
}
function bzLevel(bz: number): StatusLevel {
  if (bz < -5) return 'poor';
  if (bz < 0) return 'fair';
  return 'good';
}
function windLevel(speed: number): StatusLevel {
  if (speed > 500) return 'poor';
  if (speed > 400) return 'fair';
  return 'good';
}
function stormLevel(s: string): StatusLevel {
  if (s === 'None' || s === 'Quiet') return 'good';
  if (s === 'Active') return 'fair';
  return 'poor';
}

const SolarPanel: React.FC<SolarPanelProps> = ({ className, data }) => {
  const ts = data?.timestamp
    ? new Date(data.timestamp).toISOString().slice(11, 16) + 'Z'
    : '';

  return (
    <div className={`ob-panel ob-panel--crosshair ${className ?? ''}`}>
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">Solar / Space Weather</span>
          <span className="ob-panel__head-meta">{ts}</span>
        </div>

        {!data ? (
          <div className="ob-tile-placeholder">Awaiting data...</div>
        ) : (
          <>
            <div className="ob-hero-readout">
              <div className="ob-hero-readout__label">
                <span className="ob-section-label">Solar Flux</span>
                <span className="ob-hero-readout__sub">10.7 cm radio · SFI</span>
              </div>
              <div>
                <span className="ob-hero-readout__num">{data.sfi}</span>
                <span className="ob-hero-readout__unit">sfu</span>
              </div>
            </div>

            <div className="ob-data-row">
              <span className="key">SSN</span>
              <span className="value">{data.ssn}</span>
            </div>

            <div className="ob-data-row">
              <span className="key">X-Ray</span>
              <span className="value">
                <StatusChevron level={xrayLevel(data.xray?.classification)} />
                <span>{data.xray?.classification ?? '—'}</span>
              </span>
            </div>

            <div className="ob-data-row">
              <span className="key">Kp Index</span>
              <span className="value live">
                <StatusChevron level={kpLevel(data.kp)} />
                <span>{data.kp}</span>
              </span>
            </div>

            <div className="ob-data-row">
              <span className="key">A Index</span>
              <span className="value">
                <StatusChevron level={aLevel(data.aIndex)} />
                <span>{data.aIndex ?? '—'}</span>
              </span>
            </div>

            {data.geomagField && (
              <div className="ob-data-row">
                <span className="key">Storm</span>
                <span className="value">
                  <StatusChevron level={stormLevel(data.geomagField.stormLevel)} />
                  <span className={`word word--${stormLevel(data.geomagField.stormLevel)}`}>
                    {data.geomagField.stormLevel}
                  </span>
                </span>
              </div>
            )}

            {data.solarWind && (
              <>
                <div className="ob-data-row">
                  <span className="key">Wind Speed</span>
                  <span className="value">
                    <StatusChevron level={windLevel(data.solarWind.speed)} />
                    <span>{data.solarWind.speed}</span>
                    <span className="unit">km/s</span>
                  </span>
                </div>
                {data.solarWind.bz != null && (
                  <div className="ob-data-row">
                    <span className="key">Bz (IMF)</span>
                    <span className="value">
                      <StatusChevron level={bzLevel(data.solarWind.bz)} />
                      <span>{data.solarWind.bz.toFixed(1)}</span>
                      <span className="unit">nT</span>
                    </span>
                  </div>
                )}
              </>
            )}

            <div className="ob-data-row">
              <span className="key">SFI Status</span>
              <span className="value">
                <StatusChevron level={sfiLevel(data.sfi)} />
                <span className={`word word--${sfiLevel(data.sfi)}`}>
                  {sfiLevel(data.sfi).toUpperCase()}
                </span>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SolarPanel;
