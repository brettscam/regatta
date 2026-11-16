// The wake a ship leaves: a pure function of her track, her speed and her size. No drawing here.
//
// A vessel under way drags a V of waves behind her whose arms lie 19.47 degrees either side of her track whatever
// her speed (Kelvin's angle). What reaches a boat off to one side is the divergent waves along that arm:
// - They arrive some time after she has passed abeam: the arm takes off / tan(19.47) = 2.83 times the distance off to
//   reach you, at her speed. 200 m off a ship doing 12 kt, that is a minute and a half.
// - They travel at 35.3 degrees to her track, at 0.816 of her speed, so their length is (4 pi / 3) V^2 / g and their
//   period 0.816 * 2 pi V / g: 16 m and 3.2 s behind a ship at 12 kt, 45 m and 5.4 s behind a ferry at 20.
// - There are only a few of them: the height builds over the first two and has gone after six or so.
// - They decay with the cube root of the distance off, as the arm of a Kelvin wake does, and then die away over a
//   mile or so.
// The height is the one part that is not theory. It is a rule of thumb fitted to what ships and ferries really throw:
//   H at 100 m = 0.035 * V^1.2 * (beam / 10)^0.75      (metres; V in m/s, beam in metres)
// which gives 0.85 m for a 40 m beam ship at 12 kt, 0.6 m for an 11 m fast ferry at 20 kt, 0.3 m for a 9 m ferry at 12.

const G = 9.81;

export const WAKE = {
  /** Half-angle of the V, radians: asin(1/3). */
  half: Math.asin(1 / 3),
  /** Angle between the track and the way the waves on the arm travel, radians: atan(1/sqrt 2). */
  theta: Math.atan(Math.SQRT1_2),
  heightK: 0.035,
  speedPow: 1.2,
  beamPow: 0.75,
  /** Closer than this to the track, metres, the height is what it is here. */
  minOff: 30,
  /** Metres off over which the height falls to 1/e, on top of the cube-root law. */
  fade: 1500,
  /** Further off than this there is nothing worth the sums. */
  reach: 2200,
  /** Slower than this, m/s, a vessel throws no wake to speak of. Full height comes by twice this. */
  minSpeed: 1.5,
  /** The waves build to their height this many waves in. */
  peakWave: 1.5,
} as const;

/** A vessel as the wake sees her, on a straight line at a steady speed. Sim coordinates: x east, y north, heading compass radians. */
export interface WakeSource {
  x: number;
  y: number;
  heading: number;
  /** m/s. */
  speed: number;
  beam: number;
  name: string;
}

/** Height of her wake `off` metres from her track, metres trough to crest, at its biggest wave. */
export function wakeHeight(speed: number, beam: number, off: number): number {
  if (!(speed > WAKE.minSpeed)) return 0;
  const d = Math.max(WAKE.minOff, off);
  const gather = Math.min(1, (speed - WAKE.minSpeed) / WAKE.minSpeed);
  return WAKE.heightK * Math.pow(speed, WAKE.speedPow) * Math.pow(beam / 10, WAKE.beamPow) * Math.pow(d / 100, -1 / 3) * Math.exp(-d / WAKE.fade) * gather;
}

/** Length of the waves on the arm of the wake, metres. */
export function wakeLength(speed: number): number {
  const c = speed * Math.cos(WAKE.theta);
  return (2 * Math.PI * c * c) / G;
}

/** Seconds between them as they pass a fixed point. */
export function wakePeriod(speed: number): number {
  return (2 * Math.PI * speed * Math.cos(WAKE.theta)) / G;
}

/** Seconds after she passes abeam that her wake arrives, `off` metres from her track. */
export function wakeDelay(off: number, speed: number): number {
  return off / Math.tan(WAKE.half) / speed;
}

export interface WakeHit {
  /** Height of the water above its level here and now, metres. */
  eta: number;
  /** Height of the waves passing now, metres trough to crest: 0 before the wake arrives and after it has gone. */
  height: number;
  /** Height of the biggest wave that will pass, or has passed, here. */
  peak: number;
  /** Seconds until it arrives. 0 once it has. */
  arriveIn: number;
  /** Which way the waves travel, as a unit vector east and north. */
  dirX: number;
  dirY: number;
  /** Their length, metres, and period, seconds. */
  length: number;
  period: number;
  /** How many waves have gone by since it arrived. */
  waves: number;
}

export function emptyHit(): WakeHit {
  return { eta: 0, height: 0, peak: 0, arriveIn: 0, dirX: 0, dirY: 1, length: 0, period: 0, waves: 0 };
}

