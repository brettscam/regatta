import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, type CourseData } from '@slack-tide/world';
import { puffAt, windAt, windNodes } from '../src/scene/seaField';

// The sea is painted with the gusts the sim will sail into. This holds the painter's sum against the world's.
for (const id of ['sf-bay', 'san-juans']) {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../courses', id);
  const course = JSON.parse(readFileSync(resolve(dir, 'course.json'), 'utf8')) as CourseData;
  const bin = (name: string) => readFileSync(resolve(dir, name));
  const data = { course, current: new Int8Array(bin(course.current.file).buffer.slice(0)), depth: new Uint8Array(bin(course.depth.file)) };

  describe(`gusts on the water, ${id}`, () => {
    it('are where the world has them, hours into the season and at any boost', () => {
      let seed = 7;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (const [hours, boost] of [[0.2, 1], [5.5, 1], [6.5, 1.5], [21, 0.6], [33.7, 2]] as const) {
        const world = new ReplayWorld(data, hours * 3600);
        world.windBoost = boost;
        const t = 600 * rnd();
        const season = world.seasonTime(t);
        const grid = windNodes(course, season, boost);
        const b = course.bounds;
        for (let n = 0; n < 200; n++) {
          const x = b.x0 + (b.x1 - b.x0) * rnd();
          const y = b.y0 + (b.y1 - b.y0) * rnd();
          const base = world.wind(x, y, t);
          if (base.speed < 0.6) continue;
          const air = windAt(grid, x, y);
          // The same hourly wind, to well under a millimetre a second.
          expect(Math.hypot(air.u, air.v)).toBeCloseTo(base.speed, 8);
          const felt = world.gustyWind(x, y, t).speed / base.speed - 1;
          expect(puffAt(air.u, air.v, air.gust, x, y, season)).toBeCloseTo(felt, 6);
        }
      }
    });
  });
}
