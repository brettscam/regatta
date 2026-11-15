import type { SeaSample } from '@slack-tide/sim';
import type { ReplayWorld } from './replay';

/**
 * The sea state: how big, how long and how steep the waves are at a place and time. Pure: wind, fetch, stream and depth
 * in, a sea out, so every player gets the same water at the same moment of the season.
 *
 * How it is worked out, in the order it happens:
 * 1. Wind sea from the wind and the fetch (the JONSWAP fetch-limited curves):
 *      g Hs / U^2 = 0.0016 (g F / U^2)^(1/2)      g Tp / U = 0.286 (g F / U^2)^(1/3)
 *    capped at the fully developed sea, Hs = 0.243 U^2 / g and Tp = 8.13 U / g. U is the wind-stress speed of the Shore
 *    Protection Manual, 0.71 W^1.23, where W is the hourly wind over the WATER in m/s, so a stream running against the
 *    wind already raises the sea a little. F is the open water to windward, read off the depth
 *    chart along seven rays 15 degrees apart and averaged with cos^2 weights, so a gap like the Golden Gate lets
 *    through only what a gap would.
 * 2. Shoaling where the water is shallow against the wavelength: the waves shorten (L = L0 sqrt(tanh(k0 d))) and stand
 *    up by the shoaling coefficient, and nothing stands higher than half the depth.
 * 3. Wind against tide. Waves running onto a stream U (positive with them, negative against) change speed
 *    c / c0 = (1 + sqrt(1 + 4U / c0)) / 2, length L = L0 (c / c0)^2 and height H = H0 c0 / sqrt(c (c + 2U)).
 *    Against the stream they shorten and stand up; with it they stretch and flatten. Because a wind sea is partly made
 *    on the moving water rather than run onto it, only half the stream is used. Steepness past 0.10 is breaking, and
 *    breaking takes the height back down to that.
 * 4. An ocean swell where the water declares one: its height times how open the place is to the direction it comes
 *    from, shoaled the same way.
 */
export const SEA = {
  /** Rays to windward for the fetch, degrees off the wind, and how far each is followed, metres. */
  rays: [-45, -30, -15, 0, 15, 30, 45],
  reach: 40000,
  /** Open water counted beyond the edge of the chart when a ray runs off it, km, unless the water says otherwise. */
  openFetchKm: 8,
  /** Share of the stream the wind sea feels. */
  streamShare: 0.5,
  /** The most a foul stream raises the height, and the most a fair one lowers it. */
  streamMax: 1.8,
  streamMin: 0.6,
  /** Steepness at which the sea starts to break, and at which it all is. Nothing is steeper than the second. */
  breakFrom: 0.065,
  breakAt: 0.1,
  /** Height over depth at which waves break on a shoal. */
  depthBreak: 0.5,
  /** Metres between the points the sea is worked out at, and seconds between the times. In between it is blended. */
  cell: 250,
  knot: 600,
} as const;

const G = 9.81;
const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

/** An ocean swell coming into a water from outside it. */
export interface SwellSpec {
  /** Significant height in the open, metres. */
  height: number;
  /** Seconds. */
  period: number;
  /** Direction it comes from, degrees true. */
  fromDeg: number;
}

/** What a water says about its sea. All optional: with none of it there is no swell and the default open fetch. */
export interface SeaSpec {
  swell?: SwellSpec;
  /** Open water beyond the edge of the chart, km, for a wind blowing in off it. */
  openFetchKm?: number;
}

/** The sea at one place and time. */
export interface Sea {
  /** Significant height of everything together, metres. */
  height: number;
  /** The wind sea alone: height, peak period in seconds, wavelength in metres, the direction it comes from (compass radians), height over length. */
  windHeight: number;
  period: number;
  length: number;
  dir: number;
  steepness: number;
  /** 0 to 1, how much of it is breaking. */
  breaking: number;
  /** Open water to windward, metres. */
  fetch: number;
  /** Stream running against the waves, m/s. Negative when it runs with them. */
  against: number;
  /** What the stream has done to the height: above 1 raised, below 1 flattened. */
  streamFactor: number;
  /** What the shoaling has done to the height. */
  shoalFactor: number;
  /** The swell here, where the water has one: height, metres, and wavelength. Period and direction are the water's own. */
  swellHeight: number;
  swellLength: number;
  swellPeriod: number;
  swellDir: number;
}

