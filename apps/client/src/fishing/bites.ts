/**
 * What bites, when, and how big, on a water that has its own fishing table. Pure: every answer comes from where the
 * boat is, what she is doing, the hour, the tide and a hash, so two boats side by side at the same moment hook the
 * same fish, and a test can pin all of it. The rules are meant to be learned: `advice` and `whySlow` say them out loud.
 */
import { hash01, lowLight } from '../aboard/catch';
import { SKIP_KT, TROLL_MIN_KT, band, type Spot } from './grounds';
import { LURES, RIGS, type FishSpecies, type FishTable, type Habitat, type LureId, type RigId } from './table';

/** The clock is cut into spells this long, and each spell either brings a bite or does not. */
export const BITE_SPELL = 20;
/** Seconds between bites, on average, when the fishing is fair. */
export const FAIR_WAIT = 540;
/** A bait or a jig put in front of fish that are up and feeding is taken this much sooner. */
export const CAST_GAIN = 1.4;
/** One fish in this many runs past the usual size, towards the biggest there is. */
export const TROPHY_ODDS = 0.035;
/** A boat with two rods out has half as many bites again. */
export const SECOND_ROD = 1.5;
/** A patch of water that has given up a fish gives fewer for this long, seconds. */
export const TIRED_FOR = 1800;

/** The patch of water a place is in, 250 m across: what `biteIn` hashes on, and what tires. */
export const patchOf = (x: number, y: number): string => `${Math.floor(x / 250)},${Math.floor(y / 250)}`;

/**
 * How much of its bite a patch has left, 1 fresh to about a third when it has been hammered: the biters get caught
 * and the rest wise up, so a boat that sits on one spot all day does worse than one that moves. Each fish hooked
 * counts for less as the half hour after it goes by.
 * @param hooks season times of the fish this boat has hooked in the patch
 */
export function freshness(hooks: readonly number[] | undefined, now: number): number {
  let n = 0;
  for (const t of hooks ?? []) n += Math.max(0, 1 - Math.abs(now - t) / TIRED_FOR);
  return 1 / (1 + 0.4 * n);
}

export type Way = 'troll' | 'skip' | RigId;

/** What she is fishing with. */
export interface Tackle {
  lure: LureId;
  rig: RigId;
  /** Live baits in the tank. */
  bait: number;
  /** Rods she can fish at once: one over a sailing boat's stern, two from a powerboat's holders. */
  rods: number;
}

const dark = (hour: number) => hour < 4.5 || hour > 21.5;

/** How the line is fishing: towing a lure, or a bait, a jig or squid under a stopped boat. With no live bait the bait rod fishes the iron. */
export function wayOf(spot: Spot, tackle: Tackle): Way {
  if (!spot.held && spot.speedKt >= TROLL_MIN_KT) return spot.speedKt > SKIP_KT ? 'skip' : 'troll';
  return tackle.rig === 'bait' && tackle.bait <= 0 ? 'iron' : tackle.rig;
}

/** How well this water suits a fish, 0 to 1, and the kind of water that suits it best. */
function home(sp: FishSpecies, spot: Spot, way: Way): { score: number; kind: Habitat | null } {
  let score = 0;
  let kind: Habitat | null = null;
  for (const [k, like] of Object.entries(sp.habitat) as Array<[Habitat, number]>) {
    // Open water holds fish thinly, here and there: only a lure that covers miles of it finds them. A bait hung under
    // a stopped boat in the middle of nowhere does not.
    if ((k === 'channel' || k === 'offshore') && way !== 'troll') continue;
    const v = like * (spot.hab[k] ?? 0);
    if (v > score) { score = v; kind = k; }
  }
  // Fish that live on the legs of a platform, or under a paddy, do not care how deep the water under them is.
  if (sp.depth && score > 0) score *= band(spot.depth, ...sp.depth);
  return { score, kind };
}

const lightOf = (sp: FishSpecies, hour: number) => (dark(hour) ? sp.night : sp.light + (1 - sp.light) * lowLight(hour));
const tideOf = (sp: FishSpecies, spot: Spot) => (sp.tide === 'moving' ? 0.4 + 0.6 * band(Math.abs(spot.tideRate), 0.02, 0.1, 9, 10) : 1);
/** A bait for a fish of the sand wants to cover ground at a quarter of a knot to a knot and a half. Lying to an anchor it covers none. */
const driftOf = (sp: FishSpecies, spot: Spot) => (!sp.driftOnly ? 1 : spot.held ? 0.55 : 0.55 + 0.45 * band(spot.sogKt, 0.05, 0.25, 1.5, 2.4));

