import * as THREE from 'three';
import type { BoatSpec } from '@slack-tide/sim';

// The James Caird: a double-ended ship's lifeboat, her sides raised and decked with canvas, rigged as a lug ketch.
// Boat frame as for every boat: +X starboard, +Y up, -Z forward, origin on the waterline amidships.
// Everything is laid off from her dimensions in the boat file. This file builds what does not move.
// The sails, the cordage and the men are in `cairdView.ts`.

export interface CairdGeometry {
  half: number;
  mastZ: number;
  mastTopY: number;
  mizzenX: number;
  mizzenZ: number;
  mizzenTopY: number;
  /** Top of the canvas decking on the centreline at a fore-and-aft position. */
  deckY(z: number): number;
  /** Half breadth at the gunwale at a fore-and-aft position. */
  halfBreadth(z: number): number;
  stemHead: THREE.Vector3;
  /** Where the rudder and tiller turn. */
  rudderHead: THREE.Vector3;
  tillerLength: number;
  boomLength: number;
  /** The tack of the mainsail, at the foot of the mast. */
  mainTack: THREE.Vector3;
  jibFoot: number;
  jibHead: THREE.Vector3;
  /** The steering well: its fore and aft ends, half width and bottom boards. */
  wellFwdZ: number;
  wellAftZ: number;
  wellHalf: number;
  wellSoleY: number;
  cleatPort: THREE.Vector3;
  cleatStbd: THREE.Vector3;
  leadPort: THREE.Vector3;
  leadStbd: THREE.Vector3;
  /** Where the mainsheet comes down, on the quarter. */
  sheetLead: THREE.Vector3;
}

export interface CairdModel {
  root: THREE.Group;
  nodes: Record<string, THREE.Object3D>;
  hitProxies: THREE.Mesh[];
  solids: THREE.Object3D[];
  geo: CairdGeometry;
}

/** Sailcloth, tarred cordage and weathered paint, drawn once. */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Flax canvas in vertical cloths, gone grey with salt, with rows of reef points. */
export function sailcloth(): THREE.CanvasTexture {
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#b9b09a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) {
      g.fillStyle = i % 2 ? 'rgba(255, 250, 235, 0.07)' : 'rgba(70, 62, 48, 0.08)';
      g.fillRect((w * i) / 7, 0, w / 7, h);
      g.strokeStyle = 'rgba(70, 60, 44, 0.5)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo((w * i) / 7, 0);
      g.lineTo((w * i) / 7, h);
      g.stroke();
    }
    // Water stains and mildew.
    for (let i = 0; i < 40; i++) {
      const x = ((i * 97) % 251) / 251 * w;
      const y = ((i * 57) % 241) / 241 * h;
      g.fillStyle = `rgba(60, 54, 44, ${0.012 + ((i * 13) % 7) * 0.003})`;
      g.beginPath();
      g.ellipse(x, y, 18 + (i % 5) * 9, 30 + (i % 7) * 12, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Two rows of reef points, a quarter and a half of the way up.
    for (const v of [0.26, 0.48]) {
      g.fillStyle = 'rgba(80, 70, 52, 0.55)';
      g.fillRect(0, h * (1 - v) - 2, w, 4);
      for (let i = 0; i < 9; i++) g.fillRect((w * (i + 0.5)) / 9 - 1.5, h * (1 - v), 3, 16);
    }
    g.fillStyle = 'rgba(70, 60, 44, 0.6)';
    g.fillRect(0, 0, w, 5);
    g.fillRect(0, h - 5, w, 5);
    g.fillRect(0, 0, 4, h);
    g.fillRect(w - 4, 0, 4, h);
  });
}

/** Decking canvas: dark with wet, seamed across, the frame showing through as ridges. */
function deckCanvas(): THREE.CanvasTexture {
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#6b6658';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(${i % 2 ? '20,20,18' : '190,186,170'}, 0.05)`;
      g.fillRect(((i * 53) % 256), ((i * 131) % 512), 26, 9);
    }
    // Seams across the boat, and the lashing down each side.
    for (let i = 1; i < 12; i++) {
      g.fillStyle = 'rgba(30, 28, 24, 0.5)';
      g.fillRect(0, (h * i) / 12 - 1, w, 2);
      g.fillStyle = 'rgba(210, 205, 188, 0.12)';
      g.fillRect(0, (h * i) / 12 + 2, w, 3);
    }
    for (let y = 4; y < h; y += 10) {
      g.fillStyle = 'rgba(28, 24, 20, 0.6)';
      g.fillRect(5, y, 9, 2);
      g.fillRect(w - 14, y, 9, 2);
    }
  });
}

