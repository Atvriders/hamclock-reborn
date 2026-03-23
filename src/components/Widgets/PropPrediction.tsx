import React, { useState, useCallback, useEffect, useRef } from 'react';
import { BandConditions } from '../../types';
import { gridToLatLng, callsignPrefixToLocation, latLngToGrid } from '../../utils/hamradio';

// ── Types ──────────────────────────────────────────────────────────

interface PropPredictionProps {
  userLat: number;
  userLng: number;
  bands: BandConditions | null;
}

interface BandPrediction {
  reliability: number;
  condition: string;
  snr?: number;
}

interface PredictionResult {
  from: { lat: number; lng: number; grid: string };
  to: { lat: number; lng: number; grid: string };
  distance: number;
  bearing: number;
  band: string;
  prediction: {
    reliability: number;
    snr: number;
    condition: string;
    bestTime: string;
  };
  allBands: Record<string, BandPrediction>;
}

// ── Theme ──────────────────────────────────────────────────────────

const C = {
  bg: '#0a0e14',
  bgPanel: '#0d1117',
  green: '#00ff88',
  greenDim: '#0a3322',
  amber: '#ffb800',
  amberDim: '#332a00',
  red: '#ff4444',
  redDim: '#331111',
  cyan: '#00d4ff',
  muted: '#4a5568',
  border: '#1a2332',
  text: '#8899aa',
  white: '#ffffff',
};

function reliabilityColor(pct: number): string {
  if (pct >= 60) return C.green;
  if (pct >= 30) return C.amber;
  return C.red;
}

function reliabilityBg(pct: number): string {
  if (pct >= 60) return C.greenDim;
  if (pct >= 30) return C.amberDim;
  return C.redDim;
}

// ── Helpers ────────────────────────────────────────────────────────

/** Detect if input looks like a grid square (4 or 6 chars: 2 letters, 2 digits, optional 2 letters) */
function isGridSquare(input: string): boolean {
  return /^[A-Ra-r]{2}\d{2}([A-Xa-x]{2})?$/.test(input.trim());
}

/** Detect if input looks like a lat,lng pair */
function isLatLng(input: string): boolean {
  return /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(input.trim());
}

