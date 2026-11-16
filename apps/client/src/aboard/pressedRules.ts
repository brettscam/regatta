import { KT, type BoatSpec, type SimOutputs, type SimState } from '@slack-tide/sim';

/**
 * What to tell the skipper of a boat that does not heel: a catamaran. Nothing she does warns her crew that she is
 * carrying too much sail, so she is reefed by numbers: the apparent wind on a placard at her helm (`pressed.reefAwsKt`
 * in her boat file). Pure: no sim stepping, no DOM. A boat with no `pressed` limit gets nothing from any of these.
 */

/** The placard, as a sailor would say it: "first reef at 18 kt apparent, second at 25". Empty for a boat without one. */
export function placard(boat: BoatSpec): string {
  const at = boat.pressed?.reefAwsKt ?? [];
  const nth = ['first', 'second', 'third'];
  return at.map((kt, i) => `${nth[i] ?? 'next'} reef at ${kt}${i === 0 ? ' kt apparent' : ''}`).join(', ');
}

/**
 * The reef the placard says she should have in for this apparent wind, when that is more than she has: 1 for the
 * first reef, 2 for the second. Null when she is reefed enough, held, or has no placard.
 */
export function reefDue(boat: BoatSpec, state: Pick<SimState, 'reef' | 'hold'>, out: Pick<SimOutputs, 'aws'>): number | null {
  const at = boat.pressed?.reefAwsKt;
  if (!at || state.hold !== 'none') return null;
  const awsKt = out.aws / KT;
  let want = 0;
  while (want < at.length && want < boat.sails.main.reefs.length - 1 && awsKt >= at[want]) want++;
  return want > state.reef ? want : null;
}

/** True while she is past what her set sail will take: a bow is burying and she is slowing. */
export function isPressed(boat: BoatSpec, out: Pick<SimOutputs, 'press'>): boolean {
  return !!boat.pressed && out.press > 1;
}

/** True while she lies capsized. */
export function isCapsized(boat: BoatSpec, state: Pick<SimState, 'knock' | 'heel'>): boolean {
  return !!boat.pressed && state.knock > 0.5 && Math.abs(state.heel) > 1;
}

/** The line for the moment she goes over. */
export function capsizeAlarm(boat: BoatSpec, state: Pick<SimState, 'reef'>, out: Pick<SimOutputs, 'aws'>): string {
  const sail = boat.sails.main.reefs[state.reef]?.name.toLowerCase() ?? 'this much sail';
  const minutes = Math.max(1, Math.round((boat.pressed?.capsizeHoldS ?? 120) / 60));
  return `Capsized. ${Math.round(out.aws / KT)} kt apparent on ${sail} with the sheets in was far more than she could carry, and a catamaran gives no warning. She will not come up by herself: help is righting her, about ${minutes} minute${minutes === 1 ? '' : 's'}. Reef by the numbers: ${placard(boat)}`;
}
