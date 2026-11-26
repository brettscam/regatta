// A town to walk about in: a waterfront given as paths (a promenade, a pier, a mole, side streets, a float for the
// dinghies) with named spots along them. Pure: no scene, no browser. The town is data, in a water's `towns.json`;
// this turns it into the ground people stand on, fitted to the land as it is drawn, and into the same `VenueLayout`
// a single bar or club has (`scene/venue.ts`), so whatever walks a skipper round a venue's deck can walk her round a town.
// `scene/townDraw.ts` draws exactly these rings, at these heights, so the ground is where the layout says it is.
import type { ShoreKind } from './shoreSite';
import type { VenueGround, VenueLayout, VenueSpot } from './venue';

/** One stretch of ground to walk on. */
export interface TownPath {
  id: string;
  name: string;
  /**
   * `promenade`: a paved front on a sea wall. `pier`: planks on piles, railed. `quay`: a broad mole, solid to the sea bed.
   * `street`: climbs with the ground in short level steps. `path`: the same, a dirt track. `float`: a pontoon on the water.
   * `round`: a walk all the way round something (the Casino): give `centre` and `inner`; `width` is how wide the walk is.
   */
  kind: 'promenade' | 'pier' | 'quay' | 'street' | 'path' | 'float' | 'round';
  /** Metres across. */
  width: number;
  /** The centreline, course metres. For `round`, left out. */
  points?: Array<[number, number]>;
  centre?: [number, number];
  /** For `round`: the radius of what stands in the middle. */
  inner?: number;
  /** Height of its surface above the still sea, where it is not the town's own `floor`. Streets and paths find their own. */
  floor?: number;
  /** A colour for its rails and piles, where the place is known by it: the green pier. "#2f7d4f". */
  paint?: string;
}

/** A named spot as the town file gives it. */
export interface TownSpotSpec {
  name: string;
  kind: VenueSpot['kind'];
  x: number;
  y: number;
  /** The way someone using it faces, degrees true. */
  face: number;
  /** A line about it, for whoever stands there. */
  say?: string;
}

/** A town, from `courses/<water>/towns.json`. */
export interface TownSpec {
  id: string;
  name: string;
  /** What the chart and the labels take it for. */
  kind: ShoreKind;
  /** Where its name hangs and where it is measured from: the middle of the front. */
  x: number;
  y: number;
  /** Height of the front above the still sea, metres. */
  floor: number;
  paths: TownPath[];
  spots: TownSpotSpec[];
  /**
   * Where a tender lands. Each names a place in `places.json` and the `dock` spot it lands at, and becomes one entry
   * of `stage.shore` with that place's id, so the tender finds it the way it finds any venue's guest float.
   */
  landings: Array<{ place: string; spot: string }>;
}

/** One level piece of ground: a ring of corners and the height of its surface. */
export interface TownRing {
  path: string;
  kind: TownPath['kind'];
  ring: Array<[number, number]>;
  z: number;
  /** For drawing: the two ends of the piece's centreline, and its width. Left out for a piece of a `round`. */
  a?: [number, number];
  b?: [number, number];
  width: number;
}

export interface TownPlan {
  spec: TownSpec;
  rings: TownRing[];
}

