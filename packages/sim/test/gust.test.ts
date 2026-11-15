import { describe, expect, it } from 'vitest';
import { Sim, D2R, R2D, KT } from '../src';
import { boat } from './helpers';
import { SCRIPT } from './script';

interface Blow { sim: Sim; maxHeel: number; slowest: number; pinned: number; luffed: number; counts: number[] }

/**
 * Close reaching in 12 kt with the crew trimming, then the wind comes up to `twsKt` and she is watched for 40 seconds.
 * `pinned` leaves the sheets where the crew had them for 12 kt. `eased` does the same but lets the main out as the gust hits.
 */
function blow(twsKt: number, opts: { twaDeg?: number; reef?: number; sheets?: 'pinned' | 'eased' | 'crew' } = {}): Blow {
  const twa = opts.twaDeg ?? 45;
  const wind = { kt: 12 };
  const env = { sample: () => ({ windDir: 0, windSpeed: wind.kt * KT, currentX: 0, currentY: 0 }) };
  const sim = new Sim(boat, env, { headingDeg: -twa, speedKt: 5, reef: opts.reef ?? 0 });
  sim.setCrewTrim(true);
  sim.trimForWind();
  sim.setHelm('wind', twa * D2R);
  sim.advance(60);
  const sheets = opts.sheets ?? 'pinned';
  if (sheets !== 'crew') {
    sim.setCrewTrim(false);
    sim.setHelm('heading');
  }
  wind.kt = twsKt;
  if (sheets === 'eased') sim.setControl('mainsheet', sim.state.mainSheet + 22 * D2R);
  const out: Blow = { sim, maxHeel: 0, slowest: Infinity, pinned: 0, luffed: 0, counts: [] };
  for (let i = 0; i < 160; i++) {
    sim.advance(0.25);
    out.maxHeel = Math.max(out.maxHeel, Math.abs(sim.state.heel) * R2D);
    out.slowest = Math.min(out.slowest, sim.state.speed / KT);
    out.luffed = Math.max(out.luffed, twa - Math.abs(sim.out.twa) * R2D);
    if (sim.out.knockedDown) out.pinned += 0.25;
    out.counts.push(sim.state.knockdowns);
  }
  return out;
}

describe('a hard wind on too much sail', () => {
  it('the reference sail is below the wind where any of this begins', () => {
    expect(SCRIPT.windKt).toBeLessThan(17);
  });

  it('full sail and pinned sheets in 26 kt knocks her down, and she comes back up', () => {
    const b = blow(26);
    expect(b.sim.state.knockdowns).toBeGreaterThanOrEqual(1);
    expect(b.sim.state.crashGybes).toBe(0);
    expect(b.maxHeel).toBeGreaterThan(60);
    expect(b.pinned).toBeGreaterThan(2);
    expect(b.slowest).toBeLessThan(2);
    // She rounds up, and the pilot lets go of the wheel.
    expect(b.luffed).toBeGreaterThan(20);
    expect(b.sim.state.pilotTrips).toBeGreaterThanOrEqual(1);
    expect(b.sim.out.knockedDown).toBe(false);
  });

  it('the count goes up once for each knockdown, not every step', () => {
    const b = blow(26);
    let rises = 0;
    for (let i = 1; i < b.counts.length; i++) {
      const step = b.counts[i] - b.counts[i - 1];
      expect(step).toBeLessThanOrEqual(1);
      rises += step;
    }
    expect(rises).toBe(b.sim.state.knockdowns);
    expect(rises).toBeLessThanOrEqual(3);
    // Each one lays her flat for seconds on end.
    expect(b.pinned / rises).toBeGreaterThan(2);
  });

  it('the same gust with the main eased as it hits does not', () => {
    const b = blow(26, { sheets: 'eased' });
    expect(b.sim.state.knockdowns).toBe(0);
    expect(b.maxHeel).toBeLessThan(30);
    expect(b.slowest).toBeGreaterThan(3);
  });

  it('a reef in 22 kt does not, and the pilot keeps the wheel', () => {
    const b = blow(22, { reef: 1 });
    expect(b.sim.state.knockdowns).toBe(0);
    expect(b.maxHeel).toBeLessThan(25);
    expect(b.sim.state.pilotTrips).toBe(0);
  });

  it('20 to 22 kt under full sail lays her over and rounds her up without pinning her', () => {
    const b = blow(22);
    expect(b.sim.state.knockdowns).toBe(0);
    expect(b.maxHeel).toBeGreaterThan(40);
    expect(b.luffed).toBeGreaterThan(15);
    expect(b.slowest).toBeLessThan(3);
    expect(blow(18).maxHeel).toBeLessThan(25);
  });

  it('one reef makes 25 kt hard but sailable, and two reefs make 30 kt sailable', () => {
    const one = blow(25, { reef: 1 });
    expect(one.sim.state.knockdowns).toBe(0);
    expect(one.slowest).toBeGreaterThan(4);
    const two = blow(30, { reef: 2 });
    expect(two.sim.state.knockdowns).toBe(0);
    expect(two.maxHeel).toBeLessThan(25);
    expect(two.slowest).toBeGreaterThan(4);
  });

  it('with the crew trimming they spill the gust at 24 kt, and at 26 kt on the pilot she rounds up and the pilot trips', () => {
    const saved = blow(24, { sheets: 'crew' });
    expect(saved.sim.state.knockdowns).toBe(0);
    expect(saved.sim.state.pilotTrips).toBe(0);
    expect(saved.sim.state.gustEase).toBeGreaterThan(0);
    // She staggers all the same.
    expect(saved.maxHeel).toBeGreaterThan(26);
    const lost = blow(26, { sheets: 'crew' });
    expect(lost.sim.state.pilotTrips).toBeGreaterThanOrEqual(1);
    expect(lost.luffed).toBeGreaterThan(15);
  });

  it('is deterministic', () => {
    expect(blow(27).sim.snapshot()).toEqual(blow(27).sim.snapshot());
  });
});
