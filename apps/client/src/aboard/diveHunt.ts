/**
 * The hunt, as rules: where a shaft goes when the fish is moving, what part of the fish it finds, the fight on the
 * line that follows a body shot, the fish worth looking for on this dive, and the sea lion that comes for a stringer
 * left on the float. Pure: nothing here touches the screen, and nothing is left to chance but the hashes, so a test
 * can pin every one. The feature is `dive.ts`; the older rules (lungs, fins, who lives where) are in `diveRules.ts`.
 * Sim coordinates: x east, y north, depth `d` metres down. Directions are unit vectors (east, north, down).
 */
import { hash01 } from './catch';
import { GUN, markRadius, type Bolthole, type DiveSpecies, type Fish, type FishShape } from './diveRules';
import type { Award } from '../xp/score';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

export interface Point { x: number; y: number; d: number }

/** A fish as the shaft sees it: where it is, how it is moving and which way it faces. */
export interface Moving extends Point {
  vx: number; vy: number; vd: number;
  heading: number;
  cm: number;
  species: { shape: FishShape };
}

export interface Aim<T> {
  hit: T | null;
  /** Metres to where the shaft meets it, or the whole line on a miss. */
  range: number;
  /** A fish it passed close by without touching. */
  near: T | null;
  /** Where along the body it went in: 0 the tail, 1 the nose. */
  spot: number;
  /** How far from the middle line of the body, metres, and how fat the body was there. */
  off: number;
  radius: number;
  /** 1 side-on, 0 head-on or tail-on. */
  side: number;
}

/** Seconds the shaft takes to go `range` metres. */
export const flightTime = (range: number): number => range / GUN.speed;

/**
 * Where a shaft goes, with each fish moving on while the shaft flies. A fish is a body along its heading, as long as
 * it is, fat in the middle and thin at the nose and tail. Seen side-on it is its whole depth; head-on, only its width.
 * So a holding fish broadside is the easiest of marks, and a passing one has to be led: aimed at, the shaft arrives
 * where its tail was.
 */
export function aimAt<T extends Moving>(from: Point, dir: Point, targets: readonly T[]): Aim<T> {
  const out: Aim<T> = { hit: null, range: GUN.max, near: null, spot: 0, off: 0, radius: 0, side: 0 };
  let nearBy = 1.2;
  for (const f of targets) {
    // Where it will be when the shaft gets there: two guesses at the time of flight are plenty.
    let along = (f.x - from.x) * dir.x + (f.y - from.y) * dir.y + (f.d - from.d) * dir.d;
    let cx = f.x;
    let cy = f.y;
    let cd = f.d;
    for (let k = 0; k < 2; k++) {
      const t = flightTime(Math.max(0, along));
      cx = f.x + f.vx * t; cy = f.y + f.vy * t; cd = f.d + f.vd * t;
      along = (cx - from.x) * dir.x + (cy - from.y) * dir.y + (cd - from.d) * dir.d;
    }
    if (along < -1 || along > GUN.max + 1) continue;
    const L = f.cm / 100;
    const hx = Math.sin(f.heading);
    const hy = Math.cos(f.heading);
    // Closest approach of the shaft's line and the body's: tail at u = 0, nose at u = 1.
    const tx = cx - hx * L * 0.5 - from.x;
    const ty = cy - hy * L * 0.5 - from.y;
    const td = cd - from.d;
    const bx = hx * L;
    const by = hy * L;
    const b = dir.x * bx + dir.y * by;
    const c = L * L;
    const dd0 = dir.x * tx + dir.y * ty + dir.d * td;
    const e = bx * tx + by * ty;
    const den = c - b * b;
    let u = den > 1e-9 ? clamp01((b * dd0 - e) / den) : 0.5;
    let s = dd0 + b * u;
    if (c > 1e-9) u = clamp01((s * b - e) / c);
    s = dd0 + b * u;
    if (s < 0.2 || s > GUN.max) continue;
    const px = tx + bx * u - dir.x * s;
    const py = ty + by * u - dir.y * s;
    const pd = td - dir.d * s;
    const off = Math.hypot(px, py, pd);
    const side = Math.sqrt(Math.max(0, 1 - (dir.x * hx + dir.y * hy) ** 2));
    const radius = markRadius(f.cm, f.species.shape) * (0.45 + 0.55 * side) * (0.35 + 0.65 * Math.sin(Math.PI * clamp(u, 0.04, 0.96))) * (s > GUN.effective ? 0.5 : 1);
    if (off <= radius) {
      if (s < out.range || !out.hit) { out.hit = f; out.range = s; out.spot = u; out.off = off; out.radius = radius; out.side = side; }
    } else if (off < nearBy) { out.near = f; nearBy = off; }
  }
  if (!out.hit) out.range = GUN.max;
  return out;
}

