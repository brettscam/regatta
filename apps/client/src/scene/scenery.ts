import * as THREE from 'three';
import type { CourseData } from '@slack-tide/world';
import { buildCity } from './city';
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
 * The city, Alcatraz and the Bay Bridge are built in `city.ts` from real latitudes and longitudes. The rest is placed
 * from general knowledge and checked against the terrain, so nothing is built on water.
 * Course coordinates are metres east (x) and north (y). In the scene that is X east and Z south.
 */
export function buildScenery(course: CourseData, terrainHeights: Uint8Array, depths: Uint8Array): THREE.Group {
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
  // The course's own projection: flat metres east and north of its origin.
  const M_PER_DEG = (6371008.8 * Math.PI) / 180;
  const M_PER_DEG_LON = M_PER_DEG * Math.cos((course.origin.lat * Math.PI) / 180);
  const at = (lat: number, lon: number) => ({ x: (lon - course.origin.lon) * M_PER_DEG_LON, y: (lat - course.origin.lat) * M_PER_DEG });
  /**
   * True where a boat can float at some state of the tide, read from the depth chart the way the world reads it.
   * Piers, floats and moored ships are only ever put where this is false, so nothing drawn stands in sailing water.
   */
  const sailable = (x: number, y: number): boolean => {
    const dg = course.depth;
    const fx = (x - dg.x0) / dg.dx;
    const fy = (y - dg.y0) / dg.dx;
    if (fx < 0 || fy < 0 || fx > dg.nx - 1 || fy > dg.ny - 1) return true;
    const i = Math.min(dg.nx - 2, Math.floor(fx));
    const j = Math.min(dg.ny - 2, Math.floor(fy));
    const u = fx - i;
    const v = fy - j;
    const o = j * dg.nx + i;
    const a = depths[o];
    const b = depths[o + 1];
    const c = depths[o + dg.nx];
    const e = depths[o + dg.nx + 1];
    let charted: number;
    if (a === 0 || b === 0 || c === 0 || e === 0) {
      const near = v < 0.5 ? (u < 0.5 ? a : b) : u < 0.5 ? c : e;
      charted = near === 0 ? 0 : Math.min(...[a, b, c, e].filter((n) => n > 0)) * dg.scale * 0.5;
    } else {
      charted = ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v) * dg.scale;
    }
    // The shallowest boat draws 1.6 m and the highest tide of the season adds 0.85 m.
    return charted >= 0.7;
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

  const add = (mesh: THREE.Object3D, x: number, y: number, base: number) => {
    mesh.position.set(x, base, -y);
    group.add(mesh);
    return mesh;
  };

  // ---- San Francisco, Alcatraz, the Bay Bridge and the smaller shores: one mesh, built in city.ts ----
  const city = buildCity({ at, heightAt, dry, footing, shoreFrom, summitNear, sailable, rnd });
  for (const o of city.objects) group.add(o);
  group.userData.placed = city.placed;
  group.userData.cityTriangles = city.triangles;

  // Emeryville and the east shore, far off: a few slabs so the far side is not bare.
  const fabric: Block[] = [];
  const stucco = [col(0.86, 0.84, 0.78), col(0.8, 0.77, 0.7), col(0.9, 0.88, 0.84), col(0.74, 0.72, 0.68), col(0.83, 0.76, 0.66), col(0.7, 0.74, 0.76), col(0.88, 0.82, 0.74)];
  for (let k = 0; k < 60; k++) {
    const px = 9000 + rnd() * 4000;
    const py = -6000 + rnd() * 12000;
    const z = heightAt(px, py);
    if (z < 1.2 || z > 60) continue;
    fabric.push({ x: px, y: py, base: z - 2, w: 80 + rnd() * 80, d: 70 + rnd() * 60, h: 12 + rnd() * rnd() * 70, turn: 0.3, color: stucco[Math.floor(rnd() * stucco.length)].clone().multiplyScalar(0.9) });
  }
  group.add(boxes(fabric, 'east_shore'));

  // ---- Fort Point: the brick fort under the south end of the bridge -------------------------------
  if (course.bridge) {
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
    // The grove round Coit Tower on Telegraph Hill, and the trees on Alcatraz's sheltered side.
    plant(3760, 4000, -3190, -2950, 44, (_x, _y, z) => z > 45 && rnd() < 0.5);
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
