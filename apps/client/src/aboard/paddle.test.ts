/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, type CourseData } from '@slack-tide/world';
import {
  BOARD_RANGE, DOCK_RANGE, TOP_SPEED, WALK_RANGE,
  call, fendOff, groundHeight, landing, launchSpot, newCanoe, rangeAndBearing, stepCanoe, touchingShore,
  type Paddling, type Shore, type Water,
} from './paddle';

const KT = 0.514444;
const D2R = Math.PI / 180;
const still: Water = { current: () => ({ x: 0, y: 0 }), wind: () => ({ dir: 0, speed: 0 }), land: () => false };
const ahead: Paddling = { ahead: 1, steer: 0 };
const rest: Paddling = { ahead: 0, steer: 0 };
/** Step at the frame rate, as the game does. */
const run = (c: ReturnType<typeof newCanoe>, input: Paddling, seconds: number, water: Water = still) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) stepCanoe(c, input, 1 / 60, water);
};

describe('paddling the outrigger', () => {
  it('works up to about four knots, and not at once', () => {
    const c = newCanoe(0, 0, 0);
    run(c, ahead, 1.5);
    expect(c.speed / KT).toBeGreaterThan(0.8);
    expect(c.speed / KT).toBeLessThan(2.2);
    run(c, ahead, 25);
    expect(c.speed / KT).toBeGreaterThan(3.7);
    expect(c.speed / KT).toBeLessThan(4.1);
    expect(c.speed).toBeLessThanOrEqual(TOP_SPEED);
    // Due north: all of it went into y.
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.y).toBeGreaterThan(35);
  });

  it('glides on when the paddle comes out, and stops in the end', () => {
    const c = newCanoe(0, 0, 0);
    run(c, ahead, 25);
    const y0 = c.y;
    run(c, rest, 3);
    expect(c.speed / KT).toBeGreaterThan(1.5);
    expect(c.speed / KT).toBeLessThan(3);
    run(c, rest, 60);
    expect(c.speed).toBe(0);
    // A canoe length or three of carry.
    expect(c.y - y0).toBeGreaterThan(8);
    expect(c.y - y0).toBeLessThan(30);
  });

  it('backs more slowly than she goes ahead', () => {
    const c = newCanoe(0, 0, 0);
    run(c, { ahead: -1, steer: 0 }, 25);
    expect(c.speed).toBeLessThan(0);
    expect(-c.speed / KT).toBeGreaterThan(2);
    expect(-c.speed / KT).toBeLessThan(3.4);
    expect(c.y).toBeLessThan(0);
  });

  it('turns to the side asked for, at rest and faster with way on', () => {
    const atRest = newCanoe(0, 0, 0);
    run(atRest, { ahead: 0, steer: 1 }, 4);
    expect(atRest.heading / D2R).toBeGreaterThan(60);
    expect(atRest.heading / D2R).toBeLessThan(110);
    // Spinning on the spot she goes nowhere.
    expect(Math.hypot(atRest.x, atRest.y)).toBeLessThan(0.5);

    const moving = newCanoe(0, 0, 0);
    run(moving, ahead, 20);
    moving.heading = 0;
    run(moving, { ahead: 1, steer: 1 }, 4);
    expect(moving.heading).toBeGreaterThan(atRest.heading);

    const port = newCanoe(0, 0, 0);
    run(port, { ahead: 0, steer: -1 }, 4);
    expect(port.heading / D2R).toBeGreaterThan(250);
    expect(port.heading / D2R).toBeLessThan(300);
  });

  it('loses some way in a turn', () => {
    const straight = newCanoe(0, 0, 0);
    const turning = newCanoe(0, 0, 0);
    run(straight, ahead, 30);
    run(turning, { ahead: 1, steer: 1 }, 30);
    expect(turning.speed).toBeLessThan(straight.speed * 0.9);
    expect(turning.speed / KT).toBeGreaterThan(2);
  });

  it('is carried by all of the stream and a little of the wind', () => {
    const inStream = newCanoe(0, 0, 0);
    run(inStream, rest, 10, { ...still, current: () => ({ x: 1.2, y: -0.5 }) });
    expect(inStream.x).toBeCloseTo(12, 1);
    expect(inStream.y).toBeCloseTo(-5, 1);
    expect(inStream.speed).toBe(0);

    // Twenty knots from the north sets her south at under half a knot.
    const inWind = newCanoe(0, 0, 0);
    run(inWind, rest, 10, { ...still, wind: () => ({ dir: 0, speed: 20 * KT }) });
    expect(inWind.x).toBeCloseTo(0, 6);
    expect(inWind.y).toBeLessThan(-1);
    expect(inWind.y).toBeGreaterThan(-2.6);
  });

  it('is swept down a strong stream if she points straight across it', () => {
    // Three knots running east. Two hundred metres to cross.
    const water: Water = { ...still, current: () => ({ x: 3 * KT, y: 0 }) };
    const c = newCanoe(0, 0, 0);
    let t = 0;
    for (; c.y < 200 && t < 600; t += 1 / 60) stepCanoe(c, ahead, 1 / 60, water);
    expect(t).toBeLessThan(120);
    expect(c.x).toBeGreaterThan(120);
    // Pointing up into it, she holds a much better line.
    const ferry = newCanoe(0, 0, -45 * D2R);
    for (t = 0; ferry.y < 200 && t < 600; t += 1 / 60) stepCanoe(ferry, ahead, 1 / 60, water);
    expect(Math.abs(ferry.x)).toBeLessThan(40);
  });

  it('gives the same answer from one long frame as from many short ones', () => {
    const a = newCanoe(0, 0, 0.3);
    const b = newCanoe(0, 0, 0.3);
    run(a, { ahead: 1, steer: 1 }, 2);
    stepCanoe(b, { ahead: 1, steer: 1 }, 1, still);
    stepCanoe(b, { ahead: 1, steer: 1 }, 1, still);
    expect(b.x).toBeCloseTo(a.x, 1);
    expect(b.y).toBeCloseTo(a.y, 1);
    expect(b.heading).toBeCloseTo(a.heading, 1);
  });
});

