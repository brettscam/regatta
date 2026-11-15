/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, type CourseData } from '@slack-tide/world';
import {
  BEAT, CLEAR, DUEL, MARK_CLEAR, NEED, Roster, alongside, blankState, duelCall, duelResult, gatherFacts, givesWay, grumble, hailReply, hasRadio,
  introduction, keepClear, lagAfter, passingWords, seaOf, underSail, type Facts, type ResidentFile, type ResidentSpec,
} from '../src/aboard/residentRules';
import { Track, type TrafficSpec } from '../src/scene/traffic';
import { metAward } from '../src/xp/score';

const HOUR = 3600;
const KT = 0.514444;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../courses');
const json = <T>(id: string, file: string): T => JSON.parse(readFileSync(resolve(root, id, file), 'utf8')) as T;

function load(id: string, startOffset = 0): { world: ReplayWorld; file: ResidentFile; marks: Array<{ x: number; y: number }>; places: Array<{ name: string; x: number; y: number; say: string; kind?: string }> } {
  const course = json<CourseData>(id, 'course.json');
  const cur = readFileSync(resolve(root, id, 'current.bin'));
  const world = new ReplayWorld({ course, current: new Int8Array(cur.buffer, cur.byteOffset, cur.byteLength), depth: new Uint8Array(readFileSync(resolve(root, id, 'depth.bin'))) }, startOffset);
  const marks = json<Array<{ marks: Array<{ x: number; y: number }> }>>(id, 'races.json').flatMap((r) => r.marks);
  return { world, file: json<ResidentFile>(id, 'residents.json'), marks, places: json(id, 'places.json') };
}

const WATERS = ['sf-bay', 'san-juans'];
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

