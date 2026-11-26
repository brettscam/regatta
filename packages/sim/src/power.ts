import { KT, clamp, interp1, smoothstep, wrapPi } from './math';
import type { BoatFile, BoatSpec, PowerSpec, SeaSample } from './types';

/**
 * The pure rules of a planing powerboat: what her lever, her hull and the sea make of each other. The sim steps her
 * with these (`Sim.stepPower`), and the instruments, the tests and the tuning script read the same functions, so the
 * number on the screen is the number she is sailed by.
 */

const G = 9.81;
/** The lever's travel, the same as a sailing boat's throttle: -2 full astern, 0 neutral, 4 wide open. */
const LEVER_ASTERN = -2;
const LEVER_AHEAD = 4;

/** Litres in a US gallon, for the figures a powerboat's skipper thinks in. */
export const US_GALLON = 3.785;

/**
 * A boat with no rig. A powerboat's file says nothing about sails, a polar or heeling to them, and anything that
 * reads those finds this: no sail area, one "reef" that is no sail at all, no spinnaker, no heel.
 * Her polar is the one thing here that is not nothing: it is her cruising speed whatever the wind, because the
 * passage planner reads a polar and that is what she plans a passage at.
 */
function barePoles(cruiseKt: number): Pick<BoatSpec, 'polar' | 'sails' | 'heel' | 'rightingCurve'> {
  return {
    polar: { twa: [0, 180], tws: [0, 60], speeds: [[cruiseKt, cruiseKt], [cruiseKt, cruiseKt]] },
    sails: {
      main: { areaM2: 0, reefs: [{ name: 'No sail', drive: 0, heel: 0, luff: 0 }], sheetMinDeg: 0, sheetMaxDeg: 0 },
      jib: { areaM2: 0, sheetHardDeg: 0, sheetMaxSlackDeg: 0 },
    },
    heel: { perKnot: 0, offset: 0, mainShare: 0, jibShare: 0, penaltyStartDeg: 90, penaltyPerDeg: 0, penaltyFloor: 1, rudderFadeStartDeg: 90, rudderFadeRangeDeg: 1, maxDeg: 0 },
    rightingCurve: { deg: [0, 90], gz: [0, 0] },
  };
}

/**
 * Complete a boat file. A sailing boat's comes back as it is, the very same object. A powerboat's (it has `power`
 * and no `sails`) comes back with the rig it does not have filled in as bare poles, so the code that reads a rig
 * finds none instead of failing. What she does differently is decided by `boat.power`, never by these blanks.
 */
export function fitOut<T extends BoatFile>(file: T): T & BoatSpec {
  if (file.sails && file.polar && file.heel && file.rightingCurve) return file as T & BoatSpec;
  if (!file.power) throw new Error(`Boat ${file.id} has neither sails nor power`);
  const d = file.dimensions;
  return {
    ...barePoles(file.power.cruiseKt),
    ...file,
    dimensions: { mastHeight: 0, boomLength: 0, boomHeight: 0, mastFromBow: 0, jibFoot: 0, forestayHeight: 0, ...d },
  } as T & BoatSpec;
}

/** Bring a lever position onto one of her steps, inside its travel. */
export function leverSnap(p: PowerSpec, lever: number): number {
  const step = p.leverStep > 0 ? p.leverStep : 1;
  return clamp(Math.round(lever / step) * step, LEVER_ASTERN, LEVER_AHEAD);
}

/** Revs for a lever position with the engine running: idle out of gear, the bottom of her curve just in gear, the top wide open. */
export function leverRpm(p: PowerSpec, lever: number): number {
  const a = Math.abs(lever);
  if (a < p.leverStep * 0.5) return p.idleRpm;
  const rpm = p.curve.rpm;
  const share = clamp((a - p.leverStep) / (LEVER_AHEAD - p.leverStep), 0, 1);
  return rpm[0] + (rpm[rpm.length - 1] - rpm[0]) * share;
}