/** A town's layout: a venue's, with what a town adds. Everything a venue's layout has means the same here. */
export interface TownLayout extends VenueLayout {
  /** True for a town. A venue's layout has no such field. */
  town: true;
  /**
   * Height of the surface of each ring of `walk`, metres above the still sea, in the same order. A town is not all on
   * one level: the front is at `floor`, a float is just above the water, a street climbs in steps.
   */
  heights: number[];
  /** Which rings of `walk` belong to which named path, as first and last index, for anything that wants to say "on the pier". */
  paths: Array<{ id: string; name: string; kind: TownPath['kind']; from: number; to: number }>;
  /** What there is to say at each spot, by spot name. */
  says: Record<string, string>;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
/** How long a street's level steps are, metres. */
const STEP = 12;

/** The ground of a town, piece by piece. */
export function planTown(spec: TownSpec, g: VenueGround): TownPlan {
  const rings: TownRing[] = [];
  for (const p of spec.paths) {
    if (p.kind === 'round') {
      if (!p.centre) continue;
      const [cx, cy] = p.centre;
      const r0 = p.inner ?? 0;
      const r1 = r0 + p.width;
      const n = Math.max(8, Math.round((Math.PI * 2 * r1) / 14));
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2;
        const a1 = ((k + 1) / n) * Math.PI * 2;
        const at = (r: number, a: number): [number, number] => [round1(cx + Math.cos(a) * r), round1(cy + Math.sin(a) * r)];
        // A little over the true radius outside, so the flat pieces cover the whole circle.
        const out = r1 / Math.cos(Math.PI / n);
        rings.push({ path: p.id, kind: p.kind, ring: [at(r0, a0), at(out, a0), at(out, a1), at(r0, a1)], z: p.floor ?? spec.floor, width: p.width });
      }
      continue;
    }
    const pts = p.points ?? [];
    const climbs = p.kind === 'street' || p.kind === 'path';
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5) continue;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const pieces = climbs ? Math.max(1, Math.round(len / STEP)) : 1;
      for (let k = 0; k < pieces; k++) {
        // Each piece reaches half its width past its ends, so pieces overlap at a bend and leave no wedge of nothing.
        const over = p.kind === 'float' ? 0 : p.width / 2;
        const s0 = (len * k) / pieces - (k === 0 && i === 0 ? 0 : over);
        const s1 = (len * (k + 1)) / pieces + (k === pieces - 1 && i === pts.length - 2 ? 0 : over);
        const h = p.width / 2;
        const corner = (s: number, side: number): [number, number] => [round1(ax + ux * s + uy * side * h), round1(ay + uy * s - ux * side * h)];
        const ring = [corner(s0, -1), corner(s1, -1), corner(s1, 1), corner(s0, 1)];
        let z = p.floor ?? (p.kind === 'float' ? 0.45 : spec.floor);
        if (climbs && p.floor === undefined) {
          // A street lies on the ground: its level step sits just proud of the highest ground under it, never below the front.
          let top = -1e9;
          for (let a = 0; a <= 4; a++) for (let b = -1; b <= 1; b++) {
            const s = s0 + ((s1 - s0) * a) / 4;
            top = Math.max(top, g.height(ax + ux * s + uy * b * h, ay + uy * s - ux * b * h));
          }
          z = Math.max(spec.floor, round1(top + 0.25));
        }
        rings.push({ path: p.id, kind: p.kind, ring, z, a: [round1(ax + ux * s0), round1(ay + uy * s0)], b: [round1(ax + ux * s1), round1(ay + uy * s1)], width: p.width });
      }
    }
  }
  return { spec, rings };
}

/** True if a point is inside a ring (any simple polygon). */
export function inRing(ring: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The ground of a town at a point: the height of the highest ring there, or null where there is nothing to stand on. */
export function townFloorAt(layout: { walk: VenueLayout['walk']; heights?: number[]; floor: number }, x: number, y: number): number | null {
  let best: number | null = null;
  layout.walk.forEach((ring, i) => {
    if (!inRing(ring, x, y)) return;
    const z = layout.heights?.[i] ?? layout.floor;
    if (best === null || z > best) best = z;
  });
  return best;
}

/**
 * The town as a layout, one for each of its landings: they are the same town and share its rings and spots, and
 * differ only in which float the tender is taken to. `berth` is the nearest water off that float deep enough for a keel.
 */
export function townLayouts(plan: TownPlan, g: VenueGround): Array<{ place: string; layout: TownLayout }> {
  const { spec, rings } = plan;
  const walk = rings.map((r) => r.ring);
  const heights = rings.map((r) => r.z);
  const paths: TownLayout['paths'] = [];
  rings.forEach((r, i) => {
    const last = paths[paths.length - 1];
    if (last && last.id === r.path) last.to = i;
    else paths.push({ id: r.path, name: spec.paths.find((p) => p.id === r.path)?.name ?? r.path, kind: r.kind, from: i, to: i });
  });
  const spots: VenueSpot[] = spec.spots.map((s) => ({ name: s.name, kind: s.kind, x: s.x, y: s.y, face: Math.round(((s.face * Math.PI) / 180) * 1000) / 1000 }));
  const says: Record<string, string> = {};
  for (const s of spec.spots) if (s.say) says[s.name] = s.say;
  // Which way the water lies from the middle of the front: toward the first landing's float.
  const first = spec.spots.find((s) => s.name === spec.landings[0]?.spot);
  const heading = first ? Math.atan2(first.x - spec.x, first.y - spec.y) : 0;
  return spec.landings.map(({ place, spot }) => {
    const s = spec.spots.find((q) => q.name === spot);
    let dock: VenueLayout['dock'] = null;
    let berth: VenueLayout['berth'] = null;
    if (s) {
      dock = { x: s.x, y: s.y, z: townFloorAt({ walk, heights, floor: spec.floor }, s.x, s.y) ?? 0.45 };
      // Out from the float, the way someone standing on it faces the water, then all round, to the nearest keel depth.
      const f = (s.face * Math.PI) / 180;
      search: for (let t = 5; t <= 400; t += 5) {
        for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
          const bx = s.x + Math.sin(f + turn) * t;
          const by = s.y + Math.cos(f + turn) * t;
          const d = g.depth(bx, by);
          if (d >= 3.5) { berth = { x: round1(bx), y: round1(by), depth: round1(d) }; break search; }
        }
      }
    }
    return { place, layout: { id: place, kind: spec.kind, name: spec.name, x: spec.x, y: spec.y, heading: Math.round(heading * 1000) / 1000, floor: spec.floor, walk, heights, paths, dock, berth, spots, says, town: true as const } };
  });
}

