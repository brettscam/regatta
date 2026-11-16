import { hash01, prospects, type Water } from './catch';

/**
 * The boats that live on a water: cruising yachts on passage between its harbours, daysailers off the town, a boat
 * fishing a bank, a whale-watch launch, kayakers under the shore, yachts lying at anchor overnight.
 *
 * Everything here is pure. Where each boat is depends only on the time in the season, the recorded wind and her own
 * line in the water's `residents.json`, so every player sees the same boat in the same place, and the tests can sail
 * the whole season. No DOM, no Three.js, no clocks, no `Math.random`.
 *
 * How a boat moves:
 * - Her data gives a line of way points from her home berth to the far end. She goes out along it, stops, and comes back.
 * - `out` is the hours of the clock between which she will set out. A boat that stays `overnight` at the far end
 *   needs the hours for the trip home as well; the rest come home whenever they have stopped long enough.
 * - A boat under sail never goes dead to windward. When a leg lies within 38 degrees of the wind she beats up it,
 *   42 degrees off the wind on each tack, inside whatever room the depth chart gives her either side of the line.
 *   Where there is no room to tack she motors. Under 3 kt of wind she motors too.
 * - The wind for a leg is read once, as she starts it. Her whole season is worked out when the water is loaded.
 */

const KT = 0.514444;
const D2R = Math.PI / 180;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export type ResidentKind = 'cruiser' | 'daysailer' | 'fisher' | 'launch' | 'kayak';
/** How she lies when stopped. `away` is out of sight: in a marina berth, or on the beach. */
export type Lie = 'anchor' | 'mooring' | 'dock' | 'drift' | 'away';

export interface ResidentSpec {
  id: string;
  name: string;
  kind: ResidentKind;
  /** What she is, for the player: "34 ft sloop". */
  type: string;
  home: string;
  skipper: string;
  /** One line of character, said the first time she is met. */
  line: string;
  colour: string;
  length: number;
  beam: number;
  speedKt: number;
  /** Way points from her berth to the far end, metres east and north: [x, y] or [x, y, "name"]. One point and she lies there all season. */
  points: Array<[number, number] | [number, number, string]>;
  /** What the two ends are called: "Sausalito", "Ayala Cove". */
  ends: [string, string];
  /** Hours of the local clock between which she sets out. */
  out: [number, number];
  /** Minutes she stops at each end. */
  stop: number;
  /** How she lies at home and at the far end. Left out: a mooring at home, her anchor at the far end. */
  lie?: [Lie, Lie];
  /** She keeps to `out` for the trip home as well, and so spends the night at the far end. */
  overnight?: boolean;
  /** She works a patch this many metres across at the far end instead of lying still: a boat fishing. */
  work?: number;
  /** A voice from this part of the world, if the browser has one: "en-GB", "en-AU". */
  accent?: string;
}

export interface ResidentFile {
  note?: string;
  boats: ResidentSpec[];
}

/** The water as the roster needs it. Season time throughout: seconds from the start of the recorded weather. */
export interface Sea {
  /** Charted depth less the lowest tide of the season, metres. 0 or less is land. */
  depth(x: number, y: number): number;
  /** The recorded hourly wind: where it blows from, compass radians, and m/s. */
  wind(x: number, y: number, season: number): { dir: number; speed: number };
  /** Race marks: nobody's track comes inside their rings. */
  marks: ReadonlyArray<{ x: number; y: number }>;
  /** Seconds of season, and the hour of the local clock at its start. */
  length: number;
  startHour: number;
}

/** Water each kind wants under her at the lowest tide of the season, metres. */
export const NEED: Record<ResidentKind, number> = { cruiser: 3.5, daysailer: 2.5, fisher: 3, launch: 3.5, kayak: 0.7 };
/** Nobody's track comes closer to a race mark than this: the ring a mark is taken in is 130 m. */
export const MARK_CLEAR = 170;
/** A leg within this of the wind is beaten up, and this is how far off the wind she sails on each tack. */
export const BEAT = 38 * D2R;
export const TACK_ANGLE = 42 * D2R;
/** Under this much wind, knots, a yacht motors. */
export const MOTOR_UNDER = 3;
/** The most room she takes either side of her line to tack in, metres, and the least worth tacking in. */
const ROOMS = [240, 170, 110, 70, 40];

export const underSail = (kind: ResidentKind): boolean => kind === 'cruiser' || kind === 'daysailer';
/** The big ones hold their course and sound five short blasts. Everyone else keeps clear. */
export const givesWay = (kind: ResidentKind): boolean => kind !== 'launch';
/** Kayaks carry no radio: what a paddler says is called across the water, not put on channel 16. */
export const hasRadio = (kind: ResidentKind): boolean => kind !== 'kayak';

/** A number from 0 to 1 that depends only on a name. */
export function nameHash(name: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return hash01(h >>> 0, salt + 0.5);
}
const pick = <T>(list: readonly T[], h: number): T => list[Math.min(list.length - 1, Math.floor(h * list.length))];

