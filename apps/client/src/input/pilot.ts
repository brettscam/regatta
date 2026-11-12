import { R2D, type Sim } from '@slack-tide/sim';
import type { Passage } from '../ui/passage';

export type PilotMode = 'heading' | 'wind' | 'route';

const MODE_NAME: Record<PilotMode, string> = { heading: 'heading', wind: 'wind angle', route: 'route' };
const ORDER: PilotMode[] = ['heading', 'wind', 'route'];
const deg3 = (rad: number) => String(Math.round(((rad * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');

export interface PilotHooks {
  /** A passing remark: the pilot did something the player asked for. */
  say(text: string): void;
  /** Something that needs the player. */
  alarm(text: string): void;
}

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

  constructor(private readonly sim: Sim, private readonly passage: Passage, private readonly hooks: PilotHooks) {
    this.turns = sim.state.routeTurns;
    this.trips = sim.state.pilotTrips;
    this.wasEngaged = this.engaged;
    if (this.engaged) {
      this.mode = sim.state.helmMode as PilotMode;
      sim.setCrewTrim(true);
    }
  }

  get engaged(): boolean {
    return this.sim.state.helmMode !== 'hand';
  }

  private nextMark() {
    return this.passage.marks[this.passage.nextIndex] ?? null;
  }

  /** P: engage in the selected mode, or hand the wheel back. */
  toggle(): void {
    if (this.engaged) {
      // Leave the rudder where it is: the wheel holds where it is left.
      this.sim.setControl('rudder', this.sim.state.rudder);
      this.sim.setCrewTrim(false);
      this.wasEngaged = false;
      this.hooks.say('Pilot off. You have the helm and the sheets');
    } else {
      this.engage(this.mode, true);
    }
  }

  /** Step to the next thing the pilot can hold. If it is steering, it changes over at once. */
  cycle(): void {
    this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length];
    if (this.engaged) this.engage(this.mode, true);
    else this.hooks.say(`Pilot set to hold ${MODE_NAME[this.mode]}. P engages it`);
  }

  private engage(mode: PilotMode, speak: boolean): void {
    const sim = this.sim;
    if (mode === 'route') {
      const next = this.nextMark();
      if (!next) {
        this.mode = 'heading';
        sim.setHelm('heading');
        if (speak) this.hooks.say('No mark to steer for. Holding this heading. Drop a waypoint on the chart (M)');
        sim.setCrewTrim(true);
        this.wasEngaged = true;
        return;
      }
      sim.setRoute(next, this.passage.legOrigin);
    } else {
      sim.setHelm(mode);
    }
    this.mode = mode;
    sim.setCrewTrim(true);
    this.wasEngaged = true;
    if (speak) this.hooks.say(`Pilot on: ${this.describe()}. The crew has the sheets`);
  }

  /** The player has picked up a sheet, so the crew leaves the trimming alone. */
  sheetsInHand(): void {
    if (this.sim.state.crewTrim) this.sim.setCrewTrim(false);
  }

  /** Keep the pilot's target, the crew and the player informed. Call once a frame after the sim has stepped. */
  update(): void {
    const s = this.sim.state;
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
    const mode = this.engaged && !s.maneuver ? (s.helmMode as PilotMode) : this.mode;
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
    return this.engaged ? this.describe() : `standby, set to ${MODE_NAME[this.mode]}`;
  }

  /** One line for the instrument readout. */
  line(): string {
    const crew = this.sim.state.crewTrim ? 'crew trimming' : 'you trim';
    if (!this.engaged) return `Helm <b>in hand</b> · ${crew} · pilot set to ${MODE_NAME[this.mode]}`;
    return `Pilot <b class="on">${this.describe()}</b> · ${crew}`;
  }
}
