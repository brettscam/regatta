/**
 * A pace boat's skipper and crew: a full sim on the route pilot, sailed as well or as badly as her skill says.
 * Nothing here draws anything, so a whole race can be sailed in a test or a script (`scripts/sailrace.ts`).
 *
 * Skill is not a speed handicap. Every boat has the same hull and the same polar. A weaker crew loses time the way
 * a real one does, and every one of these is a decision made here, on top of the sim, through controls the sim
 * already has:
 * - the start: lying further back at the gun, and slower to get going;
 * - trim: the sheets sit some degrees off their best setting and are only looked at now and then;
 * - the helm: it wanders on a reach, stands on past the layline (or tacks short of it) on a beat, tacks when there
 *   is no need, and carries on past a mark before turning;
 * - handling: the jib sheet flies for a while after every tack and gybe;
 * - sail: the reef goes in late or not at all, so in a hard wind she is overpowered, rounds up and can be knocked
 *   flat (that is the sim's doing, not this file's); the spinnaker is set late or never;
 * - a blunder now and then: a luff that all but stops her, a sheet let fly, half a minute steering at the view.
 * All of it is hashed from the race, the skipper and the time since the gun. There is no `Math.random`.
 *
 * A weak crew must still get round. Whenever the water ahead shoals she stops all of the above and sails the plain
 * pilot's course, which `scripts/sailcourse.ts` has shown to finish. And when she has made next to nothing toward
 * the finish in ten minutes (a foul tide she is too slow to stem, usually), the drinks go down and she is sailed
 * properly for the next twenty: where the best boat can get home, so can the worst.
 */
import { Sim, KT, D2R, R2D, approach, clamp, idealBoomDeg, idealJibDeg, wrapPi, wrapTau, type BoatSpec, type Environment, type SpinnakerSpec } from '@slack-tide/sim';
import { trackFix } from '@slack-tide/nav';
import { hash01 } from '../aboard/catch';
import { overlap, pushClear, type Hull } from '../aboard/contactRules';
import { drift, type Entrant, type Level } from './cast';
import { ShadedWind } from './shadow';
import { taken } from './startline';

export interface Mark { name: string; x: number; y: number }

/**
 * How much main a pace boat's crew carries for the wind: a reef at about 20 kt, a second at about 26, and each shaken out
 * once the wind has dropped a few knots below where it went in, so they do not reef and unreef in every puff.
 */
export function paceReef(twsKt: number, now: number): number {
  if (twsKt > 25.5) return 2;
  if (twsKt > 19.5) return Math.max(1, twsKt < 22.5 ? 1 : now);
  return twsKt < 16.5 ? 0 : Math.min(now, 1);
}

/**
 * Whether a pace boat's crew wants the spinnaker up. They set it on a leg where the wind is well aft and not too strong,
 * and have it down in good time before a mark whose next leg is to windward.
 * @param legTwaDeg wind angle of the straight course to the next mark, degrees, unsigned
 * @param nextTwaDeg the same for the leg after it, or null on the last leg
 * @param toGo metres to the next mark
 */
export function paceSpinnaker(up: boolean, kite: SpinnakerSpec | undefined, twsKt: number, legTwaDeg: number, nextTwaDeg: number | null, toGo: number): boolean {
  if (!kite) return false;
  // Hysteresis both ways: more margin to set it than to keep it.
  const windOk = twsKt < kite.maxTwsKt - (up ? 2 : 4);
  const angleOk = legTwaDeg > (up ? 98 : 108);
  const roomOk = nextTwaDeg === null || nextTwaDeg > 100 || toGo > (up ? 320 : 700);
  return windOk && angleOk && roomOk;
}

/** Where a pace boat lies before the gun, and the point in the start ring she makes for. */
export interface Berth {
  x: number;
  y: number;
  /** Her way through the start ring: a point off to one side of the start mark, so ten boats do not all steer for the same spot. */
  laneX: number;
  laneY: number;
}

/** Metres between boats lying side by side before the gun. Three lengths of the 38. */
export const BERTH_GAP = 38;
/** No pace boat lies further back than this, so the berths `Race.musterAtStart` gives the players, further back again, are clear of them. */
export const BERTH_BACK = 290;

/**
 * Berths for the pace boats: side by side across the line of the first leg, each as far back as her start is late.
 * Fixed by the entrants and the course, so every page puts them in the same places.
 * @param clear whether a boat can lie at a point: water under her and round her. Charted depth, not the tide, so it is the same for everyone
 */
