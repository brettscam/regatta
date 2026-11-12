import * as THREE from 'three';
import type { CourseData } from '@slack-tide/world';
import { landUse, smoothNoise } from './terrain';

/** Small seeded generator, so the city is built the same on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Block {
  /** Course position of the centre, metres east and north. */
  x: number;
  y: number;
  /** Height of the base above the sea. */
  base: number;
  /** Footprint along local x and z, and height. */
  w: number;
  d: number;
  h: number;
  /** Turn about the vertical, radians. */
  turn: number;
  color: THREE.Color;
}

// Everything here uses the standard material with its default matt finish, so faces turned away from the sun
// are still lit by the sky. A simpler material leaves the shaded side of the city black.

/** Instanced boxes standing on their bases. One draw call for however many there are. */
function boxes(blocks: Block[], name: string, material?: THREE.Material): THREE.InstancedMesh {
  const geom = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geom, material ?? new THREE.MeshStandardMaterial({ color: 0xffffff, envMapIntensity: 0.8 }), blocks.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  blocks.forEach((b, i) => {
    q.setFromAxisAngle(up, b.turn);
    m.compose(p.set(b.x, b.base, -b.y), q, s.set(b.w, b.h, b.d));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, b.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = name;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * What stands on the land: the city and its towers, piers, Alcatraz, hillside towns, marinas, the Bay Bridge, trees.
 * Positions are from general knowledge and are checked against the terrain, so nothing is built on water.
 * Course coordinates are metres east (x) and north (y). In the scene that is X east and Z south.
 */
export function buildScenery(course: CourseData, terrainHeights: Uint8Array): THREE.Group {
  const g = course.terrain;
  const group = new THREE.Group();
  group.name = 'scenery';
  const rnd = mulberry32(7141906);
  const col = (r: number, gr: number, b: number) => new THREE.Color(r, gr, b);

  const cell = (i: number, j: number) => (terrainHeights[Math.min(g.ny - 1, Math.max(0, j)) * g.nx + Math.min(g.nx - 1, Math.max(0, i))] / 255) ** 2 * g.max;
  /** Height of the land at a course position, metres. 0 over water. */
  const heightAt = (x: number, y: number): number => {
    const fx = (x - g.x0) / g.dx;
    const fy = (y - g.y0) / g.dx;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    return (cell(i, j) * (1 - u) + cell(i + 1, j) * u) * (1 - v) + (cell(i, j + 1) * (1 - u) + cell(i + 1, j + 1) * u) * v;
  };
  const dry = (x: number, y: number) => heightAt(x, y) > 0.9;
  /** Lowest ground under a footprint, so a building on a slope has no gap under its downhill side. */
  const footing = (x: number, y: number, r: number) => Math.min(heightAt(x - r, y - r), heightAt(x + r, y - r), heightAt(x - r, y + r), heightAt(x + r, y + r), heightAt(x, y));
  /** Walk from a point on land in a direction until the water starts. Returns the last dry point, or null. */
  const shoreFrom = (x: number, y: number, dx: number, dy: number, reach = 900): { x: number; y: number } | null => {
    if (!dry(x, y)) return null;
    for (let d = 10; d <= reach; d += 10) {
      if (!dry(x + dx * d, y + dy * d)) return { x: x + dx * (d - 10), y: y + dy * (d - 10) };
    }
    return null;
  };
  /** Highest point within a radius: hilltop landmarks go on the real summit. */
  const summitNear = (x: number, y: number, r: number): { x: number; y: number } => {
    let best = { x, y };
    let top = heightAt(x, y);
    for (let dy = -r; dy <= r; dy += 40) {
      for (let dx = -r; dx <= r; dx += 40) {
        const z = heightAt(x + dx, y + dy);
        if (z > top) { top = z; best = { x: x + dx, y: y + dy }; }
      }
    }
    return best;
  };

  // The street grid of the northern city runs a few degrees off true north. Market Street cuts across at 45.
  const GRID = 0.16;
  const SOMA = GRID + Math.PI / 4;

  // ---- downtown San Francisco: the Financial District and the towers south of Market ----------------
  const towers: Block[] = [];
  const glass = [col(0.5, 0.58, 0.66), col(0.62, 0.66, 0.7), col(0.74, 0.72, 0.68), col(0.56, 0.55, 0.55), col(0.42, 0.48, 0.56), col(0.82, 0.8, 0.75), col(0.36, 0.38, 0.42)];
  const core = { x: 4720, y: -4200 };
  for (let y = -5250; y <= -3350; y += 78) {
    for (let x = 3850; x <= 5450; x += 78) {
      const px = x + (rnd() - 0.5) * 40;
      const py = y + (rnd() - 0.5) * 40;
      const dist = Math.hypot((px - core.x) / 760, (py - core.y) / 880);
      const pull = Math.max(0, 1 - dist);
      if (rnd() > 0.2 + pull * 0.75 || !dry(px, py) || heightAt(px, py) > 55) continue;
      const tall = rnd();
      const h = 28 + pull * (40 + tall * tall * 185) + rnd() * 18;
      const w = 26 + rnd() * 26;
      towers.push({
        x: px, y: py, base: footing(px, py, 20) - 1, w, d: w * (0.7 + rnd() * 0.6), h,
        turn: py < -4350 ? SOMA : GRID, color: glass[Math.floor(rnd() * glass.length)].clone().multiplyScalar(0.62 + rnd() * 0.3),
      });
    }
  }
  // A handful of named heights so the skyline has its real peaks: 555 California, 181 Fremont, the Embarcadero Center slabs.
  const named: Array<[number, number, number, number, THREE.Color]> = [
    [4290, -4060, 237, 44, col(0.42, 0.33, 0.28)],
    [4830, -4500, 245, 34, col(0.5, 0.56, 0.62)],
    [4560, -4330, 212, 38, col(0.66, 0.68, 0.7)],
    [4650, -3960, 174, 30, col(0.78, 0.76, 0.72)],
    [4750, -3930, 126, 30, col(0.78, 0.76, 0.72)],
    [4850, -3900, 126, 30, col(0.78, 0.76, 0.72)],
    [5010, -4640, 184, 34, col(0.45, 0.52, 0.6)],
  ];
  for (const [x, y, h, w, c] of named) if (dry(x, y)) towers.push({ x, y, base: footing(x, y, 20) - 1, w, d: w, h, turn: y < -4350 ? SOMA : GRID, color: c });
  group.add(boxes(towers, 'downtown'));

  const pale = new THREE.MeshStandardMaterial({ color: 0xe6e3da });
  const add = (mesh: THREE.Object3D, x: number, y: number, base: number) => {
    mesh.position.set(x, base, -y);
    group.add(mesh);
    return mesh;
  };
  // Transamerica Pyramid: 260 m, four-sided.
  {
    const p = { x: 4147, y: -3869 };
    const pyramid = new THREE.Mesh(new THREE.ConeGeometry(37, 260, 4, 1).translate(0, 130, 0), pale);
    pyramid.rotation.y = Math.PI / 4 + GRID;
    add(pyramid, p.x, p.y, footing(p.x, p.y, 25) - 1);
  }
  // Salesforce Tower: 326 m, the tallest, a rounded shaft that tapers to a crown.
  {
    const p = { x: 4666, y: -4481 };
    const base = footing(p.x, p.y, 25) - 1;
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fa3b4 });
    add(new THREE.Mesh(new THREE.CylinderGeometry(25, 29, 250, 10).translate(0, 125, 0), mat), p.x, p.y, base);
    add(new THREE.Mesh(new THREE.CylinderGeometry(15, 25, 76, 10).translate(0, 288, 0), mat), p.x, p.y, base);
  }
  // Coit Tower, on the top of Telegraph Hill.
  {
    const p = summitNear(3884, -3069, 240);
    const base = heightAt(p.x, p.y);
    add(new THREE.Mesh(new THREE.CylinderGeometry(5.2, 6, 58, 12).translate(0, 29, 0), pale), p.x, p.y, base - 1);
    add(new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 7, 12).translate(0, 61, 0), pale), p.x, p.y, base - 1);
  }
  // Ferry Building: a long low hall on the Embarcadero with its clock tower.
  {
    const s = shoreFrom(4780, -3900, Math.cos(0.5), Math.sin(0.5), 600);
    if (s) {
      const fx = s.x - 30;
      const fy = s.y - 16;
      const hall = new THREE.Mesh(new THREE.BoxGeometry(200, 15, 46).translate(0, 7.5, 0), new THREE.MeshStandardMaterial({ color: 0xcfc9bc }));
      // The hall lies along the waterfront, square to the way out to sea.
      hall.rotation.y = 0.5 + Math.PI / 2;
      add(hall, fx, fy, heightAt(fx, fy));
      add(new THREE.Mesh(new THREE.BoxGeometry(9, 75, 9).translate(0, 37.5, 0), pale), fx, fy, heightAt(fx, fy));
    }
  }
  // Sutro Tower: three legs, 298 m, red and white, on its hill above the fog.
  {
    const p = { x: -246, y: -8317 };
    const base = heightAt(p.x, p.y);
    const red = new THREE.MeshStandardMaterial({ color: 0xc8402c });
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e7e0 });
    const tower = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      // Each leg leans in to the waist at two thirds height, then runs straight up as a mast.
      const foot = new THREE.Vector3(Math.cos(a) * 45, 0, Math.sin(a) * 45);
      const waist = new THREE.Vector3(Math.cos(a) * 14, 200, Math.sin(a) * 14);
      const top = new THREE.Vector3(Math.cos(a) * 18, 298, Math.sin(a) * 18);
      for (const [from, to, r, mat] of [[foot, waist, 3.4, red], [waist, top, 2.2, white]] as Array<[THREE.Vector3, THREE.Vector3, number, THREE.Material]>) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, from.distanceTo(to), 6), mat);
        leg.position.copy(from).add(to).multiplyScalar(0.5);
        leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        tower.add(leg);
      }
    }
    for (const [y, r, mat] of [[96, 34, white], [200, 19, red], [232, 22, white], [270, 24, red]] as Array<[number, number, THREE.Material]>) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 5, 3), mat);
      ring.position.y = y;
      tower.add(ring);
    }
    add(tower, p.x, p.y, base - 2);
  }

  // ---- the rest of the city: low blocks over the northern waterfront and the hills behind it --------
  const fabric: Block[] = [];
  const stucco = [col(0.86, 0.84, 0.78), col(0.8, 0.77, 0.7), col(0.9, 0.88, 0.84), col(0.74, 0.72, 0.68), col(0.83, 0.76, 0.66), col(0.7, 0.74, 0.76), col(0.88, 0.82, 0.74)];
  for (let y = -7400; y <= -2300; y += 150) {
    for (let x = -6200; x <= 5700; x += 150) {
      const px = x + (rnd() - 0.5) * 70;
      const py = y + (rnd() - 0.5) * 70;
      const z = heightAt(px, py);
      if (z < 1.2 || landUse(px, py, z) !== 'city') continue;
      // Thin the far side of the hills, which nobody on the water can see, and thin with distance from the bay.
      const inland = THREE.MathUtils.smoothstep(-py, 4300, 7400);
      if (rnd() < 0.25 + inland * 0.55) continue;
      const mid = Math.hypot(px - core.x, py - core.y) < 1500;
      fabric.push({
        x: px, y: py, base: footing(px, py, 45) - 2, w: 70 + rnd() * 45, d: 60 + rnd() * 40, h: (mid ? 22 : 10) + rnd() * (mid ? 26 : 12) + 2,
        turn: GRID, color: stucco[Math.floor(rnd() * stucco.length)].clone().multiplyScalar(0.62 + rnd() * 0.36),
      });
    }
  }
  // Apartment towers on Russian Hill and Nob Hill, which stand out from the water.
  for (const hill of [summitNear(2400, -3250, 300), summitNear(2950, -4100, 300)]) {
    for (let k = 0; k < 9; k++) {
      const px = hill.x + (rnd() - 0.5) * 520;
      const py = hill.y + (rnd() - 0.5) * 420;
      if (!dry(px, py)) continue;
      fabric.push({ x: px, y: py, base: footing(px, py, 15) - 1, w: 24 + rnd() * 10, d: 22 + rnd() * 10, h: 45 + rnd() * 55, turn: GRID, color: stucco[Math.floor(rnd() * 3)].clone() });
    }
  }
  // Emeryville and the east shore, far off: a few slabs so the far side is not bare.
  for (let k = 0; k < 60; k++) {
    const px = 9000 + rnd() * 4000;
    const py = -6000 + rnd() * 12000;
    const z = heightAt(px, py);
    if (z < 1.2 || z > 60) continue;
    fabric.push({ x: px, y: py, base: z - 2, w: 80 + rnd() * 80, d: 70 + rnd() * 60, h: 12 + rnd() * rnd() * 70, turn: 0.3, color: stucco[Math.floor(rnd() * stucco.length)].clone().multiplyScalar(0.9) });
  }
  group.add(boxes(fabric, 'city_blocks'));

  // ---- the waterfront: finger piers ---------------------------------------------------------------
  const piers: Block[] = [];
  const sheds: Block[] = [];
  const pierAt = (lx: number, ly: number, dirX: number, dirY: number, len: number, wide: number) => {
    const s = shoreFrom(lx, ly, dirX, dirY);
    if (!s) return;
    // A pier is only a pier if there is water for its whole length.
    if (dry(s.x + dirX * (len * 0.5 + 20), s.y + dirY * (len * 0.5 + 20)) || dry(s.x + dirX * (len + 15), s.y + dirY * (len + 15))) return;
    const cx = s.x + dirX * (len / 2 - 6);
    const cy = s.y + dirY * (len / 2 - 6);
    // Box local +X is turned onto the pier's direction. Scene Z is south, so north in the course is -Z.
    const turn = Math.atan2(dirY, dirX);
    piers.push({ x: cx, y: cy, base: -2, w: len, d: wide, h: 5.2, turn, color: col(0.52, 0.5, 0.46) });
    sheds.push({ x: cx - dirX * 4, y: cy - dirY * 4, base: 3.2, w: len * 0.86, d: wide * 0.72, h: 8.5 + rnd() * 3, turn, color: col(0.84, 0.83, 0.79).multiplyScalar(0.9 + rnd() * 0.15) });
  };
  // The Embarcadero runs from Fisherman's Wharf round the north-east corner and down to the Bay Bridge.
  // Piers leave it square to the shore. March along the line of the waterfront and let the terrain find the edge.
  const front: Array<[number, number]> = [[2500, -2900], [3400, -2850], [4050, -2950], [4500, -3350], [4850, -3900], [5150, -4450], [5350, -5050], [5450, -5600]];
  for (let k = 0; k < front.length - 1; k++) {
    const [ax, ay] = front[k];
    const [bx, by] = front[k + 1];
    const seg = Math.hypot(bx - ax, by - ay);
    // Outward is to the left of the direction of travel here: north along the wharf, north-east and east further round.
    const ox = -(by - ay) / seg;
    const oy = (bx - ax) / seg;
    for (let d = 40; d < seg; d += 135 + rnd() * 30) {
      const t = d / seg;
      pierAt(ax + (bx - ax) * t, ay + (by - ay) * t, ox, oy, 150 + rnd() * 90, 34 + rnd() * 10);
    }
  }
  // Fort Mason's three piers, and the long curved Municipal Pier at Aquatic Park, drawn straight.
  for (const fx of [1280, 1400, 1520]) pierAt(fx, -2800, -0.12, 0.99, 170, 36);
  pierAt(2050, -2900, -0.2, 0.98, 330, 9);
  group.add(boxes(piers, 'piers'), boxes(sheds, 'pier_sheds'));

  // ---- Fort Point: the brick fort under the south end of the bridge -------------------------------
  {
    const [sx, sy] = course.bridge.south;
    const [nx, ny] = course.bridge.north;
    const len = Math.hypot(nx - sx, ny - sy);
    const ux = (nx - sx) / len;
    const uy = (ny - sy) / len;
    // Walk south along the bridge from the south tower until the shore.
    for (let d = 40; d < 700; d += 10) {
      const px = sx - ux * d;
      const py = sy - uy * d;
      if (dry(px, py)) {
        const fx = px - ux * 32;
        const fy = py - uy * 32;
        const fort = new THREE.Mesh(new THREE.BoxGeometry(62, 15, 46).translate(0, 7.5, 0), new THREE.MeshStandardMaterial({ color: 0x8a4a38 }));
        fort.rotation.y = Math.atan2(uy, ux);
        add(fort, fx, fy, Math.max(1, footing(fx, fy, 20)) - 1);
        break;
      }
    }
  }

  // ---- Alcatraz: cellhouse on the crown, lighthouse, water tower, the old barracks by the dock ------
  {
    const top = summitNear(2371, -367, 220);
    // The island lies north-west to south-east. Find that axis from where the land runs furthest.
    let axis = 0;
    let longest = 0;
    for (let a = 0; a < Math.PI; a += Math.PI / 18) {
      let run = 0;
      for (const dir of [-1, 1]) {
        let d = 0;
        while (d < 500 && dry(top.x + Math.cos(a) * d * dir, top.y + Math.sin(a) * d * dir)) d += 10;
        run += d;
      }
      if (run > longest) { longest = run; axis = a; }
    }
    const ax = Math.cos(axis);
    const ay = Math.sin(axis);
    const grey = new THREE.MeshStandardMaterial({ color: 0xc9c5b8 });
    // The crown of the island was levelled for the prison, so the cellhouse sits on the summit height.
    const cell = new THREE.Mesh(new THREE.BoxGeometry(150, 20, 48).translate(0, 10, 0), grey);
    cell.rotation.y = axis;
    add(cell, top.x, top.y, heightAt(top.x, top.y) - 6);
    // Lighthouse toward one end, water tower toward the other. Use whichever end is the lower for the lighthouse side.
    const put = (d: number, build: (x: number, y: number, base: number) => void) => {
      for (let s = d; Math.abs(s) > 20; s -= Math.sign(d) * 10) {
        const px = top.x + ax * s;
        const py = top.y + ay * s;
        if (heightAt(px, py) > 6) { build(px, py, heightAt(px, py)); return; }
      }
    };
    put(-118, (x, y, base) => {
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 26, 10).translate(0, 13, 0), pale), x, y, base - 1);
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 8).translate(0, 27.5, 0), new THREE.MeshStandardMaterial({ color: 0x30343a })), x, y, base - 1);
    });
    put(150, (x, y, base) => {
      const rust = new THREE.MeshStandardMaterial({ color: 0x9c8c78 });
      add(new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 9, 10).translate(0, 24, 0), rust), x, y, base - 1);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 20, 4).translate(0, 10, 0), rust), x + Math.cos(a) * 4, y + Math.sin(a) * 4, base - 1);
      }
    });
    // Barracks: a long block low on the north-east side, by the dock.
    for (let d = 40; d < 260; d += 10) {
      const px = top.x - ay * d + ax * 40;
      const py = top.y + ax * d + ay * 40;
      if (!dry(px + -ay * 30, py + ax * 30)) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(110, 16, 20).translate(0, 8, 0), new THREE.MeshStandardMaterial({ color: 0xd8d2c2 }));
        block.rotation.y = axis;
        // Step back from the water's edge onto the quay.
        const bx = px + ay * 25;
        const by = py - ax * 25;
        add(block, bx, by, Math.max(2.5, heightAt(bx, by)) - 1);
        break;
      }
    }
  }

  // ---- hillside towns: Sausalito, Tiburon and Belvedere --------------------------------------------
  const houses: Block[] = [];
  const paintwork = [col(0.92, 0.9, 0.85), col(0.84, 0.8, 0.72), col(0.78, 0.74, 0.68), col(0.88, 0.84, 0.8), col(0.66, 0.6, 0.52), col(0.8, 0.84, 0.86), col(0.72, 0.56, 0.46)];
  const scatter = (x0: number, x1: number, y0: number, y1: number, step: number, zMax: number, reach: number) => {
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const px = x + (rnd() - 0.5) * step;
        const py = y + (rnd() - 0.5) * step;
        const z = heightAt(px, py);
        if (z < 2 || z > zMax) continue;
        // Houses crowd the slopes that look over the water, thinning as they climb.
        let near = false;
        for (let a = 0; a < 6 && !near; a++) near = !dry(px + Math.cos(a) * reach, py + Math.sin(a) * reach);
        if (!near || rnd() < 0.25 + (z / zMax) * 0.45) continue;
        houses.push({ x: px, y: py, base: footing(px, py, 8) - 1, w: 11 + rnd() * 9, d: 9 + rnd() * 6, h: 6 + rnd() * 5, turn: rnd() * Math.PI, color: paintwork[Math.floor(rnd() * paintwork.length)].clone() });
      }
    }
  };
  scatter(-4000, -2100, 2300, 4700, 62, 150, 520);
  scatter(-1700, 1000, 3800, 6000, 66, 120, 420);
  // Treasure Island's low blocks.
  for (let k = 0; k < 40; k++) {
    const px = 6300 + rnd() * 1500;
    const py = -1400 + rnd() * 2100;
    if (heightAt(px, py) < 1.2) continue;
    houses.push({ x: px, y: py, base: heightAt(px, py) - 1, w: 50 + rnd() * 50, d: 22 + rnd() * 20, h: 8 + rnd() * 8, turn: -0.45, color: paintwork[Math.floor(rnd() * 4)].clone() });
  }
  group.add(boxes(houses, 'houses'));

  // ---- marinas: masts in the water off Sausalito, Tiburon and the Marina district -------------------
  {
    const hulls: Block[] = [];
    const masts: Array<[number, number, number]> = [];
    const basin = (x0: number, x1: number, y0: number, y1: number, turn: number, count: number) => {
      let placed = 0;
      for (let tries = 0; tries < count * 14 && placed < count; tries++) {
        const row = Math.floor(rnd() * 12);
        const px = x0 + rnd() * (x1 - x0);
        const py = y0 + (row / 12) * (y1 - y0);
        if (heightAt(px, py) > 0.3) continue;
        // In a marina the boats lie close under the shore.
        let sheltered = false;
        for (let a = 0; a < 6 && !sheltered; a++) sheltered = dry(px + Math.cos(a * 1.05) * 230, py + Math.sin(a * 1.05) * 230);
        if (!sheltered) continue;
        const len = 9 + rnd() * 6;
        hulls.push({ x: px, y: py, base: -0.3, w: len, d: 3.2, h: 1.5, turn, color: rnd() < 0.8 ? col(0.93, 0.93, 0.9) : col(0.14, 0.22, 0.36) });
        masts.push([px, py, len * 1.25]);
        placed++;
      }
    };
    basin(-2950, -2150, 2700, 4500, 0.9, 150);
    basin(-950, -150, 4300, 5000, 0.2, 45);
    basin(150, 1150, -2700, -2400, 1.5, 40);
    group.add(boxes(hulls, 'marina_hulls'));
    // Masts are drawn a little stouter than life so a marina still reads as a thicket from a mile off.
    const mastMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.32, 1, 4).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xdedcd4 }), masts.length);
    const m = new THREE.Matrix4();
    masts.forEach(([x, y, h], i) => mastMesh.setMatrixAt(i, m.makeScale(1, h, 1).setPosition(x, 1, -y)));
    mastMesh.name = 'marina_masts';
    mastMesh.frustumCulled = false;
    group.add(mastMesh);
  }

  // ---- the Bay Bridge, western span: two suspension bridges end to end, city shore to Yerba Buena ----
  {
    // The city anchorage is on Rincon Hill, the far one on Yerba Buena Island. Both are pulled onto land if they miss.
    let a = { x: 5448, y: -4681 };
    let b = { x: 7205, y: -2502 };
    const pull = (p: { x: number; y: number }, toward: { x: number; y: number }) => {
      const d = Math.hypot(toward.x - p.x, toward.y - p.y);
      for (let s = 0; s < 600 && !dry(p.x, p.y); s += 20) p = { x: p.x - ((toward.x - p.x) / d) * 20, y: p.y - ((toward.y - p.y) / d) * 20 };
      return p;
    };
    a = pull(a, b);
    b = pull(b, a);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const bridge = new THREE.Group();
    bridge.name = 'bay_bridge';
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2a6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x6f777b });
    const DECK = 62;
    const TOP = 158;
    const W = 20;
    const part = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      bridge.add(m);
    };
    // Double deck, with the approach running back over the city.
    part(steel, len + 500, 3, W, len / 2 - 250, DECK, 0);
    part(dark, len + 500, 9, W - 1, len / 2 - 250, DECK - 6, 0);
    const marks = [0.14, 0.38, 0.5, 0.62, 0.86];
    const cable: number[] = [];
    marks.forEach((f, k) => {
      const x = len * f;
      if (k === 2) {
        // The central anchorage: a concrete block as tall as the roadway.
        part(new THREE.MeshStandardMaterial({ color: 0xb4b1a6 }), 60, DECK + 14, 34, x, (DECK + 14) / 2, 0);
        return;
      }
      for (const side of [-1, 1]) part(steel, 7, TOP, 5, x, TOP / 2, side * (W / 2 + 2));
      for (const y of [24, DECK + 24, DECK + 56, TOP - 6]) part(steel, 5, 6, W + 4, x, y, 0);
      // The X bracing that gives these towers their look.
      for (const [y, hgt] of [[DECK + 40, 28], [44, 34]] as Array<[number, number]>) {
        for (const dir of [-1, 1]) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, Math.hypot(W + 4, hgt)), steel);
          m.position.set(x, y, 0);
          m.rotation.x = dir * Math.atan2(hgt, W + 4);
          bridge.add(m);
        }
      }
    });
    // Cables: anchorage, tower, tower, centre anchorage, and the same again.
    const ends = [0, marks[0], marks[1], marks[2], marks[3], marks[4], 1].map((f) => f * len);
    const tops = [DECK, TOP, TOP, DECK + 10, TOP, TOP, DECK];
    for (const side of [-1, 1]) {
      const z = side * (W / 2 + 2);
      for (let k = 0; k < ends.length - 1; k++) {
        const N = 14;
        const sag = k === 1 || k === 4 ? TOP - DECK - 6 : 14;
        let px = ends[k];
        let py = tops[k];
        for (let i = 1; i <= N; i++) {
          const u = i / N;
          const x = ends[k] + (ends[k + 1] - ends[k]) * u;
          const y = tops[k] + (tops[k + 1] - tops[k]) * u - sag * 4 * u * (1 - u);
          cable.push(px, py, z, x, y, z);
          if (i < N) cable.push(x, y, z, x, DECK, z);
          px = x;
          py = y;
        }
      }
    }
    bridge.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(cable, 3)), new THREE.LineBasicMaterial({ color: 0x8b9397 })));
    bridge.position.set(a.x, 0, -a.y);
    bridge.rotation.y = Math.atan2(b.y - a.y, b.x - a.x);
    group.add(bridge);
  }

  // ---- trees: dark clumps in the Presidio, on Angel Island and in the gullies of the headlands -------
  {
    const clump = new THREE.IcosahedronGeometry(1, 0);
    const spots: Array<[number, number, number, number]> = [];
    const plant = (x0: number, x1: number, y0: number, y1: number, step: number, keep: (x: number, y: number, z: number) => boolean) => {
      for (let y = y0; y <= y1; y += step) {
        for (let x = x0; x <= x1; x += step) {
          const px = x + (rnd() - 0.5) * step;
          const py = y + (rnd() - 0.5) * step;
          const z = heightAt(px, py);
          if (z < 2.5 || !keep(px, py, z)) continue;
          spots.push([px, py, z, 12 + rnd() * 14]);
        }
      }
    };
    const wooded = (x: number, y: number, z: number) => landUse(x, y, z) === 'forest' && rnd() < 0.75;
    plant(-6100, 150, -5300, -2250, 96, wooded);
    plant(500, 3300, 2100, 4500, 84, wooded);
    plant(6600, 8000, -2700, -1500, 110, wooded);
    // Headlands and the Tiburon ridge: only the sheltered gullies hold trees.
    plant(-9000, -2000, -1700, 5200, 170, (x, y, z) => z < 260 && smoothNoise(x / 420, y / 420) * 0.6 + smoothNoise(x / 130, y / 130) * 0.4 > 0.66 && rnd() < 0.5);
    plant(-1800, 1100, 3700, 6400, 120, (_x, _y, z) => z < 180 && rnd() < 0.3);
    const trees = new THREE.InstancedMesh(clump, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    spots.forEach(([x, y, z, r], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      m.compose(new THREE.Vector3(x, z + r * 0.3, -y), q, new THREE.Vector3(r * (1.2 + rnd() * 0.8), r * (0.6 + rnd() * 0.3), r * (1.2 + rnd() * 0.8)));
      trees.setMatrixAt(i, m);
      trees.setColorAt(i, c.setRGB(0.15 + rnd() * 0.06, 0.23 + rnd() * 0.09, 0.13 + rnd() * 0.05));
    });
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
    trees.name = 'trees';
    trees.frustumCulled = false;
    group.add(trees);
  }

  return group;
}
