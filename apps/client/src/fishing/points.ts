/**
 * Points for a catch, and the book they are kept in. Pure: no screen, no storage (the feature does the keeping).
 *
 * A fish is scored by how big it is for its kind. `worth` is what the biggest there is of a species would score; the
 * smallest scores about an eighth of that, and the curve is steep at the top, so one good fish of a hard species
 * beats a limit of small easy ones.
 */
import worthJson from '../data/fishWorth.json';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round5 = (v: number) => Math.round(v / 5) * 5;

export interface Sized { size: [number, number]; trophyCm?: number; worth: number }

/** How big a fish is for its kind: 0 the smallest caught, 1 the biggest there is. */
export function bigness(sp: Pick<Sized, 'size' | 'trophyCm'>, cm: number): number {
  const top = sp.trophyCm ?? sp.size[1];
  return clamp01((cm - sp.size[0]) / Math.max(1, top - sp.size[0]));
}

/** Points for a fish of this length, to the nearest five and never fewer than five. */
export function pointsFor(sp: Sized, cm: number): number {
  return Math.max(5, round5(sp.worth * (0.12 + 0.88 * Math.pow(bigness(sp, cm), 1.5))));
}

/** `worth` for a species of the game's first table, by its id. */
export const firstTableWorth = (id: string): number => (worthJson as { worth: Record<string, number> }).worth[id] ?? 100;

/**
 * What became of a landed fish. `kept` in the box; `released` by choice or because the limit was aboard; `short`
 * under its legal size, so back it went; `protected` let go as it must be; `poached` a protected fish kept.
 */
export type Fate = 'kept' | 'released' | 'short' | 'protected' | 'poached';

/**
 * What a landed fish scores. The catch is the catch, kept or let go, and letting a fish go that could have been kept
 * (or one that has to be) earns a tenth more. A short fish scores half. Keeping a protected fish costs its points.
 */
export function landedPoints(sp: Sized, cm: number, fate: Fate): number {
  const p = pointsFor(sp, cm);
  if (fate === 'kept') return p;
  if (fate === 'short') return Math.max(5, round5(p / 2));
  if (fate === 'poached') return -Math.max(100, p);
  return p + Math.max(5, round5(p / 10));
}

/** Experience for a catch: a twentieth of its points, at least 2 and at most 40. Modest beside a clean tack's 15 or a race's 75 a boat. */
export function xpFor(points: number): number {
  if (points < 0) return -25;
  return Math.min(40, Math.max(2, Math.round(points / 20)));
}

// ---- saying it ---------------------------------------------------------------------------------------------------

export const inches = (cm: number): number => Math.round(cm / 2.54);
export const pounds = (kg: number): number => kg * 2.20462;
export const poundWords = (kg: number): string => {
  const lb = pounds(kg);
  return lb < 1 ? `${Math.max(1, Math.round(lb * 16))} oz` : lb < 10 ? `${lb.toFixed(1)} lb` : `${Math.round(lb)} lb`;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Yellowtail, 31 in, 16 lb" */
export function fishWords(name: string, cm: number, kg: number, measure?: string): string {
  return `${cap(name)}, ${inches(cm)} in${measure ? ` ${measure}` : ''}, ${poundWords(kg)}`;
}

/** "Yellowtail, 31 in, 16 lb — 240 points" */
export function scoreWords(name: string, cm: number, kg: number, points: number, measure?: string): string {
  const pts = points < 0 ? `${points} points` : `${points} ${points === 1 ? 'point' : 'points'}`;
  return `${fishWords(name, cm, kg, measure)} — ${pts}`;
}

// ---- the book ------------------------------------------------------------------------------------------------------

export interface CreelSpecies {
  name: string;
  /** Landed, kept or not. */
  n: number;
  bestCm: number;
  bestKg: number;
  bestPoints: number;
  /** The water the best one came from: a course id. */
  water: string;
}

/** Every fish this player has landed, added up: kept on the device, shown on the Logbook tab. */
export interface Creel {
  points: number;
  fish: number;
  released: number;
  species: Record<string, CreelSpecies>;
  /** Tournaments fished to the weigh-in, and won. */
  derbies: number;
  derbyWins: number;
}

export const emptyCreel = (): Creel => ({ points: 0, fish: 0, released: 0, species: {}, derbies: 0, derbyWins: 0 });

export interface Landed {
  /** Species id and name. */
  id: string;
  name: string;
  cm: number;
  kg: number;
  points: number;
  fate: Fate;
  water: string;
}

/** The book with one more fish in it. A poached fish takes its points off and sets no best. */
export function addToCreel(c: Creel, f: Landed): Creel {
  const out: Creel = { ...c, species: { ...c.species }, points: Math.max(0, c.points + f.points), fish: c.fish + 1, released: c.released + (f.fate === 'kept' || f.fate === 'poached' ? 0 : 1) };
  if (f.fate === 'poached') return out;
  const was = c.species[f.id];
  const best = !was || f.points > was.bestPoints || (f.points === was.bestPoints && f.cm > was.bestCm);
  out.species[f.id] = {
    name: f.name, n: (was?.n ?? 0) + 1,
    bestCm: best ? f.cm : was!.bestCm, bestKg: best ? f.kg : was!.bestKg, bestPoints: best ? f.points : was!.bestPoints, water: best ? f.water : was!.water,
  };
  return out;
}

const num = (v: unknown, most = 1e9): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(most, v) : 0);

/** A book as it was saved. Anything that is not a sane number is dropped. */
export function readCreel(v: unknown): Creel {
  const out = emptyCreel();
  if (!v || typeof v !== 'object') return out;
  const o = v as Record<string, unknown>;
  out.points = Math.round(num(o.points));
  out.fish = Math.round(num(o.fish));
  out.released = Math.round(num(o.released));
  out.derbies = Math.round(num(o.derbies));
  out.derbyWins = Math.round(num(o.derbyWins));
  if (o.species && typeof o.species === 'object') {
    for (const [id, raw] of Object.entries(o.species as Record<string, unknown>).slice(0, 200)) {
      if (!raw || typeof raw !== 'object' || !/^[a-z0-9-]{1,24}$/.test(id)) continue;
      const s = raw as Record<string, unknown>;
      if (typeof s.name !== 'string' || !(num(s.n) > 0)) continue;
      out.species[id] = { name: s.name.slice(0, 40), n: Math.round(num(s.n)), bestCm: Math.round(num(s.bestCm, 600)), bestKg: num(s.bestKg, 2000), bestPoints: Math.round(num(s.bestPoints, 1e5)), water: typeof s.water === 'string' ? s.water.slice(0, 24) : '' };
    }
  }
  return out;
}

/** The species in the book, best fish first. */
export function creelRows(c: Creel): Array<CreelSpecies & { id: string }> {
  return Object.entries(c.species).map(([id, s]) => ({ id, ...s })).sort((a, b) => b.bestPoints - a.bestPoints || a.name.localeCompare(b.name));
}
