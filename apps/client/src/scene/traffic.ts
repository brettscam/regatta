import * as THREE from 'three';
import type { CourseData, ReplayWorld } from '@slack-tide/world';
import { waveHeight, type Wave } from './waves';

const KT = 0.514444;
const D2R = Math.PI / 180;
const TAU = Math.PI * 2;

/** Another vessel on the water. Sim coordinates: x east, y north, metres. Heading is compass radians, sog is m/s. */
export interface TrafficVessel {
  id: string;
  name: string;
  kind: 'ferry' | 'ship' | 'sail';
  x: number;
  y: number;
  heading: number;
  sog: number;
  length: number;
  beam: number;
}

export interface TrafficRoute {
  id: string;
  name: string;
  kind: 'ferry' | 'ship' | 'sail';
  /** Which model to build. */
  model: 'catamaran' | 'ferry' | 'container' | 'sloop';
  length: number;
  beam: number;
  speedKt: number;
  /** `shuttle` runs out and back along the line with a stop at each end. `loop` goes round and round. */
  mode: 'shuttle' | 'loop';
  /** Seconds stopped at each end of a shuttle. */
  dwell?: number;
  /** A vessel that leaves the chart is not shown while it is stopped at the far ends. */
  hideAtEnds?: boolean;
  /** Seconds into its cycle at the default session start, 16:30 local. */
  phase: number;
  /** Hull or stripe colour. */
  color: number;
  /** Way points in metres east and north of the course origin. Depth along each line is checked when the fleet is built. */
  points: Array<[number, number]>;
}

/**
 * The cast. Every route stays in water deep enough for the vessel: over 6 m for ferries, 15 m for the ship, 4 m for yachts.
 * Names are made up.
 */
export const ROUTES: TrafficRoute[] = [
  {
    id: 'ferry-sausalito', name: 'Sausalito ferry', kind: 'ferry', model: 'catamaran', length: 40, beam: 11, speedKt: 20, mode: 'shuttle', dwell: 300, phase: 150, color: 0x1f5fa8,
    // The chart shoals to under 6 m off Sausalito, so this run stops in the fairway short of the landing.
    points: [[-1880, 2840], [-1300, 2000], [500, -300], [2300, -1500], [4300, -1950], [5450, -2800], [5600, -3700]],
  },
  {
    id: 'ferry-alcatraz', name: 'Alcatraz ferry', kind: 'ferry', model: 'ferry', length: 30, beam: 9, speedKt: 12, mode: 'shuttle', dwell: 420, phase: 60, color: 0x2b7a4b,
    points: [[4250, -2300], [3800, -1500], [3050, -550], [2800, -330]],
  },
  {
    id: 'ferry-tiburon', name: 'Tiburon ferry', kind: 'ferry', model: 'ferry', length: 34, beam: 10, speedKt: 16, mode: 'shuttle', dwell: 360, phase: 700, color: 0xc8962b,
    // Out of Tiburon through Raccoon Strait, then down past Alcatraz to the city.
    points: [[-250, 4500], [120, 4220], [-150, 3700], [-300, 3000], [300, 2200], [1700, 900], [3300, -900], [4800, -2100], [5450, -2900], [5600, -3600]],
  },
  {
    id: 'ship-inbound', name: 'Pacific Meridian', kind: 'ship', model: 'container', length: 280, beam: 40, speedKt: 12, mode: 'shuttle', dwell: 1500, hideAtEnds: true, phase: 1150, color: 0x14181c,
    // In over the bar from the south-west, through the Gate, south of Alcatraz and on under the Bay Bridge.
    points: [[-13000, -4400], [-11000, -3800], [-8500, -2700], [-6000, -2200], [-4200, -1500], [-2512, -1145], [-500, -1050], [1800, -1500], [4500, -1750], [6000, -2900], [6600, -4300], [7000, -6000], [7300, -7300]],
  },
  {
    id: 'sail-kestrel', name: 'Kestrel', kind: 'sail', model: 'sloop', length: 11, beam: 3.5, speedKt: 5.6, mode: 'loop', phase: 380, color: 0xf2f0ea,
    points: [[1700, -1800], [1050, 0], [500, 1800], [1200, 2150], [1750, 800], [1850, -900]],
  },
  {
    id: 'sail-zephyr', name: 'Zephyr', kind: 'sail', model: 'sloop', length: 9, beam: 3.0, speedKt: 4.8, mode: 'loop', phase: 900, color: 0xb23a2e,
    points: [[3600, -1650], [3500, 300], [3900, 1800], [4600, 1900], [4500, 0], [4300, -1650]],
  },
  {
    id: 'sail-windrose', name: 'Windrose', kind: 'sail', model: 'sloop', length: 13, beam: 4.0, speedKt: 6.2, mode: 'loop', phase: 120, color: 0x1d2f4f,
    points: [[-1800, -900], [-1200, 800], [-1500, 2300], [-900, 2400], [-500, 600], [-1100, -1000]],
  },
  {
    id: 'sail-secondwind', name: 'Second Wind', kind: 'sail', model: 'sloop', length: 10, beam: 3.3, speedKt: 5.0, mode: 'loop', phase: 1500, color: 0xf2f0ea,
    points: [[300, 2700], [1500, 1700], [3300, 1500], [3400, 900], [1500, 1100], [200, 2100]],
  },
  {
    id: 'sail-osprey', name: 'Osprey', kind: 'sail', model: 'sloop', length: 12, beam: 3.8, speedKt: 5.8, mode: 'loop', phase: 600, color: 0x2d6e63,
    points: [[5600, -1500], [5300, 300], [4900, 2200], [5600, 2300], [5900, 400], [6000, -1400]],
  },
  {
    id: 'sail-halcyon', name: 'Halcyon', kind: 'sail', model: 'sloop', length: 10, beam: 3.3, speedKt: 5.2, mode: 'loop', phase: 200, color: 0xf2f0ea,
    points: [[-3700, -1750], [-4500, -1500], [-5600, -1700], [-5700, -2100], [-4600, -2000], [-3700, -2100]],
  },
];

