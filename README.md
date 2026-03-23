# HamClock Reborn

Modern web-based replacement for HamClock (ending June 2026). A real-time ham radio dashboard featuring solar data, band conditions, DX cluster, satellite tracking, propagation prediction, and an interactive world map — all running in your browser.

## Features

**Setup:**
- Callsign setup screen with 134 prefix-to-country auto-lookup (auto-fills lat/lng and Maidenhead grid)
- Skippable setup for anonymous use

**Solar and Space Weather:**
- Solar data panel — SFI, SSN, X-Ray flux class, Kp bar graph, A-Index, Solar Wind speed
- SDO Solar images — 5 types (AIA 193/304/171, HMI Magnetogram, HMI Intensitygram), circular crop, click to expand, SOHO fallback URLs
- WSA-Enlil solar wind prediction widget
- DRAP D-Region Absorption Prediction widget
- Aurora oval forecast widget (NOAA northern hemisphere image + JSON data)
- X-Ray flux plot (NOAA GOES, embedded via iframe)

**Propagation:**
- KC2G MUF propagation map widget
- HF band conditions panel (80m-10m, day/night, Good/Fair/Poor colored dots)
- HRDLog propagation graph widget
- VOACAP-style propagation prediction (DE to DX, per-band reliability table with distance, bearing, grid squares, SNR, best time)
- Propagation heat map overlay on map (band-specific, grid-cell reliability shading from QTH)

**DX and Satellites:**
- DX Cluster panel (3 fallback sources: DXWatch, HA8TKS, HamQTH; up to 30 spots; band-colored, mode detection)
- ISS pass prediction (countdown timer, max elevation, AOS/LOS azimuth, duration)
- Satellite tracking (ISS, AO-91, SO-50, FO-99, CAS-4A/B, IO-117, and more via SGP4 propagation)

**World Map (Leaflet):**
- Day/night overlay (grid rectangle approach, updates every 60s)
- Gray line (dawn/dusk terminator + twilight polylines)
- 188 callsign prefix labels (zoom-scaled: major countries at zoom 2+, all at zoom 6+)
- Maidenhead grid squares (toggleable)
- DX spot markers with callsign tooltips
- Satellite position markers
- QTH home location marker
- DE-to-DX great circle path (click map to set DX endpoint)
- Propagation heat map overlay (band-specific reliability from QTH)
- 4 map styles: Dark, Satellite, Terrain, Light
- Layer control panel with toggle checkboxes (Day/Night, Gray Line, MUF Map, Grid Squares, Prefixes)

**Layout:**
- Desktop: CSS Grid 3-column layout (left sidebar, center map, right sidebar) with header and bottom band bar
- Left sidebar: Solar panel + tabbed widgets (Enlil/KC2G/DRAP, SDO Solar/Aurora)
- Right sidebar: Band conditions + DX cluster + ISS pass + tabbed widgets (X-Ray/HRDLog/Propagation)
- Bottom band bar (80m-6m with center frequencies)
- Mobile responsive: 5-tab layout (Solar, Bands, DX, Space, Tools) with compact header and half-screen map
- Tabbed sidebar widgets for space-efficient navigation
- ErrorBoundary for crash protection

**General:**
- UTC + local clocks with callsign display in header
- Classic ham radio aesthetic (green on black, monospace numbers)
- All data from free public APIs — no API keys needed
- Runs on Raspberry Pi (all models including Zero W)

## API Endpoints

| Endpoint | Description | Server Cache TTL | Client Poll |
|----------|-------------|-----------------|-------------|
| `GET /api/solar` | Solar/space weather (Kp, SFI, SSN, A-Index, X-Ray, Solar Wind) | 5 min | 5 min |
| `GET /api/bands` | HF band conditions (HamQSL XML) | 10 min | 10 min |
| `GET /api/dxspots` | DX cluster spots (3 fallback sources) | 1 min | 60 sec |
| `GET /api/satellites` | Satellite positions via SGP4 (CelesTrak TLEs) | 5 min | 30 sec |
| `GET /api/iss-pass?lat=&lng=` | ISS next pass prediction (AOS, LOS, max el, azimuth) | — | on-demand |
| `GET /api/propagation?fromLat=&fromLng=&toLat=&toLng=&band=` | HF propagation prediction (per-band reliability, SNR, bearing) | — | on-demand |
| `GET /api/maps/muf` | MUF propagation map URL (NOAA CTIPE, KC2G fallback) | 15 min | — |
| `GET /api/maps/drap` | D-Region Absorption map URL | 15 min | — |
| `GET /api/maps/aurora` | Aurora oval data + image URL | 15 min | — |
| `GET /api/maps/foF2` | Critical frequency (foF2) map URL | 15 min | — |
| `GET /api/solar/image` | NASA SDO image URLs (AIA 193, HMI) | 15 min | — |
| `GET /api/solar/proxy/:type` | Proxy SDO images to avoid CORS (aia193, aia304, aia171, hmi-mag, hmi-int) | — | on-demand |
| `GET /api/status` | Data source load status and cache age | — | — |
| `GET /api/health` | Server health check + cache status summary | — | — |

