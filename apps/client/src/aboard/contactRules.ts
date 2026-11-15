/**
 * The decisions behind boats hitting each other, kept apart from the scene and the screen so they can be tested.
 * Nothing here touches the sim, the DOM or three.js. Sim coordinates: x east, y north, metres, heading compass radians.
 *
 * The numbers:
 * - A hull is a capsule: a line along her centreline with a radius of 0.45 of her beam, as long overall as she is.
 *   That is a little inside the real hull at the bow and the quarters, on purpose.
 * - Two hulls have to be inside each other by more than the slop before it counts: 0.4 m against another player's boat,
 *   whose place on this screen is a fraction of a second old, 0.1 m against everything else.
 * - She is pushed clear and loses the way she had toward the other hull; what she had along it she keeps. Stopped with
 *   her bow against another hull and her sails still driving, her head pays off away from it at 5 degrees a second
 *   until she can slide clear, so she is never pinned for good.
 * - Two hulls first found more than a metre inside each other did not sail there: one of them has just arrived, been
 *   towed or been put on a berth. They are pushed apart and no damage is done.
 * - One coming together is one hit, however long they grind. It is over once they have been apart for two seconds.
 * - Under 0.3 kt of closing speed is fenders: no damage. Above it the damage in percent of the hull is
 *   1.5 v² + 1.5 v with v in knots: 3% at 1 kt, 9% at 2, 18% at 3, 30% at 4, 45% at 5, 63% at 6, holed outright from about 7.7.
 *   A ferry or a ship does half as much again.
 * - Damage slows her (the sim's `damageSpeed`: up to 30% off). At 100% she is holed, stops, and is out of any race.
 *   Fifteen seconds later she is afloat again nearby with the damage made good.
 * - Alongside a dock she is mended at 2.5% a second (40 seconds from holed). At anchor or on a mooring, outside a race,
 *   at 1% every six seconds (ten minutes).
 */
const KT = 0.514444;

export const CONTACT = {
  /** Hull radius as a share of beam. */
  radius: 0.45,
  /** Overlap forgiven before two hulls count as touching: another player's boat, and anything sailed on this page. */
  slopRemote: 0.4,
  slopLocal: 0.1,
  /** How fast her head pays off when her bow is pressed against another hull, radians a second. */
  glance: (5 * Math.PI) / 180,
  /** Under this speed, m/s, a pressed bow pays off. Faster, she glances off by herself. */
  glanceUnder: 1,
  /** The way put on a boat a collision stopped dead, m/s, once her sails are driving again. See `Contact.step`. */
  wayOn: 0.02,
  /** A contact that begins deeper than this, metres, is a boat appearing on top of another, not a collision. */
  jump: 1,
  /** Seconds apart before the next touch is a new hit. */
  clear: 2,
  /** Closing speed, knots, under which a touch does no damage. */
  fenders: 0.3,
  /** Damage in percent = square * v² + linear * v, v in knots. */
  square: 1.5,
  linear: 1.5,
  /** A ferry or a ship against a yacht. */
  heavy: 1.5,
  /** Seconds from holed to afloat again. */
  refloat: 15,
  /** Share of the hull mended each second alongside a dock, and held anywhere else outside a race. */
  dockRate: 1 / 40,
  heldRate: 1 / 600,
} as const;

/** A hull on the water. */
export interface Hull {
  x: number;
  y: number;
  heading: number;
  length: number;
  beam: number;
}

