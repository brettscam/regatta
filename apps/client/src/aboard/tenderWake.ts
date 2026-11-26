import * as THREE from 'three';

// What a powered tender throws into the air: spray off her chines once she is on the plane, the wave runner's rooster
// tail, and a splash where she lands or hits something. Her wake on the water is drawn with every other vessel's
// (`stage.craft`, `scene/wake.ts`). Drawing only: nothing here decides anything.
// One of these per powered tender on the water, the player's and each of the other boats'.

const DROPS = 140;
const G = 9.81;

/** What the wake needs to know of the craft making it. Sim coordinates. */
export interface WakeMaker {
  x: number;
  y: number;
  heading: number;
  /** m/s along her heading. */
  speed: number;
  /** 0 to 1, how far on the plane. */
  plane: number;
  /** 0 to 1, how hard the engine is working. */
  throttle: number;
  /** Metres clear of the water. */
  hop: number;
  length: number;
  halfBeam: number;
  /** True for a jet: she throws a rooster tail. */
  jet: boolean;
}

interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number }

export class TenderWake {
  private readonly group = new THREE.Group();
  private readonly drops: Drop[] = [];
  private readonly spray: THREE.InstancedMesh;
  private nextDrop = 0;
  /** Drops owed. */
  private owed = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene, private readonly seaLevel: (x: number, z: number, seaTime: number, count?: number) => number) {
    this.group.name = 'tender-wake';
    this.spray = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, depthWrite: false }), DROPS);
    this.spray.name = 'tender-spray';
    this.spray.frustumCulled = false;
    this.spray.count = DROPS;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < DROPS; i++) {
      this.spray.setMatrixAt(i, this.m);
      this.drops.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 0, size: 0 });
    }
    this.group.add(this.spray);
    scene.add(this.group);
  }

  /** The colour of white water in this light (`stage.white`), so spray does not glow after dark. Left alone, it is white. */
  tint(colour: THREE.Color): void {
    (this.spray.material as THREE.MeshBasicMaterial).color.copy(colour);
  }

  /** How many drops are in the air. For the console. */
  showing(): { drops: number } {
    return { drops: this.drops.filter((d) => d.age < d.life).length };
  }

  private drop(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number): void {
    const d = this.drops[this.nextDrop];
    this.nextDrop = (this.nextDrop + 1) % DROPS;
    d.x = x; d.y = y; d.z = z; d.vx = vx; d.vy = vy; d.vz = vz; d.age = 0; d.life = life; d.size = size;
  }

  /** A burst of water where she came down, or hit something. Scene coordinates. */
  splash(x: number, y: number, z: number, hard: number): void {
    const n = Math.round(8 + 14 * Math.min(1, hard));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = 1 + Math.random() * (2 + 3 * hard);
      this.drop(x, y + 0.1, z, Math.sin(a) * out, 2 + Math.random() * (2 + 3 * hard), Math.cos(a) * out, 0.7 + Math.random() * 0.5, 0.05 + Math.random() * 0.08);
    }
  }

  /**
   * @param maker the craft, or null when there is none on the water: what was left behind still fades
   * @param dt real seconds, 0 while the game is paused
   */
  update(maker: WakeMaker | null, dt: number, seaTime: number): void {
    if (maker && dt > 0) this.make(maker, dt, seaTime);

    let live = false;
    for (let i = 0; i < DROPS; i++) {
      const d = this.drops[i];
      if (d.age >= d.life) continue;
      d.age += dt;
      d.vy -= G * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      const k = d.age / d.life;
      const size = k >= 1 ? 0 : d.size * (1 - k * k);
      this.p.set(d.x, d.y, d.z);
      this.s.set(size, size, size);
      this.m.compose(this.p, this.q, this.s);
      this.spray.setMatrixAt(i, this.m);
      live = true;
    }
    if (live || this.spray.visible) this.spray.instanceMatrix.needsUpdate = true;
    this.spray.visible = live;
  }

  private make(c: WakeMaker, dt: number, seaTime: number): void {
    const fx = Math.sin(c.heading);
    const fz = -Math.cos(c.heading);
    // To starboard, in the scene.
    const rx = -fz;
    const rz = fx;
    const z = -c.y;
    const v = Math.abs(c.speed);
    const wet = c.hop <= 0.02;
    const sea = this.seaLevel(c.x, z, seaTime, 4);

    // Spray off the chines on the plane, and the jet's rooster tail.
    if (!wet) return;
    this.owed = Math.min(30, this.owed + dt * (c.plane * (14 + v * 3) + (c.jet && c.throttle > 0.25 && v > 4 ? 70 * c.throttle : 0)));
    while (this.owed >= 1) {
      this.owed -= 1;
      const tail = c.jet && c.throttle > 0.25 && v > 4 && Math.random() < 0.7;
      if (tail) {
        // Up and astern from the nozzle, falling a few lengths behind her.
        const back = c.length * 0.5 + 0.1;
        const up = (3 + 4.5 * c.throttle) * (0.7 + Math.random() * 0.5);
        const keep = v * (0.25 + Math.random() * 0.15);
        const out = (Math.random() - 0.5) * 0.9;
        this.drop(c.x - fx * back, sea + 0.15, z - fz * back, fx * keep + rx * out, up, fz * keep + rz * out, 0.9 + Math.random() * 0.5, 0.06 + Math.random() * 0.09);
      } else {
        const side = Math.random() < 0.5 ? -1 : 1;
        const along = c.length * (0.05 + Math.random() * 0.25);
        const out = side * (1.6 + Math.random() * 2.2) * (0.5 + 0.5 * c.plane);
        const keep = v * 0.45;
        this.drop(c.x + fx * along + rx * side * c.halfBeam, sea + 0.12, z + fz * along + rz * side * c.halfBeam, fx * keep + rx * out, 1.2 + Math.random() * (1 + v * 0.1), fz * keep + rz * out, 0.5 + Math.random() * 0.4, 0.04 + Math.random() * 0.06);
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.spray.geometry.dispose();
    (this.spray.material as THREE.Material).dispose();
    this.spray.dispose();
  }
}
