import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BARE, BREATH, DIVE_POINTS, ENTRY, FLAG, GRAB, GUN, KICK,
  alarm, blackoutAt, breathRate, cleanDive, effortOf, glide, lungsFor, urge, canDive, canFire, diverNear, fightSeconds, gauge, grab, holdBreath, inSeason, judge, lightAt, lobsterSeason, lobstersAt, makeGround,
  markRadius, nameKey, newBreath, packDive, populate, readDive, recover, runOver, shoot, siteAt, spook, stepFish, surfaceInterval, surfaced, surge,
  underwaterVisibility, zoneAt,
  type DiveFile, type DiveSpecies, type Diver, type Fish, type Lungs,
} from '../src/aboard/diveRules';
import { cleanDiveLog } from '../src/aboard/diveLog';
import { worldOf } from './waters';

const read = (water: string) => JSON.parse(readFileSync(new URL(`../../../courses/${water}/dives.json`, import.meta.url)).toString()) as DiveFile;
const catalina = read('catalina');
const bvi = read('bvi');
const species = (file: DiveFile, id: string): DiveSpecies => file.species.find((s) => s.id === id)!;
const still = (x: number, y: number, d: number): Diver => ({ x, y, d, vx: 0, vy: 0, vd: 0 });
const fishAt = (sp: DiveSpecies, x: number, y: number, d: number, cm = 40): Fish => ({
  index: 0, species: sp, cm, kg: sp.kgPerCm3 * cm ** 3, count: 1, x, y, d, hx: x, hy: y, hd: d, vx: 0, vy: 0, vd: 0, heading: 0, mode: 'cruise', fear: 0, left: 0, phase: 0,
});
const flat = (depth: number) => () => depth;
const conditions = { night: false, dawn: false };

