import { describe, expect, it } from 'vitest';
import { weightOf } from '../src/fishing/bites';
import {
  FORMATS, MAX_FISH, MAX_RIVALS, derbyFromQuery, derbyLink, derbyRivals, elapsedOf, fixDerby, formatWords, isOpen, makeDerby, nextWeekly, packEntry, placeXp, readDerby, readEntry,
  rivalFish, rodSkill, scoreOf, stageOf, standings, targetOf, type DerbyCall, type DerbyFish,
} from '../src/fishing/derby';
import { DRAG, FOUL_ANGLE, PART, SLACK, SPOOL, endWords, fightCall, fishPull, phaseWords, startFight, steadyHand, stepFight, type Fight, type FightInput } from '../src/fishing/fight';
import { bigness, landedPoints, pointsFor } from '../src/fishing/points';
import { speciesOf, tableOf, type FishSpecies } from '../src/fishing/table';

const WATER = 'catalina';
const table = tableOf(WATER)!;
const sp = (id: string): FishSpecies => speciesOf(table, id)!;
const fish = (id: string, cm: number, kept = true, m = 5): DerbyFish => ({ id, cm, kept, m });

// ---- the fight ------------------------------------------------------------------------------------------------------

type Policy = (f: Fight) => FightInput;
function play(id: string, cm: number, policy: Policy, seed = 12345, lineOut = 40): Fight & { peak: number } {
  const s = sp(id);
  const f = startFight(s.fight, bigness(s, cm), seed, lineOut) as Fight & { peak: number };
  f.peak = lineOut;
  while (!f.result && f.t < 1800) {
    stepFight(f, policy(f), 1 / 60);
    f.peak = Math.max(f.peak, f.line);
  }
  return f;
}
const horse: Policy = () => ({ reel: true, boatKt: 0.5, turn: 0 });
const idle: Policy = () => ({ reel: false, boatKt: 0.5, turn: 0 });
const under = (kt: number, steer = true): Policy => (f) => ({ ...steadyHand(f), boatKt: kt, ...(steer ? {} : { turn: 0 }) });

