import { KT, SIM_DT } from '@slack-tide/sim';
import type { TrafficVessel } from '../scene/traffic';
import { metAward } from '../xp/score';
import type { AboardContext, Feature } from './feature';
import { meet, metCount } from './met';
import type { Radio } from './radio';
import { residentsOf } from './residentData';
import { MAST_SHARE, ResidentView } from './residentModels';
import {
  DUEL, Roster, alongside, blankState, duelCall, duelResult, gatherFacts, givesWay, grumble, hailReply, hasRadio, introduction, keepClear, lagAfter,
  localHour, passingWords, seaOf, underSail, type Mode, type ResidentSpec, type ResidentState,
} from './residentRules';

/** A resident as the rest of the game sees her: another vessel, with what the collisions and the wind shadow need. */
export interface ResidentVessel extends TrafficVessel {
  /** Her place in the roster. */
  index: number;
  mode: Mode;
  /** True for the ones that do not give way and hurt to hit: the launches. */
  heavy: boolean;
  /** True while her sails are drawing. */
  sailing: boolean;
  mast: number;
}

const D2R = Math.PI / 180;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** She answers a hail from inside this range, metres, and is introduced inside the second. */
const HAIL_RANGE = 450;
const MEET_RANGE = 200;
/** A boat sailing past inside this is greeted, and inside the second (hull to hull, and moving) is grumbled at. */
const GREET_RANGE = 80;
const TOO_CLOSE = 7;
/** Drawn in full inside the first range, as hull and sails inside the second, and not at all beyond. */
const NEAR = 1800;
const FAR = 9000;
const SHADOW_RANGE = 350;
/** Looked at every step inside this, for the collisions. */
const CLOSE = 700;
/** How fast she is shown to turn, radians a second: a tack takes about five seconds. */
const TURN_RATE = 0.3;

/**
 * The boats that live on this water (`residentRules.ts` says where each one is; the water's `residents.json` says who
 * they are). This draws them, hands them to the rest of the game as vessels, and lets the player deal with them:
 *
 * - They are solid and the ones under sail take wind: `vessels` is read by the collisions, the wind shadow, the chart
 *   and the sea's wakes.
 * - A resident that gives way changes her speed along her own line when the player is going to pass too close, on
 *   this player's screen only, and makes the time up afterwards. The big ones hold on and sound five short blasts,
 *   and so do the water's ferries and ships.
 * - A hail (Enter) with one inside 450 m is answered by the nearest, in character, a second or two later. Sailing
 *   past close gets a greeting; much too close, a grumble. Never more than one line at a time.
 * - Sailing alongside one on the same course for a minute, she offers a race to the next place on her way.
 * - The first meeting with each counts in the logbook and earns a few points.
 *
 * It takes no key. Nothing goes on the wire: every page works the same boats out from the time.
 */
export class Residents implements Feature {
  readonly id = 'residents';
  readonly roster: Roster;
  /** The residents on the water now. The same objects every frame. */
  readonly vessels: ResidentVessel[] = [];
  private readonly all: ResidentVessel[] = [];
  private readonly views: ResidentView[] = [];
  private readonly states: ResidentState[] = [];
  /** Seconds each is behind her timetable from keeping clear, and the pace she is making now. */
  private readonly lag: number[] = [];
  private readonly pace: number[] = [];
  private readonly shown: number[] = [];
  /** The sim time at which each one's heading was last moved on. */
  private readonly turned: number[] = [];
  private readonly twa: number[] = [];
  private readonly windKt: number[] = [];
  private readonly range: number[] = [];
  private readonly greetedAt: number[] = [];
  private readonly grumbledAt: number[] = [];
  private readonly hails: number[] = [];
  private readonly hornAt = new Map<string, number>();
  private readonly metNow = new Set<number>();
  private readonly ids: string[];
  private readonly water: string;
  private readonly label = document.createElement('div');
  private labelText = '';
  private on = true;
  private frame = 0;
  private talkAt = -1e9;
  private watch = 0;
  private pending: { index: number; at: number; text: string } | null = null;
  private together = { index: -1, seconds: 0 };
  private duel: { index: number; to: string; x: number; y: number; eta: number } | null = null;
  private duelRest = -1e9;

