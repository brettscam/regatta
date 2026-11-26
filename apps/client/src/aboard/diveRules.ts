/**
 * Going over the side: breath-hold diving, the speargun, lobster by hand, and the rules that go with them.
 * Nothing here touches the screen or the scene, and nothing is left to chance: who lives on a reef at a given half
 * hour, how big each fish is and whether a shaft finds it are all worked out from where, when and how she swims, so
 * a test can pin every one of them. The feature is `dive.ts`, the picture `diveScene.ts`, the data each water's
 * `dives.json`.
 * Sim coordinates: x east, y north, metres. Depth `d` is metres below the surface, positive down. Headings are
 * compass radians.
 */
import { hash01 } from './catch';
import type { Award } from '../xp/score';

const KT = 0.514444;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const article = (name: string) => (/^[aeiou]/i.test(name) ? 'An' : 'A');
const weightWords = (kg: number) => (kg >= 1 ? `${kg.toFixed(1)} kg` : `${Math.max(10, Math.round(kg * 100) * 10)} g`);

// ---- the data, as each water's dives.json gives it ---------------------------------------------------

export type Habitat = 'kelp' | 'reef' | 'sand' | 'open' | 'blue';
export type FishShape = 'bass' | 'jack' | 'disc' | 'flat' | 'big' | 'lion' | 'ray' | 'shark' | 'eel' | 'seal' | 'turtle' | 'needle' | 'mola';
/**
 * How it moves and how it takes flight. `hold` keeps station over the reef and hovers; `dart` is small life that
 * bursts and coasts; `circle` is a pack that passes, and circles a diver who keeps still; `streak` passes straight
 * through near the top, fast, and comes round again later; `ghost` drifts through the kelp and is gone for a long
 * while once it has seen her; `bury` lies on the sand until she is close, then lifts off in a cloud of silt and
 * settles a few metres on; `hole` stays in its hole; `loop` loops and corkscrews round her; `glide` flies over the
 * sand; `sweep` makes long slow turns; `drift` hangs in the water and comes to look.
 */
export type Flight = 'hold' | 'dart' | 'circle' | 'streak' | 'ghost' | 'bury' | 'hole' | 'loop' | 'glide' | 'sweep' | 'drift';
/** Where a speared fish heads when it is not stopped dead: into the kelp to wrap the line, into a hole in the reef, or off into open water. */
export type Bolthole = 'kelp' | 'hole' | 'run';

export interface DiveSpecies {
  id: string;
  name: string;
  habitat: Habitat;
  shape: FishShape;
  /** How it is marked: plain, mottled, sheephead, yellowtail, stripes, spotted, sand, parrot. */
  pattern?: string;
  colour: string;
  /** Smallest and largest likely to be met, centimetres. */
  size: [number, number];
  kgPerCm3: number;
  minCm?: number;
  bag?: number;
  /** 0 a fish that lets her swim up to it, 1 one that keeps six metres off. */
  wary: number;
  /** Cruising speed, m/s. */
  speed: number;
  /** How many of them a site holds, roughly. */
  common: number;
  /** When set, the share of half hours it is there at all. */
  chance?: number;
  /** A small pack that travels together, up to this many. */
  group?: number;
  /** One cloud of this many small fish. */
  school?: number;
  bait?: boolean;
  /** Mostly at first light. */
  dawn?: boolean;
  /** Pulls on the line when speared. */
  strong?: boolean;
  /** Comes to look at a diver who keeps still. */
  curious?: boolean;
  /** Met away from the named sites too. */
  anywhere?: boolean;
  /** Sites it lives at besides the ones whose `life` names it: a list of site ids, or every site of the water. */
  sites?: string[] | 'all';
  /** Set when it may never be taken, with the reason as the warden would give it. */
  protected?: string;
  /** Set for an animal the gun is not for, though no law says so: a ray, a resting shark, an eel. The words say why. */
  spare?: string;
  /** Lies on the bottom, whatever the bottom is. */
  rests?: boolean;
  /** Set when taking it is a good deed, with the reason. */
  encouraged?: string;
  /** What is said the first time she comes close to one: how to know it, and the rule. */
  say: string;
  /** How it moves and flees. Without it, the way every fish moved before there were kinds of flight. */
  flight?: Flight;
  /** Where it heads with a shaft in it. Without it, the kelp for a kelp fish, a hole for a reef fish, a run for the rest. */
  bolthole?: Bolthole;
  /** Never comes closer than this, metres: a shark in the blue that only circles, or a big fish that keeps a polite distance. */
  keepOff?: number;
  /** A sea lion or a seal that will take a fish off a stringer left on the float. */
  thief?: boolean;
  /** Meeting one is a moment: said as an alarm, the first time on each dive. */
  moment?: string;
  /** Over this size a fish is a trophy, worth more. */
  trophy?: number;
  /** The big ones are males and look it: a sheephead goes from pink to black, red and black. */
  male?: { over: number; pattern: string; colour: string; say?: string };
  /** Now and then a young one, with its own colours: a garibaldi's blue spots. A find for the logbook. */
  young?: { chance: number; size: [number, number]; pattern: string; colour: string; say: string };
}

/** Taken by hand from the bottom: a scallop off the rock, an urchin, a conch off the sand. Or only to look at, like an abalone. */
export interface HandSpec {
  id: string;
  name: string;
  kind: 'scallop' | 'urchin' | 'abalone' | 'conch';
  on: 'rock' | 'sand';
  /** Smallest and largest, centimetres across the shell or the test. */
  size: [number, number];
  minCm?: number;
  bag?: number;
  /** How many a good site holds. */
  common: number;
  protected?: string;
  colour: string;
  say: string;
}

export interface DiveZone { id: string; name: string; x: number; y: number; r: number; say: string }

export interface DiveSite {
  id: string;
  name: string;
  x: number;
  y: number;
  r: number;
  bottom: 'reef' | 'wall' | 'pinnacle' | 'sand' | 'wreck';
  /** Shallowest and deepest of the site itself, metres. A pinnacle the chart's grid is too coarse to show still stands here. */
  depth: [number, number];
  cover: 'kelp' | 'coral' | 'none';
  life: string[];
  /** 0 to 1, how good the ledges are for lobster. */
  lobster: number;
  say: string;
}

export interface LobsterRule {
  name: string;
  /** Legal minimum across the carapace, millimetres. */
  minMm: number;
  sizeMm: [number, number];
  bag: number;
  /** Open seasons as month and day, "10-01" to "03-18". A window may run over the new year. */
  season: Array<{ from: string; to: string }>;
  /** When it next opens, in words. */
  opens: string;
  say: string;
  /** The label of the practice setting that treats the season as open, where the water's own day is outside it. */
  practice?: string;
}

export interface DiveFile {
  about?: string;
  water: { visibility: [number, number]; tempC: number; tint: [number, number, number]; cover: 'kelp' | 'coral' | 'none'; say: string };
  lobster?: LobsterRule;
  species: DiveSpecies[];
  /** Taken by hand, or only looked at. */
  hand?: HandSpec[];
  zones: DiveZone[];
  sites: DiveSite[];
}

