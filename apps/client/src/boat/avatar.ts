/**
 * The skipper's own figure, as data: a dozen short choices. No drawing here (that is `wardrobe.ts`), so tests can pin it.
 *
 * An avatar travels as one short string, `code(avatar)`: on the device, in the profile document and with the boat to
 * every other player. Whatever comes back, from storage or from another page, goes through `readAvatar`, which gives
 * a whole, valid avatar for anything at all: unknown words fall back to the default, part by part.
 */

export interface Option { id: string; name: string }
export interface Shade { name: string; hex: number }

/** Whole outfits. `own` wears the jacket and trousers colours chosen. Every other one overrides them. */
export const OUTFITS: Option[] = [
  { id: 'foulies', name: 'Foul-weather gear' },
  { id: 'own', name: 'Own colours' },
  { id: 'breton', name: 'Breton shirt' },
  { id: 'pirate', name: 'Pirate' },
  { id: 'aloha', name: 'Hawaiian shirt' },
  { id: 'wetsuit', name: 'Wetsuit' },
  { id: 'tux', name: 'Black tie' },
  { id: 'santa', name: 'Father Christmas' },
  { id: 'banana', name: 'Banana' },
  { id: 'lobster', name: 'Lobster' },
];
/** Outfits that bring their own headgear, which then wins over the hat chosen. */
export const OUTFIT_HATS: Record<string, string> = { pirate: 'tricorn', santa: 'santa', banana: 'peel', lobster: 'feelers', tux: 'topper' };

export const HATS: Option[] = [
  { id: 'none', name: 'Bare head' },
  { id: 'cap', name: 'Cap' },
  { id: 'beanie', name: 'Beanie' },
  { id: 'souwester', name: "Sou'wester" },
  { id: 'sun', name: 'Sun hat' },
  { id: 'captain', name: "Captain's cap" },
  { id: 'bucket', name: 'Bucket hat' },
  { id: 'viking', name: 'Horned helmet' },
];
export const HAIR: Option[] = [
  { id: 'short', name: 'Short' },
  { id: 'bald', name: 'Bald' },
  { id: 'crop', name: 'Cropped' },
  { id: 'long', name: 'Long' },
  { id: 'tail', name: 'Ponytail' },
  { id: 'bun', name: 'Bun' },
  { id: 'curls', name: 'Curls' },
  { id: 'mohawk', name: 'Mohawk' },
];
export const BEARDS: Option[] = [
  { id: 'none', name: 'Clean shaven' },
  { id: 'tash', name: 'Moustache' },
  { id: 'goatee', name: 'Goatee' },
  { id: 'beard', name: 'Beard' },
  { id: 'bush', name: 'Sea-dog beard' },
];
export const SPECS: Option[] = [
  { id: 'shades', name: 'Sunglasses' },
  { id: 'none', name: 'None' },
  { id: 'round', name: 'Round glasses' },
  { id: 'square', name: 'Square glasses' },
  { id: 'aviator', name: 'Aviators' },
  { id: 'patch', name: 'Eyepatch' },
];
export const FACES: Option[] = [
  { id: 'smile', name: 'Smile' },
  { id: 'grin', name: 'Grin' },
  { id: 'calm', name: 'Level' },
  { id: 'ooh', name: 'Whistling' },
  { id: 'grim', name: 'Grim' },
];
export const HEIGHTS: Option[] = [
  { id: '0', name: 'Short' }, { id: '1', name: 'Shortish' }, { id: '2', name: 'Middling' }, { id: '3', name: 'Tall' }, { id: '4', name: 'Very tall' },
];
export const GIRTHS: Option[] = [
  { id: '0', name: 'Wiry' }, { id: '1', name: 'Lean' }, { id: '2', name: 'Middling' }, { id: '3', name: 'Sturdy' }, { id: '4', name: 'Stout' },
];