describe('the fight', () => {
  it('is won by a steady hand: wind when it rests, let the drag work when it runs', () => {
    for (const [id, cm] of [['calico', 40], ['bonito', 55], ['halibut', 80], ['yellowtail', 80], ['yellowtail', 105], ['dorado', 100], ['seabass', 115], ['yellowfin', 105], ['bluefin', 135], ['marlin', 193]] as Array<[string, number]>) {
      let won = 0;
      for (let k = 1; k <= 8; k++) if (play(id, cm, steadyHand, k * 7919).result === 'landed') won++;
      expect(won, `${id} ${cm}`).toBe(8);
    }
    // The fish of a lifetime can still take every yard of line: winnable, not certain.
    let won = 0;
    for (let k = 1; k <= 12; k++) if (play('bluefin', 197, steadyHand, k * 7919).result === 'landed') won++;
    expect(won).toBeGreaterThan(3);
  });

  it('takes seconds for a small fish and minutes for a big one', () => {
    expect(play('calico', 40, steadyHand).t).toBeLessThan(40);
    expect(play('mackerel', 30, steadyHand).t).toBeLessThan(30);
    const yt = play('yellowtail', 80, steadyHand);
    expect(yt.t).toBeGreaterThan(60);
    expect(yt.t).toBeLessThan(240);
    const tuna = play('bluefin', 135, steadyHand);
    expect(tuna.t).toBeGreaterThan(240);
    expect(tuna.t).toBeLessThan(720);
    expect(tuna.peak).toBeGreaterThan(yt.peak);
    expect(tuna.peak).toBeLessThan(SPOOL);
  });

  it('is lost by horsing a big fish, and a small one can be wound straight in', () => {
    for (const [id, cm] of [['yellowtail', 90], ['yellowfin', 100], ['marlin', 190], ['seabass', 100]] as Array<[string, number]>) {
      const f = play(id, cm, horse);
      expect(f.result, id).toBe('broke');
      expect(f.t, id).toBeLessThan(6);
    }
    expect(play('calico', 40, horse).result).toBe('landed');
    expect(play('sculpin', 28, horse).result).toBe('landed');
  });

  it('is lost by slack line, and by leaving a big one to run', () => {
    expect(play('calico', 40, idle).result).toBe('pulled');
    expect(play('calico', 40, idle).t).toBeLessThan(30);
    expect(['pulled', 'spooled']).toContain(play('yellowtail', 90, idle).result);
    expect(play('bluefin', 135, idle).result).toBe('spooled');
  });

  it('is lost by a boat that keeps going, and harder with way on', () => {
    for (const [id, cm] of [['yellowtail', 105], ['seabass', 115], ['bluefin', 103]] as Array<[string, number]>) {
      expect(play(id, cm, under(7)).result, id).toBe('broke');
      const slow = play(id, cm, under(4));
      expect(slow.result, id).toBe('landed');
      expect(slow.peak, id).toBeGreaterThan(play(id, cm, steadyHand).peak);
    }
    // A small fish skips in behind her whatever she is doing.
    expect(play('bonito', 45, under(7)).result).toBe('landed');
  });

  it('wants the boat steered away from a big fish when she has way on, and not when she lies stopped', () => {
    let cut = 0;
    let saved = 0;
    for (const [id, cm] of [['yellowtail', 105], ['dorado', 100], ['dorado', 137], ['yellowfin', 105], ['bluefin', 135], ['seabass', 115]] as Array<[string, number]>) {
      if (play(id, cm, under(2, false)).result === 'cut') cut++;
      if (play(id, cm, under(2, true)).result === 'landed') saved++;
      const f = play(id, cm, steadyHand);
      expect(f.foul, id).toBe(0);
    }
    expect(cut).toBeGreaterThanOrEqual(4);
    expect(saved).toBe(6);
    // Small fish never get round her.
    expect(play('calico', 40, under(2, false)).result).toBe('landed');
  });

  it('is the same fight for the same fish', () => {
    const a = play('yellowtail', 90, steadyHand, 4242);
    const b = play('yellowtail', 90, steadyHand, 4242);
    expect(b.t).toBe(a.t);
    expect(b.peak).toBe(a.peak);
    expect(play('yellowtail', 90, steadyHand, 4243).t).not.toBe(a.t);
  });

  it('tells the angler what is wrong, in time', () => {
    const f = startFight(sp('yellowtail').fight, 0.5, 99, 40);
    expect(f.phase).toBe('run');
    expect(phaseWords(f)).toBe('running');
    expect(fishPull(f)).toBeGreaterThan(0.35);
    expect(fightCall({ ...f, tension: PART * 0.97 }, { reel: true, boatKt: 0.5, turn: 0 })).toMatch(/Stop winding/);
    expect(fightCall({ ...f, tension: PART * 0.97 }, { reel: false, boatKt: 6, turn: 0 })).toMatch(/Slow the boat/);
    expect(fightCall({ ...f, phase: 'rest', tension: SLACK }, { reel: false, boatKt: 0.5, turn: 0 })).toMatch(/Slack line/);
    expect(fightCall({ ...f, angle: FOUL_ANGLE * 0.9 }, { reel: false, boatKt: 2, turn: 0 })).toMatch(/Steer to port, away from the fish/);
    expect(fightCall({ ...f, angle: -FOUL_ANGLE * 0.9 }, { reel: false, boatKt: 2, turn: 0 })).toMatch(/Steer to starboard/);
    expect(fightCall({ ...f, line: SPOOL * 0.8 }, { reel: false, boatKt: 2, turn: 0 })).toMatch(/Nearly out of line/);
    expect(fightCall({ ...f, tension: DRAG }, { reel: false, boatKt: 0.5, turn: 0 })).toBe('');
    for (const end of ['broke', 'pulled', 'spooled', 'cut', 'landed'] as const) expect(endWords(end).length).toBeGreaterThan(5);
  });
});

