import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AboardContext, Feature } from './feature';
import {
  FAUNA, FLOAT_BEAM, FLOAT_DECK, FLOAT_LENGTH, NOTICE, WHALE_ROOM,
  Sightings, fieldGuide, haulFloats, lookAbout, whaleAt, whereAway, type Animal, type Kind, type Sea,
} from './fauna';
import { sight } from './sightings';

type Bird = 'pelican' | 'cormorant' | 'gull';

/** The most of each that are ever drawn at once. Anything past this is simply not shown. */
const MOST = { porpoise: 16, seal: 10, sealion: 20, pelican: 26, cormorant: 14, gull: 34 };
/** Seals are drawn a little over life size, as the pot buoys are: a real head is hard to find in a chop. */
const SEAL_SCALE = 1.4;
/** Real seconds between one remark and the next, so two animals met together are not talked over each other. */
const BETWEEN_REMARKS = 14;
/** Beyond this many metres from the camera small animals are drawn larger, up to this many times life size. */
const FAR_FROM = 110;
const FAR_SCALE = 2.2;
/** A whale's blow is drawn larger from this far off, up to this many times. */
const BLOW_FROM = 200;
const BLOW_SCALE = 6;

/** Wing shape and colour for each bird. Lengths are of one wing, metres. */
const WING: Record<Bird, { len: number; chord: number; root: number; y: number; z: number; beat: number; colour: number }> = {
  // A brown pelican spans a little over two metres.
  pelican: { len: 1.0, chord: 0.42, root: 0.1, y: 0.06, z: -0.02, beat: 0.5, colour: 0x4f493f },
  cormorant: { len: 0.56, chord: 0.2, root: 0.06, y: 0.03, z: 0, beat: 0.62, colour: 0x141618 },
  // The western gull's back and wings are a dark slate grey.
  gull: { len: 0.66, chord: 0.2, root: 0.06, y: 0.04, z: -0.02, beat: 0.55, colour: 0x4d525a },
};

const Z = new THREE.Vector3(0, 0, 1);
/** The part of a number after the point, for telling one animal from the next by where it lies. */
const frac = (v: number) => ((v % 1) + 1) % 1;

