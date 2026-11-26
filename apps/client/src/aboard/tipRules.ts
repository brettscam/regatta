/**
 * The rules behind the pop-up tips: which tip, if any, to show now. All of it is pure, so it can be tested
 * without a browser. The tips themselves are rows in `tipTable.ts`, and `tips.ts` draws them.
 *
 * A tip is shown when its trigger has held for long enough, the player is not busy, the last tip went away long
 * enough ago, and this device has not seen it too often. A tip the player has acted on is never shown again.
 */

/** A small picture of the game, taken twice a second. Triggers are written against this and nothing else. */
export interface Snap {
  /** Real seconds on this sail, not counting time paused. */
  t: number;

  // ---- who is playing, and where ----
  /** True where the voice radio works: the website. */
  voice: boolean;
  /** True where other people can be on the water at all: the website and the shared claude.ai page. */
  shared: boolean;
  /** Sails begun on this device, this one included, and hours under way. */
  sails: number;
  hours: number;
  /** Races finished, ever. */
  races: number;
  /** Her rank, 0 Deckhand upwards (`xp/score.ts`), and points earned on this sail. */
  rank: number;
  xpGained: number;
  /** True when the first-sail lesson is running or has run on this sail: it teaches the wheel and the sheets itself. */
  lesson: boolean;
  /** Release notes newer than the last one this returning player read, not yet announced. */
  news: number;

  // ---- other people ----
  /** Other players' boats on this water, the nearest one's name and distance in metres. */
  company: number;
  nearBoat: number;
  boatName: string;
  /** Ferry and ship calls heard on the radio on this sail. */
  trafficCalls: number;

  // ---- racing ----
  /** In a race that is not yet finished. */
  racing: boolean;
  /** Somebody else has called a race she has not joined. */
  raceOffered: boolean;
  /** Seconds to the gun while in a race, negative after it. Null outside a race. */
  countdown: number | null;
  /** Races finished on this sail. */
  raceDone: number;

  // ---- wind and boat ----
  /** True aboard a boat with no sails: a powerboat. The tips about sails, tacking and racing are not for her. */
  power: boolean;
  windKt: number;
  /** True wind angle off the bow, degrees, 0 to 180. */
  twaDeg: number;
  heelDeg: number;
  speedKt: number;
  /** Reefs taken, and how many she has. */
  reef: number;
  reefs: number;
  hasSpin: boolean;
  spin: boolean;
  hasEngine: boolean;
  engine: boolean;
  /** The wheel is in the player's hands. Otherwise the crew or the autopilot is steering. */
  hand: boolean;
  /** A sail has been luffing or stalled, with the sheets in the player's own hands. */
  mistrim: boolean;
  aground: boolean;
  /** Seconds becalmed or in irons without the engine. */
  stuck: number;
  /** Times knocked flat on this sail. */
  knockdowns: number;

  // ---- things that must not be interrupted ----
  /** A tack or a gybe is under way. */
  manoeuvre: boolean;
  /** Laid over, or coming back up. */
  knocked: boolean;
  /** Seconds since she last hit something. */
  hitAgo: number;
  /** The chart, the board, the race panel or the lesson is open, or the game is paused. */
  panel: boolean;

  // ---- stopping, and going ashore ----
  hold: 'none' | 'anchor' | 'mooring';
  /** Seconds she has been held. */
  heldFor: number;
  /** The nearest dock, mooring or anchorage. */
  berth: { name: string; kind: 'mooring' | 'dock' | 'anchorage'; d: number } | null;
  /** The nearest place with somewhere to go ashore. */
  ashore: { name: string; where: string; d: number; dock: boolean } | null;
  /** The tender is out. */
  tender: boolean;
  /** The tender she carries: its name ('Kayak', 'Skiff', 'Wave runner'), and the others this yacht could carry instead. */
  tenderName: string;
  tenderOthers: string[];
  night: boolean;
  /** Depth of water, metres. */
  depth: number;

  // ---- where she is going ----
  /** Marks on her route still ahead. */
  marks: number;
  /** The next one: how far, and whether it lies too close to the wind to sail straight at. */
  mark: { d: number; upwind: boolean } | null;
}

