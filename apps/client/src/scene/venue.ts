// What a place ashore consists of and where each part of it is: the building, the deck, the guest dock, the tables.
// Pure: no scene, no browser. `scene/shoreside.ts` draws from this, and anything that puts people ashore (walking a
// figure round the deck, sitting at a table, meeting another crew) reads the same plan through `layoutOf`.
import { DRY, hashOf, setBack, shoreKind, siteFor, type ShoreGround, type ShoreKind, type ShoreSite } from './shoreSite';

/** A place as this needs it: `courses/<water>/places.json`. */
export interface VenuePlace {
  id: string;
  name: string;
  x: number;
  y: number;
  kind?: string;
  ashore?: {
    name: string;
    kind?: string;
    /** Look for the plot near here rather than near the place itself: the venue's real position. */
    site?: [number, number];
    /** The words on its board. Defaults to the place's name. */
    sign?: string;
    /** Width along the shore and reach toward the water of its deck, metres. */
    deck?: [number, number];
    /** How many tables stand on the deck. */
    tables?: number;
    /** `white` for a deck of white sunshades. Otherwise they are coloured by the place's hash. */
    umbrellas?: string;
    /**
     * The place is part of a town (a water's `towns.json`, `scene/town.ts`): no venue of its own is built, and the
     * town's layout stands for it in `stage.shore`.
     */
    town?: string;
  };
}

export interface VenueGround extends ShoreGround {
  /** Charted depth of water, metres. 0 on land. */
  depth(x: number, y: number): number;
}

/** A rectangle in the venue's own axes: u along the shore (to the right, looking at the water), v toward the water. */
export interface Rect { u0: number; u1: number; v0: number; v1: number }

export interface VenuePlan {
  id: string;
  kind: ShoreKind;
  sign: string;
  site: ShoreSite;
  /** Which end the odd things go: the lookout, the flagstaff, the boats on the hard. */
  side: 1 | -1;
  /** The main building, centred on the plot. */
  house: { w: number; d: number; wall: number; roof: number };
  /** Height of the deck's floor above the plot's ground. */
  level: number;
  /** The deck people stand on. Null where there is no room for one. A park has a patch of ground instead, at level 0. */
  deck: Rect | null;
  /** The walkway from the deck out to the guest float: its line, and how high it is at each end above the plot's ground. */
  jetty: { u: number; v0: number; v1: number; z0: number; z1: number } | null;
  /** The guest float, on the water. */
  float: Rect | null;
  tables: Array<{ u: number; v: number; shade: boolean }>;
  /** A counter to stand at, lying along the shore. */
  bar: { u: number; v: number; w: number } | null;
  dance: Rect | null;
  fire: { u: number; v: number } | null;
  /** Places to lean on the rail and look at the water. */
  rail: Array<{ u: number; v: number }>;
  /** Who is there already: figures to draw so the place looks alive. `face` is radians from the u axis toward v. */
  people: Array<{ u: number; v: number; z: number; face: number; sit: boolean; slot: number }>;
  whiteShades: boolean;
}

/** One named spot on a venue, in course metres. `face` is the compass heading, radians, of someone using it. */
export interface VenueSpot {
  name: string;
  /** The last four are a town's (`scene/town.ts`): a bench to sit on, something to stand and look at, the head of a flight of steps, a shop door. */
  kind: 'door' | 'table' | 'seat' | 'bar' | 'rail' | 'dance' | 'fire' | 'dock' | 'bench' | 'sight' | 'steps' | 'shop';
  x: number;
  y: number;
  face: number;
}

/** A venue in course coordinates: what the next piece of work needs to let people go ashore and walk about. */
export interface VenueLayout {
  id: string;
  kind: ShoreKind;
  /** The words on its board. */
  name: string;
  /** Middle of the plot, and the compass heading, radians, from it toward the water. */
  x: number;
  y: number;
  heading: number;
  /** Height of the floor people stand on, metres above the still sea. */
  floor: number;
  /** Outlines of what can be walked on, each a ring of [x, y]: the deck first, then the walkway, then the guest float. */
  walk: Array<Array<[number, number]>>;
  /** The guest float: where a tender lands and the crew steps up. Null where the shore has no room for one. */
  dock: { x: number; y: number; z: number } | null;
  /** The nearest water off the dock where a yacht can lie afloat, and how much water there is on the chart. */
  berth: { x: number; y: number; depth: number } | null;
  spots: VenueSpot[];
}

const SEATS: Array<[number, number]> = [[0.95, 0], [-0.95, 0], [0, 0.95], [0, -0.95]];
/** A yacht wants this much on the chart to lie afloat at low water. */
const BERTH_DEPTH = 3.5;

