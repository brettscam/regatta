import * as THREE from 'three';
import { Massing, WIN } from './massing';
import { SHAPE, type Light } from './shoreside';
import { inRing, type TownPlan, type TownRing } from './town';

// Draws a town's ground exactly as `scene/town.ts` plans it: every ring of the layout is a slab with its top at the
// ring's height, so where the layout says there is ground to walk on there is ground on the screen. With it go the
// things that belong to the ground: sea walls, piles and rails, lamp posts, benches, tables under sunshades, a
// counter to stand at, the fountain. Everything is at the scale of a person 1.7 m tall.

type P3 = [number, number, number];
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const PAVING = C(0.6, 0.52, 0.41);
const KERB = C(0.6, 0.57, 0.5);
const WALL = C(0.55, 0.52, 0.47);
const ASPHALT = C(0.45, 0.44, 0.43);
const DIRT = C(0.64, 0.55, 0.4);
const PLANK = C(0.36, 0.27, 0.18);
const PILE = C(0.24, 0.21, 0.18);
const FLOAT = C(0.62, 0.6, 0.55);
const TILE = C(0.72, 0.62, 0.5);
const WHITE = C(0.93, 0.92, 0.88);
const WARM = C(1, 0.76, 0.45);
const WOOD = C(0.42, 0.31, 0.2);
const SHADES = [C(0.88, 0.16, 0.12), C(0.1, 0.45, 0.75), C(0.95, 0.75, 0.12), C(0.93, 0.93, 0.9), C(0.12, 0.55, 0.4)];

const SURFACE: Record<TownRing['kind'], THREE.Color> = { promenade: PAVING, quay: C(0.66, 0.65, 0.61), street: ASPHALT, path: DIRT, pier: PLANK, float: FLOAT, round: TILE };

/**
 * @param ground height of the land as drawn, metres (below zero over water)
 * @param lights lamps to show across the water after dark are added to this
 */
