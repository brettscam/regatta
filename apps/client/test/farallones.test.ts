/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, type CourseData } from '@slack-tide/world';
import { Track, type TrafficRoute, type TrafficSpec } from '../src/scene/traffic';
import { OCEAN_MODELS, buildOceanVessel } from '../src/scene/oceanTraffic';
import { landHeight, landParts } from '../src/scene/terrain';
import { inArea, lightShows, type CourseFeatures, type SeaSpec } from '../src/world/features';
import { areasAt, barState, barWord, crossedEastward, entered, noLanding } from '../src/aboard/pilotageRules';
import { FAUNA, Sightings, lookAbout, pathLength, pathPoint, whaleAt } from '../src/aboard/fauna';

// The Gulf of the Farallones: the hand-written and generated data beside the bake, checked against the baked water.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../courses/farallones');
const json = <T>(name: string): T => JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as T;
const course = json<CourseData>('course.json');
const bin = (name: string) => readFileSync(resolve(dir, name));
const world = new ReplayWorld({ course, current: new Int8Array(bin('current.bin').buffer.slice(0)), depth: new Uint8Array(bin('depth.bin').buffer.slice(0)) }, 0);
const features = json<CourseFeatures>('features.json');
const traffic = json<TrafficSpec>('traffic.json');
const sea = json<SeaSpec>('sea.json');
interface Named { id: string; name: string; x: number; y: number }
const starts = json<Array<Named & { route: Named[] }>>('starts.json');
const places = json<Array<Named & { kind: string; ashore?: { name: string } }>>('places.json');
const races = json<Array<{ id: string; name: string; marks: Named[] }>>('races.json');
const times = json<Array<{ id: string; hours: number; boost?: number; default?: boolean }>>('times.json');

const KT = 0.514444;
const NM = 1852;
const SEASON = 36 * 3600;
const lowest = Math.max(0, -Math.min(...course.tide.truth));
const area = (id: string) => features.areas.find((a) => a.id === id)!;
const inBounds = (x: number, y: number) => x > course.bounds.x0 && x < course.bounds.x1 && y > course.bounds.y0 && y < course.bounds.y1;
const state = () => ({ x: 0, y: 0, heading: 0, sog: 0, active: true });
const ships = traffic.routes.filter((r) => r.kind === 'ship' && r.model !== 'tug');
const tracks = new Map(traffic.routes.map((r) => [r.id, new Track(r, traffic.referenceHours * 3600)]));

