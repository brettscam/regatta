import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, D2R, R2D, KT, CRANK_SECONDS, initialState, wrapPi, type BoatSpec, type SimState } from '../src';
import { northWind } from './helpers';

// The inboard diesel: how fast each boat motors, what a head wind takes off her, what it burns, and what it does
// for the rudder at no speed. Everything here is with the wind from due north.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../boats');
const read = (id: string) => JSON.parse(readFileSync(resolve(dir, `${id}.json`), 'utf8')) as BoatSpec;
const boats = { sloop30: read('sloop30'), sloop38: read('sloop38'), perf45: read('perf45') };
const b38 = boats.sloop38;

/** A boat lying stopped with her jib rolled away, engine running in neutral. */
function underEngine(boat: BoatSpec, windKt: number, headingDeg = 0): Sim {
  const sim = new Sim(boat, northWind(windKt), { headingDeg, speedKt: 0, furl: 0 });
  expect(sim.startEngine()).toBe('cranking');
  sim.advance(CRANK_SECONDS + 0.2);
  expect(sim.state.engineOn).toBe(true);
  return sim;
}

/** Motor on a compass heading with the pilot holding it until she settles. */
function motor(boat: BoatSpec, windKt: number, notch: number, headingDeg = 0, seconds = 150): Sim {
  const sim = underEngine(boat, windKt, headingDeg);
  sim.setHelm('heading', headingDeg * D2R);
  expect(sim.setThrottle(notch)).toBe('ok');
  sim.advance(seconds);
  return sim;
}

describe('starting and stopping', () => {
  it('cranks for a second or two, then runs in neutral without moving her', () => {
    const sim = new Sim(b38, northWind(0), { speedKt: 0 });
    expect(sim.state.engineOn).toBe(false);
    expect(sim.setThrottle(2)).toBe('off');
    expect(sim.startEngine()).toBe('cranking');
    sim.advance(CRANK_SECONDS / 2);
    expect(sim.state.engineOn).toBe(false);
    expect(sim.startEngine()).toBe('cranking');
    sim.advance(CRANK_SECONDS);
    expect(sim.state.engineOn).toBe(true);
    expect(sim.out.engineRpm).toBeGreaterThan(600);
    sim.advance(30);
    expect(sim.state.speed).toBe(0);
    expect(sim.out.underPower).toBe(false);
    sim.stopEngine();
    expect(sim.out.engineRpm).toBe(0);
  });

  it('a boat with no engine has nothing to start', () => {
    const { engine: _engine, ...bare } = b38;
    const sim = new Sim(bare as BoatSpec, northWind(8), {});
    expect(sim.startEngine()).toBe('none');
    sim.advance(5);
    expect(sim.state.engineOn).toBe(false);
  });

  it('a state saved before there was an engine loads with it off, a full tank and a full battery', () => {
    const old = { ...initialState({ speedKt: 4 }) } as unknown as Record<string, unknown>;
    for (const k of ['engineOn', 'engineCrank', 'throttle', 'fuelUsed', 'batteryUsed', 'engineStops', 'batteryTrips']) delete old[k];
    const sim = new Sim(b38, northWind(10), {});
    sim.restore(old as unknown as SimState);
    expect(sim.state.engineOn).toBe(false);
    expect(sim.state.throttle).toBe(0);
    expect(sim.fuel).toBe(b38.engine!.tankL);
    expect(sim.battery).toBe(1);
  });
});

