// Sails a whole race of pace boats with nobody watching and prints the results.
// Usage: npx vite-node scripts/sailrace.ts <race id> [pace boats 1-9] [beer|mixed|hot|levels] [hours into season] [boat id] [wind boost] [race call id]
// "levels" enters one boat of each skill instead of drawing a fleet. The race call id is what the draw is hashed from:
// the same id gives the same fleet and the same race, as it does for every player in it.
import { KT } from '@slack-tide/sim';
import { LEVELS, drawEntrants, entrantOf, hashText, readMix } from '../apps/client/src/race/cast';
import { musterFleet, sailTrial } from '../apps/client/src/race/trial';
import { allRaces, boatOf, worldOf } from '../apps/client/test/waters';

const [raceId = 'alcatraz-lap', paceArg = '9', mixArg = 'beer', hours = '5.5', boatId = 'sloop38', boost = '1', callId = 'trial-1'] = process.argv.slice(2);
const found = allRaces().find((r) => r.race.id === raceId);
if (!found) throw new Error(`No race ${raceId}. There are: ${allRaces().map((r) => r.race.id).join(', ')}`);
const world = worldOf(found.water, Number(hours), Number(boost));
const spec = boatOf(boatId);
const entrants = mixArg === 'levels' ? LEVELS.map((l, i) => entrantOf(l.id, hashText(callId) + i * 977)) : drawEntrants(callId, Number(paceArg), readMix(mixArg));
const started = Date.now();
const rows = sailTrial(musterFleet(world, spec, found.race.marks, entrants), world, { limit: 5 * 3600 });
const w = world.wind(found.race.marks[0].x, found.race.marks[0].y, 0);
const clock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
console.log(`${found.race.name} (${found.water}), ${boatId}, ${hours} h into the season, wind x${boost}: ${(w.speed / KT).toFixed(0)} kt at the start. Call "${callId}", ${mixArg}.`);
console.log('   skipper                 boat                 level    late  time      gap     tacks needless blunders knocked trips aground tows');
const first = rows[0]?.finish ?? 0;
rows.forEach((r, i) => {
  const time = r.finish === null ? `DNF leg ${r.leg}` : clock(r.finish);
  const gap = r.finish === null ? `${(r.remaining / 1852).toFixed(1)} nm` : i === 0 ? '' : `+${clock(r.finish - first).slice(2)}`;
  console.log(`${String(i + 1).padStart(2)} ${r.skipper.padEnd(23)} ${r.boat.padEnd(20)} ${r.level.padEnd(7)} ${String(Math.round(r.late)).padStart(4)}s  ${time.padEnd(9)} ${gap.padEnd(8)} ${String(r.tacks).padStart(4)} ${String(r.needlessTacks).padStart(8)} ${String(r.blunders).padStart(8)} ${String(r.knockdowns).padStart(7)} ${String(r.pilotTrips).padStart(5)} ${r.agroundSeconds.toFixed(0).padStart(6)}s ${String(r.tows).padStart(4)}`);
});
console.log(`Sailed in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
