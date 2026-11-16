import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, D2R, R2D, KT, bestVmgAngle, type BoatSpec } from '../src';
import { angleBetweenDeg, northWind } from './helpers';
import { runScript, type ScriptStep, type TrackPoint } from './script';

// The 42 ft cruising catamaran. She is a different animal from the sloops: she does not heel, so nothing warns her
// crew; she is quick on a reach and poor to windward; she is slow through a tack and can be caught in irons; under
// power her two screws turn her where she lies. Every one of those is boat data, and these tests pin them.
const here = dirname(fileURLToPath(import.meta.url));
const read = (id: string) => JSON.parse(readFileSync(resolve(here, `../../../boats/${id}.json`), 'utf8')) as BoatSpec;
const cat = read('cat42');
const b38 = read('sloop38');
const b45 = read('perf45');
const CLOSE = cat.handling!.closeHauledDeg!;

function settle(boat: BoatSpec, twsKt: number, twaDeg: number, opts: { reef?: number; crew?: boolean; seconds?: number } = {}) {
  const sim = new Sim(boat, northWind(twsKt), { headingDeg: -twaDeg, speedKt: 5, reef: opts.reef ?? 0 });
  sim.setCrewTrim(opts.crew ?? true);
  sim.trimForWind();
  sim.setHelm('wind', twaDeg * D2R);
  sim.advance(opts.seconds ?? 240);
  return sim;
}
const kt = (sim: Sim) => sim.state.speed / KT;
const heelDeg = (sim: Sim) => Math.abs(sim.state.heel) * R2D;
/** The best she does at this wind and angle with whichever reef suits. */
const best = (boat: BoatSpec, tws: number, twa: number) => Math.max(...[0, 1, 2].map((reef) => kt(settle(boat, tws, twa, { reef }))));

describe('the catamaran stands up', () => {
  it('heels a few degrees and no more, on any point of sail in any wind', () => {
    for (const tws of [8, 14, 20, 26, 32]) {
      for (const twa of [CLOSE, 70, 90, 120, 150]) expect(heelDeg(settle(cat, tws, twa, { reef: tws > 22 ? 2 : 0 })), `${tws} kt at ${twa}`).toBeLessThan(6);
    }
    expect(heelDeg(settle(cat, 20, 60))).toBeGreaterThan(1);
  });

  it('where the 38 is laid over at 20 degrees she is nearly upright, with no weather helm and no heel penalty', () => {
    const sloop = settle(b38, 20, 45);
    const multi = settle(cat, 20, CLOSE);
    expect(heelDeg(sloop)).toBeGreaterThan(20);
    expect(heelDeg(multi)).toBeLessThan(5);
    expect(multi.out.heelPenalty).toBe(1);
    expect(multi.out.weatherHelm).toBe(0);
    expect(multi.out.rudderGrip).toBe(1);
  });

  it('a crash gybe in a breeze slams her rig but does not lay her over', () => {
    const crash = (boat: BoatSpec) => {
      const sim = settle(boat, 24, 165, { crew: false });
      sim.setControl('mainsheet', 80 * D2R);
      sim.advance(5);
      sim.setHelm('heading', sim.state.heading - 40 * D2R);
      let worst = 0;
      for (let i = 0; i < 20 * 60; i++) { sim.step(); worst = Math.max(worst, heelDeg(sim)); }
      return { sim, worst };
    };
    const multi = crash(cat);
    expect(multi.sim.state.crashGybes).toBe(1);
    expect(multi.sim.state.knockdowns).toBe(0);
    expect(multi.worst).toBeLessThan(6);
    // The same gybe in the 38 lays her flat.
    expect(crash(b38).sim.state.knockdowns).toBe(1);
  });
});

