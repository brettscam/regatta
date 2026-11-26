// What there is to do ashore, and what is said. Pure: the menu is data (`data/ashore.json`), the rest is rules.
import type { Award } from '../xp/score';
import type { Facts } from '../aboard/residentRules';
import menuData from '../data/ashore.json';
import { nearestSpot, type SpotKind, type WalkGround } from './ground';
import type { Held } from './pose';
import type { Pose } from './wire';

// ---- what a spot offers ----------------------------------------------------------------------------

/** The key that does the thing at hand, and the one that opens the menu. Neither walks, looks or sails. */
export const DO_KEY = 'KeyF';
export const MENU_KEY = 'KeyG';

export interface Offer {
  key: typeof DO_KEY | typeof MENU_KEY;
  /** The words after the key on the prompt: "sit at the table". */
  label: string;
  /** For the F key: the pose she takes, and at which spot (-1 where she stands). */
  pose?: Pose;
  spot: number;
}

interface Use { pose: Pose; reach: number; label: string; here?: boolean }
/** What each kind of spot is for. `here` means she does it where she stands, facing the spot, not on it. */
const USES: Partial<Record<SpotKind, Use>> = {
  seat: { pose: 'sit', reach: 1.5, label: 'sit at the table' },
  bench: { pose: 'sit', reach: 1.5, label: 'sit down' },
  bar: { pose: 'stool', reach: 1.5, label: 'take a stool at the bar' },
  rail: { pose: 'lean', reach: 1.6, label: 'lean on the rail and look out' },
  view: { pose: 'lean', reach: 1.6, label: 'stop and look' },
  fire: { pose: 'warm', reach: 2.8, label: 'warm your hands at the fire', here: true },
  dance: { pose: 'dance', reach: 3.4, label: 'dance', here: true },
};
/** Where there is something to order: at the bar, at a counter, and at the door of a place with neither. */
const ORDER_REACH = 2.6;

/** True for a pose that is held at a spot of its own, so nobody else can have it. */
export const claims = (pose: Pose): boolean => pose === 'sit' || pose === 'stool' || pose === 'lean';

/**
 * What she can do from where she stands: at most one thing on F and the menu on G.
 * @param taken the spots other players are in, by index
 * @param menu how many things this place sells
 */
export function offersAt(g: WalkGround, x: number, y: number, taken: ReadonlySet<number>, menu: number): Offer[] {
  const out: Offer[] = [];
  const free = (i: number): boolean => !g.spots[i].taken && !taken.has(i);
  // The nearest thing to do, each kind within its own reach.
  let best: { index: number; d: number; use: Use } | null = null;
  for (let i = 0; i < g.spots.length; i++) {
    const s = g.spots[i];
    const use = USES[s.kind];
    if (!use) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    // Something to sit on is preferred to something to stand by when both are in reach.
    const rank = d - (use.here ? 0 : 1);
    if (d > use.reach || (best && rank >= best.d) || (!use.here && !free(i))) continue;
    best = { index: i, d: rank, use };
  }
  if (best) out.push({ key: DO_KEY, label: best.use.label, pose: best.use.pose, spot: best.use.here ? -1 : best.index });
  if (menu > 0) {
    const hasBar = g.spots.some((s) => s.kind === 'bar' || s.kind === 'counter');
    const till = nearestSpot(g, x, y, ORDER_REACH, (s) => (hasBar ? s.kind === 'bar' || s.kind === 'counter' : s.kind === 'door'));
    if (till) out.push({ key: MENU_KEY, label: hasBar ? 'order at the bar' : 'order at the door', spot: till.index });
  }
  return out;
}

/** The next dance, for F pressed again on the floor. */
export const nextDance = (pose: Pose): Pose => (pose === 'dance' ? 'dance2' : 'dance');

/** Who is sitting with her: the others whose spot is in the same group as hers. */
export function sittingWith<T extends { spot: number }>(g: WalkGround, spot: number, others: readonly T[]): T[] {
  const group = g.spots[spot]?.group;
  if (!group) return [];
  return others.filter((o) => o.spot !== spot && g.spots[o.spot]?.group === group);
}

/** "the bar", "table 3": where a group is, in words. */
export function groupWords(group: string | undefined): string {
  if (!group) return '';
  const table = /^table-(\d+)$/.exec(group);
  return table ? `table ${table[1]}` : `the ${group.replace(/-/g, ' ')}`;
}

