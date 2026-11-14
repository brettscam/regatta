import { describe, expect, it } from 'vitest';
import { ALONE, FASTEST, SILENT, SLOWEST, pressing, reportGap } from '../src/net/web/pacing';

/** Messages a second a water of n boats costs when each reports every `gap` milliseconds: one sent, n - 1 delivered. */
const cost = (n: number, gap: number) => (n * n * 1000) / gap;

describe('how often a boat reports on the website', () => {
  it('only says she is here now and then while nobody else is heard', () => {
    expect(reportGap(1, 0, 40)).toBe(ALONE);
    // A hidden tab is connected but silent: no reason to report fast to it.
    expect(reportGap(3, 0, 40)).toBe(ALONE);
  });

  it('reports four times a second with one or two others', () => {
    expect(reportGap(2, 1, 40)).toBe(FASTEST);
    expect(reportGap(3, 2, 40)).toBe(FASTEST);
  });

  it('keeps the whole water inside its budget up to eight boats', () => {
    for (let n = 2; n <= 8; n++) expect(cost(n, reportGap(n, n - 1, 40))).toBeLessThanOrEqual(40);
    expect(reportGap(8, 7, 40)).toBe(1600);
  });

  it('never reports so seldom that a boat would be dropped or stop being run on', () => {
    expect(reportGap(30, 29, 40)).toBe(SLOWEST);
    expect(SLOWEST).toBeLessThan(2500);
    expect(SILENT).toBeGreaterThan(2 * ALONE);
  });

  it('counts connected pages that are not reporting', () => {
    expect(reportGap(6, 1, 40)).toBe(reportGap(6, 5, 40));
  });
});

describe('what goes out at once', () => {
  const moving = { x: 1, y: 2, h: 100, st: '', rc: null, rj: '' };
  it('does not hurry for motion', () => {
    expect(pressing(moving, { ...moving, x: 3, h: 120 })).toBe(false);
  });
  it('hurries for a hail, a status, a race called or joined', () => {
    expect(pressing(moving, { ...moving, msg: 'ahoy', mt: 5 })).toBe(true);
    expect(pressing(moving, { ...moving, st: 'at anchor' })).toBe(true);
    expect(pressing(moving, { ...moving, rc: { id: 'a' } })).toBe(true);
    expect(pressing({ ...moving, rc: { id: 'a' } }, moving)).toBe(true);
    expect(pressing(moving, { ...moving, rj: 'a' })).toBe(true);
  });
  it('does not hurry for a race call that has not changed', () => {
    const call = { id: 'a' };
    expect(pressing({ ...moving, rc: call }, { ...moving, rc: call, x: 9 })).toBe(false);
  });
});
