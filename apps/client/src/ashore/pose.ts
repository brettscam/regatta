// How a figure ashore holds herself: walking, sitting, leaning on the rail, dancing, waving. Pure numbers, no scene.
// The figure (`boat/crew.ts`, `Figure`) is a set of limbs laid between joints. This says where the joints are, in the
// figure's own frame: +X her right, +Y up, -Z the way she faces, the floor at y = 0 under her.
import type { Emote, Pose } from './wire';

export type V3 = [number, number, number];

export interface Joints {
  pelvis: V3;
  neck: V3;
  footL: V3;
  footR: V3;
  handL: V3;
  handR: V3;
  /** Which way the eyes look. */
  look: V3;
  /** Which way the knees and elbows bend. */
  knee: V3;
  elbowL: V3;
  elbowR: V3;
  /** A turn of the whole figure, radians clockwise seen from above, on top of the way she faces: a dancer's spin. */
  turn: number;
  /** How far forward of the spot she is put: onto the stool, up to the rail. */
  forward: number;
}

/** What is in her hand. A plate is carried in the left hand, everything else in the right. */
export type Held = 'none' | 'glass' | 'mug' | 'bottle' | 'plate';

export interface PoseIn {
  pose: Pose;
  /** Seconds, running: the breath, the sway, the beat. */
  t: number;
  /** Where she is in her stride, radians. Advance it with `stride`. */
  phase: number;
  /** Metres a second over the floor. */
  speed: number;
  /** Her height against a middling figure's (`Figure.tall`). */
  tall: number;
  emote: Emote | '';
  /** Seconds since the emote began. */
  emoteT: number;
  held: Held;
}

export const WALK = 1.45;
export const JOG = 3.3;
/** How long an emote lasts, seconds. */
export const EMOTE_SECONDS = 2.6;
/** A chair's seat and a bar stool's, metres above the floor, as `scene/shoreside.ts` draws them. */
export const CHAIR = 0.45;
export const STOOL = 0.72;
/** The top of the rail. */
export const RAIL = 1.0;

/** How much further round her stride she is after `dt` seconds at `speed`. A stride is two steps. */
export function stride(speed: number, tall: number, dt: number): number {
  const step = stepLength(speed, tall);
  return (Math.PI * Math.abs(speed) * dt) / step;
}

const stepLength = (speed: number, tall: number): number => (0.5 + 0.2 * Math.min(1, Math.abs(speed) / WALK) + 0.38 * Math.max(0, Math.min(1, (Math.abs(speed) - WALK) / (JOG - WALK)))) * tall;

