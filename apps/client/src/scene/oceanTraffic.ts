import * as THREE from 'three';
import type { TrafficRoute } from './traffic';

// Deep-sea traffic for the ocean outside the Golden Gate: tankers, car carriers, cruise ships, a tug with her barge,
// the pilot boat and fishing boats. Each is built in code from a route's length, beam and colour, like the vessels in
// `traffic.ts`. This file is on its own so the two can be worked on apart: `traffic.ts` asks `buildOceanVessel` first and
// builds its own models when the answer is null.
// Vessel frame, the same as the player's boat: +X starboard, +Y up, -Z forward, origin on the waterline amidships.

/** The models this file knows. A route names one as its `model`. */
export const OCEAN_MODELS = ['tanker', 'carcarrier', 'cruise', 'tug', 'pilot', 'trawler'] as const;
export type OceanModel = (typeof OCEAN_MODELS)[number];

const mat = (color: string | number, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function box(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function post(parent: THREE.Object3D, m: THREE.Material, r: number, h: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), m);
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

const WHITE = () => mat(0xeeece6, 0.6);
const GLASS = () => mat(0x15202a, 0.25, 0.4);
const DARK = () => mat(0x22262b, 0.8);
const BOOT = () => mat(0x8a2a22, 0.8);

/** A crude oil or product tanker: a long, low, flat deck with a pipe run and manifold amidships, house and funnel right aft. */
function buildTanker(r: TrafficRoute): THREE.Group {
  const g = new THREE.Group();
  const L = r.length;
  const B = r.beam;
  const deck = 7.5;
  g.add(hull(L, B, -11, deck, mat(r.color, 0.75), 0.08, 0.92));
  g.add(hull(L * 1.002, B * 1.01, -1.4, 1.6, BOOT(), 0.08, 0.92));
  const green = mat(0x7a3b30, 0.9);
  box(g, green, B * 0.96, 0.4, L * 0.9, 0, deck + 0.2, 0);
  // The pipe run down the centre line, the cargo manifold across it amidships, and two hose cranes.
  const pipe = mat(0xa9a59a, 0.7);
  box(g, pipe, 2.4, 1.6, L * 0.62, 0, deck + 1.2, -L * 0.06);
  box(g, pipe, B * 0.8, 2.2, 5, 0, deck + 1.5, -L * 0.04);
  for (const side of [-1, 1]) {
    post(g, pipe, 0.5, 11, side * B * 0.2, deck + 5.5, -L * 0.04 + side * 6);
    box(g, pipe, 0.5, 0.5, 12, side * B * 0.2, deck + 10.6, -L * 0.04 + side * 6 - 5).rotation.x = 0.12;
  }
  // A raised forecastle with the foremast.
  box(g, mat(r.color, 0.75), B * 0.66, 2.6, L * 0.08, 0, deck + 1.3, -L * 0.44);
  post(g, DARK(), 0.3, 12, 0, deck + 8, -L * 0.43);
  // House, bridge wings and funnel aft.
  const house = WHITE();
  const hz = L * 0.4;
  box(g, house, B * 0.72, 18, 16, 0, deck + 9, hz);
  box(g, GLASS(), B * 0.73, 1.3, 16.2, 0, deck + 16, hz);
  box(g, house, B * 1.04, 2.8, 8, 0, deck + 19.4, hz - 3);
  box(g, GLASS(), B * 1.05, 1.2, 8.1, 0, deck + 19.8, hz - 3);
  box(g, mat(0x24364f, 0.6), 6, 11, 7, 0, deck + 18, hz + 11);
  post(g, DARK(), 0.4, 8, 0, deck + 25, hz - 3);
  return g;
}

/** A car carrier: a slab-sided box as high as she is wide, with a ramp on the quarter and almost no deckhouse. */
function buildCarCarrier(r: TrafficRoute): THREE.Group {
  const g = new THREE.Group();
  const L = r.length;
  const B = r.beam;
  g.add(hull(L, B, -9, 6, mat(r.color, 0.7), 0.12, 0.95));
  g.add(hull(L * 1.002, B * 1.01, -1.2, 1.4, BOOT(), 0.12, 0.95));
  const side = mat(0xe4e2da, 0.65);
  // The car decks: one great box, set a little back from the stem.
  box(g, side, B * 0.99, 26, L * 0.9, 0, 19, L * 0.035);
  box(g, mat(r.color, 0.7), B, 3.2, L * 0.9, 0, 7.6, L * 0.035);
  // The wheelhouse right forward on top, a line of windows across it, and the funnel aft.
  box(g, side, B * 1.04, 3.2, 9, 0, 33.6, -L * 0.36);
  box(g, GLASS(), B * 1.05, 1.2, 9.1, 0, 34, -L * 0.36);
  box(g, mat(r.color, 0.6), 6, 7, 8, B * 0.2, 35.5, L * 0.36);
  post(g, DARK(), 0.35, 7, 0, 38.5, -L * 0.34);
  // The stern quarter ramp, stowed upright.
  box(g, mat(0x9a978e, 0.8), 7, 24, 1.2, B * 0.36, 18, L * 0.49);
  // Ventilator rows along the top.
  for (let k = 0; k < 9; k++) for (const s of [-1, 1]) box(g, DARK(), 1.4, 1, 1.4, s * B * 0.34, 32.5, -L * 0.28 + k * L * 0.07);
  return g;
}

/** A cruise ship: a white hull, tier on tier of balconies, lifeboats along the side, a raked funnel and a lot of glass. */
function buildCruiseShip(r: TrafficRoute): THREE.Group {
  const g = new THREE.Group();
  const L = r.length;
  const B = r.beam;
  const white = WHITE();
  g.add(hull(L, B, -8, 9, white, 0.16, 0.86));
  g.add(hull(L * 1.002, B * 1.01, -1.0, 0.9, mat(r.color, 0.6), 0.16, 0.86));
  // The superstructure steps in and back as it rises. Dark bands are the balcony decks, pale ones the rails between.
  const glass = GLASS();
  const tiers = 9;
  for (let t = 0; t < tiers; t++) {
    const y = 9 + t * 2.9;
    const len = L * (0.8 - t * 0.022);
    const z = L * (0.01 + t * 0.008);
    const w = B * (0.98 - (t > 6 ? (t - 6) * 0.08 : 0));
    box(g, white, w, 1.1, len, 0, y + 0.55, z);
    box(g, glass, w * 0.985, 1.8, len * 0.985, 0, y + 2.0, z);
  }
  const top = 9 + tiers * 2.9;
  box(g, white, B * 0.74, 0.6, L * 0.6, 0, top + 0.3, L * 0.02);
  // The bridge, forward, full width with wings.
  box(g, white, B * 1.06, 3, 8, 0, 9 + 6 * 2.9 + 1.5, -L * 0.36);
  box(g, glass, B * 1.07, 1.3, 8.1, 0, 9 + 6 * 2.9 + 1.9, -L * 0.36);
  // Lifeboats in a row each side under the promenade.
  const orange = mat(0xd9682a, 0.7);
  for (let k = 0; k < 8; k++) for (const s of [-1, 1]) box(g, orange, 3.2, 3, 9.5, s * (B * 0.5 - 0.6), 14.2, -L * 0.22 + k * L * 0.062);
  // Funnel, raked, in the line's colour, and the mast and radar dome.
  const funnel = box(g, mat(r.color, 0.5), 9, 13, 13, 0, top + 7, L * 0.2);
  funnel.rotation.x = 0.16;
  box(g, DARK(), 9.2, 1.6, 13.2, 0, top + 13, L * 0.22).rotation.x = 0.16;
  post(g, white, 0.5, 12, 0, top + 6, -L * 0.2);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8), white);
  dome.position.set(0, top + 3.4, -L * 0.1);
  g.add(dome);
  // The lido: a blue pool between the mast and the funnel.
  box(g, mat(0x3f9bc4, 0.3), B * 0.3, 0.3, 18, 0, top + 0.7, L * 0.04);
  return g;
}

