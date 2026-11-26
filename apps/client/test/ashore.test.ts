import { describe, expect, it } from 'vitest';
import { ITEMS, SUNSET, SunsetWatch, barLine, gatherLine, houseDrink, menuFor, offersAt, pay, roundAward, sightsFrom, sittingWith, viewWords, type BarFacts } from '../src/ashore/actions';
import { BODY, groundOfVenue } from '../src/ashore/fromVenue';
import { areaAt, areaFrom, ceilingAt, clearTo, floorAt, floorUnder, inRing, nearOnLine, outside, standNear, toCourse, toLocal, walkStep, type Footing, type WalkGround } from '../src/ashore/ground';
import { CHAIR, EMOTE_SECONDS, JOG, RAIL, STOOL, WALK, poseOf, stride, type PoseIn } from '../src/ashore/pose';
import { EMOTES, POSES, Track, mustYield, packAshore, readAshore, stampOf, type AshoreReport } from '../src/ashore/wire';
import { layoutOf, planVenue, type VenueGround, type VenuePlace } from '../src/scene/venue';

/** Land to the west of x = 0 at 3 m, sea to the east, as `shore.test.ts` has it. */
const shore: VenueGround = { height: (x) => (x < 0 ? 3 : -6), sailable: (x) => x > 20, depth: (x) => (x < 0 ? 0 : x / 10) };
const bar: VenuePlace = { id: 'test-bar', name: 'The Test', x: 150, y: 0, kind: 'dock', ashore: { name: 'the test bar', kind: 'bar', deck: [30, 16], tables: 10 } };
const plan = planVenue(bar, shore)!;
const layout = layoutOf(plan, shore);
const ground = groundOfVenue(layout)!;

/** A square deck 10 m on a side with a 2 m walkway off the middle of its east edge, and a lower terrace touching its north edge with no way down. */
const yard: WalkGround = {
  id: 'yard', name: 'The Yard', x: 0, y: 0, heading: Math.PI / 2,
  areas: [
    { ring: [[0, 0], [10, 0], [10, 10], [0, 10]], z: 2 },
    { ring: [[10, 4], [20, 4], [20, 6], [10, 6]], z: 2, ramp: { from: [10, 5], to: [20, 5], z1: 0.5 } },
    { ring: [[0, 10], [10, 10], [10, 16], [0, 16]], z: -1 },
  ],
  links: [[0, 1]],
  blocks: [{ ax: 5, ay: 5, bx: 5, by: 5, r: 1 }],
  walls: [{ ax: -3, ay: 0, bx: 13, by: 0, top: 6 }],
  spots: [
    { name: 'seat-a', kind: 'seat', x: 2, y: 2, face: 0, group: 'table-1' },
    { name: 'seat-b', kind: 'seat', x: 3, y: 2, face: 0, group: 'table-1' },
    { name: 'rail-1', kind: 'rail', x: 8, y: 9.5, face: 0 },
    { name: 'bar-1', kind: 'bar', x: 8, y: 1.5, face: Math.PI, group: 'bar' },
  ],
};
const walk = (g: WalkGround, from: Footing, dx: number, dy: number, steps: number): Footing => {
  let at = from;
  for (let i = 0; i < steps; i++) at = walkStep(g, at, dx, dy);
  return at;
};

describe('standing on the ground', () => {
  it('knows inside from outside, and how far outside', () => {
    const ring = yard.areas[0].ring;
    expect(inRing(ring, 5, 5)).toBe(true);
    expect(inRing(ring, 11, 5)).toBe(false);
    expect(outside(ring, 5, 5)).toBe(0);
    expect(outside(ring, 12, 5)).toBeCloseTo(2);
    expect(nearOnLine(0, 0, 10, 0, 4, 3)).toMatchObject({ t: 0.4, d: 3 });
  });

  it('has the height of each floor, and of a slope along it', () => {
    expect(floorAt(yard.areas[0], 3, 3)).toBe(2);
    expect(floorAt(yard.areas[1], 10, 5)).toBe(2);
    expect(floorAt(yard.areas[1], 15, 4.2)).toBeCloseTo(1.25);
    expect(floorAt(yard.areas[1], 20, 5)).toBe(0.5);
    expect(floorUnder(yard, { x: 15, y: 5, area: 1 })).toBeCloseTo(1.25);
  });

  it('puts somebody down on what is under her, or the nearest edge within reach', () => {
    expect(areaAt(yard, 5, 5)).toBe(0);
    expect(areaAt(yard, 30, 30)).toBe(-1);
    const near = standNear(yard, 22, 5, 5)!;
    expect(near.area).toBe(1);
    expect(inRing(yard.areas[1].ring, near.x, near.y)).toBe(true);
    expect(standNear(yard, 60, 5, 5)).toBeNull();
  });
});

