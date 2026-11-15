import * as THREE from 'three';
import { hash2 } from '../land';
import type { Land } from '../land';
import type { PortPlace } from './caribbean';

// What stands on the made Caribbean besides its hills: the four ports, each a mole, a fort and a handful of houses;
// palms along the low shores near the sloop; and the map of shoal water the sea is tinted by.
// Everything is placed in course metres and moved with the scene's zero (`place`).

const WALL = [0xe9e1cf, 0xd9c8a4, 0xcdb48a, 0xefe9dc];
const ROOF = [0x9a4a32, 0x7d3b2a, 0x8a6b45];
const FLAG: Record<string, number> = { english: 0xa3201c, spanish: 0xc9a227, french: 0xe8e4d8, dutch: 0xd2691e, pirate: 0x121212 };

/** The towns. Schematic: enough to steer for and to know which port it is. */
export class Towns {
  readonly group = new THREE.Group();
  private readonly towns: Array<{ port: PortPlace; node: THREE.Group }> = [];

  constructor(ports: PortPlace[], scene: THREE.Scene, height: (x: number, y: number) => number) {
    this.group.name = 'ports';
    const stone = new THREE.MeshStandardMaterial({ color: 0x9c968a, roughness: 0.95 });
    const quay = new THREE.MeshStandardMaterial({ color: 0xb4a888, roughness: 0.95 });
    ports.forEach((port, pi) => {
      const node = new THREE.Group();
      // Local frame: +Z toward the sea, the town across it.
      node.rotation.y = Math.PI - port.seaward;
      // The town stands on a spit run out from the shore toward the anchorage, as Port Royal does on the Palisadoes:
      // the made coast is drawn too coarsely, and shelves too slowly, for a ship to lie under houses on the shore itself.
      const reach = Math.hypot(port.headX - port.townX, port.headY - port.townY);
      const head = 900 + reach;
      const mole = new THREE.Mesh(new THREE.BoxGeometry(420, 7, head + 250), quay);
      mole.position.set(0, 0.2, (head - 250) / 2);
      node.add(mole);
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1700, 6, 520), quay);
      shelf.position.set(0, 0.4, head - 240);
      node.add(shelf);
      const grand = port.nation !== 'pirate';
      const houses = grand ? 26 : 9;
      for (let i = 0; i < houses; i++) {
        // Drawn half as big again as life, so that a town a mile off reads as one.
        const w = 30 + 26 * hash2(i, pi, 3);
        const d = 24 + 16 * hash2(i, pi, 4);
        const h = (grand ? 13 : 8) + 11 * hash2(i, pi, 5);
        const x = (hash2(i, pi, 6) - 0.5) * 1500;
        const z = head - 450 + hash2(i, pi, 7) * 380;
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: WALL[i % WALL.length], roughness: 0.9 }));
        body.position.set(x, 3.4 + h / 2, z);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.75, h * 0.5, 4), new THREE.MeshStandardMaterial({ color: grand ? ROOF[i % 2] : ROOF[2], roughness: 0.9 }));
        roof.rotation.y = Math.PI / 4;
        roof.position.set(x, 3.4 + h * 1.25, z);
        node.add(body, roof);
      }
      if (grand) {
        // The fort on the point, with the colours over it.
        const fort = new THREE.Mesh(new THREE.BoxGeometry(190, 22, 150), stone);
        fort.position.set(690, 11, head - 120);
        const keep = new THREE.Mesh(new THREE.CylinderGeometry(26, 30, 34, 10), stone);
        keep.position.set(730, 17, head - 110);
        const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 30, 5), stone);
        staff.position.set(730, 49, head - 110);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(26, 16), new THREE.MeshBasicMaterial({ color: FLAG[port.nation], side: THREE.DoubleSide }));
        flag.position.set(743, 56, head - 110);
        node.add(fort, keep, staff, flag);
        const church = new THREE.Mesh(new THREE.BoxGeometry(22, 58, 22), new THREE.MeshStandardMaterial({ color: 0xefe9dc, roughness: 0.9 }));
        church.position.set(-180, 32, head - 260);
        node.add(church);
      }
      this.group.add(node);
      // Stand the town on the ground that was drawn there, if it is higher than the mole.
      node.position.y = Math.max(0, height(port.townX + Math.sin(port.seaward) * 200, port.townY + Math.cos(port.seaward) * 200) - 2.5);
      this.towns.push({ port, node });
    });
    scene.add(this.group);
  }

  /** @param origin the scene's zero, course metres */
  place(origin: { x: number; y: number }): void {
    for (const t of this.towns) {
      // The spit runs from a kilometre inland of the town out toward the anchorage.
      const bx = t.port.townX - Math.sin(t.port.seaward) * 900;
      const by = t.port.townY - Math.cos(t.port.seaward) * 900;
      t.node.position.set(bx - origin.x, t.node.position.y, -(by - origin.y));
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}

/** Coconut palms on the low ground near the water, round the sloop. Drawn only where she is close enough to see them. */
export class Palms {
  private readonly trunks: THREE.InstancedMesh;
  private readonly crowns: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private at = { i: 1e9, j: 1e9 };
  private spots: Array<{ x: number; y: number; h: number; k: number }> = [];
  private static readonly CELL = 260;
  private static readonly REACH = 26;
  private static readonly MAX = 500;

  constructor(private readonly land: Land, private readonly height: (x: number, y: number) => number, private readonly scene: THREE.Scene) {
    this.trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x7a6a52, roughness: 1 }), Palms.MAX);
    const crown = new THREE.ConeGeometry(1, 0.42, 7, 1, true).translate(0, -0.1, 0);
    this.crowns = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x2f6a2a, roughness: 0.9, side: THREE.DoubleSide }), Palms.MAX);
    for (const mesh of [this.trunks, this.crowns]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  }

  /** @param x, y the sloop, course metres */
  update(x: number, y: number, origin: { x: number; y: number }): void {
    const ci = Math.floor(x / Palms.CELL);
    const cj = Math.floor(y / Palms.CELL);
    if (Math.abs(ci - this.at.i) + Math.abs(cj - this.at.j) > 4) {
      this.at = { i: ci, j: cj };
      this.spots = [];
      // Only look when there is land about at all.
      if (this.land.nearest(x, y, Palms.CELL * Palms.REACH)) {
        for (let j = cj - Palms.REACH; j <= cj + Palms.REACH && this.spots.length < Palms.MAX; j++) {
          for (let i = ci - Palms.REACH; i <= ci + Palms.REACH && this.spots.length < Palms.MAX; i++) {
            if (hash2(i, j, 91) > 0.55) continue;
            const px = (i + hash2(i, j, 92)) * Palms.CELL;
            const py = (j + hash2(i, j, 93)) * Palms.CELL;
            const h = this.height(px, py);
            // Palms keep to the low ground by the sea.
            if (h < 2.5 || h > 30) continue;
            this.spots.push({ x: px, y: py, h, k: hash2(i, j, 94) });
          }
        }
      }
    }
    let n = 0;
    for (const sp of this.spots) {
      const tall = 9 + 7 * sp.k;
      this.e.set((sp.k - 0.5) * 0.3, sp.k * 6.3, (hash2(Math.round(sp.x), Math.round(sp.y), 95) - 0.5) * 0.3);
      this.q.setFromEuler(this.e);
      this.p.set(sp.x - origin.x, sp.h - 0.5, -(sp.y - origin.y));
      this.trunks.setMatrixAt(n, this.m.compose(this.p, this.q, this.s.set(1, tall, 1)));
      this.p.y += tall;
      this.crowns.setMatrixAt(n, this.m.compose(this.p, this.q, this.s.set(4.2 + 2 * sp.k, 6, 4.2 + 2 * sp.k)));
      n++;
    }
    this.trunks.count = this.crowns.count = n;
    this.trunks.instanceMatrix.needsUpdate = true;
    this.crowns.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.trunks, this.crowns]) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

