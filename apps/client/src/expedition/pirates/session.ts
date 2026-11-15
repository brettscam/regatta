import * as THREE from 'three';
import { Sim, SIM_DT, KT, R2D, D2R, initialState, wrapPi, wrapTau, type SimState } from '@slack-tide/sim';
import { compassPoint, compassWords } from '@slack-tide/nav';
import type { BoatPose } from '../../boat/boatView';
import type { YardBoat } from '../../boat/yard';
import { DroneCamera, VIEWS, type ViewPreset } from '../../camera/drone';
import { Controls } from '../../input/controls';
import { Sound } from '../../audio/sound';
import { TIME_RATES } from '../../ui/hud';
import { sunAngles } from '../../scene/sun';
import type { Stage } from '../../stage';
import { PeriodHud } from '../instruments';
import { significantHeight } from '../swell';
import { sightingRange } from '../wake';
import { WATCH_RATE, WATCH_STEP, HOVE_TO_DRIFT, measurePerformance, sailPlanFor, watchStep, type Performance } from '../watch';
import { boardingOdds } from './boarding';
import { CARIBBEAN, PORT_REACH, SEA_GAIN, squallAt, type Caribbean } from './caribbean';
import { afterLoss, saveCareer, type Career } from './career';
import { PirateChart } from './chart';
import { BattleEffects } from './effects';
import { PirateGame, heart, type Env, type GameEvent, type LiveShip, type Me } from './game';
import { driveLeft, gunsServed, heelEffect, type Side } from './gunnery';
import { holdTons } from './loot';
import { Palms, ShoalMap, Towns } from './scenery';
import { SLOOP_RIG } from './rig';
import { PeriodShip, lookOf } from './shipModel';
import { describe as describeSail, visibility } from './sighting';
import { SloopView } from './sloopView';
import { GOODS, shipClass } from './tables';
import { BoardingRead, Cabinet, PortSheet, ShipPanel, type CruiseEnd } from './ui';

const NM = 1852;
/** Metres the sloop may get from the scene's zero before the zero is moved under her. */
const REBASE = 6000;
/** Game seconds between points kept on her track. */
const TRACK_EVERY = 900;
/** How fast the clock runs by itself while the helmsman is cutting off a chase (indexes into the time rates: 64 and 16 times), and the range in metres at which it comes back to real time. */
const CHASE_FAR = 6;
const CHASE_NEAR = 4;
const CHASE_REAL = 400;
const EARTH = 6371000;

// Camera views sized for a 60 ft sloop. The yachts' views are put back when the cruise is left.
const SLOOP_VIEWS: Record<string, ViewPreset> = {
  helm: { target: [0, 4.2, 6.5], yaw: 0, pitch: 0.2, dist: 9 },
  mast: { target: [0, 6, -1], yaw: 0.5, pitch: 0.3, dist: 24 },
  foredeck: { target: [0, 4.5, -7], yaw: 0.35, pitch: 0.3, dist: 14 },
  drone: { target: [0, 7, 0], yaw: 0.62, pitch: 0.2, dist: 52 },
};

export const KEYS = 'Z, C: fire the larboard, starboard broadside. B: board. G: glass to the next sail. F: chase her. Enter: stand a watch. Left, right: the course, or the tiller when it is yours. P: helmsman or you. W S Q E: sheets. T: tack. R: reef. X: heave to. L: go ashore. K: the cabinet. M: chart. Space: stop the clock';

export interface PirateOptions {
  sea: Caribbean;
  seed: number;
  spec: YardBoat;
  career: Career;
  onEnd(end: CruiseEnd): void;
}

