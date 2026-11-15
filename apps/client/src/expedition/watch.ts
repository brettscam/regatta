import { D2R, KT, R2D, Sim, clamp, interp1, lerp, polarSpeed, wrapPi, wrapTau, type BoatSpec, type Environment } from '@slack-tide/sim';

// Standing a watch: time runs fast, the helmsman holds the course he was given, and where the boat gets to is
// worked out in coarse steps from how she sails in the wind of the hour, her leeway and the set of the stream.
// Pure arithmetic and the sim: no drawing, no clocks. `session.ts` runs it and tests pin it.

/** A four-hour watch passes in about this many seconds of play. */
export const WATCH_SECONDS = 17;
/** Game seconds for each real second while a watch is running. */
export const WATCH_RATE = (4 * 3600) / WATCH_SECONDS;
/** Game seconds in one step of the reckoning. */
export const WATCH_STEP = 60;
/** The closest she will lie to the wind, degrees. Asked to steer closer, the helmsman sails her full and by. */
export const FULL_AND_BY = 62;
/** Mean wind, knots, at which she can carry no sail and lies to the sea anchor, and at which she makes sail again. */
export const HEAVE_TO_KT = 48;
export const MAKE_SAIL_KT = 40;
/** What she makes to leeward lying to the sea anchor, m/s: about a knot. */
export const HOVE_TO_DRIFT = 1.0 * KT;

/** How much sail she carries: which reef in the main, and whether the jib is set. */
export interface SailPlan {
  reef: number;
  furl: number;
  name: string;
}

export const SAIL_PLANS: SailPlan[] = [
  { reef: 0, furl: 1, name: 'Full sail' },
  { reef: 1, furl: 1, name: 'Reefed down' },
  { reef: 2, furl: 0, name: 'Storm canvas' },
];
// Mean wind, knots, at which the crew shortens down to each plan, and at which they shake it out again.
const SHORTEN = [18, 28];
const SHAKE_OUT = [15, 24];

/** The sail the crew would have her under in this wind, given what she carries now. Reefing early, shaking out late. */
export function sailPlanFor(twsKt: number, now = 0): number {
  let plan = clamp(Math.round(now), 0, SAIL_PLANS.length - 1);
  while (plan < SHORTEN.length && twsKt >= SHORTEN[plan]) plan++;
  while (plan > 0 && twsKt < SHAKE_OUT[plan - 1]) plan--;
  return plan;
}

/** How she sails, measured from the sim: speed through the water and leeway for each wind angle and wind speed, under the sail her crew would carry. */
export interface Performance {
  /** True wind angles, degrees, ascending from the closest she will lie. */
  twa: number[];
  /** True wind speeds, knots. */
  tws: number[];
  /** Speed through the water, m/s, indexed [tws][twa]. */
  speed: number[][];
  /** Leeway angle, radians, indexed the same way. */
  leeway: number[][];
}

const PERF_TWA = [FULL_AND_BY, 70, 80, 90, 105, 120, 135, 150, 165, 180];
const PERF_TWS = [3, 6, 10, 14, 17.9, 18, 23, 27.9, 28, 34, 40, 47.9];

/**
 * Sail her in a steady wind at each angle until she settles, and write down what she does. This is the real sim
 * with the crew trimming and a hand on the tiller holding the heading, so the watch reckoning that reads this table
 * agrees with sailing her in real time. About half a second of work, once, when the voyage is made.
 */
export function measurePerformance(spec: BoatSpec): Performance {
  const speed: number[][] = [];
  const leeway: number[][] = [];
  for (const tws of PERF_TWS) {
    const env: Environment = { sample: () => ({ windDir: 0, windSpeed: tws * KT, currentX: 0, currentY: 0 }) };
    // Each side of a change of sail is measured under the sail she carries on that side of it.
    const plan = SAIL_PLANS[sailPlanFor(tws, tws === 17.9 || tws === 27.9 ? 0 : SAIL_PLANS.length - 1)];
    const speeds: number[] = [];
    const leeways: number[] = [];
    for (const twa of PERF_TWA) {
      const sim = new Sim(spec, env, { headingDeg: -twa, speedKt: polarSpeed(spec.polar, twa, tws) * 0.8, reef: plan.reef, furl: plan.furl });
      sim.setCrewTrim(true);
      sim.trimForWind();
      sim.setHelm('heading', wrapTau(-twa * D2R));
      sim.advance(36);
      let v = 0;
      let lee = 0;
      const n = 360;
      for (let i = 0; i < n; i++) {
        sim.step();
        v += sim.state.speed;
        lee += Math.atan2(Math.abs(sim.state.lateral), Math.max(0.05, sim.state.speed));
      }
      speeds.push(v / n);
      leeways.push(lee / n);
    }
    speed.push(speeds);
    leeway.push(leeways);
  }
  return { twa: PERF_TWA, tws: PERF_TWS, speed, leeway };
}

