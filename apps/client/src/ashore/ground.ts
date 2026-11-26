// What can be walked on ashore, and the rules for walking on it. Pure: no scene, no browser, no clocks.
//
// THIS FILE IS THE SEAM between whoever draws a place ashore and the walking. A venue's deck, walkway and float
// (`scene/venue.ts`, through `fromVenue.ts`) is one `WalkGround`. A town is another, with more of everything:
// a pier, a promenade, a few streets, each an area; a link wherever one opens onto the next; a block for every
// bench, planter and lamp post; a spot wherever there is something to do. Nothing in `ashore/` asks for more than
// what is declared here, so a bigger place needs data in this shape and no new code.
//
// What a place must provide:
// - `areas`: outlines that can be stood on, each with the height of its floor. A ramp or a flight of steps is an
//   area with a `ramp`. Outlines may be any simple polygon, either way round. Two areas that are joined should
//   touch or overlap along the join: up to 0.15 m of gap is stepped across.
// - `links`: which areas open onto which. Areas that merely touch are NOT joined unless a link says so, so a deck
//   can stand beside a promenade a storey below it without anyone walking off the edge.
// - `blocks`: what stands in the way on the floor (a table, a counter), as a circle or a capsule.
// - `walls`: what the camera must not go behind or through (the front of a building), as a line with a height.
// - `roofs`, optional: what is low overhead (an awning), as an outline and the height of its underside.
// - `spots`: named places with a kind and a facing. The kind decides what can be done there (`actions.ts`).
// - `sights`, optional: named things to look at, with a line for each, told at a viewpoint.
// Positions are course metres, x east and y north. Headings and facings are compass radians, clockwise from north.

export type Pt = [number, number];

export interface WalkArea {
  /** The outline, course metres. */
  ring: Pt[];
  /** Height of the floor above the still sea, metres. */
  z: number;
  /** A sloping floor: the height runs from `z` at `from` to `z1` at `to`, and is held at each beyond them. */
  ramp?: { from: Pt; to: Pt; z1: number };
  /** What it is, for anyone reading the data: "deck", "pier", "Crescent Avenue". */
  name?: string;
}

/** Something standing on the floor: everything within `r` of the line from a to b. A circle when a and b are the same point. */
export interface WalkBlock { ax: number; ay: number; bx: number; by: number; r: number }

/** Something the camera cannot see through, from the ground up to `top` metres above the still sea. */
export interface WalkWall { ax: number; ay: number; bx: number; by: number; top: number }

/** Something overhead that the camera has to stay under: an awning, a porch roof. `z` is its underside, metres above the still sea. */
export interface WalkRoof { ring: Pt[]; z: number }

/**
 * What a spot is. A venue has: `door`, `table` (the table itself, nothing to do at it), `seat` (a chair), `bar` (a stool
 * at a counter, where there is also something to order), `rail` (lean and look), `dance`, `fire`, `dock` (the way back
 * to the tender). A town may add `bench` (sit), `view` (stand and look) and `counter` (order, standing).
 */
export type SpotKind = 'door' | 'table' | 'seat' | 'bar' | 'rail' | 'dance' | 'fire' | 'dock' | 'bench' | 'view' | 'counter';

/**
 * What a layout's spot is to somebody walking. A town (`scene/town.ts`) has three kinds of its own: something to stand
 * and look at and the head of a flight of steps are both a place to stand and look, and a shop door is a door.
 */
export function walkKind(kind: string): SpotKind {
  return kind === 'sight' || kind === 'steps' ? 'view' : kind === 'shop' ? 'door' : (kind as SpotKind);
}

export interface WalkSpot {
  name: string;
  kind: SpotKind;
  x: number;
  y: number;
  /** Compass heading of someone using it. */
  face: number;
  /** Spots with the same group are together: the seats of one table, the stools of one bar. */
  group?: string;
  /** True where a figure drawn as scenery already is. No player is put there. */
  taken?: boolean;
}

/** Something to look at from a viewpoint. */
export interface Sight { name: string; x: number; y: number; line: string }

export interface WalkGround {
  /** The place's id, as in `places.json`. It goes on the wire, so letters, digits and hyphens only. */
  id: string;
  /** What it is called on its board. */
  name: string;
  /**
   * The place's own frame, which positions are told to other players in: its origin, and the compass heading of its
   * v axis (for a venue, from the building toward the water). u is to the right of that. Must be the same on every machine.
   */
  x: number;
  y: number;
  heading: number;
  areas: WalkArea[];
  links: Array<[number, number]>;
  blocks: WalkBlock[];
  walls: WalkWall[];
  roofs?: WalkRoof[];
  spots: WalkSpot[];
  sights?: Sight[];
}

