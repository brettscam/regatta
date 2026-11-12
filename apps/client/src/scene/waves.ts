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
    };
  });
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
