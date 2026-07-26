import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import * as satellite from 'satellite.js';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3013;

app.use(cors());

// Global JSON body parser — deliberately left at the body-parser default of
// 100 kb. POST /api/telemetry is the ONE route that needs a bigger limit (a
// base64 PNG screenshot straddles 100 kb), so it is excluded here and mounts
// its own 1 mb parser. Raising the global limit would hand every other route a
// larger memory-exhaustion window for no reason.
const globalJsonParser = express.json();
app.use((req, res, next) => {
  if (isTelemetryIngestPath(req.path)) return next();
  return globalJsonParser(req, res, next);
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
const cache = {
  solar:      { data: null, ts: 0, ttl: 5 * 60_000 },
  bands:      { data: null, ts: 0, ttl: 10 * 60_000 },
  dxspots:    { data: null, ts: 0, ttl: 2 * 60_000 },
  satellites: { data: null, ts: 0, ttl: 5 * 60_000 },
  satTles:    { data: null, ts: 0, ttl: 30 * 60_000 },
  mapMuf:     { data: null, ts: 0, ttl: 15 * 60_000 },
  mapDrap:    { data: null, ts: 0, ttl: 15 * 60_000 },
  mapAurora:  { data: null, ts: 0, ttl: 15 * 60_000 },
  solarImage: { data: null, ts: 0, ttl: 15 * 60_000 },
  mapFoF2:    { data: null, ts: 0, ttl: 15 * 60_000 },
  potaSpots:  { data: null, ts: 0, ttl: 60_000 },
  sotaSpots:  { data: null, ts: 0, ttl: 60_000 },
};


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
    const val = parseFloat(last[1]);
    if (!isNaN(val)) kp = val;
  }

  // SFI — latest entry
  let sfi = null;
  if (sfiData.status === 'fulfilled' && Array.isArray(sfiData.value) && sfiData.value.length > 0) {
    const last = sfiData.value[sfiData.value.length - 1];
    sfi = last.flux ?? last.f107 ?? last.value ?? null;
    if (sfi != null) { const v = parseFloat(sfi); sfi = isNaN(v) ? null : v; }
  }

  // SSN — last entry
  let ssn = null;
  if (ssnData.status === 'fulfilled' && Array.isArray(ssnData.value) && ssnData.value.length > 0) {
    const last = ssnData.value[ssnData.value.length - 1];
    ssn = last.ssn ?? last['smoothed_ssn'] ?? last['ssn-smoothed'] ?? null;
    if (ssn != null) { const v = parseFloat(ssn); ssn = isNaN(v) ? null : v; }
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
    signalNoise: signalNoise || null,
    aIndex: aIndex ? parseInt(aIndex, 10) : null,
    kIndex: kIndex ? parseInt(kIndex, 10) : null,
    solarFlux: solarFlux ? parseInt(solarFlux, 10) : null,
    sunspots: sunspots ? parseInt(sunspots, 10) : null,
    geomagField,
    timestamp: new Date().toISOString(),
  };
}

// ── DX Spot Sources & Parsers ──────────────────────────────────────────

function freqToBand(freq) {
  if (freq < 2000) return '160m';
  if (freq < 4000) return '80m';
  if (freq < 5500) return '60m';
  if (freq < 8000) return '40m';
  if (freq < 11000) return '30m';
  if (freq < 15000) return '20m';
  if (freq < 19000) return '17m';
  if (freq < 22000) return '15m';
  if (freq < 26000) return '12m';
  if (freq < 30000) return '10m';
  if (freq < 55000) return '6m';
  return '2m+';
}

// Parse HamQTH time format: "HHMM YYYY-MM-DD" → ISO string
function parseHamQTHTime(timeStr) {
  if (!timeStr) return new Date().toISOString();
  try {
    // Format: "0524 2026-03-23"
    const m = timeStr.match(/(\d{2})(\d{2})\s+(\d{4}-\d{2}-\d{2})/);
    if (m) return new Date(`${m[3]}T${m[1]}:${m[2]}:00Z`).toISOString();
    return new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// HamQTH CSV format: spotter^freq^dx^comment^time date^L^E^continent^band^country^distance
function parseHamQTH(text) {
  const spots = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('^');
    if (parts.length < 5) continue;
    const spotter = parts[0];
    const freq = parseFloat(parts[1]);
    const dx = parts[2];
    const comment = parts[3] || '';
    const timeStr = parts[4] || '';
    if (!spotter || !dx || isNaN(freq) || freq < 1000) continue;
    spots.push({
      id: `${spotter}-${dx}-${freq}`,
      spotter,
      dx,
      frequency: freq,
      band: parts[8] || freqToBand(freq),
      mode: guessMode(freq, comment),
      comment: comment.trim(),
      time: parseHamQTHTime(timeStr),
    });
    if (spots.length >= 30) break;
  }
  return spots;
}

// Space-separated DX cluster format
function parseDxCluster(text) {
  const spots = [];
  for (const line of text.split('\n')) {
    const m = line.match(/([A-Z0-9/]{3,10})\s+(\d{3,6}\.?\d*)\s+([A-Z0-9/]{3,10})\s+(.*?)\s+(\d{4}Z?)/i);
    if (!m) continue;
    const freq = parseFloat(m[2]);
    if (isNaN(freq) || freq < 1000 || freq > 500000) continue;
    spots.push({
      id: `${m[1]}-${m[3]}-${freq}`,
      spotter: m[1],
      dx: m[3],
      frequency: freq,
      band: freqToBand(freq),
      mode: guessMode(freq, m[4] || ''),
      comment: (m[4] || '').trim(),
      time: new Date().toISOString(),
    });
    if (spots.length >= 30) break;
  }
  return spots;
}

async function fetchDxSpots() {
  // Try HamQTH first (works reliably, CSV format)
  try {
    const text = await safeFetchText('https://www.hamqth.com/dxc_csv.php?limit=30');
    console.log(`[DX] HamQTH raw response (${text.length} chars): ${text.substring(0, 200)}`);
    const spots = parseHamQTH(text);
    console.log(`[DX] HamQTH parsed ${spots.length} spots`);
    if (spots.length > 0) {
      console.log(`[DX] Got ${spots.length} spots from HamQTH`);
      return spots;
    }
  } catch (err) {
    console.error('[DX] HamQTH failed:', err.message);
  }

  // Fallback: DXWatch (may redirect)
  try {
    const text = await safeFetchText('https://www.dxwatch.com/dxsd1/s.php?s=0&r=50');
    console.log(`[DX] DXWatch raw response (${text.length} chars): ${text.substring(0, 200)}`);
    const spots = parseDxCluster(text);
    console.log(`[DX] DXWatch parsed ${spots.length} spots`);
    if (spots.length > 0) {
      console.log(`[DX] Got ${spots.length} spots from DXWatch`);
      return spots;
    }
  } catch (err) {
    console.error('[DX] DXWatch failed:', err.message);
  }

  // Fallback: HA8TKS
  try {
    const text = await safeFetchText('https://www.ha8tks.hu/dx/dxc_csv.php?limit=30');
    console.log(`[DX] HA8TKS raw response (${text.length} chars): ${text.substring(0, 200)}`);
    const spots = parseHamQTH(text); // Same CSV format as HamQTH
    console.log(`[DX] HA8TKS parsed ${spots.length} spots`);
    if (spots.length > 0) {
      console.log(`[DX] Got ${spots.length} spots from HA8TKS`);
      return spots;
    }
  } catch (err) {
    console.error('[DX] HA8TKS failed:', err.message);
  }

  console.log('[DX] All sources failed, returning empty');
  return [];
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

    if (!positionAndVelocity.position) {
      console.warn(`[sat] No position for ${tle.name}`);
      return null;
    }

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
  } catch (err) {
    console.warn(`[sat] SGP4 failed for ${tle.name}: ${err.message}`);
    return null;
  }
}

