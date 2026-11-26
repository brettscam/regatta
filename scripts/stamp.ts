// Writes a water's built structures (features.json `structures`: breakwaters, piers, platforms, man-made islands) into
// its baked depth and land, so that they are solid to every boat, pilot, test and script that reads the chart.
// Usage: npx vite-node scripts/stamp.ts <course folder> [check]
//   with `check` nothing is written: it says what it would change, and exits 1 if anything would.
//
// What it does, and it does the same if run twice:
//   - adds any depth inset the course definition (pipeline/courses/<id>.json) names that the baked course lacks, filled
//     from the coarse grid, so a platform in open water has 50 m cells to stand in;
//   - a breakwater or pier becomes a line of land cells one cell wide; a platform, the one cell at its centre; an island,
//     the cells inside its radius. Only the finest grid covering a place is written;
//   - land cells the tide model had left in bits near a wall or an island (it sees a breakwater as a row of rocks) are
//     made water again, so what is solid is what is drawn;
//   - the elevation tiles' lumps along a wall and under an island are taken out of the land, because the structure is
//     drawn in their place.
// Run it after `pipeline/bake.py`, which knows nothing of structures.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { CourseData, GridSpec } from '@slack-tide/world';
import type { CourseFeatures, Structure } from '../apps/client/src/world/features';

const [id, mode] = process.argv.slice(2);
if (!id) throw new Error('Which water? npx vite-node scripts/stamp.ts <course folder>');
const dir = new URL(`../courses/${id}/`, import.meta.url);
const course = JSON.parse(readFileSync(new URL('course.json', dir), 'utf8')) as CourseData;
const features = JSON.parse(readFileSync(new URL('features.json', dir), 'utf8')) as CourseFeatures;
const structures = features.structures ?? [];
let depth = new Uint8Array(readFileSync(new URL('depth.bin', dir)));
const terrain = new Uint8Array(readFileSync(new URL('terrain.bin', dir)));
const before = { depth: Buffer.from(depth).toString('base64'), terrain: Buffer.from(terrain).toString('base64'), course: JSON.stringify(course) };

/** Distance from a point to a line of points. */
function toLine(line: Array<[number, number]>, x: number, y: number): number {
  let best = 1e9;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
    best = Math.min(best, Math.hypot(x - ax - (bx - ax) * u, y - ay - (by - ay) * u));
  }
  return best;
}
const within = (g: GridSpec, x: number, y: number) => x >= g.x0 && y >= g.y0 && x <= g.x0 + (g.nx - 1) * g.dx && y <= g.y0 + (g.ny - 1) * g.dx;

// ---- depth insets the definition asks for and the bake did not make -----------------------------
const defPath = new URL(`../pipeline/courses/${id}.json`, import.meta.url);
if (existsSync(defPath)) {
  const def = JSON.parse(readFileSync(defPath, 'utf8')) as { insets?: { depth?: Array<{ name: string; box: [number, number, number, number]; dx: number }> } };
  const main = course.depth;
  for (const want of def.insets?.depth ?? []) {
    if (main.insets?.some((g) => (g as GridSpec & { name?: string }).name === want.name)) continue;
    const [x0, y0, x1, y1] = want.box;
    const g = { x0, y0, dx: want.dx, nx: Math.round((x1 - x0) / want.dx) + 1, ny: Math.round((y1 - y0) / want.dx) + 1, name: want.name };
    const cells = new Uint8Array(g.nx * g.ny);
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        // The coarse grid, read as the world reads it: straight between four wet corners, the nearest corner beside land.
        const fx = Math.min(main.nx - 1.001, Math.max(0, (g.x0 + i * g.dx - main.x0) / main.dx));
        const fy = Math.min(main.ny - 1.001, Math.max(0, (g.y0 + j * g.dx - main.y0) / main.dx));
        const ci = Math.floor(fx);
        const cj = Math.floor(fy);
        const u = fx - ci;
        const v = fy - cj;
        const o = cj * main.nx + ci;
        const [a, b, c, e] = [depth[o], depth[o + 1], depth[o + main.nx], depth[o + main.nx + 1]];
        cells[j * g.nx + i] = a && b && c && e ? Math.max(1, Math.round((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v)) : v < 0.5 ? (u < 0.5 ? a : b) : u < 0.5 ? c : e;
      }
    }
    const grown = new Uint8Array(depth.length + cells.length);
    grown.set(depth);
    grown.set(cells, depth.length);
    depth = grown;
    (main.insets ??= []).push(g);
    console.log(`depth inset added: ${want.name}, ${g.nx} by ${g.ny} at ${g.dx} m`);
  }
}

