import { describe, expect, it } from 'vitest';
import {
  CONTACT, ContactWatch, closingSpeed, damageNote, damageText, hitDamage, hitWord, mend, overlap, readDamage, type Hull,
} from '../src/aboard/contactRules';
import { COLLISION, POINTS, collisionAward } from '../src/xp/score';

const KT = 0.514444;
const DEG = Math.PI / 180;
/** A 38 ft sloop: 11.6 m by 3.8 m. */
const hull = (x: number, y: number, headingDeg = 0, length = 11.6, beam = 3.8): Hull => ({ x, y, heading: headingDeg * DEG, length, beam });
const R = 3.8 * CONTACT.radius;

describe('two hulls touching', () => {
  it('side by side, they touch at a beam apart, not at a boat length', () => {
    // Both heading north, abeam of each other.
    expect(overlap(hull(0, 0), hull(8, 0))).toBeNull();
    expect(overlap(hull(0, 0), hull(2 * R + 0.05, 0))).toBeNull();
    const o = overlap(hull(0, 0), hull(3, 0));
    expect(o).not.toBeNull();
    expect(o!.depth).toBeCloseTo(2 * R - 3, 9);
    expect(o!.nx).toBeCloseTo(1, 9);
    expect(o!.ny).toBeCloseTo(0, 9);
  });

  it('bow to stern, they touch at a boat length apart', () => {
    expect(overlap(hull(0, 0), hull(0, 11.7))).toBeNull();
    const o = overlap(hull(0, 0), hull(0, 11));
    expect(o!.depth).toBeCloseTo(0.6, 9);
    expect(o!.ny).toBeCloseTo(1, 9);
  });

  it('a circle of boat length would call these a hit; hull shapes do not', () => {
    // Passing 5 m apart on opposite headings, and crossing 8 m ahead of her bow.
    expect(overlap(hull(0, 0, 0), hull(5, 3, 180))).toBeNull();
    expect(overlap(hull(0, 0, 0), hull(0, 5.8 + 8, 90))).toBeNull();
  });

  it('a bow into another boat\'s side is a hit, with the push straight back along her own line', () => {
    // She heads east into the side of a boat heading north, her bow 0.5 m inside the other's skin.
    const other = hull(0, 0, 0);
    const me = hull(-(R + 5.8 - 0.5), 1, 90);
    const o = overlap(me, other);
    expect(o!.depth).toBeCloseTo(0.5, 6);
    expect(o!.nx).toBeCloseTo(1, 6);
    expect(Math.abs(o!.ny)).toBeLessThan(1e-6);
  });

  it('forgives the slop it is told to', () => {
    const a = hull(0, 0);
    const b = hull(2 * R - 0.3, 0);
    expect(overlap(a, b, CONTACT.slopLocal)!.depth).toBeCloseTo(0.2, 9);
    expect(overlap(a, b, CONTACT.slopRemote)).toBeNull();
  });

  it('the normal always points from the first hull to the second, whichever way they lie', () => {
    for (const [x, y, h] of [[3, 1, 30], [-3, -1, 200], [1, 7, 75], [-2, -7, 300], [2.5, 0.2, 180]] as const) {
      const a = hull(0, 0, 15);
      const b = hull(x, y, h);
      const o = overlap(a, b);
      expect(o, `${x},${y},${h}`).not.toBeNull();
      expect(Math.hypot(o!.nx, o!.ny)).toBeCloseTo(1, 9);
      // Moving the first hull back along the normal by the depth parts them.
      const clear = overlap({ ...a, x: a.x - o!.nx * (o!.depth + 0.01), y: a.y - o!.ny * (o!.depth + 0.01) }, b);
      expect(clear, `${x},${y},${h}`).toBeNull();
      const back = overlap(b, a)!;
      expect(back.nx).toBeCloseTo(-o!.nx, 6);
      expect(back.ny).toBeCloseTo(-o!.ny, 6);
    }
  });

  it('centrelines that cross still give a way out', () => {
    const o = overlap(hull(0, 0, 0), hull(0.5, 0, 90));
    expect(o).not.toBeNull();
    expect(Number.isFinite(o!.nx + o!.ny + o!.depth)).toBe(true);
    expect(Math.hypot(o!.nx, o!.ny)).toBeCloseTo(1, 9);
    expect(o!.depth).toBeGreaterThan(0);
  });

  it('a yacht against a ship uses the ship\'s length and beam', () => {
    const ship = hull(0, 0, 90, 200, 30);
    // 80 m along her from amidships and 12 m off her centreline: inside her side.
    expect(overlap(hull(80, 12, 0), ship)).not.toBeNull();
    // Off her bow by 20 m: clear.
    expect(overlap(hull(126, 0, 0), ship)).toBeNull();
    expect(overlap(hull(80, 22, 90), ship)).toBeNull();
  });
});

