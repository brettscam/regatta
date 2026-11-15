import { Track, type TrafficRoute, type TrafficSpec, type TrafficVessel } from '../scene/traffic';

/**
 * What the ferries and ships say on channel 16, and when. Pure, so it can be tested and so every player hears the same
 * call at the same moment: the times come from the same `Track` the vessels are drawn from, which depends only on the
 * time in the season.
 *
 * Two kinds of call:
 * - a securite call when a ferry leaves a berth, and when a ship passes the way point its route names as its `gate`
 * - a short call to the player's own boat when a ferry or a ship is going to pass close. That one depends on where
 *   the player is, so only that player hears it.
 *
 * A water whose traffic file has no ferries or ships has no calls.
 */

export interface RadioCall {
  /** Seconds into the season. */
  t: number;
  /** The route's id. */
  vessel: string;
  /** Who is calling, as shown beside the words. */
  from: string;
  text: string;
}

/** Scheduled calls are never closer together than this, seconds. */
export const CALL_GAP = 300;
/** A ship reports this long before she reaches her gate. */
const GATE_LEAD = 90;

/** How a vessel names herself on the air. */
export function callSign(route: Pick<TrafficRoute, 'name' | 'kind'>): string {
  return route.kind === 'ship' ? `the motor vessel ${route.name}` : `the ${route.name}`;
}

const securite = (who: string, what: string): string => `Securite, securite, securite. All stations, this is ${who}, ${what}. Standing by on one six.`;

/**
 * Every scheduled call in one run of the season, in order.
 * @param seasonLength seconds of recorded weather; calls are listed from 0 to there
 * @param gap the least time between two calls. A ship's call is kept over a ferry's.
 */
export function schedule(spec: TrafficSpec, seasonLength: number, gap = CALL_GAP): RadioCall[] {
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
    const about = `${Math.round(r.length / 10) * 10} metres, making ${Math.round(r.speedKt)} knots`;
    // The moment each cycle begins: the vessel leaving her first end.
    const first = spec.referenceHours * 3600 - r.phase;
    for (let k = Math.floor(-first / track.cycle) - 1; ; k++) {
      const t0 = first + k * track.cycle;
      if (t0 > seasonLength) break;
      const add = (t: number, what: string): void => {
        if (t >= 0 && t < seasonLength) into.push({ t, vessel: r.id, from: r.name, text: securite(who, what) });
      };
      // Leaving a berth. A vessel that is off the chart at her ends has no berth here to leave.
      if (r.ends && !r.hideAtEnds) {
        add(t0, `leaving ${r.ends[0]} for ${r.ends[1]}`);
        add(t0 + back, `leaving ${r.ends[1]} for ${r.ends[0]}`);
      }
      if (r.gate) {
        const s = track.along(r.gate.at);
        const bound = (to: string | undefined) => (to ? `, bound for ${to}` : '');
        add(t0 + track.runTime(s) - GATE_LEAD, `inbound at ${r.gate.name}${bound(r.ends?.[1])}, ${about}`);
        add(t0 + back + track.runTime(track.length - s) - GATE_LEAD, `outbound at ${r.gate.name}${bound(r.ends?.[0])}, ${about}`);
      }
    }
  }
  const kept: RadioCall[] = [];
  const clear = (c: RadioCall) => kept.every((k) => Math.abs(k.t - c.t) >= gap);
  for (const list of [ships, ferries]) {
    list.sort((a, b) => a.t - b.t);
    for (const c of list) if (clear(c)) kept.push(c);
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

/** What she says to the boat she is about to pass. */
export function passingText(p: Passing, boatName: string): string {
  const who = boatName.trim() ? `Sailing vessel ${boatName.trim()}` : 'Sailing vessel';
  const off = Math.max(50, Math.round(p.cpa / 50) * 50);
  const when = p.tcpa < 50 ? 'in under a minute' : p.tcpa < 100 ? 'in about a minute' : 'in two minutes';
  return `${who}, this is ${callSign(p.vessel)}, ${p.where}. I will pass about ${off} metres off ${when}. Please hold your course.`;
}

/** The same words, spelled for a speech synthesiser that would otherwise say "securite" as "security". */
export function spoken(text: string): string {
  return text.replace(/Securite/gi, 'say-curitay');
}