describe('walking', () => {
  it('goes where she walks while there is floor', () => {
    const at = walkStep(yard, { x: 2, y: 2, area: 0 }, 0.5, 0.25);
    expect(at).toMatchObject({ x: 2.5, y: 2.25, area: 0, bumped: false });
  });

  it('stops at the edge and does not walk into the water', () => {
    const at = walk(yard, { x: 2, y: 2, area: 0 }, -0.1, 0, 60);
    expect(at.x).toBeGreaterThanOrEqual(-0.16);
    expect(at.x).toBeLessThan(0.2);
    expect(at.y).toBeCloseTo(2);
  });

  it('slides along an edge she walks into at an angle', () => {
    const at = walk(yard, { x: 2, y: 2, area: 0 }, -0.1, 0.1, 40);
    expect(at.x).toBeLessThan(0.2);
    // Still making her way north along the edge.
    expect(at.y).toBeGreaterThan(5);
    expect(at.area).toBe(0);
  });

  it('passes onto a linked area, and down its slope', () => {
    const at = walk(yard, { x: 8, y: 5, area: 0 }, 0.1, 0, 70);
    expect(at.area).toBe(1);
    expect(at.x).toBeCloseTo(15, 0);
    expect(floorUnder(yard, at)).toBeLessThan(1.5);
    // And back up.
    const back = walk(yard, at, -0.1, 0, 90);
    expect(back.area).toBe(0);
    expect(floorUnder(yard, back)).toBe(2);
  });

  it('does not step off onto an area there is no way onto, though it touches', () => {
    const at = walk(yard, { x: 2, y: 8, area: 0 }, 0, 0.1, 60);
    expect(at.area).toBe(0);
    expect(at.y).toBeLessThan(10.2);
    expect(areaFrom(yard, 0, 2, 12)).toBe(-1);
    // From the terrace itself it is plain ground.
    expect(areaFrom(yard, 2, 2, 12)).toBe(2);
  });

  it('cannot leave the walkway over its side', () => {
    const at = walk(yard, { x: 15, y: 5, area: 1 }, 0, 0.1, 40);
    expect(at.y).toBeLessThan(6.2);
    expect(at.area).toBe(1);
  });

  it('goes round a table, not through it', () => {
    let at: Footing = { x: 2, y: 5.3, area: 0 };
    for (let i = 0; i < 80; i++) {
      at = walkStep(yard, at, 0.1, 0);
      expect(Math.hypot(at.x - 5, at.y - 5)).toBeGreaterThan(0.97);
    }
    // She came out the other side.
    expect(at.x).toBeGreaterThan(6);
  });

  it('never ends up off the ground whatever is asked of it', () => {
    let at: Footing = { x: 5, y: 2, area: 0 };
    for (let i = 0; i < 2000; i++) {
      const a = i * 2.399;
      at = walkStep(yard, at, Math.cos(a) * 0.4, Math.sin(a * 1.7) * 0.4);
      const d = Math.min(outside(yard.areas[0].ring, at.x, at.y), outside(yard.areas[1].ring, at.x, at.y));
      expect(d).toBeLessThanOrEqual(0.151);
      expect(at.area === 0 || at.area === 1).toBe(true);
    }
  });
});

