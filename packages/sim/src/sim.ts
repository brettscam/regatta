import { D2R, R2D, KT, clamp, lerp, wrapPi, wrapTau, smoothstep, approach, interp1 } from './math';
import { polarSpeed } from './polar';
import type { BoatSpec, ControlName, EngineSpec, Environment, HelmMode, SailReport, SimOutputs, SimState } from './types';

/** Fixed step. The sim never takes any other step size. */
export const SIM_DT = 1 / 60;

const AIR_DENSITY = 1.225;
const BOOM_SLEW = 80 * D2R; // rad/s, how fast the boom swings across
const JIB_SLEW = 110 * D2R;
const HAND_RUDDER_RATE = 70 * D2R; // rad/s, hands on the wheel
const PILOT_RUDDER_RATE = 28 * D2R;
const JIB_FREE_MAX = 85 * D2R;
/** True wind, knots, below which no boat is overpowered by the wind alone, and by which the full effect is felt. */
const GUST_FROM = 17;
const GUST_FULL = 21;
/** Degrees of heel for each degree of load beyond what she can carry: past the limit she goes over fast. */
const OVERPOWER_GAIN = 4;
/** Heel load, degrees, at which she is past saving. Held there for a second, she is knocked down. */
const KNOCKDOWN_LOAD = 52;
/** Extra heel for every knot of true wind over the spinnaker's limit, before the gain above. */
const SPIN_OVER_PER_KT = 2.2;
/** The most the crew will let the main out beyond its best setting to spill a gust. Past this it is time to reef. */
const GUST_EASE_MAX = 11 * D2R;

/**
 * The engine's throttle positions, from full astern to full ahead. `speed` is the share of her cruising speed under
 * power that the position gives in flat water with no wind, `burn` the share of her cruising fuel burn, `rpm` what the
 * rev counter shows. Cruise is the position the boat's figures are quoted at; full ahead buys little for a lot of fuel.
 */
export const THROTTLE = [
  { notch: -2, name: 'Astern full', speed: -0.45, burn: 0.8, rpm: 2300 },
  { notch: -1, name: 'Astern slow', speed: -0.25, burn: 0.3, rpm: 1300 },
  { notch: 0, name: 'Neutral', speed: 0, burn: 0.14, rpm: 850 },
  { notch: 1, name: 'Ahead slow', speed: 0.4, burn: 0.24, rpm: 1300 },
  { notch: 2, name: 'Ahead half', speed: 0.72, burn: 0.52, rpm: 1900 },
  { notch: 3, name: 'Ahead cruise', speed: 1, burn: 1, rpm: 2600 },
  { notch: 4, name: 'Ahead full', speed: 1.07, burn: 1.75, rpm: 3200 },
] as const;
export const THROTTLE_MIN = -2;
export const THROTTLE_MAX = 4;
/** Seconds of cranking before the engine fires. */
export const CRANK_SECONDS = 1.6;
/** Amps the instruments draw whenever she is under way, and what the autopilot adds while it steers. */
const INSTRUMENT_AMPS = 1.2;
const PILOT_AMPS = 3.6;
const CRANK_AMPS = 160;
/** Share of the battery below which the autopilot drops out, and below which the starter will not turn the engine. */
export const BATTERY_PILOT_MIN = 0.1;
export const BATTERY_START_MIN = 0.04;
/** How much of the propeller's race reaches the rudder: what lets her steer with no way on. */
const PROP_WASH = 0.75;
/** Going astern the rudder has this share of its usual bite, and the propeller walks the stern to port. */
const ASTERN_BITE = 0.45;
const PROP_WALK = 2.2 * D2R;
/** How far a light air stretches, and a blow shrinks, the time a boat with `handling.carryAwsKt` carries her way. */
const CARRY_LEAST = 0.75;
const CARRY_MOST = 2.6;

/** Best boom angle in degrees for an apparent wind angle in degrees. */
export function idealBoomDeg(awaDeg: number): number {
  return clamp(0.62 * awaDeg - 14, 4, 82);
}

/** Best jib clew angle in degrees for an apparent wind angle in degrees. */
export function idealJibDeg(awaDeg: number): number {
  return clamp(0.5 * awaDeg - 6, 8, 70);
}

/** Best spinnaker clew angle in degrees for an apparent wind angle in degrees. */
export function idealSpinDeg(awaDeg: number): number {
  return clamp(0.55 * awaDeg - 8, 14, 80);
}

/**
 * Drive efficiency for a trim error in degrees.
 * Positive error is eased too far (the sail luffs and loses drive quickly).
 * Negative error is sheeted too hard (the sail stalls and loses drive slowly).
 */
export function trimEfficiency(errDeg: number): number {
  if (errDeg > 3) return Math.max(0.05, 1 - Math.pow((errDeg - 3) / 20, 1.2));
  if (errDeg < -5) return Math.max(0.5, 1 - ((-errDeg - 5) / 70) * 0.9);
  return 1;
}

/** Side-force multiplier for heel. An over-sheeted sail heels the boat more, a luffing one less. */
function heelTrim(report: SailReport): number {
  if (report.flogging) return 0.05;
  if (report.backed > 0) return lerp(report.eff, 1, report.backed);
  if (report.errDeg < -5) return 1 + Math.min(0.35, (-report.errDeg - 5) / 60);
  return report.eff;
}

function emptySail(): SailReport {
  return { eff: 0, luff: 0, stall: 0, flogging: false, backed: 0, loadKg: 0, errDeg: 0 };
}

export interface InitialConditions {
  x?: number;
  y?: number;
  /** Compass heading in degrees. */
  headingDeg?: number;
  speedKt?: number;
  reef?: number;
  furl?: number;
}

export function initialState(init: InitialConditions = {}): SimState {
  return {
    t: 0,
    tick: 0,
    x: init.x ?? 0,
    y: init.y ?? 0,
    heading: wrapTau((init.headingDeg ?? 0) * D2R),
    yawRate: 0,
    speed: (init.speedKt ?? 0) * KT,
    lateral: 0,
    heel: 0,
    rudder: 0,
    rudderCmd: 0,
    mainSheet: 30 * D2R,
    jibSheetPort: 80 * D2R,
    jibSheetStbd: 80 * D2R,
    furl: init.furl ?? 1,
    reef: init.reef ?? 0,
    boomAngle: 0,
    jibAngle: 0,
    mainSide: 1,
    helmMode: 'hand',
    helmTarget: 0,
    helmIntegral: 0,
    crewTrim: false,
    routeX: 0,
    routeY: 0,
    routeFromX: 0,
    routeFromY: 0,
    routeCrab: 0,
    routeTurnAt: -1e9,
    routeTurns: 0,
    overpowered: 0,
    pilotTrips: 0,
    knock: 0,
    knockHold: 0,
    crashGybes: 0,
    knockdowns: 0,
    capsizes: 0,
    hold: 'none',
    holdX: 0,
    holdY: 0,
    holdScope: 0,
    spin: false,
    spinHoist: 0,
    spinSheet: 60 * D2R,
    spinAngle: 0,
    spinCollapse: 0,
    spinWrapped: false,
    spinWraps: 0,
    broaches: 0,
    gustTime: 0,
    gustEase: 0,
    engineOn: false,
    engineCrank: 0,
    throttle: 0,
    fuelUsed: 0,
    batteryUsed: 0,
    engineStops: 0,
    batteryTrips: 0,
    damage: 0,
    maneuver: null,
  };
}

/** The most a damaged hull takes off her speed, as a share, just short of holed. */
export const DAMAGE_DRAG = 0.3;

/**
 * What hull damage leaves of her speed: 1 when sound, falling in a straight line to 0.7 as the damage nears 1, and 0 holed.
 * @param damage 0 sound to 1 holed
 */
export function damageSpeed(damage: number): number {
  if (!(damage > 0)) return 1;
  return damage >= 1 ? 0 : 1 - DAMAGE_DRAG * damage;
}

/**
 * Phase 1 sailing model: polar-driven speed with trim, heel, leeway and helm layered on.
 * Deterministic. The same boat, environment, starting state and commands always give the same track.
 */
export class Sim {
  readonly dt = SIM_DT;
  state: SimState;
  out: SimOutputs;

  constructor(
    public boat: BoatSpec,
    public env: Environment,
    init: InitialConditions | SimState = {},
  ) {
    this.state = 'tick' in init ? structuredCloneState(init) : initialState(init);
    this.out = this.blankOutputs();
    this.settleSails();
  }

  /**
   * Put her in a different boat without stopping: a race sailed in one class. Where she is and how she is moving carry over.
   * Anything set beyond what the new boat allows comes inside her limits.
   */
  setBoat(boat: BoatSpec): void {
    this.boat = boat;
    const s = this.state;
    s.reef = clamp(s.reef, 0, boat.sails.main.reefs.length - 1);
    for (const name of ['mainsheet', 'jibsheet_port', 'jibsheet_stbd'] as const) this.setControl(name, this.getControl(name));
    const maxRudder = boat.helm.maxRudderDeg * D2R;
    s.rudderCmd = clamp(s.rudderCmd, -maxRudder, maxRudder);
    if (!boat.sails.spinnaker) { s.spin = false; s.spinHoist = 0; }
    this.setControl('spinsheet', s.spinSheet);
    if (!boat.engine) { s.engineOn = false; s.engineCrank = 0; s.throttle = 0; }
    this.engineReadout();
  }

