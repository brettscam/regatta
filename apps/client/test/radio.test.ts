import { describe, expect, it } from 'vitest';
import bay from '../../../courses/sf-bay/traffic.json';
import islands from '../../../courses/san-juans/traffic.json';
import { reception, sentences, speechAllowance } from '../src/aboard/radio';
import {
  BROADCAST_HOURS, CALL_GAP, broadcasts, bulletin, callSign, checkCalls, due, figures, gateText, leavingText, passing, passingText, schedule, spoken,
  type Departure, type Outlook,
} from '../src/aboard/radioCalls';
import { DELIVERY, castAll, castVoice, describePool, rankVoices, voiceScore, type VoiceLike } from '../src/audio/voices';
import { Track, type TrafficSpec, type TrafficVessel } from '../src/scene/traffic';
import { MESH_MOST, hasRoom, iceServers, offerDelay, unraised, yields } from '../src/net/web/voicePlan';

const spec = bay as unknown as TrafficSpec;
const SEASON = 36 * 3600;

describe('the ferries and ships on channel 16', () => {
  const calls = schedule(spec, SEASON);

  it('is the same list every time it is worked out', () => {
    expect(schedule(spec, SEASON)).toEqual(calls);
  });

  it('is occasional: in order, never two within seven minutes, a few an hour', () => {
    expect(calls.length).toBeGreaterThan(36 * 3);
    expect(calls.length).toBeLessThanOrEqual(SEASON / CALL_GAP);
    for (let i = 1; i < calls.length; i++) expect(calls[i].t - calls[i - 1].t).toBeGreaterThanOrEqual(CALL_GAP);
    for (const c of calls) expect(c.t >= 0 && c.t < SEASON).toBe(true);
  });

  it('has a ferry call as she leaves her berth, at the moment she starts to move', () => {
    const route = spec.routes.find((r) => r.id === 'ferry-sausalito')!;
    const track = new Track(route, spec.referenceHours * 3600);
    const leaving = calls.filter((c) => c.vessel === route.id);
    expect(leaving.length).toBeGreaterThan(20);
    const st = { x: 0, y: 0, heading: 0, sog: 0, active: true };
    for (const c of leaving.slice(0, 12)) {
      track.state(c.t - 5, st);
      expect(st.sog).toBe(0);
      track.state(c.t + 20, st);
      expect(st.sog).toBeGreaterThan(1);
      // She says where from, and that is the end she is at.
      const first = /(leaving|Departing|under way from|backing out at) Sausalito,? (for|bound for) the Ferry Building/.test(c.text);
      expect(first || /(leaving|Departing|under way from|backing out at) the Ferry Building,? (for|bound for) Sausalito/.test(c.text)).toBe(true);
      const end = route.points[first ? 0 : route.points.length - 1];
      track.state(c.t, st);
      expect(Math.hypot(st.x - end[0], st.y - end[1])).toBeLessThan(5);
    }
  });

  it('has the ship call a minute and a half before she is under the Golden Gate, inbound and outbound', () => {
    const route = spec.routes.find((r) => r.id === 'ship-inbound')!;
    const track = new Track(route, spec.referenceHours * 3600);
    const gate = route.points[route.gate!.at];
    const hers = calls.filter((c) => c.vessel === route.id);
    expect(hers.some((c) => c.text.includes('inbound at the Golden Gate, bound for Oakland'))).toBe(true);
    expect(hers.some((c) => c.text.includes('outbound at the Golden Gate, bound for sea'))).toBe(true);
    const st = { x: 0, y: 0, heading: 0, sog: 0, active: true };
    for (const c of hers) {
      track.state(c.t + 90, st);
      expect(st.active).toBe(true);
      expect(Math.hypot(st.x - gate[0], st.y - gate[1])).toBeLessThan(15);
      expect(c.text).toContain('the motor vessel Pacific Meridian');
      expect(c.text).toContain('280 metres, making 12 knots');
    }
  });

  it('leaves the yachts out, and a water with no ferries is silent', () => {
    expect(calls.some((c) => c.vessel.startsWith('sail-'))).toBe(false);
    expect(schedule({ referenceHours: 0, routes: [] }, SEASON)).toEqual([]);
    expect(schedule({ referenceHours: 0, routes: spec.routes.filter((r) => r.kind === 'sail') }, SEASON)).toEqual([]);
  });

  it('hands over a call once, in the frame its time is crossed', () => {
    const c = calls[3];
    expect(due(calls, c.t - 0.02, c.t)).toEqual([c]);
    expect(due(calls, c.t, c.t + 0.02)).toEqual([]);
    expect(due(calls, c.t - 1, c.t - 0.5)).toEqual([]);
    expect(due(calls, c.t, c.t)).toEqual([]);
    expect(due(calls, -1, SEASON)).toEqual(calls);
  });

  it('runTime is the inverse of where the track puts the vessel', () => {
    const route = spec.routes.find((r) => r.id === 'ferry-tiburon')!;
    const track = new Track(route, 0);
    const st = { x: 0, y: 0, heading: 0, sog: 0, active: true };
    const p = { x: 0, y: 0 };
    for (const s of [0, 40, 600, track.length / 2, track.length - 30, track.length]) {
      track.state(-route.phase + track.runTime(s), st);
      track.point(s, p);
      expect(Math.hypot(st.x - p.x, st.y - p.y)).toBeLessThan(0.5);
    }
  });

  it('spells securite so that a speech synthesiser says it', () => {
    expect(spoken(calls[0].text)).not.toMatch(/securite/i);
    for (const c of calls) expect(c.text.startsWith('Securite, securite, securite. ')).toBe(true);
    expect(callSign({ name: 'Tiburon ferry', kind: 'ferry' })).toBe('the Tiburon ferry');
  });
});

