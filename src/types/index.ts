// ============================================================
// HamClock Reborn — TypeScript interfaces
// ============================================================

// --- Solar / Space Weather -----------------------------------

export interface SolarWind {
  speed: number;                // km/s
  density: number;              // p/cm^3
  bz?: number;                  // nT (negative = geoeffective)
  bt?: number;                  // nT total
}

export interface XRayFlux {
  flux: number;                 // W/m^2 raw value
  classification: string;      // e.g. "B5.3", "C1.2", "M2.1"
}

export interface SolarData {
  sfi: number;                  // Solar Flux Index — 10.7 cm radio flux
  kp: number;                   // Planetary K-index (0-9)
  ssn: number;                  // Daily sunspot number
  aIndex: number;               // A-index
  solarWind: SolarWind;
  xray: XRayFlux;
  geomagField?: GeomagField;
  timestamp: string;            // ISO timestamp of last fetch
}

export interface GeomagField {
  stormLevel: string;           // "None" | "Quiet" | "Active" | "Storm"
  geomagStormProb24h: number;   // 0-100 %
}

// --- Band Conditions -----------------------------------------

export type BandName =
  | '80m-40m' | '30m-20m' | '17m-15m' | '12m-10m'
  | '160m' | '80m' | '60m' | '40m' | '30m' | '20m'
  | '17m' | '15m' | '12m' | '10m' | '6m';

export type ConditionLevel = 'Good' | 'Fair' | 'Poor';

export type TimeOfDay = 'day' | 'night';

export interface BandCondition {
  band: BandName;
  condition: ConditionLevel;
  timeOfDay: TimeOfDay;
}

export interface BandConditions {
  conditions: Record<string, { day: string; night: string }>;
  signalNoise: string;          // e.g. "S3-S4"
  timestamp: string;
}

// --- DX Cluster ----------------------------------------------

export interface DXSpot {
  id: string;                   // unique key for React
  frequency: number;            // kHz
  dx: string;                   // spotted (DX) station callsign
  spotter: string;              // who spotted it
  comment: string;
  time: string;                 // UTC ISO string
  band: string;                 // derived from frequency
  mode?: string;                // CW / SSB / FT8 / etc.
  dxcc?: string;                // DXCC entity name
  dxGrid?: string;              // Maidenhead grid of DX station
  spotterGrid?: string;
  lat?: number;                 // DX station latitude (for map)
  lng?: number;                 // DX station longitude (for map)
}

// --- Propagation Forecast ------------------------------------

export interface PropagationForecast {
  hfConditions: string;         // "Good" / "Fair" / "Poor"
  vhfConditions: string;
  geomagForecast: string;       // "Quiet" / "Unsettled" / "Active" / "Storm"
  muf: number;                  // Maximum usable frequency (MHz)
  updated: string;
}

// --- Satellite Tracking --------------------------------------

export interface TLE {
  name: string;
  line1: string;
  line2: string;
  catalogNumber?: number;
}

export interface SatellitePass {
  satellite: string;
  aosTime: string;              // Acquisition of signal — ISO
  losTime: string;              // Loss of signal — ISO
  maxElevation: number;         // degrees
  aosAzimuth: number;           // degrees
  losAzimuth: number;
  duration: number;             // seconds
}

export interface SatellitePosition {
  name: string;
  lat: number;
  lng: number;
  alt: number;                  // km
  velocity: number;             // km/s
  noradId: number;
}

// --- Contest Calendar ----------------------------------------

export interface Contest {
  id: string;
  name: string;
  startDate: string;            // ISO
  endDate: string;              // ISO
  mode: string;                 // CW / SSB / Mixed / Digital
  exchange: string;
  url?: string;
}

// --- Day/Night & Gray Line -----------------------------------

export interface TerminatorPoint {
  lat: number;
  lng: number;
}

export interface DayNightData {
  terminator: TerminatorPoint[];
  sunLat: number;
  sunLng: number;
}

// --- Grid Squares (Maidenhead) -------------------------------

export interface GridSquare {
  id: string;                   // e.g. "FN31"
  lat: number;
  lng: number;
  label: string;
}

// --- Station / User Configuration ----------------------------

export interface StationConfig {
  callsign: string;
  grid: string;                 // Maidenhead 4-6 char
  lat: number;
  lng: number;
  timezone: string;             // IANA timezone e.g. "America/New_York"
}

// --- Global App State (Zustand store shape) ------------------

export interface AppState {
  // Data
  solar: SolarData | null;
  bands: BandConditions | null;
  dxSpots: DXSpot[];
  satellites: SatellitePosition[];
  propagation: PropagationForecast | null;
  dayNight: DayNightData | null;
  contests: Contest[];

  // User settings
  callsign: string;
  gridSquare: string;
  userLat: number;
  userLng: number;

  // UI meta
  utcTime: Date;
  isLoading: boolean;
  error: string | null;

  // Actions
  setSolar: (data: SolarData) => void;
  setBands: (data: BandConditions) => void;
  setDxSpots: (spots: DXSpot[]) => void;
  setSatellites: (sats: SatellitePosition[]) => void;
  setPropagation: (data: PropagationForecast) => void;
  setDayNight: (data: DayNightData) => void;
  setContests: (contests: Contest[]) => void;
  setCallsign: (cs: string) => void;
  setGridSquare: (grid: string) => void;
  setUserLocation: (lat: number, lng: number) => void;
  setUtcTime: (d: Date) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
}

