import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── SDO Image Sources ───────────────────────────────────────────────
// Each source has an ordered list of URLs to try. If one fails, the next
// is attempted automatically. Order: server proxy → NASA direct → SOHO fallback.
const IMAGE_SOURCES = [
  {
    id: 'aia193',
    label: '193',
    desc: 'AIA 193 (EUV)',
    urls: [
      '/api/solar/proxy/aia193',
      'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg',
      'https://soho.nascom.nasa.gov/data/realtime/eit_195/512/latest.jpg',
    ],
  },
  {
    id: 'aia304',
    label: '304',
    desc: 'AIA 304 (He II)',
    urls: [
      '/api/solar/proxy/aia304',
      'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0304.jpg',
      'https://soho.nascom.nasa.gov/data/realtime/eit_304/512/latest.jpg',
    ],
  },
  {
    id: 'aia171',
    label: '171',
    desc: 'AIA 171 (Fe IX)',
    urls: [
      '/api/solar/proxy/aia171',
      'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0171.jpg',
      'https://soho.nascom.nasa.gov/data/realtime/eit_171/512/latest.jpg',
    ],
  },
  {
    id: 'hmimag',
    label: 'MAG',
    desc: 'HMI Magnetogram',
    urls: [
      '/api/solar/proxy/hmi-mag',
      'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIBC.jpg',
      'https://soho.nascom.nasa.gov/data/realtime/hmi_mag/512/latest.jpg',
    ],
  },
  {
    id: 'hmiint',
    label: 'INT',
    desc: 'HMI Intensitygram',
    urls: [
      '/api/solar/proxy/hmi-int',
      'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIC.jpg',
      'https://soho.nascom.nasa.gov/data/realtime/hmi_igr/512/latest.jpg',
    ],
  },
] as const;

type SourceId = typeof IMAGE_SOURCES[number]['id'];

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const IMAGE_LOAD_TIMEOUT_MS = 20_000; // 20 seconds

// ── Theme ───────────────────────────────────────────────────────────
const C = {
  bg: '#0a0e14',
  bgPanel: '#0d1117',
  green: '#00ff88',
  greenDim: '#0a3322',
  muted: '#4a5568',
  border: '#1a2332',
  text: '#8899aa',
  red: '#ff4444',
};

// ── Component ───────────────────────────────────────────────────────
const SolarImage: React.FC = () => {
  const [activeSource, setActiveSource] = useState<SourceId>('aia193');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const [hovered, setHovered] = useState<SourceId | null>(null);
  // Track which URL index we're currently trying for the active source
  const [urlIndex, setUrlIndex] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const source = IMAGE_SOURCES.find((s) => s.id === activeSource) ?? IMAGE_SOURCES[0];

  // Build the image URL — use the current URL index with cache-busting
  const currentUrl = source.urls[urlIndex] ?? source.urls[0];
  const separator = currentUrl.includes('?') ? '&' : '?';
  const imageUrl = `${currentUrl}${separator}t=${cacheBuster}`;

  // Clear any pending load timeout
  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  // Auto-refresh every 15 minutes
  const refresh = useCallback(() => {
    setUrlIndex(0); // Reset to first URL on manual/auto refresh
    setCacheBuster(Date.now());
    setLoading(true);
    setError(false);
  }, []);

  useEffect(() => {
    refreshTimer.current = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [refresh]);

  // Reset loading/error/urlIndex when source changes
  useEffect(() => {
    setUrlIndex(0);
    setLoading(true);
    setError(false);
  }, [activeSource]);

  // Set a timeout so we don't spin forever if the image silently fails
  useEffect(() => {
    clearLoadTimeout();
    if (loading) {
      loadTimeoutRef.current = setTimeout(() => {
        // Timeout — treat as error, try next URL
        handleImageError();
      }, IMAGE_LOAD_TIMEOUT_MS);
    }
    return clearLoadTimeout;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cacheBuster, activeSource, urlIndex, clearLoadTimeout]);

  const handleImageLoad = useCallback(() => {
    clearLoadTimeout();
    setLoading(false);
    setError(false);
  }, [clearLoadTimeout]);

  const handleImageError = useCallback(() => {
    clearLoadTimeout();
    // Try the next URL in the list
    setUrlIndex((prev) => {
      const nextIdx = prev + 1;
      if (nextIdx < source.urls.length) {
        // There's another URL to try — stay in loading state
        setLoading(true);
        setError(false);
        return nextIdx;
      }
      // All URLs exhausted — show error
      setLoading(false);
      setError(true);
      return prev;
    });
  }, [clearLoadTimeout, source.urls.length]);

  const imgSize = 160;

  // Error / placeholder fallback
  const ErrorPlaceholder: React.FC<{ size: number }> = ({ size }) => (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: C.bg,
        color: C.muted,
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: Math.max(10, size / 16),
        textAlign: 'center',
        padding: 8,
      }}
    >
      <div style={{ fontSize: Math.max(20, size / 6), marginBottom: 6, opacity: 0.5 }}>&#9788;</div>
      <div>NO IMAGE</div>
      <div style={{ fontSize: Math.max(8, size / 22), marginTop: 4, color: C.muted }}>
        Tap to retry
      </div>
    </div>
  );

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
            border: `2px solid ${error ? C.red : C.green}`,
            boxShadow: error
              ? `0 0 12px ${C.red}44, 0 0 4px ${C.red}22`
              : `0 0 12px ${C.green}44, 0 0 4px ${C.green}22`,
            overflow: 'hidden',
            background: C.bg,
            cursor: 'pointer',
          }}
          onClick={() => {
            if (error) {
              refresh();
            } else {
              setExpanded(true);
            }
          }}
          title={error ? 'Click to retry' : 'Click to expand'}
        >
          {/* Loading spinner */}
          {loading && (
            <div style={spinnerOverlayStyle}>
              <div style={spinnerStyle} />
            </div>
          )}

          {/* Error placeholder */}
          {error && !loading && <ErrorPlaceholder size={imgSize} />}

          {/* The actual image — always rendered so it can attempt loading */}
          <img
            key={`${activeSource}-${urlIndex}-${cacheBuster}`}
            src={imageUrl}
            alt={source.desc}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: loading || error ? 'none' : 'block',
            }}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        </div>

        {/* Source description */}
        <div style={descStyle}>
          {source.desc}
          {error && (
            <span style={{ color: C.red, marginLeft: 6, fontSize: 8 }}>[OFFLINE]</span>
          )}
        </div>

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
                  color: isActive ? C.bg : '#e0e0e0',
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
              {error ? (
                <ErrorPlaceholder size={400} />
              ) : (
                <img
                  key={`modal-${activeSource}-${urlIndex}-${cacheBuster}`}
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
                  onError={handleImageError}
                />
              )}
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
                      color: isActive ? C.bg : '#e0e0e0',
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
  color: '#ffffff',
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
  color: '#ffffff',
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
