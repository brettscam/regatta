import { describe, expect, it } from 'vitest';
import { Sim, KT, D2R, CRANK_SECONDS, fitOut, leverFor, leverSpeed, milesPerLitre, type BoatFile, type Environment, type SeaSample } from '@slack-tide/sim';
import consoleJson from '../../../boats/console22.json';
import sloopJson from '../../../boats/sloop38.json';
import lineupJson from '../../../boats/lineup.json';
import { throttleStep } from '../src/aboard/engineRules';
import { comfortNote, cruiseMiles, fuelText, leverName, leverSays, leverShare, milesPerGallon, runningWords, tankWarning } from '../src/aboard/powerRules';
import { tendersFor } from '../src/aboard/tenders';
import { TipPicker, emptySnap, freshMemory, type Snap } from '../src/aboard/tipRules';
import { TIPS } from '../src/aboard/tipTable';
import { STRIPS, stripContext } from '../src/data/keys';
import { Pilot } from '../src/input/pilot';
import { ShadedWind, shadowAt } from '../src/race/shadow';
import type { Passage } from '../src/ui/passage';
import { POWER, PowerSeamanship, KIND_NAMES, type Award } from '../src/xp/score';

// What the client makes of the 22 ft centre console: where she is in the lineup, what her throttle says, her one-level
// pilot, the points she earns, and that the things made for sailing boats leave her alone. Her sailing itself
// (speeds, the sea, fuel) is pinned in packages/sim/test/powerboat.test.ts.
const file = consoleJson as unknown as BoatFile & Record<string, unknown>;
const boat = fitOut(file);
const p = boat.power!;
const sloop = fitOut(sloopJson as unknown as BoatFile);
const env = (windKt = 0, sea?: SeaSample): Environment => ({ sample: () => ({ windDir: 0, windSpeed: windKt * KT, currentX: 0, currentY: 0 }), sea: sea ? () => sea : undefined });
const running = (e: Environment = env(), kt = 0): Sim => {
  const sim = new Sim(file, e, { speedKt: 0 });
  sim.underWay(kt);
  return sim;
};

