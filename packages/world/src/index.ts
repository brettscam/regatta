import type { Environment, EnvSample } from '@slack-tide/sim';

const D2R = Math.PI / 180;
const KT = 0.514444;

export interface SteadyWindOptions {
  /** Direction the wind blows from, degrees true. */
  fromDeg: number;
  speedKt: number;
  /** Optional steady current: direction it flows toward, degrees true. */
  currentTowardDeg?: number;
  currentKt?: number;
}

/**
 * The milestone 1 world: one steady wind everywhere, and an optional steady current.
 * Baked tiles of real wind, current, tide and depth replace this from milestone 3.
 */
export function steadyWorld(opts: SteadyWindOptions): Environment {
  const set = (opts.currentTowardDeg ?? 0) * D2R;
  const drift = (opts.currentKt ?? 0) * KT;
  const sample: EnvSample = {
    windDir: opts.fromDeg * D2R,
    windSpeed: opts.speedKt * KT,
    currentX: drift * Math.sin(set),
    currentY: drift * Math.cos(set),
  };
  return { sample: () => sample };
}
