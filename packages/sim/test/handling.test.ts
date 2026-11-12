import { describe, expect, it } from 'vitest';
import { Sim, D2R, R2D, KT } from '../src';
import { boat, northWind, settle } from './helpers';

function closeHauled(tws = 12, twaDeg = 45): Sim {
  const s = settle(tws, twaDeg, { seconds: 120 }).sim;
  s.state.crewTrim = false;
  return s;
}

describe('trim', () => {
  it('an eased main luffs and the boat slows', () => {
    const sim = closeHauled();
    const before = sim.state.speed;
    sim.setControl('mainsheet', 60 * D2R);
    sim.advance(60);
    expect(sim.out.main.flogging).toBe(true);
    expect(sim.out.main.luff).toBe(1);
    expect(sim.state.speed).toBeLessThan(before * 0.75);
  });

  it('an over-sheeted main on a reach is slower and heels the boat more', () => {
    const sim = settle(14, 90, { seconds: 120 }).sim;
    sim.state.crewTrim = false;
    const speed = sim.state.speed;
    const heel = Math.abs(sim.state.heel);
    sim.setControl('mainsheet', 5 * D2R);
    sim.advance(60);
    expect(sim.out.main.stall).toBeGreaterThan(0.3);
    expect(sim.state.speed).toBeLessThan(speed * 0.95);
    expect(Math.abs(sim.state.heel)).toBeGreaterThan(heel);
  });

  it('the boom goes only as far as the wind takes it', () => {
    const sim = closeHauled();
    sim.setControl('mainsheet', 80 * D2R);
    sim.advance(5);
    expect(Math.abs(sim.state.boomAngle)).toBeLessThan(Math.abs(sim.out.awa) + 1e-9);
    expect(Math.abs(sim.state.boomAngle)).toBeLessThan(60 * D2R);
  });

  it('sails sit to leeward', () => {
    const stbdTack = settle(12, 60, { seconds: 30 }).sim; // wind on the starboard side
    expect(stbdTack.state.boomAngle).toBeLessThan(0);
    expect(stbdTack.state.jibAngle).toBeLessThan(0);
    expect(stbdTack.state.heel).toBeLessThan(0);
    const portTack = settle(12, -60, { seconds: 30 }).sim;
    expect(portTack.state.boomAngle).toBeGreaterThan(0);
    expect(portTack.state.jibAngle).toBeGreaterThan(0);
    expect(portTack.state.heel).toBeGreaterThan(0);
  });

  it('easing the main in a blow stands the boat up', () => {
    const sim = settle(22, 45, { seconds: 120 }).sim;
    sim.state.crewTrim = false;
    const heel = Math.abs(sim.state.heel);
    sim.nudgeControl('mainsheet', 25 * D2R);
    sim.advance(10);
    expect(Math.abs(sim.state.heel)).toBeLessThan(heel - 5 * D2R);
  });
});

describe('helm', () => {
  it('the wheel holds where it is left and the boat keeps turning', () => {
    const sim = settle(12, 90, { seconds: 60 }).sim;
    sim.state.crewTrim = false;
    sim.setControl('rudder', 10 * D2R);
    const h0 = sim.state.heading;
    sim.advance(3);
    expect(sim.state.rudder).toBeCloseTo(10 * D2R, 6);
    expect(sim.state.helmMode).toBe('hand');
    expect(sim.state.yawRate).toBeGreaterThan(2 * D2R);
    expect(sim.state.heading).not.toBe(h0);
  });

  it('turning costs speed', () => {
    const sim = settle(12, 90, { seconds: 60 }).sim;
    const a = new Sim(boat, sim.env, sim.snapshot());
    a.advance(4);
    sim.setHelm('hand', 0);
    sim.state.crewTrim = true;
    for (let i = 0; i < 4; i++) { sim.setControl('rudder', (i % 2 ? -30 : 30) * D2R); sim.advance(1); }
    expect(sim.state.speed).toBeLessThan(a.state.speed * 0.97);
  });

  it('the pilot holds a heading against weather helm', () => {
    const sim = settle(16, 50, { seconds: 60 }).sim;
    const target = sim.state.heading;
    sim.setHelm('heading', target);
    sim.advance(120);
    expect(Math.abs(sim.state.heading - target) * R2D).toBeLessThan(1.5);
  });

  it('heel gives weather helm that needs rudder to hold', () => {
    const sim = settle(18, 50, { seconds: 120 }).sim;
    // Wind is to starboard, so the boat wants to turn to starboard and the rudder holds it off to port.
    expect(sim.out.weatherHelm).toBeGreaterThan(0);
    expect(sim.state.rudder).toBeLessThan(-0.5 * D2R);
  });

  it('overpowered with the helm centred, the boat rounds up into the wind', () => {
    const sim = settle(30, 60, { seconds: 5 }).sim;
    sim.state.crewTrim = false;
    sim.setHelm('hand', 0);
    const twa0 = Math.abs(sim.out.twa);
    sim.advance(15);
    expect(Math.abs(sim.out.twa)).toBeLessThan(twa0 - 15 * D2R);
  });
});

