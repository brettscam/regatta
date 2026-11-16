// Where on the shore a place's building stands, and which way it faces. Pure: no scene, no browser.

/** What kind of spot a place is once the crew is ashore. It decides what is built there and how the chart marks it. */
export type ShoreKind = 'club' | 'bar' | 'marina' | 'hotel' | 'store' | 'park';
export const SHORE_KINDS: readonly ShoreKind[] = ['club', 'bar', 'marina', 'hotel', 'store', 'park'];

/** The kind a place is, from its data, or a fair guess from how a boat stops there. */
export function shoreKind(place: { kind?: string; ashore?: { kind?: string } }): ShoreKind {
  const k = place.ashore?.kind;
  if (k && (SHORE_KINDS as readonly string[]).includes(k)) return k as ShoreKind;
  return place.kind === 'dock' ? 'bar' : place.kind === 'mooring' ? 'store' : 'park';
}

/** The ground and the water, as the builder needs them. Positions are course metres, east and north. */
export interface ShoreGround {
  /** Height of the ground as it is drawn. Under the sea it is well below zero. */
  height(x: number, y: number): number;
  /** True where the depth chart lets a boat float at some state of the tide. */
  sailable(x: number, y: number): boolean;
}

export interface ShoreSite {
  /** Middle of the plot. */
  x: number;
  y: number;
  /** Unit vector from the plot toward the water. */
  fx: number;
  fy: number;
  /** Lowest ground under the plot. */
  base: number;
  /** How far the plot is from the place it serves, metres. */
  off: number;
}

/** Above this the drawn ground stands clear of the sea. */
export const DRY = 0.5;
const RING = 12;

/**
 * The plot for a place: the stretch of low shore nearest its position, with the water in front of it.
 * Looks out to `reach` metres. Steep ground and ground the chart says a boat can float over are passed by
 * while there is better. Null where there is no shore within reach.
 */
export function siteFor(px: number, py: number, g: ShoreGround, reach = 900): ShoreSite | null {
  const dry = (x: number, y: number) => g.height(x, y) > DRY;
  const wet = (x: number, y: number) => g.height(x, y) < 0;
  let best: { x: number; y: number; score: number } | null = null;
  for (let r = 0; r <= reach; r += 6) {
    // Nothing further out can beat what is already in hand.
    if (best && r > best.score) break;
    const n = r === 0 ? 1 : Math.max(8, Math.min(72, Math.round((Math.PI * 2 * r) / 20)));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = px + Math.cos(a) * r;
      const y = py + Math.sin(a) * r;
      if (!dry(x, y)) continue;
      // On the shore: water within a short walk on some side.
      let water = 0;
      let lo = 1e9;
      let hi = -1e9;
      for (let j = 0; j < RING; j++) {
        const b = (j / RING) * Math.PI * 2;
        if (wet(x + Math.cos(b) * 34, y + Math.sin(b) * 34)) water++;
        const h = g.height(x + Math.cos(b) * 13, y + Math.sin(b) * 13);
        if (h > DRY) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
      }
      // A plot needs water on one side and land on the other: not a rock, not the middle of a field.
      if (water === 0 || water > RING - 3) continue;
      const h = g.height(x, y);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      const score = r + (hi - lo) * 9 + Math.max(0, h - 9) * 6 + (g.sailable(x, y) ? 400 : 0);
      if (!best || score < best.score) best = { x, y, score };
    }
  }
  if (!best) return null;

  // Which way the water lies: the mean of the wet directions, near and a little further out.
  let fx = 0;
  let fy = 0;
  for (const rad of [26, 44, 70]) {
    for (let j = 0; j < 24; j++) {
      const b = (j / 24) * Math.PI * 2;
      if (wet(best.x + Math.cos(b) * rad, best.y + Math.sin(b) * rad)) { fx += Math.cos(b); fy += Math.sin(b); }
    }
  }
  let len = Math.hypot(fx, fy);
  if (len < 1e-3) {
    // Water all round, evenly: face the place itself.
    fx = px - best.x;
    fy = py - best.y;
    len = Math.hypot(fx, fy) || 1;
    if (len === 1 && fx === 0) fx = 1;
  }
  fx /= len;
  fy /= len;

  // Walk down to the water's edge, then stand a house's half-depth back from it, so that what is built in front of
  // the house reaches out over the water.
  let ex = best.x;
  let ey = best.y;
  for (let t = 2; t <= 60; t += 2) {
    if (!dry(best.x + fx * t, best.y + fy * t)) break;
    ex = best.x + fx * t;
    ey = best.y + fy * t;
  }
  let x = ex;
  let y = ey;
  for (let back = 2; back <= 8; back += 2) {
    if (!dry(ex - fx * back, ey - fy * back)) break;
    x = ex - fx * back;
    y = ey - fy * back;
  }
  return settle(x, y, fx, fy, px, py, g);
}

/** A plot at a point: the lowest ground under it, and how far it is from the place it serves. */
function settle(x: number, y: number, fx: number, fy: number, px: number, py: number, g: ShoreGround): ShoreSite {
  let base = Math.max(DRY, g.height(x, y));
  for (const [u, v] of [[-10, -5], [10, -5], [-10, 5], [10, 5]]) {
    const h = g.height(x + fy * u + fx * v, y - fx * u + fy * v);
    if (h > DRY) base = Math.min(base, h);
  }
  return { x, y, fx, fy, base: Math.max(0.8, base), off: Math.hypot(x - px, y - py) };
}

/** The same plot moved straight back from the water by `back` metres, or null if the ground there is not dry. */
export function setBack(s: ShoreSite, back: number, g: ShoreGround): ShoreSite | null {
  const x = s.x - s.fx * back;
  const y = s.y - s.fy * back;
  if (g.height(x, y) <= DRY) return null;
  return settle(x, y, s.fx, s.fy, x + s.fx * s.off, y + s.fy * s.off, g);
}

export interface DepthGrid { x0: number; y0: number; dx: number; nx: number; ny: number; scale: number }

/**
 * True where a boat can float at some state of the tide, read from the depth chart the way the world reads it
 * (`ReplayWorld.chartDepth`), with the same margin the city's builders use: the shallowest boat draws 1.6 m and
 * the highest tide adds 0.85 m. Outside the chart counts as open water.
 */
export function chartSailable(dg: DepthGrid, depths: ArrayLike<number>): (x: number, y: number) => boolean {
  return (x, y) => {
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
    return charted >= 0.7;
  };
}

/** A repeatable number in 0..1 from a string and a slot, so each place's building is its own and the same on every machine. */
export function hashOf(id: string, slot = 0): number {
  let h = 2166136261 ^ (slot * 0x9e3779b1);
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
