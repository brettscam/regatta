// Play the pirate game with no drawing: a chase, a fight and a port visit, and then a set of duels to see how the
// starting sloop does against each kind of ship. For tuning the guns, the boarding and the purses.
// Run with: npx vite-node scripts/corsair.ts [seed] [cruise|duels|all] [duels per kind]
//
// The sloop is sailed by the real sim with a hand on the helm that does what a sensible player would: steer to cut
// the chase off, range up on her quarter, fire each broadside as it bears, and board when the odds are better than
// even or she has struck. It uses the same game (`apps/client/src/expedition/pirates/game.ts`) the browser does.
import { D2R, KT, R2D, SIM_DT, Sim, wrapPi, wrapTau, type BoatSpec } from '../packages/sim/src';
import sloop from '../boats/jamaica-sloop.json';
import { boardingOdds } from '../apps/client/src/expedition/pirates/boarding';
import { buildCaribbean, SEA_GAIN, type Caribbean } from '../apps/client/src/expedition/pirates/caribbean';
import { fitOut, freshCareer, riches, type Career } from '../apps/client/src/expedition/pirates/career';
import { PirateGame, heart, type Env, type GameEvent, type LiveShip, type Me } from '../apps/client/src/expedition/pirates/game';
import { BEAR_ARC } from '../apps/client/src/expedition/pirates/gunnery';
import { holdTons } from '../apps/client/src/expedition/pirates/loot';
import { significantHeight } from '../apps/client/src/expedition/swell';

// localStorage does not exist here. The game saves through it and shrugs when it is missing.
const spec = sloop as unknown as BoatSpec;
const seed = Number(process.argv[2] ?? 7);
const what = process.argv[3] ?? 'all';
const trials = Number(process.argv[4] ?? 12);
const SEE = { masthead: 19, deck: 4, air: 38000 };

interface Hand {
  sim: Sim;
  game: PirateGame;
  env: Env;
  me(): Me;
  log: string[];
}

function ship(sea: Caribbean, career: Career, gameSeed: number, at: { x: number; y: number }, headingDeg: number): Hand {
  const sim = new Sim(structuredClone(spec), sea.world, { x: at.x, y: at.y, headingDeg, speedKt: 5 });
  sim.setCrewTrim(true);
  sim.trimForWind();
  sim.setHelm('heading', headingDeg * D2R);
  const game = new PirateGame(sea, gameSeed, career);
  const env: Env = {
    wind: (x, y) => sea.world.wind(x, y, sim.state.t),
    depth: (x, y) => sea.world.chartDepth(x, y),
    get sea() { return significantHeight(sea.world.wind(sim.state.x, sim.state.y, sim.state.t).speed / KT, SEA_GAIN); },
    sun: 0.8,
    cloud: 0.2,
  };
  const me = (): Me => ({ x: sim.state.x, y: sim.state.y, heading: sim.state.heading, heel: sim.state.heel, speed: sim.state.speed, t: sim.state.t });
  return { sim, game, env, me, log: [] };
}

/** The heading that will hold a course, or the nearer tack when it lies too close to the wind. */
function lie(h: Hand, course: number): number {
  const wind = h.env.wind(h.sim.state.x, h.sim.state.y);
  const twa = wrapPi(wind.dir - course);
  return Math.abs(twa) < 52 * D2R ? wrapTau(wind.dir - Math.sign(twa || 1) * 52 * D2R) : wrapTau(course);
}

