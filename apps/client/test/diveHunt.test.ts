import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GUN, SHY, alarm, castOf, grab, lobsterShies, makeGround, populate, spook, stepFish,
  type DiveFile, type DiveSpecies, type Diver, type Fish, type Lobster,
} from '../src/aboard/diveRules';
import { LINE, THIEF, aimAt, boltholeOf, holdOf, huntAwards, leadCue, newFight, newThief, stepFight, strikeOf, targetsOfDive, thiefStep, type Fight } from '../src/aboard/diveHunt';
import { BUOY, CHASE, buoyancy, chaseLength, chaseReach, lockBreaks, lockCandidates, lookToward, nextLock, suitFor, type Lockable } from '../src/aboard/diveBody';
import { HAND, handTargetsAt, takeByHand, type HandThing } from '../src/aboard/diveHand';
import { member, slotOf, type SchoolState } from '../src/aboard/diveFlock';

const read = (water: string) => JSON.parse(readFileSync(new URL(`../../../courses/${water}/dives.json`, import.meta.url)).toString()) as DiveFile;
const catalina = read('catalina');
const bvi = read('bvi');
const species = (file: DiveFile, id: string): DiveSpecies => file.species.find((s) => s.id === id)!;
const still = (x: number, y: number, d: number): Diver => ({ x, y, d, vx: 0, vy: 0, vd: 0 });
const fishAt = (sp: DiveSpecies, x: number, y: number, d: number, cm = 40, heading = 0): Fish => ({
  index: 0, species: sp, cm, kg: sp.kgPerCm3 * cm ** 3, count: 1, x, y, d, hx: x, hy: y, hd: d, vx: 0, vy: 0, vd: 0, heading, mode: 'cruise', fear: 0, left: 0, phase: 0,
});
const flat = (depth: number) => () => depth;
const east = { x: 1, y: 0, d: 0 };
const site = (file: DiveFile, id: string) => file.sites.find((s) => s.id === id)!;

describe('buoyancy', () => {
  const suit = suitFor(19);
  it('she floats near the top, hangs neutral about ten metres down, and sinks below', () => {
    expect(buoyancy(0, suit)).toBeLessThan(-0.3);
    expect(buoyancy(3, suit)).toBeLessThan(0);
    expect(Math.abs(buoyancy(BUOY.neutral, suit))).toBeLessThan(1e-9);
    expect(buoyancy(20, suit)).toBeGreaterThan(0.05);
    // Deeper is always heavier.
    for (let d = 0; d < 30; d++) expect(buoyancy(d + 1, suit)).toBeGreaterThan(buoyancy(d, suit));
  });
  it('a rash vest in the tropics floats her less than a thick suit in a cold sea', () => {
    expect(suitFor(26)).toBeLessThan(suitFor(19));
    expect(buoyancy(0, suitFor(26))).toBeGreaterThan(buoyancy(0, suitFor(19)));
  });
});

