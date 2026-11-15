import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hull, sailCloth } from '../scene/traffic';
import { underSail, type ResidentKind, type ResidentSpec } from './residentRules';

/**
 * How the boats that live on a water are drawn. They are cheap on purpose: there are twenty of them.
 * - Each kind of boat is built once, at one size, and every boat of that kind shares the shapes, scaled to her length.
 * - A boat is at most five meshes: her hull in her own colour, everything on deck as one shape painted at the corners,
 *   her two sails, and a light. The hulls and sails are the ones the Bay's traffic is built from (`scene/traffic.ts`).
 * - Far off she is drawn as hull and sails only, with no shadow. Further still she is not drawn.
 */

type Shape = 'sloop' | 'workboat' | 'launch' | 'kayak';

const SHAPE: Record<ResidentKind, Shape> = { cruiser: 'sloop', daysailer: 'sloop', fisher: 'workboat', launch: 'launch', kayak: 'kayak' };
/** The length each shape is built at, metres. */
const UNIT: Record<Shape, number> = { sloop: 10, workboat: 10, launch: 16, kayak: 4.3 };
/** Where the light is carried, in the built shape. */
const LIGHT_AT: Record<Shape, [number, number, number]> = { sloop: [0, 14.75, -1], workboat: [0, 5.8, -0.8], launch: [0, 6.6, -2.6], kayak: [0, 1.05, 0.1] };
/** Mast height as a share of her length, for the wind shadow she casts. */
export const MAST_SHARE = 1.4;

interface Parts {
  hull: THREE.BufferGeometry;
  top: THREE.BufferGeometry;
  main?: THREE.BufferGeometry;
  jib?: THREE.BufferGeometry;
  paddle?: THREE.BufferGeometry;
}

const built = new Map<Shape, Parts>();
let TOP: THREE.MeshStandardMaterial | null = null;
let CLOTH: THREE.MeshStandardMaterial | null = null;
let LAMP: THREE.MeshBasicMaterial | null = null;
let LAMP_SHAPE: THREE.BufferGeometry | null = null;

/** Paint a shape one colour at its corners, with no other extras, so shapes of any kind can be joined. */
function tint(g: THREE.BufferGeometry, colour: number): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  flat.deleteAttribute('uv');
  const c = new THREE.Color(colour);
  const n = flat.getAttribute('position').count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(data, i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return flat;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, colour: number): THREE.BufferGeometry => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), colour);
const pole = (r: number, len: number, x: number, y: number, z: number, colour: number): THREE.BufferGeometry => tint(new THREE.CylinderGeometry(r * 0.8, r, len, 6).translate(x, y, z), colour);
const join = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
};
const hullShape = (...args: Parameters<typeof hull>): THREE.BufferGeometry => hull(...args).geometry;

const WHITE = 0xeeece6;
const GLASS = 0x15202a;
const DARK = 0x22262b;
const SPAR = 0xd9dcdc;
const DECK = 0xd8d5cb;
const SKIN = 0xc79a78;