describe('the data', () => {
  for (const [name, file] of [['catalina', catalina], ['bvi', bvi]] as const) {
    it(`${name}: every fish a site names is a fish the water has, and the numbers are sound`, () => {
      const ids = new Set(file.species.map((s) => s.id));
      expect(file.sites.length).toBeGreaterThan(2);
      for (const site of file.sites) {
        for (const id of site.life) expect(ids.has(id), `${site.id} names ${id}`).toBe(true);
        expect(site.depth[0]).toBeLessThan(site.depth[1]);
        expect(site.depth[0]).toBeLessThanOrEqual(lungsFor(0).limit);
        expect(site.say.length).toBeGreaterThan(20);
      }
      for (const s of file.species) {
        expect(s.size[0]).toBeLessThan(s.size[1]);
        expect(s.wary).toBeGreaterThanOrEqual(0);
        expect(s.colour).toMatch(/^#[0-9a-f]{6}$/);
        // A protected fish has no size or bag to tempt anyone with.
        if (s.protected || s.spare) expect(s.minCm).toBeUndefined();
        expect(s.say.length).toBeGreaterThan(20);
      }
      expect(file.water.visibility[0]).toBeLessThan(file.water.visibility[1]);
    });
  }

  it('Catalina sees 12 to 25 m and the islands 20 to 30', () => {
    expect(catalina.water.visibility).toEqual([12, 25]);
    expect(bvi.water.visibility).toEqual([20, 30]);
  });

  it('the garibaldi and the giant sea bass are protected, and Casino Point and Lover\'s Cove are reserves', () => {
    expect(species(catalina, 'garibaldi').protected).toBeTruthy();
    expect(species(catalina, 'gsb').protected).toBeTruthy();
    for (const id of ['casino-point', 'lovers-cove']) {
      const site = catalina.sites.find((s) => s.id === id)!;
      expect(zoneAt(catalina, site.x, site.y)?.id).toBe(id);
    }
    // And there is somewhere left to hunt.
    const open = catalina.sites.filter((s) => !zoneAt(catalina, s.x, s.y));
    expect(open.map((s) => s.id)).toEqual(expect.arrayContaining(['bird-rock', 'ship-rock', 'hen-rock']));
  });

  it('the islands\' sites lie in water on the chart that is there today', () => {
    const world = worldOf('bvi', 3);
    for (const site of bvi.sites) expect(world.chartDepth(site.x, site.y), site.id).toBeGreaterThan(1);
    expect(zoneAt(bvi, 1500, -5700)?.id).toBe('rhone');
    expect(zoneAt(bvi, -8400, -9900)).toBeNull();
  });

  it('a site is found from inside its circle and not from a mile off', () => {
    const site = catalina.sites.find((s) => s.id === 'bird-rock')!;
    expect(siteAt(catalina, site.x + 40, site.y - 30)?.id).toBe('bird-rock');
    expect(siteAt(catalina, site.x + 1800, site.y)?.id).not.toBe('bird-rock');
    expect(siteAt(BARE, 0, 0)).toBeNull();
  });
});

describe('getting in', () => {
  const ok = { held: true, inTender: false, tenderKt: 0, ashore: false, streamKt: 0.2, depth: 9, racing: false };
  it('from the yacht only at anchor or on a mooring', () => {
    expect(canDive(ok).ok).toBe(true);
    const under = canDive({ ...ok, held: false });
    expect(under.ok).toBe(false);
    expect(under.say).toMatch(/under way/);
  });
  it('from a tender that has stopped, and not from one ashore or moving', () => {
    expect(canDive({ ...ok, held: false, inTender: true, tenderKt: 0.2 }).ok).toBe(true);
    expect(canDive({ ...ok, inTender: true, tenderKt: 3 }).ok).toBe(false);
    expect(canDive({ ...ok, ashore: true }).ok).toBe(false);
  });
  it('not in a race, not in a stream nobody can swim, not in water too thin to dive', () => {
    expect(canDive({ ...ok, racing: true }).ok).toBe(false);
    expect(canDive({ ...ok, streamKt: ENTRY.maxStreamKt + 0.3 }).ok).toBe(false);
    expect(canDive({ ...ok, depth: 1 }).ok).toBe(false);
    expect(canDive({ ...ok, streamKt: 0.9 }).say).toMatch(/stream/);
  });
});

describe('lungs', () => {
  const beginner = lungsFor(0);
  const expert = lungsFor(400);
  /** Kick down to a depth at a steady rhythm, lie there for as long as leaves enough to get back, and say how long that was. */
  const dive = (l: Lungs, depth: number, prep = 0): { bottom: number; reached: boolean } => {
    const b = { ...newBreath(), prep };
    let d = 0;
    let call = 'ok';
    const easy = effortOf(0.6);
    while (d < depth && call !== 'blackout') { d += 0.063; call = holdBreath(b, l, d, easy, 0.1); }
    const up = (from: number) => { let cost = 0; for (let z = from; z > 0; z -= 0.063) cost += breathRate(l, z, easy, prep) * 0.1; return cost; };
    let bottom = 0;
    while (b.air - up(depth) > BREATH.danger) { holdBreath(b, l, depth, 0, 0.1); bottom += 0.1; if (bottom > 400) break; }
    return { bottom, reached: call !== 'blackout' };
  };

  it('a beginner has 45 seconds and 8 metres; an expert two and a half minutes and 25', () => {
    expect(beginner).toMatchObject({ level: 0, hold: 45, easy: 8 });
    expect(expert).toMatchObject({ level: 10, hold: 150, easy: 25 });
    expect(expert.recovery).toBeLessThan(beginner.recovery);
    expect(expert.limit).toBeGreaterThan(beginner.limit);
    expect(lungsFor(1e9).level).toBe(10);
    expect(lungsFor(-5).level).toBe(0);
    let last = -1;
    for (let pts = 0; pts <= 400; pts += 10) { const l = lungsFor(pts); expect(l.level).toBeGreaterThanOrEqual(last); last = l.level; expect(l.name.length).toBeGreaterThan(3); }
  });

  it('one breath lasts its count lying still at the top', () => {
    expect(1 / breathRate(beginner, 0, 0)).toBeCloseTo(45, 5);
    expect(1 / breathRate(expert, 0, 0)).toBeCloseTo(150, 5);
    const b = newBreath();
    let t = 0;
    while (holdBreath(b, beginner, 0.5, 0, 0.5) !== 'blackout') t += 0.5;
    expect(t).toBeGreaterThan(40);
    expect(t).toBeLessThan(47);
  });

  it('kicking and depth both use it faster, and much faster below her comfortable depth', () => {
    expect(breathRate(beginner, 5, 1)).toBeCloseTo(breathRate(beginner, 5, 0) * 1.6, 6);
    expect(breathRate(beginner, 5, 4)).toBeGreaterThan(breathRate(beginner, 5, 1) * 2);
    const shallow = (breathRate(beginner, 8, 0) - breathRate(beginner, 0, 0)) / 8;
    const deep = (breathRate(beginner, 16, 0) - breathRate(beginner, 8, 0)) / 8;
    expect(deep).toBeGreaterThan(shallow * 2.5);
    // The same depth is deep for a beginner and easy for an expert.
    expect(breathRate(beginner, 15, 0) * beginner.hold).toBeGreaterThan(breathRate(expert, 15, 0) * expert.hold);
    expect(breathRate(beginner, 6, 0.5, 0, true)).toBeGreaterThan(breathRate(beginner, 6, 0.5));
  });

  it('a breathe-up on the float makes the next dive go further, and it is lost by swimming about', () => {
    expect(breathRate(beginner, 5, 1, 1)).toBeCloseTo(breathRate(beginner, 5, 1, 0) * (1 - BREATH.saving), 6);
    expect(dive(beginner, 5, 1).bottom).toBeGreaterThan(dive(beginner, 5, 0).bottom + 2);
    const b = newBreath();
    for (let t = 0; t < BREATH.breatheUp / 2; t += 0.1) recover(b, 0.1, true);
    expect(b.prep).toBeCloseTo(0.5, 1);
    for (let t = 0; t < BREATH.breatheUp; t += 0.1) recover(b, 0.1, true);
    expect(b.prep).toBe(1);
    for (let t = 0; t < 7; t += 0.1) recover(b, 0.1, false);
    expect(b.prep).toBe(0);
  });

  it('a beginner hunts at five metres and barely touches twelve; an expert has minutes at twenty', () => {
    expect(dive(beginner, 5).bottom).toBeGreaterThan(8);
    expect(dive(beginner, 12).bottom).toBeLessThan(dive(beginner, 5).bottom / 2);
    expect(dive(expert, 20).bottom).toBeGreaterThan(15);
    expect(dive(expert, 20).bottom).toBeGreaterThan(dive(beginner, 5).bottom * 1.5);
  });

  it('the urge to breathe comes well before the limit, then the warning, then the edge', () => {
    const b = newBreath();
    const calls: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const c = holdBreath(b, beginner, 4, 0.4, 0.1);
      if (calls[calls.length - 1] !== c) calls.push(c);
      if (c === 'blackout') break;
    }
    expect(calls).toEqual(['ok', 'urge', 'warn', 'danger', 'blackout']);
    expect(b.air).toBe(0);
    expect(urge(1)).toBe(0);
    expect(urge(BREATH.urge)).toBe(0);
    expect(urge(0.3)).toBeGreaterThan(0.3);
    expect(urge(0.3)).toBeLessThan(urge(0.15));
    expect(urge(0.05)).toBe(1);
  });

  it('shallow-water blackout: up from a deep dive, the last metres take what is left', () => {
    // Deep, and still deep: nothing yet. Near the top after it: a margin is needed.
    expect(blackoutAt(beginner, 16, 14)).toBe(0);
    expect(blackoutAt(beginner, 16, 4)).toBeCloseTo(0.1, 5);
    expect(blackoutAt(beginner, 11, 3)).toBeGreaterThan(0);
    expect(blackoutAt(beginner, 11, 3)).toBeLessThan(blackoutAt(beginner, 16, 3));
    // A dive inside her comfortable depth carries no such risk, and nor does the same dive for an expert.
    expect(blackoutAt(beginner, 7, 2)).toBe(0);
    expect(blackoutAt(expert, 16, 4)).toBe(0);
    const b = { ...newBreath(), air: 0.08, deepest: 16, under: 60 };
    expect(holdBreath(b, beginner, 3, 0.5, 0.1)).toBe('blackout');
    const shallow = { ...newBreath(), air: 0.08, deepest: 6, under: 30 };
    expect(holdBreath(shallow, beginner, 3, 0.5, 0.1)).toBe('danger');
  });

  it('a longer or deeper dive asks a longer surface interval, and practice shortens it', () => {
    expect(surfaceInterval(beginner, 60, 10)).toBeGreaterThan(surfaceInterval(beginner, 30, 10) * 1.8);
    expect(surfaceInterval(beginner, 40, 18)).toBeGreaterThan(surfaceInterval(beginner, 40, 5) * 1.2);
    expect(surfaceInterval(beginner, 2, 1)).toBe(12);
    expect(surfaceInterval(beginner, 60, 10)).toBeGreaterThanOrEqual(90);
    expect(surfaceInterval(expert, 60, 10)).toBeLessThan(surfaceInterval(beginner, 60, 10) * 0.75);
  });

  it('recovers over the interval and not before, and rushing it leaves less for the next dive', () => {
    const b = newBreath();
    for (let i = 0; i < 300; i++) holdBreath(b, beginner, 5, 0.3, 0.1);
    const used = 1 - b.air;
    expect(used).toBeGreaterThan(0.4);
    surfaced(b, beginner);
    const owed = b.rest;
    expect(owed).toBeCloseTo(surfaceInterval(beginner, 30, 5), 5);
    expect(b.under).toBe(0);
    for (let t = 0; t < owed / 2; t += 0.1) recover(b, 0.1);
    expect(b.air).toBeGreaterThan(1 - used * 0.6);
    expect(b.air).toBeLessThan(1 - used * 0.4);
    expect(b.prep).toBe(0);
    for (let t = 0; t < owed / 2 + 1; t += 0.1) recover(b, 0.1);
    expect(b.air).toBe(1);
    expect(b.rest).toBe(0);
  });

  it('only a dive she came up from with air in hand is practice', () => {
    expect(cleanDive(40, 8, 0.3)).toBeGreaterThan(0);
    expect(cleanDive(40, 8, 0.1)).toBe(0);
    expect(cleanDive(6, 2, 0.9)).toBe(0);
    expect(cleanDive(70, 18, 0.25)).toBeGreaterThan(cleanDive(30, 5, 0.25));
    // About a hundred good dives make an expert.
    expect(400 / cleanDive(50, 10, 0.3)).toBeGreaterThan(50);
    expect(400 / cleanDive(50, 10, 0.3)).toBeLessThan(150);
  });
});

