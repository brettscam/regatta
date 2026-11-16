import type * as THREE from 'three';
import { KT, type Sim } from '@slack-tide/sim';
import { trackFix } from '@slack-tide/nav';
import type { ReplayWorld } from '@slack-tide/world';
import type { YardBoat } from '../boat/yard';
import type { Fleet } from '../net/fleet';
import type { Logbook } from '../net/logbook';
import type { Wave } from '../scene/waves';
import type { TrafficVessel } from '../scene/traffic';
import type { Passage } from '../ui/passage';
import { CLOSES_AFTER, addEvent, eventWater, gunTime, inText, isOpen, nextEvent, readEvent, sharedEvent, whenText } from './events';
import { MAX_PACE, drawEntrants, readMix, readPace, type Mix } from './cast';
import { PaceBoat } from './pace';
import { remainingBy, separate, startBerths } from './sailor';
import { CALLS, RING, bearing3, dueCall, gunOutsideCall, inRingCall, preStart, preStartCall, preStartLine, shortRange, spokenRange, taken, takenCall, type Onward, type PreStart } from './startline';

export interface RaceMark { name: string; x: number; y: number }
export interface RaceCourse { id: string; name: string; blurb: string; marks: RaceMark[] }
/** A race someone has called. The first mark is the start: be there at the gun and pass it after. */
export interface RaceCall {
  id: string;
  name: string;
  marks: RaceMark[];
  /** Season time of the gun, seconds. */
  gun: number;
  host: string;
  /** How many pace boats sail it too: club skippers on the autopilot, drawn from the race's id so every page has the same ones. */
  pace: number;
  /** What sort of fleet they are: mostly back-markers, the whole club, or mostly good. A call without one is the whole club. */
  mix?: Mix;
  /**
   * For a race fixed on the real clock: the gun in milliseconds since 1970. The countdown then runs on the real clock,
   * which every boat shares exactly, and `gun` is only that moment as it fell on the season clock when the call was made.
   */
  at?: number;
  /**
   * The class the race is sailed in: a boat id. Everyone who joins sails that boat, so it is the sailing that wins.
   * A call without one (from an older copy of the game) leaves everyone in her own boat.
   */
  cls?: string;
}
export interface Standing {
  name: string;
  boat: string;
  me: boolean;
  pace: boolean;
  leg: number;
  toGo: number;
  /** Seconds from the gun to the finish, or null while still racing. */
  finish: number | null;
  /** Metres left to the finish by the marks. 0 once finished. */
  remaining: number;
  /** How far she is behind: seconds after the first boat home once she has finished, metres behind the leading boat still racing until then. */
  gapS: number | null;
  gapM: number | null;
  /** She was in this race and has left it without finishing. */
  retired: boolean;
  /** Hull damage, whole percent: 100 is holed. */
  damage: number;
  /** Her topsides colour and sail number, where known, for her picture. */
  colour: string;
  sail: string;
  /** Another person's boat: her room id, and her skipper's avatar code as she sent it. */
  peer?: string;
  avatar?: string;
  /** A club pace boat: the skipper's id in the cast, how good she is and what she is like. */
  castId?: string;
  level?: string;
  character?: string;
  /** Who is aboard besides the skipper. Nobody yet: the slot is here for crews. */
  crew: string[];
}

/** As near the wind as a towed boat is left pointing, radians. */
const CLOSE_HAULED = (50 * Math.PI) / 180;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const CLASS_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;

/** A class as it is spoken of: "the 38". */
export const classText = (boat: YardBoat): string => (boat.lengthFt ? `the ${boat.lengthFt}` : boat.name);

