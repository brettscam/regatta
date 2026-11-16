import * as THREE from 'three';
import { Figure } from '../boat/crew';
import type { Avatar } from '../boat/avatar';
import { KayakModel, loft, type Section } from './kayakModel';
import type { TenderSpec } from './tenders';

// The powered tenders as they are drawn: a small rigid inflatable with a tiller outboard, and a sit-astride jet craft.
// Plain shapes in the yacht's colours, no maker's styling. The skipper aboard is the same figure as at the yacht's wheel.
// Model frame as for the yacht: +X starboard, +Y up, -Z forward, origin on the waterline amidships.

/** What the game asks of any tender's model. The kayak's (`kayakModel.ts`) is one too. */
export interface TenderModel {
  readonly root: THREE.Group;
  readonly length: number;
  readonly halfBeam: number;
  /** Where the painter is made fast, in her own frame. */
  readonly bow: THREE.Vector3;
  setAvatar(avatar: Avatar): void;
  /** With nobody in her she lies empty. */
  setManned(manned: boolean): void;
  /** Put her on the water. Scene coordinates, heading in compass radians, heel positive to starboard. */
  place(x: number, y: number, z: number, heading: number, pitch: number, heel: number): void;
  /**
   * Move whoever is in her.
   * @param work 1 paddling or throttle wide open, -1 backing, 0 resting
   * @param steer 1 turning to starboard, -1 to port
   */
  animate(dt: number, work: number, steer: number, time: number): void;
  dispose(): void;
}

/** Build the model the table names for a tender. */
export function buildTender(spec: TenderSpec, accent: string | undefined, avatar?: Avatar): TenderModel {
  if (spec.model === 'skiff') return new SkiffModel(accent, avatar);
  if (spec.model === 'runner') return new RunnerModel(accent, avatar);
  return new KayakModel(accent, avatar);
}

const Y = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

/** What the two powered models share: the root, the materials to throw away, the figure and where she is put. */
abstract class Powered implements TenderModel {
  readonly root = new THREE.Group();
  abstract readonly length: number;
  abstract readonly halfBeam: number;
  abstract readonly bow: THREE.Vector3;
  protected readonly figure: Figure;
  protected readonly owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  protected manned = true;
  /** The helm and the throttle, eased so hands and shoulders do not snap. */
  protected helm = 0;
  protected gas = 0;

  constructor(name: string, avatar?: Avatar) {
    this.root.name = name;
    this.root.rotation.order = 'YXZ';
    this.figure = new Figure(`${name}_skipper`, avatar);
    this.root.add(this.figure.group);
  }

  protected mat(color: THREE.ColorRepresentation, roughness = 0.6): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness });
    this.owned.push(m);
    return m;
  }

  protected add(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.root): THREE.Mesh {
    this.owned.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  setAvatar(avatar: Avatar): void {
    this.figure.wear(avatar);
  }

  setManned(manned: boolean): void {
    this.manned = manned;
    this.figure.group.visible = manned;
    if (!manned) this.helm = this.gas = 0;
  }

  place(x: number, y: number, z: number, heading: number, pitch: number, heel: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(pitch, -heading, -heel);
  }

  animate(dt: number, work: number, steer: number, time: number): void {
    this.helm += clamp(steer - this.helm, -dt * 5, dt * 5);
    this.gas += clamp(work - this.gas, -dt * 3, dt * 3);
    this.pose(time);
  }

  protected abstract pose(time: number): void;

  dispose(): void {
    this.root.removeFromParent();
    for (const o of this.owned) o.dispose();
  }
}

// ---- the skiff ----------------------------------------------------------------------------------------

export const SKIFF_LENGTH = 3.4;
const TUBE = 0.2;

const skiffSection = (t: number): Section => ({
  // Square across the transom, drawn in to the bow under the tubes.
  half: 0.52 * Math.max(0, 1 - Math.max(0, t) ** 2.6) ** 0.7,
  keel: -0.17 + 0.2 * Math.max(0, t) ** 3,
  sheer: 0.2 + 0.12 * Math.max(0, t) ** 2,
});

