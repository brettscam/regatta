import { KT, US_GALLON, leverBurn, leverFor, leverRpm, leverSpeed, milesPerLitre, type BoatSpec, type PowerSpec, type SimOutputs, type SimState } from '@slack-tide/sim';

/**
 * The pure decisions about a powerboat as her skipper meets her: what each throttle position is called and what it
 * says, what she is doing in a few words, when the tank warns, and what the instruments read. No DOM, no Three.js.
 * The boat herself is in the sim (`Sim.stepPower`, `packages/sim/src/power.ts`).
 */

/** Share of the tank at which a powerboat's skipper is told, each time, as it falls: half, a third, a fifth, nearly dry. */
export const TANK_MARKS = [0.5, 1 / 3, 0.2, 0.08] as const;

/** The lever's position as a share of its travel ahead or astern: 0 just in gear at idle, 1 wide open. */
export function leverShare(p: PowerSpec, lever: number): number {
  const a = Math.abs(lever);
  if (a < p.leverStep * 0.5) return 0;
  return Math.max(0, Math.min(1, (a - p.leverStep) / (4 - p.leverStep)));
}

/** What a throttle position is called: "Neutral", "Ahead, idle", "Ahead 60%", "Wide open", "Astern 20%". */
export function leverName(p: PowerSpec, lever: number): string {
  if (Math.abs(lever) < p.leverStep * 0.5) return 'Neutral';
  const way = lever > 0 ? 'Ahead' : 'Astern';
  const pct = Math.round(leverShare(p, lever) * 100);
  if (pct === 0) return `${way}, idle`;
  if (pct >= 100 && lever > 0) return 'Wide open';
  return `${way} ${pct}%`;
}

const gal = (litres: number) => litres / US_GALLON;

/** The line said when the lever has been moved. */
export function leverSays(boat: BoatSpec, lever: number): string {
  const p = boat.power;
  if (!p) return '';
  if (Math.abs(lever) < p.leverStep * 0.5) return 'Neutral. The engine is idling, out of gear, and she will not answer the wheel much';
  const kt = Math.abs(leverSpeed(p, lever)) / KT;
  const burn = `${gal(leverBurn(p, lever)).toFixed(gal(leverBurn(p, lever)) < 3 ? 1 : 0)} gal an hour`;
  let tail = '';
  if (lever < 0) tail = '. The wheel takes her stern the way it is turned';
  else if (kt > p.humpKt && kt < p.planeKt) tail = '. That is on the hump: bow up and thirsty. A step more and she planes';
  else if (lever >= 4) tail = '. Flat out: she drinks it, and any sea will throw her';
  return `${leverName(p, lever)}: ${Math.round(leverRpm(p, lever) / 50) * 50} rpm, about ${kt.toFixed(kt < 10 ? 1 : 0)} kt in flat water, ${burn}${tail}`;
}

/** What she is doing, in a few words, for the readout and for the other boats. Never empty while she is under way. */
export function runningWords(p: PowerSpec, s: Pick<SimState, 'engineOn' | 'engineCrank' | 'throttle' | 'speed'>, o: Pick<SimOutputs, 'plane' | 'aground' | 'sog'>, pounding: boolean): string {
  if (o.aground) return 'Aground';
  if (s.engineCrank > 0) return 'Starting the engine';
  const kt = Math.abs(s.speed) / KT;
  if (!s.engineOn) return o.sog / KT > 0.4 ? 'Adrift, engine off' : 'Lying stopped, engine off';
  if (s.throttle === 0) return kt > 1.5 ? 'Coasting, out of gear' : 'Idling, out of gear';
  if (s.throttle < 0) return 'Going astern';
  if (pounding) return 'Pounding into it';
  if (o.plane >= 0.95) return 'On the plane';
  if (o.plane > 0.05 || kt > p.humpKt) return 'On the hump, bow up';
  return kt < 3.2 ? 'Idling ahead' : 'Under way';
}

/** Nautical miles to the US gallon at this moment, or 0 when she is not going anywhere. */
export function milesPerGallon(sogKt: number, burnLph: number): number {
  return burnLph > 0 && sogKt > 0.5 ? sogKt / gal(burnLph) : 0;
}

/** How far a tank's share will take her at her cruising speed in flat water, nautical miles. */
export function cruiseMiles(boat: BoatSpec, share: number): number {
  const p = boat.power;
  const e = boat.engine;
  if (!p || !e) return 0;
  return milesPerLitre(p, leverFor(p, p.cruiseKt)) * e.tankL * share;
}

/**
 * A line to say as the tank falls through one of `TANK_MARKS`, or null. `was` and `now` are shares of full.
 * The last two are alarms; the caller knows by `urgent`.
 */
export function tankWarning(boat: BoatSpec, was: number, now: number): { text: string; urgent: boolean } | null {
  const e = boat.engine;
  if (!e || !boat.power) return null;
  for (const mark of TANK_MARKS) {
    if (!(was > mark && now <= mark)) continue;
    const miles = Math.round(cruiseMiles(boat, now) / 5) * 5;
    const litres = Math.round(now * e.tankL);
    const have = `${litres} L, ${Math.round(gal(litres))} gal: about ${miles} miles at cruise in flat water, fewer into a sea`;
    if (mark === TANK_MARKS[0]) return { text: `Half a tank gone. ${have}`, urgent: false };
    if (mark === TANK_MARKS[1]) return { text: `A third of a tank left. ${have}. Time to be on the way to a fuel dock`, urgent: false };
    if (mark === TANK_MARKS[2]) return { text: `Fuel down to a fifth: ${have}. Come off the plane and she goes much further on what is left`, urgent: true };
    return { text: `Fuel very low: ${have}. A dock fills the tank`, urgent: true };
  }
  return null;
}

/** The fuel she carries, as the engine panel writes it: litres and US gallons. */
export function fuelText(litres: number): string {
  return `${Math.round(litres)} L · ${Math.round(gal(litres))} gal`;
}

/** The sea's verdict on her speed, for the readout: nothing in flat water or when she is inside it. */
export function comfortNote(p: PowerSpec, s: Pick<SimState, 'speed' | 'throttle' | 'engineOn'>, o: Pick<SimOutputs, 'comfort'>): string {
  const top = p.curve.kt[p.curve.kt.length - 1];
  const comfortKt = o.comfort / KT;
  if (!s.engineOn || s.throttle <= 0 || comfortKt >= top - 0.5) return '';
  const kt = s.speed / KT;
  if (kt > comfortKt + 1.5) return `too fast: the sea allows ${Math.floor(comfortKt)} kt`;
  return `the sea allows ${Math.floor(comfortKt)} kt`;
}
