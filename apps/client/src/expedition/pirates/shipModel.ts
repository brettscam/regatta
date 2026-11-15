import * as THREE from 'three';
import { Rope } from '../../boat/boatView';
import { Cloth } from '../../boat/cairdView';
import { sailcloth } from '../../boat/buildCaird';
import type { MastLook, Nation, ShipClass } from './tables';

// A ship of about 1715, drawn from a row of the ship table: a lofted hull with a transom and bulwarks, gun ports with
// the muzzles run out, a bowsprit, and for each mast either a gaff sail on a boom or two square sails on yards, with a
// jib forward and her colours aloft. One builder draws the player's sloop and every other ship, so a new class in the
// table needs no new drawing. It is schematic: no blocks, no ratlines, no carving.
//
// Boat frame as everywhere: +X starboard, +Y up, -Z forward, origin on the waterline amidships.
// SEAM, square rig for the player: the square sails here are braced by `setSails` from the wind alone. A player's
// square-rigger would brace them from the sim's state instead, as the gaff sail already takes its boom angle.


const clamp = THREE.MathUtils.clamp;

export interface ShipLook {
  loa: number;
  beam: number;
  freeboard: number;
  draft: number;
  masts: MastLook[];
  guns: number;
  nation: Nation;
  /** Paint: the topsides, and the band along the gun ports. */
  topsides: number;
  band: number;
  /** The longest boom, when it is known (the player's sloop). Otherwise it is taken from her length. */
  boom?: number;
}

const PAINT: Record<string, [number, number]> = {
  merchant: [0x4a3524, 0x9a7a3c],
  warship: [0x1d1c1b, 0xb08a3a],
  pirate: [0x23201d, 0x6e1f1a],
};

export function lookOf(cls: ShipClass, nation: Nation): ShipLook {
  const [topsides, band] = PAINT[cls.kind];
  return { loa: cls.loa, beam: cls.beam, freeboard: cls.freeboard, draft: cls.draft, masts: cls.masts, guns: cls.guns, nation, topsides, band };
}

const flags = new Map<Nation, THREE.CanvasTexture>();

