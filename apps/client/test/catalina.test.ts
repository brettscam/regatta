/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, type CourseData } from '@slack-tide/world';
import { Track, type TrafficSpec } from '../src/scene/traffic';
import { drawnLandHeight } from '../src/scene/terrain';
import { inArea, lightShows, type CourseFeatures } from '../src/world/features';
import { areasAt, entered } from '../src/aboard/pilotageRules';
import { KELP_DEPTH, inKelp, kelpCanopy } from '../src/scene/kelp';
import { inRing, planTown, townFaults, townFloorAt, townLayouts, type TownSpec } from '../src/scene/town';
import { planVenue, type VenueGround, type VenuePlace } from '../src/scene/venue';
import { SHORE_KINDS, chartSailable } from '../src/scene/shoreSite';
import { buildStructures } from '../src/scene/structures';
import { buildLongBeach } from '../src/scene/longBeach';
import { buildCatalina } from '../src/scene/catalinaIsland';
import { PLATFORM_RING, platformsOf, tableOf } from '../src/fishing/table';
import { reservesOf } from '../src/fishing/zones';
import { groundOfTown } from '../src/ashore/fromTown';
import { areaAt, areaFrom, floorUnder } from '../src/ashore/ground';

// Long Beach to Catalina: what was drawn into the water (breakwaters, platforms, lanes, lights, kelp, towns), checked
// against the baked depth and land. The structures are solid because `scripts/stamp.ts` wrote them into depth.bin:
// these tests fail if the data and the bake part company.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../courses/catalina');
const json = <T>(name: string): T => JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as T;
const course = json<CourseData>('course.json');
const bin = (name: string) => readFileSync(resolve(dir, name));
const depths = new Uint8Array(bin('depth.bin').buffer.slice(0));
const world = new ReplayWorld({ course, current: new Int8Array(bin('current.bin').buffer.slice(0)), depth: depths }, 0);
const features = json<CourseFeatures>('features.json');
const traffic = json<TrafficSpec>('traffic.json');
const towns = json<TownSpec[]>('towns.json');
interface Named { id: string; name: string; x: number; y: number }
const places = json<Array<VenuePlace & { say: string; stop?: string }>>('places.json');
const races = json<Array<{ id: string; name: string; marks: Named[] }>>('races.json');
const starts = json<Array<Named & { route: Named[] }>>('starts.json');
const about = json<{ scenery: { landCover: string; pieces: string[] } }>('about.json');

const drawn = drawnLandHeight(course, new Uint8Array(bin('terrain.bin').buffer.slice(0)));
const ground: VenueGround = { height: drawn, sailable: chartSailable(course.depth, depths), depth: (x, y) => world.chartDepth(x, y) };
const lowest = Math.max(0, -Math.min(...course.tide.truth));
const structures = features.structures ?? [];
const platforms = structures.filter((s) => s.kind === 'platform');
const walls = structures.filter((s) => s.kind === 'breakwater');
const area = (id: string) => features.areas.find((a) => a.id === id)!;
/** Distance from a point to the stretch between two others. */
const toLeg = (x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }): number => {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
  const u = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / len2));
  return Math.hypot(x - a.x - (b.x - a.x) * u, y - a.y - (b.y - a.y) * u);
};

describe('the breakwater', () => {
  it('is three walls of rock, and every metre of each is land on the chart', () => {
    expect(walls.map((w) => w.id)).toEqual(['san-pedro-breakwater', 'middle-breakwater', 'long-beach-breakwater']);
    for (const w of walls) {
      const line = w.line!;
      for (let i = 0; i < line.length - 1; i++) {
        const len = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
        for (let s = 0; s <= len; s += 10) {
          const x = line[i][0] + ((line[i + 1][0] - line[i][0]) * s) / len;
          const y = line[i][1] + ((line[i + 1][1] - line[i][1]) * s) / len;
          expect(world.chartDepth(x, y), `${w.id} at ${Math.round(x)}, ${Math.round(y)}`).toBe(0);
        }
      }
    }
  });

  it('is no thicker than a boat would forgive: deep water sixty metres off it on both sides', () => {
    for (const w of walls.slice(1)) {
      const line = w.line!;
      const i = Math.floor(line.length / 2) - 1;
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      for (const side of [-1, 1]) expect(world.chartDepth(mx + ((by - ay) / len) * 60 * side, my - ((bx - ax) / len) * 60 * side), `${w.id} side ${side}`).toBeGreaterThan(3);
    }
  });

  it('has two gates with deep water in them, each with a light on both sides and a word from the crew', () => {
    const gates: Array<[string, [number, number], [number, number]]> = [
      ['queens-gate', walls[1].line![walls[1].line!.length - 1], walls[2].line![0]],
      ['angels-gate', walls[0].line![walls[0].line!.length - 1], walls[1].line![0]],
    ];
    for (const [id, west, east] of gates) {
      const wide = Math.hypot(east[0] - west[0], east[1] - west[1]);
      expect(wide, id).toBeGreaterThan(500);
      expect(wide, id).toBeLessThan(900);
      // Deep enough for a ship across the middle three fifths of it.
      for (let k = 2; k <= 8; k++) expect(world.chartDepth(west[0] + ((east[0] - west[0]) * k) / 10, west[1] + ((east[1] - west[1]) * k) / 10) - lowest, `${id} ${k}/10 across`).toBeGreaterThanOrEqual(13);
      const a = area(id);
      expect(a.kind).toBe('precaution');
      expect(a.warn).toBeTruthy();
      expect(inArea(a, (west[0] + east[0]) / 2, (west[1] + east[1]) / 2)).toBe(true);
      for (const end of [west, east]) expect(features.lights.some((l) => Math.hypot(l.x - end[0], l.y - end[1]) < 40), `${id} light`).toBe(true);
    }
    // Leaving harbour means finding the gate: the straight line from the marina to the open sea east or west of it is shut.
    const closed = (x: number) => { let least = 99; for (let y = 20500; y >= 18000; y -= 10) least = Math.min(least, world.chartDepth(x, y)); return least; };
    expect(closed(9000)).toBe(0);
    expect(closed(12500)).toBe(0);
    expect(closed(10750)).toBeGreaterThanOrEqual(13);
  });
});

