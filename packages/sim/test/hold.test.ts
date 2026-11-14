import { describe, expect, it } from 'vitest';
import { Sim, KT, R2D, D2R, wrapPi } from '../src/index';
import { boat, northWind } from './helpers';

const makeSim = (o: { twsKt: number; headingDeg: number; speedKt: number }) => new Sim(boat, northWind(o.twsKt), { headingDeg: o.headingDeg, speedKt: o.speedKt });
const run = (sim: Sim, seconds: number) => sim.advance(seconds);

describe('anchoring and mooring', () => {
  it('lies back from the anchor, head to wind, and stays there', () => {
    const sim = makeSim({ twsKt: 15, headingDeg: 300, speedKt: 1 });
    sim.holdAt('anchor', sim.state.x, sim.state.y, 30);
    const ax = sim.state.holdX;
    const ay = sim.state.holdY;
    run(sim, 180);
    const s = sim.state;
    const off = Math.hypot(s.x - ax, s.y - ay);
    expect(off).toBeGreaterThan(24);
    expect(off).toBeLessThan(31);
    // Bow within a sheer of the wind.
    expect(Math.abs(wrapPi(sim.out.twd - s.heading)) * R2D).toBeLessThan(15);
    expect(s.speed).toBe(0);
    expect(sim.out.sog / KT).toBeLessThan(0.5);
    const there = { x: s.x, y: s.y };
    run(sim, 600);
    expect(Math.hypot(sim.state.x - there.x, sim.state.y - there.y)).toBeLessThan(12);
    expect(Math.abs(sim.state.heel) * R2D).toBeLessThan(5);
  });

  it('holds no matter what the helm and sheets are asked to do', () => {
    const sim = makeSim({ twsKt: 20, headingDeg: 300, speedKt: 0 });
    sim.holdAt('mooring', sim.state.x, sim.state.y, 6);
    sim.setControl('rudder', 30 * D2R);
    sim.setControl('mainsheet', 5 * D2R);
    run(sim, 300);
    expect(Math.hypot(sim.state.x - sim.state.holdX, sim.state.y - sim.state.holdY)).toBeLessThan(7);
  });

  it('sails away when the anchor is weighed', () => {
    const sim = makeSim({ twsKt: 14, headingDeg: 300, speedKt: 0 });
    sim.holdAt('anchor', sim.state.x, sim.state.y, 25);
    run(sim, 120);
    sim.release();
    expect(sim.state.hold).toBe('none');
    run(sim, 90);
    expect(sim.state.speed / KT).toBeGreaterThan(3.5);
    expect(Math.abs(sim.out.twa) * R2D).toBeGreaterThan(40);
    expect(Math.abs(sim.out.twa) * R2D).toBeLessThan(75);
  });

  it('is deterministic at anchor', () => {
    const a = makeSim({ twsKt: 15, headingDeg: 20, speedKt: 0 });
    const b = makeSim({ twsKt: 15, headingDeg: 20, speedKt: 0 });
    for (const sim of [a, b]) { sim.holdAt('anchor', 10, 10, 30); run(sim, 240); }
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
