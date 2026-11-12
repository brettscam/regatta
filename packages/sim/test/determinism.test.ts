import { describe, expect, it } from 'vitest';
import { Sim, D2R, SIM_DT } from '../src';
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
