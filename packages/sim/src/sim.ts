import { D2R, R2D, KT, clamp, lerp, wrapPi, wrapTau, smoothstep, approach } from './math';
import { polarSpeed } from './polar';
import type { BoatSpec, ControlName, Environment, HelmMode, SailReport, SimOutputs, SimState } from './types';

/** Fixed step. The sim never takes any other step size. */
export const SIM_DT = 1 / 60;

const AIR_DENSITY = 1.225;
const BOOM_SLEW = 80 * D2R; // rad/s, how fast the boom swings across
const JIB_SLEW = 110 * D2R;
const HAND_RUDDER_RATE = 70 * D2R; // rad/s, hands on the wheel
const PILOT_RUDDER_RATE = 28 * D2R;
const JIB_FREE_MAX = 85 * D2R;

/** Best boom angle in degrees for an apparent wind angle in degrees. */
export function idealBoomDeg(awaDeg: number): number {
  return clamp(0.62 * awaDeg - 14, 4, 82);
}

/** Best jib clew angle in degrees for an apparent wind angle in degrees. */
export function idealJibDeg(awaDeg: number): number {
  return clamp(0.5 * awaDeg - 6, 8, 70);
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
    maneuver: null,
  };
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
    readonly boat: BoatSpec,
    public env: Environment,
    init: InitialConditions | SimState = {},
  ) {
    this.state = 'tick' in init ? structuredCloneState(init) : initialState(init);
    this.out = this.blankOutputs();
    this.settleSails();
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
      case 'jibsheet_port': s.jibSheetPort = v; break;
      case 'jibsheet_stbd': s.jibSheetStbd = v; break;
      case 'furl': s.furl = v; break;
      case 'reef': s.reef = Math.round(v); break;
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

  /** Hand the helm to the pilot, holding the current heading or wind angle unless a target is given. */
  setHelm(mode: HelmMode, target?: number): void {
    const s = this.state;
    s.maneuver = null;
    s.helmMode = mode;
    s.helmIntegral = 0;
    if (mode === 'heading') s.helmTarget = target ?? s.heading;
    else if (mode === 'wind') s.helmTarget = target ?? this.out.twa;
    else s.rudderCmd = target ?? s.rudderCmd;
  }

  /**
   * Tack or gybe to the mirror-image wind angle. The crew swaps the jib sheets as the wind crosses the bow or stern.
   * Returns which one it was.
   */
  tack(): 'tack' | 'gybe' {
    const s = this.state;
    const twa = this.out.twa;
    const kind = Math.abs(twa) < Math.PI / 2 ? 'tack' : 'gybe';
    // Never aim closer than 38 degrees to the wind, so a tack begun in irons still ends up sailing.
    const mag = clamp(Math.abs(twa), 38 * D2R, 178 * D2R);
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

    const reef = b.sails.main.reefs[s.reef];
    const twaDeg = Math.abs(o.twa) * R2D;
    const twsKt = o.tws / KT;
    const jibShare = 0.5 * s.furl;
    const mainShare = 1 - jibShare;
    const headDrive = 0.25 + 0.75 * s.furl;
    const twsEff = twsKt * Math.sqrt(0.5 * reef.drive + 0.5 * headDrive);
    // The jib is blanketed by the main on a deep run.
    const blanket = twaDeg <= 110 ? 1 : lerp(1, 0.8, clamp((twaDeg - 110) / 40, 0, 1));
    const headK = lerp(0.85, blanket, s.furl);

    // --- heel ----------------------------------------------------------------------------------
    const h = b.heel;
    const pointOfSail = clamp(1.15 - (awaAbs * R2D) / 160, 0.12, 1);
    const windLoad = Math.max(0, h.perKnot * awsKt - h.offset);
    const sailLoad = h.mainShare * reef.heel * heelTrim(o.main) + h.jibShare * Math.pow(s.furl, 1.3) * heelTrim(o.jib);
    const loadDeg = Math.min(h.maxDeg, windLoad * pointOfSail * Math.max(0, sailLoad));
    o.heelLoad = loadDeg * D2R;
    const heelTarget = -windSide * o.heelLoad;
    s.heel += (heelTarget - s.heel) * (1 - Math.exp(-dt / 1.2));
    const heelDeg = Math.abs(s.heel) * R2D;
    o.heelPenalty = heelDeg > h.penaltyStartDeg
      ? Math.max(h.penaltyFloor, 1 - (heelDeg - h.penaltyStartDeg) * h.penaltyPerDeg)
      : 1;

    // --- speed ---------------------------------------------------------------------------------
    const drive = mainShare * o.main.eff + jibShare * o.jib.eff;
    const targetKt = polarSpeed(b.polar, twaDeg, twsEff) * headK * Math.max(0, drive) * o.heelPenalty;
    o.targetSpeed = targetKt * KT;
    o.polarSpeed = polarSpeed(b.polar, twaDeg, twsKt) * KT;
    // She gathers way slowly and carries it a long time: about four boat lengths shooting head to wind.
    const tau = o.targetSpeed > s.speed ? 12 : 16;
    s.speed += (o.targetSpeed - s.speed) * (1 - Math.exp(-dt / tau));
    const sinR = Math.sin(s.rudder);
    s.speed -= b.helm.rudderDrag * sinR * sinR * s.speed * s.speed * dt;
    if (s.speed < 0.005) s.speed = 0;

    // --- helm ----------------------------------------------------------------------------------
    const maxRudder = b.helm.maxRudderDeg * D2R;
    o.rudderGrip = clamp(1 - (heelDeg - h.rudderFadeStartDeg) / h.rudderFadeRangeDeg, 0.1, 1);
    let rudderRate = HAND_RUDDER_RATE;
    if (m || s.helmMode !== 'hand') {
      rudderRate = PILOT_RUDDER_RATE;
      let err: number;
      if (m) err = wrapPi(m.targetHeading - s.heading);
      else if (s.helmMode === 'heading') err = wrapPi(s.helmTarget - s.heading);
      else err = wrapPi(o.twa - s.helmTarget);
      if (Math.abs(err) < 15 * D2R) s.helmIntegral = clamp(s.helmIntegral + err * dt, -1.5, 1.5);
      const limit = m ? 30 * D2R : maxRudder;
      s.rudderCmd = clamp(1.3 * err - 1.7 * s.yawRate + 0.2 * s.helmIntegral, -limit, limit);
      if (m && Math.abs(err) < 4 * D2R && Math.abs(s.yawRate) < 4 * D2R) this.finishManeuver();
      else if (m && m.elapsed > 60) this.finishManeuver();
    }
    s.rudder = approach(s.rudder, s.rudderCmd, rudderRate * dt);

    // --- yaw -----------------------------------------------------------------------------------
    const rudderYaw = b.helm.turnGain * s.speed * s.rudder * o.rudderGrip;
    // Heel makes the boat want to turn into the wind.
    const speedShare = clamp(s.speed / 3, 0, 1.2);
    o.weatherHelm = windSide * 0.024 * D2R * Math.pow(Math.max(0, heelDeg - 8), 1.5) * speedShare;
    // A jib held aback pushes the bow away from the wind.
    const backedYaw = -windSide * 6 * D2R * o.jib.backed * s.furl * Math.min(2, (awsKt / 15) ** 2);
    // With no way on, the bow blows off until the sails can fill.
    const slow = clamp(1 - s.speed / 1.0, 0, 1);
    const fallOff = -windSide * 3 * D2R * slow * clamp(awsKt / 12, 0, 1.5) * (1 - smoothstep(40 * D2R, 70 * D2R, Math.abs(o.twa)));
    const yawTarget = rudderYaw + o.weatherHelm + backedYaw + fallOff;
    s.yawRate += (yawTarget - s.yawRate) * (1 - Math.exp(-dt / 0.7));
    s.heading = wrapTau(s.heading + s.yawRate * dt);

    // --- leeway --------------------------------------------------------------------------------
    const slowGain = clamp((2.8 / Math.max(s.speed, 0.8)) ** 2, 1, 6);
    const leeway = Math.min(25 * D2R, pointOfSail * (3 + 0.12 * heelDeg) * D2R * slowGain);
    const lateralTarget = -windSide * s.speed * Math.tan(leeway);
    s.lateral += (lateralTarget - s.lateral) * (1 - Math.exp(-dt / 1.0));

    // --- move ----------------------------------------------------------------------------------
    const env = this.env.sample(s.x, s.y, s.t);
    const sinH = Math.sin(s.heading);
    const cosH = Math.cos(s.heading);
    const vx = s.speed * sinH + s.lateral * cosH + env.currentX;
    const vy = s.speed * cosH - s.lateral * sinH + env.currentY;
    s.x += vx * dt;
    s.y += vy * dt;
    o.sog = Math.hypot(vx, vy);
    o.cog = o.sog > 0.01 ? wrapTau(Math.atan2(vx, vy)) : s.heading;

    o.inIrons = Math.abs(o.twa) < 30 * D2R && s.speed < 2 * KT;
    o.roundingUp = o.rudderGrip < 0.5 && Math.abs(o.weatherHelm) > Math.abs(rudderYaw);

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
    if (awaAbs > 3 * D2R && awaAbs < 170 * D2R) s.mainSide = -windSide;
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
    const lo = Math.max(-car - s.jibSheetPort, car - s.jibSheetStbd);
    const hi = Math.min(-car + s.jibSheetPort, car + s.jibSheetStbd);
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

  /** The crew eases or trims each sheet toward its best setting, a little at a time. */
  private crewTrim(awaAbs: number, windSide: number, dt: number): void {
    const s = this.state;
    const b = this.boat;
    const rate = 12 * D2R * dt;
    const awaDeg = awaAbs * R2D;
    const mainRange = this.controlRange('mainsheet');
    s.mainSheet = approach(s.mainSheet, clamp(idealBoomDeg(awaDeg) * D2R, mainRange.min, mainRange.max), rate);
    const slackMax = b.sails.jib.sheetMaxSlackDeg * D2R;
    const want = clamp((idealJibDeg(awaDeg) - b.sails.jib.sheetHardDeg) * D2R, 0, slackMax);
    if (windSide > 0) {
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
    else s.helmTarget = -m.prevTarget;
  }

  /** Put the sails and outputs where the current wind would have them, with no swing-in time. */
  private settleSails(): void {
    this.computeWind();
    const windSide = this.out.awa >= 0 ? 1 : -1;
    this.state.mainSide = -windSide;
    this.computeSails(windSide, Math.abs(this.out.awa), false);
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
    if (this.out.awa >= 0) { s.jibSheetPort = want; s.jibSheetStbd = slackMax; }
    else { s.jibSheetStbd = want; s.jibSheetPort = slackMax; }
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
  }

  private blankOutputs(): SimOutputs {
    return {
      tws: 0, twd: 0, twa: 0, aws: 0, awa: 0, sog: 0, cog: 0,
      main: emptySail(), jib: emptySail(),
      targetSpeed: 0, polarSpeed: 0, heelLoad: 0, heelPenalty: 1, weatherHelm: 0, rudderGrip: 1,
      inIrons: false, roundingUp: false,
    };
  }
}

function structuredCloneState(s: SimState): SimState {
  return { ...s, maneuver: s.maneuver ? { ...s.maneuver } : null };
}
