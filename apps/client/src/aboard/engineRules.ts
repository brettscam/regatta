import { THROTTLE, THROTTLE_MAX, THROTTLE_MIN, type EngineSpec } from '@slack-tide/sim';

/** The pure decisions about the engine: when a race bars it, what each key press says, when the gauges warn. */

/** Seconds before the gun from which the engine may not be in gear. */
export const RACE_BAR_SECONDS = 300;
/** Share of the tank at which the fuel gauge turns amber, and at which it is said aloud a second time. */
export const FUEL_LOW = 0.2;
export const FUEL_VERY_LOW = 0.08;
/** The same for the battery. The pilot drops out at 0.1, so the first warning comes many hours before. */
export const BATTERY_LOW = 0.35;
export const BATTERY_VERY_LOW = 0.18;

export interface RaceNow {
  /** She is in a race: one she called or one she joined. */
  entered: boolean;
  /** She has crossed the finish. */
  finished: boolean;
  /** Seconds to the gun, negative once it has gone. */
  countdown: number;
}

/** True from five minutes before the gun until she finishes or leaves the race: the engine stays out of gear. */
export function raceBarsEngine(race: RaceNow | null | undefined): boolean {
  return !!race && race.entered && !race.finished && race.countdown <= RACE_BAR_SECONDS;
}

export const RACE_REFUSAL = 'No engine in a race. It stays out of gear from five minutes before the gun until you finish, or leave the race with R';
export const RACE_NEUTRAL = 'Five minutes to the gun: the engine is out of gear and stays there until you finish or leave the race';

/** The name of a throttle position: "Ahead slow". */
export function throttleName(notch: number): string {
  return THROTTLE[Math.max(THROTTLE_MIN, Math.min(THROTTLE_MAX, Math.round(notch))) - THROTTLE_MIN].name;
}

/** The speed a throttle position gives in flat calm, knots, astern as a positive number. */
export function throttleKt(engine: EngineSpec, notch: number): number {
  return Math.abs(THROTTLE[Math.round(notch) - THROTTLE_MIN].speed) * engine.cruiseKt;
}

/** What the rev counter reads at a throttle position. */
export function throttleRpm(notch: number): number {
  return THROTTLE[Math.max(THROTTLE_MIN, Math.min(THROTTLE_MAX, Math.round(notch))) - THROTTLE_MIN].rpm;
}

/** The line said when the throttle has been moved. */
export function throttleSays(engine: EngineSpec, notch: number): string {
  if (notch === 0) return 'Neutral. The engine is idling, out of gear';
  const kt = throttleKt(engine, notch);
  const tail = notch === THROTTLE_MAX ? ', and it drinks fuel' : notch === THROTTLE_MIN ? '. The stern walks to port' : '';
  return `${throttleName(notch)}: about ${kt.toFixed(kt < 3 ? 1 : 0)} kt in flat water${tail}`;
}

/**
 * Where the throttle goes for a step up (+1) or down (-1), and what to say when it cannot.
 * Nothing here moves the throttle: the caller does that when `to` is given.
 */
export function throttleStep(now: { engineOn: boolean; cranking: boolean; hold: 'none' | 'anchor' | 'mooring'; notch: number; barred: boolean }, dir: 1 | -1): { to?: number; say?: string } {
  if (now.cranking) return { say: 'She is still turning over. Wait for the engine to fire' };
  if (!now.engineOn) return { say: 'The engine is off. I starts it' };
  if (now.hold !== 'none') return { say: `She is ${now.hold === 'anchor' ? 'at anchor' : 'made fast'}, so the engine stays out of gear. X lets her go` };
  const to = now.notch + dir;
  if (to > THROTTLE_MAX) return { say: 'Full ahead already' };
  if (to < THROTTLE_MIN) return { say: 'Full astern already' };
  if (now.barred && to !== 0) return { say: RACE_REFUSAL };
  return { to };
}

/** Hours of motoring left at cruising revs. */
export function hoursAtCruise(engine: EngineSpec, litres: number): number {
  return litres / engine.burnLph;
}

/** A warning to give as a gauge falls through a mark, or null. `was` and `now` are shares of full, 0 to 1. */
export function fuelWarning(engine: EngineSpec, was: number, now: number): string | null {
  const hours = hoursAtCruise(engine, now * engine.tankL);
  const left = hours >= 1.5 ? `about ${Math.round(hours)} hours` : `about ${Math.max(5, Math.round((hours * 60) / 5) * 5)} minutes`;
  if (was > FUEL_VERY_LOW && now <= FUEL_VERY_LOW) return `Fuel very low: ${Math.round(now * engine.tankL)} litres, ${left} at cruising revs. A dock fills the tank`;
  if (was > FUEL_LOW && now <= FUEL_LOW) return `Fuel down to a fifth of a tank: ${left} left at cruising revs. A dock fills the tank`;
  return null;
}

export function batteryWarning(was: number, now: number, engineOn: boolean): string | null {
  if (engineOn) return null;
  if (was > BATTERY_VERY_LOW && now <= BATTERY_VERY_LOW) return `Battery at ${Math.round(now * 100)}%. At 10% the autopilot lets go of the wheel. Run the engine to charge it: I starts it`;
  if (was > BATTERY_LOW && now <= BATTERY_LOW) return `Battery down to ${Math.round(now * 100)}%. The autopilot and instruments are running it down. An hour or two with the engine on (I) puts it back`;
  return null;
}

/** Whether the engine panel has anything to show: the engine is on, or a gauge is low. */
export function panelShown(now: { engineOn: boolean; cranking: boolean; fuel: number; battery: number }): boolean {
  return now.engineOn || now.cranking || now.fuel <= FUEL_LOW || now.battery <= BATTERY_LOW;
}
