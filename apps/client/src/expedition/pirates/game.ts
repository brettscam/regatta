import { board, boardingOdds, BOARD_RANGE, BOARD_SPEED, type BoardingResult, type Party } from './boarding';
import { PORT_REACH, type Caribbean, type LanePath, type PortPlace } from './caribbean';
import { saveCareer, type Career, type ShipState } from './career';
import { bearing, bears, broadside, driveLeft, gunsServed, reloadSeconds, roll, MAX_RANGE, type Harm, type Mark, type Side } from './gunnery';
import { COSTS, holdTons, menForHire, portShut, price, prizeContents, repairCost, stow, type Hold, type Prize } from './loot';
import { describe, sight, type Seeing, type Sight } from './sighting';
import { HOME_PORT, PLAYER_LIMITS, shipClass, type Nation, type ShipClass } from './tables';
import { alongLane, shipSpeed, shipsAt, type Sailing } from './traffic';

// The pirate game with nothing drawn: the player's sloop as a state of hull, rigging, men and guns, the ships near
// her as ships with minds of their own, the guns, the boarding, the prizes and the ports. The session (`session.ts`)
// sails the sloop with the sim and draws what happens here. `scripts/corsair.ts` plays it with no drawing at all.
// No clocks and no `Math.random`: the same seed and the same handling give the same cruise.
//
// SEAM, fleets: `ships` is already a list on both sides. A consort is a `LiveShip` with a mood of her own ('follow').
// SEAM, other players in the same sea: another player is a `LiveShip` whose place comes over the wire instead of from `steer`.

const D2R = Math.PI / 180;
const KT = 0.514444;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const tau = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/** Metres at which a ship on her lane is taken over and given a mind, and at which she is let go again. */
const TAKE_OVER = 42000;
const LET_GO = 60000;
/** Metres at which a trader makes out a strange sloop bearing down and runs. */
const ALARM = 4200;

/** The player's sloop as the game needs her each step. */
export interface Me {
  x: number;
  y: number;
  /** Compass heading and heel, radians. Heel is positive to starboard. */
  heading: number;
  heel: number;
  /** Speed through the water, m/s. */
  speed: number;
  /** Seconds since the cruise began. */
  t: number;
}

/** The weather the game is told of each step. */
export interface Env {
  wind(x: number, y: number): { dir: number; speed: number };
  /** Charted depth, metres. */
  depth(x: number, y: number): number;
  /** Significant height of the sea, metres, the sun's height in radians and the share of sky covered. */
  sea: number;
  sun: number;
  cloud: number;
}

export type Mood = 'cruise' | 'flee' | 'fight' | 'struck' | 'taken' | 'sinking';

export interface LiveShip extends Mark {
  id: string;
  lane: LanePath;
  cls: ShipClass;
  nation: Nation;
  seed: number;
  /** m/s. */
  speed: number;
  hull: number;
  rigging: number;
  crew: number;
  guns: number;
  mood: Mood;
  /** Seconds until each side is loaded. */
  reload: Record<Side, number>;
  salvo: number;
  /** What the look-out has made of her so far, and how she bears. */
  seen: Sight | null;
  range: number;
  bearing: number;
  /** True once she has left her lane for any reason. */
  astray: boolean;
  /** True once the player has fired on her. */
  firedOn: boolean;
  /** Seconds she has been going down. */
  sinking: number;
  /** The course she has chosen to run on, radians, once she has chosen one. */
  run: number | null;
}

export type GameEvent =
  | { kind: 'say'; text: string; seconds?: number; wake?: boolean }
  | { kind: 'sight'; ship: LiveShip; text: string }
  | { kind: 'fire'; mine: boolean; from: { x: number; y: number; heading: number }; side: Side; at: { x: number; y: number }; range: number; harm: Harm; fort?: boolean }
  | { kind: 'boarding'; mine: boolean; ship: LiveShip; result: BoardingResult; odds: number }
  | { kind: 'prize'; ship: LiveShip; prize: Prize; taken: Hold; gunsTaken: number; joined: number }
  | { kind: 'sunk'; ship: LiveShip }
  | { kind: 'lost'; why: 'sunk' | 'taken' | 'wrecked' };

export interface Rumour {
  lane: LanePath;
  text: string;
}

/** How much heart a crew has left after the beating their ship has had. */
export function heart(hullShare: number, crewShare: number): number {
  return Math.max(0.2, Math.min(1, 0.25 + 0.75 * hullShare * (0.5 + 0.5 * crewShare)));
}

