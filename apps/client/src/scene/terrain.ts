import * as THREE from 'three';
import type { CourseData } from '@slack-tide/world';

/** Repeatable noise in 0..1 from a grid position. */
export function hash(i: number, j: number): number {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function smoothNoise(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(i, j);
  const b = hash(i + 1, j);
  const c = hash(i, j + 1);
  const d = hash(i + 1, j + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

export type LandUse = 'city' | 'town' | 'forest' | 'open';

const inBox = (x: number, y: number, x0: number, x1: number, y0: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/**
 * What covers the ground at a course position (metres east and north of the origin) and height.
 * Rough boxes drawn from general knowledge of the Bay: good enough to tell city from park from open hill at a distance.
 */
export function landUse(x: number, y: number, z: number): LandUse {
  // Wooded parks inside San Francisco: the Presidio, Lands End and Lincoln Park, Golden Gate Park.
  if (inBox(x, y, -3300, 150, -4700, -2250) && !(z < 9 && y > -3000)) return 'forest';
  if (inBox(x, y, -6100, -4000, -5300, -4200)) return 'forest';
  if (inBox(x, y, -5360, -350, -7150, -6230)) return 'forest';
  // San Francisco itself, below the bare hilltops.
  if (y < -2250 && x > -6300 && x < 6000) return z > 235 ? 'open' : 'city';
  // The east bay shore, and Treasure Island.
  if (x > 8700) return z > 180 ? 'forest' : 'city';
  if (inBox(x, y, 6200, 7900, -1500, 800)) return 'town';
  if (inBox(x, y, 6600, 8000, -2700, -1500)) return 'forest';
  // Sausalito, Tiburon and Belvedere, Mill Valley: houses up the lower slopes.
  if (inBox(x, y, -4100, -2000, 2300, 4800) && z < 135) return 'town';
  if (inBox(x, y, -1800, 1100, 3700, 6100) && z < 115) return 'town';
  if (x < -1800 && y > 5200 && z < 70) return 'town';
  // Angel Island is oak wood and grass. Mount Tamalpais and the high ridges north of the headlands are wooded.
  if (inBox(x, y, 500, 3300, 2100, 4500)) return smoothNoise(x / 260, y / 260) > 0.38 ? 'forest' : 'open';
  if (y > 4300 && z > 110) return 'forest';
  return 'open';
}

/**
 * The land around the course, from real elevation data.
 * Sim coordinates are metres east (x) and north (y). In the scene that is X east and Z south.
 */
export function buildTerrain(course: CourseData, heights: Uint8Array): THREE.Mesh {
  const g = course.terrain;
  const { nx, ny, dx } = g;
  const pos = new Float32Array(nx * ny * 3);
  const col = new Float32Array(nx * ny * 3);
  const h = new Float32Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) h[k] = (heights[k] / 255) ** 2 * g.max;
  const wet = (i: number, j: number) => h[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))] <= 0.4;

  const gold = new THREE.Color(0.55, 0.47, 0.27);
  const straw = new THREE.Color(0.63, 0.56, 0.36);
  const scrub = new THREE.Color(0.24, 0.29, 0.17);
  const coastal = new THREE.Color(0.33, 0.37, 0.25);
  const forest = new THREE.Color(0.11, 0.18, 0.11);
  const rock = new THREE.Color(0.4, 0.36, 0.31);
  const cliff = new THREE.Color(0.5, 0.44, 0.36);
  const sand = new THREE.Color(0.74, 0.69, 0.56);
  const town = new THREE.Color(0.62, 0.61, 0.58);
  const street = new THREE.Color(0.4, 0.4, 0.41);
  const lawn = new THREE.Color(0.36, 0.43, 0.24);
  const c = new THREE.Color();

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = g.x0 + i * dx;
      const y = g.y0 + j * dx;
      const z = h[k];
      pos[k * 3] = x;
      // Water cells sit well under the sea so the shoreline is cut by the water itself.
      pos[k * 3 + 1] = z > 0.4 ? z : -6;
      pos[k * 3 + 2] = -y;
      if (z <= 0.4) {
        // Seabed colour only shows where a triangle crosses the waterline.
        col[k * 3] = sand.r * 0.8;
        col[k * 3 + 1] = sand.g * 0.8;
        col[k * 3 + 2] = sand.b * 0.8;
        continue;
      }

      // Slope and which way the ground faces. e and n are the rise toward east and north per metre.
      const e = (h[j * nx + Math.min(nx - 1, i + 1)] - h[j * nx + Math.max(0, i - 1)]) / (2 * dx);
      const n = (h[Math.min(ny - 1, j + 1) * nx + i] - h[Math.max(0, j - 1) * nx + i]) / (2 * dx);
      const slope = Math.hypot(e, n);
      const broad = smoothNoise(x / 900, y / 900);
      const patch = smoothNoise(x / 420, y / 420) * 0.6 + smoothNoise(x / 130, y / 130) * 0.4;
      // Ground that falls away to the north or east keeps its moisture: more scrub, less dry grass.
      const sheltered = THREE.MathUtils.clamp(0.5 - (e + n) * 2.2, 0, 1);
      // Near the open ocean the fog keeps the hills green-grey. Inland they dry to gold by July.
      const oceanward = 1 - THREE.MathUtils.smoothstep(x, -9500, -3200);

      const use = landUse(x, y, z);
      if (use === 'forest') {
        c.copy(forest).lerp(scrub, patch * 0.55).lerp(gold, Math.max(0, patch - 0.72) * 1.2);
      } else {
        c.copy(gold).lerp(straw, broad);
        c.lerp(coastal, oceanward * 0.7);
        c.lerp(scrub, THREE.MathUtils.clamp(patch * 0.85 + sheltered * 0.6 - 0.45, 0, 1));
        if (use === 'city') {
          // City blocks: pale roofs broken by darker streets and the odd green square.
          const bi = Math.floor(x / 160);
          const bj = Math.floor(y / 160);
          const block = hash(bi, bj);
          const dense = (1 - THREE.MathUtils.smoothstep(z, 90, 235)) * (0.72 + 0.22 * block);
          c.lerp(town, dense);
          if (block > 0.93) c.lerp(lawn, 0.6);
          else if (hash(i * 3 + 1, j * 5 + 2) > 0.8) c.lerp(street, 0.35);
          c.offsetHSL(0, 0, (hash(bi + 17, bj - 5) - 0.5) * 0.07);
        } else if (use === 'town') {
          c.lerp(scrub, 0.35).lerp(town, 0.22 + 0.2 * hash(Math.floor(x / 110), Math.floor(y / 110)));
        } else if (z < 12 && slope < 0.05 && y < -2250) {
          c.lerp(lawn, 0.5);
        }
      }
      // Steep ground shows rock.
      c.lerp(slope > 0.8 ? cliff : rock, THREE.MathUtils.smoothstep(slope, 0.42, 0.95));

      // The shoreline: a pale band of beach on flat ground, rock under a bluff.
      let shore = 0;
      for (let r = 1; r <= 2 && shore === 0; r++) {
        if (wet(i - r, j) || wet(i + r, j) || wet(i, j - r) || wet(i, j + r) || wet(i - r, j - r) || wet(i + r, j + r) || wet(i - r, j + r) || wet(i + r, j - r)) shore = r === 1 ? 1 : 0.45;
      }
      if (shore > 0 && z < 26) {
        const band = shore * (1 - THREE.MathUtils.smoothstep(z, 4, 26));
        c.lerp(slope > 0.25 ? cliff : sand, band * (use === 'city' ? 0.55 : 0.9));
      }

      // Faces turned away from the afternoon sun, to the north and east, read a touch darker.
      const away = THREE.MathUtils.clamp((-e - n) * 1.6, -0.5, 1);
      const grain = (0.93 + 0.14 * hash(i, j)) * (1 - 0.16 * Math.max(0, away)) * (1 + 0.05 * Math.max(0, -away));
      col[k * 3] = c.r * grain;
      col[k * 3 + 1] = c.g * grain;
      col[k * 3 + 2] = c.b * grain;
    }
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let p = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const d = a + nx;
      const e = d + 1;
      // Skip quads that are all water.
      if (h[a] <= 0.4 && h[b] <= 0.4 && h[d] <= 0.4 && h[e] <= 0.4) continue;
      idx[p++] = a; idx[p++] = b; idx[p++] = d;
      idx[p++] = b; idx[p++] = e; idx[p++] = d;
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geom.setIndex(new THREE.BufferAttribute(idx.subarray(0, p), 1));
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true }));
  mesh.name = 'terrain';
  mesh.frustumCulled = false;
  return mesh;
}