describe('fins', () => {
  const l = lungsFor(100);
  /** Metres made good along the level, and breath used, kicking at a steady rate for a minute. */
  const swim = (perSecond: number) => {
    let v = 0;
    let x = 0;
    let since = 0;
    let air = 0;
    for (let t = 0; t < 60; t += 0.02) {
      since += 0.02;
      if (since >= 1 / perSecond) { v += KICK.thrust; since = 0; }
      v = glide(v, 0.02);
      x += v * 0.02;
      air += breathRate(l, 5, effortOf(perSecond)) * 0.02;
    }
    return { speed: x / 60, perBreath: x / air };
  };

  it('a glide carries her on and dies away; the faster she goes the faster it dies', () => {
    expect(glide(1, 1)).toBeLessThan(1);
    expect(glide(1, 1)).toBeGreaterThan(0.4);
    expect(1 - glide(1, 0.5) / 1).toBeGreaterThan(1 - glide(0.3, 0.5) / 0.3);
    expect(glide(0, 1)).toBe(0);
  });

  it('a steady rhythm is an effort of one, long glides a fraction of it, thrashing three times it', () => {
    expect(effortOf(1 / KICK.rhythm)).toBeCloseTo(1, 6);
    expect(effortOf(0.5)).toBeLessThan(0.2);
    expect(effortOf(1 / KICK.fastest)).toBe(4);
    expect(effortOf(0)).toBe(0);
  });

  it('kick and glide goes furthest on a breath; thrashing is faster and far worse', () => {
    const easy = swim(0.6);
    const steady = swim(1 / KICK.rhythm);
    const thrash = swim(1 / KICK.fastest);
    expect(thrash.speed).toBeGreaterThan(steady.speed);
    expect(steady.speed).toBeGreaterThan(easy.speed);
    expect(easy.perBreath).toBeGreaterThan(steady.perBreath);
    expect(steady.perBreath).toBeGreaterThan(thrash.perBreath * 1.2);
    expect(steady.speed).toBeGreaterThan(0.6);
    expect(steady.speed).toBeLessThan(1.1);
  });
});