/** A snapshot of nothing happening: a boat sailing along alone on her first minute. Tests and the feature start from this. */
export function emptySnap(): Snap {
  return {
    t: 0, voice: false, shared: false, sails: 1, hours: 0, races: 0, rank: 0, xpGained: 0, lesson: false, news: 0,
    company: 0, nearBoat: Infinity, boatName: '', trafficCalls: 0,
    racing: false, raceOffered: false, countdown: null, raceDone: 0,
    power: false, windKt: 10, twaDeg: 50, heelDeg: 12, speedKt: 5, reef: 0, reefs: 2, hasSpin: true, spin: false, hasEngine: true, engine: false,
    hand: false, mistrim: false, aground: false, stuck: 0, knockdowns: 0,
    manoeuvre: false, knocked: false, hitAgo: Infinity, panel: false,
    hold: 'none', heldFor: 0, berth: null, ashore: null, tender: false, tenderName: 'Kayak', tenderOthers: [], night: false, depth: 30,
    marks: 0, mark: null,
  };
}

export type TipIcon = 'helm' | 'sail' | 'keys' | 'boats' | 'radio' | 'flag' | 'anchor' | 'shore' | 'moon' | 'fish' | 'engine' | 'tow' | 'chart' | 'wind' | 'star' | 'news' | 'kayak';

/** One tip. Adding a tip is adding one of these to `tipTable.ts`. */
export interface Tip {
  id: string;
  title: string;
  /** One or two plain sentences. A function when the words depend on the moment: a name, the wind. */
  text: string | ((s: Snap) => string);
  /** The key caps drawn on the card. "+" is a joiner. Empty when the tip is not about a key. */
  keys: string[];
  icon?: TipIcon;
  /** The trigger: the moment this tip is for. */
  when(s: Snap): boolean;
  /** Seconds the trigger has to hold before the tip is shown. */
  hold?: number;
  /** The higher wins when two tips are due at once. */
  priority: number;
  /** Pressing any of these (KeyboardEvent.code, "Shift+" in front for the shifted key) is doing the thing: the tip goes away and never comes back. */
  done?: string[];
  /** Keys that count only while the tip is on the screen: for a key, B say, that is pressed for many other reasons. */
  ack?: string[];
  /** Or a state that shows she has done it. */
  doneWhen?(s: Snap): boolean;
  /** Real seconds before it may be shown again on this device. A day unless said. */
  cooldown?: number;
  /** How many times it is shown at most, if it is never acted on. Twice unless said. */
  max?: number;
  /** The highest rank it is shown to. Left out, it is for everyone. */
  upTo?: number;
  /** Something is wrong now: it does not wait for the usual gap and is not counted against the session's handful. */
  urgent?: boolean;
  /** One of the first-sail welcome: these follow each other closely and are not counted either. */
  series?: boolean;
  /** Seconds it stays up if nothing is done about it. */
  secs?: number;
  /** The card lists the newest release notes under the text. */
  list?: 'news';
}

// ---- memory on the device -------------------------------------------------------------------------

/** What this device remembers about tips. Kept in localStorage as JSON. */
export interface TipMemory {
  /** The player asked for no more tips. */
  off: boolean;
  /** Tips acted on, or dismissed with "Got it". Never shown again. */
  done: Record<string, true>;
  /** Tips shown and left alone: how many times, and when last, in seconds since 1970. */
  seen: Record<string, { n: number; at: number }>;
  /** The newest release note that the "new since you last sailed" card has been shown for. */
  news: string;
}

export const TIP_STORE = 'regatta.tips';
const ID = /^[a-z0-9-]{1,40}$/;
const MOST = 200;

export function freshMemory(): TipMemory {
  return { off: false, done: {}, seen: {}, news: '' };
}

