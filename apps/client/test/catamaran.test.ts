import { describe, expect, it } from 'vitest';
import { Sim, KT, polarSpeed, type BoatSpec, type Environment } from '@slack-tide/sim';
import { trackFix } from '@slack-tide/nav';
import catJson from '../../../boats/cat42.json';
import sloopJson from '../../../boats/sloop38.json';
import blueJson from '../../../boats/blue50.json';
import lineupJson from '../../../boats/lineup.json';
import { capsizeAlarm, isCapsized, isPressed, placard, reefDue } from '../src/aboard/pressedRules';
import { CONTACT, overlap, type Hull } from '../src/aboard/contactRules';
import { paceReef } from '../src/race/pace';
import { ShadedWind } from '../src/race/shadow';
import { taken } from '../src/race/startline';

// What the client does with the 42 ft catamaran: what it tells her skipper, the hull other boats hit, and the
// pace boats sailing her. Her sailing itself is pinned in packages/sim/test/catamaran.test.ts.
const cat = catJson as unknown as BoatSpec;
const sloop = sloopJson as unknown as BoatSpec;
const D2R = Math.PI / 180;
const steady = (kt: number, fromDeg = 0): Environment => {
  const s = { windDir: fromDeg * D2R, windSpeed: kt * KT, currentX: 0, currentY: 0 };
  return { sample: () => s };
};
const aws = (kt: number) => ({ aws: kt * KT });

