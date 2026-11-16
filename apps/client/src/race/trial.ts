/**
 * A race sailed with nobody watching: the pace boats alone, start to finish, as fast as the machine will go.
 * It is how the tests and `scripts/sailrace.ts` find out who wins, by how much, and whether anyone goes ashore.
 * The boats jostle and take each other's wind just as they do on the water with a player among them.
 */
import { SIM_DT, type Environment } from '@slack-tide/sim';
import { drawEntrants, type Entrant, type Mix } from './cast';
import { PaceSailor, separate, startBerths, type Mark } from './sailor';
import { shadowAt, shadowEase, type ShadowSource } from './shadow';
import type { BoatSpec } from '@slack-tide/sim';

export interface TrialWorld extends Environment {
  chartDepth(x: number, y: number): number;
}

export interface TrialRow {
  skipper: string;
  boat: string;
  level: string;
  /** Seconds from the gun, or null if she was still out when the time ran out. */
  finish: number | null;
  /** Seconds after the gun she got going. */
  late: number;
  leg: number;
  remaining: number;
  blunders: number;
  needlessTacks: number;
  tacks: number;
  knockdowns: number;
  pilotTrips: number;
  agroundSeconds: number;
  tows: number;
  rallies: number;
  escapes: number;
  sailor: PaceSailor;
}

export interface TrialOptions {
  /** Session seconds at the gun. */
  gun?: number;
  /** Give up after this many seconds of racing. */
  limit?: number;
  /** False sails each boat as if alone: no wind shadow, no jostling. */
  company?: boolean;
}

/** Whether a boat of this draft can lie at a point, by the chart alone. */
export const berthClear = (world: TrialWorld, draft: number) => (x: number, y: number): boolean => world.chartDepth(x, y) >= draft + 2.5;

/** The pace boats of a race, in their berths. */
export function musterFleet(world: TrialWorld, spec: BoatSpec, marks: readonly Mark[], entrants: readonly Entrant[]): PaceSailor[] {
  const berths = startBerths(marks, entrants, berthClear(world, spec.dimensions.draft));
  return entrants.map((e, i) => new PaceSailor(e, berths[i], spec, world, marks, i));
}

/** Each boat's wind for the bad air the others leave. The same sums `aboard/badair.ts` does with the player among them. */
export function shade(boats: readonly PaceSailor[], world: Environment, sources: ShadowSource[], dt: number): void {
  sources.length = 0;
  for (const p of boats) {
    const d = p.sim.boat.dimensions;
    sources.push({ x: p.sim.state.x, y: p.sim.state.y, sog: p.sim.out.sog, cog: p.sim.out.cog, length: d.loa, mast: d.mastHeight, sails: p.sim.state.hold === 'none' });
  }
  const ease = shadowEase(dt);
  for (let i = 0; i < boats.length; i++) {
    const p = boats[i];
    const ps = p.sim.state;
    const own = sources[i];
    const sails = own.sails;
    own.sails = false;
    const here = world.sample(ps.x, ps.y, ps.t);
    const want = ps.hold === 'none' ? shadowAt(ps.x, ps.y, here.windDir, here.windSpeed, sources).factor : 1;
    own.sails = sails;
    const next = p.air.factor + (want - p.air.factor) * ease;
    p.air.factor = next > 0.998 && want === 1 ? 1 : next;
  }
}

/** A fleet under way: `run(steps)` sails it on and says whether anyone is still out. */
function underWay(boats: PaceSailor[], world: TrialWorld, options: TrialOptions): { run(steps: number): boolean; rows(): TrialRow[] } {
  const { gun = 0, limit = 4 * 3600, company = true } = options;
  const tick = Math.round(gun / SIM_DT);
  for (const p of boats) p.start(tick);
  const sources: ShadowSource[] = [];
  const last = Math.round(limit / SIM_DT);
  let n = 0;
  return {
    run(steps: number): boolean {
      for (let k = 0; k < steps && n < last; k++) {
        n++;
        const elapsed = n * SIM_DT;
        let out = 0;
        for (const p of boats) {
          p.step(elapsed);
          if (p.finish === null) out++;
        }
        if (company) {
          separate(boats);
          if (n % 6 === 0) shade(boats, world, sources, 6 * SIM_DT);
        }
        if (out === 0) return false;
      }
      return n < last;
    },
    rows: () => boats.map((p) => ({
      skipper: p.skipper, boat: p.name, level: p.entrant.level.id, finish: p.finish, late: p.late, leg: p.leg, remaining: p.remaining,
      blunders: p.blunders, needlessTacks: p.needlessTacks, tacks: p.sim.state.routeTurns, knockdowns: p.sim.state.knockdowns, pilotTrips: p.sim.state.pilotTrips,
      agroundSeconds: p.agroundSteps * SIM_DT, tows: p.tows, rallies: p.rallies, escapes: p.escapes, sailor: p,
    })).sort((a, b) => (a.finish ?? Infinity) - (b.finish ?? Infinity) || a.remaining - b.remaining),
  };
}

/** Sail a fleet from the gun until everyone is home or the time runs out. */
export function sailTrial(boats: PaceSailor[], world: TrialWorld, options: TrialOptions = {}): TrialRow[] {
  const fleet = underWay(boats, world, options);
  while (fleet.run(100000)) { /* on she goes */ }
  return fleet.rows();
}

/** The same, a few minutes of sailing at a time with a breath between, so a test runner is not left waiting on one long sum. */
export async function sailTrialSlowly(boats: PaceSailor[], world: TrialWorld, options: TrialOptions = {}): Promise<TrialRow[]> {
  const fleet = underWay(boats, world, options);
  while (fleet.run(Math.max(2000, Math.round(60000 / Math.max(1, boats.length))))) await new Promise((r) => setTimeout(r, 0));
  return fleet.rows();
}

/** A whole race from its id, as a player's page would draw it. */
export function trialRace(world: TrialWorld, spec: BoatSpec, marks: readonly Mark[], raceId: string, pace: number, mix: Mix, options: TrialOptions = {}): TrialRow[] {
  return sailTrial(musterFleet(world, spec, marks, drawEntrants(raceId, pace, mix)), world, options);
}
