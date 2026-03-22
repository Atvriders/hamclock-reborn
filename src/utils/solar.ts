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
 * Calculate the terminator coordinates as a series of [lat, lng] points.
 * Returns a closed polygon representing the night side of Earth.
 * The terminator is where the solar elevation angle is 0.
 */
export function getTerminatorCoords(date: Date): [number, number][] {
  const declination = getSolarDeclination(date) * DEG2RAD;
  const subSolarLng = getSubSolarLongitude(date);

  const points: [number, number][] = [];
  const numPoints = 360;

  // Calculate terminator points
  // For each longitude offset from the sub-solar point, find the latitude
  // where solar elevation = 0
  for (let i = 0; i <= numPoints; i++) {
    const lng = -180 + (i * 360) / numPoints;

    // Hour angle in radians
    const hourAngle = (lng - subSolarLng) * DEG2RAD;

    // Latitude where solar elevation = 0:
    // sin(elev) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(ha) = 0
    // => tan(lat) = -cos(ha) / tan(dec) ... but this breaks at equinoxes
    // Better: lat = atan(-cos(ha) / tan(dec))
    // At equinox (dec≈0), terminator is a great circle through poles

    let lat: number;
    if (Math.abs(declination) < 0.001) {
      // Near equinox — terminator runs pole to pole
      // cos(ha) = -sin(lat)*sin(dec)/(cos(lat)*cos(dec)) ≈ 0
      // The terminator is where ha = ±90°, i.e., lng = subSolarLng ± 90
      lat = Math.atan(-Math.cos(hourAngle) / 0.001) * RAD2DEG;
      lat = Math.max(-90, Math.min(90, lat));
    } else {
      lat = Math.atan(-Math.cos(hourAngle) / Math.tan(declination)) * RAD2DEG;
    }

    points.push([lat, lng]);
  }

  return points;
}

/**
 * Build a closed polygon covering the night side of the Earth.
 * Returns lat/lng pairs suitable for use as a Leaflet polygon.
 */
export function getNightPolygon(date: Date): [number, number][][] {
  const declination = getSolarDeclination(date);
  const terminatorPoints = getTerminatorCoords(date);

  // Determine which pole is in darkness
  // If declination > 0 (northern summer), south pole is dark
  // If declination < 0 (northern winter), north pole is dark
  const darkPoleLat = declination >= 0 ? -90 : 90;

  // Build the night polygon:
  // Start with the terminator line, then close via the dark pole
  const nightPoly: [number, number][] = [];

  // Add the terminator points
  for (const pt of terminatorPoints) {
    nightPoly.push(pt);
  }

  // Close via the dark pole — go along lng=180 to the pole, then lng=-180 back
  nightPoly.push([darkPoleLat, 180]);
  nightPoly.push([darkPoleLat, -180]);

  return [nightPoly];
}

/**
 * Calculate the gray line (dawn and dusk bands) coordinates.
 * The gray line is the region where the sun is between 0° and -6° elevation,
 * which corresponds to civil twilight — the zone of enhanced propagation.
 *
 * Returns two bands: dawn (sun rising) and dusk (sun setting).
 */
export function getGrayLineCoords(date: Date): {
  dawn: [number, number][];
  dusk: [number, number][];
} {
  const declination = getSolarDeclination(date) * DEG2RAD;
  const subSolarLng = getSubSolarLongitude(date);

  const twilightAngle = -6 * DEG2RAD; // Civil twilight
  const numPoints = 360;

  const terminatorOuter: [number, number][] = [];
  const terminatorInner: [number, number][] = [];

  for (let i = 0; i <= numPoints; i++) {
    const lng = -180 + (i * 360) / numPoints;
    const hourAngle = (lng - subSolarLng) * DEG2RAD;

    // Terminator (elevation = 0)
    let latTerminator: number;
    if (Math.abs(declination) < 0.001) {
      latTerminator = Math.atan(-Math.cos(hourAngle) / 0.001) * RAD2DEG;
      latTerminator = Math.max(-90, Math.min(90, latTerminator));
    } else {
      latTerminator = Math.atan(-Math.cos(hourAngle) / Math.tan(declination)) * RAD2DEG;
    }

    // Civil twilight boundary (elevation = -6°)
    // sin(elev) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(ha)
    // For elev = twilightAngle:
    // sin(twilight) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(ha)
    let latTwilight: number;
    if (Math.abs(declination) < 0.001) {
      latTwilight = Math.atan(
        (Math.sin(twilightAngle) - 0.001 * Math.cos(hourAngle)) / 0.001
      ) * RAD2DEG;
      latTwilight = Math.max(-90, Math.min(90, latTwilight));
    } else {
      // Solve: sin(tw) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(ha)
      // Use: lat = atan2(sin(tw) - cos(dec)*cos(ha)*sin(latGuess), sin(dec))
      // Iterative or use: atan((-cos(ha) + sin(tw)/sin(dec)) * sin(dec) / cos(dec)... )
      // Simpler approximation: shift the terminator by the twilight offset
      const cosHA = Math.cos(hourAngle);
      const sinDec = Math.sin(declination);
      const cosDec = Math.cos(declination);

      // From: sin(tw) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(ha)
      // This is: sin(tw) = cos(lat - dec) * cos(ha) + sin(lat)*sin(dec)*(1 - cos(ha)) + ...
      // Numerical approach: use Newton's method with 2 iterations
      let lat = latTerminator * DEG2RAD;
      for (let iter = 0; iter < 5; iter++) {
        const sinLat = Math.sin(lat);
        const cosLat = Math.cos(lat);
        const f = sinLat * sinDec + cosLat * cosDec * cosHA - Math.sin(twilightAngle);
        const fp = cosLat * sinDec - sinLat * cosDec * cosHA;
        if (Math.abs(fp) > 1e-10) {
          lat = lat - f / fp;
        }
      }
      latTwilight = lat * RAD2DEG;
      latTwilight = Math.max(-90, Math.min(90, latTwilight));
    }

    terminatorInner.push([latTerminator, lng]);
    terminatorOuter.push([latTwilight, lng]);
  }

  // Dawn is on the east side of the sub-solar point (sun is rising)
  // Dusk is on the west side (sun is setting)
  const dawn: [number, number][] = [];
  const dusk: [number, number][] = [];

  for (let i = 0; i <= numPoints; i++) {
    const lng = -180 + (i * 360) / numPoints;

    // Normalize relative longitude to sub-solar point
    let relLng = lng - subSolarLng;
    while (relLng > 180) relLng -= 360;
    while (relLng < -180) relLng += 360;

    if (relLng < 0) {
      // East of sub-solar point = dawn side
      dawn.push(terminatorInner[i]);
      dawn.push(terminatorOuter[i]);
    } else {
      // West of sub-solar point = dusk side
      dusk.push(terminatorInner[i]);
      dusk.push(terminatorOuter[i]);
    }
  }

  return { dawn, dusk };
}

