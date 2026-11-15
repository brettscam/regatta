import * as THREE from 'three';
import type { BoatSpec, ControlBinding, SimOutputs, SimState } from '@slack-tide/sim';
import { buildSloop, type Livery, type SloopGeometry, type SloopModel } from './buildSloop';

export type { BoatDisplay, Livery } from './buildSloop';
import { Jib, Mainsail, Spinnaker, spinnakerColour, sunCover, type SailShape } from './sails';
import { clothOf, type SailStyle } from './sailStyle';
import { Crew } from './crew';
import type { Avatar } from './avatar';

const R2D = 180 / Math.PI;
const KT = 0.514444;
/** Turns of the wheel per radian of rudder. About 210 degrees of wheel for full rudder. */
export const WHEEL_RATIO = 6;

/** Where the boat is drawn this frame. Sim values, blended between steps, plus the motion the waves add. */
export interface BoatPose {
  x: number;
  z: number;
  heading: number;
  heel: number;
  pitch: number;
  heave: number;
  rudder: number;
  boom: number;
  jib: number;
}

class Rope {
  readonly mesh: THREE.Mesh;
  private static readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  constructor(color: number, radius = 0.011) {
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 5), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    this.mesh.castShadow = true;
  }
  set(a: THREE.Vector3, b: THREE.Vector3): void {
    this.dir.subVectors(b, a);
    const len = this.dir.length() || 1e-4;
    this.mesh.position.copy(a).addScaledVector(this.dir, 0.5);
    this.mesh.scale.set(1, len, 1);
    this.mesh.quaternion.setFromUnitVectors(Rope.up, this.dir.multiplyScalar(1 / len));
  }
}

/**
 * A telltale: a length of yarn on the sail that shows what the air is doing there. Drawn as a ribbon of a few
 * joints, so it streams with a ripple running down it, lifts when the sail is starved and thrashes when it stalls.
 */
class Telltale {
  readonly mesh: THREE.Mesh;
  private static readonly JOINTS = 6;
  private readonly pos: Float32Array;
  private readonly attr: THREE.BufferAttribute;
  constructor(color: number, private readonly length = 0.42, private readonly width = 0.034) {
    const n = Telltale.JOINTS;
    this.pos = new Float32Array(n * 2 * 3);
    this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.attr);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
  }
  /**
   * Stream from `at` along `flow`, in the boat's frame. `lift` raises it toward vertical (negative: it droops),
   * `flutter` shakes it: a little is a telltale flying true, a lot is one that has lost the flow.
   */
  set(at: THREE.Vector3, flow: THREE.Vector3, lift: number, flutter: number, time: number, seed: number): void {
    const n = Telltale.JOINTS;
    let dx = flow.x;
    let dy = flow.y + lift;
    let dz = flow.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    // Sideways, square to the flow and level.
    const hl = Math.hypot(dx, dz) || 1;
    const sx = -dz / hl;
    const sz = dx / hl;
    const wild = Math.min(1.2, flutter);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const whip = k * k;
      const a = Math.sin(time * (16 + (seed % 4)) - k * 6.5 + seed * 2.1);
      const b = Math.sin(time * 27 - k * 10 + seed * 5.3);
      const up = (a * (0.05 + 0.34 * wild) + b * 0.16 * wild) * whip;
      const out = (b * (0.03 + 0.2 * wild) + a * 0.1 * wild) * whip;
      // Yarn that has lost the flow sags under its own weight.
      const sag = -0.5 * wild * whip * (lift < 0 ? 1 : 0.35);
      const L = this.length * k;
      const x = at.x + (dx + sx * out) * L;
      const y = at.y + (dy + up + sag) * L;
      const z = at.z + (dz + sz * out) * L;
      const half = this.width * 0.5 * (i === n - 1 ? 0.35 : 1);
      const o = i * 6;
      this.pos[o] = x; this.pos[o + 1] = y + half; this.pos[o + 2] = z;
      this.pos[o + 3] = x; this.pos[o + 4] = y - half; this.pos[o + 5] = z;
    }
    this.attr.needsUpdate = true;
  }
}

/**
 * The spinnaker in one small number, for telling other boats: tenths hoisted (0 to 10), plus 20 for each ninth of
 * curl in the luff (0 to 9), plus 200 when it has collapsed.
 */
export function packSpin(state: SimState, out: SimOutputs): number {
  const hoist = Math.round((state.spinHoist || 0) * 10);
  return hoist ? hoist + 20 * Math.round(out.spin.luff * 9) + (out.spin.flogging ? 200 : 0) : 0;
}

