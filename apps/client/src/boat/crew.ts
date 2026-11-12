import * as THREE from 'three';
import type { SimOutputs, SimState } from '@slack-tide/sim';
import type { SloopModel } from './buildSloop';
import type { BoatPose } from './boatView';

// Two people on the boat: one at the wheel, one on the windward cockpit seat.
// Each figure is a handful of fixed-length limbs laid between joints that are worked out every frame
// in the boat frame (+X starboard, +Y up, -Z forward), so hands stay on the wheel while bodies lean against heel.

const THIGH = 0.44;
const SHIN = 0.44;
const UPPER_ARM = 0.3;
const FOREARM = 0.29;
const TORSO = 0.54;
const ANKLE = 0.07;
const WHEEL_RADIUS = 0.52;

const Y = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const t1 = new THREE.Vector3();
const t2 = new THREE.Vector3();
const t3 = new THREE.Vector3();
const basis = new THREE.Matrix4();

interface Kit {
  jacket: number;
  vest: number;
  trousers: number;
  skin: number;
  cap: number;
}

// Shared shapes for both figures.
const GEO = {
  thigh: new THREE.CapsuleGeometry(0.068, THIGH, 1, 5),
  shin: new THREE.CapsuleGeometry(0.055, SHIN, 1, 5),
  upperArm: new THREE.CapsuleGeometry(0.052, UPPER_ARM, 1, 5),
  forearm: new THREE.CapsuleGeometry(0.044, FOREARM, 1, 5),
  torso: new THREE.CapsuleGeometry(0.13, 0.36, 2, 7),
  vest: new THREE.CapsuleGeometry(0.143, 0.14, 2, 7),
  head: new THREE.SphereGeometry(0.105, 8, 6),
  cap: new THREE.SphereGeometry(0.112, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.BoxGeometry(0.15, 0.012, 0.1),
  shades: new THREE.BoxGeometry(0.17, 0.036, 0.03),
  hand: new THREE.SphereGeometry(0.046, 6, 4),
  foot: new THREE.BoxGeometry(0.1, 0.075, 0.25),
};

/**
 * Two-bone reach: where the middle joint (knee, elbow) sits for a limb from `root` to `target`.
 * `hint` says which way the joint bends. If the target is out of reach, `end` stops short of it.
 */
function reach(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, hint: THREE.Vector3, joint: THREE.Vector3, end: THREE.Vector3): void {
  const n = t1.subVectors(target, root);
  const d = n.length();
  if (d < 1e-5) n.set(0, -1, 0);
  else n.multiplyScalar(1 / d);
  const dc = clamp(d, Math.abs(l1 - l2) + 0.005, l1 + l2 - 0.004);
  const along = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
  const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const perp = t2.copy(hint).addScaledVector(n, -hint.dot(n));
  if (perp.lengthSq() < 1e-8) perp.set(n.y, -n.x, 0.01);
  perp.normalize();
  joint.copy(root).addScaledVector(n, along).addScaledVector(perp, out);
  end.copy(root).addScaledVector(n, dc);
}

function layBetween(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = t1.subVectors(b, a);
  const len = dir.length() || 1e-4;
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(Y, dir.multiplyScalar(1 / len));
}

class Figure {
  readonly group = new THREE.Group();

  // Inputs: set these, then call apply().
  readonly pelvis = new THREE.Vector3();
  readonly neck = new THREE.Vector3();
  /** The figure's own right-hand side, facing direction and up. Unit vectors. */
  readonly right = new THREE.Vector3(1, 0, 0);
  readonly fwd = new THREE.Vector3(0, 0, -1);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly footL = new THREE.Vector3();
  readonly footR = new THREE.Vector3();
  readonly handL = new THREE.Vector3();
  readonly handR = new THREE.Vector3();
  readonly look = new THREE.Vector3(0, 0, -1);
  readonly kneeHint = new THREE.Vector3(0, 0.3, -1);
  readonly elbowHintL = new THREE.Vector3(-0.6, -1, 0.3);
  readonly elbowHintR = new THREE.Vector3(0.6, -1, 0.3);

  private readonly torso: THREE.Mesh;
  private readonly vest: THREE.Mesh;
  private readonly head = new THREE.Group();
  private readonly limbs: Record<'thighL' | 'thighR' | 'shinL' | 'shinR' | 'upperL' | 'upperR' | 'foreL' | 'foreR', THREE.Mesh>;
  private readonly hands: [THREE.Mesh, THREE.Mesh];
  private readonly feet: [THREE.Mesh, THREE.Mesh];

  private readonly x = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly z = new THREE.Vector3();
  private readonly root = new THREE.Vector3();
  private readonly joint = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly ankle = new THREE.Vector3();

  constructor(name: string, kit: Kit) {
    this.group.name = name;
    const mat = (color: number, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
    const jacket = mat(kit.jacket, 0.7);
    const vest = mat(kit.vest);
    const trousers = mat(kit.trousers);
    const skin = mat(kit.skin, 0.75);
    const cap = mat(kit.cap);
    const dark = mat(0x16181b, 0.5);
    const part = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.group) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    this.torso = part(GEO.torso, jacket);
    this.vest = part(GEO.vest, vest);
    this.limbs = {
      thighL: part(GEO.thigh, trousers), thighR: part(GEO.thigh, trousers),
      shinL: part(GEO.shin, trousers), shinR: part(GEO.shin, trousers),
      upperL: part(GEO.upperArm, jacket), upperR: part(GEO.upperArm, jacket),
      foreL: part(GEO.forearm, jacket), foreR: part(GEO.forearm, jacket),
    };
    this.hands = [part(GEO.hand, skin), part(GEO.hand, skin)];
    this.feet = [part(GEO.foot, dark), part(GEO.foot, dark)];
    // Head, built facing -Z: cap, brim and sunglasses show which way it is looking.
    this.group.add(this.head);
    part(GEO.head, skin, this.head);
    part(GEO.cap, cap, this.head).position.y = 0.012;
    part(GEO.brim, cap, this.head).position.set(0, 0.03, -0.14);
    part(GEO.shades, dark, this.head).position.set(0, 0.005, -0.092);
  }

  apply(): void {
    // Torso: wider across the shoulders than it is deep.
    const dir = this.dir.subVectors(this.neck, this.pelvis);
    const len = dir.length() || 1e-4;
    dir.multiplyScalar(1 / len);
    const x = this.x.copy(this.right).addScaledVector(dir, -this.right.dot(dir)).normalize();
    const z = this.z.crossVectors(x, dir);
    basis.makeBasis(x, dir, z);
    this.torso.quaternion.setFromRotationMatrix(basis);
    this.torso.position.copy(this.pelvis).addScaledVector(dir, len * 0.5);
    this.torso.scale.set(1.28, len / TORSO, 0.88);
    this.vest.quaternion.copy(this.torso.quaternion);
    this.vest.position.copy(this.pelvis).addScaledVector(dir, len * 0.68);
    this.vest.scale.set(1.28, 1, 0.92);

    for (const side of [-1, 1]) {
      const L = side < 0;
      // Leg.
      this.root.copy(this.pelvis).addScaledVector(x, side * 0.095).addScaledVector(dir, -0.02);
      const foot = L ? this.footL : this.footR;
      this.ankle.copy(foot);
      this.ankle.y += ANKLE;
      reach(this.root, this.ankle, THIGH, SHIN, this.kneeHint, this.joint, this.end);
      layBetween(L ? this.limbs.thighL : this.limbs.thighR, this.root, this.joint);
      layBetween(L ? this.limbs.shinL : this.limbs.shinR, this.joint, this.end);
      const shoe = this.feet[L ? 0 : 1];
      shoe.position.set(this.end.x + this.fwd.x * 0.06, this.end.y - ANKLE + 0.04, this.end.z + this.fwd.z * 0.06);
      shoe.rotation.set(0, Math.atan2(-this.fwd.x, -this.fwd.z), 0);
      // Arm.
      this.root.copy(this.neck).addScaledVector(x, side * 0.2).addScaledVector(dir, -0.05);
      reach(this.root, L ? this.handL : this.handR, UPPER_ARM, FOREARM, L ? this.elbowHintL : this.elbowHintR, this.joint, this.end);
      layBetween(L ? this.limbs.upperL : this.limbs.upperR, this.root, this.joint);
      layBetween(L ? this.limbs.foreL : this.limbs.foreR, this.joint, this.end);
      this.hands[L ? 0 : 1].position.copy(this.end);
    }

    // Head: sits on the neck, faces along `look`, stays level with the figure's own up.
    this.head.position.copy(this.neck).addScaledVector(dir, 0.07).addScaledVector(this.up, 0.12);
    const hz = t1.copy(this.look).normalize().negate();
    const hx = t2.crossVectors(this.up, hz);
    if (hx.lengthSq() < 1e-6) hx.copy(x);
    hx.normalize();
    const hy = t3.crossVectors(hz, hx);
    basis.makeBasis(hx, hy, hz);
    this.head.quaternion.setFromRotationMatrix(basis);
  }
}

export class Crew {
  private readonly helm: Figure;
  private readonly trim: Figure;
  private started = false;
  /** Which side the wind is on, eased: +1 starboard, -1 port. Turns the helmsman's head. */
  private windSide = 1;
  /** Where the trimmer is across the cockpit: -1 port seat, +1 starboard seat. */
  private across = 1;
  /** 0 to 1, how busy the trimmer is with a sheet. */
  private busy = 0;
  private readonly busyTarget = new THREE.Vector3();
  private lastSheets = { main: 0, port: 0, stbd: 0 };
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();

  constructor(private readonly model: SloopModel) {
    this.helm = new Figure('crew_helm', { jacket: 0xc2281d, vest: 0x2a2d33, trousers: 0x1f2630, skin: 0xc99a7a, cap: 0x1b2a4a });
    this.trim = new Figure('crew_trim', { jacket: 0xe3b21c, vest: 0x1d2a44, trousers: 0x2b2f36, skin: 0x8d5f43, cap: 0xe9e6dc });
    for (const f of [this.helm, this.trim]) {
      model.root.add(f.group);
      model.nodes[f.group.name] = f.group;
    }
  }

  update(state: SimState, out: SimOutputs, pose: BoatPose, time: number, dt: number): void {
    const geo = this.model.geo;
    const windward = out.awa >= 0 ? 1 : -1;
    if (!this.started) {
      this.started = true;
      this.windSide = windward;
      this.across = windward;
      this.lastSheets = { main: state.mainSheet, port: state.jibSheetPort, stbd: state.jibSheetStbd };
    }
    this.windSide += (windward - this.windSide) * Math.min(1, dt * 3);
    // The trimmer takes about a second and a half to cross the cockpit.
    this.across += clamp(windward - this.across, -dt * 1.33, dt * 1.33);

    // Whoever touches a sheet gets the trimmer's attention for a moment.
    const touched = (now: number, before: number) => Math.abs(now - before) > 1e-5;
    if (touched(state.jibSheetPort, this.lastSheets.port)) { this.busy = 1; this.busyTarget.copy(geo.winchPort); }
    if (touched(state.jibSheetStbd, this.lastSheets.stbd)) { this.busy = 1; this.busyTarget.copy(geo.winchStbd); }
    if (touched(state.mainSheet, this.lastSheets.main)) { this.busy = 1; this.busyTarget.copy(geo.traveller); this.busyTarget.y += 0.5; }
    this.lastSheets.main = state.mainSheet;
    this.lastSheets.port = state.jibSheetPort;
    this.lastSheets.stbd = state.jibSheetStbd;
    this.busy = Math.max(0, this.busy - dt * 1.4);

    this.poseHelm(pose, time);
    this.poseTrimmer(pose, time);
  }

  /** Standing aft of the wheel, hands at ten and two, leaning uphill as the boat heels. */
  private poseHelm(pose: BoatPose, time: number): void {
    const f = this.helm;
    const geo = this.model.geo;
    const sole = geo.cockpitSoleY;
    const lean = clamp(pose.heel * 0.6, -0.22, 0.22);
    f.up.set(-Math.sin(lean), Math.cos(lean), 0);
    f.right.set(Math.cos(lean), Math.sin(lean), 0);
    f.fwd.set(0, 0, -1);
    const z = geo.wheel.z + 0.46;
    const sway = Math.sin(time * 0.61) * 0.012;
    f.footL.set(-0.17, sole, z + 0.03);
    f.footR.set(0.17, sole, z - 0.02);
    f.pelvis.set(0, sole, z + 0.01).addScaledVector(f.up, 0.85).addScaledVector(f.right, sway);
    f.neck.copy(f.pelvis).addScaledVector(f.up, TORSO + Math.sin(time * 1.7) * 0.005);
    f.neck.z -= 0.06;
    f.kneeHint.set(0, 0.2, -1);

    // Hands ride the rim and follow it a little way round as the wheel turns.
    const wheelTurn = this.model.nodes.wheel.rotation.z;
    const follow = clamp(-wheelTurn * 0.22, -0.4, 0.4);
    const shift = follow - lean * 1.3;
    const grip = (angle: number, o: THREE.Vector3) =>
      o.set(geo.wheel.x + Math.sin(angle) * WHEEL_RADIUS, geo.wheel.y + Math.cos(angle) * WHEEL_RADIUS, geo.wheel.z + 0.055);
    grip(-1.05 + shift, f.handL);
    grip(1.05 + shift, f.handR);
    f.elbowHintL.set(-0.6, -1, 0.35);
    f.elbowHintR.set(0.6, -1, 0.35);

    // Eyes forward and a little to windward, up toward the luff.
    f.look.set(this.windSide * 0.42, 0.2 + Math.sin(time * 0.23) * 0.05, -1);
    f.apply();
  }

  /** Sitting on the windward seat watching the jib. Crosses the cockpit when the wind changes sides. */
  private poseTrimmer(pose: BoatPose, time: number): void {
    const f = this.trim;
    const geo = this.model.geo;
    const sole = geo.cockpitSoleY;
    const seat = sole + 0.42;
    const c = this.across;
    const e = c * (1.5 - 0.5 * c * c); // eased, still -1 to +1
    const mid = 1 - e * e; // 1 half way across, 0 seated
    const side = e >= 0 ? 1 : -1;

    const lean = clamp(pose.heel * 0.8, -0.4, 0.4) * (1 - mid);
    f.up.set(-Math.sin(lean), Math.cos(lean), 0);
    // Seated, face inboard and a little toward the bow. Crossing, face forward.
    f.fwd.set(-e, 0, -0.45 - 0.9 * mid).normalize();
    f.right.crossVectors(f.fwd, Y).normalize();

    const z = geo.wheel.z - 1.48;
    f.pelvis.set(0.77 * e, THREE.MathUtils.lerp(seat + 0.115, sole + 0.6, mid), z - 0.25 * mid);
    f.neck.copy(f.pelvis).addScaledVector(f.up, TORSO - 0.02 - 0.06 * mid + Math.sin(time * 1.45 + 1) * 0.005);
    f.neck.addScaledVector(f.fwd, 0.05 + 0.24 * mid);

    // Lean and reach toward the sheet being worked.
    const to = this.v.subVectors(this.busyTarget, f.pelvis);
    to.y = 0;
    const far = to.length() || 1;
    to.multiplyScalar(1 / far);
    const busy = this.busy * this.busy * (3 - 2 * this.busy);
    f.neck.addScaledVector(to, 0.2 * busy);

    // Feet in the well, in front of the seat.
    const stride = 0.4 * (1 - 0.65 * mid);
    for (const [foot, s] of [[f.footL, -1], [f.footR, 1]] as const) {
      foot.set(f.pelvis.x, sole, f.pelvis.z).addScaledVector(f.fwd, stride).addScaledVector(f.right, s * 0.12);
      foot.x = clamp(foot.x, -0.4, 0.4);
    }
    f.kneeHint.copy(f.fwd).addScaledVector(Y, 0.9);

    // Hands rest on the knees. The arm nearer the work reaches out for it.
    const rest = (s: number, o: THREE.Vector3) =>
      o.copy(f.pelvis).addScaledVector(f.fwd, 0.37).addScaledVector(f.right, s * 0.13).addScaledVector(Y, 0.13 + 0.1 * mid);
    rest(-1, f.handL);
    rest(1, f.handR);
    if (busy > 0.01) {
      const nearRight = to.dot(f.right) >= 0;
      const hand = nearRight ? f.handR : f.handL;
      const shoulder = this.w.copy(f.neck).addScaledVector(f.right, nearRight ? 0.2 : -0.2);
      const aim = this.v.subVectors(this.busyTarget, shoulder).normalize();
      shoulder.addScaledVector(aim, 0.56);
      hand.lerp(shoulder, busy);
    }
    f.elbowHintL.copy(f.right).multiplyScalar(-0.7).addScaledVector(Y, -1).addScaledVector(f.fwd, -0.3);
    f.elbowHintR.copy(f.right).multiplyScalar(0.7).addScaledVector(Y, -1).addScaledVector(f.fwd, -0.3);

    // Watch the jib: up and forward, to leeward of the mast.
    f.look.set(-side * 0.9, geo.jibClewY + 4.2, geo.mastZ - 1.6).sub(f.neck);
    if (mid > 0.05) f.look.lerp(this.w.copy(f.fwd).multiplyScalar(4), mid);
    f.apply();
  }
}
