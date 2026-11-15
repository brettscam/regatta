import { describe, expect, it } from 'vitest';
import { D2R, KT, type SimOutputs, type SimState } from '@slack-tide/sim';
import { settle } from '../../../packages/sim/test/helpers';
import {
  AGROUND_COOLDOWN, BERTH_COOLDOWN, GUST, POINTS, RANKS, Seamanship, TACK, cleanLedger, counted, courseMiles, credit, hands, inGroove, raceAwards, rankOf, topEarners,
  type Award, type Ledger,
} from '../src/xp/score';

type Boat = { s: SimState; o: SimOutputs };
const sail = () => ({ eff: 1, luff: 0, stall: 0, flogging: false, backed: 0, loadKg: 100, errDeg: 0 });

/** A boat sailing well on starboard tack, close-hauled in 12 knots, the player with wheel and sheets. */
function boat(): Boat {
  const s = { speed: 3, heel: -0.2, furl: 1, hold: 'none', maneuver: null, helmMode: 'hand', crewTrim: false, crashGybes: 0, knockdowns: 0, mainSide: -1 } as unknown as SimState;
  const o = { twa: 45 * D2R, tws: 6, polarSpeed: 3, targetSpeed: 3, main: sail(), jib: sail(), inIrons: false, aground: false, knockedDown: false, roundingUp: false } as unknown as SimOutputs;
  return { s, o };
}

function run(k: Seamanship, b: Boat, seconds: number, weight = 1): Award[] {
  const got: Award[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) got.push(...k.step(b.s, b.o, weight));
  return got;
}
const of = (awards: Award[], ...kinds: string[]) => awards.filter((a) => kinds.includes(a.kind));
const sum = (awards: Award[]) => awards.reduce((n, a) => n + a.points, 0);

/** Put her through the wind: `through` seconds slow and head to wind, then away on the new tack at `after` m/s. */
function tack(k: Seamanship, b: Boat, through: number, after = 2.6, during: () => void = () => {}): Award[] {
  const side = b.o.twa >= 0 ? -1 : 1;
  b.o.twa = side * 10 * D2R;
  b.s.speed = 2;
  b.o.jib.luff = 1;
  during();
  const got = run(k, b, through);
  b.o.twa = side * 45 * D2R;
  b.s.speed = after;
  b.o.jib.luff = 0;
  b.o.jib.backed = 0;
  b.o.inIrons = false;
  b.s.maneuver = null;
  b.s.mainSide = -side;
  got.push(...run(k, b, 5));
  b.s.speed = 3;
  return of(got, 'tack');
}