// ---- where she is --------------------------------------------------------------------------------

interface Leg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  len: number;
  brg: number;
  /** Clear water either side of the line, metres. 0 when there is none to speak of. */
  room: number;
}

export type Mode = 'sail' | 'motor' | 'paddle' | 'work' | 'berth' | 'away';

interface Phase {
  t0: number;
  t1: number;
  /** A run along one leg, or a stay at one end. */
  leg: number;
  /** 1 outward, -1 homeward, 0 stopped. */
  dir: number;
  /** Stays: which end, 0 home or 1 far. */
  end: number;
  mode: Mode;
  /** Speed through the water, m/s. */
  v: number;
  /** Beating: half the width of the zigzag, metres. 0 on a straight run. */
  amp: number;
  /** Beating: sideways metres for each metre up the leg on the board going right, and on the one going left. */
  a: number;
  b: number;
  /** Beating: the two headings, and the cosines of their angles to the leg. */
  hr: number;
  hl: number;
  cr: number;
  cl: number;
  /** 1 when the first board goes to the right of the line. */
  first: number;
}

export interface ResidentState {
  x: number;
  y: number;
  /** Compass radians. */
  heading: number;
  /** m/s. */
  sog: number;
  mode: Mode;
  /** Where she is going, or where she lies. */
  bound: string;
  /** 0 at home, 1 at the far end, -1 under way. */
  end: number;
  lie: Lie;
}

export const blankState = (): ResidentState => ({ x: 0, y: 0, heading: 0, sog: 0, mode: 'away', bound: '', end: 0, lie: 'away' });

export interface Resident {
  spec: ResidentSpec;
  legs: Leg[];
  phases: Phase[];
  /** A number of her own from her name, for everything that should differ from boat to boat. */
  seed: number;
}

export class Roster {
  readonly boats: Resident[] = [];
  /** Where a boat's line runs into shoal water or a mark's ring, as words for the console. Empty when all is well. */
  readonly faults: string[] = [];

  constructor(file: ResidentFile, private readonly sea: Sea) {
    for (const spec of file.boats) this.boats.push(this.build(spec));
  }

  private free(x: number, y: number, need: number): boolean {
    if (this.sea.depth(x, y) < need) return false;
    for (const m of this.sea.marks) if ((m.x - x) ** 2 + (m.y - y) ** 2 < MARK_CLEAR * MARK_CLEAR) return false;
    return true;
  }

  private build(spec: ResidentSpec): Resident {
    const need = NEED[spec.kind];
    const seed = nameHash(spec.id) * 1000;
    const legs: Leg[] = [];
    for (let i = 1; i < spec.points.length; i++) {
      const [ax, ay] = spec.points[i - 1];
      const [bx, by] = spec.points[i];
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const steps = Math.max(2, Math.ceil(len / 40));
      // The line itself. Her berth at either end may lie in shoaler water than she would sail through.
      for (let k = 2; k <= steps - 2; k++) {
        const x = ax + (ux * len * k) / steps;
        const y = ay + (uy * len * k) / steps;
        if (!this.free(x, y, need)) {
          this.faults.push(`${spec.id} leg ${i} is not clear at ${Math.round(x)}, ${Math.round(y)}: ${this.sea.depth(x, y).toFixed(1)} m`);
          break;
        }
      }
      // Room to tack: the widest strip either side of the line that is clear all the way along.
      let room = 0;
      if (underSail(spec.kind)) {
        for (const w of ROOMS) {
          let clear = true;
          for (let k = 0; k <= steps && clear; k++) {
            const x = ax + (ux * len * k) / steps;
            const y = ay + (uy * len * k) / steps;
            for (const side of [-1, -0.5, 0.5, 1]) {
              const q = side * w * 1.1;
              if (!this.free(x + uy * q, y - ux * q, need)) {
                clear = false;
                break;
              }
            }
          }
          if (clear) {
            room = w;
            break;
          }
        }
      }
      legs.push({ ax, ay, bx, by, len, brg: Math.atan2(ux, uy), room });
    }
    return { spec, legs, phases: this.timetable(spec, legs, seed), seed };
  }

  /** The hour of the local clock at a moment in the season, 0 to 24. */
  clock(season: number): number {
    return (((this.sea.startHour + season / 3600) % 24) + 24) % 24;
  }

  /** The first moment at or after `t` when the clock is inside her hours. */
  private opens(spec: ResidentSpec, t: number): number {
    const [from, to] = spec.out;
    const h = this.clock(t);
    if (h >= from && h < to) return t;
    const wait = (((from - h) % 24) + 24) % 24;
    return t + wait * 3600;
  }

