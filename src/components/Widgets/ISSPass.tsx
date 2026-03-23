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
  nextPass?: null;
}

interface ISSPassProps {
  userLat: number;
  userLng: number;
}

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

function azToCompass(az: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(az / 22.5) % 16];
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function formatUtcTime(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(11, 19) + ' UTC';
}

function elevationColor(el: number): string {
  if (el >= 45) return '#00ff88';
  if (el >= 20) return '#ffaa00';
  return '#ff4444';
}

function qualityBar(el: number): string {
  // 0-90 degrees mapped to 1-5 blocks
  const blocks = Math.max(1, Math.min(5, Math.ceil(el / 18)));
  return '\u2588'.repeat(blocks) + '\u2591'.repeat(5 - blocks);
}

function computeCountdown(aosIso: string): string {
  const now = Date.now();
  const aos = new Date(aosIso).getTime();
  const diff = Math.max(0, Math.floor((aos - now) / 1000));
  if (diff <= 0) return 'NOW';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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
      const json: ISSPassData = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userLat, userLng]);

  // Initial fetch + refresh interval
  useEffect(() => {
    fetchPass();
    const id = setInterval(fetchPass, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchPass]);

  // Countdown timer (every second)
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

  const hasPass = data && data.aosTime && data.nextPass === undefined;

  return (
    <div style={{
      padding: '10px 14px',
      fontFamily: "'Courier New', Courier, monospace",
      background: '#0d1117',
      color: '#e0e0e0',
      fontSize: 11,
    }}>
      {/* Header */}
      <div style={{
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 2,
        marginBottom: 8,
        paddingBottom: 6,
        borderBottom: '1px solid #1a2332',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>NEXT ISS PASS</span>
        <span
          onClick={fetchPass}
          style={{ fontSize: 10, color: '#4a5568', cursor: 'pointer' }}
          title="Refresh"
        >
          {'\u21BB'}
        </span>
      </div>

      {loading && !data && (
        <div style={{ color: '#4a5568', fontStyle: 'italic', padding: '8px 0' }}>
          Calculating...
        </div>
      )}

      {!loading && !hasPass && (
        <div style={{ color: '#4a5568', fontStyle: 'italic', padding: '8px 0' }}>
          No pass in 24h
        </div>
      )}

      {hasPass && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Countdown */}
          <div style={{
            fontSize: 16,
            fontWeight: 'bold',
            color: '#00d4ff',
            textAlign: 'center',
            padding: '4px 0',
          }}>
            In {countdown}
          </div>

          {/* AOS time */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#4a5568' }}>AOS</span>
            <span>{formatUtcTime(data!.aosTime!)}</span>
          </div>

          {/* Max elevation */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#4a5568' }}>MAX EL</span>
            <span style={{ color: elevationColor(data!.maxElevation!) }}>
              {data!.maxElevation}&deg;
            </span>
          </div>

          {/* Duration */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#4a5568' }}>DUR</span>
            <span>{formatDuration(data!.duration!)}</span>
          </div>

          {/* Direction */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#4a5568' }}>DIR</span>
            <span>
              {azToCompass(data!.aosAzimuth!)} {'\u2192'} {azToCompass(data!.losAzimuth!)}
            </span>
          </div>

          {/* Quality bar */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ color: '#4a5568' }}>QUAL</span>
            <span style={{
              color: elevationColor(data!.maxElevation!),
              letterSpacing: 2,
              fontSize: 10,
            }}>
              {qualityBar(data!.maxElevation!)}
            </span>
          </div>
        </div>
      )}

      <div style={{ fontSize: 9, color: '#4a5568', marginTop: 6 }}>
        Source: CelesTrak TLE
      </div>
    </div>
  );
};

export default ISSPass;
