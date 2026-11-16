import { KT, SIM_DT } from '@slack-tide/sim';
import { SHADOW, shadowAt, shadowEase, type ShadowSource } from '../race/shadow';
import type { AboardContext, Feature } from './feature';
import type { Residents } from './residents';

/** Sim steps between looks at who is to windward. Ten looks a second. */
const EVERY = 6;
/** Real seconds in bad air before it is said, and before it is said again. */
const SAY_AFTER = 1.5;
const SAY_AGAIN = 30;

/** "In Scott's wind shadow: 4 kt less wind. Bear away or tack for clear air". */
export function badAirLine(by: string, lostKt: number): string {
  const whose = by ? `${by}'s` : "another boat's";
  const n = Math.round(lostKt);
  return `In ${whose} wind shadow${n >= 1 ? `: ${n} kt less wind` : ''}. Bear away or tack for clear air`;
}

/**
 * Bad air. A boat to windward takes wind off the boats under her lee (`race/shadow.ts` has the shape and the numbers).
 * Here the player's own wind is worked out from where she sees the others, other people's boats and the pace boats
 * alike, and handed to her sim as a lighter wind through `ctx.air`. Each pace boat's wind is worked out the same way,
 * so the player can sit on a pace boat's wind too. Nothing goes on the wire: every page works out its own boat's wind.
 * It takes no key and gives no status. One line says whose shadow she has fallen into, at most every half minute.
 */
export class BadAir implements Feature {
  readonly id = 'badair';
  /** Who is taking the most of her wind, as she would be named ('' for a boat with no name), or null in clear air. */
  by: string | null = null;
  private held = 0;
  private quiet = 0;
  private readonly sources: ShadowSource[] = [];
  private readonly names: string[] = [];
  private readonly local: ShadowSource[] = [];

  constructor(private readonly ctx: AboardContext) {}

  /** Everyone who could be taking wind: the boats that live here, other people's boats, then the pace boats. */
  private gather(): void {
    const { sources, names } = this;
    const s = this.ctx.sim.state;
    let n = 0;
    names.length = 0;
    // Only the residents under sail and near enough to matter: a shadow reaches ten mast heights. Their sources are kept and used again.
    for (const v of this.ctx.feature<Residents>('residents')?.vessels ?? []) {
      if (!v.sailing || Math.abs(v.x - s.x) > 400 || Math.abs(v.y - s.y) > 400) continue;
      const src = (this.local[n] ??= { x: 0, y: 0, sog: 0, cog: 0, length: 0, mast: 0, sails: true });
      src.x = v.x;
      src.y = v.y;
      src.sog = v.sog;
      src.cog = v.heading;
      src.length = v.length;
      src.mast = v.mast;
      names.push(v.name);
      n++;
    }
    sources.length = 0;
    for (let i = 0; i < n; i++) sources.push(this.local[i]);
    for (const b of this.ctx.company()) {
      // A boat not yet placed on this screen is nowhere.
      if (b.x === 0 && b.y === 0) continue;
      sources.push({ x: b.x, y: b.y, sog: b.sog, cog: b.cog, length: b.length, mast: b.mast, sails: !b.held });
      names.push(b.name || b.boatName || '');
    }
    for (const p of this.ctx.race?.pacers ?? []) {
      const d = p.sim.boat.dimensions;
      sources.push({ x: p.sim.state.x, y: p.sim.state.y, sog: p.sim.out.sog, cog: p.sim.out.cog, length: d.loa, mast: d.mastHeight, sails: p.sim.state.hold === 'none' });
      names.push(p.skipper || p.name);
    }
  }

  step(): void {
    const { sim, world, air } = this.ctx;
    const s = sim.state;
    if (s.tick % EVERY !== 0) return;
    const pacers = this.ctx.race?.pacers ?? [];
    this.gather();
    const { sources } = this;
    const ease = shadowEase(EVERY * SIM_DT);
    const settle = (now: number, want: number): number => {
      const next = now + (want - now) * ease;
      return next > 0.998 && want === 1 ? 1 : next;
    };

    // The player's own wind. Held, her sails are stowed and it does not matter.
    let want = 1;
    this.by = null;
    if (s.hold === 'none' && sources.length) {
      const here = world.sample(s.x, s.y, s.t);
      const shadow = shadowAt(s.x, s.y, here.windDir, here.windSpeed, sources);
      want = shadow.factor;
      if (shadow.by >= 0) this.by = this.names[shadow.by];
    }
    air.factor = settle(air.factor, want);

    // Each pace boat's wind: everyone else, and the player.
    if (!pacers.length) return;
    const first = sources.length - pacers.length;
    const d = sim.boat.dimensions;
    sources.push({ x: s.x, y: s.y, sog: sim.out.sog, cog: sim.out.cog, length: d.loa, mast: d.mastHeight, sails: s.hold === 'none' });
    for (let i = 0; i < pacers.length; i++) {
      const p = pacers[i];
      const ps = p.sim.state;
      const own = sources[first + i];
      // She does not stand in her own shadow.
      const sails = own.sails;
      own.sails = false;
      const here = world.sample(ps.x, ps.y, ps.t);
      p.air.factor = settle(p.air.factor, ps.hold === 'none' ? shadowAt(ps.x, ps.y, here.windDir, here.windSpeed, sources).factor : 1);
      own.sails = sails;
    }
  }

  update(dt: number): void {
    const { sim, air } = this.ctx;
    this.quiet -= dt;
    const loss = 1 - air.factor;
    if (loss < SHADOW.tell || this.by === null || sim.state.hold !== 'none') {
      this.held = 0;
      return;
    }
    this.held += dt;
    if (this.held < SAY_AFTER || this.quiet > 0) return;
    this.quiet = SAY_AGAIN;
    // What the wind would be in clear air, less what she has.
    const lostKt = (sim.out.tws / air.factor - sim.out.tws) / KT;
    this.ctx.say(badAirLine(this.by, lostKt), 6);
  }

  dispose(): void {
    this.ctx.air.factor = 1;
  }
}