describe('the catamaran to windward', () => {
  const twa = bestVmgAngle(cat.polar, 14).twaDeg;

  it('sails her best to windward at about 50 degrees, not 40', () => {
    expect(twa).toBeGreaterThanOrEqual(47);
    expect(twa).toBeLessThanOrEqual(53);
    expect(bestVmgAngle(b38.polar, 14).twaDeg).toBeLessThan(43);
  });

  it('tacks through 100 to 112 degrees over the ground', () => {
    const through = angleBetweenDeg(settle(cat, 14, twa).out.cog, settle(cat, 14, -twa).out.cog);
    expect(through).toBeGreaterThan(100);
    expect(through).toBeLessThan(112);
  });

  it('makes four to seven degrees of leeway close-hauled, flat as she is', () => {
    const sim = settle(cat, 14, twa);
    const leeway = Math.abs(Math.atan2(sim.state.lateral, sim.state.speed)) * R2D;
    expect(leeway).toBeGreaterThan(4);
    expect(leeway).toBeLessThan(7);
  });

  it('slides more in light air, but never more than her nine degrees', () => {
    const sim = settle(cat, 5, twa);
    const leeway = Math.abs(Math.atan2(sim.state.lateral, sim.state.speed)) * R2D;
    expect(leeway).toBeGreaterThan(7);
    expect(leeway).toBeLessThan(9.5);
  });

  it('makes a good deal less to windward than the 38', () => {
    const made = (boat: BoatSpec) => {
      const a = bestVmgAngle(boat.polar, 14).twaDeg;
      const sim = settle(boat, 14, a);
      // The wind is from the north, so what she makes to windward is her speed north over the ground.
      return (sim.out.sog / KT) * Math.cos(sim.out.cog);
    };
    expect(made(cat)).toBeLessThan(made(b38) * 0.88);
    expect(made(cat)).toBeGreaterThan(made(b38) * 0.6);
  });
});

describe('the catamaran off the wind', () => {
  it('beats the 38 on a beam and a broad reach from 14 kt up', () => {
    for (const tws of [14, 20, 25]) {
      for (const twa of [90, 110, 130]) expect(best(cat, tws, twa), `${tws} kt at ${twa}`).toBeGreaterThan(best(b38, tws, twa) + 0.3);
    }
  });

  it('troubles the 45: close to her in 14 kt, ahead of her in 20', () => {
    for (const twa of [90, 110]) {
      expect(best(cat, 14, twa)).toBeGreaterThan(best(b45, 14, twa) - 0.5);
      expect(best(cat, 20, twa)).toBeGreaterThan(best(b45, 20, twa) + 0.4);
    }
  });

  it('is slower than the 38 in light air', () => {
    for (const twa of [60, 90, 120]) expect(best(cat, 7, twa)).toBeLessThan(best(b38, 7, twa));
  });

  it('is slow dead downwind and much faster reaching up: it pays to gybe downwind', () => {
    const run = kt(settle(cat, 16, 178));
    const reach = kt(settle(cat, 16, 135));
    // Velocity made good downwind at 135 beats pointing straight at it.
    expect(reach * Math.cos(45 * D2R)).toBeGreaterThan(run);
    expect(run).toBeLessThan(kt(settle(b38, 16, 178)));
  });

  it('gybes flat with the crew, and without losing much way', () => {
    const sim = settle(cat, 16, 150);
    const before = kt(sim);
    expect(sim.tack()).toBe('gybe');
    let worst = 0;
    let least = before;
    for (let i = 0; i < 40 * 60; i++) { sim.step(); worst = Math.max(worst, heelDeg(sim)); least = Math.min(least, kt(sim)); }
    expect(sim.state.maneuver).toBeNull();
    expect(sim.out.twa).toBeLessThan(-140 * D2R);
    expect(worst).toBeLessThan(5);
    expect(least).toBeGreaterThan(before * 0.6);
  });
});