export function startBerths(marks: readonly Mark[], entrants: readonly Entrant[], clear: (x: number, y: number) => boolean): Berth[] {
  const start = marks[0];
  const next = marks[1] ?? start;
  const along = Math.atan2(next.x - start.x, next.y - start.y);
  const at = (back: number, side: number) => ({ x: start.x - Math.sin(along) * back + Math.cos(along) * side, y: start.y - Math.cos(along) * back - Math.sin(along) * side });
  const roomy = (p: { x: number; y: number }): boolean => {
    if (!clear(p.x, p.y)) return false;
    for (let j = 0; j < 6; j++) if (!clear(p.x + Math.sin(j) * 45, p.y + Math.cos(j) * 45)) return false;
    return true;
  };
  const used: Array<{ x: number; y: number }> = [];
  const free = (p: { x: number; y: number }): boolean => used.every((u) => Math.hypot(u.x - p.x, u.y - p.y) > BERTH_GAP * 0.8);
  return entrants.map((e, i) => {
    // The first drawn lies in the middle, the rest alternately to starboard and port of her.
    const slot = (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2);
    const [near, far] = e.level.start.backM;
    const back = Math.min(BERTH_BACK, near + (far - near) * hash01(e.seed, 3));
    let spot = at(back, slot * BERTH_GAP);
    if (!roomy(spot) || !free(spot)) {
      // Shoal there: look along her own row, then nearer the mark and further from it, for the nearest place she can lie.
      let found: { x: number; y: number } | null = null;
      search: for (const b of [back, back - 50, back + 50, back - 100, 160, 130]) {
        if (b < 100 || b > BERTH_BACK) continue;
        for (let k = 0; k <= 12; k++) {
          for (const sign of k === 0 ? [1] : [1, -1]) {
            const p = at(b, slot * BERTH_GAP + sign * k * BERTH_GAP);
            if (roomy(p) && free(p)) { found = p; break search; }
          }
        }
      }
      spot = found ?? at(170, slot * BERTH_GAP);
    }
    used.push(spot);
    // Her lane through the ring: on her own side of the mark, well inside it.
    const lane = clamp(slot * 26, -100, 100);
    return { ...spot, laneX: start.x + Math.cos(along) * lane, laneY: start.y - Math.sin(along) * lane };
  });
}

/** As near the wind as the route pilot sails, radians. The sim's own figure. */
const CLOSE = 44 * D2R;
/** The sail a crew carries once it has stopped fooling about. */
const SERIOUS_SAILS: Level['sails'] = { reefLateKt: 0, reefMax: 2, kite: 'yes', kiteShyKt: 0 };
type Mode = 'route' | 'hold' | 'luff' | 'recover' | 'escape';
export type Blunder = 'luff' | 'sheets' | 'dream';

export class PaceSailor {
  readonly sim: Sim;
  readonly name: string;
  readonly skipper: string;
  readonly length: number;
  /** Her own wind: the world's, less whatever shadow another boat throws on her. `aboard/badair.ts` sets it. */
  readonly air: ShadedWind;
  /** Marks rounded, metres to the next one, and her time once she has finished. */
  leg = 0;
  toGo = 0;
  finish: number | null = null;
  /** What has gone wrong so far, for the results and for what is said on the radio. */
  blunders = 0;
  lastBlunder: Blunder | null = null;
  needlessTacks = 0;
  /** Sim steps she has spent aground, and times she had to be towed off. Both should stay 0: she is sailed to keep off the putty. */
  agroundSteps = 0;
  tows = 0;
  /** Times she stopped fooling about because she was getting nowhere. */
  rallies = 0;
  /** Times she had to be steered away from a shore the pilot was taking her onto. */
  escapes = 0;

