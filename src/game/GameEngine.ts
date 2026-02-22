import * as THREE from 'three';
import type { MapConfig, CarConfig } from '@/types';

interface PhysicsState {
  position: THREE.Vector3;
  heading: number;
  speed: number;
  lateralVelocity: number;
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

export type EngineCallback = {
  onTimerUpdate?: (ms: number) => void;
  onFinish?: (ms: number, lap: number) => void;
  onLapComplete?: (lap: number) => void;
  onStateChange?: (state: 'idle' | 'racing' | 'finished') => void;
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
  private physics: PhysicsState;
  private input: InputState;
  private mapConfig: MapConfig;
  private carConfig: CarConfig;
  private trackLength: number = 0;
  private timerActive = false;
  private startTimeMs = 0;
  private elapsedMs = 0;
  private lastUpdateTime = 0;
  private raceState: 'idle' | 'racing' | 'finished' = 'idle';
  private currentLap = 0;
  private totalLaps = 2;
  private lastProgress = 0;
  private progressAtCheckpoint = false;
  private callbacks: EngineCallback = {};
  private particles: THREE.Points[] = [];
  private driftParticleTimer = 0;
  private enginePitch = 1;
  private treeGroup!: THREE.Group;
  private barrierGroup!: THREE.Group;
  private soundCtx: AudioContext | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;

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

    this.physics = {
      position: new THREE.Vector3(0, 0.5, 0),
      heading: 0,
      speed: 0,
      lateralVelocity: 0,
    };

    this.input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
    };

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(mapConfig.groundColor).lerp(new THREE.Color(0x87ceeb), 0.3);
    this.scene.fog = new THREE.Fog(
      new THREE.Color(mapConfig.groundColor).lerp(new THREE.Color(0x87ceeb), 0.3),
      80,
      200
    );

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 500);

    this.setupLights();
    this.buildTrack();
    this.buildEnvironment();
    this.buildCar();
    this.placeCarAtStart();
    this.setupAudio();
    this.bindKeys();

    window.addEventListener('resize', this.onResize);
    this.startLoop();
  }

  private setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(30, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-30, 20, -30);
    this.scene.add(fill);
  }

  private buildTrack() {
    const wp = this.mapConfig.waypoints;
    const center = this.computeCenter(wp);

    // Create 3D spline points (centered)
    const points3D = wp.map(([x, z]) =>
      new THREE.Vector3(x - center.x, 0, z - center.y)
    );

    this.spline = new THREE.CatmullRomCurve3(points3D, true, 'catmullrom', 0.5);
    const divisions = wp.length * 20;
    const splinePoints = this.spline.getPoints(divisions);

    // Build track geometry
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
      const right = pt.clone().add(normal.clone().multiplyScalar(-hw));

      this.trackPoints.push({ center: pt.clone(), tangent, left, right });

      vertices.push(left.x, 0.01, left.z);
      vertices.push(right.x, 0.01, right.z);
      uvs.push(0, t * this.mapConfig.trackWidth);
      uvs.push(1, t * this.mapConfig.trackWidth);
      normals.push(0, 1, 0, 0, 1, 0);
    }

    for (let i = 0; i < divisions; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    roadGeo.setIndex(indices);

    const roadMat = new THREE.MeshLambertMaterial({
      color: this.mapConfig.roadColor,
      side: THREE.FrontSide,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);

    // Road markings (center dashes)
    this.buildRoadMarkings(splinePoints, divisions);

    // Start/finish line
    this.buildStartFinishLine();

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(800, 800, 4, 4);
    const groundMat = new THREE.MeshLambertMaterial({ color: this.mapConfig.groundColor });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Track barriers
    this.barrierGroup = new THREE.Group();
    this.buildBarriers();
    this.scene.add(this.barrierGroup);

    this.trackLength = this.spline.getLength();
  }

  private computeCenter(wp: [number, number][]): { x: number; y: number } {
    let sx = 0, sy = 0;
    for (const [x, y] of wp) { sx += x; sy += y; }
    return { x: sx / wp.length, y: sy / wp.length };
  }

  private buildRoadMarkings(splinePoints: THREE.Vector3[], divisions: number) {
    const dashInterval = 8;
    const dashLength = 3;
    const markingMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    for (let i = 0; i < divisions; i += dashInterval) {
      const pt = splinePoints[i];
      const tangent = this.spline.getTangent(i / divisions);
      const dashGeo = new THREE.PlaneGeometry(0.5, dashLength);
      const dash = new THREE.Mesh(dashGeo, markingMat);
      dash.rotation.x = -Math.PI / 2;
      const angle = Math.atan2(tangent.x, tangent.z);
      dash.rotation.z = angle;
      dash.position.set(pt.x, 0.02, pt.z);
      this.scene.add(dash);
    }
  }

  private buildStartFinishLine() {
    const startPt = this.trackPoints[0];
    const hw = this.mapConfig.trackWidth;
    const geo = new THREE.PlaneGeometry(hw, 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    const angle = Math.atan2(startPt.tangent.x, startPt.tangent.z);
    mesh.rotation.z = angle;
    mesh.position.set(startPt.center.x, 0.03, startPt.center.z);
    this.scene.add(mesh);

    // Checkerboard pattern
    const checkers = 8;
    const cw = hw / checkers;
    const checkMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (let i = 0; i < checkers; i++) {
      if (i % 2 === 0) {
        const cGeo = new THREE.PlaneGeometry(cw, 2);
        const c = new THREE.Mesh(cGeo, checkMat);
        c.rotation.x = -Math.PI / 2;
        c.rotation.z = angle;
        const offset = (i - checkers / 2 + 0.5) * cw;
        c.position.set(
          startPt.center.x + Math.cos(angle + Math.PI / 2) * offset,
          0.04,
          startPt.center.z + Math.sin(angle + Math.PI / 2) * offset
        );
        this.scene.add(c);
      }
    }
  }

  private buildBarriers() {
    const divisions = this.mapConfig.waypoints.length * 20;
    const barrierH = 1.2;
    const barrierW = 0.4;
    const step = 3;
    const mat = new THREE.MeshLambertMaterial({ color: this.mapConfig.barrierColor });
    const mat2 = new THREE.MeshLambertMaterial({ color: 0x333333 });

    for (let i = 0; i < this.trackPoints.length - 1; i += step) {
      const tp = this.trackPoints[i];
      for (const side of [tp.left, tp.right]) {
        const geo = new THREE.BoxGeometry(barrierW, barrierH, step * 0.8);
        const barrier = new THREE.Mesh(geo, i % (step * 4) < step * 2 ? mat : mat2);
        barrier.castShadow = true;
        barrier.position.set(side.x, barrierH / 2, side.z);
        const angle = Math.atan2(tp.tangent.x, tp.tangent.z);
        barrier.rotation.y = angle;
        this.barrierGroup.add(barrier);
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

  private buildEnvironment() {
    this.treeGroup = new THREE.Group();
    const treeMat = new THREE.MeshLambertMaterial({ color: this.mapConfig.treeColor });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
    const rng = this.seededRng(42);

    for (let i = 0; i < 120; i++) {
      const x = (rng() - 0.5) * 300;
      const z = (rng() - 0.5) * 300;
      const pos = new THREE.Vector3(x, 0, z);

      // Skip if too close to track
      let tooClose = false;
      for (const tp of this.trackPoints) {
        if (pos.distanceTo(tp.center) < this.mapConfig.trackWidth * 1.8) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const h = 4 + rng() * 6;
      const r = 1.5 + rng() * 2;

      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.3, h * 0.5, 5),
        trunkMat
      );
      trunk.position.y = h * 0.25;
      trunk.castShadow = true;

      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(r, h * 0.7, 5),
        treeMat
      );
      crown.position.y = h * 0.6;
      crown.castShadow = true;

      const tree = new THREE.Group();
      tree.add(trunk);
      tree.add(crown);
      tree.position.set(x, 0, z);
      this.treeGroup.add(tree);
    }
    this.scene.add(this.treeGroup);
  }

  private buildCar() {
    const cfg = this.carConfig;
    this.carGroup = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(2, 0.8, 3.5);
    const bodyMat = new THREE.MeshLambertMaterial({ color: cfg.bodyColor });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.5;
    body.castShadow = true;
    this.carGroup.add(body);
    this.carBodyMesh = body;

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.6, 0.6, 1.8);
    const cabinMat = new THREE.MeshLambertMaterial({ color: cfg.bodyColor });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.1, -0.2);
    cabin.castShadow = true;
    this.carGroup.add(cabin);

    // Windows
    const winMat = new THREE.MeshLambertMaterial({
      color: cfg.windowColor,
      transparent: true,
      opacity: 0.7,
    });
    const frontWinGeo = new THREE.PlaneGeometry(1.4, 0.5);
    const frontWin = new THREE.Mesh(frontWinGeo, winMat);
    frontWin.position.set(0, 1.15, 0.71);
    frontWin.rotation.x = -Math.PI * 0.15;
    this.carGroup.add(frontWin);

    const rearWinGeo = new THREE.PlaneGeometry(1.4, 0.5);
    const rearWin = new THREE.Mesh(rearWinGeo, winMat);
    rearWin.position.set(0, 1.15, -1.11);
    rearWin.rotation.x = Math.PI * 0.15;
    this.carGroup.add(rearWin);

    // Wheels
    const wheelPositions = [
      [0.9, 0.3, 1.2], [-0.9, 0.3, 1.2],
      [0.9, 0.3, -1.2], [-0.9, 0.3, -1.2],
    ];
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.3, 8);
    const wheelMat = new THREE.MeshLambertMaterial({ color: cfg.wheelColor });

    for (const [wx, wy, wz] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, wy, wz);
      wheel.castShadow = true;
      this.carGroup.add(wheel);
      this.wheels.push(wheel);
    }

    // Headlights
    const headlightGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
    [-0.6, 0.6].forEach(x => {
      const hl = new THREE.Mesh(headlightGeo, headlightMat);
      hl.position.set(x, 0.5, 1.75);
      this.carGroup.add(hl);
    });

    // Taillights
    const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    [-0.6, 0.6].forEach(x => {
      const tl = new THREE.Mesh(headlightGeo, taillightMat);
      tl.position.set(x, 0.5, -1.75);
      this.carGroup.add(tl);
    });

    this.scene.add(this.carGroup);
  }

  private placeCarAtStart() {
    const startPt = this.trackPoints[0];
    this.physics.position.set(startPt.center.x, 0.5, startPt.center.z);
    const angle = Math.atan2(startPt.tangent.x, startPt.tangent.z);
    this.physics.heading = angle;
    this.physics.speed = 0;
    this.physics.lateralVelocity = 0;
    this.carGroup.position.copy(this.physics.position);
    this.carGroup.rotation.y = this.physics.heading;
    this.lastProgress = 0;
    this.progressAtCheckpoint = false;
    this.currentLap = 0;
  }

  private setupAudio() {
    try {
      this.soundCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = this.soundCtx.createOscillator();
      const gain = this.soundCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 80;
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(this.soundCtx.destination);
      osc.start();
      this.engineOscillator = osc;
      this.engineGain = gain;
    } catch {}
  }

  private playSound(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.15) {
    if (!this.soundCtx) return;
    try {
      const osc = this.soundCtx.createOscillator();
      const gain = this.soundCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, this.soundCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.soundCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.soundCtx.destination);
      osc.start();
      osc.stop(this.soundCtx.currentTime + duration);
    } catch {}
  }

  private bindKeys() {
    const onKeyDown = (e: KeyboardEvent) => {
      if (['z', 'q', 's', 'd', 'Z', 'Q', 'S', 'D', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }
      switch (e.key.toLowerCase()) {
        case 'z': case 'arrowup': this.input.forward = true; break;
        case 's': case 'arrowdown': this.input.backward = true; break;
        case 'q': case 'arrowleft': this.input.left = true; break;
        case 'd': case 'arrowright': this.input.right = true; break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'z': case 'arrowup': this.input.forward = false; break;
        case 's': case 'arrowdown': this.input.backward = false; break;
        case 'q': case 'arrowleft': this.input.left = false; break;
        case 'd': case 'arrowright': this.input.right = false; break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    this._keydownHandler = onKeyDown;
    this._keyupHandler = onKeyUp;
  }

  private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private _keyupHandler: ((e: KeyboardEvent) => void) | null = null;

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
    if (this.raceState === 'finished') return;
    this.updatePhysics(dt);
    this.updateCamera();
    this.updateAudio();
    this.updateParticles(dt, now);
    this.updateTimer(now);
    this.checkLap();
  }

  private updatePhysics(dt: number) {
    const { carConfig, input, physics } = this;
    const speedFactor = 0.8 + (carConfig.speed - 1) * 0.15;
    const handlingFactor = 0.8 + (carConfig.handling - 1) * 0.12;

    const maxSpeed = 22 * speedFactor;
    const maxReverseSpeed = -8;
    const acceleration = 16 * speedFactor;
    const braking = 24;
    const friction = 8;
    const steerSpeed = 1.8 * handlingFactor;
    const driftFactor = 0.85 - (carConfig.handling - 1) * 0.04; // lower = more drift

    let throttle = 0;
    if (input.forward) throttle = 1;
    if (input.backward) throttle = -1;

    // Speed update
    if (throttle > 0) {
      physics.speed = Math.min(physics.speed + acceleration * dt, maxSpeed);
    } else if (throttle < 0) {
      if (physics.speed > 0) {
        physics.speed = Math.max(physics.speed - braking * dt, 0);
      } else {
        physics.speed = Math.max(physics.speed - (acceleration * 0.6) * dt, maxReverseSpeed);
      }
    } else {
      if (physics.speed > 0) {
        physics.speed = Math.max(physics.speed - friction * dt, 0);
      } else {
        physics.speed = Math.min(physics.speed + friction * dt, 0);
      }
    }

    // Steering (only when moving)
    const speedRatio = Math.abs(physics.speed) / maxSpeed;
    if (speedRatio > 0.01) {
      let steer = 0;
      if (input.left) steer = 1;
      if (input.right) steer = -1;
      const steerStrength = steerSpeed * speedRatio * (physics.speed > 0 ? 1 : -1);
      physics.heading += steer * steerStrength * dt;
    }

    // Drift: blend lateral velocity
    const forward = new THREE.Vector3(
      Math.sin(physics.heading),
      0,
      Math.cos(physics.heading)
    );
    const right = new THREE.Vector3(
      Math.cos(physics.heading),
      0,
      -Math.sin(physics.heading)
    );

    const vel = forward.clone().multiplyScalar(physics.speed);
    const lateralBlend = 1 - driftFactor * Math.pow(speedRatio, 0.5);
    physics.lateralVelocity = THREE.MathUtils.lerp(physics.lateralVelocity, 0, lateralBlend * 5 * dt);

    const effectiveVel = vel.clone().add(right.clone().multiplyScalar(physics.lateralVelocity));
    physics.position.addScaledVector(effectiveVel, dt);
    physics.position.y = 0.5;

    // Wheel spin
    const wheelRot = physics.speed * dt * 1.5;
    this.wheels.forEach(w => { w.rotation.x += wheelRot; });

    // Car tilt (for fun)
    const turnInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.carBodyMesh.rotation.z = THREE.MathUtils.lerp(
      this.carBodyMesh.rotation.z,
      -turnInput * speedRatio * 0.06,
      0.1
    );
    this.carBodyMesh.rotation.x = THREE.MathUtils.lerp(
      this.carBodyMesh.rotation.x,
      (input.forward ? -1 : input.backward ? 1 : 0) * speedRatio * 0.05,
      0.1
    );

    // Apply drift lateral velocity when cornering at speed
    if ((input.left || input.right) && speedRatio > 0.4) {
      const driftDir = (input.left ? 1 : -1);
      physics.lateralVelocity += driftDir * speedRatio * 2 * dt;
    }

    // Update mesh
    this.carGroup.position.copy(physics.position);
    this.carGroup.rotation.y = physics.heading;

    // Start timer on first movement
    if (!this.timerActive && this.raceState === 'idle' && Math.abs(physics.speed) > 0.1) {
      this.startRace();
    }
  }

  private startRace() {
    this.raceState = 'racing';
    this.timerActive = true;
    this.startTimeMs = performance.now() - this.elapsedMs;
    this.callbacks.onStateChange?.('racing');
  }

  private updateTimer(now: number) {
    if (!this.timerActive) return;
    this.elapsedMs = now - this.startTimeMs;
    this.callbacks.onTimerUpdate?.(this.elapsedMs);
  }

  private checkLap() {
    if (this.raceState !== 'racing') return;
    if (!this.spline) return;

    const pos2D = new THREE.Vector2(this.physics.position.x, this.physics.position.z);
    const closestT = this.findClosestT(pos2D);

    // Detect crossing start/finish (t near 0 or 1)
    const wasNearEnd = this.lastProgress > 0.85;
    const isNearStart = closestT < 0.12;

    if (wasNearEnd && isNearStart && !this.progressAtCheckpoint) {
      this.progressAtCheckpoint = true;
      this.currentLap++;
      this.callbacks.onLapComplete?.(this.currentLap);
      this.playSound(880, 0.3, 'square', 0.1);

      if (this.currentLap >= this.totalLaps) {
        this.finishRace();
        return;
      }
    }

    if (closestT > 0.4 && closestT < 0.6) {
      this.progressAtCheckpoint = false;
    }

    this.lastProgress = closestT;
  }

  private findClosestT(pos2D: THREE.Vector2): number {
    let minDist = Infinity;
    let bestT = 0;
    const samples = 200;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const pt = this.spline.getPoint(t);
      const d = pos2D.distanceTo(new THREE.Vector2(pt.x, pt.z));
      if (d < minDist) {
        minDist = d;
        bestT = t;
      }
    }
    return bestT;
  }

  private finishRace() {
    this.raceState = 'finished';
    this.timerActive = false;
    this.physics.speed = 0;
    this.playSound(440, 0.15, 'sine', 0.1);
    setTimeout(() => this.playSound(550, 0.15, 'sine', 0.1), 150);
    setTimeout(() => this.playSound(660, 0.4, 'sine', 0.12), 300);
    setTimeout(() => this.playSound(880, 0.6, 'square', 0.08), 500);
    this.callbacks.onFinish?.(this.elapsedMs, this.currentLap);
    this.callbacks.onStateChange?.('finished');
  }

  private updateCamera() {
    const target = this.physics.position.clone();
    const height = 35;
    const behind = 20;

    const cameraOffset = new THREE.Vector3(
      -Math.sin(this.physics.heading) * behind,
      height,
      -Math.cos(this.physics.heading) * behind
    );

    const desiredPos = target.clone().add(cameraOffset);
    this.camera.position.lerp(desiredPos, 0.06);
    this.camera.lookAt(target.x, 0, target.z);
  }

  private updateAudio() {
    if (!this.engineOscillator || !this.engineGain || !this.soundCtx) return;
    const speedRatio = Math.abs(this.physics.speed) / 22;
    const targetFreq = 60 + speedRatio * 180;
    const targetGain = speedRatio > 0.05 ? 0.03 + speedRatio * 0.05 : 0;
    this.engineOscillator.frequency.setTargetAtTime(targetFreq, this.soundCtx.currentTime, 0.05);
    this.engineGain.gain.setTargetAtTime(targetGain, this.soundCtx.currentTime, 0.1);
  }

  private updateParticles(dt: number, now: number) {
    const speedRatio = Math.abs(this.physics.speed) / 22;
    const isDrifting = Math.abs(this.physics.lateralVelocity) > 2 && speedRatio > 0.3;

    if (isDrifting) {
      this.driftParticleTimer += dt;
      if (this.driftParticleTimer > 0.05) {
        this.driftParticleTimer = 0;
        this.emitDriftSmoke();
      }
    }

    // Remove old particles
    this.particles = this.particles.filter(p => {
      const userData = p.userData as { spawnTime: number; lifetime: number };
      if (now - userData.spawnTime > userData.lifetime) {
        this.scene.remove(p);
        return false;
      }
      (p.material as THREE.PointsMaterial).opacity = 1 - (now - userData.spawnTime) / userData.lifetime;
      p.position.y += 0.02;
      return true;
    });
  }

  private emitDriftSmoke() {
    const positions = new Float32Array(15);
    for (let i = 0; i < 5; i++) {
      positions[i * 3] = this.physics.position.x + (Math.random() - 0.5) * 2;
      positions[i * 3 + 1] = 0.1;
      positions[i * 3 + 2] = this.physics.position.z + (Math.random() - 0.5) * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaaaaaa,
      size: 1.5,
      transparent: true,
      opacity: 0.6,
    });
    const pts = new THREE.Points(geo, mat);
    pts.userData = { spawnTime: performance.now(), lifetime: 500 };
    this.scene.add(pts);
    this.particles.push(pts);
  }

  private onResize = () => {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  public restart() {
    this.raceState = 'idle';
    this.timerActive = false;
    this.elapsedMs = 0;
    this.currentLap = 0;
    this.lastProgress = 0;
    this.progressAtCheckpoint = false;
    this.placeCarAtStart();
    this.callbacks.onStateChange?.('idle');
    this.callbacks.onTimerUpdate?.(0);
  }

  public getElapsedMs() {
    return this.elapsedMs;
  }

  public resumeAudio() {
    this.soundCtx?.resume();
  }

  public destroy() {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    if (this._keydownHandler) window.removeEventListener('keydown', this._keydownHandler);
    if (this._keyupHandler) window.removeEventListener('keyup', this._keyupHandler);
    if (this.engineOscillator) { try { this.engineOscillator.stop(); } catch {} }
    if (this.soundCtx) { try { this.soundCtx.close(); } catch {} }
    this.renderer.dispose();
  }
}
