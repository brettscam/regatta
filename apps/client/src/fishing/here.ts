import type { Here } from './grounds';

/** As much of the replayed world as the fishing reads. `ReplayWorld` is one. */
export interface FishWorld {
  depth(x: number, y: number, t: number): number;
  chartDepth(x: number, y: number): number;
  current(x: number, y: number, t: number, out?: { x: number; y: number }): { x: number; y: number };
  tideRate(t: number): number;
  dateAt(t: number): Date;
}

/** The hour (0 to 24) and the month (1 to 12) on a water's own clock. */
export function localClock(date: Date, timeZone: string): { hour: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', month: 'numeric', hour12: false }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: (get('hour') % 24) + get('minute') / 60, month: get('month') || 1 };
}

/**
 * What a boat at a place is to a fish.
 * @param t session time, seconds
 * @param speedKt speed through the water, knots; `sogKt` over the ground
 */
export function hereOf(world: FishWorld, timeZone: string, x: number, y: number, t: number, speedKt: number, sogKt: number, held: boolean): Here {
  const c = world.current(x, y, t, { x: 0, y: 0 });
  const clock = localClock(world.dateAt(t), timeZone);
  return { x, y, depth: world.depth(x, y, t), speedKt, sogKt: held ? 0 : sogKt, held, hour: clock.hour, month: clock.month, tideRate: world.tideRate(t), stream: { x: c.x, y: c.y } };
}