// ---- the menu --------------------------------------------------------------------------------------

export interface Item { id: string; name: string; held: Held; tint: string; price: number }
interface MenuFile {
  items: Item[];
  kinds: Record<string, string[]>;
  waters: Record<string, { first?: string[]; not?: string[] }>;
  places: Record<string, { first?: string[]; not?: string[] }>;
}
const MENU = menuData as MenuFile;
/** Every item, in the order of the file. An item's place in this list is what goes on the wire. */
export const ITEMS: readonly Item[] = MENU.items;
export const itemAt = (index: number): Item | null => (Number.isInteger(index) && index >= 0 ? ITEMS[index] ?? null : null);
const MOST = 5;

/** What a place sells: its own things first, then the water's, then what its kind of place always has. Indexes into `ITEMS`. */
export function menuFor(kind: string, water: string, place: string): number[] {
  const base = MENU.kinds[kind] ?? [];
  if (!base.length) return [];
  const w = MENU.waters[water] ?? {};
  const p = MENU.places[place] ?? {};
  const not = new Set([...(w.not ?? []), ...(p.not ?? [])]);
  const ids = [...(p.first ?? []), ...(w.first ?? []), ...base.filter((id) => !not.has(id))];
  const out: number[] = [];
  for (const id of ids) {
    const i = ITEMS.findIndex((item) => item.id === id);
    if (i >= 0 && !out.includes(i)) out.push(i);
    if (out.length === MOST) break;
  }
  return out;
}

/**
 * Paying for something. Nothing costs anything yet: every order goes through, and the price in the data is for the
 * day there is money. When there is, this is the one place that takes it.
 */
export function pay(_item: Item, _count = 1): boolean {
  return true;
}

/** The drink a round is: the first thing on the menu that comes in a glass, a mug or a bottle. */
export function houseDrink(menu: readonly number[]): number {
  return menu.find((i) => ITEMS[i].held !== 'plate') ?? -1;
}

// ---- what the bartender says -----------------------------------------------------------------------

export interface BarFacts {
  /** The wind, the turn of the tide and the fishing, as the boats that live here tell it (`aboard/residentRules.ts`). */
  facts: Facts;
  /** The forecast wind three hours on, knots, and where from. Null where there is no forecast. */
  later: { kt: number; from: string; hour: number } | null;
  /** The names of the other boats lying within a few hundred metres. */
  inPort: string[];
}

const TOPICS = ['forecast', 'port', 'tide', 'fish'] as const;
const clock = (hour: number): string => `${String(Math.floor(((hour % 24) + 24) % 24)).padStart(2, '0')}:00`;
const minutesWords = (m: number): string => (m < 50 ? `about ${Math.max(5, Math.round(m / 5) * 5)} minutes` : m < 80 ? 'about an hour' : `about ${Math.round(m / 30) / 2} hours`);
const list = (names: readonly string[]): string => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

function topic(what: (typeof TOPICS)[number], b: BarFacts): string | null {
  const f = b.facts;
  if (what === 'forecast') {
    if (!b.later) return null;
    const now = Math.round(f.windKt);
    const then = Math.round(b.later.kt);
    if (then >= now + 4) return `It is ${now} knots out there now and the forecast has ${then} from the ${b.later.from} by ${clock(b.later.hour)}. I would not leave it late.`;
    if (then <= now - 4) return `The forecast has it easing: ${now} knots now, ${then} by ${clock(b.later.hour)}.`;
    return `About ${now} knots from the ${f.windFrom}, and the forecast has much the same until ${clock(b.later.hour)}.`;
  }
  if (what === 'port') {
    if (!b.inPort.length) return 'Yours is the only boat in just now.';
    return `${list(b.inPort.slice(0, 4))} ${b.inPort.length === 1 ? 'is' : 'are'} in as well.`;
  }
  if (what === 'tide') {
    if (!f.turn) return null;
    return `${f.turn.high ? 'High' : 'Low'} water in ${minutesWords(f.turn.minutes)}, if you are watching your depth.`;
  }
  if (!f.fish) return null;
  return `They are getting ${f.fish.species} off ${f.fish.place}, ${f.fish.how}.`;
}

/**
 * What is said as an order is put down: what it is, and one true thing about the water outside. `n` counts her
 * orders here, so each one brings the next thing the bartender knows.
 */
