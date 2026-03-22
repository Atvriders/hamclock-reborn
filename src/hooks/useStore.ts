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
  userLat: 40.0,
  userLng: -74.0,

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
  setUserLocation: (lat: number, lng: number) => set({ userLat: lat, userLng: lng }),
  setUtcTime: (d: Date) => set({ utcTime: d }),
  setLoading: (v: boolean) => set({ isLoading: v }),
  setError: (msg: string | null) => set({ error: msg }),
}));

// Alias for backward compatibility
export const useAppStore = useStore;