/**
 * Whether a ship strikes her colours. Her distress is her hull lost (weighing most), her men lost, her rigging lost,
 * and how far she is outmatched hand to hand by an enemy close aboard. She strikes when that passes her courage.
 * @param overmatch the enemy's boarding strength over hers, when he is within hail. 0 when he is not
 */
export function strikes(cls: Pick<ShipClass, 'courage'>, hullShare: number, crewShare: number, rigShare: number, overmatch: number, seed: number): boolean {
  const distress = 0.55 * (1 - hullShare) + 0.35 * (1 - crewShare) + 0.1 * (1 - rigShare) + 0.4 * Math.max(0, Math.min(1, (overmatch - 1) / 3));
  return distress > cls.courage * 0.9 + 0.1 * roll(seed, 41, 42);
}

export class PirateGame {
  readonly ships = new Map<string, LiveShip>();
  readonly events: GameEvent[] = [];
  /** Ships taken, sunk or lost sight of after being chased: they are not met again. */
  private readonly gone = new Set<string>();
  readonly reload: Record<Side, number> = { port: 0, starboard: 0 };
  private salvo = 0;
  private rosterClock = 0;
  private fortClock = 0;
  private wrecks = 0;
  rumour: Rumour | null = null;
  private rumours = 0;
  private readonly hired: Record<string, number> = {};
  ended: 'sunk' | 'taken' | 'wrecked' | 'retired' | null = null;
  /** The ship the glass is on: the nearest in sight unless the player has picked another. */
  target: LiveShip | null = null;
  private picked: string | null = null;
  readonly cls: ShipClass;
  /** What this cruise has brought in so far, for the end card. */
  readonly tally = { prizes: 0, coin: 0, artifacts: [] as string[], sunk: 0 };

  /**
   * @param startAt where the cruise begins, flat metres. The first prize is laid off from it when she sails from her home port.
   */
  constructor(readonly sea: Caribbean, readonly seed: number, readonly career: Career, private readonly startAt: { x: number; y: number } = sea.sea.starts[0]) {
    if (!career.ship) throw new Error('A career needs a ship before it goes to sea');
    this.cls = shipClass(career.ship.cls);
  }

  get own(): ShipState {
    return this.career.ship!;
  }

  private say(text: string, seconds = 6, wake = false): void {
    this.events.push({ kind: 'say', text, seconds, wake });
  }

  /** Take what has happened since the last asking. */
  drain(): GameEvent[] {
    return this.events.splice(0, this.events.length);
  }

  // ---- the ships ------------------------------------------------------------------------------------------------

  /**
   * The first prize: a brigantine three or four miles off when the cruise begins, standing south for the Main with the
   * trade on her quarter, so that the first quarter of an hour has a chase in it and the chase is a reach.
   */
  private opening(t: number): Sailing | null {
    if (this.career.port !== HOME_PORT) return null;
    const from = this.startAt;
    const cls = shipClass('brigantine');
    const speed = 4.8 * KT;
    const run = 6500 + t * speed;
    if (run > 90000) return null;
    const heading = 196 * D2R;
    const lane: LanePath = { ...this.sea.lanes[0], id: 'opening', path: [], metres: 0 };
    return {
      id: 'opening#0', lane, cls, nation: 'english', seed: Math.floor(roll(this.seed, 77, 1) * 2 ** 30),
      x: from.x + Math.sin(heading) * run, y: from.y + Math.cos(heading) * run, heading, speed,
    };
  }

  private adopt(s: Sailing): LiveShip {
    return {
      id: s.id, lane: s.lane, cls: s.cls, nation: s.nation, seed: s.seed, x: s.x, y: s.y, heading: s.heading, speed: s.speed,
      loa: s.cls.loa, beam: s.cls.beam, hull: s.cls.hull, rigging: 100, crew: s.cls.crew, guns: s.cls.guns,
      mood: 'cruise', reload: { port: 0, starboard: 0 }, salvo: 0, seen: null, range: Infinity, bearing: 0, astray: false, firedOn: false, sinking: 0, run: null,
    };
  }

  /**
   * Put a ship on the sea by hand, off her lane and with a mind already made up: for the headless script's duels and for
   * looking at a ship from the console. She carries what a ship of the first lane would.
   */
  spawn(cls: string, nation: Nation, x: number, y: number, heading: number, mood: Mood = 'flee', id = `spawned#${this.ships.size}`): LiveShip {
    const c = shipClass(cls);
    const ship = this.adopt({ id, lane: this.sea.lanes[0], cls: c, nation, seed: Math.floor(roll(this.seed, this.ships.size, 91) * 2 ** 30), x, y, heading, speed: c.maxKt * 0.5 * KT });
    ship.mood = mood;
    ship.astray = true;
    ship.firedOn = mood === 'fight';
    this.ships.set(id, ship);
    return ship;
  }

