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

/** An asymmetric spinnaker: flown from the bow or a short sprit, for reaching and running. */
export interface SpinnakerSpec {
  areaM2: number;
  /** The true wind has to be at least this far aft before it can be set, degrees. */
  minTwaDeg: number;
  /** True wind, knots, above which it starts to overpower her however it is trimmed. */
  maxTwsKt: number;
  /** The sheet as the widest clew angle off the centreline it allows, degrees. */
  sheetMinDeg: number;
  sheetMaxDeg: number;
  /** Share of extra speed over the white-sail polar when set and trimmed, by true wind angle in degrees. */
  gain: { twa: number[]; pct: number[] };
  /** How much of that gain is left as the wind rises and she nears her top speed, by true wind in knots. */
  fade: { tws: number[]; k: number[] };
  /** Heel it adds: degrees = max(0, heelPerKnot * AWS - heelOffset), most on a tight reach, little on a run. */
  heelPerKnot: number;
  heelOffset: number;
}

/** An inboard diesel on a shaft, with the tank and the battery it charges. */
export interface EngineSpec {
  /** Rated power, kW. For show: the speeds below are what the sim uses. */
  powerKw: number;
  /** Speed under power at cruising revs in flat water with no wind, knots. */
  cruiseKt: number;
  /** Fuel burned at cruising revs, litres an hour. */
  burnLph: number;
  tankL: number;
  /** House battery, amp hours. */
  batteryAh: number;
  /** What the alternator puts back at cruising revs, amps. */
  alternatorA: number;
  /** How much a head wind and its sea take off her under power: (m/s)^2 of speed-squared lost per (m/s)^2 of wind from ahead. */
  windage: number;
  /**
   * Two engines set far apart, one in each hull. Worked against each other they turn her where she lies, so with the
   * engines running the wheel turns her with no way on, and astern she steers as well as ahead with no prop walk.
   * The number is how fast she spins at a standstill with the wheel hard over, degrees a second. Left out, one screw.
   */
  twinPivotDegS?: number;
}

/**
 * A boat that stands up to her sail instead of heeling to spill it: a multihull. There is no heel to warn her crew, so
 * the limit is a number: the apparent wind her set sail can take. Past it she is pressed: a lee bow digs in and she
 * slows. Held well past it she goes over, and she does not come back up by herself.
 */
export interface PressedSpec {
  /** Apparent wind, knots, at which each reef should go in: the placard at her helm. One entry per reef she has. */
  reefAwsKt: number[];
  /**
   * Apparent wind, knots, that full sail sheeted in will take before she is pressed. A reef or a rolled jib takes
   * load off through the `heel` share of the reef and the heel law's sail shares, so the limit rises with them.
   */
  limitAwsKt: number;
  /** Share of her speed lost for each knot over the limit, as the bow buries. */
  slowPerKt: number;
  /** The least of her speed that being pressed leaves. */
  slowFloor: number;
  /** Knots over the limit at which she capsizes if she is held there. */
  capsizeOverKt: number;
  /** Seconds she has to be held past that. */
  capsizeAfterS: number;
  /** Seconds she lies capsized before help has her upright again. */
  capsizeHoldS: number;
}

/** How she handles, where it differs from a fin-keeled sloop. Every figure left out is the sloop's. */
export interface HandlingSpec {
  /** Seconds to gather way, and to lose it when the drive goes. 12 and 16 when left out. */
  gatherS?: number;
  carryS?: number;
  /**
   * Given, `carryS` is how long she carries her way in this much apparent wind, knots, and it stretches in less wind
   * and shrinks in more (between 0.75 and 2.6 times). Left out, she carries her way the same in any wind.
   */
  carryAwsKt?: number;
  /** Leeway, degrees = point of sail x side force x (leewayBaseDeg + leewayPerHeelDeg x heel). 3 and 0.12 when left out. */
  leewayBaseDeg?: number;
  leewayPerHeelDeg?: number;
  /** The most leeway she makes however slowly she is going, degrees. 25 when left out. */
  leewayMaxDeg?: number;
  /** The closest the pilot sails her to the true wind, degrees. 44 when left out. */
  closeHauledDeg?: number;
  /** How hard her bows blow off the wind with no way on, against a sloop's. 1 when left out. */
  blowOff?: number;
  /**
   * Seconds from the start of one tack or gybe before the route pilot will begin another: for a boat that is slow
   * through a tack and needs time to get going again. Given, the pilot also steers her warily: until the time is up
   * she holds the tack she is on instead of being steered through the wind for the mark, and she short-tacks off a
   * shore that lies in her way on a fetch as well as on a beat. Left out, 25 seconds and a sloop's ways.
   */
  pilotRestS?: number;
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
    main: {
      areaM2: number; reefs: ReefSpec[]; sheetMinDeg: number; sheetMaxDeg: number;
      /** Width of the head of the sail as a share of its foot, for drawing: a square-top main. Left out, a pinhead. */
      squareTop?: number;
    };
    jib: {
      areaM2: number; sheetHardDeg: number; sheetMaxSlackDeg: number;
      /**
       * A jib on a single sheet led to a track ahead of the mast. It crosses by itself in a tack, so either winch
       * works the one sheet, and it cannot be held aback.
       */
      selfTacking?: boolean;
      /**
       * In a tack the crew is handling they hold a self-tacking jib aback by hand to push her bows through the wind:
       * how fast that turns her in 10 kt of apparent wind, degrees a second. Left out, nobody does.
       */
      backByHandDegS?: number;
    };
    /** Left out, she has no spinnaker to set. */
    spinnaker?: SpinnakerSpec;
  };
  heel: {
    perKnot: number; offset: number; mainShare: number; jibShare: number;
    penaltyStartDeg: number; penaltyPerDeg: number; penaltyFloor: number;
    rudderFadeStartDeg: number; rudderFadeRangeDeg: number; maxDeg: number;
    /**
     * Heel, in degrees by the law above, past which a hard wind overpowers her: the more she is pressed beyond it the
     * faster she lies over. 20 when left out.
     */
    overpowerDeg?: number;
  };
  rightingCurve: { deg: number[]; gz: number[] };
  helm: { maxRudderDeg: number; turnGain: number; rudderDrag: number };
  /** Left out, she has no engine. */
  engine?: EngineSpec;
  /** Left out, she heels to her sail like any monohull. */
  pressed?: PressedSpec;
  handling?: HandlingSpec;
  controls: ControlBinding[];
}