type Snapshot = { x: number; z: number; heading: number; heel: number; rudder: number; boom: number; jib: number };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const deg3 = (rad: number) => String(Math.round(((rad * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');

function sailingWord(twa: number): string {
  const a = Math.abs(twa) * R2D;
  if (a < 42) return 'Head to wind';
  if (a < 68) return 'Close-hauled';
  if (a < 110) return 'Reaching';
  if (a < 155) return 'Broad reach';
  return 'Running';
}

interface Drawn { ship: PeriodShip; clock: number }

/**
 * One cruise: the sloop sailed by the sim, the Caribbean she is on, the two speeds of time, and the game
 * (`game.ts`) drawn. The counterpart of `ExpeditionSession` for the pirate game, and built the same way:
 * real time is the sim, a watch is the reckoning of how she sails, and the scene is drawn near its own zero.
 */
export class PirateSession {
  readonly sim: Sim;
  readonly view: SloopView;
  readonly drone: DroneCamera;
  readonly game: PirateGame;
  readonly perf: Performance;
  private hud: PeriodHud | null = null;
  private panel: ShipPanel | null = null;
  private chart: PirateChart | null = null;
  private controls: Controls | null = null;
  private readonly sound = new Sound();
  private readonly effects: BattleEffects;
  private readonly towns: Towns;
  private readonly palms: Palms;
  private readonly shoals: ShoalMap;
  private readonly drawn = new Map<string, Drawn>();
  private readonly keys = new AbortController();
  private readonly yachtViews: Record<string, ViewPreset> = {};
  private readonly polar: number[][];

  private phase: 'briefing' | 'sailing' | 'ended' = 'briefing';
  onWatch = false;
  private paused = false;
  private rateIndex = 0;
  course: number;
  private helmsman = true;
  private headed = false;
  private wasManeuver = false;
  private plan = 0;
  /** True while the helmsman is steering to cut off the ship in the glass. */
  private chasing = false;
  private sheet: PortSheet | null = null;
  private cabinet: Cabinet | null = null;
  private reading: BoardingRead | null = null;
  private readonly queue: GameEvent[] = [];
  /** The port she last had the sheet open in, so that it does not open again until she has left. */
  private visited: string | null = null;
  private readonly track: Array<{ x: number; y: number }> = [];
  private lastTrack = -1e9;
  private readonly memory: Record<string, number | boolean | string> = {};
  private lastDeep: { x: number; y: number };
  private clock2 = 0;

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
  private readonly turquoise = new THREE.Color(0.04, 0.5, 0.5);
  private readonly start: SimState;
  private readonly nightLight = new THREE.HemisphereLight(0x9fb2d6, 0x1b2630, 0);

  constructor(private readonly stage: Stage, private readonly opts: PirateOptions) {
    const { sea, spec, career } = opts;
    const world = sea.world;
    // She begins three miles off the port she last lay in, standing out to sea.
    const port = sea.ports.find((p) => p.id === career.port) ?? sea.ports[0];
    const at = { x: port.x + Math.sin(port.seaward) * 4500, y: port.y + Math.cos(port.seaward) * 4500 };
    const wind = world.wind(at.x, at.y, 0);
    // Out to sea, but never straight into the wind's eye.
    let heading = port.seaward;
    if (Math.abs(wrapPi(wind.dir - heading)) < 60 * D2R) heading = wrapTau(wind.dir + Math.sign(wrapPi(heading - wind.dir) || 1) * 80 * D2R);
    this.course = heading;
    // The sim sails a copy of her file, so that shot in her rigging can slow this sloop without touching the file.
    const own = structuredClone(spec) as YardBoat;
    this.polar = spec.polar.speeds.map((row) => [...row]);
    this.sim = new Sim(own, world, { x: at.x, y: at.y, headingDeg: heading * R2D, speedKt: 5 });
    this.plan = sailPlanFor(wind.speed / KT, 0, SLOOP_RIG);
    this.carry(this.plan);
    this.sim.setCrewTrim(true);
    this.sim.trimForWind();
    this.sim.setHelm('heading', this.course);
    this.start = this.sim.snapshot();
    this.lastDeep = { x: at.x, y: at.y };
    // The port she has just left is no news.
    this.memory.port = port.id;
    this.memory.seen = sea.sea.land.nearest(at.x, at.y, 56000)?.mass.name ?? '';
    this.perf = measurePerformance(spec, SLOOP_RIG);
    this.game = new PirateGame(sea, opts.seed, career, at);
    this.applyRigging();

    const cls = shipClass(career.ship!.cls);
    this.view = new SloopView(own, { ...lookOf(cls, 'pirate'), guns: 10, boom: spec.dimensions.boomLength });
    stage.scene.add(this.view.root, this.nightLight);
    this.effects = new BattleEffects(stage.scene);
    this.towns = new Towns(sea.ports, stage.scene, (x, y) => this.ground(x, y));
    this.palms = new Palms(sea.sea.land, (x, y) => this.ground(x, y), stage.scene);
    this.shoals = new ShoalMap((x, y) => world.chartDepth(x, y));
    for (const key of Object.keys(SLOOP_VIEWS)) this.yachtViews[key] = VIEWS[key];
    Object.assign(VIEWS, SLOOP_VIEWS);
    this.drone = new DroneCamera(window.innerWidth / window.innerHeight);
    this.drone.snap(VIEWS.drone, this.sim.state.heading);

    stage.setOrigin(at.x, at.y);
    stage.ocean.setHull(spec.dimensions.beam / 3.8, spec.dimensions.loa / 11.6, spec.dimensions.mastHeight / 16.2, 0.8);
    stage.haze.near = 1500;
    stage.haze.far = 42000;
    this.before = this.after = this.grab();
  }

  /** Height of the drawn ground at a point, metres. 0 at sea. */
  private ground(x: number, y: number): number {
    for (const p of this.opts.sea.sea.patches) {
      const g = p.grid;
      const fx = (x - g.x0) / g.dx;
      const fy = (y - g.y0) / g.dx;
      if (fx < 0 || fy < 0 || fx >= g.nx - 1 || fy >= g.ny - 1) continue;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const h = (k: number) => (p.heights[k] / 255) ** 2 * g.max;
      const u = fx - i;
      const v = fy - j;
      const a = h(j * g.nx + i);
      const b = h(j * g.nx + i + 1);
      const c = h((j + 1) * g.nx + i);
      const d = h((j + 1) * g.nx + i + 1);
      // Palms and towns want ground that is ground at every corner.
      if (Math.min(a, b, c, d) <= 0.4) return 0;
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
    return 0;
  }

  castOff(): void {
    if (this.phase !== 'briefing') return;
    this.phase = 'sailing';
    this.sim.restore(this.start);
    this.scene.x = 0;
    this.scene.z = 0;
    this.stage.setOrigin(this.sim.state.x, this.sim.state.y);
    this.before = this.after = this.grab();
    this.drone.snap(VIEWS.drone, this.sim.state.heading);

    const { sea } = this.opts;
    this.hud = new PeriodHud(TIME_RATES.length);
    this.hud.onPause = () => this.togglePause();
    this.hud.onRate = (i) => {
      if (this.onWatch) this.endWatch('All hands');
      this.chasing = false;
      this.rateIndex = i;
    };
    this.panel = new ShipPanel();
    const centre = (m: (typeof sea.sea.land.masses)[number]) => ({ name: m.name, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2, small: m.x1 - m.x0 < 90000 });
    this.chart = new PirateChart({
      course: sea.sea.course,
      projection: sea.sea.projection,
      names: sea.sea.land.masses.map(centre),
      ports: sea.ports,
      reefs: sea.reefs,
      ship: () => ({ x: this.sim.state.x, y: this.sim.state.y, heading: this.sim.state.heading }),
      track: () => [...this.track, { x: this.sim.state.x, y: this.sim.state.y }],
      sails: () => [...this.game.ships.values()].filter((s) => s.seen && s.mood !== 'sinking').map((s) => ({
        x: s.x, y: s.y, heading: s.heading, nation: s.seen === 'tops' || s.seen === 'hull' ? null : s.nation,
        label: s.seen === 'tops' ? 'a sail' : s.cls.name, chosen: s === this.game.target,
      })),
      rumour: () => (this.game.rumour ? { path: this.game.rumour.lane.path, text: this.game.rumour.text } : null),
      shut: (p) => this.game.isShut(p),
      notes: () => [
        ['Course ordered', `${deg3(this.course)}° ${compassPoint(this.course)}`],
        ['Riches aboard', `${Math.round(this.game.own.coin)} coin, ${holdTons(this.game.own.hold)} t`],
        ['Her name', `${Math.round(this.opts.career.notoriety)} of 100`],
      ],
    });

    this.controls = new Controls(this.stage.canvas, this.drone, this.view, this.sim, this.hud, this.sound, {
      togglePause: () => this.togglePause(),
      announce: (text) => this.say(text),
      toggleChart: () => this.chart?.toggle(),
      closeChart: () => this.chart?.toggle(false),
      toggleInstruments: () => {
        this.hud?.toggleReadout();
        const hidden = this.hud?.readoutHidden ?? false;
        this.chart?.setMiniHidden(hidden);
        this.panel?.setHidden(hidden);
      },
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
      // C: the starboard broadside. (On a yacht this key turns the coaching hints on and off.)
      toggleHints: () => this.fire('starboard'),
      openHail: () => this.toggleWatch(),
      toggleFleet: () => this.shorten(),
      featureKey: (code) => {
        if (code === 'KeyZ') return this.fire('port'), true;
        if (code === 'KeyB') return this.board(), true;
        if (code === 'KeyG') return this.game.nextTarget(), this.pump(), true;
        if (code === 'KeyF') return this.toggleChase(), true;
        if (code === 'KeyX') return this.toggleHoveTo(), true;
        if (code === 'KeyL') return this.goAshore(true), true;
        if (code === 'KeyK') return this.openCabinet(), true;
        if (code === 'Slash') return this.say(KEYS, 14), true;
        return false;
      },
    });
    window.addEventListener('keydown', (e) => this.onKey(e), { signal: this.keys.signal });
    const port = sea.ports.find((p) => p.id === this.opts.career.port) ?? sea.ports[0];
    this.visited = null;
    this.say(`${port.name} astern. The helmsman has her, steering ${compassPoint(this.course)}. Z and C fire the broadsides. Enter stands a watch. / lists the keys`, 12);
  }

  dispose(): void {
    this.keys.abort();
    this.controls?.dispose();
    this.hud?.dispose();
    this.panel?.dispose();
    this.chart?.dispose();
    this.sheet?.close();
    this.cabinet?.close();
    this.reading?.dispose();
    this.effects.dispose();
    this.towns.dispose(this.stage.scene);
    this.palms.dispose();
    this.shoals.dispose();
    for (const d of this.drawn.values()) {
      this.stage.scene.remove(d.ship.root);
      d.ship.dispose();
    }
    this.drawn.clear();
    this.stage.scene.remove(this.view.root, this.nightLight);
    this.stage.ocean.setShoals(null, 0, 0, 1);
    Object.assign(VIEWS, this.yachtViews);
  }

  // ---- what the game is told ----------------------------------------------------------------------------------

  private me(): Me {
    const s = this.sim.state;
    return { x: s.x, y: s.y, heading: s.heading, heel: s.heel, speed: s.speed, t: s.t };
  }

  private env(): Env {
    const s = this.sim.state;
    const world = this.opts.sea.world;
    const here = this.opts.sea.sea.projection.toLatLon(s.x, s.y);
    const wind = world.wind(s.x, s.y, s.t);
    return {
      wind: (x, y) => world.wind(x, y, s.t),
      depth: (x, y) => world.chartDepth(x, y),
      sea: significantHeight(wind.speed / KT, SEA_GAIN),
      sun: sunAngles(world.dateAt(s.t), here.lat, here.lon).elevation,
      cloud: this.opts.sea.sea.sky(s.x, s.y, world.seasonTime(s.t)).cloud,
    };
  }

  private see(env: Env) {
    return { masthead: 19, deck: 4, air: visibility(env.sun, env.cloud) };
  }

  /** Shot in her rigging slows her: the sim's own copy of her polar is scaled by what is left standing. */
  private applyRigging(): void {
    const k = driveLeft(this.game.own.rigging);
    const speeds = this.sim.boat.polar.speeds;
    for (let i = 0; i < speeds.length; i++) for (let j = 0; j < speeds[i].length; j++) speeds[i][j] = this.polar[i][j] * k;
  }

  // ---- orders ---------------------------------------------------------------------------------------------------

  private say(text: string, seconds = 5): void {
    this.hud?.raiseAlarm(text, seconds);
  }

  /** Something needs the skipper: say it, end the watch, and bring time back to real speed. */
  private alarm(text: string, seconds = 9): void {
    if (this.onWatch) this.endWatch();
    this.rateIndex = 0;
    this.hud?.setRate(0);
    this.hud?.raiseAlarm(text, seconds);
  }

  private get busy(): boolean {
    return this.sheet?.isOpen === true || this.cabinet?.isOpen === true || this.reading !== null;
  }

  private togglePause(): void {
    if (this.onWatch) this.endWatch('All hands. Real time');
    else this.paused = !this.paused;
  }

  private get hoveTo(): boolean {
    return this.sim.state.hold !== 'none';
  }

  private carry(plan: number): void {
    this.plan = plan;
    this.sim.state.reef = SLOOP_RIG.plans[plan].reef;
    this.sim.state.furl = SLOOP_RIG.plans[plan].furl;
  }

  private shorten(): void {
    if (this.hoveTo) return this.say('She is hove to. X gets her under way');
    this.carry((this.plan + 1) % SLOOP_RIG.plans.length);
    this.say(`${SLOOP_RIG.plans[this.plan].name}. Less sail, less heel: the lee guns can be fought`);
  }


  setHoveTo(on: boolean): void {
    const s = this.sim.state;
    if (on === this.hoveTo) return;
    if (on) {
      const w = this.opts.sea.world.wind(s.x, s.y, s.t);
      const scope = 40;
      this.sim.holdAt('anchor', s.x + Math.sin(w.dir) * scope, s.y + Math.cos(w.dir) * scope, scope);
      this.chasing = false;
    } else {
      this.sim.release();
      this.carry(sailPlanFor(this.opts.sea.world.wind(s.x, s.y, s.t).speed / KT, 0, SLOOP_RIG));
      this.takeCourse();
    }
  }

  private toggleHoveTo(): void {
    this.setHoveTo(!this.hoveTo);
    this.say(this.hoveTo ? 'Hove to, her head to the wind. X gets her under way' : `Under way, ${SLOOP_RIG.plans[this.plan].name.toLowerCase()}`);
    if (this.hoveTo) this.goAshore(false);
  }

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
      this.chasing = false;
      if (!this.hoveTo) this.sim.setControl('rudder', this.sim.state.rudder);
      this.say('You have the tiller. P hands it back to the helmsman');
    } else {
      if (!this.hoveTo) this.course = this.sim.state.heading;
      this.takeCourse();
      this.say(`The helmsman has her. Course ${deg3(this.course)}°, ${compassPoint(this.course)}. Left and right alter it`);
    }
  }

  private steerable(): number {
    const s = this.sim.state;
    const wind = this.opts.sea.world.wind(s.x, s.y, s.t);
    const twa = wrapPi(wind.dir - this.course);
    this.headed = Math.abs(twa) < SLOOP_RIG.fullAndBy * D2R;
    return this.headed ? wrapTau(wind.dir - (twa >= 0 ? 1 : -1) * SLOOP_RIG.fullAndBy * D2R) : wrapTau(this.course);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.phase !== 'sailing' || e.metaKey || e.ctrlKey || e.altKey || this.busy) return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test((e.target as HTMLElement).tagName)) return;
    const turn = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    if (turn === 0 || !this.helmsman) return;
    this.chasing = false;
    // With the helmsman steering, left and right are orders: five degrees, or one with Shift.
    this.course = wrapTau(Math.round((this.course * R2D + turn * (e.shiftKey ? 1 : 5))) * D2R);
    if (!this.hoveTo) this.sim.setHelm('heading', this.steerable());
    this.say(`Course ${deg3(this.course)}°, ${compassPoint(this.course)}${this.headed ? '. She will not lie it: full and by' : ''}`, 3);
  }

  /** F: the helmsman is told to cut off the ship in the glass, and the clock runs on until she is within long gunshot. */
  private toggleChase(): void {
    if (this.chasing) {
      this.chasing = false;
      this.rateIndex = 0;
      this.hud?.setRate(0);
      return this.say('The chase is given up. The helmsman holds her as she goes');
    }
    const her = this.game.target;
    if (!her) return this.say('No sail in sight to chase');
    if (this.hoveTo) this.setHoveTo(false);
    this.chasing = true;
    this.takeCourse();
    this.say(`In chase of the ${her.seen === 'tops' ? 'sail' : her.cls.name}. The helmsman will cut her off. F gives it up`, 6);
  }

  /** The course that cuts her off: where she will be when the sloop gets there. */
  private interceptCourse(her: LiveShip): number {
    const s = this.sim.state;
    const own = Math.max(3, s.speed);
    let lead = her.range / own;
    for (let k = 0; k < 3; k++) {
      const px = her.x + Math.sin(her.heading) * her.speed * lead;
      const py = her.y + Math.cos(her.heading) * her.speed * lead;
      lead = Math.min(3600, Math.hypot(px - s.x, py - s.y) / own);
    }
    // Close in, come onto her quarter rather than into her stern.
    const off = her.range < 1500 ? 70 : 0;
    const sideOf = Math.sign(wrapPi(Math.atan2(s.x - her.x, s.y - her.y) - her.heading)) || 1;
    const px = her.x + Math.sin(her.heading) * her.speed * lead + Math.cos(her.heading) * off * sideOf;
    const py = her.y + Math.cos(her.heading) * her.speed * lead - Math.sin(her.heading) * off * sideOf;
    return wrapTau(Math.atan2(px - s.x, py - s.y));
  }

  private fire(side: Side): void {
    if (this.phase !== 'sailing' || this.busy) return;
    if (this.onWatch) this.endWatch();
    this.game.fire(side, this.me(), this.env());
    this.pump();
  }

  private board(): void {
    if (this.phase !== 'sailing' || this.busy) return;
    if (this.onWatch) this.endWatch();
    this.game.board(this.me());
    this.pump();
  }

  private openCabinet(): void {
    if (this.cabinet?.isOpen) return;
    this.cabinet = new Cabinet(this.opts.career, () => { this.cabinet = null; });
  }

  /** Open the port sheet if she is lying in an open port. */
  private goAshore(asked: boolean): void {
    if (this.phase !== 'sailing' || this.busy) return;
    const me = this.me();
    const port = this.game.portAt(me);
    if (!port) {
      if (asked) {
        const near = this.game.nearestPort(me);
        this.say(near.metres < PORT_REACH * 1.2 ? 'She is going too fast to bring up. Heave to with X' : `No anchorage here. ${near.port.name} bears ${compassWords(near.bearing)}, ${Math.round(near.metres / NM)} miles`, 6);
      }
      return;
    }
    if (this.game.isShut(port)) return this.say(`${port.name} is shut to this ship. Stand off before the fort finds the range`, 7);
    if (this.onWatch) this.endWatch();
    this.setHoveTo(true);
    this.game.enter(port);
    this.visited = port.id;
    this.sheet = new PortSheet(this.game, port, () => this.sim.state.t, {
      onLeave: () => {
        this.sheet = null;
        this.applyRigging();
        this.say(`${port.name}. X gets her under way`, 6);
      },
      onCabinet: () => this.openCabinet(),
      onRetire: () => {
        this.sheet = null;
        this.game.retire();
        this.finish('retired');
      },
    });
  }

  // ---- watches --------------------------------------------------------------------------------------------------

  toggleWatch(): void {
    if (this.phase !== 'sailing' || this.busy) return;
    if (this.onWatch) this.endWatch('All hands. Real time');
    else this.startWatch();
  }

  startWatch(): void {
    if (this.phase !== 'sailing' || this.onWatch) return;
    if (this.sim.out.aground) return this.say('She is aground');
    const foe = [...this.game.ships.values()].find((s) => s.seen && s.mood === 'fight' && s.range < 5000);
    if (foe) return this.say(`No watch below with the ${foe.cls.name} bearing down on us`);
    if (this.hoveTo) this.setHoveTo(false);
    this.paused = false;
    this.rateIndex = 0;
    this.hud?.setRate(0);
    if (!this.helmsman) this.course = this.sim.state.heading;
    this.takeCourse();
    this.onWatch = true;
    this.watchAcc = 0;
    this.stage.sky.bakeGapMs = 220;
    this.say(this.chasing ? 'Watch set, in chase. Enter calls all hands' : `Watch set. Course ${deg3(this.course)}°, ${compassPoint(this.course)}. Left and right alter it. Enter calls all hands`, 6);
  }

  private endWatch(text?: string): void {
    if (!this.onWatch) return;
    this.onWatch = false;
    this.stage.sky.bakeGapMs = 0;
    this.settle();
    if (text) this.say(text, 4);
  }

  /** One step of a watch. Returns false when something has called the skipper. */
  private stepWatch(seconds = WATCH_STEP): boolean {
    const s = this.sim.state;
    const world = this.opts.sea.world;
    const her = this.chasing ? this.game.target : null;
    if (this.chasing && !her) this.chasing = false;
    if (her) this.course = this.interceptCourse(her);
    const res = watchStep(this.perf, world, { x: s.x, y: s.y, t: s.t, plan: this.plan, hoveTo: false, drive: driveLeft(this.game.own.rigging) }, this.course, seconds, this.opts.spec.dimensions.draft, SLOOP_RIG);
    s.x = res.x;
    s.y = res.y;
    s.tick = Math.round(res.t / SIM_DT);
    s.t = s.tick * SIM_DT;
    s.heading = res.heading;
    s.speed = res.speed;
    if (res.plan !== this.plan) this.carry(res.plan);
    this.headed = res.headed;
    s.helmMode = 'heading';
    s.helmTarget = res.heading;
    this.keepTrack();
    const env = this.env();
    this.game.step(seconds, this.me(), env, this.see(env));
    let quiet = this.pump(true);
    // The chase is nearly within shot: no more watch below.
    if (quiet && her && her.range < 1000) {
      this.alarm(`The ${her.cls.name} is half a mile off, ${compassWords(her.bearing)}. All hands. The helmsman still has the chase: Z and C when she bears, B alongside`, 10);
      quiet = false;
    }
    if (quiet) quiet = this.lookOut(env, res.aground);
    return quiet && this.phase === 'sailing';
  }

  /** Stand watches from the console with no drawing: for play testing. Returns the game hours that passed. */
  runWatches(hours: number): number {
    if (this.phase !== 'sailing') return 0;
    const t0 = this.sim.state.t;
    if (this.hoveTo) this.setHoveTo(false);
    this.takeCourse();
    const steps = Math.round((hours * 3600) / WATCH_STEP);
    for (let i = 0; i < steps; i++) if (!this.stepWatch()) break;
    this.settle();
    return (this.sim.state.t - t0) / 3600;
  }

  /** After she has been carried a long way at once, put the scene's zero under her and her sails to the wind. */
  private settle(): void {
    const s = this.sim.state;
    this.scene.x = 0;
    this.scene.z = 0;
    this.stage.setOrigin(s.x, s.y);
    this.stage.settleSea(s.x, s.y, s.t);
    this.stage.overcast = this.opts.sea.sea.sky(s.x, s.y, this.opts.sea.world.seasonTime(s.t)).cloud;
    if (!this.hoveTo) {
      s.heading = s.helmTarget;
      this.sim.trimForWind();
    }
    this.before = this.after = this.grab();
  }

  private keepTrack(): void {
    const s = this.sim.state;
    if (s.t - this.lastTrack < TRACK_EVERY) return;
    this.lastTrack = s.t;
    this.track.push({ x: s.x, y: s.y });
    if (this.track.length > 600) this.track.splice(0, 100);
  }

  /** What the look-out reports besides ships: land, a port under her lee, shoal water, a squall. False if he spoke. */
  private lookOut(env: Env, aground: boolean): boolean {
    const s = this.sim.state;
    const { sea } = this.opts;
    const m = this.memory;
    const wind = env.wind(s.x, s.y);
    const say = (text: string) => { this.alarm(text); return false; };
    if (aground) return say('The lead shows no water to stand on. She is brought to the wind short of the shoal');
    // Shoal water on the course steered.
    const ahead = Math.min(env.depth(s.x + Math.sin(s.heading) * 1600, s.y + Math.cos(s.heading) * 1600), env.depth(s.x + Math.sin(s.heading) * 3200, s.y + Math.cos(s.heading) * 3200));
    if (ahead > 14) m.shoal = false;
    else if (ahead < 7 && m.shoal !== true) {
      m.shoal = true;
      const reef = sea.reefs.find((r) => Math.hypot(r.x - s.x, r.y - s.y) < r.radius + 4000);
      const port = this.game.nearestPort(this.me());
      if (port.metres > 6000) return say(reef ? `Breakers ahead: ${reef.name}. The water is shoaling fast` : 'Discoloured water ahead. She is standing into shoal water');
    }
    // A port close under her lee.
    const near = this.game.nearestPort(this.me());
    if (near.metres > 12000) m.port = '';
    else if (near.metres < 5000 && m.port !== near.port.id) {
      m.port = near.port.id;
      return say(this.game.isShut(near.port)
        ? `${near.port.name} bears ${compassWords(near.bearing)}, ${(near.metres / NM).toFixed(1)} miles. That port is shut to us and its fort will fire`
        : `${near.port.name} bears ${compassWords(near.bearing)}, ${(near.metres / NM).toFixed(1)} miles. Stand in and heave to off the mole with X`);
    }
    // Land, once she has been out of sight of it.
    const land = sea.sea.land.nearest(s.x, s.y, 56000);
    if (!land || land.metres > 50000) m.offshore = true;
    else if (m.offshore === true && m.seen !== land.mass.name && land.metres < sightingRange(land.mass.peak, env.sun, env.cloud, wind.speed / KT)) {
      m.offshore = false;
      m.seen = land.mass.name;
      return say(`Land. ${land.mass.name}, bearing ${compassWords(land.bearing)}, about ${Math.max(1, Math.round(land.metres / NM))} miles off`);
    }
    // A squall making up to windward.
    const hours = sea.world.seasonTime(s.t) / 3600;
    const coming = Math.max(squallAt(s.x + Math.sin(wind.dir) * 9000, s.y + Math.cos(wind.dir) * 9000, hours + 0.3, sea.sea.seed), squallAt(s.x, s.y, hours, sea.sea.seed));
    if (coming < 0.1) m.squall = false;
    else if (coming > 0.45 && m.squall !== true) {
      m.squall = true;
      return say(`A squall making up to the ${compassWords(wind.dir)}, black and coming down fast. She will be over on her ear in it: R shortens sail`);
    }
    return true;
  }

  // ---- what the game reports ----------------------------------------------------------------------------------

  /** Take the game's news and act on it. Returns false if any of it called the skipper. */
  private pump(inWatch = false): boolean {
    this.queue.push(...this.game.drain());
    let quiet = true;
    while (this.queue.length && !this.reading) {
      const e = this.queue.shift()!;
      if (e.kind === 'say') {
        if (e.wake) { this.alarm(e.text, e.seconds); quiet = false; } else this.say(e.text, e.seconds);
      } else if (e.kind === 'sight') {
        // A new sail calls the skipper. A sail already in sight coming near enough to read her colours is only reported.
        if (e.first) { this.alarm(`Sail ho. ${e.text}`, 10); quiet = false; } else this.say(e.text, 8);
      } else if (e.kind === 'fire') {
        quiet = false;
        if (this.onWatch) this.endWatch();
        this.shown(e);
        if (!e.mine) {
          this.applyRigging();
          const h = e.harm;
          this.say(h.hits === 0 ? `${e.fort ? 'The fort' : 'She'} fires: wide` : `${e.fort ? 'The fort' : 'She'} fires: ${h.hits} aboard us${h.men ? `, ${h.men} men down` : ''}${h.gunsLost ? ', a gun dismounted' : ''}`, 4);
        }
      } else if (e.kind === 'boarding') {
        quiet = false;
        if (this.onWatch) this.endWatch();
        this.reading = new BoardingRead(e.result, e.mine, e.ship.cls.name, e.odds, () => {
          this.reading = null;
          this.pump();
        });
      } else if (e.kind === 'prize') {
        quiet = false;
        this.chasing = false;
        const cargo = Object.entries(e.taken).map(([g, t]) => `${t} t of ${GOODS.find((x) => x.id === g)?.name.toLowerCase() ?? g}`).join(', ');
        const left = holdTons(e.prize.cargo) - holdTons(e.taken);
        this.alarm(`A prize: the ${e.ship.cls.name}. ${e.prize.coin} coin from her cabin${cargo ? `, ${cargo} into the hold` : ''}${left > 0 ? ` (${left} t left for want of room)` : ''}${e.joined ? `. ${e.joined} of her men sign the articles` : ''}${e.gunsTaken ? '. Two of her guns swayed across' : ''}${e.prize.artifact ? `. And in the captain's chest: ${e.prize.artifact.name.toLowerCase()}. K opens the cabinet` : ''}`, 16);
      } else if (e.kind === 'sunk') {
        quiet = false;
        this.chasing = false;
      } else if (e.kind === 'lost') {
        quiet = false;
        this.finish(e.why);
      }
    }
    void inWatch;
    return quiet;
  }

  /** Draw a broadside: smoke at the muzzles, shot across the water. */
  private shown(e: Extract<GameEvent, { kind: 'fire' }>): void {
    const s = this.sim.state;
    const wind = this.opts.sea.world.wind(s.x, s.y, s.t);
    const drift = { u: -Math.sin(wind.dir) * wind.speed, v: -Math.cos(wind.dir) * wind.speed };
    const outward = e.fort ? Math.atan2(e.at.x - e.from.x, e.at.y - e.from.y) : e.from.heading + (e.side === 'starboard' ? Math.PI / 2 : -Math.PI / 2);
    let muzzles: Array<{ x: number; y: number; h: number }>;
    if (e.fort) muzzles = e.harm.each.map((_, i) => ({ x: e.from.x + i * 14, y: e.from.y + i * 9, h: 24 }));
    else {
      const model = e.mine ? this.view.ship : [...this.drawn.values()].find((d) => Math.hypot(d.ship.root.userData.x - e.from.x, d.ship.root.userData.y - e.from.y) < 30)?.ship;
      const ch = Math.cos(e.from.heading);
      const sh = Math.sin(e.from.heading);
      const local = model?.muzzles[e.side] ?? [];
      // Boat frame to course metres: x starboard, z aft.
      muzzles = local.map((p) => ({ x: e.from.x + p.x * ch - p.z * sh, y: e.from.y - p.x * sh - p.z * ch, h: p.y }));
      if (!muzzles.length) muzzles = [{ x: e.from.x, y: e.from.y, h: 3 }];
    }
    const target = e.mine ? this.game.target : null;
    this.effects.broadside(muzzles, outward, { x: e.at.x, y: e.at.y, loa: target?.cls.loa ?? this.game.cls.loa }, e.harm.each, drift, e.mine ? 0 : e.range, e.fort);
  }

  private finish(why: CruiseEnd['why']): void {
    if (this.phase === 'ended') return;
    if (this.onWatch) this.endWatch();
    this.phase = 'ended';
    const s = this.sim.state;
    let career = this.opts.career;
    if (why !== 'retired') career = afterLoss(career);
    else {
      // Retired with the sloop still hers: what was aboard is brought ashore.
      career.banked += career.ship?.coin ?? 0;
      if (career.ship) career.ship.coin = 0;
    }
    saveCareer(career);
    this.opts.onEnd({ why, days: s.t / 86400, prizes: this.game.tally.prizes, coin: this.game.tally.coin, artifacts: this.game.tally.artifacts, sunk: this.game.tally.sunk, career, date: this.opts.sea.world.dateAt(s.t) });
  }

  // ---- the frame ------------------------------------------------------------------------------------------------

  private grab(): Snapshot {
    const s = this.sim.state;
    return { x: this.scene.x, z: this.scene.z, heading: s.heading, heel: s.heel, rudder: s.rudder, boom: s.boomAngle, jib: s.jibAngle };
  }

  private stepSim(steps: number): void {
    const s = this.sim.state;
    const world = this.opts.sea.world;
    for (let i = 0; i < steps; i++) {
      if (i === steps - 1) this.before = this.grab();
      const x0 = s.x;
      const y0 = s.y;
      if (s.hold !== 'none') {
        const o = this.sim.out;
        const cur = world.current(s.x, s.y, s.t);
        // In an anchorage she lies still. At sea, hove to, she drifts to leeward.
        const drift = this.game.nearestPort(this.me()).metres < PORT_REACH ? 0 : HOVE_TO_DRIFT;
        s.holdX += (-Math.sin(o.twd) * drift + cur.x * (drift ? 1 : 0)) * SIM_DT;
        s.holdY += (-Math.cos(o.twd) * drift + cur.y * (drift ? 1 : 0)) * SIM_DT;
      }
      this.sim.step();
      this.scene.x += s.x - x0;
      this.scene.z -= s.y - y0;
    }
    if (steps > 0) this.after = this.grab();
  }

  frame(dtReal: number): void {
    const { sim, stage, drone, view, motion } = this;
    const world = this.opts.sea.world;
    const s = sim.state;
    const sailing = this.phase === 'sailing';
    if (this.reading && !this.reading.update(dtReal)) this.reading = null;
    const her = this.chasing ? this.game.target : null;
    if (this.chasing && (!her || this.hoveTo)) this.chasing = false;
    // In chase the clock runs on by itself until she is within long gunshot.
    if (sailing && this.chasing && her && !this.onWatch) {
      const want = her.range > 2500 ? CHASE_FAR : her.range > CHASE_REAL ? CHASE_NEAR : 0;
      if (want !== this.rateIndex) { this.rateIndex = want; this.hud?.setRate(want); }
    }
    const rate = this.onWatch ? WATCH_RATE : TIME_RATES[this.rateIndex];
    const paused = this.paused || this.phase === 'ended' || this.busy;

    this.controls?.update(dtReal, paused || this.helmsman || this.onWatch);

    let gameDt = 0;
    if (!paused) {
      this.seaClock += dtReal;
      if (this.onWatch) {
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
        if (sailing && this.helmsman && !this.hoveTo && this.chasing && her) {
          this.course = this.interceptCourse(her);
          const steer = this.steerable();
          if (Math.abs(wrapPi(steer - s.helmTarget)) > 1 * D2R) sim.setHelm('heading', steer);
        }
        this.stepSim(steps);
        gameDt = steps * SIM_DT;
        if (sailing && steps > 0) {
          this.keepTrack();
          const env = this.env();
          this.game.step(gameDt, this.me(), env, this.see(env));
          this.pump();
        }
      }
    }
    if (!Number.isFinite(s.x + s.y + s.heading + s.heel + s.speed)) {
      const t = s.t;
      sim.restore({ ...initialState({ x: this.lastDeep.x, y: this.lastDeep.y, headingDeg: this.course * R2D, speedKt: 2 }), t, tick: Math.round(t / SIM_DT) });
      this.takeCourse();
    }

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
    const sea = (px: number, pz: number) => stage.seaLevel(px, pz, seaTime, 6);

    // She rides the sea that is drawn. A hundred tons of sloop spans the short seas and answers the long ones.
    const half = this.opts.spec.dimensions.loa * 0.42;
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const hBow = sea(x + fx * half, z + fz * half);
    const hStern = sea(x - fx * half, z - fz * half);
    const hStbd = sea(x - fz * 2.6, z + fx * 2.6);
    const hPort = sea(x + fz * 2.6, z - fx * 2.6);
    const hMid = sea(x, z);
    const ease = paused ? 0 : Math.min(1, dtReal * 3.5);
    motion.heave += ((hBow + hStern + 2 * hMid) / 4 - motion.heave) * ease;
    motion.pitch += (Math.atan2(hBow - hStern, half * 2) * 0.8 - motion.pitch) * ease;
    motion.roll += (Math.atan2(hPort - hStbd, 5.2) * 0.5 - motion.roll) * ease;

    const pose: BoatPose = {
      x, z, heading,
      heel: mix(before.heel, after.heel, alpha) + motion.roll,
      pitch: motion.pitch,
      heave: motion.heave - 0.05,
      rudder: mix(before.rudder, after.rudder, alpha),
      boom: mix(before.boom, after.boom, alpha),
      jib: mix(before.jib, after.jib, alpha),
    };
    view.hands = Math.max(1, Math.min(6, Math.round(this.game.own.crew / 9)));
    view.ship.showGuns(this.game.own.guns);
    view.update(pose, s, sim.out, seaTime, paused ? 0 : dtReal);
    view.root.updateMatrixWorld(true);

    if (this.phase === 'briefing') {
      this.briefYaw += dtReal * 0.05;
      drone.snap({ ...SLOOP_VIEWS.drone, yaw: this.briefYaw, dist: 58, pitch: 0.14 }, heading);
    }
    this.boatPos.set(x, pose.heave / 0.6, z);
    drone.update(dtReal, this.boatPos, heading, sea, view.solids, view.thin);
    if (this.phase === 'briefing') this.offsetForPanel();
    else drone.camera.clearViewOffset();

    // The sky, the light and the colour of the sea.
    const sky = this.opts.sea.sea.sky(s.x, s.y, world.seasonTime(s.t));
    const wind = world.wind(s.x, s.y, s.t);
    const twsKt = wind.speed / KT;
    stage.overcast += (sky.cloud - stage.overcast) * Math.min(1, dtReal * (this.onWatch ? 2 : 0.5));
    stage.sunPlace = this.opts.sea.sea.projection.toLatLon(s.x, s.y);
    this.nightLight.intensity = 1.6 * (1 - THREE.MathUtils.smoothstep(stage.sky.elevation, -0.12, 0.06));
    // Deep-sea blue, going grey under a squall. Over sand and coral the bottom shows through.
    const dull = 1 - 0.6 * stage.overcast;
    stage.ocean.setWater(this.deep.setRGB(0.004, 0.026 + 0.01 * dull, 0.075 * (0.5 + 0.5 * dull)), this.scatter.setRGB(0.012 * dull, 0.13 * dull, 0.2 * dull));
    const box = this.shoals.update(s.x, s.y, stage.origin);
    stage.ocean.setShoals(this.shoals.texture, box.x, box.z, box.size, this.turquoise.setRGB(0.05 * dull, 0.55 * dull + 0.05, 0.5 * dull + 0.05));
    const squall = Math.max(0, (stage.overcast - 0.55) / 0.45);
    stage.haze.far = THREE.MathUtils.lerp(46000, 5000, squall);
    stage.haze.near = THREE.MathUtils.lerp(2500, 300, squall);

    this.towns.place(stage.origin);
    this.palms.update(s.x, s.y, stage.origin);
    this.drawShips(dtReal, seaTime, sea);
    this.effects.update(paused ? 0 : this.onWatch ? dtReal : Math.min(1, dtReal * Math.min(rate, 4)), { u: -Math.sin(wind.dir) * wind.speed, v: -Math.cos(wind.dir) * wind.speed }, stage.origin, sea);

    if (this.phase !== 'briefing') this.aboard(dtReal, twsKt, wind.dir);
    this.chart?.update(dtReal);
    const o = sim.out;
    const loose = Math.max(o.main.luff * 0.7 + (o.main.flogging ? 0.3 : 0), s.furl > 0.03 ? o.jib.luff * 0.7 + (o.jib.flogging ? 0.3 : 0) : 0);
    this.sound.update(o.aws / KT, s.speed / KT, this.hoveTo ? 0 : loose, paused || this.phase === 'briefing');

    stage.frame(dtReal, this.phase === 'briefing' ? 1 : rate, s.t, seaTime, drone.camera, { x, z, heading, speed: s.speed, heel: pose.heel }, [], o.tws / KT, this.chart?.isOpen ?? false);
  }

  /**
   * Draw the other ships. Far off she is drawn larger than life, as the eye picks out a sail, and sunk below the
   * curve of the sea, so that her upper sails lift over the horizon before her hull does.
   */
  private drawShips(dt: number, seaTime: number, sea: (x: number, z: number) => number): void {
    const { stage } = this;
    const s = this.sim.state;
    const world = this.opts.sea.world;
    for (const [id, d] of this.drawn) {
      if (this.game.ships.has(id)) continue;
      stage.scene.remove(d.ship.root);
      d.ship.dispose();
      this.drawn.delete(id);
    }
    for (const ship of this.game.ships.values()) {
      if (!ship.seen && ship.range > 30000) continue;
      let d = this.drawn.get(ship.id);
      if (!d) {
        d = { ship: new PeriodShip(lookOf(ship.cls, ship.nation)), clock: 0 };
        d.ship.root.name = ship.id;
        stage.scene.add(d.ship.root);
        this.drawn.set(ship.id, d);
      }
      const root = d.ship.root;
      root.userData.x = ship.x;
      root.userData.y = ship.y;
      const sx = ship.x - stage.origin.x;
      const sz = -(ship.y - stage.origin.y);
      const range = Math.hypot(ship.x - s.x, ship.y - s.y);
      const big = THREE.MathUtils.clamp(range / 2200, 1, 3.2);
      const dip = (range * range) / (2 * EARTH) * 0.85;
      const down = ship.mood === 'sinking' ? Math.min(ship.cls.freeboard + 14, ship.sinking * 0.22) : 0;
      const near = range < 3000;
      root.scale.setScalar(big);
      root.position.set(sx, (near ? sea(sx, sz) * 0.7 : 0) - dip - down, sz);
      const wind = world.wind(ship.x, ship.y, s.t);
      const awa = wrapPi(wind.dir - ship.heading);
      const heel = ship.mood === 'sinking' ? Math.min(0.9, ship.sinking * 0.02) : -Math.sign(awa) * Math.min(0.2, (wind.speed / KT) * 0.006 * Math.sin(Math.min(Math.PI / 2, Math.abs(awa))));
      root.rotation.set(near ? Math.sin(seaTime * 0.7 + ship.seed) * 0.02 : 0, -ship.heading, -heel);
      d.clock -= dt;
      if (near || d.clock <= 0) {
        d.clock = 1.5;
        d.ship.setSails({ awa, aws: wind.speed, hoist: ship.mood === 'struck' ? 0.35 : ship.mood === 'sinking' ? 0.6 : 0.4 + 0.6 * ship.rigging / 100, colours: ship.mood !== 'struck', shake: ship.mood === 'struck' ? 1 : 0 }, seaTime, near ? dt : 1.5);
      }
    }
  }

  private offsetForPanel(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w > 760) this.drone.camera.setViewOffset(w, h, -Math.min(230, w * 0.2), 0, w, h);
    else this.drone.camera.setViewOffset(w, h, 0, h * 0.22, w, h);
  }

  /** Once a frame while she is sailing: the crew's part, the ground, the port, and what the panels say. */
  private aboard(dtReal: number, twsKt: number, twd: number): void {
    const { sim, game } = this;
    const s = sim.state;
    const world = this.opts.sea.world;
    const turning = s.maneuver !== null;
    if (this.wasManeuver && !turning && this.helmsman && s.helmMode === 'heading') this.course = s.helmTarget;
    this.wasManeuver = turning;
    if (this.helmsman && !this.hoveTo && !turning && s.helmMode === 'hand') {
      this.helmsman = false;
      this.chasing = false;
      this.say('You have the tiller. P hands it back to the helmsman');
    }
    const live = !this.onWatch && !this.paused && !this.busy && this.phase === 'sailing';
    if (live) {
      if (this.helmsman && !this.hoveTo && !turning && !this.chasing) {
        const steer = this.steerable();
        if (Math.abs(wrapPi(steer - s.helmTarget)) > 0.5 * D2R || s.helmMode !== 'heading') sim.setHelm('heading', steer);
      }
      // She has taken the ground.
      const depth = world.chartDepth(s.x, s.y);
      if (depth > 8 && !sim.out.aground) this.lastDeep = { x: s.x, y: s.y };
      if (sim.out.aground) {
        const reef = this.opts.sea.reefs.find((r) => Math.hypot(r.x - s.x, r.y - s.y) < r.radius + 1500);
        const loss = game.aground(Math.abs(s.speed) / KT, reef !== undefined);
        const t = s.t + 1500;
        sim.restore({ ...initialState({ x: this.lastDeep.x, y: this.lastDeep.y, headingDeg: wrapTau(s.heading + Math.PI) * R2D, speedKt: 1 }), t, tick: Math.round(t / SIM_DT) });
        this.carry(this.plan);
        this.course = sim.state.heading;
        this.takeCourse();
        this.settle();
        if (game.ended) this.pump();
        else this.alarm(reef ? `She struck on ${reef.name} and stove in ${Math.round(loss)} of her hull. The boats hauled her off, and it took the best part of half an hour` : `She took the ground and started ${Math.round(loss)} of her planking. Kedged off into deep water`, 10);
      }
      this.clock2 -= dtReal * TIME_RATES[this.rateIndex];
      if (this.clock2 <= 0) {
        this.clock2 = 3;
        const env = this.env();
        this.lookOut(env, false);
        // Lying still in an anchorage she has not just left: the boat goes ashore.
        const port = game.portAt(this.me());
        if (!port) { if (game.nearestPort(this.me()).metres > PORT_REACH * 1.6) this.visited = null; } else if (this.visited !== port.id && this.hoveTo) this.goAshore(false);
      }
    }

    const me = this.me();
    const own = game.own;
    const g = game.target;
    const served = gunsServed(own.guns, own.crew);
    let glass = null;
    if (g && g.seen) {
      const seen = g.seen;
      const close = seen === 'close' || seen === 'colours';
      const ours = { men: own.crew, fight: game.cls.fight, heart: heart(own.hull / game.cls.hull, Math.min(1, own.crew / game.cls.crew)) };
      const hers = { men: g.crew, fight: g.cls.fight, heart: heart(g.hull / g.cls.hull, g.crew / g.cls.crew) };
      const mood = g.mood === 'struck' ? 'She has struck. Come close: B sends the boat' : g.mood === 'flee' ? 'Running from us' : g.mood === 'fight' ? 'Standing toward us to fight' : g.mood === 'sinking' ? 'Going down' : '';
      glass = {
        title: seen === 'tops' ? 'A sail' : seen === 'hull' ? g.cls.rigWords.split(':').pop()!.trim() : g.cls.name,
        line: describeSail(seen, g.cls, g.nation, g.range, g.bearing, g.heading),
        hull: seen === 'close' ? g.hull / g.cls.hull : undefined,
        rigging: seen === 'close' ? g.rigging / 100 : undefined,
        crew: seen === 'close' ? `About ${Math.round(g.crew / 5) * 5} men on her deck` : undefined,
        odds: seen === 'close' ? `boarding ${Math.round(boardingOdds(ours, hers) * 100)} in 100` : undefined,
        mood: close ? mood : undefined,
      };
    }
    this.panel?.update({
      hull: (own.hull / game.cls.hull) * 100, rigging: own.rigging, crew: own.crew, guns: own.guns, served,
      reload: game.reload,
      bears: { port: game.bearsOn('port', me) !== null, starboard: game.bearsOn('starboard', me) !== null },
      heel: { port: heelEffect('port', s.heel).chance, starboard: heelEffect('starboard', s.heel).chance },
      hold: holdTons(own.hold), holdMax: game.cls.cargoTons, coin: own.coin, banked: this.opts.career.banked, notoriety: this.opts.career.notoriety,
      glass, chasing: this.chasing,
    });

    const helm = this.hoveTo
      ? 'Hove to'
      : this.helmsman
        ? this.chasing ? '<b class="on">In chase</b>: the helmsman is cutting her off' : `Helmsman: course <b class="on">${deg3(this.course)}° ${compassPoint(this.course)}</b>${this.headed ? ` · she will not lie it, full and by ${deg3(s.heading)}°` : ''}`
        : 'You have the tiller';
    this.hud?.update({
      heading: s.heading,
      judgedKt: this.hoveTo ? 0 : Math.round((s.speed / KT) * 2) / 2,
      awa: sim.out.awa,
      twd,
      twsKt,
      sailing: this.hoveTo ? 'Hove to' : sailingWord(sim.out.twa),
      canvas: this.hoveTo ? 'sail down' : `${SLOOP_RIG.plans[this.plan].name.toLowerCase()} · heel ${Math.round(Math.abs(s.heel) * R2D)}°`,
      helm,
      date: world.dateAt(s.t),
      timeZone: this.opts.sea.sea.course.timeZone,
      day: Math.floor((s.t + CARIBBEAN.castOff * 3600) / 86400) + 1,
      pace: this.phase === 'ended' ? 'The end' : this.paused ? 'Paused' : this.onWatch ? 'On watch' : this.rateIndex === 0 ? 'Real time' : `${TIME_RATES[this.rateIndex]}× time`,
      fast: this.onWatch || this.rateIndex > 0,
      paused: this.paused,
    }, dtReal);
  }

  /** Handles for play testing from the console. */
  debug(): Record<string, unknown> {
    const sea = this.opts.sea;
    return {
      mode: 'expedition', game: 'pirates', pirates: this, sim: this.sim, world: sea.world, scene: this.stage.scene, renderer: this.stage.renderer, stage: this.stage,
      drone: this.drone, boatView: this.view, chart: this.chart, sea, rules: this.game, perf: this.perf, views: VIEWS,
      setPaused: (p: boolean) => { this.paused = p; },
      setCourse: (deg: number) => { this.course = wrapTau(deg * D2R); this.chasing = false; if (!this.hoveTo) this.sim.setHelm('heading', this.steerable()); },
      watch: (hours: number) => this.runWatches(hours),
      /** Run the game on by a number of seconds with the sim sailing her and nothing drawn. */
      run: (seconds: number) => {
        for (let i = 0; i < Math.round(seconds); i++) {
          const her = this.chasing ? this.game.target : null;
          if (her && this.helmsman) { this.course = this.interceptCourse(her); this.sim.setHelm('heading', this.steerable()); }
          this.stepSim(Math.round(1 / SIM_DT));
          const env = this.env();
          this.game.step(1, this.me(), env, this.see(env));
          this.pump();
          if (this.phase !== 'sailing' || this.reading) break;
        }
        this.before = this.after = this.grab();
      },
      /** Put her somewhere else on the sea, at an hour of the cruise, heading a given way. Lat and lon in degrees. */
      place: (lat: number, lon: number, hoursOut?: number, headingDeg?: number) => {
        const p = sea.sea.projection.toXY(lat, lon);
        const st = this.sim.state;
        st.x = p.x;
        st.y = p.y;
        if (hoursOut !== undefined) { st.tick = Math.round((hoursOut * 3600) / SIM_DT); st.t = st.tick * SIM_DT; }
        this.lastDeep = { x: p.x, y: p.y };
        if (headingDeg !== undefined) {
          this.course = wrapTau(headingDeg * D2R);
          st.helmTarget = this.course;
          st.heading = this.course;
        }
        this.settle();
      },
      /** Put a ship on the sea: metres ahead and to starboard of the sloop, and her heading against the sloop's in degrees. */
      spawn: (cls: string, nation: string, ahead: number, starboard: number, turn = 0, mood = 'flee') => {
        const st = this.sim.state;
        const x = st.x + Math.sin(st.heading) * ahead + Math.cos(st.heading) * starboard;
        const y = st.y + Math.cos(st.heading) * ahead - Math.sin(st.heading) * starboard;
        const ship = this.game.spawn(cls, nation as never, x, y, wrapTau(st.heading + turn * D2R), mood as never);
        ship.seen = 'close';
        return ship;
      },
      fire: (side: Side) => this.fire(side),
      board: () => this.board(),
      chase: () => this.toggleChase(),
      heaveTo: (on: boolean) => this.setHoveTo(on),
      ashore: () => this.goAshore(true),
      cabinet: () => this.openCabinet(),
      retire: () => { this.game.retire(); this.finish('retired'); },
      state: () => {
        const st = this.sim.state;
        const at = sea.sea.projection.toLatLon(st.x, st.y);
        const w = sea.world.wind(st.x, st.y, st.t);
        return {
          phase: this.phase, onWatch: this.onWatch, hours: st.t / 3600, date: sea.world.dateAt(st.t).toISOString(), lat: at.lat, lon: at.lon,
          windKt: w.speed / KT, windFrom: w.dir * R2D, speedKt: st.speed / KT, headingDeg: st.heading * R2D, heelDeg: st.heel * R2D, courseDeg: this.course * R2D,
          depth: sea.world.chartDepth(st.x, st.y), own: { ...this.game.own }, banked: this.opts.career.banked, notoriety: this.opts.career.notoriety, artifacts: this.opts.career.artifacts,
          ships: [...this.game.ships.values()].map((sh) => ({ id: sh.id, cls: sh.cls.id, mood: sh.mood, seen: sh.seen, range: Math.round(sh.range), bearing: Math.round(sh.bearing * R2D), hull: Math.round(sh.hull), crew: sh.crew })),
          ended: this.game.ended, chasing: this.chasing, hoveTo: this.hoveTo,
        };
      },
    };
  }
}
