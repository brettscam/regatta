/**
 * Experience points for seamanship. Everything here is pure: it reads the sim's state and outputs one step at a time
 * and says what has been earned. No DOM, no Three.js, no clocks, no `Math.random`, so the tests can pin every award.
 * The points are kept by the logbook (`net/logbook.ts`) and shown by `aboard/seamanship.ts`.
 */
import type { SimOutputs, SimState } from '@slack-tide/sim';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const KT = 0.514444;

export type AwardKind =
  | 'tack' | 'gybe' | 'groove' | 'hand' | 'gust' | 'mark' | 'finish' | 'place'
  | 'berth' | 'night' | 'ashore' | 'fish' | 'crabs' | 'seen' | 'met' | 'dive' | 'lost';

export interface Award {
  kind: AwardKind;
  /** Negative for a penalty. */
  points: number;
  /** What it was for, as the player reads it: "Clean tack". */
  label: string;
  /** True for the steady trickle of points in the groove, which is shown now and then, not every time. */
  quiet?: boolean;
}

/** What each kind is called in the logbook's table of what has earned the most. */
export const KIND_NAMES: Record<AwardKind, string> = {
  tack: 'Clean tacks',
  gybe: 'Clean gybes',
  groove: 'In the groove',
  hand: 'In the groove, by hand',
  gust: 'Gusts handled',
  mark: 'Marks rounded',
  finish: 'Races finished',
  place: 'Places in races',
  berth: 'Anchoring and mooring',
  night: 'Nights aboard',
  ashore: 'First landings',
  fish: 'Fish landed',
  crabs: 'Crab landed',
  seen: 'First sightings',
  met: 'Boats met',
  dive: 'Spearfishing and lobster',
  lost: 'Lost to knockdowns, crash gybes, groundings and collisions',
};
const KINDS = Object.keys(KIND_NAMES) as AwardKind[];

// ---- the sizes, in one place ---------------------------------------------------------------------

export const POINTS = {
  /** A tack by who did it: the pilot on her own, the crew on T, hand on the wheel with the crew trimming, all by hand. */
  tack: [3, 5, 10, 15],
  /** Extra for a tack back up to speed within `TACK.fast` and `TACK.brisk` seconds of passing head to wind, all by hand. */
  tackFast: 10,
  tackBrisk: 5,
  gybe: [2, 4, 7, 10],
  /** Each half minute in the groove, off the wind and to windward: pilot and crew, one of wheel or sheets in hand, both in hand. */
  groove: [[1, 2], [3, 5], [6, 9]],
  /** A gust ridden out on the pilot with the crew trimming, and with a hand on the wheel or the sheets. */
  gust: [3, 12],
  berth: 8,
  /** Meeting one of the boats that live on a water, the first time. */
  met: 10,
  knockdown: -15,
  crashGybe: -8,
  aground: -10,
  /** Hitting another boat, and being holed by it. */
  collision: -10,
  holed: -25,
} as const;

export const TACK = { cooldown: 90, settled: 20, limit: 40, fast: 14, brisk: 22, irons: 3, aback: 4, recover: 0.8 } as const;
export const GYBE = { cooldown: 90, settled: 20, limit: 25, least: 4, recover: 0.7 } as const;
export const GROOVE = { every: 30, grace: 3, polar: 0.9, upwind: 60 } as const;
export const GUST = { cooldown: 120, rise: 1.25, least: 2, floor: 6, shortest: 6, longest: 45, heel: 28 } as const;
export const BERTH_COOLDOWN = 1200;
export const AGROUND_COOLDOWN = 120;
/** Seconds before another collision costs anything, and the closing speed, knots, under which one costs nothing. */
export const COLLISION = { cooldown: 60, least: 1 } as const;

const NONE: Award[] = [];

type Sails = Pick<SimOutputs, 'main' | 'jib'>;

/** Both sails drawing: not luffing, not stalled, not flogging, and the jib not aback. A rolled-up jib is not counted. */
export function inTrim(o: Sails, furl: number): boolean {
  const ok = (r: Sails['main']) => !r.flogging && r.luff < 0.25 && r.stall < 0.25 && r.backed === 0;
  return ok(o.main) && (furl <= 0.1 || ok(o.jib));
}

/**
 * In the groove: sails in trim and the boat at 90 percent of her polar speed or better.
 * Where the polar cannot be had (deep downwind under plain sail, or reefed in a blow) she counts if she is making all
 * the speed her sail plan can give and that is still three quarters of the polar.
 */
