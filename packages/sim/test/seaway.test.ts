import { describe, expect, it } from 'vitest';
import { Sim, D2R, KT, SEAWAY, displacementLength, type BoatSpec, type Environment, type SeaSample, type SimState } from '../src';
import boat30 from '../../../boats/sloop30.json';
import boat38 from '../../../boats/sloop38.json';
import boat45 from '../../../boats/perf45.json';

const b30 = boat30 as unknown as BoatSpec;
const b38 = boat38 as unknown as BoatSpec;
const b45 = boat45 as unknown as BoatSpec;

/** A steady wind from due north, and a sea (or none). `sea.dir` 0 is a sea running with the wind. */
function water(twsKt: number, sea?: SeaSample | null): Environment {
  const sample = { windDir: 0, windSpeed: twsKt * KT, currentX: 0, currentY: 0 };
  return sea === undefined ? { sample: () => sample } : { sample: () => sample, sea: () => sea };
}
const chop = (height: number, length: number, dir = 0): SeaSample => ({ height, length, dir, steepness: height / length });

function sail(boat: BoatSpec, twsKt: number, twaDeg: number, sea: SeaSample | null | undefined, seconds = 300) {
  const sim = new Sim(boat, water(twsKt, sea), { headingDeg: -twaDeg, speedKt: 5 });
  sim.setCrewTrim(true);
  sim.trimForWind();
  sim.setHelm('wind', twaDeg * D2R);
  sim.advance(90);
  const y0 = sim.state.y;
  const x0 = sim.state.x;
  let sum = 0;
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    sim.step();
    sum += sim.state.speed;
  }
  return { sim, kt: sum / n / KT, vmg: (sim.state.y - y0) / seconds / KT, leeward: (sim.state.x - x0) / seconds };
}

