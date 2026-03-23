import React, { useState, useCallback } from 'react';

const HRDLOG_URL = 'https://www.hrdlog.net/graph.aspx?type=p';
const REFRESH_INTERVAL = 15 * 60 * 1000;

const HRDLogGraph: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cacheBust, setCacheBust] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);

  const imageUrl = `${HRDLOG_URL}&t=${cacheBust}`;

  const refresh = useCallback(() => {
    setCacheBust(Date.now());
    setLoading(true);
    setError(false);
  }, []);

  React.useEffect(() => {
    const id = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div style={{
      padding: '10px 14px',
      fontFamily: "'Courier New', Courier, monospace",
      background: '#0d1117',
      borderBottom: '1px solid #1a2332',
    }}>
      <div style={{
        color: '#ffffff',
        fontSize: 11,
        fontWeight: 'bold',
        letterSpacing: 1.5,
        marginBottom: 6,
        paddingBottom: 4,
        borderBottom: '1px solid #1a2332',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>PROPAGATION</span>
        <span onClick={refresh} style={{ fontSize: 10, color: '#4a5568', cursor: 'pointer' }} title="Refresh">↻</span>
      </div>

      <div
        style={{
          width: '100%',
          minHeight: 60,
          background: '#0a0e14',
          borderRadius: 4,
          border: '1px solid #1a2332',
          overflow: 'hidden',
          cursor: 'pointer',
          position: 'relative',
        }}
        onClick={() => !error && setExpanded(true)}
        title="HRDLog Propagation — click to expand"
      >
        {loading && !error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5568', fontSize: 10 }}>
            Loading...
          </div>
        )}
        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, color: '#4a5568', fontSize: 10, gap: 3 }}>
            <span style={{ fontSize: 16 }}>📊</span>
            <span>No data</span>
            <span onClick={(e) => { e.stopPropagation(); refresh(); }} style={{ color: '#00d4ff', cursor: 'pointer', fontSize: 9 }}>Retry</span>
          </div>
        )}
        <img
          key={`hrdlog-${cacheBust}`}
          src={imageUrl}
          alt="HRDLog Propagation"
          onLoad={() => { setLoading(false); setError(false); }}
          onError={() => { setLoading(false); setError(true); }}
          style={{ width: '100%', height: 'auto', display: loading || error ? 'none' : 'block' }}
        />
      </div>

      <div style={{ fontSize: 8, color: '#4a5568', marginTop: 3 }}>Source: HRDLog.net</div>

      {expanded && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          onClick={() => setExpanded(false)}
        >
          <div style={{ position: 'relative' }}>
            <button onClick={() => setExpanded(false)} style={{ position: 'absolute', top: -30, right: 0, background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer' }}>✕</button>
            <img src={imageUrl} alt="HRDLog Propagation (expanded)" style={{ maxWidth: '90vw', maxHeight: '85vh', border: '2px solid #1a2332', borderRadius: 8 }} />
          </div>
        </div>
      )}
    </div>
  );
};

export default HRDLogGraph;