export type Strike = 'stone' | 'body' | 'tail' | 'torn';

/**
 * How well a shaft holds, 0 to 1. Through the thick of the body from close and side-on, it holds. A big fish, a
 * long shot, a shot from end-on or one in the thin of the tail each take away from it, and under a fifth it tears
 * straight out. So the bigger the fish, the closer and squarer the shot it asks.
 */
export function holdOf(kg: number, range: number, spot: number, side: number): number {
  return clamp01(1.15 - kg / 28 - Math.max(0, range - 2.2) * 0.3 - (1 - side) * 0.25 - (spot < 0.22 ? 0.45 : 0));
}

/**
 * What the shaft did. A stone shot is through the head just behind the eye, from inside the effective range and
 * from the side: the fish is still at once and there is no fight. Anything else is a body shot with a fight to
 * follow, a tail shot that holds badly, or one that tears out.
 */
export function strikeOf(a: Pick<Aim<unknown>, 'spot' | 'off' | 'radius' | 'range' | 'side'>, kg: number): Strike {
  if (a.spot >= 0.66 && a.spot <= 0.92 && a.off <= a.radius * 0.5 && a.range <= GUN.effective && a.side >= 0.5) return 'stone';
  if (holdOf(kg, a.range, a.spot, a.side) < 0.2) return 'torn';
  return a.spot < 0.22 ? 'tail' : 'body';
}

export interface LeadCue {
  range: number;
  inRange: boolean;
  /** A shaft let go now would find it. */
  onTarget: boolean;
  /** How far ahead of it the shaft has to be aimed, metres at its range, from its speed across the line of sight. */
  lead: number;
  /** How far ahead of it she is aiming now, metres: less than nothing is behind it. */
  ahead: number;
}

/** What the muzzle bead tells her: honest about range, and about whether the lead is right. */
export function leadCue(from: Point, dir: Point, f: Moving): LeadCue {
  const rx = f.x - from.x;
  const ry = f.y - from.y;
  const rd = f.d - from.d;
  const range = Math.hypot(rx, ry, rd);
  const ux = rx / Math.max(range, 1e-6);
  const uy = ry / Math.max(range, 1e-6);
  const ud = rd / Math.max(range, 1e-6);
  const vAlong = f.vx * ux + f.vy * uy + f.vd * ud;
  const cx = f.vx - ux * vAlong;
  const cy = f.vy - uy * vAlong;
  const cd = f.vd - ud * vAlong;
  const across = Math.hypot(cx, cy, cd);
  const lead = across * flightTime(range);
  // Where the aim line passes the fish, measured along its sideways motion.
  const along = rx * dir.x + ry * dir.y + rd * dir.d;
  const ax = from.x + dir.x * along - f.x;
  const ay = from.y + dir.y * along - f.y;
  const ad = from.d + dir.d * along - f.d;
  const ahead = across > 1e-4 ? (ax * cx + ay * cy + ad * cd) / across : 0;
  const onTarget = !!aimAt(from, dir, [f]).hit && range <= GUN.effective;
  return { range, inRange: range <= GUN.effective, onTarget, lead, ahead };
}

// ---- the fight ------------------------------------------------------------------------------------------

export const LINE = {
  /** Metres of shooting line on the reel, after which she is towed. */
  long: 7,
  /** Brought in to here, a tired fish is hers. */
  landed: 1.2,
} as const;

export type FightEnd = 'landed' | 'torn' | 'wrapped' | 'holed';

export interface Fight {
  kg: number;
  /** How hard it can pull, from its weight. */
  strength: number;
  /** How well the shaft holds it, 0 to 1. */
  hold: number;
  /** 1 fresh, 0 spent. */
  energy: number;
  /** Line out, metres. */
  out: number;
  /** Its pull now, and the strain on the shaft. */
  pull: number;
  tension: number;
  /** Each 0 to 1, and at 1 the fish is lost that way: the shaft torn out, the line round the kelp, the fish in a hole. */
  tear: number;
  wrap: number;
  holed: number;
  /** Where it is heading, how far that is, and how far it has got. */
  toward: Bolthole;
  cover: number;
  made: number;
  /** Seconds since the shot, and its own rhythm. */
  t: number;
  seed: number;
  end: FightEnd | null;
}

