import * as THREE from 'three';
import type { BoatSpec } from '@slack-tide/sim';
import { bandTexture, brightness, canvasTexture, nonSkidTexture, spline, type BoatDisplay, type Livery, type SloopGeometry, type SloopModel } from './buildSloop';

/**
 * A centre console built in code from a boat file: the classic open fishing boat of about 22 feet. A deep-V hull with a
 * raked, flared bow and a sheer that rises forward; a self-bailing cockpit inside a moulded liner; the console
 * amidships with its wheel, throttle, plotter and windscreen under a T-top that carries rocket launchers, folded
 * outriggers, an aerial and the all-round light; a leaning post behind the helm, a cooler seat ahead of it, a low
 * bow rail, rods in the gunwale holders, and one outboard on the transom. No make and no badge anywhere on her.
 *
 * Boat frame as for the others: +X starboard, +Y up, -Z forward, origin on the waterline amidships. It returns the same
 * shape of model, so whatever draws or works a boat takes her as she is, but she has no rig: the nodes a sailing boat
 * has for one (`boom`, `winch_port`, `furler`, `mast_display` and the rest) are not there, and `BoatView` does not
 * ask for them of a boat with `power`.
 *
 * Named nodes of her own: `outboard` (turns with the wheel), `outboard_tilt` (kicks up when she is made fast), `prop`,
 * `throttle` (the lever), `plotter_screen`, `bow_roller` (where the anchor rode leaves her), `tender_stow` (the rack on
 * the T-top the kayak is carried on), and the rod holders that
 * trolling will fish from: `rod_port`, `rod_stbd` (the after gunwale holders), `rod_port_fwd`, `rod_stbd_fwd`, and
 * `rod_ttop_1` to `rod_ttop_5` across the back of the T-top. Each holder is a group whose own +Y runs up the rod, with
 * a child named `rod` where one is standing in it.
 */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

/** Names of the rod holders, for whoever fishes from them. */
export const ROD_HOLDERS = ['rod_port', 'rod_stbd', 'rod_port_fwd', 'rod_stbd_fwd', 'rod_ttop_1', 'rod_ttop_2', 'rod_ttop_3', 'rod_ttop_4', 'rod_ttop_5'] as const;

