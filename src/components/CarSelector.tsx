'use client';

import { useState } from 'react';
import { CAR_CONFIGS } from '@/game/cars';

interface Props {
  onSelect: (carId: number) => void;
  nickname: string;
}

function StatBar({ value, max = 5, color }: { value: number; max?: number; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} style={{
          width: 18, height: 8,
          borderRadius: 3,
          background: i < value ? color : 'rgba(255,255,255,0.1)',
          transition: 'background 0.2s',
        }} />
      ))}
    </div>
  );
}

// Simple SVG car silhouette for preview
function CarPreview({ color }: { color: string }) {
  return (
    <svg width="120" height="70" viewBox="0 0 120 70" style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))' }}>
      {/* Body */}
      <rect x="10" y="30" width="100" height="24" rx="6" fill={color} />
      {/* Cabin */}
      <rect x="30" y="16" width="60" height="22" rx="5" fill={color} />
      {/* Windows */}
      <rect x="35" y="20" width="24" height="14" rx="3" fill="rgba(180,220,255,0.7)" />
      <rect x="63" y="20" width="22" height="14" rx="3" fill="rgba(180,220,255,0.7)" />
      {/* Wheels */}
      <circle cx="28" cy="54" r="10" fill="#222" />
      <circle cx="28" cy="54" r="5" fill="#555" />
      <circle cx="92" cy="54" r="10" fill="#222" />
      <circle cx="92" cy="54" r="5" fill="#555" />
      {/* Headlights */}
      <rect x="106" y="36" width="6" height="6" rx="2" fill="#fffaaa" />
      {/* Taillights */}
      <rect x="8" y="36" width="6" height="6" rx="2" fill="#ff2200" />
    </svg>
  );
}

export default function CarSelector({ onSelect, nickname }: Props) {
  const [selected, setSelected] = useState(0);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', width: '100vw',
      background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
      padding: 24,
    }}>
      <div style={{ fontSize: 14, color: '#888', marginBottom: 8, letterSpacing: 2 }}>
        WELCOME, {nickname.toUpperCase()}
      </div>
      <div style={{ fontSize: 36, fontWeight: 900, marginBottom: 32, letterSpacing: -1 }}>
        🚗 Choose Your Car
      </div>

      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center',
        marginBottom: 32, maxWidth: 900,
      }}>
        {CAR_CONFIGS.map(car => (
          <div
            key={car.id}
            onClick={() => setSelected(car.id)}
            style={{
              background: selected === car.id
                ? `rgba(${hexToRgb(car.color)}, 0.2)`
                : 'rgba(255,255,255,0.05)',
              border: selected === car.id
                ? `2px solid #${car.color.toString(16).padStart(6, '0')}`
                : '2px solid rgba(255,255,255,0.1)',
              borderRadius: 20,
              padding: '20px 24px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              minWidth: 160,
              textAlign: 'center',
              transform: selected === car.id ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <CarPreview color={`#${car.color.toString(16).padStart(6, '0')}`} />
            </div>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{car.name}</div>
            <div style={{ color: '#999', fontSize: 12, marginBottom: 12 }}>{car.description}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 10, color: '#777', letterSpacing: 1, marginBottom: 2 }}>SPEED</div>
                <StatBar value={car.speed} color="#ff6b35" />
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#777', letterSpacing: 1, marginBottom: 2 }}>HANDLING</div>
                <StatBar value={car.handling} color="#44ccff" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => onSelect(selected)}
        style={{
          padding: '16px 48px',
          borderRadius: 12,
          border: 'none',
          background: `linear-gradient(135deg, #${CAR_CONFIGS[selected].color.toString(16).padStart(6, '0')}, #ff6b35)`,
          color: '#fff',
          fontSize: 18,
          fontWeight: 800,
          cursor: 'pointer',
          letterSpacing: 1,
          transition: 'transform 0.1s, filter 0.1s',
        }}
        onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
        onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        SELECT {CAR_CONFIGS[selected].name.toUpperCase()} →
      </button>
    </div>
  );
}

function hexToRgb(hex: number): string {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `${r}, ${g}, ${b}`;
}
