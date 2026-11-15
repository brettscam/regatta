import * as THREE from 'three';
import { Massing, WIN, onCityNight } from './massing';
import { landUse } from './terrain';

/** What the builders need to know about the ground they build on. All positions are course metres, east and north. */
export interface Ground {
  /** Course position of a latitude and longitude, by the course's own projection. */
  at(lat: number, lon: number): { x: number; y: number };
  heightAt(x: number, y: number): number;
  dry(x: number, y: number): boolean;
  /** Lowest ground under a footprint of half-width r. */
  footing(x: number, y: number, r: number): number;
  shoreFrom(x: number, y: number, dx: number, dy: number, reach?: number): { x: number; y: number } | null;
  summitNear(x: number, y: number, r: number): { x: number; y: number };
  /** True where the depth chart lets a boat float. Nothing is built there, so nothing drawn can be sailed through. */
  sailable(x: number, y: number): boolean;
  rnd(): number;
}

type P3 = [number, number, number];
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
// The street grid north of Market Street runs nine degrees off the compass. South of Market it lies at 45.
const GRID = 0.16;
const SOMA = Math.PI / 4;

/** Where the landmarks really are, as latitude and longitude. */
export const SITES = {
  salesforce: [37.7897, -122.3969],
  transamerica: [37.7952, -122.4028],
  california555: [37.7919, -122.4038],
  california345: [37.7926, -122.4005],
  california101: [37.793, -122.3982],
  embarcadero1: [37.7946, -122.4002],
  embarcadero2: [37.7947, -122.399],
  embarcadero3: [37.7948, -122.3978],
  embarcadero4: [37.795, -122.3963],
  fremont181: [37.7897, -122.3954],
  millennium: [37.7905, -122.3963],
  oneRincon: [37.7858, -122.3922],
  infinity: [37.7893, -122.3905],
  fairmont: [37.7924, -122.4104],
  markHopkins: [37.7915, -122.4103],
  russianHill: [37.7985, -122.414],
  fontana: [37.8062, -122.4247],
  coit: [37.8024, -122.4058],
  ferryBuilding: [37.7955, -122.3937],
  ghirardelli: [37.806, -122.4229],
  fortMason: [37.8068, -122.4307],
  palace: [37.8029, -122.4484],
  sutro: [37.7552, -122.4528],
  oraclePark: [37.7786, -122.3893],
  pier39: [37.8083, -122.4098],
  pier45: [37.8092, -122.4178],
  hydeStreetPier: [37.8072, -122.4219],
  municipalPier: [37.8073, -122.4263],
  stFrancisYC: [37.8073, -122.4466],
  goldenGateYC: [37.8077, -122.4424],
  alcatrazCellhouse: [37.8267, -122.4231],
  alcatrazLighthouse: [37.8262, -122.4222],
  alcatrazWarden: [37.8263, -122.4225],
  alcatrazWaterTower: [37.8278, -122.4241],
  alcatrazBuilding64: [37.8273, -122.4217],
  alcatrazDock: [37.827, -122.4213],
  alcatrazIndustries: [37.8284, -122.425],
  alcatrazPowerhouse: [37.8281, -122.4236],
  bayBridgeCity: [37.7873, -122.3893],
  bayBridgeIsland: [37.8086, -122.3662],
  bayBridgeEastPortal: [37.8128, -122.3612],
  bayBridgeEastTower: [37.8149, -122.3583],
  bayBridgeOakland: [37.8235, -122.318],
  ayalaCove: [37.8685, -122.4347],
  immigrationStation: [37.8703, -122.4265],
  tiburon: [37.8727, -122.4565],
  houseboats: [37.871, -122.503],
} satisfies Record<string, [number, number]>;

export interface City {
  objects: THREE.Object3D[];
  /** Where each landmark ended up, course metres, after any nudge onto firm ground. */
  placed: Record<string, [number, number]>;
  triangles: number;
}