  /** True when a man-of-war or a rover of this kind means to have her. */
  hostile(ship: LiveShip): boolean {
    if (ship.firedOn) return true;
    if (ship.cls.kind === 'merchant') return false;
    if (ship.nation === 'pirate') return this.own.coin + holdTons(this.own.hold) * 12 > 700;
    const port = this.sea.ports.find((p) => p.nation === ship.nation);
    // A cruiser comes out for her a little before her own port would shut its gates.
    return port !== undefined && port.shutAt !== null && this.career.notoriety >= port.shutAt * 0.6;
  }

  /**
   * Carry everything forward.
   * @param dt game seconds. A second or less in a fight, up to a minute in a watch.
   */
  step(dt: number, me: Me, env: Env, see: Seeing): void {
    if (this.ended) return;
    for (const side of ['port', 'starboard'] as Side[]) this.reload[side] = Math.max(0, this.reload[side] - dt);

    // Who is about: ships near enough are taken off their lanes and given minds. Ships still on a lane keep to it.
    this.rosterClock -= dt;
    const roster = this.rosterClock <= 0;
    let sailings: Sailing[] = [];
    if (roster) {
      this.rosterClock = 20;
      sailings = shipsAt(this.sea.lanes, me.t, this.seed);
      const first = this.opening(me.t);
      if (first) sailings.push(first);
      for (const s of sailings) {
        if (this.gone.has(s.id) || this.ships.has(s.id)) continue;
        if (Math.hypot(s.x - me.x, s.y - me.y) > TAKE_OVER) continue;
        if (s.lane.patrol && [...this.ships.values()].some((o) => o.lane.id === s.lane.id)) continue;
        this.ships.set(s.id, this.adopt(s));
      }
    }
    const meMark: Mark = { x: me.x, y: me.y, heading: me.heading, loa: this.cls.loa, beam: this.cls.beam };
    let nearest: LiveShip | null = null;
    for (const ship of [...this.ships.values()]) {
      if (ship.mood === 'cruise' && !ship.astray) {
        if (roster) {
          const on = sailings.find((s) => s.id === ship.id);
          if (!on) { this.ships.delete(ship.id); continue; }
          ship.x = on.x; ship.y = on.y; ship.heading = on.heading; ship.speed = on.speed;
        } else {
          ship.x += Math.sin(ship.heading) * ship.speed * dt;
          ship.y += Math.cos(ship.heading) * ship.speed * dt;
        }
      }
      const b = bearing(meMark, ship);
      ship.range = b.range;
      ship.bearing = tau(Math.atan2(ship.x - me.x, ship.y - me.y));
      if (ship.range > LET_GO || ship.mood === 'taken' || (ship.mood === 'sinking' && ship.sinking > 90)) {
        if (ship.astray || ship.mood === 'taken' || ship.mood === 'sinking') this.gone.add(ship.id);
        this.ships.delete(ship.id);
        if (this.picked === ship.id) this.picked = null;
        continue;
      }
      this.look(ship, see);
      this.mind(ship, me, env, dt);
      if (ship.seen && ship.mood !== 'sinking' && (!nearest || ship.range < nearest.range)) nearest = ship;
    }
    const picked = this.picked ? this.ships.get(this.picked) : null;
    this.target = picked && picked.seen ? picked : nearest;
    this.forts(dt, me);
  }

  /** The glass goes to the next sail in sight, nearest first. */
  nextTarget(): void {
    const seen = [...this.ships.values()].filter((s) => s.seen && s.mood !== 'sinking').sort((a, b) => a.range - b.range);
    if (!seen.length) return this.say('No sail in sight');
    const at = seen.findIndex((s) => s.id === this.target?.id);
    const next = seen[(at + 1) % seen.length];
    this.picked = next.id;
    this.target = next;
    this.say(describe(next.seen!, next.cls, next.nation, next.range, next.bearing, next.heading), 8);
  }

  private look(ship: LiveShip, see: Seeing): void {
    const now = sight(ship.range, ship.cls, see);
    const rank = (s: Sight | null) => (s === null ? 0 : s === 'tops' ? 1 : s === 'hull' ? 2 : s === 'colours' ? 3 : 4);
    if (rank(now) > rank(ship.seen)) {
      // The first sight of her calls the skipper. So does the moment her colours can be read.
      if (ship.seen === null || now === 'colours') this.events.push({ kind: 'sight', ship, text: describe(now!, ship.cls, ship.nation, ship.range, ship.bearing, ship.heading) });
      ship.seen = now;
    } else if (now === null) ship.seen = null;
  }

