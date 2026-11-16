import { KT } from '@slack-tide/sim';
import type { AboardContext, Feature } from './feature';
import { areasAt, barState, barWord, crossedEastward, entered, noLanding } from './pilotageRules';

/**
 * The crew's local knowledge, on a water whose `features.json` marks its hazards, traffic lanes and refuges:
 * a word on sailing on to the bar, into a lane or inside a refuge's line, and a firm one when the ebb is running over a
 * shoal that breaks. It also keeps the kayak aboard inside a refuge that forbids landing.
 * On a water with no such file it does nothing at all. The rules are the pure `pilotageRules.ts`.
 */
export class Pilotage implements Feature {
  readonly id = 'pilotage';
  private inside = new Set<string>();
  private clock = 0;
  private last: { x: number; y: number } | null = null;
  /** Seconds since each area's warning was last given: sailing along an edge must not repeat it every minute. */
  private readonly told = new Map<string, number>();
  private readonly handed = new Set<string>();

  constructor(private readonly ctx: AboardContext) {}

  key(code: string): boolean {
    if (code !== 'KeyO' || !this.ctx.features) return false;
    const s = this.ctx.sim.state;
    const refuge = noLanding(this.ctx.features, s.x, s.y);
    if (!refuge) return false;
    this.ctx.say(`${refuge.name} is a wildlife refuge and nobody lands. The kayak stays on deck`, 6);
    return true;
  }

  update(dt: number): void {
    const f = this.ctx.features;
    if (!f) return;
    for (const [id, age] of this.told) this.told.set(id, age + dt);
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = 1;
    const { sim, world } = this.ctx;
    const s = sim.state;
    const now = areasAt(f, s.x, s.y);
    for (const a of entered(f, this.inside, now)) {
      if (!a.warn || (this.told.get(a.id) ?? 1e9) < 900) continue;
      this.told.set(a.id, 0);
      if (a.kind === 'hazard') {
        // How the bar is just now: the stream toward the open sea (west, on this coast) and the wind.
        const c = world.current(s.x, s.y, s.t, { x: 0, y: 0 });
        const wind = world.wind(s.x, s.y, s.t).speed / KT;
        const state = barState(-c.x, wind);
        const word = barWord(state, -c.x / KT);
        if (state === 2) this.ctx.alarm(`${a.name}. ${word}`);
        else this.ctx.say(word ? `${a.warn}. ${word}` : a.warn, 10);
      } else {
        this.ctx.say(a.warn, 9);
      }
    }
    this.inside = new Set(now);
    // The line where this water meets the next.
    if (this.last) {
      for (const h of f.handover ?? []) {
        if (this.handed.has(h.to) || !crossedEastward(h.line, this.last, s)) continue;
        this.handed.add(h.to);
        this.ctx.say(`Inside ${h.name}. From here in it is another water with its own chart and traffic: choose it on the way in to sail there`, 9);
      }
    }
    this.last = { x: s.x, y: s.y };
  }
}
