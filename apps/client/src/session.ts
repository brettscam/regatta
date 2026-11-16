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
import { GustWatch } from './ui/gusts';
import { Hints, pointOfSail } from './ui/hints';
import type { Logbook } from './net/logbook';
import { Hud, TIME_RATES } from './ui/hud';
import { Passage } from './ui/passage';
import { Sound } from './audio/sound';
import { createFeatures } from './aboard/index';
import type { AboardContext, Feature } from './aboard/feature';
import type { Residents } from './aboard/residents';
import { Fleet, type Identity } from './net/fleet';
import { alone } from './net/platform';
import { myAvatar } from './boat/avatar';
import { Race, type RaceCourse } from './race/race';
import { ShadedWind } from './race/shadow';
import { Seaway } from './aboard/seaway';
import { damageNote } from './aboard/contactRules';
import { capsizeAlarm } from './aboard/pressedRules';
import { FleetPanel } from './ui/fleetpanel';
import type { Stage } from './stage';
import type { CourseFeatures } from './world/features';

/** Somewhere worth sailing to. */
export interface Place {
  id: string;
  name: string;
  x: number;
  y: number;
  say: string;
  /** How a boat stops here: on a mooring buoy, alongside a dock, or on her own anchor. */
  kind?: 'mooring' | 'dock' | 'anchorage';
  /**
   * Where the crew goes once ashore. `kind` is what stands there (club, bar, marina, hotel, store, park) and how the chart marks it.
   * The rest shapes the venue drawn on the shore, all optional: see `VenuePlace` in `scene/venue.ts`.
   */
  ashore?: { name: string; say: string; kind?: string; site?: [number, number]; sign?: string; deck?: [number, number]; tables?: number; umbrellas?: string };
  /** What kind of stop it is, where a water says: the sort a bar hop or a poker run would score. */
  stop?: 'bar' | 'beach' | 'snorkel' | 'marina';
}

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
  /** The boats a race can be sailed in: the ones ready to sail, by id, in the picker's order. */
  classes: Record<string, YardBoat>;
  /** A saved sim state to carry on from, when the page was republished mid-sail. */
  resume?: SimState;
  /** What the skipper is called. */
  skipper: string;
  logbook: Logbook;
  places: Place[];
  /** Hazards, traffic lanes, refuges and lights, on a water that has them. */
  features?: CourseFeatures;
  /** Race courses on offer. */
  races: RaceCourse[];
  /** True while the roadmap and feedback screen is open. */
  boardOpen(): boolean;
}

type Snapshot = Pick<SimState, 'x' | 'y' | 'heading' | 'heel' | 'rudder' | 'boomAngle' | 'jibAngle'>;
const grab = (s: SimState): Snapshot => ({ x: s.x, y: s.y, heading: s.heading, heel: s.heel, rudder: s.rudder, boomAngle: s.boomAngle, jibAngle: s.jibAngle });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** One sail: the boat, her instruments, the chart, the pilot, and anyone sailing in company. */
export class Session {
  readonly sim: Sim;
  /** The wind the sim is fed: the world's, less whatever another boat to windward is taking. `aboard/badair.ts` sets it. */
  readonly air: ShadedWind;
  /** The sea as she meets it: the sea state at the boat, ships' wakes, and the slam and surf events. See `aboard/seaway.ts`. */
  readonly seaway: Seaway;
  boatView: BoatView;
  readonly drone: DroneCamera;
  readonly hud = new Hud();
  readonly passage: Passage;
  readonly chart: Chart;
  readonly pilot: Pilot;
  readonly fleet: Fleet;
  private readonly gusts: GustWatch;
  readonly race: Race;
  readonly fleetPanel: FleetPanel;
  /** Things to do aboard besides sailing. See `aboard/feature.ts`. */
  readonly features: Feature[];
  readonly coach: Coach | null;
  readonly hints: Hints;
  private readonly hailBox = document.getElementById('hail') as HTMLElement;
  private readonly hailLog = document.getElementById('hails') as HTMLElement;
  private windSide = 0;
  private readonly visited = new Set<string>();
  private readonly sound = new Sound();
  private readonly controls: Controls;
  private paused = false;
  private rateIndex = 0;
  private before: Snapshot;
  private after: Snapshot;
  private acc = 0;
  private readonly motion = { heave: 0, pitch: 0, roll: 0, lastPitch: 0, wait: 0, shudder: 0, shudderAge: 9, surf: 0 };
  private readonly boatPos = new THREE.Vector3();
  /** The boat she is sailing now: her own (`opts.spec`), or the class of the race she is in. */
  private spec: YardBoat;
  /** What the fleet is told she is. The fleet reads it each time it reports, so a change of boat goes out with the next one. */
  private readonly identity: Identity;
  /** What the features aboard are handed. Its boat is kept current. */
  private aboard!: AboardContext;
  /** The boats that live on this water, as other vessels. See `aboard/residents.ts`. */
  private residents: Residents | null = null;
  private readonly elsewhere: TrafficVessel[] = [];
  private readonly watch = { shallow: false, aground: false, marksReached: 0, warned: new Map<string, number>(), crashGybes: 0, knockdowns: 0, broaches: 0, wraps: 0, capsizes: 0 };

