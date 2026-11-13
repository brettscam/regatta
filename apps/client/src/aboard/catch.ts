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
/** Legal sizes across the back, millimetres: Dungeness 5 3/4 inches, red rock crab 4 inches. */
export const DUNGENESS_MIN_MM = 146;
export const RED_ROCK_MIN_MM = 102;

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
  /** Legal crab kept, and small ones put back, of each kind. */
  dungeness: { kept: number; back: number };
  redRock: { kept: number; back: number };
  keepers: number;
  thrownBack: number;
}

/**
 * What is in a pot when it comes up.
 * Dungeness like sand in 8 to 30 m, and inside the Bay most of them are young ones under the size. Outside the Gate
 * more are keepers. Red rock crab like it shallower and rockier, 4 to 15 m, and more of them make the size.
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
  let redRock = count(4.5 * redRockGround, 14);
  // A pot only holds so many.
  while (dungeness + redRock > 12) {
    if (dungeness >= redRock) dungeness--;
    else redRock--;
  }
  const sort = (n: number, legalShare: number, salt: number) => {
    let kept = 0;
    for (let i = 0; i < n; i++) if (hash01(pot.x, pot.y, pot.t, salt, i) < legalShare) kept++;
    return { kept, back: n - kept };
  };
  const d = sort(dungeness, 0.35 + 0.35 * outside, 15);
  const r = sort(redRock, 0.7, 16);
  return { soakMinutes: soakSeconds / 60, dungeness: d, redRock: r, keepers: d.kept + r.kept, thrownBack: d.back + r.back };
}

/** How long something has been down, in words. */
export function soakWords(soakSeconds: number): string {
  const minutes = Math.round(soakSeconds / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 90) return `${minutes} ${plural(minutes, 'minute')}`;
  const hours = Math.round(soakSeconds / 360) / 10;
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} hours`;
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
  const back = h.thrownBack ? `${h.thrownBack} undersized went back` : '';
  if (!h.keepers) return `Pot up after ${soak}: ${h.thrownBack} crab, all under the size. Back they went`;
  return `Pot up after ${soak}: ${kinds.join(' and ')} to keep${back ? `, ${back}` : ''}`;
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
}

/** Under this she is drifting, and the bait is on the bottom. Over it the line streams astern. */
export const DRIFT_KT = 1.5;
/** The best of trolling is under this. */
export const TROLL_BEST_KT = 5;
/** Over this the lure skips along the top and nothing will take it. */
export const SKIP_KT = 6;
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
  /** Weight in kg is this times the length in cm, cubed. */
  kgPerCm3: number;
  /** How the length is said: a ray is measured across the wings. */
  measure?: string;
  /** How keen it is to bite in this water, 0 for never. About 1 is fair fishing. */
  keen(w: Water, mode: FishingMode): number;
}

/** How well the boat's speed suits a trolled lure. */
const trollSpeed = (kt: number) => band(kt, 1.2, DRIFT_KT, TROLL_BEST_KT, SKIP_KT + 0.35);

export const SPECIES: Species[] = [
  {
    // Stripers work the tide lines all over the Bay. Fewer of them outside.
    id: 'striper', name: 'striped bass', size: [38, 95], minCm: 46, kgPerCm3: 1.15e-5,
    keen: (w, mode) => (mode !== 'troll' ? 0 : trollSpeed(w.speedKt) * band(w.depth, 1.5, 4, 30, 70) * (1 - 0.65 * clamp01((GATE_X - 500 - w.x) / 1500))),
  },
  {
    // Kings come in through the Gate on their way up the rivers. They are caught trolling at the Gate and outside it.
    id: 'king', name: 'king salmon', size: [45, 100], minCm: 51, kgPerCm3: 1.2e-5,
    keen: (w, mode) => (mode !== 'troll' ? 0 : 0.9 * trollSpeed(w.speedKt) * clamp01((GATE_X + 500 - w.x) / 1500) * band(w.depth, 6, 12, 200, 400)),
  },
  {
    // Halibut lie on the sand flats and take a bait moved slowly over them. A drift covers more ground than lying to an anchor.
    id: 'halibut', name: 'California halibut', size: [42, 105], minCm: 56, kgPerCm3: 1.0e-5,
    keen: (w, mode) => (mode !== 'still' ? 0 : (w.held ? 0.7 : 1) * band(w.depth, 2, 3, 15, 20)),
  },
  {
    id: 'leopard', name: 'leopard shark', size: [60, 150], minCm: 91, kgPerCm3: 4.5e-6,
    keen: (w, mode) => (mode !== 'still' ? 0 : 0.5 * band(w.depth, 1, 1.8, 6, 9)),
  },
  {
    id: 'batray', name: 'bat ray', size: [45, 125], kgPerCm3: 1.3e-5, measure: 'across the wings',
    keen: (w, mode) => (mode !== 'still' ? 0 : 0.35 * band(w.depth, 1, 1.8, 7, 10)),
  },
  {
    id: 'jacksmelt', name: 'jacksmelt', size: [20, 40], kgPerCm3: 8e-6,
    keen: (w, mode) => (mode !== 'still' ? 0 : 0.6 * band(cityFrontDistance(w.x, w.y), -1, 0, 450, 750) * band(w.depth, 1, 2, 25, 40)),
  },
  {
    id: 'perch', name: 'pile perch', size: [18, 38], kgPerCm3: 1.8e-5,
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
  /** False for a fish under its legal size, which goes back. */
  keeper: boolean;
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
  return { species, cm, kg, keeper: species.minCm === undefined || cm >= species.minCm };
}

const weightWords = (kg: number) => (kg >= 1 ? `${kg.toFixed(1)} kg` : `${Math.round(kg * 100) * 10} g`);

/** A landed fish in words: what it is, how big, and whether it stays aboard. */
export function describeFish(b: Bite): string {
  const article = /^[aeiou]/i.test(b.species.name) ? 'An' : 'A';
  const size = `${b.cm} cm${b.species.measure ? ` ${b.species.measure}` : ''}`;
  if (!b.keeper) return `${article} ${b.species.name}, ${size}: under the ${b.species.minCm} cm limit, so back it goes`;
  return `${article} ${b.species.name}, ${size} and ${weightWords(b.kg)}, in the boat`;
}

/** What to expect with the line out here, said when it goes over and when things change. */
export function fishingAdvice(w: Water): string {
  const mode = fishingMode(w);
  if (mode === 'skip') return `At ${w.speedKt.toFixed(1)} kt the lure is skipping on top. Slow to ${TROLL_BEST_KT} kt or less and it will fish`;
  const on = prospects(w);
  if (mode === 'troll') {
    if (!on.length) return `Trolling at ${w.speedKt.toFixed(1)} kt, but there is little to troll for in ${Math.round(w.depth)} m here`;
    return `Trolling at ${w.speedKt.toFixed(1)} kt for ${on.slice(0, 2).map((p) => p.species.name).join(' and ')}`;
  }
  const how = w.held ? 'Bait on the bottom' : 'Drifting a bait';
  if (!on.length) return `${how} in ${Math.round(w.depth)} m. Too deep to hope for much: try the flats in 3 to 15 m, or troll at 2 to 5 kt`;
  return `${how} in ${Math.round(w.depth)} m for ${on.slice(0, 2).map((p) => p.species.name).join(' and ')}`;
}
