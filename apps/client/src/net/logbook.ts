/**
 * The skipper's logbook: miles, hours and the rest, added up across every sail.
 * It always keeps a copy on this device. On the shared page it is also saved to the page's database under the
 * person's own id, where the rest of the fleet can read it. On the website the same happens once the person has
 * signed in, and anyone can read the fleet's. This is the seed of experience points and accounts.
 */
import { cleanLedger, counted, credit, type Award, type AwardKind, type Rank } from '../xp/score';
import { myAvatarCode } from '../boat/avatar';
import { account as askAccount, db as askDb, onWeb, user as askUser, type Db } from './platform';

export interface LogTotals {
  miles: number;
  hours: number;
  sails: number;
  marks: number;
  tacks: number;
  knockdowns: number;
  topKt: number;
  /** Races finished, and races won. */
  races: number;
  wins: number;
  /** Crab and fish landed, nights spent at anchor or on a mooring, and places gone ashore at. */
  crabs: number;
  fish: number;
  nights: number;
  ashore: number;
  /** Kinds of animal seen for the first time. */
  seen: number;
  /** Experience points, and what earned them by kind. Books saved before there were points load as zero. */
  xp: number;
  xpBy: Partial<Record<AwardKind, number>>;
}

export interface Profile {
  skipper: string;
  boat: string;
  boatName: string;
  colour: string;
  /** The skipper's figure, as `boat/avatar.ts` writes it. Check it with `readAvatar` before use. */
  avatar?: string;
  log: LogTotals;
  updated: string;
}

const SAVED = 'regatta.log';
const ZERO: LogTotals = { miles: 0, hours: 0, sails: 0, marks: 0, tacks: 0, knockdowns: 0, topKt: 0, races: 0, wins: 0, crabs: 0, fish: 0, nights: 0, ashore: 0, seen: 0, xp: 0, xpBy: {} };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const clean = (l: Partial<LogTotals> | undefined): LogTotals => ({
  miles: num(l?.miles), hours: num(l?.hours), sails: num(l?.sails), marks: num(l?.marks), tacks: num(l?.tacks), knockdowns: num(l?.knockdowns), topKt: num(l?.topKt),
  races: num(l?.races), wins: num(l?.wins), crabs: num(l?.crabs), fish: num(l?.fish), nights: num(l?.nights), ashore: num(l?.ashore), seen: num(l?.seen),
  ...cleanLedger(l),
});

export class Logbook {
  totals: LogTotals = clean({});
  /** Everyone's profiles, newest first, where the shared page provides them. */
  fleet: Array<Profile & { id: string; me: boolean }> = [];
  private db: Db | null = null;
  private uid: string | null = null;
  private who = { skipper: '', boat: '', boatName: '', colour: '' };
  private dirty = false;
  private saving = false;
  private sinceSave = 0;
  onFleet: () => void = () => {};
  /** Told of every award as it is earned, and of the rank it gained if it gained one. */
  onAward: (award: Award, rank: Rank | null) => void = () => {};
  /** Seconds logged so far this visit, and when each counter last earned points, so a counter cannot be run up for them. */
  private logged = 0;
  private readonly earnedAt = new Map<string, number>();

  constructor() {
    try {
      this.totals = clean(JSON.parse(localStorage.getItem(SAVED) ?? '{}') as Partial<LogTotals>);
    } catch { /* start a fresh book */ }
    void this.connect();
    window.addEventListener('pagehide', () => this.keep());
    // On the website a person can sign in or out while the page is open. The book is then connected again,
    // and a book just signed in to is saved at the next chance instead of after the usual few minutes.
    void askAccount().then((a) => a?.onChange(() => {
      void this.connect().then(() => {
        if (this.uid) {
          this.sinceSave = 120;
          this.dirty = true;
        }
        this.onFleet();
      });
    })).catch(() => {});
  }

  private unwatch: () => void = () => {};

