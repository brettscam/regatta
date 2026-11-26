/**
 * The scene's floating origin.
 *
 * Everything in the game keeps its true place: course metres in the sim and the world, scene metres (x east, z south)
 * in every object's position, all of it in JavaScript's double precision. The graphics card works in single precision,
 * which holds only seven figures: twenty kilometres out a position is good to two millimetres, and a camera there sums
 * large numbers that should cancel. The water, the shadows and anything else drawn from a position on the card shake
 * by that much as the camera moves. So the picture is drawn about a point near the boat being followed, and the card
 * only ever sees small numbers. `Stage` keeps that point and does the drawing; these are the rules it keeps to.
 */

/**
 * The origin moves in whole steps of this many metres: a whole number of the rain's 44 m boxes and of the dive scene's
 * 40 m and 14 m tiles, so things that repeat about the eye do not jump when it moves.
 */
export const ORIGIN_STEP = 3080;
/** It moves when the boat is further than this from it, east or south. A step later she is well inside it again. */
export const ORIGIN_REACH = 2000;

export interface Origin {
  /** Scene metres east. */
  x: number;
  /** Scene metres south (the course's north is -z). */
  z: number;
}

/**
 * Follow the boat. Leaves the origin alone while she is within reach of it, so it moves rarely, and never back and forth
 * across a line: after a move she is at most half a step off it, five hundred metres short of the next move.
 * @returns true if the origin moved
 */
export function rebase(origin: Origin, x: number, z: number): boolean {
  if (Math.abs(x - origin.x) <= ORIGIN_REACH && Math.abs(z - origin.z) <= ORIGIN_REACH) return false;
  // A boat that is not anywhere (NaN) leaves it where it is.
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  origin.x = Math.round(x / ORIGIN_STEP) * ORIGIN_STEP + 0;
  origin.z = Math.round(z / ORIGIN_STEP) * ORIGIN_STEP + 0;
  return true;
}

/** `value` modulo `period`, in [0, period). Done in double precision, for the card to take the small remainder. */
export function wrap(value: number, period: number): number {
  const r = value % period;
  return r < 0 ? r + period : r + 0;
}