describe('a clean tack', () => {
  it('earns most when it is fast and all by hand', () => {
    const k = new Seamanship();
    const b = boat();
    run(k, b, 30);
    const got = tack(k, b, 8);
    expect(got).toEqual([{ kind: 'tack', points: POINTS.tack[3] + POINTS.tackFast, label: 'Fast, clean tack' }]);
    expect(got[0].points).toBe(25);
  });

  it('earns less the longer she takes to get going again', () => {
    for (const [through, points] of [[18, 20], [30, 15]] as const) {
      const k = new Seamanship();
      const b = boat();
      run(k, b, 30);
      expect(tack(k, b, through)).toEqual([{ kind: 'tack', points, label: 'Clean tack' }]);
    }
  });

  it('earns nothing until she is back up to most of her speed', () => {
    const k = new Seamanship();
    const b = boat();
    run(k, b, 30);
    expect(tack(k, b, 8, 2.0)).toEqual([]);
  });

  it('is worth less with the crew trimming, less again on T, least on the pilot', () => {
    const points = (set: (b: Boat) => void, during: (b: Boat) => void = () => {}) => {
      const k = new Seamanship();
      const b = boat();
      set(b);
      run(k, b, 30);
      return tack(k, b, 8, 2.6, () => during(b))[0];
    };
    expect(points((b) => { b.s.crewTrim = true; })).toEqual({ kind: 'tack', points: 15, label: 'Clean tack' });
    const crew = points(() => {}, (b) => { b.s.maneuver = { kind: 'tack', prevMode: 'hand' } as SimState['maneuver']; });
    expect(crew).toEqual({ kind: 'tack', points: 5, label: 'Tack, crew on the sheets' });
    const pilot = points((b) => { b.s.helmMode = 'route'; b.s.crewTrim = true; }, (b) => { b.s.maneuver = { kind: 'tack', prevMode: 'route' } as SimState['maneuver']; });
    expect(pilot).toEqual({ kind: 'tack', points: 3, label: 'Tack on the pilot' });
    expect(points((b) => { b.s.helmMode = 'route'; b.s.crewTrim = true; })).toEqual({ kind: 'tack', points: 3, label: 'Tack on the pilot' });
  });

  it('does not count if she sticks in irons, or the jib is left aback, or it takes too long', () => {
    const fresh = () => { const k = new Seamanship(); const b = boat(); run(k, b, 30); return { k, b }; };
    let x = fresh();
    expect(tack(x.k, x.b, TACK.irons + 1, 2.6, () => { x.b.o.inIrons = true; })).toEqual([]);
    x = fresh();
    expect(tack(x.k, x.b, TACK.aback + 1, 2.6, () => { x.b.o.jib.backed = 0.9; })).toEqual([]);
    x = fresh();
    expect(tack(x.k, x.b, TACK.limit + 1)).toEqual([]);
  });

  it('cannot be farmed: one every 90 seconds, and not by wiggling through the wind', () => {
    const k = new Seamanship();
    const b = boat();
    run(k, b, 30);
    expect(tack(k, b, 8)).toHaveLength(1);
    run(k, b, 30);
    expect(tack(k, b, 8)).toEqual([]);
    run(k, b, TACK.cooldown);
    expect(tack(k, b, 8)).toHaveLength(1);
    // Straight back again after ten seconds on the new tack.
    const w = new Seamanship();
    const c = boat();
    run(w, c, 10);
    expect(tack(w, c, 8)).toEqual([]);
  });
});

describe('a clean gybe', () => {
  function gybe(b: Boat, k: Seamanship, crash = 0, knock = 0): Award[] {
    const side = b.o.twa >= 0 ? -1 : 1;
    b.o.twa = side * 170 * D2R;
    b.s.mainSide = -side;
    b.s.crashGybes += crash;
    b.s.knockdowns += knock;
    const got = run(k, b, 3);
    b.o.twa = side * 150 * D2R;
    got.push(...run(k, b, 6));
    return of(got, 'gybe', 'lost');
  }
  const running = () => { const b = boat(); b.o.twa = 150 * D2R; return b; };

  it('earns when the boom comes across under control', () => {
    const k = new Seamanship();
    const b = running();
    run(k, b, 30);
    expect(gybe(b, k)).toEqual([{ kind: 'gybe', points: 10, label: 'Clean gybe' }]);
    // Not again for a minute and a half.
    run(k, b, 30);
    expect(gybe(b, k)).toEqual([]);
  });

  it('earns less with the crew or the pilot', () => {
    const k = new Seamanship();
    const b = running();
    b.s.crewTrim = true;
    run(k, b, 30);
    expect(gybe(b, k)[0].points).toBe(7);
    const p = new Seamanship();
    const c = running();
    c.s.crewTrim = true;
    c.s.helmMode = 'wind';
    run(p, c, 30);
    expect(gybe(c, p)[0]).toEqual({ kind: 'gybe', points: 2, label: 'Gybe on the pilot' });
  });

  it('a crash gybe costs a little and earns nothing', () => {
    const k = new Seamanship();
    const b = running();
    run(k, b, 30);
    expect(gybe(b, k, 1)).toEqual([{ kind: 'lost', points: POINTS.crashGybe, label: 'Crash gybe' }]);
  });

  it('a knockdown costs more, once, not on top of the crash gybe that caused it', () => {
    const k = new Seamanship();
    const b = running();
    run(k, b, 30);
    expect(gybe(b, k, 1, 1)).toEqual([{ kind: 'lost', points: -15, label: 'Knockdown' }]);
  });

  it('does not charge for knockdowns a resumed boat already had', () => {
    const k = new Seamanship();
    const b = boat();
    b.s.knockdowns = 3;
    b.s.crashGybes = 5;
    expect(of(run(k, b, 5), 'lost')).toEqual([]);
  });
});

