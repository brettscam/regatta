import * as THREE from 'three';
import { Sim, SIM_DT, KT, R2D, D2R, initialState, wrapPi, wrapTau, type SimState } from '@slack-tide/sim';
import { advanceReckoning, compassPoint, rhumb, type Reckoning } from '@slack-tide/nav';
import type { ReplayWorld } from '@slack-tide/world';
import { CairdView } from '../boat/cairdView';
import type { BoatPose } from '../boat/boatView';
import type { YardBoat } from '../boat/yard';
import { DroneCamera, VIEWS, type ViewPreset } from '../camera/drone';
import { Controls } from '../input/controls';
import { Sound } from '../audio/sound';
import { TIME_RATES } from '../ui/hud';
import { sunAngles } from '../scene/sun';
import type { Stage } from '../stage';
import { BareChart, type TrackPoint } from './bareChart';
import { Icefield } from './ice';
import { PeriodHud } from './instruments';
import type { ExpeditionSea } from './sea';
import { significantHeight } from './swell';
import type { Voyage } from './voyage';
import { WAKE_CHECKS, type Facts, type Memory } from './wake';
import { FULL_AND_BY, HEAVE_TO_KT, HOVE_TO_DRIFT, MAKE_SAIL_KT, SAIL_PLANS, WATCH_RATE, WATCH_STEP, judgedSpeed, measurePerformance, sailPlanFor, watchStep, type Performance } from './watch';

const NM = 1852;
/** Seconds of game time between points kept on the tracks. */
const TRACK_EVERY = 1200;
/** Metres the boat may get from the scene's zero before the zero is moved under her. */
const REBASE = 6000;

// Camera views sized for a 22 ft boat. The sloops' views are put back when the voyage is left.
const CAIRD_VIEWS: Record<string, ViewPreset> = {
  helm: { target: [0, 1.35, 1.9], yaw: 0, pitch: 0.24, dist: 3.6 },
  mast: { target: [0, 2.1, -0.9], yaw: 0.5, pitch: 0.36, dist: 6.2 },
  foredeck: { target: [0, 1.7, -2.3], yaw: 0.35, pitch: 0.32, dist: 4.6 },
  drone: { target: [0, 1.7, 0], yaw: 0.62, pitch: 0.2, dist: 13 },
};

export interface ExpeditionOptions {
  voyage: Voyage;
  sea: ExpeditionSea;
  spec: YardBoat;
  /** The debug switch: draw the true track on the chart beside the reckoning. */
  showTruth: boolean;
  /** The voyage is over, one way or the other. */
  onEnd(result: VoyageResult): void;
}

export interface VoyageResult {
  outcome: 'arrived' | 'lost';
  /** Days at sea. */
  days: number;
  /** Nautical miles sailed over the ground. */
  miles: number;
  /** How far the reckoning was out at the end, nautical miles, and which way the truth lay from it. */
  errorMiles: number;
  errorToward: string;
  date: Date;
  seed: number;
}

