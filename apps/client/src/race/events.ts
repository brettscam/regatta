import eventsJson from '../data/events.json';

/**
 * A race fixed for a real time on the real clock, so friends can be told "half past seven tonight".
 * Events are data in `src/data/events.json`: a course id from the course's `races.json`, the start to join from, and when.
 * Every boat on the water works the race out from the same data, so it needs no host.
 */
export interface RaceEvent {
  id: string;
  name: string;
  /** The water it is sailed on: a course id from `courses/`. San Francisco Bay when left out. */
  water?: string;
  /** A race course id. */
  course: string;
  /** The start spot to choose on the way in, to be near the first mark. A race made by a player has none: joining tows her to the start. */
  spot?: string;
  /** ISO time of the gun, with its offset. */
  at: string;
}

const events = (eventsJson as { events: RaceEvent[] }).events;

// ---- races that players fix themselves --------------------------------------------------------------
// Anyone can fix a race for a time and send a link to it. The link carries the whole race (water, course, time), so it
// needs no server: everyone who opens it works out the same race. Boats already on the water are told through the room.

/** Races fixed by players: from the link this page was opened with, made here, or heard from another boat. */
const fixed = new Map<string, RaceEvent>();

/** A race for a course at a time on the real clock. The same three facts always give the same id, so every page agrees. */
export function makeEvent(water: string, course: string, atMs: number, name = 'Race'): RaceEvent {
  const minute = Math.round(atMs / 60e3);
  return { id: `r-${water}-${course}-${minute}`.slice(0, 32), name: name.slice(0, 40), water, course, at: new Date(minute * 60e3).toISOString() };
}

/** Take a player's race into the list. Returns true if it is new here. */
export function addEvent(e: RaceEvent): boolean {
  if (fixed.has(e.id)) return false;
  // Old ones are dropped as new ones come, so the list cannot grow without end.
  for (const [id, old] of fixed) if (Date.now() - Date.parse(old.at) > CLOSES_AFTER * 60e3) fixed.delete(id);
  if (fixed.size >= 12) return false;
  fixed.set(e.id, e);
  return true;
}

const SAFE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A player's race as it came from a link or from another boat. Nothing in it is trusted until it has been through here. */
export function readEvent(v: unknown): RaceEvent | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const at = typeof o.at === 'number' ? o.at : typeof o.at === 'string' ? (/^\d{9,14}$/.test(o.at) ? Number(o.at) : Date.parse(o.at)) : NaN;
  if (typeof o.course !== 'string' || !SAFE.test(o.course) || !Number.isFinite(at)) return null;
  const water = typeof o.water === 'string' && SAFE.test(o.water) ? o.water : 'sf-bay';
  // Nothing more than a week off, and nothing long gone.
  if (at - Date.now() > 7 * 86400e3 || Date.now() - at > 6 * 3600e3) return null;
  return makeEvent(water, o.course, at, typeof o.name === 'string' && o.name.trim() ? o.name.replace(/[<>&"]/g, '').trim() : 'Race');
}

/** The link that carries a race: open it and the race is there on the way in. */
export function eventLink(e: RaceEvent): string {
  const q = new URLSearchParams({ race: e.course, at: String(Date.parse(e.at)), water: eventWater(e) });
  if (e.name && e.name !== 'Race') q.set('rn', e.name);
  return `${location.origin}${location.pathname}?${q.toString()}`;
}

/** The player's race this page knows of that is soonest to come, to pass on to other boats. */
export function sharedEvent(now = Date.now()): RaceEvent | null {
  let best: RaceEvent | null = null;
  for (const e of fixed.values()) {
    const t = Date.parse(e.at);
    if (now - t > CLOSES_AFTER * 60e3) continue;
    if (!best || t < Date.parse(best.at)) best = e;
  }
  return best;
}

// A link to a race: ?race=<course id>&at=<milliseconds>&water=<water id>
try {
  const q = new URLSearchParams(location.search);
  if (q.has('race')) {
    const e = readEvent({ course: q.get('race'), at: q.get('at') ?? '', water: q.get('water') ?? undefined, name: q.get('rn') ?? undefined });
    if (e) fixed.set(e.id, e);
  }
} catch { /* no address to read: no race from a link */ }

/** Minutes before the gun that the race opens for joining, and minutes after it that a late boat may still join. */
export const OPENS_BEFORE = 25;
export const CLOSES_AFTER = 15;

/** The gun, in milliseconds on the real clock. */
export const gunTime = (e: RaceEvent): number => Date.parse(e.at);

/** The water an event is on. */
export const eventWater = (e: RaceEvent): string => e.water ?? 'sf-bay';

/** The water this page is sailing on, so an event only shows on its own. Set once a course is chosen. */
let here = 'sf-bay';
export function setEventWater(id: string): void {
  here = id;
}

/**
 * The next event worth telling people about: within a day ahead, or only just started.
 * @param water only events on this water. The water being sailed unless given; `null` for any water
 */
export function nextEvent(water: string | null = here, now = Date.now()): RaceEvent | null {
  const soonest = (list: Iterable<RaceEvent>): RaceEvent | null => {
    let best: RaceEvent | null = null;
    for (const e of list) {
      if (water !== null && eventWater(e) !== water) continue;
      const t = gunTime(e);
      if (!Number.isFinite(t) || t - now > 24 * 3600e3 || now - t > CLOSES_AFTER * 60e3) continue;
      if (!best || t < gunTime(best)) best = e;
    }
    return best;
  };
  // A race a player has fixed comes before the ones in the game's own calendar.
  return soonest(fixed.values()) ?? soonest(events);
}

/** True once the race can be joined. */
export const isOpen = (e: RaceEvent, now = Date.now()): boolean => gunTime(e) - now <= OPENS_BEFORE * 60e3 && now - gunTime(e) <= CLOSES_AFTER * 60e3;

/** The gun as the reader's own clock shows it: "7:30 PM PST". */
export const whenText = (e: RaceEvent): string => new Date(gunTime(e)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

/** How long until the gun, in words: "in 2 h 14 min", "in 9 min", "now". */
export function inText(e: RaceEvent, now = Date.now()): string {
  const min = Math.round((gunTime(e) - now) / 60e3);
  if (min <= 0) return 'now';
  if (min < 60) return `in ${min} min`;
  return `in ${Math.floor(min / 60)} h ${min % 60} min`;
}
