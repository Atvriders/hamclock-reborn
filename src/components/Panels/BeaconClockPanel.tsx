import React, { useEffect, useState } from 'react';

// ── NCDXF / IARU International Beacon Project ─────────────────────────
//
// 18 beacons rotate through 5 HF bands on a deterministic schedule.
// Each beacon transmits a 10-second tone on one band, then the next
// beacon takes over. After 18 × 10s = 180s (3 min), all beacons advance
// to the next band. Full cycle: 18 × 5 × 10 = 900s (15 min), hour-aligned.

const NCDXF_BEACONS: Array<{ id: string; location: string; grid: string }> = [
  { id: '4U1UN',  location: 'United Nations, NY',  grid: 'FN30as' },
  { id: 'VE8AT',  location: 'Eureka, NU',          grid: 'EQ79ax' },
  { id: 'W6WX',   location: 'Mt Umunhum, CA',      grid: 'CM97bd' },
  { id: 'KH6RS',  location: 'Maui, HI',            grid: 'BL10ts' },
  { id: 'ZL6B',   location: 'Masterton',           grid: 'RE78tw' },
  { id: 'VK6RBP', location: 'Rolystone, WA',       grid: 'OF87av' },
  { id: 'JA2IGY', location: 'Mt Asama',            grid: 'PM84jk' },
  { id: 'RR9O',   location: 'Novosibirsk',         grid: 'NO14kx' },
  { id: 'VR2B',   location: 'Hong Kong',           grid: 'OL72bg' },
  { id: '4S7B',   location: 'Colombo',             grid: 'MJ96wv' },
  { id: 'ZS6DN',  location: 'Pretoria',            grid: 'KG44dc' },
  { id: '5Z4B',   location: 'Kikuyu',              grid: 'KI88ks' },
  { id: '4X6TU',  location: 'Tel Aviv',            grid: 'KM72jb' },
  { id: 'OH2B',   location: 'Espoo',               grid: 'KP20ed' },
  { id: 'CS3B',   location: 'Madeira',             grid: 'IM12or' },
  { id: 'LU4AA',  location: 'Buenos Aires',        grid: 'GF05tj' },
  { id: 'OA4B',   location: 'Lima',                grid: 'FH17mw' },
  { id: 'YV5B',   location: 'Caracas',             grid: 'FK60nl' },
];

const NCDXF_BANDS_MHZ = [14.100, 18.110, 21.150, 24.930, 28.200];
const NCDXF_BAND_LABELS = ['20m', '17m', '15m', '12m', '10m'];

interface BeaconState {
  beaconIdx: number;
  bandIdx: number;
  secLeft: number;       // 1..10
  secInSlot: number;     // 0..9 (used for bar fill)
}

function computeBeaconState(now: number): BeaconState {
  const t = Math.floor((now / 1000) % 900);
  const slot = Math.floor(t / 10);
  const bandIdx = Math.floor(slot / 18);
  const beaconIdx = slot % 18;
  const secInSlot = t % 10;
  const secLeft = 10 - secInSlot;
  return { beaconIdx, bandIdx, secLeft, secInSlot };
}

function nextBeacons(state: BeaconState, count: number) {
  const list: Array<{ id: string; band: string; tOffset: number }> = [];
  let { beaconIdx, bandIdx, secLeft } = state;
  for (let i = 0; i < count; i++) {
    // Move to next slot
    const tOffset = secLeft + i * 10;
    let nextBeacon = beaconIdx + 1 + i;
    let nextBand = bandIdx;
    while (nextBeacon >= 18) {
      nextBeacon -= 18;
      nextBand = (nextBand + 1) % 5;
    }
    list.push({
      id: NCDXF_BEACONS[nextBeacon].id,
      band: NCDXF_BAND_LABELS[nextBand],
      tOffset,
    });
  }
  return list;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `T-${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface BeaconClockPanelProps {
  className?: string;
}

const BeaconClockPanel: React.FC<BeaconClockPanelProps> = ({ className }) => {
  const [state, setState] = useState<BeaconState>(() => computeBeaconState(Date.now()));

  useEffect(() => {
    const tick = () => setState(computeBeaconState(Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const current = NCDXF_BEACONS[state.beaconIdx];
  const bandLabel = NCDXF_BAND_LABELS[state.bandIdx];
  const freq = NCDXF_BANDS_MHZ[state.bandIdx].toFixed(3);
  const fillPct = ((state.secInSlot + 1) / 10) * 100;
  const upcoming = nextBeacons(state, 5);

  return (
    <div className={`ob-panel ${className ?? ''}`}>
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">NCDXF Beacons</span>
          <span className="ob-panel__head-meta">{state.secLeft}s</span>
        </div>

        <div className="ob-beacon-now">
          <div className="ob-beacon-now__call ob-amber-live">{current.id}</div>
          <div className="ob-beacon-now__meta">
            <span className="ob-beacon-now__loc">{current.location}</span>
            <span className="ob-beacon-now__band ob-amber-live">
              {freq} MHz · {bandLabel}
            </span>
          </div>
        </div>

        <div
          className="ob-beacon-bar"
          aria-label={`${state.secLeft} seconds remaining`}
          style={{ ['--ob-beacon-fill' as string]: `${fillPct}%` }}
        >
          <div className="ob-beacon-bar__fill" />
        </div>

        <div className="ob-beacon-next">
          {upcoming.map((u, i) => (
            <div key={`${u.id}-${i}`} className="ob-beacon-row">
              <span className="ob-beacon-row__t">{formatCountdown(u.tOffset)}</span>
              <span className="ob-beacon-row__call">{u.id}</span>
              <span className="ob-beacon-row__band">{u.band}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BeaconClockPanel;
