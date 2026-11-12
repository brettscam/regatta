import { interp1, lerp, clamp } from './math';

export interface PolarTable {
  /** True wind angles in degrees, ascending from 0 to 180. */
  twa: number[];
  /** True wind speeds in knots, ascending from 0. */
  tws: number[];
  /** Boat speed in knots, indexed [tws][twa]. */
  speeds: number[][];
}

/** Boat speed in knots for a true wind angle (degrees, either sign) and true wind speed (knots). */
export function polarSpeed(p: PolarTable, twaDeg: number, twsKt: number): number {
  const a = Math.min(180, Math.abs(twaDeg));
  const w = clamp(twsKt, p.tws[0], p.tws[p.tws.length - 1]);
  let j = 1;
  while (j < p.tws.length - 1 && w > p.tws[j]) j++;
  const lo = interp1(p.twa, p.speeds[j - 1], a);
  const hi = interp1(p.twa, p.speeds[j], a);
  return lerp(lo, hi, (w - p.tws[j - 1]) / (p.tws[j] - p.tws[j - 1]));
}

/** The upwind (or downwind) true wind angle in degrees with the best velocity made good. */
export function bestVmgAngle(p: PolarTable, twsKt: number, upwind = true): { twaDeg: number; vmgKt: number } {
  let best = { twaDeg: upwind ? 45 : 150, vmgKt: -1 };
  const from = upwind ? 25 : 90;
  const to = upwind ? 90 : 180;
  for (let a = from; a <= to; a += 0.5) {
    const vmg = polarSpeed(p, a, twsKt) * Math.abs(Math.cos((a * Math.PI) / 180));
    if (vmg > best.vmgKt) best = { twaDeg: a, vmgKt: vmg };
  }
  return best;
}