export function inGroove(s: SimState, o: SimOutputs): boolean {
  if (s.hold !== 'none' || o.aground || s.maneuver || o.inIrons || o.knockedDown) return false;
  if (o.polarSpeed < 2 * KT || Math.abs(o.twa) < 30 * DEG || Math.abs(s.heel) > 30 * DEG) return false;
  if (!inTrim(o, s.furl)) return false;
  return s.speed >= GROOVE.polar * o.polarSpeed || (s.speed >= 0.95 * o.targetSpeed && s.speed >= 0.75 * o.polarSpeed);
}

/** Who is sailing her: 0 the pilot and the crew, 1 the player has the wheel or the sheets, 2 the player has both. */
export function hands(s: SimState): 0 | 1 | 2 {
  return ((s.helmMode === 'hand' ? 1 : 0) + (s.crewTrim ? 0 : 1)) as 0 | 1 | 2;
}

interface TurnWatch {
  kind: 'tack' | 'gybe';
  elapsed: number;
  entry: number;
  /** Index into POINTS.tack or POINTS.gybe: the least hands-on anyone was during the turn. */
  tier: number;
  crew: boolean;
  irons: number;
  aback: number;
}

/**
 * Watches one boat and awards points for sailing her well. Call `step` once for every fixed sim step.
 * `weight` slows the half-minute clock of the groove when time is run fast, so points there are earned at the rate
 * of the player's own time and a boat left on the pilot at sixty-four times speed does not fill the logbook.
 */
export class Seamanship {
  private t = 0;
  private started = false;
  private side = 0;
  private sideSince = 0;
  private readonly speeds = new Float32Array(12);
  private speedAt = 0;
  private speedSlot = 0;
  private turn: TurnWatch | null = null;
  private lastTack = -1e9;
  private lastGybe = -1e9;
  private crashGybes = 0;
  private knockdowns = 0;
  private crashAt = -1e9;
  private aground = false;
  private lastAground = -1e9;
  private hold: SimState['hold'] = 'none';
  private lastBerth = -1e9;
  private grooveHeld = 0;
  private grooveOut = 0;
  private baseWind = 0;
  private gust: { elapsed: number; entry: number; heel: number; bad: boolean; tier: 0 | 1 } | null = null;
  private lastGust = -1e9;

