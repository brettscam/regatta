import { describe, expect, it } from 'vitest';
import {
  BITE_SPELL, FAIR_WAIT, GATE_X, POT_MAX_DEPTH, POT_MIN_DEPTH,
  biteIn, cityFrontDistance, describeFish, describeHaul, fishingAdvice, fishingMode, hash01, haulPot, potDepthProblem, potFill,
  prospects, seasonElapsed, soakWords, typicalWait, type Bite, type Water,
} from '../src/aboard/catch';

const MIN = 60;
const pot = (x: number, y: number, depth: number, t = 5000) => ({ x, y, t, depth });
/** Average catch over a spread of pots within a mile of a place, at one depth and soak. */
const average = (x: number, y: number, depth: number, soakMinutes: number) => {
  let keepers = 0;
  let back = 0;
  let dungeness = 0;
  let redRock = 0;
  const n = 300;
  for (let i = 0; i < n; i++) {
    const h = haulPot(pot(x + (i % 30) * 100 - 1500, y + i * 11, depth, 1000 + i * 97), soakMinutes * MIN);
    keepers += h.keepers;
    back += h.thrownBack;
    dungeness += h.dungeness.kept + h.dungeness.back;
    redRock += h.redRock.kept + h.redRock.back;
  }
  return { keepers: keepers / n, back: back / n, dungeness: dungeness / n, redRock: redRock / n };
};
/** Every bite over the whole 36 hour season in one piece of water. */
const season = (w: Water) => {
  const bites: Array<Bite & { spell: number }> = [];
  for (let spell = 0; spell < (36 * 3600) / BITE_SPELL; spell++) {
    const b = biteIn(w, spell);
    if (b) bites.push({ ...b, spell });
  }
  return bites;
};
const tally = (bites: Bite[]) => bites.reduce<Record<string, number>>((t, b) => ({ ...t, [b.species.id]: (t[b.species.id] ?? 0) + 1 }), {});

const trollingBay: Water = { x: 1300, y: 250, depth: 22, speedKt: 3.5, held: false };
const trollingGate: Water = { x: -3500, y: -1000, depth: 60, speedKt: 4, held: false };
const anchoredFlats: Water = { x: 8000, y: 5000, depth: 6, speedKt: 0.2, held: true };
const driftingFlats: Water = { x: 8000, y: 5000, depth: 6, speedKt: 0.6, held: false };
const aquaticPark: Water = { x: 2415, y: -2279, depth: 5, speedKt: 0, held: true };
const deepChannel: Water = { x: 1300, y: 250, depth: 40, speedKt: 0.5, held: false };

describe('hash01', () => {
  it('gives the same number for the same inputs and spreads evenly', () => {
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
    expect(hash01(1.2, 2.9, 3)).toBe(hash01(1, 2, 3));
    const bins = new Array<number>(10).fill(0);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const h = hash01(i, -7, 21);
      if (!(h >= 0 && h < 1)) throw new Error(`hash01 out of range: ${h}`);
      sum += h;
      bins[Math.floor(h * 10)]++;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
    for (const b of bins) expect(Math.abs(b - 2000)).toBeLessThan(200);
  });
});

