// Sails a race course on the route pilot and reports how it went. Usage: npx vite-node scripts/sailcourse.ts <race id> [hours into season] [boat id] [wind boost]
// The sea is running, as it is in the game. SEA=0 in the environment sails it on flat water.
// A long ocean race is given up to 40 hours.
// It is the check that a course can be sailed start to finish without the pilot putting her ashore.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Sim, KT, type BoatSpec } from '@slack-tide/sim';
import { trackFix } from '@slack-tide/nav';
import { ReplayWorld, SeaState, type CourseData, type SeaSpec } from '@slack-tide/world';

type RaceDef = { id: string; name: string; marks: Array<{ name: string; x: number; y: number }> };
const [raceId = 'strait-cove', hours = '5.6', boatId = 'sloop38', boost = '1'] = process.argv.slice(2);
// The race is looked for on every water under courses/, so one id is enough to say which water as well.
const waters = readdirSync(new URL('../courses/', import.meta.url)).filter((w) => existsSync(new URL(`../courses/${w}/races.json`, import.meta.url)));
const water = waters.find((w) => (JSON.parse(readFileSync(new URL(`../courses/${w}/races.json`, import.meta.url)).toString()) as RaceDef[]).some((r) => r.id === raceId));
if (!water) throw new Error(`No race ${raceId}`);
const dir = new URL(`../courses/${water}/`, import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dir));
const course = JSON.parse(read('course.json').toString()) as CourseData;
const cur = read('current.bin');
const race = (JSON.parse(read('races.json').toString()) as RaceDef[]).find((r) => r.id === raceId)!;
const boat = JSON.parse(readFileSync(new URL(`../boats/${boatId}.json`, import.meta.url)).toString()) as BoatSpec;
const world = new ReplayWorld({ course, current: new Int8Array(cur.buffer, cur.byteOffset, cur.byteLength), depth: new Uint8Array(read('depth.bin')) }, Number(hours) * 3600);
world.windBoost = Number(boost);
// The longest she is given, hours: four on the Bay, as before, and up to forty for an ocean race.
const length = race.marks.slice(1).reduce((sum, m, i) => sum + Math.hypot(m.x - race.marks[i].x, m.y - race.marks[i].y), 0);
const LIMIT_HOURS = Math.max(4, Math.min(40, (length / 1852) * 0.75));

if (process.env.SEA !== '0') world.seas = new SeaState(world, (JSON.parse(read('about.json').toString()) as { sea?: SeaSpec }).sea ?? course.sea);
let worstSea = 0;

const marks = race.marks;
const along = Math.atan2(marks[1].x - marks[0].x, marks[1].y - marks[0].y);
const start = { x: marks[0].x - Math.sin(along) * 200, y: marks[0].y - Math.cos(along) * 200 };
const sim = new Sim(boat, world, { x: start.x, y: start.y, headingDeg: (along * 180) / Math.PI, speedKt: 4 });
let leg = 0;
let legStart = { ...start };
sim.setRoute(marks[0], legStart);
sim.setCrewTrim(true);
sim.trimForWind();
let aground = 0;
let lastReport = 0;
const ARRIVAL = 130;
for (let i = 0; i < 60 * 3600 * LIMIT_HOURS && leg < marks.length; i++) {
  // The recorded weather is 36 hours long: at its end the day comes round again, as it does in the game.
  world.wrapSeason(sim.state.t);
  sim.step();
  const s = sim.state;
  if (i % 600 === 0 && world.seas) worstSea = Math.max(worstSea, world.seas.at(s.x, s.y, s.t).height);
  if (sim.out.aground) {
    aground++;
    if (aground === 600) {
      const w = world.wind(s.x, s.y, s.t);
      const c = world.current(s.x, s.y, s.t);
      console.log(`AGROUND on the leg to ${marks[leg].name} at x=${Math.round(s.x)} y=${Math.round(s.y)}, ${(s.t / 60).toFixed(1)} min in. Depth here ${world.depth(s.x, s.y, s.t).toFixed(1)} m. Wind ${(w.speed / KT).toFixed(0)} kt from ${Math.round((w.dir * 180) / Math.PI)}°, stream ${(Math.hypot(c.x, c.y) / KT).toFixed(1)} kt setting ${Math.round(((Math.atan2(c.x, c.y) * 180) / Math.PI + 360) % 360)}°, heading ${Math.round((s.heading * 180) / Math.PI)}°`);
      break;
    }
  } else aground = 0;
  if (s.helmMode === 'hand') { sim.setRoute(marks[leg], legStart); sim.setCrewTrim(true); }
  const next = marks[leg];
  const fix = trackFix(s, legStart, next);
  const len = Math.hypot(next.x - legStart.x, next.y - legStart.y);
  if (fix.toGo < ARRIVAL || (fix.along > len && fix.toGo < ARRIVAL * 4)) {
    console.log(`${next.name.padEnd(18)} at ${(s.t / 60).toFixed(1)} min`);
    leg++;
    legStart = { x: next.x, y: next.y };
    if (marks[leg]) sim.setRoute(marks[leg], legStart);
  }
  if (s.t - lastReport > 300 && process.env.TRACK) { lastReport = s.t; console.log(`   t=${(s.t / 60).toFixed(0)} x=${Math.round(s.x)} y=${Math.round(s.y)} ${(sim.out.sog / KT).toFixed(1)} kt hdg ${Math.round((s.heading * 180) / Math.PI)} depth ${world.depth(s.x, s.y, s.t).toFixed(0)}`); }
}
console.log(leg >= marks.length ? `FINISHED ${race.name} in ${(sim.state.t / 60).toFixed(1)} min (${boatId}, starting ${hours} h into the season${Number(boost) !== 1 ? `, wind x${boost}` : ''}${world.seas ? `; sea up to ${worstSea.toFixed(1)} m, ${sim.state.slams} slams` : '; flat water'})` : `DID NOT FINISH: stopped on leg ${leg + 1} of ${marks.length}`);
