import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, SeaState, SEA, deepLength, describeSea, effectiveFetch, emptySea, fetchLimited, onStream, shoal, swellExposure, type CourseData, type FetchChart } from '../src';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../courses/sf-bay');
const course = JSON.parse(readFileSync(resolve(dir, 'course.json'), 'utf8')) as CourseData;
const bin = (name: string) => readFileSync(resolve(dir, name));
const data = { course, current: new Int8Array(bin('current.bin').buffer.slice(0)), depth: new Uint8Array(bin('depth.bin').buffer.slice(0)) };
/** Seconds into the season for a local clock time on the first day (the season starts at 08:00 PDT). */
const clock = (hour: number) => (hour - 8) * 3600;
const KT = 0.514444;

describe('wind sea from wind and fetch', () => {
  it('is a short chop of the right size over a few miles of water', () => {
    // 20 kt over 10 km: the Bay on a breezy afternoon.
    const s = fetchLimited(20 * KT, 10000);
    expect(s.height).toBeGreaterThan(0.5);
    expect(s.height).toBeLessThan(0.9);
    expect(s.period).toBeGreaterThan(2.5);
    expect(s.period).toBeLessThan(4);
    // 15 kt over 2 km: a harbour.
    const h = fetchLimited(15 * KT, 2000);
    expect(h.height).toBeGreaterThan(0.12);
    expect(h.height).toBeLessThan(0.3);
  });

  it('grows with the wind and with the fetch, and is longer in open water', () => {
    expect(fetchLimited(10, 20000).height).toBeGreaterThan(fetchLimited(10, 5000).height);
    expect(fetchLimited(14, 5000).height).toBeGreaterThan(fetchLimited(10, 5000).height);
    expect(fetchLimited(10, 200000).period).toBeGreaterThan(fetchLimited(10, 10000).period * 1.8);
  });

  it('stops growing at the fully developed sea', () => {
    const a = fetchLimited(10, 5e6);
    const b = fetchLimited(10, 5e7);
    expect(a.height).toBeCloseTo(b.height, 9);
    expect(a.period).toBeCloseTo(b.period, 9);
  });

  it('is nothing with no wind or no water', () => {
    expect(fetchLimited(0.2, 10000).height).toBe(0);
    expect(fetchLimited(10, 0).height).toBe(0);
  });
});

describe('fetch off a chart', () => {
  // Open water with a straight shore 600 m to the north, and the chart's edge 5 km out every other way.
  const chart: FetchChart = { land: (_x, y) => y > 600, inside: (x, y) => Math.abs(x) < 5000 && Math.abs(y) < 5000 };

  it('is short under a weather shore and long with the wind off the open side', () => {
    const lee = effectiveFetch(chart, 0, 0, 0, 8000);
    expect(lee).toBeGreaterThan(550);
    expect(lee).toBeLessThan(900);
    const open = effectiveFetch(chart, 0, 0, Math.PI, 8000);
    expect(open).toBeGreaterThan(12000);
  });

  it('is nothing on the land', () => {
    expect(effectiveFetch(chart, 0, 900, Math.PI)).toBe(0);
    expect(swellExposure(chart, 0, 900, Math.PI)).toBe(0);
  });

  it('lets a swell in from the open side only', () => {
    expect(swellExposure(chart, 0, 0, Math.PI)).toBe(1);
    expect(swellExposure(chart, 0, 0, 0)).toBe(0);
  });
});