  protected started = false;
  private launched = false;
  /** Steps since the gun. Her own clock: everything she does by chance is hashed from it. */
  private n = 0;
  private tick0 = 0;
  private readonly launchAt: number;
  private legStart: { x: number; y: number };
  private readonly lv: Level;
  private readonly seed: number;
  private readonly form: number;
  private readonly phase: number;
  private mode: Mode = 'route';
  private until = 0;
  /** Seconds of her clock until which she sails the plain pilot's course, because the water shoaled ahead. */
  private carefulTo = 0;
  /** Until this second of her clock she is sailed properly, sheets and all. */
  private seriousTo = 0;
  private checkAt = 600;
  private checkLeft = Infinity;
  private stuck = 0;
  private irons = 0;
  private backTo = 0;
  private backSide = 0;
  private laid = false;
  private turnsSeen = 0;
  private legTurns = 0;
  private dreamTo = 0;
  private dreamTurn = 0;
  private anchorAt = 0;
  // The sheets as her own crew has them, when they are not a perfect crew.
  private readonly hands: boolean;
  private main = 0;
  private jib = 0;
  private wantMain = 0;
  private wantJib = 0;
  private look = 0;
  private fumbleTo = 0;
  private flyTo = 0;
  private windSide = 0;

  constructor(readonly entrant: Entrant, private readonly berth: Berth, spec: BoatSpec, env: Environment, protected readonly marks: readonly Mark[], private readonly slot = 0) {
    this.name = entrant.who.boat;
    this.skipper = entrant.who.skipper;
    this.length = spec.dimensions.loa;
    this.lv = entrant.level;
    this.seed = entrant.seed;
    this.form = entrant.form;
    this.phase = Math.floor(hash01(this.seed, 5) * 60);
    this.hands = this.lv.trim.errDeg > 0;
    const [soon, late] = this.lv.start.lateS;
    this.launchAt = Math.round((soon + (late - soon) * hash01(this.seed, 7)) * this.form * 60);
    const start = marks[0];
    this.air = new ShadedWind(env);
    this.sim = new Sim(spec, this.air, { x: berth.x, y: berth.y, headingDeg: Math.atan2(start.x - berth.x, start.y - berth.y) * R2D, speedKt: 0 });
    this.legStart = { x: berth.x, y: berth.y };
    this.toGo = Math.hypot(start.x - berth.x, start.y - berth.y);
  }

  /** Seconds after the gun she gets going. */
  get late(): number {
    return this.launchAt / 60;
  }

  /** Metres left to sail to the finish by the marks: what orders the boats still racing, and the gap between them. */
  get remaining(): number {
    return this.finish !== null ? 0 : remainingBy(this.marks, this.leg, this.toGo);
  }

  /** The gun. She sets off on the player's clock so both feel the same wind at the same moment. */
  start(tick: number): void {
    this.tick0 = tick;
    this.n = 0;
    this.started = true;
  }

  private depth(x: number, y: number): number {
    return this.air.sample(x, y, this.sim.state.t).depth ?? Infinity;
  }

  /** Whether the water shoals within a few lengths along a heading. */
  private shoal(heading: number, margin = 2.5): boolean {
    const s = this.sim.state;
    const draft = this.sim.boat.dimensions.draft;
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    return this.depth(s.x + sin * 130, s.y + cos * 130) < draft + margin || this.depth(s.x + sin * 280, s.y + cos * 280) < draft + margin - 1;
  }

  /** Whether she is about to touch: the pilot has not turned her and the bottom is coming up a few lengths ahead. Never looks beyond the mark. */
  private danger(): boolean {
    const s = this.sim.state;
    const o = this.sim.out;
    if (o.aground) return true;
    const draft = this.sim.boat.dimensions.draft;
    const near = Math.min(60, this.toGo);
    const far = Math.min(130, this.toGo);
    for (const h of o.sog > 0.5 ? [s.heading, o.cog] : [s.heading]) {
      const sin = Math.sin(h);
      const cos = Math.cos(h);
      if (this.depth(s.x + sin * near, s.y + cos * near) < draft + 0.5 || this.depth(s.x + sin * far, s.y + cos * far) < draft + 0.2) return true;
    }
    return false;
  }

  /**
   * Steer for open water. The route pilot short-tacks off a shoal, but in a pocket with shoal on both tacks it stands
   * on into it. A crew would bear away and sail out: the nearest heading to the mark's bearing that she can sail and
   * that has water along it, held for half a minute.
   */
  private escape(next: Mark, t: number): boolean {
    const sim = this.sim;
    const s = sim.state;
    const twd = sim.out.twd;
    const need = sim.boat.dimensions.draft + 2;
    const brg = Math.atan2(next.x - s.x, next.y - s.y);
    let best = NaN;
    let bestOff = Infinity;
    for (let k = 0; k < 24; k++) {
      const h = (k * Math.PI) / 12;
      if (Math.abs(wrapPi(twd - h)) < 55 * D2R) continue;
      let clear = true;
      for (const d of [50, 110, 180, 260, 340]) clear = clear && this.depth(s.x + Math.sin(h) * d, s.y + Math.cos(h) * d) >= need;
      const off = Math.abs(wrapPi(h - brg));
      if (clear && off < bestOff) {
        best = h;
        bestOff = off;
      }
    }
    if (Number.isNaN(best)) return false;
    this.escapes++;
    this.mode = 'escape';
    this.until = t + 30;
    this.carefulTo = Math.max(this.carefulTo, t + 120);
    sim.setHelm('heading', best);
    sim.setCrewTrim(true);
    if (s.speed < 0.6) s.speed = 0.6;
    return true;
  }

