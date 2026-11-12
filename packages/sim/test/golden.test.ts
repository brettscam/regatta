import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScript, SCRIPT, type TrackPoint } from './script';

// Golden-track regression test. A physics change must not silently change how the boat sails.
// If a change is meant to move the track, run `npm run golden:update`, look at the diff, and commit it.
const file = resolve(dirname(fileURLToPath(import.meta.url)), 'golden/reference-sail.json');

describe('golden track', () => {
  it('the reference sail follows the recorded track', () => {
    const { track } = runScript(SCRIPT);
    if (process.env.UPDATE_GOLDEN || !existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ script: SCRIPT, track }, null, 1) + '\n');
    }
    const golden = JSON.parse(readFileSync(file, 'utf8')) as { track: TrackPoint[] };
    expect(track.length).toBe(golden.track.length);
    for (let i = 0; i < track.length; i++) {
      for (const k of ['t', 'x', 'y', 'hdg', 'kt', 'heel'] as const) {
        expect(track[i][k], `${k} at t=${track[i].t}`).toBeCloseTo(golden.track[i][k], 9);
      }
    }
  });

  it('the reference sail actually sails: upwind, both tacks, a reach, a gybe', () => {
    const { track, sim } = runScript(SCRIPT);
    const moving = track.filter((p) => p.kt > 3).length / track.length;
    expect(moving).toBeGreaterThan(0.8);
    expect(Math.max(...track.map((p) => p.y))).toBeGreaterThan(150);
    expect(track.some((p) => p.heel > 0.1)).toBe(true);
    expect(track.some((p) => p.heel < -0.1)).toBe(true);
    expect(sim.state.maneuver).toBeNull();
  });
});
