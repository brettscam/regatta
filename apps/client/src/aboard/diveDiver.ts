import * as THREE from 'three';
import { Figure } from '../boat/crew';
import type { Avatar } from '../boat/avatar';

/**
 * The diver herself, as the chase view sees her and as she sees her own fins from the mask: the skipper's own figure
 * (`boat/crew.ts`) in a wetsuit, with mask and snorkel, a weight belt, long freediving fins and the speargun in her
 * right hand. Posed once a frame from where she is and what she is doing (`DiverPose`): a flutter kick tied to the
 * fin strokes, a streamlined glide with the gun arm forward, a reach for a lobster, a haul on a fish, the kick of a
 * shot. Nothing is made per frame. Scene coordinates: X east, Y up, Z south.
 */

export interface DiverPose {
  /** Where her eyes are, scene coordinates. */
  x: number; y: number; z: number;
  /** Her body: compass heading, pitch up from level, and the roll of a turn (positive, right side down). */
  yaw: number; pitch: number; roll: number;
  /** Where she is looking, as a unit vector, scene axes. */
  lookX: number; lookY: number; lookZ: number;
  /** The kick: its phase in radians (a stroke is half a turn) and how hard, 0 to 1. */
  kick: number; kickAmp: number;
  /** What her arms are doing, and how far through it (0 to 1). */
  arm: 'glide' | 'reach' | 'haul' | 'recoil' | 'float';
  armK: number;
  /** Seen from her own mask: her head and her arms are not drawn (the mask's view has its own gun and hand). */
  firstPerson: boolean;
  /** The gun: the shaft on it, and the muzzle bead (2 on target, 1 in range, 0 nothing). */
  loaded: boolean;
  bead: number;
}

const NEOPRENE = 0x15171a;

/** Her look in the water: her own face, hair and build, in a wetsuit, with nothing on her head but the mask. */
export function diverAvatar(a: Avatar): Avatar {
  return { ...a, outfit: 'wetsuit', hat: 'none', specs: 'none' };
}

export class DiverModel {
  readonly group = new THREE.Group();
  /** Where the muzzle is, scene coordinates, after `pose`. */
  readonly muzzle = new THREE.Vector3();
  private readonly figure: Figure;
  private readonly fins: Array<{ root: THREE.Group; blade: THREE.Object3D }> = [];
  private readonly mask = new THREE.Group();
  private readonly belt: THREE.Group;
  private readonly gun = new THREE.Group();
  private readonly gunShaft: THREE.Mesh;
  private readonly bead: THREE.Mesh;
  private readonly mats: THREE.Material[] = [];
  private readonly f = new THREE.Vector3();
  private readonly u = new THREE.Vector3();
  private readonly r = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly look = new THREE.Vector3();