/** Her wake at a point, now. */
export function wakeAt(src: WakeSource, x: number, y: number, out: WakeHit = emptyHit()): WakeHit {
  const fx = Math.sin(src.heading);
  const fy = Math.cos(src.heading);
  const rx = x - src.x;
  const ry = y - src.y;
  const back = -(rx * fx + ry * fy);
  // Positive to her starboard.
  const lat = rx * fy - ry * fx;
  const side = Math.abs(lat);
  const sgn = lat >= 0 ? 1 : -1;
  const cos = Math.cos(WAKE.theta);
  const sin = Math.sin(WAKE.theta);
  out.dirX = fx * cos + sgn * fy * sin;
  out.dirY = fy * cos - sgn * fx * sin;
  out.length = wakeLength(src.speed);
  out.period = wakePeriod(src.speed);
  out.peak = side < WAKE.reach ? wakeHeight(src.speed, src.beam, side) : 0;
  out.eta = 0;
  out.height = 0;
  out.arriveIn = 0;
  out.waves = 0;
  if (!(out.peak > 0)) return out;
  // Metres the arm of the V has run past this point, measured along her track.
  const u = back - side / Math.tan(WAKE.half);
  if (u <= 0) {
    out.arriveIn = -u / src.speed;
    return out;
  }
  // One wave takes this far along her track to go by.
  const step = out.length / cos;
  out.waves = u / step;
  const q = out.waves / WAKE.peakWave;
  const envelope = q * Math.exp(1 - q);
  out.height = out.peak * envelope;
  const k = (2 * Math.PI) / out.length;
  out.eta = 0.5 * out.height * Math.sin(k * (-back * cos + side * sin));
  return out;
}

/** Where a vessel is at a moment: the shape `Track.state` in `traffic.ts` fills in. */
export interface TrackState {
  x: number;
  y: number;
  heading: number;
  sog: number;
  active: boolean;
}

export interface Passing {
  /** Season time at which she is closest. May be a few minutes ahead. */
  t: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** Metres off at her closest. */
  off: number;
}

/**
 * The times a vessel passes closest to a point, from a quarter of an hour ago to five minutes ahead. Her wake at the
 * point is the wake of a ship that held, all along, the course and speed she had at that moment.
 * @param state where she is at a season time. Pure: traffic positions depend on nothing but the time
 */
export function findPassings(state: (seasonTime: number, out: TrackState) => void, seasonTime: number, x: number, y: number, out: Passing[] = []): Passing[] {
  out.length = 0;
  const st: TrackState = { x: 0, y: 0, heading: 0, sog: 0, active: true };
  const STEP = 5;
  const from = seasonTime - 900;
  const to = seasonTime + 300;
  const dist = (t: number): number => {
    state(t, st);
    return st.active ? Math.hypot(st.x - x, st.y - y) : Infinity;
  };
  let a = dist(from - STEP);
  let b = dist(from);
  for (let t = from; t <= to; t += STEP) {
    const c = dist(t + STEP);
    if (b <= a && b < c && b < WAKE.reach + 200) {
      // Close in on the moment itself.
      let lo = t - STEP;
      let hi = t + STEP;
      for (let i = 0; i < 12; i++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (dist(m1) < dist(m2)) hi = m2;
        else lo = m1;
      }
      const at = (lo + hi) / 2;
      const off = dist(at);
      if (st.active && st.sog > WAKE.minSpeed && off < WAKE.reach) out.push({ t: at, x: st.x, y: st.y, heading: st.heading, speed: st.sog, off });
    }
    a = b;
    b = c;
  }
  return out;
}

/** What a wake does to somebody in a kayak. */
export const KAYAK_WAKE = {
  /** A wake that will be at least this high, metres, is worth a warning. */
  warn: 0.3,
  /** Seconds ahead the warning is given. */
  warnAhead: 30,
  /** Waves this high, metres, taken on the beam put her over. */
  capsize: 0.45,
  /** How nearly beam-on counts: the sine of the angle between her bow and the way the waves travel. 0.8 is within 37 degrees of beam-on. */
  beamOn: 0.8,
} as const;

/**
 * Whether a wake puts a kayak over.
 * @param height waves passing her now, metres trough to crest
 * @param heading her heading, compass radians
 * @param dirX, dirY which way the waves travel, east and north
 */
export function kayakCapsizes(height: number, heading: number, dirX: number, dirY: number): boolean {
  if (height < KAYAK_WAKE.capsize) return false;
  const beam = Math.abs(Math.sin(heading) * dirY - Math.cos(heading) * dirX);
  return beam >= KAYAK_WAKE.beamOn;
}

/**
 * How much of her speed a yacht loses for each second in a wake.
 * A small check: 0.006 a second in half-metre waves for a 10 m waterline, less taken on the beam than on the bow,
 * less for a longer boat, and up to three times as much in light air, when the roll shakes the wind out of the sails.
 * @param height waves passing now, metres
 * @param lwl her waterline length, metres
 * @param headOn 0 beam-on to 1 head-on or stern-on
 * @param awsKt apparent wind, knots
 */
export function wakeCheck(height: number, lwl: number, headOn: number, awsKt: number): number {
  if (!(height > 0.1)) return 0;
  const slat = 1 + 2 * Math.min(1, Math.max(0, 1 - awsKt / 8));
  return 0.006 * (height / 0.5) * (10 / lwl) * (0.4 + 0.6 * headOn) * slat;
}
