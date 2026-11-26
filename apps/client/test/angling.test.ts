import { describe, expect, it } from 'vitest';
import { hash01 } from '../src/aboard/catch';
import {
  BITE_SPELL, TROPHY_ODDS, advice, biteIn, freshness, keenOf, lengthOf, lureWindow, prospects, rulingOf, sounderLine, typicalWait, wayOf, weightOf, whySlow, type Tackle,
} from '../src/fishing/bites';
import { CAST_RANGE, REPORT_EVERY, SKIP_KT, TROLL_MIN_KT, paddiesAt, reportIn, schoolsAt, spooks, spotAt, whereWords, type Here, type Sea } from '../src/fishing/grounds';
import { hereOf, localClock } from '../src/fishing/here';
import { addToCreel, bigness, creelRows, emptyCreel, firstTableWorth, landedPoints, pointsFor, readCreel, scoreWords, xpFor } from '../src/fishing/points';
import { LURES, RIGS, fishingWaters, speciesOf, tableOf, type FishSpecies, type Habitat } from '../src/fishing/table';
import { fateOf, freshAt, landFish, landedWords, newTrip, workPatch } from '../src/fishing/trip';
import { fishTip } from '../src/fishing/tip';
import { reserveAt, reservesOf } from '../src/fishing/zones';
import { worldOf } from './waters';

const WATER = 'catalina';
const TZ = 'America/Los_Angeles';
const table = tableOf(WATER)!;
const reserves = reservesOf(WATER);
const sp = (id: string): FishSpecies => speciesOf(table, id)!;
/** The season starts at 05:00 local on 19 July. */
const world = (hours: number) => worldOf(WATER, hours);
const seaOf = (w: ReturnType<typeof world>): Sea => ({ depth: (x, y) => w.chartDepth(x, y) });

interface At { x: number; y: number; hours?: number; kt?: number; held?: boolean; t?: number }
/** A boat at a place, `hours` into the season, as the fishing sees her. */
function spot(a: At, down?: Set<number>) {
  const w = world(a.hours ?? 3);
  const kt = a.kt ?? 0.4;
  const here = hereOf(w, TZ, a.x, a.y, a.t ?? 0, kt, kt, a.held ?? false);
  return spotAt(table, reserves, here, w.seasonTime(a.t ?? 0), seaOf(w), down);
}
const tackle = (over: Partial<Tackle> = {}): Tackle => ({ lure: 'feather', rig: 'bait', bait: 12, rods: 1, ...over });
const names = (list: Array<{ species: FishSpecies }>) => list.map((p) => p.species.id);

const EDITH = table.platforms.find((p) => p.id === 'edith')!;
/** On the kelp at Hen Rock, just outside the Long Point reserve. */
const LONG_POINT_KELP = { x: -6120, y: -16760 };
const FLATS = { x: 14000, y: 21000 };
const CHANNEL = { x: 6000, y: 3000 };
const HORSESHOE = { x: 7400, y: 13300 };
const FAR_SIDE = { x: -2000, y: -14000 };

