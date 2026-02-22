'use client';

import { useEffect, useState } from 'react';
import { formatTime } from '@/lib/supabase';
import type { LeaderboardEntry } from '@/types';

interface Props {
  time: number;
  mapId: number;
  mapName: string;
  playerName: string;
  carId: number;
  onRestart: () => void;
  onMenu: () => void;
  onShowLeaderboard: () => void;
}

export default function FinishScreen({
  time,
  mapId,
  mapName,
  playerName,
  carId,
  onRestart,
  onMenu,
  onShowLeaderboard,
}: Props) {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rank, setRank] = useState<number | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Auto-submit score
    const submit = async () => {
      setSubmitting(true);
      try {
        const res = await fetch('/api/leaderboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map_id: mapId, player_name: playerName, time_ms: time, car_id: carId }),
        });
        const json = await res.json();
        if (json.data) {
          setEntryId(json.data.id);
          // Get rank
          const lbRes = await fetch(`/api/leaderboard?map_id=${mapId}`);
          const lbJson = await lbRes.json();
          const entries: LeaderboardEntry[] = lbJson.data ?? [];
          const r = entries.findIndex(e => e.id === json.data.id);
          setRank(r >= 0 ? r + 1 : null);
        }
        setSubmitted(true);
      } catch (e) {
        setError('Could not save your time. Check your connection.');
        setSubmitted(true);
      }
      setSubmitting(false);
    };
    submit();
  }, []);

  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 40,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(6px)',
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #0f0c29, #302b63)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 24,
        padding: '40px 48px',
        textAlign: 'center',
        minWidth: 380,
        animation: 'slideUp 0.4s cubic-bezier(0.2, 0.8, 0.3, 1)',
      }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>
          {rank && rank <= 3 ? medals[rank] : '🏁'}
        </div>
        <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 4 }}>
          {rank === 1 ? 'NEW RECORD!' : 'FINISH!'}
        </div>
        <div style={{ color: '#888', marginBottom: 24 }}>{mapName}</div>

        <div style={{
          background: 'rgba(255,255,255,0.07)',
          borderRadius: 16,
          padding: '24px 32px',
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 48, fontFamily: 'monospace', fontWeight: 900, letterSpacing: 2 }}>
            {formatTime(time)}
          </div>
          {submitting && (
            <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>Saving your time...</div>
          )}
          {submitted && !error && rank !== null && (
            <div style={{ color: '#ffd700', fontSize: 15, marginTop: 8, fontWeight: 700 }}>
              {rank <= 3 ? `${medals[rank]} Rank #${rank} on the leaderboard!` : `You ranked #${rank}`}
            </div>
          )}
          {error && (
            <div style={{ color: '#ff6666', fontSize: 12, marginTop: 8 }}>{error}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={onRestart}
            style={btnStyle('#ff6b35')}
            onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
            onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
          >
            🔄 Race Again
          </button>
          <button
            onClick={onShowLeaderboard}
            style={btnStyle('#44aaff')}
            onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
            onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
          >
            🏆 Leaderboard
          </button>
          <button
            onClick={onMenu}
            style={btnStyle('#888')}
            onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
            onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
          >
            🏠 Main Menu
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(40px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '12px 20px',
    borderRadius: 10,
    border: 'none',
    background: color,
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'filter 0.1s',
  };
}