/** A water with no dives.json: she can still go in, and finds bare bottom. */
export const BARE: DiveFile = { water: { visibility: [5, 12], tempC: 15, tint: [0.07, 0.22, 0.2], cover: 'none', say: 'Green water, and not much to see in it' }, species: [], zones: [], sites: [] };

/** A whole number from a name, for the hashes. */
export function nameKey(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000003;
}

/** The named site she is over, if any: the nearest whose circle she is inside. */
export function siteAt(file: DiveFile, x: number, y: number): DiveSite | null {
  let best: DiveSite | null = null;
  let bestD = Infinity;
  for (const s of file.sites) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= s.r * 1.25 && d < bestD) { best = s; bestD = d; }
  }
  return best;
}

/** The no-take reserve she is inside, if any. */
export function zoneAt(file: DiveFile, x: number, y: number): DiveZone | null {
  for (const z of file.zones) if (Math.hypot(z.x - x, z.y - y) <= z.r) return z;
  return null;
}

// ---- getting in ----------------------------------------------------------------------------------------

export const ENTRY = {
  /** The stream, knots, over which nobody should be in the water, and over which she is warned. */
  maxStreamKt: 1.2,
  warnStreamKt: 0.6,
  /** The least water worth putting a mask in. */
  minDepth: 1.5,
  /** How close to the boat or the tender she must be to climb out, metres. */
  reach: 9,
  /** A tender must be all but stopped. */
  tenderKt: 0.8,
} as const;

export interface EntryCase { held: boolean; inTender: boolean; tenderKt: number; ashore: boolean; streamKt: number; depth: number; racing: boolean }

/** Whether she may go over the side here and now, and what to tell her if not. */
export function canDive(c: EntryCase): { ok: boolean; say: string } {
  if (c.racing) return { ok: false, say: 'Not in a race: nobody goes over the side with the fleet about' };
  if (c.ashore) return { ok: false, say: 'The dive gear is in the tender. Shove off first' };
  if (c.inTender && c.tenderKt > ENTRY.tenderKt) return { ok: false, say: 'Stop the tender first, then over the side' };
  if (!c.inTender && !c.held) return { ok: false, say: 'Never over the side under way. Anchor or pick up a mooring first (X), then 5 puts you in the water' };
  if (c.depth < ENTRY.minDepth) return { ok: false, say: 'Too shallow to dive here: she is nearly on the bottom' };
  if (c.streamKt > ENTRY.maxStreamKt) return { ok: false, say: `The stream is running ${c.streamKt.toFixed(1)} kt: more than anyone can swim against. Wait for it to ease` };
  return { ok: true, say: c.streamKt > ENTRY.warnStreamKt ? `Mind the stream: ${c.streamKt.toFixed(1)} kt. Swim up into it first, so it carries you home` : '' };
}

// ---- lungs ----------------------------------------------------------------------------------------------

/** What one diver's lungs are good for. It grows with practice: see `lungsFor`. */
export interface Lungs {
  /** 0 a beginner to 10 an expert, and what that is called. */
  level: number;
  name: string;
  /** Seconds one breath lasts lying still just under the surface. */
  hold: number;
  /** Comfortable to here, metres. Below it every metre costs much more. */
  easy: number;
  /** As deep as she goes on one breath. */
  limit: number;
  /** The surface interval owed, as a multiple of the time under. */
  recovery: number;
}

export const BREATH = {
  /** Breath left, 0 to 1, at which the urge to breathe begins, at which she is told to come up, and at which a blackout is close. */
  urge: 0.5,
  warn: 0.3,
  danger: 0.12,
  /** Seconds of slow breathing on the float, once recovered, that make a full breathe-up, and what it takes off the next dive's use of air. */
  breatheUp: 20,
  saving: 0.2,
} as const;

const LEVEL_NAMES = ['Beginner', 'Beginner', 'Novice', 'Novice', 'Practised', 'Practised', 'Strong', 'Strong', 'Deep', 'Deep', 'Expert'];

/**
 * Lungs for the practice she has put in. `points` is the logbook's `freedive`, earned by clean dives (`cleanDive`).
 * A beginner holds 45 seconds and is comfortable to 8 m; an expert two and a half minutes and 25 m, and recovers faster.
 */
export function lungsFor(points: number): Lungs {
  const level = clamp(Math.floor(Math.sqrt(Math.max(0, points) / 4)), 0, 10);
  const f = level / 10;
  const easy = 8 + 17 * f;
  return { level, name: LEVEL_NAMES[level], hold: 45 + 105 * f, easy, limit: Math.min(32, easy + 9), recovery: 1.5 - 0.5 * f };
}

/** Points toward the next level for a dive she came up from with air in hand. A blackout, a gasping finish or a mere duck under earns none. */
export function cleanDive(underSeconds: number, deepest: number, airLeft: number): number {
  if (airLeft < 0.15 || underSeconds < 15) return 0;
  return Math.round(1 + deepest / 5 + underSeconds / 30);
}

export interface Breath {
  /** 1 a full breath, 0 none. */
  air: number;
  /** Seconds under on this dive, and the deepest it has been. */
  under: number;
  deepest: number;
  /** Seconds of surface interval still owed before she is fully recovered, and the breath that comes back each second of it. */
  rest: number;
  refill: number;
  /** The breathe-up, 0 to 1: slow breathing on the float before the dive. It lowers the use of air all through the next one. */
  prep: number;
}

export const newBreath = (): Breath => ({ air: 1, under: 0, deepest: 0, rest: 0, refill: 0, prep: 0 });

/**
 * The share of a breath used each second. Lying still near the top it lasts `hold` seconds. Kicking uses it
 * faster (`effort` 0 gliding, 1 a steady kick, up to 4 thrashing), and so does depth: a little down to her
 * comfortable depth, much more below. A proper breathe-up takes a fifth off all of it.
 */
export function breathRate(l: Lungs, depth: number, effort: number, prep = 0, fighting = false): number {
  const deep = 1 + 0.02 * Math.min(depth, l.easy) + 0.06 * Math.max(0, depth - l.easy);
  return (deep * (1 + 0.6 * clamp(effort, 0, 4)) * (1 - BREATH.saving * clamp01(prep)) * (fighting ? 1.5 : 1)) / l.hold;
}

/**
 * The breath, 0 to 1, under which she blacks out. Nothing, for most of a dive. On the way up from a long deep one
 * it is not nothing: the falling pressure in the last metres takes what oxygen is left, which is where freedivers
 * get into trouble. So a deep dive has to be turned with air in hand.
 */
export function blackoutAt(l: Lungs, deepest: number, depth: number): number {
  if (deepest <= l.easy || depth > Math.min(10, deepest * 0.5)) return 0;
  return 0.1 * clamp01((deepest - l.easy) / 8);
}

/** How strong the urge to breathe is, 0 none to 1 all there is: the contractions that come well before the limit. */
export function urge(air: number): number {
  return clamp01((BREATH.urge - air) / (BREATH.urge - 0.08));
}

export type BreathCall = 'ok' | 'urge' | 'warn' | 'danger' | 'blackout';