export function emptySea(): Sea {
  return { height: 0, windHeight: 0, period: 0, length: 0, dir: 0, steepness: 0, breaking: 0, fetch: 0, against: 0, streamFactor: 1, shoalFactor: 1, swellHeight: 0, swellLength: 0, swellPeriod: 0, swellDir: 0 };
}

/** Deep-water wavelength for a period: g T^2 / 2 pi. */
export function deepLength(period: number): number {
  return (G * period * period) / TAU;
}

/**
 * The wind sea a steady wind raises over a stretch of open water.
 * @param wind wind speed over the water at 10 m, m/s
 * @param fetch open water to windward, metres
 */
export function fetchLimited(wind: number, fetch: number): { height: number; period: number } {
  if (!(wind > 0.5) || !(fetch > 0)) return { height: 0, period: 0 };
  const u = 0.71 * Math.pow(wind, 1.23);
  const x = (G * fetch) / (u * u);
  const height = Math.min(0.243, 0.0016 * Math.sqrt(x)) * ((u * u) / G);
  const period = Math.min(8.13, 0.286 * Math.cbrt(x)) * (u / G);
  return { height, period };
}

/** Waves coming into shallow water: shorter, and (once it is really shallow) higher, until they break. */
export function shoal(height: number, period: number, depth: number): { height: number; length: number; factor: number } {
  const l0 = deepLength(period);
  if (!(l0 > 0) || !(height > 0)) return { height: 0, length: l0, factor: 1 };
  if (!(depth > 0)) return { height: 0, length: l0, factor: 0 };
  const k0d = (TAU * depth) / l0;
  if (k0d > 3.2) return { height: Math.min(height, SEA.depthBreak * depth), length: l0, factor: 1 };
  // Eckart's fit to the dispersion relation, then group speed from it.
  const length = l0 * Math.sqrt(Math.tanh(k0d));
  const kd = (TAU * depth) / length;
  const n = 0.5 * (1 + (2 * kd) / Math.sinh(2 * kd));
  const ks = Math.min(1.5, Math.max(0.9, Math.sqrt(l0 / (2 * n * length))));
  const h = Math.min(height * ks, SEA.depthBreak * depth);
  return { height: h, length, factor: h / height };
}

/**
 * Waves on a stream. `along` is the stream in the direction the waves travel, m/s: negative when it runs against them.
 * Feed it the whole stream; the share the wind sea feels is taken here.
 */
export function onStream(height: number, length: number, along: number): { height: number; length: number; steepness: number; breaking: number; factor: number } {
  if (!(height > 0) || !(length > 0)) return { height: 0, length, steepness: 0, breaking: 0, factor: 1 };
  const c0 = Math.sqrt((G * length) / TAU);
  const u = along * SEA.streamShare;
  // Past a quarter of their own speed against them, waves cannot make way at all: hold just short of that.
  const x = Math.max(-0.75, (4 * u) / c0);
  const ue = (x * c0) / 4;
  const c = 0.5 * c0 * (1 + Math.sqrt(1 + x));
  const factor = Math.min(SEA.streamMax, Math.max(SEA.streamMin, c0 / Math.sqrt(c * (c + 2 * ue))));
  const l = length * (c / c0) * (c / c0);
  let h = height * factor;
  const raw = h / l;
  const breaking = Math.min(1, Math.max(0, (raw - SEA.breakFrom) / (SEA.breakAt - SEA.breakFrom)));
  if (raw > SEA.breakAt) h = SEA.breakAt * l;
  return { height: h, length: l, steepness: h / l, breaking, factor: h / height };
}

/** What the fetch is read from: where the land is, and where the chart ends. */
export interface FetchChart {
  land(x: number, y: number): boolean;
  inside(x: number, y: number): boolean;
}