  private timetable(spec: ResidentSpec, legs: Leg[], seed: number): Phase[] {
    const phases: Phase[] = [];
    const L = this.sea.length;
    const lies: [Lie, Lie] = spec.lie ?? ['mooring', 'anchor'];
    const stay = (t0: number, t1: number, end: number): void => {
      if (t1 <= t0) return;
      const lie = lies[end];
      phases.push({ t0, t1, leg: 0, dir: 0, end, mode: lie === 'away' ? 'away' : end === 1 && spec.work ? 'work' : 'berth', v: 0, amp: 0, a: 0, b: 0, hr: 0, hl: 0, cr: 1, cl: 1, first: 1 });
    };
    if (!legs.length) {
      stay(0, L, 0);
      return phases;
    }
    let t = 0;
    let end = 0;
    let since = 0;
    let trip = 0;
    for (let guard = 0; guard < 400 && t < L; guard++) {
      // She leaves when she has stopped long enough and, outward bound, when her hours allow.
      let go = t;
      if (end === 0 || spec.overnight) {
        const open = this.opens(spec, t);
        // Waiting for the morning, she does not leave on the stroke of the hour.
        go = open > t ? open + hash01(seed, trip, 3) * 2700 : t;
      }
      if (go >= L) break;
      stay(since, go, end);
      t = go;
      const order = end === 0 ? legs.map((_, i) => i) : legs.map((_, i) => legs.length - 1 - i);
      for (const i of order) {
        const run = this.run(spec, legs[i], i, end === 0 ? 1 : -1, t, hash01(seed, trip, i) < 0.5 ? 1 : -1);
        phases.push(run);
        t = run.t1;
      }
      end = 1 - end;
      since = t;
      t += spec.stop * 60 * (0.8 + 0.4 * hash01(seed, trip, 7));
      trip++;
    }
    stay(since, Math.max(L, since + 1), end);
    return phases;
  }

  /** One leg sailed once, starting at `t0`. */
  private run(spec: ResidentSpec, leg: Leg, index: number, dir: number, t0: number, first: number): Phase {
    const brg = dir > 0 ? leg.brg : leg.brg + Math.PI;
    const base = spec.speedKt * KT;
    const p: Phase = { t0, t1: t0, leg: index, dir, end: 0, mode: 'motor', v: base, amp: 0, a: 0, b: 0, hr: brg, hl: brg, cr: 1, cl: 1, first };
    if (spec.kind === 'kayak') p.mode = 'paddle';
    else if (underSail(spec.kind)) {
      const wind = this.sea.wind((leg.ax + leg.bx) / 2, (leg.ay + leg.by) / 2, t0);
      const kt = wind.speed / KT;
      // Where the wind is from, off the course: positive is wind from the starboard side of the line.
      const off = wrap(wind.dir - brg);
      const press = clamp(0.25 + 0.065 * kt, 0.4, 1.08);
      if (kt < MOTOR_UNDER) p.v = base * 0.75;
      else if (Math.abs(off) < BEAT) {
        if (leg.room > 0) {
          p.mode = 'sail';
          p.v = base * press * 0.84;
          const right = off + TACK_ANGLE;
          const left = off - TACK_ANGLE;
          p.a = Math.tan(right);
          p.b = Math.tan(-left);
          p.hr = brg + right;
          p.hl = brg + left;
          p.cr = Math.cos(right);
          p.cl = Math.cos(left);
          // A whole number of zigzags to the leg, as wide as the room allows.
          const per = 2 * (1 / p.a + 1 / p.b);
          const n = Math.max(1, Math.ceil(leg.len / (leg.room * per)));
          p.amp = leg.len / n / per;
        } else p.v = base * 0.75;
      } else {
        p.mode = 'sail';
        const a = Math.abs(off);
        p.v = base * press * (a < 55 * D2R ? 0.86 : a > 150 * D2R ? 0.85 : 1);
      }
    }
    p.t1 = t0 + (p.amp > 0 ? leg.len * (1 / (p.a * p.cr) + 1 / (p.b * p.cl)) / (1 / p.a + 1 / p.b) : leg.len) / p.v;
    return p;
  }

