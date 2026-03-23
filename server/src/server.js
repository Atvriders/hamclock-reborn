import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import * as satellite from 'satellite.js';

const app = express();
const PORT = 3013;

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
const cache = {
  solar:      { data: null, ts: 0, ttl: 5 * 60_000 },
  bands:      { data: null, ts: 0, ttl: 10 * 60_000 },
  dxspots:    { data: null, ts: 0, ttl: 1 * 60_000 },
  satellites: { data: null, ts: 0, ttl: 5 * 60_000 },
  mapMuf:     { data: null, ts: 0, ttl: 15 * 60_000 },
  mapDrap:    { data: null, ts: 0, ttl: 15 * 60_000 },
  mapAurora:  { data: null, ts: 0, ttl: 15 * 60_000 },
  solarImage: { data: null, ts: 0, ttl: 15 * 60_000 },
  mapFoF2:    { data: null, ts: 0, ttl: 15 * 60_000 },
};

function getCached(key) {
  const entry = cache[key];
  if (entry.data && Date.now() - entry.ts < entry.ttl) return entry.data;
  return null;
}

function getStaleOrNull(key) {
  return cache[key].data || null;
}

function setCache(key, data) {
  cache[key].data = data;
  cache[key].ts = Date.now();
}

function cacheAge(key) {
  if (!cache[key].ts) return null;
  return Math.round((Date.now() - cache[key].ts) / 1000);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function safeFetch(url, timeout = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function safeFetchJson(url) {
  const res = await safeFetch(url);
  try { return await res.json(); }
  catch { throw new Error(`Failed to parse JSON from ${url}`); }
}

async function safeFetchText(url) {
  const res = await safeFetch(url);
  try { return await res.text(); }
  catch { throw new Error(`Failed to read text from ${url}`); }
}

// Simple XML value extractor — avoids needing an XML parser dependency
function xmlVal(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}

function xmlAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*?${attr}="([^"]*)"`, 'g');
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
}