describe('the catamaran in stays', () => {
  /** Put the wheel over by hand from close-hauled at a share of her speed and see whether she gets through the wind. */
  const handTack = (boat: BoatSpec, close: number, tws: number, share: number) => {
    const sim = settle(boat, tws, close);
    sim.state.speed *= share;
    sim.setControl('rudder', 30 * D2R);
    let t = 0;
    while (t < 60 && sim.out.twa > -close * D2R) { sim.advance(0.5); t += 0.5; }
    return { through: sim.out.twa <= -close * D2R, seconds: t, sim };
  };

  /** The same tack from half speed, stopped at the moment she is caught: head to wind with no way on. */
  const caughtInIrons = () => {
    const sim = settle(cat, 14, CLOSE);
    sim.state.speed *= 0.5;
    sim.setControl('rudder', 30 * D2R);
    for (let t = 0; t < 60 && !sim.out.inIrons; t += 0.25) sim.advance(0.25);
    return sim;
  };

  it('gets through a tack by hand with full way on, and takes far longer over it than the 38', () => {
    const tack = handTack(cat, CLOSE, 14, 1);
    expect(tack.through).toBe(true);
    expect(tack.seconds).toBeGreaterThan(18);
    expect(tack.seconds).toBeLessThan(35);
    const sloop = handTack(b38, 44, 14, 1);
    expect(sloop.through).toBe(true);
    expect(sloop.seconds).toBeLessThan(tack.seconds * 0.65);
  });

  it('tacked by hand from half her speed she stops head to wind, in irons, where the 38 gets round', () => {
    for (const tws of [10, 14, 20]) {
      const tack = handTack(cat, CLOSE, tws, 0.5);
      expect(tack.through, `${tws} kt`).toBe(false);
      expect(handTack(b38, 44, tws, 0.5).through, `the 38 in ${tws} kt`).toBe(true);
    }
    expect(caughtInIrons().out.inIrons).toBe(true);
  });

  it('her self-tacking jib comes across by itself and cannot be held aback', () => {
    const sim = handTack(cat, CLOSE, 14, 1).sim;
    sim.setControl('rudder', 0);
    sim.advance(2);
    expect(sim.out.jib.backed).toBe(0);
    // The wind is on the port side now, so the clew is out to starboard.
    expect(Math.sign(sim.state.jibAngle)).toBe(1);
    expect(sim.out.jib.flogging).toBe(false);
    // Either winch works the one sheet.
    sim.setControl('jibsheet_port', 20 * D2R);
    expect(sim.state.jibSheetStbd).toBeCloseTo(20 * D2R, 9);
    sim.setControl('jibsheet_stbd', 5 * D2R);
    expect(sim.state.jibSheetPort).toBeCloseTo(5 * D2R, 9);
  });

  it('with the crew called (they hold the jib aback by hand) she gets round from the same low speed, slowly', () => {
    for (const tws of [8, 14, 20, 28]) {
      const sim = settle(cat, tws, CLOSE, { reef: tws > 22 ? 1 : 0 });
      sim.state.speed *= 0.5;
      expect(sim.tack()).toBe('tack');
      let t = 0;
      while (sim.state.maneuver && t < 80) { sim.advance(0.5); t += 0.5; }
      expect(sim.out.twa, `${tws} kt`).toBeLessThan(-40 * D2R);
      expect(t).toBeGreaterThan(15);
      expect(t).toBeLessThan(60);
    }
  });

  it('an engine gets her round too: stuck in irons, her screws turn her where she lies', () => {
    const sim = caughtInIrons();
    expect(sim.out.inIrons).toBe(true);
    expect(sim.out.twa).toBeGreaterThan(0);
    sim.startEngine();
    sim.advance(3);
    sim.setThrottle(2);
    sim.setControl('rudder', 30 * D2R);
    sim.advance(8);
    expect(sim.out.twa).toBeLessThan(-CLOSE * D2R);
    expect(sim.out.twa).toBeGreaterThan(-140 * D2R);
  });

  it('the route pilot beats her to a mark dead to windward, tacking her with the crew, in light air and in a breeze', () => {
    for (const tws of [7, 12, 22]) {
      const sim = new Sim(cat, northWind(tws), { headingDeg: CLOSE, speedKt: 4 });
      sim.setCrewTrim(true);
      sim.trimForWind();
      sim.setRoute({ x: 0, y: 1500 });
      let arrived = false;
      for (let t = 0; t < 2400 && !arrived; t++) {
        sim.advance(1);
        arrived = Math.hypot(sim.state.x, 1500 - sim.state.y) < 60;
      }
      expect(arrived, `${tws} kt`).toBe(true);
      expect(sim.state.routeTurns).toBeLessThanOrEqual(4);
    }
  });
});