describe('the water', () => {
  it('visibility is the water\'s best when flat and its worst in a sea, and short at night', () => {
    expect(underwaterVisibility([12, 25], 0)).toBe(25);
    expect(underwaterVisibility([12, 25], 3)).toBe(12);
    expect(underwaterVisibility([12, 25], 0.75)).toBeCloseTo(18.5, 5);
    expect(underwaterVisibility([20, 30], 0, true)).toBeLessThan(15);
  });
  it('red goes first, then green, and blue lasts', () => {
    const [r, g, b] = lightAt(10);
    expect(r).toBeLessThan(0.1);
    expect(g).toBeGreaterThan(r * 5);
    expect(b).toBeGreaterThan(g);
    expect(lightAt(0)).toEqual([1, 1, 1]);
  });
  it('the surge is strong near the top in a swell and gone down deep, and nothing on flat water', () => {
    const top = Math.abs(surge(1.5, 10, 1, 2.5));
    expect(top).toBeGreaterThan(0.3);
    expect(Math.abs(surge(1.5, 10, 20, 2.5))).toBeLessThan(top * 0.6);
    expect(Math.abs(surge(1.5, 5, 20, 1.25))).toBeLessThan(0.05);
    expect(surge(0, 8, 2, 1)).toBe(0);
  });
  it('a pinnacle the chart cannot show still stands at its site, and land stays land', () => {
    const rock = catalina.sites.find((s) => s.id === 'ship-rock')!;
    const g = makeGround(catalina, rock, flat(63));
    expect(g.floor(rock.x, rock.y)).toBeLessThan(rock.depth[0] + 0.5);
    expect(g.floor(rock.x + rock.r * 0.9, rock.y)).toBeGreaterThan(14);
    expect(g.floor(rock.x + rock.r * 3, rock.y)).toBeGreaterThan(55);
    expect(makeGround(catalina, rock, flat(0)).floor(rock.x, rock.y)).toBe(0);
  });
  it('kelp grows on Catalina\'s rock and nowhere in the islands; coral the other way about', () => {
    const count = (file: DiveFile, id: string) => {
      const site = file.sites.find((s) => s.id === id)!;
      const g = makeGround(file, site, flat(12));
      let n = 0;
      for (let x = -40; x <= 40; x += 2.6) for (let y = -40; y <= 40; y += 2.6) if (g.grows(site.x + x, site.y + y)) n++;
      return { n, cover: g.cover };
    };
    const kelp = count(catalina, 'hen-rock');
    const coral = count(bvi, 'indians');
    expect(kelp.cover).toBe('kelp');
    expect(kelp.n).toBeGreaterThan(60);
    expect(coral.cover).toBe('coral');
    expect(coral.n).toBeGreaterThan(60);
    expect(makeGround(BARE, null, flat(10)).grows(3, 3)).toBe(false);
  });
});

