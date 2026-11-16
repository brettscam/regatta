/**
 * The club: the skippers who turn out for a race when there are pace boats in it, how good each of them is, and who
 * turns out tonight. All of it is data (`data/cast.json`); nothing here touches the screen or the sim, and nothing is
 * left to chance. Who enters a race is worked out from the race's id, so every player's page names the same boats
 * and gives them the same skill.
 */
import castJson from '../data/cast.json';
import { hash01 } from '../aboard/catch';

export type Mix = 'beer' | 'mixed' | 'hot';
export type Kite = 'yes' | 'shy' | 'never';
export type Occasion = 'start' | 'mark' | 'passing' | 'passed' | 'finish' | 'oops';

/** What a crew of a given standard does wrong. Every figure is the size of a mistake, so the ringer's are all 0. */
export interface Level {
  id: string;
  name: string;
  says: string;
  start: {
    /** Metres short of the start mark she is lying at the gun, least and most. */
    backM: [number, number];
    /** Seconds after the gun before she gets going, least and most. */
    lateS: [number, number];
    /** Knots she is making as she sets off. */
    speedKt: number;
  };
  trim: {
    /** How far out the sheets wander from their best setting, degrees either way: eased is positive, pinned in negative. 0 leaves the trimming to a perfect crew. */
    errDeg: number;
    /** Seconds between looks at the sails. Between looks the sheets stay where they were, whatever the wind has done. */
    lagS: number;
    /** How fast a sheet comes in or goes out, degrees a second. */
    rateDegS: number;
    /** Share of the ease a good crew gives the main in a gust: 1 all of it, 0 the sheet stays cleated. */
    gust: number;
  };
  helm: {
    /** How far the helm wanders either side of the course on a reach or a run, degrees. */
    wanderDeg: number;
    /** How far past the layline she stands on before tacking for a mark, degrees (sometimes she tacks that much short instead). */
    laylineDeg: number;
    /** On a beat, a needless tack about this often, seconds. 0 never. */
    extraTackS: number;
    /** Seconds she carries on past a mark before turning for the next. */
    wideS: number;
  };
  /** Seconds the new jib sheet is left flying after a tack or gybe. */
  fumbleS: number;
  sails: {
    /** Knots more wind than a good crew would take before the reef goes in. */
    reefLateKt: number;
    /** The most reefs she ever takes. 0 never reefs. */
    reefMax: number;
    kite: Kite;
    /** Knots less wind than a good crew before she dares set the spinnaker. */
    kiteShyKt: number;
  };
  /** A blunder about this often, seconds: a luff that stops her, a sheet let fly, a wander off course. 0 never. */
  blunderS: number;
}

export interface Skipper {
  id: string;
  skipper: string;
  boat: string;
  level: string;
  colour: string;
  sail: string;
  character: string;
  lines: Partial<Record<Occasion, string>>;
}

/** A skipper entered in one race: who she is, how good, and the number her luck tonight is drawn from. */
export interface Entrant {
  who: Skipper;
  level: Level;
  /** Fixed by the race and the skipper. Everything she does by chance in this race is hashed from it. */
  seed: number;
  /** Her form tonight, 0.8 a good night to 1.2 a bad one: every mistake of hers is scaled by it. */
  form: number;
}

interface MixSpec { id: Mix; name: string; says: string; weights: Record<string, number> }

const data = castJson as unknown as { levels: Level[]; mixes: MixSpec[]; skippers: Skipper[] };
export const LEVELS: readonly Level[] = data.levels;
export const MIXES: readonly MixSpec[] = data.mixes;
export const CAST: readonly Skipper[] = data.skippers;
/** The most pace boats in one race: ten on the line with the player. */
export const MAX_PACE = 9;

export const levelOf = (id: string): Level => LEVELS.find((l) => l.id === id) ?? LEVELS[Math.floor(LEVELS.length / 2)];

/** A fleet mix as another page sent it. Anything unknown is the mixed fleet. */
export function readMix(v: unknown): Mix {
  return v === 'beer' || v === 'hot' ? v : 'mixed';
}

/** A pace-boat count as another page sent it. */
export function readPace(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(MAX_PACE, Math.round(v))) : 0;
}

/** A whole number fixed by a string: the same on every page. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 0x7fffffff;
}

/**
 * Who turns out for a race. The draw is weighted by the mix and fixed by the race's id, so two pages with the same call
 * name the same boats in the same order. A skipper never enters twice.
 * @param n how many pace boats, 0 to `MAX_PACE`
 */
export function drawEntrants(raceId: string, n: number, mix: Mix = 'mixed'): Entrant[] {
  const count = readPace(n);
  const race = hashText(raceId);
  const weights = (MIXES.find((m) => m.id === mix) ?? MIXES[1]).weights;
  // Each skipper draws a time to turn up, sooner the likelier her kind is in this mix. The first few to turn up race.
  const drawn = CAST.map((who, i) => {
    const w = weights[who.level] ?? 1;
    const u = Math.max(1e-9, hash01(race, i, 11));
    return { who, i, at: w > 0 ? -Math.log(u) / w : Infinity };
  }).sort((a, b) => a.at - b.at || a.i - b.i);
  return drawn.slice(0, count).map(({ who, i }) => {
    const seed = Math.floor(hash01(race, i, 23) * 0x7fffffff);
    return { who, level: levelOf(who.level), seed, form: 0.8 + 0.4 * hash01(seed, 31) };
  });
}

/** An entrant made by hand, for a test or a script: one skipper at a given level. */
export function entrantOf(level: string, seed: number, skipper = 0): Entrant {
  const l = levelOf(level);
  const who = CAST.find((s) => s.level === l.id && skipper-- <= 0) ?? CAST[0];
  return { who, level: l, seed, form: 0.8 + 0.4 * hash01(seed, 31) };
}

/** A number from -1 to 1 that drifts smoothly as `x` goes by, fixed by the seed: the same on every page. */
export function drift(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(seed, i) * 2 - 1;
  const b = hash01(seed, i + 1) * 2 - 1;
  return a + (b - a) * f * f * (3 - 2 * f);
}
