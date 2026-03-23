/**
 * Ham Radio Utility Module
 *
 * Maidenhead grid square conversions and callsign prefix to location lookup.
 *
 * Maidenhead Locator System:
 *   Field  (2 chars, A-R)  → 20° lng × 10° lat
 *   Square (2 digits, 0-9) →  2° lng ×  1° lat
 *   Subsquare (2 chars, a-x) → 5' lng × 2.5' lat
 */

// ---------------------------------------------------------------------------
// Grid ↔ LatLng
// ---------------------------------------------------------------------------

/**
 * Convert a Maidenhead grid locator (4 or 6 char) to a lat/lng center point.
 *
 * Examples:
 *   "FN31"   → { lat: 41.5,   lng: -72.5   }
 *   "FN31pr" → { lat: 41.729, lng: -72.375  }
 */
export function gridToLatLng(grid: string): { lat: number; lng: number } | null {
  if (!grid || (grid.length !== 4 && grid.length !== 6)) return null;

  const g = grid.toUpperCase();

  const field1 = g.charCodeAt(0) - 65; // A=0 .. R=17
  const field2 = g.charCodeAt(1) - 65;
  if (field1 < 0 || field1 > 17 || field2 < 0 || field2 > 17) return null;

  const sq1 = parseInt(g[2], 10);
  const sq2 = parseInt(g[3], 10);
  if (isNaN(sq1) || isNaN(sq2)) return null;

  let lng = field1 * 20 + sq1 * 2 - 180;
  let lat = field2 * 10 + sq2 * 1 - 90;

  if (grid.length === 6) {
    const sub = grid.toLowerCase();
    const sub1 = sub.charCodeAt(4) - 97; // a=0 .. x=23
    const sub2 = sub.charCodeAt(5) - 97;
    if (sub1 < 0 || sub1 > 23 || sub2 < 0 || sub2 > 23) return null;

    lng += sub1 * (5 / 60) + 2.5 / 60;
    lat += sub2 * (2.5 / 60) + 1.25 / 60;
  } else {
    // Center of the square for 4-char grids
    lng += 1;
    lat += 0.5;
  }

  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
  };
}

/**
 * Convert lat/lng to a 6-character Maidenhead grid locator.
 *
 * Example:
 *   (41.7, -72.4) → "FN31pr"
 */
export function latLngToGrid(lat: number, lng: number): string {
  // Clamp to valid ranges
  lat = Math.max(-90, Math.min(90, lat));
  lng = Math.max(-180, Math.min(180, lng));
  // Shift origin so values are positive
  let adjLng = lng + 180;
  let adjLat = lat + 90;

  // Field (clamp to 0-17 for valid A-R range)
  const fldLng = Math.min(17, Math.floor(adjLng / 20));
  const fldLat = Math.min(17, Math.floor(adjLat / 10));
  adjLng -= fldLng * 20;
  adjLat -= fldLat * 10;

  // Square
  const sqLng = Math.floor(adjLng / 2);
  const sqLat = Math.floor(adjLat / 1);
  adjLng -= sqLng * 2;
  adjLat -= sqLat * 1;

  // Subsquare
  const subLng = Math.floor(adjLng / (5 / 60));
  const subLat = Math.floor(adjLat / (2.5 / 60));

  return (
    String.fromCharCode(65 + fldLng) +
    String.fromCharCode(65 + fldLat) +
    sqLng.toString() +
    sqLat.toString() +
    String.fromCharCode(97 + subLng) +
    String.fromCharCode(97 + subLat)
  );
}

// ---------------------------------------------------------------------------
// Callsign prefix → location
// ---------------------------------------------------------------------------

interface PrefixEntry {
  lat: number;
  lng: number;
  country: string;
  countryCode: string;
}

/**
 * Prefix table: longest-match first within categories.
 * Order matters — longer prefixes are checked before shorter ones in extractPrefix.
 */
