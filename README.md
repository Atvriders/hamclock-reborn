# HamClock Reborn

**[https://hamclock-reborn.org](https://hamclock-reborn.org/)**

Modern, open-source, web-based ham radio dashboard featuring solar data, band conditions, DX cluster, satellite tracking, propagation prediction, and an interactive world map — all running in your browser.

## Features

**Callsign Setup:**
- Live callsign lookup via callook.info + HamDB.org (returns your actual registered grid square)
- 188 prefix-to-country fallback auto-lookup
- Skippable setup for anonymous use

**Solar and Space Weather:**
- Solar data panel — SFI, SSN, X-Ray flux class, Kp bar graph, A-Index, Solar Wind speed (every 5 min)
- SDO Solar images — 5 types (AIA 193/304/171, HMI Magnetogram, HMI Intensitygram), circular crop, click to expand, SOHO fallback URLs (every 15 min)
- WSA-Enlil solar wind prediction widget (every 15 min)
- DRAP D-Region Absorption Prediction widget (every 15 min)
- Aurora oval forecast widget (NOAA northern hemisphere image + JSON data) (every 15 min)
- X-Ray flux plot (NOAA GOES)

**Propagation:**
- KC2G MUF propagation map widget (every 15 min)
- HF band conditions panel (80m-10m, day/night, Good/Fair/Poor colored dots) (every 10 min)
- HRDLog propagation graph widget
- VOACAP-style propagation prediction (DE to DX, per-band reliability table with distance, bearing, grid squares, SNR, best time)
- Propagation heat map overlay on map (band-specific, grid-cell reliability shading from QTH)

**DX and Satellites:**
- DX Cluster panel (3 fallback sources: HamQTH, DXWatch, HA8TKS; up to 30 spots; band-colored badges, mode detection) (every 2 min)
- ISS pass prediction (countdown timer, max elevation, AOS/LOS azimuth, duration)
- Satellite tracking (ISS, AO-91, SO-50, AO-73, PO-101 and more via SGP4 propagation) (positions every 30s, TLEs every 5 min)
- Multiple TLE sources (CelesTrak, AMSAT, TLE API fallback)

**World Map (Leaflet):**
- Day/night overlay (grid rectangle approach, updates every 60s)
- Gray line (twilight boundary polylines with antimeridian-aware splitting)
- 188 callsign prefix labels (zoom-scaled: major countries at zoom 2+, all at zoom 6+)
- Maidenhead grid squares (toggleable)
- DX spot markers with callsign tooltips
- Satellite position markers
- QTH home location marker with grid square display
- DE-to-DX great circle path (click map to set DX endpoint)
- Propagation heat map overlay (band-specific reliability from QTH)
- 4 map styles: Dark, Satellite, Terrain, Light
- Layer control panel with toggle checkboxes

**Layout:**
- Desktop: CSS Grid 3-column layout (left sidebar, center map, right sidebar) with header and bottom band bar
- Mobile responsive: 5-tab layout (Solar, Bands, DX, Space, Tools) with compact header and half-screen map
- ErrorBoundary for crash protection

**General:**
- UTC + local clocks with callsign display in header (updates every 1s)
- Data flow status indicator in header (checks every 5s — green when data is fresh, red when stale)
- Gray line status indicator — shows ACTIVE when your QTH is in the twilight zone (solar elevation 0° to -6°), updates every 30s
- Bottom band bar (80m-6m with center frequencies, clickable band selection)
- Classic ham radio aesthetic (green on black, monospace numbers)
- All data from free public APIs — no API keys needed
- Runs on Raspberry Pi (all models including Zero W)

---

## Raspberry Pi Installation

### Supported Models

| Model | RAM | OS | Install Method | Notes |
|-------|-----|-----|---------------|-------|
| Pi 5 | 4-8GB | 64-bit | Docker or Native | Recommended |
| Pi 4 | 2-8GB | 64-bit or 32-bit | Docker or Native | Full support |
| Pi 3 B/B+ | 1GB | 64-bit or 32-bit | Docker or Native | Add swap recommended |
| Pi 2 | 1GB | 32-bit | Docker or Native | Add swap recommended |
| Pi Zero 2 W | 512MB | 64-bit or 32-bit | Native recommended | Add swap, Docker possible but tight |
| Pi Zero W | 512MB | 32-bit | Native only | ARM6 unofficial Node.js, add swap |
| **Pi 1** | 512MB | 32-bit | **[HamClock Pi1 Lite](https://github.com/Atvriders/hamclock-pi1)** | Lightweight version — see below |

Docker images support amd64, arm64 (64-bit), and arm/v7 (32-bit). All Pi models except Pi Zero W and Pi 1 can use Docker.

### Raspberry Pi 1 — Lightweight Version

The Pi 1 (700MHz ARMv6, 512MB RAM) cannot run the full version. A dedicated lightweight build is available:

**[HamClock Pi1 Lite](https://github.com/Atvriders/hamclock-pi1)** — Same data, zero dependencies.

**One-line install** (no GitHub needed):
```bash
curl -sL https://hamclock-reborn.org/downloads/pi1-install.sh | bash
```

- Pure Python 3 + single HTML file (no React, no Node.js, no npm, no build step)
- Shows: Solar conditions (SFI, Kp, SSN, A-Index, X-Ray, Solar Wind), HF band conditions (80m–10m), DX Cluster (30 live spots), UTC/local clocks
- ~15MB memory footprint (vs 200MB+ for full version)
- Kiosk mode: boots directly into fullscreen dashboard on the Pi's monitor

---

### Option 1: Native Install (No Docker)

Works on all Pi models including Pi Zero W.

#### Step 1: Flash Raspberry Pi OS

Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/) to flash:
- **Pi 5 / Pi 4 / Pi 3 / Pi Zero 2 W:** Raspberry Pi OS Lite (64-bit recommended, 32-bit also works)
- **Pi 2:** Raspberry Pi OS Lite (32-bit)
- **Pi Zero W:** Raspberry Pi OS Lite (32-bit)

In Imager settings, enable SSH and configure WiFi before flashing.

#### Step 2: SSH In and Update

```bash
ssh pi@<your-pi-ip>
sudo apt update && sudo apt upgrade -y
```

#### Step 3: Install Dependencies

```bash
# Build tools and git
sudo apt install -y git curl build-essential

# For Pi Zero W / Pi Zero 2 W: add swap before installing (512MB RAM is tight)
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

#### Step 4: Install Node.js 20

**Pi 5, Pi 4, Pi 3, Pi Zero 2 W (64-bit or 32-bit OS):**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # Should show v20.x
npm --version    # Should show 10.x
```

> NodeSource supports both armhf (32-bit) and arm64 (64-bit) on Pi 2/3/4/5/Zero 2 W.

**Pi Zero W (32-bit ARM6 — requires unofficial Node.js build):**

```bash
wget https://unofficial-builds.nodejs.org/download/release/v20.11.0/node-v20.11.0-linux-armv6l.tar.xz
tar -xf node-v20.11.0-linux-armv6l.tar.xz
sudo cp -r node-v20.11.0-linux-armv6l/* /usr/local/
rm -rf node-v20.11.0-linux-armv6l*
node --version   # Should show v20.11.0
```

#### Step 5: Clone and Install HamClock Reborn

```bash
git clone https://github.com/Atvriders/hamclock-reborn.git
cd hamclock-reborn

# Install frontend dependencies
npm install

# Install backend dependencies
cd server && npm install && cd ..
```

> **Pi Zero W / Pi 3 note:** `npm install` may take 10-15 minutes. Don't worry if it seems slow.

#### Step 6: Build the Frontend

```bash
npm run build
```

> **Pi Zero W note:** Build takes ~5 minutes. If it runs out of memory, make sure swap is enabled (Step 3).

#### Step 7: Install PM2 (Process Manager)

PM2 keeps HamClock running in the background and auto-starts on boot:

```bash
sudo npm install -g pm2
```

#### Step 8: Start HamClock Reborn

```bash
# Start the backend API server
cd server
pm2 start src/server.js --name hamclock-backend
cd ..

# Serve the frontend build
pm2 serve dist 3012 --name hamclock-frontend --spa

# Save PM2 config so it survives reboots
pm2 save

# Set up auto-start on boot
pm2 startup systemd
# ^^^ Run the command PM2 prints out (starts with sudo)
pm2 save
```

#### Step 9: Open in Browser

```
http://<your-pi-ip>:3012
```

Find your Pi's IP with `hostname -I`.

#### Updating

```bash
cd ~/hamclock-reborn
git pull
npm install
cd server && npm install && cd ..
npm run build
pm2 restart all
```

---

### Option 2: Docker Install

Works on Pi 5, Pi 4, Pi 3, and Pi 2 — both 64-bit and 32-bit OS. **Not recommended for Pi Zero W** (512MB RAM is not enough for Docker).

#### Step 1: Flash Raspberry Pi OS

Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/) to flash **Raspberry Pi OS Lite (64-bit)**.

Enable SSH and configure WiFi in Imager settings.

#### Step 2: SSH In and Update

```bash
ssh pi@<your-pi-ip>
sudo apt update && sudo apt upgrade -y
```

#### Step 3: Install Docker

```bash
# Install Docker using the official script
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group (so you don't need sudo)
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
exit
```

SSH back in:

```bash
ssh pi@<your-pi-ip>

# Verify Docker is working
docker --version
docker run hello-world
```

#### Step 4: Install Docker Compose

Docker Compose may already be included. Check:

```bash
docker compose version
```

If not installed:

```bash
sudo apt install -y docker-compose-plugin
```

Or install standalone:

```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

#### Step 5: Clone and Start

```bash
git clone https://github.com/Atvriders/hamclock-reborn.git
cd hamclock-reborn
docker compose up -d
```

This pulls pre-built multi-arch images (amd64, arm64, arm/v7) from GitHub Container Registry.

Wait ~30 seconds for the backend to fetch initial data.

#### Step 6: Open in Browser

```
http://<your-pi-ip>:3012
```

#### Docker Commands

```bash
# View logs
docker logs hamclock-backend
docker logs hamclock-frontend

# Restart
docker compose restart

# Update to latest version
docker compose pull
docker compose up -d

# Stop
docker compose down

# Check health
curl http://localhost:3013/api/health
```

---

## API Endpoints

| Endpoint | Description | Cache | Poll |
|----------|-------------|-------|------|
| `GET /api/solar` | Solar/space weather (Kp, SFI, SSN, A-Index, X-Ray, Solar Wind) | 5 min | 5 min |
| `GET /api/bands` | HF band conditions (HamQSL XML) | 10 min | 10 min |
| `GET /api/dxspots` | DX cluster spots (HamQTH/DXWatch/HA8TKS) | 2 min | 2 min |
| `GET /api/satellites` | Satellite positions via SGP4 (CelesTrak/AMSAT TLEs) | 5 min | 30 sec |
| `GET /api/callsign/:call` | Callsign lookup (callook.info + HamDB.org) | — | on-demand |
| `GET /api/iss-pass?lat=&lng=` | ISS next pass prediction | — | on-demand |
| `GET /api/propagation?fromLat=&fromLng=&toLat=&toLng=&band=` | HF propagation prediction | — | on-demand |
| `GET /api/maps/muf` | MUF propagation map URL | 15 min | — |
| `GET /api/maps/drap` | D-Region Absorption map URL | 15 min | — |
| `GET /api/maps/aurora` | Aurora oval data + image URL | 15 min | — |
| `GET /api/maps/foF2` | Critical frequency (foF2) map URL | 15 min | — |
| `GET /api/solar/image` | NASA SDO image URLs (5 types) | 15 min | — |
| `GET /api/solar/proxy/:type` | Proxy SDO images (aia193, aia304, aia171, hmi-mag, hmi-int) | 10 min | — |
| `GET /api/status` | Data source load status and cache age | — | — |
| `GET /api/health` | Server health check + cache status | — | — |

## Data Sources

All free, no API keys required:

| Source | Data | Refresh |
|--------|------|---------|
| NOAA SWPC | Kp, SFI, SSN, X-ray flux, solar wind, MUF/DRAP/Aurora/foF2 maps | 5-15 min |
| HamQSL | HF band conditions (80m-10m), A-Index, signal noise | 10 min |
| HamQTH / DXWatch / HA8TKS | DX cluster spots (3 fallback sources) | 2 min |
| CelesTrak / AMSAT | Amateur satellite TLEs (SGP4 propagation) | 5 min |
| NASA SDO / SOHO | Real-time solar images (5 types + fallbacks) | 15 min |
| KC2G | MUF propagation map (SVG) | 15 min |
| callook.info / HamDB.org | Callsign → grid square lookup (registered address) | on-demand |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| State | Zustand |
| Backend | Express.js, Node.js |
| Maps | Leaflet, react-leaflet, CartoDB/ESRI/OpenTopoMap tiles |
| Satellites | satellite.js (SGP4 propagation) |
| Deployment | Docker (multi-arch: amd64, arm64, armv7 32-bit) + GitHub Actions to GHCR |

## Troubleshooting

**No data showing:**
- Check backend: `curl http://localhost:3013/api/health`
- NOAA/CelesTrak may be temporarily down — data populates on next poll
- Check browser console for errors

**Map not loading:**
- Requires internet for map tiles (CartoDB CDN)
- Clear browser cache

**Satellites showing empty:**
- CelesTrak can be slow — wait 30-60 seconds after startup
- Falls back to AMSAT if CelesTrak is down
- Check: `curl http://localhost:3013/api/satellites`

**DX Cluster empty:**
- Check: `curl http://localhost:3013/api/dxspots`
- HamQTH may be temporarily down — DXWatch and HA8TKS are fallbacks

**502 Bad Gateway:**
- Backend not running or still starting
- Docker: `docker logs hamclock-backend`
- Native: `pm2 logs hamclock-backend`

**Docker DNS issues:**
- Backend container uses explicit DNS (`8.8.8.8`, `1.1.1.1`)
- Check: `docker logs hamclock-backend` for DNS errors

**Grid square wrong:**
- Callsign lookup uses your FCC-registered address via callook.info
- International callsigns use HamDB.org
- You can manually edit the grid square on the setup screen

## Why "Reborn"?

Inspired by the original HamClock by WB0OEW (Elwood Downey). HamClock Reborn is a modern, open-source alternative that runs in any browser — no dedicated hardware required (though it looks great on a Raspberry Pi with a touchscreen!).

73 de the HamClock Reborn team

---

*Built entirely with [Claude Code](https://claude.ai/code) by Anthropic — AI-powered software engineering from concept to deployment.*