describe('the catamaran pressed', () => {
  const pr = cat.pressed!;
  const reefs = cat.sails.main.reefs;

  it('has a reefing number for each reef, below the limit they guard', () => {
    expect(pr.reefAwsKt.length).toBe(reefs.length - 1);
    expect(pr.reefAwsKt[0]).toBeLessThan(pr.reefAwsKt[1]);
    expect(pr.reefAwsKt[0]).toBeLessThan(pr.limitAwsKt);
  });

  it('tells her crew nothing: at the first reefing number she is flat, fast and unpressed', () => {
    const sim = settle(cat, 14, CLOSE);
    expect(sim.out.aws / KT).toBeGreaterThan(pr.reefAwsKt[0] - 1.5);
    expect(sim.out.press).toBeGreaterThan(0.6);
    expect(sim.out.press).toBeLessThan(0.85);
    expect(sim.out.overpower).toBe(0);
    expect(heelDeg(sim)).toBeLessThan(4);
  });

  it('reefed by the numbers on the placard she is never pressed, up to 34 kt of apparent wind', () => {
    for (const tws of [10, 14, 18, 22, 26, 30]) {
      for (const twa of [CLOSE, 70, 90, 120]) {
        // Find the reef the placard asks for in the apparent wind she ends up with.
        let reef = 0;
        let sim = settle(cat, tws, twa, { reef });
        while (reef < pr.reefAwsKt.length && sim.out.aws / KT >= pr.reefAwsKt[reef]) sim = settle(cat, tws, twa, { reef: ++reef });
        if (sim.out.aws / KT > 34) continue;
        expect(sim.out.press, `${tws} kt at ${twa}, ${reefs[reef].name}`).toBeLessThanOrEqual(1);
        expect(sim.state.capsizes).toBe(0);
      }
    }
  });

  it('past her limit a bow buries and she slows: more wind makes her slower, and a reef makes her faster', () => {
    const at22 = kt(settle(cat, 22, CLOSE));
    const at30 = settle(cat, 30, CLOSE);
    expect(at30.out.press).toBeGreaterThan(1);
    expect(at30.out.overpower).toBeGreaterThan(0);
    expect(kt(at30)).toBeLessThan(at22 * 0.85);
    expect(kt(settle(cat, 30, CLOSE, { reef: 2 }))).toBeGreaterThan(kt(at30) * 1.2);
    expect(at30.state.capsizes).toBe(0);
  });

  it('the crew spills the main to hold her near the limit', () => {
    const crewed = settle(cat, 32, 90, { crew: true, seconds: 60 });
    const sheeted = settle(cat, 32, 90, { crew: false, seconds: 60 });
    expect(crewed.state.gustEase).toBeGreaterThan(0);
    expect(crewed.out.press).toBeLessThan(sheeted.out.press);
  });

  it('full sail sheeted in and held there in 36 kt, she capsizes; in 28 kt she does not', () => {
    const safe = settle(cat, 28, 90, { crew: false, seconds: 120 });
    expect(safe.state.capsizes).toBe(0);
    expect(safe.state.knockdowns).toBe(0);
    const sim = settle(cat, 36, 90, { crew: false, seconds: 30 });
    expect(sim.state.capsizes).toBe(1);
    expect(sim.state.knockdowns).toBe(1);
    expect(heelDeg(sim)).toBeGreaterThan(75);
    expect(sim.out.knockedDown).toBe(true);
    expect(Math.abs(kt(sim))).toBeLessThan(1);
    expect(sim.state.helmMode).toBe('hand');
  });

  it('capsized she stays capsized: minutes, not the seconds a keelboat takes to come up', () => {
    const sim = settle(cat, 36, 90, { crew: false, seconds: 30 });
    sim.advance(pr.capsizeHoldS - 40);
    expect(heelDeg(sim)).toBeGreaterThan(75);
    expect(sim.state.capsizes).toBe(1);
    // Help rights her in the end. With the sail off her she is not thrown straight back over.
    sim.setControl('mainsheet', 80 * D2R);
    sim.setControl('reef', 2);
    sim.advance(80);
    expect(heelDeg(sim)).toBeLessThan(10);
    expect(sim.state.capsizes).toBe(1);
  });

  it('two reefs in, the same 36 kt does not capsize her', () => {
    const sim = settle(cat, 36, 90, { crew: false, reef: 2, seconds: 120 });
    expect(sim.state.capsizes).toBe(0);
    expect(kt(sim)).toBeGreaterThan(8);
  });

  it('a sloop has no such limit: her press is always 0 and she cannot capsize', () => {
    const sim = settle(b38, 36, 90, { crew: false, seconds: 60 });
    expect(sim.out.press).toBe(0);
    expect(sim.state.capsizes).toBe(0);
  });
});