// Extract band conditions from hamqsl XML
function parseBandConditions(xml) {
  const bands = ['80m-40m', '30m-20m', '17m-15m', '12m-10m'];
  const bandLabels = ['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];

  // The hamqsl feed uses tags like <band name="80m-40m" time="day">Good</band>
  const dayConditions = {};
  const nightConditions = {};

  // Extract individual band conditions
  for (const label of bandLabels) {
    // Try exact band match first
    const dayMatch = xml.match(new RegExp(`<band\\s+name="${label}"\\s+time="day">([^<]+)</band>`));
    const nightMatch = xml.match(new RegExp(`<band\\s+name="${label}"\\s+time="night">([^<]+)</band>`));
    dayConditions[label] = dayMatch ? dayMatch[1].trim() : 'Unknown';
    nightConditions[label] = nightMatch ? nightMatch[1].trim() : 'Unknown';
  }

  // If individual bands aren't found, try grouped bands
  if (Object.values(dayConditions).every(v => v === 'Unknown')) {
    for (const grouped of bands) {
      const dayMatch = xml.match(new RegExp(`<band\\s+name="${grouped}"\\s+time="day">([^<]+)</band>`));
      const nightMatch = xml.match(new RegExp(`<band\\s+name="${grouped}"\\s+time="night">([^<]+)</band>`));
      const dayVal = dayMatch ? dayMatch[1].trim() : 'Unknown';
      const nightVal = nightMatch ? nightMatch[1].trim() : 'Unknown';
      // Spread grouped value to individual bands
      const parts = grouped.split('-');
      const startIdx = bandLabels.indexOf(parts[0]);
      const endIdx = bandLabels.indexOf(parts[1]);
      if (startIdx >= 0 && endIdx >= 0) {
        for (let i = startIdx; i <= endIdx; i++) {
          dayConditions[bandLabels[i]] = dayVal;
          nightConditions[bandLabels[i]] = nightVal;
        }
      }
    }
  }

  return { day: dayConditions, night: nightConditions };
}

// Classify X-ray flux into solar flare class (e.g. "C2.3", "M1.5")
function classifyXray(flux) {
  if (flux == null) return 'N/A';
  const v = typeof flux === 'string' ? parseFloat(flux) : flux;
  if (isNaN(v) || v <= 0) return 'A0.0';

  let cls, threshold;
  if (v >= 1e-4)      { cls = 'X'; threshold = 1e-4; }
  else if (v >= 1e-5) { cls = 'M'; threshold = 1e-5; }
  else if (v >= 1e-6) { cls = 'C'; threshold = 1e-6; }
  else if (v >= 1e-7) { cls = 'B'; threshold = 1e-7; }
  else                { cls = 'A'; threshold = 1e-8; }

  const level = (v / threshold).toFixed(1);
  return `${cls}${level}`;
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------
async function fetchSolarData() {
  const [kpData, sfiData, ssnData, solarWindData, xrayData, hamqslData] = await Promise.allSettled([
    safeFetchJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
    safeFetchJson('https://services.swpc.noaa.gov/json/f107_cm_flux.json'),
    safeFetchJson('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json'),
    safeFetchJson('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json'),
    safeFetchJson('https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json'),
    safeFetchText('https://www.hamqsl.com/solarxml.php'),
  ]);

  // Kp — last entry, column index 1 is the Kp value
  let kp = null;
  if (kpData.status === 'fulfilled' && Array.isArray(kpData.value) && kpData.value.length > 1) {
    const last = kpData.value[kpData.value.length - 1];
    kp = parseFloat(last[1]);
  }

  // SFI — latest entry
  let sfi = null;
  if (sfiData.status === 'fulfilled' && Array.isArray(sfiData.value) && sfiData.value.length > 0) {
    const last = sfiData.value[sfiData.value.length - 1];
    sfi = last.flux ?? last.f107 ?? last.value ?? null;
    if (sfi != null) sfi = parseFloat(sfi);
  }

  // SSN — last entry
  let ssn = null;
  if (ssnData.status === 'fulfilled' && Array.isArray(ssnData.value) && ssnData.value.length > 0) {
    const last = ssnData.value[ssnData.value.length - 1];
    ssn = last.ssn ?? last['smoothed_ssn'] ?? last['ssn-smoothed'] ?? null;
    if (ssn != null) ssn = parseFloat(ssn);
  }

  // Solar wind speed
  let solarWind = null;
  if (solarWindData.status === 'fulfilled' && solarWindData.value) {
    const d = solarWindData.value;
    solarWind = {
      speed: d.WindSpeed ?? d.speed ?? null,
      timestamp: d.TimeStamp ?? null,
    };
  }

  // X-ray flux — last entry from GOES xrays-6-hour feed
  let xray = null;
  if (xrayData.status === 'fulfilled' && Array.isArray(xrayData.value) && xrayData.value.length > 0) {
    const last = xrayData.value[xrayData.value.length - 1];
    const flux = last.flux ?? last.current_flux ?? null;
    if (flux != null) {
      const fluxNum = typeof flux === 'string' ? parseFloat(flux) : flux;
      xray = {
        flux: fluxNum,
        classification: classifyXray(fluxNum),
      };
    }
  }

  // A-Index from HamQSL XML feed
  let aIndex = null;
  if (hamqslData.status === 'fulfilled' && hamqslData.value) {
    const aVal = xmlVal(hamqslData.value, 'aindex');
    if (aVal) aIndex = parseInt(aVal, 10);
    // If SFI was not found from NOAA, try hamqsl as fallback
    if (sfi == null) {
      const sfiVal = xmlVal(hamqslData.value, 'solarflux');
      if (sfiVal) sfi = parseInt(sfiVal, 10);
    }
    // If SSN was not found from NOAA, try hamqsl as fallback
    if (ssn == null) {
      const ssnVal = xmlVal(hamqslData.value, 'sunspots');
      if (ssnVal) ssn = parseInt(ssnVal, 10);
    }
    // If X-ray was not found from GOES, try hamqsl as fallback
    if (xray == null) {
      const xrayVal = xmlVal(hamqslData.value, 'xray');
      if (xrayVal) {
        xray = {
          flux: null,
          classification: xrayVal,
        };
      }
    }
  }

  return { kp, sfi, ssn, aIndex, solarWind, xray, timestamp: new Date().toISOString() };
}

async function fetchBandData() {
  const xml = await safeFetchText('https://www.hamqsl.com/solarxml.php');

  const conditions = parseBandConditions(xml);
  const signalNoise = xmlVal(xml, 'signalnoise') ?? xmlVal(xml, 'noise');
  const aIndex = xmlVal(xml, 'aindex');
  const kIndex = xmlVal(xml, 'kindex');
  const solarFlux = xmlVal(xml, 'solarflux');
  const sunspots = xmlVal(xml, 'sunspots');
  const geomagField = xmlVal(xml, 'geomagfield') ?? xmlVal(xml, 'magneticfield');

  return {
    bands: conditions,
    signalNoise: signalNoise ? parseFloat(signalNoise) || signalNoise : null,
    aIndex: aIndex ? parseInt(aIndex, 10) : null,
    kIndex: kIndex ? parseInt(kIndex, 10) : null,
    solarFlux: solarFlux ? parseInt(solarFlux, 10) : null,
    sunspots: sunspots ? parseInt(sunspots, 10) : null,
    geomagField,
    timestamp: new Date().toISOString(),
  };
}

async function fetchDxSpots() {
  const text = await safeFetchText('https://www.dxwatch.com/dxsd1/s.php?s=0&r=50');

  const spots = [];
  const lines = text.split('\n');
  for (const line of lines) {
    // DX cluster spot format: "spotter  freq  dx  comment  time"
    const m = line.match(/([A-Z0-9/]+)\s+(\d{3,6}\.?\d*)\s+([A-Z0-9/]+)\s+(.*?)\s+(\d{4}Z?)/i);
    if (m) {
      const freq = parseFloat(m[2]);
      let band = 'Unknown';
      if (freq < 4000) band = '80m';
      else if (freq < 8000) band = '40m';
      else if (freq < 11000) band = '30m';
      else if (freq < 15000) band = '20m';
      else if (freq < 19000) band = '17m';
      else if (freq < 22000) band = '15m';
      else if (freq < 26000) band = '12m';
      else if (freq < 30000) band = '10m';
      else if (freq < 55000) band = '6m';
      else band = '2m+';

      spots.push({
        spotter: m[1],
        dx: m[3],
        frequency: freq,
        band,
        mode: guessMode(freq, m[4]),
        comment: m[4].trim(),
        time: new Date().toISOString(),
      });
      if (spots.length >= 20) break;
    }
  }

  return spots;
}

function guessMode(freq, comment) {
  const c = comment.toUpperCase();
  if (c.includes('FT8')) return 'FT8';
  if (c.includes('FT4')) return 'FT4';
  if (c.includes('RTTY')) return 'RTTY';
  if (c.includes('SSB') || c.includes('LSB') || c.includes('USB')) return 'SSB';
  if (c.includes('CW')) return 'CW';
  // Guess by frequency sub-band
  const khz = freq % 1000;
  if (khz < 100) return 'CW';
  if (khz >= 70 && khz <= 76) return 'FT8';
  if (khz > 100 && khz < 200) return 'RTTY';
  return 'SSB';
}

// ---------------------------------------------------------------------------
// Satellites
// ---------------------------------------------------------------------------
const TRACKED_SATS = [
  'ISS (ZARYA)', 'ISS', 'AO-91', 'AMSAT OSCAR 91', 'RADFXSAT',
  'SO-50', 'SAUDISAT 1C', 'FO-99', 'NEXUS', 'AO-92', 'FOX-1D',
  'CAS-4A', 'CAS-4B', 'IO-117', 'GREENCUBE', 'TEVEL-', 'PO-101',
  'AO-73', 'FUNCUBE-1',
];

function matchesSatName(tleName) {
  const upper = tleName.toUpperCase();
  return TRACKED_SATS.some(s => upper.includes(s.toUpperCase()));
}

function parseTLEs(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const tles = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
      tles.push({ name: lines[i], line1: lines[i + 1], line2: lines[i + 2] });
      i += 2;
    }
  }
  return tles;
}