  constructor(private readonly ctx: AboardContext) {
    const { world, stage } = ctx;
    this.water = stage.course.id;
    const file = residentsOf(this.water);
    this.roster = new Roster(file, seaOf(world, ctx.races.flatMap((r) => r.marks)));
    for (const f of this.roster.faults) console.warn(`Resident ${f}`);
    this.ids = file.boats.map((b) => b.id);
    this.roster.boats.forEach((r, index) => {
      const spec = r.spec;
      const view = new ResidentView(spec);
      stage.scene.add(view.root);
      this.views.push(view);
      this.states.push(blankState());
      this.all.push({
        id: `resident-${spec.id}`, name: spec.name, kind: underSail(spec.kind) ? 'sail' : spec.kind === 'kayak' ? 'paddle' : 'power',
        x: 0, y: 0, heading: 0, sog: 0, length: spec.length, beam: spec.beam,
        index, mode: 'away', heavy: !givesWay(spec.kind), sailing: false, mast: spec.length * MAST_SHARE,
      });
      this.lag.push(0);
      this.pace.push(1);
      this.shown.push(NaN);
      this.turned.push(0);
      this.twa.push(1);
      this.windKt.push(8);
      this.range.push(Infinity);
      this.greetedAt.push(-1e9);
      this.grumbledAt.push(-1e9);
      this.hails.push(0);
    });
    this.label.className = 'boat-label resident-label';
    this.label.style.display = 'none';
    document.body.appendChild(this.label);
    this.place(ctx.seasonNow(), true);
  }

  // ---- where they are ----------------------------------------------------------------------------

  /** Work out where each boat is. `only` near ones when called between frames. */
  private place(season: number, everyone: boolean): void {
    const s = this.ctx.sim.state;
    if (everyone) this.vessels.length = 0;
    for (let i = 0; i < this.all.length; i++) {
      if (!everyone && this.range[i] > CLOSE) continue;
      const st = this.roster.state(i, season - this.lag[i], this.states[i]);
      const v = this.all[i];
      v.mode = st.mode;
      if (st.mode === 'away') {
        this.range[i] = Infinity;
        continue;
      }
      v.x = st.x;
      v.y = st.y;
      v.sog = st.sog * this.pace[i];
      // She is shown to turn at a seamanlike rate, not to spin on the spot at a tack.
      const now = this.shown[i];
      const dt = s.t - this.turned[i];
      this.turned[i] = s.t;
      if (Number.isNaN(now) || dt < 0 || dt > 20) this.shown[i] = st.heading;
      else if (dt > 0) {
        const d = wrap(st.heading - now);
        const most = TURN_RATE * dt;
        this.shown[i] = now + Math.max(-most, Math.min(most, d));
      }
      v.heading = this.shown[i];
      v.sailing = st.mode === 'sail';
      this.range[i] = Math.hypot(st.x - s.x, st.y - s.y);
      if (everyone) this.vessels.push(v);
    }
  }

  step(): void {
    if (!this.on) return;
    const { sim } = this.ctx;
    const s = sim.state;
    // Between frames only the boats close by are moved, a few times a second: enough for the hulls to meet honestly
    // when time is run fast.
    if (s.tick % 6 !== 0) return;
    const dt = 6 * SIM_DT;
    const me = { x: s.x, y: s.y, cog: sim.out.cog, sog: sim.out.sog };
    for (let i = 0; i < this.all.length; i++) {
      if (this.range[i] > CLOSE) {
        if (this.lag[i] !== 0) this.lag[i] = lagAfter(this.lag[i], 1, dt);
        continue;
      }
      const v = this.all[i];
      const moving = v.mode === 'sail' || v.mode === 'motor' || v.mode === 'paddle';
      const cross = moving && !v.heavy ? keepClear({ x: v.x, y: v.y, heading: this.states[i].heading, sog: this.states[i].sog, length: v.length }, me, true) : null;
      const want = cross ? cross.pace : 1;
      // Her speed changes over a second or two, not at once.
      this.pace[i] += (want - this.pace[i]) * Math.min(1, dt / 1.5);
      if (Math.abs(this.pace[i] - 1) < 0.02 && want === 1) this.pace[i] = 1;
      this.lag[i] = lagAfter(this.lag[i], this.pace[i], dt);
    }
    this.place(this.ctx.seasonNow(), false);
  }

  update(dt: number, seaTime: number): void {
    const { ctx } = this;
    if (!this.on) return;
    this.frame++;
    this.place(ctx.seasonNow(), true);
    this.draw(seaTime);
    this.watch -= dt;
    if (this.watch <= 0) {
      this.watch = 0.25;
      this.company();
    }
    if (this.pending && performance.now() >= this.pending.at) {
      const p = this.pending;
      this.pending = null;
      this.speak(p.index, p.text);
    }
    this.tag();
  }

