// How the powered tenders go: the skiff with her outboard and the wave runner with her jet, as plain arithmetic.
// A sibling of `paddle.ts` (the kayak), sharing its water, its shore and its fending off. No DOM and no Three.js.
// Sim conventions: x east, y north, metres. Heading is compass radians, clockwise from north. Speeds in m/s.
// Signed values are positive to starboard: turn, slip, lean.
//
// The two feel different by their numbers (`data/tenders.json`), and by three rules that only one of them has:
//  - the skiff ships water when she is driven flat out on the plane into a steep sea, and can be swamped;
//  - the wave runner steers with her jet, so with the throttle shut she hardly turns; she leaves the water off
//    waves and wakes; and a hard turn held at speed throws the rider, after which she idles back round to them.
// Both climb onto the plane above a threshold (drag falls away and the bow comes down), slide a little in a turn,
// slow in a chop, come off the plane by themselves in shoal water, and burn fuel from a small tank.

import { fendOff, shoalStream, type Craft, type Hulk, type Paddling, type Water } from './paddle';
import type { TenderSpec } from './tenders';

const KT = 0.514444;
const G = 9.81;
/** Longest step taken in one go, seconds. */
const MAX_STEP = 1 / 60;
/** Drag that does not fade with speed, 1/s, so she does come to rest. */
const SKIN = 0.05;
/** She stays on the plane down to this share of the speed she climbed onto it at. */
const PLANE_HOLD = 0.8;
/** Without the plane she would top out at this multiple of the planing speed: wide open she climbs over the hump, at half throttle she does not. */
const HUMP = 1.4;
/** Wind speeds between which the sea goes from flat to steep, as far as a small boat is concerned. */
const SEA_FROM = 8 * KT;
const SEA_FULL = 24 * KT;
/** Share of the wind's speed she is set downwind. */
const WINDAGE = 0.012;
/** In water this shallow, metres, a powered tender comes off the plane: the propeller or the jet's intake is at stake. */
export const SHOAL_DEPTH = 1.5;
/** The speed she is eased to there. */
export const SHOAL_SPEED = 5 * KT;
/** How far ahead she looks for shoal water, seconds of her own way. */
const SHOAL_LOOK = 2.2;
/** With the tank dry there are oars in the skiff and hands on the wave runner: this much push, m/s². About two knots. */
const ROWING = 0.12;
/** The sea state, 0 to 1, from which a skiff flat out into it ships water. About 18 knots of wind. */
export const SWAMP_SEA = 0.6;
/** Seconds of that to fill her, seconds for the bailer to empty her again, and seconds spent bailing once she is swamped. */
const SWAMP_FILL = 7;
const SWAMP_DRAIN = 25;
export const BAIL_SECONDS = 18;
/** Seconds a turn may be held past the limit before the rider goes. */
export const SPILL_SECONDS = 0.9;
/** With the rider off, the wave runner idles at this speed back to them, and they are aboard again inside this many metres. */
const IDLE_BACK = 1.4;
const REMOUNT_RANGE = 3;
const REMOUNT_AFTER = 4;
/** Slowest a wave runner leaves the water off a sea or a wake. */
export const JUMP_SPEED = 20 * KT;
/** The throttle at the ordinary setting comes from the table's cruising speed. Flat out is 1. */
export const cruiseThrottle = (spec: TenderSpec): number => (spec.cruiseKt / spec.topKt) ** 2;

/** Water as a powered tender needs to know it: the kayak's, and two things more. */
export interface MotorWater extends Water {
  /** True where the water is too thin to go fast in. */
  shoal?(x: number, y: number): boolean;
  /** How steep a wake lies across this point, 0 none to 1 a ferry's. */
  wake?(x: number, y: number): number;
}

/** A powered tender on the water. The first fields are the kayak's, so the same landing rules read her. */
export interface Motor extends Craft {
  /** Where the engine is, -1 astern to 1 flat out. It follows the hand on it with a lag. */
  throttle: number;
  /** Sideways speed through the water, m/s, positive to starboard: the skid in a turn. */
  slip: number;
  /** 0 ploughing along, 1 up on the plane. */
  plane: number;
  /** Bank, radians, positive to starboard: into the turn. */
  lean: number;
  /** Bow up, radians: most on the hump, settling as she planes. */
  trim: number;
  /** Height clear of the water, metres, and how fast it is changing. */
  hop: number;
  vz: number;
  /** Litres left. */
  fuel: number;
  /** Water aboard, 0 dry to 1 full. */
  shipped: number;
  /** Seconds of bailing left. Above 0 she is swamped and lies stopped. */
  swamped: number;
  /** True while the rider is in the water and she is idling back to them. */
  thrown: boolean;
  /** Where the rider is, while thrown. */
  riderX: number;
  riderY: number;
  /** Seconds since the rider went, and seconds the turn has been held past the limit. */
  off: number;
  over: number;
  /** How far through the present wave she is, 0 to 1. */
  crest: number;
  inWake: boolean;
  /** True while shoal water is holding her speed down. */
  governed: boolean;
  /** Counts that only go up, for whoever is watching to notice a change: leaps landed, riders thrown, swampings, hard groundings. */
  jumps: number;
  spills: number;
  swamps: number;
  grounds: number;
}

