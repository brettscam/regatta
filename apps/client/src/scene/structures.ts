import * as THREE from 'three';
import type { Structure } from '../world/features';
import { Massing, WIN } from './massing';
import { SHAPE, beacons, type Light } from './shoreside';
import { hash } from './terrain';

// What stands in the sea, drawn from a water's `features.json` `structures`: rock breakwaters, a concrete pier, oil
// platforms on steel legs, and man-made oil islands dressed up as resorts. Where each one is, and that a boat cannot
// sail through it, is the data's business (`scripts/stamp.ts` writes them into the chart's depth). This only draws.
// One mesh for all of them, in the city's material so their lamps come on after dark, and one set of points for the
// lights that carry across the channel. Course coordinates are metres east (x) and north (y).

type P3 = [number, number, number];
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const ROCK = C(0.27, 0.255, 0.235);
const ROCK_WET = C(0.2, 0.2, 0.19);
const CONCRETE = C(0.62, 0.61, 0.57);
const STEEL = C(0.5, 0.46, 0.2);
const RUST = C(0.42, 0.25, 0.16);
const GREY = C(0.55, 0.56, 0.56);
const WHITE = C(0.92, 0.92, 0.89);
const WARM = C(1, 0.78, 0.48);
const COOL = C(0.82, 0.92, 1);
const RED = C(1, 0.16, 0.1);
const SAND = C(0.76, 0.7, 0.55);
const PALM = C(0.16, 0.36, 0.13);
const TRUNK = C(0.45, 0.38, 0.29);
const SEALION = C(0.33, 0.24, 0.17);

export interface Structures {
  group: THREE.Group;
  triangles: number;
  /** Where each one is, and how far off its fine detail is still worth drawing. For whoever labels or culls them. */
  placed: Array<{ id: string; kind: Structure['kind']; x: number; y: number; top: number }>;
}

/** A coconut palm: a leaning trunk and a crown of eight drooping fronds. */
export function palm(m: Massing, x: number, y: number, base: number, tall: number, seed: number): void {
  const lean = hash(seed, 3) * 6.28;
  const off = tall * (0.06 + hash(seed, 5) * 0.1);
  const top: P3 = [x + Math.cos(lean) * off, y + Math.sin(lean) * off, base + tall];
  m.beam([x, y, base - 0.4], top, 0.42, 0.42, TRUNK);
  const reach = 2.6 + tall * 0.12;
  const tone = PALM.clone().multiplyScalar(0.85 + hash(seed, 7) * 0.4);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + lean;
    const mid: P3 = [top[0] + Math.cos(a) * reach * 0.55, top[1] + Math.sin(a) * reach * 0.55, top[2] + 0.5];
    const tip: P3 = [top[0] + Math.cos(a) * reach, top[1] + Math.sin(a) * reach, top[2] - reach * 0.42];
    const sx = -Math.sin(a) * 0.55;
    const sy = Math.cos(a) * 0.55;
    const inside: P3 = [top[0], top[1], top[2] - 3];
    m.tri(top, [mid[0] + sx, mid[1] + sy, mid[2]], [mid[0] - sx, mid[1] - sy, mid[2]], tone, inside);
    m.tri([mid[0] + sx, mid[1] + sy, mid[2]], [mid[0] - sx, mid[1] - sy, mid[2]], tip, tone, inside);
  }
}

