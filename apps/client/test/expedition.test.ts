import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, D2R, KT, R2D, polarSpeed, wrapPi, type BoatSpec } from '@slack-tide/sim';
import { ReplayWorld } from '@slack-tide/world';
import { advanceReckoning, rhumb } from '@slack-tide/nav';
import { Land } from '../src/expedition/land';
import { buildSea } from '../src/expedition/sea';
import { significantHeight } from '../src/expedition/swell';
import { CAIRD } from '../src/expedition/voyages/caird';
import { WAKE_CHECKS, sightingRange, type Facts, type Memory } from '../src/expedition/wake';
import {
  FULL_AND_BY, HEAVE_TO_KT, HOVE_TO_DRIFT, SAIL_PLANS, WATCH_STEP, judgedSpeed, measurePerformance, performanceAt, sailPlanFor, watchStep,
  type WatchWorld,
} from '../src/expedition/watch';

const boats = resolve(dirname(fileURLToPath(import.meta.url)), '../../../boats');
const caird = JSON.parse(readFileSync(resolve(boats, 'caird.json'), 'utf8')) as BoatSpec;
const NM = 1852;
const hoursOut = (day: number, hour: number) => day * 24 + hour;
const from = (u: number, v: number) => ((Math.atan2(-u, -v) * R2D) + 360) % 360;

function checksum(a: ArrayLike<number>): number {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) h = Math.imul(h ^ (a[i] & 0xffff), 16777619);
  return h >>> 0;
}

