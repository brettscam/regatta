import type { Place } from '../session';
import type { AboardContext, Feature } from './feature';
import { stamp } from './visited';

/**
 * Alongside a dock there is no need for the kayak: O steps straight ashore, and O again comes back aboard.
 * Anywhere else O is the kayak's key, so this feature sits before the kayak in the list and only takes the key at a dock.
 */
export class Dockside implements Feature {
  readonly id = 'dock';
  /** The place the crew is ashore at, having stepped off the boat. */
  private at: Place | null = null;

  constructor(private readonly ctx: AboardContext) {}

  /** ashore: the place the crew has stepped off at, for `ashore/walk.ts` to put her on her feet there. */
  get ashoreAt(): Place | null {
    return this.at;
  }

  /** The dock she is lying alongside, if she is. */
  private dock(): Place | null {
    const s = this.ctx.sim.state;
    if (s.hold !== 'mooring') return null;
    for (const p of this.ctx.places) {
      if (p.kind === 'dock' && p.ashore && Math.hypot(p.x - s.holdX, p.y - s.holdY) < 30) return p;
    }
    return null;
  }

  key(code: string, shift = false): boolean {
    const { ctx } = this;
    // Shift+O is the tender's: it changes which one she carries.
    if (shift && code === 'KeyO') return false;
    if (this.at) {
      if (code === 'KeyO') {
        ctx.say(`Back aboard from ${this.at.ashore!.name}. X casts off`, 6);
        this.at = null;
        return true;
      }
      if (code === 'KeyX' || code === 'KeyZ') {
        ctx.say('Nobody is aboard. O brings the crew back from ashore first');
        return true;
      }
      return false;
    }
    if (code !== 'KeyO') return false;
    const place = this.dock();
    if (!place?.ashore) return false;
    this.at = place;
    if (stamp(place.id)) ctx.logbook.count('ashore');
    ctx.say(`Ashore at ${place.ashore.name}. ${place.ashore.say} O comes back aboard`, 10);
    return true;
  }

  update(): void {
    // Cast off by some other means while the crew was ashore: they are back aboard.
    if (this.at && this.ctx.sim.state.hold === 'none') this.at = null;
  }

  status(): string {
    return this.at ? `Ashore at ${this.at.ashore!.name}` : '';
  }
}
