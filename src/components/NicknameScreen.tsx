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
      background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
    }}>
      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{
          fontSize: 72, fontWeight: 900, letterSpacing: -2,
          background: 'linear-gradient(90deg, #ff6b35, #f7c59f, #efefd0)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          textShadow: 'none', lineHeight: 1,
        }}>
          🏁 RALLY
        </div>
        <div style={{
          fontSize: 32, fontWeight: 700, letterSpacing: 8,
          color: '#aaa', marginTop: 4,
        }}>
          RACER 3D
        </div>
      </div>

      {/* Input card */}
      <div style={{
        background: 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 24,
        padding: '40px 48px',
        backdropFilter: 'blur(10px)',
        textAlign: 'center',
        minWidth: 360,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Enter Your Nickname
        </div>
        <div style={{ color: '#888', marginBottom: 24, fontSize: 14 }}>
          Your name will appear on the leaderboard
        </div>

        <input
          autoFocus
          value={nick}
          onChange={e => setNick(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          maxLength={20}
          placeholder="e.g. SpeedKing, DriftMaster..."
          style={{
            width: '100%',
            padding: '14px 18px',
            borderRadius: 12,
            border: shake ? '2px solid #ff4444' : '2px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            fontSize: 18,
            fontWeight: 600,
            outline: 'none',
            textAlign: 'center',
            transition: 'border-color 0.2s',
            animation: shake ? 'shake 0.4s ease-in-out' : undefined,
          }}
        />

        <button
          onClick={handleSubmit}
          style={{
            marginTop: 20,
            width: '100%',
            padding: '16px',
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(135deg, #ff6b35, #f7931a)',
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
          START RACING →
        </button>
      </div>

      <div style={{ color: '#555', marginTop: 32, fontSize: 13 }}>
        Controls: ZQSD or Arrow Keys • R to restart • Tab for leaderboard
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