describe('closing speed', () => {
  it('is what the two make toward each other along the line between them', () => {
    // She goes east at 3 m/s at a boat lying to the east of her.
    expect(closingSpeed(3, 0, 0, 0, 1, 0)).toBeCloseTo(3, 12);
    // Head on at 3 and 2.
    expect(closingSpeed(3, 0, -2, 0, 1, 0)).toBeCloseTo(5, 12);
    // Overtaken from astern: the other boat comes up at 4 on her 3.
    expect(closingSpeed(0, 3, 0, 4, 0, -1)).toBeCloseTo(1, 12);
    // Sailing side by side at the same speed, or parting: nothing.
    expect(closingSpeed(0, 3, 0, 3, 1, 0)).toBeCloseTo(0, 12);
    expect(closingSpeed(-1, 0, 0, 0, 1, 0)).toBeLessThan(0);
  });
});

describe('damage from a hit', () => {
  const at = (kt: number, heavy = false, fault = 1) => hitDamage(kt * KT, heavy, fault);

  it('grows with closing speed: a nudge is a scuff, six knots is severe', () => {
    expect(at(0.2)).toBe(0);
    expect(at(1)).toBeCloseTo(0.03, 6);
    expect(at(2)).toBeCloseTo(0.09, 6);
    expect(at(4)).toBeCloseTo(0.3, 6);
    expect(at(6)).toBeCloseTo(0.63, 6);
    expect(at(8)).toBe(1);
    for (let v = 0.5; v < 7.5; v += 0.5) expect(at(v + 0.5)).toBeGreaterThan(at(v));
  });

  it('a parting touch, or nonsense, does none', () => {
    expect(at(-3)).toBe(0);
    expect(hitDamage(Number.NaN)).toBe(0);
  });

  it('a ship does half as much again', () => {
    expect(at(4, true)).toBeCloseTo(0.45, 6);
  });

  it('fault scales it, for when there are rules', () => {
    expect(at(4, false, 0)).toBe(0);
    expect(at(4, false, 2)).toBeCloseTo(0.6, 6);
    expect(at(4, false, -1)).toBe(0);
  });

  it('has a word for how hard it was', () => {
    expect(hitWord(0)).toBe('Touched');
    expect(hitWord(at(1))).toBe('Scraped');
    expect(hitWord(at(2.5))).toBe('Bumped');
    expect(hitWord(at(4))).toBe('Hit');
    expect(hitWord(at(6))).toBe('Rammed');
  });
});

