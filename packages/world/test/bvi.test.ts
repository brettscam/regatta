import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, type CourseData } from '../src';

// Sanity checks on the baked British Virgin Islands course: a trade wind that is a trade wind, a small tide,
// weak streams except in the cuts, wind shadow under the high islands, land that is land and reefs that are shoal.
// And on the hand-written files beside it: every place afloat, every leg of every race and start in deep water.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../courses/bvi');
const read = <T>(name: string) => JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as T;
const course = read<CourseData>('course.json');
const bin = (name: string) => readFileSync(resolve(dir, name));
const data = { course, current: new Int8Array(bin('current.bin').buffer.slice(0)), depth: new Uint8Array(bin('depth.bin').buffer.slice(0)) };
const KT = 0.514444;
/** Seconds into the season for a local clock time on the first day (the season starts at 08:00 Atlantic Standard Time). */
const clock = (hour: number) => (hour - 8) * 3600;
/** Metres east and north of the course origin for a latitude and longitude. */
const at = (lat: number, lon: number): [number, number] => [
  (lon - course.origin.lon) * 111195 * Math.cos((course.origin.lat * Math.PI) / 180),
  (lat - course.origin.lat) * 111195,
];

// Places from general knowledge of the islands, and spots read off the baked chart.
const SAGE_MOUNTAIN = at(18.409, -64.656);
const GORDA_PEAK = at(18.479, -64.403);
const MIDDLE_OF_JOST = at(18.45, -64.75);
const DRAKE_CHANNEL: [number, number] = [-3000, -3500];
const NORTH_OF_THE_ISLANDS: [number, number] = [5000, 12000];
const SOUTH_OF_THE_ISLANDS: [number, number] = [0, -13000];
const THATCH_CUT = at(18.387, -64.72);
const UNDER_VIRGIN_GORDA: [number, number] = [10600, 3500];
const CANE_GARDEN_BAY: [number, number] = [-11900, 800];
const COLQUHOUN_REEF: [number, number] = [17350, 10320];
const COLQUHOUN_CHANNEL: [number, number] = [18150, 10600];

