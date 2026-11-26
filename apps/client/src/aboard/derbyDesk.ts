import { ORDINAL } from '../race/race';
import {
  derbyFromQuery, derbyRivals, elapsedOf, fixDerby, formatWords, isOpen, makeDerby, nextWeekly, packEntry, placeXp, readDerby, readEntry, rivalFish, stageOf, standings,
  type DerbyCall, type DerbyFish, type DerbyRow, type DerbyStage, type DerbyStanding, type Format,
} from '../fishing/derby';
import type { Landed } from '../fishing/points';
import type { FishTable } from '../fishing/table';
import type { AboardContext } from './feature';

/** Seconds after lines-out before places are final here: time for the other boats' last fish to arrive. */
const SETTLE = 12;

/**
 * The tournament desk: which fishing tournaments are on offer, the one this boat is in, her fish in it, and the
 * leaderboard. The rules and the checking are the pure `fishing/derby.ts`; this is the part that listens to the other
 * boats and tells the player. It is owned by the fishing feature, which draws it on the fishing card.
 */
export class DerbyDesk {
  /** Tournaments that can be joined, by id. */
  readonly offers = new Map<string, DerbyCall>();
  /** The one this boat is in. */
  call: DerbyCall | null = null;
  /** Her fish in it. */
  fish: DerbyFish[] = [];
  /** Set once the lines are out and the places are final. */
  result: { place: number; field: number; xp: number } | null = null;
  /** One she has fixed for later or was sent a link to, to pass on to the other boats. */
  fixed: DerbyCall | null = null;
  /** Goes up whenever what is on offer changes, so the card knows to redraw. */
  version = 0;
  private stage: DerbyStage = 'before';
  private readonly told = new Set<string>();
  private clock = 0;

  constructor(private readonly ctx: AboardContext, private readonly table: FishTable, private readonly water: string, private readonly onPlaced: (place: number, field: number, xp: number, won: boolean) => void) {
    try {
      this.fixed = derbyFromQuery(location.search, water, table);
    } catch { /* no address to read */ }
  }

  /** Seconds since lines in for a tournament. */
  elapsed(call: DerbyCall): number {
    return elapsedOf(call, this.ctx.seasonNow());
  }

  get stageNow(): DerbyStage | null {
    return this.call ? stageOf(this.call, this.elapsed(this.call)) : null;
  }

  /** Call one now: lines in after a few minutes of the clock every boat here shares. */
  callNow(fmt: Format, len: number, inMinutes: number, rivals: number, sp?: string): void {
    const call = makeDerby(this.water, this.ctx.skipper, fmt, len, this.ctx.seasonNow() + inMinutes * 60, rivals, sp);
    this.offers.set(call.id, call);
    this.join(call.id);
  }

  /** Fix one for a time on the real clock. Other boats here are told; a link carries it to anyone else. */
  fix(fmt: Format, len: number, atMs: number, rivals: number, sp?: string): DerbyCall {
    const me = this.ctx.skipper.trim();
    this.fixed = fixDerby(this.water, fmt, len, atMs, rivals, me ? `${me}'s tournament` : 'Tournament', sp);
    this.version++;
    return this.fixed;
  }

  join(id: string): void {
    const call = this.offers.get(id);
    if (!call) return;
    this.call = call;
    this.fish = [];
    this.result = null;
    this.stage = stageOf(call, this.elapsed(call));
    this.version++;
    const e = this.elapsed(call);
    this.ctx.say(e < 0 ? `You are in: ${formatWords(call, this.table)}. Lines in in ${Math.ceil(-e / 60)} min` : `You are in: ${formatWords(call, this.table)}. Lines are in, ${Math.ceil((call.len * 60 - e) / 60)} min to go`, 7);
  }

  leave(): void {
    this.call = null;
    this.fish = [];
    this.result = null;
    this.version++;
  }

  /** A fish has come over the rail. It counts if the lines are in. */
  landed(l: Landed): void {
    const call = this.call;
    if (!call || l.fate === 'poached') return;
    const e = this.elapsed(call);
    if (stageOf(call, e) !== 'fishing') return;
    this.fish.push({ id: l.id, cm: l.cm, kept: l.fate === 'kept', m: Math.floor(e / 60) });
    this.version++;
  }