/** Where a place's venue stands and everything on it. Null where there is no shore within reach of the place. */
export function planVenue(place: VenuePlace, g: VenueGround): VenuePlan | null {
  // A place in a town has the town for its venue.
  if (!place.ashore || place.ashore.town) return null;
  const from = place.ashore.site ?? [place.x, place.y];
  const edge = siteFor(from[0], from[1], g);
  if (!edge) return null;
  // At the water's edge the deck stands out over the shallows. Where a boat can float close in there is no room
  // for that, so the whole venue steps back up the shore until its deck fits, or as near to fitting as the ground allows.
  // The chart's shoreline can lie inside the drawn one. The house itself always stands where the chart has land too.
  let start = 0;
  for (let back = 0; back <= 90; back += 2) {
    const s = setBack(edge, back, g);
    if (!s) break;
    if (!g.sailable(s.x, s.y)) { start = back; break; }
  }
  const first = setBack(edge, start, g) ?? edge;
  let plan = planAt(place, first, g);
  let reach = plan.deck ? plan.deck.v1 - plan.deck.v0 : 0;
  for (let back = start + 2; back <= start + 26 && reach < plan.wantReach; back += 2) {
    const s = setBack(edge, back, g);
    if (!s || s.base > first.base + 5) break;
    const next = planAt(place, s, g);
    const r = next.deck ? next.deck.v1 - next.deck.v0 : 0;
    if (r > reach) { plan = next; reach = r; }
  }
  return plan;
}