/** Whatever was saved, made safe: anything that is not the right shape is dropped. */
export function readMemory(raw: unknown): TipMemory {
  const m = freshMemory();
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return m;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return m;
  const r = raw as Record<string, unknown>;
  m.off = r.off === true;
  if (typeof r.news === 'string' && ID.test(r.news)) m.news = r.news;
  if (Array.isArray(r.done)) {
    for (const id of r.done.slice(0, MOST)) if (typeof id === 'string' && ID.test(id)) m.done[id] = true;
  }
  if (r.seen && typeof r.seen === 'object' && !Array.isArray(r.seen)) {
    for (const [id, v] of Object.entries(r.seen as Record<string, unknown>).slice(0, MOST)) {
      if (!ID.test(id) || !Array.isArray(v)) continue;
      const [n, at] = v as unknown[];
      if (typeof n !== 'number' || typeof at !== 'number' || !Number.isFinite(n) || !Number.isFinite(at) || n < 1 || at < 0) continue;
      m.seen[id] = { n: Math.min(99, Math.floor(n)), at: Math.floor(at) };
    }
  }
  return m;
}

/** The memory as it is saved. */
export function writeMemory(m: TipMemory): string {
  return JSON.stringify({ v: 1, off: m.off, news: m.news, done: Object.keys(m.done), seen: Object.fromEntries(Object.entries(m.seen).map(([id, s]) => [id, [s.n, s.at]])) });
}

// ---- pacing ---------------------------------------------------------------------------------------

/** A day, in seconds: how long a tip that was left alone stays away. */
export const DAY = 86400;
/** The trigger has to be true and the boat quiet for this long before anything is shown. */
export const SETTLE = 4;
/** Seconds between the tips of the first-sail welcome, and after which something urgent may follow another tip. */
export const SERIES_GAP = 35;
export const URGENT_GAP = 15;
/** How long a tip stays up when it does not say. */
export const TIP_SECONDS = 16;

/**
 * How often to speak, by rank. A deckhand gets a tip every two minutes at most and seven on a sail.
 * An old hand gets very few. Urgent tips and the first-sail welcome are outside this.
 */
export function pace(rank: number): { gap: number; cap: number } {
  if (rank <= 1) return { gap: 120, cap: 7 };
  if (rank <= 3) return { gap: 210, cap: 4 };
  return { gap: 360, cap: 2 };
}

/**
 * True when a tip would be an interruption: a tack or gybe under way, laid over, just after a collision, a panel
 * open, or the last minute and a quarter before the gun and the half minute after it.
 */
export function busy(s: Snap): boolean {
  if (s.panel || s.manoeuvre || s.knocked || s.hitAgo < 20) return true;
  return s.countdown !== null && s.countdown < 75 && s.countdown > -30;
}

/** The words of a tip at this moment. */
export function tipText(tip: Tip, s: Snap): string {
  return typeof tip.text === 'function' ? tip.text(s) : tip.text;
}

/** Does this key press count as doing what the tip is about? */
function answers(codes: string[] | undefined, code: string, shift: boolean): boolean {
  return (codes ?? []).some((d) => (d.startsWith('Shift+') ? shift && d.slice(6) === code : !shift && d === code));
}

/**
 * Chooses the tip to show. It keeps the session's side of things (how long each trigger has held, when the last
 * tip went, how many have been shown) and updates the device's memory as tips are shown and acted on.
 * The caller saves the memory when `dirty` is set.
 */
export class TipPicker {
  /** Tips shown on this sail that count against the session's handful. */
  shown = 0;
  /** When the last tip went away, on the snapshot's clock. */
  lastEnd = -Infinity;
  /** Set when the memory has changed and wants saving. The caller clears it. */
  dirty = false;
  private readonly held = new Map<string, number>();
  private quiet = 0;

  /**
   * @param now seconds since 1970, for the cooldowns that outlast a sail
   */
  constructor(private readonly tips: readonly Tip[], readonly memory: TipMemory, private readonly now: () => number = () => Date.now() / 1000) {}

  /** Has the device finished with this tip: acted on, dismissed, or shown as often as it may be? */
  spent(tip: Tip): boolean {
    if (this.memory.done[tip.id]) return true;
    const seen = this.memory.seen[tip.id];
    return !!seen && seen.n >= (tip.max ?? 2);
  }

