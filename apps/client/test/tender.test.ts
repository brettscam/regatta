/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BAIL_SECONDS, SHOAL_SPEED, burnRate, cruiseThrottle, minutesLeft, newMotor, seaState, settledSpeed, stepMotor, type Motor, type MotorWater } from '../src/aboard/motor';
import type { Paddling } from '../src/aboard/paddle';
import {
  BUMP_SPEED, HARBOUR_LIMIT, HarbourWatch, TENDERS, bumpWord, carries, nextTender, packTender, readTender, speedingPast, tenderById, tenderFor, tendersFor,
  type TenderSpec, type Zone,
} from '../src/aboard/tenders';
import { TenderTrack } from '../src/aboard/tenderTrack';

const KT = 0.514444;
const skiff = tenderById('skiff') as TenderSpec;
const runner = tenderById('runner') as TenderSpec;
const kayak = tenderById('kayak') as TenderSpec;

const sea = (windKt = 0, from = 0, more: Partial<MotorWater> = {}): MotorWater => ({
  current: () => ({ x: 0, y: 0 }), wind: () => ({ dir: from, speed: windKt * KT }), land: () => false, ...more,
});
const cruise: Paddling = { ahead: 1, steer: 0 };
const flat: Paddling = { ahead: 1, steer: 0, sprint: true };
const rest: Paddling = { ahead: 0, steer: 0 };
const run = (c: Motor, spec: TenderSpec, input: Paddling, seconds: number, water: MotorWater = sea()) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) stepMotor(c, spec, input, 1 / 60, water);
};
const fresh = (spec: TenderSpec) => newMotor(0, 0, 0, spec.tankL ?? 0);

describe('the table of tenders', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const boats = resolve(here, '../../../boats');
  const lineup = JSON.parse(readFileSync(resolve(boats, 'lineup.json'), 'utf8')) as { id: string; file?: string; lengthFt?: number }[];
  const feet = (id: string): number => {
    const e = lineup.find((b) => b.id === id)!;
    return e.file ? (JSON.parse(readFileSync(resolve(boats, e.file), 'utf8')) as { lengthFt: number }).lengthFt : e.lengthFt!;
  };

  it('has the three, kayak first, with the speeds asked for', () => {
    expect(TENDERS.map((t) => t.id)).toEqual(['kayak', 'skiff', 'runner']);
    expect(kayak.topKt).toBeLessThan(5);
    expect(skiff.topKt).toBeGreaterThanOrEqual(15);
    expect(skiff.topKt).toBeLessThanOrEqual(20);
    expect(runner.topKt).toBeGreaterThanOrEqual(35);
    expect(runner.topKt).toBeLessThanOrEqual(40);
    // Each powered one draws more than the kayak and comes less far up a beach.
    expect(skiff.draught).toBeGreaterThan(kayak.draught);
    expect(runner.draught).toBeGreaterThan(skiff.draught);
    expect(skiff.haulUp).toBeLessThan(kayak.haulUp);
    expect(runner.haulUp).toBeLessThanOrEqual(skiff.haulUp);
  });

  it('gives every yacht the kayak and the skiff, and the wave runner only to the big ones: the cat, the 45 and the 50', () => {
    expect(boats && readdirSync(boats).length).toBeGreaterThan(1);
    const ids = (id: string) => tendersFor(feet(id)).map((t) => t.id);
    expect(ids('sloop30')).toEqual(['kayak', 'skiff']);
    expect(ids('sloop38')).toEqual(['kayak', 'skiff']);
    expect(ids('perf45')).toEqual(['kayak', 'skiff', 'runner']);
    // The rule is the table's minimum length, so a bigger boat added later carries one without a line of code.
    expect(ids('cat42')).toEqual(['kayak', 'skiff', 'runner']);
    expect(ids('blue50')).toEqual(['kayak', 'skiff', 'runner']);
    expect(carries(29, skiff)).toBe(false);
  });

  it('falls back to the next best when the yacht does not carry what was chosen', () => {
    expect(tenderFor('runner', 45).id).toBe('runner');
    expect(tenderFor('runner', 38).id).toBe('skiff');
    expect(tenderFor('runner', 42).id).toBe('runner');
    expect(tenderFor('runner', 25).id).toBe('kayak');
    expect(tenderFor('nonsense', 45).id).toBe('kayak');
    expect(tenderFor(undefined, 30).id).toBe('kayak');
  });

  it('cycles through what the yacht carries', () => {
    expect(nextTender('kayak', 38).id).toBe('skiff');
    expect(nextTender('skiff', 38).id).toBe('kayak');
    expect(nextTender('skiff', 45).id).toBe('runner');
    expect(nextTender('runner', 45).id).toBe('kayak');
  });
});