export function drawTown(m: Massing, plan: TownPlan, ground: (x: number, y: number) => number, lights: Light[]): void {
  const { spec, rings } = plan;
  const paint = (id: string): THREE.Color => {
    const p = spec.paths.find((q) => q.id === id)?.paint;
    return p ? new THREE.Color(p) : WHITE;
  };
  /** True if a point is on some other piece of ground at about this height: no rail or wall is wanted there. */
  const joined = (self: TownRing, x: number, y: number): boolean => rings.some((r) => r !== self && Math.abs(r.z - self.z) < 0.6 && inRing(r.ring, x, y));

  rings.forEach((r) => {
    m.next();
    const ring = r.ring;
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const top = SURFACE[r.kind];
    const inside: P3 = [cx, cy, r.z - 2];
    const at = (k: number, z: number): P3 => [ring[k % ring.length][0], ring[k % ring.length][1], z];
    m.quad(at(0, r.z), at(1, r.z), at(2, r.z), at(3, r.z), top, inside);
    // What holds it up: a wall to the sea bed for the front and the mole, the thickness of its planks for a pier or a float.
    const thin = r.kind === 'pier' ? 0.45 : r.kind === 'float' ? 0.75 : 0;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const out = Math.hypot(mx - cx, my - cy) || 1;
      // Where another piece at the same level carries on past this edge there is no wall: the ground is continuous.
      if (joined(r, mx + ((mx - cx) / out) * 0.4, my + ((my - cy) / out) * 0.4)) continue;
      const low = thin ? r.z - thin : Math.min(ground(a[0], a[1]), ground(b[0], b[1]), 0) - (r.kind === 'street' || r.kind === 'path' ? 0.6 : 2.5);
      const side = r.kind === 'pier' ? PLANK.clone().multiplyScalar(0.7) : r.kind === 'float' ? FLOAT.clone().multiplyScalar(0.75) : r.kind === 'street' || r.kind === 'path' ? KERB : WALL;
      m.quad([a[0], a[1], low], [b[0], b[1], low], [b[0], b[1], r.z], [a[0], a[1], r.z], side, inside);
    }
    if (!r.a || !r.b) return;
    const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    if (len < 1) return;
    const ux = (r.b[0] - r.a[0]) / len;
    const uy = (r.b[1] - r.a[1]) / len;
    const h = r.width / 2;
    const P = (s: number, off: number, z: number): P3 => [r.a![0] + ux * s + uy * off, r.a![1] + uy * s - ux * off, z];
    if (r.kind === 'pier') {
      const col = paint(r.path);
      // Piles in pairs, and a rail down each side at the height of a hand.
      for (let s = 2; s < len; s += 7) for (const sgn of [-1, 1]) {
        const p = P(s, sgn * (h - 0.4), 0);
        const bed = Math.min(-2.5, ground(p[0], p[1]));
        if (ground(p[0], p[1]) < r.z - 0.6) m.beam([p[0], p[1], bed], [p[0], p[1], r.z - 0.4], 0.38, 0.38, PILE);
      }
      for (const sgn of [-1, 1]) {
        let run: number | null = null;
        for (let s = 0; s <= len + 0.01; s += 2.4) {
          const p = P(Math.min(s, len), sgn * (h - 0.12), r.z);
          const open = joined(r, p[0] + uy * sgn * 0.6, p[1] - ux * sgn * 0.6) || rings.some((q) => q.kind === 'float' && inRing(q.ring, p[0] + uy * sgn * 1.2, p[1] - ux * sgn * 1.2));
          if (open) { if (run !== null) m.beam(P(run, sgn * (h - 0.12), r.z + 1.05), P(s - 2.4, sgn * (h - 0.12), r.z + 1.05), 0.1, 0.1, col); run = null; continue; }
          if (run === null) run = Math.min(s, len);
          m.beam(p, [p[0], p[1], r.z + 1.05], 0.1, 0.1, col);
        }
        if (run !== null) m.beam(P(run, sgn * (h - 0.12), r.z + 1.05), P(len, sgn * (h - 0.12), r.z + 1.05), 0.1, 0.1, col);
      }
      // Lamps down the middle of one side.
      for (let s = 9; s < len; s += 22) {
        const p = P(s, h - 0.3, r.z);
        m.beam(p, [p[0], p[1], r.z + 3.6], 0.12, 0.12, col);
        m.solid({ x: p[0], y: p[1], base: r.z + 3.6, w: 0.34, h: 0.34, color: WARM, win: WIN.lamp });
        lights.push({ p: [p[0], p[1], r.z + 3.8], a: WARM, b: WARM, shape: SHAPE.glow, size: 1.3, min: 2.6 });
      }
    } else if (r.kind === 'float') {
      for (let s = 1.5; s < len; s += 6) for (const sgn of [-1, 1]) {
        const p = P(s, sgn * (h + 0.25), -2.5);
        m.beam(p, [p[0], p[1], 2.2], 0.3, 0.3, PILE);
      }
    } else if (r.kind === 'promenade' || r.kind === 'quay') {
      // A rail wherever the edge stands over the water, and lamp posts along the side away from it.
      for (const sgn of [-1, 1]) {
        const mid = P(len / 2, sgn * (h + 1.5), 0);
        const wet = ground(mid[0], mid[1]) < 0 && !joined(r, mid[0], mid[1]);
        if (wet) {
          m.beam(P(0, sgn * (h - 0.15), r.z + 1), P(len, sgn * (h - 0.15), r.z + 1), 0.09, 0.09, WHITE);
          for (let s = 0; s <= len + 0.01; s += 2.6) { const p = P(Math.min(s, len), sgn * (h - 0.15), r.z); m.beam(p, [p[0], p[1], r.z + 1], 0.08, 0.08, WHITE); }
        } else if (r.kind === 'promenade') {
          for (let s = 6; s < len; s += 26) {
            const p = P(s, sgn * (h - 0.5), r.z);
            m.beam(p, [p[0], p[1], r.z + 4.2], 0.14, 0.14, PILE);
            m.solid({ x: p[0], y: p[1], base: r.z + 4.2, w: 0.42, h: 0.42, color: WARM, win: WIN.lamp });
            lights.push({ p: [p[0], p[1], r.z + 4.4], a: WARM, b: WARM, shape: SHAPE.glow, size: 1.5, min: 3 });
          }
        }
      }
    }
  });

  // ---- what stands on the ground at the named spots ------------------------------------------------------
  const heights = rings.map((r) => r.z);
  const floorAt = (x: number, y: number): number => {
    let best = spec.floor;
    let found = false;
    rings.forEach((r, i) => { if (inRing(r.ring, x, y) && (!found || heights[i] > best)) { best = heights[i]; found = true; } });
    return best;
  };
  spec.spots.forEach((s, i) => {
    const z = floorAt(s.x, s.y);
    const f = (s.face * Math.PI) / 180;
    // The builder's turn runs counter-clockwise from east; a compass bearing runs clockwise from north.
    const turn = Math.PI / 2 - f;
    const fx = Math.sin(f);
    const fy = Math.cos(f);
    if (s.kind === 'table') {
      m.beam([s.x, s.y, z], [s.x, s.y, z + 0.72], 0.1, 0.1, PILE);
      m.solid({ x: s.x, y: s.y, base: z + 0.7, w: 0.95, h: 0.05, color: WHITE });
      m.beam([s.x, s.y, z + 0.72], [s.x, s.y, z + 2.5], 0.06, 0.06, PILE);
      m.lathe(s.x, s.y, z + 2.1, [[1.6, 0], [0.08, 0.62]], 8, SHADES[i % SHADES.length]);
    } else if (s.kind === 'seat') {
      m.solid({ x: s.x, y: s.y, base: z, w: 0.42, h: 0.45, color: WOOD });
      m.solid({ x: s.x - fx * 0.22, y: s.y - fy * 0.22, base: z + 0.45, w: 0.42, d: 0.06, h: 0.42, turn, color: WOOD });
    } else if (s.kind === 'bench') {
      m.solid({ x: s.x, y: s.y, base: z + 0.38, w: 1.8, d: 0.5, h: 0.08, turn: turn + Math.PI / 2, color: WOOD });
      m.solid({ x: s.x - fx * 0.27, y: s.y - fy * 0.27, base: z + 0.46, w: 1.8, d: 0.07, h: 0.45, turn: turn + Math.PI / 2, color: WOOD });
      for (const e of [-0.8, 0.8]) m.solid({ x: s.x + fy * e, y: s.y - fx * e, base: z, w: 0.08, d: 0.46, h: 0.4, turn: turn + Math.PI / 2, color: PILE });
    } else if (s.kind === 'bar' && s.name.endsWith('-2')) {
      // The counter the three bar spots stand at, a metre high, with its lamps.
      m.solid({ x: s.x + fx * 0.75, y: s.y + fy * 0.75, base: z, w: 4.6, d: 0.6, h: 1.08, turn: turn + Math.PI / 2, color: WOOD, roof: C(0.7, 0.6, 0.45) });
      for (const e of [-1.6, 0, 1.6]) {
        m.solid({ x: s.x + fx * 0.75 + fy * e, y: s.y + fy * 0.75 - fx * e, base: z + 2.3, w: 0.24, h: 0.24, color: WARM, win: WIN.lamp });
      }
      lights.push({ p: [s.x + fx * 0.75, s.y + fy * 0.75, z + 2.4], a: WARM, b: WARM, shape: SHAPE.glow, size: 4, min: 4 });
    } else if (s.name === 'fountain') {
      // The fountain stands in front of whoever has stopped to look at it: a tiled basin and a bowl on a stem.
      const qx = s.x + fx * 2.9;
      const qy = s.y + fy * 2.9;
      m.lathe(qx, qy, z, [[1.5, 0], [1.5, 0.55], [1.3, 0.55], [1.3, 0.3], [0.22, 0.3], [0.22, 1.5], [0.7, 1.6], [0.7, 1.72], [0.08, 1.8]], 12, C(0.3, 0.55, 0.62));
      m.lathe(qx, qy, z + 0.42, [[1.28, 0], [0.1, 0.02]], 12, C(0.55, 0.8, 0.85));
    }
  });
}