/** A rock wall along a line: a rough crest a few metres above the sea, sloping away under it on both sides. */
function breakwater(m: Massing, s: Structure, lights: Light[]): void {
  const line = s.line!;
  const crest = s.height ?? 4.3;
  // Cut the line into pieces of about fifty metres, each with its own height and tone, so it reads as piled rock.
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 55));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) pts.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  const side = (i: number): [number, number] => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  };
  const at = (i: number, off: number, z: number): P3 => { const [nx, ny] = side(i); return [pts[i][0] + nx * off, pts[i][1] + ny * off, z]; };
  const h = (i: number) => crest + (hash(Math.round(pts[i][0]), Math.round(pts[i][1])) - 0.5) * 1.1;
  for (let i = 0; i < pts.length - 1; i++) {
    const tone = ROCK.clone().multiplyScalar(0.82 + hash(i, Math.round(pts[i][0])) * 0.36);
    const inside: P3 = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2, -2];
    m.quad(at(i, -2.6, h(i)), at(i + 1, -2.6, h(i + 1)), at(i + 1, 2.6, h(i + 1)), at(i, 2.6, h(i)), tone, inside);
    for (const sgn of [-1, 1]) {
      // Dry rock down to the tide line, dark and wet below it.
      m.quad(at(i, sgn * 7.5, 0.5), at(i + 1, sgn * 7.5, 0.5), at(i + 1, sgn * 2.6, h(i + 1)), at(i, sgn * 2.6, h(i)), tone.clone().multiplyScalar(0.9), inside);
      m.quad(at(i, sgn * 13, -3.5), at(i + 1, sgn * 13, -3.5), at(i + 1, sgn * 7.5, 0.5), at(i, sgn * 7.5, 0.5), ROCK_WET, inside);
    }
  }
  // The round heads at each end.
  for (const i of [0, pts.length - 1]) m.lathe(pts[i][0], pts[i][1], -3.5, [[13, 0], [7.5, 4], [2.6, 3.5 + crest], [0.1, 3.7 + crest]], 9, ROCK);
  void lights;
}

/** A concrete pleasure pier on piles, lamps down both sides, a low building on the T at its end. */
function pier(m: Massing, s: Structure, lights: Light[]): void {
  const line = s.line!;
  const z = s.height ?? 6;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    m.beam([a[0], a[1], z - 0.5], [b[0], b[1], z - 0.5], 9, 1, CONCRETE);
    const n = Math.round(len / 18);
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ux * ((len * k) / n);
      const y = a[1] + uy * ((len * k) / n);
      for (const sgn of [-1, 1]) {
        m.beam([x + uy * sgn * 3.6, y - ux * sgn * 3.6, -4], [x + uy * sgn * 3.6, y - ux * sgn * 3.6, z - 1], 0.8, 0.8, CONCRETE.clone().multiplyScalar(0.8));
        if (k % 2 === 0) {
          m.beam([x + uy * sgn * 4.2, y - ux * sgn * 4.2, z], [x + uy * sgn * 4.2, y - ux * sgn * 4.2, z + 5], 0.18, 0.18, GREY);
          m.solid({ x: x + uy * sgn * 4.2, y: y - ux * sgn * 4.2, base: z + 5, w: 0.5, h: 0.4, color: WARM, win: WIN.lamp });
          lights.push({ p: [x + uy * sgn * 4.2, y - ux * sgn * 4.2, z + 5.2], a: WARM, b: WARM, shape: SHAPE.glow, size: 1.6, min: 2.6 });
        }
      }
    }
    if (i === line.length - 2) {
      // The T at the seaward end, with a cafe on it.
      const turn = Math.atan2(uy, ux);
      m.solid({ x: b[0], y: b[1], base: z - 1, w: 22, d: 46, h: 1, turn, color: CONCRETE });
      m.hall(b[0] - ux * 2, b[1] - uy * 2, z, 9, 16, 3.4, 1.6, turn, WHITE, C(0.3, 0.45, 0.5), WIN.homes);
      for (const [du, dv] of [[-9, -20], [-9, 20], [9, -20], [9, 20]]) m.beam([b[0] + ux * du + uy * dv, b[1] + uy * du - ux * dv, -4], [b[0] + ux * du + uy * dv, b[1] + uy * du - ux * dv, z - 1], 1, 1, CONCRETE.clone().multiplyScalar(0.8));
    }
  }
}

