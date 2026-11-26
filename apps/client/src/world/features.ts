// What a water's `features.json` and `sea.json` hold: the things on the chart that are not land, depth or weather.
// Both files are optional. A water without them has none of this, and nothing changes for it.
// All positions are flat metres east (x) and north (y) of the course origin.

/** A piece of water with a name and something to say about it: a shoal that breaks, a traffic lane, a refuge. */
export interface ChartArea {
  id: string;
  name: string;
  /**
   * `hazard`: dangerous water, drawn hatched in red with its name, and the crew is warned on the way in.
   * `lane`: one lane of a traffic separation scheme, with `toward` the way its traffic runs.
   * `separation`: the zone between two lanes. Nobody sails along it.
   * `precaution`: where lanes meet and ships turn: the pilot area.
   * `refuge`: an approach limit round a wildlife refuge. A courtesy line, with a word to the crew inside it.
   * `keepclear`: the ring round something built in the sea (an oil platform): a red ring, and a word on the way in.
   */
  kind: 'hazard' | 'lane' | 'separation' | 'precaution' | 'refuge' | 'keepclear';
  /** The outline, as corners in order. Left out for a round area, which gives `circle` instead. */
  points?: Array<[number, number]>;
  circle?: { x: number; y: number; r: number };
  /** Degrees true, the way traffic runs in a lane. */
  toward?: number;
  /** What the chart says under the name. */
  say?: string;
  /** What the crew says when the boat enters. Left out, nothing is said. */
  warn?: string;
  /** For a hazard: the least charted depth in it, metres, for the label. */
  least?: number;
  /** True where landing is forbidden: the tender stays aboard inside it. */
  noLanding?: boolean;
  /** True in a marine reserve where nothing may be taken: no fishing, no pots, no lobster. For whoever fishes or dives. */
  noTake?: boolean;
}

/**
 * Something built in the sea that a boat cannot sail through: a breakwater, an oil platform, a man-made island, a pier.
 * This is the record of where each one is. `scene/structures.ts` draws it from here, the chart marks it, and
 * `scripts/stamp.ts` writes it into the water's baked depth as land cells, which is what makes it solid to every boat,
 * pilot and script without any of them knowing about this list. Anything else that wants to know where the platforms
 * are (fishing, diving) reads this.
 */
export interface Structure {
  id: string;
  name: string;
  kind: 'breakwater' | 'platform' | 'island' | 'pier';
  /** A breakwater or a pier: its centreline, end to end. */
  line?: Array<[number, number]>;
  /** A platform or an island: its centre. */
  x?: number;
  y?: number;
  /** An island: its radius, metres. A platform: the size of its deck along and across, and the way its long side lies, degrees true. */
  r?: number;
  w?: number;
  d?: number;
  turn?: number;
  /** Height of the top of a wall or the main deck of a platform above the sea, metres. */
  height?: number;
  /** Charted depth of water it stands in, metres, where that is more than the baked chart can say. */
  depth?: number;
  /** A platform joined to another by a footbridge: the other's id. */
  bridgeTo?: string;
  /** What dresses an island: `resort` is palms, a waterfall and towers that hide the drilling rigs. */
  dress?: string;
  say?: string;
}

/** A stretch of shore where giant kelp reaches the surface. `scene/kelp.ts` turns these into the canopy that is drawn. */
export interface KelpBed {
  id: string;
  name: string;
  /** The line the bed lies along, close to the shore. */
  line: Array<[number, number]>;
  /** How far either side of the line to look for water of the right depth, metres. */
  reach: number;
  /** The charted depths it grows in here, metres, where they are not the usual 3.5 to 24. */
  depth?: [number, number];
  /** Water inside the bed's reach that has none, as [x, y, radius]: a harbor's moorings, an anchorage's sand. */
  clear?: Array<[number, number, number]>;
}

/** A lighthouse or lit mark: drawn on the land, labelled on the chart, and lit after dark with its own rhythm. */
export interface Light {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Height of the light above the sea, metres. */
  focal: number;
  /** Height of the tower itself, metres. */
  tower: number;
  /** As a chart writes it: "Fl W 5s", "Oc W 4s". */
  character: string;
  /** Seconds for the whole rhythm, and the seconds within it that the light shows. */
  period: number;
  shows: number;
  /** Nominal range, nautical miles. */
  range: number;
  colour?: string;
  /** `rock` stands the tower on a drawn rock in the water (Mile Rocks). `buoy` is a lit buoy: no tower is built. */
  on?: 'land' | 'rock' | 'buoy';
  say?: string;
}

export interface CourseFeatures {
  note?: string;
  areas: ChartArea[];
  lights: Light[];
  /** What stands in the sea and is solid: breakwaters, platforms, islands. Left out, there is nothing. */
  structures?: Structure[];
  /** Where kelp grows to the surface. Left out, there is none. */
  kelp?: KelpBed[];
  /** What this water wants of the weather that the game does not yet draw: read by whoever builds it. */
  fog?: { say: string; base: number; top: number; clearsBy: number; returnsBy: number; where: string };
  /** Where this water meets the next one: the line a boat would cross to pass between them. */
  handover?: Array<{ to: string; name: string; line: [[number, number], [number, number]]; say: string }>;
}

/** One train of waves: height in metres (significant), period in seconds, and the direction it comes from, degrees true. */
export interface Swell {
  height: number;
  period: number;
  from: number;
  name?: string;
}

/**
 * A water's `sea.json`: the record behind the swell its `about.json` declares in its `sea` block (which is what the
 * sea-state model in `packages/world/src/sea.ts` reads). `swell` here is that same declaration, in the record's terms.
 * `recorded` is what a wave model said of the replayed season itself, hour by hour, for whoever wants every hour of it.
 */
export interface SeaRecord {
  note?: string;
  swell: Swell[];
  /** What a typical day brings, where the replayed day was not typical. For a model that wants it. */
  typical?: Swell[];
  /** Where the open-ocean swell is cut off: east of this line (inside the Gate) it is not felt. */
  shelter?: { say: string; fullWestOf: number; noneEastOf: number };
  recorded?: {
    source: string;
    at: { lat: number; lon: number; name: string };
    start: string;
    stepSeconds: number;
    /** Combined sea: significant height in metres per step. */
    height: number[];
    /** Each train per step: [height m, period s, from degrees], or null where the model has none. */
    windSea: Array<[number, number, number] | null>;
    swell1: Array<[number, number, number] | null>;
    swell2: Array<[number, number, number] | null>;
  };
}

/** True if a place is inside an area. */
export function inArea(a: ChartArea, x: number, y: number): boolean {
  if (a.circle) return Math.hypot(x - a.circle.x, y - a.circle.y) <= a.circle.r;
  const p = a.points;
  if (!p || p.length < 3) return false;
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True while a light shows, at a moment in the season. A pure function of time, so every boat sees the same flash. */
export function lightShows(l: Light, seasonTime: number): boolean {
  const t = ((seasonTime % l.period) + l.period) % l.period;
  return t < l.shows;
}