describe('the skiff', () => {
  it('ploughs along at half throttle and never gets on the plane', () => {
    const c = fresh(skiff);
    // Hold the engine at half by hand: cruise is more than that.
    for (let t = 0; t < 30; t += 1 / 60) {
      stepMotor(c, skiff, cruise, 1 / 60, sea());
      c.throttle = Math.min(c.throttle, 0.5);
    }
    expect(c.plane).toBe(0);
    expect(c.speed / KT).toBeLessThan(skiff.planeKt!);
    expect(c.speed / KT).toBeGreaterThan(6);
  });

  it('climbs onto the plane at the ordinary throttle, bow high on the hump and down again once she is over it', () => {
    const c = fresh(skiff);
    let hump = 0;
    let at = -1;
    for (let t = 0; t < 30; t += 1 / 60) {
      stepMotor(c, skiff, cruise, 1 / 60, sea());
      hump = Math.max(hump, c.trim);
      if (at < 0 && c.plane >= 1) at = t;
    }
    expect(at).toBeGreaterThan(2);
    expect(at).toBeLessThan(9);
    expect(c.speed / KT).toBeGreaterThan(14);
    expect(c.speed / KT).toBeLessThan(16);
    // A visible change of trim: more than eight degrees on the hump, under six once planing.
    expect(hump).toBeGreaterThan(0.14);
    expect(c.trim).toBeLessThan(0.1);
    expect(c.trim).toBeGreaterThan(0.04);
  });

  it('makes 18 knots flat out on flat water, and that is what the table says', () => {
    const c = fresh(skiff);
    run(c, skiff, flat, 40);
    expect(c.speed / KT).toBeGreaterThan(17.6);
    expect(c.speed / KT).toBeLessThanOrEqual(18.01);
    expect(settledSpeed(skiff, 1) / KT).toBeCloseTo(18, 1);
    expect(settledSpeed(skiff, cruiseThrottle(skiff)) / KT).toBeCloseTo(15, 0);
  });

  it('skids a little in a tight turn, to the outside of it, and banks in', () => {
    const c = fresh(skiff);
    run(c, skiff, flat, 25);
    run(c, skiff, { ahead: 1, steer: 1, sprint: true }, 2);
    // Turning to starboard: sliding to port, between five and twenty degrees of it.
    expect(c.slip).toBeLessThan(0);
    const slide = Math.atan2(-c.slip, c.speed) * (180 / Math.PI);
    expect(slide).toBeGreaterThan(5);
    expect(slide).toBeLessThan(20);
    expect(c.lean).toBeGreaterThan(0.05);
    expect(c.lean).toBeLessThan(0.35);
    // And it costs her speed.
    expect(c.speed / KT).toBeLessThan(17.5);
    // She never throws anybody.
    run(c, skiff, { ahead: 1, steer: 1, sprint: true }, 20);
    expect(c.thrown).toBe(false);
  });

  it('slows hard in a chop, more into it than running before it', () => {
    const calm = fresh(skiff);
    run(calm, skiff, cruise, 40);
    const into = fresh(skiff);
    run(into, skiff, cruise, 40, sea(16, 0));
    const before = fresh(skiff);
    run(before, skiff, cruise, 40, sea(16, Math.PI));
    expect(into.speed).toBeLessThan(calm.speed * 0.8);
    expect(before.speed).toBeLessThan(calm.speed * 0.92);
    expect(before.speed).toBeGreaterThan(into.speed + 0.5);
    expect(seaState(8 * KT)).toBe(0);
    expect(seaState(30 * KT)).toBe(1);
  });

  it('is swamped flat out into a steep sea, lies stopped while she is bailed, and then goes again', () => {
    const c = fresh(skiff);
    const steep = sea(22, 0);
    let t = 0;
    for (; t < 60 && c.swamps === 0; t += 1 / 60) stepMotor(c, skiff, flat, 1 / 60, steep);
    expect(c.swamps).toBe(1);
    expect(t).toBeGreaterThan(6);
    expect(t).toBeLessThan(30);
    run(c, skiff, flat, 6, steep);
    expect(c.swamped).toBeGreaterThan(0);
    expect(c.speed / KT).toBeLessThan(1.5);
    run(c, skiff, rest, BAIL_SECONDS, steep);
    expect(c.swamped).toBe(0);
    run(c, skiff, cruise, 20, steep);
    expect(c.speed / KT).toBeGreaterThan(5);
  });

  it('is not swamped at the ordinary throttle in the same sea, nor flat out running before it, nor flat out in a breeze', () => {
    const a = fresh(skiff);
    run(a, skiff, cruise, 90, sea(22, 0));
    const b = fresh(skiff);
    run(b, skiff, flat, 90, sea(22, Math.PI));
    const c = fresh(skiff);
    run(c, skiff, flat, 90, sea(14, 0));
    expect(a.swamps + b.swamps + c.swamps).toBe(0);
    expect(a.shipped).toBe(0);
  });

  it('goes astern, slowly', () => {
    const c = fresh(skiff);
    run(c, skiff, { ahead: -1, steer: 0 }, 10);
    expect(c.speed).toBeLessThan(-1);
    expect(c.speed / KT).toBeGreaterThan(-8);
    expect(c.y).toBeLessThan(-5);
  });
});

