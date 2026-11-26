import { KT, SIM_DT, damageSpeed } from '@slack-tide/sim';
import { collisionAward } from '../xp/score';
import {
  CONTACT, ContactWatch, closingSpeed, damageText, hitDamage, hitWord, mend, needsWayOn, overlap, pushClear,
  type Berthed, type Hull,
} from './contactRules';
import type { AboardContext, Feature } from './feature';
import type { Residents } from './residents';
import { deepWater, leaveAt } from './tow';

/** Another vessel she could hit, as this page sees it now. */
interface Other extends Hull {
  id: string;
  name: string;
  /** Velocity over the ground, m/s east and north. */
  vx: number;
  vy: number;
  slop: number;
  heavy: boolean;
  /** True for something that cannot hurt a yacht's hull: a kayak. */
  soft?: boolean;
}

/**
 * Boats hitting each other. The player's hull is checked every sim step against other people's boats, the pace boats,
 * the ferries and ships, and the boats that live on the water (`residents.ts`). On contact she is pushed clear and loses the way she had toward the other hull, so
 * nothing passes through anything; there is a thud, a jolt, and a line naming the other vessel and the closing speed.
 *
 * Each hit adds to her hull damage (`sim.state.damage`, which the sim turns into lost speed and which is saved with
 * the boat). At 100% she is holed: she stops, she is out of any race, and a quarter of a minute later she is afloat
 * again nearby with the damage made good. A dock mends her quickly, an anchorage or a mooring slowly.
 * The rules and the numbers are in `contactRules.ts`. Each page works out its own boat's damage from what it sees,
 * and tells the others the result as `dm`. Nobody is blamed: see `hitDamage` for where fault would come in.
 * It takes no key. A holed boat's status ("Holed") is given by the session, ahead of every feature's.
 */
export class Contact implements Feature {
  readonly id = 'contact';
  private readonly watch = new ContactWatch();
  private readonly others: Other[] = [];
  /** Sim seconds until a holed boat is afloat again. Below 0 she is not holed. */
  private sinking = -1;
  /** True for the frame after she is found holed with nothing hit: said once, then cleared. */
  private broken = false;
  private lastCost = -1e9;
  /** True from when a hull (or the rescue boat) leaves her stopped until she is sailing again. */
  private stopped = false;
  private tidyAt = 0;
  private where: Berthed = 'none';
  private mending = false;
  /** Hits since the last frame, for the sound and the words. */
  private readonly news: Array<{ name: string; closing: number; damage: number; holed: boolean }> = [];

  private readonly panel = document.createElement('div');
  private readonly figure: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly bar: HTMLElement;
  private shown = '';

  constructor(private readonly ctx: AboardContext) {
    // A row of the instrument readout, there only while the hull is damaged, so it hides with the instruments on H.
    this.panel.className = 'damage';
    this.panel.hidden = true;
    this.panel.innerHTML = '<span class="k">Hull damage</span><b></b><small></small><div class="bar"><i></i></div>';
    this.figure = this.panel.querySelector('b') as HTMLElement;
    this.sub = this.panel.querySelector('small') as HTMLElement;
    this.bar = this.panel.querySelector('i') as HTMLElement;
    document.getElementById('readout')?.appendChild(this.panel);
    // Carried on from a save made while she was going down.
    if (ctx.sim.state.damage >= 1) this.sinking = CONTACT.refloat;
  }

  private get racing(): boolean {
    const race = this.ctx.race;
    return !!race && race.call !== null && race.finish === null;
  }

