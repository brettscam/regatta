/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, type CourseData } from '@slack-tide/world';
import {
  BAIT_TIDE, FAUNA, FIELD_GUIDE, FLOAT_BEAM, FLOAT_LENGTH, KINDS, SIGHT, WHALE_FLOOD,
  Sightings, baitAt, baitBalls, haulFloats, lookAbout, pathLength, pathPoint, quietShallows, whaleAt, whereAway, type Animal, type Sea,
} from '../src/aboard/fauna';

const BAY = 'sf-bay';
const HOUR = 3600;
/** Open water everywhere, 30 m deep, with the stream and tide given. */
const water = (stream = 0.5, tideRate = 0.15, depth = 30): Sea => ({ depth: () => depth, stream: () => stream, tideRate });
const look = (now: number, sea: Sea, eye: { x: number; y: number }, boats: Array<{ x: number; y: number }> = []): Animal[] =>
  lookAbout(BAY, now, sea, eye, boats, new Sightings()).all();
const of = (list: Animal[], kind: string, pose?: string) => list.filter((a) => a.kind === kind && (!pose || a.pose === pose));

const GATE = { x: -2500, y: -1150 };
const PIER39 = { x: 3469, y: -2168 };
const AYALA = { x: 1300, y: 4314 };
const ALCATRAZ = { x: 2250, y: -350 };

describe('the field guide', () => {
  it('has a name and one plain remark for every animal', () => {
    for (const k of KINDS) {
      expect(FIELD_GUIDE[k].name.length).toBeGreaterThan(3);
      expect(FIELD_GUIDE[k].first.length).toBeGreaterThan(40);
      expect(FIELD_GUIDE[k].first.length).toBeLessThan(230);
      // Plain text: no emoji or other symbols.
      expect(FIELD_GUIDE[k].first).toMatch(/^[\x20-\x7e]+$/);
      expect(SIGHT[k]).toBeGreaterThan(100);
    }
  });

  it('shows nothing on a course with no list', () => {
    expect(lookAbout('somewhere-else', 5000, water(), GATE, [], new Sightings()).count).toBe(0);
    expect(whaleAt('somewhere-else', 5000, water())).toBeNull();
    expect(baitBalls('somewhere-else', 5000, water())).toEqual([]);
    expect(haulFloats('somewhere-else')).toEqual([]);
  });

  it('gives the same animals for the same moment and place', () => {
    for (const t of [1000, 20000, 77777]) expect(look(t, water(), PIER39)).toEqual(look(t, water(), PIER39));
  });

  it('says where to look the way it is called from the helm', () => {
    expect(whereAway(0, 0, 0, 0, 200)).toBe('Dead ahead, 200 m off');
    expect(whereAway(0, 0, 0, 100, 100)).toBe('On the starboard bow, 150 m off');
    expect(whereAway(0, 0, Math.PI / 2, 0, 60)).toBe('Abeam to port, 60 m off');
    expect(whereAway(0, 0, 0, -300, -300)).toBe('On the port quarter, 400 m off');
    expect(whereAway(0, 0, Math.PI, 0, 2778)).toBe('Right astern, 1.5 nm off');
  });

  it('measures along a path', () => {
    const path: Array<[number, number]> = [[0, 0], [0, 100], [100, 100]];
    expect(pathLength(path)).toBe(200);
    expect({ ...pathPoint(path, 50) }).toEqual({ x: 0, y: 50, heading: 0 });
    const p = pathPoint(path, 150);
    expect(p.x).toBeCloseTo(50);
    expect(p.heading).toBeCloseTo(Math.PI / 2);
    expect(pathPoint(path, 999).x).toBe(100);
  });
});

