'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine } from '@/game/GameEngine';
import { MAP_CONFIGS } from '@/game/maps';
import { CAR_CONFIGS } from '@/game/cars';
import { formatTime } from '@/lib/supabase';
import type { CheckpointSplit, RaceState } from '@/types';
import Leaderboard from './Leaderboard';
import FinishScreen from './FinishScreen';

// ── Touch button ──
function TouchBtn({
  label, color, onPress, onRelease, style,
}: {
  label: string; color: string;
  onPress: () => void; onRelease: () => void;
  style?: React.CSSProperties;
}) {
  const [active, setActive] = useState(false);
  return (
    <div
      onTouchStart={e => { e.preventDefault(); setActive(true); onPress(); }}
      onTouchEnd={e => { e.preventDefault(); setActive(false); onRelease(); }}
      onTouchCancel={e => { e.preventDefault(); setActive(false); onRelease(); }}
      onMouseDown={() => { setActive(true); onPress(); }}
      onMouseUp={() => { setActive(false); onRelease(); }}
      onMouseLeave={() => { setActive(false); onRelease(); }}
      style={{
        width: 80, height: 80, borderRadius: 18,
        background: active ? color : color.replace(/[\d.]+\)$/, '0.25)'),
        border: `2px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 30, fontWeight: 900, color: '#fff',
        userSelect: 'none', touchAction: 'none', cursor: 'pointer',
        transition: 'background 0.07s, transform 0.07s',
        transform: active ? 'scale(0.93)' : 'scale(1)',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      {label}
    </div>
  );
}

// ── Mini-map ──
function MiniMap({ waypoints, progress }: { waypoints: [number, number, number][], progress: number }) {
  const SIZE = 130;
  const PAD = 12;
  const xs = waypoints.map(w => w[0]);
  const zs = waypoints.map(w => w[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const rangeX = maxX - minX || 1, rangeZ = maxZ - minZ || 1;
  const scale = (SIZE - PAD * 2) / Math.max(rangeX, rangeZ);
  const ox = PAD + (SIZE - PAD * 2 - rangeX * scale) / 2;
  const oz = PAD + (SIZE - PAD * 2 - rangeZ * scale) / 2;

  const toSvg = (x: number, z: number) => ({
    x: ox + (x - minX) * scale,
    y: oz + (z - minZ) * scale,
  });

  const pts = waypoints.map(([x, z]) => {
    const p = toSvg(x, z);
    return `${p.x},${p.y}`;
  }).join(' ');

  // Car position: interpolate along waypoints by progress
  const n = waypoints.length - 1;
  const fi = progress * n;
  const i = Math.min(Math.floor(fi), n - 1);
  const frac = fi - i;
  const [ax, az] = waypoints[i];
  const [bx, bz] = waypoints[Math.min(i + 1, n)];
  const carX = ax + (bx - ax) * frac;
  const carZ = az + (bz - az) * frac;
  const carPt = toSvg(carX, carZ);

  return (
    <div style={{
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
      borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
    }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Track */}
        <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        {/* Completed part */}
        <polyline points={
          waypoints.slice(0, i + 2).map(([x, z]) => {
            const p = toSvg(x, z); return `${p.x},${p.y}`;
          }).join(' ')
        } fill="none" stroke="#ff8833" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        {/* Start */}
        <circle cx={toSvg(waypoints[0][0], waypoints[0][1]).x} cy={toSvg(waypoints[0][0], waypoints[0][1]).y} r="4" fill="#00ff88" />
        {/* Finish */}
        <circle cx={toSvg(waypoints[n][0], waypoints[n][1]).x} cy={toSvg(waypoints[n][0], waypoints[n][1]).y} r="4" fill="#ff2222" />
        {/* Car */}
        <circle cx={carPt.x} cy={carPt.y} r="5" fill="#ffffff" stroke="#ff8833" strokeWidth="2" />
      </svg>
    </div>
  );
}

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
  const [speedKmh, setSpeedKmh] = useState(0);
  const [stageProgress, setStageProgress] = useState(0); // 0-1 along the stage
  const [raceState, setRaceState] = useState<RaceState>('countdown');
  const [countdownStep, setCountdownStep] = useState(3); // 3,2,1,0=GO
  const [finishTime, setFinishTime] = useState(0);
  const [bestTime, setBestTime] = useState<number | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [splitNotifs, setSplitNotifs] = useState<SplitNotif[]>([]);

  const map = MAP_CONFIGS[mapId];
  const car = CAR_CONFIGS[carId];

  const triggerRestart = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.restart();
    setRaceState('countdown');
    setElapsedMs(0);
    setStageProgress(0);
    setFinishTime(0);
    setSplitNotifs([]);
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
      onSpeedUpdate: (kmh) => setSpeedKmh(Math.round(kmh)),
      onProgressUpdate: (t: number) => setStageProgress(t),
      onFinish: (ms) => {
        setFinishTime(ms);
        setBestTime(prev => (prev === null || ms < prev) ? ms : prev);
        setRaceState('finished');
      },
    });
    engineRef.current = engine;

    // Resume audio on first touch (mobile AudioContext restriction)
    const resumeOnTouch = () => { engine.resumeAudio(); };
    document.addEventListener('touchstart', resumeOnTouch, { once: true });
    document.addEventListener('mousedown', resumeOnTouch, { once: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        engine.restart();
        setRaceState('countdown');
        setElapsedMs(0);
        setStageProgress(0);
        setFinishTime(0);
        setSplitNotifs([]);
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
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, transparent 70%)',
        }}>
          {/* Stage name banner */}
          <div style={{
            marginBottom: 24,
            textAlign: 'center',
            animation: 'fadeInUp 0.5s ease',
          }}>
            <div style={{ fontSize: 11, color: '#ff9944', letterSpacing: 4, fontWeight: 700, marginBottom: 4 }}>
              SPÉCIALE CHRONOMÉTRÉE
            </div>
            <div style={{ fontSize: 20, color: '#ffcc88', fontWeight: 900, letterSpacing: 2 }}>
              {map.name.toUpperCase()}
            </div>
          </div>

          <div key={countdownStep} style={{
            fontSize: countdownStep === 0 ? 110 : 140,
            fontWeight: 900,
            letterSpacing: -4,
            color: countdownStep === 0 ? '#ffaa33' : countdownStep === 1 ? '#ffdd33' : '#ffffff',
            textShadow: countdownStep === 0
              ? '0 0 60px #ff8800, 0 4px 24px rgba(0,0,0,0.9)'
              : '0 4px 24px rgba(0,0,0,0.9)',
            animation: 'countdownPop 0.35s cubic-bezier(0.2, 1.5, 0.4, 1)',
            lineHeight: 1,
          }}>
            {countdownStep === 0 ? '🏁' : countdownStep}
          </div>
          <div style={{
            marginTop: countdownStep === 0 ? 8 : 12,
            fontSize: countdownStep === 0 ? 28 : 14,
            color: countdownStep === 0 ? '#ffaa33' : 'rgba(255,220,150,0.6)',
            letterSpacing: countdownStep === 0 ? 4 : 3,
            fontWeight: 900,
            animation: countdownStep === 0 ? 'countdownPop 0.35s ease' : 'none',
          }}>
            {countdownStep > 0 ? 'PRÊT...' : 'PARTEZ !'}
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

      {/* ═══════════════ STAGE PROGRESS (top right) ═══════════════ */}
      <div style={{
        position: 'absolute', top: 16, right: 20,
        pointerEvents: 'none',
        minWidth: 110,
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(6px)',
          borderRadius: 10,
          padding: '10px 16px',
          border: '1px solid rgba(255,255,255,0.12)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 10, color: '#aa6633', letterSpacing: 2, marginBottom: 6, fontWeight: 700 }}>SPÉCIALE</div>
          {/* Progress bar — sunset orange */}
          <div style={{
            width: '100%', height: 6,
            background: 'rgba(255,150,50,0.15)',
            borderRadius: 3, overflow: 'hidden',
            marginBottom: 6,
          }}>
            <div style={{
              width: `${Math.min(stageProgress * 100, 100).toFixed(1)}%`,
              height: '100%',
              background: stageProgress > 0.9 ? '#ffd700' : 'linear-gradient(90deg, #cc4400, #ff8833)',
              borderRadius: 3,
              transition: 'width 0.2s, background 0.3s',
            }} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#ffcc88', lineHeight: 1 }}>
            {Math.min(Math.round(stageProgress * 100), 100)}<span style={{ fontSize: 12, opacity: 0.5 }}>%</span>
          </div>
        </div>
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

      {/* ═══════════════ MINI-MAP (top left) ═══════════════ */}
      <div style={{ position: 'absolute', top: 16, left: 16, pointerEvents: 'none' }}>
        <MiniMap waypoints={MAP_CONFIGS[mapId].waypoints} progress={stageProgress} />
      </div>

      {/* ═══════════════ SPEEDOMETER (bottom center) ═══════════════ */}
      <div style={{
        position: 'absolute', bottom: 130, left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        textAlign: 'center',
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(8px)',
          borderRadius: 16,
          padding: '10px 28px 8px',
          border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'baseline', gap: 4,
          boxShadow: speedKmh > 80 ? '0 0 24px rgba(255,120,0,0.25)' : 'none',
          transition: 'box-shadow 0.3s',
        }}>
          <span style={{
            fontSize: 52,
            fontFamily: '"Courier New", monospace',
            fontWeight: 900,
            lineHeight: 1,
            color: speedKmh > 100 ? '#ff8833' : speedKmh > 60 ? '#ffcc44' : '#ffffff',
            transition: 'color 0.2s',
            minWidth: '3ch',
            textAlign: 'right',
          }}>
            {speedKmh}
          </span>
          <span style={{ fontSize: 14, color: '#666', fontWeight: 700, paddingBottom: 4 }}>km/h</span>
        </div>
        {/* Speed bar */}
        <div style={{
          width: '100%', height: 3, marginTop: 6,
          background: 'rgba(255,255,255,0.08)',
          borderRadius: 2, overflow: 'hidden',
        }}>
          <div style={{
            width: `${Math.min((speedKmh / 130) * 100, 100)}%`,
            height: '100%',
            background: speedKmh > 100
              ? 'linear-gradient(90deg, #ff6600, #ff2200)'
              : speedKmh > 60
              ? 'linear-gradient(90deg, #ffcc00, #ff8800)'
              : 'linear-gradient(90deg, #00cc66, #00ffaa)',
            borderRadius: 2,
            transition: 'width 0.1s, background 0.2s',
          }} />
        </div>
      </div>

      {/* ═══════════════ CONTROLS HINT — desktop only (bottom right) ═══════════════ */}
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
          ZQSD / ↑↓←→ &nbsp;•&nbsp; <span style={{ color: '#f90' }}>Space</span> Drift &nbsp;•&nbsp; <span style={{ color: '#888' }}>R</span> Restart
        </div>
      </div>

      {/* ═══════════════ TOUCH CONTROLS — mobile ═══════════════ */}
      {raceState !== 'finished' && (
        <>
          {/* Steering gauche */}
          <div style={{
            position: 'absolute', bottom: 28, left: 24,
            display: 'flex', gap: 10, pointerEvents: 'auto',
          }}>
            <TouchBtn label="◀" color="rgba(255,255,255,0.55)"
              onPress={() => engineRef.current?.setInput('left', true)}
              onRelease={() => engineRef.current?.setInput('left', false)} />
            <TouchBtn label="▶" color="rgba(255,255,255,0.55)"
              onPress={() => engineRef.current?.setInput('right', true)}
              onRelease={() => engineRef.current?.setInput('right', false)} />
          </div>
          {/* Dérive — milieu bas */}
          <div style={{
            position: 'absolute', bottom: 28, left: '50%',
            transform: 'translateX(-50%)', pointerEvents: 'auto',
          }}>
            <TouchBtn label="💨" color="rgba(255,150,0,0.6)"
              style={{ width: 68, height: 68, fontSize: 24 }}
              onPress={() => engineRef.current?.setInput('handbrake', true)}
              onRelease={() => engineRef.current?.setInput('handbrake', false)} />
          </div>
          {/* Gas + Frein — droite */}
          <div style={{
            position: 'absolute', bottom: 28, right: 24,
            display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'auto',
          }}>
            <TouchBtn label="🛑" color="rgba(255,60,60,0.6)"
              onPress={() => engineRef.current?.setInput('backward', true)}
              onRelease={() => engineRef.current?.setInput('backward', false)} />
            <TouchBtn label="▲" color="rgba(0,200,100,0.7)"
              style={{ height: 100 }}
              onPress={() => engineRef.current?.setInput('forward', true)}
              onRelease={() => engineRef.current?.setInput('forward', false)} />
          </div>
        </>
      )}

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