// ---- tournaments -----------------------------------------------------------------------------------------------------

const call = (over: Partial<DerbyCall> = {}): DerbyCall => ({ ...makeDerby(WATER, 'Ann', 'points', 40, 20000, 5), ...over });

describe('a tournament call', () => {
  it('is the same on every page from the same facts', () => {
    const a = makeDerby(WATER, 'Ann', 'big', 40, 20000.4, 5);
    const b = makeDerby(WATER, 'Ann', 'big', 40, 20000, 5);
    expect(a).toEqual(b);
    expect(a.id).toBe('d-catalina-big-20000-40');
    expect(fixDerby(WATER, 'jackpot', 60, 1.7e12 + 20000, 3)).toEqual(fixDerby(WATER, 'jackpot', 60, 1.7e12 + 10000, 3));
    expect(makeDerby(WATER, 'Ann', 'points', 40, 0, 99).rivals).toBe(MAX_RIVALS);
    expect(formatWords(call(), table)).toBe('Most points, 40 minutes');
    expect(formatWords(call({ fmt: 'species', sp: 'calico' }), table)).toBe('Calico bass only, 40 minutes');
    expect(formatWords(call({ fmt: 'jackpot' }), table)).toBe('Yellowtail jackpot, 40 minutes');
    expect(targetOf(call({ fmt: 'jackpot' }), table)?.id).toBe('yellowtail');
    expect(targetOf(call(), table)).toBeNull();
  });

  it('is checked before it is believed', () => {
    const good = call();
    expect(readDerby(JSON.parse(JSON.stringify(good)), WATER, table)).toEqual(good);
    expect(readDerby(good, 'sf-bay', table)).toBeNull();
    expect(readDerby(null, WATER, table)).toBeNull();
    expect(readDerby('a tournament', WATER, table)).toBeNull();
    expect(readDerby({ ...good, fmt: 'everything' }, WATER, table)).toBeNull();
    expect(readDerby({ ...good, id: '<script>' }, WATER, table)).toBeNull();
    expect(readDerby({ ...good, len: 100000 }, WATER, table)).toBeNull();
    expect(readDerby({ ...good, len: 1 }, WATER, table)).toBeNull();
    expect(readDerby({ ...good, in: NaN }, WATER, table)).toBeNull();
    expect(readDerby({ ...good, in: -5 }, WATER, table)).toBeNull();
    expect(readDerby({ ...good, fmt: 'species' }, WATER, table)).toBeNull();
    expect(readDerby({ ...good, fmt: 'species', sp: 'unicorn' }, WATER, table)).toBeNull();
    expect(readDerby({ ...good, fmt: 'species', sp: 'calico' }, WATER, table)?.sp).toBe('calico');
    const dressed = readDerby({ ...good, rivals: 400, name: '<b>Mine</b>', host: 'x'.repeat(200) }, WATER, table)!;
    expect(dressed.rivals).toBe(MAX_RIVALS);
    expect(dressed.name).toBe('bMine/b');
    expect(dressed.host.length).toBe(24);
    // On the real clock: nothing more than a week off, nothing long over, and the id is rebuilt here, not taken.
    const now = 1.8e12;
    const fixed = readDerby({ id: 'anything', fmt: 'big', len: 40, water: WATER, at: now + 3600e3, rivals: 2 }, WATER, table, now)!;
    expect(fixed).toEqual(fixDerby(WATER, 'big', 40, now + 3600e3, 2));
    expect(readDerby({ ...fixed, at: now + 8 * 86400e3 }, WATER, table, now)).toBeNull();
    expect(readDerby({ ...fixed, at: now - 3 * 3600e3 }, WATER, table, now)).toBeNull();
  });

  it('runs on the season clock, or on the real one when it is fixed', () => {
    const c = call();
    expect(elapsedOf(c, 19940)).toBe(-60);
    expect(stageOf(c, -60)).toBe('before');
    expect(stageOf(c, 10)).toBe('fishing');
    expect(stageOf(c, 40 * 60)).toBe('over');
    const now = 1.8e12;
    const fixed = fixDerby(WATER, 'points', 40, now, 3);
    expect(elapsedOf(fixed, 123456, now + 90e3)).toBe(90);
    expect(isOpen(fixed, now - 30 * 60e3)).toBe(false);
    expect(isOpen(fixed, now - 20 * 60e3)).toBe(true);
    expect(isOpen(fixed, now + 39 * 60e3)).toBe(true);
    expect(isOpen(fixed, now + 41 * 60e3)).toBe(false);
    expect(isOpen(c, now)).toBe(true);
  });

  it('travels in a link', () => {
    const now = 1.8e12;
    const fixed = fixDerby(WATER, 'species', 60, now + 3600e3, 3, "Ann's tournament", 'calico');
    const link = derbyLink(fixed, 'https://example.test/play');
    expect(link).toMatch(/^https:\/\/example\.test\/play\?/);
    expect(derbyFromQuery(link.slice(link.indexOf('?')), WATER, table, now)).toEqual(fixed);
    expect(derbyFromQuery(link.slice(link.indexOf('?')), 'sf-bay', table, now)).toBeNull();
    expect(derbyFromQuery('?go=1', WATER, table, now)).toBeNull();
    expect(derbyFromQuery('?derby=points&at=banana&water=catalina', WATER, table, now)).toBeNull();
  });

  it('comes round every week from the calendar', () => {
    const list = [{ id: 'sat', name: 'The Saturday derby', water: WATER, fmt: 'points' as const, len: 40, dow: 6, utc: '17:00', rivals: 5 }];
    // Saturday 1 August 2026, 17:00 UTC.
    const at = Date.UTC(2026, 7, 1, 17, 0);
    expect(new Date(at).getUTCDay()).toBe(6);
    expect(nextWeekly(WATER, at - 2 * 3600e3, list)?.at).toBe(at);
    expect(nextWeekly(WATER, at + 20 * 60e3, list)?.at).toBe(at);
    expect(nextWeekly(WATER, at + 20 * 60e3, list)).toEqual(nextWeekly(WATER, at - 3600e3, list));
    // Over, and the next is days away: nothing to offer.
    expect(nextWeekly(WATER, at + 45 * 60e3, list)).toBeNull();
    expect(nextWeekly(WATER, at - 3 * 86400e3, list)).toBeNull();
    expect(nextWeekly(WATER, at + 6.5 * 86400e3, list)?.at).toBe(at + 7 * 86400e3);
    expect(nextWeekly('sf-bay', at, list)).toBeNull();
    // The game's own calendar is readable and names real formats.
    const real = nextWeekly(WATER, Date.UTC(2026, 7, 1, 16, 30));
    expect(real?.name).toBe('The Saturday derby');
    expect(real?.rivals).toBe(5);
  });
});