export interface Overlap {
  /** Metres the two hulls are inside each other, after the slop. Always above 0. */
  depth: number;
  /** Unit vector from the first hull toward the second, where they touch. */
  nx: number;
  ny: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Whether two hulls are in contact, how deep, and which way the second lies from the first at the point of contact.
 * @param slop metres of overlap to forgive
 */
export function overlap(a: Hull, b: Hull, slop = 0): Overlap | null {
  const ra = a.beam * CONTACT.radius;
  const rb = b.beam * CONTACT.radius;
  const ha = Math.max(0, a.length / 2 - ra);
  const hb = Math.max(0, b.length / 2 - rb);
  const reach = ra + rb - slop;
  if (reach <= 0) return null;
  // Too far apart to touch whichever way they point.
  const cx = b.x - a.x;
  const cy = b.y - a.y;
  const far = ha + hb + reach;
  if (cx * cx + cy * cy >= far * far) return null;

  // Each centreline as a segment: p + s*d, s from -half to +half.
  const ax = Math.sin(a.heading);
  const ay = Math.cos(a.heading);
  const bx = Math.sin(b.heading);
  const by = Math.cos(b.heading);
  // Closest points of two segments (after Ericson), with a1 and b1 the stern ends.
  const a1x = a.x - ax * ha;
  const a1y = a.y - ay * ha;
  const b1x = b.x - bx * hb;
  const b1y = b.y - by * hb;
  const la = 2 * ha;
  const lb = 2 * hb;
  const rx = a1x - b1x;
  const ry = a1y - b1y;
  const dot = ax * bx + ay * by;
  const f = bx * rx + by * ry;
  const c = ax * rx + ay * ry;
  let s = 0;
  let t = 0;
  if (la < 1e-9 && lb < 1e-9) {
    s = 0;
    t = 0;
  } else if (la < 1e-9) {
    t = clamp01(f / lb) * lb;
  } else if (lb < 1e-9) {
    s = clamp01(-c / la) * la;
  } else {
    const denom = 1 - dot * dot;
    s = denom > 1e-9 ? clamp01((dot * f - c) / denom / la) * la : la / 2;
    t = dot * s + f;
    if (t < 0) {
      t = 0;
      s = clamp01(-c / la) * la;
    } else if (t > lb) {
      t = lb;
      s = clamp01((dot * lb - c) / la) * la;
    }
  }
  const px = a1x + ax * s;
  const py = a1y + ay * s;
  const qx = b1x + bx * t;
  const qy = b1y + by * t;
  let nx = qx - px;
  let ny = qy - py;
  const d = Math.hypot(nx, ny);
  if (d >= reach) return null;
  if (d > 1e-6) {
    nx /= d;
    ny /= d;
  } else {
    // The centrelines cross. Out the side of the second hull that the first one's middle is on.
    const side = cx * by - cy * bx >= 0 ? 1 : -1;
    nx = side * by;
    ny = -side * bx;
    const m = Math.hypot(cx, cy);
    if (m > 1e-6 && Math.abs(cx * nx + cy * ny) < 1e-6) {
      nx = cx / m;
      ny = cy / m;
    }
  }
  return { depth: reach - d, nx, ny };
}

/**
 * How fast two boats are coming together along the line between them, m/s. Negative when they are parting.
 * Velocities are over the ground, east and north; `n` is the unit vector from the first toward the second.
 */
export function closingSpeed(vax: number, vay: number, vbx: number, vby: number, nx: number, ny: number): number {
  return (vax - vbx) * nx + (vay - vby) * ny;
}

/**
 * Which way her head goes when she is pressed against another hull: away from it, if it is her bow that is on.
 * @param off bearing of the point of contact from her bow, radians, positive to starboard
 * @returns -1 to port, 1 to starboard, 0 when the contact is abaft the beam
 */
export function glanceTurn(off: number): number {
  const a = Math.atan2(Math.sin(off), Math.cos(off));
  if (Math.abs(a) >= Math.PI / 2) return 0;
  return a >= 0 ? -1 : 1;
}

/** What to do to a boat that is in contact with another hull: the arguments of the sim's `shove`. */
export interface Push {
  dx: number;
  dy: number;
  dvx: number;
  dvy: number;
  turn: number;
  /** The way she had toward the other hull, m/s, which the push takes off her. 0 if she was not closing on it herself. */
  toward: number;
}

/**
 * The push that puts a boat clear of a hull she is in contact with. She is moved out by the depth of the overlap and
 * loses the way she had toward the other hull, keeping what she had along it, so she slides off. All but stopped with
 * her bow pressed on, her head pays off as well.
 * @param speed her speed through the water along her heading, m/s
 * @param lateral her leeway speed, m/s, positive to starboard
 * @param dt seconds this push covers
 */
export function pushClear(heading: number, speed: number, lateral: number, ov: Overlap, dt: number): Push {
  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  const toward = Math.max(0, (speed * sinH + lateral * cosH) * ov.nx + (speed * cosH - lateral * sinH) * ov.ny);
  const pressed = toward > 0 && Math.abs(speed) < CONTACT.glanceUnder;
  return {
    dx: -ov.nx * ov.depth, dy: -ov.ny * ov.depth, dvx: -ov.nx * toward, dvy: -ov.ny * toward,
    turn: pressed ? glanceTurn(Math.atan2(ov.nx, ov.ny) - heading) * CONTACT.glance * dt : 0,
    toward,
  };
}

/**
 * Whether a boat a collision left stopped dead should be given the first of her way again (`CONTACT.wayOn`).
 * The sim holds a boat that is all but stopped at exactly no speed, and one step of her sails' drive is less than its
 * threshold, so in an ordinary breeze a boat stopped dead never gathers way by herself. Head to wind, aground or with
 * no drive to speak of she stays stopped.
 * @param speed m/s through the water
 * @param targetSpeed the speed her sails are driving her toward, m/s
 */
export function needsWayOn(speed: number, targetSpeed: number, aground: boolean, underPower: boolean): boolean {
  return speed === 0 && !aground && !underPower && targetSpeed > 1;
}

/**
 * Damage from one hit, as a share of the hull, 0 to 1.
 * @param closing speed the two came together at, m/s
 * @param heavy the other vessel is a ferry or a ship
 * @param fault this boat's share of the blame, as a multiplier. Nothing sets it yet: every boat in a collision takes the
 *   full damage, whoever was in the wrong. Right-of-way rules would come in here (port and starboard, windward and
 *   leeward, overtaking): 0 for the boat with rights, more than 1 for the one that should have kept clear.
 */
export function hitDamage(closing: number, heavy = false, fault = 1): number {
  const v = closing / KT;
  if (!(v >= CONTACT.fenders)) return 0;
  const percent = (CONTACT.square * v * v + CONTACT.linear * v) * (heavy ? CONTACT.heavy : 1) * Math.max(0, fault);
  return Math.min(1, percent / 100);
}

/** What a hit was like, for the line that tells the player. */
export function hitWord(damage: number): string {
  if (damage <= 0) return 'Touched';
  if (damage < 0.06) return 'Scraped';
  if (damage < 0.2) return 'Bumped';
  if (damage < 0.45) return 'Hit';
  return 'Rammed';
}

/** A hit that has just happened. */
export interface Hit {
  id: string;
  /** Closing speed, m/s. */
  closing: number;
}

/**
 * Tells one coming together from the next. Feed it every overlap as it is found; it answers with a hit the first time
 * two hulls touch and stays quiet until they have been apart for `CONTACT.clear` seconds.
 */
export class ContactWatch {
  /** For each vessel in contact or lately so: when they were last touching. */
  private readonly last = new Map<string, number>();

