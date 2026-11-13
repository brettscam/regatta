import { describe, expect, it } from 'vitest';
import { Sim, D2R, SIM_DT, isSoundState } from '../src';
import { boat, northWind } from './helpers';
import { runScript, SCRIPT } from './script';

describe('determinism', () => {
  it('uses one fixed step', () => {
    expect(SIM_DT).toBe(1 / 60);
  });

  it('the same commands give the identical track, bit for bit', () => {
    const a = runScript(SCRIPT);
    const b = runScript(SCRIPT);
    expect(a.track).toEqual(b.track);
    expect(a.sim.state).toEqual(b.sim.state);
  });

  it('a snapshot resumes exactly, including mid-tack', () => {
    const a = new Sim(boat, northWind(14), { headingDeg: -50, speedKt: 5 });
    a.trimForWind();
    a.advance(20);
    a.tack();
    a.advance(2.5);
    const saved = JSON.parse(JSON.stringify(a.snapshot()));
    const b = new Sim(boat, northWind(14), saved);
    b.restore(saved);
    a.advance(40);
    b.advance(40);
    expect(b.state).toEqual(a.state);
  });

  it('a state saved by an older build, missing newer fields, restores and sails on', () => {
    const a = new Sim(boat, northWind(14), { headingDeg: -50, speedKt: 5 });
    a.trimForWind();
    a.advance(10);
    const old = JSON.parse(JSON.stringify(a.snapshot())) as Record<string, unknown>;
    for (const gone of ['knock', 'knockHold', 'crashGybes', 'knockdowns', 'routeX', 'routeCrab', 'pilotTrips', 'overpowered']) delete old[gone];
    const b = new Sim(boat, northWind(14), old as never);
    b.advance(30);
    for (const v of [b.state.x, b.state.y, b.state.heading, b.state.heel, b.state.speed]) expect(Number.isFinite(v)).toBe(true);
    expect(b.state.knock).toBe(0);
    expect(b.state.speed).toBeGreaterThan(1);
  });

  it('a state with bad numbers in it is repaired, not spread', () => {
    const a = new Sim(boat, northWind(14), { headingDeg: -50, speedKt: 5 });
    const bad = { ...a.snapshot(), heel: NaN, x: NaN, lateral: Infinity };
    expect(isSoundState(bad)).toBe(false);
    const b = new Sim(boat, northWind(14), bad);
    b.advance(5);
    expect(Number.isFinite(b.state.x)).toBe(true);
    expect(Number.isFinite(b.state.heel)).toBe(true);
  });

  it('time is counted in whole steps, with no drift', () => {
    const sim = new Sim(boat, northWind(10), { headingDeg: 90 });
    sim.advance(3600);
    expect(sim.state.tick).toBe(216000);
    expect(sim.state.t).toBe(3600);
  });

  it('state is plain data', () => {
    const sim = new Sim(boat, northWind(10), { headingDeg: 90 });
    sim.setControl('rudder', 5 * D2R);
    sim.advance(1);
    expect(JSON.parse(JSON.stringify(sim.state))).toEqual(sim.state);
  });
});
