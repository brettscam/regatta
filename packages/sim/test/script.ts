import { Sim, D2R, type ControlName } from '../src';
import { boat, northWind } from './helpers';

export type ScriptStep =
  | { at: number; set: ControlName; deg: number }
  | { at: number; tack: true }
  | { at: number; helm: 'hand' | 'heading' | 'wind'; deg?: number };

/**
 * The reference sail: beat upwind through a tack sailed by hand, a crew tack, bear away to a reach,
 * gybe, then harden up. It touches every phase 1 behaviour, so any physics change moves this track.
 */
export const SCRIPT: { windKt: number; headingDeg: number; speedKt: number; seconds: number; steps: ScriptStep[] } = {
  windKt: 14,
  headingDeg: 315,
  speedKt: 5,
  seconds: 420,
  steps: [
    { at: 0, set: 'mainsheet', deg: 6 },
    { at: 0, set: 'jibsheet_port', deg: 2 },
    { at: 0, set: 'jibsheet_stbd', deg: 80 },
    // A tack by hand: helm over, let the old sheet fly, trim the new one, centre the wheel.
    { at: 40, set: 'rudder', deg: 22 },
    { at: 44, set: 'jibsheet_port', deg: 80 },
    { at: 46, set: 'jibsheet_stbd', deg: 3 },
    { at: 47.5, set: 'rudder', deg: 0 },
    // Hold the wind angle and let the crew take her back.
    { at: 80, helm: 'wind' },
    { at: 110, tack: true },
    // Bear away onto a reach and ease.
    { at: 160, helm: 'heading', deg: 270 },
    { at: 165, set: 'mainsheet', deg: 40 },
    { at: 165, set: 'jibsheet_port', deg: 28 },
    // Run off, gybe, and come back up.
    { at: 220, helm: 'heading', deg: 200 },
    { at: 228, set: 'mainsheet', deg: 75 },
    { at: 228, set: 'jibsheet_port', deg: 55 },
    { at: 280, tack: true },
    { at: 330, helm: 'heading', deg: 80 },
    { at: 336, set: 'mainsheet', deg: 30 },
    { at: 336, set: 'jibsheet_stbd', deg: 20 },
  ],
};

export interface TrackPoint {
  t: number; x: number; y: number; hdg: number; kt: number; heel: number;
}

export function runScript(script: typeof SCRIPT): { sim: Sim; track: TrackPoint[] } {
  const sim = new Sim(boat, northWind(script.windKt), { headingDeg: script.headingDeg, speedKt: script.speedKt });
  const steps = [...script.steps];
  const track: TrackPoint[] = [];
  const total = Math.round(script.seconds / sim.dt);
  for (let i = 0; i <= total; i++) {
    const t = i * sim.dt;
    while (steps.length && steps[0].at <= t + 1e-9) {
      const st = steps.shift()!;
      if ('set' in st) sim.setControl(st.set, st.deg * D2R);
      else if ('tack' in st) sim.tack();
      else sim.setHelm(st.helm, st.deg === undefined ? undefined : st.deg * D2R);
    }
    if (i % 300 === 0) {
      const s = sim.state;
      track.push({ t: s.t, x: s.x, y: s.y, hdg: s.heading, kt: s.speed / 0.514444, heel: s.heel });
    }
    if (i < total) sim.step();
  }
  return { sim, track };
}