async function fetchSatelliteData() {
  // Try multiple TLE sources (CelesTrak primary, AMSAT fallback)
  const TLE_URLS = [
    'https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle',
    'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
    'https://www.amsat.org/tle/current/nasabare.txt',
  ];

  let allTLEs = [];
  for (const url of TLE_URLS) {
    try {
      const res = await safeFetch(url, 30_000);
      const text = await res.text();
      const tles = parseTLEs(text);
      console.log(`[sat] Got ${tles.length} TLEs from ${url}`);
      allTLEs = allTLEs.concat(tles);
      // If we have enough from first sources, skip slower ones
      if (allTLEs.length >= 20) break;
    } catch (err) {
      console.warn(`[sat] Failed to fetch TLEs from ${url}: ${err.message}`);
    }
  }

  if (allTLEs.length === 0) {
    console.error('[sat] No TLEs from any source');
    throw new Error('No TLE data available');
  }

  // Deduplicate by name
  const seen = new Set();
  allTLEs = allTLEs.filter(t => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });

  const filtered = allTLEs.filter(t => t.name && matchesSatName(t.name));
  console.log(`[sat] Matched ${filtered.length} tracked sats from ${allTLEs.length} total`);

  // Cache ISS TLE separately for pass prediction
  let issTle = allTLEs.find(t => {
    const upper = t.name.toUpperCase();
    return upper.includes('ISS (ZARYA)') || upper === 'ISS';
  });

  // If ISS not found in TLE files, try dedicated API
  if (!issTle) {
    try {
      const issRes = await safeFetch('https://tle.ivanstanojevic.me/api/tle/25544', 10_000);
      const issJson = await issRes.json();
      if (issJson.line1 && issJson.line2) {
        issTle = { name: issJson.name || 'ISS (ZARYA)', line1: issJson.line1, line2: issJson.line2 };
        allTLEs.push(issTle);
        console.log('[sat] ISS TLE from fallback API');
      }
    } catch (err) {
      console.warn(`[sat] ISS TLE fallback failed: ${err.message}`);
    }
  }

  if (issTle) {
    cache._issTle = issTle;
    console.log(`[sat] ISS TLE cached: ${issTle.name}`);
  }

  // If filtering yields too few, include all sats (capped)
  const tles = filtered.length >= 3 ? filtered : allTLEs.slice(0, 25);

  const results = tles.map(propagateSatellite).filter(Boolean);
  console.log(`[sat] Propagated ${results.length} satellites successfully`);

  // Cache raw TLEs for client-side pass prediction (Pass 2 panels)
  setCache('satTles', {
    tles: tles.map((t) => ({ name: t.name, line1: t.line1, line2: t.line2 })),
    count: tles.length,
    timestamp: new Date().toISOString(),
  });

  return { satellites: results, count: results.length, timestamp: new Date().toISOString() };
}

// ── POTA + SOTA live spots ─────────────────────────────────────────────
async function fetchPotaSpots() {
  // POTA API returns an array of recent activator spots.
  // Be defensive: validate shape, return [] on malformed response.
  let raw;
  try {
    raw = await safeFetchJson('https://api.pota.app/spot/activator');
  } catch (err) {
    console.warn(`[pota] Fetch failed: ${err.message}`);
    return [];
  }
  if (!Array.isArray(raw)) {
    console.warn('[pota] Response was not an array');
    return [];
  }
  // Normalize to a stable shape — keep only fields the frontend uses.
  const spots = raw.map((s) => ({
    reference: s.reference ?? '',
    parkName: s.name ?? s.parkName ?? '',
    activator: s.activator ?? '',
    spotter: s.spotter ?? null,
    frequency: s.frequency != null ? String(s.frequency) : '',
    mode: s.mode ?? '',
    spotTime: s.spotTime ?? '',
    comments: s.comments ?? null,
  })).filter((s) => s.activator && s.frequency);
  return spots;
}

