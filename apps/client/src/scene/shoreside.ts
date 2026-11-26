import * as THREE from 'three';
import { Massing, WIN, cityNight, onCityNight } from './massing';
import { chartSailable, hashOf, DRY, type DepthGrid, type ShoreKind } from './shoreSite';
import { layoutOf, planVenue, type Rect, type VenueGround, type VenueLayout, type VenuePlace } from './venue';
import { addYacht } from './yacht';

/** Where a place's venue ended up, for the label that hangs over it and for whatever puts people ashore there. */
export interface ShoreSpot {
  id: string;
  kind: ShoreKind;
  /** Middle of the plot, course metres, and the height of the head of its flagstaff above the sea. */
  x: number;
  y: number;
  top: number;
  /**
   * The deck, the dock and the named spots on them, in course metres. See `scene/venue.ts`.
   * For a place in a town (a water's `towns.json`) this is the whole town, a `TownLayout` (`scene/town.ts`): the same
   * fields, with `town: true`, a height for each ring of `walk` in `heights`, and the named paths in `paths`.
   */
  layout: VenueLayout;
}

export interface Shoreside {
  group: THREE.Group;
  spots: ShoreSpot[];
  triangles: number;
}

type P3 = [number, number, number];
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const WHITE = C(0.93, 0.92, 0.88);
const WOOD = C(0.5, 0.41, 0.3);
const PLANK = C(0.58, 0.49, 0.37);
const PILE = C(0.27, 0.23, 0.19);
const FLOAT = C(0.62, 0.6, 0.55);
const WARM = C(1, 0.74, 0.42);
const ROOFS = [C(0.15, 0.2, 0.34), C(0.52, 0.18, 0.14), C(0.14, 0.31, 0.24), C(0.29, 0.31, 0.35), C(0.56, 0.3, 0.16)];
const WALLS = [C(0.2, 0.52, 0.55), C(0.86, 0.66, 0.2), C(0.86, 0.42, 0.34), C(0.9, 0.89, 0.84), C(0.42, 0.62, 0.8), C(0.62, 0.22, 0.18)];
const BRIGHT = [C(0.88, 0.14, 0.12), C(0.96, 0.52, 0.08), C(0.97, 0.78, 0.1), C(0.1, 0.5, 0.82), C(0.1, 0.62, 0.42), C(0.82, 0.2, 0.5)];
const NEON = [C(1, 0.3, 0.55), C(0.3, 0.9, 1), C(1, 0.66, 0.18), C(0.5, 1, 0.5)];
const HULLS = [C(0.93, 0.93, 0.9), C(0.93, 0.93, 0.9), C(0.14, 0.22, 0.36), C(0.6, 0.12, 0.1), C(0.1, 0.36, 0.3), C(0.9, 0.88, 0.8)];
const COVERS = [C(0.16, 0.26, 0.42), C(0.9, 0.9, 0.86), C(0.55, 0.14, 0.12), C(0.13, 0.33, 0.25), C(0.66, 0.55, 0.38)];
const SHIRTS = [C(0.85, 0.2, 0.18), C(0.95, 0.95, 0.92), C(0.15, 0.35, 0.7), C(0.95, 0.75, 0.15), C(0.2, 0.55, 0.4), C(0.9, 0.5, 0.6), C(0.25, 0.25, 0.3), C(0.5, 0.75, 0.9)];
const LEGS = [C(0.16, 0.2, 0.3), C(0.7, 0.66, 0.55), C(0.9, 0.9, 0.86), C(0.25, 0.25, 0.25)];
const SKIN = [C(0.86, 0.66, 0.52), C(0.62, 0.44, 0.32), C(0.94, 0.78, 0.66), C(0.42, 0.29, 0.21)];
/** Burgees: a field and a stripe. None is any real club's. */
const BURGEES: Array<[THREE.Color, THREE.Color]> = [[C(0.85, 0.1, 0.1), C(1, 1, 1)], [C(0.08, 0.2, 0.6), C(1, 0.82, 0.1)], [C(1, 1, 1), C(0.08, 0.2, 0.6)], [C(0.05, 0.42, 0.3), C(1, 1, 1)], [C(1, 0.8, 0.08), C(0.08, 0.1, 0.3)]];

/** What a flag or a light looks like when it is too far off to draw as a thing: see `beacons`. */
export const SHAPE = { burgee: 0, flag: 1, glow: 2 } as const;
export interface Light { p: P3; a: THREE.Color; b: THREE.Color; shape: number; size: number; min: number }
interface Board { text: string; at: P3; w: number; h: number; ux: number; uy: number }

