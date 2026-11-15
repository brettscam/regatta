import * as THREE from 'three';
import { hash2 } from './land';
import type { ExpeditionSea } from './sea';
import type { Voyage } from './voyage';

// Ice afloat in the first days: bergs and growlers drifting up from the Weddell Sea, south of about 60 S.
// Things to see and steer among. STAGE 2: nothing here can be hit yet. `at()` is where a collision test would ask.

const CELL = 2600;
const REACH = 6;
const MAX = 160;

export interface Berg {
  x: number;
  y: number;
  /** Half length, half height above water and half width, metres. */
  length: number;
  height: number;
  width: number;
  turn: number;
}

export class Icefield {
  private readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(private readonly sea: ExpeditionSea, private readonly voyage: Voyage, private readonly scene: THREE.Scene) {
    const shape = new THREE.IcosahedronGeometry(1, 1);
    // Knock the points about so no two faces catch the light alike, and flatten the bottom into the sea.
    const pos = shape.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const k = 0.78 + 0.44 * hash2(Math.round(pos.getX(i) * 50), Math.round(pos.getY(i) * 50 + pos.getZ(i) * 31), 5);
      pos.setXYZ(i, pos.getX(i) * k, Math.max(-0.35, pos.getY(i) * k), pos.getZ(i) * k);
    }
    shape.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(shape, new THREE.MeshStandardMaterial({ color: 0xdfe9f1, roughness: 0.55, flatShading: true }), MAX);
    this.mesh.name = 'ice';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** How thick the ice lies at a place and time, 0 to 1: none north of the limit, none once the days are up. */
  density(y: number, t: number): number {
    const lat = this.sea.projection.toLatLon(0, y).lat;
    const south = Math.min(1, Math.max(0, (this.voyage.ice.north - lat) / 0.9));
    const early = Math.min(1, Math.max(0, (this.voyage.ice.days * 86400 - t) / 43200));
    return south * early;
  }

  /** The ice in one cell of the sea, if there is any. The same for every seed-and-place, so it stays put as she passes. */
  at(i: number, j: number, t: number): Berg | null {
    const seed = this.sea.seed;
    const x = (i + 0.15 + 0.7 * hash2(i, j, seed + 31)) * CELL;
    const y = (j + 0.15 + 0.7 * hash2(i, j, seed + 32)) * CELL;
    if (hash2(i, j, seed + 30) > 0.62 * this.density(y, t)) return null;
    // Mostly growlers and bergy bits, now and then a berg the size of a church.
    const big = hash2(i, j, seed + 33);
    const length = big > 0.86 ? 45 + 90 * hash2(i, j, seed + 34) : 3 + 14 * hash2(i, j, seed + 34);
    return { x, y, length, height: length * (0.22 + 0.3 * hash2(i, j, seed + 35)), width: length * (0.45 + 0.4 * hash2(i, j, seed + 36)), turn: hash2(i, j, seed + 37) * Math.PI * 2 };
  }

  /**
   * Draw the ice round the boat.
   * @param origin where the scene's zero is, course metres
   * @param seaLevel height of the sea at a scene position
   */
  update(x: number, y: number, t: number, origin: { x: number; y: number }, seaTime: number, seaLevel: (x: number, z: number) => number): void {
    if (this.density(y, t) <= 0 && this.density(y - REACH * CELL, t) <= 0) {
      this.mesh.count = 0;
      return;
    }
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(y / CELL);
    let n = 0;
    for (let j = cj - REACH; j <= cj + REACH && n < MAX; j++) {
      for (let i = ci - REACH; i <= ci + REACH && n < MAX; i++) {
        const b = this.at(i, j, t);
        if (!b) continue;
        const sx = b.x - origin.x;
        const sz = -(b.y - origin.y);
        // Small ice rides the swell. A big berg hardly feels it.
        const ride = b.length > 40 ? 0.15 : 0.85;
        this.p.set(sx, seaLevel(sx, sz) * ride + Math.sin(seaTime * 0.5 + b.turn) * 0.1, sz);
        this.e.set(Math.sin(seaTime * 0.31 + b.turn) * 0.03, b.turn, Math.cos(seaTime * 0.27 + b.turn) * 0.03);
        this.s.set(b.length, b.height, b.width);
        this.mesh.setMatrixAt(n++, this.m.compose(this.p, this.q.setFromEuler(this.e), this.s));
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
