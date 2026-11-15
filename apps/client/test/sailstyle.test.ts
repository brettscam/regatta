import { describe, expect, it } from 'vitest';
import { CLOTHS, DEFAULT_SAIL_STYLE, KITE_COLOURS, KITE_PATTERNS, clothOf, kiteColourAt, readSailStyle, sailStyleCode } from '../src/boat/sailStyle';

describe('sail style', () => {
  it('writes the default as a short code and reads it back', () => {
    const c = sailStyleCode(DEFAULT_SAIL_STYLE);
    expect(c).toBe('dacron.hull.0.10.7');
    expect(readSailStyle(c)).toEqual(DEFAULT_SAIL_STYLE);
  });

  it('gives the default for anything that is not a style', () => {
    for (const junk of [undefined, null, 7, '', 'x', {}, [], 'a.'.repeat(4000), { cloth: 12, kite: 'red' }, { kite: { colours: 'abc' } }]) {
      expect(readSailStyle(junk)).toEqual(DEFAULT_SAIL_STYLE);
    }
  });

  it('keeps the good parts of a code and drops the rest', () => {
    expect(readSailStyle('carbon.<script>.3.99.-1.extra')).toEqual({ cloth: 'carbon', kite: { pattern: 'hull', colours: [3, 10, 7] } });
    expect(readSailStyle('silk.star.11.1e3.2')).toEqual({ cloth: 'dacron', kite: { pattern: 'star', colours: [11, 10, 2] } });
  });

  it('reads an object with some of the fields, and never keeps what it was handed', () => {
    const given = { cloth: 'tanbark', kite: { pattern: 'disc', colours: [2, 4.5, 'x', 9] } };
    const s = readSailStyle(given);
    expect(s).toEqual({ cloth: 'tanbark', kite: { pattern: 'disc', colours: [2, 10, 7] } });
    expect(s.kite.colours).not.toBe(given.kite.colours);
  });

  it('round-trips every cloth and every design', () => {
    for (const cloth of CLOTHS) for (const p of KITE_PATTERNS) {
      const s = { cloth: cloth.id, kite: { pattern: p.id, colours: [5, 0, 11] as [number, number, number] } };
      expect(readSailStyle(sailStyleCode(s))).toEqual(s);
      expect(sailStyleCode(s).length).toBeLessThan(40);
    }
    expect(clothOf(undefined).id).toBe('dacron');
    expect(clothOf({ ...DEFAULT_SAIL_STYLE, cloth: 'navy' }).dark).toBe(true);
  });

  it('offers the looks and colours the profile lists', () => {
    expect(CLOTHS.map((c) => c.id)).toEqual(['dacron', 'cream', 'laminate', 'carbon', 'tanbark', 'navy']);
    expect(KITE_PATTERNS.length).toBe(10);
    expect(KITE_COLOURS.length).toBe(12);
  });

  it('draws each design with the colours it says it uses, and only those', () => {
    for (const p of KITE_PATTERNS) {
      const seen = new Set<number>();
      for (let j = 0; j <= 60; j++) for (let i = 0; i <= 40; i++) {
        const y = j / 60;
        const u = i / 40;
        const c = kiteColourAt(p.id, (u - 0.5) * Math.min(1, 1.25 * Math.pow(1 - y, 0.6)), y, u);
        expect([0, 1, 2]).toContain(c);
        seen.add(c);
      }
      expect(seen.size).toBe(Math.max(1, p.colours));
    }
  });

  it('puts the disc and the star in the middle of the sail', () => {
    expect(kiteColourAt('disc', 0, 0.5, 0.5)).toBe(1);
    expect(kiteColourAt('disc', 0.45, 0.5, 0.95)).toBe(0);
    expect(kiteColourAt('star', 0, 0.5, 0.5)).toBe(1);
    // A point of the star reaches straight up; the notch beside it does not reach as far.
    expect(kiteColourAt('star', 0, 0.5 + 0.28 / 1.6, 0.5)).toBe(1);
    const notch = Math.PI / 5;
    expect(kiteColourAt('star', Math.sin(notch) * 0.2, 0.5 + (Math.cos(notch) * 0.2) / 1.6, 0.6)).toBe(0);
  });
});
