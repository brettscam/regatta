import * as THREE from 'three';
import type { CourseData } from '@slack-tide/world';
import { onCityNight } from './massing';
import { hash, sandyShore, smoothNoise } from './terrain';

// What a trade-wind water needs that the Bay does not: a map of its shoals for the sea to show turquoise, palms
// along the beaches, yachts on the moorings, and for the Virgin Islands the Baths' boulders and the towns.
// Everything is placed from the course's own terrain and depth, and from hashes, so every player sees the same.
// Course coordinates are metres east (x) and north (y). In the scene that is X east and Z south.

const UP = new THREE.Vector3(0, 1, 0);

/** Height of the land at a course position, metres. 0 over water. */
function heightSampler(course: CourseData, heights: Uint8Array): (x: number, y: number) => number {
  const g = course.terrain;
  const cell = (i: number, j: number) => (heights[Math.min(g.ny - 1, Math.max(0, j)) * g.nx + Math.min(g.nx - 1, Math.max(0, i))] / 255) ** 2 * g.max;
  return (x, y) => {
    const fx = (x - g.x0) / g.dx;
    const fy = (y - g.y0) / g.dx;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    return (cell(i, j) * (1 - u) + cell(i + 1, j) * u) * (1 - v) + (cell(i, j + 1) * (1 - u) + cell(i + 1, j + 1) * u) * v;
  };
}

/** Charted depth at a course position in metres: 0 on land and off the chart. */
function depthSampler(course: CourseData, depths: Uint8Array): (x: number, y: number) => number {
  const d = course.depth;
  return (x, y) => {
    const i = Math.round((x - d.x0) / d.dx);
    const j = Math.round((y - d.y0) / d.dx);
    return i < 0 || j < 0 || i >= d.nx || j >= d.ny ? 0 : depths[j * d.nx + i] * d.scale;
  };
}

function latLon(course: CourseData): (lat: number, lon: number) => { x: number; y: number } {
  const perDeg = (6371008.8 * Math.PI) / 180;
  const perDegLon = perDeg * Math.cos((course.origin.lat * Math.PI) / 180);
  return (lat, lon) => ({ x: (lon - course.origin.lon) * perDegLon, y: (lat - course.origin.lat) * perDeg });
}

export interface ShoalMap {
  texture: THREE.DataTexture;
  /** North-west corner in scene metres, and size east and south. As `Ocean.setShoals` takes them. */
  x: number;
  z: number;
  width: number;
  depth: number;
}

/** How strongly the bottom shows through water of a depth: all of it in a metre or two, none of it past 14 m. */
export function shoalShow(depth: number): number {
  return Math.min(1, Math.max(0, 1 - (depth - 1.5) / 12.5)) ** 1.4;
}

/**
 * The course's depth chart as a picture for the sea to colour itself by: red is how much the bottom shows, green is
 * how much of it is dark (reef and turtle grass in patches, by rule: the chart does not say what the bottom is).
 * Twice the chart's resolution, smoothed, so a 100 m depth grid does not show as squares.
 */