/** One step under water. Says how she is doing. At 'blackout' she is out. */
export function holdBreath(b: Breath, l: Lungs, depth: number, effort: number, dt: number, fighting = false): BreathCall {
  b.air = Math.max(0, b.air - breathRate(l, depth, effort, b.prep, fighting) * dt);
  b.under += dt;
  b.deepest = Math.max(b.deepest, depth);
  b.rest = 0;
  if (b.air <= blackoutAt(l, b.deepest, depth)) return 'blackout';
  return b.air < BREATH.danger ? 'danger' : b.air < BREATH.warn ? 'warn' : b.air < BREATH.urge ? 'urge' : 'ok';
}

/**
 * The surface interval a dive asks for, seconds: one and a half times the time under for a beginner, down to the
 * same again for an expert, and longer the deeper it went. (Freedivers are taught at least twice the dive time.
 * She may go down again sooner, on whatever breath she has: rushing it shortens the next dive.)
 */
export function surfaceInterval(l: Lungs, underSeconds: number, deepest: number): number {
  return clamp(l.recovery * underSeconds * (1 + deepest / 40), 12, 300);
}

/** She has come up: work out the interval owed. The breathe-up starts again from nothing. */
export function surfaced(b: Breath, l: Lungs): void {
  b.rest = surfaceInterval(l, b.under, b.deepest);
  b.refill = (1 - b.air) / b.rest;
  b.under = 0;
  b.deepest = 0;
  b.prep = 0;
}

/**
 * One step breathing at the surface. Recovery first; then, if she lies still on the float, the breathe-up builds
 * over a slow count of twenty. Swimming about undoes it.
 */
export function recover(b: Breath, dt: number, resting = true): void {
  if (b.rest > 0) {
    b.air = Math.min(1, b.air + b.refill * dt);
    b.rest = Math.max(0, b.rest - dt);
    if (b.rest === 0) b.air = 1;
    return;
  }
  b.air = Math.min(1, b.air + dt / 15);
  if (b.air >= 1 && resting) b.prep = Math.min(1, b.prep + dt / BREATH.breatheUp);
  else if (!resting) b.prep = Math.max(0, b.prep - dt / 6);
}

// ---- fins -----------------------------------------------------------------------------------------------

export const KICK = {
  /** What one fin stroke adds to her speed, m/s. */
  thrust: 0.6,
  /** Seconds between strokes with the key held, and the least there can be between two however fast it is tapped. */
  rhythm: 0.9,
  fastest: 0.35,
  /** Water resistance: it grows with the square of her speed, which is why a glide is cheap and a sprint is not. */
  drag: 0.9,
} as const;

/** How hard she is working for a rate of kicking, strokes a second: a steady rhythm is 1, long glides a sixth of that, thrashing four. */
export function effortOf(kicksPerSecond: number): number {
  return clamp((kicksPerSecond * KICK.rhythm) ** 3, 0, 4);
}

/** Her speed after gliding for `dt` seconds with no stroke. */
export function glide(speed: number, dt: number): number {
  return speed / (1 + KICK.drag * Math.abs(speed) * dt);
}

// ---- the water -----------------------------------------------------------------------------------------

/** How far she can see under water, metres: the water's best on a flat day, its worst once the sea is up a metre and a half, and half that again at night. */
export function underwaterVisibility(range: [number, number], seaHeight: number, night = false): number {
  const v = range[1] - (range[1] - range[0]) * clamp01(seaHeight / 1.5);
  return night ? Math.max(5, v * 0.45) : v;
}

/** What is left of the sun's red, green and blue at a depth, each 0 to 1. Red goes within a few metres; blue lasts. */
export function lightAt(depth: number): [number, number, number] {
  const d = Math.max(0, depth);
  return [Math.exp(-d * 0.3), Math.exp(-d * 0.045), Math.exp(-d * 0.03)];
}

/**
 * The surge: the to-and-fro of the water under a sea, m/s along the way the waves run. Strong near the top in a
 * swell, gone by half a wavelength down.
 */
export function surge(height: number, period: number, depth: number, t: number): number {
  if (!(height > 0.02) || !(period > 1)) return 0;
  const length = 1.56 * period * period;
  return ((Math.PI * height) / period) * Math.exp((-2 * Math.PI * Math.max(0, depth)) / length) * Math.sin((2 * Math.PI * t) / period);
}

/** Smooth noise 0 to 1 from a point, the same everywhere for everyone. */
export function noise2(x: number, y: number, salt = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash01(ix, iy, salt);
  const b = hash01(ix + 1, iy, salt);
  const c = hash01(ix, iy + 1, salt);
  const e = hash01(ix + 1, iy + 1, salt);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + e * ux) * uy;
}

/** The bottom under a dive: how deep, whether it is rock, and whether kelp or coral grows there. */
export interface Ground {
  site: DiveSite | null;
  cover: 'kelp' | 'coral' | 'none';
  /** Depth of water, metres. 0 on land. */
  floor(x: number, y: number): number;
  /** 0 sand to 1 solid rock. */
  rock(x: number, y: number): number;
  /** True where a kelp plant or a coral head stands, one to a cell of `GROWTH_CELL` metres. */
  grows(x: number, y: number): boolean;
}

export const GROWTH_CELL = 2.6;

/**
 * The sea floor around her. Away from a site it is the chart's depth with a few rocks. At a site it is the site's
 * own shape between its shallowest and deepest, because a pinnacle or a reef is finer than the chart's grid.
 */
export function makeGround(file: DiveFile, site: DiveSite | null, chart: (x: number, y: number) => number): Ground {
  const cover = site ? site.cover : file.water.cover;
  const rock = (x: number, y: number): number => {
    const n = noise2(x / 9, y / 9, 31) * 0.7 + noise2(x / 3.1, y / 3.1, 32) * 0.3;
    if (!site) return smooth(0.6, 0.72, n);
    const near = 1 - clamp01(Math.hypot(x - site.x, y - site.y) / site.r);
    if (site.bottom === 'sand') return smooth(0.68, 0.8, n);
    if (site.bottom === 'reef' || site.bottom === 'wreck') return smooth(0.36, 0.5, n + 0.15 * near);
    return smooth(0.3, 0.45, n * 0.5 + near);
  };
  const floor = (x: number, y: number): number => {
    const g = chart(x, y);
    if (!(g > 0)) return 0;
    const relief = rock(x, y) * (0.3 + 1.3 * noise2(x / 5.5, y / 5.5, 33));
    if (!site) return Math.max(Math.min(g, 0.6), g - relief * 0.6);
    const dist = Math.hypot(x - site.x, y - site.y);
    const [lo, hi] = site.depth;
    const u = clamp01(dist / site.r);
    let shape: number;
    if (site.bottom === 'pinnacle') shape = lo + (hi - lo) * Math.pow(u, 0.85);
    else if (site.bottom === 'wall') shape = lo + (hi - lo) * smooth(0.3, 0.62, u + 0.12 * (noise2(x / 14, y / 14, 34) - 0.5));
    else shape = clamp(g, lo + (hi - lo) * 0.25 * u, hi);
    // Shoaler water than the site's own, close in under a shore, stays as the chart has it.
    if (g < lo) shape = g;
    const out = smooth(site.r, site.r * 1.6, dist);
    const d = shape * (1 - out) + g * out;
    return Math.max(Math.min(g, 0.6), d - relief);
  };
  const grows = (x: number, y: number): boolean => {
    if (cover === 'none') return false;
    const cx = Math.floor(x / GROWTH_CELL);
    const cy = Math.floor(y / GROWTH_CELL);
    if (rock(x, y) < 0.5) return false;
    const d = floor(x, y);
    if (cover === 'kelp') return d > 3 && d < 24 && hash01(cx, cy, 35) < (site ? 0.42 : 0.2);
    return d > 1.5 && d < 26 && hash01(cx, cy, 35) < (site ? 0.5 : 0.25);
  };
  return { site, cover, floor, rock, grows };
}