describe('tacking', () => {
  it('steering through the wind without touching the sheets leaves the jib aback', () => {
    const sim = closeHauled(12, 45);
    sim.setControl('rudder', 25 * D2R); // wind is to starboard, so this turns up through it
    for (let i = 0; i < 20 && sim.out.twa > -20 * D2R; i++) sim.advance(1);
    sim.setControl('rudder', 0);
    sim.advance(1);
    expect(sim.out.twa).toBeLessThan(0);
    expect(sim.out.jib.backed).toBeGreaterThan(0.5);
    expect(sim.loadedJibSheet()).toBe('jibsheet_port');
    expect(sim.workingJibSheet()).toBe('jibsheet_stbd');
  });

  it('releasing the old sheet and trimming the new one fills the jib on the new tack', () => {
    const sim = closeHauled(12, 45);
    sim.setControl('rudder', 25 * D2R);
    for (let i = 0; i < 20 && sim.out.twa > -40 * D2R; i++) sim.advance(1);
    sim.setControl('rudder', 0);
    sim.setControl('jibsheet_port', 80 * D2R);
    sim.setControl('jibsheet_stbd', 2 * D2R);
    sim.advance(3);
    expect(sim.out.jib.backed).toBe(0);
    expect(sim.state.jibAngle).toBeGreaterThan(0);
  });

  it('T tacks to the mirror angle, the crew swaps the sheets, and speed comes back', () => {
    const sim = closeHauled(12, 45);
    const before = sim.state.speed;
    expect(sim.tack()).toBe('tack');
    let slowest = before;
    for (let i = 0; i < 40 && sim.state.maneuver; i++) { sim.advance(0.5); slowest = Math.min(slowest, sim.state.speed); }
    expect(sim.state.maneuver).toBeNull();
    expect(sim.state.t).toBeLessThan(120 + 20);
    expect(sim.out.twa * R2D).toBeLessThan(-38);
    expect(sim.out.twa * R2D).toBeGreaterThan(-52);
    expect(sim.out.jib.backed).toBe(0);
    expect(sim.state.helmMode).toBe('wind');
    expect(slowest).toBeGreaterThan(before * 0.35);
    expect(slowest).toBeLessThan(before * 0.9);
    sim.advance(60);
    expect(sim.state.speed).toBeGreaterThan(before * 0.95);
  });

  it('T gybes when the wind is aft of the beam', () => {
    const sim = settle(12, 150, { seconds: 60 }).sim;
    expect(sim.tack()).toBe('gybe');
    for (let i = 0; i < 60 && sim.state.maneuver; i++) sim.advance(0.5);
    expect(sim.state.maneuver).toBeNull();
    expect(sim.out.twa * R2D).toBeCloseTo(-150, -1);
    expect(sim.state.boomAngle).toBeGreaterThan(0);
  });

  it('a hand on the wheel cancels the manoeuvre', () => {
    const sim = closeHauled();
    sim.tack();
    sim.advance(1);
    sim.setControl('rudder', 0);
    expect(sim.state.maneuver).toBeNull();
    expect(sim.state.helmMode).toBe('hand');
  });
});