  private find(r: Resident, season: number): Phase {
    const ph = r.phases;
    let lo = 0;
    let hi = ph.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ph[mid].t1 <= season) lo = mid + 1;
      else hi = mid;
    }
    return ph[lo];
  }

  /** Where a boat is at a moment in the season. A pure function of the time. */
  state(index: number, season: number, out: ResidentState): ResidentState {
    const r = this.boats[index];
    const spec = r.spec;
    const p = this.find(r, season);
    const lies: [Lie, Lie] = spec.lie ?? ['mooring', 'anchor'];
    out.mode = p.mode;
    if (p.dir === 0) {
      const at = spec.points[p.end === 0 ? 0 : spec.points.length - 1];
      out.x = at[0];
      out.y = at[1];
      out.sog = 0;
      out.end = p.end;
      out.lie = lies[p.end];
      out.bound = spec.ends[p.end];
      if (p.mode === 'work' && spec.work) {
        // Working a patch: a slow figure of eight about the spot, eased in and out so she arrives and leaves at its middle.
        const tau = season - p.t0;
        const edge = clamp(Math.min(tau, p.t1 - season) / 180, 0, 1);
        const e = edge * edge * (3 - 2 * edge);
        const R = spec.work / 2;
        const w = (1.1 * KT) / R;
        const turn = r.seed;
        const ex = R * Math.sin(w * tau);
        const ey = R * 0.45 * Math.sin(2 * w * tau);
        const vx = R * w * Math.cos(w * tau);
        const vy = R * 0.9 * w * Math.cos(2 * w * tau);
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        out.x += e * (ex * c - ey * s);
        out.y += e * (ex * s + ey * c);
        out.heading = Math.atan2(vx * c - vy * s, vx * s + vy * c);
        out.sog = e * Math.hypot(vx, vy);
      } else if (out.lie === 'dock' || out.lie === 'away') {
        // Alongside: as her line leaves the berth.
        const leg = r.legs[p.end === 0 ? 0 : r.legs.length - 1];
        out.heading = leg ? (p.end === 0 ? leg.brg : leg.brg + Math.PI) : r.seed;
      } else {
        // Swinging to her anchor or mooring: head to the wind of the hour.
        out.heading = this.sea.wind(out.x, out.y, Math.floor(season / 600) * 600).dir;
      }
      return out;
    }
    const leg = r.legs[p.leg];
    const brg = p.dir > 0 ? leg.brg : leg.brg + Math.PI;
    const sx = p.dir > 0 ? leg.ax : leg.bx;
    const sy = p.dir > 0 ? leg.ay : leg.by;
    const ux = Math.sin(brg);
    const uy = Math.cos(brg);
    const tau = clamp(season - p.t0, 0, p.t1 - p.t0);
    let s: number;
    let q = 0;
    out.heading = brg;
    if (p.amp > 0) {
      // Three boards to a zigzag: half of one, the whole of the other, and the first again back to the line.
      const A = p.amp;
      const sr = (2 * A) / p.a;
      const sl = (2 * A) / p.b;
      const tr = sr / (p.v * p.cr);
      const tl = sl / (p.v * p.cl);
      const per = tr + tl;
      const k = Math.floor(tau / per);
      let rest = tau - k * per;
      s = k * (sr + sl);
      const rightFirst = p.first > 0;
      const t1 = (rightFirst ? tr : tl) / 2;
      const t2 = rightFirst ? tl : tr;
      const v1 = p.v * (rightFirst ? p.cr : p.cl);
      const v2 = p.v * (rightFirst ? p.cl : p.cr);
      const g1 = rightFirst ? p.a : -p.b;
      const g2 = rightFirst ? -p.b : p.a;
      let going = rightFirst;
      if (rest < t1) {
        s += v1 * rest;
        q = g1 * v1 * rest;
      } else if (rest < t1 + t2) {
        rest -= t1;
        s += v1 * t1 + v2 * rest;
        q = g1 * v1 * t1 + g2 * v2 * rest;
        going = !rightFirst;
      } else {
        rest -= t1 + t2;
        s += v1 * t1 + v2 * t2 + v1 * rest;
        q = g1 * v1 * t1 + g2 * v2 * t2 + g1 * v1 * rest;
      }
      out.heading = going ? p.hr : p.hl;
    } else s = p.v * tau;
    // Right of the line is (uy, -ux).
    out.x = sx + ux * s + uy * q;
    out.y = sy + uy * s - ux * q;
    out.sog = p.v;
    out.end = -1;
    out.lie = 'drift';
    // Where the trip ends: the far end outward, home on the way back.
    out.bound = spec.ends[p.dir > 0 ? 1 : 0];
    return out;
  }

  /**
   * The next named place ahead of a boat under way, and when she will be there by her timetable.
   * Null when she is stopped.
   */
  ahead(index: number, season: number): { name: string; x: number; y: number; eta: number } | null {
    const r = this.boats[index];
    const now = this.find(r, season);
    if (now.dir === 0) return null;
    const pts = r.spec.points;
    for (let i = r.phases.indexOf(now); i < r.phases.length; i++) {
      const p = r.phases[i];
      if (p.dir === 0) break;
      const at = p.dir > 0 ? p.leg + 1 : p.leg;
      const name = at === 0 ? r.spec.ends[0] : at === pts.length - 1 ? r.spec.ends[1] : pts[at][2];
      if (name) return { name, x: pts[at][0], y: pts[at][1], eta: p.t1 };
    }
    return null;
  }

  /** Every time a boat gets under way in the season: when, which boat, where from and where to. In order of time. */
  departures(): Array<{ t: number; index: number; from: string; to: string }> {
    const out: Array<{ t: number; index: number; from: string; to: string }> = [];
    this.boats.forEach((r, index) => {
      r.phases.forEach((p, i) => {
        if (p.dir === 0 || (i > 0 && r.phases[i - 1].dir !== 0)) return;
        out.push({ t: p.t0, index, from: r.spec.ends[p.dir > 0 ? 0 : 1], to: r.spec.ends[p.dir > 0 ? 1 : 0] });
      });
    });
    return out.sort((a, b) => a.t - b.t);
  }

  /** How many boats are in sight on the water at a moment, and how many of those are under way. */
  afloat(season: number): { showing: number; underWay: number; sails: number } {
    const st = blankState();
    let showing = 0;
    let underWay = 0;
    let sails = 0;
    for (let i = 0; i < this.boats.length; i++) {
      this.state(i, season, st);
      if (st.mode === 'away') continue;
      showing++;
      if (st.mode !== 'berth') underWay++;
      if (st.mode === 'sail') sails++;
    }
    return { showing, underWay, sails };
  }
}

