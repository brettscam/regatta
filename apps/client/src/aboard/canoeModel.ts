import * as THREE from 'three';
import { Figure } from '../boat/crew';

// A one-person outrigger canoe: a long slim hull, a float (the ama) out to port on two curved arms (the iako),
// and a paddler built from the same limbs as the yacht's crew.
// Model frame as for the yacht: +X starboard, +Y up, -Z forward, origin on the waterline amidships.

/** Length of the main hull, metres. */
export const CANOE_LENGTH = 6.2;
/** How far out to port the float rides. */
export const AMA_OFFSET = 1.45;

const PADDLE = 1.34;
const SEAT_Z = 0.35;
const Y = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;

interface Section {
  /** Half the beam at the sheer. */
  half: number;
  keel: number;
  sheer: number;
}

/**
 * A hull lofted through sections from stern (t = -1) to bow (t = 1): the skin below the sheer and the deck above it,
 * as two shapes so each can take its own colour and the sheer stays a crisp edge.
 */
function loft(length: number, section: (t: number) => Section, camber: number): { skin: THREE.BufferGeometry; deck: THREE.BufferGeometry } {
  const stations = 28;
  const round = 8;
  const across = 4;
  const skin: number[] = [];
  const deck: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = -1 + (2 * i) / stations;
    const z = (-t * length) / 2;
    const s = section(t);
    for (let k = 0; k <= round; k++) {
      const a = (Math.PI * k) / round;
      skin.push(-s.half * Math.cos(a), s.sheer - (s.sheer - s.keel) * Math.sin(a) ** 0.7, z);
    }
    for (let k = 0; k <= across; k++) {
      const u = -1 + (2 * k) / across;
      deck.push(s.half * u, s.sheer + camber * (s.half > 1e-4 ? 1 - u * u : 0) * Math.min(1, s.half * 12), z);
    }
  }
  const grid = (cols: number, flip: boolean): number[] => {
    const idx: number[] = [];
    for (let i = 0; i < stations; i++) {
      for (let k = 0; k < cols; k++) {
        const a = i * (cols + 1) + k;
        const b = a + 1;
        const c = a + cols + 1;
        const d = c + 1;
        if (flip) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
    return idx;
  };
  const make = (pos: number[], idx: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  return { skin: make(skin, grid(round, true)), deck: make(deck, grid(across, false)) };
}

const hullSection = (t: number): Section => {
  const u = Math.abs(t);
  return {
    half: 0.215 * Math.max(0, 1 - u ** 2.3) ** 0.8,
    keel: -0.13 + 0.12 * u ** 2.5,
    sheer: 0.19 + 0.1 * Math.max(0, t) ** 2 + 0.035 * Math.max(0, -t) ** 2,
  };
};

const amaSection = (t: number): Section => {
  const u = Math.abs(t);
  return {
    half: 0.088 * Math.max(0, 1 - u ** 2.2) ** 0.7,
    keel: -0.075 + 0.11 * u * u,
    sheer: 0.075 + 0.08 * u * u,
  };
};

export class CanoeModel {
  readonly root = new THREE.Group();
  private readonly figure: Figure;
  private readonly paddle = new THREE.Group();
  private readonly owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  /** Where the stroke is in its cycle, 0 to 1: the pull through the water, then the swing forward through the air. */
  private phase = 0.7;
  /** 0 resting with the paddle across the lap, 1 paddling. */
  private effort = 0;
  /** Which side the blade is on, eased: 1 starboard, -1 port. */
  private side = 1;
  private sideWanted = 1;
  private strokes = 0;
  private switchAt = 9;
  /** 0 a straight pull, 1 a wide sweep to turn her. */
  private sweep = 0;
  private manned = true;

  private readonly top = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly restTop = new THREE.Vector3();
  private readonly restTip = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly low = new THREE.Vector3();

  /** @param accent the yacht's topsides colour, for the deck and the float */
  constructor(accent: string | undefined) {
    this.root.name = 'outrigger';
    this.root.rotation.order = 'YXZ';
    const mat = (color: THREE.ColorRepresentation, roughness = 0.6): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({ color, roughness });
      this.owned.push(m);
      return m;
    };
    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.root): THREE.Mesh => {
      this.owned.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const shell = mat(0xf1eee4, 0.42);
    const colour = mat(accent || '#c2281d', 0.5);
    const dark = mat(0x1c1f23, 0.8);
    const wood = mat(0xb48a55, 0.65);
    const pale = mat(0xe2d3ae, 0.6);

    // Main hull.
    const hull = loft(CANOE_LENGTH, hullSection, 0.035);
    add(hull.skin, shell).name = 'outrigger_hull';
    add(hull.deck, colour);
    // The seat with a low back, and the well the feet sit in.
    add(new THREE.BoxGeometry(0.33, 0.045, 0.34), dark).position.set(0, 0.243, SEAT_Z + 0.02);
    const back = add(new THREE.BoxGeometry(0.31, 0.16, 0.035), dark);
    back.position.set(0, 0.31, SEAT_Z + 0.2);
    back.rotation.x = -0.25;
    add(new THREE.BoxGeometry(0.25, 0.012, 0.62), dark).position.set(0, 0.226, SEAT_Z - 0.62);
    // A small rudder under the stern.
    add(new THREE.BoxGeometry(0.012, 0.3, 0.14), dark).position.set(0, -0.18, CANOE_LENGTH / 2 - 0.62);

    // The float, a little ahead of amidships.
    const amaZ = -0.2;
    const ama = loft(2.9, amaSection, 0.03);
    const amaGroup = new THREE.Group();
    amaGroup.position.set(-AMA_OFFSET, 0, amaZ);
    this.root.add(amaGroup);
    add(ama.skin, colour, amaGroup);
    add(ama.deck, shell, amaGroup);

    // Two arms, arched up over the water between hull and float so a sea passes under them.
    for (const z of [-0.78, 0.86]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.14, 0.215, z),
        new THREE.Vector3(-0.16, 0.25, z),
        new THREE.Vector3(-0.62, 0.43, z - 0.03),
        new THREE.Vector3(-1.1, 0.4, z - 0.06),
        new THREE.Vector3(-AMA_OFFSET + 0.04, 0.2, z - 0.08),
        new THREE.Vector3(-AMA_OFFSET, 0.07, z - 0.08),
      ]);
      add(new THREE.TubeGeometry(curve, 22, 0.024, 6), wood);
      // Lashings where the arm crosses the deck.
      add(new THREE.BoxGeometry(0.34, 0.03, 0.07), dark).position.set(0, 0.228, z);
    }

    // The paddle: grip at the group's origin, blade away down -Y.
    const shaftLen = PADDLE - 0.44;
    add(new THREE.CylinderGeometry(0.015, 0.016, shaftLen, 6).translate(0, -shaftLen / 2, 0), wood, this.paddle);
    add(new THREE.BoxGeometry(0.09, 0.028, 0.03), wood, this.paddle);
    const blade = new THREE.Shape();
    blade.moveTo(-0.022, 0);
    blade.bezierCurveTo(-0.1, -0.1, -0.1, -0.34, -0.06, -0.44);
    blade.lineTo(0.06, -0.44);
    blade.bezierCurveTo(0.1, -0.34, 0.1, -0.1, 0.022, 0);
    add(new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: false }).translate(0, -shaftLen, -0.006), pale, this.paddle);
    this.root.add(this.paddle);

    // The paddler is whoever was at the wheel: same jacket, same cap.
    this.figure = new Figure('outrigger_paddler', { jacket: 0xc2281d, vest: 0x2a2d33, trousers: 0x1f2630, skin: 0xc99a7a, cap: 0x1b2a4a });
    this.root.add(this.figure.group);
    this.setManned(false);
  }

  /** With nobody in her the paddle lies along the deck. */
  setManned(manned: boolean): void {
    this.manned = manned;
    this.figure.group.visible = manned;
    if (!manned) {
      this.effort = 0;
      // Grip by the forward arm, blade flat on the foredeck.
      this.paddle.position.set(0, 0.268, -0.72);
      this.paddle.quaternion.setFromUnitVectors(DOWN, this.dir.set(0, 0.012, -1).normalize());
    }
  }

  /** Put her on the water. Scene coordinates, heading in compass radians, heel positive to starboard. */
  place(x: number, y: number, z: number, heading: number, pitch: number, heel: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(pitch, -heading, -heel);
  }

  /**
   * Move the paddler.
   * @param work 1 paddling ahead, -1 backing, 0 resting
   * @param steer 1 turning to starboard, -1 to port
   */
  animate(dt: number, work: number, steer: number, time: number): void {
    if (!this.manned) return;
    const busy = work !== 0 || steer !== 0;
    this.effort += clamp((busy ? 1 : 0) - this.effort, -dt * 2.6, dt * 3.5);
    this.sweep += clamp((steer !== 0 && work === 0 ? 1 : steer !== 0 ? 0.45 : 0) - this.sweep, -dt * 3, dt * 3);

    // A turn is made by paddling on the outside of it. Otherwise she changes sides every so often, as paddlers do.
    if (steer !== 0) this.sideWanted = -Math.sign(steer);
    if (busy) {
      this.phase += dt * (work < 0 ? -0.8 : 0.95);
      if (this.phase >= 1) {
        this.phase -= 1;
        this.strokes++;
        if (steer === 0 && this.strokes >= this.switchAt) {
          this.sideWanted = -this.sideWanted;
          this.strokes = 0;
          this.switchAt = this.switchAt === 9 ? 12 : this.switchAt === 12 ? 7 : 9;
        }
      } else if (this.phase < 0) this.phase += 1;
    }
    this.side += clamp(this.sideWanted - this.side, -dt * 4.5, dt * 4.5);
    const s = this.side;
    const sgn = s >= 0 ? 1 : -1;
    /** 1 while the paddle is half way over the hull, changing sides. */
    const crossing = 1 - Math.abs(s);

    // Where the stroke is: `along` runs 0 at the catch to 1 at the exit. `pull` is 0 to 1 through the water, `swing` through the air.
    const u = this.phase;
    const inWater = u < 0.55;
    const pull = inWater ? u / 0.55 : 0;
    const swing = inWater ? 0 : (u - 0.55) / 0.45;
    const along = inWater ? pull : 1 - swing * swing * (3 - 2 * swing);
    const e = this.effort;

    const f = this.figure;
    const px = 0;
    const py = 0.375;
    const pz = SEAT_Z;
    f.pelvis.set(px, py, pz);
    f.up.copy(Y);
    f.fwd.set(0, 0, -1);
    // Reach forward for the catch with the paddle-side shoulder leading, then sit up through the pull.
    const reach = e * (1 - along);
    const twist = -sgn * 0.38 * e * (0.5 - along) * 2 * (1 - crossing);
    f.right.set(Math.cos(twist), 0, Math.sin(twist));
    f.neck.set(px, py + 0.52 - 0.05 * reach + Math.sin(time * 1.5) * 0.004, pz - 0.07 - 0.22 * reach);
    f.footL.set(-0.085, 0.215, pz - 0.76);
    f.footR.set(0.085, 0.215, pz - 0.76);
    f.kneeHint.set(0, 1, -0.25);
    f.look.set(sgn * 0.12 * e, -0.06, -1);

    // The stroke: top hand high over the gunwale, blade in ahead of the knees and out by the hip.
    const wide = this.sweep * Math.sin(Math.PI * along);
    this.top.set(s * (0.07 - 0.05 * wide), py + 0.55 - 0.12 * along + 0.1 * crossing, pz - 0.47 + 0.27 * along);
    this.tip.set(
      s * (0.4 + 0.36 * wide + (inWater ? 0 : 0.22 * Math.sin(Math.PI * swing))),
      inWater ? 0.04 - 0.36 * Math.sin(Math.PI * pull) ** 0.6 : 0.04 + 0.26 * Math.sin(Math.PI * swing),
      lerp(pz - 1.02, pz + 0.16, along),
    );
    this.tip.y += 0.5 * crossing;
    this.tip.z -= 0.3 * crossing;
    // At rest: across the lap, blade out over the water.
    this.restTop.set(-s * 0.2, py + 0.19, pz - 0.3);
    this.restTip.set(s * 1.1, py + 0.12 + 0.3 * crossing, pz - 0.42);
    this.top.lerp(this.restTop, 1 - e);
    this.tip.lerp(this.restTip, 1 - e);

    this.dir.subVectors(this.tip, this.top).normalize();
    this.low.copy(this.top).addScaledVector(this.dir, lerp(0.5, 0.6, e));
    const upper = sgn > 0 ? f.handL : f.handR;
    const lower = sgn > 0 ? f.handR : f.handL;
    upper.copy(this.top);
    lower.copy(this.low);
    (sgn > 0 ? f.elbowHintL : f.elbowHintR).set(-sgn * 1, 0.25, 0.4);
    (sgn > 0 ? f.elbowHintR : f.elbowHintL).set(sgn * 0.7, -0.4, 1);
    f.apply();

    this.paddle.position.copy(this.top);
    this.paddle.quaternion.setFromUnitVectors(DOWN, this.dir);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const o of this.owned) o.dispose();
  }
}
