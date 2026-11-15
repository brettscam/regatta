// How the James Caird sails, and what her sea is like. Run with: npx vite-node scripts/caird.ts [seed]
// Prints the performance table the watch reckoning reads (measured from the sim), a comparison of an hour of real
// time against an hour of watch, the size of the made sea, and the wind at the boat's recorded position day by day.
import { Sim, KT, R2D, D2R, type BoatSpec } from '../packages/sim/src';
import { ReplayWorld } from '../packages/world/src';
import caird from '../boats/caird.json';
import { buildSea } from '../apps/client/src/expedition/sea';
import { CAIRD } from '../apps/client/src/expedition/voyages/caird';
import { SAIL_PLANS, WATCH_STEP, measurePerformance, sailPlanFor, watchStep } from '../apps/client/src/expedition/watch';
import { significantHeight } from '../apps/client/src/expedition/swell';

const spec = caird as unknown as BoatSpec;
const seed = Number(process.argv[2] ?? 7);

let t0 = performance.now();
const perf = measurePerformance(spec);
console.log(`Performance table measured in ${(performance.now() - t0).toFixed(0)} ms`);
console.log(`\nSpeed through the water, knots (leeway, degrees), by true wind angle:\n  wind  sail          ${perf.twa.map((a) => String(a).padStart(9)).join('')}`);
perf.tws.forEach((w, j) => {
  const plan = SAIL_PLANS[sailPlanFor(w, w === 17.9 || w === 27.9 ? 0 : 2)].name;
  console.log(`  ${String(w).padStart(4)}  ${plan.padEnd(13)} ${perf.speed[j].map((v, i) => `${(v / KT).toFixed(1)} (${(perf.leeway[j][i] * R2D).toFixed(0).padStart(2)})`.padStart(9)).join('')}`);
});

t0 = performance.now();
const sea = buildSea(CAIRD, seed);
const built = performance.now() - t0;
const c = sea.course;
const windBytes = c.wind.truth.length * c.wind.nx * c.wind.ny * 3 * 2;
const landBytes = sea.patches.reduce((n, p) => n + p.heights.length, 0);
console.log(`\nSea for seed ${seed} built in ${built.toFixed(0)} ms`);
console.log(`  bounds ${((c.bounds.x1 - c.bounds.x0) / 1000).toFixed(0)} km by ${((c.bounds.y1 - c.bounds.y0) / 1000).toFixed(0)} km`);
console.log(`  wind    ${c.wind.nx} x ${c.wind.ny} cells of ${c.wind.dx / 1000} km, ${c.wind.truth.length} hours: ${(windBytes / 1e6).toFixed(2)} MB`);
console.log(`  stream  ${c.current.nx} x ${c.current.ny}: ${(sea.current.length / 1e6).toFixed(3)} MB`);
console.log(`  depth   ${c.depth.nx} x ${c.depth.ny} cells of ${c.depth.dx} m: ${(sea.depth.length / 1e6).toFixed(2)} MB`);
console.log(`  terrain ${sea.patches.map((p) => `${p.grid.nx} x ${p.grid.ny}`).join(' and ')} cells of ${sea.patches[0].grid.dx} m: ${(landBytes / 1e6).toFixed(2)} MB`);
console.log(`  total   ${((windBytes + sea.current.length + sea.depth.length + landBytes) / 1e6).toFixed(2)} MB in memory, nothing shipped`);
const p = sea.projection;
const from = p.toXY(CAIRD.from.lat, CAIRD.from.lon);
const to = p.toXY(CAIRD.to.lat, CAIRD.to.lon);
console.log(`  chart scale at ${CAIRD.from.name}: ${((p.scaleAt(from.y) - 1) * 100).toFixed(1)}%, at ${CAIRD.to.name}: ${((p.scaleAt(to.y) - 1) * 100).toFixed(1)}%`);

const world = new ReplayWorld(sea, CAIRD.castOff * 3600);
console.log('\nWind where the record had her, at noon each day (this seed), and the sea it raises:');
for (const day of CAIRD.script.slice(0, 17)) {
  const f = Math.min(1, day.day / 16);
  const x = from.x + (to.x - from.x) * f;
  const y = from.y + (to.y - from.y) * f;
  const t = (day.day * 24 + 12 - CAIRD.castOff) * 3600;
  const w = world.wind(x, y, Math.max(0, t));
  let peak = 0;
  for (let h = 0; h < 24; h++) peak = Math.max(peak, world.wind(x, y, Math.max(0, (day.day * 24 + h - CAIRD.castOff) * 3600)).speed / KT);
  console.log(`  ${day.date.padEnd(9)} from ${String(Math.round(w.dir * R2D)).padStart(3, '0')} at ${(w.speed / KT).toFixed(0).padStart(2)} kt, peak ${peak.toFixed(0).padStart(2)} kt, sea ${significantHeight(peak).toFixed(1)} m  [${day.sure}]`);
}

// An hour by the sim against an hour by the watch reckoning, from the same place in the same weather.
for (const [label, hoursOut, courseDeg] of [['first afternoon, steering north', 0, 5], ['fourth day, steering north-east', 80, 50], ['tenth day, steering north-east', 228, 50]] as const) {
  const f = Math.min(1, hoursOut / 384);
  const x = from.x + (to.x - from.x) * f;
  const y = from.y + (to.y - from.y) * f;
  const t = hoursOut * 3600;
  const tws = world.wind(x, y, t).speed / KT;
  const plan = sailPlanFor(tws, 0);
  const sim = new Sim(spec, world, { x, y, headingDeg: courseDeg, speedKt: 2, reef: SAIL_PLANS[plan].reef, furl: SAIL_PLANS[plan].furl });
  sim.state.tick = Math.round(t * 60);
  sim.state.t = sim.state.tick / 60;
  sim.setCrewTrim(true);
  sim.trimForWind();
  sim.setHelm('heading', courseDeg * D2R);
  sim.advance(3600);
  let b = { x, y, t, plan, hoveTo: false };
  for (let i = 0; i < 3600 / WATCH_STEP; i++) b = watchStep(perf, world, b, courseDeg * D2R, WATCH_STEP, spec.dimensions.draft);
  const run = Math.hypot(sim.state.x - x, sim.state.y - y);
  const gap = Math.hypot(sim.state.x - b.x, sim.state.y - b.y);
  console.log(`\n${label}: wind ${tws.toFixed(0)} kt, ${SAIL_PLANS[plan].name}. Sim ran ${(run / 1852).toFixed(2)} miles, watch ${(Math.hypot(b.x - x, b.y - y) / 1852).toFixed(2)}. Apart by ${gap.toFixed(0)} m (${((gap / run) * 100).toFixed(1)}% of the run)`);
}
