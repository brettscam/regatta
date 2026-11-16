import { describe, expect, it } from 'vitest';
import { moonAngles, sunAngles } from '../src/scene/sun';

const R2D = 180 / Math.PI;

describe('the moon', () => {
  it('is a waxing gibbous in the south-west on the evening of the Bay season, and sets after midnight', () => {
    // 14 July 2024, 21:30 PDT over San Francisco: a day past first quarter, a little over half lit.
    const m = moonAngles(new Date('2024-07-15T04:30:00Z'), 37.83, -122.45);
    expect(m.lit).toBeGreaterThan(0.5);
    expect(m.lit).toBeLessThan(0.75);
    expect(m.elevation * R2D).toBeGreaterThan(10);
    expect(m.azimuth * R2D).toBeGreaterThan(170);
    expect(m.azimuth * R2D).toBeLessThan(250);
    // By 02:30 it is down.
    expect(moonAngles(new Date('2024-07-15T09:30:00Z'), 37.83, -122.45).elevation).toBeLessThan(0);
  });

  it('is full when it stands opposite the sun and new when beside it', () => {
    // Full moon 21 July 2024 10:17 UTC, new moon 4 August 2024 11:13 UTC.
    expect(moonAngles(new Date('2024-07-21T10:17:00Z'), 37.83, -122.45).lit).toBeGreaterThan(0.985);
    expect(moonAngles(new Date('2024-08-04T11:13:00Z'), 37.83, -122.45).lit).toBeLessThan(0.02);
    const date = new Date('2024-07-21T10:17:00Z');
    const m = moonAngles(date, 37.83, -122.45);
    const s = sunAngles(date, 37.83, -122.45);
    expect(m.elevation * s.elevation).toBeLessThan(0);
  });
});