export function shoalMap(course: CourseData, depths: Uint8Array): ShoalMap {
  const d = course.depth;
  const UPSCALE = 2;
  const w = (d.nx - 1) * UPSCALE + 1;
  const h = (d.ny - 1) * UPSCALE + 1;
  const step = d.dx / UPSCALE;
  const data = new Uint8Array(w * h * 4);
  const at = (i: number, j: number) => depths[Math.min(d.ny - 1, j) * d.nx + Math.min(d.nx - 1, i)] * d.scale;
  for (let r = 0; r < h; r++) {
    // The picture's first row is the north edge. The chart's first row is the south.
    const fj = (h - 1 - r) / UPSCALE;
    const j = Math.floor(fj);
    const v = fj - j;
    for (let q = 0; q < w; q++) {
      const fi = q / UPSCALE;
      const i = Math.floor(fi);
      const u = fi - i;
      // Land counts as no depth at all, so the colour runs pale right up the beach.
      const depth = (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
      const x = d.x0 + q * step;
      const y = d.y0 + (h - 1 - r) * step;
      const patch = smoothNoise(x / 190, y / 190) * 0.6 + smoothNoise(x / 55, y / 55) * 0.4;
      // Reef and grass keep off the shallowest sand and thin out with depth.
      const grows = THREE.MathUtils.smoothstep(depth, 1.2, 3.5) * (1 - THREE.MathUtils.smoothstep(depth, 9, 15));
      const k = (r * w + q) * 4;
      data[k] = Math.round(shoalShow(depth) * 255);
      data[k + 1] = Math.round(THREE.MathUtils.smoothstep(patch, 0.5, 0.66) * grows * 0.85 * 255);
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  // A sample sits at the middle of its texel, so the picture reaches half a texel past the chart all round.
  return { texture, x: d.x0 - step / 2, z: -(d.y0 + (d.ny - 1) * d.dx) - step / 2, width: w * step, depth: h * step };
}

/** Coconut palms along the flat, sandy shores. Two draw calls however many there are. */
export function buildPalms(course: CourseData, heights: Uint8Array): THREE.Group {
  const g = course.terrain;
  const heightAt = heightSampler(course, heights);
  const spots: Array<[number, number, number]> = [];
  for (let j = 1; j < g.ny - 1; j++) {
    for (let i = 1; i < g.nx - 1; i++) {
      const x = g.x0 + i * g.dx;
      const y = g.y0 + j * g.dx;
      const z = heightAt(x, y);
      if (z < 0.6 || z > 9 || !sandyShore(x, y)) continue;
      // Low ground beside the water, and not a cliff foot.
      const around = [heightAt(x + g.dx, y), heightAt(x - g.dx, y), heightAt(x, y + g.dx), heightAt(x, y - g.dx)];
      if (!around.some((a) => a < 0.4) || Math.max(...around) > 26) continue;
      for (let n = 0; n < 3; n++) {
        if (hash(i * 7 + n, j * 13 - n) > 0.6) continue;
        const px = x + (hash(i + n * 31, j) - 0.5) * g.dx;
        const py = y + (hash(i, j + n * 17) - 0.5) * g.dx;
        const pz = heightAt(px, py);
        if (pz > 0.7 && pz < 10) spots.push([px, py, pz]);
      }
    }
  }
  const group = new THREE.Group();
  group.name = 'palms';
  // Drawn a little taller than life, as the marina masts are, so a palm beach reads as one from the channel.
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.38, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x8a7a62 }), spots.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const lean = new THREE.Euler();
  const c = new THREE.Color();
  spots.forEach(([x, y, z], k) => {
    const tall = 9 + hash(k, 5) * 6;
    // Palms lean, mostly away from the trade wind.
    lean.set((hash(k, 7) - 0.5) * 0.3, 0, 0.1 + hash(k, 9) * 0.2);
    q.setFromEuler(lean);
    trunks.setMatrixAt(k, m.compose(new THREE.Vector3(x, z - 0.3, -y), q, new THREE.Vector3(1, tall, 1)));
    const top = new THREE.Vector3(0, tall, 0).applyQuaternion(q).add(new THREE.Vector3(x, z - 0.3, -y));
    q.setFromAxisAngle(UP, hash(k, 11) * 6.28);
    const spread = 3.4 + hash(k, 13) * 1.6;
    crowns.setMatrixAt(k, m.compose(top, q, new THREE.Vector3(spread, 1.3, spread)));
    crowns.setColorAt(k, c.setRGB(0.13 + hash(k, 15) * 0.06, 0.33 + hash(k, 17) * 0.1, 0.1));
  });
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  for (const mesh of [trunks, crowns]) {
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  group.userData.count = spots.length;
  return group;
}

/**
 * Yachts lying to moorings off every place that has them, heads to the wind of the first hour.
 * They are scenery: nothing stops a boat sailing through the field, so they are kept few, and clear of the buoy
 * the player picks up.
 */
export function buildMooringFields(course: CourseData, heights: Uint8Array, depths: Uint8Array, places: Array<{ x: number; y: number; kind?: string }>): THREE.Group {
  const depthAt = depthSampler(course, depths);
  const heightAt = heightSampler(course, heights);
  // The way the wind of the first hour blows from, over the whole chart: a moored boat points into it.
  const first = course.wind.truth[0];
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const head = Math.atan2(-mean(first.u), -mean(first.v));
  const boats: Array<{ x: number; y: number; len: number; turn: number; dark: boolean; cat: boolean }> = [];
  places.forEach((place, p) => {
    if (place.kind !== 'mooring') return;
    const want = 9 + Math.floor(hash(p, 3) * 6);
    let placed = 0;
    for (let n = 0; n < want * 8 && placed < want; n++) {
      const r = 55 + hash(p * 101 + n, 1) * 230;
      const a = hash(p * 101 + n, 2) * 6.283;
      const x = place.x + Math.cos(a) * r;
      const y = place.y + Math.sin(a) * r;
      if (depthAt(x, y) < 2.5 || depthAt(x, y) > 22 || heightAt(x, y) > 0.3) continue;
      // Room to swing: no two closer than 45 m.
      if (boats.some((b) => Math.hypot(b.x - x, b.y - y) < 45)) continue;
      boats.push({ x, y, len: 11 + hash(p * 101 + n, 4) * 5, turn: head + (hash(p * 101 + n, 5) - 0.5) * 0.35, dark: hash(p * 101 + n, 6) > 0.85, cat: hash(p * 101 + n, 8) > 0.6 });
      placed++;
    }
  });
  const group = new THREE.Group();
  group.name = 'mooring_fields';
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff });
  // A catamaran is two hulls, so hulls are counted, not boats.
  const hullCount = boats.reduce((s, b) => s + (b.cat ? 2 : 1), 0);
  const hulls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), paint, hullCount);
  const houses = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), paint, boats.length);
  const masts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.2, 1, 4).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xdedcd4 }), boats.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const white = new THREE.Color(0.94, 0.94, 0.91);
  const navy = new THREE.Color(0.13, 0.2, 0.34);
  let h = 0;
  boats.forEach((b, k) => {
    // Scene heading: the model's length lies along local Z, bow toward -Z, turned to compass heading `turn`.
    q.setFromAxisAngle(UP, -b.turn);
    const beam = b.cat ? b.len * 0.5 : b.len * 0.3;
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const centre = new THREE.Vector3(b.x, -0.35, -b.y);
    for (const off of b.cat ? [-beam / 2 + 0.9, beam / 2 - 0.9] : [0]) {
      hulls.setMatrixAt(h, m.compose(centre.clone().addScaledVector(side, off), q, new THREE.Vector3(b.cat ? 1.8 : beam, 1.5, b.len)));
      hulls.setColorAt(h++, b.dark && !b.cat ? navy : white);
    }
    houses.setMatrixAt(k, m.compose(new THREE.Vector3(b.x, b.cat ? 0.9 : 1.05, -b.y), q, new THREE.Vector3(b.cat ? beam * 0.8 : beam * 0.62, b.cat ? 1.5 : 0.7, b.len * (b.cat ? 0.42 : 0.4))));
    houses.setColorAt(k, white);
    masts.setMatrixAt(k, m.makeScale(1, b.len * 1.3, 1).setPosition(b.x, 1, -b.y));
  });
  for (const mesh of [hulls, houses, masts]) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  group.userData.count = boats.length;
  return group;
}

