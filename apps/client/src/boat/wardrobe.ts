import * as THREE from 'three';
import { HAIR_SHADES, HAT_SHADES, JACKETS, SKINS, TROUSERS, hatWorn, type Avatar } from './avatar';

// What an avatar looks like: colours for the limbs the figure already has, and two bundles of simple shapes,
// one that rides on the head (face, hair, hat) and one that rides on the torso (stripes, sash, coat tails).
// Everything is built from spheres, boxes, cylinders and cones, in the same plain style as the figure itself.

/** Nominal spine length the torso pieces are built for. The figure stretches them to its own. */
export const SPINE = 0.54;

export interface Look {
  /** Limb length and limb thickness, 1 for middling. */
  tall: number;
  wide: number;
  torso: number;
  upperArm: number;
  forearm: number;
  thigh: number;
  shin: number;
  hand: number;
  foot: number;
  /** The lifejacket's colour, or null for none. */
  vest: number | null;
  /** Hands this many times normal size: a lobster's claws. */
  handScale: number;
  /** Rides on the head: origin at the centre of the skull, facing -Z. */
  head: THREE.Group;
  /** Rides on the torso: origin at the pelvis, +Y up the spine to the neck at SPINE, front toward -Z. */
  body: THREE.Group;
  /** Throw away the materials made for this look. The shapes are shared and stay. */
  dispose(): void;
}

const TALL = [0.9, 0.95, 1, 1.05, 1.1];
const WIDE = [0.84, 0.92, 1, 1.13, 1.28];

const DARK = 0x16181b;
const WHITE = 0xf0ede4;
const GOLD = 0xd6a524;

// Shapes are made once and shared by every figure.
const shapes = new Map<string, THREE.BufferGeometry>();
function shape(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = shapes.get(key);
  if (!g) shapes.set(key, (g = make()));
  return g;
}
const ball = (r: number): THREE.BufferGeometry => shape(`ball${r}`, () => new THREE.SphereGeometry(r, 8, 6));
const box = (x: number, y: number, z: number): THREE.BufferGeometry => shape(`box${x},${y},${z}`, () => new THREE.BoxGeometry(x, y, z));
const tube = (top: number, bottom: number, h: number, seg = 12): THREE.BufferGeometry => shape(`tube${top},${bottom},${h},${seg}`, () => new THREE.CylinderGeometry(top, bottom, h, seg));
const ring = (r: number, t: number, seg = 14, arc = Math.PI * 2): THREE.BufferGeometry => shape(`ring${r},${t},${seg},${arc}`, () => new THREE.TorusGeometry(r, t, 5, seg, arc));
/** Part of a sphere's skin: `from` and `to` are fractions of the way from the crown (0) to the chin (1); `where` is all round, the back half or the front half. */
const dome = (r: number, from: number, to: number, where: 'all' | 'back' | 'front' = 'all'): THREE.BufferGeometry =>
  shape(`dome${r},${from},${to},${where}`, () => new THREE.SphereGeometry(r, 10, 5, where === 'front' ? Math.PI : 0, where === 'all' ? Math.PI * 2 : Math.PI, from * Math.PI, (to - from) * Math.PI));