describe('a ferry about to pass close', () => {
  const ferry = (over: Partial<TrafficVessel>): TrafficVessel => ({ id: 'f', name: 'Tiburon ferry', kind: 'ferry', x: 0, y: 0, heading: 0, sog: 8, length: 34, beam: 10, ...over });
  const boat = { x: 0, y: 0, heading: 0, cog: 0, sog: 3 };

  it('calls when she will pass within a boat length or three in the next couple of minutes', () => {
    // Coming up from dead astern, 60 m to one side, 5 m/s faster: abeam in 80 s.
    const p = passing(boat, [ferry({ x: 60, y: -400 })]);
    expect(p).not.toBeNull();
    expect(Math.round(p!.tcpa)).toBe(80);
    expect(Math.round(p!.cpa)).toBe(60);
    expect(p!.where).toBe('astern of you');
    expect(passingText(p!, 'Kestrel')).toBe('Sailing vessel Kestrel, this is the Tiburon ferry, astern of you. I will pass about 50 metres off in about a minute. Please hold your course.');
  });

  it('says which side she is on', () => {
    expect(passing(boat, [ferry({ x: -300, y: 250, heading: Math.PI / 2 })])?.where).toBe('on your port bow');
    expect(passing({ ...boat, heading: Math.PI, cog: Math.PI }, [ferry({ x: -300, y: -300, heading: Math.PI / 2, sog: 6 })])?.where).toBe('on your starboard bow');
  });

  it('keeps quiet about one that is going away, one that will pass wide, one alongside her berth, and yachts', () => {
    expect(passing(boat, [ferry({ x: 60, y: 400 })])).toBeNull();
    expect(passing(boat, [ferry({ x: 400, y: -400 })])).toBeNull();
    expect(passing(boat, [ferry({ x: 30, y: -100, sog: 0 })])).toBeNull();
    expect(passing(boat, [ferry({ x: 60, y: -400, kind: 'sail' })])).toBeNull();
    expect(passing(boat, [])).toBeNull();
  });
});

