import * as THREE from 'three';
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
  // Double-sided so every bulkhead and coaming face shows, whichever way the lofted skin happens to wind.
  const deckMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });
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

  const profile = (t: number, regime: Regime): Array<[number, number]> => {
    const b = halfBeam(t);
    const h = sheerY(t);
    if (regime === 'cabin') {
      const cw = cabinHalfWidth(t);
      const top = cabinTopY(t);
      return [
        [0, top + 0.05], [cw * 0.5, top + 0.04], [cw * 0.85, top + 0.015], [cw - 0.05, top - 0.02],
        [cw, h + 0.04], [lerp(cw, b, 0.33), h + 0.035], [lerp(cw, b, 0.66), h + 0.02], [b, h],
      ];
    }
    if (regime === 'cockpit') {
      const sole = h - SOLE_DROP;
      const seat = h - SEAT_DROP;
      const top = h + COAMING;
      return [[0, sole], [WELL, sole], [WELL, seat], [COAM_IN, seat], [COAM_IN, top], [COAM_OUT, top], [COAM_OUT + 0.03, h + 0.02], [b, h]];
    }
    const out: Array<[number, number]> = [];
    for (let k = 0; k < 8; k++) out.push([(b * k) / 7, h + 0.07 * (1 - (k / 7) ** 2)]);
    return out;
  };

  {
    const stations: Array<{ t: number; regime: Regime }> = [];
    const span = (a: number, b: number, n: number, regime: Regime) => {
      for (let i = 0; i < n; i++) stations.push({ t: lerp(a, b, i / (n - 1)), regime });
    };
    const e = 0.0004;
    span(0.004, T_CABIN0 - e, 12, 'deck');
    span(T_CABIN0 + e, T_CABIN1 - e, 22, 'cabin');
    span(T_CABIN1 + e, T_COCK0 - e, 2, 'deck');
    span(T_COCK0 + e, T_COCK1 - e, 8, 'cockpit');
    span(T_COCK1 + e, 1, 5, 'deck');

    const NONSKID = new THREE.Color(0xc9c7bd);
    const GEL = new THREE.Color(0xf1efe7);
    const TEAK = new THREE.Color(0x8f6238);
    const colourFor = (regime: Regime, k: number): THREE.Color => {
      if (regime === 'cabin') return k <= 2 ? NONSKID : k === 3 ? GEL : NONSKID;
      if (regime === 'cockpit') return k === 0 || k === 2 || k === 4 ? TEAK : k === 6 ? NONSKID : GEL;
      return NONSKID;
    };

    const pos: number[] = [];
    const col: number[] = [];
    const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, colour: THREE.Color) => {
      for (const p of [a, b, c]) {
        pos.push(p.x, p.y, p.z);
        col.push(colour.r, colour.g, colour.b);
      }
    };
    for (let i = 0; i < stations.length - 1; i++) {
      const s0 = stations[i];
      const s1 = stations[i + 1];
      const p0 = profile(s0.t, s0.regime);
      const p1 = profile(s1.t, s1.regime);
      // Where the profile changes shape between two stations a hair apart, the skin between them is a bulkhead.
      const wall = s0.regime !== s1.regime;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 7; k++) {
          const a = new THREE.Vector3(side * p0[k][0], p0[k][1], zAt(s0.t));
          const b = new THREE.Vector3(side * p0[k + 1][0], p0[k + 1][1], zAt(s0.t));
          const c = new THREE.Vector3(side * p1[k][0], p1[k][1], zAt(s1.t));
          const e2 = new THREE.Vector3(side * p1[k + 1][0], p1[k + 1][1], zAt(s1.t));
          const colour = wall ? GEL : colourFor(s0.regime, k);
          if (side > 0) { pushTri(a, c, b, colour); pushTri(b, c, e2, colour); }
          else { pushTri(a, b, c, colour); pushTri(b, e2, c, colour); }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const deck = add('deck', new THREE.Mesh(g, deckMat));
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
      });
      const capTop = new THREE.Vector3(side * 0.06, hounds.y - 0.15, mastZ);
      rod(chain(side), tips[0], 0.006, steel, mastGroup);
      rod(tips[0], tips[1], 0.006, steel, mastGroup);
      rod(tips[1], capTop, 0.006, steel, mastGroup);
      rod(chain(side).add(new THREE.Vector3(0, 0, -0.18)), new THREE.Vector3(side * 0.06, spreaders[0].y - 0.1, mastZ), 0.006, steel, mastGroup);
    }
    rod(stem, hounds, 0.007, steel, mastGroup);
    rod(new THREE.Vector3(0, mastTopY - 0.05, mastZ + 0.1), new THREE.Vector3(0, sheerY(1) + 0.05, zAt(0.995)), 0.006, steel, mastGroup);

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
    const compass = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    compass.position.set(0, soleY + 1.24, wheelPos.z - 0.2);
    pedestal.add(post, pod, compass);
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
  {
    const details = new THREE.Group();
    details.name = 'cabin_details';
    // Companionway: a dark opening in the back of the cabin, with a sliding hatch above.
    const cz = zAt(T_CABIN1) + 0.012;
    const ch = cabinTopY(T_CABIN1) - sheerY(T_CABIN1);
    const way = new THREE.Mesh(new THREE.PlaneGeometry(0.62, ch * 0.9), glass);
    way.position.set(0, sheerY(T_CABIN1) + ch * 0.52, cz);
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.035, 0.8), new THREE.MeshStandardMaterial({ color: 0x25313a, roughness: 0.25, metalness: 0.3 }));
    hatch.position.set(0, cabinTopY(T_CABIN1 - 0.035) + 0.065, zAt(T_CABIN1 - 0.036));
    details.add(way, hatch);
    // Portlights along the cabin sides.
    for (const side of [-1, 1]) {
      for (const t of [0.42, 0.5, 0.58]) {
        const port = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.13, 0.55), glass);
        const cw = cabinHalfWidth(t);
        port.position.set(side * (cw - 0.022), lerp(sheerY(t) + 0.04, cabinTopY(t) - 0.02, 0.55), zAt(t));
        port.rotation.z = side * 0.105;
        port.rotation.y = -side * Math.atan2(cabinHalfWidth(t + 0.02) - cabinHalfWidth(t - 0.02), L * 0.04);
        details.add(port);
      }
    }
    // Foredeck hatch.
    const fh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.55), new THREE.MeshStandardMaterial({ color: 0x25313a, roughness: 0.25, metalness: 0.3 }));
    fh.position.set(0, sheerY(0.2) + 0.09, zAt(0.2));
    details.add(fh);
    root.add(details);
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
    root.add(beam);
  }

  return { root, nodes, hitProxies, solids, geo };
}