  private draw(seaTime: number): void {
    const { ctx } = this;
    const cam = ctx.drone.camera.position;
    const dark = ctx.stage.sky.elevation < -0.02;
    const t = ctx.sim.state.t;
    for (let i = 0; i < this.all.length; i++) {
      const v = this.all[i];
      const view = this.views[i];
      if (v.mode === 'away') {
        view.detail(0, false);
        continue;
      }
      const d = Math.hypot(v.x - cam.x, -v.y - cam.z);
      if (d > FAR) {
        view.detail(0, false);
        continue;
      }
      const near = d < NEAR;
      view.detail(near ? 2 : 1, d < SHADOW_RANGE);
      // The wind she has, read now and then: it changes by the hour.
      if ((this.frame + i * 7) % 40 === 0 || this.frame === 1) {
        const wind = ctx.world.wind(v.x, v.y, t);
        this.twa[i] = wrap(wind.dir - v.heading);
        this.windKt[i] = wind.speed / KT;
      }
      const st = this.states[i];
      let y = 0;
      let pitch = 0;
      let roll = 0;
      if (near) {
        const fx = Math.sin(v.heading);
        const fy = Math.cos(v.heading);
        const half = v.length * 0.35;
        const bow = ctx.stage.seaLevel(v.x + fx * half, -(v.y + fy * half), seaTime, 3);
        const stern = ctx.stage.seaLevel(v.x - fx * half, -(v.y - fy * half), seaTime, 3);
        y = (bow + stern) / 2;
        pitch = Math.atan2(bow - stern, half * 2);
        roll = Math.sin(seaTime * 1.1 + i) * 0.02;
      }
      if (view.sails) {
        // Stopped out on the water for a few minutes she is hove to, not stowed: only a boat lying to something puts her sails away.
        const set = st.mode === 'sail' || (st.mode === 'berth' && st.lie === 'drift');
        const side = this.twa[i] >= 0 ? 1 : -1;
        const off = Math.abs(this.twa[i]) / D2R;
        // Slowed to let the player by, she has luffed: sails eased and upright.
        const press = Math.min(1.3, this.windKt[i] / 14) * Math.min(1, this.pace[i]);
        const heel = (off < 30 ? 4 : off < 110 ? 17 : off < 150 ? 9 : 3) * press * D2R;
        const boom = Math.max(6, Math.min(80, 0.62 * off - 14)) * D2R;
        const clew = Math.max(9, Math.min(70, 0.5 * off - 6)) * D2R;
        view.trim(set, side, boom, clew);
        // Wind on the starboard side leans her to port.
        if (set) roll -= side * heel;
      }
      if (v.kind === 'paddle') view.stroke(seaTime * 3.2 + i, st.mode === 'paddle' ? 1 : 0);
      view.pose(v.x, y, -v.y, v.heading, pitch, roll);
      view.light(dark);
    }
  }

  /** The name of the nearest one close by, over her, the way other people's boats are named. */
  private tag(): void {
    let best = -1;
    for (let i = 0; i < this.all.length; i++) if (this.all[i].mode !== 'away' && this.range[i] < 260 && (best < 0 || this.range[i] < this.range[best])) best = i;
    if (best < 0) {
      if (this.labelText) {
        this.labelText = '';
        this.label.style.display = 'none';
      }
      return;
    }
    const v = this.all[best];
    const cam = this.ctx.drone.camera;
    const p = this.views[best].root.position;
    // Projected by hand, with nothing made on the way.
    const e = cam.matrixWorldInverse.elements;
    const top = v.kind === 'sail' ? v.mast + 2 : v.kind === 'paddle' ? 2.2 : 6;
    const wx = p.x;
    const wy = p.y + top;
    const wz = p.z;
    const vx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
    const vy = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
    const vz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
    const m = cam.projectionMatrix.elements;
    if (vz > -1) {
      this.label.style.display = 'none';
      this.labelText = '';
      return;
    }
    const nx = (m[0] * vx + m[8] * vz) / -vz;
    const ny = (m[5] * vy + m[9] * vz) / -vz;
    if (this.labelText !== v.name) {
      this.labelText = v.name;
      this.label.textContent = v.name;
      this.label.style.display = 'block';
    }
    this.label.style.transform = `translate(-50%, -100%) translate(${Math.round(((nx + 1) / 2) * window.innerWidth)}px, ${Math.round(((1 - ny) / 2) * window.innerHeight)}px)`;
  }