/** A race call as another page sent it. Nothing in it is trusted until it has been through here. */
export function readCall(v: unknown): RaceCall | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  if (typeof c.id !== 'string' || !c.id || c.id.length > 32 || typeof c.name !== 'string' || !finite(c.gun) || !Array.isArray(c.marks)) return null;
  if (c.marks.length < 2 || c.marks.length > 12) return null;
  const marks: RaceMark[] = [];
  for (const m of c.marks as Array<Record<string, unknown>>) {
    if (!m || typeof m.name !== 'string' || !finite(m.x) || !finite(m.y) || Math.abs(m.x) > 40000 || Math.abs(m.y) > 40000) return null;
    marks.push({ name: m.name.slice(0, 28), x: Math.round(m.x), y: Math.round(m.y) });
  }
  const call: RaceCall = { id: c.id, name: c.name.slice(0, 60), marks, gun: c.gun, host: typeof c.host === 'string' ? c.host.slice(0, 24) : 'Someone', pace: readPace(c.pace) };
  if (call.pace > 0 && typeof c.mix === 'string') call.mix = readMix(c.mix);
  if (typeof c.cls === 'string' && CLASS_ID.test(c.cls)) call.cls = c.cls;
  return call;
}

export const clockText = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};
export const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

export interface RaceContext {
  sim: Sim;
  world: ReplayWorld;
  passage: Passage;
  fleet: Fleet;
  /** The player's own boat, the one she chose on the way in. */
  own: YardBoat;
  /** The boat she is sailing now: her own, or the class of the race she is in. */
  boat(): YardBoat;
  /** The boats a race can be sailed in, by id. */
  classes: Record<string, YardBoat>;
  /** Put her in another boat where she lies, keeping her name and colours. */
  setBoat(boat: YardBoat): void;
  scene: THREE.Scene;
  logbook: Logbook;
  skipper: string;
  boatName: string;
  /** Her topsides colour, for her picture in the roster. */
  colour?: string;
  /** The courses a fixed event can name. */
  courses: RaceCourse[];
  /** A passing remark, an alarm that needs the player, and word that someone has called a race. */
  say(text: string, seconds?: number): void;
  alarm(text: string): void;
  invite(from: string, text: string): void;
  /** The player has finished: show how everyone stands. */
  finished(): void;
}

/**
 * Racing: call a race or join one somebody else has called, a countdown to the gun, the course on the chart,
 * and who is where. Other people's boats report their own progress. Pace boats are sailed here by the autopilot.
 */
export class Race {
  /** The race this boat is in. */
  call: RaceCall | null = null;
  /** Races other boats have called that this one could join. */
  readonly offers = new Map<string, RaceCall>();
  started = false;
  /** A note the session adds to the racing line, such as what is left of the full pilot. */
  note = '';
  leg = 0;
  toGo = 0;
  finish: number | null = null;
  place = 0;
  pacers: PaceBoat[] = [];
  /** Goes up whenever something a panel would show has changed. */
  version = 0;
  private mine = false;
  private legStart = { x: 0, y: 0 };
  private readonly told = new Set<string>();
  private readonly called = new Set<number>();
  /** Whether the calls before the gun carry advice, or only the time. The course guide sets it: hiding the guide hides the coaching. */
  coach = true;
  /** She has been told once that she is in the start ring. */
  private ringTold = false;
  /** Other people's boats seen in this race, as last seen: one that leaves without finishing is shown as retired. */
  private readonly seen = new Map<string, Standing>();

  constructor(private readonly ctx: RaceContext) {}

  private get now(): number {
    return this.ctx.world.seasonTime(this.ctx.sim.state.t);
  }

  /** Seconds until the gun. Negative once it has gone. */
  get countdown(): number {
    const c = this.call;
    if (!c) return 0;
    return c.at ? (c.at - Date.now()) / 1000 : c.gun - this.now;
  }

  /** Seconds since the gun. */
  get elapsed(): number {
    const c = this.call;
    if (!c) return 0;
    return c.at ? (Date.now() - c.at) / 1000 : this.now - c.gun;
  }

  get nextMark(): RaceMark | null {
    return this.call?.marks[this.leg] ?? null;
  }

