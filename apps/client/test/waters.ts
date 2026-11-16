// Loads a water and a boat from the repo's data for a test or a script: no browser, no network.
import { readFileSync } from 'node:fs';
import type { BoatSpec } from '@slack-tide/sim';
import { ReplayWorld, type CourseData } from '@slack-tide/world';

export interface RaceData { id: string; name: string; marks: Array<{ name: string; x: number; y: number }> }
export const WATERS = ['sf-bay', 'san-juans', 'bvi'] as const;

const root = new URL('../../../', import.meta.url);
const cache = new Map<string, { course: CourseData; current: Int8Array; depth: Uint8Array; races: RaceData[] }>();

function load(water: string) {
  let w = cache.get(water);
  if (!w) {
    const read = (f: string) => readFileSync(new URL(`courses/${water}/${f}`, root));
    const cur = read('current.bin');
    w = {
      course: JSON.parse(read('course.json').toString()) as CourseData,
      current: new Int8Array(cur.buffer, cur.byteOffset, cur.byteLength),
      depth: new Uint8Array(read('depth.bin')),
      races: JSON.parse(read('races.json').toString()) as RaceData[],
    };
    cache.set(water, w);
  }
  return w;
}

/** The races of a water. */
export const racesOf = (water: string): RaceData[] => load(water).races;

/** Every race in the game, with its water. */
export const allRaces = (): Array<{ water: string; race: RaceData }> => WATERS.flatMap((water) => racesOf(water).map((race) => ({ water, race })));

/**
 * A water as it was `hours` into its season.
 * @param boost the wind against the record: 1.5 is the join screen's Extreme
 */
export function worldOf(water: string, hours: number, boost = 1): ReplayWorld {
  const w = load(water);
  const world = new ReplayWorld({ course: w.course, current: w.current, depth: w.depth }, hours * 3600);
  world.windBoost = boost;
  return world;
}

export const boatOf = (id: string): BoatSpec => JSON.parse(readFileSync(new URL(`boats/${id}.json`, root)).toString()) as BoatSpec;