  private async connect(): Promise<void> {
    try {
      const [db, user] = await Promise.all([askDb(), askUser()]);
      this.uid = (await user?.id()) ?? null;
      // On the website the fleet's books can be read by anyone. Everywhere else they are for people who are signed in.
      if (!db || (!this.uid && !onWeb())) return;
      this.db = db;
      if (this.uid) {
        // If this person has sailed on another device, carry on from whichever book has more in it.
        const snap = await this.db.doc(`profiles/${this.uid}`).get();
        const theirs = snap.exists ? clean((snap.data()?.log ?? {}) as Partial<LogTotals>) : ZERO;
        if (theirs.miles > this.totals.miles) this.totals = theirs;
      }
      this.unwatch();
      this.unwatch = this.db.collection('profiles').onSnapshot((s) => {
        this.fleet = s.docs.map((d) => {
          const p = (d.data() ?? {}) as Partial<Profile>;
          return {
            id: d.id, me: d.id === this.uid,
            skipper: String(p.skipper ?? '').slice(0, 20), boat: String(p.boat ?? ''), boatName: String(p.boatName ?? '').slice(0, 24), colour: String(p.colour ?? ''),
            log: clean(p.log), updated: String(p.updated ?? ''),
          };
        }).sort((a, b) => b.log.miles - a.log.miles);
        this.onFleet();
      }, () => {});
    } catch {
      this.db = null;
    }
  }

  /** Who is sailing and in what, for the shared profile. */
  identify(skipper: string, boat: string, boatName: string, colour: string): void {
    this.who = { skipper, boat, boatName, colour };
    this.totals.sails++;
    this.dirty = true;
  }

  /** Add what has just been sailed. Call every frame with sim seconds and metres covered. */
  add(seconds: number, metres: number, speedKt: number): void {
    if (!(seconds > 0) || !Number.isFinite(metres)) return;
    this.totals.hours += seconds / 3600;
    this.totals.miles += metres / 1852;
    if (speedKt > this.totals.topKt && speedKt < 40) this.totals.topKt = speedKt;
    this.dirty = true;
    this.sinceSave += seconds;
    this.logged += seconds;
  }

  count(what: 'marks' | 'tacks' | 'knockdowns' | 'races' | 'wins' | 'crabs' | 'fish' | 'nights' | 'ashore' | 'seen', n = 1): void {
    this.totals[what] += n;
    this.dirty = true;
    // Some of what is counted here is seamanship, and earns points. The sizes are in `xp/score.ts`.
    const award = counted(what, n, this.logged - (this.earnedAt.get(what) ?? -1e9));
    if (!award) return;
    this.earnedAt.set(what, this.logged);
    this.earn(award);
  }

  /** Add experience points, or take a few away. They never go below zero. */
  earn(award: Award): void {
    const rank = credit(this.totals, award);
    this.dirty = true;
    this.onAward(award, rank);
  }

  private keep(): void {
    try {
      localStorage.setItem(SAVED, JSON.stringify(this.totals));
    } catch { /* nothing to keep it in */ }
  }

  /** Save now and then: to this device often, to the shared page every few minutes of sailing. */
  update(realSeconds: number): void {
    this.tick += realSeconds;
    if (!this.dirty || this.tick < 20) return;
    this.tick = 0;
    this.keep();
    if (!this.db || !this.uid || this.saving || this.sinceSave < 120) return;
    this.sinceSave = 0;
    this.saving = true;
    const r = (n: number, d: number) => Math.round(n * d) / d;
    const t = this.totals;
    const body: Profile = {
      ...this.who,
      avatar: myAvatarCode(),
      log: { ...t, xpBy: { ...t.xpBy }, miles: r(t.miles, 100), hours: r(t.hours, 100), topKt: r(t.topKt, 10) },
      updated: new Date().toISOString(),
    };
    this.db.doc(`profiles/${this.uid}`).set(body as unknown as Record<string, unknown>).catch(() => { this.db = null; }).finally(() => { this.saving = false; this.dirty = false; });
  }

  private tick = 0;
}