  /** The boat a race is sailed in, or null when everyone sails her own (or it names a boat this copy of the game does not have). */
  classOf(call: RaceCall | null): YardBoat | null {
    return (call?.cls && this.ctx.classes[call.cls]) || null;
  }

  /**
   * Call a race and enter it. Everyone on the water is told.
   * @param cls the class it is sailed in: a boat id. The caller's own boat unless given
   */
  callRace(course: { name: string; marks: RaceMark[] }, minutes: number, pace: number, cls: string = this.ctx.own.id, mix: Mix = 'mixed'): void {
    const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
    const call: RaceCall = {
      id, name: course.name.slice(0, 60), marks: course.marks.slice(0, 12).map((m) => ({ name: m.name.slice(0, 28), x: Math.round(m.x), y: Math.round(m.y) })),
      gun: Math.round(this.now + minutes * 60), host: this.ctx.skipper || this.ctx.boatName || 'A skipper', pace: Math.max(0, Math.min(MAX_PACE, Math.round(pace))),
    };
    if (call.pace > 0) call.mix = mix;
    if (this.ctx.classes[cls]) call.cls = cls;
    this.join(call, true);
  }

  join(call: RaceCall, mine = false): void {
    this.leave(true, true);
    const { sim, passage, world, scene } = this.ctx;
    // One design: everyone sails the race's class, whatever she came in. Her own boat comes back when the race is left.
    const cls = this.classOf(call);
    const want = cls ?? this.ctx.own;
    const changed = want.id !== this.ctx.boat().id;
    if (changed) this.ctx.setBoat(want);
    const spec = this.ctx.boat();
    this.call = call;
    this.mine = mine;
    this.started = false;
    this.finish = null;
    this.leg = 0;
    this.place = 0;
    this.called.clear();
    this.offers.delete(call.id);
    this.seen.clear();
    // The club boats that have turned out, each in her berth. Who they are and where they lie comes from the call alone
    // (and the chart), so every page in this race has the same boats in the same places.
    const entrants = drawEntrants(call.id, call.pace, call.mix);
    const need = spec.dimensions.draft + 2.5;
    const berths = startBerths(call.marks, entrants, (x, y) => world.chartDepth(x, y) >= need);
    entrants.forEach((e, i) => this.pacers.push(new PaceBoat(e, berths[i], spec, world, scene, call.marks, i)));
    const towed = this.musterAtStart(call);
    this.legStart = { x: sim.state.x, y: sim.state.y };
    const start = call.marks[0];
    const left = this.countdown;
    // Until the gun the chart's route, and the pilot's, goes to the start and no further. The course goes on at the gun.
    passage.setRoute(left > 0 ? [start] : call.marks, sim.state, sim.state.t);
    // A call due in the moment of joining would wipe out what is said on joining, which says more.
    for (const c of CALLS) if (left <= c + 1 && left > c - 12) this.called.add(c);
    const when = left > 0 ? `Gun in ${clockText(left)}` : `It started ${clockText(-left)} ago`;
    // Said when she is not in her own boat: everyone in this race sails the same one.
    const inClass = cls && cls.id !== this.ctx.own.id ? `. You are racing ${classText(cls)} for this one` : '';
    // Where the start is from here, and the one thing to do about it.
    const toMark = Math.hypot(start.x - sim.state.x, start.y - sim.state.y);
    const inside = toMark < RING;
    this.ringTold = inside;
    const ring = inside
      ? `You are in the start ring round ${start.name}`
      : `The start ring round ${start.name} is ${spokenRange(toMark - RING)} off, bearing ${bearing3(Math.atan2(start.x - sim.state.x, start.y - sim.state.y))}°`;
    const todo = left <= 0 ? (inside ? '' : '. Sail into it to begin')
      : inside ? '. Stay in it or close by: inside it at the gun you start at once'
        : '. Be inside it when the gun goes, or sail into it after';
    this.ctx.say(`${mine ? 'Race called' : 'Race joined'}: ${call.name}. ${towed ? 'You have been towed to the start area. ' : ''}${when}. ${ring}${todo}${inClass}`, inClass ? 14 : 11);
    this.version++;
  }