## Data Sources

All free, no API keys required:

| Source | Data | Refresh |
|--------|------|---------|
| NOAA SWPC | Kp index, SFI, SSN, X-ray flux, solar wind speed | 5 min |
| HamQSL | HF band conditions (80m-10m), A-Index, signal noise | 10 min |
| DXWatch / HA8TKS / HamQTH | DX cluster spots (3 fallback sources) | 1 min |
| CelesTrak | Amateur satellite TLEs (SGP4 propagation) | 5 min |
| NASA SDO | Real-time solar images (5 types) | 15 min |
| SOHO | Solar image fallbacks (EIT 284/195/304/171) | 15 min |
| NOAA SWPC | MUF, DRAP, Aurora, foF2 maps | 15 min |
| KC2G | MUF propagation map (SVG fallback) | 15 min |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| State | Zustand |
| Backend | Express.js, Node.js |
| Maps | Leaflet, react-leaflet, CartoDB/ESRI/OpenTopoMap tiles |
| Satellites | satellite.js (SGP4 propagation) |
| Date utils | date-fns, date-fns-tz |
| Deployment | Docker (multi-arch amd64+arm64) + GitHub Actions to GHCR |

## Architecture

```
hamclock-reborn/
├── src/
│   ├── App.tsx                             # CSS Grid layout, mobile tabs, setup gate, ErrorBoundary
│   ├── main.tsx                            # React entry point
│   ├── components/
│   │   ├── SetupScreen.tsx                 # Callsign entry, 134-prefix auto-lookup, grid input
│   │   ├── Map/
│   │   │   └── WorldMap.tsx                # Leaflet map, day/night, gray line, grid, prefixes,
│   │   │                                   #   DX markers, satellites, QTH, DE→DX path, heat map,
│   │   │                                   #   layer control, 4 map styles
│   │   ├── Panels/
│   │   │   ├── Header.tsx                  # UTC/local clocks + callsign display
│   │   │   ├── SolarPanel.tsx              # SFI, Kp bar, SSN, X-ray, wind, A-index
│   │   │   ├── BandPanel.tsx               # HF band conditions table (day/night)
│   │   │   ├── DXPanel.tsx                 # DX cluster spots list
│   │   │   ├── SatellitePanel.tsx          # Satellite tracking panel
│   │   │   └── PropagationBar.tsx          # Bottom band bar (80m-6m with frequencies)
│   │   └── Widgets/
│   │       ├── SolarImage.tsx              # NASA SDO sun images (5 types, SOHO fallback)
│   │       ├── XRayFlux.tsx                # X-Ray flux plot (NOAA GOES)
│   │       ├── EnlilWidget.tsx             # WSA-Enlil solar wind prediction
│   │       ├── DRAPWidget.tsx              # D-Region Absorption Prediction
│   │       ├── AuroraWidget.tsx            # Aurora oval forecast
│   │       ├── KC2GWidget.tsx              # KC2G MUF propagation map
│   │       ├── HRDLogGraph.tsx             # HRDLog propagation graph
│   │       ├── ISSPass.tsx                 # ISS pass prediction + countdown
│   │       └── PropPrediction.tsx          # VOACAP-style propagation prediction
│   ├── hooks/
│   │   ├── useStore.ts                     # Zustand state management
│   │   ├── useDataFetch.ts                 # API polling (solar, bands, DX, satellites)
│   │   └── useIsMobile.ts                  # Responsive breakpoint hook
│   ├── utils/
│   │   ├── solar.ts                        # Terminator/gray line math, Maidenhead grid
│   │   └── hamradio.ts                     # Grid conversions, callsign prefix lookup
│   ├── types/index.ts                      # All TypeScript interfaces
│   └── vite-env.d.ts                       # Vite type declarations
├── server/
│   ├── src/server.js                       # Express API server (all endpoints, caching, SGP4)
│   ├── index.js                            # Server entry point (npm start)
│   ├── Dockerfile                          # Backend container (node:3013)
│   └── package.json                        # Server dependencies
├── Dockerfile                              # Frontend container (nginx:3012)
├── docker-compose.yml                      # Both services + DNS fix
├── nginx.conf                              # Proxy /api → backend + SPA routing
├── package.json                            # Frontend deps + dev scripts
├── tsconfig.json
├── vite.config.ts
└── .github/workflows/
    └── docker-publish.yml                  # Multi-arch CI/CD to GHCR
```

## Quick Start

