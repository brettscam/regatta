import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, D2R, R2D, KT, bestVmgAngle, type BoatSpec } from '../src';
import { northWind } from './helpers';

// The 50 ft bluewater cruiser: nineteen tonnes on a long keel. What every boat in the lineup must do is checked in
// boats.test.ts; this pins what makes her herself against the 38 and the 45.
const here = dirname(fileURLToPath(import.meta.url));
const read = (id: string) => JSON.parse(readFileSync(resolve(here, `../../../boats/${id}.json`), 'utf8')) as BoatSpec;
const blue = read('blue50');
const b38 = read('sloop38');
const b45 = read('perf45');

function settle(boat: BoatSpec, twsKt: number, twaDeg: number, reef = 0, seconds = 300) {
  const sim = new Sim(boat, northWind(twsKt), { headingDeg: -twaDeg, speedKt: 5, reef });
  sim.setCrewTrim(true);
  sim.trimForWind();
  sim.setHelm('wind', twaDeg * D2R);
  sim.advance(seconds);
  return sim;
}
const kt = (sim: Sim) => sim.state.speed / KT;
const heelDeg = (sim: Sim) => Math.abs(sim.state.heel) * R2D;
const best = (boat: BoatSpec, tws: number, twa: number) => Math.max(...[0, 1, 2].map((reef) => kt(settle(boat, tws, twa, reef))));

describe('the bluewater 50', () => {
  it('is slow to gather way: from a standstill she takes far longer than the 38 to reach four fifths of her speed', () => {
    const seconds = (boat: BoatSpec) => {
      const full = kt(settle(boat, 14, 90));
      const sim = new Sim(boat, northWind(14), { headingDeg: -90, speedKt: 0 });
      sim.setCrewTrim(true);
      sim.trimForWind();
      sim.setHelm('wind', 90 * D2R);
      let t = 0;
      while (kt(sim) < full * 0.8 && t < 200) { sim.advance(0.5); t += 0.5; }
      return t;
    };
    expect(seconds(blue)).toBeGreaterThan(seconds(b38) * 1.4);
  });

  it('carries her way: shot head to wind she runs on much further than the 38', () => {
    const shoots = (boat: BoatSpec) => {
      const sim = settle(boat, 12, 60);
      const from = { x: sim.state.x, y: sim.state.y };
      // Let everything fly and steer straight into the wind.
      sim.setCrewTrim(false);
      sim.setControl('mainsheet', 85 * D2R);
      sim.setControl('jibsheet_port', 80 * D2R);
      sim.setControl('jibsheet_stbd', 80 * D2R);
      sim.setHelm('heading', 0);
      sim.advance(60);
      return Math.hypot(sim.state.x - from.x, sim.state.y - from.y);
    };
    expect(shoots(blue)).toBeGreaterThan(shoots(b38) * 1.2);
    expect(shoots(blue)).toBeGreaterThan(60);
  });

  it('is stiff: she heels less than the 38 and far less than the 45 close-hauled in 18 kt', () => {
    const [h50, h38, h45] = [blue, b38, b45].map((b) => heelDeg(settle(b, 18, 44)));
    expect(h50).toBeLessThan(h38 - 2);
    expect(h50).toBeLessThan(h45 - 6);
  });

  it('wants her first reef later than the 38 does', () => {
    const pays = (boat: BoatSpec) => {
      for (let tws = 10; tws <= 30; tws += 0.5) if (kt(settle(boat, tws, 42, 1, 240)) > kt(settle(boat, tws, 42, 0, 240))) return tws;
      return Infinity;
    };
    expect(pays(blue)).toBeGreaterThan(pays(b38) + 1.5);
  });

  it('is sticky in light air and comes into her own in a breeze', () => {
    for (const twa of [60, 90, 120]) {
      expect(best(blue, 7, twa), `7 kt at ${twa}`).toBeLessThan(best(b38, 7, twa));
      expect(best(blue, 22, twa), `22 kt at ${twa}`).toBeGreaterThan(best(b38, 22, twa) + 0.4);
    }
  });

  it('points modestly: her best course to windward is wider than the 38\'s', () => {
    expect(bestVmgAngle(blue.polar, 14).twaDeg).toBeGreaterThan(bestVmgAngle(b38.polar, 14).twaDeg + 1.5);
  });

  it('is comfortable in a blow: reefed down in 30 kt she is fast, upright enough and in no danger', () => {
    const sim = settle(blue, 30, 60, 2);
    expect(kt(sim)).toBeGreaterThan(7.5);
    expect(heelDeg(sim)).toBeLessThan(24);
    expect(sim.state.knockdowns).toBe(0);
    expect(sim.out.overpower).toBe(0);
    // The 45 in the same wind and sail is pressed harder.
    expect(heelDeg(settle(b45, 30, 60, 2))).toBeGreaterThan(heelDeg(sim) + 3);
  });

  it('turns slowly, and her long keel holds her head when she has no way on', () => {
    const turned = (boat: BoatSpec) => {
      const sim = settle(boat, 12, 90, 0, 60);
      const h0 = sim.state.heading;
      sim.setControl('rudder', 20 * D2R);
      sim.advance(4);
      return (Math.abs(sim.state.heading - h0) * R2D) / sim.state.speed;
    };
    expect(turned(blue)).toBeLessThan(turned(b45));
    const blownOff = (boat: BoatSpec) => {
      const sim = new Sim(boat, northWind(16), { headingDeg: -35, speedKt: 0, furl: 0 });
      sim.setControl('mainsheet', 85 * D2R);
      const h0 = sim.state.heading;
      sim.advance(6);
      return Math.abs(sim.state.heading - h0) * R2D;
    };
    expect(blownOff(blue)).toBeLessThan(blownOff(b38) * 0.85);
  });
});