describe('the shore', () => {
  /** Land everywhere north of y = 50. */
  const coast: Water = { ...still, land: (_x, y) => y > 50 };

  it('stops her at the water\'s edge', () => {
    const c = newCanoe(0, 0, 0);
    run(c, ahead, 60, coast);
    expect(c.y).toBeLessThanOrEqual(50);
    expect(c.y).toBeGreaterThan(49.8);
    expect(c.beached).toBe(true);
    expect(Math.abs(c.speed)).toBeLessThan(0.3);
    expect(coast.land(c.x, c.y)).toBe(false);
  });

  it('holds her where she runs up at an angle, and lets her back off or turn away', () => {
    const c = newCanoe(0, 40, 45 * D2R);
    run(c, ahead, 30, coast);
    expect(c.y).toBeLessThanOrEqual(50);
    expect(c.beached).toBe(true);
    // She has crept along the beach a little, no more.
    expect(c.x).toBeGreaterThan(10);
    expect(c.x).toBeLessThan(20);
    const backing = { ...c };
    run(backing, { ahead: -1, steer: 0 }, 6, coast);
    expect(backing.beached).toBe(false);
    expect(backing.y).toBeLessThan(49);
    // Or bring her head round to seaward and paddle off.
    run(c, { ahead: 0, steer: 1 }, 4.5, coast);
    run(c, ahead, 8, coast);
    expect(c.beached).toBe(false);
    expect(c.y).toBeLessThan(45);
  });

  it('is not carried onto the land by the stream', () => {
    const c = newCanoe(0, 45, 90 * D2R);
    run(c, rest, 60, { ...coast, current: () => ({ x: 0.2, y: 1 }) });
    expect(c.y).toBeLessThanOrEqual(50);
    expect(c.x).toBeGreaterThan(10);
  });

  it('can be backed off a lee shore, and paddled off it', () => {
    // Twenty knots blowing straight onto the beach, and a little stream setting on as well.
    const lee: Water = { ...coast, wind: () => ({ dir: 180 * D2R, speed: 20 * KT }), current: () => ({ x: 0, y: 0.1 }) };
    const c = newCanoe(0, 30, 0);
    run(c, ahead, 40, lee);
    expect(c.beached).toBe(true);
    // Left alone she stays put, pinned by the wind.
    run(c, rest, 10, lee);
    expect(c.beached).toBe(true);
    expect(c.y).toBeGreaterThan(49.5);
    const backing = { ...c };
    run(backing, { ahead: -1, steer: 0 }, 10, lee);
    expect(backing.beached).toBe(false);
    expect(backing.y).toBeLessThan(47);
    // With her head brought round to seaward, she can be driven off.
    c.heading = 135 * D2R;
    run(c, { ahead: 1, steer: 0 }, 15, lee);
    expect(c.beached).toBe(false);
    expect(c.y).toBeLessThan(48);
  });

  it('does not hold her if she starts on the land', () => {
    const c = newCanoe(0, 53, 180 * D2R);
    run(c, ahead, 10, coast);
    expect(c.y).toBeLessThan(50);
  });

  it('knows when she is touching', () => {
    expect(touchingShore(0, 46, coast.land)).toBe(true);
    expect(touchingShore(0, 40, coast.land)).toBe(false);
  });

  it('reads the height of the drawn ground off its triangles', () => {
    // Two cells by one. Corners: south row -6, 4, 10. North row -6, -6, 20.
    const grid = { x0: 0, y0: 0, dx: 80, nx: 3, ny: 2, stride: 3, offset: 1, data: [0, -6, 0, 0, 4, 0, 0, 10, 0, 0, -6, 0, 0, -6, 0, 0, 20, 0] };
    expect(groundHeight(grid, 0, 0)).toBe(-6);
    expect(groundHeight(grid, 80, 0)).toBe(4);
    expect(groundHeight(grid, 160, 80)).toBe(20);
    expect(groundHeight(grid, 40, 0)).toBeCloseTo(-1, 6);
    // On the diagonal of the first cell, half way between the south-east corner (4) and the north-west (-6).
    expect(groundHeight(grid, 40, 40)).toBeCloseTo(-1, 6);
    expect(groundHeight(grid, 500, 0)).toBe(-6);
    expect(groundHeight(grid, -1, 10)).toBe(-6);
  });
});