describe('the Scotia Sea, made from the record', () => {
  const sea = buildSea(CAIRD, 7);
  const world = new ReplayWorld(sea, CAIRD.castOff * 3600);
  const start = sea.projection.toXY(CAIRD.from.lat, CAIRD.from.lon);
  const end = sea.projection.toXY(CAIRD.to.lat, CAIRD.to.lon);

  it('is the same sea for the same seed, and another for another', () => {
    const again = buildSea(CAIRD, 7);
    const other = buildSea(CAIRD, 8);
    const wind = (s: typeof sea) => checksum(s.course.wind.truth.flatMap((step) => [checksum(step.u), checksum(step.v), checksum(step.g!)]));
    expect(wind(again)).toBe(wind(sea));
    expect(checksum(again.current)).toBe(checksum(sea.current));
    expect(checksum(again.depth)).toBe(checksum(sea.depth));
    expect(checksum(again.terrain)).toBe(checksum(sea.terrain));
    expect(wind(other)).not.toBe(wind(sea));
    // The land does not move with the seed.
    expect(checksum(other.depth)).toBe(checksum(sea.depth));
  });

  it('is a few megabytes, with grids the world accepts', () => {
    const c = sea.course;
    const bytes = c.wind.truth.length * c.wind.nx * c.wind.ny * 6 + sea.current.length + sea.depth.length + sea.patches.reduce((n, p) => n + p.heights.length, 0);
    expect(bytes).toBeLessThan(6e6);
    expect(c.wind.truth.length).toBe(CAIRD.days * 24 + 1);
    expect(sea.current.length).toBe(c.current.steps * c.current.nx * c.current.ny * 2);
    expect(sea.depth.length).toBe(c.depth.nx * c.depth.ny);
    expect(sea.terrain.length).toBe(c.terrain.nx * c.terrain.ny);
    // About 1,600 km of ocean from west to east.
    expect((c.bounds.x1 - c.bounds.x0) / 1000).toBeGreaterThan(1400);
  });

  it('keeps every wind within what that ocean does', () => {
    let top = 0;
    let sum = 0;
    let n = 0;
    for (const step of sea.course.wind.truth) {
      for (let k = 0; k < step.u.length; k++) {
        const kt = (Math.hypot(step.u[k], step.v[k]) * sea.course.wind.scale) / KT;
        top = Math.max(top, kt);
        sum += kt;
        n++;
        expect(step.g![k]).toBeGreaterThanOrEqual(Math.hypot(step.u[k], step.v[k]) - 1);
      }
    }
    expect(top).toBeLessThan(85);
    expect(top).toBeGreaterThan(55);
    // Gale-force westerlies are the rule: the mean over the fortnight is a strong breeze to a gale.
    expect(sum / n).toBeGreaterThan(22);
    expect(sum / n).toBeLessThan(38);
  });

  it('follows the script day by day', () => {
    const at = (day: number, hour: number) => {
      const w = sea.weather.scripted(hoursOut(day, hour));
      return { kt: Math.hypot(w.u, w.v) / KT, from: from(w.u, w.v), cloud: w.cloud, air: w.air };
    };
    // 24 April: a fair westerly to start.
    expect(at(0, 14).kt).toBeLessThan(20);
    expect(at(0, 14).from).toBeGreaterThan(225);
    expect(at(0, 14).from).toBeLessThan(275);
    // 25 and 26 April: a gale.
    expect(at(1, 18).kt).toBeGreaterThan(34);
    expect(at(2, 6).kt).toBeGreaterThan(34);
    // 30 April and 1 May: a south-westerly gale too hard to sail in, and freezing.
    for (const [d, h] of [[6, 14], [6, 22], [7, 6]]) {
      expect(at(d, h).kt).toBeGreaterThanOrEqual(HEAVE_TO_KT);
      expect(at(d, h).from).toBeGreaterThan(200);
      expect(at(d, h).from).toBeLessThan(235);
      expect(at(d, h).air).toBeLessThan(-7);
    }
    // 3 May: fine and clear.
    expect(at(9, 14).kt).toBeLessThan(18);
    expect(at(9, 14).cloud).toBeLessThan(0.3);
    // 5 May, near midnight: a hard north-westerly gale.
    expect(at(11, 23).kt).toBeGreaterThan(40);
    expect(at(11, 23).from).toBeGreaterThan(295);
    expect(at(11, 23).from).toBeLessThan(335);
    // 9 May: a hurricane from the west going south-west.
    expect(at(15, 16).kt).toBeGreaterThanOrEqual(64);
    expect(at(15, 16).from).toBeGreaterThan(220);
    expect(at(15, 16).from).toBeLessThan(275);
    // 10 May: light airs.
    expect(at(16, 12).kt).toBeLessThan(14);
  });

  it('is recognisably that fortnight whatever the seed', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = new ReplayWorld(buildSea(CAIRD, seed), CAIRD.castOff * 3600);
      const peak = (day: number, f: number) => {
        let top = 0;
        for (let h = -6; h < 30; h++) {
          const x = start.x + (end.x - start.x) * f;
          const y = start.y + (end.y - start.y) * f;
          top = Math.max(top, w.wind(x, y, Math.max(0, (hoursOut(day, h) - CAIRD.castOff) * 3600)).speed / KT);
        }
        return top;
      };
      // Where the record had her on each of these days.
      expect(peak(6, 6 / 16), `seed ${seed}: the gale of 30 April`).toBeGreaterThan(42);
      expect(peak(15, 15 / 16), `seed ${seed}: the hurricane of 9 May`).toBeGreaterThan(55);
      const fine = w.wind(start.x + (end.x - start.x) * (9 / 16), start.y + (end.y - start.y) * (9 / 16), (hoursOut(9, 14) - CAIRD.castOff) * 3600).speed / KT;
      expect(fine, `seed ${seed}: the fine day of 3 May`).toBeLessThan(24);
    }
  });

  it('sets a stream east to north-east at half a knot to a knot', () => {
    for (const [fx, fy] of [[0, 0], [0.3, 0.2], [0.5, 0.5], [0.8, 0.7], [1, 1]]) {
      const c = world.current(start.x + (end.x - start.x) * fx, start.y + (end.y - start.y) * fy, 3600 * 50);
      const kt = Math.hypot(c.x, c.y) / KT;
      const toward = ((Math.atan2(c.x, c.y) * R2D) + 360) % 360;
      expect(kt).toBeGreaterThan(0.45);
      expect(kt).toBeLessThan(1.05);
      expect(toward).toBeGreaterThan(35);
      expect(toward).toBeLessThan(95);
    }
  });

  it('has the land where it is, and deep water between', () => {
    const p = sea.projection;
    const depthAt = (lat: number, lon: number) => {
      const q = p.toXY(lat, lon);
      return world.depth(q.x, q.y, 0);
    };
    expect(depthAt(CAIRD.from.lat, CAIRD.from.lon)).toBeGreaterThan(5);
    expect(depthAt(-57.8, -46)).toBeGreaterThan(500);
    // The middle of Elephant Island, the middle of South Georgia, Annenkov Island.
    expect(depthAt(-61.14, -55.1)).toBe(0);
    expect(depthAt(-54.4, -36.6)).toBe(0);
    expect(depthAt(-54.49, -37.06)).toBe(0);
    // The mouth of King Haakon Bay is water, and so is the way in from the west.
    expect(depthAt(CAIRD.to.lat, CAIRD.to.lon)).toBeGreaterThan(5);
    expect(depthAt(-54.17, -37.6)).toBeGreaterThan(5);
    // Mount Paget stands near 2,900 m, and no ground is higher than the island's highest.
    const sg = sea.land.masses.find((m) => m.name === 'South Georgia')!;
    const paget = p.toXY(-54.43, -36.55);
    expect(Land.height(sg, paget.x, paget.y)).toBeGreaterThan(2000);
    let top = 0;
    for (const v of sea.terrain) top = Math.max(top, (v / 255) ** 2 * sea.course.terrain.max);
    expect(top).toBeGreaterThan(2300);
    expect(top).toBeLessThanOrEqual(2950);
  });

  it('is about 700 miles from the start to the landfall, with the chart ten per cent out at each end', () => {
    const leg = rhumb(sea.projection, start, end);
    expect(leg.metres / NM).toBeGreaterThan(660);
    expect(leg.metres / NM).toBeLessThan(740);
    expect(sea.projection.scaleAt(start.y) - 1).toBeGreaterThan(0.08);
    expect(sea.projection.scaleAt(start.y) - 1).toBeLessThan(0.12);
    expect(1 - sea.projection.scaleAt(end.y)).toBeGreaterThan(0.07);
    expect(1 - sea.projection.scaleAt(end.y)).toBeLessThan(0.11);
  });

  it('raises a sea of five to ten metres in a gale', () => {
    expect(significantHeight(34)).toBeGreaterThan(5);
    expect(significantHeight(50)).toBeLessThan(11);
    expect(significantHeight(12)).toBeLessThan(4);
    expect(significantHeight(50)).toBeGreaterThan(significantHeight(34));
  });
});

