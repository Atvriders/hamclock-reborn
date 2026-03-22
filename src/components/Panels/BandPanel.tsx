import React from 'react';
import { BandConditions, ConditionLevel, BandName } from '../../types';

interface BandPanelProps {
  data: BandConditions | null;
}

const COLORS = {
  bgPanel: '#0d1117',
  green: '#00ff88',
  amber: '#ffb800',
  red: '#ff4444',
  cyan: '#00d4ff',
  muted: '#4a5568',
  border: '#1a2332',
  text: '#8899aa',
};

const DISPLAY_BANDS: BandName[] = ['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];

function conditionColor(cond: ConditionLevel): string {
  switch (cond) {
    case 'Good': return COLORS.green;
    case 'Fair': return COLORS.amber;
    case 'Poor': return COLORS.red;
  }
}

function conditionBg(cond: ConditionLevel): string {
  switch (cond) {
    case 'Good': return 'rgba(0, 255, 136, 0.1)';
    case 'Fair': return 'rgba(255, 184, 0, 0.1)';
    case 'Poor': return 'rgba(255, 68, 68, 0.08)';
  }
}

const cellStyle: React.CSSProperties = {
  padding: '4px 8px',
  textAlign: 'center',
  fontSize: 11,
  fontWeight: 'bold',
  fontFamily: "'Courier New', Courier, monospace",
  borderBottom: `1px solid ${COLORS.border}`,
};

function findCondition(
  conditions: Record<string, { day: string; night: string }>,
  band: BandName,
  timeOfDay: 'day' | 'night',
): ConditionLevel {
  const entry = conditions[band];
  if (!entry) return 'Poor';
  const val = timeOfDay === 'day' ? entry.day : entry.night;
  if (val === 'Good' || val === 'Fair' || val === 'Poor') return val;
  return 'Poor';
}

const BandPanel: React.FC<BandPanelProps> = ({ data }) => {
  const conditions = data?.conditions ?? {};

  return (
    <div style={{
      width: 220,
      background: COLORS.bgPanel,
      borderLeft: `1px solid ${COLORS.border}`,
      padding: '12px 10px',
      fontFamily: "'Courier New', Courier, monospace",
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        color: COLORS.green,
        fontSize: 11,
        fontWeight: 'bold',
        letterSpacing: 1.5,
        marginBottom: 10,
        paddingBottom: 6,
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        HF BAND CONDITIONS
      </div>

      {/* Table */}
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        borderSpacing: 0,
      }}>
        <thead>
          <tr>
            <th style={{
              ...cellStyle,
              color: COLORS.muted,
              fontSize: 10,
              fontWeight: 'normal',
              textAlign: 'left',
              letterSpacing: 1,
            }}>
              BAND
            </th>
            <th style={{
              ...cellStyle,
              color: COLORS.muted,
              fontSize: 10,
              fontWeight: 'normal',
              letterSpacing: 1,
            }}>
              DAY
            </th>
            <th style={{
              ...cellStyle,
              color: COLORS.muted,
              fontSize: 10,
              fontWeight: 'normal',
              letterSpacing: 1,
            }}>
              NIGHT
            </th>
          </tr>
        </thead>
        <tbody>
          {DISPLAY_BANDS.map((band) => {
            const dayCondition = findCondition(conditions, band, 'day');
            const nightCondition = findCondition(conditions, band, 'night');
            return (
              <tr key={band}>
                <td style={{
                  ...cellStyle,
                  color: COLORS.cyan,
                  textAlign: 'left',
                  fontSize: 12,
                }}>
                  {band}
                </td>
                <td style={{
                  ...cellStyle,
                  color: conditionColor(dayCondition),
                  background: conditionBg(dayCondition),
                }}>
                  {dayCondition}
                </td>
                <td style={{
                  ...cellStyle,
                  color: conditionColor(nightCondition),
                  background: conditionBg(nightCondition),
                }}>
                  {nightCondition}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Signal noise / SFI summary */}
      {data && (
        <div style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: `1px solid ${COLORS.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 9,
          color: COLORS.muted,
        }}>
          <span>SN: {data.signalNoise}</span>
        </div>
      )}
    </div>
  );
};

export default BandPanel;
