import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db, DocRef, DocSnap, QuerySnap } from '../platform';

/**
 * The website's document store: three Postgres tables, `votes`, `feedback` and `profiles`, each with one row per
 * signed-in person (`uid`) and the document as the game writes it in a JSON column (`doc`). A path is
 * `<table>/<uid>`. Who may read and write what is decided by row-level security in the database
 * (supabase/migrations), not here: this only asks.
 *
 * Following a collection is done by asking again every half minute for the rows changed since the last look,
 * while the page is visible. That is cheaper than Realtime's database changes, which would count against the same
 * message allowance the boats use, and nothing here needs to be quicker. A person's own write shows at once.
 */

const TABLES = new Set(['votes', 'feedback', 'profiles']);
const POLL = 30000;
/** Rows are asked for again from a little before the newest one seen, in case two were saved in the same moment. */
const OVERLAP = 5000;
const PAGE = 1000;

type Doc = Record<string, unknown>;
interface Row { uid: string; doc: Doc | null; updated_at: string }
type Fail = (e: { code: string }) => void;

const fail = (e: unknown): { code: string } => ({ code: String((e as { code?: unknown } | null)?.code ?? 'unavailable') });
const snap = (id: string, doc: Doc | undefined): DocSnap => ({ id, exists: doc !== undefined, data: () => doc });

class Collection {
  private readonly rows = new Map<string, Doc>();
  private readonly watchers = new Set<{ next: (s: QuerySnap) => void; error?: Fail }>();
  private newest = '';
  private loaded = false;
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly client: SupabaseClient, readonly table: string) {}

  watch(next: (s: QuerySnap) => void, error?: Fail): () => void {
    const w = { next, error };
    this.watchers.add(w);
    if (this.loaded) queueMicrotask(() => { if (this.watchers.has(w)) next(this.snapshot()); });
    void this.refresh(true);
    this.timer ??= setInterval(() => { if (document.visibilityState !== 'hidden') void this.refresh(false); }, POLL);
    return () => {
      this.watchers.delete(w);
      if (!this.watchers.size && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** A row this page has just written, or just read. */
  put(id: string, doc: Doc): void {
    this.rows.set(id, doc);
    if (this.loaded) this.tell();
  }

  private snapshot(): QuerySnap {
    return { docs: [...this.rows].map(([id, doc]) => snap(id, doc)) };
  }

  private tell(): void {
    const s = this.snapshot();
    for (const w of this.watchers) w.next(s);
  }

  /** Fetch what has changed. `always` tells the watchers even if nothing has, for the first look. */
  private refresh(always: boolean): Promise<void> {
    return (this.loading ??= this.fetch(always).finally(() => { this.loading = null; }));
  }

  private async fetch(always: boolean): Promise<void> {
    try {
      let changed = false;
      const since = this.newest ? new Date(Date.parse(this.newest) - OVERLAP).toISOString() : '';
      for (let from = 0; ; from += PAGE) {
        let q = this.client.from(this.table).select('uid, doc, updated_at').order('updated_at').order('uid').range(from, from + PAGE - 1);
        if (since) q = q.gte('updated_at', since);
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data ?? []) as Row[];
        for (const r of rows) {
          if (r.updated_at > this.newest) this.newest = r.updated_at;
          const doc = r.doc ?? {};
          if (JSON.stringify(this.rows.get(r.uid)) !== JSON.stringify(doc)) {
            this.rows.set(r.uid, doc);
            changed = true;
          }
        }
        if (rows.length < PAGE) break;
      }
      const first = !this.loaded;
      this.loaded = true;
      if (changed || first || always) this.tell();
    } catch (e) {
      // A look that fails is tried again at the next one. The listener hears only if there was never a first.
      if (!this.loaded) for (const w of this.watchers) w.error?.(fail(e));
    }
  }
}

export class WebDb implements Db {
  private readonly collections = new Map<string, Collection>();

  constructor(private readonly client: SupabaseClient) {}

  private table(name: string): Collection {
    if (!TABLES.has(name)) throw { code: 'not-found' };
    let c = this.collections.get(name);
    if (!c) this.collections.set(name, (c = new Collection(this.client, name)));
    return c;
  }

  doc(path: string): DocRef {
    const [name, id, ...rest] = path.split('/');
    const bad = !id || rest.length > 0 || !TABLES.has(name);
    const get = async (): Promise<DocSnap> => {
      if (bad) throw { code: 'not-found' };
      const { data, error } = await this.client.from(name).select('doc').eq('uid', id).maybeSingle();
      if (error) throw fail(error);
      return snap(id, data ? ((data as { doc: Doc | null }).doc ?? {}) : undefined);
    };
    return {
      get,
      set: async (data) => {
        if (bad) throw { code: 'not-found' };
        const { error } = await this.client.from(name).upsert({ uid: id, doc: data }, { onConflict: 'uid' });
        if (error) throw fail(error);
        this.table(name).put(id, data);
      },
      onSnapshot: (next, error) => {
        if (bad) {
          error?.({ code: 'not-found' });
          return () => {};
        }
        let last: string | null = null;
        let stopped = false;
        const look = (): void => {
          get().then((s) => {
            const now = JSON.stringify(s.data() ?? null);
            if (stopped || now === last) return;
            last = now;
            next(s);
          }, (e) => { if (!stopped && last === null) error?.(e as { code: string }); });
        };
        look();
        const timer = setInterval(() => { if (document.visibilityState !== 'hidden') look(); }, POLL);
        return () => { stopped = true; clearInterval(timer); };
      },
    };
  }

  collection(path: string): { onSnapshot(next: (s: QuerySnap) => void, error?: Fail): () => void } {
    return {
      onSnapshot: (next, error) => {
        try {
          return this.table(path).watch(next, error);
        } catch (e) {
          error?.(fail(e));
          return () => {};
        }
      },
    };
  }
}