describe('the fishing table of a water', () => {
  it('is found for Catalina, and the waters without one keep the first table', () => {
    expect(fishingWaters().map((w) => w.id)).toContain(WATER);
    expect(tableOf('sf-bay')).toBeNull();
    expect(tableOf('san-juans')).toBeNull();
    expect(tableOf('bvi')).toBeNull();
  });

  it('has species whose numbers make sense', () => {
    const kinds: Habitat[] = ['harbor', 'flats', 'rocks', 'reef', 'platform', 'kelp', 'point', 'cove', 'channel', 'offshore', 'paddy', 'boil', 'yellows', 'foamer'];
    expect(table.species.length).toBeGreaterThanOrEqual(18);
    expect(new Set(table.species.map((s) => s.id)).size).toBe(table.species.length);
    for (const s of table.species) {
      expect(s.size[0], s.id).toBeLessThan(s.size[1]);
      expect(s.size[1], s.id).toBeLessThan(s.trophyCm);
      if (s.minCm !== undefined) {
        expect(s.minCm, s.id).toBeGreaterThan(s.size[0] - 1);
        expect(s.minCm, s.id).toBeLessThan(s.trophyCm);
      }
      expect(s.worth, s.id).toBeGreaterThan(0);
      expect(s.limit.length, s.id).toBeGreaterThan(3);
      for (const k of Object.keys(s.habitat)) expect(kinds, `${s.id} lives in ${k}`).toContain(k);
      for (const k of Object.keys(s.ways)) expect(RIGS.map((r) => r.id), `${s.id} takes ${k}`).toContain(k);
      for (const k of Object.keys(s.troll?.lures ?? {})) expect(LURES.map((l) => l.id), `${s.id} takes ${k}`).toContain(k);
      // Something catches it.
      expect(Object.keys(s.ways).length + Object.keys(s.troll?.lures ?? {}).length, s.id).toBeGreaterThan(0);
      // A sane weight for its length: a big one weighs between a few ounces and a few hundred kilos.
      expect(weightOf(s, s.trophyCm), s.id).toBeGreaterThan(0.5);
      expect(weightOf(s, s.trophyCm), s.id).toBeLessThan(250);
    }
    expect(speciesOf(table, table.jackpot)).toBeDefined();
    for (const r of table.rivals) expect(speciesOf(table, r.id), r.id).toBeDefined();
    expect(sp('giantseabass').protected).toBeTruthy();
  });

  it('has its grounds, platforms, barge and reserves on the water, not on the land', () => {
    const w = world(3);
    for (const p of table.platforms) {
      // A platform stands in water; an oil island is rock, so it is the water round it that has to be there.
      let wet = 0;
      for (let a = 0; a < 8; a++) if (w.chartDepth(p.x + Math.sin(a * 0.785) * (p.keepOff + 80), p.y + Math.cos(a * 0.785) * (p.keepOff + 80)) > 2) wet++;
      expect(wet, p.name).toBeGreaterThanOrEqual(p.kind === 'platform' ? 8 : 3);
      expect(p.keepOff, p.name).toBeGreaterThanOrEqual(90);
      expect(p.reach, p.name).toBeGreaterThan(p.keepOff + 150);
    }
    for (const g of table.grounds) {
      if (!g.circle) continue;
      let wet = 0;
      for (let a = 0; a < 12; a++) for (const k of [0, 0.5, 0.95]) if (w.chartDepth(g.circle[0] + Math.sin(a * 0.524) * g.circle[2] * k, g.circle[1] + Math.cos(a * 0.524) * g.circle[2] * k) > 1) wet++;
      expect(wet, g.name).toBeGreaterThan(5);
    }
    for (const r of reserves) expect(w.chartDepth(r.x, r.y) > 0 || w.chartDepth(r.x + r.r * 0.7, r.y + r.r * 0.7) > 0, r.name).toBe(true);
    // One list with diving: the zones of the water's dives.json.
    expect(reserves.map((r) => r.id)).toEqual(['casino-point', 'lovers-cove', 'long-point', 'blue-cavern']);
    expect(reserves[2].say).toBe('Long Point is a no-take reserve: nothing may be taken here.');
    // The reserves do not swallow the moorings at Avalon or at the Isthmus.
    expect(reserveAt(reserves, -2250, -22700)).toBeNull();
    expect(reserveAt(reserves, -18250, -11750)).toBeNull();
    expect(reserveAt(reserves, reserves[0].x + 50, reserves[0].y)?.id).toBe('casino-point');
    // Long Point itself is inside its reserve, so the ground to fish there is Hen Rock, outside it.
    expect(reserveAt(reserves, -6050, -15850)?.id).toBe('long-point');
    expect(reserveAt(reserves, LONG_POINT_KELP.x, LONG_POINT_KELP.y)).toBeNull();
    expect(reservesOf('sf-bay')).toEqual([]);
  });

  it('reads the hour and the month from the water\'s own clock', () => {
    const c = localClock(world(0).dateAt(0), TZ);
    expect(c.hour).toBeCloseTo(5, 1);
    expect(c.month).toBe(7);
  });
});

describe('what kind of water she is in', () => {
  it('knows the grounds by name', () => {
    expect(spot(LONG_POINT_KELP).ground?.id).toBe('hen-rock');
    expect(spot(LONG_POINT_KELP).hab.kelp).toBe(1);
    expect(spot(HORSESHOE).hab.reef).toBe(1);
    expect(spot(FLATS).hab.flats).toBe(1);
    expect(spot(CHANNEL).hab.channel).toBe(1);
    expect(spot(CHANNEL).ground).toBeNull();
    expect(spot(FLATS).hab.channel ?? 0).toBe(0);
    expect(spot({ x: 16900, y: 21550 }).barge).toBe(true);
    expect(spot(CHANNEL).barge).toBe(false);
  });

  it('gives a platform a ring nobody fishes in, and a good and a bad side', () => {
    const here = (dx: number, dy: number, stream: { x: number; y: number }): Here => ({ x: EDITH.x + dx, y: EDITH.y + dy, depth: 50, speedKt: 0.3, sogKt: 0.3, held: false, hour: 9, month: 7, tideRate: 0.1, stream });
    // The stream sets east: the west side is up-current.
    const east = { x: 0.1, y: 0 };
    const up = spotAt(table, reserves, here(-200, 0, east), 10000);
    const down = spotAt(table, reserves, here(200, 0, east), 10000);
    const inside = spotAt(table, reserves, here(-60, 0, east), 10000);
    const far = spotAt(table, reserves, here(-900, 0, east), 10000);
    expect(up.platform?.p.id).toBe('edith');
    expect(up.platform!.up).toBeCloseTo(1, 5);
    expect(down.platform!.up).toBeCloseTo(0, 5);
    expect(up.hab.platform!).toBeGreaterThan(down.hab.platform! * 1.8);
    expect(inside.platform!.inside).toBe(true);
    expect(inside.hab.platform ?? 0).toBe(0);
    expect(far.platform).toBeNull();
    // Inside the ring nothing bites, and the crew say why.
    expect(prospects(table, inside, tackle())).toEqual([]);
    expect(whySlow(table, inside, tackle())).toMatch(/100 m ring round Platform Edith/);
    expect(whySlow(table, down, tackle({ rig: 'squid' }))).toMatch(/down-current side/);
    // An oil island is rock, not a platform.
    const grissom = table.platforms.find((p) => p.id === 'island-grissom')!;
    const rock = spotAt(table, reserves, { ...here(0, 0, east), x: grissom.x + grissom.keepOff + 40, y: grissom.y, depth: 9 }, 10000);
    expect(rock.hab.rocks!).toBeGreaterThan(0.4);
    expect(rock.hab.platform ?? 0).toBe(0);
  });

  it('shuts a reserve to every rig', () => {
    const r = reserves[1];
    const s = spot({ x: r.x, y: r.y });
    expect(s.reserve?.id).toBe('lovers-cove');
    for (const rig of RIGS) expect(prospects(table, s, tackle({ rig: rig.id }))).toEqual([]);
    expect(advice(table, s, tackle())).toMatch(/reserve/);
    expect(typicalWait(table, s, tackle())).toBe(Infinity);
  });
});