/** How far the tide drops below the chart's datum over the season, metres. */
const LOWEST_TIDE = 0.4;

/** The session's default start, in seconds into the season. Phases above are read at this moment. */
const REFERENCE_SEASON_TIME = 2.5 * 3600;

/** A route turned into a smooth line that can be asked where a vessel is at any time. */
export class Track {
  readonly px: number[] = [];
  readonly py: number[] = [];
  readonly cum: number[] = [];
  readonly length: number;
  readonly travel: number;
  readonly cycle: number;
  private readonly speed: number;
  private readonly ramp: number;

  constructor(readonly route: TrafficRoute) {
    const pts = route.points;
    const n = pts.length;
    const closed = route.mode === 'loop';
    const at = (i: number) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    const segs = closed ? n : n - 1;
    const SUB = 14;
    // Catmull-Rom through the way points, so corners are rounded the way a helmsman takes them.
    for (let s = 0; s < segs; s++) {
      const [a, b, c, d] = [at(s - 1), at(s), at(s + 1), at(s + 2)];
      for (let k = 0; k < SUB; k++) {
        const u = k / SUB;
        const u2 = u * u;
        const u3 = u2 * u;
        this.px.push(0.5 * (2 * b[0] + (c[0] - a[0]) * u + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * u2 + (3 * (b[0] - c[0]) + d[0] - a[0]) * u3));
        this.py.push(0.5 * (2 * b[1] + (c[1] - a[1]) * u + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * u2 + (3 * (b[1] - c[1]) + d[1] - a[1]) * u3));
      }
    }
    const last = closed ? pts[0] : pts[n - 1];
    this.px.push(last[0]);
    this.py.push(last[1]);
    let total = 0;
    this.cum.push(0);
    for (let i = 1; i < this.px.length; i++) {
      total += Math.hypot(this.px[i] - this.px[i - 1], this.py[i] - this.py[i - 1]);
      this.cum.push(total);
    }
    this.length = total;
    this.speed = route.speedKt * KT;
    // Shuttles ease away from the dock and ease in to it.
    this.ramp = closed ? 0 : Math.min(45, (total / this.speed) * 0.25);
    this.travel = total / this.speed + this.ramp;
    this.cycle = closed ? total / this.speed : 2 * (this.travel + (route.dwell ?? 0));
  }

