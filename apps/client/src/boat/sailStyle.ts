/**
 * How a boat's sails look, as data: the cloth of the mainsail and jib, and the design of the spinnaker.
 * No drawing here (that is `sails.ts`), so tests can pin it.
 *
 * A style travels as one short string, `sailStyleCode(style)`: on the device, in the profile document and with the
 * boat to every other player. Whatever comes back, from storage or from another page, goes through `readSailStyle`,
 * which gives a whole, valid style for anything at all: unknown words fall back to the default, part by part.
 */

export interface ClothLook {
  id: string;
  name: string;
  /** The cloth itself, the alternate panels, the seams, the draft stripes and the sail number, as hex colours. */
  base: number;
  panel: number;
  seam: number;
  stripe: number;
  ink: number;
  /** How much light comes through from the far side: 1 for white dacron, almost none for carbon. */
  glow: number;
  /** How it is built, for the lines drawn on it: sewn cross-cut panels, or a film with fibres laid along the loads. */
  build: 'crosscut' | 'laminate' | 'fibre';
  /** A dark cloth: telltales and numbers are drawn pale on it. */
  dark: boolean;
}

/** Sailcloth for the main and the jib. The first is what every boat had before there was a choice. */
export const CLOTHS: ClothLook[] = [
  { id: 'dacron', name: 'White dacron', base: 0xf4f1e7, panel: 0xcdc8ba, seam: 0x787c80, stripe: 0x1f2a36, ink: 0x12233d, glow: 1, build: 'crosscut', dark: false },
  { id: 'cream', name: 'Cream', base: 0xeadfc0, panel: 0xcdbd96, seam: 0x857a5e, stripe: 0x4a3a24, ink: 0x3a2c1a, glow: 0.9, build: 'crosscut', dark: false },
  { id: 'laminate', name: 'Grey laminate', base: 0xc3c7c4, panel: 0xa9aeab, seam: 0x6c7274, stripe: 0x20262b, ink: 0x161b20, glow: 0.75, build: 'laminate', dark: false },
  { id: 'carbon', name: 'Black carbon', base: 0x24262a, panel: 0x34373c, seam: 0x6a6f76, stripe: 0xb9bec4, ink: 0xe6e8ea, glow: 0.12, build: 'fibre', dark: true },
  { id: 'tanbark', name: 'Tanbark', base: 0x8f3f29, panel: 0x74301f, seam: 0x4d2015, stripe: 0xe8d9bd, ink: 0xf0e4cc, glow: 0.5, build: 'crosscut', dark: true },
  { id: 'navy', name: 'Navy', base: 0x22365c, panel: 0x1a2a49, seam: 0x8a96ad, stripe: 0xd8dde6, ink: 0xe9edf3, glow: 0.3, build: 'crosscut', dark: true },
];

export interface KitePattern { id: string; name: string; /** How many of the three colours the design uses. */ colours: number }

/**
 * Spinnaker designs. Shapes only: bands, panels, a disc, a star. `hull` is the spinnaker every boat had before there
 * was a choice, in her own hull's colour, and takes no colours of its own.
 */
export const KITE_PATTERNS: KitePattern[] = [
  { id: 'hull', name: "In the boat's colour", colours: 0 },
  { id: 'solid', name: 'Solid', colours: 1 },
  { id: 'bands', name: 'Bands', colours: 3 },
  { id: 'panels', name: 'Panels', colours: 3 },
  { id: 'burst', name: 'Starburst', colours: 3 },
  { id: 'chevrons', name: 'Chevrons', colours: 3 },
  { id: 'halves', name: 'Two halves', colours: 3 },
  { id: 'triradial', name: 'Tri-radial', colours: 3 },
  { id: 'disc', name: 'Disc', colours: 3 },
  { id: 'star', name: 'Star', colours: 3 },
];

export interface KiteColour { name: string; hex: number }

export const KITE_COLOURS: KiteColour[] = [
  { name: 'Red', hex: 0xd8402f }, { name: 'Orange', hex: 0xf08a24 }, { name: 'Yellow', hex: 0xf2c81e }, { name: 'Green', hex: 0x2f9e58 },
  { name: 'Teal', hex: 0x1fa3a0 }, { name: 'Sky', hex: 0x4aa8e0 }, { name: 'Blue', hex: 0x2456c8 }, { name: 'Navy', hex: 0x1b2d4a },
  { name: 'Purple', hex: 0x7a4bc0 }, { name: 'Pink', hex: 0xe85a9b }, { name: 'White', hex: 0xf3f1ea }, { name: 'Black', hex: 0x1a1c20 },
];

export interface SailStyle {
  /** An id from CLOTHS. */
  cloth: string;
  kite: {
    /** An id from KITE_PATTERNS. */
    pattern: string;
    /** Three indexes into KITE_COLOURS: the main colour, the second, and the trim. */
    colours: [number, number, number];
  };
}

/** The sails as they have always been: white dacron, and a spinnaker in the hull's colour. */
export const DEFAULT_SAIL_STYLE: Readonly<SailStyle> = { cloth: 'dacron', kite: { pattern: 'hull', colours: [0, 10, 7] } };

const colour = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' && /^\d{1,2}$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < KITE_COLOURS.length ? n : fallback;
};
const word = (v: unknown, list: Array<{ id: string }>, fallback: string): string => (typeof v === 'string' && list.some((o) => o.id === v) ? v : fallback);