describe('the centre console in the lineup', () => {
  const lineup = lineupJson as Array<{ id: string; status: string; file?: string }>;

  it('is listed as a powerboat, not as a boat ready to sail, so nothing made for sailing boats takes her for one', () => {
    expect(lineup.find((e) => e.id === 'console22')).toMatchObject({ status: 'power', file: 'console22.json' });
    // The classes a race can be sailed in are the ready ones: she is not among them.
    expect(lineup.filter((e) => e.status === 'ready').map((e) => e.id)).not.toContain('console22');
    expect(lineup.filter((e) => e.status === 'ready').length).toBeGreaterThanOrEqual(5);
  });

  it('has what the picker shows, an honest line, and no make on her', () => {
    for (const key of ['tagline', 'role', 'difficulty', 'defaultName', 'homePort']) expect(typeof file[key], key).toBe('string');
    expect(file.lengthFt).toBe(22);
    expect(file.model).toBe('console');
    expect(String(file.tagline)).toBe('22 ft centre console. Fast, thirsty, and at the mercy of the sea state');
    expect(String(file.topsides)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(JSON.stringify(file)).not.toMatch(/mako|whaler|yamaha|mercury|grady|contender|suzuki|evinrude/i);
  });

  it('binds only what she has: a wheel and the pilot head, no boom and no winches', () => {
    expect(boat.controls.map((c) => `${c.node}:${c.control}`).sort()).toEqual(['autopilot:pilot', 'wheel:rudder']);
  });

  it('has working views of her own for keys 1 to 4', () => {
    const views = file.views as Record<string, { target: number[]; dist: number }>;
    for (const name of ['helm', 'mast', 'foredeck', 'drone']) expect(views[name].target.length).toBe(3);
    // A fast small boat is followed from closer than a 38 footer's drone view, and lower.
    expect(views.drone.dist).toBeLessThan(27);
  });

  it('carries the kayak and nothing bigger: she is 22 feet', () => {
    expect(tendersFor(22).map((t) => t.id)).toEqual(['kayak']);
  });
});

describe('the throttle, in words', () => {
  it('names every position: neutral, idle, a share of the lever, wide open', () => {
    expect(leverName(p, 0)).toBe('Neutral');
    expect(leverName(p, p.leverStep)).toBe('Ahead, idle');
    expect(leverName(p, 4)).toBe('Wide open');
    expect(leverName(p, -p.leverStep)).toBe('Astern, idle');
    expect(leverName(p, 2.5)).toBe('Ahead 60%');
    expect(leverName(p, -2)).toMatch(/^Astern \d+%$/);
    expect(leverShare(p, 4)).toBe(1);
    expect(leverShare(p, 0)).toBe(0);
  });

  it('says revs, speed and gallons an hour, and warns of the hump and of flat out', () => {
    expect(leverSays(boat, 0)).toMatch(/^Neutral/);
    const cruise = leverSays(boat, leverFor(p, 26));
    expect(cruise).toMatch(/rpm, about 2[4-8] kt in flat water, 1[0-3] gal an hour$/);
    expect(leverSays(boat, leverFor(p, 12))).toMatch(/on the hump/);
    expect(leverSays(boat, 4)).toMatch(/Wide open.*Flat out/);
    expect(leverSays(boat, -1)).toMatch(/stern/);
    expect(leverSays(sloop, 2)).toBe('');
  });

  it('steps by her lever, a quarter at a time, through neutral to both ends', () => {
    const now = { engineOn: true, cranking: false, hold: 'none' as const, barred: false, step: p.leverStep };
    expect(throttleStep({ ...now, notch: 0 }, 1).to).toBe(0.25);
    expect(throttleStep({ ...now, notch: 0.25 }, -1).to).toBe(0);
    expect(throttleStep({ ...now, notch: 3.75 }, 1).to).toBe(4);
    expect(throttleStep({ ...now, notch: 4 }, 1)).toEqual({ say: 'Wide open already' });
    expect(throttleStep({ ...now, notch: -2 }, -1)).toEqual({ say: 'Full astern already' });
    // A sailing boat's auxiliary is untouched: whole notches, and its own words.
    expect(throttleStep({ engineOn: true, cranking: false, hold: 'none', barred: false, notch: 3 }, 1).to).toBe(4);
    expect(throttleStep({ engineOn: true, cranking: false, hold: 'none', barred: false, notch: 4 }, 1)).toEqual({ say: 'Full ahead already' });
    // Sixteen presses from neutral is wide open.
    const sim = running();
    for (let i = 0; i < 16; i++) sim.setThrottle(throttleStep({ ...now, notch: sim.state.throttle }, 1).to!);
    expect(sim.state.throttle).toBe(4);
  });

  it('what she is doing, in a few words', () => {
    const words = (sim: Sim, pounding = false) => runningWords(p, sim.state, sim.out, pounding);
    const off = new Sim(file, env(), { speedKt: 0 });
    expect(words(off)).toBe('Lying stopped, engine off');
    off.startEngine();
    expect(words(off)).toBe('Starting the engine');
    off.advance(CRANK_SECONDS + 0.1);
    expect(words(off)).toBe('Idling, out of gear');
    off.setThrottle(p.leverStep);
    off.advance(20);
    expect(words(off)).toBe('Idling ahead');
    off.setThrottle(-1);
    off.advance(10);
    expect(words(off)).toBe('Going astern');
    const cruising = running(env(), 26);
    cruising.advance(10);
    expect(words(cruising)).toBe('On the plane');
    expect(words(cruising, true)).toBe('Pounding into it');
    const ploughing = running(env(), 12);
    ploughing.advance(20);
    expect(words(ploughing)).toBe('On the hump, bow up');
    const slow = running(env(), 6);
    slow.advance(10);
    expect(words(slow)).toBe('Under way');
  });
});

describe('fuel, as her skipper is told it', () => {
  it('warns at a half, a third, a fifth and nearly dry, in miles, once each', () => {
    expect(tankWarning(boat, 1, 0.9)).toBeNull();
    expect(tankWarning(boat, 0.51, 0.5)?.text).toMatch(/^Half a tank gone. 125 L, 33 gal: about \d+ miles at cruise/);
    expect(tankWarning(boat, 0.51, 0.5)?.urgent).toBe(false);
    expect(tankWarning(boat, 0.34, 0.33)?.text).toMatch(/A third of a tank left/);
    expect(tankWarning(boat, 0.21, 0.2)?.urgent).toBe(true);
    expect(tankWarning(boat, 0.09, 0.08)?.text).toMatch(/Fuel very low/);
    expect(tankWarning(boat, 0.5, 0.49)).toBeNull();
    expect(tankWarning(sloop, 0.51, 0.5)).toBeNull();
  });

  it('a full tank is about 150 miles at cruise, and miles a gallon come from speed and burn', () => {
    expect(cruiseMiles(boat, 1)).toBeGreaterThan(130);
    expect(cruiseMiles(boat, 1)).toBeLessThan(170);
    expect(milesPerGallon(26, 43.5)).toBeCloseTo(2.26, 1);
    expect(milesPerGallon(0, 1.5)).toBe(0);
    expect(fuelText(250)).toBe('250 L · 66 gal');
  });
});

describe('the sea, as her skipper is told it', () => {
  const chop: SeaSample = { height: 1, length: 20, dir: 0, steepness: 0.05 };

  it('says nothing in flat water, what the sea is good for when she is inside it, and that she is too fast when she is not', () => {
    const calm = running(env(), 26);
    calm.advance(5);
    expect(comfortNote(p, calm.state, calm.out)).toBe('');
    const easy = running(env(0, chop), 10);
    easy.setHelm('heading', 0);
    easy.advance(10);
    expect(comfortNote(p, easy.state, easy.out)).toBe('this sea is good for 16 kt on this heading');
    const hard = running(env(0, chop), 30);
    hard.setHelm('heading', 0);
    hard.advance(3);
    expect(comfortNote(p, hard.state, hard.out)).toBe('too fast for this sea: 16 kt is comfortable');
    // Out of gear there is nothing to advise.
    hard.setThrottle(0);
    expect(comfortNote(p, hard.state, hard.out)).toBe('');
  });
});

describe('one level of autopilot, and no wind angle', () => {
  const marks = [{ x: 0, y: 4000, name: 'Queens Gate', reachedAt: null }];
  const passage = { marks, nextIndex: 0, legOrigin: { x: 0, y: 0 } } as unknown as Passage;
  const make = (route = passage) => {
    const sim = running(env(8), 20);
    const said: string[] = [];
    const pilot = new Pilot(sim, route, { say: (t) => said.push(t), alarm: (t) => said.push(t), racing: () => null });
    return { sim, pilot, said };
  };

  it('P steps on and off: there is no second level, because there is nothing to trim', () => {
    const { sim, pilot, said } = make();
    expect(pilot.level).toBeNull();
    pilot.toggle();
    expect(pilot.level).toBe('partial');
    expect(sim.state.helmMode).toBe('route');
    expect(said.at(-1)).toBe('Pilot steering: steering for Queens Gate. The throttle is yours');
    pilot.toggle();
    expect(pilot.level).toBeNull();
    expect(sim.state.crewTrim).toBe(false);
    expect(said.at(-1)).toBe('Pilot off. You have the helm');
  });

  it('Shift+P steps between a heading and the route, and never offers the wind', () => {
    const { sim, pilot } = make();
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      pilot.cycle();
      seen.add(pilot.mode);
    }
    expect([...seen].sort()).toEqual(['heading', 'route']);
    pilot.toggle();
    for (let i = 0; i < 4; i++) {
      pilot.cycle();
      expect(sim.state.helmMode).not.toBe('wind');
    }
  });

  it('the readout line does not speak of trimming', () => {
    const { pilot } = make();
    expect(pilot.line()).toBe('Helm <b>in hand</b> · pilot set to route');
    pilot.toggle();
    expect(pilot.line()).toMatch(/^Pilot steering <b class="on">steering for Queens Gate<\/b> · the throttle is yours$/);
    expect(pilot.line()).not.toMatch(/trim/);
  });

  it('with no mark to steer for it holds her heading, and she holds it', () => {
    const { sim, pilot } = make({ marks: [], nextIndex: 0, legOrigin: null } as unknown as Passage);
    pilot.toggle();
    expect(sim.state.helmMode).toBe('heading');
    sim.advance(20);
    pilot.update();
    expect(Math.abs(sim.state.heading) < 0.03 || Math.abs(sim.state.heading - Math.PI * 2) < 0.03).toBe(true);
  });
});

