// Where each place's venue will stand, what is on it, and whether a boat can get to it.
// Usage: npx vite-node scripts/shore.ts <course folder> [lat lon]... | layout [place id]
//   with nothing more it checks the course's own places.json;
//   with latitudes and longitudes it shows where each would fall, and the nearest water deep enough to bring a boat to;
//   with `layout` it prints the venues' layouts (deck outline, dock, berth, named spots) as JSON, all or one.
import { existsSync, readFileSync } from 'node:fs';
import { ReplayWorld, type CourseData } from '@slack-tide/world';
import { drawnLandHeight } from '../apps/client/src/scene/terrain';
import { planTown, townFaults, townLayouts, type TownSpec } from '../apps/client/src/scene/town';
import { chartSailable, shoreKind } from '../apps/client/src/scene/shoreSite';
import { layoutOf, planVenue, type VenueGround, type VenuePlace } from '../apps/client/src/scene/venue';

const [id = 'sf-bay', ...rest] = process.argv.slice(2);
const dir = new URL(`../courses/${id}/`, import.meta.url);
const course = JSON.parse(readFileSync(new URL('course.json', dir), 'utf8')) as CourseData;
const bin = (f: string) => readFileSync(new URL(f, dir));
const cur = bin('current.bin');
const depths = new Uint8Array(bin('depth.bin'));
const world = new ReplayWorld({ course, current: new Int8Array(cur.buffer, cur.byteOffset, cur.byteLength), depth: depths }, 0);
// The land as `scene/terrain.ts` draws it, read from the finest grid there is at each place: water cells sit well under the sea.
const drawn = drawnLandHeight(course, new Uint8Array(bin('terrain.bin')));
const ground: VenueGround = { height: drawn, sailable: chartSailable(course.depth, depths), depth: (x, y) => world.chartDepth(x, y) };
// Towns to walk about in, where the water has them (`towns.json`, `scene/town.ts`).
const towns = existsSync(new URL('towns.json', dir)) ? (JSON.parse(readFileSync(new URL('towns.json', dir), 'utf8')) as TownSpec[]) : [];
const M = (6371008.8 * Math.PI) / 180;

let places = JSON.parse(readFileSync(new URL('places.json', dir), 'utf8')) as VenuePlace[];
if (rest[0] === 'layout') {
  const out = places.filter((p) => !rest[1] || p.id === rest[1]).map((p) => { const plan = planVenue(p, ground); return plan ? layoutOf(plan, ground) : null; });
  const townOut = towns.flatMap((t) => townLayouts(planTown(t, ground), ground)).filter((l) => !rest[1] || l.place === rest[1]).map((l) => l.layout);
  console.log(JSON.stringify([...out.filter(Boolean), ...townOut], null, 1));
  process.exit(0);
}
const probing = rest.length > 0;
if (probing) {
  places = [];
  for (let i = 0; i + 1 < rest.length; i += 2) {
    const lat = Number(rest[i]);
    const lon = Number(rest[i + 1]);
    places.push({ id: `p${i}`, name: `${lat},${lon}`, x: Math.round((lon - course.origin.lon) * M * Math.cos((course.origin.lat * Math.PI) / 180)), y: Math.round((lat - course.origin.lat) * M), ashore: { name: '' } });
  }
}

/** The nearest point with this much charted water, looking out 600 m. */
function deepNear(x: number, y: number, need = 4.5): string {
  for (let r = 0; r <= 600; r += 20) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const qx = Math.round(x + Math.cos(a) * r);
      const qy = Math.round(y + Math.sin(a) * r);
      if (world.chartDepth(qx, qy) >= need) return `  deep water at ${qx},${qy} (${r} m)`;
    }
  }
  return '  no deep water within 600 m';
}