/** Parse lat,lng from string */
function parseLatLng(input: string): { lat: number; lng: number } | null {
  const parts = input.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

// ── Component ──────────────────────────────────────────────────────

const PropPrediction: React.FC<PropPredictionProps> = ({ userLat, userLng, bands }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [resolvedLabel, setResolvedLabel] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPrediction = useCallback(
    async (toLat: number, toLng: number, label: string) => {
      setLoading(true);
      setError(null);
      setResolvedLabel(label);
      try {
        const url =
          `/api/propagation?fromLat=${userLat}&fromLng=${userLng}` +
          `&toLat=${toLat}&toLng=${toLng}&band=20m`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PredictionResult = await res.json();
        setResult(data);
      } catch (err: any) {
        setError(err.message || 'Fetch failed');
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [userLat, userLng],
  );

  const handleSubmit = useCallback(() => {
    const val = input.trim();
    if (!val) return;

    // Grid square
    if (isGridSquare(val)) {
      const loc = gridToLatLng(val);
      if (loc) {
        fetchPrediction(loc.lat, loc.lng, val.toUpperCase());
      } else {
        setError('Invalid grid square');
      }
      return;
    }

    // Lat,Lng
    if (isLatLng(val)) {
      const loc = parseLatLng(val);
      if (loc) {
        const grid = latLngToGrid(loc.lat, loc.lng);
        fetchPrediction(loc.lat, loc.lng, `${loc.lat.toFixed(1)}, ${loc.lng.toFixed(1)} (${grid})`);
      } else {
        setError('Invalid coordinates');
      }
      return;
    }

    // Callsign lookup
    const loc = callsignPrefixToLocation(val);
    if (loc) {
      fetchPrediction(loc.lat, loc.lng, `${val.toUpperCase()} (${loc.country})`);
    } else {
      setError('Unknown callsign prefix');
    }
  }, [input, fetchPrediction]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSubmit();
    },
    [handleSubmit],
  );

  // All bands to display
  const BAND_ORDER = ['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];

  if (collapsed) {
    return (
      <div
        style={{
          ...containerStyle,
          cursor: 'pointer',
          padding: '6px 10px',
        }}
        onClick={() => setCollapsed(false)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={titleStyle}>PROP PREDICTION</span>
          <span style={{ color: C.muted, fontSize: 10 }}>+</span>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Title bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
          paddingBottom: 4,
          borderBottom: `1px solid ${C.border}`,
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed(true)}
      >
        <span style={titleStyle}>PROP PREDICTION</span>
        <span style={{ color: C.muted, fontSize: 10 }}>-</span>
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Call / Grid / Lat,Lng"
          style={inputStyle}
        />
        <button onClick={handleSubmit} style={btnStyle} disabled={loading || !input.trim()}>
          {loading ? '...' : 'GO'}
        </button>
      </div>

      {/* Error */}
      {error && <div style={{ color: C.red, fontSize: 9, marginBottom: 4 }}>{error}</div>}

      {/* Results */}
      {result && (
        <div style={{ fontSize: 9, lineHeight: '14px' }}>
          {/* Path info */}
          <div style={{ color: C.cyan, marginBottom: 4, fontWeight: 'bold' }}>
            {resolvedLabel}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, color: C.text }}>
            <span>{result.distance.toLocaleString()} km</span>
            <span>{Math.round(result.distance * 0.621371).toLocaleString()} mi</span>
            <span>{result.bearing}&deg;</span>
          </div>
          <div style={{ color: C.muted, marginBottom: 2, fontSize: 8 }}>
            {result.from.grid} &rarr; {result.to.grid}
          </div>

          {/* Primary prediction */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '3px 6px',
              marginBottom: 4,
              background: reliabilityBg(result.prediction.reliability),
              borderRadius: 3,
              border: `1px solid ${reliabilityColor(result.prediction.reliability)}44`,
            }}
          >
            <span style={{ color: C.white, fontWeight: 'bold' }}>
              {result.prediction.condition}
            </span>
            <span style={{ color: reliabilityColor(result.prediction.reliability) }}>
              {result.prediction.reliability}% / SNR {result.prediction.snr}dB
            </span>
          </div>
          <div style={{ color: C.muted, fontSize: 8, marginBottom: 6 }}>
            Best: {result.prediction.bestTime}
          </div>

          {/* All bands table */}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '1px 6px' }}>
            {BAND_ORDER.map((band) => {
              const bp = result.allBands[band];
              if (!bp) return null;
              const color = reliabilityColor(bp.reliability);
              const bg = reliabilityBg(bp.reliability);
              return (
                <React.Fragment key={band}>
                  <span style={{ color: C.white, fontWeight: 'bold' }}>{band}</span>
                  {/* Bar */}
                  <div
                    style={{
                      position: 'relative',
                      height: 12,
                      background: C.bg,
                      borderRadius: 2,
                      overflow: 'hidden',
                      alignSelf: 'center',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${bp.reliability}%`,
                        background: color,
                        opacity: 0.35,
                        borderRadius: 2,
                      }}
                    />
                  </div>
                  <span style={{ color, textAlign: 'right', minWidth: 28 }}>
                    {bp.reliability}%
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Hint when no result */}
      {!result && !error && !loading && (
        <div style={{ color: C.muted, fontSize: 8, fontStyle: 'italic' }}>
          Enter a callsign (W1AW), grid (FN31), or lat,lng (51.5,-0.1)
        </div>
      )}
    </div>
  );
};

// ── Styles ─────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: '#0d1117',
  padding: '8px 10px',
  fontFamily: "'Courier New', Consolas, monospace",
  borderTop: '1px solid #1a2332',
};

const titleStyle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: 10,
  fontWeight: 'bold',
  letterSpacing: 2,
  textTransform: 'uppercase',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: '#0a0e14',
  color: '#e0e0e0',
  border: '1px solid #1a2332',
  borderRadius: 3,
  padding: '3px 6px',
  fontSize: 10,
  fontFamily: "'Courier New', Consolas, monospace",
  outline: 'none',
  minWidth: 0,
};

const btnStyle: React.CSSProperties = {
  background: '#00ff88',
  color: '#0a0e14',
  border: 'none',
  borderRadius: 3,
  padding: '3px 8px',
  fontSize: 10,
  fontWeight: 'bold',
  fontFamily: "'Courier New', Consolas, monospace",
  cursor: 'pointer',
  letterSpacing: 1,
};

export default PropPrediction;
