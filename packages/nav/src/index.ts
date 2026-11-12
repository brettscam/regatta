import { KT, R2D, bestVmgAngle, polarSpeed, wrapPi, wrapTau, type PolarTable } from '@slack-tide/sim';

const NM = 1852;

export interface Point {
  x: number;
  y: number;
}

export interface Waypoint extends Point {
  name: string;
}

/** What the planner is told about the weather. Times are seconds on the same clock as the sim. */
export interface PlanWeather {
  /** Wind blowing from `dir` (radians clockwise from north) at `speed` m/s. */
  wind(x: number, y: number, t: number): { dir: number; speed: number };
  /** Current in m/s east (x) and north (y). */
  current(x: number, y: number, t: number): { x: number; y: number };
}

export type PointOfSail = 'beat' | 'reach' | 'run';

export interface LegPlan {
  from: Point;
  to: Waypoint;
  /** Metres over the ground. */
  distance: number;
  /** Course to steer over the ground, radians clockwise from north. */
  bearing: number;
  /** Seconds to sail the leg. */
  seconds: number;
  /** Planned time of arrival at `to`. */
  eta: number;
  /** Averages over the leg, weighted by time. */
  twsKt: number;
  /** Wind direction (from), radians. */
  twd: number;
  /** Wind angle off the course line, degrees, 0 to 180. */
  twaDeg: number;
  /** Speed made good along the leg through the water, knots. */
  boatKt: number;
  /** Current along the leg in knots. Negative is foul. */
  streamKt: number;
  sogKt: number;
  sail: PointOfSail;
}

export interface RoutePlan {
  startTime: number;
  start: Point;
  legs: LegPlan[];
  distance: number;
  seconds: number;
  /** Planned position against time, for showing where the plan says the boat should be. */
  trace: Array<{ t: number; x: number; y: number }>;
}

export interface PlanOptions {
  /** Share of polar speed a real crew holds. */
  efficiency?: number;
  /** Share of polar speed held deep downwind under jib and main with no spinnaker. */
  noSpinnaker?: number;
  /** Metres between samples of the weather along a leg. */
  step?: number;
}

/**
 * Best speed made good along a course at an angle to the wind.
 * Closer to the wind than the best beating angle, the boat tacks, and its progress is the upwind VMG spread along the course.
 * Deeper than the best running angle, it gybes downwind the same way.
 */
export function speedMadeGood(polar: PolarTable, twaDeg: number, twsKt: number, opts: PlanOptions = {}): { kt: number; sail: PointOfSail } {
  const eff = opts.efficiency ?? 0.93;
  const deep = opts.noSpinnaker ?? 0.85;
  const a = Math.min(180, Math.abs(twaDeg));
  const up = bestVmgAngle(polar, twsKt, true);
  const down = bestVmgAngle(polar, twsKt, false);
  if (a < up.twaDeg) return { kt: (eff * up.vmgKt) / Math.max(0.5, Math.cos(a / R2D)), sail: 'beat' };
  if (a > down.twaDeg) return { kt: (eff * deep * down.vmgKt) / Math.max(0.5, -Math.cos(a / R2D)), sail: 'run' };
  // The jib is blanketed as the wind draws aft. Fade from full speed at 110 degrees to the downwind figure.
  const fade = a <= 110 ? 1 : 1 - (1 - deep) * Math.min(1, (a - 110) / 40);
  return { kt: eff * fade * polarSpeed(polar, a, twsKt), sail: a < 60 ? 'beat' : a > 130 ? 'run' : 'reach' };
}

