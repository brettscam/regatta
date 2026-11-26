import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Sim, D2R, R2D, KT, CRANK_SECONDS, US_GALLON, comfortSpeed, fitOut, leverBurn, leverFor, leverRpm, leverSpeed, milesPerLitre, rangeNm, topSpeed, wrapPi,
  type BoatFile, type BoatSpec, type Environment, type SeaSample,
} from '../src';

// The 22 ft centre console: a planing hull with an outboard and no sails. Her figures are pinned here: how she gets
// onto the plane, what she makes and burns, how she turns, what a sea does to her, and that nothing made for a
// sailing boat can hurt her. Winds are from due north unless a test says otherwise.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../boats');
const file = JSON.parse(readFileSync(resolve(dir, 'console22.json'), 'utf8')) as BoatFile;
const boat = fitOut(file);
const p = boat.power!;
const sloop = JSON.parse(readFileSync(resolve(dir, 'sloop38.json'), 'utf8')) as BoatSpec;

interface World { windKt?: number; sea?: SeaSample; depth?: (x: number, y: number) => number; currentY?: number }
const world = (w: World = {}): Environment => ({
  sample: (x, y) => ({ windDir: 0, windSpeed: (w.windKt ?? 0) * KT, currentX: 0, currentY: w.currentY ?? 0, depth: w.depth?.(x, y) }),
  sea: w.sea ? () => w.sea : undefined,
});
const chop = (height: number, length: number, fromDeg = 0): SeaSample => ({ height, length, dir: fromDeg * D2R, steepness: height / length });

/** Lying stopped with the engine running in neutral. */
function started(w: World = {}, headingDeg = 0): Sim {
  const sim = new Sim(file, world(w), { headingDeg, speedKt: 0 });
  expect(sim.startEngine()).toBe('cranking');
  sim.advance(CRANK_SECONDS + 0.1);
  expect(sim.state.engineOn).toBe(true);
  return sim;
}

/** Run on a heading under the pilot at a lever position, and say what she averaged over the second half. */
function run(w: World, lever: number, headingDeg = 0, seconds = 120): { sim: Sim; kt: number } {
  const sim = started(w, headingDeg);
  sim.setHelm('heading', headingDeg * D2R);
  expect(sim.setThrottle(lever)).toBe('ok');
  let sum = 0;
  let n = 0;
  const steps = seconds * 60;
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (i >= steps / 2) { sum += sim.state.speed; n++; }
  }
  return { sim, kt: sum / n / KT };
}

describe('the boat file', () => {
  it('has a power block and no rig, and is completed with bare poles', () => {
    expect(file.sails).toBeUndefined();
    expect(file.polar).toBeUndefined();
    expect(file.heel).toBeUndefined();
    expect(boat.sails.main.areaM2).toBe(0);
    expect(boat.sails.jib.areaM2).toBe(0);
    expect(boat.sails.main.reefs.length).toBe(1);
    expect(boat.sails.spinnaker).toBeUndefined();
    expect(boat.dimensions.mastHeight).toBe(0);
    // What the chart plans a passage with: her cruising speed whatever the wind.
    expect(boat.polar.speeds.flat().every((kt) => kt === p.cruiseKt)).toBe(true);
  });

  it('a sailing boat comes through fitOut untouched: the very same object', () => {
    expect(fitOut(sloop)).toBe(sloop);
    expect(new Sim(sloop, world({ windKt: 10 })).boat).toBe(sloop);
  });

  it('is a 22 footer drawing 0.4 m with a 250 litre tank', () => {
    expect(boat.dimensions.loa * 3.28084).toBeGreaterThan(21.5);
    expect(boat.dimensions.loa * 3.28084).toBeLessThan(22.5);
    expect(boat.dimensions.draft).toBeCloseTo(0.4, 2);
    expect(boat.engine!.tankL / US_GALLON).toBeGreaterThan(60);
    expect(boat.engine!.tankL / US_GALLON).toBeLessThan(70);
  });
});

