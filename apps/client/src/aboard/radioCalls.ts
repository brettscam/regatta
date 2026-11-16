import type { Role } from '../audio/voices';
import { Track, type TrafficRoute, type TrafficSpec, type TrafficVessel } from '../scene/traffic';
import { hash01 } from './catch';

/**
 * What is said on channel 16 by everyone who is not a player, and when. Pure, so it can be tested and so every player
 * hears the same call at the same moment: the times come from the same timetables the vessels are drawn from, which
 * depend only on the time in the season.
 *
 * Who calls:
 * - a ferry, with a securite call as she leaves a berth, and a ship (or a ferry) as she comes up to the way point her
 *   route names as its `gate`
 * - the water's coast station ("Bay Radio": the name is the traffic file's `station`, and is made up), with a marine
 *   information broadcast every other hour: the wind now and in three hours, and the turn of the tide. The words are
 *   made when it goes out, from the world as it is
 * - now and then one of the boats that live on the water, with a radio check or a word about where she is bound as
 *   she gets under way, and the station's answer
 * - a ferry or a ship about to pass close to the player's own boat, to that boat by name. Only that player hears it
 *
 * Each has several ways of saying the same thing, picked by a hash of who and when, in ordinary VHF procedure.
 * `spoken` turns the written words into what a speech synthesiser should be given: numbers a figure at a time, and
 * place names respelled where voices mangle them.
 */

export interface RadioCall {
  /** Seconds into the season. */
  t: number;
  /** Who is calling: a route's id, a resident's id, or `station`. Her voice is cast from this. */
  vessel: string;
  /** Who is calling, as shown beside the words. */
  from: string;
  /** Empty for a broadcast, whose words are made when it goes out. */
  text: string;
  kind: 'securite' | 'bulletin' | 'check';
  role: Role;
  /** A voice from this part of the world, if there is one: "en-GB". */
  accent?: string;
  /** The answer that follows straight after, from somebody else. */
  answer?: { vessel: string; from: string; text: string; role: Role };
}

/** Scheduled calls are never closer together than this, seconds. */
export const CALL_GAP = 420;
/** A ship reports this long before she reaches her gate. */
const GATE_LEAD = 90;
/** What the coast station is called when the traffic file does not say. */
export const STATION = 'Coast Radio';

const pick = <T>(list: readonly T[], h: number): T => list[Math.min(list.length - 1, Math.floor(h * list.length))];
function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 100003;
}

/** How a vessel names herself on the air. */
export function callSign(route: { name: string; kind: string; sign?: string }): string {
  if (route.sign) return route.sign;
  return route.kind === 'ship' ? `the motor vessel ${route.name}` : `the ${route.name}`;
}

/** A ferry leaving her berth. `h` picks the wording. */
export function leavingText(who: string, from: string, to: string, h: number): string {
  return pick([
    `Securite, securite, securite. All stations, this is ${who}, leaving ${from} for ${to}. Standing by on one six.`,
    `Securite, securite, securite. All stations, all stations, this is ${who}. Departing ${from}, bound for ${to}. Listening on one six.`,
    `Securite, securite, securite. This is ${who}, under way from ${from} for ${to}. Concerned traffic, one six.`,
    `Securite, securite, securite. All stations, ${who} is backing out at ${from}, bound for ${to}. Standing by on one six.`,
  ], h);
}

/** A ship or a ferry coming up to a named point. `way` is "inbound", "outbound" or "approaching". */
export function gateText(who: string, kind: TrafficRoute['kind'], way: string, gate: string, to: string | undefined, about: string, h: number): string {
  const bound = to ? `, bound for ${to}` : '';
  const at = way === 'approaching' ? `approaching ${gate}` : `${way} at ${gate}`;
  if (kind === 'ship') {
    return pick([
      `Securite, securite, securite. All stations, this is ${who}, ${at}${bound}, ${about}. Standing by on one six.`,
      `Securite, securite, securite. All stations, this is ${who}, ${at}${bound}, ${about}. Small craft, please keep the channel clear. Standing by on one six.`,
      `Securite, securite, securite. All stations, all stations, this is ${who}, ${at}${bound}, ${about}, restricted to the deep water channel. Listening on one six.`,
    ], h);
  }
  return pick([
    `Securite, securite, securite. All stations, this is ${who}, ${at}${bound}, ${about}. Standing by on one six.`,
    `Securite, securite, securite. This is ${who}, ${at}${bound}, ${about}. Concerned traffic, one six.`,
  ], h);
}

/**
 * Every scheduled call in one run of the season, in order.
 * @param seasonLength seconds of recorded weather; calls are listed from 0 to there
 * @param gap the least time between two calls. The station's broadcast goes out on time whatever else is due; a
 *   ship's call is kept over a ferry's, and any of them over a yacht's radio check.
 * @param broadcasts the coast station's, from `broadcasts`
 * @param checks the residents', from `checkCalls`
 */