describe('experience points for a powerboat: few and small', () => {
  const cruise = milesPerLitre(p, leverFor(p, p.cruiseKt));
  /** Run her and collect what the scorer gives. */
  function watch(sim: Sim, seconds: number, scorer = new PowerSeamanship(cruise), into: Award[] = []): Award[] {
    for (let i = 0; i < seconds * 60; i++) {
      sim.step();
      into.push(...scorer.step(sim.state, sim.out));
    }
    return into;
  }

  it('a passage made without hurting her earns a point a mile, and a little more made thriftily', () => {
    const sim = running(env(), 26);
    sim.setHelm('heading', 0);
    const scorer = new PowerSeamanship(cruise);
    const got = watch(sim, 30 * 60, scorer);
    expect(got).toEqual([]);
    sim.setThrottle(0);
    watch(sim, 20, scorer, got);
    sim.holdAt('anchor', sim.state.x, sim.state.y, 20);
    watch(sim, 1, scorer, got);
    const miles = Math.round((leverSpeed(p, leverFor(p, 26)) / KT) * 0.5);
    expect(got).toEqual([
      { kind: 'berth', points: 8, label: 'Anchored' },
      { kind: 'passage', points: Math.min(POWER.most, miles), label: 'Clean passage' },
      { kind: 'passage', points: POWER.thrifty, label: 'Easy on the fuel' },
    ]);
    expect(KIND_NAMES.passage).toBe('Passages under power');
  });

  it('flat out all the way is not thrifty, and a short hop is not a passage', () => {
    const fast = running(env(), 99);
    fast.setHelm('heading', 0);
    const scorer = new PowerSeamanship(cruise);
    const got = watch(fast, 20 * 60, scorer);
    fast.holdAt('anchor', fast.state.x, fast.state.y, 20);
    watch(fast, 1, scorer, got);
    expect(got.map((a) => a.label)).toEqual(['Anchored', 'Clean passage']);
    const hop = running(env(), 20);
    const s2 = new PowerSeamanship(cruise);
    const short = watch(hop, 120, s2);
    hop.holdAt('anchor', hop.state.x, hop.state.y, 20);
    expect(watch(hop, 1, s2, short).map((a) => a.label)).toEqual(['Anchored']);
  });

  it('pounding her until something breaks costs a few points, and the passage is not a clean one', () => {
    const sea: SeaSample = { height: 1, length: 20, dir: 0, steepness: 0.05 };
    const sim = running(env(0, sea), 99);
    sim.setHelm('heading', 0);
    const scorer = new PowerSeamanship(cruise);
    const got = watch(sim, 12 * 60, scorer);
    expect(sim.state.damage).toBeGreaterThan(0.03);
    expect(got.every((a) => a.kind === 'lost' && a.points === POWER.pounded)).toBe(true);
    // Not every landing: no more often than every five minutes.
    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(got.length).toBeLessThanOrEqual(3);
    sim.holdAt('anchor', sim.state.x, sim.state.y, 20);
    expect(watch(sim, 1, scorer).map((a) => a.label)).toEqual(['Anchored']);
  });

  it('turning circles through the wind earns nothing: no tacks, gybes, groove or gusts for a boat with no sails', () => {
    const sim = running(env(14), 20);
    sim.setControl('rudder', 12 * D2R);
    expect(watch(sim, 5 * 60)).toEqual([]);
  });

  it('running the tank dry is marked down', () => {
    const sim = running(env(), 26);
    sim.state.fuelUsed = boat.engine!.tankL - 0.05;
    const got = watch(sim, 30);
    expect(got).toEqual([{ kind: 'lost', points: POWER.dry, label: 'Ran the tank dry' }]);
  });
});

