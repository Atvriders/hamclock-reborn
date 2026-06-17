import React, { useEffect, useMemo, useState } from 'react';
import { solarElevation } from '../../utils/solar';

interface GreylineDxTileProps {
  userLat: number;
  userLng: number;
}

// Reference DXCC entities with reasonable capital/center coordinates.
// Kept short — about 36 entries spread across all continents so the
// greyline panel is meaningful regardless of where the operator is.
interface DxcEntity {
  name: string;
  lat: number;
  lng: number;
}

const DXCC_ENTITIES: DxcEntity[] = [
  { name: 'USA',            lat: 39.8,  lng: -98.6  },
  { name: 'Canada',         lat: 56.1,  lng: -106.3 },
  { name: 'Mexico',         lat: 23.6,  lng: -102.5 },
  { name: 'Brazil',         lat: -14.2, lng: -51.9  },
  { name: 'Argentina',      lat: -38.4, lng: -63.6  },
  { name: 'Chile',          lat: -35.7, lng: -71.5  },
  { name: 'Colombia',       lat:  4.6,  lng: -74.1  },
  { name: 'Venezuela',      lat:  6.4,  lng: -66.6  },
  { name: 'Cuba',           lat: 21.5,  lng: -80.0  },
  { name: 'UK',             lat: 52.0,  lng: -1.2   },
  { name: 'Ireland',        lat: 53.4,  lng: -8.2   },
  { name: 'France',         lat: 46.2,  lng:  2.2   },
  { name: 'Germany',        lat: 51.2,  lng: 10.4   },
  { name: 'Italy',          lat: 41.9,  lng: 12.5   },
  { name: 'Spain',          lat: 40.4,  lng: -3.7   },
  { name: 'Portugal',       lat: 39.4,  lng: -8.2   },
  { name: 'Netherlands',    lat: 52.1,  lng:  5.3   },
  { name: 'Norway',         lat: 60.5,  lng:  8.5   },
  { name: 'Sweden',         lat: 60.1,  lng: 18.6   },
  { name: 'Finland',        lat: 61.9,  lng: 25.7   },
  { name: 'Iceland',        lat: 64.9,  lng: -19.0  },
  { name: 'Poland',         lat: 51.9,  lng: 19.1   },
  { name: 'Ukraine',        lat: 48.4,  lng: 31.2   },
  { name: 'Russia',         lat: 55.8,  lng: 37.6   },
  { name: 'Turkey',         lat: 38.9,  lng: 35.2   },
  { name: 'Israel',         lat: 31.0,  lng: 34.9   },
  { name: 'UAE',            lat: 23.4,  lng: 53.8   },
  { name: 'India',          lat: 20.6,  lng: 79.0   },
  { name: 'China',          lat: 35.9,  lng: 104.2  },
  { name: 'Japan',          lat: 36.2,  lng: 138.3  },
  { name: 'South Korea',    lat: 37.6,  lng: 127.0  },
  { name: 'Taiwan',         lat: 25.0,  lng: 121.5  },
  { name: 'Thailand',       lat: 15.9,  lng: 100.5  },
  { name: 'Indonesia',      lat: -0.8,  lng: 113.9  },
  { name: 'Australia',      lat: -25.3, lng: 134.8  },
  { name: 'New Zealand',    lat: -41.3, lng: 174.8  },
  { name: 'South Africa',   lat: -30.6, lng: 22.9   },
  { name: 'Kenya',          lat: -1.3,  lng: 36.8   },
  { name: 'Egypt',          lat: 26.8,  lng: 30.8   },
  { name: 'Hawaii',         lat: 20.8,  lng: -156.3 },
];

const GREYLINE_HALF_WIDTH_DEG = 6;  // ±6° window around horizon

// Great-circle bearing from user→target (degrees, 0=N, 90=E)
function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360;
}

// Find the next UTC time (minutes from now) at which the user's sun
// elevation crosses 0° upward (dawn). Scans next 24h in 5-min steps.
function nextDawnMinutes(lat: number, lng: number, now: Date): number | null {
  const STEP_MIN = 5;
  let prev = solarElevation(lat, lng, now);
  for (let m = STEP_MIN; m <= 24 * 60; m += STEP_MIN) {
    const t = new Date(now.getTime() + m * 60_000);
    const elev = solarElevation(lat, lng, t);
    if (prev < 0 && elev >= 0) return m;
    prev = elev;
  }
  return null;
}

function formatUtcInMinutes(minutesFromNow: number, now: Date): string {
  const t = new Date(now.getTime() + minutesFromNow * 60_000);
  return `${String(t.getUTCHours()).padStart(2, '0')}${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

const GreylineDxTile: React.FC<GreylineDxTileProps> = ({ userLat, userLng }) => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const inGreyline = useMemo(() => {
    return DXCC_ENTITIES.map((e) => {
      const elev = solarElevation(e.lat, e.lng, now);
      return {
        name: e.name,
        elev,
        bearing: Math.round(bearing(userLat, userLng, e.lat, e.lng)),
        absElev: Math.abs(elev),
      };
    })
      .filter((e) => Math.abs(e.elev) <= GREYLINE_HALF_WIDTH_DEG)
      .sort((a, b) => a.absElev - b.absElev)
      .slice(0, 8);
  }, [userLat, userLng, now]);

  const nextDawn = useMemo(() => {
    if (inGreyline.length > 0) return null;
    return nextDawnMinutes(userLat, userLng, now);
  }, [userLat, userLng, now, inGreyline.length]);

  return (
    <div className="ob-panel ob-inst-tile">
      <div className="ob-panel__body">
        <div className="ob-panel__head">
          <span className="ob-section-label">Greyline Window</span>
          <span className="ob-panel__head-meta">{inGreyline.length}</span>
        </div>

        {inGreyline.length === 0 ? (
          <div className="ob-tile-empty">
            no entities in greyline now
            {nextDawn != null && (
              <>
                <br />
                next dawn {formatUtcInMinutes(nextDawn, now)}Z
              </>
            )}
          </div>
        ) : (
          <div className="ob-greyline-list">
            {inGreyline.map((e) => (
              <div key={e.name} className="ob-greyline-row">
                <span className="ob-greyline-row__bearing">
                  {String(e.bearing).padStart(3, '0')}
                </span>
                <span className="ob-greyline-row__country">{e.name}</span>
                <span className="ob-greyline-row__elev">
                  {e.elev >= 0 ? '+' : ''}
                  {e.elev.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GreylineDxTile;
