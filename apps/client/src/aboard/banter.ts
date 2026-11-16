import { Banter, type BanterBoat } from '../race/banter';
import { remainingBy } from '../race/sailor';
import type { AboardContext, Feature } from './feature';

/**
 * The club boats talk. In a race with pace boats, their skippers call across the water now and then, each in her own
 * character: at the gun, at a mark, passing or passed, at the finish, after a blunder. The words go among the hails,
 * where anything said between boats is written. What is said and when is `race/banter.ts`; this only listens once a
 * second and passes it on. It takes no key and gives no status.
 */
export class ClubBanter implements Feature {
  readonly id = 'banter';
  private banter: Banter | null = null;
  private raceId = '';
  private clock = 0;
  private readonly boats: BanterBoat[] = [];

  constructor(private readonly ctx: AboardContext) {}

  update(dt: number): void {
    const race = this.ctx.race;
    const call = race?.call;
    if (!race || !call || !race.pacers.length) {
      this.banter = null;
      this.raceId = '';
      return;
    }
    if (call.id !== this.raceId) {
      this.raceId = call.id;
      this.banter = new Banter(call.id);
    }
    this.clock -= dt;
    if (this.clock > 0 || !race.started) return;
    this.clock = 1;
    const s = this.ctx.sim.state;
    const { boats } = this;
    boats.length = 0;
    for (const p of race.pacers) boats.push({ entrant: p.entrant, x: p.sim.state.x, y: p.sim.state.y, leg: p.leg, finish: p.finish, remaining: p.remaining, blunders: p.blunders });
    const said = this.banter!.poll({
      t: race.elapsed, marks: call.marks.length, boats,
      me: { x: s.x, y: s.y, remaining: race.finish !== null ? 0 : remainingBy(call.marks, race.leg, race.toGo), finished: race.finish !== null },
    });
    if (said) this.ctx.heard(said.from, said.text);
  }
}