describe('who lives where', () => {
  const site = catalina.sites.find((s) => s.id === 'bird-rock')!;
  const ground = makeGround(catalina, site, flat(23));
  const names = (list: Fish[]) => list.map((f) => `${f.species.id}:${f.cm}`);

  it('the same site at the same half hour holds the same fish, for anyone, wherever she went in', () => {
    const a = populate(catalina, ground, site.x, site.y, 12, conditions);
    const b = populate(catalina, ground, site.x, site.y, 12, conditions);
    const c = populate(catalina, ground, site.x + 25, site.y - 18, 12, conditions);
    expect(a.length).toBeGreaterThan(8);
    expect(b).toEqual(a);
    expect(names(c)).toEqual(names(a));
    expect(a.map((f) => f.index)).toEqual(a.map((_, i) => i));
  });

  it('another half hour, or another site, holds different fish', () => {
    const a = names(populate(catalina, ground, site.x, site.y, 12, conditions));
    expect(names(populate(catalina, ground, site.x, site.y, 13, conditions))).not.toEqual(a);
    const other = catalina.sites.find((s) => s.id === 'eagle-reef')!;
    expect(names(populate(catalina, makeGround(catalina, other, flat(23)), other.x, other.y, 12, conditions))).not.toEqual(a);
  });

  it('every size is inside its species\' range and every fish is in the water', () => {
    for (let shift = 0; shift < 40; shift++) {
      for (const f of populate(catalina, ground, site.x, site.y, shift, conditions)) {
        expect(f.cm).toBeGreaterThanOrEqual(f.species.size[0]);
        expect(f.cm).toBeLessThanOrEqual(f.species.size[1]);
        expect(f.d).toBeGreaterThan(0.5);
        expect(f.d).toBeLessThanOrEqual(ground.floor(f.x, f.y) + 0.01);
        expect(Math.hypot(f.x - site.x, f.y - site.y)).toBeLessThan(40);
      }
    }
  });

  it('halibut lie on sand, sheephead keep to rock, and white seabass are a dawn fish', () => {
    const torqua = catalina.sites.find((s) => s.id === 'torqua')!;
    const g = makeGround(catalina, torqua, flat(13));
    let halibut = 0;
    let onSand = 0;
    let dawn = 0;
    let day = 0;
    for (let shift = 0; shift < 120; shift++) {
      for (const f of populate(catalina, g, torqua.x, torqua.y, shift, conditions)) {
        if (f.species.id === 'halibut') { halibut++; if (g.rock(f.x, f.y) < 0.5) onSand++; expect(g.floor(f.x, f.y) - f.d).toBeLessThan(0.1); }
        if (f.species.id === 'sheephead') expect(g.floor(f.x, f.y) - f.d).toBeLessThan(1.6);
        if (f.species.id === 'seabass') day++;
      }
      for (const f of populate(catalina, g, torqua.x, torqua.y, shift, { night: false, dawn: true })) if (f.species.id === 'seabass') dawn++;
    }
    expect(halibut).toBeGreaterThan(30);
    expect(onSand / halibut).toBeGreaterThan(0.7);
    expect(dawn).toBeGreaterThan(day * 3);
  });

  it('away from any site the bottom is thinly peopled', () => {
    const bare = makeGround(catalina, null, flat(15));
    let total = 0;
    for (let shift = 0; shift < 30; shift++) total += populate(catalina, bare, 5000, 5000, shift, conditions).length;
    const rich = populate(catalina, ground, site.x, site.y, 3, conditions).length;
    expect(total / 30).toBeLessThan(rich / 2.5);
  });

  it('lobster are the same for everyone too, sit on rock, and come out at night', () => {
    const hen = catalina.sites.find((s) => s.id === 'hen-rock')!;
    const g = makeGround(catalina, hen, flat(12));
    const day = lobstersAt(catalina, g, hen.x, hen.y, 7, false);
    expect(day).toEqual(lobstersAt(catalina, g, hen.x, hen.y, 7, false));
    expect(day.length).toBeGreaterThan(1);
    for (const l of day) {
      expect(g.rock(l.x, l.y)).toBeGreaterThan(0.6);
      expect(l.out).toBe(false);
      expect(l.mm).toBeGreaterThanOrEqual(catalina.lobster!.sizeMm[0]);
      expect(l.mm).toBeLessThanOrEqual(catalina.lobster!.sizeMm[1]);
    }
    let out = 0;
    let n = 0;
    for (let shift = 0; shift < 40; shift++) for (const l of lobstersAt(catalina, g, hen.x, hen.y, shift, true)) { n++; if (l.out) out++; expect(l.deep).toBe(false); }
    expect(out / n).toBeGreaterThan(0.5);
    expect(lobstersAt(BARE, makeGround(BARE, null, flat(10)), 0, 0, 1, false)).toEqual([]);
  });

  it('some lobster are legal and some are short', () => {
    const hen = catalina.sites.find((s) => s.id === 'hen-rock')!;
    const g = makeGround(catalina, hen, flat(12));
    const sizes: number[] = [];
    for (let shift = 0; shift < 80; shift++) for (const l of lobstersAt(catalina, g, hen.x, hen.y, shift, true)) sizes.push(l.mm);
    const legal = sizes.filter((mm) => mm >= catalina.lobster!.minMm).length / sizes.length;
    expect(legal).toBeGreaterThan(0.2);
    expect(legal).toBeLessThan(0.7);
  });
});

