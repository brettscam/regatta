/**
 * The weather you can see: fog, haze, cloud and rain squalls. Rules only, no drawing (that is `sky.ts`, `weather.ts`
 * and the sea's shader), so tests can pin them.
 *
 * Every rule here is a function of the season's clock, the place and the recorded wind. Nothing is random and
 * nothing depends on the viewer, so every player on the same water sees the same fog bank in the same place and the
 * same squall coming, and nobody races in clearer air than anybody else.
 */

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Local solar time, hours 0 to 24: noon is when the sun is highest, whatever the clocks say. */
export function solarHour(utcMs: number, lonDeg: number): number {
  const h = (utcMs / 3600000 + lonDeg / 15) % 24;
  return (h + 24) % 24;
}

/** A value at an hour from a list of [hour, value] knots round the clock, eased between them. */
function daily(knots: Array<[number, number]>, hour: number): number {
  const n = knots.length;
  for (let i = 0; i < n; i++) {
    const [h0, v0] = knots[i];
    const [h1raw, v1] = knots[(i + 1) % n];
    const h1 = i === n - 1 ? h1raw + 24 : h1raw;
    const h = hour < knots[0][0] ? hour + 24 : hour;
    if (h >= h0 && h <= h1) return v0 + (v1 - v0) * smooth(h0, h1, h);
  }
  return knots[0][1];
}

// ---- the marine layer ------------------------------------------------------------------------------

/** The way a fog bank comes in: a line from the open sea into the bay, and how wide the tongue is. Course metres. */
export interface FogPath {
  points: Array<[number, number]>;
  /** Half the width of the tongue where it is thickest, metres. */
  halfWidth: number;
}

/** San Francisco Bay: in from the ocean, under the Golden Gate Bridge, past Alcatraz and on toward Berkeley. */
export const SF_FOG_PATH: FogPath = {
  points: [[-9500, -1500], [-6000, -1400], [-2512, -1145], [0, -350], [2371, -250], [5000, 500], [8200, 1500]],
  halfWidth: 1500,
};

/**
 * How far along its path the front of the summer fog has come, 0 (well out at sea) to 1 (the far end).
 * It burns back to just outside the bridge by midday, pours in through the Gate with the afternoon sea breeze,
 * reaches the city front in the evening, so from Alcatraz it is a wall to the west, lies there overnight and
 * retreats through the morning.
 * @param hour local solar time
 * @param breezeKt the recorded wind in the Gate, unboosted: a stronger sea breeze brings it further
 */
export function fogReach(hour: number, breezeKt: number): number {
  const base = daily([[0, 0.6], [5, 0.62], [9, 0.48], [11.5, 0.3], [13, 0.31], [16.5, 0.46], [19.5, 0.55], [22, 0.59]], hour);
  // The afternoon's advance is the sea breeze's doing. In light airs it hangs back at the Gate.
  const push = 0.75 + 0.25 * smooth(7, 17, breezeKt);
  const floor = 0.3;
  return floor + (base - floor) * push;
}

/** Distance along a path of the point on it nearest to (x, y), as a share of its length, and how far off it is. */
function alongPath(path: FogPath, x: number, y: number): { s: number; off: number } {
  const pts = path.points;
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    lens.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    total += lens[i - 1];
  }
  let best = Infinity;
  let bestS = 0;
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const k = clamp01(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (lens[i - 1] * lens[i - 1]));
    const d = Math.hypot(x - (ax + (bx - ax) * k), y - (ay + (by - ay) * k));
    if (d < best) {
      best = d;
      bestS = (run + k * lens[i - 1]) / total;
    }
    run += lens[i - 1];
  }
  return { s: bestS, off: best };
}

/** Length of a fog path, metres. */
export function pathLength(path: FogPath): number {
  let total = 0;
  for (let i = 1; i < path.points.length; i++) total += Math.hypot(path.points[i][0] - path.points[i - 1][0], path.points[i][1] - path.points[i - 1][1]);
  return total;
}

/** The point a share `s` of the way along a path. */
export function pathPoint(path: FogPath, s: number): { x: number; y: number } {
  const total = pathLength(path);
  let want = clamp01(s) * total;
  const pts = path.points;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (want <= len || i === pts.length - 1) {
      const k = Math.min(1, want / len);
      return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k };
    }
    want -= len;
  }
  return { x: pts[0][0], y: pts[0][1] };
}

/**
 * How thick the fog is at a point: 0 clear air, 1 deep in the bank. Thick behind the front, thinning over half a mile
 * ahead of it, and thinning to the sides of the tongue. The tongue narrows toward its tip.
 */
