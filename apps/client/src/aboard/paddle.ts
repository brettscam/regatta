// The outrigger's paddling and the question of where she can land, as plain arithmetic.
// No DOM and no Three.js in here, so it can be tested on its own. The drawing and the keys are in `outrigger.ts`.
// Sim conventions: x east, y north, metres. Heading is compass radians, clockwise from north. Speeds in m/s.

const KT = 0.514444;

/** Flat out, about 4 knots. */
export const TOP_SPEED = 4 * KT;
/** Within this of a place's point she can land there from the water, at its dock. */
export const DOCK_RANGE = 60;
/** Run up on the shore within this of a place and the crew walks the rest. */
export const WALK_RANGE = 250;
/** Close enough to the yacht to hand the paddle up and climb aboard. */
export const BOARD_RANGE = 15;
/** Slower than this she can be landed. About a knot and a half. */
export const LANDING_SPEED = 0.8;
/** Farther from the yacht than this, the way back is worth saying. */
export const FAR_OFF = 300;

/** Push from the paddle going ahead, m/s² on the canoe and paddler. */
const DRIVE = 0.62;
/** Backing is weaker: half a stroke, the wrong way round. */
const BACK = 0.36;
/** A little drag that does not fade with speed, so a glide does come to an end. */
const SKIN = 0.05;
/** Drag that grows with the square of speed. Sized so that DRIVE gives TOP_SPEED. */
const DRAG = (DRIVE / TOP_SPEED - SKIN) / TOP_SPEED;
/** Turn rates in rad/s: with sweep strokes at rest, and more with way on and the rudder biting. */
const TURN_REST = 0.42;
const TURN_WAY = 0.34;
/** Seconds for the turn to build or die away. */
const TURN_LAG = 0.55;
/** Share of the wind's speed she is set downwind. A low hull and one person sitting up in the breeze. */
const WINDAGE = 0.022;
/** Longest step taken in one go, seconds. Longer frames are cut up. */
const MAX_STEP = 0.05;

export interface Canoe {
  x: number;
  y: number;
  heading: number;
  /** Speed through the water along her heading. Negative when backing. */
  speed: number;
  /** Rate of turn, rad/s, positive to starboard. */
  turn: number;
  /** True while the shore is stopping her. */
  beached: boolean;
}

export interface Paddling {
  /** 1 paddling ahead, -1 backing, 0 resting. */
  ahead: number;
  /** 1 to starboard, -1 to port. */
  steer: number;
}

export interface Water {
  /** Tidal stream at a point, m/s east and north. */
  current(x: number, y: number): { x: number; y: number };
  /** Wind at a point: the direction it blows from, compass radians, and its speed in m/s. */
  wind(x: number, y: number): { dir: number; speed: number };
  /** True where there is no water to float in. */
  land(x: number, y: number): boolean;
}

/** A yacht lying to her anchor, as the canoe sees her: something to fend off and to come back to. */
export interface Hulk {
  x: number;
  y: number;
  heading: number;
  loa: number;
  beam: number;
}

export function newCanoe(x: number, y: number, heading: number): Canoe {
  return { x, y, heading, speed: 0, turn: 0, beached: false };
}

/** Move the canoe on by `dt` seconds. Changes `c` in place. */
export function stepCanoe(c: Canoe, input: Paddling, dt: number, water: Water, yacht?: Hulk): void {
  let left = Math.min(dt, 2);
  while (left > 1e-6) {
    const h = Math.min(left, MAX_STEP);
    left -= h;
    stepOnce(c, input, h, water, yacht);
  }
}

