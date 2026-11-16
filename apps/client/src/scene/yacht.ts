import * as THREE from 'three';
import { Massing } from './massing';

type P3 = [number, number, number];
const WHITE = new THREE.Color(0.93, 0.93, 0.9);
const DECK = new THREE.Color(0.82, 0.8, 0.72);
const SPAR = new THREE.Color(0.8, 0.8, 0.78);
const GLASS = new THREE.Color(0.12, 0.15, 0.18);
const BOOT = new THREE.Color(0.1, 0.11, 0.13);

/** Which parts to draw: the hull alone (so a fleet of them can each be tinted), everything above it, or both. */
export type YachtParts = 'hull' | 'rig' | 'all';

/**
 * A yacht lying to her mooring or in her berth, at the detail that reads from a few hundred metres: a hull with a
 * pointed bow, a sheer and a transom, a coachroof with a dark line of windows, a mast, and a boom with the sail
 * stowed on it under a cover. About 120 triangles. Positions are course metres; `turn` is the way her bow points,
 * radians counter-clockwise from east; `z` is the height of her waterline.
 */
export function addYacht(m: Massing, x: number, y: number, z: number, len: number, turn: number, hull: THREE.Color, cover: THREE.Color, parts: YachtParts = 'all'): void {
  const cs = Math.cos(turn);
  const sn = Math.sin(turn);
  /** A point by how far forward of amidships, how far to port, and how high above the water. */
  const at = (f: number, p: number, h: number): P3 => [x + f * cs - p * sn, y + f * sn + p * cs, z + h];
  // Stations from the transom to the stem: where along her, half the beam there, and the height of the deck edge.
  const st: Array<[number, number, number]> = [
    [-0.5, 0.105, 0.088], [-0.22, 0.158, 0.082], [0.08, 0.162, 0.086], [0.32, 0.105, 0.098], [0.5, 0.004, 0.115],
  ];
  const inside = at(0, 0, len * 0.03);
  if (parts !== 'rig') {
    for (let i = 0; i < st.length - 1; i++) {
      const [f0, b0, h0] = st[i];
      const [f1, b1, h1] = st[i + 1];
      for (const s of [-1, 1]) {
        // Topsides, falling in a little to the waterline, with a dark boot top where they meet the water.
        const lo0 = at(f0 * len * 0.94, s * b0 * len * 0.8, -0.25);
        const lo1 = at(f1 * len * 0.94, s * b1 * len * 0.8, -0.25);
        const w0 = at(f0 * len * 0.955, s * b0 * len * 0.86, 0.12);
        const w1 = at(f1 * len * 0.955, s * b1 * len * 0.86, 0.12);
        m.quad(lo0, lo1, w1, w0, BOOT, inside);
        m.quad(w0, w1, at(f1 * len, s * b1 * len, h1 * len), at(f0 * len, s * b0 * len, h0 * len), hull, inside);
      }
    }
    const [tf, tb, th] = st[0];
    m.quad(at(tf * len * 0.94, -tb * len * 0.8, -0.25), at(tf * len * 0.94, tb * len * 0.8, -0.25), at(tf * len, tb * len, th * len), at(tf * len, -tb * len, th * len), hull, inside);
  }
  if (parts === 'hull') return;
  // The deck, from side to side between each pair of stations.
  for (let i = 0; i < st.length - 1; i++) {
    const [f0, b0, h0] = st[i];
    const [f1, b1, h1] = st[i + 1];
    m.quad(at(f0 * len, -b0 * len, h0 * len), at(f0 * len, b0 * len, h0 * len), at(f1 * len, b1 * len, h1 * len), at(f1 * len, -b1 * len, h1 * len), DECK, inside);
  }
  // The coachroof and its windows.
  const deck = len * 0.085;
  const c = at(len * 0.06, 0, 0);
  m.solid({ x: c[0], y: c[1], base: z + deck, w: len * 0.34, d: len * 0.19, h: len * 0.045 + 0.12, turn, color: WHITE, top: 0.86 });
  m.solid({ x: c[0], y: c[1], base: z + deck + len * 0.012, w: len * 0.26, d: len * 0.196, h: len * 0.018, turn, color: GLASS });
  // The cockpit coamings, aft.
  const k = at(-len * 0.3, 0, 0);
  m.solid({ x: k[0], y: k[1], base: z + deck, w: len * 0.2, d: len * 0.2, h: len * 0.02, turn, color: WHITE, roof: DECK.clone().multiplyScalar(0.7) });
  // Mast, boom and the sail stowed along it. Spars are drawn stouter than life so they still show from far off.
  const spar = Math.max(0.2, len * 0.02);
  const mastF = len * 0.14;
  const mastH = len * 1.22;
  m.beam(at(mastF, 0, deck), at(mastF, 0, deck + mastH), spar, spar, SPAR);
  const boomH = deck + len * 0.045 + 0.12 + len * 0.07;
  m.beam(at(mastF, 0, boomH), at(mastF - len * 0.42, 0, boomH), spar * 1.3, spar * 1.6, cover);
  // The rolled jib on the forestay.
  m.beam(at(len * 0.49, 0, len * 0.118), at(mastF + spar, 0, deck + mastH * 0.88), spar * 0.75, spar * 0.75, WHITE);
  // Spreaders.
  m.beam(at(mastF, -len * 0.085, deck + mastH * 0.55), at(mastF, len * 0.085, deck + mastH * 0.55), spar * 0.6, spar * 0.6, SPAR);
}

/**
 * Many moored yachts in two draw calls: the hulls, each tinted its own colour, and everything above the hull.
 * @param boats where each lies (course metres), her length, the way her bow points (radians counter-clockwise from east), and her hull colour
 */
export function mooredFleet(boats: Array<{ x: number; y: number; len: number; turn: number; color: THREE.Color }>, name: string): THREE.Group {
  const unit = 10;
  const part = (which: YachtParts) => {
    const m = new Massing();
    addYacht(m, 0, 0, 0, unit, 0, new THREE.Color(1, 1, 1), new THREE.Color(0.16, 0.26, 0.42), which);
    const built = m.build('');
    const geom = built.geometry;
    geom.deleteAttribute('win');
    (built.material as THREE.Material).dispose();
    return geom;
  };
  const group = new THREE.Group();
  group.name = name;
  const hulls = new THREE.InstancedMesh(part('hull'), new THREE.MeshStandardMaterial({ vertexColors: true, envMapIntensity: 0.8 }), boats.length);
  const rigs = new THREE.InstancedMesh(part('rig'), new THREE.MeshStandardMaterial({ vertexColors: true, envMapIntensity: 0.8 }), boats.length);
  const mat = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  boats.forEach((b, i) => {
    q.setFromAxisAngle(up, b.turn);
    const k = b.len / unit;
    mat.compose(p.set(b.x, 0, -b.y), q, s.set(k, k, k));
    hulls.setMatrixAt(i, mat);
    rigs.setMatrixAt(i, mat);
    hulls.setColorAt(i, b.color);
  });
  hulls.instanceMatrix.needsUpdate = true;
  rigs.instanceMatrix.needsUpdate = true;
  if (hulls.instanceColor) hulls.instanceColor.needsUpdate = true;
  hulls.name = `${name}_hulls`;
  rigs.name = `${name}_rigs`;
  hulls.frustumCulled = false;
  rigs.frustumCulled = false;
  group.add(hulls, rigs);
  return group;
}
