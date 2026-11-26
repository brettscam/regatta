// How a grid of land heights is cut at the waterline: the one rule both the drawn land (`buildTerrain`) and every
// reading of its height (`drawnLandHeight`) follow, so what stands on the shore stands on what is drawn.
//
// A grid's points are land (above DRY) or water. Drawn plainly, each triangle that has both would slope from the land
// down to the sea bed under the water point, and the sea would cut it where that slope crosses zero: close to one
// point or the other, so the coast followed the grid's cells and came out in stair steps. Here every point near the
// shore also has a shore value: positive on land, negative on water, from the land and water round it smoothed over
// five points each way. A triangle with both is cut where that value is zero, at the height of the sea, so the
// shoreline runs smoothly through the cells. The land side keeps its points' heights and comes down to the cut; the
// water side is a skirt from the cut down to the sea bed, under the sea, so no gap opens in a trough of the waves.
// No THREE here: it is pure, and tested in `test/landMesh.test.ts`.

/** Land is above this many metres. */
export const DRY = 0.4;
/** Where the points of a grid that are water are drawn, metres. */
export const SEABED = -6;

/** One grid of land as it is drawn. */
export interface DrawnGrid {
  x0: number;
  y0: number;
  dx: number;
  nx: number;
  ny: number;
  /** Height of each point as drawn: the land's own above DRY, SEABED for water, or what an inset's edge takes from the grid round it. */
  h: Float32Array;
  /** Points whose height was taken from the grid round an inset: their shore value is their height, so the cut meets that grid's. */
  fixed?: Uint8Array;
}

/** Whether there is land at a course position, read from the finest grid there is. */
export type LandTest = (x: number, y: number) => boolean;

const W5 = [1, 4, 6, 4, 1];

/**
 * The shore value at a point of a grid: its sign says land or water, its size how deep into either it lies, from -1 to 1
 * (never nearer zero than 0.05, so a point keeps its side). Points of other grids nearby are read through `land`.
 */
export function shoreValue(g: DrawnGrid, i: number, j: number, land: LandTest): number {
  const k = j * g.nx + i;
  const z = g.h[k];
  if (g.fixed?.[k]) return (z - DRY) / 6 || -1e-3;
  let s = 0;
  for (let b = -2; b <= 2; b++) {
    for (let a = -2; a <= 2; a++) {
      const ii = i + a;
      const jj = j + b;
      const wet = ii >= 0 && jj >= 0 && ii < g.nx && jj < g.ny ? g.h[jj * g.nx + ii] <= DRY : !land(g.x0 + ii * g.dx, g.y0 + jj * g.dx);
      s += W5[a + 2] * W5[b + 2] * (wet ? -1 : 1);
    }
  }
  s /= 256;
  return z > DRY ? Math.max(s, 0.05) : Math.min(s, -0.05);
}

/** A point of a cut triangle: a grid point by its index, or a point on the edge between two at a fraction t from the first. */
export type Corner = { k: number } | { a: number; b: number; t: number };

/**
 * The pieces of one triangle of a grid (points `p` in drawing order, with shore values `v`): each piece is three
 * corners in the same turn as the triangle, and says whether it is land. A triangle all one side is one piece; one cut
 * by the shore is three, the side with one point being one triangle and the other side two.
 */
export function cutTriangle(p: [number, number, number], v: [number, number, number]): Array<{ land: boolean; c: [Corner, Corner, Corner] }> {
  const pos = v.map((x) => x > 0);
  if (pos[0] === pos[1] && pos[1] === pos[2]) return [{ land: pos[0], c: [{ k: p[0] }, { k: p[1] }, { k: p[2] }] }];
  // The odd one out, and the other two after it in the triangle's own turn.
  const r = pos[0] !== pos[1] && pos[0] !== pos[2] ? 0 : pos[1] !== pos[0] && pos[1] !== pos[2] ? 1 : 2;
  const o = p[r];
  const q1 = p[(r + 1) % 3];
  const q2 = p[(r + 2) % 3];
  const vo = v[r];
  const c1: Corner = { a: o, b: q1, t: vo / (vo - v[(r + 1) % 3]) };
  const c2: Corner = { a: o, b: q2, t: vo / (vo - v[(r + 2) % 3]) };
  return [
    { land: pos[r], c: [{ k: o }, c1, c2] },
    { land: !pos[r], c: [{ k: q1 }, { k: q2 }, c2] },
    { land: !pos[r], c: [{ k: q1 }, c2, c1] },
  ];
}