describe('a venue as somewhere to walk', () => {
  it('is its deck, its walkway and its float, each opening onto the next', () => {
    expect(ground.areas.map((a) => a.name)).toEqual(['deck', 'walkway', 'float']);
    expect(ground.links).toEqual([[0, 1], [1, 2]]);
    expect(ground.id).toBe('test-bar');
    expect(ground.areas[0].z).toBe(layout.floor);
    expect(ground.areas[2].z).toBe(0.45);
  });

  it('has the floors at the heights they are drawn at', () => {
    const j = plan.jetty!;
    const s = plan.site;
    expect(layout.levels[1][0]).toBeCloseTo(s.base + j.z0, 2);
    expect(layout.levels[1][1]).toBeCloseTo(s.base + j.z1, 2);
    const way = ground.areas[1];
    const [a, b, c, d] = way.ring;
    expect(floorAt(way, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)).toBeCloseTo(layout.levels[1][0], 2);
    expect(floorAt(way, (c[0] + d[0]) / 2, (c[1] + d[1]) / 2)).toBeCloseTo(layout.levels[1][1], 2);
  });

  it('can be walked from the float up to the door without leaving it', () => {
    const dock = ground.spots.find((s) => s.kind === 'dock')!;
    const door = ground.spots.find((s) => s.kind === 'door')!;
    let at: Footing = { x: dock.x, y: dock.y, area: areaAt(ground, dock.x, dock.y) };
    expect(at.area).toBe(2);
    const areas = new Set<number>();
    // Along the float to the foot of the walkway, up it, then across the deck to the door: steering for each in turn.
    const way = ground.areas[1].ring;
    const goals: Array<[number, number]> = [[(way[2][0] + way[3][0]) / 2, (way[2][1] + way[3][1]) / 2], [(way[0][0] + way[1][0]) / 2, (way[0][1] + way[1][1]) / 2], [door.x, door.y]];
    for (const [gx, gy] of goals) {
      for (let i = 0; i < 4000 && Math.hypot(gx - at.x, gy - at.y) > 1.2; i++) {
        const d = Math.hypot(gx - at.x, gy - at.y);
        at = walkStep(ground, at, ((gx - at.x) / d) * 0.05, ((gy - at.y) / d) * 0.05);
        areas.add(at.area);
      }
    }
    expect(Math.hypot(door.x - at.x, door.y - at.y)).toBeLessThan(2.5);
    expect([...areas].sort()).toEqual([0, 1, 2]);
    expect(at.area).toBe(0);
  });

  it('blocks the tables, the chairs and the counter', () => {
    const tables = ground.spots.filter((s) => s.kind === 'table');
    expect(tables.length).toBe(plan.tables.length);
    for (const t of tables) {
      const at = walkStep(ground, { x: t.x + 1.6, y: t.y + 1.6, area: 0 }, -1.6, -1.6);
      expect(Math.hypot(at.x - t.x, at.y - t.y)).toBeGreaterThanOrEqual(0.5 + BODY - 0.03);
    }
    // The counter: nobody stands in the middle of it.
    const stools = ground.spots.filter((s) => s.kind === 'bar');
    const mid = stools[1];
    const cx = mid.x + Math.sin(mid.face) * 0.9;
    const cy = mid.y + Math.cos(mid.face) * 0.9;
    const at = walkStep(ground, { x: mid.x, y: mid.y, area: 0 }, cx - mid.x, cy - mid.y);
    expect(Math.hypot(at.x - cx, at.y - cy)).toBeGreaterThan(0.4);
  });

  it('marks the seats the scenery has, and groups each table', () => {
    const seats = ground.spots.filter((s) => s.kind === 'seat');
    const sitters = plan.people.filter((p) => p.sit).length;
    expect(seats.filter((s) => s.taken).length).toBe(sitters);
    expect(seats.some((s) => !s.taken)).toBe(true);
    expect(seats.every((s) => /^table-\d+$/.test(s.group ?? ''))).toBe(true);
    expect(ground.spots.filter((s) => s.kind === 'bar').every((s) => s.group === 'bar')).toBe(true);
  });

  it('keeps the camera on the deck side of the building', () => {
    const door = ground.spots.find((s) => s.kind === 'door')!;
    // From the door, a camera pulled back toward the building is stopped short of it.
    const bx = door.x - Math.sin(ground.heading) * 4;
    const by = door.y - Math.cos(ground.heading) * 4;
    const clear = clearTo(ground, door.x, door.y, layout.floor + 1.5, bx, by, layout.floor + 2.2);
    expect(clear).toBeLessThan(0.3);
    // Out over the water there is nothing in the way.
    expect(clearTo(ground, door.x, door.y, layout.floor + 1.5, door.x + Math.sin(ground.heading) * 4, door.y + Math.cos(ground.heading) * 4, layout.floor + 2.2)).toBe(1);
    // Nor from high above the roof.
    expect(clearTo(ground, door.x, door.y, layout.floor + 1.5, bx, by, layout.floor + 60)).toBe(1);
  });

  it('has the awning over the first of the deck, for the camera to stay under', () => {
    const door = ground.spots.find((s) => s.kind === 'door')!;
    expect(ceilingAt(ground, door.x, door.y)).toBeCloseTo(layout.floor + 2.25, 2);
    // Out by the rail there is only sky.
    const rail = ground.spots.find((s) => s.kind === 'rail')!;
    expect(ceilingAt(ground, rail.x, rail.y)).toBe(Infinity);
    expect(ceilingAt(yard, 5, 5)).toBe(Infinity);
  });

  it('tells positions in its own frame, and reads them back', () => {
    const [u, v] = toLocal(ground, layout.dock!.x, layout.dock!.y);
    // The float is out toward the water: along v.
    expect(v).toBeGreaterThan(10);
    const [x, y] = toCourse(ground, u, v);
    expect(x).toBeCloseTo(layout.dock!.x, 6);
    expect(y).toBeCloseTo(layout.dock!.y, 6);
    // u is to the right, looking at the water: on this east-facing shore, south.
    const right = toCourse(ground, 5, 0);
    expect(right[1]).toBeLessThan(ground.y - 4.9);
  });

  it('is nothing where a venue has nothing to stand on', () => {
    expect(groundOfVenue({ ...layout, walk: [], levels: [] })).toBeNull();
  });
});

