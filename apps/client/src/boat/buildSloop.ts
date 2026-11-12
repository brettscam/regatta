import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BoatSpec } from '@slack-tide/sim';

/**
 * The milestone 1 placeholder sloop, built in code.
 * Boat frame: +X starboard, +Y up, -Z forward. The origin is on the waterline amidships.
 * Every part a control binds to is a named node, exactly as the glTF model that replaces this will have.
 */
export interface SloopModel {
  root: THREE.Group;
  nodes: Record<string, THREE.Object3D>;
  /** Invisible, generous shapes around small parts so they are easy to point at. Each maps back to a node name. */
  hitProxies: THREE.Mesh[];
  /** Solid things the camera must not pass through. */
  solids: THREE.Object3D[];
  geo: SloopGeometry;
}

export interface SloopGeometry {
  mastZ: number;
  mastTopY: number;
  gooseneck: THREE.Vector3;
  boomLength: number;
  mainTackY: number;
  mainHeadY: number;
  mainFoot: number;
  jibTack: THREE.Vector3;
  jibHead: THREE.Vector3;
  hounds: THREE.Vector3;
  jibFoot: number;
  jibClewY: number;
  carPort: THREE.Vector3;
  carStbd: THREE.Vector3;
  winchPort: THREE.Vector3;
  winchStbd: THREE.Vector3;
  traveller: THREE.Vector3;
  vangBase: THREE.Vector3;
  wheel: THREE.Vector3;
  cockpitSoleY: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Smooth curve through points with ascending x. */
function spline(points: Array<[number, number]>): (x: number) => number {
  const n = points.length;
  const m: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    m.push((b[1] - a[1]) / (b[0] - a[0]));
  }
  return (x: number) => {
    if (x <= points[0][0]) return points[0][1];
    if (x >= points[n - 1][0]) return points[n - 1][1];
    let i = 0;
    while (x > points[i + 1][0]) i++;
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = x1 - x0;
    const t = (x - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i + 1];
  };
}

