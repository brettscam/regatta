import { describe, expect, it } from 'vitest';
import { polarSpeed, bestVmgAngle } from '../src';
import { boat, settle } from './helpers';

const p = boat.polar;

describe('polar table', () => {
  it('is well formed', () => {
    expect(p.speeds.length).toBe(p.tws.length);
    for (const row of p.speeds) expect(row.length).toBe(p.twa.length);
  });

  it('returns table values at grid points', () => {
    expect(polarSpeed(p, 90, 14)).toBeCloseTo(7.32, 6);
    expect(polarSpeed(p, 40, 10)).toBeCloseTo(5.04, 6);
    expect(polarSpeed(p, 180, 25)).toBeCloseTo(7.51, 6);
  });

  it('interpolates between grid points in both directions', () => {
    expect(polarSpeed(p, 46, 14)).toBeCloseTo(5.7 + (6.56 - 5.7) * 0.5, 6);
    expect(polarSpeed(p, 90, 12)).toBeCloseTo((6.65 + 7.32) / 2, 6);
  });

  it('is symmetric port and starboard', () => {
    for (const a of [30, 45, 90, 135, 170]) expect(polarSpeed(p, -a, 12)).toBe(polarSpeed(p, a, 12));
  });

  it('is zero head to wind and in no wind, and clamps beyond the table', () => {
    expect(polarSpeed(p, 0, 15)).toBe(0);
    expect(polarSpeed(p, 20, 15)).toBe(0);
    expect(polarSpeed(p, 90, 0)).toBe(0);
    expect(polarSpeed(p, 90, 60)).toBe(polarSpeed(p, 90, 30));
  });

  it('never gets slower with more wind at a fixed angle', () => {
    for (const a of p.twa) {
      for (let i = 1; i < p.tws.length; i++) {
        expect(polarSpeed(p, a, p.tws[i])).toBeGreaterThanOrEqual(polarSpeed(p, a, p.tws[i - 1]));
      }
    }
  });

  it('has its best upwind angle near 40 to 45 degrees', () => {
    for (const tws of [8, 12, 16, 20]) {
      const best = bestVmgAngle(p, tws).twaDeg;
      expect(best).toBeGreaterThanOrEqual(38);
      expect(best).toBeLessThanOrEqual(47);
    }
  });
});

describe('the boat sails to its polar', () => {
  // With jib and main, well trimmed, not over-heeled, the boat should settle on the polar speed.
  const cases: Array<[number, number]> = [
    [8, 45], [8, 60], [8, 90], [8, 110],
    [12, 45], [12, 60], [12, 90], [12, 110],
    [16, 60], [16, 90], [16, 110],
  ];
  for (const [tws, twa] of cases) {
    it(`matches the polar within 2% at ${twa} degrees in ${tws} kt`, () => {
      const s = settle(tws, twa);
      const target = polarSpeed(p, twa, tws);
      expect(s.kt).toBeGreaterThan(target * 0.98);
      expect(s.kt).toBeLessThan(target * 1.02);
    });
  }

  it('is the same on either tack', () => {
    expect(settle(12, 60).kt).toBeCloseTo(settle(12, -60).kt, 6);
  });

  it('falls short of the polar on a deep run without a spinnaker, but not by more than a quarter', () => {
    const s = settle(12, 160);
    const target = polarSpeed(p, 160, 12);
    expect(s.kt).toBeLessThan(target);
    expect(s.kt).toBeGreaterThan(target * 0.75);
  });

  it('never beats the polar', () => {
    for (const tws of [6, 10, 14, 18, 24]) {
      for (const twa of [35, 45, 70, 100, 130, 170]) {
        expect(settle(tws, twa, { seconds: 150 }).kt).toBeLessThanOrEqual(polarSpeed(p, twa, tws) * 1.005);
      }
    }
  });
});