describe('what there is to do', () => {
  const none = new Set<number>();
  it('offers the seat she is beside, and not one somebody has', () => {
    const offers = offersAt(yard, 2.2, 2.8, none, 0);
    expect(offers).toEqual([{ key: 'KeyF', label: 'sit at the table', pose: 'sit', spot: 0 }]);
    expect(offersAt(yard, 2.2, 2.8, new Set([0]), 0)[0].spot).toBe(1);
    expect(offersAt(yard, 2.2, 2.8, new Set([0, 1]), 0)).toEqual([]);
  });

  it('offers the rail at the rail, a stool and the menu at the bar, and nothing in the middle of the floor', () => {
    expect(offersAt(yard, 8, 9, none, 3).map((o) => o.pose)).toEqual(['lean']);
    const atBar = offersAt(yard, 8, 2.2, none, 3);
    expect(atBar.map((o) => o.key)).toEqual(['KeyF', 'KeyG']);
    expect(atBar[0].pose).toBe('stool');
    expect(atBar[1].label).toBe('order at the bar');
    // A place that sells nothing has no menu.
    expect(offersAt(yard, 8, 2.2, none, 0).map((o) => o.key)).toEqual(['KeyF']);
    expect(offersAt(yard, 5.5, 7.4, none, 3)).toEqual([]);
  });

  it('never seats a player on the scenery', () => {
    for (const s of ground.spots) {
      const got = offersAt(ground, s.x, s.y, none, 0).find((o) => o.key === 'KeyF');
      if (got && got.spot >= 0) expect(ground.spots[got.spot].taken).toBeFalsy();
    }
  });

  it('dances on the dance floor and warms hands at a fire, where she stands', () => {
    const g: WalkGround = { ...yard, spots: [{ name: 'dance', kind: 'dance', x: 5, y: 8, face: 0 }, { name: 'fire', kind: 'fire', x: 1, y: 1, face: 0 }] };
    expect(offersAt(g, 6, 8, none, 0)[0]).toMatchObject({ pose: 'dance', spot: -1 });
    expect(offersAt(g, 2, 2, none, 0)[0]).toMatchObject({ pose: 'warm', spot: -1 });
  });

  it('knows who is at the same table', () => {
    const others = [{ spot: 1, name: 'Ana' }, { spot: 3, name: 'Bo' }, { spot: -1, name: 'Cy' }];
    expect(sittingWith(yard, 0, others).map((o) => o.name)).toEqual(['Ana']);
    expect(sittingWith(yard, 2, others)).toEqual([]);
  });
});