describe('the voice mesh', () => {
  it('carries eight boats: seven connections each', () => {
    expect(MESH_MOST).toBe(8);
    expect(hasRoom(6)).toBe(true);
    expect(hasRoom(7)).toBe(false);
  });

  it('settles two offers made at once: exactly one of the pair gives way', () => {
    expect(yields('a', 'b')).toBe(false);
    expect(yields('b', 'a')).toBe(true);
  });

  it('spreads the offers to a newcomer out more the busier the water, up to four seconds', () => {
    expect(offerDelay(1, 0)).toBe(0);
    expect(offerDelay(1, 1)).toBe(400);
    expect(offerDelay(7, 1)).toBe(2800);
    expect(offerDelay(30, 1)).toBe(4000);
  });

  it('announces only for boats it has no connection to', () => {
    expect(unraised(['a', 'b', 'c'], (p) => p === 'b')).toEqual(['a', 'c']);
    expect(unraised(['a'], () => true)).toEqual([]);
  });

  it('uses STUN alone unless a TURN relay is named', () => {
    const plain = iceServers({});
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.every((s) => [s.urls].flat().every((u) => u.startsWith('stun:')))).toBe(true);
    const relayed = iceServers({ url: 'turn:turn.example.org:3478, turns:turn.example.org:5349', user: 'u', pass: 'p' });
    expect(relayed[relayed.length - 1]).toEqual({ urls: ['turn:turn.example.org:3478', 'turns:turn.example.org:5349'], username: 'u', credential: 'p' });
  });
});

