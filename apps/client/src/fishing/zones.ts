/**
 * No-take reserves, by water. Data in `courses/<id>/reserves.json`; nothing here touches the screen.
 * Shared by everything that takes from the sea (fishing, pots, diving): ask `reserveAt` before taking.
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

interface ReserveFile { reserves: Reserve[] }

const files = import.meta.glob<ReserveFile>('../../../../courses/*/reserves.json', { eager: true, import: 'default' });

/** The reserves of a water. A water with no file has none. */
export function reservesOf(courseId: string): Reserve[] {
  return files[`../../../../courses/${courseId}/reserves.json`]?.reserves ?? [];
}

/** The reserve a point lies in, or null. */
export function reserveAt(reserves: readonly Reserve[], x: number, y: number): Reserve | null {
  for (const r of reserves) if (Math.hypot(x - r.x, y - r.y) <= r.r) return r;
  return null;
}