describe('stalking', () => {
  const calico = species(catalina, 'calico');
  const seabass = species(catalina, 'seabass');
  const garibaldi = species(catalina, 'garibaldi');
  const f = fishAt(seabass, 0, 5, 6);

  it('swimming at a wary fish frightens it from further off than drifting toward it', () => {
    const fast = alarm(f, { ...still(0, 0, 6), vy: 1.1 }, false);
    const slow = alarm(f, { ...still(0, 0, 6), vy: 0.3 }, false);
    const lying = alarm(f, still(0, 0, 6), false);
    expect(fast).toBe(1);
    expect(slow).toBeLessThan(fast);
    expect(lying).toBeLessThan(slow);
    expect(lying).toBe(0);
  });

  it('from above, from behind, and from behind the kelp all let her closer', () => {
    const level = { ...still(0, 0.5, 6), vy: 0.3 };
    const base = alarm(f, level, false);
    expect(base).toBeGreaterThan(0.5);
    expect(alarm(f, { ...level, d: 4 }, false)).toBeLessThan(base);
    expect(alarm(f, level, true)).toBeLessThan(base);
    // The fish is heading north, away from a diver to the south of it.
    expect(alarm({ ...f, heading: 0 }, level, false)).toBeLessThan(alarm({ ...f, heading: Math.PI }, level, false));
  });

  it('a calico can be had by a slow approach, and never by a charge', () => {
    const fish = fishAt(calico, 0, 0, 6);
    const reachOf = (speed: number): number => {
      // The closest a diver gets, coming in at this speed, before the fish bolts.
      for (let y = -12; y < 0; y += 0.05) if (alarm(fish, { ...still(0, y, 6), vy: speed }, false) >= 1) return -y;
      return 0;
    };
    expect(reachOf(0.3)).toBeLessThan(GUN.effective);
    expect(reachOf(1.2)).toBeGreaterThan(GUN.effective + 0.5);
  });

  it('a bat ray lifts off the sand when she comes too close', () => {
    const ray = fishAt(species(catalina, 'batray'), 0, 1.2, 9.9, 100);
    for (let t = 0; t < 3; t += 0.05) stepFish(ray, { ...still(0, 0, 9.5), vy: 0.8 }, 0.05, t, flat(10), false);
    expect(ray.mode).toBe('bolt');
    expect(ray.d).toBeLessThan(9.6);
  });

  it('a garibaldi is afraid of nothing', () => {
    expect(alarm(fishAt(garibaldi, 0, 1, 5), { ...still(0, 0, 5), vy: 1.2 }, false)).toBe(0);
  });

  it('a miss empties the reef close by and leaves the far fish on edge, but not the bold ones', () => {
    const near = fishAt(calico, 3, 0, 6);
    const far = fishAt(calico, 12, 0, 6);
    const off = fishAt(calico, 40, 0, 6);
    const bold = fishAt(garibaldi, 2, 0, 6);
    expect(spook([near, far, off, bold], 0, 0, 6)).toBe(1);
    expect(near.fear).toBe(1);
    expect(far.fear).toBeGreaterThan(0.4);
    expect(far.fear).toBeLessThan(1);
    expect(off.fear).toBe(0);
    expect(bold.fear).toBe(0);
  });

  it('a charged fish bolts out of range and, if it is a wary one, out of sight', () => {
    const fish = fishAt(seabass, 0, 4, 6, 90);
    const diver = { ...still(0, 0, 6), vy: 1.2 };
    let gone = false;
    for (let t = 0; t < 8 && !gone; t += 0.05) { stepFish(fish, diver, 0.05, t, flat(12), false); gone = fish.mode === 'gone'; }
    expect(gone).toBe(true);
    expect(Math.hypot(fish.x, fish.y - 0)).toBeGreaterThan(GUN.max);
    // And it comes back to its ground once things have been quiet a while.
    for (let t = 0; t < 120; t += 0.5) stepFish(fish, still(200, 200, 2), 0.5, t, flat(12), false);
    expect(fish.mode).toBe('cruise');
  });

  it('yellowtail come in to look at a diver who lies still, and stay out from one who swims', () => {
    const yt = species(catalina, 'yellowtail');
    const closest = (diver: Diver): number => {
      const fish = fishAt(yt, 0, 11, 5, 80);
      let best = 99;
      for (let t = 0; t < 60; t += 0.05) { stepFish(fish, diver, 0.05, t, flat(15), false); best = Math.min(best, Math.hypot(fish.x - diver.x, fish.y - diver.y, fish.d - diver.d)); }
      return best;
    };
    expect(closest(still(0, 0, 5))).toBeLessThan(GUN.max);
    expect(closest({ ...still(0, 0, 5), vx: 0.9 })).toBeGreaterThan(GUN.max);
  });

  it('a fish stays in the water: under the surface and over the bottom', () => {
    const fish = fishAt(calico, 0, 3, 9.5);
    for (let t = 0; t < 30; t += 0.05) {
      stepFish(fish, { ...still(0, 0, 9), vy: 1.2 }, 0.05, t, flat(10), false);
      expect(fish.d).toBeLessThanOrEqual(10);
      expect(fish.d).toBeGreaterThanOrEqual(0.6);
    }
  });
});

describe('the speargun', () => {
  const calico = species(catalina, 'calico');
  const north = { x: 0, y: 1, d: 0 };
  const from = { x: 0, y: 0, d: 5 };

  it('hits a fish dead ahead inside the effective range', () => {
    const fish = fishAt(calico, 0, 3, 5);
    const shot = shoot(from, north, [fish]);
    expect(shot.hit).toBe(fish);
    expect(shot.range).toBeCloseTo(3, 5);
  });

  it('cannot reach past the end of the line, or behind her', () => {
    expect(shoot(from, north, [fishAt(calico, 0, GUN.max + 0.3, 5)]).hit).toBeNull();
    expect(shoot(from, north, [fishAt(calico, 0, -2, 5)]).hit).toBeNull();
  });

  it('misses by angle: the same fish half a metre off the line', () => {
    const shot = shoot(from, north, [fishAt(calico, 0.5, 3, 5)]);
    expect(shot.hit).toBeNull();
    expect(shot.near?.species.id).toBe('calico');
    // Aimed at it properly, it is hit.
    const l = Math.hypot(0.5, 3);
    expect(shoot(from, { x: 0.5 / l, y: 3 / l, d: 0 }, [fishAt(calico, 0.5, 3, 5)]).hit).not.toBeNull();
  });

  it('past the effective range the mark is half as wide', () => {
    const off = markRadius(40, 'bass') * 0.8;
    expect(shoot(from, north, [fishAt(calico, off, GUN.effective - 0.3, 5)]).hit).not.toBeNull();
    expect(shoot(from, north, [fishAt(calico, off, GUN.effective + 0.5, 5)]).hit).toBeNull();
  });

  it('a big fish is an easier mark than a small one, and the nearest fish on the line is the one hit', () => {
    expect(markRadius(100, 'jack')).toBeGreaterThan(markRadius(25, 'jack') * 1.8);
    const a = fishAt(calico, 0, 3.2, 5);
    const b = fishAt(calico, 0, 1.8, 5);
    expect(shoot(from, north, [a, b]).hit).toBe(b);
  });

  it('shoots down as well as along', () => {
    const fish = fishAt(species(catalina, 'halibut'), 0, 1, 8, 70);
    const l = Math.hypot(1, 3);
    expect(shoot(from, { x: 0, y: 1 / l, d: 3 / l }, [fish]).hit).toBe(fish);
  });

  it('stays on safe at the surface, in a reserve, at a lobster, with a fish on the shaft, and while loading', () => {
    const ready = { under: true, reload: 0, inHand: false, zone: null, atLobster: false };
    expect(canFire(ready).ok).toBe(true);
    expect(canFire({ ...ready, under: false }).ok).toBe(false);
    const casino = zoneAt(catalina, -2270, -22280)!;
    const reserve = canFire({ ...ready, zone: casino });
    expect(reserve.ok).toBe(false);
    expect(reserve.say).toMatch(/Casino Point is a no-take reserve/);
    const lobster = canFire({ ...ready, atLobster: true });
    expect(lobster.ok).toBe(false);
    expect(lobster.say).toMatch(/taken by hand/);
    expect(canFire({ ...ready, inHand: true }).ok).toBe(false);
    expect(canFire({ ...ready, reload: 2.2 }).say).toMatch(/3 s/);
    // And at the animals nobody hunts: a ray, a sleeping shark.
    const ray = canFire({ ...ready, spare: species(catalina, 'batray').spare });
    expect(ray.ok).toBe(false);
    expect(ray.say).toMatch(/bat ray/);
  });

  it('a strong fish runs longer the heavier it is, within reason', () => {
    expect(fightSeconds(12)).toBeGreaterThan(fightSeconds(3));
    expect(fightSeconds(60)).toBe(9);
    expect(fightSeconds(0.2)).toBe(3.5);
  });
});