/** San Francisco as it stands along the water, Alcatraz, the Bay Bridge and the smaller shores. One mesh and a few lines. */
export function buildCity(g: Ground): City {
  const m = new Massing();
  const placed: Record<string, [number, number]> = {};
  const objects: THREE.Object3D[] = [];
  const P = (name: keyof typeof SITES) => g.at(SITES[name][0], SITES[name][1]);
  const mark = (name: string, p: { x: number; y: number }) => { placed[name] = [Math.round(p.x), Math.round(p.y)]; };
  /** Somewhere a thing can stand without a boat being able to sail through it. */
  const free = (x: number, y: number) => g.dry(x, y) || !g.sailable(x, y);
  const off = (p: { x: number; y: number }, along: number, across: number, turn: number) => ({ x: p.x + along * Math.cos(turn) - across * Math.sin(turn), y: p.y + along * Math.sin(turn) + across * Math.cos(turn) });
  /** The nearest firm ground to a spot, looking out as far as `reach`. */
  const firm = (p: { x: number; y: number }, r: number, reach = 200): { x: number; y: number } | null => {
    for (let d = 0; d <= reach; d += 10) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const q = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
        if (g.footing(q.x, q.y, r) > 1.2) return q;
        if (d === 0) break;
      }
    }
    return null;
  };
  const keepOut: Array<[number, number, number]> = [];
  const site = (name: keyof typeof SITES, clear = 42, foot = 20) => {
    const p = P(name);
    keepOut.push([p.x, p.y, clear]);
    mark(name, p);
    m.next();
    return { x: p.x, y: p.y, base: g.footing(p.x, p.y, foot) - 1 };
  };
  const lines = { steel: [] as number[], lights: [] as number[], white: [] as number[] };

  // ---- the towers a sailor steers by ---------------------------------------------------------------
  {
    // Salesforce Tower, 326 m: the tallest, a rounded shaft drawing in to its crown.
    const t = site('salesforce', 50);
    m.lathe(t.x, t.y, t.base, [[29, 0], [29, 170], [27.5, 235], [24.5, 282], [20, 310], [15.5, 326]], 16, C(0.6, 0.69, 0.77), WIN.grid);
  }
  {
    // Transamerica Pyramid, 260 m: white, with the two wings high on its east and west faces and a plain metal tip.
    const t = site('transamerica', 46);
    const white = C(0.9, 0.89, 0.85);
    const k = 1 - 196 / 260;
    m.solid({ ...t, w: 53, h: 196, turn: GRID, top: k, color: white, win: WIN.grid });
    m.solid({ x: t.x, y: t.y, base: t.base + 196, w: 53 * k, h: 64, turn: GRID, top: 0.02, color: C(0.84, 0.86, 0.88), win: WIN.floodlit });
    for (const s of [-1, 1]) {
      const w = off(t, s * 8.5, 0, GRID);
      m.solid({ x: w.x, y: w.y, base: t.base + 118, w: 7, d: 10, h: 110, turn: GRID, color: white });
    }
  }
  {
    // 555 California, 237 m: the dark slab with bay windows from top to bottom.
    const t = site('california555', 56);
    const brown = C(0.36, 0.25, 0.2);
    m.solid({ ...t, w: 64, d: 42, h: 218, turn: GRID, color: brown, win: WIN.fins });
    m.solid({ ...t, base: t.base + 218, w: 46, d: 30, h: 19, turn: GRID, color: brown, win: WIN.fins });
  }
  {
    // 345 California: the two flagpole spires. 101 California: the round glass tower.
    const t = site('california345');
    const stone = C(0.78, 0.77, 0.74);
    m.solid({ ...t, w: 36, h: 178, turn: GRID, color: stone, win: WIN.grid });
    for (const s of [-1, 1]) {
      const q = off(t, s * 9, 0, GRID);
      m.solid({ x: q.x, y: q.y, base: t.base + 178, w: 12, h: 20, turn: GRID + Math.PI / 4, color: stone, win: WIN.grid });
      m.beam([q.x, q.y, t.base + 198], [q.x, q.y, t.base + 212], 1.2, 1.2, C(0.85, 0.85, 0.85));
    }
    const r = site('california101');
    m.solid({ ...r, w: 46, sides: 14, h: 183, color: C(0.5, 0.6, 0.66), win: WIN.ribbon });
  }
  // The four Embarcadero Center slabs: thin, pale, stepped, standing in a row back from the Ferry Building.
  (['embarcadero1', 'embarcadero2', 'embarcadero3', 'embarcadero4'] as const).forEach((name, i) => {
    const t = site(name, 46);
    const high = [173, 126, 126, 174][i];
    for (const k of [-1, 0, 1]) {
      const q = off(t, k * 17, k * 5, GRID);
      m.solid({ x: q.x, y: q.y, base: t.base, w: 30, d: 13, h: high - Math.abs(k) * 15 - (k > 0 ? 8 : 0), turn: GRID, color: C(0.8, 0.78, 0.73), win: WIN.fins });
    }
  });
  {
    // South of Market: 181 Fremont with its spire, the Millennium Tower, the Infinity pair, and One Rincon Hill by the bridge.
    const f = site('fremont181');
    m.solid({ ...f, w: 30, h: 205, turn: SOMA, color: C(0.48, 0.56, 0.64), win: WIN.grid });
    m.solid({ ...f, base: f.base + 205, w: 30, h: 22, turn: SOMA, top: 0.5, color: C(0.48, 0.56, 0.64) });
    m.beam([f.x, f.y, f.base + 227], [f.x, f.y, f.base + 245], 1.5, 1.5, C(0.8, 0.82, 0.84));
    const mt = site('millennium');
    m.solid({ ...mt, w: 34, d: 30, h: 197, turn: SOMA, color: C(0.52, 0.62, 0.72), win: WIN.ribbon });
    const inf = site('infinity', 60);
    for (const [along, across, high] of [[0, 0, 137], [-70, 40, 112]]) {
      const q = off(inf, along, across, SOMA);
      m.next();
      m.solid({ x: q.x, y: q.y, base: g.footing(q.x, q.y, 20) - 1, w: 30, d: 42, sides: 12, h: high, turn: SOMA, color: C(0.55, 0.66, 0.72), win: WIN.ribbon });
    }
    const rh = site('oneRincon', 70);
    for (const [along, across, high] of [[0, 0, 181], [60, 62, 150]]) {
      const q = off(rh, along, across, SOMA);
      const base = g.footing(q.x, q.y, 20) - 1;
      const blue = C(0.38, 0.45, 0.54);
      m.next();
      m.solid({ x: q.x, y: q.y, base, w: 30, d: 40, sides: 12, h: high, turn: SOMA, color: blue, win: WIN.ribbon });
      m.solid({ x: q.x, y: q.y, base: base + high, w: 30, d: 40, sides: 12, h: 14, turn: SOMA, top: 0.6, color: blue });
    }
  }
  {
    // On the hills: the Fairmont and the Mark Hopkins on Nob Hill, the apartment towers of Russian Hill, the Fontana slabs.
    const pale = C(0.86, 0.84, 0.78);
    const fm = site('fairmont');
    m.solid({ ...fm, w: 28, h: 99, turn: GRID, color: pale, win: WIN.homes });
    const mh = site('markHopkins');
    m.solid({ ...mh, w: 40, d: 22, h: 78, turn: GRID, color: C(0.8, 0.74, 0.64), win: WIN.homes });
    m.solid({ ...mh, base: mh.base + 78, w: 16, d: 16, h: 14, turn: GRID, color: C(0.8, 0.74, 0.64), win: WIN.ribbon });
    const rh = site('russianHill', 60);
    for (const [along, across, high, wide] of [[0, 0, 98, 24], [-95, 70, 72, 26], [90, -60, 80, 22], [-190, 150, 64, 28]]) {
      const q = off(rh, along, across, GRID);
      m.next();
      m.solid({ x: q.x, y: q.y, base: g.footing(q.x, q.y, 14) - 1, w: wide, d: wide * 1.3, h: high, turn: GRID, color: pale.clone().multiplyScalar(0.9 + g.rnd() * 0.1), win: WIN.homes });
    }
    const ft = site('fontana', 90);
    for (const s of [-1, 1]) {
      const q = off(ft, s * 72, 0, GRID);
      m.next();
      m.solid({ x: q.x, y: q.y, base: g.footing(q.x, q.y, 20) - 1, w: 104, d: 17, h: 52, turn: GRID + s * 0.07, color: C(0.9, 0.89, 0.85), win: WIN.homes });
    }
  }
  {
    // Coit Tower, on the top of Telegraph Hill: a fluted white column, 64 m, with its arcade at the top.
    const s = P('coit');
    const p = g.summitNear(s.x, s.y, 160);
    mark('coit', p);
    keepOut.push([p.x, p.y, 70]);
    const base = g.heightAt(p.x, p.y) - 1;
    const white = C(0.93, 0.92, 0.88);
    m.next();
    m.solid({ x: p.x, y: p.y, base, w: 26, d: 20, h: 6, turn: GRID, color: white });
    m.lathe(p.x, p.y, base, [[6.2, 0], [5.7, 9], [5.3, 47]], 14, white, WIN.floodlit);
    m.lathe(p.x, p.y, base, [[5.5, 47], [5.5, 55]], 14, white, WIN.fins);
    m.lathe(p.x, p.y, base, [[5.5, 55], [4.7, 55], [4.7, 60], [4.2, 60], [4.2, 64]], 14, white, WIN.floodlit);
  }
  {
    // Sutro Tower, on its hill behind the city: three legs drawing in to a waist and out again, banded red and white.
    const t = P('sutro');
    if (g.heightAt(t.x, t.y) > 100) {
      mark('sutro', t);
      const base = g.heightAt(t.x, t.y) - 2;
      const red = C(0.82, 0.24, 0.16);
      const white = C(0.93, 0.92, 0.9);
      const leg = (k: number, z: number): P3 => {
        const a = (k / 3) * Math.PI * 2 + 0.5;
        const r = z < 200 ? 46 - (32 * z) / 200 : 14 + (5 * (z - 200)) / 98;
        return [t.x + Math.cos(a) * r, t.y + Math.sin(a) * r, base + z];
      };
      const levels = [0, 44, 88, 132, 168, 200, 232, 262, 298];
      for (let k = 0; k < 3; k++) {
        levels.slice(0, -1).forEach((z, i) => m.beam(leg(k, z), leg(k, levels[i + 1]), z < 200 ? 4.2 : 3, z < 200 ? 4.2 : 3, i % 2 ? white : red));
        for (const z of [88, 168, 200, 232, 262, 298]) m.beam(leg(k, z), leg((k + 1) % 3, z), 3, 3.5, z === 200 || z === 262 ? red : white);
        // The aerials on top.
        const top = leg(k, 298);
        m.beam(top, [top[0], top[1], top[2] + 24], 1.2, 1.2, k % 2 ? white : red);
      }
    }
  }
  {
    // The Ferry Building at the foot of Market Street: the long arcaded hall and the clock tower, 75 m.
    const t = site('ferryBuilding', 120, 30);
    const turn = -Math.PI / 4;
    const stone = C(0.74, 0.72, 0.66);
    const base = Math.max(1.5, t.base);
    m.hall(t.x, t.y, base, 201, 44, 14, 5, turn, stone, C(0.5, 0.52, 0.52), WIN.fins);
    const c = off(t, 0, -12, turn);
    m.solid({ x: c.x, y: c.y, base, w: 10.5, h: 47, turn, color: stone });
    m.solid({ x: c.x, y: c.y, base: base + 47, w: 12, h: 10, turn, color: C(0.8, 0.78, 0.72) });
    // Four clock faces, lit at night.
    for (let k = 0; k < 4; k++) {
      const q = off(c, 6.1, 0, turn + (k * Math.PI) / 2);
      m.solid({ x: q.x, y: q.y, base: base + 48.5, w: 0.5, d: 7, h: 7, turn: turn + (k * Math.PI) / 2, color: C(0.97, 0.96, 0.9), win: WIN.lamp });
    }
    m.solid({ x: c.x, y: c.y, base: base + 57, w: 8.5, h: 9, turn, color: stone, win: WIN.fins });
    m.lathe(c.x, c.y, base + 66, [[4.4, 0], [3.4, 3.5], [1.2, 6], [0.3, 9]], 8, C(0.7, 0.7, 0.66), WIN.floodlit);
  }
  {
    // Ghirardelli Square: brick, with its clock tower. The sign is added below as a small drawn texture.
    const t = site('ghirardelli', 80, 30);
    const brick = C(0.56, 0.3, 0.23);
    m.solid({ ...t, w: 92, d: 44, h: 15, turn: GRID, color: brick, win: WIN.homes });
    const q = off(t, 30, -34, GRID);
    m.solid({ x: q.x, y: q.y, base: g.footing(q.x, q.y, 8) - 1, w: 8, h: 30, turn: GRID, color: brick, win: WIN.homes });
    m.solid({ x: q.x, y: q.y, base: g.footing(q.x, q.y, 8) + 29, w: 9, h: 8, turn: GRID, top: 0.05, color: C(0.3, 0.32, 0.34) });
    const s = off(t, 0, 16, GRID);
    const z = t.base + 15;
    for (const k of [-22, -8, 8, 22]) {
      const leg = off(s, k, 0, GRID);
      m.beam([leg.x, leg.y, z], [leg.x, leg.y, z + 5], 0.6, 0.6, C(0.3, 0.3, 0.3));
    }
    objects.push(sign('Ghirardelli', 54, 8, s.x, s.y, z + 9, GRID));
  }
  {
    // The Palace of Fine Arts: the ochre rotunda and its dome, with the colonnade curving away on either side.
    const t = site('palace', 150, 20);
    const ochre = C(0.8, 0.62, 0.46);
    const base = Math.max(1.5, t.base);
    m.lathe(t.x, t.y, base, [[21, 0], [21, 4]], 8, ochre);
    m.lathe(t.x, t.y, base + 4, [[18.5, 0], [18.5, 22]], 16, ochre, WIN.fins);
    m.lathe(t.x, t.y, base + 26, [[20, 0], [20, 5], [17, 5], [15.5, 11], [11.5, 16.5], [6, 20], [0.2, 21.5]], 16, C(0.74, 0.5, 0.36), WIN.floodlit);
    for (let a = -1.25; a <= 1.26; a += 0.1) {
      if (Math.abs(a) < 0.32) continue;
      // The colonnade stands on a curve west of the lagoon, open to the east.
      const q = { x: t.x - 150 + Math.cos(a) * 150, y: t.y + Math.sin(a) * 150 };
      if (!g.dry(q.x, q.y)) continue;
      m.solid({ x: q.x, y: q.y, base: g.footing(q.x, q.y, 5) - 1, w: 8, d: 11, h: 15, turn: a, color: ochre, win: WIN.fins });
    }
  }
  {
    // Oracle Park on McCovey Cove: the stands wrapping round from left field behind home plate, open to the water,
    // the brick wall along the cove, the scoreboard, and the light towers.
    const t = site('oraclePark', 175, 40);
    const brick = C(0.58, 0.33, 0.25);
    const seats = C(0.13, 0.27, 0.2);
    const base = Math.max(1.5, t.base);
    // Home plate is at the western corner and the batter looks east-north-east.
    const face = 0.3;
    m.solid({ ...t, base, w: 190, sides: 16, h: 1.4, color: C(0.24, 0.42, 0.2) });
    for (let a = face + 1.05; a <= face + Math.PI * 2 - 1.05; a += 0.2) {
      const out = { x: t.x + Math.cos(a) * 128, y: t.y + Math.sin(a) * 128 };
      const mid = { x: t.x + Math.cos(a) * 106, y: t.y + Math.sin(a) * 106 };
      if (!g.dry(out.x, out.y)) continue;
      m.solid({ x: out.x, y: out.y, base, w: 20, d: 27, h: 36, turn: a, color: brick, win: WIN.fins });
      m.solid({ x: mid.x, y: mid.y, base, w: 26, d: 23, h: 22, turn: a, top: 0.82, color: seats });
    }
    // The right-field wall and its arcade, along the cove.
    for (let a = face - 1.0; a <= face - 0.25; a += 0.19) {
      const q = { x: t.x + Math.cos(a) * 112, y: t.y + Math.sin(a) * 112 };
      if (g.dry(q.x, q.y)) m.solid({ x: q.x, y: q.y, base, w: 7, d: 22, h: 8.5, turn: a, color: brick, win: WIN.shed });
    }
    const sb = { x: t.x + Math.cos(face + 0.1) * 122, y: t.y + Math.sin(face + 0.1) * 122 };
    if (g.dry(sb.x, sb.y)) m.solid({ x: sb.x, y: sb.y, base: base + 6, w: 4, d: 46, h: 20, turn: face + 0.1, color: C(0.12, 0.14, 0.16) });
    for (const a of [face + 1.5, face + 2.5, face + Math.PI, face - 2.5, face - 1.5, face + 0.55, face - 0.55]) {
      const outfield = Math.abs(a - face) < 1;
      const r = outfield ? 126 : 132;
      const q = { x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r };
      if (!g.dry(q.x, q.y)) continue;
      const top = base + (outfield ? 44 : 58);
      m.beam([q.x, q.y, base], [q.x, q.y, top], 1.6, 1.6, C(0.3, 0.32, 0.34));
      m.solid({ x: q.x, y: q.y, base: top - 9, w: 1.2, d: 20, h: 9, turn: a, color: C(0.95, 0.95, 0.9), win: WIN.lamp });
    }
  }

  // ---- the city between them ---------------------------------------------------------------------
  {
    // How high the buildings run in each district: [east, north, spread, height].
    const peaks: Array<[number, number, number, number]> = [
      [4400, -4140, 400, 150], // Financial District
      [4760, -4500, 360, 165], // Transbay and the new towers south of Market
      [5130, -4800, 240, 105], // Rincon Hill
      [3800, -4680, 480, 50], // Union Square and the Tenderloin
      [3450, -4200, 280, 34], // Nob Hill
      [3150, -3500, 240, 22], // Russian Hill
      [5350, -6600, 420, 34], // Mission Bay
      [3000, -5600, 520, 24], // Civic Center
    ];
    const tallAt = (x: number, y: number) => peaks.reduce((s, [px, py, r, h]) => s + h * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (2 * r * r)), 0);
    const stucco = [C(0.86, 0.84, 0.78), C(0.8, 0.77, 0.7), C(0.9, 0.88, 0.84), C(0.74, 0.72, 0.68), C(0.83, 0.76, 0.66), C(0.7, 0.74, 0.76), C(0.88, 0.82, 0.74), C(0.82, 0.7, 0.6), C(0.9, 0.86, 0.72)];
    const stone = [C(0.8, 0.78, 0.72), C(0.72, 0.7, 0.66), C(0.86, 0.83, 0.76), C(0.66, 0.62, 0.56), C(0.6, 0.52, 0.46), C(0.9, 0.89, 0.86), C(0.76, 0.7, 0.62)];
    const glass = [C(0.45, 0.55, 0.66), C(0.56, 0.63, 0.7), C(0.38, 0.46, 0.56), C(0.62, 0.7, 0.76), C(0.5, 0.6, 0.62)];
    const dark = [C(0.3, 0.3, 0.33), C(0.36, 0.3, 0.26), C(0.25, 0.29, 0.33)];
    const pick = (list: THREE.Color[]) => list[Math.floor(g.rnd() * list.length)].clone();
    const frames = [
      { turn: GRID, pu: 146, pv: 105, soma: false },
      { turn: SOMA, pu: 276, pv: 193, soma: true },
    ];
    for (const f of frames) {
      const cs = Math.cos(f.turn);
      const sn = Math.sin(f.turn);
      for (let j = -110; j <= 40; j++) {
        for (let i = -70; i <= 80; i++) {
          const bx = i * f.pu * cs - j * f.pv * sn;
          const by = i * f.pu * sn + j * f.pv * cs;
          if (bx < -6300 || bx > 6000 || by < -7500 || by > -2100) continue;
          // South of Market the blocks are big and lie square to Market Street, as far out as the Mission.
          const south = (bx - by - 8781) / Math.SQRT2;
          const inSoma = south > 10 && south < 1650 && bx > 2500;
          if (inSoma !== f.soma) continue;
          const z = g.heightAt(bx, by);
          if (z < 1.2 || landUse(bx, by, z) !== 'city') continue;
          const tall = tallAt(bx, by);
          // Thin what nobody on the water can see: behind the hills, and out toward the ocean.
          const inland = THREE.MathUtils.smoothstep(-by, 4300, 7200);
          const hidden = inland * 0.6 + (bx < -3600 ? 0.25 : 0);
          if (tall < 20 && g.rnd() < hidden) continue;
          const front = by > -4500 && bx > -3400;
          let nu = 1;
          let nv = 1;
          if (tall > 34) { nu = f.soma ? 4 : 3; nv = f.soma ? 3 : 2; }
          else if (f.soma) { nu = 3; nv = 2; }
          else if (front) { nu = 3; nv = 2; }
          else if (inland < 0.6) { nu = 2; nv = 2; }
          else { nu = 2; }
          const lu = (f.pu - 20) / nu;
          const lv = (f.pv - 20) / nv;
          for (let b = 0; b < nv; b++) {
            for (let a = 0; a < nu; a++) {
              const ou = (a + 0.5) * lu - (f.pu - 20) / 2;
              const ov = (b + 0.5) * lv - (f.pv - 20) / 2;
              const x = bx + ou * cs - ov * sn;
              const y = by + ou * sn + ov * cs;
              const here = g.heightAt(x, y);
              if (here < 1.5 || g.rnd() < 0.09) continue;
              if (keepOut.some(([kx, ky, kr]) => Math.hypot(x - kx, y - ky) < kr + lu * 0.4)) continue;
              const t = tallAt(x, y);
              const r = g.rnd();
              let h: number;
              if (t > 34) h = Math.min(188, 13 + t * (0.14 + 1.2 * r * r * r) + g.rnd() * 10);
              else if (t > 14) h = 10 + t * (0.3 + r * r) + g.rnd() * 6;
              else h = 8 + g.rnd() * 6.5 + (g.rnd() < 0.03 ? 18 : 0);
              const w = Math.min(lu * (0.84 + g.rnd() * 0.12), h > 60 ? 30 + g.rnd() * 18 : 999);
              const d = Math.min(lv * (0.84 + g.rnd() * 0.12), h > 60 ? 30 + g.rnd() * 14 : 999);
              const base = g.footing(x, y, Math.max(w, d) * 0.5) - 1.5;
              const rise = here - base;
              m.next();
              if (h > 55) {
                const k = g.rnd();
                const color = (f.soma ? k < 0.6 : k < 0.2) ? pick(glass) : k > 0.86 ? pick(dark) : pick(stone);
                const win = g.rnd() < 0.5 ? WIN.grid : color.b > color.r + 0.04 ? WIN.ribbon : WIN.fins;
                const crown = g.rnd() < 0.55 ? h * (0.06 + g.rnd() * 0.1) : 0;
                m.solid({ x, y, base, w, d, h: h - crown + rise, turn: f.turn, color, win });
                if (crown > 0) m.solid({ x, y, base: base + rise + h - crown, w: w * 0.68, d: d * 0.68, h: crown, turn: f.turn, color, win });
              } else if (h > 20) {
                m.solid({ x, y, base, w, d, h: h + rise, turn: f.turn, color: pick(f.soma && g.rnd() < 0.3 ? glass : g.rnd() < 0.5 ? stone : stucco).multiplyScalar(0.85 + g.rnd() * 0.15), win: g.rnd() < 0.5 ? WIN.grid : WIN.homes });
              } else {
                const color = pick(stucco).multiplyScalar(0.72 + g.rnd() * 0.28);
                m.solid({ x, y, base, w, d, h: h + rise, turn: f.turn, color, win: WIN.homes, roof: C(0.52, 0.52, 0.5).multiplyScalar(0.8 + g.rnd() * 0.4) });
              }
            }
          }
        }
      }
    }
  }

  // ---- the waterfront ------------------------------------------------------------------------------
  {
    const timber = C(0.4, 0.36, 0.31);
    const shedWall = C(0.84, 0.83, 0.79);
    const shedRoof = C(0.56, 0.58, 0.58);
    /** How far a pier can run out from the shore before it would stand in water a boat can use. */
    const runOut = (x: number, y: number, dx: number, dy: number, most: number, wide: number): number => {
      let len = 0;
      for (let d = 10; d <= most; d += 10) {
        const px = x + dx * d;
        const py = y + dy * d;
        if (!free(px, py) || !free(px - dy * wide * 0.5, py + dx * wide * 0.5) || !free(px + dy * wide * 0.5, py - dx * wide * 0.5)) break;
        len = d;
      }
      return len;
    };
    /** A finger pier: bulkhead building on the Embarcadero, and the long shed behind it running out over the water. */
    const fingerPier = (sx: number, sy: number, dx: number, dy: number, most: number, wide: number) => {
      const turn = Math.atan2(dy, dx);
      const out = runOut(sx, sy, dx, dy, most, wide + 10);
      const back = 46;
      m.next();
      if (out >= 20) {
        const cx = sx + dx * (out - back) * 0.5;
        const cy = sy + dy * (out - back) * 0.5;
        m.solid({ x: sx + dx * out * 0.5, y: sy + dy * out * 0.5, base: -2, w: out + 6, d: wide + 10, h: 4.6, turn, color: timber });
        m.hall(cx, cy, 2.6, out + back - 10, wide, 8, 4.5, turn, shedWall.clone().multiplyScalar(0.9 + g.rnd() * 0.1), shedRoof, WIN.shed);
      }
      // The bulkhead: a pale two-storey front square to the street, with a raised centre over the arch.
      const bx = sx - dx * back;
      const by = sy - dy * back;
      if (!g.dry(bx, by)) return;
      const z = Math.max(1.5, g.footing(bx, by, 14) - 0.5);
      const cream = C(0.9, 0.87, 0.78).multiplyScalar(0.92 + g.rnd() * 0.08);
      m.solid({ x: bx, y: by, base: z, w: 13, d: wide + 22, h: 11.5, turn, color: cream, win: WIN.homes });
      m.solid({ x: bx, y: by, base: z + 11.5, w: 13.5, d: 16, h: 4.5, turn, color: cream });
      m.solid({ x: bx - dx * 6.6, y: by - dy * 6.6, base: z, w: 0.6, d: 8, h: 9, turn, color: C(0.2, 0.2, 0.22) });
    };
    // The Embarcadero, from Pier 35 round the north-east corner and down past the Bay Bridge to South Beach.
    // March along the line of the waterfront and let the terrain find the edge: piers leave it square to the shore.
    const front: Array<[number, number]> = [[3700, -2880], [4050, -2950], [4500, -3350], [4850, -3900], [5150, -4450], [5350, -5050], [5450, -5500]];
    const ferry = P('ferryBuilding');
    let count = 0;
    for (let k = 0; k < front.length - 1; k++) {
      const [ax, ay] = front[k];
      const [bx, by] = front[k + 1];
      const span = Math.hypot(bx - ax, by - ay);
      const ox = -(by - ay) / span;
      const oy = (bx - ax) / span;
      for (let d = 30; d < span; d += 118 + g.rnd() * 16) {
        const s = g.shoreFrom(ax + ((bx - ax) * d) / span, ay + ((by - ay) * d) / span, ox, oy);
        if (!s || Math.hypot(s.x - ferry.x, s.y - ferry.y) < 150) continue;
        fingerPier(s.x, s.y, ox, oy, 150 + g.rnd() * 70, 30 + g.rnd() * 8);
        count++;
      }
    }
    placed.embarcaderoPiers = [count, 0];

    // Fort Mason: three long cream sheds with red tile roofs, running north.
    {
      const t = P('fortMason');
      mark('fortMason', t);
      const north = GRID + Math.PI / 2;
      for (const k of [-1, 0, 1]) {
        const root = off(t, 0, -k * 98, north);
        const s = firm(root, 12, 120) ?? root;
        const out = runOut(s.x, s.y, Math.cos(north), Math.sin(north), k < 0 ? 130 : 210, 40);
        const len = out + 40;
        const c = off(s, out / 2 - 20, 0, north);
        m.next();
        m.solid({ x: c.x, y: c.y, base: -2, w: len + 8, d: 44, h: 4.4, turn: north, color: timber });
        m.hall(c.x, c.y, 2.4, len, 32, 9, 5, north, C(0.86, 0.8, 0.66), C(0.62, 0.33, 0.25), WIN.shed);
      }
    }

    // Pier 39: two rows of timber shops down the pier, the sea lions' floats alongside, the marina wall beyond.
    {
      const t = P('pier39');
      mark('pier39', t);
      const tip = g.at(37.8098, -122.4103);
      const turn = Math.atan2(tip.y - t.y, tip.x - t.x);
      const wood = [C(0.62, 0.54, 0.44), C(0.5, 0.55, 0.6), C(0.74, 0.7, 0.6), C(0.58, 0.42, 0.34), C(0.68, 0.66, 0.6)];
      let reach = 0;
      for (let d = -40; d <= 300; d += 25) {
        for (const s of [-1, 1]) {
          const q = off(t, d, s * 15, turn);
          if (!free(q.x, q.y) || !free(q.x + Math.cos(turn) * 12, q.y + Math.sin(turn) * 12)) continue;
          reach = Math.max(reach, d);
          m.next();
          m.solid({ x: q.x, y: q.y, base: -2, w: 26, d: 22, h: 4.6, turn, color: timber });
          m.hall(q.x, q.y, 2.6, 22, 13, 6.5 + g.rnd() * 2, 3, turn, wood[Math.floor(g.rnd() * wood.length)], C(0.4, 0.38, 0.36), WIN.homes);
        }
      }
      // The floats lie alongside, wherever the depth chart leaves no room to sail. Each carries a heap of sea lions.
      let floats = 0;
      for (let d = 20; d <= 260 && floats < 14; d += 16) {
        for (const across of [-66, -54, -42, -31, 31, 42, 54, 66]) {
          const q = off(t, d, across, turn);
          if (g.dry(q.x, q.y) || g.sailable(q.x, q.y) || g.rnd() < 0.3) continue;
          m.solid({ x: q.x, y: q.y, base: -0.4, w: 9, d: 5.5, h: 0.9, turn, color: C(0.6, 0.55, 0.45) });
          for (let n = 0; n < 4; n++) {
            const l = off(q, (n - 1.5) * 2 + g.rnd(), (g.rnd() - 0.5) * 2.4, turn);
            m.lathe(l.x, l.y, 0.5, [[0.75, 0], [0.6, 0.5], [0.15, 0.8 + g.rnd() * 0.5]], 5, C(0.3, 0.22, 0.16).multiplyScalar(0.8 + g.rnd() * 0.5), 0, 2.2, turn + g.rnd() * 2);
          }
          floats++;
        }
      }
      placed.pier39Floats = [floats, reach];
      for (const side of [-110, 105]) {
        for (let d = 60; d <= 300; d += 20) {
          const q = off(t, d, side, turn);
          if (!g.dry(q.x, q.y) && !g.sailable(q.x, q.y)) m.solid({ x: q.x, y: q.y, base: -2, w: 21, d: 3, h: 4, turn, color: C(0.62, 0.61, 0.58) });
        }
      }
    }

    // Fisherman's Wharf: the long sheds of Pier 45.
    {
      const t = P('pier45');
      mark('pier45', t);
      const north = GRID + Math.PI / 2;
      for (const s of [-1, 1]) {
        let from = 0;
        let to = 0;
        for (let d = -60; d <= 260; d += 10) {
          const q = off(t, d, s * 24, north);
          if (free(q.x, q.y)) { if (to === from) from = d; to = d + 10; } else if (to > from) break;
        }
        if (to - from < 40) continue;
        const c = off(t, (from + to) / 2, s * 24, north);
        m.next();
        m.hall(c.x, c.y, Math.max(2, g.heightAt(c.x, c.y)), to - from - 8, 30, 8, 4, north, C(0.82, 0.8, 0.74), shedRoof, WIN.shed);
      }
    }

    // Hyde Street Pier and the old ships. Balclutha, the black three-masted square-rigger, lies alongside it.
    {
      const t = P('hydeStreetPier');
      const north = GRID + Math.PI / 2;
      const s = g.shoreFrom(t.x, t.y, Math.cos(north), Math.sin(north), 400) ?? t;
      const out = runOut(s.x, s.y, Math.cos(north), Math.sin(north), 250, 40);
      mark('hydeStreetPier', s);
      if (out >= 20) {
        const c = off(s, out / 2, 0, north);
        m.solid({ x: c.x, y: c.y, base: -2, w: out + 6, d: 12, h: 4.6, turn: north, color: timber });
      }
      // She wants her whole length in water that is too thin to sail, or she would lie across somebody's course.
      // Look outward from her real berth for the nearest place that takes her, along the pier or square to it.
      const berth = (want: { x: number; y: number }, half: number, taken?: { x: number; y: number }): { x: number; y: number; turn: number } | null => {
        for (let d = 0; d <= 320; d += 10) {
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
            const q = { x: want.x + Math.cos(a) * d, y: want.y + Math.sin(a) * d };
            if (taken && Math.hypot(q.x - taken.x, q.y - taken.y) < 60) continue;
            for (const turn of [north, north + Math.PI / 2]) {
              const ok = [-half, -half / 2, 0, half / 2, half].every((along) => {
                const e = off(q, along, 0, turn);
                return g.heightAt(e.x, e.y) < 0.2 && !g.sailable(e.x, e.y);
              });
              if (ok) return { ...q, turn };
            }
            if (d === 0) break;
          }
        }
        return null;
      };
      const b = berth(g.at(37.8094, -122.4222), 38);
      if (b) {
        mark('balclutha', b);
        squareRigger(m, b.x, b.y, b.turn);
      }
      const e = berth(g.at(37.809, -122.4214), 42, b ?? undefined);
      if (e) {
        // The ferry Eureka: white, two decks, one black stack.
        mark('eureka', e);
        m.next();
        m.solid({ x: e.x, y: e.y, base: -0.5, w: 86, d: 19, sides: 10, h: 3.4, turn: e.turn, color: C(0.16, 0.16, 0.17) });
        m.solid({ x: e.x, y: e.y, base: 2.9, w: 72, d: 17, h: 7.5, turn: e.turn, color: C(0.93, 0.92, 0.88), win: WIN.homes });
        m.lathe(e.x, e.y, 10.4, [[1.6, 0], [1.6, 9]], 8, C(0.1, 0.1, 0.1));
      }
    }

    // Aquatic Park's Municipal Pier: a long thin curve of concrete round the cove. Only the part clear of sailing water is drawn.
    {
      const t = P('municipalPier');
      mark('municipalPier', t);
      const R = 445;
      let drawn = 0;
      for (let a = 180; a > 119; a -= 2.5) {
        const p0 = { x: t.x + R + R * Math.cos((a * Math.PI) / 180), y: t.y + R * Math.sin((a * Math.PI) / 180) };
        const p1 = { x: t.x + R + R * Math.cos(((a - 2.5) * Math.PI) / 180), y: t.y + R * Math.sin(((a - 2.5) * Math.PI) / 180) };
        if (!free(p1.x, p1.y)) break;
        m.beam([p0.x, p0.y, 2.4], [p1.x, p1.y, 2.4], 9, 1.4, C(0.72, 0.71, 0.67));
        m.beam([(p0.x + p1.x) / 2, (p0.y + p1.y) / 2, -2], [(p0.x + p1.x) / 2, (p0.y + p1.y) / 2, 1.8], 5, 1.2, C(0.5, 0.49, 0.46));
        drawn += 19.4;
      }
      placed.municipalPierLength = [Math.round(drawn), 0];
    }

    // The yacht clubs on the Marina: the St Francis, white under red tile, and the Golden Gate on the harbour's outer arm.
    {
      const sf = firm(P('stFrancisYC'), 16, 150);
      if (sf) {
        mark('stFrancisYC', sf);
        const z = Math.max(1.8, g.footing(sf.x, sf.y, 16) - 0.5);
        m.next();
        m.hall(sf.x, sf.y, z, 64, 22, 7, 4, GRID, C(0.93, 0.91, 0.85), C(0.66, 0.36, 0.27), WIN.homes);
        m.hall(sf.x + 20, sf.y - 16, z, 24, 16, 6, 3, GRID + Math.PI / 2, C(0.93, 0.91, 0.85), C(0.66, 0.36, 0.27), WIN.homes);
        m.beam([sf.x - 36, sf.y + 8, z], [sf.x - 36, sf.y + 8, z + 22], 0.5, 0.5, C(0.95, 0.95, 0.95));
      }
      const gg = firm(P('goldenGateYC'), 10, 260);
      if (gg) {
        mark('goldenGateYC', gg);
        const z = Math.max(1.8, g.footing(gg.x, gg.y, 10) - 0.5);
        m.next();
        m.hall(gg.x, gg.y, z, 34, 15, 6.5, 2.5, GRID, C(0.74, 0.78, 0.8), C(0.42, 0.44, 0.46), WIN.ribbon);
        m.beam([gg.x + 20, gg.y + 4, z], [gg.x + 20, gg.y + 4, z + 18], 0.5, 0.5, C(0.95, 0.95, 0.95));
      }
    }
  }

  // ---- Alcatraz --------------------------------------------------------------------------------------
  {
    const concrete = C(0.82, 0.79, 0.7);
    const weathered = C(0.68, 0.65, 0.57);
    // The island lies north-west to south-east, and so does everything on it.
    const axis = (135 * Math.PI) / 180;
    const cell = P('alcatrazCellhouse');
    mark('alcatrazCellhouse', cell);
    // The crown was levelled for the prison: the cellhouse sits on one floor, cut into the highest ground.
    const crown = g.heightAt(cell.x, cell.y) - 3;
    m.next();
    m.solid({ x: cell.x, y: cell.y, base: crown - 8, w: 150, d: 46, h: 24, turn: axis, color: concrete, win: WIN.fins, roof: C(0.5, 0.5, 0.48) });
    for (const k of [-45, 0, 45]) {
      const q = off(cell, k, 0, axis);
      m.solid({ x: q.x, y: q.y, base: crown + 16, w: 34, d: 9, h: 2.4, turn: axis, color: C(0.62, 0.64, 0.62) });
    }
    // The administration wing at the lighthouse end, and the recreation yard wall behind.
    const admin = off(cell, 84, 0, axis);
    m.solid({ x: admin.x, y: admin.y, base: g.footing(admin.x, admin.y, 14) - 2, w: 24, d: 34, h: crown + 13 - g.footing(admin.x, admin.y, 14) + 2, turn: axis, color: concrete, win: WIN.homes });
    const yard = off(cell, -100, 6, axis);
    if (g.heightAt(yard.x, yard.y) > 4) m.solid({ x: yard.x, y: yard.y, base: g.footing(yard.x, yard.y, 20) - 2, w: 48, d: 34, h: crown + 4 - g.footing(yard.x, yard.y, 20) + 2, turn: axis, color: weathered, roof: C(0.42, 0.42, 0.4) });

    // The lighthouse: the tallest thing on the Rock, a tapering concrete tower with a black lantern.
    const lh = firm(P('alcatrazLighthouse'), 4, 80) ?? P('alcatrazLighthouse');
    mark('alcatrazLighthouse', lh);
    const lz = g.heightAt(lh.x, lh.y) - 1;
    m.next();
    m.lathe(lh.x, lh.y, lz, [[3.3, 0], [2.2, 20], [3, 20], [3, 21.2]], 8, C(0.88, 0.87, 0.82), WIN.floodlit);
    m.lathe(lh.x, lh.y, lz + 21.2, [[1.8, 0], [1.8, 2.6]], 8, C(1, 0.95, 0.8), WIN.lamp);
    m.lathe(lh.x, lh.y, lz + 23.8, [[2.1, 0], [0.2, 2.2]], 8, C(0.12, 0.13, 0.14));
    // The warden's house beside it: a burned-out shell with no roof.
    const wh = firm(P('alcatrazWarden'), 8, 80);
    if (wh) {
      mark('alcatrazWarden', wh);
      m.solid({ x: wh.x, y: wh.y, base: g.footing(wh.x, wh.y, 8) - 1, w: 17, d: 13, h: 10 + g.heightAt(wh.x, wh.y) - g.footing(wh.x, wh.y, 8), turn: axis, color: C(0.6, 0.58, 0.52), win: WIN.homes, roof: C(0.1, 0.1, 0.1) });
    }
    // The water tower, at the north-west end: a steel tank on six legs.
    const wt = firm(P('alcatrazWaterTower'), 6, 100);
    if (wt) {
      mark('alcatrazWaterTower', wt);
      const z = g.heightAt(wt.x, wt.y) - 1;
      const rust = C(0.72, 0.66, 0.58);
      m.lathe(wt.x, wt.y, z, [[0.6, 16.5], [5.2, 19], [5.2, 26], [0.3, 28.6]], 10, rust);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        m.beam([wt.x + Math.cos(a) * 6.4, wt.y + Math.sin(a) * 6.4, z], [wt.x + Math.cos(a) * 4.8, wt.y + Math.sin(a) * 4.8, z + 19.5], 0.7, 0.7, rust);
      }
      m.beam([wt.x, wt.y, z], [wt.x, wt.y, z + 17], 1.1, 1.1, rust);
    }
    // Building 64, the long barracks over the dock on the north-east side, and the dock itself.
    const b64 = firm(P('alcatrazBuilding64'), 10, 140);
    if (b64) {
      mark('alcatrazBuilding64', b64);
      const z = Math.max(2, g.footing(b64.x, b64.y, 10) - 1);
      m.next();
      m.solid({ x: b64.x, y: b64.y, base: z, w: 96, d: 14, h: 15, turn: axis, color: C(0.86, 0.83, 0.74), win: WIN.homes, roof: C(0.45, 0.45, 0.44) });
      const dock = P('alcatrazDock');
      const dk = g.dry(dock.x, dock.y) ? dock : b64;
      mark('alcatrazDock', dk);
      // A guard tower stands over the dock.
      const gt = off(b64, 62, -4, axis);
      if (g.dry(gt.x, gt.y)) {
        const gz = Math.max(2, g.heightAt(gt.x, gt.y));
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) m.beam([gt.x + sx * 2, gt.y + sy * 2, gz], [gt.x + sx * 1.3, gt.y + sy * 1.3, gz + 11], 0.4, 0.4, C(0.3, 0.3, 0.3));
        m.solid({ x: gt.x, y: gt.y, base: gz + 11, w: 4, sides: 6, h: 3, color: C(0.8, 0.8, 0.76), win: WIN.ribbon });
      }
    }
    // The industries buildings low on the north-west shore, and the powerhouse with its chimney.
    const ind = firm(P('alcatrazIndustries'), 10, 140);
    if (ind) {
      mark('alcatrazIndustries', ind);
      m.next();
      m.solid({ x: ind.x, y: ind.y, base: Math.max(2, g.footing(ind.x, ind.y, 10) - 1), w: 66, d: 16, h: 12, turn: axis + 0.25, color: weathered, win: WIN.grid });
    }
    const ph = firm(P('alcatrazPowerhouse'), 8, 120);
    if (ph) {
      mark('alcatrazPowerhouse', ph);
      const z = Math.max(2, g.footing(ph.x, ph.y, 8) - 1);
      m.solid({ x: ph.x, y: ph.y, base: z, w: 30, d: 16, h: 11, turn: axis, color: weathered, win: WIN.homes });
      m.lathe(ph.x + 12, ph.y + 6, z, [[1.9, 0], [1.3, 34]], 8, C(0.6, 0.57, 0.5));
    }
  }

  bayBridge(m, g, lines, placed);
  otherShores(m, g, placed, firm);

  objects.unshift(m.build('city'));
  const lineOf = (arr: number[], material: THREE.LineBasicMaterial, name: string) => {
    const l = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)), material);
    l.name = name;
    l.frustumCulled = false;
    return l;
  };
  objects.push(lineOf(lines.steel, new THREE.LineBasicMaterial({ color: 0x8f979b }), 'bay_bridge_cables'));
  objects.push(lineOf(lines.white, new THREE.LineBasicMaterial({ color: 0xe8e8e4 }), 'east_span_cables'));
  // The lights on the suspender cables: white, and only there after dark.
  const lamps = new THREE.LineBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0, fog: false });
  const glow = lineOf(lines.lights, lamps, 'bay_bridge_lights');
  onCityNight((n) => { lamps.opacity = n; glow.visible = n > 0.02; });
  objects.push(glow);
  return { objects, placed, triangles: m.triangles };
}