describe('the catamaran under power', () => {
  const motoring = (boat: BoatSpec, throttle: number, speedKt = 0) => {
    // No wind at all, and her head across where it would come from, so that nothing but the engine turns her.
    const sim = new Sim(boat, northWind(0), { headingDeg: 90, speedKt, furl: 0 });
    sim.startEngine();
    sim.advance(2);
    sim.setThrottle(throttle);
    return sim;
  };
  /** Degrees she turns in so many seconds, counted through any number of full circles. */
  const turned = (sim: Sim, seconds: number) => {
    let total = 0;
    let last = sim.state.heading;
    for (let i = 0; i < seconds * 60; i++) {
      sim.step();
      let d = sim.state.heading - last;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      total += d;
      last = sim.state.heading;
    }
    return total * R2D;
  };

  it('spins where she lies with the engines running and the wheel over, out of gear', () => {
    const sim = motoring(cat, 0);
    sim.setControl('rudder', 35 * D2R);
    const x0 = sim.state.x;
    const y0 = sim.state.y;
    const deg = turned(sim, 20);
    expect(deg).toBeGreaterThan(140);
    expect(Math.hypot(sim.state.x - x0, sim.state.y - y0)).toBeLessThan(2);
    // The 38, with one screw and no way on, does not turn at all out of gear.
    const sloop = motoring(b38, 0);
    sloop.setControl('rudder', 35 * D2R);
    expect(Math.abs(turned(sloop, 20))).toBeLessThan(1);
  });

  it('with the engines off the wheel does nothing at a standstill', () => {
    const sim = new Sim(cat, northWind(0), { headingDeg: 90, speedKt: 0, furl: 0 });
    sim.setControl('rudder', 35 * D2R);
    expect(Math.abs(turned(sim, 20))).toBeLessThan(1);
  });

  it('has no prop walk: astern with the wheel amidships she goes straight back, where the 38 swings', () => {
    const sim = motoring(cat, -2);
    expect(Math.abs(turned(sim, 15))).toBeLessThan(0.5);
    expect(sim.state.speed).toBeLessThan(-0.5);
    const sloop = motoring(b38, -2);
    expect(Math.abs(turned(sloop, 15))).toBeGreaterThan(10);
  });

  it('steers astern far better than the 38, and the same way round', () => {
    const astern = (boat: BoatSpec) => {
      const sim = motoring(boat, -2);
      sim.advance(20);
      const straight = turned(sim, 5);
      sim.setControl('rudder', 25 * D2R);
      return turned(sim, 5) - straight;
    };
    // Wheel to starboard going astern takes her stern to starboard: her head swings to port, on either boat.
    expect(astern(cat)).toBeLessThan(0);
    expect(astern(b38)).toBeLessThan(0);
    expect(Math.abs(astern(cat))).toBeGreaterThan(Math.abs(astern(b38)) * 1.5);
  });

  it('under way at speed the pivot fades and she steers by her rudders', () => {
    const fast = motoring(cat, 3, 7);
    fast.advance(20);
    const off = new Sim(cat, northWind(0), { headingDeg: 90, speedKt: fast.state.speed / KT, furl: 0 });
    fast.setControl('rudder', 20 * D2R);
    off.setControl('rudder', 20 * D2R);
    const a = turned(fast, 2);
    const b = turned(off, 2);
    expect(a).toBeGreaterThan(b * 0.9);
    expect(a).toBeLessThan(b * 1.6);
  });

  it('draws 1.3 m: she floats where the 38 is aground', () => {
    const shoal = { sample: () => ({ windDir: 0, windSpeed: 10 * KT, currentX: 0, currentY: 0, depth: 1.7 }) };
    const multi = new Sim(cat, shoal, { headingDeg: 90, speedKt: 4 });
    const sloop = new Sim(b38, shoal, { headingDeg: 90, speedKt: 4 });
    multi.advance(5);
    sloop.advance(5);
    expect(multi.out.aground).toBe(false);
    expect(sloop.out.aground).toBe(true);
  });
});