describe('better calls', () => {
  const sj = islands as unknown as TrafficSpec;

  it('words the same call several ways, and the same call the same way every time', () => {
    const said = new Set([0.05, 0.3, 0.55, 0.8].map((h) => leavingText('the Tiburon ferry', 'Tiburon', 'the Ferry Building', h)));
    expect(said.size).toBe(4);
    for (const text of said) {
      expect(text).toContain('the Tiburon ferry');
      expect(text).toContain('Tiburon');
      expect(text).toContain('the Ferry Building');
      expect(text).toMatch(/one six\.$/);
    }
    expect(new Set([0.1, 0.5, 0.9].map((h) => gateText('the motor vessel Pacific Meridian', 'ship', 'inbound', 'the Golden Gate', 'Oakland', '280 metres, making 12 knots', h))).size).toBe(3);
    // A ferry's own calls through the season are not all alike.
    const calls = schedule(spec, SEASON);
    expect(new Set(calls.filter((c) => c.vessel === 'ferry-sausalito').map((c) => c.text)).size).toBeGreaterThan(4);
    expect(new Set([0.1, 0.4, 0.8].map((h) => passingText({ vessel: { id: 'f', name: 'Tiburon ferry', kind: 'ferry', x: 0, y: 0, heading: 0, sog: 8, length: 34, beam: 10 }, cpa: 60, tcpa: 80, where: 'astern of you' }, 'Kestrel', h))).size).toBe(3);
  });

  it('gives the San Juans a ferry that calls as she leaves Friday Harbor and as she comes up to Thatcher Pass', () => {
    const calls = schedule(sj, SEASON);
    expect(calls.length).toBeGreaterThan(30);
    expect(calls.some((c) => /Friday Harbor,? (for|bound for) Anacortes/.test(c.text))).toBe(true);
    expect(calls.some((c) => c.text.includes('approaching Thatcher Pass, bound for Anacortes'))).toBe(true);
    expect(calls.some((c) => c.text.includes('approaching Thatcher Pass, bound for Friday Harbor'))).toBe(true);
    // She is off the chart at Anacortes, so nobody hears her leave it.
    expect(calls.some((c) => /(leaving|Departing|under way from|backing out at) Anacortes/.test(c.text))).toBe(false);
    for (const c of calls) expect(c.role).toBe('master');
  });

  it('says numbers the way they are said on the air, and respells the names a synthesiser gets wrong', () => {
    expect(figures(16)).toBe('one six');
    expect(figures(25)).toBe('two five');
    expect(figures('1430')).toBe('one four three zero');
    expect(figures(9)).toBe('niner');
    expect(spoken('280 metres, making 12 knots')).toBe('280 metres, making one two knots');
    expect(spoken('Wind west at 18 knots, gusts 26.')).toBe('Wind west at one eight knots, gusts two six.');
    expect(spoken('broadcast for the Bay at 1435.')).toBe('broadcast for the Bay at one four three five.');
    expect(spoken('leaving Sausalito for Tiburon')).toBe('leaving Sossa-leeto for Tibba-ron');
    expect(spoken('bound for Anacortes by Spieden Channel and Roche Harbor')).not.toMatch(/Anacortes|Spieden|Roche/);
    expect(spoken('Securite, securite')).not.toMatch(/securite/i);
    // Nothing else is touched.
    expect(spoken('Hello, Fable! Kestrel here.')).toBe('Hello, Fable! Kestrel here.');
  });

  const outlook: Outlook = { station: 'Bay Radio', area: 'Central San Francisco Bay', hour: 14.58, windKt: 17.6, windFrom: 'west', gustKt: 25.2, laterKt: 22.4, laterFrom: 'west', turn: { high: true, minutes: 42 } };

  it('has the coast station broadcast the wind now, the wind in three hours and the turn of the tide', () => {
    const text = bulletin(outlook);
    expect(text).toContain('this is Bay Radio');
    expect(text).toMatch(/Central San Francisco Bay(,| at) (time )?1435\./);
    expect(text).toContain('Wind west at 18 knots, gusts 25.');
    expect(text).toContain('In three hours, west at 22 knots, increasing.');
    expect(text).toContain('High water in 40 minutes, then the ebb.');
    expect(text).toContain('reef early');
    expect(text.endsWith('Bay Radio, out.')).toBe(true);
    // It cannot be taken for a real agency's broadcast.
    expect(text).not.toMatch(/coast guard|noaa|national weather/i);
    expect(spoken(text)).toContain('one four three five');
    expect(spoken(text)).toContain('one eight knots, gusts two five');
  });

  it('words a quiet day and a steady one plainly', () => {
    const calm = bulletin({ ...outlook, windKt: 1.4, gustKt: 2, laterKt: 2.2, turn: { high: false, minutes: 200 } });
    expect(calm).toContain('Wind light and variable.');
    expect(calm).toContain('In three hours, light and variable.');
    expect(calm).toContain('Low water in about 3 hours, then the flood.');
    expect(calm).toContain('allow for the tide');
    const steady = bulletin({ ...outlook, windKt: 12, gustKt: 15, laterKt: 13, turn: null });
    expect(steady).toContain('Wind west at 12 knots.');
    expect(steady).toContain('In three hours, little change.');
    expect(steady).not.toMatch(/water/);
    expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map((n) => bulletin(outlook, n).split('.')[0])).size).toBeGreaterThan(1);
  });

  it('broadcasts every other hour through the day, at 35 minutes past', () => {
    const list = broadcasts('Bay Radio', SEASON, 8);
    expect(list.length).toBe(13);
    for (const c of list) {
      const clock = (8 + c.t / 3600) % 24;
      expect(BROADCAST_HOURS.some((h) => Math.abs(clock - h - 35 / 60) < 1e-6)).toBe(true);
      expect(c.kind).toBe('bulletin');
      expect(c.vessel).toBe('station');
    }
  });

  const leaving: Departure[] = Array.from({ length: 60 }, (_v, i) => ({ t: 3600 + i * 1700, id: `boat${i % 7}`, name: `Boat ${i % 7}`, sort: 'sailing vessel', from: 'Sausalito', to: 'Ayala Cove' }));

  it('has a yacht call the station now and then as she gets under way, and the station answer', () => {
    const checks = checkCalls('Bay Radio', leaving);
    expect(checks.length).toBeGreaterThan(8);
    expect(checks.length).toBeLessThan(35);
    expect(checkCalls('Bay Radio', leaving)).toEqual(checks);
    for (const c of checks) {
      expect(c.text).toContain('Bay Radio');
      expect(c.text).toMatch(/sailing vessel Boat \d/);
      expect(c.answer?.from).toBe('Bay Radio');
      expect(c.answer?.text).toMatch(/Bay Radio/);
      expect(c.role).toBe('skipper');
    }
    expect(new Set(checks.map((c) => c.text.replace(/Boat \d/g, 'X'))).size).toBeGreaterThan(1);
  });

  it('keeps the whole channel occasional: nothing within seven minutes of anything else, and the broadcast before a ship before a ferry before a yacht', () => {
    const news = broadcasts('Bay Radio', SEASON, 8);
    const checks = checkCalls('Bay Radio', leaving);
    const all = schedule(spec, SEASON, CALL_GAP, news, checks);
    for (let i = 1; i < all.length; i++) expect(all[i].t - all[i - 1].t).toBeGreaterThanOrEqual(CALL_GAP);
    expect(all.length).toBeLessThanOrEqual(SEASON / CALL_GAP);
    expect(all.filter((c) => c.kind === 'bulletin').length).toBe(news.length);
    expect(all.filter((c) => c.kind === 'check').length).toBeGreaterThan(2);
    // Nearly every ship call that was there without them is still there.
    const ships = schedule(spec, SEASON).filter((c) => c.role === 'pilot');
    expect(all.filter((c) => c.role === 'pilot').length).toBeGreaterThan(ships.length * 0.8);
    // About five an hour at the most, over the day.
    expect(all.length / 36).toBeLessThan(7);
  });
});

