/**
 * The rules of the voice radio's mesh, kept pure so they can be tested. `voice.ts` does what these say.
 *
 * Voice goes straight from browser to browser, one WebRTC connection for each pair of boats with their radios on.
 * Setting a pair up takes two messages over Supabase Realtime (an offer and an answer, each carrying its network
 * candidates), sometimes a third or fourth with candidates that turned up late. Realtime counts a broadcast once as
 * sent and once for every page it is delivered to (see `pacing.ts`), so the messages of a boat joining a busy water
 * are spread out rather than sent in one burst.
 */

/** Boats in one mesh, this one included. Every boat sends her voice to each of the others, so it cannot be many. */
export const MESH_MOST = 8;
/** Milliseconds between two signalling messages from one page. */
export const SIGNAL_GAP = 250;
/** A boat does not announce her radio more often than this. */
export const ANNOUNCE_GAP = 4000;
/** How long to wait for the browser to find its network candidates before sending the offer or answer with what it has. */
export const GATHER_WAIT = 1200;
/** A connection that has not come up in this long is given up, to be tried again at the next announcement. */
export const CONNECT_WAIT = 20000;
/** A connection that has dropped and not come back in this long is closed. */
export const DROPPED_WAIT = 8000;
/** A boat that has not been on the water for this long is no longer on the radio either. */
export const GONE_WAIT = 15000;

/** True when this page may take on another connection. `links` is how many it has now. */
export function hasRoom(links: number): boolean {
  return links < MESH_MOST - 1;
}

/**
 * How long a page waits before offering to a boat that has just announced her radio, so that everyone already here
 * does not answer in the same instant.
 * @param company other boats on the water
 * @param roll a number from 0 to 1
 */
export function offerDelay(company: number, roll: number): number {
  return Math.round(roll * Math.min(4000, 400 * Math.max(1, company)));
}

/**
 * Both boats offered to each other at once. The one whose id sorts first keeps her offer; the other drops hers and answers.
 * @returns true when this page should give way
 */
export function yields(me: string, other: string): boolean {
  return me > other;
}

/** The boats on the water this radio has no connection to. They are who an announcement is for. */
export function unraised(company: readonly string[], linked: (peer: string) => boolean): string[] {
  return company.filter((peer) => !linked(peer));
}

/** The ICE servers: public STUN, and a TURN relay if the build names one. */
export function iceServers(turn: { url?: string; user?: string; pass?: string }): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
  if (turn.url) servers.push({ urls: turn.url.split(',').map((u) => u.trim()).filter(Boolean), username: turn.user ?? '', credential: turn.pass ?? '' });
  return servers;
}
