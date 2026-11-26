/**
 * Fishing tournaments: the call, what goes between boats, the scoring for each format, and the club skippers who
 * fish it too. Pure: nothing here touches the screen, and nothing is left to chance. A club skipper's catch is
 * worked out from the tournament's id, so every page gives her the same fish at the same minute.
 *
 * Honesty: each page lands its own fish and tells the others what it caught. Nothing checks that. What is checked is
 * that the report is possible: known species, lengths the species reaches, no more fish than the cap, no catch in the
 * future, no kept fish that could not legally be kept. Weights and points are always worked out here from the
 * length, never taken from the wire. That is the same trust a race's finish times rest on.
 */
import { hash01 } from '../aboard/catch';
import { LEVELS, drawEntrants, hashText, type Entrant } from '../race/cast';
import derbiesJson from '../data/derbies.json';
import { lengthOf, weightOf } from './bites';
import { landedPoints, type Fate } from './points';
import { speciesOf, type FishSpecies, type FishTable } from './table';

export type Format = 'points' | 'big' | 'three' | 'species' | 'jackpot';

export const FORMATS: Array<{ id: Format; name: string; say: string }> = [
  { id: 'points', name: 'Most points', say: 'Every fish scores by its size for its kind, kept or let go. Most points when the lines come out.' },
  { id: 'big', name: 'Biggest fish', say: 'One fish wins it: the heaviest of legal size, by the tape, so a fish let go still counts.' },
  { id: 'three', name: 'Heaviest three', say: 'The three heaviest fish in the box at the scale. Only kept fish weigh in, and limits apply.' },
  { id: 'species', name: 'One species', say: 'Only one kind of fish counts. Most points of it wins.' },
  { id: 'jackpot', name: 'Jackpot', say: 'The single biggest fish of the jackpot species takes it all.' },
];

/** Lengths offered, minutes of fishing, and the most rivals from the club. */
export const LENGTHS = [20, 40, 60];
export const MAX_RIVALS = 6;
/** The most fish one boat can enter. Past this only her best count. */
export const MAX_FISH = 24;
/** Minutes before lines-in that a tournament on the real clock opens for joining. */
export const OPENS_BEFORE = 25;

