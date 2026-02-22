'use client';

import { useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@/types';
import { formatTime } from '@/lib/supabase';
import { MAP_CONFIGS } from '@/game/maps';
import { CAR_CONFIGS } from '@/game/cars';

interface Props {
  mapId: number;
  onClose?: () => void;
  highlightEntryId?: string;
}

export default function Leaderboard({ mapId, onClose, highlightEntryId }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/leaderboard?map_id=${mapId}`)
      .then(r => r.json())
      .then(d => {
        setEntries(d.data ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [mapId]);

  const map = MAP_CONFIGS[mapId];
  const gc = `#${(map?.groundColor ?? 0x4a7c3f).toString(16).padStart(6, '0')}`;

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(8px)',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div style={{
        background: 'linear-gradient(135deg, #0f0c29ee, #302b63ee)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 24,
        padding: '32px 40px',
        minWidth: 480,
        maxWidth: 560,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>🏆 Leaderboard</div>
            <div style={{ color: '#888', fontSize: 14, marginTop: 2 }}>
              {map?.name ?? 'Track'} • Top 20 times
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: '#fff',
                width: 36, height: 36,
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >×</button>
          )}
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 32 }}>Loading...</div>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 32 }}>
              No times yet. Be the first! 🏁
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#666', fontSize: 12, letterSpacing: 1 }}>
                  <th style={{ textAlign: 'left', padding: '0 12px 12px 0' }}>#</th>
                  <th style={{ textAlign: 'left', padding: '0 12px 12px 0' }}>PLAYER</th>
                  <th style={{ textAlign: 'left', padding: '0 12px 12px 0' }}>CAR</th>
                  <th style={{ textAlign: 'right', padding: '0 0 12px 0' }}>TIME</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const isHighlighted = e.id === highlightEntryId;
                  const car = CAR_CONFIGS[e.car_id];
                  const carColor = car ? `#${car.color.toString(16).padStart(6, '0')}` : '#fff';
                  return (
                    <tr
                      key={e.id}
                      style={{
                        background: isHighlighted
                          ? 'rgba(255, 200, 50, 0.15)'
                          : i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                        borderRadius: 8,
                        border: isHighlighted ? '1px solid rgba(255,200,50,0.4)' : 'none',
                      }}
                    >
                      <td style={{ padding: '10px 12px 10px 0', fontSize: 16 }}>
                        {i < 3 ? medals[i] : (
                          <span style={{ color: '#666', fontSize: 14, fontWeight: 700 }}>{i + 1}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px 10px 0', fontWeight: isHighlighted ? 800 : 600 }}>
                        {isHighlighted && <span style={{ color: '#ffd700', marginRight: 4 }}>▶</span>}
                        {e.player_name}
                      </td>
                      <td style={{ padding: '10px 12px 10px 0' }}>
                        <span style={{
                          display: 'inline-block',
                          width: 10, height: 10,
                          borderRadius: 2,
                          background: carColor,
                          marginRight: 4,
                        }} />
                        <span style={{ fontSize: 12, color: '#888' }}>{car?.name ?? '?'}</span>
                      </td>
                      <td style={{
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        fontSize: 16,
                        fontWeight: 800,
                        color: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#fff',
                        padding: '10px 0',
                      }}>
                        {formatTime(e.time_ms)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ color: '#555', fontSize: 12, textAlign: 'center', marginTop: 16 }}>
          Press Tab to close
        </div>
      </div>
    </div>
  );
}