describe('British Virgin Islands replay, 9 and 10 February 2025', () => {
  const world = new ReplayWorld(data, 0);

  it('starts at 08:00 Atlantic time on 9 February 2025 and holds 36 hours', () => {
    expect(course.id).toBe('bvi');
    expect(course.timeZone).toBe('America/Tortola');
    expect(world.dateAt(0).toISOString()).toBe('2025-02-09T12:00:00.000Z');
    expect(world.seasonLength).toBe(36 * 3600);
    expect(course.wind.truth.length).toBe(37);
    expect(course.tide.truth.length).toBe(37);
    expect(data.current.length).toBe(37 * course.current.nx * course.current.ny * 2);
    expect(data.depth.length).toBe(course.depth.nx * course.depth.ny);
  });

  it('says where its wind and tide come from, and what in the wind is worked out by rule', () => {
    expect(course.season.source).toMatch(/STOFS-2D-Global/);
    expect(course.season.source).toMatch(/RTMA/);
    expect(course.season.source).not.toMatch(/HRRR/);
    expect(course.forecast.source).toMatch(/NAM/);
    expect(course.wind.modelled).toMatch(/wind shadow/);
  });

  it('has a small tide: under half a metre between high and low', () => {
    const levels = Array.from({ length: 37 }, (_, h) => world.tide(h * 3600));
    const range = Math.max(...levels) - Math.min(...levels);
    expect(range).toBeGreaterThan(0.2);
    expect(range).toBeLessThan(0.6);
  });

  it('blows a trade wind from between north-east and south-east in the channel, all day and all night', () => {
    for (let hour = 8; hour <= 44; hour += 3) {
      const w = world.wind(...DRAKE_CHANNEL, clock(hour));
      // A sample is one moment, puffs and lulls and all: never less than a sailing breeze.
      expect(w.speed / KT, `at ${hour}:00`).toBeGreaterThan(5);
      expect(w.speed / KT, `at ${hour}:00`).toBeLessThan(26);
      const from = (w.dir * 180) / Math.PI;
      expect(from, `at ${hour}:00`).toBeGreaterThan(30);
      expect(from, `at ${hour}:00`).toBeLessThan(140);
    }
  });

  it('is lighter under the lee of Virgin Gorda and Tortola than out in the open', () => {
    let lee = 0;
    let cane = 0;
    let open = 0;
    for (let h = 0; h <= 36; h++) {
      lee += world.wind(...UNDER_VIRGIN_GORDA, h * 3600).speed;
      cane += world.wind(...CANE_GARDEN_BAY, h * 3600).speed;
      open += world.wind(...NORTH_OF_THE_ISLANDS, h * 3600).speed;
    }
    expect(lee).toBeLessThan(open * 0.85);
    expect(cane).toBeLessThan(open * 0.85);
    // A lee, not a flat calm: there is still wind to sail off the mooring.
    expect(lee / 37 / KT).toBeGreaterThan(5);
  });

  it('keeps every wind and gust on the grid within what a trade-wind day can do', () => {
    for (const step of [...course.wind.truth, ...course.wind.forecast]) {
      for (let k = 0; k < step.u.length; k++) {
        const speed = Math.hypot(step.u[k], step.v[k]) * course.wind.scale;
        // No ridge-top wind has leaked down on to the water: nothing over 26 knots.
        expect(speed).toBeLessThan(13.5);
        expect(step.g![k] * course.wind.scale).toBeGreaterThanOrEqual(speed - 0.15);
        expect(step.g![k] * course.wind.scale).toBeLessThan(19);
      }
    }
  });

  it('runs weak streams in the open channel and a knot or so through the cut by Great Thatch', () => {
    let channel = 0;
    let cut = 0;
    for (let h = 0; h <= 36; h += 0.5) {
      const a = world.current(...DRAKE_CHANNEL, h * 3600);
      channel = Math.max(channel, Math.hypot(a.x, a.y) / KT);
      const b = world.current(...THATCH_CUT, h * 3600);
      cut = Math.max(cut, Math.hypot(b.x, b.y) / KT);
    }
    expect(channel).toBeLessThan(1);
    expect(cut).toBeGreaterThan(0.7);
    expect(cut).toBeLessThan(3);
  });

  it('knows land from water', () => {
    expect(world.chartDepth(...SAGE_MOUNTAIN)).toBe(0);
    expect(world.chartDepth(...GORDA_PEAK)).toBe(0);
    expect(world.chartDepth(...MIDDLE_OF_JOST)).toBe(0);
    expect(world.chartDepth(...DRAKE_CHANNEL)).toBeGreaterThan(20);
    expect(world.chartDepth(...NORTH_OF_THE_ISLANDS)).toBeGreaterThan(15);
    // The shelf ends south of Norman and Peter: off it the chart reads its deepest.
    expect(world.chartDepth(...SOUTH_OF_THE_ISLANDS)).toBeGreaterThan(100);
  });

  it('has no stream over the land', () => {
    const c = world.current(...SAGE_MOUNTAIN, clock(16), { x: 0, y: 0 });
    expect(Math.hypot(c.x, c.y)).toBe(0);
  });

  it('charts Colquhoun Reef as a shoal and leaves the channel into North Sound beside it', () => {
    expect(world.chartDepth(...COLQUHOUN_REEF)).toBeGreaterThan(0);
    expect(world.chartDepth(...COLQUHOUN_REEF)).toBeLessThan(1.6);
    expect(world.chartDepth(...COLQUHOUN_CHANNEL)).toBeGreaterThan(5);
  });

  it('has turquoise water to show: plenty of shoal ground, and far more deep', () => {
    let shoal = 0;
    let deep = 0;
    for (const d of data.depth) {
      if (d > 0 && d * course.depth.scale < 8) shoal++;
      if (d * course.depth.scale >= 8) deep++;
    }
    expect(shoal).toBeGreaterThan(5000);
    expect(deep).toBeGreaterThan(shoal * 5);
  });

  it('puts every town, island and point on or beside land and every buoy afloat', () => {
    expect(course.marks.length).toBeGreaterThan(30);
    for (const m of course.marks) {
      if (m.kind === 'buoy') expect(world.chartDepth(m.x, m.y), m.name).toBeGreaterThan(4);
      else {
        let nearLand = false;
        for (let dx = -400; dx <= 400 && !nearLand; dx += 100) for (let dy = -400; dy <= 400 && !nearLand; dy += 100) nearLand = world.chartDepth(m.x + dx, m.y + dy) === 0;
        expect(nearLand, m.name).toBe(true);
      }
    }
  });
});