  /** Whether there is water all round her, for a mistake that leaves her drifting. */
  private searoom(): boolean {
    const s = this.sim.state;
    const need = this.sim.boat.dimensions.draft + 3;
    for (let j = 0; j < 6; j++) if (this.depth(s.x + Math.sin(j * 1.047) * 220, s.y + Math.cos(j * 1.047) * 220) < need) return false;
    return true;
  }

  /** She gets going: pointed at her lane through the ring, or close-hauled toward it, with the way her start gives her. */
  private launch(): void {
    const sim = this.sim;
    const s = sim.state;
    this.launched = true;
    s.tick = this.tick0 + this.n - 1;
    s.t = s.tick * sim.dt;
    const from = this.air.sample(s.x, s.y, s.t).windDir;
    const brg = Math.atan2(this.berth.laneX - s.x, this.berth.laneY - s.y);
    const off = wrapPi(brg - from);
    s.heading = wrapTau(Math.abs(off) >= 50 * D2R ? brg : from + (off < 0 ? -1 : 1) * 50 * D2R);
    s.speed = this.lv.start.speedKt * KT;
    sim.setRoute({ x: this.berth.laneX, y: this.berth.laneY }, this.legStart);
    sim.setCrewTrim(true);
    sim.trimForWind();
    this.main = s.mainSheet;
    this.jib = sim.out.awa >= 0 ? s.jibSheetPort : s.jibSheetStbd;
    this.wantMain = this.main;
    this.wantJib = this.jib;
    this.windSide = sim.out.awa >= 0 ? 1 : -1;
    this.turnsSeen = this.legTurns = s.routeTurns;
  }

  /** One fixed step, alongside the player's. */
  step(elapsed: number): void {
    if (!this.started) return;
    this.n++;
    if (!this.launched) {
      if (this.n <= this.launchAt) return;
      this.launch();
    }
    const sim = this.sim;
    sim.step();
    const s = sim.state;
    if (sim.out.aground) this.agroundSteps++;
    if (this.finish !== null) {
      // Across the line she carries her way clear of it, then rounds up and anchors out of the way.
      if (s.hold === 'none' && (this.n >= this.anchorAt || (this.n % 30 === 0 && this.shoal(s.heading, 3)))) sim.holdAt('anchor', s.x, s.y, 18);
      return;
    }
    if (this.hands && this.n >= this.seriousTo * 60) this.trim();
    const next = this.marks[this.leg];
    const fix = trackFix(s, this.legStart, next);
    this.toGo = fix.toGo;
    // The pace boats are judged by the same rule as the player.
    if (taken(fix.toGo, fix.along, Math.hypot(next.x - this.legStart.x, next.y - this.legStart.y))) return this.rounded(next, elapsed);
    if (this.n % 60 === this.phase) this.think(next);
  }

  private rounded(mark: Mark, elapsed: number): void {
    const sim = this.sim;
    const s = sim.state;
    const t = this.n / 60;
    this.leg++;
    this.legStart = { x: mark.x, y: mark.y };
    this.laid = false;
    this.legTurns = this.turnsSeen = s.routeTurns;
    this.dreamTo = 0;
    const after = this.marks[this.leg];
    if (!after) {
      this.finish = elapsed;
      this.toGo = 0;
      sim.setSpinnaker(false);
      if (!s.maneuver) sim.setHelm('heading', s.heading);
      this.anchorAt = this.n + Math.round((4 + 2.2 * this.slot) * 60);
      return;
    }
    this.toGo = Math.hypot(after.x - s.x, after.y - s.y);
    // A sharp crew turns as the mark is given. A slack one sails on, looking for the next one.
    const wide = this.leg > 1 ? this.lv.helm.wideS * this.form * (0.5 + hash01(this.seed, 13, this.leg)) : 0;
    if (wide > 0.5 && t >= this.carefulTo && !s.maneuver && !this.shoal(s.heading, 4)) {
      this.mode = 'hold';
      this.until = t + wide;
      sim.setHelm('heading', s.heading);
    } else this.resume(after);
  }