export function newMotor(x: number, y: number, heading: number, fuel: number): Motor {
  return {
    x, y, heading, speed: 0, turn: 0, beached: false, puff: 1, blown: false,
    throttle: 0, slip: 0, plane: 0, lean: 0, trim: 0, hop: 0, vz: 0, fuel, shipped: 0, swamped: 0,
    thrown: false, riderX: x, riderY: y, off: 0, over: 0, crest: 0, inWake: false, governed: false,
    jumps: 0, spills: 0, swamps: 0, grounds: 0,
  };
}

/** How rough it is for a small boat, 0 flat to 1 steep, from the wind. */
export function seaState(windSpeed: number): number {
  return clamp01((windSpeed - SEA_FROM) / (SEA_FULL - SEA_FROM));
}

/** Litres an hour at a throttle setting: a trickle at idle, and climbing faster than the throttle does. */
export function burnRate(spec: TenderSpec, throttle: number): number {
  const t = Math.min(1, Math.abs(throttle));
  return (spec.burnLph ?? 0) * (0.04 + 0.96 * t ** 1.5);
}

/** Speed over flat water she settles at for a throttle setting, m/s, once on the plane. */
export function settledSpeed(spec: TenderSpec, throttle: number): number {
  const top = spec.topKt * KT;
  const kPlane = (spec.accel - SKIN * top) / (top * top);
  const push = spec.accel * clamp01(throttle);
  // push = (k v + SKIN) v
  return (-SKIN + Math.sqrt(SKIN * SKIN + 4 * kPlane * push)) / (2 * kPlane);
}

/** Move a powered tender on by `dt` seconds. Changes `c` in place. `input` is what the kayak's paddler gives: ahead, steer, and sprint for flat out. */
export function stepMotor(c: Motor, spec: TenderSpec, input: Paddling, dt: number, water: MotorWater, yacht?: Hulk): void {
  let left = Math.min(dt, 2);
  while (left > 1e-6) {
    const h = Math.min(left, MAX_STEP);
    left -= h;
    stepOnce(c, spec, input, h, water, yacht);
  }
}