/** Put a spinnaker another boat reported onto the state and outputs her view is drawn from. Call after her wind angle is set. */
export function unpackSpin(sp: number, state: SimState, out: SimOutputs): void {
  const n = Number.isFinite(sp) && sp > 0 ? Math.min(399, Math.round(sp)) : 0;
  state.spinHoist = Math.min(10, n % 20) / 10;
  state.spin = state.spinHoist > 0;
  out.spin.flogging = n >= 200;
  out.spin.luff = out.spin.flogging ? 1 : Math.floor((n % 200) / 20) / 9;
  // Her sheet is not sent: the clew is drawn where a trimmed one would be for her wind.
  const awa = Math.abs(out.awa);
  state.spinAngle = -(out.awa >= 0 ? 1 : -1) * Math.min(awa, Math.max(0.24, 0.55 * awa - 0.14));
}

export class BoatView {
  readonly root: THREE.Group;
  readonly model: SloopModel;
  readonly main: Mainsail;
  readonly jib: Jib;
  /** The spinnaker, in the boat's own colour. Hidden until it is hoisted. */
  readonly spinnaker: Spinnaker;
  private readonly spinSheet = new Rope(0xe9c23a, 0.008);
  private readonly spinTackLine = new Rope(0xe9c23a, 0.008);
  /** Everything the pointer can land on. */
  readonly pickables: THREE.Object3D[] = [];
  /** Solid parts the camera keeps out of. */
  readonly solids: THREE.Object3D[];
  /** Thin parts the camera hops across. */
  readonly thin: THREE.Object3D[];

  private readonly bindings = new Map<string, ControlBinding>();
  private readonly glowMeshes = new Map<string, THREE.Mesh[]>();
  private glowNode: string | null = null;
  private glowLevel = 0;
  private belly = 1;
  private windexAngle = 0;
  private winchSpin = { winch_port: 0, winch_stbd: 0 };
  private lastSheet = { winch_port: 0, winch_stbd: 0 };

