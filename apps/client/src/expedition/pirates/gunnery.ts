import { MEN_PER_GUN, MEN_TO_SAIL } from './tables';

// Great guns, as pure arithmetic: whether a broadside bears, how fast it is served, and what each shot does.
// Nothing here is random: every roll is a hash of the seed handed in, so a test can pin a fight.
//
// The rules, in one place:
//  - A broadside bears when the target is within BEAR_ARC of the beam on that side, and inside MAX_RANGE.
//  - Each gun rolls on its own. Its chance is: range (0.82 at the muzzle, falling off with a 210 m scale) x how much
//    of her the target shows (broadside-on a long hull, end-on only her beam) x heel x sea x the crew's skill.
//  - Heel. The guns can be laid 7 degrees up or down. Past that, the LEE battery points into the sea (its chance
//    falls to nothing by 15 degrees of heel) and the WEATHER battery points over her (it loses less, but its shot
//    goes high into the rigging). So the ship to windward, firing her lee guns, hulls her enemy if she is not
//    pressed; the ship to leeward dismasts hers. A ship carrying too much sail cannot fight her lee guns at all.
//  - Sea. Above half a metre of sea every metre takes a fifth off, down to half.
//  - A shot along her length rakes: a hit through the stern does 1.7 times the harm to the hull and 2.4 times to
//    the men, through the bow 1.3 and 1.7.
//  - Reloading takes RELOAD seconds with a full gun's crew to every gun on the side, longer in proportion short-handed.

const D2R = Math.PI / 180;

/** Half the arc a broadside trains through, either side of the beam, degrees. */
export const BEAR_ARC = 32;
/** Beyond this a 4-pounder is noise, metres. */
export const MAX_RANGE = 620;
/** Seconds to serve a broadside with every gun fully manned. */
export const RELOAD = 42;
/** How far the guns can be laid up or down, degrees. */
export const LAY = 7;

export type Side = 'port' | 'starboard';

