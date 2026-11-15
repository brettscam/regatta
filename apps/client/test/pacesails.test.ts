import { describe, expect, it } from 'vitest';
import type { BoatSpec } from '@slack-tide/sim';
import boatJson from '../../../boats/sloop38.json';
import { packSpin, unpackSpin } from '../src/boat/boatView';
import { paceReef, paceSpinnaker } from '../src/race/pace';

const kite = (boatJson as unknown as BoatSpec).sails.spinnaker!;

describe('what sail a pace boat carries', () => {
  it('reefs at about 20 kt and again at about 26', () => {
    expect(paceReef(14, 0)).toBe(0);
    expect(paceReef(19, 0)).toBe(0);
    expect(paceReef(20, 0)).toBe(1);
    expect(paceReef(24, 1)).toBe(1);
    expect(paceReef(26, 1)).toBe(2);
  });

  it('does not shake a reef out in every lull', () => {
    expect(paceReef(18, 1)).toBe(1);
    expect(paceReef(16, 1)).toBe(0);
    expect(paceReef(24, 2)).toBe(2);
    expect(paceReef(22, 2)).toBe(1);
  });

  it('sets the spinnaker on a leg with the wind well aft, in a wind it can carry', () => {
    expect(paceSpinnaker(false, kite, 12, 140, null, 2000)).toBe(true);
    expect(paceSpinnaker(false, kite, 12, 70, null, 2000)).toBe(false);
    expect(paceSpinnaker(false, kite, kite.maxTwsKt - 1, 140, null, 2000)).toBe(false);
    expect(paceSpinnaker(false, undefined, 12, 140, null, 2000)).toBe(false);
  });

  it('has it down before a mark whose next leg is to windward, and keeps it for one that is not', () => {
    expect(paceSpinnaker(true, kite, 12, 140, 50, 900)).toBe(true);
    expect(paceSpinnaker(true, kite, 12, 140, 50, 250)).toBe(false);
    expect(paceSpinnaker(true, kite, 12, 140, 130, 250)).toBe(true);
    // Too short a run to be worth setting it at all.
    expect(paceSpinnaker(false, kite, 12, 140, 50, 500)).toBe(false);
  });

  it('takes it down when the wind gets up or comes ahead', () => {
    expect(paceSpinnaker(true, kite, kite.maxTwsKt - 1, 140, null, 2000)).toBe(false);
    expect(paceSpinnaker(true, kite, 12, 90, null, 2000)).toBe(false);
  });
});

describe('telling the other boats about the spinnaker', () => {
  const state = (hoist: number) => ({ spinHoist: hoist, spin: hoist > 0, spinAngle: 0 }) as never;
  const out = (luff: number, flogging: boolean, awa = 2) => ({ awa, spin: { luff, flogging } }) as never;

  it('is nothing at all when it is in its bag', () => {
    expect(packSpin(state(0), out(0, false))).toBe(0);
  });

  it('carries how far it is up, the curl in its luff and whether it has collapsed', () => {
    for (const [hoist, luff, flog] of [[1, 0, false], [0.5, 0, false], [1, 0.667, false], [1, 1, true], [0.3, 1, true]] as const) {
      const s = { spinHoist: 0, spin: false, spinAngle: 0 };
      const o = { awa: -2.2, spin: { luff: 0, flogging: false } };
      unpackSpin(packSpin(state(hoist), out(luff, flog)), s as never, o as never);
      expect(s.spinHoist).toBeCloseTo(hoist, 5);
      expect(s.spin).toBe(true);
      expect(o.spin.flogging).toBe(flog);
      expect(o.spin.luff).toBeCloseTo(luff, 1);
      // Wind on the port side: the clew flies to starboard.
      expect(s.spinAngle).toBeGreaterThan(0.5);
    }
  });

  it('a boat that says nothing of one, or says nonsense, has none', () => {
    for (const sp of [0, NaN, -5, undefined as unknown as number]) {
      const s = { spinHoist: 1, spin: true, spinAngle: 1 };
      const o = { awa: 2, spin: { luff: 1, flogging: true } };
      unpackSpin(sp, s as never, o as never);
      expect(s.spinHoist).toBe(0);
      expect(s.spin).toBe(false);
      expect(o.spin.flogging).toBe(false);
    }
  });
});
