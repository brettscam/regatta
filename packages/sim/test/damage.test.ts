import { describe, expect, it } from 'vitest';
import { Sim, KT, damageSpeed, DAMAGE_DRAG } from '../src/index';
import { boat, northWind } from './helpers';

const makeSim = (headingDeg = 90, speedKt = 6) => {
  const sim = new Sim(boat, northWind(12), { headingDeg, speedKt });
  sim.setCrewTrim(true);
  sim.trimForWind();
  return sim;
};

describe('hull damage', () => {
  it('a sound hull is not slowed, and the multiplier is exactly 1', () => {
    expect(damageSpeed(0)).toBe(1);
    expect(damageSpeed(0.5)).toBeCloseTo(1 - DAMAGE_DRAG / 2, 12);
    expect(damageSpeed(1)).toBe(0);
    expect(damageSpeed(Number.NaN)).toBe(1);
  });

  it('damage takes speed off her, more of it the worse it is', () => {
    const speeds = [0, 0.4, 0.8].map((damage) => {
      const sim = makeSim();
      sim.state.damage = damage;
      sim.advance(120);
      return sim.state.speed;
    });
    expect(speeds[1]).toBeLessThan(speeds[0] * 0.92);
    expect(speeds[2]).toBeLessThan(speeds[1] * 0.92);
    expect(speeds[2]).toBeGreaterThan(speeds[0] * 0.7);
  });

  it('holed, she stops', () => {
    const sim = makeSim();
    sim.state.damage = 1;
    sim.advance(30);
    expect(Math.abs(sim.state.speed) / KT).toBeLessThan(0.1);
  });

  it('damage survives a snapshot, and a saved state without it comes back sound', () => {
    const sim = makeSim();
    sim.state.damage = 0.35;
    const saved = sim.snapshot();
    const other = makeSim();
    other.restore(saved);
    expect(other.state.damage).toBe(0.35);
    const old = { ...saved } as Record<string, unknown>;
    delete old.damage;
    other.restore(old as never);
    expect(other.state.damage).toBe(0);
    other.restore({ ...saved, damage: 7 });
    expect(other.state.damage).toBe(1);
  });
});

describe('a shove from another hull', () => {
  it('moves her bodily and leaves her heading alone', () => {
    const sim = makeSim(90, 5);
    const before = sim.snapshot();
    sim.shove(2, -3);
    expect(sim.state.x).toBeCloseTo(before.x + 2, 12);
    expect(sim.state.y).toBeCloseTo(before.y - 3, 12);
    expect(sim.state.heading).toBe(before.heading);
    expect(sim.state.speed).toBe(before.speed);
  });

  it('a change of velocity lands on her speed and her leeway by where she points', () => {
    // Heading east: a push west takes way off her, a push north is to port.
    const sim = makeSim(90, 5);
    const speed = sim.state.speed;
    const lateral = sim.state.lateral;
    sim.shove(0, 0, -1, 0);
    expect(sim.state.speed).toBeCloseTo(speed - 1, 9);
    expect(sim.state.lateral).toBeCloseTo(lateral, 9);
    sim.shove(0, 0, 0, 0.5);
    expect(sim.state.speed).toBeCloseTo(speed - 1, 9);
    expect(sim.state.lateral).toBeCloseTo(lateral - 0.5, 9);
  });

  it('her head can be knocked round, and she carries on over the water the way she was going', () => {
    const sim = makeSim(90, 5);
    const speed = sim.state.speed;
    sim.state.lateral = 0;
    sim.shove(0, 0, 0, 0, Math.PI / 2);
    // Now heading south and still moving east: all of it is sideways, to port.
    expect(sim.state.heading).toBeCloseTo(Math.PI, 9);
    expect(sim.state.speed).toBeCloseTo(0, 9);
    expect(sim.state.lateral).toBeCloseTo(-speed, 9);
  });

  it('ignores a push that is not a number', () => {
    const sim = makeSim();
    const before = sim.snapshot();
    sim.shove(Number.NaN, 1, 0, 0);
    expect(sim.snapshot()).toEqual(before);
  });
});
