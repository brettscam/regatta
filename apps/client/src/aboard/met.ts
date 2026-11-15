// Which of the boats that live on each water the player has met, kept on this device so the logbook can list them.
const KEY = 'regatta.met';

/** The boats met, as "water/boat" ids. */
export function met(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string').slice(0, 500) : []);
  } catch {
    return new Set();
  }
}

/** Note a boat as met. Returns true if this is the first time ever. */
export function meet(water: string, boat: string): boolean {
  const all = met();
  const id = `${water}/${boat}`;
  if (all.has(id)) return false;
  all.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...all]));
  } catch { /* nowhere to keep it: it counts for this sail only */ }
  return true;
}

/** How many of a water's boats have been met: "5 of 23". */
export function metCount(water: string, ids: readonly string[], seen = met()): number {
  return ids.filter((id) => seen.has(`${water}/${id}`)).length;
}
