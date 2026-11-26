import { describe, expect, it } from 'vitest';
import { ORIGIN_REACH, ORIGIN_STEP, rebase, wrap, type Origin } from '../src/scene/origin';
import { buildWaves, localWaveHeight, setSea, waveHeight, wavePhases } from '../src/scene/waves';

/** The direct formula as the card used to work it, every step in single precision: world position, absolute time. */
function directSingle(waves: ReturnType<typeof buildWaves>, x: number, z: number, t: number, count = 4): number {
  const f = Math.fround;
  let y = 0;
  for (let i = 0; i < count; i++) {
    const w = waves[i];
    const ph = f(f(f(f(w.k) * f(f(f(w.dx) * f(x)) + f(f(w.dz) * f(z)))) - f(f(w.omega) * f(t))) + f(w.phase));
    y = f(y + f(f(w.amp) * f(Math.sin(ph))));
  }
  return y;
}

describe('the floating origin', () => {
  it('stays put while the boat is within reach, and moves in whole steps when she is not', () => {
    const o: Origin = { x: 0, z: 0 };
    expect(rebase(o, ORIGIN_REACH - 1, -ORIGIN_REACH + 1)).toBe(false);
    expect(o).toEqual({ x: 0, z: 0 });
    expect(rebase(o, 10750, -19500)).toBe(true);
    expect(Math.abs(o.x % ORIGIN_STEP)).toBe(0);
    expect(Math.abs(o.z % ORIGIN_STEP)).toBe(0);
    expect(Math.abs(10750 - o.x)).toBeLessThanOrEqual(ORIGIN_STEP / 2);
    expect(Math.abs(-19500 - o.z)).toBeLessThanOrEqual(ORIGIN_STEP / 2);
    expect(rebase(o, NaN, 0)).toBe(false);
  });

  it('does not flap back and forth for a boat sailing about near a boundary', () => {
    const o: Origin = { x: 0, z: 0 };
    let moves = 0;
    // Back and forth over 1.2 km, many times, across the line where it first moves.
    for (let i = 0; i < 2000; i++) {
      const x = 2000 + 600 * Math.sin(i * 0.05);
      if (rebase(o, x, 30)) moves++;
    }
    expect(moves).toBe(1);
    // A long passage moves it about once every three kilometres, not every frame.
    o.x = 0; o.z = 0; moves = 0;
    for (let x = 0; x < 50000; x += 0.5) if (rebase(o, x, -x * 0.3)) moves++;
    expect(moves).toBeGreaterThan(10);
    expect(moves).toBeLessThan(25);
  });

  it('round-trips a position exactly: true place minus origin plus origin', () => {
    const o: Origin = { x: 0, z: 0 };
    for (const [x, z] of [[10750.123456, -19500.98765], [-49050.5, 14250.25], [1299.8, -249.9]]) {
      rebase(o, x, z);
      const rx = x - o.x;
      const rz = z - o.z;
      expect(Math.abs(rx)).toBeLessThanOrEqual(ORIGIN_REACH);
      expect(rx + o.x).toBe(x);
      expect(rz + o.z).toBe(z);
      // What the card holds of the local position is good to well under a tenth of a millimetre.
      expect(Math.abs(Math.fround(rx) - rx)).toBeLessThan(1e-4);
    }
  });

  it('wraps into one period', () => {
    expect(wrap(7.5, 2)).toBeCloseTo(1.5, 12);
    expect(wrap(-0.5, 2)).toBeCloseTo(1.5, 12);
    expect(wrap(-4, 2)).toBe(0);
  });
});

describe('the drawn sea far from the origin', () => {
  const waves = buildWaves(4.9, 16);
  setSea(waves, 0.9, 0.05);

  it('is the same height as the boat feels, to within a millimetre, fifty kilometres out and hours in', () => {
    const phases: number[] = [];
    let worst = 0;
    let worstDirect = 0;
    for (const [x, z, t] of [[-49050.37, 14250.81, 3600 * 9.7], [10750.2, -19500.6, 3600 * 30.1], [52000.4, -48000.9, 129000], [3.1, -2.2, 12.5]]) {
      const o: Origin = { x: 0, z: 0 };
      rebase(o, x, z);
      wavePhases(waves, o.x, o.z, t, phases);
      // A few points round the boat, as the shader would see them.
      for (const [dx, dz] of [[0, 0], [4.2, -1.3], [-17.5, 9.9], [130, 260]]) {
        const exact = waveHeight(waves, x + dx, z + dz, t, 6);
        const drawn = localWaveHeight(waves, phases, x + dx - o.x, z + dz - o.z, 6, true);
        worst = Math.max(worst, Math.abs(drawn - exact));
        worstDirect = Math.max(worstDirect, Math.abs(directSingle(waves, x + dx, z + dz, t, 6) - exact));
      }
    }
    expect(worst).toBeLessThan(0.001);
    // As it was: the card's own sum, from the world position and the clock, was out by centimetres.
    expect(worstDirect).toBeGreaterThan(worst * 10);
  });

  it('does not change at all when the origin moves', () => {
    const a = wavePhases(waves, 0, 0, 777.7, []);
    const b = wavePhases(waves, ORIGIN_STEP * 7, -ORIGIN_STEP * 3, 777.7, []);
    for (const [x, z] of [[21600, -9300], [21562.5, -9240.25]]) {
      const ha = localWaveHeight(waves, a, x, z, 6);
      const hb = localWaveHeight(waves, b, x - ORIGIN_STEP * 7, z + ORIGIN_STEP * 3, 6);
      expect(hb).toBeCloseTo(ha, 8);
    }
  });
});