  // ---- engine ---------------------------------------------------------------------------------

  /** Litres of fuel left in the tank. */
  get fuel(): number {
    const e = this.boat.engine;
    return e ? clamp(e.tankL - this.state.fuelUsed, 0, e.tankL) : 0;
  }

  /** Battery charge, 0 flat to 1 full. */
  get battery(): number {
    const e = this.boat.engine;
    return e ? clamp(1 - this.state.batteryUsed / e.batteryAh, 0, 1) : 1;
  }

  /**
   * Turn the key. The starter cranks for a second or two and then she runs, in neutral.
   * `none` means she has no engine, `dry` an empty tank, `flat` a battery too low to turn her over.
   * Starting is allowed at anchor or made fast, ready to leave.
   */
  startEngine(): 'cranking' | 'running' | 'none' | 'dry' | 'flat' {
    const s = this.state;
    if (!this.boat.engine) return 'none';
    if (s.engineOn) return 'running';
    if (s.engineCrank > 0) return 'cranking';
    if (this.fuel <= 0) return 'dry';
    if (this.battery <= BATTERY_START_MIN) return 'flat';
    s.engineCrank = CRANK_SECONDS;
    s.throttle = 0;
    return 'cranking';
  }

  stopEngine(): void {
    const s = this.state;
    s.engineOn = false;
    s.engineCrank = 0;
    s.throttle = 0;
    this.engineReadout();
  }

  /**
   * Move the throttle to a position, `THROTTLE_MIN` full astern to `THROTTLE_MAX` full ahead, 0 neutral.
   * `off` means the engine is not running, `held` that she is at anchor or made fast and cannot be put in gear.
   */
  setThrottle(notch: number): 'ok' | 'off' | 'held' {
    const s = this.state;
    if (!s.engineOn) return 'off';
    if (s.hold !== 'none') {
      s.throttle = 0;
      return 'held';
    }
    s.throttle = clamp(Math.round(notch), THROTTLE_MIN, THROTTLE_MAX);
    this.engineReadout();
    return 'ok';
  }

  /** Fill the tank and charge the battery: alongside a dock, or at the start of a sail. */
  provision(): void {
    this.state.fuelUsed = 0;
    this.state.batteryUsed = 0;
    this.engineReadout();
  }

  /** True while the engine is running and in gear, ahead or astern. */
  get underPower(): boolean {
    return this.state.engineOn && this.state.throttle !== 0;
  }

  private notch() {
    return THROTTLE[clamp(Math.round(this.state.throttle), THROTTLE_MIN, THROTTLE_MAX) - THROTTLE_MIN];
  }

  private engineReadout(): void {
    const s = this.state;
    const o = this.out;
    o.fuel = this.fuel;
    o.battery = this.battery;
    o.underPower = this.underPower;
    o.engineRpm = s.engineOn ? this.notch().rpm : s.engineCrank > 0 ? 250 : 0;
  }

  /** One step of the engine, the tank and the battery. Runs whether she is sailing or held. */
  private stepEngine(e: EngineSpec): void {
    const s = this.state;
    const dt = this.dt;
    let amps = 0;
    // The instruments and the pilot run off the battery while she is under way. Made fast, everything is switched off.
    if (s.hold === 'none') amps -= INSTRUMENT_AMPS + (s.helmMode !== 'hand' ? PILOT_AMPS : 0);
    if (s.engineCrank > 0) {
      amps -= CRANK_AMPS;
      s.engineCrank -= dt;
      if (s.engineCrank <= 0) {
        s.engineCrank = 0;
        s.engineOn = true;
        s.throttle = 0;
      }
    }
    if (s.engineOn) {
      const n = this.notch();
      s.fuelUsed += (e.burnLph * n.burn * dt) / 3600;
      // The alternator gives about half its output at idle and all of it at cruising revs.
      amps += e.alternatorA * clamp(n.rpm / 2600, 0.45, 1);
      if (s.fuelUsed >= e.tankL) {
        s.fuelUsed = e.tankL;
        s.engineOn = false;
        s.throttle = 0;
        s.engineStops++;
      }
    }
    s.batteryUsed = clamp(s.batteryUsed - (amps * dt) / 3600, 0, e.batteryAh);
    // Too little left to drive the pilot's ram: it lets go and the wheel is hers again.
    if (s.helmMode !== 'hand' && !s.engineOn && s.batteryUsed >= e.batteryAh * (1 - BATTERY_PILOT_MIN)) {
      s.helmMode = 'hand';
      s.maneuver = null;
      s.batteryTrips++;
    }
    this.engineReadout();
  }

  /**
   * The speed the engine alone would hold her at just now, m/s, negative astern. 0 out of gear.
   * The propeller's push is fixed by the throttle. The wind on hull and rig, and the sea it brings, take from it by
   * the square of the wind from ahead, so into a hard head wind she makes far less than her flat-water speed.
   */
  private engineSpeed(): number {
    const e = this.boat.engine;
    if (!e || !this.underPower) return 0;
    const o = this.out;
    const v0 = e.cruiseKt * KT * this.notch().speed;
    const head = o.aws * Math.cos(o.awa);
    let wind = e.windage * head * Math.abs(head);
    // Wind from astern helps much less than wind from ahead hurts.
    if ((wind < 0) === (v0 > 0)) wind *= 0.35;
    const v2 = v0 * Math.abs(v0) - wind;
    return clamp(Math.sign(v2) * Math.sqrt(Math.abs(v2)), -2, 6);
  }

  // ---- controls -------------------------------------------------------------------------------

  controlRange(name: ControlName): { min: number; max: number } {
    const b = this.boat;
    switch (name) {
      case 'rudder': return { min: -b.helm.maxRudderDeg * D2R, max: b.helm.maxRudderDeg * D2R };
      case 'mainsheet': return { min: b.sails.main.sheetMinDeg * D2R, max: b.sails.main.sheetMaxDeg * D2R };
      case 'jibsheet_port':
      case 'jibsheet_stbd': return { min: 0, max: b.sails.jib.sheetMaxSlackDeg * D2R };
      case 'furl': return { min: 0, max: 1 };
      case 'reef': return { min: 0, max: b.sails.main.reefs.length - 1 };
      case 'pilot': return { min: -Math.PI * 2, max: Math.PI * 4 };
      case 'spinsheet': return { min: (b.sails.spinnaker?.sheetMinDeg ?? 22) * D2R, max: (b.sails.spinnaker?.sheetMaxDeg ?? 88) * D2R };
    }
  }

  getControl(name: ControlName): number {
    const s = this.state;
    switch (name) {
      case 'rudder': return s.rudderCmd;
      case 'mainsheet': return s.mainSheet;
      case 'jibsheet_port': return s.jibSheetPort;
      case 'jibsheet_stbd': return s.jibSheetStbd;
      case 'furl': return s.furl;
      case 'reef': return s.reef;
      case 'pilot': return s.helmTarget;
      case 'spinsheet': return s.spinSheet;
    }
  }

  /** Set a control to an absolute value. Any hand on the wheel takes the helm back from the pilot. */
  setControl(name: ControlName, value: number): void {
    const s = this.state;
    const r = this.controlRange(name);
    const v = clamp(value, r.min, r.max);
    switch (name) {
      case 'rudder':
        s.rudderCmd = v;
        if (s.maneuver) s.maneuver = null;
        s.helmMode = 'hand';
        break;
      case 'mainsheet': s.mainSheet = v; break;
      case 'jibsheet_port':
      case 'jibsheet_stbd':
        // A self-tacking jib has one sheet: either winch works it.
        if (name === 'jibsheet_port' || this.boat.sails.jib.selfTacking) s.jibSheetPort = v;
        if (name === 'jibsheet_stbd' || this.boat.sails.jib.selfTacking) s.jibSheetStbd = v;
        break;
      case 'furl': s.furl = v; break;
      case 'reef': s.reef = Math.round(v); break;
      case 'pilot':
        // The pilot's dial: the heading it holds, or the wind angle. It does nothing while steering a route.
        if (s.helmMode === 'heading') s.helmTarget = wrapTau(v);
        else if (s.helmMode === 'wind') s.helmTarget = clamp(wrapPi(v), -175 * D2R, 175 * D2R);
        s.helmIntegral = 0;
        break;
      case 'spinsheet': s.spinSheet = v; break;
    }
  }

  nudgeControl(name: ControlName, delta: number): void {
    this.setControl(name, this.getControl(name) + delta);
  }