describe('speed by throttle', () => {
  it('idles in gear at walking pace, cruises at 24 to 28 kt and tops out at 38 to 40', () => {
    expect(run({}, p.leverStep, 0, 40).kt).toBeGreaterThan(2);
    expect(run({}, p.leverStep, 0, 40).kt).toBeLessThan(3.5);
    const cruise = leverFor(p, 26);
    expect(run({}, cruise).kt).toBeGreaterThan(24);
    expect(run({}, cruise).kt).toBeLessThan(28);
    const flat = run({}, 4).kt;
    expect(flat).toBeGreaterThan(38);
    expect(flat).toBeLessThan(40);
    expect(topSpeed(p) / KT).toBeCloseTo(39.5, 1);
  });

  it('every step of the lever is faster than the one before, and the sim holds what the table says', () => {
    let last = 0;
    for (let lever = p.leverStep; lever <= 4; lever += p.leverStep) {
      const said = leverSpeed(p, lever) / KT;
      expect(said).toBeGreaterThan(last);
      last = said;
    }
    for (const lever of [1, 2.5, 3.5]) expect(run({}, lever, 0, 60).kt).toBeCloseTo(leverSpeed(p, lever) / KT, 0);
  });

  it('the lever snaps to its steps and stops at wide open and full astern', () => {
    const sim = started();
    sim.setThrottle(1.1);
    expect(sim.state.throttle).toBe(1);
    sim.setThrottle(1.4);
    expect(sim.state.throttle).toBe(1.5);
    sim.setThrottle(9);
    expect(sim.state.throttle).toBe(4);
    sim.setThrottle(-9);
    expect(sim.state.throttle).toBe(-2);
    expect(leverRpm(p, 4)).toBe(5800);
    expect(leverRpm(p, 0)).toBe(p.idleRpm);
  });

  it('goes astern slowly', () => {
    const { sim, kt } = run({}, -2, 0, 40);
    expect(kt).toBeLessThan(-3);
    expect(kt).toBeGreaterThan(-6);
    expect(sim.state.y).toBeLessThan(-20);
  });

  it('out of gear she stops, and with the engine off the lever does nothing', () => {
    const { sim } = run({}, 3, 0, 30);
    sim.setThrottle(0);
    sim.advance(30);
    expect(Math.abs(sim.state.speed) / KT).toBeLessThan(0.3);
    sim.stopEngine();
    expect(sim.setThrottle(3)).toBe('off');
    expect(sim.out.engineRpm).toBe(0);
  });
});

describe('getting onto the plane', () => {
  /** Seconds from rest, lever wide open, to each speed in knots; and the most her bow rose on the way. */
  function climb(marks: number[]): { at: number[]; bowUpDeg: number } {
    const sim = started();
    sim.setThrottle(4);
    const at: number[] = [];
    let bowUp = 0;
    for (let i = 0; i < 60 * 60 && at.length < marks.length; i++) {
      sim.step();
      bowUp = Math.max(bowUp, sim.out.trim * R2D);
      if (sim.state.speed / KT >= marks[at.length]) at.push(i / 60);
    }
    return { at, bowUpDeg: bowUp };
  }

  it('is planing in three to seven seconds flat out and doing 30 kt inside thirteen', () => {
    const { at } = climb([15, 30]);
    expect(at[0]).toBeGreaterThan(3);
    expect(at[0]).toBeLessThan(7);
    expect(at[1]).toBeGreaterThan(7);
    expect(at[1]).toBeLessThan(13);
  });

  it('puts her bow up on the hump and settles level on the plane', () => {
    const { bowUpDeg } = climb([30]);
    expect(bowUpDeg).toBeGreaterThan(6);
    const cruising = run({}, leverFor(p, 26)).sim;
    expect(cruising.out.trim * R2D).toBeGreaterThan(2);
    expect(cruising.out.trim * R2D).toBeLessThan(4.5);
    expect(cruising.out.plane).toBe(1);
    expect(run({}, 1, 0, 40).sim.out.plane).toBe(0);
  });

  it('hangs on the hump: with just enough throttle to plane, the speed lags the lever', () => {
    const lever = leverFor(p, 16);
    const sim = started();
    sim.setThrottle(lever);
    sim.advance(4);
    // Four seconds in she is still ploughing, well short of where this throttle ends up.
    expect(sim.state.speed / KT).toBeLessThan(11.5);
    sim.advance(40);
    expect(sim.state.speed / KT).toBeGreaterThan(15.5);
  });
});