/** Her colours, as they would be told apart through a glass: no finer than that. */
function flagTexture(nation: Nation): THREE.CanvasTexture {
  const known = flags.get(nation);
  if (known) return known;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const g = c.getContext('2d')!;
  if (nation === 'english') {
    // The red ensign: a red fly, the union in the canton.
    g.fillStyle = '#a3201c'; g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#1f2c5c'; g.fillRect(0, 0, 44, 30);
    g.strokeStyle = '#e8e4d8'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(44, 30); g.moveTo(44, 0); g.lineTo(0, 30); g.stroke();
    g.fillStyle = '#e8e4d8'; g.fillRect(17, 0, 10, 30); g.fillRect(0, 10, 44, 10);
    g.fillStyle = '#a3201c'; g.fillRect(19.5, 0, 5, 30); g.fillRect(0, 12.5, 44, 5);
  } else if (nation === 'spanish') {
    // The ragged cross of Burgundy, red on white.
    g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, 96, 64);
    g.strokeStyle = '#a3201c'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(6, 4); g.lineTo(90, 60); g.moveTo(90, 4); g.lineTo(6, 60); g.stroke();
  } else if (nation === 'french') {
    // The white of the Bourbons: a merchant wore a white cross on blue.
    g.fillStyle = '#27407a'; g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#e8e4d8'; g.fillRect(40, 0, 16, 64); g.fillRect(0, 24, 96, 16);
  } else if (nation === 'dutch') {
    g.fillStyle = '#a3201c'; g.fillRect(0, 0, 96, 22);
    g.fillStyle = '#e8e4d8'; g.fillRect(0, 22, 96, 21);
    g.fillStyle = '#27407a'; g.fillRect(0, 43, 96, 21);
  } else {
    // Black, with an hourglass: your time is running out. A common enough device, and nobody's in particular.
    g.fillStyle = '#121212'; g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#e8e4d8';
    g.beginPath(); g.moveTo(34, 14); g.lineTo(62, 14); g.lineTo(48, 32); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(34, 50); g.lineTo(62, 50); g.lineTo(48, 32); g.closePath(); g.fill();
    g.fillRect(32, 11, 32, 3); g.fillRect(32, 50, 32, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  flags.set(nation, t);
  return t;
}

let canvasMat: THREE.MeshStandardMaterial | null = null;
const cloth = () => (canvasMat ??= new THREE.MeshStandardMaterial({ map: sailcloth(), color: 0xf2ead8, roughness: 0.95, side: THREE.DoubleSide }));

interface GaffSail { kind: 'gaff'; mast: MastLook; z: number; foot: number; top: number; boom: number; gaff: number; sail: Cloth; boomSpar: Rope; gaffSpar: Rope }
interface SquareSail { kind: 'square'; mast: MastLook; z: number; foot: number; sails: Cloth[]; yards: Rope[]; levels: Array<{ y0: number; y1: number; half0: number; half1: number }> }

/** How the sails are to be laid this frame. */
export interface SailSet {
  /** Angle of the gaff sail's boom off the centreline, radians, positive to starboard. Left out, it is taken from the wind. */
  boom?: number;
  /** Angle of the jib's clew off the centreline, radians. */
  jib?: number;
  /** Apparent wind angle, radians, positive on the starboard side, and its speed in m/s. */
  awa: number;
  aws: number;
  /** 0 drawing, up to 1 lifting, 2 flogging. */
  shake?: number;
  jibShake?: number;
  /** How much of each sail is set: 1 all of it, 0 none. */
  hoist?: number;
  jibSet?: boolean;
  /** False when she has struck her colours. */
  colours?: boolean;
}

export class PeriodShip {
  readonly root = new THREE.Group();
  readonly nodes: Record<string, THREE.Object3D> = {};
  readonly solids: THREE.Object3D[] = [];
  readonly thin: THREE.Object3D[] = [];
  readonly hitProxies: THREE.Mesh[] = [];
  readonly half: number;
  /** Where the muzzles are, each side, boat frame: for the smoke. */
  readonly muzzles: Record<'port' | 'starboard', THREE.Vector3[]> = { port: [], starboard: [] };
  /** The guns as drawn, a pair to each port, from forward aft. */
  private readonly gunPairs: THREE.Object3D[][] = [];
  readonly rudderHead = new THREE.Vector3();
  readonly tillerLength: number;
  readonly mainTack = new THREE.Vector3();
  readonly boomLength: number;
  readonly cleatPort = new THREE.Vector3();
  readonly cleatStbd = new THREE.Vector3();
  readonly stemHead = new THREE.Vector3();
  readonly jibHead = new THREE.Vector3();
  readonly jibFoot: number;
  private readonly rigs: Array<GaffSail | SquareSail> = [];
  private readonly jib: Cloth;
  private readonly flag: THREE.Mesh;
  private readonly flagAt = new THREE.Vector3();
  private readonly sheet = new Rope(0x8d7a55, 0.03);
  private belly = 1;
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();

  /** Height of the deck above the waterline at a fore-and-aft position. */
  readonly deckY: (z: number) => number;
  readonly halfBreadth: (z: number) => number;

  constructor(readonly look: ShipLook) {
    const L = look.loa;
    const half = (this.half = L / 2);
    const B = look.beam / 2;
    const root = this.root;
    root.rotation.order = 'YXZ';
    const mat = (color: number, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
    const wood = mat(0x8a6a44, 0.8);
    const spar = mat(0x9a7a52, 0.7);
    const iron = mat(0x1c1c1d, 0.55);
    const BULWARK = clamp(0.5 + L * 0.02, 0.75, 1.15);

    // s runs from -1 at the stem to +1 at the transom.
    const breadth = (s: number) => B * (s < 0 ? Math.pow(Math.max(0, 1 - Math.pow(-s, 2.3)), 0.62) : 1 - 0.34 * Math.pow(s, 3));
    const sheer = (s: number) => look.freeboard + L * 0.012 * (s < 0 ? 1.1 * s * s : 2.2 * s * s);
    const keel = (s: number) => -look.draft * (s < 0 ? Math.pow(Math.max(0, 1 - Math.pow(-s, 3.2)), 0.7) : 1 - 0.25 * Math.pow(s, 3));
    this.deckY = (z) => sheer(clamp(z / half, -1, 1));
    this.halfBreadth = (z) => breadth(clamp(z / half, -1, 1));

    // ---- the hull, to the top of the bulwarks ----
    {
      const NS = 34;
      const NU = 10;
      const pos: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      const top = new THREE.Color(look.topsides);
      const band = new THREE.Color(look.band);
      const bottom = new THREE.Color(0xcfc8b4);
      const c = new THREE.Color();
      for (const side of [-1, 1]) {
        const base = pos.length / 3;
        for (let i = 0; i <= NS; i++) {
          const s = -1 + (2 * i) / NS;
          const b = breadth(s);
          const k = keel(s);
          const rail = sheer(s) + BULWARK;
          for (let j = 0; j <= NU; j++) {
            const u = j / NU;
            const y = k + (rail - k) * (0.22 * u + 0.78 * Math.pow(u, 1.9));
            // Full bilges, a little tumblehome at the rail.
            const x = b * (1 - Math.pow(1 - u, 2.4)) * (1 - 0.05 * Math.max(0, u - 0.8) / 0.2);
            pos.push(side * x, y, s * half);
            // White stuff below the water, dark topsides, a band of colour along the ports.
            if (y < 0.15) c.copy(bottom).multiplyScalar(0.75 + 0.1 * ((i + j) % 3));
            else if (y > sheer(s) - 0.1 && y < sheer(s) + BULWARK * 0.75) c.copy(band);
            else c.copy(top);
            c.multiplyScalar(0.9 + 0.1 * (((i * 5 + j * 3) % 4) / 4));
            col.push(c.r, c.g, c.b);
          }
        }
        for (let i = 0; i < NS; i++) {
          for (let j = 0; j < NU; j++) {
            const a = base + i * (NU + 1) + j;
            const b2 = a + NU + 1;
            if (side > 0) idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
            else idx.push(a, a + 1, b2, a + 1, b2 + 1, b2);
          }
        }
      }
      // The transom: a fan across the stern.
      const tb = pos.length / 3;
      const railT = sheer(1) + BULWARK;
      const kT = keel(1);
      for (let j = 0; j <= NU; j++) {
        const u = j / NU;
        const y = kT + (railT - kT) * (0.22 * u + 0.78 * Math.pow(u, 1.9));
        const x = breadth(1) * (1 - Math.pow(1 - u, 2.4)) * (1 - 0.05 * Math.max(0, u - 0.8) / 0.2);
        for (const side of [-1, 1]) {
          pos.push(side * x, y, half);
          c.set(y > look.freeboard * 0.7 ? look.band : look.topsides).multiplyScalar(0.8);
          col.push(c.r, c.g, c.b);
        }
      }
      for (let j = 0; j < NU; j++) idx.push(tb + j * 2, tb + j * 2 + 1, tb + j * 2 + 2, tb + j * 2 + 1, tb + j * 2 + 3, tb + j * 2 + 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const hull = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }));
      hull.name = 'hull';
      hull.castShadow = true;
      hull.receiveShadow = true;
      this.nodes.hull = hull;
      root.add(hull);
      this.solids.push(hull);
    }

    // ---- the deck, inside the bulwarks ----
    {
      const NS = 26;
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= NS; i++) {
        const s = -0.97 + (1.96 * i) / NS;
        const b = breadth(s) * 0.93;
        pos.push(-b, sheer(s), s * half, 0, sheer(s) + 0.06 * (b / B), s * half, b, sheer(s), s * half);
      }
      for (let i = 0; i < NS; i++) {
        const a = i * 3;
        idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const deck = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb59a6c, roughness: 0.95, side: THREE.DoubleSide }));
      deck.name = 'deck';
      deck.receiveShadow = true;
      this.nodes.deck = deck;
      root.add(deck);
      this.solids.push(deck);
      // Hatch gratings and a low cabin top aft, so the deck is not a bare plank.
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(B * 0.7, 0.25, L * 0.09), mat(0x4b3a28, 0.9));
      hatch.position.set(0, this.deckY(L * 0.06) + 0.13, L * 0.06);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(B * 0.95, 0.55, L * 0.13), mat(0x6a5236, 0.9));
      cabin.position.set(0, this.deckY(half * 0.52) + 0.28, half * 0.52);
      hatch.castShadow = cabin.castShadow = true;
      root.add(hatch, cabin);
    }

    // ---- the guns: half to a side, muzzles run out through the bulwark ----
    {
      const perSide = Math.floor(look.guns / 2);
      const barrel = new THREE.CylinderGeometry(0.075, 0.1, 1.5, 8).rotateZ(Math.PI / 2);
      const carriage = new THREE.BoxGeometry(0.75, 0.3, 0.5);
      const port = new THREE.BoxGeometry(0.06, 0.5, 0.6);
      const dark = mat(0x0c0b0a, 1);
      const cwood = mat(0x7a2f22, 0.9);
      for (let n = 0; n < perSide; n++) {
        const pair: THREE.Object3D[] = [];
        this.gunPairs.push(pair);
        const z = perSide === 1 ? 0 : -half * 0.36 + (half * 0.86 * n) / (perSide - 1);
        const y = this.deckY(z) + 0.42;
        for (const side of [-1, 1] as const) {
          const b = this.halfBreadth(z);
          const gun = new THREE.Mesh(barrel, iron);
          gun.position.set(side * (b - 0.5), y, z);
          gun.castShadow = true;
          const car = new THREE.Mesh(carriage, cwood);
          car.position.set(side * (b - 0.95), y - 0.22, z);
          const lid = new THREE.Mesh(port, dark);
          lid.position.set(side * (b * 0.985), y, z);
          root.add(gun, car, lid);
          pair.push(gun, car);
          this.muzzles[side < 0 ? 'port' : 'starboard'].push(new THREE.Vector3(side * (b + 0.3), y, z));
        }
      }
    }

    // ---- bowsprit, rudder and tiller ----
    const stemY = sheer(-1) + BULWARK;
    const sprit = L * (look.masts.length === 1 ? 0.42 : 0.3);
    {
      const rise = 0.28;
      const bs = new THREE.Mesh(new THREE.CylinderGeometry(0.07 + L * 0.002, 0.11 + L * 0.003, sprit + 2, 8), spar);
      bs.rotation.x = -(Math.PI / 2 - rise);
      bs.position.set(0, stemY + Math.sin(rise) * (sprit / 2 - 1), -half - Math.cos(rise) * (sprit / 2 - 1));
      bs.castShadow = true;
      root.add(bs);
      this.stemHead.set(0, stemY + Math.sin(rise) * sprit, -half - Math.cos(rise) * sprit);
      const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.12, look.draft + look.freeboard, 0.9), wood);
      rudder.position.set(0, (look.freeboard - look.draft) / 2, half + 0.4);
      root.add(rudder);
      this.rudderHead.set(0, sheer(1) + 0.75, half - 0.2);
    }
    this.tillerLength = clamp(L * 0.16, 2, 3.4);
    {
      const tiller = new THREE.Group();
      tiller.name = 'tiller';
      tiller.position.copy(this.rudderHead);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, this.tillerLength, 7).rotateX(Math.PI / 2), wood);
      bar.position.z = -this.tillerLength / 2;
      bar.userData.glow = true;
      bar.castShadow = true;
      tiller.add(bar);
      const grab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, this.tillerLength + 0.3), new THREE.MeshBasicMaterial({ visible: false }));
      grab.position.z = -this.tillerLength / 2;
      grab.userData.node = 'tiller';
      tiller.add(grab);
      this.hitProxies.push(grab);
      this.nodes.tiller = tiller;
      root.add(tiller);
    }

    // ---- masts, spars and canvas ----
    const lines: number[] = [];
    let tallest = { z: 0, top: 0 };
    look.masts.forEach((m, mi) => {
      const z = -half + m.at * L;
      const foot = this.deckY(z);
      const top = foot + m.height;
      if (top > tallest.top) tallest = { z, top };
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09 + m.height * 0.003, 0.16 + m.height * 0.006, m.height + 1, 9), spar);
      // A sloop's mast rakes well aft.
      const rake = m.rig === 'gaff' && look.masts.length === 1 ? 0.07 : 0.02;
      mast.rotation.x = rake;
      mast.position.set(0, foot + m.height / 2 - 0.5, z + Math.sin(rake) * m.height * 0.5);
      mast.castShadow = true;
      mast.name = mi === 0 ? 'mast' : `mast_${mi}`;
      this.nodes[mast.name] = mast;
      root.add(mast);
      this.solids.push(mast);
      // A shroud each side and a stay forward, as lines.
      for (const side of [-1, 1]) lines.push(side * this.halfBreadth(z + 1.2), foot + BULWARK, z + 1.2, 0, top - m.height * 0.15, z + Math.sin(rake) * m.height * 0.85);
      if (m.rig === 'gaff') {
        const boom = look.boom && mi === look.masts.length - 1 ? look.boom : Math.min(L * (look.masts.length === 1 ? 0.7 : 0.4), half - z + L * 0.12);
        const sail = new Cloth(cloth(), 8, 10);
        const boomSpar = new Rope(0x9a7a52, 0.1);
        const gaffSpar = new Rope(0x9a7a52, 0.075);
        root.add(sail.mesh, boomSpar.mesh, gaffSpar.mesh);
        this.rigs.push({ kind: 'gaff', mast: m, z, foot, top, boom, gaff: boom * 0.55, sail, boomSpar, gaffSpar });
      } else {
        // A course and a topsail.
        const yard = clamp(look.beam * 1.25, 6, 14);
        const levels = [
          { y0: foot + m.height * 0.14, y1: foot + m.height * 0.52, half0: yard * 0.5, half1: yard * 0.47 },
          { y0: foot + m.height * 0.55, y1: foot + m.height * 0.9, half0: yard * 0.45, half1: yard * 0.33 },
        ];
        const sails = levels.map(() => new Cloth(cloth(), 6, 6));
        const yards = [new Rope(0x9a7a52, 0.09), new Rope(0x9a7a52, 0.07)];
        for (const s of sails) root.add(s.mesh);
        for (const y of yards) root.add(y.mesh);
        this.rigs.push({ kind: 'square', mast: m, z, foot, sails, yards, levels });
      }
    });
    for (const rig of this.rigs) {
      const meshes = rig.kind === 'gaff' ? [rig.sail.mesh] : rig.sails.map((s) => s.mesh);
      for (const mesh of meshes) {
        mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, rig.foot + rig.mast.height / 2, rig.z), rig.mast.height);
        this.thin.push(mesh);
      }
    }
    // The player works the sloop's mainsheet by pointing at her boom.
    const main = this.rigs.find((r): r is GaffSail => r.kind === 'gaff');
    this.boomLength = main?.boom ?? 0;
    if (main) {
      this.mainTack.set(0, main.foot + clamp(L * 0.13, 1.6, 2.8), main.z + 0.3);
      const handle = new THREE.Group();
      handle.name = 'main_sheet';
      handle.position.copy(this.mainTack);
      const grab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, main.boom), new THREE.MeshBasicMaterial({ visible: false }));
      grab.position.z = main.boom / 2;
      grab.userData.node = 'main_sheet';
      handle.add(grab);
      this.hitProxies.push(grab);
      this.nodes.main_sheet = handle;
      root.add(handle);
    }
    root.add(this.sheet.mesh);
    const first = look.masts[0];
    const firstZ = -half + first.at * L;
    this.jibHead.set(0, this.deckY(firstZ) + first.height * 0.86, firstZ);
    this.jibFoot = Math.min(sprit + (firstZ + half) - 1, L * 0.5);
    lines.push(this.stemHead.x, this.stemHead.y, this.stemHead.z, 0, this.jibHead.y + 0.6, this.jibHead.z);
    const rigging = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)), new THREE.LineBasicMaterial({ color: 0x1b1815 }));
    root.add(rigging);
    this.jib = new Cloth(cloth(), 6, 8);
    this.jib.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, this.jibHead.y / 2, -half), first.height);
    this.jib.mesh.name = 'jib';
    this.nodes.jib = this.jib.mesh;
    root.add(this.jib.mesh);
    this.thin.push(this.jib.mesh);
    const b = this.halfBreadth(half * 0.5) - 0.3;
    this.cleatPort.set(-b, this.deckY(half * 0.5) + BULWARK, half * 0.5);
    this.cleatStbd.set(b, this.deckY(half * 0.5) + BULWARK, half * 0.5);

    // ---- her colours, at the highest masthead ----
    const fw = clamp(L * 0.17, 2.4, 5);
    const fg = new THREE.PlaneGeometry(fw, fw * 0.62, 8, 1).translate(fw / 2, 0, 0);
    this.flag = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: flagTexture(look.nation), side: THREE.DoubleSide }));
    this.flagAt.set(0, tallest.top + fw * 0.2, tallest.z + (look.masts.length === 1 ? 1.4 : 0.4));
    this.flag.position.copy(this.flagAt);
    this.flag.frustumCulled = false;
    root.add(this.flag);
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, fw * 0.9, 5), spar);
    staff.position.copy(this.flagAt);
    root.add(staff);
  }

  /** Show only the guns she has: the ports of the rest stay shut. Guns go from the ends of the battery first. */
  showGuns(inAll: number): void {
    const pairs = Math.floor(inAll / 2);
    const n = this.gunPairs.length;
    // Which ports are filled, from amidships outward.
    const order = [...this.gunPairs.keys()].sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
    order.forEach((index, rank) => { for (const o of this.gunPairs[index]) o.visible = rank < pairs; });
  }

  /** Lay every sail for the wind she has, and fly her colours down it. */
  setSails(set: SailSet, time: number, dt: number): void {
    const windSide = set.awa >= 0 ? 1 : -1;
    const target = Math.abs(set.awa) < 0.05 ? 0 : -windSide;
    this.belly += clamp(target - this.belly, -dt * 3, dt * 3);
    const hoist = set.hoist ?? 1;
    const shake = set.shake ?? 0;
    // Left to herself, a boom lies to leeward at about half the angle of the wind.
    const free = -windSide * clamp(Math.abs(set.awa) * 0.5, 0.14, 1.4);
    const boomAngle = set.boom ?? free;
    for (const rig of this.rigs) {
      if (rig.kind === 'gaff') {
        const a = boomAngle;
        const tackY = rig.foot + clamp(this.look.loa * 0.13, 1.6, 2.8);
        const at = (r: number, y: number, twist: number, o: THREE.Vector3) => o.set(Math.sin(a * twist) * r, y, rig.z + 0.3 + Math.cos(a * twist) * r);
        const c = rig.sail.corners;
        at(0.2, tackY, 1, c.tack);
        at(rig.boom, tackY + 0.3, 1, c.clew);
        const throatY = tackY + (rig.mast.height * 0.62 - 1) * hoist;
        at(0.2, throatY, 1.08, c.throat);
        at(rig.gaff, throatY + rig.gaff * 0.75 * hoist, 1.15, c.peak);
        rig.sail.mesh.visible = hoist > 0.1;
        rig.gaffSpar.mesh.visible = hoist > 0.1;
        if (hoist > 0.1) {
          rig.sail.lay(this.belly, rig.boom * 0.11, shake, set.aws, time, 0);
          rig.gaffSpar.set(c.throat, this.v1.lerpVectors(c.throat, c.peak, 1.05));
        }
        at(0, tackY - 0.05, 1, this.v1);
        at(rig.boom + 0.4, tackY + 0.25, 1, this.v2);
        rig.boomSpar.set(this.v1, this.v2);
        if (rig === this.rigs.find((r) => r.kind === 'gaff')) {
          this.nodes.main_sheet.rotation.y = a;
          at(rig.boom * 0.9, tackY + 0.1, 1, this.v1);
          this.sheet.set(this.v1, this.v2.set(0, this.deckY(this.half * 0.8) + 0.8, this.half * 0.8));
        }
      } else {
        // Yards square before the wind, braced sharp up on it: the weather yardarm goes forward.
        const brace = windSide * clamp((Math.PI - Math.abs(set.awa)) * 0.45, 0, 0.95);
        const cs = Math.cos(brace);
        const sn = Math.sin(brace);
        rig.levels.forEach((lv, i) => {
          const sail = rig.sails[i];
          const c = sail.corners;
          const up = lv.y0 + (lv.y1 - lv.y0) * (1 - hoist);
          const z = rig.z - 0.35;
          c.tack.set(-lv.half0 * cs, up, z + lv.half0 * sn);
          c.clew.set(lv.half0 * cs, up, z - lv.half0 * sn);
          c.throat.set(-lv.half1 * cs, lv.y1, z + lv.half1 * sn);
          c.peak.set(lv.half1 * cs, lv.y1, z - lv.half1 * sn);
          sail.mesh.visible = hoist > 0.1;
          if (hoist > 0.1) sail.lay(1, lv.half0 * 0.3, shake * 0.6, set.aws, time, i * 3);
          rig.yards[i].set(this.v1.set(-lv.half1 * cs * 1.08, lv.y1, z + lv.half1 * sn * 1.08), this.v2.set(lv.half1 * cs * 1.08, lv.y1, z - lv.half1 * sn * 1.08));
        });
      }
    }
    // The jib: from the bowsprit end to the masthead, its clew to leeward.
    const jibUp = (set.jibSet ?? true) && hoist > 0.5;
    this.jib.mesh.visible = jibUp;
    if (jibUp) {
      const ja = set.jib ?? free * 0.8;
      const j = this.jib.corners;
      j.tack.copy(this.stemHead);
      j.clew.set(Math.sin(ja) * this.jibFoot, this.stemHead.y + 0.8, this.stemHead.z + Math.cos(ja) * this.jibFoot);
      j.throat.copy(this.jibHead);
      j.peak.copy(this.jibHead);
      this.jib.lay(this.belly, this.jibFoot * 0.1, set.jibShake ?? shake, set.aws, time, 7);
    }
    // Her colours stream down the apparent wind, and ripple.
    this.flag.visible = set.colours ?? true;
    this.flag.rotation.y = Math.atan2(-Math.cos(set.awa), -Math.sin(set.awa));
    const pos = this.flag.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(x * 2.2 - time * 7) * 0.09 * x * Math.min(1.5, set.aws / 6));
    }
    pos.needsUpdate = true;
  }

  /** Free what this ship made for herself. The sailcloth and the flags are shared and stay. */
  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}