// ---- who lives here ------------------------------------------------------------------------------------

/** The clock is cut into half hours, and each brings its own fish to a reef. */
export const SHIFT = 1800;

export interface Fish {
  /** Which fish of the half hour this is: the same number is the same fish for every player. */
  index: number;
  species: DiveSpecies;
  cm: number;
  kg: number;
  /** For a school, how many swim in it. */
  count: number;
  x: number; y: number; d: number;
  /** Home: where it goes back to. */
  hx: number; hy: number; hd: number;
  vx: number; vy: number; vd: number;
  heading: number;
  mode: 'cruise' | 'bolt' | 'gone' | 'held';
  /** 0 calm to 1 bolting, fading over a few seconds. */
  fear: number;
  /** Seconds left of a bolt, or until a fish that left comes back. */
  left: number;
  /** Its own beat, so no two swim in step. */
  phase: number;
  /** How fast it is turning, radians a second, eased: for the bank into a turn. */
  turn?: number;
  /** A seal's corkscrew: how far over it has rolled. */
  roll?: number;
  /** Seconds it stays on edge after a fright: a spooked fish or school will not let her close for a while. */
  shy?: number;
  /** Set when it has just lifted off the bottom, for the cloud of silt. Whoever draws it clears it. */
  kicked?: number;
  /** A young one in its own colours, or a big male in his. */
  young?: boolean;
  male?: boolean;
}

export interface Conditions { night: boolean; dawn: boolean }

/**
 * The fish at a place for one half hour. Which fish and how big depends only on the site (or, away from any site,
 * the patch of sea) and the half hour: two divers on the same reef at the same time meet the same fish.
 * Where each one starts is set about `cx, cy`, the middle of the ground that has been built for the dive.
 */
export function populate(file: DiveFile, ground: Ground, cx: number, cy: number, shift: number, c: Conditions): Fish[] {
  const site = ground.site;
  const key = site ? nameKey(site.id) : hash01(Math.floor(cx / 250), Math.floor(cy / 250), 40) * 1e6;
  const list = site ? castOf(file, site) : file.species.filter((s) => s.anywhere);
  const out: Fish[] = [];
  let index = 0;
  for (const sp of list) {
    const si = nameKey(sp.id);
    let chance = sp.chance ?? 1;
    if (sp.dawn && !c.dawn) chance *= 0.15;
    // By night the reef fish are asleep in their holes and only the hunters are about.
    if (c.night && !sp.strong && !sp.bait) chance *= 0.35;
    const n0 = sp.school ? 1 : sp.group ? 2 + Math.floor(hash01(key, shift, si, 41) * (sp.group - 1)) : Math.max(1, Math.round(sp.common * (0.6 + 0.8 * hash01(key, shift, si, 42))));
    const n = hash01(key, shift, si, 43) < chance ? (site ? n0 : Math.min(n0, 1 + Math.floor(hash01(key, shift, si, 44) * 2))) : 0;
    // A pack keeps together: one place for all of them.
    const pack = sp.group ? index : -1;
    for (let i = 0; i < n; i++, index++) {
      const [lo, hi] = sp.size;
      const young = !!sp.young && hash01(key, shift, index, 47) < sp.young.chance;
      const cm = young ? Math.round(sp.young!.size[0] + (sp.young!.size[1] - sp.young!.size[0]) * hash01(key, shift, index, 45)) : Math.round(lo + (hi - lo) * Math.pow(hash01(key, shift, index, 45), 1.6));
      const place = homeFor(sp, ground, cx, cy, key, shift, pack >= 0 ? pack : index);
      const off = pack >= 0 ? i * 1.3 : 0;
      const phase = hash01(key, shift, index, 46) * Math.PI * 2;
      out.push({
        index, species: sp, cm, kg: sp.kgPerCm3 * cm * cm * cm, count: sp.school ?? 1,
        x: place.x + Math.sin(phase) * off, y: place.y + Math.cos(phase) * off, d: Math.max(0.6, Math.min(place.d, ground.floor(place.x + Math.sin(phase) * off, place.y + Math.cos(phase) * off) - 0.06)),
        hx: place.x, hy: place.y, hd: place.d, vx: 0, vy: 0, vd: 0, heading: phase, mode: 'cruise', fear: 0, left: 0, phase,
        turn: 0, roll: 0, shy: 0, kicked: 0, young, male: !young && !!sp.male && cm >= sp.male.over,
      });
    }
  }
  // The hunters work the bait: a pack of them is never far from the school.
  const bait = out.find((f) => f.species.bait);
  if (bait) for (const f of out) if (f.species.strong && f.species.habitat === 'open') { f.hx = bait.hx + 5 * Math.sin(f.phase); f.hy = bait.hy + 5 * Math.cos(f.phase); f.hd = Math.max(0.6, Math.min(bait.hd, ground.floor(f.hx, f.hy) - 0.5)); f.x = f.hx; f.y = f.hy; f.d = f.hd; }
  return out;
}

/** Who lives at a site: the kinds its `life` names, then the kinds that name it (or every site) themselves. */
export function castOf(file: DiveFile, site: DiveSite): DiveSpecies[] {
  const out = site.life.map((id) => file.species.find((s) => s.id === id)).filter((s): s is DiveSpecies => !!s);
  for (const sp of file.species) if (!out.includes(sp) && (sp.sites === 'all' || sp.sites?.includes(site.id))) out.push(sp);
  return out;
}

/** How far from the middle of the built ground anything is put, metres. */
export const LIFE_RADIUS = 30;