/**
 * The map of shoal water the sea is tinted by: a square of the depth chart round the sloop, drawn again when she has
 * sailed a few miles. Red is 0 over deep water and 1 where there is a fathom or less.
 */
export class ShoalMap {
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array<ArrayBuffer>;
  private centre = { x: 1e12, y: 1e12 };
  static readonly N = 192;
  static readonly SIZE = 64000;

  constructor(private readonly depth: (x: number, y: number) => number) {
    this.data = new Uint8Array(new ArrayBuffer(ShoalMap.N * ShoalMap.N * 4));
    this.texture = new THREE.DataTexture(this.data, ShoalMap.N, ShoalMap.N, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
  }

  /** How shoal a depth looks from above, 0 to 1: nothing past twenty fathoms' worth of blue, bright over coral. */
  static tint(metres: number): number {
    if (metres <= 0) return 0.9;
    return Math.max(0, Math.min(1, 1 - (metres - 1.5) / 24)) ** 1.5;
  }

  /**
   * Keep the map round the sloop. Returns the corner of the map in scene metres for the water shader.
   * @param origin the scene's zero, course metres
   */
  update(x: number, y: number, origin: { x: number; y: number }): { x: number; z: number; size: number } {
    if (Math.hypot(x - this.centre.x, y - this.centre.y) > 9000) {
      const cell = ShoalMap.SIZE / ShoalMap.N;
      this.centre = { x: Math.round(x / cell) * cell, y: Math.round(y / cell) * cell };
      const x0 = this.centre.x - ShoalMap.SIZE / 2;
      const y1 = this.centre.y + ShoalMap.SIZE / 2;
      for (let j = 0; j < ShoalMap.N; j++) {
        for (let i = 0; i < ShoalMap.N; i++) {
          // Row 0 is the northern edge. The outermost cells are left deep so the tint ends cleanly.
          const edge = i === 0 || j === 0 || i === ShoalMap.N - 1 || j === ShoalMap.N - 1;
          const v = edge ? 0 : ShoalMap.tint(this.depth(x0 + (i + 0.5) * cell, y1 - (j + 0.5) * cell));
          this.data[(j * ShoalMap.N + i) * 4] = Math.round(v * 255);
          this.data[(j * ShoalMap.N + i) * 4 + 3] = 255;
        }
      }
      this.texture.needsUpdate = true;
    }
    return { x: this.centre.x - ShoalMap.SIZE / 2 - origin.x, z: -(this.centre.y + ShoalMap.SIZE / 2 - origin.y), size: ShoalMap.SIZE };
  }

  dispose(): void {
    this.texture.dispose();
  }
}