  /**
   * Two hulls are touching now.
   * @param t seconds, on any clock that only goes forward
   * @param closing m/s
   * @param depth metres the hulls are inside each other
   */
  touch(id: string, t: number, closing: number, depth = 0): Hit | null {
    const before = this.last.get(id);
    this.last.set(id, t);
    if (before !== undefined && t - before < CONTACT.clear && t >= before) return null;
    // Found deep inside each other: nobody sailed into anybody.
    return { id, closing: depth > CONTACT.jump ? 0 : Math.max(0, closing) };
  }

  /** True while this vessel is touching or has only just come clear. */
  touching(id: string, t: number): boolean {
    const before = this.last.get(id);
    return before !== undefined && t - before < CONTACT.clear && t >= before;
  }

  /** Forget contacts long over, and everything if the clock has gone back. */
  tidy(t: number): void {
    for (const [id, at] of this.last) if (t - at > 30 || t < at) this.last.delete(id);
  }
}

/** Where she is lying, as far as repairs go. */
export type Berthed = 'dock' | 'held' | 'none';

/**
 * Her damage after `dt` seconds of lying where she is. Alongside a dock the yard mends her; at anchor or on a mooring
 * the crew patch her slowly, but not while she is in a race. Under way nothing mends. A holed boat is past patching.
 */
export function mend(damage: number, dt: number, where: Berthed, racing: boolean): number {
  if (!(damage > 0) || damage >= 1 || where === 'none') return Math.max(0, Math.min(1, damage || 0));
  if (where === 'held' && racing) return damage;
  return Math.max(0, damage - dt * (where === 'dock' ? CONTACT.dockRate : CONTACT.heldRate));
}

/** The readout's words for a damaged hull. */
export function damageText(damage: number, speedLeft: number): string {
  if (damage >= 1) return 'Holed';
  return `${Math.max(1, Math.round(damage * 100))}% · ${Math.round((1 - speedLeft) * 100)}% slower`;
}

/** What another boat says of her own damage, on the wire as whole percent. Anything else is no damage. */
export function readDamage(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
}

/** A few words for the fleet panel about a boat's hull, or nothing when she is sound. */
export function damageNote(percent: number): string {
  if (percent >= 100) return 'holed, retired';
  if (percent >= 1) return `hull ${percent}% damaged`;
  return '';
}