const bell = (x: number): number => (x <= 0 || x >= 1 ? 0 : Math.sin(x * Math.PI));
/** In over the first part of an emote, held, and out over the last. */
const hold = (t: number): number => Math.max(0, Math.min(1, t / 0.3, (EMOTE_SECONDS - t) / 0.4));
const mix = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Where every joint is. */
export function poseOf(p: PoseIn): Joints {
  const tall = p.tall;
  const leg = 0.86 * tall;
  const spine = 0.54 * tall;
  const breath = Math.sin(p.t * 1.6) * 0.004;
  const j: Joints = {
    pelvis: [0, leg, 0], neck: [0, leg + spine + breath, -0.02],
    footL: [-0.1, 0, 0.02], footR: [0.1, 0, 0.02],
    handL: [-0.22, leg - 0.02, 0.03], handR: [0.22, leg - 0.02, 0.03],
    look: [0, -0.02, -1], knee: [0, 0.25, -1], elbowL: [-0.12, -0.3, 1], elbowR: [0.12, -0.3, 1],
    turn: 0, forward: 0,
  };

  if (p.pose === 'stand') {
    const go = Math.min(1, Math.abs(p.speed) / 0.5);
    if (go > 0.02) {
      // Walking, or jogging: feet out and back under her, the one coming forward lifted, arms against the legs.
      const run = Math.max(0, Math.min(1, (Math.abs(p.speed) - WALK) / (JOG - WALK)));
      const half = (stepLength(p.speed, tall) / 2) * go;
      const s = Math.sin(p.phase);
      const c = Math.cos(p.phase);
      const lift = (0.07 + 0.11 * run) * go;
      j.footL = [-0.09, Math.max(0, c) * lift, -s * half + 0.02];
      j.footR = [0.09, Math.max(0, -c) * lift, s * half + 0.02];
      j.pelvis = [s * 0.012, leg - 0.015 * go - 0.03 * run + Math.cos(p.phase * 2) * (0.014 + 0.018 * run) * go, 0];
      j.neck = [s * 0.006, j.pelvis[1] + spine, -0.03 - 0.1 * run];
      const swing = (0.17 + 0.08 * run) * go;
      // Running, the elbows are bent and the hands carried high.
      const carry = 0.2 * run;
      j.handL = [-0.22, leg - 0.02 + carry + Math.abs(s) * 0.03, 0.02 - carry * 0.9 + s * swing];
      j.handR = [0.22, leg - 0.02 + carry + Math.abs(s) * 0.03, 0.02 - carry * 0.9 - s * swing];
      j.look = [0, -0.04, -1];
    } else {
      // Standing easy: the weight shifts a little, now and then.
      const sway = Math.sin(p.t * 0.5) * 0.012;
      j.pelvis[0] = sway;
      j.neck[0] = sway * 0.6;
      j.look = [Math.sin(p.t * 0.23) * 0.25, -0.02, -1];
    }
  } else if (p.pose === 'sit' || p.pose === 'stool') {
    const seat = p.pose === 'sit' ? CHAIR : STOOL;
    const lean = Math.sin(p.t * 0.4) * 0.01;
    j.pelvis = [0, seat + 0.1, 0.02];
    j.neck = [lean, seat + 0.1 + spine - 0.01 + breath, -0.05];
    if (p.pose === 'sit') {
      j.footL = [-0.11, 0, -0.4];
      j.footR = [0.11, 0, -0.4];
      // Hands on the edge of the table.
      j.handL = [-0.17, 0.77, -0.44];
      j.handR = [0.17, 0.77, -0.44];
    } else {
      // Feet on the rung, elbows on the counter.
      j.forward = 0.15;
      j.footL = [-0.11, 0.26, -0.2];
      j.footR = [0.11, 0.26, -0.2];
      j.handL = [-0.2, 1.11, -0.42];
      j.handR = [0.2, 1.11, -0.42];
    }
    j.knee = [0, 0.8, -1];
    j.elbowL = [-0.8, -0.5, 0.3];
    j.elbowR = [0.8, -0.5, 0.3];
    j.look = [Math.sin(p.t * 0.31) * 0.3, 0, -1];
  } else if (p.pose === 'lean') {
    // Both hands on the rail, the weight on them, looking out.
    j.forward = 0.08;
    j.pelvis = [0, leg - 0.03, 0.1];
    j.neck = [0, leg + spine - 0.07 + breath, -0.1];
    j.footL = [-0.12, 0, 0.16];
    j.footR = [0.12, 0, 0.1];
    j.handL = [-0.24, RAIL + 0.03, -0.3];
    j.handR = [0.24, RAIL + 0.03, -0.3];
    j.look = [Math.sin(p.t * 0.17) * 0.5, -0.06, -1];
  } else if (p.pose === 'warm') {
    // Hands held out to the fire.
    j.neck = [0, leg + spine - 0.02 + breath, -0.06];
    j.handL = [-0.14 + Math.sin(p.t * 0.9) * 0.02, leg + 0.12, -0.42];
    j.handR = [0.14 - Math.sin(p.t * 0.9) * 0.02, leg + 0.12, -0.42];
    j.elbowL = [-0.7, -0.7, 0.2];
    j.elbowR = [0.7, -0.7, 0.2];
    j.look = [0, -0.5, -1];
  } else {
    dance(p, j, leg, spine);
  }

  carry(p, j, leg);
  if (p.emote && p.emoteT < EMOTE_SECONDS) emote(p, j, leg);
  return j;
}

