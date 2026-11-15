// Chartwork for an ocean passage: a projection to put latitude and longitude on the game's flat metres,
// the names a compass course goes by, and dead reckoning from courses steered and speeds guessed.
// Pure arithmetic: no clocks, no randomness, no browser.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const NM = 1852;
/** Earth radius that makes one minute of latitude one nautical mile. */
export const EARTH_RADIUS = (NM * 60 * 180) / Math.PI;

export interface LatLon {
  /** Degrees, south negative. */
  lat: number;
  /** Degrees, west negative. */
  lon: number;
}

export interface Projection {
  readonly lat0: number;
  readonly lon0: number;
  /** Flat metres east (x) and north (y) of the projection's centre. */
  toXY(lat: number, lon: number): { x: number; y: number };
  toLatLon(x: number, y: number): LatLon;
  /** Flat metres per true metre at a northing. 1 at the centre's latitude. */
  scaleAt(y: number): number;
}

const psi = (latRad: number) => Math.log(Math.tan(Math.PI / 4 + latRad / 2));

/**
 * Mercator about a middle latitude. Angles are true everywhere and a steady compass course is a straight line,
 * which is why a navigator's chart is drawn this way. The price is scale: away from the middle latitude a flat
 * metre is not a true metre (`scaleAt`), by the ratio of the cosines of the two latitudes.
 */
export function mercator(lat0: number, lon0: number): Projection {
  const k0 = Math.cos(lat0 * D2R);
  const psi0 = psi(lat0 * D2R);
  const toLat = (y: number) => 2 * Math.atan(Math.exp(y / (EARTH_RADIUS * k0) + psi0)) - Math.PI / 2;
  return {
    lat0,
    lon0,
    toXY: (lat, lon) => ({ x: EARTH_RADIUS * k0 * (lon - lon0) * D2R, y: EARTH_RADIUS * k0 * (psi(lat * D2R) - psi0) }),
    toLatLon: (x, y) => ({ lat: toLat(y) * R2D, lon: lon0 + (x / (EARTH_RADIUS * k0)) * R2D }),
    scaleAt: (y) => k0 / Math.cos(toLat(y)),
  };
}

/**
 * True distance in metres along the steady-course line between two flat points, and its course.
 * On a Mercator chart the course is the angle of the straight line; the distance is the change of latitude
 * over the cosine of the course, or the departure along a parallel when the course is east or west.
 */
export function rhumb(p: Projection, a: { x: number; y: number }, b: { x: number; y: number }): { metres: number; course: number } {
  const course = Math.atan2(b.x - a.x, b.y - a.y);
  const la = p.toLatLon(a.x, a.y).lat * D2R;
  const lb = p.toLatLon(b.x, b.y).lat * D2R;
  const c = Math.cos(course);
  const metres = Math.abs(c) > 1e-3
    ? (EARTH_RADIUS * (lb - la)) / c
    : Math.abs(b.x - a.x) / p.scaleAt((a.y + b.y) / 2);
  return { metres: Math.abs(metres), course: (course + Math.PI * 2) % (Math.PI * 2) };
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const WORDS: Record<string, string> = { N: 'north', E: 'east', S: 'south', W: 'west' };

/** The nearest of the sixteen compass points to a direction in radians: `NNE`. */
export function compassPoint(rad: number): string {
  const deg = ((rad * R2D) % 360 + 360) % 360;
  return POINTS[Math.round(deg / 22.5) % 16];
}

/** The same point in words, as a log would give a wind: `north-north-east`. */
export function compassWords(rad: number): string {
  const p = compassPoint(rad);
  if (p.length === 1) return WORDS[p];
  if (p.length === 2) return `${WORDS[p[0]]}-${WORDS[p[1]]}`;
  return `${WORDS[p[0]]}-${WORDS[p[1]]}-${WORDS[p[2]]}`;
}

/** A latitude or longitude as degrees and minutes: `54° 10' S`. */
export function degMin(value: number, kind: 'lat' | 'lon'): string {
  const hemi = kind === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E';
  let d = Math.floor(Math.abs(value));
  let m = Math.round((Math.abs(value) - d) * 60);
  if (m === 60) { d += 1; m = 0; }
  return `${d}° ${String(m).padStart(2, '0')}' ${hemi}`;
}

/** Where the navigator believes the boat to be, and how far she is thought to have run. */
export interface Reckoning {
  x: number;
  y: number;
  /** Flat metres run by the reckoning. */
  run: number;
}

/**
 * Carry a reckoning forward: so long on such a course at such a speed. This is all a navigator without a fix has.
 * What it leaves out (leeway, the set of the stream, a helmsman who wanders) is why it drifts from the truth.
 * @param course compass course steered, radians clockwise from north
 * @param speed speed through the water as judged, m/s
 */
export function advanceReckoning(r: Reckoning, course: number, speed: number, seconds: number): Reckoning {
  const d = speed * seconds;
  return { x: r.x + Math.sin(course) * d, y: r.y + Math.cos(course) * d, run: r.run + Math.abs(d) };
}

/** The 1916 wording of the Beaufort scale, by force. */
export const BEAUFORT_WORDS = ['Calm', 'Light air', 'Light breeze', 'Gentle breeze', 'Moderate breeze', 'Fresh breeze', 'Strong breeze', 'Moderate gale', 'Fresh gale', 'Strong gale', 'Whole gale', 'Storm', 'Hurricane'];
const BEAUFORT_KT = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];

/** Beaufort force for a mean wind in knots. */
export function beaufort(knots: number): number {
  let f = 0;
  while (f < BEAUFORT_KT.length && knots >= BEAUFORT_KT[f]) f++;
  return f;
}