/** A word in lights on a frame, drawn once on a small canvas: white letters by day, the same letters lit at night. */
function sign(text: string, wide: number, high: number, x: number, y: number, z: number, turn: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fffbe8';
    ctx.font = 'bold 64px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // A dark edge to each letter, so the sign reads against a pale sky as well as against the hill.
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#3b2a22';
    ctx.strokeText(text, 256, 44, 500);
    ctx.fillText(text, 256, 44, 500);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wide, high), new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide, alphaTest: 0.25 }));
  mesh.position.set(x, z, -y);
  // The sign faces the Bay.
  mesh.rotation.y = turn + Math.PI;
  mesh.name = 'sign';
  return mesh;
}

/** A three-masted square-rigged ship lying at a pier: black hull with a white strake, yards crossed, sails furled. */
function squareRigger(m: Massing, x: number, y: number, turn: number): void {
  const cs = Math.cos(turn);
  const sn = Math.sin(turn);
  const at = (along: number, across: number, z: number): P3 => [x + along * cs - across * sn, y + along * sn + across * cs, z];
  const spar = C(0.82, 0.68, 0.42);
  m.next();
  m.solid({ x, y, base: -0.6, w: 78, d: 11.6, sides: 10, h: 4.4, turn, color: C(0.07, 0.07, 0.08), roof: C(0.62, 0.52, 0.38) });
  m.solid({ x, y, base: 2.6, w: 78.5, d: 12, sides: 10, h: 0.7, turn, color: C(0.92, 0.91, 0.86), roof: C(0.62, 0.52, 0.38) });
  for (const [along, len] of [[-24, 9], [6, 12]]) {
    const q = at(along, 0, 0);
    m.solid({ x: q[0], y: q[1], base: 3.6, w: len, d: 5, h: 2.4, turn, color: C(0.92, 0.9, 0.84) });
  }
  m.beam(at(37, 0, 4.5), at(53, 0, 9), 0.9, 0.9, spar);
  const masts: Array<[number, number, number[]]> = [[21, 43, [13, 22, 30, 37]], [0, 45, [13, 22, 30, 37]], [-22, 38, [12, 20, 27]]];
  for (const [along, high, yards] of masts) {
    m.beam(at(along, 0, 3.6), at(along, 0, high), 1.1, 1.1, spar);
    yards.forEach((z, i) => {
      const half = 12.5 - i * 2.4;
      m.beam(at(along + 0.6, -half, z), at(along + 0.6, half, z), 0.75, 0.75, spar);
      // The sail furled along its yard.
      m.beam(at(along + 0.6, -half * 0.85, z + 0.7), at(along + 0.6, half * 0.85, z + 0.7), 0.8, 0.6, C(0.9, 0.88, 0.8));
    });
  }
}

