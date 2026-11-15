import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, D2R, KT, R2D, type BoatSpec } from '@slack-tide/sim';
import { measurePerformance, performanceAt, sailPlanFor, watchStep } from '../src/expedition/watch';
import { board, boardingOdds } from '../src/expedition/pirates/boarding';
import { PORT_REACH, buildCaribbean, squallAt } from '../src/expedition/pirates/caribbean';
import { afterLoss, fitOut, freshCareer, readCareer, riches, STARTING_PURSE } from '../src/expedition/pirates/career';
import { PirateGame, heart, strikes, type Env, type Me } from '../src/expedition/pirates/game';
import { BEAR_ARC, MAX_RANGE, RELOAD, aspectEffect, bears, broadside, driveLeft, gunsServed, heelEffect, hitChance, reloadSeconds, type Shot } from '../src/expedition/pirates/gunnery';
import { holdTons, menForHire, portShut, price, prizeContents, repairCost, stow } from '../src/expedition/pirates/loot';
import { SLOOP_RIG } from '../src/expedition/pirates/rig';
import { describe as describeSail, horizon, lying, sight, visibility } from '../src/expedition/pirates/sighting';
import { ARTIFACTS, GOODS, LANES, PLAYER_CLASS, PORTS, SHIP_CLASSES, shipClass } from '../src/expedition/pirates/tables';
import { alongLane, shipSpeed, shipsAt } from '../src/expedition/pirates/traffic';

const boats = resolve(dirname(fileURLToPath(import.meta.url)), '../../../boats');
const sloop = JSON.parse(readFileSync(resolve(boats, 'jamaica-sloop.json'), 'utf8')) as BoatSpec;
const sea = buildCaribbean(7);
const SEE = { masthead: 19, deck: 4, air: 38000 };

function checksum(a: ArrayLike<number>): number {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) h = Math.imul(h ^ (a[i] & 0xffff), 16777619);
  return h >>> 0;
}

describe('the made Caribbean', () => {
  it('has the same land and reefs for every seed, and the same weather for the same seed', () => {
    const other = buildCaribbean(8);
    const again = buildCaribbean(7);
    expect(checksum(other.sea.depth)).toBe(checksum(sea.sea.depth));
    expect(checksum(other.sea.terrain)).toBe(checksum(sea.sea.terrain));
    const at = sea.sea.starts[0];
    const w = (s: typeof sea, h: number) => s.sea.weather.at(at.x, at.y, h);
    expect(w(again, 30)).toEqual(w(sea, 30));
    expect(w(other, 30)).not.toEqual(w(sea, 30));
  });

  it('is about a thousand kilometres by five hundred, in a few megabytes', () => {
    const b = sea.sea.course.bounds;
    expect((b.x1 - b.x0) / 1000).toBeGreaterThan(900);
    expect((b.x1 - b.x0) / 1000).toBeLessThan(1100);
    expect((b.y1 - b.y0) / 1000).toBeGreaterThan(420);
    const bytes = sea.sea.depth.length + sea.sea.patches.reduce((n, p) => n + p.heights.length, 0);
    expect(bytes).toBeLessThan(2e6);
  });

  it('blows a trade wind: from the east, twelve to twenty-two knots, freshest in the afternoon', () => {
    const at = sea.sea.projection.toXY(17.2, -75.5);
    let morning = 0;
    let afternoon = 0;
    for (let day = 0; day < 20; day++) {
      for (let hour = 0; hour < 24; hour += 3) {
        const hours = day * 24 + hour;
        if (squallAt(at.x, at.y, hours, 7) > 0) continue;
        const w = sea.sea.weather.at(at.x, at.y, hours);
        const kt = Math.hypot(w.u, w.v) / KT;
        const from = ((Math.atan2(-w.u, -w.v) * R2D) + 360) % 360;
        expect(kt).toBeGreaterThan(8.5);
        expect(kt).toBeLessThan(25);
        expect(from).toBeGreaterThan(50);
        expect(from).toBeLessThan(125);
        if (hour === 3) morning += kt;
        if (hour === 15) afternoon += kt;
      }
    }
    expect(afternoon).toBeGreaterThan(morning + 20 * 3);
  });

  it('has squalls that pass through: half as hard again, and gone within three hours', () => {
    const at = sea.sea.projection.toXY(17.2, -75.5);
    let found = 0;
    let hardest = 0;
    for (let h = 0; h < 24 * 30; h += 0.1) {
      const s = squallAt(at.x, at.y, h, 7);
      if (s > 0.5) found++;
      hardest = Math.max(hardest, s);
    }
    expect(hardest).toBeGreaterThan(0.6);
    // In a squall for a few hours of a month, not for days.
    expect(found * 0.1).toBeGreaterThan(0.3);
    expect(found * 0.1).toBeLessThan(40);
    const world = sea.world;
    expect(world.wind(at.x, at.y, 0).speed).toBeGreaterThan(0);
  });

  it('puts every port in an anchorage a ship can lie in, off a town on the land', () => {
    expect(sea.ports.length).toBe(PORTS.length);
    for (const p of sea.ports) {
      expect(sea.sea.land.on(p.townX, p.townY), p.name).not.toBeNull();
      expect(sea.world.chartDepth(p.x, p.y), p.name).toBeGreaterThanOrEqual(6);
      const off = Math.hypot(p.x - p.townX, p.y - p.townY);
      expect(off, p.name).toBeGreaterThan(1000);
      expect(off, p.name).toBeLessThan(6000);
      // There is room to round up and stop inside the anchorage without touching.
      for (let k = 0; k < 8; k++) expect(sea.world.chartDepth(p.x + Math.sin(k * 0.785) * PORT_REACH * 0.8, p.y + Math.cos(k * 0.785) * PORT_REACH * 0.8), p.name).toBeGreaterThan(4);
    }
  });

  it('has reefs that will take the bottom out of a sloop, with water round them that will not', () => {
    const draft = shipClass(PLAYER_CLASS).draft;
    for (const reef of sea.reefs) {
      let awash = 0;
      let cells = 0;
      for (let dx = -reef.radius; dx <= reef.radius; dx += 1000) {
        for (let dy = -reef.radius; dy <= reef.radius; dy += 1000) {
          if (Math.hypot(dx, dy) > reef.radius) continue;
          cells++;
          const d = sea.world.chartDepth(reef.x + dx, reef.y + dy);
          if (d > 0 && d < draft) awash++;
        }
      }
      expect(awash, reef.name).toBeGreaterThan(0);
      expect(awash, reef.name).toBeLessThan(cells);
    }
  });

  it('keeps every sea lane in deep water', () => {
    for (const lane of sea.lanes) {
      for (let d = 0; d <= lane.metres; d += 700) {
        const p = alongLane(lane, d);
        expect(sea.world.chartDepth(p.x, p.y), `${lane.id} at ${Math.round(d / 1000)} km`).toBeGreaterThan(9);
      }
    }
  });
});

