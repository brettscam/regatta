import { describe, expect, it } from 'vitest';
import { Sim, KT, type BoatSpec, type Environment } from '@slack-tide/sim';
import sloop from '../../../boats/sloop38.json';
import { SHADOW, ShadedWind, shadowAt, shadowEase, shadowOf, type ShadowSource } from '../src/race/shadow';
import { badAirLine } from '../src/aboard/badair';

const boat = sloop as unknown as BoatSpec;
const L = boat.dimensions.loa;
const MAST = boat.dimensions.mastHeight;
const WIND = 12 * KT;

/** A boat at the origin. Stopped unless told otherwise, so her shadow lies dead downwind. */
const src = (o: Partial<ShadowSource> = {}): ShadowSource => ({ x: 0, y: 0, sog: 0, cog: 0, length: L, mast: MAST, sails: true, ...o });

describe('one boat\'s wind shadow', () => {
  // Wind from the north: downwind is south, negative y.
  it('takes about a third of the wind close under her lee', () => {
    const loss = shadowOf(src(), 0, -2 * L, 0, WIND);
    expect(loss).toBeCloseTo(SHADOW.peak, 6);
    expect(loss).toBeGreaterThanOrEqual(0.3);
    expect(loss).toBeLessThanOrEqual(0.4);
  });

  it('casts nothing to windward or abeam', () => {
    expect(shadowOf(src(), 0, 30, 0, WIND)).toBe(0);
    expect(shadowOf(src(), 25, 0, 0, WIND)).toBe(0);
    expect(shadowOf(src(), -25, 0, 0, WIND)).toBe(0);
  });

  it('fades with distance and is gone by ten mast heights', () => {
    const at = (d: number) => shadowOf(src(), 0, -d, 0, WIND);
    expect(at(2.5 * L)).toBeCloseTo(SHADOW.peak, 6);
    expect(at(4 * MAST)).toBeLessThan(at(2.5 * L));
    expect(at(7 * MAST)).toBeLessThan(at(4 * MAST));
    expect(at(7 * MAST)).toBeGreaterThan(0);
    expect(at(7 * MAST)).toBeLessThan(0.06);
    expect(at(10 * MAST)).toBe(0);
    expect(at(12 * MAST)).toBe(0);
  });

  it('is narrow, strongest on the line, and wider further off', () => {
    const d = 3 * L;
    const on = shadowOf(src(), 0, -d, 0, WIND);
    const half = shadowOf(src(), (SHADOW.halfWidth * L + SHADOW.spread * d) / 2, -d, 0, WIND);
    expect(half).toBeLessThan(on);
    expect(half).toBeGreaterThan(0);
    expect(shadowOf(src(), SHADOW.halfWidth * L + SHADOW.spread * d + 0.1, -d, 0, WIND)).toBe(0);
    // Ten metres off the line is outside it at one length and inside it at eight.
    expect(shadowOf(src(), 10, -L, 0, WIND)).toBe(0);
    expect(shadowOf(src(), 10, -8 * L, 0, WIND)).toBeGreaterThan(0);
    // The same either side.
    expect(shadowOf(src(), -6, -d, 0, WIND)).toBeCloseTo(shadowOf(src(), 6, -d, 0, WIND), 12);
  });

  it('comes on over the first half length, so a boat rafted alongside is not becalmed', () => {
    expect(shadowOf(src(), 0, -0.1 * L, 0, WIND)).toBeLessThan(0.1);
    expect(shadowOf(src(), 0, -0.5 * L, 0, WIND)).toBeCloseTo(SHADOW.peak, 6);
  });

  it('a boat with her sails stowed casts none', () => {
    expect(shadowOf(src({ sails: false }), 0, -2 * L, 0, WIND)).toBe(0);
  });

  it('trails along her apparent wind: astern of dead downwind for a boat making way', () => {
    // Wind from the north, she is reaching east at 6 kt. The air she has used is left behind her to the south-west.
    const reaching = src({ sog: 6 * KT, cog: Math.PI / 2 });
    const d = 2 * L;
    const k = (6 * KT) / WIND;
    const n = Math.hypot(1, k);
    expect(shadowOf(reaching, (-k / n) * d, (-1 / n) * d, 0, WIND)).toBeCloseTo(SHADOW.peak, 6);
    // Dead downwind of her is outside it at that range, and so is the same angle on the bow side.
    expect(shadowOf(reaching, 0, -d, 0, WIND)).toBe(0);
    expect(shadowOf(reaching, (k / n) * d, (-1 / n) * d, 0, WIND)).toBe(0);
  });

  it('follows the wind round the compass', () => {
    // Wind from the west: the shadow lies to the east.
    expect(shadowOf(src(), 2 * L, 0, (3 * Math.PI) / 2, WIND)).toBeCloseTo(SHADOW.peak, 6);
    expect(shadowOf(src(), -2 * L, 0, (3 * Math.PI) / 2, WIND)).toBe(0);
  });

  it('there is no shadow in no wind', () => {
    expect(shadowOf(src(), 0, -2 * L, 0, 0)).toBe(0);
  });
});