  /** Back to the pilot, steering for the mark. */
  private resume(next: Mark): void {
    this.mode = 'route';
    this.sim.setRoute(next, this.legStart);
    this.sim.setCrewTrim(true);
    this.steer(next, this.n / 60);
  }

  /** Bear away on the tack she is on and gather way. The pilot has her back when she is sailing. */
  private recover(t: number): void {
    const sim = this.sim;
    const s = sim.state;
    this.irons = 0;
    this.mode = 'recover';
    this.until = t + 45;
    sim.setHelm('wind', (sim.out.twa >= 0 ? 1 : -1) * 62 * D2R);
    sim.setCrewTrim(true);
    // The sim holds a boat that is all but stopped at no speed at all: she is given the first of her way.
    if (s.speed < 0.6) s.speed = 0.6;
    this.look = 0;
  }

  /** Once a second: the sails she carries, whether the water is running out, and what she gets wrong next. */
  private think(next: Mark): void {
    const sim = this.sim;
    const s = sim.state;
    const o = sim.out;
    const t = this.n / 60;
    const sec = Math.floor(t);
    const serious = t < this.seriousTo;
    this.handleSails(next, serious);

    // Getting nowhere? Every ten minutes she looks at what is left to sail.
    if (t >= this.checkAt) {
      const left = this.remaining;
      if (this.checkLeft - left < 300 && !serious && (this.hands || this.lv.helm.laylineDeg > 0)) {
        this.rallies++;
        this.seriousTo = t + 1200;
        this.carefulTo = Math.max(this.carefulTo, this.seriousTo);
        sim.setCrewTrim(true);
      }
      this.checkAt = t + 600;
      this.checkLeft = left;
    }
    if (this.hands && !serious && this.seriousTo > 0) {
      // Back to her own ways: the sheets are where the good crew left them.
      this.seriousTo = 0;
      this.main = s.mainSheet;
      this.jib = o.awa >= 0 ? s.jibSheetPort : s.jibSheetStbd;
      this.windSide = o.awa >= 0 ? 1 : -1;
      this.look = 0;
    }

    // On the putty in spite of everything: after half a minute a launch tows her off. It should never come to this.
    this.stuck = o.aground ? this.stuck + 1 : 0;
    if (this.stuck >= 30) return this.towOff(next);

    if (this.shoal(s.heading) || this.shoal(o.cog)) this.carefulTo = t + 90;
    const careful = t < this.carefulTo;
    // The bottom coming up and the pilot standing on: she is steered out, whatever else she was doing.
    if (this.danger() && (this.mode !== 'escape' || o.aground || t >= this.until - 20) && this.escape(next, t)) return;
    if (this.mode === 'escape') {
      if (t >= this.until) this.resume(next);
      return;
    }
    if (this.mode !== 'route') {
      // Holding on past a mark, or luffing: over when its time is up, when the water shoals, or when the pilot has let go.
      const sailing = this.mode === 'recover' && s.speed > Math.max(1.5, 0.7 * o.polarSpeed);
      if (t < this.until && !careful && s.helmMode !== 'hand' && !sailing) return;
      // A luff leaves her all but stopped, head to wind: she has to be got sailing before the pilot can have her back.
      if (this.mode === 'luff' && !careful) return this.recover(t);
      return this.resume(next);
    }
    // In irons: a tack that did not get through. The pilot would try again from a standstill, for ever. A crew bears away and gets her sailing first.
    this.irons = o.inIrons ? this.irons + 1 : 0;
    if (this.irons >= 6) return this.recover(t);
    if (s.helmMode === 'hand') {
      // Overpowered and the pilot let go. A crew would take her back.
      sim.setRoute(next, this.legStart);
      sim.setCrewTrim(true);
    }
    this.steer(next, t);
    if (careful || s.maneuver || this.leg === 0 || this.toGo < 400) return;

    // A tack there was no call for.
    const tackS = this.lv.helm.extraTackS;
    if (tackS > 0 && o.pilotBeating && s.t - s.routeTurnAt > 90 && this.toGo > 600 && hash01(this.seed, 43, sec) < this.form / tackS) {
      const other = wrapTau(o.twd + o.twa);
      const draft = sim.boat.dimensions.draft + 3;
      let room = true;
      for (const d of [150, 300, 450]) room = room && this.depth(s.x + Math.sin(other) * d, s.y + Math.cos(other) * d) >= draft;
      if (room && sim.tack() === 'tack') {
        s.routeTurnAt = s.t;
        s.routeTurns++;
        this.needlessTacks++;
      }
      return;
    }

    // A blunder.
    const blunderS = this.lv.blunderS;
    if (blunderS > 0 && t > 60 && t > this.flyTo + 30 && t > this.dreamTo + 30 && hash01(this.seed, 47, sec) < this.form / blunderS && this.searoom()) {
      const r = hash01(this.seed, 49, sec);
      const long = hash01(this.seed, 51, sec);
      const pointing = Math.abs(wrapPi(o.twd - Math.atan2(next.x - s.x, next.y - s.y)));
      this.blunders++;
      if (r < 0.4 && Math.abs(o.twa) < 75 * D2R && !sim.spinnakerUp) {
        // Up into the wind with everything shaking until someone notices.
        this.lastBlunder = 'luff';
        this.mode = 'luff';
        this.until = t + 8 + 10 * long;
        sim.setHelm('wind', (o.twa >= 0 ? 1 : -1) * 16 * D2R);
      } else if (r < 0.75 || pointing < CLOSE + 40 * D2R) {
        // A sheet let go: a riding turn, a dropped winch handle.
        this.lastBlunder = 'sheets';
        this.flyTo = t + 10 + 15 * long;
        this.look = 0;
      } else {
        // Steering at the view.
        this.lastBlunder = 'dream';
        this.dreamTo = t + 15 + 15 * long;
        this.dreamTurn = (hash01(this.seed, 53, sec) < 0.5 ? -1 : 1) * (20 + 12 * long) * D2R;
      }
    }
  }