describe('steering like an outboard', () => {
  const turn = (lever: number, wheelDeg: number, settle = 40, seconds = 6) => {
    const sim = run({}, lever, 0, settle).sim;
    const before = sim.state.speed;
    sim.setControl('rudder', wheelDeg * D2R);
    let yaw = 0;
    let heel = 0;
    for (let i = 0; i < seconds * 60; i++) {
      sim.step();
      if (Math.abs(sim.state.yawRate) > Math.abs(yaw)) yaw = sim.state.yawRate;
      if (Math.abs(sim.state.heel) > Math.abs(heel)) heel = sim.state.heel;
    }
    return { sim, yawDegS: yaw * R2D, heelDeg: heel * R2D, kept: sim.state.speed / before };
  };

  it('banks INTO the turn: wheel to starboard, she turns to starboard and leans to starboard', () => {
    const stbd = turn(leverFor(p, 26), 30);
    expect(stbd.yawDegS).toBeGreaterThan(15);
    expect(stbd.heelDeg).toBeGreaterThan(12);
    const port = turn(leverFor(p, 26), -30);
    expect(port.yawDegS).toBeLessThan(-15);
    expect(port.heelDeg).toBeLessThan(-12);
    expect(Math.abs(stbd.heelDeg)).toBeLessThanOrEqual(p.steer.bankMaxDeg + 0.01);
  });

  it('loses speed in a hard turn and little in a gentle one', () => {
    expect(turn(leverFor(p, 26), 30).kept).toBeLessThan(0.85);
    expect(turn(leverFor(p, 26), 4).kept).toBeGreaterThan(0.97);
  });

  it('turns faster as she gathers way, up to a point, and slower again flat out', () => {
    const rate = (lever: number) => {
      const sim = run({}, lever, 0, 40).sim;
      sim.setControl('rudder', 30 * D2R);
      sim.advance(1.2);
      return sim.state.yawRate * R2D;
    };
    const idle = rate(p.leverStep);
    const slow = rate(1);
    const flat = rate(4);
    expect(slow).toBeGreaterThan(idle);
    expect(flat).toBeLessThan(slow);
    expect(flat).toBeGreaterThan(8);
  });

  it('has little steerage in neutral, and plenty at the same speed in gear', () => {
    const coasting = run({}, 1, 0, 30).sim;
    coasting.setThrottle(0);
    coasting.advance(3);
    const speed = coasting.state.speed;
    expect(speed / KT).toBeGreaterThan(2);
    coasting.setControl('rudder', 30 * D2R);
    coasting.advance(1.5);
    const adrift = Math.abs(coasting.state.yawRate) * R2D;
    const driving = run({}, leverFor(p, speed / KT), 0, 30).sim;
    driving.setControl('rudder', 30 * D2R);
    driving.advance(1.5);
    expect(adrift).toBeLessThan(6);
    expect(Math.abs(driving.state.yawRate) * R2D).toBeGreaterThan(adrift * 3);
  });

  it('turns where she lies with the engine in gear at idle, by its thrust alone', () => {
    const sim = started();
    sim.setControl('rudder', 30 * D2R);
    sim.advance(3);
    expect(Math.abs(sim.state.yawRate)).toBeLessThan(0.01);
    sim.setThrottle(p.leverStep);
    sim.advance(1);
    expect(sim.state.yawRate * R2D).toBeGreaterThan(3);
  });

  it('astern, the wheel takes her stern the way it is turned', () => {
    const sim = started();
    sim.setThrottle(-1);
    sim.setControl('rudder', 20 * D2R);
    sim.advance(6);
    expect(sim.state.speed).toBeLessThan(0);
    // Stern to starboard is head to port.
    expect(wrapPi(sim.state.heading)).toBeLessThan(-0.1);
  });
});