// ---- keeping clear -------------------------------------------------------------------------------

export const CLEAR = {
  /** Looked at when the other boat is inside this range, metres, and will be closest within this many seconds. */
  range: 450,
  ahead: 80,
  /** Closer than this at the closest, plus half her own length, and something is done about it. */
  miss: 32,
  /** What she can do: carry on, luff and slow right down, or free off and hurry a little. */
  slow: 0.3,
  hurry: 1.2,
  /** How far behind or ahead of her timetable keeping clear may put her, seconds, and how fast she makes it up. */
  most: 100,
  least: -25,
  regain: 0.12,
} as const;

export interface Crossing {
  /** How fast she should go, as a share of her speed: 1 holds on. */
  pace: number;
  /** True when the two will pass too close unless somebody does something. */
  danger: boolean;
  cpa: number;
  tcpa: number;
}

const NO_CROSSING: Crossing = { pace: 1, danger: false, cpa: Infinity, tcpa: 0 };

/**
 * What a resident does about another boat (the player's). She stays on her own line and changes only her speed, so
 * keeping clear can never put her ashore: she luffs and lets the other boat cross ahead, or frees off and crosses
 * ahead herself, whichever opens the gap more. One that does not give way holds on, and `danger` is for her horn.
 * Positions in sim metres, headings and courses compass radians, speeds m/s.
 */
export function keepClear(
  she: { x: number; y: number; heading: number; sog: number; length: number },
  other: { x: number; y: number; cog: number; sog: number },
  gives: boolean,
): Crossing {
  const px = other.x - she.x;
  const py = other.y - she.y;
  const range = Math.hypot(px, py);
  if (range > CLEAR.range || she.sog < 0.3) return NO_CROSSING;
  const ovx = Math.sin(other.cog) * other.sog;
  const ovy = Math.cos(other.cog) * other.sog;
  const hx = Math.sin(she.heading);
  const hy = Math.cos(she.heading);
  const at = (pace: number): { cpa: number; tcpa: number } => {
    const wx = ovx - hx * she.sog * pace;
    const wy = ovy - hy * she.sog * pace;
    const w2 = wx * wx + wy * wy;
    const tcpa = w2 < 1e-6 ? 0 : clamp(-(px * wx + py * wy) / w2, 0, CLEAR.ahead);
    return { cpa: Math.hypot(px + wx * tcpa, py + wy * tcpa), tcpa };
  };
  const hold = at(1);
  const miss = CLEAR.miss + she.length / 2;
  // Already opening, passing wide, or sailing along in company without closing: nothing to do.
  const danger = hold.cpa < miss && hold.tcpa > 0.5 && hold.cpa < range * 0.8;
  if (!danger) return { pace: 1, danger: false, cpa: hold.cpa, tcpa: hold.tcpa };
  if (!gives) return { pace: 1, danger: true, cpa: hold.cpa, tcpa: hold.tcpa };
  const slow = at(CLEAR.slow);
  const hurry = at(CLEAR.hurry);
  // Slowing is the seamanlike thing: she hurries only when that plainly opens the gap more.
  const pace = hurry.cpa > slow.cpa + 12 ? CLEAR.hurry : CLEAR.slow;
  return { pace, danger: true, cpa: hold.cpa, tcpa: hold.tcpa };
}

/** How far off her timetable she is after `dt` seconds at a pace: positive is behind. Comes back to nothing when the pace is 1. */
export function lagAfter(lag: number, pace: number, dt: number): number {
  if (pace !== 1) return clamp(lag + (1 - pace) * dt, CLEAR.least, CLEAR.most);
  const back = CLEAR.regain * dt;
  return Math.abs(lag) <= back ? 0 : lag - Math.sign(lag) * back;
}

// ---- what she knows ------------------------------------------------------------------------------

/** The world as a skipper reads it. Session time, as `ReplayWorld` takes it. */
export interface Weather {
  wind(x: number, y: number, t: number): { dir: number; speed: number };
  current(x: number, y: number, t: number): { x: number; y: number };
  tideRate(t: number): number;
  depth(x: number, y: number, t: number): number;
}

