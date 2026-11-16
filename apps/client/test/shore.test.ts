import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ReplayWorld, type CourseData } from '@slack-tide/world';
import { LABEL_RANGE, nearest, placeLabel } from '../src/aboard/landmarks';
import { groundHeight, WALK_RANGE, type HeightGrid } from '../src/aboard/paddle';
import { chartSailable, hashOf, shoreKind, siteFor, DRY, SHORE_KINDS, type ShoreGround } from '../src/scene/shoreSite';
import { layoutOf, planVenue, type VenueGround, type VenuePlace } from '../src/scene/venue';

/** Land to the west of x = 0 at 3 m, sea to the east. */
const coast: ShoreGround = { height: (x) => (x < 0 ? 3 : -6), sailable: (x) => x > 20 };

describe('the plot a venue stands on', () => {
  it('is on the shore nearest the place, facing the water', () => {
    const s = siteFor(120, 40, coast)!;
    expect(s).not.toBeNull();
    expect(s.x).toBeLessThan(0);
    expect(s.x).toBeGreaterThan(-40);
    expect(Math.abs(s.y - 40)).toBeLessThan(45);
    expect(s.fx).toBeGreaterThan(0.95);
    expect(coast.height(s.x, s.y)).toBeGreaterThan(DRY);
  });

  it('is found from a place that is itself drawn as land', () => {
    const s = siteFor(-200, 0, coast)!;
    expect(s.x).toBeLessThan(0);
    expect(s.x).toBeGreaterThan(-50);
    expect(s.fx).toBeGreaterThan(0.95);
  });

  it('is nowhere when there is no shore within reach', () => {
    expect(siteFor(5000, 0, coast)).toBeNull();
    expect(siteFor(0, 0, { height: () => -6, sailable: () => true })).toBeNull();
  });

  it('passes by a cliff for a beach a little further off', () => {
    // North of y = 0 the shore is a 40 m bluff; south of it, low ground.
    const g: ShoreGround = { height: (x, y) => (x >= 0 ? -6 : y > 0 ? 40 + -x * 2 : 2), sailable: (x) => x > 20 };
    const s = siteFor(60, 60, g)!;
    expect(s.y).toBeLessThan(0);
  });
});

describe('what a place is ashore', () => {
  it('comes from its data, or from how a boat stops there', () => {
    expect(shoreKind({ kind: 'dock', ashore: { kind: 'club' } })).toBe('club');
    expect(shoreKind({ kind: 'dock' })).toBe('bar');
    expect(shoreKind({ kind: 'anchorage', ashore: { kind: 'nonsense' } })).toBe('park');
  });

  it('is hashed the same every time and differently for each place', () => {
    expect(hashOf('sams', 3)).toBe(hashOf('sams', 3));
    expect(hashOf('sams', 3)).not.toBe(hashOf('sams', 4));
    expect(hashOf('sams', 3)).not.toBe(hashOf('ayala', 3));
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const h = hashOf('place', i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      seen.add(Math.floor(h * 10));
    }
    expect(seen.size).toBe(10);
  });
});

describe('a venue laid out on a plain shore', () => {
  const g: VenueGround = { ...coast, depth: (x) => (x < 0 ? 0 : x / 10) };
  const bar: VenuePlace = { id: 'test-bar', name: 'The Test', x: 150, y: 0, kind: 'dock', ashore: { name: 'the test bar', kind: 'bar', deck: [30, 16], tables: 10, umbrellas: 'white' } };

  it('has a deck over the shallows only, a walkway and a float', () => {
    const plan = planVenue(bar, g)!;
    expect(plan.kind).toBe('bar');
    expect(plan.deck).not.toBeNull();
    const s = plan.site;
    // The far edge of the deck, in the world: not beyond where a boat can float.
    expect(s.x + s.fx * plan.deck!.v1).toBeLessThanOrEqual(20.5);
    expect(plan.tables.length).toBeGreaterThan(3);
    expect(plan.tables.every((t) => t.shade)).toBe(true);
    expect(plan.float).not.toBeNull();
    expect(plan.people.length).toBeGreaterThan(2);
  });

  it('gives the next piece of work a walkable outline, a dock, a berth and named spots', () => {
    const plan = planVenue(bar, g)!;
    const lay = layoutOf(plan, g);
    expect(lay.name).toBe('The Test');
    expect(lay.walk.length).toBe(3);
    expect(lay.walk[0].length).toBe(4);
    expect(lay.dock).not.toBeNull();
    expect(lay.berth!.depth).toBeGreaterThanOrEqual(3.5);
    expect(lay.berth!.x).toBeGreaterThan(lay.dock!.x);
    const names = lay.spots.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(lay.spots.filter((p) => p.kind === 'seat').length).toBe(plan.tables.length * 4);
    for (const kind of ['door', 'table', 'bar', 'rail', 'dock'] as const) expect(lay.spots.some((p) => p.kind === kind)).toBe(true);
    // Somebody at the rail looks out over the water: east, on this shore.
    const rail = lay.spots.find((p) => p.kind === 'rail')!;
    expect(Math.sin(rail.face)).toBeGreaterThan(0.9);
    // A seat is under a metre from its table and faces it.
    const t1 = lay.spots.find((p) => p.name === 'table-1')!;
    const s1 = lay.spots.find((p) => p.name === 'table-1-seat-1')!;
    expect(Math.hypot(t1.x - s1.x, t1.y - s1.y)).toBeCloseTo(0.95, 0);
    expect(Math.sin(s1.face) * (t1.x - s1.x) + Math.cos(s1.face) * (t1.y - s1.y)).toBeGreaterThan(0.8);
  });

  it('is the same every time', () => {
    expect(JSON.stringify(layoutOf(planVenue(bar, g)!, g))).toBe(JSON.stringify(layoutOf(planVenue(bar, g)!, g)));
  });
});

