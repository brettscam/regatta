import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Room, RoomPeer } from '../platform';
import { WATER_BUDGET } from './config';
import { FASTEST, SILENT, pressing, reportGap } from './pacing';

/**
 * The website's shared water: one Supabase Realtime channel for each sailing area, `water:<area>`. It is public,
 * so nobody needs an account to sail in company.
 *
 * - Each page broadcasts its boat's whole report (event `s`) and keeps the last one it heard from every other page.
 *   Nothing is stored anywhere. How often a page reports depends on how many are here: see `pacing.ts`.
 * - Realtime Presence is only used for who is connected: a page that arrives is told everyone's position at once,
 *   and a page that has gone is dropped. It carries no boat data. A page that is closing also says so (event `bye`).
 * - A boat not heard from for a few seconds is dropped as well, which covers a hidden tab and a lost connection.
 *   A page hidden for half a minute leaves the channel, so it stops being sent everyone's reports, and comes back
 *   when it is looked at again.
 * - The library reconnects and rejoins by itself. If the channel is still down after a quarter of a minute it is
 *   thrown away and made again. The listener is never told of an error: there is always a room, sometimes an empty one.
 *
 * What another page sends is that page's word. `by` in particular is whatever id it claims.
 */

type Handler = (change: { peers: readonly RoomPeer[] }) => void;
type Report = Record<string, unknown>;

const HIDDEN_LEAVE = 30000;
const REMAKE_AFTER = 15000;
const MOST = 32;

const newId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
};

export class WebRoom implements Room {
  readonly stamped = true;
  /** This tab. A second tab of the same person is a second boat. */
  private readonly me = newId();
  private state: Report = {};
  /** When the game last gave a report, and whether it has gone out. */
  private touched = 0;
  private dirty = false;
  private urgent = false;
  /** A time by which to report whatever else is going on, set when somebody arrives. 0 for none. */
  private hurry = 0;
  private sentAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private channel: RealtimeChannel | null = null;
  private joined = false;
  private downSince = 0;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sweeper: ReturnType<typeof setInterval>;
  private readonly others = new Map<string, RoomPeer>();
  /** Every page connected to this water, this one included, by Presence. */
  private present = new Set<string>();
  private readonly greeted = new Set<string>();
  private readonly handlers = new Set<Handler>();
  private closed = false;
  /** For measuring: reports sent and heard since the page opened. */
  readonly counts = { sent: 0, heard: 0, joins: 0 };

