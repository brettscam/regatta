/**
 * Choosing voices for the radio from whatever the browser has (`speechSynthesis.getVoices()`). Pure: a list of
 * voices in, a choice out, so it can be tested without a browser.
 *
 * - Voices are ranked. The natural, neural, premium and enhanced ones and the ones a browser fetches from its maker
 *   come first; the plain ones that come with a device next; the robotic and the joke voices are never used.
 *   Only English voices count, from any part of the world.
 * - The best few make up the pool. Each vessel is given one of the pool for good, from a hash of her name, with her
 *   own pitch and pace inside what suits her job, so she is the same voice every time she calls.
 * - A caller may ask for a voice from a part of the world ("en-GB") and gets one if the pool has it.
 * - The callers known beforehand (the ferries, the ship, the coast station) are cast together so that no two share
 *   a voice while there are voices to go round.
 */

/** As much of a `SpeechSynthesisVoice` as is read here. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

/** What a caller does, which sets how she speaks. */
export type Role = 'master' | 'pilot' | 'station' | 'skipper';

/** Pitch and pace for each job: lowest and highest of each. The speech API takes 0 to 2 for pitch, 1 is the voice as made. */
export const DELIVERY: Record<Role, { pitch: [number, number]; rate: [number, number] }> = {
  /** A ferry's master: brisk, level, said a thousand times. */
  master: { pitch: [0.88, 1.02], rate: [1.06, 1.16] },
  /** A ship's pilot: low and unhurried. */
  pilot: { pitch: [0.7, 0.84], rate: [0.92, 1.0] },
  /** The coast station: clear and measured. */
  station: { pitch: [1.0, 1.1], rate: [0.94, 1.0] },
  /** A yacht's skipper: anybody at all. */
  skipper: { pitch: [0.78, 1.28], rate: [0.96, 1.14] },
};

/** Voices made as jokes or effects, and the old robotic sets. Never used. */
const NEVER = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|wobble|good news|hysterical|jester|organ|superstar|trinoids|whisper|zarvox|fred|junior|kathy|princess|ralph|bruce|agnes|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|espeak|pico|festival|flite)\b/i;
/** Apple's ordinary voices, which are good, and Microsoft's older desktop ones, which will do. */
const GOOD = /\b(samantha|daniel|karen|moira|tessa|rishi|alex|ava|allison|susan|tom|evan|nathan|zoe|serena|kate|oliver|fiona|lee|matilda|arthur|martha|nicky|aaron|catherine|gordon|stephanie|isha|sangeeta)\b/i;
const FAIR = /\b(david|zira|mark|hazel|george|heera|ravi|catherine|james|linda|richard|sean)\b/i;

const langOf = (v: VoiceLike): string => v.lang.replace('_', '-').toLowerCase();

/** How good a voice is for the radio. Below zero it is never used. */
export function voiceScore(v: VoiceLike): number {
  if (!langOf(v).startsWith('en')) return -1;
  const name = v.name;
  if (NEVER.test(name) || /compact/i.test(name)) return -1;
  let score = 10;
  if (/natural|neural/i.test(name)) score += 40;
  else if (/premium/i.test(name)) score += 32;
  else if (/enhanced/i.test(name)) score += 26;
  else if (/siri/i.test(name)) score += 22;
  else if (/^google\b/i.test(name)) score += 22;
  else if (GOOD.test(name)) score += 12;
  else if (FAIR.test(name)) score += 6;
  // A voice the browser fetches is nearly always better than what the device carries.
  if (v.localService === false) score += 8;
  const lang = langOf(v);
  if (lang === 'en-us' || lang === 'en-gb') score += 2;
  return score;
}

/** How far below the best a voice may score and still be used, and the most voices in the pool. */
const POOL_WITHIN = 22;
const POOL_MOST = 10;