describe('speed under power', () => {
  it('each boat makes her cruising speed in flat calm: about 6 kt, 6.5 to 7, and 7.5', () => {
    const kt = (id: keyof typeof boats) => motor(boats[id], 0, 3).state.speed / KT;
    expect(kt('sloop30')).toBeGreaterThan(5.7);
    expect(kt('sloop30')).toBeLessThan(6.2);
    expect(kt('sloop38')).toBeGreaterThan(6.4);
    expect(kt('sloop38')).toBeLessThan(7.0);
    expect(kt('perf45')).toBeGreaterThan(7.2);
    expect(kt('perf45')).toBeLessThan(7.7);
  });

  it('the throttle steps give more speed each, and full ahead only a little over cruise', () => {
    const kts = [1, 2, 3, 4].map((n) => motor(b38, 0, n).state.speed / KT);
    for (let i = 1; i < kts.length; i++) expect(kts[i]).toBeGreaterThan(kts[i - 1]);
    expect(kts[0]).toBeGreaterThan(2);
    expect(kts[0]).toBeLessThan(3.5);
    expect(kts[3] - kts[2]).toBeLessThan(0.8);
  });

  it('gets under way from a stop in well under a minute', () => {
    const sim = motor(b38, 0, 3, 0, 20);
    expect(sim.state.speed / KT).toBeGreaterThan(5);
  });

  it('motors straight into the wind, where she cannot sail, and slower the harder it blows', () => {
    for (const boat of Object.values(boats)) {
      const calm = motor(boat, 0, 3).state.speed / KT;
      const breeze = motor(boat, 20, 3);
      const gale = motor(boat, 30, 3).state.speed / KT;
      const kt = breeze.state.speed / KT;
      // Still dead into it, not fallen off onto a tack.
      expect(Math.abs(breeze.out.twa) * R2D).toBeLessThan(3);
      expect(breeze.state.y).toBeGreaterThan(200);
      expect(kt).toBeLessThan(calm - 0.8);
      expect(kt).toBeGreaterThan(calm * 0.6);
      expect(gale).toBeLessThan(kt - 0.8);
      expect(gale).toBeGreaterThan(1.5);
    }
    // The same boat under sail alone, pointed at the wind, goes nowhere.
    const sailing = new Sim(b38, northWind(20), { headingDeg: 0, speedKt: 0 });
    sailing.setHelm('heading', 0);
    sailing.advance(120);
    expect(sailing.state.y).toBeLessThan(20);
  });

  it('a wind from astern helps a little', () => {
    const calm = motor(b38, 0, 2, 180).state.speed / KT;
    const fair = motor(b38, 20, 2, 180).state.speed / KT;
    expect(fair).toBeGreaterThan(calm);
    expect(fair).toBeLessThan(calm + 1.5);
  });
});