describe('the oil islands and the platforms', () => {
  it('four islands, land on the chart and on the drawn land', () => {
    const islands = structures.filter((s) => s.kind === 'island');
    expect(islands.map((s) => s.name)).toEqual(['Island Grissom', 'Island White', 'Island Chaffee', 'Island Freeman']);
    for (const s of islands) {
      expect(world.chartDepth(s.x!, s.y!), s.id).toBe(0);
      expect(world.chartDepth(s.x! + s.r! + 120, s.y!), s.id).toBeGreaterThan(3);
      expect(world.chartDepth(s.x!, s.y! - s.r! - 120), s.id).toBeGreaterThan(3);
    }
  });

  it('four platforms, each solid where it is drawn and nowhere else, ringed and warned of', () => {
    expect(platforms.map((s) => s.name)).toEqual(['Platform Edith', 'Platform Ellen', 'Platform Elly', 'Platform Eureka']);
    for (const s of platforms) {
      expect(world.chartDepth(s.x!, s.y!), s.id).toBe(0);
      // The cell that is solid is no bigger than the platform: open water 45 m from its middle, deep water all round.
      for (const [dx, dy] of [[45, 0], [-45, 0], [0, 45], [0, -45], [120, 120], [-120, -120]]) expect(world.chartDepth(s.x! + dx, s.y! + dy), `${s.id} ${dx},${dy}`).toBeGreaterThan(15);
      expect(Math.max(s.w!, s.d!)).toBeLessThanOrEqual(56);
      const ring = area(`${s.id}-ring`);
      expect(ring.kind).toBe('keepclear');
      expect(ring.circle).toEqual({ x: s.x, y: s.y, r: PLATFORM_RING });
      expect(ring.warn).toContain(s.name);
      // Not in a lane: the lanes are drawn to pass them.
      for (const a of features.areas) if (a.kind === 'lane' || a.kind === 'separation') expect(inArea(a, s.x!, s.y!), `${s.id} in ${a.id}`).toBe(false);
    }
    expect(platforms.find((s) => s.id === 'elly')!.bridgeTo).toBe('ellen');
    // The crew speaks as she crosses a ring, once.
    const before = new Set(areasAt(features, 15700, 3600));
    const now = areasAt(features, 15840, 3600);
    expect(entered(features, before, now).map((a) => a.id)).toEqual(['ellen-ring']);
  });
});