function build(shape: Shape): Parts {
  const none = new THREE.MeshBasicMaterial();
  let parts: Parts;
  if (shape === 'sloop') {
    const L = 10;
    const B = 3.3;
    const mastZ = -1;
    const mastH = 13.2;
    const cloth = tint(sailCloth(mastH - 1.4, 3.8, 0.1, none).geometry, 0xf4f1e8);
    const boom = pole(0.05, 4, 0, 0, 0, SPAR).rotateX(Math.PI / 2).translate(0, -0.05, 2);
    const tackZ = -4.7;
    const run = mastZ - tackZ;
    const rise = mastH * 0.86;
    parts = {
      hull: hullShape(L, B, -0.45, 1.0, none, 0.42, 0.72),
      top: join([
        tint(hullShape(L * 0.98, B * 0.96, 1.0, 1.06, none, 0.42, 0.72), DECK),
        box(B * 0.55, 0.42, 3.6, 0, 1.25, -0.2, WHITE),
        box(B * 0.56, 0.16, 3.0, 0, 1.3, -0.2, GLASS),
        box(0.12, 1.4, 1.4, 0, -1.0, 0, DARK),
        pole(0.08, mastH, 0, 1.4 + mastH / 2, mastZ, SPAR),
        // Two in the cockpit.
        box(0.4, 0.7, 0.35, 0.66, 1.45, 3, 0xb5332a),
        box(0.4, 0.7, 0.35, -0.6, 1.45, 2.2, 0x26384f),
      ]),
      main: join([cloth, boom]),
      jib: tint(sailCloth(Math.hypot(run, rise), 4, 0.11, none).geometry.rotateX(Math.atan2(run, rise)), 0xf4f1e8),
    };
  } else if (shape === 'workboat') {
    parts = {
      hull: hullShape(10, 3.5, -0.5, 1.2, none, 0.36, 0.85),
      top: join([
        tint(hullShape(9.8, 3.35, 1.2, 1.27, none, 0.36, 0.85), 0x8d8a85),
        box(2.3, 1.9, 2.4, 0, 2.2, -2.2, WHITE),
        box(2.35, 0.6, 2.45, 0, 2.65, -2.2, GLASS),
        pole(0.07, 3.6, 0, 3.9, -0.8, SPAR),
        pole(0.05, 3.4, 0, 0, 0, SPAR).rotateX(1.1).translate(0, 3.6, 0.9),
        // The gear aft: a stack of pots, and somebody working them.
        box(1.7, 0.9, 1.8, 0, 1.72, 3.2, 0xc77a2a),
        box(0.4, 0.75, 0.35, 0.9, 1.65, 1.3, 0xd9a52b),
      ]),
    };
  } else if (shape === 'launch') {
    parts = {
      hull: hullShape(16, 5, -0.7, 1.6, none, 0.34, 0.85),
      top: join([
        box(4.4, 2.0, 9, 0, 2.6, 0.6, WHITE),
        box(4.45, 0.8, 8.4, 0, 2.95, 0.6, GLASS),
        box(4.3, 0.15, 7.4, 0, 3.68, 1.2, 0xcfd3d6),
        box(3.0, 1.7, 2.4, 0, 4.5, -2.6, WHITE),
        box(3.05, 0.7, 2.45, 0, 4.85, -2.6, GLASS),
        pole(0.07, 1.6, 0, 5.9, -2.6, DARK),
        // Visitors on the upper deck, as blocks of colour.
        box(0.4, 0.8, 0.35, -1.2, 4.15, 0.4, 0xb5332a),
        box(0.4, 0.8, 0.35, 0.9, 4.15, 1.3, 0x2c5d8f),
        box(0.4, 0.8, 0.35, -0.4, 4.15, 2.6, 0xd9a52b),
        box(0.4, 0.8, 0.35, 1.3, 4.15, 3.6, 0x3c7a55),
      ]),
    };
  } else {
    const shell = new THREE.SphereGeometry(0.5, 8, 5).scale(0.64, 0.32, 4.3).translate(0, 0.06, 0);
    shell.deleteAttribute('uv');
    parts = {
      hull: shell,
      top: join([
        box(0.38, 0.5, 0.26, 0, 0.48, 0.1, 0xd9a52b),
        tint(new THREE.SphereGeometry(0.11, 6, 5).translate(0, 0.86, 0.1), SKIN),
      ]),
      paddle: join([
        box(2.1, 0.035, 0.035, 0, 0, 0, DARK),
        box(0.42, 0.16, 0.02, 1.2, 0, 0, 0xe9e7e0),
        box(0.42, 0.16, 0.02, -1.2, 0, 0, 0xe9e7e0),
      ]),
    };
  }
  none.dispose();
  return parts;
}

function partsOf(shape: Shape): Parts {
  let p = built.get(shape);
  if (!p) built.set(shape, (p = build(shape)));
  return p;
}

/** One resident boat as drawn. */
export class ResidentView {
  readonly root = new THREE.Group();
  readonly sails: boolean;
  private readonly hullMat: THREE.MeshStandardMaterial;
  private readonly hull: THREE.Mesh;
  private readonly top: THREE.Mesh;
  private readonly main: THREE.Mesh | null = null;
  private readonly jib: THREE.Mesh | null = null;
  private readonly paddle: THREE.Mesh | null = null;
  private readonly lamp: THREE.Mesh;
  private level = -1;
  private shadows = false;
  private set = false;