  /** What one ship does this step: makes up her mind, steers, sails, and fires if she has a mind to. */
  private mind(ship: LiveShip, me: Me, env: Env, dt: number): void {
    if (ship.mood === 'sinking') {
      ship.sinking += dt;
      ship.speed *= Math.exp(-dt / 8);
      return;
    }
    if (ship.mood === 'taken') return;
    for (const side of ['port', 'starboard'] as Side[]) ship.reload[side] = Math.max(0, ship.reload[side] - dt);

    // ---- her mind ----
    const hostile = this.hostile(ship);
    if (ship.mood === 'cruise') {
      if (hostile && ship.seen && ship.range < 14000 && ship.cls.kind !== 'merchant') {
        ship.mood = 'fight';
        ship.astray = true;
        if (ship.seen !== 'tops') this.say(`The ${ship.cls.name} has altered course for us`, 7, true);
      } else if (ship.cls.kind === 'merchant' && ship.range < ALARM) {
        ship.mood = 'flee';
        ship.astray = true;
        this.say(`The ${ship.cls.name} has seen what we are. She is making sail to run`, 6);
      }
    } else if (ship.mood === 'struck') {
      // Left alone, she gets under way again.
      if (ship.range > 3500) ship.mood = 'flee';
    } else if (ship.mood === 'fight') {
      const beaten = ship.hull < ship.cls.hull * (1 - ship.cls.courage) || ship.crew < ship.cls.crew * 0.35;
      if (beaten) {
        ship.mood = 'flee';
        this.say(`The ${ship.cls.name} has had enough. She is hauling off`, 6);
      } else if (!hostile && ship.range > 6000) ship.mood = 'cruise';
    } else if (ship.mood === 'flee' && ship.cls.kind !== 'merchant' && !hostile && ship.range > 9000) ship.mood = 'cruise';

    if (ship.mood === 'cruise' && !ship.astray) return;

    // ---- her helm ----
    const wind = env.wind(ship.x, ship.y);
    const twsKt = wind.speed / KT;
    const speedOn = (h: number) => shipSpeed(ship.cls, Math.abs(wrap(wind.dir - h)) / D2R, twsKt);
    const away = tau(Math.atan2(ship.x - me.x, ship.y - me.y));
    let want = ship.heading;
    if (ship.mood === 'struck') want = ship.heading;
    else if (ship.mood === 'flee' || ship.mood === 'cruise') {
      // Run on whatever course opens the distance fastest.
      // Once the chase is within a few cables she holds the course she has chosen: turning only lets him cut the corner.
      const goal = ship.mood === 'flee' ? away : alongLane(ship.lane, ship.lane.metres).heading;
      if (ship.mood === 'flee' && ship.range < 700 && ship.run !== null) want = ship.run;
      else {
        let best = -Infinity;
        for (let k = 0; k < 24; k++) {
          const h = k * 15 * D2R;
          const made = speedOn(h) * Math.cos(wrap(h - goal));
          if (made > best) { best = made; want = h; }
        }
        ship.run = want;
      }
    } else {
      const toMe = tau(away + Math.PI);
      if (ship.range > 330) {
        // Come down on her, aiming a little ahead. If that is too close to the wind, the better tack.
        const lead = Math.min(40, ship.range / Math.max(2, ship.speed));
        want = tau(Math.atan2(me.x + Math.sin(me.heading) * me.speed * lead - ship.x, me.y + Math.cos(me.heading) * me.speed * lead - ship.y));
        if (speedOn(want) < 0.5) {
          const off = (ship.cls.pointDeg + 3) * D2R;
          const a = tau(wind.dir + off);
          const b = tau(wind.dir - off);
          want = Math.abs(wrap(a - want)) < Math.abs(wrap(b - want)) ? a : b;
        }
      } else {
        // Lay her alongside: broadside on to the enemy, on the course nearer his own, edging in while it is long shot.
        const open = (ship.range > 170 ? 68 : 88) * D2R;
        const a = tau(toMe + open);
        const b = tau(toMe - open);
        want = Math.abs(wrap(a - me.heading)) < Math.abs(wrap(b - me.heading)) ? a : b;
        if (speedOn(want) < 0.4) want = want === a ? b : a;
      }
    }
    // Keep off the ground: if the water ahead is shoal, turn for the deeper side.
    const ahead = (h: number) => env.depth(ship.x + Math.sin(h) * 900, ship.y + Math.cos(h) * 900);
    if (ship.mood !== 'struck' && ahead(want) < ship.cls.draft + 2.5) {
      const l = ahead(want - 1.1);
      const r = ahead(want + 1.1);
      want = tau(want + (r > l ? 1.1 : -1.1));
    }
    const rate = (ship.cls.loa < 20 ? 5 : ship.cls.loa < 26 ? 3.5 : 2.5) * D2R * dt;
    ship.heading = tau(ship.heading + Math.max(-rate, Math.min(rate, wrap(want - ship.heading))));
    const target = ship.mood === 'struck' ? 0 : speedOn(ship.heading) * driveLeft(ship.rigging);
    ship.speed += (target - ship.speed) * Math.min(1, dt / 22);
    const nx = ship.x + Math.sin(ship.heading) * ship.speed * dt;
    const ny = ship.y + Math.cos(ship.heading) * ship.speed * dt;
    if (env.depth(nx, ny) > ship.cls.draft + 0.5) { ship.x = nx; ship.y = ny; } else ship.speed = 0;

    // ---- her guns ----
    // A trader run down to pistol shot fires what she has, whether or not she has been fired on.
    const armed = ship.mood === 'fight' || (ship.mood === 'flee' && (ship.firedOn || ship.range < 320));
    if (armed && ship.range < MAX_RANGE * 0.75) {
      for (const side of ['port', 'starboard'] as Side[]) {
        if (ship.reload[side] > 0 || !bears(ship, me, side)) continue;
        const guns = gunsServed(ship.guns, ship.crew);
        if (guns <= 0) continue;
        const harm = broadside(guns, ship.cls.gunLb, {
          range: ship.range, side, heel: 0, sea: env.sea, gunnery: ship.cls.gunnery,
          aspect: wrap(Math.atan2(me.x - ship.x, me.y - ship.y) - me.heading), targetLoa: this.cls.loa, targetBeam: this.cls.beam,
        }, ship.seed + 1000 * ++ship.salvo);
        ship.reload[side] = reloadSeconds(ship.guns, ship.crew) * 1.15;
        this.events.push({ kind: 'fire', mine: false, from: { x: ship.x, y: ship.y, heading: ship.heading }, side, at: { x: me.x, y: me.y }, range: ship.range, harm });
        this.hurt(harm);
      }
    }
    // ---- and her boarders: a fighting ship close aboard with the men for it comes over the side ----
    if (ship.mood === 'fight' && ship.range < BOARD_RANGE && Math.abs(ship.speed - me.speed) < BOARD_SPEED) {
      const theirs = this.party(ship);
      const ours = this.ownParty();
      if (boardingOdds(theirs, ours) > 0.6) {
        const odds = boardingOdds(theirs, ours);
        const result = board(theirs, ours, ship.seed + 7 * ++ship.salvo);
        ship.crew = result.attackersLeft;
        this.own.crew = Math.max(0, result.defendersLeft);
        this.events.push({ kind: 'boarding', mine: false, ship, result, odds });
        if (result.won) this.lose('taken');
        else ship.mood = 'flee';
      }
    }
  }