  /** Position at a distance along the line. */
  point(s: number, out: { x: number; y: number }): void {
    const closed = this.route.mode === 'loop';
    let d = closed ? ((s % this.length) + this.length) % this.length : Math.max(0, Math.min(this.length, s));
    if (d >= this.length) d = closed ? 0 : this.length;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - this.cum[lo]) / (this.cum[hi] - this.cum[lo] || 1);
    out.x = this.px[lo] + (this.px[hi] - this.px[lo]) * f;
    out.y = this.py[lo] + (this.py[hi] - this.py[lo]) * f;
  }

  /** Compass bearing of the line at a distance along it, averaged over about a boat length so turns are smooth. */
  bearing(s: number): number {
    const h = Math.max(12, this.route.length * 0.6);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    this.point(s - h, a);
    this.point(s + h, b);
    return Math.atan2(b.x - a.x, b.y - a.y);
  }

  /** Distance and speed along a one-way run, `tau` seconds after leaving. */
  private run(tau: number): { s: number; v: number } {
    const { ramp, speed: v, travel: T, length: L } = this;
    if (ramp <= 0) return { s: v * tau, v };
    if (tau < ramp) return { s: (v * tau * tau) / (2 * ramp), v: (v * tau) / ramp };
    if (tau > T - ramp) return { s: L - (v * (T - tau) ** 2) / (2 * ramp), v: (v * (T - tau)) / ramp };
    return { s: (v * ramp) / 2 + v * (tau - ramp), v };
  }

  /** Where the vessel is at a moment in the season. A pure function of time. */
  state(seasonTime: number, out: { x: number; y: number; heading: number; sog: number; active: boolean }): void {
    const r = this.route;
    const tau = (((seasonTime - REFERENCE_SEASON_TIME + r.phase) % this.cycle) + this.cycle) % this.cycle;
    out.active = true;
    if (r.mode === 'loop') {
      const s = this.speed * tau;
      this.point(s, out);
      out.heading = this.bearing(s);
      out.sog = this.speed;
      return;
    }
    const dwell = r.dwell ?? 0;
    const T = this.travel;
    const turn = (from: number, k: number) => from + Math.PI * (k * k * (3 - 2 * k));
    if (tau < T) {
      const { s, v } = this.run(tau);
      this.point(s, out);
      out.heading = this.bearing(Math.min(s, this.length - 1));
      out.sog = v;
    } else if (tau < T + dwell) {
      // Alongside at the far end, swinging round ready to go back.
      this.point(this.length, out);
      out.heading = turn(this.bearing(this.length - 1), (tau - T) / dwell);
      out.sog = 0;
      out.active = !r.hideAtEnds;
    } else if (tau < 2 * T + dwell) {
      const { s, v } = this.run(tau - T - dwell);
      this.point(this.length - s, out);
      out.heading = this.bearing(Math.max(1, this.length - s)) + Math.PI;
      out.sog = v;
    } else {
      this.point(0, out);
      out.heading = turn(this.bearing(1) + Math.PI, (tau - 2 * T - dwell) / dwell);
      out.sog = 0;
      out.active = !r.hideAtEnds;
    }
  }
}

// ---- models, built in code -----------------------------------------------------------------------
// Vessel frame, the same as the player's boat: +X starboard, +Y up, -Z forward, origin on the waterline amidships.

