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
  const KC2G_URL = 'https://prop.kc2g.com/renders/current/mufd-normal-now.png';

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
  const NOAA_URL = 'https://services.swpc.noaa.gov/products/animations/d-region-absorption-predictions.json';

  const frames = await safeFetchJson(NOAA_URL);
  if (Array.isArray(frames) && frames.length > 0) {
    const latest = frames[frames.length - 1];
    const imageUrl = `https://services.swpc.noaa.gov/${latest.url}`;
    return { imageUrl, timestamp: latest.time_tag || new Date().toISOString() };
  }

  throw new Error('No DRAP animation frames returned');
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
  const NOAA_URL = 'https://services.swpc.noaa.gov/products/animations/ctipe-fof2.json';

  const frames = await safeFetchJson(NOAA_URL);
  if (Array.isArray(frames) && frames.length > 0) {
    const latest = frames[frames.length - 1];
    const imageUrl = `https://services.swpc.noaa.gov/${latest.url}`;
    return { imageUrl, timestamp: latest.time_tag || new Date().toISOString() };
  }

  throw new Error('No foF2 animation frames returned');
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
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=600'); // 10 min cache

    // Pipe the image data through
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[solar-proxy] Failed to proxy:', err.message);
    res.status(502).json({ error: 'Failed to fetch solar image' });
  }
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