  /**
   * Everyone starts together. A boat that enters from far off is towed to the start area: a few hundred metres short of
   * the start mark, on the far side from the first leg, each boat in her own berth so the fleet is spread along the line.
   * @returns true if she was moved
   */
  private musterAtStart(call: RaceCall): boolean {
    const { sim, world, fleet } = this.ctx;
    const spec = this.ctx.boat();
    const s = sim.state;
    const start = call.marks[0];
    if (Math.hypot(start.x - s.x, start.y - s.y) < 450) return false;
    const next = call.marks[1] ?? start;
    const along = Math.atan2(next.x - start.x, next.y - start.y);
    // Berths fan out either side of the line of the first leg, the first boats nearest the middle. Pace boats lie ahead of them.
    const taken = fleet.boats.filter((b) => b.raceId === call.id).length;
    const need = spec.dimensions.draft + 2.5;
    for (let k = taken; k < taken + 14; k++) {
      const back = 330 + Math.floor(k / 4) * 70;
      const side = (k % 2 === 0 ? 1 : -1) * (45 + Math.floor((k % 4) / 2) * 60) + (Math.random() - 0.5) * 24;
      const x = start.x - Math.sin(along) * back + Math.cos(along) * side;
      const y = start.y - Math.cos(along) * back - Math.sin(along) * side;
      // Room to lie there: water under her and around her.
      let clear = world.depth(x, y, s.t) >= need && this.pacers.every((p) => Math.hypot(p.sim.state.x - x, p.sim.state.y - y) > 40);
      for (let j = 0; j < 6 && clear; j++) clear = world.depth(x + Math.sin(j) * 70, y + Math.cos(j) * 70, s.t) >= spec.dimensions.draft + 1;
      if (!clear) continue;
      if (s.hold !== 'none') sim.release();
      s.x = x;
      s.y = y;
      // Pointed at the start mark with a little way on and the sails set for it. With the mark to windward
      // she lies close-hauled on the tack that looks at it more nearly: never head to wind, where she would sit in irons.
      const from = world.wind(x, y, s.t).dir;
      const brg = Math.atan2(start.x - x, start.y - y);
      const off = Math.atan2(Math.sin(brg - from), Math.cos(brg - from));
      s.heading = Math.abs(off) >= CLOSE_HAULED ? brg : from + (off < 0 ? -CLOSE_HAULED : CLOSE_HAULED);
      s.speed = 0.8;
      s.lateral = 0;
      s.yawRate = 0;
      s.heel = 0;
      s.knock = 0;
      s.rudder = 0;
      s.rudderCmd = 0;
      s.maneuver = null;
      sim.setHelm('hand');
      sim.setCrewTrim(true);
      sim.trimForWind();
      return true;
    }
    return false;
  }

  /**
   * Give the race up. The route stays on the chart, and she is back in her own boat.
   * @param keepBoat leave her in the boat she is in, because she is about to join another race
   */
  leave(quiet = false, keepBoat = false): void {
    if (!this.call) return;
    const back = !keepBoat && this.ctx.boat().id !== this.ctx.own.id;
    if (back) this.ctx.setBoat(this.ctx.own);
    for (const p of this.pacers) p.dispose();
    this.pacers = [];
    this.call = null;
    this.mine = false;
    this.started = false;
    this.finish = null;
    if (!quiet || back) this.ctx.say(`${quiet ? 'The race is off' : 'Out of the race'}${back ? `. You are back in your own boat, the ${this.ctx.own.name}` : ''}`, back ? 8 : 5);
    this.version++;
  }

