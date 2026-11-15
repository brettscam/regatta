import * as THREE from 'three';
import type { BoatSpec, ControlBinding, SimOutputs, SimState } from '@slack-tide/sim';
import { Rope, type BoatDrawing, type BoatPose } from './boatView';
import { buildCaird, sailcloth, type CairdGeometry, type CairdModel } from './buildCaird';
import { FIGURE_TORSO, Figure, type Kit } from './crew';

// The James Caird as she is drawn each frame: three sails that fill and shake, the sheets, the tiller, and the
// watch on deck. The sim has one mainsail and one headsail. The lug main is its mainsail, the jib its headsail,
// and the mizzen follows the main: it is drawn, and its drive is counted in the main's.

const clamp = THREE.MathUtils.clamp;
const Y = new THREE.Vector3(0, 1, 0);

interface SailCorners {
  tack: THREE.Vector3;
  clew: THREE.Vector3;
  throat: THREE.Vector3;
  peak: THREE.Vector3;
}

/** A piece of canvas stretched between four corners (three, for the jib: throat and peak together). */
class Cloth {
  readonly mesh: THREE.Mesh;
  readonly corners: SailCorners = { tack: new THREE.Vector3(), clew: new THREE.Vector3(), throat: new THREE.Vector3(), peak: new THREE.Vector3() };
  private readonly pos: THREE.BufferAttribute;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  constructor(material: THREE.Material, private readonly cols = 8, private readonly rows = 9) {
    const count = (cols + 1) * (rows + 1);
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) uv.push(i / cols, j / rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * (cols + 1) + i;
        idx.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    g.setAttribute('position', this.pos);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  /**
   * Lay the cloth between its corners.
   * @param belly which way it fills: +1 to starboard, -1 to port
   * @param depth how deep it bellies, metres
   * @param shake 0 drawing, up to 1 lifting along the luff, 2 flogging
   */
  lay(belly: number, depth: number, shake: number, aws: number, time: number, seed: number): void {
    const { tack, clew, throat, peak } = this.corners;
    // Square to the sail and level: the way the wind pushes it.
    this.n.subVectors(clew, tack).cross(Y).normalize().multiplyScalar(-1);
    const hard = Math.min(1.6, aws / 9);
    let p = 0;
    for (let j = 0; j <= this.rows; j++) {
      const v = j / this.rows;
      this.a.lerpVectors(tack, throat, v);
      this.b.lerpVectors(clew, peak, v);
      for (let i = 0; i <= this.cols; i++) {
        const u = i / this.cols;
        const fill = Math.pow(Math.sin(Math.PI * u), 0.85) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.08)));
        // A lifting sail trembles from the luff back. A flogging one cracks like a flag.
        const tremble = shake <= 0 ? 0 : shake < 1.5
          ? Math.sin(time * 21 + u * 7 - v * 5 + seed) * 0.07 * shake * (1 - 0.5 * u) * Math.sin(Math.PI * v)
          : (Math.sin(time * 12 + u * 6 + v * 3 + seed) * 0.22 + Math.sin(time * 27 - u * 11 + seed) * 0.08) * hard * u * Math.sin(Math.PI * Math.min(1, v + 0.1));
        const off = belly * depth * fill * (shake < 1.5 ? 1 - 0.6 * Math.min(1, shake) : 0.15) + tremble;
        this.pos.setXYZ(p++, this.a.x + (this.b.x - this.a.x) * u + this.n.x * off, this.a.y + (this.b.y - this.a.y) * u, this.a.z + (this.b.z - this.a.z) * u + this.n.z * off);
      }
    }
    this.pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

// Burberry windproofs over wool, gone dark with grease and wet. Three men to a watch.
const MEN: Kit[] = [
  { jacket: 0x7a6c56, vest: 0x6b5e4a, trousers: 0x3c3832, skin: 0xb58a67, cap: 0x5e5546, hood: true, bulk: 1.22 },
  { jacket: 0x62665a, vest: 0x55594e, trousers: 0x38352f, skin: 0xbf9372, cap: 0x7a715f, hood: true, bulk: 1.26 },
  { jacket: 0x85735a, vest: 0x75654e, trousers: 0x403b33, skin: 0xa87d5c, cap: 0x4a463e, hood: true, bulk: 1.2 },
];

export class CairdView implements BoatDrawing {
  readonly root: THREE.Group;
  readonly model: CairdModel;
  readonly pickables: THREE.Object3D[] = [];
  readonly solids: THREE.Object3D[];
  readonly thin: THREE.Object3D[];

