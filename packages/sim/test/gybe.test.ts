import { describe, expect, it } from 'vitest';
import { Sim, D2R, R2D, KT } from '../src';
import { boat, northWind } from './helpers';

/** Broad-reaching before a north wind with the wind on the starboard quarter, main eased as given, hand on the wheel. */
function running(twsKt: number, mainSheetDeg: number): Sim {
  const sim = new Sim(boat, northWind(twsKt), { headingDeg: 200, speedKt: 6 });
  sim.setCrewTrim(true);
  sim.trimForWind();
  sim.setHelm('heading');
  sim.advance(40);
  sim.setCrewTrim(false);
  sim.setControl('mainsheet', mainSheetDeg * D2R);
  sim.advance(5);
  return sim;
}

/** Put the helm over so the stern goes through the wind, and watch what happens for a while. */
function gybeByHelm(sim: Sim, seconds = 45) {
  sim.setControl('rudder', -18 * D2R);
  let maxHeel = 0;
  let slowest = Infinity;
  let knockedSeconds = 0;
  const side0 = sim.state.mainSide;
  let crossed = false;
  for (let i = 0; i < seconds * 4; i++) {
    sim.advance(0.25);
    if (!crossed && sim.state.mainSide !== side0) {
      crossed = true;
      sim.setControl('rudder', 0);
    }
    maxHeel = Math.max(maxHeel, Math.abs(sim.state.heel) * R2D);
    if (crossed) slowest = Math.min(slowest, sim.state.speed / KT);
    if (sim.out.knockedDown) knockedSeconds += 0.25;
  }
  return { crossed, maxHeel, slowest, knockedSeconds };
}

describe('gybing', () => {
  it('a crash gybe in a breeze with the main let right out lays her flat, and she comes back up', () => {
    const sim = running(24, 80);
    const run = gybeByHelm(sim);
    expect(run.crossed).toBe(true);
    expect(sim.state.crashGybes).toBe(1);
    expect(sim.state.knockdowns).toBe(1);
    expect(run.maxHeel).toBeGreaterThan(60);
    expect(run.knockedSeconds).toBeGreaterThan(2);
    expect(run.slowest).toBeLessThan(3);
    // She is a keelboat: she rights herself.
    expect(Math.abs(sim.state.heel) * R2D).toBeLessThan(35);
    expect(sim.out.knockedDown).toBe(false);
    expect(sim.state.knock).toBe(0);
  });

  it('the same gybe with the main hauled in first is safe', () => {
    const sim = running(24, 18);
    const run = gybeByHelm(sim);
    expect(run.crossed).toBe(true);
    expect(sim.state.crashGybes).toBe(0);
    expect(sim.state.knockdowns).toBe(0);
    expect(run.maxHeel).toBeLessThan(45);
  });

  it('in a moderate breeze a crash gybe is a hard lurch, not a knockdown', () => {
    const sim = running(15, 80);
    const run = gybeByHelm(sim);
    expect(sim.state.crashGybes).toBe(1);
    expect(sim.state.knockdowns).toBe(0);
    expect(run.maxHeel).toBeGreaterThan(15);
    expect(run.maxHeel).toBeLessThan(55);
  });

  it('in light air the boom just comes across', () => {
    const sim = running(8, 80);
    const run = gybeByHelm(sim);
    expect(run.crossed).toBe(true);
    expect(sim.state.crashGybes).toBe(0);
    expect(run.maxHeel).toBeLessThan(15);
  });

  it('a reefed main lands softer', () => {
    const full = running(21, 80);
    gybeByHelm(full);
    const reefed = new Sim(boat, northWind(21), { headingDeg: 200, speedKt: 6, reef: 2 });
    reefed.setCrewTrim(true);
    reefed.trimForWind();
    reefed.setHelm('heading');
    reefed.advance(40);
    reefed.setCrewTrim(false);
    reefed.setControl('mainsheet', 80 * D2R);
    reefed.advance(5);
    gybeByHelm(reefed);
    expect(full.state.knockdowns).toBe(1);
    expect(reefed.state.knockdowns).toBe(0);
  });

  it('T gybes under control in the same breeze: the crew tends the sheet', () => {
    const sim = running(24, 80);
    expect(sim.tack()).toBe('gybe');
    let maxHeel = 0;
    for (let i = 0; i < 160; i++) {
      sim.advance(0.25);
      maxHeel = Math.max(maxHeel, Math.abs(sim.state.heel) * R2D);
    }
    expect(sim.state.maneuver).toBeNull();
    expect(sim.state.crashGybes).toBe(0);
    expect(maxHeel).toBeLessThan(45);
  });

  it('with the crew trimming, a gybe by the helm is tended too', () => {
    const sim = running(24, 80);
    sim.setCrewTrim(true);
    gybeByHelm(sim);
    expect(sim.state.crashGybes).toBe(0);
  });

  it('a tack is never a crash gybe', () => {
    const sim = new Sim(boat, northWind(24), { headingDeg: 315, speedKt: 5, reef: 1 });
    sim.trimForWind();
    sim.setControl('rudder', 25 * D2R);
    for (let i = 0; i < 20 && sim.out.twa > -30 * D2R; i++) sim.advance(1);
    expect(sim.state.crashGybes).toBe(0);
  });
});
