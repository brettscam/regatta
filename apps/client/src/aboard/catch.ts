/**
 * What comes up in a crab pot and what takes a line on San Francisco Bay.
 * Nothing here touches the screen or the scene, and nothing is left to chance: every catch is worked out from a hash
 * of where and when, so the same pot in the same place at the same time holds the same crab, and a test can pin it.
 * Distances in metres, sim coordinates (x east, y north), times in seconds of the season.
 */

const DAY = 86400;

/** A number from 0 up to but not including 1, fixed by the numbers given. Each is rounded down to a whole number first. */
export function hash01(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h ^= Math.floor(v) | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 below `a` and above `d`, 1 between `b` and `c`, straight lines between. */
const band = (v: number, a: number, b: number, c: number, d: number) => clamp01(Math.min((v - a) / (b - a), (d - v) / (d - c)));
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** West of here is the Golden Gate and the ocean beyond it. The bridge stands at about x = -2400. */
export const GATE_X = -2000;

// ---- crab pots --------------------------------------------------------------------------------------

export const POT_MIN_DEPTH = 4;
export const POT_MAX_DEPTH = 35;
/** Pots a boat carries. */
export const POT_LIMIT = 3;
/** How close the boat must be to her buoy to get a boathook on it. */
export const POT_REACH = 35;
/** Speed over ground, in knots, under which a pot can be put over the side, and under which one can be hauled. */
export const POT_DROP_KT = 3;
export const POT_HAUL_KT = 2;
/** A pot left longer than this is taken as lost when a new session finds it. */
export const POT_LOST_AFTER = DAY;
/** Legal sizes across the back, millimetres: Dungeness 5 3/4 inches, rock crab of any kind 4 inches. */
export const DUNGENESS_MIN_MM = 146;
export const ROCK_CRAB_MIN_MM = 102;
/** The Golden Gate Bridge. Dungeness may not be taken east of it, in the Bay, at any time of year. */
export const BRIDGE_X = -2500;
/**
 * The sport season for Dungeness off San Francisco runs from early November to the end of June. The game's day is
 * 14 July, so outside the Gate they go back as well.
 */
export const DUNGENESS_OPEN = false;

export interface Pot {
  x: number;
  y: number;
  /** Season time when it went down. */
  t: number;
  /** Depth of water it went down in, metres. */
  depth: number;
  /** Seconds it has been down. */
  soaked: number;
  /** Season time when `soaked` was last brought up to date. */
  seen: number;
}

/** Why a pot cannot go down in this depth of water, or null if it can. */
export function potDepthProblem(depth: number): 'shallow' | 'deep' | null {
  if (!(depth >= POT_MIN_DEPTH)) return 'shallow';
  if (depth > POT_MAX_DEPTH) return 'deep';
  return null;
}

/**
 * Season seconds gone by between two readings of the clock. The season wraps back a whole day when the recorded
 * weather runs out, and a new session may start earlier in the day than the last one ended, so a clock that has
 * gone backwards means a day has gone round.
 */
export function seasonElapsed(from: number, to: number): number {
  let d = to - from;
  while (d < 0) d += DAY;
  return d;
}

/** How full a pot is for its time down, 0 to 1: nothing much inside ten minutes, most of it by 45, level after an hour. */
export function potFill(soakSeconds: number): number {
  const minutes = soakSeconds / 60;
  if (minutes <= 8) return 0;
  return clamp01((1 - Math.exp(-(minutes - 8) / 17)) / 0.95);
}

export interface PotHaul {
  soakMinutes: number;
  /** True for a pot set inside the Bay, east of the bridge. */
  inside: boolean;
  /** Crab kept, and crab put back, of each kind. Dungeness all go back: see `DUNGENESS_OPEN` and `BRIDGE_X`. */
  dungeness: { kept: number; back: number };
  redRock: { kept: number; back: number };
  brownRock: { kept: number; back: number };
  keepers: number;
  thrownBack: number;
}

/**
 * What is in a pot when it comes up.
 * Dungeness like sand in 8 to 30 m. The Bay is their nursery, so inside it most are young ones, and none may be kept
 * there whatever their size. Outside the Gate they may be kept in the season, which July is not.
 * Rock crab, red and brown, like it shallower and rockier, 4 to 15 m. They may be kept all year over four inches.
 * The ground itself is better in some places than others, which the hash of the position decides.
 */
export function haulPot(pot: Pick<Pot, 'x' | 'y' | 't' | 'depth'>, soakSeconds: number): PotHaul {
  const fill = potFill(soakSeconds);
  const outside = clamp01((GATE_X - pot.x) / 1500);
  // Good ground and poor ground, in patches a few hundred metres across.
  const ground = 0.55 + 0.9 * hash01(pot.x / 300, pot.y / 300, 11);
  const luck = 0.7 + 0.6 * hash01(pot.x, pot.y, pot.t, 12);
  const dungenessGround = band(pot.depth, 3, 9, 28, 40) * (1 + 0.4 * outside);
  const redRockGround = band(pot.depth, 2, 4, 12, 24);
  const count = (most: number, salt: number) => Math.floor(most * fill * ground * luck + hash01(pot.x, pot.y, pot.t, salt));
  let dungeness = count(7 * dungenessGround, 13);
  let rock = count(6.5 * redRockGround, 14);
  // A pot only holds so many.
  while (dungeness + rock > 12) {
    if (dungeness >= rock) dungeness--;
    else rock--;
  }
  // Three rock crab in five are red, the rest brown.
  let redRock = 0;
  for (let i = 0; i < rock; i++) if (hash01(pot.x, pot.y, pot.t, 17, i) < 0.6) redRock++;
  const sort = (n: number, legalShare: number, salt: number) => {
    let kept = 0;
    for (let i = 0; i < n; i++) if (hash01(pot.x, pot.y, pot.t, salt, i) < legalShare) kept++;
    return { kept, back: n - kept };
  };
  const inside = pot.x > BRIDGE_X;
  const d = DUNGENESS_OPEN && !inside ? sort(dungeness, 0.35 + 0.35 * outside, 15) : { kept: 0, back: dungeness };
  const r = sort(redRock, 0.7, 16);
  const b = sort(rock - redRock, 0.6, 18);
  return { soakMinutes: soakSeconds / 60, inside, dungeness: d, redRock: r, brownRock: b, keepers: d.kept + r.kept + b.kept, thrownBack: d.back + r.back + b.back };
}

/** How long something has been down, in words. */
export function soakWords(soakSeconds: number): string {
  const minutes = Math.round(soakSeconds / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 90) return `${minutes} ${plural(minutes, 'minute')}`;
  const hours = Math.round(soakSeconds / 360) / 10;
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} hours`;
}

/** Why the Dungeness in this pot went over the side again. */
function dungenessRule(h: PotHaul): string {
  if (h.inside) return 'Dungeness may not be taken inside the Bay, and the season is shut until November besides';
  return 'the Dungeness season shut at the end of June and opens again in November';
}

/** What came up, in a sentence or two. */
export function describeHaul(h: PotHaul): string {
  const soak = soakWords(h.soakMinutes * 60);
  if (h.keepers + h.thrownBack === 0) {
    return h.soakMinutes < 10
      ? `Pot up after ${soak}: nothing in it but the bait. Leave it down most of an hour`
      : `Pot up after ${soak}: empty. Poor ground here, try another depth`;
  }
  const kinds: string[] = [];
  if (h.dungeness.kept) kinds.push(`${h.dungeness.kept} Dungeness`);
  if (h.redRock.kept) kinds.push(`${h.redRock.kept} red rock crab`);
  if (h.brownRock.kept) kinds.push(`${h.brownRock.kept} brown rock crab`);
  const small = h.redRock.back + h.brownRock.back;
  const notes: string[] = [];
  if (small) notes.push(`${small} rock crab under four inches went back`);
  if (h.dungeness.back) notes.push(`${h.dungeness.back} Dungeness went back: ${dungenessRule(h)}`);
  // Rock crab want rock and shallower water than Dungeness do.
  if (!h.keepers && !small) notes.push('For rock crab try 4 to 12 m near rocks or pilings');
  const head = h.keepers ? `Pot up after ${soak}: ${kinds.join(' and ')} to keep` : `Pot up after ${soak}: nothing to keep`;
  return [head, ...notes].join('. ');
}

// ---- fishing ----------------------------------------------------------------------------------------

/** What the boat is doing and where, as far as a fish is concerned. */
export interface Water {
  x: number;
  y: number;
  /** Depth of water, metres. */
  depth: number;
  /** Speed through the water, knots. */
  speedKt: number;
  /** At anchor or on a mooring. */
  held: boolean;
  // The rest may be left out, and are then taken as fair: the tide running, a good hour, no birds about.
  /** Speed over the ground, knots: what a drifted bait is doing over the sand. */
  sogKt?: number;
  /** Speed of the tidal stream here, knots. */
  streamKt?: number;
  /** Rise of tide, metres an hour. Positive on the flood. */
  tideRate?: number;
  /** Local time of day, hours, 0 to 24. */
  hour?: number;
  /** 0 to 1: how close birds are working bait fish. */
  bait?: number;
}

/** Under this she is drifting, and the bait is on the bottom. Over it the line streams astern. */
export const DRIFT_KT = 1.5;
/** The best of trolling is under this: stripers take a lure at 2 to 4 kt, salmon at 1.5 to 3. */
export const TROLL_BEST_KT = 4;
/** Over this the lure skips along the top and nothing will take it. */
export const SKIP_KT = 5;
/** Under this much stream, knots, it is slack water and the halibut stop feeding. */
export const SLACK_KT = 0.15;
/** The clock is cut into spells this long, and each spell either brings a bite or does not. */
export const BITE_SPELL = 20;
/** Seconds between bites, on average, when the fishing is fair. Good water halves it, poor water stretches it. */
export const FAIR_WAIT = 360;
/** Seconds the player has to strike once a fish is on. */
export const STRIKE_SECONDS = 12;

export type FishingMode = 'still' | 'troll' | 'skip';

export function fishingMode(w: Water): FishingMode {
  if (w.held || w.speedKt < DRIFT_KT) return 'still';
  return w.speedKt > SKIP_KT ? 'skip' : 'troll';
}

/** The San Francisco waterfront, from Fort Mason round past Pier 39 and down the Embarcadero to the ballpark. */
export const CITY_FRONT: Array<[number, number]> = [
  [600, -2500], [2400, -2400], [3500, -2250], [4300, -2700], [4600, -3200], [5000, -4000], [5450, -4800], [5400, -5800],
];

/** Metres from the piers of the city front. */
export function cityFrontDistance(x: number, y: number): number {
  let best = Infinity;
  for (let i = 1; i < CITY_FRONT.length; i++) {
    const [ax, ay] = CITY_FRONT[i - 1];
    const [bx, by] = CITY_FRONT[i];
    const dx = bx - ax;
    const dy = by - ay;
    const u = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
    best = Math.min(best, Math.hypot(x - ax - dx * u, y - ay - dy * u));
  }
  return best;
}

export interface Species {
  id: string;
  name: string;
  /** Smallest and largest likely to be caught, centimetres. */
  size: [number, number];
  /** Legal minimum length in centimetres, where there is one. */
  minCm?: number;
  /** The most that may be kept in a day, where that is few enough to matter. */
  bag?: number;
  /** Set when it may not be kept at all on the game's day, with the reason as it would be said. */
  closed?: string;
  /** Weight in kg is this times the length in cm, cubed. */
  kgPerCm3: number;
  /** How the length is said: a ray is measured across the wings. */
  measure?: string;
  /** How keen it is to bite in this water, 0 for never. About 1 is fair fishing. */
  keen(w: Water, mode: FishingMode): number;
}

/** Stripers take a lure trolled at 2 to 4 kt. Salmon want it slower, 1.5 to 3. */
const striperSpeed = (kt: number) => band(kt, 1.4, 2, 4, SKIP_KT);
const salmonSpeed = (kt: number) => band(kt, 1, 1.5, 3, 3.8);
/** Feeding on moving water: nothing at dead slack, everything once the stream makes half a knot, less again when it rips. */
const running = (w: Water) => (w.streamKt === undefined ? 1 : band(w.streamKt, SLACK_KT - 0.03, 0.5, 2.2, 3.6));
/** Best about the turn of the tide, with the stream just making: slower at dead slack and in the full run. */
const turning = (w: Water) => (w.streamKt === undefined ? 1 : 0.4 + 0.6 * band(w.streamKt, 0.05, 0.3, 1.3, 2.6));
/** Salmon come through the Gate on the flood. */
const flooding = (w: Water) => (w.tideRate === undefined ? 1 : w.tideRate > 0.03 ? 1 : w.tideRate < -0.03 ? 0.25 : 0.5);
/** 1 from first light to mid morning and again through the evening, 0 in the middle of the day and at night. */
export function lowLight(hour: number): number {
  return Math.max(band(hour, 4.5, 5.5, 8.5, 10.5), band(hour, 16.5, 18, 20.5, 21.5));
}
const dark = (hour: number) => hour < 4.5 || hour > 21.5;
/** Early and late is best: `least` of the bite is left in the middle of the day. */
const earlyAndLate = (w: Water, least: number) => (w.hour === undefined ? 1 : least + (1 - least) * lowLight(w.hour));
/** Fish gather under the birds. */
const underBirds = (w: Water, gain: number) => 1 + gain * (w.bait ?? 0);
/** A bait wants to move over the sand at half a knot to a knot and a half. Lying to an anchor it covers no ground. */
const drifting = (w: Water) => (w.held ? 0.6 : 0.55 + 0.45 * band(w.sogKt ?? 1, 0.15, 0.5, 1.5, 2.6));

export const SPECIES: Species[] = [
  {
    // Stripers work the tide lines and the pier ends all over the Bay, best about the turn of the tide, early and late.
    // Fewer of them outside. 18 inches to keep, two a day.
    id: 'striper', name: 'striped bass', size: [38, 95], minCm: 46, bag: 2, kgPerCm3: 1.15e-5,
    keen: (w, mode) => (mode !== 'troll' ? 0
      : striperSpeed(w.speedKt) * band(w.depth, 1.5, 4, 30, 70) * (1 - 0.65 * clamp01((GATE_X - 500 - w.x) / 1500))
        * turning(w) * earlyAndLate(w, 0.5) * underBirds(w, 1.5) * (cityFrontDistance(w.x, w.y) < 450 ? 1.25 : 1)),
  },
  {
    // Kings come in through the Gate on the flood on their way up the rivers, and are trolled for there and outside it.
    // In 2024, as in 2023, the whole California salmon season was closed to let the runs recover, so any that are hooked go back.
    id: 'king', name: 'king salmon', size: [45, 100], minCm: 61, bag: 2, kgPerCm3: 1.2e-5,
    closed: 'The salmon season is closed this year to let the runs recover, so back she goes',
    keen: (w, mode) => (mode !== 'troll' || (w.hour !== undefined && dark(w.hour)) ? 0
      : 0.9 * salmonSpeed(w.speedKt) * clamp01((GATE_X + 500 - w.x) / 1500) * band(w.depth, 6, 12, 200, 400)
        * flooding(w) * earlyAndLate(w, 0.4) * underBirds(w, 1.5)),
  },
  {
    // Halibut lie on the sand flats in 3 to 15 m and take a bait drifted slowly over them, on moving water only.
    // 22 inches to keep, two a day.
    id: 'halibut', name: 'California halibut', size: [42, 105], minCm: 56, bag: 2, kgPerCm3: 1.0e-5,
    keen: (w, mode) => (mode !== 'still' ? 0
      : drifting(w) * band(w.depth, 2, 3, 15, 20) * running(w) * (w.hour !== undefined && dark(w.hour) ? 0.35 : 1) * underBirds(w, 0.5)),
  },
  {
    // 36 inches to keep, three a day.
    id: 'leopard', name: 'leopard shark', size: [60, 150], minCm: 91, bag: 3, kgPerCm3: 4.5e-6,
    keen: (w, mode) => (mode !== 'still' ? 0 : 0.5 * band(w.depth, 1, 1.8, 6, 9) * (0.5 + 0.5 * running(w))),
  },
  {
    id: 'batray', name: 'bat ray', size: [45, 125], kgPerCm3: 1.3e-5, measure: 'across the wings',
    keen: (w, mode) => (mode !== 'still' ? 0 : 0.35 * band(w.depth, 1, 1.8, 7, 10) * (0.5 + 0.5 * running(w))),
  },
  {
    id: 'jacksmelt', name: 'jacksmelt', size: [20, 40], kgPerCm3: 8e-6,
    keen: (w, mode) => (mode !== 'still' ? 0 : 0.6 * band(cityFrontDistance(w.x, w.y), -1, 0, 450, 750) * band(w.depth, 1, 2, 25, 40)),
  },
  {
    // Surfperch may not be kept in San Francisco Bay from April to the end of July, when they are bearing their young.
    id: 'perch', name: 'pile perch', size: [18, 38], kgPerCm3: 1.8e-5,
    closed: 'Surfperch are closed in the Bay until August, so back it goes',
    keen: (w, mode) => (mode !== 'still' ? 0 : 0.5 * band(cityFrontDistance(w.x, w.y), -1, 0, 350, 600) * band(w.depth, 1, 2, 15, 25)),
  },
];

/** Everything that might bite in this water, keenest first. Empty when nothing will. */
export function prospects(w: Water): Array<{ species: Species; keen: number }> {
  const mode = fishingMode(w);
  if (mode === 'skip') return [];
  return SPECIES.map((species) => ({ species, keen: species.keen(w, mode) })).filter((p) => p.keen > 0.02).sort((a, b) => b.keen - a.keen);
}

/** Average seconds between bites in this water, or Infinity if nothing will bite. */
export function typicalWait(w: Water): number {
  const total = prospects(w).reduce((sum, p) => sum + p.keen, 0);
  return total > 0 ? FAIR_WAIT / total : Infinity;
}

export interface Bite {
  species: Species;
  cm: number;
  kg: number;
  /** False for a fish that goes back. */
  keeper: boolean;
  /** Why it goes back: under its legal size, out of season, or one more than the day's limit. */
  back?: 'small' | 'closed' | 'limit';
}

/**
 * Whether a fish takes the line in one spell of the clock, and which. `spell` is the season time divided by
 * `BITE_SPELL`, rounded down. The boat's position counts in patches 250 m across, so two boats side by side at the
 * same moment hook the same fish, and a boat that moves on finds different water.
 */
export function biteIn(w: Water, spell: number): Bite | null {
  const on = prospects(w);
  const total = on.reduce((sum, p) => sum + p.keen, 0);
  if (!(total > 0)) return null;
  const cx = Math.floor(w.x / 250);
  const cy = Math.floor(w.y / 250);
  if (hash01(spell, cx, cy, 21) >= Math.min(0.5, (total * BITE_SPELL) / FAIR_WAIT)) return null;
  let pick = hash01(spell, cx, cy, 22) * total;
  let species = on[on.length - 1].species;
  for (const p of on) {
    pick -= p.keen;
    if (pick < 0) { species = p.species; break; }
  }
  // Mostly smaller fish, now and then a good one.
  const [lo, hi] = species.size;
  const cm = Math.round(lo + (hi - lo) * Math.pow(hash01(spell, cx, cy, 23), 1.6));
  const kg = species.kgPerCm3 * cm * cm * cm;
  const back = species.closed ? 'closed' : species.minCm !== undefined && cm < species.minCm ? 'small' : undefined;
  return back ? { species, cm, kg, keeper: false, back } : { species, cm, kg, keeper: true };
}

/** The same fish, sent back if the day's limit of its kind is aboard already. */
export function withinLimit(b: Bite, aboard: number): Bite {
  if (!b.keeper || b.species.bag === undefined || aboard < b.species.bag) return b;
  return { ...b, keeper: false, back: 'limit' };
}

const weightWords = (kg: number) => (kg >= 1 ? `${kg.toFixed(1)} kg` : `${Math.round(kg * 100) * 10} g`);

const NUMBER = ['no', 'one', 'two', 'three', 'four', 'five'];

/** A landed fish in words: what it is, how big, and whether it stays aboard. */
export function describeFish(b: Bite): string {
  const article = /^[aeiou]/i.test(b.species.name) ? 'An' : 'A';
  const size = `${b.cm} cm${b.species.measure ? ` ${b.species.measure}` : ''}`;
  if (b.back === 'closed') return `${article} ${b.species.name}, ${size} and ${weightWords(b.kg)}. ${b.species.closed}`;
  if (b.back === 'limit') return `${article} ${b.species.name}, ${size} and ${weightWords(b.kg)}. The limit is ${NUMBER[b.species.bag!] ?? b.species.bag} a day and they are aboard, so back it goes`;
  if (!b.keeper) return `${article} ${b.species.name}, ${size}: under the ${b.species.minCm} cm limit, so back it goes`;
  return `${article} ${b.species.name}, ${size} and ${weightWords(b.kg)}, in the boat`;
}

/**
 * Why little or nothing is biting, as a fishing skipper would put it, or what is in the boat's favour.
 * Empty when there is nothing worth saying.
 */
export function fishingReason(w: Water): string {
  const mode = fishingMode(w);
  if (mode === 'skip') return '';
  if (mode === 'still') {
    if (!(w.depth >= 2 && w.depth <= 20)) return '';
    if (w.streamKt !== undefined && w.streamKt < SLACK_KT) return 'Slack water. The halibut will wake up when the tide starts to run';
    if (w.streamKt !== undefined && w.streamKt > 3.2) return 'The tide is running too hard to hold a bait on the bottom. It will fish as it eases';
    if (!w.held && w.sogKt !== undefined && w.sogKt > 2.2) return `She is going over the ground at ${w.sogKt.toFixed(1)} kt, too fast for a bait on the sand. Halibut want half a knot to a knot and a half`;
    if ((w.bait ?? 0) > 0.3) return 'Birds are working bait close by, and the fish will be under them';
    return '';
  }
  if (w.speedKt > TROLL_BEST_KT) return 'That is fast for a lure. Stripers want 2 to 4 kt and salmon 1.5 to 3';
  const salmonWater = w.x < GATE_X + 500;
  if (salmonWater && w.hour !== undefined && dark(w.hour)) return 'Salmon do not feed in the dark. Stripers will, about the turn of the tide';
  if (salmonWater && w.tideRate !== undefined && w.tideRate < -0.03) return 'The salmon come in through the Gate on the flood, and this is the ebb';
  if ((w.bait ?? 0) > 0.3) return 'Birds are working bait close by. Tow the lure past the edge of them';
  if (w.streamKt !== undefined && w.streamKt > 2.6) return 'The tide is in full run. Stripers bite best about the turn, when it slackens';
  if (w.hour !== undefined && lowLight(w.hour) < 0.3 && !dark(w.hour)) return 'The middle of the day is the slow time for stripers and salmon. Early and late is best';
  return '';
}

/** What to expect with the line out here, said when it goes over and when things change. */
export function fishingAdvice(w: Water): string {
  const mode = fishingMode(w);
  if (mode === 'skip') return `At ${w.speedKt.toFixed(1)} kt the lure is skipping on top and nothing will take it. Slow to ${TROLL_BEST_KT} kt or less and it will fish`;
  const on = prospects(w);
  const why = fishingReason(w);
  const and = why ? `. ${why}` : '';
  if (mode === 'troll') {
    if (!on.length) return `Trolling at ${w.speedKt.toFixed(1)} kt, but there is little to troll for in ${Math.round(w.depth)} m here${and}`;
    return `Trolling at ${w.speedKt.toFixed(1)} kt for ${on.slice(0, 2).map((p) => p.species.name).join(' and ')}${and}`;
  }
  const how = w.held ? 'Bait on the bottom' : 'Drifting a bait';
  if (!on.length) {
    if (why) return `${how} in ${Math.round(w.depth)} m. ${why}`;
    return `${how} in ${Math.round(w.depth)} m. Too deep to hope for much: try the flats in 3 to 15 m, or troll at 2 to ${TROLL_BEST_KT} kt`;
  }
  return `${how} in ${Math.round(w.depth)} m for ${on.slice(0, 2).map((p) => p.species.name).join(' and ')}${and}`;
}
