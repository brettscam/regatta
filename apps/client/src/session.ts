import * as THREE from 'three';
import { Sim, SIM_DT, KT, R2D, initialState, type SimState } from '@slack-tide/sim';
import type { Waypoint } from '@slack-tide/nav';
import { BoatView, type BoatPose, type Livery } from './boat/boatView';
import type { YardBoat } from './boat/yard';
import { DroneCamera, VIEWS } from './camera/drone';
import { Controls } from './input/controls';
import { Pilot } from './input/pilot';
import type { TrafficVessel } from './scene/traffic';
import { Chart } from './ui/chart';
import { Coach } from './ui/coach';
import { Hud, TIME_RATES } from './ui/hud';
import { Passage } from './ui/passage';
import { Sound } from './audio/sound';
import { Fleet } from './net/fleet';
import type { Stage } from './stage';

export interface SessionOptions {
  spec: YardBoat;
  livery: Livery;
  /** Where she starts, in course metres, and which way she points. Heading defaults to a close reach on port tack. */
  x: number;
  y: number;
  headingDeg?: number;
  route: Waypoint[];
  /** Walk the player through a first sail. */
  tutorial: boolean;
  /** Every boat that can turn up in company, by id. */
  boats: Record<string, YardBoat>;
  /** A saved sim state to carry on from, when the page was republished mid-sail. */
  resume?: SimState;
}

type Snapshot = Pick<SimState, 'x' | 'y' | 'heading' | 'heel' | 'rudder' | 'boomAngle' | 'jibAngle'>;
const grab = (s: SimState): Snapshot => ({ x: s.x, y: s.y, heading: s.heading, heel: s.heel, rudder: s.rudder, boomAngle: s.boomAngle, jibAngle: s.jibAngle });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** One sail: the boat, her instruments, the chart, the pilot, and anyone sailing in company. */
export class Session {
  readonly sim: Sim;
  readonly boatView: BoatView;
  readonly drone: DroneCamera;
  readonly hud = new Hud();
  readonly passage: Passage;
  readonly chart: Chart;
  readonly pilot: Pilot;
  readonly fleet: Fleet;
  readonly coach: Coach | null;
  private readonly sound = new Sound();
  private readonly controls: Controls;
  private paused = false;
  private rateIndex = 0;
  private before: Snapshot;
  private after: Snapshot;
  private acc = 0;
  private readonly motion = { heave: 0, pitch: 0, roll: 0 };
  private readonly boatPos = new THREE.Vector3();
  private readonly watch = { shallow: false, aground: false, marksReached: 0, warned: new Map<string, number>(), crashGybes: 0, knockdowns: 0 };