export function schedule(spec: TrafficSpec, seasonLength: number, gap = CALL_GAP, broadcasts: RadioCall[] = [], checks: RadioCall[] = []): RadioCall[] {
  const ships: RadioCall[] = [];
  const ferries: RadioCall[] = [];
  for (const r of spec.routes) {
    if (r.mode !== 'shuttle' || (r.kind !== 'ferry' && r.kind !== 'ship')) continue;
    if (!r.ends && !r.gate) continue;
    const track = new Track(r, spec.referenceHours * 3600);
    const dwell = r.dwell ?? 0;
    const back = track.travel + dwell;
    const who = callSign(r);
    const into = r.kind === 'ship' ? ships : ferries;
    const role: Role = r.kind === 'ship' ? 'pilot' : 'master';
    const about = `${Math.round(r.length / 10) * 10} metres, making ${Math.round(r.speedKt)} knots`;
    const own = seed(r.id);
    // The moment each cycle begins: the vessel leaving her first end.
    const first = spec.referenceHours * 3600 - r.phase;
    for (let k = Math.floor(-first / track.cycle) - 1; ; k++) {
      const t0 = first + k * track.cycle;
      if (t0 > seasonLength) break;
      const add = (t: number, text: string): void => {
        if (t >= 0 && t < seasonLength) into.push({ t, vessel: r.id, from: r.name, text, kind: 'securite', role });
      };
      // Leaving a berth. A vessel that is off the chart at an end has no berth there to leave.
      if (r.ends) {
        if (!r.hideAtEnds || r.hideAtEnds === 'last') add(t0, leavingText(who, r.ends[0], r.ends[1], hash01(own, k, 1)));
        if (!r.hideAtEnds || r.hideAtEnds === 'first') add(t0 + back, leavingText(who, r.ends[1], r.ends[0], hash01(own, k, 2)));
      }
      if (r.gate) {
        const s = track.along(r.gate.at);
        // A ship coming in from sea is inbound; a tug or a pilot boat, like a ferry, is just coming up to the place.
        const ship = r.kind === 'ship';
        add(t0 + track.runTime(s) - GATE_LEAD, gateText(who, r.kind, ship ? 'inbound' : 'approaching', r.gate.name, r.ends?.[1], about, hash01(own, k, 3)));
        add(t0 + back + track.runTime(track.length - s) - GATE_LEAD, gateText(who, r.kind, ship ? 'outbound' : 'approaching', r.gate.name, r.ends?.[0], about, hash01(own, k, 4)));
      }
    }
  }
  const kept: RadioCall[] = [];
  const clear = (c: RadioCall) => kept.every((k) => Math.abs(k.t - c.t) >= gap);
  for (const list of [broadcasts.slice(), ships, ferries]) {
    list.sort((a, b) => a.t - b.t);
    for (const c of list) if (c.t >= 0 && c.t < seasonLength && clear(c)) kept.push(c);
  }
  // A yacht with something to say waits for a gap, a quarter of an hour at the most, and otherwise lets it go.
  for (const c of checks.slice().sort((a, b) => a.t - b.t)) {
    for (let wait = 0; wait <= 900; wait += 150) {
      const later = { ...c, t: c.t + wait };
      if (later.t >= 0 && later.t < seasonLength && clear(later)) {
        kept.push(later);
        break;
      }
    }
  }
  return kept.sort((a, b) => a.t - b.t);
}

/** The calls that fall due between two moments in the season: after `from`, up to and including `to`. */
export function due(calls: readonly RadioCall[], from: number, to: number): RadioCall[] {
  if (!(to > from)) return [];
  let lo = 0;
  let hi = calls.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (calls[mid].t <= from) lo = mid + 1;
    else hi = mid;
  }
  const out: RadioCall[] = [];
  for (let i = lo; i < calls.length && calls[i].t <= to; i++) out.push(calls[i]);
  return out;
}

// ---- the coast station ---------------------------------------------------------------------------

/** The hours of the clock at which the station broadcasts, at 35 minutes past: every other hour through the day. */
export const BROADCAST_HOURS = [7, 9, 11, 13, 15, 17, 19];

/**
 * When the station broadcasts, as calls with no words yet.
 * @param startHour the hour of the local clock at the start of the season
 */
export function broadcasts(station: string, seasonLength: number, startHour: number): RadioCall[] {
  const out: RadioCall[] = [];
  for (let day = -1; day * 86400 < seasonLength; day++) {
    for (const h of BROADCAST_HOURS) {
      const t = day * 86400 + (h + 35 / 60 - startHour) * 3600;
      if (t >= 0 && t < seasonLength) out.push({ t, vessel: 'station', from: station, text: '', kind: 'bulletin', role: 'station' });
    }
  }
  return out;
}

