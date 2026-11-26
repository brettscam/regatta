import * as THREE from 'three';
import type { Avatar } from '../boat/avatar';
import { Figure } from '../boat/crew';
import { poseOf, type Held, type Joints, type PoseIn, type V3 } from './pose';

// A person ashore, drawn: the skipper's own figure (`boat/crew.ts`) in her own kit, posed by `pose.ts`, with whatever
// she is holding in her hand, her name over her head and her last words in a bubble.

const GEO = {
  glass: new THREE.CylinderGeometry(0.034, 0.026, 0.11, 10),
  drink: new THREE.CylinderGeometry(0.03, 0.024, 0.075, 10),
  mug: new THREE.CylinderGeometry(0.04, 0.036, 0.09, 10),
  bottle: new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8),
  neck: new THREE.CylinderGeometry(0.012, 0.022, 0.08, 8),
  plate: new THREE.CylinderGeometry(0.12, 0.09, 0.018, 14),
  food: new THREE.SphereGeometry(0.06, 8, 5),
};
const CLEAR = new THREE.MeshStandardMaterial({ color: 0xdfeef2, roughness: 0.15, transparent: true, opacity: 0.38 });
const CHINA = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5 });

const set = (v: THREE.Vector3, a: V3): THREE.Vector3 => v.set(a[0], a[1], a[2]);

/** Something to hold: a glass, a mug, a bottle or a plate, coloured by what is in it. */
class Prop {
  readonly group = new THREE.Group();
  private readonly tint = new THREE.MeshStandardMaterial({ roughness: 0.55 });
  private kind: Held = 'none';
  private colour = '';

  show(kind: Held, colour: string): void {
    if (kind === this.kind && colour === this.colour) return;
    this.kind = kind;
    this.colour = colour;
    this.group.clear();
    this.group.visible = kind !== 'none';
    if (kind === 'none') return;
    this.tint.color.set(colour);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, y: number, sy = 1): void => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = y;
      mesh.scale.y = sy;
      mesh.castShadow = true;
      this.group.add(mesh);
    };
    if (kind === 'glass') { add(GEO.drink, this.tint, 0.045); add(GEO.glass, CLEAR, 0.055); }
    else if (kind === 'mug') add(GEO.mug, CHINA, 0.045);
    else if (kind === 'bottle') { add(GEO.bottle, this.tint, 0.07); add(GEO.neck, this.tint, 0.18); }
    else { add(GEO.plate, CHINA, 0.01); add(GEO.food, this.tint, 0.03, 0.5); }
  }

  dispose(): void {
    this.tint.dispose();
  }
}

export interface WalkerPose extends Omit<PoseIn, 'tall'> {
  /** Where she stands, course metres, and the height of the floor under her. */
  x: number;
  y: number;
  z: number;
  /** Which way she faces, compass radians. */
  face: number;
  /** What is in her hand: its colour. */
  tint: string;
}

export class Walker {
  readonly figure: Figure;
  private readonly prop = new Prop();
  private readonly label = document.createElement('div');
  private readonly bubble = document.createElement('div');
  private readonly p = new THREE.Vector3();
  private said = '';
  private saidLeft = 0;
  private name = '';
  /** The height of the floor as drawn: eased, so a step down to the float is a step and not a jump. */
  private z: number | null = null;
  joints: Joints | null = null;

  constructor(scene: THREE.Scene, id: string, avatar: Avatar) {
    this.figure = new Figure(`ashore_${id}`, avatar);
    this.figure.group.add(this.prop.group);
    this.figure.group.visible = false;
    scene.add(this.figure.group);
    this.label.className = 'boat-label ashore-name';
    this.bubble.className = 'ashore-bubble';
    this.label.style.display = this.bubble.style.display = 'none';
    document.body.append(this.label, this.bubble);
  }

  wear(avatar: Avatar): void {
    this.figure.wear(avatar);
  }

  /** Words to show over her head for a while. They are another person's: text, never markup. */
  say(text: string, seconds = 8): void {
    this.said = text.slice(0, 160);
    this.saidLeft = seconds;
    this.bubble.textContent = this.said;
  }

  setName(name: string): void {
    if (name === this.name) return;
    this.name = name;
    this.label.textContent = name;
  }

  hide(): void {
    this.figure.group.visible = false;
    this.label.style.display = this.bubble.style.display = 'none';
    this.z = null;
  }

  /**
   * Put her where she is and pose her.
   * @param camera for the name and the bubble; pass null to draw neither
   * @param visible false to pose her without showing her: the camera is inside her head
   */
  draw(w: WalkerPose, dt: number, camera: THREE.Camera | null, width: number, height: number, visible = true): void {
    const f = this.figure;
    const j = this.joints = poseOf({ ...w, tall: f.tall });
    this.z = this.z === null || Math.abs(w.z - this.z) > 3 ? w.z : this.z + (w.z - this.z) * Math.min(1, dt * 9);
    const face = w.face;
    const g = f.group;
    g.visible = visible;
    g.position.set(w.x + Math.sin(face) * j.forward, this.z, -(w.y + Math.cos(face) * j.forward));
    g.rotation.set(0, -(face + j.turn), 0);
    set(f.pelvis, j.pelvis);
    set(f.neck, j.neck);
    set(f.footL, j.footL);
    set(f.footR, j.footR);
    set(f.handL, j.handL);
    set(f.handR, j.handR);
    set(f.look, j.look);
    set(f.kneeHint, j.knee);
    set(f.elbowHintL, j.elbowL);
    set(f.elbowHintR, j.elbowR);
    f.right.set(1, 0, 0);
    f.fwd.set(0, 0, -1);
    f.up.set(0, 1, 0);
    f.apply();

    // What she holds sits in the hand that has it: a plate on the left palm, a glass in the right fist.
    this.prop.show(w.held, w.tint);
    if (w.held !== 'none') {
      const hand = w.held === 'plate' ? j.handL : j.handR;
      this.prop.group.position.set(hand[0], hand[1] + (w.held === 'plate' ? 0.04 : -0.03), hand[2] - 0.035);
    }

    this.saidLeft = Math.max(0, this.saidLeft - dt);
    if (!camera) {
      this.label.style.display = this.bubble.style.display = 'none';
      return;
    }
    this.p.set(g.position.x, this.z + j.neck[1] + 0.42, g.position.z).project(camera);
    const shown = this.p.z < 1 && Math.abs(this.p.x) < 1.05 && Math.abs(this.p.y) < 1.05;
    const sx = Math.round(((this.p.x + 1) / 2) * width);
    const sy = Math.round(((1 - this.p.y) / 2) * height);
    this.label.style.display = shown && this.name ? 'block' : 'none';
    if (shown && this.name) this.label.style.transform = `translate(-50%, -100%) translate(${sx}px, ${sy}px)`;
    const speaking = shown && this.saidLeft > 0;
    this.bubble.style.display = speaking ? 'block' : 'none';
    // The bubble stays on the screen when she is at the edge of it.
    if (speaking) this.bubble.style.transform = `translate(-50%, -100%) translate(${Math.max(Math.min(130, width / 2), Math.min(width - Math.min(130, width / 2), sx))}px, ${Math.max(70, sy - (this.name ? 22 : 4))}px)`;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.figure.group);
    this.figure.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // The limbs' shapes are shared by every figure (`boat/crew.ts`) and the props' by every prop: only what is this figure's own goes.
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat !== CLEAR && mat !== CHINA) mat.dispose();
    });
    this.prop.dispose();
    this.label.remove();
    this.bubble.remove();
  }
}
