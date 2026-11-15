import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, type CourseData } from '../src';

// Sanity checks on the baked Gulf of the Farallones: the ocean outside the Golden Gate. It shares the Bay's origin and its
// 36 hours, is baked from two tide models, and is the first water with insets: finer grids over the Gate and the harbours.
const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../../../courses/farallones');
const course = JSON.parse(readFileSync(resolve(dir, 'course.json'), 'utf8')) as CourseData;
const bin = (name: string, from = dir) => readFileSync(resolve(from, name));
const data = { course, current: new Int8Array(bin('current.bin').buffer.slice(0)), depth: new Uint8Array(bin('depth.bin').buffer.slice(0)) };
const KT = 0.514444;
/** Seconds into the season for a local clock time on the first day (the season starts at 08:00 PDT). */
const clock = (hour: number) => (hour - 8) * 3600;
const at = (lat: number, lon: number): [number, number] => [
  (lon - course.origin.lon) * 111195 * Math.cos((course.origin.lat * Math.PI) / 180),
  (lat - course.origin.lat) * 111195,
];

const GATE: [number, number] = [-2512, -1145];
const POTATO_PATCH: [number, number] = [-11500, -1200];
const SHIP_CHANNEL: [number, number] = [-14000, -6320];
const SEA_BUOY = at(37.75, -122.693);
const SE_FARALLON = at(37.6989, -123.0034);
const POINT_REYES_HEADLAND = at(38.0, -123.0);
const INVERNESS_RIDGE = at(38.06, -122.86);
const DRAKES_BAY: [number, number] = [-45400, 19300];
const BODEGA_HEAD = at(38.305, -123.063);
const BODEGA_CHANNEL: [number, number] = [-52900, 54800];
const BODEGA_MUD: [number, number] = [-52500, 54800];
const PILLAR_POINT_HARBOR: [number, number] = [-3100, -36900];
const OPEN_OCEAN: [number, number] = [-58000, 20000];
const MOUNT_TAMALPAIS = at(37.9235, -122.5965);