describe('the sea decides how fast she can go', () => {
  const head = (sea: SeaSample) => comfortSpeed(boat, sea, 0) / KT;

  it('flat calm 35 and more, a half metre chop about 25, a one metre chop 15 to 18 into it', () => {
    expect(comfortSpeed(boat, null, 0) / KT).toBeGreaterThan(35);
    expect(head(chop(0.2, 4))).toBeGreaterThan(35);
    expect(head(chop(0.5, 10))).toBeGreaterThan(23);
    expect(head(chop(0.5, 10))).toBeLessThan(29);
    expect(head(chop(1, 20))).toBeGreaterThan(15);
    expect(head(chop(1, 20))).toBeLessThan(18);
  });

  it('the same sea is easier on the bow than dead ahead, easier again abeam, and no limit astern', () => {
    const sea = chop(1, 20);
    expect(comfortSpeed(boat, sea, 45 * D2R)).toBeGreaterThan(comfortSpeed(boat, sea, 0) * 1.25);
    // Abeam she still runs onto the shoulders of a steep sea: faster than into it, but not flat out.
    expect(comfortSpeed(boat, sea, 90 * D2R)).toBeGreaterThan(comfortSpeed(boat, sea, 45 * D2R) * 1.2);
    expect(comfortSpeed(boat, sea, 90 * D2R) / KT).toBeLessThan(34);
    expect(comfortSpeed(boat, sea, 180 * D2R) / KT).toBeGreaterThan(35);
    // The easy afternoon sea of the channel leaves her nearly free abeam.
    expect(comfortSpeed(boat, chop(0.65, 23), 90 * D2R) / KT).toBeGreaterThan(34);
  });

  it('higher is slower all the way up: 25, 20, 17, 12 and under 10 kt for half a metre to two', () => {
    const table = [0.5, 0.65, 0.75, 1, 1.5, 2].map((h) => head(chop(h, h * 20)));
    for (let i = 1; i < table.length; i++) expect(table[i], `row ${i}`).toBeLessThan(table[i - 1]);
    expect(table[1]).toBeGreaterThan(18);
    expect(table[1]).toBeLessThan(23);
    expect(table[4]).toBeGreaterThan(10);
    expect(table[4]).toBeLessThan(14);
    expect(table[5]).toBeLessThan(10.5);
    expect(table[5]).toBeGreaterThan(7);
  });

  it('a steeper sea of the same height is harder, and a long swell of the same height is no trouble at all', () => {
    expect(head(chop(1, 14))).toBeLessThan(head(chop(1, 20)) - 1);
    // A wind sea is met by its steep faces, whatever its average: the channel's 1 m at 35 m is no kinder than 1 m at 20.
    expect(head(chop(1, 35))).toBeCloseTo(head(chop(1, 20)), 6);
    expect(head(chop(1, 200))).toBeGreaterThan(35);
    expect(head(chop(0.8, 225))).toBeCloseTo(topSpeed(p) / KT, 6);
  });

  it('at her comfortable speed she does not slam, and is not hurt', () => {
    for (const sea of [chop(0.5, 10), chop(1, 20), chop(1.5, 30)]) {
      let lever = p.leverStep;
      while (lever < 4 && leverSpeed(p, lever + p.leverStep) <= comfortSpeed(boat, sea, 0)) lever += p.leverStep;
      const { sim } = run({ sea }, lever, 0, 300);
      expect(sim.state.slams, `${sea.height} m`).toBeLessThanOrEqual(2);
      expect(sim.state.damage).toBe(0);
    }
  });

  it('driven flat out into a one metre chop she slams on most waves, is knocked back well short of her top speed, and breaks', () => {
    const { sim, kt } = run({ sea: chop(1, 20) }, 4, 0, 600);
    expect(sim.state.slams).toBeGreaterThan(200);
    expect(kt).toBeLessThan(28);
    expect(kt).toBeGreaterThan(comfortSpeed(boat, chop(1, 20), 0) / KT);
    // About one per cent of her hull a minute.
    expect(sim.state.damage).toBeGreaterThan(0.04);
    expect(sim.state.damage).toBeLessThan(0.3);
    expect(sim.out.comfort / KT).toBeCloseTo(16.5, 0);
  });

  it('the damage threshold: slams below it cost speed and nothing else', () => {
    // Just over her comfortable speed in the afternoon chop she lands hard now and then and comes to no harm.
    const sea = chop(0.65, 23);
    const { sim } = run({ sea }, leverFor(p, comfortSpeed(boat, sea, 0) / KT + 2), 0, 600);
    expect(sim.state.slams).toBeGreaterThan(5);
    expect(sim.state.damage).toBe(0);
    // No single landing takes more than the cap, however hard.
    const wild = run({ sea: chop(1.2, 15) }, 4, 0, 10).sim;
    expect(wild.state.damage).toBeLessThanOrEqual(wild.state.slams * p.sea.damageCap + 1e-9);
  });

  it('down sea she runs fast without slamming, but in a steep one she buries her bow now and then', () => {
    const easy = run({ sea: chop(0.65, 23) }, 4, 180, 300);
    expect(easy.kt).toBeGreaterThan(38);
    expect(easy.sim.state.slams).toBe(0);
    expect(easy.sim.state.stuffs).toBe(0);
    const steep = run({ sea: chop(1, 20) }, 4, 180, 600);
    expect(steep.sim.state.slams).toBe(0);
    expect(steep.sim.state.stuffs).toBeGreaterThan(3);
    expect(steep.kt).toBeGreaterThan(30);
    // At a sensible speed, no faster than the waves by much, she does not.
    expect(run({ sea: chop(1, 20) }, leverFor(p, 16), 180, 600).sim.state.stuffs).toBe(0);
  });

  it('a beam sea rolls her, more lying stopped than running', () => {
    const roll = (lever: number) => {
      const sim = started({ sea: chop(0.8, 16, 90) });
      if (lever) { sim.setHelm('heading', 0); sim.setThrottle(lever); }
      let most = 0;
      for (let i = 0; i < 60 * 60; i++) { sim.step(); if (i > 1200) most = Math.max(most, Math.abs(sim.state.heel)); }
      return most * R2D;
    };
    const stopped = roll(0);
    expect(stopped).toBeGreaterThan(3);
    expect(stopped).toBeLessThan(15);
    expect(roll(leverFor(p, 26))).toBeLessThan(stopped * 0.7);
  });

  it('wind has only a small effect: twenty knots on the nose costs a knot or two', () => {
    const calm = run({}, leverFor(p, 26)).kt;
    const blowing = run({ windKt: 20 }, leverFor(p, 26)).kt;
    expect(calm - blowing).toBeGreaterThan(0.5);
    expect(calm - blowing).toBeLessThan(2.5);
  });

  it('is the same every time: slams and all', () => {
    const a = run({ sea: chop(1, 20), windKt: 12 }, 4, 20, 120).sim.state;
    const b = run({ sea: chop(1, 20), windKt: 12 }, 4, 20, 120).sim.state;
    expect(a).toEqual(b);
  });
});

