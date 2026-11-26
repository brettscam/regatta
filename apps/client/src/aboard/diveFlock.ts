/**
 * A school, as one rule for every fish in it. The leader is steered on the CPU like any fish (`stepFish`); each
 * follower is placed from the leader by this function and nothing else: its own fixed slot in the school (from a
 * hash), the leader's heading as it was a moment ago at that slot (so a turn runs through the school as a shimmer,
 * front to back), a slow wander of its own, a ball that tightens and mills when a hunter works it, and a hole that
 * opens round a diver or a predator. The vertex shader in `diveScene.ts` (SCHOOL) runs the same sums for the picture,
 * so nothing is written per fish per frame; this copy is for tests and for anything the rules need to know.
 * Sim coordinates: x east, y north, `d` metres down; headings compass radians.
 */
import { hash01 } from './catch';

export interface SchoolState {
  x: number; y: number; d: number;
  heading: number;
  /** How fast the leader is turning, radians a second. */
  turn: number;
  /** Metres from the middle to the edge of the school when it is easy. */
  spread: number;
  /** 0 an easy, strung-out school; 1 a tight milling ball. */
  tight: number;
  /** What it opens round: a diver or a hunter, and how wide a hole. */
  threat: { x: number; y: number; d: number; r: number };
}

/** How fast a turn runs back through a school, m/s. */
export const WAVE = 2.5;

/** One fish's own place in its school, and its own beat: four numbers 0 to 1, the same every time. */
export function slotOf(seed: number, k: number): [number, number, number, number] {
  return [hash01(seed, k, 231), hash01(seed, k, 232), hash01(seed, k, 233), hash01(seed, k, 234)];
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Where one fish of a school is at time `t`, and which way it faces. Writes into `out`. */
export function member(slot: readonly [number, number, number, number], s: SchoolState, t: number, out: { x: number; y: number; d: number; heading: number }): typeof out {
  const [u, v, w, p] = slot;
  const sp = s.spread;
  // Easy: strung out along the way it is going, flatter than it is wide.
  let along = (u - 0.5) * 3.2 * sp + 0.2 * sp * Math.sin(t * 0.9 + p * 6.283);
  let across = (v - 0.5) * 2 * sp;
  let up = (w - 0.5) * 1.2 * sp + 0.1 * sp * Math.sin(t * 1.3 + p * 9);
  // A ball: a sphere half as wide, every fish going round it.
  const r = sp * 0.55 * Math.cbrt(u);
  const a = v * 6.283 + t * 0.9;
  const e = (w - 0.5) * 2.5;
  const tight = Math.min(1, Math.max(0, s.tight));
  along += (r * Math.cos(e) * Math.cos(a) - along) * tight;
  across += (r * Math.cos(e) * Math.sin(a) - across) * tight;
  up += (r * Math.sin(e) - up) * tight;
  // The turn reaches the back of the school last.
  const lag = Math.max(0, 1.6 * sp - along) / WAVE;
  const h = s.heading - s.turn * lag;
  const fx = Math.sin(h);
  const fy = Math.cos(h);
  let x = s.x + fx * along + fy * across;
  let y = s.y + fy * along - fx * across;
  let d = s.d - up;
  let heading = h + tight * wrap(a + Math.PI / 2) + 0.15 * (1 - tight) * Math.sin(t * 0.8 + p * 6.283);
  // The hole: nothing comes inside the threat's ring, and those at its edge turn away.
  const tx = x - s.threat.x;
  const ty = y - s.threat.y;
  const td = d - s.threat.d;
  const dist = Math.hypot(tx, ty, td);
  if (dist < s.threat.r && dist > 1e-4) {
    const k = s.threat.r / dist;
    x = s.threat.x + tx * k;
    y = s.threat.y + ty * k;
    d = s.threat.d + td * k;
    heading += 0.8 * (1 - dist / s.threat.r);
  }
  out.x = x; out.y = y; out.d = d; out.heading = heading;
  return out;
}