/** The speed a lever position holds in flat calm, m/s, negative astern. */
export function leverSpeed(p: PowerSpec, lever: number): number {
  if (Math.abs(lever) < p.leverStep * 0.5) return 0;
  const kt = interp1(p.curve.rpm, p.curve.kt, leverRpm(p, lever));
  return (lever > 0 ? kt : -Math.min(p.asternKt, 0.6 * kt)) * KT;
}

/** Fuel burned at a lever position, litres an hour. */
export function leverBurn(p: PowerSpec, lever: number): number {
  if (Math.abs(lever) < p.leverStep * 0.5) return p.idleLph;
  return interp1(p.curve.rpm, p.curve.lph, leverRpm(p, lever));
}

/** The lever position that holds a speed in flat calm, on one of her steps, never below the speed asked for if she can make it. */
export function leverFor(p: PowerSpec, kt: number): number {
  for (let lever = p.leverStep; lever <= LEVER_AHEAD + 1e-9; lever += p.leverStep) {
    if (leverSpeed(p, lever) / KT >= kt - 1e-6) return leverSnap(p, lever);
  }
  return LEVER_AHEAD;
}

/** Her top speed in flat calm, m/s. */
export function topSpeed(p: PowerSpec): number {
  return p.curve.kt[p.curve.kt.length - 1] * KT;
}

/** How she is running: 0 a displacement hull, 1 planing. */
export function planing(p: PowerSpec, speed: number): number {
  return smoothstep(p.humpKt, p.planeKt, Math.abs(speed) / KT);
}

/** Nautical miles to the litre at a steady lever position in flat calm. 0 out of gear. */
export function milesPerLitre(p: PowerSpec, lever: number): number {
  const kt = Math.abs(leverSpeed(p, lever)) / KT;
  return kt / leverBurn(p, lever);
}

/** Nautical miles the fuel will take her at the speed and burn of this moment. 0 when she is not going anywhere. */
export function rangeNm(fuelL: number, sogKt: number, burnLph: number): number {
  return burnLph > 0 && sogKt > 0.5 ? (fuelL / burnLph) * sogKt : 0;
}

/** How much of a wave's height she feels: short ones she bridges from crest to crest. */
export function waveSpan(p: PowerSpec, lwl: number, length: number): number {
  return smoothstep(p.sea.spanFrom, p.sea.spanFull, length / lwl);
}

/**
 * The g a significant wave top throws her up with at a speed, m/s: half the height she feels times the square of how
 * fast she meets the waves. `rel` is where the waves come from off her bow, radians: 0 a head sea, pi dead astern.
 */
export function waveG(p: PowerSpec, lwl: number, sea: SeaSample, rel: number, speed: number): number {
  const k = (Math.PI * 2) / sea.length;
  const c = Math.sqrt(G / k);
  const met = k * (c + speed * Math.cos(rel));
  return (0.5 * sea.height * waveSpan(p, lwl, sea.length) * met * met) / G;
}

/**
 * The fastest she can go in a sea before a significant wave throws her clear of the water, m/s, and never more than
 * her top speed. Into it the waves come at her fast and the answer is low; across it or down it there is often no limit.
 * @param heading compass radians
 */
export function comfortSpeed(boat: BoatSpec, sea: SeaSample | null | undefined, heading: number): number {
  const p = boat.power;
  if (!p) return 0;
  const top = topSpeed(p);
  if (!sea || !(sea.height > 0.05) || !(sea.length > 0.5)) return top;
  const felt = sea.height * waveSpan(p, boat.dimensions.lwl, sea.length);
  if (felt < 0.02) return top;
  const k = (Math.PI * 2) / sea.length;
  const c = Math.sqrt(G / k);
  // The closing speed with the crests at which half the felt height, shaken at that rate, is `comfortG`.
  const closing = Math.sqrt((2 * G * p.sea.comfortG) / felt) / k;
  const cos = Math.cos(wrapPi(sea.dir - heading));
  if (cos > 0.05) return clamp((closing - c) / cos, 0, top);
  // Running with it she has to overtake the waves that fast before they throw her.
  if (cos < -0.05) return clamp((closing + c) / -cos, 0, top);
  return top;
}
