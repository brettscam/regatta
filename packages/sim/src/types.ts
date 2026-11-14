import type { PolarTable } from './polar';

/** What the world is doing at one place and time. Supplied to the sim, never fetched by it. */
export interface EnvSample {
  /** Direction the wind blows FROM, radians clockwise from north. */
  windDir: number;
  /** True wind speed over the ground, m/s. */
  windSpeed: number;
  /** Current set, m/s east. */
  currentX: number;
  /** Current set, m/s north. */
  currentY: number;
  /** Depth of water here and now, metres, tide included. Leave out for open water of no known depth. */
  depth?: number;
}

export interface Environment {
  sample(x: number, y: number, t: number): EnvSample;
}

export interface ReefSpec {
  name: string;
  /** Share of full-main drive left at this reef. */
  drive: number;
  /** Share of full-main heeling effect left at this reef. */
  heel: number;
  /** Share of the luff still hoisted, for drawing. */
  luff: number;
}

export interface ControlBinding {
  /** Named node in the boat model. */
  node: string;
  control: ControlName;
  label: string;
  /** Working view to fly to on double-click. */
  view?: string;
  stepDeg?: number;
  keys?: { dec: string[]; inc: string[] };
}

export interface BoatSpec {
  id: string;
  name: string;
  dimensions: {
    loa: number; lwl: number; beam: number; draft: number; freeboard: number; displacementKg: number;
    mastHeight: number; boomLength: number; boomHeight: number; mastFromBow: number; jibFoot: number; forestayHeight: number;
  };
  polar: PolarTable;
  sails: {
    main: { areaM2: number; reefs: ReefSpec[]; sheetMinDeg: number; sheetMaxDeg: number };
    jib: { areaM2: number; sheetHardDeg: number; sheetMaxSlackDeg: number };
  };
  heel: {
    perKnot: number; offset: number; mainShare: number; jibShare: number;
    penaltyStartDeg: number; penaltyPerDeg: number; penaltyFloor: number;
    rudderFadeStartDeg: number; rudderFadeRangeDeg: number; maxDeg: number;
  };
  rightingCurve: { deg: number[]; gz: number[] };
  helm: { maxRudderDeg: number; turnGain: number; rudderDrag: number };
  controls: ControlBinding[];
}

export type ControlName = 'rudder' | 'mainsheet' | 'jibsheet_port' | 'jibsheet_stbd' | 'furl' | 'reef' | 'pilot';

/** Who is steering: a hand on the wheel, or the pilot holding a heading, a wind angle, or a course to a mark. */
export type HelmMode = 'hand' | 'heading' | 'wind' | 'route';

export interface Maneuver {
  kind: 'tack' | 'gybe';
  targetHeading: number;
  /** Side the wind was on when the turn began: +1 starboard, -1 port. */
  fromSide: number;
  swapped: boolean;
  prevMode: HelmMode;
  prevTarget: number;
  elapsed: number;
}

/**
 * Everything needed to resume the sim exactly. Plain data, safe to JSON round-trip.
 * Angles in radians, distances in metres, speeds in m/s. Positive is starboard for every signed value.
 */