  private party(ship: LiveShip): Party {
    return { men: ship.crew, fight: ship.cls.fight, heart: heart(ship.hull / ship.cls.hull, ship.crew / ship.cls.crew) };
  }

  private ownParty(): Party {
    return { men: this.own.crew, fight: this.cls.fight, heart: heart(this.own.hull / this.cls.hull, Math.min(1, this.own.crew / this.cls.crew)) };
  }

  /** Shot has come aboard. */
  private hurt(harm: Harm): void {
    const s = this.own;
    s.hull = Math.max(0, s.hull - harm.hull);
    s.rigging = Math.max(0, s.rigging - harm.rigging);
    s.crew = Math.max(0, s.crew - harm.men);
    s.guns = Math.max(0, s.guns - harm.gunsLost);
    if (s.hull <= 0) this.lose('sunk');
    else if (s.crew < 5) this.lose('taken');
  }

  private lose(why: 'sunk' | 'taken' | 'wrecked'): void {
    if (this.ended) return;
    this.ended = why;
    this.events.push({ kind: 'lost', why });
  }

  /** The guns of a port that is shut to her open when she comes within a mile. */
  private forts(dt: number, me: Me): void {
    this.fortClock -= dt;
    if (this.fortClock > 0) return;
    this.fortClock = 26;
    for (const port of this.sea.ports) {
      if (!portShut(port, this.career.notoriety)) continue;
      const range = Math.hypot(port.townX - me.x, port.townY - me.y);
      if (range > 2600) continue;
      // Heavy guns on a steady platform: they reach four times as far as a sloop's, and hit harder.
      const harm = broadside(6, 18, {
        range: range / 4.5, side: 'port', heel: 0, sea: 0, gunnery: 0.8, aspect: wrap(Math.atan2(me.x - port.townX, me.y - port.townY) - me.heading),
        targetLoa: this.cls.loa, targetBeam: this.cls.beam,
      }, this.seed + 500 * ++this.salvo);
      this.events.push({ kind: 'fire', mine: false, fort: true, from: { x: port.townX, y: port.townY, heading: 0 }, side: 'port', at: { x: me.x, y: me.y }, range, harm });
      this.say(`The fort at ${port.name} has opened on us. That port is shut to this ship`, 7, true);
      this.hurt(harm);
    }
  }