const mat = (color: number, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const WHITE = mat(0xeeece6, 0.6);
const GLASS = mat(0x15202a, 0.25, 0.4);
const DARK = mat(0x22262b, 0.8);

function box(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A hull as a plan outline pushed up from below the waterline to the deck. `fine` is how pointed the bow is. */
function hull(length: number, beam: number, bottom: number, top: number, m: THREE.Material, fine = 0.3, sternWidth = 0.8): THREE.Mesh {
  const L = length / 2;
  const B = beam / 2;
  const shape = new THREE.Shape();
  // Shape y becomes forward after the rotation below.
  shape.moveTo(0, L);
  shape.quadraticCurveTo(B * 1.05, L * (1 - fine * 1.4), B, L * (1 - fine * 2.4));
  shape.lineTo(B, -L * 0.7);
  shape.quadraticCurveTo(B, -L, B * sternWidth, -L);
  shape.lineTo(-B * sternWidth, -L);
  shape.quadraticCurveTo(-B, -L, -B, -L * 0.7);
  shape.lineTo(-B, L * (1 - fine * 2.4));
  shape.quadraticCurveTo(-B * 1.05, L * (1 - fine * 1.4), 0, L);
  const g = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bottom, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

function buildCatamaran(r: TrafficRoute): THREE.Group {
  const g = new THREE.Group();
  const L = r.length;
  const B = r.beam;
  const stripe = mat(r.color, 0.5);
  for (const side of [-1, 1]) {
    const h = hull(L, B * 0.3, -1.2, 2.3, WHITE, 0.34, 0.9);
    h.position.x = side * B * 0.33;
    g.add(h);
    box(g, stripe, 0.12, 0.5, L * 0.74, side * (B * 0.48 + 0.02), 1.7, L * 0.06);
  }
  box(g, WHITE, B, 0.5, L * 0.86, 0, 2.5, L * 0.05);
  // Main cabin with a band of windows, a smaller upper deck, and the wheelhouse forward.
  box(g, WHITE, B * 0.94, 2.7, L * 0.68, 0, 4.1, L * 0.08);
  box(g, GLASS, B * 0.95, 1.0, L * 0.62, 0, 4.4, L * 0.08);
  box(g, WHITE, B * 0.8, 2.3, L * 0.4, 0, 6.6, L * 0.14);
  box(g, GLASS, B * 0.81, 0.9, L * 0.36, 0, 6.8, L * 0.14);
  box(g, WHITE, B * 0.62, 2.1, L * 0.13, 0, 6.5, -L * 0.2).rotation.x = 0.08;
  box(g, GLASS, B * 0.63, 0.8, L * 0.135, 0, 6.9, -L * 0.2);
  box(g, stripe, B * 0.95, 0.35, L * 0.68, 0, 5.55, L * 0.08);
  box(g, DARK, 0.25, 3.2, 0.25, 0, 9.3, -L * 0.1);
  box(g, DARK, 1.6, 0.9, 2.2, -B * 0.25, 8.2, L * 0.28);
  box(g, DARK, 1.6, 0.9, 2.2, B * 0.25, 8.2, L * 0.28);
  return g;
}

function buildFerry(r: TrafficRoute): THREE.Group {
  const g = new THREE.Group();
  const L = r.length;
  const B = r.beam;
  const stripe = mat(r.color, 0.5);
  g.add(hull(L, B, -1.4, 2.2, WHITE, 0.3, 0.85));
  const band = hull(L * 1.005, B * 1.01, 1.5, 1.9, stripe, 0.3, 0.85);
  g.add(band);
  box(g, WHITE, B * 0.84, 2.6, L * 0.62, 0, 3.5, L * 0.07);
  box(g, GLASS, B * 0.85, 1.0, L * 0.56, 0, 3.8, L * 0.07);
  // Open upper deck with a rail and a canopy, wheelhouse forward.
  box(g, WHITE, B * 0.84, 0.25, L * 0.62, 0, 4.9, L * 0.07);
  box(g, WHITE, B * 0.7, 0.2, L * 0.34, 0, 7.1, L * 0.16);
  for (const sx of [-1, 1]) for (const sz of [0, 1]) box(g, DARK, 0.14, 2.1, 0.14, sx * B * 0.33, 6.0, L * (0.02 + sz * 0.28));
  box(g, WHITE, B * 0.6, 2.2, L * 0.16, 0, 6.1, -L * 0.16);
  box(g, GLASS, B * 0.61, 0.85, L * 0.165, 0, 6.4, -L * 0.16);
  box(g, stripe, 1.3, 1.6, 1.8, 0, 8.0, L * 0.2);
  box(g, DARK, 0.2, 2.6, 0.2, 0, 8.6, -L * 0.14);
  return g;
}

function buildContainerShip(r: TrafficRoute): THREE.Group {
  const g = new THREE.Group();
  const L = r.length;
  const B = r.beam;
  g.add(hull(L, B, -9, 11, mat(r.color, 0.75), 0.1, 0.9));
  // Red boot topping at the waterline, as a slightly wider belt.
  g.add(hull(L * 1.002, B * 1.01, -1.2, 1.4, mat(0x8a2a22, 0.8), 0.1, 0.9));
  box(g, mat(0x3c4146, 0.9), B * 0.94, 0.6, L * 0.86, 0, 11.3, L * 0.02);
  // Deckhouse and funnel aft.
  const house = mat(0xe9e7e0, 0.6);
  const hz = L * 0.33;
  box(g, house, B * 0.86, 22, 15, 0, 22.5, hz);
  box(g, GLASS, B * 0.87, 1.4, 15.2, 0, 31, hz);
  box(g, house, B * 1.08, 3.2, 9, 0, 34.6, hz - 1);
  box(g, GLASS, B * 1.09, 1.3, 9.1, 0, 35, hz - 1);
  box(g, mat(0x1d4f8f, 0.6), 7, 12, 8, 0, 31, hz + 13);
  box(g, DARK, 0.5, 9, 0.5, 0, 41, hz - 2);
  // Containers: stacks in bays along the deck, three across, heights and colours from a fixed pattern.
  const colours = [0x9c3b2c, 0x2c5d8f, 0x3c7a55, 0xb9b6ad, 0xc77a2a, 0x6d3f73, 0x26676b, 0x8d8a85].map((c) => mat(c, 0.85));
  const BAY = 13.4;
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let bay = 0; bay < 15; bay++) {
    const z = -L * 0.39 + bay * (BAY + 0.9);
    if (Math.abs(z - hz) < 16) continue;
    // Narrower stacks toward the bow where the hull fines down.
    const width = bay < 2 ? B * 0.62 : B * 0.9;
    for (let col = 0; col < 3; col++) {
      const tiers = 3 + Math.floor(next() * 3.99) - (bay < 2 ? 1 : 0);
      const split = 1 + Math.floor(next() * (tiers - 1));
      const w = width / 3 - 0.4;
      const x = (col - 1) * (width / 3);
      box(g, colours[Math.floor(next() * colours.length)], w, split * 2.6, BAY, x, 11.6 + (split * 2.6) / 2, z);
      box(g, colours[Math.floor(next() * colours.length)], w, (tiers - split) * 2.6, BAY, x, 11.6 + split * 2.6 + ((tiers - split) * 2.6) / 2, z);
    }
  }
  return g;
}

/** A triangle of cloth with some belly, lying in the YZ plane with its luff up the Y axis and its foot along +Z. */
function sailCloth(luff: number, foot: number, belly: number, m: THREE.Material): THREE.Mesh {
  const NU = 5;
  const NV = 7;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    const chord = foot * (1 - v) + 0.12 * v;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      pos.push(belly * chord * 4 * u * (1 - u) * (1 - 0.6 * v), v * luff, u * chord);
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i;
    const b = a + NU + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

interface SloopParts {
  main: THREE.Group;
  jib: THREE.Group;
}

function buildSloopModel(r: TrafficRoute): { group: THREE.Group; parts: SloopParts } {
  const g = new THREE.Group();
  const L = r.length;
  const B = r.beam;
  const cloth = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x6f6a5c, emissiveIntensity: 0.2 });
  g.add(hull(L, B, -0.45, 1.0, mat(r.color, 0.35), 0.42, 0.72));
  g.add(hull(L * 0.98, B * 0.96, 1.0, 1.06, mat(0xd8d5cb, 0.85), 0.42, 0.72));
  box(g, WHITE, B * 0.55, 0.42, L * 0.36, 0, 1.25, -L * 0.02);
  box(g, GLASS, B * 0.56, 0.16, L * 0.3, 0, 1.3, -L * 0.02);
  const keel = box(g, DARK, 0.12, 1.4, L * 0.14, 0, -1.0, 0);
  keel.castShadow = false;
  const mastZ = -L * 0.1;
  const mastH = L * 1.32;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, mastH, 8), mat(0xd9dcdc, 0.45, 0.6));
  mast.position.set(0, 1.4 + mastH / 2, mastZ);
  mast.castShadow = true;
  g.add(mast);
  // Main: pivots at the mast. The boom is part of it.
  const main = new THREE.Group();
  main.position.set(0, 2.3, mastZ + 0.08);
  main.add(sailCloth(mastH - 1.4, L * 0.38, 0.1, cloth));
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, L * 0.4, 6), mat(0xd9dcdc, 0.45, 0.6));
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, -0.05, L * 0.2);
  main.add(boom);
  g.add(main);
  // Jib: pivots at the stem, its luff raked back to the mast.
  const jib = new THREE.Group();
  const tackZ = -L * 0.47;
  jib.position.set(0, 1.15, tackZ);
  const luffRun = mastZ - tackZ;
  const luffRise = mastH * 0.86;
  const cloth2 = sailCloth(Math.hypot(luffRun, luffRise), L * 0.4, 0.11, cloth);
  cloth2.rotation.x = Math.atan2(luffRun, luffRise);
  jib.add(cloth2);
  g.add(jib);
  // Two figures in the cockpit, as blocks of colour.
  box(g, mat(0xb5332a, 0.8), 0.4, 0.7, 0.35, B * 0.2, 1.45, L * 0.3);
  box(g, mat(0x26384f, 0.8), 0.4, 0.7, 0.35, -B * 0.18, 1.45, L * 0.22);
  return { group: g, parts: { main, jib } };
}

