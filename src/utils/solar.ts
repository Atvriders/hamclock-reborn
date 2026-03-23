const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Returns the day of year (1-366) for a given date.
 */
function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Returns the fractional hour in UTC.
 */
function getUTCHours(date: Date): number {
  return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
}

/**
 * Calculate solar declination in degrees for a given date.
 * Uses the approximate formula based on day of year.
 */
export function getSolarDeclination(date: Date): number {
  const dayOfYear = getDayOfYear(date);
  // Approximate solar declination (Spencer, 1971)
  const B = ((360 / 365) * (dayOfYear - 81)) * DEG2RAD;
  const declination = 23.45 * Math.sin(B);
  return declination;
}

/**
 * Calculate the equation of time in hours for a given date.
 */
function getEquationOfTime(date: Date): number {
  const dayOfYear = getDayOfYear(date);
  const B = ((360 / 365) * (dayOfYear - 81)) * DEG2RAD;
  // Equation of time in minutes (approximate)
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  return eot / 60; // convert to hours
}

/**
 * Calculate the sub-solar point longitude for a given date.
 */
function getSubSolarLongitude(date: Date): number {
  const utcHours = getUTCHours(date);
  const eot = getEquationOfTime(date);
  // The sub-solar point longitude: sun is at noon at this longitude
  let lng = -(utcHours + eot - 12) * 15;
  // Normalize to [-180, 180]
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;
  return lng;
}

/**
 * Compute the solar elevation at a given lat/lng for a given date.
 * Returns elevation in degrees (positive = above horizon).
 */
function solarElevation(lat: number, lng: number, date: Date): number {
  const decRad = getSolarDeclination(date) * DEG2RAD;
  const subSolarLng = getSubSolarLongitude(date);
  const haRad = (lng - subSolarLng) * DEG2RAD;
  const latRad = lat * DEG2RAD;
  const sinElev =
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  return Math.asin(Math.max(-1, Math.min(1, sinElev))) * RAD2DEG;
}

/**
 * For a given longitude and date, find the latitude where the sun is at
 * the given elevation angle (in degrees). Uses bisection search.
 * `searchSouth` controls which side of the equator to search from.
 *
 * Returns null if no solution found (e.g. polar day/night).
 */
function findLatForElevation(
  lng: number,
  targetElev: number,
  date: Date,
  searchFromLat: number,
  searchToLat: number
): number | null {
  const decRad = getSolarDeclination(date) * DEG2RAD;
  const subSolarLng = getSubSolarLongitude(date);
  const haRad = (lng - subSolarLng) * DEG2RAD;
  const sinTarget = Math.sin(targetElev * DEG2RAD);

  // f(lat) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(ha) - sin(targetElev)
  // We bisect to find the root
  let lo = searchFromLat;
  let hi = searchToLat;
  const fAt = (lat: number) => {
    const latRad = lat * DEG2RAD;
    return (
      Math.sin(latRad) * Math.sin(decRad) +
      Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad) -
      sinTarget
    );
  };

  let fLo = fAt(lo);
  let fHi = fAt(hi);

  // If same sign, no root in this interval
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const fMid = fAt(mid);
    if (Math.abs(fMid) < 1e-10) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Calculate the terminator line (where solar elevation = targetElev degrees)
 * as a series of [lat, lng] points going from west to east.
 *
 * For each longitude, there can be 0 or 2 crossings (north branch and south branch),
 * or 1 crossing near the poles. We return TWO sorted arrays: north branch and south branch.
 *
 * When the sun is near the pole, one branch may be missing at some longitudes.
 */
function computeTerminatorBranches(
  date: Date,
  targetElev: number,
  numPoints: number
): { north: [number, number][]; south: [number, number][] } {
  const decDeg = getSolarDeclination(date);
  const subSolarLng = getSubSolarLongitude(date);
  const decRad = decDeg * DEG2RAD;
  const sinTarget = Math.sin(targetElev * DEG2RAD);

  const north: [number, number][] = [];
  const south: [number, number][] = [];

  for (let i = 0; i <= numPoints; i++) {
    const lng = -180 + (i * 360) / numPoints;
    const haRad = (lng - subSolarLng) * DEG2RAD;
    const cosHA = Math.cos(haRad);
    const sinDec = Math.sin(decRad);
    const cosDec = Math.cos(decRad);

    // f(lat) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(ha) - sin(targetElev) = 0
    // The midpoint (where f changes behavior) is roughly at lat ≈ declination
    // Try to find two roots: one in [-90, decDeg] and one in [decDeg, 90]

    const latSouth = findLatForElevation(lng, targetElev, date, -90, decDeg);
    const latNorth = findLatForElevation(lng, targetElev, date, decDeg, 90);

    if (latSouth !== null) south.push([latSouth, lng]);
    if (latNorth !== null) north.push([latNorth, lng]);
  }

  return { north, south };
}

/**
 * Calculate the terminator coordinates as a series of [lat, lng] points.
 * Returns a closed polygon representing the night side of Earth.
 * The terminator is where the solar elevation angle is 0.
 */
export function getTerminatorCoords(date: Date): [number, number][] {
  const { north, south } = computeTerminatorBranches(date, 0, 360);

  // Combine: south branch west-to-east, then north branch east-to-west
  // This traces a closed curve around the dayside or nightside
  const points: [number, number][] = [];
  points.push(...south);
  points.push(...[...north].reverse());
  return points;
}

