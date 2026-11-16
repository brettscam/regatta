// Checks a water's resident boats (courses/<id>/residents.json) against its depth chart for the whole season,
// and prints each boat's timetable and how many are out at each hour.
// Usage: npx vite-node scripts/residents.ts <course>
import { readFileSync } from 'node:fs';
import { NEED, Roster, blankState, seaOf, type ResidentFile } from '../apps/client/src/aboard/residentRules';
import { loadWorld, raceMarks } from './searoute';

const id = process.argv[2] ?? 'sf-bay';
const world = loadWorld(id);
const file = JSON.parse(readFileSync(new URL(`../courses/${id}/residents.json`, import.meta.url), 'utf8')) as ResidentFile;
const sea = seaOf(world, raceMarks(id));
const roster = new Roster(file, sea);
let bad = roster.faults.length;
for (const f of roster.faults) console.log('FAULT', f);
const st = blankState();
const hhmm = (season: number): string => {
  const h = roster.clock(season);
  return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
};
roster.boats.forEach((r, i) => {
  let least = Infinity;
  let where = '';
  let far = 0;
  const modes = new Map<string, number>();
  for (let t = 0; t < sea.length; t += 20) {
    roster.state(i, t, st);
    modes.set(st.mode, (modes.get(st.mode) ?? 0) + 20);
    if (st.mode === 'away') continue;
    const d = sea.depth(st.x, st.y);
    if (d < least) { least = d; where = `${Math.round(st.x)}, ${Math.round(st.y)} at ${hhmm(t)}`; }
    for (const m of sea.marks) far = Math.max(far, 170 - Math.hypot(m.x - st.x, m.y - st.y));
  }
  const need = NEED[r.spec.kind];
  const trips = r.phases.filter((p) => p.dir !== 0 && (p.leg === 0 || p.leg === r.legs.length - 1)).length / (r.legs.length > 1 ? 2 : 1);
  const flag = least < need - (st.mode === 'berth' ? 0 : 0) ? '  <-- TOO SHALLOW' : far > 0 ? '  <-- IN A MARK RING' : '';
  if (flag) bad++;
  console.log(`${r.spec.id.padEnd(12)} ${r.spec.kind.padEnd(9)} least ${least.toFixed(1).padStart(5)} m (${where})  rooms ${r.legs.map((l) => l.room).join(',') || '-'}  trips ${trips}  ${[...modes].map(([m, s]) => `${m} ${(s / 3600).toFixed(1)}h`).join(' ')}${flag}`);
});
// Two boats must not lie on top of one another.
const berths = roster.boats.flatMap((r) => {
  const lie = r.spec.lie ?? ['mooring', 'anchor'];
  const pts = r.spec.points;
  return [0, 1].filter((e) => lie[e] !== 'away' && (e === 0 || pts.length > 1)).map((e) => ({ id: r.spec.id, x: pts[e ? pts.length - 1 : 0][0], y: pts[e ? pts.length - 1 : 0][1] }));
});
for (let i = 0; i < berths.length; i++) for (let j = i + 1; j < berths.length; j++) {
  const d = Math.hypot(berths[i].x - berths[j].x, berths[i].y - berths[j].y);
  if (berths[i].id !== berths[j].id && d < 70) { bad++; console.log(`BERTHS ${berths[i].id} and ${berths[j].id} lie ${Math.round(d)} m apart at ${berths[i].x}, ${berths[i].y}`); }
}
console.log('hour  showing  under way  under sail');
for (let t = 0; t < sea.length; t += 3600) {
  const a = roster.afloat(t + 1800);
  console.log(`${hhmm(t + 1800)}  ${String(a.showing).padStart(7)}  ${String(a.underWay).padStart(9)}  ${String(a.sails).padStart(10)}`);
}
console.log(bad ? `${bad} to fix` : 'All clear');
