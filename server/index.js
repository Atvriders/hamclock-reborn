import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

const app = express();
const PORT = 3013;

app.use(cors());
app.use(express.json());

// ----- Simple in-memory cache --------------------------------
const cache = new Map();
const CACHE_TTL = {
  solar: 5 * 60 * 1000,        // 5 min
  bands: 10 * 60 * 1000,       // 10 min
  dxspots: 60 * 1000,          // 1 min
  satellites: 60 * 60 * 1000,  // 1 hour (TLEs)
  contests: 6 * 60 * 60 * 1000,// 6 hours
};

function getCached(key, ttl) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ----- Health check ------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ----- Solar data (aggregated from NOAA + HamQSL) -----------
app.get('/api/solar', async (_req, res) => {
  try {
    const cached = getCached('solar', CACHE_TTL.solar);
    if (cached) return res.json(cached);

    const [kpRes, windRes, hamqslRes] = await Promise.allSettled([
      fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
      fetch('https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json'),
      fetch('https://www.hamqsl.com/solarxml.php'),
    ]);

    // Parse Kp — last row of the array (skip header)
    let kp = 0;
    if (kpRes.status === 'fulfilled') {
      const kpData = await kpRes.value.json();
      if (Array.isArray(kpData) && kpData.length > 1) {
        const last = kpData[kpData.length - 1];
        kp = parseFloat(last[1]) || 0;
      }
    }

    // Parse solar wind
    let solarWind = { speed: 0, density: 0, bz: 0, bt: 0 };
    if (windRes.status === 'fulfilled') {
      const windData = await windRes.value.json();
      solarWind = {
        speed: parseFloat(windData.WindSpeed) || 0,
        density: parseFloat(windData.Density) || 0,
        bz: parseFloat(windData.Bz) || 0,
        bt: parseFloat(windData.Bt) || 0,
      };
    }

    // Parse HamQSL XML for SFI, SSN, A-index, X-ray
    let sfi = 0, ssn = 0, aIndex = 0;
    let xray = { flux: 0, classification: 'N/A' };
    if (hamqslRes.status === 'fulfilled') {
      const xml = await hamqslRes.value.text();
      const parsed = await parseStringPromise(xml, { explicitArray: false });
      const sd = parsed?.solar?.solardata;
      if (sd) {
        sfi = parseFloat(sd.solarflux) || 0;
        ssn = parseFloat(sd.sunspots) || 0;
        aIndex = parseFloat(sd.aindex) || 0;
        xray = {
          flux: parseFloat(sd.xray) || 0,
          classification: sd.xray || 'N/A',
        };
      }
    }

    const result = {
      sfi,
      kp,
      ssn,
      aIndex,
      solarWind,
      xray,
      geomagField: {
        stormLevel: kp >= 5 ? 'Storm' : kp >= 4 ? 'Active' : 'Quiet',
        geomagStormProb24h: 0,
      },
      timestamp: new Date().toISOString(),
    };

    setCache('solar', result);
    res.json(result);
  } catch (err) {
    console.error('Solar fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- Band conditions (HamQSL XML) -------------------------
app.get('/api/bands', async (_req, res) => {
  try {
    const cached = getCached('bands', CACHE_TTL.bands);
    if (cached) return res.json(cached);

    const response = await fetch('https://www.hamqsl.com/solarxml.php');
    const xml = await response.text();
    const parsed = await parseStringPromise(xml, { explicitArray: false });

    const data = parsed?.solar?.solardata;
    if (!data) throw new Error('Unexpected XML structure');

    // Build Record<bandName, { day, night }> from calculatedconditions
    const conditions = {};
    const bands = data.calculatedconditions?.band;
    if (Array.isArray(bands)) {
      for (const b of bands) {
        const name = b.$.name;
        const time = b.$.time;   // "day" or "night"
        const cond = b._;        // "Good", "Fair", "Poor"
        if (!conditions[name]) conditions[name] = { day: 'Poor', night: 'Poor' };
        conditions[name][time] = cond;
      }
    }

    const result = {
      conditions,
      signalNoise: data.signalnoise || 'N/A',
      timestamp: new Date().toISOString(),
    };

    setCache('bands', result);
    res.json(result);
  } catch (err) {
    console.error('Bands fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- DX Spots (DXWatch) ------------------------------------
app.get('/api/dxspots', async (_req, res) => {
  try {
    const cached = getCached('dxspots', CACHE_TTL.dxspots);
    if (cached) return res.json(cached);

    const result = { spots: [], count: 0, timestamp: new Date().toISOString() };
    setCache('dxspots', result);
    res.json(result);
  } catch (err) {
    console.error('DX spots fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- Satellite TLEs (CelesTrak) ----------------------------
app.get('/api/satellites', async (_req, res) => {
  try {
    const cached = getCached('satellites', CACHE_TTL.satellites);
    if (cached) return res.json(cached);

    const response = await fetch(
      'https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle'
    );
    const text = await response.text();
    const lines = text.trim().split('\n');

    const tles = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      tles.push({
        name: lines[i].trim(),
        line1: lines[i + 1].trim(),
        line2: lines[i + 2].trim(),
      });
    }

    setCache('satellites', tles);
    res.json(tles);
  } catch (err) {
    console.error('Satellite TLE fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- Start server ------------------------------------------
app.listen(PORT, () => {
  console.log(`HamClock Reborn API running on http://localhost:${PORT}`);
});