/** One second of the hand on the helm against one ship. Returns what happened in it. */
function handle(h: Hand, foe: LiveShip, wantBoard: boolean): GameEvent[] {
  const s = h.sim.state;
  const me = h.me();
  const toHer = Math.atan2(foe.x - s.x, foe.y - s.y);
  const ours = { men: h.game.own.crew, fight: h.game.cls.fight, heart: heart(h.game.own.hull / h.game.cls.hull, Math.min(1, h.game.own.crew / h.game.cls.crew)) };
  const hers = { men: foe.crew, fight: foe.cls.fight, heart: heart(foe.hull / foe.cls.hull, foe.crew / foe.cls.crew) };
  const boardNow = wantBoard && (foe.mood === 'struck' || boardingOdds(ours, hers) > 0.75);
  let course: number;
  const side = Math.sign(wrapPi(toHer - foe.heading)) || 1;
  if (boardNow) {
    // Lay her aboard: for her quarter, then onto her course.
    const lead = Math.min(120, foe.range / Math.max(2, s.speed + 1)) * (foe.range < 150 ? 0.3 : 0.8);
    course = Math.atan2(foe.x + Math.sin(foe.heading) * foe.speed * lead - s.x, foe.y + Math.cos(foe.heading) * foe.speed * lead - s.y);
    if (foe.range < 90) course = foe.heading + wrapPi(toHer - foe.heading) * 0.35;
  } else {
    // Range up alongside her, a hundred yards off on the side we are already on, and let the guns bear as we draw level.
    const lead = Math.min(120, foe.range / Math.max(2, s.speed + 1)) * 0.8;
    const off = foe.range > 1200 ? 0 : 90;
    const px = foe.x + Math.sin(foe.heading) * foe.speed * lead - Math.cos(foe.heading) * off * side;
    const py = foe.y + Math.cos(foe.heading) * foe.speed * lead + Math.sin(foe.heading) * off * side;
    course = Math.hypot(px - s.x, py - s.y) < 60 ? foe.heading : Math.atan2(px - s.x, py - s.y);
  }
  h.sim.setHelm('heading', lie(h, course));
  // Alongside to board, spill wind so as not to go by her.
  const slow = boardNow && foe.range < 120 && s.speed > foe.speed + 1.2;
  h.sim.state.reef = slow ? 2 : 0;
  h.sim.state.furl = slow ? 0 : 1;
  for (let i = 0; i < Math.round(1 / SIM_DT); i++) h.sim.step();
  h.game.step(1, h.me(), h.env, SEE);
  for (const side of ['port', 'starboard'] as const) {
    if (h.game.reload[side] <= 0 && h.game.bearsOn(side, h.me()) === foe && foe.mood !== 'struck' && !(boardNow && foe.range < 60)) h.game.fire(side, h.me(), h.env);
  }
  if ((boardNow || foe.mood === 'struck') && h.game.boardable(h.me()).ship === foe) h.game.board(h.me());
  void me;
  return h.game.drain();
}

function tell(h: Hand, events: GameEvent[], quiet = false): void {
  const at = `${(h.sim.state.t / 60).toFixed(1).padStart(6)} min`;
  for (const e of events) {
    let line = '';
    if (e.kind === 'say') line = e.text;
    else if (e.kind === 'sight') line = `LOOK-OUT: ${e.text}`;
    else if (e.kind === 'fire') line = `${e.mine ? 'WE FIRE' : e.fort ? 'THE FORT FIRES' : 'SHE FIRES'} ${e.side}, ${Math.round(e.range)} m: ${e.harm.hits}/${e.harm.fired} hit, hull ${e.harm.hull.toFixed(0)}, rigging ${e.harm.rigging.toFixed(0)}, men ${e.harm.men}`;
    else if (e.kind === 'boarding') line = `BOARDING (${e.mine ? 'we board' : 'they board'}, odds ${(e.odds * 100).toFixed(0)}%): ${e.result.rounds.map((r) => `${r.attackers}v${r.defenders}`).join(' ')} -> ${e.result.won ? 'carried' : 'beaten back'}`;
    else if (e.kind === 'prize') line = `PRIZE: ${e.ship.cls.name}: ${e.prize.coin} coin, ${Object.entries(e.taken).map(([g, t]) => `${t} t ${g}`).join(', ') || 'no cargo'}${e.prize.artifact ? `, and ${e.prize.artifact.name}` : ''}${e.joined ? `, ${e.joined} men join` : ''}${e.gunsTaken ? ', two guns swayed across' : ''}`;
    else if (e.kind === 'sunk') line = `SUNK: the ${e.ship.cls.name}`;
    else if (e.kind === 'lost') line = `LOST: ${e.why}`;
    h.log.push(`${at}  ${line}`);
    if (!quiet) console.log(`${at}  ${line}`);
  }
}

// ---- a cruise: the opening chase, the fight, and back to Port Royal -------------------------------------------------