describe('the labels over the places', () => {
  it('mark a place still to visit differently from one already stamped', () => {
    expect(placeLabel("Sam's, Tiburon", 640, false)).toBe("○ Sam's, Tiburon · 640 m");
    expect(placeLabel("Sam's, Tiburon", 1100, true)).toBe("✓ Sam's, Tiburon · 0.6 nm");
  });

  it('are for the nearest few within range, nearest first', () => {
    const spots = [{ x: 900, y: 0 }, { x: 100, y: 0 }, { x: 5000, y: 0 }, { x: 0, y: 400 }, { x: -300, y: 0 }];
    const out = [0, 1, 2].map(() => ({ spot: spots[0], d: 0 }));
    expect(nearest(spots, 0, 0, LABEL_RANGE, out)).toBe(3);
    expect(out.map((o) => o.d)).toEqual([100, 300, 400]);
    expect(nearest(spots, 0, 0, 200, out)).toBe(1);
    expect(nearest(spots, 20000, 0, LABEL_RANGE, out)).toBe(0);
  });
});

describe.each(['sf-bay', 'san-juans'])('the places of %s', (id) => {
  const dir = new URL(`../../../courses/${id}/`, import.meta.url);
  const course = JSON.parse(readFileSync(new URL('course.json', dir), 'utf8')) as CourseData;
  const places = JSON.parse(readFileSync(new URL('places.json', dir), 'utf8')) as VenuePlace[];
  const cur = readFileSync(new URL('current.bin', dir));
  const depths = new Uint8Array(readFileSync(new URL('depth.bin', dir)));
  const world = new ReplayWorld({ course, current: new Int8Array(cur.buffer, cur.byteOffset, cur.byteLength), depth: depths }, 0);
  const t = course.terrain;
  // The land as `scene/terrain.ts` draws it.
  const drawn = Float32Array.from(new Uint8Array(readFileSync(new URL('terrain.bin', dir))), (b) => { const h = (b / 255) ** 2 * t.max; return h > 0.4 ? h : -6; });
  const grid: HeightGrid = { x0: t.x0, y0: t.y0, dx: t.dx, nx: t.nx, ny: t.ny, data: drawn, stride: 1, offset: 0 };
  const g: VenueGround = { height: (x, y) => groundHeight(grid, x, y), sailable: chartSailable(course.depth, depths), depth: (x, y) => world.chartDepth(x, y) };

  it('each have a kind, a board and water to float in', () => {
    expect(new Set(places.map((p) => p.id)).size).toBe(places.length);
    for (const p of places) {
      expect(p.ashore, p.id).toBeTruthy();
      expect(SHORE_KINDS, p.id).toContain(p.ashore!.kind);
      expect(p.ashore!.sign, p.id).toBeTruthy();
      expect(world.chartDepth(p.x, p.y), p.id).toBeGreaterThanOrEqual(3);
    }
    expect(places.filter((p) => p.ashore!.kind === 'club').length).toBeGreaterThanOrEqual(1);
    expect(places.filter((p) => p.ashore!.kind === 'bar').length).toBeGreaterThanOrEqual(3);
  });

  it('each have a venue on dry land within a kayak landing of the place, with nothing built where a boat can float', () => {
    for (const p of places) {
      const plan = planVenue(p, g)!;
      expect(plan, p.id).not.toBeNull();
      const s = plan.site;
      expect(g.height(s.x, s.y), p.id).toBeGreaterThan(DRY);
      expect(g.sailable(s.x, s.y), p.id).toBe(false);
      expect(Math.hypot(s.x - p.x, s.y - p.y), p.id).toBeLessThanOrEqual(WALK_RANGE);
      const lay = layoutOf(plan, g);
      // The deck: every corner on land or over water too shoal to sail.
      if (plan.deck) for (const [x, y] of lay.walk[0]) expect(g.height(x, y) > DRY || !g.sailable(x, y), `${p.id} deck at ${x},${y}`).toBe(true);
      // The float lies at the water's edge: within a boat's length of the drawn shore.
      if (lay.dock) {
        let shore = false;
        for (let a = 0; a < 16 && !shore; a++) shore = g.height(lay.dock.x + Math.cos(a * 0.3927) * 62, lay.dock.y + Math.sin(a * 0.3927) * 62) > DRY;
        expect(shore, `${p.id} dock`).toBe(true);
      }
      if (p.kind === 'dock') expect(lay.dock, `${p.id} is a dock`).not.toBeNull();
    }
  });

  it('no two venues stand on top of each other', () => {
    const plans = places.map((p) => planVenue(p, g)!);
    for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) {
      expect(Math.hypot(plans[i].site.x - plans[j].site.x, plans[i].site.y - plans[j].site.y), `${plans[i].id} and ${plans[j].id}`).toBeGreaterThan(70);
    }
  });
});

describe("Sam's", () => {
  it('is the big deck of white umbrellas on the Tiburon waterfront, with a guest dock', () => {
    const places = JSON.parse(readFileSync(new URL('../../../courses/sf-bay/places.json', import.meta.url), 'utf8')) as VenuePlace[];
    const sams = places.find((p) => p.id === 'sams')!;
    expect(sams.ashore!.sign).toBe("Sam's");
    expect(sams.ashore!.umbrellas).toBe('white');
    expect(sams.ashore!.tables).toBeGreaterThanOrEqual(14);
    // Main Street, Tiburon: 37.873 N, 122.456 W, which is about here on the course.
    expect(Math.hypot(sams.ashore!.site![0] - -509, sams.ashore!.site![1] - 4770)).toBeLessThan(80);
  });
});