/** The Golden Gate Bridge, to scale from its published dimensions. Tower positions come from the course file. */
export function buildBridge(course: CourseData): THREE.Group {
  const [sx, sy] = course.bridge.south;
  const [nx, ny] = course.bridge.north;
  const span = Math.hypot(nx - sx, ny - sy);
  const TOWER = 227;
  const DECK = 67;
  const SIDE = 343;
  const WIDTH = 27;
  // Viaducts carry the road from the cable anchorages on to the hillsides.
  const SOUTH_APPROACH = 420;
  const NORTH_APPROACH = 280;
  const paint = new THREE.MeshStandardMaterial({ color: 0xb3402e });
  const shadowed = new THREE.MeshStandardMaterial({ color: 0x8c3021 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b2a2 });
  const road = new THREE.MeshStandardMaterial({ color: 0x4a4b4d });
  const group = new THREE.Group();
  group.name = 'golden_gate_bridge';
  // Built along local +X from the south tower to the north tower, then turned onto its real bearing.
  const box = (mat: THREE.Material, w: number, hgt: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  // Deck: roadway on top of a deep stiffening truss, from the far end of one approach to the other.
  const x0 = -SIDE - SOUTH_APPROACH;
  const x1 = span + SIDE + NORTH_APPROACH;
  const mid = (x0 + x1) / 2;
  box(road, x1 - x0, 1.2, WIDTH - 5, mid, DECK + 0.2, 0);
  box(paint, x1 - x0, 2.2, WIDTH, mid, DECK - 1.1, 0);
  for (const side of [-1, 1]) {
    box(shadowed, x1 - x0, 7.6, 1.6, mid, DECK - 5.6, side * (WIDTH / 2 - 0.8));
    box(paint, x1 - x0, 1.3, 0.5, mid, DECK + 1.4, side * (WIDTH / 2 - 0.3));
  }
  box(shadowed, x1 - x0, 1, WIDTH - 2, mid, DECK - 9, 0);
  // Truss panels: verticals along the stiffening truss, close enough together to read as lattice from the water.
  const bays = Math.round((x1 - x0) / 30);
  const panel = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 7.6, WIDTH - 1), paint, bays + 1);
  const mat4 = new THREE.Matrix4();
  for (let i = 0; i <= bays; i++) panel.setMatrixAt(i, mat4.makeTranslation(x0 + ((x1 - x0) * i) / bays, DECK - 5.6, 0));
  panel.frustumCulled = false;
  group.add(panel);

  // Towers: two legs that step in as they climb, tied by four portal struts above the road and bracing below it.
  const steps: Array<[number, number, number, number]> = [
    // from, to, length along the bridge, width across
    [0, DECK + 8, 13.5, 9.5],
    [DECK + 8, 128, 11.5, 8],
    [128, 172, 10, 7],
    [172, 204, 8.6, 6.2],
    [204, TOWER, 7.4, 5.4],
  ];
  const beacon = new THREE.MeshBasicMaterial({ color: 0xff3a22, fog: false });
  for (const tx of [0, span]) {
    for (const side of [-1, 1]) {
      const z = side * (WIDTH / 2 + 2.2);
      for (const [from, to, len, wid] of steps) box(paint, len, to - from, wid, tx, (from + to) / 2, z);
      const light = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), beacon);
      light.position.set(tx, TOWER + 2, z);
      group.add(light);
    }
    for (const [y, hgt] of [[DECK + 30, 13], [DECK + 74, 11], [DECK + 112, 9.5], [TOWER - 9, 8]] as Array<[number, number]>) {
      box(paint, 7, hgt, WIDTH + 4.4, tx, y, 0);
    }
    // Cross bracing under the roadway.
    for (const dir of [-1, 1]) {
      const brace = box(shadowed, 5, 2.6, Math.hypot(WIDTH + 4, 44), tx, 30, 0);
      brace.rotation.x = dir * Math.atan2(44, WIDTH + 4);
    }
    box(paint, 6, 4, WIDTH + 4.4, tx, 8, 0);
    // The concrete pier each tower stands on. The south one has the big fender ring round it.
    const fender = box(concrete, tx === 0 ? 30 : 22, 13, tx === 0 ? WIDTH + 34 : WIDTH + 22, tx, 2.5, 0);
    fender.name = tx === 0 ? 'south_pier' : 'north_pier';
  }

  // Pylons at the cable anchorages, and the piers that carry the approach viaducts.
  for (const px of [-SIDE, -SIDE - 105, span + SIDE, span + SIDE + 70]) {
    for (const side of [-1, 1]) box(concrete, 17, DECK + 30, 9, px, (DECK + 30) / 2, side * (WIDTH / 2 + 3));
  }
  for (let px = -SIDE - 150; px > x0 + 10; px -= 46) box(shadowed, 3.5, DECK - 8, WIDTH - 6, px, (DECK - 8) / 2, 0);
  for (let px = span + SIDE + 115; px < x1 - 10; px += 46) box(shadowed, 3.5, DECK - 8, WIDTH - 6, px, (DECK - 8) / 2, 0);
  // The steel arch that carries the road over Fort Point.
  {
    const a0 = -SIDE - 100;
    const a1 = -SIDE - 5;
    const N = 8;
    for (let i = 0; i < N; i++) {
      const u0 = i / N;
      const u1 = (i + 1) / N;
      const y0 = DECK - 10 - 34 * (2 * u0 - 1) ** 2;
      const y1 = DECK - 10 - 34 * (2 * u1 - 1) ** 2;
      const len = Math.hypot((a1 - a0) / N, y1 - y0);
      const rib = box(paint, len + 0.5, 3, WIDTH - 4, a0 + ((a1 - a0) * (u0 + u1)) / 2, (y0 + y1) / 2, 0);
      rib.rotation.z = Math.atan2(y1 - y0, (a1 - a0) / N);
    }
  }

  // Main cables: a parabola between the towers, straight runs down to the anchorages. Suspenders hang from them.
  const pts: number[] = [];
  const thin: number[] = [];
  for (const side of [-1, 1]) {
    const z = side * (WIDTH / 2 + 1);
    const N = 48;
    let px = 0;
    let py = TOWER;
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const x = u * span;
      const y = DECK + 4 + (TOWER - DECK - 4) * (2 * u - 1) ** 2;
      pts.push(px, py, z, x, y, z);
      if (i < N) thin.push(x, y, z, x, DECK, z);
      px = x;
      py = y;
    }
    // Side spans sag a little too.
    for (const [from, to] of [[0, -SIDE], [span, span + SIDE]]) {
      const M = 10;
      let qx = from;
      let qy = TOWER;
      for (let i = 1; i <= M; i++) {
        const u = i / M;
        const x = from + (to - from) * u;
        const y = TOWER + (DECK + 2 - TOWER) * u - 22 * Math.sin(Math.PI * u);
        pts.push(qx, qy, z, x, y, z);
        if (i < M) thin.push(x, y, z, x, DECK, z);
        qx = x;
        qy = y;
      }
    }
  }
  const lineGeom = (arr: number[]) => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  // Each main cable is nearly a metre thick: drawn as two lines a little apart so it holds up at a distance.
  for (const lift of [0, 0.9]) {
    const cable = new THREE.LineSegments(lineGeom(pts), new THREE.LineBasicMaterial({ color: 0xa63a29 }));
    cable.position.y = lift;
    group.add(cable);
  }
  group.add(new THREE.LineSegments(lineGeom(thin), new THREE.LineBasicMaterial({ color: 0xa63a29, transparent: true, opacity: 0.55 })));

  // Sim (x east, y north) to scene (X east, Z south). Local +X runs from the south tower to the north tower.
  group.position.set(sx, 0, -sy);
  group.rotation.y = Math.atan2(ny - sy, nx - sx);
  return group;
}

/** A navigation buoy that leans with the tide and bobs on the sea. */
export class Buoy {
  readonly group = new THREE.Group();
  constructor(readonly x: number, readonly y: number, color: number) {
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const float = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 1.6, 14), paint);
    float.position.y = 0.3;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 3.2, 10), paint);
    tower.position.y = 2.6;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf1efe7, roughness: 0.5 }));
    top.position.y = 4.4;
    this.group.add(float, tower, top);
    this.group.traverse((o) => { o.castShadow = true; });
    this.group.position.set(x, 0, -y);
    this.group.rotation.order = 'YXZ';
  }

  /** @param set direction the water flows toward, radians clockwise from north. @param drift m/s. */
  update(height: number, set: number, drift: number, time: number): void {
    this.group.position.y = height;
    // The tide streams past and heels the buoy down-current, so a sailor can read the stream off it.
    this.group.rotation.y = -set;
    this.group.rotation.x = -Math.min(0.5, drift * 0.22) + Math.sin(time * 1.3 + this.x) * 0.05;
    this.group.rotation.z = Math.sin(time * 1.1 + this.y) * 0.05;
  }
}