describe('choosing voices', () => {
  const v = (name: string, lang: string, localService = true): VoiceLike => ({ name, lang, localService });
  /** Chrome on a Mac: Apple's voices, the joke ones among them, and Google's fetched ones. */
  const chromeMac = [
    v('Albert', 'en-US'), v('Bad News', 'en-US'), v('Bells', 'en-US'), v('Daniel', 'en-GB'), v('Eddy (English (US))', 'en-US'), v('Fred', 'en-US'), v('Karen', 'en-AU'),
    v('Moira', 'en-IE'), v('Rishi', 'en-IN'), v('Samantha', 'en-US'), v('Tessa', 'en-ZA'), v('Zarvox', 'en-US'), v('Amelie', 'fr-CA'), v('Anna', 'de-DE'),
    v('Google Deutsch', 'de-DE', false), v('Google US English', 'en-US', false), v('Google UK English Female', 'en-GB', false), v('Google UK English Male', 'en-GB', false),
  ];
  const edge = [
    v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Zira - English (United States)', 'en-US'),
    v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false), v('Microsoft Guy Online (Natural) - English (United States)', 'en-US', false),
    v('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', false), v('Microsoft Ryan Online (Natural) - English (United Kingdom)', 'en-GB', false),
    v('Microsoft Natasha Online (Natural) - English (Australia)', 'en-AU', false), v('Microsoft Denise Online (Natural) - French (France)', 'fr-FR', false),
  ];
  const safari = [v('Samantha', 'en-US'), v('Daniel', 'en-GB'), v('Karen', 'en-AU'), v('Moira', 'en-IE'), v('Rishi', 'en-IN'), v('Tessa', 'en-ZA'), v('Fred', 'en-US'), v('Trinoids', 'en-US'), v('Thomas', 'fr-FR')];
  const android = [v('English United States', 'en_US'), v('English United Kingdom', 'en_GB'), v('English India', 'en_IN'), v('Deutsch Deutschland', 'de_DE')];

  it('never uses the joke voices, the robotic ones, the compact ones or another language', () => {
    for (const name of ['Albert', 'Bad News', 'Zarvox', 'Fred', 'Trinoids', 'Eddy (English (US))', 'eSpeak English', 'Samantha (Compact)']) expect(voiceScore(v(name, 'en-US'))).toBeLessThan(0);
    expect(voiceScore(v('Amelie', 'fr-CA'))).toBeLessThan(0);
    for (const list of [chromeMac, edge, safari, android]) {
      for (const voice of rankVoices(list)) {
        expect(voice.lang.replace('_', '-').toLowerCase().startsWith('en')).toBe(true);
        expect(voiceScore(voice)).toBeGreaterThan(0);
      }
    }
  });

  it('puts the natural, enhanced and fetched voices ahead of the plain ones', () => {
    expect(voiceScore(v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false))).toBeGreaterThan(voiceScore(v('Google US English', 'en-US', false)));
    expect(voiceScore(v('Samantha (Enhanced)', 'en-US'))).toBeGreaterThan(voiceScore(v('Samantha', 'en-US')));
    expect(voiceScore(v('Ava (Premium)', 'en-US'))).toBeGreaterThan(voiceScore(v('Samantha (Enhanced)', 'en-US')));
    expect(voiceScore(v('Google UK English Male', 'en-GB', false))).toBeGreaterThan(voiceScore(v('Daniel', 'en-GB')));
    expect(voiceScore(v('Daniel', 'en-GB'))).toBeGreaterThan(voiceScore(v('Microsoft David - English (United States)', 'en-US')));
    expect(rankVoices(chromeMac)[0].name).toMatch(/^Google/);
    // On Edge only the natural ones are in the pool: the old desktop voices are too far behind.
    expect(rankVoices(edge).every((x) => /Natural/.test(x.name))).toBe(true);
    expect(rankVoices(edge).length).toBe(5);
    expect(rankVoices(safari).map((x) => x.name).sort()).toEqual(['Daniel', 'Karen', 'Moira', 'Rishi', 'Samantha', 'Tessa']);
    expect(rankVoices(android).length).toBe(3);
    expect(rankVoices([])).toEqual([]);
    expect(describePool(rankVoices(android))).toMatch(/^3 voices: /);
    expect(describePool([])).toBe('no English voice');
  });

  it('gives the same list whatever order the browser hands the voices over in', () => {
    const shuffled = [...chromeMac].reverse();
    expect(rankVoices(shuffled)).toEqual(rankVoices(chromeMac));
  });

  it('gives a vessel the same voice, pitch and pace every time, and different vessels different ones', () => {
    const pool = rankVoices(chromeMac);
    const a = castVoice(pool, { key: 'kestrel', role: 'skipper' });
    expect(castVoice(pool, { key: 'kestrel', role: 'skipper' })).toEqual(a);
    expect(a.voice).not.toBeNull();
    const many = ['kestrel', 'zephyr', 'secondwind', 'osprey', 'halcyon', 'wanderer', 'morningstar', 'luckystrike', 'mariac', 'pelican', 'seafever', 'tamarisk'].map((key) => castVoice(pool, { key, role: 'skipper' }));
    expect(new Set(many.map((c) => c.voice!.name)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(many.map((c) => `${c.voice!.name}|${c.pitch}|${c.rate}`)).size).toBe(many.length);
    for (const c of many) {
      expect(c.pitch).toBeGreaterThanOrEqual(DELIVERY.skipper.pitch[0]);
      expect(c.pitch).toBeLessThanOrEqual(DELIVERY.skipper.pitch[1]);
      expect(c.rate).toBeGreaterThanOrEqual(DELIVERY.skipper.rate[0]);
      expect(c.rate).toBeLessThanOrEqual(DELIVERY.skipper.rate[1]);
    }
  });

  it('casts the ship, the station and the ferries together so that no two share a voice', () => {
    for (const list of [chromeMac, edge, safari]) {
      const pool = rankVoices(list);
      const cast = castAll(pool, [{ key: 'ship-inbound', role: 'pilot' }, { key: 'station', role: 'station' }, { key: 'ferry-sausalito', role: 'master' }, { key: 'ferry-alcatraz', role: 'master' }, { key: 'ferry-tiburon', role: 'master' }]);
      expect(new Set([...cast.values()].map((c) => c.voice!.name)).size).toBe(5);
      // The pilot is low and slow, a ferry's master brisk.
      expect(cast.get('ship-inbound')!.pitch).toBeLessThan(cast.get('ferry-sausalito')!.pitch);
      expect(cast.get('ship-inbound')!.rate).toBeLessThan(cast.get('ferry-sausalito')!.rate);
      expect(castAll(pool, [{ key: 'ship-inbound', role: 'pilot' }, { key: 'station', role: 'station' }]).get('station')).toEqual(cast.get('station'));
    }
  });

  it('uses a voice from the caller\'s part of the world when there is one', () => {
    const pool = rankVoices(safari);
    expect(castVoice(pool, { key: 'seafever', role: 'skipper', accent: 'en-GB' }).voice!.name).toBe('Daniel');
    expect(castVoice(pool, { key: 'nereid', role: 'skipper', accent: 'en-AU' }).voice!.name).toBe('Karen');
    expect(castVoice(pool, { key: 'osprey', role: 'skipper', accent: 'en-IN' }).lang).toBe('en-IN');
    // No such voice: any of the pool.
    expect(castVoice(pool, { key: 'wanderer', role: 'skipper', accent: 'en-NZ' }).voice).not.toBeNull();
    expect(castVoice(rankVoices(android), { key: 'seafever', role: 'skipper', accent: 'en-GB' }).lang).toBe('en-GB');
  });

  it('tells callers apart by pitch where a phone has one voice, and has no voice at all without error', () => {
    const one = rankVoices([v('English United States', 'en_US')]);
    const pitches = ['kestrel', 'zephyr', 'osprey', 'halcyon', 'wanderer'].map((key) => castVoice(one, { key, role: 'skipper' }).pitch);
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThan(0.2);
    const none = castVoice([], { key: 'kestrel', role: 'skipper' });
    expect(none.voice).toBeNull();
    expect(none.pitch).toBeGreaterThan(0.3);
    expect(castAll([], [{ key: 'station', role: 'station' }]).get('station')!.voice).toBeNull();
  });
});