describe('lanes and lights', () => {
  it('two approaches, each a lane either way with a zone between, meeting in the precautionary area', () => {
    const lanes = features.areas.filter((a) => a.kind === 'lane');
    expect(lanes.length).toBe(6);
    for (const l of lanes) {
      expect(l.points!.length).toBe(4);
      const [p0, p1, p2, p3] = l.points!;
      // The arrow the chart draws down a lane points the way the lane runs.
      const bearing = (Math.atan2((p1[0] + p2[0]) / 2 - (p0[0] + p3[0]) / 2, (p1[1] + p2[1]) / 2 - (p0[1] + p3[1]) / 2) * 180) / Math.PI;
      expect(Math.abs((((bearing - l.toward!) % 360) + 540) % 360 - 180), l.id).toBeLessThan(2);
      // A nautical mile wide.
      expect(Math.hypot(p0[0] - p3[0], p0[1] - p3[1]), l.id).toBeCloseTo(1852, -1);
    }
    // Keep to the right: leaving for the north-west, the outbound lane is the northern one.
    const out = area('west-out-1').points!;
    const inn = area('west-in-1').points!;
    expect(out[0][1]).toBeGreaterThan(inn[0][1]);
    expect(area('precaution').points!.length).toBeGreaterThanOrEqual(4);
    // The crossing to Avalon goes through the precautionary area and clear of both schemes' lanes for its first miles.
    expect(inArea(area('precaution'), 9500, 15000)).toBe(true);
  });

  it('lights with a rhythm, on the chart, green and red where a gate or a harbor mouth wants them', () => {
    expect(features.lights.length).toBeGreaterThanOrEqual(12);
    for (const l of features.lights) {
      expect(l.shows, l.id).toBeLessThan(l.period);
      expect(l.x > course.bounds.x0 && l.x < course.bounds.x1 && l.y > course.bounds.y0 && l.y < course.bounds.y1, l.id).toBe(true);
      expect(lightShows(l, 0)).toBe(true);
      expect(lightShows(l, l.period - 0.01)).toBe(false);
    }
    expect(features.lights.find((l) => l.id === 'angels-gate-light')!.character).toBe('Fl G 15s');
    expect(features.lights.find((l) => l.id === 'long-beach-light')!.colour).toBeUndefined();
  });

  it('reserves where nothing may be taken: the dive park, Lover\'s Cove, Long Point and Blue Cavern', () => {
    const reserves = features.areas.filter((a) => a.noTake);
    expect(reserves.map((a) => a.id)).toEqual(['casino-point', 'lovers-cove', 'long-point', 'blue-cavern']);
    for (const a of reserves) {
      expect(a.kind).toBe('refuge');
      expect(a.warn).toBeTruthy();
    }
  });
});

describe('port traffic', () => {
  const tracks = traffic.routes.map((r) => ({ r, track: new Track(r, traffic.referenceHours * 3600) }));
  const p = { x: 0, y: 0 };

  it('every vessel keeps afloat on her smoothed track at the lowest water, and off the platforms', () => {
    for (const { r, track } of tracks) {
      const need = r.kind === 'ship' ? 13 : r.kind === 'ferry' ? 6 : 4;
      for (let s = 0; s <= track.length; s += 40) {
        track.point(s, p);
        expect(world.chartDepth(p.x, p.y) - lowest, `${r.id} at ${Math.round(p.x)}, ${Math.round(p.y)}`).toBeGreaterThanOrEqual(need);
        for (const o of platforms) expect(Math.hypot(p.x - o.x!, p.y - o.y!), `${r.id} and ${o.id}`).toBeGreaterThan(260);
      }
    }
  });

  it('the Catalina boats take about an hour and go several times a day; the ships are one passage in and one out', () => {
    const avalon = tracks.find((t) => t.r.id === 'ferry-avalon')!;
    expect(avalon.r.model).toBe('catamaran');
    expect(avalon.track.travel / 60).toBeGreaterThan(45);
    expect(avalon.track.travel / 60).toBeLessThan(70);
    expect(86400 / avalon.track.cycle).toBeGreaterThanOrEqual(5);
    expect(avalon.r.ends).toEqual(['Long Beach', 'Avalon']);
    const isthmus = tracks.find((t) => t.r.id === 'ferry-isthmus')!;
    expect(isthmus.r.ends).toEqual(['San Pedro', 'Two Harbors']);
    expect(isthmus.track.travel / 60).toBeLessThan(70);
    const ships = tracks.filter((t) => t.r.kind === 'ship' && t.r.mode === 'oneway');
    expect(ships.length).toBe(8);
    for (const { r, track } of ships) {
      expect(r.every, r.id).toBe(86400);
      // Through one of the gates, which she reports at.
      track.point(track.along(r.gate!.at), p);
      const gate = area(r.gate!.name === 'Queens Gate' ? 'queens-gate' : 'angels-gate');
      expect(inArea(gate, p.x, p.y), r.id).toBe(true);
    }
    // The sportfishers leave before sunrise (the season begins at 05:00) and the cruise ship lies off Avalon by day.
    for (const id of ['fish-horseshoe', 'fish-rigs', 'fish-island']) {
      const t = tracks.find((q) => q.r.id === id)!;
      const leaves = (((-t.r.phase % t.track.cycle) + t.track.cycle) % t.track.cycle) / 3600;
      expect(leaves, id).toBeLessThan(1);
      expect(Math.abs(t.track.cycle - 86400), id).toBeLessThan(600);
    }
    const st = { x: 0, y: 0, heading: 0, sog: 0, active: true };
    const cruise = tracks.find((t) => t.r.id === 'cruise-avalon')!;
    cruise.track.state(7 * 3600, st);
    expect(st.active && st.sog === 0).toBe(true);
    expect(Math.hypot(st.x + 2330, st.y + 22352)).toBeLessThan(2000);
    cruise.track.state(19 * 3600, st);
    expect(st.active).toBe(false);
    expect(traffic.station).toBe('San Pedro Radio');
  });
});

