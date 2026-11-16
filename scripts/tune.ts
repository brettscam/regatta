// Prints steady-state numbers for tuning the boat against the PRD targets.
// Run with: npx vite-node scripts/tune.ts [boat id]
import { Sim, KT, D2R, R2D, bestVmgAngle, polarSpeed, type BoatSpec } from '../packages/sim/src';
import { steadyWorld } from '../packages/world/src';
import { readFileSync } from 'node:fs';

// Usage: npx vite-node scripts/tune.ts [boat id]. The 38 when none is given.
const boatJson = JSON.parse(readFileSync(new URL(`../boats/${process.argv[2] ?? 'sloop38'}.json`, import.meta.url), 'utf8'));

const boat = boatJson as unknown as BoatSpec;

export function settle(twsKt: number, twaDeg: number, reef = 0, furl = 1, seconds = 240) {
  const sim = new Sim(boat, steadyWorld({ fromDeg: 0, speedKt: twsKt }), { headingDeg: -twaDeg, speedKt: 5, reef, furl });
  sim.state.crewTrim = true;
  sim.trimForWind();
  sim.setHelm('wind', twaDeg * D2R);
  sim.advance(seconds);
  return { kt: sim.state.speed / KT, heel: Math.abs(sim.state.heel) * R2D, awa: Math.abs(sim.out.awa) * R2D, aws: sim.out.aws / KT, twa: sim.out.twa * R2D, sim };
}

// Close-hauled is 42 degrees for a sloop. A boat that cannot point says so in her file.
const close = boat.handling?.closeHauledDeg ?? 42;
console.log(`Upwind at TWA ${close}: speed (heel) for full / reef 1 / reef 2`);
for (let tws = 8; tws <= 30; tws += 1) {
  const r = [0, 1, 2].map((reef) => settle(tws, close, reef));
  const best = r.reduce((bi, x, i) => (x.kt > r[bi].kt + 1e-6 ? i : bi), 0);
  console.log(String(tws).padStart(3), r.map((x) => `${x.kt.toFixed(2)} (${x.heel.toFixed(0)})`).join('   '), '  best:', ['full', 'reef1', 'reef2'][best]);
}

console.log('\nSpeed vs polar, crew trimming, full sail');
for (const tws of [8, 12, 16, 20]) {
  const row = [45, 60, 90, 110, 135, 160].map((twa) => {
    const s = settle(tws, twa);
    return `${twa}:${s.kt.toFixed(2)}/${polarSpeed(boat.polar, twa, tws).toFixed(2)} h${s.heel.toFixed(0)}`;
  });
  console.log(String(tws).padStart(3), row.join('  '));
}

const v = bestVmgAngle(boat.polar, 14);
console.log('\nBest VMG angle at 14 kt:', v);
const a = settle(14, v.twaDeg);
const b = settle(14, -v.twaDeg);
console.log('Tacking angle over ground at 14 kt:', (() => { const d = Math.abs(a.sim.out.cog - b.sim.out.cog) * R2D; return Math.min(d, 360 - d).toFixed(1); })());