  // ---- what the player does ---------------------------------------------------------------------------------------

  /** Whether a broadside bears on anything, for the read-out: the ship it would be fired at. */
  bearsOn(side: Side, me: Me): LiveShip | null {
    const mark: Mark = { x: me.x, y: me.y, heading: me.heading, loa: this.cls.loa, beam: this.cls.beam };
    let best: LiveShip | null = null;
    for (const ship of this.ships.values()) {
      if (!ship.seen || ship.mood === 'sinking' || ship.mood === 'taken') continue;
      if (bears(mark, ship, side) && (!best || ship.range < best.range)) best = ship;
    }
    return best;
  }

  /** Fire the broadside on one side at whatever it bears on. Returns false when nothing was fired. */
  fire(side: Side, me: Me, env: Env): boolean {
    if (this.ended) return false;
    const name = side === 'port' ? 'larboard' : 'starboard';
    if (this.reload[side] > 0) return this.say(`The ${name} guns are not loaded yet: ${Math.ceil(this.reload[side])} seconds`, 3), false;
    const guns = gunsServed(this.own.guns, this.own.crew);
    if (guns <= 0) return this.say(this.own.guns < 2 ? 'She has no guns left on their carriages' : 'There are not the hands to work the guns', 4), false;
    const ship = this.bearsOn(side, me);
    if (!ship) return this.say(`Nothing bears on the ${name} side. A broadside trains three points either side of the beam, to six hundred yards`, 5), false;
    const harm = broadside(guns, this.cls.gunLb, {
      range: ship.range, side, heel: me.heel, sea: env.sea, gunnery: this.cls.gunnery,
      aspect: wrap(Math.atan2(ship.x - me.x, ship.y - me.y) - ship.heading), targetLoa: ship.cls.loa, targetBeam: ship.cls.beam,
    }, this.seed + 100 * ++this.salvo);
    this.reload[side] = reloadSeconds(this.own.guns, this.own.crew);
    this.events.push({ kind: 'fire', mine: true, from: { x: me.x, y: me.y, heading: me.heading }, side, at: { x: ship.x, y: ship.y }, range: ship.range, harm });
    ship.hull = Math.max(0, ship.hull - harm.hull);
    ship.rigging = Math.max(0, ship.rigging - harm.rigging);
    ship.crew = Math.max(0, ship.crew - harm.men);
    ship.guns = Math.max(0, ship.guns - harm.gunsLost);
    if (!ship.firedOn) {
      ship.firedOn = true;
      this.notorious(1);
    }
    ship.astray = true;
    this.picked = ship.id;
    const tell = harm.hits === 0 ? `${harm.fired} guns, all wide` : `${harm.hits} of ${harm.fired} home${harm.rake ? `, raking her ${harm.rake === 'stern' ? 'by the stern' : 'by the bow'}` : ''}${harm.rigging > harm.hull ? ', high, into her rigging' : ''}`;
    if (ship.hull <= 0) {
      ship.mood = 'sinking';
      this.tally.sunk++;
      this.notorious(Math.ceil(ship.cls.infamy / 2));
      this.events.push({ kind: 'sunk', ship });
      this.say(`${capital(tell)}. She is going down, and all she carried with her`, 8);
      return true;
    }
    if (ship.mood === 'struck') return this.say(`${capital(tell)}. She has struck: B boards her`, 5), true;
    const mine = this.ownParty();
    const hers = this.party(ship);
    const overmatch = ship.range < 260 ? (mine.men * mine.fight) / Math.max(1, hers.men * hers.fight) : 0;
    if (strikes(ship.cls, ship.hull / ship.cls.hull, ship.crew / ship.cls.crew, ship.rigging / 100, overmatch, ship.seed + ship.salvo + this.salvo)) {
      ship.mood = 'struck';
      this.say(`${capital(tell)}. She has struck her colours. Lay her alongside and B takes possession`, 9);
    } else {
      if (ship.cls.kind !== 'merchant') ship.mood = 'fight';
      else if (ship.mood === 'cruise') ship.mood = 'flee';
      this.say(capital(tell), 4);
    }
    return true;
  }