describe('crab pots', () => {
  it('wants 4 to 35 m of water', () => {
    expect(potDepthProblem(0)).toBe('shallow');
    expect(potDepthProblem(POT_MIN_DEPTH - 0.1)).toBe('shallow');
    expect(potDepthProblem(POT_MIN_DEPTH)).toBeNull();
    expect(potDepthProblem(20)).toBeNull();
    expect(potDepthProblem(POT_MAX_DEPTH)).toBeNull();
    expect(potDepthProblem(POT_MAX_DEPTH + 0.1)).toBe('deep');
    expect(potDepthProblem(NaN)).toBe('shallow');
  });

  it('counts a clock that has gone backwards as a day gone round', () => {
    expect(seasonElapsed(1000, 4000)).toBe(3000);
    expect(seasonElapsed(4000, 4000)).toBe(0);
    // The season wrapped: 100000 s became 13600 s, and a second went by.
    expect(seasonElapsed(100000, 13601)).toBe(1);
    // A new session that starts half an hour earlier in the day than the pot was last seen.
    expect(seasonElapsed(5000, 3200)).toBe(86400 - 1800);
  });

  it('fills over most of an hour and then levels off', () => {
    expect(potFill(0)).toBe(0);
    expect(potFill(8 * MIN)).toBe(0);
    expect(potFill(10 * MIN)).toBeLessThan(0.15);
    expect(potFill(25 * MIN)).toBeGreaterThan(0.5);
    expect(potFill(45 * MIN)).toBeGreaterThan(0.85);
    expect(potFill(60 * MIN)).toBeGreaterThan(0.95);
    expect(potFill(60 * MIN)).toBeLessThanOrEqual(1);
    expect(potFill(24 * 60 * MIN)).toBe(1);
    for (let m = 1; m < 200; m++) expect(potFill(m * MIN)).toBeGreaterThanOrEqual(potFill((m - 1) * MIN));
  });

  it('brings up nothing much inside ten minutes, a fair pot after an hour, and no more after three', () => {
    const quick = average(1300, 250, 20, 5);
    expect(quick.keepers + quick.back).toBe(0);
    const ten = average(1300, 250, 20, 10);
    expect(ten.keepers + ten.back).toBeLessThan(1.5);
    const hour = average(1300, 250, 20, 60);
    expect(hour.keepers).toBeGreaterThan(2);
    expect(hour.keepers).toBeLessThan(5);
    const half = average(1300, 250, 20, 25);
    expect(half.keepers).toBeGreaterThan(ten.keepers);
    expect(half.keepers).toBeLessThan(hour.keepers);
    const long = average(1300, 250, 20, 180);
    expect(long.keepers).toBeCloseTo(hour.keepers, 0);
    expect(long.keepers).toBeGreaterThanOrEqual(hour.keepers);
  });

  it('finds red rock crab in the shallows and Dungeness deeper, with more keepers outside the Gate', () => {
    const shallow = average(8000, 5000, 5, 60);
    const deeper = average(1300, 250, 22, 60);
    expect(shallow.redRock).toBeGreaterThan(2);
    expect(deeper.redRock).toBeLessThan(0.8);
    expect(deeper.dungeness).toBeGreaterThan(shallow.dungeness);
    const inside = average(1300, 250, 22, 60);
    const outside = average(GATE_X - 4000, -1000, 22, 60);
    expect(outside.keepers).toBeGreaterThan(inside.keepers * 1.3);
    // Inside the Bay most Dungeness are young ones that go back.
    expect(inside.back).toBeGreaterThan(inside.keepers);
  });

  it('never holds more than a pot can', () => {
    for (let i = 0; i < 2000; i++) {
      const h = haulPot(pot(i * 91, i * 53, 4 + (i % 31), i * 613), 3 * 3600);
      expect(h.keepers + h.thrownBack).toBeLessThanOrEqual(12);
      expect(h.keepers).toBe(h.dungeness.kept + h.redRock.kept);
      expect(h.thrownBack).toBe(h.dungeness.back + h.redRock.back);
    }
  });

  it('is fixed by where and when the pot went down', () => {
    const a = haulPot(pot(6500, 3000, 8), 55 * MIN);
    expect(haulPot(pot(6500, 3000, 8), 55 * MIN)).toEqual(a);
    expect({ dungeness: a.dungeness, redRock: a.redRock }).toMatchInlineSnapshot(`
      {
        "dungeness": {
          "back": 4,
          "kept": 0,
        },
        "redRock": {
          "back": 1,
          "kept": 3,
        },
      }
    `);
    expect(describeHaul(a)).toMatchInlineSnapshot(`"Pot up after 55 minutes: 3 red rock crab to keep, 5 undersized went back"`);
    expect(describeHaul(haulPot(pot(-5000, -1000, 25), 55 * MIN))).toMatchInlineSnapshot(`"Pot up after 55 minutes: 5 Dungeness to keep, 2 undersized went back"`);
    expect(describeHaul(haulPot(pot(0, 0, 34), 55 * MIN))).toMatchInlineSnapshot(`"Pot up after 55 minutes: 2 crab, all under the size. Back they went"`);
    expect(describeHaul(haulPot(pot(6500, 3000, 8), 4 * MIN))).toMatchInlineSnapshot(`"Pot up after 4 minutes: nothing in it but the bait. Leave it down most of an hour"`);
  });

  it('says how long in words', () => {
    expect(soakWords(20)).toBe('under a minute');
    expect(soakWords(60)).toBe('1 minute');
    expect(soakWords(52 * MIN)).toBe('52 minutes');
    expect(soakWords(2 * 3600)).toBe('2 hours');
    expect(soakWords(2.5 * 3600)).toBe('2.5 hours');
  });
});

