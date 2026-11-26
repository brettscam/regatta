// What a player ashore tells the others, and how the others draw her between reports. Pure.
//
// It rides in the boat's own presence report as `as` (`net/fleet.ts` sends everything the features give it), so being
// ashore costs no message of its own: on claude.ai that is the fleet's report every 0.15 s, on the website whatever
// `net/web/pacing.ts` allows for the number of pages on the water, four a second down to one every two seconds.
// It is an array, not words, so that a step along the deck is not taken for news to be sent at once (`pressing`).
// Everything read here is another page's word and is checked before it is used.

export const POSES = ['stand', 'sit', 'stool', 'lean', 'warm', 'dance', 'dance2'] as const;
export type Pose = (typeof POSES)[number];
export const EMOTES = ['wave', 'cheers', 'point', 'shrug', 'laugh'] as const;
export type Emote = (typeof EMOTES)[number];

export interface AshoreReport {
  /** Which place: its id in `places.json`. */
  venue: string;
  /** Where she is in the place's own frame, metres (`ground.ts`, `toLocal`). */
  u: number;
  v: number;
  /** Which way she faces, compass radians. */
  face: number;
  pose: Pose;
  /** The spot she is using, as its index in the place's list, or -1. */
  spot: number;
  /** When she took up this pose: a stamp in seconds. The earlier of two people in one seat keeps it, and dancers keep time by it. */
  since: number;
  emote: Emote | '';
  /** Stamps, in seconds: each changes when she does the thing again. 0 for never. */
  emoteAt: number;
  /** What is in her hand: an index into the menu's items, or -1. */
  hold: number;
  /** When she last bought a round, and what it was. */
  round: number;
  roundItem: number;
  /** When she last told the fleet where she is. */
  gather: number;
}

/** A stamp for now: seconds, small enough to send. Only ever compared with another stamp. */
export const stampOf = (ms: number): number => Math.floor(ms / 1000) % 100000000;

const VENUE = /^[a-z0-9][a-z0-9-]{0,39}$/i;
/** The furthest from a place's origin that anybody can be, metres: a town, not a county. */
const FAR = 2500;
const FIELDS = 13;

export function packAshore(r: AshoreReport): unknown[] {
  return [
    r.venue, Math.round(r.u * 10), Math.round(r.v * 10), Math.round(wrap(r.face) * 100), POSES.indexOf(r.pose), r.spot, r.since,
    r.emote ? EMOTES.indexOf(r.emote) : -1, r.emoteAt, r.hold, r.round, r.roundItem, r.gather,
  ];
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const whole = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** A report as another page sent it, or null if it is not one. Nothing is corrected: anything out of range is refused whole. */
export function readAshore(v: unknown): AshoreReport | null {
  if (!Array.isArray(v) || v.length !== FIELDS) return null;
  const [venue, u, w, face, pose, spot, since, emote, emoteAt, hold, round, roundItem, gather] = v as unknown[];
  if (typeof venue !== 'string' || !VENUE.test(venue)) return null;
  if (!whole(u, -FAR * 10, FAR * 10) || !whole(w, -FAR * 10, FAR * 10) || !whole(face, -400, 400)) return null;
  if (!whole(pose, 0, POSES.length - 1) || !whole(spot, -1, 4999) || !whole(since, 0, 1e8)) return null;
  if (!whole(emote, -1, EMOTES.length - 1) || !whole(emoteAt, 0, 1e8)) return null;
  if (!whole(hold, -1, 63) || !whole(round, 0, 1e8) || !whole(roundItem, -1, 63) || !whole(gather, 0, 1e8)) return null;
  return {
    venue, u: u / 10, v: w / 10, face: face / 100, pose: POSES[pose], spot, since,
    emote: emote < 0 ? '' : EMOTES[emote], emoteAt, hold, round, roundItem, gather,
  };
}

// ---- between reports -------------------------------------------------------------------------------

/** Further than this between two reports and she is put there, not walked there. */
const JUMP = 8;

/**
 * Somebody else's figure, moved smoothly from each report to the next. A report says where she was; the figure is
 * walked there over about the time the reports are coming at, so it is always one report behind and never jerks.
 * Times are seconds on this page's own clock.
 */
export class Track {
  u = 0;
  v = 0;
  face = 0;
  /** Metres a second she is moving at, as drawn: what the walk is animated by. */
  speed = 0;
  private toU = 0;
  private toV = 0;
  private toFace = 0;
  private heardAt = -1;
  /** Seconds between her reports, as they have been arriving. */
  private gap = 0.3;
  /** Seconds left to reach the last place heard of. */
  private left = 0;

  hear(u: number, v: number, face: number, now: number): void {
    if (this.heardAt < 0 || Math.hypot(u - this.u, v - this.v) > JUMP) {
      this.u = u;
      this.v = v;
      this.face = face;
      this.speed = 0;
    } else {
      const gap = Math.min(2.5, Math.max(0.1, now - this.heardAt));
      this.gap += (gap - this.gap) * 0.5;
    }
    this.heardAt = now;
    this.toU = u;
    this.toV = v;
    this.toFace = face;
    this.left = this.gap;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const k = this.left <= dt ? 1 : dt / this.left;
    const du = (this.toU - this.u) * k;
    const dv = (this.toV - this.v) * k;
    this.u += du;
    this.v += dv;
    this.left = Math.max(0, this.left - dt);
    const moved = Math.hypot(du, dv) / dt;
    this.speed += (moved - this.speed) * Math.min(1, dt * 8);
    this.face += wrap(this.toFace - this.face) * Math.min(1, dt * 8);
  }
}

// ---- who has a seat --------------------------------------------------------------------------------

/**
 * True when she must give up the spot she is in: somebody else is in it and was there first. Two people who sat down
 * in the same second are told apart by `key`, any string that differs between them and is the same on both pages.
 */
export function mustYield(mine: { spot: number; since: number; key: string }, others: ReadonlyArray<{ spot: number; since: number; key: string }>): boolean {
  if (mine.spot < 0) return false;
  return others.some((o) => o.spot === mine.spot && (o.since < mine.since || (o.since === mine.since && o.key < mine.key)));
}
