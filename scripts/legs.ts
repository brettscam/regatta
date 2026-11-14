// Checks a list of marks: depth at each, and the shallowest water along each leg.
// Usage: npx vite-node scripts/legs.ts [course folder] '<json>'    (the folder defaults to sf-bay)
//   the JSON is { "name": [["label", x, y], ...], ... }
// With `files` in place of the JSON it checks the course's own starts, places and races:
//   npx vite-node scripts/legs.ts san-juans files
import { existsSync, readFileSync } from 'node:fs';
import { ReplayWorld, type CourseData } from '@slack-tide/world';

const args = process.argv.slice(2);
const named = args.length > 1 || (args[0] && !args[0].trim().startsWith('{') && args[0] !== 'files');
const id = named ? args.shift()! : 'sf-bay';
const dir = new URL(`../courses/${id}/`, import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const course = read('course.json') as CourseData;
const bin = (f: string) => readFileSync(new URL(f, dir));
const world = new ReplayWorld({ course, current: new Int8Array(bin('current.bin').buffer, bin('current.bin').byteOffset, bin('current.bin').byteLength), depth: new Uint8Array(bin('depth.bin')) }, 0);

type Mark = [string, number, number];
interface Named { name: string; x: number; y: number }
let sets: Record<string, Mark[]>;
if (args[0] === 'files') {
  sets = {};
  const row = (m: Named): Mark => [m.name, m.x, m.y];
  for (const s of read('starts.json') as Array<Named & { id: string; route: Named[] }>) sets[`start ${s.id}`] = [row(s), ...s.route.map(row)];
  for (const r of read('races.json') as Array<{ id: string; marks: Named[] }>) sets[`race ${r.id}`] = r.marks.map(row);
  // Places stand alone: only the depth at each matters.
  for (const p of read('places.json') as Array<Named & { kind: string }>) sets[`place ${p.name} (${p.kind})`] = [row(p)];
  if (existsSync(new URL('traffic.json', dir))) {
    for (const r of (read('traffic.json') as { routes: Array<{ id: string; points: Array<[number, number]> }> }).routes) sets[`traffic ${r.id}`] = r.points.map(([x, y], i) => [`point ${i + 1}`, x, y]);
  }
} else {
  sets = JSON.parse(args[0] ?? '{}');
}

/** How far the tide falls below the chart's datum over the season: a leg must still float a boat then. */
const lowest = Math.max(0, -Math.min(...course.tide.truth));
const need = 4 + lowest;
let bad = 0;
console.log(`${course.name}: lowest water ${lowest.toFixed(1)} m below datum, so legs want ${need.toFixed(1)} m charted`);
for (const [name, marks] of Object.entries(sets)) {
  let total = 0;
  console.log(name);
  marks.forEach(([label, x, y], i) => {
    const here = world.chartDepth(x, y);
    let line = `  ${label.padEnd(18)} depth ${here.toFixed(1).padStart(5)} m${here <= 0 ? '  <-- ON LAND' : ''}`;
    if (here <= 0) bad++;
    if (i > 0) {
      const [, px, py] = marks[i - 1];
      const len = Math.hypot(x - px, y - py);
      total += len;
      let least = 1e9;
      const steps = Math.max(200, Math.ceil(len / 25));
      for (let k = 0; k <= steps; k++) least = Math.min(least, world.chartDepth(px + ((x - px) * k) / steps, py + ((y - py) * k) / steps));
      if (least < need) bad++;
      line += `   leg ${(len / 1852).toFixed(2)} nm, shallowest ${least.toFixed(1)} m${least < need ? '  <-- TOO SHALLOW' : ''}`;
    }
    console.log(line);
  });
  if (marks.length > 1) console.log(`  total ${(total / 1852).toFixed(1)} nm`);
}
if (bad) console.log(`${bad} to fix`);
