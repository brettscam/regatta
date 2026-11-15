import type { LanePath } from './caribbean';
import { roll } from './gunnery';
import { pickWeighted } from './loot';
import { shipClass, type Nation, type ShipClass } from './tables';

// The ships at sea: where each one is, as a pure function of the time and the seed, like the Bay's traffic.
// A trader leaves the head of her lane every so many hours and sails it once. A man-of-war goes round her beat for
// ever. Nothing here remembers anything: the game (`game.ts`) takes a ship over when the player comes near her.
//
// SEAM, fleets: a convoy is several ships of one sailing. Give `Sailing` a station astern of a leader here.
// SEAM, other players in the same sea: every player with the same seed and clock sees these same ships.

const KT = 0.514444;

export interface Sailing {
  /** The lane and the number of the sailing: the same ship is the same id every time she is asked for. */
  id: string;
  lane: LanePath;
  cls: ShipClass;
  nation: Nation;
  /** A whole number of her own, for her cargo and her fights. */
  seed: number;
  x: number;
  y: number;
  /** Compass heading, radians, and speed over the ground, m/s. */
  heading: number;
  speed: number;
}

/** A point a distance along a lane, and the heading there. */
export function alongLane(lane: LanePath, metres: number): { x: number; y: number; heading: number } {
  let left = Math.max(0, Math.min(lane.metres, metres));
  for (let i = 1; i < lane.path.length; i++) {
    const a = lane.path[i - 1];
    const b = lane.path[i];
    const leg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= leg || i === lane.path.length - 1) {
      const f = leg > 0 ? Math.min(1, left / leg) : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: (Math.atan2(b.x - a.x, b.y - a.y) + Math.PI * 2) % (Math.PI * 2) };
    }
    left -= leg;
  }
  return { ...lane.path[0], heading: 0 };
}

/** The ship of one sailing of a lane: which class she is, her number, and the speed she makes good along it. */
function shipOf(lane: LanePath, laneIndex: number, k: number, seed: number): { cls: ShipClass; seed: number; speed: number } {
  const own = Math.floor(roll(seed, laneIndex, k, 31) * 2 ** 30);
  const cls = shipClass(pickWeighted(lane.ships, roll(own, 1, 32)));
  // A passage is made good at about six tenths of her best speed, what with the wind where it is.
  return { cls, seed: own, speed: cls.maxKt * KT * (0.52 + 0.14 * roll(own, 2, 32)) };
}

/**
 * Every ship on the lanes at a time.
 * @param t seconds since the voyage began
 */
export function shipsAt(lanes: LanePath[], t: number, seed: number): Sailing[] {
  const out: Sailing[] = [];
  lanes.forEach((lane, li) => {
    const gap = lane.every * 3600;
    const phase = roll(seed, li, 33);
    if (lane.patrol) {
      // One ship, relieved every `every` hours, so that one sunk is not gone for good.
      const k = Math.floor(t / gap);
      const s = shipOf(lane, li, k, seed);
      const at = alongLane(lane, (((t * s.speed + phase * lane.metres) % lane.metres) + lane.metres) % lane.metres);
      out.push({ id: `${lane.id}#${k}`, lane, cls: s.cls, nation: lane.nation, seed: s.seed, ...at, speed: s.speed });
      return;
    }
    // The slowest ship takes this long. No sailing older than that is still at sea.
    const longest = lane.metres / (4.4 * 0.52 * KT);
    for (let k = Math.ceil((t - longest) / gap - phase); k <= Math.floor(t / gap - phase); k++) {
      const left = (k + phase) * gap;
      const s = shipOf(lane, li, k, seed);
      const run = (t - left) * s.speed;
      if (run < 0 || run >= lane.metres) continue;
      out.push({ id: `${lane.id}#${k}`, lane, cls: s.cls, nation: lane.nation, seed: s.seed, ...alongLane(lane, run), speed: s.speed });
    }
  });
  return out;
}

/**
 * How fast a ship of a class goes, m/s, at an angle to the true wind in degrees and a wind in knots. A plain rule for
 * the other ships, who are not sailed by the sim: nothing closer than she points, best with the wind abaft the beam,
 * a fore-and-aft rig slower dead before it. The player's sloop has a real polar in `boats/jamaica-sloop.json`.
 * SEAM, square rig: this is all a square-rigger is so far. One the player sails needs the sim to know braces and tacking in stays.
 */
export function shipSpeed(cls: ShipClass, twaDeg: number, twsKt: number): number {
  const a = Math.abs(twaDeg);
  const p = cls.pointDeg;
  let by: number;
  if (a < p - 10) by = 0;
  else if (a < p) by = 0.5 * (1 - (p - a) / 10);
  else if (a < 110) by = 0.5 + 0.5 * ((a - p) / (110 - p));
  else if (a < 145) by = 1;
  else by = 1 - (1 - cls.runShare) * ((a - 145) / 35);
  const blow = Math.min(1.06, Math.pow(Math.max(0, twsKt) / 17, 0.7));
  return cls.maxKt * KT * by * blow;
}