  /**
   * Where the pilot is told the mark is. The pilot steers for a point and tacks when it can lay it, so moving the
   * point is how the helm wanders, and how she is made to stand on past the layline or to tack short of it.
   */
  private steer(next: Mark, t: number): void {
    const s = this.sim.state;
    const o = this.sim.out;
    const target = this.leg === 0 ? { x: this.berth.laneX, y: this.berth.laneY } : next;
    const dx = target.x - s.x;
    const dy = target.y - s.y;
    const range = Math.hypot(dx, dy);
    const brg = Math.atan2(dx, dy);
    let turn = 0;
    if (t >= this.carefulTo && range > 220 && this.leg > 0) {
      // The wind angle she would have pointed straight at the mark.
      const twa = wrapPi(o.twd - brg);
      const mag = Math.abs(twa);
      const side = twa >= 0 ? 1 : -1;
      if (s.routeTurns !== this.turnsSeen) {
        this.turnsSeen = s.routeTurns;
        this.laid = mag >= CLOSE;
      }
      if (mag < CLOSE - 2 * D2R) this.laid = false;
      const lay = this.lv.helm.laylineDeg * this.form * D2R;
      let beat = false;
      if (lay > 0 && !this.laid) {
        // How far past the layline this board goes. On the first board of a leg she sometimes tacks short instead.
        const h = hash01(this.seed, 41, this.leg, s.routeTurns);
        const short = s.routeTurns === this.legTurns && hash01(this.seed, 42, this.leg) < 0.3;
        const k = short ? -0.6 * lay * h : lay * (0.3 + 0.7 * h);
        beat = mag < CLOSE + k;
        if (beat) {
          // Not yet, she thinks: the mark is put a little further to windward than it is.
          if (mag > 40 * D2R) turn = side * (mag - 40 * D2R);
        } else if (mag < CLOSE + 1.5 * D2R) {
          // She can lay it, she thinks, and she cannot.
          turn = -side * (CLOSE + 1.5 * D2R - mag);
        } else this.laid = true;
      }
      const wander = this.lv.helm.wanderDeg * this.form * D2R;
      if (!beat && mag > CLOSE + wander + 4 * D2R) {
        if (t < this.dreamTo && mag > CLOSE + 40 * D2R) turn += this.dreamTurn;
        else turn += wander * (0.7 * drift(this.seed + 5, t / 23) + 0.3 * drift(this.seed + 6, t / 7)) * clamp(range / 500, 0.25, 1);
      }
    }
    s.routeX = s.x + Math.sin(brg + turn) * range;
    s.routeY = s.y + Math.cos(brg + turn) * range;
  }