describe('the James Caird', () => {
  const p = caird.polar;

  it('is not in the Regatta lineup', () => {
    const lineup = JSON.parse(readFileSync(resolve(boats, 'lineup.json'), 'utf8')) as Array<{ id: string }>;
    expect(lineup.some((b) => b.id === 'caird')).toBe(false);
  });

  it('is the boat of the record: 22 ft 6 in by 6 ft', () => {
    expect(caird.dimensions.loa / 0.3048).toBeCloseTo(22.5, 1);
    expect(caird.dimensions.beam / 0.3048).toBeGreaterThan(5.9);
    expect(caird.dimensions.beam / 0.3048).toBeLessThan(6.2);
  });

  it('will not sail closer than about 60 degrees to the wind', () => {
    for (const tws of [6, 10, 15, 20, 28, 36, 45]) {
      for (const twa of [0, 20, 40, 50, 55]) expect(polarSpeed(p, twa, tws)).toBe(0);
      expect(polarSpeed(p, 60, tws)).toBeLessThanOrEqual(1.6);
    }
  });

  it('makes 2 to 4 knots in a breeze and no more than about 6 running hard before a gale', () => {
    for (const tws of [12, 15, 20]) {
      for (const twa of [90, 110, 130, 150]) {
        expect(polarSpeed(p, twa, tws)).toBeGreaterThanOrEqual(2);
        expect(polarSpeed(p, twa, tws)).toBeLessThanOrEqual(4);
      }
    }
    let top = 0;
    for (const row of p.speeds) for (const v of row) top = Math.max(top, v);
    expect(top).toBeLessThanOrEqual(6.2);
    expect(top).toBeGreaterThanOrEqual(5.5);
    expect(polarSpeed(p, 150, 45)).toBe(top);
  });

  it('never goes slower for more wind', () => {
    for (let j = 0; j < p.twa.length; j++) for (let i = 1; i < p.tws.length; i++) expect(p.speeds[i][j]).toBeGreaterThanOrEqual(p.speeds[i - 1][j]);
  });

  it('makes a lot of leeway on the wind and settles on her polar off it', () => {
    const env = { sample: () => ({ windDir: 0, windSpeed: 14 * KT, currentX: 0, currentY: 0 }) };
    const sail = (twa: number) => {
      const sim = new Sim(caird, env, { headingDeg: -twa, speedKt: 2 });
      sim.setCrewTrim(true);
      sim.trimForWind();
      sim.setHelm('heading', (360 - twa) * D2R);
      sim.advance(120);
      return { kt: sim.state.speed / KT, leeway: Math.atan2(Math.abs(sim.state.lateral), sim.state.speed) * R2D, twa: Math.abs(sim.out.twa) * R2D };
    };
    const onTheWind = sail(65);
    expect(onTheWind.leeway).toBeGreaterThan(10);
    expect(onTheWind.kt).toBeLessThan(2.2);
    const reaching = sail(120);
    expect(reaching.kt).toBeGreaterThan(polarSpeed(p, 120, 14) * 0.85);
    expect(reaching.kt).toBeLessThanOrEqual(polarSpeed(p, 120, 14) * 1.02);
  });

  it('is shortened down as the wind rises, and not shaken out at the first lull', () => {
    expect(SAIL_PLANS[sailPlanFor(10, 0)].name).toBe('Full sail');
    expect(sailPlanFor(20, 0)).toBe(1);
    expect(sailPlanFor(36, 0)).toBe(2);
    expect(sailPlanFor(26, 2)).toBe(2);
    expect(sailPlanFor(17, 1)).toBe(1);
    expect(sailPlanFor(10, 2)).toBe(0);
  });
});