describe('scoring', () => {
  const catchOf: DerbyFish[] = [
    fish('calico', 30, false, 2),          // short
    fish('calico', 45, true, 4),
    fish('yellowtail', 90, false, 9),      // let go
    fish('yellowtail', 75, true, 12),
    fish('bonito', 60, true, 15),
    fish('giantseabass', 150, false, 20),  // protected, let go
    fish('mackerel', 30, true, 22),
  ];
  const kg = (id: string, cm: number) => weightOf(sp(id), cm);

  it('most points: every fish, at what it scored', () => {
    const s = scoreOf(call(), table, catchOf);
    const want = landedPoints(sp('calico'), 30, 'short') + pointsFor(sp('calico'), 45) + landedPoints(sp('yellowtail'), 90, 'released') + pointsFor(sp('yellowtail'), 75)
      + pointsFor(sp('bonito'), 60) + landedPoints(sp('giantseabass'), 150, 'protected') + pointsFor(sp('mackerel'), 30);
    expect(s).toMatchObject({ score: want, unit: 'points', n: 7, last: 22 });
    expect(s.best?.name).toBe('giant sea bass');
  });

  it('biggest fish: the heaviest legal one, by the tape, kept or not', () => {
    const s = scoreOf(call({ fmt: 'big' }), table, catchOf);
    expect(s.unit).toBe('kg');
    expect(s.n).toBe(1);
    expect(s.best).toMatchObject({ name: 'yellowtail', cm: 90 });
    expect(s.score).toBeCloseTo(kg('yellowtail', 90), 1);
    expect(s.last).toBe(9);
    // A short fish and a protected one do not count, however heavy.
    expect(scoreOf(call({ fmt: 'big' }), table, [fish('giantseabass', 200, false), fish('yellowtail', 58, false)]).score).toBe(0);
  });

  it('heaviest three: from the box only', () => {
    const s = scoreOf(call({ fmt: 'three' }), table, catchOf);
    expect(s.n).toBe(3);
    expect(s.score).toBeCloseTo(kg('yellowtail', 75) + kg('bonito', 60) + kg('calico', 45), 1);
    expect(s.best).toMatchObject({ name: 'yellowtail', cm: 75 });
    expect(scoreOf(call({ fmt: 'three' }), table, [fish('yellowtail', 90, false)]).score).toBe(0);
  });

  it('one species: only that fish counts', () => {
    const s = scoreOf(call({ fmt: 'species', sp: 'calico' }), table, catchOf);
    expect(s.score).toBe(landedPoints(sp('calico'), 30, 'short') + pointsFor(sp('calico'), 45));
    expect(s.n).toBe(2);
    expect(scoreOf(call({ fmt: 'species', sp: 'halibut' }), table, catchOf).score).toBe(0);
  });

  it('jackpot: the single biggest of the jackpot fish', () => {
    const s = scoreOf(call({ fmt: 'jackpot' }), table, catchOf);
    expect(s.score).toBeCloseTo(kg('yellowtail', 90), 1);
    expect(s.best?.cm).toBe(90);
    expect(scoreOf(call({ fmt: 'jackpot' }), table, [fish('bluefin', 190)]).score).toBe(0);
  });

  it('ranks the board, breaks a tie by who had hers first, and puts the blanks last', () => {
    const rows = [
      { name: 'Late', boat: '', me: false, rival: false, fish: [fish('yellowtail', 80, true, 30)] },
      { name: 'Blank', boat: '', me: false, rival: true, fish: [] },
      { name: 'Early', boat: '', me: true, rival: false, fish: [fish('yellowtail', 80, true, 10)] },
      { name: 'Small', boat: '', me: false, rival: false, fish: [fish('calico', 40, true, 1)] },
    ];
    const table2 = standings(call({ fmt: 'big' }), table, rows);
    expect(table2.map((r) => r.name)).toEqual(['Early', 'Late', 'Small', 'Blank']);
    expect(table2.map((r) => r.place)).toEqual([1, 2, 3, 4]);
    expect(table2[3].score).toBe(0);
    expect(table2[0].me).toBe(true);
  });

  it('pays experience for a place, and nothing for an empty box or an empty field', () => {
    expect(placeXp(1, 6, 500)).toBe(80);
    expect(placeXp(1, 2, 500)).toBe(40);
    expect(placeXp(2, 6, 300)).toBe(25);
    expect(placeXp(3, 6, 200)).toBe(15);
    expect(placeXp(5, 6, 100)).toBe(5);
    expect(placeXp(1, 6, 0)).toBe(0);
    expect(placeXp(1, 1, 900)).toBe(0);
  });
});

