// Prints a water's weather through its season at a few places: wind, gust, stream and tide by the hour.
// For writing start times and blurbs that say what the day really did.
// Usage: npx vite-node scripts/weather.ts <course folder> '<json>'   the JSON is { "name": [x, y], ... }; left out, the course's marks
import { readFileSync } from 'node:fs';
import { KT } from '@slack-tide/sim';
import { ReplayWorld, type CourseData } from '@slack-tide/world';

const [id = 'sf-bay', places] = process.argv.slice(2);
const dir = new URL(`../courses/${id}/`, import.meta.url);
const course = JSON.parse(readFileSync(new URL('course.json', dir), 'utf8')) as CourseData;
const bin = (f: string) => readFileSync(new URL(f, dir));
const cur = bin('current.bin');
const world = new ReplayWorld({ course, current: new Int8Array(cur.buffer, cur.byteOffset, cur.byteLength), depth: new Uint8Array(bin('depth.bin')) }, 0);
const at: Record<string, [number, number]> = places ? JSON.parse(places) : Object.fromEntries(course.marks.slice(0, 6).map((m) => [m.name, [m.x, m.y]]));
const deg = (rad: number) => String(Math.round(((rad * 180) / Math.PI + 360) % 360)).padStart(3, '0');
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: course.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
console.log(`${course.name}: wind kt from° (gust), stream kt setting°`);
console.log(`${'hour'.padEnd(16)}tide m  ${Object.keys(at).map((n) => n.padEnd(26)).join('')}`);
for (let h = 0; h <= course.season.hours; h++) {
  const t = h * 3600;
  let line = `${String(h).padStart(2)} ${clock.format(world.dateAt(t)).padEnd(13)}${world.tide(t).toFixed(2).padStart(5)}   `;
  for (const [x, y] of Object.values(at)) {
    const w = world.wind(x, y, t);
    const c = world.current(x, y, t, { x: 0, y: 0 });
    line += `${(w.speed / KT).toFixed(0).padStart(2)} ${deg(w.dir)} (${(world.gust(x, y, t) / KT).toFixed(0).padStart(2)})  ${(Math.hypot(c.x, c.y) / KT).toFixed(1)} ${deg(Math.atan2(c.x, c.y))}`.padEnd(26);
  }
  console.log(line);
}
