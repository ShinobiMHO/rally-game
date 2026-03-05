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

// ── Gear helper ──
function getGear(kmh: number): number {
  if (kmh < 15) return 1;
  if (kmh < 35) return 2;
  if (kmh < 58) return 3;
  if (kmh < 82) return 4;
  if (kmh < 108) return 5;
  return 6;
}

// ── SVG arc helpers ──
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildArcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polarToCartesian(cx, cy, r, startDeg);
  const e = polarToCartesian(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const large = sweep > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

// ── SVG Speedometer ──
function Speedometer({ speedKmh }: { speedKmh: number }) {
  const MAX = 130;
  const W = 210, H = 200;
  const cx = 105, cy = 92;
  const R = 74;
  const START = -135; // 7 o'clock
  const END = 135;    // 5 o'clock
  const SWEEP = 270;

  const gear = getGear(speedKmh);
  const fraction = Math.min(speedKmh / MAX, 1);
  const speedAngle = START + fraction * SWEEP;

  const arcColor = speedKmh > 100 ? '#ff2200'
    : speedKmh > 65 ? '#ffaa00'
    : '#00dd88';

  // Needle tip
  const needleTip = polarToCartesian(cx, cy, R - 10, speedAngle);
  const needleBase1 = polarToCartesian(cx, cy, 10, speedAngle - 90);
  const needleBase2 = polarToCartesian(cx, cy, 10, speedAngle + 90);

  // Tick marks: 0, 20, 40, 60, 80, 100, 120 km/h
  const ticks = [0, 20, 40, 60, 80, 100, 120];

  return (
    <div style={{
      background: 'rgba(0,0,0,0.82)',
      backdropFilter: 'blur(12px)',
      borderRadius: 20,
      border: '1px solid rgba(255,255,255,0.12)',
      overflow: 'hidden',
      boxShadow: speedKmh > 80
        ? `0 0 32px rgba(255,${speedKmh > 100 ? 60 : 150},0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)`
        : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      transition: 'box-shadow 0.3s',
    }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {/* Outer glow ring (faint) */}
        <circle cx={cx} cy={cy} r={R + 6} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth={12} />

        {/* Background arc */}
        <path
          d={buildArcPath(cx, cy, R, START, END)}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={12}
          strokeLinecap="round"
        />

        {/* Colored speed arc */}
        {fraction > 0.005 && (
          <path
            d={buildArcPath(cx, cy, R, START, Math.min(speedAngle, END - 0.1))}
            fill="none"
            stroke={arcColor}
            strokeWidth={12}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${arcColor})`, transition: 'stroke 0.15s' }}
          />
        )}

        {/* Tick marks */}
        {ticks.map(v => {
          const a = START + (v / MAX) * SWEEP;
          const inner = polarToCartesian(cx, cy, R - 18, a);
          const outer = polarToCartesian(cx, cy, R - 6, a);
          const label = polarToCartesian(cx, cy, R - 32, a);
          const isMajor = v % 40 === 0;
          return (
            <g key={v}>
              <line
                x1={inner.x} y1={inner.y}
                x2={outer.x} y2={outer.y}
                stroke={isMajor ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)'}
                strokeWidth={isMajor ? 2 : 1}
              />
              {isMajor && (
                <text
                  x={label.x} y={label.y}
                  textAnchor="middle" dominantBaseline="middle"
                  fill="rgba(255,255,255,0.38)"
                  fontSize="9"
                  fontFamily='"Courier New", monospace'
                >
                  {v}
                </text>
              )}
            </g>
          );
        })}

        {/* Needle */}
        <polygon
          points={`${needleTip.x.toFixed(1)},${needleTip.y.toFixed(1)} ${needleBase1.x.toFixed(1)},${needleBase1.y.toFixed(1)} ${needleBase2.x.toFixed(1)},${needleBase2.y.toFixed(1)}`}
          fill={arcColor}
          opacity={0.9}
          style={{ transition: 'none' }}
        />
        {/* Needle center cap */}
        <circle cx={cx} cy={cy} r={7} fill="rgba(30,30,30,1)" stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} />

        {/* Speed number */}
        <text
          x={cx} y={cy - 6}
          textAnchor="middle" dominantBaseline="middle"
          fill="white"
          fontSize={speedKmh >= 100 ? 40 : 44}
          fontWeight="900"
          fontFamily='"Courier New", monospace'
          style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
        >
          {speedKmh}
        </text>

        {/* km/h label */}
        <text
          x={cx} y={cy + 20}
          textAnchor="middle"
          fill="rgba(255,255,255,0.35)"
          fontSize="10"
          fontFamily='"Courier New", monospace'
          fontWeight="700"
          letterSpacing="2"
        >
          KM/H
        </text>

        {/* Gear indicator box */}
        <rect
          x={cx - 20} y={cy + 34}
          width={40} height={30}
          rx={6}
          fill="rgba(255,140,0,0.12)"
          stroke={gear >= 5 ? '#ff6600' : gear >= 3 ? '#ffaa00' : 'rgba(255,140,0,0.5)'}
          strokeWidth={1.5}
        />
        <text
          x={cx} y={cy + 52}
          textAnchor="middle" dominantBaseline="middle"
          fill={gear >= 5 ? '#ff8833' : gear >= 3 ? '#ffcc44' : '#aaaaaa'}
          fontSize="16"
          fontWeight="900"
          fontFamily='"Courier New", monospace'
        >
          {gear}
        </text>
        <text
          x={cx - 14} y={cy + 38}
          fill="rgba(255,140,0,0.45)"
          fontSize="7"
          fontFamily="monospace"
          fontWeight="700"
        >
          GEAR
        </text>

        {/* Speed bar at the bottom */}
        <rect x={10} y={H - 14} width={W - 20} height={5} rx={2.5} fill="rgba(255,255,255,0.06)" />
        <rect
          x={10} y={H - 14}
          width={Math.max(0, (W - 20) * fraction)}
          height={5}
          rx={2.5}
          fill={arcColor}
          style={{ transition: 'width 0.1s, fill 0.15s', filter: `drop-shadow(0 0 4px ${arcColor})` }}
        />
      </svg>
    </div>
  );
}

// ── Mini-map ──
function MiniMap({ waypoints, progress }: { waypoints: [number, number, number][], progress: number }) {
  const SIZE = 155;
  const PAD = 14;
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
    y: oz + (maxZ - z) * scale,
  });

  const pts = waypoints.map(([x, z]) => {
    const p = toSvg(x, z);
    return `${p.x},${p.y}`;
  }).join(' ');

  const n = waypoints.length - 1;
  const fi = progress * n;
  const i = Math.min(Math.floor(fi), n - 1);
  const frac = fi - i;
  const [ax, az] = waypoints[i];
  const [bx, bz] = waypoints[Math.min(i + 1, n)];
  const carX = ax + (bx - ax) * frac;
  const carZ = az + (bz - az) * frac;
  const carPt = toSvg(carX, carZ);
  const startPt = toSvg(waypoints[0][0], waypoints[0][1]);
  const endPt = toSvg(waypoints[n][0], waypoints[n][1]);

  return (
    <div style={{
      background: 'rgba(0,0,0,0.80)',
      backdropFilter: 'blur(10px)',
      borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.12)',
      overflow: 'hidden',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
    }}>
      {/* Header */}
      <div style={{
        padding: '5px 10px 3px',
        fontSize: 9,
        fontFamily: 'monospace',
        fontWeight: 700,
        color: 'rgba(255,180,80,0.8)',
        letterSpacing: 2,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        CARTE
      </div>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Track background shadow */}
        <polyline points={pts} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        {/* Track base */}
        <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        {/* Completed part */}
        <polyline points={
          waypoints.slice(0, i + 2).map(([x, z]) => {
            const p = toSvg(x, z); return `${p.x},${p.y}`;
          }).join(' ')
        } fill="none" stroke="#ff7733" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 3px rgba(255,100,0,0.6))' }}
        />
        {/* Start marker */}
        <circle cx={startPt.x} cy={startPt.y} r={5} fill="#00ff88" style={{ filter: 'drop-shadow(0 0 3px #00ff88)' }} />
        {/* Finish marker */}
        <circle cx={endPt.x} cy={endPt.y} r={5} fill="#ff2222" style={{ filter: 'drop-shadow(0 0 3px #ff2222)' }} />
        {/* Car dot */}
        <circle cx={carPt.x} cy={carPt.y} r={6} fill="#ffffff" stroke="#ff7733" strokeWidth={2.5}
          style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.8))' }} />
      </svg>
    </div>
  );
}

// ── Rally Timer ──
function RallyTimer({ elapsedMs, bestTime, isRacing }: { elapsedMs: number, bestTime: number | null, isRacing: boolean }) {
  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  const ms = Math.floor((elapsedMs % 1000) / 10);
  const mainTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const msStr = ms.toString().padStart(2, '0');

  return (
    <div style={{
      background: isRacing
        ? 'linear-gradient(180deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.68) 100%)'
        : 'rgba(0,0,0,0.50)',
      backdropFilter: 'blur(10px)',
      borderRadius: 14,
      padding: '8px 24px 10px',
      border: `1px solid ${isRacing ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)'}`,
      transition: 'border 0.3s, background 0.3s',
      minWidth: 280,
      textAlign: 'center',
      boxShadow: isRacing ? '0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)' : 'none',
    }}>
      {/* Label */}
      <div style={{
        fontSize: 9,
        fontFamily: 'monospace',
        fontWeight: 700,
        letterSpacing: 3,
        color: isRacing ? 'rgba(255,160,60,0.8)' : 'rgba(255,255,255,0.2)',
        marginBottom: 2,
        transition: 'color 0.3s',
      }}>
        ⏱ CHRONO
      </div>

      {/* Main time display */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 0 }}>
        {/* M:SS */}
        <span style={{
          fontSize: 56,
          fontFamily: '"Courier New", monospace',
          fontWeight: 900,
          letterSpacing: 2,
          color: isRacing ? '#ffffff' : 'rgba(255,255,255,0.3)',
          lineHeight: 1,
          textShadow: isRacing ? '0 2px 12px rgba(0,0,0,0.6)' : 'none',
          transition: 'color 0.3s',
        }}>
          {mainTime}
        </span>
        {/* .mm */}
        <span style={{
          fontSize: 30,
          fontFamily: '"Courier New", monospace',
          fontWeight: 900,
          color: isRacing ? 'rgba(255,200,80,0.9)' : 'rgba(255,255,255,0.15)',
          lineHeight: 1,
          paddingBottom: 4,
          minWidth: '2.2ch',
          textAlign: 'left',
          transition: 'color 0.3s',
        }}>
          .{msStr}
        </span>
      </div>

      {/* Best time */}
      {bestTime !== null && (
        <div style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: '#ffd700',
          letterSpacing: 2,
          marginTop: 2,
          opacity: 0.9,
        }}>
          🏆 BEST {formatTime(bestTime)}
        </div>
      )}
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

  const [isTouchDevice] = useState(() =>
    typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [stageProgress, setStageProgress] = useState(0);
  const [raceState, setRaceState] = useState<RaceState>('countdown');
  const [countdownStep, setCountdownStep] = useState(3);
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
          <div style={{ marginBottom: 24, textAlign: 'center', animation: 'fadeInUp 0.5s ease' }}>
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

      {/* ═══════════════ MAIN TIMER (top-center) ═══════════════ */}
      <div style={{
        position: 'absolute', top: 14, left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        textAlign: 'center',
      }}>
        <RallyTimer elapsedMs={elapsedMs} bestTime={bestTime} isRacing={isRacing} />
      </div>

      {/* ═══════════════ STAGE PROGRESS (top right) ═══════════════ */}
      <div style={{
        position: 'absolute', top: 14, right: 18,
        pointerEvents: 'none',
        minWidth: 118,
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.80)',
          backdropFilter: 'blur(10px)',
          borderRadius: 12,
          padding: '10px 16px 12px',
          border: '1px solid rgba(255,255,255,0.12)',
          textAlign: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
        }}>
          <div style={{
            fontSize: 9,
            fontFamily: 'monospace',
            fontWeight: 700,
            color: 'rgba(255,160,60,0.8)',
            letterSpacing: 2,
            marginBottom: 7,
          }}>
            SPÉCIALE
          </div>
          {/* Progress bar */}
          <div style={{
            width: '100%', height: 7,
            background: 'rgba(255,150,50,0.10)',
            borderRadius: 4, overflow: 'hidden',
            marginBottom: 7,
          }}>
            <div style={{
              width: `${Math.min(stageProgress * 100, 100).toFixed(1)}%`,
              height: '100%',
              background: stageProgress > 0.9
                ? 'linear-gradient(90deg, #ffaa00, #ffd700)'
                : 'linear-gradient(90deg, #cc4400, #ff8833)',
              borderRadius: 4,
              transition: 'width 0.2s, background 0.3s',
              boxShadow: stageProgress > 0.9 ? '0 0 8px rgba(255,200,0,0.5)' : 'none',
            }} />
          </div>
          <div style={{
            fontSize: 22,
            fontFamily: '"Courier New", monospace',
            fontWeight: 900,
            color: stageProgress > 0.9 ? '#ffd700' : '#ffcc88',
            lineHeight: 1,
          }}>
            {Math.min(Math.round(stageProgress * 100), 100)}
            <span style={{ fontSize: 11, opacity: 0.45 }}>%</span>
          </div>
        </div>
      </div>

      {/* ═══════════════ CHECKPOINT SPLITS (center-right) ═══════════════ */}
      <div style={{
        position: 'absolute', top: '50%', right: 18,
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
              borderRadius: 10,
              padding: '8px 18px',
              animation: 'splitIn 0.25s cubic-bezier(0.2, 1.4, 0.4, 1)',
              boxShadow: `0 4px 20px ${isGreen ? 'rgba(0,200,100,0.4)' : isRed ? 'rgba(220,60,60,0.4)' : 'rgba(255,200,0,0.4)'}`,
            }}>
              <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.6)', letterSpacing: 2, fontWeight: 700 }}>
                SPLIT {split.index + 1}
              </div>
              <div style={{ fontSize: 22, fontFamily: 'monospace', fontWeight: 900, color: '#000', lineHeight: 1 }}>
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
      <div style={{ position: 'absolute', top: 14, left: 14, pointerEvents: 'none' }}>
        <MiniMap waypoints={MAP_CONFIGS[mapId].waypoints} progress={stageProgress} />
      </div>

      {/* ═══════════════ SPEEDOMETER (bottom center-right) ═══════════════ */}
      <div style={{
        position: 'absolute',
        bottom: isTouchDevice ? 140 : 20,
        right: isTouchDevice ? '50%' : 20,
        transform: isTouchDevice ? 'translateX(50%)' : 'none',
        pointerEvents: 'none',
      }}>
        <Speedometer speedKmh={speedKmh} />
      </div>

      {/* ═══════════════ CONTROLS HINT — desktop only ═══════════════ */}
      {!isTouchDevice && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.45)',
            borderRadius: 8,
            padding: '6px 14px',
            border: '1px solid rgba(255,255,255,0.06)',
            fontSize: 11, color: '#555', letterSpacing: 0.5,
          }}>
            ZQSD / ↑↓←→ &nbsp;•&nbsp; <span style={{ color: '#f90' }}>Space</span> Drift &nbsp;•&nbsp; <span style={{ color: '#888' }}>R</span> Restart
          </div>
        </div>
      )}

      {/* ═══════════════ TOUCH CONTROLS — mobile uniquement ═══════════════ */}
      {isTouchDevice && raceState !== 'finished' && (
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
