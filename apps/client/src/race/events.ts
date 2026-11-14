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
  /** The start spot to choose on the way in, to be near the first mark. */
  spot: string;
  /** ISO time of the gun, with its offset. */
  at: string;
}

const events = (eventsJson as { events: RaceEvent[] }).events;

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
  let best: RaceEvent | null = null;
  for (const e of events) {
    if (water !== null && eventWater(e) !== water) continue;
    const t = gunTime(e);
    if (!Number.isFinite(t) || t - now > 24 * 3600e3 || now - t > CLOSES_AFTER * 60e3) continue;
    if (!best || t < gunTime(best)) best = e;
  }
  return best;
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
