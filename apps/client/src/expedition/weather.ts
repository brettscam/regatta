import { hash2, noise2 } from './land';
import type { Voyage } from './voyage';

// The weather of a voyage, made from its day-by-day script. There is no recording to replay for 1916, so the script
// gives the shape of the fortnight and a seed moves it about: the same seed always makes the same weather, and no
// two seeds make quite the same passage. Pure arithmetic, so a test can pin it.

const D2R = Math.PI / 180;
const KT = 0.514444;

export interface Sky {
  /** Wind blowing toward east and north, m/s. */
  u: number;
  v: number;
  /** Gust speed, m/s. */
  gust: number;
  /** Share of the sky covered, 0 to 1. */
  cloud: number;
  /** Air temperature, Celsius. */
  air: number;
}

interface Knot {
  /** Hours since midnight on the day of departure. */
  t: number;
  u: number;
  v: number;
  cloud: number;
  air: number;
}

/** Smooth noise along one axis, -1 to 1. */
function wander(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const s = f * f * (3 - 2 * f);
  return (hash2(i, 0, seed) * (1 - s) + hash2(i + 1, 0, seed) * s) * 2 - 1;
}

export interface Weather {
  /**
   * The weather at a place and time.
   * @param x flat metres east of the chart's centre
   * @param hours since midnight, ship's time, on the day of departure
   */
  at(x: number, y: number, hours: number): Sky;
  /** The script alone at a time, with no seed and no place: what the record says, as numbers. */
  scripted(hours: number): Sky;
}

/**
 * @param track where she was by the record at the start and end of the passage, in flat metres. Weather systems cross
 *   the ocean from the west at about twenty knots, so a boat east of where the record had her meets each change
 *   later, and one to the west meets it sooner.
 */
export function makeWeather(voyage: Voyage, seed: number, track: { x0: number; x1: number }): Weather {
  const knots: Knot[] = [];
  for (const day of voyage.script) {
    for (const w of day.weather) {
      const s = w.kt * KT;
      knots.push({ t: day.day * 24 + w.hour, u: -s * Math.sin(w.from * D2R), v: -s * Math.cos(w.from * D2R), cloud: w.cloud, air: w.air });
    }
  }
  knots.sort((a, b) => a.t - b.t);

  const blend = (hours: number): Knot => {
    if (hours <= knots[0].t) return knots[0];
    const last = knots[knots.length - 1];
    if (hours >= last.t) return last;
    let lo = 0;
    let hi = knots.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (knots[mid].t <= hours) lo = mid;
      else hi = mid;
    }
    const a = knots[lo];
    const b = knots[hi];
    const f = (hours - a.t) / (b.t - a.t);
    const k = f * f * (3 - 2 * f);
    return { t: hours, u: a.u + (b.u - a.u) * k, v: a.v + (b.v - a.v) * k, cloud: a.cloud + (b.cloud - a.cloud) * k, air: a.air + (b.air - a.air) * k };
  };

  const finish = (u: number, v: number, cloud: number, air: number): Sky => {
    const speed = Math.hypot(u, v);
    // Gusts are harder in a gale, and hardest in the cold air behind a front.
    const factor = 1.28 + 0.14 * Math.min(1, speed / (45 * KT)) + (air < -5 ? 0.06 : 0);
    return { u, v, gust: speed * factor, cloud: Math.max(0, Math.min(1, cloud)), air };
  };

  // Where the record had her, hour by hour: a straight run from the start to the landfall over sixteen days.
  const passage = 16 * 24;
  const systemSpeed = 40000; // metres an hour: about twenty knots

  return {
    scripted: (hours) => {
      const k = blend(hours);
      return finish(k.u, k.v, k.cloud, k.air);
    },
    at: (x, y, hours) => {
      const along = Math.max(0, Math.min(1, hours / passage));
      const recorded = track.x0 + (track.x1 - track.x0) * along;
      // The seed pulls each change a few hours early or late.
      const when = hours - (x - recorded) / systemSpeed + 2.5 * wander(hours / 31, seed);
      const k = blend(when);
      // And makes each blow a little harder or softer, and a point or so either side of the record.
      const strength = 1 + 0.12 * wander(hours / 43 + 9.1, seed + 1) + 0.07 * (noise2(x / 260000 + hours / 19, y / 260000, seed + 2) * 2 - 1);
      const turn = (11 * wander(hours / 29 + 3.3, seed + 3) + 6 * (noise2(x / 310000, y / 310000 + hours / 23, seed + 4) * 2 - 1)) * D2R;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const u = (k.u * c + k.v * s) * strength;
      const v = (-k.u * s + k.v * c) * strength;
      const cloud = k.cloud + 0.18 * (noise2(x / 150000 + hours / 6, y / 150000, seed + 5) * 2 - 1);
      return finish(u, v, cloud, k.air + 1.2 * wander(hours / 17, seed + 6));
    },
  };
}
