import { useEffect, useRef, useCallback } from 'react';
import { useStore } from './useStore';
import type { SolarData, BandConditions, PotaSpot, SotaSpot, TLE } from '../types';

// Polling intervals (ms)
const SOLAR_INTERVAL = 5 * 60 * 1000;       // 5 minutes
const BANDS_INTERVAL = 10 * 60 * 1000;      // 10 minutes
const DXSPOTS_INTERVAL = 2 * 60 * 1000;     // 2 minutes
const SATELLITES_INTERVAL = 30 * 1000;      // 30 seconds
const POTA_INTERVAL = 60 * 1000;            // 60 seconds
const SOTA_INTERVAL = 60 * 1000;            // 60 seconds
const TLES_INTERVAL = 30 * 60 * 1000;       // 30 minutes (TLEs change slowly)

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
    setPotaSpots,
    setSotaSpots,
    setSatelliteTles,
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

  const fetchPotaSpots = useCallback(async () => {
    const data = await safeFetch<unknown>('/api/pota/spots');
    if (!Array.isArray(data)) return;
    // Filter/normalize POTA shape — be defensive
    const spots: PotaSpot[] = data
      .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
      .map((d) => ({
        reference: String(d.reference ?? ''),
        parkName: String(d.parkName ?? d.name ?? ''),
        activator: String(d.activator ?? ''),
        spotter: d.spotter ? String(d.spotter) : undefined,
        frequency: String(d.frequency ?? ''),
        mode: String(d.mode ?? ''),
        spotTime: String(d.spotTime ?? ''),
        comments: d.comments ? String(d.comments) : undefined,
      }))
      .filter((s) => s.activator && s.frequency);
    setPotaSpots(spots);
  }, [setPotaSpots]);

  const fetchSotaSpots = useCallback(async () => {
    const data = await safeFetch<unknown>('/api/sota/spots');
    if (!Array.isArray(data)) return;
    const spots: SotaSpot[] = data
      .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
      .map((d) => ({
        id: Number(d.id ?? 0),
        callsign: String(d.callsign ?? d.activatorCallsign ?? ''),
        summitCode: String(d.summitCode ?? ''),
        summitName: String(d.summitName ?? ''),
        associationCode: String(d.associationCode ?? ''),
        frequency: String(d.frequency ?? ''),
        mode: String(d.mode ?? ''),
        timeStamp: String(d.timeStamp ?? ''),
        comments: d.comments ? String(d.comments) : undefined,
      }))
      .filter((s) => s.callsign && s.frequency);
    setSotaSpots(spots);
  }, [setSotaSpots]);

  const fetchSatelliteTles = useCallback(async () => {
    const data = await safeFetch<unknown>('/api/satellites/tles');
    if (!data || typeof data !== 'object') return;
    const obj = data as { tles?: unknown };
    if (!Array.isArray(obj.tles)) return;
    const tles: TLE[] = obj.tles
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map((t) => ({
        name: String(t.name ?? ''),
        line1: String(t.line1 ?? ''),
        line2: String(t.line2 ?? ''),
      }))
      .filter((t) => t.name && t.line1 && t.line2);
    if (tles.length > 0) setSatelliteTles(tles);
  }, [setSatelliteTles]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchSolar(),
        fetchBands(),
        fetchDxSpots(),
        fetchSatellites(),
        fetchPotaSpots(),
        fetchSotaSpots(),
        fetchSatelliteTles(),
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown fetch error');
    } finally {
      setLoading(false);
    }
  }, [fetchSolar, fetchBands, fetchDxSpots, fetchSatellites, fetchPotaSpots, fetchSotaSpots, fetchSatelliteTles, setLoading, setError]);

  useEffect(() => {
    refetch();

    const startTimers = () => {
      timers.current = [
        setInterval(fetchSolar, SOLAR_INTERVAL),
        setInterval(fetchBands, BANDS_INTERVAL),
        setInterval(fetchDxSpots, DXSPOTS_INTERVAL),
        setInterval(fetchSatellites, SATELLITES_INTERVAL),
        setInterval(fetchPotaSpots, POTA_INTERVAL),
        setInterval(fetchSotaSpots, SOTA_INTERVAL),
        setInterval(fetchSatelliteTles, TLES_INTERVAL),
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