/**
 * Open water to windward of a point, metres: the distance to land along rays either side of the wind, averaged with
 * cos^2 weights. A ray that runs off the chart counts `open` metres more and stops.
 * @param from direction the wind blows from, compass radians
 */
export function effectiveFetch(chart: FetchChart, x: number, y: number, from: number, open: number = SEA.openFetchKm * 1000): number {
  if (chart.land(x, y)) return 0;
  let sum = 0;
  let weights = 0;
  for (const deg of SEA.rays) {
    const a = from + deg * D2R;
    const sx = Math.sin(a);
    const sy = Math.cos(a);
    let d = 0;
    let reached: number = SEA.reach;
    while (d < SEA.reach) {
      // Short steps close in, where a spit or a breakwater matters; longer ones further off.
      d += d < 1500 ? 75 : 150;
      const px = x + sx * d;
      const py = y + sy * d;
      if (!chart.inside(px, py)) { reached = Math.min(SEA.reach, d + open); break; }
      if (chart.land(px, py)) { reached = d; break; }
    }
    const w = Math.cos(deg * D2R) ** 2;
    sum += reached * w;
    weights += w;
  }
  return sum / weights;
}

/** How open a point is to a swell from a direction: the share of five rays toward it that reach 12 km, or the chart's edge, without meeting land. */
export function swellExposure(chart: FetchChart, x: number, y: number, from: number): number {
  if (chart.land(x, y)) return 0;
  let open = 0;
  const rays = [-24, -12, 0, 12, 24];
  for (const deg of rays) {
    const a = from + deg * D2R;
    const sx = Math.sin(a);
    const sy = Math.cos(a);
    let clear = true;
    for (let d = 150; d <= 12000; d += 150) {
      const px = x + sx * d;
      const py = y + sy * d;
      if (!chart.inside(px, py)) break;
      if (chart.land(px, py)) { clear = false; break; }
    }
    if (clear) open++;
  }
  return open / rays.length;
}

const one = (m: number): string => m.toFixed(1);
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** The sea in a sailor's words: "short steep chop, 0.8 m, wind against tide". */
export function describeSea(sea: Sea): string {
  const h = sea.windHeight;
  let words: string;
  if (h < 0.08) words = 'flat water';
  else if (h < 0.2) words = `ripples, ${one(h)} m`;
  else {
    const short = sea.length < 14;
    let kind: string;
    if (sea.breaking > 0.5 && h >= 0.4) kind = short ? 'short breaking chop' : 'breaking seas';
    else if (sea.steepness >= 0.055) kind = short ? 'short steep chop' : sea.length < 40 ? 'steep chop' : 'steep seas';
    else if (h < 0.35) kind = 'light chop';
    else kind = sea.length < 40 ? 'chop' : 'seas';
    words = `${kind}, ${one(h)} m`;
    if (sea.against > 0.35 && sea.streamFactor > 1.08) words += ', wind against tide';
    else if (sea.against < -0.35 && sea.streamFactor < 0.93) words += ', tide with the wind';
    else if (sea.shoalFactor > 1.08) words += ', shoaling';
  }
  if (sea.swellHeight >= 0.2) {
    const from = COMPASS[Math.round((((sea.swellDir / D2R) % 360) + 360) % 360 / 45) % 8];
    const swell = `${one(sea.swellHeight)} m ${from} swell, ${Math.round(sea.swellPeriod)} s`;
    words = h < 0.08 ? swell : `${words} on a ${swell}`;
  }
  return words;
}

// What is kept at each point the sea is worked out at.
const FIELDS = 12;
const [F_H, F_PERIOD, F_LENGTH, F_SIN, F_COS, F_STEEP, F_BREAK, F_FETCH, F_AGAINST, F_STREAM, F_SHOAL, F_SWELL] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * The sea over a replayed water. `at` gives the full account, `sample` the one wave train the sim wants.
 * Working the fetch out is slow, so the sea is worked out at points 250 m and ten minutes apart, all lined up on the
 * season's own clock and the course's own grid, and blended between them: the same numbers on every screen.
 */