  // ---- dealing with them -------------------------------------------------------------------------

  private get boatName(): string {
    return this.ctx.livery.name ?? '';
  }

  private hour(): number {
    return localHour(this.ctx.world.dateAt(this.ctx.sim.state.t), this.ctx.stage.course.timeZone);
  }

  /** Put a resident's words among the hails, and on the radio if she has one. Kayakers call across the water. */
  private speak(index: number, text: string): void {
    const spec = this.roster.boats[index].spec;
    const v = this.all[index];
    this.talkAt = this.ctx.sim.state.t;
    const radio = hasRadio(spec.kind) ? this.ctx.feature<Radio>('radio') : undefined;
    if (radio) radio.transmit({ from: spec.name, text, voice: spec.id, role: spec.kind === 'launch' ? 'master' : 'skipper', accent: spec.accent, x: v.x, y: v.y, near: true });
    else this.ctx.heard(spec.name, text);
  }

  /** The first time she is close enough to make out: who she is, for the logbook. */
  private introduce(index: number): void {
    if (this.metNow.has(index)) return;
    this.metNow.add(index);
    const spec = this.roster.boats[index].spec;
    if (!meet(this.water, spec.id)) return;
    this.ctx.logbook.earn(metAward(spec.name));
    this.ctx.say(`${introduction(spec)} Boats met here: ${metCount(this.water, this.ids)} of ${this.ids.length}`, 9);
  }

  /** A few times a second: who is close, and what comes of it. */
  private company(): void {
    const { ctx } = this;
    const { sim } = ctx;
    const s = sim.state;
    const t = s.t;
    const me = { x: s.x, y: s.y, heading: s.heading, cog: sim.out.cog, sog: sim.out.sog };
    const mine = sim.boat.dimensions.loa;
    let beside = -1;
    for (let i = 0; i < this.all.length; i++) {
      const v = this.all[i];
      const r = this.range[i];
      if (v.mode === 'away' || r > MEET_RANGE) continue;
      this.introduce(i);
      const spec = this.roster.boats[i].spec;
      const quiet = t - this.talkAt > 25 && !this.pending;
      const way = Math.hypot(Math.sin(me.cog) * me.sog - Math.sin(v.heading) * v.sog, Math.cos(me.cog) * me.sog - Math.cos(v.heading) * v.sog);
      if (r < (mine + v.length) / 2 + TOO_CLOSE && way > 1.5 * KT && s.hold === 'none' && t - this.grumbledAt[i] > 120) {
        this.grumbledAt[i] = t;
        this.greetedAt[i] = t;
        this.pending = null;
        this.speak(i, grumble(spec, Math.floor(t / 120), this.boatName));
      } else if (r < GREET_RANGE && quiet && way > 0.5 && t - this.greetedAt[i] > 900 && !this.duel) {
        this.greetedAt[i] = t;
        this.speak(i, passingWords(spec, { mode: v.mode, bound: this.states[i].bound }, this.hour(), this.windKt[i], this.boatName));
      }
      if (v.sailing && alongside(v, { x: me.x, y: me.y, heading: me.heading, sog: me.sog })) beside = i;
    }
    this.horns(me, t);
    this.race(beside, me, t);
  }

  /** The big ones do not give way: five short blasts when the player stands into danger. */
  private horns(me: { x: number; y: number; cog: number; sog: number }, t: number): void {
    const check = (v: TrafficVessel): void => {
      const c = keepClear(v, me, false);
      if (!c.danger || c.tcpa > 45 || t - (this.hornAt.get(v.id) ?? -1e9) < 90) return;
      this.hornAt.set(v.id, t);
      const range = Math.hypot(v.x - me.x, v.y - me.y);
      this.ctx.sound.horn(5, Math.max(0.25, 1 - range / 500), v.length > 100);
      this.ctx.say(`Five short blasts from ${v.kind === 'ship' ? '' : 'the '}${v.name}: she is holding her course. Keep clear`, 6);
    };
    if (this.ctx.sim.state.hold !== 'none') return;
    for (const v of this.ctx.stage.traffic.vessels) if (v.kind !== 'sail') check(v);
    for (const v of this.vessels) if (v.heavy && v.sog > 1) check(v);
  }