describe('in the groove', () => {
  const groove = (set: (b: Boat) => void, seconds = 61, weight = 1) => {
    const k = new Seamanship();
    const b = boat();
    set(b);
    return of(run(k, b, seconds, weight), 'groove', 'hand');
  };

  it('pays each half minute, more to windward, and most by hand', () => {
    expect(groove(() => {})).toEqual([
      { kind: 'hand', points: 9, label: 'In the groove, by hand', quiet: true },
      { kind: 'hand', points: 9, label: 'In the groove, by hand', quiet: true },
    ]);
    expect(sum(groove((b) => { b.o.twa = 95 * D2R; }))).toBe(12);
  });

  it('pays less with one of wheel and sheets in hand, and least on the pilot with the crew', () => {
    expect(groove((b) => { b.s.crewTrim = true; }).map((a) => [a.kind, a.points])).toEqual([['groove', 5], ['groove', 5]]);
    expect(sum(groove((b) => { b.s.helmMode = 'wind'; b.o.twa = 95 * D2R; }))).toBe(6);
    expect(groove((b) => { b.s.helmMode = 'route'; b.s.crewTrim = true; }).map((a) => a.points)).toEqual([2, 2]);
    expect(sum(groove((b) => { b.s.helmMode = 'route'; b.s.crewTrim = true; b.o.twa = -120 * D2R; }))).toBe(2);
    expect(hands(boat().s)).toBe(2);
  });

  it('needs the sails in trim and nine tenths of her polar speed', () => {
    expect(groove((b) => { b.o.jib.luff = 0.5; })).toEqual([]);
    expect(groove((b) => { b.o.main.stall = 0.4; })).toEqual([]);
    expect(groove((b) => { b.o.main.flogging = true; })).toEqual([]);
    expect(groove((b) => { b.o.jib.backed = 0.3; })).toEqual([]);
    expect(groove((b) => { b.s.speed = 2.6; })).toEqual([]);
    expect(groove((b) => { b.s.speed = 2.71; })).toHaveLength(2);
    // A rolled-up jib is not held against her.
    expect(groove((b) => { b.s.furl = 0; b.o.jib.luff = 1; })).toHaveLength(2);
  });

  it('counts a boat making all her sail plan can give where the polar cannot be had', () => {
    const deep = (b: Boat, speed: number) => { b.o.twa = 165 * D2R; b.s.speed = speed; b.o.targetSpeed = speed; };
    const b = boat();
    deep(b, 2.4);
    expect(inGroove(b.s, b.o)).toBe(true);
    expect(groove((c) => deep(c, 2.4))).toHaveLength(2);
    expect(groove((c) => deep(c, 2.0))).toEqual([]);
  });

  it('pays nothing at anchor, aground, in a calm or pinching head to wind', () => {
    expect(groove((b) => { b.s.hold = 'anchor'; })).toEqual([]);
    expect(groove((b) => { b.o.aground = true; })).toEqual([]);
    expect(groove((b) => { b.o.polarSpeed = 0.8; b.s.speed = 0.8; })).toEqual([]);
    expect(groove((b) => { b.o.twa = 25 * D2R; })).toEqual([]);
  });

  it('forgives a moment out of it but not a long one', () => {
    const held = (out: number) => {
      const k = new Seamanship();
      const b = boat();
      const got = run(k, b, 20);
      b.o.main.luff = 1;
      got.push(...run(k, b, out));
      b.o.main.luff = 0;
      got.push(...run(k, b, 12));
      return of(got, 'hand').length;
    };
    expect(held(2)).toBe(1);
    expect(held(5)).toBe(0);
  });

  it('pays by the player\'s own minutes when time is run fast', () => {
    expect(groove(() => {}, 110, 0.25)).toEqual([]);
    expect(groove(() => {}, 121, 0.25)).toHaveLength(1);
  });
});