describe('what another boat says she caught', () => {
  const c = call();

  it('goes on the wire and comes back the same when it is honest', () => {
    const mine = [fish('calico', 45, true, 4), fish('yellowtail', 90, false, 9), fish('calico', 30, false, 11)];
    const wire = JSON.parse(JSON.stringify(packEntry(table, mine))) as unknown;
    expect(readEntry(wire, table, c, 12)).toEqual(mine);
  });

  it('drops what is not possible', () => {
    const read = (v: unknown, minutes = 30) => readEntry(v, table, c, minutes);
    expect(read(null)).toEqual([]);
    expect(read('fish')).toEqual([]);
    expect(read([['unicorn', 100, 1, 3]])).toEqual([]);
    // Bigger than the species grows, or smaller than is ever caught.
    expect(read([['calico', sp('calico').trophyCm + 1, 1, 3]])).toEqual([]);
    expect(read([['calico', 5, 1, 3]])).toEqual([]);
    expect(read([['bluefin', 900, 1, 3]])).toEqual([]);
    expect(read([['calico', 'huge', 1, 3], ['calico', NaN, 1, 3], ['calico', 40], 7, null])).toEqual([]);
    // Not yet caught, or outside the tournament.
    expect(read([['calico', 40, 1, 25]], 10)).toEqual([]);
    expect(read([['calico', 40, 1, -1]])).toEqual([]);
    expect(read([['calico', 40, 1, 45]], 60)).toEqual([]);
    expect(read([['calico', 40, 1, 11]], 10)).toEqual([fish('calico', 40, true, 11)]);
    // No more than two fish in any one minute.
    expect(read([['calico', 40, 1, 3], ['calico', 41, 1, 3], ['calico', 42, 1, 3], ['calico', 43, 1, 4]]).map((f) => f.cm)).toEqual([40, 41, 43]);
  });

  it('caps the fish, and never trusts a weight or a score', () => {
    const many = Array.from({ length: 80 }, (_, i) => ['bonito', 60, 1, i % 30]);
    const got = readEntry(many, table, c, 30);
    expect(got.length).toBeLessThanOrEqual(MAX_FISH);
    // Extra fields on the wire are ignored: the weight and the points are worked out here from the length.
    const fat = readEntry([['calico', 40, 1, 3, 9999, 'a ton']], table, c, 30);
    expect(fat).toEqual([fish('calico', 40, true, 3)]);
    expect(scoreOf(c, table, fat).score).toBe(pointsFor(sp('calico'), 40));
    // The most anyone could claim is bounded: a full card of the biggest fish there is.
    const best = Math.max(...table.species.map((s) => s.worth));
    expect(scoreOf(c, table, readEntry(Array.from({ length: 60 }, (_, i) => ['marlin', 270, 0, i % 30]), table, c, 30)).score).toBeLessThanOrEqual(MAX_FISH * best * 1.1);
  });

  it('counts a fish as let go when it could not legally have been kept', () => {
    const got = readEntry([['calico', 30, 1, 1], ['giantseabass', 150, 1, 2], ['sheephead', 45, 1, 3], ['sheephead', 46, 1, 4], ['sheephead', 47, 1, 5]], table, c, 30);
    expect(got.map((f) => f.kept)).toEqual([false, false, true, true, false]);
    // So a poached giant cannot win the heaviest three.
    expect(scoreOf(call({ fmt: 'three' }), table, got).best?.name).toBe('sheephead');
  });

  it('sends only her best when she has more than the cap', () => {
    const mine = Array.from({ length: 30 }, (_, i) => fish('bonito', 40 + i, true, i));
    const wire = packEntry(table, mine) as unknown[][];
    expect(wire.length).toBe(MAX_FISH);
    expect(Math.min(...wire.map((w) => w[1] as number))).toBe(46);
  });
});

