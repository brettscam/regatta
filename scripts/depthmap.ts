import { readFileSync } from 'node:fs';
import { ReplayWorld, type CourseData } from '@slack-tide/world';
const dir = '/home/user/regatta/courses/sf-bay/';
const course = JSON.parse(readFileSync(dir + 'course.json', 'utf8')) as CourseData;
const cur = readFileSync(dir + 'current.bin');
const world = new ReplayWorld({ course, current: new Int8Array(cur.buffer, cur.byteOffset, cur.byteLength), depth: new Uint8Array(readFileSync(dir + 'depth.bin')) }, 0);
const [x0, x1, y0, y1, step] = process.argv.slice(2).map(Number);
const ch = (d: number) => (d <= 0 ? '#' : d < 3 ? '.' : d < 6 ? '-' : d < 10 ? '=' : d < 20 ? 'o' : 'O');
console.log(`x ${x0}..${x1} step ${step}; rows are y from ${y1} down to ${y0}.  # land  . <3 m  - <6  = <10  o <20  O deep`);
for (let y = y1; y >= y0; y -= step) { let row = ''; for (let x = x0; x <= x1; x += step) row += ch(world.chartDepth(x, y)); console.log(String(y).padStart(5), row); }