class Kit {
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  mat(colour: number, roughness = 0.85): THREE.MeshStandardMaterial {
    const key = `${colour}/${roughness}`;
    let m = this.mats.get(key);
    // Both sides, because hair and hoods are open shells.
    if (!m) this.mats.set(key, (m = new THREE.MeshStandardMaterial({ color: colour, roughness, side: THREE.DoubleSide })));
    return m;
  }
  put(parent: THREE.Object3D, g: THREE.BufferGeometry, colour: number, x = 0, y = 0, z = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(g, this.mat(colour));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}

// ---- the head --------------------------------------------------------------------------------------

function face(k: Kit, head: THREE.Group, a: Avatar, skin: number): void {
  const ink = 0x1a1412;
  const lip = 0x6e2a26;
  for (const s of [-1, 1]) {
    k.put(head, ball(0.02), 0xf4f1ea, s * 0.037, 0.014, -0.088).scale.set(1, 1, 0.5);
    k.put(head, ball(0.011), ink, s * 0.037, 0.014, -0.098).scale.set(1, 1, 0.5);
  }
  k.put(head, ball(0.017), skin, 0, -0.012, -0.104);
  const y = -0.05;
  const z = -0.094;
  if (a.face === 'smile' || a.face === 'grin') {
    const m = k.put(head, ring(0.028, 0.0065, 8, Math.PI), lip, 0, y + 0.016, z);
    m.rotation.set(0.35, 0, Math.PI);
    if (a.face === 'grin') k.put(head, box(0.046, 0.016, 0.012), 0xf4f1ea, 0, y + 0.006, z + 0.001).rotation.x = 0.35;
  } else if (a.face === 'grim') {
    const m = k.put(head, ring(0.026, 0.0065, 8, Math.PI), lip, 0, y - 0.018, z + 0.006);
    m.rotation.x = -0.35;
  } else if (a.face === 'ooh') {
    k.put(head, ball(0.014), lip, 0, y, z - 0.002).scale.set(1, 1.15, 0.5);
  } else {
    k.put(head, box(0.044, 0.009, 0.012), lip, 0, y, z);
  }
}

function specs(k: Kit, head: THREE.Group, kind: string): void {
  if (kind === 'shades') {
    k.put(head, box(0.17, 0.036, 0.03), DARK, 0, 0.012, -0.092).material = k.mat(DARK, 0.5);
  } else if (kind === 'round' || kind === 'square') {
    for (const s of [-1, 1]) {
      const m = k.put(head, kind === 'round' ? ring(0.026, 0.0045, 12) : ring(0.03, 0.0045, 4), kind === 'round' ? GOLD : DARK, s * 0.038, 0.014, -0.104);
      if (kind === 'square') m.rotation.z = Math.PI / 4;
    }
    k.put(head, box(0.03, 0.006, 0.006), kind === 'round' ? GOLD : DARK, 0, 0.018, -0.106);
  } else if (kind === 'aviator') {
    for (const s of [-1, 1]) k.put(head, ball(0.034), 0x2a2218, s * 0.04, 0.008, -0.094).scale.set(1, 1.1, 0.35);
    k.put(head, box(0.04, 0.006, 0.006), GOLD, 0, 0.026, -0.108);
  } else if (kind === 'patch') {
    k.put(head, ball(0.03), DARK, -0.037, 0.014, -0.095).scale.set(1, 1, 0.4);
    const band = k.put(head, ring(0.107, 0.005, 16), DARK, 0, 0.02, 0);
    band.rotation.set(Math.PI / 2, 0.42, 0);
  }
}

function hair(k: Kit, head: THREE.Group, style: string, colour: number, hatted: boolean): void {
  if (style === 'bald') return;
  /** The hair on top of the head, which a hat hides. */
  const top = (from: number, to: number, r = 0.111, tilt = 0.3): void => {
    if (hatted) return;
    k.put(head, dome(r, from, to), colour).rotation.x = tilt;
  };
  if (style === 'crop') {
    top(0, 0.4, 0.108, 0.2);
  } else if (style === 'short') {
    top(0, 0.5);
    // Under a hat, what shows at the back of the neck.
    if (hatted) k.put(head, dome(0.109, 0.42, 0.68, 'back'), colour);
  } else if (style === 'long') {
    top(0, 0.5);
    k.put(head, dome(0.117, 0.25, 0.7, 'back'), colour);
    k.put(head, shape('drape', () => new THREE.CapsuleGeometry(0.085, 0.12, 2, 8)), colour, 0, -0.1, 0.062).scale.set(1.2, 1, 0.5);
  } else if (style === 'tail') {
    top(0, 0.5);
    if (hatted) k.put(head, dome(0.109, 0.42, 0.66, 'back'), colour);
    k.put(head, ball(0.03), colour, 0, 0.03, 0.112);
    k.put(head, shape('tail', () => new THREE.CapsuleGeometry(0.024, 0.15, 2, 6)), colour, 0, -0.06, 0.15).rotation.x = -0.45;
  } else if (style === 'bun') {
    top(0, 0.5);
    if (hatted) k.put(head, dome(0.109, 0.42, 0.66, 'back'), colour);
    k.put(head, ball(0.046), colour, 0, hatted ? 0.0 : 0.075, hatted ? 0.125 : 0.095);
  } else if (style === 'curls') {
    const puff = (x: number, y: number, z: number, r = 0.052) => k.put(head, ball(r), colour, x, y, z);
    if (!hatted) {
      puff(0, 0.1, 0, 0.06);
      for (let i = 0; i < 6; i++) puff(Math.sin((i * Math.PI) / 3) * 0.075, 0.07, Math.cos((i * Math.PI) / 3) * 0.075 + 0.01);
    }
    for (const [x, y, z] of [[-0.09, 0, 0.05], [0.09, 0, 0.05], [0, 0, 0.1], [-0.06, -0.03, 0.085], [0.06, -0.03, 0.085]]) puff(x, y, z, 0.046);
  } else if (style === 'mohawk') {
    if (hatted) return;
    for (let i = 0; i < 6; i++) {
      const a = -0.75 + i * 0.42;
      const spike = k.put(head, shape('spike', () => new THREE.ConeGeometry(0.024, 0.1, 5)), colour, 0, Math.cos(a) * 0.13, Math.sin(a) * 0.13);
      spike.rotation.x = a;
      spike.scale.set(0.7, 1, 1.5);
    }
  }
}

function beard(k: Kit, head: THREE.Group, style: string, colour: number): void {
  if (style === 'none') return;
  const tash = (): void => {
    for (const s of [-1, 1]) k.put(head, box(0.036, 0.013, 0.016), colour, s * 0.017, -0.03, -0.101).rotation.z = s * -0.28;
  };
  if (style === 'tash') tash();
  else if (style === 'goatee') {
    tash();
    k.put(head, ball(0.03), colour, 0, -0.088, -0.066).scale.set(0.9, 1.1, 0.8);
  } else {
    tash();
    k.put(head, dome(0.113, 0.67, 1, 'front'), colour);
    k.put(head, dome(0.111, 0.5, 0.7, 'front'), colour).scale.set(1, 1, 0.55);
    if (style === 'bush') k.put(head, ball(0.085), colour, 0, -0.135, -0.05).scale.set(1.05, 1.25, 0.7);
  }
}

function hat(k: Kit, head: THREE.Group, kind: string, colour: number): void {
  const flat = (m: THREE.Mesh): THREE.Mesh => { m.rotation.x = Math.PI / 2; return m; };
  switch (kind) {
    case 'cap':
      k.put(head, dome(0.112, 0, 0.5), colour, 0, 0.012, 0);
      k.put(head, box(0.15, 0.012, 0.1), colour, 0, 0.03, -0.14);
      break;
    case 'beanie':
      k.put(head, dome(0.117, 0, 0.5), colour, 0, 0.018, 0).scale.y = 1.12;
      flat(k.put(head, ring(0.106, 0.021, 14), colour, 0, 0.03, 0));
      k.put(head, ball(0.034), WHITE, 0, 0.158, 0);
      break;
    case 'souwester': {
      const oilskin = 0xe8b820;
      k.put(head, dome(0.115, 0, 0.5), oilskin, 0, 0.02, 0);
      const brim = k.put(head, tube(0.11, 0.2, 0.045, 14), oilskin, 0, 0.012, 0.035);
      brim.scale.z = 1.3;
      brim.rotation.x = 0.2;
      break;
    }
    case 'sun': {
      const straw = 0xdcc98e;
      k.put(head, tube(0.098, 0.108, 0.075), straw, 0, 0.095, 0);
      k.put(head, tube(0.25, 0.25, 0.012, 18), straw, 0, 0.055, 0);
      k.put(head, tube(0.111, 0.111, 0.024), colour, 0, 0.072, 0);
      break;
    }
    case 'captain': {
      k.put(head, tube(0.109, 0.109, 0.04), colour, 0, 0.065, 0);
      const crown = k.put(head, tube(0.142, 0.112, 0.042, 14), 0xf4f2ec, 0, 0.104, 0.004);
      crown.rotation.x = 0.1;
      k.put(head, box(0.15, 0.01, 0.075), DARK, 0, 0.046, -0.135).rotation.x = 0.22;
      k.put(head, ball(0.02), GOLD, 0, 0.082, -0.112).scale.z = 0.5;
      break;
    }
    case 'bucket':
      k.put(head, tube(0.098, 0.11, 0.075), colour, 0, 0.088, 0);
      k.put(head, tube(0.11, 0.175, 0.045, 14), colour, 0, 0.04, 0);
      break;
    case 'viking': {
      const iron = 0x8b9096;
      k.put(head, dome(0.116, 0, 0.5), iron, 0, 0.02, 0).material = k.mat(iron, 0.45);
      flat(k.put(head, ring(0.112, 0.012, 14), GOLD, 0, 0.026, 0));
      for (const s of [-1, 1]) {
        const horn = k.put(head, shape('horn', () => new THREE.ConeGeometry(0.03, 0.14, 6)), 0xefe7d2, s * 0.135, 0.105, 0);
        horn.rotation.z = s * -0.75;
      }
      break;
    }
    case 'tricorn': {
      const felt = 0x1c1a1a;
      k.put(head, dome(0.11, 0, 0.5), felt, 0, 0.04, 0).scale.y = 0.75;
      // A three-cornered brim, one corner forward, with each side turned up against the crown.
      const r = 0.24;
      k.put(head, tube(r, r, 0.014, 3), felt, 0, 0.05, 0).rotation.y = Math.PI;
      for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
        const side = k.put(head, box(r * 1.5, 0.11, 0.014), felt, Math.sin(a) * r * 0.5, 0.1, Math.cos(a) * r * 0.5);
        side.rotation.order = 'YXZ';
        side.rotation.set(0.3, a, 0);
        const trim = k.put(head, box(r * 1.5, 0.014, 0.02), GOLD, Math.sin(a) * r * 0.565, 0.152, Math.cos(a) * r * 0.565);
        trim.rotation.y = a;
      }
      break;
    }
    case 'santa': {
      const red = 0xc21f1f;
      flat(k.put(head, ring(0.108, 0.026, 14), WHITE, 0, 0.045, 0));
      const cone = new THREE.Group();
      cone.position.set(0, 0.06, 0);
      cone.rotation.set(0.25, 0, -0.45);
      head.add(cone);
      k.put(cone, shape('santa', () => new THREE.ConeGeometry(0.108, 0.24, 10)), red, 0, 0.11, 0);
      k.put(cone, ball(0.036), WHITE, 0, 0.24, 0);
      break;
    }
    case 'peel': {
      const yellow = 0xf2d21f;
      k.put(head, dome(0.124, 0, 0.78, 'back'), yellow);
      k.put(head, dome(0.124, 0, 0.3), yellow);
      k.put(head, shape('peel', () => new THREE.ConeGeometry(0.085, 0.2, 8)), yellow, 0, 0.19, 0.01).rotation.x = 0.12;
      k.put(head, ball(0.022), 0x5b3d1c, 0, 0.292, 0.022);
      break;
    }
    case 'feelers': {
      const shell = 0xc8321e;
      k.put(head, dome(0.124, 0, 0.78, 'back'), shell);
      k.put(head, dome(0.124, 0, 0.3), shell);
      for (const s of [-1, 1]) {
        const feeler = k.put(head, tube(0.005, 0.008, 0.34, 5), shell, s * 0.1, 0.22, -0.12);
        feeler.rotation.set(-0.7, 0, s * -0.45);
        k.put(head, tube(0.009, 0.009, 0.06, 5), shell, s * 0.045, 0.14, -0.04);
        k.put(head, ball(0.02), DARK, s * 0.045, 0.175, -0.04);
      }
      break;
    }
    case 'topper':
      k.put(head, tube(0.092, 0.086, 0.16), 0x15161a, 0, 0.145, 0);
      k.put(head, tube(0.15, 0.15, 0.012, 16), 0x15161a, 0, 0.062, 0);
      k.put(head, tube(0.09, 0.09, 0.028), 0x8f1d1d, 0, 0.082, 0);
      break;
    default:
  }
}

