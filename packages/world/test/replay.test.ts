import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplayWorld, type CourseData } from '../src';

// These run against the real baked course, so they also guard the pipeline's output.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../courses/sf-bay');
const course = JSON.parse(readFileSync(resolve(dir, 'course.json'), 'utf8')) as CourseData;
const bin = (name: string) => readFileSync(resolve(dir, name));
const data = { course, current: new Int8Array(bin('current.bin').buffer.slice(0)), depth: new Uint8Array(bin('depth.bin').buffer.slice(0)) };
const KT = 0.514444;
const mark = (id: string) => course.marks.find((m) => m.id === id)!;
/** Seconds into the season for a local clock time on the first day (the season starts at 08:00 PDT). Past 24 is the next day. */
const clock = (hour: number) => (hour - 8) * 3600;
const kt = (w: { speed: number }) => w.speed / KT;
const fromDeg = (w: { dir: number }) => (w.dir * 180) / Math.PI;

describe('Central Bay replay, 14 and 15 July 2024', () => {
  const world = new ReplayWorld(data, 0);

  it('lines its clock up with the season', () => {
    expect(world.dateAt(0).toISOString()).toBe('2024-07-14T15:00:00.000Z');
    expect(new ReplayWorld(data, 8.5 * 3600).dateAt(1800).toISOString()).toBe('2024-07-15T00:00:00.000Z');
    expect(world.seasonTime(60)).toBe(60);
  });

  it('is light in the morning and builds to a fresh westerly by late afternoon', () => {
    const morning = kt(world.wind(1300, 250, clock(10)));
    const afternoon = kt(world.wind(1300, 250, clock(17)));
    expect(morning).toBeGreaterThan(5);
    expect(morning).toBeLessThan(11);
    expect(afternoon).toBeGreaterThan(14);
    expect(afternoon).toBeLessThan(22);
    expect(afternoon - morning).toBeGreaterThan(5);
  });

  it('eases again after dark', () => {
    expect(kt(world.wind(1300, 250, clock(25)))).toBeLessThan(kt(world.wind(1300, 250, clock(18))) - 4);
  });

  it('blows from the west-south-west and veers as the sea breeze builds', () => {
    for (const hour of [9, 12, 15, 18, 21]) {
      const from = fromDeg(world.wind(1300, 250, clock(hour)));
      expect(from).toBeGreaterThan(215);
      expect(from).toBeLessThan(275);
    }
    expect(fromDeg(world.wind(1300, 250, clock(17)))).toBeGreaterThan(fromDeg(world.wind(1300, 250, clock(8))) + 8);
  });

  it('is not the same wind everywhere: lighter outside the Gate than in the middle of the Bay', () => {
    const t = clock(16);
    expect(kt(world.wind(-9000, -2000, t))).toBeLessThan(kt(world.wind(1300, 250, t)) - 2);
  });

  it('carries the model gust speed, above the mean wind', () => {
    const t = clock(17);
    const mean = world.wind(1300, 250, t).speed;
    const gust = world.gust(1300, 250, t);
    expect(gust / mean).toBeGreaterThan(1.1);
    expect(gust / mean).toBeLessThan(1.6);
  });

  it('puffs about as hard as the model gust and averages out to the hourly wind', () => {
    const t0 = clock(17);
    const base = world.wind(1300, 250, t0).speed;
    const gust = world.gust(1300, 250, t0);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < 900; i++) {
      const g = world.gustyWind(1300, 250, t0 + i).speed;
      sum += g;
      peak = Math.max(peak, g);
    }
    // The hourly wind itself moves a little over fifteen minutes, so allow a few percent.
    expect(sum / 900 / base).toBeGreaterThan(0.93);
    expect(sum / 900 / base).toBeLessThan(1.07);
    expect(peak).toBeGreaterThan(base * 1.1);
    expect(peak).toBeLessThan(gust * 1.15);
  });

  it('floods in through the Gate in the late afternoon and ebbs out after dark', () => {
    const gate = mark('gate');
    const flood = { ...world.current(gate.x, gate.y, clock(17.5)) };
    const ebb = { ...world.current(gate.x, gate.y, clock(24.5)) };
    expect(flood.x).toBeGreaterThan(0.4);
    expect(ebb.x).toBeLessThan(-0.6);
  });

  it('runs harder in the Gate than off the city front', () => {
    const gate = mark('gate');
    const g = world.current(gate.x, gate.y, clock(25));
    const gateSpeed = Math.hypot(g.x, g.y);
    const b = world.current(mark('blossom').x + 1500, mark('blossom').y, clock(25));
    expect(gateSpeed).toBeGreaterThan(Math.hypot(b.x, b.y));
  });

  it('has a tide that rises through the afternoon to high water near sunset', () => {
    expect(world.tide(clock(19))).toBeGreaterThan(world.tide(clock(14)) + 0.5);
    expect(world.tideRate(clock(16))).toBeGreaterThan(0.1);
    expect(world.tideRate(clock(22))).toBeLessThan(-0.1);
  });

  it('knows land from deep water', () => {
    expect(world.chartDepth(mark('alcatraz').x, mark('alcatraz').y)).toBe(0);
    expect(world.chartDepth(mark('angel').x, mark('angel').y)).toBe(0);
    expect(world.chartDepth(mark('gate').x, mark('gate').y)).toBeGreaterThan(60);
    expect(world.chartDepth(mark('harding').x, mark('harding').y)).toBeGreaterThan(8);
    expect(world.depth(mark('alcatraz').x, mark('alcatraz').y, clock(19))).toBe(0);
  });

  it('adds the tide to the charted depth', () => {
    const m = mark('blossom');
    expect(world.depth(m.x, m.y, clock(19)) - world.chartDepth(m.x, m.y)).toBeCloseTo(world.tide(clock(19)), 6);
  });

  it('carries a forecast that differs from what happened', () => {
    const t = clock(13);
    const diff = Math.abs(kt(world.wind(1300, 250, t, 'forecast')) - kt(world.wind(1300, 250, t, 'truth')));
    expect(diff).toBeGreaterThan(1);
    // But it is a forecast of the same day: within a few knots of what happened by late afternoon.
    expect(Math.abs(kt(world.wind(1300, 250, clock(17), 'forecast')) - kt(world.wind(1300, 250, clock(17), 'truth')))).toBeLessThan(6);
  });

  it('is the same every time', () => {
    const a = { ...world.sample(1200, 300, 4321) };
    const b = { ...new ReplayWorld(data, 0).sample(1200, 300, 4321) };
    expect(b).toEqual(a);
  });

  it('can be moved later in the season to agree a clock with another boat', () => {
    const w = new ReplayWorld(data, 3600);
    w.shiftTime(1800);
    expect(w.seasonTime(0)).toBe(5400);
    w.shiftTime(-500);
    expect(w.seasonTime(0)).toBe(5400);
  });
});