  /** The sheets in her own crew's hands: off their best setting, looked at now and then, slow through a tack. */
  private trim(): void {
    const sim = this.sim;
    const s = sim.state;
    const o = sim.out;
    const b = sim.boat;
    const lv = this.lv.trim;
    const t = this.n / 60;
    const slackMax = b.sails.jib.sheetMaxSlackDeg * D2R;
    const side = o.awa >= 0 ? 1 : -1;
    if (side !== this.windSide) {
      // Through the wind. In a tack the old sheet is held a moment, so the jib backs and pushes her head round;
      // then it is let go, and the new one is not on the winch yet.
      this.windSide = side;
      this.backTo = Math.abs(o.awa) < 70 * D2R ? t + 2.5 : 0;
      this.backSide = side;
      this.fumbleTo = Math.max(t, this.backTo) + this.lv.fumbleS * this.form * (0.6 + 0.8 * hash01(this.seed, 55, this.n));
      this.look = Math.min(this.look, this.fumbleTo);
    }
    if (t < this.backTo && side === this.backSide && Math.abs(o.awa) < 70 * D2R) {
      // The sheet that was working is now to windward, still made fast.
      if (side > 0) {
        s.jibSheetStbd = this.jib;
        s.jibSheetPort = slackMax;
      } else {
        s.jibSheetPort = this.jib;
        s.jibSheetStbd = slackMax;
      }
      return;
    }
    if (this.backTo > 0) {
      this.backTo = 0;
      this.jib = slackMax;
    }
    if (t >= this.look) {
      this.look = t + lv.lagS * (0.5 + hash01(this.seed, 57, this.n));
      const awaDeg = Math.abs(o.awa) * R2D;
      const err = lv.errDeg * this.form;
      const flying = t < this.flyTo;
      if (flying) this.look = Math.min(this.look, this.flyTo);
      const range = sim.controlRange('mainsheet');
      this.wantMain = clamp((idealBoomDeg(awaDeg) + err * drift(this.seed + 1, t / 70) + (flying ? 40 : 0)) * D2R, range.min, range.max);
      this.wantJib = flying ? slackMax : clamp((idealJibDeg(awaDeg) - b.sails.jib.sheetHardDeg + err * drift(this.seed + 2, t / 55)) * D2R, 0, slackMax);
    }
    const rate = lv.rateDegS * D2R * sim.dt;
    // The sim's crew works out the ease a gust wants. Hers gives some of it, or none.
    const gust = s.gustEase * lv.gust;
    const range = sim.controlRange('mainsheet');
    this.main = approach(this.main, clamp(this.wantMain + gust, range.min, range.max), gust > 0 ? rate * 2 : rate);
    const fumbling = t < this.fumbleTo;
    this.jib = approach(this.jib, fumbling ? slackMax : this.wantJib, fumbling ? rate * 6 : rate);
    s.mainSheet = this.main;
    if (side > 0) {
      s.jibSheetPort = this.jib;
      s.jibSheetStbd = slackMax;
    } else {
      s.jibSheetStbd = this.jib;
      s.jibSheetPort = slackMax;
    }
  }

  /** The crew reefs for the wind, and sets or douses the spinnaker for the leg: as late, or as shy, as they are. */
  private handleSails(next: Mark, serious = false): void {
    const sim = this.sim;
    const s = sim.state;
    const o = sim.out;
    const twsKt = o.tws / KT;
    const lv = serious ? SERIOUS_SAILS : this.lv.sails;
    const reef = Math.min(lv.reefMax, paceReef(twsKt - lv.reefLateKt * this.form, s.reef));
    if (reef !== s.reef) sim.setControl('reef', reef);
    if (lv.kite === 'never') {
      if (s.spin) sim.setSpinnaker(false);
      return;
    }
    const angleTo = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.abs(wrapPi(o.twd - Math.atan2(to.x - from.x, to.y - from.y))) * R2D;
    const after = this.marks[this.leg + 1];
    const want = !s.maneuver && this.mode === 'route' && paceSpinnaker(s.spin, sim.boat.sails.spinnaker, twsKt + lv.kiteShyKt * this.form, angleTo(s, next), after ? angleTo(next, after) : null, this.toGo);
    if (want !== s.spin) sim.setSpinnaker(want);
  }

