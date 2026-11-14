import * as THREE from 'three';
import { KT, R2D } from '@slack-tide/sim';
import type { AboardContext, Feature } from './feature';
import {
  POT_DROP_KT, POT_HAUL_KT, POT_LIMIT, POT_LOST_AFTER, POT_MAX_DEPTH, POT_MIN_DEPTH, POT_REACH,
  describeHaul, haulPot, potDepthProblem, seasonElapsed, soakWords, type Pot,
} from './catch';

interface Laid extends Pot {
  buoy: THREE.Group;
  /** The boat has been told this buoy is close, on this approach. */
  told: boolean;
  /** Which way the stream leans the buoy, and how hard. */
  set: number;
  drift: number;
}

const SAVED = 'regatta.pots';
const pad3 = (deg: number) => String(Math.round(deg) % 360).padStart(3, '0');
const NUMBER = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];

/**
 * Crab pots. K puts one down where the boat is, with a buoy in her own colour to mark it. K alongside the buoy later
 * hauls it. What comes up depends on how long it soaked and where: see `catch.ts`.
 */
export class CrabPots implements Feature {
  readonly id = 'pots';
  private readonly pots: Laid[] = [];
  private readonly slot: string;
  private ticks = 0;
  private sinceSave = 0;
  /** Game seconds left of working a pot, for the readout. */
  private working = 0;
  private workingAt = '';
  private readonly paint: THREE.MeshStandardMaterial;
  private readonly white = new THREE.MeshStandardMaterial({ color: 0xf1efe7, roughness: 0.6 });
  private readonly onHide = () => { this.bring(); this.keep(); };

