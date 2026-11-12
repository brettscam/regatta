import { describe, expect, it } from 'vitest';
import { bestVmgAngle } from '../src';
import { angleBetweenDeg, boat, crossoverKt, settle } from './helpers';

// The tuning targets for the 38 ft sloop, from the PRD.
describe('PRD tuning targets, 38 ft sloop', () => {
  it('tacks through about 90 degrees over the ground', () => {
    const twa = bestVmgAngle(boat.polar, 14).twaDeg;
    const stbd = settle(14, twa);
    const port = settle(14, -twa);
    const through = angleBetweenDeg(stbd.sim.out.cog, port.sim.out.cog);
    expect(through).toBeGreaterThan(84);
    expect(through).toBeLessThan(96);
  });

  it('tops out at 7.5 to 8.5 kt reaching in 15 to 20 kt', () => {
    for (const tws of [15, 17.5, 20]) {
      let top = 0;
      for (const twa of [90, 100, 110, 120]) top = Math.max(top, settle(tws, twa).kt);
      expect(top).toBeGreaterThanOrEqual(7.5);
      expect(top).toBeLessThanOrEqual(8.5);
    }
  });

  it('first reef pays off upwind at about 18 kt true', () => {
    const x = crossoverKt(0, 1);
    expect(x).toBeGreaterThanOrEqual(17);
    expect(x).toBeLessThanOrEqual(19);
  });

  it('second reef pays off upwind at about 24 kt true', () => {
    const x = crossoverKt(1, 2);
    expect(x).toBeGreaterThanOrEqual(23);
    expect(x).toBeLessThanOrEqual(25);
  });

  it('milestone 2 gate: in 22 kt true a reefed boat is measurably faster upwind', () => {
    const full = settle(22, 42);
    const reefed = settle(22, 42, { reef: 1 });
    expect(reefed.kt - full.kt).toBeGreaterThan(0.3);
    expect(reefed.heelDeg).toBeLessThan(full.heelDeg);
  });

  it('reefing lowers heel faster than it lowers speed', () => {
    const full = settle(14, 50);
    const reefed = settle(14, 50, { reef: 1 });
    const speedLost = 1 - reefed.kt / full.kt;
    const heelLost = 1 - reefed.heelDeg / full.heelDeg;
    expect(heelLost).toBeGreaterThan(speedLost * 3);
  });
});
