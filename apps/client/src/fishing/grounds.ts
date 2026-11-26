/**
 * Where the fish are: what kind of water a boat is in, how near she is to a platform, a kelp paddy or a school under
 * birds, and what is being said about them on the radio. Pure: no screen, no scene, no chance. Paddies and schools
 * are worked out from the season time and a hash, so every player finds the same ones in the same places.
 * Flat metres, sim coordinates (x east, y north); times in seconds of the season.
 */
import { hash01 } from '../aboard/catch';
import type { FishTable, Ground, Habitat, Platform } from './table';
import { reserveAt, type Reserve } from './zones';

const KT = 0.514444;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 below `a` and above `d`, 1 between `b` and `c`, straight lines between. */
export const band = (v: number, a: number, b: number, c: number, d: number) => clamp01(Math.min(b > a ? (v - a) / (b - a) : v >= a ? 1 : 0, d > c ? (d - v) / (d - c) : v <= d ? 1 : 0));

/** Under this she is stopped or drifting and fishes a bait or a jig. Over it the lures are towing. */
export const TROLL_MIN_KT = 2.5;
/** Over this the lures skip along the top and nothing will take them. */
export const SKIP_KT = 11;
/** How near a stopped boat must be to a paddy or a school to cast to it, and how near a towed lure has to pass. */
export const CAST_RANGE = 95;
export const TROLL_PASS = 160;
/** Birds over a school can be seen from this far in daylight, a paddy on the water only from this far. */
export const SCHOOL_SIGHT = 1600;
export const PADDY_SIGHT = 550;
/** Driving through a school inside this, faster than this, puts it down. */
export const SPOOK_RANGE = 32;
export const SPOOK_KT = 3;
/** Water this deep, metres, is open water: outside the breakwater, off the shelf's inner edge, and all the way across. */
const CHANNEL_DEPTH = 28;

/** The chart, as far as the fishing needs it. */
export interface Sea {
  /** Charted depth, metres. 0 or less is land. */
  depth(x: number, y: number): number;
}

/** What the boat is doing and where. */
export interface Here {
  x: number;
  y: number;
  /** Depth of water, metres. */
  depth: number;
  /** Speed through the water, knots, and over the ground. */
  speedKt: number;
  sogKt: number;
  /** At anchor or on a mooring. */
  held: boolean;
  /** Local time of day, hours 0 to 24, and the month, 1 to 12. */
  hour: number;
  month: number;
  /** Rise of tide, metres an hour. Positive on the flood. */
  tideRate: number;
  /** The stream, m/s east and north. */
  stream: { x: number; y: number };
}

export type SchoolKind = 'boil' | 'yellows' | 'foamer';
export interface Paddy { key: number; x: number; y: number; holding: boolean }
export interface School { key: number; x: number; y: number; kind: SchoolKind; heading: number }

export interface Spot extends Here {
  /** How much of each kind of water this is, 0 to 1. */
  hab: Partial<Record<Habitat, number>>;
  /** The named ground she is on, the smallest if several. */
  ground: Ground | null;
  /** The nearest platform or oil island within its reach: how far, how much on its up-current side (0 to 1), and whether she is inside its keep-off ring. */
  platform: { p: Platform; d: number; up: number; inside: boolean } | null;
  /** The nearest paddy and school close enough to matter. */
  paddy: { paddy: Paddy; d: number } | null;
  school: { school: School; d: number } | null;
  reserve: Reserve | null;
  /** Lying at the bait barge. */
  barge: boolean;
  /** Stopped within a cast of a paddy that holds fish or a school. */
  casting: boolean;
}

// ---- kelp paddies and schools under birds -------------------------------------------------------------

/** The floating kelp paddies out today. One holds for a few hours, drifting slowly, then another turns up somewhere else. */
export function paddiesAt(table: FishTable, now: number, sea?: Sea): Paddy[] {
  const p = table.paddies;
  const out: Paddy[] = [];
  if (!p) return out;
  const spell = p.hours * 3600;
  const [x0, y0, x1, y1] = p.area;
  for (let i = 0; i < p.count; i++) {
    const turns = now / spell + hash01(i, 301);
    const turn = Math.floor(turns);
    const into = (turns - turn) * spell;
    const dir = Math.PI * 2 * hash01(i, turn, 304);
    const drift = p.driftKt * KT * into;
    const x = x0 + (x1 - x0) * hash01(i, turn, 302) + Math.sin(dir) * drift;
    const y = y0 + (y1 - y0) * hash01(i, turn, 303) + Math.cos(dir) * drift;
    if (sea && sea.depth(x, y) < 30) continue;
    out.push({ key: i * 4096 + (turn & 4095), x, y, holding: hash01(i, turn, 305) < p.holding });
  }
  return out;
}

