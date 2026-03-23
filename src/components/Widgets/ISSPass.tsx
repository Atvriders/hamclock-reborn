import React, { useState, useEffect, useRef, useCallback } from 'react';

interface ISSPassData {
  name: string;
  aosTime?: string;
  losTime?: string;
  maxElevation?: number;
  duration?: number;
  aosAzimuth?: number;
  losAzimuth?: number;
  countdown?: string;
}

interface ISSPassProps {
  userLat: number;
  userLng: number;
}

const REFRESH_INTERVAL = 5 * 60 * 1000;

function azToCompass(az: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(az / 22.5) % 16];
}

function computeCountdown(aosIso: string): string {
  const now = Date.now();
  const aos = new Date(aosIso).getTime();
  const diff = Math.max(0, Math.floor((aos - now) / 1000));
  if (diff <= 0) return 'NOW';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const ISSPass: React.FC<ISSPassProps> = ({ userLat, userLng }) => {
  const [data, setData] = useState<ISSPassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPass = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/iss-pass?lat=${userLat}&lng=${userLng}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ISSPassData = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userLat, userLng]);

  useEffect(() => {
    fetchPass();
    const id = setInterval(fetchPass, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchPass]);

  useEffect(() => {
    if (data?.aosTime) {
      setCountdown(computeCountdown(data.aosTime));
      timerRef.current = setInterval(() => {
        setCountdown(computeCountdown(data.aosTime!));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [data]);

  const hasPass = data && data.aosTime;
  const durMin = data?.duration ? Math.floor(data.duration / 60) : 0;

  return (
    <div style={{
      padding: '6px 10px',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      background: '#0d1117',
      boxSizing: 'border-box',
    }}>
      {loading && !data && (
        <div style={{ color: '#4a5568', fontSize: 10, fontStyle: 'italic' }}>
          ISS: Calculating...
        </div>
      )}

      {!loading && !hasPass && (
        <div style={{
          color: '#4a5568',
          fontSize: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 20,
        }}>
          <span style={{ color: '#8899aa', fontWeight: 700, fontSize: 10 }}>ISS</span>
          <span>No pass in 24h</span>
        </div>
      )}

      {hasPass && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Top line: ISS label + countdown */}
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          }}>
            <span style={{
              color: '#8899aa',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
            }}>
              ISS
            </span>
            <span style={{
              color: '#00d4ff',
              fontSize: 14,
              fontWeight: 700,
            }}>
              In {countdown}
            </span>
          </div>

          {/* Detail line: Max El + direction + duration */}
          <div style={{
            color: '#4a5568',
            fontSize: 9,
            display: 'flex',
            gap: 4,
          }}>
            <span>
              Max El: <span style={{ color: '#8899aa', fontFamily: 'inherit' }}>{data!.maxElevation}&deg;</span>
            </span>
            <span style={{ color: '#2a3a4f' }}>|</span>
            <span>
              {azToCompass(data!.aosAzimuth!)}&rarr;{azToCompass(data!.losAzimuth!)}
            </span>
            <span style={{ color: '#2a3a4f' }}>|</span>
            <span>{durMin}min</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ISSPass;