describe('fuel is the constraint', () => {
  const gph = (lever: number) => leverBurn(p, lever) / US_GALLON;
  const nmpg = (lever: number) => milesPerLitre(p, lever) * US_GALLON;

  it('burns about 11 US gallons an hour at cruise and twice that flat out', () => {
    expect(gph(leverFor(p, 26))).toBeGreaterThan(9.5);
    expect(gph(leverFor(p, 26))).toBeLessThan(13);
    expect(gph(4)).toBeGreaterThan(20);
    expect(gph(4)).toBeLessThan(24);
  });

  it('is at her best on the plane at 2 to 2.5 miles a gallon, worst on the hump, and thirsty flat out', () => {
    let best = 0;
    let bestKt = 0;
    for (let lever = leverFor(p, p.planeKt); lever <= 4; lever += p.leverStep) {
      if (nmpg(lever) > best) { best = nmpg(lever); bestKt = leverSpeed(p, lever) / KT; }
    }
    expect(best).toBeGreaterThan(2);
    expect(best).toBeLessThan(2.5);
    expect(bestKt).toBeGreaterThan(15);
    expect(bestKt).toBeLessThan(26);
    expect(nmpg(4)).toBeLessThan(best * 0.8);
    expect(nmpg(leverFor(p, 8.5))).toBeLessThan(best);
  });

  it('the sim burns what the table says, and the tank runs dry and stops her', () => {
    const { sim } = run({}, 4, 0, 600);
    expect(sim.state.fuelUsed).toBeCloseTo((leverBurn(p, 4) * (600 + 0)) / 3600, 0);
    expect(sim.out.burnLph).toBeCloseTo(leverBurn(p, 4), 6);
    sim.state.fuelUsed = boat.engine!.tankL - 0.01;
    sim.advance(5);
    expect(sim.state.engineOn).toBe(false);
    expect(sim.state.engineStops).toBe(1);
    expect(sim.startEngine()).toBe('dry');
    sim.provision();
    expect(sim.fuel).toBe(boat.engine!.tankL);
  });

  it('Avalon and back, 44 miles, is comfortable at cruise: under a third of the tank', () => {
    const lever = leverFor(p, 26);
    const litres = (44 / (leverSpeed(p, lever) / KT)) * leverBurn(p, lever);
    expect(litres / boat.engine!.tankL).toBeLessThan(1 / 3);
    expect(rangeNm(boat.engine!.tankL, leverSpeed(p, lever) / KT, leverBurn(p, lever))).toBeGreaterThan(130);
  });

  it('flat out into a one metre chop and flat out home breaks the rule of thirds, and the hull', () => {
    // Out: 22 miles into it at whatever the sea leaves her. Home: 22 miles down sea.
    const out = run({ sea: chop(1, 20) }, 4, 0, 600);
    const home = run({ sea: chop(1, 20) }, 4, 180, 600);
    const litres = (22 / out.kt + 22 / home.kt) * leverBurn(p, 4);
    const share = litres / boat.engine!.tankL;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.75);
    // The way out alone takes more than the third of a tank a prudent skipper allows for it.
    expect((22 / out.kt) * leverBurn(p, 4) / boat.engine!.tankL).toBeGreaterThan(0.3);
    // And an hour of that is more hull than she has to give.
    expect((out.sim.state.damage / 10) * (22 / out.kt) * 60).toBeGreaterThan(0.4);
  });

  it('range is fuel over burn times speed, and nothing when she is stopped', () => {
    expect(rangeNm(100, 25, 40)).toBeCloseTo(62.5, 6);
    expect(rangeNm(100, 0, 1.5)).toBe(0);
    expect(rangeNm(100, 20, 0)).toBe(0);
  });
});