  /** What to tell the room: the race this boat has called, the one she is in, and how she is doing. */
  wire(): Record<string, unknown> {
    return {
      rc: this.mine && this.call ? this.call : null,
      // A race fixed for a set time is passed from boat to boat, so those who never had the link hear of it.
      ev: ((e) => (e ? { name: e.name, course: e.course, water: eventWater(e), at: Date.parse(e.at), ...(e.cls ? { cls: e.cls } : {}) } : null))(sharedEvent()),
      rj: this.call?.id ?? '',
      rp: this.leg,
      rd: Math.round(this.toGo),
      rf: this.finish === null ? 0 : Math.round(this.finish * 10) / 10,
    };
  }

  /** One fixed sim step: the pace boats sail on. */
  step(): void {
    if (!this.started) return;
    const elapsed = this.elapsed;
    for (const p of this.pacers) p.step(elapsed);
    separate(this.pacers);
  }

  /** Once a frame, after the sim has stepped. */
  update(): void {
    this.listen();
    const call = this.call;
    if (!call) return;
    const { sim, passage } = this.ctx;
    const left = this.countdown;
    // A gun more than half an hour off means the clock has been moved under the race. Call it off.
    if (left > 1800) return this.leave();
    // True on the frame of the gun itself. A boat that joins a race already under way gets no gun.
    let atGun = false;
    if (!this.started) {
      const start = call.marks[0];
      this.toGo = Math.hypot(start.x - sim.state.x, start.y - sim.state.y);
      const pre = this.preStart()!;
      const due = dueCall(left, this.called);
      if (due !== null) {
        this.called.add(due);
        this.ctx.say(preStartCall(due, pre, this.coach), this.coach && due > 10 ? 8 : 5);
      } else if (pre.state === 'inside' && !this.ringTold && this.coach && left > 15) {
        this.ctx.say(inRingCall(left), 8);
      }
      // Told once, and only on the way in: a boat that drifts out and back is not told again.
      if (pre.state === 'inside') this.ringTold = true;
      if (left > 0) return;
      this.started = true;
      this.leg = 0;
      this.legStart = { x: sim.state.x, y: sim.state.y };
      // The whole course goes on the chart from here. The start ring is its first mark: a boat inside it is given it below, at once.
      passage.setRoute(call.marks, sim.state, sim.state.t);
      for (const p of this.pacers) p.start(sim.state.tick);
      atGun = left > -5;
      this.version++;
    }
    if (this.finish !== null) return;
    const next = call.marks[this.leg];
    const fix = trackFix(sim.state, this.legStart, next);
    this.toGo = fix.toGo;
    const how = taken(fix.toGo, fix.along, Math.hypot(next.x - this.legStart.x, next.y - this.legStart.y));
    if (!how) {
      if (atGun) this.ctx.alarm(gunOutsideCall(next.name, fix.toGo, fix.bearing));
      return;
    }
    this.leg++;
    this.legStart = { x: next.x, y: next.y };
    this.version++;
    // The chart's route judges by the same rule from its own leg, and can differ by a moment. The race's word is the one that counts.
    const charted = passage.marks[passage.nextIndex];
    if (charted && charted.x === next.x && charted.y === next.y) {
      charted.reachedAt = sim.state.t;
      passage.version++;
    }
    const after = call.marks[this.leg];
    if (after) {
      const range = Math.hypot(after.x - sim.state.x, after.y - sim.state.y);
      const onward: Onward = { name: after.name, metres: Math.max(0, range - RING), bearing: Math.atan2(after.x - sim.state.x, after.y - sim.state.y), last: this.leg === call.marks.length - 1 };
      this.toGo = range;
      this.ctx.alarm(takenCall(next.name, this.leg - 1, how, fix.toGo, onward, atGun));
      return;
    }
    this.finish = this.elapsed;
    this.toGo = 0;
    const table = this.standings();
    this.place = table.findIndex((s) => s.me) + 1;
    this.ctx.logbook.count('races');
    if (this.place === 1 && table.length > 1) this.ctx.logbook.count('wins');
    this.ctx.alarm(`Finished ${call.name} in ${clockText(this.finish)}. ${table.length > 1 ? `${ORDINAL[this.place - 1] ?? `${this.place}th`} of ${table.length}` : 'A time to beat'}`);
    this.ctx.finished();
  }

