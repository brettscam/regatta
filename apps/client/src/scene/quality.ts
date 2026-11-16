/**
 * How much the picture is allowed to cost. `high` is everything. `low` is for a phone or an old laptop: smaller wake
 * maps, less spray, simpler weather. `auto` starts high and drops to low by itself if frames run long (see
 * `Stage.keepPace`). The choice is kept on the device.
 */
export type Quality = 'high' | 'low';
export type QualityChoice = Quality | 'auto';

const KEY = 'regatta.gfx';
const listeners: Array<(q: Quality) => void> = [];

function saved(): QualityChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'high' || v === 'low' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

let choice: QualityChoice = saved();
let level: Quality = choice === 'low' ? 'low' : 'high';

export const graphics = {
  /** What is being drawn now. */
  get level(): Quality {
    return level;
  },
  /** What the player asked for. */
  get choice(): QualityChoice {
    return choice;
  },
  /** The player's choice, remembered. */
  choose(c: QualityChoice): void {
    choice = c;
    try {
      if (c === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch { /* private window: it lasts for this visit */ }
    graphics.set(c === 'low' ? 'low' : 'high');
  },
  /** Frames are running long: step down, unless the player has asked for high. @returns true if anything changed */
  fallBack(): boolean {
    if (choice !== 'auto' || level === 'low') return false;
    graphics.set('low');
    return true;
  },
  set(q: Quality): void {
    if (q === level) return;
    level = q;
    for (const fn of listeners) fn(q);
  },
  /** Be told when the level changes. */
  watch(fn: (q: Quality) => void): void {
    listeners.push(fn);
  },
};
