import * as THREE from 'three';
import type { CourseData } from '@slack-tide/world';
import { Massing, WIN } from './massing';
import { SHAPE, beacons, type Light } from './shoreside';
import { palm } from './structures';
import { hash } from './terrain';
import { mooredFleet } from './yacht';

// The mainland side of the San Pedro Channel, at the detail that reads from a boat inside the breakwater: downtown
// Long Beach's towers, the Queen Mary and the dome beside her, the container cranes of the two ports, the Vincent
// Thomas Bridge far up the harbor, and the yachts in Shoreline Marina and Alamitos Bay.
// Positions are latitudes and longitudes from general knowledge, not from a chart, each walked on to the baked land
// (or, for the ship and the yachts, on to the water beside it) before anything is built. They want checking.
// One mesh for all the buildings, one set of points for the lights, two instanced meshes for each marina's yachts.

type P3 = [number, number, number];
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const WHITE = C(0.92, 0.91, 0.87);
const WARM = C(1, 0.78, 0.48);
const RED = C(1, 0.16, 0.1);

/** What a builder on this water is given to stand things on. */
export interface SceneGround {
  /** Height of the land as it is drawn, metres. Below zero over water. */
  height(x: number, y: number): number;
  /** Charted depth, metres. 0 on land. */
  depth(x: number, y: number): number;
}

/** Something that need only be drawn when the eye is near: the stage hides it beyond `far` metres. */
export interface Detail {
  object: THREE.Object3D;
  x: number;
  y: number;
  far: number;
}

export interface Built {
  group: THREE.Group;
  triangles: number;
  detail: Detail[];
  /** How many of each thing, for the curious and for tests. */
  counts: Record<string, number>;
}

/** Downtown's towers: latitude, longitude, width, depth, height, turn in degrees, wall, glass, and how many sides (4 is a slab). */
const TOWERS: Array<[number, number, number, number, number, number, THREE.Color, number, number]> = [
  [33.7676, -118.1995, 44, 44, 121, 8, C(0.3, 0.42, 0.52), WIN.ribbon, 4], // the tallest: blue glass, at the west end
  [33.769, -118.1925, 40, 36, 116, 8, C(0.78, 0.74, 0.68), WIN.grid, 4],
  [33.7681, -118.1905, 36, 36, 108, 8, C(0.36, 0.4, 0.44), WIN.ribbon, 4],
  [33.7652, -118.1968, 28, 28, 105, 8, C(0.86, 0.87, 0.88), WIN.homes, 4], // a pair of white apartment towers by the water
  [33.7652, -118.1953, 28, 28, 101, 8, C(0.84, 0.86, 0.9), WIN.homes, 4],
  [33.7668, -118.188, 34, 30, 87, 8, C(0.7, 0.66, 0.6), WIN.grid, 4],
  [33.766, -118.1845, 34, 34, 82, 0, C(0.9, 0.9, 0.88), WIN.ribbon, 16], // the round tower
  [33.7702, -118.189, 30, 30, 76, 8, C(0.6, 0.55, 0.5), WIN.grid, 4],
  [33.7698, -118.196, 32, 26, 70, 8, C(0.52, 0.56, 0.6), WIN.ribbon, 4],
  [33.763, -118.19, 62, 22, 55, 8, C(0.88, 0.84, 0.76), WIN.homes, 4], // the hotel beside the convention center
  [33.7636, -118.178, 26, 26, 72, 8, C(0.9, 0.88, 0.84), WIN.homes, 4], // the apartment towers along the bluff, east of downtown
  [33.7628, -118.1725, 26, 24, 64, 8, C(0.82, 0.8, 0.76), WIN.homes, 4],
  [33.7622, -118.167, 24, 24, 58, 8, C(0.88, 0.86, 0.8), WIN.homes, 4],
  [33.7612, -118.161, 26, 22, 66, 8, C(0.78, 0.8, 0.84), WIN.homes, 4],
  [33.7604, -118.1545, 24, 22, 52, 8, C(0.86, 0.82, 0.76), WIN.homes, 4],
];
const VILLA = { lat: 33.7655, lon: -118.18 };
const ARENA = { lat: 33.7625, lon: -118.188 };
const QUEEN_MARY = { lat: 33.7526, lon: -118.1898 };
const BRIDGE = { lat: 33.7495, lon: -118.2715 };
const SHORELINE = { lat: 33.759, lon: -118.19 };
const ALAMITOS = { lat: 33.748, lon: -118.115 };