/** One primitive, squeezed, turned and put in its place, ready to be merged with others. */
function part(g: THREE.BufferGeometry, scale: [number, number, number], at: [number, number, number], pitch = 0, roll = 0): THREE.BufferGeometry {
  g.scale(scale[0], scale[1], scale[2]);
  if (roll) g.rotateZ(roll);
  if (pitch) g.rotateX(pitch);
  g.translate(at[0], at[1], at[2]);
  return g;
}
const ball = (w = 8, h = 6) => new THREE.SphereGeometry(0.5, w, h);
/** Paint a part one colour, for shapes whose material takes its colour from the corners. */
function tint(g: THREE.BufferGeometry, colour: number): THREE.BufferGeometry {
  const c = new THREE.Color(colour);
  const n = g.getAttribute('position').count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(data, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return g;
}
const join = (...parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
};

// All shapes are built nose to -Z, +Y up, like the boats.

/** A harbor porpoise: a metre and a half, stout, with a low three-cornered fin half way along the back. */
function porpoiseShape(): THREE.BufferGeometry {
  return join(
    part(ball(8, 6), [0.36, 0.38, 1.55], [0, 0, 0]),
    part(new THREE.ConeGeometry(0.5, 1, 4), [0.07, 0.17, 0.3], [0, 0.25, 0.08]),
  );
}

/** A sea lion as it lies: chest and head up off the deck, a pointed muzzle. Origin under the belly. */
function sealionShape(): THREE.BufferGeometry {
  const flipper = (side: number) => part(new THREE.BoxGeometry(1, 1, 1), [0.2, 0.05, 0.55], [side * 0.36, 0.05, -0.42], 0, 0);
  return join(
    // Hindquarters on the deck, chest held up on the fore flippers, a thick neck and a dog's head.
    part(ball(8, 6), [0.5, 0.44, 1.5], [0, 0.24, 0.35], 0.1),
    part(ball(8, 6), [0.54, 0.5, 1.1], [0, 0.44, -0.35], 0.6),
    part(new THREE.CylinderGeometry(0.42, 0.5, 1, 6), [0.36, 0.5, 0.36], [0, 0.8, -0.72], -0.7),
    part(ball(7, 5), [0.28, 0.27, 0.38], [0, 1.0, -0.95], 0.15),
    part(new THREE.ConeGeometry(0.5, 1, 6), [0.16, 0.24, 0.16], [0, 0.97, -1.2], -Math.PI / 2),
    flipper(1), flipper(-1),
    // Hind flippers trailing on the deck.
    part(new THREE.BoxGeometry(1, 1, 1), [0.36, 0.05, 0.42], [0, 0.05, 1.1]),
  );
}

/** A harbor seal's head: round, short in the muzzle, no ears to see. Origin at the middle of the head. */
function sealShape(): THREE.BufferGeometry {
  const coat = 0x62666a;
  const dark = 0x15171a;
  const eye = (side: number) => tint(part(ball(5, 4), [0.06, 0.06, 0.05], [side * 0.075, 0.035, -0.125]), dark);
  return join(
    tint(part(ball(8, 6), [0.27, 0.25, 0.3], [0, 0, 0]), coat),
    // A pale muzzle, a dark nose and two big dark eyes set well forward.
    tint(part(ball(6, 4), [0.16, 0.12, 0.14], [0, -0.035, -0.14]), 0x8b8f92),
    tint(part(ball(5, 4), [0.05, 0.04, 0.04], [0, -0.01, -0.21]), dark),
    eye(1), eye(-1),
    // A little of the neck and shoulders under it.
    tint(part(ball(6, 4), [0.3, 0.3, 0.42], [0, -0.22, 0.1]), 0x4c5054),
  );
}

/** As much of a humpback as shows: eleven metres of broad back, with the small fin on its hump two thirds of the way aft. */
function backShape(): THREE.BufferGeometry {
  return join(
    part(ball(12, 8), [3.0, 1.6, 11], [0, 0, 0]),
    part(ball(6, 4), [0.7, 0.5, 1.8], [0, 0.66, 2.0]),
    part(new THREE.ConeGeometry(0.5, 1, 4), [0.18, 0.42, 0.75], [0, 1.02, 2.15]),
  );
}

/** Her tail stock and flukes, standing up out of the water. About four and a half metres across. Origin three metres below the notch. */
function flukeShape(): THREE.BufferGeometry {
  const lobe = (side: number) => part(new THREE.ConeGeometry(0.5, 1, 5), [1.5, 2.3, 0.16], [side * 1.05, 3.05, 0], 0, side * -1.18);
  return join(part(new THREE.CylinderGeometry(0.22, 0.75, 3.1, 7), [1, 1, 0.55], [0, 1.55, 0]), lobe(1), lobe(-1));
}

/** A humpback's blow is low and bushy, wider than it is tall at the top: three or four metres of it. */
function blowShape(): THREE.BufferGeometry {
  return join(
    part(ball(6, 4), [1.1, 1.6, 1.1], [0, 0.9, 0]),
    part(ball(7, 5), [2.3, 1.9, 2.3], [0, 2.2, 0]),
    part(ball(6, 4), [1.6, 1.3, 1.6], [0.3, 3.2, 0.2]),
  );
}

function birdShape(kind: Bird): THREE.BufferGeometry {
  if (kind === 'pelican') {
    // Head drawn back on the shoulders and that bill laid along the neck.
    // The adult's head is pale, nearly white, on a grey-brown body.
    const body = 0x6f675c;
    return join(
      tint(part(ball(7, 5), [0.3, 0.27, 0.8], [0, 0, 0.05]), body),
      tint(part(ball(6, 4), [0.15, 0.16, 0.2], [0, 0.13, -0.3]), 0xe6dfc8),
      tint(part(new THREE.ConeGeometry(0.5, 1, 5), [0.09, 0.46, 0.11], [0, 0.07, -0.58], -Math.PI / 2 - 0.22), 0x8d8676),
      tint(part(new THREE.BoxGeometry(1, 1, 1), [0.2, 0.02, 0.18], [0, 0, 0.5]), body),
    );
  }
  if (kind === 'cormorant') {
    // Neck stretched out ahead, a long tail behind: a flying cross.
    return join(
      part(ball(7, 5), [0.17, 0.16, 0.5], [0, 0, 0.05]),
      part(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), [0.07, 0.34, 0.07], [0, 0.03, -0.36], -Math.PI / 2 + 0.08),
      part(ball(5, 4), [0.09, 0.09, 0.16], [0, 0.05, -0.56]),
      part(new THREE.BoxGeometry(1, 1, 1), [0.1, 0.015, 0.22], [0, 0, 0.38]),
    );
  }
  return join(
    part(ball(7, 5), [0.18, 0.17, 0.46], [0, 0, 0.02]),
    part(ball(6, 4), [0.11, 0.11, 0.13], [0, 0.04, -0.24]),
    part(new THREE.ConeGeometry(0.5, 1, 4), [0.035, 0.09, 0.04], [0, 0.03, -0.33], -Math.PI / 2),
    part(new THREE.BoxGeometry(1, 1, 1), [0.13, 0.012, 0.15], [0, 0, 0.3]),
  );
}

