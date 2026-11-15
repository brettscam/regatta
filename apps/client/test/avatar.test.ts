import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR, HATS, OUTFITS, code, hatWorn, mateFor, randomAvatar, readAvatar } from '../src/boat/avatar';

/** A small fixed sequence standing in for chance. */
const dice = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

describe('avatar', () => {
  it('writes the default as a short code and reads it back', () => {
    const c = code(DEFAULT_AVATAR);
    expect(c).toBe('foulies.0.0.1.cap.0.short.0.none.shades.smile.2.2');
    expect(c.length).toBeLessThan(80);
    expect(readAvatar(c)).toEqual(DEFAULT_AVATAR);
  });

  it('gives the default for anything that is not an avatar', () => {
    for (const junk of [undefined, null, 7, '', 'x', {}, [], 'a'.repeat(5000), { outfit: 12, hat: {} }]) expect(readAvatar(junk)).toEqual(DEFAULT_AVATAR);
  });

  it('keeps the good parts of a code and drops the rest', () => {
    const a = readAvatar('pirate.99.-1.5.<script>.3.mohawk.1e3.bush.patch.grin.4.0.extra.words');
    expect(a).toEqual({ ...DEFAULT_AVATAR, outfit: 'pirate', skin: 5, hatShade: 3, hair: 'mohawk', beard: 'bush', specs: 'patch', face: 'grin', height: 4, girth: 0 });
  });

  it('reads an object with some of the fields', () => {
    expect(readAvatar({ outfit: 'aloha', height: 4, girth: 2.5, hat: 'crown' })).toEqual({ ...DEFAULT_AVATAR, outfit: 'aloha', height: 4 });
  });

  it('makes random avatars that are all valid, and of more than one kind', () => {
    const rand = dice(42);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const a = randomAvatar(rand);
      expect(readAvatar(code(a))).toEqual(a);
      seen.add(a.outfit);
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(OUTFITS.some((o) => seen.has(o.id))).toBe(true);
  });

  it('lets a costume bring its own hat', () => {
    expect(hatWorn({ ...DEFAULT_AVATAR, outfit: 'pirate', hat: 'beanie' })).toBe('tricorn');
    expect(hatWorn({ ...DEFAULT_AVATAR, hat: 'beanie' })).toBe('beanie');
    expect(HATS.some((h) => h.id === 'tricorn')).toBe(false);
  });

  it('keeps the hand in crew kit unless the skipper is in costume', () => {
    expect(mateFor(DEFAULT_AVATAR).outfit).toBe('own');
    expect(mateFor({ ...DEFAULT_AVATAR, outfit: 'pirate' }).outfit).toBe('pirate');
    expect(readAvatar(code(mateFor({ ...DEFAULT_AVATAR, outfit: 'santa' })))).toEqual(mateFor({ ...DEFAULT_AVATAR, outfit: 'santa' }));
  });
});
