'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine } from '@/game/GameEngine';
import { MAP_CONFIGS } from '@/game/maps';
import { CAR_CONFIGS } from '@/game/cars';
import { formatTime } from '@/lib/supabase';
import Leaderboard from './Leaderboard';
import FinishScreen from './FinishScreen';

interface Props {
  nickname: string;
  carId: number;
  mapId: number;
  onMenu: () => void;
}

export default function GameCanvas({ nickname, carId, mapId, onMenu }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [currentLap, setCurrentLap] = useState(0);
  const [raceState, setRaceState] = useState<'idle' | 'racing' | 'finished'>('idle');
  const [finishTime, setFinishTime] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [lapFlash, setLapFlash] = useState(false);

  const map = MAP_CONFIGS[mapId];
  const car = CAR_CONFIGS[carId];

  const handleFinish = useCallback((ms: number) => {
    setFinishTime(ms);
    setRaceState('finished');
  }, []);

  const handleLapComplete = useCallback((lap: number) => {
    setCurrentLap(lap);
    setLapFlash(true);
    setTimeout(() => setLapFlash(false), 1000);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas to fill container
    const resize = () => {
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const engine = new GameEngine(canvas, MAP_CONFIGS[mapId], CAR_CONFIGS[carId], {
      onTimerUpdate: (ms) => setElapsedMs(ms),
      onFinish: (ms) => handleFinish(ms),
      onLapComplete: (lap) => handleLapComplete(lap),
      onStateChange: (s) => setRaceState(s),
    });
    engineRef.current = engine;

    // Keyboard shortcuts
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        engine.restart();
        setRaceState('idle');
        setElapsedMs(0);
        setCurrentLap(0);
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

  const handleRestart = () => {
    engineRef.current?.restart();
    setRaceState('idle');
    setElapsedMs(0);
    setCurrentLap(0);
    setFinishTime(0);
  };

  const handleCanvasClick = () => {
    engineRef.current?.resumeAudio();
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* HUD */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        pointerEvents: 'none',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        {/* Timer */}
        <div style={{
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          borderRadius: 12,
          padding: '10px 20px',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ fontSize: 11, color: '#888', letterSpacing: 2, marginBottom: 2 }}>TIME</div>
          <div style={{
            fontSize: 32,
            fontFamily: 'monospace',
            fontWeight: 900,
            letterSpacing: 2,
            color: raceState === 'racing' ? '#fff' : '#888',
          }}>
            {formatTime(elapsedMs)}
          </div>
        </div>

        {/* Lap counter */}
        <div style={{
          background: lapFlash ? 'rgba(255, 200, 50, 0.9)' : 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          borderRadius: 12,
          padding: '10px 20px',
          border: lapFlash ? '1px solid rgba(255,200,50,0.6)' : '1px solid rgba(255,255,255,0.1)',
          textAlign: 'center',
          transition: 'background 0.2s, border 0.2s',
        }}>
          <div style={{ fontSize: 11, color: lapFlash ? '#000' : '#888', letterSpacing: 2, marginBottom: 2 }}>LAP</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: lapFlash ? '#000' : '#fff' }}>
            {Math.min(currentLap + 1, map.laps)} / {map.laps}
          </div>
        </div>
      </div>

      {/* Map name + car info */}
      <div style={{
        position: 'absolute', bottom: 16, left: 20,
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          borderRadius: 10,
          padding: '8px 14px',
          border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', gap: 12, alignItems: 'center',
        }}>
          <span style={{
            width: 12, height: 12, borderRadius: 3,
            background: `#${car.color.toString(16).padStart(6, '0')}`,
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 13, color: '#aaa', fontWeight: 600 }}>{car.name}</span>
          <span style={{ color: '#555', fontSize: 13 }}>•</span>
          <span style={{ fontSize: 13, color: '#aaa', fontWeight: 600 }}>{map.name}</span>
        </div>
      </div>

      {/* Controls hint */}
      <div style={{
        position: 'absolute', bottom: 16, right: 20,
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(8px)',
          borderRadius: 10,
          padding: '8px 14px',
          border: '1px solid rgba(255,255,255,0.08)',
          fontSize: 12, color: '#666',
        }}>
          ZQSD / ↑↓←→ Move &nbsp;•&nbsp; R Restart &nbsp;•&nbsp; Tab Leaderboard
        </div>
      </div>

      {/* Idle prompt */}
      {raceState === 'idle' && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          textAlign: 'center',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            borderRadius: 16,
            padding: '20px 36px',
            border: '1px solid rgba(255,255,255,0.15)',
          }}>
            <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>🏁 Ready!</div>
            <div style={{ color: '#888', fontSize: 15 }}>Press Z or ↑ to start racing</div>
          </div>
        </div>
      )}

      {/* Finish screen */}
      {raceState === 'finished' && !showLeaderboard && (
        <FinishScreen
          time={finishTime}
          mapId={mapId}
          mapName={map.name}
          playerName={nickname}
          carId={carId}
          onRestart={handleRestart}
          onMenu={onMenu}
          onShowLeaderboard={() => setShowLeaderboard(true)}
        />
      )}

      {/* Leaderboard overlay */}
      {showLeaderboard && (
        <Leaderboard
          mapId={mapId}
          onClose={() => setShowLeaderboard(false)}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
