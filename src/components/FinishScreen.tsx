'use client';

import { useEffect, useState, useRef } from 'react';
import { formatTime } from '@/lib/supabase';
import type { LeaderboardEntry } from '@/types';

interface Props {
  time: number;
  bestTime: number | null;
  mapId: number;
  mapName: string;
  playerName: string;
  carId: number;
  onRestart: () => void;
  onMenu: () => void;
  onShowLeaderboard: () => void;
}

export default function FinishScreen({
  time, bestTime, mapId, mapName, playerName, carId,
  onRestart, onMenu, onShowLeaderboard,
}: Props) {
  const [rank, setRank] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);
  const isNewBest = bestTime !== null && time <= bestTime;
  const retryRef = useRef<HTMLButtonElement>(null);

  // Focus retry button immediately
  useEffect(() => {
    const t = setTimeout(() => retryRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // R key always restarts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onRestart();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onRestart]);

  // Auto-submit score
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/leaderboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map_id: mapId, player_name: playerName, time_ms: time, car_id: carId }),
        });
        const json = await res.json();
        if (json.data?.id) {
          const lbRes = await fetch(`/api/leaderboard?map_id=${mapId}`);
          const lbJson = await lbRes.json();
          const entries: LeaderboardEntry[] = lbJson.data ?? [];
          const r = entries.findIndex((e) => e.id === json.data.id);
          setRank(r >= 0 ? r + 1 : null);
        }
      } catch {
        setError(true);
      }
      setSubmitted(true);
    })();
  }, []);

  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 40,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,10,0.92) 100%)',
      backdropFilter: 'blur(4px)',
      animation: 'fadeIn 0.25s ease',
    }}>
      {/* ─── FINISHED! header ─── */}
      <div style={{
        fontSize: 13, letterSpacing: 6, color: 'rgba(255,255,255,0.4)',
        fontWeight: 700, marginBottom: 8,
        animation: 'slideDown 0.4s ease',
      }}>
        {mapName.toUpperCase()}
      </div>

      <div style={{
        fontSize: 44, fontWeight: 900, marginBottom: 4, letterSpacing: -1,
        animation: 'slideDown 0.4s ease 0.05s both',
        color: isNewBest ? '#ffd700' : '#ffffff',
        textShadow: isNewBest ? '0 0 30px rgba(255,215,0,0.6)' : 'none',
      }}>
        {isNewBest ? '⚡ NEW BEST!' : rank && rank <= 3 ? `${medals[rank]} TOP ${rank}!` : '🏁 FINISHED!'}
      </div>

      {/* ─── BIG TIME ─── */}
      <div style={{
        background: 'rgba(255,255,255,0.06)',
        border: isNewBest ? '2px solid rgba(255,215,0,0.5)' : '1px solid rgba(255,255,255,0.12)',
        borderRadius: 16,
        padding: '20px 48px',
        textAlign: 'center',
        margin: '16px 0 24px',
        animation: 'popIn 0.4s cubic-bezier(0.2, 1.5, 0.3, 1) 0.1s both',
      }}>
        <div style={{
          fontSize: 70,
          fontFamily: '"Courier New", monospace',
          fontWeight: 900,
          letterSpacing: 4,
          color: isNewBest ? '#ffd700' : '#ffffff',
          lineHeight: 1,
        }}>
          {formatTime(time)}
        </div>
        {submitted && rank !== null && !error && (
          <div style={{
            marginTop: 10,
            fontSize: 14, fontWeight: 700, letterSpacing: 1,
            color: rank <= 3 ? '#ffd700' : 'rgba(255,255,255,0.5)',
          }}>
            {rank <= 3 ? `${medals[rank]} RANK #${rank} ON THE BOARD` : `RANK #${rank} ON THE BOARD`}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#ff6666' }}>
            Couldn't save — check connection
          </div>
        )}
      </div>

      {/* ─── RETRY (primary — huge) ─── */}
      <button
        ref={retryRef}
        onClick={onRestart}
        style={{
          width: 320,
          padding: '18px 0',
          borderRadius: 14,
          border: '2px solid rgba(255,255,255,0.2)',
          background: 'linear-gradient(135deg, #ff6b35 0%, #f7931a 100%)',
          color: '#fff',
          fontSize: 22,
          fontWeight: 900,
          cursor: 'pointer',
          letterSpacing: 2,
          marginBottom: 12,
          animation: 'popIn 0.4s cubic-bezier(0.2, 1.5, 0.3, 1) 0.2s both',
          transition: 'transform 0.1s, filter 0.1s',
          outline: 'none',
          boxShadow: '0 8px 32px rgba(247,107,21,0.4)',
        }}
        onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.15)'; e.currentTarget.style.transform = 'scale(1.02)'; }}
        onMouseLeave={e => { e.currentTarget.style.filter = 'brightness(1)'; e.currentTarget.style.transform = 'scale(1)'; }}
        onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
        onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        ↺ RETRY
      </button>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: 2, marginBottom: 20 }}>
        PRESS R OR ENTER
      </div>

      {/* ─── Secondary actions ─── */}
      <div style={{
        display: 'flex', gap: 12,
        animation: 'popIn 0.4s cubic-bezier(0.2, 1.5, 0.3, 1) 0.3s both',
      }}>
        <button
          onClick={onShowLeaderboard}
          style={secondaryBtn('#4488ff')}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.2)')}
          onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
        >
          🏆 Leaderboard
        </button>
        <button
          onClick={onMenu}
          style={secondaryBtn('#666')}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.2)')}
          onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
        >
          🏠 Change Track
        </button>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes popIn {
          0%   { opacity: 0; transform: scale(0.85) translateY(12px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

function secondaryBtn(color: string): React.CSSProperties {
  return {
    padding: '12px 22px',
    borderRadius: 10,
    border: 'none',
    background: color,
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'filter 0.1s',
    letterSpacing: 0.5,
  };
}