describe('the battery', () => {
  it('runs the electronics with the engine off, and the alternator puts it back under way', () => {
    const sim = new Sim(file, world(), { speedKt: 0 });
    sim.advance(3600);
    const drawn = sim.state.batteryUsed;
    expect(drawn).toBeCloseTo(p.houseAmps, 1);
    sim.startEngine();
    sim.advance(CRANK_SECONDS + 0.1);
    sim.setThrottle(leverFor(p, 26));
    sim.advance(600);
    expect(sim.state.batteryUsed).toBeLessThan(drawn);
    expect(sim.battery).toBeGreaterThan(0.95);
  });
});

describe('shallow water', () => {
  it('floats in half a metre, where a keelboat is hard aground', () => {
    const shoal = { depth: () => 0.55 };
    const sim = run(shoal, 1, 0, 30).sim;
    expect(sim.out.aground).toBe(false);
    expect(sim.state.speed / KT).toBeGreaterThan(5);
    expect(sim.out.underKeel).toBeCloseTo(0.15, 2);
    const keel = new Sim(sloop, world({ ...shoal, windKt: 12 }), { headingDeg: 90, speedKt: 5 });
    keel.advance(10);
    expect(keel.out.aground).toBe(true);
  });

  it('running onto the bottom at speed is a hard stop, with damage; creeping on is not', () => {
    // A beach 150 m ahead: the water shoals from 3 m to nothing over 30 m.
    const beach = { depth: (_x: number, y: number) => Math.max(0, Math.min(3, (180 - y) / 10)) };
    const fast = started(beach);
    fast.setThrottle(leverFor(p, 26));
    fast.advance(40);
    expect(fast.out.aground).toBe(true);
    expect(Math.abs(fast.state.speed) / KT).toBeLessThan(0.5);
    expect(fast.state.damage).toBeGreaterThan(0.2);
    expect(fast.state.damage).toBeLessThanOrEqual(p.ground.most);
    const slow = started(beach);
    slow.setThrottle(p.leverStep);
    slow.advance(180);
    expect(slow.out.aground).toBe(true);
    expect(slow.state.damage).toBe(0);
    // She backs off the way she came.
    slow.setThrottle(-1);
    slow.advance(20);
    expect(slow.out.aground).toBe(false);
  });
});

