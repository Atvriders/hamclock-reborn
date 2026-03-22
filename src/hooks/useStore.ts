import { create } from 'zustand';
import type {
  AppState,
  SolarData,
  BandConditions,
  DXSpot,
  PropagationForecast,
  SatellitePosition,
  DayNightData,
  Contest,
} from '../types';

const CALLSIGN_KEY = 'hamclock_callsign';
const GRID_KEY = 'hamclock_grid';
const LAT_KEY = 'hamclock_lat';
const LNG_KEY = 'hamclock_lng';
const MAX_DX_SPOTS = 100;

export const useStore = create<AppState>((set) => ({
  // Data
  solar: null,
  bands: null,
  dxSpots: [],
  satellites: [],
  propagation: null,
  dayNight: null,
  contests: [],

  // User settings
  callsign: localStorage.getItem(CALLSIGN_KEY) ?? '',
  gridSquare: localStorage.getItem(GRID_KEY) ?? '',
  userLat: parseFloat(localStorage.getItem(LAT_KEY) ?? '40.0'),
  userLng: parseFloat(localStorage.getItem(LNG_KEY) ?? '-74.0'),

  // UI meta
  utcTime: new Date(),
  isLoading: false,
  error: null,

  // Actions
  setSolar: (data: SolarData) => set({ solar: data }),
  setBands: (data: BandConditions) => set({ bands: data }),
  setDxSpots: (spots: DXSpot[]) =>
    set((state) => ({
      dxSpots: [...spots, ...state.dxSpots].slice(0, MAX_DX_SPOTS),
    })),
  setSatellites: (sats: SatellitePosition[]) => set({ satellites: sats }),
  setPropagation: (data: PropagationForecast) => set({ propagation: data }),
  setDayNight: (data: DayNightData) => set({ dayNight: data }),
  setContests: (contests: Contest[]) => set({ contests }),
  setCallsign: (cs: string) => {
    localStorage.setItem(CALLSIGN_KEY, cs);
    set({ callsign: cs });
  },
  setGridSquare: (grid: string) => {
    localStorage.setItem(GRID_KEY, grid);
    set({ gridSquare: grid });
  },
  setUserLocation: (lat: number, lng: number) => {
    localStorage.setItem(LAT_KEY, String(lat));
    localStorage.setItem(LNG_KEY, String(lng));
    set({ userLat: lat, userLng: lng });
  },
  setUtcTime: (d: Date) => set({ utcTime: d }),
  setLoading: (v: boolean) => set({ isLoading: v }),
  setError: (msg: string | null) => set({ error: msg }),
}));

// Alias for backward compatibility
export const useAppStore = useStore;
