import * as THREE from 'three';
import type { BoatSpec, ControlBinding, SimOutputs, SimState } from '@slack-tide/sim';
import type { BoatDrawing, BoatPose } from '../../boat/boatView';
import { FIGURE_TORSO, Figure, type Kit } from '../../boat/crew';
import { PeriodShip, type ShipLook } from './shipModel';

// The player's sloop as the input layer and the camera need her: the same drawing every other ship has
// (`shipModel.ts`), with her sails laid from the sim, her tiller and sheets to take hold of, and her people on deck.
// Her control nodes are `tiller`, `main_sheet`, `jib_sheet_port` and `jib_sheet_stbd`, as the Caird's are.

const Y = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

// Seamen of 1715 in slops: checked and plain shirts, canvas petticoat-breeches, a head-cloth. No two alike.
const MEN: Kit[] = [
  { jacket: 0x7d2a22, vest: 0x2c2a26, trousers: 0xb8ab8c, skin: 0xb07e58, cap: 0x23201c, kerchief: true },
  { jacket: 0xd8d0b8, vest: 0x4a3b2a, trousers: 0x6b5a40, skin: 0x8a5a3c, cap: 0x8f2f25, kerchief: true },
  { jacket: 0x3d5266, vest: 0xcfc6a8, trousers: 0xc2b594, skin: 0xc09672, cap: 0x2a3340, kerchief: true },
  { jacket: 0xc8b98e, vest: 0x5a2420, trousers: 0x4a4436, skin: 0x6e4630, cap: 0xb9a15a, kerchief: true },
  { jacket: 0x4f5d3a, vest: 0x2a2620, trousers: 0xa99c7c, skin: 0xb58a67, cap: 0x1c1c1c, kerchief: true },
  { jacket: 0xe0d9c6, vest: 0x6b1f1a, trousers: 0x3a342a, skin: 0xa87454, cap: 0x5a2420, kerchief: true },
];

export class SloopView implements BoatDrawing {
  readonly root: THREE.Group;
  readonly ship: PeriodShip;
  readonly pickables: THREE.Object3D[] = [];
  readonly solids: THREE.Object3D[];
  readonly thin: THREE.Object3D[];
  private readonly bindings = new Map<string, ControlBinding>();
  private readonly glowMeshes = new Map<string, THREE.Mesh[]>();
  private glowNode: string | null = null;
  private glowLevel = 0;
  private readonly men: Figure[];
  private side = 1;
  private hoist = 1;
  /** Men to show on deck, of the six there are figures for. */
  hands = 6;
  /** Seconds since each battery fired, for the gun crews' recoil. */
  private readonly v1 = new THREE.Vector3();

