import type { Environment, EnvSample } from '@slack-tide/sim';

export * from './replay';

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

/** One steady wind everywhere and an optional steady current, with no land. For tests and tuning. */
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