/** One wing, a flat tapered blade from the root at x = 0 to the tip at x = 1, leading edge to -Z. */
function wingShape(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Root, wrist and tip, so the wing has the bend in it that a gliding bird's has.
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, -0.5, 0, 0, 0.5,
    0.5, 0.04, -0.62, 0.5, 0.04, 0.42,
    1, 0, -0.1, 1, 0, 0.3,
  ]), 3));
  g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
  g.computeVertexNormals();
  return g;
}

/** A set of instances that is filled from the start each frame. */
class Flock {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, private readonly most: number, name: string) {
    this.mesh = new THREE.InstancedMesh(geometry, material, most);
    this.mesh.name = name;
    this.mesh.count = 0;
    // The instances move about the whole Bay, so there is no fixed box to cull against.
    this.mesh.frustumCulled = false;
  }
  /** The next free place, or -1 when there are more than can be shown. */
  next(): number {
    return this.n < this.most ? this.n++ : -1;
  }
  done(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    this.n = 0;
  }
  get triangles(): number {
    const g = this.mesh.geometry;
    return this.mesh.count * ((g.index ? g.index.count : g.getAttribute('position').count) / 3);
  }
}

/**
 * The animals of the Bay: porpoise in the tide at the Gate, sea lions on the floats at Pier 39, seals in the anchorages,
 * pelicans, cormorants and gulls, and now and then a humpback on the flood. Which are where, and when each is up, is in
 * `fauna.ts`. This draws the ones within sight of the boat and has the crew remark on each kind the first time.
 * A course with no list of animals shows nothing.
 */
export class Wildlife implements Feature {
  readonly id = 'wildlife';
  private readonly courseId: string;
  private readonly live: boolean;
  private readonly found = new Sightings();
  private readonly root = new THREE.Group();
  private readonly flocks: Flock[] = [];
  private readonly porpoise!: Flock;
  private readonly seal!: Flock;
  private readonly sealion!: Flock;
  private readonly birds!: Record<Bird, Flock>;
  private readonly wings!: Flock;
  private readonly back!: THREE.Mesh;
  private readonly fluke!: THREE.Mesh;
  private readonly blow!: THREE.Mesh;
  private readonly floats: Array<{ x: number; y: number; mesh: THREE.Mesh }> = [];
  private readonly materials: THREE.Material[] = [];
  private readonly sea: Sea;
  private readonly boats: Array<{ x: number; y: number }> = [];
  private readonly eye = { x: 0, y: 0 };
  /** Kinds already remarked on, this sail. */
  private readonly met = new Set<Kind>();
  private quiet = 6;
  /** Real seconds until the next bark may sound, and the sim tick last seen, to know when the game is paused. */
  private bark = 0;
  private lastTick = -1;
  private barking = 0;
  private warned = false;
  private readonly dummy = new THREE.Object3D();
  private readonly local = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly colour = new THREE.Color();