describe('the boat in a seaway', () => {
  it('sails exactly as before when the world gives no sea', () => {
    const run = (env: Environment): SimState => {
      const sim = new Sim(b38, env, { headingDeg: -50, speedKt: 5 });
      sim.setCrewTrim(true);
      sim.trimForWind();
      sim.setHelm('wind', 50 * D2R);
      sim.advance(60);
      sim.tack();
      sim.advance(60);
      return sim.snapshot();
    };
    const plain = run(water(15));
    expect(run(water(15, null))).toEqual(plain);
    expect(run(water(15, chop(0.03, 5)))).toEqual(plain);
    expect(plain.slams).toBe(0);
    expect(plain.seaPhase).toBe(0);
  });

  it('loses speed beating into a chop: the 30 suffers, the 45 shoulders through', () => {
    const lost = (boat: BoatSpec, sea: SeaSample) => 1 - sail(boat, 14, 44, sea).kt / sail(boat, 14, 44, null).kt;
    const small = chop(0.5, 9);
    const big = chop(1.2, 17);
    const [a30, a38, a45] = [b30, b38, b45].map((b) => lost(b, small));
    const [c30, c38, c45] = [b30, b38, b45].map((b) => lost(b, big));
    expect(a30).toBeGreaterThan(a38);
    expect(a38).toBeGreaterThan(a45);
    expect(c30).toBeGreaterThan(c38);
    expect(c38).toBeGreaterThan(c45);
    // Conservative: a few percent in half a metre, a quarter at the very most in a metre and a bit.
    expect(a30).toBeGreaterThan(0.04);
    expect(a30).toBeLessThan(0.1);
    expect(a45).toBeGreaterThan(0.02);
    expect(c30).toBeGreaterThan(0.17);
    expect(c30).toBeLessThan(0.27);
    expect(c45).toBeLessThan(0.17);
  });

  it('loses more to a steep sea than to an easy one of the same height', () => {
    const steep = sail(b30, 14, 44, chop(0.7, 9)).kt;
    const easy = sail(b30, 14, 44, chop(0.7, 26)).kt;
    expect(easy).toBeGreaterThan(steep + 0.2);
  });

  it('makes better speed to windward cracked off a few degrees in a steep chop, though not in flat water', () => {
    expect(sail(b30, 14, 50, null).vmg).toBeLessThan(sail(b30, 14, 44, null).vmg);
    expect(sail(b30, 14, 50, chop(1.2, 17)).vmg).toBeGreaterThan(sail(b30, 14, 44, chop(1.2, 17)).vmg);
  });

  it('slams going to windward in a steep sea, and only there', () => {
    const steep = sail(b30, 14, 44, chop(0.8, 10));
    expect(steep.sim.state.slams).toBeGreaterThan(3);
    // Not in a long easy sea, not in ripples, and not with the sea astern.
    expect(sail(b30, 14, 44, chop(0.8, 40)).sim.state.slams).toBe(0);
    expect(sail(b30, 14, 44, chop(0.15, 2)).sim.state.slams).toBe(0);
    expect(sail(b30, 14, 150, chop(0.8, 10)).sim.state.slams).toBe(0);
    // The same sail slams on the same waves every time.
    expect(sail(b30, 14, 44, chop(0.8, 10)).sim.state.slams).toBe(steep.sim.state.slams);
  });

  it('checks her speed at each slam, by a few percent', () => {
    const sim = new Sim(b30, water(14, chop(0.8, 10)), { headingDeg: -44, speedKt: 5 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setHelm('wind', 44 * D2R);
    let worst = 0;
    for (let i = 0; i < 60 * 240; i++) {
      const slams = sim.state.slams;
      const speed = sim.state.speed;
      sim.step();
      if (sim.state.slams > slams) worst = Math.max(worst, 1 - sim.state.speed / speed);
    }
    expect(worst).toBeGreaterThan(0.03);
    expect(worst).toBeLessThan(SEAWAY.slamCap + 0.01);
  });

  it('surfs running in a big sea, the light boat more than the heavy one', () => {
    expect(displacementLength(b45)).toBeLessThan(displacementLength(b30));
    const gain = (boat: BoatSpec) => sail(boat, 20, 160, chop(1.3, 22)).kt / sail(boat, 20, 160, null).kt - 1;
    const g30 = gain(b30);
    const g45 = gain(b45);
    expect(g30).toBeGreaterThan(0.01);
    expect(g45).toBeGreaterThan(g30 * 1.5);
    expect(g45).toBeLessThan(0.09);
    // A small sea carries nobody.
    expect(sail(b45, 20, 160, chop(0.25, 5)).sim.out.surf).toBe(0);
  });

  it('makes more leeway in a sea', () => {
    const flat = sail(b30, 14, 60, null);
    const rough = sail(b30, 14, 60, chop(1.0, 16));
    // Sailing west of north on starboard tack, leeway sets her east.
    expect(rough.leeward / rough.kt).toBeGreaterThan((flat.leeward / flat.kt) * 1.05);
  });

  it('is harder to steer with the sea on the quarter: left alone she wanders, in flat water she does not', () => {
    const wander = (sea: SeaSample | null): number => {
      const sim = new Sim(b30, water(18, sea), { headingDeg: 135, speedKt: 6 });
      sim.setCrewTrim(true);
      sim.trimForWind();
      sim.setHelm('heading');
      sim.advance(60);
      let most = 0;
      for (let i = 0; i < 60 * 120; i++) {
        sim.step();
        most = Math.max(most, Math.abs(sim.state.yawRate));
      }
      return most / D2R;
    };
    expect(wander(null)).toBeLessThan(0.3);
    const rough = wander(chop(1.2, 18));
    expect(rough).toBeGreaterThan(1);
    expect(rough).toBeLessThan(8);
  });

  it('gybes by accident running by the lee in a seaway, where in flat water the same wheel does not', () => {
    const run = (sea: SeaSample | null): SimState => {
      // Dead downwind and a touch by the lee, boom out to starboard, wheel left amidships, nobody tending the sheet.
      const sim = new Sim(b30, water(16, sea), { headingDeg: 179, speedKt: 5.5 });
      sim.trimForWind();
      sim.setControl('rudder', 0);
      const side = sim.state.mainSide;
      let crossed = false;
      for (let i = 0; i < 60 * 40 && !crossed; i++) {
        sim.step();
        crossed = sim.state.mainSide !== side;
      }
      return { ...sim.snapshot(), tick: crossed ? 1 : 0 };
    };
    expect(run(null).tick).toBe(0);
    expect(run(chop(1.2, 18)).tick).toBe(1);
  });

  it('carries on from a state saved before there was a sea', () => {
    const sim = new Sim(b38, water(15, chop(0.8, 12)), { headingDeg: -44, speedKt: 5 });
    const old = sim.snapshot() as unknown as Record<string, unknown>;
    delete old.seaPhase;
    delete old.seaCount;
    delete old.slams;
    sim.restore(old as unknown as SimState);
    expect(sim.state.slams).toBe(0);
    sim.advance(30);
    expect(Number.isFinite(sim.state.speed + sim.state.seaPhase)).toBe(true);
  });
});
