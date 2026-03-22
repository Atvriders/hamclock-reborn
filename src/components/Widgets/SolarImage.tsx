import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── SDO Image Sources ───────────────────────────────────────────────
const IMAGE_SOURCES = [
  { id: 'aia193', label: '193', desc: 'AIA 193 (EUV)', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg' },
  { id: 'aia304', label: '304', desc: 'AIA 304 (He II)', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0304.jpg' },
  { id: 'aia171', label: '171', desc: 'AIA 171 (Fe IX)', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0171.jpg' },
  { id: 'hmimag', label: 'MAG', desc: 'HMI Magnetogram', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIBC.jpg' },
  { id: 'hmiint', label: 'INT', desc: 'HMI Intensitygram', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIC.jpg' },
] as const;

type SourceId = typeof IMAGE_SOURCES[number]['id'];

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ── Theme ───────────────────────────────────────────────────────────
const C = {
  bg: '#0a0e14',
  bgPanel: '#0d1117',
  green: '#00ff88',
  greenDim: '#0a3322',
  muted: '#4a5568',
  border: '#1a2332',
  text: '#8899aa',
};

// ── Component ───────────────────────────────────────────────────────
const SolarImage: React.FC = () => {
  const [activeSource, setActiveSource] = useState<SourceId>('aia193');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const [hovered, setHovered] = useState<SourceId | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const source = IMAGE_SOURCES.find((s) => s.id === activeSource)!;
  const imageUrl = `${source.url}?t=${cacheBuster}`;

  // Auto-refresh every 15 minutes
  const refresh = useCallback(() => {
    setCacheBuster(Date.now());
    setLoading(true);
  }, []);

  useEffect(() => {
    refreshTimer.current = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [refresh]);

  // Reset loading when source changes
  useEffect(() => {
    setLoading(true);
  }, [activeSource]);

  const imgSize = 160;

  return (
    <>
      <div style={containerStyle}>
        {/* Title */}
        <div style={titleStyle}>SDO SOLAR</div>

        {/* Image container -- circular crop */}
        <div
          style={{
            position: 'relative',
            width: imgSize,
            height: imgSize,
            margin: '0 auto 8px',
            borderRadius: '50%',
            border: `2px solid ${C.green}`,
            boxShadow: `0 0 12px ${C.green}44, 0 0 4px ${C.green}22`,
            overflow: 'hidden',
            background: C.bg,
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(true)}
          title="Click to expand"
        >
          {/* Loading spinner */}
          {loading && (
            <div style={spinnerOverlayStyle}>
              <div style={spinnerStyle} />
            </div>
          )}

          <img
            src={imageUrl}
            alt={source.desc}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: loading ? 'none' : 'block',
            }}
            onLoad={() => setLoading(false)}
            onError={() => setLoading(false)}
          />
        </div>

        {/* Source description */}
        <div style={descStyle}>{source.desc}</div>

        {/* Selector buttons */}
        <div style={selectorRowStyle}>
          {IMAGE_SOURCES.map((src) => {
            const isActive = src.id === activeSource;
            const isHovered = src.id === hovered;
            return (
              <button
                key={src.id}
                onClick={() => setActiveSource(src.id)}
                onMouseEnter={() => setHovered(src.id)}
                onMouseLeave={() => setHovered(null)}
                title={src.desc}
                style={{
                  background: isActive ? C.green : isHovered ? C.greenDim : 'transparent',
                  color: isActive ? C.bg : C.green,
                  border: `1px solid ${isActive ? C.green : C.border}`,
                  borderRadius: 3,
                  padding: '2px 6px',
                  fontSize: 9,
                  fontFamily: "'Courier New', Courier, monospace",
                  fontWeight: isActive ? 'bold' : 'normal',
                  cursor: 'pointer',
                  letterSpacing: 0.5,
                  lineHeight: '14px',
                  transition: 'all 0.15s ease',
                }}
              >
                {src.label}
              </button>
            );
          })}
        </div>

        {/* Last refresh */}
        <div style={timestampStyle}>
          Updated {new Date(cacheBuster).toISOString().slice(11, 16)} UTC
        </div>
      </div>

      {/* Expanded modal overlay */}
      {expanded && (
        <div style={overlayStyle} onClick={() => setExpanded(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalTitleStyle}>
              <span>{source.desc}</span>
              <button
                onClick={() => setExpanded(false)}
                style={closeBtnStyle}
                title="Close"
              >
                X
              </button>
            </div>
            <div style={modalImageWrapperStyle}>
              <img
                src={imageUrl}
                alt={source.desc}
                style={{
                  width: 512,
                  height: 512,
                  maxWidth: '80vw',
                  maxHeight: '80vh',
                  borderRadius: '50%',
                  border: `3px solid ${C.green}`,
                  boxShadow: `0 0 30px ${C.green}44, 0 0 10px ${C.green}22`,
                  objectFit: 'cover',
                }}
              />
            </div>
            {/* Modal selectors */}
            <div style={{ ...selectorRowStyle, marginTop: 12, justifyContent: 'center' }}>
              {IMAGE_SOURCES.map((src) => {
                const isActive = src.id === activeSource;
                return (
                  <button
                    key={src.id}
                    onClick={() => setActiveSource(src.id)}
                    style={{
                      background: isActive ? C.green : 'transparent',
                      color: isActive ? C.bg : C.green,
                      border: `1px solid ${isActive ? C.green : C.border}`,
                      borderRadius: 3,
                      padding: '4px 10px',
                      fontSize: 11,
                      fontFamily: "'Courier New', Courier, monospace",
                      fontWeight: isActive ? 'bold' : 'normal',
                      cursor: 'pointer',
                      letterSpacing: 0.5,
                    }}
                  >
                    {src.desc}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Spinner keyframe animation (injected once) */}
      <style>{spinnerKeyframes}</style>
    </>
  );
};

// ── Styles ───────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: C.bgPanel,
  padding: '10px 10px 8px',
  fontFamily: "'Courier New', Courier, monospace",
  borderTop: `1px solid ${C.border}`,
};

const titleStyle: React.CSSProperties = {
  color: C.green,
  fontSize: 10,
  fontWeight: 'bold',
  letterSpacing: 2,
  textTransform: 'uppercase',
  marginBottom: 8,
  paddingBottom: 4,
  borderBottom: `1px solid ${C.border}`,
};

const descStyle: React.CSSProperties = {
  color: C.text,
  fontSize: 9,
  textAlign: 'center',
  marginBottom: 6,
  letterSpacing: 0.5,
};

const selectorRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 3,
  justifyContent: 'center',
  flexWrap: 'wrap',
  marginBottom: 6,
};

const timestampStyle: React.CSSProperties = {
  color: C.muted,
  fontSize: 8,
  textAlign: 'center',
  letterSpacing: 0.5,
};

const spinnerOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: C.bg,
  zIndex: 1,
};

const spinnerStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  border: `2px solid ${C.border}`,
  borderTopColor: C.green,
  borderRadius: '50%',
  animation: 'solarimg-spin 0.8s linear infinite',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.85)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  cursor: 'pointer',
};

const modalStyle: React.CSSProperties = {
  background: C.bgPanel,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: 20,
  cursor: 'default',
  maxWidth: '90vw',
  maxHeight: '90vh',
};

const modalTitleStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  color: C.green,
  fontSize: 13,
  fontWeight: 'bold',
  fontFamily: "'Courier New', Courier, monospace",
  letterSpacing: 1,
  marginBottom: 12,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${C.border}`,
  color: C.text,
  fontSize: 12,
  fontFamily: "'Courier New', Courier, monospace",
  cursor: 'pointer',
  padding: '2px 8px',
  borderRadius: 3,
};

const modalImageWrapperStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
};

const spinnerKeyframes = `
@keyframes solarimg-spin {
  to { transform: rotate(360deg); }
}
`;

export default SolarImage;
