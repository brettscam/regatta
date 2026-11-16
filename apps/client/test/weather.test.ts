import { describe, expect, it } from 'vitest';
import { SF_FOG_PATH, cloudCover, fogAt, fogReach, morningHaze, pathPoint, rainAt, solarHour, squallsAt, visibility } from '../src/scene/weatherRules';

describe('the weather you can see', () => {
  it('knows the local solar time from the clock and the longitude', () => {
    // 20:00 UTC at 122.45 W is ten to noon by the sun.
    expect(solarHour(Date.parse('2024-07-14T20:00:00Z'), -122.45)).toBeCloseTo(11.84, 2);
    expect(solarHour(Date.parse('2024-07-15T03:00:00Z'), -122.45)).toBeCloseTo(18.84, 2);
  });

  it('keeps the fog outside the Golden Gate at midday and brings it in to the city front by evening', () => {
    const gate = { x: -2512, y: -1145 };
    const alcatraz = { x: 2100, y: -300 };
    const start = { x: 1300, y: 250 };
    const berkeley = { x: 8000, y: 1400 };
    const noon = fogReach(12.5, 14);
    expect(fogAt(SF_FOG_PATH, noon, gate.x, gate.y)).toBe(0);
    expect(fogAt(SF_FOG_PATH, noon, -8000, -1500)).toBeGreaterThan(0.9);
    const evening = fogReach(19.5, 16);
    expect(fogAt(SF_FOG_PATH, evening, gate.x, gate.y)).toBeGreaterThan(0.9);
    const inside = pathPoint(SF_FOG_PATH, 0.45);
    expect(fogAt(SF_FOG_PATH, evening, inside.x, inside.y)).toBeGreaterThan(0.6);
    // From the Alcatraz start the bank stands to the west, close enough to see and not on top of her, all night.
    for (const h of [19.5, 22, 1, 5]) {
      expect(fogAt(SF_FOG_PATH, fogReach(h, 16), start.x, start.y)).toBeLessThan(0.15);
      expect(fogAt(SF_FOG_PATH, fogReach(h, 16), alcatraz.x, alcatraz.y)).toBe(0);
    }
    expect(fogAt(SF_FOG_PATH, evening, berkeley.x, berkeley.y)).toBe(0);
    // It comes in steadily through the afternoon, never jumping.
    let last = fogReach(12, 15);
    for (let h = 12; h <= 20; h += 0.05) {
      const r = fogReach(h, 15);
      expect(r).toBeGreaterThanOrEqual(last - 1e-9);
      expect(r - last).toBeLessThan(0.02);
      last = r;
    }
  });

  it('brings the fog less far in a light breeze', () => {
    expect(fogReach(18, 5)).toBeLessThan(fogReach(18, 18));
    expect(fogReach(12.5, 5)).toBeCloseTo(fogReach(12.5, 18), 1);
  });

  it('keeps the fog in the slot and out of the rest of the bay', () => {
    const reach = fogReach(21, 18);
    // Raccoon Strait, Sausalito and the city front south of the slot stay clear.
    for (const [x, y] of [[-900, 3300], [-2635, 3225], [3300, -3200], [1528, 3436]]) expect(fogAt(SF_FOG_PATH, reach, x, y)).toBe(0);
    const mid = pathPoint(SF_FOG_PATH, reach - 0.2);
    expect(fogAt(SF_FOG_PATH, reach, mid.x, mid.y)).toBeGreaterThan(0.95);
  });

  it('never lets visibility fall below a quarter of a mile', () => {
    expect(visibility(0)).toBe(30000);
    expect(visibility(1)).toBeCloseTo(420, 5);
    expect(visibility(0.5)).toBeGreaterThan(3000);
    expect(visibility(7)).toBeCloseTo(420, 5);
  });

  it('has haze at dawn that is gone by midday', () => {
    expect(morningHaze(7)).toBe(1);
    expect(morningHaze(12)).toBe(0);
    expect(morningHaze(16)).toBe(0);
  });

  it('has more cloud on a hard day', () => {
    expect(cloudCover(14, 1.5)).toBeGreaterThan(cloudCover(14, 1) + 0.2);
    for (let h = 0; h < 24; h += 0.5) {
      expect(cloudCover(h, 1)).toBeGreaterThan(0.1);
      expect(cloudCover(h, 2)).toBeLessThanOrEqual(1);
    }
  });

  it('sends no squalls on an ordinary day and some on a hard one', () => {
    let any = 0;
    for (let s = 0; s < 36 * 3600; s += 600) {
      expect(squallsAt(s, 1, 6, 2, 0, 0).length).toBe(0);
      expect(squallsAt(s, 1.2, 6, 2, 0, 0).length).toBe(0);
      any += squallsAt(s, 1.5, 9, 3, 0, 0).length;
    }
    expect(any).toBeGreaterThan(60);
  });

  it('brings each squall down the wind on a crest of the gust wave, the same for everyone', () => {
    const u = 9.3;
    const v = 2.1;
    const speed = Math.hypot(u, v);
    let seen = 0;
    for (let s = 20000; s < 20000 + 4 * 3600; s += 30) {
      const cells = squallsAt(s, 1.5, u, v, -1300, 1000);
      expect(squallsAt(s, 1.5, u, v, -1300, 1000)).toEqual(cells);
      for (const c of cells) {
        seen++;
        // The world's longest gust wave is at its peak under the middle of the rain.
        const along = (c.x * u + c.y * v) / speed - speed * 0.7 * s;
        const across = (c.x * v - c.y * u) / speed;
        expect(Math.sin(along / 310 + across / 520)).toBeCloseTo(1, 4);
        expect(c.strength).toBeGreaterThanOrEqual(0);
        expect(c.strength).toBeLessThanOrEqual(1);
        expect(rainAt(cells, c.x, c.y)).toBeCloseTo(Math.max(...cells.map((k) => (Math.hypot(k.x - c.x, k.y - c.y) < k.radius * 0.35 ? k.strength : 0))), 5);
        expect(rainAt([c], c.x + c.radius + 1, c.y)).toBe(0);
      }
    }
    expect(seen).toBeGreaterThan(100);
  });

  it('moves a squall to leeward as time passes', () => {
    const u = 10;
    const v = 0;
    // Find a moment with a squall, then look a minute later.
    for (let s = 0; s < 20000; s += 100) {
      const a = squallsAt(s, 1.6, u, v, 0, 0)[0];
      const b = squallsAt(s + 60, 1.6, u, v, 0, 0)[0];
      if (!a || !b || Math.abs(a.y - b.y) > 1) continue;
      expect(b.x - a.x).toBeCloseTo(10 * 0.7 * 60, 3);
      return;
    }
    throw new Error('no squall found');
  });
});
