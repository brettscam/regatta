/**
 * Where this page is running, and the three things the game asks its host for. This is the only place that asks.
 *
 * - `room`: who else has the game open now, and what each of them says about their boat (shared water, hails, races)
 * - `db`: a small document store with a row per person (votes, feedback, logbooks)
 * - `user`: who this person is, and other people's names
 *
 * On claude.ai the artifact runtime supplies all three as `window.claude.use(name)`. Anywhere else (the website,
 * a local build, a saved file) there is nothing behind them yet: each resolves to null and the game is single-handed,
 * with votes, feedback and shared logbooks switched off. A backend for the website goes in here, behind the same
 * three shapes, and the rest of the game does not change.
 */

export type Platform = 'claude' | 'web';

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

// ---- asking --------------------------------------------------------------------------------------

type Use = (name: string) => Promise<unknown>;
const claudeUse = (): Use | null => {
  const claude = (window as unknown as { claude?: { use?: Use } }).claude;
  return claude?.use ? (name) => claude.use!(name) : null;
};

/** Which platform this is. Looked up when asked, not when the module loads. */
export function platform(): Platform {
  return claudeUse() ? 'claude' : 'web';
}

/** True on the website and anywhere else with no host behind the game. For choosing what to tell the player. */
export function onWeb(): boolean {
  return platform() === 'web';
}

// Each of these resolves to null where there is nothing to give, and rejects if the platform refuses.
// Callers already treat both as "not here".

export async function room(): Promise<Room | null> {
  const use = claudeUse();
  return use ? ((await use('room')) as Room | null) : null;
}

export async function db(): Promise<Db | null> {
  const use = claudeUse();
  return use ? ((await use('db')) as Db | null) : null;
}

export async function user(): Promise<UserApi | null> {
  const use = claudeUse();
  return use ? ((await use('user')) as UserApi | null) : null;
}
