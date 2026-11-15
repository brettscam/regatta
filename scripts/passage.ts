// Sail the James Caird's passage in watches with no drawing, to see what a seed's weather does to it.
// Run with: npx vite-node scripts/passage.ts [seed] [course] [quiet]
// The plan is a plain one: north to clear the ice for a day and a half, then one compass course (045 unless another is
// given) until the land is seen, then for King Haakon Bay by eye. It uses the same watch step, reckoning and wake list
// the game does (`apps/client/src/expedition/`), so what it prints is what a player standing watches would get.
import { KT, R2D, D2R, type BoatSpec } from '../packages/sim/src';
import { ReplayWorld } from '../packages/world/src';
import { advanceReckoning, compassPoint, rhumb } from '../packages/nav/src';
import caird from '../boats/caird.json';
import { buildSea } from '../apps/client/src/expedition/sea';
import { CAIRD } from '../apps/client/src/expedition/voyages/caird';
import { sunAngles } from '../apps/client/src/scene/sun';
import { WAKE_CHECKS, type Facts, type Memory } from '../apps/client/src/expedition/wake';
import { HOVE_TO_DRIFT, SAIL_PLANS, WATCH_STEP, judgedSpeed, measurePerformance, sailPlanFor, watchStep } from '../apps/client/src/expedition/watch';

const spec = caird as unknown as BoatSpec;
const seed = Number(process.argv[2] ?? 7);
const steer = Number(process.argv[3] ?? 45);
const quiet = process.argv[4] === 'quiet';
const NM = 1852;

const sea = buildSea(CAIRD, seed);
const world = new ReplayWorld(sea, CAIRD.castOff * 3600);
const perf = measurePerformance(spec);
const p = sea.projection;
const to = p.toXY(CAIRD.to.lat, CAIRD.to.lon);
const start = sea.starts[0];
let boat = { x: start.x, y: start.y, t: 0, plan: sailPlanFor(world.wind(start.x, start.y, 0).speed / KT, 0), hoveTo: false };
let dr = { x: start.x, y: start.y, run: 0 };
let miles = 0;
let hoveHours = 0;
const memory: Memory = {};
let outcome = '';
const date = (t: number) => world.dateAt(t).toISOString().slice(5, 16).replace('T', ' ');

while (!outcome && boat.t < CAIRD.days * 86400) {
  const seen = memory.seen === 'South Georgia';
  const course = boat.t < 1.6 * 86400 ? 5 * D2R : seen ? Math.atan2(to.x - boat.x, to.y - boat.y) : steer * D2R;
  let called = '';
  let last = watchStep(perf, world, boat, course, 0, spec.dimensions.draft);
  for (let i = 0; i < (4 * 3600) / WATCH_STEP && !called && !outcome; i++) {
    const res = watchStep(perf, world, boat, course, WATCH_STEP, spec.dimensions.draft);
    miles += Math.hypot(res.x - boat.x, res.y - boat.y) / p.scaleAt((res.y + boat.y) / 2) / NM;
    dr = res.hoveTo ? advanceReckoning(dr, res.twd + Math.PI, HOVE_TO_DRIFT, WATCH_STEP) : advanceReckoning(dr, res.heading, judgedSpeed(res.speed, boat.t, seed), WATCH_STEP);
    if (res.hoveTo) hoveHours += WATCH_STEP / 3600;
    boat = res;
    last = res;
    const here = p.toLatLon(boat.x, boat.y);
    const near = sea.land.nearest(boat.x, boat.y, 56000);
    const facts: Facts = {
      t: boat.t, twsKt: res.twsKt, twd: res.twd,
      land: near ? { metres: near.metres, name: near.mass.name, peak: near.mass.peak, bearing: near.bearing } : null,
      sun: sunAngles(world.dateAt(boat.t), here.lat, here.lon).elevation,
      cloud: sea.sky(boat.x, boat.y, world.seasonTime(boat.t)).cloud,
      aground: res.aground, hoveTo: res.hoveTo,
    };
    for (const check of WAKE_CHECKS) {
      const line = check.test(facts, memory);
      if (line && !called) called = line;
    }
    const b = sea.course.bounds;
    if (Math.hypot(boat.x - to.x, boat.y - to.y) < CAIRD.to.radius) outcome = 'arrived';
    else if (res.aground) outcome = 'ashore';
    else if (here.lon > CAIRD.lostEast || boat.x < b.x0 + 4000 || boat.x > b.x1 - 4000 || boat.y < b.y0 + 4000 || boat.y > b.y1 - 4000) outcome = 'lost';
  }
  if (!quiet) {
    const at = p.toLatLon(boat.x, boat.y);
    const by = p.toLatLon(dr.x, dr.y);
    console.log(`day ${(boat.t / 86400).toFixed(2)} ${date(boat.t)}Z  at ${at.lat.toFixed(2)} ${at.lon.toFixed(2)}  by account ${by.lat.toFixed(2)} ${by.lon.toFixed(2)}  wind ${String(Math.round(last.twd * R2D)).padStart(3, '0')} ${String(Math.round(last.twsKt)).padStart(2)} kt  ${(last.hoveTo ? 'hove to' : SAIL_PLANS[last.plan].name).padEnd(12)} steering ${String(Math.round(((course * R2D) + 360) % 360)).padStart(3, '0')}${called ? `  CALLED: ${called}` : ''}`);
  }
}
const out = rhumb(p, dr, boat);
const end = p.toLatLon(boat.x, boat.y);
console.log(`seed ${seed}, steering ${steer}: ${outcome || 'still at sea when the weather ran out'} after ${(boat.t / 86400).toFixed(1)} days (${date(boat.t)}Z) at ${end.lat.toFixed(2)} ${end.lon.toFixed(2)}, ${Math.round(miles)} miles sailed, ${hoveHours.toFixed(0)} hours hove to. Reckoning ${Math.round(out.metres / NM)} miles out: she was ${compassPoint(out.course)} of it. ${Math.ceil(boat.t / 14400)} watches, ${((Math.ceil(boat.t / 14400) * 17) / 60).toFixed(0)} minutes of play at 17 s a watch.`);
