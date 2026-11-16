// Prints a water's shipping: every one-way passage of the first day in the order the ships come on to the chart,
// and the closest any two ships ever come. Usage: npx vite-node scripts/shipping.ts [course folder]
import { readFileSync } from 'node:fs';
import { Track, type TrafficSpec } from '../apps/client/src/scene/traffic';

const id = process.argv[2] ?? 'farallones';
const spec = JSON.parse(readFileSync(new URL(`../courses/${id}/traffic.json`, import.meta.url), 'utf8')) as TrafficSpec;
const ref = spec.referenceHours * 3600;
const ships = spec.routes.filter((r) => r.mode === 'oneway');
const tracks = ships.map((r) => new Track(r, ref));
const clock = (t: number) => {
  const h = (((t / 3600 + 8) % 24) + 24) % 24;
  return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
};
const rows = ships.map((r, i) => {
  const start = ((ref - r.phase) % tracks[i].cycle + tracks[i].cycle) % tracks[i].cycle;
  return { r, start, end: start + tracks[i].travel, every: tracks[i].cycle };
}).sort((a, b) => a.start - b.start);
console.log('on the chart  off it  every   kt   m  vessel');
for (const { r, start, end, every } of rows) {
  const lane = (r as unknown as { lane?: string }).lane;
  console.log(`${clock(start)}         ${clock(end)}   ${(every / 3600).toFixed(0).padStart(2)} h  ${String(r.speedKt).padStart(4)} ${String(r.length).padStart(3)}  ${r.name} (${r.model}${lane ? `, ${r.id.endsWith('-in') ? 'in by' : 'out by'} the ${lane} lane` : ''})`);
}
let closest = { d: 1e9, a: '', b: '', t: 0, x: 0, y: 0 };
const a = { x: 0, y: 0, heading: 0, sog: 0, active: true };
const b = { x: 0, y: 0, heading: 0, sog: 0, active: true };
for (let t = 0; t < 86400; t += 20) {
  for (let i = 0; i < ships.length; i++) {
    tracks[i].state(t, a);
    if (!a.active) continue;
    for (let j = i + 1; j < ships.length; j++) {
      tracks[j].state(t, b);
      if (!b.active) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < closest.d) closest = { d, a: ships[i].id, b: ships[j].id, t, x: a.x, y: a.y };
    }
  }
}
console.log(`closest: ${closest.a} and ${closest.b}, ${closest.d.toFixed(0)} m apart at ${clock(closest.t)} near ${Math.round(closest.x)}, ${Math.round(closest.y)}`);