export interface DerbyCall {
  id: string;
  name: string;
  host: string;
  /** The water it is fished on: a course id. */
  water: string;
  fmt: Format;
  /** The species that counts, for `species`. A jackpot's comes from the water's table. */
  sp?: string;
  /** Lines in, seconds of the season. */
  in: number;
  /** Minutes of fishing. */
  len: number;
  /** For a tournament fixed on the real clock: lines in, milliseconds since 1970. The window then runs on the real clock. */
  at?: number;
  /** Club skippers fishing it too. */
  rivals: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const SAFE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isFormat = (v: unknown): v is Format => FORMATS.some((f) => f.id === v);
const cleanName = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.replace(/[<>&"]/g, '').trim().slice(0, 48) : fallback);

/** The species a tournament is fished for, where it is fished for one. */
export function targetOf(call: Pick<DerbyCall, 'fmt' | 'sp'>, table: FishTable): FishSpecies | null {
  if (call.fmt === 'jackpot') return speciesOf(table, table.jackpot) ?? null;
  if (call.fmt === 'species') return (call.sp && speciesOf(table, call.sp)) || null;
  return null;
}

/** A tournament in a few words: "Most points, 40 minutes". */
export function formatWords(call: Pick<DerbyCall, 'fmt' | 'sp' | 'len'>, table: FishTable): string {
  const t = targetOf(call, table);
  const what = call.fmt === 'species' ? `${t?.name ?? 'one species'} only` : call.fmt === 'jackpot' ? `${t?.name ?? ''} jackpot`.trim() : (FORMATS.find((f) => f.id === call.fmt)?.name ?? '').toLowerCase();
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}, ${call.len} minutes`;
}

/** A tournament called now, to start on the season clock every boat on the water shares. */
export function makeDerby(water: string, host: string, fmt: Format, len: number, linesIn: number, rivals: number, sp?: string): DerbyCall {
  const call: DerbyCall = { id: `d-${water}-${fmt}-${Math.round(linesIn)}-${len}`.slice(0, 40), name: `${host || 'A skipper'}'s tournament`, host: host.slice(0, 24) || 'Someone', water, fmt, in: Math.round(linesIn), len, rivals: Math.max(0, Math.min(MAX_RIVALS, Math.round(rivals))) };
  if (fmt === 'species' && sp) call.sp = sp;
  return call;
}

/** A tournament fixed for a time on the real clock. The same facts always give the same id, so every page agrees. */
export function fixDerby(water: string, fmt: Format, len: number, atMs: number, rivals: number, name = 'Tournament', sp?: string): DerbyCall {
  const minute = Math.round(atMs / 60e3);
  const call: DerbyCall = { id: `dx-${water}-${fmt}-${minute}-${len}`.slice(0, 40), name: name.slice(0, 48), host: 'The weighmaster', water, fmt, in: 0, len, at: minute * 60e3, rivals: Math.max(0, Math.min(MAX_RIVALS, Math.round(rivals))) };
  if (fmt === 'species' && sp) call.sp = sp;
  return call;
}

/**
 * A tournament as another page sent it, or as a link carried it. Nothing in it is trusted until it has been through here.
 * @param table the fishing of the water this page is on: a call for a species it does not have is refused
 */
export function readDerby(v: unknown, water: string, table: FishTable, nowMs = Date.now()): DerbyCall | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  if (typeof c.id !== 'string' || !SAFE.test(c.id) || !isFormat(c.fmt) || c.water !== water) return null;
  const len = finite(c.len) ? Math.round(c.len) : NaN;
  if (!(len >= 5 && len <= 180)) return null;
  const rivals = finite(c.rivals) ? Math.max(0, Math.min(MAX_RIVALS, Math.round(c.rivals))) : 0;
  const sp = typeof c.sp === 'string' && speciesOf(table, c.sp) ? c.sp : undefined;
  if (c.fmt === 'species' && !sp) return null;
  if (finite(c.at)) {
    // Nothing more than a week off, and nothing long over.
    if (c.at - nowMs > 7 * 86400e3 || nowMs - c.at > (len + 30) * 60e3) return null;
    return fixDerby(water, c.fmt, len, c.at, rivals, cleanName(c.name, 'Tournament'), sp);
  }
  if (!finite(c.in) || c.in < 0 || c.in > 60 * 86400) return null;
  const call: DerbyCall = { id: c.id, name: cleanName(c.name, 'Tournament'), host: cleanName(c.host, 'Someone').slice(0, 24), water, fmt: c.fmt, in: Math.round(c.in), len, rivals };
  if (sp && c.fmt === 'species') call.sp = sp;
  return call;
}

/** Seconds since lines in: negative before, more than `len * 60` once the lines are out. */
export function elapsedOf(call: DerbyCall, seasonNow: number, nowMs = Date.now()): number {
  return call.at !== undefined ? (nowMs - call.at) / 1000 : seasonNow - call.in;
}

export type DerbyStage = 'before' | 'fishing' | 'over';
export const stageOf = (call: DerbyCall, elapsed: number): DerbyStage => (elapsed < 0 ? 'before' : elapsed < call.len * 60 ? 'fishing' : 'over');

// ---- links and the calendar ---------------------------------------------------------------------------------------

/** The link that carries a fixed tournament: open it and the tournament is there. */
export function derbyLink(call: DerbyCall, base: string): string {
  const q = new URLSearchParams({ derby: call.fmt, at: String(call.at ?? 0), len: String(call.len), water: call.water });
  if (call.sp) q.set('sp', call.sp);
  if (call.rivals) q.set('riv', String(call.rivals));
  if (call.name && call.name !== 'Tournament') q.set('dn', call.name);
  return `${base}?${q.toString()}`;
}

/** The tournament a page address carries, if it carries one for this water: `?derby=<format>&at=<ms>&len=<minutes>&water=<id>`. */
export function derbyFromQuery(search: string, water: string, table: FishTable, nowMs = Date.now()): DerbyCall | null {
  const q = new URLSearchParams(search);
  if (!q.has('derby')) return null;
  const at = Number(q.get('at'));
  return readDerby({ id: 'dx-link', fmt: q.get('derby'), at: Number.isFinite(at) && at > 0 ? at : NaN, len: Number(q.get('len') ?? 40), water: q.get('water') ?? '', sp: q.get('sp') ?? undefined, rivals: Number(q.get('riv') ?? 0), name: q.get('dn') ?? undefined }, water, table, nowMs);
}

interface Weekly { id: string; name: string; water: string; fmt: Format; len: number; dow: number; utc: string; rivals?: number; sp?: string }

/** The calendar's tournament for this water that is open now or next to come within a day, if any. */
export function nextWeekly(water: string, nowMs = Date.now(), list: Weekly[] = (derbiesJson as { weekly: Weekly[] }).weekly): DerbyCall | null {
  let best: DerbyCall | null = null;
  for (const w of list) {
    if (w.water !== water || !isFormat(w.fmt)) continue;
    const [h, m] = w.utc.split(':').map(Number);
    const d = new Date(nowMs);
    // The occurrence this week, then the one before and after, and take the one whose window we are in or coming to.
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ((w.dow - d.getUTCDay() + 7) % 7), h, m);
    for (const at of [base - 7 * 86400e3, base]) {
      if (nowMs - at > w.len * 60e3 || at - nowMs > 86400e3) continue;
      if (!best || at < best.at!) best = fixDerby(water, w.fmt, w.len, at, w.rivals ?? 4, w.name, w.sp);
    }
  }
  return best;
}