describe('harbor porpoise', () => {
  /** Rolls seen from one place over an hour, looking every second. */
  const hour = (sea: Sea, boats: Array<{ x: number; y: number }> = []) => {
    let rolls = 0;
    let most = 0;
    let seconds = 0;
    for (let t = 30000; t < 30000 + HOUR; t++) {
      const up = of(look(t, sea, GATE, boats), 'porpoise');
      rolls += up.length;
      most = Math.max(most, up.length);
      if (up.length) seconds++;
      for (const a of up) {
        expect(a.pose).toBe('roll');
        expect(a.phase).toBeGreaterThanOrEqual(0);
        expect(a.phase).toBeLessThan(1);
      }
    }
    return { rolls, most, seconds };
  };

  it('roll at the Gate in small groups, up for a moment and down for minutes', () => {
    // The eye is given the whole haunt to watch.
    const h = hour(water(0.5));
    expect(h.rolls).toBeGreaterThan(50);
    // Two to five in a group, and never the whole Bay's worth at once.
    expect(h.most).toBeGreaterThanOrEqual(2);
    expect(h.most).toBeLessThanOrEqual(10);
    // Most of the time there is nothing to see.
    expect(h.seconds).toBeLessThan(HOUR * 0.4);
  });

  it('are busier when the tide runs hard', () => {
    expect(hour(water(1.0)).rolls).toBeGreaterThan(hour(water(0.05)).rolls * 1.5);
  });

  it('keep to deep water', () => {
    const shoal = water(1.0, 0.15, 6);
    expect(hour(shoal).rolls).toBe(0);
  });

  it('do not come up beside a boat', () => {
    for (let t = 30000; t < 30000 + HOUR; t += 2) {
      const open = of(look(t, water(1), GATE), 'porpoise');
      if (!open.length) continue;
      // Put a boat on top of the first one.
      const boat = { x: open[0].x, y: open[0].y };
      for (const a of of(look(t, water(1), GATE, [boat]), 'porpoise')) expect(Math.hypot(a.x - boat.x, a.y - boat.y)).toBeGreaterThan(30);
    }
  });
});

describe('harbor seals', () => {
  const shallows = water(0.1, 0, 5);
  it('put a head up in the anchorages, watch, and sink', () => {
    let up = 0;
    let down = 0;
    for (let t = 40000; t < 40000 + HOUR; t += 2) {
      const heads = of(look(t, shallows, AYALA), 'seal');
      if (heads.length) up++;
      else down++;
      for (const s of heads) {
        expect(s.pose).toBe('head');
        expect(s.phase).toBeGreaterThan(-1e-9);
        expect(s.phase).toBeLessThanOrEqual(1);
        // Looking at the boat.
        expect(s.heading).toBeCloseTo(Math.atan2(AYALA.x - s.x, AYALA.y - s.y), 6);
      }
      expect(heads.length).toBeLessThanOrEqual(4);
    }
    expect(up).toBeGreaterThan(200);
    expect(down).toBeGreaterThan(200);
  });

  it('sink when a boat comes close', () => {
    let tried = 0;
    for (let t = 40000; t < 40000 + HOUR; t += 5) {
      const heads = of(look(t, shallows, AYALA), 'seal');
      if (!heads.length) continue;
      tried++;
      const boat = { x: heads[0].x + 10, y: heads[0].y };
      for (const s of of(look(t, shallows, AYALA, [boat]), 'seal')) expect(Math.hypot(s.x - boat.x, s.y - boat.y)).toBeGreaterThan(27);
    }
    expect(tried).toBeGreaterThan(50);
  });

  it('like quiet shallow water and not the tideway', () => {
    expect(quietShallows(water(0.1, 0, 4), 0, 0)).toBe(true);
    expect(quietShallows(water(0.8, 0, 4), 0, 0)).toBe(false);
    expect(quietShallows(water(0.1, 0, 30), 0, 0)).toBe(false);
    expect(quietShallows(water(0.1, 0, 0), 0, 0)).toBe(false);
    // Out in the deep stream at the Gate there are none.
    for (let t = 40000; t < 40000 + HOUR; t += 7) expect(of(look(t, water(0.9, 0, 90), GATE), 'seal')).toHaveLength(0);
  });
});

describe('sea lions', () => {
  it('are always on the floats at Pier 39, a few to a float', () => {
    const floats = haulFloats(BAY);
    expect(floats).toHaveLength(3);
    for (let t = 0; t < 36 * HOUR; t += 613) {
      const hauled = of(look(t, water(0.1), PIER39), 'sealion', 'hauled');
      expect(hauled.length).toBeGreaterThanOrEqual(3);
      expect(hauled.length).toBeLessThanOrEqual(11);
      for (const a of hauled) {
        const onOne = floats.some((f) => Math.abs(a.x - f.x) <= FLOAT_LENGTH / 2 && Math.abs(a.y - f.y) <= FLOAT_BEAM / 2);
        expect(onOne).toBe(true);
        expect(a.up).toBeGreaterThan(0);
      }
    }
  });

  it('swim the city front with their heads up, and sometimes porpoise', () => {
    let heads = 0;
    let leaps = 0;
    for (let t = 50000; t < 50000 + 2 * HOUR; t++) {
      const all = of(look(t, water(0.1), { x: 3400, y: -1950 }), 'sealion');
      heads += of(all, 'sealion', 'head').length;
      leaps += of(all, 'sealion', 'leap').length;
    }
    expect(heads).toBeGreaterThan(100);
    expect(leaps).toBeGreaterThan(10);
    expect(heads).toBeGreaterThan(leaps);
  });
});