  constructor(spec: ResidentSpec) {
    const shape = SHAPE[spec.kind];
    const parts = partsOf(shape);
    TOP ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    CLOTH ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x6f6a5c, emissiveIntensity: 0.2 });
    LAMP ??= new THREE.MeshBasicMaterial({ color: 0xfff1c4, fog: false });
    LAMP_SHAPE ??= new THREE.SphereGeometry(0.16, 6, 4);
    this.sails = underSail(spec.kind);
    this.root.name = `resident-${spec.id}`;
    this.root.rotation.order = 'YXZ';
    this.root.scale.setScalar(spec.length / UNIT[shape]);
    this.hullMat = new THREE.MeshStandardMaterial({ color: spec.colour, roughness: 0.4 });
    this.hull = new THREE.Mesh(parts.hull, this.hullMat);
    this.top = new THREE.Mesh(parts.top, TOP);
    this.root.add(this.hull, this.top);
    if (parts.main && parts.jib) {
      this.main = new THREE.Mesh(parts.main, CLOTH);
      this.main.position.set(0, 2.3, -0.92);
      this.jib = new THREE.Mesh(parts.jib, CLOTH);
      this.jib.position.set(0, 1.15, -4.7);
      this.root.add(this.main, this.jib);
    }
    if (parts.paddle) {
      this.paddle = new THREE.Mesh(parts.paddle, TOP);
      this.paddle.position.set(0, 0.58, -0.2);
      this.root.add(this.paddle);
    }
    this.lamp = new THREE.Mesh(LAMP_SHAPE, LAMP);
    this.lamp.position.set(...LIGHT_AT[shape]);
    // A light is seen from further off than its size: bigger on a small boat, so it does not vanish.
    this.lamp.scale.setScalar(Math.max(1, 14 / spec.length));
    this.lamp.visible = false;
    this.root.add(this.lamp);
    this.root.visible = false;
  }

  /**
   * How much of her to draw: 0 nothing, 1 hull and sails, 2 everything.
   * @param shadows true when she is close enough to cast one
   */
  detail(level: 0 | 1 | 2, shadows: boolean): void {
    if (level !== this.level) {
      this.level = level;
      this.root.visible = level > 0;
      this.top.visible = level > 1;
      if (this.paddle) this.paddle.visible = level > 1;
    }
    if (shadows !== this.shadows) {
      this.shadows = shadows;
      this.hull.castShadow = shadows;
      this.top.castShadow = shadows;
      if (this.main) this.main.castShadow = shadows;
      if (this.jib) this.jib.castShadow = shadows;
    }
  }

  /** Scene position, and her attitude: heading compass radians, pitch, and roll positive to starboard. */
  pose(x: number, y: number, z: number, heading: number, pitch: number, roll: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(pitch, -heading, -roll);
  }

  /**
   * Her sails: stowed, or set for the wind.
   * @param side 1 with the wind on her starboard side, -1 on her port
   * @param boom,clew how far off the centre line the main and the jib are carried, radians
   */
  trim(set: boolean, side: number, boom: number, clew: number): void {
    if (!this.main || !this.jib) return;
    if (set !== this.set) {
      this.set = set;
      this.jib.visible = set;
      // Stowed, the main is a flake along the boom.
      this.main.scale.set(1, set ? 1 : 0.06, 1);
    }
    if (!set) {
      this.main.rotation.y = 0;
      return;
    }
    this.main.rotation.y = -side * boom;
    this.main.scale.x = -side;
    this.jib.rotation.y = -side * clew;
    this.jib.scale.x = -side;
  }

  /** A kayak's paddle: where it is in the stroke, radians, and 0 to 1 how hard she is paddling. */
  stroke(phase: number, effort: number): void {
    if (!this.paddle) return;
    this.paddle.rotation.z = 0.55 * Math.sin(phase) * effort;
    this.paddle.rotation.y = 0.35 * Math.cos(phase) * effort;
  }

  light(on: boolean): void {
    if (this.lamp.visible !== on) this.lamp.visible = on;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.hullMat.dispose();
  }
}