  /** The ship that could be boarded now, and if none, why not. */
  boardable(me: Me): { ship: LiveShip | null; why: string } {
    let near: LiveShip | null = null;
    for (const ship of this.ships.values()) {
      if (!ship.seen || ship.mood === 'sinking' || ship.mood === 'taken') continue;
      if (!near || ship.range < near.range) near = ship;
    }
    if (!near) return { ship: null, why: 'No ship near to board' };
    if (near.range > BOARD_RANGE) return { ship: null, why: `Too far to board: ${Math.round(near.range)} yards, and the grapnels reach ${BOARD_RANGE}` };
    const closing = Math.hypot(Math.sin(me.heading) * me.speed - Math.sin(near.heading) * near.speed, Math.cos(me.heading) * me.speed - Math.cos(near.heading) * near.speed);
    if (closing > BOARD_SPEED) return { ship: null, why: 'She is going by too fast to grapple. Come onto her course and ease sheets' };
    return { ship: near, why: '' };
  }

  /** Board the ship alongside. */
  board(me: Me): boolean {
    if (this.ended) return false;
    const { ship, why } = this.boardable(me);
    if (!ship) return this.say(why, 5), false;
    if (ship.mood === 'struck') {
      this.capture(ship);
      return true;
    }
    const ours = this.ownParty();
    const hers = this.party(ship);
    const odds = boardingOdds(ours, hers);
    const result = board(ours, hers, ship.seed + 13 * ++this.salvo);
    this.own.crew = result.attackersLeft;
    ship.crew = result.defendersLeft;
    ship.firedOn = true;
    ship.astray = true;
    this.events.push({ kind: 'boarding', mine: true, ship, result, odds });
    if (result.won) this.capture(ship);
    else if (this.own.crew < 5) this.lose('taken');
    else if (ship.cls.kind !== 'merchant') ship.mood = 'fight';
    return result.won;
  }

  private notorious(by: number): void {
    this.career.notoriety = Math.max(0, Math.min(100, this.career.notoriety + by));
  }

  private capture(ship: LiveShip): void {
    const own = this.own;
    const prize = prizeContents(ship.cls, ship.lane, ship.seed, this.career.artifacts);
    own.coin += prize.coin;
    const taken = stow(own.hold, this.cls.cargoTons, prize.cargo);
    if (prize.artifact) {
      this.career.artifacts.push(prize.artifact.id);
      this.tally.artifacts.push(prize.artifact.id);
    }
    const joined = Math.max(0, Math.min(prize.volunteers, PLAYER_LIMITS.crew - own.crew));
    own.crew += joined;
    // A pair of her guns is swayed across if they are heavier than the sloop's own and there is a port to put them at.
    const gunsTaken = ship.guns >= 2 && own.guns <= PLAYER_LIMITS.guns - 2 && ship.cls.gunLb > this.cls.gunLb ? 2 : 0;
    own.guns += gunsTaken;
    this.notorious(ship.cls.infamy);
    this.career.prizes++;
    this.tally.prizes++;
    this.tally.coin += prize.coin;
    ship.mood = 'taken';
    if (this.rumour && this.rumour.lane.id === ship.lane.id) this.rumour = null;
    this.events.push({ kind: 'prize', ship, prize, taken, gunsTaken, joined });
    saveCareer(this.career);
  }

  /** She has struck the ground hard. Returns the hull she lost. */
  aground(speedKt: number, reef: boolean): number {
    const loss = reef ? 10 + speedKt * 3.5 : 2 + speedKt * 0.8;
    this.own.hull = Math.max(0, this.own.hull - loss);
    this.wrecks++;
    if (this.own.hull <= 0) this.lose('wrecked');
    return loss;
  }

  retire(): void {
    if (!this.ended) this.ended = 'retired';
  }

  // ---- ports ------------------------------------------------------------------------------------------------------

  /** The port whose anchorage she is lying in, if she is nearly stopped there. */
  portAt(me: Me): PortPlace | null {
    for (const port of this.sea.ports) if (Math.hypot(port.x - me.x, port.y - me.y) < PORT_REACH && Math.abs(me.speed) < 2.2 * KT) return port;
    return null;
  }

  /** The nearest port and how it lies. */
  nearestPort(me: Me): { port: PortPlace; metres: number; bearing: number } {
    let best = this.sea.ports[0];
    for (const p of this.sea.ports) if (Math.hypot(p.x - me.x, p.y - me.y) < Math.hypot(best.x - me.x, best.y - me.y)) best = p;
    return { port: best, metres: Math.hypot(best.x - me.x, best.y - me.y), bearing: tau(Math.atan2(best.x - me.x, best.y - me.y)) };
  }

