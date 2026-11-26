import type { Environment, EnvSample, SeaSample } from '@slack-tide/sim';
import type { SeaSpec, SeaState } from './sea';

/** A flat grid in metres east (x) and north (y) of the course origin. Row 0 is the southern edge. */
export interface GridSpec {
  x0: number;
  y0: number;
  dx: number;
  nx: number;
  ny: number;
}

export interface WindStep {
  /** Tenths of a metre per second blowing toward east, one value per grid cell. */
  u: number[];
  /** Tenths of a metre per second blowing toward north. */
  v: number[];
  /** Gust speed in tenths of a metre per second, where the source has it. */
  g?: number[];
}

export interface CourseMark {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: string;
}

/** The course package written by pipeline/bake.py. */
export interface CourseData {
  id: string;
  name: string;
  origin: { lat: number; lon: number };
  timeZone: string;
  season: { id: string; start: string; hours: number; stepSeconds: number; source: string };
  forecast: { issued: string; hours: number; source: string; windIssued?: string };
  current: GridSpec & { scale: number; steps: number; file: string; insets?: GridSpec[] };
  depth: GridSpec & { scale: number; file: string; insets?: GridSpec[] };
  terrain: GridSpec & {
    max: number; file: string; source: string; insets?: GridSpec[];
    /** A picture of the land from above (a satellite scene, sea masked out) to drape over it: the file beside the course, and the box it covers. */
    image?: { file: string; x0: number; y0: number; x1: number; y1: number; source?: string };
  };
  wind: GridSpec & {
    scale: number; truth: WindStep[]; forecast: WindStep[]; note: string;
    /** What in the wind is worked out by rule and not recorded, where anything is. Shown with the sources. */
    modelled?: string;
  };
  tide: { station: string; x: number; y: number; truth: number[]; forecast: number[]; note: string };
  /** The towers of a bridge over the course, where there is one. */
  bridge?: { south: [number, number]; north: [number, number] };
  /** Where the forecast strip reads the tidal stream, if not at a mark called `gate`. The label is one short word. */
  stream?: { label: string; name: string; x: number; y: number; /** Bearing the flood sets, degrees true. */ flood: number };
  marks: CourseMark[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Land outlines as flat x, y lists in metres. */
  coast: number[][];
  /** What the water says about its sea: an ocean swell coming in, open water beyond the chart. Left out, there is no swell. See `sea.ts`. */
  sea?: SeaSpec;
}

/**
 * A grid may carry insets: smaller, finer grids over the places that need the detail (a harbour entrance, a tidal gate),
 * so a big water does not have to be baked fine everywhere. Their cells follow the main grid's in the same file, in the
 * order listed, laid out the same way. A place inside an inset is read from it. A course with none reads as before.
 */
function insetStarts(base: GridSpec, insets: GridSpec[] | undefined, per: number): { starts: number[]; end: number } {
  let o = base.nx * base.ny * per;
  const starts: number[] = [];
  for (const g of insets ?? []) {
    starts.push(o);
    o += g.nx * g.ny * per;
  }
  return { starts, end: o };
}

/** How far inside a grid a place is, metres. Negative outside it. */
function inside(g: GridSpec, x: number, y: number): number {
  return Math.min(x - g.x0, g.x0 + (g.nx - 1) * g.dx - x, y - g.y0, g.y0 + (g.ny - 1) * g.dx - y);
}

export interface ReplayData {
  course: CourseData;
  /** int8 east, north per cell per step: [step][row][col][2]. */
  current: Int8Array;
  /** uint8 per cell, 0 is land. */
  depth: Uint8Array;
}

export interface Wind {
  /** Direction the wind blows from, radians clockwise from north. */
  dir: number;
  /** Metres per second. */
  speed: number;
}

export type Source = 'truth' | 'forecast';

const TAU = Math.PI * 2;

function bilinear(g: GridSpec, x: number, y: number): { i: number; j: number; fx: number; fy: number } {
  const gx = Math.min(g.nx - 1.001, Math.max(0, (x - g.x0) / g.dx));
  const gy = Math.min(g.ny - 1.001, Math.max(0, (y - g.y0) / g.dx));
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  return { i, j, fx: gx - i, fy: gy - j };
}

/** Smooth curve through evenly spaced samples, so an hourly tide reads as a tide and not a staircase of ramps. */
function catmull(series: number[], pos: number): number {
  const n = series.length;
  const p = Math.min(n - 1, Math.max(0, pos));
  const i = Math.min(n - 2, Math.floor(p));
  const t = p - i;
  const a = series[Math.max(0, i - 1)];
  const b = series[i];
  const c = series[i + 1];
  const d = series[Math.min(n - 1, i + 2)];
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

/**
 * A real past stretch of wind, current and tide, replayed.
 * Everything is a pure function of place and time, so every player in a session gets the same water.
 * Times passed in are seconds since the start of the session. `startOffset` places the session inside the season.
 */
export class ReplayWorld implements Environment {
  readonly course: CourseData;
  /** Seconds from the start of the season to the start of the session. */
  startOffset: number;
  /**
   * How much harder it blows than the record says: 1 is the day as it was. A start time can ask for more,
   * for a day when the afternoon breeze really pipes up. Wind and gusts scale together; direction does not change.
   */
  windBoost = 1;
  /**
   * The sea running on this water, once somebody has given it one (`new SeaState(world)`). Null, the water is flat to
   * every sim sailed on it, as it was before there was a sea.
   */
  seas: SeaState | null = null;
  private readonly cur: Int8Array;
  private readonly dep: Uint8Array;
  private readonly out: EnvSample = { windDir: 0, windSpeed: 0, currentX: 0, currentY: 0, depth: 0 };
  private readonly scratch = { x: 0, y: 0 };
  private readonly scratch2 = { x: 0, y: 0 };
  /** Where each inset's cells begin in the current and depth data. */
  private readonly curInsets: number[];
  private readonly depInsets: number[];

  constructor(data: ReplayData, startOffset = 0) {
    this.course = data.course;
    this.cur = data.current;
    this.dep = data.depth;
    this.startOffset = startOffset;
    const c = this.course.current;
    const cur = insetStarts(c, c.insets, c.steps * 2);
    const dep = insetStarts(this.course.depth, this.course.depth.insets, 1);
    this.curInsets = cur.starts;
    this.depInsets = dep.starts;
    if (this.cur.length !== cur.end) throw new Error('Current data does not match its grid');
    if (this.dep.length !== dep.end) throw new Error('Depth data does not match its grid');
  }

  /** Seconds into the season at a session time. */
  seasonTime(t: number): number {
    return this.startOffset + t;
  }

  /**
   * Move the whole session later in the season, without touching session time.
   * This is how boats sharing the water agree on one clock: everyone moves up to the furthest-on boat.
   */
  shiftTime(seconds: number): void {
    if (seconds > 0) this.startOffset += seconds;
  }

  /** Seconds of baked weather in the whole season. */
  get seasonLength(): number {
    return this.course.season.hours * this.course.season.stepSeconds;
  }

  /**
   * The replay only holds so much weather. When a session reaches the end of it, go back whole days until it is inside
   * again, so the sun stays where it was and the day simply comes round again.
   * @returns true if the clock was moved
   */
  wrapSeason(t: number): boolean {
    let moved = false;
    while (this.startOffset + t >= this.seasonLength - 1 && this.seasonLength > 86400) {
      this.startOffset -= 86400;
      moved = true;
    }
    return moved;
  }

  /** Seconds of season available after the session start. */
  get seasonSeconds(): number {
    return this.course.season.hours * this.course.season.stepSeconds - this.startOffset;
  }

  /** The moment a session time falls on. */
  dateAt(t: number): Date {
    return new Date(Date.parse(this.course.season.start) + (this.startOffset + t) * 1000);
  }

  /** Hourly wind at a place, with no gusts. The forecast is the one issued at the start of the season. */
  wind(x: number, y: number, t: number, source: Source = 'truth'): Wind {
    const w = this.course.wind;
    const steps = source === 'truth' ? w.truth : w.forecast;
    const pos = Math.min(steps.length - 1, Math.max(0, (this.startOffset + t) / this.course.season.stepSeconds));
    const k = Math.min(steps.length - 2, Math.floor(pos));
    const ft = pos - k;
    const { i, j, fx, fy } = bilinear(w, x, y);
    const at = (s: WindStep, arr: 'u' | 'v') => {
      const a = s[arr];
      const r0 = j * w.nx + i;
      const r1 = r0 + w.nx;
      return (a[r0] * (1 - fx) + a[r0 + 1] * fx) * (1 - fy) + (a[r1] * (1 - fx) + a[r1 + 1] * fx) * fy;
    };
    const u = (at(steps[k], 'u') * (1 - ft) + at(steps[k + 1], 'u') * ft) * w.scale;
    const v = (at(steps[k], 'v') * (1 - ft) + at(steps[k + 1], 'v') * ft) * w.scale;
    return { dir: (Math.atan2(-u, -v) + TAU) % TAU, speed: Math.hypot(u, v) * this.windBoost };
  }

  /**
   * The wind as it is felt: the hourly wind with gusts, lulls and short shifts laid over it.
   * The model data is hourly and has none of its own, so they are added here, scaled to the hourly value.
   */
  gustyWind(x: number, y: number, t: number): Wind {
    const base = this.wind(x, y, t);
    const s = this.startOffset + t;
    // Gust cells drift downwind, so a puff arrives from windward the way it does on the water.
    const toward = base.dir + Math.PI;
    const along = x * Math.sin(toward) + y * Math.cos(toward) - base.speed * 0.7 * s;
    const across = x * Math.cos(toward) - y * Math.sin(toward);
    const puff = 0.085 * Math.sin(along / 310 + across / 520) + 0.055 * Math.sin(along / 127 - across / 210 + 1.7) + 0.03 * Math.sin(s / 9.3 + along / 60);
    const shift = (4.5 * Math.sin(s / 173 + across / 900) + 2.5 * Math.sin(s / 61 + along / 400 + 0.6)) * (Math.PI / 180);
    // How hard it puffs comes from the data: the model's gust speed over its mean wind for this hour and place.
    // The pattern above peaks at 0.17, so a gust factor of 1.3 makes the strongest puffs reach the model's gust.
    const factor = base.speed > 0.5 ? this.gust(x, y, t) / base.speed : 1;
    const gustiness = Math.min(2.6, Math.max(0.5, (factor - 1) / 0.17));
    return { dir: (base.dir + shift * Math.min(1.6, gustiness) + TAU) % TAU, speed: Math.max(0, base.speed * (1 + puff * gustiness)) };
  }

  /** The model's gust speed at a place and time, m/s. Falls back to 1.3 times the mean wind where the data has none. */
  gust(x: number, y: number, t: number): number {
    const w = this.course.wind;
    const steps = w.truth;
    const pos = Math.min(steps.length - 1, Math.max(0, (this.startOffset + t) / this.course.season.stepSeconds));
    const k = Math.min(steps.length - 2, Math.floor(pos));
    const a = steps[k].g;
    const b = steps[k + 1].g;
    if (!a || !b) return this.wind(x, y, t).speed * 1.3;
    const ft = pos - k;
    const { i, j, fx, fy } = bilinear(w, x, y);
    const at = (g: number[]) => {
      const r0 = j * w.nx + i;
      const r1 = r0 + w.nx;
      return (g[r0] * (1 - fx) + g[r0 + 1] * fx) * (1 - fy) + (g[r1] * (1 - fx) + g[r1 + 1] * fx) * fy;
    };
    return (at(a) * (1 - ft) + at(b) * ft) * w.scale * this.windBoost;
  }

  /** Surface current in m/s east and north. Zero over land and outside the grid. */
  current(x: number, y: number, t: number, out = this.scratch): { x: number; y: number } {
    const c = this.course.current;
    const insets = c.insets;
    if (insets) {
      for (let n = 0; n < insets.length; n++) {
        const g = insets[n];
        const d = inside(g, x, y);
        if (d < 0) continue;
        this.currentIn(g, this.curInsets[n], x, y, t, out);
        // Over the inset's outer cells the fine stream eases into the coarse one, so there is no step at its edge.
        const edge = 2 * g.dx;
        if (d < edge) {
          const far = this.currentIn(c, 0, x, y, t, this.scratch2);
          const w = d / edge;
          out.x = out.x * w + far.x * (1 - w);
          out.y = out.y * w + far.y * (1 - w);
        }
        return out;
      }
    }
    return this.currentIn(c, 0, x, y, t, out);
  }

  private currentIn(g: GridSpec, start: number, x: number, y: number, t: number, out: { x: number; y: number }): { x: number; y: number } {
    const c = this.course.current;
    const pos = Math.min(c.steps - 1, Math.max(0, (this.startOffset + t) / this.course.season.stepSeconds));
    const k = Math.min(c.steps - 2, Math.floor(pos));
    const ft = pos - k;
    const { i, j, fx, fy } = bilinear(g, x, y);
    const stride = g.nx * g.ny * 2;
    const base = start + (j * g.nx + i) * 2;
    const row = g.nx * 2;
    const d = this.cur;
    let u = 0;
    let v = 0;
    for (let n = 0; n < 2; n++) {
      const o = (k + n) * stride + base;
      const wt = n === 0 ? 1 - ft : ft;
      u += wt * ((d[o] * (1 - fx) + d[o + 2] * fx) * (1 - fy) + (d[o + row] * (1 - fx) + d[o + row + 2] * fx) * fy);
      v += wt * ((d[o + 1] * (1 - fx) + d[o + 3] * fx) * (1 - fy) + (d[o + row + 1] * (1 - fx) + d[o + row + 3] * fx) * fy);
    }
    out.x = u * c.scale;
    out.y = v * c.scale;
    return out;
  }

  /** Water level at the tide station, metres above the model datum. */
  tide(t: number, source: Source = 'truth'): number {
    const series = source === 'truth' ? this.course.tide.truth : this.course.tide.forecast;
    return catmull(series, (this.startOffset + t) / this.course.season.stepSeconds);
  }

  /** Metres per hour. Positive is a rising tide. */
  tideRate(t: number, source: Source = 'truth'): number {
    return (this.tide(t + 300, source) - this.tide(t - 300, source)) * 6;
  }

  /** Charted depth below the model datum, metres. 0 on land. */
  chartDepth(x: number, y: number): number {
    const g = this.course.depth;
    if (g.insets) {
      for (let n = 0; n < g.insets.length; n++) if (inside(g.insets[n], x, y) >= 0) return this.depthIn(g.insets[n], this.depInsets[n], x, y);
    }
    if (x < g.x0 || y < g.y0 || x > g.x0 + (g.nx - 1) * g.dx || y > g.y0 + (g.ny - 1) * g.dx) return 60;
    return this.depthIn(g, 0, x, y);
  }

  private depthIn(g: GridSpec, start: number, x: number, y: number): number {
    const scale = this.course.depth.scale;
    const { i, j, fx, fy } = bilinear(g, x, y);
    const d = this.dep;
    const o = start + j * g.nx + i;
    const a = d[o];
    const b = d[o + 1];
    const c = d[o + g.nx];
    const e = d[o + g.nx + 1];
    // Any land corner makes the nearest corner decide, so a shoreline is never smeared into deep water.
    if (a === 0 || b === 0 || c === 0 || e === 0) {
      const near = fy < 0.5 ? (fx < 0.5 ? a : b) : fx < 0.5 ? c : e;
      if (near === 0) return 0;
      return Math.min(...[a, b, c, e].filter((n) => n > 0)) * scale * 0.5;
    }
    return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy) * scale;
  }

  /** Depth of water here and now: charted depth plus the height of tide. 0 on land. */
  depth(x: number, y: number, t: number): number {
    const charted = this.chartDepth(x, y);
    return charted <= 0 ? 0 : Math.max(0, charted + this.tide(t));
  }

  /** The sea as a sim takes it. Nothing unless `seas` has been set. */
  sea(x: number, y: number, t: number): SeaSample | null {
    return this.seas ? this.seas.sample(x, y, t) : null;
  }

  sample(x: number, y: number, t: number): EnvSample {
    const w = this.gustyWind(x, y, t);
    const c = this.current(x, y, t);
    const o = this.out;
    o.windDir = w.dir;
    o.windSpeed = w.speed;
    o.currentX = c.x;
    o.currentY = c.y;
    o.depth = this.depth(x, y, t);
    return o;
  }
}
