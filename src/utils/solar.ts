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
 * Strategy: trace the terminator line (elev=0), then close via the dark pole
 * along the map edges. We use the two branches (north and south) to build
 * a proper polygon that doesn't cross diagonally.
 */
export function getNightPolygon(date: Date): [number, number][][] {
  const declination = getSolarDeclination(date);
  const subSolarLng = getSubSolarLongitude(date);
  const { north, south } = computeTerminatorBranches(date, 0, 360);

  // The dark pole: if dec > 0 (northern summer), south pole is dark
  const darkPoleLat = declination >= 0 ? -90 : 90;

  // We need to build a polygon that covers the night side.
  // The terminator has a south branch and a north branch.
  // For the night polygon:
  //   - If south pole is dark (dec >= 0):
  //     The night side is BELOW the south branch of the terminator.
  //     Polygon: south branch (west to east), then bottom edge east to west.
  //   - If north pole is dark (dec < 0):
  //     The night side is ABOVE the north branch of the terminator.
  //     Polygon: north branch (west to east), then top edge east to west.

  const nightPoly: [number, number][] = [];

  if (declination >= 0) {
    // South pole is dark. Night is below the south branch.
    // Go along south branch west to east
    nightPoly.push(...south);
    // Close along the bottom (south pole)
    if (south.length > 0) {
      nightPoly.push([darkPoleLat, south[south.length - 1][1]]);
      nightPoly.push([darkPoleLat, south[0][1]]);
    }
  } else {
    // North pole is dark. Night is above the north branch.
    // Go along north branch west to east
    nightPoly.push(...north);
    // Close along the top (north pole)
    if (north.length > 0) {
      nightPoly.push([darkPoleLat, north[north.length - 1][1]]);
      nightPoly.push([darkPoleLat, north[0][1]]);
    }
  }

  return [nightPoly];
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