describe('the menu', () => {
  it('comes from the kind of place, the water and the place itself', () => {
    const names = (kind: string, water: string, place: string) => menuFor(kind, water, place).map((i) => ITEMS[i].id);
    expect(names('bar', 'bvi', 'whitebay')[0]).toBe('painkiller');
    expect(names('bar', 'catalina', 'isthmus')[0]).toBe('buffalo-milk');
    expect(names('bar', 'sf-bay', 'sams')).toContain('irish-coffee');
    expect(names('bar', 'nowhere', 'nothing')).toEqual(['beer', 'rum-punch', 'fish-tacos', 'coffee']);
    expect(names('park', 'bvi', 'baths')).toEqual([]);
    for (const kind of ['bar', 'club', 'hotel', 'marina', 'store']) for (const water of ['bvi', 'sf-bay', 'catalina', 'san-juans', 'farallones']) {
      const menu = menuFor(kind, water, 'x');
      expect(menu.length).toBeGreaterThan(1);
      expect(menu.length).toBeLessThanOrEqual(5);
      expect(new Set(menu).size).toBe(menu.length);
      expect(houseDrink(menu)).toBeGreaterThanOrEqual(0);
      expect(ITEMS[houseDrink(menu)].held).not.toBe('plate');
    }
  });

  it('costs nothing yet, through the one place that will take the money', () => {
    expect(ITEMS.length).toBeLessThanOrEqual(64);
    for (const item of ITEMS) {
      expect(item.price).toBeGreaterThan(0);
      expect(pay(item)).toBe(true);
    }
  });

  it('is served with something true about the water', () => {
    const facts: BarFacts = {
      facts: { windKt: 9, windFrom: 'east', windier: null, turn: { high: true, minutes: 95 }, berth: null, fish: { species: 'snapper', place: 'the Indians', how: 'with a bait on the bottom' } },
      later: { kt: 17, from: 'east', hour: 16 }, inPort: ['Windrose', 'Tern'],
    };
    const beer = ITEMS.find((i) => i.id === 'beer')!;
    expect(barLine(beer, facts, 0)).toBe('A cold beer. It is 9 knots out there now and the forecast has 17 from the east by 16:00. I would not leave it late.');
    expect(barLine(beer, facts, 1)).toBe('A cold beer. Windrose and Tern are in as well.');
    expect(barLine(beer, facts, 2)).toContain('High water in about 1.5 hours');
    expect(barLine(beer, facts, 3)).toContain('snapper off the Indians');
    // With nothing known about the tide or the fish, it falls through to what is.
    const bare: BarFacts = { facts: { ...facts.facts, turn: null, fish: null }, later: null, inPort: [] };
    expect(barLine(beer, bare, 2)).toBe('A cold beer. Yours is the only boat in just now.');
    expect(barLine(beer, bare, 0)).toBe('A cold beer. Yours is the only boat in just now.');
  });
});

describe('awards ashore', () => {
  it('pays for a round only when somebody is there to drink it', () => {
    expect(roundAward(0)).toBeNull();
    expect(roundAward(2)).toMatchObject({ kind: 'ashore', points: 10 });
  });

  it('gives the sunset to somebody who stood at the rail while it went', () => {
    const watch = new SunsetWatch();
    let got = 0;
    // The sun comes down from five degrees to two below over 200 seconds, and she is at the rail all the while.
    for (let t = 0; t <= 200; t++) if (watch.update(1, 0.09 - (t / 200) * 0.13, true, true)) got++;
    expect(got).toBe(1);
    // Once is once.
    expect(watch.update(1, -0.05, true, true)).toBe(false);
  });

  it('gives nothing for arriving after it has gone, for leaving the rail, or for a sunrise', () => {
    const late = new SunsetWatch();
    for (let t = 0; t < 200; t++) expect(late.update(1, SUNSET.to - 0.01, true, true)).toBe(false);
    const left = new SunsetWatch();
    let got = false;
    for (let t = 0; t <= 200; t++) got = left.update(1, 0.09 - (t / 200) * 0.13, true, t < 100 || t > 190) || got;
    expect(got).toBe(false);
    const dawn = new SunsetWatch();
    for (let t = 0; t <= 200; t++) expect(dawn.update(1, -0.04 + (t / 200) * 0.13, false, true)).toBe(false);
  });
});