  /** Everyone in a tournament, best first: this boat, the other people in it, and the club's skippers. */
  board(call: DerbyCall | null = this.call): DerbyStanding[] {
    if (!call) return [];
    const e = this.elapsed(call);
    const rows: DerbyRow[] = [];
    if (this.call?.id === call.id) rows.push({ name: this.ctx.skipper || 'You', boat: this.ctx.livery.name ?? '', me: true, rival: false, fish: this.fish });
    for (const b of this.ctx.company()) {
      if (!b.fishWire || b.fishWire.fj !== call.id) continue;
      rows.push({ name: b.name || 'A skipper', boat: b.boatName || '', me: false, rival: false, fish: readEntry(b.fishWire.fe, this.table, call, e / 60) });
    }
    for (const r of derbyRivals(call)) rows.push({ name: r.who.skipper, boat: r.who.boat, me: false, rival: true, fish: rivalFish(call, this.table, r, e) });
    return standings(call, this.table, rows);
  }

  /** Once a frame. Looks round about once a second. */
  update(dt: number): void {
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = 1;
    const live = new Set<string>();
    const offer = (call: DerbyCall, from: string): void => {
      const e = this.elapsed(call);
      // Worth offering from half an hour before lines-in until the lines come out.
      if (e < -1800 || e > call.len * 60 || !isOpen(call)) return;
      live.add(call.id);
      if (!this.offers.has(call.id)) {
        this.offers.set(call.id, call);
        this.version++;
      }
      if (!this.told.has(call.id) && this.call?.id !== call.id) {
        this.told.add(call.id);
        this.ctx.heard(from, `calls a fishing tournament: ${formatWords(call, this.table).toLowerCase()}. ${e < 0 ? `Lines in in ${Math.ceil(-e / 60)} min` : 'Lines are in'}. Shift+L to join`);
      }
    };
    for (const b of this.ctx.company()) {
      const call = b.fishWire ? readDerby(b.fishWire.fc, this.water, this.table) : null;
      if (call) offer(call, b.name || call.host);
    }
    if (this.fixed) offer(this.fixed, this.fixed.host);
    const weekly = nextWeekly(this.water);
    if (weekly) offer(weekly, weekly.host);
    if (this.call) live.add(this.call.id);
    for (const id of [...this.offers.keys()]) {
      if (!live.has(id)) {
        this.offers.delete(id);
        this.version++;
      }
    }

    const call = this.call;
    if (!call) return;
    const e = this.elapsed(call);
    const stage = stageOf(call, e);
    if (stage !== this.stage) {
      this.stage = stage;
      this.version++;
      if (stage === 'fishing') this.ctx.alarm(`Lines in. ${formatWords(call, this.table)}. L puts a line over`);
      else if (stage === 'over') this.ctx.alarm('Lines out. The weigh-in is on the fishing card, Shift+L');
    }
    if (stage === 'over' && !this.result && e > call.len * 60 + SETTLE) {
      const table = this.board(call);
      const mine = table.find((r) => r.me);
      const field = table.length;
      const place = mine?.place ?? field;
      const xp = mine ? placeXp(place, field, mine.score) : 0;
      this.result = { place, field, xp };
      this.version++;
      this.onPlaced(place, field, xp, place === 1 && (mine?.score ?? 0) > 0 && field > 1);
    }
  }

  /** One line for the instruments: how long is left, and where she stands. */
  line(): string {
    const call = this.call;
    if (!call) return '';
    const e = this.elapsed(call);
    const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
    if (e < 0) return `Tournament: lines in in ${clock(-e)}`;
    const table = this.board(call);
    const mine = table.find((r) => r.me);
    const where = mine && mine.score > 0 ? `${ORDINAL[mine.place - 1] ?? `${mine.place}th`} of ${table.length}` : `no fish yet, ${table.length} in it`;
    if (e < call.len * 60) return `Tournament: ${clock(call.len * 60 - e)} left · ${where}`;
    return `Tournament over · ${where}`;
  }

  /** What goes to the other boats: a tournament to pass on, the one she is in, and her fish. */
  wire(): Record<string, unknown> {
    const pass = this.call ?? this.fixed;
    if (!pass) return {};
    const out: Record<string, unknown> = { fc: pass };
    if (this.call) {
      out.fj = this.call.id;
      out.fe = packEntry(this.table, this.fish);
    }
    return out;
  }
}
