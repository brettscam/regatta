// Which animals the player has seen and on how many sails, kept on this device so the logbook can show them.
const KEY = 'regatta.seen';

export function sightings(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    const out: Record<string, number> = {};
    if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
    return out;
  } catch {
    return {};
  }
}

/** Count one more sail on which this animal was seen. Returns how many that makes. */
export function sight(kind: string): number {
  const all = sightings();
  all[kind] = (all[kind] ?? 0) + 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* nowhere to keep it: it counts for this sail only */ }
  return all[kind];
}