describe.each(WATERS)('the boats that live on %s', (id) => {
  const { world, file, marks, places } = load(id);
  const sea = seaOf(world, marks);
  const roster = new Roster(file, sea);
  const SEASON = sea.length;

  it('are a fleet of twenty or so, each with a name, a type, a home, a skipper and a line of character', () => {
    expect(file.boats.length).toBeGreaterThanOrEqual(18);
    expect(file.boats.length).toBeLessThanOrEqual(28);
    expect(new Set(file.boats.map((b) => b.id)).size).toBe(file.boats.length);
    expect(new Set(file.boats.map((b) => b.name)).size).toBe(file.boats.length);
    for (const b of file.boats) {
      for (const text of [b.name, b.type, b.home, b.skipper, b.line, ...b.ends]) {
        expect(text.length).toBeGreaterThan(1);
        expect(text).toMatch(/^[\x20-\x7e]+$/);
      }
      expect(b.line.length).toBeGreaterThan(30);
      expect(b.line.length).toBeLessThan(140);
      expect(b.points.length).toBeGreaterThan(0);
      expect(introduction(b)).toContain(`${b.name}, a`);
    }
    const kinds = new Set(file.boats.map((b) => b.kind));
    for (const k of ['cruiser', 'daysailer', 'fisher', 'launch', 'kayak']) expect(kinds.has(k as ResidentSpec['kind'])).toBe(true);
  });

  it('starts the season at eight in the morning by the local clock', () => {
    expect(sea.startHour).toBe(8);
    expect(sea.length).toBe(36 * HOUR);
  });

  it('puts every boat in the same place for two players at the same moment of the season, whenever each of them set out', () => {
    // A second player who joined later in the day, on a blowier setting.
    const other = load(id, 5.5 * HOUR);
    other.world.windBoost = 1.5;
    const theirs = new Roster(other.file, seaOf(other.world, other.marks));
    const a = blankState();
    const b = blankState();
    for (let t = 0; t < SEASON; t += 487) {
      for (let i = 0; i < roster.boats.length; i++) {
        roster.state(i, t, a);
        theirs.state(i, t, b);
        expect(b).toEqual(a);
      }
    }
    // And the same again when asked twice.
    expect({ ...roster.state(3, 20000, a) }).toEqual({ ...roster.state(3, 20000, b) });
  });

  it('keeps every boat afloat and off the land for the whole season, at the lowest tide', () => {
    expect(roster.faults).toEqual([]);
    const st = blankState();
    roster.boats.forEach((r, i) => {
      let least = Infinity;
      for (let t = 0; t <= SEASON; t += 15) {
        roster.state(i, t, st);
        if (st.mode === 'away') continue;
        // A number that is not one fails the comparison below.
        const d = Number.isFinite(st.x + st.y + st.heading + st.sog) ? sea.depth(st.x, st.y) : -1;
        if (d < least) least = d;
      }
      expect(least, `${r.spec.id} in ${least.toFixed(1)} m`).toBeGreaterThanOrEqual(NEED[r.spec.kind]);
    });
  });

  it('keeps every boat outside the ring of every race mark', () => {
    const st = blankState();
    roster.boats.forEach((r, i) => {
      let least = Infinity;
      for (let t = 0; t <= SEASON; t += 15) {
        roster.state(i, t, st);
        if (st.mode === 'away') continue;
        for (const m of marks) least = Math.min(least, Math.hypot(m.x - st.x, m.y - st.y));
      }
      expect(least, r.spec.id).toBeGreaterThan(MARK_CLEAR - 1);
    });
  });

  it('moves them without a jump: never further in a second than a boat can go', () => {
    const a = blankState();
    const b = blankState();
    roster.boats.forEach((r, i) => {
      const most = r.spec.speedKt * KT * 1.15 + 0.2;
      let worst = 0;
      let when = 0;
      roster.state(i, 0, a);
      for (let t = 1; t < SEASON; t += 1) {
        roster.state(i, t, b);
        // Coming out of her berth she appears where she lay, so that is no jump either.
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d > worst) {
          worst = d;
          when = t;
        }
        a.x = b.x;
        a.y = b.y;
      }
      expect(worst, `${r.spec.id} at ${when}`).toBeLessThanOrEqual(most);
    });
  });

  it('never sails a yacht dead to windward: under sail she is at least 38 degrees off the wind she set the leg by', () => {
    const st = blankState();
    let sailing = 0;
    let beating = 0;
    roster.boats.forEach((r, i) => {
      if (!underSail(r.spec.kind)) return;
      for (const p of r.phases) {
        if (p.mode !== 'sail') continue;
        const leg = r.legs[p.leg];
        const wind = sea.wind((leg.ax + leg.bx) / 2, (leg.ay + leg.by) / 2, p.t0);
        let least = Infinity;
        for (let t = p.t0 + 1; t < p.t1; t += 20) {
          roster.state(i, t, st);
          least = Math.min(least, Math.abs(wrap(wind.dir - st.heading)));
          sailing++;
          if (p.amp > 0) beating++;
        }
        expect(least, `${r.spec.id} from ${p.t0}`).toBeGreaterThan(BEAT - 0.01);
      }
    });
    expect(sailing).toBeGreaterThan(1000);
    // Some of the time they are beating, and tacking as they go.
    expect(beating).toBeGreaterThan(50);
  });

  it('stays close to the true wind of the moment too: seldom inside 30 degrees of it', () => {
    const st = blankState();
    let n = 0;
    let pinched = 0;
    roster.boats.forEach((_r, i) => {
      for (let t = 0; t < SEASON; t += 60) {
        roster.state(i, t, st);
        if (st.mode !== 'sail') continue;
        n++;
        if (Math.abs(wrap(sea.wind(st.x, st.y, t).dir - st.heading)) < 30 * Math.PI / 180) pinched++;
      }
    });
    expect(pinched / n).toBeLessThan(0.05);
  });

  it('has more boats out in the afternoon than the morning, a sail nearly always in sight by day, and nobody under way at night', () => {
    const at = (clock: number, day = 0): ReturnType<Roster['afloat']> => roster.afloat((clock - 8 + day * 24) * HOUR);
    for (const day of [0, 1]) {
      for (const h of [11.5, 12.5, 13.5, 14.5, 15.5, 16.5]) {
        const a = at(h, day);
        expect(a.underWay, `under way at ${h}`).toBeGreaterThanOrEqual(4);
        expect(a.underWay).toBeLessThanOrEqual(18);
        expect(a.showing).toBeLessThanOrEqual(28);
        expect(a.sails, `sails at ${h}`).toBeGreaterThanOrEqual(1);
      }
      if (day === 0) {
        for (const h of [22, 24, 27, 30]) {
          const a = at(h);
          expect(a.underWay).toBe(0);
          // The ones lying to anchors and moorings are still there to be seen.
          expect(a.showing).toBeGreaterThanOrEqual(4);
        }
      }
    }
    const count = (from: number, to: number): number => {
      let sum = 0;
      for (let h = from; h < to; h += 0.25) sum += at(h).underWay;
      return sum;
    };
    expect(count(13, 17)).toBeGreaterThan(count(8, 12));
  });

  it('does not lie one boat on top of another', () => {
    const berths = roster.boats.flatMap((r) => {
      const lie = r.spec.lie ?? ['mooring', 'anchor'];
      const pts = r.spec.points;
      return [0, 1].filter((e) => lie[e] !== 'away' && (e === 0 || pts.length > 1)).map((e) => ({ id: r.spec.id, x: pts[e ? pts.length - 1 : 0][0], y: pts[e ? pts.length - 1 : 0][1] }));
    });
    for (let i = 0; i < berths.length; i++) for (let j = i + 1; j < berths.length; j++) {
      if (berths[i].id === berths[j].id) continue;
      expect(Math.hypot(berths[i].x - berths[j].x, berths[i].y - berths[j].y), `${berths[i].id} and ${berths[j].id}`).toBeGreaterThan(70);
    }
  });

  it('says where a boat under way is bound, and names the next place on her way with the time she is due', () => {
    const st = blankState();
    let asked = 0;
    roster.boats.forEach((r, i) => {
      for (let t = 0; t < SEASON; t += 600) {
        roster.state(i, t, st);
        const ahead = roster.ahead(i, t);
        if (st.mode === 'berth' || st.mode === 'away' || st.mode === 'work') {
          if (ahead) throw new Error(`${r.spec.id} is stopped but has somewhere ahead`);
          continue;
        }
        asked++;
        expect(r.spec.ends).toContain(st.bound);
        expect(ahead).not.toBeNull();
        expect(ahead!.eta).toBeGreaterThan(t);
        // She is there when she says she will be.
        roster.state(i, ahead!.eta, st);
        expect(Math.hypot(st.x - ahead!.x, st.y - ahead!.y)).toBeLessThan(25);
      }
    });
    expect(asked).toBeGreaterThan(50);
  });

  it('lists every departure once, in order', () => {
    const d = roster.departures();
    expect(d.length).toBeGreaterThan(40);
    for (let i = 1; i < d.length; i++) expect(d[i].t).toBeGreaterThanOrEqual(d[i - 1].t);
    for (const x of d) expect(x.from).not.toBe(x.to);
  });

  it('gathers tips that are true in the world', () => {
    const boat = places[0];
    for (const hours of [2.5, 5.5, 8.5]) {
      const t = hours * HOUR;
      const f = gatherFacts(world, places, boat.x + 900, boat.y, t, 8 + hours);
      expect(f.windKt).toBeCloseTo(world.wind(boat.x + 900, boat.y, t).speed / KT, 5);
      if (f.windier) {
        const p = places.find((q) => q.name === f.windier!.name)!;
        expect(world.wind(p.x, p.y, t).speed / KT).toBeGreaterThanOrEqual(f.windKt + 3);
      }
      if (f.turn) {
        const before = world.tideRate(t + (f.turn.minutes - 5) * 60) > 0;
        expect(before).toBe(f.turn.high);
        expect(world.tideRate(t + f.turn.minutes * 60) > 0).toBe(!f.turn.high);
      }
      expect(f.berth).not.toBeNull();
      const b = places.find((q) => q.name === f.berth!.name)!;
      expect(['anchorage', 'mooring']).toContain(b.kind);
      expect(f.berth!.nm * 1852).toBeCloseTo(Math.hypot(b.x - boat.x - 900, b.y - boat.y), 3);
      if (f.fish) expect(places.some((q) => q.name === f.fish!.place)).toBe(true);
    }
  });
});