// ---- the body --------------------------------------------------------------------------------------

/** A hoop round the torso at height `y`, a little proud of the jacket. */
function hoop(k: Kit, body: THREE.Group, y: number, h: number, colour: number, grow = 1): THREE.Mesh {
  const m = k.put(body, tube(0.135, 0.135, h, 14), colour, 0, y, 0);
  m.scale.set(1.28 * grow, 1, 0.88 * grow);
  return m;
}

/** Dress an avatar. The figure takes the colours for its own limbs and hangs the two groups on its head and torso. */
export function dress(a: Avatar): Look {
  const k = new Kit();
  const head = new THREE.Group();
  const body = new THREE.Group();
  const skin = SKINS[a.skin].hex;
  const jacket = JACKETS[a.jacket].hex;
  const trousers = TROUSERS[a.trousers].hex;
  let hairShade = HAIR_SHADES[a.hairShade].hex;
  let beardStyle = a.beard;
  let glasses = a.specs;
  const look: Look = {
    tall: TALL[a.height], wide: WIDE[a.girth],
    torso: jacket, upperArm: jacket, forearm: jacket, thigh: trousers, shin: trousers, hand: skin, foot: DARK, vest: null, handScale: 1,
    head, body, dispose: () => k.dispose(),
  };
  const all = (top: number, legs: number): void => {
    look.torso = look.upperArm = look.forearm = top;
    look.thigh = look.shin = legs;
  };

  switch (a.outfit) {
    case 'own':
      look.vest = 0x2a2d33;
      break;
    case 'breton': {
      all(WHITE, 0xe6e3da);
      for (let i = 0; i < 6; i++) hoop(k, body, 0.05 + i * 0.075, 0.026, 0x1d2f55, i === 5 ? 0.97 : 1);
      // A red neckerchief, knotted at the front.
      const scarf = k.put(body, ring(0.075, 0.022, 12), 0xc2281d, 0, 0.535, -0.005);
      scarf.rotation.x = Math.PI / 2;
      k.put(body, ball(0.028), 0xc2281d, 0, 0.5, -0.1);
      look.foot = 0x8a6a45;
      break;
    }
    case 'pirate': {
      const coat = 0x7a1c1c;
      all(coat, 0x1c1c20);
      look.shin = 0x35241a;
      look.foot = 0x35241a;
      k.put(body, box(0.13, 0.22, 0.02), WHITE, 0, 0.37, -0.112);
      hoop(k, body, 0.15, 0.065, GOLD, 1.03);
      // Coat tails to the knee.
      const skirt = k.put(body, shape('skirt', () => new THREE.CylinderGeometry(0.14, 0.2, 0.3, 12, 1, true)), coat, 0, -0.06, 0);
      skirt.scale.set(1.28, 1, 0.95);
      for (const y of [0.3, 0.38, 0.46]) k.put(body, ball(0.014), GOLD, 0.075, y, -0.118);
      glasses = 'patch';
      break;
    }
    case 'aloha': {
      const shirt = 0x14a39b;
      look.torso = look.upperArm = shirt;
      look.forearm = skin;
      look.thigh = 0xd2bf90;
      look.shin = skin;
      look.foot = 0x8a6a45;
      // Flowers all over, and a lei.
      const petals = [0xf6c62e, 0xf2668f, WHITE];
      for (let i = 0; i < 16; i++) {
        const ang = i * 2.4;
        const y = 0.06 + ((i * 7) % 16) * 0.027;
        const narrow = y > 0.45 ? 0.93 : 1;
        const blob = k.put(body, ball(0.03), petals[i % 3], Math.sin(ang) * 0.166 * narrow, y, Math.cos(ang) * 0.114 * narrow);
        blob.scale.setScalar(0.95);
      }
      const lei = k.put(body, ring(0.105, 0.028, 12), 0xf08ab2, 0, 0.47, -0.03);
      lei.rotation.x = Math.PI / 2 - 0.5;
      lei.scale.set(1.25, 1, 1);
      break;
    }
    case 'wetsuit': {
      const neoprene = 0x15171a;
      const flash = 0x1e90d6;
      all(neoprene, neoprene);
      hoop(k, body, 0.39, 0.09, flash, 1.01);
      for (const s of [-1, 1]) k.put(body, box(0.012, 0.34, 0.07), flash, s * 0.163, 0.17, 0);
      look.foot = skin;
      break;
    }
    case 'tux': {
      const black = 0x121316;
      all(black, black);
      k.put(body, box(0.1, 0.27, 0.02), 0xf7f5ef, 0, 0.345, -0.113);
      for (const s of [-1, 1]) k.put(body, shape('bow', () => new THREE.ConeGeometry(0.024, 0.05, 4)), 0xb5271d, s * 0.026, 0.495, -0.118).rotation.z = s * (Math.PI / 2);
      for (const y of [0.27, 0.35, 0.43]) k.put(body, ball(0.009), black, 0, y, -0.124);
      look.foot = 0x0c0c0e;
      break;
    }
    case 'santa': {
      const red = 0xc21f1f;
      all(red, red);
      look.shin = DARK;
      hoop(k, body, 0.0, 0.07, WHITE, 1.05);
      hoop(k, body, 0.15, 0.05, DARK, 1.03);
      k.put(body, box(0.06, 0.06, 0.02), GOLD, 0, 0.15, -0.123);
      k.put(body, box(0.045, 0.32, 0.02), WHITE, 0, 0.36, -0.113);
      beardStyle = 'bush';
      hairShade = 0xf2f0ea;
      break;
    }
    case 'banana': {
      const yellow = 0xf2d21f;
      look.torso = look.upperArm = look.forearm = yellow;
      look.thigh = look.shin = 0x1c1c20;
      // The fruit itself, from the knees to the neck.
      const fruit = k.put(body, shape('banana', () => new THREE.CapsuleGeometry(0.165, 0.42, 3, 10)), yellow, 0, 0.22, 0);
      fruit.scale.set(1.2, 1, 0.9);
      for (const s of [-1, 1]) k.put(body, box(0.012, 0.62, 0.03), 0xc9a718, s * 0.1, 0.22, -0.142);
      break;
    }
    case 'lobster': {
      const shell = 0xc8321e;
      all(shell, shell);
      look.hand = shell;
      look.foot = shell;
      look.handScale = 2.1;
      // A paler belly, and a tail down the back.
      k.put(body, box(0.16, 0.36, 0.02), 0xe9a184, 0, 0.27, -0.112);
      for (let i = 0; i < 4; i++) {
        const plate = k.put(body, box(0.24 - i * 0.02, 0.09, 0.04), shell, 0, 0.08 - i * 0.085, 0.12 + i * 0.012);
        plate.rotation.x = 0.12;
      }
      const fan = k.put(body, tube(0.16, 0.05, 0.1, 5), shell, 0, -0.27, 0.165);
      fan.scale.z = 0.25;
      fan.rotation.x = Math.PI + 0.12;
      break;
    }
    default:
      // Foul-weather gear: the red jacket and dark lifejacket she has always worn.
      all(0xc2281d, 0x1f2630);
      look.vest = 0x2a2d33;
  }

  const worn = hatWorn(a);
  k.put(head, shape('skull', () => new THREE.SphereGeometry(0.105, 12, 9)), skin).material = k.mat(skin, 0.75);
  face(k, head, a, skin);
  specs(k, head, glasses);
  hair(k, head, a.hair, hairShade, worn !== 'none');
  beard(k, head, beardStyle, hairShade);
  hat(k, head, worn, HAT_SHADES[a.hatShade].hex);
  return look;
}