/** A great three-funnelled liner of the 1930s, lying alongside for good: black hull, white upperworks, red funnels. */
function liner(m: Massing, x: number, y: number, bearing: number, lights: Light[]): void {
  const L = 310;
  const B = 36;
  const turn = Math.PI / 2 - bearing;
  const cs = Math.cos(turn);
  const sn = Math.sin(turn);
  const at = (f: number, p: number, z: number): P3 => [x + f * cs - p * sn, y + f * sn + p * cs, z];
  const black = C(0.07, 0.07, 0.08);
  const boot = C(0.5, 0.12, 0.08);
  // Stations from the stern to the stem: where along her, half her beam there, the height of the deck edge.
  const st: Array<[number, number, number]> = [[-0.5, 0.1, 15], [-0.46, 0.34, 15], [-0.36, 0.48, 14.5], [-0.1, 0.5, 14], [0.2, 0.5, 14.5], [0.36, 0.36, 16], [0.45, 0.16, 17.5], [0.5, 0.01, 19]];
  const inside = at(0, 0, 5);
  for (let i = 0; i < st.length - 1; i++) {
    const [f0, b0, h0] = st[i];
    const [f1, b1, h1] = st[i + 1];
    for (const s of [-1, 1]) {
      m.quad(at(f0 * L * 0.97, s * b0 * B * 0.9, -3), at(f1 * L * 0.97, s * b1 * B * 0.9, -3), at(f1 * L * 0.98, s * b1 * B * 0.95, 1.6), at(f0 * L * 0.98, s * b0 * B * 0.95, 1.6), boot, inside);
      m.quad(at(f0 * L * 0.98, s * b0 * B * 0.95, 1.6), at(f1 * L * 0.98, s * b1 * B * 0.95, 1.6), at(f1 * L, s * b1 * B, h1 - 3), at(f0 * L, s * b0 * B, h0 - 3), black, inside, WIN.homes, f0 * L, f1 * L, 1.6, h0 - 3);
      m.quad(at(f0 * L, s * b0 * B, h0 - 3), at(f1 * L, s * b1 * B, h1 - 3), at(f1 * L, s * b1 * B, h1), at(f0 * L, s * b0 * B, h0), WHITE, inside);
    }
    m.quad(at(f0 * L, -b0 * B, h0), at(f0 * L, b0 * B, h0), at(f1 * L, b1 * B, h1), at(f1 * L, -b1 * B, h1), C(0.62, 0.52, 0.4), inside);
  }
  const tier = (f: number, len: number, wide: number, z: number, h: number, win: number) => {
    const c = at(f * L, 0, 0);
    m.solid({ x: c[0], y: c[1], base: z, w: len, d: wide, h, turn, color: WHITE, win, roof: C(0.7, 0.66, 0.58) });
  };
  tier(-0.02, L * 0.7, B * 0.92, 14, 5.5, WIN.homes);
  tier(-0.01, L * 0.6, B * 0.84, 19.5, 4.5, WIN.homes);
  tier(0.03, L * 0.46, B * 0.66, 24, 3.6, WIN.homes);
  tier(0.2, L * 0.07, B * 0.7, 27.6, 3.4, WIN.ribbon);
  // Three funnels, each a little lower than the one ahead of it.
  const funnel = C(0.8, 0.22, 0.08);
  [[0.13, 20], [-0.02, 18.5], [-0.17, 17]].forEach(([f, h]) => {
    const c = at(f * L, 0, 0);
    m.lathe(c[0], c[1], 27.6, [[7, 0], [6.6, h * 0.78]], 12, funnel, WIN.floodlit, 0.72, turn);
    m.lathe(c[0], c[1], 27.6 + h * 0.78, [[6.6, 0], [6.5, h * 0.22]], 12, black, WIN.none, 0.72, turn);
    lights.push({ p: [c[0], c[1], 27.6 + h * 0.5], a: C(1, 0.5, 0.25), b: WARM, shape: SHAPE.glow, size: 16, min: 4 });
  });
  for (const [f, h] of [[0.33, 46], [-0.3, 40]]) m.beam(at(f * L, 0, 16), at(f * L, 0, 16 + h), 0.9, 0.9, C(0.75, 0.6, 0.35));
  // Lamps strung from mast to mast over the funnels, and a row along her promenade deck.
  for (let k = 0; k <= 12; k++) {
    const f = 0.33 - (0.63 * k) / 12;
    lights.push({ p: at(f * L, 0, 60 - Math.sin((k / 12) * Math.PI) * 6), a: WARM, b: WARM, shape: SHAPE.glow, size: 2, min: 2.6 });
    lights.push({ p: at(f * L * 1.2, B * 0.5, 17), a: WARM, b: WARM, shape: SHAPE.glow, size: 2, min: 2.2 });
    lights.push({ p: at(f * L * 1.2, -B * 0.5, 17), a: WARM, b: WARM, shape: SHAPE.glow, size: 2, min: 2.2 });
  }
}