function cruise(): void {
  const sea = buildCaribbean(seed);
  const career = fitOut(freshCareer());
  const start = sea.sea.starts[0];
  const h = ship(sea, career, seed, start, 150);
  const own = h.game.own;
  console.log(`\n=== A cruise, seed ${seed}. ${own.guns} guns, ${own.crew} men, ${career.banked} coin ashore ===`);
  const w = h.env.wind(start.x, start.y);
  console.log(`Wind ${Math.round(w.dir * R2D)} deg, ${(w.speed / KT).toFixed(0)} kt. Sea ${h.env.sea.toFixed(1)} m.`);
  let foe: LiveShip | null = null;
  let sightedAt = -1;
  let firstShot = -1;
  let taken = -1;
  for (let sec = 0; sec < 4 * 3600 && !h.game.ended && taken < 0; sec++) {
    foe = h.game.ships.get('opening#0') ?? foe;
    let events: GameEvent[];
    if (foe && foe.seen) events = handle(h, foe, true);
    else {
      h.sim.setHelm('heading', lie(h, 196 * D2R));
      for (let i = 0; i < Math.round(1 / SIM_DT); i++) h.sim.step();
      h.game.step(1, h.me(), h.env, SEE);
      events = h.game.drain();
    }
    tell(h, events);
    if (process.env.TRACE && sec % 300 === 0 && foe) console.log(`   t ${sec} range ${Math.round(foe.range)} mood ${foe.mood} her hdg ${Math.round(foe.heading * R2D)} spd ${(foe.speed / KT).toFixed(1)} | our hdg ${Math.round(h.sim.state.heading * R2D)} spd ${(h.sim.state.speed / KT).toFixed(1)} seen ${foe.seen}`);
    if (sightedAt < 0 && events.some((e) => e.kind === 'sight')) sightedAt = h.sim.state.t;
    if (firstShot < 0 && events.some((e) => e.kind === 'fire')) firstShot = h.sim.state.t;
    if (events.some((e) => e.kind === 'prize')) taken = h.sim.state.t;
  }
  console.log(`First sail sighted after ${(sightedAt / 60).toFixed(1)} min. First gun after ${(firstShot / 60).toFixed(1)} min. Prize ${taken < 0 ? 'not taken' : `taken after ${(taken / 60).toFixed(1)} min`}: the fight itself lasted ${((taken - firstShot) / 60).toFixed(1)} min.`);
  console.log(`After it: hull ${own.hull.toFixed(0)}, rigging ${own.rigging.toFixed(0)}, ${own.crew} men, ${own.guns} guns, ${own.coin} coin aboard, ${holdTons(own.hold)} t in the hold, notoriety ${career.notoriety}.`);

  // Back to Port Royal. The passage is sailed by the sim at a second a step, which is slow but is the real thing.
  const port = sea.ports.find((p) => p.id === 'port-royal')!;
  const t0 = h.sim.state.t;
  h.sim.state.reef = 0;
  h.sim.state.furl = 1;
  for (let sec = 0; sec < 30 * 3600 && !h.game.ended; sec++) {
    const s = h.sim.state;
    const d = Math.hypot(port.x - s.x, port.y - s.y);
    if (d < 700) break;
    h.sim.setHelm('heading', lie(h, Math.atan2(port.x - s.x, port.y - s.y)));
    // A beat is sailed in long boards: stand on each tack for a while before asking again.
    for (let i = 0; i < Math.round(1 / SIM_DT) * (d > 3000 ? 600 : 20); i++) h.sim.step();
    sec += d > 3000 ? 599 : 19;
    h.game.step(d > 3000 ? 600 : 20, h.me(), h.env, SEE);
    h.game.drain();
  }
  h.sim.state.speed = 0;
  const at = h.game.portAt(h.me());
  console.log(`\nBack off Port Royal after ${((h.sim.state.t - t0) / 3600).toFixed(1)} h. ${at ? 'In the anchorage.' : 'NOT in the anchorage: ' + Math.round(Math.hypot(port.x - h.sim.state.x, port.y - h.sim.state.y)) + ' m off.'} Port ${h.game.isShut(port) ? 'SHUT' : 'open'}.`);
  if (at) {
    h.game.enter(at);
    let sold = 0;
    for (const good of Object.keys(own.hold)) {
      const tons = own.hold[good];
      const each = h.game.priceOf(good, at, h.sim.state.t);
      const got = h.game.sell(good, at, h.sim.state.t);
      console.log(`  sold ${tons} t ${good} at ${each} = ${got}`);
      sold += got;
    }
    const bill = h.game.repairBill(at);
    const paid = h.game.repair(at);
    const men = h.game.recruit(at, h.sim.state.t, 99);
    const guns = h.game.buyGuns(at);
    const rumour = h.game.hearRumour(h.sim.state.t);
    console.log(`  cargo fetched ${sold}. Repairs: bill ${bill}, paid ${paid}. Signed on ${men} men. ${guns ? 'Bought a pair of guns.' : 'No guns bought.'}`);
    console.log(`  rumour: ${rumour?.text ?? 'none'}`);
    console.log(`  now: hull ${own.hull.toFixed(0)}, rigging ${own.rigging.toFixed(0)}, ${own.crew} men, ${own.guns} guns, ${career.banked} banked, riches ${riches(career)}.`);
  }
}