describe('the shot', () => {
  const calico = species(catalina, 'calico');
  const yt = species(catalina, 'yellowtail');

  it('a fish holding broadside is a bigger mark than the same fish end-on', () => {
    // Side-on: it faces north and she shoots east at it, a little high of its middle.
    const side = fishAt(calico, 2.5, 0, 5, 50, 0);
    side.d = 5 - 0.08;
    expect(aimAt(still(0, 0, 5), east, [side]).hit).toBe(side);
    const end = fishAt(calico, 2.5, 0, 5, 50, Math.PI / 2);
    end.d = 5 - 0.08;
    expect(aimAt(still(0, 0, 5), east, [end]).hit).toBeNull();
  });

  it('a passing yellowtail aimed at is missed behind; led, it is hit', () => {
    const f = fishAt(yt, 3, 0, 5, 90, 0);
    f.vy = 1.8;
    f.vx = 0;
    // Its middle is where she aims, but by the time the shaft gets there it has gone on by most of a body.
    const dead = aimAt(still(0, 0, 5), east, [f]);
    expect(dead.hit === null || dead.spot < 0.3).toBe(true);
    const cue = leadCue(still(0, 0, 5), east, f);
    expect(cue.lead).toBeGreaterThan(0.2);
    expect(cue.ahead).toBeCloseTo(0, 5);
    // Aimed ahead by the lead, it takes it in the body.
    const a = Math.atan2(cue.lead, 3);
    const led = { x: Math.cos(a), y: Math.sin(a), d: 0 };
    const shot = aimAt(still(0, 0, 5), led, [f]);
    expect(shot.hit).toBe(f);
    expect(shot.spot).toBeGreaterThan(0.3);
    expect(leadCue(still(0, 0, 5), led, f).onTarget).toBe(true);
    expect(leadCue(still(0, 0, 5), led, f).ahead).toBeGreaterThan(0);
  });

  it('the bead says out of range beyond the effective range', () => {
    const f = fishAt(calico, GUN.effective + 0.6, 0, 5, 50, 0);
    expect(leadCue(still(0, 0, 5), east, f).inRange).toBe(false);
    expect(leadCue(still(0, 0, 5), east, f).onTarget).toBe(false);
  });

  it('just behind the eye, close and side-on, is a stone shot; the tail is a poor hold; the middle a fight', () => {
    expect(strikeOf({ spot: 0.8, off: 0.01, radius: 0.1, range: 2, side: 1 }, 3)).toBe('stone');
    expect(strikeOf({ spot: 0.8, off: 0.08, radius: 0.1, range: 2, side: 1 }, 3)).toBe('body');
    expect(strikeOf({ spot: 0.8, off: 0.01, radius: 0.1, range: 4, side: 1 }, 3)).toBe('body');
    expect(strikeOf({ spot: 0.5, off: 0.01, radius: 0.1, range: 2, side: 1 }, 3)).toBe('body');
    expect(strikeOf({ spot: 0.1, off: 0.01, radius: 0.1, range: 2, side: 1 }, 3)).toBe('tail');
  });

  it('a big fish asks a closer and squarer shot: from far or end-on the shaft tears out', () => {
    expect(holdOf(3, 2, 0.5, 1)).toBeGreaterThan(holdOf(20, 2, 0.5, 1));
    expect(holdOf(15, 2, 0.5, 1)).toBeGreaterThan(holdOf(15, 4.2, 0.5, 1));
    expect(holdOf(15, 2, 0.5, 1)).toBeGreaterThan(holdOf(15, 2, 0.5, 0.2));
    expect(strikeOf({ spot: 0.5, off: 0.02, radius: 0.12, range: 4.3, side: 0.3 }, 20)).toBe('torn');
    expect(strikeOf({ spot: 0.5, off: 0.02, radius: 0.12, range: 2, side: 1 }, 20)).toBe('body');
  });
});

describe('the fight on the line', () => {
  const play = (hauling: (f: Fight) => boolean, toward: 'kelp' | 'hole' | 'run', kg = 5, hold = 0.8): Fight => {
    const f = newFight(kg, hold, toward, 4, 0.37);
    for (let t = 0; t < 60 && !f.end; t += 0.05) stepFight(f, 0.05, hauling(f));
    return f;
  };
  it('hauling straight through its surges tears the shaft out', () => {
    expect(play(() => true, 'run', 8, 0.6).end).toBe('torn');
  });
  it('never hauling lets it wrap the line round the kelp, or hole up in the reef', () => {
    expect(play(() => false, 'kelp').end).toBe('wrapped');
    expect(play(() => false, 'hole').end).toBe('holed');
  });
  it('hauling between its surges and giving line in them lands it', () => {
    for (const toward of ['kelp', 'hole', 'run'] as const) {
      const f = play((g) => g.pull < g.strength * 0.6, toward);
      expect(f.end, toward).toBe('landed');
      expect(f.out).toBeLessThanOrEqual(LINE.landed);
    }
  });
  it('a kelp fish heads for the kelp and a reef fish for a hole, unless the data says', () => {
    expect(boltholeOf({ habitat: 'kelp' })).toBe('kelp');
    expect(boltholeOf({ habitat: 'reef' })).toBe('hole');
    expect(boltholeOf({ habitat: 'open' })).toBe('run');
    expect(boltholeOf(species(catalina, 'calico'))).toBe('kelp');
  });
  it('the same fight goes the same way every time', () => {
    const a = play((g) => g.pull < g.strength * 0.6, 'kelp');
    const b = play((g) => g.pull < g.strength * 0.6, 'kelp');
    expect(a).toEqual(b);
  });
});