export function buildConsole(spec: BoatSpec, livery: Livery = {}): SloopModel {
  const d = spec.dimensions;
  const display = spec as BoatSpec & Partial<BoatDisplay>;
  const topsides = livery.topsides ?? display.topsides ?? '#f1efe8';
  const boatName = (livery.name ?? display.defaultName ?? spec.name).trim().toUpperCase().slice(0, 24) || 'REGATTA';
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
  const B = d.beam / 2;
  /** How far the top of the stem reaches ahead of its foot. The hull's stations run from the foot of the stem. */
  const RAKE = 0.5;
  const zAt = (t: number) => -half + RAKE + (L - RAKE) * t;
  /** Freeboard amidships is the boat file's. The sheer rises to the bow and falls a little to the stern. */
  const F = d.freeboard;
  const sheerY = spline([[0, F + 0.36], [0.2, F + 0.2], [0.5, F + 0.03], [0.8, F - 0.05], [1, F - 0.06]]);
  const keelY = spline([[0, 0.5], [0.04, 0.08], [0.12, -0.2], [0.35, -0.34], [0.7, -0.36], [1, -0.34]]);
  const chineY = spline([[0, 0.66], [0.1, 0.44], [0.3, 0.2], [0.55, 0.09], [1, 0.05]]);
  /** Half beam at the sheer: full forward, as these boats are, and a little tucked in at the stern. */
  const sheerX = (t: number) => Math.max(0.02, B * Math.pow(Math.sin(Math.min(1, t / 0.56) * (Math.PI / 2)), 0.6) * (1 - 0.07 * Math.max(0, (t - 0.56) / 0.44) ** 2));
  /** Half beam at the chine: much narrower than the deck forward, which is the flare. */
  const chineX = (t: number) => sheerX(t) * lerp(0.42, 0.9, smooth(0, 0.6, t));
  /** The stem leans forward as it rises. */
  const rake = (t: number, y: number) => -RAKE * Math.pow(Math.max(0, Math.min(1, (y + 0.2) / (F + 0.56))), 1.15) * (1 - smooth(0, 0.2, t));
  /** A point on the topsides: `u` 0 at the chine, 1 at the sheer. Hollow forward, nearly straight aft. */
  const side = (t: number, u: number, s: number): THREE.Vector3 => {
    const flare = lerp(2.1, 1.08, smooth(0.02, 0.6, t));
    const y = lerp(chineY(t), sheerY(t), u);
    return V(s * lerp(chineX(t), sheerX(t), Math.pow(u, flare)), y, zAt(t) + rake(t, y));
  };
  /** A point on the bottom: `u` 0 at the keel, 1 at the chine. A straight vee aft, a little rounded forward. */
  const bottom = (t: number, u: number, s: number): THREE.Vector3 => {
    const round = lerp(1.35, 1, smooth(0, 0.45, t));
    const y = lerp(keelY(t), chineY(t), Math.pow(u, round));
    return V(s * chineX(t) * u, y, zAt(t) + rake(t, y));
  };
  /** The cockpit sole, above the water so she drains by herself, and the liner inside the hull. */
  const SOLE = 0.27;
  const CAP = 0.17;
  const T_FORE = 0.25;
  const T_AFT = 0.955;
  const innerX = (t: number) => Math.max(0.05, sheerX(t) - CAP);
  const capY = (t: number) => sheerY(t) + 0.02;
  /** The raised deck in the bow, with the anchor locker in it. */
  const foreY = sheerY(T_FORE) - 0.2;
  /** The console, fore and aft, and the helm. */
  const CON_Z0 = zAt(0.47);
  const CON_Z1 = CON_Z0 + 0.72;
  const CON_W = 0.46;
  const CON_TOP = SOLE + 1.06;
  const TOP_Y = SOLE + 2.1;

  // ---- materials -------------------------------------------------------------------------------------
  const V0 = -0.7;
  const VH = 2.2;
  const v = (y: number) => (y - V0) / VH;
  const hullMat = new THREE.MeshPhysicalMaterial({
    map: bandTexture([[0, '#1b3350'], [v(0.0), darkHull ? '#e9e6dc' : '#234a70'], [v(0.065), topsides]], 1024),
    roughness: 0.26, metalness: 0, clearcoat: 0.75, clearcoatRoughness: 0.18, side: THREE.DoubleSide,
  });
  const gel = new THREE.MeshPhysicalMaterial({ color: 0xf3f1e9, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.25, side: THREE.DoubleSide });
  const nonSkid = new THREE.MeshStandardMaterial({ map: nonSkidTexture(), roughness: 0.92, side: THREE.DoubleSide });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd3d8da, roughness: 0.2, metalness: 1 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xe1e3e2, roughness: 0.38, metalness: 0.7 });
  const black = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.55 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.85 });
  const cowl = new THREE.MeshPhysicalMaterial({ color: 0x1d2024, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const leg = new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.45, metalness: 0.3 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0xe8e4d6, roughness: 0.9 });
  const piping = new THREE.MeshStandardMaterial({ color: 0x29476b, roughness: 0.85 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x6f8793, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false });
  const canvas = new THREE.MeshStandardMaterial({ color: darkHull ? new THREE.Color(topsides) : new THREE.Color(0x1f3a5c), roughness: 0.9, side: THREE.DoubleSide });
  const cork = new THREE.MeshStandardMaterial({ color: 0xa9825a, roughness: 0.8 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.4, metalness: 0.2 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a441, roughness: 0.3, metalness: 0.9 });

  const rod = (a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, parent: THREE.Object3D = root, radiusEnd = radius): THREE.Mesh => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radiusEnd, radius, len, 8), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, V(0, 0, 0).subVectors(b, a).normalize());
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const tube = (pts: THREE.Vector3[], radius: number, mat: THREE.Material, parent: THREE.Object3D = root, closed = false): THREE.Mesh => {
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.2);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(10, pts.length * 7), radius, 7, closed), mat);
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
  /** A smooth skin through a grid of points, rows first. `uvOf` gives each point its place on the material's picture. */
  const skin = (grid: THREE.Vector3[][], mat: THREE.Material, parent: THREE.Object3D, uvOf: (p: THREE.Vector3, i: number, j: number) => [number, number] = (p) => [p.x, p.z]): THREE.Mesh => {
    const W = grid[0].length;
    const pos: number[] = [];
    const uv: number[] = [];
    grid.forEach((row, i) => row.forEach((p, j) => {
      pos.push(p.x, p.y, p.z);
      uv.push(...uvOf(p, i, j));
    }));
    const idx: number[] = [];
    for (let i = 0; i < grid.length - 1; i++) {
      for (let j = 0; j < W - 1; j++) {
        const a = i * W + j;
        const c = a + W;
        idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /** A flat-shaded face through any number of corners, fanned from the first. */
  const face = (pts: THREE.Vector3[], mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh => {
    const p: number[] = [];
    for (let i = 1; i < pts.length - 1; i++) for (const q of [pts[0], pts[i], pts[i + 1]]) p.push(q.x, q.y, q.z);
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

  // ---- hull ------------------------------------------------------------------------------------------
  const hullGroup = add('hull', new THREE.Group());
  const deckGroup = add('deck', new THREE.Group());
  solids.push(hullGroup, deckGroup);
  const NS = 44;
  const stations = Array.from({ length: NS + 1 }, (_, i) => {
    // Closer together at the bow, where the shape changes fastest.
    const k = i / NS;
    return k * k * (3 - 2 * k) * 0.35 + k * 0.65;
  });
  const hullUv = (p: THREE.Vector3): [number, number] => [(p.z + half) / L, v(p.y)];
  for (const s of [-1, 1]) {
    // The bottom and the topsides are separate skins, so the chine between them is a hard line.
    skin(stations.map((t) => Array.from({ length: 7 }, (_, j) => bottom(t, j / 6, s))), hullMat, hullGroup, hullUv);
    skin(stations.map((t) => Array.from({ length: 11 }, (_, j) => side(t, j / 10, s))), hullMat, hullGroup, hullUv);
    // A spray rail along the chine, forward: it is what turns the bow wave down and out.
    tube(stations.filter((t) => t > 0.03 && t < 0.62).map((t) => side(t, 0.02, s).add(V(s * 0.012, 0, 0))), 0.022, gel, hullGroup).castShadow = false;
    // The rub rail round the sheer.
    tube(stations.map((t) => side(t, 1, s).add(V(s * 0.012, -0.015, 0))), 0.024, rubber, hullGroup).castShadow = false;
  }
  // Transom.
  {
    const z = zAt(1);
    const m = face([V(0, keelY(1), z), V(chineX(1), chineY(1), z), V(sheerX(1), sheerY(1), z), V(-sheerX(1), sheerY(1), z), V(-chineX(1), chineY(1), z)], hullMat, hullGroup);
    const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 1, v(pos.getY(i)));
    // Scuppers: the cockpit drains through the transom, each side of the engine.
    for (const s of [-1, 1]) block(s * 0.5 - 0.05, SOLE - 0.05, z, s * 0.5 + 0.05, SOLE + 0.01, z + 0.012, rubber, hullGroup).castShadow = false;
  }

  // ---- the liner: sole, inner sides, gunwale cap, the raised deck in the bow ----------------------------
  {
    const ts = stations.filter((t) => t >= T_FORE && t <= T_AFT);
    ts.unshift(T_FORE);
    ts.push(T_AFT);
    // Sole.
    skin(ts.map((t) => [V(-innerX(t) + 0.02, SOLE, zAt(t)), V(innerX(t) - 0.02, SOLE, zAt(t))]), nonSkid, deckGroup);
    for (const s of [-1, 1]) {
      // Inner sides, with a bolster along the top where knees lean.
      skin(ts.map((t) => [V(s * (innerX(t) - 0.02), SOLE, zAt(t)), V(s * innerX(t), capY(t) - 0.02, zAt(t))]), gel, deckGroup);
      tube(ts.filter((t) => t > 0.4).map((t) => V(s * (innerX(t) - 0.035), capY(t) - 0.11, zAt(t))), 0.045, cushion, deckGroup).castShadow = false;
    }
    // Gunwale cap all the way round the bow.
    for (const s of [-1, 1]) {
      skin(stations.filter((t) => t <= T_AFT + 0.02).map((t) => {
        const y = capY(t);
        return [V(s * innerX(t), y, zAt(t) + rake(t, y)), V(s * (sheerX(t) + 0.012), y, zAt(t) + rake(t, y))];
      }), gel, deckGroup);
    }
    // The raised deck forward, to stand on with a rod, and the step down from it.
    const fore = stations.filter((t) => t >= 0.015 && t < T_FORE);
    fore.push(T_FORE);
    skin(fore.map((t) => {
      const y = Math.min(foreY, capY(t) - 0.03);
      return [V(-innerX(t), y, zAt(t) + rake(t, y)), V(innerX(t), y, zAt(t) + rake(t, y))];
    }), nonSkid, deckGroup);
    face([V(-innerX(T_FORE), SOLE, zAt(T_FORE)), V(innerX(T_FORE), SOLE, zAt(T_FORE)), V(innerX(T_FORE), foreY, zAt(T_FORE)), V(-innerX(T_FORE), foreY, zAt(T_FORE))], gel, deckGroup);
    for (const s of [-1, 1]) {
      skin(fore.map((t) => {
        const y = Math.min(foreY, capY(t) - 0.03);
        return [V(s * innerX(t), y, zAt(t) + rake(t, y)), V(s * innerX(t), capY(t), zAt(t) + rake(t, capY(t)))];
      }), gel, deckGroup);
    }
    // The anchor locker: a hatch let into that deck, and the anchor itself on a roller at the stem.
    const hz = zAt(0.085);
    block(-0.26, foreY, hz - 0.2, 0.26, foreY + 0.022, hz + 0.26, gel, deckGroup);
    block(-0.05, foreY + 0.02, hz + 0.2, 0.05, foreY + 0.04, hz + 0.24, steel, deckGroup).castShadow = false;
    const stemTop = V(0, capY(0), zAt(0) + rake(0, capY(0)));
    const roller = add('bow_roller', new THREE.Group());
    roller.position.copy(stemTop).add(V(0, 0.03, -0.02));
    block(-0.06, -0.03, -0.1, 0.06, 0.02, 0.3, steel, roller);
    rod(V(-0.05, 0.02, -0.08), V(0.05, 0.02, -0.08), 0.03, rubber, roller);
    // A plough anchor stowed on it, shank aft, with a turn of chain to the locker.
    rod(V(0, 0.05, -0.12), V(0, 0.05, 0.42), 0.014, steel, roller);
    const fluke = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 4), steel);
    fluke.rotation.set(Math.PI / 2 + 0.5, 0, Math.PI / 4);
    fluke.scale.set(1, 1, 0.35);
    fluke.position.set(0, -0.06, -0.2);
    fluke.castShadow = true;
    roller.add(fluke);
    rod(V(0, 0.05, 0.42), V(0, foreY - stemTop.y, hz - 0.2 - stemTop.z), 0.012, steel, roller);

    // Transom: the after end of the cockpit, a wide cap across it, the livewell under a hatch and the splashwell.
    const zt = zAt(T_AFT);
    const z1 = zAt(1);
    const xt = innerX(T_AFT);
    const yt = capY(1);
    face([V(-xt, SOLE, zt), V(xt, SOLE, zt), V(xt, yt, zt), V(-xt, yt, zt)], gel, deckGroup);
    face([V(-xt - CAP, yt, zt), V(xt + CAP, yt, zt), V(sheerX(1), yt, z1), V(-sheerX(1), yt, z1)], gel, deckGroup);
    // Livewell: a round-cornered hatch to port in the transom cap, with a latch.
    const well = add('livewell', new THREE.Group(), deckGroup);
    well.position.set(-xt * 0.52, yt, (zt + z1) / 2 - 0.01);
    block(-0.24, 0, -0.12, 0.24, 0.022, 0.12, gel, well);
    block(-0.035, 0.02, 0.07, 0.035, 0.034, 0.1, steel, well).castShadow = false;
    // A matching hatch to starboard: the fish box.
    block(xt * 0.52 - 0.24, yt, (zt + z1) / 2 - 0.13, xt * 0.52 + 0.24, yt + 0.022, (zt + z1) / 2 + 0.11, gel, deckGroup);
  }

  // ---- her name, on each quarter ----------------------------------------------------------------------
  {
    const tex = canvasTexture(1024, 160, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = darkHull ? '#f1eee4' : '#16284a';
      let size = 118;
      c.font = `italic 600 ${size}px Georgia, "Times New Roman", serif`;
      const wide = c.measureText(boatName).width;
      if (wide > w - 60) { size = Math.floor((size * (w - 60)) / wide); c.font = `italic 600 ${size}px Georgia, "Times New Roman", serif`; }
      c.fillText(boatName, w / 2, h / 2 + 4);
    });
    const nameMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, roughness: 0.5, side: THREE.DoubleSide });
    const T0 = 0.66;
    const T1 = 0.94;
    for (const s of [-1, 1]) {
      const N = 12;
      const rows = Array.from({ length: N + 1 }, (_, i) => {
        const t = lerp(T0, T1, i / N);
        return [side(t, 0.52, s).add(V(s * 0.012, 0, 0)), side(t, 0.86, s).add(V(s * 0.012, 0, 0))];
      });
      // Read from outside, bow to the reader's left on the starboard side and to the right on the port side.
      const m = skin(rows, nameMat, hullGroup, (_p, i, j) => [s > 0 ? 1 - i / N : i / N, j]);
      m.name = 'hull_name';
      m.castShadow = false;
    }
  }

  // ---- console ---------------------------------------------------------------------------------------
  const consoleGroup = new THREE.Group();
  deckGroup.add(consoleGroup);
  const wheelPos = V(0, SOLE + 0.93, CON_Z1 + 0.075);
  const WHEEL_R = 0.19;
  {
    // The body: narrower at the foot, with a toe kick, and a sloped dash on top facing the helm.
    const body = (y0: number, y1: number, w0: number, w1: number, z0a: number, z1a: number, z0b: number, z1b: number): void => {
      const a = [V(-w0, y0, z0a), V(w0, y0, z0a), V(w0, y0, z1a), V(-w0, y0, z1a)];
      const b = [V(-w1, y1, z0b), V(w1, y1, z0b), V(w1, y1, z1b), V(-w1, y1, z1b)];
      for (let i = 0; i < 4; i++) face([a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]], gel, consoleGroup);
      face(b, gel, consoleGroup);
    };
    body(SOLE, SOLE + 0.82, CON_W - 0.04, CON_W, CON_Z0 + 0.05, CON_Z1 - 0.04, CON_Z0, CON_Z1);
    // The dash: a wedge, low at the helm and high forward, with the electronics on its face.
    face([V(-CON_W, SOLE + 0.82, CON_Z1), V(CON_W, SOLE + 0.82, CON_Z1), V(CON_W, CON_TOP, CON_Z0 + 0.3), V(-CON_W, CON_TOP, CON_Z0 + 0.3)], gel, consoleGroup);
    face([V(-CON_W, CON_TOP, CON_Z0 + 0.3), V(CON_W, CON_TOP, CON_Z0 + 0.3), V(CON_W, CON_TOP, CON_Z0), V(-CON_W, CON_TOP, CON_Z0)], gel, consoleGroup);
    face([V(-CON_W, SOLE + 0.82, CON_Z0), V(CON_W, SOLE + 0.82, CON_Z0), V(CON_W, CON_TOP, CON_Z0), V(-CON_W, CON_TOP, CON_Z0)], gel, consoleGroup);
    for (const s of [-1, 1]) face([V(s * CON_W, SOLE + 0.82, CON_Z0), V(s * CON_W, SOLE + 0.82, CON_Z1), V(s * CON_W, CON_TOP, CON_Z0 + 0.3), V(s * CON_W, CON_TOP, CON_Z0)], gel, consoleGroup);
    const dashTilt = Math.atan2(CON_TOP - (SOLE + 0.82), CON_Z1 - (CON_Z0 + 0.3));
    const dash = new THREE.Group();
    dash.position.set(0, (SOLE + 0.82 + CON_TOP) / 2, (CON_Z1 + CON_Z0 + 0.3) / 2);
    dash.rotation.x = -(Math.PI / 2 - dashTilt);
    consoleGroup.add(dash);
    // The plotter, in the middle of the dash. `BoatView` draws her instruments on it.
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.02), black);
    bezel.position.set(-0.12, 0.01, 0.012);
    dash.add(bezel);
    const screen = add('plotter_screen', new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.2), new THREE.MeshBasicMaterial({ color: 0x0a1a1f })), dash);
    screen.position.set(-0.12, 0.01, 0.024);
    // The autopilot's head, to starboard of it.
    const pilot = add('autopilot', new THREE.Group(), dash);
    pilot.position.set(0.26, 0.03, 0.012);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.02), black);
    head.userData.glow = true;
    pilot.add(head);
    add('autopilot_screen', new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.095), new THREE.MeshBasicMaterial({ color: 0x0a1a1f })), pilot).position.set(-0.02, 0.02, 0.012);
    const knob = add('autopilot_knob', new THREE.Group(), pilot);
    knob.position.set(0.07, -0.05, 0.016);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.016, 12).rotateX(Math.PI / 2), steel);
    dial.userData.glow = true;
    knob.add(dial);
    proxy('autopilot', new THREE.BoxGeometry(0.26, 0.22, 0.12), pilot, V(0, 0, 0.04));
    // A compass on top, ahead of the helm.
    const compass = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), black);
    compass.position.set(0, CON_TOP, CON_Z0 + 0.16);
    consoleGroup.add(compass);

    // The wheel, on the after face: a stainless rim on three spokes with a turning knob.
    const wheel = add('wheel', new THREE.Group());
    wheel.position.copy(wheelPos);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.016, 8, 28), steel);
    rim.userData.glow = true;
    rim.castShadow = true;
    wheel.add(rim);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      rod(V(0, 0, 0), V(Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R, 0), 0.011, steel, wheel).userData.glow = true;
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12).rotateX(Math.PI / 2), steel);
    hub.userData.glow = true;
    wheel.add(hub);
    const spinner = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), black);
    spinner.position.set(Math.cos(-0.5) * WHEEL_R, Math.sin(-0.5) * WHEEL_R, 0.04);
    wheel.add(spinner);
    rod(V(0, wheelPos.y, CON_Z1 - 0.02), V(0, wheelPos.y, wheelPos.z), 0.022, steel, consoleGroup);
    proxy('wheel', new THREE.CylinderGeometry(WHEEL_R + 0.1, WHEEL_R + 0.1, 0.22, 12).rotateX(Math.PI / 2), wheel);

    // The throttle: one lever in a binnacle on the starboard side of the dash.
    const binnacle = block(CON_W - 0.14, SOLE + 0.84, CON_Z1 - 0.2, CON_W - 0.04, SOLE + 0.93, CON_Z1 - 0.06, black, consoleGroup);
    binnacle.castShadow = false;
    const lever = add('throttle', new THREE.Group(), consoleGroup);
    lever.position.set(CON_W - 0.02, SOLE + 0.9, CON_Z1 - 0.13);
    rod(V(0, 0, 0), V(0, 0.17, 0), 0.011, steel, lever);
    const grip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), black);
    grip.position.y = 0.18;
    lever.add(grip);

    // The windscreen: tinted acrylic raked back, inside a stainless grab rail.
    const wy0 = CON_TOP + 0.01;
    const wy1 = CON_TOP + 0.44;
    const wz0 = CON_Z0 + 0.06;
    const wz1 = CON_Z0 + 0.2;
    face([V(-CON_W + 0.03, wy0, wz0), V(CON_W - 0.03, wy0, wz0), V(CON_W - 0.09, wy1, wz1), V(-CON_W + 0.09, wy1, wz1)], glass, consoleGroup).castShadow = false;
    for (const s of [-1, 1]) face([V(s * (CON_W - 0.03), wy0, wz0), V(s * (CON_W - 0.01), wy0, wz0 + 0.3), V(s * (CON_W - 0.07), wy1 - 0.1, wz1 + 0.24), V(s * (CON_W - 0.09), wy1, wz1)], glass, consoleGroup).castShadow = false;
    tube([V(-CON_W, CON_TOP - 0.02, wz0 + 0.36), V(-CON_W + 0.01, wy0 + 0.06, wz0 + 0.3), V(-CON_W + 0.08, wy1 + 0.03, wz1 + 0.02), V(0, wy1 + 0.05, wz1 - 0.01), V(CON_W - 0.08, wy1 + 0.03, wz1 + 0.02), V(CON_W - 0.01, wy0 + 0.06, wz0 + 0.3), V(CON_W, CON_TOP - 0.02, wz0 + 0.36)], 0.014, steel, consoleGroup);

    // The seat on the front of the console, a cooler under its cushion.
    block(-0.36, SOLE, CON_Z0 - 0.46, 0.36, SOLE + 0.42, CON_Z0 - 0.02, gel, consoleGroup);
    block(-0.37, SOLE + 0.42, CON_Z0 - 0.47, 0.37, SOLE + 0.5, CON_Z0 - 0.02, cushion, consoleGroup);
    block(-0.34, SOLE + 0.5, CON_Z0 - 0.08, 0.34, SOLE + 0.86, CON_Z0 + 0.0, cushion, consoleGroup);
    block(-0.375, SOLE + 0.455, CON_Z0 - 0.475, 0.375, SOLE + 0.47, CON_Z0 - 0.02, piping, consoleGroup).castShadow = false;
  }

  // ---- T-top -----------------------------------------------------------------------------------------
  const topZ0 = CON_Z0 - 0.42;
  const topZ1 = CON_Z1 + 0.78;
  const TOP_W = 0.78;
  {
    const top = new THREE.Group();
    deckGroup.add(top);
    // Four legs from the sole beside the console, leaning in to the frame, with a brace each side at head height.
    for (const s of [-1, 1]) {
      const x0 = s * (CON_W + 0.06);
      const x1 = s * (TOP_W - 0.14);
      tube([V(x0, SOLE, CON_Z0 + 0.1), V(x0, SOLE + 1.2, CON_Z0 + 0.06), V(x1, TOP_Y - 0.06, topZ0 + 0.3)], 0.024, alloy, top);
      tube([V(x0, SOLE, CON_Z1 - 0.08), V(x0, SOLE + 1.2, CON_Z1 - 0.02), V(x1, TOP_Y - 0.06, topZ1 - 0.4)], 0.024, alloy, top);
      rod(V(x0, SOLE + 1.2, CON_Z0 + 0.06), V(x0, SOLE + 1.2, CON_Z1 - 0.02), 0.018, alloy, top);
      rod(V(x1, TOP_Y - 0.06, topZ0 + 0.3), V(x1, TOP_Y - 0.06, topZ1 - 0.4), 0.02, alloy, top);
    }
    // The frame, and canvas laced tight over it.
    tube([V(-TOP_W, TOP_Y, topZ0 + 0.1), V(-TOP_W + 0.1, TOP_Y, topZ0), V(TOP_W - 0.1, TOP_Y, topZ0), V(TOP_W, TOP_Y, topZ0 + 0.1), V(TOP_W, TOP_Y, topZ1 - 0.1), V(TOP_W - 0.1, TOP_Y, topZ1), V(-TOP_W + 0.1, TOP_Y, topZ1), V(-TOP_W, TOP_Y, topZ1 - 0.1)], 0.022, alloy, top, true);
    for (const z of [topZ0 + 0.55, (topZ0 + topZ1) / 2, topZ1 - 0.55]) tube([V(-TOP_W, TOP_Y, z), V(0, TOP_Y + 0.07, z), V(TOP_W, TOP_Y, z)], 0.016, alloy, top);
    const N = 8;
    skin(Array.from({ length: N + 1 }, (_, i) => {
      const z = lerp(topZ0 + 0.02, topZ1 - 0.02, i / N);
      return Array.from({ length: 7 }, (_, j) => {
        const x = lerp(-TOP_W + 0.02, TOP_W - 0.02, j / 6);
        return V(x, TOP_Y + 0.025 + 0.07 * (1 - (x / TOP_W) ** 2), z);
      });
    }), canvas, top);
    // Rocket launchers: five rod holders across the after edge, leaning aft.
    const lean = 0.42;
    const aim = V(0, Math.cos(lean), Math.sin(lean));
    for (let i = 0; i < 5; i++) {
      const x = lerp(-TOP_W + 0.14, TOP_W - 0.14, i / 4);
      const holder = add(`rod_ttop_${i + 1}`, new THREE.Group(), top);
      holder.position.set(x, TOP_Y - 0.14, topZ1 + 0.03);
      holder.quaternion.setFromUnitVectors(UP, aim);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.3, 8, 1, true), alloy);
      cup.position.y = 0.15;
      (cup.material as THREE.Material).side = THREE.DoubleSide;
      holder.add(cup);
    }
    // Outriggers, folded: laid back along each side of the top, their tips well aft and a little up.
    for (const s of [-1, 1]) {
      const base = V(s * (TOP_W + 0.04), TOP_Y + 0.02, topZ0 + 0.5);
      block(base.x - 0.035, base.y - 0.05, base.z - 0.06, base.x + 0.035, base.y + 0.05, base.z + 0.06, alloy, top);
      rod(base, V(s * (TOP_W + 0.14), TOP_Y + 0.62, topZ0 + 0.5 + 3.5), 0.016, alloy, top, 0.006);
    }
    // Racks on the port side of the top for the kayak, carried upside down and overhanging at both ends. `aboard/kayak.ts`
    // stows the tender on `tender_stow` where a boat has one.
    for (const z of [topZ0 + 0.35, topZ1 - 0.35]) {
      rod(V(-TOP_W + 0.02, TOP_Y + 0.02, z), V(-TOP_W + 0.02, TOP_Y + 0.2, z), 0.014, alloy, top);
      rod(V(-0.06, TOP_Y + 0.1, z), V(-0.06, TOP_Y + 0.2, z), 0.014, alloy, top);
      rod(V(-TOP_W + 0.02, TOP_Y + 0.2, z), V(-0.06, TOP_Y + 0.2, z), 0.016, alloy, top);
    }
    const stow = add('tender_stow', new THREE.Group(), top);
    stow.position.set(-TOP_W / 2 - 0.02, TOP_Y + 0.5, (topZ0 + topZ1) / 2 + 0.2);
    stow.rotation.z = Math.PI;
    // The VHF aerial, a spreader light forward, and the all-round white light on its short staff.
    rod(V(TOP_W - 0.2, TOP_Y + 0.06, topZ0 + 0.3), V(TOP_W - 0.2, TOP_Y + 2.3, topZ0 + 0.55), 0.009, gel, top, 0.004);
    rod(V(0, TOP_Y + 0.08, topZ1 - 0.25), V(0, TOP_Y + 0.5, topZ1 - 0.25), 0.012, steel, top);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf6f3e8, roughness: 0.3, emissive: 0x333333 }));
    lamp.position.set(0, TOP_Y + 0.52, topZ1 - 0.25);
    top.add(lamp);
    // Sidelights on the front corners of the top.
    for (const s of [-1, 1]) block(s * (TOP_W - 0.04) - 0.03, TOP_Y - 0.04, topZ0 + 0.06, s * (TOP_W - 0.04) + 0.03, TOP_Y + 0.02, topZ0 + 0.14, new THREE.MeshStandardMaterial({ color: s > 0 ? 0x1f8a4c : 0xb32a22, roughness: 0.4 }), top).castShadow = false;
  }

  // ---- leaning post -----------------------------------------------------------------------------------
  const postZ = CON_Z1 + 0.82;
  {
    const post = new THREE.Group();
    deckGroup.add(post);
    const y = SOLE + 0.84;
    for (const s of [-1, 1]) tube([V(s * 0.4, SOLE, postZ - 0.14), V(s * 0.4, y - 0.05, postZ - 0.1), V(s * 0.4, y + 0.3, postZ + 0.16), V(s * 0.4, y - 0.05, postZ + 0.2), V(s * 0.4, SOLE, postZ + 0.24)], 0.02, alloy, post);
    block(-0.45, y - 0.04, postZ - 0.16, 0.45, y + 0.06, postZ + 0.16, cushion, post);
    block(-0.455, y - 0.01, postZ - 0.165, 0.455, y + 0.005, postZ + 0.165, piping, post).castShadow = false;
    rod(V(-0.4, y + 0.3, postZ + 0.16), V(0.4, y + 0.3, postZ + 0.16), 0.03, cushion, post);
    rod(V(-0.4, SOLE + 0.28, postZ - 0.12), V(0.4, SOLE + 0.28, postZ - 0.12), 0.016, alloy, post);
    // A cooler lashed under it.
    block(-0.33, SOLE, postZ - 0.14, 0.33, SOLE + 0.36, postZ + 0.2, gel, post);
    block(-0.34, SOLE + 0.36, postZ - 0.15, 0.34, SOLE + 0.41, postZ + 0.21, gel, post);
    // Four holders across its back for rods not in use.
    for (let i = 0; i < 4; i++) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.26, 8, 1, true), alloy);
      cup.position.set(lerp(-0.33, 0.33, i / 3), y + 0.16, postZ + 0.2);
      cup.rotation.x = 0.16;
      post.add(cup);
    }
  }

  // ---- rods ------------------------------------------------------------------------------------------
  /** A rod standing in a holder: butt, reel, blank and guides. It goes in along the holder's own +Y. */
  const fishingRod = (length: number): THREE.Group => {
    const g = new THREE.Group();
    g.name = 'rod';
    rod(V(0, -0.1, 0), V(0, 0.32, 0), 0.015, cork, g);
    rod(V(0, 0.32, 0), V(0, length, 0), 0.008, graphite, g, 0.0025);
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12).rotateZ(Math.PI / 2), gold);
    reel.position.set(0, 0.22, -0.05);
    reel.castShadow = true;
    g.add(reel);
    for (const k of [0.45, 0.62, 0.78, 0.92]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 4, 8), steel);
      ring.position.set(0, length * k, -0.014);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    return g;
  };
  {
    // Flush holders in the gunwale cap, two a side aft, raked outboard and aft as trolling rods are carried.
    const holders: Array<[string, number, number, boolean]> = [['rod_port', 0.86, -1, true], ['rod_stbd', 0.86, 1, true], ['rod_port_fwd', 0.74, -1, false], ['rod_stbd_fwd', 0.74, 1, false]];
    for (const [name, t, s, stocked] of holders) {
      const holder = add(name, new THREE.Group(), deckGroup);
      holder.position.set(s * (innerX(t) + CAP * 0.5), capY(t), zAt(t));
      holder.quaternion.setFromUnitVectors(UP, V(s * 0.42, 0.82, 0.38).normalize());
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12), steel);
      ring.rotation.x = Math.PI / 2;
      holder.add(ring);
      if (stocked) holder.add(fishingRod(2.05));
    }
    // And three more standing in the rocket launchers.
    for (const i of [3, 4, 5]) nodes[`rod_ttop_${i}`].add(fishingRod(2.15));
  }

  // ---- bow rail, cleats, the bow light ------------------------------------------------------------------
  {
    const railT = stations.filter((t) => t >= 0.05 && t <= 0.46);
    const railAt = (t: number, s: number) => {
      const y = capY(t);
      return V(s * (sheerX(t) - 0.07), y, zAt(t) + rake(t, y));
    };
    const high = (t: number) => 0.3 * smooth(0.46, 0.4, t) * (0.75 + 0.25 * smooth(0.05, 0.2, t));
    const pts = [...railT.slice().reverse().map((t) => railAt(t, -1).add(V(0, high(t), 0))), V(0, capY(0.02) + 0.24, zAt(0.02) + rake(0.02, capY(0.02)) + 0.06), ...railT.map((t) => railAt(t, 1).add(V(0, high(t), 0)))];
    tube(pts, 0.014, steel, deckGroup);
    for (const s of [-1, 1]) for (const t of [0.08, 0.2, 0.32]) rod(railAt(t, s), railAt(t, s).add(V(0, high(t), 0)), 0.011, steel, deckGroup);
    const cleat = (p: THREE.Vector3, along: number): void => {
      const c = new THREE.Group();
      c.position.copy(p);
      c.rotation.y = along;
      rod(V(0, 0.035, -0.09), V(0, 0.035, 0.09), 0.012, steel, c);
      rod(V(0, 0, -0.03), V(0, 0.035, -0.03), 0.01, steel, c);
      rod(V(0, 0, 0.03), V(0, 0.035, 0.03), 0.01, steel, c);
      deckGroup.add(c);
    };
    cleat(V(0, capY(0.03) + 0.005, zAt(0.03) + rake(0.03, capY(0.03)) + 0.12), 0);
    for (const s of [-1, 1]) {
      cleat(V(s * (sheerX(0.56) - 0.08), capY(0.56) + 0.005, zAt(0.56)), 0);
      cleat(V(s * (sheerX(0.97) - 0.09), capY(0.97) + 0.005, zAt(0.97)), 0);
    }
  }

  // ---- outboard ---------------------------------------------------------------------------------------
  {
    const z1 = zAt(1);
    const yt = capY(1);
    // The bracket: bolted to the transom, it does not move.
    block(-0.15, yt - 0.4, z1, 0.15, yt + 0.02, z1 + 0.09, leg);
    // Everything that turns with the wheel hangs from a pivot just abaft it.
    const steer = add('outboard', new THREE.Group());
    steer.position.set(0, yt - 0.1, z1 + 0.14);
    const tilt = add('outboard_tilt', new THREE.Group(), steer);
    // Cowling: a tall rounded box, wider at the shoulders than the foot and sloping down aft, dark, with a plain
    // lighter band round it. No name on it.
    {
      const shape = (y: number): [number, number, number] => {
        // Half width, and the fore and after ends, at a height above the pan.
        const k = y / 0.58;
        const w = 0.2 * (0.86 + 0.5 * k - 0.62 * k * k);
        return [w, -0.06 - 0.02 * k, 0.5 - 0.16 * k * k];
      };
      const rows: THREE.Vector3[][] = [];
      const NR = 9;
      for (let i = 0; i <= NR; i++) {
        const y = (0.58 * i) / NR;
        const [w, z0, z1] = shape(y);
        // The top closes over in a dome.
        const lid = i === NR ? 0.55 : 1;
        const zc = (z0 + z1) / 2;
        const hz = ((z1 - z0) / 2) * lid;
        rows.push(Array.from({ length: 17 }, (_, j) => {
          const a = (j / 16) * Math.PI * 2;
          // A box with well rounded corners.
          const cx = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.45);
          const cz = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.45);
          return V(cx * w * lid, 0.22 + y + (i === NR ? 0.035 : 0), zc + cz * hz);
        }));
      }
      skin(rows, cowl, tilt);
      const [wt, zt0, zt1] = shape(0.58);
      face(Array.from({ length: 16 }, (_, j) => {
        const a = (j / 16) * Math.PI * 2;
        return V(Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.45) * wt * 0.55, 0.835, (zt0 + zt1) / 2 + Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.45) * ((zt1 - zt0) / 2) * 0.55);
      }), cowl, tilt);
      const stripe = new THREE.MeshStandardMaterial({ color: 0xc9ccce, roughness: 0.4, side: THREE.DoubleSide });
      const band = rows.slice(2, 4).map((row) => row.map((q) => V(q.x * 1.012, q.y, (q.z - 0.22) * 1.012 + 0.22)));
      skin(band, stripe, tilt).castShadow = false;
    }
    // The pan under the cowling, the leg, the plate over the propeller, the gearcase and its skeg.
    block(-0.15, 0.04, -0.06, 0.15, 0.22, 0.48, leg, tilt);
    block(-0.06, -0.82, 0.1, 0.06, 0.04, 0.32, leg, tilt);
    const plateY = keelY(1) - (yt - 0.1) - 0.02;
    block(-0.16, plateY, 0.06, 0.16, plateY + 0.02, 0.56, leg, tilt);
    const gear = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.36, 4, 10).rotateX(Math.PI / 2), leg);
    gear.position.set(0, plateY - 0.2, 0.22);
    tilt.add(gear);
    face([V(0, plateY - 0.24, 0.06), V(0, plateY - 0.24, 0.34), V(0, plateY - 0.42, 0.3), V(0, plateY - 0.42, 0.2)], leg, tilt);
    block(-0.02, plateY - 0.2, 0.08, 0.02, plateY, 0.34, leg, tilt);
    const prop = add('prop', new THREE.Group(), tilt);
    prop.position.set(0, plateY - 0.2, 0.47);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), steel);
      blade.scale.set(0.5, 1, 0.12);
      const a = (i / 3) * Math.PI * 2;
      blade.position.set(Math.sin(a) * 0.09, Math.cos(a) * 0.09, 0);
      blade.rotation.set(0.5, 0, -a);
      prop.add(blade);
    }
    const hubCap = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 10).rotateX(Math.PI / 2), steel);
    hubCap.position.z = 0.04;
    prop.add(hubCap);
  }

  // What a sailing boat's model says about her rig, she says about her helm: where the wheel is and where to stand.
  const none = V(0, 0, 0);
  const geo: SloopGeometry = {
    mastZ: 0, mastTopY: TOP_Y, gooseneck: none, boomLength: 0, mainTackY: 0, mainHeadY: 0, mainFoot: 0,
    jibTack: none, jibHead: none, hounds: none, jibFoot: 0, jibClewY: 0,
    carPort: none, carStbd: none, winchPort: none, winchStbd: none, traveller: none, vangBase: none,
    wheel: wheelPos,
    cockpitSoleY: SOLE,
    wheelRadius: WHEEL_R,
    seatX: 0.3,
    seatY: SOLE + 0.84,
    trimmerZ: postZ,
    cockpitFwdZ: zAt(T_FORE),
    cockpitAftZ: zAt(T_AFT),
    wellHalf: innerX(0.7) - 0.05,
  };
  return { root, nodes, hitProxies, solids, geo };
}
