/**
 * The skipper's logbook: miles, hours and the rest, added up across every sail.
 * It always keeps a copy on this device. On the shared page it is also saved to the page's database under the
 * person's own id, where the rest of the fleet can read it. This is the seed of experience points and accounts.
 */
export interface LogTotals {
  miles: number;
  hours: number;
  sails: number;
  marks: number;
  tacks: number;
  knockdowns: number;
  topKt: number;
}

export interface Profile {
  skipper: string;
  boat: string;
  boatName: string;
  colour: string;
  log: LogTotals;
  updated: string;
}

interface DocSnap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
interface Db {
  doc(path: string): { get(): Promise<DocSnap>; set(data: Record<string, unknown>): Promise<void> };
  collection(path: string): { onSnapshot(next: (s: { docs: DocSnap[] }) => void, error?: (e: unknown) => void): () => void };
}

const SAVED = 'regatta.log';
const ZERO: LogTotals = { miles: 0, hours: 0, sails: 0, marks: 0, tacks: 0, knockdowns: 0, topKt: 0 };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const clean = (l: Partial<LogTotals> | undefined): LogTotals => ({
  miles: num(l?.miles), hours: num(l?.hours), sails: num(l?.sails), marks: num(l?.marks), tacks: num(l?.tacks), knockdowns: num(l?.knockdowns), topKt: num(l?.topKt),
});

export class Logbook {
  totals: LogTotals = { ...ZERO };
  /** Everyone's profiles, newest first, where the shared page provides them. */
  fleet: Array<Profile & { id: string; me: boolean }> = [];
  private db: Db | null = null;
  private uid: string | null = null;
  private who = { skipper: '', boat: '', boatName: '', colour: '' };
  private dirty = false;
  private saving = false;
  private sinceSave = 0;
  onFleet: () => void = () => {};

  constructor() {
    try {
      this.totals = clean(JSON.parse(localStorage.getItem(SAVED) ?? '{}') as Partial<LogTotals>);
    } catch { /* start a fresh book */ }
    void this.connect();
    window.addEventListener('pagehide', () => this.keep());
  }

  private async connect(): Promise<void> {
    try {
      const claude = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
      if (!claude?.use) return;
      const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
      this.uid = (await (user as { id(): Promise<string | null> } | null)?.id()) ?? null;
      if (!db || !this.uid) return;
      this.db = db as Db;
      // If this person has sailed on another device, carry on from whichever book has more in it.
      const snap = await this.db.doc(`profiles/${this.uid}`).get();
      const theirs = snap.exists ? clean((snap.data()?.log ?? {}) as Partial<LogTotals>) : ZERO;
      if (theirs.miles > this.totals.miles) this.totals = theirs;
      this.db.collection('profiles').onSnapshot((s) => {
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
  }

  count(what: 'marks' | 'tacks' | 'knockdowns', n = 1): void {
    this.totals[what] += n;
    this.dirty = true;
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
      log: { miles: r(t.miles, 100), hours: r(t.hours, 100), sails: t.sails, marks: t.marks, tacks: t.tacks, knockdowns: t.knockdowns, topKt: r(t.topKt, 10) },
      updated: new Date().toISOString(),
    };
    this.db.doc(`profiles/${this.uid}`).set(body as unknown as Record<string, unknown>).catch(() => { this.db = null; }).finally(() => { this.saving = false; this.dirty = false; });
  }

  private tick = 0;
}