/**
 * What stands on the shore at each place there is to go ashore: a yacht club with its flagstaff and burgee, a bar with
 * a striped awning and a deck of sunshades, a marina's floats, a hotel, a dock store, a picnic shelter and a fire.
 * Each stands on the low shore nearest its place and faces the water. What it is comes from the place's own data
 * (`ashore.kind`, and optionally its sign, the size of its deck and the number of tables), and its colours and the
 * rest from a hash of its id, so no two are alike and every player sees the same. `scene/venue.ts` decides where
 * everything is; this draws it, at the scale of the people who will stand on it.
 *
 * All of it is one mesh in the city's material, so the windows light after dark. With it go one set of points for
 * the flags and the lights, which never draw smaller than a few pixels (that is what shows from two miles off), and
 * one sheet of lettering for the boards. Decks, walkways and floats only reach out over water the chart says no boat
 * can float in.
 * @param cover the water's ground cover, as in `about.json`: `evergreen` stands firs behind each building
 */
export function buildShoreside(depth: DepthGrid, depths: ArrayLike<number>, height: (x: number, y: number) => number, chartDepth: (x: number, y: number) => number, places: readonly VenuePlace[], cover = 'sf-bay'): Shoreside {
  const ground: VenueGround = { height, sailable: chartSailable(depth, depths), depth: chartDepth };
  const m = new Massing();
  const spots: ShoreSpot[] = [];
  const lights: Light[] = [];
  const boards: Board[] = [];

  for (const place of places) {
    const plan = planVenue(place, ground);
    if (!plan) continue;
    const { site: s, kind, side, house, level, deck } = plan;
    m.next();
    const rnd = (slot: number) => hashOf(place.id, slot);
    const pick = <T>(list: readonly T[], slot: number): T => list[Math.floor(rnd(slot) * list.length) % list.length];
    // Local axes: u along the shore (to the right, looking at the water), v toward the water.
    const rx = s.fy;
    const ry = -s.fx;
    const turn = Math.atan2(ry, rx);
    const base = s.base;
    const P = (u: number, v: number, z: number): P3 => [s.x + rx * u + s.fx * v, s.y + ry * u + s.fy * v, base + z];
    const xy = (u: number, v: number) => ({ x: s.x + rx * u + s.fx * v, y: s.y + ry * u + s.fy * v });
    const dryAt = (u: number, v: number) => { const q = xy(u, v); return height(q.x, q.y) > DRY; };
    const free = (u: number, v: number) => { const q = xy(u, v); return height(q.x, q.y) > DRY || !ground.sailable(q.x, q.y); };
    const box = (u: number, v: number, z: number, w: number, d: number, h: number, color: THREE.Color, win: number = WIN.none, roof?: THREE.Color, top = 1) => {
      const q = xy(u, v);
      m.solid({ x: q.x, y: q.y, base: base + z, w, d, h, turn, color, win, roof, top });
    };
    const post = (u: number, v: number, z0: number, z1: number, th: number, color: THREE.Color, win: number = WIN.none) => m.beam(P(u, v, z0), P(u, v, z1), th, th, color, win);
    /** How far below the plot the ground or the sea bed lies at a point, for legs to reach down to. */
    const drop = (u: number, v: number) => { const q = xy(u, v); return Math.min(0, Math.max(-base - 1.5, height(q.x, q.y) - base)) - 0.5; };
    /** Height of the still sea, in this plot's own heights. */
    const sea = -base;

    /** A floor on legs, with a rail on the sides that are not against the house. */
    const floor = (r: Rect, z: number, railed: boolean, gapU: number | null) => {
      const w = r.u1 - r.u0;
      const d = r.v1 - r.v0;
      box((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2, z - 0.35, w, d, 0.35, WOOD, WIN.none, PLANK);
      const nu = Math.max(2, Math.round(w / 5));
      const nv = Math.max(1, Math.round(d / 5));
      for (let i = 0; i <= nu; i++) for (let j = 1; j <= nv; j++) {
        const u = r.u0 + 0.4 + ((w - 0.8) * i) / nu;
        const v = r.v0 + ((d - 0.4) * j) / nv;
        if (drop(u, v) < -0.9) post(u, v, drop(u, v), z - 0.35, 0.36, PILE);
      }
      if (!railed) return;
      // The rail is at the height of a hand: a metre.
      const run = (u0: number, v0: number, u1: number, v1: number) => {
        m.beam(P(u0, v0, z + 1), P(u1, v1, z + 1), 0.09, 0.09, WHITE);
        const n = Math.max(1, Math.round(Math.hypot(u1 - u0, v1 - v0) / 2.4));
        for (let i = 0; i <= n; i++) post(u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * i) / n, z, z + 1, 0.08, WHITE);
      };
      run(r.u0 + 0.1, r.v0, r.u0 + 0.1, r.v1 - 0.1);
      run(r.u1 - 0.1, r.v0, r.u1 - 0.1, r.v1 - 0.1);
      if (gapU === null) run(r.u0 + 0.1, r.v1 - 0.1, r.u1 - 0.1, r.v1 - 0.1);
      else {
        run(r.u0 + 0.1, r.v1 - 0.1, gapU - 1.3, r.v1 - 0.1);
        run(gapU + 1.3, r.v1 - 0.1, r.u1 - 0.1, r.v1 - 0.1);
      }
    };
    /** Lamps on a wire between posts, round the outside of a deck. */
    const stringLights = (r: Rect, z: number) => {
      const corners: Array<[number, number]> = [[r.u0 + 0.2, r.v0 + 0.3], [r.u0 + 0.2, r.v1 - 0.2], [r.u1 - 0.2, r.v1 - 0.2], [r.u1 - 0.2, r.v0 + 0.3]];
      for (const [u, v] of corners) post(u, v, z, z + 3.4, 0.14, PILE);
      for (let k = 0; k < 3; k++) {
        const [u0, a0] = corners[k];
        const [u1, a1] = corners[k + 1];
        const n = Math.max(2, Math.round(Math.hypot(u1 - u0, a1 - a0) / 1.8));
        for (let i = 1; i < n; i++) {
          const t = i / n;
          const q = xy(u0 + (u1 - u0) * t, a0 + (a1 - a0) * t);
          m.solid({ x: q.x, y: q.y, base: base + z + 3.2 - 0.45 * Math.sin(t * Math.PI), w: 0.26, h: 0.26, turn, color: WARM, win: WIN.lamp });
        }
      }
    };
    /** A table for four at sitting height, its chairs, and perhaps a sunshade over it. */
    const table = (u: number, v: number, z: number, shade: THREE.Color | null) => {
      post(u, v, z, z + 0.72, 0.1, PILE);
      box(u, v, z + 0.7, 0.95, 0.95, 0.05, WHITE);
      for (const [du, dv] of [[0.95, 0], [-0.95, 0], [0, 0.95], [0, -0.95]]) {
        box(u + du, v + dv, z, 0.42, 0.42, 0.45, WOOD);
        box(u + du * 1.2, v + dv * 1.2, z + 0.45, du ? 0.06 : 0.42, du ? 0.42 : 0.06, 0.42, WOOD);
      }
      if (!shade) return;
      post(u, v, z + 0.72, z + 2.55, 0.06, PILE);
      const q = xy(u, v);
      m.lathe(q.x, q.y, base + z + 2.15, [[1.55, 0], [0.08, 0.6]], 8, shade);
    };
    /** Somebody: legs, a shirt and a head, 1.7 m tall standing. */
    const person = (u: number, v: number, z: number, sit: boolean, slot: number) => {
      const shirt = pick(SHIRTS, 700 + slot);
      const tall = 0.94 + rnd(800 + slot) * 0.1;
      const hip = sit ? 0.47 : 0.86 * tall;
      if (!sit) box(u, v, z, 0.3, 0.2, hip, pick(LEGS, 720 + slot));
      else box(u, v, z + 0.3, 0.34, 0.34, 0.2, pick(LEGS, 720 + slot));
      box(u, v, z + hip, 0.4, 0.24, 0.6 * tall, shirt);
      box(u, v, z + hip + 0.62 * tall, 0.2, 0.2, 0.23, pick(SKIN, 740 + slot));
    };
    /** A staff with a flag at its head. A club's has a yard and a gaff, as a yacht club's does. */
    const flagstaff = (u: number, v: number, z: number, h: number, shape: number, a: THREE.Color, b: THREE.Color, rigged = false) => {
      post(u, v, z + drop(u, v) + 0.5, z + h, rigged ? 0.34 : 0.24, WHITE);
      if (rigged) {
        m.beam(P(u - 3, v, z + h * 0.66), P(u + 3, v, z + h * 0.66), 0.18, 0.18, WHITE);
        m.beam(P(u, v, z + h * 0.7), P(u + side * 2.8, v, z + h * 0.86), 0.16, 0.16, WHITE);
      }
      lights.push({ p: P(u, v, z + h - 1.2), a, b, shape, size: rigged ? 4.6 : 3.4, min: rigged ? 17 : 14 });
      return base + z + h;
    };
    /** Boats ashore in their cradles beside the building, where the ground is dry. */
    const yard = (u0: number, v: number, count: number, slot: number) => {
      for (let i = 0; i < count; i++) {
        const u = u0 + side * i * 4.4;
        if (!dryAt(u, v - 3) || !dryAt(u, v + 4)) continue;
        const q = xy(u, v);
        const len = 6.5 + rnd(slot + i) * 2.5;
        for (const dv of [-1.6, 1.6]) box(u, v + dv, 0, 1.6, 0.25, 0.95, PILE);
        addYacht(m, q.x, q.y, base + 0.95, len, turn + Math.PI / 2, pick(HULLS, slot + i), pick(COVERS, slot + 20 + i));
      }
    };
    const board = (text: string, u: number, v: number, z: number, w: number, h: number, color: THREE.Color) => {
      box(u, v, z, w, 0.3, h, color, WIN.lamp);
      boards.push({ text, at: P(u, v + 0.17, z + h / 2), w, h, ux: rx, uy: ry });
    };

    // ---- the building itself ----------------------------------------------------------------------
    const q0 = xy(0, 0);
    let top = base + 8;
    let glowColor = WARM;
    const roof = pick(ROOFS, 3);
    const flagV = deck ? Math.max(deck.v0 + 1.5, deck.v1 - 1.2) : house.d / 2 + 2;
    if (kind === 'club') {
      m.hall(q0.x, q0.y, base - 1, house.w, house.d, house.wall + 1, house.roof, turn, WHITE, roof, WIN.homes);
      // The race officer's lookout, at one end.
      const lu = side * (house.w / 2 - 3.6);
      box(lu, -1, house.wall, 5.6, 5.6, 5.2, WHITE, WIN.homes);
      box(lu, -1, house.wall + 5.2, 6.6, 6.6, 3, roof, WIN.none, roof, 0.05);
      board(plan.sign, 0, house.d / 2 + 0.2, 4.4, Math.min(house.w - 4, 12), 1.5, C(0.95, 0.9, 0.72));
      const burgee = pick(BURGEES, 4);
      top = flagstaff(-side * ((deck ? deck.u1 : house.w / 2) - 1), flagV, level, 19, SHAPE.burgee, burgee[0], burgee[1], true);
      yard(side * (house.w / 2 + 6), -1, 4 + Math.floor(rnd(5) * 3), 30);
    } else if (kind === 'bar') {
      const wall = pick(WALLS, 3);
      const awning = plan.whiteShades ? C(0.1, 0.3, 0.6) : pick(BRIGHT, 4);
      box(0, 0, -1, house.w, house.d, house.wall + 1, wall, WIN.homes, wall.clone().multiplyScalar(0.55));
      // The awning: stripes of colour and white, sloping out over the first of the deck.
      const n = Math.round(house.w / 1.4);
      const v0 = house.d / 2;
      for (let i = 0; i < n; i++) {
        const u0 = -house.w / 2 + (house.w * i) / n;
        const u1 = -house.w / 2 + (house.w * (i + 1)) / n;
        const colour = i % 2 ? WHITE : awning;
        const a = P(u0, v0, 3.5);
        const b = P(u1, v0, 3.5);
        const c = P(u1, v0 + 4.4, 2.6);
        const e = P(u0, v0 + 4.4, 2.6);
        m.quad(a, b, c, e, colour, P((u0 + u1) / 2, v0 + 2, 0));
        m.quad(a, b, c, e, colour.clone().multiplyScalar(0.7), P((u0 + u1) / 2, v0 + 2, 9));
        m.quad(e, c, P(u1, v0 + 4.4, 2.25), P(u0, v0 + 4.4, 2.25), colour, P((u0 + u1) / 2, v0, 2.4));
      }
      for (let i = 0; i <= 3; i++) post(-house.w / 2 + 0.2 + ((house.w - 0.4) * i) / 3, v0 + 4.3, level, 2.6, 0.12, WHITE);
      const neon = pick(NEON, 5);
      // The sign stands on the roof, where it shows over the awning.
      for (const u of [-house.w * 0.24, house.w * 0.24]) post(u, v0 - 0.8, house.wall, house.wall + 0.9, 0.2, PILE);
      board(plan.sign, 0, v0 - 0.8, house.wall + 0.8, house.w * 0.7, 2, plan.whiteShades ? C(0.97, 0.95, 0.88) : neon);
      top = flagstaff(side * ((deck ? deck.u1 : house.w / 2) - 0.8), flagV, level, 12, SHAPE.flag, awning, WHITE);
      glowColor = neon.clone().lerp(WARM, 0.6);
    } else if (kind === 'hotel') {
      m.hall(q0.x, q0.y, base - 1, house.w, house.d, house.wall + 1, house.roof, turn, WHITE, roof, WIN.homes);
      // A veranda the length of the front, under its own lean-to roof.
      const w = house.w;
      const v0 = house.d / 2;
      const n = Math.round(w / 4.5);
      box(0, v0 + 2.1, level - 0.35, w, 4.2, 0.35, WOOD, WIN.none, PLANK);
      for (let i = 0; i <= n; i++) post(-w / 2 + (w * i) / n, v0 + 3.9, level, 3.6, 0.2, WHITE);
      m.quad(P(-w / 2 - 0.5, v0, 4.6), P(w / 2 + 0.5, v0, 4.6), P(w / 2 + 0.5, v0 + 4.3, 3.6), P(-w / 2 - 0.5, v0 + 4.3, 3.6), roof, P(0, v0 + 2, 0));
      m.quad(P(-w / 2 - 0.5, v0, 4.6), P(w / 2 + 0.5, v0, 4.6), P(w / 2 + 0.5, v0 + 4.3, 3.6), P(-w / 2 - 0.5, v0 + 4.3, 3.6), roof.clone().multiplyScalar(0.6), P(0, v0 + 2, 9));
      for (let i = 0; i < n; i++) box(-w / 2 + (w * (i + 0.5)) / n, v0 + 4, 3.1, 0.3, 0.3, 0.3, WARM, WIN.lamp);
      board(plan.sign, 0, v0 + 0.2, 6.2, Math.min(w - 6, 12), 1.5, C(0.95, 0.9, 0.72));
      top = flagstaff(-side * (w / 2 + 3), v0 + 5, 0, 17, SHAPE.flag, pick(BRIGHT, 4), WHITE, true);
    } else if (kind === 'park') {
      // A picnic shelter, a board with the park's name, a rack of kayaks. The fire is laid further down.
      const brown = C(0.36, 0.27, 0.19);
      for (const u of [-3.2, 3.2]) for (const v of [-2.2, 2.2]) post(u, v, -1, house.wall, 0.3, C(0.42, 0.31, 0.22));
      m.gable(q0.x, q0.y, base + house.wall, house.w, house.d, house.roof, turn, C(0.33, 0.24, 0.17));
      // A picnic table under it: a top and two benches.
      box(0, 0, 0.68, 1.9, 0.8, 0.06, WOOD);
      for (const dv of [-0.75, 0.75]) box(0, dv, 0.4, 1.9, 0.28, 0.05, WOOD);
      for (const du of [-0.7, 0.7]) box(du, 0, 0, 0.1, 1.5, 0.68, PILE);
      for (const u of [-1.6, 1.6]) post(side * 7 + u, 3, -0.5, 2.3, 0.2, brown);
      board(plan.sign, side * 7, 3, 1.1, 4.2, 1.2, C(0.93, 0.86, 0.62));
      for (let i = 0; i < 2; i++) box(side * 6.5, -4 - i * 1.5, 0.5 + i * 0.12, 4.4, 0.7, 0.4, pick(BRIGHT, 10 + i), WIN.none, undefined, 0.6);
      top = flagstaff(side * 4.4, 5, 0, 9, SHAPE.flag, C(0.12, 0.45, 0.25), C(0.95, 0.85, 0.4));
      glowColor = C(1, 0.55, 0.2);
    } else {
      // A dock store, or a marina's office: a small hall with a porch and a board over it.
      const wall = kind === 'marina' ? C(0.84, 0.86, 0.86) : rnd(2) < 0.5 ? C(0.56, 0.17, 0.13) : C(0.5, 0.5, 0.47);
      const slate = kind === 'marina' ? roof : C(0.3, 0.31, 0.33);
      m.hall(q0.x, q0.y, base - 1, house.w, house.d, house.wall + 1, house.roof, turn, wall, slate, WIN.homes);
      const v0 = house.d / 2;
      for (const u of [-4.6, 0, 4.6]) post(u, v0 + 2.6, level, 3.1, 0.16, WHITE);
      m.quad(P(-5.4, v0, 3.7), P(5.4, v0, 3.7), P(5.4, v0 + 3, 3.1), P(-5.4, v0 + 3, 3.1), slate, P(0, v0 + 1, 0));
      m.quad(P(-5.4, v0, 3.7), P(5.4, v0, 3.7), P(5.4, v0 + 3, 3.1), P(-5.4, v0 + 3, 3.1), slate.clone().multiplyScalar(0.6), P(0, v0 + 1, 9));
      board(plan.sign, 0, v0 + 0.2, 3.9, 7.4, 1.2, C(1, 0.93, 0.7));
      top = flagstaff(side * 6.6, flagV, level, 12, SHAPE.flag, kind === 'marina' ? C(0.1, 0.3, 0.7) : pick(BRIGHT, 4), WHITE);
      if (kind === 'marina') yard(side * 11, -1, 5, 30);
    }

    // ---- the deck and what is on it ---------------------------------------------------------------
    if (deck && kind !== 'park') {
      floor(deck, level, true, plan.jetty ? plan.jetty.u : null);
      stringLights(deck, level);
      const shadeA = plan.whiteShades ? WHITE : pick(BRIGHT, 20);
      const shadeB = plan.whiteShades || rnd(21) < 0.5 ? WHITE : pick(BRIGHT, 22);
      plan.tables.forEach((t, i) => table(t.u, t.v, level, t.shade ? (i % 2 ? shadeB : shadeA) : null));
      if (plan.bar) {
        // A counter at leaning height with a row of stools.
        box(plan.bar.u, plan.bar.v, level, plan.bar.w, 0.6, 1.08, C(0.34, 0.22, 0.15), WIN.none, C(0.7, 0.55, 0.35));
        for (let k = 0; k < 4; k++) post(plan.bar.u - plan.bar.w / 2 + 0.7 + k * ((plan.bar.w - 1.4) / 3), plan.bar.v + 0.75, level, level + 0.72, 0.3, PILE);
      }
      if (plan.dance) {
        const r = plan.dance;
        // A dance floor: boards laid the other way, in squares of two colours, with coloured lamps over it.
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          box(r.u0 + (i + 0.5) * ((r.u1 - r.u0) / 4), r.v0 + (j + 0.5) * ((r.v1 - r.v0) / 4), level, (r.u1 - r.u0) / 4, (r.v1 - r.v0) / 4, 0.03, (i + j) % 2 ? C(0.2, 0.2, 0.22) : C(0.85, 0.83, 0.78));
        }
        for (let k = 0; k < 4; k++) box(k % 2 ? r.u0 : r.u1, k < 2 ? r.v0 : r.v1, level + 3, 0.3, 0.3, 0.3, pick(NEON, 50 + k), WIN.lamp);
      }
    }
    if (plan.fire) {
      const f = plan.fire;
      const z = level;
      // A fire: a ring of stones on a hearth, the logs, and the flame, which glows after dark.
      if (kind !== 'park') box(f.u, f.v, z, 1.5, 1.5, 0.35, C(0.4, 0.4, 0.4));
      const fz = kind === 'park' ? 0.1 : z + 0.35;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI;
        m.beam(P(f.u - Math.cos(a) * 0.5, f.v - Math.sin(a) * 0.5, fz + 0.08), P(f.u + Math.cos(a) * 0.5, f.v + Math.sin(a) * 0.5, fz + 0.2), 0.16, 0.16, C(0.3, 0.22, 0.16));
      }
      const q = xy(f.u, f.v);
      m.solid({ x: q.x, y: q.y, base: base + fz + 0.15, w: 0.5, h: 0.75, turn, color: C(1, 0.5, 0.12), win: WIN.lamp, top: 0.1 });
      if (kind === 'park') {
        // Driftwood logs to sit on.
        for (let k = 0; k < 3; k++) {
          const a = 0.6 + k * 1.9;
          m.beam(P(f.u + Math.cos(a) * 2.2 - Math.sin(a), f.v + Math.sin(a) * 2.2 + Math.cos(a), 0.25), P(f.u + Math.cos(a) * 2.2 + Math.sin(a), f.v + Math.sin(a) * 2.2 - Math.cos(a), 0.25), 0.4, 0.4, C(0.6, 0.56, 0.5));
        }
      }
      lights.push({ p: P(f.u, f.v, fz + 0.8), a: C(1, 0.55, 0.2), b: WARM, shape: SHAPE.glow, size: 7, min: 3.5 });
    }
    for (const who of plan.people) person(who.u, who.v, who.z, who.sit, who.slot);

    // ---- the guest dock ---------------------------------------------------------------------------
    if (plan.jetty && plan.float) {
      const j = plan.jetty;
      const fl = plan.float;
      m.beam(P(j.u, j.v0, j.z0 - 0.15), P(j.u, j.v1 + 0.4, j.z1 - 0.15), 2.4, 0.3, PLANK);
      for (const du of [-1.15, 1.15]) m.beam(P(j.u + du, j.v0, j.z0 + 1), P(j.u + du, j.v1, j.z1 + 1), 0.08, 0.08, WHITE);
      for (let t = 0; t <= j.v1 - j.v0; t += 3) {
        const k = t / Math.max(1, j.v1 - j.v0);
        const z = j.z0 + (j.z1 - j.z0) * k;
        for (const du of [-1.15, 1.15]) post(j.u + du, j.v0 + t, z - 0.2, z + 1, 0.08, WHITE);
        if (j.z1 === j.z0 && t > 0) for (const du of [-1, 1]) post(j.u + du, j.v0 + t, drop(j.u + du, j.v0 + t), z - 0.2, 0.3, PILE);
      }
      // The float, low on the water, held by two piles, with cleats and a lamp to find it by.
      const fu = (fl.u0 + fl.u1) / 2;
      const fv = (fl.v0 + fl.v1) / 2;
      box(fu, fv, sea - 0.1, fl.u1 - fl.u0, fl.v1 - fl.v0, 0.55, FLOAT, WIN.none, PLANK);
      for (const u of [fl.u0 + 0.5, fl.u1 - 0.5]) post(u, fl.v0 + 0.4, sea - 1.5, sea + 2.4, 0.34, PILE);
      for (let u = fl.u0 + 1.5; u < fl.u1 - 1; u += 3) box(u, fl.v1 - 0.3, sea + 0.45, 0.3, 0.1, 0.1, PILE);
      post(fl.u1 - 0.5, fl.v1 - 0.5, sea + 0.45, sea + 3.2, 0.1, PILE);
      box(fl.u1 - 0.5, fl.v1 - 0.5, sea + 3.2, 0.34, 0.34, 0.34, WARM, WIN.lamp);
      // A tender or two tied up inside the float, where no yacht could come.
      for (let i = 0; i < 2; i++) {
        const bu = fu + (i ? 3.4 : -3.6);
        const bv = fl.v0 - 1.1;
        if (rnd(60 + i) < 0.75 && !dryAt(bu, bv) && free(bu, bv) && Math.abs(bu - j.u) > 2.2) {
          const q = xy(bu, bv);
          m.solid({ x: q.x, y: q.y, base: -0.15, w: 3.2, d: 1.4, h: 0.55, turn, color: pick(HULLS, 62 + i), top: 0.8, roof: C(0.3, 0.3, 0.3) });
        }
      }
      // A marina has berths: fingers off a spine of floats back along the walkway, a yacht in most of them.
      if (kind === 'marina' || kind === 'club') {
        let n = 0;
        for (let t = j.v1 - 5; t > j.v0 + 3; t -= 6.5) {
          for (const sgn of [-1, 1]) {
            const bu = j.u + sgn * 6.4;
            if (dryAt(j.u + sgn * 3, t) || !free(j.u + sgn * 12.5, t) || !free(j.u + sgn * 12.5, t + 3)) continue;
            n++;
            if (kind === 'club' && n > 4) continue;
            box(bu, t, sea - 0.1, 10, 1.1, 0.5, FLOAT, WIN.none, PLANK);
            if (rnd(80 + n) < 0.85) {
              const q = xy(j.u + sgn * 7, t + 2.4);
              addYacht(m, q.x, q.y, 0, 7.5 + rnd(90 + n) * 3.5, turn + (sgn > 0 ? Math.PI : 0), pick(HULLS, 100 + n), pick(COVERS, 120 + n));
            }
          }
        }
      }
    }

    // Firs behind the building, on the islands where the land is all forest.
    if (cover === 'evergreen') {
      for (let k = 0; k < 9; k++) {
        const u = (rnd(900 + k) - 0.5) * (house.w + 34);
        const v = -house.d / 2 - 5 - rnd(920 + k) * 22;
        const q = xy(u, v);
        const h0 = height(q.x, q.y);
        if (h0 <= DRY + 0.3) continue;
        const tall = 11 + rnd(940 + k) * 9;
        const fir = C(0.09 + rnd(960 + k) * 0.04, 0.2 + rnd(970 + k) * 0.06, 0.12);
        m.solid({ x: q.x, y: q.y, base: h0 - 0.5, w: 0.5, h: tall * 0.3, turn, color: C(0.27, 0.2, 0.15) });
        m.lathe(q.x, q.y, h0 + tall * 0.18, [[tall * 0.2, 0], [tall * 0.13, tall * 0.35], [0.1, tall * 0.82]], 6, fir);
      }
    }

    const gv = deck ? (deck.v0 + deck.v1) / 2 : house.d / 2 + 3;
    // What shows across the water after dark: the glow of the place as a whole, and a row of lamps along the front of its deck.
    lights.push({ p: P(0, gv, level + 2.6), a: glowColor, b: glowColor, shape: SHAPE.glow, size: 20, min: 11 });
    if (deck && kind !== 'park') {
      const n = Math.max(3, Math.round((deck.u1 - deck.u0) / 6));
      for (let i = 0; i <= n; i++) lights.push({ p: P(deck.u0 + ((deck.u1 - deck.u0) * i) / n, deck.v1 - 0.2, level + 3.1), a: WARM, b: WARM, shape: SHAPE.glow, size: 1.6, min: 3.2 });
    }
    spots.push({ id: place.id, kind, x: s.x, y: s.y, top, layout: layoutOf(plan, ground) });
  }

  const group = new THREE.Group();
  group.name = 'shoreside';
  group.add(m.build('shoreside_buildings'));
  if (lights.length) group.add(beacons(lights));
  if (boards.length && typeof document !== 'undefined') group.add(lettering(boards));
  return { group, spots, triangles: m.triangles };
}