// Where things stand in the Virgin Islands, by latitude and longitude from general knowledge. Each is walked on to
// the baked land before anything is built, so nothing is put in the water.
const BATHS = { lat: 18.4290, lon: -64.4447 };
/** Settlements: name, latitude, longitude, how far the houses reach (m), how many. */
const SETTLEMENTS: Array<[string, number, number, number, number]> = [
  ['Road Town', 18.4270, -64.6200, 1500, 230],
  ['Spanish Town', 18.4490, -64.4330, 800, 70],
  ['West End', 18.3880, -64.7030, 600, 40],
  ['Cane Garden Bay', 18.4270, -64.6580, 500, 36],
  ['Great Harbour', 18.4440, -64.7510, 450, 30],
  ['East End', 18.4420, -64.5600, 700, 45],
  ['Cruz Bay', 18.3310, -64.7940, 700, 60],
  ['Coral Bay', 18.3470, -64.7140, 600, 30],
];

/** The Baths' granite boulders on the shore of Virgin Gorda, and low bright-roofed towns round the harbours. */
export function buildVirginIslands(course: CourseData, heights: Uint8Array): THREE.Group {
  const heightAt = heightSampler(course, heights);
  const at = latLon(course);
  const group = new THREE.Group();
  group.name = 'virgin_islands';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();

  // ---- the Baths: house-sized boulders heaped along the beach and standing in the shallows --------
  {
    const centre = at(BATHS.lat, BATHS.lon);
    // The stretch of shore nearest the charted spot: land cells beside water within 700 m.
    const shore: Array<[number, number]> = [];
    for (let dy = -700; dy <= 700; dy += 25) {
      for (let dx = -700; dx <= 700; dx += 25) {
        const x = centre.x + dx;
        const y = centre.y + dy;
        const z = heightAt(x, y);
        if (z > 0.4 && z < 8 && (heightAt(x - 60, y) < 0.3 || heightAt(x + 60, y) < 0.3 || heightAt(x, y - 60) < 0.3 || heightAt(x, y + 60) < 0.3)) shore.push([x, y]);
      }
    }
    shore.sort((a, b) => Math.hypot(a[0] - centre.x, a[1] - centre.y) - Math.hypot(b[0] - centre.x, b[1] - centre.y));
    const near = shore.slice(0, 120);
    const count = near.length ? 150 : 0;
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 }), count);
    for (let k = 0; k < count; k++) {
      const [sx, sy] = near[Math.floor(hash(k, 21) * near.length)];
      const x = sx + (hash(k, 23) - 0.5) * 90;
      const y = sy + (hash(k, 25) - 0.5) * 90;
      const r = 2.5 + hash(k, 27) ** 2 * 5;
      q.setFromEuler(new THREE.Euler(hash(k, 29) * 3, hash(k, 31) * 6, hash(k, 33) * 3));
      rocks.setMatrixAt(k, m.compose(new THREE.Vector3(x, Math.max(0, heightAt(x, y)) + r * 0.35, -y), q, new THREE.Vector3(r * (1 + hash(k, 35) * 0.5), r * (0.75 + hash(k, 37) * 0.3), r)));
      const tone = 0.5 + hash(k, 39) * 0.16;
      rocks.setColorAt(k, c.setRGB(tone, tone * 0.95, tone * 0.88));
    }
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.name = 'the_baths';
    rocks.frustumCulled = false;
    group.add(rocks);
    group.userData.boulders = count;
  }

  // ---- towns: low houses in island colours, red and white roofs, thickest by the water --------------
  {
    const walls = [[0.95, 0.93, 0.86], [0.93, 0.8, 0.55], [0.6, 0.8, 0.82], [0.92, 0.66, 0.6], [0.8, 0.86, 0.66], [0.9, 0.9, 0.92]];
    const roofs = [[0.66, 0.2, 0.16], [0.9, 0.9, 0.88], [0.3, 0.42, 0.36], [0.7, 0.3, 0.2]];
    const spots: Array<{ x: number; y: number; z: number; w: number; d: number; h: number; turn: number; k: number }> = [];
    SETTLEMENTS.forEach(([, lat, lon, reach, want], s) => {
      const centre = at(lat, lon);
      let placed = 0;
      for (let n = 0; n < want * 12 && placed < want; n++) {
        // Squared, so the houses crowd the middle of the town.
        const r = hash(s * 977 + n, 41) ** 1.3 * reach;
        const a = hash(s * 977 + n, 43) * 6.283;
        const x = centre.x + Math.cos(a) * r;
        const y = centre.y + Math.sin(a) * r;
        const z = heightAt(x, y);
        if (z < 1.2 || z > 90) continue;
        const lowest = Math.min(heightAt(x - 9, y - 9), heightAt(x + 9, y - 9), heightAt(x - 9, y + 9), heightAt(x + 9, y + 9));
        if (lowest < 0.8 || z - lowest > 7) continue;
        const big = s === 0 && r < 500 && hash(s * 977 + n, 45) > 0.7;
        spots.push({ x, y, z: lowest - 0.5, w: big ? 22 + hash(n, 47) * 22 : 9 + hash(n, 47) * 8, d: big ? 14 + hash(n, 49) * 12 : 7 + hash(n, 49) * 5, h: big ? 8 + hash(n, 51) * 9 : 3.6 + hash(n, 51) * 3, turn: hash(s, 53) * 3 + (hash(n, 55) - 0.5) * 0.5, k: s * 977 + n });
        placed++;
      }
    });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const houses = new THREE.InstancedMesh(box, wallMat, spots.length);
    const tops = new THREE.InstancedMesh(box, roofMat, spots.length);
    spots.forEach((b, i) => {
      q.setFromAxisAngle(UP, b.turn);
      houses.setMatrixAt(i, m.compose(new THREE.Vector3(b.x, b.z, -b.y), q, new THREE.Vector3(b.w, b.h, b.d)));
      const wall = walls[Math.floor(hash(b.k, 57) * walls.length)];
      houses.setColorAt(i, c.setRGB(wall[0], wall[1], wall[2]));
      tops.setMatrixAt(i, m.compose(new THREE.Vector3(b.x, b.z + b.h, -b.y), q, new THREE.Vector3(b.w + 1.2, 0.9, b.d + 1.2)));
      const roof = roofs[Math.floor(hash(b.k, 59) * roofs.length)];
      tops.setColorAt(i, c.setRGB(roof[0], roof[1], roof[2]));
    });
    for (const mesh of [houses, tops]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    houses.name = 'island_towns';
    // Lamps in the windows after dark.
    onCityNight((n) => wallMat.emissive.setRGB(0.5 * n, 0.36 * n, 0.16 * n));
    group.userData.houses = spots.length;
  }
  return group;
}