/** True once a real-clock tournament can be joined: from a while before lines-in until lines-out. */
export const isOpen = (call: DerbyCall, nowMs = Date.now()): boolean => call.at === undefined || (call.at - nowMs <= OPENS_BEFORE * 60e3 && nowMs - call.at < call.len * 60e3);

// ---- the catch, on the wire and at the scale ------------------------------------------------------------------------

/** One fish entered: what, how long, whether it is in the box, and the minute of the tournament it was landed in. */
export interface DerbyFish { id: string; cm: number; kept: boolean; m: number }

/** What may be said of a fish entered, by the rules: it cannot be `kept` if it could not legally be. */
function fateOf(sp: FishSpecies, f: DerbyFish): Fate {
  if (sp.protected) return 'protected';
  if (sp.minCm !== undefined && f.cm < sp.minCm) return 'short';
  return f.kept ? 'kept' : 'released';
}

const fishPoints = (table: FishTable, f: DerbyFish): number => {
  const sp = speciesOf(table, f.id);
  return sp ? landedPoints(sp, f.cm, fateOf(sp, f)) : 0;
};

/** A boat's fish as they go on the wire: her best `MAX_FISH`, each as [species, cm, kept, minute]. */
export function packEntry(table: FishTable, fish: DerbyFish[]): unknown[] {
  const best = fish.length > MAX_FISH ? [...fish].sort((a, b) => fishPoints(table, b) - fishPoints(table, a)).slice(0, MAX_FISH) : fish;
  return best.map((f) => [f.id, f.cm, f.kept ? 1 : 0, f.m]);
}

/**
 * A boat's fish as another page sent them. Whatever is not possible is dropped: an unknown species, a length the
 * species does not reach, a catch outside the tournament or later than now, more than two fish in one minute, more
 * fish than the cap. A fish said to be kept that could not legally be (short, protected, over the limit) counts as let go.
 * @param elapsedMin minutes since lines in, now
 */