/**
 * One of the oil islands off Long Beach: a ring of rock, and on it what was put there to hide the drilling. Palms all
 * round the edge, a concrete waterfall, low walls in sea colours, and tall slender towers in pastel panels that are
 * really the cladding of the rigs. After dark the towers and the waterfall are lit in colour.
 */
function resortIsland(m: Massing, s: Structure, lights: Light[], seed: number): void {
  const x = s.x!;
  const y = s.y!;
  const r = s.r ?? 120;
  const top = 3.4;
  m.lathe(x, y, -4, [[r + 14, 0], [r + 5, 4.2], [r, 4 + top], [r - 3, 4 + top + 0.3]], 28, ROCK, WIN.none, 0.9, seed);
  m.lathe(x, y, top, [[r - 3, 0.3], [r - 14, 0.4]], 28, SAND, WIN.none, 0.9, seed);
  // Lawns inside the ring of sand: these islands are gardened.
  m.lathe(x, y, top, [[r - 14, 0.4], [0.1, 0.9]], 28, C(0.3, 0.44, 0.2), WIN.none, 0.9, seed);
  const turn = hash(seed, 11) * 3;
  const at = (u: number, v: number): [number, number] => [x + Math.cos(turn) * u - Math.sin(turn) * v, y + Math.sin(turn) * u + Math.cos(turn) * v];
  // Palms round the rim, a little unevenly.
  const n = Math.round((Math.PI * 2 * r) / 17);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + hash(seed, k) * 0.12;
    const rr = (r - 9) * (0.94 + hash(k, seed) * 0.06);
    palm(m, x + Math.cos(a + seed) * rr, y + Math.sin(a + seed) * rr * 0.9, top + 0.3, 13 + hash(seed + k, 9) * 6, seed * 31 + k);
  }
  // The towers: slender, in vertical panels of white and sea colours, lit from below at night.
  const pastel = [C(0.93, 0.93, 0.9), C(0.42, 0.72, 0.78), C(0.95, 0.74, 0.55), C(0.55, 0.62, 0.86), C(0.93, 0.86, 0.6)];
  const glow = [C(1, 0.25, 0.6), C(0.2, 0.85, 1), C(1, 0.62, 0.15), C(0.45, 0.4, 1), C(0.3, 1, 0.55)];
  const towers = 2 + Math.floor(hash(seed, 13) * 2.99);
  for (let k = 0; k < towers; k++) {
    const [tx, ty] = at((k - (towers - 1) / 2) * r * 0.5, (hash(seed, 20 + k) - 0.5) * r * 0.5);
    const tall = 42 + hash(seed, 30 + k) * 16;
    const w = 9 + hash(seed, 40 + k) * 3;
    // Four narrow panels a side, each its own colour, standing a little apart: that is what makes them read as sculpture.
    for (let p = 0; p < 4; p++) {
      const a = turn + (p * Math.PI) / 2;
      const col = pastel[(k + p + Math.floor(hash(seed, 50 + k) * 5)) % pastel.length];
      m.solid({ x: tx + Math.cos(a) * w * 0.36, y: ty + Math.sin(a) * w * 0.36, base: top, w: w * 0.5, d: w * 0.3, h: tall - p * 2.5, turn: a + Math.PI / 2, color: col, win: WIN.floodlit, top: 0.9 });
    }
    m.solid({ x: tx, y: ty, base: top, w: w * 0.5, h: tall + 3, turn, color: WHITE, win: WIN.floodlit, sides: 8 });
    const g = glow[(seed + k) % glow.length];
    // Coloured floodlights up its height: each tower its own colour after dark.
    for (const f of [0.15, 0.4, 0.65, 0.88]) lights.push({ p: [tx, ty, top + tall * f], a: g, b: g, shape: SHAPE.glow, size: w * 2.2, min: 5 });
    lights.push({ p: [tx, ty, top + tall + 4], a: RED, b: RED, shape: SHAPE.glow, size: 2, min: 3 });
  }
  // The waterfall: a stepped concrete face with white water down it, on the side toward the city.
  {
    const [wx, wy] = at(0, r * 0.52);
    const stone = C(0.7, 0.66, 0.58);
    for (let k = 0; k < 4; k++) m.solid({ x: wx, y: wy, base: top, w: 34 - k * 7, d: 9 - k * 1.6, h: 5 + k * 3.2, turn, color: stone, win: WIN.floodlit });
    const water = C(0.78, 0.9, 0.95);
    const [fx, fy] = at(0, r * 0.52 + 4.7);
    m.solid({ x: fx, y: fy, base: top, w: 9, d: 0.6, h: 14.4, turn, color: water, win: WIN.floodlit });
    const [f2x, f2y] = at(-10, r * 0.52 + 4.7);
    m.solid({ x: f2x, y: f2y, base: top, w: 4, d: 0.6, h: 8, turn, color: water, win: WIN.floodlit });
    const g = glow[(seed + 3) % glow.length];
    lights.push({ p: [fx, fy, top + 8], a: g, b: g, shape: SHAPE.glow, size: 20, min: 5 });
  }
  // Low screen walls in sea colours, and the plant they hide.
  for (let k = 0; k < 5; k++) {
    const [bx, by] = at((hash(seed, 60 + k) - 0.5) * r * 1.1, -r * 0.15 - hash(seed, 70 + k) * r * 0.45);
    m.solid({ x: bx, y: by, base: top, w: 22 + hash(seed, 80 + k) * 18, d: 8 + hash(seed, 90 + k) * 8, h: 5 + hash(seed, 95 + k) * 4, turn: turn + (k % 2) * 0.4, color: pastel[(k + seed) % pastel.length], win: WIN.floodlit });
  }
  // A boat landing and its lamp, on the lee side.
  const [lx, ly] = at(r + 4, 0);
  m.solid({ x: lx, y: ly, base: -2, w: 16, d: 7, h: 3.2, turn, color: CONCRETE });
  lights.push({ p: [lx, ly, 5], a: WARM, b: WARM, shape: SHAPE.glow, size: 2, min: 3 });
}

