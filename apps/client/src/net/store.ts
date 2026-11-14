/**
 * The page's small shared database, for votes on the roadmap and for feedback.
 * It comes from `platform.ts`. On the published claude.ai page only people the page is shared with as contributors
 * can write. On the website anyone can read the votes, and writing needs a sign-in. Anywhere else every call here
 * quietly does nothing, and the screens that use it say so.
 */

import { account as askAccount, db as askDb, onWeb, user as askUser, type Db } from './platform';

export interface FeedbackEntry {
  /** feedback, problem or idea */
  kind: string;
  text: string;
  /** ISO time it was sent. */
  at: string;
  /** What the boat was doing, if the sender chose to include it. */
  context?: Record<string, unknown>;
}

export type Tally = Record<string, { up: number; down: number }>;

export class Store {
  private db: Db | null = null;
  private uid: string | null = null;
  /** True, false, or null when the platform has not said. */
  private mayWrite: boolean | null = null;
  private myVotes: Record<string, number> = {};
  private mine: FeedbackEntry[] = [];
  private writing: Promise<unknown> = Promise.resolve();
  readonly ready: Promise<void>;
  /** Called on the website after this person has signed in or out and the store has caught up. */
  onAccount: () => void = () => {};

  constructor() {
    this.ready = this.connect();
    // On the website a person can sign in or out while the page is open. Then everything is asked for again.
    void askAccount().then((a) => a?.onChange(() => { void this.connect().then(() => this.onAccount()); })).catch(() => {});
  }

  private async connect(): Promise<void> {
    try {
      const [db, u] = await Promise.all([askDb(), askUser()]);
      this.uid = (await u?.id()) ?? null;
      this.mayWrite = (await u?.can('data.write')) ?? null;
      this.myVotes = {};
      this.mine = [];
      // On the website the votes can be read by anyone. Everywhere else the database is for people who are signed in.
      this.db = db && (this.uid || onWeb()) ? db : null;
    } catch {
      this.db = null;
    }
  }

  /** This person is known to the platform: signed in, on the website. */
  get signedIn(): boolean {
    return this.uid !== null;
  }

  /** There is a database to read. */
  get online(): boolean {
    return this.db !== null;
  }

  /** This person can vote and send feedback. Unknown counts as yes until a write is refused. */
  get canWrite(): boolean {
    return this.db !== null && this.mayWrite !== false;
  }

  vote(item: string): number {
    return this.myVotes[item] ?? 0;
  }

  /** Follow everyone's votes. Calls back with the totals whenever they change. */
  watchVotes(onTally: (tally: Tally) => void): () => void {
    if (!this.db) return () => {};
    return this.db.collection('votes').onSnapshot((snap) => {
      const tally: Tally = {};
      for (const d of snap.docs) {
        const v = (d.data()?.v ?? {}) as Record<string, unknown>;
        if (d.id === this.uid) {
          this.myVotes = {};
          for (const [k, n] of Object.entries(v)) if (n === 1 || n === -1) this.myVotes[k] = n;
        }
        for (const [k, n] of Object.entries(v)) {
          if (n !== 1 && n !== -1) continue;
          tally[k] ??= { up: 0, down: 0 };
          if (n === 1) tally[k].up++;
          else tally[k].down++;
        }
      }
      onTally(tally);
    }, () => {});
  }

  /** One write at a time, each after the last has landed. */
  private queue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.writing.then(job, job);
    this.writing = next.catch(() => {});
    return next;
  }

  /** Vote an item up (1), down (-1) or take the vote back (0). Resolves false if it could not be saved. */
  setVote(item: string, value: number): Promise<boolean> {
    if (!this.db || !this.uid) return Promise.resolve(false);
    if (value === 0) delete this.myVotes[item];
    else this.myVotes[item] = value;
    const body = { v: { ...this.myVotes } };
    return this.queue(async () => {
      try {
        await this.db!.doc(`votes/${this.uid}`).set(body);
        return true;
      } catch {
        this.mayWrite = false;
        return false;
      }
    });
  }

  /** What this person has sent before. */
  async myFeedback(): Promise<FeedbackEntry[]> {
    if (!this.db || !this.uid) return [];
    try {
      const snap = await this.db.doc(`feedback/${this.uid}`).get();
      const items = snap.exists ? snap.data()?.items : null;
      this.mine = Array.isArray(items) ? (items as FeedbackEntry[]) : [];
    } catch {
      this.mine = [];
    }
    return this.mine;
  }

  /** Send a note to the people building the game. Resolves false if it could not be saved. */
  sendFeedback(entry: FeedbackEntry): Promise<boolean> {
    if (!this.db || !this.uid) return Promise.resolve(false);
    return this.queue(async () => {
      try {
        await this.myFeedback();
        // Keep the newest two hundred. One document per person holds them all.
        const items = [...this.mine, entry].slice(-200);
        await this.db!.doc(`feedback/${this.uid}`).set({ items, updated: entry.at });
        this.mine = items;
        return true;
      } catch {
        this.mayWrite = false;
        return false;
      }
    });
  }
}
