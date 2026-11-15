import * as THREE from 'three';

/**
 * Spray: soft white puffs thrown up where a bow meets a sea. Each one is a point that the graphics card moves by
 * itself from where and how fast it was thrown, so the only work a frame is writing the few that are new.
 * A fixed pool, used round and round.
 */
const POOL = 900;

const vertex = /* glsl */ `
  attribute vec3 aVel;
  attribute vec3 aBorn; // time thrown, seconds it lasts, size in metres
  uniform float uTime;
  uniform vec3 uWind;   // the air it is thrown into, m/s
  uniform float uScale; // pixels a metre covers at one metre off
  varying float vAlpha;
  void main() {
    float age = uTime - aBorn.x;
    float k = age / max(aBorn.y, 0.01);
    if (k < 0.0 || k >= 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }
    // Thrown, then falling, and all the while carried off by the wind as it breaks into mist.
    vec3 p = position + aVel * age + vec3(0.0, -4.9, 0.0) * age * age + uWind * (0.32 * age * age);
    p.y = max(p.y, -0.1);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(96.0, aBorn.z * (1.0 + 2.6 * k) * uScale / max(-mv.z, 0.5));
    vAlpha = pow(1.0 - k, 1.4) * min(1.0, age * 14.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = vAlpha * (1.0 - smoothstep(0.15, 1.0, d)) * 0.5;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Spray {
  readonly points: THREE.Points;
  /** Scales how much is thrown: 1 on high, less on low. */
  amount = 1;
  private readonly pos = new Float32Array(POOL * 3);
  private readonly vel = new Float32Array(POOL * 3);
  private readonly born = new Float32Array(POOL * 3).fill(-1e6);
  private readonly attrs: THREE.BufferAttribute[];
  private readonly uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3() },
    uScale: { value: 600 },
    uColor: { value: new THREE.Color(1, 1, 1) },
  };
  private next = 0;
  private dirty = false;
  private seed = 4242;
  /** How deep each vessel's bow was in the sea last frame, and what share of a puff she is owed. */
  private readonly bury = new Map<string, number>();
  private readonly owed = new Map<string, number>();
  private readonly curl = new Map<string, number>();
  private frame = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.attrs = [new THREE.BufferAttribute(this.pos, 3), new THREE.BufferAttribute(this.vel, 3), new THREE.BufferAttribute(this.born, 3)];
    for (const a of this.attrs) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attrs[0]);
    g.setAttribute('aVel', this.attrs[1]);
    g.setAttribute('aBorn', this.attrs[2]);
    const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, material);
    this.points.frustumCulled = false;
    this.points.name = 'spray';
    this.points.renderOrder = 3;
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private throw_(time: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number): void {
    const o = this.next * 3;
    this.next = (this.next + 1) % POOL;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.born[o] = time; this.born[o + 1] = life; this.born[o + 2] = size;
    this.dirty = true;
  }

  /**
   * One vessel's bow for one frame. Spray comes when the bow drives down into a wave too short for the hull to ride
   * over, more of it the faster she is going and the harder it blows, and it goes to leeward.
   * @param sea height of the sea at a point, counting only the `count` longest waves
   * @param lee which side is to leeward: +1 starboard, -1 port
   */
  bow(id: string, time: number, dt: number, x: number, z: number, heading: number, speed: number, length: number, beam: number, lee: number, windKt: number, sea: (x: number, z: number, count: number) => number): void {
    if (dt <= 0 || dt > 0.25) return;
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const bx = x + fx * length * 0.46;
    const bz = z + fz * length * 0.46;
    // The hull rides the two longest waves. What is left of the sea at the stem is what she punches into.
    const top = sea(bx, bz, 6);
    const buried = top - sea(bx, bz, 2);
    const was = this.bury.get(id);
    this.bury.set(id, buried);
    if (was === undefined || speed < 1.2) return;
    const slam = Math.max(0, (buried - was) / dt) * (buried > 0 ? 1 : 0.35);
    const big = Math.min(3, Math.max(1, beam / 3.6));
    const rate = (slam * 34 + Math.max(0, speed - 3.1) * 3) * Math.min(2.2, speed / 3) * (0.45 + Math.min(2.2, windKt / 14)) * this.amount;
    let owed = (this.owed.get(id) ?? 0) + rate * dt;
    const sx = Math.cos(heading);
    const sz = Math.sin(heading);
    const side = lee || (this.rnd() < 0.5 ? -1 : 1);
    // The curl at the stem: white water rolled up and thrown a little way out each side, whenever she has way on.
    // It is what makes a bow wave stand up off the sea instead of lying painted on it.
    let curl = (this.curl.get(id) ?? 0) + Math.max(0, speed - 1.7) * 13 * Math.min(1.6, big) * this.amount * dt;
    while (curl >= 1) {
      curl -= 1;
      const s = this.rnd() < (lee ? 0.62 : 0.5) ? side : -side;
      const aft = this.rnd() * length * 0.1;
      const out = 0.5 + 0.9 * this.rnd();
      this.throw_(
        time,
        bx - fx * (aft + 0.25) + sx * s * (0.15 + aft * 0.22), top + 0.05 + 0.12 * this.rnd(), bz - fz * (aft + 0.25) + sz * s * (0.15 + aft * 0.22),
        fx * speed * 0.8 + sx * s * out, 0.5 + 0.9 * this.rnd(), fz * speed * 0.8 + sz * s * out,
        0.3 + 0.3 * this.rnd(), (0.16 + 0.16 * this.rnd()) * Math.min(1.8, big),
      );
    }
    this.curl.set(id, curl);
    const hard = Math.min(1.6, 0.5 + slam * 1.3);
    while (owed >= 1) {
      owed -= 1;
      const aft = this.rnd() * length * 0.14;
      // Mostly to leeward. Some comes over the weather bow too.
      const s = this.rnd() < 0.82 ? side : -side;
      const out = (0.9 + 2.6 * this.rnd()) * hard * big;
      this.throw_(
        time,
        bx - fx * aft + sx * s * beam * 0.12, top + 0.15 + 0.3 * this.rnd(), bz - fz * aft + sz * s * beam * 0.12,
        fx * speed * 0.6 + sx * s * out, (1.5 + 2.9 * this.rnd()) * hard * Math.sqrt(big), fz * speed * 0.6 + sz * s * out,
        0.7 + 0.8 * this.rnd() + 0.3 * big, (0.2 + 0.38 * this.rnd()) * big,
      );
    }
    this.owed.set(id, owed);
  }

  /**
   * @param wind the wind at the viewer blowing toward (x, z), m/s
   * @param colour what white water looks like in this light
   */
  update(time: number, camera: THREE.PerspectiveCamera, pixelsHigh: number, windX: number, windZ: number, colour: THREE.Color): void {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uWind.value.set(windX, 0, windZ);
    u.uScale.value = camera.projectionMatrix.elements[5] * pixelsHigh * 0.5;
    u.uColor.value.copy(colour);
    if (this.dirty) {
      this.dirty = false;
      for (const a of this.attrs) a.needsUpdate = true;
    }
    // Forget vessels that have gone, now and then.
    if (++this.frame % 900 === 0 && this.bury.size > 40) { this.bury.clear(); this.owed.clear(); this.curl.clear(); }
  }
}