function propagateSatellite(tle) {
  try {
    const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    const now = new Date();
    const positionAndVelocity = satellite.propagate(satrec, now);

    if (!positionAndVelocity.position) return null;

    const gmst = satellite.gstime(now);
    const geo = satellite.eciToGeodetic(positionAndVelocity.position, gmst);

    const lat = satellite.degreesLat(geo.latitude);
    const lng = satellite.degreesLong(geo.longitude);
    const alt = geo.height; // km

    // Velocity magnitude in km/s
    const vel = positionAndVelocity.velocity;
    const speed = vel
      ? Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2)
      : null;

    return {
      name: tle.name,
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      alt: Math.round(alt * 10) / 10,
      velocity: speed ? Math.round(speed * 100) / 100 : null,
    };
  } catch {
    return null;
  }
}

async function fetchSatelliteData() {
  // CelesTrak can be slow — use 30s timeout
  const res = await safeFetch(
    'https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle',
    30_000
  );
  let text;
  try { text = await res.text(); }
  catch { throw new Error('Failed to read CelesTrak response'); }

  const allTLEs = parseTLEs(text);
  const filtered = allTLEs.filter(t => t.name && matchesSatName(t.name));

  // Cache ISS TLE separately for pass prediction
  const issTle = allTLEs.find(t => {
    const upper = t.name.toUpperCase();
    return upper.includes('ISS (ZARYA)') || upper === 'ISS';
  });
  if (issTle) {
    cache._issTle = issTle;
  }

  // If filtering yields too few, include all amateur sats (capped)
  const tles = filtered.length >= 3 ? filtered : allTLEs.slice(0, 25);

  const results = tles.map(propagateSatellite).filter(Boolean);
  return { satellites: results, count: results.length, timestamp: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Map fetchers
// ---------------------------------------------------------------------------
async function fetchMufMap() {
  const NOAA_URL = 'https://services.swpc.noaa.gov/products/animations/ctipe-muf.json';
  const KC2G_URL = 'https://prop.kc2g.com/renders/current/mufd-normal-now.svg';

  try {
    const frames = await safeFetchJson(NOAA_URL);
    if (Array.isArray(frames) && frames.length > 0) {
      const latest = frames[frames.length - 1];
      const imageUrl = `https://services.swpc.noaa.gov/${latest.url}`;
      return { imageUrl, timestamp: latest.time_tag || new Date().toISOString() };
    }
  } catch {
    // Fall back to KC2G
  }

  return { imageUrl: KC2G_URL, timestamp: new Date().toISOString() };
}

async function fetchDrapMap() {
  // Use direct DRAP image URL (the animations JSON endpoint returns 404)
  const imageUrl = 'https://services.swpc.noaa.gov/images/animations/d-rap/global/d-rap/latest.png';
  // Verify it's reachable
  try {
    const res = await safeFetch(imageUrl);
    if (res.ok) return { imageUrl, timestamp: new Date().toISOString() };
  } catch { /* fall through */ }
  // Fallback: try alternate URL
  const alt = 'https://services.swpc.noaa.gov/images/d-rap-global.png';
  return { imageUrl: alt, timestamp: new Date().toISOString() };
}

async function fetchAuroraMap() {
  const JSON_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
  const IMAGE_URL = 'https://services.swpc.noaa.gov/images/aurora-forecast-northern-hemisphere.jpg';

  let auroraData = null;
  let observationTime = null;

  try {
    const json = await safeFetchJson(JSON_URL);
    if (Array.isArray(json) && json.length > 0) {
      // The JSON contains an array of [lon, lat, aurora_power] entries
      // preceded by a metadata object with Observation Time
      const meta = json.find(entry => entry['Observation Time']);
      observationTime = meta ? meta['Observation Time'] : null;
      auroraData = json.filter(entry => Array.isArray(entry));
    }
  } catch {
    // JSON fetch failed — still return the image URL
  }

  return {
    imageUrl: IMAGE_URL,
    data: auroraData || [],
    timestamp: observationTime || new Date().toISOString(),
  };
}

async function fetchSolarImages() {
  // These are static URLs that always serve the latest image from NASA SDO
  const images = [
    {
      type: 'AIA193',
      url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0193.jpg',
    },
    {
      type: 'HMI',
      url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIIC.jpg',
    },
  ];

  // Verify at least one image is reachable (HEAD request)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const check = await fetch(images[0].url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    if (!check.ok) throw new Error(`SDO returned ${check.status}`);
  } catch {
    // URLs are well-known and stable; return them anyway
  }

  return { images, timestamp: new Date().toISOString() };
}

async function fetchFoF2Map() {
  // Use direct foF2 image URL (the animations JSON endpoint returns 404)
  const imageUrl = 'https://services.swpc.noaa.gov/images/animations/ctipe/fof2/latest.png';
  try {
    const res = await safeFetch(imageUrl);
    if (res.ok) return { imageUrl, timestamp: new Date().toISOString() };
  } catch { /* fall through */ }
  // If not available, return null — foF2 is less critical
  return { imageUrl: null, timestamp: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Background polling — fetches data and updates cache
// ---------------------------------------------------------------------------
async function pollSource(name, fetchFn) {
  try {
    const data = await fetchFn();
    setCache(name, data);
    console.log(`[poll] ${name} updated`);
  } catch (err) {
    console.warn(`[poll] ${name} fetch failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// API endpoints — serve ONLY cached data, never block on upstream fetch
// ---------------------------------------------------------------------------
function serveCached(key, emptyFallback) {
  return (_req, res) => {
    const data = cache[key].data;
    if (data) return res.json(data);
    // Cache not yet populated (server just started)
    res.json(emptyFallback ?? { status: 'loading' });
  };
}

app.get('/api/solar', serveCached('solar', { status: 'loading' }));
app.get('/api/bands', serveCached('bands', { status: 'loading' }));
app.get('/api/dxspots', serveCached('dxspots', []));
app.get('/api/satellites', serveCached('satellites', { satellites: [], count: 0, status: 'loading' }));
app.get('/api/maps/muf', serveCached('mapMuf', { status: 'loading' }));
app.get('/api/maps/drap', serveCached('mapDrap', { status: 'loading' }));
app.get('/api/maps/aurora', serveCached('mapAurora', { status: 'loading' }));
app.get('/api/solar/image', serveCached('solarImage', { status: 'loading' }));
app.get('/api/maps/foF2', serveCached('mapFoF2', { status: 'loading' }));

// ---------------------------------------------------------------------------
// Endpoint: GET /api/iss-pass?lat=40&lng=-74 — predict next ISS pass
// ---------------------------------------------------------------------------
app.get('/api/iss-pass', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'Missing or invalid lat/lng parameters' });
  }

  // Find ISS TLE from cached satellite data
  const satData = cache.satellites.data;
  if (!satData) {
    return res.json({ name: 'ISS', nextPass: null });
  }

  // Re-parse TLEs from the raw text isn't possible since we only cache propagated positions.
  // We need the raw TLEs. Let's check if we stored them.
  // Actually, fetchSatelliteData doesn't store raw TLEs. We need to find the ISS TLE
  // from a separate approach: re-fetch from the allTLEs we parsed.
  // Better: let's store the raw TLE data in cache too.
  // For now, we'll use a dedicated TLE cache that the satellite poll populates.

  const issTle = cache._issTle;
  if (!issTle) {
    return res.json({ name: 'ISS', nextPass: null });
  }

  try {
    const satrec = satellite.twoline2satrec(issTle.line1, issTle.line2);
    const now = new Date();
    const observerGd = {
      longitude: satellite.degreesToRadians(lng),
      latitude: satellite.degreesToRadians(lat),
      height: 0, // assume sea level
    };

    // Scan next 24 hours in 30-second steps
    const STEP_MS = 30 * 1000;
    const SCAN_MS = 24 * 60 * 60 * 1000;

    let aosTime = null;
    let losTime = null;
    let maxEl = 0;
    let aosAz = 0;
    let losAz = 0;
    let prevElDeg = -999;
    let inPass = false;

    for (let dt = 0; dt <= SCAN_MS; dt += STEP_MS) {
      const t = new Date(now.getTime() + dt);
      const posVel = satellite.propagate(satrec, t);
      if (!posVel.position) continue;

      const gmst = satellite.gstime(t);
      const posEcf = satellite.eciToEcf(posVel.position, gmst);
      const lookAngles = satellite.ecfToLookAngles(observerGd, posEcf);

      const elDeg = satellite.radiansToDegrees(lookAngles.elevation);
      const azDeg = satellite.radiansToDegrees(lookAngles.azimuth);

      if (!inPass && elDeg > 0 && prevElDeg <= 0) {
        // AOS found
        inPass = true;
        aosTime = t;
        aosAz = azDeg;
        maxEl = elDeg;
      } else if (inPass && elDeg > maxEl) {
        maxEl = elDeg;
      }

      if (inPass && elDeg <= 0 && prevElDeg > 0) {
        // LOS found
        losTime = t;
        losAz = azDeg;
        break;
      }

      prevElDeg = elDeg;
    }

    if (!aosTime || !losTime) {
      return res.json({ name: 'ISS', nextPass: null });
    }

    const durationSec = Math.round((losTime.getTime() - aosTime.getTime()) / 1000);
    const countdownSec = Math.round((aosTime.getTime() - now.getTime()) / 1000);

    // Format countdown
    let countdown;
    if (countdownSec <= 0) {
      countdown = 'NOW';
    } else {
      const h = Math.floor(countdownSec / 3600);
      const m = Math.floor((countdownSec % 3600) / 60);
      countdown = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    // Normalize azimuths to 0-360
    const normAz = (az) => ((az % 360) + 360) % 360;

    res.json({
      name: 'ISS',
      aosTime: aosTime.toISOString(),
      losTime: losTime.toISOString(),
      maxElevation: Math.round(maxEl),
      duration: durationSec,
      aosAzimuth: Math.round(normAz(aosAz)),
      losAzimuth: Math.round(normAz(losAz)),
      countdown,
    });
  } catch (err) {
    console.error(`[iss-pass] Prediction failed: ${err.message}`);
    res.json({ name: 'ISS', nextPass: null });
  }
});

// ---------------------------------------------------------------------------
// Endpoint: /api/solar/proxy/:type — Proxy SDO solar images (avoids CORS)
// Binary data — proxy on-demand is fine
// ---------------------------------------------------------------------------
app.get('/api/solar/proxy/:type', async (req, res) => {
  const IMAGE_URLS = {
    'aia193': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg',
    'aia304': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0304.jpg',
    'aia171': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0171.jpg',
    'hmi-mag': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIBC.jpg',
    'hmi-int': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIC.jpg',
  };

  const url = IMAGE_URLS[req.params.type];
  if (!url) return res.status(404).json({ error: 'Unknown image type' });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000); // 15s — NASA can be slow
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=600'); // 10 min cache

    // Pipe the image data through
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    const isAbort = err.name === 'AbortError';
    console.error(`[solar-proxy] Failed to proxy ${req.params.type}: ${isAbort ? 'Request timed out (15s)' : err.message}`);
    res.status(502).json({
      error: 'Failed to fetch solar image',
      detail: isAbort ? 'Upstream request to NASA SDO timed out' : err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Propagation prediction helpers
// ---------------------------------------------------------------------------

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initialBearing(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360;
}

function coordToGrid(lat, lng) {
  lat = Math.max(-90, Math.min(90, lat));
  lng = Math.max(-180, Math.min(180, lng));
  let aLng = lng + 180;
  let aLat = lat + 90;
  const fLng = Math.floor(aLng / 20);
  const fLat = Math.floor(aLat / 10);
  aLng -= fLng * 20;
  aLat -= fLat * 10;
  const sLng = Math.floor(aLng / 2);
  const sLat = Math.floor(aLat / 1);
  return (
    String.fromCharCode(65 + fLng) +
    String.fromCharCode(65 + fLat) +
    sLng +
    sLat
  );
}

// Map band name to approximate center frequency in MHz
const BAND_FREQ_MHZ = {
  '160m': 1.9, '80m': 3.6, '60m': 5.3, '40m': 7.1, '30m': 10.1,
  '20m': 14.1, '17m': 18.1, '15m': 21.2, '12m': 24.9, '10m': 28.3, '6m': 50.1,
};

// Condition string to a numeric score (0-100 base)
function conditionScore(cond) {
  if (!cond || cond === 'Unknown') return 30;
  const c = cond.trim();
  if (c === 'Good') return 85;
  if (c === 'Fair') return 55;
  if (c === 'Poor') return 20;
  return 30;
}

function conditionLabel(score) {
  if (score >= 60) return 'Good';
  if (score >= 30) return 'Fair';
  return 'Poor';
}

// Estimate best operating window (UTC hours) for a given band and distance
function estimateBestTime(bandName, distKm) {
  const freq = BAND_FREQ_MHZ[bandName] || 14;
  // Low bands: nighttime; high bands: daytime
  if (freq < 5) return '02:00-08:00 UTC';
  if (freq < 8) return '22:00-06:00 UTC';
  if (freq < 12) return '00:00-04:00 UTC';
  if (freq < 16) return '12:00-20:00 UTC';
  if (freq < 22) return '14:00-18:00 UTC';
  if (freq < 30) return '14:00-18:00 UTC';
  return '10:00-16:00 UTC';
}

// Estimate SNR based on reliability score and distance
function estimateSnr(reliability, distKm) {
  // Rough approximation: higher reliability → higher SNR, further distance → lower SNR
  const base = (reliability / 100) * 25; // 0-25 dB range
  const distPenalty = Math.min(8, distKm / 2000); // up to -8 dB for very long paths
  return Math.max(-5, Math.round(base - distPenalty));
}

// Predict propagation reliability for a single band given conditions and path
function predictBand(bandName, bandConditions, distKm, utcHour) {
  const freq = BAND_FREQ_MHZ[bandName];
  if (!freq) return { reliability: 0, condition: 'Poor', snr: -10 };

  // Get day/night condition from cached data
  const isDay = utcHour >= 6 && utcHour < 18; // simplified
  let cond = 'Unknown';
  if (bandConditions && bandConditions.bands) {
    const tod = isDay ? 'day' : 'night';
    cond = bandConditions.bands[tod]?.[bandName] || 'Unknown';
  }

  let base = conditionScore(cond);

  // Distance modifier: short paths are easier, very long paths harder
  if (distKm < 500) base = Math.min(95, base + 15);
  else if (distKm < 2000) base = Math.min(95, base + 5);
  else if (distKm > 10000) base -= 10;
  else if (distKm > 15000) base -= 20;

  // Band/frequency modifier for distance suitability
  // Low bands good for short-medium, high bands good for medium-long (during day)
  if (freq < 5 && distKm > 5000) base -= 15;
  if (freq > 20 && distKm < 1000 && !isDay) base -= 20;
  if (freq >= 10 && freq <= 21 && distKm >= 2000 && distKm <= 12000 && isDay) base += 10;

  // Time-of-day modifier for the specific band
  if (freq < 8 && isDay) base -= 15; // low bands worse during day
  if (freq > 15 && !isDay) base -= 15; // high bands worse at night

  const reliability = Math.max(0, Math.min(100, Math.round(base)));
  const snr = estimateSnr(reliability, distKm);

  return {
    reliability,
    condition: conditionLabel(reliability),
    snr,
  };
}

// ---------------------------------------------------------------------------
// Endpoint: GET /api/propagation — predict HF propagation between two points
// ---------------------------------------------------------------------------
app.get('/api/propagation', (req, res) => {
  const fromLat = parseFloat(req.query.fromLat);
  const fromLng = parseFloat(req.query.fromLng);
  const toLat = parseFloat(req.query.toLat);
  const toLng = parseFloat(req.query.toLng);
  const band = req.query.band || '20m';

  if ([fromLat, fromLng, toLat, toLng].some(isNaN)) {
    return res.status(400).json({ error: 'Missing or invalid lat/lng parameters' });
  }

  const distKm = Math.round(haversineDistance(fromLat, fromLng, toLat, toLng));
  const bearing = Math.round(initialBearing(fromLat, fromLng, toLat, toLng));
  const fromGrid = coordToGrid(fromLat, fromLng);
  const toGrid = coordToGrid(toLat, toLng);

  const bandData = cache.bands.data; // may be null if not yet loaded
  const utcHour = new Date().getUTCHours();

  // Predict the requested band
  const primary = predictBand(band, bandData, distKm, utcHour);

  // Predict all major bands
  const allBandNames = ['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];
  const allBands = {};
  for (const b of allBandNames) {
    const p = predictBand(b, bandData, distKm, utcHour);
    allBands[b] = { reliability: p.reliability, condition: p.condition };
  }

  res.json({
    from: { lat: fromLat, lng: fromLng, grid: fromGrid },
    to: { lat: toLat, lng: toLng, grid: toGrid },
    distance: distKm,
    bearing,
    band,
    prediction: {
      reliability: primary.reliability,
      snr: primary.snr,
      condition: primary.condition,
      bestTime: estimateBestTime(band, distKm),
    },
    allBands,
  });
});

// ---------------------------------------------------------------------------
// Endpoint: /api/status — shows which data sources are loaded and their age
// ---------------------------------------------------------------------------
app.get('/api/status', (_req, res) => {
  const sources = ['solar', 'bands', 'dxspots', 'satellites', 'mapMuf', 'mapDrap', 'mapAurora', 'solarImage', 'mapFoF2'];
  const status = {};
  for (const key of sources) {
    const entry = cache[key];
    if (entry.data) {
      status[key] = {
        loaded: true,
        lastFetch: new Date(entry.ts).toISOString(),
        age: cacheAge(key),
      };
    } else {
      status[key] = { loaded: false };
    }
  }
  res.json(status);
});

// ---------------------------------------------------------------------------
// Endpoint: /api/health
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    cacheStatus: {
      solar: cache.solar.data ? 'populated' : 'empty',
      bands: cache.bands.data ? 'populated' : 'empty',
      dxspots: cache.dxspots.data ? 'populated' : 'empty',
      satellites: cache.satellites.data ? 'populated' : 'empty',
      mapMuf: cache.mapMuf.data ? 'populated' : 'empty',
      mapDrap: cache.mapDrap.data ? 'populated' : 'empty',
      mapAurora: cache.mapAurora.data ? 'populated' : 'empty',
      solarImage: cache.solarImage.data ? 'populated' : 'empty',
      mapFoF2: cache.mapFoF2.data ? 'populated' : 'empty',
    },
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Start server — begin listening immediately, fetch data in background
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`HamClock Reborn server running on http://localhost:${PORT}`);
  console.log('[startup] Beginning background data fetches...');

  // Phase 1: Solar + Bands (fastest, most important)
  pollSource('solar', fetchSolarData);
  pollSource('bands', fetchBandData);
  pollSource('solarImage', fetchSolarImages);

  // Phase 2: Maps (medium priority)
  pollSource('mapMuf', fetchMufMap);
  pollSource('mapDrap', fetchDrapMap);
  pollSource('mapAurora', fetchAuroraMap);
  pollSource('mapFoF2', fetchFoF2Map);

  // Phase 3: DX spots + Satellites (DX spots fast, satellites slow)
  pollSource('dxspots', fetchDxSpots);
  pollSource('satellites', fetchSatelliteData);

  // Background polling intervals
  setInterval(() => pollSource('solar', fetchSolarData),           5 * 60_000);   // every 5 min
  setInterval(() => pollSource('bands', fetchBandData),           10 * 60_000);   // every 10 min
  setInterval(() => pollSource('dxspots', fetchDxSpots),           1 * 60_000);   // every 60 sec
  setInterval(() => pollSource('satellites', fetchSatelliteData),  5 * 60_000);   // every 5 min
  setInterval(() => pollSource('mapMuf', fetchMufMap),            15 * 60_000);   // every 15 min
  setInterval(() => pollSource('mapDrap', fetchDrapMap),          15 * 60_000);   // every 15 min
  setInterval(() => pollSource('mapAurora', fetchAuroraMap),      15 * 60_000);   // every 15 min
  setInterval(() => pollSource('solarImage', fetchSolarImages),   15 * 60_000);   // every 15 min
  setInterval(() => pollSource('mapFoF2', fetchFoF2Map),          15 * 60_000);   // every 15 min
});

export default app;