  constructor(private readonly stage: Stage, private readonly opts: SessionOptions) {
    const world = stage.world;
    const wind = world.wind(opts.x, opts.y, 0);
    this.sim = new Sim(opts.spec, world, { x: opts.x, y: opts.y, headingDeg: opts.headingDeg ?? wind.dir * R2D + 50, speedKt: 5 });
    this.sim.trimForWind();
    // Until the player takes the wheel, the boat holds her angle to the wind.
    this.sim.setHelm('wind');
    if (opts.resume) this.sim.restore(opts.resume);
    this.before = grab(this.sim.state);
    this.after = this.before;
    this.watch.crashGybes = this.sim.state.crashGybes;
    this.watch.knockdowns = this.sim.state.knockdowns;

    this.boatView = new BoatView(opts.spec, opts.livery);
    stage.scene.add(this.boatView.root);
    this.drone = new DroneCamera(window.innerWidth / window.innerHeight);
    this.drone.snap(VIEWS.drone, this.sim.state.heading);

    // The route, the plan worked out from the forecast, and what really happens.
    this.passage = new Passage(opts.spec.polar, {
      wind: (x, y, t) => world.wind(x, y, t, 'forecast'),
      current: (x, y, t) => world.current(x, y, t),
    });
    this.passage.setRoute(opts.route, this.sim.state, this.sim.state.t);
    this.chart = new Chart({
      world,
      passage: this.passage,
      polar: opts.spec.polar,
      now: () => this.sim.state.t,
      boat: () => ({ x: this.sim.state.x, y: this.sim.state.y, heading: this.sim.state.heading, cog: this.sim.out.cog, sog: this.sim.out.sog }),
      traffic: () => this.everyoneElse(),
    });

    this.pilot = new Pilot(this.sim, this.passage, {
      say: (text) => this.hud.raiseAlarm(text, 4),
      alarm: (text) => this.alarm(text),
    });

    // Shared water: other people with this page open, each sailing their own boat. One clock for everyone.
    this.fleet = new Fleet(opts.boats, { boat: opts.spec.id, colour: opts.livery.topsides ?? '', name: opts.livery.name ?? '' }, world, stage.scene);
    void this.fleet.connect();

    const togglePause = (): void => {
      if (this.sharing) this.hud.raiseAlarm('The clock is shared while other boats are here', 4);
      else this.paused = !this.paused;
    };
    this.hud.onPause = togglePause;
    this.hud.onRate = (i) => {
      if (this.sharing) {
        this.hud.setRate(0);
        this.hud.raiseAlarm('Time runs at real speed while other boats are here', 4);
      } else this.rateIndex = i;
    };

    this.coach = opts.tutorial ? new Coach({
      sim: this.sim,
      pilotEngaged: () => this.pilot.engaged,
      chartOpen: () => this.chart.isOpen,
      cameraMoves: () => this.drone.moves,
    }) : null;

    this.controls = new Controls(stage.canvas, this.drone, this.boatView, this.sim, this.hud, this.sound, {
      togglePause,
      announce: (text) => this.hud.raiseAlarm(text, 4),
      toggleChart: () => this.chart.toggle(),
      closeChart: () => this.chart.toggle(false),
      toggleInstruments: () => {
        this.hud.toggleReadout();
        this.chart.setMiniHidden(this.hud.readoutHidden);
      },
      togglePilot: () => this.pilot.toggle(),
      cyclePilotMode: () => this.pilot.cycle(),
      sheetsInHand: () => this.pilot.sheetsInHand(),
      pilotTag: () => this.pilot.tag(),
      controlUsed: (control) => this.coach?.used(control),
    });
  }

  get sharing(): boolean {
    return this.fleet.boats.length > 0;
  }

  /** The whole state, enough to carry on from after a reload. */
  snapshot(): SimState {
    return this.sim.snapshot();
  }

  /** Every other vessel on the water: the Bay's traffic and any boats sailing in company. */
  private everyoneElse(): TrafficVessel[] {
    const traffic = this.stage.traffic.vessels;
    if (!this.fleet.boats.length) return traffic;
    const company: TrafficVessel[] = this.fleet.boats.map((b) => ({ id: `boat-${b.peer}`, name: b.boatName || b.name || 'Another boat', kind: 'sail', x: b.x, y: b.y, heading: b.heading, sog: b.sog, length: b.length, beam: b.length / 3 }));
    return [...traffic, ...company];
  }

  /** A line of text when something needs the player, and time drops back to real speed. */
  private alarm(text: string): void {
    this.hud.raiseAlarm(text, 6);
    this.rateIndex = 0;
    this.hud.setRate(0);
  }

