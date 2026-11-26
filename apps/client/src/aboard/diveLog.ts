// The diver's own record, kept on this device: the best of each species, the deepest dive and the longest breath.
// The logbook's totals (fish, lobster, points) are kept by `net/logbook.ts`; this is the card beside them.
const KEY = 'regatta.dives';

export interface DiveLog {
  /** Times she has gone over the side. */
  dives: number;
  /** Metres, and seconds on one breath. */
  deepest: number;
  longest: number;
  /** Best of each kind taken: its name, how many, and the biggest in centimetres (lobster: millimetres across the carapace). */
  species: Record<string, { name: string; n: number; best: number; unit: 'cm' | 'mm' }>;
}

const num = (v: unknown, most: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(most, v) : 0);

/** Read a saved log, keeping only what is sound. */
export function cleanDiveLog(raw: unknown): DiveLog {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const species: DiveLog['species'] = {};
  if (r.species && typeof r.species === 'object') {
    for (const [id, v] of Object.entries(r.species as Record<string, unknown>).slice(0, 60)) {
      const s = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      const n = Math.floor(num(s.n, 1e6));
      if (!n || typeof s.name !== 'string') continue;
      species[id.slice(0, 24)] = { name: s.name.slice(0, 40), n, best: Math.round(num(s.best, 400)), unit: s.unit === 'mm' ? 'mm' : 'cm' };
    }
  }
  return { dives: Math.floor(num(r.dives, 1e6)), deepest: num(r.deepest, 40), longest: num(r.longest, 600), species };
}

export function diveLog(): DiveLog {
  try {
    return cleanDiveLog(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return cleanDiveLog(null);
  }
}

function keep(log: DiveLog): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch { /* nowhere to keep it: it counts for this sail only */ }
}

/** One more time over the side. */
export function logEntry(): void {
  const log = diveLog();
  log.dives++;
  keep(log);
}

/** A dive has ended: remember it if it was the deepest or the longest. */
export function logDive(depth: number, seconds: number): void {
  const log = diveLog();
  if (depth <= log.deepest && seconds <= log.longest) return;
  log.deepest = Math.max(log.deepest, Math.round(depth * 10) / 10);
  log.longest = Math.max(log.longest, Math.round(seconds));
  keep(log);
}

/** Something has been kept. Returns true if it is the first of its kind she has ever taken. */
export function logCatch(id: string, name: string, size: number, unit: 'cm' | 'mm'): boolean {
  const log = diveLog();
  const was = log.species[id];
  log.species[id] = { name, n: (was?.n ?? 0) + 1, best: Math.max(was?.best ?? 0, Math.round(size)), unit };
  keep(log);
  return !was;
}
