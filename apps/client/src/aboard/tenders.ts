// The yacht's tenders as data, and the plain rules around them: which yacht carries which, what the skipper chose,
// what goes on the wire, and the harbour's five-knot rule. No DOM and no Three.js in here, so it can be tested on its own.
// The table itself is `data/tenders.json`: a new tender is a row there and a model in `tenderModel.ts`.
import TABLE from '../data/tenders.json';

const KT = 0.514444;

export interface TenderSpec {
  id: string;
  name: string;
  /** A line for the chooser. */
  say: string;
  /** How she is driven: paddled (`paddle.ts`), or by an outboard or a jet (`motor.ts`). */
  drive: 'paddle' | 'outboard' | 'jet';
  /** The shortest yacht that carries her, feet. */
  minLengthFt: number;
  /** Flat out and at the ordinary throttle (or stroke), knots. */
  topKt: number;
  cruiseKt: number;
  /** Speed at which she climbs onto the plane, knots. */
  planeKt?: number;
  /** Push at a standstill with the throttle wide open, m/s². */
  accel: number;
  /** Fastest she can be turned, degrees a second. */
  turnDeg: number;
  /** The hardest turn she holds at speed, m/s² across. */
  sideG?: number;
  /** How quickly the hull stops a sideways slide, 1/s. Less is more skid. */
  grip?: number;
  /** How much of the turn's bank she takes: 1 leans all the way in. */
  lean?: number;
  /** Seconds for the engine to answer the throttle. */
  response?: number;
  /** Drag with the throttle shut, against drag with it open. */
  coast?: number;
  /** Drag added on the plane in a full chop, as a share of her flat-water drag. */
  chop?: number;
  /** Thrust going astern as a share of thrust ahead. */
  astern?: number;
  /** She can be filled by driving flat out into a steep sea. */
  swamps?: boolean;
  /** She leaves the water off waves and wakes. */
  jumps?: boolean;
  /** A turn harder than this, m/s² across and faster than `spillKt`, throws the rider. */
  spillG?: number;
  spillKt?: number;
  /** Water she needs under her, metres: how close inshore she goes. */
  draught: number;
  /** How far up a beach she can be dragged, metres. */
  haulUp: number;
  length: number;
  beam: number;
  /** Litres in her tank, and litres an hour flat out. */
  tankL?: number;
  burnLph?: number;
  sound: 'none' | 'outboard' | 'jet';
  model: 'kayak' | 'skiff' | 'runner';
  /** Where she lives on the yacht: lashed on the side deck, towed astern on her painter, or on the stern platform. */
  stow: 'deck' | 'astern' | 'platform';
}

/** Every tender, in the order the chooser shows them. The order is also the number each has on the wire: add new ones at the end. */
export const TENDERS = TABLE as TenderSpec[];
export const DEFAULT_TENDER = TENDERS[0];

export function tenderById(id: unknown): TenderSpec | undefined {
  return TENDERS.find((t) => t.id === id);
}

/** True when a yacht of this length carries this tender. */
export function carries(yachtLengthFt: number, tender: TenderSpec): boolean {
  return yachtLengthFt >= tender.minLengthFt;
}

/** The tenders a yacht of this length can choose from. */
export function tendersFor(yachtLengthFt: number): TenderSpec[] {
  return TENDERS.filter((t) => carries(yachtLengthFt, t));
}

/**
 * The tender she really has: the one asked for if this yacht carries it, or else the nearest thing she does carry,
 * looking back down the table (the wave runner's owner gets the skiff on a smaller boat, not the kayak).
 */
export function tenderFor(wanted: unknown, yachtLengthFt: number): TenderSpec {
  const at = TENDERS.findIndex((t) => t.id === wanted);
  for (let i = at; i >= 0; i--) if (carries(yachtLengthFt, TENDERS[i])) return TENDERS[i];
  return tendersFor(yachtLengthFt)[0] ?? DEFAULT_TENDER;
}

/** The next tender this yacht carries after `current`, coming round to the first again. */
export function nextTender(current: string, yachtLengthFt: number): TenderSpec {
  const list = tendersFor(yachtLengthFt);
  const at = list.findIndex((t) => t.id === current);
  return list[(at + 1) % list.length] ?? DEFAULT_TENDER;
}

// ---- what the skipper chose, kept on the device ------------------------------------------------------

const SAVED = 'regatta.tender';

/** The tender chosen on this device: an id from the table, or the kayak. */
export function savedTender(): string {
  try {
    const id = localStorage.getItem(SAVED);
    return tenderById(id)?.id ?? DEFAULT_TENDER.id;
  } catch {
    return DEFAULT_TENDER.id;
  }
}