interface Actor {
  track: Track;
  vessel: TrafficVessel;
  group: THREE.Group;
  sails: SloopParts | null;
}

export interface Approach {
  vessel: TrafficVessel;
  /** Closest point of approach, metres between centres. */
  cpa: number;
  /** Seconds until then. */
  tcpa: number;
  /** Metres apart now. */
  range: number;
}

/**
 * Everything else afloat: ferries on their runs, a ship in the channel, yachts out for the afternoon.
 * Where each one is depends only on the time, so every player sees the same traffic and it survives pause and fast-forward.
 */
export class Traffic {
  readonly group = new THREE.Group();
  /** The vessels on the water right now. Rebuilt in place by `update`. */
  readonly vessels: TrafficVessel[] = [];
  private readonly actors: Actor[] = [];
  private readonly scratch = { x: 0, y: 0, heading: 0, sog: 0, active: true };

  constructor(_course: CourseData, private readonly world: ReplayWorld) {
    this.group.name = 'traffic';
    for (const r of ROUTES) {
      let group: THREE.Group;
      let sails: SloopParts | null = null;
      if (r.model === 'catamaran') group = buildCatamaran(r);
      else if (r.model === 'ferry') group = buildFerry(r);
      else if (r.model === 'container') group = buildContainerShip(r);
      else ({ group, parts: sails } = buildSloopModel(r));
      group.name = r.id;
      group.rotation.order = 'YXZ';
      this.group.add(group);
      const track = new Track(r);
      // Every route must keep its vessel afloat at the lowest water of the season. Say so loudly if one does not.
      const need = r.kind === 'ship' ? 15 : r.kind === 'ferry' ? 6 : 4;
      const p = { x: 0, y: 0 };
      for (let s = 0; s <= track.length; s += 50) {
        track.point(s, p);
        const depth = world.chartDepth(p.x, p.y) - LOWEST_TIDE;
        if (depth < need) {
          console.warn(`Traffic route ${r.id} runs into ${depth.toFixed(1)} m of water at ${Math.round(p.x)}, ${Math.round(p.y)}`);
          break;
        }
      }
      this.actors.push({
        track,
        vessel: { id: r.id, name: r.name, kind: r.kind, x: 0, y: 0, heading: 0, sog: 0, length: r.length, beam: r.beam },
        group,
        sails,
      });
    }
    this.update(0, 0, []);
  }

