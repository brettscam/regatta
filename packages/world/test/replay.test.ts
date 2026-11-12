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

describe('Central Bay replay, July 2024', () => {
  const world = new ReplayWorld(data, 0);

  it('lines its clock up with the season', () => {
    expect(world.dateAt(0).toISOString()).toBe('2024-07-14T21:00:00.000Z');
    expect(new ReplayWorld(data, 2.5 * 3600).dateAt(1800).toISOString()).toBe('2024-07-15T00:00:00.000Z');
  });

  it('has the afternoon westerly', () => {
    const w = world.wind(0, 0, 2 * 3600);
    expect(w.speed / KT).toBeGreaterThan(11);
    expect(w.speed / KT).toBeLessThan(20);
    const fromDeg = (w.dir * 180) / Math.PI;
    expect(fromDeg).toBeGreaterThan(215);
    expect(fromDeg).toBeLessThan(275);
  });

  it('gusts stay within a quarter of the hourly wind and average out to it', () => {
    const base = world.wind(0, 0, 3600).speed;
    let sum = 0;
    for (let i = 0; i < 600; i++) {
      const g = world.gustyWind(0, 0, 3600 + i).speed;
      expect(Math.abs(g / base - 1)).toBeLessThan(0.25);
      sum += g;
    }
    // The hourly wind itself moves a little over ten minutes, so allow a few percent.
    expect(sum / 600 / base).toBeGreaterThan(0.95);
    expect(sum / 600 / base).toBeLessThan(1.05);
  });

  it('floods in through the Gate in the late afternoon and ebbs out after dark', () => {
    const gate = mark('gate');
    const flood = { ...world.current(gate.x, gate.y, 3.5 * 3600) };
    const ebb = { ...world.current(gate.x, gate.y, 10.5 * 3600) };
    expect(flood.x).toBeGreaterThan(0.4);
    expect(ebb.x).toBeLessThan(-0.6);
  });

  it('runs harder in the Gate than off the city front', () => {
    const gate = mark('gate');
    const g = world.current(gate.x, gate.y, 11 * 3600);
    const gateSpeed = Math.hypot(g.x, g.y);
    const b = world.current(mark('blossom').x + 1500, mark('blossom').y, 11 * 3600);
    expect(gateSpeed).toBeGreaterThan(Math.hypot(b.x, b.y));
  });

  it('has a tide that rises through the afternoon to high water near sunset', () => {
    expect(world.tide(5 * 3600)).toBeGreaterThan(world.tide(0) + 0.5);
    expect(world.tideRate(2 * 3600)).toBeGreaterThan(0.1);
    expect(world.tideRate(8 * 3600)).toBeLessThan(-0.1);
  });

  it('knows land from deep water', () => {
    expect(world.chartDepth(mark('alcatraz').x, mark('alcatraz').y)).toBe(0);
    expect(world.chartDepth(mark('angel').x, mark('angel').y)).toBe(0);
    expect(world.chartDepth(mark('gate').x, mark('gate').y)).toBeGreaterThan(60);
    expect(world.chartDepth(mark('harding').x, mark('harding').y)).toBeGreaterThan(8);
    expect(world.depth(mark('alcatraz').x, mark('alcatraz').y, 5 * 3600)).toBe(0);
  });

  it('adds the tide to the charted depth', () => {
    const m = mark('blossom');
    expect(world.depth(m.x, m.y, 5 * 3600) - world.chartDepth(m.x, m.y)).toBeCloseTo(world.tide(5 * 3600), 6);
  });

  it('carries a forecast that differs from what happened', () => {
    const t = 9 * 3600;
    const diff = Math.abs(world.wind(0, 0, t, 'forecast').speed - world.wind(0, 0, t, 'truth').speed);
    expect(diff / KT).toBeGreaterThan(0.5);
    // But the first hours are the same run.
    expect(world.wind(0, 0, 3600, 'forecast').speed).toBeCloseTo(world.wind(0, 0, 3600, 'truth').speed, 6);
  });

  it('is the same every time', () => {
    const a = { ...world.sample(1200, 300, 4321) };
    const b = { ...new ReplayWorld(data, 0).sample(1200, 300, 4321) };
    expect(b).toEqual(a);
  });
});
