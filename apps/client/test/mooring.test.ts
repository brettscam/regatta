import { describe, expect, it } from 'vitest';
import { LEAVING_ANGLE, LIMITS, anchorScope, berthStatus, canAnchor, canBerth, canTurnIn, clearerTack, clockText, compassPoint, lowWater, nearestBerth, secondsUntilClock } from '../src/aboard/mooringRules';

const TZ = 'America/Los_Angeles';
const places = [
  { id: 'ayala', name: 'Ayala Cove', x: 1300, y: 4314, kind: 'mooring' },
  { id: 'sams', name: "Sam's, Tiburon", x: -509, y: 4690, kind: 'dock' },
  { id: 'clipper', name: 'Clipper Cove', x: 7333, y: -1557, kind: 'anchorage' },
  { id: 'nowhere', name: 'A view', x: 1310, y: 4320 },
];

describe('letting go the anchor', () => {
  it('goes down when she is stopped in a sensible depth, with four times the depth of cable', () => {
    const v = canAnchor({ sogKt: 0.6, depth: 6.2, draft: 2 });
    expect(v).toEqual({ ok: true, scope: 25 });
  });

  it('keeps the cable between 15 and 60 m', () => {
    expect(anchorScope(3.1)).toBe(15);
    expect(anchorScope(10)).toBe(40);
    expect(anchorScope(24)).toBe(60);
  });

  it('refuses with way on, and says how to lose it', () => {
    const v = canAnchor({ sogKt: 4.24, depth: 6, draft: 2 });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.say).toContain('4.2 kt');
      expect(v.say).toMatch(/head to wind/);
    }
    expect(canAnchor({ sogKt: 2, depth: 6, draft: 2 }).ok).toBe(false);
    expect(canAnchor({ sogKt: 1.99, depth: 6, draft: 2 }).ok).toBe(true);
  });

  it('tells the tide from way on', () => {
    // Stopped through the water, carried by the stream: luffing up will not help, so it does not say to.
    const v = canAnchor({ sogKt: 2.6, stwKt: 0.3, depth: 6, draft: 2 });
    expect(!v.ok && v.say).toMatch(/stream is setting her at 2\.6 kt/);
    expect(!v.ok && v.say).not.toMatch(/head to wind/);
    // Sailing at four knots is way on, whatever the tide is doing.
    const sailing = canAnchor({ sogKt: 2.6, stwKt: 4, depth: 6, draft: 2 });
    expect(!sailing.ok && sailing.say).toMatch(/head to wind/);
    const berth = canBerth({ sogKt: 3, stwKt: 0.2, place: places[0] });
    expect(!berth.ok && berth.say).toMatch(/against the tide/);
  });

  it('refuses in deep water, naming the depth and the limit', () => {
    const v = canAnchor({ sogKt: 0, depth: 31.4, draft: 2 });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.say).toContain('31 m');
      expect(v.say).toContain(`${LIMITS.maxDepth} m`);
    }
    expect(canAnchor({ sogKt: 0, depth: 25, draft: 2 }).ok).toBe(true);
  });

  it('refuses without a metre under the keel', () => {
    const v = canAnchor({ sogKt: 0, depth: 2.6, draft: 2 });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.say).toContain('2.6 m');
      expect(v.say).toContain('3.0 m');
    }
    expect(canAnchor({ sogKt: 0, depth: 3, draft: 2 }).ok).toBe(true);
    // Dry land reads as no water at all.
    const ashore = canAnchor({ sogKt: 0, depth: 0, draft: 2 });
    expect(!ashore.ok && ashore.say).toMatch(/over the shore/);
  });

  it('complains of speed before depth, since that is the first thing to put right', () => {
    const v = canAnchor({ sogKt: 5, depth: 40, draft: 2 });
    expect(!v.ok && v.say).toMatch(/way on/);
  });
});