describe('fishing', () => {
  it('trolls under way, fishes the bottom when stopped or held, and skips when too fast', () => {
    expect(fishingMode({ ...trollingBay, speedKt: 0.4 })).toBe('still');
    expect(fishingMode({ ...trollingBay, speedKt: 1.6 })).toBe('troll');
    expect(fishingMode({ ...trollingBay, speedKt: 5.9 })).toBe('troll');
    expect(fishingMode({ ...trollingBay, speedKt: 6.5 })).toBe('skip');
    // Sheering about on her anchor she may show some speed, but the bait is still on the bottom.
    expect(fishingMode({ ...anchoredFlats, speedKt: 2 })).toBe('still');
  });

  it('knows the city front from the rest of the Bay', () => {
    expect(cityFrontDistance(2415, -2279)).toBeLessThan(200);
    expect(cityFrontDistance(3469, -2168)).toBeLessThan(200);
    expect(cityFrontDistance(5532, -5891)).toBeLessThan(300);
    expect(cityFrontDistance(1300, 250)).toBeGreaterThan(2000);
    expect(cityFrontDistance(8000, 5000)).toBeGreaterThan(5000);
  });

  it('offers the right fish for the water', () => {
    const ids = (w: Water) => prospects(w).map((p) => p.species.id);
    expect(ids(trollingBay)).toEqual(['striper']);
    expect(ids(trollingGate)).toEqual(['king', 'striper']);
    expect(ids(anchoredFlats)).toEqual(['halibut', 'leopard', 'batray']);
    expect(ids(aquaticPark).sort()).toEqual(['batray', 'halibut', 'jacksmelt', 'leopard', 'perch']);
    expect(ids(deepChannel)).toEqual([]);
    expect(ids({ ...trollingBay, speedKt: 7 })).toEqual([]);
    // No salmon well inside the Bay, no halibut on a trolled lure, nothing from the piers out in the stream.
    expect(ids({ ...trollingBay, x: 6000 })).not.toContain('king');
    expect(ids({ ...anchoredFlats, held: false, speedKt: 3 })).toEqual(['striper']);
  });

  it('brings a bite every several minutes when conditions suit', () => {
    for (const w of [trollingBay, trollingGate, anchoredFlats, driftingFlats, aquaticPark]) {
      const wait = typicalWait(w) / MIN;
      expect(wait).toBeGreaterThan(2);
      expect(wait).toBeLessThan(8);
      // Over the whole season the bites that really come agree with that.
      const bites = season(w).length;
      const expected = (36 * 60) / wait;
      expect(bites).toBeGreaterThan(expected * 0.8);
      expect(bites).toBeLessThan(expected * 1.2);
    }
    expect(typicalWait(trollingBay)).toBe(FAIR_WAIT);
    expect(typicalWait(deepChannel)).toBe(Infinity);
    expect(season(deepChannel)).toHaveLength(0);
    expect(season({ ...trollingBay, speedKt: 7 })).toHaveLength(0);
    // Pushing on at 5.6 kt the lure fishes badly.
    expect(typicalWait({ ...trollingBay, speedKt: 5.6 })).toBeGreaterThan(typicalWait(trollingBay) * 1.5);
    // A drift covers more ground than lying to an anchor.
    expect(typicalWait(driftingFlats)).toBeLessThan(typicalWait(anchoredFlats));
  });

  it('is varied: bites come at uneven intervals, not on a clock', () => {
    const spells = season(trollingBay).map((b) => b.spell);
    const gaps = spells.slice(1).map((s, i) => (s - spells[i]) * BITE_SPELL);
    const short = gaps.filter((g) => g <= 2 * MIN).length;
    const long = gaps.filter((g) => g >= 10 * MIN).length;
    expect(short).toBeGreaterThan(gaps.length * 0.1);
    expect(long).toBeGreaterThan(gaps.length * 0.1);
  });

  it('catches the fish the water holds, in sensible sizes', () => {
    expect(Object.keys(tally(season(trollingBay)))).toEqual(['striper']);
    const gate = tally(season(trollingGate));
    expect(gate.king).toBeGreaterThan(gate.striper);
    const flats = tally(season(anchoredFlats));
    expect(flats.halibut).toBeGreaterThan(flats.leopard);
    expect(flats.leopard).toBeGreaterThan(flats.batray * 0.8);
    const piers = tally(season(aquaticPark));
    expect(piers.jacksmelt).toBeGreaterThan(100);
    expect(piers.perch).toBeGreaterThan(100);
    for (const w of [trollingBay, trollingGate, anchoredFlats, aquaticPark]) {
      const bites = season(w);
      for (const b of bites) {
        expect(b.cm).toBeGreaterThanOrEqual(b.species.size[0]);
        expect(b.cm).toBeLessThanOrEqual(b.species.size[1]);
        expect(b.keeper).toBe(b.species.minCm === undefined || b.cm >= b.species.minCm);
        expect(b.kg).toBeGreaterThan(0.04);
        expect(b.kg).toBeLessThan(30);
      }
      // Some go back, most do not.
      const back = bites.filter((b) => !b.keeper).length;
      expect(back).toBeGreaterThan(0);
      expect(back).toBeLessThan(bites.length * 0.5);
    }
  });

  it('is fixed by the time and the place', () => {
    const first = season(trollingBay)[0];
    expect(biteIn(trollingBay, first.spell)).toEqual(biteIn(trollingBay, first.spell));
    // Anywhere in the same 250 m patch is the same water.
    expect(biteIn({ ...trollingBay, x: trollingBay.x + 40 }, first.spell)).toEqual(biteIn(trollingBay, first.spell));
    expect(first.spell).toMatchInlineSnapshot(`10`);
    expect(season(trollingBay).slice(0, 3).map(describeFish)).toMatchInlineSnapshot(`
      [
        "A striped bass, 51 cm and 1.5 kg, in the boat",
        "A striped bass, 42 cm: under the 46 cm limit, so back it goes",
        "A striped bass, 40 cm: under the 46 cm limit, so back it goes",
      ]
    `);
    expect(season(anchoredFlats).slice(0, 3).map(describeFish)).toMatchInlineSnapshot(`
      [
        "A California halibut, 55 cm: under the 56 cm limit, so back it goes",
        "A bat ray, 45 cm across the wings and 1.2 kg, in the boat",
        "A bat ray, 56 cm across the wings and 2.3 kg, in the boat",
      ]
    `);
    expect(season(aquaticPark).slice(0, 3).map(describeFish)).toMatchInlineSnapshot(`
      [
        "A California halibut, 54 cm: under the 56 cm limit, so back it goes",
        "A California halibut, 44 cm: under the 56 cm limit, so back it goes",
        "A jacksmelt, 21 cm and 70 g, in the boat",
      ]
    `);
    expect(season(trollingGate).slice(0, 3).map(describeFish)).toMatchInlineSnapshot(`
      [
        "A striped bass, 40 cm: under the 46 cm limit, so back it goes",
        "A king salmon, 50 cm: under the 51 cm limit, so back it goes",
        "A king salmon, 54 cm and 1.9 kg, in the boat",
      ]
    `);
  });

  it('says what the line is doing', () => {
    expect(fishingAdvice(trollingBay)).toBe('Trolling at 3.5 kt for striped bass');
    expect(fishingAdvice(trollingGate)).toBe('Trolling at 4.0 kt for king salmon and striped bass');
    expect(fishingAdvice(anchoredFlats)).toBe('Bait on the bottom in 6 m for California halibut and leopard shark');
    expect(fishingAdvice(driftingFlats)).toBe('Drifting a bait in 6 m for California halibut and leopard shark');
    expect(fishingAdvice(deepChannel)).toContain('Too deep to hope for much');
    expect(fishingAdvice({ ...trollingBay, speedKt: 7.2 })).toBe('At 7.2 kt the lure is skipping on top. Slow to 5 kt or less and it will fish');
  });
});