  constructor(private readonly ctx: AboardContext) {
    this.courseId = ctx.stage.course.id;
    this.live = !!FAUNA[this.courseId];
    const world = ctx.world;
    const stream = { x: 0, y: 0 };
    this.sea = {
      depth: (x, y) => world.chartDepth(x, y),
      stream: (x, y) => {
        world.current(x, y, ctx.sim.state.t, stream);
        return Math.hypot(stream.x, stream.y);
      },
      tideRate: 0,
    };
    if (!this.live) return;
    this.root.name = 'wildlife';
    this.dummy.rotation.order = 'YXZ';

    // Wet hide shines. Feathers do not.
    const hide = (color: number) => this.keep(new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.05 }));
    const feather = (color: number) => this.keep(new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    const flock = (g: THREE.BufferGeometry, mat: THREE.Material, most: number, name: string) => {
      const f = new Flock(g, mat, most, name);
      this.flocks.push(f);
      this.root.add(f.mesh);
      return f;
    };
    this.porpoise = flock(porpoiseShape(), hide(0x2b3035), MOST.porpoise, 'porpoise');
    const seal = hide(0xffffff);
    seal.vertexColors = true;
    this.seal = flock(sealShape(), seal, MOST.seal, 'seal');
    // Sea lions are coloured one by one: chocolate when wet, tan when they have dried off on the floats.
    this.sealion = flock(sealionShape(), hide(0xffffff), MOST.sealion, 'sealion');
    const painted = feather(0xffffff);
    painted.vertexColors = true;
    this.birds = {
      pelican: flock(birdShape('pelican'), painted, MOST.pelican, 'pelican'),
      cormorant: flock(birdShape('cormorant'), feather(0x17191b), MOST.cormorant, 'cormorant'),
      gull: flock(birdShape('gull'), feather(0xf1f0ea), MOST.gull, 'gull'),
    };
    const cloth = this.keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }));
    this.wings = flock(wingShape(), cloth, 2 * (MOST.pelican + MOST.cormorant + MOST.gull), 'wings');

    const whaleHide = hide(0x23282c);
    this.back = new THREE.Mesh(backShape(), whaleHide);
    this.fluke = new THREE.Mesh(flukeShape(), whaleHide);
    this.blow = new THREE.Mesh(blowShape(), this.keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })));
    for (const mesh of [this.back, this.fluke, this.blow]) {
      mesh.rotation.order = 'YXZ';
      mesh.visible = false;
      this.root.add(mesh);
    }
    this.back.name = 'whale_back';
    this.fluke.name = 'whale_fluke';
    this.blow.name = 'whale_blow';

    // The floats the sea lions lie on: grey timber, low in the water.
    const timber = this.keep(new THREE.MeshStandardMaterial({ color: 0x8b8474, roughness: 0.9 }));
    const plank = new THREE.BoxGeometry(FLOAT_LENGTH, 0.5, FLOAT_BEAM);
    for (const f of haulFloats(this.courseId)) {
      const mesh = new THREE.Mesh(plank, timber);
      mesh.name = 'sealion_float';
      mesh.position.set(f.x, FLOAT_DECK - 0.25, -f.y);
      this.root.add(mesh);
      this.floats.push({ ...f, mesh });
    }
    ctx.stage.scene.add(this.root);
  }

  private keep<M extends THREE.Material>(m: M): M {
    this.materials.push(m);
    return m;
  }

  update(dt: number, seaTime: number): void {
    if (!this.live) return;
    const { ctx, eye, boats, sea } = this;
    const s = ctx.sim.state;
    const now = ctx.seasonNow();
    sea.tideRate = ctx.world.tideRate(s.t);

    // The animals are looked for from wherever the player is: in the kayak if she is away in her.
    const away = ctx.feature('kayak')?.focus?.() ?? null;
    eye.x = away ? away.x : s.x;
    eye.y = away ? away.y : s.y;
    let n = 0;
    const hull = (x: number, y: number) => {
      const b = boats[n] ?? (boats[n] = { x: 0, y: 0 });
      b.x = x;
      b.y = y;
      n++;
    };
    hull(s.x, s.y);
    if (away) hull(away.x, away.y);
    for (const other of ctx.company()) hull(other.x, other.y);
    boats.length = n;

    const found = lookAbout(this.courseId, now, sea, eye, boats, this.found);
    this.back.visible = this.fluke.visible = this.blow.visible = false;
    this.barking = 0;
    let nearest: Kind | null = null;
    let where = '';
    for (let i = 0; i < found.count; i++) {
      const a = found.list[i];
      this.draw(a, seaTime);
      if (!nearest && !this.met.has(a.kind) && Math.hypot(a.x - eye.x, a.y - eye.y) <= NOTICE[a.kind]) {
        nearest = a.kind;
        where = whereAway(eye.x, eye.y, away ? away.heading : s.heading, a.x, a.y);
      }
    }
    for (const f of this.flocks) f.done();
    for (const f of this.floats) f.mesh.position.y = ctx.stage.seaLevel(f.x, -f.y, seaTime, 3) + FLOAT_DECK - 0.25;

    // Barking off the floats, while the clock is running.
    this.bark -= dt;
    const running = s.tick !== this.lastTick;
    this.lastTick = s.tick;
    if (this.barking > 0 && running && this.bark <= 0) {
      ctx.sound.bark(this.barking * this.barking);
      this.bark = 0.26 + 0.3 * frac(now * 0.37);
    }

    // One remark for each kind, the first time on this sail, and one more sail counted for the logbook.
    this.quiet -= dt;
    if (nearest && this.quiet <= 0) {
      this.met.add(nearest);
      this.quiet = BETWEEN_REMARKS;
      // The first time ever for this kind, on this device, goes in the logbook.
      if (sight(nearest) === 1) ctx.logbook.count('seen');
      ctx.say(`${where}: ${fieldGuide(this.courseId, nearest).first}`, 12);
    }
    this.room(now);
  }

  /** A hundred yards is the rule with whales. Said once each time the boat closes with her. */
  private room(now: number): void {
    const w = whaleAt(this.courseId, now, this.sea);
    const off = w ? Math.hypot(w.x - this.eye.x, w.y - this.eye.y) : Infinity;
    if (off > 350) this.warned = false;
    else if (off <= WHALE_ROOM + 15 && !this.warned) {
      this.warned = true;
      this.ctx.say('That is close enough to the whale. A hundred yards is the rule: bear away and give her room', 8);
    }
  }

  /**
   * Small animals a long way from the camera are drawn up to twice life size, for the same reason the pot buoys are drawn
   * large: at its true size a pelican at a quarter of a mile is a couple of dots, and the eye on the water does better than that.
   * Within a hundred metres or so everything is life size.
   */
  private aid(x: number, up: number, y: number): number {
    const range = this.ctx.drone.camera.position.distanceTo(this.v.set(x, up, -y));
    return Math.min(FAR_SCALE, Math.max(1, range / FAR_FROM));
  }

  private place(flock: Flock, x: number, up: number, y: number, heading: number, pitch: number, roll: number, scale: number): number {
    const i = flock.next();
    if (i < 0) return -1;
    const d = this.dummy;
    d.position.set(x, up, -y);
    d.rotation.set(pitch, -heading, -roll);
    d.scale.setScalar(scale);
    d.updateMatrix();
    flock.mesh.setMatrixAt(i, d.matrix);
    return i;
  }

  private draw(a: Animal, seaTime: number): void {
    const stage = this.ctx.stage;
    const fx = Math.sin(a.heading);
    const fy = Math.cos(a.heading);
    const arc = Math.sin(a.phase * Math.PI);
    const k = this.aid(a.x, 0, a.y);
    switch (a.kind) {
      case 'porpoise': {
        // Over in a low arc, three metres on, and gone.
        const x = a.x + fx * 3.2 * a.phase;
        const y = a.y + fy * 3.2 * a.phase;
        const sea = stage.seaLevel(x, -y, seaTime, 4);
        this.place(this.porpoise, x, sea + (-0.42 + 0.5 * arc) * k, y, a.heading, 0.55 * Math.cos(a.phase * Math.PI), 0, k);
        return;
      }
      case 'seal': {
        const sea = stage.seaLevel(a.x, -a.y, seaTime, 4);
        this.place(this.seal, a.x, sea + (-0.42 + 0.52 * a.phase) * SEAL_SCALE * k, a.y, a.heading, 0.2, 0, SEAL_SCALE * k);
        return;
      }
      case 'sealion': {
        const size = 0.82 + 0.34 * frac(a.x * 7.31 + a.y * 3.17);
        let i = -1;
        let wet = true;
        if (a.pose === 'hauled') {
          const sea = stage.seaLevel(a.x, -a.y, seaTime, 3);
          i = this.place(this.sealion, a.x, sea + a.up, a.y, a.heading, 0.3 * a.phase, 0, size);
          // One rearing up is one barking: the nearer, the louder, and nothing beyond a quarter of a mile.
          if (a.phase > 0.15) this.barking = Math.max(this.barking, 1 - Math.hypot(a.x - this.eye.x, a.y - this.eye.y) / 400);
          wet = frac(a.x * 1.93) < 0.3;
        } else if (a.pose === 'leap') {
          const x = a.x + fx * 4 * a.phase;
          const y = a.y + fy * 4 * a.phase;
          const sea = stage.seaLevel(x, -y, seaTime, 4);
          i = this.place(this.sealion, x, sea + (-0.95 + 0.8 * arc) * k, y, a.heading, -0.35 + 0.7 * Math.cos(a.phase * Math.PI), 0, k);
        } else {
          // Swimming: tipped up so that only the head and neck are out.
          const sea = stage.seaLevel(a.x, -a.y, seaTime, 4);
          i = this.place(this.sealion, a.x, sea + (-1.24 - 0.5 * (1 - a.phase)) * k, a.y, a.heading, 0.75, 0, k);
        }
        if (i >= 0) this.sealion.mesh.setColorAt(i, this.colour.set(wet ? 0x33291f : 0x8a6f4d));
        return;
      }
      case 'humpback': {
        const sea = stage.seaLevel(a.x, -a.y, seaTime, 3);
        if (a.pose === 'back') {
          this.back.visible = true;
          this.back.position.set(a.x + fx * 7 * a.phase, sea - 1.0 + 1.3 * arc, -(a.y + fy * 7 * a.phase));
          this.back.rotation.set(0.1 * Math.cos(a.phase * Math.PI) - 0.1 * a.phase, -a.heading, 0);
          if (a.blow > 0) {
            // The blow hangs where it went up and thins as it spreads.
            this.blow.visible = true;
            const age = 1 - a.blow;
            this.blow.position.set(a.x + fx * 4, sea + 0.4, -(a.y + fy * 4));
            // Drawn larger the farther off it is, much more so than the animals: a blow is what the eye picks up at a mile,
            // and at its true size it would be two pale dots on the screen. Past 200 m it holds the size it has there, out to 1200 m.
            const range = this.ctx.drone.camera.position.distanceTo(this.blow.position);
            this.blow.scale.setScalar((0.8 + 0.5 * age) * Math.min(BLOW_SCALE, Math.max(1, range / BLOW_FROM)));
            (this.blow.material as THREE.MeshBasicMaterial).opacity = 0.92 * Math.min(1, a.blow * 1.7);
          }
        } else {
          // Up quickly, a pause, then sliding under as she goes down head first.
          const h = a.phase < 0.35 ? Math.sin((a.phase / 0.35) * Math.PI * 0.5) : Math.cos(((a.phase - 0.35) / 0.65) * Math.PI * 0.5);
          this.fluke.visible = true;
          this.fluke.position.set(a.x + fx * (9 + 3 * a.phase), sea - 3.7 + 3.6 * h, -(a.y + fy * (9 + 3 * a.phase)));
          this.fluke.rotation.set(-(0.2 + 0.75 * a.phase), -a.heading, 0);
        }
        return;
      }
      default:
        this.bird(a, a.kind, seaTime);
    }
  }

  private bird(a: Animal, kind: Bird, seaTime: number): void {
    const sea = this.ctx.stage.seaLevel(a.x, -a.y, seaTime, 2);
    const w = WING[kind];
    let up = a.up + 0.4 * sea;
    let pitch = 0;
    let spread = 1;
    let angle = a.wing * w.beat;
    if (a.pose === 'sit') {
      up = sea + 0.03;
      spread = 0;
    } else if (a.pose === 'plunge') {
      pitch = -1.25;
      spread = 0.5;
      angle = 0.5;
    } else if (a.pose === 'perch') {
      // Standing upright, and as often as not holding its wings out to dry.
      up = a.up;
      pitch = 1.15;
      spread = a.phase > 0.5 ? 0.85 : 0;
      angle = -0.1 + 0.05 * Math.sin(seaTime * 0.8);
    }
    const i = this.place(this.birds[kind], a.x, up, a.y, a.heading, pitch, a.bank, this.aid(a.x, up, a.y));
    if (i < 0 || spread <= 0) return;
    this.m.copy(this.dummy.matrix);
    for (const side of [1, -1]) {
      const k = this.wings.next();
      if (k < 0) return;
      this.q.setFromAxisAngle(Z, side * angle);
      this.local.compose(this.v.set(side * w.root, w.y, w.z), this.q, this.s.set(side * w.len * spread, 1, w.chord));
      this.local.premultiply(this.m);
      this.wings.mesh.setMatrixAt(k, this.local);
      this.wings.mesh.setColorAt(k, this.colour.set(w.colour));
    }
  }

  /** For the console and for play testing: every animal worked out on the last frame. */
  inSight(): Animal[] {
    return this.found.all();
  }

  /** How much is being drawn now: meshes showing and the triangles in them. */
  cost(): { meshes: number; triangles: number } {
    let meshes = 0;
    let triangles = 0;
    for (const f of this.flocks) if (f.mesh.visible) { meshes++; triangles += f.triangles; }
    for (const mesh of [this.back, this.fluke, this.blow, ...this.floats.map((f) => f.mesh)]) {
      if (!mesh?.visible) continue;
      meshes++;
      triangles += (mesh.geometry.index?.count ?? 0) / 3;
    }
    return { meshes, triangles };
  }

  dispose(): void {
    if (!this.live) return;
    this.root.removeFromParent();
    const seen = new Set<THREE.BufferGeometry>();
    this.root.traverse((o) => { if (o instanceof THREE.Mesh) seen.add(o.geometry as THREE.BufferGeometry); });
    for (const g of seen) g.dispose();
    for (const f of this.flocks) f.mesh.dispose();
    for (const m of this.materials) m.dispose();
  }
}