describe('the chart of the Gulf of the Farallones', () => {
  it('marks the bar: the Potato Patch and the South Bar are shoal, with the dredged channel between them', () => {
    const patch = area('potato-patch');
    const south = area('south-bar');
    expect(patch.kind).toBe('hazard');
    expect(patch.warn).toMatch(/ebb/);
    // Everywhere well inside the Potato Patch is under seven fathoms, and the least water agrees with what the chart says.
    let least = 99;
    for (let x = -16000; x <= -8000; x += 200) for (let y = -6000; y <= 600; y += 200) {
      if (!inArea(patch, x, y)) continue;
      least = Math.min(least, world.chartDepth(x, y));
      expect(world.chartDepth(x, y), `${x}, ${y}`).toBeLessThan(16.5);
    }
    expect(least).toBeGreaterThan(5);
    expect(least).toBeLessThan(patch.least! + 3);
    // The ship channel runs between the two and is in neither.
    for (const [x, y] of [[-16200, -6920], [-14000, -6320], [-11900, -5750]]) {
      expect(inArea(patch, x, y)).toBe(false);
      expect(inArea(south, x, y)).toBe(false);
      expect(world.chartDepth(x, y)).toBeGreaterThan(16);
    }
    expect(world.chartDepth(-10500, -9500)).toBeLessThan(16);
    expect(inArea(south, -10500, -9500)).toBe(true);
  });

  it('marks Duxbury Reef where the water is thin', () => {
    const reef = area('duxbury-reef');
    let shoal = 0;
    for (let x = -22700; x <= -20900; x += 100) for (let y = 5700; y <= 7300; y += 100) if (inArea(reef, x, y) && world.chartDepth(x, y) < 5) shoal++;
    expect(shoal).toBeGreaterThan(10);
    // The buoy that marks it is outside it and afloat.
    const dr = course.marks.find((m) => m.id === 'dr')!;
    expect(inArea(reef, dr.x, dr.y)).toBe(false);
  });

  it('draws a line round each of the Farallones that holds the whole island, and forbids landing', () => {
    for (const id of ['refuge-southeast', 'refuge-middle', 'refuge-north']) {
      const a = area(id);
      expect(a.kind).toBe('refuge');
      expect(a.noLanding).toBe(true);
      const c = a.circle!;
      let land = 0;
      for (let dx = -c.r; dx <= c.r; dx += 50) for (let dy = -c.r; dy <= c.r; dy += 50) if (Math.hypot(dx, dy) <= c.r && world.chartDepth(c.x + dx, c.y + dy) === 0) land++;
      expect(land, id).toBeGreaterThan(0);
      // And no land of that island pokes out through the line.
      for (let k = 0; k < 72; k++) {
        const b = (k / 72) * Math.PI * 2;
        expect(world.chartDepth(c.x + Math.sin(b) * (c.r + 60), c.y + Math.cos(b) * (c.r + 60)), `${id} at ${k * 5}`).toBeGreaterThan(3);
      }
    }
  });

  it('has the three approaches of the traffic scheme, each an inbound and an outbound lane a mile wide, a mile apart', () => {
    const lanes = features.areas.filter((a) => a.kind === 'lane');
    expect(lanes.length).toBe(6);
    expect(features.areas.filter((a) => a.kind === 'separation').length).toBe(3);
    const pilot = area('pilot-area');
    expect(pilot.circle!.r).toBeCloseTo(6 * NM, -2);
    // The sea buoy is the middle of the pilot area.
    const buoy = course.marks.find((m) => m.id === 'sf')!;
    expect(Math.hypot(pilot.circle!.x - buoy.x, pilot.circle!.y - buoy.y)).toBeLessThan(50);
    for (const name of ['northern', 'western', 'southern']) {
      const inbound = area(`${name}-inbound`);
      const outbound = area(`${name}-outbound`);
      expect(Math.abs(((inbound.toward! - outbound.toward! + 540) % 360) - 180)).toBe(180);
      const mid = (a: typeof inbound) => [a.points!.reduce((s, p) => s + p[0], 0) / 4, a.points!.reduce((s, p) => s + p[1], 0) / 4];
      const [ix, iy] = mid(inbound);
      const [ox, oy] = mid(outbound);
      // Two miles between the middles of the lanes.
      expect(Math.hypot(ix - ox, iy - oy) / NM).toBeCloseTo(2, 1);
      // Keep right: seen from a ship heading in, the inbound lane is the starboard one.
      const h = (inbound.toward! * Math.PI) / 180;
      const toStarboard = (ix - ox) * Math.cos(h) - (iy - oy) * Math.sin(h);
      expect(toStarboard, name).toBeGreaterThan(0);
      // Inbound traffic is heading for the buoy.
      const bearingToBuoy = (Math.atan2(buoy.x - ix, buoy.y - iy) * 180) / Math.PI;
      expect(Math.abs(((bearingToBuoy - inbound.toward! + 540) % 360) - 180)).toBeLessThan(12);
      // The lanes are sea all the way, and clear of the hazards and the refuges.
      for (const lane of [inbound, outbound]) {
        for (const [x, y] of lane.points!) {
          expect(world.chartDepth(x, y), lane.id).toBeGreaterThan(25);
          for (const a of features.areas) if (a.kind === 'hazard' || a.kind === 'refuge') expect(inArea(a, x, y), `${lane.id} in ${a.id}`).toBe(false);
        }
      }
    }
  });

  it('has the lights of the coast, on their headlands, each with a rhythm of its own', () => {
    const ids = features.lights.map((l) => l.id);
    for (const id of ['bonita', 'mile-rocks', 'reyes', 'farallon', 'sea-buoy']) expect(ids).toContain(id);
    for (const l of features.lights) {
      expect(l.shows).toBeLessThan(l.period);
      expect(l.character).toMatch(/^(Fl|Oc|Iso|Mo)/);
      // On for `shows` seconds in every `period`, at the same moments for everybody.
      let on = 0;
      for (let t = 0; t < l.period * 10; t += 0.1) if (lightShows(l, 5000 + t)) on++;
      expect(on / 100).toBeCloseTo(l.shows, 0);
      // A lit buoy floats, and Mile Rocks stands in the sea on a rock of its own that is drawn but not charted as land.
      if (l.on === 'buoy' || l.on === 'rock') {
        expect(world.chartDepth(l.x, l.y)).toBeGreaterThan(10);
        continue;
      }
      // A lighthouse is on the land or within a cable or two of it. Mile Rocks is its own rock.
      let near = false;
      for (let dx = -300; dx <= 300 && !near; dx += 50) for (let dy = -300; dy <= 300 && !near; dy += 50) near = world.chartDepth(l.x + dx, l.y + dy) === 0;
      expect(near, l.name).toBe(true);
    }
    // Point Reyes flashes every five seconds, the Farallon every fifteen, Bonita is on more than it is off.
    const of = (id: string) => features.lights.find((l) => l.id === id)!;
    expect(of('reyes').period).toBe(5);
    expect(of('farallon').period).toBe(15);
    expect(of('bonita').shows / of('bonita').period).toBeGreaterThan(0.5);
  });

  it('puts the hand-over to the Bay on the bridge', () => {
    const h = features.handover![0];
    expect(h.to).toBe('sf-bay');
    expect(h.line).toEqual([course.bridge!.south, course.bridge!.north]);
    expect(features.fog!.say.length).toBeGreaterThan(40);
  });
});

