/**
 * Where this page is running, and the three things the game asks its host for. This is the only place that asks.
 *
 * - `room`: who else has the game open now, and what each of them says about their boat (shared water, hails, races)
 * - `db`: a small document store with a row per person (votes, feedback, logbooks)
 * - `user`: who this person is, and other people's names
 *
 * On claude.ai the artifact runtime supplies all three as `window.claude.use(name)`.
 *
 * On the website the game brings its own, in `./web/` (Supabase), behind the same three shapes. That code is only in
 * builds made with the backend switched on (`VITE_BACKEND`, set in `vite.config.ts`): the single-file artifact build
 * switches it off, and the import below then disappears from the bundle. The website also has an `account`, for
 * signing in with an email address. On claude.ai there is none: the page already knows who is looking at it.
 *
 * Anywhere else (a saved file, the artifact build opened outside claude.ai) there is nothing behind them: each
 * resolves to null and the game is single-handed, with votes, feedback and shared logbooks switched off.
 */

export type Platform = 'claude' | 'web' | 'alone';

// ---- room: presence ------------------------------------------------------------------------------

export interface RoomPeer {
  peer: string;
  by: string | null;
  isMe: boolean;
  sameTab: boolean;
  kind: string;
  guest: boolean;
  presence: Readonly<Record<string, unknown>>;
  updatedAt: number;
}

export interface Room {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly RoomPeer[];
  onPeers(handler: (change: { peers: readonly RoomPeer[] }) => void, onError?: (e: { code: string }) => void): () => void;
  /**
   * True where each peer's `updatedAt` is this page's own clock at the moment that peer's report arrived,
   * and every change hands over everyone's last report again. A listener can then tell a new report from one
   * it has already heard. The website's room says so. A room that does not is taken as before.
   */
  readonly stamped?: boolean;
}

// ---- db: documents -------------------------------------------------------------------------------

export interface DocSnap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
export interface QuerySnap { docs: DocSnap[] }
export interface DocRef {
  get(): Promise<DocSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  onSnapshot(next: (s: DocSnap) => void, error?: (e: { code: string }) => void): () => void;
}
export interface Db {
  doc(path: string): DocRef;
  collection(path: string): { onSnapshot(next: (s: QuerySnap) => void, error?: (e: { code: string }) => void): () => void };
}

// ---- user: who is here ---------------------------------------------------------------------------

export interface UserApi {
  /** This person's id, or null when they are not signed in. */
  id(): Promise<string | null>;
  /** Whether this person may do something, `data.write` for instance. Null when the platform has not said. */
  can(name: string): Promise<boolean | null>;
  /** Names for the ids given, as far as this person is allowed to see them. */
  profiles(ids: string[]): Promise<Record<string, { name: string }>>;
}

// ---- account: signing in, on the website only ----------------------------------------------------

/** How asking for a sign-in went. `reason` is a sentence for the player when it did not go well. */
export interface AccountResult { ok: boolean; reason?: string }

export interface Account {
  /** The address this person is signed in with, or null. Shown only to them. */
  email(): string | null;
  /** Email a sign-in link to this address. Opening it on this device signs them in. */
  send(email: string): Promise<AccountResult>;
  /** True where the email also carries a code that can be typed in instead of opening the link. */
  readonly codes: boolean;
  /** Sign in with the code from the email. */
  verify(email: string, code: string): Promise<AccountResult>;
  signOut(): Promise<void>;
  /** Called when this person signs in or out. Returns the way to stop listening. */
  onChange(handler: () => void): () => void;
  /** How this page was opened: from a sign-in link that worked, from one that had expired, or neither. */
  readonly arrival: 'signed-in' | 'expired' | null;
}

// ---- asking --------------------------------------------------------------------------------------

type Use = (name: string) => Promise<unknown>;
const claudeUse = (): Use | null => {
  const claude = (window as unknown as { claude?: { use?: Use } }).claude;
  return claude?.use ? (name) => claude.use!(name) : null;
};

/**
 * The website's own backend, in builds that carry one. The flag is fixed when the page is built, so where it is off
 * the bundler drops this import and everything behind it: the artifact build has no Supabase code in it at all.
 */
const web = import.meta.env.VITE_BACKEND === 'supabase' ? () => import('./web/index').then((m) => m.backend()) : null;

/** Which platform this is. Looked up when asked, not when the module loads. */
export function platform(): Platform {
  return claudeUse() ? 'claude' : web ? 'web' : 'alone';
}

/** True on the website, where the game brings its own backend and its own sign-in. */
export function onWeb(): boolean {
  return platform() === 'web';
}

/** True where there is nothing behind the game at all: a saved file, or the artifact build opened outside claude.ai. */
export function alone(): boolean {
  return platform() === 'alone';
}

// Each of these resolves to null where there is nothing to give, and rejects if the platform refuses.
// Callers already treat both as "not here".

/** The shared water of one sailing area. claude.ai has one room for the page, whatever the area. */
export async function room(area = 'sf-bay'): Promise<Room | null> {
  const use = claudeUse();
  if (use) return (await use('room')) as Room | null;
  return web ? (await web()).room(area) : null;
}

export async function db(): Promise<Db | null> {
  const use = claudeUse();
  if (use) return (await use('db')) as Db | null;
  return web ? (await web()).db : null;
}

export async function user(): Promise<UserApi | null> {
  const use = claudeUse();
  if (use) return (await use('user')) as UserApi | null;
  return web ? (await web()).user : null;
}

/** Signing in and out. Null on claude.ai and wherever there is no backend. */
export async function account(): Promise<Account | null> {
  if (claudeUse() || !web) return null;
  const backend = await web();
  await backend.ready;
  return backend.account;
}
