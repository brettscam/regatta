import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Track, type TrafficSpec } from '../src/scene/traffic';
import { WakeField } from '../src/scene/wakes';
import { KAYAK_WAKE, WAKE, findPassings, kayakCapsizes, wakeAt, wakeCheck, wakeDelay, wakeHeight, wakeLength, wakePeriod, type TrackState, type WakeSource } from '../src/scene/wakeField';

const KT = 0.514444;
/** A 280 m ship, 40 m in the beam, heading north through the origin at 12 kt. */
const ship: WakeSource = { x: 0, y: 0, heading: 0, speed: 12 * KT, beam: 40, name: 'Pacific Meridian' };
/** The same ship `seconds` later. */
const later = (seconds: number): WakeSource => ({ ...ship, y: ship.speed * seconds });

describe("a ship's wake", () => {
  it('spreads at the Kelvin angle: it reaches a point 2.83 times its distance off after she passes', () => {
    expect((WAKE.half * 180) / Math.PI).toBeCloseTo(19.47, 2);
    const delay = wakeDelay(200, ship.speed);
    expect(delay).toBeCloseTo((200 * 2.828) / ship.speed, 0);
    // Abeam at 200 m: nothing yet, and the wait is the delay.
    const abeam = wakeAt(ship, 200, 0);
    expect(abeam.eta).toBe(0);
    expect(abeam.height).toBe(0);
    expect(abeam.arriveIn).toBeCloseTo(delay, 6);
    // Just before it arrives, still nothing. Just after, waves.
    expect(wakeAt(later(delay - 2), 200, 0).height).toBe(0);
    expect(wakeAt(later(delay + 6), 200, 0).height).toBeGreaterThan(0.2);
    // Twice as far off, twice as long.
    expect(wakeAt(ship, 400, 0).arriveIn).toBeCloseTo(delay * 2, 6);
  });

  it('is a metre high close to a big ship and decays with distance', () => {
    const at = (off: number) => wakeAt(ship, off, 0).peak;
    expect(at(100)).toBeGreaterThan(0.7);
    expect(at(100)).toBeLessThan(1.0);
    expect(at(300)).toBeLessThan(at(100) * 0.75);
    expect(at(300)).toBeGreaterThan(0.35);
    expect(at(1000)).toBeLessThan(0.25);
    expect(at(3000)).toBe(0);
    // The same on either side of her.
    expect(wakeAt(ship, -300, 0).peak).toBeCloseTo(at(300), 9);
  });

  it('is bigger from a bigger or faster vessel, and nothing from one barely moving', () => {
    expect(wakeHeight(12 * KT, 40, 100)).toBeGreaterThan(wakeHeight(12 * KT, 9, 100) * 2);
    expect(wakeHeight(20 * KT, 11, 100)).toBeGreaterThan(wakeHeight(12 * KT, 11, 100) * 1.5);
    expect(wakeHeight(20 * KT, 11, 100)).toBeGreaterThan(0.45);
    expect(wakeHeight(20 * KT, 11, 100)).toBeLessThan(0.8);
    expect(wakeHeight(2 * KT, 40, 100)).toBe(0);
  });

  it('is a few waves: it builds, peaks on the second, and is gone after eight or so', () => {
    const delay = wakeDelay(200, ship.speed);
    const period = wakePeriod(ship.speed);
    expect(period).toBeGreaterThan(3);
    expect(period).toBeLessThan(3.5);
    expect(wakeLength(ship.speed)).toBeGreaterThan(15);
    expect(wakeLength(ship.speed)).toBeLessThan(18);
    const h = (waves: number) => wakeAt(later(delay + waves * period), 200, 0);
    expect(h(1.5).height).toBeCloseTo(h(1.5).peak, 6);
    expect(h(0.4).height).toBeLessThan(h(1.5).height);
    expect(h(4).height).toBeLessThan(h(1.5).height * 0.6);
    expect(h(9).height).toBeLessThan(h(1.5).height * 0.05);
    expect(h(3).waves).toBeCloseTo(3, 6);
    // The water really goes up and down at that period: count the crests over five periods.
    let crests = 0;
    let last = 0;
    let rising = false;
    for (let t = 0; t < 5 * period; t += 0.05) {
      const eta = wakeAt(later(delay + t), 200, 0).eta;
      if (rising && eta < last) crests++;
      rising = eta > last;
      last = eta;
    }
    expect(crests).toBe(5);
  });

  it('travels out from her track and forward', () => {
    const stbd = wakeAt(later(200), 200, 0);
    expect(stbd.dirX).toBeGreaterThan(0.5);
    expect(stbd.dirY).toBeGreaterThan(0.7);
    const port = wakeAt(later(200), -200, 0);
    expect(port.dirX).toBeCloseTo(-stbd.dirX, 9);
    expect(Math.hypot(stbd.dirX, stbd.dirY)).toBeCloseTo(1, 9);
  });
});