describe('the ferries and ships of both waters', () => {
  it.each(WATERS)('run in deep water on %s, corners and all', (id) => {
    const { world, marks } = load(id);
    const sea = seaOf(world, marks);
    const spec = json<TrafficSpec>(id, 'traffic.json');
    expect(spec.routes.length).toBeGreaterThan(0);
    expect(spec.station).toMatch(/Radio$/);
    for (const r of spec.routes) {
      expect(r.kind).not.toBe('sail');
      const track = new Track(r, spec.referenceHours * HOUR);
      const p = { x: 0, y: 0 };
      for (let s = 0; s <= track.length; s += 25) {
        track.point(s, p);
        expect(sea.depth(p.x, p.y), `${r.id} at ${Math.round(p.x)}, ${Math.round(p.y)}`).toBeGreaterThanOrEqual(r.kind === 'ship' ? 13 : 5.5);
      }
    }
  });

  it('shows the islands ferry at her berth in Friday Harbor and not where she leaves the chart', () => {
    const spec = json<TrafficSpec>('san-juans', 'traffic.json');
    const r = spec.routes[0];
    const track = new Track(r, 0);
    const st = { x: 0, y: 0, heading: 0, sog: 0, active: true };
    // Alongside at the far end, off the chart: hidden. Back at Friday Harbor: there to be seen.
    track.state(-r.phase + track.travel + 10, st);
    expect(st.active).toBe(false);
    track.state(-r.phase + 2 * track.travel + (r.dwell ?? 0) + 10, st);
    expect(st.active).toBe(true);
    expect(st.sog).toBe(0);
  });
});