describe('how each fish moves', () => {
  it('a halibut lies still until she is close, then lifts in silt and settles somewhere else', () => {
    const f = fishAt(species(catalina, 'halibut'), 0, 0.4, 9.94, 70);
    let lifted = false;
    let kicked = false;
    for (let t = 0; t < 4; t += 0.05) {
      stepFish(f, { ...still(0, 0, 9.6), vy: 0.6 }, 0.05, t, flat(10), false);
      if (f.mode === 'bolt') { lifted = true; if (f.d < 9.8) kicked = true; }
    }
    expect(lifted).toBe(true);
    expect(kicked).toBe(true);
    expect(f.kicked).toBe(1);
    for (let t = 0; t < 20; t += 0.05) stepFish(f, still(-30, -30, 2), 0.05, t, flat(10), false);
    expect(f.mode).toBe('cruise');
    expect(Math.hypot(f.hx, f.hy - 0.4)).toBeGreaterThan(2);
    expect(f.d).toBeGreaterThan(9.8);
  });

  it('a bonito streaks straight through and comes round again', () => {
    const f = fishAt(species(catalina, 'bonito'), 0, 0, 3, 60);
    f.phase = Math.PI / 2;
    let far = 0;
    let back = false;
    for (let t = 0; t < 60; t += 0.05) {
      stepFish(f, still(0, -40, 3), 0.05, t, flat(20), false);
      far = Math.max(far, f.x);
      if (far > 30 && f.x < 0) back = true;
    }
    expect(far).toBeGreaterThan(30);
    expect(back).toBe(true);
  });

  it('a blue shark circles at the edge of what she can see and never comes closer', () => {
    const sp = species(catalina, 'blueshark');
    const f = fishAt(sp, 0, 25, 6, 220);
    for (let t = 0; t < 120; t += 0.05) {
      stepFish(f, { ...still(0, 0, 6), vy: 0.8 * Math.sin(t) }, 0.05, t, flat(30), false);
      expect(Math.hypot(f.x, f.y)).toBeGreaterThan(sp.keepOff! - 1);
    }
    expect(sp.spare).toBeTruthy();
  });

  it('a sea lion loops round her and rolls as it goes', () => {
    const f = fishAt(species(catalina, 'sealion'), 0, 6, 5, 190);
    let rolled = 0;
    for (let t = 0; t < 10; t += 0.05) { stepFish(f, still(0, 0, 5), 0.05, t, flat(20), false); rolled = Math.max(rolled, f.roll ?? 0); }
    expect(rolled).toBeGreaterThan(1);
    expect(Math.hypot(f.x, f.y)).toBeLessThan(8);
  });

  it('once spooked, a fish keeps her further off for a minute', () => {
    const f = fishAt(species(catalina, 'calico'), 0, 2.4, 5, 45);
    const near = still(0, 0, 5);
    const calm = alarm(f, near, false);
    spook([f], 0, 0, 5);
    expect(f.shy).toBe(SHY);
    expect(alarm(f, near, false)).toBeGreaterThan(calm);
    for (let t = 0; t < SHY + 5; t += 0.5) stepFish(f, still(100, 100, 2), 0.5, t, flat(10), false);
    expect(f.shy).toBe(0);
  });

  it('new kinds live where the data says: the sea lion at the outer rocks, whitefish everywhere', () => {
    expect(castOf(catalina, site(catalina, 'ship-rock')).map((s) => s.id)).toEqual(expect.arrayContaining(['sealion', 'yellowtail', 'whitefish', 'blueshark']));
    expect(castOf(catalina, site(catalina, 'lovers-cove')).map((s) => s.id)).not.toContain('blueshark');
    for (const file of [catalina, bvi]) for (const sp of file.species) if (Array.isArray(sp.sites)) for (const id of sp.sites) expect(file.sites.some((s) => s.id === id), `${sp.id} at ${id}`).toBe(true);
  });

  it('sheephead over the size are big males; a young garibaldi is a rare find', () => {
    const g = makeGround(catalina, site(catalina, 'hen-rock'), flat(12));
    let males = 0;
    let young = 0;
    let garibaldi = 0;
    for (let shift = 0; shift < 200; shift++) {
      for (const f of populate(catalina, g, site(catalina, 'hen-rock').x, site(catalina, 'hen-rock').y, shift, { night: false, dawn: false })) {
        if (f.species.id === 'sheephead') { expect(f.male).toBe(f.cm >= 46); if (f.male) males++; }
        if (f.species.id === 'garibaldi') { garibaldi++; if (f.young) young++; }
      }
    }
    expect(males).toBeGreaterThan(5);
    expect(young).toBeGreaterThan(0);
    expect(young / garibaldi).toBeLessThan(0.15);
  });

  it('a reef rarely looks empty: a good site holds dozens of animals', () => {
    for (const id of ['bird-rock', 'hen-rock', 'ship-rock']) {
      const s = site(catalina, id);
      const g = makeGround(catalina, s, flat(15));
      let n = 0;
      for (let shift = 0; shift < 20; shift++) for (const f of populate(catalina, g, s.x, s.y, shift, { night: false, dawn: false })) n += f.count;
      expect(n / 20, id).toBeGreaterThan(60);
    }
  });
});