describe('a gust handled', () => {
  function gust(set: (b: Boat) => void = () => {}, during: (b: Boat) => void = () => {}) {
    const k = new Seamanship();
    const b = boat();
    set(b);
    const got = run(k, b, 60);
    const blow = () => {
      b.o.tws = 9;
      b.s.heel = -22 * D2R;
      got.push(...run(k, b, 1));
      during(b);
      got.push(...run(k, b, 14));
      b.o.tws = 6;
      b.s.heel = -0.2;
      b.o.roundingUp = false;
      got.push(...run(k, b, 5));
      b.s.speed = 3;
    };
    blow();
    return { got: of(got, 'gust'), again: () => { got.length = 0; blow(); return of(got, 'gust'); }, k, b };
  }

  it('earns when she is kept on her feet', () => {
    expect(gust().got).toEqual([{ kind: 'gust', points: 12, label: 'Gust handled' }]);
  });

  it('earns a little on the pilot with the crew trimming', () => {
    expect(gust((b) => { b.s.helmMode = 'wind'; b.s.crewTrim = true; }).got).toEqual([{ kind: 'gust', points: 3, label: 'Gust handled' }]);
  });

  it('earns nothing if she is laid over, rounds up or is stopped', () => {
    expect(gust(() => {}, (b) => { b.s.heel = -(GUST.heel + 4) * D2R; }).got).toEqual([]);
    expect(gust(() => {}, (b) => { b.o.roundingUp = true; }).got).toEqual([]);
    expect(gust(() => {}, (b) => { b.s.speed = 1.2; }).got).toEqual([]);
  });

  it('is not a gust in light air or for a small puff', () => {
    const k = new Seamanship();
    const b = boat();
    b.o.tws = 3;
    const got = run(k, b, 60);
    b.o.tws = 5;
    got.push(...run(k, b, 15));
    b.o.tws = 3;
    got.push(...run(k, b, 5));
    expect(of(got, 'gust')).toEqual([]);
    const c = boat();
    const j = new Seamanship();
    const more = run(j, c, 200);
    c.o.tws = 7;
    more.push(...run(j, c, 15));
    c.o.tws = 6;
    more.push(...run(j, c, 5));
    expect(of(more, 'gust')).toEqual([]);
  });

  it('has a cooldown', () => {
    const g = gust();
    expect(g.got).toHaveLength(1);
    expect(g.again()).toEqual([]);
    run(g.k, g.b, GUST.cooldown);
    expect(g.again()).toHaveLength(1);
  });
});

describe('aground, and brought up', () => {
  it('running aground costs a little, once', () => {
    const k = new Seamanship();
    const b = boat();
    run(k, b, 5);
    b.o.aground = true;
    expect(of(run(k, b, 2), 'lost')).toEqual([{ kind: 'lost', points: -10, label: 'Aground' }]);
    b.o.aground = false;
    run(k, b, 10);
    b.o.aground = true;
    expect(of(run(k, b, 2), 'lost')).toEqual([]);
    b.o.aground = false;
    run(k, b, AGROUND_COOLDOWN);
    b.o.aground = true;
    expect(of(run(k, b, 2), 'lost')).toHaveLength(1);
  });

  it('anchoring or picking up a mooring earns a little, not over and over', () => {
    const k = new Seamanship();
    const b = boat();
    run(k, b, 5);
    b.s.hold = 'anchor';
    expect(run(k, b, 2)).toEqual([{ kind: 'berth', points: 8, label: 'Anchored' }]);
    b.s.hold = 'none';
    run(k, b, 60);
    b.s.hold = 'mooring';
    expect(run(k, b, 2)).toEqual([]);
    b.s.hold = 'none';
    run(k, b, BERTH_COOLDOWN);
    b.s.hold = 'mooring';
    expect(of(run(k, b, 2), 'berth')).toEqual([{ kind: 'berth', points: 8, label: 'Made fast' }]);
  });

  it('a boat that starts the sail at anchor is not paid for it', () => {
    const k = new Seamanship();
    const b = boat();
    b.s.hold = 'anchor';
    expect(run(k, b, 5)).toEqual([]);
  });
});

