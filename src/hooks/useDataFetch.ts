import { useEffect, useRef, useCallback } from 'react';
import { useStore } from './useStore';
import type { SolarData, BandConditions, DXSpot, SatellitePosition } from '../types';

// Polling intervals (ms)
const SOLAR_INTERVAL = 5 * 60 * 1000;       // 5 minutes
const BANDS_INTERVAL = 10 * 60 * 1000;      // 10 minutes
const DXSPOTS_INTERVAL = 60 * 1000;         // 60 seconds
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
    const data = await safeFetch<DXSpot[]>('/api/dxspots');
    if (data) setDxSpots(data);
  }, [setDxSpots]);

  const fetchSatellites = useCallback(async () => {
    const data = await safeFetch<SatellitePosition[]>('/api/satellites');
    if (data) setSatellites(data);
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

    timers.current = [
      setInterval(fetchSolar, SOLAR_INTERVAL),
      setInterval(fetchBands, BANDS_INTERVAL),
      setInterval(fetchDxSpots, DXSPOTS_INTERVAL),
      setInterval(fetchSatellites, SATELLITES_INTERVAL),
    ];

    return () => {
      timers.current.forEach(clearInterval);
      timers.current = [];
    };
  }, [refetch, fetchSolar, fetchBands, fetchDxSpots, fetchSatellites]);

  return { refetch };
}