function homeFor(sp: DiveSpecies, g: Ground, cx: number, cy: number, key: number, shift: number, index: number): { x: number; y: number; d: number } {
  let x = cx;
  let y = cy;
  let d = 3;
  for (let attempt = 0; attempt < 14; attempt++) {
    const a = hash01(key, shift, index, 50 + attempt) * Math.PI * 2;
    const far = sp.habitat === 'open' ? 12 + 16 * hash01(key, shift, index, 70 + attempt) : 4 + (LIFE_RADIUS - 4) * Math.sqrt(hash01(key, shift, index, 70 + attempt));
    x = cx + Math.sin(a) * far;
    y = cy + Math.cos(a) * far;
    const floor = g.floor(x, y);
    if (floor < 2) continue;
    const h = hash01(key, shift, index, 90);
    const rock = g.rock(x, y);
    if (sp.rests && sp.habitat !== 'sand') { d = floor - 0.08; if (rock > 0.4) break; }
    else if (sp.habitat === 'sand') { d = floor - 0.06; if (rock < 0.25) break; }
    else if (sp.habitat === 'reef') { d = floor - (0.5 + 0.9 * h); if (rock > 0.5) break; }
    else if (sp.habitat === 'kelp') { d = clamp(2 + h * (floor - 3.5), 1.5, floor - 0.8); if (g.grows(x, y) || (g.cover !== 'kelp' && rock > 0.5)) break; }
    else if (sp.habitat === 'blue') {
      // Out at the edge of what she can see, in mid-water.
      const a2 = hash01(key, shift, index, 95) * Math.PI * 2;
      const far2 = 18 + 8 * hash01(key, shift, index, 96);
      x = cx + Math.sin(a2) * far2;
      y = cy + Math.cos(a2) * far2;
      d = clamp(3 + h * 6, 1.5, Math.max(1.5, g.floor(x, y) - 2));
      break;
    } else { d = clamp(2 + h * Math.min(7, floor - 3), 1.5, Math.max(1.5, floor - 1)); break; }
  }
  return { x, y, d: Math.max(0.6, d) };
}

export interface Lobster {
  index: number;
  x: number; y: number; d: number;
  /** The way it faces: out of its hole. */
  heading: number;
  /** Across the carapace, millimetres. */
  mm: number;
  /** Too far back in its hole to reach. Only by day. */
  deep: boolean;
  /** Out walking on the reef. Only by night. */
  out: boolean;
  mode: 'there' | 'fled' | 'caught';
  /** Seconds until one that shot off backwards settles again. */
  left: number;
  /** How far back in its hole, 0 at the mouth to 1 out of reach. A careless approach sends it back; a patient one lets it come forward. */
  back?: number;
}

/** The lobster at a place for one half hour: under the ledges where the bottom is rock. More of them at a good site. */
export function lobstersAt(file: DiveFile, ground: Ground, cx: number, cy: number, shift: number, night: boolean): Lobster[] {
  const rule = file.lobster;
  if (!rule) return [];
  const site = ground.site;
  const key = (site ? nameKey(site.id) : hash01(Math.floor(cx / 250), Math.floor(cy / 250), 40) * 1e6) + 17;
  const n = site ? Math.round(site.lobster * (3 + 4 * hash01(key, shift, 60))) : hash01(key, shift, 60) < 0.3 ? 1 : 0;
  const out: Lobster[] = [];
  for (let index = 0; index < n; index++) {
    let x = cx;
    let y = cy;
    let ok = false;
    for (let attempt = 0; attempt < 16 && !ok; attempt++) {
      const a = hash01(key, shift, index, 61 + attempt) * Math.PI * 2;
      const far = 5 + (LIFE_RADIUS - 6) * Math.sqrt(hash01(key, shift, index, 80 + attempt));
      x = cx + Math.sin(a) * far;
      y = cy + Math.cos(a) * far;
      ok = ground.rock(x, y) > 0.6 && ground.floor(x, y) > 2.5;
    }
    if (!ok) continue;
    const [lo, hi] = rule.sizeMm;
    const mm = Math.round(lo + (hi - lo) * Math.pow(hash01(key, shift, index, 62), 1.3));
    const out2 = night && hash01(key, shift, index, 63) < 0.75;
    out.push({ index, x, y, d: ground.floor(x, y) - 0.12, heading: hash01(key, shift, index, 64) * Math.PI * 2, mm, deep: !night && hash01(key, shift, index, 65) < 0.4, out: out2, mode: 'there', left: 0, back: !night && hash01(key, shift, index, 65) < 0.4 ? 1 : 0 });
  }
  return out;
}

// ---- how a fish takes to a diver -----------------------------------------------------------------------

export interface Diver { x: number; y: number; d: number; vx: number; vy: number; vd: number }

/**
 * How frightened a fish is of her: 0 not at all, 1 and it bolts. A wary fish keeps up to six metres off. Swimming
 * at it brings that out further; keeping still, coming down from above, coming up behind it, or having kelp or a
 * rock between them each bring it in, and that is the whole game of stalking.
 */
export function alarm(f: Pick<Fish, 'x' | 'y' | 'd' | 'heading' | 'species' | 'shy'>, diver: Diver, cover: boolean): number {
  const dx = f.x - diver.x;
  const dy = f.y - diver.y;
  const dd = f.d - diver.d;
  const dist = Math.hypot(dx, dy, dd);
  if (dist < 1e-6) return f.species.wary > 0 ? 1 : 0;
  const speed = Math.hypot(diver.vx, diver.vy, diver.vd);
  const closing = Math.max(0, (diver.vx * dx + diver.vy * dy + diver.vd * dd) / dist);
  let reach = f.species.wary * 6 * (1 + 1.5 * closing);
  if (speed < 0.2) reach *= f.species.curious ? 0.4 : 0.6;
  if (dd > 1) reach *= 0.75;
  // Behind it: the fish is heading away from her.
  if ((Math.sin(f.heading) * -dx + Math.cos(f.heading) * -dy) / Math.max(1e-6, Math.hypot(dx, dy)) < -0.5) reach *= 0.7;
  if (cover) reach *= 0.7;
  // Frightened once already, it keeps her further off for a minute.
  reach *= 1 + 0.8 * clamp01((f.shy ?? 0) / 30);
  if (!(reach > 0)) return 0;
  return clamp01((reach - dist) / (0.4 * reach));
}

/** A shaft that missed, or any bang in the water: everything close bolts and everything in earshot is on edge. */
export function spook(fish: Fish[], x: number, y: number, d: number): number {
  let n = 0;
  for (const f of fish) {
    if (f.mode === 'held' || f.mode === 'gone') continue;
    const dist = Math.hypot(f.x - x, f.y - y, f.d - d);
    if (f.species.wary <= 0) continue;
    if (dist < 8) { f.fear = 1; n++; } else if (dist < 16) f.fear = Math.max(f.fear, 0.6);
    if (dist < 16) f.shy = SHY;
  }
  return n;
}

/** Seconds a fish stays shy after a fright. */
export const SHY = 60;