describe('moorings and docks', () => {
  it('finds the nearest mooring or dock in reach, and nothing else', () => {
    expect(nearestBerth(places, 1250, 4250, 90)?.place.id).toBe('ayala');
    expect(nearestBerth(places, 1250, 4250, 90)?.distance).toBeCloseTo(Math.hypot(50, 64), 6);
    expect(nearestBerth(places, 1200, 4200, 90)).toBeNull();
    // An anchorage is not something to tie up to, and neither is a place of no kind.
    expect(nearestBerth(places, 7333, -1557, 90)).toBeNull();
    expect(nearestBerth([places[3]], 1310, 4320, 90)).toBeNull();
  });

  it('says where she is in words', () => {
    expect(berthStatus(places[0])).toBe('On a mooring at Ayala Cove');
    expect(berthStatus(places[1])).toBe("Alongside at Sam's, Tiburon");
    expect(berthStatus(null)).toBe('On a mooring');
  });

  it('only takes a line slowly', () => {
    expect(canBerth({ sogKt: 2.4, place: places[0] }).ok).toBe(true);
    const fast = canBerth({ sogKt: 3.3, place: places[0] });
    expect(!fast.ok && fast.say).toMatch(/pick up the mooring at Ayala Cove: 3\.3 kt/);
    const dock = canBerth({ sogKt: 2.5, place: places[1] });
    expect(!dock.ok && dock.say).toMatch(/come alongside at Sam's, Tiburon/);
  });
});

describe('seconds until 06:30', () => {
  const at = (iso: string) => new Date(iso);
  const hours = (s: number) => s / 3600;

  it('counts from the evening to the next morning', () => {
    // 21:40 PDT on 14 July 2024 is 04:40 UTC on the 15th.
    expect(hours(secondsUntilClock(at('2024-07-15T04:40:00Z'), TZ))).toBeCloseTo(8 + 50 / 60, 6);
  });

  it('counts from the small hours to the same morning', () => {
    // 02:00 PDT.
    expect(hours(secondsUntilClock(at('2024-07-15T09:00:00Z'), TZ))).toBeCloseTo(4.5, 6);
  });

  it('counts from the afternoon through the night', () => {
    // 15:00 PDT.
    expect(hours(secondsUntilClock(at('2024-07-14T22:00:00Z'), TZ))).toBeCloseTo(15.5, 6);
  });

  it('is always ahead: at 06:30 it is a whole day, and just after it nearly one', () => {
    expect(secondsUntilClock(at('2024-07-15T13:30:00Z'), TZ)).toBe(86400);
    expect(secondsUntilClock(at('2024-07-15T13:30:01Z'), TZ)).toBe(86399);
    expect(secondsUntilClock(at('2024-07-15T13:29:30Z'), TZ)).toBe(30);
  });

  it('lands on 06:30 by the clock in whatever zone the course is in', () => {
    for (const zone of [TZ, 'Europe/London', 'Australia/Sydney', 'Asia/Kolkata']) {
      const now = at('2024-07-14T23:17:42Z');
      const then = new Date(now.getTime() + secondsUntilClock(now, zone) * 1000);
      expect(clockText(then, zone)).toBe('06:30');
    }
  });

  it('takes another time of day when asked', () => {
    const now = at('2024-07-15T04:40:00Z');
    const then = new Date(now.getTime() + secondsUntilClock(now, TZ, 5, 15) * 1000);
    expect(clockText(then, TZ)).toBe('05:15');
  });

  it('still wakes at 06:30 on the nights the clocks change', () => {
    // Clocks go forward at 02:00 on 10 March 2024 and back at 02:00 on 3 November 2024 in California.
    const spring = at('2024-03-10T06:00:00Z'); // 22:00 PST on the 9th
    expect(hours(secondsUntilClock(spring, TZ))).toBeCloseTo(7.5, 6);
    expect(clockText(new Date(spring.getTime() + secondsUntilClock(spring, TZ) * 1000), TZ)).toBe('06:30');
    const autumn = at('2024-11-03T05:00:00Z'); // 22:00 PDT on the 2nd
    expect(hours(secondsUntilClock(autumn, TZ))).toBeCloseTo(9.5, 6);
    expect(clockText(new Date(autumn.getTime() + secondsUntilClock(autumn, TZ) * 1000), TZ)).toBe('06:30');
  });
});

describe('low water in the night', () => {
  it('finds the bottom of the tide and when it comes', () => {
    // A tide that falls to -0.4 m three hours on, then rises.
    const tide = (s: number) => 0.6 - Math.sin((s / (6 * 3600)) * Math.PI) * 1.0;
    const low = lowWater(tide, 9 * 3600);
    expect(low.height).toBeCloseTo(-0.4, 3);
    expect(low.after).toBe(3 * 3600);
  });

  it('looks no further than the morning', () => {
    const falling = (s: number) => -s / 3600;
    const low = lowWater(falling, 5000, 600);
    expect(low.after).toBe(5000);
    expect(low.height).toBeCloseTo(-5000 / 3600, 9);
  });

  it('is now if the tide only rises', () => {
    expect(lowWater((s) => s / 3600, 8 * 3600)).toEqual({ height: 0, after: 0 });
  });
});

describe('turning in', () => {
  const quiet = { held: true, sharing: false, windKt: 9, underKeelAtLow: 2.4, lowClock: '03:10' };

  it('is allowed on a quiet night with water under her', () => {
    expect(canTurnIn(quiet)).toEqual({ ok: true });
    expect(canTurnIn({ ...quiet, underKeelAtLow: null }).ok).toBe(true);
    expect(canTurnIn({ ...quiet, windKt: 25, underKeelAtLow: 1 }).ok).toBe(true);
  });

  it('is refused under way', () => {
    const v = canTurnIn({ ...quiet, held: false });
    expect(!v.ok && v.say).toMatch(/under way/);
  });

  it('is refused while the clock is shared', () => {
    const v = canTurnIn({ ...quiet, sharing: true });
    expect(!v.ok && v.say).toMatch(/clock is shared/);
  });

  it('is refused in a blow', () => {
    const v = canTurnIn({ ...quiet, windKt: 28.3 });
    expect(!v.ok && v.say).toMatch(/Blowing 28 kt/);
  });

  it('is refused if she would touch at low water, with the time of it', () => {
    const thin = canTurnIn({ ...quiet, underKeelAtLow: 0.42 });
    expect(!thin.ok && thin.say).toMatch(/03:10/);
    expect(!thin.ok && thin.say).toMatch(/0\.4 m/);
    const dry = canTurnIn({ ...quiet, underKeelAtLow: -0.2 });
    expect(!dry.ok && dry.say).toMatch(/aground/);
  });
});

describe('which tack to leave on', () => {
  // Wind from the north. Wind on the starboard side means heading north-west, on the port side north-east.
  const twd = 0;
  const shoalTo = (east: boolean) => (heading: number, metres: number) => {
    const x = Math.sin(heading) * metres;
    return (east ? x > 60 : x < -60) ? 0.8 : 7;
  };

  it('keeps the tack she falls onto when there is water both ways', () => {
    expect(clearerTack(() => 12, twd, 1)).toBe(1);
    expect(clearerTack(() => 12, twd, -1)).toBe(-1);
    // Forty metres one way and fifteen the other are both plenty.
    expect(clearerTack((h) => (Math.sin(h) > 0 ? 40 : 15), twd, 1)).toBe(1);
  });

  it('takes the other tack when hers leads onto a shoal', () => {
    // Shoal to the west: she must not leave with the wind on the starboard side, heading north-west.
    expect(clearerTack(shoalTo(false), twd, 1)).toBe(-1);
    expect(clearerTack(shoalTo(false), twd, -1)).toBe(-1);
    expect(clearerTack(shoalTo(true), twd, -1)).toBe(1);
    expect(clearerTack(shoalTo(true), twd, 1)).toBe(1);
  });

  it('looks down a close reach either side of the wind', () => {
    const seen: number[] = [];
    clearerTack((h) => { seen.push(Math.round((h * 180) / Math.PI)); return 9; }, Math.PI / 2, 1);
    expect(new Set(seen)).toEqual(new Set([35, 145]));
    expect(LEAVING_ANGLE).toBeCloseTo((55 * Math.PI) / 180, 9);
  });
});

describe('the wind in words', () => {
  it('names the eight points', () => {
    const d = Math.PI / 180;
    expect(compassPoint(0)).toBe('north');
    expect(compassPoint(44 * d)).toBe('north-east');
    expect(compassPoint(250 * d)).toBe('west');
    expect(compassPoint(230 * d)).toBe('south-west');
    expect(compassPoint(359 * d)).toBe('north');
    expect(compassPoint(-90 * d)).toBe('west');
  });
});
