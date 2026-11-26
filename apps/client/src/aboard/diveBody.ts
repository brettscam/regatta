/**
 * The diver's own body in the water, as rules: how she floats at each depth, where the chase camera can sit without
 * going into the rock or the kelp, and which fish (or lobster, or scallop) the view locks on to. Pure, for tests.
 * The feature is `dive.ts`. Sim coordinates: x east, y north, `d` metres down.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- buoyancy -------------------------------------------------------------------------------------------

export const BUOY = {
  /** Litres of air in a full breath, and in a 5 mm wetsuit's neoprene at the surface; a rash vest has next to none. */
  lungL: 6,
  suitL: 5,
  vestL: 1,
  /** She weights herself to be neutral here, metres, as freedivers do. */
  neutral: 10,
  /** Her mass and the water she carries with her, kilograms: what the lift has to move. */
  mass: 160,
  g: 9.81,
} as const;

/** The air in her suit for the water's temperature: a 5 mm suit in a cold sea, a rash vest in the tropics. */
export function suitFor(tempC: number): number {
  return tempC >= 25 ? BUOY.vestL : tempC >= 21 ? 3 : BUOY.suitL;
}

/**
 * Her buoyancy at a depth, as an acceleration in m/s², positive down. The air in her lungs and her suit is squeezed
 * smaller the deeper she goes (by Boyle: a half at 10 m, a third at 20), so she floats near the top, hangs neutral
 * at about 10 m, and below that sinks: the free fall of a deep dive, and the long kick back up through it.
 */
export function buoyancy(depth: number, suitL: number, neutral: number = BUOY.neutral): number {
  const gas = BUOY.lungL + suitL;
  const lift = gas / (1 + Math.max(0, depth) / 10) - gas / (1 + neutral / 10);
  return (-lift * BUOY.g) / BUOY.mass;
}

// ---- the chase camera -----------------------------------------------------------------------------------

export const CHASE = {
  /** Metres behind her, and above; and how much further back at full speed. */
  back: 3.1,
  up: 0.75,
  wide: 0.9,
  /** Never closer than this, metres, and kept this far off anything solid. */
  least: 0.7,
  margin: 0.35,
  /** Steps the line out from her is tested at, metres. */
  step: 0.2,
} as const;

/** How far behind her the camera wants to be at a speed, m/s: a little further back as she goes faster. */
export function chaseLength(speed: number): number {
  return CHASE.back + CHASE.wide * clamp(speed / 1.4, 0, 1);
}

/**
 * How far out along a line from her the camera can go, metres: the first point where the line meets anything solid,
 * less a margin, and never less than `least`. `solid` says whether a point is in rock, sand or a kelp stalk.
 * The camera pulls in rather than clip.
 */
export function chaseReach(from: { x: number; y: number; d: number }, dir: { x: number; y: number; d: number }, want: number, solid: (x: number, y: number, d: number) => boolean): number {
  for (let s = CHASE.step; s <= want + CHASE.margin; s += CHASE.step) {
    if (solid(from.x + dir.x * s, from.y + dir.y * s, from.d + dir.d * s)) return Math.max(CHASE.least, Math.min(want, s - CHASE.margin));
  }
  return want;
}

// ---- lock ------------------------------------------------------------------------------------------------

export interface Lockable {
  /** Anything that tells one from another and stays the same while it lives: a fish's index, or 'l3' for a lobster. */
  key: string;
  x: number; y: number; d: number;
  /** A fish legal to take now (right size, not protected or spared), or a hand target that may be taken. */
  legal: boolean;
  /** Still there to look at: not gone, not on the shaft, not taken. */
  live: boolean;
}

export const LOCK = {
  /** Only what is within this of straight ahead, radians, and this far, metres, is a candidate. */
  cone: 0.75,
  far: 14,
  /** The lock breaks once it is behind her by this, radians, or further than this share of what she can see. */
  lose: 1.4,
  sight: 0.95,
} as const;

/**
 * What she could lock on to, best first: in front of her, near, and legal before not. A fish she may not take can
 * still be looked at, after the others.
 */
export function lockCandidates<T extends Lockable>(eye: { x: number; y: number; d: number }, look: { x: number; y: number; d: number }, list: readonly T[], see: number): T[] {
  const far = Math.min(LOCK.far, see);
  const scored: Array<{ t: T; score: number }> = [];
  for (const t of list) {
    if (!t.live) continue;
    const rx = t.x - eye.x;
    const ry = t.y - eye.y;
    const rd = t.d - eye.d;
    const dist = Math.hypot(rx, ry, rd);
    if (dist < 0.3 || dist > far) continue;
    const angle = Math.acos(clamp((rx * look.x + ry * look.y + rd * look.d) / dist, -1, 1));
    if (angle > LOCK.cone) continue;
    scored.push({ t, score: angle * 2.2 + dist / far + (t.legal ? 0 : 0.8) });
  }
  scored.sort((a, b) => a.score - b.score || (a.t.key < b.t.key ? -1 : 1));
  return scored.map((s) => s.t);
}

/** Q again: the next candidate after the one locked, or none once she has been round them all. */
export function nextLock<T extends Lockable>(current: string | null, candidates: readonly T[]): T | null {
  if (!candidates.length) return null;
  if (current === null) return candidates[0];
  const i = candidates.findIndex((c) => c.key === current);
  if (i < 0) return candidates[0];
  return i + 1 < candidates.length ? candidates[i + 1] : null;
}

export type LockBreak = 'gone' | 'far' | 'behind' | null;

/** Whether a lock still holds: it breaks when the thing is gone, out of sight in the murk, or got round behind her. */
export function lockBreaks(eye: { x: number; y: number; d: number }, look: { x: number; y: number; d: number }, t: Lockable, see: number): LockBreak {
  if (!t.live) return 'gone';
  const rx = t.x - eye.x;
  const ry = t.y - eye.y;
  const rd = t.d - eye.d;
  const dist = Math.hypot(rx, ry, rd);
  if (dist > see * LOCK.sight) return 'far';
  if (dist > 0.3 && Math.acos(clamp((rx * look.x + ry * look.y + rd * look.d) / dist, -1, 1)) > LOCK.lose) return 'behind';
  return null;
}

/**
 * The way to look to keep a locked thing in view, as compass yaw and pitch up from level, plus the lead she has
 * dialled in with the turn keys (radians, ahead of it along its way). Eased by whoever uses it.
 */
export function lookToward(eye: { x: number; y: number; d: number }, t: { x: number; y: number; d: number }, lead = 0): { yaw: number; pitch: number } {
  const rx = t.x - eye.x;
  const ry = t.y - eye.y;
  const flat = Math.hypot(rx, ry);
  return { yaw: Math.atan2(rx, ry) + lead, pitch: Math.atan2(-(t.d - eye.d), Math.max(flat, 1e-3)) };
}
