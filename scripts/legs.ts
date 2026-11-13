// Checks a list of marks: depth at each, and the shallowest water along each leg. Usage: npx vite-node scripts/legs.ts
import { readFileSync } from 'node:fs';
import { ReplayWorld, type CourseData } from '@slack-tide/world';

const dir = new URL('../courses/sf-bay/', import.meta.url);
const course = JSON.parse(readFileSync(new URL('course.json', dir), 'utf8')) as CourseData;
const bin = (f: string) => readFileSync(new URL(f, dir));
const world = new ReplayWorld({ course, current: new Int8Array(bin('current.bin').buffer, bin('current.bin').byteOffset, bin('current.bin').byteLength), depth: new Uint8Array(bin('depth.bin')) }, 0);

const sets: Record<string, Array<[string, number, number]>> = JSON.parse(process.argv[2] ?? '{}');
for (const [name, marks] of Object.entries(sets)) {
  let total = 0;
  console.log(name);
  marks.forEach(([label, x, y], i) => {
    let line = `  ${label.padEnd(18)} depth ${world.chartDepth(x, y).toFixed(1).padStart(5)} m`;
    if (i > 0) {
      const [, px, py] = marks[i - 1];
      const len = Math.hypot(x - px, y - py);
      total += len;
      let least = 1e9;
      for (let k = 0; k <= 200; k++) least = Math.min(least, world.chartDepth(px + ((x - px) * k) / 200, py + ((y - py) * k) / 200));
      line += `   leg ${(len / 1852).toFixed(2)} nm, shallowest ${least.toFixed(1)} m${least < 4 ? '  <-- TOO SHALLOW' : ''}`;
    }
    console.log(line);
  });
  console.log(`  total ${(total / 1852).toFixed(1)} nm`);
}
