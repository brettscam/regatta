/**
 * Taken by hand off the bottom: rock scallops and urchins on Catalina's reef, conch on the islands' sand, and the
 * abalone that may only be looked at. Who is where is worked out from the site and the half hour, like the fish;
 * whether she may take one is the same teaching mix of reach, season, size, bag and reserve. Pure, for tests.
 */
import { hash01 } from './catch';
import { DIVE_POINTS, LIFE_RADIUS, nameKey, type DiveFile, type DiveZone, type Diver, type Ground, type HandSpec } from './diveRules';
import type { Award } from '../xp/score';

export interface HandThing {
  index: number;
  spec: HandSpec;
  x: number; y: number; d: number;
  cm: number;
  /** Which way it lies, for the picture. */
  heading: number;
  mode: 'there' | 'taken';
}

/** The things on the bottom for one half hour: on rock or on sand as each kind keeps, more of them at a good site. */
export function handTargetsAt(file: DiveFile, ground: Ground, cx: number, cy: number, shift: number): HandThing[] {
  const site = ground.site;
  if (!file.hand?.length) return [];
  const key = (site ? nameKey(site.id) : hash01(Math.floor(cx / 250), Math.floor(cy / 250), 40) * 1e6) + 29;
  const out: HandThing[] = [];
  let index = 0;
  for (const spec of file.hand) {
    const sk = nameKey(spec.id);
    const n = site ? Math.round(spec.common * (0.5 + hash01(key, shift, sk, 601))) : hash01(key, shift, sk, 602) < 0.3 ? 1 : 0;
    for (let i = 0; i < n; i++, index++) {
      let x = cx;
      let y = cy;
      let ok = false;
      for (let attempt = 0; attempt < 16 && !ok; attempt++) {
        const a = hash01(key, shift, index, 610 + attempt) * Math.PI * 2;
        const far = 3 + (LIFE_RADIUS - 5) * Math.sqrt(hash01(key, shift, index, 630 + attempt));
        x = cx + Math.sin(a) * far;
        y = cy + Math.cos(a) * far;
        const rock = ground.rock(x, y);
        const d = ground.floor(x, y);
        ok = d > 1.5 && (spec.on === 'rock' ? rock > 0.55 : rock < 0.25);
      }
      if (!ok) continue;
      const [lo, hi] = spec.size;
      out.push({ index, spec, x, y, d: ground.floor(x, y) - 0.04, cm: Math.round(lo + (hi - lo) * Math.pow(hash01(key, shift, index, 603), 1.3)), heading: hash01(key, shift, index, 604) * Math.PI * 2, mode: 'there' });
    }
  }
  return out;
}

export const HAND = {
  /** Arm's length, metres, and the most she can be moving, m/s, to work something off the rock. */
  reach: 1.0,
  slow: 0.6,
  /** Points for one taken, and the first of a kind ever. */
  points: 3,
  find: 6,
} as const;

export interface HandVerdict {
  ok: boolean;
  why: 'far' | 'fast' | 'kept' | 'protected' | 'reserve' | 'limit' | 'short';
  say: string;
  awards: Award[];
}

/**
 * A hand for one of them. Too far or too fast and nothing happens. A protected kind (abalone) is a find to look at,
 * and taking it is a citation; nothing comes out of a reserve; then the size and the day's bag.
 * @param aboard how many of this kind are in the bag already
 * @param first true if she has never taken one before
 */
export function takeByHand(t: HandThing, diver: Diver, aboard: number, zone: DiveZone | null, first: boolean): HandVerdict {
  const spec = t.spec;
  if (t.mode !== 'there' || Math.hypot(t.x - diver.x, t.y - diver.y, t.d - diver.d) > HAND.reach) return { ok: false, why: 'far', say: 'Not quite in reach. Closer, and slowly', awards: [] };
  if (Math.hypot(diver.vx, diver.vy, diver.vd) > HAND.slow) return { ok: false, why: 'fast', say: 'Too fast to get a hand to it. Stop, settle, then G', awards: [] };
  if (spec.protected) return { ok: false, why: 'protected', say: `${spec.protected}. Taking it is a citation: it goes back on the rock`, awards: [{ kind: 'lost', points: DIVE_POINTS.citation, label: `Citation: ${spec.name}` }] };
  if (zone) return { ok: false, why: 'reserve', say: `${zone.say}. It stays where it is`, awards: [] };
  if (spec.minCm !== undefined && t.cm < spec.minCm) return { ok: false, why: 'short', say: `${t.cm} cm: under the ${spec.minCm} cm it has to be. Back it goes to grow`, awards: [] };
  if (spec.bag !== undefined && aboard >= spec.bag) return { ok: false, why: 'limit', say: `That is ${spec.bag}, the day's limit of ${spec.name}. Leave the rest`, awards: [] };
  const awards: Award[] = [{ kind: 'dive', points: HAND.points, label: `A ${spec.name} by hand` }];
  if (first) awards.push({ kind: 'dive', points: HAND.find, label: `First ${spec.name}` });
  return { ok: true, why: 'kept', say: `A ${spec.name}, ${t.cm} cm, in the bag${spec.bag ? `: ${aboard + 1} of ${spec.bag}` : ''}`, awards };
}