describe('where she can land', () => {
  const coast = (_x: number, y: number) => y > 50;
  const bar: Shore = { id: 'bar', x: 0, y: 40, ashore: { name: 'the bar', say: 'A round.' } };
  const far: Shore = { id: 'far', x: 200, y: 45, ashore: { name: 'the other bar', say: 'Another.' } };
  const buoy: Shore = { id: 'buoy', x: 0, y: 0 };
  const places = [buoy, bar, far];

  it('takes a place from the water close to its point', () => {
    const l = landing(newCanoe(0, 40 - DOCK_RANGE + 5, 0), places, coast);
    expect(l.kind).toBe('place');
    expect(l.kind === 'place' && l.place.id).toBe('bar');
  });

  it('has nothing for her out in the water', () => {
    expect(landing(newCanoe(70, -30, 0), places, coast).kind).toBe('none');
    // A place with nothing ashore is not a landing, however close.
    expect(landing(newCanoe(0, 0, 0), [buoy], coast).kind).toBe('none');
  });

  it('takes a place from the shore within a walk of it, and the nearer of two', () => {
    const c = newCanoe(110, 49, 0);
    c.beached = true;
    const l = landing(c, places, coast);
    expect(l.kind === 'place' && l.place.id).toBe('far');
    const d = newCanoe(-WALK_RANGE + 20, 49, 0);
    const m = landing(d, places, coast);
    expect(m.kind === 'place' && m.place.id).toBe('bar');
  });

  it('is only a beach when no place is within a walk', () => {
    expect(landing(newCanoe(-WALK_RANGE - 30, 48, 0), places, coast).kind).toBe('beach');
  });

  it('wants most of the way off her first', () => {
    const c = newCanoe(0, 20, 0);
    c.speed = 1.6;
    expect(landing(c, places, coast).kind).toBe('fast');
    c.speed = 0.5;
    expect(landing(c, places, coast).kind).toBe('place');
  });

  it('gives range and bearing the navigator\'s way', () => {
    expect(rangeAndBearing(0, 0, 0, 100)).toEqual({ range: 100, bearing: 0 });
    expect(rangeAndBearing(0, 0, 100, 0).bearing).toBe(90);
    expect(rangeAndBearing(0, 0, -100, -100).bearing).toBe(225);
    expect(rangeAndBearing(0, 0, -0.001, 100).bearing).toBe(0);
  });

  it('reads the O key: aboard by the yacht, ashore by a shore, otherwise the way back', () => {
    const yacht = { x: 0, y: -400 };
    expect(call(newCanoe(BOARD_RANGE - 3, -400, 0), yacht, places, coast).do).toBe('board');
    // Alongside the yacht wins even where a landing is in reach.
    expect(call(newCanoe(5, 30, 0), { x: 0, y: 30 }, places, coast).do).toBe('board');

    const land = call(newCanoe(0, 30, 0), yacht, places, coast);
    expect(land.do === 'land' && land.place?.id).toBe('bar');
    const beach = call(newCanoe(-600, 48, 0), yacht, places, coast);
    expect(beach.do === 'land' && beach.place).toBe(null);

    const quick = newCanoe(0, 30, 0);
    quick.speed = 2;
    expect(call(quick, yacht, places, coast).do).toBe('slow');

    const lost = call(newCanoe(400, -400, 0), yacht, places, coast);
    expect(lost).toEqual({ do: 'nothing', range: 400, bearing: 270, far: true });
    const near = call(newCanoe(100, -400, 0), yacht, places, coast);
    expect(near.do === 'nothing' && near.far).toBe(false);
  });
});