  /** Towed to the nearest water that will float her and left sailing, slowly, toward the mark. */
  private towOff(next: Mark): void {
    const sim = this.sim;
    const s = sim.state;
    const need = sim.boat.dimensions.draft + 4;
    this.stuck = 0;
    this.tows++;
    this.carefulTo = this.n / 60 + 180;
    search: for (let r = 60; r <= 3000; r += 60) {
      const n = Math.max(12, Math.round((2 * Math.PI * r) / 80));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = s.x + Math.sin(a) * r;
        const y = s.y + Math.cos(a) * r;
        if (this.depth(x, y) < need) continue;
        let clear = true;
        for (let j = 0; j < 6 && clear; j++) clear = this.depth(x + Math.sin(j * 1.047) * 90, y + Math.cos(j * 1.047) * 90) >= need - 2;
        if (!clear) continue;
        s.x = x;
        s.y = y;
        break search;
      }
    }
    const from = this.air.sample(s.x, s.y, s.t).windDir;
    const off = wrapPi(Math.atan2(next.x - s.x, next.y - s.y) - from);
    s.heading = wrapTau(from + (off < 0 ? -1 : 1) * Math.max(50 * D2R, Math.abs(off)));
    s.speed = 1;
    s.lateral = 0;
    s.yawRate = 0;
    s.knock = 0;
    s.maneuver = null;
    this.resume(next);
    sim.trimForWind();
    this.main = s.mainSheet;
  }
}

/** Metres left to the finish by the marks, for a boat `toGo` metres short of mark `leg`. */
export function remainingBy(marks: readonly Mark[], leg: number, toGo: number): number {
  let m = Math.max(0, toGo);
  for (let i = Math.max(0, leg); i < marks.length - 1; i++) m += Math.hypot(marks[i + 1].x - marks[i].x, marks[i + 1].y - marks[i].y);
  return m;
}

const hullA: Hull = { x: 0, y: 0, heading: 0, length: 0, beam: 0 };
const hullB: Hull = { x: 0, y: 0, heading: 0, length: 0, beam: 0 };
const hullOf = (p: PaceSailor, out: Hull): Hull => {
  const s = p.sim.state;
  const d = p.sim.boat.dimensions;
  out.x = s.x;
  out.y = s.y;
  out.heading = s.heading;
  out.length = d.loa;
  out.beam = d.beam;
  return out;
};

/**
 * Keep the pace boats out of each other. Two hulls that touch are pushed apart, each by half, and each loses the way
 * she had toward the other, so ten boats at a start jostle and slide past and never sail through one another.
 * No damage is counted between pace boats. The player's own hull is `aboard/contact.ts`'s business.
 * @returns how many pairs were touching
 */
export function separate(boats: readonly PaceSailor[]): number {
  let touching = 0;
  for (let i = 0; i < boats.length; i++) {
    const a = boats[i];
    const as = a.sim.state;
    for (let j = i + 1; j < boats.length; j++) {
      const b = boats[j];
      const bs = b.sim.state;
      const dx = bs.x - as.x;
      const dy = bs.y - as.y;
      const reach = (a.length + b.length) / 2 + 1;
      if (dx * dx + dy * dy > reach * reach) continue;
      const ov = overlap(hullOf(a, hullA), hullOf(b, hullB), 0.2);
      if (!ov) continue;
      touching++;
      const aFree = as.hold === 'none';
      const bFree = bs.hold === 'none';
      if (!aFree && !bFree) continue;
      const share = aFree && bFree ? 0.5 : 1;
      if (aFree) {
        const p = pushClear(as.heading, as.speed, as.lateral, { depth: ov.depth * share, nx: ov.nx, ny: ov.ny }, a.sim.dt);
        a.sim.shove(p.dx, p.dy, p.dvx * 0.5, p.dvy * 0.5, p.turn);
        if (as.speed < 0.6 && as.speed >= 0) as.speed = 0.6;
      }
      if (bFree) {
        const p = pushClear(bs.heading, bs.speed, bs.lateral, { depth: ov.depth * share, nx: -ov.nx, ny: -ov.ny }, b.sim.dt);
        b.sim.shove(p.dx, p.dy, p.dvx * 0.5, p.dvy * 0.5, p.turn);
        if (bs.speed < 0.6 && bs.speed >= 0) bs.speed = 0.6;
      }
    }
  }
  return touching;
}