  /** Which jib sheet is to leeward right now. */
  workingJibSheet(): 'jibsheet_port' | 'jibsheet_stbd' {
    return this.out.awa >= 0 ? 'jibsheet_port' : 'jibsheet_stbd';
  }

  /** Which jib sheet is carrying load: the windward one when the jib is aback, otherwise the leeward one. */
  loadedJibSheet(): 'jibsheet_port' | 'jibsheet_stbd' {
    const working = this.workingJibSheet();
    if (this.out.jib.backed > 0.3) return working === 'jibsheet_port' ? 'jibsheet_stbd' : 'jibsheet_port';
    return working;
  }

  /** True while the spinnaker is up or on its way up or down. */
  get spinnakerUp(): boolean {
    return this.state.spin || this.state.spinHoist > 0;
  }

  /**
   * Hoist the spinnaker or take it down. With no argument, whichever it is not.
   * It only goes up with the wind well aft: `forward` means it was refused because the wind is too far ahead,
   * `none` that she has no spinnaker, `held` that she is at anchor or made fast.
   */
  setSpinnaker(up: boolean = !this.state.spin): 'set' | 'doused' | 'forward' | 'none' | 'held' {
    const s = this.state;
    const sp = this.boat.sails.spinnaker;
    if (!up) {
      s.spin = false;
      return 'doused';
    }
    if (!sp) return 'none';
    if (s.hold !== 'none') return 'held';
    this.computeWind();
    if (Math.abs(this.out.twa) < sp.minTwaDeg * D2R) return 'forward';
    s.spin = true;
    s.spinWrapped = false;
    s.spinCollapse = 0;
    this.setControl('spinsheet', idealSpinDeg(Math.abs(this.out.awa) * R2D) * D2R);
    return 'set';
  }

  /** Hand the helm to the pilot, holding the current heading or wind angle unless a target is given. */
  setHelm(mode: HelmMode, target?: number): void {
    const s = this.state;
    s.maneuver = null;
    s.helmMode = mode;
    s.helmIntegral = 0;
    s.overpowered = 0;
    if (mode === 'heading') s.helmTarget = target ?? s.heading;
    else if (mode === 'wind') s.helmTarget = target ?? this.out.twa;
    else if (mode === 'route') this.setRoute({ x: s.routeX, y: s.routeY });
    else s.rudderCmd = target ?? s.rudderCmd;
  }

  /**
   * Hand the helm to the pilot to steer for a mark. It points at the mark when it can, allowing for the tide.
   * When the mark is to windward it sails close-hauled and tacks when the mark can be laid, or when the water shoals.
   */
  setRoute(to: { x: number; y: number }, from?: { x: number; y: number }): void {
    const s = this.state;
    s.maneuver = null;
    s.helmMode = 'route';
    s.helmIntegral = 0;
    s.overpowered = 0;
    s.routeX = to.x;
    s.routeY = to.y;
    s.routeFromX = from?.x ?? s.x;
    s.routeFromY = from?.y ?? s.y;
  }

  /** Turn the crew's sail trimming on or off. With the pilot steering, this is the boat sailing herself. */
  setCrewTrim(on: boolean): void {
    this.state.crewTrim = on;
  }

  /** Begin a turn through the wind to a new heading, with the crew handling the sheets. */
  private turnTo(targetHeading: number): void {
    const s = this.state;
    s.maneuver = {
      kind: Math.abs(this.out.twa) < Math.PI / 2 ? 'tack' : 'gybe',
      targetHeading: wrapTau(targetHeading),
      fromSide: this.out.awa >= 0 ? 1 : -1,
      swapped: false,
      prevMode: s.helmMode,
      prevTarget: s.helmTarget,
      elapsed: 0,
    };
    s.helmIntegral = 0;
  }

  /**
   * The pilot's steering error in route mode, radians: positive means turn to starboard.
   * May start a tack or gybe of its own.
   */
  private routeError(): number {
    const s = this.state;
    const o = this.out;
    const CLOSE = (this.boat.handling?.closeHauledDeg ?? 44) * D2R;
    const dx = s.routeX - s.x;
    const dy = s.routeY - s.y;
    // Crab across the tide and leeway: learn the angle between where she points and where she goes.
    if (o.sog > 1) s.routeCrab += (clamp(wrapPi(s.heading - o.cog), -0.5, 0.5) - s.routeCrab) * (1 - Math.exp(-this.dt / 8));
    const desired = Math.atan2(dx, dy) + s.routeCrab;
    const twaDirect = wrapPi(o.twd - desired);
    const side = o.twa >= 0 ? 1 : -1;
    const rested = s.t - s.routeTurnAt > (this.boat.handling?.pilotRestS ?? 25);
    const depthAt = (heading: number, metres: number): number =>
      this.env.sample(s.x + Math.sin(heading) * metres, s.y + Math.cos(heading) * metres, s.t).depth ?? Infinity;

    // Under power ahead she can go straight at a mark to windward.
    const motoring = this.underPower && s.throttle > 0;
    // A boat that says how long she needs between turns cannot simply be spun through the wind: she is steered warily.
    const wary = this.boat.handling?.pilotRestS !== undefined && !motoring;
    // A sloop's pilot sounds one point ahead. A wary one sounds every 35 m on the way there, so a rock or a point of
    // land narrower than the look-ahead is not stepped over.
    const depthAhead = !wary ? depthAt : (heading: number, metres: number): number => {
      let least = Infinity;
      for (let d = metres; d > 1; d -= 35) least = Math.min(least, depthAt(heading, d));
      return least;
    };
    o.pilotBeating = Math.abs(twaDirect) < CLOSE && !motoring;
    if (!o.pilotBeating) {
      // The mark can be pointed at. If that means putting the wind on the other side, tack or gybe for it.
      const newSide = twaDirect >= 0 ? 1 : -1;
      if (newSide !== side && Math.abs(o.twa) > 8 * D2R && Math.abs(o.twa) < 172 * D2R && !(motoring && Math.abs(twaDirect) < CLOSE)) {
        // Steered warily, she does not turn for the mark while the shore lies close on that heading.
        const draft = this.boat.dimensions.draft;
        if (rested && !(wary && (depthAhead(desired, 140) < draft + 2 || depthAhead(desired, 280) < draft + 1))) {
          s.routeTurnAt = s.t;
          s.routeTurns++;
          this.turnTo(desired);
          return wrapPi(desired - s.heading);
        }
        // Not yet rested from her last turn. A sloop is steered for the mark all the same and comes through the wind
        // on her way. A boat that says how long she needs between turns holds the tack she is on until then.
        if (wary && Math.abs(o.twa) < Math.PI / 2) return wrapPi(o.twa - side * (CLOSE - D2R));
      }
      // Fetching the mark with the shore in the way: she short-tacks off it as she would when beating.
      if (wary && Math.abs(o.twa) < 80 * D2R) {
        const off = this.shoalTack(side, CLOSE, depthAhead, true);
        if (off !== null) return off;
      }
      return wrapPi(desired - s.heading);
    }
    // The mark is to windward: sail close-hauled on this tack until it can be laid on the other one.
    // Short-tack off a shoal rather than run up it.
    const off = this.shoalTack(side, CLOSE, depthAhead, wary);
    if (off !== null) return off;
    return wrapPi(o.twa - side * (CLOSE - D2R));
  }

  /**
   * The route pilot's answer to shoal water ahead: tack onto the other board if that one is clear.
   * @param wary true for a boat steered warily, see `HandlingSpec.pilotRestS`
   * @returns the steering error for the new tack, or null when she carries on as she is
   */
  private shoalTack(side: number, close: number, depthAhead: (heading: number, metres: number) => number, wary: boolean): number | null {
    const s = this.state;
    const draft = this.boat.dimensions.draft;
    // A wary pilot sounds more points, so it does it four times a second, not sixty. Its boat is tacked by her crew
    // holding the jib aback, which works with less way on than a sloop needs.
    if (wary && s.tick % 15 !== 0) return null;
    const shoal = (way: number) => depthAhead(way, 140) < draft + 2 || depthAhead(way, 280) < draft + 1;
    // It also sounds along the way she is really going, which the tide and her leeway may have set well off her
    // heading, and a little either side of that for a corner she would only just clear.
    const track = this.out.cog;
    const set = wary && this.out.sog > 0.5 && (shoal(track) || depthAhead(track - 0.21, 140) < draft + 2 || depthAhead(track + 0.21, 140) < draft + 2);
    if (!(s.t - s.routeTurnAt > 25 && s.speed > (wary ? 0.6 : 1.2) && (shoal(s.heading) || set))) return null;
    const other = wrapTau(this.out.twd + side * close);
    if (!(depthAhead(other, 200) > draft + 2)) return null;
    s.routeTurnAt = s.t;
    s.routeTurns++;
    this.turnTo(other);
    return wrapPi(other - s.heading);
  }

