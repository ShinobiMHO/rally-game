'use client';

import { useState } from 'react';

interface Props {
  onSubmit: (nickname: string) => void;
}

export default function NicknameScreen({ onSubmit }: Props) {
  const [nick, setNick] = useState('');
  const [shake, setShake] = useState(false);

  const handleSubmit = () => {
    const trimmed = nick.trim();
    if (trimmed.length < 1 || trimmed.length > 20) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', width: '100vw',
      background: 'linear-gradient(160deg, #0a1a30, #0f2a4a, #0a1a30)',
      padding: '20px',
      boxSizing: 'border-box',
    }}>
      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div style={{
          fontSize: 'clamp(48px, 12vw, 80px)',
          fontWeight: 900,
          letterSpacing: -2,
          background: 'linear-gradient(90deg, #0088ff, #44ccff, #ffffff)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          lineHeight: 1,
        }}>
          🏁 RALLY
        </div>
        <div style={{
          fontSize: 'clamp(16px, 4vw, 28px)',
          fontWeight: 700,
          letterSpacing: 6,
          color: '#aa7744',
          marginTop: 4,
        }}>
          FORÊT DES CORBIÈRES
        </div>
        <div style={{
          fontSize: 13, color: '#4488aa', marginTop: 6, letterSpacing: 2,
        }}>
          ▸ CRÉPUSCULE — SPÉCIALE TERRE ◂
        </div>
      </div>

      {/* Input card */}
      <div style={{
        background: 'rgba(30,120,255,0.08)',
        border: '1px solid rgba(30,120,255,0.25)',
        borderRadius: 24,
        padding: 'clamp(24px, 5vw, 40px) clamp(20px, 6vw, 48px)',
        backdropFilter: 'blur(10px)',
        textAlign: 'center',
        width: '100%',
        maxWidth: 400,
        boxSizing: 'border-box',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: '#ffcc88' }}>
          Ton pseudo pilote
        </div>
        <div style={{ color: '#886644', marginBottom: 20, fontSize: 13 }}>
          Affiché dans le classement
        </div>

        <input
          autoFocus
          value={nick}
          onChange={e => setNick(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          maxLength={20}
          placeholder="ex: SpeedKing, DriftBoss..."
          style={{
            width: '100%',
            padding: '14px 18px',
            borderRadius: 12,
            border: shake ? '2px solid #ff4444' : '2px solid rgba(255,150,50,0.35)',
            background: 'rgba(255,100,20,0.1)',
            color: '#ffe0b0',
            fontSize: 18,
            fontWeight: 600,
            outline: 'none',
            textAlign: 'center',
            boxSizing: 'border-box',
            transition: 'border-color 0.2s',
            animation: shake ? 'shake 0.4s ease-in-out' : undefined,
          }}
        />

        <button
          onClick={handleSubmit}
          style={{
            marginTop: 18,
            width: '100%',
            padding: '16px',
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(135deg, #cc4400, #ff8800)',
            color: '#fff',
            fontSize: 18,
            fontWeight: 900,
            cursor: 'pointer',
            letterSpacing: 2,
            textTransform: 'uppercase',
            transition: 'transform 0.1s, filter 0.1s',
            boxShadow: '0 4px 20px rgba(255,100,0,0.4)',
          }}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
          onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
          onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
          onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          AU DÉPART →
        </button>
      </div>

      {/* Features hint */}
      <div style={{
        marginTop: 28,
        display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center',
        maxWidth: 380,
      }}>
        {['🌲 Forêt dense', '🌉 Pont suspendu', '🚀 Saut', '🕳️ Tunnel', '📱 Tactile'].map(f => (
          <div key={f} style={{
            fontSize: 12, color: '#664422',
            background: 'rgba(255,100,0,0.07)',
            border: '1px solid rgba(255,100,0,0.15)',
            borderRadius: 20, padding: '4px 10px',
          }}>{f}</div>
        ))}
      </div>

      <div style={{ color: '#442200', marginTop: 20, fontSize: 12, textAlign: 'center' }}>
        ZQSD / Flèches • Espace = Dérive • R = Restart
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