type Snapshot = { x: number; z: number; heading: number; heel: number; rudder: number; boom: number; jib: number };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const deg3 = (rad: number) => String(Math.round(((rad * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');

function sailingWord(twa: number): string {
  const a = Math.abs(twa) * R2D;
  if (a < 50) return 'Head to wind';
  if (a < 75) return 'Close-hauled';
  if (a < 110) return 'Reaching';
  if (a < 155) return 'Broad reach';
  return 'Running';
}

/**
 * One voyage: the boat, the sea she is on, the two speeds of time, the reckoning and its chart.
 * It is the Expedition's counterpart of `Session`, and shares nothing with it but the stage, the sim, the camera
 * and the input layer: no fleet, no races, no pilot, none of the things aboard a modern yacht.
 *
 * STAGE 2 hangs the six men on this: their state would be stepped in `stepWatch` and in the real-time loop beside
 * the reckoning, and what needs the player goes in `wake.ts`. STAGE 3 replaces `reckoning` being all she has:
 * sights would correct it, and `truthTrack` is already kept for judging them.
 */
export class ExpeditionSession {
  readonly sim: Sim;
  readonly view: CairdView;
  readonly drone: DroneCamera;
  readonly world: ReplayWorld;
  readonly perf: Performance;
  private hud: PeriodHud | null = null;
  private chart: BareChart | null = null;
  private controls: Controls | null = null;
  private readonly sound = new Sound();
  private readonly ice: Icefield;
  private readonly keys = new AbortController();
  private readonly sloopViews: Record<string, ViewPreset> = {};

  private phase: 'briefing' | 'sailing' | 'ended' = 'briefing';
  /** True while a watch is being stood: time runs fast and the helmsman has her. */
  onWatch = false;
  private paused = false;
  private rateIndex = 0;
  /** The course ordered, radians. */
  course: number;
  /** True while the helmsman steers the course. False when the player has the tiller. */
  private helmsman = true;
  private headed = false;
  private wasManeuver = false;
  /** Which of `SAIL_PLANS` she is under. */
  private plan = 0;

  /** Where the navigator thinks she is. */
  reckoning: Reckoning;
  readonly reckonedTrack: TrackPoint[] = [];
  /** Where she has really been. Never shown without the debug switch. */
  readonly truthTrack: TrackPoint[] = [];
  private lastTrack = -1e9;
  /** True nautical miles over the ground. */
  private miles = 0;
  readonly memory: Memory = {};
  private factsClock = 0;
  result: VoyageResult | null = null;

  // The scene is drawn near its own zero, wherever on the ocean she is. `scene` is the boat in scene metres.
  private readonly scene = { x: 0, z: 0 };
  private acc = 0;
  private watchAcc = 0;
  private seaClock = 0;
  private briefYaw = 0.9;
  private before: Snapshot;
  private after: Snapshot;
  private readonly motion = { heave: 0, pitch: 0, roll: 0 };
  private readonly boatPos = new THREE.Vector3();
  private readonly deep = new THREE.Color();
  private readonly scatter = new THREE.Color();
  private readonly start: SimState;
  /** A little light to see her by at night. The nights are fifteen hours long, and a game cannot be black for them. */
  private readonly nightLight = new THREE.HemisphereLight(0x9fb2d6, 0x1b2630, 0);

  constructor(private readonly stage: Stage, private readonly opts: ExpeditionOptions) {
    const { voyage, sea, spec } = opts;
    this.world = stage.world;
    const at = sea.starts[0];
    this.course = voyage.from.headingDeg * D2R;
    this.sim = new Sim(spec, this.world, { x: at.x, y: at.y, headingDeg: voyage.from.headingDeg, speedKt: 2 });
    this.plan = sailPlanFor(this.world.wind(at.x, at.y, 0).speed / KT, 0);
    this.carry(this.plan);
    this.sim.setCrewTrim(true);
    this.sim.trimForWind();
    this.sim.setHelm('heading', this.course);
    this.start = this.sim.snapshot();
    this.reckoning = { x: at.x, y: at.y, run: 0 };
    this.perf = measurePerformance(spec);

    this.view = new CairdView(spec);
    stage.scene.add(this.view.root, this.nightLight);
    this.ice = new Icefield(sea, voyage, stage.scene);
    for (const key of Object.keys(CAIRD_VIEWS)) this.sloopViews[key] = VIEWS[key];
    Object.assign(VIEWS, CAIRD_VIEWS);
    this.drone = new DroneCamera(window.innerWidth / window.innerHeight);
    this.drone.snap(VIEWS.drone, this.sim.state.heading);

    // The sea, the sky and the water's colour for 60 south in May.
    stage.setOrigin(at.x, at.y);
    stage.ocean.setHull(spec.dimensions.beam / 3.8, spec.dimensions.loa / 11.6, spec.dimensions.mastHeight / 16.2, 1);
    stage.haze.near = 900;
    stage.haze.far = 26000;
    this.before = this.after = this.grab();
  }

  /** The briefing is done: hands on the boat, the clock running. */
  castOff(): void {
    if (this.phase !== 'briefing') return;
    this.phase = 'sailing';
    // She starts where the voyage starts, whatever she did behind the briefing.
    this.sim.restore(this.start);
    this.scene.x = 0;
    this.scene.z = 0;
    this.stage.setOrigin(this.sim.state.x, this.sim.state.y);
    this.before = this.after = this.grab();
    this.drone.snap(VIEWS.drone, this.sim.state.heading);
    this.track(true);

    const { voyage, sea } = this.opts;
    this.hud = new PeriodHud(TIME_RATES.length);
    this.hud.onPause = () => this.togglePause();
    this.hud.onRate = (i) => {
      if (this.onWatch) this.endWatch('All hands');
      this.rateIndex = i;
    };
    const to = sea.projection.toXY(voyage.to.lat, voyage.to.lon);
    const centre = (name: string) => {
      const m = sea.land.masses.find((mass) => mass.name === name)!;
      return { name, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2, small: m.x1 - m.x0 < 40000 };
    };
    this.chart = new BareChart({
      course: sea.course,
      projection: sea.projection,
      names: sea.land.masses.map((m) => centre(m.name)),
      dangers: sea.land.rocks,
      from: { name: voyage.from.name, x: this.start.x, y: this.start.y },
      to: { name: voyage.to.name, x: to.x, y: to.y },
      reckoned: () => [...this.reckonedTrack, { x: this.reckoning.x, y: this.reckoning.y, t: this.sim.state.t }],
      truth: () => [...this.truthTrack, { x: this.sim.state.x, y: this.sim.state.y, t: this.sim.state.t }],
      showTruth: this.opts.showTruth,
      notes: () => [
        ['Day', `${this.day()} · ${this.dateText()}`],
        ['Course ordered', `${deg3(this.course)}° ${compassPoint(this.course)}`],
        ['Run by account', `${Math.round(this.reckoning.run / NM)} miles`],
      ],
    });
    this.chart.noonOffset = (voyage.castOff - 12) * 3600;

    this.controls = new Controls(this.stage.canvas, this.drone, this.view, this.sim, this.hud, this.sound, {
      togglePause: () => this.togglePause(),
      announce: (text) => this.say(text),
      toggleChart: () => this.chart?.toggle(),
      closeChart: () => this.chart?.toggle(false),
      toggleInstruments: () => {
        this.hud?.toggleReadout();
        this.chart?.setMiniHidden(this.hud?.readoutHidden ?? false);
      },
      // P: the helmsman takes her, or gives her back.
      togglePilot: () => this.toggleHelmsman(),
      cyclePilotMode: () => {},
      sheetsInHand: () => {
        if (this.sim.state.crewTrim) {
          this.sim.setCrewTrim(false);
          this.say('You have the sheets. The crew leave them to you');
        }
      },
      pilotTag: () => '',
      controlUsed: () => {},
      toggleHints: () => this.say(KEYS, 12),
      // Enter: stand a watch, or call all hands.
      openHail: () => this.toggleWatch(),
      // R: shorten sail, and round again to full sail.
      toggleFleet: () => this.shorten(),
      featureKey: (code) => {
        if (code === 'KeyX') return this.toggleHoveTo(), true;
        if (code === 'Slash') return this.say(KEYS, 12), true;
        return false;
      },
    });
    window.addEventListener('keydown', (e) => this.onKey(e), { signal: this.keys.signal });
    this.say(`${voyage.from.name} astern. The helmsman has her, steering ${compassPoint(this.course)}. Enter stands a watch. / lists the keys`, 12);
  }

  dispose(): void {
    this.keys.abort();
    this.controls?.dispose();
    this.hud?.dispose();
    this.chart?.dispose();
    this.ice.dispose();
    this.stage.scene.remove(this.view.root, this.nightLight);
    Object.assign(VIEWS, this.sloopViews);
  }

  // ---- orders ---------------------------------------------------------------------------------

  private say(text: string, seconds = 5): void {
    this.hud?.raiseAlarm(text, seconds);
  }

  /** Something needs the skipper: say it, end the watch, and bring time back to real speed. */
  private alarm(text: string): void {
    if (this.onWatch) this.endWatch();
    this.rateIndex = 0;
    this.hud?.setRate(0);
    this.hud?.raiseAlarm(text, 9);
  }

  private togglePause(): void {
    if (this.onWatch) this.endWatch('All hands. Real time');
    else this.paused = !this.paused;
  }

  private get hoveTo(): boolean {
    return this.sim.state.hold !== 'none';
  }

  /** Put her under one of the sail plans. */
  private carry(plan: number): void {
    this.plan = plan;
    this.sim.state.reef = SAIL_PLANS[plan].reef;
    this.sim.state.furl = SAIL_PLANS[plan].furl;
  }

  private shorten(): void {
    if (this.hoveTo) return this.say('She is lying to the sea anchor with her sail down. X gets her under way');
    this.carry((this.plan + 1) % SAIL_PLANS.length);
    this.say(`${SAIL_PLANS[this.plan].name}${this.helmsman ? '. The crew will change it as the wind does while the helmsman has her' : ''}`);
  }

  /** Heave to: the sails come down and she lies head to wind to the sea anchor, which goes down wind with her. */
  setHoveTo(on: boolean): void {
    const s = this.sim.state;
    if (on === this.hoveTo) return;
    if (on) {
      const w = this.world.wind(s.x, s.y, s.t);
      const scope = 22;
      this.sim.holdAt('anchor', s.x + Math.sin(w.dir) * scope, s.y + Math.cos(w.dir) * scope, scope);
    } else {
      this.sim.release();
      this.carry(sailPlanFor(this.world.wind(s.x, s.y, s.t).speed / KT, SAIL_PLANS.length - 1));
      this.takeCourse();
    }
  }

  private toggleHoveTo(): void {
    this.setHoveTo(!this.hoveTo);
    this.say(this.hoveTo ? 'Hove to. Sail down, the sea anchor out ahead. X gets her under way' : `Sea anchor aboard. Under way, ${SAIL_PLANS[this.plan].name.toLowerCase()}`);
  }

  /** Give the helmsman the tiller on the course ordered, and the crew the sheets. */
  private takeCourse(): void {
    this.helmsman = true;
    if (this.hoveTo) return;
    this.sim.setCrewTrim(true);
    this.sim.setHelm('heading', this.steerable());
  }

  private toggleHelmsman(): void {
    if (this.onWatch) return this.say('The watch has her. Enter calls all hands');
    if (this.helmsman) {
      this.helmsman = false;
      if (!this.hoveTo) this.sim.setControl('rudder', this.sim.state.rudder);
      this.say('You have the tiller. P hands it back to the helmsman');
    } else {
      // He takes her as she heads now.
      if (!this.hoveTo) this.course = this.sim.state.heading;
      this.takeCourse();
      this.say(`The helmsman has her. Course ${deg3(this.course)}°, ${compassPoint(this.course)}. Left and right alter it`);
    }
  }

  /** The heading the helmsman can actually hold for the course ordered: the course itself, or full and by when it lies too close to the wind. */
  private steerable(): number {
    const s = this.sim.state;
    const wind = this.world.wind(s.x, s.y, s.t);
    const twa = wrapPi(wind.dir - this.course);
    this.headed = Math.abs(twa) < FULL_AND_BY * D2R;
    return this.headed ? wrapTau(wind.dir - (twa >= 0 ? 1 : -1) * FULL_AND_BY * D2R) : wrapTau(this.course);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.phase !== 'sailing' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
    const turn = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    if (turn === 0 || !this.helmsman) return;
    // With the helmsman steering, left and right are orders, not the tiller: five degrees, or one with Shift.
    this.course = wrapTau(Math.round((this.course * R2D + turn * (e.shiftKey ? 1 : 5))) * D2R);
    if (!this.hoveTo) this.sim.setHelm('heading', this.steerable());
    this.say(`Course ${deg3(this.course)}°, ${compassPoint(this.course)}${this.headed ? '. She will not lie it: full and by' : ''}`, 3);
  }

  // ---- watches --------------------------------------------------------------------------------

  toggleWatch(): void {
    if (this.phase !== 'sailing') return;
    if (this.onWatch) this.endWatch('All hands. Real time');
    else this.startWatch();
  }

  startWatch(): void {
    if (this.phase !== 'sailing' || this.onWatch) return;
    if (this.sim.out.aground) return this.say('She is aground. Get her off before the watch is set');
    this.paused = false;
    this.rateIndex = 0;
    this.hud?.setRate(0);
    if (!this.helmsman) this.course = this.sim.state.heading;
    this.takeCourse();
    this.onWatch = true;
    this.watchAcc = 0;
    this.stage.sky.bakeGapMs = 220;
    this.say(`Watch set. Course ${deg3(this.course)}°, ${compassPoint(this.course)}. Left and right alter it. Enter calls all hands`, 6);
  }

  private endWatch(text?: string): void {
    if (!this.onWatch) return;
    this.onWatch = false;
    this.stage.sky.bakeGapMs = 0;
    if (text) this.say(text, 4);
  }

  /**
   * One step of a watch: carry her forward by the reckoning of how she sails, and put the sim where that leaves her.
   * Returns false when something has called the skipper.
   */
  private stepWatch(seconds = WATCH_STEP): boolean {
    const s = this.sim.state;
    const res = watchStep(this.perf, this.world, { x: s.x, y: s.y, t: s.t, plan: this.plan, hoveTo: this.hoveTo }, this.course, seconds, this.opts.spec.dimensions.draft);
    this.logRun(s.x, s.y, res.x, res.y);
    // By account: the heading he held and the speed he judged, or a knot to leeward when hove to.
    if (res.hoveTo) this.reckoning = advanceReckoning(this.reckoning, res.twd + Math.PI, HOVE_TO_DRIFT, seconds);
    else this.reckoning = advanceReckoning(this.reckoning, res.heading, judgedSpeed(res.speed, s.t, this.opts.sea.seed), seconds);
    s.x = res.x;
    s.y = res.y;
    s.tick = Math.round(res.t / SIM_DT);
    s.t = s.tick * SIM_DT;
    if (res.hoveTo !== this.hoveTo) {
      this.setHoveTo(res.hoveTo);
      this.say(res.hoveTo ? 'Hove to: she can carry no sail' : 'It has eased. Under way again', 4);
    } else if (res.hoveTo) {
      // The sea anchor goes with her.
      s.holdX = s.x + Math.sin(res.twd) * s.holdScope;
      s.holdY = s.y + Math.cos(res.twd) * s.holdScope;
    }
    if (res.plan !== this.plan) this.carry(res.plan);
    this.headed = res.headed;
    if (!res.hoveTo) {
      s.helmMode = 'heading';
      s.helmTarget = res.heading;
    }
    this.track();
    return this.lookOut(res.aground) && this.phase === 'sailing';
  }

  /**
   * Stand watches from the console, with no drawing: `hours` of them, stopping early if something calls the skipper.
   * For play testing a whole passage. Returns the game hours that passed.
   */
  runWatches(hours: number): number {
    if (this.phase !== 'sailing') return 0;
    const t0 = this.sim.state.t;
    this.takeCourse();
    const steps = Math.round((hours * 3600) / WATCH_STEP);
    for (let i = 0; i < steps; i++) if (!this.stepWatch()) break;
    this.settleAfterJump();
    return (this.sim.state.t - t0) / 3600;
  }

  /** After the boat has been moved a long way at once, put the scene's zero under her and her sails to the wind. */
  private settleAfterJump(): void {
    const s = this.sim.state;
    this.scene.x = 0;
    this.scene.z = 0;
    this.stage.setOrigin(s.x, s.y);
    this.stage.settleSea(s.x, s.y, s.t);
    this.stage.overcast = this.opts.sea.sky(s.x, s.y, this.world.seasonTime(s.t)).cloud;
    if (!this.hoveTo) {
      s.heading = s.helmTarget;
      s.speed = 0.8 * this.sim.out.polarSpeed;
      this.sim.trimForWind();
    }
    this.before = this.after = this.grab();
  }

  // ---- the reckoning and the look-out ---------------------------------------------------------

  private logRun(x0: number, y0: number, x1: number, y1: number): void {
    this.miles += Math.hypot(x1 - x0, y1 - y0) / this.opts.sea.projection.scaleAt((y0 + y1) / 2) / NM;
  }

  private track(force = false): void {
    const s = this.sim.state;
    if (!force && s.t - this.lastTrack < TRACK_EVERY) return;
    this.lastTrack = s.t;
    this.reckonedTrack.push({ x: this.reckoning.x, y: this.reckoning.y, t: s.t });
    this.truthTrack.push({ x: s.x, y: s.y, t: s.t });
  }

  /** Ask everything that can call the skipper, and see whether the voyage is over. False if anything spoke. */
  private lookOut(aground: boolean): boolean {
    const s = this.sim.state;
    const { sea, voyage } = this.opts;
    const wind = this.world.wind(s.x, s.y, s.t);
    const near = sea.land.nearest(s.x, s.y, 56000);
    const here = sea.projection.toLatLon(s.x, s.y);
    const facts: Facts = {
      t: s.t,
      twsKt: wind.speed / KT,
      twd: wind.dir,
      land: near ? { metres: near.metres, name: near.mass.name, peak: near.mass.peak, bearing: near.bearing } : null,
      sun: sunAngles(this.world.dateAt(s.t), here.lat, here.lon).elevation,
      cloud: sea.sky(s.x, s.y, this.world.seasonTime(s.t)).cloud,
      aground,
      hoveTo: this.hoveTo,
    };
    let quiet = true;
    for (const check of WAKE_CHECKS) {
      const line = check.test(facts, this.memory);
      if (line && quiet) {
        this.alarm(line);
        quiet = false;
      }
    }
    // The end, one way or the other.
    const to = sea.projection.toXY(voyage.to.lat, voyage.to.lon);
    const b = sea.course.bounds;
    if (Math.hypot(s.x - to.x, s.y - to.y) < voyage.to.radius) this.end('arrived');
    else if (here.lon > voyage.lostEast || s.x < b.x0 + 4000 || s.x > b.x1 - 4000 || s.y < b.y0 + 4000 || s.y > b.y1 - 4000) this.end('lost');
    return quiet;
  }

  private end(outcome: 'arrived' | 'lost'): void {
    if (this.phase !== 'sailing') return;
    this.endWatch();
    this.phase = 'ended';
    const s = this.sim.state;
    const out = rhumb(this.opts.sea.projection, this.reckoning, { x: s.x, y: s.y });
    this.track(true);
    this.result = {
      outcome,
      days: s.t / 86400,
      miles: this.miles,
      errorMiles: out.metres / NM,
      errorToward: compassPoint(out.course),
      date: this.world.dateAt(s.t),
      seed: this.opts.sea.seed,
    };
    this.opts.onEnd(this.result);
  }

  private day(): number {
    return Math.floor((this.sim.state.t + this.opts.voyage.castOff * 3600) / 86400) + 1;
  }

  private dateText(): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone: this.opts.voyage.timeZone, day: 'numeric', month: 'long' }).format(this.world.dateAt(this.sim.state.t));
  }

  // ---- the frame ------------------------------------------------------------------------------

  private grab(): Snapshot {
    const s = this.sim.state;
    return { x: this.scene.x, z: this.scene.z, heading: s.heading, heel: s.heel, rudder: s.rudder, boom: s.boomAngle, jib: s.jibAngle };
  }

  /** Run the sim itself for a number of steps. The boat's place in the scene follows what she does through the water. */
  private stepSim(steps: number): void {
    const s = this.sim.state;
    for (let i = 0; i < steps; i++) {
      if (i === steps - 1) this.before = this.grab();
      const x0 = s.x;
      const y0 = s.y;
      if (s.hold !== 'none') {
        // The sea anchor drifts down wind and with the stream, and she lies to it.
        const o = this.sim.out;
        const cur = this.world.current(s.x, s.y, s.t);
        s.holdX += (-Math.sin(o.twd) * HOVE_TO_DRIFT + cur.x) * SIM_DT;
        s.holdY += (-Math.cos(o.twd) * HOVE_TO_DRIFT + cur.y) * SIM_DT;
      }
      this.sim.step();
      this.scene.x += s.x - x0;
      this.scene.z -= s.y - y0;
    }
    if (steps > 0) this.after = this.grab();
  }

  frame(dtReal: number): void {
    const { sim, stage, drone, view, motion, world } = this;
    const s = sim.state;
    const sailing = this.phase === 'sailing';
    const rate = this.onWatch ? WATCH_RATE : TIME_RATES[this.rateIndex];
    const paused = this.paused || this.phase === 'ended';

    this.controls?.update(dtReal, paused || this.helmsman || this.onWatch);

    if (!paused) {
      this.seaClock += dtReal;
      if (this.onWatch) {
        // Fast time: the reckoning carries her, and the sim only keeps her looking alive at the speed of the eye.
        this.watchAcc += dtReal * WATCH_RATE;
        while (this.watchAcc >= WATCH_STEP && this.onWatch) {
          this.watchAcc -= WATCH_STEP;
          if (!this.stepWatch()) break;
        }
        const at = { x: s.x, y: s.y, tick: s.tick };
        this.acc += dtReal;
        const steps = Math.min(8, Math.floor(this.acc / SIM_DT));
        this.acc -= steps * SIM_DT;
        this.stepSim(steps);
        s.x = at.x;
        s.y = at.y;
        s.tick = at.tick;
        s.t = at.tick * SIM_DT;
      } else {
        this.acc += dtReal * (this.phase === 'briefing' ? 1 : rate);
        let steps = Math.floor(this.acc / SIM_DT);
        this.acc -= steps * SIM_DT;
        steps = Math.min(steps, 600);
        const x0 = s.x;
        const y0 = s.y;
        this.stepSim(steps);
        if (sailing && steps > 0) this.sailed(steps * SIM_DT, x0, y0);
      }
    }
    if (!Number.isFinite(s.x + s.y + s.heading + s.heel + s.speed)) {
      const t = s.t;
      sim.restore({ ...initialState({ x: this.start.x, y: this.start.y, headingDeg: this.course * R2D, speedKt: 2 }), t, tick: Math.round(t / SIM_DT) });
      this.takeCourse();
    }

    // Keep the scene's zero near her. In a watch it slides under her all the time: the land goes by, the sea does not jump.
    if (this.onWatch) stage.setOrigin(s.x - this.scene.x, s.y + this.scene.z);
    if (Math.hypot(this.scene.x, this.scene.z) > REBASE) {
      const dx = this.scene.x;
      const dz = this.scene.z;
      stage.shiftSea(dx, dz);
      this.scene.x = 0;
      this.scene.z = 0;
      this.before = { ...this.before, x: this.before.x - dx, z: this.before.z - dz };
      this.after = { ...this.after, x: this.after.x - dx, z: this.after.z - dz };
      stage.setOrigin(s.x, s.y);
    }

    const alpha = paused ? 1 : this.acc / SIM_DT;
    const seaTime = this.seaClock;
    const { before, after } = this;
    const heading = mixAngle(before.heading, after.heading, alpha);
    const x = mix(before.x, after.x, alpha);
    const z = mix(before.z, after.z, alpha);

    // She rides the sea that is drawn: heave, pitch and roll from the same waves, all six of the long ones.
    const half = this.opts.spec.dimensions.loa * 0.4;
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const sea = (px: number, pz: number) => stage.seaLevel(px, pz, seaTime, 6);
    const hBow = sea(x + fx * half, z + fz * half);
    const hStern = sea(x - fx * half, z - fz * half);
    const hStbd = sea(x - fz * 0.8, z + fx * 0.8);
    const hPort = sea(x + fz * 0.8, z - fx * 0.8);
    const hMid = sea(x, z);
    const ease = paused ? 0 : Math.min(1, dtReal * 6);
    motion.heave += ((hBow + hStern + 2 * hMid) / 4 - motion.heave) * ease;
    motion.pitch += (Math.atan2(hBow - hStern, half * 2) * 0.85 - motion.pitch) * ease;
    motion.roll += (Math.atan2(hPort - hStbd, 1.6) * 0.6 - motion.roll) * ease;

    const pose: BoatPose = {
      x, z, heading,
      heel: mix(before.heel, after.heel, alpha) + motion.roll,
      pitch: motion.pitch,
      heave: motion.heave - 0.02,
      rudder: mix(before.rudder, after.rudder, alpha),
      boom: mix(before.boom, after.boom, alpha),
      jib: mix(before.jib, after.jib, alpha),
    };
    view.update(pose, s, sim.out, seaTime, paused ? 0 : dtReal);
    view.root.updateMatrixWorld(true);

    if (this.phase === 'briefing') {
      this.briefYaw += dtReal * 0.06;
      drone.snap({ ...CAIRD_VIEWS.drone, yaw: this.briefYaw, dist: 15, pitch: 0.16 }, heading);
    }
    // The camera halves a yacht's small heave to keep the picture steady. In this sea the boat rises and falls by
    // metres, and a camera that did not go with her would be left inside the hull or under the water.
    this.boatPos.set(x, pose.heave / 0.6, z);
    drone.update(dtReal, this.boatPos, heading, (px, pz) => stage.seaLevel(px, pz, seaTime, 6), view.solids, view.thin);
    if (this.phase === 'briefing') this.offsetForPanel();
    else drone.camera.clearViewOffset();

    // The sky and the light: cloud from the weather of the hour, the sun where it stands at her own position.
    const sky = this.opts.sea.sky(s.x, s.y, world.seasonTime(s.t));
    const wind = world.wind(s.x, s.y, s.t);
    const twsKt = wind.speed / KT;
    stage.overcast += (sky.cloud - stage.overcast) * Math.min(1, dtReal * (this.onWatch ? 2 : 0.4));
    stage.sunPlace = this.opts.sea.projection.toLatLon(s.x, s.y);
    this.nightLight.intensity = 1.5 * (1 - THREE.MathUtils.smoothstep(stage.sky.elevation, -0.12, 0.06));
    // Grey-green water, darker under cloud. A gale fills the air with spray and brings the horizon in.
    const dull = 1 - 0.55 * stage.overcast;
    stage.ocean.setWater(this.deep.setRGB(0.012, 0.034, 0.046), this.scatter.setRGB(0.02 * dull, 0.085 * dull, 0.085 * dull));
    const thick = THREE.MathUtils.clamp((twsKt - 30) / 30, 0, 1);
    stage.haze.far = 26000 - 9000 * stage.overcast - 9000 * thick;
    stage.haze.near = 900 - 500 * thick;
    this.ice.update(s.x, s.y, s.t, stage.origin, seaTime, (px, pz) => stage.seaLevel(px, pz, seaTime, 4));

    if (sailing) this.aboard(dtReal, twsKt, wind.dir);
    this.chart?.update(dtReal);
    const o = sim.out;
    const loose = Math.max(o.main.luff * 0.7 + (o.main.flogging ? 0.3 : 0), s.furl > 0.03 ? o.jib.luff * 0.7 + (o.jib.flogging ? 0.3 : 0) : 0);
    this.sound.update(o.aws / KT, s.speed / KT, this.hoveTo ? 0 : loose, paused || this.phase === 'briefing');

    // The water shader keeps a bay as it was below 34 knots. On the open ocean the foam starts to blow in streaks
    // from about 26, so the wind it is told of is raised a little through a gale.
    const foamKt = o.tws / KT + THREE.MathUtils.clamp((twsKt - 24) * 0.9, 0, 12);
    stage.frame(dtReal, this.phase === 'briefing' ? 1 : rate, s.t, seaTime, drone.camera, { x, z, heading, speed: s.speed, heel: pose.heel }, [], foamKt, this.chart?.isOpen ?? false);
  }

  /** Behind the briefing, keep the boat clear of the panel, as the join screen does. */
  private offsetForPanel(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w > 760) this.drone.camera.setViewOffset(w, h, -Math.min(230, w * 0.2), 0, w, h);
    else this.drone.camera.setViewOffset(w, h, 0, h * 0.22, w, h);
  }

  /** Real time has passed with the sim sailing her: carry the reckoning and the log forward by what she did. */
  private sailed(seconds: number, x0: number, y0: number): void {
    const s = this.sim.state;
    this.logRun(x0, y0, s.x, s.y);
    if (this.hoveTo) this.reckoning = advanceReckoning(this.reckoning, this.sim.out.twd + Math.PI, HOVE_TO_DRIFT, seconds);
    else this.reckoning = advanceReckoning(this.reckoning, s.heading, judgedSpeed(s.speed, s.t, this.opts.sea.seed), seconds);
    this.track();
  }

  /** Once a frame while she is sailing: the crew's part, the look-out, and what the instruments say. */
  private aboard(dtReal: number, twsKt: number, twd: number): void {
    const { sim } = this;
    const s = sim.state;
    // A tack or a wear he was told to make has brought her to a new course.
    const turning = s.maneuver !== null;
    if (this.wasManeuver && !turning && this.helmsman && s.helmMode === 'heading') this.course = s.helmTarget;
    this.wasManeuver = turning;
    // A hand on the tiller takes it from the helmsman.
    if (this.helmsman && !this.hoveTo && !turning && s.helmMode === 'hand') {
      this.helmsman = false;
      this.say('You have the tiller. P hands it back to the helmsman');
    }
    if (!this.onWatch && !this.paused) {
      if (this.helmsman) {
        // The crew shorten and make sail as the wind asks, and heave to when she can carry nothing.
        if (!this.hoveTo && twsKt >= HEAVE_TO_KT) {
          this.setHoveTo(true);
          this.say('Hove to: she can carry no sail. Sea anchor out ahead');
        } else if (this.hoveTo && twsKt < MAKE_SAIL_KT && this.memory.storm === true) {
          this.setHoveTo(false);
          this.say('It has eased. Sea anchor aboard, under way again');
        }
        if (!this.hoveTo) {
          const want = sailPlanFor(twsKt, this.plan);
          if (want !== this.plan) {
            this.carry(want);
            this.say(SAIL_PLANS[want].name);
          }
          if (!turning) {
            const steer = this.steerable();
            if (Math.abs(wrapPi(steer - s.helmTarget)) > 0.5 * D2R || s.helmMode !== 'heading') sim.setHelm('heading', steer);
          }
        }
      }
      this.factsClock -= dtReal * TIME_RATES[this.rateIndex];
      if (this.factsClock <= 0) {
        this.factsClock = 2;
        this.lookOut(sim.out.aground);
      }
    }

    const helm = this.hoveTo
      ? 'Lying to the sea anchor'
      : this.helmsman
        ? `Helmsman: course <b class="on">${deg3(this.course)}° ${compassPoint(this.course)}</b>${this.headed ? ` · she will not lie it, full and by ${deg3(s.heading)}°` : ''}`
        : 'You have the tiller';
    this.hud?.update({
      heading: s.heading,
      judgedKt: this.hoveTo ? 0 : judgedSpeed(s.speed, s.t, this.opts.sea.seed) / KT,
      awa: sim.out.awa,
      twd,
      twsKt,
      sailing: this.hoveTo ? 'Hove to' : sailingWord(sim.out.twa),
      canvas: this.hoveTo ? 'sail down' : `${SAIL_PLANS[this.plan].name.toLowerCase()} · sea ${Math.round(significantHeight(twsKt) * 3.28 / 5) * 5} ft`,
      helm,
      date: this.world.dateAt(s.t),
      timeZone: this.opts.voyage.timeZone,
      day: this.day(),
      pace: this.paused ? 'Paused' : this.onWatch ? 'On watch' : this.rateIndex === 0 ? 'Real time' : `${TIME_RATES[this.rateIndex]}× time`,
      fast: this.onWatch || this.rateIndex > 0,
      paused: this.paused,
    }, dtReal);
  }

  /** Handles for play testing from the console. */
  debug(): Record<string, unknown> {
    return {
      mode: 'expedition', expedition: this, sim: this.sim, world: this.world, scene: this.stage.scene, renderer: this.stage.renderer, stage: this.stage,
      drone: this.drone, boatView: this.view, chart: this.chart, sea: this.opts.sea, voyage: this.opts.voyage, perf: this.perf, views: VIEWS,
      setPaused: (p: boolean) => { this.paused = p; },
      /** The time the sea is drawn at, and the height of the sea under the boat at another: for finding a crest or a trough to look at. */
      seaTime: (t?: number) => { if (t !== undefined) this.seaClock = t; return this.seaClock; },
      seaUnderBoat: (t: number) => this.stage.seaLevel(this.scene.x, this.scene.z, t, 6),
      setCourse: (deg: number) => { this.course = wrapTau(deg * D2R); if (!this.hoveTo) this.sim.setHelm('heading', this.steerable()); },
      watch: (hours: number) => this.runWatches(hours),
      /** Put her somewhere else on the sea, at a time, for looking at a place or a day's weather. Lat and lon in degrees. */
      place: (lat: number, lon: number, hoursOut?: number) => {
        const p = this.opts.sea.projection.toXY(lat, lon);
        const st = this.sim.state;
        st.x = p.x;
        st.y = p.y;
        if (hoursOut !== undefined) { st.tick = Math.round((hoursOut * 3600) / SIM_DT); st.t = st.tick * SIM_DT; }
        this.settleAfterJump();
      },
      state: () => {
        const st = this.sim.state;
        const at = this.opts.sea.projection.toLatLon(st.x, st.y);
        const dr = this.opts.sea.projection.toLatLon(this.reckoning.x, this.reckoning.y);
        const w = this.world.wind(st.x, st.y, st.t);
        return {
          phase: this.phase, onWatch: this.onWatch, days: st.t / 86400, date: this.world.dateAt(st.t).toISOString(), lat: at.lat, lon: at.lon, drLat: dr.lat, drLon: dr.lon,
          windKt: w.speed / KT, windFrom: w.dir * R2D, speedKt: st.speed / KT, headingDeg: st.heading * R2D, courseDeg: this.course * R2D, plan: SAIL_PLANS[this.plan].name, hoveTo: this.hoveTo,
          miles: this.miles, seaFt: significantHeight(w.speed / KT) * 3.28, result: this.result,
        };
      },
    };
  }
}

const KEYS = 'Enter: stand a watch or call all hands. Left and right: the course, or the tiller when it is yours. P: helmsman or you. W S Q E: sheets. T: tack. R: shorten sail. X: heave to. M: chart. Space: stop the clock';
