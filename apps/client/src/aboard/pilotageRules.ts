import { inArea, type ChartArea, type CourseFeatures } from '../world/features';

/**
 * What the crew says about the water the boat has just sailed into: a shoal that breaks, a traffic lane, a refuge.
 * Pure, so it can be tested: the areas come from a water's `features.json`, and nothing here touches the screen.
 */

const KT = 0.514444;

/** The ids of the areas a place is in. */
export function areasAt(features: CourseFeatures | undefined, x: number, y: number): string[] {
  if (!features) return [];
  return features.areas.filter((a) => inArea(a, x, y)).map((a) => a.id);
}

/** The areas newly entered since the last look, in the order the file lists them. */
export function entered(features: CourseFeatures | undefined, before: ReadonlySet<string>, now: readonly string[]): ChartArea[] {
  if (!features) return [];
  return features.areas.filter((a) => now.includes(a.id) && !before.has(a.id));
}

/** True where the tender must stay aboard: inside a refuge that forbids landing. */
export function noLanding(features: CourseFeatures | undefined, x: number, y: number): ChartArea | null {
  return features?.areas.find((a) => a.noLanding && inArea(a, x, y)) ?? null;
}

/**
 * How bad a bar or bank is just now, from the stream over it and the wind.
 * A swell shortens and steepens where it meets a stream running against it, so the ebb is the dangerous tide on a
 * west-facing bar, and more so with wind over it. `seaward` is the stream's speed toward the open sea, m/s (negative on the flood).
 * @returns 0 quiet, 1 lumpy, 2 dangerous
 */
export function barState(seaward: number, windKt: number): 0 | 1 | 2 {
  const ebb = seaward / KT;
  if (ebb >= 2 || (ebb >= 1.2 && windKt >= 15)) return 2;
  if (ebb >= 0.8 || windKt >= 20) return 1;
  return 0;
}

/** What to add to a hazard's warning for the state of the tide. Empty when it is quiet. */
export function barWord(state: 0 | 1 | 2, ebbKt: number): string {
  if (state === 2) return `The ebb is running ${ebbKt.toFixed(1)} knots over it now. This is when it breaks. Get off it`;
  if (state === 1) return 'It will be lumpy on it now';
  return '';
}

/** True if a boat has crossed a line from west to east between two looks. The line is two points, south end first. */
export function crossedEastward(line: [[number, number], [number, number]], from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const [[ax, ay], [bx, by]] = line;
  const side = (p: { x: number; y: number }) => (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax);
  const s0 = side(from);
  const s1 = side(to);
  // For a line running north, a point to its west has a positive cross product.
  if (!(s0 > 0 && s1 <= 0)) return false;
  // And between the line's ends, not round them.
  const u = s0 / (s0 - s1);
  const x = from.x + (to.x - from.x) * u;
  const y = from.y + (to.y - from.y) * u;
  const along = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2);
  return along >= -0.3 && along <= 1.3;
}