  constructor(private readonly stage: Stage, private readonly opts: SessionOptions) {
    const world = stage.world;
    this.spec = opts.spec;
    const wind = world.wind(opts.x, opts.y, 0);
    // The sim is not handed the world itself but the world as she feels it, so a wind shadow is just a lighter wind to it.
    this.air = new ShadedWind(world);
    this.sim = new Sim(opts.spec, this.air, { x: opts.x, y: opts.y, headingDeg: opts.headingDeg ?? wind.dir * R2D + 50, speedKt: 5 });
    this.sim.trimForWind();
    // Until the player takes the wheel, the boat holds her angle to the wind.
    this.sim.setHelm('wind');
    if (opts.resume) this.sim.restore(opts.resume);
    this.before = grab(this.sim.state);
    this.after = this.before;
    this.seaway = new Seaway(this.sim, stage, (text, seconds = 5) => this.hud.raiseAlarm(text, seconds));
    this.watch.crashGybes = this.sim.state.crashGybes;
    this.watch.knockdowns = this.sim.state.knockdowns;
    this.watch.capsizes = this.sim.state.capsizes;
    this.watch.broaches = this.sim.state.broaches;
    this.watch.wraps = this.sim.state.spinWraps;

    this.boatView = new BoatView(opts.spec, opts.livery);
    stage.scene.add(this.boatView.root);
    this.drone = new DroneCamera(window.innerWidth / window.innerHeight);
    this.drone.snap(this.boatView.views.drone, this.sim.state.heading);

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
      places: opts.places,
      features: opts.features,
    });

    this.pilot = new Pilot(this.sim, this.passage, {
      say: (text) => this.hud.raiseAlarm(text, 4),
      alarm: (text) => this.alarm(text),
      racing: () => {
        const race = this.race;
        return race?.call && race.started && race.finish === null ? race.call.id : null;
      },
    });

    // Shared water: other people with this page open, each sailing their own boat. One clock for everyone.
    this.identity = { boat: opts.spec.id, colour: opts.livery.topsides ?? '', name: opts.livery.name ?? '', skipper: opts.skipper };
    this.fleet = new Fleet(opts.boats, this.identity, world, stage.scene);
    this.fleet.clockLimit = world.seasonLength;
    this.fleet.water = stage.course.id;
    this.gusts = new GustWatch(world, this.sim);
    void this.fleet.connect();
    this.fleet.onHail = (from, text) => this.heard(from, text);
    this.race = new Race({
      sim: this.sim, world, passage: this.passage, fleet: this.fleet, scene: stage.scene, logbook: opts.logbook,
      own: opts.spec, boat: () => this.spec, classes: opts.classes, setBoat: (boat) => this.changeBoat(boat),
      skipper: opts.skipper, boatName: opts.livery.name ?? '', colour: opts.livery.topsides, courses: opts.races,
      say: (text, seconds = 5) => this.hud.raiseAlarm(text, seconds),
      alarm: (text) => this.alarm(text),
      finished: () => this.fleetPanel.toggle(true),
      invite: (from, text) => {
        this.heard(from, text);
        this.hud.raiseAlarm(`${from} ${text}`, 8);
      },
    });
    this.fleet.extra = () => {
      const out: Record<string, unknown> = {};
      for (const f of this.features) Object.assign(out, f.wire?.());
      return { ...out, ...this.race.wire(), st: this.status(), cs: this.stage.course.id, wb: world.windBoost };
    };
    this.fleetPanel = new FleetPanel({
      race: this.race,
      courses: opts.races,
      boats: () => this.fleet.boats,
      me: () => ({ x: this.sim.state.x, y: this.sim.state.y, sog: this.sim.out.sog, name: opts.skipper, boatName: opts.livery.name ?? '', status: this.status() || damageNote(Math.round(this.sim.state.damage * 100)) }),
      chartRoute: () => this.passage.marks.map((m) => ({ name: m.name, x: m.x, y: m.y })),
      water: stage.course.id,
      classes: Object.values(opts.classes),
      ownBoat: opts.spec.id,
    });
    this.bindHail();
    opts.logbook.identify(opts.skipper, opts.spec.id, opts.livery.name ?? '', opts.livery.topsides ?? '');

    // Quiet coaching for anyone still learning: one line when something has been wrong for a while.
    this.hints = new Hints({
      sim: this.sim,
      nextMark: () => this.passage.marks[this.passage.nextIndex] ?? null,
      // In another boat's wind shadow the sails misbehave through no fault of the trim: nothing to coach.
      busy: () => (this.coach?.active ?? false) || this.chart.isOpen || opts.boardOpen() || this.paused || this.air.factor < 0.93,
      racing: () => this.race.call !== null && this.race.finish === null,
      sea: () => this.seaway.sea,
      slams: () => this.seaway.slamsLately,
      tideGate: () => {
        // The one stretch of the Bay whose ebb is famous for it.
        const gate = stage.course.id === 'sf-bay' ? stage.course.marks.find((m) => m.id === 'gate') : undefined;
        return gate && Math.hypot(gate.x - this.sim.state.x, gate.y - this.sim.state.y) < 3000 ? 'the Golden Gate' : '';
      },
    });

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
      toggleHints: () => this.hud.raiseAlarm(this.hints.toggle(), 4),
      openHail: () => this.openHail(),
      toggleFleet: () => this.fleetPanel.toggle(),
      featureKey: (code, shift) => this.features.some((f) => f.key?.(code, shift) ?? false),
    });

    this.aboard = {
      sim: this.sim, world, air: this.air, seaway: this.seaway, stage, hud: this.hud, passage: this.passage, boatView: this.boatView, drone: this.drone,
      spec: opts.spec, livery: opts.livery, skipper: opts.skipper, places: opts.places, features: opts.features, logbook: opts.logbook,
      say: (text, seconds = 5) => this.hud.raiseAlarm(text, seconds),
      heard: (from, text) => this.heard(from, text),
      alarm: (text) => this.alarm(text),
      sharing: () => this.sharing,
      company: () => this.fleet.boats,
      race: this.race,
      races: opts.races,
      seasonNow: () => world.seasonTime(this.sim.state.t),
      held: (code) => this.controls.isHeld(code),
      sound: this.sound,
      feature: <T extends Feature>(id: string) => this.features.find((f) => f.id === id) as T | undefined,
    };
    this.features = createFeatures(this.aboard);
    this.residents = this.features.find((f): f is Residents => f.id === 'residents') ?? null;
  }

  /**
   * Put her in a different boat where she lies: a race is sailed in one class, and afterwards she has her own back.
   * The sim carries on in the new boat, so everything that holds the sim (the pilot, the race, the instruments) needs
   * no telling. What is built for one particular boat is built again: her model, and what hangs on it.
   * Her name and colours stay. The other boats are told with the next report and draw the new hull.
   */
  changeBoat(spec: YardBoat): void {
    if (spec.id === this.spec.id) return;
    const { sim, stage } = this;
    const old = this.boatView;
    this.spec = spec;
    sim.setBoat(spec);
    // Her figure as it is now: she may have changed her look since she cast off.
    this.boatView = new BoatView(spec, this.opts.livery.avatar ? { ...this.opts.livery, avatar: myAvatar() } : this.opts.livery);
    stage.scene.add(this.boatView.root);
    this.boatView.update({ x: sim.state.x, z: -sim.state.y, heading: sim.state.heading, heel: sim.state.heel, pitch: 0, heave: 0, rudder: sim.state.rudder, boom: sim.state.boomAngle, jib: sim.state.jibAngle }, sim.state, sim.out, sim.state.t, 0);
    this.controls.setBoat(this.boatView);
    this.aboard.boatView = this.boatView;
    this.aboard.spec = spec;
    for (const f of this.features) f.reboat?.();
    this.identity.boat = spec.id;
    this.passage.setPolar(spec.polar, sim.state, sim.state.t);
    // The old model goes, with everything made for it.
    stage.scene.remove(old.root);
    old.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    });
  }

  /** What this boat is doing when she is not simply sailing, in a few words, for the others to see. */
  status(): string {
    // Holed comes before anything else she might be doing.
    if (this.sim.state.damage >= 1) return 'Holed';
    for (const f of this.features) {
      const s = f.status?.();
      if (s) return s;
    }
    return '';
  }

  /** Where the player is when not at the helm, in the kayak for instance. */
  private focus(): { x: number; y: number; heading: number; height: number } | null {
    for (const f of this.features) {
      const p = f.focus?.();
      if (p) return p;
    }
    return null;
  }

  get sharing(): boolean {
    return this.fleet.boats.length > 0;
  }

  /** The whole state, enough to carry on from after a reload. */
  snapshot(): SimState {
    return this.sim.snapshot();
  }

  // ---- hailing the other boats -----------------------------------------------------------------

  private bindHail(): void {
    const input = this.hailBox.querySelector('input') as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.hailBox.hidden = true;
      if (e.key !== 'Enter') return;
      const text = input.value.trim();
      this.hailBox.hidden = true;
      input.value = '';
      this.stage.canvas.focus();
      if (!text) return;
      // Other people's boats hear it, and so does any boat that lives here and is close enough.
      const company = this.fleet.hail(text);
      const locals = this.features.filter((f) => f.hail?.(text)).length > 0;
      if (company || locals) this.heard('You', text);
      else this.hud.raiseAlarm(alone() ? 'Nobody near enough to hear that. Sail within a few hundred metres of a boat and hail her again' : 'Nobody near enough to hear that. Hail when other people are on the water with you, or within a few hundred metres of a boat that lives here', 6);
    });
    input.addEventListener('blur', () => { this.hailBox.hidden = true; });
  }

  private openHail(): void {
    this.hailBox.hidden = false;
    const input = this.hailBox.querySelector('input') as HTMLInputElement;
    let local: string | null = null;
    for (const f of this.features) local ??= f.withinHail?.() ?? null;
    input.placeholder = this.sharing ? (local ? `Hail the fleet and ${local}, then Enter` : 'Hail the fleet, then Enter') : local ? `Hail ${local}, then Enter` : 'Nobody within hail. Sail closer to a boat. Enter to close';
    input.focus();
  }

  /** Show a hail for a while. Names and words come from other people, so they go in as text, never as markup. */
  private heard(from: string, text: string): void {
    const line = document.createElement('div');
    const who = document.createElement('b');
    who.textContent = from;
    line.append(who, ` ${text}`);
    this.hailLog.appendChild(line);
    while (this.hailLog.children.length > 5) this.hailLog.firstChild?.remove();
    window.setTimeout(() => line.remove(), 45000);
  }

  /** Every other vessel on the water: the course's traffic and any boats sailing in company. */
  private everyoneElse(): TrafficVessel[] {
    // The boats that live on this water are vessels like any other: on the chart, and with a wake.
    // One list, filled again each time it is asked for, so nothing is made every frame.
    const locals = this.residents?.vessels;
    let traffic = this.stage.traffic.vessels;
    if (locals?.length || this.race.pacers.length) {
      const all = this.elsewhere;
      all.length = 0;
      for (const v of traffic) all.push(v);
      if (locals) for (const v of locals) all.push(v);
      if (this.race.pacers.length) for (const v of this.race.vessels()) all.push(v);
      traffic = all;
    }
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
    if (o.aground && !watch.aground) this.alarm('Aground. Get her head round to deeper water, or press U for a tow');
    else if (!o.aground && o.underKeel !== null && o.underKeel < 2.5 && !watch.shallow) this.alarm(`Shallow water: ${o.underKeel.toFixed(1)} m under the keel`);
    // The boom came across on its own.
    const windKt = Math.round(o.tws / KT);
    if (sim.state.capsizes > watch.capsizes) this.alarm(capsizeAlarm(this.spec, sim.state, o));
    else if (sim.state.broaches > watch.broaches) this.alarm(`Broached under the spinnaker in ${windKt} kt. It has collapsed and she will come up. Get it down with N${windKt >= (this.spec.sails.spinnaker?.maxTwsKt ?? 21) ? ': this is too much wind for it' : ', or bear away before it fills again'}`);
    else if (sim.state.knockdowns > watch.knockdowns && sim.state.crashGybes === watch.crashGybes) this.alarm(`Knocked down: ${windKt} kt on ${this.spec.sails.main.reefs[sim.state.reef]?.name.toLowerCase() ?? 'this much sail'} with the sheets in. She will come up. Let the main out with S, and reef with J before the next gust`);
    else if (sim.state.knockdowns > watch.knockdowns) this.alarm(`Knocked down. Crash gybe in ${windKt} kt with the main let out. She will come up: ease the sheets`);
    else if (sim.state.crashGybes > watch.crashGybes) this.alarm('Crash gybe. Haul the main in before the boom comes across, or press T and the crew tends it');
    if (sim.state.spinWraps > watch.wraps && sim.state.broaches === watch.broaches) this.alarm('The spinnaker has wrapped round the forestay. It is doing nothing: take it down with N, then set it again');
    watch.broaches = sim.state.broaches;
    watch.capsizes = sim.state.capsizes;
    watch.wraps = sim.state.spinWraps;
    if (sim.state.knockdowns > watch.knockdowns) this.opts.logbook.count('knockdowns', sim.state.knockdowns - watch.knockdowns);
    watch.crashGybes = sim.state.crashGybes;
    watch.knockdowns = sim.state.knockdowns;
    watch.aground = o.aground;
    watch.shallow = o.underKeel !== null && o.underKeel < (watch.shallow ? 4 : 2.5);
    const reached = passage.nextIndex;
    if (reached > watch.marksReached) {
      this.opts.logbook.count('marks', reached - watch.marksReached);
      const done = passage.marks[reached - 1];
      const next = passage.marks[reached];
      // In a race the race itself says when a mark is taken, and what comes next.
      const quiet = this.race.call !== null;
      if (next) {
        // Work out the rest of the route again from here, so the plan stays honest.
        passage.replan({ x: sim.state.x, y: sim.state.y }, sim.state.t);
        const brg = Math.round((Math.atan2(next.x - sim.state.x, next.y - sim.state.y) * R2D + 360) % 360);
        if (!quiet) this.alarm(`${done.name} astern. Next mark ${next.name}, bearing ${String(brg).padStart(3, '0')}°`);
      } else if (!quiet) {
        this.alarm(`${done.name} reached. Route complete`);
      }
    }
    watch.marksReached = reached;

    // Arriving somewhere: close in and slowed down. Said once per visit.
    for (const place of this.opts.places) {
      const d = Math.hypot(place.x - sim.state.x, place.y - sim.state.y);
      if (d < 150 && !this.visited.has(place.id)) {
        this.visited.add(place.id);
        this.hud.raiseAlarm(`${place.name}. ${place.say}`, 8);
      } else if (d > 500) this.visited.delete(place.id);
    }
    // A tack or a gybe for the logbook: the wind has changed sides.
    const side = o.twa >= 0 ? 1 : -1;
    if (this.windSide !== 0 && side !== this.windSide && Math.abs(o.twa) > 0.35 && Math.abs(o.twa) < 2.8) {
      this.opts.logbook.count('tacks');
      this.windSide = side;
    } else if (this.windSide === 0) this.windSide = side;

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
    const { sim, stage, passage, pilot, hud, chart, fleet, drone, motion } = this;
    const world = stage.world;
    const rate = TIME_RATES[this.rateIndex];
    const paused = this.paused;

    const away = this.focus();
    this.controls.update(dtReal, paused || away !== null);

    // Fixed steps. Faster time just means more of them per frame.
    if (!paused) {
      this.acc += dtReal * rate;
      let steps = Math.floor(this.acc / SIM_DT);
      this.acc -= steps * SIM_DT;
      steps = Math.min(steps, 600);
      for (let i = 0; i < steps; i++) {
        if (i === steps - 1) this.before = this.after;
        sim.step();
        this.race.step();
        this.seaway.step();
        for (const f of this.features) f.step?.();
        // Keep the track and mark arrivals honest at high time rates.
        if (i % 30 === 0) passage.update(sim.state, sim.state.t);
      }
      if (steps > 0) {
        this.opts.logbook.add(steps * SIM_DT, sim.out.sog * steps * SIM_DT, sim.out.sog / KT);
        this.after = grab(sim.state);
        passage.update(sim.state, sim.state.t);
        this.race.update();
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
    const half = this.spec.dimensions.loa * 0.36;
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const sea = (px: number, pz: number) => stage.seaLevel(px, pz, seaTime, 4);
    const hBow = sea(x + fx * half, z + fz * half);
    const hStern = sea(x - fx * half, z - fz * half);
    const hStbd = sea(x - fz * 1.4, z + fx * 1.4);
    const hPort = sea(x + fz * 1.4, z - fx * 1.4);
    const hMid = sea(x, z);
    const ease = paused ? 0 : Math.min(1, dtReal * 5);
    // A ship's wake is in `sea` already. She rolls to it harder than to the wind's sea: it comes at her as a few
    // steep waves all from one side.
    const wakes = stage.wakes;
    const wakeRoll = Math.atan2(wakes.height(x + fz * 1.4, -(z - fx * 1.4)) - wakes.height(x - fz * 1.4, -(z + fx * 1.4)), 2.8) * 0.6;
    motion.heave += ((hBow + hStern + 2 * hMid) / 4 - motion.heave) * ease;
    motion.pitch += (Math.atan2(hBow - hStern, half * 2) * 0.8 - motion.pitch) * ease;
    motion.roll += (Math.atan2(hPort - hStbd, 2.8) * 0.5 + wakeRoll - motion.roll) * ease;

    // A slam is shown as her bow comes down off the wave she can be seen on: the sim says she slammed, the picture
    // says when. Then a shudder through the hull for half a second, and the thump.
    const seaway = this.seaway;
    if (!paused) {
      if (seaway.pendingSlam > 0) {
        motion.wait += dtReal;
        if (motion.pitch < motion.lastPitch - 1e-5 && motion.pitch < 0.01 || motion.wait > 1.5) {
          motion.shudder = seaway.pendingSlam;
          motion.shudderAge = 0;
          motion.wait = 0;
          seaway.pendingSlam = 0;
          this.sound.thud(0.35 + 0.5 * motion.shudder);
          drone.shake(0.25 + 0.35 * motion.shudder);
          seaway.emit('slam', motion.shudder);
        }
      }
      motion.lastPitch = motion.pitch;
      motion.shudderAge += dtReal;
      // Surfing, she carries her bow down and the water hisses past.
      motion.surf += (seaway.surf - motion.surf) * Math.min(1, dtReal * 3);
    }
    const ring = motion.shudderAge < 0.7 ? motion.shudder * Math.exp(-motion.shudderAge / 0.16) : 0;
    const shake = ring * Math.cos(motion.shudderAge * 44);

    const pose: BoatPose = {
      x, z, heading,
      heel: mix(before.heel, after.heel, alpha) + motion.roll + shake * 0.006,
      pitch: motion.pitch - ring * 0.035 - shake * 0.008 - motion.surf * 0.045,
      heave: motion.heave - 0.03 - ring * 0.07,
      rudder: mix(before.rudder, after.rudder, alpha),
      boom: mix(before.boomAngle, after.boomAngle, alpha),
      jib: mix(before.jibAngle, after.jibAngle, alpha),
    };
    // Read here, after the steps: joining or leaving a one-design race changes the boat.
    const boatView = this.boatView;
    boatView.update(pose, sim.state, sim.out, seaTime, paused ? 0 : dtReal);
    boatView.root.updateMatrixWorld(true);

    // Draw the other boats, tell them where this one is, and keep to the furthest-on clock.
    const clockBehind = fleet.update(sim, world.seasonTime(sim.state.t), seaTime, stage.waves, dtReal, drone.camera, window.innerWidth, window.innerHeight);
    this.race.draw(seaTime, stage.waves, dtReal, drone.camera, window.innerWidth, window.innerHeight);
    this.fleetPanel.update(dtReal);
    // Just arrived among boats already out: take up their clock, whichever way it differs, and say so.
    // One wind for everyone on the water: the hardest blow anyone brought with them.
    for (const b of fleet.boats) if (b.windBoost > world.windBoost) world.windBoost = b.windBoost;
    if (fleet.adoptClock !== null) {
      world.startOffset += fleet.adoptClock - world.seasonTime(sim.state.t);
      fleet.adoptClock = null;
      const time = world.dateAt(sim.state.t).toLocaleTimeString('en-GB', { timeZone: stage.course.timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
      hud.raiseAlarm(`Other boats are out. You have joined their time of day: ${time}`, 7);
    }
    if (this.sharing) {
      this.paused = false;
      if (this.rateIndex !== 0) { this.rateIndex = 0; hud.setRate(0); }
      if (clockBehind > 1.5) world.shiftTime(clockBehind);
    }
    // The replay runs out of weather eventually. The day comes round again rather than freezing in the dark.
    if (world.wrapSeason(sim.state.t)) this.alarm('End of the recorded weather. The same day starts over.');

    seaway.update(dtReal, away ? away.x : sim.state.x, away ? away.y : sim.state.y);
    for (const f of this.features) f.update?.(dtReal, seaTime);
    if (away) this.boatPos.set(away.x, away.height, -away.y);
    else this.boatPos.set(x, pose.heave, z);
    drone.update(dtReal, this.boatPos, away ? away.heading : heading, (px, pz) => stage.seaLevel(px, pz, seaTime), boatView.solids, boatView.thin);

    const stream = world.current(sim.state.x, sim.state.y, sim.state.t);
    hud.update(sim.state, sim.out, {
      set: Math.atan2(stream.x, stream.y),
      drift: Math.hypot(stream.x, stream.y),
      height: world.tide(sim.state.t),
      rate: world.tideRate(sim.state.t),
      depth: sim.out.underKeel === null ? null : sim.out.underKeel + this.spec.dimensions.draft,
    }, world.dateAt(sim.state.t), stage.course.timeZone, paused, rate, dtReal, fleet.boats.length);
    const gust = this.gusts.update(paused ? 0 : dtReal);
    if (gust.alert) this.alarm(gust.alert);
    const doing = this.status();
    // In bad air the line says so for as long as it lasts, beside any gust on the way.
    const lostKt = Math.round((sim.out.tws / this.air.factor - sim.out.tws) / KT);
    // The sea in words goes with the wind's: what the water is doing, then what the air is.
    const wakeLine = seaway.wake.height > 0.15 && !away ? (seaway.slatting ? 'sails slatting in a wake' : "ship's wake") : '';
    const airLine = [seaway.words, wakeLine, this.air.factor < 0.93 && lostKt >= 1 ? `bad air, ${lostKt} kt down` : '', gust.line].filter(Boolean).join(' · ');
    if (doing) hud.setSail(doing, '', airLine);
    else hud.setSail(pointOfSail(sim.out.twa, sim.out.inIrons), sim.out.inIrons ? '' : ` · ${sim.out.twa >= 0 ? 'starboard' : 'port'} tack`, airLine);
    hud.setPilot(pilot.line());
    this.race.note = pilot.raceNote();
    this.hints.update(paused ? 0 : dtReal);
    this.opts.logbook.update(dtReal);
    boatView.setPilot({ engaged: pilot.engaged, mode: pilot.mode, label: pilot.label() });
    chart.update(dtReal);
    this.coach?.update(dtReal);
    const o = sim.out;
    const loose = Math.max(o.main.luff * 0.7 + (o.main.flogging ? 0.3 : 0), sim.state.spin ? (o.spin.flogging ? 1 : o.spin.luff * 0.6) : sim.state.furl > 0.03 ? o.jib.luff * 0.7 + (o.jib.flogging ? 0.3 : 0) : 0);
    this.sound.update(o.aws / KT, sim.state.speed / KT + motion.surf * 3, loose, paused);

    stage.frame(dtReal, rate, sim.state.t, seaTime, drone.camera, { x, z, heading, speed: sim.state.speed, heel: pose.heel, hulls: boatView.rig.hullOffset }, this.everyoneElse(), o.tws / KT, chart.isOpen);
  }

  /** A short account of the boat and the conditions, for attaching to feedback. */
  report(): Record<string, unknown> {
    const s = this.sim.state;
    const o = this.sim.out;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      boat: this.spec.id,
      clock: this.stage.world.dateAt(s.t).toISOString(),
      minutesSailed: Math.round(s.t / 60),
      x: Math.round(s.x), y: Math.round(s.y),
      headingDeg: Math.round(s.heading * R2D), speedKt: r1(o.sog / KT), heelDeg: Math.round(s.heel * R2D),
      windKt: r1(o.tws / KT), windFromDeg: Math.round(o.twd * R2D), windAngleDeg: Math.round(o.twa * R2D),
      helm: s.helmMode, crewTrim: s.crewTrim, reef: s.reef,
      aground: o.aground, sea: this.seaway.words, slams: s.slams, knockdowns: s.knockdowns, hullDamage: Math.round(s.damage * 100), windShadow: Math.round((1 - this.air.factor) * 100), boatsInCompany: this.fleet.boats.length,
      screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    };
  }

  /** Handles for play testing from the browser console. */
  debug(): Record<string, unknown> {
    const session = this;
    return {
      // Read each time: she may have changed boats for a race.
      get boatView() { return session.boatView; },
      get spec() { return session.spec; },
      scene: this.stage.scene, traffic: this.stage.traffic, renderer: this.stage.renderer, world: this.stage.world,
      sim: this.sim, air: this.air, seaway: this.seaway, passage: this.passage, chart: this.chart, pilot: this.pilot, fleet: this.fleet, drone: this.drone,
      coach: this.coach, hints: this.hints, gusts: this.gusts, race: this.race, fleetPanel: this.fleetPanel, features: this.features, views: VIEWS, setPaused: (p: boolean) => { this.paused = p; },
      stage: this.stage, setRate: (index: number) => { this.rateIndex = index; this.hud.setRate(index); },
    };
  }
}