  step(s: SimState, o: SimOutputs, weight = 1): Award[] {
    if (!this.started) {
      this.started = true;
      this.side = o.twa >= 0 ? 1 : -1;
      this.crashGybes = s.crashGybes;
      this.knockdowns = s.knockdowns;
      this.aground = o.aground;
      this.hold = s.hold;
      this.baseWind = o.tws;
      this.speeds.fill(s.speed);
    }
    this.t += DT;
    const t = this.t;
    let out = NONE;
    const give = (kind: AwardKind, points: number, label: string, quiet = false): void => {
      if (out === NONE) out = [];
      out.push(quiet ? { kind, points, label, quiet } : { kind, points, label });
    };

    // ---- what went wrong: small and few ---------------------------------------------------------
    const down = s.knockdowns - this.knockdowns;
    const crashed = s.crashGybes - this.crashGybes;
    this.knockdowns = s.knockdowns;
    this.crashGybes = s.crashGybes;
    if (crashed > 0) this.crashAt = t;
    if (down > 0) give('lost', POINTS.knockdown, 'Knockdown');
    else if (crashed > 0) give('lost', POINTS.crashGybe, 'Crash gybe');
    if (o.aground && !this.aground && t - this.lastAground >= AGROUND_COOLDOWN) {
      this.lastAground = t;
      give('lost', POINTS.aground, 'Aground');
    }
    this.aground = o.aground;

    // ---- brought up: the anchor down or a mooring picked up -------------------------------------
    if (s.hold !== this.hold) {
      if (this.hold === 'none' && t - this.lastBerth >= BERTH_COOLDOWN) {
        this.lastBerth = t;
        give('berth', POINTS.berth, s.hold === 'anchor' ? 'Anchored' : 'Made fast');
      }
      this.hold = s.hold;
    }

    const sailing = s.hold === 'none' && !o.aground;
    if (!sailing) {
      this.turn = null;
      this.gust = null;
      this.grooveHeld = 0;
      this.grooveOut = 0;
      this.sideSince = t;
      this.baseWind = o.tws;
    }

    // ---- tacks and gybes ------------------------------------------------------------------------
    const side = o.twa >= 0 ? 1 : -1;
    if (side !== this.side) {
      const settled = t - this.sideSince;
      const through = Math.abs(o.twa) < 90 * DEG ? 'tack' : 'gybe';
      const last = through === 'tack' ? this.lastTack : this.lastGybe;
      const need = through === 'tack' ? TACK : GYBE;
      let entry = 0;
      for (const v of this.speeds) entry = Math.max(entry, v);
      // Back through the wind before the last turn was finished: neither counts.
      this.turn = sailing && !this.turn && settled >= need.settled && t - last >= need.cooldown && entry >= 1.5 * KT
        ? { kind: through, elapsed: 0, entry, tier: 3, crew: false, irons: 0, aback: 0 }
        : null;
      this.side = side;
      this.sideSince = t;
    }
    if (t - this.speedAt >= 1) {
      this.speedAt = t;
      this.speeds[this.speedSlot] = s.speed;
      this.speedSlot = (this.speedSlot + 1) % this.speeds.length;
    }
    const turn = this.turn;
    if (turn) {
      turn.elapsed += DT;
      // Who did it: the pilot on her own account, the crew when T was pressed, or the player.
      // Once the crew have been seen at it, it is theirs: the helm goes back to whoever had it when they finish.
      if (s.maneuver) {
        turn.crew = true;
        turn.tier = Math.min(turn.tier, s.maneuver.prevMode === 'route' ? 0 : 1);
      } else if (!turn.crew) turn.tier = Math.min(turn.tier, s.helmMode !== 'hand' ? 0 : s.crewTrim ? 2 : 3);
      if (o.inIrons) turn.irons += DT;
      if (o.jib.backed > 0.5) turn.aback += DT;
      const a = Math.abs(o.twa);
      if (turn.kind === 'tack') {
        if (turn.elapsed > TACK.limit || turn.irons > TACK.irons || turn.aback > TACK.aback) this.turn = null;
        else if (a >= 32 * DEG && a <= 80 * DEG && s.speed >= TACK.recover * turn.entry && !o.main.flogging && o.main.luff < 0.4 && (s.furl <= 0.1 || (o.jib.luff < 0.4 && o.jib.backed === 0))) {
          const quick = turn.elapsed <= TACK.fast ? POINTS.tackFast : turn.elapsed <= TACK.brisk ? POINTS.tackBrisk : 0;
          const bonus = turn.tier === 3 ? quick : turn.tier === 2 ? Math.round(quick / 2) : 0;
          give('tack', POINTS.tack[turn.tier] + bonus, turn.tier === 0 ? 'Tack on the pilot' : turn.tier === 1 ? 'Tack, crew on the sheets' : bonus >= POINTS.tackFast ? 'Fast, clean tack' : 'Clean tack');
          this.lastTack = t;
          this.turn = null;
        }
      } else {
        const crashed5 = t - this.crashAt < turn.elapsed + 5;
        if (turn.elapsed > GYBE.limit || crashed5) this.turn = null;
        else if (turn.elapsed >= GYBE.least && s.mainSide === -side && a >= 100 * DEG && a <= 172 * DEG && Math.abs(s.heel) < 30 * DEG && s.speed >= GYBE.recover * turn.entry) {
          give('gybe', POINTS.gybe[turn.tier], turn.tier === 0 ? 'Gybe on the pilot' : turn.tier === 1 ? 'Gybe, crew on the sheets' : 'Clean gybe');
          this.lastGybe = t;
          this.turn = null;
        }
      }
    }

    // ---- in the groove --------------------------------------------------------------------------
    if (sailing) {
      if (inGroove(s, o)) {
        this.grooveOut = 0;
        this.grooveHeld += DT * weight;
        if (this.grooveHeld >= GROOVE.every) {
          this.grooveHeld -= GROOVE.every;
          const who = hands(s);
          const points = POINTS.groove[who][Math.abs(o.twa) < GROOVE.upwind * DEG ? 1 : 0];
          give(who === 2 ? 'hand' : 'groove', points, who === 2 ? 'In the groove, by hand' : 'In the groove', true);
        }
      } else if (!s.maneuver) {
        // A moment out of it is forgiven. Longer, and the half minute starts again.
        this.grooveOut += DT;
        if (this.grooveOut > GROOVE.grace) this.grooveHeld = 0;
      }
    }

    // ---- a gust handled -------------------------------------------------------------------------
    const g = this.gust;
    if (!g) {
      this.baseWind += (o.tws - this.baseWind) * (DT / 60);
      const b = this.baseWind;
      if (sailing && o.tws >= GUST.floor && o.tws > b * GUST.rise && o.tws - b >= GUST.least && Math.abs(o.twa) < 110 * DEG && s.speed > 1 && !s.maneuver && t - this.lastGust >= GUST.cooldown) {
        this.gust = { elapsed: 0, entry: s.speed, heel: 0, bad: false, tier: 1 };
        this.lastGust = t;
      }
    } else {
      g.elapsed += DT;
      g.heel = Math.max(g.heel, Math.abs(s.heel));
      if (o.roundingUp || o.knockedDown || o.inIrons || crashed > 0) g.bad = true;
      if (hands(s) === 0) g.tier = 0;
      const over = o.tws < this.baseWind * 1.12;
      if (over || g.elapsed >= GUST.longest) {
        if (g.elapsed >= GUST.shortest && !g.bad && g.heel < GUST.heel * DEG && s.speed >= 0.6 * g.entry) give('gust', POINTS.gust[g.tier], 'Gust handled');
        this.gust = null;
        // A wind that came and stayed is the new wind.
        if (!over) this.baseWind = o.tws;
      }
    }
    return out;
  }
}