/** How keen a fish is to bite here, fished this way. About 1 is fair fishing, 0 never. */
export function keenOf(sp: FishSpecies, spot: Spot, way: Way, lure: LureId): number {
  if (way === 'skip' || spot.reserve || spot.platform?.inside) return 0;
  if (sp.months && !sp.months.includes(spot.month)) return 0;
  const how = way === 'troll' ? (sp.troll ? band(spot.speedKt, ...sp.troll.kt) * (sp.troll.lures[lure] ?? 0) : 0) : (sp.ways[way] ?? 0);
  if (how <= 0) return 0;
  return home(sp, spot, way).score * how * lightOf(sp, spot.hour) * tideOf(sp, spot) * driftOf(sp, spot);
}

export interface Prospect { species: FishSpecies; keen: number }

/** Everything that might bite here fished this way, keenest first. */
export function prospects(table: FishTable, spot: Spot, tackle: Tackle, way: Way = wayOf(spot, tackle)): Prospect[] {
  return table.species.map((species) => ({ species, keen: keenOf(species, spot, way, tackle.lure) })).filter((p) => p.keen > 0.012).sort((a, b) => b.keen - a.keen);
}

const total = (on: Prospect[]) => on.reduce((sum, p) => sum + p.keen, 0);

/** Average seconds between bites here, or Infinity if nothing will bite. */
export function typicalWait(table: FishTable, spot: Spot, tackle: Tackle, fresh = 1): number {
  const way = wayOf(spot, tackle);
  const t = total(prospects(table, spot, tackle, way)) * (way === 'troll' && tackle.rods > 1 ? SECOND_ROD : 1) * (spot.casting ? CAST_GAIN : 1) * fresh;
  return t > 0 ? FAIR_WAIT / t : Infinity;
}

/** A length for a fish of this kind from two numbers 0 to 1: mostly the smaller end of its range, now and then a trophy. */
export function lengthOf(sp: FishSpecies, u: number, v: number): number {
  const [lo, hi] = sp.size;
  if (v < TROPHY_ODDS) return Math.round(hi + (sp.trophyCm - hi) * Math.pow(u, 1.8));
  return Math.round(lo + (hi - lo) * Math.pow(u, 1.6));
}

export const weightOf = (sp: FishSpecies, cm: number): number => sp.kgPerCm3 * cm * cm * cm;

/** A fish on the line, before anyone knows whether it will be landed. */
export interface Hooked {
  species: FishSpecies;
  cm: number;
  kg: number;
  way: Way;
  /** Fixed by where and when it bit: the fight is drawn from it. */
  seed: number;
}

/**
 * Whether a fish takes in one spell of the clock, and which. `spell` is the season time divided by `BITE_SPELL`,
 * rounded down. The boat's place counts in patches 250 m across.
 * @param fresh how much of its bite this patch has left for this boat: see `freshness`
 */
export function biteIn(table: FishTable, spot: Spot, tackle: Tackle, spell: number, fresh = 1): Hooked | null {
  const way = wayOf(spot, tackle);
  const on = prospects(table, spot, tackle, way);
  const sum = total(on);
  if (!(sum > 0)) return null;
  const cx = Math.floor(spot.x / 250);
  const cy = Math.floor(spot.y / 250);
  const rate = sum * (way === 'troll' && tackle.rods > 1 ? SECOND_ROD : 1) * (spot.casting ? CAST_GAIN : 1) * fresh;
  if (hash01(spell, cx, cy, 331) >= Math.min(0.5, (rate * BITE_SPELL) / FAIR_WAIT)) return null;
  let pick = hash01(spell, cx, cy, 332) * sum;
  let species = on[on.length - 1].species;
  for (const p of on) {
    pick -= p.keen;
    if (pick < 0) { species = p.species; break; }
  }
  const cm = lengthOf(species, hash01(spell, cx, cy, 333), hash01(spell, cx, cy, 334));
  return { species, cm, kg: weightOf(species, cm), way, seed: Math.floor(hash01(spell, cx, cy, 335) * 0x7fffffff) };
}

// ---- what may be kept ----------------------------------------------------------------------------------------

/** What the rules say about a fish at the rail: it may be kept, or why it has to go back. */
export type Ruling = 'keep' | 'small' | 'limit' | 'protected';

/** @param aboard how many of its kind are in the boat already today */
export function rulingOf(sp: FishSpecies, cm: number, aboard: number): Ruling {
  if (sp.protected) return 'protected';
  if (sp.minCm !== undefined && cm < sp.minCm) return 'small';
  if (sp.bag !== undefined && aboard >= sp.bag) return 'limit';
  return 'keep';
}

