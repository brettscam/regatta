import { describe, expect, it } from 'vitest';
import { KT, bestVmgAngle, polarSpeed, type BoatSpec } from '@slack-tide/sim';
import boatJson from '../../../boats/sloop38.json';
import { planRoute, plannedPosition, speedMadeGood, trackFix, type PlanWeather } from '../src';

const polar = (boatJson as unknown as BoatSpec).polar;
const NM = 1852;
/** Wind from due north, with an optional steady current in knots toward east and north. */
const weather = (windKt: number, eastKt = 0, northKt = 0): PlanWeather => ({
  wind: () => ({ dir: 0, speed: windKt * KT }),
  current: () => ({ x: eastKt * KT, y: northKt * KT }),
});
const plain = { efficiency: 1, noSpinnaker: 1 };

describe('speed made good', () => {
  it('is the polar speed on a reach', () => {
    expect(speedMadeGood(polar, 90, 12, plain).kt).toBeCloseTo(polarSpeed(polar, 90, 12), 6);
    expect(speedMadeGood(polar, 90, 12, plain).sail).toBe('reach');
  });

  it('dead upwind is the best upwind VMG, by tacking', () => {
    const made = speedMadeGood(polar, 0, 12, plain);
    expect(made.kt).toBeCloseTo(bestVmgAngle(polar, 12).vmgKt, 6);
    expect(made.sail).toBe('beat');
  });

  it('joins up smoothly at the best beating angle', () => {
    const up = bestVmgAngle(polar, 12).twaDeg;
    expect(speedMadeGood(polar, up - 0.01, 12, plain).kt).toBeCloseTo(speedMadeGood(polar, up + 0.01, 12, plain).kt, 1);
  });

  it('dead downwind is the best downwind VMG, by gybing', () => {
    expect(speedMadeGood(polar, 180, 12, plain).kt).toBeCloseTo(bestVmgAngle(polar, 12, false).vmgKt, 6);
  });

  it('a real crew is a little slower than the polar', () => {
    expect(speedMadeGood(polar, 90, 12).kt).toBeLessThan(polarSpeed(polar, 90, 12));
  });
});

describe('route plan', () => {
  it('times a reach by distance over polar speed', () => {
    const plan = planRoute(polar, { x: 0, y: 0 }, [{ x: 2 * NM, y: 0, name: 'East' }], 100, weather(12), plain);
    const hours = 2 / polarSpeed(polar, 90, 12);
    expect(plan.legs[0].seconds).toBeCloseTo(hours * 3600, 0);
    expect(plan.legs[0].eta).toBeCloseTo(100 + hours * 3600, 0);
    expect(plan.legs[0].bearing).toBeCloseTo(Math.PI / 2, 6);
    expect(plan.distance).toBeCloseTo(2 * NM, 6);
  });

  it('a fair tide shortens the leg and a foul one lengthens it', () => {
    const wps = [{ x: 2 * NM, y: 0, name: 'East' }];
    const slack = planRoute(polar, { x: 0, y: 0 }, wps, 0, weather(12), plain).seconds;
    const fair = planRoute(polar, { x: 0, y: 0 }, wps, 0, weather(12, 2), plain);
    const foul = planRoute(polar, { x: 0, y: 0 }, wps, 0, weather(12, -2), plain);
    expect(fair.seconds).toBeLessThan(slack);
    expect(foul.seconds).toBeGreaterThan(slack);
    expect(fair.legs[0].streamKt).toBeCloseTo(2, 6);
    expect(foul.legs[0].sogKt).toBeCloseTo(polarSpeed(polar, 90, 12) - 2, 3);
  });

  it('a beat takes longer than a reach of the same length', () => {
    const reach = planRoute(polar, { x: 0, y: 0 }, [{ x: NM, y: 0, name: 'E' }], 0, weather(12), plain);
    const beat = planRoute(polar, { x: 0, y: 0 }, [{ x: 0, y: NM, name: 'N' }], 0, weather(12), plain);
    expect(beat.legs[0].sail).toBe('beat');
    expect(beat.seconds).toBeGreaterThan(reach.seconds * 1.3);
  });

  it('chains legs and reports where the plan should be at any time', () => {
    const plan = planRoute(polar, { x: 0, y: 0 }, [{ x: NM, y: 0, name: 'A' }, { x: NM, y: -NM, name: 'B' }], 0, weather(12), plain);
    expect(plan.legs).toHaveLength(2);
    expect(plan.legs[1].eta).toBeCloseTo(plan.seconds, 6);
    const half = plannedPosition(plan, plan.legs[0].eta / 2);
    expect(half.x).toBeCloseTo(NM / 2, -1);
    expect(half.y).toBeCloseTo(0, 6);
    const end = plannedPosition(plan, plan.seconds + 1000);
    expect(end.x).toBeCloseTo(NM, 6);
    expect(end.y).toBeCloseTo(-NM, 6);
  });
});

describe('track fix', () => {
  it('measures cross-track error, positive to starboard of the track', () => {
    // Track due north. A boat east of it is to starboard.
    const fix = trackFix({ x: 50, y: 400 }, { x: 0, y: 0 }, { x: 0, y: 1000 });
    expect(fix.crossTrack).toBeCloseTo(50, 6);
    expect(fix.along).toBeCloseTo(400, 6);
    expect(trackFix({ x: -30, y: 400 }, { x: 0, y: 0 }, { x: 0, y: 1000 }).crossTrack).toBeCloseTo(-30, 6);
  });

  it('gives bearing and distance to the mark', () => {
    const fix = trackFix({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(fix.toGo).toBeCloseTo(1000, 6);
    expect(fix.bearing).toBeCloseTo(Math.PI / 2, 6);
  });
});