/** A small rigid inflatable: grey tubes round a white hull, a thwart, and an outboard steered by its tiller. */
export class SkiffModel extends Powered {
  readonly length = SKIFF_LENGTH;
  readonly halfBeam = 0.8;
  readonly bow = new THREE.Vector3(0, 0.5, -SKIFF_LENGTH * 0.5 + 0.1);
  private readonly outboard = new THREE.Group();
  private readonly tiller = new THREE.Vector3();

  constructor(accent: string | undefined, avatar?: Avatar) {
    super('skiff', avatar);
    const tube = this.mat(0x8f979c, 0.75);
    const shell = this.mat(0xf1eee4, 0.42);
    const sole = this.mat(0xb9bdb8, 0.85);
    const colour = this.mat(accent || '#c2281d', 0.5);
    const dark = this.mat(0x1c1f23, 0.7);

    // The hull under the tubes, with a shallow V.
    const hull = loft(SKIFF_LENGTH - 0.3, skiffSection, 0);
    const skin = this.add(hull.skin, shell);
    skin.name = 'skiff_hull';
    skin.position.z = 0.12;
    this.add(hull.deck, sole).position.z = 0.12;

    // The tubes: one run from the port quarter round the bow to the starboard quarter.
    const half = 0.6;
    const aft = SKIFF_LENGTH * 0.5 - 0.12;
    const run = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-half, 0.34, aft), new THREE.Vector3(-half, 0.34, 0.5), new THREE.Vector3(-half + 0.02, 0.35, -0.45),
      new THREE.Vector3(-half + 0.2, 0.4, -1.12), new THREE.Vector3(0, 0.45, -SKIFF_LENGTH * 0.5 + TUBE),
      new THREE.Vector3(half - 0.2, 0.4, -1.12), new THREE.Vector3(half - 0.02, 0.35, -0.45), new THREE.Vector3(half, 0.34, 0.5), new THREE.Vector3(half, 0.34, aft),
    ], false, 'catmullrom', 0.4);
    this.add(new THREE.TubeGeometry(run, 44, TUBE, 9, false), tube).name = 'skiff_tubes';
    for (const side of [-1, 1]) {
      // The cone that ends each tube, and a stripe of the yacht's colour along it.
      const cone = this.add(new THREE.ConeGeometry(TUBE, 0.3, 9), tube);
      cone.rotation.x = Math.PI / 2;
      cone.position.set(side * half, 0.34, aft + 0.15);
      this.add(new THREE.BoxGeometry(0.02, 0.07, 1.9), colour).position.set(side * (half + TUBE - 0.004), 0.36, 0.55);
    }
    // Transom, thwart, and a fuel can under it.
    this.add(new THREE.BoxGeometry(half * 2 - 0.3, 0.44, 0.05), shell).position.set(0, 0.36, aft - 0.1);
    this.add(new THREE.BoxGeometry(half * 2 - 0.34, 0.05, 0.27), colour).position.set(0, 0.45, 0.62);
    this.add(new THREE.BoxGeometry(0.3, 0.2, 0.2), this.mat(0xb3261c, 0.6)).position.set(-0.2, 0.31, 1.15);

    // The outboard: cowl, leg and a tiller arm, all turning on the transom.
    const pivot = this.outboard;
    pivot.position.set(0, 0.62, aft - 0.04);
    this.add(new THREE.BoxGeometry(0.26, 0.3, 0.42), dark, pivot).position.set(0, 0.2, 0.16);
    this.add(new THREE.BoxGeometry(0.27, 0.05, 0.43), colour, pivot).position.set(0, 0.1, 0.16);
    this.add(new THREE.BoxGeometry(0.09, 0.78, 0.13), dark, pivot).position.set(0, -0.36, 0.16);
    this.add(new THREE.BoxGeometry(0.03, 0.2, 0.3), dark, pivot).position.set(0, -0.78, 0.2);
    const arm = this.add(new THREE.CylinderGeometry(0.02, 0.024, 0.6, 6), dark, pivot);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, 0.12, -0.3);
    this.root.add(pivot);
    this.setManned(false);
  }

  setManned(manned: boolean): void {
    super.setManned(manned);
    // Left alone the engine is tilted clear of the water.
    this.outboard.rotation.set(manned ? 0 : -0.75, 0, 0);
  }

  protected pose(time: number): void {
    // To turn her to starboard the leg swings its foot to starboard and the tiller goes to port.
    const turn = this.helm * 0.45;
    this.outboard.rotation.y = this.manned ? turn : 0;
    if (!this.manned) return;
    const f = this.figure;
    const lean = Math.max(0, this.gas);
    // Sitting on the thwart, a little to starboard, the tiller in the left hand behind her.
    const px = 0.2;
    const py = 0.58;
    const pz = 0.64;
    f.pelvis.set(px, py, pz);
    f.up.copy(Y);
    f.fwd.set(0, 0, -1);
    f.right.set(1, 0, 0);
    f.neck.set(px - 0.06 * this.helm, py + 0.52 * f.tall - 0.03 * lean + Math.sin(time * 1.7) * 0.004, pz - 0.05 - 0.12 * lean);
    f.footL.set(px - 0.13, 0.25, pz - 0.6);
    f.footR.set(px + 0.13, 0.25, pz - 0.6);
    f.kneeHint.set(0, 1, -0.2);
    f.look.set(0.5 * this.helm, -0.04, -1);
    const p = this.outboard.position;
    this.tiller.set(-Math.sin(turn) * 0.56, 0.12, -Math.cos(turn) * 0.56).add(p);
    f.handL.copy(this.tiller);
    f.handR.set(px + 0.36, 0.56, pz - 0.28);
    f.elbowHintL.set(-1, -0.3, 0.6);
    f.elbowHintR.set(0.8, -0.5, 0.6);
    f.apply();
  }
}