describe('the big ships of the Bay', () => {
  const spec = json<TrafficSpec>('sf-bay', 'traffic.json');
  const ref = spec.referenceHours * HOUR;
  const st = { x: 0, y: 0, heading: 0, sog: 0, active: true };
  const by = (model: string) => spec.routes.filter((r) => r.model === model);

  it('are tankers, container ships, a car carrier, a cruise ship, tugs with barges and a pilot boat, each with her own call sign', () => {
    expect(by('tanker').length).toBe(2);
    expect(by('container').length).toBe(2);
    expect(by('carcarrier').length).toBe(1);
    expect(by('cruise').length).toBe(1);
    expect(by('tug').length).toBe(2);
    expect(by('pilot').length).toBe(1);
    for (const r of spec.routes.filter((x) => x.kind === 'ship' || x.model === 'tug' || x.model === 'pilot')) {
      expect(r.sign, r.id).toContain(r.name.replace('Pilot boat ', ''));
      expect(r.speedKt).toBeGreaterThanOrEqual(6);
      expect(r.speedKt).toBeLessThanOrEqual(r.model === 'pilot' ? 20 : 13);
    }
    expect(new Set(spec.routes.map((r) => r.name)).size).toBe(spec.routes.length);
  });

  it('brings the cruise ship in once, early on the second morning, and takes her out that evening', () => {
    const r = by('cruise')[0];
    const track = new Track(r, ref);
    expect(track.cycle).toBeGreaterThan(36 * HOUR);
    const changes: Array<[number, boolean]> = [];
    let was = false;
    let alongside = 0;
    for (let t = 0; t < 36 * HOUR; t += 60) {
      track.state(t, st);
      if (st.active !== was) changes.push([8 + t / HOUR, (was = st.active)]);
      if (st.active && st.sog === 0) alongside += 60;
    }
    expect(changes.length).toBe(2);
    // In sight from a quarter to six, at the Gate soon after, alongside by a quarter to seven; gone by a quarter past six in the evening.
    expect(changes[0][0] - 24).toBeGreaterThan(5);
    expect(changes[0][0] - 24).toBeLessThan(6.5);
    expect(changes[1][0] - 24).toBeGreaterThan(17.5);
    expect(changes[1][0] - 24).toBeLessThan(18.7);
    expect(alongside / HOUR).toBeCloseTo(10.5, 0);
  });

  it('has several ship movements on the water at any busy hour, at ship speeds', () => {
    const tracks = spec.routes.filter((r) => !r.id.startsWith('ferry-')).map((r) => new Track(r, ref));
    let least = Infinity;
    let sum = 0;
    let n = 0;
    for (let h = 1; h < 12; h += 0.5) {
      let moving = 0;
      for (const t of tracks) {
        t.state(h * HOUR, st);
        if (st.active && st.sog > 1) moving++;
      }
      least = Math.min(least, moving);
      sum += moving;
      n++;
    }
    expect(least).toBeGreaterThanOrEqual(1);
    expect(sum / n).toBeGreaterThan(4);
  });
});