describe('local knowledge', () => {
  it('speaks once on the way in to an area, and not again while she stays', () => {
    const outside = areasAt(features, -18000, -3000);
    const inside = areasAt(features, -11500, -1200);
    // The Bonita Channel, inshore of the bank, is not on it.
    expect(areasAt(features, -8350, -400)).not.toContain('potato-patch');
    expect(inside).toContain('potato-patch');
    expect(entered(features, new Set(outside), inside).map((a) => a.id)).toContain('potato-patch');
    expect(entered(features, new Set(inside), inside)).toEqual([]);
    expect(entered(undefined, new Set(), inside)).toEqual([]);
    expect(areasAt(undefined, 0, 0)).toEqual([]);
  });

  it('keeps the kayak aboard inside the refuge and nowhere else', () => {
    expect(noLanding(features, -49050, -14150)?.id).toBe('refuge-southeast');
    expect(noLanding(features, -46600, -14200)).toBeNull();
    expect(noLanding(features, -45400, 19300)).toBeNull();
    expect(noLanding(undefined, -49050, -14150)).toBeNull();
  });

  it('knows the bar is worst on the ebb, and worse with wind over it', () => {
    expect(barState(-1.5 * KT, 10)).toBe(0);
    expect(barState(0.2 * KT, 8)).toBe(0);
    expect(barState(1 * KT, 8)).toBe(1);
    expect(barState(1.4 * KT, 18)).toBe(2);
    expect(barState(2.5 * KT, 5)).toBe(2);
    expect(barState(0, 22)).toBe(1);
    expect(barWord(0, 0)).toBe('');
    expect(barWord(2, 2.5)).toMatch(/2\.5 knots/);
  });

  it('finds the bar dangerous in the small hours of the second day, when the big ebb runs, and quiet on the flood', () => {
    const at = (hour: number) => {
      const c = world.current(-11500, -3000, hour * 3600, { x: 0, y: 0 });
      return barState(-c.x, world.wind(-11500, -3000, hour * 3600).speed / KT);
    };
    expect(Math.max(at(17), at(18), at(19))).toBeGreaterThanOrEqual(1);
    expect(at(10)).toBe(0);
  });

  it('notices a boat sailing in under the bridge, and not one sailing out or passing outside it', () => {
    const line = features.handover![0].line;
    expect(crossedEastward(line, { x: -2700, y: -1150 }, { x: -2300, y: -1150 })).toBe(true);
    expect(crossedEastward(line, { x: -2300, y: -1150 }, { x: -2700, y: -1150 })).toBe(false);
    expect(crossedEastward(line, { x: -2700, y: -1150 }, { x: -2650, y: -1100 })).toBe(false);
    expect(crossedEastward(line, { x: -2700, y: 4000 }, { x: -2300, y: 4000 })).toBe(false);
  });
});