export function readEntry(v: unknown, table: FishTable, call: DerbyCall, elapsedMin: number): DerbyFish[] {
  if (!Array.isArray(v)) return [];
  const out: DerbyFish[] = [];
  const perMinute = new Map<number, number>();
  const aboard = new Map<string, number>();
  const latest = Math.min(call.len, elapsedMin + 1);
  for (const raw of v.slice(0, MAX_FISH * 2)) {
    if (out.length >= MAX_FISH) break;
    if (!Array.isArray(raw) || typeof raw[0] !== 'string' || !finite(raw[1]) || !finite(raw[3])) continue;
    const sp = speciesOf(table, raw[0]);
    const cm = Math.round(raw[1]);
    const m = Math.floor(raw[3]);
    if (!sp || cm < sp.size[0] || cm > sp.trophyCm || m < 0 || m > latest) continue;
    const n = perMinute.get(m) ?? 0;
    if (n >= 2) continue;
    perMinute.set(m, n + 1);
    const had = aboard.get(sp.id) ?? 0;
    const kept = raw[2] === 1 && !sp.protected && !(sp.minCm !== undefined && cm < sp.minCm) && !(sp.bag !== undefined && had >= sp.bag);
    if (kept) aboard.set(sp.id, had + 1);
    out.push({ id: sp.id, cm, kept, m });
  }
  return out;
}

export interface DerbyScore {
  /** What decides it: kilograms for the weight formats, points for the others. 0 with nothing that counts. */
  score: number;
  unit: 'kg' | 'points';
  /** Fish that count towards it, and the best of them. */
  n: number;
  best: { name: string; cm: number; kg: number } | null;
  /** The minute of her last fish that counts: the earlier breaks a tie. */
  last: number;
}

/** A boat's score in a tournament, from her fish. */
export function scoreOf(call: Pick<DerbyCall, 'fmt' | 'sp'>, table: FishTable, fish: DerbyFish[]): DerbyScore {
  const target = targetOf(call, table);
  const counted: Array<{ sp: FishSpecies; f: DerbyFish; kg: number; pts: number }> = [];
  for (const f of fish) {
    const sp = speciesOf(table, f.id);
    if (!sp || (target && sp.id !== target.id)) continue;
    const fate = fateOf(sp, f);
    // The weight formats are for fish of legal size that may be taken. Heaviest three is weighed from the box.
    if (call.fmt !== 'points' && call.fmt !== 'species' && (fate === 'short' || fate === 'protected')) continue;
    if (call.fmt === 'three' && fate !== 'kept') continue;
    counted.push({ sp, f, kg: weightOf(sp, f.cm), pts: landedPoints(sp, f.cm, fate) });
  }
  const byWeight = call.fmt === 'big' || call.fmt === 'three' || call.fmt === 'jackpot';
  counted.sort((a, b) => (byWeight ? b.kg - a.kg : b.pts - a.pts));
  const used = call.fmt === 'three' ? counted.slice(0, 3) : byWeight ? counted.slice(0, 1) : counted;
  const top = used[0];
  return {
    score: byWeight ? Math.round(used.reduce((s, c) => s + c.kg, 0) * 100) / 100 : used.reduce((s, c) => s + c.pts, 0),
    unit: byWeight ? 'kg' : 'points', n: used.length,
    best: top ? { name: top.sp.name, cm: top.f.cm, kg: top.kg } : null,
    last: used.reduce((m, c) => Math.max(m, c.f.m), 0),
  };
}

export interface DerbyRow { name: string; boat: string; me: boolean; rival: boolean; fish: DerbyFish[] }
export interface DerbyStanding extends DerbyRow, DerbyScore { place: number }

/** The leaderboard: best score first, a tie going to whoever had hers first, and boats with nothing last. */
export function standings(call: Pick<DerbyCall, 'fmt' | 'sp'>, table: FishTable, rows: DerbyRow[]): DerbyStanding[] {
  return rows.map((r) => ({ ...r, ...scoreOf(call, table, r.fish), place: 0 }))
    .sort((a, b) => b.score - a.score || (a.score > 0 ? a.last - b.last : 0) || a.name.localeCompare(b.name))
    .map((r, i) => ({ ...r, place: i + 1 }));
}