describe('how a spoken call comes through', () => {
  it('is a little quieter, with more static, the further off the caller is, and never drowned', () => {
    const near = reception(200);
    const far = reception(12000);
    expect(near.volume).toBe(1);
    expect(far.volume).toBeLessThan(near.volume);
    expect(far.volume).toBeGreaterThan(0.55);
    expect(far.hiss).toBeGreaterThan(near.hiss);
    // Always less static than under a real voice (1), so the words stay easy to follow.
    expect(far.hiss).toBeLessThan(0.9);
    expect(reception(null).volume).toBeGreaterThan(0.85);
  });

  it('is spoken a sentence at a time, and is given long enough before the set stops waiting', () => {
    expect(sentences('Securite, securite, securite. All stations, this is the Tiburon ferry, leaving Tiburon. Standing by on one six.')).toEqual(['Securite, securite, securite.', 'All stations, this is the Tiburon ferry, leaving Tiburon.', 'Standing by on one six.']);
    expect(sentences('Hello, Fable! Kestrel here')).toEqual(['Hello, Fable!', 'Kestrel here']);
    expect(sentences('Race you to Ayala Cove?')).toEqual(['Race you to Ayala Cove?']);
    expect(speechAllowance('x'.repeat(100), 1)).toBe(11000);
    expect(speechAllowance('x'.repeat(100), 0.9)).toBeGreaterThan(11000);
  });
});