  constructor(avatar: Avatar) {
    this.group.name = 'diver';
    this.figure = new Figure('diver_figure', diverAvatar(avatar));
    // Bare feet go in the fins' pockets: the figure's shoes are not drawn.
    this.figure.group.children[12].visible = false;
    this.figure.group.children[13].visible = false;
    const mat = (colour: number, roughness = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({ color: colour, roughness, ...extra }); this.mats.push(m); return m; };

    // Long freediving fins: a foot pocket and a blade three times its length, a bright tip.
    const finMat = mat(0x1c2a3a, 0.5, { side: THREE.DoubleSide });
    const tipMat = mat(0x2a9fd6, 0.5, { side: THREE.DoubleSide });
    for (let i = 0; i < 2; i++) {
      const root = new THREE.Group();
      const blade = new THREE.Group();
      const pocket = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 3, 8), finMat);
      pocket.rotation.x = Math.PI / 2;
      pocket.position.z = 0.04;
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.62, 1, 4), finMat);
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.z = 0.42;
      const tip = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), tipMat);
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = 0.78;
      blade.add(sheet, tip);
      root.add(pocket, blade);
      this.fins.push({ root, blade });
      this.group.add(root);
    }

    // Mask and snorkel.
    const strap = mat(0x0d0f12, 0.7);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.04), strap);
    frame.position.z = 0.02;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.055, 0.01), mat(0x88b8c8, 0.05, { metalness: 0.4, transparent: true, opacity: 0.55 }));
    glass.position.z = 0.045;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.009, 4, 16), strap);
    band.rotation.x = Math.PI / 2;
    band.position.z = -0.06;
    const snorkel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), mat(0xe8d021, 0.5));
    snorkel.position.set(-0.11, 0.14, -0.03);
    snorkel.rotation.x = -0.25;
    this.mask.add(frame, glass, band, snorkel);
    this.group.add(this.mask);

    // A weight belt with its lead.
    this.belt = new THREE.Group();
    const webbing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 4, 18), mat(0x202020, 0.8));
    webbing.scale.set(1.2, 0.85, 1);
    this.belt.add(webbing);
    for (const a of [-0.9, 0.9, Math.PI]) {
      const lead = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.035), mat(0x6c6f72, 0.4, { metalness: 0.5 }));
      lead.position.set(Math.sin(a) * 0.18, Math.cos(a) * 0.13, 0);
      lead.rotation.z = -a;
      this.belt.add(lead);
    }
    this.group.add(this.belt);

    // The speargun, along +Z from the grip: barrel, muzzle, bands and shaft, and the bead.
    const black = mat(0x101317, 0.5);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.9, 8), mat(0x1a242c, 0.4));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.4;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.045), black);
    grip.position.set(0, -0.06, 0);
    grip.rotation.x = -0.35;
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 8), black);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = 0.85;
    this.gunShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.05, 6), mat(0xc8ccd0, 0.3, { metalness: 0.7 }));
    this.gunShaft.rotation.x = Math.PI / 2;
    this.gunShaft.position.set(0, 0.02, 0.5);
    this.bead = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0x334044, toneMapped: false }));
    this.mats.push(this.bead.material as THREE.Material);
    this.bead.position.set(0, 0.028, 0.86);
    this.gun.add(barrel, grip, muzzle, this.gunShaft, this.bead);
    this.group.add(this.gun);

    this.group.add(this.figure.group);
    this.group.traverse((o) => { o.frustumCulled = false; (o as THREE.Mesh).castShadow = false; });
  }

  /** Dress her again, when the skipper changes her look. */
  wear(avatar: Avatar): void {
    this.figure.wear(diverAvatar(avatar));
    this.figure.group.children[12].visible = false;
    this.figure.group.children[13].visible = false;
  }

  pose(p: DiverPose): void {
    const fig = this.figure;
    const tall = fig.tall;
    const cy = Math.cos(p.yaw);
    const sy = Math.sin(p.yaw);
    const cp = Math.cos(p.pitch);
    const sp = Math.sin(p.pitch);
    const f = this.f.set(sy * cp, sp, -cy * cp);
    const u0 = this.u.set(-sy * sp, cp, cy * sp);
    const r0 = this.r.crossVectors(f, u0);
    // Roll into the turn: the right side goes down.
    const cr = Math.cos(p.roll);
    const sr = Math.sin(p.roll);
    const rx = r0.x * cr - u0.x * sr;
    const ry = r0.y * cr - u0.y * sr;
    const rz = r0.z * cr - u0.z * sr;
    u0.set(u0.x * cr + r0.x * sr, u0.y * cr + r0.y * sr, u0.z * cr + r0.z * sr);
    r0.set(rx, ry, rz);
    const u = u0;
    const r = r0;
    this.look.set(p.lookX, p.lookY, p.lookZ);

    // Spine: the neck just behind and below her eyes, the pelvis a back's length behind that.
    fig.neck.set(p.x, p.y, p.z).addScaledVector(f, -0.13).addScaledVector(u, -0.1);
    fig.pelvis.copy(fig.neck).addScaledVector(f, -0.54 * tall);
    fig.right.copy(r);
    fig.fwd.copy(f).negate();
    fig.up.copy(u);
    fig.look.copy(this.look);
    // Legs straight back, kicking from the hip in turn: one up as the other goes down.
    const leg = 0.86 * tall;
    const amp = 0.16 * p.kickAmp;
    for (const side of [-1, 1]) {
      const foot = side < 0 ? fig.footL : fig.footR;
      const swing = Math.sin(p.kick + (side < 0 ? 0 : Math.PI)) * amp;
      // The figure stands its ankle a little above the foot it is given, in the world's up: take that off again.
      foot.copy(fig.pelvis).addScaledVector(f, -leg).addScaledVector(r, side * 0.1).addScaledVector(u, swing);
      foot.y -= 0.07;
      const fin = this.fins[side < 0 ? 0 : 1];
      fin.root.position.copy(foot);
      fin.root.position.y += 0.07;
      // Local +Z runs back along the blade, +Y out of her back, +X to her right.
      this.t.copy(f).negate();
      this.basis.makeBasis(r, u, this.t);
      fin.root.quaternion.setFromRotationMatrix(this.basis);
      // The blade bends behind the stroke, as a fin does.
      fin.blade.rotation.x = Math.cos(p.kick + (side < 0 ? 0 : Math.PI)) * 0.45 * p.kickAmp + 0.12;
    }
    fig.kneeHint.copy(u).negate().addScaledVector(f, 0.3);
    // Arms: the gun arm out in front along the way she looks; the other trailing, or reaching, or both on the gun.
    const reach = 0.52 * tall;
    const hR = fig.handR.copy(fig.neck).addScaledVector(r, 0.12).addScaledVector(u, -0.05);
    if (p.arm === 'haul') hR.addScaledVector(this.look, reach * (0.35 + 0.35 * Math.cos(p.armK * Math.PI * 2)));
    else if (p.arm === 'recoil') hR.addScaledVector(this.look, reach * (0.85 - 0.3 * p.armK));
    else if (p.arm === 'float') hR.addScaledVector(f, reach * 0.6).addScaledVector(u, -0.18);
    else hR.addScaledVector(this.look, reach * 0.92);
    const hL = fig.handL;
    if (p.arm === 'reach') hL.copy(fig.neck).addScaledVector(r, -0.12).addScaledVector(this.look, reach * (0.6 + 0.35 * p.armK)).addScaledVector(u, -0.1);
    else if (p.arm === 'float') hL.copy(fig.neck).addScaledVector(r, -0.2).addScaledVector(f, reach * 0.5).addScaledVector(u, -0.22 + 0.06 * Math.sin(p.kick));
    else hL.copy(fig.pelvis).addScaledVector(r, -0.2).addScaledVector(u, -0.04 + 0.03 * Math.sin(p.kick * 0.5)).addScaledVector(f, 0.12);
    fig.elbowHintL.copy(r).multiplyScalar(-0.6).addScaledVector(u, -0.7);
    fig.elbowHintR.copy(r).multiplyScalar(0.6).addScaledVector(u, -0.7);
    fig.apply();

    // Mask on the face, the belt round the waist, the gun in her right hand pointing where she looks.
    this.mask.position.copy(fig.neck).addScaledVector(f, 0.07 * 0 + 0.07).addScaledVector(u, 0.12).addScaledVector(this.look, 0.08);
    this.t.copy(this.mask.position).add(this.look);
    this.mask.up.copy(u);
    this.mask.lookAt(this.t);
    this.belt.position.copy(fig.pelvis).addScaledVector(f, 0.06);
    this.t.copy(this.belt.position).add(f);
    this.belt.up.copy(u);
    this.belt.lookAt(this.t);
    this.gun.position.copy(hR);
    this.t.copy(hR).add(this.look);
    this.gun.up.copy(u);
    this.gun.lookAt(this.t);
    this.gunShaft.visible = p.loaded;
    this.bead.visible = p.loaded;
    (this.bead.material as THREE.MeshBasicMaterial).color.setRGB(p.bead >= 2 ? 0.3 : p.bead >= 1 ? 1 : 0.16, p.bead >= 2 ? 1 : p.bead >= 1 ? 0.7 : 0.2, p.bead >= 2 ? 0.45 : p.bead >= 1 ? 0.15 : 0.22);
    this.gun.updateMatrixWorld();
    this.muzzle.set(0, 0.02, 0.9).applyMatrix4(this.gun.matrixWorld);

    // From her own mask she sees her body and her fins; her head, her arms and this gun are the mask view's own.
    const fp = p.firstPerson;
    const kids = fig.group.children;
    for (const i of [6, 7, 8, 9, 10, 11, 14]) kids[i].visible = !fp;
    this.mask.visible = !fp;
    this.gun.visible = !fp;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.parent !== this.figure.group) (o as THREE.Mesh).geometry.dispose(); });
    for (const m of this.mats) m.dispose();
  }
}

export { NEOPRENE };