export interface SomePlace {
  name: string;
  x: number;
  y: number;
  say?: string;
  kind?: string;
}

export interface Facts {
  windKt: number;
  /** "west", "south-west". */
  windFrom: string;
  /** The named place where it is blowing hardest, when that is at least 3 kt more than here. */
  windier: { name: string; kt: number } | null;
  /** The next turn of the tide within seven hours: high or low water, and in how many minutes. */
  turn: { high: boolean; minutes: number } | null;
  /** The nearest place to lie the night that is not right here. */
  berth: { name: string; say: string; nm: number; toward: string } | null;
  /** Where something is biting, as the game's own fishing has it. */
  fish: { species: string; place: string; how: string } | null;
}

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** A compass direction in a word. */
export const compassWord = (rad: number): string => POINTS[((Math.round(rad / (Math.PI / 4)) % 8) + 8) % 8];

/**
 * What is true on the water now, for a boat to pass on when hailed. Everything comes from the world the player is
 * sailing in, so a tip can be acted on.
 * @param t session time, seconds
 * @param hour the local clock, 0 to 24
 */
export function gatherFacts(w: Weather, places: readonly SomePlace[], x: number, y: number, t: number, hour: number): Facts {
  const here = w.wind(x, y, t);
  const windKt = here.speed / KT;
  let windier: Facts['windier'] = null;
  for (const p of places) {
    if (Math.hypot(p.x - x, p.y - y) < 800) continue;
    const kt = w.wind(p.x, p.y, t).speed / KT;
    if (kt >= windKt + 3 && (!windier || kt > windier.kt)) windier = { name: p.name, kt };
  }
  let turn: Facts['turn'] = null;
  const rising = w.tideRate(t) > 0;
  for (let m = 5; m <= 420; m += 5) {
    if (w.tideRate(t + m * 60) > 0 !== rising) {
      turn = { high: rising, minutes: m };
      break;
    }
  }
  let berth: Facts['berth'] = null;
  let least = Infinity;
  for (const p of places) {
    if (p.kind !== 'anchorage' && p.kind !== 'mooring') continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < 500 || d > least) continue;
    least = d;
    berth = { name: p.name, say: p.say ?? '', nm: d / 1852, toward: compassWord(Math.atan2(p.x - x, p.y - y)) };
  }
  let fish: Facts['fish'] = null;
  let keenest = 0.25;
  const rate = w.tideRate(t);
  for (const p of places) {
    const c = w.current(p.x, p.y, t);
    const streamKt = Math.hypot(c.x, c.y) / KT;
    const depth = w.depth(p.x, p.y, t);
    for (const speedKt of [0, 3]) {
      const water: Water = { x: p.x, y: p.y, depth, speedKt, held: speedKt === 0, sogKt: speedKt, streamKt, tideRate: rate, hour };
      const best = prospects(water)[0];
      if (best && best.keen > keenest) {
        keenest = best.keen;
        fish = { species: best.species.name, place: p.name, how: speedKt ? 'trolling slowly' : 'with a bait on the bottom' };
      }
    }
  }
  return { windKt, windFrom: compassWord(here.dir), windier, turn, berth, fish };
}

// ---- what she says -------------------------------------------------------------------------------

/** What she is doing, for her words. */
export interface Doing {
  mode: Mode;
  bound: string;
}

const HELLO = ['Hello', 'Ahoy', 'Good to see you', 'Hello there', 'Hi'];
const minutesWords = (m: number): string => (m < 50 ? `about ${Math.max(5, Math.round(m / 5) * 5)} minutes` : m < 80 ? 'about an hour' : `about ${Math.round(m / 30) / 2} hours`);

const TIPS = ['wind', 'tide', 'berth', 'fish'] as const;

function tip(what: (typeof TIPS)[number], f: Facts, h: number): string | null {
  if (what === 'wind') {
    const kt = Math.round(f.windKt);
    if (f.windier) {
      return pick([
        `There is more wind at ${f.windier.name}: ${Math.round(f.windier.kt)} knots there against ${kt} here.`,
        `If you want breeze, go to ${f.windier.name}. It is blowing ${Math.round(f.windier.kt)} knots there, ${kt} here.`,
      ], h);
    }
    return pick([
      `It is ${kt} knots from the ${f.windFrom} and much the same all over just now.`,
      `About ${kt} knots, ${f.windFrom}, and nowhere I know of has more.`,
    ], h);
  }
  if (what === 'tide') {
    if (!f.turn) return null;
    const water = f.turn.high ? 'High water' : 'Low water';
    const then = f.turn.high ? 'the ebb after that' : 'the flood after that';
    return pick([
      `${water} in ${minutesWords(f.turn.minutes)}, and ${then}.`,
      `The tide turns in ${minutesWords(f.turn.minutes)}: ${water.toLowerCase()}, then ${then}.`,
    ], h);
  }
  if (what === 'berth') {
    if (!f.berth) return null;
    const far = f.berth.nm < 0.6 ? 'just' : `${f.berth.nm.toFixed(f.berth.nm < 3 ? 1 : 0)} miles`;
    return pick([
      `For the night, try ${f.berth.name}, ${far} to the ${f.berth.toward}. ${f.berth.say}`,
      `${f.berth.name} is a good place to stop, ${far} ${f.berth.toward} of here. ${f.berth.say}`,
    ], h).trim();
  }
  if (!f.fish) return pick(['Nothing much is biting just now. Try about the turn of the tide.', 'The fishing is slow. It picks up when the tide turns.'], h);
  return pick([
    `They are getting ${f.fish.species} off ${f.fish.place}, ${f.fish.how}.`,
    `If you have a line aboard, the ${f.fish.species} are on off ${f.fish.place}. ${f.fish.how === 'trolling slowly' ? 'Troll slowly' : 'Put a bait on the bottom'}.`,
  ], h);
}

