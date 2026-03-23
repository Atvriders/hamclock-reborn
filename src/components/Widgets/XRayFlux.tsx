import React, { useState, useEffect, useCallback } from 'react';

// NOAA GOES X-ray flux plot — static image updated every few minutes
// Multiple URLs to try (some may be blocked or 404)
const XRAY_PLOT_URLS = [
  'https://services.swpc.noaa.gov/images/animations/goes-xray/1-day.png',
  'https://services.swpc.noaa.gov/images/swx-overview-large.gif',
  'https://services.swpc.noaa.gov/images/goes-xray-flux-6-hour.png',
];

const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

const XRayFlux: React.FC = () => {
  const [urlIndex, setUrlIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cacheBust, setCacheBust] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);

  const currentUrl = XRAY_PLOT_URLS[urlIndex] ?? XRAY_PLOT_URLS[0];
  const imageUrl = `${currentUrl}?t=${cacheBust}`;

  const refresh = useCallback(() => {
    setUrlIndex(0);
    setCacheBust(Date.now());
    setLoading(true);
    setError(false);
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  const handleError = useCallback(() => {
    setUrlIndex(prev => {
      const next = prev + 1;
      if (next < XRAY_PLOT_URLS.length) {
        setLoading(true);
        setError(false);
        return next;
      }
      setLoading(false);
      setError(true);
      return prev;
    });
  }, []);

  const handleLoad = useCallback(() => {
    setLoading(false);
    setError(false);
  }, []);

  return (
    <div style={{
      padding: '10px 14px',
      fontFamily: "'Courier New', Courier, monospace",
      background: '#0d1117',
    }}>
      {/* Header */}
      <div style={{
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 2,
        marginBottom: 8,
        paddingBottom: 6,
        borderBottom: '1px solid #1a2332',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>X-RAY FLUX</span>
        <span
          onClick={refresh}
          style={{ fontSize: 10, color: '#4a5568', cursor: 'pointer' }}
          title="Refresh"
        >
          ↻
        </span>
      </div>

      {/* Plot image */}
      <div
        style={{
          width: '100%',
          minHeight: 120,
          background: '#0a0e14',
          borderRadius: 4,
          border: '1px solid #1a2332',
          overflow: 'hidden',
          cursor: 'pointer',
          position: 'relative',
        }}
        onClick={() => !error && setExpanded(true)}
        title="Click to expand"
      >
        {loading && !error && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#4a5568', fontSize: 11,
          }}>
            Loading...
          </div>
        )}

        {error && (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: 20, color: '#4a5568', fontSize: 11, gap: 4,
          }}>
            <span style={{ fontSize: 20 }}>📡</span>
            <span>No X-ray data</span>
            <span onClick={(e) => { e.stopPropagation(); refresh(); }}
              style={{ color: '#00d4ff', cursor: 'pointer', fontSize: 10 }}>
              Tap to retry
            </span>
          </div>
        )}

        <img
          key={`xray-${urlIndex}-${cacheBust}`}
          src={imageUrl}
          alt="GOES X-Ray Flux"
          onLoad={handleLoad}
          onError={handleError}
          style={{
            width: '100%',
            height: 'auto',
            display: loading || error ? 'none' : 'block',
          }}
        />
      </div>

      <div style={{ fontSize: 9, color: '#4a5568', marginTop: 4 }}>
        Source: NOAA/SWPC GOES
      </div>

      {/* Expanded modal */}
      {expanded && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(false)}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <button
              onClick={() => setExpanded(false)}
              style={{
                position: 'absolute', top: -30, right: 0,
                background: 'none', border: 'none', color: '#fff',
                fontSize: 20, cursor: 'pointer',
              }}
            >
              ✕
            </button>
            <img
              src={imageUrl}
              alt="GOES X-Ray Flux (expanded)"
              style={{
                maxWidth: '90vw', maxHeight: '85vh',
                border: '2px solid #1a2332', borderRadius: 8,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default XRayFlux;