describe('Gulf of the Farallones replay, 14 and 15 July 2024', () => {
  const world = new ReplayWorld(data, 0);

  it('is the same 36 hours as the Bay, from the same origin', () => {
    const bay = JSON.parse(readFileSync(resolve(here, '../../../courses/sf-bay/course.json'), 'utf8')) as CourseData;
    expect(course.id).toBe('farallones');
    expect(course.season.start).toBe(bay.season.start);
    expect(course.season.hours).toBe(bay.season.hours);
    expect(course.origin).toEqual(bay.origin);
    expect(course.bridge).toEqual(bay.bridge);
    expect(world.dateAt(0).toISOString()).toBe('2024-07-14T15:00:00.000Z');
    expect(course.wind.truth.length).toBe(37);
    // One tide for both: the Presidio's.
    expect(course.tide.truth).toEqual(bay.tide.truth);
  });

  it('reaches from inside the Golden Gate to the Farallones, Bodega and Pillar Point', () => {
    const b = course.bounds;
    for (const [x, y] of [GATE, SEA_BUOY, SE_FARALLON, BODEGA_HEAD, PILLAR_POINT_HARBOR, DRAKES_BAY]) {
      expect(x).toBeGreaterThan(b.x0);
      expect(x).toBeLessThan(b.x1);
      expect(y).toBeGreaterThan(b.y0);
      expect(y).toBeLessThan(b.y1);
    }
    expect(b.x1 - b.x0).toBeGreaterThan(60000);
    expect(b.y1 - b.y0).toBeGreaterThan(95000);
  });

  it('keeps its files near the size of the other waters', () => {
    const size = (id: string) => ['course.json', 'current.bin', 'depth.bin', 'terrain.bin'].reduce((sum, f) => sum + bin(f, resolve(here, '../../../courses', id)).length, 0);
    expect(size('farallones')).toBeLessThan(size('san-juans'));
    expect(size('farallones')).toBeLessThan(size('sf-bay') * 1.5);
  });

  it('has insets, and every grid accounts for its data', () => {
    expect(course.current.insets!.length).toBe(1);
    expect(course.depth.insets!.length).toBeGreaterThanOrEqual(4);
    expect(course.terrain.insets!.length).toBeGreaterThanOrEqual(3);
    const cells = (g: { nx: number; ny: number }) => g.nx * g.ny;
    expect(data.depth.length).toBe(cells(course.depth) + course.depth.insets!.reduce((n, g) => n + cells(g), 0));
    expect(data.current.length).toBe((cells(course.current) + course.current.insets!.reduce((n, g) => n + cells(g), 0)) * course.current.steps * 2);
    expect(bin('terrain.bin').length).toBe(cells(course.terrain) + course.terrain.insets!.reduce((n, g) => n + cells(g), 0));
    // An inset is finer than the grid it refines and lies inside it.
    for (const key of ['current', 'depth', 'terrain'] as const) {
      const main = course[key];
      for (const g of main.insets!) {
        expect(g.dx).toBeLessThan(main.dx);
        expect(g.x0).toBeGreaterThanOrEqual(main.x0);
        expect(g.x0 + (g.nx - 1) * g.dx).toBeLessThanOrEqual(main.x0 + (main.nx - 1) * main.dx);
        expect(g.y0).toBeGreaterThanOrEqual(main.y0);
        expect(g.y0 + (g.ny - 1) * g.dx).toBeLessThanOrEqual(main.y0 + (main.ny - 1) * main.dx);
      }
    }
  });

  it('rejects data that does not match its grids, insets included', () => {
    expect(() => new ReplayWorld({ ...data, depth: data.depth.subarray(0, course.depth.nx * course.depth.ny) }, 0)).toThrow();
    expect(() => new ReplayWorld({ ...data, current: data.current.subarray(0, course.current.nx * course.current.ny * course.current.steps * 2) }, 0)).toThrow();
  });

  it('runs out of the Gate on the ebb and in on the flood, as the Bay does', () => {
    const ebb = world.current(...GATE, clock(10), { x: 0, y: 0 });
    const flood = world.current(...GATE, clock(17), { x: 0, y: 0 });
    expect(ebb.x / KT).toBeLessThan(-1.2);
    expect(flood.x / KT).toBeGreaterThan(1);
    let fastest = 0;
    for (let h = 0; h <= 36; h += 0.5) {
      const c = world.current(...GATE, h * 3600);
      fastest = Math.max(fastest, Math.hypot(c.x, c.y) / KT);
    }
    expect(fastest).toBeGreaterThan(1.8);
    expect(fastest).toBeLessThan(6);
  });

  it('reads the Gate from its fine inset: the stream differs across a channel the coarse grid cannot split', () => {
    // 400 m apart, inside one cell of the 1 km grid.
    let apart = 0;
    for (let h = 1; h <= 6; h++) {
      const a = world.current(-2512, -1345, h * 3600, { x: 0, y: 0 });
      const b = world.current(-2512, -945, h * 3600, { x: 0, y: 0 });
      apart = Math.max(apart, Math.hypot(a.x - b.x, a.y - b.y));
    }
    expect(apart).toBeGreaterThan(0.05);
  });

  it('has no step in the stream at the edge of the inset', () => {
    const g = course.current.insets![0];
    let worst = 0;
    for (let h = 0; h <= 36; h += 3) {
      for (let y = g.y0 + 500; y < g.y0 + (g.ny - 1) * g.dx; y += 700) {
        const inside = world.current(g.x0 + 1, y, h * 3600, { x: 0, y: 0 });
        const outside = world.current(g.x0 - 1, y, h * 3600, { x: 0, y: 0 });
        worst = Math.max(worst, Math.hypot(inside.x - outside.x, inside.y - outside.y));
      }
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('carries the ebb out over the bar, and runs harder there at night than the Gate does', () => {
    // The big ebb of the season is in the small hours of the second day.
    const bar = world.current(...SHIP_CHANNEL, clock(26), { x: 0, y: 0 });
    expect(bar.x / KT).toBeLessThan(-1.5);
    expect(Math.hypot(bar.x, bar.y) / KT).toBeLessThan(5);
  });

  it('has a stream at the Farallones and off Bodega, from the outer model, and it is an ocean stream: slow', () => {
    for (const [x, y] of [[SE_FARALLON[0] + 2500, SE_FARALLON[1]], [BODEGA_HEAD[0] - 3000, BODEGA_HEAD[1]], OPEN_OCEAN] as Array<[number, number]>) {
      let fastest = 0;
      let slowest = 9;
      for (let h = 0; h <= 36; h++) {
        const c = world.current(x, y, h * 3600);
        fastest = Math.max(fastest, Math.hypot(c.x, c.y) / KT);
        slowest = Math.min(slowest, Math.hypot(c.x, c.y) / KT);
      }
      expect(fastest).toBeGreaterThan(0.1);
      expect(fastest).toBeLessThan(2);
    }
  });

  it('has no step in the stream where one tide model hands over to the other', () => {
    // Walk west from the bar to the open ocean along three lines. No two points 500 m apart differ by half a knot.
    for (const y of [-9000, 0, 9000]) {
      for (let h = 0; h <= 36; h += 4) {
        let before = world.current(-20000, y, h * 3600, { x: 0, y: 0 });
        for (let x = -20500; x > -64000; x -= 500) {
          const c = world.current(x, y, h * 3600, { x: 0, y: 0 });
          expect(Math.hypot(c.x - before.x, c.y - before.y) / KT, `at ${x}, ${y}, hour ${h}`).toBeLessThan(0.5);
          before = c;
        }
      }
    }
  });

  it('has the tide of the day: half a metre below the datum to nearly a metre above', () => {
    const levels = Array.from({ length: 37 }, (_, h) => world.tide(h * 3600));
    expect(Math.min(...levels)).toBeLessThan(-0.3);
    expect(Math.max(...levels)).toBeGreaterThan(0.7);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(2);
  });

  it('blows the afternoon sea breeze through the Gate and is lighter offshore, as it was that day', () => {
    const gate = world.wind(...GATE, clock(16));
    const offshore = world.wind(...OPEN_OCEAN, clock(16));
    expect(gate.speed / KT).toBeGreaterThan(10);
    expect(gate.speed / KT).toBeLessThan(25);
    const from = (gate.dir * 180) / Math.PI;
    expect(from).toBeGreaterThan(220);
    expect(from).toBeLessThan(300);
    expect(offshore.speed).toBeLessThan(gate.speed);
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
    expect(world.chartDepth(...MOUNT_TAMALPAIS)).toBe(0);
    expect(world.chartDepth(...POINT_REYES_HEADLAND)).toBe(0);
    expect(world.chartDepth(...BODEGA_HEAD)).toBe(0);
    expect(world.chartDepth(...SE_FARALLON)).toBe(0);
    expect(world.chartDepth(...GATE)).toBeGreaterThan(60);
    expect(world.chartDepth(...SEA_BUOY)).toBeGreaterThan(25);
    expect(world.chartDepth(...OPEN_OCEAN)).toBeGreaterThan(60);
    expect(world.chartDepth(...DRAKES_BAY)).toBeGreaterThan(5);
    expect(world.chartDepth(...DRAKES_BAY)).toBeLessThan(15);
  });

  it('charts the bar: the Potato Patch is four fathoms, the ship channel is dredged to 55 feet', () => {
    expect(world.chartDepth(...POTATO_PATCH)).toBeGreaterThan(6);
    expect(world.chartDepth(...POTATO_PATCH)).toBeLessThan(11.5);
    expect(world.chartDepth(...SHIP_CHANNEL)).toBeGreaterThan(16);
    // 700 m to either side of the channel the bar is shoaler than the channel.
    expect(world.chartDepth(SHIP_CHANNEL[0] + 190, SHIP_CHANNEL[1] - 700)).toBeLessThan(world.chartDepth(...SHIP_CHANNEL));
  });

  it('resolves the harbours from their insets: a channel through the mud at Bodega, shelter inside Pillar Point', () => {
    expect(world.chartDepth(...BODEGA_CHANNEL)).toBeGreaterThan(4.4);
    expect(world.chartDepth(...BODEGA_MUD)).toBeLessThan(1.5);
    expect(world.chartDepth(...PILLAR_POINT_HARBOR)).toBeGreaterThan(3);
    // The Farallones' shore is cut finely: deep water two hundred metres off the rock on the east side.
    expect(world.chartDepth(SE_FARALLON[0] + 600, SE_FARALLON[1])).toBeGreaterThan(10);
  });

  it('has no stream over the land', () => {
    // Well inland: the main stream grid is a kilometre, and a narrow headland takes a little from the water each side of it.
    for (const p of [MOUNT_TAMALPAIS, INVERNESS_RIDGE]) {
      const c = world.current(...p, clock(16), { x: 0, y: 0 });
      expect(Math.hypot(c.x, c.y)).toBe(0);
    }
  });

  it('puts every town, island and point on or beside land and every buoy afloat', () => {
    for (const m of course.marks) {
      if (m.kind === 'buoy') expect(world.chartDepth(m.x, m.y), m.name).toBeGreaterThan(10);
      else if (m.kind !== 'bridge' && m.kind !== 'bay') {
        let nearLand = false;
        for (let dx = -600; dx <= 600 && !nearLand; dx += 100) for (let dy = -600; dy <= 600 && !nearLand; dy += 100) nearLand = world.chartDepth(m.x + dx, m.y + dy) === 0;
        expect(nearLand, m.name).toBe(true);
      }
    }
  });
});

describe('a course without insets', () => {
  it('reads exactly as it did before insets existed', () => {
    const bayDir = resolve(here, '../../../courses/sf-bay');
    const bay = JSON.parse(readFileSync(resolve(bayDir, 'course.json'), 'utf8')) as CourseData;
    expect(bay.depth.insets).toBeUndefined();
    expect(bay.current.insets).toBeUndefined();
    const w = new ReplayWorld({ course: bay, current: new Int8Array(bin('current.bin', bayDir).buffer.slice(0)), depth: new Uint8Array(bin('depth.bin', bayDir).buffer.slice(0)) }, 0);
    // Outside the grid the sea is deep and still; inside, the Gate runs.
    expect(w.chartDepth(-99999, 0)).toBe(60);
    expect(w.chartDepth(...GATE)).toBeGreaterThan(60);
    expect(Math.hypot(w.current(...GATE, 3 * 3600).x, w.current(...GATE, 3 * 3600).y)).toBeGreaterThan(0.5);
  });
});