describe('the tips', () => {
  const snap = (over: Partial<Snap> = {}): Snap => ({ ...emptySnap(), power: true, hasSpin: false, reefs: 0, ...over });
  const offered = (s: Snap, seconds = 400): string[] => {
    const picker = new TipPicker(TIPS, freshMemory(), () => 1_000_000);
    const ids: string[] = [];
    for (let t = 0; t < seconds; t += 0.5) {
      const now = { ...s, t: s.t + t };
      const tip = picker.next(now, 0.5);
      if (tip) {
        ids.push(tip.id);
        picker.showed(tip);
        picker.ended(now);
      }
    }
    return ids;
  };
  const SAILING = ['welcome-steer', 'welcome-trim', 'reef', 'spinnaker', 'flow', 'chart', 'race-offer', 'race-call', 'engine', 'weather'];

  it('a newcomer in a powerboat is welcomed with her own keys, not with the sheets', () => {
    const ids = offered(snap());
    expect(ids[0]).toBe('welcome-power');
    for (const id of SAILING) expect(ids, id).not.toContain(id);
  });

  it('nothing about reefing, the spinnaker, the wind tunnel or racing ever fires for her, whatever is going on', () => {
    const hard = snap({
      sails: 12, hours: 9, t: 500, windKt: 26, heelDeg: 30, twaDeg: 160, speedKt: 8, knockdowns: 3, mistrim: true, stuck: 200, company: 2, raceOffered: true,
      hasEngine: true, engine: false, mark: { d: 5000, upwind: true }, marks: 2,
    });
    const ids = offered(hard, 3600);
    for (const id of SAILING.filter((x) => x !== 'weather')) expect(ids, id).not.toContain(id);
    // The same moment aboard a sloop does bring the sailing tips.
    const sloopIds = offered({ ...hard, power: false, hasSpin: true, reefs: 2 }, 3600);
    expect(sloopIds.some((id) => SAILING.includes(id))).toBe(true);
  });

  it('the strip of main keys is the driving one', () => {
    expect(stripContext({ away: false, racing: false, held: false, power: true })).toBe('driving');
    expect(stripContext({ away: false, racing: false, held: true, power: true })).toBe('held');
    expect(stripContext({ away: false, racing: false, held: false })).toBe('sailing');
    expect(STRIPS.driving.flatMap(([keys]) => keys)).toEqual(expect.arrayContaining(['.', ',', 'A', 'D', 'I']));
    expect(JSON.stringify(STRIPS.driving)).not.toMatch(/sail|jib|tack/);
  });
});

describe('wind shadow', () => {
  it('she casts none: a boat with no mast takes nobody else\'s wind', () => {
    const d = boat.dimensions;
    const her = { x: 0, y: 0, sog: 0, cog: 0, length: d.loa, mast: d.mastHeight, sails: true };
    expect(shadowAt(0, -20, 0, 6, [her]).factor).toBe(1);
    const yacht = { x: 0, y: 0, sog: 0, cog: 0, length: 11.6, mast: 16.5, sails: true };
    expect(shadowAt(0, -20, 0, 6, [yacht]).factor).toBeLessThan(0.95);
  });

  it('and feels none that matters: a wind taken from her changes her speed by almost nothing', () => {
    const clear = running(env(15), 26);
    clear.setHelm('heading', 0);
    clear.advance(60);
    const world = env(15);
    const air = new ShadedWind(world);
    air.factor = 0.6;
    const shaded = new Sim(file, air, { speedKt: 0 });
    shaded.underWay(26);
    shaded.setHelm('heading', 0);
    shaded.advance(60);
    expect(Math.abs(shaded.state.speed - clear.state.speed) / KT).toBeLessThan(0.6);
  });
});