describe('the club skippers', () => {
  it('are the same on every page, and fish the same fish', () => {
    const c = call();
    const a = derbyRivals(c);
    const b = derbyRivals(JSON.parse(JSON.stringify(c)) as DerbyCall);
    expect(a.map((e) => e.who.id)).toEqual(b.map((e) => e.who.id));
    expect(a.length).toBe(5);
    expect(new Set(a.map((e) => e.who.id)).size).toBe(5);
    for (const e of a) expect(rivalFish(c, table, e, 1500)).toEqual(rivalFish(c, table, b.find((x) => x.who.id === e.who.id)!, 1500));
    expect(derbyRivals(call({ id: 'd-other' })).map((e) => e.who.id)).not.toEqual(a.map((e) => e.who.id));
    expect(derbyRivals(call({ rivals: 0 }))).toEqual([]);
  });

  it('have nothing before lines in, more as time goes by, and nothing after lines out that was not there at lines out', () => {
    const c = call({ rivals: 6 });
    for (const e of derbyRivals(c)) {
      expect(rivalFish(c, table, e, 0).length).toBeLessThanOrEqual(1);
      let last: DerbyFish[] = [];
      for (let s = 0; s <= 40 * 60; s += 120) {
        const now = rivalFish(c, table, e, s);
        expect(now.slice(0, last.length)).toEqual(last);
        for (const f of now) {
          expect(f.m * 60).toBeLessThanOrEqual(s);
          expect(f.m).toBeLessThan(c.len);
        }
        last = now;
      }
      expect(rivalFish(c, table, e, 5 * 3600)).toEqual(last);
      // And what they say would pass the same check as anybody's.
      expect(readEntry(packEntry(table, last), table, c, 40)).toEqual(last);
    }
  });

  it('are plausible: the better skipper does better on the whole, and nobody runs away with it', () => {
    const bySkill = new Map<number, { points: number; fish: number; n: number }>();
    let top = 0;
    for (let k = 0; k < 120; k++) {
      const c = call({ id: `d-test-${k}`, rivals: 6 });
      for (const e of derbyRivals(c)) {
        const got = rivalFish(c, table, e, 40 * 60);
        const score = scoreOf(c, table, got).score;
        top = Math.max(top, score);
        const row = bySkill.get(rodSkill(e)) ?? { points: 0, fish: 0, n: 0 };
        row.points += score;
        row.fish += got.length;
        row.n++;
        bySkill.set(rodSkill(e), row);
      }
    }
    const mean = (skill: number) => bySkill.get(skill)!.points / bySkill.get(skill)!.n;
    const count = (skill: number) => bySkill.get(skill)!.fish / bySkill.get(skill)!.n;
    expect(mean(1)).toBeGreaterThan(mean(0.5) * 1.2);
    expect(mean(0.5)).toBeGreaterThan(mean(0) * 1.2);
    // Forty minutes: a handful of fish each, and a few hundred points, in line with a person fishing well.
    expect(count(1)).toBeGreaterThan(4);
    expect(count(1)).toBeLessThan(9);
    expect(count(0)).toBeGreaterThan(1.5);
    expect(mean(1)).toBeGreaterThan(450);
    expect(mean(1)).toBeLessThan(1400);
    expect(mean(0)).toBeGreaterThan(100);
    expect(top).toBeLessThan(6000);
  });

  it('fish for the one species when that is the tournament, and a scarce one comes seldom', () => {
    let calico = 0;
    let yellowtail = 0;
    for (let k = 0; k < 60; k++) {
      const one = call({ id: `d-sp-${k}`, fmt: 'species', sp: 'calico', rivals: 6 });
      for (const e of derbyRivals(one)) {
        const got = rivalFish(one, table, e, 40 * 60);
        expect(got.every((f) => f.id === 'calico')).toBe(true);
        calico += got.length;
      }
      const jack = call({ id: `d-jp-${k}`, fmt: 'jackpot', rivals: 6 });
      for (const e of derbyRivals(jack)) {
        const got = rivalFish(jack, table, e, 40 * 60);
        expect(got.every((f) => f.id === 'yellowtail')).toBe(true);
        yellowtail += got.length;
      }
    }
    expect(calico / 360).toBeGreaterThan(1.5);
    expect(yellowtail / 360).toBeGreaterThan(0.5);
    expect(yellowtail).toBeLessThan(calico * 0.75);
    // A species the club never brings in is not fished for.
    expect(rivalFish(call({ fmt: 'species', sp: 'marlin' }), table, derbyRivals(call())[0], 2400)).toEqual([]);
  });

  it('every format has a name and a rule in words', () => {
    for (const f of FORMATS) {
      expect(f.name.length).toBeGreaterThan(3);
      expect(f.say.length).toBeGreaterThan(20);
    }
  });
});