/** Move one fish on by `dt` seconds. `t` is any steady clock. */
export function stepFish(f: Fish, diver: Diver, dt: number, t: number, floorAt: (x: number, y: number) => number, cover: boolean): void {
  if (f.mode === 'held') return;
  if (f.mode === 'gone') {
    f.left -= dt;
    if (f.left <= 0) { f.mode = 'cruise'; f.fear = 0; f.x = f.hx + 14 * Math.sin(f.phase); f.y = f.hy + 14 * Math.cos(f.phase); f.d = f.hd; }
    return;
  }
  const sp = f.species;
  const flight = sp.flight;
  const onBottom = sp.habitat === 'sand' || !!sp.rests;
  const dx = f.x - diver.x;
  const dy = f.y - diver.y;
  const dd = f.d - diver.d;
  const dist = Math.max(1e-3, Math.hypot(dx, dy, dd));
  if (f.shy) f.shy = Math.max(0, f.shy - dt);
  f.fear = Math.max(f.fear - dt * 0.3, alarm(f, diver, cover));
  let tx: number;
  let ty: number;
  let td: number;
  let pace = sp.speed;
  const still = Math.hypot(diver.vx, diver.vy, diver.vd) < 0.25;
  if (f.mode !== 'bolt' && f.fear >= 1) {
    f.mode = 'bolt';
    f.left = flight === 'bury' ? 2.2 : 3.5;
    if (onBottom) f.kicked = 1;
  }
  if (f.mode === 'bolt') {
    // Straight away from her, and a little down toward the bottom.
    // A ray, a halibut or a shark off the sand lifts as it goes.
    tx = f.x + (dx / dist) * 10; ty = f.y + (dy / dist) * 10; td = f.d + (onBottom ? (flight === 'bury' ? -1.1 : -2.5) : 1.5);
    pace = Math.max(1.8, sp.speed * 3);
    f.left -= dt;
    if (f.left <= 0) {
      if ((sp.wary > 0.5 || flight === 'ghost') && dist > 9) { f.mode = 'gone'; f.left = flight === 'ghost' ? 240 : 40 + 60 * sp.wary; return; }
      f.mode = 'cruise';
      f.fear = 0.5;
      // A flatfish settles where it comes down, and that is its place now.
      if (flight === 'bury' || flight === 'glide') { f.hx = f.x; f.hy = f.y; }
    }
  } else if (sp.keepOff && !sp.curious) {
    // Out in the blue, circling at the edge of what she can see, and never closer.
    const a = f.phase + t * (sp.speed / sp.keepOff);
    tx = diver.x + Math.sin(a) * sp.keepOff; ty = diver.y + Math.cos(a) * sp.keepOff; td = f.hd;
  } else if (flight === 'loop' && dist < 22 && f.fear < 0.6) {
    // A seal or a sea lion plays: loops round her, up and down, turning over as it goes.
    const a = f.phase + t * 0.85;
    tx = diver.x + Math.sin(a) * 3.4; ty = diver.y + Math.cos(a) * 3.4; td = Math.max(1, diver.d + 1.6 * Math.sin(t * 0.7 + f.phase));
    pace = sp.speed * 1.1;
    f.roll = ((f.roll ?? 0) + dt * 2.2) % (Math.PI * 2);
  } else if (sp.curious && still && f.fear < 0.3 && dist < 14) {
    // Come and have a look: the bold ones right up to the mask, the wary ones round her at a few metres.
    const ring = sp.keepOff ?? (sp.wary > 0.5 ? 3.2 : 1.7);
    const a = f.phase + t * (sp.wary > 0.5 ? 0.35 : 0.12 + 0.3 * Math.max(0, sp.speed - 0.6)) * (flight === 'drift' ? 0.4 : 1);
    tx = diver.x + Math.sin(a) * ring; ty = diver.y + Math.cos(a) * ring; td = diver.d + 0.3 * Math.sin(t * 0.4 + f.phase);
    if (flight === 'drift') pace = Math.min(pace, 0.35);
  } else if (flight === 'streak') {
    // Straight through, near the top, fast; out of sight and round again.
    const hx = Math.sin(f.phase);
    const hy = Math.cos(f.phase);
    const along = (f.x - f.hx) * hx + (f.y - f.hy) * hy;
    if (along > 36) { f.x -= hx * 72; f.y -= hy * 72; }
    tx = f.x + hx * 6; ty = f.y + hy * 6; td = f.hd;
    pace = sp.speed * (1 + f.fear);
  } else {
    const roam = flight === 'hold' ? 1.3 : flight === 'dart' ? 2 : flight === 'ghost' ? 6 : flight === 'sweep' ? 11 : flight === 'circle' ? 7 : flight === 'glide' ? 3 : sp.habitat === 'open' ? 9 : onBottom ? 0.4 : 2.5;
    const w = (sp.speed / Math.max(2, roam)) * 0.8 * (flight === 'ghost' || flight === 'sweep' ? 0.5 : 1);
    tx = f.hx + Math.sin(t * w + f.phase) * roam; ty = f.hy + Math.cos(t * w * 0.83 + f.phase * 1.7) * roam; td = f.hd + (onBottom ? 0 : (flight === 'hold' ? 0.25 : 0.5) * Math.sin(t * 0.21 + f.phase));
    // Small fish go in bursts and coast between.
    if (flight === 'dart') pace *= 0.3 + 2.2 * Math.max(0, Math.sin(t * 1.7 + f.phase * 3)) ** 4;
    if (f.fear > 0) {
      // On edge: it gives ground, keeping its distance.
      tx += (dx / dist) * 6 * f.fear; ty += (dy / dist) * 6 * f.fear;
      pace *= 1 + f.fear;
    }
  }
  const ex = tx - f.x;
  const ey = ty - f.y;
  const ed = td - f.d;
  const el = Math.hypot(ex, ey, ed);
  const want = el < 0.05 ? 0 : Math.min(pace, el * 1.5);
  const k = Math.min(1, dt * (f.mode === 'bolt' ? 6 : 1.6));
  f.vx += ((ex / Math.max(el, 1e-3)) * want - f.vx) * k;
  f.vy += ((ey / Math.max(el, 1e-3)) * want - f.vy) * k;
  f.vd += ((ed / Math.max(el, 1e-3)) * want - f.vd) * k;
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  if (sp.keepOff && !sp.curious) {
    // However it was got there, it is not closer than its distance.
    const ox = f.x - diver.x;
    const oy = f.y - diver.y;
    const o = Math.hypot(ox, oy);
    if (o < sp.keepOff - 0.5) { const k2 = (sp.keepOff - 0.5) / Math.max(o, 1e-3); f.x = diver.x + ox * k2; f.y = diver.y + oy * k2; }
  }
  const floor = floorAt(f.x, f.y);
  f.d = onBottom && f.mode !== 'bolt' && flight !== 'glide' ? Math.max(0.3, floor - 0.06) : clamp(f.d + f.vd * dt, 0.6, Math.max(0.6, floor - (onBottom ? 0.08 : 0.2)));
  if (Math.hypot(f.vx, f.vy) > 0.04) {
    const to = Math.atan2(f.vx, f.vy);
    const step = Math.atan2(Math.sin(to - f.heading), Math.cos(to - f.heading)) * Math.min(1, dt * 5);
    f.heading += step;
    f.turn = (f.turn ?? 0) + (step / Math.max(dt, 1e-3) - (f.turn ?? 0)) * Math.min(1, dt * 4);
  } else f.turn = (f.turn ?? 0) * (1 - Math.min(1, dt * 4));
}

// ---- the speargun --------------------------------------------------------------------------------------

export const GUN = {
  /** The shaft flies true to here, metres, and reaches a little further with half the chance of finding the fish. */
  effective: 3.5,
  max: 4.5,
  /** Seconds to pull the shaft back and load the bands. */
  reload: 5,
  /** How fast the shaft goes, m/s. */
  speed: 22,
} as const;