/** Plan a route from a starting point and time through the waypoints, using the polar and the forecast. */
export function planRoute(polar: PolarTable, start: Point, waypoints: Waypoint[], startTime: number, weather: PlanWeather, opts: PlanOptions = {}): RoutePlan {
  const step = opts.step ?? 100;
  const legs: LegPlan[] = [];
  const trace: RoutePlan['trace'] = [{ t: startTime, x: start.x, y: start.y }];
  let t = startTime;
  let from: Point = start;
  let total = 0;
  for (const to of waypoints) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const bearing = wrapTau(Math.atan2(dx, dy));
    const ux = distance > 0 ? dx / distance : 0;
    const uy = distance > 0 ? dy / distance : 1;
    const n = Math.max(1, Math.ceil(distance / step));
    const ds = distance / n;
    let seconds = 0;
    let sumTws = 0;
    let sumTwa = 0;
    let sumBoat = 0;
    let sumStream = 0;
    let windE = 0;
    let windN = 0;
    const tally: Record<PointOfSail, number> = { beat: 0, reach: 0, run: 0 };
    for (let i = 0; i < n; i++) {
      const px = from.x + ux * ds * (i + 0.5);
      const py = from.y + uy * ds * (i + 0.5);
      const w = weather.wind(px, py, t + seconds);
      const c = weather.current(px, py, t + seconds);
      const twa = Math.abs(wrapPi(w.dir - bearing)) * R2D;
      const made = speedMadeGood(polar, twa, w.speed / KT, opts);
      const boat = made.kt * KT;
      const along = c.x * ux + c.y * uy;
      const across = c.x * -uy + c.y * ux;
      // Holding the track against a cross current costs some of the boat's speed.
      const forward = Math.sqrt(Math.max(0, boat * boat - across * across));
      const sog = Math.max(0.15, forward + along);
      const dt = ds / sog;
      seconds += dt;
      sumTws += (w.speed / KT) * dt;
      sumTwa += twa * dt;
      sumBoat += made.kt * dt;
      sumStream += (along / KT) * dt;
      windE += Math.sin(w.dir) * dt;
      windN += Math.cos(w.dir) * dt;
      tally[made.sail] += dt;
      trace.push({ t: t + seconds, x: from.x + ux * ds * (i + 1), y: from.y + uy * ds * (i + 1) });
    }
    t += seconds;
    total += distance;
    const sail = (Object.keys(tally) as PointOfSail[]).reduce((a, b) => (tally[b] > tally[a] ? b : a));
    legs.push({
      from, to, distance, bearing, seconds, eta: t,
      twsKt: sumTws / seconds, twd: wrapTau(Math.atan2(windE, windN)), twaDeg: sumTwa / seconds,
      boatKt: sumBoat / seconds, streamKt: sumStream / seconds, sogKt: distance / seconds / KT, sail,
    });
    from = to;
  }
  return { startTime, start, legs, distance: total, seconds: t - startTime, trace };
}

/** Where the plan says the boat should be at a time. Clamps to the ends of the plan. */
export function plannedPosition(plan: RoutePlan, t: number): Point {
  const tr = plan.trace;
  if (t <= tr[0].t) return { x: tr[0].x, y: tr[0].y };
  if (t >= tr[tr.length - 1].t) return { x: tr[tr.length - 1].x, y: tr[tr.length - 1].y };
  let lo = 0;
  let hi = tr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - tr[lo].t) / (tr[hi].t - tr[lo].t || 1);
  return { x: tr[lo].x + (tr[hi].x - tr[lo].x) * f, y: tr[lo].y + (tr[hi].y - tr[lo].y) * f };
}

export interface TrackFix {
  /** Metres off the leg. Positive is to starboard of the track, looking along it. */
  crossTrack: number;
  /** Metres made along the leg from its start. */
  along: number;
  /** Metres still to go to the end of the leg, straight line. */
  toGo: number;
  /** Bearing from the boat to the end of the leg, radians. */
  bearing: number;
}

/** Where a position sits relative to a leg from a to b. */
export function trackFix(p: Point, a: Point, b: Point): TrackFix {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  const ux = dx / len;
  const uy = dy / len;
  const rx = p.x - a.x;
  const ry = p.y - a.y;
  return {
    along: rx * ux + ry * uy,
    // Starboard of a track heading (ux, uy) is the direction (uy, -ux).
    crossTrack: rx * uy - ry * ux,
    toGo: Math.hypot(b.x - p.x, b.y - p.y),
    bearing: wrapTau(Math.atan2(b.x - p.x, b.y - p.y)),
  };
}

export const metresToNm = (m: number): number => m / NM;