/**
 * What is wrong with a town, in words. Nothing, when the ground can be drawn where the plan says:
 * no ring has the land standing up through it, every float is over water, every spot is on some ring, and every ring
 * can be walked to from every other.
 */
export function townFaults(plan: TownPlan, g: VenueGround): string[] {
  const faults: string[] = [];
  const { spec, rings } = plan;
  rings.forEach((r, i) => {
    const cx = r.ring.reduce((s, p) => s + p[0], 0) / r.ring.length;
    const cy = r.ring.reduce((s, p) => s + p[1], 0) / r.ring.length;
    let top = -1e9;
    for (const [x, y] of [...r.ring, [cx, cy] as [number, number]]) {
      // A little inside each corner: the edge itself may touch the bank.
      top = Math.max(top, g.height(cx + (x - cx) * 0.9, cy + (y - cy) * 0.9));
    }
    if (r.kind === 'float') {
      if (top > 0) faults.push(`${spec.id}: float ${r.path} is over land at ${Math.round(cx)}, ${Math.round(cy)}`);
      if (g.depth(cx, cy) < 0.3) faults.push(`${spec.id}: float ${r.path} has no water under it on the chart at ${Math.round(cx)}, ${Math.round(cy)}`);
    } else if (top > r.z + 0.05) {
      faults.push(`${spec.id}: the land stands ${(top - r.z).toFixed(1)} m above ${r.path} (piece ${i}) at ${Math.round(cx)}, ${Math.round(cy)}`);
    } else if ((r.kind === 'street' || r.kind === 'path') && r.z > spec.floor && g.height(cx, cy) < 0) {
      faults.push(`${spec.id}: ${r.path} (piece ${i}) is over water at ${Math.round(cx)}, ${Math.round(cy)}`);
    }
  });
  const layout = { walk: rings.map((r) => r.ring), heights: rings.map((r) => r.z), floor: spec.floor };
  for (const s of spec.spots) if (townFloorAt(layout, s.x, s.y) === null) faults.push(`${spec.id}: spot ${s.name} is not on any ground (${s.x}, ${s.y})`);
  for (const l of spec.landings) {
    const s = spec.spots.find((q) => q.name === l.spot);
    if (!s) faults.push(`${spec.id}: landing for ${l.place} names no spot (${l.spot})`);
    else if (s.kind !== 'dock') faults.push(`${spec.id}: landing spot ${l.spot} is not a dock`);
  }
  // Every piece reached from the first: two pieces join where a corner or the middle of one lies in the other, and a
  // step up or down between them is no more than a flight of stairs or a gangway at low water.
  const touches = (a: TownRing, b: TownRing): boolean => {
    if (Math.abs(a.z - b.z) > 3.6) return false;
    const probe = (p: TownRing, q: TownRing) => {
      const cx = p.ring.reduce((s, c) => s + c[0], 0) / p.ring.length;
      const cy = p.ring.reduce((s, c) => s + c[1], 0) / p.ring.length;
      if (inRing(q.ring, cx, cy)) return true;
      for (let i = 0; i < p.ring.length; i++) {
        const [x0, y0] = p.ring[i];
        const [x1, y1] = p.ring[(i + 1) % p.ring.length];
        for (let t = 0; t <= 4; t++) {
          const x = x0 + ((x1 - x0) * t) / 4;
          const y = y0 + ((y1 - y0) * t) / 4;
          // Nudged toward the middle, so two pieces that only share an edge still count.
          if (inRing(q.ring, x + (cx - x) * 0.02, y + (cy - y) * 0.02) || inRing(q.ring, x - (cx - x) * 0.02, y - (cy - y) * 0.02)) return true;
        }
      }
      return false;
    };
    return probe(a, b) || probe(b, a);
  };
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.pop()!;
    for (let j = 0; j < rings.length; j++) {
      if (seen.has(j) || !touches(rings[i], rings[j])) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  if (rings.length && seen.size < rings.length) {
    const lost = [...new Set(rings.filter((_, i) => !seen.has(i)).map((r) => r.path))];
    faults.push(`${spec.id}: cannot be walked to from ${rings[0].path}: ${lost.join(', ')}`);
  }
  return faults;
}
