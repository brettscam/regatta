import { describe, expect, it } from 'vitest';
import { Banter, BANTER, lineFor, type BanterBoat } from '../src/race/banter';
import { CAST, LEVELS, MAX_PACE, MIXES, drawEntrants, drift, entrantOf, hashText, readMix, readPace, type Mix } from '../src/race/cast';
import { BERTH_BACK, remainingBy, startBerths } from '../src/race/sailor';
import { RING } from '../src/race/startline';
import { berthClear } from '../src/race/trial';
import { allRaces, boatOf, worldOf } from './waters';

describe('the club', () => {
  it('has sixteen skippers, each her own boat, colour and number, from ringers to the sunset cruisers', () => {
    expect(CAST.length).toBe(16);
    for (const key of ['id', 'skipper', 'boat', 'colour', 'sail'] as const) expect(new Set(CAST.map((s) => s[key])).size).toBe(CAST.length);
    for (const s of CAST) {
      expect(s.colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.sail).toMatch(/^[0-9]{1,4}$/);
      expect(LEVELS.some((l) => l.id === s.level)).toBe(true);
      expect(s.character.length).toBeGreaterThan(20);
      for (const o of ['start', 'mark', 'passing', 'passed', 'finish', 'oops'] as const) expect(s.lines[o]).toBeTruthy();
    }
    for (const l of LEVELS) expect(CAST.filter((s) => s.level === l.id).length).toBeGreaterThanOrEqual(2);
  });

  it('gets worse at everything from one level to the next', () => {
    const size = (l: (typeof LEVELS)[number]) => [l.start.backM[1], l.start.lateS[1], -l.start.speedKt, l.trim.errDeg, l.trim.lagS, -l.trim.rateDegS, -l.trim.gust, l.helm.wanderDeg, l.helm.laylineDeg, l.helm.wideS, l.fumbleS, l.sails.reefLateKt, -l.sails.reefMax];
    for (let i = 1; i < LEVELS.length; i++) {
      const a = size(LEVELS[i - 1]);
      const b = size(LEVELS[i]);
      b.forEach((v, k) => expect(v).toBeGreaterThanOrEqual(a[k]));
    }
    // The ringer makes no mistakes at all: she is the plain pilot with a perfect crew.
    const r = LEVELS[0];
    expect([r.trim.errDeg, r.helm.wanderDeg, r.helm.laylineDeg, r.helm.extraTackS, r.helm.wideS, r.fumbleS, r.blunderS, r.start.lateS[1]]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('who turns out for a race', () => {
  it('is the same on two pages with the same call', () => {
    for (const id of ['lq3k9z1a2b', 'r-sf-bay-alcatraz-lap-28871234', 'x']) {
      for (const mix of ['beer', 'mixed', 'hot'] as Mix[]) {
        const a = drawEntrants(id, 9, mix);
        const b = drawEntrants(id, 9, mix);
        expect(a.map((e) => [e.who.id, e.seed, e.form])).toEqual(b.map((e) => [e.who.id, e.seed, e.form]));
        expect(a.length).toBe(9);
        expect(new Set(a.map((e) => e.who.id)).size).toBe(9);
        // A smaller fleet from the same call is the first few of the larger one.
        expect(drawEntrants(id, 4, mix).map((e) => e.who.id)).toEqual(a.slice(0, 4).map((e) => e.who.id));
      }
    }
  });

  it('differs from race to race', () => {
    const fleets = new Set(Array.from({ length: 40 }, (_, i) => drawEntrants(`race-${i}`, 5, 'mixed').map((e) => e.who.id).join()));
    expect(fleets.size).toBeGreaterThan(35);
  });

  it('is mostly mid-fleet and back-markers in a beer can fleet, and mostly good boats in a hot one', () => {
    const share = (mix: Mix, levels: string[]) => {
      let hit = 0;
      let all = 0;
      for (let i = 0; i < 300; i++) for (const e of drawEntrants(`r${i}`, 5, mix)) { all++; if (levels.includes(e.level.id)) hit++; }
      return hit / all;
    };
    expect(share('beer', ['steady', 'casual', 'sunset'])).toBeGreaterThan(0.85);
    expect(share('beer', ['ringer'])).toBeLessThan(0.06);
    // There are only five good boats in the club, so a hot fleet of five cannot be all of them every time.
    expect(share('hot', ['ringer', 'sharp'])).toBeGreaterThan(0.6);
    expect(share('mixed', ['ringer', 'sharp'])).toBeGreaterThan(0.2);
    expect(share('mixed', ['casual', 'sunset'])).toBeGreaterThan(0.25);
  });

  it('trusts nothing from the wire', () => {
    expect(readPace(9)).toBe(9);
    expect(readPace(40)).toBe(MAX_PACE);
    expect(readPace(-3)).toBe(0);
    expect(readPace(2.6)).toBe(3);
    for (const bad of [NaN, Infinity, '5', null, undefined, {}]) expect(readPace(bad)).toBe(0);
    expect(readMix('beer')).toBe('beer');
    expect(readMix('hot')).toBe('hot');
    for (const bad of ['', 'HOT', 3, null, undefined, { id: 'beer' }]) expect(readMix(bad)).toBe('mixed');
    expect(MIXES.map((m) => m.id)).toEqual(['beer', 'mixed', 'hot']);
    expect(drawEntrants('a', 99, 'nonsense' as Mix).length).toBe(MAX_PACE);
    expect(drawEntrants('a', NaN).length).toBe(0);
  });

  it('gives each skipper luck that is fixed by the race', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    const e = entrantOf('casual', 1234);
    expect(e.form).toBeGreaterThanOrEqual(0.8);
    expect(e.form).toBeLessThanOrEqual(1.2);
    // The drift her helm and her sheets follow: smooth, bounded, and the same every time it is asked.
    for (let x = 0; x < 50; x += 0.37) {
      const v = drift(e.seed, x);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(drift(e.seed, x)).toBe(v);
      expect(Math.abs(drift(e.seed, x + 0.01) - v)).toBeLessThan(0.05);
    }
  });
});

describe('ten boats on the line', () => {
  const spec = boatOf('perf45');
  for (const { water, race } of allRaces()) {
    it(`${race.id}: nine berths afloat, apart, ahead of the players' row and each with her own lane through the ring`, () => {
      const world = worldOf(water, 2.5);
      const clear = berthClear(world, spec.dimensions.draft);
      for (const id of ['a', 'b', 'c']) {
        const entrants = drawEntrants(id + race.id, 9, 'mixed');
        const berths = startBerths(race.marks, entrants, clear);
        expect(berths).toEqual(startBerths(race.marks, entrants, clear));
        const start = race.marks[0];
        const along = Math.atan2(race.marks[1].x - start.x, race.marks[1].y - start.y);
        berths.forEach((b, i) => {
          expect(clear(b.x, b.y)).toBe(true);
          // Short of the start mark, and nearer it than the row the players are towed to (330 m back).
          const back = -((b.x - start.x) * Math.sin(along) + (b.y - start.y) * Math.cos(along));
          expect(back).toBeGreaterThan(90);
          expect(back).toBeLessThanOrEqual(BERTH_BACK + 0.5);
          expect(Math.hypot(b.laneX - start.x, b.laneY - start.y)).toBeLessThan(RING - 20);
          for (let j = 0; j < i; j++) expect(Math.hypot(b.x - berths[j].x, b.y - berths[j].y)).toBeGreaterThan(30);
        });
        // The lanes are spread across the ring, not one point.
        expect(new Set(berths.map((b) => Math.round(b.laneX) + ',' + Math.round(b.laneY))).size).toBeGreaterThanOrEqual(7);
      }
    });
  }

  it('measures what is left of a course by its marks', () => {
    const marks = [{ name: 'a', x: 0, y: 0 }, { name: 'b', x: 0, y: 1000 }, { name: 'c', x: 500, y: 1000 }];
    expect(remainingBy(marks, 0, 200)).toBe(1700);
    expect(remainingBy(marks, 1, 400)).toBe(900);
    expect(remainingBy(marks, 2, 120)).toBe(120);
  });
});

describe('what the club boats say', () => {
  const entrants = drawEntrants('banter-1', 5, 'mixed');
  const boats = (over: Partial<BanterBoat>[] = []): BanterBoat[] => entrants.map((entrant, i) => ({ entrant, x: 100 * i, y: 0, leg: 1, finish: null, remaining: 5000 + i * 100, blunders: 0, ...over[i] }));
  const run = () => {
    const b = new Banter('banter-1');
    const said: Array<[number, string, string]> = [];
    for (let t = -5; t < 900; t++) {
      const now = boats(t > 300 ? [{ leg: 2 }, { leg: 2 }, {}, { blunders: 1 }] : []);
      if (t > 600) now[0] = { ...now[0], finish: 600, remaining: 0 };
      // The player works past the second boat at five minutes.
      const r = b.poll({ t, marks: 4, me: { x: 120, y: 30, remaining: t < 300 ? 5150 : 5050, finished: false }, boats: now });
      if (r) said.push([t, r.from, r.text]);
    }
    return said;
  };

  it('is the same every time for the same race', () => {
    expect(run()).toEqual(run());
  });

  it('is sparing: nothing before the gun, a pause after every remark, and nobody twice in quick succession', () => {
    const said = run();
    expect(said.length).toBeGreaterThanOrEqual(3);
    expect(said.length).toBeLessThanOrEqual(10);
    expect(said[0][0]).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < said.length; i++) {
      expect(said[i][0] - said[i - 1][0]).toBeGreaterThanOrEqual(BANTER.pause);
      for (let j = 0; j < i; j++) if (said[j][1] === said[i][1]) expect(said[i][0] - said[j][0]).toBeGreaterThanOrEqual(BANTER.each);
    }
  });

  it('speaks in character', () => {
    const said = run();
    const lines = new Set(CAST.flatMap((s) => Object.values(s.lines)));
    for (const [, from, text] of said) {
      expect(lines.has(text)).toBe(true);
      expect(entrants.some((e) => from === `${e.who.skipper.split(' ')[0]}, ${e.who.boat}`)).toBe(true);
    }
    // Passed by the player, the boat she passed has something to say about it.
    expect(said.some(([, , text]) => text === lineFor(entrants[1], 'passed'))).toBe(true);
    const ringer = CAST.find((s) => s.id === 'dex')!;
    expect(ringer.lines.passed).toContain('Protest');
    expect(CAST.find((s) => s.id === 'biff')!.lines.mark).toContain('bottle opener');
  });
});