export type ControlName = 'rudder' | 'mainsheet' | 'jibsheet_port' | 'jibsheet_stbd' | 'furl' | 'reef' | 'pilot' | 'spinsheet';

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
  /** How many times she has been pressed past her limit and capsized. Each one is counted in `knockdowns` too. Only a boat with a `pressed` limit can. */
  capsizes: number;
  /** What is holding her: nothing, her own anchor, or a mooring or dock line. Held, her sails are stowed. */
  hold: 'none' | 'anchor' | 'mooring';
  /** Where the anchor or mooring is. */
  holdX: number;
  holdY: number;
  /** Metres of rode or line between that point and the bow. */
  holdScope: number;
  /** The spinnaker is wanted up. It takes a few seconds to go up and to come down: `spinHoist` is how far it has got. */
  spin: boolean;
  /** 0 in its bag, 1 set and flying. */
  spinHoist: number;
  /** Spinnaker sheet as the widest clew angle off the centreline it allows. */
  spinSheet: number;
  /** Spinnaker clew angle off the centreline, positive to starboard. */
  spinAngle: number;
  /** Seconds it stays collapsed: after a gybe, or a broach. */
  spinCollapse: number;
  /** Wrapped round the forestay. It does nothing until it has been taken down. */
  spinWrapped: boolean;
  /** How many times it has wrapped. */
  spinWraps: number;
  /** How many times the spinnaker has laid her over. Each one is counted in `knockdowns` too. */
  broaches: number;
  /** Seconds she has been pressed past the point of no return. A second of it and she is knocked down. */
  gustTime: number;
  /** How far the crew has let the mainsheet out beyond its best setting to spill a gust, radians. */
  gustEase: number;
  /** The engine is running. */
  engineOn: boolean;
  /** Seconds of cranking left before it fires. Above 0 it is being started. */
  engineCrank: number;
  /** Throttle position: 0 neutral, 1 to 4 ahead (slow, half, cruise, full), -1 and -2 astern. See `THROTTLE`. */
  throttle: number;
  /** Litres burned since the tank was last filled. */
  fuelUsed: number;
  /** Amp hours taken out of the battery since it was last full. */
  batteryUsed: number;
  /** How many times the engine has stopped for want of fuel. */
  engineStops: number;
  /** How many times the pilot has dropped out because the battery was too low. */
  batteryTrips: number;
  /**
   * Hull damage, 0 sound to 1 holed. It slows her (see `damageSpeed`), and holed she stops. The sim only honours it:
   * whoever knows about collisions and repairs sets it.
   */
  damage: number;
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
  /** The spinnaker. All zeros when it is not up. `flogging` means collapsed. */
  spin: SailReport;
  /**
   * Degrees of heel load beyond what she can carry: 0 unless she is overpowered by a hard wind or by her spinnaker.
   * For a boat with a `pressed` limit it is knots of apparent wind over that limit.
   */
  overpower: number;
  /** For a boat with a `pressed` limit: the load on her set sail as a share of that limit. 1 is the limit. 0 for any other boat. */
  press: number;
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
  /** What the rev counter shows. 0 with the engine off. */
  engineRpm: number;
  /** Litres of fuel left. */
  fuel: number;
  /** Battery charge, 0 flat to 1 full. */
  battery: number;
  /** True while the engine is running and in gear. */
  underPower: boolean;
}