describe('races, starts and places', () => {
  it('every mark is afloat with room, every leg clears the walls and passes a quarter of a mile from the platforms', () => {
    expect(races.map((r) => r.id)).toEqual(['to-avalon', 'to-isthmus', 'avalon-isthmus', 'platforms']);
    for (const set of [...races.map((r) => ({ id: r.id, marks: r.marks })), ...starts.map((s) => ({ id: `start ${s.id}`, marks: [s as Named, ...s.route] }))]) {
      set.marks.forEach((m, i) => {
        expect(world.chartDepth(m.x, m.y) - lowest, `${set.id} ${m.name}`).toBeGreaterThan(10);
        if (i === 0) return;
        const a = set.marks[i - 1];
        const len = Math.hypot(m.x - a.x, m.y - a.y);
        for (let s = 0; s <= len; s += 20) expect(world.chartDepth(a.x + ((m.x - a.x) * s) / len, a.y + ((m.y - a.y) * s) / len) - lowest, `${set.id} leg to ${m.name}`).toBeGreaterThan(4);
        for (const o of platforms) expect(toLeg(o.x!, o.y!, a, m), `${set.id} leg to ${m.name} and ${o.id}`).toBeGreaterThan(450);
      });
    }
    // The gate's mark lies in the gap, just outside the wall, so a boat is through before she need tack.
    const gate = races[0].marks[0];
    expect(inArea(area('queens-gate'), gate.x, gate.y)).toBe(true);
    expect(gate.y).toBeLessThan(walls[2].line![0][1] - 100);
  });

  it('places say what kind of stop they are, and each has water to lie in', () => {
    expect(places.map((p) => p.id)).toEqual(['shoreline', 'alamitos', 'avalon', 'avalon-fuel', 'casino-point', 'whites', 'isthmus', 'isthmus-pier', 'catharbor', 'emerald']);
    for (const p of places) {
      expect(p.ashore, p.id).toBeTruthy();
      expect(SHORE_KINDS, p.id).toContain(p.ashore!.kind);
      expect(p.ashore!.sign, p.id).toBeTruthy();
      expect(['bar', 'beach', 'snorkel', 'marina'], p.id).toContain(p.stop);
      expect(world.chartDepth(p.x, p.y), p.id).toBeGreaterThanOrEqual(3);
      // A place in a town has the town for its venue. Any other gets a venue of its own on dry land.
      if (p.ashore!.town) expect(planVenue(p, ground), p.id).toBeNull();
      else expect(planVenue(p, ground), p.id).not.toBeNull();
    }
    expect(about.scenery.landCover).toBe('socal');
    expect(about.scenery.pieces).toEqual(['long-beach', 'catalina-island', 'morning-haze']);
  });
});

