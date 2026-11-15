import { KT, type Sim } from '@slack-tide/sim';
import { describeSea, emptySea, type Sea } from '@slack-tide/world';
import type { Stage } from '../stage';
import { emptyHit, wakeCheck, type WakeHit } from '../scene/wakeField';

/**
 * What the sea has just done to the boat, for anything that wants to draw or sound it.
 * - `slam`: she has fallen off a wave going to windward. Fired at the moment her bow lands. Strength 0.3 to 1.
 * - `surf`: she has caught a wave running. Strength is how hard, 0 to 1. `Seaway.surf` says how hard she is surfing at any moment.
 * - `wake`: a ship's wake has reached her. Strength is its height in metres.
 */
export type SeaEvent = 'slam' | 'surf' | 'wake';

/** Sim steps between looks at the wake. */
const EVERY = 6;

/**
 * The sea as this boat meets it. One of these belongs to the session and is handed to every feature as `ctx.seaway`.
 * It keeps the sea state at the boat (`sea`, and `words` for the readout), the ship's wake at whoever is being
 * followed (`wake`, `wakeFrom`), and tells listeners when she slams, surfs or meets a wake.
 * The sea's effect on how she sails is in the sim. A wake's small check on her speed is applied here, because wakes
 * come from the traffic, which the sim knows nothing of.
 */
export class Seaway {
  /** The sea where the boat is. Refreshed twice a second; all zeros on flat water. */
  readonly sea: Sea = emptySea();
  /** The sea in a few words, as the readout shows it. Empty when there is nothing to say. */
  words = '';
  /** The ship's wake at the point being followed: passing now, or on its way (`arriveIn`). All zeros when there is none. */
  readonly wake: WakeHit = emptyHit();
  /** Whose wake that is, and a name for this one passing of hers. Empty when there is none. */
  wakeFrom = '';
  wakeId = '';
  /** 0 to 1, how hard she is surfing now. */
  surf = 0;
  /** A slam the sim has reported that has not been shown yet: its strength, or 0. The session shows it as her bow comes down. */
  pendingSlam = 0;
  /** True while a wake is shaking the wind out of her sails in light air. */
  slatting = false;
  private readonly listeners: Array<(event: SeaEvent, strength: number) => void> = [];
  private slams: number;
  private readonly slamTimes: number[] = [];
  private surfing = false;
  private think = 0;
  private toldWake = '';
  private clock = 0;

  constructor(private readonly sim: Sim, private readonly stage: Stage, private readonly say: (text: string, seconds?: number) => void) {
    this.slams = sim.state.slams;
  }

  /** Be told when she slams, surfs or meets a wake. Returns a function that stops the telling. */
  on(listener: (event: SeaEvent, strength: number) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Tell the listeners. The session calls this for a slam, at the moment it is shown. */
  emit(event: SeaEvent, strength: number): void {
    for (const l of this.listeners) l(event, strength);
  }

  /** Slams in the last minute of sailing. */
  get slamsLately(): number {
    return this.slamTimes.length;
  }

  /** One fixed sim step. */
  step(): void {
    const { sim } = this;
    const s = sim.state;
    if (s.slams > this.slams) {
      const lwl = sim.boat.dimensions.lwl;
      this.pendingSlam = Math.min(1, Math.max(0.3, this.sea.height / lwl / 0.1));
      this.slamTimes.push(s.t);
    }
    this.slams = s.slams;
    while (this.slamTimes.length && s.t - this.slamTimes[0] > 60) this.slamTimes.shift();
    if (s.tick % EVERY !== 0 || s.hold !== 'none') return;

    // A wake going by checks her a little, more in light air when the roll shakes the wind out of the sails.
    const hit = this.stage.wakes.strongest(s.x, s.y)?.hit;
    this.slatting = false;
    if (!hit || hit.height < 0.1 || Math.abs(s.speed) < 0.3) return;
    const headOn = Math.abs(Math.sin(s.heading) * hit.dirX + Math.cos(s.heading) * hit.dirY);
    const awsKt = sim.out.aws / KT;
    const loss = wakeCheck(hit.height, sim.boat.dimensions.lwl, headOn, awsKt) * EVERY * sim.dt;
    this.slatting = awsKt < 6 && !sim.out.underPower;
    const dv = -s.speed * Math.min(0.2, loss);
    sim.shove(0, 0, dv * Math.sin(s.heading), dv * Math.cos(s.heading));
  }

  /**
   * Once a rendered frame.
   * @param dt real seconds
   * @param x, y the point being followed: the yacht, or the kayak when the player is away in her
   */
  update(dt: number, x: number, y: number): void {
    const { sim, stage } = this;
    const s = sim.state;
    this.clock += dt;
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.5;
      const seas = stage.world.seas;
      if (seas) seas.at(s.x, s.y, s.t, this.sea);
      else Object.assign(this.sea, emptySea());
      this.words = this.sea.windHeight >= 0.2 || this.sea.swellHeight >= 0.2 ? describeSea(this.sea) : '';
      stage.wakes.refresh(stage.world.seasonTime(s.t), x, y);
    }
    const found = stage.wakes.strongest(x, y);
    if (found) {
      Object.assign(this.wake, found.hit);
      this.wakeFrom = found.wake.name;
      this.wakeId = `${found.wake.id}@${Math.round(found.wake.passedAt / 20)}`;
    } else {
      Object.assign(this.wake, emptyHit());
      this.wakeFrom = '';
      this.wakeId = '';
    }

    // The yacht meets a wake: say whose, once for each passing.
    const mine = found && x === s.x && y === s.y ? found : null;
    if (mine && mine.hit.height > 0.15 && this.wakeId !== this.toldWake) {
      this.toldWake = this.wakeId;
      this.emit('wake', mine.hit.peak);
      if (s.hold === 'none') this.say(`${this.wakeFrom}'s wake: ${mine.hit.peak.toFixed(1)} m and steep. ${mine.hit.peak > 0.35 ? 'Take it on the bow, not the beam' : 'A few waves and it is gone'}`, 6);
    }

    // Surfing comes and goes with each wave. Say when she catches one.
    const surf = s.hold === 'none' ? sim.out.surf : 0;
    this.surf += (surf - this.surf) * Math.min(1, dt * 4);
    if (!this.surfing && surf > 0.55) {
      this.surfing = true;
      this.emit('surf', surf);
    } else if (this.surfing && surf < 0.2) this.surfing = false;
  }
}
