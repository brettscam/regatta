import type { Hold } from './loot';
import { ARTIFACTS, GOODS, HOME_PORT, PLAYER_CLASS, PLAYER_LIMITS, PORTS, shipClass } from './tables';

// What a rover keeps between sittings, on this device: the riches banked ashore, the cabinet, how well she is known,
// and the sloop as she was last left in port. Read back only if every field of it is sound.
//
// Coin aboard is at risk. Coin is banked whenever she lies in an open port. When the sloop is sunk or taken, the
// cargo and the coin aboard go with her, the next sloop costs half of what was banked, and the cabinet is kept.
//
// SEAM, treasure hunts: an artifact that is a chart (`wreck-chart`) would add a place to `marks` here.
// SEAM, a bigger ship: `ship.cls` is already here. Buying one is a port action that changes it.

const KEY = 'regatta.pirate';
/** The share of banked coin left after a sloop is lost: the rest goes on the next sloop and on the dead men's shares. */
export const NEW_SHIP_SHARE = 0.5;
/** Coin a rover with nothing starts with. */
export const STARTING_PURSE = 150;

export interface ShipState {
  cls: string;
  hull: number;
  rigging: number;
  crew: number;
  guns: number;
  coin: number;
  hold: Hold;
}

export interface Career {
  v: 1;
  /** Coin put ashore. */
  banked: number;
  /** Ids of what is in the cabinet. */
  artifacts: string[];
  /** 0 unknown, 100 the terror of the Indies. */
  notoriety: number;
  /** Prizes taken and sloops lost, in all. */
  prizes: number;
  lost: number;
  /** The sloop, and the port she was last in. Null when there is none: a new one is fitted out. */
  ship: ShipState | null;
  port: string;
}

export function freshShip(coin: number): ShipState {
  const cls = shipClass(PLAYER_CLASS);
  return { cls: cls.id, hull: cls.hull, rigging: 100, crew: cls.crew, guns: cls.guns, coin: Math.round(coin), hold: {} };
}

export function freshCareer(): Career {
  return { v: 1, banked: STARTING_PURSE, artifacts: [], notoriety: 0, prizes: 0, lost: 0, ship: null, port: HOME_PORT };
}

const whole = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

/** A saved career if it is sound in every field, else null. */
export function readCareer(raw: unknown): Career | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<Career>;
  if (c.v !== 1 || !whole(c.banked, 0, 1e9) || !whole(c.notoriety, 0, 100) || !whole(c.prizes, 0, 1e6) || !whole(c.lost, 0, 1e6)) return null;
  if (!Array.isArray(c.artifacts) || c.artifacts.some((id) => !ARTIFACTS.some((a) => a.id === id)) || new Set(c.artifacts).size !== c.artifacts.length) return null;
  if (typeof c.port !== 'string' || !PORTS.some((p) => p.id === c.port)) return null;
  let ship: ShipState | null = null;
  if (c.ship !== null && c.ship !== undefined) {
    const s = c.ship as Partial<ShipState>;
    if (s.cls !== PLAYER_CLASS) return null;
    const cls = shipClass(PLAYER_CLASS);
    if (!whole(s.hull, 1, cls.hull) || !whole(s.rigging, 0, 100) || !whole(s.crew, 1, PLAYER_LIMITS.crew) || !whole(s.guns, 0, PLAYER_LIMITS.guns) || !whole(s.coin, 0, 1e9)) return null;
    if (!s.hold || typeof s.hold !== 'object') return null;
    const hold: Hold = {};
    let tons = 0;
    for (const [good, t] of Object.entries(s.hold)) {
      if (!GOODS.some((g) => g.id === good) || !whole(t, 0, cls.cargoTons)) return null;
      hold[good] = t;
      tons += t;
    }
    if (tons > cls.cargoTons + 1e-6) return null;
    ship = { cls: s.cls, hull: s.hull, rigging: s.rigging, crew: Math.round(s.crew), guns: Math.round(s.guns), coin: s.coin, hold };
  }
  return { v: 1, banked: c.banked, artifacts: [...c.artifacts], notoriety: c.notoriety, prizes: c.prizes, lost: c.lost, ship, port: c.port };
}

export function loadCareer(): Career {
  try {
    const raw = localStorage.getItem(KEY);
    return (raw && readCareer(JSON.parse(raw))) || freshCareer();
  } catch {
    return freshCareer();
  }
}

export function saveCareer(c: Career): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch { /* private window: the career lasts as long as the page */ }
}

/** The sloop is gone. Half of what was banked goes with her, never less than a starting purse is left, and she is half as talked of. */
export function afterLoss(c: Career): Career {
  return { ...c, ship: null, port: HOME_PORT, lost: c.lost + 1, notoriety: Math.round(c.notoriety * 0.5), banked: Math.max(STARTING_PURSE, Math.round(c.banked * NEW_SHIP_SHARE)) };
}

/** Fit out a sloop for a career that has none. */
export function fitOut(c: Career): Career {
  return c.ship ? c : { ...c, ship: freshShip(0) };
}

/** Everything she is worth: coin ashore and aboard, and the cabinet at a collector's price. */
export function riches(c: Career): number {
  return c.banked + (c.ship?.coin ?? 0) + c.artifacts.reduce((s, id) => s + (ARTIFACTS.find((a) => a.id === id)?.worth ?? 0), 0);
}
