import { compassWords } from '@slack-tide/nav';
import { HEAVE_TO_KT, MAKE_SAIL_KT } from './watch';

// What ends a watch and calls the skipper: the list of things that need the player.
// Stage 1 has three (a gale coming on, a storm she cannot sail in, land in sight) and going aground.
// STAGE 2 ADDS ITS OWN HERE: water short, a man failing, ice on the decking, the sea anchor gone, the great wave.
// Each check sees the facts of the moment and keeps what it likes in `memory`, and returns a line to say, or null.

const NM = 1852;

export interface Facts {
  /** Seconds since she cast off. */
  t: number;
  /** Mean wind, knots, and where it is from, radians. */
  twsKt: number;
  twd: number;
  /** The nearest land, if any is within thirty miles: how far, its name, how high it stands, and how it bears from her. */
  land: { metres: number; name: string; peak: number; bearing: number } | null;
  /** Sun's height, radians. */
  sun: number;
  /** Share of sky covered. */
  cloud: number;
  aground: boolean;
  hoveTo: boolean;
}

export type Memory = Record<string, number | boolean | string>;

export interface WakeCheck {
  id: string;
  test(now: Facts, memory: Memory): string | null;
}

/** How far off land of a given height can be made out, metres. Ten miles in the thick weather of the record, twenty on a clear day, very little at night. */
export function sightingRange(peak: number, sun: number, cloud: number, twsKt: number): number {
  if (sun < -0.05) return 3500;
  const air = 30000 - 19000 * Math.min(1, Math.max(0, cloud));
  const height = 0.6 + 0.55 * Math.min(1, peak / 2000);
  const spray = twsKt > 45 ? 0.6 : 1;
  const dusk = sun < 0.03 ? 0.5 : 1;
  return air * height * spray * dusk;
}

export const WAKE_CHECKS: WakeCheck[] = [
  {
    id: 'aground',
    test: (now, m) => {
      const was = m.aground === true;
      m.aground = now.aground;
      return now.aground && !was ? 'She has taken the ground' : null;
    },
  },
  {
    id: 'storm',
    test: (now, m) => {
      if (now.twsKt < MAKE_SAIL_KT) m.storm = false;
      if (now.twsKt >= HEAVE_TO_KT && m.storm !== true) {
        m.storm = true;
        return `It is blowing a storm from the ${compassWords(now.twd)}. She can carry no sail. Lie to the sea anchor until it eases`;
      }
      return null;
    },
  },
  {
    id: 'gale',
    test: (now, m) => {
      if (now.twsKt < 27) m.gale = false;
      if (now.twsKt >= 34 && m.gale !== true) {
        m.gale = true;
        return `Gale from the ${compassWords(now.twd)}, and the sea getting up. Shortened down to storm canvas`;
      }
      return null;
    },
  },
  {
    id: 'land',
    test: (now, m) => {
      // Land is only news once she has been out of sight of it.
      if (!now.land || now.land.metres > 60000) m.offshore = true;
      if (!now.land) return null;
      if (m.offshore !== true || m.seen === now.land.name) return null;
      if (now.land.metres > sightingRange(now.land.peak, now.sun, now.cloud, now.twsKt)) return null;
      m.seen = now.land.name;
      m.offshore = false;
      const miles = Math.max(1, Math.round(now.land.metres / NM));
      return now.sun < -0.05
        ? `Breakers. Land close aboard to the ${compassWords(now.land.bearing)}`
        : `Land. ${now.land.name}, bearing ${compassWords(now.land.bearing)}, about ${miles} ${miles === 1 ? 'mile' : 'miles'} off`;
    },
  },
];
