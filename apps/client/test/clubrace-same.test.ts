import { describe, expect, it } from 'vitest';
import { drawEntrants } from '../src/race/cast';
import { musterFleet, sailTrial, sailTrialSlowly } from '../src/race/trial';
import { LONG, sailLevels } from './clubrace';
import { boatOf, racesOf, worldOf } from './waters';

describe('a club race is the same race every time', () => {
  const dash = racesOf('sf-bay').find((r) => r.id === 'gate-dash')!;
  const spec = boatOf('sloop38');

  it('sails the same mistakes to the same finish from the same call', async () => {
    const sail = () => {
      const world = worldOf('sf-bay', 5.5);
      return sailTrialSlowly(musterFleet(world, spec, dash.marks, drawEntrants('same-call', 4, 'beer')), world, { limit: 3 * 3600 });
    };
    const a = await sail();
    const b = await sail();
    expect(a.map((r) => r.skipper)).toEqual(b.map((r) => r.skipper));
    a.forEach((r, i) => {
      expect(r.finish).not.toBeNull();
      expect(r.finish).toBe(b[i].finish);
      expect([r.blunders, r.needlessTacks, r.tacks, r.late]).toEqual([b[i].blunders, b[i].needlessTacks, b[i].tacks, b[i].late]);
      expect(r.sailor.sim.state.x).toBe(b[i].sailor.sim.state.x);
      expect(r.sailor.sim.state.y).toBe(b[i].sailor.sim.state.y);
      expect(r.agroundSeconds + r.tows).toBe(0);
    });
    // Boats in company finish in a string, not a heap.
    expect(new Set(a.map((r) => r.finish)).size).toBe(4);
  }, LONG);

  it('ten boats start without sailing through one another', () => {
    const world = worldOf('sf-bay', 5.5);
    const boats = musterFleet(world, spec, dash.marks, drawEntrants('ten-on-the-line', 9, 'hot'));
    const rows = sailTrial(boats, world, { limit: 240 });
    expect(rows.length).toBe(9);
    // Four minutes in, everyone is away and no two hulls are in the same water.
    for (const r of rows) expect(r.sailor.leg).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < boats.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = boats[i].sim.state;
        const b = boats[j].sim.state;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(3);
      }
    }
  }, LONG);

  it('in the Extreme wind the back of the fleet is overpowered and the front is not, and everyone still gets home', async () => {
    const [ringer, casual, sunset] = await sailLevels('sf-bay', 'gate-dash', 5.5, 'a', ['ringer', 'casual', 'sunset'], 1.5);
    for (const r of [ringer, casual, sunset]) {
      expect(r.finish).not.toBeNull();
      expect(r.agroundSeconds + r.tows).toBe(0);
    }
    expect(ringer.pilotTrips + ringer.knockdowns).toBe(0);
    // Rounding up until the pilot lets go, and laid flat at least once between them.
    expect(casual.pilotTrips + sunset.pilotTrips).toBeGreaterThan(10);
    expect(casual.knockdowns + sunset.knockdowns).toBeGreaterThan(0);
    expect(ringer.finish!).toBeLessThan(Math.min(casual.finish!, sunset.finish!));
  }, LONG);
});
