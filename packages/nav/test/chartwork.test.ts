import { describe, expect, it } from 'vitest';
import { advanceReckoning, beaufort, compassPoint, compassWords, degMin, mercator, rhumb } from '../src';

const NM = 1852;
const D2R = Math.PI / 180;

describe('the Mercator chart', () => {
  const p = mercator(-57.8, -46);

  it('puts its centre at the origin and comes back to the same latitude and longitude', () => {
    expect(p.toXY(-57.8, -46).x).toBeCloseTo(0, 6);
    expect(p.toXY(-57.8, -46).y).toBeCloseTo(0, 6);
    for (const [lat, lon] of [[-61.1, -54.9], [-54.2, -37.2], [-52.5, -33], [-63, -59]]) {
      const { x, y } = p.toXY(lat, lon);
      const back = p.toLatLon(x, y);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  it('has north up and east to the right', () => {
    expect(p.toXY(-54, -46).y).toBeGreaterThan(0);
    expect(p.toXY(-57.8, -40).x).toBeGreaterThan(0);
  });

  it('is true to scale at its middle latitude and stretched toward the pole', () => {
    expect(p.scaleAt(0)).toBeCloseTo(1, 9);
    const south = p.scaleAt(p.toXY(-61.1, -54.9).y);
    const north = p.scaleAt(p.toXY(-54.2, -37.2).y);
    expect(south).toBeCloseTo(Math.cos(57.8 * D2R) / Math.cos(61.1 * D2R), 6);
    expect(south).toBeGreaterThan(1.09);
    expect(south).toBeLessThan(1.12);
    expect(north).toBeGreaterThan(0.9);
    expect(north).toBeLessThan(0.93);
  });

  it('measures a degree of latitude as sixty miles wherever it is', () => {
    for (const lat of [-62, -58, -54]) {
      const leg = rhumb(p, p.toXY(lat, -46), p.toXY(lat + 1, -46));
      expect(leg.metres / NM).toBeCloseTo(60, 3);
      expect(leg.course).toBeCloseTo(0, 6);
    }
  });

  it('measures along a parallel by the cosine of the latitude', () => {
    const leg = rhumb(p, p.toXY(-60, -50), p.toXY(-60, -49));
    expect(leg.metres / NM).toBeCloseTo(60 * Math.cos(60 * D2R), 1);
    expect(leg.course).toBeCloseTo(Math.PI / 2, 6);
  });

  it('makes Elephant Island to South Georgia about 700 miles on a course a little east of north-east', () => {
    const leg = rhumb(p, p.toXY(-61.1, -54.65), p.toXY(-54.17, -37.4));
    expect(leg.metres / NM).toBeGreaterThan(660);
    expect(leg.metres / NM).toBeLessThan(740);
    expect(leg.course / D2R).toBeGreaterThan(45);
    expect(leg.course / D2R).toBeLessThan(60);
  });
});

describe('dead reckoning', () => {
  it('runs the distance on the course', () => {
    // Four hours at three knots, north-east: twelve miles.
    const r = advanceReckoning({ x: 0, y: 0, run: 0 }, 45 * D2R, 3 * 0.514444, 4 * 3600);
    expect(Math.hypot(r.x, r.y) / NM).toBeCloseTo(12, 2);
    expect(r.x).toBeCloseTo(r.y, 6);
    expect(r.run / NM).toBeCloseTo(12, 2);
  });

  it('adds up leg by leg to the same place as one long leg', () => {
    let r = { x: 100, y: -50, run: 0 };
    for (let i = 0; i < 240; i++) r = advanceReckoning(r, 1.1, 1.7, 60);
    const once = advanceReckoning({ x: 100, y: -50, run: 0 }, 1.1, 1.7, 240 * 60);
    expect(r.x).toBeCloseTo(once.x, 6);
    expect(r.y).toBeCloseTo(once.y, 6);
  });
});

describe('words for the log', () => {
  it('names compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(45 * D2R)).toBe('NE');
    expect(compassPoint(-22.5 * D2R)).toBe('NNW');
    expect(compassPoint(359 * D2R)).toBe('N');
    expect(compassWords(225 * D2R)).toBe('south-west');
    expect(compassWords(247.5 * D2R)).toBe('west-south-west');
  });

  it('writes positions in degrees and minutes', () => {
    expect(degMin(-54.1667, 'lat')).toBe("54° 10' S");
    expect(degMin(-37.4, 'lon')).toBe("37° 24' W");
    expect(degMin(-59.9999, 'lat')).toBe("60° 00' S");
  });

  it('puts a wind on the Beaufort scale', () => {
    expect(beaufort(0)).toBe(0);
    expect(beaufort(15)).toBe(4);
    expect(beaufort(36)).toBe(8);
    expect(beaufort(50)).toBe(10);
    expect(beaufort(70)).toBe(12);
  });
});