describe('the towns to walk in', () => {
  const plans = towns.map((t) => planTown(t, ground));

  it('Avalon and Two Harbors, with ground that can be drawn where the plan says and walked from end to end', () => {
    expect(towns.map((t) => t.id)).toEqual(['avalon', 'isthmus']);
    for (const plan of plans) expect(townFaults(plan, ground), plan.spec.id).toEqual([]);
  });

  it('give each of their places a landing: a float over water, within a tender\'s reach of the yacht', () => {
    for (const plan of plans) {
      const layouts = townLayouts(plan, ground);
      expect(layouts.map((l) => l.place)).toEqual(plan.spec.landings.map((l) => l.place));
      for (const { place, layout } of layouts) {
        const p = places.find((q) => q.id === place)!;
        expect(p.ashore!.town, place).toBe(plan.spec.id);
        expect(layout.town).toBe(true);
        expect(layout.dock, place).not.toBeNull();
        expect(layout.dock!.z, place).toBeCloseTo(0.45, 2);
        expect(drawn(layout.dock!.x, layout.dock!.y), place).toBeLessThan(0);
        expect(world.chartDepth(layout.dock!.x, layout.dock!.y), place).toBeGreaterThan(0.3);
        expect(layout.berth, place).not.toBeNull();
        // The same town whichever float she lands at.
        expect(layout.walk).toBe(layouts[0].layout.walk);
        expect(layout.heights.length).toBe(layout.walk.length);
        expect(layout.spots).toBe(layouts[0].layout.spots);
      }
    }
    // A place in a town that is a dock lets the yacht lie within a boat's length of its float.
    for (const p of places.filter((q) => q.ashore!.town && q.kind === 'dock')) {
      const plan = plans.find((q) => q.spec.id === p.ashore!.town)!;
      const l = townLayouts(plan, ground).find((q) => q.place === p.id)!;
      expect(Math.hypot(l.layout.dock!.x - p.x, l.layout.dock!.y - p.y), p.id).toBeLessThan(30);
    }
  });

  it('Avalon: the pier out and back, the front from the mole to the Casino, two side streets, and the spots a walker looks for', () => {
    const plan = plans[0];
    const layout = townLayouts(plan, ground)[0].layout;
    const names = layout.spots.map((s) => s.name);
    for (const want of ['pier-end', 'pier-scale', 'harbormaster', 'fountain', 'bench-1', 'dinghy-dock', 'casino-steps', 'casino-door', 'dive-park-stairs', 'ferry-gate', 'lovers-cove-steps', 'table-1', 'table-1-seat-1', 'table-3', 'table-5', 'bar-1']) expect(names, want).toContain(want);
    expect(new Set(names).size).toBe(names.length);
    expect(layout.paths.map((p) => p.id)).toEqual(expect.arrayContaining(['casino-way', 'crescent', 'pier', 'mole', 'sumner', 'catalina-avenue', 'casino-walk', 'dive-stairs']));
    // The pier: about 120 m of it, at the height of the front, with its end over four metres of water.
    const pier = plan.spec.paths.find((p) => p.id === 'pier')!;
    const end = layout.spots.find((s) => s.name === 'pier-end')!;
    expect(Math.hypot(pier.points![1][0] - pier.points![0][0], pier.points![1][1] - pier.points![0][1])).toBeGreaterThan(100);
    expect(pier.paint).toBe('#2f7d4f');
    expect(townFloorAt(layout, end.x, end.y)).toBe(plan.spec.floor);
    // The pier is solid on the chart (scripts/stamp.ts): the water is ten metres off its end, and its foot is ashore.
    const [[ax, ay], [bx, by]] = pier.points!;
    const plen = Math.hypot(bx - ax, by - ay);
    expect(world.chartDepth(end.x, end.y)).toBe(0);
    expect(world.chartDepth(bx + ((bx - ax) / plen) * 10, by + ((by - ay) / plen) * 10)).toBeGreaterThan(4);
    // From the mole to the Casino along the water is the best part of a kilometre.
    const front = ['casino-way', 'crescent', 'mole-road'].flatMap((id) => plan.spec.paths.find((p) => p.id === id)!.points!);
    let length = 0;
    for (let i = 1; i < front.length; i++) length += Math.hypot(front[i][0] - front[i - 1][0], front[i][1] - front[i - 1][1]);
    expect(length).toBeGreaterThan(800);
    // The streets climb: their far ends stand well above the front.
    expect(townFloorAt(layout, layout.spots.find((s) => s.name === 'sumner-top')!.x, layout.spots.find((s) => s.name === 'sumner-top')!.y)!).toBeGreaterThan(plan.spec.floor + 1.5);
    // Human scale: nowhere to walk narrower than a pontoon or wider than a mole, and seats within reach of their table.
    for (const p of plan.spec.paths) { expect(p.width, p.id).toBeGreaterThanOrEqual(4); expect(p.width, p.id).toBeLessThanOrEqual(18); }
    const t1 = layout.spots.find((s) => s.name === 'table-1')!;
    for (let k = 1; k <= 4; k++) {
      const seat = layout.spots.find((s) => s.name === `table-1-seat-${k}`)!;
      expect(Math.abs(Math.hypot(seat.x - t1.x, seat.y - t1.y) - 0.95)).toBeLessThan(0.1);
      // A seat faces its table.
      expect(Math.hypot(seat.x + Math.sin(seat.face) * 0.95 - t1.x, seat.y + Math.cos(seat.face) * 0.95 - t1.y)).toBeLessThan(0.2);
    }
    // Every spot is on a ring, and the dive park's landing is inside the park.
    for (const s of layout.spots) expect(layout.walk.some((r) => inRing(r, s.x, s.y)), s.name).toBe(true);
    const landing = layout.spots.find((s) => s.name === 'dive-park-landing')!;
    expect(inArea(area('casino-point'), landing.x, landing.y)).toBe(true);
  });

  it('Two Harbors: a pier, the bar\'s deck, the beach, and the road across to Catalina Harbor', () => {
    const plan = plans[1];
    const layout = townLayouts(plan, ground)[0].layout;
    expect(layout.paths.map((p) => p.id)).toEqual(['beach', 'pier', 'dinghy-dock', 'fuel-float', 'bar-deck', 'isthmus-road', 'cat-harbor-pier', 'cat-harbor-dock']);
    const road = plan.spec.paths.find((p) => p.id === 'isthmus-road')!.points!;
    let length = 0;
    for (let i = 1; i < road.length; i++) length += Math.hypot(road[i][0] - road[i - 1][0], road[i][1] - road[i - 1][1]);
    // Half a mile, over a saddle a few metres above the sea.
    expect(length).toBeGreaterThan(600);
    expect(length).toBeLessThan(950);
    const saddle = layout.spots.find((s) => s.name === 'isthmus-saddle')!;
    expect(townFloorAt(layout, saddle.x, saddle.y)!).toBeGreaterThan(6);
    expect(layout.spots.filter((s) => s.kind === 'table').length).toBe(4);
  });
});

