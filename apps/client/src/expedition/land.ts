import type { Projection } from '@slack-tide/nav';
import type { Island, Rock } from './voyage';

// The land of a voyage, worked out from its outlines: where the coast is, how far off it lies, how high the ground
// stands. Pure geometry on flat metres. The depth grid, the terrain and the look-out all ask here.

/** Repeatable noise in 0..1 from a grid position and a seed. */
export function hash2(i: number, j: number, seed = 0): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth noise in 0..1. */
export function noise2(x: number, y: number, seed = 0): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return (hash2(i, j, seed) * (1 - sx) + hash2(i + 1, j, seed) * sx) * (1 - sy) + (hash2(i, j + 1, seed) * (1 - sx) + hash2(i + 1, j + 1, seed) * sx) * sy;
}

export interface LandMass {
  name: string;
  group: string;
  /** The coast as x, y pairs in flat metres. */
  ring: number[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  peak: number;
  spine: Array<{ x: number; y: number; h: number }>;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return { d: Math.hypot(px - ax - dx * t, py - ay - dy * t), t };
}

export class Land {
  readonly masses: LandMass[];
  readonly rocks: Array<{ name: string; x: number; y: number }>;

  constructor(islands: Island[], rocks: Rock[], proj: Projection) {
    this.masses = islands.map((isle) => {
      const ring: number[] = [];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [s, w] of isle.outline) {
        const p = proj.toXY(-s, -w);
        ring.push(p.x, p.y);
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      const spine = (isle.spine ?? []).map(([s, w, h]) => ({ ...proj.toXY(-s, -w), h }));
      return { name: isle.name, group: isle.group, ring, x0, y0, x1, y1, peak: isle.peak, spine };
    });
    this.rocks = rocks.map((r) => ({ name: r.name, ...proj.toXY(-r.at[0], -r.at[1]) }));
  }

  /** True inside a land mass's coast. */
  static within(m: LandMass, x: number, y: number): boolean {
    if (x < m.x0 || x > m.x1 || y < m.y0 || y > m.y1) return false;
    const r = m.ring;
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1];
      const yj = r[j + 1];
      if (yi > y !== yj > y && x < ((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]) inside = !inside;
    }
    return inside;
  }

  /** Metres from a point to a land mass's coast, whichever side of it the point is. */
  static toCoast(m: LandMass, x: number, y: number): number {
    const r = m.ring;
    let best = Infinity;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const d = segmentDistance(x, y, r[j], r[j + 1], r[i], r[i + 1]).d;
      if (d < best) best = d;
    }
    return best;
  }

  /** The land mass a point is on, if any. */
  on(x: number, y: number): LandMass | null {
    for (const m of this.masses) if (Land.within(m, x, y)) return m;
    return null;
  }

  /**
   * The nearest land to a point at sea, looking no further than `within` metres: how far off, which land, and how high
   * it stands. Null when nothing is that close.
   */
  nearest(x: number, y: number, within: number): { metres: number; mass: LandMass; bearing: number } | null {
    let best: { metres: number; mass: LandMass; bearing: number } | null = null;
    for (const m of this.masses) {
      if (x < m.x0 - within || x > m.x1 + within || y < m.y0 - within || y > m.y1 + within) continue;
      // The nearest point of this coast, and how it bears.
      const r = m.ring;
      let d = Infinity;
      let px = x;
      let py = y;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const hit = segmentDistance(x, y, r[j], r[j + 1], r[i], r[i + 1]);
        if (hit.d < d) {
          d = hit.d;
          px = r[j] + (r[i] - r[j]) * hit.t;
          py = r[j + 1] + (r[i + 1] - r[j + 1]) * hit.t;
        }
      }
      if (Land.within(m, x, y)) d = 0;
      if (d <= within && (!best || d < best.metres)) best = { metres: d, mass: m, bearing: (Math.atan2(px - x, py - y) + Math.PI * 2) % (Math.PI * 2) };
    }
    return best;
  }

  /**
   * Height of the ground in metres at a point on a land mass. A steep rise from the coast, then the island's spine
   * where one is given, broken up with noise so the skyline is not a smooth hump.
   */
  static height(m: LandMass, x: number, y: number): number {
    const d = Land.toCoast(m, x, y);
    const rough = 0.72 + 0.56 * (0.6 * noise2(x / 2600, y / 2600, 7) + 0.4 * noise2(x / 900, y / 900, 11));
    if (!m.spine.length) {
      const reach = 0.3 * Math.min(m.x1 - m.x0, m.y1 - m.y0);
      const u = Math.min(1, d / Math.max(300, reach));
      return Math.max(2, Math.min(m.peak, m.peak * u * (2 - u) * rough));
    }
    // Height of the spine nearest this point, falling away either side of it.
    let high = 0;
    const s = m.spine;
    for (let i = 0; i < s.length - 1; i++) {
      const hit = segmentDistance(x, y, s[i].x, s[i].y, s[i + 1].x, s[i + 1].y);
      const crest = s[i].h + (s[i + 1].h - s[i].h) * hit.t;
      const width = 2800 + crest * 1.5;
      high = Math.max(high, crest * Math.exp(-(hit.d * hit.d) / (2 * width * width)));
    }
    const rise = 1 - Math.exp(-d / 800);
    // The coast itself is cliff and scree a few hundred metres high all round.
    const shore = 260 * rise;
    return Math.max(2, Math.min(m.peak, (shore + high * (1 - Math.exp(-d / 2200))) * rough));
  }
}
