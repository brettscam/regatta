import * as THREE from 'three';
import type { CourseData } from '@slack-tide/world';

/** Repeatable noise in 0..1 from a grid position. */
function hash(i: number, j: number): number {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x: number, y: number): number {
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

  const gold = new THREE.Color(0.52, 0.45, 0.27);
  const scrub = new THREE.Color(0.2, 0.26, 0.15);
  const rock = new THREE.Color(0.38, 0.34, 0.29);
  const shore = new THREE.Color(0.5, 0.47, 0.38);
  const town = new THREE.Color(0.6, 0.59, 0.56);
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

      const e = h[j * nx + Math.min(nx - 1, i + 1)] - h[j * nx + Math.max(0, i - 1)];
      const n = h[Math.min(ny - 1, j + 1) * nx + i] - h[Math.max(0, j - 1) * nx + i];
      const slope = Math.hypot(e, n) / (2 * dx);
      // Summer hills: dry gold grass, with dark scrub in the gullies and on slopes that face away from the sun.
      const patch = smoothNoise(x / 420, y / 420) * 0.6 + smoothNoise(x / 130, y / 130) * 0.4;
      const shade = THREE.MathUtils.clamp(0.5 + (n - e) / (dx * 0.5), 0, 1);
      c.copy(gold).lerp(scrub, THREE.MathUtils.clamp(patch * 0.9 + shade * 0.5 - 0.35, 0, 1));
      c.lerp(rock, THREE.MathUtils.smoothstep(slope, 0.45, 0.9));
      // The city and the built-up shores: low, flat ground on the San Francisco side and the east bay.
      const built = (y < -1900 && x > -8200 && x < 9500) || x > 9000 || (y > 2400 && x < -1500 && x > -4200 && z < 60);
      if (built) c.lerp(town, (1 - THREE.MathUtils.smoothstep(z, 40, 150)) * (0.55 + 0.35 * hash(Math.floor(x / 160), Math.floor(y / 160))));
      c.lerp(shore, 1 - THREE.MathUtils.smoothstep(z, 1, 9));
      const grain = 0.9 + 0.2 * hash(i, j);
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
  const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ vertexColors: true }));
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
  const paint = new THREE.MeshLambertMaterial({ color: 0xb3402e });
  const group = new THREE.Group();
  group.name = 'golden_gate_bridge';
  // Built along local +X from the south tower to the north tower, then turned onto its real bearing.
  const box = (w: number, hgt: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), paint);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  box(span + SIDE * 2, 8, WIDTH, span / 2, DECK - 4, 0);
  for (const tx of [0, span]) {
    for (const side of [-1, 1]) {
      box(10, TOWER, 7, tx, TOWER / 2, side * (WIDTH / 2 + 1));
      box(16, 14, 12, tx, 5, side * (WIDTH / 2 + 1));
    }
    for (const y of [DECK + 22, DECK + 66, DECK + 106, TOWER - 8]) box(8, 9, WIDTH + 2, tx, y, 0);
  }
  // Main cables: a parabola between the towers, straight runs down to the anchorages.
  const pts: number[] = [];
  const seg = (ax: number, ay: number, bx: number, by: number, z: number) => pts.push(ax, ay, z, bx, by, z);
  for (const side of [-1, 1]) {
    const z = side * (WIDTH / 2 + 1);
    const N = 40;
    let px = 0;
    let py = TOWER;
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const x = u * span;
      const y = DECK + 4 + (TOWER - DECK - 4) * (2 * u - 1) ** 2;
      seg(px, py, x, y, z);
      // Suspenders.
      if (i < N) seg(x, y, x, DECK, z);
      px = x;
      py = y;
    }
    seg(0, TOWER, -SIDE, DECK, z);
    seg(span, TOWER, span + SIDE, DECK, z);
  }
  const cables = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
    new THREE.LineBasicMaterial({ color: 0x9a3626 }),
  );
  group.add(cables);
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