/** A ship-to-shore container crane: a portal on four legs, a machinery house, an A-frame, and a boom, up or down. */
function crane(m: Massing, x: number, y: number, toward: number, up: boolean, color: THREE.Color, lights: Light[]): void {
  const cs = Math.cos(toward);
  const sn = Math.sin(toward);
  const P = (u: number, v: number, z: number): P3 => [x + cs * u - sn * v, y + sn * u + cs * v, z];
  const top = 50;
  for (const u of [-14, 14]) for (const v of [-13, 13]) m.beam(P(u, v, 0), P(u, v, top), 2, 2, color);
  for (const u of [-14, 14]) { m.beam(P(u, -13, 14), P(u, 13, 14), 1.6, 1.6, color); m.beam(P(u, -13, top), P(u, 13, top), 2, 2, color); }
  for (const v of [-13, 13]) { m.beam(P(-14, v, top), P(14, v, top), 2, 2.4, color); m.beam(P(-14, v, 14), P(14, v, top), 1, 1, color); }
  m.solid({ x: P(-4, 0, 0)[0], y: P(-4, 0, 0)[1], base: top + 1, w: 16, d: 11, h: 6, turn: toward, color: WHITE });
  const apex = P(8, 0, top + 26);
  m.beam(P(14, -8, top), apex, 1.3, 1.3, color);
  m.beam(P(14, 8, top), apex, 1.3, 1.3, color);
  m.beam(P(-14, 0, top), apex, 0.8, 0.8, color);
  // The back reach, over the yard.
  m.beam(P(-14, 0, top), P(-42, 0, top), 4, 2.6, color);
  m.beam(apex, P(-40, 0, top + 1), 0.5, 0.5, color);
  const hinge = P(14, 0, top);
  const tip: P3 = up ? P(14 + 62 * Math.cos(1.36), 0, top + 62 * Math.sin(1.36)) : P(76, 0, top);
  m.beam(hinge, tip, 4, 2.6, color);
  m.beam(apex, tip, 0.5, 0.5, color);
  if (!up) m.beam(apex, P(46, 0, top + 1), 0.5, 0.5, color);
  lights.push({ p: [tip[0], tip[1], tip[2] + 2], a: RED, b: RED, shape: SHAPE.glow, size: 2.4, min: 3 });
  lights.push({ p: P(0, 0, top - 3), a: C(1, 0.93, 0.8), b: WARM, shape: SHAPE.glow, size: 9, min: 4 });
}

/** A suspension bridge in green, far up the main channel: two towers, the roadway, the main cables and the approaches on their piers. */
function suspensionBridge(m: Massing, x: number, y: number, bearing: number, heightAt: (x: number, y: number) => number, lights: Light[]): void {
  const ux = Math.sin(bearing);
  const uy = Math.cos(bearing);
  const P = (s: number, off: number, z: number): P3 => [x + ux * s + uy * off, y + uy * s - ux * off, z];
  const green = C(0.2, 0.46, 0.36);
  const deck = 58;
  const half = 228;
  const side = 154;
  const tall = 111;
  for (const s of [-half, half]) {
    for (const off of [-9, 9]) m.beam(P(s, off, -5), P(s, off, tall), 4, 5, green);
    for (const z of [deck - 6, 82, tall - 3]) m.beam(P(s, -9, z), P(s, 9, z), 3, 4, green);
    lights.push({ p: P(s, 0, tall + 2), a: RED, b: RED, shape: SHAPE.glow, size: 3, min: 3.5 });
  }
  m.beam(P(-half - side, 0, deck), P(half + side, 0, deck), 16, 5, green);
  // The cables: a curve between the towers, straight down to the anchorages beyond them.
  for (const off of [-9, 9]) {
    const n = 12;
    for (let k = 0; k < n; k++) {
      const s0 = -half + (2 * half * k) / n;
      const s1 = -half + (2 * half * (k + 1)) / n;
      const z = (s: number) => deck + 4 + (tall - deck - 4) * (s / half) ** 2;
      m.beam(P(s0, off, z(s0)), P(s1, off, z(s1)), 1, 1, green);
      if (k > 0) m.beam(P(s0, off, z(s0)), P(s0, off, deck), 0.3, 0.3, green);
      if (off > 0) lights.push({ p: P(s0, 0, z(s0) + 1), a: C(0.3, 0.6, 1), b: WARM, shape: SHAPE.glow, size: 3, min: 2.6 });
    }
    for (const sgn of [-1, 1]) m.beam(P(sgn * half, off, tall), P(sgn * (half + side), off, deck + 1), 1, 1, green);
  }
  // The approaches: coming down to the ground on both sides, on concrete piers.
  for (const sgn of [-1, 1]) {
    const reach = 620;
    const far = P(sgn * (half + side + reach), 0, 0);
    const end = Math.max(8, heightAt(far[0], far[1]) + 4);
    m.beam(P(sgn * (half + side), 0, deck), [far[0], far[1], end], 16, 4, C(0.6, 0.6, 0.57));
    for (let k = 1; k <= 7; k++) {
      const s = sgn * (half + side + (reach * k) / 8);
      const z = deck + ((end - deck) * k) / 8;
      m.beam(P(s, 0, -4), P(s, 0, z - 2), 3, 8, C(0.6, 0.6, 0.57));
    }
  }
}