  isShut(port: PortPlace): boolean {
    return portShut(port, this.career.notoriety);
  }

  /** She has come to in an open port: what she brought is put ashore, and she is remembered as lying here. */
  enter(port: PortPlace): void {
    this.career.banked += this.own.coin;
    this.own.coin = 0;
    this.career.port = port.id;
    saveCareer(this.career);
  }

  private day(t: number): number {
    return Math.floor(t / 86400);
  }

  priceOf(good: string, port: PortPlace, t: number): number {
    return price(good, port, this.day(t), this.seed);
  }

  sell(good: string, port: PortPlace, t: number): number {
    const tons = this.own.hold[good] ?? 0;
    if (tons <= 0) return 0;
    const got = tons * this.priceOf(good, port, t);
    delete this.own.hold[good];
    this.career.banked += got;
    saveCareer(this.career);
    return got;
  }

  repairBill(port: PortPlace): number {
    return repairCost(port, this.cls.hull - this.own.hull, 100 - this.own.rigging);
  }

  /** Make good what the purse will stretch to, the hull first. */
  repair(port: PortPlace): number {
    if (port.repair <= 0) return 0;
    const before = this.career.banked;
    const hull = Math.min(this.cls.hull - this.own.hull, Math.floor(this.career.banked / (COSTS.hull * port.repair)));
    this.own.hull += Math.max(0, hull);
    this.career.banked -= Math.ceil(Math.max(0, hull) * COSTS.hull * port.repair);
    const rig = Math.min(100 - this.own.rigging, Math.floor(this.career.banked / (COSTS.rigging * port.repair)));
    this.own.rigging += Math.max(0, rig);
    this.career.banked -= Math.ceil(Math.max(0, rig) * COSTS.rigging * port.repair);
    saveCareer(this.career);
    return before - this.career.banked;
  }

  menToHire(port: PortPlace, t: number): number {
    const key = `${port.id}:${Math.floor(this.day(t) / 7)}`;
    return Math.max(0, Math.min(menForHire(port, this.career.notoriety, this.day(t), this.seed) - (this.hired[key] ?? 0), PLAYER_LIMITS.crew - this.own.crew));
  }

  recruit(port: PortPlace, t: number, men: number): number {
    const n = Math.max(0, Math.min(men, this.menToHire(port, t), Math.floor(this.career.banked / COSTS.man)));
    const key = `${port.id}:${Math.floor(this.day(t) / 7)}`;
    this.hired[key] = (this.hired[key] ?? 0) + n;
    this.own.crew += n;
    this.career.banked -= n * COSTS.man;
    saveCareer(this.career);
    return n;
  }

  canBuyGuns(port: PortPlace): boolean {
    return port.gunsForSale && this.own.guns <= PLAYER_LIMITS.guns - 2 && this.career.banked >= COSTS.gunPair;
  }

  buyGuns(port: PortPlace): boolean {
    if (!this.canBuyGuns(port)) return false;
    this.own.guns += 2;
    this.career.banked -= COSTS.gunPair;
    saveCareer(this.career);
    return true;
  }

  /** Stand a round and hear where the money is. The talk is true: it names a lane that ships are on. */
  hearRumour(t: number): Rumour | null {
    if (this.career.banked < COSTS.rumour) return null;
    this.career.banked -= COSTS.rumour;
    const lanes = this.sea.lanes;
    // One time in three it is the cruisers that are talked of. Otherwise trade, and the richest trade oftenest.
    const r = roll(this.seed, this.day(t), ++this.rumours, 51);
    const pool = lanes.filter((l) => (r < 0.3 ? l.patrol : !l.patrol));
    const weights = pool.map((l): [LanePath, number] => [l, l.patrol ? 1 : Math.max(...l.ships.map(([id]) => shipClass(id).coin[1])) / 400 + 1]);
    const total = weights.reduce((s, w) => s + w[1], 0);
    let at = roll(this.seed, this.rumours, 52) * total;
    let lane = pool[0];
    for (const [l, w] of weights) { at -= w; if (at < 0) { lane = l; break; } }
    this.rumour = { lane, text: lane.rumour };
    saveCareer(this.career);
    return this.rumour;
  }

  buyPardon(port: PortPlace): boolean {
    if (port.pardon <= 0 || this.career.banked < port.pardon || this.career.notoriety <= 0) return false;
    this.career.banked -= port.pardon;
    this.notorious(-15);
    saveCareer(this.career);
    return true;
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