  /** Every other hull near enough to matter, as this page sees them now. */
  private gather(): Other[] {
    const { ctx, others } = this;
    const s = ctx.sim.state;
    const mine = ctx.sim.boat.dimensions.loa;
    others.length = 0;
    const near = (x: number, y: number, length: number): boolean => {
      const dx = x - s.x;
      const dy = y - s.y;
      const reach = (mine + length) / 2 + 2;
      return dx * dx + dy * dy < reach * reach;
    };
    for (const b of ctx.company()) {
      // A boat not yet placed on this screen is nowhere.
      if ((b.x === 0 && b.y === 0) || !near(b.x, b.y, b.length)) continue;
      others.push({
        id: `boat-${b.peer}`, name: b.name || b.boatName || 'another boat', x: b.x, y: b.y, heading: b.heading, length: b.length, beam: b.beam,
        vx: Math.sin(b.cog) * b.sog, vy: Math.cos(b.cog) * b.sog, slop: CONTACT.slopRemote, heavy: false,
      });
    }
    const pacers = ctx.race?.pacers ?? [];
    for (let i = 0; i < pacers.length; i++) {
      const p = pacers[i];
      const ps = p.sim.state;
      const d = p.sim.boat.dimensions;
      if (!near(ps.x, ps.y, d.loa)) continue;
      const o = p.sim.out;
      others.push({
        id: `pace-${i}`, name: p.name, x: ps.x, y: ps.y, heading: ps.heading, length: d.loa, beam: d.beam,
        vx: Math.sin(o.cog) * o.sog, vy: Math.cos(o.cog) * o.sog, slop: CONTACT.slopLocal, heavy: false,
      });
    }
    for (const v of ctx.stage.traffic.vessels) {
      if (!near(v.x, v.y, v.length)) continue;
      others.push({
        id: `traffic-${v.id}`, name: v.name, x: v.x, y: v.y, heading: v.heading, length: v.length, beam: v.beam,
        vx: Math.sin(v.heading) * v.sog, vy: Math.cos(v.heading) * v.sog, slop: CONTACT.slopLocal, heavy: v.kind !== 'sail',
      });
    }
    // The boats that live here. A launch is as hard as a ferry; a yacht, a fishing boat or a kayak is not.
    for (const v of ctx.feature<Residents>('residents')?.vessels ?? []) {
      if (!near(v.x, v.y, v.length)) continue;
      others.push({
        id: v.id, name: v.name, x: v.x, y: v.y, heading: v.heading, length: v.length, beam: v.beam,
        vx: Math.sin(v.heading) * v.sog, vy: Math.cos(v.heading) * v.sog, slop: CONTACT.slopLocal, heavy: v.heavy, soft: v.kind === 'paddle',
      });
    }
    return others;
  }

  step(): void {
    const { sim } = this.ctx;
    const s = sim.state;
    if (this.sinking >= 0) {
      this.sinking -= SIM_DT;
      if (this.sinking < 0) this.refloat();
      return;
    }
    // Holed, and not by anything she hit here: a powerboat pounded to pieces, or put on the rocks at speed.
    if (s.damage >= 1) {
      this.sinking = CONTACT.refloat;
      this.broken = true;
      return;
    }
    // A collision stops her dead, and the sim will not start a boat from a dead stop in an ordinary breeze (see
    // `needsWayOn`), so she is given the first of her way once her sails are driving.
    if (this.stopped && s.hold === 'none') {
      if (s.speed > 0.5) this.stopped = false;
      else if (needsWayOn(s.speed, sim.out.targetSpeed, sim.out.aground, sim.out.underPower)) s.speed = CONTACT.wayOn;
    }
    const d = sim.boat.dimensions;
    const me: Hull = { x: s.x, y: s.y, heading: s.heading, length: d.loa, beam: d.beam };
    for (const other of this.gather()) {
      const ov = overlap(me, other, other.slop);
      if (!ov) continue;
      const o = sim.out;
      const closing = closingSpeed(Math.sin(o.cog) * o.sog, Math.cos(o.cog) * o.sog, other.vx, other.vy, ov.nx, ov.ny);
      const hit = this.watch.touch(other.id, s.t, closing, ov.depth);
      if (s.hold === 'none') {
        // Out of the other hull, and the way she had toward it is gone. What she had along it she keeps, so she slides off.
        const p = pushClear(s.heading, s.speed, s.lateral, ov, SIM_DT);
        sim.shove(p.dx, p.dy, p.dvx, p.dvy, p.turn);
        if (p.toward > 0) this.stopped = true;
        me.x = s.x;
        me.y = s.y;
        me.heading = s.heading;
      }
      if (!hit) continue;
      const damage = other.soft ? 0 : hitDamage(hit.closing, other.heavy);
      s.damage = Math.min(1, s.damage + damage);
      const holed = s.damage >= 1;
      this.news.push({ name: other.name, closing: hit.closing, damage, holed });
      const cost = collisionAward(hit.closing / KT, s.t - this.lastCost, holed);
      if (cost) {
        this.lastCost = s.t;
        this.ctx.logbook.earn(cost);
      }
      if (holed) {
        this.sinking = CONTACT.refloat;
        return;
      }
    }
    if (s.t >= this.tidyAt) {
      this.tidyAt = s.t + 10;
      this.watch.tidy(s.t);
    }
    // Lying somewhere, she is mended: by the yard at a dock, by her own crew at anchor or on a mooring.
    if (s.damage > 0 && s.hold !== 'none') s.damage = mend(s.damage, SIM_DT, this.berthed(), this.racing);
  }

  /** Where she is lying, as far as repairs go. */
  private berthed(): Berthed {
    const s = this.ctx.sim.state;
    if (s.hold === 'none') return 'none';
    if (s.hold === 'mooring' && this.ctx.places.some((p) => p.kind === 'dock' && Math.hypot(p.x - s.holdX, p.y - s.holdY) < 30)) return 'dock';
    return 'held';
  }