describe('standing a watch', () => {
  const perf = measurePerformance(caird);
  const steady = (fromDeg: number, kt: number, setDeg = 0, driftKt = 0): WatchWorld => ({
    wind: () => ({ dir: fromDeg * D2R, speed: kt * KT }),
    current: () => ({ x: Math.sin(setDeg * D2R) * driftKt * KT, y: Math.cos(setDeg * D2R) * driftKt * KT }),
    depth: () => 1000,
  });
  const run = (world: WatchWorld, course: number, hours: number) => {
    let b = { x: 0, y: 0, t: 0, plan: 0, hoveTo: false };
    let last = watchStep(perf, world, b, course, WATCH_STEP);
    b = last;
    for (let i = 1; i < (hours * 3600) / WATCH_STEP; i++) {
      last = watchStep(perf, world, b, course, WATCH_STEP);
      b = last;
    }
    return last;
  };

  it('lands where the arithmetic says after four hours on a steady course in a steady wind', () => {
    // Steering north-east with the wind west-south-west at 14 knots, and three quarters of a knot of stream setting east-north-east.
    const course = 45 * D2R;
    const end = run(steady(250, 14, 65, 0.75), course, 4);
    const twa = wrapPi(250 * D2R - course);
    const made = performanceAt(perf, Math.abs(twa) * R2D, 14);
    // The wind is on the port side, so she sags to starboard.
    expect(twa).toBeLessThan(0);
    const lateral = made.speed * Math.tan(made.leeway);
    const seconds = 4 * 3600;
    const x = (made.speed * Math.sin(course) + lateral * Math.cos(course) + Math.sin(65 * D2R) * 0.75 * KT) * seconds;
    const y = (made.speed * Math.cos(course) - lateral * Math.sin(course) + Math.cos(65 * D2R) * 0.75 * KT) * seconds;
    expect(end.x).toBeCloseTo(x, 3);
    expect(end.y).toBeCloseTo(y, 3);
    expect(end.t).toBe(seconds);
    // Something like ten miles through the water, and thirteen over the ground.
    expect((made.speed * seconds) / NM).toBeGreaterThan(8);
    expect(Math.hypot(end.x, end.y) / NM).toBeGreaterThan(11);
    expect(Math.hypot(end.x, end.y) / NM).toBeLessThan(15);
  });

  it('leaves the reckoning behind the truth by the leeway and the stream', () => {
    const course = 45 * D2R;
    const world = steady(250, 14, 65, 0.75);
    const end = run(world, course, 4);
    // By account: the course and the speed through the water, nothing else.
    const dr = advanceReckoning({ x: 0, y: 0, run: 0 }, course, end.speed, 4 * 3600);
    const gap = Math.hypot(end.x - dr.x, end.y - dr.y) / NM;
    expect(gap).toBeGreaterThan(2.5);
    expect(gap).toBeLessThan(5);
    // With no stream and the wind dead aft there is no leeway, and the two agree.
    const fair = run(steady(225, 14), course, 4);
    const fairDr = advanceReckoning({ x: 0, y: 0, run: 0 }, course, fair.speed, 4 * 3600);
    expect(Math.hypot(fair.x - fairDr.x, fair.y - fairDr.y)).toBeLessThan(60);
  });

  it('sails her full and by when the course lies too close to the wind', () => {
    const end = run(steady(50, 14), 45 * D2R, 1);
    expect(end.headed).toBe(true);
    expect(Math.abs(wrapPi(50 * D2R - end.heading)) * R2D).toBeCloseTo(FULL_AND_BY, 6);
  });

  it('heaves to in a storm and drifts to leeward at about a knot', () => {
    const end = run(steady(225, 55), 45 * D2R, 4);
    expect(end.hoveTo).toBe(true);
    expect(Math.hypot(end.x, end.y)).toBeCloseTo(HOVE_TO_DRIFT * 4 * 3600, 0);
    // South-west wind: she goes north-east.
    expect(Math.atan2(end.x, end.y) * R2D).toBeCloseTo(45, 3);
    // And stays hove to until it has eased well below what hove her to.
    expect(watchStep(perf, steady(225, 44), end, 45 * D2R, WATCH_STEP).hoveTo).toBe(true);
    expect(watchStep(perf, steady(225, 38), end, 45 * D2R, WATCH_STEP).hoveTo).toBe(false);
  });

  it('agrees with sailing her in real time, within a few per cent over an hour', () => {
    for (const [windFrom, kt, courseDeg] of [[250, 14, 45], [230, 24, 50], [300, 36, 60], [330, 20, 45]]) {
      const env = { sample: () => ({ windDir: windFrom * D2R, windSpeed: kt * KT, currentX: 0.2, currentY: 0.15 }) };
      const plan = SAIL_PLANS[sailPlanFor(kt, 0)];
      const sim = new Sim(caird, env, { headingDeg: courseDeg, speedKt: 2.5, reef: plan.reef, furl: plan.furl });
      sim.setCrewTrim(true);
      sim.trimForWind();
      sim.setHelm('heading', courseDeg * D2R);
      sim.advance(3600);
      const world: WatchWorld = { wind: () => ({ dir: windFrom * D2R, speed: kt * KT }), current: () => ({ x: 0.2, y: 0.15 }), depth: () => 1000 };
      const watch = run(world, courseDeg * D2R, 1);
      const ran = Math.hypot(sim.state.x, sim.state.y);
      const apart = Math.hypot(sim.state.x - watch.x, sim.state.y - watch.y);
      expect(apart / ran, `wind ${windFrom} at ${kt}, steering ${courseDeg}: ${apart.toFixed(0)} m apart in ${ran.toFixed(0)} m`).toBeLessThan(0.04);
    }
  });

  it('agrees with real time on the made sea too, gusts and all', () => {
    const sea = buildSea(CAIRD, 7);
    const world = new ReplayWorld(sea, CAIRD.castOff * 3600);
    const at = sea.starts[0];
    const kt = world.wind(at.x, at.y, 0).speed / KT;
    const plan = SAIL_PLANS[sailPlanFor(kt, 0)];
    const sim = new Sim(caird, world, { x: at.x, y: at.y, headingDeg: 5, speedKt: 2.5, reef: plan.reef, furl: plan.furl });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setHelm('heading', 5 * D2R);
    sim.advance(3600);
    let b = { x: at.x, y: at.y, t: 0, plan: sailPlanFor(kt, 0), hoveTo: false };
    for (let i = 0; i < 3600 / WATCH_STEP; i++) b = watchStep(perf, world, b, 5 * D2R, WATCH_STEP);
    const ran = Math.hypot(sim.state.x - at.x, sim.state.y - at.y);
    expect(ran / NM).toBeGreaterThan(2);
    expect(Math.hypot(sim.state.x - b.x, sim.state.y - b.y) / ran).toBeLessThan(0.06);
  });

  it('judges her speed to the half knot, never far out, and the same way every time', () => {
    for (let t = 0; t < 20 * 14400; t += 14400) {
      const kt = judgedSpeed(3 * KT, t, 7) / KT;
      expect(kt * 2).toBeCloseTo(Math.round(kt * 2), 9);
      expect(kt).toBeGreaterThanOrEqual(2.5);
      expect(kt).toBeLessThanOrEqual(3.5);
      expect(judgedSpeed(3 * KT, t, 7)).toBe(judgedSpeed(3 * KT, t + 100, 7));
    }
  });
});

