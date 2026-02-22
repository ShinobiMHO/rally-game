'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine } from '@/game/GameEngine';
import { MAP_CONFIGS } from '@/game/maps';
import { CAR_CONFIGS } from '@/game/cars';
import { formatTime } from '@/lib/supabase';
import type { CheckpointSplit, RaceState } from '@/types';
import Leaderboard from './Leaderboard';
import FinishScreen from './FinishScreen';

interface Props {
  nickname: string;
  carId: number;
  mapId: number;
  onMenu: () => void;
}

interface SplitNotif {
  id: number;
  split: CheckpointSplit;
}

let splitIdCounter = 0;

export default function GameCanvas({ nickname, carId, mapId, onMenu }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [currentLap, setCurrentLap] = useState(0);
  const [lapFlash, setLapFlash] = useState(false);
  const [raceState, setRaceState] = useState<RaceState>('countdown');
  const [countdownStep, setCountdownStep] = useState(3); // 3,2,1,0=GO
  const [finishTime, setFinishTime] = useState(0);
  const [bestTime, setBestTime] = useState<number | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [splitNotifs, setSplitNotifs] = useState<SplitNotif[]>([]);
  const [lapTimeFlash, setLapTimeFlash] = useState<number | null>(null);

  const map = MAP_CONFIGS[mapId];
  const car = CAR_CONFIGS[carId];

  const triggerRestart = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.restart();
    setRaceState('countdown');
    setElapsedMs(0);
    setCurrentLap(0);
    setFinishTime(0);
    setLapFlash(false);
    setSplitNotifs([]);
    setLapTimeFlash(null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
    };
    resize();
    window.addEventListener('resize', resize);

    const engine = new GameEngine(canvas, MAP_CONFIGS[mapId], CAR_CONFIGS[carId], {
      onTimerUpdate: (ms) => setElapsedMs(ms),
      onCountdown: (step) => setCountdownStep(step),
      onStateChange: (s) => setRaceState(s),
      onCheckpoint: (split) => {
        const notif: SplitNotif = { id: splitIdCounter++, split };
        setSplitNotifs(prev => [...prev.slice(-2), notif]);
        setTimeout(() => {
          setSplitNotifs(prev => prev.filter(n => n.id !== notif.id));
        }, 2500);
      },
      onLapComplete: (lap, lapTimeMs) => {
        setCurrentLap(lap);
        setLapFlash(true);
        setLapTimeFlash(lapTimeMs);
        setTimeout(() => setLapFlash(false), 1400);
        setTimeout(() => setLapTimeFlash(null), 2500);
      },
      onFinish: (ms) => {
        setFinishTime(ms);
        setBestTime(prev => (prev === null || ms < prev) ? ms : prev);
        setRaceState('finished');
      },
    });
    engineRef.current = engine;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        engine.restart();
        setRaceState('countdown');
        setElapsedMs(0);
        setCurrentLap(0);
        setFinishTime(0);
        setLapFlash(false);
        setSplitNotifs([]);
        setLapTimeFlash(null);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowLeaderboard(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      engine.destroy();
      engineRef.current = null;
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKey);
    };
  }, [mapId, carId]);

  const handleRestart = () => triggerRestart();
  const handleCanvasClick = () => engineRef.current?.resumeAudio();

  const isRacing = raceState === 'racing';
  const isCountdown = raceState === 'countdown';

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* ═══════════════ COUNTDOWN OVERLAY ═══════════════ */}
      {isCountdown && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div key={countdownStep} style={{
            fontSize: countdownStep === 0 ? 100 : 130,
            fontWeight: 900,
            letterSpacing: -4,
            color: countdownStep === 0 ? '#00ff88' : countdownStep === 1 ? '#ffcc00' : '#ffffff',
            textShadow: countdownStep === 0
              ? '0 0 40px #00ff88, 0 4px 24px rgba(0,0,0,0.8)'
              : '0 4px 24px rgba(0,0,0,0.9)',
            animation: 'countdownPop 0.35s cubic-bezier(0.2, 1.5, 0.4, 1)',
            lineHeight: 1,
          }}>
            {countdownStep === 0 ? 'GO!' : countdownStep}
          </div>
          <div style={{
            marginTop: 16,
            fontSize: 16,
            color: 'rgba(255,255,255,0.5)',
            letterSpacing: 3,
            fontWeight: 600,
          }}>
            {countdownStep > 0 ? 'GET READY' : 'FLOOR IT!'}
          </div>
        </div>
      )}

      {/* ═══════════════ MAIN TIMER (top-center, Trackmania style) ═══════════════ */}
      <div style={{
        position: 'absolute', top: 16, left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        textAlign: 'center',
      }}>
        <div style={{
          background: isRacing
            ? 'linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.55) 100%)'
            : 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(6px)',
          borderRadius: 12,
          padding: '8px 28px 10px',
          border: `1px solid ${isRacing ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
          transition: 'border 0.3s',
          minWidth: 260,
        }}>
          <div style={{
            fontSize: 54,
            fontFamily: '"Courier New", monospace',
            fontWeight: 900,
            letterSpacing: 3,
            color: isRacing ? '#ffffff' : 'rgba(255,255,255,0.4)',
            lineHeight: 1,
            textShadow: isRacing ? '0 2px 12px rgba(0,0,0,0.5)' : 'none',
            transition: 'color 0.3s',
          }}>
            {formatTime(elapsedMs)}
          </div>
          {bestTime !== null && (
            <div style={{ fontSize: 12, color: '#ffd700', letterSpacing: 2, marginTop: 4, opacity: 0.85 }}>
              BEST {formatTime(bestTime)}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════ LAP COUNTER (top right) ═══════════════ */}
      <div style={{
        position: 'absolute', top: 16, right: 20,
        pointerEvents: 'none',
      }}>
        <div style={{
          background: lapFlash ? 'rgba(255,200,50,0.95)' : 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(6px)',
          borderRadius: 10,
          padding: '10px 18px',
          border: lapFlash ? '2px solid rgba(255,220,0,0.8)' : '1px solid rgba(255,255,255,0.12)',
          textAlign: 'center',
          transition: 'background 0.15s, border 0.15s',
          minWidth: 80,
        }}>
          <div style={{ fontSize: 10, color: lapFlash ? '#000' : '#888', letterSpacing: 2, marginBottom: 2, fontWeight: 700 }}>LAP</div>
          <div style={{
            fontSize: 30,
            fontWeight: 900,
            color: lapFlash ? '#000' : '#fff',
            lineHeight: 1,
          }}>
            {Math.min(currentLap + 1, map.laps)}<span style={{ fontSize: 16, opacity: 0.6 }}>/{map.laps}</span>
          </div>
        </div>

        {/* Lap time flash */}
        {lapTimeFlash !== null && (
          <div style={{
            marginTop: 8,
            background: 'rgba(0,0,0,0.7)',
            borderRadius: 8,
            padding: '6px 12px',
            textAlign: 'center',
            animation: 'fadeInUp 0.3s ease',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{ fontSize: 10, color: '#888', letterSpacing: 2 }}>LAP TIME</div>
            <div style={{ fontSize: 18, fontFamily: 'monospace', fontWeight: 800, color: '#aaffcc' }}>
              {formatTime(lapTimeFlash)}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════ CHECKPOINT SPLITS (center-right) ═══════════════ */}
      <div style={{
        position: 'absolute', top: '50%', right: 20,
        transform: 'translateY(-50%)',
        pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', gap: 8,
        alignItems: 'flex-end',
      }}>
        {splitNotifs.map(({ id, split }) => {
          const delta = split.deltaMs;
          const isGreen = delta !== null && delta < 0;
          const isRed = delta !== null && delta > 0;
          return (
            <div key={id} style={{
              background: isGreen ? 'rgba(0,200,100,0.9)' : isRed ? 'rgba(220,60,60,0.9)' : 'rgba(255,200,0,0.9)',
              borderRadius: 8,
              padding: '8px 16px',
              animation: 'splitIn 0.25s cubic-bezier(0.2, 1.4, 0.4, 1)',
              boxShadow: `0 4px 20px ${isGreen ? 'rgba(0,200,100,0.4)' : isRed ? 'rgba(220,60,60,0.4)' : 'rgba(255,200,0,0.4)'}`,
            }}>
              <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.6)', letterSpacing: 2, fontWeight: 700 }}>
                SPLIT {split.index + 1}
              </div>
              <div style={{
                fontSize: 22, fontFamily: 'monospace', fontWeight: 900, color: '#000', lineHeight: 1,
              }}>
                {delta !== null
                  ? `${delta > 0 ? '+' : ''}${formatTime(Math.abs(delta))}`
                  : formatTime(split.elapsedMs)
                }
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══════════════ MAP/CAR INFO (bottom left) ═══════════════ */}
      <div style={{
        position: 'absolute', bottom: 16, left: 16,
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(6px)',
          borderRadius: 10,
          padding: '8px 14px',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <span style={{
            width: 10, height: 10, borderRadius: 2,
            background: `#${car.color.toString(16).padStart(6, '0')}`,
            display: 'inline-block',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 12, color: '#aaa', fontWeight: 600 }}>{car.name}</span>
          <span style={{ color: '#444' }}>•</span>
          <span style={{ fontSize: 12, color: '#aaa', fontWeight: 600 }}>{map.name}</span>
        </div>
      </div>

      {/* ═══════════════ CONTROLS HINT (bottom right) ═══════════════ */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16,
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.45)',
          borderRadius: 8,
          padding: '6px 12px',
          border: '1px solid rgba(255,255,255,0.06)',
          fontSize: 11, color: '#555', letterSpacing: 0.5,
        }}>
          ZQSD / ↑↓←→ &nbsp;•&nbsp; <span style={{ color: '#888' }}>R</span> Restart &nbsp;•&nbsp; <span style={{ color: '#888' }}>Tab</span> LB
        </div>
      </div>

      {/* ═══════════════ FINISH SCREEN ═══════════════ */}
      {raceState === 'finished' && !showLeaderboard && (
        <FinishScreen
          time={finishTime}
          bestTime={bestTime}
          mapId={mapId}
          mapName={map.name}
          playerName={nickname}
          carId={carId}
          onRestart={handleRestart}
          onMenu={onMenu}
          onShowLeaderboard={() => setShowLeaderboard(true)}
        />
      )}

      {/* ═══════════════ LEADERBOARD ═══════════════ */}
      {showLeaderboard && (
        <Leaderboard
          mapId={mapId}
          onClose={() => setShowLeaderboard(false)}
        />
      )}

      <style>{`
        @keyframes countdownPop {
          0%   { opacity: 0; transform: scale(1.4); }
          60%  { opacity: 1; transform: scale(0.95); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes splitIn {
          0%   { opacity: 0; transform: translateX(20px) scale(0.9); }
          100% { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
