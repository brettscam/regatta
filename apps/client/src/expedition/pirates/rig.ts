import type { WatchRig } from '../watch';

// How the Jamaica sloop is sailed through a watch: how close she lies, what she carries in what wind.
// SEAM, a bigger player ship: another class brings another of these, and `session.ts` would choose by `career.ship.cls`.

/** How the sloop is sailed through a watch. */
export const SLOOP_RIG: WatchRig = {
  fullAndBy: 52,
  plans: [{ reef: 0, furl: 1, name: 'All plain sail' }, { reef: 1, furl: 1, name: 'A reef in the main' }, { reef: 2, furl: 0, name: 'Double-reefed, jib handed' }],
  shorten: [22, 30],
  shakeOut: [18, 26],
  heaveTo: 48,
  makeSail: 40,
  tws: [4, 8, 12, 16, 21.9, 22, 26, 29.9, 30, 36, 44],
};
