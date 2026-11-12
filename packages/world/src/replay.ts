import type { Environment, EnvSample } from '@slack-tide/sim';

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
}

export interface CourseMark {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: string;
}

/** The course package written by pipeline/bake_sfbay.py. */
export interface CourseData {
  id: string;
  name: string;
  origin: { lat: number; lon: number };
  timeZone: string;
  season: { id: string; start: string; hours: number; stepSeconds: number; source: string };
  forecast: { issued: string; hours: number; source: string };
  current: GridSpec & { scale: number; steps: number; file: string };
  depth: GridSpec & { scale: number; file: string };
  terrain: GridSpec & { max: number; file: string; source: string };
  wind: GridSpec & { scale: number; truth: WindStep[]; forecast: WindStep[]; note: string };
  tide: { station: string; x: number; y: number; truth: number[]; forecast: number[]; note: string };
  bridge: { south: [number, number]; north: [number, number] };
  marks: CourseMark[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Land outlines as flat x, y lists in metres. */
  coast: number[][];
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
  readonly startOffset: number;
  private readonly cur: Int8Array;
  private readonly dep: Uint8Array;
  private readonly out: EnvSample = { windDir: 0, windSpeed: 0, currentX: 0, currentY: 0, depth: 0 };
  private readonly scratch = { x: 0, y: 0 };

  constructor(data: ReplayData, startOffset = 0) {
    this.course = data.course;
    this.cur = data.current;
    this.dep = data.depth;
    this.startOffset = startOffset;
    const c = this.course.current;
    if (this.cur.length !== c.steps * c.nx * c.ny * 2) throw new Error('Current data does not match its grid');
    if (this.dep.length !== this.course.depth.nx * this.course.depth.ny) throw new Error('Depth data does not match its grid');
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
    return { dir: (Math.atan2(-u, -v) + TAU) % TAU, speed: Math.hypot(u, v) };
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
    return { dir: (base.dir + shift + TAU) % TAU, speed: Math.max(0, base.speed * (1 + puff)) };
  }

  /** Surface current in m/s east and north. Zero over land and outside the grid. */
  current(x: number, y: number, t: number, out = this.scratch): { x: number; y: number } {
    const c = this.course.current;
    const pos = Math.min(c.steps - 1, Math.max(0, (this.startOffset + t) / this.course.season.stepSeconds));
    const k = Math.min(c.steps - 2, Math.floor(pos));
    const ft = pos - k;
    const { i, j, fx, fy } = bilinear(c, x, y);
    const stride = c.nx * c.ny * 2;
    const base = (j * c.nx + i) * 2;
    const row = c.nx * 2;
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
    if (x < g.x0 || y < g.y0 || x > g.x0 + (g.nx - 1) * g.dx || y > g.y0 + (g.ny - 1) * g.dx) return 60;
    const { i, j, fx, fy } = bilinear(g, x, y);
    const d = this.dep;
    const o = j * g.nx + i;
    const a = d[o];
    const b = d[o + 1];
    const c = d[o + g.nx];
    const e = d[o + g.nx + 1];
    // Any land corner makes the nearest corner decide, so a shoreline is never smeared into deep water.
    if (a === 0 || b === 0 || c === 0 || e === 0) {
      const near = fy < 0.5 ? (fx < 0.5 ? a : b) : fx < 0.5 ? c : e;
      if (near === 0) return 0;
      return Math.min(...[a, b, c, e].filter((n) => n > 0)) * g.scale * 0.5;
    }
    return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy) * g.scale;
  }

  /** Depth of water here and now: charted depth plus the height of tide. 0 on land. */
  depth(x: number, y: number, t: number): number {
    const charted = this.chartDepth(x, y);
    return charted <= 0 ? 0 : Math.max(0, charted + this.tide(t));
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