// ---- the grids, each with where its cells begin ---------------------------------------------------
function parts(main: GridSpec & { insets?: GridSpec[] }): Array<{ g: GridSpec; start: number; finer: GridSpec[] }> {
  const out = [{ g: main as GridSpec, start: 0, finer: main.insets ?? [] }];
  let o = main.nx * main.ny;
  for (const g of main.insets ?? []) {
    out.push({ g, start: o, finer: [] });
    o += g.nx * g.ny;
  }
  return out;
}

const lines = structures.filter((s) => s.line && (s.kind === 'breakwater' || s.kind === 'pier'));
const islands = structures.filter((s) => s.kind === 'island' && s.x !== undefined && s.y !== undefined && s.r);
const platforms = structures.filter((s) => s.kind === 'platform' && s.x !== undefined && s.y !== undefined);
/** How far from a wall or an island's edge the model's stray land is cleared away, metres. */
const CLEAR = 130;

let made = 0;
let cleared = 0;
for (const { g, start, finer } of parts(course.depth)) {
  const solid = g.dx * 0.71;
  const covered = (s: Structure): boolean => {
    const pts = s.line ?? [[s.x!, s.y!]];
    return pts.every(([x, y]) => finer.some((f) => within(f, x, y)));
  };
  // Stray land is filled with the water around it: the middle value of the wet cells of this grid within 300 m.
  const fill = (i: number, j: number): number => {
    const near: number[] = [];
    const reach = Math.ceil(300 / g.dx);
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
      const v = depth[start + jj * g.nx + ii];
      if (v > 0) near.push(v);
    }
    near.sort((a, b) => a - b);
    return near.length ? near[near.length >> 1] : Math.round(8 / course.depth.scale);
  };
  const set: Array<[number, number]> = [];
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const x = g.x0 + i * g.dx;
      const y = g.y0 + j * g.dx;
      // A finer grid is read here instead of this one.
      if (finer.some((f) => within(f, x, y))) continue;
      const k = start + j * g.nx + i;
      let land = false;
      let stray = false;
      for (const s of lines) {
        if (covered(s)) continue;
        const d = toLine(s.line!, x, y);
        if (d <= solid) land = true;
        else if (d <= CLEAR) stray = true;
      }
      for (const s of islands) {
        const d = Math.hypot(x - s.x!, y - s.y!);
        if (d <= s.r!) land = true;
        else if (d <= s.r! + CLEAR + 70) stray = true;
      }
      for (const s of platforms) if (Math.round((s.x! - g.x0) / g.dx) === i && Math.round((s.y! - g.y0) / g.dx) === j) land = true;
      if (land && depth[k] !== 0) { depth[k] = 0; made++; }
      else if (!land && stray && depth[k] === 0) set.push([i, j]);
    }
  }
  // Only stray rocks are cleared: a wall's shore end is among real land, which stays. A rock is land with water within 100 m on every side.
  for (const [i, j] of set) {
    const reach = Math.ceil(100 / g.dx);
    let open = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      for (let r = 1; r <= reach; r++) {
        const ii = i + di * r;
        const jj = j + dj * r;
        if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny || depth[start + jj * g.nx + ii] > 0) { open++; break; }
      }
    }
    if (open < 7) continue;
    depth[start + j * g.nx + i] = fill(i, j);
    cleared++;
  }
}
for (const s of platforms) {
  const g = parts(course.depth).reverse().find((p) => within(p.g, s.x!, s.y!))!.g;
  const off = Math.hypot(((s.x! - g.x0) / g.dx) % 1, ((s.y! - g.y0) / g.dx) % 1);
  if (g.dx > 60) console.log(`WARNING: ${s.name} stands in the ${g.dx} m grid: it will be a ${g.dx} m block. Give it an inset in the course definition`);
  if (off > 0.01) console.log(`WARNING: ${s.name} is not on a cell of its ${g.dx} m grid: what is solid will be up to ${(g.dx / 2).toFixed(0)} m from what is drawn`);
}
for (const s of lines) {
  for (const [x, y] of s.line!) if (!parts(course.depth).some((p) => p.g.dx <= 60 && within(p.g, x, y))) console.log(`WARNING: ${s.name} runs outside the fine depth insets at ${x}, ${y}: it is ${course.depth.dx} m thick there`);
}