let bad = 0;
for (const p of places) {
  const depth = world.chartDepth(p.x, p.y);
  const plan = planVenue(p, ground);
  const notes: string[] = [];
  if (p.ashore?.town) {
    // A place in a town: the town is its venue, and one of the town's landings should be this place's.
    const town = towns.find((t) => t.id === p.ashore!.town);
    const landing = town?.landings.find((l) => l.place === p.id);
    const spot = town?.spots.find((q) => q.name === landing?.spot);
    if (!town) notes.push(`NO TOWN CALLED ${p.ashore.town.toUpperCase()}`);
    if (depth < 2.5) notes.push(depth <= 0 ? 'PLACE ON LAND' : 'PLACE SHOAL');
    if (notes.some((n) => n === n.toUpperCase())) bad++;
    console.log(`${`${p.name} (${p.kind ?? '-'}, in ${p.ashore.town})`.padEnd(40)} ${String(p.x).padStart(6)},${String(p.y).padStart(6)} ${depth.toFixed(1).padStart(5)} m  ${spot ? `lands at ${landing!.spot}, ${Math.round(Math.hypot(spot.x - p.x, spot.y - p.y))} m from the place` : 'no landing of its own: reached on foot from the town\'s others'}${notes.length ? `   <-- ${notes.join(', ')}` : ''}`);
    continue;
  }
  if (depth < 2.5) notes.push(depth <= 0 ? 'PLACE ON LAND' : 'PLACE SHOAL');
  let line = 'no shore in reach';
  if (!plan) notes.push('NO SHORE IN REACH');
  else {
    const s = plan.site;
    const lay = layoutOf(plan, ground);
    const walk = Math.hypot(s.x - p.x, s.y - p.y);
    if (walk > 250) notes.push(`${Math.round(walk)} m from the place: beyond a kayak landing's walk`);
    if (ground.sailable(s.x, s.y)) notes.push('PLOT IN SAILABLE WATER');
    // Nothing that is drawn may stand where a boat can float.
    for (const ring of lay.walk) for (const [x, y] of ring) if (ground.height(x, y) <= 0.5 && ground.sailable(x, y)) notes.push('float at the water\'s edge');
    const face = String(Math.round(((Math.atan2(s.fx, s.fy) * 180) / Math.PI + 360) % 360)).padStart(3, '0');
    const deck = plan.deck ? `deck ${Math.round(plan.deck.u1 - plan.deck.u0)}x${Math.round(plan.deck.v1 - plan.deck.v0)} m, ${plan.tables.length} tables, ${plan.people.length} people` : 'no deck';
    const dock = lay.dock ? `dock ${Math.round(Math.hypot(lay.dock.x - p.x, lay.dock.y - p.y))} m from the place${lay.berth ? `, ${lay.berth.depth} m of water ${Math.round(Math.hypot(lay.berth.x - lay.dock.x, lay.berth.y - lay.dock.y))} m off it` : ', NO BERTH OFF IT'}` : 'no dock';
    line = `plot ${Math.round(s.x)},${Math.round(s.y)} ground ${s.base.toFixed(1)} m faces ${face}; ${deck}; ${dock}`;
  }
  if (notes.some((n) => n === n.toUpperCase())) bad++;
  console.log(`${`${p.name} (${p.kind ?? '-'}, ${shoreKind(p)})`.padEnd(40)} ${String(p.x).padStart(6)},${String(p.y).padStart(6)} ${depth.toFixed(1).padStart(5)} m  ${line}${notes.length ? `   <-- ${[...new Set(notes)].join(', ')}` : ''}${probing ? deepNear(p.x, p.y) : ''}`);
}
for (const t of probing ? [] : towns) {
  const plan = planTown(t, ground);
  const faults = townFaults(plan, ground);
  const layouts = townLayouts(plan, ground);
  const area = plan.rings.reduce((sum, r) => sum + Math.abs(r.ring.reduce((a, [x, y], i) => { const [nx, ny] = r.ring[(i + 1) % r.ring.length]; return a + x * ny - nx * y; }, 0)) / 2, 0);
  console.log(`Town ${t.name}: ${plan.rings.length} pieces of ground in ${t.paths.length} paths, about ${Math.round(area)} m2, ${t.spots.length} spots, floor ${t.floor} m (streets up to ${Math.max(...plan.rings.map((r) => r.z)).toFixed(1)} m)`);
  for (const l of layouts) console.log(`  landing for ${l.place}: dock ${l.layout.dock ? `${l.layout.dock.x},${l.layout.dock.y} at ${l.layout.dock.z} m` : 'NONE'}${l.layout.berth ? `, ${l.layout.berth.depth} m of water ${Math.round(Math.hypot(l.layout.berth.x - l.layout.dock!.x, l.layout.berth.y - l.layout.dock!.y))} m off it` : ', NO BERTH OFF IT'}`);
  for (const f of faults) console.log(`  FAULT ${f}`);
  for (const l of t.landings) if (!places.some((p) => p.id === l.place)) { console.log(`  FAULT landing for ${l.place}: no such place`); bad++; }
  bad += faults.length;
}
if (bad) console.log(`${bad} to fix`);
