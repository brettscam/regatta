// One description of the sea surface, shared by the water shader and by the boat's motion,
// so the hull rides the same waves the player sees.

export interface Wave {
  /** Unit direction of travel in world X (east) and Z (south). */
  dx: number;
  dz: number;
  /** Wavenumber, radians per metre. */
  k: number;
  amp: number;
  /** Angular speed, radians per second. */
  omega: number;
  /** Gerstner steepness: how far crests pinch together. */
  q: number;
  phase: number;
  length: number;
  /** Amplitude in the reference 14 kt breeze, before scaling for the wind. */
  base: number;
}

export const WAVE_COUNT = 8;
/** Waves long enough to move the water surface mesh. Shorter ones only change the shading. */
export const WAVE_GEOM_COUNT = 6;

// Wavelength (m), amplitude (m), bearing off dead downwind (deg), phase. Tuned for a 14 kt afternoon breeze.
const BASE: Array<[number, number, number, number]> = [
  [34, 0.15, -8, 0.0],
  [21, 0.12, 13, 1.7],
  [13, 0.085, -23, 4.1],
  [8.5, 0.055, 29, 2.6],
  [5.2, 0.036, -39, 5.3],
  [3.4, 0.023, 46, 0.9],
  [2.1, 0.014, -16, 3.3],
  [1.3, 0.009, 34, 1.2],
];

const G = 9.81;

/** Build the wave set for a wind blowing FROM `windFrom` (radians clockwise from north). */
export function buildWaves(windFrom: number, twsKt: number): Wave[] {
  const heightScale = Math.min(2.6, Math.max(0.12, Math.pow(twsKt / 14, 1.35)));
  const lengthScale = Math.min(1.7, Math.max(0.55, Math.pow(twsKt / 14, 0.6)));
  const steepness = 0.78;
  const toward = windFrom + Math.PI;
  return BASE.map(([len, amp, off, phase]) => {
    const length = len * lengthScale;
    const a = amp * heightScale;
    const k = (2 * Math.PI) / length;
    const bearing = toward + (off * Math.PI) / 180;
    return {
      dx: Math.sin(bearing),
      dz: -Math.cos(bearing),
      k,
      amp: a,
      omega: Math.sqrt(G * k),
      q: steepness / (k * a * WAVE_COUNT),
      phase,
      length,
      base: amp,
    };
  });
}

/**
 * Raise or flatten the sea for a new wind speed. Only heights change: lengths, directions and phases stay,
 * so the water never jumps when the wind builds or eases.
 */
export function setSeaState(waves: Wave[], twsKt: number): void {
  const heightScale = Math.min(2.6, Math.max(0.12, Math.pow(twsKt / 14, 1.35)));
  for (const w of waves) {
    w.amp = w.base * heightScale;
    w.q = 0.78 / (w.k * w.amp * WAVE_COUNT);
  }
}

/** Significant height of the wave set as tuned, before any scaling: four times the root of its variance. About 0.63 m. */
export const BASE_HEIGHT = 4 * Math.sqrt(BASE.reduce((sum, [, amp]) => sum + (amp * amp) / 2, 0));

/**
 * Set the drawn sea from a sea state (`@slack-tide/world`'s `SeaState`): its significant height, and how steep it is.
 * Heights scale to the height asked for. A steeper sea pinches its crests harder. Lengths, directions and phases
 * stay, so the water never jumps.
 * @param height significant height, metres
 * @param steepness height over length of the sea state: about 0.03 easy, 0.05 steep, 0.1 breaking
 */
export function setSea(waves: Wave[], height: number, steepness: number): void {
  const scale = Math.min(3.2, Math.max(0.06, height / BASE_HEIGHT));
  // On nearly flat water the crests are not pinched at all, or the surface would slide about with no height to it.
  const pinch = Math.min(1, Math.max(0.45, 0.4 + steepness * 8)) * Math.min(1, scale * 1.5);
  for (const w of waves) {
    w.amp = w.base * scale;
    w.q = pinch / (w.k * w.amp * WAVE_COUNT);
  }
}

const TAU = Math.PI * 2;

/**
 * Each wave's phase at a point and a moment, reduced to [0, 2π) in double precision: what the sea's shader adds to
 * `k (d · r)` for a point `r` metres from that point. The shader is handed small numbers only, so the water it draws
 * twenty or fifty kilometres out is as steady as at the origin, and still agrees with `waveHeight`.
 * @param ox, oz the point, scene metres (x east, z south): the scene's floating origin (`scene/origin.ts`)
 * @param t sea time, seconds
 */
export function wavePhases(waves: Wave[], ox: number, oz: number, t: number, out: number[]): number[] {
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const p = (w.k * (w.dx * ox + w.dz * oz) - w.omega * t + w.phase) % TAU;
    out[i] = p < 0 ? p + TAU : p;
  }
  out.length = waves.length;
  return out;
}

/**
 * Height of the long waves as the sea's shader works it out: from the phases at the origin (`wavePhases`) and the
 * point's place relative to it. With `single` every step is rounded to single precision, as the graphics card does.
 */
export function localWaveHeight(waves: Wave[], phases: number[], rx: number, rz: number, count = 4, single = false): number {
  const f = single ? Math.fround : (v: number) => v;
  let y = 0;
  for (let i = 0; i < count && i < waves.length; i++) {
    const w = waves[i];
    const ph = f(f(f(w.k) * f(f(f(w.dx) * f(rx)) + f(f(w.dz) * f(rz)))) + f(phases[i]));
    y = f(y + f(f(w.amp) * f(Math.sin(ph))));
  }
  return y;
}

/** Height of the long waves at a point. Good enough for floating the hull and keeping the camera dry. */
export function waveHeight(waves: Wave[], x: number, z: number, t: number, count = 4): number {
  let y = 0;
  for (let i = 0; i < count && i < waves.length; i++) {
    const w = waves[i];
    y += w.amp * Math.sin(w.k * (w.dx * x + w.dz * z) - w.omega * t + w.phase);
  }
  return y;
}
