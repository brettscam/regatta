// Which places the player has been ashore at, kept on this device so the bar-hop card fills in over many sails.
const KEY = 'regatta.ashore';

export function visited(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Mark a place as visited. True if this is the first time. */
export function stamp(id: string): boolean {
  const all = visited();
  if (all.has(id)) return false;
  all.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...all]));
  } catch { /* nowhere to keep it: it counts for this sail only */ }
  return true;
}