/**
 * An offshore oil platform: a steel jacket on eight legs braced like a pylon, a cellar deck and a main deck stacked
 * with modules, quarters with a helideck over them, two cranes, a derrick over the wells (not on a processing
 * platform), a flare boom reaching out over the sea with a flame at its tip, and a boat landing at the waterline
 * where the sea lions lie. Lit all over after dark.
 */
function platform(m: Massing, s: Structure, lights: Light[], seed: number, all: readonly Structure[]): void {
  const x = s.x!;
  const y = s.y!;
  const w = s.w ?? 50;
  const d = s.d ?? 40;
  const deck = s.height ?? 21;
  // `turn` is the compass bearing of the long side; the builder's angles run counter-clockwise from east.
  const turn = ((90 - (s.turn ?? 0)) * Math.PI) / 180;
  const cs = Math.cos(turn);
  const sn = Math.sin(turn);
  const P = (u: number, v: number, z: number): P3 => [x + cs * u - sn * v, y + sn * u + cs * v, z];
  const box = (u: number, v: number, z: number, bw: number, bd: number, bh: number, color: THREE.Color, win: number = WIN.none) => {
    const q = P(u, v, z);
    m.solid({ x: q[0], y: q[1], base: z, w: bw, d: bd, h: bh, turn, color, win });
  };
  const drills = !s.bridgeTo;
  const cellar = deck - 8;
  const yellow = STEEL.clone().lerp(C(0.75, 0.62, 0.12), 0.5);

  // The jacket: legs splayed outward as they go down, with level and crossed bracing between them.
  const cols = [-0.42, -0.14, 0.14, 0.42];
  const rows = [-0.36, 0.36];
  const leg = (c: number, r: number, z: number): P3 => {
    const spread = 1 + (cellar - z) * 0.006;
    return P(c * w * spread, r * d * spread, z);
  };
  for (const c of cols) for (const r of rows) m.beam(leg(c, r, -14), leg(c, r, cellar), 1.7, 1.7, STEEL);
  for (const z of [-9, 2.2, cellar - 0.6]) {
    for (const r of rows) m.beam(leg(cols[0], r, z), leg(cols[3], r, z), 0.9, 0.9, RUST);
    for (const c of cols) m.beam(leg(c, rows[0], z), leg(c, rows[1], z), 0.9, 0.9, RUST);
  }
  for (const r of rows) for (let k = 0; k < 3; k++) {
    m.beam(leg(cols[k], r, 2.2), leg(cols[k + 1], r, cellar - 0.6), 0.7, 0.7, RUST);
    m.beam(leg(cols[k + 1], r, 2.2), leg(cols[k], r, cellar - 0.6), 0.7, 0.7, RUST);
    m.beam(leg(cols[k], r, -9), leg(cols[k + 1], r, 2.2), 0.7, 0.7, ROCK_WET);
  }
  for (const c of [cols[0], cols[3]]) {
    m.beam(leg(c, rows[0], 2.2), leg(c, rows[1], cellar - 0.6), 0.7, 0.7, RUST);
    m.beam(leg(c, rows[1], 2.2), leg(c, rows[0], cellar - 0.6), 0.7, 0.7, RUST);
  }
  // The conductors: the well pipes, in a tight bundle down through the jacket.
  if (drills) for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) m.beam(P(-w * 0.04 + i * 2.2, -3 + j * 2.4, -10), P(-w * 0.04 + i * 2.2, -3 + j * 2.4, cellar), 0.6, 0.6, ROCK_WET);

  // Decks. Each is a slab with a darker edge and a rail of lamps.
  for (const [z, grow] of [[cellar, 0.98], [deck, 1.06]] as const) {
    box(0, 0, z - 1.2, w * grow, d * grow, 1.2, GREY.clone().multiplyScalar(0.7));
    // Work lights all round both decks: a platform is lit like a small town, all night.
    const n = 7;
    for (let k = 0; k <= n; k++) {
      for (const sgn of [-1, 1]) {
        const q = P((-0.5 + k / n) * w * grow, sgn * d * grow * 0.5, z + 1.6);
        m.solid({ x: q[0], y: q[1], base: z + 1.4, w: 0.9, h: 0.7, color: z === deck ? COOL : WARM, win: WIN.lamp });
        lights.push({ p: q, a: z === deck ? COOL : WARM, b: WARM, shape: SHAPE.glow, size: 4.5, min: 3.6 });
      }
      if (k > 0 && k < n && k % 2 === 0) for (const sgn of [-1, 1]) {
        const q = P(sgn * w * grow * 0.5, (-0.5 + k / n) * d * grow, z + 1.6);
        lights.push({ p: q, a: WARM, b: WARM, shape: SHAPE.glow, size: 4.5, min: 3.6 });
      }
    }
  }
  // Between the decks: the process area, all vessels and pipe racks.
  for (let k = 0; k < 6; k++) {
    const u = (-0.38 + (k % 3) * 0.3) * w;
    const v = (k < 3 ? -0.2 : 0.22) * d;
    box(u, v, cellar, w * 0.2, d * 0.3, 4 + hash(seed, k) * 2.6, k % 2 ? GREY : C(0.7, 0.68, 0.6));
  }
  // On the main deck: quarters at one end with the helideck over them, modules along the middle.
  const q0 = -w * 0.34;
  box(q0, 0, deck, w * 0.26, d * 0.72, 11, WHITE, WIN.grid);
  for (const dv of [-0.3, 0, 0.3]) lights.push({ p: P(q0 - w * 0.14, d * dv, deck + 6), a: WARM, b: WARM, shape: SHAPE.glow, size: 7, min: 3.4 });
  box(q0, 0, deck + 11, w * 0.2, d * 0.5, 3, WHITE, WIN.ribbon);
  {
    // The helideck: an eight-sided pad out over the corner, green with a pale ring.
    const hp = P(q0 - w * 0.16, d * 0.34, deck + 14.5);
    m.lathe(hp[0], hp[1], deck + 14.5, [[10.5, 0], [10.5, 0.5], [0.1, 0.55]], 8, C(0.2, 0.42, 0.3));
    m.lathe(hp[0], hp[1], deck + 15.06, [[6.5, 0], [5.4, 0.02]], 8, C(0.9, 0.85, 0.4));
    m.beam(P(q0 - w * 0.1, d * 0.24, deck + 4), [hp[0], hp[1], deck + 14.5], 0.7, 0.7, GREY);
    m.beam(P(q0, d * 0.3, deck + 11), [hp[0], hp[1], deck + 14.5], 0.6, 0.6, GREY);
    for (let k = 0; k < 8; k += 2) {
      const a = (k / 8) * Math.PI * 2;
      lights.push({ p: [hp[0] + Math.cos(a) * 10, hp[1] + Math.sin(a) * 10, deck + 15.2], a: C(0.4, 1, 0.5), b: WARM, shape: SHAPE.glow, size: 1.2, min: 2 });
    }
  }
  box(w * 0.02, -d * 0.2, deck, w * 0.3, d * 0.34, 6.5, C(0.66, 0.64, 0.58), WIN.shed);
  box(w * 0.05, d * 0.24, deck, w * 0.22, d * 0.3, 5, C(0.36, 0.42, 0.46));
  box(w * 0.3, d * 0.2, deck, w * 0.2, d * 0.3, 8, C(0.7, 0.7, 0.66), WIN.shed);
  // A lifeboat in its davits, orange.
  box(q0 + w * 0.02, -d * 0.56, deck - 1, 8, 2.8, 2.8, C(0.95, 0.42, 0.08));

  let top = deck + 16;
  if (drills) {
    // The derrick: four legs leaning in to a crown, braced in bays, on its substructure over the wells.
    const du = w * 0.0;
    const dv = -d * 0.02;
    const base = deck + 7.5;
    const tall = 40;
    box(du, dv, deck, 13, 13, 7.5, yellow.clone().multiplyScalar(0.8));
    const corner = (k: number, z: number): P3 => {
      const f = 1 - ((z - base) / tall) * 0.78;
      return P(du + (k === 0 || k === 3 ? -5.5 : 5.5) * f, dv + (k < 2 ? -5.5 : 5.5) * f, z);
    };
    for (let k = 0; k < 4; k++) {
      m.beam(corner(k, base), corner(k, base + tall), 0.55, 0.55, WHITE);
      for (let bay = 0; bay < 5; bay++) {
        const z0 = base + (tall * bay) / 5;
        const z1 = base + (tall * (bay + 1)) / 5;
        m.beam(corner(k, z0), corner((k + 1) % 4, z1), 0.3, 0.3, bay % 2 ? RED.clone().multiplyScalar(0.7) : WHITE);
        m.beam(corner(k, z1), corner((k + 1) % 4, z1), 0.3, 0.3, WHITE);
      }
    }
    box(du, dv, base + tall, 3.4, 3.4, 2.4, RED.clone().multiplyScalar(0.7));
    top = base + tall + 3;
    lights.push({ p: P(du, dv, top), a: RED, b: RED, shape: SHAPE.glow, size: 3, min: 4.5 });
    // Lamps up all four legs of the derrick: the tallest lit thing for miles.
    for (const f of [0.12, 0.3, 0.48, 0.66, 0.84]) for (let k = 0; k < 4; k += 2) lights.push({ p: corner(k, base + tall * f), a: COOL, b: COOL, shape: SHAPE.glow, size: 3.6, min: 3.2 });
    lights.push({ p: P(du, dv, deck + 4), a: WARM, b: WARM, shape: SHAPE.glow, size: 16, min: 5 });
  } else {
    // A processing platform: tall vessels and a vent stack where the derrick would be.
    for (let k = 0; k < 3; k++) {
      const q = P(w * (0.02 + k * 0.1), -d * 0.05, deck);
      m.solid({ x: q[0], y: q[1], base: deck + 6.5, w: 4.2, h: 13 + k * 3, sides: 10, color: C(0.8, 0.8, 0.76) });
    }
    top = deck + 30;
    lights.push({ p: P(w * 0.12, -d * 0.05, top - 4), a: RED, b: RED, shape: SHAPE.glow, size: 3, min: 4.5 });
  }
  // Two pedestal cranes, booms up at different angles.
  for (const [cu, cv, swing, lift] of [[w * 0.2, -d * 0.5, -0.5, 0.75], [-w * 0.12, d * 0.5, 2.2, 0.45]] as const) {
    const foot = P(cu, cv, deck);
    const head = P(cu, cv, deck + 14);
    m.beam(foot, head, 2.2, 2.2, yellow);
    m.solid({ x: head[0], y: head[1], base: deck + 13, w: 4.2, d: 3.4, h: 3.2, turn: turn + swing, color: yellow, win: WIN.homes });
    const reach = 30;
    const tip: P3 = [head[0] + Math.cos(turn + swing) * reach * Math.cos(lift), head[1] + Math.sin(turn + swing) * reach * Math.cos(lift), deck + 14.5 + reach * Math.sin(lift)];
    m.beam([head[0], head[1], deck + 15.5], tip, 1.1, 1.3, yellow);
    m.beam([head[0], head[1], deck + 19], tip, 0.2, 0.2, ROCK_WET);
    m.beam([head[0], head[1], deck + 15.5], [head[0], head[1], deck + 19], 0.5, 0.5, yellow);
    lights.push({ p: tip, a: RED, b: RED, shape: SHAPE.glow, size: 1.6, min: 3 });
  }
  // The flare boom: a long truss out over the sea from the end away from the quarters, and the flame.
  {
    const root = P(w * 0.5, -d * 0.1, deck + 2);
    const tip = P(w * 0.5 + 38, -d * 0.1, deck + 24);
    m.beam(root, tip, 1.4, 1.8, GREY);
    m.beam(P(w * 0.5, -d * 0.1, deck + 9), tip, 0.4, 0.4, GREY);
    m.beam(P(w * 0.5, -d * 0.1, deck), P(w * 0.5, -d * 0.1, deck + 9), 0.8, 0.8, GREY);
    const flame = C(1, 0.55, 0.12);
    m.solid({ x: tip[0], y: tip[1], base: tip[2], w: 3, h: 7, sides: 6, top: 0.1, color: flame, win: WIN.lamp });
    lights.push({ p: [tip[0], tip[1], tip[2] + 3.5], a: flame, b: flame, shape: SHAPE.glow, size: 26, min: 10 });
  }
  // The boat landing: a grating at the waterline on the lee side, fendered, and the sea lions that have taken it over.
  {
    box(0, d * 0.5 + 4, 1.2, w * 0.4, 6, 0.5, GREY.clone().multiplyScalar(0.6));
    for (const u of [-0.18, 0.18]) m.beam(P(u * w, d * 0.5 + 6.6, -3), P(u * w, d * 0.5 + 6.6, 3), 0.9, 0.9, ROCK_WET);
    m.beam(P(0, d * 0.5 + 1.5, 1.7), P(0, d * 0.36, cellar), 1.3, 0.25, GREY);
    for (let k = 0; k < 7; k++) {
      const u = (-0.17 + hash(seed, 100 + k) * 0.34) * w;
      const v = d * 0.5 + 2.2 + hash(seed, 110 + k) * 3.4;
      const q = P(u, v, 1.7);
      const a = turn + hash(seed, 120 + k) * 6.28;
      const len = 1.7 + hash(seed, 130 + k) * 0.9;
      // A body lying along the grating and a head held up at one end.
      m.solid({ x: q[0], y: q[1], base: 1.7, w: len, d: 0.7, h: 0.55, turn: a, color: SEALION, top: 0.7 });
      m.solid({ x: q[0] + Math.cos(a) * len * 0.42, y: q[1] + Math.sin(a) * len * 0.42, base: 2.1, w: 0.42, h: 0.75, color: SEALION.clone().multiplyScalar(0.85), top: 0.6 });
    }
    lights.push({ p: P(0, d * 0.5 + 4, 3.4), a: WARM, b: WARM, shape: SHAPE.glow, size: 1.6, min: 2.4 });
  }
  // The whole of her, seen from miles off: one loom of light.
  lights.push({ p: P(0, 0, deck + 8), a: WARM, b: WARM, shape: SHAPE.glow, size: 70, min: 12 });
  // The sea under her is lit too: lamps under the cellar deck, shining down through the jacket.
  for (const c of [cols[0], cols[3]]) for (const r of rows) lights.push({ p: leg(c, r, cellar - 2), a: WARM, b: WARM, shape: SHAPE.glow, size: 6, min: 3.4 });

  // A footbridge to her neighbour.
  const other = all.find((o) => o.id === s.bridgeTo);
  if (other && other.x !== undefined && other.y !== undefined) {
    const from: P3 = [x, y, deck + 1];
    const to: P3 = [other.x, other.y, (other.height ?? deck) + 1];
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const ux = (to[0] - from[0]) / len;
    const uy = (to[1] - from[1]) / len;
    const a: P3 = [from[0] + ux * w * 0.4, from[1] + uy * w * 0.4, from[2]];
    const b: P3 = [to[0] - ux * (other.w ?? w) * 0.4, to[1] - uy * (other.w ?? w) * 0.4, to[2]];
    m.beam(a, b, 2.4, 0.5, GREY);
    m.beam([a[0], a[1], a[2] + 2.6], [b[0], b[1], b[2] + 2.6], 0.4, 0.4, GREY);
    const bays = 6;
    for (let k = 0; k < bays; k++) {
      const p0: P3 = [a[0] + ((b[0] - a[0]) * k) / bays, a[1] + ((b[1] - a[1]) * k) / bays, a[2]];
      const p1: P3 = [a[0] + ((b[0] - a[0]) * (k + 1)) / bays, a[1] + ((b[1] - a[1]) * (k + 1)) / bays, a[2] + 2.6];
      m.beam(p0, p1, 0.3, 0.3, GREY);
      if (k % 2) lights.push({ p: p0, a: WARM, b: WARM, shape: SHAPE.glow, size: 1.4, min: 2 });
    }
  }
  void top;
}

/** Everything built in the sea on this water. */
export function buildStructures(list: readonly Structure[]): Structures {
  const m = new Massing();
  const lights: Light[] = [];
  const placed: Structures['placed'] = [];
  list.forEach((s, i) => {
    m.next();
    if (s.kind === 'breakwater' && s.line) breakwater(m, s, lights);
    else if (s.kind === 'pier' && s.line) pier(m, s, lights);
    else if (s.kind === 'island' && s.x !== undefined) resortIsland(m, s, lights, i + 3);
    else if (s.kind === 'platform' && s.x !== undefined) platform(m, s, lights, i + 7, list);
    const at = s.line ? s.line[Math.floor(s.line.length / 2)] : [s.x ?? 0, s.y ?? 0];
    placed.push({ id: s.id, kind: s.kind, x: at[0], y: at[1], top: s.kind === 'platform' ? (s.height ?? 21) + 50 : s.kind === 'island' ? 60 : (s.height ?? 5) });
  });
  const group = new THREE.Group();
  group.name = 'structures';
  group.add(m.build('structures_mesh'));
  // A platform's lights are seen across the channel: three times as far as a bar's.
  if (lights.length) group.add(beacons(lights, 3, 'structure_lights'));
  return { group, triangles: m.triangles, placed };
}