describe('what bites where and when', () => {
  it('is the same for two boats at the same place and time, and different somewhere else', () => {
    let bites = 0;
    let differ = 0;
    let alike = 0;
    for (let t = 0; t < 3 * 3600; t += BITE_SPELL) {
      const a = spot({ ...LONG_POINT_KELP, held: true, t });
      const b = spot({ x: LONG_POINT_KELP.x + 30, y: LONG_POINT_KELP.y - 20, held: true, t });
      const spell = Math.floor(world(3).seasonTime(t) / BITE_SPELL);
      const one = biteIn(table, a, tackle(), spell);
      // Another player's page, at the same place at the same moment: the same fish, to the centimetre.
      const same = biteIn(table, spot({ ...LONG_POINT_KELP, held: true, t }), tackle(), spell);
      expect(same).toEqual(one);
      // A boat alongside has the bite at the same moment, and nearly always the same fish.
      const two = biteIn(table, b, tackle(), spell);
      expect(two === null).toBe(one === null);
      expect(two?.seed).toBe(one?.seed);
      if (one && two?.species.id === one.species.id) alike++;
      if (one) bites++;
      const other = biteIn(table, spot({ x: LONG_POINT_KELP.x - 300, y: LONG_POINT_KELP.y + 300, held: true, t }), tackle(), spell);
      if (other?.cm !== one?.cm) differ++;
    }
    // Neither empty nor a slot machine: a bite every few minutes on good ground.
    expect(bites).toBeGreaterThan(18);
    expect(bites).toBeLessThan(75);
    expect(differ).toBeGreaterThan(10);
    expect(alike / bites).toBeGreaterThan(0.85);
  });

  it('puts the right fish on each ground', () => {
    const kelp = names(prospects(table, spot({ ...LONG_POINT_KELP, held: true, hours: 7 }), tackle()));
    expect(kelp[0]).toBe('calico');
    expect(kelp).toContain('yellowtail');
    expect(kelp).not.toContain('halibut');
    expect(kelp).not.toContain('rockfish');
    const squidKelp = names(prospects(table, spot({ ...LONG_POINT_KELP, held: true, hours: 7 }), tackle({ rig: 'squid' })));
    expect(squidKelp.slice(0, 2)).toContain('sheephead');
    const flats = names(prospects(table, spot({ ...FLATS, hours: 3 }), tackle()));
    expect(flats[0]).toBe('halibut');
    expect(flats).toContain('sandbass');
    expect(flats).not.toContain('yellowtail');
    const harbor = names(prospects(table, spot({ x: 17000, y: 22300, hours: 3 }), tackle({ rig: 'iron' })));
    expect(harbor[0]).toBe('spotty');
    const reef = names(prospects(table, spot({ ...HORSESHOE, held: true, hours: 3 }), tackle({ rig: 'squid' })));
    expect(reef).toContain('sandbass');
    expect(reef).toContain('sculpin');
    // Deep under a platform: rockfish first on squid, and calico, sheephead and yellowtail on the legs.
    const here: Here = { x: EDITH.x - 180, y: EDITH.y, depth: 51, speedKt: 0.3, sogKt: 0.3, held: false, hour: 9, month: 7, tideRate: 0.1, stream: { x: 0.1, y: 0 } };
    const rig = spotAt(table, reserves, here, 10000);
    expect(names(prospects(table, rig, tackle({ rig: 'squid' })))[0]).toBe('rockfish');
    const baitRig = names(prospects(table, rig, tackle()));
    expect(baitRig).toContain('calico');
    expect(baitRig).toContain('yellowtail');
    // Open water with nothing in it holds nothing for a bait.
    expect(typicalWait(table, spot({ ...CHANNEL, hours: 3 }), tackle({ rig: 'squid' }))).toBe(Infinity);
    expect(whySlow(table, spot({ ...CHANNEL, hours: 3 }), tackle({ rig: 'squid' }))).toMatch(/nothing to hold fish/);
    // A reef in deep water is not nowhere.
    expect(whySlow(table, spot({ x: HORSESHOE.x, y: HORSESHOE.y - 1300, hours: 3 }), tackle({ rig: 'iron' }))).not.toMatch(/nothing to hold fish/);
  });

  it('follows the light: white seabass at dawn, the surface fish by day, the bottom after dark', () => {
    const at = (hours: number) => spot({ ...LONG_POINT_KELP, held: true, hours });
    const seabass = (hours: number) => keenOf(sp('seabass'), at(hours), 'bait', 'feather');
    expect(seabass(0.5)).toBeGreaterThan(seabass(7) * 8);
    expect(seabass(15)).toBeGreaterThan(seabass(7) * 8);
    const calico = (hours: number) => keenOf(sp('calico'), at(hours), 'bait', 'feather');
    expect(calico(1)).toBeGreaterThan(calico(7));
    expect(calico(7)).toBeGreaterThan(calico(18.5));
    // 23:30: nothing chases a lure, sculpin and sand bass still feed on the reef.
    const night = spot({ ...HORSESHOE, held: true, hours: 18.5 });
    expect(night.hour).toBeGreaterThan(21.5);
    expect(names(prospects(table, night, tackle({ rig: 'squid' })))).toContain('sculpin');
    const trollNight = spot({ ...CHANNEL, kt: 6, hours: 18.5 });
    expect(prospects(table, trollNight, tackle())).toEqual([]);
    expect(whySlow(table, trollNight, tackle())).toMatch(/dark/);
  });

  it('follows the tide and the drift for the fish of the sand', () => {
    const base: Here = { ...FLATS, depth: 10, speedKt: 0.5, sogKt: 0.6, held: false, hour: 9, month: 7, tideRate: 0.2, stream: { x: 0.05, y: 0 } };
    const keen = (h: Partial<Here>) => keenOf(sp('halibut'), spotAt(table, reserves, { ...base, ...h }, 10000), 'bait', 'feather');
    expect(keen({})).toBeGreaterThan(keen({ tideRate: 0 }) * 1.8);
    expect(keen({})).toBeGreaterThan(keen({ held: true }) * 1.5);
    expect(keen({ sogKt: 3 })).toBeLessThan(keen({}));
    expect(keen({ depth: 40 })).toBe(0);
    expect(keenOf(sp('halibut'), spotAt(table, reserves, base, 10000), 'iron', 'feather')).toBe(0);
    expect(whySlow(table, spotAt(table, reserves, { ...base, tideRate: 0 }, 10000), tackle())).toMatch(/Slack tide/);
  });

  it('follows the season', () => {
    const here: Here = { ...CHANNEL, depth: 120, speedKt: 8, sogKt: 8, held: false, hour: 9, month: 7, tideRate: 0.1, stream: { x: 0, y: 0 } };
    const july = spotAt(table, reserves, here, 10000);
    const march = spotAt(table, reserves, { ...here, month: 3 }, 10000);
    expect(keenOf(sp('dorado'), july, 'troll', 'plug')).toBeGreaterThan(0);
    expect(keenOf(sp('dorado'), march, 'troll', 'plug')).toBe(0);
    expect(keenOf(sp('yellowtail'), march, 'troll', 'plug')).toBeGreaterThan(0);
  });

  it('makes live bait worth having, and falls back to the iron without it', () => {
    const s = spot({ ...LONG_POINT_KELP, held: true, hours: 1 });
    const sum = (t: Tackle) => prospects(table, s, t).reduce((a, p) => a + p.keen, 0);
    expect(sum(tackle())).toBeGreaterThan(sum(tackle({ rig: 'iron' })) * 1.6);
    expect(wayOf(s, tackle({ bait: 0 }))).toBe('iron');
    expect(sum(tackle({ bait: 0 }))).toBe(sum(tackle({ rig: 'iron' })));
    expect(whySlow(table, s, tackle({ bait: 0 }))).toMatch(/No live bait/);
  });

  it('says true things about where she is', () => {
    const s = spot({ ...LONG_POINT_KELP, held: true, hours: 1 });
    expect(advice(table, s, tackle())).toMatch(/^Fishing a live bait on Hen Rock for /);
    expect(sounderLine(table, s, tackle())).toMatch(/rock and kelp · (good|thick) marks/);
    expect(sounderLine(table, spot(CHANNEL), tackle())).toMatch(/no bottom · nothing showing/);
    // Squid in the kelp at dawn when bait would do far better, or the other way about on a reef: the crew say so.
    const reef = spot({ ...HORSESHOE, held: true, hours: 18.5 });
    expect(whySlow(table, reef, tackle({ rig: 'iron' }))).toMatch(/Squid on the bottom would do better/);
  });
});