describe('the yacht she belongs to', () => {
  const yacht = { x: 100, y: 200, heading: 90 * D2R, loa: 11.6, beam: 3.8 };

  it('launches her alongside to port, pointing the same way', () => {
    const s = launchSpot(yacht, () => false);
    // Heading east, port is north.
    expect(s.x).toBeCloseTo(100, 6);
    expect(s.y).toBeCloseTo(200 + 1.9 + 1.3, 6);
    expect(s.heading).toBe(yacht.heading);
  });

  it('launches her on the other side when the shore is to port', () => {
    const s = launchSpot(yacht, (_x, y) => y > 201);
    expect(s.y).toBeLessThan(198);
  });

  it('keeps her out of the hull', () => {
    const c = newCanoe(102, 200.5, 0);
    fendOff(c, yacht);
    expect(c.y).toBeCloseTo(200 + 1.9 + 0.55, 6);
    expect(c.x).toBeCloseTo(102, 6);
    // Off the bow, the keep-clear line is rounded.
    const bow = newCanoe(100 + 5.8, 200, 0);
    fendOff(bow, yacht);
    expect(bow.x).toBeGreaterThan(100 + 5.8);
    // Well clear, nothing happens.
    const clear = newCanoe(100, 210, 0);
    fendOff(clear, yacht);
    expect(clear).toMatchObject({ x: 100, y: 210 });
  });

  it('cannot be paddled through her', () => {
    const c = newCanoe(100, 215, 180 * D2R);
    for (let t = 0; t < 30; t += 1 / 60) stepCanoe(c, ahead, 1 / 60, still, yacht);
    expect(c.y).toBeGreaterThanOrEqual(200 + 1.9 + 0.55 - 1e-6);
  });
});

// Against the real Bay, so a change to the places or the baked course that would strand the canoe shows up here.
describe('on the Bay', () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../courses/sf-bay');
  const course = JSON.parse(readFileSync(resolve(dir, 'course.json'), 'utf8')) as CourseData;
  const bin = (name: string) => readFileSync(resolve(dir, name));
  const world = new ReplayWorld({ course, current: new Int8Array(bin('current.bin').buffer.slice(0)), depth: new Uint8Array(bin('depth.bin').buffer.slice(0)) }, 0);
  const places = JSON.parse(readFileSync(resolve(dir, 'places.json'), 'utf8')) as Array<Shore & { name: string }>;
  const land = (x: number, y: number) => world.chartDepth(x, y) <= 0;
  const bay = (t: number): Water => ({ current: (x, y) => ({ ...world.current(x, y, t) }), wind: (x, y) => world.gustyWind(x, y, t), land });

  it('has somewhere to go ashore at every place, reached from the place\'s own point', () => {
    const withBars = places.filter((p) => p.ashore);
    expect(withBars.length).toBeGreaterThanOrEqual(8);
    for (const p of withBars) {
      expect(land(p.x, p.y), p.id).toBe(false);
      const l = landing(newCanoe(p.x, p.y, 0), places, land);
      expect(l.kind === 'place' && l.place.id, p.id).toBe(p.id);
    }
  });

  it('gets from an anchorage off Sam\'s to the deck in a couple of minutes', () => {
    const sams = places.find((p) => p.id === 'sams')!;
    const c = newCanoe(sams.x + 60, sams.y - 220, 0);
    const water = bay(3 * 3600);
    let t = 0;
    for (; t < 600; t += 0.1) {
      // Point at the place and paddle. Ease up close in.
      const want = Math.atan2(sams.x - c.x, sams.y - c.y);
      const off = Math.atan2(Math.sin(want - c.heading), Math.cos(want - c.heading));
      const range = Math.hypot(sams.x - c.x, sams.y - c.y);
      stepCanoe(c, { ahead: range > 45 ? 1 : 0, steer: Math.abs(off) > 0.05 ? Math.sign(off) : 0 }, 0.1, water);
      const l = landing(c, places, land);
      if (l.kind === 'place') break;
    }
    expect(t).toBeGreaterThan(60);
    expect(t).toBeLessThan(240);
    const l = landing(c, places, land);
    expect(l.kind === 'place' && l.place.id).toBe('sams');
    expect(land(c.x, c.y)).toBe(false);
  });

  it('cannot be paddled up onto Angel Island', () => {
    // From Ayala Cove, due south into the island.
    const ayala = places.find((p) => p.id === 'ayala')!;
    const c = newCanoe(ayala.x, ayala.y, 180 * D2R);
    for (let t = 0; t < 400; t += 0.1) stepCanoe(c, ahead, 0.1, bay(3 * 3600));
    expect(land(c.x, c.y)).toBe(false);
    expect(c.beached).toBe(true);
    expect(Math.hypot(c.x - ayala.x, c.y - ayala.y)).toBeLessThan(WALK_RANGE);
    // The beach has taken the way off her, so she can be landed where she lies.
    expect(Math.abs(c.speed)).toBeLessThan(0.5);
    const l = landing(c, places, land);
    expect(l.kind === 'place' && l.place.id).toBe('ayala');
  });
});
