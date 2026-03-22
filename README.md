# HamClock Reborn

Modern web-based replacement for HamClock (ending June 2026). A real-time ham radio dashboard featuring solar data, band conditions, DX cluster, satellite tracking, and an interactive world map — all running in your browser.

## Features

**Dashboard Panels:**
- **Callsign Setup Screen** — First-launch setup with callsign validation, auto-location from 100+ prefix→country mappings, Maidenhead grid input
- **Solar Data Panel** — SFI, Kp index, SSN, X-ray flux class, solar wind speed/Bz, A-index, geomagnetic storm level
- **Solar Image Widget** — Real-time NASA SDO sun images (AIA 193/304/171, HMI Magnetogram/Intensitygram), circular crop, click-to-expand
- **HF Band Conditions** — 80m through 10m propagation table with day/night Good/Fair/Poor ratings
- **DX Cluster** — Live DX spots from DXWatch with frequency, callsign, band coloring, mode detection
- **Satellite Tracking** — Real-time positions of amateur satellites (ISS, AO-91, SO-50, etc.) via SGP4 propagation
- **Propagation Forecast Bar** — HF/VHF conditions, open bands, MUF, satellite pass info

**World Map (Leaflet):**
- Day/night terminator overlay (updates every 60s)
- Gray line (dawn/dusk propagation band)
- Maidenhead grid squares (toggleable)
- DX spot markers with callsign tooltips
- Satellite position markers
- QTH home location marker
- **MUF Map overlay** (KC2G Maximum Usable Frequency)
- **DRAP overlay** (NOAA D-Region Absorption Prediction)
- **Aurora oval overlay** (NOAA northern hemisphere)
- **4 map styles**: Dark, Satellite, Terrain, Light
- **Layer control panel** with toggle checkboxes

**General:**
- UTC + local clocks with callsign display
- Classic ham radio aesthetic (green on black, monospace numbers)
- ErrorBoundary for crash protection
- All data from free public APIs — no API keys needed
- Runs on Raspberry Pi (all models including Zero W)

## Quick Start

### Option 1: Docker (Recommended)

```bash
docker-compose up -d
```

- Frontend: http://localhost:3012
- Backend: http://localhost:3013

Pre-built multi-arch images (amd64 + arm64) available from GHCR.

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

## Data Sources

All free, no API keys required:

| Source | Data | Refresh |
|--------|------|---------|
| NOAA SWPC | Solar flux, Kp, SSN, X-ray, solar wind | 5 min |
| HamQSL | HF band conditions (80m-10m) | 10 min |
| DXWatch | DX cluster spots | 1 min |
| CelesTrak | Amateur satellite TLEs (SGP4) | 15 min |
| NASA SDO | Real-time solar images (5 types) | 15 min |
| KC2G | MUF propagation map | 15 min |
| NOAA SWPC | DRAP, Aurora, foF2 maps | 15 min |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Leaflet |
| State | Zustand |
| Backend | Express.js, Node.js |
| Satellites | satellite.js (SGP4) |
| Maps | react-leaflet, CartoDB/ESRI/OpenTopoMap tiles |
| Deployment | Docker (multi-arch) + GitHub Actions → GHCR |

## Architecture

```
hamclock-reborn/
├── src/
│   ├── App.tsx                        # CSS Grid dashboard + setup flow
│   ├── components/
│   │   ├── SetupScreen.tsx            # Callsign entry (first launch)
│   │   ├── Map/WorldMap.tsx           # Leaflet map + all overlays
│   │   ├── Panels/
│   │   │   ├── Header.tsx             # UTC/local clocks + callsign
│   │   │   ├── SolarPanel.tsx         # SFI, Kp, SSN, X-ray, wind
│   │   │   ├── BandPanel.tsx          # HF band conditions table
│   │   │   ├── DXPanel.tsx            # DX cluster spots
│   │   │   ├── SatellitePanel.tsx     # Satellite tracking
│   │   │   └── PropagationBar.tsx     # Propagation forecast
│   │   └── Widgets/
│   │       └── SolarImage.tsx         # NASA SDO sun images
│   ├── hooks/
│   │   ├── useStore.ts                # Zustand state management
│   │   └── useDataFetch.ts            # API polling (4 endpoints)
│   ├── utils/
│   │   ├── solar.ts                   # Terminator/gray line math
│   │   └── hamradio.ts                # Grid conversions, prefix lookup
│   └── types/index.ts                 # All TypeScript interfaces
├── server/
│   ├── index.js                       # Server (npm start entry)
│   └── src/server.js                  # Server (Docker entry) + map APIs
├── Dockerfile                         # Frontend (nginx:3012)
├── server/Dockerfile                  # Backend (node:3013)
├── docker-compose.yml                 # Both services
├── nginx.conf                         # Proxy + SPA routing
└── .github/workflows/
    └── docker-publish.yml             # Multi-arch CI/CD to GHCR
```

## API Endpoints

| Endpoint | Description | Refresh |
|----------|-------------|---------|
| `GET /api/solar` | Solar/space weather data | 5 min |
| `GET /api/bands` | HF band conditions | 10 min |
| `GET /api/dxspots` | DX cluster spots | 1 min |
| `GET /api/satellites` | Satellite positions (SGP4) | 15 min |
| `GET /api/maps/muf` | MUF propagation map URL | 15 min |
| `GET /api/maps/drap` | D-Region Absorption map URL | 15 min |
| `GET /api/maps/aurora` | Aurora oval data + image | 15 min |
| `GET /api/maps/foF2` | Critical frequency map URL | 15 min |
| `GET /api/solar/image` | NASA SDO image URLs | 15 min |
| `GET /api/health` | Server health check | — |

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

## Why "Reborn"?

The original HamClock by WB0OEW (Elwood Downey) is ending June 2026. HamClock Reborn is a modern, web-based alternative that runs in any browser — no dedicated hardware required (though it looks great on a Raspberry Pi with a touchscreen!).

73 de the HamClock Reborn team
