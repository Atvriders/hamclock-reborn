import React, { useState, useEffect, useCallback, useRef } from 'react';

interface HeaderProps {
  callsign?: string;
  onCallsignChange?: (callsign: string) => void;
}

const COLORS = {
  bg: '#080c12',
  primary: '#ffffff',
  cyan: '#00d4ff',
  muted: '#4a5568',
  border: '#1a2332',
  text: '#8899aa',
  green: '#00ff88',
  red: '#ff4444',
};

const Header: React.FC<HeaderProps> = ({ callsign: callsignProp, onCallsignChange }) => {
  const [utcTime, setUtcTime] = useState(new Date());
  const [callsign, setCallsign] = useState(() => {
    return callsignProp || localStorage.getItem('hamclock_callsign') || '';
  });
  const [editingCallsign, setEditingCallsign] = useState(false);
  const [dataFlowing, setDataFlowing] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setUtcTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync prop changes
  useEffect(() => {
    if (callsignProp !== undefined && callsignProp !== callsign) {
      setCallsign(callsignProp);
    }
  }, [callsignProp]);

  // Simple connection status: pulse green, go red after 60s of no update
  useEffect(() => {
    const check = setInterval(() => {
      const lastFetch = localStorage.getItem('hamclock_last_fetch');
      if (lastFetch) {
        const age = Date.now() - Number(lastFetch);
        setDataFlowing(age < 60000);
      }
    }, 5000);
    return () => clearInterval(check);
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (editingCallsign && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCallsign]);

  const handleCallsignSave = useCallback((value: string) => {
    const upper = value.toUpperCase().trim();
    setCallsign(upper);
    localStorage.setItem('hamclock_callsign', upper);
    setEditingCallsign(false);
    onCallsignChange?.(upper);
  }, [onCallsignChange]);

  const formatUTC = (d: Date): string => {
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const formatLocalTime = (d: Date): string => {
    return d.toLocaleTimeString('en-US', { hour12: false });
  };

  const formatDate = (d: Date): string => {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  };

  return (
    <header style={{
      height: 44,
      background: COLORS.bg,
      borderBottom: `1px solid ${COLORS.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      fontFamily: "'Courier New', Courier, monospace",
      boxSizing: 'border-box',
    }}>
      {/* Left: Title + Callsign */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 240 }}>
        <span style={{
          color: COLORS.primary,
          fontSize: 13,
          fontWeight: 'bold',
          letterSpacing: 2,
          whiteSpace: 'nowrap',
        }}>
          HAMCLOCK REBORN
        </span>
        {editingCallsign ? (
          <input
            ref={inputRef}
            defaultValue={callsign}
            placeholder="CALL"
            maxLength={10}
            onBlur={(e) => handleCallsignSave(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCallsignSave((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setEditingCallsign(false);
            }}
            style={{
              background: '#0d1520',
              border: `1px solid ${COLORS.cyan}`,
              color: COLORS.cyan,
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 12,
              padding: '1px 5px',
              width: 80,
              outline: 'none',
              textTransform: 'uppercase',
              borderRadius: 2,
            }}
          />
        ) : (
          <span
            onClick={() => setEditingCallsign(true)}
            title="Click to edit callsign"
            style={{
              color: callsign ? COLORS.cyan : COLORS.muted,
              fontSize: 12,
              cursor: 'pointer',
              padding: '1px 5px',
              borderRadius: 2,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#0d1520')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {callsign || 'CALLSIGN'}
          </span>
        )}
      </div>

      {/* Center: UTC Clock */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
      }}>
        <span style={{
          color: COLORS.primary,
          fontSize: 24,
          fontWeight: 'bold',
          letterSpacing: 3,
          lineHeight: 1,
          fontFamily: "'Courier New', Courier, monospace",
        }}>
          {formatUTC(utcTime)}
        </span>
        <span style={{ color: COLORS.muted, fontSize: 8, letterSpacing: 2, marginTop: 1 }}>UTC</span>
      </div>

      {/* Right: Local Time + Date + Status Dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 240, justifyContent: 'flex-end' }}>
        <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
          <div style={{ color: COLORS.text, fontSize: 12, letterSpacing: 1 }}>
            {formatLocalTime(utcTime)}
          </div>
          <div style={{ color: COLORS.muted, fontSize: 10, letterSpacing: 1 }}>
            {formatDate(utcTime)}
          </div>
        </div>
        {/* Connection status dot */}
        <div
          title={dataFlowing ? 'Data flowing' : 'No data connection'}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dataFlowing ? COLORS.green : COLORS.red,
            boxShadow: dataFlowing
              ? `0 0 6px ${COLORS.green}80`
              : `0 0 6px ${COLORS.red}80`,
            flexShrink: 0,
            transition: 'background 0.3s, box-shadow 0.3s',
          }}
        />
      </div>
    </header>
  );
};

export default Header;
