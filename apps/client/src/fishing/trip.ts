/**
 * One sail's fishing: what is in the box against each limit, every fish landed, and the running total.
 * Pure: the feature, the tests and the headless script all land their fish through `landFish`.
 */
import { TIRED_FOR, freshness, patchOf, rulingOf, type Hooked } from './bites';
import { landedPoints, scoreWords, type Fate, type Landed } from './points';

export interface Trip {
  /** Fish of each kind kept this sail, against the day's limit. */
  aboard: Map<string, number>;
  landed: Landed[];
  points: number;
  /** Fish hooked and lost. */
  lost: number;
  /** Season times of the fish hooked in each patch of water, by `patchOf`: what `freshness` reads. */
  worked: Map<string, number[]>;
}

export const newTrip = (): Trip => ({ aboard: new Map(), landed: [], points: 0, lost: 0, worked: new Map() });

/** Note a fish hooked at a place, landed or not: the patch gives fewer bites for a while. */
export function workPatch(trip: Trip, x: number, y: number, now: number): void {
  const key = patchOf(x, y);
  const list = (trip.worked.get(key) ?? []).filter((t) => Math.abs(now - t) < TIRED_FOR);
  list.push(now);
  trip.worked.set(key, list);
}

/** How fresh the water under her is for this boat. */
export const freshAt = (trip: Trip, x: number, y: number, now: number): number => freshness(trip.worked.get(patchOf(x, y)), now);

/** What becomes of a fish at the rail, by the rules and the angler's wish. Short fish and fish over the limit go back whatever she wishes. */
export function fateOf(hooked: Hooked, aboard: number, wish: 'keep' | 'release'): Fate {
  const ruling = rulingOf(hooked.species, hooked.cm, aboard);
  if (ruling === 'protected') return wish === 'keep' ? 'poached' : 'protected';
  if (ruling === 'small') return 'short';
  if (ruling === 'limit') return 'released';
  return wish === 'keep' ? 'kept' : 'released';
}

/** Land a fish: score it, put it in the box or back, and add it to the trip. */
export function landFish(trip: Trip, water: string, hooked: Hooked, wish: 'keep' | 'release'): Landed {
  const sp = hooked.species;
  const fate = fateOf(hooked, trip.aboard.get(sp.id) ?? 0, wish);
  if (fate === 'kept') trip.aboard.set(sp.id, (trip.aboard.get(sp.id) ?? 0) + 1);
  const landed: Landed = { id: sp.id, name: sp.name, cm: hooked.cm, kg: hooked.kg, points: landedPoints(sp, hooked.cm, fate), fate, water };
  trip.landed.push(landed);
  trip.points = Math.max(0, trip.points + landed.points);
  return landed;
}

/** A landed fish as the crew call it: what, how big, what it scored, and what became of it and why. */
export function landedWords(trip: Trip, hooked: Hooked, l: Landed): string {
  const sp = hooked.species;
  const head = scoreWords(sp.name, l.cm, l.kg, l.points, sp.measure);
  if (l.fate === 'kept') return `${head}. In the box`;
  if (l.fate === 'short') return `${head}. Short (${sp.limit}), so back it goes`;
  if (l.fate === 'protected') return `${head}. ${sp.protected}`;
  if (l.fate === 'poached') return `${head}. Giant or not, it may not be kept, and keeping it costs you`;
  if (sp.bag !== undefined && (trip.aboard.get(sp.id) ?? 0) >= sp.bag) return `${head}. The limit is aboard (${sp.limit}), so back it goes`;
  return `${head}. Let go, with a little extra for it`;
}