  /** Sailing alongside a resident for a minute, she offers a race to the next place on her way. */
  private race(beside: number, me: { x: number; y: number }, t: number): void {
    const { ctx } = this;
    const season = ctx.seasonNow();
    if (this.duel) {
      const d = this.duel;
      const v = this.all[d.index];
      const spec = this.roster.boats[d.index].spec;
      const mine = Math.hypot(d.x - me.x, d.y - me.y);
      const hers = Math.hypot(d.x - v.x, d.y - v.y);
      const there = hers < DUEL.reach || v.mode === 'berth' || v.mode === 'away' || v.mode === 'work';
      if (mine < DUEL.reach || there) {
        this.duel = null;
        this.duelRest = t;
        this.pending = null;
        this.speak(d.index, duelResult(spec, d.to, mine < DUEL.reach && (!there || mine <= hers), this.boatName));
      } else if (this.range[d.index] > DUEL.lost) {
        this.duel = null;
        this.duelRest = t;
        ctx.say(`${spec.name} is out of sight. The race to ${d.to} is off`, 5);
      }
      return;
    }
    if (beside !== this.together.index) this.together = { index: beside, seconds: 0 };
    else if (beside >= 0) this.together.seconds += 0.25;
    // Nobody offers a powerboat a race: it would be no race at all.
    if (beside < 0 || this.together.seconds < DUEL.after || t - this.duelRest < 600 || ctx.race?.call || ctx.sim.boat.power) return;
    const ahead = this.roster.ahead(beside, season - this.lag[beside]);
    this.together.seconds = 0;
    if (!ahead) return;
    const far = Math.hypot(ahead.x - me.x, ahead.y - me.y);
    if (far < DUEL.shortest || far > DUEL.longest) return;
    this.duel = { index: beside, to: ahead.name, x: ahead.x, y: ahead.y, eta: ahead.eta };
    this.speak(beside, duelCall(this.roster.boats[beside].spec, ahead.name, this.boatName));
    ctx.say(`${this.all[beside].name} is racing you to ${ahead.name}, ${(far / 1852).toFixed(1)} miles on. Nothing rides on it`, 7);
  }

  status(): string {
    return this.duel ? `Racing ${this.all[this.duel.index].name} to ${this.duel.to}` : '';
  }

  /** The nearest resident inside hailing range, or -1. */
  private nearest(): number {
    let best = -1;
    for (let i = 0; i < this.all.length; i++) if (this.all[i].mode !== 'away' && this.range[i] < HAIL_RANGE && (best < 0 || this.range[i] < this.range[best])) best = i;
    return best;
  }

  withinHail(): string | null {
    const i = this.on ? this.nearest() : -1;
    return i < 0 ? null : this.all[i].name;
  }

  /** The player has hailed. The nearest resident in range answers in a moment. */
  hail(_text: string): boolean {
    if (!this.on) return false;
    const i = this.nearest();
    if (i < 0) return false;
    // One answer at a time: a second hail while she is drawing breath is heard and not answered twice.
    if (this.pending) return true;
    const { ctx } = this;
    const s = ctx.sim.state;
    this.introduce(i);
    const spec: ResidentSpec = this.roster.boats[i].spec;
    const facts = gatherFacts(ctx.world, ctx.places, s.x, s.y, s.t, this.hour());
    const text = hailReply(spec, { mode: this.all[i].mode, bound: this.states[i].bound }, facts, this.hails[i]++, this.boatName);
    this.greetedAt[i] = s.t;
    this.pending = { index: i, at: performance.now() + 1400 + 900 * ((i * 7) % 3), text };
    return true;
  }

  /** For play testing from the console: the roster, where everyone is, and a switch to measure the cost. */
  debug(): Record<string, unknown> {
    return {
      roster: this.roster, vessels: this.vessels, states: this.states, lag: this.lag, pace: this.pace, range: this.range, views: this.views,
      duel: () => this.duel,
      setEnabled: (on: boolean) => {
        this.on = on;
        if (!on) {
          this.vessels.length = 0;
          for (const v of this.views) v.detail(0, false);
          for (const v of this.all) v.mode = 'away';
          this.range.fill(Infinity);
          this.label.style.display = 'none';
          this.labelText = '';
        }
      },
    };
  }

  dispose(): void {
    for (const v of this.views) v.dispose();
    this.label.remove();
    this.vessels.length = 0;
  }
}