### Option 1: Docker (Recommended)

```bash
docker-compose up -d
```

- Frontend: http://localhost:3012
- Backend: http://localhost:3013

Pre-built multi-arch images (amd64 + arm64) available from GHCR.

**Note:** The `docker-compose.yml` includes explicit DNS servers (`8.8.8.8`, `1.1.1.1`) on the backend container to avoid DNS resolution failures that can occur with some Docker network configurations.

### Option 2: Manual Install (Any Linux/Mac/Windows)

```bash
git clone https://github.com/Atvriders/hamclock-reborn.git
cd hamclock-reborn

# Install frontend + backend
npm install
cd server && npm install && cd ..

# Start both (frontend dev server + backend)
npm run dev:all
```

### npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (frontend only) |
| `npm run build` | TypeScript check + Vite production build |
| `npm run preview` | Preview production build |
| `npm run server` | Start backend server only |
| `npm run start` | Start backend + frontend concurrently |
| `npm run dev:all` | Start backend + frontend concurrently (alias) |

### Production Build

```bash
npm run build
# Then serve dist/ with any static server on port 3012
# And run: cd server && node src/server.js
```

## Raspberry Pi Installation (Fresh Install)

### Supported Pi Models

| Model | RAM | Status | Notes |
|-------|-----|--------|-------|
| Pi 5 | 4-8GB | Recommended | Docker or native |
| Pi 4 | 2-8GB | Full support | Docker or native |
| Pi 3 B/B+ | 1GB | Works | Native + swap recommended |
| Pi Zero 2 W | 512MB | Works | Native only, add swap |
| Pi Zero W | 512MB | Works* | ARM6 unofficial Node.js, add swap |

### Step 1: Flash Raspberry Pi OS

```bash
# Use Raspberry Pi Imager to flash Raspberry Pi OS Lite (64-bit)
# For Pi Zero W: use 32-bit Lite
# Enable SSH and WiFi in Imager settings
```

### Step 2: Initial Setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl
```

### Step 3: Install Node.js

**Pi 5, Pi 4, Pi 3, Pi Zero 2 W (64-bit):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**Pi Zero W (32-bit ARM6):**
```bash
wget https://unofficial-builds.nodejs.org/download/release/v20.11.0/node-v20.11.0-linux-armv6l.tar.xz
tar -xf node-v20.11.0-linux-armv6l.tar.xz
sudo cp -r node-v20.11.0-linux-armv6l/* /usr/local/
rm -rf node-v20.11.0-linux-armv6l*
node --version
```

### Step 4: Clone and Install

```bash
git clone https://github.com/Atvriders/hamclock-reborn.git
cd hamclock-reborn
npm install
cd server && npm install && cd ..
```

### Step 5: Build and Start

```bash
# Build frontend
npm run build

# Option A: Run manually
cd server && node src/server.js &
cd .. && npx serve dist -l 3012

# Option B: Production with PM2
sudo npm install -g pm2
cd server && pm2 start src/server.js --name hamclock-backend && cd ..
pm2 serve dist 3012 --name hamclock-frontend --spa
pm2 save
pm2 startup systemd
# Run the command it outputs
pm2 save
```

### Step 6: Access

Open browser: `http://<pi-ip-address>:3012`

## Raspberry Pi with Docker

**Pi 5, Pi 4, Pi 3:**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in
docker-compose up -d
```

**Pi Zero W / Zero 2 W:** Docker not recommended (512MB RAM). Use manual install.

## Pi Zero W Notes

- Single-core ARM11 700MHz, 512MB RAM
- Build times: ~10-15 min npm install, ~5 min build
- Add swap before building:
  ```bash
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- Consider building on a faster machine and copying `dist/`

## Troubleshooting

**No data showing:**
- Check backend: `curl http://localhost:3013/api/health`
- NOAA/CelesTrak may be temporarily down — data populates on next poll
- Check browser console for errors

**Map not loading:**
- Requires internet (tiles from CartoDB CDN)
- Clear browser cache

**Satellites showing empty:**
- CelesTrak TLE download has a 30s timeout — may take a moment on first load
- Check: `curl http://localhost:3013/api/satellites`

**502 Bad Gateway:**
- Backend not running or still starting
- In Docker: check `docker logs hamclock-backend`

**Docker DNS issues:**
- The backend container uses explicit DNS (`8.8.8.8`, `1.1.1.1`) in `docker-compose.yml`
- If upstream API fetches fail, check `docker logs hamclock-backend` for DNS errors

## Why "Reborn"?

The original HamClock by WB0OEW (Elwood Downey) is ending June 2026. HamClock Reborn is a modern, web-based alternative that runs in any browser — no dedicated hardware required (though it looks great on a Raspberry Pi with a touchscreen!).

73 de the HamClock Reborn team