export function fogAt(path: FogPath, reach: number, x: number, y: number): number {
  const { s, off } = alongPath(path, x, y);
  const total = pathLength(path);
  const behind = (reach - s) * total; // metres inside the front
  const along = smooth(-250, 900, behind);
  if (along <= 0) return 0;
  const width = path.halfWidth * (0.55 + 0.45 * smooth(0, 2500, behind));
  // Inside the Gate the warmer bay air eats at it: thick in the slot, thinner past the city front.
  const thin = 1 - 0.45 * smooth(0.42, 0.6, s);
  return along * thin * (1 - smooth(width * 0.45, width, off));
}

/** How far you can see through fog of a given thickness, metres. Clear air is the ordinary haze of the day. */
export function visibility(fog: number, clear = 30000): number {
  // Even at its thickest a quarter of a mile shows: enough to see a boat you are about to meet.
  return clear * Math.pow(420 / clear, clamp01(fog));
}

/** Morning haze among islands: there at dawn, gone by late morning. 0 to 1. */
export function morningHaze(hour: number): number {
  return daily([[0, 0.35], [4.5, 0.8], [7, 1], [9.5, 0.55], [11.5, 0], [20, 0], [22.5, 0.2]], hour);
}

/** How much of the sky fair-weather cloud covers, 0 to 1. A little more builds through the afternoon, and more on a hard day. */
export function cloudCover(hour: number, boost: number): number {
  return clamp01(daily([[0, 0.2], [6, 0.16], [11, 0.2], [15, 0.32], [19, 0.26]], hour) + 0.3 * smooth(1.25, 1.5, boost));
}

// ---- squalls ---------------------------------------------------------------------------------------

export interface Squall {
  /** Centre, course metres. */
  x: number;
  y: number;
  /** Where the rain thins to nothing, metres from the centre. */
  radius: number;
  /** 0 to 1: it builds, blows and passes. */
  strength: number;
}

/** A whole number scrambled into 0 to 1. The same on every machine. */
function hash(n: number): number {
  let h = (n | 0) * 374761393 + 668265263;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Seconds between one squall setting out and the next, and how long each lasts. */
const SQUALL_EVERY = 1150;
const SQUALL_LIFE = 2300;
/** The longest of the world's gust waves: its crests are this far apart along the wind (see `ReplayWorld.gustyWind`). */
const GUST_ALONG = 310;
const GUST_ACROSS = 520;

/**
 * The rain squalls on the water at a moment. They only come on a hard day: `boost` of about 1.4 and up.
 * Each sets out a few miles to windward of the middle of the course, comes down with the wind at the speed the gusts
 * travel, and is gone in under forty minutes. Each rides on a crest of the world's longest gust wave, so the rain
 * really does arrive with more wind.
 * @param u the boosted hourly wind at the middle of the course, m/s toward east
 * @param v toward north
 * @param cx the middle of the course
 */
export function squallsAt(seasonSeconds: number, boost: number, u: number, v: number, cx: number, cy: number, out: Squall[] = []): Squall[] {
  out.length = 0;
  const hard = smooth(1.25, 1.45, boost);
  const speed = Math.hypot(u, v);
  if (hard <= 0 || speed < 2) return out;
  const dx = u / speed;
  const dy = v / speed;
  const drift = speed * 0.7;
  const first = Math.floor(seasonSeconds / SQUALL_EVERY);
  for (let k = first - 1; k <= first; k++) {
    if (k < 0) continue;
    // Not every slot has one.
    if (hash(k * 3 + 1) > 0.72) continue;
    const age = seasonSeconds - k * SQUALL_EVERY;
    if (age < 0 || age > SQUALL_LIFE) continue;
    const across = (hash(k * 3 + 2) - 0.5) * 9000;
    // Where it would be if it simply came down the wind from five kilometres up it...
    const centreAlong = cx * dx + cy * dy;
    const centreAcross = cx * dy - cy * dx;
    const nominal = centreAlong - 5200 + drift * age;
    // ...moved, by less than a kilometre, onto the nearest crest of the gust wave.
    const a = across + centreAcross;
    const phase = (nominal - drift * seasonSeconds) / GUST_ALONG + a / GUST_ACROSS;
    const n = Math.round((phase - Math.PI / 2) / TAU);
    const along = (Math.PI / 2 + TAU * n - a / GUST_ACROSS) * GUST_ALONG + drift * seasonSeconds;
    out.push({
      x: along * dx + a * dy,
      y: along * dy - a * dx,
      radius: 1100 + 500 * hash(k * 3 + 3),
      strength: hard * Math.sin(Math.PI * clamp01(age / SQUALL_LIFE)) ** 0.6,
    });
  }
  return out;
}

/** How hard it is raining at a point, 0 to 1. */
export function rainAt(squalls: readonly Squall[], x: number, y: number): number {
  let rain = 0;
  for (const s of squalls) rain = Math.max(rain, s.strength * (1 - smooth(s.radius * 0.35, s.radius, Math.hypot(x - s.x, y - s.y))));
  return rain;
}
