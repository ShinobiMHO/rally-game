'use client';

import { useState } from 'react';
import { MAP_CONFIGS } from '@/game/maps';

interface Props {
  onSelect: (mapId: number) => void;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  Easy: '#44cc44',
  Medium: '#ffcc00',
  Hard: '#ff8800',
  Expert: '#ff4444',
  Master: '#cc44ff',
};

// Mini track preview SVG
function TrackPreview({ mapId, groundColor, roadColor }: {
  mapId: number;
  groundColor: number;
  roadColor: number;
}) {
  const map = MAP_CONFIGS[mapId];
  if (!map) return null;

  const wp = map.waypoints;
  const xs = wp.map(([x]) => x);
  const ys = wp.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = 100 / Math.max(w, h);
  const ox = (120 - w * scale) / 2;
  const oy = (100 - h * scale) / 2;

  const points = wp.map(([x, y]) =>
    `${ox + (x - minX) * scale},${oy + (y - minY) * scale}`
  ).join(' ');

  const gc = `#${groundColor.toString(16).padStart(6, '0')}`;
  const rc = `#${roadColor.toString(16).padStart(6, '0')}`;

  return (
    <svg width="120" height="100" viewBox="0 0 120 100">
      <rect width="120" height="100" rx="8" fill={gc} />
      <polyline
        points={points}
        fill="none"
        stroke={rc}
        strokeWidth="8"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
      {/* Close the loop */}
      <line
        x1={parseFloat(points.split(' ').at(-1)!.split(',')[0])}
        y1={parseFloat(points.split(' ').at(-1)!.split(',')[1])}
        x2={parseFloat(points.split(' ')[0].split(',')[0])}
        y2={parseFloat(points.split(' ')[0].split(',')[1])}
        stroke={rc}
        strokeWidth="8"
        strokeLinecap="round"
      />
      {/* Start marker */}
      <circle
        cx={ox + (wp[0][0] - minX) * scale}
        cy={oy + (wp[0][1] - minY) * scale}
        r="5"
        fill="#ffffff"
      />
    </svg>
  );
}

export default function MapSelector({ onSelect }: Props) {
  const [selected, setSelected] = useState(0);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', width: '100vw',
      background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
      padding: 24,
    }}>
      <div style={{ fontSize: 36, fontWeight: 900, marginBottom: 8, letterSpacing: -1 }}>
        🗺️ Choose Your Track
      </div>
      <div style={{ color: '#888', marginBottom: 32, fontSize: 14 }}>
        Each track has a separate leaderboard
      </div>

      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center',
        marginBottom: 32, maxWidth: 1000,
      }}>
        {MAP_CONFIGS.map(map => {
          const gc = `#${map.groundColor.toString(16).padStart(6, '0')}`;
          return (
            <div
              key={map.id}
              onClick={() => setSelected(map.id)}
              style={{
                background: selected === map.id
                  ? 'rgba(255,255,255,0.12)'
                  : 'rgba(255,255,255,0.05)',
                border: selected === map.id
                  ? `2px solid ${DIFFICULTY_COLORS[map.difficulty]}`
                  : '2px solid rgba(255,255,255,0.1)',
                borderRadius: 20,
                padding: '20px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                minWidth: 160,
                textAlign: 'center',
                transform: selected === map.id ? 'scale(1.05)' : 'scale(1)',
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <TrackPreview
                  mapId={map.id}
                  groundColor={map.groundColor}
                  roadColor={map.roadColor}
                />
              </div>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{map.name}</div>
              <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>{map.description}</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
                <span style={{
                  background: DIFFICULTY_COLORS[map.difficulty],
                  color: '#000',
                  padding: '2px 10px',
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 800,
                }}>
                  {map.difficulty}
                </span>
                <span style={{ fontSize: 11, color: '#666' }}>{map.laps} laps</span>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => onSelect(selected)}
        style={{
          padding: '16px 48px',
          borderRadius: 12,
          border: 'none',
          background: `linear-gradient(135deg, ${DIFFICULTY_COLORS[MAP_CONFIGS[selected].difficulty]}, #ff6b35)`,
          color: '#000',
          fontSize: 18,
          fontWeight: 800,
          cursor: 'pointer',
          letterSpacing: 1,
          transition: 'transform 0.1s, filter 0.1s',
        }}
        onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.1)')}
        onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        RACE ON {MAP_CONFIGS[selected].name.toUpperCase()} →
      </button>
    </div>
  );
}
