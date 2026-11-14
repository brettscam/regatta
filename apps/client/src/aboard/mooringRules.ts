/**
 * The decisions behind anchoring, picking up a mooring and turning in, kept apart from the scene and the screen
 * so they can be tested on their own. Nothing here touches the sim, the DOM or three.js.
 */

const KT = 0.514444;

/** The numbers a skipper would otherwise have to guess at. Distances in metres, speeds in knots. */
export const LIMITS = {
  /** How close to a mooring or dock she has to be for the crew to get a line on it. */
  berthRange: 90,
  /** The most way she can carry onto a mooring or a dock. */
  berthKt: 2.5,
  /** The most way she can carry when the anchor goes down. */
  anchorKt: 2,
  /** The deepest water her cable reaches the bottom in with enough scope left to hold. */
  maxDepth: 25,
  /** Water wanted under the keel where the anchor goes down. */
  clearance: 1,
  /** Cable let out for each metre of water, and the least and most she carries. */
  scopeRatio: 4,
  minScope: 15,
  maxScope: 60,
  /** Within this of a mooring or dock, and this slow, the player is told that X picks it up. */
  hintRange: 150,
  hintKt: 3,
  /** More wind than this and nobody sleeps. */
  sleepWindKt: 25,
  /** Water wanted under the keel at low water in the night. */
  sleepClearance: 1,
} as const;

/** The part of a place this module needs. */
export interface Berth {
  id: string;
  name: string;
  x: number;
  y: number;
  kind?: string;
}

export type Verdict<T = object> = ({ ok: true } & T) | { ok: false; say: string };

const m1 = (metres: number): string => (metres >= 10 ? String(Math.round(metres)) : metres.toFixed(1));
const kt1 = (kt: number): string => kt.toFixed(1);

/** A mooring buoy or a dock: somewhere a line can be made fast. */
export function isBerth(place: Berth): boolean {
  return place.kind === 'mooring' || place.kind === 'dock';
}

/** The nearest mooring or dock within `within` metres of a point, if there is one. */
export function nearestBerth<T extends Berth>(places: readonly T[], x: number, y: number, within: number): { place: T; distance: number } | null {
  let best: { place: T; distance: number } | null = null;
  for (const place of places) {
    if (!isBerth(place)) continue;
    const distance = Math.hypot(place.x - x, place.y - y);
    if (distance <= within && (!best || distance < best.distance)) best = { place, distance };
  }
  return best;
}

/** What she is doing while made fast there: "On a mooring at Ayala Cove", "Alongside at Sam's, Tiburon". */
export function berthStatus(place: Pick<Berth, 'name' | 'kind'> | null): string {
  if (!place) return 'On a mooring';
  return place.kind === 'dock' ? `Alongside at ${place.name}` : `On a mooring at ${place.name}`;
}

/** Metres of cable for a depth of water: four times the depth, within what she carries. */
export function anchorScope(depth: number): number {
  return Math.round(Math.min(LIMITS.maxScope, Math.max(LIMITS.minScope, depth * LIMITS.scopeRatio)));
}

/**
 * Can the anchor go down here? She has to be all but stopped, in water the cable can reach the bottom of,
 * with enough of it under her keel.
 * @param c speed over the ground in knots, depth of water now and her draft in metres. `stwKt` is her speed through
 *   the water, where known: it tells way on from a boat stopped in a running tide.
 */
export function canAnchor(c: { sogKt: number; stwKt?: number; depth: number; draft: number }): Verdict<{ scope: number }> {
  if (c.sogKt >= LIMITS.anchorKt) {
    if (inTheStream(c)) {
      return { ok: false, say: `She is stopped in the water, but the stream is setting her at ${kt1(c.sogKt)} kt over the ground: too fast for the anchor to bite. Work out of the tide, closer inshore, then X` };
    }
    return { ok: false, say: `Too much way on to anchor: ${kt1(c.sogKt)} kt over the ground. Luff up head to wind and let her stop, under ${LIMITS.anchorKt} kt, then X lets go` };
  }
  if (c.depth > LIMITS.maxDepth) {
    return { ok: false, say: `Too deep to anchor here: ${m1(c.depth)} m, and her cable is good for ${LIMITS.maxDepth} m. Work in toward the shore until the depth comes down` };
  }
  const need = c.draft + LIMITS.clearance;
  if (c.depth < need) {
    const water = c.depth < 0.1 ? 'her bow is over the shore' : `${m1(c.depth)} m of water and she draws ${m1(c.draft)} m`;
    return { ok: false, say: `Too shallow to anchor here: ${water}. Stand off until there is ${m1(need)} m or more` };
  }
  return { ok: true, scope: anchorScope(c.depth) };
}

/** Stopped through the water but still moving over the ground: it is the tide, not way on. */
function inTheStream(c: { sogKt: number; stwKt?: number }): boolean {
  return c.stwKt !== undefined && c.stwKt < 1;
}

