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
import { PaceBoat } from './pace';

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
  /** How many pace boats sail it too. */
  pace: number;
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
}

const ARRIVAL = 130;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
  return { id: c.id, name: c.name.slice(0, 60), marks, gun: c.gun, host: typeof c.host === 'string' ? c.host.slice(0, 24) : 'Someone', pace: finite(c.pace) ? Math.max(0, Math.min(3, Math.round(c.pace))) : 0 };
}

export const clockText = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

export interface RaceContext {
  sim: Sim;
  world: ReplayWorld;
  passage: Passage;
  fleet: Fleet;
  spec: YardBoat;
  scene: THREE.Scene;
  logbook: Logbook;
  skipper: string;
  boatName: string;
  /** A passing remark, an alarm that needs the player, and word that someone has called a race. */
  say(text: string): void;
  alarm(text: string): void;
  invite(from: string, text: string): void;
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

  constructor(private readonly ctx: RaceContext) {}

  private get now(): number {
    return this.ctx.world.seasonTime(this.ctx.sim.state.t);
  }

  /** Seconds until the gun. Negative once it has gone. */
  get countdown(): number {
    return this.call ? this.call.gun - this.now : 0;
  }

  /** Seconds since the gun. */
  get elapsed(): number {
    return this.call ? this.now - this.call.gun : 0;
  }

  get nextMark(): RaceMark | null {
    return this.call?.marks[this.leg] ?? null;
  }

  /** Call a race and enter it. Everyone on the water is told. */
  callRace(course: { name: string; marks: RaceMark[] }, minutes: number, pace: number): void {
    const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
    const call: RaceCall = {
      id, name: course.name.slice(0, 60), marks: course.marks.slice(0, 12).map((m) => ({ name: m.name.slice(0, 28), x: Math.round(m.x), y: Math.round(m.y) })),
      gun: Math.round(this.now + minutes * 60), host: this.ctx.skipper || this.ctx.boatName || 'A skipper', pace: Math.max(0, Math.min(3, pace)),
    };
    this.join(call, true);
  }

  join(call: RaceCall, mine = false): void {
    this.leave(true);
    const { sim, passage, world, spec, scene } = this.ctx;
    this.call = call;
    this.mine = mine;
    this.started = false;
    this.finish = null;
    this.leg = 0;
    this.place = 0;
    this.called.clear();
    this.offers.delete(call.id);
    this.legStart = { x: sim.state.x, y: sim.state.y };
    passage.setRoute(call.marks, sim.state, sim.state.t);
    for (let i = 0; i < call.pace; i++) this.pacers.push(new PaceBoat(i, spec, world, scene, call.marks));
    const start = call.marks[0];
    this.ctx.say(`${mine ? 'Race called' : 'Race joined'}: ${call.name}. Gun in ${clockText(this.countdown)}. Be at ${start.name} when it goes`);
    this.version++;
  }

  /** Give the race up. The route stays on the chart. */
  leave(quiet = false): void {
    if (!this.call) return;
    for (const p of this.pacers) p.dispose();
    this.pacers = [];
    this.call = null;
    this.mine = false;
    this.started = false;
    this.finish = null;
    if (!quiet) this.ctx.say('Out of the race');
    this.version++;
  }