describe('reefing a catamaran by the numbers', () => {
  it('reads her placard out as a sailor would', () => {
    expect(placard(cat)).toBe('first reef at 18 kt apparent, second reef at 25');
    expect(placard(sloop)).toBe('');
  });

  it('asks for the first reef at 18 kt apparent and the second at 25, and for nothing once it is in', () => {
    const sailing = (reef: number) => ({ reef, hold: 'none' as const });
    expect(reefDue(cat, sailing(0), aws(17))).toBeNull();
    expect(reefDue(cat, sailing(0), aws(18))).toBe(1);
    expect(reefDue(cat, sailing(1), aws(22))).toBeNull();
    expect(reefDue(cat, sailing(0), aws(26))).toBe(2);
    expect(reefDue(cat, sailing(1), aws(25))).toBe(2);
    expect(reefDue(cat, sailing(2), aws(40))).toBeNull();
  });

  it('says nothing at anchor, and nothing to a sloop, who reefs by her heel', () => {
    expect(reefDue(cat, { reef: 0, hold: 'anchor' }, aws(30))).toBeNull();
    expect(reefDue(sloop, { reef: 0, hold: 'none' }, aws(30))).toBeNull();
    expect(isPressed(sloop, { press: 0 })).toBe(false);
    expect(isCapsized(sloop, { knock: 1.2, heel: 1.2 })).toBe(false);
  });

  it('the numbers come before the limit: reefed on time she is not pressed', () => {
    const sim = new Sim(cat, steady(16), { headingDeg: -50, speedKt: 6 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setHelm('wind', 50 * D2R);
    sim.advance(120);
    // Sixteen knots true is past the first number on the wind. She is still inside her limit, with no warning at all.
    expect(reefDue(cat, sim.state, sim.out)).toBe(1);
    expect(isPressed(cat, sim.out)).toBe(false);
    expect(Math.abs(sim.state.heel) / D2R).toBeLessThan(4);
  });

  it('pressed, then capsized, and the alarm says why and how long', () => {
    const sim = new Sim(cat, steady(36), { headingDeg: -90, speedKt: 6 });
    sim.trimForWind();
    sim.setHelm('wind', 90 * D2R);
    sim.advance(2);
    expect(isPressed(cat, sim.out)).toBe(true);
    expect(isCapsized(cat, sim.state)).toBe(false);
    sim.advance(28);
    expect(sim.state.capsizes).toBe(1);
    expect(isCapsized(cat, sim.state)).toBe(true);
    const said = capsizeAlarm(cat, sim.state, aws(36));
    expect(said).toContain('Capsized. 36 kt apparent on full main');
    expect(said).toContain('about 2 minutes');
    expect(said).toContain('first reef at 18 kt apparent, second reef at 25');
  });
});

describe('the catamaran as a hull other boats can hit', () => {
  const d = cat.dimensions;
  const hull = (x: number, y: number, headingDeg: number, of: BoatSpec = cat): Hull => ({ x, y, heading: headingDeg * D2R, length: of.dimensions.loa, beam: of.dimensions.beam });

  it('is about as wide as she is: two alongside touch near a beam apart, and a sloop touches her at her rail', () => {
    // Her capsule is 0.45 of her beam either side: 6.3 m across for a 7 m boat.
    expect(2 * d.beam * CONTACT.radius).toBeCloseTo(6.3, 9);
    expect(overlap(hull(0, 0, 0), hull(d.beam + 0.1, 0, 0))).toBeNull();
    expect(overlap(hull(0, 0, 0), hull(6, 0, 0))).not.toBeNull();
    // A 38 alongside: rails touch with centrelines 5.4 m apart. The capsules meet a little inside that.
    const rails = d.beam / 2 + sloop.dimensions.beam / 2;
    expect(overlap(hull(0, 0, 0), hull(rails + 0.1, 0, 0, sloop))).toBeNull();
    expect(overlap(hull(0, 0, 0), hull(rails - 0.8, 0, 0, sloop))).not.toBeNull();
  });

  it('is no longer than she is: bow to stern they touch at her length', () => {
    expect(overlap(hull(0, 0, 0), hull(0, d.loa + 0.1, 0))).toBeNull();
    expect(overlap(hull(0, 0, 0), hull(0, d.loa - 0.5, 0))).not.toBeNull();
  });
});

describe('a pace boat sailing the catamaran', () => {
  /** A pace boat's sim, built the way `PaceBoat` builds it, and sailed round marks by the same rule. */
  const sail = (twsKt: number, marks: Array<{ x: number; y: number }>, limitS: number) => {
    // Club boats sail the boat as she is: skill shows as mistakes, not a slower polar.
    const crewed = cat;
    const sim = new Sim(crewed, new ShadedWind(steady(twsKt)), { x: 0, y: -200, headingDeg: 0, speedKt: 0 });
    sim.state.speed = 3.5 * KT;
    let legStart = { x: 0, y: -200 };
    sim.setRoute(marks[0], legStart);
    sim.setCrewTrim(true);
    sim.trimForWind();
    let leg = 0;
    while (leg < marks.length && sim.state.t < limitS) {
      sim.step();
      const s = sim.state;
      if (s.tick % 60 === 0) sim.setControl('reef', paceReef(sim.out.tws / KT, s.reef));
      const next = marks[leg];
      const fix = trackFix(s, legStart, next);
      if (taken(fix.toGo, fix.along, Math.hypot(next.x - legStart.x, next.y - legStart.y))) {
        leg++;
        legStart = { x: next.x, y: next.y };
        if (marks[leg]) sim.setRoute(marks[leg], legStart);
      } else if (s.helmMode === 'hand') {
        sim.setRoute(next, legStart);
        sim.setCrewTrim(true);
      }
    }
    return { leg, sim };
  };
  // Wind from the north: a beat, a reach across, a run home.
  const triangle = [{ x: 0, y: 0 }, { x: 0, y: 1500 }, { x: 1200, y: 700 }, { x: 0, y: 0 }];

  it('gets round a windward, reaching and running course in a light air, a breeze and a blow', () => {
    for (const tws of [7, 14, 24]) {
      const { leg, sim } = sail(tws, triangle, 3 * 3600);
      expect(leg, `${tws} kt`).toBe(triangle.length);
      expect(sim.state.capsizes).toBe(0);
      expect(sim.state.knockdowns).toBe(0);
    }
  });

  it('her crew reefs for 30 kt and she comes home without being capsized', () => {
    const { leg, sim } = sail(30, triangle, 3 * 3600);
    expect(leg).toBe(triangle.length);
    expect(sim.state.reef).toBe(2);
    expect(sim.state.capsizes).toBe(0);
  });
});

describe('the catamaran in the lineup', () => {
  const lineup = lineupJson as Array<{ id: string; status: string; file?: string }>;
  const shown = cat as BoatSpec & Record<string, unknown>;

  it('is ready to sail, with what the picker shows', () => {
    expect(lineup.find((e) => e.id === 'cat42')).toMatchObject({ status: 'ready', file: 'cat42.json' });
    for (const key of ['tagline', 'role', 'difficulty', 'defaultName', 'homePort']) expect(typeof shown[key], key).toBe('string');
    expect(shown.model).toBe('catamaran');
    // One line on the card, not a paragraph.
    expect(String(shown.tagline).length).toBeLessThan(120);
    expect(polarSpeed(cat.polar, 100, 14)).toBeGreaterThan(polarSpeed(sloop.polar, 100, 14));
  });

  it('binds the same controls to the same named parts as the sloops', () => {
    const nodes = (b: BoatSpec) => b.controls.map((c) => `${c.node}:${c.control}`).sort();
    expect(nodes(cat)).toEqual(nodes(sloop));
  });

  it('has no spinnaker, twin screws, and a draught a sloop cannot follow', () => {
    expect(cat.sails.spinnaker).toBeUndefined();
    expect(cat.engine?.twinPivotDegS).toBeGreaterThan(0);
    expect(cat.dimensions.draft).toBeLessThan(1.5);
  });
});

describe('the bluewater 50 in the lineup', () => {
  const blue = blueJson as unknown as BoatSpec & Record<string, unknown>;

  it('is ready to sail, with what the picker shows, and is drawn by the sloop builder with her own stern and bulwarks', () => {
    expect((lineupJson as Array<{ id: string; status: string }>).find((e) => e.id === 'blue50')?.status).toBe('ready');
    for (const key of ['tagline', 'role', 'difficulty', 'defaultName', 'homePort']) expect(typeof blue[key], key).toBe('string');
    expect(blue.model).toBeUndefined();
    expect((blue.hull as { sternTaper: number; bulwarkM: number }).sternTaper).toBeGreaterThan(0.221);
    expect((blue.hull as { bulwarkM: number }).bulwarkM).toBeGreaterThan(0);
    expect(blue.pressed).toBeUndefined();
  });

  it('is a wider, heavier hull to hit than the 38', () => {
    expect(blue.dimensions.beam * CONTACT.radius).toBeGreaterThan(sloop.dimensions.beam * CONTACT.radius);
    expect(placard(blue)).toBe('');
  });
});
