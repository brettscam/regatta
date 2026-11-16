/**
 * What the club's skippers call across the water during a race: a word at the gun, at a mark, on passing or being
 * passed, at the finish, and after a blunder. Each skipper has her own lines (`data/cast.json`).
 * Pure: what is happening goes in, what is said comes out. Who speaks is hashed from the race, never rolled, and it
 * is kept sparing: one voice at a time, a pause after each, and nobody twice in a minute and a half.
 */
import { hash01 } from '../aboard/catch';
import { hashText, type Entrant, type Occasion } from './cast';

/** Seconds of quiet after anything is said, and before the same skipper speaks again. */
export const BANTER = { pause: 14, each: 90, stale: 20, near: 450, passNear: 350, oopsNear: 700 } as const;

/** A fallback for a skipper with no line of her own for an occasion. */
const PLAIN: Record<Occasion, string> = {
  start: 'Racing!', mark: 'Rounding.', passing: 'Coming through.', passed: 'Well sailed.', finish: 'Finished.', oops: 'Sorry about that.',
};

export const lineFor = (e: Entrant, occasion: Occasion): string => e.who.lines[occasion] ?? PLAIN[occasion];
/** How she is named when she speaks: "Dex, Bullet". */
export const voiceOf = (e: Entrant): string => `${e.who.skipper.split(' ')[0]}, ${e.who.boat}`;

export interface BanterBoat {
  entrant: Entrant;
  x: number;
  y: number;
  leg: number;
  finish: number | null;
  /** Metres left to the finish by the marks. */
  remaining: number;
  blunders: number;
}

export interface BanterInput {
  /** Seconds since the gun. Negative before it. */
  t: number;
  marks: number;
  me: { x: number; y: number; remaining: number; finished: boolean };
  boats: readonly BanterBoat[];
}

export interface Remark { from: string; text: string; occasion: Occasion }

interface Seen { leg: number; finished: boolean; blunders: number; ahead: boolean | null; spoke: number }

export class Banter {
  private readonly seed: number;
  private readonly seen: Seen[] = [];
  private readonly queue: Array<{ i: number; occasion: Occasion; due: number }> = [];
  private quietTo = -Infinity;
  private begun = false;
  private count = 0;

  constructor(raceId: string) {
    this.seed = hashText(raceId);
  }

  private want(i: number, occasion: Occasion, due: number): void {
    if (this.queue.length < 4 && !this.queue.some((q) => q.i === i)) this.queue.push({ i, occasion, due });
  }

  /** Called about once a second. Returns at most one remark. */
  poll(input: BanterInput): Remark | null {
    const { t, me, boats } = input;
    if (t < 0 || !boats.length) return null;
    const chance = (i: number, code: number): number => hash01(this.seed, i, code, this.count++);
    if (!this.begun) {
      this.begun = true;
      // The gun: two voices, the keenest first.
      const order = boats.map((_, i) => i).sort((a, b) => hash01(this.seed, a, 1) - hash01(this.seed, b, 1));
      order.slice(0, Math.min(2, boats.length)).forEach((i, k) => this.want(i, 'start', t + 1 + k * (BANTER.pause + 4)));
    }
    boats.forEach((b, i) => {
      const s = this.seen[i] ?? (this.seen[i] = { leg: b.leg, finished: b.finish !== null, blunders: b.blunders, ahead: null, spoke: -Infinity });
      const range = Math.hypot(b.x - me.x, b.y - me.y);
      if (b.finish !== null && !s.finished) {
        s.finished = true;
        if (chance(i, 2) < 0.75) this.want(i, 'finish', t);
      } else if (b.leg > s.leg && b.leg >= 2 && b.finish === null) {
        if (chance(i, 3) < (range < BANTER.near ? 0.6 : 0.15)) this.want(i, 'mark', t);
      }
      s.leg = b.leg;
      if (b.blunders > s.blunders) {
        s.blunders = b.blunders;
        if (range < BANTER.oopsNear && chance(i, 4) < 0.7) this.want(i, 'oops', t + 3);
      }
      // Who is ahead, with a few lengths of slack so two boats side by side do not keep changing places.
      if (b.finish === null && !me.finished && t > 90) {
        const gap = me.remaining - b.remaining;
        const ahead = s.ahead === null ? gap > 0 : gap > 30 ? true : gap < -30 ? false : s.ahead;
        if (s.ahead !== null && ahead !== s.ahead && range < BANTER.passNear) this.want(i, ahead ? 'passing' : 'passed', t);
        s.ahead = ahead;
      }
    });
    // One at a time, and nothing that has gone stale waiting its turn.
    for (let k = 0; k < this.queue.length; k++) {
      const q = this.queue[k];
      if (t > q.due + BANTER.stale) {
        this.queue.splice(k--, 1);
        continue;
      }
      if (t < q.due || t < this.quietTo || t < this.seen[q.i].spoke + BANTER.each) continue;
      this.queue.splice(k, 1);
      this.quietTo = t + BANTER.pause;
      this.seen[q.i].spoke = t;
      const e = boats[q.i].entrant;
      return { from: voiceOf(e), text: lineFor(e, q.occasion), occasion: q.occasion };
    }
    return null;
  }
}
