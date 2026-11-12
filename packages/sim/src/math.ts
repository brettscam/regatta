export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const TAU = Math.PI * 2;
/** Metres per second in one knot. */
export const KT = 0.514444;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wrap an angle in radians to (-PI, PI]. */
export function wrapPi(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Wrap an angle in radians to [0, 2PI). */
export function wrapTau(a: number): number {
  a = a % TAU;
  return a < 0 ? a + TAU : a;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Piecewise-linear lookup. xs must be ascending. Clamps at both ends. */
export function interp1(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    }
  }
  return ys[ys.length - 1];
}

/** Move `v` toward `target` by at most `maxStep`. */
export function approach(v: number, target: number, maxStep: number): number {
  const d = target - v;
  return Math.abs(d) <= maxStep ? target : v + Math.sign(d) * maxStep;
}
