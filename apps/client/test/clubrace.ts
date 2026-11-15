// What every club race must do, on any course: shared by the two test files that sail them (one per water, so they run side by side).
import { describe, expect, it } from 'vitest';
import { LEVELS, entrantOf, hashText } from '../src/race/cast';
import { musterFleet, sailTrialSlowly, type TrialRow } from '../src/race/trial';
import { boatOf, racesOf, worldOf } from './waters';

/** Sailing a whole course five times over takes a while. */
export const LONG = 240000;

/** One boat of each of the given levels, each sailed as if alone so the result is hers and nobody else's. */
export async function sailLevels(water: string, raceId: string, hours: number, seed: string, levels: string[] = LEVELS.map((l) => l.id), boost = 1): Promise<TrialRow[]> {
  const race = racesOf(water).find((r) => r.id === raceId)!;
  const world = worldOf(water, hours, boost);
  const entrants = levels.map((l) => entrantOf(l, hashText(seed + raceId) + LEVELS.findIndex((k) => k.id === l) * 977));
  const rows = await sailTrialSlowly(musterFleet(world, boatOf('sloop38'), race.marks, entrants), world, { limit: 7 * 3600, company: false });
  return levels.map((l) => rows.find((r) => r.level === l)!);
}

/**
 * @param hours when the race is sailed, hours into the season: a time at which the course can be sailed at all.
 * The San Juans are tide-gated: at some hours not even a perfect crew gets round.
 */
export function clubRaceTests(water: string, when: Record<string, number>, more: string[] = ['b', 'c']): void {
  describe(`club racing on ${water}`, () => {
    for (const race of racesOf(water)) {
      const hours = when[race.id];
      if (hours === undefined) continue;
      it(`${race.id}: every level gets round without touching bottom, and the ringer beats the back of the fleet`, async () => {
        const rows = await sailLevels(water, race.id, hours, 'a');
        const [ringer, sharp, steady, casual, sunset] = rows;
        for (const r of rows) {
          expect(r.finish, `${r.level} finishes`).not.toBeNull();
          expect(r.agroundSeconds, `${r.level} aground`).toBe(0);
          expect(r.tows, `${r.level} towed`).toBe(0);
        }
        // The ringer and the sharp boats can swap places on a tide line. Nobody else gets near them.
        const front = Math.min(ringer.finish!, sharp.finish!);
        expect(steady.finish!).toBeGreaterThan(front);
        expect(casual.finish!).toBeGreaterThan(ringer.finish!);
        expect(sunset.finish!).toBeGreaterThan(ringer.finish!);
        expect(sunset.finish!).toBeGreaterThan(steady.finish!);
        // A spread that reads as a club race: the last boat some minutes behind, not a lap.
        const spread = Math.max(casual.finish!, sunset.finish!) / ringer.finish!;
        expect(spread).toBeGreaterThan(1.05);
        expect(spread).toBeLessThan(1.7);
        // Mistakes happened, and to the right people.
        expect(ringer.blunders + ringer.needlessTacks + sharp.blunders).toBe(0);
        expect(casual.blunders + sunset.blunders).toBeGreaterThan(2);
        expect(ringer.late).toBe(0);
        expect(sunset.late).toBeGreaterThan(casual.late * 0.9);
      }, LONG);

      if (more.length) it(`${race.id}: over more races the ringer beats the back-markers nearly always`, async () => {
        let races = 0;
        let won = 0;
        for (const seed of more) {
          const [ringer, casual, sunset] = await sailLevels(water, race.id, hours, seed, ['ringer', 'casual', 'sunset']);
          for (const back of [casual, sunset]) {
            expect(back.finish, `${back.level} finishes`).not.toBeNull();
            expect(back.agroundSeconds + back.tows).toBe(0);
            races++;
            if (ringer.finish! < back.finish!) won++;
          }
        }
        expect(won).toBeGreaterThanOrEqual(races - 1);
      }, LONG);
    }
  });
}