describe('trolling', () => {
  const troll = (kt: number, at = CHANNEL, hours = 3) => spot({ ...at, kt, hours });

  it('is what the line does when she is making way', () => {
    expect(wayOf(troll(TROLL_MIN_KT - 0.2), tackle())).toBe('bait');
    expect(wayOf(troll(6), tackle())).toBe('troll');
    expect(wayOf(troll(SKIP_KT + 1), tackle())).toBe('skip');
    expect(wayOf(spot({ ...CHANNEL, kt: 6, held: true }), tackle())).toBe('bait');
    expect(prospects(table, troll(SKIP_KT + 1), tackle())).toEqual([]);
    expect(whySlow(table, troll(SKIP_KT + 1), tackle())).toMatch(/skipping/);
  });

  it('has a speed for each fish: bonito and barracuda 5 to 7, yellowtail 6 to 8, dorado and tuna 7 to 9', () => {
    const k = (id: string, kt: number, lure: Tackle['lure']) => keenOf(sp(id), troll(kt), 'troll', lure);
    for (const id of ['bonito', 'barracuda']) {
      expect(k(id, 6, 'feather'), id).toBeGreaterThan(0);
      expect(k(id, 6, 'feather'), id).toBe(k(id, 5, 'feather'));
      expect(k(id, 3.5, 'feather'), id).toBe(0);
      expect(k(id, 9, 'feather'), id).toBe(0);
      expect(k(id, 7.8, 'feather'), id).toBeLessThan(k(id, 6, 'feather'));
    }
    expect(k('yellowtail', 7, 'plug')).toBeGreaterThan(k('yellowtail', 5.4, 'plug'));
    expect(k('yellowtail', 4.5, 'plug')).toBe(0);
    expect(k('dorado', 8, 'plug')).toBeGreaterThan(k('dorado', 6.4, 'plug'));
    expect(k('dorado', 5.5, 'plug')).toBe(0);
    expect(sp('marlin').troll!.kt.slice(1, 3)).toEqual([7, 9]);
    expect(lureWindow(table, 'feather')).toEqual([5, 9]);
    expect(lureWindow(table, 'marlin')).toEqual([7, 9]);
  });

  it('says so when she is too slow or too fast for the lure', () => {
    expect(whySlow(table, troll(3.4), tackle())).toMatch(/3\.4 kt is slow for the feathers: they want 5 to 9 kt/);
    expect(whySlow(table, troll(10.2), tackle())).toMatch(/fast for the feathers/);
    expect(whySlow(table, troll(4), tackle({ lure: 'marlin' }))).toMatch(/slow for the marlin lure: they want 7 to 9 kt/);
    expect(advice(table, troll(6), tackle())).toMatch(/^Trolling feathers at 6\.0 kt in the open channel for Pacific (bonito|barracuda) and Pacific (bonito|barracuda)/);
  });

  it('takes the lure for the fish: a marlin wants the big one, on the far side', () => {
    const far = spot({ ...FAR_SIDE, kt: 8, hours: 3 });
    expect(far.hab.offshore).toBe(1);
    expect(keenOf(sp('marlin'), far, 'troll', 'marlin')).toBeGreaterThan(0);
    expect(keenOf(sp('marlin'), far, 'troll', 'plug')).toBe(0);
    expect(keenOf(sp('marlin'), troll(8), 'troll', 'marlin')).toBe(0);
    expect(keenOf(sp('bonito'), troll(6), 'troll', 'marlin')).toBe(0);
    // Rare: hours of trolling for one, on average.
    const marlinOnly = keenOf(sp('marlin'), far, 'troll', 'marlin');
    expect(marlinOnly).toBeLessThan(0.05);
  });

  it('fishes two rods from a powerboat half as well again as one', () => {
    const s = troll(6);
    expect(typicalWait(table, s, tackle({ rods: 2 }))).toBeCloseTo(typicalWait(table, s, tackle()) / 1.5, 6);
    // Blind trolling in open water is a wait of some minutes, not seconds and not hours.
    expect(typicalWait(table, s, tackle()) / 60).toBeGreaterThan(8);
    expect(typicalWait(table, s, tackle()) / 60).toBeLessThan(45);
  });

  it('says there is little to tow a lure for inside the harbor', () => {
    expect(whySlow(table, spot({ ...FLATS, kt: 6 }), tackle())).toMatch(/trolling water is outside/);
  });
});