describe('shipping in the lanes', () => {
  it('is the same for everybody: where a ship is depends only on the time', () => {
    const a = state();
    const b = state();
    for (const r of traffic.routes) {
      for (const t of [0, 4321, 50000, 99999]) {
        tracks.get(r.id)!.state(t, a);
        new Track(r, traffic.referenceHours * 3600).state(t, b);
        expect(a).toEqual(b);
      }
    }
  });

  it('has tankers, container ships, car carriers and cruise ships, at 12 to 20 knots', () => {
    const models = new Set(ships.map((r) => r.model));
    for (const m of ['tanker', 'container', 'carcarrier', 'cruise']) expect(models.has(m as TrafficRoute['model']), m).toBe(true);
    expect(ships.filter((r) => r.model === 'cruise').length).toBeGreaterThanOrEqual(2);
    for (const r of ships) {
      expect(r.mode).toBe('oneway');
      expect(r.speedKt).toBeGreaterThanOrEqual(12);
      expect(r.speedKt).toBeLessThanOrEqual(20);
      expect(r.length).toBeGreaterThan(150);
    }
    // Every ship comes in and goes out: two passages a day under one name.
    const names = new Set(ships.map((r) => r.name));
    expect(ships.length).toBe(names.size * 2);
    expect(names.size).toBeGreaterThanOrEqual(16);
  });

  it('also has a pilot boat at the sea buoy, fishing boats, a whale-watch boat to the islands and a tug with a barge', () => {
    const by = (model: string) => traffic.routes.filter((r) => r.model === model);
    expect(by('pilot').length).toBe(1);
    expect(by('trawler').length).toBeGreaterThanOrEqual(3);
    expect(by('tug').length).toBeGreaterThanOrEqual(1);
    const buoy = course.marks.find((m) => m.id === 'sf')!;
    const s = state();
    for (let t = 0; t < 7200; t += 300) {
      tracks.get('pilot-boat')!.state(t, s);
      expect(Math.hypot(s.x - buoy.x, s.y - buoy.y)).toBeLessThan(3000);
    }
    // The whale-watch boat gets within three miles of Southeast Farallon and stays outside the refuge line.
    const refuge = area('refuge-southeast');
    let nearest = 1e9;
    const whale = tracks.get('whale-watch')!;
    for (let t = 0; t < whale.cycle; t += 60) {
      whale.state(t, s);
      expect(inArea(refuge, s.x, s.y)).toBe(false);
      nearest = Math.min(nearest, Math.hypot(s.x - refuge.circle!.x, s.y - refuge.circle!.y));
    }
    expect(nearest).toBeLessThan(3 * NM);
  });

  it('keeps every vessel afloat along the whole of her line, with water to spare for a ship', () => {
    const p = { x: 0, y: 0 };
    for (const r of traffic.routes) {
      const need = (r.kind === 'ship' ? (r.model === 'tug' ? 10 : 15) : r.kind === 'ferry' ? 6 : 4) + lowest;
      const track = tracks.get(r.id)!;
      for (let d = 0; d <= track.length; d += 50) {
        track.point(d, p);
        expect(world.chartDepth(p.x, p.y), `${r.id} at ${Math.round(p.x)}, ${Math.round(p.y)}`).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it('runs each ship down her lane the right way, and nowhere near the Potato Patch or the islands', () => {
    const s = state();
    for (const r of ships) {
      const inbound = r.id.endsWith('-in');
      const track = tracks.get(r.id)!;
      const lane = area(`${(r as unknown as { lane: string }).lane}-${inbound ? 'inbound' : 'outbound'}`);
      const start = traffic.referenceHours * 3600 - r.phase;
      let inLane = 0;
      for (let tau = 30; tau < track.travel; tau += 120) {
        track.state(start + tau, s);
        expect(s.active).toBe(true);
        expect(s.sog / KT).toBeCloseTo(r.speedKt, 1);
        for (const a of features.areas) if (a.kind === 'hazard' || a.kind === 'refuge') expect(inArea(a, s.x, s.y), `${r.id} in ${a.id}`).toBe(false);
        // No ship is ever in a lane that runs the other way.
        for (const a of features.areas) {
          if (a.kind !== 'lane' || !inArea(a, s.x, s.y)) continue;
          const off = Math.abs((((s.heading * 180) / Math.PI - a.toward! + 540) % 360) - 180);
          expect(off, `${r.id} in ${a.id}`).toBeLessThan(25);
        }
        if (inArea(lane, s.x, s.y)) inLane++;
      }
      expect(inLane, r.id).toBeGreaterThan(5);
      // She passes under the bridge, on her own side of the channel.
      let underBridge = 1e9;
      for (let tau = 0; tau < track.travel; tau += 20) {
        track.state(start + tau, s);
        underBridge = Math.min(underBridge, Math.hypot(s.x + 2512, s.y + 1145));
      }
      expect(underBridge, r.id).toBeLessThan(400);
      // Off the chart between passages.
      track.state(start + track.travel + 600, s);
      expect(s.active).toBe(false);
      track.state(start - 600, s);
      expect(s.active).toBe(false);
    }
  });

  it('is busy at the busy times: several ships an hour pass the sea buoy in the morning, and it is never empty for long by day', () => {
    // Count ships passing within two miles of the buoy, hour by hour, through the first day.
    const buoy = course.marks.find((m) => m.id === 'sf')!;
    const s = state();
    const passes: number[] = [];
    for (let hour = 0; hour < 24; hour++) {
      let n = 0;
      for (const r of ships) {
        const track = tracks.get(r.id)!;
        let was = false;
        for (let t = hour * 3600; t < (hour + 1) * 3600; t += 60) {
          track.state(t, s);
          const near = s.active && Math.hypot(s.x - buoy.x, s.y - buoy.y) < 2 * NM;
          if (near && !was) n++;
          was = near;
        }
      }
      passes.push(n);
    }
    // The season starts at 08:00, so hours 0 to 3 are the morning rush.
    expect(Math.max(...passes.slice(0, 4))).toBeGreaterThanOrEqual(3);
    expect(passes.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(30);
    for (let h = 0; h < 11; h++) expect(passes[h] + passes[h + 1], `hours ${h} and ${h + 1}`).toBeGreaterThan(0);
  });

  it('never has two ships on top of each other', () => {
    const a = state();
    const b = state();
    let closest = 1e9;
    for (let t = 0; t < 86400; t += 20) {
      const on = ships.filter((r) => { tracks.get(r.id)!.state(t, a); return a.active; });
      for (let i = 0; i < on.length; i++) {
        tracks.get(on[i].id)!.state(t, a);
        for (let j = i + 1; j < on.length; j++) {
          tracks.get(on[j].id)!.state(t, b);
          const apart = Math.hypot(a.x - b.x, a.y - b.y);
          if (apart < closest) closest = apart;
          // Two ships going the same way are never less than six cables apart. Ships meeting in the channel pass port to port, each on her own side.
          // Where their tracks cross, out in the pilot area, they are half a mile apart or more. Ships meeting pass port to port, each on her own side.
          const sameWay = on[i].id.endsWith('-in') === on[j].id.endsWith('-in');
          expect(apart, `${on[i].id} and ${on[j].id} at ${(t / 3600 + 8).toFixed(2)} h`).toBeGreaterThan(sameWay ? 1200 : a.x > -17000 ? 180 : 800);
        }
      }
    }
    expect(closest).toBeLessThan(5 * NM);
  });

  it('times the tugs so that a tow is never within a mile of a ship', () => {
    const a = state();
    const b = state();
    for (const tug of traffic.routes.filter((r) => r.model === 'tug')) {
      expect(tug.every! % 43200).toBe(0);
      for (let t = 0; t < 86400; t += 60) {
        tracks.get(tug.id)!.state(t, a);
        if (!a.active) continue;
        for (const r of ships) {
          tracks.get(r.id)!.state(t, b);
          if (b.active) expect(Math.hypot(a.x - b.x, a.y - b.y), `${tug.id} and ${r.id}`).toBeGreaterThan(NM);
        }
      }
    }
  });

  it('makes a ship something to plan for: she covers a lane a mile wide in three minutes and a half', () => {
    const fastest = Math.max(...ships.map((r) => r.speedKt));
    expect((NM / (fastest * KT)) / 60).toBeLessThan(4);
  });

  it('builds a model for every kind of deep-sea vessel, about as long and as wide as its route says', () => {
    for (const model of OCEAN_MODELS) {
      const r = traffic.routes.find((x) => x.model === model)!;
      expect(r, model).toBeDefined();
      const g = buildOceanVessel(r)!;
      g.updateMatrixWorld(true);
      let z0 = 1e9, z1 = -1e9, x1 = 0, top = 0;
      g.traverse((o) => {
        const mesh = o as import('three').Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
        z0 = Math.min(z0, box.min.z); z1 = Math.max(z1, box.max.z); x1 = Math.max(x1, box.max.x); top = Math.max(top, box.max.y);
      });
      expect(z1 - z0, model).toBeGreaterThan(r.length * 0.9);
      expect(z1 - z0, model).toBeLessThan(r.length * 1.1);
      // A fishing boat's trolling poles reach well outside her beam.
      expect(x1 * 2, model).toBeLessThan(model === 'trawler' ? r.length * 1.3 : r.beam * 1.5);
      expect(top, model).toBeGreaterThan(3);
    }
    // The models that belong to `traffic.ts` are left to it.
    expect(buildOceanVessel({ ...traffic.routes[0], model: 'container' })).toBeNull();
    expect(buildOceanVessel({ ...traffic.routes[0], model: 'sloop' })).toBeNull();
  });
});

describe('a one-way passage', () => {
  const route: TrafficRoute = { id: 't', name: 'Test', kind: 'ship', model: 'tanker', length: 200, beam: 30, speedKt: 10, mode: 'oneway', every: 7200, phase: 0, color: '#000', points: [[0, 0], [0, 5000], [0, 10000]] };
  const track = new Track(route, 0);
  const s = state();

  it('runs the line once at her speed and is gone until the next is due', () => {
    expect(track.cycle).toBe(7200);
    expect(track.travel).toBeCloseTo(10000 / (10 * KT), 0);
    track.state(0, s);
    expect(s.active).toBe(true);
    expect(s.y).toBeCloseTo(0, 0);
    expect(s.sog).toBeCloseTo(10 * KT, 5);
    track.state(600, s);
    expect(s.y).toBeCloseTo(600 * 10 * KT, 0);
    expect(s.heading).toBeCloseTo(0, 5);
    track.state(track.travel + 1, s);
    expect(s.active).toBe(false);
    track.state(7200 + 600, s);
    expect(s.active).toBe(true);
    expect(s.y).toBeCloseTo(600 * 10 * KT, 0);
  });

  it('never comes round sooner than she can make the passage', () => {
    expect(new Track({ ...route, every: 100 }, 0).cycle).toBeGreaterThan(track.travel);
    expect(new Track({ ...route, every: undefined }, 0).cycle).toBeGreaterThan(track.travel);
  });

  it('leaves the shuttles and the loops as they were', () => {
    const shuttle = new Track({ ...route, mode: 'shuttle', dwell: 300, every: undefined }, 0);
    expect(shuttle.cycle).toBeCloseTo(2 * (shuttle.travel + 300), 5);
    const loop = new Track({ ...route, mode: 'loop', every: undefined, points: [[0, 0], [0, 1000], [1000, 1000], [1000, 0]] }, 0);
    expect(loop.cycle).toBeCloseTo(loop.length / (10 * KT), 5);
  });
});

describe('places, starts and races', () => {
  it('offers the six starts asked for, each afloat with room, each with a route that stays afloat', () => {
    expect(starts.map((s) => s.id)).toEqual(['gate', 'bonita', 'drakes', 'bodega', 'pacifica', 'farallones']);
    for (const s of starts) {
      expect(inBounds(s.x, s.y), s.id).toBe(true);
      expect(world.chartDepth(s.x, s.y), s.id).toBeGreaterThan(8);
      let from = { x: s.x, y: s.y };
      for (const m of s.route) {
        const n = Math.ceil(Math.hypot(m.x - from.x, m.y - from.y) / 25);
        for (let k = 0; k <= n; k++) expect(world.chartDepth(from.x + ((m.x - from.x) * k) / n, from.y + ((m.y - from.y) * k) / n), `${s.id} to ${m.name}`).toBeGreaterThanOrEqual(4 + lowest);
        from = m;
      }
    }
    // The first start is under the bridge, on the Bay's own line.
    expect(Math.hypot(starts[0].x + 2512, starts[0].y + 1145)).toBeLessThan(400);
  });

  it('starts nobody in a traffic lane, on a hazard or inside a refuge', () => {
    for (const s of starts) for (const a of features.areas) if (a.kind !== 'precaution') expect(inArea(a, s.x, s.y), `${s.id} in ${a.id}`).toBe(false);
  });

  it('has the harbours and anchorages of the coast, each with water to lie in', () => {
    const ids = places.map((p) => p.id);
    for (const id of ['drakes', 'bolinas', 'spud-point', 'bodega-wharf', 'pillar-point', 'pacifica-pier']) expect(ids).toContain(id);
    for (const p of places) {
      expect(inBounds(p.x, p.y), p.id).toBe(true);
      expect(world.chartDepth(p.x, p.y), p.id).toBeGreaterThan(3);
      expect(['mooring', 'dock', 'anchorage']).toContain(p.kind);
    }
    // Nobody goes ashore on the Farallones.
    for (const p of places) if (noLanding(features, p.x, p.y)) expect(p.ashore, p.id).toBeUndefined();
    expect(places.some((p) => noLanding(features, p.x, p.y))).toBe(true);
  });

  it('has the classic ocean courses, every leg afloat and clear of the refuge', () => {
    expect(races.map((r) => r.id)).toEqual(['out-the-gate', 'lightship', 'drakes-bay', 'farallones', 'bodega']);
    const miles: Record<string, number> = {};
    for (const r of races) {
      let total = 0;
      for (let i = 1; i < r.marks.length; i++) {
        const a = r.marks[i - 1];
        const b = r.marks[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        total += len;
        const n = Math.ceil(len / 25);
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n;
          const y = a.y + ((b.y - a.y) * k) / n;
          expect(world.chartDepth(x, y), `${r.id}: ${a.name} to ${b.name}`).toBeGreaterThanOrEqual(4 + lowest);
          for (const area of features.areas) if (area.kind === 'refuge') expect(inArea(area, x, y), `${r.id} in ${area.id}`).toBe(false);
        }
      }
      miles[r.id] = total / NM;
      // Every race starts at the Golden Gate.
      expect(r.marks[0].name).toBe('Golden Gate');
    }
    expect(miles['lightship']).toBeGreaterThan(20);
    expect(miles['lightship']).toBeLessThan(25);
    expect(miles['farallones']).toBeGreaterThan(50);
    expect(miles['farallones']).toBeLessThan(60);
    expect(miles['drakes-bay']).toBeGreaterThan(24);
    expect(miles['bodega']).toBeGreaterThan(48);
    // The Farallones race is 7 to 9 hours at 6 to 8 knots, so the 36 hours of weather hold it from any start before the last evening.
    expect(miles['farallones'] / 6).toBeLessThan(10);
    // It goes round the island: marks north, west and south of it.
    const island = area('refuge-southeast').circle!;
    const round = races.find((r) => r.id === 'farallones')!.marks.filter((m) => Math.hypot(m.x - island.x, m.y - island.y) < 3000);
    expect(round.length).toBeGreaterThanOrEqual(3);
    expect(round.some((m) => m.x < island.x - island.r)).toBe(true);
  });

  it('keeps the beat up a lee shore in short legs, so the route pilot has no room to stand in to the beach', () => {
    // North of Duxbury the coast is to starboard all the way. No leg there is longer than five miles, and every mark is two miles off or more.
    for (const id of ['drakes-bay', 'bodega']) {
      const marks = races.find((r) => r.id === id)!.marks;
      const from = marks.findIndex((m) => m.name === 'Duxbury buoy');
      for (let i = from + 1; i < marks.length - 2; i++) {
        expect(Math.hypot(marks[i].x - marks[i - 1].x, marks[i].y - marks[i - 1].y) / NM, `${id}: ${marks[i].name}`).toBeLessThan(5);
        let off = 1e9;
        for (let b = 0; b < 360; b += 10) {
          for (let d = 200; d < off; d += 200) {
            if (world.chartDepth(marks[i].x + Math.sin((b * Math.PI) / 180) * d, marks[i].y + Math.cos((b * Math.PI) / 180) * d) === 0) { off = d; break; }
          }
        }
        if (!/Chimney Rock|Bodega Rock|Point Reyes$/.test(marks[i].name)) expect(off / NM, `${id}: ${marks[i].name}`).toBeGreaterThan(1.9);
      }
    }
  });

  it('offers start times through the day and night, one of them the default, one with more wind than the record', () => {
    expect(times.filter((t) => t.default).length).toBe(1);
    expect(times.some((t) => (t.boost ?? 1) > 1)).toBe(true);
    for (const t of times) {
      expect(t.hours).toBeGreaterThanOrEqual(0);
      expect(t.hours).toBeLessThan(course.season.hours - 6);
    }
    expect(new Set(times.map((t) => t.id)).size).toBe(times.length);
  });
});

describe('the sea', () => {
  it('declares a July north-west swell for the sea-state model', () => {
    const main = sea.swell[0];
    expect(main.height).toBeGreaterThanOrEqual(1.5);
    expect(main.height).toBeLessThanOrEqual(2.5);
    expect(main.period).toBeGreaterThanOrEqual(9);
    expect(main.period).toBeLessThanOrEqual(12);
    expect(main.from).toBeGreaterThan(280);
    expect(main.from).toBeLessThan(330);
    expect(sea.shelter!.fullWestOf).toBeLessThan(sea.shelter!.noneEastOf);
  });

  it('carries the sea as a wave model recorded it for the season, hour by hour, and says it was a quiet one', () => {
    const r = sea.recorded!;
    expect(r.start).toBe(course.season.start);
    expect(r.height.length).toBe(course.season.hours + 1);
    expect(r.swell1.length).toBe(r.height.length);
    for (const h of r.height) {
      expect(h).toBeGreaterThan(0.3);
      expect(h).toBeLessThan(1.5);
    }
    expect(r.source).toMatch(/WAVEWATCH/);
    expect(sea.note).toMatch(/quiet/);
  });
});

describe('the land, with insets', () => {
  const heights = new Uint8Array(bin('terrain.bin').buffer.slice(0));
  const height = landHeight(course, heights);

  it('reads the finest grid there is at each place', () => {
    const parts = landParts(course);
    expect(parts.length).toBe(1 + course.terrain.insets!.length);
    expect(parts[parts.length - 1].start + parts[parts.length - 1].grid.nx * parts[parts.length - 1].grid.ny).toBe(heights.length);
    // Southeast Farallon is a rock a hundred metres high: the 200 m grid flattens it, the 40 m inset does not.
    let top = 0;
    for (let x = -49600; x <= -48200; x += 20) for (let y = -15000; y <= -14000; y += 20) top = Math.max(top, height(x, y));
    expect(top).toBeGreaterThan(50);
    expect(top).toBeLessThan(120);
    expect(top).toBeGreaterThan(landHeight({ ...course, terrain: { ...course.terrain, insets: undefined } }, heights)(-48500, -14550));
    // Sea is sea, and the Marin headlands and Mount Tamalpais stand where they should.
    expect(height(-30000, -10000)).toBe(0);
    expect(height(-4500, -500)).toBeGreaterThan(100);
    expect(height(-12870, 10400)).toBeGreaterThan(600);
  });

  it('stands the bridge towers in the water and its ends on the land', () => {
    const [sx, sy] = course.bridge!.south;
    const [nx, ny] = course.bridge!.north;
    expect(world.chartDepth((sx + nx) / 2, (sy + ny) / 2)).toBeGreaterThan(60);
    const ux = (nx - sx) / Math.hypot(nx - sx, ny - sy);
    const uy = (ny - sy) / Math.hypot(nx - sx, ny - sy);
    expect(height(sx - ux * 700, sy - uy * 700)).toBeGreaterThan(5);
    expect(height(nx + ux * 600, ny + uy * 600)).toBeGreaterThan(5);
  });
});

describe('the animals of the Gulf', () => {
  const f = FAUNA.farallones;
  const sea30 = { depth: (x: number, y: number) => world.chartDepth(x, y), stream: () => 0.5, tideRate: 0.2 };

  it('has a list of its own, apart from the Bay', () => {
    expect(f).toBeDefined();
    expect(f).not.toBe(FAUNA['sf-bay']);
    expect(f.haulouts).toEqual([]);
  });

  it('keeps every swimmer in the water and every haunt on the chart', () => {
    for (const r of [...f.sealions, { path: f.whale, n: 1 }]) {
      const len = pathLength(r.path);
      for (let d = 0; d <= len; d += 100) {
        const p = pathPoint(r.path, d);
        expect(world.chartDepth(p.x, p.y), `${Math.round(p.x)}, ${Math.round(p.y)}`).toBeGreaterThan(1.5);
      }
    }
    for (const s of [...f.porpoise, ...f.seals, ...f.gulls]) expect(inBounds(s.x, s.y)).toBe(true);
    for (const s of f.porpoise) expect(world.chartDepth(s.x, s.y)).toBeGreaterThan(12);
    for (const b of f.bait) expect(world.chartDepth(b.x, b.y)).toBeGreaterThan(4);
    for (const p of f.perches) expect(course.marks.some((m) => m.kind === 'buoy' && Math.hypot(m.x - p.x, m.y - p.y) < 30)).toBe(true);
  });

  it('brings a humpback in from the islands toward the bar on the flood, in deep water', () => {
    let seen = 0;
    for (let hour = 0; hour < 200; hour++) {
      const w = whaleAt('farallones', hour * 3600 + 900, sea30);
      if (!w) continue;
      seen++;
      expect(world.chartDepth(w.x, w.y)).toBeGreaterThan(15);
      expect(w.x).toBeLessThan(-13000);
    }
    expect(seen).toBeGreaterThan(5);
    expect(whaleAt('farallones', 900, { ...sea30, tideRate: -0.2 })).toBeNull();
  });

  it('shows gulls over Southeast Farallon and sea lions round it', () => {
    const island = { x: -48800, y: -14500 };
    let gulls = 0;
    let lions = 0;
    for (const t of [3000, 20000, 41000, 66000]) {
      const seen = lookAbout('farallones', t, sea30, island, [], new Sightings()).all();
      gulls += seen.filter((a) => a.kind === 'gull').length;
      const out = lookAbout('farallones', t, sea30, { x: -47900, y: -14300 }, [], new Sightings()).all();
      lions += out.filter((a) => a.kind === 'sealion').length;
    }
    expect(gulls).toBeGreaterThan(8);
    expect(lions).toBeGreaterThan(0);
  });
});