// ---- saying it ---------------------------------------------------------------------------------------------------

const lureName = (id: LureId) => (LURES.find((l) => l.id === id)?.name ?? 'lures').toLowerCase();
const rigWords: Record<RigId, string> = { bait: 'a live bait', iron: 'the iron', squid: 'squid on the bottom' };
const names = (on: Prospect[], n = 2) => on.slice(0, n).map((p) => p.species.name).join(' and ');
const kt = (v: number) => v.toFixed(1);

/** The speeds a lure fishes at for the fish it is meant for, knots: the slowest that is best for any of them to the fastest. */
export function lureWindow(table: FishTable, lure: LureId): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of table.species) {
    if (!s.troll || (s.troll.lures[lure] ?? 0) < 0.8) continue;
    lo = Math.min(lo, s.troll.kt[1]);
    hi = Math.max(hi, s.troll.kt[2]);
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}

/** Where she is, in a few words. */
export function waterWords(spot: Spot): string {
  if (spot.platform && !spot.platform.inside) return `${Math.round(spot.platform.d / 10) * 10} m off ${spot.platform.p.name}`;
  if (spot.ground) return `on ${spot.ground.name}`;
  if ((spot.hab.channel ?? 0) > 0.5) return 'in the open channel';
  return `in ${Math.round(spot.depth)} m`;
}

/** The other rig or lure that would do much better here, if there is one. */
function better(table: FishTable, spot: Spot, tackle: Tackle, way: Way): string {
  const now = total(prospects(table, spot, tackle, way));
  if (way === 'troll') {
    let best: { id: LureId; sum: number; on: Prospect[] } | null = null;
    for (const l of LURES) {
      if (l.id === tackle.lure) continue;
      const on = prospects(table, spot, { ...tackle, lure: l.id }, way);
      if (!best || total(on) > best.sum) best = { id: l.id, sum: total(on), on };
    }
    return best && best.sum > 0.08 && best.sum > now * 2.2 ? `The ${lureName(best.id)} would do better here, for ${names(best.on, 1)}` : '';
  }
  let best: { id: RigId; sum: number; on: Prospect[] } | null = null;
  for (const r of RIGS) {
    if (r.id === way || (r.id === 'bait' && tackle.bait <= 0)) continue;
    const on = prospects(table, spot, tackle, r.id);
    if (!best || total(on) > best.sum) best = { id: r.id, sum: total(on), on };
  }
  return best && best.sum > 0.08 && best.sum > now * 2.2 ? `${rigWords[best.id].replace(/^./, (c) => c.toUpperCase())} would do better here, for ${names(best.on, 1)}` : '';
}

/**
 * Why little is biting, or what is in her favour, as a fishing skipper would put it. Empty when there is nothing
 * worth saying. Every line is a rule the fish really follow here.
 */