  constructor(private readonly client: SupabaseClient, readonly area: string, private readonly uid: () => string | null) {
    this.join();
    this.sweeper = setInterval(() => this.sweep(), 1000);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onHide);
    window.addEventListener('pageshow', this.onShow);
  }

  // ---- what the game sees ------------------------------------------------------------------------

  presence(patch: Record<string, unknown>): Promise<void> {
    const next: Report = { ...this.state };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    if (pressing(this.state, next)) this.urgent = true;
    this.state = next;
    this.touched = Date.now();
    this.dirty = true;
    this.plan();
    return Promise.resolve();
  }

  peers(): readonly RoomPeer[] {
    const uid = this.uid();
    const mine: RoomPeer = { peer: this.me, by: uid, isMe: true, sameTab: true, kind: 'viewer', guest: uid === null, presence: this.state, updatedAt: this.touched };
    return [mine, ...this.others.values()];
  }

  onPeers(handler: Handler): () => void {
    this.handlers.add(handler);
    if (this.others.size) queueMicrotask(() => { if (this.handlers.has(handler)) handler({ peers: this.peers() }); });
    return () => { this.handlers.delete(handler); };
  }

  /** Leave for good. */
  close(): void {
    this.closed = true;
    this.leave();
    clearInterval(this.sweeper);
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onHide);
    window.removeEventListener('pageshow', this.onShow);
    this.handlers.clear();
  }

  /** Milliseconds between reports as things stand. For measuring. */
  get gap(): number {
    return reportGap(this.present.size, this.others.size, WATER_BUDGET);
  }

  // ---- the channel -------------------------------------------------------------------------------

  private join(): void {
    if (this.channel || this.closed) return;
    const ch = this.client.channel(`water:${this.area}`, { config: { broadcast: { self: false, ack: false }, presence: { key: this.me } } });
    this.channel = ch;
    this.downSince = Date.now();
    this.counts.joins++;
    ch.on('broadcast', { event: 's' }, (message) => this.hear(message.payload));
    ch.on('broadcast', { event: 'bye' }, (message) => this.farewell(message.payload));
    ch.on('presence', { event: 'sync' }, () => this.roll(ch));
    // This is called again every time the channel is rejoined after a lost connection.
    ch.subscribe((status) => {
      if (this.channel !== ch) return;
      this.joined = status === 'SUBSCRIBED';
      if (!this.joined) {
        if (!this.downSince) this.downSince = Date.now();
        return;
      }
      this.downSince = 0;
      void ch.track({}).catch(() => {});
      // Say where this boat is straight away: that is how the boats already here learn that she has arrived.
      this.hurry = Date.now();
      this.plan();
    });
  }

  private leave(): void {
    const ch = this.channel;
    this.channel = null;
    this.joined = false;
    this.present = new Set();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (ch) void this.client.removeChannel(ch).catch(() => {});
  }

  private readonly onVisibility = (): void => {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (document.visibilityState === 'hidden') this.hideTimer = setTimeout(() => this.leave(), HIDDEN_LEAVE);
    else this.join();
  };
  /** The page is closing or being put away: tell the others now, so they need not wait to notice. */
  private readonly onHide = (): void => {
    if (this.joined && this.channel) void this.channel.send({ type: 'broadcast', event: 'bye', payload: { p: this.me } }).catch(() => {});
    this.leave();
  };
  private readonly onShow = (): void => { if (document.visibilityState !== 'hidden') this.join(); };

  // ---- hearing -----------------------------------------------------------------------------------

  private hear(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const { p, u, d } = message as { p?: unknown; u?: unknown; d?: unknown };
    if (typeof p !== 'string' || !p || p.length > 64 || p === this.me) return;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    const known = this.others.has(p);
    if (!known && this.others.size >= MOST) return;
    const by = typeof u === 'string' && u && u.length <= 64 ? u : null;
    this.counts.heard++;
    this.others.set(p, {
      peer: p, by, isMe: by !== null && by === this.uid(), sameTab: false, kind: 'viewer', guest: by === null,
      presence: d as Report, updatedAt: Date.now(),
    });
    if (!known) this.greet(p);
    this.tell();
  }

  private farewell(message: unknown): void {
    const p = (message as { p?: unknown } | null)?.p;
    if (typeof p !== 'string') return;
    this.greeted.delete(p);
    if (this.others.delete(p)) this.tell();
  }

  /** Presence has changed: someone has connected or gone. */
  private roll(ch: RealtimeChannel): void {
    if (this.channel !== ch) return;
    const now = new Set(Object.keys(ch.presenceState()));
    let gone = false;
    for (const key of this.present) {
      if (now.has(key)) continue;
      this.greeted.delete(key);
      if (this.others.delete(key)) gone = true;
    }
    for (const key of now) if (key !== this.me && !this.present.has(key)) this.greet(key);
    this.present = now;
    if (gone) this.tell();
  }

  /** Somebody new: let them have this boat's position soon, a little apart from everyone else's answer. */
  private greet(peer: string): void {
    if (this.greeted.has(peer)) return;
    this.greeted.add(peer);
    this.hurry = Date.now() + Math.random() * Math.min(1000, this.gap);
    this.plan();
  }

  private sweep(): void {
    const now = Date.now();
    let gone = false;
    for (const [peer, p] of this.others) {
      if (now - p.updatedAt <= SILENT) continue;
      this.others.delete(peer);
      this.greeted.delete(peer);
      gone = true;
    }
    if (gone) this.tell();
    // A channel that has not come back by itself is made again.
    if (this.channel && !this.joined && this.downSince && now - this.downSince > REMAKE_AFTER && document.visibilityState !== 'hidden') {
      this.leave();
      this.join();
    }
  }

  private tell(): void {
    const change = { peers: this.peers() };
    for (const handler of this.handlers) {
      try {
        handler(change);
      } catch { /* one listener's trouble is not the room's */ }
    }
  }

  // ---- reporting ---------------------------------------------------------------------------------

  /** Set the clock for the next report. */
  private plan(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.joined || (!this.dirty && !this.hurry)) return;
    let due = this.sentAt + (this.urgent ? FASTEST : this.gap);
    if (this.hurry) due = Math.min(due, Math.max(this.hurry, this.sentAt + FASTEST));
    this.timer = setTimeout(() => { this.timer = null; this.report(); }, Math.max(0, due - Date.now()));
  }

  private report(): void {
    const now = Date.now();
    if (!this.joined || !this.channel) return;
    // The game stops reporting when the tab is hidden. Then this boat says nothing, and the others let her go.
    if (!this.touched || now - this.touched > 2000) {
      this.dirty = false;
      this.hurry = 0;
      return;
    }
    this.sentAt = now;
    this.dirty = false;
    this.urgent = false;
    this.hurry = 0;
    this.counts.sent++;
    void this.channel.send({ type: 'broadcast', event: 's', payload: { p: this.me, u: this.uid(), d: this.state } }).catch(() => {});
  }
}
