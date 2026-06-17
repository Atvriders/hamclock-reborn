import React, { useEffect, useState } from 'react';
import type { PotaSpot } from '../../types';

interface PotaLiveTileProps {
  spots: PotaSpot[];
}

const MAX_ROWS = 5;

function minutesAgo(iso: string, now: Date): string {
  if (!iso) return '--';
  const t = new Date(iso);
  if (isNaN(t.getTime())) return '--';
  const sec = Math.max(0, Math.floor((now.getTime() - t.getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function formatFreq(khzStr: string): string {
  const khz = parseFloat(khzStr);
  if (isNaN(khz) || khz <= 0) return '--';
  // POTA returns frequency in kHz
  return (khz / 1000).toFixed(3);
}

const PotaLiveTile: React.FC<PotaLiveTileProps> = ({ spots }) => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Sort newest first, take top 5.
  const recent = [...spots]
    .sort((a, b) => {
      const ta = new Date(a.spotTime).getTime() || 0;
      const tb = new Date(b.spotTime).getTime() || 0;
      return tb - ta;
    })
    .slice(0, MAX_ROWS);

  return (
    <div className="ob-panel ob-inst-tile">
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">POTA Live</span>
          <span className="ob-panel__head-meta">{spots.length}</span>
        </div>

        {recent.length === 0 ? (
          <div className="ob-tile-empty">no data</div>
        ) : (
          <div className="ob-spot-list">
            {recent.map((s, idx) => (
              <div key={`${s.activator}-${s.reference}-${idx}`} className="ob-spot-row">
                <span className="ob-spot-row__time">{minutesAgo(s.spotTime, now)}</span>
                <span className="ob-spot-row__main">
                  <span className="ob-spot-row__act">{s.activator}</span>
                  <span className="ob-spot-row__ref">
                    {s.reference}
                    {s.mode ? ` · ${s.mode}` : ''}
                  </span>
                </span>
                <span className="ob-spot-row__freq">{formatFreq(s.frequency)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PotaLiveTile;
