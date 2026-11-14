import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, type CourseData } from '../src';

// Sanity checks on the baked San Juan Islands course: the passes run and turn, the wind is a real wind,
// land is land and water is water.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../courses/san-juans');
const course = JSON.parse(readFileSync(resolve(dir, 'course.json'), 'utf8')) as CourseData;
const bin = (name: string) => readFileSync(resolve(dir, name));
const data = { course, current: new Int8Array(bin('current.bin').buffer.slice(0)), depth: new Uint8Array(bin('depth.bin').buffer.slice(0)) };
const KT = 0.514444;
/** Seconds into the season for a local clock time on the first day (the season starts at 08:00 PDT). */
const clock = (hour: number) => (hour - 8) * 3600;
/** Metres east and north of the course origin for a latitude and longitude. */
const at = (lat: number, lon: number): [number, number] => [
  (lon - course.origin.lon) * 111195 * Math.cos((course.origin.lat * Math.PI) / 180),
  (lat - course.origin.lat) * 111195,
];

// Places from general knowledge of the islands.
const CATTLE_PASS = at(48.4535, -122.9551);
const SPIEDEN_CHANNEL = at(48.6234, -123.1156);
const SAN_JUAN_CHANNEL = at(48.528, -122.9646);
const ROSARIO_STRAIT = at(48.6, -122.755);
const MOUNT_CONSTITUTION = at(48.677, -122.831);
const MIDDLE_OF_SAN_JUAN_ISLAND = at(48.53, -123.09);
const MIDDLE_OF_LOPEZ = at(48.48, -122.89);

describe('San Juan Islands replay, 25 and 26 June 2025', () => {
  const world = new ReplayWorld(data, 0);

  it('starts at 08:00 Pacific on 25 June 2025 and holds 36 hours', () => {
    expect(course.id).toBe('san-juans');
    expect(world.dateAt(0).toISOString()).toBe('2025-06-25T15:00:00.000Z');
    expect(world.seasonLength).toBe(36 * 3600);
    expect(course.wind.truth.length).toBe(37);
    expect(course.tide.truth.length).toBe(37);
  });

  it('has a big tide at Friday Harbor: low late in the morning, high in the evening', () => {
    const levels = Array.from({ length: 14 }, (_, h) => world.tide(h * 3600));
    const low = Math.min(...levels);
    const high = Math.max(...levels);
    expect(high - low).toBeGreaterThan(3);
    expect(high - low).toBeLessThan(4.5);
    expect(levels.indexOf(low)).toBeGreaterThanOrEqual(2);
    expect(levels.indexOf(low)).toBeLessThanOrEqual(5);
    expect(levels.indexOf(high)).toBeGreaterThanOrEqual(11);
  });

  it('runs south through Cattle Pass on the ebb and north on the flood, at a believable rate', () => {
    const [x, y] = CATTLE_PASS;
    const ebb = world.current(x, y, clock(9), { x: 0, y: 0 });
    const flood = world.current(x, y, clock(16), { x: 0, y: 0 });
    expect(ebb.y / KT).toBeLessThan(-2);
    expect(flood.y / KT).toBeGreaterThan(3);
    let fastest = 0;
    for (let h = 0; h <= 36; h += 0.5) {
      const c = world.current(x, y, h * 3600);
      fastest = Math.max(fastest, Math.hypot(c.x, c.y) / KT);
    }
    expect(fastest).toBeGreaterThan(4);
    expect(fastest).toBeLessThan(8);
  });

  it('turns in Spieden Channel too: west on the ebb, east on the flood', () => {
    const [x, y] = SPIEDEN_CHANNEL;
    expect(world.current(x, y, clock(9), { x: 0, y: 0 }).x / KT).toBeLessThan(-1.5);
    expect(world.current(x, y, clock(16), { x: 0, y: 0 }).x / KT).toBeGreaterThan(1);
  });

  it('goes slack between the two', () => {
    const [x, y] = CATTLE_PASS;
    let slackest = 99;
    for (let h = 2; h <= 6; h += 0.1) {
      const c = world.current(x, y, h * 3600);
      slackest = Math.min(slackest, Math.hypot(c.x, c.y) / KT);
    }
    expect(slackest).toBeLessThan(0.8);
  });

  it('blows a sailing breeze from the south in San Juan Channel through the day', () => {
    const [x, y] = SAN_JUAN_CHANNEL;
    for (const hour of [10, 13, 16]) {
      const w = world.wind(x, y, clock(hour));
      expect(w.speed / KT).toBeGreaterThan(6);
      expect(w.speed / KT).toBeLessThan(20);
      const from = (w.dir * 180) / Math.PI;
      expect(from).toBeGreaterThan(130);
      expect(from).toBeLessThan(230);
    }
  });

  it('keeps every wind and gust on the grid within what a summer day can do', () => {
    for (const step of course.wind.truth) {
      for (let k = 0; k < step.u.length; k++) {
        const speed = Math.hypot(step.u[k], step.v[k]) * course.wind.scale;
        expect(speed).toBeLessThan(18);
        expect(step.g![k] * course.wind.scale).toBeGreaterThanOrEqual(speed - 0.15);
        expect(step.g![k] * course.wind.scale).toBeLessThan(25);
      }
    }
  });

  it('knows land from water', () => {
    expect(world.chartDepth(...MOUNT_CONSTITUTION)).toBe(0);
    expect(world.chartDepth(...MIDDLE_OF_SAN_JUAN_ISLAND)).toBe(0);
    expect(world.chartDepth(...MIDDLE_OF_LOPEZ)).toBe(0);
    expect(world.chartDepth(...SAN_JUAN_CHANNEL)).toBeGreaterThan(30);
    expect(world.chartDepth(...ROSARIO_STRAIT)).toBeGreaterThan(30);
    expect(world.chartDepth(...CATTLE_PASS)).toBeGreaterThan(15);
  });

  it('has no stream over the land', () => {
    const c = world.current(...MOUNT_CONSTITUTION, clock(16), { x: 0, y: 0 });
    expect(Math.hypot(c.x, c.y)).toBe(0);
  });

  it('puts every town, island and point on or beside land and every buoy afloat', () => {
    for (const m of course.marks) {
      if (m.kind === 'buoy') expect(world.chartDepth(m.x, m.y), m.name).toBeGreaterThan(4);
      else {
        // Within 400 m of land: a name sits on its island, a town on its waterfront.
        let nearLand = false;
        for (let dx = -400; dx <= 400 && !nearLand; dx += 100) for (let dy = -400; dy <= 400 && !nearLand; dy += 100) nearLand = world.chartDepth(m.x + dx, m.y + dy) === 0;
        expect(nearLand, m.name).toBe(true);
      }
    }
  });
});
