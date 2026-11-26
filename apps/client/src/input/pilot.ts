import { R2D, type Sim } from '@slack-tide/sim';
import type { Passage } from '../ui/passage';

export type PilotMode = 'heading' | 'wind' | 'route';

const MODE_NAME: Record<PilotMode, string> = { heading: 'heading', wind: 'wind angle', route: 'route' };
const ORDER: PilotMode[] = ['heading', 'wind', 'route'];
/** The same for a boat with no sails. */
const POWER_ORDER: PilotMode[] = ['heading', 'route'];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const deg3 = (rad: number) => String(Math.round(((rad * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');

export interface PilotHooks {
  /** A passing remark: the pilot did something the player asked for. */
  say(text: string): void;
  /** Something that needs the player. */
  alarm(text: string): void;
  /** The race she is racing now, after the gun and before her finish, or null. Full pilot is rationed in a race. */
  racing?(): string | null;
}

/** Seconds of full pilot, steering and trimming, a boat may use in one race from the gun. Steering alone is unlimited. */
export const FULL_PILOT_IN_RACE = 180;

/**
 * Two levels of autopilot. Partial: it steers and the sheets are hers, so a badly trimmed boat stays slow. Full: it steers
 * and the crew trims, the boat sailing herself. P steps off, partial, full, off. In a race, full is rationed from the gun.
 */
export type PilotLevel = 'partial' | 'full';

/**
 * The autopilot as the player meets it: engage or release, pick what it holds, and hear what it is doing.
 * The steering itself lives in the sim. With the pilot on, the crew trims the sails, so the boat sails herself.
 */
export class Pilot {
  /** What the pilot will hold when engaged. */
  mode: PilotMode = 'wind';
  private wasEngaged = false;
  private turns = 0;
  private trips = 0;
  /** Full pilot used in the race now being sailed, and which race that is. */
  private raceId: string | null = null;
  private used = 0;
  private lastT = 0;

  constructor(private readonly sim: Sim, private readonly passage: Passage, private readonly hooks: PilotHooks) {
    // With no sails there is no wind angle to hold. She is steered for her next mark, or on a heading when she has none.
    if (sim.boat.power) this.mode = 'route';
    this.turns = sim.state.routeTurns;
    this.trips = sim.state.pilotTrips;
    this.wasEngaged = this.engaged;
    this.lastT = sim.state.t;
    if (this.engaged) {
      this.mode = sim.state.helmMode as PilotMode;
      sim.setCrewTrim(true);
    }
  }

  /** Which level is on: full when the crew is trimming, partial when she steers and the sheets are the player's. */
  get level(): PilotLevel | null {
    if (!this.engaged) return null;
    return this.sim.state.crewTrim ? 'full' : 'partial';
  }

  /** Seconds of full pilot left in this race, or null outside a race. */
  fullLeft(): number | null {
    const id = this.hooks.racing?.() ?? null;
    if (!id) return null;
    return Math.max(0, FULL_PILOT_IN_RACE - (id === this.raceId ? this.used : 0));
  }

  /** Whether full pilot may be used now. Says why not, when asked to speak. */
  private fullAllowed(speak: boolean): boolean {
    const left = this.fullLeft();
    if (left === null || left > 0) return true;
    if (speak) this.hooks.say('Full pilot is used up for this race. The pilot steers; the sheets are yours');
    return false;
  }

  get engaged(): boolean {
    return this.sim.state.helmMode !== 'hand';
  }

  /**
   * True aboard a boat with no sails (`boat.power`). Her pilot has one level, because there is nothing for a crew to
   * trim, and two things it can hold, a heading or a route: a wind angle means nothing to her.
   */
  private get sailless(): boolean {
    return !!this.sim.boat.power;
  }

  /** What the pilot can hold in this boat, in the order Shift+P steps through them. */
  private get order(): PilotMode[] {
    return this.sailless ? POWER_ORDER : ORDER;
  }

  private nextMark() {
    return this.passage.marks[this.passage.nextIndex] ?? null;
  }

  /** At anchor or made fast there is nothing to steer. Says so, and returns true, rather than pretend to engage. */
  private heldFast(): boolean {
    const hold = this.sim.state.hold;
    if (hold === 'none') return false;
    this.hooks.say(hold === 'anchor'
      ? 'She is at anchor, so there is nothing for the pilot to steer. X weighs anchor'
      : 'She is made fast, so there is nothing for the pilot to steer. X lets her go');
    return true;
  }

  /** P: off, then steering only, then steering and trimming, then off. */
  toggle(): void {
    if (this.heldFast()) return;
    if (!this.engaged) {
      this.engage(this.mode, true, 'partial');
    } else if (!this.sailless && this.level === 'partial' && this.fullAllowed(true)) {
      this.sim.setCrewTrim(true);
      const left = this.fullLeft();
      this.hooks.say(`Full pilot: ${this.describe()}, and the crew has the sheets${left !== null ? `. ${clock(left)} of full pilot left this race` : ''}`);
    } else {
      // Leave the rudder where it is: the wheel holds where it is left.
      this.sim.setControl('rudder', this.sim.state.rudder);
      this.sim.setCrewTrim(false);
      this.wasEngaged = false;
      this.hooks.say(this.sailless ? 'Pilot off. You have the helm' : 'Pilot off. You have the helm and the sheets');
    }
  }

  /** Step to the next thing the pilot can hold. If it is steering, it changes over at once. */
  cycle(): void {
    if (this.heldFast()) return;
    const order = this.order;
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
    if (this.engaged) this.engage(this.mode, true);
    else this.hooks.say(`Pilot set to hold ${MODE_NAME[this.mode]}. P engages it`);
  }

  private engage(mode: PilotMode, speak: boolean, level: PilotLevel = this.level ?? 'partial'): void {
    const sim = this.sim;
    if (this.sailless && mode === 'wind') mode = 'heading';
    const full = level === 'full' && this.fullAllowed(false);
    if (mode === 'route') {
      const next = this.nextMark();
      if (!next) {
        this.mode = 'heading';
        sim.setHelm('heading');
        if (speak) this.hooks.say('No mark to steer for. Holding this heading. Drop a waypoint on the chart (M)');
        sim.setCrewTrim(full);
        this.wasEngaged = true;
        return;
      }
      sim.setRoute(next, this.passage.legOrigin);
    } else {
      sim.setHelm(mode);
    }
    this.mode = mode;
    sim.setCrewTrim(full);
    this.wasEngaged = true;
    if (speak) this.hooks.say(this.sailless ? `Pilot steering: ${this.describe()}. The throttle is yours` : full ? `Full pilot: ${this.describe()}, and the crew has the sheets` : `Pilot steering: ${this.describe()}. The sheets are yours; P again and the crew trims too`);
  }

  /** The player has picked up a sheet, so the crew leaves the trimming alone. */
  sheetsInHand(): void {
    if (this.sim.state.crewTrim) this.sim.setCrewTrim(false);
  }

  /** Keep the pilot's target, the crew and the player informed. Call once a frame after the sim has stepped. */
  update(): void {
    const s = this.sim.state;
    // Count full pilot used in a race, from the gun to her finish. A new race starts a new allowance.
    const dt = Math.max(0, Math.min(5, s.t - this.lastT));
    this.lastT = s.t;
    const id = this.hooks.racing?.() ?? null;
    if (id !== this.raceId && id !== null) { this.raceId = id; this.used = 0; }
    if (id !== null && this.level === 'full') {
      this.used += dt;
      if (this.used >= FULL_PILOT_IN_RACE) {
        this.sim.setCrewTrim(false);
        this.hooks.alarm('Full pilot used up for this race. The pilot keeps steering: trim the sails yourself');
      }
    }
    if (s.pilotTrips !== this.trips) {
      this.trips = s.pilotTrips;
      this.sim.setCrewTrim(false);
      this.hooks.alarm('Autopilot overpowered. You have the helm');
    }
    if (!this.engaged) {
      // A hand on the wheel takes the boat back, sheets and all.
      if (this.wasEngaged) this.sim.setCrewTrim(false);
      this.wasEngaged = false;
      return;
    }
    this.wasEngaged = true;
    if (!s.maneuver) this.mode = s.helmMode as PilotMode;
    if (s.routeTurns !== this.turns) {
      this.turns = s.routeTurns;
      this.hooks.say(Math.abs(this.sim.out.twa) < Math.PI / 2 ? 'Pilot: tacking for the mark' : 'Pilot: gybing for the mark');
    }
    if (s.helmMode === 'route' && !s.maneuver) {
      const next = this.nextMark();
      if (!next) {
        this.sim.setHelm('heading');
        this.hooks.alarm(`Route complete. Pilot holding ${deg3(s.heading)}°`);
      } else if (next.x !== s.routeX || next.y !== s.routeY) {
        this.sim.setRoute(next, this.passage.legOrigin);
      }
    }
  }

  /** The big figure on the pilot's screen. */
  label(): string {
    const s = this.sim.state;
    let mode = this.engaged && !s.maneuver ? (s.helmMode as PilotMode) : this.mode;
    if (this.sailless && mode === 'wind') mode = 'heading';
    if (mode === 'heading') return `${deg3(this.engaged ? s.helmTarget : s.heading)}°`;
    if (mode === 'wind') {
      const a = this.engaged && s.helmMode === 'wind' ? s.helmTarget : this.sim.out.twa;
      return `${Math.round(Math.abs(a) * R2D)}° ${a >= 0 ? 'S' : 'P'}`;
    }
    return this.nextMark()?.name ?? 'No mark';
  }

  private describe(): string {
    if (this.mode === 'heading') return `holding ${this.label()}`;
    if (this.mode === 'wind') return `holding the wind at ${this.label()}`;
    return this.sim.out.pilotBeating ? `beating up to ${this.label()}` : `steering for ${this.label()}`;
  }

  /** For the tag at the pointer. */
  tag(): string {
    return this.engaged ? this.describe() : `standby, set to ${MODE_NAME[this.sailless && this.mode === 'wind' ? 'heading' : this.mode]}`;
  }

  /** One line for the instrument readout. */
  line(): string {
    if (this.sailless) {
      const set = this.mode === 'wind' ? 'heading' : this.mode;
      return this.engaged ? `Pilot steering <b class="on">${this.describe()}</b> · the throttle is yours` : `Helm <b>in hand</b> · pilot set to ${MODE_NAME[set]}`;
    }
    const crew = this.sim.state.crewTrim ? 'crew trimming' : 'you trim';
    if (!this.engaged) return `Helm <b>in hand</b> · ${crew} · pilot set to ${MODE_NAME[this.mode]}`;
    const left = this.fullLeft();
    const ration = left === null ? '' : ` · full pilot ${clock(left)} left`;
    return `${this.level === 'full' ? 'Full pilot' : 'Pilot steering'} <b class="on">${this.describe()}</b> · ${crew}${ration}`;
  }

  /** For the race bar: what is left of the full pilot, once any has been used or while it is on. */
  raceNote(): string {
    const left = this.fullLeft();
    if (left === null) return '';
    if (this.level === 'full') return `full pilot ${clock(left)}`;
    return left < FULL_PILOT_IN_RACE ? `full pilot ${left > 0 ? clock(left) + ' left' : 'used up'}` : '';
  }
}