function business(spec: ResidentSpec, doing: Doing, h: number): string {
  if (doing.mode === 'work') return pick([`Working the bank here out of ${spec.home}.`, `Fishing this patch till the tide turns, then home to ${spec.home}.`], h);
  if (doing.mode === 'berth') return pick([`Lying here at ${doing.bound} for now.`, `We are stopped at ${doing.bound}, and in no hurry.`], h);
  if (spec.kind === 'kayak') return pick([`Paddling round to ${doing.bound}.`, `Just out for a paddle, round to ${doing.bound} and back.`], h);
  if (spec.kind === 'launch') return pick([`Bound for ${doing.bound} with a boat full of visitors.`, `Running out to ${doing.bound}, looking for whales.`], h);
  if (doing.mode === 'motor') return pick([`Motoring to ${doing.bound}: no room or no wind to sail this bit.`, `Under engine for ${doing.bound} till the breeze is fair.`], h);
  return pick([`Bound for ${doing.bound} on this breeze.`, `Out of ${spec.home}, bound for ${doing.bound}.`, `Making for ${doing.bound}.`], h);
}

/**
 * Her answer to a hail. The first time she says who she is and where she is bound. After that, each hail brings
 * something she knows: the wind, the tide, a place to lie, the fishing. `n` counts this player's hails to her.
 */
export function hailReply(spec: ResidentSpec, doing: Doing, facts: Facts, n: number, boatName: string): string {
  const who = boatName.trim() || 'skipper';
  const h = (salt: number): number => nameHash(spec.id, salt + n * 7);
  if (n <= 0) return `${pick(HELLO, h(1))}, ${who}! ${spec.name} here, ${spec.skipper} aboard. ${business(spec, doing, h(2))}`;
  const start = Math.floor(nameHash(spec.id, 9) * TIPS.length);
  for (let k = 0; k < TIPS.length; k++) {
    const words = tip(TIPS[(start + n - 1 + k) % TIPS.length], facts, h(3));
    if (words) return `${pick([`${who}, ${spec.name}.`, `${spec.name} back to ${who}.`, `Since you ask, ${who}.`], h(4))} ${words}`;
  }
  return `${who}, ${spec.name}. Nothing new to tell. Fair winds.`;
}

/** What she calls across as the player sails past, close but not too close. */
export function passingWords(spec: ResidentSpec, doing: Doing, hour: number, windKt: number, boatName: string): string {
  const who = boatName.trim() || 'there';
  const h = (salt: number): number => nameHash(spec.id, salt + Math.floor(hour));
  const time = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  const air = windKt < 6 ? 'Not much wind in it today.' : windKt < 14 ? 'Lovely breeze for it.' : windKt < 20 ? 'Plenty of breeze today!' : 'Blowing a bit, is it not!';
  if (doing.mode === 'berth') return pick([`${time}, ${who}! Mind our anchor line as you go by.`, `${time}, ${who}. Kettle is on if you are stopping.`], h(1));
  if (doing.mode === 'work') return pick([`${time}, ${who}. Mind the gear astern of us.`, `${time}! Keep clear of our lines if you would.`], h(1));
  return pick([`${time}, ${who}! ${air}`, `${time}, ${who}. She looks well from here.`, `${time}! ${air}`], h(1));
}

/** What she says when the player passes much too close. */
export function grumble(spec: ResidentSpec, n: number, boatName: string): string {
  const who = boatName.trim() || 'you there';
  if (spec.kind === 'kayak') return pick([`Hey, ${who}! There is a person in this kayak!`, `Watch your wash, ${who}! That was close.`], nameHash(spec.id, 20 + n));
  return pick([
    `${who}, that was close enough to pass the salt. Give us some room!`,
    `Hey, ${who}! There is a whole ${spec.kind === 'fisher' ? 'bank' : 'bay'} out here. Keep off a bit!`,
    `${who}, ${spec.name}. A boat length is not a lot to ask.`,
  ], nameHash(spec.id, 20 + n));
}