// ---- duels: the sloop against one ship of a kind, many times ----------------------------------------------------------

interface Kit { name: string; guns: number; crew: number }

function duel(sea: Caribbean, kind: string, kit: Kit, n: number): { win: number; lose: number; draw: number; minutes: number; chase: number; hullLeft: number; menLost: number } {
  const start = sea.sea.starts[0];
  // Open water south of Jamaica.
  const at = { x: start.x, y: start.y - 40000 };
  const career = fitOut(freshCareer());
  career.ship!.guns = kit.guns;
  career.ship!.crew = kit.crew;
  const h = ship(sea, career, seed * 1000 + n, at, 200 + (n % 5) * 30);
  // She starts half a mile off, sometimes to windward of us and sometimes to leeward.
  const wind = h.env.wind(at.x, at.y);
  const off = wind.dir + (n % 2 ? 0 : Math.PI) + ((n % 3) - 1) * 0.6;
  const warlike = kind === 'navy-sloop' || kind === 'guarda-costa' || kind === 'rover';
  const foe = h.game.spawn(kind, 'english', at.x + Math.sin(off) * 900, at.y + Math.cos(off) * 900, wrapTau(wind.dir + Math.PI + 0.5), warlike ? 'fight' : 'flee');
  foe.seen = 'close';
  const men0 = h.game.own.crew;
  let result: 'win' | 'lose' | 'draw' = 'draw';
  let sec = 0;
  let closed = -1;
  for (; sec < 45 * 60; sec++) {
    const events = handle(h, foe, true);
    if (closed < 0 && foe.range < 400) closed = sec;
    tell(h, events, true);
    if (h.game.ended) { result = 'lose'; break; }
    if (events.some((e) => e.kind === 'prize' || e.kind === 'sunk')) { result = 'win'; break; }
    // A man-of-war that hauls off beaten is a fight won, if not a prize.
    if (warlike && foe.mood === 'flee' && foe.range > 1500) { result = 'win'; break; }
    if (foe.range > 6000) break;
  }
  if (process.env.DUEL_LOG && n === 0) console.log(h.log.join('\n'));
  return { win: +(result === 'win'), lose: +(result === 'lose'), draw: +(result === 'draw'), minutes: closed < 0 ? 0 : (sec - closed) / 60, chase: (closed < 0 ? sec : closed) / 60, hullLeft: h.game.own.hull, menLost: men0 - h.game.own.crew };
}

function duels(): void {
  const sea = buildCaribbean(seed);
  const kits: Kit[] = [{ name: 'starting kit, 6 guns 32 men', guns: 6, crew: 32 }, { name: 'fitted out, 10 guns 75 men', guns: 10, crew: 75 }];
  const kinds = (process.env.KINDS ?? 'trading-sloop,brigantine,merchantman,register-ship,guarda-costa,rover,navy-sloop').split(',');
  for (const kit of kits) {
    console.log(`\n=== Duels with the ${kit.name}: ${trials} of each ===`);
    for (const kind of kinds) {
      const sum = { win: 0, lose: 0, draw: 0, minutes: 0, chase: 0, hullLeft: 0, menLost: 0 };
      for (let n = 0; n < trials; n++) {
        const r = duel(sea, kind, kit, n);
        for (const k of Object.keys(sum) as Array<keyof typeof sum>) sum[k] += r[k];
      }
      console.log(`${kind.padEnd(14)} won ${String(sum.win).padStart(2)}  lost ${String(sum.lose).padStart(2)}  no end ${String(sum.draw).padStart(2)}   chase ${(sum.chase / trials).toFixed(1).padStart(5)} min, fight ${(sum.minutes / trials).toFixed(1).padStart(5)} min   hull left ${(sum.hullLeft / trials).toFixed(0).padStart(3)}   men lost ${(sum.menLost / trials).toFixed(1)}`);
    }
  }
}

if (what === 'cruise' || what === 'all') cruise();
if (what === 'duels' || what === 'all') duels();
