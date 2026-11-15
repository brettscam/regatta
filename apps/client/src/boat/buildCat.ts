import * as THREE from 'three';
import type { BoatSpec } from '@slack-tide/sim';
import { bandTexture, brightness, canvasTexture, nonSkidTexture, spline, teakTexture, type BoatDisplay, type Livery, type SloopGeometry, type SloopModel } from './buildSloop';

/**
 * A cruising catamaran built in code from a boat file: two slim hulls with near-plumb bows, a bridgedeck with a cabin
 * house and big windows, a trampoline between the bows, a hardtop over the cockpit, a raised helm station to
 * starboard under its own top, steps down each stern, davits across the back, and a fractional rig with a square-top
 * main on a boom carried above the hardtop and a self-tacking jib.
 *
 * Boat frame as for the sloop: +X starboard, +Y up, -Z forward, origin on the waterline amidships. It returns the same
 * shape of model as `buildSloop`, with the same named nodes, so everything that draws or works a boat takes her as she is.
 */

/** What the boat file says about a catamaran's hulls, beyond a monohull's dimensions. */
interface CatDimensions {
  /** Beam of one hull at the deck, metres. */
  hullBeam?: number;
  /** Height of the underside of the bridgedeck above the water, metres. */
  bridgedeckClearance?: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildCatamaran(spec: BoatSpec, livery: Livery = {}): SloopModel {
  const d = spec.dimensions as BoatSpec['dimensions'] & CatDimensions;
  const display = spec as BoatSpec & Partial<BoatDisplay>;
  const topsides = livery.topsides ?? display.topsides ?? '#f1efe8';
  const boatName = (livery.name ?? display.defaultName ?? spec.name).trim().toUpperCase().slice(0, 24) || 'REGATTA';
  const homePort = (livery.homePort ?? display.homePort ?? '').trim().toUpperCase().slice(0, 24);
  const darkHull = brightness(topsides) < 0.45;

  const root = new THREE.Group();
  root.name = spec.id;
  const nodes: Record<string, THREE.Object3D> = {};
  const hitProxies: THREE.Mesh[] = [];
  const solids: THREE.Object3D[] = [];
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const add = <T extends THREE.Object3D>(name: string, obj: T, parent: THREE.Object3D = root): T => {
    obj.name = name;
    nodes[name] = obj;
    parent.add(obj);
    return obj;
  };
  const proxy = (node: string, geom: THREE.BufferGeometry, parent: THREE.Object3D, pos?: THREE.Vector3): THREE.Mesh => {
    const m = new THREE.Mesh(geom, proxyMat);
    m.userData.node = node;
    if (pos) m.position.copy(pos);
    parent.add(m);
    hitProxies.push(m);
    return m;
  };

  // ---- the numbers everything hangs from -------------------------------------------------------------
  const L = d.loa;
  const half = L / 2;
  const F = d.freeboard;
  /** Half the beam of one hull, and how far each hull's centreline is off the boat's. */
  const HB = (d.hullBeam ?? d.beam * 0.25) / 2;
  const CX = d.beam / 2 - HB;
  const CLEAR = d.bridgedeckClearance ?? 0.75;
  const zAt = (t: number) => -half + L * t;
  /** Ends of the bridgedeck, the cabin and the cockpit, fore and aft. */
  const Z_BRIDGE0 = zAt(0.31);
  const Z_CABIN0 = zAt(0.275);
  const Z_CABIN1 = zAt(0.63);
  const Z_COCK1 = zAt(0.885);
  const ROOF = F + 1.5;
  const SOLE = F - 0.25;
  const TOP = SOLE + 2.12;
  /** The helm station, to starboard: the platform she is steered from, and its own top. */
  const HELM_X = Math.min(CX - 0.55, d.beam * 0.29);
  const HELM_SOLE = SOLE + 0.95;
  const HELM_TOP = HELM_SOLE + 1.98;
  const HELM_Z0 = Z_CABIN1 + 0.02;
  const HELM_Z1 = HELM_Z0 + 1.45;

  // ---- materials -------------------------------------------------------------------------------------
  const HULL_V0 = -1.0;
  const HULL_VH = 3.4;
  const v = (y: number) => (y - HULL_V0) / HULL_VH;
  const hullMat = new THREE.MeshPhysicalMaterial({
    map: bandTexture([[0, '#1d3a5c'], [v(-0.02), darkHull ? '#e9e6dc' : '#1f4f7a'], [v(0.1), topsides]], 1024),
    roughness: 0.28, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2, side: THREE.DoubleSide,
  });
  const gel = new THREE.MeshPhysicalMaterial({ color: 0xf2f0e8, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.25, side: THREE.DoubleSide });
  const nonSkid = new THREE.MeshStandardMaterial({ map: nonSkidTexture(), roughness: 0.92, side: THREE.DoubleSide });
  const teakDeck = new THREE.MeshStandardMaterial({ map: teakTexture(), roughness: 0.78, side: THREE.DoubleSide });
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd4d6, roughness: 0.22, metalness: 1 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xd9dcdc, roughness: 0.42, metalness: 0.65 });
  const black = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xeeece4, roughness: 0.55 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c151b, roughness: 0.08, metalness: 0.7, clearcoat: 1, side: THREE.DoubleSide });
  const cushion = new THREE.MeshStandardMaterial({ color: 0x9aa7b0, roughness: 0.95 });
  const foil = new THREE.MeshStandardMaterial({ color: 0x1d3a5c, roughness: 0.6 });

  const rod = (a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, parent: THREE.Object3D = root): THREE.Mesh => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), V(0, 0, 0).subVectors(b, a).normalize());
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const tube = (pts: THREE.Vector3[], radius: number, mat: THREE.Material, parent: THREE.Object3D = root): THREE.Mesh => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.25);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), radius, 6, false), mat);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  /** A box from its low corner to its high corner. */
  const block = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: THREE.Material | THREE.Material[], parent: THREE.Object3D = root): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /** A flat-shaded skin through quads given corner by corner. */
  const quads = (faces: THREE.Vector3[][], mat: THREE.Material, parent: THREE.Object3D = root): THREE.Mesh => {
    const p: number[] = [];
    for (const [a, b, c, e] of faces) for (const q of [a, b, c, a, c, e]) p.push(q.x, q.y, q.z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const uv = new Float32Array((p.length / 3) * 2);
    for (let i = 0; i < p.length / 3; i++) { uv[i * 2] = p[i * 3]; uv[i * 2 + 1] = p[i * 3 + 2]; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /** A pane set just proud of a face given by its four corners (bottom two, then top two the same way round). */
  const pane = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, e: THREE.Vector3, u0: number, u1: number, v0: number, v1: number, out: THREE.Vector3, mat: THREE.Material = glass, parent: THREE.Object3D = root): THREE.Mesh => {
    const at = (u: number, w: number) => a.clone().lerp(b, u).lerp(e.clone().lerp(c, u), w).addScaledVector(out, 0.014);
    const m = quads([[at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]], mat, parent);
    m.castShadow = false;
    return m;
  };

  // ---- hulls -----------------------------------------------------------------------------------------
  // Fine forward, fullest a little aft of amidships, carried to a broad stern that steps down to the water.
  const halfBeam = (t: number) => (t <= 0.5 ? HB * Math.pow(Math.sin((Math.max(t, 0) / 0.5) * (Math.PI / 2)), 0.8) : HB * (1 - 0.1 * ((t - 0.5) / 0.5) ** 2));
  /** Where the stern steps begin, and the height of the deck at a station: level, then three steps down. */
  const T_STEPS = 0.895;
  const sheerY = (t: number) => (t < T_STEPS ? F + 0.1 * Math.pow(1 - t, 2) : t < 0.93 ? F - 0.45 : t < 0.965 ? F - 0.9 : 0.42);
  const keelY = spline([[0, -0.08], [0.04, -0.34], [0.14, -0.5], [0.4, -0.58], [0.7, -0.52], [0.88, -0.3], [1, -0.04]]);
  /** The stem leans back a little as it rises: the bow is longest at the water. */
  const stemRake = (t: number, y: number) => 0.34 * Math.max(0, y / F) * Math.max(0, 1 - t / 0.07);
  // Everything solid is in one of two groups, as on the sloop: the hulls, and all that is built on them.
  const hullGroup = add('hull', new THREE.Group());
  const deckGroup = add('deck', new THREE.Group());
  solids.push(hullGroup, deckGroup);
  const stations: number[] = [];
  {
    const e = 0.0005;
    const cuts = [T_STEPS, 0.93, 0.965];
    const NS = 56;
    for (let i = 0; i <= NS; i++) {
      const t = i / NS;
      stations.push(t);
    }
    for (const c of cuts) stations.push(c - e, c + e);
    stations.sort((a, b) => a - b);
  }
  for (const side of [-1, 1]) {
    const NP = 12;
    const W = 2 * NP + 1;
    const pos: number[] = [];
    const uv: number[] = [];
    for (const t of stations) {
      const b = Math.max(halfBeam(t), 0.012);
      const sy = sheerY(t);
      const ky = Math.min(keelY(t), sy - 0.05);
      // Deep and narrow at the bow, a flatter U aft.
      const n = lerp(1.6, 2.9, Math.min(1, t / 0.45));
      for (let j = -NP; j <= NP; j++) {
        const s = Math.abs(j) / NP;
        const th = (s * Math.PI) / 2;
        const x = b * Math.pow(Math.sin(th), 2 / n) * Math.sign(j);
        const y = ky + (sy - ky) * (1 - Math.pow(Math.cos(th), 2 / n));
        pos.push(side * CX + x, y, zAt(t) + stemRake(t, y));
        uv.push(t, v(y));
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < stations.length - 1; i++) {
      for (let j = 0; j < W - 1; j++) {
        const a = i * W + j;
        const c = a + W;
        idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
    // Transom.
    const base = pos.length / 3;
    const last = (stations.length - 1) * W;
    pos.push(side * CX, (sheerY(1) + keelY(1)) / 2, zAt(1));
    uv.push(1, v(0.2));
    for (let j = 0; j < W; j++) {
      const k = (last + j) * 3;
      pos.push(pos[k], pos[k + 1], pos[k + 2]);
      uv.push(1, v(pos[k + 1]));
    }
    for (let j = 0; j < W - 1; j++) idx.push(base, base + 1 + j, base + 2 + j);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const hull = new THREE.Mesh(g, hullMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    hullGroup.add(hull);

    // The hull's own deck: a strip from rail to rail, and the treads and risers of the stern steps.
    const faces: THREE.Vector3[][] = [];
    const steps: THREE.Vector3[][] = [];
    for (let i = 0; i < stations.length - 1; i++) {
      const t0 = stations[i];
      const t1 = stations[i + 1];
      const p = (t: number, s: number) => {
        const y = sheerY(t);
        return V(side * CX + s * Math.max(halfBeam(t), 0.012), y, zAt(t) + stemRake(t, y));
      };
      (t0 >= T_STEPS - 0.001 ? steps : faces).push([p(t0, -1), p(t0, 1), p(t1, 1), p(t1, -1)]);
    }
    quads(faces, nonSkid, deckGroup);
    quads(steps, teakDeck, deckGroup);

    // A long dark window let into the outboard topsides, and a short one inboard forward.
    const widthAt = (t: number, y: number) => {
      const sy = sheerY(t);
      const ky = Math.min(keelY(t), sy - 0.05);
      const n = lerp(1.6, 2.9, Math.min(1, t / 0.45));
      const c = Math.pow(1 - Math.min(1, Math.max(0, (y - ky) / (sy - ky))), n / 2);
      return halfBeam(t) * Math.pow(Math.sqrt(Math.max(0, 1 - c * c)), 2 / n);
    };
    const strip: THREE.Vector3[][] = [];
    const N = 22;
    for (let i = 0; i < N; i++) {
      const t0 = lerp(0.26, 0.78, i / N);
      const t1 = lerp(0.26, 0.78, (i + 1) / N);
      // The window tapers to a point at each end.
      const tall = (t: number) => 0.2 * Math.pow(Math.sin(Math.PI * ((t - 0.26) / 0.52)), 0.35);
      const at = (t: number, up: number) => {
        const y = F - 0.62 + up * tall(t);
        return V(side * (CX + widthAt(t, y) + 0.012), y, zAt(t));
      };
      strip.push([at(t0, -1), at(t1, -1), at(t1, 1), at(t0, 1)]);
    }
    quads(strip, glass, hullGroup).castShadow = false;

    // Stub keel and spade rudder under each hull.
    const keelDepth = Math.max(0.3, d.draft - 0.5);
    const keel = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.7, keelDepth, 16), foil);
    keel.scale.set(0.09, 1, 1.5);
    keel.position.set(side * CX, -0.5 - keelDepth / 2, 0.4);
    hullGroup.add(keel);
    const rudder = add(side > 0 ? 'rudder' : 'rudder_port', new THREE.Group());
    rudder.position.set(side * CX, 0, zAt(0.9));
    const bladeDepth = Math.max(0.5, d.draft - 0.35);
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.65, bladeDepth, 12), foil);
    blade.scale.set(0.04, 1, 0.24);
    blade.position.set(0, -0.2 - bladeDepth / 2, 0.1);
    rudder.add(blade);
  }

  // ---- bridgedeck, cockpit and the beams that join the hulls -------------------------------------------
  {
    const inner = CX - HB * 0.55;
    // Forward of the cockpit the bridgedeck is at deck height; the cockpit is let down into it.
    block(-inner, CLEAR, Z_BRIDGE0, inner, F, Z_CABIN1, [gel, gel, nonSkid, gel, gel, gel], deckGroup);
    block(-inner, CLEAR, Z_CABIN1, inner, SOLE, Z_COCK1, [gel, gel, teakDeck, gel, gel, gel], deckGroup);
    // A rounded nose under the front of the bridgedeck, where the seas meet it.
    const nose = new THREE.Mesh(new THREE.CylinderGeometry((F - CLEAR) / 2, (F - CLEAR) / 2, 2 * inner, 14, 1, false, Math.PI, Math.PI).rotateZ(Math.PI / 2), gel);
    nose.position.set(0, (F + CLEAR) / 2, Z_BRIDGE0);
    nose.scale.z = 0.7;
    deckGroup.add(nose);
    // Aft beam across the back of the cockpit, with the name on it.
    block(-inner, CLEAR + 0.1, Z_COCK1, inner, F + 0.06, Z_COCK1 + 0.34, gel, deckGroup);
    const nameTex = canvasTexture(1024, 200, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#16284a';
      const fit = (text: string, size: number, weight: number, maxWidth: number): void => {
        c.font = `${weight} ${size}px Georgia, "Times New Roman", serif`;
        const wide = c.measureText(text).width;
        if (wide > maxWidth) c.font = `${weight} ${Math.floor((size * maxWidth) / wide)}px Georgia, "Times New Roman", serif`;
      };
      fit(boatName, 104, 600, w - 60);
      c.fillText(boatName, w / 2, 70);
      const port = homePort.split('').join(' ');
      fit(port, 46, 500, w - 160);
      c.fillText(port, w / 2, 158);
    });
    const name = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6 * (200 / 1024)), new THREE.MeshStandardMaterial({ map: nameTex, transparent: true, alphaTest: 0.35, roughness: 0.5 }));
    name.position.set(0, (CLEAR + F) / 2 + 0.1, Z_COCK1 + 0.346);
    name.name = 'transom_name';
    root.add(name);

    // Forward crossbeam between the bows, carrying the forestay, with a striker above it.
    const beamZ = zAt(0.035);
    const beamY = F + 0.02;
    rod(V(-CX, beamY, beamZ), V(CX, beamY, beamZ), 0.085, alloy).scale.z = 1.25;
    rod(V(0, beamY, beamZ), V(0, beamY + 0.42, beamZ), 0.03, alloy);
    for (const side of [-1, 1]) rod(V(0, beamY + 0.42, beamZ), V(side * CX * 0.82, beamY + 0.05, beamZ), 0.007, steel);

    // The trampoline: a net laced between the hulls, the crossbeam and the front of the bridgedeck.
    const netTex = canvasTexture(128, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = 'rgba(28, 32, 36, 0.95)';
      c.lineWidth = 5;
      for (let i = 0; i <= 4; i++) {
        c.beginPath();
        c.moveTo((i * w) / 4, 0);
        c.lineTo((i * w) / 4, h);
        c.moveTo(0, (i * h) / 4);
        c.lineTo(w, (i * h) / 4);
        c.stroke();
      }
    });
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    netTex.repeat.set(1 / 0.16, 1 / 0.16);
    const netMat = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.4, roughness: 0.95, side: THREE.DoubleSide });
    const netFaces: THREE.Vector3[][] = [];
    const NN = 10;
    for (let i = 0; i < NN; i++) {
      const z0 = lerp(beamZ + 0.12, Z_BRIDGE0 - 0.1, i / NN);
      const z1 = lerp(beamZ + 0.12, Z_BRIDGE0 - 0.1, (i + 1) / NN);
      const edge = (z: number) => CX - halfBeam((z + half) / L) + 0.04;
      // It sags a hand's breadth in the middle.
      const sag = (z: number) => F - 0.04 - 0.07 * Math.sin((Math.PI * (z - beamZ)) / (Z_BRIDGE0 - beamZ));
      netFaces.push([V(-edge(z0), sag(z0), z0), V(edge(z0), sag(z0), z0), V(edge(z1), sag(z1), z1), V(-edge(z1), sag(z1), z1)]);
    }
    const net = quads(netFaces, netMat);
    net.name = 'trampoline';
    net.castShadow = false;
  }

  // ---- cabin house -----------------------------------------------------------------------------------
  const cabinHalf0 = CX - HB - 0.12;
  const cabinHalf1 = CX - 0.1;
  {
    const cabin = new THREE.Group();
    cabin.name = 'cabin';
    // Bottom corners on the deck, top corners at the roof: the front rakes back and the sides lean in.
    const zTop0 = Z_CABIN0 + 1.25;
    const b = [V(-cabinHalf0, F, Z_CABIN0), V(cabinHalf0, F, Z_CABIN0), V(cabinHalf1, F, Z_CABIN1), V(-cabinHalf1, F, Z_CABIN1)];
    const t = [V(-cabinHalf0 * 0.86, ROOF, zTop0), V(cabinHalf0 * 0.86, ROOF, zTop0), V(cabinHalf1 - 0.22, ROOF, Z_CABIN1), V(-(cabinHalf1 - 0.22), ROOF, Z_CABIN1)];
    quads([[b[0], b[1], t[1], t[0]], [b[1], b[2], t[2], t[1]], [b[2], b[3], t[3], t[2]], [b[3], b[0], t[0], t[3]]], gel, cabin);
    // The roof: a slab with a small overhang all round, and its top face.
    const over = (p: THREE.Vector3, y: number, grow: number) => V(p.x + Math.sign(p.x) * grow, y, p.z + (p.z < 0 ? -grow : 0));
    const r0 = t.map((p) => over(p, ROOF, 0.1));
    const r1 = t.map((p) => over(p, ROOF + 0.07, 0.1));
    quads([[r0[0], r0[1], r1[1], r1[0]], [r0[1], r0[2], r1[2], r1[1]], [r0[2], r0[3], r1[3], r1[2]], [r0[3], r0[0], r1[0], r1[3]], [r0[0], r0[1], r0[2], r0[3]]], gel, cabin);
    quads([[r1[0], r1[1], r1[2], r1[3]]], nonSkid, cabin);
    // Windows: one sweep across the front, three each side, and sliding glass doors aft.
    const fwd = V(0, 0.55, -1).normalize();
    pane(b[0], b[1], t[1], t[0], 0.03, 0.49, 0.2, 0.9, fwd, glass, cabin);
    pane(b[0], b[1], t[1], t[0], 0.51, 0.97, 0.2, 0.9, fwd, glass, cabin);
    for (const side of [-1, 1]) {
      const [p0, p1, p2, p3] = side > 0 ? [b[1], b[2], t[2], t[1]] : [b[0], b[3], t[3], t[0]];
      const out = V(side, 0.12, 0).normalize();
      for (const [u0, u1] of [[0.05, 0.34], [0.37, 0.66], [0.69, 0.96]]) pane(p0, p1, p2, p3, u0, u1, 0.3, 0.86, out, glass, cabin);
    }
    const aft = V(0, 0, 1);
    pane(b[3], b[2], t[2], t[3], 0.2, 0.42, 0.02, 0.86, aft, glass, cabin);
    pane(b[3], b[2], t[2], t[3], 0.43, 0.62, 0.02, 0.86, aft, glass, cabin);
    pane(b[3], b[2], t[2], t[3], 0.06, 0.17, 0.42, 0.86, aft, glass, cabin);
    // Hatches in the roof.
    for (const x of [-0.9, 0.9]) block(x - 0.3, ROOF + 0.07, zTop0 + 0.5, x + 0.3, ROOF + 0.11, zTop0 + 1.1, glass, cabin).castShadow = false;
    deckGroup.add(cabin);
  }

  // ---- cockpit: seats, table, the hardtop over it ------------------------------------------------------
  const benchZ = Z_COCK1 - 0.55;
  const seatY = SOLE + 0.42;
  {
    const cockpit = new THREE.Group();
    cockpit.name = 'cockpit';
    const inner = CX - HB * 0.55;
    // A bench across the stern and a settee down the port side, round a table.
    block(-inner + 0.15, SOLE, benchZ, inner - 0.15, seatY - 0.06, Z_COCK1, gel, cockpit);
    block(-inner + 0.15, seatY - 0.06, benchZ, inner - 0.15, seatY, Z_COCK1, cushion, cockpit);
    block(-inner + 0.15, seatY, Z_COCK1 - 0.1, inner - 0.15, seatY + 0.42, Z_COCK1, gel, cockpit);
    block(-inner, SOLE, Z_CABIN1 + 0.9, -inner + 0.6, seatY - 0.06, benchZ, gel, cockpit);
    block(-inner, seatY - 0.06, Z_CABIN1 + 0.9, -inner + 0.6, seatY, benchZ, cushion, cockpit);
    block(-1.7, SOLE + 0.68, Z_CABIN1 + 1.25, -0.75, SOLE + 0.72, benchZ - 0.35, teakDeck, cockpit);
    rod(V(-1.22, SOLE, (Z_CABIN1 + benchZ) / 2 + 0.45), V(-1.22, SOLE + 0.68, (Z_CABIN1 + benchZ) / 2 + 0.45), 0.05, steel, cockpit);

    // The hardtop: a rigid top from the back of the cabin to the aft beam, on two posts aft. It stops short of
    // the helm station, which has its own higher top.
    const x0 = -(cabinHalf1 - 0.05);
    const x1 = HELM_X - 0.82;
    const z0 = Z_CABIN1 - 0.25;
    const z1 = Z_COCK1 + 0.25;
    block(x0, TOP, z0, x1, TOP + 0.08, z1, [gel, gel, nonSkid, gel, gel, gel], cockpit);
    // It rises from the cabin roof on a short raked coaming of dark glass.
    quads([[V(x0, ROOF + 0.07, z0 - 0.3), V(x1, ROOF + 0.07, z0 - 0.3), V(x1, TOP, z0), V(x0, TOP, z0)]], glass, cockpit);
    for (const x of [x0 + 0.08, x1 - 0.08]) rod(V(x, seatY + 0.42, Z_COCK1 - 0.05), V(x, TOP, z1 - 0.1), 0.028, steel, cockpit);
    // Solar panels on it.
    const solar = new THREE.MeshStandardMaterial({ color: 0x10182a, roughness: 0.25, metalness: 0.5 });
    for (const sx of [0.25, 0.75]) {
      const px = lerp(x0, x1, sx);
      block(px - 0.72, TOP + 0.08, z0 + 0.5, px + 0.72, TOP + 0.1, z0 + 1.65, solar, cockpit).castShadow = false;
    }
    deckGroup.add(cockpit);
  }

  // ---- helm station ------------------------------------------------------------------------------------
  const WHEEL_R = 0.42;
  const wheelPos = V(HELM_X, HELM_SOLE + 0.95, HELM_Z0 + 0.36);
  const consoleTop = HELM_SOLE + 1.2;
  const winchY = ROOF + 0.07;
  const winchAt = (side: number) => V(HELM_X + side * 0.5, winchY, Z_CABIN1 - 0.42);
  {
    const helm = new THREE.Group();
    helm.name = 'helm_station';
    const hx0 = HELM_X - 0.78;
    const hx1 = Math.min(HELM_X + 0.78, CX + HB - 0.12);
    // The platform, two steps up to it from the cockpit, and a bench seat across its after end.
    block(hx0, SOLE, HELM_Z0, hx1, HELM_SOLE, HELM_Z1, [gel, gel, teakDeck, gel, gel, gel], helm);
    block(hx0 - 0.3, SOLE, HELM_Z0 + 0.45, hx0, SOLE + 0.32, HELM_Z1, [gel, gel, teakDeck, gel, gel, gel], helm);
    block(hx0 - 0.3, SOLE + 0.32, HELM_Z0 + 0.95, hx0, SOLE + 0.64, HELM_Z1, [gel, gel, teakDeck, gel, gel, gel], helm);
    block(hx0 + 0.12, HELM_SOLE, HELM_Z1 - 0.36, hx1 - 0.12, HELM_SOLE + 0.5, HELM_Z1, gel, helm);
    block(hx0 + 0.12, HELM_SOLE + 0.5, HELM_Z1 - 0.36, hx1 - 0.12, HELM_SOLE + 0.56, HELM_Z1, cushion, helm);
    tube([V(hx0 + 0.14, HELM_SOLE + 0.56, HELM_Z1 - 0.02), V(hx0 + 0.14, HELM_SOLE + 0.98, HELM_Z1 + 0.04), V(hx1 - 0.14, HELM_SOLE + 0.98, HELM_Z1 + 0.04), V(hx1 - 0.14, HELM_SOLE + 0.56, HELM_Z1 - 0.02)], 0.02, steel, helm);

    // Console against the back of the cabin: instruments on its face, the engine levers beside the wheel.
    block(hx0, HELM_SOLE, HELM_Z0 - 0.04, hx1, consoleTop, HELM_Z0 + 0.2, gel, helm);
    const plotter = add('chartplotter', new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshBasicMaterial({ color: 0x0d2f3a })), helm);
    plotter.position.set(HELM_X - 0.42, consoleTop - 0.2, HELM_Z0 + 0.204);
    const lever = add('engine_lever', new THREE.Group(), helm);
    lever.position.set(hx1 - 0.16, consoleTop - 0.3, HELM_Z0 + 0.22);
    // Two levers, one for each engine.
    for (const dx of [-0.05, 0.05]) {
      rod(V(dx, 0, 0), V(dx, 0.16, 0.05), 0.008, steel, lever);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), black);
      knob.position.set(dx, 0.17, 0.055);
      lever.add(knob);
    }

    const wheel = add('wheel', new THREE.Group());
    wheel.position.copy(wheelPos);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.02, 10, 44), steel);
    rim.userData.glow = true;
    wheel.add(rim);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      rod(V(0, 0, 0), V(Math.sin(a) * WHEEL_R, Math.cos(a) * WHEEL_R, 0), 0.011, steel, wheel).userData.glow = true;
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 14).rotateX(Math.PI / 2), steel);
    hub.position.z = -0.08;
    wheel.add(hub);
    const king = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.014, 8, 14), white);
    king.position.set(0, WHEEL_R, 0);
    king.rotation.y = Math.PI / 2;
    wheel.add(king);
    wheel.traverse((o) => { o.castShadow = true; });
    proxy('wheel', new THREE.CylinderGeometry(WHEEL_R + 0.12, WHEEL_R + 0.12, 0.34, 20).rotateX(Math.PI / 2), wheel);

    // Autopilot head on the console to port of the wheel, its screen facing the helm.
    const pilot = add('autopilot', new THREE.Group());
    pilot.position.set(HELM_X - 0.42, consoleTop + 0.13, HELM_Z0 + 0.1);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.05), black);
    body.userData.glow = true;
    const screen = add('autopilot_screen', new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.11), new THREE.MeshBasicMaterial({ color: 0x0a1a1f })), pilot);
    screen.position.set(-0.04, 0.012, 0.0262);
    const knob = add('autopilot_knob', new THREE.Group(), pilot);
    knob.position.set(0.082, 0.01, 0.025);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.038, 0.03, 20).rotateX(Math.PI / 2), steel);
    dial.position.z = 0.015;
    dial.userData.glow = true;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.022, 0.004), black);
    tick.position.set(0, 0.02, 0.031);
    knob.add(dial, tick);
    pilot.add(body);
    proxy('autopilot', new THREE.BoxGeometry(0.45, 0.42, 0.3), pilot, V(0, 0, 0.12));

    // Her own top, higher than the cockpit's, on four posts, with a windscreen ahead of the wheel.
    const tx0 = hx0 - 0.12;
    const tx1 = hx1 + 0.1;
    const tz0 = HELM_Z0 - 0.3;
    const tz1 = HELM_Z1 + 0.25;
    block(tx0, HELM_TOP, tz0, tx1, HELM_TOP + 0.07, tz1, gel, helm);
    for (const x of [hx0 + 0.05, hx1 - 0.05]) {
      rod(V(x, HELM_SOLE, HELM_Z1 - 0.05), V(x, HELM_TOP, HELM_Z1 - 0.05), 0.024, steel, helm);
      rod(V(x, consoleTop, HELM_Z0 + 0.08), V(x, HELM_TOP, HELM_Z0 + 0.08), 0.024, steel, helm);
    }
    const screenMat = new THREE.MeshPhysicalMaterial({ color: 0x9fb4bd, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    quads([[V(tx0 + 0.08, consoleTop, HELM_Z0 - 0.02), V(tx1 - 0.08, consoleTop, HELM_Z0 - 0.02), V(tx1 - 0.08, HELM_TOP, tz0 + 0.06), V(tx0 + 0.08, HELM_TOP, tz0 + 0.06)]], screenMat, helm).castShadow = false;
    deckGroup.add(helm);

    // Sheet winches on the cabin top just ahead of the helm, where every line on a boat like this is led.
    for (const side of [-1, 1]) {
      const name = side < 0 ? 'winch_port' : 'winch_stbd';
      const winch = add(name, new THREE.Group());
      winch.position.copy(winchAt(side));
      const baseM = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.035, 20), steel);
      baseM.position.y = 0.018;
      const drum = add(`${name}_drum`, new THREE.Group(), winch);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.082, 0.13, 20), steel);
      barrel.position.y = 0.1;
      barrel.userData.glow = true;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.075, 0.03, 20), steel);
      cap.position.y = 0.18;
      cap.userData.glow = true;
      const socket = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.11), black);
      socket.position.y = 0.198;
      drum.add(barrel, cap, socket);
      winch.add(baseM);
      winch.traverse((o) => { o.castShadow = true; });
      proxy(name, new THREE.SphereGeometry(0.3, 10, 8), winch, V(0, 0.12, 0));
      const clutch = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.055, 0.13), black);
      clutch.position.copy(winchAt(side)).add(V(0, 0.03, -0.42));
      root.add(clutch);
    }
  }

  // ---- mast and standing rigging ---------------------------------------------------------------------
  const mastZ = zAt(0) + d.mastFromBow;
  const mastBaseY = ROOF + 0.07;
  const mastTopY = d.mastHeight;
  const hounds = V(0, d.forestayHeight, mastZ - 0.1);
  const stem = V(0, F + 0.14, zAt(0.035));
  {
    const mastGroup = add('mast', new THREE.Group());
    const h = mastTopY - mastBaseY;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.115, h, 14), alloy);
    mast.scale.z = 1.5;
    mast.position.set(0, mastBaseY + h / 2, mastZ);
    mast.castShadow = true;
    mastGroup.add(mast);
    solids.push(mast);
    proxy('mast', new THREE.CylinderGeometry(0.3, 0.3, 4.5, 8), mastGroup, V(0, mastBaseY + 3.6, mastZ));

    // Shrouds led well aft to the outer rails: there is no backstay, so the square-top main can swing clear.
    const chain = (side: number) => V(side * (CX + HB - 0.1), F + 0.04, mastZ + 1.5);
    const spreaders = [{ y: mastBaseY + h * 0.36, w: 1.1 }, { y: mastBaseY + h * 0.66, w: 0.85 }];
    for (const side of [-1, 1]) {
      const tips = spreaders.map((s) => V(side * s.w, s.y, mastZ + 0.35));
      spreaders.forEach((s, i) => {
        rod(V(0, s.y, mastZ), tips[i], 0.02, alloy, mastGroup).scale.z = 2.2;
      });
      // Diamonds stiffen the mast itself.
      rod(V(side * 0.07, mastBaseY + 0.5, mastZ), tips[0], 0.005, steel, mastGroup);
      rod(tips[0], tips[1], 0.005, steel, mastGroup);
      rod(tips[1], V(side * 0.06, hounds.y - 0.2, mastZ), 0.005, steel, mastGroup);
      rod(chain(side), V(side * 0.07, hounds.y - 0.1, mastZ), 0.007, steel, mastGroup);
    }
    rod(stem, hounds, 0.008, steel, mastGroup);

    rod(V(0.07, mastTopY, mastZ + 0.1), V(0.09, mastTopY + 0.95, mastZ + 0.13), 0.005, black, mastGroup);
    rod(V(0, mastTopY, mastZ - 0.05), V(0, mastTopY + 0.14, mastZ - 0.5), 0.008, alloy, mastGroup);
    const cups = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), black);
    cups.position.set(0, mastTopY + 0.17, mastZ - 0.5);
    const tricolour = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10), new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.2, emissive: 0x30383c }));
    tricolour.position.set(-0.06, mastTopY + 0.04, mastZ + 0.02);
    const radar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 18), white);
    radar.position.set(0, mastBaseY + h * 0.42, mastZ - 0.42);
    mastGroup.add(cups, tricolour, radar);

    const windex = add('windex', new THREE.Group(), mastGroup);
    windex.position.set(0, mastTopY + 0.32, mastZ);
    rod(V(0, -0.32, 0), V(0, 0, 0), 0.008, steel, windex);
    const vaneMat = new THREE.MeshStandardMaterial({ color: 0xd9381e, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x3a0a04 });
    const arrow = add('windex_arrow', new THREE.Group(), windex);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.62), black);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.26), vaneMat);
    fin.position.set(0, 0, 0.3);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 8), vaneMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0, -0.36);
    arrow.add(shaft, fin, tip);

    const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
    const displayNode = add('mast_display', new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.05), [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ color: 0x0a1a1f }), dark]), mastGroup);
    displayNode.position.set(0, mastBaseY + 1.05, mastZ + 0.2);
  }

  // ---- boom, carried above the hardtop ----------------------------------------------------------------
  const gooseneck = V(0, Math.max(mastBaseY + d.boomHeight, HELM_TOP + 0.42), mastZ + 0.15);
  {
    const boom = add('boom', new THREE.Group());
    boom.position.copy(gooseneck);
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, d.boomLength, 12), alloy);
    spar.rotation.x = Math.PI / 2;
    spar.scale.z = 1.6;
    spar.position.z = d.boomLength / 2;
    spar.castShadow = true;
    spar.userData.glow = true;
    boom.add(spar);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), black);
    cap.position.z = d.boomLength;
    boom.add(cap);
    proxy('boom', new THREE.BoxGeometry(0.7, 0.85, d.boomLength + 0.3), boom, V(0, 0.05, d.boomLength / 2));
    solids.push(spar);
    // Stack pack and lazy jacks.
    const cover = new THREE.MeshStandardMaterial({ color: 0x1f4f7a, roughness: 0.95, side: THREE.DoubleSide });
    const jackTop = V(0, (mastTopY - gooseneck.y) * 0.4, -0.13);
    for (const side of [-1, 1]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.3, d.boomLength - 0.55), cover);
      flap.position.set(side * 0.12, 0.2, d.boomLength / 2 + 0.05);
      flap.rotation.z = -side * 0.22;
      flap.castShadow = true;
      boom.add(flap);
      const mid = V(side * 0.14, (mastTopY - gooseneck.y) * 0.13, d.boomLength * 0.42);
      rod(jackTop.clone().setX(side * 0.05), mid, 0.003, white, boom).castShadow = false;
      for (const f of [0.26, 0.52, 0.8]) rod(mid, V(side * 0.15, 0.34, d.boomLength * f), 0.003, white, boom).castShadow = false;
    }
  }

  // ---- foredeck: furler, the jib's track, bow rails -----------------------------------------------------
  const jibTack = stem.clone().lerp(hounds, 0.035);
  const jibHead = stem.clone().lerp(hounds, 0.94);
  const trackZ = mastZ - 1.05;
  const trackY = ROOF + 0.09;
  const carAt = (side: number) => V(side * 1.25, trackY + 0.05, trackZ);
  {
    const furler = add('furler', new THREE.Group());
    furler.position.copy(stem.clone().lerp(hounds, 0.018));
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.13, 16), black);
    drum.userData.glow = true;
    furler.add(drum);
    proxy('furler', new THREE.SphereGeometry(0.32, 10, 8), furler);
    // The self-tacking jib's track: a bar across the cabin top ahead of the mast, bowed forward.
    tube([carAt(-1), V(0, trackY, trackZ - 0.22), carAt(1)], 0.022, black);

    const rails = new THREE.Group();
    rails.name = 'rails';
    for (const side of [-1, 1]) {
      // Stanchions and two lifelines down the outboard rail, a pulpit round the bow and a rail round the stern steps.
      const tops: THREE.Vector3[] = [];
      for (let t = 0.1; t <= 0.86; t += 0.095) {
        const x = side * (CX + halfBeam(t) - 0.07);
        const base = V(x, sheerY(t), zAt(t));
        const top = V(x, sheerY(t) + 0.64, zAt(t));
        rod(base, top, 0.011, steel, rails);
        tops.push(top);
      }
      tube(tops, 0.005, steel, rails).castShadow = false;
      tube(tops.map((p) => p.clone().setY(p.y - 0.31)), 0.004, steel, rails).castShadow = false;
      const bx = side * CX;
      const bowTop = sheerY(0.02) + 0.66;
      tube([tops[0], V(bx + side * 0.3, bowTop, zAt(0.045)), V(bx, bowTop, zAt(0.012) + 0.3), V(bx - side * 0.3, bowTop, zAt(0.045)), V(bx - side * halfBeam(0.1) + side * 0.07, bowTop, zAt(0.1))], 0.013, steel, rails);
      rod(V(bx, sheerY(0.02), zAt(0.012) + 0.32), V(bx, bowTop, zAt(0.012) + 0.3), 0.013, steel, rails);
      // A cleat at each bow and each quarter.
      for (const t of [0.07, 0.87]) {
        const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.24), steel);
        cleat.position.set(side * (CX + halfBeam(t) - 0.2), sheerY(t) + 0.03, zAt(t));
        rails.add(cleat);
      }
      // Grab rail down the stern steps.
      tube([V(side * (CX + HB - 0.12), F + 0.64, zAt(0.86)), V(side * (CX + HB - 0.12), F + 0.5, zAt(0.9)), V(side * (CX + HB - 0.16), 1.25, zAt(0.985))], 0.014, steel, rails);
      rod(V(side * (CX + HB - 0.16), 0.42, zAt(0.985)), V(side * (CX + HB - 0.16), 1.25, zAt(0.985)), 0.014, steel, rails);
    }
    root.add(rails);
  }

  // ---- davits across the stern, and the ensign ----------------------------------------------------------
  {
    // The tender hangs here. The node sits on the aft beam at deck height; `userData.tips` are the two falls.
    const davits = add('davits', new THREE.Group());
    davits.position.set(0, F, Z_COCK1 + 0.2);
    const reach = half - (Z_COCK1 + 0.2) + 0.25;
    const tips: Array<[number, number, number]> = [];
    for (const side of [-1, 1]) {
      const x = side * 1.35;
      tube([V(x, 0.05, 0), V(x, 0.75, 0.25), V(x, 1.02, reach * 0.55), V(x, 0.98, reach)], 0.04, steel, davits);
      rod(V(x, 0.05, 0), V(x, 0.72, reach * 0.42), 0.02, steel, davits);
      const block2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.08), black);
      block2.position.set(x, 0.9, reach - 0.05);
      davits.add(block2);
      tips.push([x, 0.9, reach - 0.05]);
    }
    rod(V(-1.35, 0.98, reach * 0.8), V(1.35, 0.98, reach * 0.8), 0.025, steel, davits);
    davits.userData.tips = tips;

    const gear = new THREE.Group();
    gear.name = 'deck_gear';
    const staffFoot = V(-(CX + HB - 0.14), F + 0.64, zAt(0.86));
    const staffTop = staffFoot.clone().add(V(-0.08, 0.9, 0.26));
    rod(staffFoot, staffTop, 0.012, steel, gear);
    const ensign = add('ensign', new THREE.Group(), gear);
    ensign.position.copy(staffTop).add(V(0, -0.03, 0));
    const FLY = 0.66;
    const HOIST = 0.4;
    const flagGeom = new THREE.PlaneGeometry(FLY, HOIST, 12, 5);
    flagGeom.translate(FLY / 2, -HOIST / 2, 0);
    const flagTex = canvasTexture(256, 152, (g, w, h) => {
      for (let i = 0; i < 13; i++) {
        g.fillStyle = i % 2 ? '#f3f1ea' : '#b22a35';
        g.fillRect(0, (i * h) / 13, w, h / 13 + 1);
      }
      g.fillStyle = '#1f305e';
      g.fillRect(0, 0, w * 0.42, (h * 7) / 13);
      g.fillStyle = '#f3f1ea';
      const cx = w * 0.21;
      const cy = (h * 3.5) / 13;
      for (let i = 0; i < 13; i++) {
        const a = (i / 13) * Math.PI * 2;
        g.beginPath();
        g.arc(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26, 3.4, 0, Math.PI * 2);
        g.fill();
      }
    });
    const flag = add('ensign_flag', new THREE.Mesh(flagGeom, new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.9, emissive: 0x2a2a2a })), ensign);
    flag.castShadow = true;
    flag.userData.fly = FLY;
    flag.userData.hoist = HOIST;
    // A horseshoe lifebuoy on the starboard quarter rail.
    const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.058, 8, 18, Math.PI * 1.45), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.7 }));
    buoy.position.set(CX + HB - 0.1, F + 0.42, zAt(0.84));
    buoy.rotation.set(0, 0, Math.PI * 0.275 + Math.PI);
    gear.add(buoy);
    root.add(gear);
  }

  // The mainsheet's traveller: a track across the after edge of the cockpit hardtop.
  const traveller = V(0, TOP + 0.1, Math.min(Z_COCK1 + 0.1, gooseneck.z + d.boomLength * 0.86));
  {
    const x0 = -(cabinHalf1 - 0.25);
    const x1 = HELM_X - 1.0;
    rod(V(x0, TOP + 0.1, traveller.z), V(x1, TOP + 0.1, traveller.z), 0.03, black);
    const car = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 0.12), steel);
    car.position.copy(traveller).add(V(0, 0.04, 0));
    root.add(car);
  }

  const geo: SloopGeometry = {
    mastZ,
    mastTopY,
    gooseneck,
    boomLength: d.boomLength,
    mainTackY: gooseneck.y + 0.1,
    mainHeadY: mastTopY - 0.35,
    mainFoot: d.boomLength - 0.25,
    jibTack,
    jibHead,
    hounds,
    jibFoot: d.jibFoot,
    jibClewY: ROOF + 0.55,
    carPort: carAt(-1),
    carStbd: carAt(1),
    winchPort: winchAt(-1).add(V(0, 0.1, 0)),
    winchStbd: winchAt(1).add(V(0, 0.1, 0)),
    traveller: traveller.clone().add(V(0, -0.06, 0)),
    vangBase: V(0, mastBaseY + 0.12, mastZ + 0.16),
    wheel: wheelPos,
    cockpitSoleY: SOLE,
    wheelRadius: WHEEL_R,
    seatX: 1.15,
    seatY,
    trimmerZ: benchZ + 0.22,
    cockpitFwdZ: Z_CABIN1,
    cockpitAftZ: Z_COCK1,
    helmSoleY: HELM_SOLE,
    wellHalf: 1.6,
    mainHeadWidth: spec.sails.main.squareTop ? spec.sails.main.squareTop * (d.boomLength - 0.25) : undefined,
    hullOffset: CX,
    selfTackingJib: spec.sails.jib.selfTacking === true,
  };

  return { root, nodes, hitProxies, solids, geo };
}