// ---- the wave runner ----------------------------------------------------------------------------------

export const RUNNER_LENGTH = 3.2;

const runnerSection = (t: number): Section => ({
  // A broad stern with the jet under it, drawn in to a sharp bow.
  half: t < 0 ? 0.56 * (1 - 0.12 * t * t) : 0.56 * Math.max(0, 1 - t ** 2.3) ** 0.72,
  keel: -0.2 + 0.22 * Math.max(0, t) ** 3,
  sheer: 0.3 + 0.13 * Math.max(0, t) ** 2,
});

/** A sit-astride jet craft: a short planing hull, a saddle, handlebars, and the skipper leaning with her. */
export class RunnerModel extends Powered {
  readonly length = RUNNER_LENGTH;
  readonly halfBeam = 0.56;
  readonly bow = new THREE.Vector3(0, 0.4, -RUNNER_LENGTH * 0.5 + 0.1);
  private readonly bars = new THREE.Group();

  constructor(accent: string | undefined, avatar?: Avatar) {
    super('runner', avatar);
    const shell = this.mat(0xf1eee4, 0.38);
    const colour = this.mat(accent || '#c2281d', 0.45);
    const dark = this.mat(0x1c1f23, 0.75);

    const hull = loft(RUNNER_LENGTH, runnerSection, 0.06);
    this.add(hull.skin, shell).name = 'runner_hull';
    this.add(hull.deck, colour);
    // The transom, with the jet's nozzle in the middle of it.
    this.add(new THREE.BoxGeometry(0.98, 0.42, 0.04), shell).position.set(0, 0.1, RUNNER_LENGTH * 0.5 - 0.02);
    const nozzle = this.add(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 8), dark);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, -0.04, RUNNER_LENGTH * 0.5 + 0.05);
    // The cowl forward, the column the bars sit on, and the saddle.
    const cowl = this.add(new THREE.SphereGeometry(1, 12, 8), shell);
    cowl.scale.set(0.37, 0.2, 0.78);
    cowl.position.set(0, 0.47, -0.62);
    const column = this.add(new THREE.BoxGeometry(0.16, 0.34, 0.22), dark);
    column.position.set(0, 0.68, -0.3);
    column.rotation.x = -0.3;
    const saddle = this.add(new THREE.CapsuleGeometry(0.16, 1.0, 3, 8), dark);
    saddle.rotation.x = Math.PI / 2;
    saddle.scale.set(1, 1, 0.75);
    saddle.position.set(0, 0.56, 0.55);
    this.add(new THREE.BoxGeometry(0.3, 0.14, 0.2), colour).position.set(0, 0.48, 1.3);

    this.bars.position.set(0, 0.9, -0.32);
    const bar = this.add(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6), dark, this.bars);
    bar.rotation.z = Math.PI / 2;
    this.root.add(this.bars);
    this.setManned(false);
  }

  protected pose(time: number): void {
    const turn = this.helm * 0.5;
    // Steering to starboard, the starboard grip comes back.
    this.bars.rotation.y = -turn;
    if (!this.manned) return;
    const f = this.figure;
    const gas = Math.max(0, this.gas);
    // Astride, leaning forward with the throttle and into the turn with her weight.
    const px = 0.1 * this.helm;
    const py = 0.84;
    const pz = 0.32;
    const tilt = 0.24 * this.helm;
    f.pelvis.set(px, py, pz);
    f.up.set(Math.sin(tilt), Math.cos(tilt), 0);
    f.fwd.set(0, 0, -1);
    f.right.set(Math.cos(tilt), -Math.sin(tilt), 0);
    f.neck.set(px + Math.sin(tilt) * 0.5, py + 0.5 * f.tall * Math.cos(tilt) - 0.05 * gas + Math.sin(time * 2.1) * 0.004, pz - 0.2 - 0.12 * gas);
    f.footL.set(-0.34, 0.37, pz - 0.18);
    f.footR.set(0.34, 0.37, pz - 0.18);
    f.kneeHint.set(0, 0.5, -1);
    f.look.set(0.6 * this.helm, -0.02, -1);
    const b = this.bars.position;
    const c = Math.cos(turn) * 0.29;
    const s = Math.sin(turn) * 0.29;
    f.handL.set(b.x - c, b.y, b.z - s);
    f.handR.set(b.x + c, b.y, b.z + s);
    f.elbowHintL.set(-1, -0.4, 0.3);
    f.elbowHintR.set(1, -0.4, 0.3);
    f.apply();
  }
}