describe('changing into and out of the catamaran where she lies', () => {
  it('a sloop sails on as a catamaran and back, with nothing left out of range', () => {
    const sim = settle(b38, 16, 60, { seconds: 60 });
    sim.setBoat(cat);
    sim.advance(120);
    expect(heelDeg(sim)).toBeLessThan(6);
    expect(sim.setSpinnaker(true)).toBe('none');
    sim.setBoat(b38);
    sim.advance(120);
    expect(heelDeg(sim)).toBeGreaterThan(8);
    expect(Number.isFinite(sim.state.x + sim.state.y + sim.state.speed)).toBe(true);
  });

  it('a state saved before capsizes were counted restores with none', () => {
    const sim = settle(cat, 12, 90, { seconds: 10 });
    const saved = sim.snapshot() as unknown as Record<string, unknown>;
    delete saved.capsizes;
    const again = new Sim(cat, northWind(12), saved as never);
    expect(again.state.capsizes).toBe(0);
  });
});

// Her own golden track: the same shape of sail as the sloop's reference, at her angles.
const CAT_SCRIPT: { windKt: number; headingDeg: number; speedKt: number; seconds: number; steps: ScriptStep[] } = {
  windKt: 16,
  headingDeg: 310,
  speedKt: 6,
  seconds: 480,
  steps: [
    { at: 0, set: 'mainsheet', deg: 16 },
    { at: 0, set: 'jibsheet_port', deg: 8 },
    // A tack by hand with full way on: the wheel over and held, the jib looks after itself.
    { at: 50, set: 'rudder', deg: 30 },
    { at: 76, set: 'rudder', deg: 0 },
    // Hold the wind angle, then a tack with the crew.
    { at: 110, helm: 'wind' },
    { at: 150, tack: true },
    // Bear away onto a reach and ease, then a broad reach.
    { at: 215, helm: 'heading', deg: 270 },
    { at: 220, set: 'mainsheet', deg: 40 },
    { at: 220, set: 'jibsheet_port', deg: 30 },
    { at: 280, helm: 'heading', deg: 220 },
    { at: 286, set: 'mainsheet', deg: 62 },
    { at: 286, set: 'jibsheet_port', deg: 50 },
    // Gybe and come back up.
    { at: 340, tack: true },
    { at: 400, helm: 'heading', deg: 80 },
    { at: 406, set: 'mainsheet', deg: 36 },
    { at: 406, set: 'jibsheet_stbd', deg: 24 },
  ],
};
const goldenFile = resolve(here, 'golden/cat42-sail.json');

describe('golden track, catamaran', () => {
  it('her reference sail follows the recorded track', () => {
    const { track } = runScript(CAT_SCRIPT, cat);
    if (process.env.UPDATE_GOLDEN || !existsSync(goldenFile)) {
      mkdirSync(dirname(goldenFile), { recursive: true });
      writeFileSync(goldenFile, JSON.stringify({ script: CAT_SCRIPT, track }, null, 1) + '\n');
    }
    const golden = JSON.parse(readFileSync(goldenFile, 'utf8')) as { track: TrackPoint[] };
    expect(track.length).toBe(golden.track.length);
    for (let i = 0; i < track.length; i++) {
      for (const k of ['t', 'x', 'y', 'hdg', 'kt', 'heel'] as const) {
        expect(track[i][k], `${k} at t=${track[i].t}`).toBeCloseTo(golden.track[i][k], 9);
      }
    }
  });

  it('her reference sail actually sails: both tacks, a reach, a gybe, flat all the way', () => {
    const { track, sim } = runScript(CAT_SCRIPT, cat);
    expect(track.filter((p) => p.kt > 3).length / track.length).toBeGreaterThan(0.75);
    expect(Math.max(...track.map((p) => p.y))).toBeGreaterThan(150);
    expect(track.some((p) => p.heel > 0.02)).toBe(true);
    expect(track.some((p) => p.heel < -0.02)).toBe(true);
    expect(Math.max(...track.map((p) => Math.abs(p.heel)))).toBeLessThan(6 * D2R);
    expect(sim.state.maneuver).toBeNull();
    expect(sim.state.crashGybes).toBe(0);
  });
});
