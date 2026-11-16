import { describe, expect, it } from 'vitest';
import { BASE_HEIGHT, buildWaves, setSea, waveHeight } from '../src/scene/waves';

/** Significant height of a wave set: four times the root of its variance. */
const significant = (waves: ReturnType<typeof buildWaves>): number => 4 * Math.sqrt(waves.reduce((sum, w) => sum + (w.amp * w.amp) / 2, 0));

describe('the drawn sea follows the sea state', () => {
  it('is drawn at the height the sea state gives', () => {
    const waves = buildWaves(4.4, 14);
    expect(BASE_HEIGHT).toBeGreaterThan(0.55);
    expect(BASE_HEIGHT).toBeLessThan(0.7);
    for (const h of [0.2, 0.5, 0.9, 1.4]) {
      setSea(waves, h, 0.045);
      expect(significant(waves)).toBeCloseTo(h, 6);
    }
  });

  it('is nearly flat in a lee and never grows without limit', () => {
    const waves = buildWaves(4.4, 14);
    setSea(waves, 0, 0);
    expect(significant(waves)).toBeLessThan(0.05);
    for (const w of waves) expect(Number.isFinite(w.q)).toBe(true);
    setSea(waves, 9, 0.1);
    expect(significant(waves)).toBeLessThan(2.2);
  });

  it('pinches its crests harder when the sea is steep, and never so hard that they loop', () => {
    const waves = buildWaves(4.4, 14);
    setSea(waves, 0.8, 0.03);
    const easy = waves[0].q * waves[0].k * waves[0].amp;
    setSea(waves, 0.8, 0.09);
    const steep = waves[0].q * waves[0].k * waves[0].amp;
    expect(steep).toBeGreaterThan(easy * 1.4);
    // Summed over every wave the pinch stays at or under 1, which is where a Gerstner crest would fold over.
    expect(waves.reduce((sum, w) => sum + w.q * w.k * w.amp, 0)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('keeps its lengths, directions and phases, so the water never jumps when the sea changes', () => {
    const waves = buildWaves(4.4, 14);
    setSea(waves, 0.5, 0.04);
    const before = waves.map((w) => [w.k, w.dx, w.dz, w.phase, w.omega]);
    const h = waveHeight(waves, 30, -12, 100);
    setSea(waves, 1.0, 0.07);
    expect(waves.map((w) => [w.k, w.dx, w.dz, w.phase, w.omega])).toEqual(before);
    expect(waveHeight(waves, 30, -12, 100)).toBeCloseTo(h * 2, 9);
  });
});
