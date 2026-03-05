'use client';

interface Props {
  onSelect: (carId: number) => void;
  nickname: string;
}

// WRC-style rally car SVG preview
function RallyCarPreview() {
  return (
    <svg width="280" height="160" viewBox="0 0 280 160" style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.7))' }}>
      {/* Main body — white */}
      <rect x="20" y="60" width="240" height="60" rx="8" fill="#f0f0f0" />
      {/* Hood slope */}
      <polygon points="200,60 260,60 260,80 200,70" fill="#f0f0f0" />
      {/* Rear slope */}
      <polygon points="20,60 80,60 80,70 20,80" fill="#f0f0f0" />
      {/* Cabin */}
      <rect x="80" y="28" width="120" height="38" rx="6" fill="#f0f0f0" />
      {/* Blue hood stripe */}
      <rect x="200" y="60" width="60" height="18" rx="0" fill="#003399" />
      {/* Blue roof stripe */}
      <rect x="100" y="28" width="80" height="10" rx="4" fill="#003399" />
      {/* Red front bumper */}
      <rect x="248" y="70" width="16" height="30" rx="4" fill="#cc1111" />
      {/* Red rear bumper */}
      <rect x="16" y="70" width="12" height="30" rx="4" fill="#cc1111" />
      {/* Windshield */}
      <rect x="95" y="32" width="52" height="28" rx="4" fill="rgba(140,200,255,0.75)" />
      {/* Rear window */}
      <rect x="155" y="32" width="40" height="28" rx="4" fill="rgba(140,200,255,0.75)" />
      {/* Rear wing posts */}
      <rect x="40" y="44" width="6" height="20" fill="#222" />
      <rect x="60" y="44" width="6" height="20" fill="#222" />
      {/* Rear wing blade */}
      <rect x="28" y="40" width="56" height="8" rx="3" fill="#003399" />
      {/* Front splitter */}
      <rect x="250" y="96" width="18" height="5" rx="2" fill="#222" />
      {/* Wheels */}
      <circle cx="220" cy="120" r="22" fill="#111" />
      <circle cx="220" cy="120" r="13" fill="#444" />
      <circle cx="220" cy="120" r="5" fill="#888" />
      <circle cx="60" cy="120" r="22" fill="#111" />
      <circle cx="60" cy="120" r="13" fill="#444" />
      <circle cx="60" cy="120" r="5" fill="#888" />
      {/* Fender flares */}
      <ellipse cx="220" cy="100" rx="26" ry="8" fill="#f0f0f0" opacity="0.5" />
      <ellipse cx="60" cy="100" rx="26" ry="8" fill="#f0f0f0" opacity="0.5" />
      {/* Fog lights */}
      <rect x="255" y="76" width="10" height="6" rx="2" fill="#ffee88" />
      <rect x="255" y="86" width="10" height="6" rx="2" fill="#ffee88" />
      {/* Tail lights */}
      <rect x="17" y="76" width="8" height="6" rx="2" fill="#ff2200" />
      <rect x="17" y="86" width="8" height="6" rx="2" fill="#ff2200" />
      {/* Race number plate */}
      <rect x="115" y="80" width="38" height="20" rx="3" fill="#fff" stroke="#003399" strokeWidth="2" />
      <text x="134" y="95" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#003399">1</text>
      {/* Roof vent */}
      <rect x="120" y="28" width="40" height="8" rx="3" fill="#003399" />
    </svg>
  );
}

export default function CarSelector({ onSelect, nickname }: Props) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', width: '100vw',
      background: 'linear-gradient(160deg, #0a1a05, #1a3510, #0f200a)',
      padding: 24,
      fontFamily: 'monospace',
    }}>
      {/* Top label */}
      <div style={{ fontSize: 12, color: '#5a8a40', letterSpacing: 4, marginBottom: 12, textTransform: 'uppercase' }}>
        Pilote : {nickname}
      </div>

      <div style={{ fontSize: 32, fontWeight: 900, marginBottom: 4, color: '#f0f0f0', letterSpacing: -1 }}>
        🏁 WRC Beast
      </div>
      <div style={{ fontSize: 13, color: '#7ab05a', marginBottom: 36, letterSpacing: 1 }}>
        FORÊT DE BRETAGNE — SPÉCIALE TERRE
      </div>

      {/* Car preview */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 24,
        padding: '32px 48px',
        marginBottom: 36,
      }}>
        <RallyCarPreview />
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 48, marginBottom: 40 }}>
        {[
          { label: 'VITESSE', value: 4, color: '#ff6b35' },
          { label: 'HANDLING', value: 4, color: '#44ccff' },
          { label: 'TRACTION', value: 4, color: '#44ff88' },
        ].map(stat => (
          <div key={stat.label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#555', letterSpacing: 2, marginBottom: 6 }}>{stat.label}</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{
                  width: 16, height: 7, borderRadius: 2,
                  background: i < stat.value ? stat.color : 'rgba(255,255,255,0.08)',
                }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => onSelect(0)}
        style={{
          padding: '18px 64px',
          borderRadius: 12,
          border: 'none',
          background: 'linear-gradient(135deg, #003399, #0055dd)',
          color: '#fff',
          fontSize: 20,
          fontWeight: 900,
          cursor: 'pointer',
          letterSpacing: 3,
          textTransform: 'uppercase',
          transition: 'transform 0.1s, filter 0.1s',
          boxShadow: '0 0 40px rgba(0,80,255,0.3)',
        }}
        onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.2)')}
        onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        LANCER LA COURSE →
      </button>
    </div>
  );
}
