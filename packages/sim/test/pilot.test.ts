import { describe, expect, it } from 'vitest';
import { Sim, D2R, R2D, KT, wrapPi } from '../src';
import { boat, northWind } from './helpers';

/** Sail under the pilot toward a mark, with the crew trimming. Returns what happened on the way. */
function sailTo(sim: Sim, mark: { x: number; y: number }, maxSeconds: number) {
  sim.setCrewTrim(true);
  sim.trimForWind();
  sim.setRoute(mark);
  let ironsSeconds = 0;
  let aground = false;
  let minDepth = Infinity;
  for (let t = 0; t < maxSeconds; t++) {
    sim.advance(1);
    if (sim.out.inIrons) ironsSeconds++;
    aground ||= sim.out.aground;
    if (sim.out.underKeel !== null) minDepth = Math.min(minDepth, sim.out.underKeel);
    if (Math.hypot(mark.x - sim.state.x, mark.y - sim.state.y) < 60) return { arrived: true, seconds: t + 1, ironsSeconds, aground, minDepth };
  }
  return { arrived: false, seconds: maxSeconds, ironsSeconds, aground, minDepth };
}

describe('autopilot: heading and wind', () => {
  it('the dial changes the heading it holds', () => {
    const sim = new Sim(boat, northWind(12), { headingDeg: 90, speedKt: 5 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setHelm('heading');
    sim.nudgeControl('pilot', 20 * D2R);
    sim.advance(60);
    expect(sim.state.heading * R2D).toBeCloseTo(110, 0);
    expect(sim.state.helmMode).toBe('heading');
  });

  it('the dial changes the wind angle it holds, and wraps a heading past north', () => {
    const sim = new Sim(boat, northWind(12), { headingDeg: 300, speedKt: 5 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setHelm('wind', 60 * D2R);
    sim.nudgeControl('pilot', -10 * D2R);
    sim.advance(90);
    expect(sim.out.twa * R2D).toBeCloseTo(50, 0);
    sim.setHelm('heading', 350 * D2R);
    sim.nudgeControl('pilot', 20 * D2R);
    expect(sim.getControl('pilot') * R2D).toBeCloseTo(10, 6);
  });

  it('the dial does nothing with a hand on the wheel', () => {
    const sim = new Sim(boat, northWind(12), { headingDeg: 90, speedKt: 5 });
    sim.setControl('rudder', 0);
    const before = sim.getControl('pilot');
    sim.nudgeControl('pilot', 0.3);
    expect(sim.getControl('pilot')).toBe(before);
    expect(sim.state.helmMode).toBe('hand');
  });
});

describe('autopilot: steering for a mark', () => {
  it('reaches a mark on a reach, in about the time the polar says', () => {
    const sim = new Sim(boat, northWind(12), { headingDeg: 90, speedKt: 6 });
    const run = sailTo(sim, { x: 1500, y: 0 }, 600);
    expect(run.arrived).toBe(true);
    expect(run.seconds).toBeLessThan((1440 / (6.6 * KT)) * 1.15);
  });

  it('turns the boat round for a mark astern', () => {
    const sim = new Sim(boat, northWind(12), { headingDeg: 90, speedKt: 6 });
    const run = sailTo(sim, { x: -1200, y: 100 }, 700);
    expect(run.arrived).toBe(true);
    expect(sim.out.jib.backed).toBe(0);
  });

  it('beats to a mark dead upwind, tacking when it can be laid', () => {
    const sim = new Sim(boat, northWind(12), { headingDeg: 45, speedKt: 5 });
    const run = sailTo(sim, { x: 0, y: 1500 }, 1400);
    expect(run.arrived).toBe(true);
    expect(sim.state.routeTurns).toBeGreaterThanOrEqual(1);
    expect(sim.state.routeTurns).toBeLessThanOrEqual(4);
    // 1500 m at about 4.2 kt made good is under 12 minutes. Allow for the tacks.
    expect(run.seconds).toBeLessThan(1000);
    expect(run.ironsSeconds).toBeLessThan(5);
  });

  it('reports that it is beating when the mark is to windward', () => {
    const sim = new Sim(boat, northWind(12), { headingDeg: 45, speedKt: 5 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setRoute({ x: 0, y: 3000 });
    sim.advance(30);
    expect(sim.out.pilotBeating).toBe(true);
    expect(Math.abs(sim.out.twa) * R2D).toBeGreaterThan(40);
    expect(Math.abs(sim.out.twa) * R2D).toBeLessThan(48);
  });

  it('crabs across a tide to keep her course over ground on the mark', () => {
    const env = { sample: () => ({ windDir: 0, windSpeed: 12 * KT, currentX: 0, currentY: -1.5 * KT }) };
    const sim = new Sim(boat, env, { headingDeg: 90, speedKt: 6 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setRoute({ x: 3000, y: 0 });
    sim.advance(150);
    // The stream sets south at 1.5 kt. She should be pointing north of east and tracking east.
    expect(sim.state.heading * R2D).toBeLessThan(86);
    expect(Math.abs(wrapPi(sim.out.cog - Math.atan2(3000 - sim.state.x, -sim.state.y))) * R2D).toBeLessThan(4);
    expect(Math.abs(sim.state.y)).toBeLessThan(80);
  });

  it('short-tacks off a shoal instead of running up it', () => {
    // Deep water in a channel 700 m wide running north. It shoals to nothing either side.
    const env = { sample: (x: number) => ({ windDir: 0, windSpeed: 12 * KT, currentX: 0, currentY: 0, depth: Math.max(0, Math.min(25, (350 - Math.abs(x)) / 8)) }) };
    const sim = new Sim(boat, env, { headingDeg: 45, speedKt: 5 });
    const run = sailTo(sim, { x: 0, y: 2500 }, 2400);
    expect(run.aground).toBe(false);
    expect(run.minDepth).toBeGreaterThan(0.5);
    expect(run.arrived).toBe(true);
    expect(sim.state.routeTurns).toBeGreaterThanOrEqual(4);
  });

  it('a hand on the wheel takes the helm back', () => {
    const sim = new Sim(boat, northWind(12), { headingDeg: 90, speedKt: 6 });
    sim.setRoute({ x: 2000, y: 0 });
    sim.advance(5);
    sim.setControl('rudder', 0.1);
    expect(sim.state.helmMode).toBe('hand');
  });
});

describe('autopilot: limits', () => {
  it('gives up when overpowered and hands the wheel back', () => {
    const sim = new Sim(boat, northWind(34), { headingDeg: 300, speedKt: 6 });
    sim.trimForWind();
    sim.setHelm('heading');
    sim.advance(60);
    expect(sim.state.pilotTrips).toBeGreaterThanOrEqual(1);
    expect(sim.state.helmMode).toBe('hand');
  });

  it('holds on happily in a working breeze', () => {
    const sim = new Sim(boat, northWind(16), { headingDeg: 300, speedKt: 6 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setHelm('heading');
    sim.advance(300);
    expect(sim.state.pilotTrips).toBe(0);
    expect(sim.state.helmMode).toBe('heading');
  });
});