/** How wide a mark a fish makes for the shaft, metres from the middle of it. */
export function markRadius(cm: number, shape: FishShape): number {
  const deep = shape === 'disc' || shape === 'lion' ? 0.2 : shape === 'flat' || shape === 'ray' || shape === 'turtle' ? 0.3 : shape === 'big' || shape === 'seal' ? 0.2 : shape === 'eel' ? 0.06 : 0.13;
  return Math.max(0.05, (cm / 100) * deep) + 0.04;
}

export interface Shot<T> { hit: T | null; range: number; near: T | null }

/**
 * Where a shaft goes. `dir` is a unit vector (east, north, down). The nearest fish whose body the line passes
 * through is hit, out to the effective range; between that and the full length of the line the mark is half as wide.
 * `near` is a fish it passed close by without touching: the one that got a fright.
 */
export function shoot<T extends { x: number; y: number; d: number; cm: number; species: { shape: FishShape } }>(from: { x: number; y: number; d: number }, dir: { x: number; y: number; d: number }, targets: T[]): Shot<T> {
  let hit: T | null = null;
  let range: number = GUN.max;
  let near: T | null = null;
  let nearBy = 1.2;
  for (const f of targets) {
    const rx = f.x - from.x;
    const ry = f.y - from.y;
    const rd = f.d - from.d;
    const along = rx * dir.x + ry * dir.y + rd * dir.d;
    if (along < 0.2 || along > GUN.max) continue;
    const off = Math.hypot(rx - dir.x * along, ry - dir.y * along, rd - dir.d * along);
    const r = markRadius(f.cm, f.species.shape) * (along > GUN.effective ? 0.5 : 1);
    if (off <= r) { if (along < range) { hit = f; range = along; } } else if (off < nearBy) { near = f; nearBy = off; }
  }
  return { hit, range: hit ? range : GUN.max, near };
}

/** Whether the gun may be fired at all, and the reason if not. Reasons teach: the reserve, the lobster rule. */
export function canFire(c: { under: boolean; reload: number; inHand: boolean; zone: DiveZone | null; atLobster: boolean; spare?: string }): { ok: boolean; say: string } {
  if (!c.under) return { ok: false, say: 'The gun stays on safe at the surface. Get your head under first' };
  if (c.zone) return { ok: false, say: `${c.zone.say}. The gun stays on safe` };
  if (c.atLobster) return { ok: false, say: 'Lobster are taken by hand, never with a spear. Get close and press G' };
  if (c.spare) return { ok: false, say: `${c.spare}. The gun stays on safe` };
  if (c.inHand) return { ok: false, say: 'There is a fish on the shaft already. Take it up to the float first' };
  if (c.reload > 0) return { ok: false, say: `Still loading: ${Math.ceil(c.reload)} s` };
  return { ok: true, say: '' };
}

/** Seconds a strong fish runs on the line before it tires. */
export function fightSeconds(kg: number): number {
  return clamp(3 + kg * 0.45, 3.5, 9);
}

export const DIVE_POINTS = {
  /** A clean shot from near the end of the line. */
  longShot: 6,
  /** The first of a species ever taken. */
  first: 15,
  /** A fish it is a good deed to take. */
  encouraged: 8,
  lobster: 8,
  /** A lobster taken under the practice setting: it is practice, and is not counted. */
  practice: 2,
  /** A protected fish, or one from a reserve. */
  citation: -40,
  /** An undersize fish, or one over the day's limit: a speared fish cannot be put back alive. */
  short: -20,
  blackout: -25,
} as const;

export interface Verdict {
  keep: boolean;
  why: 'kept' | 'encouraged' | 'protected' | 'short' | 'limit';
  say: string;
  /** Points to add or take beyond the logbook's own for a fish landed. */
  awards: Award[];
}

/**
 * What becomes of a fish with a shaft through it. A speared fish cannot be put back, so the rules have to be read
 * before the trigger is pulled: a protected fish, a short one or one over the limit is a citation and is not kept.
 * @param aboard how many of its kind are on the stringer already
 * @param range how far the shot was, metres
 * @param first true if she has never taken one of these before
 */
export function judge(f: Pick<Fish, 'species' | 'cm' | 'kg'>, aboard: number, range: number, first: boolean): Verdict {
  const sp = f.species;
  const a = article(sp.name);
  const size = `${f.cm} cm and ${weightWords(f.kg)}`;
  if (sp.protected) {
    return { keep: false, why: 'protected', say: `${a} ${sp.name}. ${sp.protected}. The warden writes you a citation and the fish is not kept`, awards: [{ kind: 'lost', points: DIVE_POINTS.citation, label: `Citation: ${sp.name}` }] };
  }
  if (sp.minCm !== undefined && f.cm < sp.minCm) {
    return { keep: false, why: 'short', say: `${a} ${sp.name} of ${f.cm} cm: short of the ${sp.minCm} cm limit, and a speared fish cannot be put back. A citation. Judge the size before you shoot`, awards: [{ kind: 'lost', points: DIVE_POINTS.short, label: `Short ${sp.name}` }] };
  }
  if (sp.bag !== undefined && aboard >= sp.bag) {
    return { keep: false, why: 'limit', say: `${a} ${sp.name}, but the limit is ${sp.bag} a day and they are on the stringer. Over the limit: a citation`, awards: [{ kind: 'lost', points: DIVE_POINTS.short, label: `Over the limit: ${sp.name}` }] };
  }
  const awards: Award[] = [];
  if (sp.encouraged) awards.push({ kind: 'dive', points: DIVE_POINTS.encouraged, label: `${sp.name[0].toUpperCase()}${sp.name.slice(1)} off the reef` });
  if (range >= 2.8) awards.push({ kind: 'dive', points: DIVE_POINTS.longShot, label: `A clean shot at ${range.toFixed(1)} m` });
  if (first) awards.push({ kind: 'dive', points: DIVE_POINTS.first, label: `First ${sp.name}` });
  const tail = sp.encouraged ? `. ${sp.encouraged}` : '';
  return { keep: true, why: sp.encouraged ? 'encouraged' : 'kept', say: `${a} ${sp.name}, ${size}, on the shaft${tail}`, awards };
}

// ---- lobster -------------------------------------------------------------------------------------------