export function buildCaird(spec: BoatSpec): CairdModel {
  const d = spec.dimensions;
  const half = d.loa / 2;
  const B = d.beam / 2;
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
  const proxy = (node: string, geom: THREE.BufferGeometry, parent: THREE.Object3D, pos?: THREE.Vector3): void => {
    const m = new THREE.Mesh(geom, proxyMat);
    m.userData.node = node;
    if (pos) m.position.copy(pos);
    parent.add(m);
    hitProxies.push(m);
  };
  const mat = (color: number, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness });
  const wood = mat(0x7a5c3c, 0.8);
  const spar = mat(0x9a7a52, 0.7);
  const tarred = mat(0x1f1c19, 0.9);
  const iron = mat(0x2b2b2c, 0.6);

  // ---- her lines -------------------------------------------------------------------------------
  // s runs from -1 at the stem to +1 at the sternpost. She is the same shape at both ends, a little higher forward.
  const breadth = (s: number) => B * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), 2.3)), 0.6);
  const sheer = (s: number) => d.freeboard + 0.05 + 0.3 * s * s + 0.05 * Math.max(0, -s);
  const keel = (s: number) => -d.draft * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), 3.2)), 0.7);
  const CAMBER = 0.17;
  const deckY = (z: number) => {
    const s = THREE.MathUtils.clamp(z / half, -1, 1);
    return sheer(s) + CAMBER * (breadth(s) / B);
  };

  const mastZ = -half + d.mastFromBow;
  const mizzenX = -0.17;
  const mizzenZ = half - 0.5;
  const wellFwdZ = 1.2;
  const wellAftZ = 2.5;
  const wellHalf = 0.4;
  const wellSoleY = -0.12;

  // ---- hull ------------------------------------------------------------------------------------
  {
    const NS = 36;
    const NU = 11;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const paint = new THREE.Color(spec && (spec as BoatSpec & { topsides?: string }).topsides ? (spec as BoatSpec & { topsides?: string }).topsides! : '#d9d4c4');
    const bare = new THREE.Color(0x8b6b46);
    const weed = new THREE.Color(0x5d5a4c);
    const c = new THREE.Color();
    for (const side of [-1, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= NS; i++) {
        const s = -1 + (2 * i) / NS;
        const b = breadth(s);
        const k = keel(s);
        const top = sheer(s);
        for (let j = 0; j <= NU; j++) {
          const u = j / NU;
          const x = b * (1 - Math.pow(1 - u, 2.2));
          const y = k + (top - k) * (0.25 * u + 0.75 * Math.pow(u, 2.2));
          pos.push(side * x, y, s * half);
          // White lead paint, grey-green with weed and wet low down, and McNish's new top strakes left bare.
          c.copy(paint).multiplyScalar(0.8 + 0.2 * (((i * 7 + j * 3) % 5) / 5));
          if (y < 0.12) c.lerp(weed, THREE.MathUtils.clamp((0.12 - y) / 0.25, 0, 0.8));
          if (u > 0.84) c.copy(bare).multiplyScalar(0.85 + 0.2 * (((i * 3 + j) % 4) / 4));
          else if (j % 2 === 1) c.multiplyScalar(0.93);
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
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const hull = add('hull', new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })));
    hull.castShadow = true;
    hull.receiveShadow = true;
    solids.push(hull);

    // Stem and sternpost, standing proud of the planking, and the rubbing strake under the new work.
    for (const end of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, sheer(end) + 0.16, 0.09), wood);
      post.position.set(0, (sheer(end) + 0.16) / 2 - 0.02, end * (half + 0.01));
      post.castShadow = true;
      root.add(post);
    }
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const s = -0.985 + (1.97 * i) / 24;
        const k = keel(s);
        const top = sheer(s);
        const u = 0.84;
        pts.push(new THREE.Vector3(side * (breadth(s) * (1 - Math.pow(1 - u, 2.2)) + 0.012), k + (top - k) * (0.25 * u + 0.75 * Math.pow(u, 2.2)), s * half));
      }
      const strake = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.022, 5), tarred);
      root.add(strake);
      const gunwale = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 25 }, (_, i) => {
        const s = -0.99 + (1.98 * i) / 24;
        return new THREE.Vector3(side * breadth(s), sheer(s) + 0.012, s * half);
      })), 40, 0.028, 5), wood);
      root.add(gunwale);
    }
  }

  // ---- the canvas decking, with the steering well left open aft --------------------------------
  {
    const NS = 40;
    const NX = 8;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= NS; i++) {
      const s = -0.995 + (1.99 * i) / NS;
      const b = breadth(s);
      for (let j = 0; j <= NX; j++) {
        const f = -1 + (2 * j) / NX;
        // Slack canvas between the frames: it sags a little between each pair of ribs.
        const sag = 0.012 * Math.sin(i * Math.PI) + 0.016 * Math.abs(Math.sin((s * half) / 0.29 * Math.PI)) * (1 - f * f);
        pos.push(f * b, sheer(s) + CAMBER * (b / B) * (1 - f * f) - sag, s * half);
        uv.push(j / NX, i / NS);
      }
    }
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NX; j++) {
        const a = i * (NX + 1) + j;
        const zc = ((-0.995 + (1.99 * (i + 0.5)) / NS)) * half;
        const xc = ((-1 + (2 * (j + 0.5)) / NX)) * breadth(zc / half);
        if (zc > wellFwdZ && zc < wellAftZ && Math.abs(xc) < wellHalf) continue;
        idx.push(a, a + NX + 1, a + 1, a + 1, a + NX + 1, a + NX + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const deck = add('deck', new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: deckCanvas(), roughness: 1, side: THREE.DoubleSide })));
    deck.castShadow = true;
    deck.receiveShadow = true;
    solids.push(deck);

    // The well: a coaming of box-lid boards round it, dark inside, bottom boards over the ballast.
    const wellMid = (wellFwdZ + wellAftZ) / 2;
    const top = deckY(wellMid) + 0.1;
    const inside = mat(0x2a2620, 1);
    const wall = (w: number, len: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, top - wellSoleY, len), wood);
      m.position.set(x, (top + wellSoleY) / 2, z);
      m.castShadow = true;
      root.add(m);
    };
    wall(0.035, wellAftZ - wellFwdZ + 0.07, -wellHalf - 0.02, wellMid);
    wall(0.035, wellAftZ - wellFwdZ + 0.07, wellHalf + 0.02, wellMid);
    wall(wellHalf * 2 + 0.07, 0.035, 0, wellFwdZ - 0.02);
    wall(wellHalf * 2 + 0.07, 0.035, 0, wellAftZ + 0.02);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(wellHalf * 2, 0.03, wellAftZ - wellFwdZ), inside);
    sole.position.set(0, wellSoleY, wellMid);
    root.add(sole);
    // A thwart across the after end for the helmsman.
    const thwart = new THREE.Mesh(new THREE.BoxGeometry(wellHalf * 2, 0.04, 0.26), wood);
    thwart.position.set(0, 0.64, wellAftZ - 0.15);
    root.add(thwart);
  }

  // ---- spars and standing rigging --------------------------------------------------------------
  const mastTopY = d.mastHeight;
  const mizzenTopY = 3.15;
  {
    const mast = add('mast', new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.058, mastTopY - 0.1, 8), spar));
    mast.position.set(0, (mastTopY + 0.1) / 2, mastZ);
    mast.castShadow = true;
    const mizzen = add('mizzen_mast', new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.04, mizzenTopY - 0.5, 7), spar));
    mizzen.position.set(mizzenX, (mizzenTopY + 0.5) / 2, mizzenZ);
    mizzen.castShadow = true;
    // The bumkin the mizzen sheets to, out over the stern.
    const bumkin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 1.15, 6).rotateX(Math.PI / 2), spar);
    bumkin.position.set(mizzenX, sheer(1) + 0.1, half + 0.42);
    root.add(bumkin);
    // Forestay and a shroud each side: tarred hemp, drawn as lines.
    const lines: number[] = [];
    const stemY = sheer(-1) + 0.14;
    lines.push(0, stemY, -half, 0, mastTopY - 0.25, mastZ);
    for (const side of [-1, 1]) lines.push(side * breadth((mastZ + 0.35) / half), sheer((mastZ + 0.35) / half), mastZ + 0.35, 0, mastTopY - 0.3, mastZ);
    const rig = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)), new THREE.LineBasicMaterial({ color: 0x1b1815 }));
    rig.name = 'standing_rigging';
    root.add(rig);
  }

  // ---- rudder and tiller -----------------------------------------------------------------------
  const rudderHead = new THREE.Vector3(0, sheer(1) + 0.2, half + 0.06);
  const tillerLength = 1.25;
  {
    const steer = add('tiller', new THREE.Group());
    steer.position.copy(rudderHead);
    // A narrow stock down the sternpost and the blade below it, mostly under water.
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.03, rudderHead.y - 0.2, 0.09), wood);
    stock.position.set(0, -(rudderHead.y - 0.2) / 2, 0.05);
    stock.castShadow = true;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.3 + d.draft * 0.92, 0.3), wood);
    blade.position.set(0, -rudderHead.y + 0.3 - (0.3 + d.draft * 0.92) / 2, 0.16);
    blade.castShadow = true;
    steer.add(stock, blade);
    // The tiller comes forward over the well, a little cranked so it clears the mizzen.
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.03, tillerLength, 7).rotateX(Math.PI / 2), spar);
    bar.position.set(0, 0.03, -tillerLength / 2);
    bar.castShadow = true;
    bar.userData.glow = true;
    steer.add(bar);
    proxy('tiller', new THREE.BoxGeometry(0.34, 0.34, tillerLength + 0.2), steer, new THREE.Vector3(0, 0.03, -tillerLength / 2));
  }

  // ---- belaying points for the sheets ----------------------------------------------------------
  const cleatAt = (side: number) => new THREE.Vector3(side * (wellHalf + 0.16), deckY(wellFwdZ) - 0.05, wellFwdZ + 0.1);
  const leadAt = (side: number) => new THREE.Vector3(side * (breadth(-0.12) - 0.07), sheer(-0.12) + 0.05, -0.12 * half);
  const cleatPort = cleatAt(-1);
  const cleatStbd = cleatAt(1);
  for (const [name, at] of [['jib_sheet_port', cleatPort], ['jib_sheet_stbd', cleatStbd]] as const) {
    const cleat = add(name, new THREE.Group());
    cleat.position.copy(at);
    const horn = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.2), spar);
    horn.position.y = 0.05;
    horn.userData.glow = true;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.06), spar);
    foot.position.y = 0.02;
    foot.userData.glow = true;
    cleat.add(horn, foot);
    proxy(name, new THREE.SphereGeometry(0.22, 8, 6), cleat, new THREE.Vector3(0, 0.05, 0));
  }
  for (const at of [leadAt(-1), leadAt(1)]) {
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 5, 10), iron);
    eye.position.copy(at);
    root.add(eye);
  }
  const sheetLead = new THREE.Vector3(0.3, deckY(wellAftZ + 0.3) - 0.02, wellAftZ + 0.32);

  // ---- what was lashed on deck -----------------------------------------------------------------
  {
    // Four oars along the sides, blades forward, lashed down to the decking.
    const oar = mat(0xa58a62, 0.8);
    for (const [side, lift] of [[-1, 0], [1, 0], [-1, 1], [1, 1]] as const) {
      const group = new THREE.Group();
      const loom = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 3.5, 6).rotateX(Math.PI / 2), oar);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.016, 0.85), oar);
      blade.position.z = -2.1;
      group.add(loom, blade);
      const z = -0.15 + lift * 0.1;
      const x = side * (breadth(z / half) * 0.63 - lift * 0.07);
      group.position.set(x, sheer(z / half) + CAMBER * 0.62 + 0.03 + lift * 0.045, z);
      // They follow the run of the side: toed in toward the bow.
      group.rotation.y = side * -0.035;
      group.rotation.x = 0.02;
      group.traverse((o) => { o.castShadow = true; });
      root.add(group);
    }
    // Lashings over them.
    for (const z of [-1.15, 0.1, 1.0]) {
      for (const side of [-1, 1]) {
        const lash = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.03), tarred);
        lash.position.set(side * breadth(z / half) * 0.6, sheer(z / half) + CAMBER * 0.62 + 0.085, z);
        lash.rotation.z = side * -0.28;
        root.add(lash);
      }
    }
    // The Primus box and a water breaker would be below. On deck forward: the sea anchor, a canvas cone, lashed by the mast.
    const drogue = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 8, 1, true), mat(0x7a745f, 1));
    drogue.rotation.z = Math.PI / 2;
    drogue.rotation.y = 0.4;
    drogue.position.set(0.28, deckY(mastZ - 0.75) + 0.1, mastZ - 0.75);
    root.add(drogue);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 5, 12), mat(0x9b8a66, 1));
    coil.rotation.x = Math.PI / 2;
    coil.position.set(-0.26, deckY(mastZ - 0.7) + 0.03, mastZ - 0.7);
    root.add(coil);
  }

  const geo: CairdGeometry = {
    half, mastZ, mastTopY, mizzenX, mizzenZ, mizzenTopY,
    deckY,
    halfBreadth: (z) => breadth(THREE.MathUtils.clamp(z / half, -1, 1)),
    stemHead: new THREE.Vector3(0, sheer(-1) + 0.14, -half),
    rudderHead, tillerLength,
    boomLength: d.boomLength,
    mainTack: new THREE.Vector3(0, deckY(mastZ) + 0.28, mastZ),
    jibFoot: d.jibFoot,
    jibHead: new THREE.Vector3(0, d.forestayHeight, mastZ - 0.1),
    wellFwdZ, wellAftZ, wellHalf, wellSoleY,
    cleatPort, cleatStbd, leadPort: leadAt(-1), leadStbd: leadAt(1), sheetLead,
  };
  return { root, nodes, hitProxies, solids, geo };
}
