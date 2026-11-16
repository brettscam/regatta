// Prints the sea state on a water through the day and what it does to each boat.
// Usage: npx vite-node scripts/seastate.ts [course id] [wind boost]
import { readFileSync } from 'node:fs';
import { Sim, KT, D2R, type BoatSpec, type Environment, type SeaSample } from '@slack-tide/sim';
import { ReplayWorld, SeaState, describeSea, steadyWorld, type CourseData, type SeaSpec } from '@slack-tide/world';

const [courseId = 'sf-bay', boost = '1'] = process.argv.slice(2);
const dir = new URL(`../courses/${courseId}/`, import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dir));
const course = JSON.parse(read('course.json').toString()) as CourseData;
const cur = read('current.bin');
const world = new ReplayWorld({ course, current: new Int8Array(cur.buffer, cur.byteOffset, cur.byteLength), depth: new Uint8Array(read('depth.bin')) }, 0);
world.windBoost = Number(boost);
const about = JSON.parse(read('about.json').toString()) as { sea?: SeaSpec };
const seas = new SeaState(world, about.sea ?? course.sea);
const boats = ['sloop30', 'sloop38', 'perf45'].map((id) => JSON.parse(readFileSync(new URL(`../boats/${id}.json`, import.meta.url)).toString()) as BoatSpec);
const pad = (s: string | number, n: number) => String(s).padStart(n);
const local = (h: number) => `${String(Math.floor((8 + h) % 24)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

// ---- the water through the day ------------------------------------------------------------------
const spots: Array<[string, number, number]> = courseId === 'sf-bay'
  ? [['Golden Gate', -2512, -1145], ['The slot, off Alcatraz', 1500, 300], ['City front', 1757, -2100], ['Richardson Bay', -2300, 2700], ['Raccoon Strait', 1300, 4600], ['Lee of Angel Island', 3900, 3300], ['Off Treasure Island', 5600, -900], ['Outside, off Bonita', -8500, -2200]]
  : course.marks.slice(0, 8).map((m) => [m.name, m.x, m.y]);
console.log(`\nThe sea on ${course.name}, wind x${boost}. Height m / period s / length m / steepness, then the words.`);
for (const [name, x, y] of spots) {
  console.log(`\n${name} (${x}, ${y}), charted depth ${world.chartDepth(x, y).toFixed(0)} m`);
  for (const h of [1, 3, 5, 6.5, 8, 9.5, 11, 13, 16, 20, 24, 27, 30, 33]) {
    if (h * 3600 >= world.seasonLength) continue;
    const t = h * 3600;
    const w = world.wind(x, y, t);
    const c = world.current(x, y, t);
    const s = seas.at(x, y, t);
    const set = ((Math.atan2(c.x, c.y) / D2R) + 360) % 360;
    console.log(`  ${local(h)}  wind ${pad((w.speed / KT).toFixed(0), 2)} kt from ${pad(Math.round(w.dir / D2R), 3)}  stream ${(Math.hypot(c.x, c.y) / KT).toFixed(1)} kt to ${pad(Math.round(set), 3)}  fetch ${pad((s.fetch / 1000).toFixed(1), 4)} km  ${s.windHeight.toFixed(2)} m ${s.period.toFixed(1)} s ${pad(s.length.toFixed(0), 2)} m ${s.steepness.toFixed(3)}${s.breaking > 0.05 ? ` breaking ${s.breaking.toFixed(1)}` : ''}  | ${describeSea(s)}`);
  }
}

// ---- the boats in a sea ---------------------------------------------------------------------------
/** A steady wind from the north with a steady sea running with it. */
function seaWorld(twsKt: number, sea: SeaSample | null): Environment {
  const base = steadyWorld({ fromDeg: 0, speedKt: twsKt });
  return { sample: base.sample, sea: () => sea };
}
function sail(boat: BoatSpec, twsKt: number, twaDeg: number, sea: SeaSample | null, seconds = 600) {
  const sim = new Sim(boat, seaWorld(twsKt, sea), { headingDeg: -twaDeg, speedKt: 5 });
  sim.setCrewTrim(true);
  sim.trimForWind();
  sim.setHelm('wind', twaDeg * D2R);
  sim.advance(120);
  const y0 = sim.state.y;
  const x0 = sim.state.x;
  const slams0 = sim.state.slams;
  let sum = 0;
  let swing = 0;
  let n = 0;
  const h0 = sim.state.heading;
  for (let i = 0; i < seconds * 60; i++) {
    sim.step();
    sum += sim.state.speed;
    swing = Math.max(swing, Math.abs(Math.atan2(Math.sin(sim.state.heading - h0), Math.cos(sim.state.heading - h0))));
    n++;
  }
  return { kt: sum / n / KT, vmg: (sim.state.y - y0) / seconds / KT, made: Math.hypot(sim.state.x - x0, sim.state.y - y0) / seconds / KT, slams: ((sim.state.slams - slams0) * 60) / seconds, swing: swing / D2R, gybes: sim.state.crashGybes };
}
const SEAS: Array<[string, SeaSample | null]> = [
  ['flat water', null],
  ['0.5 m steep chop (9 m long)', { height: 0.5, length: 9, dir: 0, steepness: 0.5 / 9 }],
  ['1.2 m steep chop (17 m long)', { height: 1.2, length: 17, dir: 0, steepness: 1.2 / 17 }],
];
for (const tws of [14, 20]) {
  console.log(`\nBeating in ${tws} kt, crew trimming, pilot holding the wind angle. Speed kt / VMG to windward kt / slams a minute.`);
  for (const twa of [44, 50]) {
    console.log(`  true wind angle ${twa}`);
    for (const boat of boats) {
      const cells = SEAS.map(([, sea]) => {
        const r = sail(boat, tws, twa, sea);
        return `${r.kt.toFixed(2)} / ${r.vmg.toFixed(2)} / ${r.slams.toFixed(1)}`;
      });
      console.log(`    ${boat.id.padEnd(8)} ${SEAS.map(([name], i) => `${name}: ${cells[i]}`).join('   ')}`);
    }
  }
}
console.log('\nRunning at 150 in 20 kt, the sea dead downwind. Speed kt / heading swing, degrees either way.');
for (const boat of boats) {
  const cells = SEAS.map(([name, sea]) => {
    const r = sail(boat, 20, 150, sea, 300);
    return `${name}: ${r.kt.toFixed(2)} / ${r.swing.toFixed(1)}`;
  });
  console.log(`    ${boat.id.padEnd(8)} ${cells.join('   ')}`);
}

// ---- the Gate, ebb against flood ---------------------------------------------------------------------
if (courseId === 'sf-bay') {
  const [gx, gy] = [-2512, -1145];
  // The hardest ebb and the hardest flood through the Gate while the afternoon breeze is in (noon to 19:00 on either day).
  let ebb = { t: 0, v: 0 };
  let flood = { t: 0, v: 0 };
  for (let t = 0; t < world.seasonLength; t += 600) {
    const hour = (8 + t / 3600) % 24;
    if (hour < 12 || hour > 19) continue;
    const c = world.current(gx, gy, t);
    // The flood sets east through the Gate, the ebb west.
    if (c.x < ebb.v) ebb = { t, v: c.x };
    if (c.x > flood.v) flood = { t, v: c.x };
  }
  console.log('\nThe Golden Gate in the afternoon breeze: the hardest ebb and the hardest flood of the season');
  for (const [name, at] of [['ebb', ebb], ['flood', flood]] as const) {
    const s = seas.at(gx, gy, at.t, undefined);
    const w = world.wind(gx, gy, at.t);
    console.log(`  ${name.padEnd(5)} ${local(at.t / 3600)} (${(at.t / 3600).toFixed(1)} h in)  wind ${(w.speed / KT).toFixed(0)} kt, stream ${(Math.abs(at.v) / KT).toFixed(1)} kt ${at.v < 0 ? 'out' : 'in'}:  ${describeSea(s)}  (${s.windHeight.toFixed(2)} m, ${s.length.toFixed(0)} m long, steepness ${s.steepness.toFixed(3)}, breaking ${s.breaking.toFixed(2)})`);
    const sea = { height: s.windHeight, length: s.length, dir: 0, steepness: s.steepness };
    for (const boat of boats) {
      const flat = sail(boat, w.speed / KT, 44, null, 300);
      const r = sail(boat, w.speed / KT, 44, sea, 300);
      console.log(`      ${boat.id.padEnd(8)} beating: ${flat.kt.toFixed(2)} kt flat, ${r.kt.toFixed(2)} kt in this sea (VMG ${flat.vmg.toFixed(2)} to ${r.vmg.toFixed(2)}), ${r.slams.toFixed(1)} slams a minute`);
    }
  }
}