export function saveTender(id: string): void {
  try {
    if (tenderById(id)) localStorage.setItem(SAVED, id);
  } catch {
    // Nowhere to keep it: she has it for this sail.
  }
}

// ---- the wire ---------------------------------------------------------------------------------------

/**
 * A tender away from her yacht, as the other boats are told of her in `oc`:
 * `[x, y, heading, kind, speed]`: decimetres east and north, thousandths of a radian, her number in the table
 * (plus 10 when she is drawn up ashore with nobody in her), and decimetres a second through the water.
 * The first three were all the kayak ever sent, and a report with only those is still a kayak.
 */
export interface TenderReport {
  kind: string;
  x: number;
  y: number;
  heading: number;
  /** m/s along her heading. */
  speed: number;
  ashore: boolean;
}

export function packTender(kind: string, x: number, y: number, heading: number, speed: number, ashore: boolean): number[] {
  const k = Math.max(0, TENDERS.findIndex((t) => t.id === kind));
  return [Math.round(x * 10), Math.round(y * 10), Math.round(heading * 1000), k + (ashore ? 10 : 0), Math.round(speed * 10)];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Read another page's `oc`. Anything that is not a sound report is no tender at all. */
export function readTender(v: unknown): TenderReport | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > 8) return null;
  const [x, y, h, k = 0, s = 0] = v as unknown[];
  if (!finite(x) || !finite(y) || !finite(h) || !finite(k) || !finite(s)) return null;
  if (Math.abs(x) > 5e6 || Math.abs(y) > 5e6 || Math.abs(h) > 7000) return null;
  // The first reports were whole metres with no kind: three numbers.
  const old = v.length === 3;
  const code = Math.round(k);
  const spec = TENDERS[code % 10];
  if (code < 0 || code >= 20 || !spec) return null;
  const top = spec.topKt * KT * 1.15;
  return {
    kind: spec.id,
    x: old ? x : x / 10,
    y: old ? y : y / 10,
    heading: h / 1000,
    speed: Math.max(-3, Math.min(top, s / 10)),
    ashore: code >= 10,
  };
}

// ---- the five-knot rule -----------------------------------------------------------------------------

/** The harbour's limit close to anchored boats, docks and anyone paddling. */
export const HARBOUR_LIMIT = 5 * KT;

export interface Zone {
  x: number;
  y: number;
  /** Metres from the point inside which the limit holds. */
  radius: number;
  /** What it is, to finish the sentence "slow down past ...". */
  what: string;
}

/** The nearest thing she is speeding past, or null when she is inside the limit or clear of everything. */
export function speedingPast(x: number, y: number, speed: number, zones: readonly Zone[]): Zone | null {
  if (Math.abs(speed) <= HARBOUR_LIMIT) return null;
  let best: Zone | null = null;
  let bestD = Infinity;
  for (const z of zones) {
    const d = Math.hypot(z.x - x, z.y - y);
    if (d <= z.radius && d < bestD) {
      best = z;
      bestD = d;
    }
  }
  return best;
}

const LINES = [
  (what: string) => `Five knots past ${what}, please, skipper. Your wash is rolling them`,
  (what: string) => `Ease her down past ${what}, if you would. Five knots in here`,
  (what: string) => `Mind your wash by ${what}. Five knots, no more, thank you`,
];

/**
 * The harbourmaster's patience. Feed it every frame: it speaks when she has been over the limit close to something
 * for a couple of seconds, and then holds its peace for a while. A word, never a penalty.
 */
export class HarbourWatch {
  private over = 0;
  private quiet = 0;
  private said = 0;

  /** @returns a line to say, or null */
  watch(dt: number, past: Zone | null): string | null {
    this.quiet = Math.max(0, this.quiet - dt);
    if (!past) {
      this.over = 0;
      return null;
    }
    this.over += dt;
    if (this.over < 2.5 || this.quiet > 0) return null;
    this.quiet = 75;
    this.over = 0;
    return LINES[this.said++ % LINES.length](past.what);
  }
}

// ---- bumping into things ----------------------------------------------------------------------------

/** Closing speed, m/s, above which a tender running into a hull is a bump worth a word. Under it she just fends off. */
export const BUMP_SPEED = 1.5;

/** What to say when a tender has run into something. No hull is hurt by a tender. */
export function bumpWord(closing: number, what: string): string {
  const kt = closing / KT;
  if (kt > 15) return `You have run into ${what} at ${kt.toFixed(0)} knots and stopped dead. No harm to her topsides, more to your pride`;
  if (kt > 6) return `A solid thump against ${what}. She has stopped. Nothing broken`;
  return `Bumped ${what}. No harm done`;
}