describe('telling the fleet, and looking out', () => {
  it('gives each boat her own distance and bearing', () => {
    expect(gatherLine('Scott', "Sam's", 'Tiburon', 0, 0, -1667, 1986)).toBe("Scott is at Sam's, Tiburon. 1.4 miles at 320°");
    expect(gatherLine('Scott', "Sam's", '', 0, 0, 0, 400)).toBe("Scott is at Sam's. 400 m at 000°");
    expect(gatherLine('Scott', "Sam's", 'Tiburon', 0, 0, 30, 40)).toBe("Scott is at Sam's, Tiburon: right here");
  });

  it('names what lies the way she is facing, nearest first', () => {
    const things = [{ name: 'East Rock', x: 3000, y: 100 }, { name: 'Far East', x: 9000, y: -500 }, { name: 'West Cay', x: -4000, y: 0 }, { name: 'Here', x: 50, y: 0 }];
    const seen = sightsFrom(0, 0, Math.PI / 2, things);
    expect(seen.map((s) => s.name)).toEqual(['East Rock', 'Far East']);
    expect(viewWords(Math.PI / 2, seen)).toBe('Looking east: East Rock 1.6 miles, Far East 4.9 miles');
    expect(viewWords(0, [])).toBe('Looking north, over open water');
  });
});

describe('what is told to the others', () => {
  const report: AshoreReport = { venue: 'test-bar', u: -3.26, v: 12.44, face: 2.5, pose: 'sit', spot: 7, since: 1234, emote: 'cheers', emoteAt: 99, hold: 2, round: 5, roundItem: 2, gather: 0 };

  it('goes out as a short list and comes back the same, to a decimetre', () => {
    const wire = packAshore(report);
    expect(wire.length).toBe(13);
    expect(JSON.stringify(wire).length).toBeLessThan(70);
    expect(readAshore(JSON.parse(JSON.stringify(wire)))).toEqual({ ...report, u: -3.3, v: 12.4 });
    expect(readAshore(packAshore({ ...report, emote: '', hold: -1, spot: -1, pose: 'dance2' }))).toMatchObject({ emote: '', hold: -1, spot: -1, pose: 'dance2' });
  });

  it('is refused whole when any of it is not what it should be', () => {
    const good = packAshore(report);
    expect(readAshore(good)).not.toBeNull();
    const bad: unknown[] = [
      null, undefined, 7, 'ashore', {}, [], good.slice(0, 12), [...good, 1],
      ['', ...good.slice(1)], ['../../etc', ...good.slice(1)], ['<img src=x>', ...good.slice(1)], [7, ...good.slice(1)], ['a'.repeat(41), ...good.slice(1)],
    ];
    for (let i = 1; i < good.length; i++) {
      for (const junk of [NaN, Infinity, -Infinity, 1e12, -1e12, 0.5, '1', null, {}, [1]]) bad.push(good.map((v, k) => (k === i ? junk : v)));
    }
    // A pose, an emote, an item or a spot that does not exist.
    bad.push(good.map((v, k) => (k === 4 ? POSES.length : v)), good.map((v, k) => (k === 7 ? EMOTES.length : v)), good.map((v, k) => (k === 9 ? 64 : v)), good.map((v, k) => (k === 5 ? -2 : v)));
    for (const b of bad) expect(readAshore(b), JSON.stringify(b)).toBeNull();
  });

  it('stamps are small whole numbers', () => {
    expect(stampOf(1795000000123)).toBe(95000000);
    expect(Number.isInteger(stampOf(Date.now()))).toBe(true);
    expect(readAshore(packAshore({ ...report, since: stampOf(Date.now()), emoteAt: stampOf(Date.now()) }))).not.toBeNull();
  });

  it('a position that is nowhere on the ground is not somewhere to stand', () => {
    // What the feature does with a report: her spot if she has one, else where she says, if that is on the ground.
    const lost = readAshore(packAshore({ ...report, pose: 'stand', spot: -1, u: 900, v: -900 }))!;
    const [x, y] = toCourse(ground, lost.u, lost.v);
    expect(standNear(ground, x, y, 1.5)).toBeNull();
    const close = toCourse(ground, ...toLocal(ground, layout.dock!.x, layout.dock!.y));
    expect(standNear(ground, close[0], close[1], 1.5)).not.toBeNull();
  });
});