describe('the wave runner', () => {
  it('is up to thirty knots in a few seconds and tops out at thirty-eight', () => {
    const c = fresh(runner);
    run(c, runner, flat, 6);
    expect(c.speed / KT).toBeGreaterThan(30);
    run(c, runner, flat, 30);
    expect(c.speed / KT).toBeGreaterThan(37.3);
    expect(c.speed / KT).toBeLessThanOrEqual(38.01);
    const d = fresh(runner);
    run(d, runner, cruise, 30);
    expect(d.speed / KT).toBeGreaterThan(30.5);
    expect(d.speed / KT).toBeLessThan(33);
  });

  it('sheds speed fast off the throttle, much faster than the skiff does', () => {
    const c = fresh(runner);
    run(c, runner, flat, 30);
    const from = c.speed;
    run(c, runner, rest, 3);
    expect(c.speed).toBeLessThan(from * 0.4);
    const s = fresh(skiff);
    run(s, skiff, flat, 30);
    const sFrom = s.speed;
    run(s, skiff, rest, 3);
    expect(s.speed / sFrom).toBeGreaterThan(c.speed / from + 0.1);
  });

  it('leans right into a turn and hardly skids', () => {
    const c = fresh(runner);
    run(c, runner, cruise, 20);
    run(c, runner, { ahead: 1, steer: -1 }, 1.5);
    expect(c.lean).toBeLessThan(-0.45);
    expect(Math.abs(Math.atan2(c.slip, c.speed)) * (180 / Math.PI)).toBeLessThan(5);
    expect(c.thrown).toBe(false);
  });

  it('steers with her jet: throttle shut, she hardly answers', () => {
    const on = fresh(runner);
    run(on, runner, cruise, 10);
    const off = fresh(runner);
    run(off, runner, cruise, 10);
    run(on, runner, { ahead: 1, steer: 1 }, 1);
    run(off, runner, { ahead: 0, steer: 1 }, 1);
    expect(on.heading).toBeGreaterThan(off.heading * 1.5);
  });

  it('never throws the rider at the ordinary throttle, however long the helm is held over', () => {
    const c = fresh(runner);
    run(c, runner, cruise, 20);
    run(c, runner, { ahead: 1, steer: 1 }, 30);
    expect(c.spills).toBe(0);
  });

  it('throws the rider in a hard turn flat out, shuts down, and idles back round to pick them up', () => {
    const c = fresh(runner);
    run(c, runner, flat, 20);
    const hard: Paddling = { ahead: 1, steer: 1, sprint: true };
    let t = 0;
    for (; t < 10 && !c.thrown; t += 1 / 60) stepMotor(c, runner, hard, 1 / 60, sea());
    expect(c.thrown).toBe(true);
    expect(c.spills).toBe(1);
    expect(t).toBeGreaterThan(0.9);
    expect(t).toBeLessThan(3);
    const rider = { x: c.riderX, y: c.riderY };
    // The keys do nothing now: the kill cord has her.
    run(c, runner, hard, 3);
    expect(c.throttle).toBe(0);
    expect(c.speed / KT).toBeLessThan(12);
    expect(Math.hypot(c.x - rider.x, c.y - rider.y)).toBeGreaterThan(5);
    let back = 3;
    for (; back < 120 && c.thrown; back += 1 / 60) stepMotor(c, runner, hard, 1 / 60, sea());
    expect(c.thrown).toBe(false);
    expect(back).toBeLessThan(90);
    expect(Math.hypot(c.x - rider.x, c.y - rider.y)).toBeLessThan(3.5);
    // A short flick of the helm flat out is allowed.
    const d = fresh(runner);
    run(d, runner, flat, 20);
    run(d, runner, hard, 0.5);
    run(d, runner, flat, 2);
    expect(d.spills).toBe(0);
  });

  it('jumps off the seas when it blows and she is going fast, a little, and not on flat water', () => {
    const calm = fresh(runner);
    run(calm, runner, flat, 40);
    expect(calm.jumps).toBe(0);
    const c = fresh(runner);
    let high = 0;
    const blowing = sea(17, 0);
    for (let t = 0; t < 40; t += 1 / 60) {
      stepMotor(c, runner, flat, 1 / 60, blowing);
      high = Math.max(high, c.hop);
    }
    expect(c.jumps).toBeGreaterThan(4);
    expect(high).toBeGreaterThan(0.1);
    expect(high).toBeLessThan(0.8);
    // Slowly, she stays in the water.
    const slow = fresh(runner);
    for (let t = 0; t < 40; t += 1 / 60) {
      stepMotor(slow, runner, cruise, 1 / 60, blowing);
      slow.speed = Math.min(slow.speed, 12 * KT);
    }
    expect(slow.jumps).toBe(0);
  });

  it('jumps off a wake she crosses at speed', () => {
    const c = fresh(runner);
    run(c, runner, flat, 20);
    const y0 = c.y + 40;
    const water = sea(0, 0, { wake: (_x, y) => (y > y0 && y < y0 + 6 ? 0.8 : 0) });
    let high = 0;
    for (let t = 0; t < 6; t += 1 / 60) {
      stepMotor(c, runner, flat, 1 / 60, water);
      high = Math.max(high, c.hop);
    }
    expect(c.jumps).toBe(1);
    expect(high).toBeGreaterThan(0.2);
    expect(high).toBeLessThan(0.9);
  });
});