  private readonly geo: CairdGeometry;
  private readonly bindings = new Map<string, ControlBinding>();
  private readonly glowMeshes = new Map<string, THREE.Mesh[]>();
  private glowNode: string | null = null;
  private glowLevel = 0;

  private readonly main: Cloth;
  private readonly mizzen: Cloth;
  private readonly jib: Cloth;
  private readonly boom = new THREE.Group();
  private readonly yard = new Rope(0x9a7a52, 0.034);
  private readonly mizzenYard = new Rope(0x9a7a52, 0.024);
  private readonly mainSheet = new Rope(0x9b8a66, 0.012);
  private readonly mizzenSheet = new Rope(0x9b8a66, 0.009);
  private readonly sheetPort = [new Rope(0x9b8a66, 0.01), new Rope(0x9b8a66, 0.01)];
  private readonly sheetStbd = [new Rope(0x9b8a66, 0.01), new Rope(0x9b8a66, 0.01)];
  private readonly halyard = new Rope(0x1f1c19, 0.008);
  private readonly warp = new Rope(0x9b8a66, 0.02);
  private readonly bundle: THREE.Mesh;
  private readonly men: Figure[];

  private belly = 1;
  /** 1 with the main set, 0 with it lowered and lashed down. */
  private hoist = 1;
  /** Which side the helmsman sits: +1 starboard. He keeps to windward. */
  private side = 1;
  private started = false;

  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();