describe('drawing somebody between her reports', () => {
  it('walks her from each to the next at a steady pace', () => {
    const track = new Track();
    track.hear(0, 0, 0, 0);
    expect([track.u, track.v]).toEqual([0, 0]);
    // A report every half second, walking east at 1.4 m/s.
    let worst = 0;
    let last = 0;
    for (let i = 1; i <= 10; i++) {
      track.hear(i * 0.7, 0, Math.PI / 2, i * 0.5);
      for (let k = 0; k < 30; k++) {
        track.update(0.5 / 30);
        expect(track.u).toBeGreaterThanOrEqual(last - 1e-9);
        worst = Math.max(worst, track.u - last);
        last = track.u;
      }
    }
    // No frame moved her more than a couple of frames' walking.
    expect(worst).toBeLessThan(0.08);
    expect(track.u).toBeGreaterThan(5.5);
    expect(track.u).toBeLessThanOrEqual(7 + 1e-9);
    expect(track.speed).toBeGreaterThan(1);
    expect(track.speed).toBeLessThan(1.9);
    expect(track.face).toBeCloseTo(Math.PI / 2, 1);
  });

  it('stops when she stops, and arrives where she said', () => {
    const track = new Track();
    track.hear(0, 0, 0, 0);
    track.hear(2, 1, 0, 0.5);
    for (let k = 0; k < 120; k++) track.update(1 / 60);
    expect(track.u).toBeCloseTo(2, 5);
    expect(track.v).toBeCloseTo(1, 5);
    expect(track.speed).toBeLessThan(0.05);
  });

  it('puts her there at once when she has gone a long way: sat down across the deck, or arrived', () => {
    const track = new Track();
    track.hear(0, 0, 0, 0);
    track.hear(20, 5, 1, 0.3);
    expect([track.u, track.v, track.face]).toEqual([20, 5, 1]);
  });

  it('turns the short way round', () => {
    const track = new Track();
    track.hear(0, 0, 3.0, 0);
    track.hear(0, 0, -3.0, 0.3);
    track.update(0.05);
    expect(Math.abs(track.face)).toBeGreaterThan(3.0);
  });
});

describe('who has a seat', () => {
  it('is whoever sat down first', () => {
    const me = { spot: 4, since: 100, key: 'b' };
    expect(mustYield(me, [{ spot: 4, since: 90, key: 'a' }])).toBe(true);
    expect(mustYield(me, [{ spot: 4, since: 110, key: 'a' }])).toBe(false);
    expect(mustYield(me, [{ spot: 5, since: 90, key: 'a' }])).toBe(false);
    expect(mustYield({ ...me, spot: -1 }, [{ spot: -1, since: 1, key: 'a' }])).toBe(false);
  });

  it('is settled the same way on both pages when two sit in the same second', () => {
    const a = { spot: 4, since: 100, key: 'a' };
    const b = { spot: 4, since: 100, key: 'b' };
    expect(mustYield(a, [b])).toBe(false);
    expect(mustYield(b, [a])).toBe(true);
  });
});