  /** How she stands against the gun: distance to the start ring, and early or late at her present speed. Null once it has gone. */
  preStart(): PreStart | null {
    const call = this.call;
    if (!call || this.started) return null;
    const { sim } = this.ctx;
    return preStart(Math.hypot(call.marks[0].x - sim.state.x, call.marks[0].y - sim.state.y), sim.out.sog, this.countdown);
  }

  /** Hear what races the other boats have called. */
  private listen(): void {
    const now = this.now;
    const live = new Set<string>();
    for (const b of this.ctx.fleet.boats) {
      const call = readCall(b.raceCall);
      // Worth offering until a quarter of an hour after the gun: later than that and it has sailed.
      if (!call || call.gun - now > 1800 || now - call.gun > 900) continue;
      live.add(call.id);
      if (this.call?.id === call.id) continue;
      if (!this.offers.has(call.id)) this.version++;
      this.offers.set(call.id, call);
      if (!this.told.has(call.id) && call.gun > now) {
        this.told.add(call.id);
        this.ctx.invite(b.name || call.host, `calls a race: ${call.name}. Gun in ${clockText(call.gun - now)}. Press R to join`);
      }
    }
    // Races other boats know of that were fixed for a set time.
    for (const b of this.ctx.fleet.boats) {
      const heard = readEvent(b.raceEvent);
      if (heard && addEvent(heard) && gunTime(heard) > Date.now()) {
        const c = this.ctx.courses.find((k) => k.id === heard.course);
        if (c) this.ctx.invite(b.name || 'Another boat', `has fixed a race: ${c.name}, gun at ${whenText(heard)}, ${inText(heard)}. It opens for joining 25 minutes before`);
      }
    }
    // A race fixed for a real time opens for joining a while before its gun. Every boat builds the same call from the same data.
    const event = nextEvent();
    const course = event && this.ctx.courses.find((c) => c.id === event.course);
    if (event && course && isOpen(event)) {
      live.add(event.id);
      if (this.call?.id !== event.id) {
        const at = gunTime(event);
        if (!this.offers.has(event.id)) this.version++;
        this.offers.set(event.id, { id: event.id, name: `${event.name}: ${course.name}`, marks: course.marks, gun: Math.round(now + (at - Date.now()) / 1000), host: 'The race committee', pace: 0, at, ...(event.cls ? { cls: event.cls } : {}) });
        if (!this.told.has(event.id) && at > Date.now()) {
          this.told.add(event.id);
          this.ctx.invite('The race committee', `calls ${event.name}: ${course.name}. Gun at ${whenText(event)}, ${inText(event)}. Press R to join`);
        }
      }
    }
    for (const id of this.offers.keys()) {
      if (!live.has(id)) {
        this.offers.delete(id);
        this.version++;
      }
    }
  }