describe('wind against tide', () => {
  const L = deepLength(3.2);

  it('stands the sea up against the stream and lays it down with it', () => {
    const slack = onStream(0.6, L, 0);
    const ebb = onStream(0.6, L, -1.2);
    const flood = onStream(0.6, L, 1.2);
    expect(slack.height).toBeCloseTo(0.6, 9);
    expect(slack.length).toBeCloseTo(L, 9);
    expect(ebb.height).toBeGreaterThan(0.72);
    expect(ebb.length).toBeLessThan(L * 0.85);
    expect(ebb.steepness).toBeGreaterThan(slack.steepness * 1.4);
    expect(flood.height).toBeLessThan(0.55);
    expect(flood.length).toBeGreaterThan(L * 1.15);
    expect(flood.steepness).toBeLessThan(slack.steepness * 0.75);
  });

  it('breaks on a hard ebb and never gets steeper than breaking', () => {
    const hard = onStream(0.8, L, -2.2);
    expect(hard.breaking).toBe(1);
    expect(hard.steepness).toBeLessThanOrEqual(SEA.breakAt + 1e-9);
    expect(onStream(0.6, L, 0).breaking).toBe(0);
    // However hard it runs, the answer stays a number.
    expect(Number.isFinite(onStream(0.8, L, -9).height)).toBe(true);
  });
});

describe('shoaling', () => {
  it('leaves deep water alone', () => {
    const s = shoal(0.6, 3, 30);
    expect(s.height).toBeCloseTo(0.6, 9);
    expect(s.length).toBeCloseTo(deepLength(3), 9);
  });

  it('shortens the waves where the depth is small against their length, and breaks them at half the depth', () => {
    const s = shoal(1.5, 9, 4);
    expect(s.length).toBeLessThan(deepLength(9) * 0.6);
    const b = shoal(1.5, 9, 1.6);
    expect(b.height).toBeCloseTo(0.8, 9);
    expect(shoal(1, 9, 0).height).toBe(0);
  });
});