describe('motor-sailing', () => {
  function reach(windKt: number, twaDeg: number, notch: number): number {
    const sim = new Sim(b38, northWind(windKt), { headingDeg: -twaDeg, speedKt: 3 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setHelm('wind', twaDeg * D2R);
    if (notch !== 0) {
      sim.startEngine();
      sim.advance(CRANK_SECONDS + 0.1);
      sim.setThrottle(notch);
    }
    sim.advance(240);
    return sim.state.speed / KT;
  }

  it('gives more than sail or engine alone, but nothing like the sum', () => {
    const sail = reach(8, 70, 0);
    const both = reach(8, 70, 3);
    const engine = motor(b38, 0, 3).state.speed / KT;
    expect(both).toBeGreaterThan(Math.max(sail, engine) + 0.1);
    expect(both).toBeLessThan(Math.max(sail, engine) + 1.6);
    expect(both).toBeLessThan(sail + engine - 2);
  });

  it('adds next to nothing when she is already sailing fast', () => {
    const sail = reach(18, 100, 0);
    const both = reach(18, 100, 3);
    expect(both).toBeGreaterThanOrEqual(sail - 0.05);
    expect(both).toBeLessThan(sail + 0.5);
  });

  it('the engine off leaves her sailing exactly as before', () => {
    const a = new Sim(b38, northWind(12), { headingDeg: -60, speedKt: 5 });
    const { engine: _engine, ...bare } = b38;
    const b = new Sim(bare as BoatSpec, northWind(12), { headingDeg: -60, speedKt: 5 });
    for (const sim of [a, b]) {
      sim.setCrewTrim(true);
      sim.setHelm('wind', 60 * D2R);
      sim.advance(120);
    }
    expect(a.state.x).toBe(b.state.x);
    expect(a.state.y).toBe(b.state.y);
    expect(a.state.heading).toBe(b.state.heading);
    expect(a.state.heel).toBe(b.state.heel);
  });
});

describe('astern and at low speed', () => {
  it('astern is weak: a couple of knots, and it stops her from cruising speed in a few lengths', () => {
    const back = underEngine(b38, 0);
    back.setThrottle(-2);
    back.advance(90);
    const kt = back.state.speed / KT;
    expect(kt).toBeLessThan(-1.5);
    expect(kt).toBeGreaterThan(-3.6);

    const sim = motor(b38, 0, 3);
    const from = sim.state.y;
    sim.setThrottle(-2);
    let seconds = 0;
    while (sim.state.speed > 0 && seconds < 120) { sim.advance(1); seconds++; }
    expect(seconds).toBeLessThan(25);
    expect(sim.state.y - from).toBeLessThan(b38.dimensions.loa * 5);
    expect(sim.state.y - from).toBeGreaterThan(b38.dimensions.loa);
  });

  it('the propeller walks her stern to port in astern, so the bow swings to starboard', () => {
    const sim = underEngine(b38, 0);
    sim.setThrottle(-2);
    sim.advance(6);
    const swing = wrapPi(sim.state.heading) * R2D;
    expect(swing).toBeGreaterThan(2);
    expect(swing).toBeLessThan(30);
  });

  it('steers badly going backwards, and the other way round', () => {
    const turnIn = (notch: number): number => {
      const sim = underEngine(b38, 0);
      sim.setThrottle(notch);
      sim.advance(40);
      const before = sim.state.heading;
      sim.setControl('rudder', 20 * D2R);
      sim.advance(10);
      // Take out what the propeller walks her round by with the wheel amidships.
      const straight = underEngine(b38, 0);
      straight.setThrottle(notch);
      straight.advance(40);
      const b0 = straight.state.heading;
      straight.advance(10);
      return (wrapPi(sim.state.heading - before) - wrapPi(straight.state.heading - b0)) * R2D;
    };
    const ahead = turnIn(1);
    const astern = turnIn(-1);
    expect(ahead).toBeGreaterThan(10);
    expect(astern).toBeLessThan(-1);
    expect(Math.abs(astern)).toBeLessThan(ahead * 0.5);
  });

  it('the rudder bites with no way on once the engine is put ahead: prop wash', () => {
    const turnFromRest = (notch: number): number => {
      const sim = underEngine(b38, 0);
      sim.setControl('rudder', 30 * D2R);
      if (notch) sim.setThrottle(notch);
      sim.advance(4);
      return wrapPi(sim.state.heading) * R2D;
    };
    expect(turnFromRest(0)).toBe(0);
    expect(turnFromRest(1)).toBeGreaterThan(6);
    // And she has hardly moved ahead doing it.
    const sim = underEngine(b38, 0);
    sim.setControl('rudder', 30 * D2R);
    sim.setThrottle(1);
    sim.advance(4);
    expect(Math.hypot(sim.state.x, sim.state.y)).toBeLessThan(4);
  });

  it('creeps up to a point slowly enough to pick up a mooring', () => {
    const sim = motor(b38, 10, 1, 0, 60);
    expect(sim.state.speed / KT).toBeLessThan(3);
    sim.setThrottle(0);
    sim.advance(25);
    expect(sim.state.speed / KT).toBeLessThan(1);
  });
});

describe('held', () => {
  it('at anchor she can be started but not put in gear, and leaves under power when let go', () => {
    const sim = new Sim(b38, northWind(10), { speedKt: 0 });
    sim.holdAt('anchor', 0, 30, 25);
    expect(sim.startEngine()).toBe('cranking');
    sim.advance(CRANK_SECONDS + 0.1);
    expect(sim.state.engineOn).toBe(true);
    expect(sim.setThrottle(2)).toBe('held');
    expect(sim.state.throttle).toBe(0);
    sim.advance(5);
    sim.release();
    expect(sim.state.helmMode).toBe('hand');
    expect(sim.state.crewTrim).toBe(false);
    expect(sim.setThrottle(1)).toBe('ok');
    sim.advance(20);
    expect(sim.state.speed).toBeGreaterThan(0.5);
  });

  it('anchoring takes her out of gear', () => {
    const sim = motor(b38, 5, 1, 0, 30);
    sim.holdAt('anchor', sim.state.x, sim.state.y + 20, 20);
    expect(sim.state.throttle).toBe(0);
    expect(sim.state.engineOn).toBe(true);
    sim.advance(10);
    expect(sim.state.speed).toBe(0);
  });
});

describe('fuel', () => {
  it('burns 2 to 4 litres an hour at cruise, much less at idle, much more flat out', () => {
    const burn = (boat: BoatSpec, notch: number): number => {
      const sim = underEngine(boat, 0);
      const before = sim.fuel;
      sim.setThrottle(notch);
      sim.advance(600);
      return (before - sim.fuel) * 6;
    };
    for (const boat of Object.values(boats)) {
      const cruise = burn(boat, 3);
      expect(cruise).toBeGreaterThanOrEqual(2);
      expect(cruise).toBeLessThanOrEqual(4.01);
      expect(cruise).toBeCloseTo(boat.engine!.burnLph, 5);
      expect(burn(boat, 0)).toBeLessThan(cruise * 0.25);
      expect(burn(boat, 4)).toBeGreaterThan(cruise * 1.4);
    }
    expect(burn(boats.sloop30, 3)).toBeLessThan(burn(boats.sloop38, 3));
    expect(burn(boats.sloop38, 3)).toBeLessThan(burn(boats.perf45, 3));
  });

  it('a full tank is a good day and more of motoring', () => {
    for (const boat of Object.values(boats)) {
      const hours = boat.engine!.tankL / boat.engine!.burnLph;
      expect(hours).toBeGreaterThan(24);
      expect(hours).toBeLessThan(80);
    }
  });

  it('out of fuel she stops, slows down, and will not start again until she is filled', () => {
    const sim = motor(b38, 0, 3);
    sim.state.fuelUsed = b38.engine!.tankL - 0.01;
    sim.advance(30);
    expect(sim.state.engineOn).toBe(false);
    expect(sim.state.engineStops).toBe(1);
    expect(sim.fuel).toBe(0);
    expect(sim.out.underPower).toBe(false);
    sim.setHelm('hand');
    sim.advance(180);
    expect(sim.state.speed / KT).toBeLessThan(0.5);
    expect(sim.startEngine()).toBe('dry');
    sim.provision();
    expect(sim.fuel).toBe(b38.engine!.tankL);
    expect(sim.startEngine()).toBe('cranking');
  });
});

describe('battery', () => {
  it('a long day on the pilot barely dents it', () => {
    const sim = new Sim(b38, northWind(12), { headingDeg: -60, speedKt: 5 });
    sim.setCrewTrim(true);
    sim.setHelm('wind', 60 * D2R);
    sim.advance(3600);
    // An hour used; eight would be this many times over.
    const perHour = 1 - sim.battery;
    expect(perHour).toBeGreaterThan(0.005);
    expect(perHour * 8).toBeLessThan(0.2);
    for (const boat of Object.values(boats)) {
      // Hours on the pilot before it drops out.
      const hours = (boat.engine!.batteryAh * 0.9) / 4.8;
      expect(hours).toBeGreaterThan(30);
    }
  });

  it('steering by hand uses less than the pilot does', () => {
    const used = (pilot: boolean): number => {
      const sim = new Sim(b38, northWind(12), { headingDeg: -60, speedKt: 5 });
      if (pilot) sim.setHelm('wind', 60 * D2R);
      sim.advance(600);
      return sim.state.batteryUsed;
    };
    expect(used(true)).toBeGreaterThan(used(false) * 2);
    expect(used(false)).toBeGreaterThan(0);
  });

  it('the engine charges it, faster at cruising revs than at idle', () => {
    const charged = (notch: number): number => {
      const sim = underEngine(b38, 0);
      sim.state.batteryUsed = 150;
      sim.setThrottle(notch);
      sim.advance(1800);
      return 150 - sim.state.batteryUsed;
    };
    expect(charged(0)).toBeGreaterThan(5);
    expect(charged(3)).toBeGreaterThan(charged(0) * 1.5);
    expect(charged(3)).toBeLessThan(40);
    // Full stays full.
    const sim = motor(b38, 0, 3, 0, 600);
    expect(sim.battery).toBe(1);
  });

  it('too low, the pilot drops out; flat, the engine will not start', () => {
    const sim = new Sim(b38, northWind(12), { headingDeg: -60, speedKt: 5 });
    sim.setHelm('wind', 60 * D2R);
    sim.state.batteryUsed = b38.engine!.batteryAh * 0.9 - 0.002;
    sim.advance(1);
    expect(sim.state.helmMode).toBe('wind');
    sim.advance(5);
    expect(sim.state.helmMode).toBe('hand');
    expect(sim.state.batteryTrips).toBe(1);
    // There is still enough to start the engine, and with it running the pilot works again.
    expect(sim.startEngine()).toBe('cranking');
    sim.advance(CRANK_SECONDS + 0.1);
    sim.setHelm('wind', 60 * D2R);
    sim.advance(10);
    expect(sim.state.helmMode).toBe('wind');
    expect(sim.state.batteryTrips).toBe(1);

    const flat = new Sim(b38, northWind(12), { headingDeg: -60, speedKt: 5 });
    flat.state.batteryUsed = b38.engine!.batteryAh * 0.97;
    expect(flat.startEngine()).toBe('flat');
    flat.provision();
    expect(flat.startEngine()).toBe('cranking');
  });

  it('nothing is used while she lies at anchor', () => {
    const sim = new Sim(b38, northWind(10), { speedKt: 0 });
    sim.holdAt('anchor', 0, 30, 25);
    sim.advance(600);
    expect(sim.state.batteryUsed).toBe(0);
  });
});

describe('the pilot under power', () => {
  it('steers straight for a mark dead to windward instead of beating', () => {
    const sim = underEngine(b38, 12);
    sim.setThrottle(3);
    sim.setCrewTrim(true);
    sim.setRoute({ x: 0, y: 1500 });
    sim.advance(240);
    expect(sim.out.pilotBeating).toBe(false);
    expect(Math.abs(sim.state.x)).toBeLessThan(30);
    expect(sim.state.y).toBeGreaterThan(500);
    expect(sim.state.routeTurns).toBe(0);
  });
});

describe('determinism', () => {
  it('the same commands under power give the same track, and a snapshot resumes exactly', () => {
    const run = (): { sim: Sim; mid: SimState } => {
      const sim = new Sim(b38, northWind(14), { headingDeg: 20, speedKt: 2 });
      sim.startEngine();
      sim.advance(3);
      sim.setThrottle(3);
      sim.setControl('rudder', 6 * D2R);
      sim.advance(40);
      const mid = sim.snapshot();
      sim.setThrottle(-2);
      sim.setControl('rudder', -10 * D2R);
      sim.advance(30);
      sim.setThrottle(2);
      sim.setHelm('heading', 0);
      sim.advance(60);
      return { sim, mid };
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a.sim.state)).toBe(JSON.stringify(b.sim.state));

    const c = new Sim(b38, northWind(14), JSON.parse(JSON.stringify(a.mid)) as SimState);
    c.setThrottle(-2);
    c.setControl('rudder', -10 * D2R);
    c.advance(30);
    c.setThrottle(2);
    c.setHelm('heading', 0);
    c.advance(60);
    expect(c.state.x).toBe(a.sim.state.x);
    expect(c.state.y).toBe(a.sim.state.y);
    expect(c.state.heading).toBe(a.sim.state.heading);
    expect(c.state.fuelUsed).toBe(a.sim.state.fuelUsed);
  });
});