describe('the humpback', () => {
  it('is never in on the ebb or at slack', () => {
    for (let t = 0; t < 36 * HOUR; t += 97) {
      expect(whaleAt(BAY, t, water(0.5, -0.2))).toBeNull();
      expect(whaleAt(BAY, t, water(0.5, WHALE_FLOOD - 0.01))).toBeNull();
    }
  });

  it('comes in on some hours of the flood and not most', () => {
    let hours = 0;
    for (let h = 0; h < 200; h++) if (whaleAt(BAY, h * HOUR + 1800, water(0.5, 0.15))) hours++;
    expect(hours).toBeGreaterThan(200 * 0.18);
    expect(hours).toBeLessThan(200 * 0.42);
  });

  it('blows several times, shows her back, and now and then her flukes, then is down for minutes', () => {
    // Find an hour with a whale and watch it through.
    let h = 0;
    while (!whaleAt(BAY, h * HOUR + 1800, water(0.5, 0.15))) h++;
    let blowing = 0;
    let back = 0;
    let fluke = 0;
    let under = 0;
    let far = 0;
    let last = { x: 0, y: 0 };
    for (let t = h * HOUR; t < (h + 1) * HOUR; t++) {
      const w = whaleAt(BAY, t, water(0.5, 0.15))!;
      expect(w).not.toBeNull();
      if (t > h * HOUR) far = Math.max(far, Math.hypot(w.x - last.x, w.y - last.y));
      last = { x: w.x, y: w.y };
      if (w.blow > 0) blowing++;
      if (w.back >= 0) back++;
      else under++;
      if (w.fluke >= 0) fluke++;
    }
    expect(blowing).toBeGreaterThan(60);
    expect(back).toBeGreaterThan(120);
    expect(under).toBeGreaterThan(back * 2);
    expect(fluke).toBeGreaterThan(0);
    expect(fluke).toBeLessThan(back);
    // She swims, she does not jump about: under 3 m in any second.
    expect(far).toBeLessThan(3);
    // Seen from two kilometres off when she is up, and drawn only when she is.
    const up = h * HOUR + 1800;
    const w = whaleAt(BAY, up, water(0.5, 0.15))!;
    const eye = { x: w.x + 2000, y: w.y };
    let seen = 0;
    for (let t = h * HOUR; t < (h + 1) * HOUR; t += 2) seen += of(look(t, water(0.5, 0.15), eye), 'humpback', 'back').length;
    expect(seen).toBeGreaterThan(30);
    // A boat on top of her and she stays down.
    for (let t = h * HOUR; t < (h + 1) * HOUR; t += 5) {
      const now = whaleAt(BAY, t, water(0.5, 0.15))!;
      const boat = { x: now.x + 20, y: now.y };
      expect(of(look(t, water(0.5, 0.15), boat, [boat]), 'humpback')).toHaveLength(0);
    }
  });
});

