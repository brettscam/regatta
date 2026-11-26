/**
 * No-take reserves, by water: one list for everything that takes from the sea. The list is the `zones` of the water's
 * `courses/<id>/dives.json`, which diving already obeys (`zoneAt` in `aboard/diveRules.ts`), so a reserve shut to a
 * speargun is shut to a fishing line as well, and the chart hatches the same circles. Nothing here touches the screen.
 * Flat metres, sim coordinates (x east, y north).
 */
export interface Reserve {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Radius, metres. */
  r: number;
  /** What the crew say when a line is about to go over inside it. */
  say: string;
}

interface ZoneFile { zones?: Array<{ id: string; name: string; x: number; y: number; r: number }> }

const files = import.meta.glob<ZoneFile>('../../../../courses/*/dives.json', { eager: true, import: 'default' });
/** A water's chart features: its areas marked `noTake` are its reserves, and come before any list in `dives.json`. */
const charts = import.meta.glob<{ areas?: Array<{ id: string; name: string; noTake?: boolean; circle?: { x: number; y: number; r: number } }> }>('../../../../courses/*/features.json', { eager: true, import: 'default' });
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The reserves of a water. A water with no list has none. */
export function reservesOf(courseId: string): Reserve[] {
  // One list: the chart's own no-take areas where the water has them (`features.json`), the dive file's where it has not.
  const charted = charts[`../../../../courses/${courseId}/features.json`]?.areas?.filter((a) => a.noTake && a.circle);
  const zones = charted?.length ? charted.map((a) => ({ id: a.id, name: a.name, x: a.circle!.x, y: a.circle!.y, r: a.circle!.r })) : files[`../../../../courses/${courseId}/dives.json`]?.zones;
  if (!Array.isArray(zones)) return [];
  return zones
    .filter((z) => z && typeof z.id === 'string' && typeof z.name === 'string' && finite(z.x) && finite(z.y) && finite(z.r) && z.r > 0)
    // The list's own words are a diver's. An angler is told the same thing in hers.
    .map((z) => ({ id: z.id, name: z.name, x: z.x, y: z.y, r: z.r, say: `${z.name.replace(/ reserve$/i, '')} is a no-take reserve: nothing may be taken here.` }));
}

/** The reserve a point lies in, or null. */
export function reserveAt(reserves: readonly Reserve[], x: number, y: number): Reserve | null {
  for (const r of reserves) if (Math.hypot(x - r.x, y - r.y) <= r.r) return r;
  return null;
}