describe('what calls the skipper', () => {
  const facts = (over: Partial<Facts>): Facts => ({ t: 0, twsKt: 15, twd: 4, land: null, sun: 0.3, cloud: 0.5, aground: false, hoveTo: false, ...over });
  const ask = (now: Facts, memory: Memory) => WAKE_CHECKS.map((c) => c.test(now, memory)).filter((line): line is string => line !== null);

  it('calls once for a gale, and again only after it has blown out', () => {
    const m: Memory = {};
    expect(ask(facts({ twsKt: 30 }), m)).toEqual([]);
    expect(ask(facts({ twsKt: 36 }), m)[0]).toMatch(/^Gale from the south-west/);
    expect(ask(facts({ twsKt: 40 }), m)).toEqual([]);
    expect(ask(facts({ twsKt: 30 }), m)).toEqual([]);
    expect(ask(facts({ twsKt: 20 }), m)).toEqual([]);
    expect(ask(facts({ twsKt: 35 }), m).length).toBe(1);
  });

  it('calls for land only after she has been out of sight of it, and only when it could be seen', () => {
    const m: Memory = {};
    const land = (metres: number) => ({ metres, name: 'South Georgia', peak: 2934, bearing: 0.8 });
    // Still under Elephant Island at the start: no news.
    expect(ask(facts({ land: { metres: 3000, name: 'Elephant Island', peak: 970, bearing: 3 } }), m)).toEqual([]);
    expect(ask(facts({ land: null }), m)).toEqual([]);
    // Thirty miles off in thick weather: not yet. Ten miles off: land.
    expect(ask(facts({ land: land(30 * NM), cloud: 0.9 }), m)).toEqual([]);
    expect(ask(facts({ land: land(9 * NM), cloud: 0.8 }), m)[0]).toMatch(/^Land\. South Georgia, bearing north-east, about 9 miles off/);
    expect(ask(facts({ land: land(8 * NM), cloud: 0.8 }), m)).toEqual([]);
  });

  it('sees land about ten miles off in thick weather, further when it is clear, hardly at all at night', () => {
    expect(sightingRange(2934, 0.3, 0.85, 25) / NM).toBeGreaterThan(8);
    expect(sightingRange(2934, 0.3, 0.85, 25) / NM).toBeLessThan(13);
    expect(sightingRange(2934, 0.3, 0.1, 15)).toBeGreaterThan(sightingRange(2934, 0.3, 0.85, 15));
    expect(sightingRange(2934, -0.3, 0.1, 15) / NM).toBeLessThan(3);
  });
});