/** Two dances, both silly. Two beats a second. */
function dance(p: PoseIn, j: Joints, leg: number, spine: number): void {
  const beat = p.t * Math.PI * 2 * 1.9;
  const bounce = Math.abs(Math.sin(beat / 2));
  if (p.pose === 'dance') {
    // Side to side with the arms up, and a turn every eight bars.
    const side = Math.sin(beat / 2);
    j.pelvis = [side * 0.07, leg - 0.05 - bounce * 0.05, 0];
    j.neck = [side * 0.11, j.pelvis[1] + spine, -0.02];
    j.footL = [-0.16 + side * 0.03, Math.max(0, side) * 0.07, 0.02];
    j.footR = [0.16 + side * 0.03, Math.max(0, -side) * 0.07, 0.02];
    const up = leg + spine + 0.22;
    j.handL = [-0.3 + side * 0.08, up + Math.sin(beat) * 0.08, -0.12];
    j.handR = [0.3 + side * 0.08, up - Math.sin(beat) * 0.08, -0.12];
    j.elbowL = [-1, -0.2, 0.2];
    j.elbowR = [1, -0.2, 0.2];
    const bar = (p.t * 1.9) / 8;
    j.turn = (Math.floor(bar) + smooth(Math.min(1, (bar % 1) * 4))) * Math.PI * 2;
    j.look = [side * 0.3, 0.1, -1];
  } else {
    // The point: one arm thrown up and across, then down to the other hip, with a deep knee bend on the beat.
    const half = Math.floor((p.t * 1.9) / 2) % 2 === 0;
    const k = smooth(Math.min(1, (((p.t * 1.9) / 2) % 1) * 3));
    const high: V3 = [0.42, leg + spine + 0.3, -0.1];
    const low: V3 = [-0.22, leg - 0.05, -0.2];
    j.pelvis = [half ? 0.06 : -0.06, leg - 0.06 - bounce * 0.08, 0];
    j.neck = [half ? 0.1 : -0.1, j.pelvis[1] + spine, -0.03];
    j.handR = half ? mix(low, high, k) : mix(high, low, k);
    j.handL = [-0.2, leg + 0.06, 0.02];
    j.elbowL = [-1, 0, 0.6];
    j.elbowR = [0.8, -0.2, 0.3];
    j.footL = [-0.17, 0, 0.02];
    j.footR = [0.17, bounce * 0.05, 0.02];
    j.knee = [half ? 0.4 : -0.4, 0.2, -1];
    j.look = [half ? 0.6 : -0.5, half ? 0.3 : -0.2, -1];
  }
}

const smooth = (x: number): number => x * x * (3 - 2 * x);

/** Something in the hand: carried in front of her, set on the table when she sits, and lifted for a sip now and then. */
function carry(p: PoseIn, j: Joints, leg: number): void {
  if (p.held === 'none') return;
  const seated = p.pose === 'sit' || p.pose === 'stool';
  if (p.held === 'plate') {
    // A plate is carried flat in the left hand, and eaten from with the right.
    if (!seated) j.handL = [-0.16, leg + 0.2, -0.3];
    const bite = bell(((p.t + 3) % 7) / 1.4);
    if (bite > 0 && p.pose !== 'dance' && p.pose !== 'dance2') j.handR = mix(seated ? j.handR : [0.1, leg + 0.24, -0.28], [0.03, j.neck[1] + 0.1, -0.15], bite);
    return;
  }
  if (p.pose === 'dance' || p.pose === 'dance2') return;
  const rest: V3 = seated ? j.handR : p.pose === 'lean' ? [0.24, RAIL + 0.06, -0.3] : [0.19, leg + 0.24, -0.25];
  // A sip every nine seconds or so, not while she is on the move.
  const sip = Math.abs(p.speed) > 0.3 ? 0 : bell((p.t % 9) / 1.5);
  j.handR = mix(rest, [0.05, j.neck[1] + 0.1, -0.16], sip);
  if (sip > 0.3) j.look = [0, 0.2, -1];
}

function emote(p: PoseIn, j: Joints, leg: number): void {
  const k = hold(p.emoteT);
  const top = j.neck[1];
  if (p.emote === 'wave') {
    j.handR = mix(j.handR, [0.34 + Math.sin(p.emoteT * 11) * 0.12, top + 0.33, -0.08], k);
    j.elbowR = [1, -0.3, 0.1];
    j.look = [0, 0.05, -1];
  } else if (p.emote === 'cheers') {
    j.handR = mix(j.handR, [0.2, top + 0.2 + bell(p.emoteT / 0.8) * 0.06, -0.42], k);
    j.elbowR = [0.6, -0.8, 0.2];
    j.look = [0.1, 0.1, -1];
  } else if (p.emote === 'point') {
    j.handR = mix(j.handR, [0.16, top - 0.02, -0.62], k);
    j.elbowR = [0.4, -1, 0];
    j.look = [0, 0, -1];
  } else if (p.emote === 'shrug') {
    j.handL = mix(j.handL, [-0.42, leg + 0.3 * (p.pose === 'sit' ? 0.4 : 1), -0.16], k);
    j.handR = mix(j.handR, [0.42, leg + 0.3 * (p.pose === 'sit' ? 0.4 : 1), -0.16], k);
    j.neck[1] += 0.025 * k;
    j.elbowL = [-0.6, -1, 0.5];
    j.elbowR = [0.6, -1, 0.5];
    j.look = [0.2, 0.05, -1];
  } else if (p.emote === 'laugh') {
    const shake = Math.sin(p.emoteT * 17) * 0.012 * k;
    j.neck = [j.neck[0], j.neck[1] + shake, j.neck[2] + 0.05 * k];
    j.handL = mix(j.handL, [-0.1, j.pelvis[1] + 0.22, -0.17], k);
    j.look = [0, 0.45 * k, -1];
  }
}