/** The schools up on the surface now, with birds over them. Each moves along at a knot or two and lasts some minutes. */
export function schoolsAt(table: FishTable, now: number, sea?: Sea): School[] {
  const out: School[] = [];
  table.schools.forEach((area, ai) => {
    const spell = area.minutes * 60;
    const [x0, y0, x1, y1] = area.area;
    for (let i = 0; i < area.count; i++) {
      const turns = now / spell + hash01(ai, i, 311);
      const turn = Math.floor(turns);
      if (hash01(ai, i, turn, 312) >= area.odds) continue;
      const into = (turns - turn) * spell;
      // Down for the first and last minute, so one is never seen to jump.
      if (into < 60 || into > spell - 60) continue;
      const heading = Math.PI * 2 * hash01(ai, i, turn, 315);
      const run = (0.8 + 1.2 * hash01(ai, i, turn, 316)) * KT * into;
      const x = x0 + (x1 - x0) * hash01(ai, i, turn, 313) + Math.sin(heading) * run;
      const y = y0 + (y1 - y0) * hash01(ai, i, turn, 314) + Math.cos(heading) * run;
      if (sea && sea.depth(x, y) < 12) continue;
      let pick = hash01(ai, i, turn, 317) * Object.values(area.kinds).reduce((s, w) => s + (w ?? 0), 0);
      let kind: SchoolKind = 'boil';
      for (const [k, w] of Object.entries(area.kinds) as Array<[SchoolKind, number]>) {
        pick -= w;
        if (pick < 0) { kind = k; break; }
      }
      out.push({ key: (ai * 64 + i) * 4096 + (turn & 4095), x, y, kind, heading });
    }
  });
  return out;
}

/** True when a boat doing this speed this close has driven over a school and put it down. */
export const spooks = (d: number, speedKt: number): boolean => d < SPOOK_RANGE && speedKt > SPOOK_KT;

// ---- the water under her --------------------------------------------------------------------------------

function inGround(g: Ground, x: number, y: number, depth: number): boolean {
  if (g.depth && (depth < g.depth[0] || depth > g.depth[1])) return false;
  if (g.circle) return Math.hypot(x - g.circle[0], y - g.circle[1]) <= g.circle[2];
  if (g.box) return x >= g.box[0] && y >= g.box[1] && x <= g.box[2] && y <= g.box[3];
  if (g.line) {
    for (let i = 1; i < g.line.length; i++) {
      const [ax, ay] = g.line[i - 1];
      const [bx, by] = g.line[i];
      const dx = bx - ax;
      const dy = by - ay;
      const u = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
      if (Math.hypot(x - ax - dx * u, y - ay - dy * u) <= (g.width ?? 200)) return true;
    }
  }
  return false;
}

const groundSize = (g: Ground): number => (g.circle ? g.circle[2] * 2 : g.box ? Math.max(g.box[2] - g.box[0], g.box[3] - g.box[1]) : 3000);

/**
 * Everything about a place that a fish cares about.
 * @param down keys of the schools this boat has driven over and put down
 */
export function spotAt(table: FishTable, reserves: readonly Reserve[], here: Here, now: number, sea?: Sea, down?: ReadonlySet<number>): Spot {
  const hab: Partial<Record<Habitat, number>> = {};
  const put = (k: Habitat, v: number) => { if (v > (hab[k] ?? 0)) hab[k] = v; };
  let ground: Ground | null = null;
  let barge = false;
  for (const g of table.grounds) {
    if (!inGround(g, here.x, here.y, here.depth)) continue;
    if (g.kind === 'barge') { barge = true; continue; }
    put(g.kind, 1);
    if (!ground || groundSize(g) < groundSize(ground)) ground = g;
  }
  put('channel', band(here.depth, CHANNEL_DEPTH - 4, CHANNEL_DEPTH, 1e6, 1e7));

  // Structure: fish hold on the legs and face the current, so the up-current side is the one to fish, from outside the ring.
  let platform: Spot['platform'] = null;
  for (const p of table.platforms) {
    const dx = here.x - p.x;
    const dy = here.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > p.reach || (platform && d > platform.d)) continue;
    const set = Math.hypot(here.stream.x, here.stream.y);
    // 1 dead up-current of it, 0 dead down-current. With no stream to speak of there is no good or bad side.
    const up = set < 0.02 || d < 1 ? 0.75 : 0.5 - 0.5 * ((dx * here.stream.x + dy * here.stream.y) / (d * set));
    platform = { p, d, up, inside: d < p.keepOff };
  }
  if (platform && !platform.inside) {
    const near = band(platform.d, platform.p.keepOff - 1, platform.p.keepOff, platform.p.reach * 0.5, platform.p.reach);
    put(platform.p.kind === 'platform' ? 'platform' : 'rocks', near * (0.45 + 0.55 * platform.up));
  }

  const stopped = here.held || here.speedKt < TROLL_MIN_KT;
  const reach = stopped ? CAST_RANGE : TROLL_PASS;
  const nearness = (d: number) => (stopped ? band(d, -1, 0, reach * 0.8, reach * 1.6) : 0.7 * band(d, -1, 0, reach, reach * 1.7));
  let paddy: Spot['paddy'] = null;
  for (const p of paddiesAt(table, now, sea)) {
    const d = Math.hypot(here.x - p.x, here.y - p.y);
    if (d < PADDY_SIGHT && (!paddy || d < paddy.d)) paddy = { paddy: p, d };
  }
  if (paddy?.paddy.holding) put('paddy', nearness(paddy.d));
  let school: Spot['school'] = null;
  for (const s of schoolsAt(table, now, sea)) {
    if (down?.has(s.key)) continue;
    const d = Math.hypot(here.x - s.x, here.y - s.y);
    if (d < SCHOOL_SIGHT && (!school || d < school.d)) school = { school: s, d };
  }
  if (school) put(school.school.kind, nearness(school.d));

  const casting = stopped && ((paddy?.paddy.holding === true && paddy.d < reach * 1.6) || (school !== null && school.d < reach * 1.6));
  return { ...here, hab, ground, platform, paddy, school, reserve: reserveAt(reserves, here.x, here.y), barge, casting };
}

