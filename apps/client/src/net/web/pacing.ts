/**
 * How often a boat reports on the website's shared water. Pure, so it can be tested.
 *
 * Supabase Realtime counts a broadcast once as sent and once for every other page it is delivered to, so a water
 * with n pages on it costs n x n messages each time everyone reports once. The free plan allows the whole project
 * 100 messages a second and 2 million a month. So the more boats, the less often each one reports, and the
 * receiving side runs each boat on along her course between reports (`fleet.ts` does that for up to 2.5 seconds).
 */

/** Never more often than this, however few boats: 4 reports a second. */
export const FASTEST = 250;
/** Never less often than this while there is company: the far side stops running a boat on after 2.5 seconds. */
export const SLOWEST = 2000;
/** With nobody else heard, a boat only says she is here now and then, so that someone arriving finds her. */
export const ALONE = 2500;
/** A boat not heard from for this long has gone. Longer than two reports at the slowest anyone sends. */
export const SILENT = 5500;

/**
 * Milliseconds between this boat's reports.
 * @param pages how many pages are on this water, this one included
 * @param heard how many other boats are reporting
 * @param budget messages a second the whole water may use
 */
export function reportGap(pages: number, heard: number, budget: number): number {
  if (heard <= 0) return ALONE;
  const n = Math.max(pages, heard + 1);
  return Math.max(FASTEST, Math.min(SLOWEST, Math.ceil((n * n * 1000) / budget)));
}

/**
 * True when something other than the boat's motion has changed between two reports: a hail, a race called or joined,
 * what she says she is doing. Those go out at once instead of waiting for the next report. Motion is all numbers,
 * so a change in a word, or a value appearing or going, is what counts.
 */
export function pressing(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): boolean {
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    if (a === b) continue;
    if (typeof a !== typeof b || (a === null) !== (b === null)) return true;
    if (typeof b === 'string') return true;
  }
  return false;
}
