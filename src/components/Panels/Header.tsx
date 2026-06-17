import React, { useState, useEffect, useCallback, useRef } from 'react';

interface HeaderProps {
  className?: string;
  callsign?: string;
  onCallsignChange?: (callsign: string) => void;
  gridSquare?: string;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatUTC(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function formatLocal(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatDate(d: Date): string {
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const Header: React.FC<HeaderProps> = ({
  className,
  callsign: callsignProp,
  onCallsignChange,
  gridSquare,
}) => {
  const [utcTime, setUtcTime] = useState(new Date());
  const [callsign, setCallsign] = useState(() => {
    return callsignProp || localStorage.getItem('hamclock_callsign') || '';
  });
  const [editing, setEditing] = useState(false);
  const [dataFlowing, setDataFlowing] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setUtcTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (callsignProp !== undefined && callsignProp !== callsign) {
      setCallsign(callsignProp);
    }
  }, [callsignProp]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSave = useCallback(
    (value: string) => {
      const upper = value.toUpperCase().trim();
      setCallsign(upper);
      localStorage.setItem('hamclock_callsign', upper);
      setEditing(false);
      onCallsignChange?.(upper);
    },
    [onCallsignChange],
  );

  return (
    <header className={`ob-panel ob-header ${className ?? ''}`}>
      <div className="ob-header__left">
        <span className="ob-header__brand">HamClock Reborn</span>
        {editing ? (
          <input
            ref={inputRef}
            className="ob-header__callsign-input"
            defaultValue={callsign}
            placeholder="CALL"
            maxLength={10}
            onBlur={(e) => handleSave(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <span
            className={`ob-display ob-header__callsign ${callsign ? '' : 'ob-header__callsign--empty'}`}
            onClick={() => setEditing(true)}
            title="Click to edit callsign"
          >
            {callsign || 'CALLSIGN'}
          </span>
        )}
        {gridSquare && <span className="ob-header__grid">{gridSquare}</span>}
      </div>

      <div className="ob-header__center">
        <span className="ob-header__utc ob-amber-live">{formatUTC(utcTime)}</span>
        <span className="ob-header__utc-label">UTC</span>
      </div>

      <div className="ob-header__right">
        <div className="ob-header__local-block">
          <span className="ob-header__local">{formatLocal(utcTime)} LOCAL</span>
          <span className="ob-header__date">{formatDate(utcTime)}</span>
        </div>
        <div className="ob-header__lock">
          <span
            className={`ob-header__lock-line ${dataFlowing ? 'ob-header__lock-line--good' : 'ob-header__lock-line--poor'}`}
          >
            {dataFlowing ? 'LOCK ACQUIRED' : 'NO LOCK'}
          </span>
          <span className="ob-header__lock-line">S/N 73-2026 · WWV ±0.000s</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