describe('kelp paddies and birds', () => {
  it('are in the same places for everyone, in deep water, and some hold fish', () => {
    const w = world(3);
    const sea = seaOf(w);
    let n = 0;
    let holding = 0;
    for (let t = 0; t < 36 * 3600; t += 1800) {
      const a = paddiesAt(table, t, sea);
      expect(paddiesAt(table, t, sea)).toEqual(a);
      for (const p of a) {
        expect(w.chartDepth(p.x, p.y)).toBeGreaterThanOrEqual(30);
        n++;
        if (p.holding) holding++;
      }
    }
    expect(n).toBeGreaterThan(300);
    expect(holding / n).toBeGreaterThan(0.4);
    expect(holding / n).toBeLessThan(0.8);
    // A paddy drifts slowly: ten minutes on it has hardly moved.
    const one = paddiesAt(table, 20000, sea)[0];
    const later = paddiesAt(table, 20600, sea).find((p) => p.key === one.key)!;
    expect(Math.hypot(later.x - one.x, later.y - one.y)).toBeLessThan(120);
  });

  it('schools come and go, move, and are mostly bonito with a rare foamer', () => {
    const sea = seaOf(world(3));
    const kinds: Record<string, number> = {};
    let up = 0;
    for (let t = 0; t < 36 * 3600; t += 600) {
      const a = schoolsAt(table, t, sea);
      expect(schoolsAt(table, t, sea)).toEqual(a);
      up += a.length;
      for (const s of a) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
    }
    const total = kinds.boil + kinds.yellows + kinds.foamer;
    expect(up / 216).toBeGreaterThan(2);
    expect(up / 216).toBeLessThan(7);
    expect(kinds.boil / total).toBeGreaterThan(0.5);
    expect(kinds.foamer / total).toBeGreaterThan(0.02);
    expect(kinds.foamer / total).toBeLessThan(0.2);
  });

  it('put fish under a stopped boat within a cast, and go down when she drives through them', () => {
    const w = world(3);
    const sea = seaOf(w);
    const now = w.seasonTime(0);
    const paddy = paddiesAt(table, now, sea).find((p) => p.holding)!;
    const empty = paddiesAt(table, now, sea).find((p) => !p.holding);
    const at = (x: number, y: number, kt: number, down?: Set<number>) => spotAt(table, reserves, hereOf(w, TZ, x, y, 0, kt, kt, false), now, sea, down);
    const near = at(paddy.x + 50, paddy.y, 0.3);
    expect(near.casting).toBe(true);
    expect(near.hab.paddy).toBe(1);
    expect(names(prospects(table, near, tackle()))[0]).toBe('dorado');
    expect(advice(table, near, tackle())).toMatch(/^Casting a live bait/);
    expect(at(paddy.x + 400, paddy.y, 0.3).hab.paddy ?? 0).toBe(0);
    // A towed lure has to pass the edge of it.
    expect(at(paddy.x + 120, paddy.y, 8).hab.paddy!).toBeGreaterThan(0.5);
    expect(keenOf(sp('dorado'), at(paddy.x + 120, paddy.y, 8), 'troll', 'plug')).toBeGreaterThan(keenOf(sp('dorado'), at(paddy.x + 2500, paddy.y, 8), 'troll', 'plug') * 8);
    if (empty) {
      expect(at(empty.x + 40, empty.y, 0.3).hab.paddy ?? 0).toBe(0);
      expect(whySlow(table, at(empty.x + 40, empty.y, 0.3), tackle())).toMatch(/Nothing under this paddy/);
    }
    expect(spooks(20, 6)).toBe(true);
    expect(spooks(20, 1)).toBe(false);
    expect(spooks(CAST_RANGE, 6)).toBe(false);
    // A school she has put down is gone for her.
    let t = now;
    let school = schoolsAt(table, t, sea)[0];
    while (!school) school = schoolsAt(table, (t += 300), sea)[0];
    const there = (down?: Set<number>) => spotAt(table, reserves, hereOf(w, TZ, school.x + 40, school.y, 0, 0.3, 0.3, false), t, sea, down);
    expect(there().school?.school.key).toBe(school.key);
    expect(there().hab[school.kind]).toBe(1);
    expect(there(new Set([school.key])).school?.school.key).not.toBe(school.key);
  });

  it('are reported truly on the radio', () => {
    const w = world(3);
    const sea = seaOf(w);
    let said = 0;
    for (let slot = 0; slot < 108; slot++) {
      const r = reportIn(table, slot, 7, sea);
      expect(reportIn(table, slot, 7, sea)).toEqual(r);
      if (!r) continue;
      said++;
      const at = slot * REPORT_EVERY + 120;
      if (r.what === 'paddy') {
        const p = paddiesAt(table, at, sea).find((k) => k.key === r.key)!;
        expect(p.holding).toBe(true);
        expect(Math.hypot(p.x - r.x, p.y - r.y)).toBeLessThan(1);
        expect(r.text).toMatch(/^Dorado and yellowtail under a kelp paddy .* of |^Dorado and yellowtail under a kelp paddy close off /);
      } else {
        const s = schoolsAt(table, at, sea).find((k) => k.key === r.key)!;
        expect(s.kind).toBe(r.what);
        expect(r.text).toMatch(/Birds working over|foaming under the birds/);
      }
      expect(table.callers).toContain(r.from);
      expect(r.until).toBeGreaterThan(at);
    }
    expect(said).toBeGreaterThan(40);
    expect(whereWords(table, 10510, 19050 - 3 * 1852)).toBe('three miles south of Queens Gate');
    expect(whereWords(table, -2250, -22700)).toBe('close off Avalon');
  });
});