  /**
   * Tack or gybe to the mirror-image wind angle. The crew swaps the jib sheets as the wind crosses the bow or stern.
   * Returns which one it was. With the spinnaker up there is no tacking: it has to come down first, and `spinnaker` says so.
   */
  tack(): 'tack' | 'gybe' | 'spinnaker' {
    const s = this.state;
    const twa = this.out.twa;
    const kind = Math.abs(twa) < Math.PI / 2 ? 'tack' : 'gybe';
    if (kind === 'tack' && this.spinnakerUp) return 'spinnaker';
    // Never aim closer than 38 degrees to the wind (six inside the pilot's close-hauled angle), so a tack begun in irons still ends up sailing.
    const mag = clamp(Math.abs(twa), ((this.boat.handling?.closeHauledDeg ?? 44) - 6) * D2R, 178 * D2R);
    const side = twa >= 0 ? 1 : -1;
    const targetHeading = wrapTau(this.out.twd + side * mag);
    s.maneuver = {
      kind,
      targetHeading,
      fromSide: this.out.awa >= 0 ? 1 : -1,
      swapped: false,
      prevMode: s.helmMode,
      prevTarget: s.helmTarget,
      elapsed: 0,
    };
    s.helmIntegral = 0;
    return kind;
  }

  // ---- pushed from outside ---------------------------------------------------------------------

  /**
   * A push from outside the sim: another hull. She is moved bodily, her velocity through the water changes (both given
   * east and north), and her head may be knocked round. Nothing else is touched, so the next step carries on from
   * where this leaves her.
   * @param dx metres east
   * @param dy metres north
   * @param dvx change of velocity, m/s east
   * @param dvy change of velocity, m/s north
   * @param turn change of heading, radians, positive to starboard. Her velocity keeps its direction over the water.
   */
  shove(dx: number, dy: number, dvx = 0, dvy = 0, turn = 0): void {
    if (!Number.isFinite(dx + dy + dvx + dvy + turn)) return;
    const s = this.state;
    s.x += dx;
    s.y += dy;
    // Her velocity over the water, east and north, with the push added. It is put back on her new heading.
    let sinH = Math.sin(s.heading);
    let cosH = Math.cos(s.heading);
    const vx = s.speed * sinH + s.lateral * cosH + dvx;
    const vy = s.speed * cosH - s.lateral * sinH + dvy;
    if (turn !== 0) {
      s.heading = wrapTau(s.heading + turn);
      sinH = Math.sin(s.heading);
      cosH = Math.cos(s.heading);
    }
    s.speed = vx * sinH + vy * cosH;
    s.lateral = vx * cosH - vy * sinH;
  }

  // ---- stepping -------------------------------------------------------------------------------