describe('one contact is one hit', () => {
  it('grinding along another hull counts once', () => {
    const w = new ContactWatch();
    expect(w.touch('a', 10, 2)).toEqual({ id: 'a', closing: 2 });
    for (let t = 10; t < 40; t += 1 / 60) expect(w.touch('a', t, 2)).toBeNull();
    expect(w.touching('a', 40.5)).toBe(true);
  });

  it('a bounce within two seconds is the same hit; coming back later is another', () => {
    const w = new ContactWatch();
    expect(w.touch('a', 0, 3)).not.toBeNull();
    expect(w.touch('a', 1.5, 3)).toBeNull();
    expect(w.touch('a', 3, 3)).toBeNull();
    expect(w.touching('a', 3 + CONTACT.clear + 0.1)).toBe(false);
    expect(w.touch('a', 3 + CONTACT.clear + 0.1, 1)).toEqual({ id: 'a', closing: 1 });
  });

  it('each vessel is its own contact', () => {
    const w = new ContactWatch();
    expect(w.touch('a', 0, 3)).not.toBeNull();
    expect(w.touch('b', 0.1, 3)).not.toBeNull();
    expect(w.touch('a', 0.2, 3)).toBeNull();
  });

  it('a hull pushed into her from astern while she is parting still counts, at no speed', () => {
    expect(new ContactWatch().touch('a', 0, -1)).toEqual({ id: 'a', closing: 0 });
  });

  it('forgets old contacts, and everything if the clock goes back', () => {
    const w = new ContactWatch();
    w.touch('a', 100, 1);
    w.tidy(120);
    expect(w.touching('a', 101)).toBe(true);
    w.tidy(140);
    expect(w.touching('a', 101)).toBe(false);
    w.touch('b', 500, 1);
    expect(w.touch('b', 20, 1)).not.toBeNull();
  });
});

describe('mending', () => {
  it('a dock mends a wrecked hull in forty seconds, in a race or out of one', () => {
    let d = 0.99;
    for (let i = 0; i < 40 * 60; i++) d = mend(d, 1 / 60, 'dock', true);
    expect(d).toBe(0);
    expect(mend(0.5, 10, 'dock', false)).toBeCloseTo(0.25, 9);
  });

  it('at anchor or on a mooring it takes ten minutes, and not during a race', () => {
    expect(mend(0.5, 60, 'held', false)).toBeCloseTo(0.4, 9);
    expect(mend(0.5, 60, 'held', true)).toBe(0.5);
  });

  it('nothing mends under way, a holed boat is past patching, and a sound one stays sound', () => {
    expect(mend(0.5, 60, 'none', false)).toBe(0.5);
    expect(mend(1, 60, 'dock', false)).toBe(1);
    expect(mend(0, 60, 'dock', false)).toBe(0);
    expect(mend(Number.NaN, 60, 'dock', false)).toBe(0);
  });
});

describe('how it is told', () => {
  it('the readout gives the damage and what it costs', () => {
    expect(damageText(0.35, 0.89)).toBe('35% · 11% slower');
    expect(damageText(0.002, 1)).toBe('1% · 0% slower');
    expect(damageText(1, 0)).toBe('Holed');
  });

  it('another boat\'s word for her damage is checked before it is used', () => {
    expect(readDamage(35)).toBe(35);
    expect(readDamage(35.4)).toBe(35);
    expect(readDamage(900)).toBe(100);
    expect(readDamage(-4)).toBe(0);
    expect(readDamage('100')).toBe(0);
    expect(readDamage(Number.NaN)).toBe(0);
    expect(readDamage(Infinity)).toBe(0);
    expect(readDamage(undefined)).toBe(0);
    expect(readDamage({ valueOf: () => 50 })).toBe(0);
  });

  it('the fleet panel says nothing of a sound hull', () => {
    expect(damageNote(0)).toBe('');
    expect(damageNote(35)).toBe('hull 35% damaged');
    expect(damageNote(100)).toBe('holed, retired');
  });
});

describe('what a collision costs in points', () => {
  it('a touch under a knot is free', () => {
    expect(collisionAward(0.6, 1e9)).toBeNull();
  });

  it('a collision costs a little, and not again inside a minute', () => {
    expect(collisionAward(3, 1e9)).toEqual({ kind: 'lost', points: POINTS.collision, label: 'Collision' });
    expect(collisionAward(3, COLLISION.cooldown - 1)).toBeNull();
    expect(collisionAward(3, COLLISION.cooldown)).not.toBeNull();
    expect(POINTS.collision).toBeLessThan(0);
  });

  it('being holed costs more, whenever it happens', () => {
    expect(collisionAward(7, 5, true)).toEqual({ kind: 'lost', points: POINTS.holed, label: 'Holed' });
    expect(POINTS.holed).toBeLessThan(POINTS.collision);
  });
});
