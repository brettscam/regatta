import { roll } from './gunnery';
import { ARTIFACTS, GOODS, type Artifact, type Lane, type Port, type ShipClass } from './tables';

// What is in a prize, what it sells for, and what a port charges. Pure, seeded with hashes.

export type Hold = Record<string, number>;

export interface Prize {
  coin: number;
  /** Tons of each good. */
  cargo: Hold;
  artifact: Artifact | null;
  /** Men of her crew who will sign the articles. */
  volunteers: number;
}

const pick = <T>(weights: Array<[T, number]>, r: number): T => {
  const total = weights.reduce((s, w) => s + w[1], 0);
  let at = r * total;
  for (const [v, w] of weights) {
    at -= w;
    if (at < 0) return v;
  }
  return weights[weights.length - 1][0];
};

export const pickWeighted = pick;

/**
 * What a ship of this class on this lane carries.
 * @param seed the ship's own number, so the same ship always carries the same
 * @param owned artifacts already in the cabinet, which do not turn up twice
 */
export function prizeContents(cls: ShipClass, lane: Pick<Lane, 'cargo'>, seed: number, owned: readonly string[] = []): Prize {
  const coin = Math.round(cls.coin[0] + (cls.coin[1] - cls.coin[0]) * Math.pow(roll(seed, 1, 21), 1.6));
  const cargo: Hold = {};
  if (lane.cargo.length) {
    // Two or three sorts of goods, filling from half to nearly all of her hold.
    const tons = cls.cargoTons * (0.5 + 0.45 * roll(seed, 2, 21));
    const sorts = 2 + Math.floor(roll(seed, 3, 21) * 2);
    let left = tons;
    for (let i = 0; i < sorts && left > 0.5; i++) {
      const good = pick(lane.cargo, roll(seed, 4 + i, 21));
      const take = i === sorts - 1 ? left : left * (0.4 + 0.4 * roll(seed, 8 + i, 21));
      // Plate is never carried by the hundred ton.
      const t = Math.round(good === 'silver' ? Math.min(take, 4 + 8 * roll(seed, 12, 21)) : take);
      cargo[good] = (cargo[good] ?? 0) + t;
      left -= take;
    }
  }
  const free = ARTIFACTS.filter((a) => !owned.includes(a.id));
  const artifact = free.length && roll(seed, 5, 22) < cls.artifactChance ? free[Math.floor(roll(seed, 6, 22) * free.length)] : null;
  const volunteers = cls.kind === 'warship' ? 0 : Math.floor(cls.crew * 0.25 * roll(seed, 7, 22));
  return { coin, cargo, artifact, volunteers };
}

export function holdTons(hold: Hold): number {
  return Object.values(hold).reduce((s, t) => s + t, 0);
}

/** Move what will fit from a prize's hold into her own, the dearest first. Returns what was taken. */
export function stow(own: Hold, room: number, prize: Hold): Hold {
  const taken: Hold = {};
  const dearest = Object.keys(prize).sort((a, b) => plainPrice(b) - plainPrice(a));
  let space = room - holdTons(own);
  for (const good of dearest) {
    const t = Math.min(prize[good], Math.max(0, Math.floor(space)));
    if (t <= 0) continue;
    own[good] = (own[good] ?? 0) + t;
    taken[good] = t;
    space -= t;
  }
  return taken;
}

function plainPrice(good: string): number {
  return GOODS.find((g) => g.id === good)?.price ?? 0;
}

/**
 * What a ton of a good fetches in a port on a day. The port's own rate, moved a tenth either way from week to week.
 * Stolen goods sell: no one in these ports asks. The price is what differs.
 */
export function price(good: string, port: Pick<Port, 'id' | 'pays'>, day: number, seed: number): number {
  const week = Math.floor(day / 7);
  let h = 0;
  for (const ch of good + port.id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  const wobble = 0.9 + 0.2 * roll(seed, week, h);
  return Math.max(1, Math.round(plainPrice(good) * (port.pays[good] ?? 1) * wobble));
}

/** What the whole hold fetches. */
export function holdValue(hold: Hold, port: Pick<Port, 'id' | 'pays'>, day: number, seed: number): number {
  return Object.entries(hold).reduce((s, [good, tons]) => s + tons * price(good, port, day, seed), 0);
}

/** Coin to make good a point of hull or of rigging, to sign on a man, to buy a pair of guns, to stand a round and hear the talk. */
export const COSTS = { hull: 4, rigging: 2.5, man: 14, gunPair: 380, rumour: 15 };

export function repairCost(port: Pick<Port, 'repair'>, hullMissing: number, riggingMissing: number): number {
  return port.repair <= 0 ? Infinity : Math.ceil((hullMissing * COSTS.hull + riggingMissing * COSTS.rigging) * port.repair);
}

/** Men looking for a ship in a port this week. A name that is talked about fills the tavern, up to a point. */
export function menForHire(port: Pick<Port, 'id' | 'recruits'>, notoriety: number, day: number, seed: number): number {
  if (port.recruits <= 0) return 0;
  let h = 0;
  for (const ch of port.id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  const base = 6 + 10 * roll(seed, Math.floor(day / 7), h + 5);
  return Math.round(base * port.recruits * (1 + Math.min(1, notoriety / 50)));
}

/** True when the port is shut to a ship of this notoriety and its guns will open on her. */
export function portShut(port: Pick<Port, 'shutAt'>, notoriety: number): boolean {
  return port.shutAt !== null && notoriety >= port.shutAt;
}