describe('both powered tenders', () => {
  it('come off the plane by themselves in shoal water and creep at five knots', () => {
    for (const spec of [skiff, runner]) {
      const c = fresh(spec);
      run(c, spec, flat, 20);
      const edge = c.y + 150;
      const water = sea(0, 0, { shoal: (_x, y) => y > edge });
      run(c, spec, flat, 30, water);
      expect(c.y).toBeGreaterThan(edge);
      expect(c.governed).toBe(true);
      expect(c.speed).toBeLessThan(SHOAL_SPEED * 1.25);
      expect(c.speed).toBeGreaterThan(SHOAL_SPEED * 0.5);
      // She was already slowing before she got there.
      const d = fresh(spec);
      run(d, spec, flat, 20);
      const dEdge = d.y + 150;
      const dWater = sea(0, 0, { shoal: (_x, y) => y > dEdge });
      while (d.y < dEdge) stepMotor(d, spec, flat, 1 / 60, dWater);
      expect(d.speed).toBeLessThan(spec.topKt * KT * 0.8);
    }
  });

  it('stop at the shore, and say so when they hit it fast', () => {
    const c = fresh(skiff);
    run(c, skiff, flat, 20);
    const edge = c.y + 30;
    const water = sea(0, 0, { land: (_x, y) => y > edge });
    run(c, skiff, flat, 10, water);
    expect(c.y).toBeLessThanOrEqual(edge);
    expect(c.beached).toBe(true);
    expect(c.grounds).toBe(1);
    expect(c.speed).toBeLessThan(1);
  });

  it('burn fuel, far more flat out than idling, and are rowed home at two knots when the tank is dry', () => {
    for (const spec of [skiff, runner]) {
      expect(burnRate(spec, 1)).toBeCloseTo(spec.burnLph!, 6);
      expect(burnRate(spec, 0)).toBeLessThan(spec.burnLph! * 0.05);
      // A small tank: between twenty minutes and an hour flat out.
      const flatOut = minutesLeft(spec, spec.tankL!, 1);
      expect(flatOut).toBeGreaterThan(20);
      expect(flatOut).toBeLessThan(60);
      const c = fresh(spec);
      run(c, spec, flat, 60);
      expect(c.fuel).toBeCloseTo(spec.tankL! - spec.burnLph! / 60, 1);
      c.fuel = 0.001;
      run(c, spec, flat, 60);
      expect(c.fuel).toBe(0);
      expect(c.speed / KT).toBeGreaterThan(1);
      expect(c.speed / KT).toBeLessThan(3);
    }
  });

  it('are carried by the stream like anything else afloat', () => {
    const c = fresh(skiff);
    run(c, skiff, rest, 10, sea(0, 0, { current: () => ({ x: 1, y: 0 }) }));
    expect(c.x).toBeCloseTo(10, 1);
  });
});