function bandTexture(bands: Array<[number, string]>, height = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = height;
  const g = c.getContext('2d')!;
  // Canvas y runs down, texture v runs up.
  for (let i = 0; i < bands.length; i++) {
    const from = bands[i][0];
    const to = i + 1 < bands.length ? bands[i + 1][0] : 1;
    g.fillStyle = bands[i][1];
    g.fillRect(0, Math.round((1 - to) * height), 4, Math.ceil((to - from) * height) + 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Repeatable noise, so the boat looks the same on every machine. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** Laid teak: planks running fore and aft with dark caulking between them. One tile is 0.42 m square. */
function teakTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (g, w, h) => {
    const rnd = seeded(7);
    const planks = 6;
    const pw = w / planks;
    for (let i = 0; i < planks; i++) {
      const tone = 0.86 + rnd() * 0.24;
      g.fillStyle = `rgb(${Math.round(150 * tone)}, ${Math.round(104 * tone)}, ${Math.round(62 * tone)})`;
      g.fillRect(i * pw, 0, pw, h);
      // Grain: long faint streaks along the plank.
      for (let k = 0; k < 26; k++) {
        g.fillStyle = `rgba(${rnd() < 0.5 ? '70, 44, 22' : '205, 160, 108'}, ${0.05 + rnd() * 0.09})`;
        g.fillRect(i * pw + 3 + rnd() * (pw - 6), rnd() * h, 1 + rnd() * 1.5, 30 + rnd() * 120);
      }
      g.fillStyle = '#1d1712';
      g.fillRect(i * pw - 1.5, 0, 3, h);
      // A butt joint somewhere along each plank.
      g.fillRect(i * pw, Math.floor(rnd() * h), pw, 2.5);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 0.42, 1 / 0.42);
  return tex;
}

/** Moulded non-skid: a fine regular stipple. One tile is 0.25 m square. */
function nonSkidTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#c9c7bc';
    g.fillRect(0, 0, w, h);
    const rnd = seeded(11);
    for (let y = 0; y < h; y += 4) {
      for (let x = (y / 4) % 2 ? 2 : 0; x < w; x += 4) {
        g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,250' : '120,118,108'}, ${0.1 + rnd() * 0.12})`;
        g.fillRect(x, y, 2, 2);
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 0.25, 1 / 0.25);
  return tex;
}

export function buildSloop(spec: BoatSpec): SloopModel {
  const d = spec.dimensions;
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

  // ---- hull lines ---------------------------------------------------------------------------------
  const L = d.loa;
  const half = L / 2;
  const B = d.beam / 2;
  const zAt = (t: number) => -half + L * t;
  const halfBeam = (t: number) => {
    if (t <= 0.58) return B * Math.pow(Math.sin((Math.max(t, 0) / 0.58) * (Math.PI / 2)), 0.82);
    const v = (t - 0.58) / 0.42;
    return B - (B - 1.48) * v * v;
  };
  const sheerY = (t: number) => d.freeboard - 0.15 + 0.38 * Math.pow(1 - t, 2.4) + 0.03 * t;
  const keelY = spline([
    [0, 1.3], [0.015, 0.75], [0.04, 0.12], [0.08, -0.16], [0.18, -0.36], [0.33, -0.5],
    [0.5, -0.53], [0.66, -0.45], [0.8, -0.28], [0.92, -0.03], [1, 0.24],
  ]);

  // ---- materials ----------------------------------------------------------------------------------
  const HULL_V0 = -0.8;
  const HULL_VH = 2.4;
  const v = (y: number) => (y - HULL_V0) / HULL_VH;
  const hullMat = new THREE.MeshPhysicalMaterial({
    map: bandTexture([[0, '#5c1d1a'], [v(-0.02), '#e9e6dc'], [v(0.09), '#12233d']]),
    roughness: 0.28, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2,
  });
  const white = new THREE.MeshStandardMaterial({ color: 0xeeece4, roughness: 0.55 });
  // The deck is one skin with three finishes. Double-sided so every bulkhead and coaming face shows.
  const nonSkidMat = new THREE.MeshStandardMaterial({ map: nonSkidTexture(), roughness: 0.92, side: THREE.DoubleSide });
  const gelMat = new THREE.MeshPhysicalMaterial({ color: 0xf2f0e8, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.25, side: THREE.DoubleSide });
  const teakDeckMat = new THREE.MeshStandardMaterial({ map: teakTexture(), roughness: 0.78, side: THREE.DoubleSide });
  const teak = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd4d6, roughness: 0.22, metalness: 1 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xd9dcdc, roughness: 0.42, metalness: 0.65 });
  const black = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1216, roughness: 0.1, metalness: 0.6 });
  const foilMat = new THREE.MeshStandardMaterial({ color: 0x5c1d1a, roughness: 0.6 });

  // ---- hull ---------------------------------------------------------------------------------------
  {
    const NS = 72;
    const NP = 16;
    const W = 2 * NP + 1;
    const pos: number[] = [];
    const uv: number[] = [];
    for (let i = 0; i <= NS; i++) {
      const t = i / NS;
      const b = halfBeam(t);
      const sy = sheerY(t);
      const ky = Math.min(keelY(t), sy - 0.02);
      const n = lerp(1.25, 2.5, smooth(0, 0.4, t));
      for (let j = -NP; j <= NP; j++) {
        const s = Math.abs(j) / NP;
        const th = (s * Math.PI) / 2;
        const x = b * Math.pow(Math.sin(th), 2 / n) * Math.sign(j);
        const y = ky + (sy - ky) * (1 - Math.pow(Math.cos(th), 2 / n));
        pos.push(x, y, zAt(t));
        uv.push(t, v(y));
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < W - 1; j++) {
        const a = i * W + j;
        const c = a + W;
        idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
    // Transom, with its own vertices so the edge stays crisp.
    const base = pos.length / 3;
    const tSy = sheerY(1);
    const tKy = keelY(1);
    pos.push(0, (tSy + tKy) / 2 + 0.2, zAt(1));
    uv.push(1, v(0.6));
    for (let j = 0; j < W; j++) {
      const k = (NS * W + j) * 3;
      pos.push(pos[k], pos[k + 1], pos[k + 2]);
      uv.push(1, v(pos[k + 1]));
    }
    for (let j = 0; j < W - 1; j++) idx.push(base, base + 1 + j, base + 2 + j);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Make sure the skin faces outward: a point on the starboard side amidships must look to starboard.
    const probe = (Math.round(NS / 2) * W + NP + Math.round(NP * 0.7)) * 3;
    if ((g.getAttribute('normal').array as Float32Array)[probe] < 0) {
      for (let i = 0; i < idx.length; i += 3) { const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    const hull = add('hull', new THREE.Mesh(g, hullMat));
    hull.castShadow = true;
    hull.receiveShadow = true;
    solids.push(hull);

    // Cove stripe: a thin gold line that follows the sheer.
    const halfWidthAt = (t: number, y: number) => {
      const sy = sheerY(t);
      const ky = Math.min(keelY(t), sy - 0.02);
      const n = lerp(1.25, 2.5, smooth(0, 0.4, t));
      const c = Math.pow(1 - Math.min(1, Math.max(0, (y - ky) / (sy - ky))), n / 2);
      return halfBeam(t) * Math.pow(Math.sqrt(Math.max(0, 1 - c * c)), 2 / n);
    };
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a558, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const p: number[] = [];
      const ix: number[] = [];
      const N = 70;
      for (let i = 0; i <= N; i++) {
        const t = 0.035 + (0.955 * i) / N;
        for (const drop of [0.105, 0.14]) {
          const y = sheerY(t) - drop;
          p.push(side * (halfWidthAt(t, y) + 0.004), y, zAt(t));
        }
        if (i < N) ix.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      sg.setIndex(ix);
      sg.computeVertexNormals();
      root.add(new THREE.Mesh(sg, gold));
    }

    // Name and hailing port across the transom.
    const nameTex = canvasTexture(1024, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#d9b869';
      c.font = '600 118px Georgia, "Times New Roman", serif';
      c.fillText('SLACK TIDE', w / 2, 92);
      c.font = '500 54px Georgia, "Times New Roman", serif';
      c.fillText('S A U S A L I T O', w / 2, 204);
    });
    const name = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.425), new THREE.MeshStandardMaterial({ map: nameTex, transparent: true, alphaTest: 0.35, roughness: 0.45, metalness: 0.3 }));
    name.position.set(0, (tSy + Math.max(tKy, 0.3)) / 2 + 0.06, zAt(1) + 0.006);
    name.name = 'transom_name';
    root.add(name);
  }

  // ---- deck, cabin and cockpit, lofted as one skin ------------------------------------------------
  const T_CABIN0 = 0.285;
  const T_CABIN1 = 0.655;
  const T_COCK0 = 0.672;
  const T_COCK1 = 0.93;
  type Regime = 'deck' | 'cabin' | 'cockpit';
  const cabinRise = (t: number) => 0.46 * smooth(T_CABIN0, T_CABIN0 + 0.09, t) + 0.05 * smooth(0.4, 0.65, t);
  const cabinHalfWidth = (t: number) => Math.min(halfBeam(t) - 0.42, 1.12);
  const cabinTopY = (t: number) => sheerY(t) + 0.07 + cabinRise(t);
  const SOLE_DROP = 0.5;
  const SEAT_DROP = 0.08;
  const COAMING = 0.2;
  const WELL = 0.5;
  const COAM_IN = 1.0;
  const COAM_OUT = 1.16;

  /** Height of the coachroof at a station and a distance off the centreline: crowned, highest in the middle. */
  const cabinCrownY = (t: number, x: number) => cabinTopY(t) + 0.085 * (1 - Math.min(1, Math.abs(x) / cabinHalfWidth(t)) ** 2);

  const profile = (t: number, regime: Regime): Array<[number, number]> => {
    const b = halfBeam(t);
    const h = sheerY(t);
    if (regime === 'cabin') {
      // A crowned coachroof with a rounded shoulder, sides that lean in a little, and a fillet onto the side deck.
      const cw = cabinHalfWidth(t);
      const rise = Math.min(1, cabinRise(t) / 0.22);
      const edge = cw - 0.1;
      const shoulder = cabinCrownY(t, edge);
      const foot = Math.min(h + 0.07, shoulder - 0.1 * rise);
      return [
        [0, cabinCrownY(t, 0)], [cw * 0.24, cabinCrownY(t, cw * 0.24)], [cw * 0.48, cabinCrownY(t, cw * 0.48)],
        [cw * 0.7, cabinCrownY(t, cw * 0.7)], [cw * 0.86, cabinCrownY(t, cw * 0.86)],
        [edge, shoulder], [cw - 0.04, shoulder - 0.035 * rise], [cw - 0.008, shoulder - 0.1 * rise],
        [cw + 0.025, foot], [cw + 0.06, h + 0.045], [lerp(cw + 0.06, b, 0.55), h + 0.03], [b, h],
      ];
    }
    if (regime === 'cockpit') {
      // Sole, rounded seat fronts, seats, coamings with a capped top.
      const sole = h - SOLE_DROP;
      const seat = h - SEAT_DROP;
      const top = h + COAMING;
      return [
        [0, sole], [WELL - 0.035, sole], [WELL, sole + 0.035], [WELL, seat - 0.025], [WELL + 0.025, seat],
        [COAM_IN - 0.035, seat], [COAM_IN, seat + 0.035], [COAM_IN + 0.02, top - 0.025], [COAM_IN + 0.045, top],
        [COAM_OUT, top], [COAM_OUT + 0.045, h + 0.03], [b, h],
      ];
    }
    const out: Array<[number, number]> = [];
    for (let k = 0; k < 12; k++) out.push([(b * k) / 11, h + 0.07 * (1 - (k / 11) ** 2)]);
    return out;
  };

  {
    const stations: Array<{ t: number; regime: Regime }> = [];
    const span = (a: number, b: number, n: number, regime: Regime) => {
      for (let i = 0; i < n; i++) stations.push({ t: lerp(a, b, i / (n - 1)), regime });
    };
    const e = 0.0004;
    span(0.004, T_CABIN0 - e, 12, 'deck');
    span(T_CABIN0 + e, T_CABIN1 - e, 24, 'cabin');
    span(T_CABIN1 + e, T_COCK0 - e, 2, 'deck');
    span(T_COCK0 + e, T_COCK1 - e, 8, 'cockpit');
    span(T_COCK1 + e, 1, 5, 'deck');

    // Finish of each strip of the skin, counted outward from the centreline: 0 non-skid, 1 gelcoat, 2 teak.
    const finishFor = (regime: Regime, k: number): number => {
      if (regime === 'cabin') return k <= 4 ? 0 : k <= 8 ? 1 : 0;
      if (regime === 'cockpit') return k === 0 || k === 4 || k === 8 ? 2 : k === 10 ? 0 : 1;
      return k === 10 ? 1 : 0;
    };
    const pos: number[][] = [[], [], []];
    const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, finish: number) => {
      for (const p of [a, b, c]) pos[finish].push(p.x, p.y, p.z);
    };
    for (let i = 0; i < stations.length - 1; i++) {
      const s0 = stations[i];
      const s1 = stations[i + 1];
      const p0 = profile(s0.t, s0.regime);
      const p1 = profile(s1.t, s1.regime);
      // Where the profile changes shape between two stations a hair apart, the skin between them is a bulkhead.
      const wall = s0.regime !== s1.regime;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 11; k++) {
          const a = new THREE.Vector3(side * p0[k][0], p0[k][1], zAt(s0.t));
          const b = new THREE.Vector3(side * p0[k + 1][0], p0[k + 1][1], zAt(s0.t));
          const c = new THREE.Vector3(side * p1[k][0], p1[k][1], zAt(s1.t));
          const e2 = new THREE.Vector3(side * p1[k + 1][0], p1[k + 1][1], zAt(s1.t));
          const finish = wall ? 1 : finishFor(s0.regime, k);
          // Wound so every face looks up or outboard.
          if (side > 0) { pushTri(a, c, b, finish); pushTri(b, c, e2, finish); }
          else { pushTri(a, b, c, finish); pushTri(b, e2, c, finish); }
        }
      }
    }
    const all = pos.flat();
    // Textures are laid flat on the deck: one metre of deck is one unit of texture before each map's own repeat.
    const uv = new Float32Array((all.length / 3) * 2);
    for (let i = 0; i < all.length / 3; i++) {
      uv[i * 2] = all[i * 3];
      uv[i * 2 + 1] = all[i * 3 + 2];
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // Smooth across gentle curves such as the coachroof crown, keep hard edges hard.
    g = toCreasedNormals(g, 38 * (Math.PI / 180));
    let start = 0;
    pos.forEach((list, finish) => {
      g.addGroup(start, list.length / 3, finish);
      start += list.length / 3;
    });
    const deck = add('deck', new THREE.Mesh(g, [nonSkidMat, gelMat, teakDeckMat]));
    deck.castShadow = true;
    deck.receiveShadow = true;
    solids.push(deck);
  }

  const tube = (pts: THREE.Vector3[], radius: number, mat: THREE.Material, closed = false): THREE.Mesh => {
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.25);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), radius, 6, closed), mat);
    m.castShadow = true;
    return m;
  };
  const rod = (a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, parent: THREE.Object3D = root): THREE.Mesh => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
    parent.add(m);
    return m;
  };

  // ---- toe rails, stanchions, lifelines, pulpit and pushpit ---------------------------------------
  {
    const rails = new THREE.Group();
    rails.name = 'rails';
    for (const side of [-1, 1]) {
      const sheer: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = 0.01 + (0.99 * i) / 40;
        sheer.push(new THREE.Vector3(side * (halfBeam(t) - 0.015), sheerY(t) + 0.025, zAt(t)));
      }
      rails.add(tube(sheer, 0.022, teak));
      const tops: THREE.Vector3[] = [];
      const mids: THREE.Vector3[] = [];
      for (let t = 0.14; t <= 0.93; t += 0.113) {
        const base = new THREE.Vector3(side * (halfBeam(t) - 0.07), sheerY(t), zAt(t));
        const top = base.clone().add(new THREE.Vector3(-side * 0.02, 0.62, 0));
        rod(base, top, 0.011, steel, rails).castShadow = true;
        tops.push(top);
        mids.push(base.clone().lerp(top, 0.52));
      }
      // Pulpit at the bow, pushpit at the stern.
      const bowTop = new THREE.Vector3(0, sheerY(0) + 0.66, zAt(0.004));
      const sternCorner = new THREE.Vector3(side * (halfBeam(1) - 0.08), sheerY(1) + 0.62, zAt(0.995));
      const sternMid = new THREE.Vector3(0, sheerY(1) + 0.62, zAt(0.998));
      rails.add(tube([bowTop, new THREE.Vector3(side * 0.34, sheerY(0.06) + 0.64, zAt(0.06)), tops[0]], 0.013, steel));
      rod(new THREE.Vector3(side * 0.3, sheerY(0.05), zAt(0.05)), new THREE.Vector3(side * 0.3, sheerY(0.05) + 0.64, zAt(0.055)), 0.013, steel, rails);
      rails.add(tube([tops[tops.length - 1], sternCorner, sternMid], 0.013, steel));
      rod(new THREE.Vector3(sternCorner.x, sheerY(1), sternCorner.z), sternCorner, 0.013, steel, rails);
      rails.add(tube(tops, 0.005, steel));
      rails.add(tube(mids, 0.004, steel));
    }
    root.add(rails);
  }

  // ---- keel and rudder ----------------------------------------------------------------------------
  {
    const keel = add('keel', new THREE.Group());
    const fin = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.72, 1.5, 20), foilMat);
    fin.scale.set(0.09, 1, 0.85);
    fin.position.set(0, -1.2, -0.35);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), foilMat);
    bulb.scale.set(0.2, 0.18, 1.15);
    bulb.position.set(0, -d.draft + 0.16, -0.25);
    keel.add(fin, bulb);

    const rudder = add('rudder', new THREE.Group());
    rudder.position.set(0, 0, zAt(0.9));
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.6, 1.55, 16), foilMat);
    blade.scale.set(0.05, 1, 0.3);
    blade.position.set(0, -0.82, 0.12);
    rudder.add(blade);
  }

  // ---- mast and standing rigging ------------------------------------------------------------------
  const mastZ = zAt(0) + d.mastFromBow;
  const mastT = d.mastFromBow / L;
  const mastBaseY = cabinTopY(mastT) + 0.05;
  const mastTopY = d.mastHeight;
  const hounds = new THREE.Vector3(0, d.forestayHeight, mastZ - 0.1);
  const stem = new THREE.Vector3(0, sheerY(0.012) + 0.08, zAt(0.012));
  {
    const mastGroup = add('mast', new THREE.Group());
    const h = mastTopY - mastBaseY;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.105, h, 14), alloy);
    mast.scale.z = 1.4;
    mast.position.set(0, mastBaseY + h / 2, mastZ);
    mast.castShadow = true;
    mastGroup.add(mast);
    solids.push(mast);
    proxy('mast', new THREE.CylinderGeometry(0.3, 0.3, 4.5, 8), mastGroup, new THREE.Vector3(0, mastBaseY + 3.6, mastZ));

    const chain = (side: number) => new THREE.Vector3(side * (halfBeam(mastT + 0.02) - 0.1), sheerY(mastT) + 0.03, mastZ + 0.28);
    const spreaders = [{ y: mastBaseY + (mastTopY - mastBaseY) * 0.34, w: 0.98 }, { y: mastBaseY + (mastTopY - mastBaseY) * 0.64, w: 0.74 }];
    for (const side of [-1, 1]) {
      const tips = spreaders.map((s) => new THREE.Vector3(side * s.w, s.y, mastZ + 0.2));
      spreaders.forEach((s, i) => {
        const sp = rod(new THREE.Vector3(0, s.y, mastZ), tips[i], 0.022, alloy, mastGroup);
        sp.scale.z = 2.2;
        sp.castShadow = true;
        // Boots on the spreader ends, to save the genoa from chafe.
        const boot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), white);
        boot.position.copy(tips[i]);
        mastGroup.add(boot);
      });
      const capTop = new THREE.Vector3(side * 0.06, hounds.y - 0.15, mastZ);
      rod(chain(side), tips[0], 0.006, steel, mastGroup);
      rod(tips[0], tips[1], 0.006, steel, mastGroup);
      rod(tips[1], capTop, 0.006, steel, mastGroup);
      rod(chain(side).add(new THREE.Vector3(0, 0, -0.18)), new THREE.Vector3(side * 0.06, spreaders[0].y - 0.1, mastZ), 0.006, steel, mastGroup);
    }
    rod(stem, hounds, 0.007, steel, mastGroup);
    rod(new THREE.Vector3(0, mastTopY - 0.05, mastZ + 0.1), new THREE.Vector3(0, sheerY(1) + 0.05, zAt(0.995)), 0.006, steel, mastGroup);

    // Masthead: VHF whip, wind transducer on its arm, tricolour light. Steaming light and a radar reflector lower down.
    rod(new THREE.Vector3(0.07, mastTopY, mastZ + 0.1), new THREE.Vector3(0.09, mastTopY + 0.95, mastZ + 0.13), 0.005, black, mastGroup);
    rod(new THREE.Vector3(0, mastTopY, mastZ - 0.05), new THREE.Vector3(0, mastTopY + 0.14, mastZ - 0.5), 0.008, alloy, mastGroup);
    const cups = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), black);
    cups.position.set(0, mastTopY + 0.17, mastZ - 0.5);
    const tricolour = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10), new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.2, emissive: 0x30383c }));
    tricolour.position.set(-0.06, mastTopY + 0.04, mastZ + 0.02);
    const steaming = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.06), black);
    steaming.position.set(0, mastBaseY + h * 0.46, mastZ - 0.14);
    const reflector = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 10), white);
    reflector.position.set(0, mastBaseY + h * 0.53, mastZ - 0.17);
    mastGroup.add(cups, tricolour, steaming, reflector);

    // Masthead wind vane. It turns to show where the apparent wind comes from.
    const windex = add('windex', new THREE.Group(), mastGroup);
    windex.position.set(0, mastTopY + 0.32, mastZ);
    rod(new THREE.Vector3(0, -0.32, 0), new THREE.Vector3(0, 0, 0), 0.008, steel, windex);
    const vaneMat = new THREE.MeshStandardMaterial({ color: 0xd9381e, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x3a0a04 });
    const arrow = add('windex_arrow', new THREE.Group(), windex);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.62), black);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.26), vaneMat);
    fin.position.set(0, 0, 0.3);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 8), vaneMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0, -0.36);
    arrow.add(shaft, fin, tip);

    // Mast display. Its face is a canvas the instruments draw on.
    const display = add('mast_display', new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.05), [black, black, black, black, new THREE.MeshBasicMaterial({ color: 0x0a1a1f }), black]), mastGroup);
    display.position.set(0, mastBaseY + 1.72, mastZ + 0.19);
  }

  // ---- boom ---------------------------------------------------------------------------------------
  const gooseneck = new THREE.Vector3(0, mastBaseY + d.boomHeight - 0.25, mastZ + 0.15);
  {
    const boom = add('boom', new THREE.Group());
    boom.position.copy(gooseneck);
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, d.boomLength, 12), alloy);
    spar.rotation.x = Math.PI / 2;
    spar.scale.z = 1.55; // taller than wide, after the rotation this is the vertical axis
    spar.position.z = d.boomLength / 2;
    spar.castShadow = true;
    spar.userData.glow = true;
    boom.add(spar);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), black);
    cap.position.z = d.boomLength;
    boom.add(cap);
    proxy('boom', new THREE.BoxGeometry(0.7, 0.85, d.boomLength + 0.3), boom, new THREE.Vector3(0, 0.05, d.boomLength / 2));
    solids.push(spar);

    // Stack pack: the sail cover lies open along both sides of the boom while the main is set.
    // Lazy jacks hold it up and lead to the mast. They ride with the boom, which pivots almost on the mast.
    const cover = new THREE.MeshStandardMaterial({ color: 0x1b2d4a, roughness: 0.95, side: THREE.DoubleSide });
    const jackTop = new THREE.Vector3(0, mastBaseY + (mastTopY - mastBaseY) * 0.34 - gooseneck.y - 0.1, -0.13);
    for (const side of [-1, 1]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.27, d.boomLength - 0.55), cover);
      flap.position.set(side * 0.105, 0.17, d.boomLength / 2 + 0.05);
      flap.rotation.z = -side * 0.22;
      flap.castShadow = true;
      boom.add(flap);
      const batten = rod(new THREE.Vector3(side * 0.135, 0.305, 0.35), new THREE.Vector3(side * 0.135, 0.305, d.boomLength - 0.25), 0.012, cover, boom);
      batten.castShadow = true;
      const top = jackTop.clone().setX(side * 0.05);
      const mid = new THREE.Vector3(side * 0.12, 1.55, d.boomLength * 0.42);
      rod(top, mid, 0.003, white, boom);
      for (const f of [0.26, 0.52, 0.8]) rod(mid, new THREE.Vector3(side * 0.135, 0.31, d.boomLength * f), 0.003, white, boom);
    }
    // Gooseneck fitting and the outhaul car at the clew.
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.12), steel);
    neck.position.set(0, 0, -0.04);
    const outhaul = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.14), black);
    outhaul.position.set(0, 0.12, d.boomLength - 0.3);
    boom.add(neck, outhaul);
  }

  // ---- cockpit: wheel, pedestal, winches ----------------------------------------------------------
  const tWheel = 0.845;
  const soleY = sheerY(tWheel) - SOLE_DROP;
  const wheelPos = new THREE.Vector3(0, soleY + 0.98, zAt(tWheel));
  {
    const pedestal = new THREE.Group();
    pedestal.name = 'pedestal';
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.98, 12), white);
    post.position.set(0, soleY + 0.49, wheelPos.z - 0.14);
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.12), white);
    pod.position.set(0, soleY + 1.12, wheelPos.z - 0.16);
    pod.rotation.x = -0.35;
    const screen = add('chartplotter', new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.15), new THREE.MeshBasicMaterial({ color: 0x0d2f3a })), pedestal);
    screen.position.set(0, soleY + 1.135, wheelPos.z - 0.1);
    screen.rotation.x = -0.35;
    // Binnacle: the steering compass in its housing on top of the pedestal, under a dome.
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.085, 0.07, 18), white);
    housing.position.set(0, soleY + 1.255, wheelPos.z - 0.2);
    const card = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 18), new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.4 }));
    card.position.set(0, soleY + 1.295, wheelPos.z - 0.2);
    const lubber = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.004, 0.14), new THREE.MeshBasicMaterial({ color: 0xe8e4d8 }));
    lubber.position.set(0, soleY + 1.303, wheelPos.z - 0.2);
    const compass = new THREE.Mesh(
      new THREE.SphereGeometry(0.088, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0x9fb4bd, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    compass.position.set(0, soleY + 1.29, wheelPos.z - 0.2);
    // Guard rail over the binnacle: something to hold on to, and it keeps sheets off the compass.
    const guard = tube([
      new THREE.Vector3(-0.2, soleY, wheelPos.z - 0.32), new THREE.Vector3(-0.2, soleY + 1.0, wheelPos.z - 0.34),
      new THREE.Vector3(-0.14, soleY + 1.4, wheelPos.z - 0.36), new THREE.Vector3(0.14, soleY + 1.4, wheelPos.z - 0.36),
      new THREE.Vector3(0.2, soleY + 1.0, wheelPos.z - 0.34), new THREE.Vector3(0.2, soleY, wheelPos.z - 0.32),
    ], 0.014, steel);
    // Engine control on the starboard side of the pedestal.
    const lever = add('engine_lever', new THREE.Group(), pedestal);
    lever.position.set(0.1, soleY + 0.78, wheelPos.z - 0.14);
    const leverBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12).rotateZ(Math.PI / 2), steel);
    rod(new THREE.Vector3(0.02, 0, 0), new THREE.Vector3(0.03, 0.15, -0.03), 0.008, steel, lever);
    const leverKnob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), black);
    leverKnob.position.set(0.03, 0.16, -0.03);
    lever.add(leverBase, leverKnob);
    pedestal.add(post, pod, housing, card, lubber, compass, guard);
    pedestal.traverse((o) => { o.castShadow = true; });
    root.add(pedestal);

    const wheel = add('wheel', new THREE.Group());
    wheel.position.copy(wheelPos);
    const R = 0.52;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.021, 10, 48), steel);
    rim.userData.glow = true;
    wheel.add(rim);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spoke = rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.sin(a) * R, Math.cos(a) * R, 0), 0.011, steel, wheel);
      spoke.userData.glow = true;
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.09, 14), steel);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    // King spoke marker: when it is on top, the rudder is amidships.
    const king = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.014, 8, 14), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.7 }));
    king.position.set(0, R, 0);
    king.rotation.y = Math.PI / 2;
    wheel.add(king);
    wheel.traverse((o) => { o.castShadow = true; });
    proxy('wheel', new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.34, 20).rotateX(Math.PI / 2), wheel);
  }

  const tWinch = 0.76;
  const winchY = sheerY(tWinch) + COAMING;
  const winchX = (COAM_IN + COAM_OUT) / 2;
  const winchAt = (side: number) => new THREE.Vector3(side * winchX, winchY, zAt(tWinch));
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
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.075, 0.03, 20), steel);
    top.position.y = 0.18;
    top.userData.glow = true;
    const jaws = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.016, 20), black);
    jaws.position.y = 0.158;
    // A socket mark on top so the drum can be seen turning.
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.11), black);
    socket.position.y = 0.198;
    drum.add(barrel, top, jaws, socket);
    winch.add(baseM);
    winch.traverse((o) => { o.castShadow = true; });
    proxy(name, new THREE.SphereGeometry(0.3, 10, 8), winch, new THREE.Vector3(0, 0.12, 0));
  }

  // Jib sheet cars on the side decks.
  const tCar = 0.56;
  const carAt = (side: number) => new THREE.Vector3(side * (cabinHalfWidth(tCar) + 0.2), sheerY(tCar) + 0.09, zAt(tCar));
  for (const side of [-1, 1]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, 1.5), black);
    track.position.copy(carAt(side)).add(new THREE.Vector3(0, -0.05, 0));
    const car = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.12), steel);
    car.position.copy(carAt(side));
    root.add(track, car);
  }

  // ---- foredeck: furler ---------------------------------------------------------------------------
  const jibTack = stem.clone().lerp(hounds, 0.035);
  const jibHead = stem.clone().lerp(hounds, 0.94);
  {
    const furler = add('furler', new THREE.Group());
    furler.position.copy(stem.clone().lerp(hounds, 0.018));
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.12, 16), black);
    drum.userData.glow = true;
    furler.add(drum);
    proxy('furler', new THREE.SphereGeometry(0.32, 10, 8), furler);
  }

  // ---- cabin details ------------------------------------------------------------------------------
  const bulkheadZ = zAt(T_CABIN1) + 0.014;
  const bulkheadY = sheerY(T_CABIN1);
  {
    const details = new THREE.Group();
    details.name = 'cabin_details';
    const smoked = new THREE.MeshStandardMaterial({ color: 0x25313a, roughness: 0.2, metalness: 0.3 });
    // Companionway: a dark opening in the back of the cabin with teak trim, and a sliding hatch above.
    const ch = cabinCrownY(T_CABIN1, 0) - bulkheadY;
    const way = new THREE.Mesh(new THREE.PlaneGeometry(0.6, ch * 0.9), glass);
    way.position.set(0, bulkheadY + ch * 0.5, bulkheadZ);
    for (const side of [-1, 1]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.035, ch * 0.92, 0.03), teak);
      trim.position.set(side * 0.318, bulkheadY + ch * 0.5, bulkheadZ + 0.01);
      details.add(trim);
    }
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.035, 0.8), smoked);
    hatch.position.set(0, cabinCrownY(T_CABIN1 - 0.035, 0) + 0.022, zAt(T_CABIN1 - 0.036));
    details.add(way, hatch);
    // Portlights along the cabin sides: smoked glass in bright frames.
    for (const side of [-1, 1]) {
      for (const t of [0.42, 0.5, 0.58]) {
        const cw = cabinHalfWidth(t);
        const port = new THREE.Group();
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.15, 0.56), steel);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.115, 0.52), glass);
        port.add(frame, pane);
        port.position.set(side * (cw + 0.006), lerp(sheerY(t) + 0.07, cabinCrownY(t, cw - 0.1) - 0.1, 0.5), zAt(t));
        port.rotation.z = side * 0.1;
        port.rotation.y = -side * Math.atan2(cabinHalfWidth(t + 0.02) - cabinHalfWidth(t - 0.02), L * 0.04);
        details.add(port);
      }
    }
    // Foredeck hatch.
    const fh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.55), smoked);
    fh.position.set(0, sheerY(0.2) + 0.09, zAt(0.2));
    const fhFrame = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.03, 0.61), alloy);
    fhFrame.position.set(0, sheerY(0.2) + 0.075, zAt(0.2));
    details.add(fh, fhFrame);

    // Teak handrails along the coachroof.
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let t = 0.4; t <= 0.601; t += 0.04) {
        const x = side * (cabinHalfWidth(t) - 0.3);
        const foot = new THREE.Vector3(x, cabinCrownY(t, x), zAt(t));
        pts.push(foot.clone().setY(foot.y + 0.075));
        rod(foot, pts[pts.length - 1], 0.014, teak, details);
      }
      details.add(tube(pts, 0.017, teak));
    }

    // Halyards and reefing lines lead aft over the coachroof, through clutches, to a winch each side of the hatch.
    const tails = [0xb5332a, 0x2a56a0, 0xe8e4d8];
    for (const side of [-1, 1]) {
      const wx = side * 0.5;
      const wt = T_CABIN1 - 0.022;
      const winch = new THREE.Group();
      winch.position.set(wx, cabinCrownY(wt, wx), zAt(wt));
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.1, 16), steel);
      drum.position.y = 0.06;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.055, 0.025, 16), steel);
      cap.position.y = 0.122;
      winch.add(drum, cap);
      const ct = T_CABIN1 - 0.052;
      const clutch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.13), black);
      clutch.position.set(wx, cabinCrownY(ct, wx) + 0.03, zAt(ct));
      details.add(winch, clutch);
      tails.forEach((colour, i) => {
        const from = new THREE.Vector3(side * (0.09 + i * 0.03), mastBaseY + 0.06, mastZ + 0.2);
        const to = new THREE.Vector3(wx + (i - 1) * 0.06, cabinCrownY(ct, wx) + 0.05, zAt(ct) - 0.06);
        const mid = from.clone().lerp(to, 0.5);
        mid.y = cabinCrownY((mid.z - zAt(0)) / L, mid.x) + 0.035;
        const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 });
        rod(from, mid, 0.006, mat, details);
        rod(mid, to, 0.006, mat, details);
      });
    }

    // Dodger: a canvas spray hood on a bright hoop over the companionway, with a clear window to see forward.
    const canvasCloth = new THREE.MeshStandardMaterial({ color: 0x1b2d4a, roughness: 0.95, side: THREE.DoubleSide });
    const vinyl = new THREE.MeshPhysicalMaterial({ color: 0x8fa6b2, roughness: 0.06, metalness: 0.25, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const zAft = zAt(T_CABIN1) + 0.1;
    const zFore = zAft - 1.2;
    const DODGER_HALF = 0.98;
    const dodgerPoint = (u: number, v: number, lift: number): [number, number, number] => {
      const x = DODGER_HALF * u;
      const z = lerp(zFore, zAft, v) - 0.24 * (1 - u * u) * Math.pow(1 - v, 1.5);
      const t = Math.min(T_CABIN1 - 0.002, (z - zAt(0)) / L);
      const rise = 0.56 * (1 - Math.pow(1 - v, 2.2)) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 4)));
      return [x, cabinCrownY(t, x) + rise + lift, z];
    };
    const patch = (u0: number, u1: number, v0: number, v1: number, nu: number, nv: number, lift: number, mat: THREE.Material) => {
      const p: number[] = [];
      const ix: number[] = [];
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) p.push(...dodgerPoint(lerp(u0, u1, i / nu), lerp(v0, v1, j / nv), lift));
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i;
        ix.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setIndex(ix);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = mat === canvasCloth;
      return m;
    };
    const dodger = new THREE.Group();
    dodger.name = 'dodger';
    nodes.dodger = dodger;
    dodger.add(patch(-1, 1, 0, 1, 20, 9, 0, canvasCloth), patch(-0.66, 0.66, 0.16, 0.6, 10, 4, 0.012, vinyl));
    const hoop: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) hoop.push(new THREE.Vector3(...dodgerPoint(-1 + (2 * i) / 14, 1, 0.005)));
    dodger.add(tube(hoop, 0.014, steel));
    details.add(dodger);

    // Instruments on the aft face of the cabin, to port of the companionway.
    const dialTex = (label: string, value: string, unit: string) => canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#071216';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#6fa8b6';
      g.font = '600 17px ui-sans-serif, system-ui, sans-serif';
      g.fillText(label, 10, 24);
      g.textAlign = 'right';
      g.fillText(unit, w - 10, h - 12);
      g.fillStyle = '#eafcff';
      g.font = '700 50px ui-sans-serif, system-ui, sans-serif';
      g.fillText(value, w - 10, 86);
    });
    [['DEPTH', '24.0', 'm'], ['SPEED', '5.8', 'kt']].forEach(([label, value, unit], i) => {
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.135, 0.03), black);
      bezel.position.set(-0.5 - i * 0.16, bulkheadY + 0.33, bulkheadZ + 0.012);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.108, 0.108), new THREE.MeshBasicMaterial({ map: dialTex(label, value, unit), toneMapped: false }));
      face.position.set(bezel.position.x, bezel.position.y, bulkheadZ + 0.0285);
      details.add(bezel, face);
    });
    root.add(details);
  }

  // Autopilot control head, to starboard of the companionway. Its screen is drawn by the boat view.
  {
    const pilot = add('autopilot', new THREE.Group());
    pilot.position.set(0.8, bulkheadY + 0.33, bulkheadZ + 0.02);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.04), black);
    body.userData.glow = true;
    const screen = add('autopilot_screen', new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.11), new THREE.MeshBasicMaterial({ color: 0x0a1a1f })), pilot);
    screen.position.set(-0.04, 0.012, 0.0212);
    const knob = add('autopilot_knob', new THREE.Group(), pilot);
    knob.position.set(0.082, 0.01, 0.02);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.038, 0.03, 20).rotateX(Math.PI / 2), steel);
    dial.position.z = 0.015;
    dial.userData.glow = true;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.022, 0.004), black);
    tick.position.set(0, 0.02, 0.031);
    knob.add(dial, tick);
    pilot.add(body);
    proxy('autopilot', new THREE.BoxGeometry(0.45, 0.42, 0.3), pilot, new THREE.Vector3(0, 0, 0.12));
  }

  // ---- ground tackle, safety gear and the ensign --------------------------------------------------
  {
    const gear = new THREE.Group();
    gear.name = 'deck_gear';
    const galv = new THREE.MeshStandardMaterial({ color: 0x9aa0a3, roughness: 0.55, metalness: 0.7 });
    // Bow roller with a plough anchor stowed in it.
    const bowY = sheerY(0) + 0.05;
    const roller = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.46), steel);
    roller.position.set(0, bowY, zAt(0) + 0.13);
    const shank = rod(new THREE.Vector3(0, bowY + 0.05, zAt(0) + 0.5), new THREE.Vector3(0, bowY + 0.02, zAt(0) - 0.14), 0.02, galv, gear);
    shank.castShadow = true;
    const fluke = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.46, 4), galv);
    fluke.scale.set(1, 1, 0.42);
    fluke.position.set(0, bowY - 0.2, zAt(0) - 0.1);
    fluke.rotation.x = 2.5;
    fluke.castShadow = true;
    gear.add(roller, fluke);
    // Mooring cleats at the bow and on each quarter.
    for (const side of [-1, 1]) {
      for (const t of [0.07, 0.955]) {
        const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.22), steel);
        cleat.position.set(side * (halfBeam(t) - 0.17), sheerY(t) + 0.06, zAt(t));
        gear.add(cleat);
      }
    }
    // Horseshoe lifebuoy on the starboard quarter of the pushpit.
    const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.058, 8, 18, Math.PI * 1.45), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.7 }));
    buoy.position.set(halfBeam(0.975) - 0.09, sheerY(1) + 0.4, zAt(0.972));
    buoy.rotation.set(0, Math.PI / 2 - 0.25, Math.PI * 0.275 + Math.PI);
    buoy.castShadow = true;
    gear.add(buoy);
    // Ensign staff on the port quarter. The flag itself is moved by the boat view so it streams in the apparent wind.
    // It stands right out on the corner and stays short, so the flag never hangs across the view from the helm.
    const staffFoot = new THREE.Vector3(-(halfBeam(1) - 0.1), sheerY(1) + 0.5, zAt(0.994));
    const staffTop = staffFoot.clone().add(new THREE.Vector3(-0.08, 0.82, 0.24));
    rod(staffFoot, staffTop, 0.012, teak, gear).castShadow = true;
    const truck = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc9a558, roughness: 0.4, metalness: 0.6 }));
    truck.position.copy(staffTop);
    gear.add(truck);
    const ensign = add('ensign', new THREE.Group(), gear);
    ensign.position.copy(staffTop).add(new THREE.Vector3(0, -0.03, 0));
    const FLY = 0.6;
    const HOIST = 0.36;
    const flagGeom = new THREE.PlaneGeometry(FLY, HOIST, 12, 5);
    flagGeom.translate(FLY / 2, -HOIST / 2, 0);
    const flagTex = canvasTexture(256, 152, (g, w, h) => {
      // A yacht ensign: thirteen stripes, and a ring of stars round an anchor in the canton.
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
      g.fillRect(cx - 1.5, cy - 14, 3, 26);
      g.fillRect(cx - 8, cy - 9, 16, 3);
      g.beginPath();
      g.arc(cx, cy + 4, 10, 0.15, Math.PI - 0.15);
      g.lineWidth = 3;
      g.strokeStyle = '#f3f1ea';
      g.stroke();
    });
    const flag = add('ensign_flag', new THREE.Mesh(flagGeom, new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.9, emissive: 0x2a2a2a })), ensign);
    flag.castShadow = true;
    flag.userData.fly = FLY;
    flag.userData.hoist = HOIST;
    root.add(gear);
  }

  const tTrav = 0.79;
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
    jibClewY: sheerY(0.5) + 0.95,
    carPort: carAt(-1),
    carStbd: carAt(1),
    winchPort: winchAt(-1).add(new THREE.Vector3(0, 0.1, 0)),
    winchStbd: winchAt(1).add(new THREE.Vector3(0, 0.1, 0)),
    traveller: new THREE.Vector3(0, sheerY(tTrav) - SEAT_DROP + 0.04, zAt(tTrav)),
    vangBase: new THREE.Vector3(0, mastBaseY + 0.12, mastZ + 0.16),
    wheel: wheelPos,
    cockpitSoleY: soleY,
  };

  // The traveller: a beam across the cockpit that the mainsheet leads to.
  {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(COAM_IN * 2, 0.05, 0.09), black);
    beam.position.copy(geo.traveller).add(new THREE.Vector3(0, -0.03, 0));
    const car = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.11), steel);
    car.position.copy(geo.traveller).add(new THREE.Vector3(0, 0.02, 0));
    const block = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12).rotateZ(Math.PI / 2), black);
    block.position.copy(geo.traveller).add(new THREE.Vector3(0, 0.1, 0));
    root.add(beam, car, block);
  }

  return { root, nodes, hitProxies, solids, geo };
}
