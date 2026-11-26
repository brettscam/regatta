import * as THREE from 'three';
import type { Paddy, School } from '../fishing/grounds';

/** Nothing further off than this is drawn, metres. */
const DRAW_RANGE = 2600;
const BIRDS = 7;

interface Mark { group: THREE.Group; birds: THREE.Object3D[]; foam: THREE.Mesh | null; seen: number }

/**
 * What shows where the fish are: a mat of kelp adrift, white water where a school is up, and birds wheeling over both.
 * Cheap on purpose: a few flat shapes each, only for the ones near enough to see. Where they are comes from the pure
 * `fishing/grounds.ts`, the same for every player.
 */
export class FishMarks {
  private readonly marks = new Map<string, Mark>();
  private readonly kelp = new THREE.MeshStandardMaterial({ color: 0x7a6420, roughness: 0.95, side: THREE.DoubleSide });
  private readonly bulb = new THREE.MeshStandardMaterial({ color: 0xa8892c, roughness: 0.8 });
  private readonly white = new THREE.MeshBasicMaterial({ color: 0xf2f6f7, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
  private readonly wing = new THREE.MeshBasicMaterial({ color: 0x23272b, side: THREE.DoubleSide });
  private readonly paleWing = new THREE.MeshBasicMaterial({ color: 0xe9ecec, side: THREE.DoubleSide });
  private readonly mat: THREE.BufferGeometry;
  private readonly bird: THREE.BufferGeometry;
  private readonly patch: THREE.BufferGeometry;
  private readonly float = new THREE.SphereGeometry(0.22, 6, 5);
  private clock = 0;
  private frame = 0;

  constructor(private readonly scene: THREE.Scene, private readonly seaLevel: (x: number, z: number, seaTime: number) => number) {
    // A ragged mat about ten metres across.
    const mat = new THREE.CircleGeometry(5, 14);
    const p = mat.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 1; i < p.count; i++) {
      const k = 0.62 + 0.5 * Math.abs(Math.sin(i * 2.7));
      p.setXY(i, p.getX(i) * k, p.getY(i) * k);
    }
    mat.rotateX(-Math.PI / 2);
    this.mat = mat;
    // A bird as two flat wings, a metre and a half across.
    const bird = new THREE.BufferGeometry();
    bird.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.25, -0.8, 0.14, 0.05, 0, 0, 0.2, 0, 0, -0.25, 0.8, 0.14, 0.05, 0, 0, 0.2]), 3));
    bird.computeVertexNormals();
    this.bird = bird;
    const patch = new THREE.RingGeometry(1.5, 9, 18, 1);
    patch.rotateX(-Math.PI / 2);
    this.patch = patch;
  }

  private build(kind: 'paddy' | School['kind'], birds: boolean): Mark {
    const group = new THREE.Group();
    let foam: THREE.Mesh | null = null;
    if (kind === 'paddy') {
      group.add(new THREE.Mesh(this.mat, this.kelp));
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(this.float, this.bulb);
        b.position.set(Math.sin(i * 2.1) * 3.2, 0.08, Math.cos(i * 1.7) * 3);
        group.add(b);
      }
    } else {
      foam = new THREE.Mesh(this.patch, this.white);
      foam.scale.setScalar(kind === 'foamer' ? 2.2 : 1.2);
      foam.position.y = 0.12;
      group.add(foam);
    }
    const flock: THREE.Object3D[] = [];
    for (let i = 0; birds && i < BIRDS; i++) {
      const b = new THREE.Mesh(this.bird, i % 3 === 0 ? this.paleWing : this.wing);
      b.scale.setScalar(1.3);
      group.add(b);
      flock.push(b);
    }
    this.scene.add(group);
    return { group, birds: flock, foam, seen: this.frame };
  }

  /**
   * Once a frame.
   * @param eye where the player is, sim metres
   */
  update(dt: number, seaTime: number, eye: { x: number; y: number }, paddies: readonly Paddy[], schools: readonly School[]): void {
    this.clock += dt;
    this.frame++;
    const place = (id: string, kind: 'paddy' | School['kind'], x: number, y: number, birds: boolean, lively: number): void => {
      if (Math.hypot(x - eye.x, y - eye.y) > DRAW_RANGE) return;
      let m = this.marks.get(id);
      if (!m) this.marks.set(id, (m = this.build(kind, birds)));
      m.seen = this.frame;
      m.group.position.set(x, this.seaLevel(x, -y, seaTime), -y);
      if (m.foam) {
        m.foam.rotation.y = this.clock * 0.4;
        (m.foam.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.3 * Math.abs(Math.sin(this.clock * 3.1 + x));
      }
      m.birds.forEach((b, i) => {
        // Round and round over the fish, each at her own height, now and then one down to the water.
        const a = this.clock * (0.35 + 0.05 * i) * lively + i * 0.9;
        const r = 9 + 4 * i;
        const dive = Math.max(0, Math.sin(this.clock * 0.7 + i * 2.3) - 0.8) * 5;
        b.position.set(Math.cos(a) * r, Math.max(0.4, (5 + 1.6 * i) * (1 - dive)), Math.sin(a) * r);
        b.rotation.set(0, -a, Math.sin(this.clock * 6 + i) * 0.25);
      });
    };
    for (const p of paddies) place(`p${p.key}`, 'paddy', p.x, p.y, p.holding, 0.8);
    for (const s of schools) place(`s${s.key}`, s.kind, s.x, s.y, true, s.kind === 'foamer' ? 1.6 : 1.2);
    for (const [id, m] of this.marks) {
      if (m.seen === this.frame) continue;
      this.scene.remove(m.group);
      this.marks.delete(id);
    }
  }

  dispose(): void {
    for (const m of this.marks.values()) this.scene.remove(m.group);
    this.marks.clear();
    for (const g of [this.mat, this.bird, this.patch, this.float]) g.dispose();
    for (const m of [this.kelp, this.bulb, this.white, this.wing, this.paleWing]) m.dispose();
  }
}