  /** A holed boat is brought up and put back afloat a little way off, patched, stopped and head to wind. */
  private refloat(): void {
    const { sim, world } = this.ctx;
    const s = sim.state;
    this.sinking = -1;
    const spot = deepWater(world, sim.boat.dimensions.draft, s.x, s.y, s.t, 120);
    const metres = spot ? Math.round(Math.hypot(spot.x - s.x, spot.y - s.y) / 10) * 10 : 0;
    if (s.hold !== 'none') sim.release();
    if (spot) leaveAt(sim, world, spot);
    s.damage = 0;
    this.stopped = true;
    this.ctx.alarm(spot
      ? `Afloat again ${metres} m off, with the hull patched up. ${sim.boat.power ? 'Start her with I, and treat her more gently' : 'She is head to wind: put the wheel over and sail her away'}`
      : 'Afloat again, with the hull patched up');
  }

  update(dt: number): void {
    const { ctx } = this;
    const s = ctx.sim.state;
    if (this.broken) {
      this.broken = false;
      const was = this.racing;
      if (was) ctx.race?.leave(true);
      ctx.sound.thud(1);
      ctx.alarm(`She has taken more than her hull will stand: holed and going down. The rescue boat will have her afloat again in ${CONTACT.refloat} seconds`);
    }

    // What happened since the last frame, said and heard once.
    if (this.news.length) {
      // The hardest of them speaks for the frame.
      const worst = this.news.reduce((a, b) => (b.damage > a.damage || b.holed ? b : a));
      this.news.length = 0;
      const kt = (worst.closing / KT).toFixed(1);
      const hard = Math.min(1, worst.closing / KT / 6);
      if (worst.closing > 0) {
        ctx.sound.thud(0.15 + 0.85 * hard);
        ctx.drone.shake(0.25 + 0.75 * hard);
      }
      if (worst.holed) {
        const was = this.racing;
        if (was) ctx.race?.leave(true);
        ctx.alarm(`${hitWord(worst.damage)} ${worst.name} at ${kt} kt. She is holed and going down${was ? ': you have retired from the race' : ''}. The rescue boat will have her afloat again in ${CONTACT.refloat} seconds`);
      } else if (worst.damage > 0) {
        const total = Math.max(1, Math.round(s.damage * 100));
        ctx.alarm(`${hitWord(worst.damage)} ${worst.name} at ${kt} kt. Hull damage ${total}%: she is ${Math.round((1 - damageSpeed(s.damage)) * 100)}% slower until a dock mends her`);
      } else if (worst.closing > 0) ctx.say(`Touched ${worst.name}. No damage`, 4);
    }

    // Mending: said when it starts and when it is done.
    const where = s.damage > 0 && s.damage < 1 ? this.berthed() : 'none';
    const working = where === 'dock' || (where === 'held' && !this.racing);
    if (working && (!this.mending || where !== this.where)) {
      const seconds = s.damage / (where === 'dock' ? CONTACT.dockRate : CONTACT.heldRate);
      ctx.say(where === 'dock'
        ? `The yard is mending the hull: about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds alongside`
        : `The crew are patching the hull while she lies here: about ${Math.max(1, Math.round(seconds / 60))} ${Math.round(seconds / 60) > 1 ? 'minutes' : 'minute'}. A dock is quicker`, 7);
    } else if (this.mending && s.damage <= 0) ctx.say('The hull is sound again', 5);
    this.mending = working;
    this.where = where;

    this.draw();
    void dt;
  }

  private draw(): void {
    const damage = this.ctx.sim.state.damage;
    const show = damage > 0;
    if (this.panel.hidden === show) this.panel.hidden = !show;
    if (!show) return;
    const holed = damage >= 1;
    const key = holed ? `holed|${Math.ceil(Math.max(0, this.sinking))}` : `${Math.round(damage * 100)}|${this.mending ? 1 : 0}`;
    if (key === this.shown) return;
    this.shown = key;
    const [figure, slower] = damageText(damage, damageSpeed(damage)).split(' · ');
    this.figure.textContent = figure;
    this.sub.textContent = holed ? `afloat again in ${Math.ceil(Math.max(0, this.sinking))} s` : `${slower}${this.mending ? ' · mending' : ''}`;
    this.bar.style.width = `${Math.round(damage * 100)}%`;
    this.panel.classList.toggle('bad', damage >= 0.5);
  }

  /** Her damage goes out with her position, in whole percent, for the others' fleet panels. */
  wire(): Record<string, unknown> {
    return { dm: Math.round(this.ctx.sim.state.damage * 100) };
  }

  dispose(): void {
    this.panel.remove();
  }
}
