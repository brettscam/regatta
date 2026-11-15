import { describe, expect, it } from 'vitest';
import bay from '../../../courses/sf-bay/traffic.json';
import { CALL_GAP, callSign, due, passing, passingText, schedule, spoken } from '../src/aboard/radioCalls';
import { Track, type TrafficSpec, type TrafficVessel } from '../src/scene/traffic';
import { MESH_MOST, hasRoom, iceServers, offerDelay, unraised, yields } from '../src/net/web/voicePlan';

const spec = bay as unknown as TrafficSpec;
const SEASON = 36 * 3600;

describe('the ferries and ships on channel 16', () => {
  const calls = schedule(spec, SEASON);

  it('is the same list every time it is worked out', () => {
    expect(schedule(spec, SEASON)).toEqual(calls);
  });

  it('is occasional: in order, never two within five minutes, a few an hour', () => {
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
      const first = c.text.includes('leaving Sausalito for the Ferry Building');
      expect(first || c.text.includes('leaving the Ferry Building for Sausalito')).toBe(true);
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
    expect(calls[0].text.startsWith('Securite, securite, securite. All stations, this is the ')).toBe(true);
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
