import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, D2R, R2D, KT, bestVmgAngle, polarSpeed, type BoatSpec } from '../src';
import { angleBetweenDeg, northWind } from './helpers';

// Every boat the player can choose has to sail like a boat, and the boats have to differ the way their sizes say.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../boats');
const read = (file: string) => JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
const lineup = read('lineup.json') as Array<{ id: string; file?: string; status: string }>;
const ready = lineup.filter((b) => b.status === 'ready');
const boats = new Map<string, BoatSpec>(ready.map((b) => [b.id, read(b.file!) as BoatSpec]));

function settle(boat: BoatSpec, twsKt: number, twaDeg: number, reef = 0, seconds = 240) {
  const sim = new Sim(boat, northWind(twsKt), { headingDeg: -twaDeg, speedKt: 5, reef });
  sim.setCrewTrim(true);
  sim.trimForWind();
  sim.setHelm('wind', twaDeg * D2R);
  sim.advance(seconds);
  return { kt: sim.state.speed / KT, heelDeg: Math.abs(sim.state.heel) * R2D, sim };
}

/** Wind speed, to the half knot, at which one reef first beats full sail upwind. */
function firstReefPaysAt(boat: BoatSpec): number {
  for (let tws = 10; tws <= 30; tws += 0.5) {
    if (settle(boat, tws, 42, 1).kt > settle(boat, tws, 42, 0).kt) return tws;
  }
  return Infinity;
}

describe('the lineup', () => {
  it('has at least three boats ready to sail, each with a file', () => {
    expect(ready.length).toBeGreaterThanOrEqual(3);
    for (const b of ready) expect(boats.get(b.id)!.id).toBe(b.id);
  });

  it('gives every boat what the boat picker shows', () => {
    for (const boat of boats.values()) {
      const shown = boat as BoatSpec & Record<string, unknown>;
      for (const key of ['tagline', 'role', 'defaultName', 'homePort']) expect(typeof shown[key], `${boat.id}.${key}`).toBe('string');
      expect(typeof shown.lengthFt).toBe('number');
      expect(String(shown.topsides)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

for (const boat of boats.values()) {
  describe(boat.name, () => {
    it('has a polar that never loses speed to more wind and is dead in the no-go zone', () => {
      const p = boat.polar;
      expect(p.speeds.length).toBe(p.tws.length);
      for (let j = 0; j < p.twa.length; j++) {
        for (let i = 1; i < p.tws.length; i++) expect(p.speeds[i][j]).toBeGreaterThanOrEqual(p.speeds[i - 1][j]);
      }
      expect(polarSpeed(p, 0, 14)).toBe(0);
      expect(polarSpeed(p, 20, 14)).toBe(0);
    });

    it('settles on her own polar on a beam reach in 12 kt', () => {
      const s = settle(boat, 12, 90);
      const target = polarSpeed(boat.polar, 90, 12);
      expect(s.kt).toBeGreaterThan(target * 0.98);
      expect(s.kt).toBeLessThan(target * 1.02);
    });

    it('tacks through about 90 degrees over the ground', () => {
      const twa = bestVmgAngle(boat.polar, 14).twaDeg;
      const through = angleBetweenDeg(settle(boat, 14, twa).sim.out.cog, settle(boat, 14, -twa).sim.out.cog);
      expect(through).toBeGreaterThan(84);
      expect(through).toBeLessThan(98);
    });

    it('wants her first reef somewhere between 13 and 21 kt upwind', () => {
      const pays = firstReefPaysAt(boat);
      expect(pays).toBeGreaterThanOrEqual(13);
      expect(pays).toBeLessThanOrEqual(21);
    });

    it('beats 1200 m dead to windward under the pilot without grounding or sitting in irons', () => {
      const sim = new Sim(boat, northWind(12), { headingDeg: 45, speedKt: 5 });
      sim.setCrewTrim(true);
      sim.trimForWind();
      sim.setRoute({ x: 0, y: 1200 });
      let irons = 0;
      let arrived = false;
      for (let t = 0; t < 1200 && !arrived; t++) {
        sim.advance(1);
        if (sim.out.inIrons) irons++;
        expect(sim.out.aground).toBe(false);
        arrived = Math.hypot(sim.state.x, 1200 - sim.state.y) < 60;
      }
      expect(arrived).toBe(true);
      expect(irons).toBeLessThanOrEqual(5);
    });
  });
}

describe('the boats differ the way their sizes say', () => {
  const b30 = boats.get('sloop30');
  const b38 = boats.get('sloop38');
  const b45 = boats.get('perf45');
  const all = b30 && b38 && b45;

  it.runIf(all)('longer is faster on a beam reach in 14 kt', () => {
    const [s30, s38, s45] = [b30!, b38!, b45!].map((b) => settle(b, 14, 90).kt);
    expect(s45).toBeGreaterThan(s38 + 0.3);
    expect(s38).toBeGreaterThan(s30 + 0.3);
  });

  it.runIf(all)('the 45 heels more than the 30 close-hauled in 16 kt', () => {
    expect(settle(b45!, 16, 42).heelDeg).toBeGreaterThan(settle(b30!, 16, 42).heelDeg + 2);
  });

  it.runIf(all)('the 45 wants her first reef before the 38, and the 38 before the 30', () => {
    const [r30, r38, r45] = [b30!, b38!, b45!].map(firstReefPaysAt);
    expect(r45).toBeLessThan(r38);
    expect(r38).toBeLessThanOrEqual(r30);
  });

  it.runIf(all)('the 30 turns quickest and the 45 slowest', () => {
    const turned = (b: BoatSpec) => {
      const sim = settle(b, 12, 90, 0, 60).sim;
      const h0 = sim.state.heading;
      sim.setControl('rudder', 20 * D2R);
      sim.advance(4);
      return Math.abs(sim.state.heading - h0) * R2D / sim.state.speed;
    };
    // Degrees turned in four seconds for each metre per second of boat speed.
    expect(turned(b30!)).toBeGreaterThan(turned(b38!));
    expect(turned(b38!)).toBeGreaterThan(turned(b45!));
  });

  it.runIf(all)('draft follows size', () => {
    expect(b30!.dimensions.draft).toBeLessThan(b38!.dimensions.draft);
    expect(b38!.dimensions.draft).toBeLessThan(b45!.dimensions.draft);
  });
});