describe('the Jamaica sloop', () => {
  const steady = (tws: number) => ({ sample: () => ({ windDir: 0, windSpeed: tws * KT, currentX: 0, currentY: 0 }) });
  const sail = (twa: number, tws: number) => {
    const sim = new Sim(structuredClone(sloop), steady(tws), { headingDeg: -twa, speedKt: 5 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setHelm('heading', -twa * D2R);
    sim.advance(300);
    return sim;
  };

  it('reaches at eight to ten knots in the trade and lies five points from the wind', () => {
    expect(sail(110, 16).state.speed / KT).toBeGreaterThan(8);
    expect(sail(110, 16).state.speed / KT).toBeLessThan(10.5);
    expect(sail(55, 16).state.speed / KT).toBeGreaterThan(5);
    expect(sail(170, 16).state.speed / KT).toBeGreaterThan(6);
  });

  it('heels past where her lee guns can be fought when she is pressed on the wind, and a reef brings her back', () => {
    const pressed = Math.abs(sail(60, 24).state.heel) * R2D;
    expect(pressed).toBeGreaterThan(11);
    expect(heelEffect('starboard', pressed * D2R).chance).toBeLessThan(0.6);
    const sim = new Sim(structuredClone(sloop), steady(24), { headingDeg: -60, speedKt: 5, reef: 2, furl: 0 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setHelm('heading', -60 * D2R);
    sim.advance(300);
    expect(Math.abs(sim.state.heel) * R2D).toBeLessThan(pressed - 3);
    // Off the wind in the ordinary trade she is nearly upright.
    expect(Math.abs(sail(120, 15).state.heel) * R2D).toBeLessThan(7);
  });

  it('is carried through a watch at about the speed the sim sails her', () => {
    const perf = measurePerformance(sloop, SLOOP_RIG);
    expect(perf.twa[0]).toBe(SLOOP_RIG.fullAndBy);
    const table = performanceAt(perf, 110, 16).speed;
    expect(Math.abs(table - sail(110, 16).state.speed) / table).toBeLessThan(0.08);
    expect(sailPlanFor(24, 0, SLOOP_RIG)).toBe(1);
    expect(sailPlanFor(12, 2, SLOOP_RIG)).toBe(0);
    const world = { wind: () => ({ dir: 90 * D2R, speed: 16 * KT }), current: () => ({ x: 0, y: 0 }), depth: () => 200 };
    const full = watchStep(perf, world, { x: 0, y: 0, t: 0, plan: 0, hoveTo: false }, 180 * D2R, 3600, 2.5, SLOOP_RIG);
    const shot = watchStep(perf, world, { x: 0, y: 0, t: 0, plan: 0, hoveTo: false, drive: 0.5 }, 180 * D2R, 3600, 2.5, SLOOP_RIG);
    expect(-full.y / 1852).toBeGreaterThan(7);
    expect(shot.y / full.y).toBeCloseTo(0.5, 1);
    // Asked to steer into the wind's eye she lies full and by.
    const beat = watchStep(perf, world, { x: 0, y: 0, t: 0, plan: 0, hoveTo: false }, 90 * D2R, 60, 2.5, SLOOP_RIG);
    expect(beat.headed).toBe(true);
  });
});

describe('gunnery', () => {
  const shot = (over: Partial<Shot> = {}): Shot => ({ range: 100, side: 'starboard', heel: 0, sea: 0.5, gunnery: 1, aspect: Math.PI / 2, targetLoa: 22, targetBeam: 6.6, ...over });

  it('bears only within three points of the beam and inside six hundred yards', () => {
    const me = { x: 0, y: 0, heading: 0, loa: 18, beam: 6 };
    expect(bears(me, { x: 100, y: 0 }, 'starboard')).toBe(true);
    expect(bears(me, { x: 100, y: 0 }, 'port')).toBe(false);
    expect(bears(me, { x: -100, y: 30 }, 'port')).toBe(true);
    expect(bears(me, { x: 100, y: 100 * Math.tan((BEAR_ARC + 4) * D2R) }, 'starboard')).toBe(false);
    expect(bears(me, { x: 0, y: 200 }, 'starboard')).toBe(false);
    expect(bears(me, { x: MAX_RANGE + 50, y: 0 }, 'starboard')).toBe(false);
  });

  it('hits less at long range, on a ship end-on, in a sea, and with a poor crew', () => {
    expect(hitChance(shot({ range: 50 }))).toBeGreaterThan(hitChance(shot({ range: 150 })));
    expect(hitChance(shot({ range: 150 }))).toBeGreaterThan(hitChance(shot({ range: 400 })) * 2);
    expect(hitChance(shot({ range: MAX_RANGE + 1 }))).toBe(0);
    expect(hitChance(shot({ aspect: 0 }))).toBeLessThan(hitChance(shot()) * 0.7);
    expect(hitChance(shot({ sea: 3 }))).toBeLessThan(hitChance(shot()) * 0.7);
    expect(hitChance(shot({ gunnery: 0.5 }))).toBeCloseTo(hitChance(shot()) * 0.5, 5);
    // At a cable's length, broadside on, in smooth water, a good crew hits with about half its guns.
    expect(hitChance(shot())).toBeGreaterThan(0.45);
    expect(hitChance(shot())).toBeLessThan(0.65);
  });

  it('points the lee battery at the sea and the weather battery at the sky when she heels', () => {
    // Heeled to starboard: the starboard guns are the lee guns.
    expect(heelEffect('starboard', 5 * D2R)).toMatchObject({ chance: 1, lee: true });
    expect(heelEffect('starboard', 11 * D2R).chance).toBeCloseTo(0.5, 5);
    expect(heelEffect('starboard', 16 * D2R).chance).toBe(0);
    expect(heelEffect('port', 16 * D2R).lee).toBe(false);
    expect(heelEffect('port', 16 * D2R).chance).toBeGreaterThan(0.4);
    // The weather guns' shot goes high: into the rigging.
    expect(heelEffect('port', 16 * D2R).aloft).toBeGreaterThan(0.7);
    expect(heelEffect('starboard', 6 * D2R).aloft).toBeLessThan(0.2);
    expect(hitChance(shot({ heel: 16 * D2R }))).toBe(0);
    expect(hitChance(shot({ heel: -16 * D2R }))).toBeGreaterThan(0.2);
  });

  it('rakes a ship taken end-on, worst through the stern', () => {
    expect(aspectEffect(Math.PI / 2, 22, 6.6).rake).toBeNull();
    expect(aspectEffect(0.2, 22, 6.6).rake).toBe('stern');
    expect(aspectEffect(Math.PI - 0.2, 22, 6.6).rake).toBe('bow');
    const sum = (aspect: number) => {
      let hull = 0;
      let men = 0;
      let hits = 0;
      for (let seed = 0; seed < 400; seed++) {
        const h = broadside(4, 4, shot({ aspect, heel: 0 }), seed * 100);
        hull += h.hull;
        men += h.men;
        hits += h.hits;
      }
      return { hull: hull / hits, men: men / hits };
    };
    const beam = sum(Math.PI / 2);
    const stern = sum(0.1);
    expect(stern.hull / beam.hull).toBeGreaterThan(1.3);
    expect(stern.men / beam.men).toBeGreaterThan(1.7);
  });

  it('fires the same broadside for the same seed, and counts every gun', () => {
    const a = broadside(5, 4, shot(), 4242);
    expect(broadside(5, 4, shot(), 4242)).toEqual(a);
    expect(a.each.length).toBe(5);
    expect(a.each.filter(Boolean).length).toBe(a.hits);
    let differs = false;
    for (let s = 1; s < 20 && !differs; s++) differs = broadside(5, 4, shot(), 4242 + s * 100).hits !== a.hits;
    expect(differs).toBe(true);
    // A heavier shot does more.
    const sum = (lb: number) => Array.from({ length: 300 }, (_, i) => broadside(4, lb, shot(), i * 100)).reduce((t, h) => t + h.hull + h.rigging, 0);
    expect(sum(8)).toBeGreaterThan(sum(4) * 1.25);
  });

  it('serves its guns by the men there are to work them', () => {
    expect(gunsServed(6, 32)).toBe(3);
    expect(gunsServed(10, 75)).toBe(5);
    expect(gunsServed(10, 20)).toBe(3);
    expect(gunsServed(6, 8)).toBe(0);
    expect(reloadSeconds(6, 32)).toBe(RELOAD);
    expect(reloadSeconds(10, 14)).toBeGreaterThan(RELOAD * 1.9);
    expect(reloadSeconds(10, 2)).toBe(RELOAD * 3);
    expect(driveLeft(100)).toBe(1);
    expect(driveLeft(0)).toBeCloseTo(0.3, 5);
  });
});

describe('boarding', () => {
  const men = (n: number, fight = 1, h = 1) => ({ men: n, fight, heart: h });

  it('is the same fight for the same seed, told in rounds', () => {
    const a = board(men(40, 1.25), men(22, 0.85), 99);
    expect(board(men(40, 1.25), men(22, 0.85), 99)).toEqual(a);
    expect(a.rounds.length).toBeGreaterThan(1);
    expect(a.rounds.length).toBeLessThanOrEqual(7);
    expect(a.attackersLeft).toBeLessThanOrEqual(40);
    expect(a.defendersLeft).toBeLessThan(22);
    expect(a.rounds[a.rounds.length - 1]).toMatchObject({ attackers: a.attackersLeft, defenders: a.defendersLeft });
  });

  it('goes to numbers, to hard men, and to a crew that has not been beaten about', () => {
    const wins = (a: ReturnType<typeof men>, d: ReturnType<typeof men>) => Array.from({ length: 300 }, (_, i) => board(a, d, i * 7 + 1).won).filter(Boolean).length / 300;
    expect(wins(men(60, 1.25), men(20, 0.85))).toBeGreaterThan(0.95);
    expect(wins(men(20, 1.25), men(80, 1.3))).toBeLessThan(0.05);
    expect(boardingOdds(men(40), men(30))).toBeGreaterThan(boardingOdds(men(30), men(30)));
    expect(boardingOdds(men(30, 1.3), men(30))).toBeGreaterThan(boardingOdds(men(30), men(30)));
    expect(boardingOdds(men(30), men(30, 1, 0.3))).toBeGreaterThan(boardingOdds(men(30), men(30)));
    // Men on their own deck are worth more: equal parties favour the defence.
    expect(boardingOdds(men(30), men(30))).toBeLessThan(0.4);
    // The odds shown are about the odds had.
    const odds = boardingOdds(men(32, 1.25), men(22, 0.85));
    expect(Math.abs(wins(men(32, 1.25), men(22, 0.85)) - odds)).toBeLessThan(0.3);
    expect(heart(1, 1)).toBe(1);
    expect(heart(0.3, 0.5)).toBeLessThan(0.5);
  });
});

describe('prizes and prices', () => {
  it('finds the same things in the same ship, within what she could carry', () => {
    for (const cls of SHIP_CLASSES.filter((c) => c.kind === 'merchant')) {
      for (const lane of LANES.filter((l) => l.cargo.length)) {
        for (let seed = 1; seed < 40; seed++) {
          const p = prizeContents(cls, lane, seed * 7919);
          expect(prizeContents(cls, lane, seed * 7919)).toEqual(p);
          expect(p.coin).toBeGreaterThanOrEqual(cls.coin[0]);
          expect(p.coin).toBeLessThanOrEqual(cls.coin[1]);
          expect(holdTons(p.cargo)).toBeLessThanOrEqual(cls.cargoTons);
          expect(holdTons(p.cargo)).toBeGreaterThan(0);
          for (const good of Object.keys(p.cargo)) expect(lane.cargo.map((c) => c[0])).toContain(good);
        }
      }
    }
  });

  it('turns up artifacts now and then, never one already in the cabinet', () => {
    expect(ARTIFACTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ARTIFACTS.map((a) => a.id)).size).toBe(ARTIFACTS.length);
    const rich = shipClass('register-ship');
    const plain = shipClass('trading-sloop');
    const lane = LANES[0];
    const found = (cls: typeof rich, owned: string[] = []) => Array.from({ length: 500 }, (_, i) => prizeContents(cls, lane, i * 31 + 5, owned).artifact).filter(Boolean);
    expect(found(rich).length / 500).toBeGreaterThan(0.5);
    expect(found(plain).length / 500).toBeLessThan(0.12);
    const owned = ARTIFACTS.slice(0, ARTIFACTS.length - 1).map((a) => a.id);
    for (const a of found(rich, owned)) expect(a!.id).toBe(ARTIFACTS[ARTIFACTS.length - 1].id);
    expect(found(rich, ARTIFACTS.map((a) => a.id)).length).toBe(0);
  });

  it('stows the dearest goods first and no more than there is room for', () => {
    const own = { sugar: 10 };
    const taken = stow(own, 45, { sugar: 60, indigo: 20, silver: 5 });
    expect(taken).toEqual({ silver: 5, indigo: 20, sugar: 10 });
    expect(holdTons(own)).toBe(45);
    expect(stow(own, 45, { cloth: 5 })).toEqual({});
  });

  it('pays differently for the same goods in different ports', () => {
    const [royal, tortuga, santiago] = PORTS;
    expect(price('sugar', royal, 3, 7)).toBeLessThan(price('sugar', tortuga, 3, 7));
    expect(price('cloth', santiago, 3, 7)).toBeGreaterThan(price('cloth', royal, 3, 7));
    expect(price('rum', tortuga, 3, 7)).toBeGreaterThan(price('rum', royal, 3, 7));
    expect(price('rum', tortuga, 3, 7)).toBe(price('rum', tortuga, 4, 7));
    for (const g of GOODS) for (const p of PORTS) expect(price(g.id, p, 10, 3)).toBeGreaterThan(0);
  });

  it('charges for repairs, finds men for a name that is talked of, and shuts a port to a notorious ship', () => {
    const [royal, , santiago, vache] = PORTS;
    expect(repairCost(royal, 50, 0)).toBe(200);
    expect(repairCost(vache, 50, 0)).toBeLessThan(repairCost(royal, 50, 0));
    expect(menForHire(santiago, 50, 3, 7)).toBe(0);
    expect(menForHire(royal, 60, 3, 7)).toBeGreaterThan(menForHire(royal, 0, 3, 7));
    expect(portShut(santiago, 5)).toBe(false);
    expect(portShut(santiago, 12)).toBe(true);
    expect(portShut(royal, 39)).toBe(false);
    expect(portShut(royal, 40)).toBe(true);
    expect(portShut(vache, 100)).toBe(false);
  });
});

describe('ships on the sea lanes', () => {
  it('are the same ships in the same places for the same time and seed', () => {
    const a = shipsAt(sea.lanes, 50 * 3600, 7);
    expect(shipsAt(sea.lanes, 50 * 3600, 7)).toEqual(a);
    expect(shipsAt(sea.lanes, 50 * 3600, 8).map((s) => `${s.id}${Math.round(s.x)}`)).not.toEqual(a.map((s) => `${s.id}${Math.round(s.x)}`));
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
  });

  it('keep the sea peopled: a few dozen sail at any hour, in deep water, with a cruiser on every beat', () => {
    for (const hour of [1, 37, 200, 911, 2500]) {
      const ships = shipsAt(sea.lanes, hour * 3600, 7);
      expect(ships.length).toBeGreaterThan(20);
      expect(ships.length).toBeLessThan(90);
      for (const s of ships) expect(sea.world.chartDepth(s.x, s.y), s.id).toBeGreaterThan(9);
      for (const lane of sea.lanes.filter((l) => l.patrol)) expect(ships.filter((s) => s.lane.id === lane.id).length).toBe(1);
    }
  });

  it('move along their lanes at the speed they make good', () => {
    const t = 100 * 3600;
    const now = shipsAt(sea.lanes, t, 7);
    const later = shipsAt(sea.lanes, t + 600, 7);
    let checked = 0;
    for (const s of now) {
      const n = later.find((o) => o.id === s.id);
      if (!n || s.lane.patrol) continue;
      const run = Math.hypot(n.x - s.x, n.y - s.y);
      expect(run).toBeLessThanOrEqual(s.speed * 600 + 1);
      expect(run).toBeGreaterThan(s.speed * 600 * 0.7);
      expect(s.speed / KT).toBeGreaterThan(2.5);
      expect(s.speed / KT).toBeLessThan(7);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('sail by a plain rule: nothing in the wind\'s eye, a sloop closer than a ship, a ship best with the wind aft', () => {
    const sloopClass = shipClass('trading-sloop');
    const ship = shipClass('merchantman');
    expect(shipSpeed(ship, 30, 15)).toBe(0);
    expect(shipSpeed(sloopClass, 55, 15)).toBeGreaterThan(0);
    expect(shipSpeed(ship, 55, 15)).toBeLessThan(shipSpeed(sloopClass, 55, 15));
    expect(shipSpeed(ship, 180, 15) / shipSpeed(ship, 130, 15)).toBeCloseTo(1, 5);
    expect(shipSpeed(sloopClass, 180, 15)).toBeLessThan(shipSpeed(sloopClass, 130, 15));
    expect(shipSpeed(ship, 130, 17) / KT).toBeCloseTo(ship.maxKt, 1);
    expect(shipSpeed(ship, 130, 8)).toBeLessThan(shipSpeed(ship, 130, 17) * 0.7);
  });
});

describe('the look-out', () => {
  const brig = shipClass('brigantine');

  it('raises her upper sails first, then her hull, then her colours', () => {
    expect(horizon(19) / 1852).toBeCloseTo(8.4, 0);
    expect(sight(40000, brig, SEE)).toBeNull();
    expect(sight(24000, brig, SEE)).toBe('tops');
    expect(sight(10000, brig, SEE)).toBe('hull');
    expect(sight(4000, brig, SEE)).toBe('colours');
    expect(sight(900, brig, SEE)).toBe('close');
    // A bigger ship is raised further off than a small one.
    const far = (cls: typeof brig) => { let r = 60000; while (r > 0 && !sight(r, cls, SEE)) r -= 250; return r; };
    expect(far(shipClass('register-ship'))).toBeGreaterThan(far(shipClass('trading-sloop')));
  });

  it('sees little at night or in a squall', () => {
    expect(visibility(0.8, 0.2)).toBeGreaterThan(30000);
    expect(visibility(0.8, 1)).toBeLessThan(10000);
    expect(visibility(-0.3, 0.2)).toBeLessThan(5000);
    expect(sight(10000, brig, { ...SEE, air: visibility(-0.3, 0.2) })).toBeNull();
  });

  it('says only what could be made out', () => {
    expect(lying(0, 0)).toContain('stern to us');
    expect(lying(0, Math.PI)).toContain('bows on');
    expect(lying(0, Math.PI / 2)).toContain('broadside on');
    const tops = describeSail('tops', brig, 'english', 22000, 1, 2);
    expect(tops).toContain('hull down');
    expect(tops).not.toContain('English');
    expect(tops).not.toContain('brigantine');
    expect(describeSail('hull', brig, 'english', 9000, 1, 2)).toContain('brigantine');
    expect(describeSail('colours', brig, 'spanish', 4000, 1, 2)).toContain('Burgundy');
    expect(describeSail('close', brig, 'english', 500, 1, 2)).toContain('8 guns');
  });
});

describe('the career', () => {
  it('is read back only if every field is sound', () => {
    const c = fitOut(freshCareer());
    expect(readCareer(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(readCareer(null)).toBeNull();
    expect(readCareer({ ...c, v: 2 })).toBeNull();
    expect(readCareer({ ...c, banked: -5 })).toBeNull();
    expect(readCareer({ ...c, banked: Number.NaN })).toBeNull();
    expect(readCareer({ ...c, notoriety: 400 })).toBeNull();
    expect(readCareer({ ...c, artifacts: ['crown-jewels'] })).toBeNull();
    expect(readCareer({ ...c, artifacts: ['astrolabe', 'astrolabe'] })).toBeNull();
    expect(readCareer({ ...c, port: 'atlantis' })).toBeNull();
    expect(readCareer({ ...c, ship: { ...c.ship!, guns: 64 } })).toBeNull();
    expect(readCareer({ ...c, ship: { ...c.ship!, hull: 0 } })).toBeNull();
    expect(readCareer({ ...c, ship: { ...c.ship!, hold: { silver: 4000 } } })).toBeNull();
    expect(readCareer({ ...c, ship: { ...c.ship!, hold: { unobtainium: 1 } } })).toBeNull();
    expect(readCareer({ ...c, ship: null })).toEqual({ ...c, ship: null });
  });

  it('keeps the cabinet and half the bank when the sloop is lost', () => {
    const c = { ...fitOut(freshCareer()), banked: 3000, notoriety: 60, artifacts: ['astrolabe', 'jade-mask'] };
    c.ship!.coin = 900;
    c.ship!.hold = { indigo: 20 };
    const after = afterLoss(c);
    expect(after.ship).toBeNull();
    expect(after.banked).toBe(1500);
    expect(after.artifacts).toEqual(['astrolabe', 'jade-mask']);
    expect(after.notoriety).toBe(30);
    expect(after.lost).toBe(1);
    expect(afterLoss({ ...c, banked: 40 }).banked).toBe(STARTING_PURSE);
    const again = fitOut(after);
    expect(again.ship).toMatchObject({ hull: 100, rigging: 100, coin: 0, hold: {} });
    expect(riches(c)).toBe(3000 + 900 + 240 + 600);
  });
});

describe('the game', () => {
  const env: Env = { wind: () => ({ dir: 80 * D2R, speed: 15 * KT }), depth: () => 300, sea: 1, sun: 0.9, cloud: 0.2 };
  const start = sea.sea.starts[0];
  const me = (over: Partial<Me> = {}): Me => ({ x: start.x, y: start.y, heading: 0, heel: 0, speed: 3, t: 0, ...over });
  const game = (notoriety = 0) => {
    const career = fitOut(freshCareer());
    career.notoriety = notoriety;
    return new PirateGame(sea, 7, career);
  };

  it('strikes sooner for a timid ship, a beaten one, or one outmatched close aboard', () => {
    const count = (courage: number, hull: number, crew: number, over: number) => Array.from({ length: 200 }, (_, i) => strikes({ courage }, hull, crew, 1, over, i * 13)).filter(Boolean).length;
    expect(count(0.12, 1, 1, 6)).toBe(200);
    expect(count(0.85, 1, 1, 6)).toBe(0);
    expect(count(0.4, 0.3, 0.6, 0)).toBe(200);
    expect(count(0.4, 0.95, 1, 0)).toBe(0);
    expect(count(0.24, 0.8, 1, 2.5)).toBeGreaterThan(count(0.24, 0.8, 1, 0));
  });

  it('puts a sail in sight when the cruise begins, and she runs when she sees what the sloop is', () => {
    const g = game();
    g.step(1, me(), env, SEE);
    const first = g.ships.get('opening#0')!;
    expect(first).toBeDefined();
    expect(first.range).toBeGreaterThan(4000);
    expect(first.range).toBeLessThan(9000);
    expect(first.seen).not.toBeNull();
    expect(g.drain().some((e) => e.kind === 'sight' && e.first)).toBe(true);
    expect(first.mood).toBe('cruise');
    // Come up to within two miles of her.
    const near = me({ x: first.x - 2000, y: first.y });
    for (let i = 0; i < 30; i++) g.step(1, near, env, SEE);
    expect(first.mood).toBe('flee');
  });

  it('takes a trading sloop that strikes to a broadside close aboard, and makes a name by it', () => {
    const g = game();
    const at = me();
    const ship = g.spawn('trading-sloop', 'english', at.x + 90, at.y, 0, 'flee');
    ship.seen = 'close';
    g.step(0.5, at, env, SEE);
    expect(g.bearsOn('starboard', at)).toBe(ship);
    expect(g.bearsOn('port', at)).toBeNull();
    expect(g.fire('port', at, env)).toBe(false);
    expect(g.fire('starboard', at, env)).toBe(true);
    expect(g.reload.starboard).toBe(RELOAD);
    // Not loaded yet.
    expect(g.fire('starboard', at, env)).toBe(false);
    expect(ship.mood).toBe('struck');
    const before = g.own.coin;
    // A ship that has struck is taken by the boat from a cable off, however fast the sloop is going by.
    ship.x = at.x + 400;
    g.step(0.5, at, env, SEE);
    expect(g.boardable(at).ship).toBeNull();
    ship.x = at.x + 140;
    ship.speed = 0;
    g.step(0.5, { ...at, speed: 4 }, env, SEE);
    expect(g.board({ ...at, speed: 4 })).toBe(true);
    expect(g.own.coin).toBeGreaterThan(before);
    expect(holdTons(g.own.hold)).toBeGreaterThan(0);
    expect(holdTons(g.own.hold)).toBeLessThanOrEqual(g.cls.cargoTons);
    expect(g.career.notoriety).toBeGreaterThan(3);
    expect(g.career.prizes).toBe(1);
    expect(g.drain().some((e) => e.kind === 'prize')).toBe(true);
    g.step(1, at, env, SEE);
    expect(g.ships.has(ship.id)).toBe(false);
  });

  it('cannot board a ship that is too far off or going by too fast', () => {
    const g = game();
    const at = me();
    const ship = g.spawn('brigantine', 'english', at.x + 200, at.y, 0, 'flee');
    ship.seen = 'close';
    g.step(0.5, at, env, SEE);
    expect(g.boardable(at).ship).toBeNull();
    expect(g.boardable(at).why).toContain('Too far');
    ship.x = at.x + 30;
    ship.speed = 0;
    g.step(0.1, { ...at, speed: 6 }, env, SEE);
    expect(g.boardable({ ...at, speed: 6 }).why).toContain('too fast');
  });

  it('is hunted by a cruiser once the sloop is talked of, and fired on when the cruiser bears', () => {
    const quiet = game(0);
    const at = me();
    const peaceful = quiet.spawn('navy-sloop', 'english', at.x + 150, at.y, 0, 'cruise');
    peaceful.firedOn = false;
    expect(quiet.hostile(peaceful)).toBe(false);
    const g = game(30);
    const hunter = g.spawn('navy-sloop', 'english', at.x + 150, at.y, 0, 'cruise');
    hunter.firedOn = false;
    hunter.seen = 'close';
    expect(g.hostile(hunter)).toBe(true);
    const hull = g.own.hull;
    for (let i = 0; i < 400 && !g.ended; i++) g.step(1, at, env, SEE);
    expect(hunter.mood === 'fight' || g.ended !== null).toBe(true);
    expect(g.drain().some((e) => e.kind === 'fire' && !e.mine)).toBe(true);
    expect(g.own.hull).toBeLessThan(hull);
  });

  it('is fired on by the fort of a port that is shut to her, and banks what she brings to one that is not', () => {
    const g = game(50);
    const santiago = sea.ports.find((p) => p.id === 'santiago')!;
    expect(g.isShut(santiago)).toBe(true);
    const off = me({ x: santiago.x, y: santiago.y, speed: 0 });
    let fired = false;
    for (let i = 0; i < 200 && !fired; i++) {
      g.step(1, off, env, SEE);
      fired = g.drain().some((e) => e.kind === 'fire' && e.fort === true);
    }
    expect(fired).toBe(true);
    const vache = sea.ports.find((p) => p.id === 'ile-a-vache')!;
    expect(g.isShut(vache)).toBe(false);
    const lying = me({ x: vache.x + 200, y: vache.y, speed: 0.3 });
    expect(g.portAt(lying)).toBe(vache);
    expect(g.portAt({ ...lying, speed: 4 })).toBeNull();
    g.own.coin = 500;
    g.own.hold = { indigo: 10 };
    const banked = g.career.banked;
    g.enter(vache);
    expect(g.career.banked).toBe(banked + 500);
    expect(g.own.coin).toBe(0);
    const got = g.sell('indigo', vache, 0);
    expect(got).toBe(10 * g.priceOf('indigo', vache, 0));
    expect(g.own.hold.indigo).toBeUndefined();
    g.own.hull = 60;
    const bill = g.repairBill(vache);
    expect(g.repair(vache)).toBe(bill);
    expect(g.own.hull).toBe(100);
    const rumour = g.hearRumour(0);
    expect(rumour).not.toBeNull();
    expect(LANES.map((l) => l.rumour)).toContain(rumour!.text);
  });

  it('loses the sloop when she is shot to pieces', () => {
    const g = game(60);
    const at = me();
    g.own.hull = 6;
    const hunter = g.spawn('navy-sloop', 'english', at.x + 60, at.y, 0, 'fight');
    hunter.seen = 'close';
    for (let i = 0; i < 600 && !g.ended; i++) g.step(1, at, env, SEE);
    expect(g.ended === 'sunk' || g.ended === 'taken').toBe(true);
    expect(g.drain().some((e) => e.kind === 'lost')).toBe(true);
  });
});