describe('keeping clear', () => {
  const she = { x: 0, y: 0, heading: 0, sog: 3, length: 10 };

  it('does nothing about a boat that will pass wide, is far off, or is going away', () => {
    expect(keepClear(she, { x: 300, y: 0, cog: 0, sog: 3 }, true).pace).toBe(1);
    expect(keepClear(she, { x: 0, y: 2000, cog: Math.PI, sog: 3 }, true).pace).toBe(1);
    expect(keepClear(she, { x: 0, y: -100, cog: Math.PI, sog: 3 }, true).danger).toBe(false);
  });

  it('slows to let a crossing boat go ahead, and the gap opens', () => {
    // The player comes in from her starboard side, on a course to meet her 120 m on.
    const other = { x: 120, y: 120, cog: -Math.PI / 2, sog: 3 };
    const c = keepClear(she, other, true);
    expect(c.danger).toBe(true);
    expect(c.pace).toBe(CLEAR.slow);
    expect(c.cpa).toBeLessThan(20);
    // Played forward at that pace, they never come within three lengths.
    let least = Infinity;
    for (let t = 0; t < 80; t += 0.5) least = Math.min(least, Math.hypot(120 - 3 * t, 120 - 3 * CLEAR.slow * t));
    expect(least).toBeGreaterThan(30);
  });

  it('hurries across instead when slowing would not open the gap', () => {
    // The player is crossing just astern of where she will be: stopping would put her in the way.
    const c = keepClear(she, { x: 95, y: 45, cog: -Math.PI / 2, sog: 3 }, true);
    expect(c.danger).toBe(true);
    expect(c.pace).toBe(CLEAR.hurry);
  });

  it('holds on when she is one of the big ones, and says there is danger so she can sound her horn', () => {
    const c = keepClear({ ...she, length: 40, sog: 8 }, { x: 150, y: 300, cog: -Math.PI / 2, sog: 4 }, false);
    expect(c.pace).toBe(1);
    expect(c.danger).toBe(true);
    expect(givesWay('launch')).toBe(false);
    expect(givesWay('cruiser')).toBe(true);
    expect(givesWay('kayak')).toBe(true);
  });

  it('leaves a boat that is lying still alone', () => {
    expect(keepClear({ ...she, sog: 0 }, { x: 0, y: 100, cog: Math.PI, sog: 3 }, true).pace).toBe(1);
  });

  it('falls behind her timetable while slowed, never by more than a minute and a half, and makes it all up afterwards', () => {
    let lag = 0;
    for (let i = 0; i < 100; i++) lag = lagAfter(lag, CLEAR.slow, 1);
    expect(lag).toBeCloseTo(70, 5);
    for (let i = 0; i < 1000; i++) lag = lagAfter(lag, CLEAR.slow, 1);
    expect(lag).toBe(CLEAR.most);
    let seconds = 0;
    while (lag !== 0 && seconds < 5000) {
      lag = lagAfter(lag, 1, 0.1);
      seconds += 0.1;
    }
    expect(lag).toBe(0);
    expect(seconds).toBeCloseTo(CLEAR.most / CLEAR.regain, 0);
    // Hurrying puts her a little ahead, and that comes back too.
    lag = 0;
    for (let i = 0; i < 1000; i++) lag = lagAfter(lag, CLEAR.hurry, 1);
    expect(lag).toBe(CLEAR.least);
    for (let i = 0; i < 4000; i++) lag = lagAfter(lag, 1, 0.1);
    expect(lag).toBe(0);
  });

  it('keeps her on her own line: a boat behind her timetable is where she was, so she cannot be put ashore', () => {
    const { world, file, marks } = load('sf-bay');
    const sea = seaOf(world, marks);
    const roster = new Roster(file, sea);
    const st = blankState();
    const i = roster.boats.findIndex((r) => r.spec.id === 'kestrel');
    const start = roster.boats[i].phases.find((p) => p.dir !== 0)!.t0;
    for (let lag = 0; lag <= CLEAR.most; lag += 10) {
      roster.state(i, start + 600 - lag, st);
      expect(sea.depth(st.x, st.y)).toBeGreaterThanOrEqual(NEED.cruiser);
    }
  });
});