// ---- collisions --------------------------------------------------------------------------------------

/**
 * What hitting another boat costs. A touch under a knot costs nothing, and neither does a second hit within a minute
 * of the last one that did. Being holed costs more, whenever it happens. Blame is not weighed: both boats pay.
 * @param closingKt the speed they came together at, knots
 * @param since seconds since a collision last cost anything
 */
export function collisionAward(closingKt: number, since: number, holed = false): Award | null {
  if (holed) return { kind: 'lost', points: POINTS.holed, label: 'Holed' };
  if (!(closingKt >= COLLISION.least) || since < COLLISION.cooldown) return null;
  return { kind: 'lost', points: POINTS.collision, label: 'Collision' };
}

/** Meeting one of the boats that live on a water for the first time: sailing close enough to see who she is, or hailing her. */
export function metAward(name: string): Award {
  return { kind: 'met', points: POINTS.met, label: `Met ${name}` };
}

// ---- things the features count into the logbook ----------------------------------------------------

interface Counted { kind: AwardKind; each: number; most: number; cooldown: number; label: string }
/** Points for the logbook's counters. `cooldown` is seconds of logged time before the same counter earns again. */
export const COUNTED: Record<string, Counted> = {
  marks: { kind: 'mark', each: 10, most: 1, cooldown: 60, label: 'Mark rounded' },
  crabs: { kind: 'crabs', each: 4, most: 3, cooldown: 120, label: 'Crab landed' },
  fish: { kind: 'fish', each: 6, most: 1, cooldown: 120, label: 'Fish landed' },
  nights: { kind: 'night', each: 20, most: 1, cooldown: 1800, label: 'A night aboard' },
  ashore: { kind: 'ashore', each: 25, most: 1, cooldown: 0, label: 'First landing' },
  seen: { kind: 'seen', each: 15, most: 1, cooldown: 0, label: 'First sighting' },
};

/** What a counter going up by `n` is worth, given the seconds since it last earned anything. */
export function counted(what: string, n: number, since: number): Award | null {
  const c = COUNTED[what];
  if (!c || !(n > 0) || since < c.cooldown) return null;
  return { kind: c.kind, points: c.each * Math.min(c.most, Math.floor(n)), label: c.label };
}

// ---- racing ------------------------------------------------------------------------------------------

/** Points for each person and each pace boat beaten (and the most that can come to), and the winner's bonus over people or over pace boats only. */
export const RACE = { person: 75, pacer: 25, most: 450, win: 150, winPace: 75 } as const;
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

/** The length of a course from its first mark, the start, round the rest, in nautical miles. */
export function courseMiles(marks: Array<{ x: number; y: number }>): number {
  let m = 0;
  for (let i = 1; i < marks.length; i++) m += Math.hypot(marks[i].x - marks[i - 1].x, marks[i].y - marks[i - 1].y);
  return m / 1852;
}

export interface RaceResult {
  /** 1 for the winner. */
  place: number;
  /** Other people's boats in the race, and how many of them finished behind. */
  people: number;
  peopleBeaten: number;
  /** Autopilot pace boats in the race, and how many of them finished behind. */
  pacers: number;
  pacersBeaten: number;
  miles: number;
  /** Seconds from the gun to the finish. */
  seconds: number;
}