/**
 * A tug with a barge astern on a long hawser. One model: the tug is forward, the barge aft, and the whole length
 * (tug, tow line and barge) is the vessel's `length`, so the collision outline covers the hawser too.
 * Nobody passes between a tug and her tow.
 */
function buildTugAndBarge(r: TrafficRoute): THREE.Group {
  const g = new THREE.Group();
  const L = r.length;
  const B = r.beam;
  const tugL = Math.min(34, L * 0.16);
  const bargeL = L * 0.46;
  const tugZ = -L / 2 + tugL / 2;
  const bargeZ = L / 2 - bargeL / 2;
  // The tug: high bow, low after deck, a tall wheelhouse and one fat funnel.
  const tug = new THREE.Group();
  tug.position.z = tugZ;
  tug.add(hull(tugL, tugL * 0.32, -3.2, 2.4, mat(r.color, 0.7), 0.3, 0.9));
  tug.add(hull(tugL * 1.01, tugL * 0.33, 1.6, 2.5, DARK(), 0.3, 0.9));
  box(tug, WHITE(), tugL * 0.24, 3, tugL * 0.4, 0, 3.9, -tugL * 0.1);
  box(tug, WHITE(), tugL * 0.19, 2.6, tugL * 0.2, 0, 6.7, -tugL * 0.14);
  box(tug, GLASS(), tugL * 0.195, 1.1, tugL * 0.205, 0, 7.1, -tugL * 0.14);
  box(tug, mat(0xc7a02a, 0.6), 2.2, 4.4, 2.6, 0, 7.4, tugL * 0.08);
  post(tug, DARK(), 0.2, 5, 0, 10.5, -tugL * 0.14);
  // The towing winch on the after deck.
  box(tug, DARK(), 2.4, 1.6, 2.4, 0, 3.2, tugL * 0.26);
  g.add(tug);
  // The barge: a flat box with a raked bow, loaded with sand heaps or containers.
  const barge = new THREE.Group();
  barge.position.z = bargeZ;
  barge.add(hull(bargeL, B, -3.5, 3, mat(0x3a3f45, 0.85), 0.07, 1));
  const cargo = mat(0xb3a47e, 0.95);
  for (let k = 0; k < 4; k++) {
    const heap = new THREE.Mesh(new THREE.ConeGeometry(B * 0.42, 6, 10), cargo);
    heap.position.set(0, 6, -bargeL * 0.33 + k * bargeL * 0.22);
    heap.scale.z = 1.5;
    heap.castShadow = true;
    barge.add(heap);
  }
  box(barge, mat(0x3a3f45, 0.85), B * 0.96, 1.6, bargeL * 0.92, 0, 3.6, 0);
  g.add(barge);
  // The hawser: off the tug's winch, sagging to the water in the middle, up to the barge's bow.
  const from = tugZ + tugL * 0.3;
  const to = bargeZ - bargeL / 2;
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 12; k++) {
    const u = k / 12;
    pts.push(new THREE.Vector3(0, 3 - 3.2 * 4 * u * (1 - u), from + (to - from) * u));
  }
  const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.18, 5), DARK());
  g.add(line);
  return g;
}