function planAt(place: VenuePlace, s: ShoreSite, g: VenueGround): VenuePlan & { wantReach: number } {
  if (!place.ashore) throw new Error('a venue needs a place to go ashore at');
  const kind = shoreKind(place);
  const rnd = (slot: number) => hashOf(place.id, slot);
  const side: 1 | -1 = rnd(1) < 0.5 ? -1 : 1;
  const xy = (u: number, v: number) => ({ x: s.x + s.fy * u + s.fx * v, y: s.y - s.fx * u + s.fy * v });
  const dry = (u: number, v: number) => { const q = xy(u, v); return g.height(q.x, q.y) > DRY; };
  /** Somewhere a thing can stand without a boat being able to sail through it. */
  const free = (u: number, v: number) => { const q = xy(u, v); return g.height(q.x, q.y) > DRY || !g.sailable(q.x, q.y); };

  const house = kind === 'club' ? { w: 22 + rnd(2) * 8, d: 11, wall: 7.2, roof: 3.6 }
    : kind === 'bar' ? { w: 16 + rnd(2) * 6, d: 8, wall: 4.3, roof: 0 }
      : kind === 'hotel' ? { w: 30 + rnd(2) * 8, d: 12, wall: 10.6, roof: 4.2 }
        : kind === 'park' ? { w: 8.4, d: 6.2, wall: 2.7, roof: 1.8 }
          : { w: 10, d: 7.5, wall: 4.6, roof: 2.6 };
  const level = kind === 'park' ? 0 : 0.7;

  // The deck: as wide and as deep as asked, cut short where a boat could float under it.
  const want = place.ashore.deck ?? (kind === 'bar' ? [house.w + 10, 13] : kind === 'club' ? [house.w + 6, 10] : kind === 'hotel' ? [house.w, 9] : kind === 'park' ? [18, 12] : [14, 7]);
  const front = house.d / 2 + (kind === 'hotel' ? 4.2 : 0);
  let deck: Rect | null = null;
  {
    const w = want[0];
    let reach = 0;
    for (let t = 1; t <= want[1]; t += 1) {
      let ok = true;
      for (let k = 0; k <= 4 && ok; k++) {
        const u = -w / 2 + (w * k) / 4;
        ok = kind === 'park' ? dry(u, front + t) : free(u, front + t);
      }
      if (!ok) break;
      reach = t;
    }
    if (reach >= 4) deck = { u0: -w / 2, u1: w / 2, v0: front, v1: front + reach };
  }

  // The guest dock: a walkway from the deck out over the shallows, and a float across its end.
  let jetty: VenuePlan['jetty'] = null;
  let float: Rect | null = null;
  if (kind !== 'park') {
    const ju = -side * (deck ? (deck.u1 - deck.u0) * 0.28 : 3);
    const j0 = deck ? deck.v1 : front;
    let reach = 0;
    for (let t = 2; t <= 46; t += 2) {
      if (!free(ju, j0 + t) || !free(ju - 6, j0 + t) || !free(ju + 6, j0 + t)) break;
      reach = t;
    }
    // Only worth having if its end is over water.
    while (reach >= 6 && dry(ju, j0 + reach - 1.5)) reach -= 2;
    const z1 = 0.45 - s.base;
    if (reach >= 6 && !dry(ju, j0 + reach - 1.5)) {
      jetty = { u: ju, v0: j0, v1: j0 + reach - 3, z0: level, z1: s.base + level > 2.4 ? z1 + 0.25 : level };
      float = { u0: ju - 6, u1: ju + 6, v0: j0 + reach - 3, v1: j0 + reach };
    } else {
      // Deep water right up to the shore: the float lies along the water's edge, no further out than a boat's own
      // length from the beach, where the chart's hundred-metre squares cannot tell water from shore anyway.
      let edge = -1;
      for (let t = 0; t <= 60; t += 1) if (!dry(ju, j0 + t) && !dry(ju - 5, j0 + t) && !dry(ju + 5, j0 + t)) { edge = t; break; }
      if (edge >= 0) {
        jetty = { u: ju, v0: j0, v1: j0 + edge + 3, z0: level, z1: z1 + 0.25 };
        float = { u0: ju - 6, u1: ju + 6, v0: j0 + edge + 3, v1: j0 + edge + 6 };
      }
    }
  }

  const bar = !deck || kind === 'store' || kind === 'marina' || kind === 'park' ? null : { u: side * house.w * 0.2, v: deck.v0 + (kind === 'bar' ? 1.1 : 0.9), w: 5 };
  const dance = deck && kind === 'bar' && deck.u1 - deck.u0 >= 24 && deck.v1 - deck.v0 >= 11
    ? { u0: side > 0 ? deck.u1 - 6.4 : deck.u0 + 1.2, u1: side > 0 ? deck.u1 - 1.2 : deck.u0 + 6.4, v0: deck.v0 + 5.4, v1: deck.v0 + 10.6 } : null;
  let fire: VenuePlan['fire'] = null;
  if (deck && (kind === 'club' || kind === 'hotel' || kind === 'park')) {
    fire = kind === 'park' ? { u: -side * 5.5, v: Math.min(deck.v1 - 2.5, deck.v0 + 6) } : { u: -side * ((deck.u1 - deck.u0) / 2 - 3), v: deck.v1 - 3 };
  }

  // Tables on a grid, clear of the awning, the counter, the dance floor, the fire and the way to the dock.
  const tables: VenuePlan['tables'] = [];
  const whiteShades = place.ashore.umbrellas === 'white';
  if (deck && kind !== 'park') {
    const spots: Array<{ u: number; v: number; order: number }> = [];
    const vFirst = deck.v0 + (kind === 'bar' ? 6 : bar ? 3.6 : 2.2);
    const nu = Math.max(1, Math.floor((deck.u1 - deck.u0 - 4.4) / 3.7) + 1);
    const gap = nu > 1 ? (deck.u1 - deck.u0 - 4.4) / (nu - 1) : 0;
    let n = 0;
    for (let v = vFirst; v <= deck.v1 - 2.1; v += 3.7) {
      for (let i = 0; i < nu; i++) {
        const u = deck.u0 + 2.2 + i * gap;
        n++;
        if (dance && u > dance.u0 - 1.6 && u < dance.u1 + 1.6 && v > dance.v0 - 1.6 && v < dance.v1 + 1.6) continue;
        if (fire && Math.hypot(u - fire.u, v - fire.v) < 3.4) continue;
        if (jetty && Math.abs(u - jetty.u) < 2.1 && v > deck.v1 - 4.5) continue;
        spots.push({ u, v, order: rnd(200 + n) });
      }
    }
    const count = place.ashore.tables ?? (kind === 'bar' ? 8 : kind === 'hotel' ? 6 : kind === 'club' ? 5 : 2);
    spots.sort((a, b) => a.order - b.order);
    for (const t of spots.slice(0, count)) tables.push({ u: t.u, v: t.v, shade: whiteShades || rnd(300 + tables.length) < 0.75 });
  }

  const rail: VenuePlan['rail'] = [];
  if (deck && kind !== 'park') {
    for (let u = deck.u0 + 1.5; u <= deck.u1 - 1.5; u += 3) {
      if (jetty && Math.abs(u - jetty.u) < 1.9) continue;
      rail.push({ u, v: deck.v1 - 0.45 });
    }
  }

  // A few people, so it is seen to be open: some at the tables, some at the rail, a couple at the bar or round the fire.
  const people: VenuePlan['people'] = [];
  let slot = 0;
  tables.forEach((t, i) => {
    SEATS.forEach(([du, dv], k) => {
      if (rnd(400 + i * 4 + k) < 0.4) people.push({ u: t.u + du, v: t.v + dv, z: level, face: Math.atan2(-dv, -du), sit: true, slot: slot++ });
    });
  });
  rail.forEach((r, i) => {
    if (rnd(500 + i) < 0.24) people.push({ u: r.u, v: r.v - 0.1, z: level, face: Math.PI / 2, sit: false, slot: slot++ });
  });
  if (bar) for (const du of [-1.2, 0.9]) people.push({ u: bar.u + du, v: bar.v + 0.9, z: level, face: -Math.PI / 2, sit: false, slot: slot++ });
  if (dance) for (let k = 0; k < 3; k++) people.push({ u: dance.u0 + 1.2 + rnd(600 + k) * 2.8, v: dance.v0 + 1.2 + rnd(610 + k) * 2.8, z: level, face: rnd(620 + k) * 6.28, sit: false, slot: slot++ });
  if (fire) for (let k = 0; k < 3; k++) {
    const a = 0.6 + k * 1.9 + rnd(630 + k);
    people.push({ u: fire.u + Math.cos(a) * 1.7, v: fire.v + Math.sin(a) * 1.7, z: level, face: a + Math.PI, sit: kind === 'park', slot: slot++ });
  }

  return { id: place.id, kind, sign: place.ashore.sign ?? place.name, site: s, side, house, level, deck, jetty, float, tables, bar, dance, fire, rail, people, whiteShades, wantReach: want[1] };
}