// ---- what is said on the radio ----------------------------------------------------------------------------

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const NUMBER = ['', 'a mile', 'two miles', 'three miles', 'four miles', 'five miles', 'six miles', 'seven miles', 'eight miles', 'nine miles', 'ten miles'];
/** A new report may come this often, seconds. */
export const REPORT_EVERY = 1200;

export interface Report {
  /** The paddy's or the school's key, so the same thing is not marked twice. */
  key: number;
  what: 'paddy' | SchoolKind;
  x: number;
  y: number;
  from: string;
  text: string;
  /** Season time after which the report is stale. */
  until: number;
}

/** A place in words, from the nearest named place: "three miles south of Queens Gate". */
export function whereWords(table: FishTable, x: number, y: number): string {
  let best = table.refs[0];
  for (const r of table.refs) if (Math.hypot(x - r.x, y - r.y) < Math.hypot(x - best.x, y - best.y)) best = r;
  if (!best) return 'out in the channel';
  const d = Math.hypot(x - best.x, y - best.y);
  const miles = Math.round(d / 1852);
  if (miles < 1) return `close off ${best.name}`;
  const dir = POINTS[((Math.round(Math.atan2(x - best.x, y - best.y) / (Math.PI / 4)) % 8) + 8) % 8];
  return `${NUMBER[miles] ?? `${miles} miles`} ${dir} of ${best.name}`;
}

/** The fish a kind of water is known for at this time of year, best first: what is said to be under a paddy or a school. */
export function knownFor(table: FishTable, kind: Habitat, month: number): string[] {
  return table.species
    .filter((s) => (s.habitat[kind] ?? 0) >= 0.7 && (!s.months || s.months.includes(month)))
    .sort((a, b) => (b.habitat[kind] ?? 0) - (a.habitat[kind] ?? 0) || b.worth - a.worth)
    .map((s) => s.name);
}

/**
 * The report going round in one slot of the clock (`Math.floor(now / REPORT_EVERY)`), or null in a quiet one.
 * It is true: the paddy holds fish, or the school is up, where and when it says.
 */
export function reportIn(table: FishTable, slot: number, month: number, sea?: Sea): Report | null {
  if (hash01(slot, 321) < 0.25) return null;
  const at = slot * REPORT_EVERY + 120;
  const paddies = paddiesAt(table, at, sea).filter((p) => p.holding);
  const schools = schoolsAt(table, at, sea);
  const n = paddies.length + schools.length;
  if (!n) return null;
  const i = Math.floor(hash01(slot, 322) * n);
  const from = table.callers[Math.floor(hash01(slot, 323) * table.callers.length)] ?? 'A boat';
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (i < paddies.length) {
    const p = paddies[i];
    const fish = knownFor(table, 'paddy', month).slice(0, 2).join(' and ') || 'fish';
    return { key: p.key, what: 'paddy', x: p.x, y: p.y, from, text: `${cap(fish)} under a kelp paddy ${whereWords(table, p.x, p.y)}.`, until: at + (table.paddies?.hours ?? 3) * 1800 };
  }
  const s = schools[i - paddies.length];
  const fish = knownFor(table, s.kind, month)[0] ?? 'fish';
  const how = s.kind === 'foamer' ? `${cap(fish)} foaming under the birds` : `Birds working over ${fish}`;
  return { key: s.key, what: s.kind, x: s.x, y: s.y, from, text: `${how} ${whereWords(table, s.x, s.y)}.`, until: at + 900 };
}
