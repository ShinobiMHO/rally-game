import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect } from 'postprocessing';
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
  private composer!: EffectComposer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private carGroup!: THREE.Group;
  private carBodyMesh!: THREE.Object3D;
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
  private smoothCamTarget: THREE.Vector3 = new THREE.Vector3();

  // Airborne physics
  private verticalVel: number = 0;
  private isAirborne: boolean = false;

  // Skid marks
  private skidMarkMeshes: THREE.Mesh[] = [];
  private readonly MAX_SKIDS = 300;
  private skidTimer = 0;

  // Engine sound
  private soundCtx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain2: GainNode | null = null;

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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Jour ensoleillé — forêt diurne
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // ciel bleu clair
    this.scene.fog = new THREE.FogExp2(0x90c8e0, 0.007);
    this.buildSkyDome();

    // Third-person camera — close, low, behind the car
    this.camera = new THREE.PerspectiveCamera(72, canvas.clientWidth / canvas.clientHeight, 0.1, 600);

    // Post-processing : Bloom + Vignette
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new BloomEffect({ luminanceThreshold: 0.65, luminanceSmoothing: 0.3, intensity: 0.6 });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
    this.composer.addPass(new EffectPass(this.camera, bloom, vignette));

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
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const left  = pt.clone().add(normal.clone().multiplyScalar(hw));
      const right = pt.clone().sub(normal.clone().multiplyScalar(hw));

      // Banking sur la section falaise (y > 20) : mur penché ~30°
      const bankAngle = pt.y > 20 ? Math.min((pt.y - 20) / 8, 1.0) * 3.5 : 0;
      left.y  = pt.y + bankAngle;   // côté montagne plus haut
      right.y = pt.y - bankAngle;   // côté vide plus bas → route inclinée

      this.trackPoints.push({ center: pt.clone(), tangent, left, right });
      vertices.push(left.x, left.y + 0.02, left.z, right.x, right.y + 0.02, right.z);
      uvs.push(0, t * hw * 2, 1, t * hw * 2);
      // Normale inclinée selon le banking
      const bankNorm = new THREE.Vector3(normal.x * Math.sin(bankAngle > 0 ? 0.4 : 0), Math.cos(bankAngle > 0 ? 0.4 : 0), normal.z * Math.sin(bankAngle > 0 ? 0.4 : 0)).normalize();
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

    // Dirt road — texture procédurale
    const roadTex = this.loadTex('/textures/dirt_road.jpg', 3, 25);
    const roadNormal = this.loadTex('/textures/dirt_road_normal.jpg', 3, 25);
    const mat = new THREE.MeshStandardMaterial({ map: roadTex, normalMap: roadNormal, normalScale: new THREE.Vector2(1.5, 1.5), roughness: 0.92, metalness: 0 });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.scene.add(road);

    // Dirt tyre tracks (darker strips on road center)
    this.buildTyreTracks(divisions);
    // buildRoadEdges retiré — trop de draw calls
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
    const mat = new THREE.MeshBasicMaterial({ color: 0x5a3820, transparent: true, opacity: 0.2 });
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

  private buildRoadEdges(divisions: number) {
    // Bordures de terre foncée + herbe au bord de la piste (effet chemin de terre)
    const edgeMat = new THREE.MeshLambertMaterial({ color: 0x1e3a08 });   // herbe sombre
    const muddyMat = new THREE.MeshLambertMaterial({ color: 0x3d2208 });  // terre boueuse
    const hw = this.mapConfig.trackWidth / 2;

    for (let i = 0; i < divisions - 4; i += 3) {
      const tp = this.trackPoints[i];
      const tpNext = this.trackPoints[i + 3];
      if (!tp || !tpNext) continue;

      const tangent = tp.tangent.clone().normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const segLen = tp.center.distanceTo(tpNext.center) * 3.1;

      for (const side of [-1, 1]) {
        // Bande boueuse immédiatement au bord de route (1.0–1.5× hw)
        const muddyOff = hw * 1.25 * side;
        const muddyPos = tp.center.clone().addScaledVector(normal, muddyOff);
        const muddyGeo = new THREE.PlaneGeometry(hw * 0.5, segLen);
        const muddy = new THREE.Mesh(muddyGeo, muddyMat);
        muddy.rotation.x = -Math.PI / 2;
        muddy.rotation.z = Math.atan2(tangent.x, tangent.z);
        muddy.position.set(muddyPos.x, tp.center.y + 0.01, muddyPos.z);
        this.scene.add(muddy);

        // Bande herbe/mousse (1.5–2.5× hw)
        const grassOff = hw * 1.9 * side;
        const grassPos = tp.center.clone().addScaledVector(normal, grassOff);
        const grassGeo = new THREE.PlaneGeometry(hw * 1.0, segLen);
        const grass = new THREE.Mesh(grassGeo, edgeMat);
        grass.rotation.x = -Math.PI / 2;
        grass.rotation.z = Math.atan2(tangent.x, tangent.z);
        grass.position.set(grassPos.x, tp.center.y + 0.01, grassPos.z);
        this.scene.add(grass);
      }
    }
  }

  private buildStartFinishLine() {
    const hw = this.mapConfig.trackWidth;

    // ── START — portique WRC style (orange/blanc) ──
    const startTp = this.trackPoints[0];
    const sy = startTp.center.y;
    const startAngle = Math.atan2(startTp.tangent.x, startTp.tangent.z);

    // Ligne de départ damier blanc/rouge
    const startBaseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const startLine = new THREE.Mesh(new THREE.PlaneGeometry(hw, 2.0), startBaseMat);
    startLine.rotation.x = -Math.PI / 2;
    startLine.rotation.z = startAngle;
    startLine.position.set(startTp.center.x, sy + 0.03, startTp.center.z);
    this.scene.add(startLine);
    const sn = 6;
    const scw = hw / sn;
    for (let ii = 0; ii < sn; ii++) {
      if (ii % 2 !== 0) continue;
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(scw, 2.0),
        new THREE.MeshBasicMaterial({ color: 0xff4400 }));
      sc.rotation.x = -Math.PI / 2;
      sc.rotation.z = startAngle;
      const spa = startAngle + Math.PI / 2;
      const soff = (ii - sn / 2 + 0.5) * scw;
      sc.position.set(startTp.center.x + Math.cos(spa) * soff, sy + 0.04, startTp.center.z + Math.sin(spa) * soff);
      this.scene.add(sc);
    }

    // Portique orange/blanc
    const gateWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.1 });
    const gateOrange = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.5, metalness: 0.05 });
    const perpS = new THREE.Vector3(Math.cos(startAngle), 0, Math.sin(startAngle));
    const sLpos = startTp.center.clone().addScaledVector(perpS, hw / 2 + 1);
    const sRpos = startTp.center.clone().addScaledVector(perpS, -hw / 2 - 1);
    for (const pos of [sLpos, sRpos]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 7, 8), gateOrange);
      post.position.set(pos.x, sy + 3.5, pos.z);
      this.scene.add(post);
    }
    const startBeamTop = new THREE.Mesh(new THREE.BoxGeometry(hw + 3, 0.7, 0.7), gateOrange);
    startBeamTop.position.set(startTp.center.x, sy + 7.1, startTp.center.z);
    startBeamTop.rotation.y = startAngle;
    this.scene.add(startBeamTop);
    const startBanner = new THREE.Mesh(new THREE.BoxGeometry(hw * 0.7, 1.0, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xffdd00 }));
    startBanner.position.set(startTp.center.x, sy + 6.6, startTp.center.z);
    startBanner.rotation.y = startAngle;
    this.scene.add(startBanner);

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
    const gMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.3 });
    const gRedMat = new THREE.MeshStandardMaterial({ color: 0xff2222, roughness: 0.4, metalness: 0.05 });
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
    // Barrières WRC style — piquets rouges/blancs + garde-corps
    const step = 6;
    const postWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.1 });
    const postRed   = new THREE.MeshStandardMaterial({ color: 0xdd1111, roughness: 0.6, metalness: 0.1 });
    const railMat   = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.3 });

    for (let i = 0; i < this.trackPoints.length - 1; i += step) {
      const tp = this.trackPoints[i];
      const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
      const isRed = Math.floor(i / step) % 2 === 0;
      const mat = isRed ? postRed : postWhite;

      for (const side of [tp.left, tp.right]) {
        // Piquet vertical
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.10, 1.1, 6), mat);
        post.position.set(side.x, side.y + 0.55, side.z);
        post.castShadow = true;
        this.scene.add(post);

        // Garde-corps horizontal (rail)
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, step * 0.98, 5), railMat);
        rail.rotation.z = Math.PI / 2;
        rail.rotation.y = angle;
        rail.position.set(side.x, side.y + 0.9, side.z);
        this.scene.add(rail);
      }
    }
  }

  // ─────────────── Special Sections: Bridge / Jump / Tunnel ───────────────

  private buildSpecialSections() {
    this.buildBridge();
    this.buildJumpRamp();
    this.buildTunnel();
    this.buildCave();
    this.buildCliffRoad();
  }

  private buildBridge() {
    // For all track points where y > 9 → add bridge structure below
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x909090, roughness: 0.9, metalness: 0.05 }); // concrete
    const railMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.3, metalness: 0.8 });
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
    const rampMat = new THREE.MeshStandardMaterial({ color: 0x6a4820, roughness: 0.9, metalness: 0 }); // wood ramp
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
    // Tunnel wp 27-29 of 47 → t ≈ 0.555 to 0.607
    const tStart = 0.555;
    const tEnd = 0.610;
    const totalPts = this.trackPoints.length;
    const idxStart = Math.floor(tStart * totalPts);
    const idxEnd = Math.floor(tEnd * totalPts);
    const hw = this.mapConfig.trackWidth / 2 + 1.5;
    const tunnelH = 6.5;
    const step = 6; // arch every N points

    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x707070, roughness: 0.95, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 1.0, metalness: 0 });
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

      // PointLight every ~30 track points inside tunnel
      if ((i - idxStart) % 30 === 0) {
        const tunnelLight = new THREE.PointLight(0xffcc88, 1.5, 35);
        tunnelLight.position.set(tp.center.x, cy + 4, tp.center.z);
        this.scene.add(tunnelLight);
      }
    }
  }

  private buildTunnelPortal(tp: TrackPoint, hw: number, tunnelH: number, mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, label: string) {
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

  // ─── GROTTE (derrière cascade) ─────────────────────────────────────────
  private buildCave() {
    // Détecte les track points sous y < 0 → section grotte
    const cavePoints = this.trackPoints.filter(tp => tp.center.y < -0.8);
    if (cavePoints.length === 0) return;

    const rockTexCave = this.loadTex('/textures/rock.jpg', 1, 1);
    const rockMat  = new THREE.MeshStandardMaterial({ map: rockTexCave, roughness: 0.9, metalness: 0, color: 0x888880 });
    const mossMat  = new THREE.MeshStandardMaterial({ color: 0x1a3a0a, roughness: 1.0, metalness: 0 });
    const hw = this.mapConfig.trackWidth / 2 + 1;

    // Entrée = premier point de la grotte (transition depuis la surface)
    const entryPt = cavePoints[0];

    // ── CASCADE à l'entrée ──
    const waterMat = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    const fallH = 12, fallW = hw * 2.2;
    for (let layer = 0; layer < 3; layer++) {
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(fallW, fallH), waterMat);
      fall.position.set(entryPt.center.x, entryPt.center.y + fallH / 2 + layer * 0.15, entryPt.center.z - 2);
      fall.rotation.y = Math.atan2(entryPt.tangent.x, entryPt.tangent.z);
      this.scene.add(fall);
    }
    // Bassin d'eau en bas de la cascade
    const basinMat = new THREE.MeshBasicMaterial({ color: 0x4488bb, transparent: true, opacity: 0.65 });
    const basin = new THREE.Mesh(new THREE.PlaneGeometry(fallW, 5), basinMat);
    basin.rotation.x = -Math.PI / 2;
    basin.position.set(entryPt.center.x, entryPt.center.y + 0.1, entryPt.center.z - 4);
    this.scene.add(basin);

    // ── PAROIS ROCHEUSES de la grotte ──
    const rngCave = this.seededRng(777);
    for (const tp of cavePoints) {
      const tangent = tp.tangent.clone().normalize();
      const normal  = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const cy = tp.center.y;

      for (const side of [-1, 1]) {
        // Mur de rochers
        for (let k = 0; k < 4; k++) {
          const dist = hw * (1.0 + rngCave() * 0.6);
          const fwd  = (rngCave() - 0.5) * 8;
          const pos  = tp.center.clone()
            .addScaledVector(normal, side * dist)
            .addScaledVector(tangent, fwd);
          const s = 1.8 + rngCave() * 3.0;
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rngCave() > 0.3 ? rockMat : mossMat);
          rock.position.set(pos.x, cy + s * 0.4, pos.z);
          rock.rotation.set(rngCave() * 2, rngCave() * 6, rngCave() * 2);
          this.scene.add(rock);
        }
        // Stalactites au plafond
        for (let k = 0; k < 3; k++) {
          const fwd = (rngCave() - 0.5) * 12;
          const lat = side * hw * (0.2 + rngCave() * 0.7);
          const pos = tp.center.clone().addScaledVector(normal, lat).addScaledVector(tangent, fwd);
          const sh = 0.8 + rngCave() * 2.0;
          const stal = new THREE.Mesh(new THREE.ConeGeometry(0.2 + rngCave() * 0.3, sh, 5), rockMat);
          stal.rotation.z = Math.PI; // pointe vers le bas
          stal.position.set(pos.x, cy + 6 + rngCave() * 2, pos.z);
          this.scene.add(stal);
        }
      }

      // Lumière bleue-verte de grotte
      if (Math.floor(this.trackPoints.indexOf(tp)) % 8 === 0) {
        const caveLight = new THREE.PointLight(0x3366aa, 1.2, 30);
        caveLight.position.set(tp.center.x, cy + 3, tp.center.z);
        this.scene.add(caveLight);
      }
    }

    // Plafond rocheux (dalle plate avec texture rocher)
    for (let i = 1; i < cavePoints.length - 1; i += 3) {
      const tp = this.trackPoints[this.trackPoints.indexOf(cavePoints[i])];
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2.4, 8), rockMat);
      seg.rotation.x = Math.PI / 2; // face vers le bas
      seg.rotation.z = Math.atan2(tp.tangent.x, tp.tangent.z);
      seg.position.set(tp.center.x, tp.center.y + 6.5, tp.center.z);
      this.scene.add(seg);
    }
  }

  // ─── PAROI DE FALAISE (route sur le flanc) ──────────────────────────────
  private buildCliffRoad() {
    // Détecte les track points à y > 18 → section falaise
    const cliffPoints = this.trackPoints.filter(tp => tp.center.y > 18);
    if (cliffPoints.length === 0) return;

    const rockTexCliff = this.loadTex('/textures/rock.jpg', 2, 2);
    const cliffMat  = new THREE.MeshStandardMaterial({ map: rockTexCliff, roughness: 0.85, metalness: 0 });
    const darkCliff = new THREE.MeshStandardMaterial({ color: 0x3a2e24, roughness: 0.9, metalness: 0 });
    const rngCliff  = this.seededRng(888);
    const hw = this.mapConfig.trackWidth / 2;

    for (const tp of cliffPoints) {
      const tangent = tp.tangent.clone().normalize();
      const normal  = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const cy = tp.center.y;

      // ── Paroi rocheuse à GAUCHE (côté montagne) ──
      for (let k = 0; k < 6; k++) {
        const dist = hw * (1.1 + rngCliff() * 0.5);
        const fwd  = (rngCliff() - 0.5) * 10;
        const height = 8 + rngCliff() * 12;
        const pos = tp.center.clone()
          .addScaledVector(normal, -dist) // côté gauche seulement
          .addScaledVector(tangent, fwd);
        const s = 2.0 + rngCliff() * 3.5;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rngCliff() > 0.4 ? cliffMat : darkCliff);
        rock.position.set(pos.x, cy + height / 2, pos.z);
        rock.rotation.set(rngCliff(), rngCliff() * 4, rngCliff() * 2);
        rock.castShadow = true;
        this.scene.add(rock);
      }

      // Paroi verticale côté gauche (dalle verticale de roche)
      const wallPos = tp.center.clone().addScaledVector(normal, -(hw + 3));
      const wallH = 18 + rngCliff() * 8;
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, wallH, 8), cliffMat);
      wallMesh.rotation.y = Math.atan2(tangent.x, tangent.z);
      wallMesh.position.set(wallPos.x, cy + wallH / 2 - 2, wallPos.z);
      this.scene.add(wallMesh);

      // ── Vide à droite — pas de barrier, juste le gouffre ──
      // Garde-corps minimal côté droit (1 seul fil)
      if (Math.floor(this.trackPoints.indexOf(tp)) % 5 === 0) {
        const railPos = tp.center.clone().addScaledVector(normal, hw + 0.5);
        const railMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4), railMat);
        post.position.set(railPos.x, cy + 0.6, railPos.z);
        this.scene.add(post);
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 5.5, 4), railMat);
        wire.rotation.z = Math.PI / 2;
        wire.rotation.y = Math.atan2(tangent.x, tangent.z);
        wire.position.set(railPos.x, cy + 1.1, railPos.z);
        this.scene.add(wire);
      }
    }

    // Nuages / brume dans le vide en dessous
    const mistMat = new THREE.MeshBasicMaterial({ color: 0xddeeff, transparent: true, opacity: 0.08, depthWrite: false });
    const midCliff = cliffPoints[Math.floor(cliffPoints.length / 2)];
    if (midCliff) {
      for (let m = 0; m < 5; m++) {
        const mist = new THREE.Mesh(new THREE.PlaneGeometry(80 + m * 30, 20), mistMat);
        mist.rotation.x = -Math.PI / 2;
        mist.position.set(midCliff.center.x + (rngCliff() - 0.5) * 60, midCliff.center.y - 8 - m * 6, midCliff.center.z + (rngCliff() - 0.5) * 60);
        this.scene.add(mist);
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

    // ── Dense forest: 450 trees, packed on both sides ──
    const treeMat1 = new THREE.MeshStandardMaterial({ color: this.mapConfig.treeColor, roughness: 1.0, metalness: 0 });
    const treeMat2 = new THREE.MeshStandardMaterial({ color: 0x2a6b10, roughness: 1.0, metalness: 0 });
    const treeMat3 = new THREE.MeshStandardMaterial({ color: 0x3a8020, roughness: 1.0, metalness: 0 }); // vert clair
    const treeMats = [treeMat1, treeMat2, treeMat3];
    const barkTex = this.loadTex('/textures/bark.jpg', 1, 3);
    const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.9, metalness: 0 });

    for (let i = 0; i < 280; i++) {
      const x = (rng() - 0.5) * 600;
      const z = (rng() - 0.5) * 1100;

      let minDist = Infinity;
      let roadY = 0;
      for (const tp of this.trackPoints) {
        const d = new THREE.Vector2(x, z).distanceTo(new THREE.Vector2(tp.center.x, tp.center.z));
        if (d < minDist) { minDist = d; roadY = tp.center.y; }
      }
      if (minDist < this.mapConfig.trackWidth * 1.2) continue;  // forêt serrée

      const treeY = this.getTerrainY(x, z);
      const h = 6 + rng() * 10;
      const r = 2.0 + rng() * 3.0;
      const sides = Math.floor(4 + rng() * 3);
      const mat = treeMats[Math.floor(rng() * treeMats.length)];

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 + rng()*0.1, 0.38 + rng()*0.12, h * 0.45, 6), trunkMat);
      trunk.position.y = h * 0.22;
      trunk.castShadow = true;

      // Alterner entre conifère (cônes) et feuillu (sphères)
      const isConifer = rng() > 0.35;
      let crown1, crown2, crown3;
      if (isConifer) {
        crown1 = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.72, sides), mat);
        crown1.position.y = h * 0.58; crown1.castShadow = true;
        crown2 = new THREE.Mesh(new THREE.ConeGeometry(r * 0.70, h * 0.52, sides), mat);
        crown2.position.y = h * 0.72;
        crown3 = new THREE.Mesh(new THREE.ConeGeometry(r * 0.40, h * 0.33, sides), mat);
        crown3.position.y = h * 0.84;
      } else {
        // Feuillu — sphères
        crown1 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.85, 7, 5), mat);
        crown1.position.y = h * 0.68; crown1.castShadow = true;
        crown1.scale.y = 0.8;
        crown2 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 6, 4), mat);
        crown2.position.set((rng()-0.5)*r*0.6, h * 0.72, (rng()-0.5)*r*0.6);
        crown3 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 6, 4), mat);
        crown3.position.set((rng()-0.5)*r*0.5, h * 0.58, (rng()-0.5)*r*0.5);
      }

      const tree = new THREE.Group();
      tree.add(trunk, crown1, crown2, crown3);
      tree.position.set(x, treeY, z);
      tree.rotation.y = rng() * Math.PI * 2;
      this.scene.add(tree);
    }

    // ── Bouleaux (birch trees) — 80 trunks blancs ──
    const birchTrunkMat = new THREE.MeshStandardMaterial({ color: 0xddddcc, roughness: 0.8, metalness: 0 });
    const birchCrownMat = new THREE.MeshStandardMaterial({ color: 0x88cc44, roughness: 1.0, metalness: 0 });

    for (let i = 0; i < 50; i++) {
      const x = (rng() - 0.5) * 600;
      const z = (rng() - 0.5) * 1100;

      let minDist = Infinity;
      for (const tp of this.trackPoints) {
        const d = new THREE.Vector2(x, z).distanceTo(new THREE.Vector2(tp.center.x, tp.center.z));
        if (d < minDist) minDist = d;
      }
      if (minDist < this.mapConfig.trackWidth * 1.2) continue;

      const treeY = this.getTerrainY(x, z);
      const h = 7 + rng() * 8;
      const r = 1.5 + rng() * 2.0;

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, h * 0.5, 5), birchTrunkMat);
      trunk.position.y = h * 0.25;
      trunk.castShadow = true;

      const crown1 = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.65, 6), birchCrownMat);
      crown1.position.y = h * 0.6;
      crown1.castShadow = true;
      const crown2 = new THREE.Mesh(new THREE.ConeGeometry(r * 0.6, h * 0.45, 6), birchCrownMat);
      crown2.position.y = h * 0.75;

      const tree = new THREE.Group();
      tree.add(trunk, crown1, crown2);
      tree.position.set(x, treeY, z);
      tree.rotation.y = rng() * Math.PI * 2;
      this.scene.add(tree);
    }

    // ── Taches de boue sur la piste (40 patches) ──
    const mudMat = new THREE.MeshBasicMaterial({ color: 0x6a4010, transparent: true, opacity: 0.3, depthWrite: false });
    const trackLen = this.trackPoints.length;
    for (let i = 0; i < 40; i++) {
      const idx = Math.floor(rng() * trackLen);
      const tp = this.trackPoints[idx];
      if (!tp) continue;
      const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
      const offAcross = (rng() - 0.5) * (this.mapConfig.trackWidth * 0.8);
      const perp = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const pos = tp.center.clone().addScaledVector(perp, offAcross);
      const mudW = 2.5 + rng() * 4.0;
      const mudL = 3.0 + rng() * 5.0;
      const mud = new THREE.Mesh(new THREE.PlaneGeometry(mudW, mudL), mudMat.clone());
      mud.rotation.x = -Math.PI / 2;
      mud.rotation.z = angle + (rng() - 0.5) * 0.8;
      mud.position.set(pos.x, tp.center.y + 0.04, pos.z);
      this.scene.add(mud);
    }

    // ── Undergrowth / bushes — close to track edges ──
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x2d5e0e, roughness: 1.0, metalness: 0 });
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
    this.buildMountains(rng);
    this.buildTallGrass(rng);
    this.buildRallySigns(rng);
    this.buildMarshalFlags(rng);
    this.buildCenterLine();
    this.buildHayBales();
    // buildLeafShadows supprimé — trop de draw calls

    // ── Végétation dense au bord de piste (fougères, buissons, souches) ──
    const fernMat = new THREE.MeshLambertMaterial({ color: 0x2d6611 });
    const borderBushMat1 = new THREE.MeshLambertMaterial({ color: 0x1e5208 });
    const borderBushMat2 = new THREE.MeshLambertMaterial({ color: 0x3a7a18 });
    const borderStumpMat = new THREE.MeshLambertMaterial({ color: 0x4a2e10 });
    const rngBorder = this.seededRng(321);
    const hw = this.mapConfig.trackWidth;

    // On parcourt chaque trackPoint et on place des objets sur les deux côtés
    for (let i = 2; i < this.trackPoints.length - 2; i += 6) {
      const tp = this.trackPoints[i];
      const roadDir = tp.tangent.clone().normalize();
      const perp = new THREE.Vector3(-roadDir.z, 0, roadDir.x); // perpendiculaire à la route

      // Côtés gauche et droit
      for (const side of [-1, 1]) {
        const numObjects = Math.floor(3 + rngBorder() * 4);
        for (let k = 0; k < numObjects; k++) {
          // Distance du bord de route : de 1.05× à 1.9× la demi-largeur
          const dist = hw * (1.05 + rngBorder() * 0.85);
          const forward = (rngBorder() - 0.5) * 8; // décalage le long de la piste
          const pos = tp.center.clone()
            .addScaledVector(perp, side * dist)
            .addScaledVector(roadDir, forward);
          pos.y = tp.center.y + this.getTerrainY(pos.x, pos.z) * 0.2 + 0.02;

          const type = rngBorder();

          if (type < 0.40) {
            // Fougère (flat quad billboardé)
            const fw = 1.5 + rngBorder() * 2.5;
            const fh = 0.8 + rngBorder() * 1.2;
            const fern = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), fernMat);
            fern.rotation.x = -0.35;
            fern.rotation.y = rngBorder() * Math.PI * 2;
            fern.position.set(pos.x, pos.y + fh * 0.45, pos.z);
            this.scene.add(fern);
            // Deuxième feuille croisée
            const fern2 = fern.clone();
            fern2.rotation.y += Math.PI / 2;
            this.scene.add(fern2);

          } else if (type < 0.72) {
            // Buisson
            const br = 1.2 + rngBorder() * 2.0;
            const bush = new THREE.Mesh(new THREE.SphereGeometry(br, 5, 4), rngBorder() > 0.5 ? borderBushMat1 : borderBushMat2);
            bush.scale.y = 0.6 + rngBorder() * 0.4;
            bush.position.set(pos.x, pos.y + br * 0.4, pos.z);
            this.scene.add(bush);

          } else if (type < 0.88) {
            // Petit arbre de bordure (tronc court, très proche)
            const th = 3 + rngBorder() * 4;
            const tr = 0.8 + rngBorder() * 1.2;
            const bTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, th * 0.5, 5), trunkMat);
            bTrunk.position.y = th * 0.25;
            const bCrown = new THREE.Mesh(new THREE.ConeGeometry(tr, th * 0.7, 5), treeMat1);
            bCrown.position.y = th * 0.6;
            const bt = new THREE.Group();
            bt.add(bTrunk, bCrown);
            bt.position.set(pos.x, pos.y, pos.z);
            bt.rotation.y = rngBorder() * Math.PI * 2;
            this.scene.add(bt);

          } else {
            // Souche coupée
            const sr = 0.3 + rngBorder() * 0.5;
            const sh = 0.4 + rngBorder() * 0.6;
            const stump = new THREE.Mesh(new THREE.CylinderGeometry(sr * 0.7, sr, sh, 6), borderStumpMat);
            stump.position.set(pos.x, pos.y + sh * 0.5, pos.z);
            this.scene.add(stump);
          }
        }
      }
    }

    // ── Arbres automnaux (dorés/rouges) — coucher de soleil ──
    const autumnMats = [
      new THREE.MeshLambertMaterial({ color: 0xcc7722 }), // orange
      new THREE.MeshLambertMaterial({ color: 0xaa3311 }), // rouge
      new THREE.MeshLambertMaterial({ color: 0xddaa22 }), // or
    ];
    const rng3 = this.seededRng(199);
    for (let i = 0; i < 60; i++) {
      const x = (rng3() - 0.5) * 600;
      const z = (rng3() - 0.5) * 1200; // spread along full track length
      let minDist = Infinity;
      for (const tp of this.trackPoints) {
        const d = new THREE.Vector2(x, z).distanceTo(new THREE.Vector2(tp.center.x, tp.center.z));
        if (d < minDist) minDist = d;
      }
      if (minDist < this.mapConfig.trackWidth * 2 || minDist > 80) continue;
      const tY = this.getTerrainY(x, z);
      const h = 5 + rng3() * 7;
      const r = 2 + rng3() * 2.5;
      const mat = autumnMats[Math.floor(rng3() * autumnMats.length)];
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, h * 0.4, 5), trunkMat);
      trunk.position.y = h * 0.2;
      const crown = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), mat);
      crown.position.y = h * 0.65;
      crown.scale.y = 0.75;
      const t = new THREE.Group();
      t.add(trunk, crown);
      t.position.set(x, tY, z);
      t.rotation.y = rng3() * Math.PI * 2;
      this.scene.add(t);
    }

    // ── Patches de boue et ornières sur la route ──
    const roadMudMat = new THREE.MeshBasicMaterial({ color: 0x4a2e10, transparent: true, opacity: 0.3, depthWrite: false });
    const roadPuddleMat = new THREE.MeshBasicMaterial({ color: 0x3a5a70, transparent: true, opacity: 0.35, depthWrite: false });
    const rngMud = this.seededRng(77);
    for (let i = 35; i < this.trackPoints.length - 15; i += Math.floor(8 + rngMud() * 15)) {
      const tp = this.trackPoints[i];
      const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
      const hw = this.mapConfig.trackWidth;
      const isPuddle = rngMud() < 0.3;
      const mat = isPuddle ? roadPuddleMat : roadMudMat;
      const w = 2 + rngMud() * 6;
      const len = 3 + rngMud() * 8;
      const off = (rngMud() - 0.5) * (hw * 0.6);
      const perp = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const pos = tp.center.clone().addScaledVector(perp, off);
      const patchGrp = new THREE.Group();
      patchGrp.rotation.y = angle;
      patchGrp.position.set(pos.x, tp.center.y + 0.04, pos.z);
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat);
      patch.rotation.x = -Math.PI / 2;
      patchGrp.add(patch);
      this.scene.add(patchGrp);
    }

    // ── Rochers au bord de piste (concentrés aux virages serrés) ──
    const rockTexCorner = this.loadTex('/textures/rock.jpg', 1, 1);
    const rockMat = new THREE.MeshStandardMaterial({ map: rockTexCorner, roughness: 0.85, metalness: 0 });
    const darkRockMat = new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 0.9, metalness: 0 });
    const rngRock = this.seededRng(555);
    const hwRock = this.mapConfig.trackWidth;

    // Détection des virages (changement de direction rapide)
    for (let i = 5; i < this.trackPoints.length - 5; i++) {
      const tp = this.trackPoints[i];
      const tpPrev = this.trackPoints[i - 3];
      const tpNext = this.trackPoints[i + 3];
      const dir1 = new THREE.Vector2(tp.center.x - tpPrev.center.x, tp.center.z - tpPrev.center.z).normalize();
      const dir2 = new THREE.Vector2(tpNext.center.x - tp.center.x, tpNext.center.z - tp.center.z).normalize();
      const curvature = 1 - dir1.dot(dir2); // 0 = droit, +1 = virage fort

      // Placer des rochers aux virages serrés (curvature > 0.15)
      if (curvature < 0.12 || rngRock() > 0.4) continue;

      const tangent = tp.tangent.clone().normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      // Côté extérieur du virage (là où ça se termine en talus)
      const side = (dir2.x * dir1.y - dir2.y * dir1.x) > 0 ? 1 : -1;

      for (let k = 0; k < 5 + Math.floor(rngRock() * 5); k++) {
        const dist = hwRock * (1.1 + rngRock() * 1.5);
        const fwd = (rngRock() - 0.5) * 12;
        const pos = tp.center.clone()
          .addScaledVector(normal, side * dist)
          .addScaledVector(tangent, fwd);
        const tY = pos.y + this.getTerrainY(pos.x, pos.z) * 0.15;
        const s = 0.5 + rngRock() * 2.5;
        const mat = rngRock() > 0.4 ? rockMat : darkRockMat;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat);
        rock.position.set(pos.x, tY + s * 0.3, pos.z);
        rock.rotation.set(rngRock() * 2, rngRock() * 6, rngRock() * 2);
        rock.castShadow = true;
        this.scene.add(rock);
      }
    }

    // ── Rochers épars dans la forêt ──
    for (let i = 0; i < 40; i++) {
      const x = (rng() - 0.5) * 500;
      const z = (rng() - 0.5) * 1100;
      let tooClose = false;
      for (const tp of this.trackPoints) {
        if (new THREE.Vector2(x, z).distanceTo(new THREE.Vector2(tp.center.x, tp.center.z)) < hw * 1.6) {
          tooClose = true; break;
        }
      }
      if (tooClose) continue;
      const tY = this.getTerrainY(x, z);
      const s = 0.5 + rng() * 3.0;
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
    const size = 1100;
    const segs = 50;  // réduit pour performances
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

    const groundTex = this.loadTex('/textures/forest_ground.jpg', 8, 8);
    const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1.0, metalness: 0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private buildMountains(rng: () => number) {
    // Silhouettes de montagnes en arrière-plan
    const mtMat = new THREE.MeshStandardMaterial({ color: 0x3a5a30, roughness: 1.0, metalness: 0 });
    const mtMat2 = new THREE.MeshStandardMaterial({ color: 0x4a6a40, roughness: 1.0, metalness: 0 });
    const rngM = this.seededRng(123);
    const positions = [
      [-400, -200], [400, -200], [-500, 400], [500, 400],
      [-300, 900], [300, 900], [0, 1350], [-500, 1200], [500, 1200],
    ];
    for (const [mx, mz] of positions) {
      const h = 80 + rngM() * 120;
      const r = 60 + rngM() * 80;
      const segs = 6;
      const mt = new THREE.Mesh(new THREE.ConeGeometry(r, h, segs), rngM() > 0.5 ? mtMat : mtMat2);
      mt.position.set(mx + (rngM()-0.5)*60, h/2 - 5, mz + (rngM()-0.5)*60);
      // Deuxième pic décalé
      const mt2 = new THREE.Mesh(new THREE.ConeGeometry(r*0.7, h*0.8, segs), mtMat);
      mt2.position.set(mx + (rngM()-0.5)*80 + 40, h*0.4 - 5, mz + (rngM()-0.5)*80 + 40);
      this.scene.add(mt);
      this.scene.add(mt2);
    }
  }

  private buildLeafShadows(rng: () => number) {
    // Patches de feuilles mortes + ombres de sous-bois sur le sol et la route
    const rngL = this.seededRng(919);
    const leafMat = new THREE.MeshBasicMaterial({ color: 0x1a0a00, transparent: true, opacity: 0.22, depthWrite: false });
    const leafColors = [
      new THREE.MeshBasicMaterial({ color: 0x7a3a00, transparent: true, opacity: 0.5, depthWrite: false }), // feuilles orange
      new THREE.MeshBasicMaterial({ color: 0x5a2a00, transparent: true, opacity: 0.4, depthWrite: false }), // feuilles marron
      new THREE.MeshBasicMaterial({ color: 0x8a4a00, transparent: true, opacity: 0.35, depthWrite: false }),// feuilles dorées
    ];

    for (let i = 0; i < 200; i++) {
      const x = (rngL() - 0.5) * 600;
      const z = (rngL() - 0.5) * 1100;

      // Nearest track point
      let minDist = Infinity; let nearY = 0;
      for (const tp of this.trackPoints) {
        const d = Math.hypot(x - tp.center.x, z - tp.center.z);
        if (d < minDist) { minDist = d; nearY = tp.center.y; }
      }

      const hw = this.mapConfig.trackWidth;
      const isOnRoad = minDist < hw;
      const y = isOnRoad ? nearY + 0.06 : this.getTerrainY(x, z) + 0.05;
      const mat = isOnRoad ? leafMat : leafColors[Math.floor(rngL() * leafColors.length)];
      const w = 1.5 + rngL() * 5;
      const l = 1.5 + rngL() * 5;
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
      patch.rotation.x = -Math.PI / 2;
      patch.rotation.z = rngL() * Math.PI;
      patch.position.set(x, y, z);
      this.scene.add(patch);
    }
  }

  private buildHayBales() {
    // Bottes de foin WRC aux bords intérieurs des virages serrés
    const rng = this.seededRng(444);
    const hayMat = new THREE.MeshStandardMaterial({
      color: 0xd4a842,
      roughness: 1.0,
      metalness: 0,
    });

    const hw = this.mapConfig.trackWidth / 2; // demi-largeur de piste
    const N = this.trackPoints.length;
    const LOOK = 8; // comparaison tangente sur ±8 points
    let lastPlaced = -50;

    for (let i = LOOK; i < N - LOOK; i += 4) {
      if (i - lastPlaced < 20) continue; // espacement minimum entre groupes

      const t1 = this.trackPoints[i - LOOK].tangent.clone().normalize();
      const t2 = this.trackPoints[i + LOOK].tangent.clone().normalize();
      const dot = Math.max(-1, Math.min(1, t1.dot(t2)));
      const curvature = 1 - dot;

      if (curvature < 0.10) continue; // seulement les virages serrés

      // Côté intérieur du virage (produit vectoriel Y)
      const cross = t1.x * t2.z - t1.z * t2.x;
      const innerSide = cross > 0 ? -1 : 1;

      const numBales = 2 + Math.floor(rng() * 3);   // 2–4 bottes par groupe
      const numStacks = 1 + Math.floor(rng() * 2);  // 1–2 de haut

      const tp = this.trackPoints[i];
      const roadDir = tp.tangent.clone().normalize();
      const perp = new THREE.Vector3(-roadDir.z, 0, roadDir.x);

      for (let b = 0; b < numBales; b++) {
        const forwardOffset = (b - (numBales - 1) / 2) * 1.9;
        const lateralDist = hw + 0.5 + rng() * 0.5;

        const pos = tp.center.clone()
          .addScaledVector(perp, innerSide * lateralDist)
          .addScaledVector(roadDir, forwardOffset);
        pos.y = tp.center.y + 0.02;

        for (let s = 0; s < numStacks; s++) {
          const bale = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 1.2, 1.2),
            hayMat,
          );
          bale.position.set(pos.x, pos.y + s * 1.2 + 0.6, pos.z);
          bale.rotation.y = Math.atan2(roadDir.x, roadDir.z) + (rng() - 0.5) * 0.4;
          bale.castShadow = true;
          this.scene.add(bale);
        }
      }

      lastPlaced = i;
    }
  }

  private buildCenterLine() {
    // Tirets blancs au centre de la route (style rallye)
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    const step = 12;
    for (let i = 5; i < this.trackPoints.length - 5; i += step) {
      const tp = this.trackPoints[i];
      const tangent = tp.tangent.clone().normalize();
      const angle = Math.atan2(tangent.x, tangent.z);
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.35, step * 0.55), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = angle;
      dash.position.set(tp.center.x, tp.center.y + 0.05, tp.center.z);
      this.scene.add(dash);
    }
  }

  private buildMarshalFlags(rng: () => number) {
    // Drapeaux de commissaires jaunes + triangles de danger aux bords de piste
    const rngF = this.seededRng(567);
    const totalPts = this.trackPoints.length;
    const hw = this.mapConfig.trackWidth / 2;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, metalness: 0.2 });

    for (let i = 12; i < totalPts - 12; i += Math.floor(18 + rngF() * 20)) {
      const tp = this.trackPoints[i];
      const tangent = tp.tangent.clone().normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const side = rngF() > 0.5 ? 1 : -1;
      const pos = tp.center.clone().addScaledVector(normal, side * (hw + 1.8));

      // Mât
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.5, 5), postMat);
      mast.position.set(pos.x, tp.center.y + 1.75, pos.z);
      this.scene.add(mast);

      // Drapeau jaune (triangle ou rectangle)
      const flagColor = rngF() > 0.3 ? 0xffd600 : 0xff2222; // jaune ou rouge
      const flagMat = new THREE.MeshStandardMaterial({ color: flagColor, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), flagMat);
      flag.position.set(pos.x + Math.cos(Math.atan2(tangent.x, tangent.z)) * 0.45,
                        tp.center.y + 3.2,
                        pos.z + Math.sin(Math.atan2(tangent.x, tangent.z)) * 0.45);
      flag.rotation.y = Math.atan2(tangent.x, tangent.z);
      this.scene.add(flag);
    }
  }

  private buildRallySigns(rng: () => number) {
    // Panneaux style WRC : distance au départ (0.5km, 1km...) + flèches de virage
    const totalPts = this.trackPoints.length;
    const postMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
    const hw = this.mapConfig.trackWidth / 2;

    // Panneaux kilométriques tous les ~15% du tracé
    const distMarkers = [0.15, 0.30, 0.45, 0.60, 0.75, 0.90];
    const distLabels  = ['150m', '300m', '450m', '600m', '750m', '900m'];
    distMarkers.forEach((t, idx) => {
      const i = Math.floor(t * (totalPts - 1));
      const tp = this.trackPoints[i];
      const tangent = tp.tangent.clone().normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const side = idx % 2 === 0 ? 1 : -1;
      const pos = tp.center.clone().addScaledVector(normal, side * (hw + 1.5));

      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6), postMat);
      post.position.set(pos.x, tp.center.y + 1.1, pos.z);
      this.scene.add(post);

      // Panneau coloré (rouge pour 150/300, jaune pour 450/600, vert pour 750/900)
      const colors = [0xdd2222, 0xdd2222, 0xddaa00, 0xddaa00, 0x22aa22, 0x22aa22];
      const signMat = new THREE.MeshLambertMaterial({ color: colors[idx] });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.05), signMat);
      sign.position.set(pos.x, tp.center.y + 2.25, pos.z);
      sign.rotation.y = Math.atan2(tangent.x, tangent.z);
      this.scene.add(sign);

      // Bande blanche sur panneau
      const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 0.06), stripMat);
      strip.position.set(pos.x, tp.center.y + 2.25, pos.z);
      strip.rotation.y = Math.atan2(tangent.x, tangent.z);
      this.scene.add(strip);
    });

    // Signalisation de virage (flèches) aux virages serrés détectés
    const rngSign = this.seededRng(411);
    for (let i = 8; i < totalPts - 8; i += 8) {
      const tp = this.trackPoints[i];
      const tpA = this.trackPoints[i - 5];
      const tpB = this.trackPoints[i + 5];
      const d1 = new THREE.Vector2(tp.center.x - tpA.center.x, tp.center.z - tpA.center.z).normalize();
      const d2 = new THREE.Vector2(tpB.center.x - tp.center.x, tpB.center.z - tp.center.z).normalize();
      const curv = 1 - d1.dot(d2);
      if (curv < 0.2) continue;

      const tangent = tp.tangent.clone().normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      // Flèche sur le côté intérieur du virage
      const turnSide = (d2.x * d1.y - d2.y * d1.x) > 0 ? -1 : 1;
      const pos = tp.center.clone().addScaledVector(normal, turnSide * (hw + 1.5));

      const arrowPost = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 6), postMat);
      arrowPost.position.set(pos.x, tp.center.y + 0.9, pos.z);
      this.scene.add(arrowPost);

      const arrowMat = new THREE.MeshLambertMaterial({ color: 0xff8800 });
      const arrowSign = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.07), arrowMat);
      arrowSign.position.set(pos.x, tp.center.y + 2.0, pos.z);
      arrowSign.rotation.y = Math.atan2(tangent.x, tangent.z) + (turnSide > 0 ? 0.2 : -0.2);
      this.scene.add(arrowSign);

      // Bande diagonale blanche
      const diag = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      diag.position.set(pos.x, tp.center.y + 1.95, pos.z);
      diag.rotation.y = arrowSign.rotation.y;
      diag.rotation.z = turnSide * 0.35;
      this.scene.add(diag);
    }
  }

  private buildTallGrass(rng: () => number) {
    // Herbe haute en touffes juste derrière les rondins — style spéciale WRC
    const grassColors = [
      new THREE.MeshBasicMaterial({ color: 0x2d5a0a, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x3d7010, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x1e4006, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x4a8a18, side: THREE.DoubleSide }),
    ];
    const rngG = this.seededRng(631);
    const hw = this.mapConfig.trackWidth / 2;

    for (let i = 0; i < this.trackPoints.length - 1; i += 10) {
      const tp = this.trackPoints[i];
      const tangent = tp.tangent.clone().normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);

      for (const side of [-1, 1]) {
        const numTufts = 1 + Math.floor(rngG() * 2);
        for (let k = 0; k < numTufts; k++) {
          const dist = hw * (1.05 + rngG() * 0.6);
          const fwd = (rngG() - 0.5) * 6;
          const pos = tp.center.clone()
            .addScaledVector(normal, side * dist)
            .addScaledVector(tangent, fwd);
          const h = 0.6 + rngG() * 1.2;
          const w = 0.4 + rngG() * 0.8;
          const mat = grassColors[Math.floor(rngG() * grassColors.length)];

          // Touffe = 2-3 quads croisés, légèrement inclinés
          const group = new THREE.Group();
          group.position.set(pos.x, tp.center.y + 0.02, pos.z);
          for (let a = 0; a < 3; a++) {
            const blade = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
            blade.rotation.y = (a / 3) * Math.PI;
            blade.rotation.x = (rngG() - 0.5) * 0.3; // légère inclinaison
            blade.position.y = h * 0.5;
            group.add(blade);
          }
          group.rotation.y = rngG() * Math.PI * 2;
          this.scene.add(group);
        }
      }
    }
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

    // ── Matériaux ──
    const liveryTex = this.createCarLivery();
    const bodyMat   = new THREE.MeshStandardMaterial({ map: liveryTex, roughness: 0.28, metalness: 0.18 });
    const glassMat  = new THREE.MeshStandardMaterial({ color: 0x99bbdd, transparent: true, opacity: 0.42, roughness: 0.05, metalness: 0.12 });
    const blackMat  = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.25 });
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35, metalness: 0.4 });
    const rimMat    = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.08, metalness: 0.95 });
    const tireMat   = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.88, metalness: 0 });
    const lightMat  = new THREE.MeshBasicMaterial({ color: 0xfffaaa });
    const tailMat   = new THREE.MeshBasicMaterial({ color: 0xff2200 });

    // ── Groupe carrosserie (reçoit le body-roll) ──
    const bodyGroup = new THREE.Group();
    this.carBodyMesh = bodyGroup;

    const hw = 1.08; // demi-largeur

    // --- Plancher / base ---
    const floor = new THREE.Mesh(new THREE.BoxGeometry(hw*2, 0.1, 4.0), carbonMat);
    floor.position.set(0, 0.16, 0);
    bodyGroup.add(floor);

    // Jupes latérales
    for (const sx of [-1, 1]) {
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 3.55), blackMat);
      sill.position.set(sx * (hw + 0.045), 0.25, 0.05);
      bodyGroup.add(sill);
    }

    // --- Corps principal ---
    const body = new THREE.Mesh(new THREE.BoxGeometry(hw*2, 0.42, 3.55), bodyMat);
    body.position.set(0, 0.44, 0.05);
    body.castShadow = true;
    bodyGroup.add(body);

    // Nez avant (coin avant incliné) — 2 sections
    const nose1 = new THREE.Mesh(new THREE.BoxGeometry(hw*2, 0.38, 0.32), bodyMat);
    nose1.position.set(0, 0.38, 1.94);
    nose1.rotation.x = -0.28;
    nose1.castShadow = true;
    bodyGroup.add(nose1);

    const nose2 = new THREE.Mesh(new THREE.BoxGeometry(hw*2, 0.2, 0.22), bodyMat);
    nose2.position.set(0, 0.22, 2.08);
    nose2.rotation.x = -0.5;
    bodyGroup.add(nose2);

    // Pare-choc avant (carbone/noir)
    const frontBump = new THREE.Mesh(new THREE.BoxGeometry(hw*2.12, 0.28, 0.18), carbonMat);
    frontBump.position.set(0, 0.24, 2.18);
    bodyGroup.add(frontBump);

    // Splitter avant
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(hw*2.15, 0.06, 0.42), carbonMat);
    splitter.position.set(0, 0.1, 2.2);
    bodyGroup.add(splitter);

    // Prise d'air centrale
    const duct = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.12), blackMat);
    duct.position.set(0, 0.42, 2.21);
    bodyGroup.add(duct);

    // Capot (légèrement bombé — 2 panneaux)
    const hoodFront = new THREE.Mesh(new THREE.BoxGeometry(hw*2-0.05, 0.04, 0.9), bodyMat);
    hoodFront.position.set(0, 0.67, 1.45);
    hoodFront.rotation.x = -0.04;
    bodyGroup.add(hoodFront);
    const hoodRear = new THREE.Mesh(new THREE.BoxGeometry(hw*2-0.05, 0.04, 0.75), bodyMat);
    hoodRear.position.set(0, 0.69, 0.72);
    hoodRear.rotation.x = 0.08;
    bodyGroup.add(hoodRear);

    // NACA ducts sur le capot
    for (const ox of [-0.28, 0.28]) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.38), blackMat);
      vent.position.set(ox, 0.695, 1.3);
      bodyGroup.add(vent);
    }

    // Coffre arrière
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(hw*2-0.05, 0.04, 0.85), bodyMat);
    trunk.position.set(0, 0.67, -1.35);
    trunk.rotation.x = 0.05;
    bodyGroup.add(trunk);

    // Pare-choc arrière
    const rearBump = new THREE.Mesh(new THREE.BoxGeometry(hw*2.12, 0.3, 0.18), carbonMat);
    rearBump.position.set(0, 0.3, -2.1);
    rearBump.rotation.x = 0.2;
    bodyGroup.add(rearBump);

    // Diffuseur arrière
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(hw*2.1, 0.08, 0.48), carbonMat);
    diffuser.position.set(0, 0.1, -2.1);
    diffuser.rotation.x = 0.4;
    bodyGroup.add(diffuser);

    // Extensions d'ailes (passages de roue)
    for (const sx of [-1, 1]) {
      const ff = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 1.28), bodyMat);
      ff.position.set(sx * (hw + 0.065), 0.44, 0.95);
      ff.castShadow = true;
      bodyGroup.add(ff);
      const rf = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 1.28), bodyMat);
      rf.position.set(sx * (hw + 0.065), 0.44, -0.98);
      rf.castShadow = true;
      bodyGroup.add(rf);
    }

    // === CABINE ===
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(hw*1.62, 0.52, 1.85), bodyMat);
    cabin.position.set(0, 0.94, -0.06);
    cabin.castShadow = true;
    bodyGroup.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(hw*1.55, 0.05, 1.78), bodyMat);
    roof.position.set(0, 1.22, -0.06);
    bodyGroup.add(roof);

    // Piliers A (avant inclinés)
    for (const sx of [-1, 1]) {
      const ap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.68, 0.07), blackMat);
      ap.position.set(sx * 0.68, 0.95, 0.84);
      ap.rotation.x = -0.52;
      bodyGroup.add(ap);
    }
    // Piliers C (arrière)
    for (const sx of [-1, 1]) {
      const cp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 0.07), blackMat);
      cp.position.set(sx * 0.68, 0.95, -0.98);
      cp.rotation.x = 0.42;
      bodyGroup.add(cp);
    }

    // Pare-brise avant
    const fWin = new THREE.Mesh(new THREE.PlaneGeometry(hw*1.72, 0.78), glassMat);
    fWin.position.set(0, 0.95, 0.88);
    fWin.rotation.x = -Math.PI/2 + 1.08;
    bodyGroup.add(fWin);

    // Lunette arrière
    const rWin = new THREE.Mesh(new THREE.PlaneGeometry(hw*1.64, 0.65), glassMat);
    rWin.position.set(0, 0.94, -1.02);
    rWin.rotation.x = Math.PI/2 - 1.12;
    bodyGroup.add(rWin);

    // Vitres latérales
    for (const sx of [-1, 1]) {
      const sWin = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.46), glassMat);
      sWin.position.set(sx * (hw*0.81+0.01), 0.96, -0.06);
      sWin.rotation.y = sx * Math.PI/2;
      bodyGroup.add(sWin);
    }

    // Rétroviseurs
    for (const sx of [-1, 1]) {
      const mirArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.05), blackMat);
      mirArm.position.set(sx * (hw + 0.1), 0.94, 0.66);
      bodyGroup.add(mirArm);
      const mirHead = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.07), blackMat);
      mirHead.position.set(sx * (hw + 0.2), 0.94, 0.66);
      bodyGroup.add(mirHead);
    }

    // Snorkel / prise d'air toit
    const snorkel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.75), bodyMat);
    snorkel.position.set(0, 1.33, 0.18);
    bodyGroup.add(snorkel);
    const snorkelTop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.15), blackMat);
    snorkelTop.position.set(0, 1.47, -0.2);
    bodyGroup.add(snorkelTop);

    // === AILERON ARRIÈRE (grand WRC) ===
    for (const sx of [-0.68, 0.68]) {
      const ws = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.65, 0.065), carbonMat);
      ws.position.set(sx, 0.98, -2.0);
      bodyGroup.add(ws);
    }
    const wingMain = new THREE.Mesh(new THREE.BoxGeometry(hw*2.18, 0.08, 0.78), bodyMat);
    wingMain.position.set(0, 1.35, -2.0);
    wingMain.rotation.x = -0.12;
    wingMain.castShadow = true;
    bodyGroup.add(wingMain);
    // Flap secondaire
    const wingFlap = new THREE.Mesh(new THREE.BoxGeometry(hw*2.1, 0.05, 0.35), carbonMat);
    wingFlap.position.set(0, 1.28, -1.7);
    bodyGroup.add(wingFlap);
    // Plaques d'extrémité
    for (const sx of [-1, 1]) {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.26, 0.82), carbonMat);
      ep.position.set(sx * hw*1.09, 1.31, -2.0);
      bodyGroup.add(ep);
    }

    // === PHARES (pods LED modernes) ===
    for (const sx of [-1, 1]) {
      const hlPod = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.22, 0.07), blackMat);
      hlPod.position.set(sx * 0.61, 0.6, 2.14);
      bodyGroup.add(hlPod);
      const hlLens = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.06), lightMat);
      hlLens.position.set(sx * 0.61, 0.61, 2.16);
      bodyGroup.add(hlLens);
      // DRL strip
      const drl = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.038, 0.06), lightMat);
      drl.position.set(sx * 0.61, 0.72, 2.15);
      bodyGroup.add(drl);
    }
    // Calandre centrale
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.22, 0.06), blackMat);
    grille.position.set(0, 0.5, 2.14);
    bodyGroup.add(grille);

    // === FEUX ARRIÈRE ===
    for (const sx of [-1, 1]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.18, 0.06), tailMat);
      tl.position.set(sx * 0.56, 0.6, -2.12);
      bodyGroup.add(tl);
      const tlStrip = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.038, 0.06), tailMat);
      tlStrip.position.set(sx * 0.56, 0.44, -2.12);
      bodyGroup.add(tlStrip);
    }

    this.carGroup.add(bodyGroup);

    // === ROUES ===
    this.buildWheels(tireMat, rimMat, blackMat);
    this.scene.add(this.carGroup);
  }

  private buildWheels(
    tireMat: THREE.MeshStandardMaterial,
    rimMat: THREE.MeshStandardMaterial,
    blackMat: THREE.MeshStandardMaterial
  ) {
    const wheelPositions: [number, number, number][] = [
      [ 1.18, 0.38,  1.32],
      [-1.18, 0.38,  1.32],
      [ 1.18, 0.38, -1.32],
      [-1.18, 0.38, -1.32],
    ];
    this.wheels = [];

    for (const [wx, wy, wz] of wheelPositions) {
      const wGroup = new THREE.Group();

      // Pneu (Torus)
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.165, 10, 24), tireMat);
      tire.rotation.y = Math.PI / 2;
      tire.castShadow = true;
      wGroup.add(tire);

      // Jante (disque + anneau extérieur)
      const rimDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.265, 0.1, 14), rimMat);
      rimDisc.rotation.z = Math.PI / 2;
      wGroup.add(rimDisc);

      const rimRing = new THREE.Mesh(new THREE.TorusGeometry(0.265, 0.03, 6, 14), rimMat);
      rimRing.rotation.y = Math.PI / 2;
      wGroup.add(rimRing);

      // 5 rayons
      for (let s = 0; s < 5; s++) {
        const angle = (s / 5) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.055, 0.235), rimMat);
        spoke.position.set(0, Math.cos(angle) * 0.135, Math.sin(angle) * 0.135);
        spoke.rotation.x = -angle;
        wGroup.add(spoke);
      }

      // Center cap
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), rimMat);
      cap.rotation.z = Math.PI / 2;
      wGroup.add(cap);

      // Disque de frein (rouge, visible entre les rayons)
      const brakeDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12), 
        new THREE.MeshStandardMaterial({ color: 0xaa2200, roughness: 0.7, metalness: 0.5 }));
      brakeDisc.rotation.z = Math.PI / 2;
      wGroup.add(brakeDisc);

      wGroup.position.set(wx, wy, wz);
      this.carGroup.add(wGroup);
      this.wheels.push(wGroup as unknown as THREE.Mesh);
    }
  }

  private createCarLivery(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Fond blanc éclatant
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, 512, 512);

    // Grande bande bleue diagonale (capot/flancs)
    const grad = ctx.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#002299');
    grad.addColorStop(1, '#0044cc');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 80); ctx.lineTo(512, 0);
    ctx.lineTo(512, 180); ctx.lineTo(0, 220);
    ctx.closePath();
    ctx.fill();

    // Bande rouge fine
    ctx.fillStyle = '#cc0011';
    ctx.beginPath();
    ctx.moveTo(0, 220); ctx.lineTo(512, 180);
    ctx.lineTo(512, 208); ctx.lineTo(0, 248);
    ctx.closePath();
    ctx.fill();

    // Dégradé métallique subtil sur le blanc
    const sheen = ctx.createLinearGradient(0, 248, 512, 512);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, 'rgba(220,230,255,0.4)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 248, 512, 264);

    // Cercle numéro (jaune)
    ctx.fillStyle = '#ffd600';
    ctx.beginPath(); ctx.arc(256, 400, 68, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#111111'; ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 96px Arial Black, Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('1', 256, 406);

    // Rectangles sponsors (réalistes)
    ctx.fillStyle = '#111111';
    ctx.fillRect(30, 340, 100, 32);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('WRC', 80, 356);

    ctx.fillStyle = '#dd0011';
    ctx.fillRect(380, 340, 100, 32);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('RALLY', 430, 356);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }


  // ─────────────── Lights ───────────────

  // ─── Texture loader (vraies textures + fallback procédural) ─────────────
  private texLoader = new THREE.TextureLoader();
  private loadTex(path: string, repeatX: number, repeatY: number): THREE.Texture {
    const tex = this.texLoader.load(path);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createTexture(type: 'dirt-road' | 'forest-ground' | 'tree-bark' | 'rock' | 'car-body', size = 512): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const rng = this.seededRng(type.charCodeAt(0) * 31 + type.length);

    if (type === 'dirt-road') {
      ctx.fillStyle = '#8a5a2a'; ctx.fillRect(0, 0, size, size);
      // Bruit de surface
      for (let i = 0; i < 1800; i++) {
        const x = rng() * size, y = rng() * size, r = 1 + rng() * 3;
        ctx.globalAlpha = 0.15 + rng() * 0.35;
        ctx.fillStyle = rng() > 0.5 ? '#6a3a10' : '#aa7040';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      // Ornières centrales
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#5a3010';
      ctx.fillRect(size * 0.30, 0, size * 0.06, size);
      ctx.fillRect(size * 0.64, 0, size * 0.06, size);
      // Petits cailloux
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 120; i++) {
        const x = rng() * size, y = rng() * size, r = 2 + rng() * 3;
        ctx.fillStyle = `hsl(${25 + rng()*15},${30 + rng()*20}%,${28 + rng()*18}%)`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

    } else if (type === 'forest-ground') {
      ctx.fillStyle = '#2a4010'; ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 1200; i++) {
        const x = rng() * size, y = rng() * size, r = 3 + rng() * 18;
        ctx.globalAlpha = 0.12 + rng() * 0.22;
        ctx.fillStyle = rng() > 0.5 ? '#1e3a08' : '#3a5a18';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      // Feuilles mortes
      for (let i = 0; i < 200; i++) {
        const x = rng() * size, y = rng() * size;
        ctx.globalAlpha = 0.18 + rng() * 0.25;
        const h = 20 + rng() * 40;
        ctx.fillStyle = `hsl(${25 + rng()*30},${50+rng()*30}%,${35+rng()*20}%)`;
        ctx.beginPath(); ctx.ellipse(x, y, 2 + rng()*4, 1 + rng()*3, rng()*Math.PI, 0, Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1;

    } else if (type === 'tree-bark') {
      ctx.fillStyle = '#5c3a1a'; ctx.fillRect(0, 0, size, size);
      // Striures verticales
      for (let i = 0; i < 40; i++) {
        const x = rng() * size;
        ctx.globalAlpha = 0.3 + rng() * 0.4;
        ctx.fillStyle = rng() > 0.5 ? '#3a2210' : '#7a5030';
        ctx.fillRect(x, 0, 1 + rng() * 2, size);
      }
      // Fissures horizontales
      for (let i = 0; i < 15; i++) {
        const y = rng() * size;
        ctx.globalAlpha = 0.2;
        ctx.strokeStyle = '#2a1808';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + (rng()-0.5)*20); ctx.stroke();
      }
      ctx.globalAlpha = 1;

    } else if (type === 'rock') {
      ctx.fillStyle = '#6a6058'; ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 30; i++) {
        const x = rng() * size, y = rng() * size, r = 20 + rng() * 60;
        ctx.globalAlpha = 0.08 + rng() * 0.15;
        ctx.fillStyle = rng() > 0.5 ? '#8a807a' : '#4a4440';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = 0; i < 400; i++) {
        const x = rng() * size, y = rng() * size;
        ctx.globalAlpha = 0.08 + rng() * 0.1;
        ctx.fillStyle = rng() > 0.5 ? '#7a7068' : '#5a5048';
        ctx.fillRect(x, y, 1 + rng()*2, 1 + rng()*2);
      }
      ctx.globalAlpha = 1;

    } else if (type === 'car-body') {
      // Fond blanc
      ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, size, size);
      // Bande bleue (30% largeur)
      ctx.fillStyle = '#003399';
      ctx.fillRect(0, 0, size * 0.30, size);
      // Bande rouge (8% largeur)
      ctx.fillStyle = '#cc1111';
      ctx.fillRect(size * 0.30, 0, size * 0.08, size);
      // Numéro de rallye
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(size * 0.55, size * 0.35, size * 0.25, size * 0.30);
      ctx.strokeStyle = '#000000'; ctx.lineWidth = 3;
      ctx.strokeRect(size * 0.55, size * 0.35, size * 0.25, size * 0.30);
    }

    const tex = new THREE.CanvasTexture(canvas);
    if (type !== 'car-body') {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      if (type === 'dirt-road') tex.repeat.set(1, 20);
      else if (type === 'forest-ground') tex.repeat.set(6, 6);
      else tex.repeat.set(1, 3);
    }
    return tex;
  }

  private buildSkyDome() {
    // Ciel de jour — horizon → zénith, gradient riche
    const skyGeo = new THREE.SphereGeometry(500, 64, 16);
    const posAttr = skyGeo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const groundHaze  = new THREE.Color(0xfff8f0); // haze chaud à l'horizon bas
    const horizonColor = new THREE.Color(0xc8e8ff); // horizon bleu très pâle
    const midColor    = new THREE.Color(0x5ba8e0);  // bleu moyen
    const zenithColor = new THREE.Color(0x1a6abf);  // bleu profond zénith
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const t = Math.max(-0.15, Math.min(1, y / 500));
      const c = new THREE.Color();
      if (t < 0)      c.lerpColors(groundHaze, horizonColor, (t + 0.15) / 0.15);
      else if (t < 0.3) c.lerpColors(horizonColor, midColor, t / 0.3);
      else            c.lerpColors(midColor, zenithColor, (t - 0.3) / 0.7);
      colors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;
    this.scene.add(sky);

    // Soleil
    const sunSphereMat = new THREE.MeshBasicMaterial({ color: 0xfffce0 });
    const sunSphere = new THREE.Mesh(new THREE.SphereGeometry(14, 12, 8), sunSphereMat);
    sunSphere.position.set(200, 280, -100);
    this.scene.add(sunSphere);

    // Nuages procéduraux
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
    const cloudRng = this.seededRng(246);
    for (let i = 0; i < 12; i++) {
      const cloud = new THREE.Group();
      const cx = (cloudRng() - 0.5) * 800;
      const cz = (cloudRng() - 0.5) * 1200;
      const cy = 120 + cloudRng() * 80;
      for (let b = 0; b < 5; b++) {
        const r = 18 + cloudRng() * 22;
        const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), cloudMat);
        blob.position.set((cloudRng()-0.5)*35, (cloudRng()-0.5)*8, (cloudRng()-0.5)*20);
        blob.scale.y = 0.5 + cloudRng() * 0.3;
        cloud.add(blob);
      }
      cloud.position.set(cx, cy, cz);
      this.scene.add(cloud);
    }
  }

  private setupLights() {
    // Lumière ambiante + hémisphère (ciel bleu / sol vert)
    this.scene.add(new THREE.AmbientLight(0xc8e0f0, 0.5));
    this.scene.add(new THREE.HemisphereLight(0x87ceeb, 0x4a7a20, 0.4));

    // Soleil de milieu de journée — blanc légèrement chaud
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.4);
    sun.position.set(100, 150, -80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); // réduit pour perf
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -250;
    sun.shadow.camera.right = sun.shadow.camera.top = 250;
    this.scene.add(sun);

    // Fill light — ciel bleu de l'autre côté
    const fill = new THREE.DirectionalLight(0x8ab8e0, 0.3);
    fill.position.set(-80, 60, 80);
    this.scene.add(fill);
  }

  // ─────────────── Audio ───────────────

  private setupAudio() {
    try {
      this.soundCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {}
    try {
      const ctx = this.soundCtx!;
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 70;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 450;
      this.engineOsc.connect(lp);
      lp.connect(this.engineGain);
      this.engineGain.connect(ctx.destination);
      this.engineOsc.start();

      this.engineOsc2 = ctx.createOscillator();
      this.engineOsc2.type = 'square';
      this.engineOsc2.frequency.value = 140;
      this.engineGain2 = ctx.createGain();
      this.engineGain2.gain.value = 0;
      this.engineOsc2.connect(this.engineGain2);
      this.engineGain2.connect(ctx.destination);
      this.engineOsc2.start();
    } catch {}
  }

  private updateAudio() {
    if (!this.soundCtx || !this.engineOsc || !this.engineGain) return;
    if (this.raceState === 'countdown') {
      this.engineGain.gain.setTargetAtTime(0.01, this.soundCtx.currentTime, 0.2);
      return;
    }
    const speedRatio = Math.abs(this.physics.speed) / 24;
    const freq = 75 + speedRatio * 230;
    const vol = 0.03 + speedRatio * 0.055;
    const now = this.soundCtx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(freq, now, 0.04);
    this.engineGain.gain.setTargetAtTime(vol, now, 0.06);
    if (this.engineOsc2 && this.engineGain2) {
      this.engineOsc2.frequency.setTargetAtTime(freq * 2.05, now, 0.04);
      this.engineGain2.gain.setTargetAtTime(vol * 0.25, now, 0.06);
    }
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
      this.composer.render(dt);
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
    this.updateAudio();
    // Speed in km/h
    this.callbacks.onSpeedUpdate?.(Math.abs(this.physics.speed) * 4.5);
    // FOV zoom at high speed (immersion)
    const targetFov = 68 + Math.abs(this.physics.speed) * 0.22;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.05);
    this.camera.updateProjectionMatrix();
  }

  // ─────────────── Physics ───────────────

  private updatePhysics(dt: number) {
    const { carConfig, input, physics } = this;

    const speedBoost = 0.9 + (carConfig.speed - 1) * 0.18;
    const handlingBoost = 0.7 + (carConfig.handling - 1) * 0.16;
    const maxSpeed = 20 * speedBoost;   // plus lent — maîtrise
    const accel = 11 * speedBoost;
    const brakeForce = 36;
    const rollFriction = 5;
    const steerMax = 3.0 * handlingBoost;
    const lateralGrip = 0.7 + (carConfig.handling - 1) * 0.15;  // terre glissante — très peu de grip
    const driftAccum = 16 + (5 - carConfig.handling) * 1.5;     // arrière part fort

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

    // Terre glissante : la dérive se dissipe lentement (surface loose)
    physics.lateralVel = THREE.MathUtils.lerp(physics.lateralVel, 0, effectiveLateralGrip * dt);

    // Imperfections de surface terre
    if (!isHandbrake && speedRatio > 0.35) {
      physics.lateralVel += (Math.random() - 0.5) * speedRatio * 0.25;
    }

    const maxLateral = maxSpeed * 0.85;
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
      // Sur la falaise, la voiture doit coller à la surface bancée (moyenne L+R)
      const closestIdx = Math.min(Math.floor(closestT * this.trackPoints.length), this.trackPoints.length - 1);
      const closestTp = this.trackPoints[closestIdx];
      const bankOffset = closestTp ? (closestTp.left.y + closestTp.right.y) / 2 - closestTp.center.y : 0;
      const targetY = closestPt.y + bankOffset + 0.52;

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
          // Son d'impact + camera shake
          if (impact > 5) {
            this.playSound(120, 0.18, 'sawtooth', 0.12);
          }
          this.verticalVel = 0;
          this.isAirborne = false;
        }
      } else {
        // Détecte décollage : road y qui chute brusquement sous la voiture
        const yDrop = closestPt.y - (physics.position.y - 0.52);
        if (yDrop < -3.5 && Math.abs(physics.speed) > 10) {
          this.isAirborne = true;
          this.verticalVel = Math.abs(physics.speed) * 0.12;
        } else {
          // Snap fort sur la route — pas de traversée du sol
          const diff = targetY - physics.position.y;
          const snapSpeed = diff > 0 ? 0.55 : 0.30; // monte vite, descend doucement
          physics.position.y += diff * snapSpeed;
          // Jamais sous la route
          if (physics.position.y < targetY - 0.05) physics.position.y = targetY - 0.05;
        }
      }

      // ── Boundary push (sauf en l'air) ──
      if (!this.isAirborne && distFromCenter > halfWidth) {
        const pushDir = pos2D.clone().sub(closestPt2D).normalize();
        const overlap = distFromCenter - halfWidth;
        physics.position.x -= pushDir.x * (overlap * 1.5 + 0.2);
        physics.position.z -= pushDir.y * (overlap * 1.5 + 0.2);
        physics.speed *= Math.max(0.3, 1 - overlap * 0.15);
        physics.lateralVel *= 0.3;
      }
    }

    // ── Mesh update — voiture alignée avec la pente de la route ──
    this.carGroup.position.copy(physics.position);
    this.carGroup.rotation.y = physics.heading;

    // Pitch (avant-arrière) selon la pente de la route
    if (this.spline) {
      const t = this.findClosestT(new THREE.Vector2(physics.position.x, physics.position.z));
      const tangent3D = this.spline.getTangent(t);
      const pitchAngle = -Math.atan2(tangent3D.y, Math.sqrt(tangent3D.x * tangent3D.x + tangent3D.z * tangent3D.z));
      this.carGroup.rotation.x = THREE.MathUtils.lerp(this.carGroup.rotation.x, pitchAngle, 0.05);
    } else {
      this.carGroup.rotation.x = THREE.MathUtils.lerp(this.carGroup.rotation.x, 0, 0.15);
    }

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

  private camShake: number = 0; // landing impact shake

  private updateCamera(dt: number) {
    // XZ = snap quasi-immédiat sur la voiture, Y lissé pour no jitter
    const p = this.physics.position;
    this.smoothCamTarget.x = THREE.MathUtils.lerp(this.smoothCamTarget.x, p.x, 0.35);
    this.smoothCamTarget.z = THREE.MathUtils.lerp(this.smoothCamTarget.z, p.z, 0.35);
    this.smoothCamTarget.y = THREE.MathUtils.lerp(this.smoothCamTarget.y, p.y, 0.10);
    const target = this.smoothCamTarget.clone();

    // Heading découplé, lerp constant
    let diff = this.physics.heading - this.cameraHeading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.cameraHeading += diff * 0.06;

    const airBonusH = this.isAirborne ? 3 : 0;
    const airBonusBehind = this.isAirborne ? 4 : 0;

    // Hauteur et recul constants — pas liés à la vitesse
    const height = 3.0 + airBonusH;
    const behind = 9.0 + airBonusBehind;

    const desiredPos = target.clone().add(new THREE.Vector3(
      -Math.sin(this.cameraHeading) * behind,
      height,
      -Math.cos(this.cameraHeading) * behind
    ));

    this.camera.position.lerp(desiredPos, 0.10);
    this.camera.lookAt(target.x, target.y + 1.0, target.z);
  }

  // ─────────────── Particles (dirt spray) ───────────────

  private updateParticles(dt: number, now: number) {
    const drift = Math.abs(this.physics.lateralVel);
    const speed = Math.abs(this.physics.speed);

    // Particules de terre supprimées

    this.skidTimer += dt;
    if (Math.abs(this.physics.lateralVel) > 3.5 && Math.abs(this.physics.speed) > 4) {
      if (this.skidTimer > 0.06) {
        this.skidTimer = 0;
        this.addSkidMark();
        // Son de dérapage léger
        if (Math.random() < 0.15) this.playSound(180 + Math.random() * 80, 0.12, 'sawtooth', 0.025);
      }
    } else {
      this.skidTimer = 0;
    }

    this.particles = this.particles.filter(p => {
      const ud = p.userData as { spawnTime: number; lifetime: number; vy: number; vx: number; vz: number };
      const age = now - ud.spawnTime;
      if (age > ud.lifetime) { this.scene.remove(p); return false; }
      const t = age / ud.lifetime;
      const mat = p.material as THREE.PointsMaterial;
      mat.opacity = (1 - t * t) * 0.8;
      mat.size = mat.size * 0.998; // shrink slightly
      p.position.y += ud.vy * dt;
      ud.vy -= 8 * dt; // gravity
      p.position.x += (ud.vx + (Math.random() - 0.5)) * dt;
      p.position.z += (ud.vz + (Math.random() - 0.5)) * dt;
      return true;
    });
  }

  private addSkidMark() {
    // Couleur terre rouge-brune (rallye gravier)
    const mat = new THREE.MeshBasicMaterial({ color: 0x5a2a0a, transparent: true, opacity: 0.28, depthWrite: false });
    for (const side of [-2.5, 2.5]) {
      const normal = new THREE.Vector3(Math.cos(this.physics.heading), 0, -Math.sin(this.physics.heading));
      const pos = this.physics.position.clone().addScaledVector(normal, side);
      const geo = new THREE.PlaneGeometry(0.9, 1.6);
      const mark = new THREE.Mesh(geo, mat.clone());
      mark.rotation.x = -Math.PI / 2;
      mark.rotation.z = -this.physics.heading;
      mark.position.set(pos.x, pos.y - 0.28, pos.z);
      this.scene.add(mark);
      this.skidMarkMeshes.push(mark);
    }
    while (this.skidMarkMeshes.length > this.MAX_SKIDS) {
      const old = this.skidMarkMeshes.shift()!;
      this.scene.remove(old);
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
  }

  private emitDirt(color: number, size: number, lifetime: number) {
    const n = 14;
    // Spawn derrière les roues arrière (pas au centre de la voiture)
    const behindDir = new THREE.Vector3(Math.sin(this.physics.heading), 0, Math.cos(this.physics.heading));
    const spawnBase = this.physics.position.clone().addScaledVector(behindDir, 2.5);

    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const wheelSide = (Math.random() - 0.5) * 5;
      const wheelFwd  = (Math.random() - 0.3) * 4;
      const perpDir = new THREE.Vector3(Math.cos(this.physics.heading), 0, -Math.sin(this.physics.heading));
      const p = spawnBase.clone()
        .addScaledVector(perpDir, wheelSide)
        .addScaledVector(behindDir, wheelFwd);
      pos[i * 3]     = p.x;
      pos[i * 3 + 1] = p.y - 0.1;
      pos[i * 3 + 2] = p.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // Taille variable selon dérive
    const isDrift = size > 2.5;
    const particleSize = isDrift ? 2.8 + Math.random() * 1.2 : 1.6 + Math.random() * 0.8;
    const mat = new THREE.PointsMaterial({
      color, size: particleSize, transparent: true, opacity: 0.75, depthWrite: false,
      sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    // Vélocité initiale — projette vers le haut + vers l'extérieur
    const vx = (Math.random() - 0.5) * 5;
    const vz = (Math.random() - 0.5) * 5;
    pts.userData = { spawnTime: performance.now(), lifetime, vy: 3.5 + Math.random() * 2, vx, vz };
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
    this.skidMarkMeshes.forEach(m => { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
    this.skidMarkMeshes = [];
    this.startCountdown();
  }

  public getElapsedMs() { return this.elapsedMs; }
  public getBestTime() { return this.bestTotalTime === Infinity ? null : this.bestTotalTime; }
  public getRaceState() { return this.raceState; }
  public getCurrentLap() { return this.currentLap; }

  /** Touch / virtual button input — call from UI */
  public setInput(key: 'forward' | 'backward' | 'left' | 'right' | 'handbrake', value: boolean) {
    this.input[key] = value;
  }

  // ─────────────── Lifecycle ───────────────

  private onResize = () => {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  public destroy() {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    if (this._keydownHandler) window.removeEventListener('keydown', this._keydownHandler);
    if (this._keyupHandler) window.removeEventListener('keyup', this._keyupHandler);
    try { this.engineOsc?.stop(); } catch {}
    try { this.engineOsc2?.stop(); } catch {}
    try { this.soundCtx?.close(); } catch {}
    this.renderer.dispose();
  }
}