/** Speed through the water (m/s) and leeway (radians) at a wind angle and wind speed, read from the table. */
export function performanceAt(p: Performance, twaDeg: number, twsKt: number): { speed: number; leeway: number } {
  const a = clamp(Math.abs(twaDeg), p.twa[0], 180);
  const w = clamp(twsKt, p.tws[0], p.tws[p.tws.length - 1]);
  let j = 1;
  while (j < p.tws.length - 1 && w > p.tws[j]) j++;
  const f = (w - p.tws[j - 1]) / (p.tws[j] - p.tws[j - 1]);
  // Below the lightest wind measured she slows with it.
  const faint = twsKt < p.tws[0] ? Math.max(0, twsKt / p.tws[0]) : 1;
  return {
    speed: lerp(interp1(p.twa, p.speed[j - 1], a), interp1(p.twa, p.speed[j], a), f) * faint,
    leeway: lerp(interp1(p.twa, p.leeway[j - 1], a), interp1(p.twa, p.leeway[j], a), f),
  };
}

/** The weather the reckoning reads: the mean wind of the hour, the stream, and the depth of water. `ReplayWorld` is one. */
export interface WatchWorld {
  wind(x: number, y: number, t: number): { dir: number; speed: number };
  current(x: number, y: number, t: number): { x: number; y: number };
  depth(x: number, y: number, t: number): number;
}

/** Where she is and how she is being sailed, as the reckoning carries it. */
export interface WatchBoat {
  x: number;
  y: number;
  /** Seconds since she cast off. */
  t: number;
  /** Which of `SAIL_PLANS` she is under. */
  plan: number;
  hoveTo: boolean;
}

export interface WatchStepResult extends WatchBoat {
  /** The heading the helmsman actually held, radians. The course ordered when she can lie it, else full and by. */
  heading: number;
  /** Speed through the water, m/s. */
  speed: number;
  /** Leeway, radians, signed: positive carries her to starboard. */
  leeway: number;
  twsKt: number;
  /** Wind direction (from), radians. */
  twd: number;
  /** True when the course ordered is closer to the wind than she will lie. */
  headed: boolean;
  aground: boolean;
}

/**
 * Carry the boat forward by one step of a watch.
 * @param course the compass course ordered, radians
 * @param seconds length of the step
 */
export function watchStep(perf: Performance, world: WatchWorld, boat: WatchBoat, course: number, seconds: number, draft = 0.7): WatchStepResult {
  const wind = world.wind(boat.x, boat.y, boat.t);
  const cur = world.current(boat.x, boat.y, boat.t);
  const twsKt = wind.speed / KT;
  const hoveTo = boat.hoveTo ? twsKt > MAKE_SAIL_KT : twsKt >= HEAVE_TO_KT;
  const plan = sailPlanFor(twsKt, boat.plan);
  let heading: number;
  let speed = 0;
  let leeway = 0;
  let vx: number;
  let vy: number;
  let headed = false;
  if (hoveTo) {
    // Head to wind on the sea anchor, going astern and to leeward at about a knot.
    heading = wind.dir;
    vx = -Math.sin(wind.dir) * HOVE_TO_DRIFT;
    vy = -Math.cos(wind.dir) * HOVE_TO_DRIFT;
  } else {
    const twa = wrapPi(wind.dir - course);
    const side = twa >= 0 ? 1 : -1;
    headed = Math.abs(twa) < FULL_AND_BY * D2R;
    heading = headed ? wrapTau(wind.dir - side * FULL_AND_BY * D2R) : wrapTau(course);
    const made = performanceAt(perf, Math.abs(wrapPi(wind.dir - heading)) * R2D, twsKt);
    speed = made.speed;
    // She sags away from the wind: with the wind to starboard, to port.
    leeway = -side * made.leeway;
    const lateral = speed * Math.tan(leeway);
    vx = speed * Math.sin(heading) + lateral * Math.cos(heading);
    vy = speed * Math.cos(heading) - lateral * Math.sin(heading);
  }
  let x = boat.x + (vx + cur.x) * seconds;
  let y = boat.y + (vy + cur.y) * seconds;
  // She does not sail up the beach in a watch: the helmsman stops her where the water runs out.
  const aground = world.depth(x, y, boat.t) < draft + 0.3;
  if (aground) {
    x = boat.x;
    y = boat.y;
  }
  return { x, y, t: boat.t + seconds, plan, hoveTo, heading, speed, leeway, twsKt, twd: wind.dir, headed, aground };
}

/**
 * The speed the helmsman calls for the reckoning. There was no log: it was judged by eye from the water going past,
 * to the half knot, and every man judges a little differently from one watch to the next.
 * @param seed the voyage's seed, so a passage is the same every time it is replayed
 */
export function judgedSpeed(speed: number, t: number, seed: number): number {
  const watch = Math.floor(t / (4 * 3600));
  let h = (Math.imul(watch + 1, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const bias = 0.92 + 0.18 * (((h ^ (h >>> 16)) >>> 0) / 4294967295);
  return (Math.round((speed / KT) * bias * 2) / 2) * KT;
}
