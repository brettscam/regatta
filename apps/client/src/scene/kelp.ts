import * as THREE from 'three';
import type { KelpBed } from '../world/features';
import { hash, smoothNoise } from './terrain';

// Giant kelp at the surface. Where it grows is data and a rule: a water's `features.json` lists the stretches of shore
// that have it (`kelp`), and `kelpCanopy` below, a pure function of those and the chart's depth, says where each
// patch of canopy lies. The scene draws the patches from it; anything else that wants the kelp (a forest under the
// water for a diver, fish that hold on its edge) calls the same function and gets the same patches.

/** One patch of canopy on the surface: its middle, course metres, and its radius. */
export interface KelpPatch {
  x: number;
  y: number;
  r: number;
  /** Which bed it belongs to. */
  bed: string;
}

/** The depths kelp reaches the surface from, metres on the chart, where a bed does not give its own. */
export const KELP_DEPTH: [number, number] = [3.5, 24];
const STEP = 42;

function toLine(line: ReadonlyArray<readonly [number, number]>, x: number, y: number): number {
  let best = 1e9;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
    best = Math.min(best, Math.hypot(x - ax - (bx - ax) * u, y - ay - (by - ay) * u));
  }
  return best;
}

/**
 * Where the canopy is. A pure function of the beds and the charted depth, so every player and every feature sees the
 * same kelp. Patches lie on a loose lattice within each bed's reach of its line, wherever the water is the right
 * depth, in the broad clumps real beds grow in.
 * @param depthAt charted depth at a course position, metres; 0 on land (`ReplayWorld.chartDepth`)
 */
export function kelpCanopy(beds: readonly KelpBed[] | undefined, depthAt: (x: number, y: number) => number): KelpPatch[] {
  const out: KelpPatch[] = [];
  for (const bed of beds ?? []) {
    const [lo, hi] = bed.depth ?? KELP_DEPTH;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of bed.line) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const i0 = Math.floor((x0 - bed.reach) / STEP);
    const i1 = Math.ceil((x1 + bed.reach) / STEP);
    const j0 = Math.floor((y0 - bed.reach) / STEP);
    const j1 = Math.ceil((y1 + bed.reach) / STEP);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = Math.round((i + hash(i, j) * 0.8) * STEP);
        const y = Math.round((j + hash(j + 91, i - 17) * 0.8) * STEP);
        if (toLine(bed.line, x, y) > bed.reach) continue;
        if (bed.clear?.some(([cx, cy, cr]) => Math.hypot(x - cx, y - cy) < cr)) continue;
        const d = depthAt(x, y);
        if (d < lo || d > hi) continue;
        // Beds are patchy: thick for a few hundred metres, then a gap of sand.
        if (smoothNoise(x / 170 + 5, y / 170 - 3) * 0.7 + hash(i * 3 + 1, j * 7 - 2) * 0.3 < 0.44) continue;
        out.push({ x, y, r: Math.round(7 + hash(i - 5, j + 11) * 9), bed: bed.id });
      }
    }
  }
  return out;
}

/** True within a patch of canopy. For a boat that wants to know she is in the weed, or a diver where to go down. */
export function inKelp(patches: readonly KelpPatch[], x: number, y: number): boolean {
  for (const p of patches) if (Math.abs(p.x - x) <= p.r && Math.abs(p.y - y) <= p.r && Math.hypot(p.x - x, p.y - y) <= p.r) return true;
  return false;
}

/**
 * The canopy as it is drawn: one instanced mesh of ragged brown-gold mats lying on the water, a touch proud of it so
 * a small sea washes over their edges. One draw call, eight triangles a patch.
 */
export function buildKelp(patches: readonly KelpPatch[]): THREE.InstancedMesh {
  const sides = 8;
  const pos: number[] = [];
  const idx: number[] = [];
  pos.push(0, 0.1, 0);
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    // Ragged: fronds lie out in tongues, not in a disc.
    const r = k % 2 ? 0.45 + 0.2 * hash(k, 77) : 0.8 + 0.2 * hash(k, 79);
    pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    idx.push(0, 1 + ((k + 1) % sides), 1 + k);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const mesh = new THREE.InstancedMesh(geom, mat, patches.length);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  patches.forEach((p, i) => {
    q.setFromAxisAngle(up, hash(p.x, p.y) * 6.28);
    // Mats lie longer one way than the other, as the swell combs them.
    mtx.compose(new THREE.Vector3(p.x, 0.06, -p.y), q, new THREE.Vector3(p.r * (1 + hash(p.y, p.x) * 0.7), 1, p.r * 0.7));
    mesh.setMatrixAt(i, mtx);
    const t = hash(p.x + 3, p.y - 9);
    mesh.setColorAt(i, c.setRGB(0.17 + t * 0.1, 0.12 + t * 0.07, 0.03 + t * 0.02));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'kelp';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}
