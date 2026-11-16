import { describe, expect, it } from 'vitest';
import { Sim, KT, D2R, type BoatSpec, type Environment } from '@slack-tide/sim';
import boatJson from '../../../boats/sloop38.json';
import { FULL_PILOT_IN_RACE, Pilot } from '../src/input/pilot';
import type { Passage } from '../src/ui/passage';

const boat = boatJson as unknown as BoatSpec;
const wind = { windDir: 0 * D2R, windSpeed: 12 * KT, currentX: 0, currentY: 0 };
const env: Environment = { sample: () => wind };
const passage = { marks: [], nextIndex: 0, legOrigin: null } as unknown as Passage;

function make(racing: () => string | null) {
  const sim = new Sim(boat, env, { headingDeg: 60, speedKt: 5 });
  const said: string[] = [];
  const pilot = new Pilot(sim, passage, { say: (t) => said.push(t), alarm: (t) => said.push(t), racing });
  return { sim, pilot, said };
}

describe('two levels of autopilot', () => {
  it('steps off, steering only, steering and trimming, off', () => {
    const { sim, pilot } = make(() => null);
    expect(pilot.level).toBeNull();
    pilot.toggle();
    expect(pilot.level).toBe('partial');
    expect(sim.state.crewTrim).toBe(false);
    pilot.toggle();
    expect(pilot.level).toBe('full');
    expect(sim.state.crewTrim).toBe(true);
    pilot.toggle();
    expect(pilot.level).toBeNull();
    expect(sim.state.crewTrim).toBe(false);
  });

  it('is unlimited outside a race', () => {
    const { sim, pilot } = make(() => null);
    pilot.toggle(); pilot.toggle();
    sim.advance(FULL_PILOT_IN_RACE * 2); pilot.update();
    expect(pilot.level).toBe('full');
    expect(pilot.fullLeft()).toBeNull();
  });

  it('rations full pilot in a race and falls back to steering alone', () => {
    const { sim, pilot, said } = make(() => 'race-1');
    pilot.toggle(); pilot.toggle();
    for (let i = 0; i < FULL_PILOT_IN_RACE + 5; i++) { sim.advance(1); pilot.update(); }
    expect(pilot.level).toBe('partial');
    expect(pilot.fullLeft()).toBe(0);
    expect(said.some((t) => /used up/.test(t))).toBe(true);
    // With full used up, P from steering goes straight to off, and the next press back to steering.
    pilot.toggle();
    expect(pilot.level).toBeNull();
    pilot.toggle();
    expect(pilot.level).toBe('partial');
    expect(sim.state.crewTrim).toBe(false);
  });

  it('gives a new race a new allowance', () => {
    let id = 'race-1';
    const { sim, pilot } = make(() => id);
    pilot.toggle(); pilot.toggle();
    for (let i = 0; i < 30; i++) { sim.advance(1); pilot.update(); }
    expect(pilot.fullLeft()).toBeLessThan(FULL_PILOT_IN_RACE);
    id = 'race-2';
    pilot.update();
    expect(pilot.fullLeft()).toBeGreaterThan(FULL_PILOT_IN_RACE - 2);
  });
});