describe('what a resident says', () => {
  const spec: ResidentSpec = {
    id: 'kestrel', name: 'Kestrel', kind: 'cruiser', type: '34 ft sloop', home: 'Sausalito', skipper: 'Dana Whitlock', line: 'a retired ferry mate.', colour: '#fff',
    length: 10, beam: 3.3, speedKt: 6, points: [[0, 0], [1000, 0]], ends: ['Sausalito', 'Ayala Cove'], out: [10, 16], stop: 60,
  };
  const facts: Facts = {
    windKt: 12.4, windFrom: 'west', windier: { name: 'Pier 39', kt: 19.6 }, turn: { high: true, minutes: 42 },
    berth: { name: 'Ayala Cove', say: 'Moorings and a beach.', nm: 1.24, toward: 'north-east' }, fish: { species: 'striped bass', place: 'Aquatic Park', how: 'trolling slowly' },
  };
  const sailing = { mode: 'sail' as const, bound: 'Ayala Cove' };

  it('answers a first hail with who she is and where she is bound', () => {
    const text = hailReply(spec, sailing, facts, 0, 'Fable');
    expect(text).toContain('Fable');
    expect(text).toContain('Kestrel here, Dana Whitlock aboard');
    expect(text).toContain('Ayala Cove');
    expect(hailReply(spec, { mode: 'berth', bound: 'Ayala Cove' }, facts, 0, 'Fable')).toMatch(/Lying here at Ayala Cove|stopped at Ayala Cove/);
    expect(hailReply({ ...spec, kind: 'fisher' }, { mode: 'work', bound: 'the flats' }, facts, 0, '')).toMatch(/skipper! Kestrel here.*(Working the bank|Fishing this patch)/);
    // The same boat says the same thing to the same hail.
    expect(hailReply(spec, sailing, facts, 0, 'Fable')).toBe(text);
  });

  it('passes on something new each time after that: the wind, the tide, a place to lie, the fishing', () => {
    const said = [1, 2, 3, 4].map((n) => hailReply(spec, sailing, facts, n, 'Fable'));
    expect(new Set(said).size).toBe(4);
    const all = said.join(' ');
    expect(all).toMatch(/Pier 39.*20 knots|20 knots.*12/);
    expect(all).toMatch(/High water in about 40 minutes|turns in about 40 minutes: high water/);
    expect(all).toContain('ebb after that');
    expect(all).toMatch(/Ayala Cove.*1\.2 miles.*north-east|1\.2 miles north-east/);
    expect(all).toContain('Moorings and a beach.');
    expect(all).toContain('striped bass');
    expect(all).toContain('Aquatic Park');
    // Round again from the fifth.
    expect(hailReply(spec, sailing, facts, 5, 'Fable')).toContain(said[0].split('. ').slice(1).join('. ').slice(0, 12).split(' ')[0]);
  });

  it('says the wind is the same all over, skips a tide that is not turning, and owns up when nothing is biting', () => {
    const dull: Facts = { windKt: 8.2, windFrom: 'south-west', windier: null, turn: null, berth: null, fish: null };
    const said = [1, 2, 3, 4, 5, 6].map((n) => hailReply(spec, sailing, dull, n, 'Fable')).join(' ');
    expect(said).toMatch(/8 knots/);
    expect(said).toContain('south-west');
    expect(said).toMatch(/Nothing much is biting|fishing is slow/);
    expect(said).not.toContain('undefined');
    expect(said).not.toContain('null');
  });

  it('greets a boat sailing past, by the time of day and the breeze', () => {
    expect(passingWords(spec, sailing, 9, 10, 'Fable')).toMatch(/^Morning/);
    expect(passingWords(spec, sailing, 15, 10, 'Fable')).toMatch(/^Afternoon/);
    expect(passingWords(spec, sailing, 19, 10, '')).toMatch(/^Evening/);
    expect(passingWords(spec, { mode: 'berth', bound: 'Ayala Cove' }, 15, 10, 'Fable')).toMatch(/anchor line|Kettle/);
    const windy = [9, 10, 11, 13, 14, 15, 16, 17].map((h) => passingWords(spec, sailing, h, 24, 'Fable')).join(' ');
    expect(windy).not.toContain('Lovely breeze');
  });

  it('grumbles at a boat that passes much too close', () => {
    expect(grumble(spec, 0, 'Fable')).toMatch(/Fable/);
    expect(grumble({ ...spec, kind: 'kayak' }, 0, 'Fable')).toMatch(/kayak|wash/);
  });

  it('puts a kayaker\'s words across the water, not on the radio', () => {
    expect(hasRadio('kayak')).toBe(false);
    expect(hasRadio('cruiser')).toBe(true);
    expect(hasRadio('fisher')).toBe(true);
  });

  it('offers a race to a boat sailing alongside on the same course, and says who was first', () => {
    const she = { x: 0, y: 0, heading: 0.2, sog: 3 };
    expect(alongside(she, { x: 40, y: -20, heading: 0.4, sog: 3.2 })).toBe(true);
    expect(alongside(she, { x: DUEL.near + 20, y: 0, heading: 0.2, sog: 3 })).toBe(false);
    expect(alongside(she, { x: 40, y: 0, heading: 0.2 + Math.PI, sog: 3 })).toBe(false);
    expect(alongside(she, { x: 40, y: 0, heading: 0.2, sog: 0.2 })).toBe(false);
    expect(alongside({ ...she, sog: 0 }, { x: 40, y: 0, heading: 0.2, sog: 3 })).toBe(false);
    expect(duelCall(spec, 'Ayala Cove', 'Fable')).toContain('Ayala Cove');
    expect(duelResult(spec, 'Ayala Cove', true, 'Fable')).toMatch(/Well sailed|beaten/);
    expect(duelResult(spec, 'Ayala Cove', false, 'Fable')).toMatch(/Kestrel is first|we had you/);
  });

  it('is worth a few points the first time she is met', () => {
    expect(metAward('Kestrel')).toEqual({ kind: 'met', points: 10, label: 'Met Kestrel' });
  });
});