describe('British Virgin Islands: places, starts and races', () => {
  const world = new ReplayWorld(data, 0);
  interface Spot { name: string; x: number; y: number }
  const places = read<Array<Spot & { id: string; kind: string; stop: string; say: string; ashore: { name: string; say: string } }>>('places.json');
  const starts = read<Array<Spot & { id: string; route: Spot[] }>>('starts.json');
  const races = read<Array<{ id: string; name: string; marks: Spot[] }>>('races.json');
  const times = read<Array<{ id: string; hours: number; default?: boolean }>>('times.json');
  /** The tide falls a quarter of a metre below the datum, and a leg wants four metres under it then. */
  const need = 4 + Math.max(0, -Math.min(...course.tide.truth));
  const shallowest = (a: Spot, b: Spot) => {
    let least = Infinity;
    const steps = Math.max(200, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 25));
    for (let k = 0; k <= steps; k++) least = Math.min(least, world.chartDepth(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps));
    return least;
  };

  it('has the stops the islands are known for, each afloat and close under the land', () => {
    const ids = places.map((p) => p.id);
    for (const id of ['bight', 'caves', 'indians', 'cooper', 'baths', 'spanish', 'leverick', 'bitterend', 'saba', 'trellis', 'cane', 'greatharbour', 'whitebay', 'sandycay', 'sopers', 'roadtown', 'nannycay']) expect(ids, id).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of places) {
      // Water enough for the deepest boat at the lowest tide.
      expect(world.chartDepth(p.x, p.y), p.name).toBeGreaterThan(3.5);
      expect(world.chartDepth(p.x, p.y), p.name).toBeLessThan(25);
      let nearLand = false;
      for (let dx = -600; dx <= 600 && !nearLand; dx += 100) for (let dy = -600; dy <= 600 && !nearLand; dy += 100) nearLand = world.chartDepth(p.x + dx, p.y + dy) === 0;
      expect(nearLand, p.name).toBe(true);
      expect(['mooring', 'dock', 'anchorage'], p.name).toContain(p.kind);
      expect(['bar', 'beach', 'snorkel', 'marina'], p.name).toContain(p.stop);
      expect(p.say.length, p.name).toBeGreaterThan(30);
      expect(p.ashore.say.length, p.name).toBeGreaterThan(20);
    }
    // A bar hop wants bars.
    expect(places.filter((p) => p.stop === 'bar').length).toBeGreaterThanOrEqual(8);
  });

  it('starts at Road Town, the Bight, North Sound and Great Harbour, each in clear water with a clear route', () => {
    expect(starts.map((s) => s.id)).toEqual(['roadtown', 'bight', 'northsound', 'greatharbour']);
    for (const s of starts) {
      expect(world.chartDepth(s.x, s.y), s.name).toBeGreaterThan(8);
      let from: Spot = s;
      for (const mark of s.route) {
        expect(shallowest(from, mark), `${s.name}: ${from.name} to ${mark.name}`).toBeGreaterThanOrEqual(need);
        from = mark;
      }
    }
  });

  it('has a sprint, a course round the islands and a long passage, with water all the way round each', () => {
    expect(races.map((r) => r.id)).toEqual(['channel-sprint', 'round-the-islands', 'bar-to-bar']);
    const miles = races.map((r) => {
      let total = 0;
      for (let k = 1; k < r.marks.length; k++) {
        expect(shallowest(r.marks[k - 1], r.marks[k]), `${r.name}: ${r.marks[k - 1].name} to ${r.marks[k].name}`).toBeGreaterThanOrEqual(need);
        total += Math.hypot(r.marks[k].x - r.marks[k - 1].x, r.marks[k].y - r.marks[k - 1].y);
      }
      return total / 1852;
    });
    expect(miles[0]).toBeLessThan(10);
    expect(miles[1]).toBeGreaterThan(12);
    expect(miles[2]).toBeGreaterThan(24);
    // The passage runs the channel from west to east.
    const passage = races[2].marks;
    expect(passage[passage.length - 1].x - passage[0].x).toBeGreaterThan(30000);
  });

  it('offers start times inside the recorded day, one of them the default', () => {
    expect(times.filter((t) => t.default).length).toBe(1);
    for (const t of times) {
      expect(t.hours).toBeGreaterThan(0);
      // Daylight on the first day: sunset is a little after six, ten hours in.
      expect(t.hours).toBeLessThan(9.5);
    }
  });
});
