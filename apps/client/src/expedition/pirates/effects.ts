import * as THREE from 'three';

// What a broadside looks and sounds like: a flash and a bank of smoke at each muzzle that drifts down wind, round
// shot crossing the water, a white column where one falls short and splinters where one goes home, and the guns
// heard a moment later. Everything is kept in course metres and drawn relative to the scene's zero each frame.

interface Puff { x: number; y: number; h: number; vx: number; vy: number; vh: number; age: number; life: number; size: number; grow: number; kind: 'smoke' | 'flash' | 'splash' | 'hit' }
interface Ball { x0: number; y0: number; h0: number; x1: number; y1: number; h1: number; t: number; flight: number; hit: boolean }

const MAX_PUFFS = 220;
const MAX_BALLS = 40;

function disc(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BattleEffects {
  private readonly group = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private readonly balls: Ball[] = [];
  private readonly sprites: THREE.Sprite[] = [];
  private readonly shot: THREE.InstancedMesh;
  private readonly mats: Record<Puff['kind'], THREE.SpriteMaterial>;
  private readonly m = new THREE.Matrix4();
  private audio: AudioContext | null = null;
  muted = false;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'battle';
    this.mats = {
      smoke: new THREE.SpriteMaterial({ map: disc('rgba(236,232,222,0.95)', 'rgba(210,206,198,0)'), transparent: true, depthWrite: false }),
      flash: new THREE.SpriteMaterial({ map: disc('rgba(255,236,170,1)', 'rgba(255,140,30,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      splash: new THREE.SpriteMaterial({ map: disc('rgba(255,255,255,0.95)', 'rgba(235,245,250,0)'), transparent: true, depthWrite: false }),
      hit: new THREE.SpriteMaterial({ map: disc('rgba(120,90,60,0.95)', 'rgba(70,55,40,0)'), transparent: true, depthWrite: false }),
    };
    for (let i = 0; i < MAX_PUFFS; i++) {
      const s = new THREE.Sprite(this.mats.smoke.clone());
      s.visible = false;
      this.sprites.push(s);
      this.group.add(s);
    }
    this.shot = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 6, 5), new THREE.MeshBasicMaterial({ color: 0x0b0b0b }), MAX_BALLS);
    this.shot.count = 0;
    this.shot.frustumCulled = false;
    this.group.add(this.shot);
    scene.add(this.group);
  }

  private puff(p: Puff): void {
    if (this.puffs.length >= MAX_PUFFS) this.puffs.shift();
    this.puffs.push(p);
  }

  /**
   * A broadside is fired.
   * @param muzzles where each gun is, course metres and height
   * @param outward the way the guns point, compass radians
   * @param at where the shot is meant for, and how high it strikes
   * @param each for each gun, whether it hit
   * @param wind the wind's drift, m/s east and north
   * @param distance from the listener, metres
   */
  broadside(muzzles: Array<{ x: number; y: number; h: number }>, outward: number, at: { x: number; y: number; loa: number }, each: boolean[], wind: { u: number; v: number }, distance: number, heavy = false): void {
    const ox = Math.sin(outward);
    const oy = Math.cos(outward);
    each.forEach((hit, i) => {
      const from = muzzles[i % Math.max(1, muzzles.length)] ?? { x: at.x, y: at.y, h: 2 };
      this.puff({ x: from.x + ox, y: from.y + oy, h: from.h, vx: 0, vy: 0, vh: 0, age: -i * 0.07, life: 0.16, size: heavy ? 7 : 4, grow: 6, kind: 'flash' });
      // Smoke leaves the muzzle fast, slows, and goes off down wind as one bank.
      for (let k = 0; k < 3; k++) {
        const jit = ((i * 7 + k * 13) % 10) / 10 - 0.5;
        this.puff({
          x: from.x + ox * (1.5 + k * 2.4), y: from.y + oy * (1.5 + k * 2.4), h: from.h + 0.3 * k,
          vx: ox * (9 - k * 2.5) + wind.u * 0.25, vy: oy * (9 - k * 2.5) + wind.v * 0.25, vh: 0.5 + 0.3 * jit,
          age: -i * 0.07 - k * 0.03, life: 20 + 6 * jit, size: (heavy ? 7 : 4.5) + k * 1.6, grow: 1.5 + 0.4 * jit, kind: 'smoke',
        });
      }
      // The shot: home on her hull, or into the sea short or over.
      const spread = (((i * 37) % 17) / 17 - 0.5) * at.loa * 0.9;
      const miss = hit ? 0 : (i % 2 ? 1 : -1) * (18 + ((i * 53) % 40));
      const dist = Math.hypot(at.x - from.x, at.y - from.y) || 1;
      const ux = (at.x - from.x) / dist;
      const uy = (at.y - from.y) / dist;
      if (this.balls.length >= MAX_BALLS) this.balls.shift();
      this.balls.push({
        x0: from.x, y0: from.y, h0: from.h,
        x1: at.x + ux * miss - uy * spread, y1: at.y + uy * miss + ux * spread, h1: hit ? 1.6 : 0,
        t: -i * 0.07, flight: Math.max(0.25, dist / 260), hit,
      });
    });
    this.report(each.length, distance, heavy);
  }

  /** The sound of guns, heard after the time it takes to cross the water. */
  private report(guns: number, distance: number, heavy: boolean): void {
    if (this.muted) return;
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      if (ctx.state === 'suspended') void ctx.resume();
      const delay = Math.min(4, distance / 340);
      const loud = Math.min(1, 0.9 / (1 + distance / 250));
      for (let i = 0; i < guns; i++) {
        const at = ctx.currentTime + delay + i * 0.07 + 0.02;
        const len = 0.9;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
        const d = buf.getChannelData(0);
        // Noise shaped like a report: a crack, then a rumble dying away. Hashed, so every gun of a broadside is its own.
        let h = (i + 1) * 2654435761;
        for (let n = 0; n < d.length; n++) {
          h = Math.imul(h ^ (h >>> 15), 2246822519) + n;
          const r = ((h >>> 0) / 4294967296) * 2 - 1;
          const t = n / ctx.sampleRate;
          d[n] = r * Math.exp(-t * (heavy ? 5 : 8)) * (t < 0.004 ? t / 0.004 : 1);
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const low = ctx.createBiquadFilter();
        low.type = 'lowpass';
        low.frequency.value = Math.max(180, (heavy ? 700 : 1100) - distance * 0.9);
        const gain = ctx.createGain();
        gain.gain.value = loud * 0.55;
        src.connect(low).connect(gain).connect(ctx.destination);
        src.start(at);
        // The thump under it.
        const osc = ctx.createOscillator();
        const og = ctx.createGain();
        osc.frequency.setValueAtTime(heavy ? 70 : 95, at);
        osc.frequency.exponentialRampToValueAtTime(34, at + 0.35);
        og.gain.setValueAtTime(loud * 0.5, at);
        og.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
        osc.connect(og).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.55);
      }
    } catch { /* no sound on this device: the smoke says it */ }
  }

  /**
   * @param dt game seconds
   * @param origin where the scene's zero is, course metres
   * @param seaLevel height of the sea at a scene position
   */
  update(dt: number, wind: { u: number; v: number }, origin: { x: number; y: number }, seaLevel: (x: number, z: number) => number): void {
    // Shot in flight, and what it does where it lands.
    let n = 0;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.t += dt;
      if (b.t < 0) continue;
      const f = b.t / b.flight;
      if (f >= 1) {
        this.balls.splice(i, 1);
        if (b.hit) {
          for (let k = 0; k < 3; k++) this.puff({ x: b.x1, y: b.y1, h: b.h1 + k * 0.4, vx: wind.u * 0.2 + (k - 1) * 1.5, vy: wind.v * 0.2 + (1 - k) * 1.2, vh: 3 - k, age: 0, life: 1.6 + k * 0.5, size: 1.6, grow: 2.2, kind: 'hit' });
        } else {
          for (let k = 0; k < 4; k++) this.puff({ x: b.x1, y: b.y1, h: 0.4 + k * 1.3, vx: 0, vy: 0, vh: 6 - k * 1.3, age: -k * 0.05, life: 1.5 + k * 0.15, size: 1.5 - k * 0.2, grow: 1.1, kind: 'splash' });
        }
        continue;
      }
      if (n < MAX_BALLS) {
        const x = b.x0 + (b.x1 - b.x0) * f - origin.x;
        const z = -(b.y0 + (b.y1 - b.y0) * f - origin.y);
        const h = b.h0 + (b.h1 - b.h0) * f + Math.sin(Math.PI * f) * b.flight * b.flight * 1.2;
        this.shot.setMatrixAt(n++, this.m.makeTranslation(x, h, z));
      }
    }
    this.shot.count = n;
    this.shot.instanceMatrix.needsUpdate = true;

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.life) { this.puffs.splice(i, 1); continue; }
      if (p.age < 0) continue;
      if (p.kind === 'smoke') {
        // The muzzle blast dies in a second. After that the bank goes with the wind.
        const k = Math.exp(-dt * 1.6);
        p.vx = wind.u * 0.9 + (p.vx - wind.u * 0.9) * k;
        p.vy = wind.v * 0.9 + (p.vy - wind.v * 0.9) * k;
      } else if (p.kind === 'splash' || p.kind === 'hit') p.vh -= 9.8 * dt * (p.kind === 'splash' ? 0.8 : 0.5);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.h = Math.max(0.2, p.h + p.vh * dt);
      p.size += p.grow * dt;
    }
    for (let i = 0; i < MAX_PUFFS; i++) {
      const s = this.sprites[i];
      const p = this.puffs[i];
      if (!p || p.age < 0) { s.visible = false; continue; }
      s.visible = true;
      const x = p.x - origin.x;
      const z = -(p.y - origin.y);
      const mat = s.material;
      if (mat.map !== this.mats[p.kind].map) {
        mat.map = this.mats[p.kind].map;
        mat.blending = this.mats[p.kind].blending;
        mat.needsUpdate = true;
      }
      const f = p.age / p.life;
      mat.opacity = p.kind === 'smoke' ? 0.9 * Math.pow(1 - f, 0.7) * Math.min(1, p.age * 4) : p.kind === 'flash' ? 1 - f : 0.95 * (1 - f * f);
      s.position.set(x, (p.kind === 'smoke' ? seaLevel(x, z) : 0) + p.h, z);
      s.scale.set(p.size * 2, p.size * (p.kind === 'splash' ? 3.2 : 2), 1);
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const s of this.sprites) s.material.dispose();
    this.shot.geometry.dispose();
    void this.audio?.close();
  }
}
