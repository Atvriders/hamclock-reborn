import React, { useState, useCallback, useEffect, useRef } from 'react';
import { callsignPrefixToLocation, latLngToGrid } from '../utils/hamradio';

// ── Callsign prefix → country/coordinates mapping (used for setup display) ──
const PREFIX_MAP: { prefix: string; country: string; lat: number; lng: number }[] = [
  // North America
  { prefix: 'W',   country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'K',   country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'N',   country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AA',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AB',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AC',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AD',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AE',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AF',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AG',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AH',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AI',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AJ',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AK',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'AL',  country: 'USA',             lat: 40.0,  lng: -98.0  },
  { prefix: 'VE',  country: 'Canada',          lat: 56.0,  lng: -106.0 },
  { prefix: 'VA',  country: 'Canada',          lat: 56.0,  lng: -106.0 },
  { prefix: 'VO',  country: 'Canada',          lat: 47.5,  lng: -56.0  },
  { prefix: 'VY',  country: 'Canada',          lat: 56.0,  lng: -106.0 },
  { prefix: 'XE',  country: 'Mexico',          lat: 23.0,  lng: -102.0 },
  { prefix: 'XF',  country: 'Mexico',          lat: 23.0,  lng: -102.0 },

  // Europe
  { prefix: 'G',   country: 'England',         lat: 52.0,  lng: -1.0   },
  { prefix: 'M',   country: 'England',         lat: 52.0,  lng: -1.0   },
  { prefix: 'GW',  country: 'Wales',           lat: 52.0,  lng: -3.5   },
  { prefix: 'GM',  country: 'Scotland',        lat: 57.0,  lng: -4.0   },
  { prefix: 'GI',  country: 'N. Ireland',      lat: 54.5,  lng: -7.0   },
  { prefix: 'GD',  country: 'Isle of Man',     lat: 54.2,  lng: -4.5   },
  { prefix: 'GJ',  country: 'Jersey',          lat: 49.2,  lng: -2.1   },
  { prefix: 'GU',  country: 'Guernsey',        lat: 49.5,  lng: -2.5   },
  { prefix: 'DL',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'DJ',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'DK',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'DA',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'DB',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'DC',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'DD',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'DF',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'DG',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'DH',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'DO',  country: 'Germany',         lat: 51.0,  lng: 10.0   },
  { prefix: 'F',   country: 'France',          lat: 46.0,  lng: 2.0    },
  { prefix: 'I',   country: 'Italy',           lat: 42.0,  lng: 12.0   },
  { prefix: 'IK',  country: 'Italy',           lat: 42.0,  lng: 12.0   },
  { prefix: 'IZ',  country: 'Italy',           lat: 42.0,  lng: 12.0   },
  { prefix: 'EA',  country: 'Spain',           lat: 40.0,  lng: -4.0   },
  { prefix: 'EB',  country: 'Spain',           lat: 40.0,  lng: -4.0   },
  { prefix: 'EC',  country: 'Spain',           lat: 40.0,  lng: -4.0   },
  { prefix: 'CT',  country: 'Portugal',        lat: 39.5,  lng: -8.0   },
  { prefix: 'PA',  country: 'Netherlands',     lat: 52.0,  lng: 5.0    },
  { prefix: 'PB',  country: 'Netherlands',     lat: 52.0,  lng: 5.0    },
  { prefix: 'PD',  country: 'Netherlands',     lat: 52.0,  lng: 5.0    },
  { prefix: 'PE',  country: 'Netherlands',     lat: 52.0,  lng: 5.0    },
  { prefix: 'PH',  country: 'Netherlands',     lat: 52.0,  lng: 5.0    },
  { prefix: 'PI',  country: 'Netherlands',     lat: 52.0,  lng: 5.0    },
  { prefix: 'ON',  country: 'Belgium',         lat: 50.5,  lng: 4.0    },
  { prefix: 'OZ',  country: 'Denmark',         lat: 56.0,  lng: 10.0   },
  { prefix: 'SM',  country: 'Sweden',          lat: 62.0,  lng: 16.0   },
  { prefix: 'SA',  country: 'Sweden',          lat: 62.0,  lng: 16.0   },
  { prefix: 'LA',  country: 'Norway',          lat: 62.0,  lng: 10.0   },
  { prefix: 'OH',  country: 'Finland',         lat: 64.0,  lng: 26.0   },
  { prefix: 'OE',  country: 'Austria',         lat: 47.5,  lng: 14.0   },
  { prefix: 'HB',  country: 'Switzerland',     lat: 47.0,  lng: 8.0    },
  { prefix: 'OK',  country: 'Czech Republic',  lat: 50.0,  lng: 15.0   },
  { prefix: 'OM',  country: 'Slovakia',        lat: 48.7,  lng: 19.7   },
  { prefix: 'SP',  country: 'Poland',          lat: 52.0,  lng: 20.0   },
  { prefix: 'SQ',  country: 'Poland',          lat: 52.0,  lng: 20.0   },
  { prefix: 'HA',  country: 'Hungary',         lat: 47.0,  lng: 20.0   },
  { prefix: 'HG',  country: 'Hungary',         lat: 47.0,  lng: 20.0   },
  { prefix: 'YO',  country: 'Romania',         lat: 46.0,  lng: 25.0   },
  { prefix: 'LZ',  country: 'Bulgaria',        lat: 42.7,  lng: 25.5   },
  { prefix: 'YU',  country: 'Serbia',          lat: 44.0,  lng: 21.0   },
  { prefix: 'SV',  country: 'Greece',          lat: 39.0,  lng: 22.0   },
  { prefix: 'UR',  country: 'Ukraine',         lat: 49.0,  lng: 32.0   },
  { prefix: 'UT',  country: 'Ukraine',         lat: 49.0,  lng: 32.0   },
  { prefix: 'UA',  country: 'Russia (EU)',     lat: 56.0,  lng: 38.0   },
  { prefix: 'EI',  country: 'Ireland',         lat: 53.0,  lng: -8.0   },

  // Asia & Pacific
  { prefix: 'JA',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JH',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JR',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JE',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JF',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JG',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JI',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JJ',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JK',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JL',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JM',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JN',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JO',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JP',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JQ',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'JS',  country: 'Japan',           lat: 36.0,  lng: 138.0  },
  { prefix: 'BV',  country: 'Taiwan',          lat: 23.5,  lng: 121.0  },
  { prefix: 'BY',  country: 'China',           lat: 35.0,  lng: 105.0  },
  { prefix: 'HL',  country: 'South Korea',     lat: 36.0,  lng: 128.0  },
  { prefix: 'DS',  country: 'South Korea',     lat: 36.0,  lng: 128.0  },
  { prefix: 'VU',  country: 'India',           lat: 21.0,  lng: 78.0   },
  { prefix: 'HS',  country: 'Thailand',        lat: 15.0,  lng: 101.0  },
  { prefix: 'DU',  country: 'Philippines',     lat: 13.0,  lng: 122.0  },
  { prefix: '9V',  country: 'Singapore',       lat: 1.3,   lng: 103.8  },
  { prefix: '9M',  country: 'Malaysia',        lat: 4.0,   lng: 109.0  },
  { prefix: 'YB',  country: 'Indonesia',       lat: -2.0,  lng: 118.0  },

  // Oceania
  { prefix: 'VK',  country: 'Australia',       lat: -25.0, lng: 134.0  },
  { prefix: 'ZL',  country: 'New Zealand',     lat: -41.0, lng: 174.0  },

  // South America
  { prefix: 'PY',  country: 'Brazil',          lat: -14.0, lng: -51.0  },
  { prefix: 'PU',  country: 'Brazil',          lat: -14.0, lng: -51.0  },
  { prefix: 'LU',  country: 'Argentina',       lat: -34.0, lng: -64.0  },
  { prefix: 'CE',  country: 'Chile',           lat: -33.0, lng: -71.0  },
  { prefix: 'HK',  country: 'Colombia',        lat: 4.0,   lng: -72.0  },
  { prefix: 'OA',  country: 'Peru',            lat: -10.0, lng: -76.0  },
  { prefix: 'HC',  country: 'Ecuador',         lat: -1.0,  lng: -78.0  },
  { prefix: 'YV',  country: 'Venezuela',       lat: 8.0,   lng: -66.0  },
  { prefix: 'CX',  country: 'Uruguay',         lat: -33.0, lng: -56.0  },

  // Africa
  { prefix: 'ZS',  country: 'South Africa',    lat: -30.0, lng: 25.0   },
  { prefix: '5N',  country: 'Nigeria',         lat: 10.0,  lng: 8.0    },
  { prefix: 'SU',  country: 'Egypt',           lat: 27.0,  lng: 30.0   },
  { prefix: 'CN',  country: 'Morocco',         lat: 32.0,  lng: -5.0   },
  { prefix: '5Z',  country: 'Kenya',           lat: -1.0,  lng: 38.0   },
  { prefix: '7X',  country: 'Algeria',         lat: 28.0,  lng: 3.0    },
  { prefix: 'TU',  country: 'Ivory Coast',     lat: 7.5,   lng: -5.5   },

  // Caribbean & Central America
  { prefix: 'CO',  country: 'Cuba',            lat: 22.0,  lng: -80.0  },
  { prefix: 'HI',  country: 'Dominican Rep.',  lat: 19.0,  lng: -70.0  },
  { prefix: 'TI',  country: 'Costa Rica',      lat: 10.0,  lng: -84.0  },
  { prefix: 'HP',  country: 'Panama',          lat: 9.0,   lng: -80.0  },
  { prefix: 'VP5', country: 'Turks & Caicos',  lat: 21.7,  lng: -71.8  },
  { prefix: 'V2',  country: 'Antigua',         lat: 17.1,  lng: -61.8  },
  { prefix: 'J7',  country: 'Dominica',        lat: 15.4,  lng: -61.4  },

  // Middle East
  { prefix: 'A4',  country: 'Oman',            lat: 21.5,  lng: 56.0   },
  { prefix: 'A6',  country: 'UAE',             lat: 24.0,  lng: 54.0   },
  { prefix: 'A7',  country: 'Qatar',           lat: 25.3,  lng: 51.2   },
  { prefix: '4X',  country: 'Israel',          lat: 31.5,  lng: 34.8   },
  { prefix: 'TA',  country: 'Turkey',          lat: 39.0,  lng: 35.0   },
  { prefix: 'HZ',  country: 'Saudi Arabia',    lat: 24.0,  lng: 45.0   },
];

// ── Helpers ─────────────────────────────────────────────────────────

function lookupPrefixCoords(callsign: string): { country: string; lat: number; lng: number } | null {
  // Use shared utility first (has 188 prefixes)
  const shared = callsignPrefixToLocation(callsign);
  if (shared) return { country: shared.country, lat: shared.lat, lng: shared.lng };
  // Fallback to local PREFIX_MAP
  const upper = callsign.toUpperCase();
  for (let len = 3; len >= 1; len--) {
    const prefix = upper.slice(0, len);
    const match = PREFIX_MAP.find((p) => p.prefix === prefix);
    if (match) return { country: match.country, lat: match.lat, lng: match.lng };
  }
  return null;
}

function coordsToGrid(lat: number, lng: number): string {
  return latLngToGrid(lat, lng).slice(0, 4); // 4-char grid for display
}

function isValidCallsign(cs: string): boolean {
  // 1-2 letter/digit prefix + digit + 1-3 letter suffix
  // Covers formats like W1AW, VK3ABC, JA1XYZ, 9V1XX, A61AJ
  return /^[A-Z0-9]{1,2}[A-Z]?\d[A-Z]{1,3}$/i.test(cs);
}

function isValidGrid(grid: string): boolean {
  // 4 or 6 char Maidenhead: 2 letters + 2 digits [+ 2 letters]
  return /^[A-R]{2}\d{2}([A-X]{2})?$/i.test(grid);
}

// ── Component ───────────────────────────────────────────────────────

interface SetupScreenProps {
  onComplete: (callsign: string, grid: string, lat: number, lng: number) => void;
}

export default function SetupScreen({ onComplete }: SetupScreenProps) {
  const [callsign, setCallsign] = useState('');
  const [grid, setGrid] = useState('');
  const [autoGrid, setAutoGrid] = useState(''); // Grid auto-calculated from callsign prefix
  const [userEditedGrid, setUserEditedGrid] = useState(false); // Whether the user has manually edited the grid
  const [country, setCountry] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [callsignError, setCallsignError] = useState('');
  const [gridError, setGridError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-lookup when callsign changes
  useEffect(() => {
    if (callsign.length >= 3 && isValidCallsign(callsign)) {
      setCallsignError('');
      const result = lookupPrefixCoords(callsign);
      if (result) {
        setCountry(result.country);
        setLat(result.lat);
        setLng(result.lng);
        const calculatedGrid = coordsToGrid(result.lat, result.lng);
        setAutoGrid(calculatedGrid);
        // Only auto-fill grid if the user hasn't manually edited it
        if (!userEditedGrid) {
          setGrid(calculatedGrid);
        }
      }
    } else if (callsign.length > 0 && callsign.length >= 3) {
      setCallsignError('Invalid format (e.g. W1AW, VK3ABC)');
      setCountry('');
      setAutoGrid('');
    } else {
      setCallsignError('');
      setCountry('');
      setAutoGrid('');
    }
  }, [callsign]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCallsignChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCallsign(e.target.value.toUpperCase());
  }, []);

  const handleGridChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setGrid(val);
    // If user clears the grid, reset the flag so next callsign change re-auto-populates
    if (val === '') {
      setUserEditedGrid(false);
    } else {
      setUserEditedGrid(true);
    }
    if (val.length >= 4 && !isValidGrid(val)) {
      setGridError('Invalid grid (e.g. FN31, EM73op)');
    } else {
      setGridError('');
    }
  }, []);

  const handleStart = useCallback(() => {
    if (!callsign) {
      setCallsignError('Please enter a callsign');
      return;
    }
    if (!isValidCallsign(callsign)) {
      setCallsignError('Invalid callsign format');
      return;
    }
    if (grid && !isValidGrid(grid)) {
      setGridError('Invalid grid square format');
      return;
    }

    const finalLat = lat ?? 40.0;
    const finalLng = lng ?? -74.0;
    const finalGrid = grid || coordsToGrid(finalLat, finalLng);

    onComplete(callsign, finalGrid, finalLat, finalLng);
  }, [callsign, grid, lat, lng, onComplete]);

  const handleSkip = useCallback(() => {
    onComplete('', '', 40.0, -74.0);
  }, [onComplete]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleStart();
    },
    [handleStart],
  );

  return (
    <div style={overlayStyle}>
      <style>{glowKeyframes}</style>
      <div style={cardStyle}>
        {/* Title */}
        <div style={titleStyle}>HAMCLOCK REBORN</div>
        <div style={subtitleStyle}>Enter Your Station Info</div>

        {/* Callsign */}
        <label style={labelStyle}>CALLSIGN</label>
        <input
          ref={inputRef}
          type="text"
          value={callsign}
          onChange={handleCallsignChange}
          onKeyDown={handleKeyDown}
          placeholder="W1AW"
          maxLength={10}
          style={inputStyle}
          autoComplete="off"
          spellCheck={false}
        />
        {callsignError && <div style={errorStyle}>{callsignError}</div>}
        {country && !callsignError && (
          <div style={countryStyle}>{country}</div>
        )}

        {/* Grid Square */}
        <label style={{ ...labelStyle, marginTop: 18 }}>GRID SQUARE</label>
        <input
          type="text"
          value={grid}
          onChange={handleGridChange}
          onKeyDown={handleKeyDown}
          placeholder={autoGrid || 'FN31'}
          maxLength={6}
          style={{ ...inputStyle, fontSize: 20 }}
          autoComplete="off"
          spellCheck={false}
        />
        {gridError && <div style={errorStyle}>{gridError}</div>}
        {lat != null && lng != null && !gridError && (
          <div style={coordStyle}>
            {lat.toFixed(1)}&deg;N, {lng.toFixed(1)}&deg;{lng >= 0 ? 'E' : 'W'}
          </div>
        )}

        {/* Buttons */}
        <button onClick={handleStart} style={startButtonStyle}>
          START
        </button>
        <button onClick={handleSkip} style={skipButtonStyle}>
          Continue without callsign
        </button>
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const glowKeyframes = `
@keyframes greenGlow {
  0%   { box-shadow: 0 0 20px rgba(255, 255, 255, 0.08), 0 0 60px rgba(0, 212, 255, 0.05); }
  50%  { box-shadow: 0 0 30px rgba(255, 255, 255, 0.15), 0 0 80px rgba(0, 212, 255, 0.08); }
  100% { box-shadow: 0 0 20px rgba(255, 255, 255, 0.08), 0 0 60px rgba(0, 212, 255, 0.05); }
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  background: '#0a0e14',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: "'Courier New', Consolas, monospace",
};

const cardStyle: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 12,
  padding: '48px 44px 36px',
  width: 400,
  maxWidth: '90vw',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  animation: 'greenGlow 3s ease-in-out infinite, fadeIn 0.6s ease-out',
};

const titleStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 'bold',
  letterSpacing: 6,
  color: '#ffffff',
  marginBottom: 6,
  textShadow: '0 0 20px rgba(255,255,255,0.2)',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#8899aa',
  letterSpacing: 2,
  marginBottom: 36,
  textTransform: 'uppercase',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 'bold',
  letterSpacing: 3,
  color: '#e0e0e0',
  alignSelf: 'flex-start',
  marginBottom: 6,
  textTransform: 'uppercase',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 16px',
  fontSize: 26,
  fontFamily: "'Courier New', Consolas, monospace",
  fontWeight: 'bold',
  letterSpacing: 4,
  color: '#ffffff',
  background: '#060a10',
  border: '1px solid #2a3040',
  borderRadius: 6,
  outline: 'none',
  textAlign: 'center',
  textTransform: 'uppercase',
  caretColor: '#ffffff',
};

const errorStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#ff4444',
  marginTop: 4,
  height: 16,
};

const countryStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#00d4ff',
  marginTop: 4,
  height: 16,
  letterSpacing: 1,
};

const coordStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#8899aa',
  marginTop: 4,
  height: 16,
};

const startButtonStyle: React.CSSProperties = {
  marginTop: 28,
  width: '100%',
  padding: '14px 0',
  fontSize: 16,
  fontWeight: 'bold',
  fontFamily: "'Courier New', Consolas, monospace",
  letterSpacing: 6,
  color: '#0a0e14',
  background: 'linear-gradient(135deg, #00ff41, #00cc33)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  textTransform: 'uppercase',
  boxShadow: '0 0 20px rgba(0,255,65,0.3)',
  transition: 'box-shadow 0.2s, transform 0.1s',
};

const skipButtonStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '8px 16px',
  fontSize: 11,
  fontFamily: "'Courier New', Consolas, monospace",
  color: '#8899aa',
  background: 'transparent',
  border: '1px solid #2a3040',
  borderRadius: 4,
  cursor: 'pointer',
  letterSpacing: 1,
  transition: 'color 0.2s, border-color 0.2s',
};
