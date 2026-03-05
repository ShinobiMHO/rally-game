import * as THREE from 'three';
import type { MapConfig, CarConfig, CheckpointSplit, RaceState } from '@/types';

interface PhysicsState {
  position: THREE.Vector3;
  heading: number;
  velHeading: number;
  speed: number;
  lateralVel: number;
}

interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
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
  onCountdown?: (step: number) => void;
  onCheckpoint?: (split: CheckpointSplit) => void;
  onProgressUpdate?: (t: number) => void;
  onFinish?: (totalMs: number) => void;
  onStateChange?: (state: RaceState) => void;
  onSpeedUpdate?: (kmh: number) => void;
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
  private totalLaps = 1;

  private lastCarT = 0;
  private lapStartMs = 0;

  private checkpointStates: CheckpointState[] = [];
  private bestSplits: number[] = [];
  private bestTotalTime: number = Infinity;
  private lapCheckpointIndex = 0;

  private particles: THREE.Points[] = [];
  private dirtParticleTimer = 0;

  // Camera heading — lags behind car, decoupled from car rotation
  private cameraHeading: number = 0;

  // Airborne physics
  private verticalVel: number = 0;
  private isAirborne: boolean = false;

  private soundCtx: AudioContext | null = null;

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

    this.input = { forward: false, backward: false, left: false, right: false, handbrake: false };
    this.initPhysics();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Forest overcast sky
    const skyColor = new THREE.Color(0x7a9a6a);
    this.scene = new THREE.Scene();
    this.scene.background = skyColor;
    this.scene.fog = new THREE.FogExp2(0x889e78, 0.009); // exponential fog — denser at distance

    // Third-person camera — close, low, behind the car
    this.camera = new THREE.PerspectiveCamera(72, canvas.clientWidth / canvas.clientHeight, 0.1, 600);

    this.setupLights();
    this.buildTrack();
    this.buildSpecialSections();
    this.buildEnvironment();
    this.buildCar();
    this.placeCarAtStart();
    this.setupAudio();
    this.bindKeys();
    window.addEventListener('resize', this.onResize);

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
    const roadY = startPt.center.y;
    this.physics.position.set(startPt.center.x, roadY + 0.55, startPt.center.z);
    const angle = Math.atan2(startPt.tangent.x, startPt.tangent.z);
    this.physics.heading = angle;
    this.physics.velHeading = angle;
    this.physics.speed = 0;
    this.physics.lateralVel = 0;
    this.cameraHeading = angle; // sync on start/restart
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
    if (this.countdownTimer >= 1.0) {
      this.countdownTimer -= 1.0;
      this.countdownStep--;
      if (this.countdownStep <= 0) {
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

    // wp = [x, z_world, y_elevation]
    const points3D = wp.map(([x, z, elev = 0]) =>
      new THREE.Vector3(x - center.x, elev, z - center.y)
    );
    this.spline = new THREE.CatmullRomCurve3(points3D, false, 'catmullrom', 0.5);

    const divisions = wp.length * 28;
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
      // Normal stays horizontal (roads don't bank — simplification)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const left = pt.clone().add(normal.clone().multiplyScalar(hw));
      const right = pt.clone().sub(normal.clone().multiplyScalar(hw));
      // Keep left/right at road Y (no banking)
      left.y = pt.y;
      right.y = pt.y;
      this.trackPoints.push({ center: pt.clone(), tangent, left, right });
      vertices.push(left.x, pt.y + 0.02, left.z, right.x, pt.y + 0.02, right.z);
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

    // Dirt road texture — mix of two tones
    const mat = new THREE.MeshLambertMaterial({ color: this.mapConfig.roadColor });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.scene.add(road);

    // Dirt tyre tracks (darker strips on road center)
    this.buildTyreTracks(divisions);
    this.buildStartFinishLine();
    this.buildBarriers();
    this.buildCheckpoints();
  }

  private computeCenter(wp: [number, number, number][]): { x: number; y: number } {
    let sx = 0, sy = 0;
    for (const [x, z] of wp) { sx += x; sy += z; }
    return { x: sx / wp.length, y: sy / wp.length };
  }

  private buildTyreTracks(divisions: number) {
    // Two dark tyre marks along the road
    const mat = new THREE.MeshBasicMaterial({ color: 0x5a3820, transparent: true, opacity: 0.45 });
    const step = 6;
    for (let i = 0; i < divisions; i += step) {
      const tp = this.trackPoints[i];
      if (!tp) continue;
      const tangent = tp.tangent;
      const angle = Math.atan2(tangent.x, tangent.z);
      for (const offset of [-3.5, 3.5]) {
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const pos = tp.center.clone().addScaledVector(normal, offset);
        const geo = new THREE.PlaneGeometry(1.0, step * 0.9);
        const dash = new THREE.Mesh(geo, mat);
        dash.rotation.x = -Math.PI / 2;
        dash.rotation.z = angle;
        dash.position.set(pos.x, tp.center.y + 0.03, pos.z);
        this.scene.add(dash);
      }
    }
  }

  private buildStartFinishLine() {
    const hw = this.mapConfig.trackWidth;

    // ── START LINE (green banner) ──
    const startTp = this.trackPoints[0];
    const sy = startTp.center.y;
    const startAngle = Math.atan2(startTp.tangent.x, startTp.tangent.z);
    const startMat = new THREE.MeshBasicMaterial({ color: 0x00cc44 });
    const startLine = new THREE.Mesh(new THREE.PlaneGeometry(hw, 1.5), startMat);
    startLine.rotation.x = -Math.PI / 2;
    startLine.rotation.z = startAngle;
    startLine.position.set(startTp.center.x, sy + 0.03, startTp.center.z);
    this.scene.add(startLine);

    // Start arch
    const archMat = new THREE.MeshLambertMaterial({ color: 0x00aa33 });
    const perp0 = new THREE.Vector3(Math.cos(startAngle), 0, Math.sin(startAngle));
    const sL = startTp.center.clone().addScaledVector(perp0, hw / 2 + 0.5);
    const sR = startTp.center.clone().addScaledVector(perp0, -hw / 2 - 0.5);
    for (const pos of [sL, sR]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), archMat);
      post.position.set(pos.x, sy + 2.5, pos.z);
      this.scene.add(post);
    }
    const startBeam = new THREE.Mesh(new THREE.BoxGeometry(hw + 1.5, 0.5, 0.5), archMat);
    startBeam.position.set(startTp.center.x, sy + 5, startTp.center.z);
    startBeam.rotation.y = startAngle;
    this.scene.add(startBeam);

    // ── FINISH LINE ──
    const finishTp = this.trackPoints[this.trackPoints.length - 1];
    const fy = finishTp.center.y;
    const finishAngle = Math.atan2(finishTp.tangent.x, finishTp.tangent.z);

    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(hw, 2.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    base.rotation.x = -Math.PI / 2;
    base.rotation.z = finishAngle;
    base.position.set(finishTp.center.x, fy + 0.03, finishTp.center.z);
    this.scene.add(base);

    const n = 8;
    const cw = hw / n;
    for (let i = 0; i < n; i++) {
      if (i % 2 !== 0) continue;
      const c = new THREE.Mesh(
        new THREE.PlaneGeometry(cw, 2.5),
        new THREE.MeshBasicMaterial({ color: 0x111111 })
      );
      c.rotation.x = -Math.PI / 2;
      c.rotation.z = finishAngle;
      const perpA = finishAngle + Math.PI / 2;
      const off = (i - n / 2 + 0.5) * cw;
      c.position.set(
        finishTp.center.x + Math.cos(perpA) * off,
        fy + 0.04,
        finishTp.center.z + Math.sin(perpA) * off
      );
      this.scene.add(c);
    }

    // Finish gantry (red)
    const gMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
    const gRedMat = new THREE.MeshLambertMaterial({ color: 0xff2222 });
    const height = 6;
    const perp = new THREE.Vector3(Math.cos(finishAngle), 0, Math.sin(finishAngle));
    const fL = finishTp.center.clone().addScaledVector(perp, hw / 2 + 0.5);
    const fR = finishTp.center.clone().addScaledVector(perp, -hw / 2 - 0.5);
    for (const pos of [fL, fR]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, height, 0.5), gMat);
      post.position.set(pos.x, fy + height / 2, pos.z);
      post.castShadow = true;
      this.scene.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw + 1.5, 0.5, 0.5), gRedMat);
    beam.position.set(finishTp.center.x, fy + height, finishTp.center.z);
    beam.rotation.y = finishAngle;
    this.scene.add(beam);
  }

  private buildBarriers() {
    // Wooden log barriers at road edges
    const step = 5;
    const logMat = new THREE.MeshLambertMaterial({ color: 0x7a5228 });
    const darkLogMat = new THREE.MeshLambertMaterial({ color: 0x4a3018 });

    for (let i = 0; i < this.trackPoints.length - 1; i += step) {
      const tp = this.trackPoints[i];
      const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
      const alternate = Math.floor(i / step) % 3 !== 0;

      for (const side of [tp.left, tp.right]) {
        const logGeo = new THREE.CylinderGeometry(0.22, 0.25, step * 0.95, 6);
        const log = new THREE.Mesh(logGeo, alternate ? logMat : darkLogMat);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = angle;
        log.position.set(side.x, side.y + 0.28, side.z);
        log.castShadow = true;
        this.scene.add(log);

        if (Math.floor(i / step) % 2 === 0) {
          const stakeGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.9, 5);
          const stake = new THREE.Mesh(stakeGeo, darkLogMat);
          stake.position.set(side.x, side.y + 0.45, side.z);
          this.scene.add(stake);
        }
      }
    }
  }

  // ─────────────── Special Sections: Bridge / Jump / Tunnel ───────────────

  private buildSpecialSections() {
    this.buildBridge();
    this.buildJumpRamp();
    this.buildTunnel();
  }

  private buildBridge() {
    // For all track points where y > 9 → add bridge structure below
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x909090 }); // concrete
    const railMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const hw = this.mapConfig.trackWidth / 2;

    for (let i = 0; i < this.trackPoints.length; i += 4) {
      const tp = this.trackPoints[i];
      if (tp.center.y < 9) continue;

      const angle = Math.atan2(tp.tangent.x, tp.tangent.z);

      // Support pillars — one pair every 4 track divisions
      const pillarH = tp.center.y; // from ground (y=0) to road
      if (pillarH < 1) continue;

      const perp = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      for (const sign of [-1, 1]) {
        const pos = tp.center.clone().addScaledVector(perp, sign * (hw - 1));
        const pillar = new THREE.Mesh(
          new THREE.BoxGeometry(1.0, pillarH, 1.0),
          pillarMat
        );
        pillar.position.set(pos.x, pillarH / 2, pos.z);
        pillar.castShadow = true;
        this.scene.add(pillar);
      }

      // Guardrail on bridge
      for (const sign of [-1, 1]) {
        const pos = tp.left.clone().addScaledVector(perp.clone().multiplyScalar(sign * 0), 0);
        const sidePos = sign > 0 ? tp.left : tp.right;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 3.2), railMat);
        rail.position.set(sidePos.x, tp.center.y + 0.6, sidePos.z);
        rail.rotation.y = angle;
        this.scene.add(rail);
      }
    }

    // River / valley below bridge
    const waterMat = new THREE.MeshLambertMaterial({ color: 0x2a6a9a, transparent: true, opacity: 0.85 });
    for (let i = 0; i < this.trackPoints.length; i++) {
      const tp = this.trackPoints[i];
      if (tp.center.y < 10 || i % 8 !== 0) continue;
      const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(40, 8), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.rotation.z = angle;
      water.position.set(tp.center.x, 1.5, tp.center.z);
      this.scene.add(water);
    }
  }

  private buildJumpRamp() {
    // Find the highest point on the track, add a ramp before it
    let maxY = 0, maxIdx = 0;
    for (let i = 0; i < this.trackPoints.length; i++) {
      if (this.trackPoints[i].center.y > maxY) {
        maxY = this.trackPoints[i].center.y;
        maxIdx = i;
      }
    }
    if (maxIdx < 2) return;

    const tp = this.trackPoints[maxIdx];
    const tpBefore = this.trackPoints[Math.max(0, maxIdx - 8)];
    const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
    const hw = this.mapConfig.trackWidth;

    // Ramp surface — slanted box
    const rampMat = new THREE.MeshLambertMaterial({ color: 0x6a4820 }); // wood ramp
    const rampLen = 14;
    const rampH = tp.center.y - tpBefore.center.y;
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(hw + 2, 0.5, rampLen), rampMat);
    ramp.position.set(tp.center.x, tp.center.y - 0.5, tp.center.z - rampLen * 0.3);
    ramp.rotation.y = angle;
    ramp.castShadow = true;
    this.scene.add(ramp);

    // Red/white warning stripes on ramp edge
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(hw + 2, 0.55, 0.8), stripeMat);
    stripe.position.set(tp.center.x, tp.center.y + 0.05, tp.center.z);
    stripe.rotation.y = angle;
    this.scene.add(stripe);

    // Arrow signs pointing up before the jump
    const signMat = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
    for (const sign of [-1, 1]) {
      const perp = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const pos = tp.center.clone().addScaledVector(perp, sign * (hw / 2 - 1));
      const signPost = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, 0.2), signMat);
      signPost.position.set(pos.x, tp.center.y + 1.25, pos.z);
      this.scene.add(signPost);
      const arrow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.15), signMat);
      arrow.position.set(pos.x, tp.center.y + 2.5, pos.z);
      this.scene.add(arrow);
    }
  }

  private buildTunnel() {
    // Build tunnel arches from t=0.75 to t=0.92
    const tStart = 0.75;
    const tEnd = 0.91;
    const totalPts = this.trackPoints.length;
    const idxStart = Math.floor(tStart * totalPts);
    const idxEnd = Math.floor(tEnd * totalPts);
    const hw = this.mapConfig.trackWidth / 2 + 1.5;
    const tunnelH = 6.5;
    const step = 6; // arch every N points

    const concreteMat = new THREE.MeshLambertMaterial({ color: 0x707070 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });

    // Tunnel entrance portal
    this.buildTunnelPortal(this.trackPoints[idxStart], hw, tunnelH, concreteMat, 'ENTRÉE');
    // Tunnel exit portal
    this.buildTunnelPortal(this.trackPoints[idxEnd], hw, tunnelH, concreteMat, 'SORTIE');

    for (let i = idxStart; i <= idxEnd; i += step) {
      const tp = this.trackPoints[i];
      if (!tp) continue;
      const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
      const cy = tp.center.y;

      // Left wall
      const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.7, tunnelH, step * 0.88), concreteMat);
      leftWall.position.set(tp.left.x, cy + tunnelH / 2, tp.left.z);
      leftWall.rotation.y = angle;
      leftWall.castShadow = true;
      this.scene.add(leftWall);

      // Right wall
      const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.7, tunnelH, step * 0.88), concreteMat);
      rightWall.position.set(tp.right.x, cy + tunnelH / 2, tp.right.z);
      rightWall.rotation.y = angle;
      rightWall.castShadow = true;
      this.scene.add(rightWall);

      // Ceiling
      const ceilGrp = new THREE.Group();
      ceilGrp.rotation.y = angle;
      ceilGrp.position.set(tp.center.x, cy + tunnelH, tp.center.z);
      const ceil = new THREE.Mesh(new THREE.BoxGeometry(this.mapConfig.trackWidth + 2, 0.7, step * 0.88), darkMat);
      ceilGrp.add(ceil);
      this.scene.add(ceilGrp);

      // Tunnel lights (every other arch)
      if (i % (step * 2) === idxStart % (step * 2)) {
        const light = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.18), lightMat);
        light.position.set(tp.center.x, cy + tunnelH - 0.6, tp.center.z);
        this.scene.add(light);
      }
    }
  }

  private buildTunnelPortal(tp: TrackPoint, hw: number, tunnelH: number, mat: THREE.MeshLambertMaterial, label: string) {
    const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
    const cy = tp.center.y;
    const perp = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));

    // Left pillar
    const lPos = tp.center.clone().addScaledVector(perp, -(hw));
    const lpillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, tunnelH + 1, 1.2), mat);
    lpillar.position.set(lPos.x, cy + (tunnelH + 1) / 2, lPos.z);
    this.scene.add(lpillar);

    // Right pillar
    const rPos = tp.center.clone().addScaledVector(perp, hw);
    const rpillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, tunnelH + 1, 1.2), mat);
    rpillar.position.set(rPos.x, cy + (tunnelH + 1) / 2, rPos.z);
    this.scene.add(rpillar);

    // Top beam
    const beamGrp = new THREE.Group();
    beamGrp.rotation.y = angle;
    beamGrp.position.set(tp.center.x, cy + tunnelH + 1, tp.center.z);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 2.5, 1.2, 1.2), mat);
    beamGrp.add(beam);
    this.scene.add(beamGrp);
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
    const postMat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: glowing ? 0.9 : 0.8 });
    const stripMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: glowing ? 0.8 : 0.35, side: THREE.DoubleSide });
    const postH = 5.5;
    const cy = tp.center.y;

    // Perpendicular direction (across the road)
    const perp = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));

    // Posts — simple vertical cylinders at each road edge
    for (const sign of [-1, 1]) {
      const pos = tp.center.clone().addScaledVector(perp, sign * (hw / 2 + 0.5));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, postH, 7), postMat);
      post.position.set(pos.x, cy + postH / 2, pos.z);
      group.add(post);
    }

    // Beam — BoxGeometry avoids Euler rotation issues
    // Oriented along perp direction (across track), rotated Y = angle
    const beamGrp = new THREE.Group();
    beamGrp.position.set(tp.center.x, cy + postH, tp.center.z);
    beamGrp.rotation.y = angle;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw + 2, 0.38, 0.38), postMat);
    beamGrp.add(beam);
    group.add(beamGrp);

    // Ground strip — flat plane aligned with road direction
    const stripGrp = new THREE.Group();
    stripGrp.position.set(tp.center.x, cy + 0.06, tp.center.z);
    stripGrp.rotation.y = angle + Math.PI / 2; // rotate so strip goes across track
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(hw, 1.8), stripMat);
    strip.rotation.x = -Math.PI / 2;
    stripGrp.add(strip);
    group.add(stripGrp);

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
    const rng = this.seededRng(42);

    // ── Terrain with rolling hills ──
    this.buildTerrain(rng);

    // ── Dense forest: 350 trees, packed on both sides ──
    const treeMat1 = new THREE.MeshLambertMaterial({ color: this.mapConfig.treeColor });
    const treeMat2 = new THREE.MeshLambertMaterial({ color: 0x2a6b10 });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1a });

    for (let i = 0; i < 350; i++) {
      const x = (rng() - 0.5) * 600;
      const z = (rng() - 0.5) * 650;
      const pos = new THREE.Vector3(x, 0, z);

      let minDist = Infinity;
      let roadY = 0;
      for (const tp of this.trackPoints) {
        const d = new THREE.Vector2(x, z).distanceTo(new THREE.Vector2(tp.center.x, tp.center.z));
        if (d < minDist) { minDist = d; roadY = tp.center.y; }
      }
      if (minDist < this.mapConfig.trackWidth * 1.8) continue;

      const treeY = this.getTerrainY(x, z);
      const h = 6 + rng() * 10;
      const r = 2.0 + rng() * 3.0;
      const sides = Math.floor(4 + rng() * 3);
      const mat = rng() > 0.45 ? treeMat1 : treeMat2;

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, h * 0.4, 5), trunkMat);
      trunk.position.y = h * 0.2;
      trunk.castShadow = true;

      const crown1 = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.7, sides), mat);
      crown1.position.y = h * 0.55;
      crown1.castShadow = true;

      const crown2 = new THREE.Mesh(new THREE.ConeGeometry(r * 0.68, h * 0.5, sides), mat);
      crown2.position.y = h * 0.7;

      const crown3 = new THREE.Mesh(new THREE.ConeGeometry(r * 0.38, h * 0.32, sides), mat);
      crown3.position.y = h * 0.82;

      const tree = new THREE.Group();
      tree.add(trunk, crown1, crown2, crown3);
      tree.position.set(x, treeY, z);
      tree.rotation.y = rng() * Math.PI * 2;
      this.scene.add(tree);
    }

    // ── Undergrowth / bushes — close to track edges ──
    const bushMat = new THREE.MeshLambertMaterial({ color: 0x2d5e0e });
    const bushMat2 = new THREE.MeshLambertMaterial({ color: 0x3a6e14 });
    for (let i = 0; i < 200; i++) {
      const x = (rng() - 0.5) * 500;
      const z = (rng() - 0.5) * 550;
      let minDist = Infinity;
      for (const tp of this.trackPoints) {
        const d = new THREE.Vector2(x, z).distanceTo(new THREE.Vector2(tp.center.x, tp.center.z));
        if (d < minDist) minDist = d;
      }
      // Bushes tight to road edges
      if (minDist < this.mapConfig.trackWidth || minDist > this.mapConfig.trackWidth * 5) continue;

      const tY = this.getTerrainY(x, z);
      const r = 0.7 + rng() * 1.5;
      const bush = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 4), rng() > 0.5 ? bushMat : bushMat2);
      bush.position.set(x, tY + r * 0.45, z);
      bush.scale.y = 0.6;
      this.scene.add(bush);
    }

    // ── Lakes ──
    this.buildLakes(rng);

    // ── Rocks ──
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x6f6a60 });
    for (let i = 0; i < 70; i++) {
      const x = (rng() - 0.5) * 450;
      const z = (rng() - 0.5) * 500;
      let tooClose = false;
      for (const tp of this.trackPoints) {
        if (new THREE.Vector2(x, z).distanceTo(new THREE.Vector2(tp.center.x, tp.center.z)) < this.mapConfig.trackWidth * 1.5) {
          tooClose = true; break;
        }
      }
      if (tooClose) continue;
      const tY = this.getTerrainY(x, z);
      const s = 0.4 + rng() * 2.2;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.position.set(x, tY + s * 0.3, z);
      rock.rotation.set(rng(), rng(), rng());
      rock.castShadow = true;
      this.scene.add(rock);
    }
  }

  // Simple sine-wave terrain height — smooth rolling hills
  private getTerrainY(x: number, z: number): number {
    return Math.sin(x * 0.028) * Math.cos(z * 0.022) * 4.5
         + Math.sin(x * 0.07 + z * 0.05) * 1.8
         + Math.sin(z * 0.018) * 3.5;
  }

  private buildTerrain(rng: () => number) {
    const size = 800;
    const segs = 70;
    const groundGeo = new THREE.PlaneGeometry(size, size, segs, segs);
    groundGeo.rotateX(-Math.PI / 2);

    const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);

      // Distance to nearest track point
      let minDist = Infinity;
      let nearestRoadY = 0;
      for (const tp of this.trackPoints) {
        const d = Math.sqrt((x - tp.center.x) ** 2 + (z - tp.center.z) ** 2);
        if (d < minDist) { minDist = d; nearestRoadY = tp.center.y; }
      }

      const hw = this.mapConfig.trackWidth;
      if (minDist < hw * 1.1) {
        // Stay flat at road level near the track
        posAttr.setY(i, nearestRoadY);
      } else {
        // Rolling hills away from road
        const terrainH = this.getTerrainY(x, z);
        // Blend from road level to terrain over 1.1–3× track width
        const blend = Math.min((minDist - hw * 1.1) / (hw * 2), 1.0);
        posAttr.setY(i, nearestRoadY * (1 - blend) + terrainH * blend);
      }
    }
    groundGeo.computeVertexNormals();

    const groundMat = new THREE.MeshLambertMaterial({ color: this.mapConfig.groundColor });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private buildLakes(rng: () => number) {
    // 3 lakes at fixed positions well away from track
    const lakeDefs = [
      { x: -65, z: 80,  rx: 28, rz: 18, y: 0.5 },
      { x: 75,  z: 215, rx: 22, rz: 32, y: 5 },
      { x: -55, z: 320, rx: 20, rz: 14, y: 2 },
    ];

    const waterMat = new THREE.MeshLambertMaterial({
      color: 0x2a6a9a, transparent: true, opacity: 0.88,
    });
    const shoreMat = new THREE.MeshLambertMaterial({ color: 0x4a7a2a });

    for (const lk of lakeDefs) {
      // Check not too close to track
      let tooClose = false;
      for (const tp of this.trackPoints) {
        const dx = tp.center.x - lk.x;
        const dz = tp.center.z - lk.z;
        if (Math.sqrt(dx * dx + dz * dz) < this.mapConfig.trackWidth * 2 + Math.max(lk.rx, lk.rz)) {
          tooClose = true; break;
        }
      }
      if (tooClose) continue;

      // Shore ring (slightly larger)
      const shoreGeo = new THREE.CircleGeometry(1, 20);
      const shore = new THREE.Mesh(shoreGeo, shoreMat);
      shore.rotation.x = -Math.PI / 2;
      shore.scale.set(lk.rx + 4, 1, lk.rz + 4);
      shore.position.set(lk.x, lk.y - 0.1, lk.z);
      this.scene.add(shore);

      // Water surface
      const lakeGeo = new THREE.CircleGeometry(1, 20);
      const lake = new THREE.Mesh(lakeGeo, waterMat);
      lake.rotation.x = -Math.PI / 2;
      lake.scale.set(lk.rx, 1, lk.rz);
      lake.position.set(lk.x, lk.y + 0.08, lk.z);
      this.scene.add(lake);

      // Reeds around lake edge
      const reedMat = new THREE.MeshLambertMaterial({ color: 0x7a9a30 });
      for (let r = 0; r < 16; r++) {
        const angle = (r / 16) * Math.PI * 2 + (rng() - 0.5) * 0.4;
        const ex = lk.x + Math.cos(angle) * (lk.rx + 2 + rng() * 3);
        const ez = lk.z + Math.sin(angle) * (lk.rz + 2 + rng() * 3);
        const reedH = 1.5 + rng() * 1.2;
        const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, reedH, 4), reedMat);
        reed.position.set(ex, lk.y + reedH / 2, ez);
        reed.rotation.z = (rng() - 0.5) * 0.3;
        this.scene.add(reed);
      }
    }
  }

  private seededRng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  }

  // ─────────────── WRC Rally Car ───────────────

  private buildCar() {
    this.carGroup = new THREE.Group();

    const white = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
    const blue = new THREE.MeshLambertMaterial({ color: 0x003399 });
    const red = new THREE.MeshLambertMaterial({ color: 0xcc1111 });
    const black = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const darkGrey = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const winMat = new THREE.MeshLambertMaterial({ color: 0x88ccff, transparent: true, opacity: 0.75 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfffaaa });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });

    // ── Main body — wide & low ──
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.58, 4.1), white);
    body.position.y = 0.42;
    body.castShadow = true;
    this.carGroup.add(body);
    this.carBodyMesh = body;

    // Blue hood stripe (wide stripe down center)
    const hoodStripe = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.01, 1.7), blue);
    hoodStripe.position.set(0, 0.72, 0.95);
    this.carGroup.add(hoodStripe);

    // Red front bumper
    const frontBump = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.32, 0.22), red);
    frontBump.position.set(0, 0.28, 2.18);
    this.carGroup.add(frontBump);

    // Red rear bumper
    const rearBump = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.32, 0.22), red);
    rearBump.position.set(0, 0.28, -2.18);
    this.carGroup.add(rearBump);

    // Front splitter
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 0.35), black);
    splitter.position.set(0, 0.08, 2.25);
    this.carGroup.add(splitter);

    // Front air duct / intake
    const duct = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.15), black);
    duct.position.set(0, 0.38, 2.26);
    this.carGroup.add(duct);

    // Fender flares (wider lower body)
    for (const sx of [-1, 1]) {
      const flare = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, 1.5), white);
      flare.position.set(sx * 1.29, 0.32, 0.3);
      flare.castShadow = true;
      this.carGroup.add(flare);
    }

    // ── Cabin ──
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.52, 1.8), white);
    cabin.position.set(0, 1.0, -0.1);
    cabin.castShadow = true;
    this.carGroup.add(cabin);

    // Blue roof stripe
    const roofStripe = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.01, 1.78), blue);
    roofStripe.position.set(0, 1.27, -0.1);
    this.carGroup.add(roofStripe);

    // Windshield
    const fWin = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.52), winMat);
    fWin.position.set(0, 1.03, 0.82);
    fWin.rotation.x = -0.42;
    this.carGroup.add(fWin);

    // Rear window
    const rWin = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.52), winMat);
    rWin.position.set(0, 1.03, -1.02);
    rWin.rotation.x = 0.42;
    this.carGroup.add(rWin);

    // Side windows
    for (const sx of [-1, 1]) {
      const sWin = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.42), winMat);
      sWin.position.set(sx * 0.86, 1.03, -0.1);
      sWin.rotation.y = sx * Math.PI / 2;
      this.carGroup.add(sWin);
    }

    // ── Rear wing — big WRC style ──
    for (const sx of [-0.72, 0.72]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), darkGrey);
      post.position.set(sx, 1.05, -1.85);
      this.carGroup.add(post);
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.62), blue);
    wing.position.set(0, 1.35, -1.85);
    wing.castShadow = true;
    this.carGroup.add(wing);
    // Wing end plates
    for (const sx of [-1, 1]) {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.64), blue);
      ep.position.set(sx * 1.0, 1.3, -1.85);
      this.carGroup.add(ep);
    }

    // Roof vent / air intake
    const roofVent = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.8), blue);
    roofVent.position.set(0, 1.37, 0.1);
    this.carGroup.add(roofVent);

    // ── Lights ──
    const lgeo = new THREE.BoxGeometry(0.5, 0.18, 0.08);
    for (const sx of [-0.7, 0.7]) {
      // Headlights (pair per side)
      const hl = new THREE.Mesh(lgeo, lightMat);
      hl.position.set(sx, 0.45, 2.18);
      this.carGroup.add(hl);
      // Fog light (round)
      const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), lightMat);
      fog.rotation.x = Math.PI / 2;
      fog.position.set(sx * 0.6, 0.22, 2.24);
      this.carGroup.add(fog);
      // Tail lights
      const tl = new THREE.Mesh(lgeo, tailMat);
      tl.position.set(sx, 0.45, -2.18);
      this.carGroup.add(tl);
    }

    // Race number plate on roof/doors
    const plateMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const plateNum = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.02), plateMat);
    plateNum.position.set(0, 1.28, 1.76);
    this.carGroup.add(plateNum);

    // ── Wheels — low-profile rally tires ──
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.36, 10);
    const hubMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
    const spokeGeo = new THREE.BoxGeometry(0.06, 0.3, 0.34);

    const wheelPositions = [
      [1.15, 0.38,  1.38],
      [-1.15, 0.38,  1.38],
      [1.15, 0.38, -1.38],
      [-1.15, 0.38, -1.38],
    ];
    this.wheels = [];

    for (const [wx, wy, wz] of wheelPositions) {
      const wGroup = new THREE.Group();

      const tire = new THREE.Mesh(wheelGeo, black);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      wGroup.add(tire);

      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.38, 5), hubMat);
      hub.rotation.z = Math.PI / 2;
      wGroup.add(hub);

      // Spokes
      for (let s = 0; s < 5; s++) {
        const spoke = new THREE.Mesh(spokeGeo, hubMat);
        spoke.rotation.x = (s / 5) * Math.PI * 2;
        spoke.position.x = 0;
        spoke.position.y = Math.cos((s / 5) * Math.PI * 2) * 0.12;
        spoke.position.z = Math.sin((s / 5) * Math.PI * 2) * 0.12;
        hub.add(spoke);
      }

      wGroup.position.set(wx, wy, wz);
      this.carGroup.add(wGroup);
      this.wheels.push(tire);
    }

    this.scene.add(this.carGroup);
  }

  // ─────────────── Lights ───────────────

  private setupLights() {
    // Forest ambient — green-tinted
    this.scene.add(new THREE.AmbientLight(0xaac890, 0.65));

    // Sun — diffused through canopy
    const sun = new THREE.DirectionalLight(0xe0eecc, 1.0);
    sun.position.set(35, 90, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -220;
    sun.shadow.camera.right = sun.shadow.camera.top = 220;
    this.scene.add(sun);

    // Cool fill from sky
    const fill = new THREE.DirectionalLight(0x7a9e78, 0.4);
    fill.position.set(-40, 25, -40);
    this.scene.add(fill);
  }

  // ─────────────── Audio ───────────────

  private setupAudio() {
    try {
      this.soundCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {}
  }

  public resumeAudio() {
    this.soundCtx?.resume();
  }

  private playBeep(step: number) {
    this.playSound(440, 0.15, 'square', 0.08);
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
      if (k === ' ') this.input.handbrake = true;
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'arrowup') this.input.forward = false;
      if (k === 's' || k === 'arrowdown') this.input.backward = false;
      if (k === 'q' || k === 'arrowleft') this.input.left = false;
      if (k === 'd' || k === 'arrowright') this.input.right = false;
      if (k === ' ') this.input.handbrake = false;
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
      return;
    }
    if (this.raceState === 'finished') {
      this.updateCamera(dt);
      return;
    }
    this.updatePhysics(dt);
    this.updateCamera(dt);
    this.updateParticles(dt, now);
    this.updateTimer(now);
    this.checkProgress();
    // Speed in km/h (game units × ~4.5 to feel like real km/h)
    this.callbacks.onSpeedUpdate?.(Math.abs(this.physics.speed) * 4.5);
  }

  // ─────────────── Physics ───────────────

  private updatePhysics(dt: number) {
    const { carConfig, input, physics } = this;

    const speedBoost = 0.9 + (carConfig.speed - 1) * 0.18;
    const handlingBoost = 0.7 + (carConfig.handling - 1) * 0.16;
    const maxSpeed = 24 * speedBoost;   // top speed réduit
    const accel = 13 * speedBoost;      // accélération bien plus progressive
    const brakeForce = 44;
    const rollFriction = 5;
    const steerMax = 2.2 * handlingBoost;
    const lateralGrip = 2.5 + (carConfig.handling - 1) * 0.5;
    const driftAccum = 6 + (5 - carConfig.handling) * 1.2;

    const speedRatio = Math.abs(physics.speed) / maxSpeed;

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

    const steerCurve = speedRatio > 0.05
      ? steerMax * Math.min(speedRatio * 3, 1) * (1 - speedRatio * 0.25)
      : 0;
    let steerInput = 0;
    if (input.left) steerInput = 1;
    if (input.right) steerInput = -1;

    const steerDir = physics.speed >= 0 ? 1 : -1;
    physics.heading += steerInput * steerCurve * steerDir * dt;

    const isBraking = input.backward && physics.speed > 3;
    const isHandbrake = input.handbrake && speedRatio > 0.15;

    let driftMultiplier = 1.0;
    let effectiveLateralGrip = lateralGrip;

    if (isHandbrake) {
      driftMultiplier = 6.0;
      effectiveLateralGrip = lateralGrip * 0.05;
      if (steerInput !== 0) {
        physics.lateralVel += -steerInput * 18 * speedRatio * dt;
      }
      physics.speed *= 1 - 0.6 * dt;
    } else if (isBraking) {
      driftMultiplier = 3.5;
      effectiveLateralGrip = lateralGrip * 0.3;
      if (steerInput !== 0 && speedRatio > 0.3) {
        physics.lateralVel += -steerInput * 4.0 * speedRatio * dt;
      }
    }

    if (steerInput !== 0 && speedRatio > 0.2) {
      physics.lateralVel += -steerInput * driftAccum * driftMultiplier * speedRatio * dt;
    }

    physics.lateralVel = THREE.MathUtils.lerp(physics.lateralVel, 0, effectiveLateralGrip * dt);
    const maxLateral = maxSpeed * 0.75;
    physics.lateralVel = THREE.MathUtils.clamp(physics.lateralVel, -maxLateral, maxLateral);

    // ── Cornering drag — très sensible, perte de vitesse réelle en virage ──
    if (Math.abs(steerInput) > 0.05 && speedRatio > 0.05) {
      // Drag quadratique : plus on va vite + plus on braque, plus on freine
      const cornerDrag = Math.abs(steerInput) * speedRatio * speedRatio * 22;
      physics.speed -= Math.sign(physics.speed) * cornerDrag * dt;
    }

    // ── Lateral scrub scrubs forward speed too ──
    const lateralScrub = Math.abs(physics.lateralVel) * 0.18;
    physics.speed -= Math.sign(physics.speed) * lateralScrub * dt;

    const fwd = new THREE.Vector3(Math.sin(physics.heading), 0, Math.cos(physics.heading));
    const right = new THREE.Vector3(Math.cos(physics.heading), 0, -Math.sin(physics.heading));
    const vel = fwd.clone().multiplyScalar(physics.speed)
      .addScaledVector(right, physics.lateralVel);

    physics.position.addScaledVector(vel, dt);

    // ── Follow road elevation + airborne physics ──
    if (this.spline) {
      const pos2D = new THREE.Vector2(physics.position.x, physics.position.z);
      const closestT = this.findClosestT(pos2D);
      const closestPt = this.spline.getPoint(closestT);
      const closestPt2D = new THREE.Vector2(closestPt.x, closestPt.z);
      const distFromCenter = pos2D.distanceTo(closestPt2D);
      const halfWidth = this.mapConfig.trackWidth * 0.5;
      const targetY = closestPt.y + 0.52;

      if (this.isAirborne) {
        // ── En l'air : gravité ──
        this.verticalVel -= 30 * dt;
        physics.position.y += this.verticalVel * dt;

        // Atterrissage
        if (physics.position.y <= targetY) {
          physics.position.y = targetY;
          const impact = Math.abs(this.verticalVel);
          // Perte de vitesse à l'impact proportionnelle à la hauteur de chute
          if (impact > 4) physics.speed *= Math.max(0.65, 1 - impact * 0.028);
          this.verticalVel = 0;
          this.isAirborne = false;
        }
      } else {
        const prevTargetY = closestPt.y; // road center Y
        // Détecter décollage : route qui chute brusquement devant la voiture
        const yDrop = prevTargetY - (physics.position.y - 0.52);
        if (yDrop < -3.0 && Math.abs(physics.speed) > 10) {
          // Lancé dans l'air !
          this.isAirborne = true;
          this.verticalVel = Math.abs(physics.speed) * 0.14; // élan vertical
        } else {
          physics.position.y = THREE.MathUtils.lerp(physics.position.y, targetY, 0.2);
        }
      }

      // ── Boundary push (sauf en l'air) ──
      if (!this.isAirborne && distFromCenter > halfWidth) {
        const pushDir = pos2D.clone().sub(closestPt2D).normalize();
        const overlap = distFromCenter - halfWidth;
        physics.position.x -= pushDir.x * (overlap + 0.1);
        physics.position.z -= pushDir.y * (overlap + 0.1);
        physics.speed *= 0.45;
        physics.lateralVel *= 0.4;
      }
    }

    // ── Mesh update ──
    this.carGroup.position.copy(physics.position);
    this.carGroup.rotation.y = physics.heading;

    // Wheel spin
    const wheelRot = physics.speed * dt * 1.4;
    this.wheels.forEach(w => { w.rotation.x += wheelRot; });

    // Body roll
    this.carBodyMesh.rotation.z = THREE.MathUtils.lerp(
      this.carBodyMesh.rotation.z,
      steerInput * speedRatio * -0.07,
      0.12
    );
    this.carBodyMesh.rotation.x = THREE.MathUtils.lerp(
      this.carBodyMesh.rotation.x,
      (input.forward ? -1 : input.backward ? 1 : 0) * speedRatio * 0.05,
      0.1
    );
  }

  // ─────────────── Progress & Checkpoints ───────────────

  private checkProgress() {
    if (!this.spline) return;
    const pos2D = new THREE.Vector2(this.physics.position.x, this.physics.position.z);
    const currentT = this.findClosestT(pos2D);

    const numCp = this.mapConfig.checkpoints.length;
    if (this.lapCheckpointIndex < numCp) {
      const nextCp = this.checkpointStates[this.lapCheckpointIndex];
      if (nextCp && !nextCp.passed) {
        const cpPos = this.spline.getPoint(nextCp.t);
        const dist = pos2D.distanceTo(new THREE.Vector2(cpPos.x, cpPos.z));
        if (dist < this.mapConfig.trackWidth * 0.8) {
          this.triggerCheckpoint(this.lapCheckpointIndex);
        }
      }
    }

    // Finish detection: distance to actual finish line point (not t-based)
    const lastTp = this.trackPoints[this.trackPoints.length - 1];
    const distToFinish = pos2D.distanceTo(new THREE.Vector2(lastTp.center.x, lastTp.center.z));
    const reachedEnd = distToFinish < this.mapConfig.trackWidth * 0.75
      && currentT > 0.7   // must have completed majority of stage first
      && this.raceState === 'racing';
    if (reachedEnd) {
      this.finishRace();
      return;
    }

    this.lastCarT = currentT;
    this.callbacks.onProgressUpdate?.(currentT);
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
    const samples = 260;
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

  // ─────────────── Camera — Floating Third Person ───────────────

  private updateCamera(dt: number) {
    const target = this.physics.position.clone();
    const speedAbs = Math.abs(this.physics.speed);

    // Camera heading lags behind car heading — doesn't snap to turns
    const headingLerp = 0.07 + speedAbs * 0.003;
    // Shortest-path angle lerp (avoid ±π wrap glitch)
    let diff = this.physics.heading - this.cameraHeading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.cameraHeading += diff * headingLerp;

    // Camera position: behind & slightly above, based on camera heading
    const height = 3.2 + speedAbs * 0.03;
    const behind = 11 + speedAbs * 0.08;

    const offset = new THREE.Vector3(
      -Math.sin(this.cameraHeading) * behind,
      height,
      -Math.cos(this.cameraHeading) * behind
    );

    // Position lerp is fast so car stays in frame even during big turns
    this.camera.position.lerp(target.clone().add(offset), 0.12);
    // Always look at car (not at camera heading target)
    this.camera.lookAt(target.x, target.y + 1.0, target.z);
  }

  // ─────────────── Particles (dirt spray) ───────────────

  private updateParticles(dt: number, now: number) {
    const drift = Math.abs(this.physics.lateralVel);
    const speed = Math.abs(this.physics.speed);

    if (speed > 4) {
      this.dirtParticleTimer += dt;
      const interval = drift > 3 ? 0.03 : 0.08;
      if (this.dirtParticleTimer > interval) {
        this.dirtParticleTimer = 0;
        // Dirt/mud spray — brown particles
        const color = drift > 3 ? 0x8a5a2a : 0xa07840;
        this.emitDirt(color, 1.5, drift > 3 ? 350 : 250);
      }
    }

    this.particles = this.particles.filter(p => {
      const ud = p.userData as { spawnTime: number; lifetime: number; vy: number };
      const age = now - ud.spawnTime;
      if (age > ud.lifetime) { this.scene.remove(p); return false; }
      const mat = p.material as THREE.PointsMaterial;
      mat.opacity = (1 - age / ud.lifetime) * 0.8;
      p.position.y += ud.vy * dt;
      p.position.x += (Math.random() - 0.5) * 0.15;
      p.position.z += (Math.random() - 0.5) * 0.15;
      return true;
    });
  }

  private emitDirt(color: number, size: number, lifetime: number) {
    const n = 8;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = this.physics.position.x + (Math.random() - 0.5) * 3;
      pos[i * 3 + 1] = this.physics.position.y - 0.3;
      pos[i * 3 + 2] = this.physics.position.z + (Math.random() - 0.5) * 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.8, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.userData = { spawnTime: performance.now(), lifetime, vy: 2.0 };
    this.scene.add(pts);
    this.particles.push(pts);
  }

  // ─────────────── Public API ───────────────

  public restart() {
    this.raceState = 'countdown';
    this.timerActive = false;
    this.elapsedMs = 0;
    this.currentLap = 0;
    this.lapCheckpointIndex = 0;
    this.input.forward = false;
    this.input.backward = false;
    this.isAirborne = false;
    this.verticalVel = 0;
    this.placeCarAtStart();
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