describe('what the other boats are told', () => {
  it('packs a tender into five short numbers and reads them back', () => {
    const wire = packTender('skiff', 1234.56, -789.01, 1.2345, 8.26, false);
    expect(wire).toEqual([12346, -7890, 1235, 1, 83]);
    expect(JSON.stringify(wire).length).toBeLessThan(30);
    expect(readTender(wire)).toEqual({ kind: 'skiff', x: 1234.6, y: -789, heading: 1.235, speed: 8.3, ashore: false });
    expect(readTender(packTender('runner', 0, 0, 0, 0, true))).toMatchObject({ kind: 'runner', ashore: true });
    expect(readTender(JSON.parse(JSON.stringify(wire)))?.kind).toBe('skiff');
  });

  it('still reads the three numbers the kayak used to send, in whole metres', () => {
    expect(readTender([120, -45, 1571])).toEqual({ kind: 'kayak', x: 120, y: -45, heading: 1.571, speed: 0, ashore: false });
  });

  it('turns away anything that is not a sound report', () => {
    for (const bad of [null, undefined, 'x', 7, {}, [], [1, 2], [1, 2, 'a'], [1, 2, 3, 9, 0], [1, 2, 3, -1, 0], [NaN, 2, 3, 1, 0], [1e9, 2, 3, 1, 0], [1, 2, 3, 1, Infinity], [1, 2, 99999, 1, 0], [1, 2, 3, 1, 0, 0, 0, 0, 0]]) {
      expect(readTender(bad)).toBeNull();
    }
    // A speed nobody could be doing is brought down to what she can do.
    expect(readTender([0, 0, 0, 0, 5000])!.speed).toBeLessThan(3);
    expect(readTender([0, 0, 0, 2, 5000])!.speed).toBeLessThan(23);
  });
});