/**
 * Get the gray line as polygon rings (for rendering as filled areas).
 * Returns two polygon coordinate arrays — one for dawn band, one for dusk band.
 */
export function getGrayLinePolygons(date: Date): {
  dawn: [number, number][];
  dusk: [number, number][];
} {
  const declination = getSolarDeclination(date) * DEG2RAD;
  const subSolarLng = getSubSolarLongitude(date);
  const twilightAngle = -6 * DEG2RAD;
  const numPoints = 360;

  const dawnPoly: [number, number][] = [];
  const duskPoly: [number, number][] = [];

  // For each longitude, compute both terminator lat and twilight lat
  const terminatorLats: number[] = [];
  const twilightLats: number[] = [];
  const lngs: number[] = [];

  for (let i = 0; i <= numPoints; i++) {
    const lng = -180 + (i * 360) / numPoints;
    lngs.push(lng);
    const hourAngle = (lng - subSolarLng) * DEG2RAD;

    const effDec = Math.abs(declination) < 0.001 ? 0.001 : declination;

    // Terminator latitude
    const latT = Math.atan(-Math.cos(hourAngle) / Math.tan(effDec)) * RAD2DEG;
    terminatorLats.push(Math.max(-90, Math.min(90, latT)));

    // Twilight latitude (Newton's method)
    const sinDec = Math.sin(declination);
    const cosDec = Math.cos(declination);
    const cosHA = Math.cos(hourAngle);
    let lat = latT * DEG2RAD;
    for (let iter = 0; iter < 5; iter++) {
      const sinLat = Math.sin(lat);
      const cosLat = Math.cos(lat);
      const f = sinLat * sinDec + cosLat * cosDec * cosHA - Math.sin(twilightAngle);
      const fp = cosLat * sinDec - sinLat * cosDec * cosHA;
      if (Math.abs(fp) > 1e-10) {
        lat = lat - f / fp;
      }
    }
    twilightLats.push(Math.max(-90, Math.min(90, lat * RAD2DEG)));
  }

  // Split into dawn (sun rising, east side) and dusk (sun setting, west side)
  // Dawn band: between terminator and twilight on the morning side
  // Dusk band: between terminator and twilight on the evening side

  const dawnForward: [number, number][] = [];
  const dawnReverse: [number, number][] = [];
  const duskForward: [number, number][] = [];
  const duskReverse: [number, number][] = [];

  for (let i = 0; i <= numPoints; i++) {
    let relLng = lngs[i] - subSolarLng;
    while (relLng > 180) relLng -= 360;
    while (relLng < -180) relLng += 360;

    // Morning side: relative longitude between -180 and -90, or 90 to 180
    // (terminator is at ±90° from sub-solar point at equinox)
    // Actually simpler: dawn = east terminator, dusk = west terminator
    // The terminator on the east is where relLng ≈ -90 (sun about to rise)
    // The terminator on the west is where relLng ≈ +90 (sun about to set)

    if (relLng >= -180 && relLng <= 0) {
      dawnForward.push([terminatorLats[i], lngs[i]]);
      dawnReverse.push([twilightLats[i], lngs[i]]);
    } else {
      duskForward.push([terminatorLats[i], lngs[i]]);
      duskReverse.push([twilightLats[i], lngs[i]]);
    }
  }

  // Build closed polygons: forward along terminator, reverse along twilight
  dawnPoly.push(...dawnForward, ...dawnReverse.reverse());
  duskPoly.push(...duskForward, ...duskReverse.reverse());

  return { dawn: dawnPoly, dusk: duskPoly };
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