/** True on a day inside any of the open windows. A window may run over the new year: October to March. */
export function inSeason(windows: Array<{ from: string; to: string }>, month: number, day: number): boolean {
  const at = month * 100 + day;
  const read = (s: string) => { const [m, d] = s.split('-').map(Number); return m * 100 + d; };
  return windows.some((w) => { const a = read(w.from); const b = read(w.to); return a <= b ? at >= a && at <= b : at >= a || at <= b; });
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Whether lobster may be taken on the water's own day, and how to say so. `practice` is the diver's own setting. */
export function lobsterSeason(rule: LobsterRule, month: number, day: number, practice: boolean): { open: boolean; practice: boolean; say: string } {
  if (inSeason(rule.season, month, day)) return { open: true, practice: false, say: `${rule.name} season is open: by hand only, ${rule.minMm} mm across the carapace, ${rule.bag} a day` };
  if (practice) return { open: true, practice: true, say: `Practice: the rules of an October night. ${rule.name} by hand, ${rule.minMm} mm, ${rule.bag} a day. The water's own day is still ${day} ${MONTHS[month - 1]}` };
  return { open: false, practice: false, say: `${rule.name} season is closed on ${day} ${MONTHS[month - 1]}: it opens in ${rule.opens}. They are here to look at, and any you pick up go back` };
}

export const GRAB = {
  /** Arm's length, metres. */
  reach: 0.95,
  /** Half the angle in front of it, radians, from which a hand can pin it. */
  front: 1.3,
  /** Faster than this, m/s, and it feels her coming and is gone. */
  lunge: 0.9,
  /** Seconds one that shot off stays away. */
  away: 45,
} as const;

export type GrabResult = 'caught' | 'far' | 'deep' | 'fled';

/**
 * A hand for a lobster. They shoot off backwards with a flick of the tail, so the hand has to come from in front and
 * pin them down: from the side or behind, or coming in fast, it is gone. One far back in its hole by day cannot be reached.
 */
export function grab(l: Pick<Lobster, 'x' | 'y' | 'd' | 'heading' | 'deep' | 'mode' | 'back'>, diver: Diver): GrabResult {
  if (l.mode !== 'there') return 'far';
  const dx = diver.x - l.x;
  const dy = diver.y - l.y;
  const dist = Math.hypot(dx, dy, diver.d - l.d);
  if (dist > GRAB.reach) return 'far';
  if (l.deep || (l.back ?? 0) > 0.6) return 'deep';
  const flat = Math.max(1e-6, Math.hypot(dx, dy));
  const ahead = (Math.sin(l.heading) * dx + Math.cos(l.heading) * dy) / flat;
  // Straight down on top of it counts as in front: there is nowhere for it to go.
  const fromFront = flat < 0.35 || ahead >= Math.cos(GRAB.front);
  if (!fromFront || Math.hypot(diver.vx, diver.vy, diver.vd) > GRAB.lunge) return 'fled';
  return 'caught';
}

/**
 * A lobster in its hole minds the diver. Within a couple of metres, a hand coming from the side or behind, or coming
 * fast, sends it backwards into the dark a little at a time; a slow approach from in front, or keeping still, lets it
 * creep back to the mouth with its feelers out. Once it is right back (`back` over 0.6) it cannot be reached.
 * A lobster deep in its hole by day stays there however she comes at it.
 */
export function lobsterShies(l: Lobster, diver: Diver, dt: number): void {
  if (l.mode !== 'there' || l.deep || l.out) return;
  const dx = diver.x - l.x;
  const dy = diver.y - l.y;
  const dist = Math.hypot(dx, dy, diver.d - l.d);
  const speed = Math.hypot(diver.vx, diver.vy, diver.vd);
  let back = l.back ?? 0;
  if (dist < 2.2) {
    const flat = Math.max(1e-6, Math.hypot(dx, dy));
    const ahead = (Math.sin(l.heading) * dx + Math.cos(l.heading) * dy) / flat;
    const front = flat < 0.35 || ahead >= Math.cos(GRAB.front);
    if (!front || speed > 0.5) back += dt * (0.25 + speed * 0.9);
    else if (speed < 0.2) back -= dt * 0.12;
  } else back -= dt * 0.05;
  l.back = clamp01(back);
}

/**
 * What a kept lobster is worth, and whether it goes in the logbook. One taken under the practice setting, when the
 * water's own season is shut, is practice: a couple of points, and no place in the book's count of lobster.
 */
export function lobsterAwards(practice: boolean, first: boolean): { counts: boolean; awards: Award[] } {
  if (practice) return { counts: false, awards: [{ kind: 'dive', points: DIVE_POINTS.practice, label: 'A legal lobster, in practice' }] };
  const awards: Award[] = [{ kind: 'dive', points: DIVE_POINTS.lobster, label: 'A legal lobster, by hand' }];
  if (first) awards.push({ kind: 'dive', points: DIVE_POINTS.first, label: 'First lobster' });
  return { counts: true, awards };
}

export interface Gauged { keep: boolean; why: 'kept' | 'closed' | 'short' | 'limit' | 'reserve'; say: string }

/** The gauge across the carapace, and the rest of the rule: season, size, the day's bag, and no taking in a reserve. */
export function gauge(mm: number, rule: LobsterRule, open: boolean, aboard: number, zone: DiveZone | null): Gauged {
  const n = rule.name.replace(/^(California|Caribbean) /, '');
  if (zone) return { keep: false, why: 'reserve', say: `A ${n} of ${mm} mm, and back under its ledge: ${zone.say}` };
  if (!open) return { keep: false, why: 'closed', say: `A ${n}, ${mm} mm across the carapace${mm >= rule.minMm ? ', a legal one' : ''}. The season is closed until ${rule.opens}, so back it goes` };
  if (mm < rule.minMm) return { keep: false, why: 'short', say: `The gauge says ${mm} mm: short of ${rule.minMm} mm, so back it goes to grow` };
  if (aboard >= rule.bag) return { keep: false, why: 'limit', say: `${mm} mm and legal, but ${rule.bag} is the limit for a day and they are in the bag. Back it goes` };
  return { keep: true, why: 'kept', say: `The gauge says ${mm} mm: legal over ${rule.minMm}. In the bag, ${aboard + 1} of ${rule.bag}` };
}

// ---- other boats ---------------------------------------------------------------------------------------

/** What goes to the other boats while she is in the water: where the flag is, whole metres. Null when she is aboard. */
export function packDive(x: number, y: number): number[] {
  return [Math.round(x), Math.round(y)];
}

/** Read another page's `dv`. Anything that is not two sound numbers is nobody diving. */
export function readDive(v: unknown): { x: number; y: number } | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [x, y] = v as unknown[];
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > 5e6 || Math.abs(y) > 5e6) return null;
  return { x, y };
}

export const FLAG = {
  /** Inside this, metres, a boat under way is told there is a diver down. */
  warn: 220,
  /** Under way means making this, knots, or more. */
  wayKt: 1,
  /** A vessel passing within this, metres, at this speed, knots, or more gives a diver a fright. */
  close: 28,
  fastKt: 4,
} as const;

/** True when a boat making way has come close enough to a dive flag to be told about it. */
export function diverNear(boat: { x: number; y: number; sogKt: number }, flag: { x: number; y: number }): boolean {
  return boat.sogKt >= FLAG.wayKt && Math.hypot(boat.x - flag.x, boat.y - flag.y) <= FLAG.warn;
}

/** The vessel, if any, going over a diver fast enough to send her up. `sog` in m/s. */
export function runOver<V extends { x: number; y: number; sog: number }>(diver: { x: number; y: number }, vessels: readonly V[]): V | null {
  for (const v of vessels) if (v.sog >= FLAG.fastKt * KT && Math.hypot(v.x - diver.x, v.y - diver.y) <= FLAG.close) return v;
  return null;
}