  constructor(readonly spec: BoatSpec) {
    this.model = buildCaird(spec);
    this.root = this.model.root;
    this.root.rotation.order = 'YXZ';
    this.geo = this.model.geo;
    const geo = this.geo;

    const canvas = new THREE.MeshStandardMaterial({ map: sailcloth(), roughness: 0.95, side: THREE.DoubleSide });
    this.main = new Cloth(canvas, 8, 10);
    this.mizzen = new Cloth(canvas, 5, 6);
    this.jib = new Cloth(canvas, 6, 8);
    for (const [name, cloth] of [['main', this.main], ['mizzen', this.mizzen], ['jib', this.jib]] as const) {
      cloth.mesh.name = name;
      this.model.nodes[name] = cloth.mesh;
      this.root.add(cloth.mesh);
    }

    // The boom along the foot of the lug. The mainsheet is worked by pointing at it.
    this.boom.name = 'main_sheet';
    this.boom.position.copy(geo.mainTack);
    const sparMat = new THREE.MeshStandardMaterial({ color: 0x9a7a52, roughness: 0.7 });
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, geo.boomLength, 7).rotateX(Math.PI / 2), sparMat);
    spar.position.z = geo.boomLength / 2 - 0.28;
    spar.castShadow = true;
    spar.userData.glow = true;
    this.boom.add(spar);
    const grab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, geo.boomLength + 0.2), new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.set(0, 0.1, geo.boomLength / 2 - 0.28);
    grab.userData.node = 'main_sheet';
    this.boom.add(grab);
    this.model.nodes.main_sheet = this.boom;
    this.model.hitProxies.push(grab);
    this.root.add(this.boom);

    // The main lowered and lashed along the deck, for when she lies to the sea anchor.
    this.bundle = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, geo.boomLength - 0.3, 3, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa9a08a, roughness: 1 }));
    this.bundle.position.set(0.12, geo.deckY(geo.mastZ + 1.4) + 0.12, geo.mastZ + 1.45);
    this.bundle.visible = false;
    this.bundle.castShadow = true;
    this.root.add(this.bundle);

    for (const r of [this.yard, this.mizzenYard, this.mainSheet, this.mizzenSheet, ...this.sheetPort, ...this.sheetStbd, this.halyard, this.warp]) this.root.add(r.mesh);
    this.warp.mesh.visible = false;
    this.warp.mesh.castShadow = false;

    this.men = MEN.map((kit, i) => {
      const f = new Figure(`crew_${i}`, kit);
      this.root.add(f.group);
      this.model.nodes[f.group.name] = f.group;
      return f;
    });

    for (const b of spec.controls) this.bindings.set(b.node, b);
    for (const node of this.bindings.keys()) {
      const obj = this.model.nodes[node];
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

    this.pickables.push(...this.model.hitProxies, this.main.mesh, this.jib.mesh, this.mizzen.mesh, this.model.nodes.hull, this.model.nodes.deck);
    this.solids = [...this.model.solids];
    this.thin = [this.main.mesh, this.jib.mesh, this.mizzen.mesh];
  }

  resolve(hit: THREE.Intersection): { node: string; binding: ControlBinding | null; view: string } {
    let node = (hit.object.userData.node as string | undefined) ?? '';
    for (let o: THREE.Object3D | null = hit.object; o && !node; o = o.parent) {
      if (o.name && this.model.nodes[o.name] === o) node = o.name;
    }
    const binding = this.bindings.get(node) ?? null;
    let view = binding?.view ?? '';
    if (!view) {
      if (node === 'main' || node === 'mast') view = 'mast';
      else if (node === 'jib') view = 'foredeck';
      else {
        const z = this.root.worldToLocal(this.v1.copy(hit.point)).z;
        view = z > 0.9 ? 'helm' : z > -1.9 ? 'mast' : 'foredeck';
      }
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
    const geo = this.geo;
    if (node === 'tiller') {
      // Put the tiller to port and the rudder goes to starboard: she turns to starboard.
      const a = state.rudder;
      const reach = geo.tillerLength - 0.12;
      this.root.localToWorld(point.set(-Math.sin(a) * reach, 0.03, -Math.cos(a) * reach).add(geo.rudderHead));
      tangent.set(-Math.cos(a), 0, Math.sin(a)).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: reach };
    }
    if (node === 'main_sheet') {
      const side = Math.sign(state.boomAngle) || state.mainSide;
      const a = state.boomAngle;
      const out = geo.boomLength - 0.28;
      this.root.localToWorld(point.set(Math.sin(a) * out, 0, Math.cos(a) * out).add(geo.mainTack));
      tangent.set(Math.cos(a) * side, 0, -Math.sin(a) * side).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: out };
    }
    if (node === 'jib_sheet_port' || node === 'jib_sheet_stbd') {
      const side = node === 'jib_sheet_port' ? -1 : 1;
      this.root.localToWorld(point.copy(side < 0 ? geo.cleatPort : geo.cleatStbd));
      tangent.set(side, 0, 0).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: 1.6 };
    }
    return null;
  }

  update(pose: BoatPose, state: SimState, out: SimOutputs, time: number, dt: number): void {
    const { nodes, geo } = this.model;
    this.root.position.set(pose.x, pose.heave, pose.z);
    this.root.rotation.set(pose.pitch, -pose.heading, -pose.heel);
    nodes.tiller.rotation.y = pose.rudder;

    const windSide = out.awa >= 0 ? 1 : -1;
    const bellyTarget = Math.abs(out.awa) < 0.05 ? 0 : -windSide;
    this.belly += clamp(bellyTarget - this.belly, -dt * 3.5, dt * 3.5);
    const held = state.hold !== 'none';
    this.hoist = clamp(this.hoist + (held ? -dt : dt) * 0.6, 0, 1);
    const reef = this.spec.sails.main.reefs[state.reef]?.luff ?? 1;
    const up = reef * this.hoist;
    const set = up > 0.08;

    // ---- the lug mainsail: it turns about the mast with the boom -------------------------------
    let a = pose.boom;
    if (out.main.flogging && !held) a += Math.sin(time * 9.5) * 0.04 * Math.min(1.5, out.aws / 8);
    this.boom.rotation.y = a;
    const tackY = geo.mainTack.y;
    const at = (r: number, y: number, twist: number, o: THREE.Vector3) => o.set(Math.sin(a * twist) * r, y, geo.mastZ + Math.cos(a * twist) * r);
    const c = this.main.corners;
    at(-0.28, tackY + 0.04, 1, c.tack);
    at(geo.boomLength - 0.36, tackY + 0.08, 1, c.clew);
    at(-0.62, tackY + 2.1 * up, 1.1, c.throat);
    at(1.7, Math.max(tackY + 0.5, tackY + 3.8 * up), 1.18, c.peak);
    const shake = (r: { luff: number; flogging: boolean }) => (r.flogging ? 2 : r.luff);
    this.main.mesh.visible = set;
    this.yard.mesh.visible = set;
    this.halyard.mesh.visible = set;
    this.bundle.visible = !set;
    if (set) {
      this.main.lay(this.belly, 0.3, shake(out.main), out.aws, time, 0);
      this.v1.lerpVectors(c.throat, c.peak, -0.07);
      this.v2.lerpVectors(c.throat, c.peak, 1.06);
      this.yard.set(this.v1, this.v2);
      // The halyard: from the yard, a third of the way along it, to the masthead.
      this.halyard.set(this.v1.lerpVectors(c.throat, c.peak, 0.3), this.v2.set(0, geo.mastTopY - 0.12, geo.mastZ));
    }
    at(geo.boomLength - 0.4, tackY - 0.03, 1, this.v1);
    this.mainSheet.set(this.v1, geo.sheetLead);

    // ---- the mizzen follows the main, sheeted to the bumkin -------------------------------------
    {
      const am = clamp(a * 0.6, -0.75, 0.75);
      const y0 = geo.deckY(geo.mizzenZ) + 0.42;
      const m = this.mizzen.corners;
      const mz = (r: number, y: number, o: THREE.Vector3) => o.set(geo.mizzenX + Math.sin(am) * r, y, geo.mizzenZ + Math.cos(am) * r);
      mz(-0.14, y0, m.tack);
      mz(1.2, y0 + 0.05, m.clew);
      mz(-0.32, y0 + 1.0, m.throat);
      mz(0.8, y0 + 1.85, m.peak);
      // Lying to the sea anchor the mizzen is sheeted flat to hold her head up.
      this.mizzen.lay(held ? 0 : this.belly, 0.13, held ? 0.4 : shake(out.main) * 0.7, out.aws, time, 3);
      this.v1.lerpVectors(m.throat, m.peak, -0.08);
      this.v2.lerpVectors(m.throat, m.peak, 1.08);
      this.mizzenYard.set(this.v1, this.v2);
      this.mizzenSheet.set(m.clew, this.v2.set(geo.mizzenX, y0 - 0.25, geo.half + 0.95));
    }

    // ---- the jib ---------------------------------------------------------------------------------
    {
      const j = this.jib.corners;
      const ja = pose.jib;
      j.tack.copy(geo.stemHead);
      j.clew.set(Math.sin(ja) * geo.jibFoot, geo.stemHead.y + 0.16, geo.stemHead.z + Math.cos(ja) * geo.jibFoot);
      j.throat.copy(geo.jibHead);
      j.peak.copy(geo.jibHead);
      const jibUp = !held && state.furl > 0.03;
      this.jib.mesh.visible = jibUp;
      for (const r of [...this.sheetPort, ...this.sheetStbd]) r.mesh.visible = jibUp;
      if (jibUp) {
        this.jib.lay(this.belly, 0.17, shake(out.jib), out.aws, time, 7);
        this.sheetPort[0].set(j.clew, geo.leadPort);
        this.sheetPort[1].set(geo.leadPort, geo.cleatPort);
        this.sheetStbd[0].set(j.clew, geo.leadStbd);
        this.sheetStbd[1].set(geo.leadStbd, geo.cleatStbd);
      }
    }

    this.updateWarp(state);

    if (this.glowNode) {
      this.glowLevel += (1 - this.glowLevel) * Math.min(1, dt * 12);
      this.applyGlow(this.glowNode, this.glowLevel * (1.1 + 0.25 * Math.sin(time * 5)));
    }
    this.poseMen(pose, out, time, dt);
  }

  /** Hove to: the warp of the sea anchor leads from the stem down into the sea ahead. */
  private updateWarp(state: SimState): void {
    const warp = this.warp.mesh;
    if (state.hold === 'none') {
      warp.visible = false;
      return;
    }
    warp.visible = true;
    const bow = this.v1.copy(this.geo.stemHead);
    // The far end stays in the water ahead of her however she pitches and rolls.
    const end = this.v2.set(0, 0, -this.geo.half - 7).applyQuaternion(this.yaw.setFromAxisAngle(Y, this.root.rotation.y));
    end.y = -2.6 - this.root.position.y;
    end.applyQuaternion(this.q1.copy(this.root.quaternion).invert());
    this.warp.set(bow, end);
  }

  private readonly yaw = new THREE.Quaternion();

  private poseMen(pose: BoatPose, out: SimOutputs, time: number, dt: number): void {
    const geo = this.geo;
    const windward = out.awa >= 0 ? 1 : -1;
    if (!this.started) {
      this.started = true;
      this.side = windward;
    }
    this.side += clamp(windward - this.side, -dt * 1.2, dt * 1.2);
    const s = this.side;
    const lean = clamp(pose.heel * 0.7, -0.3, 0.3);
    const coaming = geo.deckY((geo.wellFwdZ + geo.wellAftZ) / 2) + 0.1;
    const sole = geo.wellSoleY;

    // The helmsman, on the after thwart to windward of the tiller, one hand on it.
    {
      const f = this.men[0];
      f.up.set(-Math.sin(lean), Math.cos(lean), 0);
      f.fwd.set(-s * 0.25, 0, -1).normalize();
      f.right.crossVectors(f.fwd, Y).normalize();
      const z = geo.wellAftZ - 0.16;
      f.pelvis.set(s * 0.22, 0.78, z);
      f.neck.copy(f.pelvis).addScaledVector(f.up, FIGURE_TORSO - 0.02 + Math.sin(time * 1.5) * 0.004);
      f.neck.z -= 0.08;
      f.footL.set(s * 0.22 - 0.1, sole, z - 0.42);
      f.footR.set(s * 0.22 + 0.1, sole, z - 0.4);
      f.kneeHint.set(0, 0.6, -1);
      const tiller = this.model.nodes.tiller.rotation.y;
      const grip = this.v1.set(-Math.sin(tiller) * (geo.tillerLength - 0.14), 0.05, -Math.cos(tiller) * (geo.tillerLength - 0.14)).add(geo.rudderHead);
      const rest = this.v2.copy(f.pelvis).addScaledVector(f.fwd, 0.34).addScaledVector(f.right, s * 0.12);
      rest.y += 0.16;
      // The hand nearer the centreline steers.
      if (s >= 0) { f.handL.copy(grip); f.handR.copy(rest); } else { f.handR.copy(grip); f.handL.copy(rest); }
      f.elbowHintL.set(-0.5, -1, 0.4);
      f.elbowHintR.set(0.5, -1, 0.4);
      f.look.set(s * 0.35, 0.18 + Math.sin(time * 0.21) * 0.05, -1);
      f.apply();
    }

    // The look-out: standing in the forward end of the well, braced on the coaming, watching ahead and to windward.
    {
      const f = this.men[1];
      f.up.set(-Math.sin(lean * 0.8), Math.cos(lean * 0.8), 0);
      f.fwd.set(0, 0, -1);
      f.right.set(1, 0, 0);
      const z = geo.wellFwdZ + 0.24;
      const sway = Math.sin(time * 0.7) * 0.015;
      f.pelvis.set(-s * 0.1 + sway, sole + 0.9, z);
      f.neck.copy(f.pelvis).addScaledVector(f.up, FIGURE_TORSO);
      f.neck.z -= 0.14;
      f.footL.set(-s * 0.1 - 0.13, sole, z + 0.08);
      f.footR.set(-s * 0.1 + 0.13, sole, z + 0.02);
      f.kneeHint.set(0, 0.2, -1);
      f.handL.set(-0.3, coaming + 0.03, geo.wellFwdZ - 0.02);
      f.handR.set(0.3, coaming + 0.03, geo.wellFwdZ - 0.02);
      f.elbowHintL.set(-0.8, -0.6, 0.5);
      f.elbowHintR.set(0.8, -0.6, 0.5);
      f.look.set(s * (0.5 + 0.3 * Math.sin(time * 0.13)), 0.02, -1);
      f.apply();
    }

    // The third hand, sitting low out of the wind on the lee side, back to the weather.
    {
      const f = this.men[2];
      f.up.set(0, 1, 0);
      f.fwd.set(-s * 0.9, 0, 0.45).normalize();
      f.right.crossVectors(f.fwd, Y).normalize();
      const z = (geo.wellFwdZ + geo.wellAftZ) / 2 + 0.05;
      f.pelvis.set(-s * 0.2, 0.5, z);
      f.neck.copy(f.pelvis).addScaledVector(Y, FIGURE_TORSO - 0.05).addScaledVector(f.fwd, 0.16);
      f.footL.copy(f.pelvis).addScaledVector(f.fwd, 0.42).addScaledVector(f.right, -0.1);
      f.footR.copy(f.pelvis).addScaledVector(f.fwd, 0.42).addScaledVector(f.right, 0.1);
      f.footL.y = f.footR.y = sole;
      // Inside the planking.
      f.footL.x = clamp(f.footL.x, -0.34, 0.34);
      f.footR.x = clamp(f.footR.x, -0.34, 0.34);
      f.kneeHint.copy(f.fwd).addScaledVector(Y, 1.2);
      f.handL.copy(f.pelvis).addScaledVector(f.fwd, 0.3).addScaledVector(f.right, -0.12);
      f.handR.copy(f.pelvis).addScaledVector(f.fwd, 0.3).addScaledVector(f.right, 0.12);
      f.handL.y += 0.2;
      f.handR.y += 0.2;
      f.elbowHintL.copy(f.right).multiplyScalar(-0.7).addScaledVector(Y, -1);
      f.elbowHintR.copy(f.right).multiplyScalar(0.7).addScaledVector(Y, -1);
      f.look.copy(f.fwd).addScaledVector(Y, -0.25);
      f.apply();
    }
  }
}
