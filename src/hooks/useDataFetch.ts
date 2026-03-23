import { useEffect, useRef, useCallback } from 'react';
import { useStore } from './useStore';
import type { SolarData, BandConditions, DXSpot, SatellitePosition } from '../types';

// Polling intervals (ms)
const SOLAR_INTERVAL = 5 * 60 * 1000;       // 5 minutes
const BANDS_INTERVAL = 10 * 60 * 1000;      // 10 minutes
const DXSPOTS_INTERVAL = 2 * 60 * 1000;     // 2 minutes
const SATELLITES_INTERVAL = 30 * 1000;      // 30 seconds

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useDataFetch() {
  const {
    setSolar,
    setBands,
    setDxSpots,
    setSatellites,
    setLoading,
    setError,
  } = useStore();

  const timers = useRef<ReturnType<typeof setInterval>[]>([]);

  const fetchSolar = useCallback(async () => {
    const data = await safeFetch<SolarData>('/api/solar');
    if (data) setSolar(data);
  }, [setSolar]);

  const fetchBands = useCallback(async () => {
    const data = await safeFetch<BandConditions>('/api/bands');
    if (data) setBands(data);
  }, [setBands]);

  const fetchDxSpots = useCallback(async () => {
    const data = await safeFetch<any>('/api/dxspots');
    if (!data) return;
    // Server may return array directly or { spots: [...] }
    const spots = Array.isArray(data) ? data : (data.spots ?? []);
    if (spots.length > 0) setDxSpots(spots);
  }, [setDxSpots]);

  const fetchSatellites = useCallback(async () => {
    const data = await safeFetch<any>('/api/satellites');
    if (!data) return;
    // Server may return { satellites: [...] } or array
    const sats = Array.isArray(data) ? data : (data.satellites ?? []);
    if (sats.length > 0) setSatellites(sats);
  }, [setSatellites]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchSolar(),
        fetchBands(),
        fetchDxSpots(),
        fetchSatellites(),
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown fetch error');
    } finally {
      setLoading(false);
    }
  }, [fetchSolar, fetchBands, fetchDxSpots, fetchSatellites, setLoading, setError]);

  useEffect(() => {
    refetch();

    const startTimers = () => {
      timers.current = [
        setInterval(fetchSolar, SOLAR_INTERVAL),
        setInterval(fetchBands, BANDS_INTERVAL),
        setInterval(fetchDxSpots, DXSPOTS_INTERVAL),
        setInterval(fetchSatellites, SATELLITES_INTERVAL),
      ];
    };

    const stopTimers = () => {
      timers.current.forEach(clearInterval);
      timers.current = [];
    };

    // Pause polling when tab is hidden, resume when visible
    const handleVisibility = () => {
      if (document.hidden) {
        stopTimers();
      } else {
        refetch(); // fetch fresh data when tab becomes visible
        startTimers();
      }
    };

    startTimers();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopTimers();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { refetch };
}
