import React, { useEffect, useMemo, useState } from 'react';
import type { TLE } from '../../types';
import {
  formatCountdown,
  formatUtcHHMM,
  predictUpcomingPasses,
  type SatPass,
} from '../../utils/satpass';

interface NextPassTileProps {
  tles: TLE[];
  userLat: number;
  userLng: number;
  hasLocation: boolean;
}

const NextPassTile: React.FC<NextPassTileProps> = ({
  tles,
  userLat,
  userLng,
  hasLocation,
}) => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Re-predict every 30s — anchored on now's 30-second bucket.
  const predictionAnchor = Math.floor(now.getTime() / 30_000);

  const passes = useMemo<SatPass[]>(() => {
    if (!hasLocation || tles.length === 0) return [];
    try {
      return predictUpcomingPasses(tles, userLat, userLng, 1, 6);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tles, userLat, userLng, hasLocation, predictionAnchor]);

  const pass = passes[0];

  const renderEmpty = (msg: string) => (
    <div className="ob-panel ob-inst-tile">
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">Next Pass</span>
        </div>
        <div className="ob-tile-empty">{msg}</div>
      </div>
    </div>
  );

  if (!hasLocation) return renderEmpty('set callsign to compute passes');
  if (tles.length === 0) return renderEmpty('awaiting TLEs');
  if (!pass) return renderEmpty('no passes in next 6h');

  // SVG arc — quarter-circle horizon-to-peak-to-horizon, indicates max-el.
  // Peak height scales with maxElevation (0-90 mapped to 0.1-0.9 of height).
  const peakFrac = Math.max(0.1, Math.min(0.9, pass.maxElevation / 90));

  return (
    <div className="ob-panel ob-inst-tile">
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">Next Pass</span>
          <span className="ob-panel__head-meta">{formatUtcHHMM(pass.aos)}Z</span>
        </div>

        <div className="ob-pass-hero">
          <div className="ob-pass-hero__name ob-amber-live">{pass.name}</div>
        </div>

        <div className="ob-pass-stats">
          <div className="ob-pass-stat">
            <span className="ob-pass-stat__key">AOS</span>
            <span className="ob-pass-stat__val ob-pass-stat__val--live">
              {formatCountdown(pass.aos, now)}
            </span>
          </div>
          <div className="ob-pass-stat">
            <span className="ob-pass-stat__key">LOS</span>
            <span className="ob-pass-stat__val">
              {formatCountdown(pass.los, now)}
            </span>
          </div>
          <div className="ob-pass-stat">
            <span className="ob-pass-stat__key">Max El</span>
            <span className="ob-pass-stat__val">
              {Math.round(pass.maxElevation)}°
            </span>
          </div>
          <div className="ob-pass-stat">
            <span className="ob-pass-stat__key">Az</span>
            <span className="ob-pass-stat__val">
              {String(Math.round(pass.aosAzimuth)).padStart(3, '0')}
              →{String(Math.round(pass.losAzimuth)).padStart(3, '0')}
            </span>
          </div>
        </div>

        <div className="ob-pass-arc">
          <svg
            className="ob-pass-arc__svg"
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            aria-label={`Pass arc, max ${Math.round(pass.maxElevation)} degrees`}
          >
            {/* Horizon line */}
            <line
              className="ob-pass-arc__horizon"
              x1="0"
              y1="38"
              x2="100"
              y2="38"
            />
            {/* Arc — quadratic Bezier from (0,38) → peak → (100,38) */}
            <path
              className="ob-pass-arc__curve"
              d={`M 0 38 Q 50 ${38 - peakFrac * 36} 100 38`}
            />
          </svg>
        </div>
      </div>
    </div>
  );
};

export default NextPassTile;