/** Experience for a place at the weigh-in. Nothing for a boat with no fish, or with nobody to beat. */
export function placeXp(place: number, field: number, score: number): number {
  if (!(score > 0) || field < 2) return 0;
  if (place === 1) return 30 + 10 * Math.min(5, field - 1);
  if (place === 2 && field >= 3) return 25;
  if (place === 3 && field >= 4) return 15;
  return 5;
}

// ---- the club -------------------------------------------------------------------------------------------------------

/** A club skipper tries her luck once in each spell this long, minutes. */
const RIVAL_SPELL = 4;

/** How good a skipper is with a rod, 0 to 1, from her standing in the club: the ringer 1, out for the sunset 0. */
export const rodSkill = (e: Entrant): number => 1 - LEVELS.findIndex((l) => l.id === e.level.id) / Math.max(1, LEVELS.length - 1);

/** The club skippers in a tournament: the same ones on every page, drawn from its id. */
export const derbyRivals = (call: DerbyCall): Entrant[] => drawEntrants(call.id, call.rivals, 'mixed');

/**
 * What a club skipper has landed so far. Better skippers get more bites, more of the fish worth having, and bigger
 * ones, but anyone can have the day's best fish. In a tournament for one species she fishes for that alone, and
 * a scarce species comes seldom.
 * @param elapsedS seconds since lines in
 */
export function rivalFish(call: DerbyCall, table: FishTable, e: Entrant, elapsedS: number): DerbyFish[] {
  const skill = rodSkill(e);
  const target = targetOf(call, table);
  const pool = table.rivals.map((r) => ({ sp: speciesOf(table, r.id), w: r.w })).filter((r): r is { sp: FishSpecies; w: number } => !!r.sp);
  const sum = pool.reduce((s, r) => s + r.w, 0);
  if (!pool.length || !(sum > 0)) return [];
  const share = target ? (pool.find((r) => r.sp.id === target.id)?.w ?? 0) / sum : 1;
  if (target && share <= 0) return [];
  const odds = ((0.3 + 0.42 * skill) / e.form) * (target ? Math.min(1, 0.2 + 2.6 * share) : 1);
  const out: DerbyFish[] = [];
  const aboard = new Map<string, number>();
  const spells = Math.floor(Math.min(elapsedS, call.len * 60) / (RIVAL_SPELL * 60) + 1);
  for (let i = 0; i < spells; i++) {
    if (hash01(e.seed, i, 371) >= odds) continue;
    const m = i * RIVAL_SPELL + Math.floor(hash01(e.seed, i, 372) * RIVAL_SPELL);
    if (m * 60 > elapsedS || m >= call.len) continue;
    let sp = target;
    if (!sp) {
      // A good skipper spends more of her time on the fish worth more.
      const weights = pool.map((r) => r.w * Math.pow(r.sp.worth / 300, 0.6 * skill));
      let pick = hash01(e.seed, i, 373) * weights.reduce((s, w) => s + w, 0);
      sp = pool[pool.length - 1].sp;
      for (let k = 0; k < pool.length; k++) {
        pick -= weights[k];
        if (pick < 0) { sp = pool[k].sp; break; }
      }
    }
    const cm = lengthOf(sp, Math.pow(hash01(e.seed, i, 374), 1 - 0.3 * skill), hash01(e.seed, i, 375));
    const had = aboard.get(sp.id) ?? 0;
    const kept = !sp.protected && !(sp.minCm !== undefined && cm < sp.minCm) && !(sp.bag !== undefined && had >= sp.bag);
    if (kept) aboard.set(sp.id, had + 1);
    out.push({ id: sp.id, cm, kept, m });
  }
  return out;
}

/** A number for a tournament's id, for anything that wants a seed from it. */
export const derbySeed = (call: DerbyCall): number => hashText(call.id);