describe('how a figure holds herself', () => {
  const base: PoseIn = { pose: 'stand', t: 3.3, phase: 0, speed: 0, tall: 1, emote: '', emoteT: 99, held: 'none' };
  const finite = (p: PoseIn): void => {
    const j = poseOf(p);
    for (const v of [j.pelvis, j.neck, j.footL, j.footR, j.handL, j.handR, j.look, j.knee, j.elbowL, j.elbowR]) for (const n of v) expect(Number.isFinite(n)).toBe(true);
    expect(Number.isFinite(j.turn + j.forward)).toBe(true);
    // Nothing goes through the floor, and the head is above the hips.
    expect(j.footL[1]).toBeGreaterThanOrEqual(0);
    expect(j.footR[1]).toBeGreaterThanOrEqual(0);
    expect(j.neck[1]).toBeGreaterThan(j.pelvis[1] + 0.4);
    // The hands are within an arm of the shoulders, near enough that the arm is not drawn at full stretch for long.
    for (const [hand, side] of [[j.handL, -1], [j.handR, 1]] as const) expect(Math.hypot(hand[0] - (j.neck[0] + side * 0.2), hand[1] - (j.neck[1] - 0.05), hand[2] - j.neck[2])).toBeLessThan(0.75 * p.tall + 0.12);
  };

  it('is sound in every pose, with every emote and anything in the hand, short or tall', () => {
    for (const pose of POSES) for (const emote of ['', ...EMOTES] as const) for (const held of ['none', 'glass', 'plate'] as const) for (const tall of [0.9, 1, 1.1]) {
      for (const t of [0, 0.4, 1.3, 2.1, 7.7]) finite({ ...base, pose, emote, emoteT: t % EMOTE_SECONDS, held, tall, t: t * 3 });
    }
    for (const speed of [0.3, WALK, JOG]) for (let phase = 0; phase < 7; phase += 0.3) finite({ ...base, speed, phase });
  });

  it('walks with one foot forward and the other back, the forward one lifted, and the arms against the legs', () => {
    const j = poseOf({ ...base, speed: WALK, phase: Math.PI / 2 });
    // Forward is -z.
    expect(j.footL[2]).toBeLessThan(-0.2);
    expect(j.footR[2]).toBeGreaterThan(0.2);
    expect(j.handL[2]).toBeGreaterThan(j.handR[2]);
    const mid = poseOf({ ...base, speed: WALK, phase: 0 });
    expect(mid.footL[1]).toBeGreaterThan(0.04);
    expect(mid.footR[1]).toBe(0);
  });

  it('strides longer and faster at a jog, and not at all standing still', () => {
    expect(stride(0, 1, 1)).toBe(0);
    const walkCycle = stride(WALK, 1, 1);
    const jogCycle = stride(JOG, 1, 1);
    // About two steps a second walking, three jogging.
    expect(walkCycle / Math.PI).toBeGreaterThan(1.6);
    expect(walkCycle / Math.PI).toBeLessThan(2.4);
    expect(jogCycle / Math.PI).toBeGreaterThan(2.6);
    expect(jogCycle / Math.PI).toBeLessThan(3.6);
    const step = (speed: number) => poseOf({ ...base, speed, phase: Math.PI / 2 }).footR[2] - poseOf({ ...base, speed, phase: Math.PI / 2 }).footL[2];
    expect(step(JOG)).toBeGreaterThan(step(WALK) * 1.3);
  });

  it('sits at the height of the chair, the stool higher, hands on the table and the counter', () => {
    const chair = poseOf({ ...base, pose: 'sit' });
    expect(chair.pelvis[1]).toBeCloseTo(CHAIR + 0.1, 2);
    expect(chair.handR[1]).toBeGreaterThan(0.7);
    const stool = poseOf({ ...base, pose: 'stool' });
    expect(stool.pelvis[1]).toBeCloseTo(STOOL + 0.1, 2);
    expect(stool.forward).toBeGreaterThan(0);
    expect(stool.handL[1]).toBeGreaterThan(1.05);
  });

  it('puts both hands on the rail to lean, raises a glass for cheers, and waves with the hand above the head', () => {
    const lean = poseOf({ ...base, pose: 'lean' });
    expect(lean.handL[1]).toBeCloseTo(RAIL + 0.03, 2);
    expect(lean.handR[1]).toBeCloseTo(RAIL + 0.03, 2);
    const still = poseOf({ ...base, held: 'glass', t: 5 });
    const cheers = poseOf({ ...base, held: 'glass', t: 5, emote: 'cheers', emoteT: 1 });
    expect(cheers.handR[1]).toBeGreaterThan(still.handR[1] + 0.3);
    const wave = poseOf({ ...base, emote: 'wave', emoteT: 1 });
    expect(wave.handR[1]).toBeGreaterThan(wave.neck[1] + 0.25);
    // An emote that has run its time is over.
    expect(poseOf({ ...base, emote: 'wave', emoteT: EMOTE_SECONDS + 0.1 }).handR).toEqual(poseOf(base).handR);
  });

  it('dances in time: two people who began together are in the same step', () => {
    const a = poseOf({ ...base, pose: 'dance', t: 12.34 });
    const b = poseOf({ ...base, pose: 'dance', t: 12.34 });
    expect(a).toEqual(b);
    expect(poseOf({ ...base, pose: 'dance', t: 12.6 }).pelvis).not.toEqual(a.pelvis);
    expect(poseOf({ ...base, pose: 'dance2', t: 12.34 }).handR).not.toEqual(a.handR);
  });
});