export function barLine(item: Item, b: BarFacts, n: number): string {
  const served = `${item.name.charAt(0).toUpperCase()}${item.name.slice(1)}.`;
  for (let k = 0; k < TOPICS.length; k++) {
    const words = topic(TOPICS[(n + k) % TOPICS.length], b);
    if (words) return `${served} ${words}`;
  }
  return served;
}

// ---- awards ----------------------------------------------------------------------------------------

/** Buying a round for at least one other player. Counted under first landings: it is all the bar hop. */
export function roundAward(friends: number): Award | null {
  return friends > 0 ? { kind: 'ashore', points: 10, label: 'A round for the fleet' } : null;
}
export const SUNSET_AWARD: Award = { kind: 'ashore', points: 15, label: 'Sunset from the rail' };

/** The sun's height, radians, between which it is going down to be watched: from a hand's breadth up until it is gone. */
export const SUNSET = { from: 0.07, to: -0.015, watch: 45 } as const;

/**
 * Watching the sun go down. Feed it every frame: the sun's height now, whether it is falling, and whether she is at
 * the rail looking out. It answers true once, when she has stood there for `SUNSET.watch` seconds of the sun's last
 * stretch and it has set while she watched.
 */
export class SunsetWatch {
  private watched = 0;
  private done = false;

  update(dt: number, elevation: number, falling: boolean, atRail: boolean): boolean {
    if (this.done) return false;
    const going = falling && elevation < SUNSET.from && elevation > SUNSET.to;
    if (going && atRail) this.watched += dt;
    else if (!atRail || !falling) this.watched = 0;
    // It has gone under while she stood there.
    if (atRail && falling && elevation <= SUNSET.to && this.watched >= SUNSET.watch) {
      this.done = true;
      return true;
    }
    return false;
  }

  /** True while there is a sunset to watch and she is watching it. */
  get watching(): boolean {
    return !this.done && this.watched > 0;
  }
}

// ---- telling the fleet -----------------------------------------------------------------------------

const three = (deg: number): string => String(((Math.round(deg) % 360) + 360) % 360).padStart(3, '0');

/** "Scott is at Sam's, Tiburon. 1.4 miles at 320°": what the others are told, from where each of them is. */
export function gatherLine(who: string, venue: string, place: string, fromX: number, fromY: number, x: number, y: number): string {
  const d = Math.hypot(x - fromX, y - fromY);
  const where = place && place !== venue ? `${venue}, ${place}` : venue;
  if (d < 150) return `${who} is at ${where}: right here`;
  const far = d < 926 ? `${Math.round(d / 10) * 10} m` : `${(d / 1852).toFixed(1)} miles`;
  return `${who} is at ${where}. ${far} at ${three((Math.atan2(x - fromX, y - fromY) * 180) / Math.PI)}°`;
}

// ---- looking ---------------------------------------------------------------------------------------

export interface Seen { name: string; d: number; bearing: number; x: number; y: number; line?: string }

/**
 * What lies before somebody looking along `face`: the named places within `arc` radians either side and `range`
 * metres, nearest first, three at most. Places closer than 200 m are where she is standing, not a view.
 */
export function sightsFrom(x: number, y: number, face: number, things: ReadonlyArray<{ name: string; x: number; y: number; line?: string }>, arc = 0.9, range = 16000): Seen[] {
  const out: Seen[] = [];
  for (const t of things) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < 200 || d > range) continue;
    const bearing = Math.atan2(t.x - x, t.y - y);
    if (Math.abs(Math.atan2(Math.sin(bearing - face), Math.cos(bearing - face))) > arc) continue;
    out.push({ name: t.name, d, bearing, x: t.x, y: t.y, line: t.line });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 3);
}

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** "Looking west: Sandy Cay 2.1 miles, Great Harbour 3.0 miles." */
export function viewWords(face: number, seen: readonly Seen[]): string {
  const way = POINTS[((Math.round(face / (Math.PI / 4)) % 8) + 8) % 8];
  if (!seen.length) return `Looking ${way}, over open water`;
  return `Looking ${way}: ${seen.map((s) => `${s.name} ${s.d < 926 ? `${Math.round(s.d / 10) * 10} m` : `${(s.d / 1852).toFixed(1)} miles`}`).join(', ')}`;
}
