import type { Sim } from '@slack-tide/sim';
import type { AboardContext, Feature } from './feature';

interface Water {
  depth(x: number, y: number, t: number): number;
  wind(x: number, y: number, t: number): { dir: number };
}

/**
 * The nearest spot to a point with enough water to float her and room to swing, searching outward in rings.
 * Null if there is none within three miles.
 * @param from metres off to start looking at
 */
export function deepWater(world: Water, draft: number, x0: number, y0: number, t: number, from = 60): { x: number; y: number; depth: number } | null {
  const need = draft + 4;
  for (let r = from; r <= 5600; r += 60) {
    const n = Math.max(12, Math.round((2 * Math.PI * r) / 80));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = x0 + Math.sin(a) * r;
      const y = y0 + Math.cos(a) * r;
      const depth = world.depth(x, y, t);
      if (depth < need) continue;
      // Room to swing: deep enough a boat length or two all round.
      let clear = true;
      for (let j = 0; j < 6 && clear; j++) {
        const b = (j / 6) * Math.PI * 2;
        clear = world.depth(x + Math.sin(b) * 90, y + Math.cos(b) * 90, t) >= draft + 1.5;
      }
      if (clear) return { x, y, depth };
    }
  }
  return null;
}

/** Put her at a spot, stopped, upright and head to wind with the helm in hand, ready to bear away. */
export function leaveAt(sim: Sim, world: Water, spot: { x: number; y: number }): void {
  const s = sim.state;
  s.x = spot.x;
  s.y = spot.y;
  s.speed = 0;
  s.lateral = 0;
  s.yawRate = 0;
  s.heel = 0;
  s.knock = 0;
  s.rudderCmd = 0;
  s.rudder = 0;
  s.maneuver = null;
  s.heading = world.wind(spot.x, spot.y, s.t).dir;
  sim.setHelm('hand');
}

/**
 * A tow off the putty. Aground with no way to sail her off, U has her towed to the nearest water with
 * a few metres under the keel, and leaves her there stopped, head to wind, for the player to sail away.
 */
export class Tow implements Feature {
  readonly id = 'tow';
  private stuck = 0;
  private told = false;

  constructor(private readonly ctx: AboardContext) {}

  key(code: string): boolean {
    if (code !== 'KeyU') return false;
    const { sim, world } = this.ctx;
    const s = sim.state;
    if (s.hold !== 'none') {
      this.ctx.say('She is made fast. U is for a tow when she is aground');
      return true;
    }
    if (!sim.out.aground && (sim.out.underKeel === null || sim.out.underKeel > 0.3)) {
      this.ctx.say('She is afloat. U calls for a tow when she is aground');
      return true;
    }
    const spot = deepWater(world, this.ctx.spec.dimensions.draft, s.x, s.y, s.t);
    if (!spot) {
      this.ctx.alarm('No deep water within reach for a tow');
      return true;
    }
    const metres = Math.hypot(spot.x - s.x, spot.y - s.y);
    // Left head to wind with the sheets eased, ready to bear away.
    leaveAt(sim, world, spot);
    this.stuck = 0;
    this.told = false;
    this.ctx.alarm(`Towed off ${metres < 400 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1852).toFixed(1)} miles`} into ${Math.round(spot.depth)} m of water. She is head to wind: put the wheel over and sail her away`);
    return true;
  }

  update(dt: number): void {
    // Stuck for a while: say once that a tow is there for the asking.
    if (this.ctx.sim.out.aground && this.ctx.sim.state.hold === 'none') {
      this.stuck += dt;
      if (this.stuck > 20 && !this.told) {
        this.told = true;
        this.ctx.say('Hard aground. If she will not sail off, U calls for a tow to deep water', 8);
      }
    } else if (this.stuck > 0) {
      this.stuck = 0;
      this.told = false;
    }
  }
}