/** Where a fish runs with a shaft in it, if the data does not say. */
export function boltholeOf(sp: Pick<DiveSpecies, 'bolthole' | 'habitat'>): Bolthole {
  return sp.bolthole ?? (sp.habitat === 'kelp' ? 'kelp' : sp.habitat === 'reef' ? 'hole' : 'run');
}

export function newFight(kg: number, hold: number, toward: Bolthole, cover: number, seed: number): Fight {
  return {
    kg, strength: clamp(Math.sqrt(kg) / 1.6, 0.4, 2.6), hold, energy: 1, out: 1.5, pull: 0, tension: 0, tear: 0, wrap: 0, holed: 0,
    toward, cover: toward === 'run' ? Infinity : Math.max(0.5, cover), made: 0, t: 0, seed: seed % 1, end: null,
  };
}

/** Its pull now: in surges, each one weaker as it tires. */
export function fightPull(f: Fight): number {
  const period = 2.4 + f.seed;
  const surge = 0.5 + 0.5 * Math.sin((2 * Math.PI * f.t) / period + f.seed * 6.283);
  return f.strength * (0.3 + 0.7 * f.energy) * (0.35 + 0.65 * surge);
}

/**
 * One step of the fight. `hauling` is her working the line in: she kicks up and back against it. Haul while it
 * surges and the shaft tears out; never haul and it makes the kelp and wraps the line, or holes up in the reef.
 * Haul between its surges and give it line in them, and it tires and comes to hand.
 */
export function stepFight(f: Fight, dt: number, hauling: boolean): FightEnd | null {
  if (f.end) return f.end;
  f.t += dt;
  const pull = f.pull = fightPull(f);
  if (hauling) {
    f.out -= dt * (0.9 - (0.4 * pull) / f.strength);
    f.tension = pull + 0.5;
    f.made -= dt * 0.5;
  } else {
    f.out += dt * pull * 0.7;
    f.tension = 0.35 * pull;
    f.made += dt * pull * 0.6;
  }
  f.out = clamp(f.out, 0.5, LINE.long);
  f.made = clamp(f.made, 0, Number.isFinite(f.cover) ? f.cover : 1e6);
  f.energy = Math.max(0, f.energy - (dt * (0.05 + 0.12 * f.tension)) / f.strength);
  const strain = f.tension - (0.6 + 1.2 * f.hold);
  f.tear = strain > 0 ? f.tear + dt * strain * 2 : Math.max(0, f.tear - dt * 0.05);
  if (f.made >= f.cover) {
    if (f.toward === 'kelp') f.wrap += dt * (hauling ? 0.1 : 0.4);
    else if (f.toward === 'hole') f.holed += dt * (hauling ? 0.08 : 0.35);
  } else {
    f.wrap = Math.max(0, f.wrap - dt * 0.1);
    f.holed = Math.max(0, f.holed - dt * 0.1);
  }
  if (f.tear >= 1) f.end = 'torn';
  else if (f.wrap >= 1) f.end = 'wrapped';
  else if (f.holed >= 1) f.end = 'holed';
  else if (f.energy <= 0.05 && f.out <= LINE.landed) f.end = 'landed';
  return f.end;
}

/** A word on the fight for the panel: what it is doing and what she should do. */
export function fightWord(f: Fight): string {
  if (f.energy < 0.15) return 'spent: work it in';
  if (f.made >= f.cover) return f.toward === 'kelp' ? 'in the kelp: haul it out before the line wraps' : 'in the reef: haul it out of the hole';
  if (f.pull > f.strength * 0.7) return 'surging: give it line';
  return 'easing: haul now';
}

// ---- the fish worth looking for ------------------------------------------------------------------------

export interface TargetPick { id: string; name: string; why: string }

/**
 * One or two kinds worth a bonus on this dive: fish that are here this half hour, in a legal size, and fair game.
 * Taken from the fish actually put on the reef, so the card is never a promise the water cannot keep. The rarer the
 * fish, the more likely it is the one named; a dawn fish at dawn most of all.
 */