describe('nothing made for sails can hurt her', () => {
  it('reefing, the spinnaker, tacking, the sheets and crew trim are harmless no-ops', () => {
    const { sim } = run({ windKt: 15 }, leverFor(p, 26), 40, 20);
    const before = { ...sim.snapshot() };
    sim.setControl('reef', 2);
    sim.nudgeControl('reef', 1);
    expect(sim.state.reef).toBe(0);
    expect(sim.setSpinnaker(true)).toBe('none');
    expect(sim.setSpinnaker()).toBe('none');
    expect(sim.spinnakerUp).toBe(false);
    expect(sim.tack()).toBe('none');
    expect(sim.state.maneuver).toBeNull();
    sim.setControl('mainsheet', 40 * D2R);
    sim.setControl('jibsheet_port', 20 * D2R);
    sim.setControl('jibsheet_stbd', 20 * D2R);
    sim.setControl('spinsheet', 50 * D2R);
    sim.setControl('furl', 1);
    expect(sim.state.furl).toBe(0);
    expect(sim.state.mainSheet).toBe(0);
    sim.setCrewTrim(true);
    expect(sim.state.crewTrim).toBe(false);
    sim.trimForWind();
    sim.advance(30);
    const s = sim.state;
    for (const v of [s.x, s.y, s.heading, s.speed, s.heel, s.lateral, s.yawRate]) expect(Number.isFinite(v)).toBe(true);
    expect(s.helmMode).toBe(before.helmMode);
    expect(s.speed / KT).toBeGreaterThan(22);
    expect(s.knockdowns + s.crashGybes + s.capsizes + s.broaches).toBe(0);
    for (const sail of [sim.out.main, sim.out.jib, sim.out.spin]) expect(sail.loadKg).toBe(0);
    expect(sim.out.inIrons).toBe(false);
    expect(sim.out.heelLoad).toBe(0);
  });

  it('a gale on the beam does not heel her, knock her down or drive her', () => {
    const sim = new Sim(file, world({ windKt: 40 }), { headingDeg: 90, speedKt: 0 });
    sim.advance(60);
    expect(Math.abs(sim.state.heel) * R2D).toBeLessThan(1);
    expect(sim.state.knockdowns).toBe(0);
    // She drifts off before it at a knot or so, no more.
    expect(sim.out.sog / KT).toBeLessThan(2.5);
    expect(sim.out.sog / KT).toBeGreaterThan(0.3);
  });

  it('with no way on, the wind blows her bow off', () => {
    const sim = new Sim(file, world({ windKt: 15 }), { headingDeg: 30, speedKt: 0 });
    sim.advance(60);
    expect(Math.abs(wrapPi(sim.state.heading)) * R2D).toBeGreaterThan(70);
  });

  it('a state saved from a sailing boat, or with fields missing, restores onto her safely', () => {
    const sailing = new Sim(sloop, world({ windKt: 14 }), { headingDeg: 300, speedKt: 5, reef: 1 });
    sailing.setCrewTrim(true);
    sailing.setHelm('wind');
    sailing.advance(20);
    const sim = new Sim(file, world({ windKt: 14 }), {});
    sim.restore(sailing.snapshot());
    expect(sim.state.helmMode).toBe('heading');
    expect(sim.state.crewTrim).toBe(false);
    expect(sim.state.reef).toBe(0);
    expect(sim.state.furl).toBe(0);
    sim.advance(10);
    expect(Number.isFinite(sim.state.x + sim.state.y + sim.state.heading + sim.state.speed)).toBe(true);
    // And her own state round-trips, lever position and all.
    const own = run({}, 2.75, 0, 10).sim;
    const again = new Sim(file, world(), own.snapshot());
    expect(again.state.throttle).toBe(2.75);
    own.advance(5);
    again.advance(5);
    expect(again.state).toEqual(own.state);
  });

  it('changing boats: out of a sloop into her and back leaves both sound', () => {
    const sim = new Sim(sloop, world({ windKt: 12 }), { headingDeg: 300, speedKt: 5 });
    sim.setCrewTrim(true);
    sim.advance(5);
    sim.setBoat(file);
    expect(sim.boat.power).toBeDefined();
    expect(sim.state.furl).toBe(0);
    sim.advance(5);
    sim.setBoat(sloop);
    expect(sim.state.furl).toBe(1);
    sim.trimForWind();
    sim.advance(60);
    expect(sim.state.speed / KT).toBeGreaterThan(3);
  });
});