describe('the wakes of the Bay traffic', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const bay = JSON.parse(readFileSync(resolve(here, '../../../courses/sf-bay/traffic.json'), 'utf8')) as TrafficSpec;
  // The ferries and the one ship these tests were laid out for: the Bay's other ships would cross the boat's water too.
  const spec: TrafficSpec = { ...bay, routes: bay.routes.filter((r) => r.kind === 'ferry' && r.model !== 'tug' && r.model !== 'pilot' || r.id === 'ship-inbound') };
  const route = spec.routes.find((r) => r.id === 'ship-inbound')!;
  const track = new Track(route, spec.referenceHours * 3600);
  const state = (t: number, out: TrackState) => track.state(t, out);
  // A moment when she is under way at full speed and has been for a while.
  const st: TrackState = { x: 0, y: 0, heading: 0, sog: 0, active: true };
  let t0 = 0;
  for (let t = 0; t < track.cycle; t += 30) {
    track.state(t, st);
    const before: TrackState = { ...st };
    track.state(t - 240, before);
    if (st.active && st.sog > 5.5 && before.sog > 5.5 && Math.abs(Math.sin(st.heading - before.heading)) < 0.05) { t0 = t; break; }
  }
  track.state(t0, st);
  // A boat 250 m off her starboard beam at that moment.
  const boat = { x: st.x + Math.cos(st.heading) * 250, y: st.y - Math.sin(st.heading) * 250 };

  it('finds the ship passing, before and after she does', () => {
    expect(t0).toBeGreaterThan(0);
    for (const now of [t0 - 120, t0 + 30, t0 + 200]) {
      const found = findPassings(state, now, boat.x, boat.y);
      expect(found.length).toBe(1);
      expect(found[0].t).toBeCloseTo(t0, 0);
      expect(found[0].off).toBeCloseTo(250, 0);
      expect(found[0].speed).toBeCloseTo(12 * KT, 1);
    }
    // Long gone, or nowhere near: nothing.
    expect(findPassings(state, t0 + 1200, boat.x, boat.y).length).toBe(0);
    expect(findPassings(state, t0, boat.x + 9000, boat.y + 9000).length).toBe(0);
  });

  it('brings her wake to the boat when Kelvin says, the same whoever works it out and whenever', () => {
    const field = new WakeField(spec);
    const arrives = t0 + wakeDelay(250, 12 * KT);
    field.refresh(t0 + 20, boat.x, boat.y);
    expect(field.active.length).toBe(1);
    expect(field.height(boat.x, boat.y)).toBe(0);
    const coming = field.strongest(boat.x, boat.y)!;
    expect(coming.wake.name).toBe('Pacific Meridian');
    expect(coming.hit.arriveIn).toBeGreaterThan(arrives - (t0 + 20) - 3);
    expect(coming.hit.arriveIn).toBeLessThan(arrives - (t0 + 20) + 3);
    expect(coming.hit.peak).toBeGreaterThan(0.4);

    // Six seconds after it arrives: the water is moving, and a second player who only now looks gets the same water.
    field.advance(arrives + 6);
    const mine = field.height(boat.x, boat.y);
    expect(field.strongest(boat.x, boat.y)!.hit.height).toBeGreaterThan(0.25);
    const theirs = new WakeField(spec);
    theirs.refresh(arrives + 6, boat.x, boat.y);
    expect(theirs.height(boat.x, boat.y)).toBeCloseTo(mine, 3);

    // Two minutes on it has gone by, and the next look forgets it.
    field.refresh(arrives + 120, boat.x, boat.y);
    expect(field.height(boat.x, boat.y)).toBe(0);
    expect(field.active.length).toBe(0);
  });

  it('draws nothing when there is no wake and crest lines when there is', () => {
    const field = new WakeField(spec);
    field.draw(0, []);
    expect(field.lines.geometry.drawRange.count).toBe(0);
    field.refresh(t0 + wakeDelay(250, 12 * KT) + 8, boat.x, boat.y);
    field.draw(0, []);
    expect(field.lines.geometry.drawRange.count).toBeGreaterThan(20);
    const pos = field.lines.geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < field.lines.geometry.drawRange.count * 3; i++) expect(Number.isFinite(pos[i])).toBe(true);
  });
});

describe('a wake and the boats in it', () => {
  it('puts a kayak over when it is big and she is beam-on, and not when she turns into it', () => {
    // Waves travelling east.
    expect(kayakCapsizes(0.6, 0, 1, 0)).toBe(true);
    expect(kayakCapsizes(0.6, Math.PI, 1, 0)).toBe(true);
    // Bow into them, or stern to them.
    expect(kayakCapsizes(0.6, -Math.PI / 2, 1, 0)).toBe(false);
    expect(kayakCapsizes(0.6, Math.PI / 2, 1, 0)).toBe(false);
    // 30 degrees off head-on is still safe; a small wake is safe any way on.
    expect(kayakCapsizes(0.6, -Math.PI / 2 + 0.5, 1, 0)).toBe(false);
    expect(kayakCapsizes(KAYAK_WAKE.capsize - 0.05, 0, 1, 0)).toBe(false);
  });

  it('is only dangerous to her at close range of a big ship', () => {
    const ship = { speed: 12 * KT, beam: 40 };
    expect(wakeHeight(ship.speed, ship.beam, 150)).toBeGreaterThan(KAYAK_WAKE.capsize);
    expect(wakeHeight(ship.speed, ship.beam, 600)).toBeLessThan(KAYAK_WAKE.capsize);
    // But worth a warning a good deal further off.
    expect(wakeHeight(ship.speed, ship.beam, 500)).toBeGreaterThan(KAYAK_WAKE.warn);
  });

  it('checks a yacht a little: more for the small boat, more head-on, more in light air', () => {
    const base = wakeCheck(0.5, 10, 1, 15);
    expect(base).toBeCloseTo(0.006, 6);
    expect(wakeCheck(0.5, 8.1, 1, 15)).toBeGreaterThan(wakeCheck(0.5, 12.6, 1, 15) * 1.4);
    expect(wakeCheck(0.5, 10, 0, 15)).toBeLessThan(base * 0.5);
    expect(wakeCheck(0.5, 10, 1, 2)).toBeGreaterThan(base * 2);
    expect(wakeCheck(0.05, 10, 1, 15)).toBe(0);
    // A whole wake, eight waves of it all at their biggest, would cost the 30 under a quarter of her speed. Really it is about a third of that.
    expect(wakeCheck(0.6, 8.1, 1, 15) * 8 * 3.2).toBeLessThan(0.25);
  });
});