describe('what becomes of a speared fish', () => {
  const calico = species(catalina, 'calico');
  const fish = (sp: DiveSpecies, cm: number) => ({ species: sp, cm, kg: sp.kgPerCm3 * cm ** 3 });

  it('a legal fish is kept, with points for a long shot and for the first of its kind', () => {
    const plain = judge(fish(calico, 40), 0, 1.5, false);
    expect(plain.keep).toBe(true);
    expect(plain.awards).toEqual([]);
    expect(plain.say).toMatch(/calico bass, 40 cm/);
    const good = judge(fish(calico, 40), 0, 3.2, true);
    expect(good.awards.map((a) => a.points)).toEqual([DIVE_POINTS.longShot, DIVE_POINTS.first]);
    expect(good.awards.every((a) => a.kind === 'dive')).toBe(true);
  });

  it('a garibaldi is a citation, is not kept, and costs real points', () => {
    const v = judge(fish(species(catalina, 'garibaldi'), 28), 0, 2, true);
    expect(v.keep).toBe(false);
    expect(v.why).toBe('protected');
    expect(v.say).toMatch(/state marine fish/);
    expect(v.say).toMatch(/citation/);
    expect(v.awards).toEqual([{ kind: 'lost', points: DIVE_POINTS.citation, label: 'Citation: garibaldi' }]);
    expect(DIVE_POINTS.citation).toBeLessThanOrEqual(-40);
  });

  it('so is a giant sea bass, a seal, a turtle, and a parrotfish in the islands', () => {
    expect(judge(fish(species(catalina, 'seal'), 150), 0, 2, false).why).toBe('protected');
    expect(judge(fish(species(bvi, 'turtle'), 80), 0, 2, false).why).toBe('protected');
    expect(judge(fish(species(catalina, 'gsb'), 180), 0, 2, false).why).toBe('protected');
    expect(judge(fish(species(bvi, 'parrotfish'), 40), 0, 2, false).why).toBe('protected');
  });

  it('a short fish cannot be put back, and one over the limit is over the limit', () => {
    const short = judge(fish(calico, calico.minCm! - 1), 0, 2, false);
    expect(short.keep).toBe(false);
    expect(short.why).toBe('short');
    expect(short.awards[0].points).toBe(DIVE_POINTS.short);
    expect(judge(fish(calico, calico.minCm!), 0, 2, false).keep).toBe(true);
    const over = judge(fish(calico, 45), calico.bag!, 2, false);
    expect(over.why).toBe('limit');
    expect(over.keep).toBe(false);
    expect(judge(fish(calico, 45), calico.bag! - 1, 2, false).keep).toBe(true);
  });

  it('a lionfish is a favour to the reef', () => {
    const v = judge(fish(species(bvi, 'lionfish'), 25), 0, 1, false);
    expect(v.keep).toBe(true);
    expect(v.why).toBe('encouraged');
    expect(v.awards[0].points).toBe(DIVE_POINTS.encouraged);
    expect(v.say).toMatch(/invader/);
  });
});