/** A whole style from anything: a code, an object with some of the fields, or rubbish. Never throws. */
export function readSailStyle(v: unknown): SailStyle {
  const d = DEFAULT_SAIL_STYLE;
  let cloth: unknown;
  let pattern: unknown;
  let colours: unknown[] = [];
  if (typeof v === 'string') {
    if (v.length <= 60) [cloth, pattern, ...colours] = v.split('.');
  } else if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    cloth = o.cloth;
    const k = o.kite && typeof o.kite === 'object' ? (o.kite as Record<string, unknown>) : {};
    pattern = k.pattern;
    if (Array.isArray(k.colours)) colours = k.colours;
  }
  return {
    cloth: word(cloth, CLOTHS, d.cloth),
    kite: {
      pattern: word(pattern, KITE_PATTERNS, d.kite.pattern),
      colours: [colour(colours[0], d.kite.colours[0]), colour(colours[1], d.kite.colours[1]), colour(colours[2], d.kite.colours[2])],
    },
  };
}

/** The style as one short string: "dacron.hull.0.10.7". */
export function sailStyleCode(s: SailStyle): string {
  return [s.cloth, s.kite.pattern, ...s.kite.colours].join('.');
}

/** The cloth a style names. */
export function clothOf(s: SailStyle | undefined): ClothLook {
  return CLOTHS.find((c) => c.id === s?.cloth) ?? CLOTHS[0];
}

/**
 * Which of the three colours a spinnaker design has at a point on the sail: 0, 1 or 2.
 * @param x across the sail in sail widths at the foot, 0 on the centreline, about -0.5 at the luff and 0.5 at the leech
 * @param y up the sail, 0 at the foot and 1 at the head
 * @param u share of the way from luff to leech at this height, 0 to 1
 * The sail narrows to the head, so `x` and `u` differ: designs that follow the cut of the cloth use `u`, shapes
 * that should look true on the flying sail (a disc, a star) use `x`.
 */
export function kiteColourAt(pattern: string, x: number, y: number, u: number): 0 | 1 | 2 {
  const band = (n: number): 0 | 1 | 2 => ((((Math.floor(n) % 3) + 3) % 3) as 0 | 1 | 2);
  switch (pattern) {
    case 'bands':
      return y > 0.68 ? 0 : y > 0.36 ? 1 : 2;
    case 'panels': {
      const gore = Math.floor(u * 6);
      return gore === 2 || gore === 3 ? 1 : gore === 0 || gore === 5 ? 2 : 0;
    }
    case 'burst': {
      // Rays fanning down from the head, and a cap in the trim colour.
      if (y > 0.86) return 2;
      const ray = Math.floor((Math.atan2(x, (1.02 - y) * 1.6) / Math.PI + 0.5) * 22);
      return ray % 2 === 0 ? 0 : 1;
    }
    case 'chevrons':
      return band((y + Math.abs(x) * 0.9) * 4.2);
    case 'halves':
      return y < 0.1 ? 2 : u < 0.5 ? 0 : 1;
    case 'triradial': {
      // A contrasting centre, held between a head panel and two clew panels as the real cut is.
      const cx = x / 0.36;
      const cy = (y - 0.46) / 0.2;
      const d = cx * cx + cy * cy;
      return d < 0.86 ? 1 : d < 1.12 ? 2 : 0;
    }
    case 'disc': {
      const d = Math.hypot(x, (y - 0.5) * 1.6);
      return d < 0.27 ? 1 : d < 0.305 ? 2 : 0;
    }
    case 'star': {
      // Five points, upright.
      const px = x;
      const py = (y - 0.5) * 1.6;
      const r = Math.hypot(px, py);
      const a = Math.atan2(px, py);
      const k = (Math.PI * 2) / 5;
      const m = ((a % k) + k) % k;
      const w = Math.min(m, k - m);
      // The edge of a star runs straight from a point (w = 0) to the notch beside it (w = 36 degrees).
      const R = 0.3;
      const notch = R * 0.42;
      const s36 = Math.sin(Math.PI / 5);
      const edge = (R * notch * s36) / (notch * Math.sin(Math.PI / 5 - w) + R * Math.sin(w));
      return r < edge ? 1 : r < 0.36 && r > 0.34 ? 2 : 0;
    }
    default:
      return 0;
  }
}

// ---- the player's own ------------------------------------------------------------------------------

const SAVED = 'regatta.sails';
let mine: SailStyle | null = null;
const watchers = new Set<(s: SailStyle) => void>();

/** This player's sails, as kept on this device. The default until they have chosen. */
export function mySailStyle(): SailStyle {
  if (!mine) {
    let kept: string | null = null;
    try {
      kept = localStorage.getItem(SAVED);
    } catch { /* nowhere to keep one */ }
    mine = readSailStyle(kept);
  }
  return mine;
}

/** The same as a code, for the boat's report and the profile document. */
export const mySailStyleCode = (): string => sailStyleCode(mySailStyle());

/** Change it: kept on this device and told to everything that flies it. */
export function saveSailStyle(s: SailStyle): void {
  mine = readSailStyle(s);
  try {
    localStorage.setItem(SAVED, sailStyleCode(mine));
  } catch { /* it lasts until the page closes */ }
  for (const w of watchers) w(mine);
}

/** Hear of every change. Returns the way to stop. */
export function onMySailStyle(fn: (s: SailStyle) => void): () => void {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}