// ---- the land: the tiles' lumps along the walls and under the islands go ----------------------------
let lowered = 0;
for (const { g, start } of parts(course.terrain)) {
  // Which land is a lump on its own and which is the shore: lumps are small.
  const label = new Int32Array(g.nx * g.ny).fill(-1);
  const sizes: number[] = [];
  for (let k = 0; k < g.nx * g.ny; k++) {
    if (terrain[start + k] === 0 || label[k] >= 0) continue;
    const n = sizes.length;
    let count = 0;
    const stack = [k];
    label[k] = n;
    while (stack.length) {
      const c = stack.pop()!;
      count++;
      const i = c % g.nx;
      const j = (c / g.nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
        const q = jj * g.nx + ii;
        if (terrain[start + q] !== 0 && label[q] < 0) { label[q] = n; stack.push(q); }
      }
    }
    sizes.push(count);
  }
  const lump = (0.4e6 / (g.dx * g.dx)) | 0;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      if (terrain[start + k] === 0 || sizes[label[k]] > lump) continue;
      const x = g.x0 + i * g.dx;
      const y = g.y0 + j * g.dx;
      const near = lines.some((s) => toLine(s.line!, x, y) <= CLEAR + g.dx) || islands.some((s) => Math.hypot(x - s.x!, y - s.y!) <= s.r! + CLEAR + 70 + g.dx);
      if (near) { terrain[start + k] = 0; lowered++; }
    }
  }
}

// A spike in the elevation tiles: a cell or two standing tens of metres above flat ground all round it (there is one
// on the beach at Belmont Shore, drawn as a hundred-metre pyramid). Real hills have high ground beside them.
let spikes = 0;
for (const { g, start } of parts(course.terrain).slice(1)) {
  const h = (i: number, j: number) => (terrain[start + j * g.nx + i] / 255) ** 2 * course.terrain.max;
  const fixes: Array<[number, number]> = [];
  for (let j = 4; j < g.ny - 4; j++) for (let i = 4; i < g.nx - 4; i++) {
    const z = h(i, j);
    if (z < 30) continue;
    // The ground a few cells off, all round. One or two other spikes may stand in that ring: they are not counted.
    let sum = 0;
    let n = 0;
    let high = 0;
    for (let d = -4; d <= 4; d++) for (const [ii, jj] of [[i + d, j - 4], [i + d, j + 4], [i - 4, j + d], [i + 4, j + d]]) {
      const r = h(ii, jj);
      if (r > z * 0.3) high++;
      else { sum += r; n++; }
    }
    if (high <= 3 && n > 0 && sum / n < 25) fixes.push([j * g.nx + i, Math.round(Math.sqrt(sum / n / course.terrain.max) * 255)]);
  }
  for (const [k, v] of fixes) { terrain[start + k] = v; spikes++; }
}
if (spikes) console.log(`${spikes} cells of a spike in the land levelled`);

// The chart's coastline: the rings round the lumps that have just gone are dropped. The islands' own rings stay.
const rings = (course as unknown as { coast?: number[][] }).coast;
if (rings) {
  const kept = rings.filter((r) => {
    for (let k = 0; k < r.length; k += 2) if (!lines.some((s) => toLine(s.line!, r[k], r[k + 1]) <= CLEAR + 80)) return true;
    return r.length > 60;
  });
  (course as unknown as { coast: number[][] }).coast = kept;
}

const changed = Buffer.from(depth).toString('base64') !== before.depth || Buffer.from(terrain).toString('base64') !== before.terrain || JSON.stringify(course) !== before.course;
console.log(`${course.name}: ${structures.length} structures. ${made} depth cells made land, ${cleared} stray land cells made water, ${lowered} land cells lowered${changed ? '' : '. Nothing to change'}`);
if (mode === 'check') process.exit(changed ? 1 : 0);
if (changed) {
  writeFileSync(new URL('depth.bin', dir), depth);
  writeFileSync(new URL('terrain.bin', dir), terrain);
  writeFileSync(new URL('course.json', dir), JSON.stringify(course));
}