/** Repeatable roll in 0..1 from four whole numbers. */
export function roll(a: number, b: number, c: number, d = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041) + Math.imul(d | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A ship as the guns see her: where she is, how she heads, how big a mark she is. */
export interface Mark {
  x: number;
  y: number;
  /** Compass heading, radians. */
  heading: number;
  loa: number;
  beam: number;
}

/** Which side the target lies on and how far off the beam, radians: 0 is square on the beam. */
export function bearing(from: Mark, to: { x: number; y: number }): { side: Side; offBeam: number; range: number; relative: number } {
  const rel = wrap(Math.atan2(to.x - from.x, to.y - from.y) - from.heading);
  return { side: rel >= 0 ? 'starboard' : 'port', offBeam: Math.abs(Math.abs(rel) - Math.PI / 2), range: Math.hypot(to.x - from.x, to.y - from.y), relative: rel };
}

/** True when the broadside on that side can be brought to bear on the target. */
export function bears(from: Mark, to: { x: number; y: number }, side: Side): boolean {
  const b = bearing(from, to);
  return b.side === side && b.offBeam <= BEAR_ARC * D2R && b.range <= MAX_RANGE;
}

/** Guns on one side that have men to work them. */
export function gunsServed(gunsInAll: number, crew: number): number {
  const perSide = Math.floor(gunsInAll / 2);
  return Math.max(0, Math.min(perSide, Math.floor((crew - MEN_TO_SAIL) / MEN_PER_GUN + 1e-9)));
}

/** Seconds to reload one side. With men for every gun it is `RELOAD`. Short of men for the guns she has, it is longer, up to three times. */
export function reloadSeconds(gunsInAll: number, crew: number): number {
  const perSide = Math.floor(gunsInAll / 2);
  const want = perSide * MEN_PER_GUN + MEN_TO_SAIL;
  return RELOAD * Math.max(1, Math.min(3, want / Math.max(1, crew)));
}

export interface Shot {
  /** Metres. */
  range: number;
  /** The side fired from, and the firing ship's heel in radians, positive to starboard. */
  side: Side;
  heel: number;
  /** Significant height of the sea, metres. */
  sea: number;
  /** The firing crew's skill, 0 to 1. */
  gunnery: number;
  /** The angle between the line of fire and the target's keel, radians: 0 looking along her from astern, pi from ahead. */
  aspect: number;
  targetLoa: number;
  targetBeam: number;
}

/** What heel does to a battery: how much of its chance is left, and how much of what hits goes into the rigging. */
export function heelEffect(side: Side, heel: number): { chance: number; aloft: number; lee: boolean } {
  const deg = Math.abs(heel) / D2R;
  // Heeled to starboard, the starboard guns are the lee guns and look down.
  const lee = deg > 0.5 && (heel > 0) === (side === 'starboard');
  const over = Math.max(0, deg - LAY);
  if (lee) return { chance: Math.max(0, 1 - over / 8), aloft: 0.15, lee };
  return { chance: Math.max(0.35, 1 - over / 16), aloft: Math.min(0.85, 0.3 + deg / 22), lee };
}

/** How the target lies to the shot: how much of a mark she is, and whether it rakes her. */
export function aspectEffect(aspect: number, loa: number, beam: number): { mark: number; rake: 'stern' | 'bow' | null } {
  const a = Math.abs(wrap(aspect));
  const shown = Math.abs(Math.sin(a)) * loa + Math.abs(Math.cos(a)) * beam;
  const mark = Math.max(0.45, Math.min(1.3, Math.sqrt(shown / 20)));
  const rake = a < 25 * D2R ? 'stern' : a > 155 * D2R ? 'bow' : null;
  return { mark, rake };
}

/** The chance that one gun of a broadside hits. */
export function hitChance(s: Shot): number {
  if (s.range > MAX_RANGE) return 0;
  const byRange = 0.82 * Math.exp(-s.range / 210);
  const bySea = 1 - Math.max(0, Math.min(0.5, (s.sea - 0.5) * 0.2));
  const chance = byRange * aspectEffect(s.aspect, s.targetLoa, s.targetBeam).mark * heelEffect(s.side, s.heel).chance * bySea * s.gunnery;
  return Math.max(0, Math.min(0.92, chance));
}

export interface Harm {
  /** Guns fired, and how many hit. */
  fired: number;
  hits: number;
  hull: number;
  rigging: number;
  men: number;
  /** Guns knocked off their carriages. */
  gunsLost: number;
  rake: 'stern' | 'bow' | null;
  /** For each gun: true for a hit. For drawing the splashes. */
  each: boolean[];
}

/**
 * One broadside: every gun served rolls for itself.
 * @param guns guns fired
 * @param lb weight of shot, pounds
 * @param seed a whole number that is different for every broadside of every ship: the fight's seed and a count
 */
export function broadside(guns: number, lb: number, s: Shot, seed: number): Harm {
  const chance = hitChance(s);
  const heel = heelEffect(s.side, s.heel);
  const { rake } = aspectEffect(s.aspect, s.targetLoa, s.targetBeam);
  const weight = 2.8 * Math.sqrt(lb);
  const harm: Harm = { fired: guns, hits: 0, hull: 0, rigging: 0, men: 0, gunsLost: 0, rake, each: [] };
  for (let g = 0; g < guns; g++) {
    const hit = roll(seed, g, 1) < chance;
    harm.each.push(hit);
    if (!hit) continue;
    harm.hits++;
    const force = weight * (0.7 + 0.6 * roll(seed, g, 2));
    if (roll(seed, g, 3) < heel.aloft) {
      harm.rigging += force * 1.5;
      if (roll(seed, g, 4) < 0.25) harm.men += 1;
    } else {
      // A lee gun's shot strikes low, between wind and water.
      harm.hull += force * (rake === 'stern' ? 1.7 : rake === 'bow' ? 1.3 : 1) * (heel.lee ? 1.15 : 1);
      const cut = (rake === 'stern' ? 2.4 : rake === 'bow' ? 1.7 : 1) * (0.4 + 1.2 * roll(seed, g, 5)) * Math.sqrt(lb / 4);
      harm.men += Math.floor(cut + roll(seed, g, 6));
      if (roll(seed, g, 7) < 0.07) harm.gunsLost++;
    }
  }
  return harm;
}

/** Share of her speed a ship still makes with this much of her rigging standing, 0 to 100. */
export function driveLeft(rigging: number): number {
  return 0.3 + 0.7 * Math.max(0, Math.min(1, rigging / 100));
}