describe('irons', () => {
  it('head to wind the boat loses her way, then the bow blows off and she sails again', () => {
    // Wind fine on the starboard bow, sheets set for that tack, wheel left alone.
    const sim = new Sim(boat, northWind(12), { headingDeg: 358, speedKt: 3 });
    sim.setControl('mainsheet', 10 * D2R);
    sim.setControl('jibsheet_port', 3 * D2R);
    let slowest = Infinity;
    let wasInIrons = false;
    for (let i = 0; i < 150; i++) {
      sim.advance(1);
      slowest = Math.min(slowest, sim.state.speed / KT);
      wasInIrons ||= sim.out.inIrons;
    }
    expect(slowest).toBeLessThan(2);
    expect(wasInIrons).toBe(true);
    // Left alone with the sheets hard in she ends up pinching, slow but sailing.
    expect(sim.out.twa * R2D).toBeGreaterThan(25);
    expect(sim.state.speed / KT).toBeGreaterThan(2);
    expect(sim.out.inIrons).toBe(false);
  });

  it('caught aback, the jib pushes the bow through and the boat lies quietly off the wind', () => {
    // Wind fine on the port bow with the port sheet still made fast.
    const sim = new Sim(boat, northWind(12), { headingDeg: 2, speedKt: 3 });
    sim.setControl('mainsheet', 10 * D2R);
    sim.setControl('jibsheet_port', 3 * D2R);
    sim.advance(6);
    expect(sim.out.jib.backed).toBeGreaterThan(0.5);
    sim.advance(180);
    const twa = Math.abs(sim.out.twa) * R2D;
    expect(twa).toBeGreaterThan(40);
    expect(twa).toBeLessThan(140);
    expect(Math.abs(sim.state.yawRate) * R2D).toBeLessThan(1);
  });

  it('no wind, no movement', () => {
    const sim = new Sim(boat, northWind(0), { headingDeg: 90, speedKt: 0 });
    sim.advance(30);
    expect(sim.state.speed).toBe(0);
    expect(Math.hypot(sim.state.x, sim.state.y)).toBeLessThan(0.01);
  });
});

describe('current', () => {
  it('the water carries the boat: speed over ground differs from speed through water', () => {
    const KTms = KT;
    const env = { sample: () => ({ windDir: 0, windSpeed: 12 * KTms, currentX: 2 * KTms, currentY: 0 }) };
    const sim = new Sim(boat, env, { headingDeg: 90, speedKt: 6 });
    sim.state.crewTrim = true;
    sim.trimForWind();
    sim.setHelm('heading');
    sim.advance(120);
    expect(sim.out.sog).toBeGreaterThan(sim.state.speed + 1.5 * KTms);
  });
});

describe('depth', () => {
  // A beach to the east: 20 m deep at x = 0, shoaling to nothing at x = 200.
  const beach = { sample: (x: number) => ({ windDir: 0, windSpeed: 12 * KT, currentX: 0, currentY: 0, depth: Math.max(0, 20 - x / 10) }) };

  it('reports water under the keel', () => {
    const sim = new Sim(boat, beach, { headingDeg: 90, speedKt: 5 });
    sim.step();
    expect(sim.out.underKeel).toBeCloseTo(20 - boat.dimensions.draft, 0);
    expect(sim.out.aground).toBe(false);
  });

  it('touching bottom stops the boat before the beach', () => {
    const sim = new Sim(boat, beach, { headingDeg: 90, speedKt: 5 });
    sim.state.crewTrim = true;
    sim.trimForWind();
    sim.setHelm('heading');
    sim.advance(180);
    expect(sim.out.aground).toBe(true);
    expect(sim.state.speed / KT).toBeLessThan(0.2);
    // Draft is 2 m, so she stops where the water is about 2 m deep: x of about 180.
    expect(sim.state.x).toBeGreaterThan(165);
    expect(sim.state.x).toBeLessThan(182);
  });

  it('she can sail off again toward deeper water', () => {
    const sim = new Sim(boat, beach, { headingDeg: 90, speedKt: 5 });
    sim.state.crewTrim = true;
    sim.trimForWind();
    sim.setHelm('heading');
    sim.advance(180);
    sim.setHelm('heading', 270 * D2R);
    // Aground she has no steerage, so point her by hand as a crew would with the engine or a kedge.
    sim.state.heading = 270 * D2R;
    sim.advance(120);
    expect(sim.out.aground).toBe(false);
    expect(sim.state.x).toBeLessThan(100);
  });

  it('open water of unknown depth never grounds', () => {
    const sim = new Sim(boat, northWind(12), { headingDeg: 90, speedKt: 5 });
    sim.advance(10);
    expect(sim.out.underKeel).toBeNull();
    expect(sim.out.aground).toBe(false);
  });
});
