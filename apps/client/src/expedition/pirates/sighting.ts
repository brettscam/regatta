import { compassWords } from '@slack-tide/nav';
import type { Nation, ShipClass } from './tables';

// What the look-out can make of a sail, as it would be: her upper sails lift over the horizon first, then her hull,
// then her colours can be read through the glass, then her guns counted. Pure.

/** Metres to the sea horizon from a height of eye in metres. */
export function horizon(height: number): number {
  return 3570 * Math.sqrt(Math.max(0, height));
}

export type Sight = 'tops' | 'hull' | 'colours' | 'close';

export interface Seeing {
  /** The look-out's height at the masthead and the height of the deck, metres. */
  masthead: number;
  deck: number;
  /** How far the air lets anything be seen, metres: see `visibility`. */
  air: number;
}

/** How far the air lets a sail be seen: seven leagues on a clear day, a mile or two in a squall, little at night. */
export function visibility(sun: number, cloud: number): number {
  if (sun < -0.1) return 3500;
  const day = 38000 - 30000 * Math.max(0, Math.min(1, (cloud - 0.55) / 0.45));
  return sun < 0.03 ? Math.min(day, 9000) : day;
}

/** What can be made out of a ship at a range, or null when she is not in sight. */
export function sight(range: number, cls: Pick<ShipClass, 'masts' | 'freeboard'>, see: Seeing): Sight | null {
  if (range > see.air) return null;
  const tops = Math.max(...cls.masts.map((m) => m.height)) + cls.freeboard;
  // Her upper sails show when the line from the masthead to her mastheads clears the sea.
  if (range > horizon(see.masthead) + horizon(tops)) return null;
  if (range > horizon(see.deck) + horizon(cls.freeboard)) return 'tops';
  if (range > 5500) return 'hull';
  if (range > 1800) return 'colours';
  return 'close';
}

const COLOURS: Record<Nation, string> = {
  english: 'English colours', spanish: 'the cross of Burgundy', french: 'French white', dutch: 'Dutch colours', pirate: 'a black flag',
};

/** How she lies to the watcher: the angle between the line of sight and her keel, as a seaman would say it. */
export function lying(bearingToHer: number, herHeading: number): string {
  // 0 when she is going straight away, pi when she is coming straight on.
  const off = Math.abs(Math.atan2(Math.sin(herHeading - bearingToHer), Math.cos(herHeading - bearingToHer)));
  if (off < 0.4) return 'stern to us, going away';
  if (off > Math.PI - 0.4) return 'bows on, standing toward us';
  const right = Math.sin(herHeading - bearingToHer) > 0;
  if (off < 1.2) return `going from us, showing her ${right ? 'larboard' : 'starboard'} quarter`;
  if (off > Math.PI - 1.2) return `closing, showing her ${right ? 'larboard' : 'starboard'} bow`;
  return `broadside on, crossing ${right ? 'left to right' : 'right to left'}`;
}

/**
 * The spyglass line: what the look-out says of her at what he can see.
 * @param bearing from the watcher to her, radians
 */
export function describe(what: Sight, cls: Pick<ShipClass, 'name' | 'rigWords' | 'guns'>, nation: Nation, range: number, bearing: number, heading: number): string {
  const miles = range / 1852;
  const far = miles >= 10 ? `${Math.round(miles)} miles` : miles >= 1 ? `${miles.toFixed(1)} miles` : `${Math.round(range / 10) * 10} yards`;
  const where = `${compassWords(bearing)}, ${far}`;
  if (what === 'tops') return `A sail, hull down to the ${where}. ${capital(cls.rigWords.split(':')[0])}`;
  const head = `steering ${compassWords(heading)}, ${lying(bearing, heading)}`;
  if (what === 'hull') return `${capital(cls.rigWords)}. ${capital(where)}, ${head}`;
  if (what === 'colours') return `A ${cls.name} under ${COLOURS[nation]}. ${capital(where)}, ${head}`;
  return `A ${cls.name} under ${COLOURS[nation]}, ${cls.guns} guns. ${capital(far)} to the ${compassWords(bearing)}, ${head}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