/** The voices worth using, best first: the best one and those near it. Empty when the browser has no English voice fit to use. */
export function rankVoices<T extends VoiceLike>(voices: readonly T[]): T[] {
  const scored = voices.map((v, i) => ({ v, i, s: voiceScore(v) })).filter((e) => e.s >= 0);
  if (!scored.length) return [];
  // Same score: by name, so the order does not depend on the order the browser lists them in.
  scored.sort((a, b) => b.s - a.s || a.v.name.localeCompare(b.v.name) || a.i - b.i);
  const best = scored[0].s;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of scored) {
    if (e.s < best - POOL_WITHIN || out.length >= POOL_MOST) break;
    // Some browsers list a voice twice.
    const key = `${e.v.name}|${langOf(e.v)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e.v);
  }
  return out;
}

/** A number from 0 to 1 that depends only on the text. */
export function textHash(text: string, salt = 0): number {
  let h = (2166136261 ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export interface Casting<T> {
  /** Null when the browser has no voice to give: the call is written out and not spoken. */
  voice: T | null;
  lang: string;
  pitch: number;
  rate: number;
}

export interface Caller {
  /** What her voice is hashed from: her id. */
  key: string;
  role: Role;
  accent?: string;
}

function delivery(key: string, role: Role, spread: number): { pitch: number; rate: number } {
  const d = DELIVERY[role];
  const mid = (d.pitch[0] + d.pitch[1]) / 2;
  const half = ((d.pitch[1] - d.pitch[0]) / 2) * spread;
  return {
    pitch: Math.round((mid - half + 2 * half * textHash(key, 11)) * 100) / 100,
    rate: Math.round((d.rate[0] + (d.rate[1] - d.rate[0]) * textHash(key, 12)) * 100) / 100,
  };
}

/** The voices of the pool a caller may be given: those of her part of the world if she asked and there are any. */
function eligible<T extends VoiceLike>(pool: readonly T[], accent?: string): readonly T[] {
  if (!accent) return pool;
  const want = accent.toLowerCase();
  const exact = pool.filter((v) => langOf(v) === want);
  return exact.length ? exact : pool;
}

/**
 * The voice one caller speaks with: always the same for the same caller and the same list of voices.
 * @param pool from `rankVoices`
 * @param taken voices other callers already have, avoided while another is free
 */
export function castVoice<T extends VoiceLike>(pool: readonly T[], caller: Caller, taken?: ReadonlySet<T>): Casting<T> {
  // With one voice or two, pitch has to do the work of telling callers apart: use more of it.
  const spread = pool.length <= 2 ? 1.6 : 1;
  const { pitch, rate } = delivery(caller.key, caller.role, spread);
  if (!pool.length) return { voice: null, lang: 'en-US', pitch, rate };
  const from = eligible(pool, caller.accent);
  const start = Math.floor(textHash(caller.key, 10) * from.length);
  let voice = from[start];
  if (taken) {
    for (let k = 0; k < from.length; k++) {
      const v = from[(start + k) % from.length];
      if (!taken.has(v)) {
        voice = v;
        break;
      }
    }
  }
  return { voice, lang: voice.lang.replace('_', '-'), pitch, rate };
}

/** Cast the callers known beforehand so that no two share a voice while the pool lasts. In the order given. */
export function castAll<T extends VoiceLike>(pool: readonly T[], callers: readonly Caller[]): Map<string, Casting<T>> {
  const out = new Map<string, Casting<T>>();
  const taken = new Set<T>();
  for (const c of callers) {
    const cast = castVoice(pool, c, taken);
    if (cast.voice) taken.add(cast.voice);
    out.set(c.key, cast);
  }
  return out;
}

/** What the player is likely to hear, in a few words, for the console: "6 voices: Google UK English Female, ...". */
export function describePool(pool: readonly VoiceLike[]): string {
  return pool.length ? `${pool.length} ${pool.length === 1 ? 'voice' : 'voices'}: ${pool.map((v) => `${v.name} (${v.lang})`).join(', ')}` : 'no English voice';
}