/** A pilot boat: a fast, stubby launch, with the high-visibility wheelhouse of a boat that goes alongside ships in a swell. */
function buildPilotBoat(r: TrafficRoute): THREE.Group {
  const g = new THREE.Group();
  const L = r.length;
  const B = r.beam;
  g.add(hull(L, B, -1.4, 1.8, mat(r.color, 0.5), 0.36, 0.92));
  // The heavy fender all round.
  g.add(hull(L * 1.02, B * 1.06, 1.3, 1.9, DARK(), 0.36, 0.92));
  const house = mat(0xf3b327, 0.55);
  box(g, house, B * 0.74, 2.6, L * 0.4, 0, 3.1, -L * 0.04);
  box(g, GLASS(), B * 0.75, 1.0, L * 0.36, 0, 3.6, -L * 0.04);
  box(g, WHITE(), B * 0.5, 0.25, L * 0.3, 0, 4.5, -L * 0.04);
  post(g, DARK(), 0.1, 3.4, 0, 6.2, 0);
  // Boarding rails each side, where the pilot steps across.
  for (const s of [-1, 1]) box(g, WHITE(), 0.08, 1, L * 0.5, s * B * 0.44, 2.4, -L * 0.02);
  return g;
}

/** A fishing boat: a salmon troller or a small dragger, house forward, a working deck aft, a mast and two long poles. */
function buildTrawler(r: TrafficRoute): THREE.Group {
  const g = new THREE.Group();
  const L = r.length;
  const B = r.beam;
  g.add(hull(L, B, -1.8, 1.9, mat(r.color, 0.6), 0.36, 0.8));
  g.add(hull(L * 1.01, B * 1.02, 1.5, 2.0, WHITE(), 0.36, 0.8));
  box(g, WHITE(), B * 0.6, 2.3, L * 0.26, 0, 3.0, -L * 0.2);
  box(g, GLASS(), B * 0.61, 0.8, L * 0.2, 0, 3.4, -L * 0.2);
  // Mast and boom over the working deck, and the trolling poles lowered out to each side.
  const spar = mat(0xbfb9a8, 0.7);
  post(g, spar, 0.12, L * 0.6, 0, 2 + L * 0.3, -L * 0.05);
  const boom = post(g, spar, 0.09, L * 0.42, 0, 4.2, L * 0.16);
  boom.rotation.x = Math.PI / 2 - 0.25;
  for (const s of [-1, 1]) {
    const pole = post(g, spar, 0.07, L * 0.75, s * L * 0.22, 2.4 + L * 0.2, -L * 0.05);
    pole.rotation.z = -s * 0.85;
  }
  // The net drum or hold hatch aft, and a stack of crab pots.
  box(g, DARK(), B * 0.5, 1.2, L * 0.12, 0, 2.5, L * 0.3);
  box(g, mat(0x6a6f3a, 0.9), B * 0.4, 1.6, L * 0.14, 0, 2.7, L * 0.1);
  return g;
}

/** The model for a route, if it is one of the deep-sea kinds built here. Null for the rest, which `traffic.ts` builds. */
export function buildOceanVessel(r: TrafficRoute): THREE.Group | null {
  switch (r.model as OceanModel) {
    case 'tanker': return buildTanker(r);
    case 'carcarrier': return buildCarCarrier(r);
    case 'cruise': return buildCruiseShip(r);
    case 'tug': return buildTugAndBarge(r);
    case 'pilot': return buildPilotBoat(r);
    case 'trawler': return buildTrawler(r);
    default: return null;
  }
}