/**
 * Points for a race sailed to the finish. Finishing earns by the length of the course. Every boat beaten earns more,
 * a person three times a pace boat, and the winner gets a bonus on top. A course of under three miles earns in
 * proportion, so a race round two buoys a cable apart is worth little.
 */
export function raceAwards(r: RaceResult): Award[] {
  if (!(r.seconds >= 120) || !(r.miles > 0)) return [];
  const out: Award[] = [{ kind: 'finish', points: Math.round(Math.min(60, Math.max(10, 12 * r.miles))), label: 'Race finished' }];
  const others = r.people + r.pacers;
  const beaten = r.peopleBeaten + r.pacersBeaten;
  if (!others || !beaten) return out;
  const scale = Math.min(1, Math.max(0.25, r.miles / 3));
  const won = r.place === 1;
  const raw = Math.min(RACE.most, RACE.person * r.peopleBeaten + RACE.pacer * r.pacersBeaten) + (won ? (r.people > 0 ? RACE.win : RACE.winPace) : 0);
  out.push({ kind: 'place', points: Math.round(raw * scale), label: won ? `Race won against ${others} ${others === 1 ? 'boat' : 'boats'}` : `${ORDINAL[r.place - 1] ?? `${r.place}th`} of ${others + 1}` });
  return out;
}

// ---- ranks -------------------------------------------------------------------------------------------

export const RANKS: Array<{ name: string; at: number }> = [
  { name: 'Deckhand', at: 0 },
  { name: 'Able Seaman', at: 50 },
  { name: 'Bosun', at: 200 },
  { name: 'Mate', at: 600 },
  { name: 'Skipper', at: 1500 },
  { name: 'Master', at: 4000 },
  { name: 'Captain', at: 9000 },
  { name: 'Commodore', at: 18000 },
  { name: 'Admiral', at: 35000 },
];

export interface Rank {
  index: number;
  name: string;
  /** The next rank and how many points it takes, or null at the top. */
  next: { name: string; at: number } | null;
  /** 0 to 1 of the way from this rank to the next. 1 at the top. */
  progress: number;
}

export function rankOf(xp: number): Rank {
  const p = Number.isFinite(xp) && xp > 0 ? xp : 0;
  let index = 0;
  while (index + 1 < RANKS.length && p >= RANKS[index + 1].at) index++;
  const next = RANKS[index + 1] ?? null;
  return { index, name: RANKS[index].name, next, progress: next ? (p - RANKS[index].at) / (next.at - RANKS[index].at) : 1 };
}

// ---- the ledger kept in the logbook ------------------------------------------------------------------

export interface Ledger {
  xp: number;
  /** Points earned by kind, for the table of what has earned the most. `lost` is what penalties have taken, as a positive number. */
  xpBy: Partial<Record<AwardKind, number>>;
}

const whole = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** A ledger as it was saved, which may be from before there were points at all, or not a ledger. */
export function cleanLedger(raw: { xp?: unknown; xpBy?: unknown } | undefined | null): Ledger {
  const by: Ledger['xpBy'] = {};
  const from = raw && typeof raw.xpBy === 'object' && raw.xpBy ? (raw.xpBy as Record<string, unknown>) : {};
  for (const k of KINDS) {
    const v = whole(from[k]);
    if (v) by[k] = v;
  }
  return { xp: whole(raw?.xp), xpBy: by };
}

/** Add an award to a ledger in place. Points never go below zero. Returns the rank gained, if this award gained one. */
export function credit(l: Ledger, a: Award): Rank | null {
  const before = rankOf(l.xp);
  const points = Math.round(a.points);
  const taken = points < 0 ? Math.min(l.xp, -points) : 0;
  l.xp = Math.max(0, l.xp + points);
  if (points > 0) l.xpBy[a.kind] = (l.xpBy[a.kind] ?? 0) + points;
  else if (taken > 0) l.xpBy.lost = (l.xpBy.lost ?? 0) + taken;
  const after = rankOf(l.xp);
  return after.index > before.index ? after : null;
}

/** What has earned the most, best first. Penalties are not in it. */
export function topEarners(l: Ledger, n = 5): Array<{ kind: AwardKind; name: string; points: number }> {
  return KINDS.filter((k) => k !== 'lost' && (l.xpBy[k] ?? 0) > 0)
    .map((k) => ({ kind: k, name: KIND_NAMES[k], points: l.xpBy[k] ?? 0 }))
    .sort((a, b) => b.points - a.points)
    .slice(0, n);
}