async function fetchSotaSpots() {
  let raw;
  try {
    raw = await safeFetchJson('https://api2.sota.org.uk/api/spots/-1/all');
  } catch (err) {
    console.warn(`[sota] Fetch failed: ${err.message}`);
    return [];
  }
  if (!Array.isArray(raw)) {
    console.warn('[sota] Response was not an array');
    return [];
  }
  const spots = raw.map((s) => ({
    id: s.id ?? 0,
    callsign: s.callsign ?? s.activatorCallsign ?? '',
    summitCode: s.summitCode ?? '',
    summitName: s.summitName ?? '',
    associationCode: s.associationCode ?? '',
    frequency: s.frequency != null ? String(s.frequency) : '',
    mode: s.mode ?? '',
    timeStamp: s.timeStamp ?? '',
    comments: s.comments ?? null,
  })).filter((s) => s.callsign && s.frequency);
  return spots;
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
  // All 5 SDO image types
  const images = [
    { type: 'AIA193', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0193.jpg' },
    { type: 'AIA304', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0304.jpg' },
    { type: 'AIA171', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0171.jpg' },
    { type: 'HMI_MAG', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIBC.jpg' },
    { type: 'HMI_INT', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIIC.jpg' },
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
// Mutex to prevent overlapping polls
const pollLocks = {};

async function pollSource(name, fetchFn) {
  if (pollLocks[name]) {
    console.warn(`[poll] ${name} already running, skipping`);
    return;
  }
  pollLocks[name] = true;
  try {
    const data = await fetchFn();
    // Don't overwrite good data with empty results
    const isEmpty = (Array.isArray(data) && data.length === 0) ||
      (data && data.satellites && Array.isArray(data.satellites) && data.satellites.length === 0);
    const hasGoodCache = cache[name].data && (
      (Array.isArray(cache[name].data) && cache[name].data.length > 0) ||
      (cache[name].data.satellites && cache[name].data.satellites.length > 0)
    );
    if (isEmpty && hasGoodCache) {
      console.warn(`[poll] ${name} returned empty, keeping cached data`);
    } else {
      setCache(name, data);
      console.log(`[poll] ${name} updated${Array.isArray(data) ? ` (${data.length} items)` : ''}`);
    }
  } catch (err) {
    console.warn(`[poll] ${name} fetch failed: ${err.message}`);
  } finally {
    pollLocks[name] = false;
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
app.get('/api/satellites/tles', serveCached('satTles', { tles: [], count: 0, status: 'loading' }));
app.get('/api/pota/spots', serveCached('potaSpots', []));
app.get('/api/sota/spots', serveCached('sotaSpots', []));
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
// Server-side cache to avoid hammering NASA SDO
// ---------------------------------------------------------------------------
const proxyImageCache = {}; // { type: { buffer, contentType, ts } }
const PROXY_CACHE_TTL = 10 * 60_000; // 10 minutes

app.get('/api/solar/proxy/:type', async (req, res) => {
  const IMAGE_URLS = {
    'aia193': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg',
    'aia304': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0304.jpg',
    'aia171': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0171.jpg',
    'hmi-mag': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIBC.jpg',
    'hmi-int': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIC.jpg',
  };

  const type = req.params.type;
  const url = IMAGE_URLS[type];
  if (!url) return res.status(404).json({ error: 'Unknown image type' });

  // Serve from server cache if fresh
  const cached = proxyImageCache[type];
  if (cached && (Date.now() - cached.ts) < PROXY_CACHE_TTL) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.send(cached.buffer);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    // Cache on server
    proxyImageCache[type] = { buffer, contentType, ts: Date.now() };

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.send(buffer);
  } catch (err) {
    const isAbort = err.name === 'AbortError';
    console.error(`[solar-proxy] Failed to proxy ${type}: ${isAbort ? 'timeout' : err.message}`);
    // Serve stale cache if available
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.send(cached.buffer);
    }
    res.status(502).json({ error: 'Failed to fetch solar image' });
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
// Endpoint: GET /api/callsign/:call — lookup callsign location via free APIs
// ---------------------------------------------------------------------------
app.get('/api/callsign/:call', async (req, res) => {
  const call = (req.params.call || '').toUpperCase().trim();
  if (!call || call.length < 3) {
    return res.status(400).json({ error: 'Invalid callsign' });
  }

  // Try callook.info first (US callsigns, free, no registration)
  try {
    const data = await safeFetchJson(`https://callook.info/${encodeURIComponent(call)}/json`);
    if (data && data.status === 'VALID' && data.location) {
      const lat = parseFloat(data.location.latitude);
      const lng = parseFloat(data.location.longitude);
      if (!isNaN(lat) && !isNaN(lng)) {
        return res.json({
          callsign: call,
          grid: data.location.gridsquare || null,
          lat, lng,
          name: data.name || null,
          country: data.address?.line2 || null,
          source: 'callook',
        });
      }
    }
  } catch (err) {
    console.warn(`[callsign] callook failed for ${call}: ${err.message}`);
  }

  // Fallback: HamDB.org (international, free, no registration)
  try {
    const data = await safeFetchJson(`https://api.hamdb.org/${encodeURIComponent(call)}/json/hamclock`);
    if (data?.hamdb?.callsign?.grid) {
      const cs = data.hamdb.callsign;
      const lat = parseFloat(cs.lat);
      const lng = parseFloat(cs.lon);
      if (!isNaN(lat) && !isNaN(lng)) {
        return res.json({
          callsign: call,
          grid: cs.grid || null,
          lat, lng,
          name: [cs.fname, cs.name].filter(Boolean).join(' ') || null,
          country: cs.country || null,
          source: 'hamdb',
        });
      }
    }
  } catch (err) {
    console.warn(`[callsign] hamdb failed for ${call}: ${err.message}`);
  }

  // Not found in any database
  res.json({ callsign: call, grid: null, lat: null, lng: null, name: null, country: null, source: null });
});

// ---------------------------------------------------------------------------
// Endpoint: GET /api/propagation — predict HF propagation between two points
// ---------------------------------------------------------------------------
app.get('/api/propagation', (req, res) => {
  const fromLat = parseFloat(req.query.fromLat);
  const fromLng = parseFloat(req.query.fromLng);
  const toLat = parseFloat(req.query.toLat);
  const toLng = parseFloat(req.query.toLng);
  const VALID_BANDS = Object.keys(BAND_FREQ_MHZ);
  const band = VALID_BANDS.includes(req.query.band) ? req.query.band : '20m';

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
  const sources = ['solar', 'bands', 'dxspots', 'satellites', 'satTles', 'mapMuf', 'mapDrap', 'mapAurora', 'solarImage', 'mapFoF2', 'potaSpots', 'sotaSpots'];
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

// ===========================================================================
// OPT-IN DIAGNOSTICS TELEMETRY
// ---------------------------------------------------------------------------
// Receiving half of the HamClock Pi 1B opt-in diagnostics feature. The kiosk
// NEVER sends on its own: a report is transmitted only when the operator
// presses "send" on the device, every single time. This endpoint just accepts
// what arrives.
//
// It is reachable from the open internet (nginx proxies /api/ to :3013), so
// every byte below is treated as hostile:
//   * dedicated 1 mb body parser mounted on this route only
//   * in-memory rate limiter keyed by client IP, bounded key map
//   * strict shape validation, unknown top-level keys rejected
//   * screenshots verified as real PNGs, size-capped, written as files
//   * bounded disk use — reports and screenshots are pruned oldest-first
//   * receive time and a hashed/truncated IP recorded server-side; the
//     client-supplied `sent_at` is stored but never trusted
// Errors never echo submitted content and never leak a stack trace.
//
// NOTE ON PRIVACY: a screenshot shows the operator's callsign in the header,
// so a report WITH a screenshot is not anonymous. The Pi side says so plainly
// in its confirm step. Nothing here should ever be presented as anonymous.
// ===========================================================================

const TELEMETRY_SCHEMA = 1;
const TELEMETRY_ROUTE = '/api/telemetry';

const __filename_srv = fileURLToPath(import.meta.url);
const __dirname_srv = path.dirname(__filename_srv);

function envInt(name, def, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return n;
}

// Storage lives next to the app (server/data/... locally, /app/data/... in the
// container image, whose WORKDIR is /app and entrypoint is src/server.js).
// HAMCLOCK_TELEMETRY_DIR overrides it — used by the tests, and useful for
// pointing at a mounted volume in production.
const TELEMETRY_DIR = process.env.HAMCLOCK_TELEMETRY_DIR
  ? path.resolve(process.env.HAMCLOCK_TELEMETRY_DIR)
  : path.resolve(__dirname_srv, '..', 'data', 'telemetry');
const TELEMETRY_SHOTS_DIR = path.join(TELEMETRY_DIR, 'shots');
const TELEMETRY_LOG_PATH = path.join(TELEMETRY_DIR, 'reports.jsonl');
const TELEMETRY_TMP_PATH = path.join(TELEMETRY_DIR, 'reports.jsonl.tmp');
const TELEMETRY_SALT_PATH = path.join(TELEMETRY_DIR, 'ip-salt');

const TELEMETRY_LIMITS = {
  // Wire
  bodyLimit: '1mb',
  maxShotB64Chars: 560_000,          // ~410 kB decoded; body limit also caps this
  maxShotBytes: 400 * 1024,          // decoded PNG
  maxRecordJsonBytes: 16 * 1024,     // everything except the screenshot
  // Value shaping
  maxString: 200,
  maxKeys: 60,
  maxArray: 64,
  maxDepth: 6,
  // Rate limiting (per client IP)
  perHour: envInt('HAMCLOCK_TELEMETRY_RATE_HOUR', 10, 1, 100_000),
  perDay: envInt('HAMCLOCK_TELEMETRY_RATE_DAY', 60, 1, 1_000_000),
  readsPerHour: envInt('HAMCLOCK_TELEMETRY_READ_RATE_HOUR', 120, 1, 1_000_000),
  maxRateKeys: 5_000,                // bounded: the key map is itself a DoS vector
  // Disk
  maxReportsPerDevice: envInt('HAMCLOCK_TELEMETRY_MAX_PER_DEVICE', 25, 1, 100_000),
  maxReportsTotal: envInt('HAMCLOCK_TELEMETRY_MAX_REPORTS', 500, 1, 1_000_000),
  maxShotBytesTotal: 100 * 1024 * 1024,
  maxLogBytes: 32 * 1024 * 1024,
  // Read API
  defaultReadLimit: 25,
  maxReadLimit: 100,
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;
const SAFE_KEY_RE = /^[A-Za-z0-9_.:\- ]{1,64}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const TELEMETRY_TOP_KEYS = new Set([
  'schema', 'device_id', 'sent_at', 'app', 'host',
  'display', 'versions', 'perf', 'server', 'screenshot_png_b64',
]);
const TELEMETRY_SECTIONS = ['app', 'host', 'display', 'versions', 'perf', 'server'];

// The global body-parser skips this exact path (see top of file). Match the
// way Express matches: case-insensitively and ignoring a trailing slash.
function isTelemetryIngestPath(p) {
  const norm = String(p || '').toLowerCase().replace(/\/+$/, '');
  return norm === TELEMETRY_ROUTE;
}

// ---------------------------------------------------------------------------
// Telemetry: client IP
// ---------------------------------------------------------------------------
function normaliseIp(addr) {
  if (typeof addr !== 'string') return '';
  return addr.trim().slice(0, 45).replace(/^::ffff:/i, '').toLowerCase();
}

function isPlausibleIp(addr) {
  if (typeof addr !== 'string' || addr.length === 0 || addr.length > 45) return false;
  const a = addr.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) {
    return a.split('.').every((o) => Number(o) <= 255);
  }
  return /^[0-9a-f:]{2,45}$/i.test(a) && a.includes(':');
}

// Only a proxy on loopback / RFC1918 / ULA may speak for someone else.
function isTrustedProxyAddr(addr) {
  const a = normaliseIp(addr);
  if (!a) return false;
  if (a === '127.0.0.1' || a === '::1') return true;
  if (/^127\./.test(a)) return true;
  if (/^10\./.test(a)) return true;
  if (/^192\.168\./.test(a)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return true;      // IPv6 unique-local
  return false;
}

// Forwarding headers are honoured ONLY when the socket peer is our own proxy.
// nginx.conf *sets* X-Real-IP ($remote_addr) so a client cannot forge it, and
// *appends* to X-Forwarded-For — so only the first hop of XFF is ever read,
// and only as a fallback. A direct-to-:3013 caller gets its socket address and
// its headers ignored entirely.
function clientIp(req) {
  const socketAddr = (req.socket && req.socket.remoteAddress) || '';
  if (!isTrustedProxyAddr(socketAddr)) return normaliseIp(socketAddr) || 'unknown';

  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && isPlausibleIp(real.trim())) return normaliseIp(real);

  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length <= 1024) {
    const first = xff.split(',')[0].trim();
    if (isPlausibleIp(first)) return normaliseIp(first);
  }
  return normaliseIp(socketAddr) || 'unknown';
}

function truncateIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  }
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::/48`;
  return 'unknown';
}

let telemetryIpSalt = null;
function hashIp(ip) {
  if (!telemetryIpSalt) return null;
  return crypto.createHash('sha256').update(`${telemetryIpSalt}:${ip}`).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Telemetry: rate limiter (fixed window, bounded LRU key map)
// ---------------------------------------------------------------------------
function createRateLimiter({ perHour, perDay, maxKeys }) {
  const buckets = new Map();   // key -> { hStart, hCount, dStart, dCount }; Map keeps insertion order

  return function check(key, now = Date.now()) {
    // Amortised cleanup: retire the least-recently-seen bucket once its day
    // window has fully expired. Combined with the hard cap below the map can
    // never grow without limit.
    const oldestKey = buckets.keys().next();
    if (!oldestKey.done) {
      const oldest = buckets.get(oldestKey.value);
      if (oldest && now - oldest.dStart >= DAY_MS) buckets.delete(oldestKey.value);
    }

    let ent = buckets.get(key);
    if (!ent) ent = { hStart: now, hCount: 0, dStart: now, dCount: 0 };
    if (now - ent.hStart >= HOUR_MS) { ent.hStart = now; ent.hCount = 0; }
    if (now - ent.dStart >= DAY_MS) { ent.dStart = now; ent.dCount = 0; }

    let result;
    if (perDay !== undefined && ent.dCount >= perDay) {
      result = { allowed: false, retryAfter: Math.max(1, Math.ceil((ent.dStart + DAY_MS - now) / 1000)) };
    } else if (ent.hCount >= perHour) {
      result = { allowed: false, retryAfter: Math.max(1, Math.ceil((ent.hStart + HOUR_MS - now) / 1000)) };
    } else {
      ent.hCount += 1;
      ent.dCount += 1;
      result = { allowed: true, retryAfter: 0 };
    }

    // Re-insert to move to the back → the map is LRU-ordered by last request.
    buckets.delete(key);
    buckets.set(key, ent);
    while (buckets.size > maxKeys) {
      const victim = buckets.keys().next();
      if (victim.done) break;
      buckets.delete(victim.value);
    }
    return result;
  };
}

const telemetryPostLimiter = createRateLimiter({
  perHour: TELEMETRY_LIMITS.perHour,
  perDay: TELEMETRY_LIMITS.perDay,
  maxKeys: TELEMETRY_LIMITS.maxRateKeys,
});
const telemetryReadLimiter = createRateLimiter({
  perHour: TELEMETRY_LIMITS.readsPerHour,
  perDay: undefined,
  maxKeys: TELEMETRY_LIMITS.maxRateKeys,
});

// ---------------------------------------------------------------------------
// Telemetry: value sanitising
// ---------------------------------------------------------------------------
function sanitiseString(s) {
  // Hard-cap the length first (so a huge string is never rewritten whole),
  // then strip control characters — log-injection hygiene.
  return s.slice(0, TELEMETRY_LIMITS.maxString).replace(/[\u0000-\u001f\u007f]/g, ' ');
}

function sanitiseValue(v, depth = 0) {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string') return sanitiseString(v);
  if (t === 'number') return Number.isFinite(v) ? v : null;
  if (t === 'boolean') return v;
  if (t !== 'object') return null;                       // undefined/function/symbol/bigint
  if (depth >= TELEMETRY_LIMITS.maxDepth) return null;

  if (Array.isArray(v)) {
    return v.slice(0, TELEMETRY_LIMITS.maxArray).map((x) => sanitiseValue(x, depth + 1));
  }

  const out = {};
  let n = 0;
  for (const key of Object.keys(v)) {
    if (n >= TELEMETRY_LIMITS.maxKeys) break;
    if (UNSAFE_KEYS.has(key)) continue;                  // prototype-pollution guard
    if (!SAFE_KEY_RE.test(key)) continue;
    out[key] = sanitiseValue(v[key], depth + 1);
    n += 1;
  }
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function pick(obj, keys) {
  const out = {};
  if (!isPlainObject(obj)) return out;
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ---------------------------------------------------------------------------
// Telemetry: validation
//
// Errors are fixed strings. Nothing the caller submitted — not even a key name
// — is ever echoed back, so this can't be used as a reflection gadget.
// ---------------------------------------------------------------------------
function validateTelemetryBody(body) {
  if (!isPlainObject(body)) return { error: 'invalid_body', status: 400 };

  for (const key of Object.keys(body)) {
    if (!TELEMETRY_TOP_KEYS.has(key)) return { error: 'unknown_field', status: 400 };
  }

  if (body.schema !== TELEMETRY_SCHEMA) return { error: 'unsupported_schema', status: 400 };

  if (typeof body.device_id !== 'string' || !UUID_RE.test(body.device_id)) {
    return { error: 'invalid_device_id', status: 400 };
  }

  let sentAt = null;
  if (body.sent_at !== undefined && body.sent_at !== null) {
    if (typeof body.sent_at !== 'string' || body.sent_at.length > 40 || !ISO_RE.test(body.sent_at)) {
      return { error: 'invalid_sent_at', status: 400 };
    }
    sentAt = body.sent_at;
  }

  const sections = {};
  for (const name of TELEMETRY_SECTIONS) {
    const v = body[name];
    if (v === undefined || v === null) { sections[name] = null; continue; }
    if (!isPlainObject(v)) return { error: `invalid_${name}`, status: 400 };
    sections[name] = sanitiseValue(v, 1);
  }

  // Bound the non-screenshot part of the record before anything touches disk.
  const bodyBytes = Buffer.byteLength(JSON.stringify(sections));
  if (bodyBytes > TELEMETRY_LIMITS.maxRecordJsonBytes) {
    return { error: 'report_fields_too_large', status: 413 };
  }

  return {
    ok: true,
    deviceId: body.device_id.toLowerCase(),
    sentAt,
    sections,
    screenshotB64: body.screenshot_png_b64 === undefined ? null : body.screenshot_png_b64,
  };
}

// Returns { buf } (buf may be null when no screenshot was sent) or { error }.
function decodeScreenshot(raw) {
  if (raw === null || raw === undefined) return { buf: null };
  if (typeof raw !== 'string') return { error: 'invalid_screenshot', status: 400 };
  if (raw.length > TELEMETRY_LIMITS.maxShotB64Chars) return { error: 'screenshot_too_large', status: 413 };

  const clean = raw.replace(/\s+/g, '');
  if (clean.length === 0) return { buf: null };
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
    return { error: 'invalid_screenshot_encoding', status: 400 };
  }

  let buf;
  try { buf = Buffer.from(clean, 'base64'); }
  catch { return { error: 'invalid_screenshot_encoding', status: 400 }; }

  if (buf.length === 0) return { error: 'invalid_screenshot_encoding', status: 400 };
  if (buf.length > TELEMETRY_LIMITS.maxShotBytes) return { error: 'screenshot_too_large', status: 413 };
  if (buf.length < 33) return { error: 'screenshot_not_png', status: 400 };
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return { error: 'screenshot_not_png', status: 400 };
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return { error: 'screenshot_not_png', status: 400 };

  return { buf };
}

// ---------------------------------------------------------------------------
// Telemetry: storage
// ---------------------------------------------------------------------------
let telemetryReady = false;
const telemetryIndex = [];   // metadata only, oldest first
let telemetryWriteChain = Promise.resolve();

function enqueueTelemetryWrite(fn) {
  // Serialise every append/prune so concurrent requests can't interleave a
  // rewrite with an append.
  const run = telemetryWriteChain.then(fn, fn);
  telemetryWriteChain = run.then(() => {}, () => {});
  return run;
}

// Filename is derived here, never from anything the caller supplied.
function screenshotFileName(deviceId, id, whenMs) {
  const safeDevice = deviceId.toLowerCase().replace(/[^a-f0-9-]/g, '').slice(0, 36) || 'unknown';
  const stamp = new Date(whenMs).toISOString().replace(/[:.]/g, '-');
  const suffix = id.replace(/[^a-f0-9]/gi, '').slice(0, 8);
  return `${safeDevice}_${stamp}_${suffix}.png`;
}

function shotPathFor(name) {
  const full = path.resolve(TELEMETRY_SHOTS_DIR, name);
  if (path.dirname(full) !== path.resolve(TELEMETRY_SHOTS_DIR)) {
    throw new Error('screenshot path escapes storage directory');
  }
  return full;
}

// Public (unauthenticated) projection — see GET /api/telemetry/reports.
function publicView(record) {
  return {
    id: record.id,
    device_id: record.device_id,
    received_at: record.received_at,
    sent_at_claimed: record.sent_at_claimed ?? null,
    app: pick(record.app, ['version', 'mode', 'install']),
    host: pick(record.host, ['model', 'cpu', 'cores', 'mem_total_kb', 'kernel', 'os', 'python', 'uptime_s']),
    display: pick(record.display, ['sdl_driver', 'bitsize', 'size', 'fullscreen']),
    versions: pick(record.versions, ['pygame', 'sdl', 'cairosvg', 'cpulimit']),
    perf: pick(record.perf, ['frame_ms', 'panel_ms', 'boot_to_first_paint_s']),
    has_screenshot: Boolean(record.screenshot),
    screenshot_bytes: record.screenshot_bytes || 0,
  };
}

function indexEntry(record) {
  return {
    id: record.id,
    device_id: record.device_id,
    received_at: record.received_at,
    screenshot: record.screenshot || null,
    screenshot_bytes: record.screenshot_bytes || 0,
    view: publicView(record),
  };
}

function readLogTail(size) {
  // Only ever read the tail — a log that somehow grew past the cap must not be
  // slurped whole into memory.
  const max = TELEMETRY_LIMITS.maxLogBytes;
  if (size <= max) return fs.readFileSync(TELEMETRY_LOG_PATH, 'utf8');
  const fd = fs.openSync(TELEMETRY_LOG_PATH, 'r');
  try {
    const buf = Buffer.alloc(max);
    fs.readSync(fd, buf, 0, max, size - max);
    const text = buf.toString('utf8');
    return text.slice(text.indexOf('\n') + 1);   // drop the partial first line
  } finally {
    fs.closeSync(fd);
  }
}

function initTelemetryStorage() {
  try {
    fs.mkdirSync(TELEMETRY_SHOTS_DIR, { recursive: true });

    if (fs.existsSync(TELEMETRY_SALT_PATH)) {
      telemetryIpSalt = fs.readFileSync(TELEMETRY_SALT_PATH, 'utf8').trim();
    }
    if (!telemetryIpSalt) {
      telemetryIpSalt = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(TELEMETRY_SALT_PATH, `${telemetryIpSalt}\n`, { mode: 0o600 });
    }

    if (fs.existsSync(TELEMETRY_LOG_PATH)) {
      const { size } = fs.statSync(TELEMETRY_LOG_PATH);
      for (const line of readLogTail(size).split('\n')) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line);
          if (rec && typeof rec.id === 'string' && typeof rec.device_id === 'string') {
            telemetryIndex.push(indexEntry(rec));
          }
        } catch { /* skip unparseable line */ }
      }
      // Trim anything that is already over the retention caps.
      if (telemetryIndex.length > TELEMETRY_LIMITS.maxReportsTotal) {
        telemetryIndex.splice(0, telemetryIndex.length - TELEMETRY_LIMITS.maxReportsTotal);
      }
    }

    telemetryReady = true;
    console.log(`[telemetry] storage ready at ${TELEMETRY_DIR} (${telemetryIndex.length} report(s) on disk)`);
    enqueueTelemetryWrite(() => sweepOrphanScreenshots());
    enqueueTelemetryWrite(() => enforceRetention());
  } catch (err) {
    telemetryReady = false;
    console.warn(`[telemetry] storage unavailable — endpoint will refuse reports: ${err.message}`);
  }
}

// Delete screenshot files that no record references (crash between the file
// write and the log append would otherwise leak bytes forever).
async function sweepOrphanScreenshots() {
  try {
    const referenced = new Set(telemetryIndex.map((e) => e.screenshot).filter(Boolean));
    const files = await fsp.readdir(TELEMETRY_SHOTS_DIR);
    for (const f of files) {
      if (!f.endsWith('.png') || referenced.has(f)) continue;
      await fsp.unlink(shotPathFor(f)).catch(() => {});
    }
  } catch { /* non-fatal */ }
}

// Caps are hard ceilings; when one is crossed we prune down to a low-water
// mark (90%) rather than to the ceiling. Pruning rewrites the whole log, so
// pruning in batches keeps a flood from forcing a full rewrite on every single
// accepted report while the stored total stays bounded either way.
function lowWater(cap) {
  return Math.max(1, Math.ceil(cap * 0.9));
}

function selectForEviction() {
  const drop = new Set();
  const perDevice = new Map();
  const perDeviceTotals = new Map();
  for (const e of telemetryIndex) {
    perDeviceTotals.set(e.device_id, (perDeviceTotals.get(e.device_id) || 0) + 1);
  }

  // Per-device cap, keeping the most recent.
  const deviceLow = lowWater(TELEMETRY_LIMITS.maxReportsPerDevice);
  for (let i = telemetryIndex.length - 1; i >= 0; i -= 1) {
    const e = telemetryIndex[i];
    if ((perDeviceTotals.get(e.device_id) || 0) <= TELEMETRY_LIMITS.maxReportsPerDevice) continue;
    const seen = (perDevice.get(e.device_id) || 0) + 1;
    perDevice.set(e.device_id, seen);
    if (seen > deviceLow) drop.add(e.id);
  }

  // Global count cap, oldest first.
  let kept = telemetryIndex.length - drop.size;
  if (kept > TELEMETRY_LIMITS.maxReportsTotal) {
    const target = lowWater(TELEMETRY_LIMITS.maxReportsTotal);
    for (let i = 0; i < telemetryIndex.length && kept > target; i += 1) {
      if (drop.has(telemetryIndex[i].id)) continue;
      drop.add(telemetryIndex[i].id);
      kept -= 1;
    }
  }

  // Total screenshot bytes cap, oldest first.
  let bytes = 0;
  for (const e of telemetryIndex) if (!drop.has(e.id)) bytes += e.screenshot_bytes || 0;
  if (bytes > TELEMETRY_LIMITS.maxShotBytesTotal) {
    const target = Math.floor(TELEMETRY_LIMITS.maxShotBytesTotal * 0.9);
    for (let i = 0; i < telemetryIndex.length && bytes > target; i += 1) {
      const e = telemetryIndex[i];
      if (drop.has(e.id)) continue;
      drop.add(e.id);
      bytes -= e.screenshot_bytes || 0;
    }
  }

  return drop;
}

async function enforceRetention() {
  if (!telemetryReady) return;
  const drop = selectForEviction();
  if (drop.size === 0) return;

  for (const e of telemetryIndex) {
    if (drop.has(e.id) && e.screenshot) {
      await fsp.unlink(shotPathFor(e.screenshot)).catch(() => {});
    }
  }

  const keep = telemetryIndex.filter((e) => !drop.has(e.id));
  telemetryIndex.length = 0;
  telemetryIndex.push(...keep);
  const keepIds = new Set(keep.map((e) => e.id));

  try {
    const { size } = await fsp.stat(TELEMETRY_LOG_PATH);
    const lines = readLogTail(size).split('\n');
    const out = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && keepIds.has(rec.id)) out.push(line);
      } catch { /* drop unparseable line */ }
    }
    await fsp.writeFile(TELEMETRY_TMP_PATH, out.length ? `${out.join('\n')}\n` : '');
    await fsp.rename(TELEMETRY_TMP_PATH, TELEMETRY_LOG_PATH);
    console.log(`[telemetry] pruned ${drop.size} report(s); ${keep.length} retained`);
  } catch (err) {
    console.warn(`[telemetry] prune failed: ${err.message}`);
  }
}

async function storeTelemetryReport(record, shotBuf) {
  return enqueueTelemetryWrite(async () => {
    if (record.screenshot && shotBuf) {
      let name = record.screenshot;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await fsp.writeFile(shotPathFor(name), shotBuf, { flag: 'wx', mode: 0o600 });
          break;
        } catch (err) {
          if (err.code !== 'EEXIST' || attempt === 4) throw err;
          name = name.replace(/\.png$/, `-${crypto.randomBytes(2).toString('hex')}.png`);
        }
      }
      record.screenshot = name;
    }

    try {
      await fsp.appendFile(TELEMETRY_LOG_PATH, `${JSON.stringify(record)}\n`);
    } catch (err) {
      if (record.screenshot) await fsp.unlink(shotPathFor(record.screenshot)).catch(() => {});
      throw err;
    }

    telemetryIndex.push(indexEntry(record));
    await enforceRetention();
  });
}

// ---------------------------------------------------------------------------
// Telemetry: middleware
// ---------------------------------------------------------------------------
const telemetryJsonParser = express.json({ limit: TELEMETRY_LIMITS.bodyLimit });

function telemetryRateLimit(req, res, next) {
  // Runs BEFORE the body parser so a flood of 1 mb bodies is rejected cheaply.
  const { allowed, retryAfter } = telemetryPostLimiter(clientIp(req));
  if (allowed) return next();
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ ok: false, error: 'rate_limited', retry_after_s: retryAfter });
}

function telemetryBody(req, res, next) {
  if (!req.is('application/json')) {
    return res.status(415).json({ ok: false, error: 'unsupported_media_type' });
  }
  telemetryJsonParser(req, res, (err) => {
    if (!err) return next();
    // body-parser puts a slice of the offending body in err.message — never
    // forward it. Fixed strings only.
    const status = err.type === 'entity.too.large' ? 413 : (err.status === 415 ? 415 : 400);
    const error = status === 413 ? 'payload_too_large'
      : status === 415 ? 'unsupported_media_type'
        : 'invalid_json';
    return res.status(status).json({ ok: false, error });
  });
}

// ---------------------------------------------------------------------------
// Endpoint: POST /api/telemetry — receive one opt-in diagnostics report
// ---------------------------------------------------------------------------
app.post(TELEMETRY_ROUTE, telemetryRateLimit, telemetryBody, async (req, res) => {
  try {
    if (!telemetryReady) {
      return res.status(503).json({ ok: false, error: 'telemetry_unavailable' });
    }

    const v = validateTelemetryBody(req.body);
    if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });

    const shot = decodeScreenshot(v.screenshotB64);
    if (shot.error) return res.status(shot.status).json({ ok: false, error: shot.error });

    const id = crypto.randomUUID();
    const nowMs = Date.now();
    const ip = clientIp(req);
    const ua = typeof req.headers['user-agent'] === 'string'
      ? sanitiseString(req.headers['user-agent']).slice(0, 120)
      : null;

    const record = {
      id,
      received_at: new Date(nowMs).toISOString(),   // server clock; the client's is not trusted
      ip_hash: hashIp(ip),
      ip_trunc: truncateIp(ip),
      user_agent: ua,
      schema: TELEMETRY_SCHEMA,
      device_id: v.deviceId,
      sent_at_claimed: v.sentAt,
      app: v.sections.app,
      host: v.sections.host,
      display: v.sections.display,
      versions: v.sections.versions,
      perf: v.sections.perf,
      server: v.sections.server,
      // The PNG is written as a FILE; only its name lands in the log line.
      screenshot: shot.buf ? screenshotFileName(v.deviceId, id, nowMs) : null,
      screenshot_bytes: shot.buf ? shot.buf.length : 0,
    };

    await storeTelemetryReport(record, shot.buf);

    console.log(`[telemetry] accepted ${id} device=${v.deviceId.slice(0, 8)} ` +
      `shot=${record.screenshot_bytes}B ip=${record.ip_trunc}`);
    return res.json({ ok: true, id });
  } catch (err) {
    console.error(`[telemetry] report rejected: ${err.message}`);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ---------------------------------------------------------------------------
// Endpoint: GET /api/telemetry/reports?limit=N — what actually arrived
//
// UNAUTHENTICATED: nginx proxies /api/ straight through, so anyone on the
// internet can read this. It therefore exposes metadata ONLY — device_id,
// timestamps, hardware model, display/driver/depth, library versions and
// timings. Never the screenshots, never the raw `server` diagnostics blob,
// never the IP (not even the hashed form), never the user agent. Anything
// added here must pass the same test: harmless to a stranger.
// ---------------------------------------------------------------------------
app.get('/api/telemetry/reports', (req, res) => {
  try {
    const { allowed, retryAfter } = telemetryReadLimiter(clientIp(req));
    if (!allowed) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ ok: false, error: 'rate_limited', retry_after_s: retryAfter });
    }

    let limit = TELEMETRY_LIMITS.defaultReadLimit;
    const raw = req.query.limit;
    if (typeof raw === 'string' && raw.length <= 8) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) limit = Math.min(Math.max(n, 1), TELEMETRY_LIMITS.maxReadLimit);
    }

    const slice = telemetryIndex.slice(-limit).reverse();   // newest first
    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      total: telemetryIndex.length,
      count: slice.length,
      limit,
      reports: slice.map((e) => e.view),
    });
  } catch (err) {
    console.error(`[telemetry] reports listing failed: ${err.message}`);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

initTelemetryStorage();

// ---------------------------------------------------------------------------
// Start server — begin listening immediately, fetch data in background
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`HamClock Reborn server running on http://localhost:${PORT}`);

  // Test hook: HAMCLOCK_DISABLE_POLLING=1 keeps the upstream fetches from
  // firing so the telemetry tests never touch the network. Unset in
  // production, where this branch is exactly the original startup sequence.
  if (process.env.HAMCLOCK_DISABLE_POLLING === '1') {
    console.log('[startup] Background data fetches disabled (HAMCLOCK_DISABLE_POLLING=1)');
    return;
  }

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

  // Phase 4: Live activator spots (POTA + SOTA)
  pollSource('potaSpots', fetchPotaSpots);
  pollSource('sotaSpots', fetchSotaSpots);

  // Background polling intervals
  setInterval(() => pollSource('solar', fetchSolarData),           5 * 60_000);   // every 5 min
  setInterval(() => pollSource('bands', fetchBandData),           10 * 60_000);   // every 10 min
  setInterval(() => pollSource('dxspots', fetchDxSpots),           2 * 60_000);   // every 2 min
  setInterval(() => pollSource('satellites', fetchSatelliteData),  5 * 60_000);   // every 5 min
  setInterval(() => pollSource('mapMuf', fetchMufMap),            15 * 60_000);   // every 15 min
  setInterval(() => pollSource('mapDrap', fetchDrapMap),          15 * 60_000);   // every 15 min
  setInterval(() => pollSource('mapAurora', fetchAuroraMap),      15 * 60_000);   // every 15 min
  setInterval(() => pollSource('solarImage', fetchSolarImages),   15 * 60_000);   // every 15 min
  setInterval(() => pollSource('mapFoF2', fetchFoF2Map),          15 * 60_000);   // every 15 min
  setInterval(() => pollSource('potaSpots', fetchPotaSpots),       60_000);       // every 60 s
  setInterval(() => pollSource('sotaSpots', fetchSotaSpots),       60_000);       // every 60 s
});

export default app;
