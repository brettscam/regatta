import * as THREE from 'three';
import { Massing, WIN, onCityNight } from './massing';
import { SHAPE, beacons, type Light } from './shoreside';
import { palm } from './structures';
import { hash, smoothNoise } from './terrain';
import { inRing, type TownPlan } from './town';
import { drawTown } from './townDraw';
import { mooredFleet } from './yacht';
import type { Built, Detail, SceneGround } from './longBeach';

// Santa Catalina Island as it is seen from the water: Avalon under its round white Casino, the green pier, the
// houses stacked up the canyon, the mooring field in rows; the handful of buildings and the palms at Two Harbors;
// yachts on the moorings of the coves; dark trees in the canyons of dry hills.
// The towns' ground is drawn from their plans (`scene/town.ts`, `townDraw.ts`). What stands round it is placed here,
// in course metres, fitted by hand to the baked land (whose shoreline at 40 m is not the real one's), from general
// knowledge of the place. The Casino, the pier, the mole and the chimes tower are where they are in relation to
// each other; nothing here is surveyed.

type P3 = [number, number, number];
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const WHITE = C(0.94, 0.93, 0.89);
const WARM = C(1, 0.78, 0.48);
const TILE_RED = C(0.66, 0.24, 0.15);
const PIER_GREEN = C(0.18, 0.49, 0.31);
const UP = new THREE.Vector3(0, 1, 0);

/** The middle of the Casino, on its point. The town file's walk round it has the same centre. */
const CASINO: [number, number] = [-2330, -22352];

