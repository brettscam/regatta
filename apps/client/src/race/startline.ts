/**
 * The decisions behind the start and the marks, with nothing in them but numbers and words:
 * what counts as taking a mark, the time-on-distance figure before the gun, and what is said when.
 * The race (`race.ts`) and the guide on the water (`aboard/guide.ts`) both read these, so the ring drawn is the ring judged.
 */

/** A mark is taken inside this many metres of it. The ring on the water is drawn at this radius. */
export const RING = 130;
/** A boat that has gone past a mark, abeam of it, is still given it if she is within this many metres. */
export const ABEAM = RING * 4;

const NM = 1852;
const R2D = 180 / Math.PI;

/**
 * Whether a mark is taken, and how.
 * @param toGo metres from the boat to the mark
 * @param along metres made good along the leg from where it began
 * @param legLength metres from where the leg began to the mark
 * @returns 'ring' inside the ring, 'abeam' when she has passed the mark's beam close enough to be given it, null otherwise
 */
export function taken(toGo: number, along: number, legLength: number): 'ring' | 'abeam' | null {
  if (toGo < RING) return 'ring';
  if (along > legLength && toGo < ABEAM) return 'abeam';
  return null;
}

/** Minutes and seconds: 0:40, 3:05. */
export const mmss = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A span of time as it is said aloud: "40 seconds", "1 minute 10", "3 minutes". */
export function spokenTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} minute${m === 1 ? '' : 's'}${r ? ` ${r}` : ''}`;
}

/** A distance as it is said aloud: "300 metres" to the nearest ten, "1.2 miles" from half a mile up. */
export function spokenRange(metres: number): string {
  if (metres < 926) return `${Math.max(10, Math.round(metres / 10) * 10)} metres`;
  return `${(metres / NM).toFixed(1)} miles`;
}

/** A distance for a label: "300 m", "1.2 nm". */
export const shortRange = (metres: number): string => (metres < 926 ? `${Math.round(metres / 10) * 10} m` : `${(metres / NM).toFixed(1)} nm`);

/** A compass bearing in three figures from radians: "075". */
export const bearing3 = (rad: number): string => String(Math.round((((rad * R2D) % 360) + 360) % 360) % 360).padStart(3, '0');

/** Within this many seconds of the gun either way counts as on time. */
export const ON_TIME = 15;
/** Slower than this, metres a second, she is not going anywhere and a time to reach means nothing. */
export const STOPPED = 0.5;

export interface PreStart {
  /** Metres to the edge of the start ring. 0 inside it. */
  dist: number;
  /** Seconds to the gun. */
  left: number;
  /** Seconds to reach the ring at her present speed. Null when she is stopped. 0 inside. */
  reach: number | null;
  /** Seconds she would have in hand at the ring: positive is early, negative late. Null when stopped outside it. */
  margin: number | null;
  state: 'inside' | 'stopped' | 'early' | 'ontime' | 'late';
}

/**
 * Time on distance: how she stands against the gun if she sails straight for the start ring at the speed she is making now.
 * @param toMark metres from the boat to the start mark
 * @param speed her speed over the ground, m/s
 * @param left seconds to the gun
 */
export function preStart(toMark: number, speed: number, left: number): PreStart {
  const dist = Math.max(0, toMark - RING);
  if (dist === 0) return { dist, left, reach: 0, margin: left, state: 'inside' };
  if (!(speed >= STOPPED)) return { dist, left, reach: null, margin: null, state: 'stopped' };
  const reach = dist / speed;
  const margin = left - reach;
  return { dist, left, reach, margin, state: margin > ON_TIME ? 'early' : margin < -ON_TIME ? 'late' : 'ontime' };
}

/** The figure itself, short: "0:40 early", "1:10 late", "on time", "not moving", "in the ring". */
export function marginText(p: PreStart): string {
  if (p.state === 'inside') return 'in the ring';
  if (p.state === 'stopped') return 'not moving';
  if (p.state === 'ontime') return 'on time';
  return `${mmss(Math.abs(p.margin!))} ${p.state}`;
}

/** The line under the clock before the gun: time, distance, and early or late. */
export function preStartLine(p: PreStart, start: string): string {
  const where = p.state === 'inside' ? `in the start ring at ${start}` : `start ring at ${start} ${shortRange(p.dist)} · ${marginText(p)}`;
  return `Gun in ${mmss(p.left)} · ${where}`;
}

/** The moments before the gun at which something is said, seconds. */
export const CALLS = [300, 120, 60, 30, 10];

/**
 * The call that is due now, if any: each is made once, in the five seconds after its moment.
 * A boat that joins with two minutes to go is not told about five.
 */
export function dueCall(left: number, made: ReadonlySet<number>): number | null {
  for (const mark of CALLS) if (left <= mark && left > mark - 5 && !made.has(mark)) return mark;
  return null;
}

const callName = (mark: number): string => (mark >= 60 ? `${mark / 60} minute${mark > 60 ? 's' : ''}` : `${mark} seconds`);

/**
 * What is called out at one of those moments.
 * @param coach false gives the bare time, for a skipper who has turned the guide off
 */
export function preStartCall(mark: number, p: PreStart, coach: boolean): string {
  const bare = mark >= 60 ? `${callName(mark)} to the gun` : callName(mark);
  if (!coach || mark <= 10) return bare;
  const head = mark >= 60 ? `${callName(mark)[0].toUpperCase()}${callName(mark).slice(1)}` : callName(mark);
  if (p.state === 'inside') return `${head}. You are in the start ring: stay in it or close by`;
  const where = `You are ${spokenRange(p.dist)} from the start ring`;
  if (p.state === 'stopped') return `${head}. ${where} and not moving: get her sailing toward it`;
  if (p.state === 'ontime') return `${head}. ${where}, on time at this speed: hold it`;
  const by = spokenTime(Math.abs(p.margin!));
  if (p.state === 'late') return `${head}. ${where}, ${by} late at this speed: sail straight for it`;
  return `${head}. ${where}, ${by} early: ${p.margin! > 120 ? 'no hurry, stay near it' : 'slow down or circle'}`;
}

/** Said once when she first sails into the start ring before the gun. */
export const inRingCall = (left: number): string =>
  `You are in the start ring, ${mmss(left)} to the gun. Stay in it or close by: inside it at the gun you start at once, outside it you sail in after`;

export interface Onward { name: string; metres: number; bearing: number; last: boolean }

/** Where to go next, as the tail of a line: "Next: Raccoon Strait, 1.2 miles, bearing 075°". */
export const nextText = (n: Onward): string => `Next: ${n.last ? 'the finish at ' : ''}${n.name}, ${spokenRange(n.metres)}, bearing ${bearing3(n.bearing)}°`;

/** The gun, for a boat outside the start ring. */
export const gunOutsideCall = (start: string, toMark: number, bearing: number): string =>
  `Gun! The start ring at ${start} is ${spokenRange(Math.max(0, toMark - RING))} off, bearing ${bearing3(bearing)}°. Sail into it to start`;

/**
 * A mark has been taken.
 * @param index which mark of the course, 0 being the start
 * @param atGun true when it is the start mark taken at the very gun, by a boat already in the ring
 * @param off metres she was from the mark when it was given
 */
export function takenCall(name: string, index: number, how: 'ring' | 'abeam', off: number, next: Onward, atGun = false): string {
  const head = index === 0
    ? (atGun ? `Gun! You are in the ring: started at ${name}` : how === 'ring' ? `Started at ${name}` : `Started: ${name} passed abeam, ${spokenRange(off)} off`)
    : how === 'ring' ? `${name} rounded` : `${name} passed abeam, ${spokenRange(off)} off: it counts`;
  return `${head}. ${nextText(next)}`;
}

/** The start, the rings and the finish in a few plain sentences, for the race panel and the Keys tab. */
export const HOW_A_RACE_WORKS = [
  'The first mark of the course is the start. Before the gun, get close to the ring drawn round it: the line under the clock gives the time to the gun, how far the ring is, and whether you would reach it early or late at the speed you are making.',
  `If you are inside the ring when the gun goes, you have started. If not, sail into it and you start then.`,
  `After that, sail into the ring round each mark in turn. Every ring is ${RING} metres from its mark, the bright one is the one you want, and a chime and a line on the screen tell you it is taken and where the next one lies.`,
  'The last ring is the finish: your time stops as you enter it. G hides the rings and the line on the water, and the coaching with them.',
];