describe('how big, and what it scores', () => {
  it('runs mostly small with a rare trophy, and never past the biggest there is', () => {
    for (const s of [sp('yellowtail'), sp('calico'), sp('marlin')]) {
      const sizes: number[] = [];
      let trophies = 0;
      for (let i = 0; i < 6000; i++) {
        const cm = lengthOf(s, hash01(i, 1), hash01(i, 2));
        expect(cm).toBeGreaterThanOrEqual(s.size[0]);
        expect(cm).toBeLessThanOrEqual(s.trophyCm);
        if (cm > s.size[1]) trophies++;
        sizes.push(cm);
      }
      sizes.sort((a, b) => a - b);
      expect(sizes[3000]).toBeLessThan((s.size[0] + s.size[1]) / 2);
      expect(trophies / 6000).toBeGreaterThan(TROPHY_ODDS * 0.6);
      expect(trophies / 6000).toBeLessThan(TROPHY_ODDS * 1.4);
    }
    // Thirty-one inches of yellowtail is a fish of sixteen pounds or so.
    expect(weightOf(sp('yellowtail'), 79) * 2.20462).toBeGreaterThan(14);
    expect(weightOf(sp('yellowtail'), 79) * 2.20462).toBeLessThan(19);
  });

  it('scores a fish by its size for its kind', () => {
    const yt = sp('yellowtail');
    expect(pointsFor(yt, 79)).toBe(240);
    expect(scoreWords(yt.name, 79, weightOf(yt, 79), pointsFor(yt, 79))).toBe('Yellowtail, 31 in, 16 lb — 240 points');
    expect(pointsFor(yt, yt.trophyCm)).toBe(yt.worth);
    expect(pointsFor(yt, yt.size[0])).toBe(Math.round((yt.worth * 0.12) / 5) * 5);
    for (const s of table.species) {
      let last = 0;
      for (let cm = s.size[0]; cm <= s.trophyCm; cm++) {
        const p = pointsFor(s, cm);
        expect(p % 5).toBe(0);
        expect(p).toBeGreaterThanOrEqual(Math.max(5, last));
        last = p;
      }
      expect(bigness(s, s.size[0])).toBe(0);
      expect(bigness(s, s.trophyCm + 50)).toBe(1);
    }
    // One good fish of a hard species beats a limit of small easy ones.
    const bonito = sp('bonito');
    expect(pointsFor(yt, 110)).toBeGreaterThan(pointsFor(bonito, 40) * bonito.bag!);
    expect(pointsFor(sp('marlin'), 190)).toBeGreaterThan(pointsFor(yt, 110));
    expect(pointsFor(sp('bluefin'), 120)).toBeGreaterThan(pointsFor(sp('calico'), 45) * 8);
  });

  it('pays the catch kept or let go, a little more for letting go, half for a short fish, and fines a poacher', () => {
    const yt = sp('yellowtail');
    expect(landedPoints(yt, 79, 'kept')).toBe(240);
    expect(landedPoints(yt, 79, 'released')).toBe(265);
    expect(landedPoints(yt, 58, 'short')).toBe(Math.round(pointsFor(yt, 58) / 10) * 5);
    const gsb = sp('giantseabass');
    expect(landedPoints(gsb, 150, 'protected')).toBeGreaterThan(pointsFor(gsb, 150));
    expect(landedPoints(gsb, 150, 'poached')).toBe(-pointsFor(gsb, 150));
    expect(landedPoints(gsb, 92, 'poached')).toBeLessThanOrEqual(-100);
    expect(landedPoints(sp('mackerel'), 25, 'released')).toBe(10);
  });

  it('gives experience in proportion, and modestly', () => {
    expect(xpFor(240)).toBe(12);
    expect(xpFor(5)).toBe(2);
    expect(xpFor(4000)).toBe(40);
    expect(xpFor(-800)).toBe(-25);
  });

  it('scores the first table\'s fish too', () => {
    expect(firstTableWorth('striper')).toBe(500);
    expect(firstTableWorth('no-such-fish')).toBe(100);
    expect(pointsFor({ size: [38, 95], worth: firstTableWorth('striper') }, 95)).toBe(500);
    expect(pointsFor({ size: [38, 95], worth: firstTableWorth('striper') }, 50)).toBeLessThan(120);
  });
});