export const JACKETS: Shade[] = [
  { name: 'Red', hex: 0xc2281d }, { name: 'Yellow', hex: 0xe3b21c }, { name: 'Orange', hex: 0xe0701c }, { name: 'Navy', hex: 0x1d2f55 },
  { name: 'Sky', hex: 0x3f8fc9 }, { name: 'Green', hex: 0x2f7d4d }, { name: 'White', hex: 0xe9e6dc }, { name: 'Charcoal', hex: 0x30343a },
  { name: 'Pink', hex: 0xd9608f }, { name: 'Purple', hex: 0x6b4aa3 },
];
export const TROUSERS: Shade[] = [
  { name: 'Slate', hex: 0x1f2630 }, { name: 'Charcoal', hex: 0x2b2f36 }, { name: 'Navy', hex: 0x1d2f55 }, { name: 'Khaki', hex: 0xb39b6b },
  { name: 'White', hex: 0xe6e3da }, { name: 'Red', hex: 0xa5271f }, { name: 'Yellow', hex: 0xd9a81c }, { name: 'Olive', hex: 0x55603a },
];
export const SKINS: Shade[] = [
  { name: 'Light', hex: 0xeac4a4 }, { name: 'Fair', hex: 0xc99a7a }, { name: 'Tan', hex: 0xb07c56 }, { name: 'Brown', hex: 0x8d5f43 }, { name: 'Deep', hex: 0x5c3b29 }, { name: 'Dark', hex: 0x3d2619 },
];
export const HAIR_SHADES: Shade[] = [
  { name: 'Brown', hex: 0x4a3222 }, { name: 'Black', hex: 0x17140f }, { name: 'Fair', hex: 0xcfa85a }, { name: 'Ginger', hex: 0xb5531f },
  { name: 'Grey', hex: 0x9a9a96 }, { name: 'White', hex: 0xe8e6de }, { name: 'Blue', hex: 0x2f6fd0 }, { name: 'Pink', hex: 0xe064a4 },
];
export const HAT_SHADES: Shade[] = [
  { name: 'Navy', hex: 0x1b2a4a }, { name: 'White', hex: 0xe9e6dc }, { name: 'Red', hex: 0xb5271d }, { name: 'Yellow', hex: 0xe3b21c },
  { name: 'Green', hex: 0x2f7d4d }, { name: 'Black', hex: 0x1a1c1f }, { name: 'Orange', hex: 0xe0701c }, { name: 'Pink', hex: 0xd9608f },
];

export interface Avatar {
  outfit: string;
  /** Indexes into JACKETS, TROUSERS, SKINS. */
  jacket: number;
  trousers: number;
  skin: number;
  hat: string;
  /** Index into HAT_SHADES. */
  hatShade: number;
  hair: string;
  /** Index into HAIR_SHADES. Facial hair is the same shade. */
  hairShade: number;
  beard: string;
  specs: string;
  face: string;
  /** 0 to 4, 2 is middling. */
  height: number;
  girth: number;
}

/** The skipper as she has always been: red jacket, dark trousers, navy cap, sunglasses. */
export const DEFAULT_AVATAR: Readonly<Avatar> = {
  outfit: 'foulies', jacket: 0, trousers: 0, skin: 1, hat: 'cap', hatShade: 0, hair: 'short', hairShade: 0, beard: 'none', specs: 'shades', face: 'smile', height: 2, girth: 2,
};
/** The hand on the cockpit seat: yellow jacket, white cap. */
export const MATE_AVATAR: Readonly<Avatar> = {
  outfit: 'own', jacket: 1, trousers: 1, skin: 3, hat: 'cap', hatShade: 1, hair: 'crop', hairShade: 1, beard: 'none', specs: 'shades', face: 'calm', height: 2, girth: 2,
};

/** The parts in the order they are written in a code. Each is a word from a list or an index below a length. */
const PARTS: Array<[keyof Avatar, Option[] | number]> = [
  ['outfit', OUTFITS], ['jacket', JACKETS.length], ['trousers', TROUSERS.length], ['skin', SKINS.length], ['hat', HATS], ['hatShade', HAT_SHADES.length],
  ['hair', HAIR], ['hairShade', HAIR_SHADES.length], ['beard', BEARDS], ['specs', SPECS], ['face', FACES], ['height', 5], ['girth', 5],
];

