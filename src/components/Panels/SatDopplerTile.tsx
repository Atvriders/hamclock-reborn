import React, { useEffect, useMemo, useState } from 'react';
import type { TLE } from '../../types';
import {
  formatUtcHHMM,
  isInPass,
  predictUpcomingPasses,
  type SatPass,
} from '../../utils/satpass';

interface SatDopplerTileProps {
  tles: TLE[];
  userLat: number;
  userLng: number;
  hasLocation: boolean;
}

const MAX_PASSES = 6;

const SatDopplerTile: React.FC<SatDopplerTileProps> = ({
  tles,
  userLat,
  userLng,
  hasLocation,
}) => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Re-predict every 60s — anchored on now's 60-second bucket.
  const predictionAnchor = Math.floor(now.getTime() / 60_000);

  const passes = useMemo<SatPass[]>(() => {
    if (!hasLocation || tles.length === 0) return [];
    try {
      return predictUpcomingPasses(tles, userLat, userLng, MAX_PASSES, 6);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tles, userLat, userLng, hasLocation, predictionAnchor]);

  const renderEmpty = (msg: string) => (
    <div className="ob-panel ob-inst-tile">
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">Sat Timeline · 6H</span>
        </div>
        <div className="ob-tile-empty">{msg}</div>
      </div>
    </div>
  );

  if (!hasLocation) return renderEmpty('set callsign to compute passes');
  if (tles.length === 0) return renderEmpty('awaiting TLEs');
  if (passes.length === 0) return renderEmpty('no passes in next 6h');

  return (
    <div className="ob-panel ob-inst-tile">
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">Sat Timeline · 6H</span>
          <span className="ob-panel__head-meta">{passes.length}</span>
        </div>

        <div className="ob-sat-timeline">
          <div className="ob-sat-timeline__pills">
            {passes.map((p, i) => {
              const live = isInPass(p, now);
              return (
                <div key={`${p.name}-${i}`} className="ob-sat-pass">
                  <span className="ob-sat-pass__t">{formatUtcHHMM(p.aos)}Z</span>
                  <span
                    className={`ob-sat-pass__name${live ? ' ob-sat-pass__name--live' : ''}`}
                  >
                    {p.name}
                  </span>
                  <span className="ob-sat-pass__el">
                    {Math.round(p.maxElevation)}°
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SatDopplerTile;
