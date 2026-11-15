import { describe, expect, it } from 'vitest';
import { Sim, D2R, R2D, KT, initialState } from '../src';
import { boat, northWind } from './helpers';
import { runScript, SCRIPT } from './script';

/** Sail at a true wind angle on the pilot with the crew trimming, with or without the spinnaker, until she settles. */
function run(twsKt: number, twaDeg: number, kite: boolean, seconds = 150): Sim {
  const sim = new Sim(boat, northWind(twsKt), { headingDeg: -twaDeg, speedKt: 6 });
  sim.setCrewTrim(true);
  sim.trimForWind();
  sim.setHelm('wind', twaDeg * D2R);
  if (kite) expect(sim.setSpinnaker(true)).toBe('set');
  sim.advance(seconds);
  return sim;
}
const gain = (twsKt: number, twaDeg: number) => run(twsKt, twaDeg, true).state.speed / run(twsKt, twaDeg, false).state.speed - 1;

describe('spinnaker', () => {
  it('adds the most on a broad reach, less dead downwind, and a little on a beam reach', () => {
    const beam = gain(12, 92);
    const broad = gain(12, 135);
    const run180 = gain(12, 176);
    expect(broad).toBeGreaterThan(0.12);
    expect(broad).toBeLessThan(0.22);
    expect(beam).toBeGreaterThan(0);
    expect(beam).toBeLessThan(0.07);
    expect(run180).toBeGreaterThan(0);
    expect(run180).toBeLessThan(broad / 2);
  });

  it('gains less as the wind rises and she nears her top speed', () => {
    expect(gain(20, 135)).toBeLessThan(gain(10, 135));
    expect(gain(20, 135)).toBeGreaterThan(0.05);
  });

  it('will not go up with the wind forward of the beam, and says why', () => {
    const sim = run(12, 60, false, 30);
    expect(sim.setSpinnaker(true)).toBe('forward');
    expect(sim.state.spin).toBe(false);
    expect(sim.spinnakerUp).toBe(false);
  });

  it('takes a few seconds to go up and to come down', () => {
    const sim = run(12, 135, false, 30);
    sim.setSpinnaker(true);
    sim.advance(2);
    expect(sim.state.spinHoist).toBeGreaterThan(0.2);
    expect(sim.state.spinHoist).toBeLessThan(0.6);
    sim.advance(4);
    expect(sim.state.spinHoist).toBe(1);
    expect(sim.setSpinnaker()).toBe('doused');
    sim.advance(5);
    expect(sim.state.spinHoist).toBe(0);
    expect(sim.spinnakerUp).toBe(false);
  });

  it('there is no tacking with it up: it has to come down first', () => {
    const sim = run(10, 95, true, 20);
    // Hardened up until the wind is forward of the beam, the spinnaker still set.
    sim.setHelm('wind', 80 * D2R);
    sim.advance(20);
    const heading = sim.state.heading;
    expect(sim.tack()).toBe('spinnaker');
    expect(sim.state.maneuver).toBeNull();
    expect(sim.state.heading).toBe(heading);
    sim.setSpinnaker(false);
    sim.advance(5);
    expect(sim.tack()).toBe('tack');
  });

  it('taken through the wind by hand it wraps round the forestay and does nothing until it is down', () => {
    const sim = run(9, 100, true, 20);
    sim.setCrewTrim(false);
    sim.setControl('rudder', 25 * D2R);
    for (let i = 0; i < 60 && !sim.state.spinWrapped; i++) sim.advance(0.5);
    expect(sim.state.spinWrapped).toBe(true);
    expect(sim.out.spin.flogging).toBe(true);
    sim.setSpinnaker(false);
    sim.advance(5);
    expect(sim.state.spinWrapped).toBe(false);
  });

  it('carried too close to the wind in a breeze it lays her over and she broaches', () => {
    const sim = run(18, 110, true, 60);
    expect(sim.state.broaches).toBe(0);
    sim.setHelm('wind', 75 * D2R);
    let maxHeel = 0;
    let pinned = 0;
    for (let i = 0; i < 240; i++) {
      sim.advance(0.25);
      maxHeel = Math.max(maxHeel, Math.abs(sim.state.heel) * R2D);
      if (sim.out.knockedDown) pinned += 0.25;
    }
    expect(sim.state.broaches).toBeGreaterThanOrEqual(1);
    expect(sim.state.knockdowns).toBe(sim.state.broaches);
    expect(maxHeel).toBeGreaterThan(60);
    expect(pinned).toBeGreaterThan(2);
  });

  it('in too much wind it broaches her even on a broad reach, and in a little less it does not', () => {
    expect(run(26, 140, true, 60).state.broaches).toBeGreaterThanOrEqual(1);
    const ok = run(19, 140, true, 120);
    expect(ok.state.broaches).toBe(0);
    expect(Math.abs(ok.state.heel) * R2D).toBeLessThan(20);
  });

  it('after a broach it can be got down, and she sails on', () => {
    const sim = run(26, 140, true, 30);
    expect(sim.state.broaches).toBeGreaterThanOrEqual(1);
    const before = sim.state.broaches;
    sim.setSpinnaker(false);
    sim.setHelm('wind', 140 * D2R);
    sim.setCrewTrim(true);
    sim.advance(90);
    expect(sim.state.spinHoist).toBe(0);
    expect(sim.state.broaches).toBe(before);
    expect(sim.out.knockedDown).toBe(false);
    expect(sim.state.speed / KT).toBeGreaterThan(5);
  });

  it('letting the sheet fly takes the load off', () => {
    const sim = run(15, 100, true, 40);
    const loaded = sim.out.spin.loadKg;
    sim.setCrewTrim(false);
    sim.setControl('spinsheet', 88 * D2R);
    sim.advance(3);
    expect(sim.out.spin.flogging).toBe(true);
    expect(sim.out.spin.loadKg).toBeLessThan(loaded * 0.2);
  });

  it('a gybe with the crew handling it collapses the sail for a moment and it fills again', () => {
    const sim = run(12, 150, true, 40);
    const speed = sim.state.speed;
    expect(sim.tack()).toBe('gybe');
    let collapsed = 0;
    for (let i = 0; i < 240; i++) {
      sim.advance(0.25);
      if (sim.out.spin.flogging) collapsed += 0.25;
    }
    expect(collapsed).toBeGreaterThan(1.5);
    expect(collapsed).toBeLessThan(12);
    expect(sim.state.spinWrapped).toBe(false);
    expect(sim.state.broaches).toBe(0);
    expect(sim.out.twa).toBeLessThan(0);
    expect(sim.out.spin.flogging).toBe(false);
    expect(Math.sign(sim.state.spinAngle)).toBe(1);
    expect(sim.state.speed).toBeGreaterThan(speed * 0.9);
  });

  it('a wild gybe by hand wraps it in a moderate breeze and broaches her in a fresh one', () => {
    const wild = (twsKt: number) => {
      const sim = run(twsKt, 155, true, 40);
      sim.setCrewTrim(false);
      sim.setControl('mainsheet', 20 * D2R);
      sim.setControl('rudder', -28 * D2R);
      const side = sim.state.mainSide;
      for (let i = 0; i < 80 && sim.state.mainSide === side; i++) sim.advance(0.25);
      sim.setControl('rudder', 0);
      sim.advance(2);
      return sim;
    };
    const moderate = wild(13);
    expect(moderate.state.spinWrapped).toBe(true);
    expect(moderate.state.broaches).toBe(0);
    const fresh = wild(20);
    expect(fresh.state.broaches).toBe(1);
  });

  it('never set, nothing about the boat changes: the reference sail is the same with and without the spinnaker in the boat file', () => {
    const { track } = runScript(SCRIPT);
    const bare = { ...boat, sails: { main: boat.sails.main, jib: boat.sails.jib } };
    const sim = new Sim(bare, northWind(SCRIPT.windKt), { headingDeg: SCRIPT.headingDeg, speedKt: SCRIPT.speedKt });
    expect(sim.setSpinnaker(true)).toBe('none');
    expect(track.every((p) => Number.isFinite(p.x))).toBe(true);
    const a = run(14, 120, false, 60);
    const b = new Sim(bare, northWind(14), { headingDeg: -120, speedKt: 6 });
    b.setCrewTrim(true);
    b.trimForWind();
    b.setHelm('wind', 120 * D2R);
    b.advance(60);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it('is deterministic, and a saved state carries on exactly', () => {
    const script = (sim: Sim) => {
      sim.advance(20);
      sim.setSpinnaker(true);
      sim.advance(30);
      sim.tack();
      sim.advance(40);
    };
    const a = run(13, 145, false, 10);
    const b = run(13, 145, false, 10);
    script(a);
    script(b);
    expect(a.snapshot()).toEqual(b.snapshot());
    const saved = JSON.parse(JSON.stringify(a.snapshot()));
    const c = new Sim(boat, northWind(13), saved);
    a.advance(30);
    c.advance(30);
    expect(c.snapshot()).toEqual(a.snapshot());
    expect(a.state.spinHoist).toBe(1);
  });

  it('a state saved before there was a spinnaker loads with it in its bag', () => {
    const old = initialState({ headingDeg: 200, speedKt: 5 }) as unknown as Record<string, unknown>;
    for (const key of ['spin', 'spinHoist', 'spinSheet', 'spinAngle', 'spinCollapse', 'spinWrapped', 'spinWraps', 'broaches', 'gustTime', 'gustEase']) delete old[key];
    const sim = new Sim(boat, northWind(12), { headingDeg: 0 });
    sim.restore(old as never);
    expect(sim.state.spin).toBe(false);
    expect(sim.state.spinHoist).toBe(0);
    expect(sim.state.broaches).toBe(0);
    sim.advance(10);
    expect(Number.isFinite(sim.state.speed)).toBe(true);
    expect(sim.setSpinnaker(true)).toBe('set');
  });
});