/** One part, checked: the value if it is one this game knows, else the default's. */
function part(key: keyof Avatar, allowed: Option[] | number, v: unknown): string | number {
  if (typeof allowed === 'number') {
    const n = typeof v === 'string' && /^\d{1,2}$/.test(v) ? Number(v) : v;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < allowed ? n : DEFAULT_AVATAR[key];
  }
  return typeof v === 'string' && allowed.some((o) => o.id === v) ? v : DEFAULT_AVATAR[key];
}

/** A whole avatar from anything: a code, an object with some of the fields, or rubbish. Never throws. */
export function readAvatar(v: unknown): Avatar {
  const out = { ...DEFAULT_AVATAR } as Record<keyof Avatar, string | number>;
  if (typeof v === 'string') {
    if (v.length > 120) return out as unknown as Avatar;
    const words = v.split('.');
    PARTS.forEach(([key, allowed], i) => { out[key] = part(key, allowed, words[i]); });
  } else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const [key, allowed] of PARTS) out[key] = part(key, allowed, o[key]);
  }
  return out as unknown as Avatar;
}

/** The avatar as one short string: "foulies.0.0.1.cap.0.short.0.none.shades.smile.2.2". */
export function code(a: Avatar): string {
  return PARTS.map(([key]) => String(a[key])).join('.');
}

/** The headgear actually worn: the outfit's own where it has one. */
export function hatWorn(a: Avatar): string {
  return OUTFIT_HATS[a.outfit] ?? a.hat;
}

/**
 * What the second hand wears beside this skipper: crew kit, but in on the joke when the skipper is in costume.
 */
export function mateFor(skipper: Avatar): Avatar {
  if (skipper.outfit === 'foulies' || skipper.outfit === 'own') return { ...MATE_AVATAR };
  // A lobster needs someone to cook it, and Father Christmas has help. The rest come as a pair.
  const outfit = skipper.outfit === 'santa' || skipper.outfit === 'tux' ? 'breton' : skipper.outfit;
  return { ...MATE_AVATAR, outfit, hat: outfit === 'breton' ? 'beanie' : MATE_AVATAR.hat, hatShade: 2 };
}

/**
 * A random avatar. `rand` gives numbers from 0 up to but not 1: the caller's, so a test can pin it.
 * Costumes come up about one time in three, so most surprises are a person and not a banana.
 */
export function randomAvatar(rand: () => number): Avatar {
  const pick = <T>(list: T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  const n = (len: number): number => Math.min(len - 1, Math.floor(rand() * len));
  const costume = rand() < 0.34;
  return {
    outfit: costume ? pick(OUTFITS.filter((o) => o.id !== 'own' && o.id !== 'foulies')).id : 'own',
    jacket: n(JACKETS.length), trousers: n(TROUSERS.length), skin: n(SKINS.length),
    hat: pick(HATS).id, hatShade: n(HAT_SHADES.length),
    hair: pick(HAIR).id, hairShade: n(HAIR_SHADES.length),
    beard: rand() < 0.55 ? 'none' : pick(BEARDS).id, specs: pick(SPECS).id, face: pick(FACES).id,
    height: n(5), girth: n(5),
  };
}

// ---- the player's own ------------------------------------------------------------------------------

const SAVED = 'regatta.avatar';
let mine: Avatar | null = null;
const watchers = new Set<(a: Avatar) => void>();

/** This player's avatar, as kept on this device. The default until they have made one. */
export function myAvatar(): Avatar {
  if (!mine) {
    let kept: string | null = null;
    try {
      kept = localStorage.getItem(SAVED);
    } catch { /* nowhere to keep one */ }
    mine = readAvatar(kept);
  }
  return mine;
}

/** The same as a code, for the boat's report and the profile document. */
export const myAvatarCode = (): string => code(myAvatar());

/** True once the player has made an avatar on this device. */
export function hasMyAvatar(): boolean {
  try {
    return localStorage.getItem(SAVED) !== null;
  } catch {
    return false;
  }
}

/** Change it: kept on this device and told to everything that wears it. */
export function setMyAvatar(a: Avatar): void {
  mine = readAvatar(a);
  try {
    localStorage.setItem(SAVED, code(mine));
  } catch { /* it lasts until the page closes */ }
  for (const w of watchers) w(mine);
}

/** Hear of every change. Returns the way to stop. */
export function onMyAvatar(fn: (a: Avatar) => void): () => void {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}