  /** The mainsheet is a four-part tackle between a block on the boom and one on the traveller. */
  private readonly mainsheet = [new Rope(0xe8e4d8, 0.0065), new Rope(0xe8e4d8, 0.0065), new Rope(0xe8e4d8, 0.0065), new Rope(0xe8e4d8, 0.0065)];
  private readonly sheetBlock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }),
  );
  private ensignAngle = Math.PI / 2;
  private readonly pilotCanvas = document.createElement('canvas');
  private readonly pilotTexture: THREE.CanvasTexture;
  private pilotShown = '';
  private readonly vang = new Rope(0x2a2d31, 0.014);
  private readonly sheetPort = [new Rope(0xb5332a), new Rope(0xb5332a), new Rope(0xb5332a)];
  private readonly sheetStbd = [new Rope(0x2f8f55), new Rope(0x2f8f55), new Rope(0x2f8f55)];
  private readonly jibTells: Array<{ v: number; port: Telltale; stbd: Telltale }> = [];
  private readonly leechTells: Array<{ v: number; t: Telltale }> = [];

  private readonly crew: Crew;
  private readonly displayCanvas = document.createElement('canvas');
  private readonly displayTexture: THREE.CanvasTexture;
  private displayClock = 0;

  /** At anchor or on a mooring: the main under its cover on the boom, the jib rolled on the forestay, and the line she lies to. */
  private readonly sailCover: THREE.Mesh;
  private readonly jibRoll = new Rope(0x1b2d4a, 0.042);
  /** The part of the mainsail that is not up the mast, tied down along the boom: a reef's bunt, or the whole sail flaked. */
  private readonly bunt: THREE.Mesh;
  /** True while the main is lowered because she is lying head to wind under engine. Hoisted again when she pays off. */
  private mainDown = false;
  private sails: SailStyle | undefined;
  private readonly rode = new Rope(0xd9d3c2, 0.018);
  /** 0 with the jib as the furling line has it, 1 with it rolled right away for a stop. */
  private jibStow = 0;

  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();

  constructor(readonly spec: BoatSpec, readonly livery: Livery = {}) {
    this.model = buildSloop(spec, livery);
    this.root = this.model.root;
    this.root.rotation.order = 'YXZ';
    this.sails = livery.sails;
    const cloth = clothOf(this.sails);
    this.main = new Mainsail(this.model.geo, String((spec as BoatSpec & { lengthFt?: number }).lengthFt ?? 38), cloth);
    this.jib = new Jib(this.model.geo, cloth);
    this.spinnaker = new Spinnaker(this.model.geo, this.kiteColour(), this.sails?.kite);
    this.root.add(this.main.mesh, this.jib.mesh, this.spinnaker.mesh, this.spinSheet.mesh, this.spinTackLine.mesh);
    this.spinSheet.mesh.visible = this.spinTackLine.mesh.visible = false;
    this.crew = new Crew(this.model);
    if (livery.avatar) this.crew.setAvatar(livery.avatar);
    this.model.nodes.main = this.main.mesh;
    this.model.nodes.jib = this.jib.mesh;

    for (const b of spec.controls) this.bindings.set(b.node, b);

    // Give each control part its own materials so it can light up without lighting its neighbours.
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

    for (const r of [...this.mainsheet, this.vang, ...this.sheetPort, ...this.sheetStbd]) this.root.add(r.mesh);

    // The stowed main: a cover zipped over the sail where it lies flaked on the boom, fuller at the mast.
    const coverLength = this.model.geo.boomLength - 0.5;
    this.sailCover = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.2, coverLength, 12, 1).rotateX(Math.PI / 2).scale(0.8, 1.2, 1),
      new THREE.MeshStandardMaterial({ color: 0x1b2d4a, roughness: 0.95 }),
    );
    this.sailCover.position.set(0, 0.27, coverLength / 2 + 0.22);
    this.sailCover.castShadow = true;
    this.sailCover.visible = false;
    this.model.nodes.boom.add(this.sailCover);
    this.jibRoll.set(this.model.geo.jibTack, this.model.geo.jibHead);
    (this.jibRoll.mesh.material as THREE.MeshStandardMaterial).color.setHex(sunCover(cloth));
    // The bunt: sailcloth gathered on the boom in folds, with ties round it.
    const buntLength = this.model.geo.boomLength - 0.45;
    const folds = new THREE.CylinderGeometry(0.15, 0.24, buntLength, 12, 18).rotateX(Math.PI / 2);
    const fp = folds.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) {
      const z = fp.getZ(i);
      const k = 1 + 0.15 * Math.sin(z * 11) + 0.07 * Math.sin(z * 23 + 1);
      fp.setXY(i, fp.getX(i) * k, fp.getY(i) * k);
    }
    folds.computeVertexNormals();
    this.bunt = new THREE.Mesh(folds, new THREE.MeshStandardMaterial({ color: cloth.base, roughness: 0.9 }));
    this.bunt.position.set(0, 0.2, buntLength / 2 + 0.2);
    this.bunt.castShadow = true;
    this.bunt.visible = false;
    const tie = new THREE.CylinderGeometry(0.2, 0.2, 0.035, 10).rotateX(Math.PI / 2);
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x1b2d4a, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(tie, tieMat);
      t.position.z = (i / 3 - 0.5) * buntLength * 0.78;
      t.scale.setScalar(1 + 0.12 * (1 - i / 3));
      this.bunt.add(t);
    }
    this.model.nodes.boom.add(this.bunt);
    this.jibRoll.mesh.visible = false;
    this.rode.mesh.visible = false;
    this.rode.mesh.castShadow = false;
    this.root.add(this.jibRoll.mesh, this.rode.mesh);
    this.sheetBlock.castShadow = true;
    this.root.add(this.sheetBlock);
    for (const v of [0.28, 0.5, 0.72]) {
      const port = new Telltale(0xe2392a);
      const stbd = new Telltale(0x2fc46c);
      this.root.add(port.mesh, stbd.mesh);
      this.jibTells.push({ v, port, stbd });
    }
    for (const v of [0.35, 0.6, 0.84]) {
      const t = new Telltale(0xe2392a, 0.5);
      this.root.add(t.mesh);
      this.leechTells.push({ v, t });
    }

    this.displayCanvas.width = 512;
    this.displayCanvas.height = 256;
    this.displayTexture = new THREE.CanvasTexture(this.displayCanvas);
    this.displayTexture.colorSpace = THREE.SRGBColorSpace;
    const display = this.model.nodes.mast_display as THREE.Mesh;
    (display.material as THREE.Material[])[4] = new THREE.MeshBasicMaterial({ map: this.displayTexture, toneMapped: false });

    // The autopilot head's screen.
    this.pilotCanvas.width = 300;
    this.pilotCanvas.height = 220;
    this.pilotTexture = new THREE.CanvasTexture(this.pilotCanvas);
    this.pilotTexture.colorSpace = THREE.SRGBColorSpace;
    const pilotScreen = this.model.nodes.autopilot_screen as THREE.Mesh | undefined;
    if (pilotScreen) pilotScreen.material = new THREE.MeshBasicMaterial({ map: this.pilotTexture, toneMapped: false });
    this.setPilot({ engaged: false, mode: 'heading', label: '' });

    this.pickables.push(...this.model.hitProxies, this.main.mesh, this.jib.mesh, this.model.nodes.hull, this.model.nodes.deck);
    this.solids = [this.model.nodes.hull, this.model.nodes.deck];
    this.thin = [this.main.mesh, this.jib.mesh, this.spinnaker.mesh, ...this.model.solids.filter((s) => s !== this.model.nodes.hull && s !== this.model.nodes.deck)];
  }

  /** The colour a plain spinnaker is cut in: the livery's, else the hull's made bright. */
  private kiteColour(): string {
    return this.livery.spinnaker ?? spinnakerColour(this.livery.topsides ?? (this.spec as BoatSpec & { topsides?: string }).topsides);
  }

  /**
   * Change her sails: the cloth of the main and jib, and the spinnaker's design. For the player's own boat when the
   * choice is made, and for another player's when her style arrives. Nothing is rebuilt but the pictures on the cloth,
   * and those are shared between boats that wear the same.
   */
  setSailStyle(style: SailStyle | undefined): void {
    this.sails = style;
    const cloth = clothOf(style);
    this.main.setCloth(cloth);
    this.jib.setCloth(cloth);
    this.spinnaker.setDesign(this.kiteColour(), style?.kite);
    (this.bunt.material as THREE.MeshStandardMaterial).color.setHex(cloth.base);
    (this.jibRoll.mesh.material as THREE.MeshStandardMaterial).color.setHex(sunCover(cloth));
  }

  /** Which named part a pointer hit belongs to, and the control bound to it if there is one. */
  resolve(hit: THREE.Intersection): { node: string; binding: ControlBinding | null; view: string } {
    let node = (hit.object.userData.node as string | undefined) ?? '';
    for (let o: THREE.Object3D | null = hit.object; o && !node; o = o.parent) {
      if (o.name && this.model.nodes[o.name] === o) node = o.name;
    }
    const binding = this.bindings.get(node) ?? null;
    // The working view for whatever was pointed at.
    let view = binding?.view ?? '';
    if (!view) {
      if (node === 'main' || node === 'mast') view = 'mast';
      else if (node === 'jib' || node === 'furler') view = 'foredeck';
      else {
        const z = this.root.worldToLocal(this.v1.copy(hit.point)).z;
        view = z > 1.6 ? 'helm' : z > -2.4 ? 'mast' : 'foredeck';
      }
    }
    return { node, binding, view };
  }

  /** Light up one control part, or none. */
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

  /** A world-space point on a control part and the direction it moves as the control's value goes up. */
  handle(node: string, state: SimState, point: THREE.Vector3, tangent: THREE.Vector3): { metresPerUnit: number } | null {
    const geo = this.model.geo;
    if (node === 'wheel') {
      // The top of the rim moves to starboard as the wheel turns to starboard.
      const R = geo.wheelRadius;
      this.root.localToWorld(point.copy(geo.wheel).add(this.v1.set(0, R, 0)));
      tangent.set(1, 0, 0).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: R * WHEEL_RATIO };
    }
    if (node === 'boom') {
      // Easing lets the boom end swing further out on the side it is already on.
      const side = Math.sign(state.boomAngle) || state.mainSide;
      const a = state.boomAngle;
      this.root.localToWorld(point.set(Math.sin(a) * geo.boomLength, 0, Math.cos(a) * geo.boomLength).add(geo.gooseneck));
      tangent.set(Math.cos(a) * side, 0, -Math.sin(a) * side).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: geo.boomLength };
    }
    if (node === 'autopilot') {
      // The control head on the cabin bulkhead. Turning its dial to the right raises the value.
      this.model.nodes.autopilot.getWorldPosition(point);
      tangent.set(1, 0, 0).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: 1 };
    }
    if (node === 'winch_port' || node === 'winch_stbd') {
      // Pulling in toward the centreline grinds the sheet in, which lowers the slack.
      const side = node === 'winch_port' ? -1 : 1;
      this.root.localToWorld(point.copy(side < 0 ? geo.winchPort : geo.winchStbd));
      tangent.set(side, 0, 0).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: 2.2 };
    }
    return null;
  }

  /** Where the rig is, for anything that draws around the sails. */
  get rig(): SloopGeometry {
    return this.model.geo;
  }

  update(pose: BoatPose, state: SimState, out: SimOutputs, time: number, dt: number): void {
    const { nodes, geo } = this.model;
    this.root.position.set(pose.x, pose.heave, pose.z);
    this.root.rotation.set(pose.pitch, -pose.heading, -pose.heel);

    nodes.wheel.rotation.z = -pose.rudder * WHEEL_RATIO;
    nodes.rudder.rotation.y = pose.rudder;

    // Under engine with her head to the wind the mainsail does no work, and must not look as if it did.
    // In gear, it is strapped amidships and shivers. Lying there in neutral, the crew get it down and flaked on the
    // boom, and it goes up again when she pays off or the engine stops. The sim's sail is untouched either way.
    const headToWind = state.engineOn && state.hold === 'none';
    if (headToWind && state.throttle === 0 && Math.abs(out.awa) < 0.45 && state.speed < 1.2) this.mainDown = true;
    else if (!headToWind || Math.abs(out.awa) > 0.7) this.mainDown = false;
    const strapped = headToWind && !this.mainDown && state.throttle !== 0 && Math.abs(out.awa) < 0.5 ? 1 - Math.abs(out.awa) / 0.5 : 0;
    const boom = pose.boom * (1 - 0.85 * Math.min(1, strapped * 2));
    nodes.boom.rotation.y = boom;

    // The sails belly away from the wind. Crossing the wind they pass through flat.
    const windSide = out.awa >= 0 ? 1 : -1;
    const bellyTarget = Math.abs(out.awa) < 0.05 ? 0 : -windSide;
    this.belly += THREE.MathUtils.clamp(bellyTarget - this.belly, -dt * 3.5, dt * 3.5);

    // Held by an anchor or a mooring, the sails are not set: the main comes down onto the boom and the jib rolls away.
    const held = state.hold !== 'none';
    const lowered = held || this.mainDown;
    const reefLuff = this.spec.sails.main.reefs[state.reef].luff;
    // Coming down or going up, the sail is slack: it shakes all the way.
    const halfUp = this.main.hoisted < reefLuff - 0.04;
    const mainShape: SailShape = {
      angle: boom,
      luff: halfUp ? 1 : Math.max(out.main.luff, strapped * 0.8),
      stall: out.main.stall,
      flogging: (out.main.flogging && strapped < 0.2) || halfUp,
      belly: this.belly, aws: out.aws,
    };
    // Reefing is quick work. Lowering and hoisting the whole sail takes a few seconds.
    this.main.update(mainShape, lowered ? 0 : reefLuff, time, dt, lowered || halfUp ? 0.8 : 1.5);
    const down = this.main.hoisted < 0.06;
    const mainStowed = held && down;
    this.main.mesh.visible = !down;
    this.sailCover.visible = mainStowed;
    // What is not up the mast lies along the boom: a roll for a reef, the whole sail in folds when she is lowered.
    const gathered = Math.sqrt(Math.max(0, 1 - this.main.hoisted));
    this.bunt.visible = !mainStowed && gathered > 0.12;
    this.bunt.scale.set(0.25 + 0.6 * gathered, 0.3 + 0.85 * gathered, 1);
    // A loose boom shakes with the sail.
    if (mainShape.flogging && !down) nodes.boom.rotation.y += Math.sin(time * 9.5) * 0.035 * Math.min(1.5, out.aws / 8);

    const jibShape: SailShape = { angle: pose.jib, luff: out.jib.luff, stall: out.jib.stall, flogging: out.jib.flogging, belly: this.belly, aws: out.aws, backed: out.jib.backed };
    // Under the spinnaker the jib is rolled away too, and comes back out when the spinnaker is down.
    const kite = state.spinHoist || 0;
    this.jibStow = THREE.MathUtils.clamp(this.jibStow + (lowered || state.spin || kite > 0.5 ? dt : -dt) * 0.7, 0, 1);
    const spinShape: SailShape = { angle: state.spinAngle || 0, luff: out.spin.luff, stall: out.spin.stall, flogging: out.spin.flogging, belly: this.belly, aws: out.aws };
    this.spinnaker.update(spinShape, held ? 0 : kite, time, dt);
    const kiteUp = this.spinnaker.mesh.visible;
    this.spinSheet.mesh.visible = this.spinTackLine.mesh.visible = kiteUp;
    if (kiteUp) {
      // The sheet leads aft to the leeward quarter, the tack line down to the stem.
      const lee = this.spinnaker.clew.x <= 0 ? geo.winchPort : geo.winchStbd;
      this.spinSheet.set(this.spinnaker.clew, this.v1.set(lee.x * 1.25, lee.y - 0.1, lee.z + 0.9));
      this.spinTackLine.set(this.spinnaker.tack, geo.jibTack);
    }
    const furl = state.furl * (1 - this.jibStow);
    this.jib.update(jibShape, furl, time);

    // Running rigging.
    const boomA = nodes.boom.rotation.y;
    const onBoom = (dist: number, drop: number, o: THREE.Vector3) =>
      o.set(Math.sin(boomA) * dist, -drop, Math.cos(boomA) * dist).add(geo.gooseneck);
    // Mainsheet: four parts fanned between the boom block and the traveller block.
    const sheetTop = onBoom(geo.boomLength * 0.83, 0.2, this.v1);
    this.sheetBlock.position.copy(sheetTop);
    this.sheetBlock.position.y += 0.07;
    this.sheetBlock.rotation.y = boomA;
    this.mainsheet.forEach((part, i) => {
      const off = (i - 1.5) * 0.022;
      this.v2.set(sheetTop.x + Math.cos(boomA) * off, sheetTop.y + 0.05, sheetTop.z - Math.sin(boomA) * off);
      this.v3.set(geo.traveller.x + off * 1.4, geo.traveller.y + 0.12, geo.traveller.z);
      part.set(this.v2, this.v3);
    });
    this.vang.set(onBoom(geo.boomLength * 0.29, 0.08, this.v1), geo.vangBase);
    const clew = this.jib.clew;
    const jibUp = furl > 0.03;
    // The roll on the forestay thickens as the sail goes round it.
    const rolled = 1 - Math.max(0, furl);
    this.jibRoll.mesh.visible = rolled > 0.04;
    this.jibRoll.mesh.scale.x = this.jibRoll.mesh.scale.z = 0.28 + 0.72 * Math.sqrt(rolled);
    const leeIsPort = clew.x <= 0;
    const around = this.v2.set((leeIsPort ? -1 : 1) * 0.16, geo.jibClewY - 0.3, geo.mastZ - 0.24);
    const lead = (ropes: Rope[], car: THREE.Vector3, winch: THREE.Vector3, working: boolean) => {
      for (const r of ropes) r.mesh.visible = jibUp;
      if (!jibUp) return;
      if (working) {
        ropes[0].set(clew, car);
        ropes[1].set(car, winch);
        ropes[2].mesh.visible = false;
      } else {
        // The lazy sheet leads round the front of the mast to the other side.
        ropes[0].set(clew, around);
        ropes[1].set(around, car);
        ropes[2].set(car, winch);
      }
    };
    lead(this.sheetPort, geo.carPort, geo.winchPort, leeIsPort);
    lead(this.sheetStbd, geo.carStbd, geo.winchStbd, !leeIsPort);

    // Winch drums turn as their sheets move.
    for (const name of ['winch_port', 'winch_stbd'] as const) {
      const sheet = name === 'winch_port' ? state.jibSheetPort : state.jibSheetStbd;
      this.winchSpin[name] += (sheet - this.lastSheet[name]) * 9;
      this.lastSheet[name] = sheet;
      nodes[`${name}_drum`].rotation.y = this.winchSpin[name];
    }

    // Telltales. The windward one lifts when the sail is starved (too close to the wind or eased too far).
    // The leeward one flutters and droops when the sail is stalled (sheeted too hard).
    const flow = this.v3;
    for (let i = 0; i < this.jibTells.length; i++) {
      const tt = this.jibTells[i];
      tt.port.mesh.visible = tt.stbd.mesh.visible = jibUp;
      if (!jibUp) continue;
      const at = this.jib.surfacePoint(0.16, tt.v, this.v1, flow);
      const nx = flow.z;
      const nz = -flow.x;
      const windwardIsStbd = this.belly < 0;
      const starved = out.jib.flogging ? 1 : out.jib.luff;
      const stalled = Math.max(out.jib.stall, out.jib.backed);
      for (const [tell, isStbd] of [[tt.port, false], [tt.stbd, true]] as const) {
        const off = isStbd ? 0.03 : -0.03;
        this.v2.set(at.x + nx * off, at.y, at.z + nz * off);
        const windward = isStbd === windwardIsStbd;
        const lift = windward ? starved * 1.1 : -stalled * 0.9;
        const flutter = windward ? starved * 0.9 : stalled * 1.0;
        tell.set(this.v2, flow, lift, flutter + 0.04, time, i + (isStbd ? 10 : 0));
      }
    }
    for (let i = 0; i < this.leechTells.length; i++) {
      const lt = this.leechTells[i];
      lt.t.mesh.visible = !down;
      if (down) continue;
      const at = this.main.leechPoint(lt.v, this.v1);
      const a = boomA;
      flow.set(Math.sin(a), 0, Math.cos(a));
      // A stalled main hides its leech ribbons behind the sail: they curl to leeward and droop.
      const stalled = out.main.stall;
      flow.x += this.belly * stalled * 1.2;
      lt.t.set(at, flow, -stalled * 0.8, out.main.luff * 0.8 + stalled * 0.5 + 0.05, time, 20 + i);
    }

    // Masthead vane points to where the apparent wind comes from.
    const want = -out.awa;
    let dA = want - this.windexAngle;
    dA = Math.atan2(Math.sin(dA), Math.cos(dA));
    this.windexAngle += dA * Math.min(1, dt * 6);
    nodes.windex_arrow.rotation.y = this.windexAngle + Math.sin(time * 5.1) * 0.03;

    this.updateEnsign(out, time, dt);
    this.updateRode(state);

    if (this.glowNode) {
      this.glowLevel += (1 - this.glowLevel) * Math.min(1, dt * 12);
      this.applyGlow(this.glowNode, this.glowLevel * (1.1 + 0.25 * Math.sin(time * 5)));
    }

    this.crew.update(state, out, pose, time, dt);

    this.displayClock -= dt;
    if (this.displayClock <= 0) {
      this.displayClock = 0.25;
      this.drawDisplay(state, out);
    }
  }

  /**
   * The line she lies to. At anchor the rode leads from the bow roller down into the water toward the anchor.
   * On a mooring a short line leads from the bow to the buoy, once she has been brought up to it.
   */
  private updateRode(state: SimState): void {
    const rode = this.rode.mesh;
    if (state.hold === 'none') {
      rode.visible = false;
      return;
    }
    const pos = this.root.position;
    const bow = this.v1.copy(this.model.nodes.furler.position);
    bow.y -= 0.12;
    bow.z -= 0.22;
    const bowWorld = this.v3.copy(bow).applyQuaternion(this.root.quaternion).add(pos);
    const dx = state.holdX - bowWorld.x;
    const dz = -state.holdY - bowWorld.z;
    const away = Math.hypot(dx, dz);
    // On a mooring the line goes to the buoy itself. An anchor cable sags, so it goes into the water close ahead
    // of the bow and steeply, whatever length is out.
    const mooring = state.hold === 'mooring';
    const k = mooring ? 1 : Math.min(away, 5) / Math.max(away, 0.01);
    const end = this.v2.set(bowWorld.x + dx * k, mooring ? 0.55 : -3, bowWorld.z + dz * k);
    end.sub(pos).applyQuaternion(this.q1.copy(this.root.quaternion).invert());
    // Still coming up to the buoy: the line is not on yet.
    rode.visible = !mooring || away < 16;
    if (rode.visible) this.rode.set(bow, end);
  }

  /** The ensign streams away from the apparent wind, lifts as it freshens and hangs when it is light. */
  private updateEnsign(out: SimOutputs, time: number, dt: number): void {
    const group = this.model.nodes.ensign;
    const flag = this.model.nodes.ensign_flag as THREE.Mesh | undefined;
    if (!group || !flag) return;
    // The fly is the flag's local +X. Turn it to point downwind in the boat's frame.
    const want = Math.atan2(-Math.cos(out.awa), -Math.sin(out.awa));
    let d = want - this.ensignAngle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.ensignAngle += d * Math.min(1, dt * 4);
    group.rotation.y = this.ensignAngle + Math.sin(time * 2.3) * 0.06;
    const fly = flag.userData.fly as number;
    const hoist = flag.userData.hoist as number;
    const wind = Math.min(1.4, out.aws / 7);
    const droop = 1 - Math.min(1, out.aws / 5);
    const pos = flag.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cols = 13;
    for (let i = 0; i < pos.count; i++) {
      const u = (i % cols) / (cols - 1);
      const v = Math.floor(i / cols) / 5;
      const wave = Math.sin(u * 8 - time * (9 + 6 * wind) + v * 1.7) * 0.05 * u * (0.25 + wind)
        + Math.sin(u * 15 - time * 17 + v * 3.1) * 0.016 * u * wind;
      pos.setXYZ(i, u * fly * (1 - 0.4 * droop * u), -v * hoist - droop * 0.8 * u * u * fly, wave);
    }
    pos.needsUpdate = true;
    flag.geometry.computeVertexNormals();
  }

  /**
   * Show the autopilot's state on its control head.
   * Redraws only when something changes.
   */
  /** Dress the skipper at the wheel. */
  setAvatar(avatar: Avatar): void {
    this.crew.setAvatar(avatar);
  }

  setPilot(info: { engaged: boolean; mode: 'heading' | 'wind' | 'route'; label: string }): void {
    const key = `${info.engaged}|${info.mode}|${info.label}`;
    if (key === this.pilotShown) return;
    this.pilotShown = key;
    const g = this.pilotCanvas.getContext('2d')!;
    const W = this.pilotCanvas.width;
    const H = this.pilotCanvas.height;
    const on = info.engaged;
    g.fillStyle = on ? '#0c3b33' : '#071216';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = on ? '#57e6b6' : '#1d3c46';
    g.lineWidth = on ? 6 : 3;
    g.strokeRect(5, 5, W - 10, H - 10);
    const modeName = info.mode === 'heading' ? 'HEADING' : info.mode === 'wind' ? 'WIND ANGLE' : 'ROUTE';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = '700 26px ui-sans-serif, system-ui, sans-serif';
    g.fillStyle = on ? '#9ff5d6' : '#5f8f9b';
    g.fillText(modeName, 20, 38);
    if (on) {
      g.fillStyle = '#57e6b6';
      g.fillRect(W - 96, 20, 78, 36);
      g.fillStyle = '#062019';
      g.textAlign = 'center';
      g.font = '800 24px ui-sans-serif, system-ui, sans-serif';
      g.fillText('AUTO', W - 57, 39);
    }
    // The big line: what she is holding. Shrink long names to fit.
    g.textAlign = 'center';
    const big = on ? info.label || '—' : 'STANDBY';
    let size = on ? 92 : 52;
    g.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
    while (g.measureText(big).width > W - 36 && size > 26) {
      size -= 4;
      g.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
    }
    g.fillStyle = on ? '#f2fffb' : '#4f7480';
    g.fillText(big, W / 2, on ? 128 : 112);
    if (!on && info.label) {
      g.font = '600 30px ui-sans-serif, system-ui, sans-serif';
      g.fillStyle = '#3f616b';
      g.fillText(info.label, W / 2, 168);
    }
    this.pilotTexture.needsUpdate = true;
    // The dial's mark turns with the mode, as a small sign of life.
    const knob = this.model.nodes.autopilot_knob;
    if (knob) knob.rotation.z = info.mode === 'heading' ? 0.5 : info.mode === 'wind' ? 0 : -0.5;
  }

  private drawDisplay(state: SimState, out: SimOutputs): void {
    const g = this.displayCanvas.getContext('2d')!;
    const W = this.displayCanvas.width;
    const H = this.displayCanvas.height;
    g.fillStyle = '#071216';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1d3c46';
    g.lineWidth = 3;
    g.strokeRect(4, 4, W - 8, H - 8);
    g.beginPath();
    g.moveTo(W / 2, 10);
    g.lineTo(W / 2, H - 10);
    g.moveTo(10, H / 2);
    g.lineTo(W - 10, H / 2);
    g.stroke();
    const cell = (cx: number, cy: number, label: string, value: string) => {
      g.fillStyle = '#6fa8b6';
      g.font = '600 24px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(label, cx - 112, cy - 28);
      g.fillStyle = '#eafcff';
      g.font = '700 76px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'right';
      g.fillText(value, cx + 112, cy + 44);
    };
    const awa = Math.abs(out.awa) * R2D;
    cell(W * 0.25, H * 0.25, 'SPD', (state.speed / KT).toFixed(1));
    cell(W * 0.75, H * 0.25, 'HDG', String(Math.round(state.heading * R2D) % 360).padStart(3, '0'));
    cell(W * 0.25, H * 0.75, out.awa >= 0 ? 'AWA S' : 'AWA P', awa.toFixed(0));
    cell(W * 0.75, H * 0.75, 'AWS', (out.aws / KT).toFixed(0));
    this.displayTexture.needsUpdate = true;
  }
}