/**
 * The Bay Bridge. The western span is two suspension bridges end to end: four steel towers, cross-braced and painted
 * grey, with a concrete anchorage as tall as the towers' waists standing in the middle of the water between them.
 * It lands on Yerba Buena Island. East of the island is the new span: one white tower and a long low skyway.
 */
function bayBridge(m: Massing, g: Ground, lines: { steel: number[]; lights: number[]; white: number[] }, placed: Record<string, [number, number]>): void {
  const seg = (list: number[], a: P3, b: P3) => list.push(a[0], a[2], -a[1], b[0], b[2], -b[1]);
  const A = g.at(SITES.bayBridgeCity[0], SITES.bayBridgeCity[1]);
  const B = g.at(SITES.bayBridgeIsland[0], SITES.bayBridgeIsland[1]);
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const ux = (B.x - A.x) / len;
  const uy = (B.y - A.y) / len;
  const turn = Math.atan2(uy, ux);
  /** A point on the bridge: metres along from the city end, metres across (positive is the north side), height. */
  const L = (s: number, across: number, z: number): P3 => [A.x + ux * s - uy * across, A.y + uy * s + ux * across, z];
  const FT = 0.3048;
  // Published span lengths, city to island: 1171, 2310, 1160, 1160, 2310 and 1171 feet. The cables start on Rincon Hill.
  const START = 150;
  const st = [0, 1171, 3481, 4641, 5801, 8111, 9282].map((f) => START + f * FT);
  const TOPS = [0, 143, 158, 0, 158, 143, 0];
  const UPPER = 74;
  const LOWER = 64.5;
  const HALF = 10;
  const steel = C(0.63, 0.66, 0.67);
  const shade = C(0.4, 0.43, 0.45);
  const concrete = C(0.72, 0.7, 0.64);
  m.next();
  placed.bayBridgeCityAnchorage = [Math.round(L(st[0], 0, 0)[0]), Math.round(L(st[0], 0, 0)[1])];
  placed.bayBridgeCentreAnchorage = [Math.round(L(st[3], 0, 0)[0]), Math.round(L(st[3], 0, 0)[1])];
  placed.bayBridgeIslandAnchorage = [Math.round(L(st[6], 0, 0)[0]), Math.round(L(st[6], 0, 0)[1])];
  [1, 2, 4, 5].forEach((k) => { placed[`bayBridgeTowerW${k + 1}`] = [Math.round(L(st[k], 0, 0)[0]), Math.round(L(st[k], 0, 0)[1])]; });

  // Two decks, one over the other, with the truss between them reading as a dark band.
  const from = -260;
  m.beam(L(from, 0, UPPER), L(len, 0, UPPER), 2 * HALF + 1.5, 1.6, steel);
  m.beam(L(from, 0, LOWER), L(len, 0, LOWER), 2 * HALF + 1.5, 1.6, steel);
  for (const side of [-1, 1]) m.beam(L(from, side * HALF, (UPPER + LOWER) / 2), L(len, side * HALF, (UPPER + LOWER) / 2), 0.7, UPPER - LOWER - 1.6, shade, WIN.shed);
  // Road lamps along the upper deck.
  for (const side of [-1, 1]) m.beam(L(st[0], side * (HALF + 0.6), UPPER + 1.6), L(st[6], side * (HALF + 0.6), UPPER + 1.6), 0.5, 0.5, C(1, 0.86, 0.6), WIN.lamp);

  // Towers: two legs leaning a little together, tied by struts, with the X bracing that gives them their look.
  for (const k of [1, 2, 4, 5]) {
    const s = st[k];
    const top = TOPS[k];
    const legAt = (side: number, z: number) => L(s, side * (12.6 - (z / top) * 2.4), z);
    for (const side of [-1, 1]) {
      m.beam(legAt(side, 6), legAt(side, top), 7.5, 6.4, steel);
      m.solid({ x: legAt(side, top)[0], y: legAt(side, top)[1], base: top, w: 7.5, d: 4, h: 3.2, turn, color: shade });
    }
    const levels = [14, 38, LOWER - 4, UPPER + 22, UPPER + 44, top - 22, top - 3].filter((z, i, all) => i === 0 || z > all[i - 1] + 8);
    for (const z of levels) m.beam(legAt(-1, z), legAt(1, z), 3.4, 3.6, steel);
    for (let i = 0; i < levels.length - 1; i++) {
      // No bracing where the road runs through.
      if (levels[i] < UPPER && levels[i + 1] > LOWER) continue;
      m.beam(legAt(-1, levels[i]), legAt(1, levels[i + 1]), 1.8, 2, steel);
      m.beam(legAt(1, levels[i]), legAt(-1, levels[i + 1]), 1.8, 2, steel);
    }
    const foot = L(s, 0, 0);
    m.solid({ x: foot[0], y: foot[1], base: -3, w: 26, d: 46, h: 10, turn, color: concrete, sides: 4 });
  }
  // The centre anchorage, and the two at the ends.
  {
    const c = L(st[3], 0, 0);
    m.solid({ x: c[0], y: c[1], base: -3, w: 66, d: 40, h: 16, turn, color: concrete });
    m.solid({ x: c[0], y: c[1], base: 13, w: 56, d: 30, h: UPPER + 14 - 13, turn, top: 0.84, color: concrete });
    for (const k of [0, 6]) {
      const e = L(st[k], 0, 0);
      const ground = Math.max(0, g.footing(e[0], e[1], 16)) - 2;
      m.solid({ x: e[0], y: e[1], base: ground, w: 50, d: 30, h: UPPER - 2 - ground, turn, top: 0.88, color: concrete });
    }
  }
  // Piers under the approach in the city and the viaduct onto the island.
  for (let s = from + 20; s < len - 20; s += 52) {
    if (s > st[0] - 30 && s < st[6] + 30) continue;
    const p = L(s, 0, 0);
    const ground = Math.max(0, g.heightAt(p[0], p[1])) - 2;
    if (ground < LOWER - 6) m.beam([p[0], p[1], ground], [p[0], p[1], LOWER], 14, 3.5, concrete);
  }
  // Cables: anchorage, tower, tower, centre anchorage, and the same again. Suspenders hang from them to the deck.
  const ends = [UPPER + 2, TOPS[1] + 3, TOPS[2] + 3, UPPER + 16, TOPS[4] + 3, TOPS[5] + 3, UPPER + 2];
  for (const side of [-1, 1]) {
    const across = side * (HALF + 0.8);
    for (let k = 0; k < 6; k++) {
      const main = k === 1 || k === 4;
      const N = main ? 44 : 22;
      const low = main ? UPPER + 5 : 0;
      const sag = main ? (ends[k] + ends[k + 1]) / 2 - low : 9;
      let prev = L(st[k], across, ends[k]);
      for (let i = 1; i <= N; i++) {
        const u = i / N;
        const p = L(st[k] + (st[k + 1] - st[k]) * u, across, ends[k] + (ends[k + 1] - ends[k]) * u - sag * 4 * u * (1 - u));
        m.beam(prev, p, 0.9, 0.9, steel);
        seg(lines.steel, prev, p);
        if (i < N && p[2] > UPPER + 3) {
          const foot: P3 = [p[0], p[1], UPPER + 1];
          seg(lines.steel, p, foot);
          if (side > 0) seg(lines.lights, p, foot);
        }
        prev = p;
      }
    }
  }

  // ---- the eastern span ----------------------------------------------------------------------------
  const white = C(0.9, 0.9, 0.87);
  const portal = g.at(SITES.bayBridgeEastPortal[0], SITES.bayBridgeEastPortal[1]);
  const tower = g.at(SITES.bayBridgeEastTower[0], SITES.bayBridgeEastTower[1]);
  const oak = g.at(SITES.bayBridgeOakland[0], SITES.bayBridgeOakland[1]);
  placed.bayBridgeEastTower = [Math.round(tower.x), Math.round(tower.y)];
  const way: P3[] = [[portal.x, portal.y, 52], [tower.x, tower.y, 52], [tower.x + 330, tower.y + 200, 50], [tower.x + 1400, tower.y + 560, 38], [oak.x, oak.y, 9]];
  m.next();
  for (let i = 0; i < way.length - 1; i++) {
    const a = way[i];
    const b = way[i + 1];
    m.beam(a, b, 58, 4.5, white);
    for (const side of [-1, 1]) {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = (-(b[1] - a[1]) / d) * side * 29;
      const ny = ((b[0] - a[0]) / d) * side * 29;
      m.beam([a[0] + nx, a[1] + ny, a[2] + 3.4], [b[0] + nx, b[1] + ny, b[2] + 3.4], 0.5, 0.5, C(1, 0.9, 0.7), WIN.lamp);
    }
    // Skyway piers, well apart. None under the suspended part.
    if (i >= 2) {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 80; s < d; s += 160) {
        const u = s / d;
        const p: P3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
        m.beam([p[0], p[1], -3], [p[0], p[1], p[2] - 2], 40, 7, white);
      }
    }
  }
  // The single tower, 160 m, and its cables fanning down to both sides of the deck.
  m.solid({ x: tower.x, y: tower.y, base: -3, w: 26, d: 34, h: 12, turn: 0.75, color: white });
  m.solid({ x: tower.x, y: tower.y, base: 9, w: 9, d: 12, h: 151, turn: 0.75, top: 0.62, color: white, win: WIN.floodlit });
  const cap: P3 = [tower.x, tower.y, 158];
  for (const [a, b] of [[way[0], way[1]], [way[1], way[2]]] as Array<[P3, P3]>) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const side of [-1, 1]) {
      const nx = (-(b[1] - a[1]) / d) * side * 28;
      const ny = ((b[0] - a[0]) / d) * side * 28;
      for (let u = 0.08; u < 0.95; u += 0.08) {
        const far = a === way[1] ? u : 1 - u;
        if (far < 0.1) continue;
        seg(lines.white, cap, [a[0] + (b[0] - a[0]) * u + nx, a[1] + (b[1] - a[1]) * u + ny, a[2] + 2.5]);
      }
    }
  }
}