  constructor(readonly spec: BoatSpec, look: ShipLook) {
    this.ship = new PeriodShip(look);
    this.root = this.ship.root;
    this.root.name = spec.id;
    this.men = MEN.map((kit, i) => {
      const f = new Figure(`crew_${i}`, kit);
      this.root.add(f.group);
      return f;
    });
    for (const b of spec.controls) this.bindings.set(b.node, b);
    for (const node of this.bindings.keys()) {
      const obj = this.ship.nodes[node];
      if (!obj) continue;
      const meshes: THREE.Mesh[] = [];
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.userData.glow) {
          m.material = (m.material as THREE.MeshStandardMaterial).clone();
          meshes.push(m);
        }
      });
      this.glowMeshes.set(node, meshes);
    }
    this.pickables.push(...this.ship.hitProxies, ...this.ship.thin, this.ship.nodes.hull, this.ship.nodes.deck);
    this.solids = [...this.ship.solids];
    this.thin = [...this.ship.thin];
  }

  resolve(hit: THREE.Intersection): { node: string; binding: ControlBinding | null; view: string } {
    let node = (hit.object.userData.node as string | undefined) ?? '';
    for (let o: THREE.Object3D | null = hit.object; o && !node; o = o.parent) {
      if (o.name && this.ship.nodes[o.name] === o) node = o.name;
    }
    const binding = this.bindings.get(node) ?? null;
    let view = binding?.view ?? '';
    if (!view) {
      const z = this.root.worldToLocal(this.v1.copy(hit.point)).z;
      view = z > this.ship.half * 0.45 ? 'helm' : z > -this.ship.half * 0.4 ? 'mast' : 'foredeck';
    }
    return { node, binding, view };
  }

  setGlow(node: string | null): void {
    if (node === this.glowNode) return;
    if (this.glowNode) this.applyGlow(this.glowNode, 0);
    this.glowNode = node;
    this.glowLevel = 0;
  }

  private applyGlow(node: string, level: number): void {
    for (const m of this.glowMeshes.get(node) ?? []) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissive.setRGB(1.0, 0.62, 0.18);
      mat.emissiveIntensity = level;
    }
  }

  handle(node: string, state: SimState, point: THREE.Vector3, tangent: THREE.Vector3): { metresPerUnit: number } | null {
    const s = this.ship;
    if (node === 'tiller') {
      const a = state.rudder;
      const reach = s.tillerLength - 0.2;
      this.root.localToWorld(point.set(-Math.sin(a) * reach, 0.05, -Math.cos(a) * reach).add(s.rudderHead));
      tangent.set(-Math.cos(a), 0, Math.sin(a)).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: reach };
    }
    if (node === 'main_sheet') {
      const side = Math.sign(state.boomAngle) || state.mainSide;
      const a = state.boomAngle;
      const out = s.boomLength * 0.8;
      this.root.localToWorld(point.set(Math.sin(a) * out, 0, Math.cos(a) * out).add(s.mainTack));
      tangent.set(Math.cos(a) * side, 0, -Math.sin(a) * side).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: out };
    }
    if (node === 'jib_sheet_port' || node === 'jib_sheet_stbd') {
      const side = node === 'jib_sheet_port' ? -1 : 1;
      this.root.localToWorld(point.copy(side < 0 ? s.cleatPort : s.cleatStbd));
      tangent.set(side, 0, 0).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: 4 };
    }
    return null;
  }

  update(pose: BoatPose, state: SimState, out: SimOutputs, time: number, dt: number): void {
    this.root.position.set(pose.x, pose.heave, pose.z);
    this.root.rotation.set(pose.pitch, -pose.heading, -pose.heel);
    this.ship.nodes.tiller.rotation.y = pose.rudder;
    const held = state.hold !== 'none';
    this.hoist = clamp(this.hoist + (held ? -dt : dt) * 0.5, 0, 1);
    const reef = this.spec.sails.main.reefs[state.reef]?.luff ?? 1;
    const shake = (r: { luff: number; flogging: boolean }) => (r.flogging ? 2 : r.luff);
    let boom = pose.boom;
    if (out.main.flogging && !held) boom += Math.sin(time * 6) * 0.03 * Math.min(1.5, out.aws / 8);
    this.ship.setSails({
      boom, jib: pose.jib, awa: out.awa, aws: out.aws, shake: held ? 0 : shake(out.main), jibShake: shake(out.jib),
      hoist: reef * this.hoist, jibSet: !held && state.furl > 0.03,
    }, time, dt);
    if (this.glowNode) {
      this.glowLevel += (1 - this.glowLevel) * Math.min(1, dt * 12);
      this.applyGlow(this.glowNode, this.glowLevel * (1.1 + 0.25 * Math.sin(time * 5)));
    }
    this.poseMen(pose, out, time, dt);
  }

  /** The helmsman at the tiller, and the rest standing to their guns along the weather side. */
  private poseMen(pose: BoatPose, out: SimOutputs, time: number, dt: number): void {
    const s = this.ship;
    const windward = out.awa >= 0 ? 1 : -1;
    this.side += clamp(windward - this.side, -dt * 0.8, dt * 0.8);
    const side = this.side;
    const lean = clamp(pose.heel * 0.8, -0.3, 0.3);
    this.men.forEach((f, i) => {
      f.group.visible = i < this.hands;
      if (!f.group.visible) return;
      f.up.set(-Math.sin(lean), Math.cos(lean), 0);
      if (i === 0) {
        // The helmsman, to windward of the tiller, a hand on it.
        const z = s.rudderHead.z - s.tillerLength * 0.75;
        const deck = s.deckY(z);
        f.fwd.set(-side * 0.25, 0, -1).normalize();
        f.right.crossVectors(f.fwd, Y).normalize();
        f.pelvis.set(side * 0.5, deck + 0.92, z);
        f.neck.copy(f.pelvis).addScaledVector(f.up, FIGURE_TORSO);
        f.footL.set(side * 0.5 - 0.14, deck + 0.03, z + 0.05);
        f.footR.set(side * 0.5 + 0.14, deck + 0.03, z - 0.05);
        f.kneeHint.set(0, 0.2, -1);
        const a = s.nodes.tiller.rotation.y;
        const grip = this.v1.set(-Math.sin(a) * (s.tillerLength - 0.3), 0.06, -Math.cos(a) * (s.tillerLength - 0.3)).add(s.rudderHead);
        if (side >= 0) { f.handL.copy(grip); f.handR.copy(f.pelvis).addScaledVector(f.right, 0.28).y -= 0.08; } else { f.handR.copy(grip); f.handL.copy(f.pelvis).addScaledVector(f.right, -0.28).y -= 0.08; }
        f.look.set(side * 0.3, 0.2, -1);
      } else {
        // Hands along the deck, each by a gun or at the rail, shifting their weight as she moves.
        const spread = [-0.3, 0.05, 0.3, -0.55, 0.5][i - 1] ?? 0;
        const z = s.half * spread;
        const deck = s.deckY(z);
        const which = i % 2 ? side : -side;
        const x = which * (s.halfBreadth(z) - 1.35);
        const sway = Math.sin(time * 0.6 + i * 1.7) * 0.03;
        f.fwd.set(which, 0, -0.25 + 0.2 * Math.sin(i * 2.1)).normalize();
        f.right.crossVectors(f.fwd, Y).normalize();
        f.pelvis.set(x + sway, deck + 0.92, z);
        f.neck.copy(f.pelvis).addScaledVector(f.up, FIGURE_TORSO).addScaledVector(f.fwd, 0.05);
        f.footL.copy(f.pelvis).addScaledVector(f.right, -0.15);
        f.footR.copy(f.pelvis).addScaledVector(f.right, 0.15);
        f.footL.y = f.footR.y = deck + 0.03;
        f.kneeHint.copy(f.fwd).addScaledVector(Y, 0.2);
        f.handL.copy(f.pelvis).addScaledVector(f.right, -0.26).addScaledVector(f.fwd, 0.12);
        f.handR.copy(f.pelvis).addScaledVector(f.right, 0.26).addScaledVector(f.fwd, 0.12);
        f.handL.y -= 0.05;
        f.handR.y += i % 3 === 0 ? 0.35 : -0.05;
        f.look.copy(f.fwd).addScaledVector(Y, 0.05);
      }
      f.elbowHintL.set(-0.6, -1, 0.3);
      f.elbowHintR.set(0.6, -1, 0.3);
      f.apply();
    });
  }
}