describe('one list of each thing', () => {
  it('fishing takes its platforms and islands from the structures, and its breakwater grounds lie along the walls', () => {
    const table = tableOf('catalina')!;
    expect(table.platforms).toEqual(platformsOf('catalina'));
    expect(table.platforms.map((p) => p.id)).toEqual(['island-grissom', 'island-white', 'island-chaffee', 'island-freeman', 'edith', 'ellen', 'elly', 'eureka']);
    for (const p of table.platforms) {
      const s = structures.find((q) => q.id === p.id)!;
      expect([p.x, p.y]).toEqual([s.x, s.y]);
      // The ring nobody fishes in is the ring the chart draws; an island's stands off its rock.
      expect(p.keepOff).toBe(p.kind === 'platform' ? area(`${p.id}-ring`).circle!.r : s.r! + 40);
      expect(world.chartDepth(p.x + p.keepOff + 30, p.y), p.id).toBeGreaterThan(0);
    }
    const lines = Object.fromEntries(walls.map((w) => [w.id, w.line]));
    const ground = (id: string) => table.grounds.find((g) => g.id === id)!;
    expect(ground('sp-breakwater').line).toEqual(lines['san-pedro-breakwater']);
    expect(ground('mid-breakwater').line).toEqual(lines['middle-breakwater']);
    expect(ground('lb-breakwater').line).toEqual(lines['long-beach-breakwater']);
  });

  it('the reserves are the chart\'s no-take areas, and the dive file\'s copy agrees with them', () => {
    const reserves = reservesOf('catalina');
    const charted = features.areas.filter((a) => a.noTake);
    expect(reserves.map((r) => [r.id, r.x, r.y, r.r])).toEqual(charted.map((a) => [a.id, a.circle!.x, a.circle!.y, a.circle!.r]));
    const dives = json<{ zones: Array<{ id: string; x: number; y: number; r: number }>; sites: Array<{ id: string; x: number; y: number }> }>('dives.json');
    expect(dives.zones.map((z) => [z.id, z.x, z.y, z.r])).toEqual(reserves.map((r) => [r.id, r.x, r.y, r.r]));
    // Every dive site is still afloat on the stamped chart, and the two in town are inside their reserves.
    for (const s of dives.sites) expect(world.chartDepth(s.x, s.y), s.id).toBeGreaterThan(2);
    for (const id of ['casino-point', 'lovers-cove']) {
      const s = dives.sites.find((q) => q.id === id)!;
      expect(inArea(area(id), s.x, s.y), id).toBe(true);
    }
  });
});