/** The round white Casino with its red roof: twelve storeys of it, the mark of the island. */
function casino(m: Massing, lights: Light[], terrace: number): void {
  const [x, y] = CASINO;
  const r = 27;
  m.next();
  // The rock and masonry it stands on, down into the sea, then the drum.
  m.lathe(x, y, -4, [[r + 10, 0], [r + 8.5, 4 + terrace - 0.6]], 28, C(0.6, 0.57, 0.5));
  m.lathe(x, y, terrace - 0.6, [[r + 0.6, 0], [r + 0.6, 6]], 32, WHITE, WIN.fins);
  m.lathe(x, y, terrace + 5.4, [[r, 0], [r, 15]], 32, WHITE, WIN.floodlit);
  // The ballroom's open balcony, all the way round under the eaves: a ring of columns against shadow.
  m.lathe(x, y, terrace + 20.4, [[r + 1.6, 0], [r + 1.6, 0.9]], 32, WHITE);
  m.lathe(x, y, terrace + 21.3, [[r - 0.4, 0], [r - 0.4, 6.4]], 32, C(0.8, 0.76, 0.68), WIN.fins);
  m.lathe(x, y, terrace + 27.7, [[r + 2.2, 0], [r + 1.2, 1.1], [r * 0.46, 8.2], [5, 10.2], [3.2, 12.6], [0.3, 14.6]], 32, TILE_RED);
  m.beam([x, y, terrace + 42], [x, y, terrace + 49], 0.3, 0.3, WHITE);
  lights.push({ p: [x, y, terrace + 16], a: C(1, 0.95, 0.85), b: WARM, shape: SHAPE.glow, size: 70, min: 10 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    lights.push({ p: [x + Math.cos(a) * (r + 1.8), y + Math.sin(a) * (r + 1.8), terrace + 24], a: WARM, b: WARM, shape: SHAPE.glow, size: 2.4, min: 2.4 });
  }
}

/** A house with walls, windows and a low pitched roof. */
function house(m: Massing, x: number, y: number, base: number, w: number, d: number, h: number, turn: number, wall: THREE.Color, roof: THREE.Color, win: number = WIN.homes): void {
  m.next();
  m.hall(x, y, base, w, d, h, Math.min(2.6, d * 0.2), turn, wall, roof, win);
}

interface Row { x: number; y: number; len: number; turn: number; color: THREE.Color }

/**
 * Yachts on moorings in rows, as an island harbor packs them: bow and stern to a pair of buoys, every boat lying
 * the same way, a boat's length between rows. Only where there is water of a mooring's depth, and never where `clear` says not.
 * @param bearing the way the boats point, compass radians: out toward the mouth of the bay
 */
function mooringRows(out: Row[], g: SceneGround, cx: number, cy: number, bearing: number, across: number, along: number, nu: number, nv: number, seed: number, keep: (x: number, y: number) => boolean): void {
  const fx = Math.sin(bearing);
  const fy = Math.cos(bearing);
  for (let j = -nv; j <= nv; j++) for (let i = -nu; i <= nu; i++) {
    const u = i * across + (j % 2 ? across / 2 : 0);
    const v = j * along;
    const x = cx + fy * u + fx * v;
    const y = cy - fx * u + fy * v;
    const d = g.depth(x, y);
    if (g.height(x, y) > -0.5 || d < 2.4 || d > 38 || !keep(x, y)) continue;
    // A few buoys are always empty.
    if (hash(i + seed, j - seed) < 0.12) continue;
    const t = hash(i * 7 + seed, j * 3);
    out.push({ x, y, len: 9.5 + hash(i - seed, j * 11) * 7, turn: Math.PI / 2 - bearing + (hash(i, j + seed) - 0.5) * 0.08, color: t < 0.74 ? C(0.93, 0.93, 0.9) : t < 0.88 ? C(0.14, 0.22, 0.36) : t < 0.94 ? C(0.5, 0.12, 0.1) : C(0.88, 0.85, 0.74) });
  }
}

/**
 * @param plans the towns of this water, already planned on this ground
 * @param places where a boat stops (`places.json`): the moorings keep a little clear of each, so the player's own buoy is free
 */
export function buildCatalina(ground: SceneGround, plans: readonly TownPlan[], places: ReadonlyArray<{ x: number; y: number; kind?: string }>): Built {
  const group = new THREE.Group();
  group.name = 'catalina';
  const detail: Detail[] = [];
  const counts: Record<string, number> = {};
  let triangles = 0;
  const footing = (x: number, y: number, r: number) => Math.min(ground.height(x - r, y - r), ground.height(x + r, y - r), ground.height(x - r, y + r), ground.height(x + r, y + r), ground.height(x, y));
  const summit = (x: number, y: number, r: number): [number, number] => {
    let best: [number, number] = [x, y];
    let top = ground.height(x, y);
    for (let dy = -r; dy <= r; dy += 20) for (let dx = -r; dx <= r; dx += 20) {
      const z = ground.height(x + dx, y + dy);
      if (z > top) { top = z; best = [x + dx, y + dy]; }
    }
    return best;
  };
  const onGround = (plan: TownPlan, x: number, y: number, margin = 0): boolean => plan.rings.some((r) => {
    if (inRing(r.ring, x, y)) return true;
    if (!margin) return false;
    for (let k = 0; k < 8; k++) if (inRing(r.ring, x + Math.cos(k * 0.785) * margin, y + Math.sin(k * 0.785) * margin)) return true;
    return false;
  });
  const free = (x: number, y: number) => !places.some((p) => Math.hypot(p.x - x, p.y - y) < (p.kind === 'dock' ? 60 : 42));
  const pastel = [C(0.95, 0.93, 0.86), C(0.93, 0.8, 0.6), C(0.72, 0.84, 0.86), C(0.94, 0.7, 0.62), C(0.86, 0.88, 0.7), C(0.92, 0.92, 0.94), C(0.98, 0.9, 0.7)];
  const roofs = [TILE_RED, TILE_RED, C(0.9, 0.9, 0.87), C(0.45, 0.3, 0.24), C(0.32, 0.42, 0.4)];
  const awnings = [C(0.75, 0.15, 0.12), C(0.12, 0.35, 0.6), C(0.15, 0.5, 0.35), C(0.9, 0.7, 0.15), C(0.9, 0.9, 0.88)];

  // ================================================================ Avalon
  const avalon = plans.find((p) => p.spec.id === 'avalon');
  if (avalon) {
    const m = new Massing();
    const lights: Light[] = [];
    const floor = avalon.spec.floor;
    drawTown(m, avalon, ground.height, lights);
    const terrace = avalon.spec.paths.find((p) => p.id === 'casino-walk')?.floor ?? 6;
    casino(m, lights, terrace);

    // Crescent Avenue: a row of two and three storey fronts along the land side of the promenade, each with its awning.
    let fronts = 0;
    const along = (id: string, gap: number, deep: [number, number], tall: [number, number], back: number, awning: boolean) => {
      const path = avalon.spec.paths.find((p) => p.id === id);
      const pts = path?.points;
      if (!path || !pts) return;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        for (const side of id === 'crescent' || id === 'mole-road' ? [0] : [-1, 1]) {
          // The land side: the side whose ground is higher a little way off.
          let nx = uy;
          let ny = -ux;
          if (side === 0) {
            if (ground.height(ax + ux * len * 0.5 + nx * 30, ay + uy * len * 0.5 + ny * 30) < ground.height(ax + ux * len * 0.5 - nx * 30, ay + uy * len * 0.5 - ny * 30)) { nx = -nx; ny = -ny; }
          } else { nx *= side; ny *= side; }
          for (let s = gap * 0.6; s < len - gap * 0.3; s += gap) {
            const k = fronts * 13 + i * 101 + (side + 1) * 7;
            const w = gap - 1.2 - hash(k, 1) * 2;
            const d = deep[0] + hash(k, 2) * (deep[1] - deep[0]);
            const h = tall[0] + hash(k, 3) * (tall[1] - tall[0]);
            const off = path.width / 2 + back + d / 2;
            const x = ax + ux * s + nx * off;
            const y = ay + uy * s + ny * off;
            if (onGround(avalon, x, y, d * 0.45) || ground.height(x + nx * d * 0.4, y + ny * d * 0.4) < 0.2) continue;
            // It stands on the ground behind the front, its foot sunk so no gap shows on the downhill side, and never below the pavement.
            const low = Math.max(floor - 0.3, footing(x, y, d * 0.4) - 0.4);
            const high = Math.max(ground.height(x, y), low);
            if (high - low > 9) continue;
            const turn = Math.atan2(uy, ux);
            m.next();
            const wall = pastel[Math.floor(hash(k, 4) * pastel.length)];
            const flat = hash(k, 5) < 0.45;
            if (flat) m.solid({ x, y, base: low, w, d, h: high - low + h, turn, color: wall, win: WIN.homes, roof: C(0.7, 0.66, 0.6) });
            else m.hall(x, y, low, w, d, high - low + h - 1.6, 2, turn, wall, roofs[Math.floor(hash(k, 6) * roofs.length)], WIN.homes);
            if (awning) {
              // A striped awning over the pavement, at the height of a shop front.
              const col = awnings[Math.floor(hash(k, 7) * awnings.length)];
              const fx = x - nx * (d / 2);
              const fy = y - ny * (d / 2);
              const a: P3 = [fx - ux * w * 0.46, fy - uy * w * 0.46, low + 3.4];
              const b: P3 = [fx + ux * w * 0.46, fy + uy * w * 0.46, low + 3.4];
              const c: P3 = [b[0] - nx * 2.2, b[1] - ny * 2.2, low + 2.6];
              const e: P3 = [a[0] - nx * 2.2, a[1] - ny * 2.2, low + 2.6];
              m.quad(e, c, b, a, col, [fx, fy, low]);
              lights.push({ p: [fx - nx * 1.2, fy - ny * 1.2, low + 2.4], a: WARM, b: WARM, shape: SHAPE.glow, size: 3.2, min: 3 });
            }
            fronts++;
          }
        }
      }
    };
    along('crescent', 13, [10, 14], [7, 11], 1.2, true);
    along('mole-road', 14, [9, 11], [6, 9], 1.5, true);
    along('sumner', 12, [8, 11], [5.5, 9], 1.5, false);
    along('catalina-avenue', 12, [8, 11], [5.5, 9], 1.5, false);
    counts.avalonFronts = fronts;

    // Palms down the sea side of Crescent Avenue and round the head of the bay.
    {
      let n = 0;
      for (const id of ['crescent', 'mole-road', 'casino-way']) {
        const path = avalon.spec.paths.find((p) => p.id === id);
        const pts = path?.points ?? [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[i + 1];
          const len = Math.hypot(bx - ax, by - ay);
          const ux = (bx - ax) / len;
          const uy = (by - ay) / len;
          let nx = uy;
          let ny = -ux;
          // Toward the water this time.
          if (ground.height(ax + ux * len * 0.5 + nx * 30, ay + uy * len * 0.5 + ny * 30) > ground.height(ax + ux * len * 0.5 - nx * 30, ay + uy * len * 0.5 - ny * 30)) { nx = -nx; ny = -ny; }
          for (let s = 5; s < len; s += id === 'casino-way' ? 28 : 15) {
            palm(m, ax + ux * s + nx * (path!.width / 2 - 1), ay + uy * s + ny * (path!.width / 2 - 1), floor, 11 + hash(n, 3) * 5, 300 + n);
            n++;
          }
        }
      }
      counts.avalonPalms = n;
    }

    // The clubs on piles over the water along Casino Way: white boards, green trim.
    {
      const way = avalon.spec.paths.find((p) => p.id === 'casino-way')?.points ?? [];
      for (const [i, t, w] of [[3, 0.35, 20], [4, 0.3, 16], [4, 0.85, 14]] as const) {
        if (!way[i + 1]) continue;
        const [ax, ay] = way[i];
        const [bx, by] = way[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        let nx = uy;
        let ny = -ux;
        if (ground.height(ax + nx * 30, ay + ny * 30) > ground.height(ax - nx * 30, ay - ny * 30)) { nx = -nx; ny = -ny; }
        const x = ax + (bx - ax) * t + nx * 15;
        const y = ay + (by - ay) * t + ny * 15;
        if (ground.height(x, y) > 0) continue;
        const turn = Math.atan2(uy, ux);
        m.next();
        m.solid({ x, y, base: floor - 0.4, w: w + 4, d: 16, h: 0.4, turn, color: C(0.5, 0.42, 0.31) });
        m.hall(x, y, floor, w, 11, 4.6, 2.4, turn, WHITE, PIER_GREEN, WIN.homes);
        m.beam([x - nx * 8, y - ny * 8, floor - 0.2], [x - nx * 12.5, y - ny * 12.5, floor - 0.2], 2.4, 0.3, C(0.5, 0.42, 0.31));
        for (const du of [-w / 2, 0, w / 2]) for (const dv of [-6, 6]) m.beam([x + ux * du + nx * dv, y + uy * du + ny * dv, -3], [x + ux * du + nx * dv, y + uy * du + ny * dv, floor - 0.4], 0.4, 0.4, C(0.24, 0.21, 0.18));
        m.beam([x + nx * 8, y + ny * 8, floor], [x + nx * 8, y + ny * 8, floor + 9], 0.2, 0.2, WHITE);
        lights.push({ p: [x, y, floor + 3], a: WARM, b: WARM, shape: SHAPE.glow, size: 9, min: 4 });
      }
    }

    // On the green pier: sheds down one side on their own piles, and the harbor office at the end.
    {
      const pier = avalon.spec.paths.find((p) => p.id === 'pier');
      const pts = pier?.points;
      if (pier && pts) {
        const [ax, ay] = pts[0];
        const [bx, by] = pts[1];
        const len = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        const turn = Math.atan2(uy, ux);
        // The side away from the dinghy float.
        const sx = -uy;
        const sy = ux;
        for (const [s, w] of [[26, 16], [48, 13], [100, 13]] as const) {
          const x = ax + ux * s + sx * (pier.width / 2 + 4.2);
          const y = ay + uy * s + sy * (pier.width / 2 + 4.2);
          m.next();
          m.solid({ x, y, base: floor - 0.45, w: w + 2, d: 8.4, h: 0.45, turn, color: C(0.5, 0.42, 0.31) });
          m.hall(x, y, floor, w, 6.6, 3.2, 1.7, turn, s > 90 ? WHITE : PIER_GREEN, s > 90 ? PIER_GREEN : C(0.3, 0.36, 0.32), WIN.homes);
          for (const du of [-w / 2, w / 2]) m.beam([x + ux * du + sx * 3.6, y + uy * du + sy * 3.6, -3], [x + ux * du + sx * 3.6, y + uy * du + sy * 3.6, floor - 0.45], 0.38, 0.38, C(0.24, 0.21, 0.18));
          lights.push({ p: [x, y, floor + 3], a: WARM, b: WARM, shape: SHAPE.glow, size: 5, min: 3.4 });
        }
        // A flagstaff at the very end.
        m.beam([bx - ux * 1.5, by - uy * 1.5, floor], [bx - ux * 1.5, by - uy * 1.5, floor + 11], 0.2, 0.2, WHITE);
      }
    }
    // The mole: a long open-sided shelter where the passengers wait, and a ticket office.
    {
      const mole = avalon.spec.paths.find((p) => p.id === 'mole')?.points;
      if (mole) {
        const [ax, ay] = mole[0];
        const [bx, by] = mole[1];
        const len = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        const turn = Math.atan2(uy, ux);
        const x = ax + ux * len * 0.5 + uy * 3;
        const y = ay + uy * len * 0.5 - ux * 3;
        m.next();
        m.gable(x, y, floor + 3.6, 44, 9, 1.8, turn, C(0.5, 0.3, 0.22));
        for (let k = -3; k <= 3; k++) for (const dv of [-3.6, 3.6]) m.beam([x + ux * k * 7 + uy * dv, y + uy * k * 7 - ux * dv, floor], [x + ux * k * 7 + uy * dv, y + uy * k * 7 - ux * dv, floor + 3.6], 0.26, 0.26, WHITE);
        m.hall(ax + ux * 14 + uy * 3, ay + uy * 14 - ux * 3, floor, 9, 6, 3, 1.4, turn, WHITE, C(0.5, 0.3, 0.22), WIN.homes);
        for (let k = -2; k <= 2; k++) lights.push({ p: [x + ux * k * 9, y + uy * k * 9, floor + 3.4], a: WARM, b: WARM, shape: SHAPE.glow, size: 2.6, min: 3 });
      }
    }
    // The landmarks on the ridges: the chimes tower above Casino Way, the house with the cone on the east hill, the big white house beyond it.
    {
      const [cx, cy] = summit(-2640, -22640, 60);
      const cz = ground.height(cx, cy);
      m.next();
      m.solid({ x: cx, y: cy, base: cz - 1, w: 5.5, h: 19, color: WHITE, win: WIN.floodlit });
      m.solid({ x: cx, y: cy, base: cz + 18, w: 6.6, h: 4.6, color: WHITE, win: WIN.fins });
      m.solid({ x: cx, y: cy, base: cz + 22.6, w: 7.4, h: 3.4, color: TILE_RED, top: 0.08 });
      lights.push({ p: [cx, cy, cz + 20], a: WARM, b: WARM, shape: SHAPE.glow, size: 6, min: 4 });
      // A flat-roofed adobe house in the pueblo style beside it.
      const pz = ground.height(cx - 60, cy + 40);
      if (pz > 5) m.solid({ x: cx - 60, y: cy + 40, base: footing(cx - 60, cy + 40, 10) - 0.5, w: 30, d: 14, h: 7 + pz - footing(cx - 60, cy + 40, 10), turn: 0.4, color: C(0.82, 0.68, 0.52), win: WIN.homes });

      const [hx, hy] = summit(-2040, -22990, 50);
      const hz = ground.height(hx, hy);
      m.next();
      m.hall(hx, hy, footing(hx, hy, 7) - 0.5, 13, 11, 6 + hz - footing(hx, hy, 7), 2.4, 0.5, WHITE, C(0.4, 0.3, 0.26), WIN.homes);
      m.solid({ x: hx + 4, y: hy + 3, base: hz + 5, w: 6, h: 5, sides: 8, color: WHITE, win: WIN.fins });
      m.lathe(hx + 4, hy + 3, hz + 10, [[3.8, 0], [0.2, 5]], 8, C(0.3, 0.3, 0.33));
      lights.push({ p: [hx, hy, hz + 6], a: WARM, b: WARM, shape: SHAPE.glow, size: 6, min: 3.6 });

      const [wx, wy] = summit(-1900, -23260, 70);
      const wz = ground.height(wx, wy);
      m.next();
      m.hall(wx, wy, footing(wx, wy, 12) - 0.5, 34, 15, 8 + wz - footing(wx, wy, 12), 3.4, 0.7, WHITE, C(0.42, 0.42, 0.44), WIN.homes);
      lights.push({ p: [wx, wy, wz + 6], a: WARM, b: WARM, shape: SHAPE.glow, size: 8, min: 3.6 });
    }
    // The dive park: a ring of white buoys with an orange band, on the water off the point.
    {
      let n = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = -2230 + Math.cos(a) * 128;
        const y = -22300 + Math.sin(a) * 128;
        if (ground.height(x, y) > -1 || ground.depth(x, y) < 2) continue;
        m.lathe(x, y, -0.3, [[0.45, 0], [0.75, 0.5], [0.75, 0.75]], 8, WHITE);
        m.lathe(x, y, 0.45, [[0.76, 0], [0.76, 0.3], [0.2, 0.95]], 8, C(0.95, 0.45, 0.1));
        n++;
      }
      counts.diveBuoys = n;
    }
    const mesh = m.build('avalon_mesh');
    triangles += m.triangles;
    counts.avalonTriangles = m.triangles;
    group.add(mesh);
    detail.push({ object: mesh, x: -2300, y: -22800, far: 16000 });
    const lamps = beacons(lights, 1.6, 'avalon_lights');
    group.add(lamps);
    detail.push({ object: lamps, x: -2300, y: -22800, far: 26000 });

    // The houses stacked up the canyon and both hillsides: one instanced mesh of walls and one of roofs.
    {
      const spots: Array<{ x: number; y: number; z: number; w: number; d: number; h: number; turn: number; k: number }> = [];
      for (let j = 0; j < 46; j++) for (let i = 0; i < 38; i++) {
        const x = -2930 + (i + hash(i, j) * 0.8) * 28;
        const y = -23760 + (j + hash(j, i + 9) * 0.8) * 28;
        const z = ground.height(x, y);
        if (z < floor + 1.5 || z > 175) continue;
        const lo = footing(x, y, 6);
        if (lo < 0.5 || z - lo > 6.5) continue;
        // Thickest in the valley behind the beach, thinning as they climb and as they leave town.
        const reach = Math.hypot(x + 2330, (y + 23080) * 0.75);
        const keep = Math.min(1, Math.max(0, 1.3 - reach / 560)) * (z < 45 ? 1 : z < 100 ? 0.6 : 0.3);
        if (hash(i * 5 + 2, j * 3 + 1) > keep) continue;
        if (onGround(avalon, x, y, 9)) continue;
        const k = i * 97 + j;
        spots.push({ x, y, z: lo - 0.4, w: 8 + hash(k, 1) * 6, d: 7 + hash(k, 2) * 4, h: 3.4 + hash(k, 3) * 3.4 + (z - lo), turn: hash(k, 4) * 0.6 - 0.3 + Math.atan2(ground.height(x, y + 12) - ground.height(x, y - 12), ground.height(x + 12, y) - ground.height(x - 12, y)) + Math.PI / 2, k });
      }
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const walls = new THREE.InstancedMesh(box, wallMat, spots.length);
      const tops = new THREE.InstancedMesh(box, roofMat, spots.length);
      const mtx = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const c = new THREE.Color();
      spots.forEach((b, i) => {
        q.setFromAxisAngle(UP, b.turn);
        walls.setMatrixAt(i, mtx.compose(new THREE.Vector3(b.x, b.z, -b.y), q, new THREE.Vector3(b.w, b.h, b.d)));
        walls.setColorAt(i, c.copy(pastel[Math.floor(hash(b.k, 5) * pastel.length)]));
        tops.setMatrixAt(i, mtx.compose(new THREE.Vector3(b.x, b.z + b.h, -b.y), q, new THREE.Vector3(b.w + 1.1, 0.8, b.d + 1.1)));
        tops.setColorAt(i, c.copy(roofs[Math.floor(hash(b.k, 6) * roofs.length)]));
      });
      for (const mesh2 of [walls, tops]) {
        if (mesh2.instanceColor) mesh2.instanceColor.needsUpdate = true;
        mesh2.frustumCulled = false;
        group.add(mesh2);
        detail.push({ object: mesh2, x: -2330, y: -23080, far: 16000 });
      }
      walls.name = 'avalon_houses';
      tops.name = 'avalon_roofs';
      // Lamps in the windows after dark.
      onCityNight((n) => wallMat.emissive.setRGB(0.42 * n, 0.3 * n, 0.14 * n));
      counts.avalonHouses = spots.length;
      triangles += spots.length * 24;
    }

    // The mooring field: rows across the whole bay, bows to the north-east, with a fairway left down the middle to the pier.
    {
      const rows: Row[] = [];
      const pier = avalon.spec.paths.find((p) => p.id === 'pier')?.points;
      const end = pier ? pier[1] : [-2210, -22890];
      const mouth: [number, number] = [-2170, -22560];
      const inBay = (x: number, y: number): boolean => {
        // Inside the line from the Casino's point to the end of the mole.
        const [ax, ay, bx, by] = [-2262, -22392, -2050, -22752];
        if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) > 0) return false;
        // Clear of everything built, of the buoy the player picks up, and of the fairway.
        if (onGround(avalon, x, y, 24) || !free(x, y)) return false;
        const len2 = (mouth[0] - end[0]) ** 2 + (mouth[1] - end[1]) ** 2;
        const u = Math.max(0, Math.min(1.25, ((x - end[0]) * (mouth[0] - end[0]) + (y - end[1]) * (mouth[1] - end[1])) / len2));
        return Math.hypot(x - end[0] - (mouth[0] - end[0]) * u, y - end[1] - (mouth[1] - end[1]) * u) > 17;
      };
      mooringRows(rows, ground, -2270, -22700, (38 * Math.PI) / 180, 17, 31, 16, 10, 1, inBay);
      // Descanso Bay, round the point.
      mooringRows(rows, ground, -2440, -22190, (70 * Math.PI) / 180, 20, 34, 3, 2, 5, (x, y) => free(x, y) && !onGround(avalon, x, y, 20) && Math.hypot(x + 2230, y + 22300) > 150);
      // White's Landing, three miles up.
      mooringRows(rows, ground, -6330, -17420, (60 * Math.PI) / 180, 22, 36, 5, 2, 9, free);
      const fleet = mooredFleet(rows, 'avalon_moorings');
      group.add(fleet);
      detail.push({ object: fleet, x: -3500, y: -21000, far: 11000 });
      counts.avalonMoorings = rows.length;
      triangles += rows.length * 126;
    }
  }

  // ================================================================ Two Harbors
  const isthmus = plans.find((p) => p.spec.id === 'isthmus');
  if (isthmus) {
    const m = new Massing();
    const lights: Light[] = [];
    const floor = isthmus.spec.floor;
    drawTown(m, isthmus, ground.height, lights);
    const deck = isthmus.spec.paths.find((p) => p.id === 'bar-deck')?.points;
    const beach = isthmus.spec.paths.find((p) => p.id === 'beach')?.points ?? [];
    if (deck) {
      // The bar and restaurant at the head of the pier: a long low wooden building behind its deck, with a veranda.
      const [ax, ay] = deck[0];
      const [bx, by] = deck[1];
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      let nx = uy;
      let ny = -ux;
      if (ground.height((ax + bx) / 2 + nx * 30, (ay + by) / 2 + ny * 30) < ground.height((ax + bx) / 2 - nx * 30, (ay + by) / 2 - ny * 30)) { nx = -nx; ny = -ny; }
      const x = (ax + bx) / 2 + nx * 12.5;
      const y = (ay + by) / 2 + ny * 12.5;
      const turn = Math.atan2(uy, ux);
      const base = Math.max(0.5, footing(x, y, 7)) - 0.4;
      m.next();
      m.hall(x, y, base, 30, 10, 4.2 + ground.height(x, y) - base, 2.6, turn, C(0.5, 0.26, 0.2), C(0.3, 0.3, 0.32), WIN.homes);
      m.gable(x - nx * 6.6, y - ny * 6.6, ground.height(x, y) + 3.3, 30, 4, 0.8, turn, C(0.3, 0.3, 0.32));
      for (let k = -3; k <= 3; k++) m.beam([x - nx * 8.4 + ux * k * 4.8, y - ny * 8.4 + uy * k * 4.8, ground.height(x, y) - 0.5], [x - nx * 8.4 + ux * k * 4.8, y - ny * 8.4 + uy * k * 4.8, ground.height(x, y) + 3.3], 0.2, 0.2, WHITE);
      lights.push({ p: [x - nx * 7, y - ny * 7, ground.height(x, y) + 3], a: WARM, b: WARM, shape: SHAPE.glow, size: 16, min: 6 });
      for (let k = -3; k <= 3; k++) lights.push({ p: [(ax + bx) / 2 + ux * k * 4.4 - nx * 6.6, (ay + by) / 2 + uy * k * 4.4 - ny * 6.6, ground.height(x, y) + 3.2], a: C(1, 0.6, 0.3), b: WARM, shape: SHAPE.glow, size: 1.3, min: 2.6 });
      // The store, and a dozen cottages in rows up the valley.
      let n = 0;
      for (let k = 0; k < 90 && n < 16; k++) {
        const px = x + nx * (22 + hash(k, 1) * 190) + ux * (hash(k, 2) - 0.5) * 220;
        const py = y + ny * (22 + hash(k, 1) * 190) + uy * (hash(k, 2) - 0.5) * 220;
        const z = ground.height(px, py);
        if (z < floor + 0.6 || z > 22 || z - footing(px, py, 6) > 2.5 || onGround(isthmus, px, py, 9)) continue;
        house(m, px, py, footing(px, py, 6) - 0.4, n === 0 ? 16 : 8 + hash(k, 3) * 3, n === 0 ? 9 : 6.5, 3.2 + z - footing(px, py, 6), turn + (hash(k, 4) > 0.7 ? Math.PI / 2 : 0), n === 0 ? WHITE : pastel[k % pastel.length], n % 3 ? C(0.36, 0.36, 0.38) : TILE_RED);
        n++;
      }
      counts.isthmusHouses = n + 1;
    }
    // Palms along the back of the beach, tall ones: they are what is seen of Two Harbors from seaward.
    {
      let n = 0;
      for (let i = 0; i < beach.length - 1; i++) {
        const [ax, ay] = beach[i];
        const [bx, by] = beach[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        let nx = uy;
        let ny = -ux;
        if (ground.height(ax + nx * 30, ay + ny * 30) < ground.height(ax - nx * 30, ay - ny * 30)) { nx = -nx; ny = -ny; }
        for (let s = 3; s < len; s += 9) {
          const off = 6 + hash(n, 1) * 16;
          const x = ax + ux * s + nx * off;
          const y = ay + uy * s + ny * off;
          const z = ground.height(x, y);
          if (z > 0.8 && !onGround(isthmus, x, y, 2)) palm(m, x, y, z, 14 + hash(n, 2) * 7, 700 + n);
          n++;
        }
      }
      counts.isthmusPalms = n;
    }
    // Bird Rock, off the cove: low, flat and white with birds.
    m.next();
    m.lathe(-18675, -10750, -4, [[62, 0], [50, 5], [34, 8.5], [18, 10.5], [2, 11.2]], 11, C(0.5, 0.47, 0.42), WIN.none, 0.7, 0.5);
    m.lathe(-18675, -10750, 5.2, [[30, 0], [17, 1.6], [2, 2.2]], 11, C(0.9, 0.89, 0.85), WIN.none, 0.7, 0.5);
    const mesh = m.build('two_harbors_mesh');
    triangles += m.triangles;
    counts.isthmusTriangles = m.triangles;
    group.add(mesh);
    detail.push({ object: mesh, x: -18400, y: -12000, far: 12000 });
    const lamps = beacons(lights, 1.3, 'two_harbors_lights');
    group.add(lamps);
    detail.push({ object: lamps, x: -18400, y: -12000, far: 20000 });

    // Moorings: Isthmus Cove in rows, a few at anchor in Catalina Harbor, and Emerald Bay.
    const rows: Row[] = [];
    const pier = isthmus.spec.paths.find((p) => p.id === 'pier')?.points;
    const end = pier ? pier[1] : [-18290, -11975];
    const inCove = (x: number, y: number): boolean => {
      if (onGround(isthmus, x, y, 26) || !free(x, y)) return false;
      // The fairway out from the pier, where the shoreboat and the Catalina boat come and go.
      const out: [number, number] = [-18120, -11560];
      const len2 = (out[0] - end[0]) ** 2 + (out[1] - end[1]) ** 2;
      const u = Math.max(0, Math.min(1.3, ((x - end[0]) * (out[0] - end[0]) + (y - end[1]) * (out[1] - end[1])) / len2));
      return Math.hypot(x - end[0] - (out[0] - end[0]) * u, y - end[1] - (out[1] - end[1]) * u) > 30;
    };
    mooringRows(rows, ground, -18180, -11800, (25 * Math.PI) / 180, 26, 42, 10, 7, 3, (x, y) => inCove(x, y) && Math.hypot(x + 18180, y + 11800) < 400);
    mooringRows(rows, ground, -19080, -13250, (200 * Math.PI) / 180, 50, 66, 3, 5, 7, (x, y) => free(x, y) && hash(Math.round(x), Math.round(y)) > 0.6);
    mooringRows(rows, ground, -20830, -9230, (40 * Math.PI) / 180, 24, 38, 4, 2, 11, free);
    const fleet = mooredFleet(rows, 'isthmus_moorings');
    group.add(fleet);
    detail.push({ object: fleet, x: -19000, y: -11500, far: 11000 });
    counts.isthmusMoorings = rows.length;
    triangles += rows.length * 126;
  }

  // ================================================================ the hills
  // Dark trees where a canyon holds water: toyon, oak and the eucalyptus the ranchers planted. Clumps far off, one draw call.
  {
    const spots: Array<[number, number, number, number]> = [];
    const step = 230;
    for (let y = -28200; y <= -7600; y += step) for (let x = -28600; x <= -200; x += step) {
      const i = Math.round(x / step);
      const j = Math.round(y / step);
      const px = x + (hash(i, j) - 0.5) * step;
      const py = y + (hash(j, i) - 0.5) * step;
      const z = ground.height(px, py);
      if (z < 6 || z > 420) continue;
      // A canyon floor: lower than the ground on at least three sides around it.
      const around = [ground.height(px + 150, py), ground.height(px - 150, py), ground.height(px, py + 150), ground.height(px, py - 150)];
      const above = around.filter((a) => a > z + 14).length;
      const patch = smoothNoise(px / 500, py / 500);
      if (above < 2 || hash(i * 3, j * 5) > 0.35 + patch * 0.5) continue;
      spots.push([px, py, z, 9 + hash(i, j * 7) * 9]);
      // A second clump a little way down the canyon.
      const qx = px + (hash(i, j + 5) - 0.5) * 90;
      const qy = py + (hash(i + 5, j) - 0.5) * 90;
      if (hash(i + 9, j - 4) > 0.55 && ground.height(qx, qy) > 4) spots.push([qx, qy, ground.height(qx, qy), 7 + hash(j, i * 7) * 7]);
    }
    const trees = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), spots.length);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    spots.forEach(([x, y, z, r], i) => {
      q.setFromAxisAngle(UP, hash(i, 3) * 6.28);
      trees.setMatrixAt(i, mtx.compose(new THREE.Vector3(x, z + r * 0.35, -y), q, new THREE.Vector3(r * (1.1 + hash(i, 5) * 0.6), r * (0.7 + hash(i, 7) * 0.5), r * (1.1 + hash(i, 9) * 0.6))));
      trees.setColorAt(i, c.setRGB(0.15 + hash(i, 11) * 0.06, 0.21 + hash(i, 13) * 0.07, 0.11 + hash(i, 15) * 0.04));
    });
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
    trees.name = 'catalina_trees';
    trees.frustumCulled = false;
    group.add(trees);
    detail.push({ object: trees, x: -14000, y: -17000, far: 30000 });
    counts.trees = spots.length;
    triangles += spots.length * 20;
  }
  return { group, triangles, detail, counts };
}