  /**
   * @param t session time in seconds
   * @param seaTime the water's clock, for riding the waves
   */
  update(t: number, seaTime: number, waves: Wave[]): void {
    const st = this.scratch;
    this.vessels.length = 0;
    for (const a of this.actors) {
      a.track.state(this.world.startOffset + t, st);
      a.group.visible = st.active;
      if (!st.active) continue;
      const v = a.vessel;
      v.x = st.x;
      v.y = st.y;
      v.heading = ((st.heading % TAU) + TAU) % TAU;
      v.sog = st.sog;
      this.vessels.push(v);

      // Ride the sea: small craft follow the waves, a ship barely notices them.
      const fx = Math.sin(v.heading);
      const fy = Math.cos(v.heading);
      const half = v.length * 0.35;
      const ride = Math.min(1, 14 / v.length);
      const hBow = waves.length ? waveHeight(waves, v.x + fx * half, -(v.y + fy * half), seaTime) : 0;
      const hStern = waves.length ? waveHeight(waves, v.x - fx * half, -(v.y - fy * half), seaTime) : 0;
      a.group.position.set(v.x, ((hBow + hStern) / 2) * ride, -v.y);
      let pitch = Math.atan2(hBow - hStern, half * 2) * ride;
      let roll = Math.sin(seaTime * 0.9 + v.length) * 0.012 * ride;
      // A fast ferry lifts her bows.
      if (v.kind === 'ferry') pitch += Math.min(0.03, (v.sog / 10) * 0.025);

      if (a.sails) {
        // Yachts heel away from the wind and carry their sails to leeward, eased for the point of sail.
        const wind = this.world.wind(v.x, v.y, t);
        const twa = Math.atan2(Math.sin(wind.dir - v.heading), Math.cos(wind.dir - v.heading));
        const side = twa >= 0 ? 1 : -1;
        const off = Math.abs(twa) / D2R;
        const press = Math.min(1.3, wind.speed / KT / 14);
        const heel = (off < 30 ? 4 : off < 110 ? 17 : off < 150 ? 9 : 3) * press * D2R;
        const boom = Math.max(6, Math.min(80, 0.62 * off - 14)) * D2R;
        const clew = Math.max(9, Math.min(70, 0.5 * off - 6)) * D2R;
        a.sails.main.rotation.y = -side * boom;
        a.sails.main.scale.x = -side;
        a.sails.jib.rotation.y = -side * clew;
        a.sails.jib.scale.x = -side;
        // Wind on the starboard side leans her to port.
        roll += side * heel;
      }
      a.group.rotation.set(pitch, -v.heading, roll);
    }
  }

  /**
   * The vessel that will come closest in the next ten minutes if everyone holds course and speed.
   * @param boat position in sim metres, course over ground in compass radians, speed in m/s
   */
  closest(boat: { x: number; y: number; cog: number; sog: number }): Approach | null {
    let best: Approach | null = null;
    const bvx = Math.sin(boat.cog) * boat.sog;
    const bvy = Math.cos(boat.cog) * boat.sog;
    for (const v of this.vessels) {
      const px = v.x - boat.x;
      const py = v.y - boat.y;
      const wx = Math.sin(v.heading) * v.sog - bvx;
      const wy = Math.cos(v.heading) * v.sog - bvy;
      const w2 = wx * wx + wy * wy;
      const tcpa = w2 < 1e-6 ? 0 : Math.max(0, Math.min(600, -(px * wx + py * wy) / w2));
      const cpa = Math.hypot(px + wx * tcpa, py + wy * tcpa);
      if (!best || cpa < best.cpa) best = { vessel: v, cpa, tcpa, range: Math.hypot(px, py) };
    }
    return best;
  }
}