  private checkAlarms(): void {
    const { sim, passage, watch } = this;
    const o = sim.out;
    if (o.aground && !watch.aground) this.alarm('Aground. Get her head round to deeper water');
    else if (!o.aground && o.underKeel !== null && o.underKeel < 2.5 && !watch.shallow) this.alarm(`Shallow water: ${o.underKeel.toFixed(1)} m under the keel`);
    // The boom came across on its own.
    if (sim.state.knockdowns > watch.knockdowns) this.alarm(`Knocked down. Crash gybe in ${Math.round(o.tws / KT)} kt with the main let out. She will come up: ease the sheets`);
    else if (sim.state.crashGybes > watch.crashGybes) this.alarm('Crash gybe. Haul the main in before the boom comes across, or press T and the crew tends it');
    watch.crashGybes = sim.state.crashGybes;
    watch.knockdowns = sim.state.knockdowns;
    watch.aground = o.aground;
    watch.shallow = o.underKeel !== null && o.underKeel < (watch.shallow ? 4 : 2.5);
    const reached = passage.nextIndex;
    if (reached > watch.marksReached) {
      const done = passage.marks[reached - 1];
      const next = passage.marks[reached];
      if (next) {
        // Work out the rest of the route again from here, so the plan stays honest.
        passage.replan({ x: sim.state.x, y: sim.state.y }, sim.state.t);
        const brg = Math.round((Math.atan2(next.x - sim.state.x, next.y - sim.state.y) * R2D + 360) % 360);
        this.alarm(`${done.name} astern. Next mark ${next.name}, bearing ${String(brg).padStart(3, '0')}°`);
      } else {
        this.alarm(`${done.name} reached. Route complete`);
      }
    }
    watch.marksReached = reached;

    // Close quarters: a vessel that will pass close within the next two minutes. One warning per vessel per encounter.
    const near = this.stage.traffic.closest({ x: sim.state.x, y: sim.state.y, cog: o.cog, sog: o.sog });
    if (near && near.tcpa > 0 && near.tcpa < 120 && near.range < 1200 && near.cpa < 70 + near.vessel.length * 0.6) {
      const lastWarned = watch.warned.get(near.vessel.id) ?? -1e9;
      if (sim.state.t - lastWarned > 180) {
        watch.warned.set(near.vessel.id, sim.state.t);
        const brg = Math.round((Math.atan2(near.vessel.x - sim.state.x, near.vessel.y - sim.state.y) * R2D + 360) % 360);
        this.alarm(`${near.vessel.name} bearing ${String(brg).padStart(3, '0')}°, closing. Will pass ${Math.round(near.cpa / 10) * 10} m off in ${Math.round(near.tcpa / 5) * 5} s`);
      }
    }
  }

