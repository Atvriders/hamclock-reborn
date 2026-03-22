import React, { useState, useEffect, useCallback } from 'react';

interface HeaderProps {
  callsign?: string;
  onCallsignChange?: (callsign: string) => void;
}

const COLORS = {
  bg: '#0a0e14',
  green: '#00ff88',
  cyan: '#00d4ff',
  muted: '#4a5568',
  border: '#1a2332',
  text: '#8899aa',
};

const Header: React.FC<HeaderProps> = ({ callsign: callsignProp, onCallsignChange }) => {
  const [utcTime, setUtcTime] = useState(new Date());
  const [callsign, setCallsign] = useState(() => {
    return callsignProp || localStorage.getItem('hamclock_callsign') || '';
  });
  const [editingCallsign, setEditingCallsign] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setUtcTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 48,
      background: COLORS.bg,
      borderBottom: `1px solid ${COLORS.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      zIndex: 1000,
      fontFamily: "'Courier New', Courier, monospace",
    }}>
      {/* Left: Title + Callsign */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 280 }}>
        <span style={{
          color: COLORS.green,
          fontSize: 16,
          fontWeight: 'bold',
          letterSpacing: 2,
        }}>
          HAMCLOCK REBORN
        </span>
        {editingCallsign ? (
          <input
            autoFocus
            defaultValue={callsign}
            placeholder="CALLSIGN"
            maxLength={10}
            onBlur={(e) => handleCallsignSave(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCallsignSave((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setEditingCallsign(false);
            }}
            style={{
              background: '#111820',
              border: `1px solid ${COLORS.green}`,
              color: COLORS.green,
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 13,
              padding: '2px 6px',
              width: 90,
              outline: 'none',
              textTransform: 'uppercase',
            }}
          />
        ) : (
          <span
            onClick={() => setEditingCallsign(true)}
            title="Click to edit callsign"
            style={{
              color: callsign ? COLORS.cyan : COLORS.muted,
              fontSize: 13,
              cursor: 'pointer',
              padding: '2px 6px',
              border: `1px dashed ${callsign ? COLORS.border : COLORS.muted}`,
              borderRadius: 2,
            }}
          >
            {callsign || 'CALLSIGN'}
          </span>
        )}
      </div>

      {/* Center: UTC Clock */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{
          color: COLORS.green,
          fontSize: 26,
          fontWeight: 'bold',
          letterSpacing: 3,
          lineHeight: 1,
        }}>
          {formatUTC(utcTime)}
        </span>
        <span style={{ color: COLORS.muted, fontSize: 10, letterSpacing: 1 }}>UTC</span>
      </div>

      {/* Right: Local Time + Date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 280, justifyContent: 'flex-end' }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: COLORS.cyan, fontSize: 16, letterSpacing: 1 }}>
            {formatLocalTime(utcTime)}
          </div>
          <div style={{ color: COLORS.text, fontSize: 11, letterSpacing: 1 }}>
            {formatDate(utcTime)}
          </div>
        </div>
        <span style={{ color: COLORS.muted, fontSize: 10 }}>LOCAL</span>
      </div>
    </header>
  );
};

export default Header;