describe('the autopilot', () => {
  it('holds a heading under power', () => {
    const { sim } = run({ windKt: 12 }, leverFor(p, 26), 0, 20);
    sim.setHelm('heading', 70 * D2R);
    sim.advance(25);
    expect(Math.abs(wrapPi(sim.state.heading - 70 * D2R)) * R2D).toBeLessThan(1.5);
    expect(sim.state.helmMode).toBe('heading');
  });

  it('asked to hold a wind angle, it holds her heading: there is no wind mode without sails', () => {
    const { sim } = run({ windKt: 12 }, leverFor(p, 26), 30, 10);
    sim.setHelm('wind', 50 * D2R);
    expect(sim.state.helmMode).toBe('heading');
    const held = sim.state.helmTarget;
    sim.advance(10);
    expect(Math.abs(wrapPi(sim.state.heading - held)) * R2D).toBeLessThan(1.5);
  });

  it('steers a route straight for a mark dead to windward, across a stream, without tacking', () => {
    const sim = started({ windKt: 12, currentY: 0 });
    const cross = new Sim(file, { sample: () => ({ windDir: 0, windSpeed: 12 * KT, currentX: 1.0, currentY: 0 }) }, sim.snapshot());
    cross.setRoute({ x: 0, y: 3000 }, { x: 0, y: 0 });
    cross.setThrottle(leverFor(p, 20));
    let worst = 0;
    let arrived = false;
    for (let t = 0; t < 600 && !arrived; t++) {
      cross.advance(1);
      if (t > 60) worst = Math.max(worst, Math.abs(cross.state.x));
      arrived = Math.hypot(cross.state.x, 3000 - cross.state.y) < 60;
    }
    expect(arrived).toBe(true);
    expect(cross.state.routeTurns).toBe(0);
    expect(cross.state.maneuver).toBeNull();
    expect(cross.out.pilotBeating).toBe(false);
    // Set down at first by two knots of stream, she crabs back toward the line.
    expect(worst).toBeLessThan(200);
  });

  it('is steady at speed in a quartering sea', () => {
    const { sim } = run({ sea: chop(0.8, 20, 135) }, leverFor(p, 26), 0, 60);
    expect(Math.abs(wrapPi(sim.state.heading)) * R2D).toBeLessThan(4);
  });

  it('a hand on the wheel takes her back', () => {
    const { sim } = run({}, leverFor(p, 26), 0, 10);
    sim.setControl('rudder', 5 * D2R);
    expect(sim.state.helmMode).toBe('hand');
  });
});

describe('made fast', () => {
  it('at anchor she lies to it out of gear, and let go she lies stopped with the wheel in hand', () => {
    const { sim } = run({ windKt: 10 }, 1, 0, 20);
    sim.holdAt('anchor', sim.state.x, sim.state.y, 20);
    expect(sim.state.throttle).toBe(0);
    expect(sim.setThrottle(2)).toBe('held');
    sim.advance(120);
    expect(sim.state.speed).toBe(0);
    sim.release();
    expect(sim.state.hold).toBe('none');
    expect(sim.state.helmMode).toBe('hand');
    expect(sim.state.crewTrim).toBe(false);
    sim.advance(5);
    expect(Math.abs(sim.state.speed) / KT).toBeLessThan(1);
  });
});