function stepOnce(c: Canoe, input: Paddling, h: number, water: Water, yacht?: Hulk): void {
  const ahead = Math.sign(input.ahead);
  const steer = Math.sign(input.steer);

  // Turning. Sweep strokes turn her at rest. With way on she answers faster. Backing, the bow still goes where the key says.
  const way = Math.min(1, Math.abs(c.speed) / TOP_SPEED);
  const wanted = steer * (TURN_REST + TURN_WAY * way);
  c.turn += (wanted - c.turn) * Math.min(1, h / TURN_LAG);
  c.heading = wrap(c.heading + c.turn * h);

  // Speed through the water. A turn scrubs some of it off, and steering strokes leave less for going ahead.
  const push = ahead > 0 ? DRIVE * (steer !== 0 ? 0.8 : 1) : ahead < 0 ? -BACK : 0;
  const drag = (DRAG * Math.abs(c.speed) + SKIN + 0.25 * Math.abs(c.turn)) * c.speed;
  c.speed += (push - drag) * h;
  if (ahead === 0 && Math.abs(c.speed) < 0.04) c.speed = 0;

  // Over the ground: her own way, all of the stream, and a little of the wind.
  const stream = water.current(c.x, c.y);
  const sx = stream.x;
  const sy = stream.y;
  const wind = water.wind(c.x, c.y);
  const vx = Math.sin(c.heading) * c.speed + sx - Math.sin(wind.dir) * wind.speed * WINDAGE;
  const vy = Math.cos(c.heading) * c.speed + sy - Math.cos(wind.dir) * wind.speed * WINDAGE;
  const nx = c.x + vx * h;
  const ny = c.y + vy * h;

  // The shore stops her. She can still slide along it if the way is clear on one axis.
  if (!water.land(nx, ny) || water.land(c.x, c.y)) {
    // (If she is somehow on the land already, nothing holds her there.)
    c.x = nx;
    c.y = ny;
    c.beached = false;
  } else {
    // Take the way off her if it is her own way that is carrying her into the land. If it is only the stream or the wind
    // setting her on, she keeps what she has, or she could never paddle off a lee shore.
    const way = Math.sign(c.speed) * 0.6;
    if (way !== 0 && water.land(c.x + Math.sin(c.heading) * way, c.y + Math.cos(c.heading) * way)) c.speed *= Math.max(0, 1 - 6 * h);
    if (!water.land(nx, c.y)) c.x = nx;
    else if (!water.land(c.x, ny)) c.y = ny;
    c.beached = true;
  }

  if (yacht) fendOff(c, yacht);
}

/** Keep the canoe out of the yacht's hull: treated as a rounded slab along her centreline. */
export function fendOff(c: Canoe, yacht: Hulk): void {
  const fx = Math.sin(yacht.heading);
  const fy = Math.cos(yacht.heading);
  const dx = c.x - yacht.x;
  const dy = c.y - yacht.y;
  const half = Math.max(0, yacht.loa * 0.5 - yacht.beam * 0.5);
  const along = Math.max(-half, Math.min(half, dx * fx + dy * fy));
  const ox = dx - fx * along;
  const oy = dy - fy * along;
  const d = Math.hypot(ox, oy);
  const keep = yacht.beam * 0.5 + 0.55;
  if (d >= keep) return;
  // Dead on the centreline there is no way out to choose, so take her off to port.
  const ux = d > 1e-6 ? ox / d : -fy;
  const uy = d > 1e-6 ? oy / d : fx;
  c.x = yacht.x + fx * along + ux * keep;
  c.y = yacht.y + fy * along + uy * keep;
}

/** Where the canoe goes in the water when she is launched: alongside to port, her float outboard, pointing the way the yacht points. */
export function launchSpot(yacht: Hulk, land: (x: number, y: number) => boolean): { x: number; y: number; heading: number } {
  const fx = Math.sin(yacht.heading);
  const fy = Math.cos(yacht.heading);
  // To starboard of the yacht is (fy, -fx).
  const off = yacht.beam * 0.5 + 1.3;
  const tries: Array<[number, number]> = [[-off, 0], [off + 1.6, 0], [0, -(yacht.loa * 0.5 + 4)], [0, 0]];
  for (const [side, along] of tries) {
    const x = yacht.x + fy * side + fx * along;
    const y = yacht.y - fx * side + fy * along;
    if (!land(x, y)) return { x, y, heading: yacht.heading };
  }
  return { x: yacht.x, y: yacht.y, heading: yacht.heading };
}

/** True when there is land within `reach` metres of a point: she has her bow on the beach or lies along it. */
export function touchingShore(x: number, y: number, land: (x: number, y: number) => boolean, reach = 6): boolean {
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    if (land(x + Math.sin(a) * reach, y + Math.cos(a) * reach)) return true;
    if (land(x + Math.sin(a) * reach * 0.5, y + Math.cos(a) * reach * 0.5)) return true;
  }
  return false;
}

/** A place with somewhere to go once ashore. */
export interface Shore {
  id: string;
  x: number;
  y: number;
  ashore?: { name: string; say: string };
}