describe('another boat’s tender between reports', () => {
  it('runs on along her heading from the last report and does not jump when the next one comes', () => {
    const track = new TenderTrack();
    track.hear({ kind: 'skiff', x: 0, y: 0, heading: 0, speed: 8, ashore: false }, 0);
    track.update(0, 1 / 60);
    expect(track.y).toBeCloseTo(0, 6);
    let last = track.y;
    let worst = 0;
    for (let t = 1 / 60; t < 3; t += 1 / 60) {
      // A report every third of a second, each a little late.
      const due = Math.floor(t / 0.33) * 0.33;
      if (due > 0 && t - due < 1 / 60) track.hear({ kind: 'skiff', x: 0, y: 8 * due, heading: 0, speed: 8, ashore: false }, due + 0.05);
      track.update(t, 1 / 60);
      worst = Math.max(worst, Math.abs(track.y - last - 8 / 60));
      last = track.y;
    }
    expect(track.y).toBeGreaterThan(20);
    expect(track.y).toBeLessThan(25);
    // No step is more than a third of a metre off the steady 13 cm a frame.
    expect(worst).toBeLessThan(0.35);
  });

  it('stops running on when the reports stop, and turns the short way', () => {
    const track = new TenderTrack();
    track.hear({ kind: 'runner', x: 0, y: 0, heading: 6.2, speed: 19, ashore: false }, 0);
    track.update(0, 1 / 60);
    for (let t = 0; t < 10; t += 1 / 60) track.update(t, 1 / 60);
    expect(track.y).toBeLessThan(19 * 2.1);
    track.hear({ kind: 'runner', x: 0, y: 0, heading: 0.1, speed: 0, ashore: false }, 10);
    track.update(10.05, 0.05);
    const turned = Math.atan2(Math.sin(track.heading - 6.2), Math.cos(track.heading - 6.2));
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(0.2);
  });
});

describe('the five-knot rule', () => {
  const zones: Zone[] = [{ x: 0, y: 0, radius: 60, what: 'the boats at anchor' }, { x: 500, y: 0, radius: 120, what: 'the dock' }];

  it('only minds speed, and only close to something', () => {
    expect(speedingPast(10, 10, 4 * KT, zones)).toBeNull();
    expect(speedingPast(10, 10, 12 * KT, zones)?.what).toBe('the boats at anchor');
    expect(speedingPast(200, 0, 30 * KT, zones)).toBeNull();
    expect(speedingPast(450, 0, 6 * KT, zones)?.what).toBe('the dock');
    expect(HARBOUR_LIMIT / KT).toBeCloseTo(5, 6);
  });

  it('is a word after a couple of seconds, then silence for a good while, and never more than a word', () => {
    const watch = new HarbourWatch();
    const said: string[] = [];
    for (let t = 0; t < 120; t += 0.1) {
      const line = watch.watch(0.1, zones[0]);
      if (line) said.push(line);
    }
    expect(said.length).toBe(2);
    expect(said[0]).toMatch(/ive knots/);
    expect(said[0]).toContain('the boats at anchor');
    expect(said[1]).not.toBe(said[0]);
    // A second's dash through is let go.
    const brief = new HarbourWatch();
    let line: string | null = null;
    for (let t = 0; t < 1.5; t += 0.1) line = line ?? brief.watch(0.1, zones[0]);
    for (let t = 0; t < 5; t += 0.1) line = line ?? brief.watch(0.1, null);
    expect(line).toBeNull();
  });
});

describe('running into things', () => {
  it('says how hard, and that no harm was done', () => {
    expect(BUMP_SPEED).toBeGreaterThan(1);
    expect(bumpWord(2, 'Windhover')).toMatch(/Bumped Windhover/);
    expect(bumpWord(5, 'Windhover')).toMatch(/thump/);
    expect(bumpWord(19, 'Windhover')).toMatch(/37 knots/);
  });
});
