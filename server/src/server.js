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
  satellites: { data: null, ts: 0, ttl: 15 * 60_000 },
};

function getCached(key) {
  const entry = cache[key];
  if (entry.data && Date.now() - entry.ts < entry.ttl) return entry.data;
  return null;
}

function setCache(key, data) {
  cache[key].data = data;
  cache[key].ts = Date.now();
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

// Classify X-ray flux into solar flare class
function classifyXray(flux) {
  if (flux == null) return 'N/A';
  const v = typeof flux === 'string' ? parseFloat(flux) : flux;
  if (v >= 1e-4) return 'X';
  if (v >= 1e-5) return 'M';
  if (v >= 1e-6) return 'C';
  if (v >= 1e-7) return 'B';
  return 'A';
}

// ---------------------------------------------------------------------------
// Endpoint: /api/solar
// ---------------------------------------------------------------------------
async function fetchSolarData() {
  const [kpData, sfiData, ssnData, solarWindData, xrayData] = await Promise.allSettled([
    safeFetchJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
    safeFetchJson('https://services.swpc.noaa.gov/json/f107_cm_flux.json'),
    safeFetchJson('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json'),
    safeFetchJson('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json'),
    safeFetchJson('https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json'),
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

  // X-ray flux — last entry
  let xray = null;
  if (xrayData.status === 'fulfilled' && Array.isArray(xrayData.value) && xrayData.value.length > 0) {
    const last = xrayData.value[xrayData.value.length - 1];
    const flux = last.flux ?? last.current_flux ?? null;
    xray = {
      flux,
      class: classifyXray(flux),
    };
  }

  return { kp, sfi, ssn, solarWind, xray, timestamp: new Date().toISOString() };
}

app.get('/api/solar', async (_req, res) => {
  try {
    const cached = getCached('solar');
    if (cached) return res.json(cached);

    const data = await fetchSolarData();
    setCache('solar', data);
    res.json(data);
  } catch (err) {
    console.error('[/api/solar] Error:', err.message);
    const fallback = cache.solar.data;
    if (fallback) return res.json(fallback);
    res.status(502).json({ error: 'Failed to fetch solar data' });
  }
});

// ---------------------------------------------------------------------------
// Endpoint: /api/bands
// ---------------------------------------------------------------------------
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

app.get('/api/bands', async (_req, res) => {
  try {
    const cached = getCached('bands');
    if (cached) return res.json(cached);

    const data = await fetchBandData();
    setCache('bands', data);
    res.json(data);
  } catch (err) {
    console.error('[/api/bands] Error:', err.message);
    const fallback = cache.bands.data;
    if (fallback) return res.json(fallback);
    res.status(502).json({ error: 'Failed to fetch band conditions' });
  }
});

// ---------------------------------------------------------------------------
// Endpoint: /api/dxspots
// ---------------------------------------------------------------------------
function generateSampleDxSpots() {
  const spotters = ['W1AW', 'K3LR', 'N1MM', 'VE3NEA', 'DL1ABC', 'JA7XYZ', 'ZL1BQD', 'VK2IO', 'PY2SEX', 'EA4GPZ'];
  const dxCalls = ['9A1A', 'JT1AA', 'VU2PAI', 'ZS6BKW', 'A71A', 'FY5KE', 'VP8LP', 'V51WH', 'HS0ZIA', 'BV2AAA',
    'YB0ECT', 'E51DWC', 'SV9CVY', 'TF3ML', '5B4AQC', 'OX3LX', 'C6AGU', 'P40W', 'ZF2MJ', 'V26K'];
  const modes = ['CW', 'SSB', 'FT8', 'FT4', 'RTTY', 'SSB', 'CW', 'FT8'];
  const freqs = [
    { f: 3535, band: '80m' }, { f: 3573, band: '80m' },
    { f: 7012, band: '40m' }, { f: 7074, band: '40m' },
    { f: 10136, band: '30m' },
    { f: 14025, band: '20m' }, { f: 14074, band: '20m' }, { f: 14230, band: '20m' },
    { f: 18100, band: '17m' },
    { f: 21074, band: '15m' }, { f: 21225, band: '15m' },
    { f: 24915, band: '12m' },
    { f: 28074, band: '10m' }, { f: 28450, band: '10m' },
  ];
  const comments = ['CQ DX', 'Loud signal', '599 in EU', 'New DXCC!', 'QSL via LoTW', 'UP 1-2', 'TNX QSO', 'ATNO!',
    'Heard in NA', 'Good sigs', 'Pileup!', 'QRZ?'];

  const spots = [];
  const now = Date.now();
  for (let i = 0; i < 20; i++) {
    const freq = freqs[Math.floor(Math.random() * freqs.length)];
    spots.push({
      spotter: spotters[Math.floor(Math.random() * spotters.length)],
      dx: dxCalls[Math.floor(Math.random() * dxCalls.length)],
      frequency: freq.f + Math.floor(Math.random() * 10),
      band: freq.band,
      mode: modes[Math.floor(Math.random() * modes.length)],
      comment: comments[Math.floor(Math.random() * comments.length)],
      time: new Date(now - Math.floor(Math.random() * 30 * 60_000)).toISOString(),
    });
  }
  return spots.sort((a, b) => new Date(b.time) - new Date(a.time));
}

async function fetchDxSpots() {
  try {
    const text = await safeFetchText('https://www.dxwatch.com/dxsd1/s.php?s=0&r=50');

    // Try to parse the response — dxwatch returns HTML/text with spot data
    const spots = [];
    // Match lines that look like DX spots (callsign, freq, callsign pattern)
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

    if (spots.length > 0) return spots;
  } catch (err) {
    console.warn('[/api/dxspots] Live fetch failed, using sample data:', err.message);
  }

  // Fallback to generated sample spots
  return generateSampleDxSpots();
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

app.get('/api/dxspots', async (_req, res) => {
  try {
    const cached = getCached('dxspots');
    if (cached) return res.json(cached);

    const data = await fetchDxSpots();
    setCache('dxspots', data);
    res.json(data);
  } catch (err) {
    console.error('[/api/dxspots] Error:', err.message);
    const fallback = cache.dxspots.data;
    if (fallback) return res.json(fallback);
    res.json(generateSampleDxSpots());
  }
});

// ---------------------------------------------------------------------------
// Endpoint: /api/satellites
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

// Fallback satellite data when CelesTrak is unreachable
const FALLBACK_SATELLITES = [
  { name: 'ISS (ZARYA)', lat: 0, lng: 0, alt: 420, velocity: 7.66, noradId: 25544 },
  { name: 'AO-91 (FOX-1B)', lat: 0, lng: 0, alt: 450, velocity: 7.63, noradId: 43017 },
  { name: 'SO-50 (SAUDISAT-1C)', lat: 0, lng: 0, alt: 690, velocity: 7.51, noradId: 27607 },
];

app.get('/api/satellites', async (_req, res) => {
  try {
    const cached = getCached('satellites');
    if (cached) return res.json(cached);

    const data = await fetchSatelliteData();
    setCache('satellites', data);
    res.json(data);
  } catch (err) {
    console.error('[/api/satellites] Error:', err.message);
    const cached = cache.satellites?.data;
    if (cached) return res.json(cached);
    // Return fallback static data instead of 502
    res.json({ satellites: FALLBACK_SATELLITES, count: FALLBACK_SATELLITES.length, timestamp: new Date().toISOString(), fallback: true });
  }
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
    },
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Background polling
// ---------------------------------------------------------------------------
async function pollSolar() {
  try {
    const data = await fetchSolarData();
    setCache('solar', data);
    console.log('[poll] Solar data updated');
  } catch (err) {
    console.warn('[poll] Solar fetch failed:', err.message);
  }
}

async function pollBands() {
  try {
    const data = await fetchBandData();
    setCache('bands', data);
    console.log('[poll] Band conditions updated');
  } catch (err) {
    console.warn('[poll] Band fetch failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`HamClock Reborn server running on http://localhost:${PORT}`);

  // Initial fetches
  pollSolar();
  pollBands();

  // Background polling intervals
  setInterval(pollSolar, 5 * 60_000);   // every 5 min
  setInterval(pollBands, 10 * 60_000);   // every 10 min
});

export default app;