describe('the wind left with several boats about', () => {
  it('is whole in clear air', () => {
    expect(shadowAt(0, 0, 0, WIND, [])).toEqual({ factor: 1, by: -1 });
    expect(shadowAt(200, 0, 0, WIND, [src()])).toEqual({ factor: 1, by: -1 });
  });

  it('names the boat taking the most', () => {
    const near = src({ x: 0, y: 2 * L });
    const far = src({ x: 2, y: 8 * L });
    const got = shadowAt(0, 0, 0, WIND, [far, near]);
    expect(got.by).toBe(1);
    expect(got.factor).toBeLessThan(1 - SHADOW.peak);
  });

  it('boats add up, but never take more than half the wind', () => {
    const wall = [1, 1.5, 2, 2.5].map((n) => src({ y: n * L }));
    const one = shadowAt(0, 0, 0, WIND, [wall[2]]).factor;
    const two = shadowAt(0, 0, 0, WIND, [wall[2], wall[3]]).factor;
    expect(one).toBeCloseTo(1 - SHADOW.peak, 6);
    expect(two).toBeLessThan(one);
    expect(shadowAt(0, 0, 0, WIND, wall).factor).toBe(1 - SHADOW.cap);
  });
});

describe('the wind a boat is handed', () => {
  const world: Environment = { sample: () => ({ windDir: 0, windSpeed: WIND, currentX: 0.2, currentY: -0.1, depth: 30 }) };

  it('is the world\'s own sample in clear air', () => {
    const air = new ShadedWind(world);
    expect(air.sample(0, 0, 0)).toEqual({ windDir: 0, windSpeed: WIND, currentX: 0.2, currentY: -0.1, depth: 30 });
  });

  it('is lighter in a shadow, with everything else as it was, and the world is left alone', () => {
    const fixed = { windDir: 1, windSpeed: WIND, currentX: 0.2, currentY: -0.1, depth: 30 };
    const air = new ShadedWind({ sample: () => fixed });
    air.factor = 0.65;
    const e = air.sample(0, 0, 0);
    expect(e.windSpeed).toBeCloseTo(WIND * 0.65, 12);
    expect(e.windDir).toBe(1);
    expect(e.currentX).toBe(0.2);
    expect(e.depth).toBe(30);
    // Asked twice, the loss is not taken twice.
    expect(air.sample(0, 0, 0).windSpeed).toBeCloseTo(WIND * 0.65, 12);
    expect(fixed.windSpeed).toBe(WIND);
  });

  it('a sim fed through it sails the same track as one fed the world, until a shadow falls on her', () => {
    const start = { headingDeg: 60, speedKt: 5 };
    const plain = new Sim(boat, world, start);
    const air = new ShadedWind(world);
    const shaded = new Sim(boat, air, start);
    for (const sim of [plain, shaded]) {
      sim.setCrewTrim(true);
      sim.trimForWind();
      sim.setHelm('heading');
      sim.advance(60);
    }
    expect(shaded.snapshot()).toEqual(plain.snapshot());
    air.factor = 0.65;
    plain.advance(60);
    shaded.advance(60);
    expect(shaded.out.tws).toBeLessThan(plain.out.tws * 0.7);
    expect(shaded.state.speed).toBeLessThan(plain.state.speed - 0.5 * KT);
  });

  it('comes on and goes off over a second or two', () => {
    expect(shadowEase(0.1)).toBeGreaterThan(0.05);
    expect(shadowEase(0.1)).toBeLessThan(0.12);
    expect(shadowEase(5)).toBeGreaterThan(0.95);
  });
});

describe('what the player is told', () => {
  it('names whose shadow it is and what it costs', () => {
    expect(badAirLine('Scott', 4.3)).toBe("In Scott's wind shadow: 4 kt less wind. Bear away or tack for clear air");
    expect(badAirLine('', 0.4)).toBe("In another boat's wind shadow. Bear away or tack for clear air");
  });
});