  frame(dtReal: number): void {
    const { sim, stage, passage, pilot, hud, chart, fleet, drone, boatView, motion } = this;
    const world = stage.world;
    const rate = TIME_RATES[this.rateIndex];
    const paused = this.paused;

    this.controls.update(dtReal, paused);

    // Fixed steps. Faster time just means more of them per frame.
    if (!paused) {
      this.acc += dtReal * rate;
      let steps = Math.floor(this.acc / SIM_DT);
      this.acc -= steps * SIM_DT;
      steps = Math.min(steps, 600);
      for (let i = 0; i < steps; i++) {
        if (i === steps - 1) this.before = this.after;
        sim.step();
        // Keep the track and mark arrivals honest at high time rates.
        if (i % 30 === 0) passage.update(sim.state, sim.state.t);
      }
      if (steps > 0) {
        this.after = grab(sim.state);
        passage.update(sim.state, sim.state.t);
        this.checkAlarms();
        pilot.update();
      }
    }
    // A last line of defence: if the boat's numbers ever go bad, put her back where she started rather than lose her.
    if (!Number.isFinite(sim.state.x + sim.state.y + sim.state.heading + sim.state.heel + sim.state.speed)) {
      const t = sim.state.t;
      sim.restore({ ...initialState({ x: this.opts.x, y: this.opts.y, headingDeg: this.opts.headingDeg ?? world.wind(this.opts.x, this.opts.y, 0).dir * R2D + 50, speedKt: 4 }), t: Number.isFinite(t) ? t : 0, tick: Number.isFinite(t) ? Math.round(t / SIM_DT) : 0 });
      sim.trimForWind();
      sim.setHelm('wind');
      this.before = this.after = grab(sim.state);
      this.alarm('Something went wrong with the boat. She is back at her start');
    }
    const alpha = paused ? 1 : this.acc / SIM_DT;
    const seaTime = sim.state.t + (alpha - 1) * SIM_DT;
    const { before, after } = this;

    // Blend between the last two steps so motion is smooth at any frame rate.
    const heading = mixAngle(before.heading, after.heading, alpha);
    const x = mix(before.x, after.x, alpha);
    const z = -mix(before.y, after.y, alpha);

    // Let the hull ride the long waves: heave, pitch and a little roll.
    const half = this.opts.spec.dimensions.loa * 0.36;
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const sea = (px: number, pz: number) => stage.seaLevel(px, pz, seaTime, 4);
    const hBow = sea(x + fx * half, z + fz * half);
    const hStern = sea(x - fx * half, z - fz * half);
    const hStbd = sea(x - fz * 1.4, z + fx * 1.4);
    const hPort = sea(x + fz * 1.4, z - fx * 1.4);
    const hMid = sea(x, z);
    const ease = paused ? 0 : Math.min(1, dtReal * 5);
    motion.heave += ((hBow + hStern + 2 * hMid) / 4 - motion.heave) * ease;
    motion.pitch += (Math.atan2(hBow - hStern, half * 2) * 0.8 - motion.pitch) * ease;
    motion.roll += (Math.atan2(hPort - hStbd, 2.8) * 0.5 - motion.roll) * ease;

    const pose: BoatPose = {
      x, z, heading,
      heel: mix(before.heel, after.heel, alpha) + motion.roll,
      pitch: motion.pitch,
      heave: motion.heave - 0.03,
      rudder: mix(before.rudder, after.rudder, alpha),
      boom: mix(before.boomAngle, after.boomAngle, alpha),
      jib: mix(before.jibAngle, after.jibAngle, alpha),
    };
    boatView.update(pose, sim.state, sim.out, seaTime, paused ? 0 : dtReal);
    boatView.root.updateMatrixWorld(true);

    // Draw the other boats, tell them where this one is, and keep to the furthest-on clock.
    const clockBehind = fleet.update(sim, world.seasonTime(sim.state.t), seaTime, stage.waves, dtReal, drone.camera, window.innerWidth, window.innerHeight);
    if (this.sharing) {
      this.paused = false;
      if (this.rateIndex !== 0) { this.rateIndex = 0; hud.setRate(0); }
      if (clockBehind > 1.5) world.shiftTime(clockBehind);
    }

    this.boatPos.set(x, pose.heave, z);
    drone.update(dtReal, this.boatPos, heading, (px, pz) => stage.seaLevel(px, pz, seaTime), boatView.solids, boatView.thin);

    const stream = world.current(sim.state.x, sim.state.y, sim.state.t);
    hud.update(sim.state, sim.out, {
      set: Math.atan2(stream.x, stream.y),
      drift: Math.hypot(stream.x, stream.y),
      height: world.tide(sim.state.t),
      rate: world.tideRate(sim.state.t),
      depth: sim.out.underKeel === null ? null : sim.out.underKeel + this.opts.spec.dimensions.draft,
    }, world.dateAt(sim.state.t), stage.course.timeZone, paused, rate, dtReal, fleet.boats.length);
    hud.setPilot(pilot.line());
    boatView.setPilot({ engaged: pilot.engaged, mode: pilot.mode, label: pilot.label() });
    chart.update(dtReal);
    this.coach?.update(dtReal);
    const o = sim.out;
    const loose = Math.max(o.main.luff * 0.7 + (o.main.flogging ? 0.3 : 0), sim.state.furl > 0.03 ? o.jib.luff * 0.7 + (o.jib.flogging ? 0.3 : 0) : 0);
    this.sound.update(o.aws / KT, sim.state.speed / KT, loose, paused);

    stage.frame(dtReal, rate, sim.state.t, seaTime, drone.camera, { x, z, heading, speed: sim.state.speed, heel: pose.heel }, this.everyoneElse(), o.tws / KT, chart.isOpen);
  }

  /** A short account of the boat and the conditions, for attaching to feedback. */
  report(): Record<string, unknown> {
    const s = this.sim.state;
    const o = this.sim.out;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      boat: this.opts.spec.id,
      clock: this.stage.world.dateAt(s.t).toISOString(),
      minutesSailed: Math.round(s.t / 60),
      x: Math.round(s.x), y: Math.round(s.y),
      headingDeg: Math.round(s.heading * R2D), speedKt: r1(o.sog / KT), heelDeg: Math.round(s.heel * R2D),
      windKt: r1(o.tws / KT), windFromDeg: Math.round(o.twd * R2D), windAngleDeg: Math.round(o.twa * R2D),
      helm: s.helmMode, crewTrim: s.crewTrim, reef: s.reef,
      aground: o.aground, knockdowns: s.knockdowns, boatsInCompany: this.fleet.boats.length,
      screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    };
  }

  /** Handles for play testing from the browser console. */
  debug(): Record<string, unknown> {
    return {
      scene: this.stage.scene, traffic: this.stage.traffic, renderer: this.stage.renderer, world: this.stage.world,
      sim: this.sim, passage: this.passage, chart: this.chart, pilot: this.pilot, fleet: this.fleet, drone: this.drone,
      boatView: this.boatView, coach: this.coach, views: VIEWS, setPaused: (p: boolean) => { this.paused = p; },
    };
  }
}