describe('the target of the dive', () => {
  it('names only fish that are there, legal and fair game, true to the data', () => {
    for (const id of ['bird-rock', 'ship-rock', 'torqua', 'church-rock']) {
      const s = site(catalina, id);
      const g = makeGround(catalina, s, flat(15));
      for (let shift = 0; shift < 30; shift++) {
        const fish = populate(catalina, g, s.x, s.y, shift, { night: false, dawn: shift % 4 === 0 });
        const picks = targetsOfDive(fish, shift % 4 === 0);
        expect(picks.length).toBeLessThanOrEqual(2);
        const cast = castOf(catalina, s).map((sp) => sp.id);
        for (const p of picks) {
          const sp = species(catalina, p.id);
          expect(cast).toContain(p.id);
          expect(sp.protected ?? sp.spare ?? sp.bait).toBeFalsy();
          expect(fish.some((f) => f.species.id === p.id && f.cm >= (sp.minCm ?? 0))).toBe(true);
        }
        expect(targetsOfDive(fish, shift % 4 === 0)).toEqual(picks);
      }
    }
  });
  it('a kept target, a stone shot and a trophy are each worth more', () => {
    const sp = species(catalina, 'calico');
    const plain = huntAwards(sp, 40, 'body', false).reduce((a, b) => a + b.points, 0);
    expect(huntAwards(sp, 40, 'stone', false).reduce((a, b) => a + b.points, 0)).toBeGreaterThan(plain);
    expect(huntAwards(sp, 40, 'body', true).reduce((a, b) => a + b.points, 0)).toBeGreaterThan(plain);
    expect(huntAwards(sp, 58, 'body', false).reduce((a, b) => a + b.points, 0)).toBeGreaterThan(plain);
  });
});

describe('the stringer thief', () => {
  const run = (o: { onFloat?: number; fromBoat?: number; guard?: (t: number) => boolean; thief?: boolean }, seconds = 1800) => {
    const s = newThief();
    const log: Array<[number, string]> = [];
    for (let t = 0; t < seconds; t += 0.5) {
      const r = thiefStep(s, { onFloat: o.onFloat ?? 3, fromBoat: o.fromBoat ?? 60, guarding: o.guard?.(t) ?? false, thief: o.thief ?? true, key: 77, t, dt: 0.5 });
      if (r) log.push([t, r]);
    }
    return log;
  };
  it('nothing comes for an empty stringer, near the boat, or where no thief lives', () => {
    expect(run({ onFloat: 0 })).toEqual([]);
    expect(run({ fromBoat: 10 })).toEqual([]);
    expect(run({ thief: false })).toEqual([]);
  });
  it('it is seen first, then takes one if she does not go to the float; and only once a dive', () => {
    const log = run({});
    expect(log[0][1]).toBe('warn');
    const steal = log.find(([, r]) => r === 'steal')!;
    expect(steal[0] - log[0][0]).toBeGreaterThanOrEqual(THIEF.grace);
    expect(log.filter(([, r]) => r === 'steal').length).toBe(1);
  });
  it('staying by the float sees it off', () => {
    const log = run({ guard: () => true });
    expect(log.some(([, r]) => r === 'warn')).toBe(true);
    expect(log.some(([, r]) => r === 'steal')).toBe(false);
    expect(log.some(([, r]) => r === 'leave')).toBe(true);
  });
  it('is the same for the same site and time', () => {
    expect(run({})).toEqual(run({}));
  });
});