/**
 * @param keepClear water to leave open, as [x, y, radius]: where the player comes alongside, and the way in to it
 */
export function buildLongBeach(course: CourseData, ground: SceneGround, keepClear: ReadonlyArray<readonly [number, number, number]> = []): Built {
  const perDeg = (6371008.8 * Math.PI) / 180;
  const perDegLon = perDeg * Math.cos((course.origin.lat * Math.PI) / 180);
  const at = (lat: number, lon: number): [number, number] => [(lon - course.origin.lon) * perDegLon, (lat - course.origin.lat) * perDeg];
  const dry = (x: number, y: number) => ground.height(x, y) > 0.8;
  /** The nearest dry ground to a point, looking out 500 m. Null where there is none. */
  const onLand = (x: number, y: number): [number, number] | null => {
    if (dry(x, y)) return [x, y];
    for (let r = 20; r <= 500; r += 20) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (dry(x + Math.cos(a) * r, y + Math.sin(a) * r)) return [x + Math.cos(a) * r, y + Math.sin(a) * r];
    }
    return null;
  };
  const footing = (x: number, y: number, r: number) => Math.max(0.5, Math.min(ground.height(x - r, y - r), ground.height(x + r, y - r), ground.height(x - r, y + r), ground.height(x + r, y + r), ground.height(x, y)));
  const m = new Massing();
  const lights: Light[] = [];
  const counts: Record<string, number> = {};

  // ---- downtown ---------------------------------------------------------------------------------------
  let towers = 0;
  for (const [lat, lon, w, d, h, turnDeg, color, win, sides] of TOWERS) {
    const p = onLand(...at(lat, lon));
    if (!p) continue;
    m.next();
    const base = footing(p[0], p[1], w / 2) - 1;
    m.solid({ x: p[0], y: p[1], base, w, d, h: h * 0.94, turn: (turnDeg * Math.PI) / 180, color, win, sides });
    m.solid({ x: p[0], y: p[1], base: base + h * 0.94, w: w * 0.6, d: d * 0.6, h: h * 0.06, turn: (turnDeg * Math.PI) / 180, color: color.clone().multiplyScalar(0.8), sides });
    if (h > 95) lights.push({ p: [p[0], p[1], base + h + 3], a: RED, b: RED, shape: SHAPE.glow, size: 3, min: 3 });
    towers++;
  }
  counts.towers = towers;
  {
    // The old apartment-hotel on the bluff: pale stone, sixteen storeys, a steep green copper roof.
    const p = onLand(...at(VILLA.lat, VILLA.lon));
    if (p) {
      const base = footing(p[0], p[1], 16) - 1;
      m.next();
      m.solid({ x: p[0], y: p[1], base, w: 40, d: 24, h: 62, turn: 0.14, color: C(0.86, 0.82, 0.72), win: WIN.homes });
      m.gable(p[0], p[1], base + 62, 41, 25, 18, 0.14, C(0.34, 0.56, 0.5));
      m.solid({ x: p[0], y: p[1], base: base + 62, w: 9, h: 30, turn: 0.14, color: C(0.86, 0.82, 0.72), roof: C(0.34, 0.56, 0.5), top: 0.4 });
    }
    // The round arena by the water, painted all round with whales: a blue drum.
    const a = onLand(...at(ARENA.lat, ARENA.lon));
    if (a) {
      const base = footing(a[0], a[1], 40) - 1;
      m.lathe(a[0], a[1], base, [[56, 0], [56, 24], [50, 27], [0.5, 30]], 28, C(0.3, 0.52, 0.7), WIN.floodlit);
    }
  }
  // The rest of the city along the shore: low and mid-rise blocks, thinning to houses away from downtown.
  {
    const stucco = [C(0.86, 0.84, 0.78), C(0.8, 0.77, 0.7), C(0.9, 0.88, 0.84), C(0.74, 0.72, 0.68), C(0.83, 0.76, 0.66), C(0.7, 0.74, 0.76)];
    const centre = at(33.767, -118.192);
    let n = 0;
    for (let k = 0; k < 520 && n < 210; k++) {
      const x = 7600 + hash(k, 1) * 11800;
      const y = 22900 + hash(k, 2) * 2600;
      const z = ground.height(x, y);
      if (z < 1.6 || z > 60 || ground.height(x + 30, y) < 0.8 || ground.height(x - 30, y) < 0.8 || ground.height(x, y - 30) < 0.8) continue;
      const near = Math.max(0, 1 - Math.hypot(x - centre[0], y - centre[1]) / 2600);
      const h = 7 + hash(k, 3) ** 2 * (16 + 44 * near);
      m.next();
      m.solid({ x, y, base: z - 1.5, w: 34 + hash(k, 4) * 46, d: 26 + hash(k, 5) * 30, h, turn: 0.14 + (hash(k, 6) > 0.8 ? 0.6 : 0), color: stucco[k % stucco.length].clone().multiplyScalar(0.92), win: h > 22 ? WIN.grid : WIN.homes });
      n++;
    }
    counts.blocks = n;
  }
  // Palms along the beach road, seen against the sand.
  {
    let n = 0;
    for (let k = 0; k < 400 && n < 70; k++) {
      const x = 11300 + hash(k, 11) * 5600;
      const y = 22700 + hash(k, 12) * 900;
      const z = ground.height(x, y);
      if (z < 1.2 || z > 14 || ground.height(x, y - 110) > 0) continue;
      palm(m, x, y, z, 15 + hash(k, 13) * 6, 900 + k);
      n++;
    }
    counts.palms = n;
  }

  // ---- the Queen Mary, and the dome -------------------------------------------------------------------
  {
    const [qx, qy] = at(QUEEN_MARY.lat, QUEEN_MARY.lon);
    // She lies off the north-east face of the pier: out from the charted spot to the first water with a liner's depth, and half her beam more.
    let sx = qx;
    let sy = qy;
    for (let t = 0; t <= 900; t += 15) {
      sx = qx + t * 0.7;
      sy = qy + t * 0.7;
      if (ground.height(sx, sy) < 0 && ground.height(sx + 40, sy + 40) < 0) { sx += 22; sy += 22; break; }
    }
    m.next();
    liner(m, sx, sy, (305 * Math.PI) / 180, lights);
    counts.queenMary = 1;
    // The great white dome on the pier beside her.
    const d = onLand(sx - 150, sy - 60);
    if (d) {
      const base = footing(d[0], d[1], 40) - 1;
      const dome: Array<[number, number]> = [];
      for (let k = 0; k <= 7; k++) dome.push([62 * Math.cos((k / 7) * 1.5), 40 * Math.sin((k / 7) * 1.5)]);
      m.lathe(d[0], d[1], base, dome, 20, C(0.9, 0.9, 0.88), WIN.floodlit);
      lights.push({ p: [d[0], d[1], base + 30], a: C(0.85, 0.9, 1), b: WARM, shape: SHAPE.glow, size: 60, min: 5 });
    }
  }

  // ---- the ports: cranes along every quay that has deep water beside it ---------------------------------------
  {
    const paints = [C(0.2, 0.36, 0.56), C(0.72, 0.2, 0.14), C(0.78, 0.78, 0.76), C(0.24, 0.42, 0.36)];
    const boxes: Array<[number, number, number, number, number]> = [[9300, 10900, 20250, 21250, 10], [4000, 7700, 18300, 21600, 14], [7800, 9300, 20700, 22500, 6]];
    const cranes: Array<[number, number, number]> = [];
    boxes.forEach(([x0, x1, y0, y1, want], b) => {
      let n = 0;
      for (let y = y0; y <= y1 && n < want; y += 55) for (let x = x0; x <= x1 && n < want; x += 55) {
        const z = ground.height(x, y);
        if (z < 1.2 || z > 14) continue;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const wx = x + Math.cos(a) * 75;
          const wy = y + Math.sin(a) * 75;
          if (ground.height(wx, wy) >= 0 || ground.depth(wx, wy) < 9 || ground.height(x - Math.cos(a) * 60, y - Math.sin(a) * 60) < 1) continue;
          if (cranes.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < 105)) break;
          cranes.push([x, y, a]);
          m.next();
          crane(m, x, y, a, hash(cranes.length, 5) < 0.6, paints[(b + (cranes.length >> 2)) % paints.length], lights);
          // Boxes stacked in the yard behind her.
          for (let s = 0; s < 3; s++) {
            const bx = x - Math.cos(a) * (70 + s * 26) + Math.sin(a) * (hash(cranes.length, s) - 0.5) * 60;
            const by = y - Math.sin(a) * (70 + s * 26) - Math.cos(a) * (hash(cranes.length, s) - 0.5) * 60;
            if (ground.height(bx, by) > 1) m.solid({ x: bx, y: by, base: ground.height(bx, by) - 0.5, w: 60, d: 14, h: 5 + hash(s, cranes.length) * 9, turn: a + Math.PI / 2, color: [C(0.6, 0.2, 0.15), C(0.2, 0.35, 0.5), C(0.7, 0.55, 0.2), C(0.3, 0.45, 0.35)][(s + cranes.length) % 4] });
          }
          n++;
          break;
        }
      }
    });
    counts.cranes = cranes.length;
  }

  // ---- the Vincent Thomas Bridge ----------------------------------------------------------------------
  {
    const [bx, by] = at(BRIDGE.lat, BRIDGE.lon);
    m.next();
    suspensionBridge(m, bx, by, (68 * Math.PI) / 180, (x, y) => Math.max(0, ground.height(x, y)), lights);
  }

  const group = new THREE.Group();
  group.name = 'long_beach';
  const mesh = m.build('long_beach_mesh');
  group.add(mesh);
  group.add(beacons(lights, 2.2, 'long_beach_lights'));
  const detail: Detail[] = [{ object: mesh, x: 10500, y: 22000, far: 30000 }];

  // ---- the marinas: yachts in their slips ----------------------------------------------------------------
  let yachts = 0;
  const marina = (name: string, lat: number, lon: number, reach: number, want: number, turn: number) => {
    const [cx, cy] = at(lat, lon);
    const fleet: Array<{ x: number; y: number; len: number; turn: number; color: THREE.Color }> = [];
    // Slips in rows either side of a walkway: boats seven metres apart along it, bows in from both sides.
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    for (let j = -14; j <= 14 && fleet.length < want; j++) for (let i = -40; i <= 40 && fleet.length < want; i++) {
      const u = i * 6.4;
      const v = j * 34 + (Math.abs(i) % 2 ? 7 : -7);
      const x = cx + cs * u - sn * v;
      const y = cy + sn * u + cs * v;
      if (Math.hypot(u, v) > reach || ground.height(x, y) > -0.5 || ground.depth(x, y) < 1.2) continue;
      // In a marina the boats lie close under the land.
      let shelter = 0;
      for (let k = 0; k < 8; k++) if (ground.height(x + Math.cos(k * 0.785) * 170, y + Math.sin(k * 0.785) * 170) > 0.5) shelter++;
      if (shelter < 3 || hash(i, j) < 0.2) continue;
      if (keepClear.some(([kx, ky, kr]) => Math.hypot(x - kx, y - ky) < kr)) continue;
      fleet.push({ x, y, len: 9 + hash(i * 3, j) * 6, turn: turn + Math.PI / 2 + (Math.abs(i) % 2 ? Math.PI : 0), color: hash(i, j * 5) < 0.82 ? C(0.93, 0.93, 0.9) : C(0.14, 0.22, 0.36) });
    }
    if (!fleet.length) return;
    const g = mooredFleet(fleet, name);
    group.add(g);
    detail.push({ object: g, x: cx, y: cy, far: 6500 });
    yachts += fleet.length;
  };
  marina('shoreline_marina', SHORELINE.lat + 0.0012, SHORELINE.lon + 0.0005, 380, 150, 0.14);
  marina('alamitos_bay', ALAMITOS.lat, ALAMITOS.lon, 520, 170, 0.5);
  counts.yachts = yachts;
  return { group, triangles: m.triangles, detail, counts };
}
