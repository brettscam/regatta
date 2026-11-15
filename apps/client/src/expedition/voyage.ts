// What a voyage is, as data. A voyage brings its own sea (built from this by `sea.ts`), its own boat (a file in
// `boats/`) and its own record of what happened. Adding a voyage should add a file like `voyages/caird.ts`, not code.

/** A corner of a coastline as [degrees south, degrees west], both written positive. */
export type SW = [number, number];

export interface Island {
  name: string;
  /** Which patch of land it is drawn with: islands of one group share a terrain grid. */
  group: string;
  /** The coast, in order round the island. */
  outline: SW[];
  /** Highest ground, metres. */
  peak: number;
  /** The line of the high ground, where it is known: [degrees south, degrees west, metres]. */
  spine?: Array<[number, number, number]>;
}

export interface Rock {
  name: string;
  at: SW;
}

/** The weather at one moment of the script. Between moments it is blended, and the seed moves it about. */
export interface WeatherPoint {
  /** Hour of the ship's day, 0 to 24. */
  hour: number;
  /** Direction the wind blows from, degrees true. */
  from: number;
  /** Mean wind, knots. */
  kt: number;
  /** Share of the sky covered, 0 clear to 1 solid. */
  cloud: number;
  /** Air temperature, Celsius. */
  air: number;
}

export interface ScriptDay {
  /** Days since the day of departure. */
  day: number;
  date: string;
  /** What the record says of this day. */
  record: string;
  /** How far the detail can be trusted: see the note at the head of the voyage file. */
  sure: 'attested' | 'probable' | 'reconstructed';
  weather: WeatherPoint[];
}

/** Something the record says happened, for the later stages to act on. Nothing reads these yet. */
export interface RecordedEvent {
  day: number;
  hour: number;
  kind: string;
  record: string;
}

export interface Voyage {
  id: string;
  title: string;
  /** The line under the title on the voyage card. */
  line: string;
  /** The briefing, a paragraph to a string. */
  briefing: string[];
  /** The boat's file in `boats/`. */
  boat: string;
  boatName: string;
  sea: {
    id: string;
    name: string;
    /** Centre of the chart's projection, degrees (south and west negative). */
    lat0: number;
    lon0: number;
    /** The limits of the sea, degrees. */
    south: number;
    north: number;
    west: number;
    east: number;
  };
  timeZone: string;
  /** Midnight, ship's time, at the start of the day of departure. */
  dayZero: string;
  /** Hours into that day she casts off. */
  castOff: number;
  /** Days of weather to make. */
  days: number;
  from: { name: string; lat: number; lon: number; headingDeg: number };
  to: { name: string; lat: number; lon: number; /** Metres: inside this she has arrived. */ radius: number };
  /** Past this longitude she has missed the land. */
  lostEast: number;
  islands: Island[];
  rocks: Rock[];
  script: ScriptDay[];
  /** Ice afloat: south of `north` (degrees, negative south) in the first `days` days. */
  ice: { north: number; days: number };
  /** The set of the ocean: degrees true it flows toward, and its rate in knots, lowest to highest. */
  drift: { toward: number; spread: number; kt: [number, number] };
  events: RecordedEvent[];
}