describe('the sea on San Francisco Bay', () => {
  const world = new ReplayWorld(data, 0);
  const seas = new SeaState(world, { openFetchKm: 20 });
  const slot = { x: 1500, y: 300 };
  const gate = { x: -2512, y: -1145 };

  it('is a short chop of a few tenths of a metre in the slot on an ordinary afternoon', () => {
    const s = seas.at(slot.x, slot.y, clock(16));
    expect(s.windHeight).toBeGreaterThan(0.3);
    expect(s.windHeight).toBeLessThan(0.8);
    expect(s.period).toBeGreaterThan(2);
    expect(s.period).toBeLessThan(4);
    expect(s.length).toBeLessThan(25);
    expect(describeSea(s)).toMatch(/chop, 0\.\d m/);
  });

  it('is under a metre and a half there on a blowy one', () => {
    const blowy = new ReplayWorld(data, 0);
    blowy.windBoost = 1.5;
    const s = new SeaState(blowy, { openFetchKm: 20 }).at(slot.x, slot.y, clock(16));
    expect(s.windHeight).toBeGreaterThan(0.6);
    expect(s.windHeight).toBeLessThan(1.5);
  });

  it('is calm in the lee of the land', () => {
    // Richardson Bay, close under Sausalito with the sea breeze coming over the hill.
    const s = seas.at(-2300, 2700, clock(16));
    expect(s.windHeight).toBeLessThan(0.12);
    expect(s.fetch).toBeLessThan(1000);
    expect(describeSea(s)).toMatch(/flat water|ripples/);
    // On the land itself there is no sea at all.
    // Angel Island.
    expect(world.chartDepth(2300, 3700)).toBe(0);
    expect(seas.compute(2300, 3700, clock(16)).height).toBe(0);
  });

  it('is steeper and higher in the Gate on the ebb than on the flood, in less wind', () => {
    const ebb = seas.at(gate.x, gate.y, clock(13), emptySea());
    const flood = seas.at(gate.x, gate.y, clock(16), emptySea());
    expect(ebb.against).toBeGreaterThan(0.4);
    expect(flood.against).toBeLessThan(-0.4);
    expect(world.wind(gate.x, gate.y, clock(13)).speed).toBeLessThan(world.wind(gate.x, gate.y, clock(16)).speed);
    expect(ebb.steepness).toBeGreaterThan(flood.steepness * 1.4);
    expect(ebb.windHeight).toBeGreaterThan(flood.windHeight * 1.15);
    expect(ebb.length).toBeLessThan(flood.length);
    expect(describeSea(ebb)).toContain('wind against tide');
    expect(describeSea(flood)).toContain('tide with the wind');
  });

  it('gives every boat the same sea at the same moment of the season', () => {
    // Two sessions that started at different times, looking at the same season moment.
    const later = new ReplayWorld(data, 3 * 3600);
    const theirs = new SeaState(later, { openFetchKm: 20 });
    const mine = seas.at(slot.x + 37, slot.y - 91, clock(15) + 123, emptySea());
    const other = theirs.at(slot.x + 37, slot.y - 91, clock(15) + 123 - 3 * 3600, emptySea());
    expect(other).toEqual(mine);
  });

  it('blends smoothly between the points it is worked out at, and matches them there', () => {
    const t = clock(15);
    const exact = seas.compute(1500, 250, t);
    const blended = seas.at(1500, 250, t, emptySea());
    expect(blended.windHeight).toBeCloseTo(exact.windHeight, 9);
    expect(blended.length).toBeCloseTo(exact.length, 6);
    let last = seas.at(1000, 300, t).windHeight;
    for (let x = 1010; x <= 2000; x += 10) {
      const h = seas.at(x, 300, t).windHeight;
      expect(Math.abs(h - last)).toBeLessThan(0.03);
      last = h;
    }
  });

  it('rises everywhere when a harder blow is chosen', () => {
    const w = new ReplayWorld(data, 0);
    const s = new SeaState(w, { openFetchKm: 20 });
    const before = s.at(slot.x, slot.y, clock(16)).windHeight;
    w.windBoost = 1.5;
    expect(s.at(slot.x, slot.y, clock(16)).windHeight).toBeGreaterThan(before * 1.3);
  });

  it('is flat to a sim until the water is given a sea, and then is one wave train', () => {
    const w = new ReplayWorld(data, 0);
    expect(w.sea(slot.x, slot.y, clock(16))).toBeNull();
    w.seas = new SeaState(w, { openFetchKm: 20 });
    const s = w.sea(slot.x, slot.y, clock(16))!;
    expect(s.height).toBeGreaterThan(0.3);
    expect(s.steepness).toBeCloseTo(s.height / s.length, 3);
    // It runs with the wind.
    const wind = w.wind(slot.x, slot.y, clock(16));
    expect(Math.abs(Math.atan2(Math.sin(s.dir - wind.dir), Math.cos(s.dir - wind.dir)))).toBeLessThan(0.2);
  });
});

describe('an ocean swell a water declares', () => {
  const world = new ReplayWorld(data, 0);
  const swell = { height: 2, period: 12, fromDeg: 270 };
  const seas = new SeaState(world, { swell, openFetchKm: 20 });

  it('is none unless declared', () => {
    const s = new SeaState(world).at(-8500, -2200, clock(16));
    expect(s.swellHeight).toBe(0);
    expect(describeSea(s)).not.toContain('swell');
  });

  it('runs in the open and does not reach behind the land', () => {
    const outside = seas.at(-8500, -2200, clock(16), emptySea());
    expect(outside.swellHeight).toBeGreaterThan(1.5);
    expect(outside.height).toBeGreaterThan(outside.windHeight);
    expect(describeSea(outside)).toMatch(/m W swell, 12 s/);
    // Behind Angel Island, and far up the Bay.
    expect(seas.at(3900, 3300, clock(16)).swellHeight).toBeLessThan(0.05);
  });

  it('is what the sim is given only where it is the bigger thing to a boat', () => {
    world.seas = seas;
    const out = world.sea(-8500, -2200, clock(16))!;
    expect(out.length).toBeGreaterThan(60);
    const inside = world.sea(1500, 300, clock(16))!;
    expect(inside.length).toBeLessThan(25);
    world.seas = null;
  });
});
