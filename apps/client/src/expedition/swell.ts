import { WAVE_COUNT, type SeaModel, type Wave } from '../scene/waves';

// The sea of the open Southern Ocean: a long swell that never dies away, with a wind sea on top of it that builds
// with the gale. The same eight waves the water shader draws for the Bay, made ten times the size.

// Wavelength (m), amplitude (m) in a 40 knot gale, bearing off dead downwind (deg), phase.
// The first four carry the swell. In a 40 knot gale they add up to a significant height of about eight metres.
const OCEAN: Array<[number, number, number, number]> = [
  [230, 2.3, -6, 0.0],
  [150, 1.35, 14, 1.7],
  [92, 0.8, -24, 4.1],
  [54, 0.45, 31, 2.6],
  [29, 0.24, -38, 5.3],
  [15, 0.12, 44, 0.9],
  [6.5, 0.05, -16, 3.3],
  [2.4, 0.018, 34, 1.2],
];
/** Waves that count as swell: they answer the wind slowly and never go flat. */
const SWELL = 4;
const G = 9.81;
const STEEPNESS = 0.78;
const D2R = Math.PI / 180;

/** How high the swell runs for a mean wind: a quarter of its gale height in a calm, and no more than a third over it. */
export function swellScale(twsKt: number): number {
  return Math.min(1.3, 0.25 + 0.75 * Math.pow(Math.max(0, twsKt) / 40, 1.3));
}

/** The wind sea on top of it comes and goes with the wind. */
export function chopScale(twsKt: number): number {
  return Math.min(1.6, Math.max(0.08, Math.pow(Math.max(0, twsKt) / 34, 1.4)));
}

/**
 * Significant wave height in metres for a mean wind: four times the root-mean-square height of the surface.
 * This is what a seaman means by the height of the sea.
 */
export function significantHeight(twsKt: number): number {
  let sum = 0;
  OCEAN.forEach(([, amp], i) => {
    const a = amp * (i < SWELL ? swellScale(twsKt) : chopScale(twsKt));
    sum += (a * a) / 2;
  });
  return 4 * Math.sqrt(sum);
}

function shape(w: Wave, i: number, twsKt: number): void {
  w.amp = w.base * (i < SWELL ? swellScale(twsKt) : chopScale(twsKt));
  w.q = STEEPNESS / (w.k * w.amp * WAVE_COUNT);
}

function aim(w: Wave, i: number, toward: number): void {
  const bearing = toward + OCEAN[i][2] * D2R;
  w.dx = Math.sin(bearing);
  w.dz = -Math.cos(bearing);
}

/** Make the sea model for one voyage. It remembers which way the swell is running, so each voyage needs its own. */
export function oceanSea(): SeaModel {
  let toward = 0;
  return {
    build(windFrom, twsKt) {
      toward = windFrom + Math.PI;
      return OCEAN.map(([length, amp, , phase], i) => {
        const k = (2 * Math.PI) / length;
        const w: Wave = { dx: 0, dz: -1, k, amp, omega: Math.sqrt(G * k), q: 0, phase, length, base: amp };
        aim(w, i, toward);
        shape(w, i, twsKt);
        return w;
      });
    },
    follow(waves, twsKt, windFrom, x, z, seconds) {
      // The swell comes round to a new wind over some hours. It turns about the viewer, so the water under the boat
      // keeps its shape while the pattern swings.
      let turn = windFrom + Math.PI - toward;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-Math.max(0, seconds) / 9000));
      const turning = Math.abs(turn) > 1e-6;
      if (turning) toward += turn;
      waves.forEach((w, i) => {
        if (turning) {
          const before = w.dx * x + w.dz * z;
          aim(w, i, toward);
          w.phase = (w.phase + w.k * (before - (w.dx * x + w.dz * z))) % (Math.PI * 2);
        }
        shape(w, i, twsKt);
      });
    },
  };
}