export function targetsOfDive(fish: readonly Fish[], dawn: boolean, n = 2): TargetPick[] {
  const best = new Map<string, { score: number; sp: DiveSpecies; cm: number }>();
  for (const f of fish) {
    const sp = f.species;
    if (sp.protected || sp.spare || sp.bait || f.count > 1 || f.mode === 'gone' || f.mode === 'held') continue;
    if (sp.minCm !== undefined && f.cm < sp.minCm) continue;
    const score = 2 * (1 - (sp.chance ?? 1)) + (sp.dawn && dawn ? 2 : 0) + Math.min(2, f.kg / 6) + (sp.trophy && f.cm >= sp.trophy ? 1 : 0) + 0.3 * hash01(f.index, 811);
    const was = best.get(sp.id);
    if (!was || score > was.score) best.set(sp.id, { score, sp, cm: f.cm });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, n).map(({ sp }) => ({
    id: sp.id, name: sp.name,
    why: sp.dawn && dawn ? 'about at first light' : sp.chance !== undefined && sp.chance < 0.6 ? 'not here every day' : sp.minCm ? `legal ones over ${sp.minCm} cm are about` : 'about in numbers',
  }));
}

// ---- points --------------------------------------------------------------------------------------------

export const HUNT_POINTS = {
  /** The fish named on the dive's card. */
  target: 12,
  /** Through the head: no fight, no suffering. */
  stone: 5,
  /** Over the species' trophy size. */
  trophy: 10,
  /** A fish worked up the line from a body shot. */
  worked: 4,
  /** The first of a kind seen under water. */
  seen: 3,
} as const;

/** Points over and above `judge`'s, for how a kept fish was taken. */
export function huntAwards(sp: Pick<DiveSpecies, 'name' | 'trophy'>, cm: number, strike: Strike, target: boolean): Award[] {
  const out: Award[] = [];
  if (strike === 'stone') out.push({ kind: 'dive', points: HUNT_POINTS.stone, label: 'A stone shot' });
  else out.push({ kind: 'dive', points: HUNT_POINTS.worked, label: 'Worked up the line' });
  if (sp.trophy && cm >= sp.trophy) out.push({ kind: 'dive', points: HUNT_POINTS.trophy, label: `A trophy ${sp.name}` });
  if (target) out.push({ kind: 'dive', points: HUNT_POINTS.target, label: `Target of the dive: ${sp.name}` });
  return out;
}

// ---- the stringer thief --------------------------------------------------------------------------------

export const THIEF = {
  /** Further than this from the boat, metres, fish on the float are fair game. */
  far: 20,
  /** Seconds between the warning and the theft, and seconds by the float that see it off. */
  grace: 25,
  guard: 8,
  /** Seconds before it may come again, after it has been seen off or has eaten. */
  cool: 240,
  /** At most this many on one dive. */
  most: 1,
} as const;

export interface ThiefState { warned: number; guarded: number; cool: number; stolen: number; window: number }

export const newThief = (): ThiefState => ({ warned: -1, guarded: 0, cool: 0, stolen: 0, window: -1 });

export interface ThiefCase {
  /** Fish on the stringer under the float, not yet handed aboard. */
  onFloat: number;
  /** Metres from her boat. */
  fromBoat: number;
  /** She is at the surface beside her float, watching it. */
  guarding: boolean;
  /** A thief lives at this site. */
  thief: boolean;
  /** The site and the half hour, for the hash. */
  key: number;
  /** A steady clock, seconds, and the step. */
  t: number;
  dt: number;
}

/**
 * The sea lion. A stringer on the float, a long way from the boat, at a site where one lives: once a minute there is
 * a chance it comes, more with more fish. It is seen first, working along the kelp: one warning. Then she has
 * `grace` seconds to get to the float and stay by it, or get the fish to the boat; if not, it takes one. Rare, and
 * never more than once a dive.
 */
export function thiefStep(s: ThiefState, c: ThiefCase): 'warn' | 'steal' | 'leave' | null {
  if (s.cool > 0) s.cool = Math.max(0, s.cool - c.dt);
  const tempting = c.thief && c.onFloat > 0 && c.fromBoat > THIEF.far && s.stolen < THIEF.most;
  if (s.warned >= 0) {
    if (!tempting) { s.warned = -1; s.guarded = 0; s.cool = THIEF.cool; return 'leave'; }
    s.guarded = c.guarding ? s.guarded + c.dt : 0;
    if (s.guarded >= THIEF.guard) { s.warned = -1; s.guarded = 0; s.cool = THIEF.cool; return 'leave'; }
    if (c.t - s.warned >= THIEF.grace) { s.warned = -1; s.stolen++; s.cool = THIEF.cool; return 'steal'; }
    return null;
  }
  if (!tempting || s.cool > 0) return null;
  const window = Math.floor(c.t / 60);
  if (window === s.window) return null;
  s.window = window;
  if (hash01(c.key, window, 501) < 0.12 + 0.06 * Math.min(c.onFloat, 4)) { s.warned = c.t; s.guarded = 0; return 'warn'; }
  return null;
}