/** The plan in course coordinates, with the nearest water a yacht can lie in off its dock. */
export function layoutOf(p: VenuePlan, g: VenueGround): VenueLayout {
  const s = p.site;
  const xy = (u: number, v: number): [number, number] => [round(s.x + s.fy * u + s.fx * v), round(s.y - s.fx * u + s.fy * v)];
  const heading = Math.atan2(s.fx, s.fy);
  /** Compass heading of a direction given in the venue's own axes. */
  const face = (a: number) => {
    const du = Math.cos(a);
    const dv = Math.sin(a);
    return round(Math.atan2(s.fy * du + s.fx * dv, -s.fx * du + s.fy * dv), 1000);
  };
  const ring = (r: Rect): Array<[number, number]> => [xy(r.u0, r.v0), xy(r.u1, r.v0), xy(r.u1, r.v1), xy(r.u0, r.v1)];
  const walk: VenueLayout['walk'] = [];
  if (p.deck) walk.push(ring(p.deck));
  if (p.jetty) walk.push(ring({ u0: p.jetty.u - 1.3, u1: p.jetty.u + 1.3, v0: p.jetty.v0, v1: p.jetty.v1 }));
  if (p.float) walk.push(ring(p.float));

  const spots: VenueSpot[] = [];
  const add = (name: string, kind: VenueSpot['kind'], u: number, v: number, a: number) => {
    const [x, y] = xy(u, v);
    spots.push({ name, kind, x, y, face: face(a) });
  };
  if (p.deck) add('door', 'door', 0, p.deck.v0 + 0.6, Math.PI / 2);
  p.tables.forEach((t, i) => {
    add(`table-${i + 1}`, 'table', t.u, t.v, Math.PI / 2);
    SEATS.forEach(([du, dv], k) => add(`table-${i + 1}-seat-${k + 1}`, 'seat', t.u + du, t.v + dv, Math.atan2(-dv, -du)));
  });
  if (p.bar) for (let k = 0; k < 4; k++) add(`bar-${k + 1}`, 'bar', p.bar.u - p.bar.w / 2 + 0.7 + k * ((p.bar.w - 1.4) / 3), p.bar.v + 0.9, -Math.PI / 2);
  p.rail.forEach((r, i) => add(`rail-${i + 1}`, 'rail', r.u, r.v, Math.PI / 2));
  if (p.dance) add('dance', 'dance', (p.dance.u0 + p.dance.u1) / 2, (p.dance.v0 + p.dance.v1) / 2, Math.PI / 2);
  if (p.fire) add('fire', 'fire', p.fire.u, p.fire.v, Math.PI / 2);

  let dock: VenueLayout['dock'] = null;
  let berth: VenueLayout['berth'] = null;
  if (p.float) {
    const u = (p.float.u0 + p.float.u1) / 2;
    const v = (p.float.v0 + p.float.v1) / 2;
    const [x, y] = xy(u, v);
    dock = { x, y, z: 0.45 };
    add('dock', 'dock', u, v, Math.PI / 2);
    // Straight out from the float until the chart shows enough water for a keel.
    for (let t = 0; t <= 400; t += 5) {
      const [bx, by] = xy(u, p.float.v1 + t);
      const d = g.depth(bx, by);
      if (d >= BERTH_DEPTH) { berth = { x: bx, y: by, depth: round(d) }; break; }
    }
  }
  return { id: p.id, kind: p.kind, name: p.sign, x: round(s.x), y: round(s.y), heading: round(heading, 1000), floor: round(s.base + p.level), walk, dock, berth, spots };
}

const round = (n: number, k = 10): number => Math.round(n * k) / k;
