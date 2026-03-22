# HamClock Reborn

Modern web-based replacement for HamClock (ending June 2026). A real-time ham radio dashboard featuring solar data, band conditions, DX cluster, satellite tracking, and an interactive world map — all running in your browser.

## Features

- **Solar Data Panel** — Solar flux index (SFI), Kp index, sunspot number (SSN), X-ray flux, solar wind
- **HF Band Conditions** — 80m through 10m propagation table with day/night ratings
- **DX Cluster** — Live DX spots from DXWatch
- **World Map** — Interactive Leaflet map with day/night terminator, gray line overlay, and Maidenhead grid squares
- **Satellite Tracking** — Real-time positions of amateur satellites (ISS, AO-91, SO-50, and more) via SGP4 propagation
- **UTC & Local Clocks** — Dual clock display in the header
- **Callsign Display** — Enter and display your callsign, saved to localStorage
- **QTH Marker** — Set your lat/lng to show your location on the map
- **Propagation Forecast Bar** — Visual propagation forecast summary

## Screenshots

*Coming soon.*

## Quick Start

### Option 1: Docker (Recommended)

```bash
docker-compose up -d
```

- Frontend: http://localhost:3012
- Backend: http://localhost:3013

### Option 2: Manual Install (Any Linux/Mac/Windows)

```bash
# Clone
git clone https://github.com/Atvriders/hamclock-reborn.git
cd hamclock-reborn

# Install frontend
npm install

# Install backend
cd server && npm install && cd ..

# Start both
npm run start
```

## Raspberry Pi Installation (Fresh Install)

### Supported Pi Models

- Raspberry Pi 5 (recommended)
- Raspberry Pi 4 Model B (2GB+)
- Raspberry Pi 3 Model B/B+
- Raspberry Pi Zero 2 W
- Raspberry Pi Zero W (limited, see notes)

### Step 1: Flash Raspberry Pi OS

```bash
# Use Raspberry Pi Imager to flash Raspberry Pi OS Lite (64-bit)
# For Pi Zero W: use 32-bit Lite
# Enable SSH and WiFi in Imager settings
```

### Step 2: Initial Setup (SSH into your Pi)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl
```

### Step 3: Install Node.js

#### Pi 5, Pi 4, Pi 3, Pi Zero 2 W (64-bit):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

#### Pi Zero W (32-bit ARM6):

```bash
# Node.js doesn't have official ARM6 builds, use unofficial
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

### Step 5: Build Frontend

```bash
npm run build
```

### Step 6: Start Services

```bash
# Option A: Run both manually
npm run start

# Option B: Production with PM2
sudo npm install -g pm2
pm2 start server/index.js --name hamclock-backend
pm2 serve dist 3012 --name hamclock-frontend --spa
pm2 save
pm2 startup
```

### Step 7: Auto-Start on Boot

```bash
pm2 startup systemd
# Run the command it outputs
pm2 save
```

### Step 8: Access

Open browser: `http://<pi-ip-address>:3012`

## Raspberry Pi with Docker

### Pi 5, Pi 4, Pi 3 (Docker supported):

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in

# Run
cd hamclock-reborn
docker-compose up -d
```

### Pi Zero W / Zero 2 W:

Docker is NOT recommended on Pi Zero due to limited RAM (512MB). Use the manual install method above.

## Pi Zero W Performance Notes

- The Pi Zero W has a single-core ARM11 CPU and 512MB RAM
- Build times will be slow (~10-15 minutes for npm install, ~5 min for build)
- Consider building on a faster machine and copying the `dist/` folder
- Reduce polling intervals in `useDataFetch.ts` for lower CPU usage
- The app runs fine once built — it's just slow to compile

## Configuration

- **Callsign**: Enter your callsign in the header — saved to localStorage
- **QTH Location**: Set your lat/lng for the QTH marker on the map
- **Data refresh**: Solar (5 min), Bands (10 min), DX spots (60s), Satellites (30s)

## Data Sources

All free, no API keys required:

- **NOAA SWPC** — Solar flux, Kp index, sunspot number, X-ray flux, solar wind
- **HamQSL** — HF band conditions (80m-10m, day/night)
- **DXWatch** — DX cluster spots
- **CelesTrak** — Amateur satellite TLEs (ISS, AO-91, SO-50, etc.)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite, Leaflet |
| State | Zustand |
| Backend | Express.js, Node.js |
| Satellites | satellite.js (SGP4) |
| Deployment | Docker + GitHub Actions -> GHCR |

## Architecture

```
hamclock-reborn/
├── src/
│   ├── App.tsx                    # CSS Grid dashboard layout
│   ├── components/
│   │   ├── Map/WorldMap.tsx       # Leaflet map + overlays
│   │   └── Panels/
│   │       ├── Header.tsx         # UTC clock + callsign
│   │       ├── SolarPanel.tsx     # SFI, Kp, SSN, X-ray
│   │       ├── BandPanel.tsx      # HF band conditions table
│   │       ├── DXPanel.tsx        # DX cluster spots
│   │       ├── SatellitePanel.tsx # Satellite tracking
│   │       └── PropagationBar.tsx # Propagation forecast
│   ├── hooks/
│   │   ├── useStore.ts           # Zustand state
│   │   └── useDataFetch.ts       # API polling
│   ├── utils/solar.ts            # Day/night terminator math
│   └── types/index.ts
├── server/
│   ├── index.js                   # Server entry point
│   └── src/server.js              # Express API (NOAA, HamQSL, CelesTrak)
├── Dockerfile                     # Frontend (nginx:3012)
├── server/Dockerfile              # Backend (node:3013)
└── docker-compose.yml
```

## Ports

| Service | Port |
|---------|------|
| Frontend | 3012 |
| Backend API | 3013 |

## API Endpoints

| Endpoint | Description | Refresh |
|----------|-------------|---------|
| GET /api/solar | Solar/space weather | 5 min |
| GET /api/bands | HF band conditions | 10 min |
| GET /api/dxspots | DX cluster spots | 1 min |
| GET /api/satellites | Satellite positions | 15 min |
| GET /api/health | Server health check | — |

## Troubleshooting

### Pi Zero W: npm install fails with ENOMEM

```bash
# Create swap file
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# Then retry npm install
```

### No data showing

- Check if backend is running: `curl http://localhost:3013/api/health`
- NOAA APIs may be temporarily down — data will populate on next poll
- Check browser console for errors

### Map not loading

- Ensure internet connection (map tiles from CartoDB CDN)
- Clear browser cache

## Why "Reborn"?

The original HamClock by WB0OEW is ending June 2026. HamClock Reborn is a modern, web-based alternative that runs in any browser — no dedicated hardware required (though it looks great on a Raspberry Pi with a touchscreen!).
