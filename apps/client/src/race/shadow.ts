import type { EnvSample, Environment, SeaSample } from '@slack-tide/sim';

/**
 * Wind shadow: the bad air a boat under sail leaves to leeward of her. Pure: positions and wind in, a factor out.
 *
 * The numbers, as a racing sailor would give them:
 * - The shadow streams away from her along her APPARENT wind, not the true wind. The air her sails have used is carried
 *   off by the true wind while she sails on, so the lane of bad air trails aft of dead downwind: to leeward and astern
 *   of a boat going to windward, nearly dead ahead of one running.
 * - It is worst close under her lee: 35% of the wind speed gone out to two and a half boat lengths.
 * - From there it fades, quickly at first, to nothing at ten mast heights (about 160 m for the 38).
 * - It is narrow: 0.35 of her length either side of the line at the boat, opening by 12 cm for each metre downwind
 *   (about 7 degrees a side), strongest on the line and nothing at the edge.
 * - Several boats add up, each taking her share of what the others left, and all of them together never take more
 *   than half the wind.
 * - A boat with her sails stowed (at anchor, on a mooring, alongside) casts none.
 * - Only the speed of the wind changes. The header a real wind shadow brings with it is left out.
 */
export const SHADOW = {
  /** Share of the wind speed lost in the core. */
  peak: 0.35,
  /** The core runs this many of her boat lengths to leeward. */
  coreLengths: 2.5,
  /** Nothing is left this many of her mast heights to leeward. */
  reachMasts: 10,
  /** Half the width of the shadow at the boat, as a share of her length. */
  halfWidth: 0.35,
  /** Metres wider, each side, for each metre downwind. */
  spread: 0.12,
  /** The most that any number of boats can take, as a share of the wind speed. */
  cap: 0.5,
  /** The loss at which the player is told she is in bad air. */
  tell: 0.1,
} as const;

/** A boat that may be taking someone's wind. Sim coordinates: x east, y north, metres; speeds in m/s; angles compass radians. */
export interface ShadowSource {
  x: number;
  y: number;
  /** Speed and course over the ground. */
  sog: number;
  cog: number;
  /** Length overall and mast height, metres. */
  length: number;
  mast: number;
  /** False when her sails are stowed: at anchor, on a mooring, alongside. */
  sails: boolean;
}

export interface Shadow {
  /** What is left of the wind speed: 1 in clear air, never less than `1 - SHADOW.cap`. */
  factor: number;
  /** Index into the sources of the boat taking the most, or -1 in clear air. */
  by: number;
}

/** The share of the wind speed one boat takes at a point: 0 clear of her shadow, `SHADOW.peak` close under her lee. */
export function shadowOf(src: ShadowSource, x: number, y: number, windDir: number, windSpeed: number): number {
  if (!src.sails || !(windSpeed > 0.5)) return 0;
  // Her apparent wind, as the way the air goes relative to her: the true wind less her own velocity.
  const ax = -windSpeed * Math.sin(windDir) - src.sog * Math.sin(src.cog);
  const ay = -windSpeed * Math.cos(windDir) - src.sog * Math.cos(src.cog);
  const a = Math.hypot(ax, ay);
  if (a < 0.5) return 0;
  const ux = ax / a;
  const uy = ay / a;
  const rx = x - src.x;
  const ry = y - src.y;
  const along = rx * ux + ry * uy;
  const reach = SHADOW.reachMasts * src.mast;
  if (along <= 0 || along >= reach) return 0;
  const across = Math.abs(rx * uy - ry * ux);
  const width = SHADOW.halfWidth * src.length + SHADOW.spread * along;
  if (across >= width) return 0;
  const core = Math.min(SHADOW.coreLengths * src.length, reach * 0.6);
  const far = along <= core ? 1 : (1 - (along - core) / (reach - core)) ** 2;
  // Right alongside her the sails have not yet taken the wind: it comes on over the first half length.
  const near = Math.min(1, along / (0.5 * src.length));
  const q = across / width;
  return SHADOW.peak * far * near * (1 - q * q) ** 2;
}

/**
 * The wind left at a point with other boats about.
 * @param windDir where the true wind there blows from, compass radians
 * @param windSpeed its speed, m/s
 */
export function shadowAt(x: number, y: number, windDir: number, windSpeed: number, sources: readonly ShadowSource[]): Shadow {
  let left = 1;
  let worst = 0;
  let by = -1;
  for (let i = 0; i < sources.length; i++) {
    const loss = shadowOf(sources[i], x, y, windDir, windSpeed);
    if (loss <= 0) continue;
    left *= 1 - loss;
    if (loss > worst) {
      worst = loss;
      by = i;
    }
  }
  return { factor: Math.max(1 - SHADOW.cap, left), by };
}

/**
 * The world as one boat feels it: everything as it is, with the wind scaled by whatever shadow she is in.
 * This is what her sim is handed in place of the world itself, so the sim only ever sees a lighter wind.
 * `factor` is set from outside (`aboard/badair.ts`). At 1 the sample is the world's own, number for number.
 */
export class ShadedWind implements Environment {
  /** What is left of the wind speed, 1 in clear air. */
  factor = 1;
  private readonly out: EnvSample = { windDir: 0, windSpeed: 0, currentX: 0, currentY: 0 };

  constructor(private readonly base: Environment) {}

  sample(x: number, y: number, t: number): EnvSample {
    const e = this.base.sample(x, y, t);
    if (this.factor === 1) return e;
    // A copy: the world may hand out the same object every time.
    const o = this.out;
    o.windDir = e.windDir;
    o.windSpeed = e.windSpeed * this.factor;
    o.currentX = e.currentX;
    o.currentY = e.currentY;
    o.depth = e.depth;
    return o;
  }

  /** The sea is the world's own: a wind shadow does not flatten it. */
  sea(x: number, y: number, t: number): SeaSample | null | undefined {
    return this.base.sea?.(x, y, t);
  }
}

/** How quickly the wind a boat feels follows the shadow she is in, as the share of the gap closed over `dt` seconds. */
export function shadowEase(dt: number): number {
  return 1 - Math.exp(-dt / 1.2);
}