  /** What to tell the room: the race this boat has called, the one she is in, and how she is doing. */
  wire(): Record<string, unknown> {
    return {
      rc: this.mine && this.call ? this.call : null,
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
    if (!this.started) {
      for (const mark of [300, 120, 60, 30, 10]) {
        if (left <= mark && left > mark - 5 && !this.called.has(mark)) {
          this.called.add(mark);
          this.ctx.say(mark >= 60 ? `${mark / 60} minute${mark > 60 ? 's' : ''} to the gun` : `${mark} seconds`);
        }
      }
      this.toGo = Math.hypot(call.marks[0].x - sim.state.x, call.marks[0].y - sim.state.y);
      if (left <= 0) {
        this.started = true;
        this.leg = 0;
        this.legStart = { x: sim.state.x, y: sim.state.y };
        // The course goes back on the chart from here, so the start mark has to be passed after the gun.
        passage.setRoute(call.marks, sim.state, sim.state.t);
        for (const p of this.pacers) p.start(sim.state.tick);
        this.ctx.alarm(this.toGo < 400 ? `Gun! Racing. First mark ${call.marks[0].name}` : `Gun! You are ${(this.toGo / 1852).toFixed(1)} miles from the start mark, ${call.marks[0].name}. Pass it to begin`);
        this.version++;
      }
      return;
    }
    if (this.finish !== null) return;
    const next = call.marks[this.leg];
    const fix = trackFix(sim.state, this.legStart, next);
    this.toGo = fix.toGo;
    const legLength = Math.hypot(next.x - this.legStart.x, next.y - this.legStart.y);
    if (fix.toGo < ARRIVAL || (fix.along > legLength && fix.toGo < ARRIVAL * 4)) {
      this.leg++;
      this.legStart = { x: next.x, y: next.y };
      this.version++;
      if (this.leg >= call.marks.length) {
        this.finish = this.elapsed;
        this.toGo = 0;
        const table = this.standings();
        this.place = table.findIndex((s) => s.me) + 1;
        this.ctx.logbook.count('races');
        if (this.place === 1 && table.length > 1) this.ctx.logbook.count('wins');
        this.ctx.alarm(`Finished ${call.name} in ${clockText(this.finish)}. ${table.length > 1 ? `${ORDINAL[this.place - 1] ?? `${this.place}th`} of ${table.length}` : 'A time to beat'}`);
      }
    }
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
    for (const id of this.offers.keys()) {
      if (!live.has(id)) {
        this.offers.delete(id);
        this.version++;
      }
    }
  }

  /** Everyone in this race, leader first. */
  standings(): Standing[] {
    const call = this.call;
    if (!call) return [];
    const rows: Standing[] = [{ name: this.ctx.skipper || 'You', boat: this.ctx.boatName, me: true, pace: false, leg: this.leg, toGo: this.toGo, finish: this.finish }];
    for (const b of this.ctx.fleet.boats) {
      if (b.raceId !== call.id) continue;
      rows.push({ name: b.name || 'A skipper', boat: b.boatName, me: false, pace: false, leg: b.raceLeg, toGo: b.raceToGo, finish: b.raceFinish > 0 ? b.raceFinish : null });
    }
    for (const p of this.pacers) rows.push({ name: p.skipper, boat: p.name, me: false, pace: true, leg: p.leg, toGo: p.toGo, finish: p.finish });
    return rows.sort((a, b) => {
      if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
      return b.leg - a.leg || a.toGo - b.toGo;
    });
  }

  /** One line for the bar under the clock. */
  line(): string {
    const call = this.call;
    if (!call) {
      const offer = [...this.offers.values()].find((o) => o.gun > this.now);
      return offer ? `${offer.host} calls a race · gun in ${clockText(offer.gun - this.now)} · R to join` : '';
    }
    if (!this.started) return `Race · gun in ${clockText(this.countdown)} · start at ${call.marks[0].name}`;
    const table = this.standings();
    const place = table.findIndex((s) => s.me) + 1;
    const pos = table.length > 1 ? ` · ${ORDINAL[place - 1] ?? place} of ${table.length}` : '';
    if (this.finish !== null) return `Finished in ${clockText(this.finish)}${pos}`;
    return `Racing ${clockText(this.elapsed)}${pos} · next ${this.nextMark?.name ?? ''}`;
  }

  /** The pace boats, for the chart and the collision watch. */
  vessels(): TrafficVessel[] {
    return this.pacers.map((p, i) => ({ id: `pace-${i}`, name: p.name, kind: 'sail', x: p.sim.state.x, y: p.sim.state.y, heading: p.sim.state.heading, sog: p.sim.out.sog, length: p.length, beam: p.length / 3 }));
  }

  draw(seaTime: number, waves: Wave[], dt: number, camera: THREE.Camera, width: number, height: number): void {
    for (const p of this.pacers) p.draw(seaTime, waves, dt, camera, width, height);
  }
}

export const speedText = (ms: number) => `${(ms / KT).toFixed(1)} kt`;