describe('walking the towns', () => {
  const plans = towns.map((t) => planTown(t, ground));

  it('every landing of a town gives the same ground, all of it joined, with every spot on it', () => {
    for (const plan of plans) {
      const layouts = townLayouts(plan, ground);
      const grounds = layouts.map((l) => groundOfTown(l.layout)!);
      for (const g of grounds) expect(g.id).toBe(plan.spec.landings[0].place);
      const g = grounds[0];
      expect(g.areas.length).toBe(plan.rings.length);
      // From the first float, every area can be reached over the links.
      const seen = new Set<number>([0]);
      const queue = [0];
      while (queue.length) {
        const i = queue.pop()!;
        for (const [a, b] of g.links) {
          const j = a === i ? b : b === i ? a : -1;
          if (j >= 0 && !seen.has(j)) { seen.add(j); queue.push(j); }
        }
      }
      expect(seen.size, plan.spec.id).toBe(g.areas.length);
      for (const s of g.spots) expect(areaAt(g, s.x, s.y), `${plan.spec.id} ${s.name}`).toBeGreaterThanOrEqual(0);
      // A town's own kinds have become ones a walker knows.
      for (const s of g.spots) expect(['door', 'table', 'seat', 'bar', 'dock', 'bench', 'view'], s.name).toContain(s.kind);
      expect(g.spots.filter((s) => s.kind === 'dock').length).toBe(plan.spec.landings.length);
      expect(g.sights!.length).toBeGreaterThan(4);
    }
  });

  it('Avalon: a walk in metre steps from the dinghy dock up the pier, along the front and up to the Casino never leaves the ground', () => {
    const g = groundOfTown(townLayouts(plans[0], ground)[0].layout)!;
    const at = (name: string) => g.spots.find((s) => s.name === name)!;
    // Straight lines between these keep to the paths.
    const pier = plans[0].spec.paths.find((p) => p.id === 'pier')!.points!;
    const front = ['crescent', 'casino-way'].map((id) => plans[0].spec.paths.find((p) => p.id === id)!.points!);
    const way: Array<[number, number]> = [[at('dinghy-dock').x, at('dinghy-dock').y]];
    const dock = at('dinghy-dock');
    // Across on to the pier beside the float, down the pier to its foot, north-west along Crescent Avenue and Casino Way, up the steps.
    const ux = (pier[1][0] - pier[0][0]) / Math.hypot(pier[1][0] - pier[0][0], pier[1][1] - pier[0][1]);
    const uy = (pier[1][1] - pier[0][1]) / Math.hypot(pier[1][0] - pier[0][0], pier[1][1] - pier[0][1]);
    const along = (dock.x - pier[0][0]) * ux + (dock.y - pier[0][1]) * uy;
    way.push([pier[0][0] + ux * along, pier[0][1] + uy * along], [pier[0][0] + ux * 4, pier[0][1] + uy * 4]);
    const crescent = front[0];
    // The pier's foot is on the stretch of the front between its fifth and sixth points: walk back from there to its start.
    for (let i = 4; i >= 0; i--) way.push(crescent[i]);
    for (let i = front[1].length - 2; i >= 0; i--) way.push(front[1][i]);
    const steps = plans[0].spec.paths.find((p) => p.id === 'casino-steps')!.points!;
    way.push(steps[0], steps[1], [at('casino-door').x, at('casino-door').y]);
    let area = areaAt(g, way[0][0], way[0][1]);
    expect(area).toBeGreaterThanOrEqual(0);
    let top = 0;
    for (let k = 1; k < way.length; k++) {
      const [ax, ay] = way[k - 1];
      const [bx, by] = way[k];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay));
      for (let s = 1; s <= n; s++) {
        const x = ax + ((bx - ax) * s) / n;
        const y = ay + ((by - ay) * s) / n;
        const next = areaFrom(g, area, x, y);
        expect(next, `leg ${k} at ${Math.round(x)}, ${Math.round(y)}`).toBeGreaterThanOrEqual(0);
        area = next;
        top = Math.max(top, floorUnder(g, { x, y, area }));
      }
    }
    // She has climbed from a float to the Casino's terrace.
    expect(floorUnder(g, { x: way[0][0], y: way[0][1], area: areaAt(g, way[0][0], way[0][1]) })).toBeCloseTo(0.45, 2);
    expect(top).toBeGreaterThanOrEqual(6);
  });
});

describe('kelp', () => {
  const patches = kelpCanopy(features.kelp, (x, y) => world.chartDepth(x, y));

  it('lies along the lee shore in water of the right depth, the same every time', () => {
    expect(patches).toEqual(kelpCanopy(features.kelp, (x, y) => world.chartDepth(x, y)));
    expect(patches.length).toBeGreaterThan(800);
    expect(patches.length).toBeLessThan(4000);
    const beds = new Map(features.kelp!.map((b) => [b.id, b]));
    for (const p of patches) {
      const [lo, hi] = beds.get(p.bed)!.depth ?? KELP_DEPTH;
      const d = world.chartDepth(p.x, p.y);
      expect(d).toBeGreaterThanOrEqual(lo - 2);
      expect(d).toBeLessThanOrEqual(hi + 2);
    }
    // Every bed on the island has some, and there is kelp off the Casino for the dive park.
    for (const b of features.kelp!) expect(patches.some((p) => p.bed === b.id), b.id).toBe(true);
    expect(patches.some((p) => Math.hypot(p.x + 2230, p.y + 22300) < 400)).toBe(true);
    expect(inKelp(patches, patches[0].x, patches[0].y)).toBe(true);
    expect(inKelp(patches, 4500, -1500)).toBe(false);
  });
});

describe('what it costs to draw', () => {
  const sceneGround = { height: drawn, depth: (x: number, y: number) => world.chartDepth(x, y) };

  it('the structures are one mesh and one set of lights', () => {
    const built = buildStructures(structures);
    expect(built.group.children.length).toBe(2);
    expect(built.placed.length).toBe(structures.length);
    expect(built.triangles).toBeGreaterThan(8000);
    expect(built.triangles).toBeLessThan(26000);
  });

  it('Long Beach: towers, the liner, cranes on the quays and yachts in two marinas, inside its budget', () => {
    const built = buildLongBeach(course, sceneGround, places.map((p): [number, number, number] => [p.x, p.y, 90]));
    expect(built.counts.towers).toBeGreaterThanOrEqual(12);
    expect(built.counts.cranes).toBeGreaterThanOrEqual(10);
    expect(built.counts.yachts).toBeGreaterThan(120);
    expect(built.triangles).toBeLessThan(22000);
    // One mesh, one set of lights, two instanced meshes a marina.
    expect(built.group.children.length).toBeLessThanOrEqual(4);
    expect(built.detail.length).toBeGreaterThanOrEqual(2);
  });

  it('Catalina: Avalon\'s mooring field, the houses on the hill, Two Harbors, trees, inside its budget', () => {
    const plans = towns.map((t) => planTown(t, ground));
    const built = buildCatalina(sceneGround, plans, places);
    expect(built.counts.avalonMoorings).toBeGreaterThan(150);
    expect(built.counts.avalonHouses).toBeGreaterThan(250);
    expect(built.counts.avalonFronts).toBeGreaterThan(30);
    expect(built.counts.isthmusMoorings).toBeGreaterThan(60);
    expect(built.counts.trees).toBeGreaterThan(300);
    expect(built.triangles).toBeLessThan(150000);
    // Everything but nothing is given a distance beyond which it is not drawn.
    expect(built.detail.length).toBe(built.group.children.reduce((n, c) => n + (c.type === 'Group' ? 1 : 1), 0));
  });
});

