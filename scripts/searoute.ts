// Finds a way through the water between points, keeping off the shoals and the race marks, and prints it as way points.
// For laying out a resident boat's line (courses/<id>/residents.json) or a ferry's (traffic.json).
// Usage: npx vite-node scripts/searoute.ts <course> <depth wanted, m> <metres to keep off shoal water> x0 y0 x1 y1 [x2 y2 ...]
//   The depth wanted is at the lowest tide of the season. Each point given is moved to the nearest water deep enough.
import { existsSync, readFileSync } from 'node:fs';
import { ReplayWorld, type CourseData } from '@slack-tide/world';

export function loadWorld(id: string): ReplayWorld {
  const dir = new URL(`../courses/${id}/`, import.meta.url);
  const course = JSON.parse(readFileSync(new URL('course.json', dir), 'utf8')) as CourseData;
  const cur = readFileSync(new URL('current.bin', dir));
  return new ReplayWorld({ course, current: new Int8Array(cur.buffer, cur.byteOffset, cur.byteLength), depth: new Uint8Array(readFileSync(new URL('depth.bin', dir))) }, 0);
}

export function raceMarks(id: string): Array<{ x: number; y: number }> {
  const races = JSON.parse(readFileSync(new URL(`../courses/${id}/races.json`, import.meta.url), 'utf8')) as Array<{ marks: Array<{ x: number; y: number }> }>;
  return races.flatMap((r) => r.marks);
}

/**
 * @param need depth wanted at the lowest tide, metres
 * @param off metres to keep off shoal water where there is room to
 * @param avoid points to stay `ring` metres from: race marks
 */
export function seaRoute(world: ReplayWorld, need: number, off: number, stops: Array<[number, number]>, avoid: Array<{ x: number; y: number }> = [], ring = 0): Array<[number, number]> {
  const g = world.course.depth;
  const lowest = Math.max(0, -Math.min(...world.course.tide.truth));
  const N = g.nx * g.ny;
  const ok = new Uint8Array(N);
  const cx = (i: number) => g.x0 + i * g.dx;
  const cy = (j: number) => g.y0 + j * g.dx;
  const wet = (x: number, y: number): boolean => world.chartDepth(x, y) - lowest >= need && avoid.every((m) => Math.hypot(m.x - x, m.y - y) > ring);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) ok[j * g.nx + i] = wet(cx(i), cy(j)) ? 1 : 0;
  // Cells from the nearest shoal, by spreading out from them.
  const far = new Float32Array(N).fill(1e9);
  const queue: number[] = [];
  for (let k = 0; k < N; k++) if (!ok[k]) { far[k] = 0; queue.push(k); }
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h];
    const i = k % g.nx;
    const j = (k - i) / g.nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= g.nx || b >= g.ny) continue;
      const n = b * g.nx + a;
      if (far[n] > far[k] + 1) { far[n] = far[k] + 1; queue.push(n); }
    }
  }
  const cell = (x: number, y: number): number => {
    let best = -1;
    let least = 1e18;
    const i0 = Math.round((x - g.x0) / g.dx);
    const j0 = Math.round((y - g.y0) / g.dx);
    for (let j = Math.max(0, j0 - 12); j <= Math.min(g.ny - 1, j0 + 12); j++) for (let i = Math.max(0, i0 - 12); i <= Math.min(g.nx - 1, i0 + 12); i++) {
      const k = j * g.nx + i;
      if (!ok[k]) continue;
      const d = (cx(i) - x) ** 2 + (cy(j) - y) ** 2;
      if (d < least) { least = d; best = k; }
    }
    if (best < 0) throw new Error(`No water deep enough near ${x}, ${y}`);
    return best;
  };
  const want = Math.max(1, off / g.dx);
  const clear = (ax: number, ay: number, bx: number, by: number, margin: number): boolean => {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(2, Math.ceil(len / 25));
    const ux = (bx - ax) / (len || 1);
    const uy = (by - ay) / (len || 1);
    for (let k = 0; k <= n; k++) for (const q of [-margin, 0, margin]) {
      if (!wet(ax + ((bx - ax) * k) / n + uy * q, ay + ((by - ay) * k) / n - ux * q)) return false;
    }
    return true;
  };
  const out: Array<[number, number]> = [];
  for (let s = 1; s < stops.length; s++) {
    const from = cell(...stops[s - 1]);
    const to = cell(...stops[s]);
    const cost = new Float32Array(N).fill(1e18);
    const prev = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    cost[from] = 0;
    // A plain search over the grid with buckets of cost: small enough that nothing cleverer is wanted.
    const heap: Array<[number, number]> = [[0, from]];
    const push = (c: number, k: number): void => {
      heap.push([c, k]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [c, k] = pop();
      if (done[k]) continue;
      done[k] = 1;
      if (k === to) break;
      const i = k % g.nx;
      const j = (k - i) / g.nx;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= g.nx || b >= g.ny) continue;
        const n = b * g.nx + a;
        if (!ok[n] || done[n]) continue;
        // No cutting a corner of the land on the diagonal.
        if (di && dj && (!ok[j * g.nx + a] || !ok[b * g.nx + i])) continue;
        // Dearer close to the shoals, so the line keeps to the middle of a channel.
        const tight = far[n] >= want ? 0 : (want - far[n]) / want;
        const nc = c + Math.hypot(di, dj) * (1 + 6 * tight * tight);
        if (nc < cost[n]) { cost[n] = nc; prev[n] = k; push(nc, n); }
      }
    }
    if (prev[to] < 0 && to !== from) throw new Error(`No way by water from ${stops[s - 1]} to ${stops[s]}`);
    const path: Array<[number, number]> = [];
    for (let k = to; k >= 0; k = prev[k]) path.push([cx(k % g.nx), cy(Math.floor(k / g.nx))]);
    path.reverse();
    // Pull the line straight wherever a straight line is clear.
    const pulled: Array<[number, number]> = [path[0]];
    let at = 0;
    while (at < path.length - 1) {
      let next = at + 1;
      for (let k = path.length - 1; k > at + 1; k--) {
        if (clear(path[at][0], path[at][1], path[k][0], path[k][1], Math.min(off, 60))) { next = k; break; }
      }
      pulled.push(path[next]);
      at = next;
    }
    if (s > 1) pulled.shift();
    out.push(...pulled);
  }
  return out.map(([x, y]) => [Math.round(x), Math.round(y)]);
}

// Run with a course and points, it prints the way. Imported by another script, it does nothing.
if (process.argv.length >= 9 && existsSync(new URL(`../courses/${process.argv[2]}/course.json`, import.meta.url))) {
  const [id, need, off, ...rest] = process.argv.slice(2);
  const nums = rest.map(Number);
  const stops: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) stops.push([nums[i], nums[i + 1]]);
  console.log(JSON.stringify(seaRoute(loadWorld(id), Number(need), Number(off), stops, raceMarks(id), 200)));
}