  /**
   * Move on by `dt` seconds with the game as `s` describes it. Returns the tip to show now, if one is due.
   * Call it while a tip is showing too, with `showing` set: triggers keep their time and things done are still
   * noticed, but nothing new is offered.
   */
  next(s: Snap, dt: number, showing = false): Tip | null {
    this.quiet = busy(s) ? 0 : this.quiet + dt;
    let best: Tip | null = null;
    let waiting = -Infinity;
    for (const tip of this.tips) {
      // Doing the thing without being told is the best reason of all never to mention it.
      if (!this.memory.done[tip.id] && tip.doneWhen?.(s)) this.finish(tip.id);
      const on = tip.when(s);
      const held = on ? (this.held.get(tip.id) ?? 0) + dt : 0;
      this.held.set(tip.id, held);
      if (!on || showing || this.memory.off || this.spent(tip)) continue;
      if (tip.upTo !== undefined && s.rank > tip.upTo) continue;
      const seen = this.memory.seen[tip.id];
      if (seen && this.now() - seen.at < (tip.cooldown ?? DAY)) continue;
      const { gap, cap } = pace(s.rank);
      const outside = tip.urgent || tip.series;
      if (!outside && this.shown >= cap) continue;
      if (s.t - this.lastEnd < (tip.urgent ? URGENT_GAP : tip.series ? SERIES_GAP : gap)) continue;
      // Its moment has come but has not yet lasted: anything less important waits for it.
      if (held < (tip.hold ?? 0)) waiting = Math.max(waiting, tip.priority);
      else if (!best || tip.priority > best.priority) best = tip;
    }
    if (best && waiting > best.priority) return null;
    // Quiet for a few seconds first, so a tip never lands on the heels of a tack.
    if (!best || this.quiet < SETTLE) return null;
    return best;
  }

  /** A tip has gone up on the screen. */
  showed(tip: Tip): void {
    const seen = this.memory.seen[tip.id];
    this.memory.seen[tip.id] = { n: (seen?.n ?? 0) + 1, at: Math.floor(this.now()) };
    if (!tip.urgent && !tip.series) this.shown++;
    this.dirty = true;
  }

  /** The tip on the screen has gone, however it went. */
  ended(s: Snap): void {
    this.lastEnd = s.t;
  }

  /** A key was pressed. Every tip it answers is done with. Returns true if `showing` was one of them. */
  pressed(code: string, shift: boolean, showing: Tip | null = null): boolean {
    let hit = false;
    for (const tip of this.tips) {
      if (!answers(tip.done, code, shift) && !(tip === showing && answers(tip.ack, code, shift))) continue;
      if (tip === showing) hit = true;
      if (!this.memory.done[tip.id]) this.finish(tip.id);
    }
    return hit;
  }

  /** The tip was taken down almost at once, by a tack say. It has not really been seen. */
  withdrew(tip: Tip): void {
    const seen = this.memory.seen[tip.id];
    if (!seen) return;
    if (seen.n <= 1) delete this.memory.seen[tip.id];
    else {
      seen.n--;
      seen.at = 0;
    }
    if (!tip.urgent && !tip.series && this.shown > 0) this.shown--;
    this.dirty = true;
  }

  /** "Got it", or the thing was done: never again. */
  finish(id: string): void {
    this.memory.done[id] = true;
    this.dirty = true;
  }

  /** "Don't show tips", and its opposite. */
  setOff(off: boolean): void {
    this.memory.off = off;
    this.dirty = true;
  }
}

// ---- what is new ----------------------------------------------------------------------------------

export interface NoteLike { id: string; title: string }

/** The release notes newer than the last one read, newest first. None for someone who has read the newest, or whose last note is not listed. */
export function unread<T extends NoteLike>(notes: readonly T[], seen: string): T[] {
  const at = notes.findIndex((n) => n.id === seen);
  return at <= 0 ? [] : notes.slice(0, at);
}

/**
 * The lines of the "new since you last sailed" card: the newest few notes' titles, each with the keys that came
 * with it. Notes that brought a key come before notes that did not, since a key is something to try.
 */
export function whatsNew(notes: readonly NoteLike[], seen: string, keys: ReadonlyArray<{ keys: string[]; since?: string }>, most = 3): Array<{ title: string; keys: string[] }> {
  const lines = unread(notes, seen).map((n) => ({
    title: n.title,
    keys: keys.filter((k) => k.since === n.id).flatMap((k) => (k.keys.includes('+') ? [] : k.keys)).slice(0, 4),
  }));
  return [...lines.filter((l) => l.keys.length), ...lines.filter((l) => !l.keys.length)].slice(0, most);
}
