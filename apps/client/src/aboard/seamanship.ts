import { SIM_DT, leverFor, milesPerLitre, type PowerSpec } from '@slack-tide/sim';
import { PowerSeamanship, Seamanship, courseMiles, raceAwards, rankOf, type Award, type Rank } from '../xp/score';
import type { AboardContext, Feature } from './feature';

const SAVED = 'regatta.awards';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const held = (halfMinutes: number) => (halfMinutes === 1 ? '30 s' : halfMinutes % 2 ? `${halfMinutes * 30} s` : `${halfMinutes / 2} min`);

interface Line { label: string; points: number; rank?: boolean }

/**
 * Experience points: the scoring in `xp/score.ts` fed from the sim, the race result turned into points, and one
 * short line on the screen for each award ("Clean tack +15"). The points themselves are kept by the logbook.
 * The line is words only and nothing on it can be pressed. Y switches it off, and it hides with the instruments on H.
 */
export class SeamanshipPoints implements Feature {
  readonly id = 'xp';
  enabled = true;
  private readonly el = document.createElement('div');
  private readonly panel = document.getElementById('fleetpanel');
  private readonly scorer = new Seamanship();
  /** A powerboat is scored by other rules altogether: no trim, no tacks. Made the first time she is seen to be one. */
  private powerScorer: PowerSeamanship | null = null;
  private powerFor: PowerSpec | null = null;
  private readonly queue: Line[] = [];
  private showing = 0;
  /** The trickle of points in the groove, saved up so that it is said every couple of minutes and not every half. */
  private steady: { label: string; points: number; n: number; idle: number } | null = null;
  private steps = 0;
  private weight = 1;
  private raceDone: boolean;
  private readonly scored = new Set<string>();

  constructor(private readonly ctx: AboardContext) {
    this.el.className = 'hud award';
    this.el.setAttribute('role', 'status');
    this.el.hidden = true;
    document.body.appendChild(this.el);
    try {
      this.enabled = localStorage.getItem(SAVED) !== 'off';
    } catch { /* no storage: the lines stay on */ }
    this.raceDone = ctx.race?.finish != null;
    ctx.logbook.onAward = (award, rank) => this.earned(award, rank);
  }

  key(code: string): boolean {
    if (code !== 'KeyY') return false;
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(SAVED, this.enabled ? 'on' : 'off');
    } catch { /* nothing to remember it in */ }
    this.ctx.say(this.enabled ? 'Award lines on' : 'Award lines off. Points are still earned. Y turns the lines back on', 5);
    return true;
  }

  step(): void {
    this.steps++;
    const power = this.ctx.sim.boat.power;
    if (power && power !== this.powerFor) {
      this.powerFor = power;
      this.powerScorer = new PowerSeamanship(milesPerLitre(power, leverFor(power, power.cruiseKt)));
    }
    const awards = power && this.powerScorer ? this.powerScorer.step(this.ctx.sim.state, this.ctx.sim.out) : this.scorer.step(this.ctx.sim.state, this.ctx.sim.out, this.weight);
    for (const a of awards) this.ctx.logbook.earn(a);
  }

  private earned(award: Award, rank: Rank | null): void {
    if (award.quiet) {
      if (this.steady && this.steady.label !== award.label) this.flush();
      this.steady ??= { label: award.label, points: 0, n: 0, idle: 0 };
      this.steady.points += award.points;
      this.steady.n++;
      this.steady.idle = 0;
      if (this.steady.n >= 4) this.flush();
    } else {
      // Several of the same close together are one line.
      const last = this.queue[this.queue.length - 1];
      if (last && !last.rank && last.label === award.label) last.points += award.points;
      else this.queue.push({ label: award.label, points: award.points });
    }
    if (rank) {
      this.flush();
      this.queue.push({ label: rank.name, points: 0, rank: true });
    }
  }

  private flush(): void {
    const s = this.steady;
    this.steady = null;
    if (s) this.queue.push({ label: `${s.label} · ${held(s.n)}`, points: s.points });
  }

  update(dt: number): void {
    // How fast time is running, from the steps taken this frame. Run fast, the groove pays by the player's own minutes.
    const rate = dt > 0 ? (this.steps * SIM_DT) / dt : 1;
    this.weight = rate > 1.5 ? 1 / rate : 1;
    this.steps = 0;
    this.raceResult();

    if (this.steady) {
      this.steady.idle += dt;
      // No more coming: she has dropped out of the groove.
      if (this.steady.idle > 50) this.flush();
    }
    this.showing -= dt;
    if (this.showing <= 0) {
      const next = this.queue.shift();
      if (next) {
        this.showing = next.rank ? 6 : this.queue.length > 1 ? 1.6 : 2.8;
        this.el.className = `hud award${next.rank ? ' rank' : next.points < 0 ? ' loss' : ''}`;
        this.el.innerHTML = next.rank
          ? `<small>New rank</small><b>${esc(next.label)}</b>`
          : `<span>${esc(next.label)}</span><b>${next.points < 0 ? `−${-next.points}` : `+${next.points}`}</b>`;
      } else this.showing = 0;
    }
    this.el.hidden = !this.enabled || this.showing <= 0 || this.ctx.hud.readoutHidden;
    // The fleet panel opens over this corner, and opens by itself at the end of a race: stand beside it then.
    if (!this.el.hidden) this.el.classList.toggle('beside', this.panel?.hidden === false);
  }

  /** The player has just finished a race: points for finishing and for every boat astern. Once for each race. */
  private raceResult(): void {
    const race = this.ctx.race;
    const done = race?.finish != null;
    if (!race || done === this.raceDone) return;
    this.raceDone = done;
    const call = race.call;
    if (!done || !call || this.scored.has(call.id)) return;
    this.scored.add(call.id);
    const table = race.standings();
    const at = table.findIndex((s) => s.me);
    const astern = table.slice(at + 1);
    const result = {
      place: at + 1,
      people: table.filter((s) => !s.me && !s.pace).length,
      peopleBeaten: astern.filter((s) => !s.pace).length,
      pacers: table.filter((s) => s.pace).length,
      pacersBeaten: astern.filter((s) => s.pace).length,
      miles: courseMiles(call.marks),
      seconds: race.finish ?? 0,
    };
    for (const a of raceAwards(result)) this.ctx.logbook.earn(a);
  }

  /** The skipper's rank goes out with her position, as a number, for whoever wants to show it by her name. */
  wire(): Record<string, unknown> {
    return { xr: rankOf(this.ctx.logbook.totals.xp).index };
  }

  dispose(): void {
    this.ctx.logbook.onAward = () => {};
    this.el.remove();
  }
}