  /** Everyone in this race, leader first, with how far each is behind. Boats that have left it come last. */
  standings(): Standing[] {
    const call = this.call;
    if (!call) return [];
    const marks = call.marks;
    const blank = { gapS: null, gapM: null, retired: false, damage: 0, colour: '', sail: '', crew: [] as string[] };
    const rows: Standing[] = [{
      ...blank, name: this.ctx.skipper || 'You', boat: this.ctx.boatName, me: true, pace: false, leg: this.leg, toGo: this.toGo, finish: this.finish,
      remaining: this.finish !== null ? 0 : remainingBy(marks, this.leg, this.toGo), damage: Math.round(this.ctx.sim.state.damage * 100), colour: this.ctx.colour ?? '',
    }];
    const here = new Set<string>();
    for (const b of this.ctx.fleet.boats) {
      if (b.raceId !== call.id) continue;
      here.add(b.peer);
      const finish = b.raceFinish > 0 ? b.raceFinish : null;
      const leg = Math.max(0, Math.min(marks.length - 1, Math.round(b.raceLeg) || 0));
      const row: Standing = {
        ...blank, name: b.name || 'A skipper', boat: b.boatName, me: false, pace: false, leg, toGo: b.raceToGo, finish,
        remaining: finish !== null ? 0 : remainingBy(marks, leg, b.raceToGo), damage: b.damage, colour: b.colour, peer: b.peer, avatar: b.avatar,
      };
      this.seen.set(b.peer, row);
      rows.push(row);
    }
    for (const p of this.pacers) {
      const who = p.entrant.who;
      rows.push({
        ...blank, name: p.skipper, boat: p.name, me: false, pace: true, leg: p.leg, toGo: p.toGo, finish: p.finish, remaining: p.remaining,
        colour: who.colour, sail: who.sail, castId: who.id, level: p.entrant.level.name, character: who.character,
      });
    }
    rows.sort((a, b) => {
      if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
      return a.remaining - b.remaining;
    });
    const first = rows[0]?.finish ?? null;
    const leader = rows.find((r) => r.finish === null);
    for (const r of rows) {
      if (r.finish !== null) r.gapS = first === null ? 0 : r.finish - first;
      else if (leader && this.started) r.gapM = r.remaining - leader.remaining;
    }
    // Someone who was racing and is gone, or has left the race, without a finish: retired.
    for (const [peer, last] of this.seen) if (!here.has(peer) && last.finish === null) rows.push({ ...last, retired: true, gapM: null });
    return rows;
  }

  /** One line for the bar under the clock. */
  line(): string {
    const call = this.call;
    if (!call) {
      const offer = [...this.offers.values()].find((o) => (o.at ? o.at > Date.now() - CLOSES_AFTER * 60e3 : o.gun > this.now));
      if (offer) {
        const left = offer.at ? (offer.at - Date.now()) / 1000 : offer.gun - this.now;
        return left > 0 ? `${offer.at ? offer.name : `${offer.host} calls a race`} · gun in ${clockText(left)} · R to join` : `${offer.name} started ${clockText(-left)} ago · R to join late`;
      }
      // Something fixed for later today: keep it in view.
      const event = nextEvent();
      const course = event && this.ctx.courses.find((c) => c.id === event.course);
      return event && course ? `${event.name} · ${course.name} · gun at ${whenText(event)}, ${inText(event)}` : '';
    }
    if (!this.started) return `Race · ${preStartLine(this.preStart()!, call.marks[0].name)}`;
    const table = this.standings();
    const place = table.findIndex((s) => s.me) + 1;
    const racing = table.filter((r) => !r.retired).length;
    const pos = racing > 1 ? ` · ${ORDINAL[place - 1] ?? place} of ${racing}` : '';
    if (this.finish !== null) return `Finished in ${clockText(this.finish)}${pos}`;
    const what = this.leg === 0 ? 'start ring at' : this.leg === call.marks.length - 1 ? 'finish at' : 'next';
    return `Racing ${clockText(this.elapsed)}${pos} · ${what} ${this.nextMark?.name ?? ''} ${shortRange(Math.max(0, this.toGo - RING))}${this.note ? ` · ${this.note}` : ''}`;
  }

  /** The pace boats, for the chart and the collision watch. */
  vessels(): TrafficVessel[] {
    return this.pacers.map((p, i) => ({ id: `pace-${i}`, name: p.name, kind: 'sail', x: p.sim.state.x, y: p.sim.state.y, heading: p.sim.state.heading, sog: p.sim.out.sog, length: p.length, beam: p.length / 3 }));
  }

  draw(seaTime: number, waves: Wave[], dt: number, camera: THREE.Camera, width: number, height: number): void {
    // A pace boat not yet built is built here, one a frame.
    let build = true;
    for (const p of this.pacers) if (p.draw(seaTime, waves, dt, camera, width, height, build)) build = false;
  }
}

export const speedText = (ms: number) => `${(ms / KT).toFixed(1)} kt`;