export class SeaState {
  readonly spec: SeaSpec;
  private readonly chart: FetchChart;
  private readonly nodes = new Map<number, Float64Array>();
  private boost: number;
  private readonly out: Sea = emptySea();
  private readonly forSim: SeaSample = { height: 0, length: 0, dir: 0, steepness: 0 };
  private readonly scratch = emptySea();

  constructor(private readonly world: ReplayWorld, spec: SeaSpec = {}) {
    this.spec = spec;
    this.boost = world.windBoost;
    const g = world.course.depth;
    const x1 = g.x0 + (g.nx - 1) * g.dx;
    const y1 = g.y0 + (g.ny - 1) * g.dx;
    this.chart = {
      land: (x, y) => world.chartDepth(x, y) <= 0,
      inside: (x, y) => x >= g.x0 && y >= g.y0 && x <= x1 && y <= y1,
    };
  }

  /**
   * The sea at a point at a moment in the season, worked out in full with nothing blended. Slow: for tests, tables
   * and the points `at` blends between.
   * @param seasonTime seconds into the season
   */
  compute(x: number, y: number, seasonTime: number, out: Sea = emptySea()): Sea {
    const world = this.world;
    const t = seasonTime - world.startOffset;
    Object.assign(out, emptySea());
    const depth = world.depth(x, y, t);
    if (depth <= 0) return out;
    const wind = world.wind(x, y, t);
    const stream = world.current(x, y, t);
    const cx = stream.x;
    const cy = stream.y;
    // The wind over the water, which is what raises the sea.
    const u = Math.hypot(-wind.speed * Math.sin(wind.dir) - cx, -wind.speed * Math.cos(wind.dir) - cy);
    out.dir = wind.dir;
    out.fetch = effectiveFetch(this.chart, x, y, wind.dir, (this.spec.openFetchKm ?? SEA.openFetchKm) * 1000);
    const grown = fetchLimited(u, out.fetch);
    out.period = grown.period;
    const shoaled = shoal(grown.height, grown.period, depth);
    out.shoalFactor = shoaled.factor;
    // The stream along the way the waves are going: they travel downwind.
    const along = -(cx * Math.sin(wind.dir) + cy * Math.cos(wind.dir));
    out.against = -along;
    const run = onStream(shoaled.height, shoaled.length, along);
    out.streamFactor = run.factor;
    out.windHeight = run.height;
    out.length = run.length;
    out.steepness = run.steepness;
    out.breaking = run.breaking;

    const swell = this.spec.swell;
    if (swell && swell.height > 0 && swell.period > 0) {
      const from = swell.fromDeg * D2R;
      const s = shoal(swell.height * swellExposure(this.chart, x, y, from), swell.period, depth);
      out.swellHeight = s.height;
      out.swellLength = s.length;
      out.swellPeriod = swell.period;
      out.swellDir = from;
    }
    out.height = Math.hypot(out.windHeight, out.swellHeight);
    return out;
  }

  private node(ix: number, iy: number, it: number): Float64Array {
    // Room for 4096 points each way and 4096 knots: far more than any water or season.
    const key = ((it + 8) * 4096 + (iy + 2048)) * 4096 + (ix + 2048);
    let n = this.nodes.get(key);
    if (n) return n;
    if (this.nodes.size > 24000) this.nodes.clear();
    const s = this.compute(ix * SEA.cell, iy * SEA.cell, Math.min(Math.max(0, it * SEA.knot), this.world.seasonLength), this.scratch);
    n = new Float64Array(FIELDS);
    n[F_H] = s.windHeight;
    n[F_PERIOD] = s.period;
    n[F_LENGTH] = s.length;
    n[F_SIN] = Math.sin(s.dir);
    n[F_COS] = Math.cos(s.dir);
    n[F_STEEP] = s.steepness;
    n[F_BREAK] = s.breaking;
    n[F_FETCH] = s.fetch;
    n[F_AGAINST] = s.against;
    n[F_STREAM] = s.streamFactor;
    n[F_SHOAL] = s.shoalFactor;
    n[F_SWELL] = s.swellHeight;
    this.nodes.set(key, n);
    return n;
  }