export type Landing<P extends Shore> =
  /** Ashore at a named place. */
  | { kind: 'place'; place: P; distance: number }
  /** On a shore with nothing nearby. */
  | { kind: 'beach' }
  /** Somewhere to land, but she has too much way on. */
  | { kind: 'fast'; speed: number }
  /** Open water. */
  | { kind: 'none' };

/**
 * Where she would land if the paddler stepped out now.
 * A named place takes her from the water within DOCK_RANGE of its point, or from anywhere she has run up on the shore
 * within WALK_RANGE. Any other shore is just a beach.
 */
export function landing<P extends Shore>(c: Canoe, places: readonly P[], land: (x: number, y: number) => boolean): Landing<P> {
  const onShore = c.beached || touchingShore(c.x, c.y, land);
  const best = placeInReach(c, places, onShore);
  if (!best && !onShore) return { kind: 'none' };
  if (Math.abs(c.speed) > LANDING_SPEED) return { kind: 'fast', speed: Math.abs(c.speed) };
  return best ? { kind: 'place', place: best, distance: Math.hypot(best.x - c.x, best.y - c.y) } : { kind: 'beach' };
}

/** The nearest place with somewhere to go ashore that she could land at from here, whatever her speed. */
export function placeInReach<P extends Shore>(c: { x: number; y: number }, places: readonly P[], onShore: boolean): P | null {
  let best: P | null = null;
  let bestD = Infinity;
  for (const p of places) {
    if (!p.ashore) continue;
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d < bestD && (d <= DOCK_RANGE || (onShore && d <= WALK_RANGE))) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** How far and which way from one point to another: metres, and compass degrees from 0 to 359. */
export function rangeAndBearing(fromX: number, fromY: number, toX: number, toY: number): { range: number; bearing: number } {
  const range = Math.hypot(toX - fromX, toY - fromY);
  const bearing = Math.round((Math.atan2(toX - fromX, toY - fromY) * 180) / Math.PI + 360) % 360;
  return { range, bearing };
}

/** What the O key does from the canoe, afloat. */
export type Call<P extends Shore> =
  | { do: 'board' }
  | { do: 'land'; place: P | null }
  | { do: 'slow'; speed: number }
  | { do: 'nothing'; range: number; bearing: number; far: boolean };

/** Decide what pressing O means from where she is: back aboard if the yacht is close, else ashore if there is a shore, else nothing. */
export function call<P extends Shore>(c: Canoe, yacht: { x: number; y: number }, places: readonly P[], land: (x: number, y: number) => boolean): Call<P> {
  const back = rangeAndBearing(c.x, c.y, yacht.x, yacht.y);
  if (back.range <= BOARD_RANGE) return { do: 'board' };
  const l = landing(c, places, land);
  if (l.kind === 'place') return { do: 'land', place: l.place };
  if (l.kind === 'beach') return { do: 'land', place: null };
  if (l.kind === 'fast') return { do: 'slow', speed: l.speed };
  return { do: 'nothing', range: back.range, bearing: back.bearing, far: back.range > FAR_OFF };
}

/**
 * Heights of the ground on a square grid, as the land is drawn: one value per corner, row 0 at the southern edge,
 * found at `data[k * stride + offset]`. Cells are split into two triangles along the diagonal from the south-east corner to the north-west.
 */
export interface HeightGrid {
  x0: number;
  y0: number;
  dx: number;
  nx: number;
  ny: number;
  data: ArrayLike<number>;
  stride: number;
  offset: number;
}

/** Height of the drawn ground at a point, metres above the still sea. Well below zero off the grid. */
export function groundHeight(g: HeightGrid, x: number, y: number): number {
  const gx = (x - g.x0) / g.dx;
  const gy = (y - g.y0) / g.dx;
  if (gx < 0 || gy < 0 || gx > g.nx - 1 || gy > g.ny - 1) return -6;
  const i = Math.min(g.nx - 2, Math.floor(gx));
  const j = Math.min(g.ny - 2, Math.floor(gy));
  const fx = gx - i;
  const fy = gy - j;
  const at = (k: number) => g.data[k * g.stride + g.offset];
  const k = j * g.nx + i;
  const a = at(k);
  const b = at(k + 1);
  const d = at(k + g.nx);
  const e = at(k + g.nx + 1);
  return fx + fy <= 1 ? a + (b - a) * fx + (d - a) * fy : e + (d - e) * (1 - fx) + (b - e) * (1 - fy);
}

function wrap(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