describe('schools', () => {
  const base = (o: Partial<SchoolState> = {}): SchoolState => ({ x: 0, y: 0, d: 6, heading: 0.4, turn: 0, spread: 2.5, tight: 0, threat: { x: 100, y: 100, d: 100, r: 0 }, ...o });
  const all = (s: SchoolState, t: number) => Array.from({ length: 200 }, (_, k) => member(slotOf(91, k), s, t, { x: 0, y: 0, d: 0, heading: 0 }));
  it('the same seed and time put every fish in the same place', () => {
    expect(all(base(), 12.5)).toEqual(all(base(), 12.5));
    expect(all(base(), 12.5)).not.toEqual(all(base(), 13));
  });
  it('a bait ball is tighter than an easy school', () => {
    const r = (list: Array<{ x: number; y: number; d: number }>) => list.reduce((a, m) => a + Math.hypot(m.x, m.y, m.d - 6), 0) / list.length;
    expect(r(all(base({ tight: 1 }), 3))).toBeLessThan(r(all(base(), 3)) * 0.6);
  });
  it('a hole opens round a diver in the middle of it', () => {
    for (const m of all(base({ threat: { x: 0.5, y: 0, d: 6, r: 1.5 } }), 7)) expect(Math.hypot(m.x - 0.5, m.y, m.d - 6)).toBeGreaterThan(1.49);
  });
  it('a turn runs through the school from the front: the back still faces the old way', () => {
    const s = base({ turn: 1, heading: 0 });
    const list = Array.from({ length: 200 }, (_, k) => [slotOf(91, k), member(slotOf(91, k), s, 0, { x: 0, y: 0, d: 0, heading: 0 })] as const);
    const front = list.filter(([sl]) => sl[0] > 0.8).map(([, m]) => m.heading);
    const back = list.filter(([sl]) => sl[0] < 0.2).map(([, m]) => m.heading);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(back)).toBeLessThan(avg(front) - 0.5);
  });
});

describe('by hand', () => {
  const hen = site(catalina, 'hen-rock');
  const g = makeGround(catalina, hen, flat(12));
  const things = handTargetsAt(catalina, g, hen.x, hen.y, 5);
  const one = (id: string): HandThing => things.find((t) => t.spec.id === id) ?? { index: 99, spec: catalina.hand!.find((h) => h.id === id)!, x: 0, y: 0, d: 10, cm: 12, heading: 0, mode: 'there' };
  const at = (t: HandThing, v = 0): Diver => ({ x: t.x + 0.5, y: t.y, d: t.d - 0.3, vx: v, vy: 0, vd: 0 });

  it('scallops and urchins on the rock, the same for everyone', () => {
    expect(things.length).toBeGreaterThan(5);
    expect(handTargetsAt(catalina, g, hen.x, hen.y, 5)).toEqual(things);
    for (const t of things) if (t.spec.on === 'rock') expect(g.rock(t.x, t.y)).toBeGreaterThan(0.55);
  });
  it('a scallop comes off the rock by hand, slowly, up to the bag', () => {
    const s = one('scallop');
    expect(takeByHand(s, at(s), 0, null, true).ok).toBe(true);
    expect(takeByHand(s, at(s), 0, null, true).awards.length).toBe(2);
    expect(takeByHand(s, at(s, 1), 0, null, false).why).toBe('fast');
    expect(takeByHand(s, { ...at(s), x: s.x + 2 }, 0, null, false).why).toBe('far');
    expect(takeByHand(s, at(s), 10, null, false).why).toBe('limit');
  });
  it('urchins have a bag of their own', () => {
    const u = one('urchin');
    expect(takeByHand(u, at(u), 34, null, false).ok).toBe(true);
    expect(takeByHand(u, at(u), 35, null, false).why).toBe('limit');
  });
  it('an abalone is to look at: taking it is a citation', () => {
    const a = one('abalone');
    const v = takeByHand(a, at(a), 0, null, true);
    expect(v.ok).toBe(false);
    expect(v.why).toBe('protected');
    expect(v.awards[0].points).toBeLessThan(0);
  });
  it('nothing comes out of a reserve, and a short conch stays on the sand', () => {
    const s = one('scallop');
    expect(takeByHand(s, at(s), 0, catalina.zones[0], false).why).toBe('reserve');
    const conch: HandThing = { index: 0, spec: bvi.hand![0], x: 0, y: 0, d: 8, cm: 15, heading: 0, mode: 'there' };
    expect(takeByHand(conch, at(conch), 0, null, false).why).toBe('short');
    expect(takeByHand({ ...conch, cm: 22 }, at(conch), 0, null, false).ok).toBe(true);
  });
  it('reach is arm\'s length', () => {
    expect(HAND.reach).toBeLessThan(1.2);
  });
});