const PREFIX_TABLE: Record<string, PrefixEntry> = {
  // --- USA (multi-letter prefixes first) ---
  AA: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AB: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AC: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AD: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AE: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AF: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AG: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AH: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AI: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AJ: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AK: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  AL: { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  W:  { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  K:  { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },
  N:  { lat: 39.8, lng: -98.6, country: 'United States', countryCode: 'US' },

  // --- Canada ---
  VE: { lat: 56.1, lng: -106.3, country: 'Canada', countryCode: 'CA' },
  VA: { lat: 56.1, lng: -106.3, country: 'Canada', countryCode: 'CA' },
  VO: { lat: 56.1, lng: -106.3, country: 'Canada', countryCode: 'CA' },
  VY: { lat: 56.1, lng: -106.3, country: 'Canada', countryCode: 'CA' },

  // --- UK ---
  '2E': { lat: 52.0, lng: -1.2, country: 'United Kingdom', countryCode: 'GB' },
  G:  { lat: 52.0, lng: -1.2, country: 'United Kingdom', countryCode: 'GB' },
  M:  { lat: 52.0, lng: -1.2, country: 'United Kingdom', countryCode: 'GB' },

  // --- France ---
  F:  { lat: 46.2, lng: 2.2, country: 'France', countryCode: 'FR' },

  // --- Germany ---
  DL: { lat: 51.2, lng: 10.4, country: 'Germany', countryCode: 'DE' },
  DJ: { lat: 51.2, lng: 10.4, country: 'Germany', countryCode: 'DE' },
  DK: { lat: 51.2, lng: 10.4, country: 'Germany', countryCode: 'DE' },
  DO: { lat: 51.2, lng: 10.4, country: 'Germany', countryCode: 'DE' },

  // --- Italy ---
  IK: { lat: 41.9, lng: 12.5, country: 'Italy', countryCode: 'IT' },
  IZ: { lat: 41.9, lng: 12.5, country: 'Italy', countryCode: 'IT' },
  I:  { lat: 41.9, lng: 12.5, country: 'Italy', countryCode: 'IT' },

  // --- Spain ---
  EA: { lat: 40.4, lng: -3.7, country: 'Spain', countryCode: 'ES' },

  // --- Japan ---
  JA: { lat: 36.2, lng: 138.3, country: 'Japan', countryCode: 'JP' },
  JH: { lat: 36.2, lng: 138.3, country: 'Japan', countryCode: 'JP' },
  JR: { lat: 36.2, lng: 138.3, country: 'Japan', countryCode: 'JP' },
  JE: { lat: 36.2, lng: 138.3, country: 'Japan', countryCode: 'JP' },
  JF: { lat: 36.2, lng: 138.3, country: 'Japan', countryCode: 'JP' },
  JG: { lat: 36.2, lng: 138.3, country: 'Japan', countryCode: 'JP' },
  JI: { lat: 36.2, lng: 138.3, country: 'Japan', countryCode: 'JP' },

  // --- Australia ---
  VK: { lat: -25.3, lng: 134.8, country: 'Australia', countryCode: 'AU' },

  // --- New Zealand ---
  ZL: { lat: -41.3, lng: 174.8, country: 'New Zealand', countryCode: 'NZ' },

  // --- South Korea ---
  HL: { lat: 37.6, lng: 127.0, country: 'South Korea', countryCode: 'KR' },

  // --- Taiwan ---
  BV: { lat: 25.0, lng: 121.5, country: 'Taiwan', countryCode: 'TW' },

  // --- China ---
  BY: { lat: 35.9, lng: 104.2, country: 'China', countryCode: 'CN' },
  BA: { lat: 35.9, lng: 104.2, country: 'China', countryCode: 'CN' },
  BD: { lat: 35.9, lng: 104.2, country: 'China', countryCode: 'CN' },

  // --- Russia ---
  UA: { lat: 55.8, lng: 37.6, country: 'Russia', countryCode: 'RU' },
  RA: { lat: 55.8, lng: 37.6, country: 'Russia', countryCode: 'RU' },
  RV: { lat: 55.8, lng: 37.6, country: 'Russia', countryCode: 'RU' },
  RW: { lat: 55.8, lng: 37.6, country: 'Russia', countryCode: 'RU' },

  // --- India ---
  VU: { lat: 20.6, lng: 79.0, country: 'India', countryCode: 'IN' },

  // --- South Africa ---
  ZS: { lat: -30.6, lng: 22.9, country: 'South Africa', countryCode: 'ZA' },

  // --- Brazil ---
  PY: { lat: -14.2, lng: -51.9, country: 'Brazil', countryCode: 'BR' },

  // --- Argentina ---
  LU: { lat: -38.4, lng: -63.6, country: 'Argentina', countryCode: 'AR' },

  // --- Chile ---
  CE: { lat: -35.7, lng: -71.5, country: 'Chile', countryCode: 'CL' },

  // --- Indonesia ---
  YB: { lat: -0.8, lng: 113.9, country: 'Indonesia', countryCode: 'ID' },
  YC: { lat: -0.8, lng: 113.9, country: 'Indonesia', countryCode: 'ID' },
  YD: { lat: -0.8, lng: 113.9, country: 'Indonesia', countryCode: 'ID' },

  // --- Thailand ---
  HS: { lat: 15.9, lng: 100.5, country: 'Thailand', countryCode: 'TH' },

  // --- Singapore ---
  '9V': { lat: 1.4, lng: 103.8, country: 'Singapore', countryCode: 'SG' },

  // --- Malaysia ---
  '9M': { lat: 4.2, lng: 101.7, country: 'Malaysia', countryCode: 'MY' },

  // --- Philippines ---
  DU: { lat: 12.9, lng: 121.8, country: 'Philippines', countryCode: 'PH' },

  // --- Oman ---
  A4: { lat: 21.5, lng: 55.9, country: 'Oman', countryCode: 'OM' },

  // --- UAE ---
  A6: { lat: 23.4, lng: 53.8, country: 'United Arab Emirates', countryCode: 'AE' },

  // --- Qatar ---
  A7: { lat: 25.4, lng: 51.2, country: 'Qatar', countryCode: 'QA' },

  // --- Greece ---
  SV: { lat: 39.1, lng: 21.8, country: 'Greece', countryCode: 'GR' },

  // --- Denmark ---
  OZ: { lat: 56.3, lng: 9.5, country: 'Denmark', countryCode: 'DK' },

  // --- Sweden ---
  SM: { lat: 60.1, lng: 18.6, country: 'Sweden', countryCode: 'SE' },
  SA: { lat: 60.1, lng: 18.6, country: 'Sweden', countryCode: 'SE' },

  // --- Norway ---
  LA: { lat: 60.5, lng: 8.5, country: 'Norway', countryCode: 'NO' },

  // --- Finland ---
  OH: { lat: 61.9, lng: 25.7, country: 'Finland', countryCode: 'FI' },

  // --- Netherlands ---
  PA: { lat: 52.1, lng: 5.3, country: 'Netherlands', countryCode: 'NL' },
  PD: { lat: 52.1, lng: 5.3, country: 'Netherlands', countryCode: 'NL' },

  // --- Belgium ---
  ON: { lat: 50.5, lng: 4.5, country: 'Belgium', countryCode: 'BE' },

  // --- Switzerland ---
  HB: { lat: 46.8, lng: 8.2, country: 'Switzerland', countryCode: 'CH' },

  // --- Austria ---
  OE: { lat: 47.5, lng: 14.6, country: 'Austria', countryCode: 'AT' },

  // --- Poland ---
  SP: { lat: 51.9, lng: 19.1, country: 'Poland', countryCode: 'PL' },

  // --- Czech Republic ---
  OK: { lat: 49.8, lng: 15.5, country: 'Czech Republic', countryCode: 'CZ' },

  // --- Hungary ---
  HA: { lat: 47.2, lng: 19.5, country: 'Hungary', countryCode: 'HU' },

  // --- Romania ---
  YO: { lat: 45.9, lng: 24.9, country: 'Romania', countryCode: 'RO' },

  // --- Bulgaria ---
  LZ: { lat: 42.7, lng: 25.5, country: 'Bulgaria', countryCode: 'BG' },

  // --- Croatia ---
  '9A': { lat: 45.1, lng: 15.2, country: 'Croatia', countryCode: 'HR' },

  // --- Slovenia ---
  S5: { lat: 46.2, lng: 14.8, country: 'Slovenia', countryCode: 'SI' },

  // --- San Marino ---
  T7: { lat: 43.9, lng: 12.4, country: 'San Marino', countryCode: 'SM' },

  // --- Portugal ---
  CT: { lat: 39.4, lng: -8.2, country: 'Portugal', countryCode: 'PT' },

  // --- Ireland ---
  EI: { lat: 53.4, lng: -8.2, country: 'Ireland', countryCode: 'IE' },

  // --- Iceland ---
  TF: { lat: 64.9, lng: -19.0, country: 'Iceland', countryCode: 'IS' },

  // --- Mexico ---
  XE: { lat: 23.6, lng: -102.5, country: 'Mexico', countryCode: 'MX' },

  // --- Colombia ---
  HK: { lat: 4.6, lng: -74.1, country: 'Colombia', countryCode: 'CO' },

  // --- Venezuela ---
  YV: { lat: 6.4, lng: -66.6, country: 'Venezuela', countryCode: 'VE' },

  // --- Uruguay ---
  CX: { lat: -32.5, lng: -55.8, country: 'Uruguay', countryCode: 'UY' },

  // --- Cuba ---
  CO: { lat: 21.5, lng: -80.0, country: 'Cuba', countryCode: 'CU' },

  // --- Israel ---
  '4X': { lat: 31.0, lng: 34.9, country: 'Israel', countryCode: 'IL' },
  '4Z': { lat: 31.0, lng: 34.9, country: 'Israel', countryCode: 'IL' },

  // --- Turkey ---
  TA: { lat: 38.9, lng: 35.2, country: 'Turkey', countryCode: 'TR' },

  // --- Ukraine ---
  UR: { lat: 48.4, lng: 31.2, country: 'Ukraine', countryCode: 'UA' },
  UT: { lat: 48.4, lng: 31.2, country: 'Ukraine', countryCode: 'UA' },
  UX: { lat: 48.4, lng: 31.2, country: 'Ukraine', countryCode: 'UA' },

  // --- Serbia ---
  YU: { lat: 44.0, lng: 21.0, country: 'Serbia', countryCode: 'RS' },

  // --- Slovakia ---
  OM: { lat: 48.7, lng: 19.7, country: 'Slovakia', countryCode: 'SK' },

  // --- Lithuania ---
  LY: { lat: 55.2, lng: 23.9, country: 'Lithuania', countryCode: 'LT' },

  // --- Latvia ---
  YL: { lat: 56.9, lng: 24.1, country: 'Latvia', countryCode: 'LV' },

  // --- Estonia ---
  ES: { lat: 58.6, lng: 25.0, country: 'Estonia', countryCode: 'EE' },
};

/**
 * Sorted list of prefixes by length descending for longest-match-first lookup.
 */
const SORTED_PREFIXES = Object.keys(PREFIX_TABLE).sort(
  (a, b) => b.length - a.length
);

/**
 * Extract the country prefix from a callsign.
 *
 * Handles standard amateur callsign formats:
 *   W1AW → "W"
 *   VK3ABC → "VK"
 *   JA1XYZ → "JA"
 *   9V1XX → "9V"
 *   2E0ABC → "2E"
 */
export function extractPrefix(callsign: string): string {
  const cs = callsign.toUpperCase().trim();
  if (!cs) return '';

  // Try longest prefix match first
  for (const prefix of SORTED_PREFIXES) {
    if (cs.startsWith(prefix)) {
      // Verify the character after the prefix is a digit (call area number)
      // or this is a single-letter prefix followed by a digit
      const nextChar = cs[prefix.length];
      if (nextChar && /\d/.test(nextChar)) {
        return prefix;
      }
    }
  }

  // Fallback: extract letters before the first digit
  const match = cs.match(/^([A-Z0-9]{1,2}?[A-Z]?)(?=\d)/);
  return match ? match[1] : cs.slice(0, 2);
}

/**
 * Map a callsign to an approximate geographic location via its prefix.
 *
 * Returns null if the prefix is not recognized.
 */
export function callsignPrefixToLocation(
  callsign: string
): { lat: number; lng: number; country: string; countryCode: string } | null {
  const prefix = extractPrefix(callsign);
  if (!prefix) return null;

  // Try exact match first
  if (PREFIX_TABLE[prefix]) {
    return { ...PREFIX_TABLE[prefix] };
  }

  // Try progressively shorter substrings
  for (let len = prefix.length - 1; len >= 1; len--) {
    const sub = prefix.slice(0, len);
    if (PREFIX_TABLE[sub]) {
      return { ...PREFIX_TABLE[sub] };
    }
  }

  return null;
}