describe('birds', () => {
  it('fly pelicans in lines of three to seven, low over the water', () => {
    let most = 0;
    let seen = 0;
    for (let t = 20000; t < 20000 + 2 * HOUR; t += 3) {
      const line = of(look(t, water(0), { x: 3600, y: -1800 }), 'pelican', 'fly');
      if (!line.length) continue;
      seen++;
      most = Math.max(most, line.length);
      for (const b of line) {
        expect(b.up).toBeGreaterThan(0.5);
        expect(b.up).toBeLessThan(2.5);
        expect(Math.abs(b.wing)).toBeLessThanOrEqual(1);
      }
    }
    expect(seen).toBeGreaterThan(50);
    expect(most).toBeGreaterThanOrEqual(3);
    expect(most).toBeLessThanOrEqual(14);
  });

  it('lift a line of pelicans over a boat in its way', () => {
    for (let t = 20000; t < 20000 + HOUR; t += 3) {
      const line = of(look(t, water(0), { x: 3600, y: -1800 }), 'pelican', 'fly');
      if (!line.length) continue;
      const boat = { x: line[0].x, y: line[0].y };
      const over = of(look(t, water(0), { x: 3600, y: -1800 }, [boat]), 'pelican', 'fly');
      expect(over[0].up).toBeGreaterThan(10);
      return;
    }
    throw new Error('no pelicans came by');
  });

  it('keep gulls wheeling over Alcatraz, well above the rock', () => {
    const gulls = of(look(12345, water(), ALCATRAZ), 'gull');
    expect(gulls).toHaveLength(9);
    for (const g of gulls) expect(g.up).toBeGreaterThan(25);
    // A moment later each has moved a few metres round its circle.
    const next = of(look(12346, water(), ALCATRAZ), 'gull');
    for (let i = 0; i < gulls.length; i++) {
      const d = Math.hypot(next[i].x - gulls[i].x, next[i].y - gulls[i].y);
      expect(d).toBeGreaterThan(4);
      expect(d).toBeLessThan(12);
    }
  });

  it('send cormorants round Alcatraz low and fast, and stand one on a buoy until a boat comes', () => {
    let flying = 0;
    for (let t = 20000; t < 20000 + HOUR; t += 3) {
      for (const c of of(look(t, water(), ALCATRAZ), 'cormorant', 'fly')) {
        flying++;
        expect(c.up).toBeLessThan(1.5);
      }
    }
    expect(flying).toBeGreaterThan(100);
    const harding = FAUNA[BAY].perches[0];
    let stood = 0;
    for (let t = 0; t < 36 * HOUR; t += 1800) {
      const on = of(look(t + 60, water(), harding), 'cormorant', 'perch');
      stood += on.length;
      expect(of(look(t + 60, water(), harding, [{ x: harding.x + 10, y: harding.y }]), 'cormorant', 'perch')).toHaveLength(0);
      for (const c of on) expect(c.up).toBeCloseTo(harding.up);
    }
    expect(stood).toBeGreaterThan(36);
    expect(stood).toBeLessThan(72);
  });
});

describe('bait fish', () => {
  it('ball up only where the tide is running', () => {
    let balls = 0;
    for (let t = 0; t < 36 * HOUR; t += 600) {
      expect(baitBalls(BAY, t, water(BAIT_TIDE - 0.05))).toHaveLength(0);
      balls += baitBalls(BAY, t, water(0.6)).length;
    }
    // Seven spots, each working two fifths of the time.
    expect(balls / 216).toBeGreaterThan(1.5);
    expect(balls / 216).toBeLessThan(4.5);
  });

  it('bring gulls and plunging pelicans, and say so to the fisherman', () => {
    let t = 0;
    while (!baitBalls(BAY, t, water(0.6)).length) t += 300;
    const ball = baitBalls(BAY, t, water(0.6))[0];
    expect(baitAt(BAY, t, water(0.6), ball.x, ball.y)).toBe(1);
    expect(baitAt(BAY, t, water(0.6), ball.x + 100, ball.y)).toBe(1);
    expect(baitAt(BAY, t, water(0.6), ball.x + 220, ball.y)).toBeGreaterThan(0);
    expect(baitAt(BAY, t, water(0.6), ball.x + 220, ball.y)).toBeLessThan(1);
    expect(baitAt(BAY, t, water(0.6), ball.x + 5000, ball.y + 9000)).toBe(0);
    const poses = new Set<string>();
    for (let dt = 0; dt < 60; dt += 0.25) {
      const birds = look(t + dt, water(0.6), ball);
      expect(of(birds, 'gull').length).toBeGreaterThanOrEqual(5);
      for (const p of of(birds, 'pelican')) {
        if (Math.hypot(p.x - ball.x, p.y - ball.y) > 80) continue;
        poses.add(p.pose);
        if (p.pose === 'sit') expect(p.up).toBe(0);
        if (p.pose === 'plunge') expect(p.up).toBeLessThanOrEqual(11);
      }
    }
    expect([...poses].sort()).toEqual(['fly', 'plunge', 'sit']);
  });
});