  constructor(private readonly ctx: AboardContext) {
    const colour = ctx.livery.topsides ?? ctx.spec.topsides ?? '#c8372d';
    this.paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour), roughness: 0.55 });
    this.slot = `${SAVED}.${ctx.stage.course.id}`;
    this.load();
    window.addEventListener('pagehide', this.onHide);
  }

  key(code: string): boolean {
    if (code !== 'KeyK') return false;
    const { sim, world } = this.ctx;
    const s = sim.state;
    // Lying to her anchor or a mooring she is stopped, however she sheers about.
    const sogKt = s.hold !== 'none' ? 0 : sim.out.sog / KT;
    const near = this.nearest();
    if (near && near.range <= POT_REACH) {
      if (sogKt >= POT_HAUL_KT) this.ctx.say(`Too fast to work the pot: ${sogKt.toFixed(1)} kt over the ground. Get her under ${POT_HAUL_KT} kt alongside the buoy`, 6);
      else this.haul(near.pot);
      return true;
    }
    if (near && near.range <= 150) {
      this.ctx.say(`Your pot buoy is ${Math.round(near.range)} m off, bearing ${pad3(near.bearing)}°. Come within ${POT_REACH} m to haul it${this.pots.length < POT_LIMIT ? ', or move well off to set another' : ''}`, 7);
      return true;
    }
    if (this.pots.length >= POT_LIMIT && near) {
      this.ctx.say(`All ${NUMBER[POT_LIMIT].toLowerCase()} pots are out. The nearest is ${this.far(near.range)} off, bearing ${pad3(near.bearing)}°`, 7);
      return true;
    }
    if (sogKt >= POT_DROP_KT) {
      this.ctx.say(`Too fast to put a pot over: ${sogKt.toFixed(1)} kt over the ground. Slow her under ${POT_DROP_KT} kt`, 6);
      return true;
    }
    const depth = world.depth(s.x, s.y, s.t);
    const problem = potDepthProblem(depth);
    if (problem === 'shallow') {
      this.ctx.say(`Too shallow for a pot here: ${depth.toFixed(1)} m. It wants ${POT_MIN_DEPTH} m of water or more`, 6);
      return true;
    }
    if (problem === 'deep') {
      this.ctx.say(`Too deep for the pot line here: ${Math.round(depth)} m. Find ${POT_MAX_DEPTH} m or less`, 6);
      return true;
    }
    this.drop(depth);
    return true;
  }

  private drop(depth: number): void {
    const { sim, spec } = this.ctx;
    const s = sim.state;
    const now = this.ctx.seasonNow();
    // Over the starboard side, a little clear of the hull.
    const off = spec.dimensions.beam / 2 + 1.4;
    const x = s.x + Math.cos(s.heading) * off;
    const y = s.y - Math.sin(s.heading) * off;
    const pot = this.add({ x, y, t: now, depth, soaked: 0, seen: now });
    pot.told = true;
    this.working = 5;
    this.workingAt = 'Setting a pot';
    const left = POT_LIMIT - this.pots.length;
    const where = this.placeNear(x, y);
    this.ctx.say(`Pot down in ${Math.round(depth)} m${where}. Give it most of an hour, then come back to the buoy and press K. ${left ? `${NUMBER[left]} more aboard` : 'That is the last one aboard'}`, 8);
    this.keep();
  }

  private haul(pot: Laid): void {
    this.bring();
    const result = haulPot(pot, pot.soaked);
    this.remove(pot);
    this.working = 8;
    this.workingAt = 'Hauling a pot';
    if (result.keepers) this.ctx.logbook.count('crabs', result.keepers);
    this.ctx.say(describeHaul(result), 9);
    this.keep();
  }

  /** The nearest of her own pots, with its range and compass bearing from the boat. */
  private nearest(): { pot: Laid; range: number; bearing: number } | null {
    const s = this.ctx.sim.state;
    let best: Laid | null = null;
    let range = Infinity;
    for (const p of this.pots) {
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < range) { range = d; best = p; }
    }
    if (!best) return null;
    return { pot: best, range, bearing: (Math.atan2(best.x - s.x, best.y - s.y) * R2D + 360) % 360 };
  }

  private far(metres: number): string {
    return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1852).toFixed(1)} nm`;
  }

  private placeNear(x: number, y: number): string {
    let name = '';
    let best = 1200;
    for (const p of this.ctx.places) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < best) { best = d; name = p.name; }
    }
    return name ? ` off ${name}` : '';
  }

  private add(p: Pot): Laid {
    const buoy = this.buildBuoy();
    buoy.position.set(p.x, 0, -p.y);
    this.ctx.stage.scene.add(buoy);
    const pot: Laid = { ...p, buoy, told: false, set: 0, drift: 0 };
    this.lean(pot);
    this.pots.push(pot);
    return pot;
  }

  private remove(pot: Laid): void {
    this.ctx.stage.scene.remove(pot.buoy);
    pot.buoy.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    const i = this.pots.indexOf(pot);
    if (i >= 0) this.pots.splice(i, 1);
  }

  /**
   * A pot buoy: a foam float in the boat's colour with a white band and top, and a staff with a flag so it can be found
   * again. Drawn rather larger than life, as a real one is hard enough to pick out of a chop from the helm.
   */
  private buildBuoy(): THREE.Group {
    const g = new THREE.Group();
    const float = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.75, 14), this.paint);
    float.position.y = 0.16;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.16, 14), this.white);
    band.position.y = 0.36;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.36, 14), this.white);
    nose.position.y = 0.715;
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 6), this.white);
    staff.position.y = 1.6;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.34, 0.016), this.paint);
    flag.position.set(0.31, 2.5, 0);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.018), this.white);
    edge.position.set(0.31, 2.28, 0);
    g.add(float, band, nose, staff, flag, edge);
    g.traverse((o) => { o.castShadow = true; });
    g.rotation.order = 'YXZ';
    return g;
  }

  private lean(p: Laid): void {
    const c = this.ctx.world.current(p.x, p.y, this.ctx.sim.state.t);
    p.set = Math.atan2(c.x, c.y);
    p.drift = Math.hypot(c.x, c.y);
  }

  /** Bring every pot's time down up to date. */
  private bring(): void {
    const now = this.ctx.seasonNow();
    for (const p of this.pots) {
      p.soaked += seasonElapsed(p.seen, now);
      p.seen = now;
    }
  }

  step(): void {
    // Once a game second is plenty for something that sits on the bottom.
    if (++this.ticks % 60) return;
    if (this.working > 0) this.working--;
    if (!this.pots.length) return;
    this.bring();
    const s = this.ctx.sim.state;
    for (const p of this.pots) {
      const range = Math.hypot(p.x - s.x, p.y - s.y);
      if (range > 600) p.told = false;
      else if (range < 220 && !p.told && p.soaked >= 600) {
        p.told = true;
        const bearing = (Math.atan2(p.x - s.x, p.y - s.y) * R2D + 360) % 360;
        this.ctx.say(`Your pot buoy is ${Math.round(range / 10) * 10} m off, bearing ${pad3(bearing)}°, down ${soakWords(p.soaked)}. Stop alongside it and press K to haul`, 7);
      }
    }
    // The stream leans the buoys. It changes slowly, so look now and then.
    if (this.ticks % 600 === 0) for (const p of this.pots) this.lean(p);
    if (++this.sinceSave >= 30) this.keep();
  }

  update(_dt: number, seaTime: number): void {
    for (const p of this.pots) {
      const b = p.buoy;
      b.position.y = this.ctx.stage.seaLevel(p.x, -p.y, seaTime);
      b.rotation.y = -p.set;
      b.rotation.x = -Math.min(0.45, p.drift * 0.25) + Math.sin(seaTime * 1.7 + p.x) * 0.1;
      b.rotation.z = Math.sin(seaTime * 1.3 + p.y) * 0.1;
    }
  }

  status(): string {
    return this.working > 0 ? this.workingAt : '';
  }

  // ---- kept across a reload ---------------------------------------------------------------------

  private keep(): void {
    this.sinceSave = 0;
    try {
      const pots = this.pots.map(({ x, y, t, depth, soaked, seen }) => ({ x, y, t, depth, soaked, seen }));
      if (pots.length) localStorage.setItem(this.slot, JSON.stringify({ v: 1, pots }));
      else localStorage.removeItem(this.slot);
    } catch { /* nothing to keep them in */ }
  }

  private load(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(this.slot) ?? 'null') as { v?: number; pots?: Array<Partial<Pot>> } | null;
      if (!saved || saved.v !== 1 || !Array.isArray(saved.pots)) return;
      const now = this.ctx.seasonNow();
      for (const p of saved.pots.slice(0, POT_LIMIT)) {
        const { x, y, t, depth, soaked, seen } = p;
        if (![x, y, t, depth, soaked, seen].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
        // The clock has moved since the pot was last looked at. If it has gone backwards, a day has gone round.
        const down = (soaked as number) + seasonElapsed(seen as number, now);
        // Left more than a day, a pot from an old session is gone: dragged off, or someone else's supper.
        if (down > POT_LOST_AFTER) continue;
        this.add({ x: x as number, y: y as number, t: t as number, depth: depth as number, soaked: down, seen: now });
      }
    } catch { /* no pots, then */ }
  }

  dispose(): void {
    this.bring();
    this.keep();
    window.removeEventListener('pagehide', this.onHide);
    for (const p of [...this.pots]) this.remove(p);
    this.paint.dispose();
    this.white.dispose();
  }
}
