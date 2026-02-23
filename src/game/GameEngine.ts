import * as THREE from 'three';
import type { MapConfig, CarConfig, CheckpointSplit, RaceState } from '@/types';

interface PhysicsState {
  position: THREE.Vector3;
  heading: number;       // car's facing direction (yaw)
  velHeading: number;    // actual velocity direction (for drift)
  speed: number;         // scalar speed along velHeading
  lateralVel: number;    // perpendicular velocity (drift)
}

interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

interface TrackPoint {
  center: THREE.Vector3;
  tangent: THREE.Vector3;
  left: THREE.Vector3;
  right: THREE.Vector3;
}

interface CheckpointState {
  t: number;
  passed: boolean;
  mesh: THREE.Group;
}

export type EngineCallback = {
  onTimerUpdate?: (ms: number) => void;
  onCountdown?: (step: number) => void;   // 3, 2, 1, 0=GO
  onCheckpoint?: (split: CheckpointSplit) => void;
  onLapComplete?: (lap: number, lapTimeMs: number) => void;
  onFinish?: (totalMs: number) => void;
  onStateChange?: (state: RaceState) => void;
};

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private carGroup!: THREE.Group;
  private carBodyMesh!: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];
  private trackPoints: TrackPoint[] = [];
  private spline!: THREE.CatmullRomCurve3;
  private animationId: number | null = null;
  private physics!: PhysicsState;
  private input: InputState;
  private mapConfig: MapConfig;
  private carConfig: CarConfig;
  private callbacks: EngineCallback;

  // Race state
  private raceState: RaceState = 'countdown';
  private countdownStep = 3;
  private countdownTimer = 0;
  private timerActive = false;
  private startTimeMs = 0;
  private elapsedMs = 0;
  private lastUpdateTime = 0;
  private currentLap = 0;
  private totalLaps = 2;

  // Progress tracking
  private lastCarT = 0;       // last known spline t position
  private lapStartMs = 0;     // time at start of current lap

  // Checkpoints
  private checkpointStates: CheckpointState[] = [];
  private bestSplits: number[] = []; // best elapsed time at each checkpoint (session)
  private bestTotalTime: number = Infinity;
  private lapCheckpointIndex = 0; // how many checkpoints passed this lap

  // Particles & effects
  private particles: THREE.Points[] = [];
  private driftParticleTimer = 0;
  private skidMarks: THREE.Mesh[] = [];

  // Audio
  private soundCtx: AudioContext | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;

  private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private _keyupHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    mapConfig: MapConfig,
    carConfig: CarConfig,
    callbacks: EngineCallback
  ) {
    this.mapConfig = mapConfig;
    this.carConfig = carConfig;
    this.callbacks = callbacks;
    this.totalLaps = mapConfig.laps;

    this.input = { forward: false, backward: false, left: false, right: false };
    this.initPhysics();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Scene
    const skyColor = new THREE.Color(mapConfig.groundColor).lerp(new THREE.Color(0x87ceeb), 0.35);
    this.scene = new THREE.Scene();
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(skyColor, 100, 280);

    // Camera
    this.camera = new THREE.PerspectiveCamera(52, canvas.clientWidth / canvas.clientHeight, 0.1, 600);

    this.setupLights();
    this.buildTrack();
    this.buildEnvironment();
    this.buildCar();
    this.placeCarAtStart();
    this.setupAudio();
    this.bindKeys();
    window.addEventListener('resize', this.onResize);

    // Start with countdown
    this.startCountdown();
    this.startLoop();
  }

  // ─────────────── Init ───────────────

  private initPhysics() {
    this.physics = {
      position: new THREE.Vector3(0, 0.5, 0),
      heading: 0,
      velHeading: 0,
      speed: 0,
      lateralVel: 0,
    };
  }

  private placeCarAtStart() {
    if (!this.spline) return;
    const startPt = this.trackPoints[0];
    this.physics.position.set(startPt.center.x, 0.5, startPt.center.z);
    const angle = Math.atan2(startPt.tangent.x, startPt.tangent.z);
    this.physics.heading = angle;
    this.physics.velHeading = angle;
    this.physics.speed = 0;
    this.physics.lateralVel = 0;
    if (this.carGroup) {
      this.carGroup.position.copy(this.physics.position);
      this.carGroup.rotation.y = this.physics.heading;
    }
    this.lastCarT = 0;
  }

  // ─────────────── Countdown ───────────────

  private startCountdown() {
    this.raceState = 'countdown';
    this.countdownStep = 3;
    this.countdownTimer = 0;
    this.timerActive = false;
    this.elapsedMs = 0;
    this.currentLap = 0;
    this.lapStartMs = 0;
    this.lapCheckpointIndex = 0;
    this.resetCheckpoints();
    this.callbacks.onCountdown?.(3);
    this.callbacks.onStateChange?.('countdown');
    this.callbacks.onTimerUpdate?.(0);
  }

  private resetCheckpoints() {
    this.checkpointStates.forEach(cs => {
      cs.passed = false;
      this.setCheckpointGlowing(cs, false);
    });
  }

  private tickCountdown(dt: number) {
    this.countdownTimer += dt;
    const target = 3 - this.countdownStep; // 0→1→2→3 seconds
    if (this.countdownTimer >= 1.0) {
      this.countdownTimer -= 1.0;
      this.countdownStep--;
      if (this.countdownStep <= 0) {
        // GO!
        this.countdownStep = 0;
        this.callbacks.onCountdown?.(0);
        this.raceState = 'racing';
        this.timerActive = true;
        this.startTimeMs = performance.now();
        this.lapStartMs = performance.now();
        this.callbacks.onStateChange?.('racing');
        this.playSound(880, 0.12, 'square', 0.12);
      } else {
        this.callbacks.onCountdown?.(this.countdownStep);
        this.playBeep(this.countdownStep);
      }
    }
  }

  // ─────────────── Track Building ───────────────

  private buildTrack() {
    const wp = this.mapConfig.waypoints;
    const center = this.computeCenter(wp);

    const points3D = wp.map(([x, z]) =>
      new THREE.Vector3(x - center.x, 0, z - center.y)
    );
    this.spline = new THREE.CatmullRomCurve3(points3D, true, 'catmullrom', 0.5);

    const divisions = wp.length * 24;
    const hw = this.mapConfig.trackWidth / 2;
    const vertices: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];
    this.trackPoints = [];

    for (let i = 0; i <= divisions; i++) {
      const t = i / divisions;
      const pt = this.spline.getPoint(t);
      const tangent = this.spline.getTangent(t).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const left = pt.clone().add(normal.clone().multiplyScalar(hw));
      const right = pt.clone().sub(normal.clone().multiplyScalar(hw));
      this.trackPoints.push({ center: pt.clone(), tangent, left, right });
      vertices.push(left.x, 0.01, left.z, right.x, 0.01, right.z);
      uvs.push(0, t * hw * 2, 1, t * hw * 2);
      normals.push(0, 1, 0, 0, 1, 0);
    }
    for (let i = 0; i < divisions; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);

    const mat = new THREE.MeshLambertMaterial({ color: this.mapConfig.roadColor });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.scene.add(road);

    // Road surface tint stripes for visual speed feel
    this.buildLaneStripes(divisions);

    // Start/finish
    this.buildStartFinishLine();

    // Barriers
    this.buildBarriers();

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000, 4, 4),
      new THREE.MeshLambertMaterial({ color: this.mapConfig.groundColor })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Checkpoints
    this.buildCheckpoints();
  }

  private computeCenter(wp: [number, number][]): { x: number; y: number } {
    let sx = 0, sy = 0;
    for (const [x, y] of wp) { sx += x; sy += y; }
    return { x: sx / wp.length, y: sy / wp.length };
  }

  private buildLaneStripes(divisions: number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const step = 10;
    for (let i = 0; i < divisions; i += step) {
      const tp = this.trackPoints[i];
      if (!tp) continue;
      const tangent = tp.tangent;
      const geo = new THREE.PlaneGeometry(0.4, 4);
      const dash = new THREE.Mesh(geo, mat);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = Math.atan2(tangent.x, tangent.z);
      dash.position.set(tp.center.x, 0.015, tp.center.z);
      this.scene.add(dash);
    }
  }

  private buildStartFinishLine() {
    const tp = this.trackPoints[0];
    const hw = this.mapConfig.trackWidth;
    const angle = Math.atan2(tp.tangent.x, tp.tangent.z);

    // White base
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(hw, 2.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    base.rotation.x = -Math.PI / 2;
    base.rotation.z = angle;
    base.position.set(tp.center.x, 0.02, tp.center.z);
    this.scene.add(base);

    // Checkered
    const n = 8;
    const cw = hw / n;
    for (let i = 0; i < n; i++) {
      if (i % 2 !== 0) continue;
      const c = new THREE.Mesh(
        new THREE.PlaneGeometry(cw, 2.5),
        new THREE.MeshBasicMaterial({ color: 0x111111 })
      );
      c.rotation.x = -Math.PI / 2;
      c.rotation.z = angle;
      const perp = angle + Math.PI / 2;
      const off = (i - n / 2 + 0.5) * cw;
      c.position.set(
        tp.center.x + Math.cos(perp) * off,
        0.03,
        tp.center.z + Math.sin(perp) * off
      );
      this.scene.add(c);
    }

    // Overhead gantry
    this.buildFinishGantry(tp, hw, angle);
  }

  private buildFinishGantry(tp: TrackPoint, hw: number, angle: number) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
    const redMat = new THREE.MeshLambertMaterial({ color: 0xff2222 });
    const height = 6;

    const perp = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const left = tp.center.clone().addScaledVector(perp, hw / 2 + 0.5);
    const right = tp.center.clone().addScaledVector(perp, -hw / 2 - 0.5);

    for (const pos of [left, right]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, height, 0.5), mat);
      post.position.set(pos.x, height / 2, pos.z);
      post.castShadow = true;
      this.scene.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw + 1.5, 0.5, 0.5), redMat);
    beam.position.set(tp.center.x, height, tp.center.z);
    beam.rotation.y = angle;
    beam.castShadow = true;
    this.scene.add(beam);
  }

  private buildBarriers() {
    const step = 4;
    const barrierH = 1.4;
    const mat1 = new THREE.MeshLambertMaterial({ color: this.mapConfig.barrierColor });
    const mat2 = new THREE.MeshLambertMaterial({ color: 0x333333 });

    for (let i = 0; i < this.trackPoints.length - 1; i += step) {
      const tp = this.trackPoints[i];
      const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
      const alternate = Math.floor(i / step) % 4 < 2;
      for (const side of [tp.left, tp.right]) {
        const geo = new THREE.BoxGeometry(0.45, barrierH, step * 0.85);
        const barrier = new THREE.Mesh(geo, alternate ? mat1 : mat2);
        barrier.position.set(side.x, barrierH / 2, side.z);
        barrier.rotation.y = angle;
        barrier.castShadow = true;
        this.scene.add(barrier);
      }
    }
  }

  private buildCheckpoints() {
    this.checkpointStates = [];
    const hw = this.mapConfig.trackWidth;

    this.mapConfig.checkpoints.forEach((t) => {
      const idx = Math.floor(t * (this.trackPoints.length - 1));
      const tp = this.trackPoints[Math.min(idx, this.trackPoints.length - 1)];
      const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
      const gate = this.makeCheckpointGate(tp, hw, angle, false);
      this.scene.add(gate);
      this.checkpointStates.push({ t, passed: false, mesh: gate });
    });
  }

  private makeCheckpointGate(tp: TrackPoint, hw: number, angle: number, glowing: boolean): THREE.Group {
    const group = new THREE.Group();
    const color = glowing ? 0x00ff88 : 0xffaa00;
    const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: glowing ? 0.9 : 0.7 });
    const height = 5;
    const perp = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));

    // Posts
    for (const sign of [-1, 1]) {
      const pos = tp.center.clone().addScaledVector(perp, sign * (hw / 2 + 0.3));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, height, 6), mat);
      post.position.set(pos.x, height / 2, pos.z);
      group.add(post);
    }
    // Beam
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, hw + 1.5, 6), mat);
    beam.rotation.z = Math.PI / 2;
    beam.position.set(tp.center.x, height, tp.center.z);
    beam.rotation.y = angle;
    group.add(beam);

    // Ground strip
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(hw, 1.5),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: glowing ? 0.8 : 0.4 })
    );
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = angle;
    strip.position.set(tp.center.x, 0.04, tp.center.z);
    group.add(strip);

    return group;
  }

  private setCheckpointGlowing(cs: CheckpointState, glow: boolean) {
    const color = glow ? 0x00ff88 : 0xffaa00;
    const opacity = glow ? 0.9 : 0.7;
    cs.mesh.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        const mat = (obj as THREE.Mesh).material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
        (mat as any).color?.setHex(color);
        mat.opacity = opacity;
      }
    });
  }

  // ─────────────── Environment ───────────────

  private buildEnvironment() {
    const treeMat = new THREE.MeshLambertMaterial({ color: this.mapConfig.treeColor });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
    const rng = this.seededRng(42);

    for (let i = 0; i < 100; i++) {
      const x = (rng() - 0.5) * 350;
      const z = (rng() - 0.5) * 350;
      const pos = new THREE.Vector3(x, 0, z);

      let tooClose = false;
      for (const tp of this.trackPoints) {
        if (pos.distanceTo(tp.center) < this.mapConfig.trackWidth * 2.2) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const h = 4 + rng() * 6;
      const r = 1.5 + rng() * 2;
      const sides = Math.floor(4 + rng() * 3);

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, h * 0.45, 5), trunkMat);
      trunk.position.y = h * 0.225;
      trunk.castShadow = true;

      const crown = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.72, sides), treeMat);
      crown.position.y = h * 0.58;
      crown.castShadow = true;

      const tree = new THREE.Group();
      tree.add(trunk);
      tree.add(crown);
      tree.position.set(x, 0, z);
      tree.rotation.y = rng() * Math.PI * 2;
      this.scene.add(tree);
    }

    // Some rocks for variety
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    for (let i = 0; i < 40; i++) {
      const x = (rng() - 0.5) * 300;
      const z = (rng() - 0.5) * 300;
      let tooClose = false;
      for (const tp of this.trackPoints) {
        if (new THREE.Vector3(x, 0, z).distanceTo(tp.center) < this.mapConfig.trackWidth * 2) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      const s = 0.5 + rng() * 2;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.position.set(x, s * 0.4, z);
      rock.rotation.set(rng(), rng(), rng());
      rock.castShadow = true;
      this.scene.add(rock);
    }
  }

  private seededRng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  }

  // ─────────────── Car ───────────────

  private buildCar() {
    const cfg = this.carConfig;
    this.carGroup = new THREE.Group();

    // Main body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.75, 3.8),
      new THREE.MeshLambertMaterial({ color: cfg.bodyColor })
    );
    body.position.y = 0.5;
    body.castShadow = true;
    this.carGroup.add(body);
    this.carBodyMesh = body;

    // Front spoiler
    const spoilerFront = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.15, 0.5),
      new THREE.MeshLambertMaterial({ color: cfg.bodyColor })
    );
    spoilerFront.position.set(0, 0.22, 1.95);
    this.carGroup.add(spoilerFront);

    // Rear wing
    const wingPost1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.6, 0.1),
      new THREE.MeshLambertMaterial({ color: 0x222222 })
    );
    wingPost1.position.set(0.5, 0.95, -1.7);
    const wingPost2 = wingPost1.clone();
    wingPost2.position.set(-0.5, 0.95, -1.7);
    this.carGroup.add(wingPost1, wingPost2);
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.1, 0.55),
      new THREE.MeshLambertMaterial({ color: cfg.bodyColor })
    );
    wing.position.set(0, 1.28, -1.7);
    this.carGroup.add(wing);

    // Cabin
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.65, 0.55, 1.7),
      new THREE.MeshLambertMaterial({ color: cfg.bodyColor })
    );
    cabin.position.set(0, 1.08, -0.15);
    cabin.castShadow = true;
    this.carGroup.add(cabin);

    // Windows
    const winMat = new THREE.MeshLambertMaterial({ color: cfg.windowColor, transparent: true, opacity: 0.75 });
    const fwin = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.45), winMat);
    fwin.position.set(0, 1.12, 0.72);
    fwin.rotation.x = -0.35;
    this.carGroup.add(fwin);
    const rwin = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.45), winMat);
    rwin.position.set(0, 1.12, -1.02);
    rwin.rotation.x = 0.35;
    this.carGroup.add(rwin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 8);
    const wheelMat = new THREE.MeshLambertMaterial({ color: cfg.wheelColor });
    const hubMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const wheelPos = [
      [0.95, 0.36, 1.3], [-0.95, 0.36, 1.3],
      [0.95, 0.36, -1.3], [-0.95, 0.36, -1.3],
    ];
    this.wheels = [];
    for (const [wx, wy, wz] of wheelPos) {
      const wGroup = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      wGroup.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.34, 6), hubMat);
      hub.rotation.z = Math.PI / 2;
      wGroup.add(hub);
      wGroup.position.set(wx, wy, wz);
      this.carGroup.add(wGroup);
      this.wheels.push(tire);
    }

    // Lights
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
    const tlMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
    const lgeo = new THREE.BoxGeometry(0.55, 0.2, 0.08);
    for (const x of [-0.65, 0.65]) {
      const hl = new THREE.Mesh(lgeo, hlMat);
      hl.position.set(x, 0.52, 1.93);
      this.carGroup.add(hl);
      const tl = new THREE.Mesh(lgeo, tlMat);
      tl.position.set(x, 0.52, -1.93);
      this.carGroup.add(tl);
    }

    this.scene.add(this.carGroup);
  }

  // ─────────────── Lights ───────────────

  private setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.3);
    sun.position.set(40, 100, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -200;
    sun.shadow.camera.right = sun.shadow.camera.top = 200;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8899ff, 0.25);
    fill.position.set(-40, 30, -40);
    this.scene.add(fill);
  }

  // ─────────────── Audio ───────────────

  private setupAudio() {
    try {
      this.soundCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      // Engine oscillator removed — too loud/unpleasant
    } catch {}
  }

  public resumeAudio() {
    this.soundCtx?.resume();
  }

  private playBeep(step: number) {
    const freq = step === 3 ? 440 : step === 2 ? 440 : step === 1 ? 440 : 880;
    this.playSound(freq, 0.15, 'square', 0.08);
  }

  private playSound(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.1) {
    if (!this.soundCtx) return;
    try {
      const t = this.soundCtx.currentTime;
      const osc = this.soundCtx.createOscillator();
      const gain = this.soundCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain);
      gain.connect(this.soundCtx.destination);
      osc.start(t);
      osc.stop(t + duration);
    } catch {}
  }

  // ─────────────── Input ───────────────

  private bindKeys() {
    const dn = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['z', 'q', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', ' '].includes(k)) {
        e.preventDefault();
      }
      if (k === 'z' || k === 'arrowup') this.input.forward = true;
      if (k === 's' || k === 'arrowdown') this.input.backward = true;
      if (k === 'q' || k === 'arrowleft') this.input.left = true;
      if (k === 'd' || k === 'arrowright') this.input.right = true;
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'arrowup') this.input.forward = false;
      if (k === 's' || k === 'arrowdown') this.input.backward = false;
      if (k === 'q' || k === 'arrowleft') this.input.left = false;
      if (k === 'd' || k === 'arrowright') this.input.right = false;
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    this._keydownHandler = dn;
    this._keyupHandler = up;
  }

  // ─────────────── Loop ───────────────

  private startLoop() {
    this.lastUpdateTime = performance.now();
    const loop = (now: number) => {
      this.animationId = requestAnimationFrame(loop);
      const dt = Math.min((now - this.lastUpdateTime) / 1000, 0.05);
      this.lastUpdateTime = now;
      this.update(dt, now);
      this.renderer.render(this.scene, this.camera);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  private update(dt: number, now: number) {
    if (this.raceState === 'countdown') {
      this.tickCountdown(dt);
      this.updateCamera(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.raceState === 'finished') {
      this.updateCamera(dt);
      return;
    }
    // Racing
    this.updatePhysics(dt);
    this.updateCamera(dt);
    this.updateAudio();
    this.updateParticles(dt, now);
    this.updateTimer(now);
    this.checkProgress();
  }

  // ─────────────── Physics ───────────────

  private updatePhysics(dt: number) {
    const { carConfig, input, physics } = this;

    // ── Parameters ──
    const speedBoost = 0.9 + (carConfig.speed - 1) * 0.18;
    const handlingBoost = 0.7 + (carConfig.handling - 1) * 0.16;
    const maxSpeed = 28 * speedBoost;            // top speed
    const accel = 22 * speedBoost;               // forward accel
    const brakeForce = 32;
    const rollFriction = 4;                      // natural deceleration
    const steerMax = 2.2 * handlingBoost;        // max yaw rate (rad/s)
    // Drift grip: how quickly lateral velocity decays (lower = more drift)
    const lateralGrip = 2.5 + (carConfig.handling - 1) * 0.5; // units/s²
    const driftAccum = 6 + (5 - carConfig.handling) * 1.2;    // drift accumulation rate

    const speedRatio = Math.abs(physics.speed) / maxSpeed;

    // ── Throttle & Brake ──
    let throttle = 0;
    if (input.forward) throttle = 1;
    if (input.backward) throttle = -1;

    if (throttle > 0) {
      physics.speed = Math.min(physics.speed + accel * dt, maxSpeed);
    } else if (throttle < 0) {
      if (physics.speed > 0.5) {
        physics.speed -= brakeForce * dt;
      } else {
        physics.speed = Math.max(physics.speed - accel * 0.5 * dt, -maxSpeed * 0.35);
      }
    } else {
      const dir = Math.sign(physics.speed);
      physics.speed -= dir * rollFriction * dt;
      if (Math.abs(physics.speed) < 0.1) physics.speed = 0;
    }

    // ── Steering ──
    // Steer rate peaks at mid-speed, reduces slightly at top speed (understeer)
    const steerCurve = speedRatio > 0.05
      ? steerMax * Math.min(speedRatio * 3, 1) * (1 - speedRatio * 0.25)
      : 0;
    let steerInput = 0;
    if (input.left) steerInput = 1;
    if (input.right) steerInput = -1;

    const steerDir = physics.speed >= 0 ? 1 : -1;
    physics.heading += steerInput * steerCurve * steerDir * dt;

    // ── Drift Model ──
    // velHeading lags behind heading — the gap is the drift angle
    // Lateral velocity accumulates when steering at speed
    const isBraking = input.backward && physics.speed > 3;
    // Brake drift: braking while steering kicks the rear out hard (rally style)
    const brakeDriftMultiplier = isBraking ? 3.5 : 1.0;
    // Reduced grip during braking — rear loses traction
    const effectiveLateralGrip = isBraking ? lateralGrip * 0.3 : lateralGrip;

    if (steerInput !== 0 && speedRatio > 0.2) {
      physics.lateralVel += -steerInput * driftAccum * brakeDriftMultiplier * speedRatio * dt;
    }
    // Extra kick when brake is first applied (initiate rotation)
    if (isBraking && steerInput !== 0 && speedRatio > 0.3) {
      physics.lateralVel += -steerInput * 4.0 * speedRatio * dt;
    }
    // Grip recovery: pull lateralVel toward 0
    physics.lateralVel = THREE.MathUtils.lerp(physics.lateralVel, 0, effectiveLateralGrip * dt);

    // Clamp lateral vel
    const maxLateral = maxSpeed * 0.75;
    physics.lateralVel = THREE.MathUtils.clamp(physics.lateralVel, -maxLateral, maxLateral);

    // ── Velocity vector = forward + lateral ──
    const fwd = new THREE.Vector3(Math.sin(physics.heading), 0, Math.cos(physics.heading));
    const right = new THREE.Vector3(Math.cos(physics.heading), 0, -Math.sin(physics.heading));
    const vel = fwd.clone().multiplyScalar(physics.speed)
      .addScaledVector(right, physics.lateralVel);

    physics.position.addScaledVector(vel, dt);
    physics.position.y = 0.5;

    // ── Track boundary collision ──
    // Find the closest point on the spline and push back if out of bounds
    if (this.spline) {
      const pos2D = new THREE.Vector2(physics.position.x, physics.position.z);
      const closestT = this.findClosestT(pos2D);
      const closestPt = this.spline.getPoint(closestT);
      const closestPt2D = new THREE.Vector2(closestPt.x, closestPt.z);
      const distFromCenter = pos2D.distanceTo(closestPt2D);
      const halfWidth = this.mapConfig.trackWidth * 0.5;

      if (distFromCenter > halfWidth) {
        // Push car back onto the track edge
        const pushDir = pos2D.clone().sub(closestPt2D).normalize();
        const overlap = distFromCenter - halfWidth;
        physics.position.x -= pushDir.x * (overlap + 0.1);
        physics.position.z -= pushDir.y * (overlap + 0.1);

        // Kill velocity component going into the wall
        const wallNormal = new THREE.Vector3(-pushDir.x, 0, -pushDir.y);
        const velDotNormal = vel.dot(wallNormal);
        if (velDotNormal < 0) {
          // Cancel out-of-bounds velocity, keep ~20% as bounce
          physics.speed *= 0.45;
          physics.lateralVel *= 0.4;
        }
      }
    }

    // ── Mesh update ──
    this.carGroup.position.copy(physics.position);
    this.carGroup.rotation.y = physics.heading;

    // Wheel spin
    const wheelRot = physics.speed * dt * 1.4;
    this.wheels.forEach(w => { w.rotation.x += wheelRot; });

    // Body roll & pitch
    this.carBodyMesh.rotation.z = THREE.MathUtils.lerp(
      this.carBodyMesh.rotation.z,
      steerInput * speedRatio * -0.08,
      0.12
    );
    this.carBodyMesh.rotation.x = THREE.MathUtils.lerp(
      this.carBodyMesh.rotation.x,
      (input.forward ? -1 : input.backward ? 1 : 0) * speedRatio * 0.055,
      0.1
    );
  }

  // ─────────────── Progress & Checkpoints ───────────────

  private checkProgress() {
    if (!this.spline) return;
    const pos2D = new THREE.Vector2(this.physics.position.x, this.physics.position.z);
    const currentT = this.findClosestT(pos2D);

    // ── Checkpoints ──
    const numCp = this.mapConfig.checkpoints.length;
    if (this.lapCheckpointIndex < numCp) {
      const nextCp = this.checkpointStates[this.lapCheckpointIndex];
      if (nextCp && !nextCp.passed) {
        // Check proximity to checkpoint gate
        const cpPos = this.spline.getPoint(nextCp.t);
        const dist = pos2D.distanceTo(new THREE.Vector2(cpPos.x, cpPos.z));
        if (dist < this.mapConfig.trackWidth * 0.9) {
          this.triggerCheckpoint(this.lapCheckpointIndex);
        }
      }
    }

    // ── Lap detection ──
    // We passed the finish line if: we were near end (t>0.88) and now near start (t<0.12)
    const crossedFinish = this.lastCarT > 0.88 && currentT < 0.12;
    if (crossedFinish) {
      const lapTimeMs = performance.now() - this.lapStartMs;
      this.currentLap++;
      this.lapStartMs = performance.now();
      // Reset checkpoints for next lap
      this.lapCheckpointIndex = 0;
      this.resetCheckpoints();

      this.callbacks.onLapComplete?.(this.currentLap, lapTimeMs);
      this.playSound(660, 0.12, 'square', 0.08);
      setTimeout(() => this.playSound(880, 0.2, 'square', 0.08), 100);

      if (this.currentLap >= this.totalLaps) {
        this.finishRace();
        return;
      }
    }

    this.lastCarT = currentT;
  }

  private triggerCheckpoint(index: number) {
    const cp = this.checkpointStates[index];
    if (!cp || cp.passed) return;
    cp.passed = true;
    this.lapCheckpointIndex++;
    this.setCheckpointGlowing(cp, true);

    const splitMs = this.elapsedMs;
    const best = this.bestSplits[index];
    const deltaMs = best != null ? splitMs - best : null;
    const isBest = deltaMs === null || deltaMs < 0;

    if (isBest && deltaMs !== null) {
      this.bestSplits[index] = splitMs;
    } else if (deltaMs === null) {
      this.bestSplits[index] = splitMs;
    }

    this.callbacks.onCheckpoint?.({ index, elapsedMs: splitMs, deltaMs, isBest });

    const beepFreq = 660 + index * 110;
    this.playSound(beepFreq, 0.08, 'sine', 0.07);
  }

  private findClosestT(pos2D: THREE.Vector2): number {
    let minDist = Infinity;
    let bestT = 0;
    const samples = 240;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const pt = this.spline.getPoint(t);
      const d = pos2D.distanceTo(new THREE.Vector2(pt.x, pt.z));
      if (d < minDist) { minDist = d; bestT = t; }
    }
    return bestT;
  }

  private finishRace() {
    this.raceState = 'finished';
    this.timerActive = false;
    this.physics.speed = 0;
    this.physics.lateralVel = 0;

    if (this.elapsedMs < this.bestTotalTime) {
      this.bestTotalTime = this.elapsedMs;
    }

    // Victory fanfare
    const notes = [440, 550, 660, 880];
    notes.forEach((f, i) => setTimeout(() => this.playSound(f, i < 3 ? 0.15 : 0.5, 'sine', 0.09 + i * 0.01), i * 120));

    this.callbacks.onFinish?.(this.elapsedMs);
    this.callbacks.onStateChange?.('finished');
  }

  // ─────────────── Timer ───────────────

  private updateTimer(now: number) {
    if (!this.timerActive) return;
    this.elapsedMs = now - this.startTimeMs;
    this.callbacks.onTimerUpdate?.(this.elapsedMs);
  }

  // ─────────────── Camera ───────────────

  private updateCamera(dt: number) {
    const target = this.physics.position.clone();
    const speedAbs = Math.abs(this.physics.speed);
    const height = 30 + speedAbs * 0.3;
    const behind = 18 + speedAbs * 0.25;
    const lerpSpeed = this.raceState === 'countdown' ? 0.04 : 0.055 + speedAbs * 0.001;

    const offset = new THREE.Vector3(
      -Math.sin(this.physics.heading) * behind,
      height,
      -Math.cos(this.physics.heading) * behind
    );
    this.camera.position.lerp(target.clone().add(offset), lerpSpeed);
    this.camera.lookAt(target.x, 0, target.z);
  }

  // ─────────────── Audio update ───────────────

  private updateAudio() {
    // Engine sound removed
  }

  // ─────────────── Particles ───────────────

  private updateParticles(dt: number, now: number) {
    const drift = Math.abs(this.physics.lateralVel);
    const speed = Math.abs(this.physics.speed);
    if (drift > 3 && speed > 5) {
      this.driftParticleTimer += dt;
      if (this.driftParticleTimer > 0.04) {
        this.driftParticleTimer = 0;
        this.emitSmoke(0xbbbbbb, 1.8, 400);
      }
    } else if (speed > 20) {
      this.driftParticleTimer += dt;
      if (this.driftParticleTimer > 0.1) {
        this.driftParticleTimer = 0;
        this.emitSmoke(0xeeeecc, 1.2, 300);
      }
    }

    this.particles = this.particles.filter(p => {
      const ud = p.userData as { spawnTime: number; lifetime: number; vy: number };
      const age = now - ud.spawnTime;
      if (age > ud.lifetime) { this.scene.remove(p); return false; }
      const mat = p.material as THREE.PointsMaterial;
      mat.opacity = (1 - age / ud.lifetime) * 0.7;
      p.position.y += ud.vy * dt;
      p.position.x += (Math.random() - 0.5) * 0.1;
      p.position.z += (Math.random() - 0.5) * 0.1;
      return true;
    });
  }

  private emitSmoke(color: number, size: number, lifetime: number) {
    const n = 6;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = this.physics.position.x + (Math.random() - 0.5) * 2.5;
      pos[i * 3 + 1] = 0.15;
      pos[i * 3 + 2] = this.physics.position.z + (Math.random() - 0.5) * 2.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.7, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.userData = { spawnTime: performance.now(), lifetime, vy: 1.5 };
    this.scene.add(pts);
    this.particles.push(pts);
  }

  // ─────────────── Public API ───────────────

  /** Instant restart — resets everything and starts a new countdown */
  public restart() {
    this.raceState = 'countdown';
    this.timerActive = false;
    this.elapsedMs = 0;
    this.currentLap = 0;
    this.lapCheckpointIndex = 0;
    // Clear input so car doesn't shoot off
    this.input.forward = false;
    this.input.backward = false;
    this.placeCarAtStart();
    // Clear particles
    this.particles.forEach(p => this.scene.remove(p));
    this.particles = [];
    this.startCountdown();
  }

  public getElapsedMs() { return this.elapsedMs; }
  public getBestTime() { return this.bestTotalTime === Infinity ? null : this.bestTotalTime; }
  public getRaceState() { return this.raceState; }
  public getCurrentLap() { return this.currentLap; }

  // ─────────────── Lifecycle ───────────────

  private onResize = () => {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  public destroy() {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    if (this._keydownHandler) window.removeEventListener('keydown', this._keydownHandler);
    if (this._keyupHandler) window.removeEventListener('keyup', this._keyupHandler);
    try { this.soundCtx?.close(); } catch {}
    this.renderer.dispose();
  }
}