/** Where somebody is on a ground: the point, and which area's floor is under her. */
export interface Footing { x: number; y: number; area: number }

/** How far outside an outline still counts as on it: outlines are rounded to a decimetre and need not quite meet. */
export const EDGE = 0.15;

// ---- outlines --------------------------------------------------------------------------------------

/** True when the point is inside the outline. */
export function inRing(ring: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The nearest point on a line from a to b, as how far along it (0 to 1) and how far off. */
export function nearOnLine(ax: number, ay: number, bx: number, by: number, x: number, y: number): { t: number; d: number; x: number; y: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  const px = ax + dx * t;
  const py = ay + dy * t;
  return { t, d: Math.hypot(x - px, y - py), x: px, y: py };
}

/** The nearest point on an outline's edge, which edge it is on, and how far off. */
export function nearOnRing(ring: readonly Pt[], x: number, y: number): { edge: number; d: number; x: number; y: number } {
  let best = { edge: 0, d: Infinity, x, y };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const n = nearOnLine(a[0], a[1], b[0], b[1], x, y);
    if (n.d < best.d) best = { edge: i, d: n.d, x: n.x, y: n.y };
  }
  return best;
}

/** How far outside an outline a point is. 0 inside it. */
export function outside(ring: readonly Pt[], x: number, y: number): number {
  return inRing(ring, x, y) ? 0 : nearOnRing(ring, x, y).d;
}

// ---- floors ----------------------------------------------------------------------------------------

/** Height of an area's floor under a point. */
export function floorAt(area: WalkArea, x: number, y: number): number {
  const r = area.ramp;
  if (!r) return area.z;
  const t = nearOnLine(r.from[0], r.from[1], r.to[0], r.to[1], x, y).t;
  return area.z + (r.z1 - area.z) * t;
}

/** Height of the floor under somebody. */
export function floorUnder(g: WalkGround, at: Footing): number {
  const area = g.areas[at.area];
  return area ? floorAt(area, at.x, at.y) : 0;
}

const linked = (g: WalkGround, a: number, b: number): boolean => g.links.some(([p, q]) => (p === a && q === b) || (p === b && q === a));

/**
 * The area a point is on, for somebody who was on `from`: that one still if she is on it, else one it opens onto.
 * -1 when the point is on neither: off the edge, or on an area there is no way onto from here.
 */
export function areaFrom(g: WalkGround, from: number, x: number, y: number): number {
  const here = g.areas[from];
  if (here && inRing(here.ring, x, y)) return from;
  let best = -1;
  let least = EDGE;
  for (let i = 0; i < g.areas.length; i++) {
    if (i !== from && !linked(g, from, i)) continue;
    const d = outside(g.areas[i].ring, x, y);
    // Squarely on another area beats being on the fringe of this one.
    if (d < least) { best = i; least = d; }
  }
  return best;
}

/** The area a point is on, coming from nowhere in particular: for putting somebody down. -1 when it is on none. */
export function areaAt(g: WalkGround, x: number, y: number, slack = EDGE): number {
  let best = -1;
  let least = slack;
  for (let i = 0; i < g.areas.length; i++) {
    const d = outside(g.areas[i].ring, x, y);
    if (d < least) { best = i; least = d; }
    if (d === 0) break;
  }
  return best;
}

/**
 * Somewhere to stand at or near a point: the point itself if it is on an area, else the nearest edge of one within
 * `reach`, a step in from the edge. Null when there is nothing that near.
 */
export function standNear(g: WalkGround, x: number, y: number, reach: number): Footing | null {
  const on = areaAt(g, x, y);
  if (on >= 0) return { x, y, area: on };
  let best: Footing | null = null;
  let least = reach;
  for (let i = 0; i < g.areas.length; i++) {
    const n = nearOnRing(g.areas[i].ring, x, y);
    if (n.d >= least) continue;
    least = n.d;
    // A step in from the edge, toward the middle of the area.
    const c = centre(g.areas[i].ring);
    const far = Math.hypot(c[0] - n.x, c[1] - n.y) || 1;
    const k = Math.min(0.5, far) / far;
    best = { x: n.x + (c[0] - n.x) * k, y: n.y + (c[1] - n.y) * k, area: i };
  }
  return best;
}