describe('what the logbook counts', () => {
  it('pays for marks, the catch, nights, landings and sightings', () => {
    expect(counted('marks', 1, Infinity)).toEqual({ kind: 'mark', points: 10, label: 'Mark rounded' });
    expect(counted('fish', 1, Infinity)?.points).toBe(6);
    expect(counted('crabs', 2, Infinity)?.points).toBe(8);
    expect(counted('crabs', 7, Infinity)?.points).toBe(12);
    expect(counted('nights', 1, Infinity)?.points).toBe(20);
    expect(counted('ashore', 1, 0)?.points).toBe(25);
    expect(counted('seen', 1, 0)?.points).toBe(15);
  });

  it('has cooldowns, and pays nothing for counters that are not seamanship', () => {
    expect(counted('marks', 1, 59)).toBeNull();
    expect(counted('marks', 3, 60)?.points).toBe(10);
    expect(counted('nights', 1, 600)).toBeNull();
    for (const what of ['tacks', 'knockdowns', 'races', 'wins']) expect(counted(what, 1, Infinity)).toBeNull();
    expect(counted('fish', 0, Infinity)).toBeNull();
  });
});

describe('a race', () => {
  const r = { place: 1, people: 0, peopleBeaten: 0, pacers: 0, pacersBeaten: 0, miles: 8, seconds: 4000 };

  it('pays for finishing by the length of the course', () => {
    expect(raceAwards(r)).toEqual([{ kind: 'finish', points: 60, label: 'Race finished' }]);
    expect(raceAwards({ ...r, miles: 2 })[0].points).toBe(24);
    expect(raceAwards({ ...r, miles: 0.2 })[0].points).toBe(10);
    expect(raceAwards({ ...r, seconds: 90 })).toEqual([]);
  });

  it('a win against pace boats is a bunch, and against people a bigger one', () => {
    expect(raceAwards({ ...r, pacers: 3, pacersBeaten: 3 })[1]).toEqual({ kind: 'place', points: 100, label: 'Race won against 3 boats' });
    expect(raceAwards({ ...r, people: 3, peopleBeaten: 3 })[1].points).toBe(280);
    expect(raceAwards({ ...r, people: 1, peopleBeaten: 1 })[1]).toEqual({ kind: 'place', points: 160, label: 'Race won against 1 boat' });
    expect(raceAwards({ ...r, people: 9, peopleBeaten: 9 })[1].points).toBe(500);
  });

  it('pays by boats beaten further down, and nothing for last', () => {
    expect(raceAwards({ ...r, place: 2, people: 1, peopleBeaten: 0, pacers: 2, pacersBeaten: 2 })[1]).toEqual({ kind: 'place', points: 40, label: '2nd of 4' });
    expect(raceAwards({ ...r, place: 4, pacers: 3, pacersBeaten: 0 })).toHaveLength(1);
  });

  it('a short course pays in proportion', () => {
    expect(raceAwards({ ...r, miles: 1.5, pacers: 3, pacersBeaten: 3 })[1].points).toBe(50);
    expect(raceAwards({ ...r, miles: 0.2, pacers: 3, pacersBeaten: 3 })[1].points).toBe(25);
    expect(courseMiles([{ x: 0, y: 0 }, { x: 1852, y: 0 }, { x: 1852, y: 926 }])).toBeCloseTo(1.5);
  });
});

describe('ranks', () => {
  it('start at Deckhand and rise at each threshold', () => {
    expect(rankOf(0).name).toBe('Deckhand');
    expect(rankOf(49).name).toBe('Deckhand');
    expect(rankOf(50).name).toBe('Able Seaman');
    expect(rankOf(200).name).toBe('Bosun');
    expect(rankOf(1500).name).toBe('Skipper');
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].at).toBeGreaterThan(RANKS[i - 1].at);
      expect(rankOf(RANKS[i].at).index).toBe(i);
      expect(rankOf(RANKS[i].at - 1).index).toBe(i - 1);
    }
  });

  it('say how far it is to the next', () => {
    const r = rankOf(125);
    expect(r.next).toEqual({ name: 'Bosun', at: 200 });
    expect(r.progress).toBeCloseTo(0.5);
    const top = rankOf(1e9);
    expect(top.name).toBe(RANKS[RANKS.length - 1].name);
    expect(top.next).toBeNull();
    expect(top.progress).toBe(1);
    expect(rankOf(NaN).index).toBe(0);
    expect(rankOf(-5).index).toBe(0);
  });
});