/** Lightly, the shores across the water: Angel Island's two settlements, Tiburon's Main Street, Sausalito's houseboats, Treasure Island. */
function otherShores(
  m: Massing,
  g: Ground,
  placed: Record<string, [number, number]>,
  firm: (p: { x: number; y: number }, r: number, reach?: number) => { x: number; y: number } | null,
): void {
  const white = C(0.92, 0.9, 0.84);
  const roof = C(0.42, 0.36, 0.32);
  const row = (name: keyof typeof SITES, count: number, spread: number, wide: number, deep: number, wall: number, colors: THREE.Color[]) => {
    const c = g.at(SITES[name][0], SITES[name][1]);
    let done = 0;
    for (let tries = 0; tries < count * 12 && done < count; tries++) {
      const q = firm({ x: c.x + (g.rnd() - 0.5) * spread, y: c.y + (g.rnd() - 0.5) * spread * 0.6 }, wide * 0.5, 60);
      if (!q || g.heightAt(q.x, q.y) > 30) continue;
      m.next();
      m.hall(q.x, q.y, g.footing(q.x, q.y, wide * 0.5) - 0.6, wide * (0.7 + g.rnd() * 0.6), deep, wall, wall * 0.4, g.rnd() * Math.PI, colors[Math.floor(g.rnd() * colors.length)], roof, WIN.homes);
      done++;
    }
    if (done) placed[name] = [Math.round(c.x), Math.round(c.y)];
  };
  // Ayala Cove: the old quarantine station's white buildings behind the beach. China Cove: the immigration station's barracks.
  row('ayalaCove', 5, 260, 26, 11, 6, [white]);
  row('immigrationStation', 4, 220, 40, 13, 8, [white, C(0.84, 0.8, 0.7)]);
  // Tiburon's Main Street, along the water.
  row('tiburon', 12, 420, 16, 11, 6.5, [white, C(0.8, 0.72, 0.6), C(0.66, 0.72, 0.76), C(0.72, 0.5, 0.42)]);
  // Sausalito's houseboats: small bright boxes on the flats of Richardson Bay, where nothing can sail.
  {
    const c = g.at(SITES.houseboats[0], SITES.houseboats[1]);
    const paint = [C(0.75, 0.3, 0.25), C(0.3, 0.45, 0.6), C(0.85, 0.75, 0.4), C(0.9, 0.9, 0.85), C(0.4, 0.55, 0.4), C(0.6, 0.45, 0.35)];
    let done = 0;
    for (let tries = 0; tries < 2400 && done < 70; tries++) {
      const x = c.x + (g.rnd() - 0.5) * 1500;
      const y = c.y + (g.rnd() - 0.5) * 1500;
      if (g.dry(x, y) || g.sailable(x, y)) continue;
      // They lie in rows along their docks, close under the shore.
      let near = false;
      for (let a = 0; a < 6 && !near; a++) near = g.dry(x + Math.cos(a) * 160, y + Math.sin(a) * 160);
      if (!near) continue;
      m.next();
      m.solid({ x, y, base: -0.3, w: 13, d: 6, h: 1.2, turn: 0.6, color: C(0.4, 0.38, 0.35) });
      m.hall(x, y, 0.9, 10 + g.rnd() * 3, 5, 2.6 + g.rnd() * 2, 1.2, 0.6, paint[Math.floor(g.rnd() * paint.length)], roof, WIN.homes);
      done++;
    }
    placed.houseboats = [Math.round(c.x), Math.round(c.y)];
    placed.houseboatCount = [done, 0];
  }
}