describe('lobster in its hole', () => {
  const lob = (): Lobster => ({ index: 0, x: 0, y: 0, d: 8, heading: 0, mm: 90, deep: false, out: false, mode: 'there', left: 0, back: 0 });
  it('a hand from the side or coming fast sends it back out of reach', () => {
    const l = lob();
    for (let t = 0; t < 4; t += 0.1) lobsterShies(l, { x: 1.2, y: 0, d: 7.8, vx: -0.3, vy: 0, vd: 0 }, 0.1);
    expect(l.back!).toBeGreaterThan(0.6);
    expect(grab(l, { x: 0, y: 0.6, d: 7.8, vx: 0, vy: 0, vd: 0 })).toBe('deep');
  });
  it('a slow approach from in front keeps it at the mouth, and patience brings it forward', () => {
    const l = lob();
    for (let t = 0; t < 4; t += 0.1) lobsterShies(l, { x: 0, y: 1.5 - t * 0.2, d: 7.8, vx: 0, vy: -0.2, vd: 0 }, 0.1);
    expect(l.back!).toBeLessThan(0.3);
    expect(grab(l, { x: 0, y: 0.6, d: 7.8, vx: 0, vy: 0, vd: 0 })).toBe('caught');
    l.back = 0.7;
    for (let t = 0; t < 10; t += 0.1) lobsterShies(l, still(0, 1.4, 7.8), 0.1);
    expect(l.back!).toBeLessThan(0.6);
  });
});

describe('the view', () => {
  const things = (list: Array<Partial<Lockable> & { key: string; x: number; y: number }>): Lockable[] => list.map((t) => ({ d: 5, legal: true, live: true, ...t }));
  const eye = still(0, 0, 5);
  const ahead = { x: 0, y: 1, d: 0 };

  it('lock prefers what is legal and in front of her, and ignores what is behind or out of sight', () => {
    const list = things([
      { key: 'garibaldi', x: 0, y: 2.5, legal: false },
      { key: 'calico', x: 0.6, y: 3.5 },
      { key: 'behind', x: 0, y: -2 },
      { key: 'far', x: 0, y: 40 },
      { key: 'gone', x: 0, y: 3, live: false },
    ]);
    const c = lockCandidates(eye, ahead, list, 20);
    expect(c.map((t) => t.key)).toEqual(['calico', 'garibaldi']);
  });
  it('Q again moves to the next, and after the last lets go', () => {
    const c = things([{ key: 'a', x: 0, y: 2 }, { key: 'b', x: 0.5, y: 3 }]);
    expect(nextLock(null, c)?.key).toBe('a');
    expect(nextLock('a', c)?.key).toBe('b');
    expect(nextLock('b', c)).toBeNull();
    expect(nextLock('a', [])).toBeNull();
  });
  it('the lock breaks when it is gone, lost in the murk, or behind her', () => {
    const [t] = things([{ key: 'a', x: 0, y: 3 }]);
    expect(lockBreaks(eye, ahead, t, 20)).toBeNull();
    expect(lockBreaks(eye, ahead, { ...t, live: false }, 20)).toBe('gone');
    expect(lockBreaks(eye, ahead, { ...t, y: 30 }, 20)).toBe('far');
    expect(lockBreaks(eye, ahead, { ...t, y: -3 }, 20)).toBe('behind');
  });
  it('looking toward a locked thing points the way to it, plus any lead dialled in', () => {
    const l = lookToward(eye, { x: 3, y: 3, d: 5 });
    expect(l.yaw).toBeCloseTo(Math.PI / 4);
    expect(l.pitch).toBeCloseTo(0);
    expect(lookToward(eye, { x: 0, y: 3, d: 8 }).pitch).toBeLessThan(-0.5);
    expect(lookToward(eye, { x: 0, y: 3, d: 5 }, 0.2).yaw).toBeCloseTo(0.2);
  });
  it('the chase camera pulls in rather than go into the rock or the kelp', () => {
    const back = { x: 0, y: -0.96, d: -0.28 };
    // Open water: as far back as it likes.
    expect(chaseReach(eye, back, 3.5, () => false)).toBe(3.5);
    // A wall of rock two metres behind her.
    const wall = (x: number, y: number) => y < -2;
    const r = chaseReach(eye, back, 3.5, wall);
    expect(r).toBeLessThan(2);
    expect(r).toBeGreaterThanOrEqual(CHASE.least);
    // Kelp right behind her: never closer than the least.
    expect(chaseReach(eye, back, 3.5, () => true)).toBe(CHASE.least);
    // Down into the sand.
    expect(chaseReach(eye, { x: 0, y: -0.7, d: 0.7 }, 3.5, (_x, _y, d) => d > 6.2)).toBeLessThan(1.8);
  });
  it('the chase camera widens a little at speed', () => {
    expect(chaseLength(1.5)).toBeGreaterThan(chaseLength(0));
    expect(chaseLength(5)).toBeLessThan(chaseLength(0) + 1);
  });
});