export interface SimState {
  /** Seconds since the start of the session. */
  t: number;
  /** Fixed steps taken. */
  tick: number;
  /** Metres east of the origin. */
  x: number;
  /** Metres north of the origin. */
  y: number;
  /** Compass heading, radians clockwise from north. */
  heading: number;
  yawRate: number;
  /** Speed through the water along the heading. */
  speed: number;
  /** Sideways speed through the water, positive to starboard. Leeway. */
  lateral: number;
  /** Heel, positive when the boat leans to starboard. */
  heel: number;
  /** Rudder angle, positive turns the boat to starboard. */
  rudder: number;
  /** Where the wheel has been left. The rudder follows it. */
  rudderCmd: number;
  /** Mainsheet length as the widest boom angle it allows. */
  mainSheet: number;
  /** Port jib sheet as slack: 0 is hard in. */
  jibSheetPort: number;
  /** Starboard jib sheet as slack: 0 is hard in. */
  jibSheetStbd: number;
  /** Jib unrolled, 0 to 1. */
  furl: number;
  reef: number;
  /** Boom angle off the centreline, positive when the boom is out to starboard. */
  boomAngle: number;
  /** Jib clew angle off the centreline, positive to starboard. */
  jibAngle: number;
  /** Side the main is filling on: +1 boom to starboard, -1 boom to port. */
  mainSide: number;
  helmMode: HelmMode;
  /** Heading to hold (heading mode) or signed true wind angle to hold (wind mode). */
  helmTarget: number;
  helmIntegral: number;
  /** When true the crew trims both sails toward their best setting. */
  crewTrim: boolean;
  /** The mark the pilot is steering for in route mode, and where that leg began. */
  routeX: number;
  routeY: number;
  routeFromX: number;
  routeFromY: number;
  /** Smoothed angle between heading and course over ground, so the pilot can crab across the tide. */
  routeCrab: number;
  /** Sim time of the pilot's last tack or gybe on its own account. */
  routeTurnAt: number;
  /** How many times the pilot has tacked or gybed for the mark. */
  routeTurns: number;
  /** Seconds the pilot has been losing the fight with the helm. */
  overpowered: number;
  /** How many times the pilot has given up and handed the wheel back. */
  pilotTrips: number;
  /** Extra heel from a crash gybe, radians. It fades as she comes back up. */
  knock: number;
  /** Seconds she stays pinned before she starts to come up. */
  knockHold: number;
  /** How many times the boom has come across out of control hard enough to matter. */
  crashGybes: number;
  /** How many of those laid her flat. */
  knockdowns: number;
  /** What is holding her: nothing, her own anchor, or a mooring or dock line. Held, her sails are stowed. */
  hold: 'none' | 'anchor' | 'mooring';
  /** Where the anchor or mooring is. */
  holdX: number;
  holdY: number;
  /** Metres of rode or line between that point and the bow. */
  holdScope: number;
  maneuver: Maneuver | null;
}

export interface SailReport {
  /** Drive efficiency. 1 is perfect trim, 0 is flogging, negative is aback. */
  eff: number;
  /** 0 drawing, 1 fully luffing. */
  luff: number;
  /** 0 flowing, 1 fully stalled from over-sheeting. */
  stall: number;
  /** True when the sail streams like a flag. */
  flogging: boolean;
  /** 0 to 1, how hard the sail is held aback on the windward side. Jib only. */
  backed: number;
  /** Sheet load in kilograms-force. */
  loadKg: number;
  /** Trim error in degrees: positive is eased too far, negative is sheeted too hard. */
  errDeg: number;
}

/** Derived values, recomputed every step. Never an input. */
export interface SimOutputs {
  /** True wind speed over the water, m/s. */
  tws: number;
  /** True wind direction (from), radians. */
  twd: number;
  /** Signed true wind angle, positive when the wind is on the starboard side. */
  twa: number;
  aws: number;
  /** Signed apparent wind angle. */
  awa: number;
  /** Speed over ground, m/s. */
  sog: number;
  /** Course over ground, radians. */
  cog: number;
  main: SailReport;
  jib: SailReport;
  /** Speed the boat is accelerating toward, m/s. */
  targetSpeed: number;
  /** Polar speed at this wind angle and speed with full sail and perfect trim, m/s. */
  polarSpeed: number;
  /** Equilibrium heel for the current wind and trim, radians, unsigned. */
  heelLoad: number;
  /** Speed multiplier from excess heel, 1 when upright enough. */
  heelPenalty: number;
  /** Rate the boat wants to turn into the wind from heel, rad/s, signed like yawRate. */
  weatherHelm: number;
  /** 0 to 1, how much grip the rudder has left. */
  rudderGrip: number;
  inIrons: boolean;
  roundingUp: boolean;
  /** True when the pilot is working to windward toward a mark it cannot point at. */
  pilotBeating: boolean;
  /** True while she is laid over past 55 degrees. */
  knockedDown: boolean;
  /** Water under the keel, metres. Null where the world gives no depth. */
  underKeel: number | null;
  aground: boolean;
}