describe('what may be kept', () => {
  const hooked = (id: string, cm: number) => ({ species: sp(id), cm, kg: weightOf(sp(id), cm), way: 'bait' as const, seed: 7 });

  it('rules by size, limit and protection', () => {
    expect(rulingOf(sp('calico'), 30, 0)).toBe('small');
    expect(rulingOf(sp('calico'), 40, 0)).toBe('keep');
    expect(rulingOf(sp('calico'), 40, 5)).toBe('limit');
    expect(rulingOf(sp('sheephead'), 45, 2)).toBe('limit');
    expect(rulingOf(sp('dorado'), 55, 0)).toBe('keep');
    expect(rulingOf(sp('giantseabass'), 150, 0)).toBe('protected');
    expect(fateOf(hooked('calico', 30), 0, 'keep')).toBe('short');
    expect(fateOf(hooked('calico', 40), 0, 'keep')).toBe('kept');
    expect(fateOf(hooked('calico', 40), 0, 'release')).toBe('released');
    expect(fateOf(hooked('calico', 40), 5, 'keep')).toBe('released');
    expect(fateOf(hooked('giantseabass', 150), 0, 'release')).toBe('protected');
    expect(fateOf(hooked('giantseabass', 150), 0, 'keep')).toBe('poached');
  });

  it('keeps the box, the running total and the words', () => {
    const trip = newTrip();
    const a = landFish(trip, WATER, hooked('sheephead', 45), 'keep');
    const b = landFish(trip, WATER, hooked('sheephead', 50), 'keep');
    const c = landFish(trip, WATER, hooked('sheephead', 60), 'keep');
    expect([a.fate, b.fate, c.fate]).toEqual(['kept', 'kept', 'released']);
    expect(trip.aboard.get('sheephead')).toBe(2);
    expect(landedWords(trip, hooked('sheephead', 60), c)).toMatch(/The limit is aboard \(12 inches to keep, two a day\), so back it goes/);
    const short = landFish(trip, WATER, hooked('calico', 30), 'keep');
    expect(landedWords(trip, hooked('calico', 30), short)).toMatch(/^Calico bass, 12 in, .* — \d+ points\. Short \(14 inches to keep, five bass a day\), so back it goes$/);
    expect(trip.points).toBe(a.points + b.points + c.points + short.points);
    const let1 = landFish(trip, WATER, hooked('yellowtail', 79), 'release');
    expect(landedWords(trip, hooked('yellowtail', 79), let1)).toBe('Yellowtail, 31 in, 16 lb — 265 points. Let go, with a little extra for it');
    const before = trip.points;
    const poached = landFish(trip, WATER, hooked('giantseabass', 150), 'keep');
    expect(poached.points).toBeLessThan(0);
    expect(trip.points).toBe(before + poached.points);
    expect(trip.aboard.get('giantseabass')).toBeUndefined();
    expect(trip.landed.length).toBe(6);
  });

  it('tires a spot that is fished hard, and rests it', () => {
    const trip = newTrip();
    expect(freshAt(trip, 100, 100, 5000)).toBe(1);
    for (let i = 0; i < 4; i++) workPatch(trip, 100, 100, 5000 + i * 60);
    const tired = freshAt(trip, 100, 100, 5300);
    expect(tired).toBeLessThan(0.45);
    expect(freshAt(trip, 120, 130, 5300)).toBe(tired);
    expect(freshAt(trip, 600, 100, 5300)).toBe(1);
    expect(freshAt(trip, 100, 100, 5300 + 900)).toBeGreaterThan(tired);
    expect(freshAt(trip, 100, 100, 5300 + 3600)).toBe(1);
    expect(freshness([0, 0, 0], 0)).toBeCloseTo(1 / 2.2, 6);
    const s = spot({ ...LONG_POINT_KELP, held: true });
    expect(typicalWait(table, s, tackle(), 0.5)).toBeCloseTo(typicalWait(table, s, tackle()) * 2, 6);
    expect(whySlow(table, s, tackle(), 0.4)).toMatch(/had the best of this spot/);
  });

  it('keeps a book of species and personal bests', () => {
    let c = emptyCreel();
    c = addToCreel(c, { id: 'yellowtail', name: 'yellowtail', cm: 79, kg: 7.4, points: 240, fate: 'kept', water: WATER });
    c = addToCreel(c, { id: 'yellowtail', name: 'yellowtail', cm: 70, kg: 5.1, points: 190, fate: 'released', water: WATER });
    c = addToCreel(c, { id: 'calico', name: 'calico bass', cm: 40, kg: 1, points: 80, fate: 'kept', water: WATER });
    c = addToCreel(c, { id: 'giantseabass', name: 'giant sea bass', cm: 150, kg: 67, points: -800, fate: 'poached', water: WATER });
    expect(c.fish).toBe(4);
    expect(c.released).toBe(1);
    expect(c.points).toBe(0);
    expect(c.species.yellowtail).toEqual({ name: 'yellowtail', n: 2, bestCm: 79, bestKg: 7.4, bestPoints: 240, water: WATER });
    expect(c.species.giantseabass).toBeUndefined();
    expect(creelRows(c).map((r) => r.id)).toEqual(['yellowtail', 'calico']);
    // Saved and read back, it is the same book. Nonsense is dropped.
    expect(readCreel(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(readCreel(null)).toEqual(emptyCreel());
    expect(readCreel({ points: -5, fish: 'many', species: { 'BAD ID': { name: 'x', n: 1 }, ok: { name: 'ok', n: 2, bestCm: 1e9, bestKg: NaN, bestPoints: 10 } } }).species).toEqual({ ok: { name: 'ok', n: 2, bestCm: 600, bestKg: 0, bestPoints: 10, water: '' } });
  });
});

describe('the tip a boat that lives here would pass on', () => {
  it('names a ground and a fish that are really biting there now', () => {
    for (const hours of [0.5, 3, 7, 14.5]) {
      const w = world(hours);
      const tip = fishTip(table, reserves, w, TZ, 0, w.seasonTime(0));
      expect(tip, `${hours} h`).not.toBeNull();
      const g = table.grounds.find((k) => k.name === tip!.place)!;
      const s = spotAt(table, reserves, hereOf(w, TZ, g.circle![0], g.circle![1], 0, 0.4, 0.4, false), w.seasonTime(0));
      const rig = tip!.how === 'with a live bait' ? 'bait' : 'squid';
      expect(prospects(table, s, tackle({ rig, bait: 1 }))[0].species.name).toBe(tip!.species);
    }
  });
});