describe('on the Bay itself', () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../courses/sf-bay');
  const course = JSON.parse(readFileSync(resolve(dir, 'course.json'), 'utf8')) as CourseData;
  const bin = (name: string) => readFileSync(resolve(dir, name));
  const world = new ReplayWorld({ course, current: new Int8Array(bin('current.bin').buffer.slice(0)), depth: new Uint8Array(bin('depth.bin').buffer.slice(0)) }, 0);
  const bay = (t: number): Sea => ({
    depth: (x, y) => world.chartDepth(x, y),
    stream: (x, y) => { const c = world.current(x, y, t); return Math.hypot(c.x, c.y); },
    tideRate: world.tideRate(t),
  });
  const f = FAUNA[BAY];

  it('is the course the list is written for', () => {
    expect(course.id).toBe(BAY);
  });

  it('has every haunt and every route in the water', () => {
    const depth = (x: number, y: number) => world.chartDepth(x, y);
    for (const p of f.porpoise) expect(depth(p.x, p.y), `porpoise ${p.x},${p.y}`).toBeGreaterThan(15);
    for (const fl of haulFloats(BAY)) expect(depth(fl.x, fl.y), 'float').toBeGreaterThan(2);
    for (const b of f.bait) expect(depth(b.x, b.y), `bait ${b.x},${b.y}`).toBeGreaterThan(5);
    for (const p of f.perches) expect(course.marks.some((m) => m.kind === 'buoy' && m.x === p.x && m.y === p.y)).toBe(true);
    const along = (path: Array<[number, number]>, least: number, what: string) => {
      for (let s = 0; s <= pathLength(path); s += 50) {
        const p = pathPoint(path, s);
        expect(depth(p.x, p.y), `${what} at ${Math.round(p.x)},${Math.round(p.y)}`).toBeGreaterThan(least);
      }
    };
    along(f.whale, 15, 'whale');
    for (const r of f.sealions) along(r.path, 3, 'sea lion');
    for (const r of f.pelicans) along(r.path, 0, 'pelican');
    for (const r of f.cormorants) along(r.path, 0, 'cormorant');
  });

  it('gives a seal somewhere to come up at each of her regular places', () => {
    for (const s of f.seals) {
      let up = 0;
      for (let t = 20000; t < 20000 + HOUR; t += 4) {
        for (const a of of(lookAbout(BAY, t, bay(t), s, [], new Sightings()).all(), 'seal')) {
          up++;
          expect(world.chartDepth(a.x, a.y)).toBeGreaterThanOrEqual(1);
        }
      }
      expect(up, `seals at ${s.x},${s.y}`).toBeGreaterThan(40);
    }
  });

  it('has porpoise at the Gate, in deep water, on the real tide', () => {
    let rolls = 0;
    for (let t = 14 * HOUR; t < 15 * HOUR; t += 1) {
      for (const a of of(lookAbout(BAY, t, bay(t), GATE, [], new Sightings()).all(), 'porpoise')) {
        rolls++;
        expect(world.chartDepth(a.x, a.y)).toBeGreaterThan(4);
      }
    }
    expect(rolls).toBeGreaterThan(60);
  });

  it('brings a whale in on a few hours of the day\'s floods and none of its ebbs, always in the deep channel', () => {
    const hours: number[] = [];
    for (let h = 0; h < 36; h++) {
      const t = h * HOUR + 1800;
      const w = whaleAt(BAY, t, bay(t));
      if (!w) continue;
      hours.push(h);
      expect(world.tideRate(t)).toBeGreaterThan(0);
      for (let s = h * HOUR; s < (h + 1) * HOUR; s += 60) {
        const at = whaleAt(BAY, s, bay(s));
        if (at) expect(world.chartDepth(at.x, at.y)).toBeGreaterThan(15);
      }
    }
    expect(hours).toMatchInlineSnapshot(`
      [
        7,
        8,
        19,
        21,
        31,
        34,
      ]
    `);
    expect(hours.length).toBeGreaterThanOrEqual(2);
    expect(hours.length).toBeLessThanOrEqual(8);
  });

  it('is pinned: what is in sight from Pier 39 at nine in the morning', () => {
    const t = HOUR;
    const seen = lookAbout(BAY, t, bay(t), PIER39, [], new Sightings()).all();
    const tally: Record<string, number> = {};
    for (const a of seen) tally[`${a.kind} ${a.pose}`] = (tally[`${a.kind} ${a.pose}`] ?? 0) + 1;
    expect(tally).toMatchInlineSnapshot(`
      {
        "gull fly": 13,
        "pelican fly": 9,
        "sealion hauled": 9,
        "sealion head": 1,
      }
    `);
  });
});
