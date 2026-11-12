import { Sim, D2R, R2D, KT, type BoatSpec } from '../src';
import boatJson from '../../../boats/sloop38.json';

export const boat = boatJson as unknown as BoatSpec;

/** A steady wind from due north, so heading and wind angle are easy to read. */
export function northWind(speedKt: number) {
  const sample = { windDir: 0, windSpeed: speedKt * KT, currentX: 0, currentY: 0 };
  return { sample: () => sample };
}

export interface Settled {
  kt: number;
  heelDeg: number;
  sim: Sim;
}

/** Sail at a fixed true wind angle with the crew trimming until the boat settles. */
export function settle(twsKt: number, twaDeg: number, opts: { reef?: number; furl?: number; seconds?: number } = {}): Settled {
  const sim = new Sim(boat, northWind(twsKt), { headingDeg: -twaDeg, speedKt: 5, reef: opts.reef ?? 0, furl: opts.furl ?? 1 });
  sim.state.crewTrim = true;
  sim.trimForWind();
  sim.setHelm('wind', twaDeg * D2R);
  sim.advance(opts.seconds ?? 240);
  return { kt: sim.state.speed / KT, heelDeg: Math.abs(sim.state.heel) * R2D, sim };
}

/** Smallest angle between two compass directions, in degrees. */
export function angleBetweenDeg(a: number, b: number): number {
  const d = Math.abs(a - b) * R2D % 360;
  return Math.min(d, 360 - d);
}

/** Wind speed at which sail plan B first beats sail plan A upwind, scanning in half-knot steps. */
export function crossoverKt(reefA: number, reefB: number, twaDeg = 42): number {
  for (let tws = 10; tws <= 32; tws += 0.5) {
    if (settle(tws, twaDeg, { reef: reefB }).kt > settle(tws, twaDeg, { reef: reefA }).kt) return tws;
  }
  return Infinity;
}