/** Can she pick up this mooring or come alongside this dock? Only slowly. */
export function canBerth(c: { sogKt: number; stwKt?: number; place: Pick<Berth, 'name' | 'kind'> }): Verdict {
  if (c.sogKt < LIMITS.berthKt) return { ok: true };
  const what = c.place.kind === 'dock' ? `come alongside at ${c.place.name}` : `pick up the mooring at ${c.place.name}`;
  if (inTheStream(c)) {
    return { ok: false, say: `The stream is setting her past at ${kt1(c.sogKt)} kt over the ground: too fast to ${what}. Come up to it against the tide, sailing just fast enough to stem it, then X` };
  }
  return { ok: false, say: `Too much way on to ${what}: ${kt1(c.sogKt)} kt over the ground. Luff up head to wind and let her slow below ${LIMITS.berthKt} kt, then X` };
}

/** Seconds since midnight on the clock in a time zone. */
function clockSeconds(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (part('hour') % 24) * 3600 + part('minute') * 60 + part('second');
}

/**
 * Seconds from `now` until the clock in `timeZone` next reads the given time: 06:30 unless told otherwise.
 * Always in the future, so at 06:30 exactly the answer is a whole day. Right across a change of the clocks too.
 */
export function secondsUntilClock(now: Date, timeZone: string, hour = 6, minute = 30): number {
  const DAY = 86400;
  const want = hour * 3600 + minute * 60;
  let seconds = (want - clockSeconds(now, timeZone) + DAY) % DAY;
  if (seconds === 0) seconds = DAY;
  // If the clocks go forward or back in the night, land on the time the clock shows all the same.
  let slip = want - clockSeconds(new Date(now.getTime() + seconds * 1000), timeZone);
  if (slip > DAY / 2) slip -= DAY;
  if (slip < -DAY / 2) slip += DAY;
  return seconds + slip;
}

/** The time on the clock in a time zone, as "06:30". */
export function clockText(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/**
 * The lowest the tide gets over a stretch of time.
 * @param tideAt height of tide a number of seconds from now
 * @returns the height and how many seconds from now it comes
 */
export function lowWater(tideAt: (seconds: number) => number, seconds: number, step = 600): { height: number; after: number } {
  let height = tideAt(0);
  let after = 0;
  for (let k = step; k < seconds + step; k += step) {
    const at = Math.min(k, seconds);
    const h = tideAt(at);
    if (h < height) {
      height = h;
      after = at;
    }
  }
  return { height, after };
}

/**
 * Is it a night to sleep through? Not with other boats sharing the clock, not in a blow, and not if she would
 * touch at low water.
 * @param c `underKeelAtLow` is the water under her keel at the lowest of the tide in the night, null if not known.
 *   `lowClock` is when that is, as the clock will read.
 */
export function canTurnIn(c: { held: boolean; sharing: boolean; windKt: number; underKeelAtLow: number | null; lowClock: string }): Verdict {
  if (!c.held) return { ok: false, say: 'Nobody turns in under way. Anchor or pick up a mooring first (X), then Z' };
  if (c.sharing) return { ok: false, say: 'The clock is shared while other boats are here, so the night cannot be slept through. Keep an anchor watch' };
  if (c.windKt > LIMITS.sleepWindKt) {
    return { ok: false, say: `Blowing ${Math.round(c.windKt)} kt: no night to sleep through. Keep an anchor watch until it eases below ${LIMITS.sleepWindKt} kt` };
  }
  if (c.underKeelAtLow !== null && c.underKeelAtLow < LIMITS.sleepClearance) {
    const left = c.underKeelAtLow <= 0 ? 'she would be aground' : `only ${m1(c.underKeelAtLow)} m would be left under the keel`;
    return { ok: false, say: `Not here: at low water, ${c.lowClock}, ${left}. Move to deeper water before turning in` };
  }
  return { ok: true };
}

/** How far off the wind she bears away on leaving, radians: a close reach. */
export const LEAVING_ANGLE = (55 * Math.PI) / 180;

/**
 * Which side to take the wind on when getting under way: the tack with more water ahead of it, so she does not
 * sail off her anchor straight at the beach. Looks a quarter of a kilometre down each close reach.
 * @param depthAt depth of water a distance along a heading (compass radians) from where she lies
 * @param twd where the wind is from, compass radians
 * @param preferred the side she would take left to herself: 1 wind on the starboard side, -1 on the port side
 * @returns 1 or -1, `preferred` unless the other tack is clearly the deeper
 */
export function clearerTack(depthAt: (heading: number, metres: number) => number, twd: number, preferred: 1 | -1): 1 | -1 {
  const least = (side: number): number => {
    let d = Infinity;
    for (const metres of [30, 60, 100, 150, 200, 250]) d = Math.min(d, depthAt(twd - side * LEAVING_ANGLE, metres));
    return d;
  };
  const mine = least(preferred);
  const other = least(-preferred);
  // Past ten metres it is all deep enough: no reason to change her mind.
  return Math.min(other, 10) > Math.min(mine, 10) + 0.5 ? (-preferred as 1 | -1) : preferred;
}

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Where the wind is from, in words. */
export function compassPoint(rad: number): string {
  const turn = ((rad / (Math.PI * 2)) % 1 + 1) % 1;
  return POINTS[Math.round(turn * 8) % 8];
}

/** Metres a second to knots. */
export function knots(metresPerSecond: number): number {
  return metresPerSecond / KT;
}