  /** Advance by whole fixed steps covering at least `seconds`. */
  advance(seconds: number): void {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n; i++) this.step();
  }

  step(): void {
    const s = this.state;
    const b = this.boat;
    const dt = this.dt;
    const o = this.out;

    this.computeWind();
    if (b.engine) this.stepEngine(b.engine);
    if (s.hold !== 'none') return this.stepHeld();
    const windSide = o.awa >= 0 ? 1 : -1;
    const awaAbs = Math.abs(o.awa);
    const awsKt = o.aws / KT;

    // --- maneuver and crew ---------------------------------------------------------------------
    const m = s.maneuver;
    if (m) {
      m.elapsed += dt;
      if (!m.swapped && windSide !== m.fromSide) {
        const p = s.jibSheetPort;
        s.jibSheetPort = s.jibSheetStbd;
        s.jibSheetStbd = p;
        m.swapped = true;
      }
    }
    if (s.crewTrim) this.crewTrim(awaAbs, windSide, dt);

    // --- sails ---------------------------------------------------------------------------------
    this.computeSails(windSide, awaAbs, true);
    // How much of the spinnaker is up and working. Nothing below changes while this is 0.
    const flying = this.computeSpin(windSide, awaAbs, true);
    const kite = flying > 0 ? b.sails.spinnaker : undefined;
    // Under the spinnaker the jib is rolled away and the spinnaker does the headsail's work.
    const furl = kite ? lerp(s.furl, 1, flying) : s.furl;
    // Rolled away, the jib has nothing to report: it is not luffing, stalled or aback.
    if (kite && flying >= 1) Object.assign(o.jib, emptySail());

    const reef = b.sails.main.reefs[s.reef];
    const twaDeg = Math.abs(o.twa) * R2D;
    const twsKt = o.tws / KT;
    const jibShare = 0.5 * furl;
    const mainShare = 1 - jibShare;
    const headDrive = 0.25 + 0.75 * furl;
    const twsEff = twsKt * Math.sqrt(0.5 * reef.drive + 0.5 * headDrive);
    // The jib is blanketed by the main on a deep run.
    const blanket = twaDeg <= 110 ? 1 : lerp(1, 0.8, clamp((twaDeg - 110) / 40, 0, 1));
    const headK = lerp(0.85, blanket, furl);

    // --- heel ----------------------------------------------------------------------------------
    const h = b.heel;
    const pointOfSail = clamp(1.15 - (awaAbs * R2D) / 160, 0.12, 1);
    const windLoad = Math.max(0, h.perKnot * awsKt - h.offset);
    let sailLoad = h.mainShare * reef.heel * heelTrim(o.main) + h.jibShare * Math.pow(s.furl, 1.3) * heelTrim(o.jib);
    if (kite) sailLoad = h.mainShare * reef.heel * heelTrim(o.main) + (1 - flying) * h.jibShare * Math.pow(s.furl, 1.3) * heelTrim(o.jib);
    let loadDeg = Math.min(h.maxDeg, windLoad * pointOfSail * Math.max(0, sailLoad));
    // A hard wind on too much sail, or the spinnaker carried too high or in too much wind: past what she can carry
    // she does not just heel a little more, she lies over, the rudder lets go and she rounds up. Easing the sheets,
    // feathering up or a reef takes the load off. Held past the point of no return for a second, she is knocked flat.
    o.overpower = 0;
    // A boat that does not heel to spill her sail has a number instead: see below.
    const pr = b.pressed;
    if (!pr && (kite || twsKt > GUST_FROM)) {
      let raw = loadDeg;
      let gate = smoothstep(GUST_FROM, GUST_FULL, twsKt);
      let over = 0;
      if (kite) {
        const reach = clamp(1.6 - (awaAbs * R2D) / 100, 0.25, 1.2);
        const pull = heelTrim(o.spin) * flying;
        raw += Math.max(0, kite.heelPerKnot * awsKt - kite.heelOffset) * reach * pull;
        over = Math.max(0, twsKt - kite.maxTwsKt) * SPIN_OVER_PER_KT * (o.spin.flogging ? 0 : flying);
        gate = Math.max(gate, flying);
      }
      over += Math.max(0, raw - (h.overpowerDeg ?? 20)) * gate;
      o.overpower = over;
      loadDeg = Math.min(70, raw + over * OVERPOWER_GAIN);
      if (loadDeg > KNOCKDOWN_LOAD && s.knock === 0) {
        s.gustTime += dt;
        if (s.gustTime > 1) this.knockDown(30 * D2R, clamp(2.5 + (loadDeg - KNOCKDOWN_LOAD) / 6, 2.5, 5), flying > 0.5);
      } else if (s.gustTime > 0) s.gustTime = Math.max(0, s.gustTime - dt);
    }
    // Her number is the apparent wind her set sail will take.
    let pressSlow = 1;
    if (pr) {
      // Sail that is drawing carries the load. The wind abeam is the worst of it; well aft there is less to trip over.
      const share = Math.max(0, sailLoad) * lerp(1, 0.75, smoothstep(90 * D2R, 170 * D2R, awaAbs));
      const loaded = awsKt * Math.sqrt(share);
      const over = Math.max(0, loaded - pr.limitAwsKt);
      o.press = loaded / pr.limitAwsKt;
      o.overpower = over;
      pressSlow = Math.max(pr.slowFloor, 1 - pr.slowPerKt * over);
      if (over > pr.capsizeOverKt && s.knock === 0) {
        s.gustTime += dt;
        if (s.gustTime > pr.capsizeAfterS) this.capsize(pr);
      } else if (s.gustTime > 0) s.gustTime = Math.max(0, s.gustTime - dt);
    }
    o.heelLoad = loadDeg * D2R;
    // A crash gybe throws her over further than the wind alone would. She hangs there, then comes back up.
    if (s.knock > 0) {
      if (s.knockHold > 0) s.knockHold -= dt;
      else s.knock *= Math.exp(-dt / 2.5);
      if (s.knock < 0.01) s.knock = 0;
    }
    // Capsized, she lies on the side she went over on whatever the wind does next.
    const heelSide = pr && s.knock > 0 && Math.abs(s.heel) > 0.3 ? Math.sign(s.heel) : -windSide;
    const heelTarget = heelSide * Math.min(82 * D2R, o.heelLoad + s.knock);
    s.heel += (heelTarget - s.heel) * (1 - Math.exp(-dt / (s.knock > 0 ? 0.55 : 1.2)));
    const heelDeg = Math.abs(s.heel) * R2D;
    o.heelPenalty = heelDeg > h.penaltyStartDeg
      ? Math.max(h.penaltyFloor, 1 - (heelDeg - h.penaltyStartDeg) * h.penaltyPerDeg)
      : 1;

    // --- speed ---------------------------------------------------------------------------------
    const drive = kite ? mainShare * o.main.eff + jibShare * lerp(o.jib.eff, Math.max(0, o.spin.eff), flying) : mainShare * o.main.eff + jibShare * o.jib.eff;
    // Laid over by a crash gybe, the sails spill their wind and she stops.
    const spill = s.knock > 0 ? clamp(1 - (heelDeg - 40) / 30, 0.03, 1) : 1;
    o.knockedDown = heelDeg > 55;
    let targetKt = polarSpeed(b.polar, twaDeg, twsEff) * headK * Math.max(0, drive) * o.heelPenalty * spill;
    if (pr) targetKt *= pressSlow;
    // Set and drawing, the spinnaker adds to what the white sails would give: most on a broad reach, nothing forward of the beam.
    if (kite) targetKt *= 1 + interp1(kite.gain.twa, kite.gain.pct, twaDeg) * interp1(kite.fade.tws, kite.fade.k, twsKt) * Math.max(0, o.spin.eff) * flying;
    o.targetSpeed = targetKt * KT;
    o.polarSpeed = polarSpeed(b.polar, twaDeg, twsKt) * KT;
    // She gathers way slowly and carries it a long time: about four boat lengths shooting head to wind.
    // Laid flat, with the rig and half the deck in the water, she stops in a few lengths.
    const hd = b.handling;
    let tau = o.targetSpeed > s.speed ? hd?.gatherS ?? 12 : spill < 0.5 ? 3 : hd?.carryS ?? 16;
    // What stops a boat with a lot of windage is the wind: she carries her way longer in a light air than in a blow.
    if (hd?.carryAwsKt !== undefined && tau === hd.carryS) tau *= clamp(hd.carryAwsKt / Math.max(awsKt, 1), CARRY_LEAST, CARRY_MOST);
    // Under power the propeller's push goes in with the sails' drive. Resistance climbs so steeply with speed that
    // the two together give a little more than the better of them, never the sum, and nothing past hull speed.
    const motor = this.engineSpeed();
    const geared = o.underPower;
    if (geared) {
      const sail = o.targetSpeed;
      let v = Math.cbrt(sail * sail * sail + motor * motor * motor);
      if (motor > 0) v = Math.max(sail, Math.min(v, 2.43 * Math.sqrt(b.dimensions.lwl) * KT));
      o.targetSpeed = v;
      // The propeller gets her moving, and stops her, quicker than the sails do.
      if (spill >= 0.5) tau = Math.abs(v) > Math.abs(s.speed) && v * s.speed >= 0 ? 9 : 14;
    }
    // A damaged hull drags, under sail or power. Holed, she stops in a few lengths.
    if (s.damage > 0) {
      o.targetSpeed *= damageSpeed(s.damage);
      if (s.damage >= 1) tau = 3;
    }
    s.speed += (o.targetSpeed - s.speed) * (1 - Math.exp(-dt / tau));
    const sinR = Math.sin(s.rudder);
    s.speed -= b.helm.rudderDrag * sinR * sinR * s.speed * Math.abs(s.speed) * dt;
    if (!geared && Math.abs(s.speed) < 0.005) s.speed = 0;

    // --- helm ----------------------------------------------------------------------------------
    const maxRudder = b.helm.maxRudderDeg * D2R;
    o.rudderGrip = clamp(1 - (heelDeg - h.rudderFadeStartDeg) / h.rudderFadeRangeDeg, 0.1, 1);
    let rudderRate = HAND_RUDDER_RATE;
    if (m || s.helmMode !== 'hand') {
      rudderRate = PILOT_RUDDER_RATE;
      let err: number;
      o.pilotBeating = false;
      if (m) err = wrapPi(m.targetHeading - s.heading);
      else if (s.helmMode === 'heading') err = wrapPi(s.helmTarget - s.heading);
      else if (s.helmMode === 'route') err = this.routeError();
      else err = wrapPi(o.twa - s.helmTarget);
      if (Math.abs(err) < 15 * D2R) s.helmIntegral = clamp(s.helmIntegral + err * dt, -1.5, 1.5);
      const limit = m ? 30 * D2R : maxRudder;
      s.rudderCmd = clamp(1.3 * err - 1.7 * s.yawRate + 0.2 * s.helmIntegral, -limit, limit);
      // Going astern the rudder works the other way round.
      if (s.speed < -0.15) s.rudderCmd = -s.rudderCmd;
      if (m && Math.abs(err) < 4 * D2R && Math.abs(s.yawRate) < 4 * D2R) this.finishManeuver();
      else if (m && m.elapsed > 60) this.finishManeuver();
    }
    s.rudder = approach(s.rudder, s.rudderCmd, rudderRate * dt);

    // --- yaw -----------------------------------------------------------------------------------
    // Water over the rudder: her own way, and with the engine ahead the propeller's race as well, which is what
    // gives the rudder bite when she is barely moving. Astern there is no race over it and it works backwards, badly.
    let flow = s.speed;
    if (geared && motor > s.speed && s.throttle > 0) flow = s.speed + PROP_WASH * (motor - s.speed);
    let rudderYaw = b.helm.turnGain * flow * s.rudder * o.rudderGrip;
    // Two screws far apart: no race over a rudder to lose astern, and worked against each other they turn her where she lies.
    const twin = s.engineOn ? b.engine?.twinPivotDegS : undefined;
    if (s.speed < 0 && !(twin && geared)) rudderYaw *= ASTERN_BITE;
    // In astern gear the wheel takes her stern the way it is turned, as a rudder would.
    if (twin) rudderYaw += (s.throttle < 0 ? -1 : 1) * twin * D2R * (s.rudder / maxRudder) * (1 - clamp(Math.abs(s.speed) / 2.5, 0, 1));
    // Heel makes the boat want to turn into the wind.
    const speedShare = clamp(s.speed / 3, 0, 1.2);
    o.weatherHelm = windSide * 0.024 * D2R * Math.pow(Math.max(0, heelDeg - 8), 1.5) * speedShare;
    // A jib held aback pushes the bow away from the wind.
    const backedYaw = -windSide * 6 * D2R * o.jib.backed * s.furl * Math.min(2, (awsKt / 15) ** 2) * (kite ? 1 - flying : 1);
    // With no way on, the bow blows off until the sails can fill.
    const slow = clamp(1 - s.speed / 1.0, 0, 1);
    let fallOff = -windSide * 3 * D2R * slow * clamp(awsKt / 12, 0, 1.5) * (1 - smoothstep(40 * D2R, 70 * D2R, Math.abs(o.twa)));
    if (hd?.blowOff !== undefined) fallOff *= hd.blowOff;
    let yawTarget = rudderYaw + o.weatherHelm + backedYaw + fallOff;
    // A self-tacking jib cannot be left aback on its old sheet. In a tack the crew is handling, someone holds its clew
    // out to windward by hand as she comes head to wind, which pushes her bows round onto the new tack.
    const byHand = b.sails.jib.backByHandDegS;
    if (byHand && m?.kind === 'tack' && s.furl > 0.3 && Math.abs(o.twa) < 40 * D2R) {
      yawTarget += Math.sign(wrapPi(m.targetHeading - s.heading)) * byHand * D2R * s.furl * clamp(awsKt / 10, 0.5, 1.3);
    }
    // Overpowered, she gripes up into the wind whatever way she has on, until the sails spill.
    if (o.overpower > 0 && !pr) yawTarget += windSide * 7 * D2R * clamp((o.overpower - 2) / 8, 0, 1) * smoothstep(25 * D2R, 45 * D2R, awaAbs);
    // In astern the propeller walks the stern to port, so her bow swings to starboard, most before she has sternway.
    if (geared && s.throttle < 0 && !twin) yawTarget += PROP_WALK * (-s.throttle / 2) * (1 - 0.5 * clamp(-s.speed / 1.2, 0, 1));
    s.yawRate += (yawTarget - s.yawRate) * (1 - Math.exp(-dt / 0.7));
    s.heading = wrapTau(s.heading + s.yawRate * dt);

    // --- leeway --------------------------------------------------------------------------------
    const slowGain = clamp((2.8 / Math.max(s.speed, 0.8)) ** 2, 1, 6);
    // Leeway comes from the side force of sails that are drawing. Flogging sails push nothing sideways.
    const sideForce = clamp(sailLoad, 0, 1.2);
    const leeway = Math.min((hd?.leewayMaxDeg ?? 25) * D2R, pointOfSail * sideForce * ((hd?.leewayBaseDeg ?? 3) + (hd?.leewayPerHeelDeg ?? 0.12) * heelDeg) * D2R * slowGain);
    const lateralTarget = -windSide * s.speed * Math.tan(leeway);
    s.lateral += (lateralTarget - s.lateral) * (1 - Math.exp(-dt / 1.0));

    // --- move ----------------------------------------------------------------------------------
    const env = this.env.sample(s.x, s.y, s.t);
    const sinH = Math.sin(s.heading);
    const cosH = Math.cos(s.heading);
    let vx = s.speed * sinH + s.lateral * cosH + env.currentX;
    let vy = s.speed * cosH - s.lateral * sinH + env.currentY;
    // Depth under the keel is chart depth plus tide minus draft. Touching bottom stops the boat.
    // She can still work her way off toward deeper water.
    const draft = b.dimensions.draft;
    o.underKeel = env.depth === undefined ? null : env.depth - draft;
    o.aground = false;
    let moveX = vx * dt;
    let moveY = vy * dt;
    if (env.depth !== undefined && env.depth < draft + 0.05) {
      o.aground = true;
    } else if (env.depth !== undefined) {
      // Look a boat length ahead of the move so the keel stops at the shoal, not past it.
      const ahead = this.env.sample(s.x + moveX, s.y + moveY, s.t).depth;
      if (ahead !== undefined && ahead < draft) o.aground = true;
    }
    if (o.aground) {
      const here = env.depth ?? 0;
      const there = this.env.sample(s.x + moveX, s.y + moveY, s.t).depth ?? 0;
      if (there <= here || there < draft * 0.6) {
        moveX = 0;
        moveY = 0;
        s.speed *= Math.exp(-dt / 0.35);
        s.lateral *= Math.exp(-dt / 0.35);
      }
    }
    s.x += moveX;
    s.y += moveY;
    vx = moveX / dt;
    vy = moveY / dt;
    o.sog = Math.hypot(vx, vy);
    o.cog = o.sog > 0.01 ? wrapTau(Math.atan2(vx, vy)) : s.heading;

    o.inIrons = Math.abs(o.twa) < ((hd?.closeHauledDeg ?? 44) - 14) * D2R && s.speed < 2 * KT && !geared;
    o.roundingUp = o.rudderGrip < 0.5 && Math.abs(o.weatherHelm) > Math.abs(rudderYaw);
    // The pilot gives up when it is overpowered: a few seconds of losing to the helm and it hands the wheel back.
    if (s.helmMode !== 'hand' && !s.maneuver) {
      s.overpowered = o.roundingUp ? s.overpowered + dt : Math.max(0, s.overpowered - dt * 0.5);
      if (s.overpowered > 4) {
        s.helmMode = 'hand';
        s.overpowered = 0;
        s.pilotTrips++;
      }
    }

    s.tick += 1;
    s.t = s.tick * dt;
  }

  // ---- at anchor or on a mooring --------------------------------------------------------------

  /**
   * Let go the anchor here, or make fast to a mooring at a given point. The sails come down and she lies back
   * from that point to the wind and the stream.
   * @param scope metres of rode or mooring line
   */
  holdAt(kind: 'anchor' | 'mooring', x: number, y: number, scope: number): void {
    const s = this.state;
    s.hold = kind;
    s.holdX = x;
    s.holdY = y;
    s.holdScope = Math.max(2, scope);
    s.helmMode = 'hand';
    s.crewTrim = false;
    s.maneuver = null;
    s.rudderCmd = 0;
    s.knock = 0;
    s.knockHold = 0;
    s.spin = false;
    s.spinHoist = 0;
    s.spinWrapped = false;
    s.gustTime = 0;
    s.gustEase = 0;
    s.throttle = 0;
  }

  /** Weigh anchor or slip the mooring. The crew sets the sails and she bears away onto a close reach. */
  release(): void {
    const s = this.state;
    if (s.hold === 'none') return;
    s.hold = 'none';
    // With the engine running she leaves under power: let go, in neutral, the wheel in hand and the sheets left alone.
    if (s.engineOn) {
      s.speed = 0;
      s.lateral = 0;
      s.helmMode = 'hand';
      s.crewTrim = false;
      this.settleSails();
      return;
    }
    // Hauled up to the anchor she has a little way on, enough for the rudder to bite.
    s.speed = 1.3;
    s.lateral = 0;
    this.computeWind();
    this.setHelm('wind', (this.out.twa >= 0 ? 1 : -1) * 55 * D2R);
    s.crewTrim = true;
    this.trimForWind();
  }

  /** A step while held: no sailing, just lying to the wind and stream on the end of the rode. */
  private stepHeld(): void {
    const s = this.state;
    const o = this.out;
    const dt = this.dt;
    const env = this.env.sample(s.x, s.y, s.t);
    // Wind on the hull and rig, and the stream on the keel, push her away from the point she is held by.
    const wind = o.tws * o.tws * 0.012;
    const cur = Math.hypot(env.currentX, env.currentY);
    let fx = -Math.sin(o.twd) * wind + env.currentX * cur * 6;
    let fy = -Math.cos(o.twd) * wind + env.currentY * cur * 6;
    const f = Math.hypot(fx, fy);
    if (f < 1e-4) { fx = -Math.sin(s.heading); fy = -Math.cos(s.heading); } else { fx /= f; fy /= f; }
    // She sheers a little from side to side on the rode, more in a breeze.
    const sheer = Math.sin(s.t / 9) * 0.12 * clamp(o.tws / 8, 0, 1.2);
    const tx = s.holdX + (fx * Math.cos(sheer) - fy * Math.sin(sheer)) * s.holdScope;
    const ty = s.holdY + (fx * Math.sin(sheer) + fy * Math.cos(sheer)) * s.holdScope;
    const k = 1 - Math.exp(-dt / 14);
    let moveX = (tx - s.x) * k;
    let moveY = (ty - s.y) * k;
    const step = Math.hypot(moveX, moveY);
    const most = 1.2 * dt;
    if (step > most) { moveX *= most / step; moveY *= most / step; }
    s.x += moveX;
    s.y += moveY;
    // The bow points up the rode.
    const up = Math.atan2(s.holdX - s.x, s.holdY - s.y);
    if (Math.hypot(s.holdX - s.x, s.holdY - s.y) > 0.5) {
      const turn = wrapPi(up - s.heading);
      s.yawRate = clamp(turn * 0.25, -0.12, 0.12);
      s.heading = wrapTau(s.heading + s.yawRate * dt);
    }
    s.speed = 0;
    s.lateral = 0;
    s.rudder = approach(s.rudder, 0, PILOT_RUDDER_RATE * dt);
    s.boomAngle = approach(s.boomAngle, 0, BOOM_SLEW * 0.2 * dt);
    s.jibAngle = approach(s.jibAngle, 0, JIB_SLEW * 0.2 * dt);
    // Bare poles: a few degrees of roll from the wind on the rig, no more.
    const lean = -(o.awa >= 0 ? 1 : -1) * Math.min(4, (o.aws / KT) * 0.12) * D2R * Math.abs(Math.sin(o.awa));
    s.heel += (lean - s.heel) * (1 - Math.exp(-dt / 2));
    Object.assign(o.main, emptySail());
    Object.assign(o.jib, emptySail());
    Object.assign(o.spin, emptySail());
    o.overpower = 0;
    o.press = 0;
    o.heelLoad = 0;
    o.heelPenalty = 1;
    o.targetSpeed = 0;
    o.weatherHelm = 0;
    o.rudderGrip = 1;
    o.knockedDown = false;
    o.pilotBeating = false;
    o.roundingUp = false;
    o.inIrons = false;
    o.underKeel = env.depth === undefined ? null : env.depth - this.boat.dimensions.draft;
    o.aground = env.depth !== undefined && env.depth < this.boat.dimensions.draft + 0.05;
    o.sog = Math.hypot(moveX, moveY) / dt;
    o.cog = o.sog > 0.01 ? wrapTau(Math.atan2(moveX, moveY)) : s.heading;
    s.tick += 1;
    s.t = s.tick * dt;
  }

  // ---- internals ------------------------------------------------------------------------------

  private computeWind(): void {
    const s = this.state;
    const o = this.out;
    const env = this.env.sample(s.x, s.y, s.t);
    const sinH = Math.sin(s.heading);
    const cosH = Math.cos(s.heading);
    // Boat velocity through the water.
    const bx = s.speed * sinH + s.lateral * cosH;
    const by = s.speed * cosH - s.lateral * sinH;
    // Wind relative to the moving water.
    const wx = -env.windSpeed * Math.sin(env.windDir) - env.currentX;
    const wy = -env.windSpeed * Math.cos(env.windDir) - env.currentY;
    o.tws = Math.hypot(wx, wy);
    o.twd = o.tws > 1e-6 ? wrapTau(Math.atan2(-wx, -wy)) : env.windDir;
    o.twa = wrapPi(o.twd - s.heading);
    const ax = wx - bx;
    const ay = wy - by;
    o.aws = Math.hypot(ax, ay);
    o.awa = o.aws > 1e-6 ? wrapPi(Math.atan2(-ax, -ay) - s.heading) : 0;
  }

  /** Work out where each sail sits and how well it is drawing. */
  private computeSails(windSide: number, awaAbs: number, slew: boolean): void {
    const s = this.state;
    const b = this.boat;
    const o = this.out;
    const dt = this.dt;
    const q = 0.5 * AIR_DENSITY * o.aws * o.aws;

    // Main. The boom swings to leeward until the sheet stops it.
    // It stays put through small wind-angle wobbles dead ahead and dead astern.
    if (awaAbs > 3 * D2R && awaAbs < 170 * D2R && s.mainSide !== -windSide) {
      if (slew && awaAbs > 100 * D2R) {
        this.gybed();
        this.spinGybed();
      }
      s.mainSide = -windSide;
    }
    const byTheLee = s.mainSide === windSide && awaAbs > Math.PI / 2;
    const mainWind = byTheLee ? Math.PI : awaAbs;
    const boomMag = Math.min(s.mainSheet, mainWind, b.sails.main.sheetMaxDeg * D2R);
    const boomTarget = s.mainSide * boomMag;
    s.boomAngle = slew ? approach(s.boomAngle, boomTarget, BOOM_SLEW * dt) : boomTarget;

    const main = o.main;
    const mainErr = (boomMag - idealBoomDeg(mainWind * R2D) * D2R) * R2D;
    main.flogging = boomMag >= mainWind - 4 * D2R;
    main.errDeg = main.flogging ? 99 : mainErr;
    main.eff = main.flogging ? 0.03 : trimEfficiency(mainErr);
    main.luff = main.flogging ? 1 : clamp((mainErr - 3) / 15, 0, 1);
    main.stall = main.flogging ? 0 : clamp((-mainErr - 5) / 40, 0, 1);
    main.backed = 0;
    const reef = b.sails.main.reefs[s.reef];
    main.loadKg = (q * b.sails.main.areaM2 * reef.drive * 0.6 * Math.max(0.06, heelTrim(main))) / 9.81;

    // Jib. Each sheet lets the clew swing a certain angle either side of its own car.
    const jib = o.jib;
    if (s.furl < 0.02) {
      Object.assign(jib, emptySail());
      s.jibAngle = 0;
      return;
    }
    const car = b.sails.jib.sheetHardDeg * D2R;
    const free = -windSide * Math.min(awaAbs, JIB_FREE_MAX);
    const single = b.sails.jib.selfTacking;
    const lo = single ? -car - s.jibSheetStbd : Math.max(-car - s.jibSheetPort, car - s.jibSheetStbd);
    const hi = single ? car + s.jibSheetPort : Math.min(-car + s.jibSheetPort, car + s.jibSheetStbd);
    const clewTarget = lo > hi ? (lo + hi) / 2 : clamp(free, lo, hi);
    s.jibAngle = slew ? approach(s.jibAngle, clewTarget, JIB_SLEW * dt) : clewTarget;

    // How far the clew sits to leeward of the centreline. Negative means it is held to windward.
    const lee = -clewTarget * windSide;
    const jibErr = (lee - idealJibDeg(awaAbs * R2D) * D2R) * R2D;
    jib.flogging = lee >= awaAbs - 3 * D2R && lee > 0;
    jib.errDeg = jib.flogging ? 99 : jibErr;
    const drawing = jib.flogging ? 0.03 : trimEfficiency(jibErr);
    // Held to windward the jib is aback: it drives the boat backwards and shoves the bow off the wind.
    // With the wind well aft the same position is just wing and wing, and it pulls.
    const windward = clamp((2 * D2R - lee) / (8 * D2R), 0, 1);
    const wingAndWing = smoothstep(110 * D2R, 150 * D2R, awaAbs);
    jib.backed = windward * (1 - smoothstep(60 * D2R, 110 * D2R, awaAbs));
    jib.eff = lerp(lerp(drawing, -0.25, jib.backed), 0.85, windward * wingAndWing);
    jib.luff = jib.flogging ? 1 : clamp((jibErr - 3) / 15, 0, 1);
    jib.stall = jib.flogging ? 0 : clamp((-jibErr - 5) / 40, 0, 1);
    jib.loadKg = (q * b.sails.jib.areaM2 * s.furl * 0.9 * Math.max(0.05, heelTrim(jib))) / 9.81;
  }

  /**
   * Where the spinnaker is and how well it is drawing.
   * @returns how much of it is up and working, 0 to 1. Exactly 0 whenever it is in its bag.
   */
  private computeSpin(windSide: number, awaAbs: number, slew: boolean): number {
    const s = this.state;
    const o = this.out;
    const sp = this.boat.sails.spinnaker;
    const r = o.spin;
    if (!sp || (!s.spin && s.spinHoist <= 0)) {
      if (r.eff !== 0 || r.luff !== 0 || r.flogging || r.loadKg !== 0) Object.assign(r, emptySail());
      s.spinAngle = 0;
      return 0;
    }
    const dt = this.dt;
    if (slew) {
      // Five seconds to hoist and sheet in, four to get it down the hatch.
      s.spinHoist = approach(s.spinHoist, s.spin ? 1 : 0, dt / (s.spin ? 5 : 4));
      if (s.spinCollapse > 0) s.spinCollapse = Math.max(0, s.spinCollapse - dt);
      // Taken through the wind it blows back into the rig and wraps round the forestay.
      if (awaAbs < 20 * D2R && s.spinHoist > 0.5 && !s.spinWrapped) {
        s.spinWrapped = true;
        s.spinWraps++;
      }
    } else if (s.spin) s.spinHoist = 1;
    if (s.spinHoist <= 0) {
      s.spinWrapped = false;
      s.spinCollapse = 0;
      Object.assign(r, emptySail());
      s.spinAngle = 0;
      return 0;
    }
    // The clew flies out to leeward as far as the sheet lets it.
    const mag = Math.min(s.spinSheet, awaAbs);
    const target = -windSide * mag;
    s.spinAngle = slew ? approach(s.spinAngle, target, JIB_SLEW * dt) : target;
    const err = (mag - idealSpinDeg(awaAbs * R2D) * D2R) * R2D;
    // Eased until it streams, sailed too high for it to stand, collapsed by a gybe, or wrapped: it is not a sail just now.
    r.flogging = s.spinWrapped || s.spinCollapse > 0 || mag >= awaAbs - 10 * D2R;
    r.errDeg = r.flogging ? 99 : err;
    r.eff = r.flogging ? 0.03 : trimEfficiency(err);
    // The luff curls when it is eased too far or sailed too high, and dead downwind it hangs half asleep behind the main.
    r.luff = r.flogging ? 1 : Math.max(clamp((err - 3) / 15, 0, 1), 0.6 * smoothstep(160 * D2R, 178 * D2R, Math.abs(o.twa)));
    r.stall = r.flogging ? 0 : clamp((-err - 5) / 40, 0, 1);
    r.backed = 0;
    r.loadKg = (0.5 * AIR_DENSITY * o.aws * o.aws * sp.areaM2 * 0.55 * Math.max(0.04, r.eff) * s.spinHoist) / 9.81;
    return s.spinHoist;
  }

  /**
   * She has gybed with the spinnaker up. The sheet goes round and the sail collapses for a moment. With the crew
   * handling it that is all. By hand, the more wind there is and the faster she is spun, the worse it goes:
   * a longer collapse, a wrap round the forestay, or a broach.
   */
  private spinGybed(): void {
    const s = this.state;
    if (s.spinHoist < 0.5 || s.spinWrapped) return;
    if (s.crewTrim || s.maneuver?.kind === 'gybe') {
      s.spinCollapse = Math.max(s.spinCollapse, 3);
      return;
    }
    const twsKt = this.out.tws / KT;
    const severity = (twsKt / 15) ** 2 * clamp((Math.abs(s.yawRate) * R2D) / 8, 0.5, 2);
    if (severity < 0.7) s.spinCollapse = Math.max(s.spinCollapse, 5);
    else if (severity < 1.6) {
      s.spinWrapped = true;
      s.spinWraps++;
    } else this.knockDown(35 * D2R, 3.5, true);
  }

  /**
   * Lay her flat: by a gust on too much sail, or by the spinnaker. She hangs there, then comes back up as the sails spill.
   * @param extra heel beyond what the wind alone holds her at, radians
   * @param hold seconds she stays pinned
   * @param broach true when the spinnaker did it
   */
  private knockDown(extra: number, hold: number, broach: boolean): void {
    const s = this.state;
    s.gustTime = 0;
    s.knockdowns++;
    s.knock = Math.max(s.knock, extra);
    s.knockHold = hold;
    if (broach) {
      s.broaches++;
      // The spinnaker flogs itself empty while she lies there, which is what lets her up.
      s.spinCollapse = Math.max(s.spinCollapse, hold + 5);
    }
  }

  /**
   * She has been held past her limit and gone over. A capsized multihull stays capsized: she lies there with her
   * engines drowned until help has righted her, which takes minutes, not the seconds a keelboat needs to come up.
   */
  private capsize(pr: NonNullable<BoatSpec['pressed']>): void {
    const s = this.state;
    this.knockDown(82 * D2R, pr.capsizeHoldS, false);
    s.capsizes++;
    s.helmMode = 'hand';
    s.maneuver = null;
    s.rudderCmd = 0;
    s.engineOn = false;
    s.engineCrank = 0;
    s.throttle = 0;
  }

  /**
   * The boom has just come across with the wind aft. If nobody was tending the mainsheet, how hard it lands depends
   * on how far it had to swing and how much wind is in it. Hauled in first, a gybe is gentle. Let run in a breeze,
   * it rounds her up, and in enough wind it lays her flat.
   */
  private gybed(): void {
    const s = this.state;
    // The crew tends the sheet through a gybe they are making, and whenever they are trimming.
    if (s.crewTrim || s.maneuver?.kind === 'gybe') return;
    const swing = (2 * Math.min(s.mainSheet, this.boat.sails.main.sheetMaxDeg * D2R)) / (160 * D2R);
    const twsKt = this.out.tws / KT;
    const reef = this.boat.sails.main.reefs[s.reef];
    const severity = swing * (twsKt / 19) ** 2 * reef.drive;
    if (severity < 0.45) return;
    s.crashGybes++;
    // A boat that does not heel takes the slam in her rig and stays on her feet.
    if (this.boat.pressed) return;
    if (severity >= 1) {
      s.knockdowns++;
      s.knock = Math.max(s.knock, 72 * D2R);
      s.knockHold = Math.min(6, 2.5 + (severity - 1) * 3);
    } else {
      s.knock = Math.max(s.knock, (15 + (25 * (severity - 0.45)) / 0.55) * D2R);
      s.knockHold = 0.6;
    }
  }

  /** The crew eases or trims each sheet toward its best setting, a little at a time. */
  private crewTrim(awaAbs: number, windSide: number, dt: number): void {
    const s = this.state;
    const b = this.boat;
    const rate = 12 * D2R * dt;
    const awaDeg = awaAbs * R2D;
    const mainRange = this.controlRange('mainsheet');
    // In a gust that would overpower her the crew lets the main out further than its best setting to spill it,
    // and takes it back when the gust has gone. They are a moment behind the wind, so she still staggers.
    if (this.out.overpower > 1) s.gustEase = Math.min(GUST_EASE_MAX, s.gustEase + 10 * D2R * dt);
    else if (s.gustEase > 0 && this.out.overpower < 0.3) s.gustEase = Math.max(0, s.gustEase - 3 * D2R * dt);
    s.mainSheet = approach(s.mainSheet, clamp(idealBoomDeg(awaDeg) * D2R + s.gustEase, mainRange.min, mainRange.max), s.gustEase > 0 ? rate * 2.5 : rate);
    if (s.spinHoist > 0) {
      const spinRange = this.controlRange('spinsheet');
      s.spinSheet = approach(s.spinSheet, clamp(idealSpinDeg(awaDeg) * D2R, spinRange.min, spinRange.max), rate);
    }
    const slackMax = b.sails.jib.sheetMaxSlackDeg * D2R;
    const want = clamp((idealJibDeg(awaDeg) - b.sails.jib.sheetHardDeg) * D2R, 0, slackMax);
    if (b.sails.jib.selfTacking) {
      s.jibSheetPort = s.jibSheetStbd = approach(windSide > 0 ? s.jibSheetPort : s.jibSheetStbd, want, rate);
    } else if (windSide > 0) {
      s.jibSheetPort = approach(s.jibSheetPort, want, rate);
      s.jibSheetStbd = approach(s.jibSheetStbd, slackMax, rate * 6);
    } else {
      s.jibSheetStbd = approach(s.jibSheetStbd, want, rate);
      s.jibSheetPort = approach(s.jibSheetPort, slackMax, rate * 6);
    }
  }

  private finishManeuver(): void {
    const s = this.state;
    const m = s.maneuver;
    if (!m) return;
    s.maneuver = null;
    s.helmMode = m.prevMode;
    s.helmIntegral = 0;
    if (m.prevMode === 'hand') s.rudderCmd = 0;
    else if (m.prevMode === 'heading') s.helmTarget = m.targetHeading;
    else if (m.prevMode === 'wind') s.helmTarget = -m.prevTarget;
  }

  /** Put the sails and outputs where the current wind would have them, with no swing-in time. */
  private settleSails(): void {
    this.computeWind();
    const windSide = this.out.awa >= 0 ? 1 : -1;
    this.state.mainSide = -windSide;
    this.computeSails(windSide, Math.abs(this.out.awa), false);
    this.computeSpin(windSide, Math.abs(this.out.awa), false);
    this.out.sog = this.state.speed;
    this.out.cog = this.state.heading;
    this.out.polarSpeed = polarSpeed(this.boat.polar, Math.abs(this.out.twa) * R2D, this.out.tws / KT) * KT;
  }

  /** Trim both sails to their best setting for the current wind, instantly. For setting up a start or a test. */
  trimForWind(): void {
    const s = this.state;
    const b = this.boat;
    this.computeWind();
    const awaDeg = Math.abs(this.out.awa) * R2D;
    const slackMax = b.sails.jib.sheetMaxSlackDeg * D2R;
    const want = clamp((idealJibDeg(awaDeg) - b.sails.jib.sheetHardDeg) * D2R, 0, slackMax);
    s.mainSheet = idealBoomDeg(awaDeg) * D2R;
    if (b.sails.jib.selfTacking) s.jibSheetPort = s.jibSheetStbd = want;
    else if (this.out.awa >= 0) { s.jibSheetPort = want; s.jibSheetStbd = slackMax; }
    else { s.jibSheetStbd = want; s.jibSheetPort = slackMax; }
    if (s.spin) this.setControl('spinsheet', idealSpinDeg(awaDeg) * D2R);
    this.settleSails();
  }

  /** A deep copy of the full state, enough to resume exactly. */
  snapshot(): SimState {
    return structuredCloneState(this.state);
  }

  restore(state: SimState): void {
    this.state = structuredCloneState(state);
    this.settleSails();
    // settleSails snaps the sails to the wind. Put back the saved positions.
    this.state.boomAngle = state.boomAngle;
    this.state.jibAngle = state.jibAngle;
    this.state.mainSide = state.mainSide;
    if (Number.isFinite(state.spinHoist)) this.state.spinHoist = clamp(state.spinHoist, 0, 1);
    if (Number.isFinite(state.spinAngle)) this.state.spinAngle = state.spinAngle;
    if (!this.boat.engine) { this.state.engineOn = false; this.state.engineCrank = 0; }
    this.state.damage = clamp(this.state.damage, 0, 1);
    this.state.throttle = this.state.engineOn ? clamp(Math.round(this.state.throttle), THROTTLE_MIN, THROTTLE_MAX) : 0;
    this.engineReadout();
  }

  private blankOutputs(): SimOutputs {
    return {
      tws: 0, twd: 0, twa: 0, aws: 0, awa: 0, sog: 0, cog: 0,
      main: emptySail(), jib: emptySail(), spin: emptySail(), overpower: 0, press: 0,
      targetSpeed: 0, polarSpeed: 0, heelLoad: 0, heelPenalty: 1, weatherHelm: 0, rudderGrip: 1,
      inIrons: false, roundingUp: false, pilotBeating: false, knockedDown: false, underKeel: null, aground: false,
      engineRpm: 0, fuel: this.fuel, battery: this.battery, underPower: this.underPower,
    };
  }
}