/** The line that introduces her, the first time the player comes close: "Kestrel, a 34 ft sloop out of Sausalito. Dana Whitlock: ...". */
export function introduction(spec: ResidentSpec): string {
  const a = /^[aeiou8]/i.test(spec.type) ? 'an' : 'a';
  return `${spec.name}, ${a} ${spec.type} out of ${spec.home}. ${spec.skipper}: ${spec.line}`;
}

// ---- a race to the next point --------------------------------------------------------------------

export const DUEL = {
  /** Alongside means inside this many metres, heading within this of hers, both moving, for this long. */
  near: 90,
  heading: 30 * D2R,
  least: 1.2,
  after: 60,
  /** The place is reached inside this many metres. */
  reach: 160,
  /** No race is called to a place nearer or further than this, metres. */
  shortest: 600,
  longest: 9000,
  /** Fallen this far apart, the race is off. */
  lost: 2500,
} as const;

/** True while the player is sailing alongside her on much the same course. */
export function alongside(she: { x: number; y: number; heading: number; sog: number }, boat: { x: number; y: number; heading: number; sog: number }): boolean {
  if (she.sog < DUEL.least || boat.sog < DUEL.least) return false;
  if (Math.hypot(she.x - boat.x, she.y - boat.y) > DUEL.near) return false;
  return Math.abs(wrap(she.heading - boat.heading)) < DUEL.heading;
}

export const duelCall = (spec: ResidentSpec, to: string, boatName: string): string =>
  pick([`Race you to ${to}, ${boatName.trim() || 'skipper'}?`, `${boatName.trim() || 'Skipper'}, first to ${to} buys the drinks!`, `You are going our way. First one to ${to}?`], nameHash(spec.id, 31));

export const duelResult = (spec: ResidentSpec, to: string, playerWon: boolean, boatName: string): string => {
  const who = boatName.trim() || 'skipper';
  return playerWon
    ? pick([`First to ${to}. Well sailed, ${who}!`, `You have us beaten to ${to}, ${who}. Next time!`], nameHash(spec.id, 32))
    : pick([`${spec.name} is first to ${to}. Closer than it looked, ${who}!`, `That is ${to}, and we had you by a length or two, ${who}. Good race!`], nameHash(spec.id, 33));
};

// ---- the sea, from the game's world --------------------------------------------------------------

/** As much of `ReplayWorld` as the roster reads. */
export interface ChartLike {
  readonly seasonLength: number;
  course: {
    timeZone: string;
    season: { start: string; stepSeconds: number };
    tide: { truth: number[] };
    wind: { x0: number; y0: number; dx: number; nx: number; ny: number; scale: number; truth: Array<{ u: number[]; v: number[] }> };
  };
  chartDepth(x: number, y: number): number;
}

/** The hour of the local clock at an instant, 0 to 24. */
export function localHour(iso: string | number | Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get('hour') % 24) + get('minute') / 60;
}

/**
 * The water as the roster reads it, from the game's world. The wind is read straight from the recorded season, not
 * through the session's clock or its blow setting, so every player works out the same season to the last figure.
 * @param marks every race mark on this water
 */
export function seaOf(world: ChartLike, marks: ReadonlyArray<{ x: number; y: number }>): Sea {
  const lowest = Math.max(0, -Math.min(...world.course.tide.truth));
  const w = world.course.wind;
  const step = world.course.season.stepSeconds;
  const out = { dir: 0, speed: 0 };
  return {
    depth: (x, y) => {
      const d = world.chartDepth(x, y);
      return d <= 0 ? 0 : d - lowest;
    },
    wind: (x, y, season) => {
      const pos = Math.min(w.truth.length - 1, Math.max(0, season / step));
      const k = Math.min(w.truth.length - 2, Math.floor(pos));
      const ft = pos - k;
      const gx = Math.min(w.nx - 1.001, Math.max(0, (x - w.x0) / w.dx));
      const gy = Math.min(w.ny - 1.001, Math.max(0, (y - w.y0) / w.dx));
      const i = Math.floor(gx);
      const j = Math.floor(gy);
      const fx = gx - i;
      const fy = gy - j;
      const r0 = j * w.nx + i;
      const r1 = r0 + w.nx;
      const at = (a: number[]): number => (a[r0] * (1 - fx) + a[r0 + 1] * fx) * (1 - fy) + (a[r1] * (1 - fx) + a[r1 + 1] * fx) * fy;
      const u = (at(w.truth[k].u) * (1 - ft) + at(w.truth[k + 1].u) * ft) * w.scale;
      const v = (at(w.truth[k].v) * (1 - ft) + at(w.truth[k + 1].v) * ft) * w.scale;
      out.dir = (Math.atan2(-u, -v) + 2 * Math.PI) % (2 * Math.PI);
      out.speed = Math.hypot(u, v);
      return out;
    },
    marks,
    length: world.seasonLength,
    startHour: localHour(world.course.season.start, world.course.timeZone),
  };
}
