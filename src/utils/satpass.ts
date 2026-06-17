import * as satellite from 'satellite.js';
import type { TLE } from '../types';

export interface SatPass {
  name: string;
  aos: Date;
  los: Date;
  maxElevation: number;   // degrees
  aosAzimuth: number;     // degrees 0-360
  losAzimuth: number;     // degrees 0-360
}

const TWO_PI = Math.PI * 2;
const RAD2DEG = 180 / Math.PI;

function normAz(rad: number): number {
  const az = (rad + TWO_PI) % TWO_PI;
  return az * RAD2DEG;
}

/**
 * Predict the next pass of a single satellite over an observer.
 * Scans forward in `stepSeconds` increments up to `scanHours` ahead.
 * Returns null if no AOS / LOS pair is found.
 */
export function predictNextPass(
  tle: TLE,
  observerLat: number,
  observerLng: number,
  scanHours = 6,
  stepSeconds = 10,
  startTime: Date = new Date(),
): SatPass | null {
  let satrec: satellite.SatRec;
  try {
    satrec = satellite.twoline2satrec(tle.line1, tle.line2);
  } catch {
    return null;
  }
  if (!satrec || (satrec as { error?: number }).error) return null;

  const observerGd: satellite.GeodeticLocation = {
    longitude: satellite.degreesToRadians(observerLng),
    latitude: satellite.degreesToRadians(observerLat),
    height: 0,
  };

  const STEP_MS = stepSeconds * 1000;
  const SCAN_MS = scanHours * 60 * 60 * 1000;

  let prevEl = -999;
  let aos: Date | null = null;
  let aosAz = 0;
  let losAz = 0;
  let maxEl = 0;

  for (let dt = 0; dt <= SCAN_MS; dt += STEP_MS) {
    const t = new Date(startTime.getTime() + dt);
    let posVel: satellite.PositionAndVelocity;
    try {
      posVel = satellite.propagate(satrec, t);
    } catch {
      return null;
    }
    if (typeof posVel.position === 'boolean' || !posVel.position) continue;

    const gmst = satellite.gstime(t);
    const posEcf = satellite.eciToEcf(
      posVel.position as satellite.EciVec3<number>,
      gmst,
    );
    const look = satellite.ecfToLookAngles(observerGd, posEcf);
    const elDeg = look.elevation * RAD2DEG;
    const azDeg = normAz(look.azimuth);

    if (!aos && elDeg > 0 && prevEl <= 0) {
      aos = t;
      aosAz = azDeg;
      maxEl = elDeg;
    } else if (aos && elDeg > maxEl) {
      maxEl = elDeg;
    }

    if (aos && elDeg <= 0 && prevEl > 0) {
      return {
        name: tle.name,
        aos,
        los: t,
        maxElevation: maxEl,
        aosAzimuth: aosAz,
        losAzimuth: azDeg,
      };
    }
    if (aos) losAz = azDeg;
    prevEl = elDeg;
  }

  // If we started already in a pass, AOS may be null.
  // Return null in that case — caller treats as "no upcoming pass found".
  return null;
}

/**
 * Predict the next N passes across many satellites, sorted by AOS time.
 */
export function predictUpcomingPasses(
  tles: TLE[],
  observerLat: number,
  observerLng: number,
  count: number,
  scanHours = 6,
): SatPass[] {
  const passes: SatPass[] = [];
  for (const tle of tles) {
    const p = predictNextPass(tle, observerLat, observerLng, scanHours);
    if (p) passes.push(p);
  }
  return passes
    .sort((a, b) => a.aos.getTime() - b.aos.getTime())
    .slice(0, count);
}

/**
 * For a given pass, compute whether the satellite is currently above
 * the horizon for the observer.
 */
export function isInPass(pass: SatPass, now: Date = new Date()): boolean {
  return now >= pass.aos && now <= pass.los;
}

/**
 * Format a Date difference as "T-HH:MM:SS" or "T+HH:MM:SS".
 */
export function formatCountdown(target: Date, now: Date = new Date()): string {
  let diff = Math.round((target.getTime() - now.getTime()) / 1000);
  const sign = diff < 0 ? '+' : '-';
  diff = Math.abs(diff);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `T${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatUtcHHMM(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