  /**
   * The sea at a place and a session time. The result is reused by the next call unless `out` is given.
   * @param t session time, seconds, as everything on the world takes it
   */
  at(x: number, y: number, t: number, out: Sea = this.out): Sea {
    const world = this.world;
    // A harder blow chosen on the way in changes every sea on the water.
    if (world.windBoost !== this.boost) {
      this.boost = world.windBoost;
      this.nodes.clear();
    }
    const st = Math.min(Math.max(0, world.startOffset + t), world.seasonLength);
    const gx = x / SEA.cell;
    const gy = y / SEA.cell;
    const gt = st / SEA.knot;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const it = Math.floor(gt);
    const fx = gx - ix;
    const fy = gy - iy;
    const ft = gt - it;
    let h = 0;
    let swell = 0;
    let weight = 0;
    let period = 0, length = 0, sin = 0, cos = 0, steep = 0, breaking = 0, fetch = 0, against = 0, stream = 0, shoaling = 0;
    for (let c = 0; c < 8; c++) {
      const ax = c & 1;
      const ay = (c >> 1) & 1;
      const az = (c >> 2) & 1;
      const w = (ax ? fx : 1 - fx) * (ay ? fy : 1 - fy) * (az ? ft : 1 - ft);
      if (w <= 0) continue;
      const n = this.node(ix + ax, iy + ay, it + az);
      h += w * n[F_H];
      swell += w * n[F_SWELL];
      // What the waves are like is taken from the points that have waves: a point on the land has no say in it.
      const e = w * (n[F_H] + 1e-3) * (n[F_FETCH] > 0 ? 1 : 0);
      weight += e;
      period += e * n[F_PERIOD];
      length += e * n[F_LENGTH];
      sin += e * n[F_SIN];
      cos += e * n[F_COS];
      steep += e * n[F_STEEP];
      breaking += e * n[F_BREAK];
      fetch += e * n[F_FETCH];
      against += e * n[F_AGAINST];
      stream += e * n[F_STREAM];
      shoaling += e * n[F_SHOAL];
    }
    const k = weight > 0 ? 1 / weight : 0;
    out.windHeight = h;
    out.period = period * k;
    out.length = length * k;
    out.dir = weight > 0 ? (Math.atan2(sin, cos) + TAU) % TAU : 0;
    out.steepness = steep * k;
    out.breaking = breaking * k;
    out.fetch = fetch * k;
    out.against = against * k;
    out.streamFactor = weight > 0 ? stream * k : 1;
    out.shoalFactor = weight > 0 ? shoaling * k : 1;
    const sw = this.spec.swell;
    out.swellHeight = swell;
    out.swellPeriod = sw?.period ?? 0;
    out.swellDir = (sw?.fromDeg ?? 0) * D2R;
    out.swellLength = sw && swell > 0 ? shoal(1, sw.period, Math.max(0.5, world.depth(x, y, t))).length : 0;
    out.height = Math.hypot(h, swell);
    return out;
  }

  /**
   * The sea as the sim takes it: one wave train. That is the wind sea, unless a swell is the bigger thing to a boat
   * (by height times the square root of steepness, so a long low swell does not outrank a steep chop).
   * The result is reused by the next call.
   */
  sample(x: number, y: number, t: number): SeaSample | null {
    const sea = this.at(x, y, t);
    if (sea.height < 0.02) return null;
    const o = this.forSim;
    const swellSteep = sea.swellLength > 0 ? sea.swellHeight / sea.swellLength : 0;
    if (sea.swellHeight * Math.sqrt(swellSteep) > sea.windHeight * Math.sqrt(sea.steepness)) {
      o.height = sea.swellHeight;
      o.length = sea.swellLength;
      o.dir = sea.swellDir;
      o.steepness = swellSteep;
    } else {
      o.height = sea.windHeight;
      o.length = sea.length;
      o.dir = sea.dir;
      o.steepness = sea.steepness;
    }
    return o.length > 0.5 ? o : null;
  }
}