/** The two triangles of cell (i, j), as `buildTerrain` draws them: (a, b, d) and (b, e, d). */
export function cellTriangles(g: { nx: number }, i: number, j: number): [[number, number, number], [number, number, number]] {
  const a = j * g.nx + i;
  const b = a + 1;
  const d = a + g.nx;
  const e = d + 1;
  return [[a, b, d], [b, e, d]];
}

/** Where a corner is: x and y in course metres, and its height as drawn. */
export function cornerAt(g: DrawnGrid, c: Corner): [number, number, number] {
  if ('k' in c) return [g.x0 + (c.k % g.nx) * g.dx, g.y0 + Math.floor(c.k / g.nx) * g.dx, g.h[c.k]];
  const [ax, ay] = cornerAt(g, { k: c.a });
  const [bx, by] = cornerAt(g, { k: c.b });
  return [ax + (bx - ax) * c.t, ay + (by - ay) * c.t, 0];
}

/** Height of a grid as drawn at a course position inside it: the surface of whichever piece of whichever triangle it lies on. */
export function drawnHeightIn(g: DrawnGrid, x: number, y: number, land: LandTest): number {
  const fx = Math.min(g.nx - 1.000001, Math.max(0, (x - g.x0) / g.dx));
  const fy = Math.min(g.ny - 1.000001, Math.max(0, (y - g.y0) / g.dx));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const u = fx - i;
  const w = fy - j;
  const tri = cellTriangles(g, i, j)[u + w <= 1 ? 0 : 1];
  const px = g.x0 + fx * g.dx;
  const py = g.y0 + fy * g.dx;
  const z = tri.map((k) => g.h[k]);
  // All on one side, as nearly everywhere is: the plain triangle.
  const sides = z.map((h) => h > DRY);
  if (sides[0] === sides[1] && sides[1] === sides[2]) return plane(g, tri.map((k) => ({ k })) as [Corner, Corner, Corner], px, py) ?? z[0];
  const v = tri.map((k) => shoreValue(g, k % g.nx, Math.floor(k / g.nx), land)) as [number, number, number];
  let best = z[0];
  let near = Infinity;
  for (const piece of cutTriangle(tri, v)) {
    const at = plane(g, piece.c, px, py);
    if (at !== undefined) return at;
    // Rounding at a shared edge: the nearest piece's plane will do.
    const [cx, cy] = cornerAt(g, piece.c[0]);
    const d = Math.hypot(cx - px, cy - py);
    if (d < near) { near = d; best = cornerAt(g, piece.c[0])[2]; }
  }
  return best;
}

/** The height at (x, y) on the flat triangle through three corners, or undefined if the point is outside it. */
function plane(g: DrawnGrid, c: [Corner, Corner, Corner], x: number, y: number): number | undefined {
  const [a, b, d] = c.map((q) => cornerAt(g, q));
  const det = (b[1] - d[1]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[1] - d[1]);
  if (Math.abs(det) < 1e-9) return undefined;
  const l1 = ((b[1] - d[1]) * (x - d[0]) + (d[0] - b[0]) * (y - d[1])) / det;
  const l2 = ((d[1] - a[1]) * (x - d[0]) + (a[0] - d[0]) * (y - d[1])) / det;
  const l3 = 1 - l1 - l2;
  const eps = -1e-6;
  if (l1 < eps || l2 < eps || l3 < eps) return undefined;
  return l1 * a[2] + l2 * b[2] + l3 * d[2];
}