/**
 * Build a closed polygon covering the night side of the Earth.
 * Returns lat/lng pairs suitable for use as a Leaflet polygon.
 *
 * Strategy: for each longitude step, compute whether each point is in
 * night (solar elevation < 0). We sweep longitude from -180 to +180,
 * collecting the north and south terminator crossings, then build a
 * polygon that includes the full night hemisphere by tracing the south
 * branch west-to-east, closing along the dark-pole edge, then the north
 * branch east-to-west, and closing again along the dark-pole edge.
 *
 * When declination >= 0 (northern summer) the south pole is in darkness,
 * so the night polygon runs: south branch → east edge down to -90 →
 * bottom edge at -90 → west edge up to north branch → north branch
 * reversed. This captures the FULL night hemisphere, not just a polar cap.
 */
export function getNightPolygon(date: Date): [number, number][][] {
  // Simple approach: for each longitude, find the terminator latitude.
  // Build two polygons — one for each side of the antimeridian if needed.
  // The night side is opposite the subsolar point.
  const subSolarLng = getSubSolarLongitude(date);
  const numPoints = 180;

  // Build the terminator line as [lat, lng] points
  const terminatorTop: [number, number][] = []; // the "north" crossing
  const terminatorBot: [number, number][] = []; // the "south" crossing

  for (let i = 0; i <= numPoints; i++) {
    const lng = -180 + (i * 360) / numPoints;
    const latN = findLatForElevation(lng, 0, date, 0, 90);
    const latS = findLatForElevation(lng, 0, date, -90, 0);
    if (latN !== null) terminatorTop.push([latN, lng]);
    if (latS !== null) terminatorBot.push([latS, lng]);
  }

  if (terminatorTop.length < 2 || terminatorBot.length < 2) {
    // Can't build polygon — check if entire world is dark
    const elev = solarElevation(0, 0, date);
    if (elev < 0) return [[[-90,-180],[-90,180],[90,180],[90,-180]]];
    return [[]];
  }

  // The night polygon: go along one terminator branch, then back along the other
  // Check which side is dark by testing a point between the branches
  const midLng = terminatorTop[Math.floor(terminatorTop.length/2)][1];
  const midLat = (terminatorTop[Math.floor(terminatorTop.length/2)][0] + terminatorBot[Math.floor(terminatorBot.length/2)][0]) / 2;
  const midElev = solarElevation(midLat, midLng, date);

  const poly: [number, number][] = [];

  if (midElev < 0) {
    // Between the branches is dark — polygon goes: top branch W→E, bottom branch E→W
    poly.push(...terminatorTop);
    poly.push(...[...terminatorBot].reverse());
  } else {
    // Between the branches is light — night is OUTSIDE
    // Polygon: top branch W→E, then north pole, then bottom branch E→W, then south pole
    poly.push(...terminatorTop);
    // Go to north pole at east end
    poly.push([90, terminatorTop[terminatorTop.length-1][1]]);
    poly.push([90, terminatorBot[terminatorBot.length-1][1]]);
    // Bottom branch reversed
    poly.push(...[...terminatorBot].reverse());
    // Go to south pole at west end
    poly.push([-90, terminatorBot[0][1]]);
    poly.push([-90, terminatorTop[0][1]]);
  }

  return [poly];
}

/**
 * Compute the gray line (civil twilight band) as polyline coordinates.
 *
 * Returns the terminator line (elev=0) and the twilight line (elev=-6)
 * as arrays of [lat, lng] suitable for rendering as Leaflet Polylines.
 *
 * Each is split into two branches (north and south) to avoid diagonal crossings.
 */
export function getGrayLinePolylines(date: Date): {
  terminatorNorth: [number, number][];
  terminatorSouth: [number, number][];
  twilightNorth: [number, number][];
  twilightSouth: [number, number][];
} {
  const terminator = computeTerminatorBranches(date, 0, 360);
  const twilight = computeTerminatorBranches(date, -6, 360);

  return {
    terminatorNorth: terminator.north,
    terminatorSouth: terminator.south,
    twilightNorth: twilight.north,
    twilightSouth: twilight.south,
  };
}

/**
 * Get the gray line as polygon rings (for rendering as filled areas).
 * Returns two polygon coordinate arrays — one for dawn band, one for dusk band.
 *
 * DEPRECATED: Use getGrayLinePolylines() instead to avoid diagonal rendering artifacts.
 * Kept for API compatibility.
 */
export function getGrayLinePolygons(date: Date): {
  dawn: [number, number][];
  dusk: [number, number][];
} {
  // Return empty — callers should switch to getGrayLinePolylines
  return { dawn: [], dusk: [] };
}

/**
 * Generate the 2-character Maidenhead grid square boundaries.
 * Each square is 20° longitude × 10° latitude.
 * Returns an array of { bounds, label } for the 18×18 = 324 grid squares.
 */
export function getMaidenheadGrid(): {
  bounds: [[number, number], [number, number]];
  label: string;
}[] {
  const grid: { bounds: [[number, number], [number, number]]; label: string }[] = [];

  for (let lngIdx = 0; lngIdx < 18; lngIdx++) {
    for (let latIdx = 0; latIdx < 18; latIdx++) {
      const lng1 = lngIdx * 20 - 180;
      const lat1 = latIdx * 10 - 90;
      const lng2 = lng1 + 20;
      const lat2 = lat1 + 10;

      const label =
        String.fromCharCode(65 + lngIdx) + String.fromCharCode(65 + latIdx);

      grid.push({
        bounds: [
          [lat1, lng1],
          [lat2, lng2],
        ],
        label,
      });
    }
  }

  return grid;
}