/** What a broadcast is made from. Winds in knots; directions as words ("west"). */
export interface Outlook {
  station: string;
  /** The water, as the station would name it: "San Francisco Bay". */
  area: string;
  /** The local clock, hours, 0 to 24. */
  hour: number;
  windKt: number;
  windFrom: string;
  gustKt: number;
  /** In three hours, from the forecast. */
  laterKt: number;
  laterFrom: string;
  /** The next turn of the tide, if one is near. */
  turn: { high: boolean; minutes: number } | null;
}

const clock4 = (hour: number): string => {
  const m = Math.round(hour * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
};
const about5 = (kt: number): number => Math.max(0, Math.round(kt));

/** The marine information broadcast, in words. `n` picks the phrasing. */
export function bulletin(o: Outlook, n = 0): string {
  const now = about5(o.windKt);
  const later = about5(o.laterKt);
  const gust = about5(o.gustKt);
  const wind = now < 3 ? 'Wind light and variable' : `Wind ${o.windFrom} at ${now} knots${gust >= now + 6 ? `, gusts ${gust}` : ''}`;
  const trend = later >= now + 4 ? 'increasing' : later <= now - 4 ? 'easing' : 'holding';
  const ahead = later < 3 ? 'In three hours, light and variable' : `In three hours, ${trend === 'holding' && o.laterFrom === o.windFrom ? 'little change' : `${o.laterFrom} at ${later} knots`}${trend === 'holding' ? '' : `, ${trend}`}`;
  const mins = o.turn ? Math.max(5, Math.round(o.turn.minutes / 5) * 5) : 0;
  const when = mins < 90 ? `in ${mins} minutes` : `in about ${Math.round(mins / 60)} hours`;
  const tide = o.turn ? ` ${o.turn.high ? 'High' : 'Low'} water ${when}, then the ${o.turn.high ? 'ebb' : 'flood'}.` : '';
  const care = Math.max(now, later, gust) >= 22 ? ' Small craft should reef early and keep a good lookout.' : now < 5 && later < 5 ? ' Light airs: allow for the tide.' : '';
  const open = pick([
    `All stations, all stations, all stations, this is ${o.station}, ${o.station}, with the marine information broadcast for ${o.area} at ${clock4(o.hour)}.`,
    `All stations, all stations, this is ${o.station} with the weather for ${o.area}, time ${clock4(o.hour)}.`,
    `Hello all stations, this is ${o.station}, ${o.station}. Marine information for ${o.area} at ${clock4(o.hour)}.`,
  ], hash01(n, 5));
  return `${open} ${wind}. ${ahead}.${tide}${care} ${o.station}, out.`;
}

// ---- the boats that live here --------------------------------------------------------------------

export interface Departure {
  /** Seconds into the season at which she gets under way. */
  t: number;
  id: string;
  name: string;
  /** "sailing vessel", "fishing vessel", "motor vessel". */
  sort: string;
  from: string;
  to: string;
  accent?: string;
}

/** A yacht's call to the station as she gets under way, and the station's answer. About one departure in three is called. */
export function checkCalls(station: string, departures: readonly Departure[]): RadioCall[] {
  const out: RadioCall[] = [];
  for (const d of departures) {
    const own = seed(d.id);
    const h = hash01(own, Math.floor(d.t / 60), 1);
    if (h > 0.34) continue;
    const who = `${d.sort} ${d.name}`;
    const k = hash01(own, Math.floor(d.t / 60), 2);
    const [text, answer] = pick<[string, string]>([
      [`${station}, ${station}, this is ${who}, ${d.name}. Radio check on one six, over.`, `${d.name}, ${station}. Loud and clear. Out.`],
      [`${station}, this is ${who}, under way from ${d.from} for ${d.to}. Standing by on one six.`, `${d.name}, ${station}, roger. Have a good trip. Out.`],
      [`${station}, ${station}, ${who}. Radio check please, over.`, `${who}, this is ${station}. You are weak but readable. Out.`],
      [`${station}, this is ${who}, leaving ${d.from}. Anything moving that I should know about? Over.`, `${d.name}, ${station}. Nothing reported. Listen for the ferries on one six. Out.`],
    ], k);
    out.push({ t: d.t + 90 + 240 * hash01(own, Math.floor(d.t / 60), 3), vessel: d.id, from: d.name, text, kind: 'check', role: 'skipper', accent: d.accent, answer: { vessel: 'station', from: station, text: answer, role: 'station' } });
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---- a ferry or a ship passing close -------------------------------------------------------------

export interface Passing {
  vessel: TrafficVessel;
  /** Metres apart at the closest, and seconds until then. */
  cpa: number;
  tcpa: number;
  /** Where she is now, seen from the player's boat: "on your port bow". */
  where: string;
}

const SECTORS = ['ahead of you', 'on your starboard bow', 'on your starboard beam', 'on your starboard quarter', 'astern of you', 'on your port quarter', 'on your port beam', 'on your port bow'];

/**
 * The ferry or ship that is going to pass close to this boat within the next couple of minutes, if there is one.
 * @param boat position in sim metres, heading and course over ground in compass radians, speed in m/s
 */
export function passing(boat: { x: number; y: number; heading: number; cog: number; sog: number }, vessels: readonly TrafficVessel[]): Passing | null {
  let best: Passing | null = null;
  const bvx = Math.sin(boat.cog) * boat.sog;
  const bvy = Math.cos(boat.cog) * boat.sog;
  for (const v of vessels) {
    if ((v.kind !== 'ferry' && v.kind !== 'ship') || v.sog < 1) continue;
    const px = v.x - boat.x;
    const py = v.y - boat.y;
    if (Math.hypot(px, py) > 2500) continue;
    const wx = Math.sin(v.heading) * v.sog - bvx;
    const wy = Math.cos(v.heading) * v.sog - bvy;
    const w2 = wx * wx + wy * wy;
    if (w2 < 1e-6) continue;
    const tcpa = -(px * wx + py * wy) / w2;
    if (tcpa < 25 || tcpa > 150) continue;
    const cpa = Math.hypot(px + wx * tcpa, py + wy * tcpa);
    if (cpa > 120 + v.length * 0.8) continue;
    if (best && best.tcpa <= tcpa) continue;
    const rel = Math.atan2(px, py) - boat.heading;
    const sector = ((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8;
    best = { vessel: v, cpa, tcpa, where: SECTORS[sector] };
  }
  return best;
}

/** What she says to the boat she is about to pass. `h` picks the wording; left out, it is the plain one. */
export function passingText(p: Passing, boatName: string, h = 0): string {
  const who = boatName.trim() ? `Sailing vessel ${boatName.trim()}` : 'Sailing vessel';
  const me = callSign(p.vessel);
  const off = Math.max(50, Math.round(p.cpa / 50) * 50);
  const when = p.tcpa < 50 ? 'in under a minute' : p.tcpa < 100 ? 'in about a minute' : 'in two minutes';
  return pick([
    `${who}, this is ${me}, ${p.where}. I will pass about ${off} metres off ${when}. Please hold your course.`,
    `${who}, ${who.replace('Sailing', 'sailing')}, this is ${me}, ${p.where}. I intend to pass ${off} metres clear ${when}. Request you hold your course and speed.`,
    `${who}, this is ${me}, coming up ${p.where}. Hold your course, skipper: I will leave you about ${off} metres ${when}.`,
  ], h);
}

// ---- for the speech synthesiser ------------------------------------------------------------------

const FIGURES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
/** A number the way it is said on the air: a figure at a time. 25 is "two five". */
export const figures = (n: number | string): string => String(n).replace(/\D/g, '').split('').map((d) => FIGURES[Number(d)]).join(' ');

/** Names a synthesiser says wrongly, and how to spell them so it says them right. */
const RESPELL: Array<[RegExp, string]> = [
  [/securite/gi, 'say-curitay'],
  [/\bSausalito\b/g, 'Sossa-leeto'],
  [/\bTiburon\b/g, 'Tibba-ron'],
  [/\bAyala\b/g, 'Eye-ahla'],
  [/\bYerba Buena\b/g, 'Yerba Bwayna'],
  [/\bMcCovey\b/g, 'Mac Covey'],
  [/\bAnacortes\b/g, 'Anna-cortis'],
  [/\bSucia\b/g, 'Soo-sha'],
  [/\bSpieden\b/g, 'Spy-den'],
  [/\bRoche\b/g, 'Roash'],
  [/\bRosario\b/g, 'Ro-zario'],
  [/\bHaro\b/g, 'Hair-oh'],
  [/\bTyee\b/g, 'Tie-ee'],
  [/\bSalal\b/g, 'Sa-lal'],
  [/\bMaria C\b/g, 'Maria Sea'],
  [/\bkt\b/g, 'knots'],
  [/\bnm\b/g, 'miles'],
];

/**
 * The same words, as a speech synthesiser should be given them: speeds, gusts and times a figure at a time
 * ("two five knots", "one four three zero"), and names it would mangle respelled.
 */
export function spoken(text: string): string {
  let out = text
    .replace(/\b(\d{1,2}) knots\b/g, (_m, n: string) => `${figures(n)} knots`)
    .replace(/\bgusts (\d{1,2})\b/g, (_m, n: string) => `gusts ${figures(n)}`)
    .replace(/\b(at|time) ([0-2]\d[0-5]\d)\b/g, (_m, w: string, n: string) => `${w} ${figures(n)}`);
  for (const [from, to] of RESPELL) out = out.replace(from, to);
  return out;
}