function stepOnce(c: Motor, spec: TenderSpec, input: Paddling, h: number, water: MotorWater, yacht?: Hulk): void {
  const top = spec.topKt * KT;
  const planeAt = (spec.planeKt ?? spec.topKt) * KT;
  const jet = spec.drive === 'jet';
  let ahead = Math.sign(input.ahead);
  let steer = Math.sign(input.steer);
  const flatOut = ahead > 0 && !!input.sprint;

  const wind = water.wind(c.x, c.y);
  const off = wind.dir - c.heading;
  const sea = seaState(wind.speed);
  /** 1 heading straight into the wind and its sea, -1 running before it. */
  const into = Math.cos(off);
  const airborne = c.hop > 0;
  const fx = Math.sin(c.heading);
  const fy = Math.cos(c.heading);

  // ---- who is driving ----
  // Swamped, she lies stopped while the skipper bails. Thrown, the kill cord has shut the throttle and she idles back.
  let idleBack = false;
  if (c.swamped > 0) {
    c.swamped = Math.max(0, c.swamped - h);
    c.shipped = c.swamped > 0 ? Math.max(0.15, c.swamped / BAIL_SECONDS) : 0.15;
    ahead = 0;
    steer = 0;
  } else if (c.thrown) {
    c.off += h;
    const stream = water.current(c.riderX, c.riderY);
    c.riderX += stream.x * h;
    c.riderY += stream.y * h;
    const dx = c.riderX - c.x;
    const dy = c.riderY - c.y;
    const range = Math.hypot(dx, dy);
    if (range < REMOUNT_RANGE && c.off > REMOUNT_AFTER) {
      c.thrown = false;
      c.over = 0;
    } else {
      idleBack = true;
      const err = angle(Math.atan2(dx, dy) - c.heading);
      steer = Math.abs(err) < 0.05 ? 0 : Math.sign(err);
    }
    ahead = 0;
  }

  // ---- the throttle ----
  const dry = c.fuel <= 0;
  let wanted = ahead > 0 ? (flatOut ? 1 : cruiseThrottle(spec)) : ahead < 0 ? -1 : 0;
  if (dry || c.swamped > 0 || idleBack) wanted = 0;
  // Shoal water here or just ahead: she is eased off the plane, whatever the hand on the throttle says.
  const look = Math.max(4, Math.abs(c.speed) * SHOAL_LOOK);
  c.governed = !!water.shoal && (water.shoal(c.x, c.y) || water.shoal(c.x + fx * look, c.y + fy * look));
  if (c.governed && c.speed > SHOAL_SPEED && wanted > 0) wanted = 0;
  else if (c.governed && wanted > 0) wanted = Math.min(wanted, (SHOAL_SPEED / (planeAt * HUMP)) ** 2 * 1.4);
  const lag = spec.response ?? 0.5;
  c.throttle += clamp(wanted - c.throttle, (-h / lag) * 2, h / lag);
  if (!dry) c.fuel = Math.max(0, c.fuel - (burnRate(spec, c.throttle) / 3600) * h);

  // ---- turning ----
  // An outboard steers with its wash and a little with its leg. A jet steers with thrust alone: shut the throttle and she runs straight.
  const authority = idleBack ? 0.6 : jet ? Math.max(0.22, Math.abs(c.throttle)) : Math.min(1, 0.35 + Math.abs(c.throttle) + Math.abs(c.speed) / 3);
  // At speed the turn is as hard as the hull will hold: a little harder with the throttle wide open.
  const hold = (spec.sideG ?? 6) * (0.6 + 0.4 * clamp01(Math.abs(c.throttle)));
  const most = Math.min(spec.turnDeg * (Math.PI / 180) * authority, hold / Math.max(0.5, Math.abs(c.speed)));
  const wantTurn = airborne ? c.turn : steer * most;
  c.turn += (wantTurn - c.turn) * Math.min(1, h / (jet ? 0.2 : 0.35));
  c.heading = wrap(c.heading + c.turn * h);

  // ---- along and across ----
  // Turning the hull leaves her still going the old way for a moment: that is the slide, and the hull's grip takes it off.
  const grip = airborne ? 0 : (spec.grip ?? 5) * (jet ? 1 : 1 - 0.3 * c.plane);
  const u0 = c.speed;
  c.speed += c.turn * c.slip * h;
  c.slip += (-c.turn * u0 - grip * c.slip) * h;

  let push = 0;
  if (idleBack) push = clamp((IDLE_BACK - c.speed) * 1.2, -0.5, 0.8);
  else if (dry && c.swamped <= 0) push = ROWING * Math.sign(input.ahead);
  else if (!(jet && airborne)) push = c.throttle >= 0 ? c.throttle * spec.accel : c.throttle * spec.accel * (spec.astern ?? 0.3);

  const kPlane = (spec.accel - SKIN * top) / (top * top);
  const kHull = spec.accel / (planeAt * HUMP) ** 2;
  let k = kHull + (kPlane - kHull) * c.plane;
  // A chop costs most on the plane and most of all head on. Water aboard is dead weight. Throttle shut, she squats.
  k *= 1 + (spec.chop ?? 0) * sea * (0.55 + 0.45 * Math.max(0, into)) * (0.3 + 0.7 * c.plane);
  k *= 1 + 1.2 * c.shipped;
  if (Math.abs(c.throttle) < 0.08) k *= spec.coast ?? 1;
  if (airborne) k *= 0.15;
  const drag = (k * Math.abs(c.speed) + SKIN + 0.3 * Math.abs(c.slip)) * c.speed;
  c.speed += (push - drag) * h;
  if (ahead === 0 && !idleBack && Math.abs(c.speed) < 0.05 && Math.abs(c.throttle) < 0.02) c.speed = 0;

  // ---- the plane, her trim and her bank ----
  const onPlane = c.speed > planeAt ? 1 : c.speed < planeAt * PLANE_HOLD ? 0 : c.plane > 0.5 ? 1 : 0;
  c.plane += clamp(onPlane - c.plane, -h / 0.9, h / 1.4);
  // Bow high as she climbs the hump, coming down as she gets over it.
  const trim = (jet ? 0.12 : 0.2) * clamp01(c.speed / planeAt) * (1 - 0.6 * c.plane) + (airborne ? 0.18 : 0);
  c.trim += (trim - c.trim) * Math.min(1, h * 4);
  const bank = clamp(Math.atan2(c.turn * c.speed, G) * (spec.lean ?? 0.4), -0.75, 0.75);
  c.lean += (bank - c.lean) * Math.min(1, h * 6);

  // ---- the skiff: green water over the bow ----
  if (spec.swamps && c.swamped <= 0) {
    // Wide open and punching into it, on the plane or still trying to get there.
    const shipping = c.speed > planeAt * 0.5 && c.throttle > 0.9 && sea >= SWAMP_SEA && into > 0.6;
    c.shipped = clamp01(c.shipped + (shipping ? h / SWAMP_FILL : -h / SWAMP_DRAIN));
    if (c.shipped >= 1) {
      c.swamped = BAIL_SECONDS;
      c.swamps++;
      c.throttle = 0;
    }
  }

  // ---- the wave runner: leaving the water ----
  if (spec.jumps && !c.thrown) {
    if (airborne) {
      c.hop += c.vz * h;
      c.vz -= G * h;
      if (c.hop <= 0) {
        c.hop = 0;
        c.vz = 0;
        c.speed *= 0.94;
        c.jumps++;
      }
    } else {
      // Each crest she meets fast enough throws her clear: the steeper the sea and the faster she goes, the higher.
      const length = 9 + 14 * sea;
      c.crest += (h * Math.abs(c.speed) * (0.35 + 0.65 * Math.abs(into))) / length;
      let up = 0;
      if (c.crest >= 1) {
        c.crest -= Math.floor(c.crest);
        if (c.speed > JUMP_SPEED && sea > 0.12) up = Math.min(3.4, c.speed * 0.12 * (0.3 + sea));
      }
      const wake = water.wake ? water.wake(c.x, c.y) : 0;
      if (wake > 0.3 && !c.inWake && c.speed > JUMP_SPEED * 0.8) up = Math.max(up, Math.min(3.6, 0.6 + c.speed * 0.14 * wake));
      c.inWake = wake > 0.3;
      if (up > 0) {
        c.vz = up;
        c.hop = 1e-4;
      }
    }
  }

  // ---- the wave runner: the kill cord ----
  if (spec.spillG && !c.thrown) {
    const across = Math.abs(c.turn * c.speed);
    if (across > spec.spillG && c.speed > (spec.spillKt ?? 0) * KT && !airborne) c.over += h;
    else c.over = Math.max(0, c.over - 2 * h);
    if (c.over > SPILL_SECONDS) {
      c.thrown = true;
      c.spills++;
      c.off = 0;
      c.over = 0;
      c.riderX = c.x;
      c.riderY = c.y;
      c.throttle = 0;
    }
  }

  // ---- over the ground ----
  const stream = water.current(c.x, c.y);
  const slack = water.depth ? shoalStream(water.depth(c.x, c.y)) : 1;
  // To starboard of her is (fy, -fx).
  const hx = Math.sin(c.heading);
  const hy = Math.cos(c.heading);
  const vx = hx * c.speed + hy * c.slip + stream.x * slack - Math.sin(wind.dir) * wind.speed * WINDAGE;
  const vy = hy * c.speed - hx * c.slip + stream.y * slack - Math.cos(wind.dir) * wind.speed * WINDAGE;
  const nx = c.x + vx * h;
  const ny = c.y + vy * h;
  if (!water.land(nx, ny) || water.land(c.x, c.y)) {
    c.x = nx;
    c.y = ny;
    // Still hard up against it, if the shore is right under her bow.
    const nose = Math.sign(c.speed) * 0.8;
    c.beached = c.beached && nose !== 0 && water.land(c.x + hx * nose, c.y + hy * nose);
  } else {
    // The shore stops her. Fast, it stops her hard.
    if (!c.beached && Math.abs(c.speed) > 3) c.grounds++;
    const way = Math.sign(c.speed) * 0.6;
    if (way !== 0 && water.land(c.x + hx * way, c.y + hy * way)) c.speed *= Math.max(0, 1 - 9 * h);
    c.slip *= Math.max(0, 1 - 9 * h);
    if (!water.land(nx, c.y)) c.x = nx;
    else if (!water.land(c.x, ny)) c.y = ny;
    c.beached = true;
  }

  if (yacht) fendOff(c, yacht);
}

/** Minutes of running left at this throttle setting. */
export function minutesLeft(spec: TenderSpec, fuel: number, throttle: number): number {
  const rate = burnRate(spec, throttle);
  return rate > 0 ? (fuel / rate) * 60 : Infinity;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const angle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
function wrap(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