// ---- someone in the water -----------------------------------------------------------------------------

/** The rider after a spill: head and shoulders out, one arm up. Goes straight into the scene. */
export class Swimmer {
  readonly root = new THREE.Group();
  private readonly figure: Figure;

  constructor(avatar?: Avatar) {
    this.root.name = 'tender_swimmer';
    this.root.rotation.order = 'YXZ';
    this.figure = new Figure('swimmer', avatar);
    this.root.add(this.figure.group);
    this.root.visible = false;
  }

  setAvatar(avatar: Avatar): void {
    this.figure.wear(avatar);
  }

  /** Scene coordinates of the water where she is, and which way she faces. */
  place(x: number, sea: number, z: number, facing: number, time: number): void {
    this.root.position.set(x, sea, z);
    this.root.rotation.set(0, -facing, 0);
    const f = this.figure;
    const bob = Math.sin(time * 2.4) * 0.03;
    f.pelvis.set(0, -0.78 + bob, 0.05);
    f.up.copy(Y);
    f.fwd.set(0, 0, -1);
    f.right.set(1, 0, 0);
    f.neck.set(0, -0.78 + 0.52 * f.tall + bob, 0);
    f.footL.set(-0.16 + Math.sin(time * 3) * 0.08, -1.55, 0.1);
    f.footR.set(0.16 - Math.sin(time * 3) * 0.08, -1.55, -0.1);
    f.kneeHint.set(0, 0.2, -1);
    f.look.set(0, 0.05, -1);
    // One hand sculling, the other up to be seen.
    f.handL.set(-0.42, -0.2 + bob, -0.12 + Math.sin(time * 2.8) * 0.12);
    f.handR.set(0.3 + Math.sin(time * 5) * 0.1, 0.42, -0.05);
    f.elbowHintL.set(-1, -0.5, 0.2);
    f.elbowHintR.set(1, -0.6, 0.2);
    f.apply();
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
