// Checks a water's dive sites against its depth chart, the way `legs.ts` checks marks: `npx vite-node scripts/divesites.ts <water>`.
// For each site it prints the charted depth at the site and, where that is not water a boat can lie in and a diver
// can use (about 6 to 18 m), the nearest point that is.
import { readFileSync } from 'node:fs';
import { worldOf } from '../apps/client/test/waters';

const water = process.argv[2] ?? 'catalina';
const file = JSON.parse(readFileSync(new URL(`../courses/${water}/dives.json`, import.meta.url)).toString()) as { sites: Array<{ id: string; x: number; y: number; r: number; depth: [number, number] }> };
const world = worldOf(water, 3);
for (const site of file.sites) {
  const here = world.chartDepth(site.x, site.y);
  const good = (d: number) => d >= 6 && d <= 18;
  let best: { x: number; y: number; d: number; r: number } | null = null;
  for (let r = 0; r <= 900 && !best; r += 25) {
    const n = Math.max(1, Math.round((2 * Math.PI * r) / 25));
    for (let k = 0; k < n && !best; k++) {
      const a = (2 * Math.PI * k) / n;
      const x = site.x + Math.sin(a) * r;
      const y = site.y + Math.cos(a) * r;
      // Water all round it, too: a boat swings, and the bottom is built for 45 m about the diver.
      const d = world.chartDepth(x, y);
      if (good(d) && [0, 1, 2, 3].every((q) => world.chartDepth(x + Math.sin(q * 1.57) * 40, y + Math.cos(q * 1.57) * 40) > 3)) best = { x: Math.round(x), y: Math.round(y), d, r };
    }
  }
  console.log(`${site.id.padEnd(16)} charted ${here.toFixed(1).padStart(5)} m at ${site.x}, ${site.y}${good(here) ? '' : best ? `   -> ${best.d.toFixed(1)} m at ${best.x}, ${best.y} (${best.r} m off)` : '   -> nothing between 6 and 18 m within 900 m: a tender dive, on the site\'s own depths'}`);
}