/**
 * A safe copy of a saved state. A state saved by an older build may lack fields added since, and a state that has
 * gone wrong may hold numbers that are not numbers. Anything missing or not finite takes its starting value,
 * so one bad field can never spread through the whole boat.
 */
function structuredCloneState(s: SimState): SimState {
  const fresh = initialState() as unknown as Record<string, unknown>;
  const saved = s as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fresh)) {
    const want = fresh[key];
    const have = saved[key];
    if (typeof want === 'number') out[key] = typeof have === 'number' && Number.isFinite(have) ? have : want;
    else if (typeof want === 'boolean') out[key] = typeof have === 'boolean' ? have : want;
    else if (typeof want === 'string') out[key] = typeof have === 'string' ? have : want;
    else out[key] = have ?? want;
  }
  const m = s.maneuver;
  out.maneuver = m && Number.isFinite(m.targetHeading) ? { ...m } : null;
  if (!['hand', 'heading', 'wind', 'route'].includes(out.helmMode as string)) out.helmMode = 'hand';
  if (!['none', 'anchor', 'mooring'].includes(out.hold as string)) out.hold = 'none';
  return out as unknown as SimState;
}

/** True when a saved state can be sailed on from: its position, heading and clock are real numbers. */
export function isSoundState(s: Partial<SimState> | null | undefined): s is SimState {
  return !!s && [s.x, s.y, s.heading, s.speed, s.t, s.tick].every((n) => typeof n === 'number' && Number.isFinite(n));
}