describe('the island as it is', () => {
  // Facts of the real Santa Catalina that the land baked from the elevation tiles and the satellite picture
  // (pipeline/catalina/land.py) must keep. Course metres from 33.55 N, 118.30 W.
  const at = (lat: number, lon: number): [number, number] => [(lon + 118.3) * 6371008.8 * (Math.PI / 180) * Math.cos((33.55 * Math.PI) / 180), (lat - 33.55) * 6371008.8 * (Math.PI / 180)];
  const highest = (x: number, y: number, r: number, step = 20): number => {
    let top = 0;
    for (let dy = -r; dy <= r; dy += step) for (let dx = -r; dx <= r; dx += step) top = Math.max(top, drawn(x + dx, y + dy));
    return top;
  };
  const coast = (course as unknown as { coast: number[][] }).coast;
  const island = coast.filter((r) => Math.max(...r.filter((_, k) => k % 2 === 1)) < 0).sort((a, b) => b.length - a.length)[0];

  it('covers 194 square kilometres, as the island does', () => {
    let area = 0;
    for (let k = 0; k < island.length; k += 2) {
      const j = (k + 2) % island.length;
      area += island[k] * island[j + 1] - island[j] * island[k + 1];
    }
    expect(Math.abs(area) / 2 / 1e6).toBeGreaterThan(188);
    expect(Math.abs(area) / 2 / 1e6).toBeLessThan(200);
  });

  it('rises to Mount Orizaba, about 640 m, the top of the island', () => {
    const orizaba = highest(...at(33.379, -118.418), 1200);
    expect(orizaba).toBeGreaterThan(610);
    expect(orizaba).toBeLessThan(660);
    // Nowhere else on the island is higher.
    expect(highest(-15000, -18000, 13000, 100)).toBeLessThan(orizaba + 5);
  });

  it('is pinched at the Isthmus: Isthmus Cove and Catalina Harbor less than 850 m apart, with low land between', () => {
    const cove: [number, number] = [-18330, -11990];
    const harbor: [number, number] = [-18700, -12720];
    expect(world.chartDepth(...cove)).toBeGreaterThan(1);
    // The head of Catalina Harbor is shoal mud, but water.
    expect(world.chartDepth(...harbor)).toBeGreaterThan(0);
    expect(Math.hypot(cove[0] - harbor[0], cove[1] - harbor[1])).toBeLessThan(850);
    const mid = drawn((cove[0] + harbor[0]) / 2, (cove[1] + harbor[1]) / 2);
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThan(40);
  });

  it('has Avalon Bay between Casino Point and the Cabrillo Mole, open water across it and land at each end', () => {
    const avalon = towns.find((t) => t.id === 'avalon')!;
    const casino = avalon.paths.find((p) => p.id === 'casino-walk')!.centre!;
    const end = avalon.paths.find((p) => p.id === 'mole')!.points![1];
    // About 550 m from the middle of the Casino to the end of the mole, as the picture has them.
    const across = Math.hypot(end[0] - casino[0], end[1] - casino[1]);
    expect(across).toBeGreaterThan(500);
    expect(across).toBeLessThan(750);
    expect(drawn(casino[0], casino[1])).toBeGreaterThan(0);
    expect(world.chartDepth(end[0], end[1])).toBe(0);
    // Water from the north-west shore under the bluff to the mole, deep enough to moor in at the middle.
    let wet = 0;
    for (let k = 1; k < 20; k++) if (world.chartDepth(-2480 + ((end[0] + 2480) * k) / 20, -22560 + ((end[1] + 22560) * k) / 20) > 2) wet++;
    expect(wet).toBeGreaterThanOrEqual(17);
    expect(world.chartDepth(-2300, -22620)).toBeGreaterThan(8);
    // The town fills an amphitheatre: the hills behind it stand over 300 m within two kilometres.
    expect(highest(-2700, -23400, 1000)).toBeGreaterThan(300);
  });

  it('keeps Bird Rock and Ship Rock above water off the Isthmus', () => {
    for (const [lat, lon] of [[33.4514, -118.4875], [33.4633, -118.4917]]) expect(highest(...at(lat, lon), 100, 5)).toBeGreaterThan(10);
  });
});