export function centre(ring: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

// ---- walking ---------------------------------------------------------------------------------------

/** Push a point out of whatever is standing on the floor. */
function clearOf(g: WalkGround, x: number, y: number): { x: number; y: number; hit: boolean } {
  let hit = false;
  // Twice, so that being pushed out of one thing into its neighbour is put right.
  for (let pass = 0; pass < 3; pass++) {
    for (const b of g.blocks) {
      const n = nearOnLine(b.ax, b.ay, b.bx, b.by, x, y);
      if (n.d >= b.r) continue;
      hit = true;
      if (n.d < 1e-6) { x = n.x + b.r; continue; }
      const k = b.r / n.d;
      x = n.x + (x - n.x) * k;
      y = n.y + (y - n.y) * k;
    }
  }
  return { x, y, hit };
}

const blocked = (g: WalkGround, x: number, y: number): boolean => g.blocks.some((b) => nearOnLine(b.ax, b.ay, b.bx, b.by, x, y).d < b.r - 0.02);

/**
 * One step of walking: from where she is, by (dx, dy) metres. She stays on the areas, sliding along an edge she walks
 * into rather than stopping dead, goes round what stands on the floor, and passes from one area to another only where
 * they are linked. `bumped` says she met something.
 */
export function walkStep(g: WalkGround, at: Footing, dx: number, dy: number): Footing & { bumped: boolean } {
  if (dx === 0 && dy === 0) return { ...at, bumped: false };
  const want = clearOf(g, at.x + dx, at.y + dy);
  // Pushed out of one thing into another, among the chairs of a table say: she does not go. Unless she is in among
  // them already, getting up from one, when any step is a step out.
  if (want.hit && blocked(g, want.x, want.y) && !blocked(g, at.x, at.y)) return { ...at, bumped: true };
  let area = areaFrom(g, at.area, want.x, want.y);
  if (area >= 0) return { x: want.x, y: want.y, area, bumped: want.hit };

  // Off the edge. Slide along the edge she has run into: keep the part of the step that runs along it.
  const here = g.areas[at.area];
  if (here) {
    const n = nearOnRing(here.ring, want.x, want.y);
    const a = here.ring[n.edge];
    const b = here.ring[(n.edge + 1) % here.ring.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const along = (dx * ex + dy * ey) / len;
    const sx = at.x + (ex / len) * along;
    const sy = at.y + (ey / len) * along;
    if (!blocked(g, sx, sy)) {
      area = areaFrom(g, at.area, sx, sy);
      if (area >= 0) return { x: sx, y: sy, area, bumped: true };
    }
  }
  return { ...at, bumped: true };
}

// ---- spots -----------------------------------------------------------------------------------------

/** The nearest spot within `reach` that `want` accepts, and how far off. */
export function nearestSpot(g: WalkGround, x: number, y: number, reach: number, want: (s: WalkSpot, index: number) => boolean): { index: number; d: number } | null {
  let best: { index: number; d: number } | null = null;
  for (let i = 0; i < g.spots.length; i++) {
    const s = g.spots[i];
    const d = Math.hypot(s.x - x, s.y - y);
    if (d > reach || (best && d >= best.d) || !want(s, i)) continue;
    best = { index: i, d };
  }
  return best;
}

// ---- the place's own frame -------------------------------------------------------------------------

/** A point in the place's own frame: u to the right of its heading, v along it. This is what goes on the wire. */
export function toLocal(g: WalkGround, x: number, y: number): [number, number] {
  const s = Math.sin(g.heading);
  const c = Math.cos(g.heading);
  const dx = x - g.x;
  const dy = y - g.y;
  return [dx * c - dy * s, dx * s + dy * c];
}

export function toCourse(g: WalkGround, u: number, v: number): [number, number] {
  const s = Math.sin(g.heading);
  const c = Math.cos(g.heading);
  return [g.x + u * c + v * s, g.y - u * s + v * c];
}

// ---- the camera ------------------------------------------------------------------------------------

/** The underside of the lowest thing over a point, metres above the still sea. Infinity under the open sky. */
export function ceilingAt(g: WalkGround, x: number, y: number): number {
  let low = Infinity;
  for (const r of g.roofs ?? []) if (r.z < low && inRing(r.ring, x, y)) low = r.z;
  return low;
}

/**
 * How far along the line from an eye's subject to the eye the view is clear, 0 to 1: 1 when no wall is crossed.
 * Heights are metres above the still sea. A wall is only in the way where the line crosses it below its top.
 */
export function clearTo(g: WalkGround, fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): number {
  let clear = 1;
  const dx = tx - fx;
  const dy = ty - fy;
  for (const w of g.walls) {
    const ex = w.bx - w.ax;
    const ey = w.by - w.ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((w.ax - fx) * ey - (w.ay - fy) * ex) / den;
    const s = ((w.ax - fx) * dy - (w.ay - fy) * dx) / den;
    if (t <= 0 || t >= clear || s < 0 || s > 1) continue;
    if (fz + (tz - fz) * t < w.top) clear = t;
  }
  return clear;
}