describe('the ledger in the logbook', () => {
  it('loads as zero from a book saved before there were points', () => {
    expect(cleanLedger(undefined)).toEqual({ xp: 0, xpBy: {} });
    expect(cleanLedger({ miles: 12.5, tacks: 40 } as never)).toEqual({ xp: 0, xpBy: {} });
    expect(cleanLedger({ xp: 'lots', xpBy: [1, 2] })).toEqual({ xp: 0, xpBy: {} });
    expect(cleanLedger({ xp: -4, xpBy: { tack: 30, nonsense: 9, gybe: -2, hand: Infinity } })).toEqual({ xp: 0, xpBy: { tack: 30 } });
    expect(cleanLedger({ xp: 120.4, xpBy: { hand: 90 } })).toEqual({ xp: 120, xpBy: { hand: 90 } });
  });

  it('never goes below zero, and remembers what was lost', () => {
    const l: Ledger = { xp: 6, xpBy: { tack: 6 } };
    credit(l, { kind: 'lost', points: -10, label: 'Aground' });
    expect(l).toEqual({ xp: 0, xpBy: { tack: 6, lost: 6 } });
    credit(l, { kind: 'lost', points: -15, label: 'Knockdown' });
    expect(l.xp).toBe(0);
    expect(l.xpBy.lost).toBe(6);
  });

  it('says when an award gains a rank', () => {
    const l: Ledger = { xp: 40, xpBy: {} };
    expect(credit(l, { kind: 'gybe', points: 9, label: 'Clean gybe' })).toBeNull();
    expect(credit(l, { kind: 'tack', points: 15, label: 'Clean tack' })?.name).toBe('Able Seaman');
    expect(l).toEqual({ xp: 64, xpBy: { gybe: 9, tack: 15 } });
  });

  it('lists what has earned the most, without the penalties', () => {
    const l: Ledger = { xp: 100, xpBy: { tack: 30, hand: 90, lost: 25, mark: 10 } };
    expect(topEarners(l, 2)).toEqual([{ kind: 'hand', name: 'In the groove, by hand', points: 90 }, { kind: 'tack', name: 'Clean tacks', points: 30 }]);
  });
});

describe('on the real boat', () => {
  it('a tack on T with the crew earns the crew\'s award', () => {
    const sim = settle(12, 45, { seconds: 120 }).sim;
    const k = new Seamanship();
    const got: Award[] = [];
    const go = (seconds: number) => { for (let i = 0; i < seconds * 60; i++) { sim.step(); got.push(...k.step(sim.state, sim.out)); } };
    go(25);
    sim.tack();
    go(40);
    expect(of(got, 'tack')).toEqual([{ kind: 'tack', points: 5, label: 'Tack, crew on the sheets' }]);
    expect(of(got, 'lost')).toEqual([]);
  });

  it('a tack by hand, wheel over and sheets changed, earns the full award', () => {
    const sim = settle(12, 45, { seconds: 120 }).sim;
    sim.setCrewTrim(false);
    sim.setHelm('hand');
    const k = new Seamanship();
    const got: Award[] = [];
    const max = sim.controlRange('rudder').max;
    let target = 45 * D2R;
    const go = (seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) {
        sim.setControl('rudder', Math.max(-max, Math.min(max, 2.5 * (sim.out.twa - target))));
        sim.step();
        got.push(...k.step(sim.state, sim.out));
      }
    };
    go(25);
    target = -45 * D2R;
    go(4);
    // Through the wind: let the old sheet fly and bring the new one in to where the old one was.
    const old = sim.getControl('jibsheet_port');
    sim.setControl('jibsheet_port', sim.controlRange('jibsheet_port').max);
    sim.setControl('jibsheet_stbd', old);
    go(40);
    const t = of(got, 'tack');
    expect(t).toHaveLength(1);
    expect(t[0].points).toBeGreaterThanOrEqual(15);
    expect(t[0].label).toMatch(/lean tack/);
    expect(sim.state.speed).toBeGreaterThan(4 * KT);
  });

  it('five minutes close-hauled on the pilot with the crew pays the pilot\'s rate', () => {
    const sim = settle(12, 45, { seconds: 120 }).sim;
    const k = new Seamanship();
    const got: Award[] = [];
    for (let i = 0; i < 301 * 60; i++) { sim.step(); got.push(...k.step(sim.state, sim.out)); }
    expect(got.every((a) => a.kind === 'groove' && a.quiet)).toBe(true);
    expect(sum(got)).toBe(20);
  });
});