export function whySlow(table: FishTable, spot: Spot, tackle: Tackle, fresh = 1): string {
  const way = wayOf(spot, tackle);
  if (spot.reserve) return spot.reserve.say.replace(/\.$/, '');
  if (spot.platform?.inside) return `Inside the ${spot.platform.p.keepOff} m ring round ${spot.platform.p.name}: nobody fishes or anchors here. Stand off and fish the up-current side`;
  if (way === 'skip') return `At ${kt(spot.speedKt)} kt the lures are skipping on top. Slow to under ${SKIP_KT} kt`;
  if (way === 'troll') {
    const w = lureWindow(table, tackle.lure);
    if (w && spot.speedKt < w[0] - 0.3) return `${kt(spot.speedKt)} kt is slow for the ${lureName(tackle.lure)}: they want ${w[0]} to ${w[1]} kt`;
    if (w && spot.speedKt > w[1] + 0.3) return `${kt(spot.speedKt)} kt is fast for the ${lureName(tackle.lure)}: they want ${w[0]} to ${w[1]} kt`;
    if (dark(spot.hour)) return 'Nothing chases a lure in the dark. Stop over a reef for sand bass and sculpin, or wait for grey light';
    if (spot.school && spot.school.d < 400) return 'Birds are working close by. Tow the lures past the edge of them, not through the middle';
    if (spot.paddy && spot.paddy.d < 400) return spot.paddy.paddy.holding ? 'A kelp paddy close by. Tow the lures past its edge, or stop short and cast' : 'A kelp paddy close by, but nothing is showing under it. Not every paddy holds fish';
    if ((spot.hab.channel ?? 0) < 0.5 && !spot.hab.rocks && !spot.hab.reef && !spot.hab.point && !spot.hab.kelp) return 'Little to tow a lure for in here. The trolling water is outside: the breakwater ends, the reefs, the open channel';
    return better(table, spot, tackle, way) || (lowLight(spot.hour) < 0.3 ? 'The middle of the day is the slow time on the troll. Look for birds and paddies' : '');
  }
  if (tackle.rig === 'bait' && tackle.bait <= 0) return `No live bait aboard, so the rod is fishing the iron. The bait barge is at ${table.grounds.find((g) => g.kind === 'barge') ? 'Alamitos Bay' : 'the marina'}`;
  if (spot.platform && spot.platform.up < 0.35) return `She is on the down-current side of ${spot.platform.p.name}. The fish face the stream on the other side`;
  if (spot.paddy && spot.paddy.d < 200 && !spot.paddy.paddy.holding) return 'Nothing under this paddy. Not every one holds fish: try the next';
  const other = better(table, spot, tackle, way);
  if (other) return other;
  if (fresh < 0.6) return 'She has had the best of this spot. Move a few hundred metres, or rest it for half an hour';
  if (dark(spot.hour)) return 'After dark it is sand bass, croaker and sculpin on the bottom, and little else';
  const moving = prospects(table, { ...spot, tideRate: 0.2 }, tackle, way);
  if (Math.abs(spot.tideRate) < 0.03 && total(moving) > total(prospects(table, spot, tackle, way)) * 1.3) return 'Slack tide. The bass and the halibut feed better once the water starts to move';
  if (spot.casting) return 'Within a cast of the fish. Stay off them: a boat driven through the middle puts them down';
  if ((spot.hab.channel ?? 0) > 0.5 && !Object.entries(spot.hab).some(([k, v]) => k !== 'channel' && k !== 'offshore' && (v ?? 0) > 0)) return 'Deep, open water under her, and nothing to hold fish. Find a platform, a paddy or the birds, or tow a lure';
  if (lowLight(spot.hour) < 0.3 && spot.hab.kelp) return 'The kelp fishes best at first light and again in the evening';
  return '';
}

/** What to expect with the line out here, said when it goes over and when things change. */
export function advice(table: FishTable, spot: Spot, tackle: Tackle, fresh = 1): string {
  const way = wayOf(spot, tackle);
  const why = whySlow(table, spot, tackle, fresh);
  if (spot.reserve || spot.platform?.inside || way === 'skip') return why;
  const on = prospects(table, spot, tackle, way);
  const and = why ? `. ${why}` : '';
  if (way === 'troll') {
    const rods = tackle.rods > 1 ? `${tackle.rods} rods, ` : '';
    if (!on.length) return `Trolling ${rods}${lureName(tackle.lure)} at ${kt(spot.speedKt)} kt ${waterWords(spot)}${and}`;
    return `Trolling ${rods}${lureName(tackle.lure)} at ${kt(spot.speedKt)} kt ${waterWords(spot)} for ${names(on)}${and}`;
  }
  const how = spot.casting ? `Casting ${rigWords[way]}` : `${spot.held ? 'Fishing' : 'Drifting'} ${rigWords[way]}`;
  if (!on.length) return `${how} ${waterWords(spot)}. Nothing here will take it${and}`;
  return `${how} ${waterWords(spot)} for ${names(on)}${and}`;
}

/** The sounder's line: depth, what the bottom is, and how much is showing. True to what `prospects` says. */
export function sounderLine(table: FishTable, spot: Spot, tackle: Tackle): string {
  const bottom = spot.platform && !spot.platform.inside ? 'platform legs' : spot.hab.kelp ? 'rock and kelp' : spot.hab.reef || spot.hab.rocks || spot.hab.point ? 'rock' : spot.hab.flats || spot.hab.cove || spot.hab.harbor ? 'sand' : (spot.hab.channel ?? 0) > 0.5 ? 'no bottom' : 'sand and mud';
  // What is under her, whatever she is fishing with: the best any stopped rig could hope for.
  let most = 0;
  for (const r of RIGS) most = Math.max(most, total(prospects(table, { ...spot, speedKt: 0, sogKt: 0.5 }, { ...tackle, bait: 1 }, r.id)));
  const marks = most > 0.9 ? 'thick marks' : most > 0.45 ? 'good marks' : most > 0.15 ? 'a few marks' : 'nothing showing';
  const depth = spot.depth >= 126 ? 'over 125 m' : `${Math.round(spot.depth)} m`;
  return `${depth} · ${bottom} · ${marks}`;
}