describe('lobster', () => {
  const rule = catalina.lobster!;
  // Facing north, out of its hole.
  const lobster = { x: 0, y: 0, d: 8, heading: 0, deep: false, mode: 'there' as const };

  it('the California season runs from October into March, over the new year, and July is shut', () => {
    expect(inSeason(rule.season, 7, 19)).toBe(false);
    expect(inSeason(rule.season, 9, 30)).toBe(false);
    expect(inSeason(rule.season, 10, 1)).toBe(true);
    expect(inSeason(rule.season, 12, 25)).toBe(true);
    expect(inSeason(rule.season, 1, 10)).toBe(true);
    expect(inSeason(rule.season, 3, 18)).toBe(true);
    expect(inSeason(rule.season, 3, 19)).toBe(false);
    // A window inside one year works too.
    expect(inSeason([{ from: '04-01', to: '06-30' }], 5, 5)).toBe(true);
    expect(inSeason([{ from: '04-01', to: '06-30' }], 7, 1)).toBe(false);
  });

  it('on Catalina\'s own day the diver is told the season is closed, and practice opens it for her alone', () => {
    const july = lobsterSeason(rule, 7, 19, false);
    expect(july.open).toBe(false);
    expect(july.say).toMatch(/closed on 19 July/);
    expect(july.say).toMatch(/early October/);
    const practice = lobsterSeason(rule, 7, 19, true);
    expect(practice.open).toBe(true);
    expect(practice.practice).toBe(true);
    expect(practice.say).toMatch(/Practice/);
    expect(practice.say).toMatch(/still 19 July/);
    const october = lobsterSeason(rule, 10, 20, true);
    expect(october.open).toBe(true);
    expect(october.practice).toBe(false);
    expect(rule.practice).toMatch(/October night/);
  });

  it('the islands\' season is open on their own day in February and shut in September', () => {
    expect(lobsterSeason(bvi.lobster!, 2, 9, false).open).toBe(true);
    expect(lobsterSeason(bvi.lobster!, 9, 9, false).open).toBe(false);
  });

  it('is pinned from the front, slowly', () => {
    expect(grab(lobster, still(0, 0.6, 8))).toBe('caught');
    expect(grab(lobster, still(0.4, 0.5, 8))).toBe('caught');
    expect(grab(lobster, still(0, 0.1, 7.5))).toBe('caught');
  });

  it('shoots off backwards from a hand that comes from the side or behind, or too fast', () => {
    expect(grab(lobster, still(0, -0.6, 8))).toBe('fled');
    expect(grab(lobster, still(0.7, -0.1, 8))).toBe('fled');
    expect(grab(lobster, { ...still(0, 0.6, 8), vy: -(GRAB.lunge + 0.2) })).toBe('fled');
  });

  it('cannot be reached from too far, or far back in its hole, or once it has gone', () => {
    expect(grab(lobster, still(0, GRAB.reach + 0.3, 8))).toBe('far');
    expect(grab({ ...lobster, deep: true }, still(0, 0.6, 8))).toBe('deep');
    expect(grab({ ...lobster, mode: 'fled' }, still(0, 0.6, 8))).toBe('far');
  });

  it('the gauge: short ones go back, legal ones are kept up to seven', () => {
    const short = gauge(rule.minMm - 1, rule, true, 0, null);
    expect(short.keep).toBe(false);
    expect(short.why).toBe('short');
    expect(short.say).toMatch(/short of 83 mm/);
    const legal = gauge(rule.minMm, rule, true, 0, null);
    expect(legal.keep).toBe(true);
    expect(legal.say).toMatch(/1 of 7/);
    expect(gauge(100, rule, true, 6, null).keep).toBe(true);
    const full = gauge(100, rule, true, 7, null);
    expect(full.keep).toBe(false);
    expect(full.why).toBe('limit');
    expect(rule.bag).toBe(7);
  });

  it('out of season every one goes back, and nothing leaves a reserve', () => {
    const closed = gauge(110, rule, false, 0, null);
    expect(closed.keep).toBe(false);
    expect(closed.why).toBe('closed');
    expect(closed.say).toMatch(/season is closed/);
    const reserve = gauge(110, rule, true, 0, zoneAt(catalina, -1650, -23020));
    expect(reserve.keep).toBe(false);
    expect(reserve.why).toBe('reserve');
    expect(reserve.say).toMatch(/Lover's Cove/);
  });
});

describe('other boats', () => {
  it('her flag goes out as two whole numbers and anything else is nobody', () => {
    expect(packDive(-8400.6, -9900.2)).toEqual([-8401, -9900]);
    expect(readDive([-8401, -9900])).toEqual({ x: -8401, y: -9900 });
    for (const bad of [null, undefined, 'x', [1], [1, 2, 3], [1, 'a'], [NaN, 2], [1e9, 0], { x: 1, y: 2 }]) expect(readDive(bad)).toBeNull();
  });
  it('a boat making way near a flag is told; one lying still or far off is not', () => {
    const flag = { x: 0, y: 0 };
    expect(diverNear({ x: 150, y: 0, sogKt: 5 }, flag)).toBe(true);
    expect(diverNear({ x: 150, y: 0, sogKt: 0.3 }, flag)).toBe(false);
    expect(diverNear({ x: FLAG.warn + 50, y: 0, sogKt: 5 }, flag)).toBe(false);
  });
  it('a vessel going over her fast sends her up; a slow one or a distant one does not', () => {
    const diver = { x: 0, y: 0 };
    const kt = 0.514444;
    expect(runOver(diver, [{ x: 10, y: 5, sog: 8 * kt }])).not.toBeNull();
    expect(runOver(diver, [{ x: 10, y: 5, sog: 2 * kt }])).toBeNull();
    expect(runOver(diver, [{ x: 80, y: 5, sog: 12 * kt }])).toBeNull();
  });
});

describe('the dive log', () => {
  it('keeps what is sound and drops what is not', () => {
    const log = cleanDiveLog({ dives: 3.7, deepest: 14.2, longest: 71, species: { calico: { name: 'calico bass', n: 2, best: 44, unit: 'cm' }, junk: { n: 'x' }, lobster: { name: 'lobster', n: 1, best: 88, unit: 'mm' } } });
    expect(log).toEqual({ dives: 3, deepest: 14.2, longest: 71, species: { calico: { name: 'calico bass', n: 2, best: 44, unit: 'cm' }, lobster: { name: 'lobster', n: 1, best: 88, unit: 'mm' } } });
    expect(cleanDiveLog('nonsense')).toEqual({ dives: 0, deepest: 0, longest: 0, species: {} });
    expect(cleanDiveLog({ deepest: -4, longest: Infinity, dives: NaN }).deepest).toBe(0);
  });
  it('names are numbers the hashes can use', () => {
    expect(nameKey('bird-rock')).toBe(nameKey('bird-rock'));
    expect(nameKey('bird-rock')).not.toBe(nameKey('ship-rock'));
  });
});