/** The words on every board, drawn once onto one sheet and laid on a quad in front of each. Dark letters: after dark the board glows behind them. */
function lettering(boards: Board[]): THREE.Mesh {
  const ROW = 64;
  const W = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = ROW * boards.length;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#16181c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  boards.forEach((b, i) => {
    let px = 46;
    g.font = `700 ${px}px Georgia, 'Times New Roman', serif`;
    const wide = g.measureText(b.text).width;
    if (wide > W - 16) {
      px = Math.max(16, Math.floor((px * (W - 16)) / wide));
      g.font = `700 ${px}px Georgia, 'Times New Roman', serif`;
    }
    g.fillText(b.text, W / 2, ROW * i + ROW / 2 + 2);
    const textW = Math.min(W, g.measureText(b.text).width + 16);
    // Fit the row to the board, keeping the letters' shape.
    const scale = Math.min((b.w * 0.92) / textW, (b.h * 0.8) / px);
    const hw = (W * scale) / 2;
    const hh = (ROW * scale) / 2;
    const [x, y, z] = b.at;
    const o = pos.length / 3;
    for (const [su, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pos.push(x + b.ux * hw * su, z + hh * sz, -(y + b.uy * hw * su));
    const v0 = 1 - (i + 1) / boards.length;
    const v1 = 1 - i / boards.length;
    // Seen from the water, the shore's right is the reader's left.
    uv.push(1, v0, 0, v0, 0, v1, 1, v1);
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(idx);
  // The stage disposes of the land's geometry when the water changes: the sheet of lettering goes with it.
  geom.addEventListener('dispose', () => tex.dispose());
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  mesh.name = 'shoreside_signs';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * The flags and the lights as points. Close to, each is the size it really is. Far off it stops shrinking at a few
 * pixels, which is how a burgee or a lit window is found across two miles of water. Flags show by day and dim at
 * night, when the lights come up with the shore's (`cityNight`). One draw call, nothing to update each frame.
 * @param reach how much further than a venue's lights these carry: an oil platform's are seen across the channel
 */
export function beacons(list: Light[], reach = 1, name = 'shoreside_lights'): THREE.Points {
  const n = list.length;
  const pos = new Float32Array(n * 3);
  const colA = new Float32Array(n * 3);
  const colB = new Float32Array(n * 3);
  const spec = new Float32Array(n * 3);
  list.forEach((l, i) => {
    pos.set([l.p[0], l.p[2], -l.p[1]], i * 3);
    colA.set([l.a.r, l.a.g, l.a.b], i * 3);
    colB.set([l.b.r, l.b.g, l.b.b], i * 3);
    spec.set([l.shape, l.size, l.min], i * 3);
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('aColor', new THREE.BufferAttribute(colA, 3));
  geom.setAttribute('aColor2', new THREE.BufferAttribute(colB, 3));
  geom.setAttribute('aSpec', new THREE.BufferAttribute(spec, 3));
  const uniforms = { uNight: { value: cityNight.value }, uScale: { value: 800 }, uPx: { value: 1 }, uWidth: { value: 1280 }, uReach: { value: reach } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute vec3 aColor;
      attribute vec3 aColor2;
      attribute vec3 aSpec;
      uniform float uNight;
      uniform float uScale;
      uniform float uPx;
      uniform float uWidth;
      uniform float uReach;
      varying vec3 vA;
      varying vec3 vB;
      varying float vShape;
      varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = max(1.0, -mv.z);
        float size = min(max(aSpec.y * uScale / dist, aSpec.z * uPx), 220.0);
        vShape = aSpec.x;
        vA = aColor;
        vB = aColor2;
        // Lights only after dark. Everything goes into the haze well before the far shore.
        vFade = (aSpec.x > 1.5 ? uNight : 1.0) * (1.0 - smoothstep(7000.0 * uReach, 12000.0 * uReach, dist));
        gl_Position = projectionMatrix * mv;
        // A flag flies from its hoist: move the square half its width to one side of the staff.
        if (aSpec.x < 1.5) gl_Position.x += size / uWidth * gl_Position.w;
        gl_PointSize = size;
        if (vFade < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: `
      uniform float uNight;
      varying vec3 vA;
      varying vec3 vB;
      varying float vShape;
      varying float vFade;
      void main() {
        vec2 p = gl_PointCoord;
        vec3 col;
        float a;
        if (vShape > 1.5) {
          float d = clamp(1.0 - length(p - 0.5) * 2.0, 0.0, 1.0);
          a = d * d;
          a = d * (0.35 + 0.65 * d);
          col = vA * (1.6 + 3.0 * d * d);
        } else {
          float y = p.y - 0.5 + sin(p.x * 7.0) * 0.035 * p.x;
          if (vShape < 0.5) {
            // A burgee: a long triangle with a stripe down its middle.
            float half_ = 0.36 * (1.0 - p.x);
            a = step(abs(y), half_);
            col = mix(vA, vB, step(abs(y), half_ * 0.34));
          } else {
            // A flag: two bands.
            a = step(abs(y), 0.3) * step(0.02, p.x) * step(p.x, 0.98);
            col = y < 0.0 ? vA : vB;
          }
          // Lit by the day, and by the floodlight on the staff at night.
          col *= mix(1.5, 0.16, uNight);
        }
        if (a * vFade < 0.02) discard;
        gl_FragColor = vec4(col, a * vFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  onCityNight((night) => { uniforms.uNight.value = night; });
  const points = new THREE.Points(geom, mat);
  points.name = name;
  points.frustumCulled = false;
  points.renderOrder = 2;
  const sizeOf = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(sizeOf);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    uniforms.uScale.value = sizeOf.y / (2 * Math.tan((fov * Math.PI) / 360));
    uniforms.uPx.value = renderer.getPixelRatio();
    uniforms.uWidth.value = sizeOf.x;
  };
  return points;
}
