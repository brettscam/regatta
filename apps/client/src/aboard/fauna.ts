/**
 * The animals of the water: which live where, and what each is doing at any moment.
 * Nothing here touches the screen or the scene, and nothing is left to chance. Where an animal is and whether it is up
 * or down is worked out from the season's clock and a hash, so every boat on the water sees the same porpoise roll in
 * the same place, and a test can pin it. The drawing is in `wildlife.ts`.
 * Sim conventions: x east, y north, metres. Heading is compass radians, clockwise from north. Times in season seconds.
 */
import { hash01 } from './catch';

export type Kind = 'porpoise' | 'sealion' | 'seal' | 'humpback' | 'pelican' | 'cormorant' | 'gull';
export const KINDS: Kind[] = ['porpoise', 'sealion', 'seal', 'humpback', 'pelican', 'cormorant', 'gull'];

/** What each is called, and the one remark made the first time it is seen on a sail. */
export const FIELD_GUIDE: Record<Kind, { name: string; first: string }> = {
  porpoise: {
    name: 'Harbor porpoise',
    first: 'Harbor porpoise: a dark back and a small three-cornered fin, rolling without a splash. They came back to the Bay about 2008 after sixty years away, and they keep clear of boats',
  },
  sealion: {
    name: 'California sea lion',
    first: 'California sea lions. They took over the floats at Pier 39 in the winter after the 1989 earthquake. In July most are away south at the Channel Islands rookeries, so the floats are thin',
  },
  seal: {
    name: 'Harbor seal',
    first: 'A harbor seal, head up, watching you. A round head with no ear flaps and a spotted coat: that is how to tell her from a sea lion. She will sink without a ripple',
  },
  humpback: {
    name: 'Humpback whale',
    first: 'A blow, tall and bushy: a humpback. Since 2016 a few have followed the anchovy in through the Gate on the flood. Keep a hundred yards off her',
  },
  pelican: {
    name: 'Brown pelican',
    first: 'Brown pelicans, gliding in line a wing tip off the water. They nest on the Channel Islands and in Mexico and come north for the summer. A single bird folding up and dropping means bait fish',
  },
  cormorant: {
    name: 'Cormorant',
    first: 'Cormorants, low and fast and dead straight. Brandt\'s nest on Alcatraz, double-crested on the bridges, and both dry their wings on the buoys',
  },
  gull: {
    name: 'Western gull',
    first: 'Western gulls, the big dark-backed gull of this coast. Hundreds of pairs nest on Alcatraz. Where they gather over the water, something is feeding underneath',
  },
};

/** How far off each is worked out and drawn, metres. A whale's blow and a line of birds carry a long way. A seal's head does not. */
export const SIGHT: Record<Kind, number> = { porpoise: 450, sealion: 450, seal: 320, humpback: 2600, pelican: 1500, cormorant: 900, gull: 1300 };
/** How close before the crew can be said to have seen one. */
export const NOTICE: Record<Kind, number> = { porpoise: 280, sealion: 260, seal: 140, humpback: 2200, pelican: 600, cormorant: 320, gull: 450 };
/** Whale-watching rule: a hundred yards. A little over, so the word comes before the line is crossed. */
export const WHALE_ROOM = 100;

export type Pose =
  /** A porpoise's roll: back and fin over in an arc. */
  | 'roll'
  /** A head out of the water, looking about. */
  | 'head'
  /** Lying on a float. */
  | 'hauled'
  /** A sea lion clearing the water as it travels. */
  | 'leap'
  /** A whale's back sliding over. */
  | 'back'
  /** A whale's flukes going down. */
  | 'fluke'
  | 'fly'
  /** Wings folded, falling on bait fish. */
  | 'plunge'
  /** A bird sitting on the water. */
  | 'sit'
  /** A bird standing on a buoy. */
  | 'perch';

export interface Animal {
  kind: Kind;
  pose: Pose;
  x: number;
  y: number;
  heading: number;
  /** Height above the sea, metres: of a bird in the air, or of the float or buoy an animal is on. */
  up: number;
  /** 0 to 1 through a roll, a leap, a back or a fluke. For a head, how far out it is. For a perched bird, 1 with its wings spread to dry. */
  phase: number;
  /** A bird's wings: 1 up, -1 down. */
  wing: number;
  /** A bird's bank, radians, positive with the starboard wing down. */
  bank: number;
  /** A whale's blow: 1 as it goes up, fading to 0. */
  blow: number;
}

/** What the animals need to know of the water. Built by the caller for the present moment. */
export interface Sea {
  /** Charted depth, metres. 0 on land. */
  depth(x: number, y: number): number;
  /** Speed of the tidal stream at a place now, m/s. */
  stream(x: number, y: number): number;
  /** Rise of tide now, metres an hour. Positive on the flood. */
  tideRate: number;
}

interface Spot { x: number; y: number; r: number; n: number; up?: number }
interface Route { path: Array<[number, number]>; n: number }

/** One sailing area's animals: who lives there and where they are found. */
export interface Fauna {
  /** Deep, fast water where porpoise work the tide. `n` is the most groups at once. */
  porpoise: Spot[];
  /** Where seals are regulars. */
  seals: Spot[];
  /** True if any quiet, shallow water may hold a seal as well. */
  quietSeals: boolean;
  /** Floats sea lions lie on: the middle of a row of three, and how many animals. */
  haulouts: Array<{ x: number; y: number; n: number }>;
  /** Where single sea lions swim. */
  sealions: Route[];
  /** The deep water a whale works on the flood, from seaward in. */
  whale: Array<[number, number]>;
  pelicans: Route[];
  cormorants: Route[];
  /** Buoys a cormorant stands on: where, and the height of the top. */
  perches: Array<{ x: number; y: number; up: number }>;
  gulls: Spot[];
  /** Tide rips and points where bait fish are driven to the top. */
  bait: Array<{ x: number; y: number }>;
  /** What the crew calls an animal here, where the Bay's name or remark for it would be wrong. */
  guide?: Partial<Record<Kind, { name: string; first: string }>>;
}

/** An animal's name and the remark made the first time it is seen, on a given water. */
export function fieldGuide(courseId: string, kind: Kind): { name: string; first: string } {
  return FAUNA[courseId]?.guide?.[kind] ?? FIELD_GUIDE[kind];
}

/**
 * Keyed by course id. A course with no entry has no animals.
 * San Francisco Bay in mid July. Coordinates are metres east and north of the course origin.
 */
export const FAUNA: Record<string, Fauna> = {
  'sf-bay': {
    porpoise: [
      // Under the bridge, where the whole Bay's tide goes through a mile of water.
      { x: -2500, y: -1150, r: 800, n: 3 },
      // Off Cavallo Point and Yellow Bluff, on the edge of the stream.
      { x: -1750, y: 750, r: 550, n: 2 },
      // Raccoon Strait.
      { x: 1300, y: 4750, r: 700, n: 2 },
    ],
    seals: [
      { x: 1300, y: 4314, r: 260, n: 2 }, // Ayala Cove
      { x: 2850, y: 2500, r: 260, n: 2 }, // Point Blunt, where they haul out on the rocks
      { x: 7333, y: -1557, r: 320, n: 2 }, // Clipper Cove and Yerba Buena
      { x: -2359, y: 2947, r: 420, n: 2 }, // Sausalito
      { x: 2415, y: -2279, r: 200, n: 1 }, // Aquatic Park
      { x: -2371, y: 278, r: 200, n: 1 }, // Horseshoe Cove
    ],
    quietSeals: true,
    haulouts: [{ x: 3415, y: -2120, n: 11 }],
    sealions: [
      // Along the city front from Fort Mason to the Ferry Building, a cable or two off the pier ends.
      { path: [[900, -2150], [2400, -2050], [3500, -1900], [4400, -2350], [4850, -3100]], n: 3 },
      // And about the Pier 39 floats themselves.
      { path: [[3200, -1980], [3650, -1960]], n: 1 },
    ],
    // The deep channel runs out to the south-west from the bridge.
    whale: [[-6800, -2400], [-5200, -1800], [-3600, -1450], [-2500, -1200], [-900, -850], [600, -650], [1500, -900]],
    pelicans: [
      { path: [[700, -2150], [2400, -2000], [3600, -1800], [4700, -2500], [5300, -3900]], n: 2 },
      { path: [[-5600, -1900], [-3600, -1350], [-2520, -1000], [-1400, 300], [-700, 1900]], n: 2 },
      { path: [[2700, -900], [3300, 700], [3200, 2400], [2400, 5100]], n: 1 },
    ],
    cormorants: [
      // Round Alcatraz, out to the fishing and back to the colony.
      { path: [[1750, -350], [2100, 100], [2800, -100], [2900, -700], [2100, -800], [1750, -350]], n: 4 },
      { path: [[1700, -400], [-600, -800], [-2520, -1100], [-4500, -1300]], n: 2 },
      { path: [[-300, 3900], [1300, 4750], [2700, 5200]], n: 1 },
      { path: [[2900, -500], [3900, -1250], [4700, -2400]], n: 1 },
    ],
    perches: [{ x: 290, y: 923, up: 4.85 }, { x: 4101, y: -1301, up: 4.85 }],
    gulls: [
      { x: 2250, y: -350, r: 260, n: 9, up: 55 }, // Alcatraz
      { x: 3300, y: -2150, r: 300, n: 6, up: 18 }, // Fisherman's Wharf and Pier 39
      { x: 2415, y: -2279, r: 150, n: 2, up: 14 }, // Aquatic Park
      { x: -2359, y: 2947, r: 250, n: 3, up: 14 }, // Sausalito
    ],
    bait: [
      { x: -2300, y: -1500 }, // the south tower
      { x: -1500, y: 1000 }, // Yellow Bluff
      { x: 1500, y: -500 }, // west of Alcatraz
      { x: 3000, y: 2300 }, // Point Blunt
      { x: 2300, y: 5000 }, // the east end of Raccoon Strait
      { x: 300, y: 1100 }, // Harding Rock
      { x: 4300, y: -1400 }, // Blossom Rock
    ],
  },
  // The British Virgin Islands in February. Only the animals this file already knows how to draw and that really
  // live here: pelicans and gulls. No seals, sea lions, harbor porpoise or cormorants. Turtles, rays, frigatebirds,
  // tarpon and dolphins each want a kind of their own and are not here yet. Humpbacks do winter north of the islands,
  // but the whale here is one that comes in on a strong flood, and this tide never runs hard enough to bring her.
  bvi: {
    porpoise: [],
    seals: [],
    quietSeals: false,
    haulouts: [],
    sealions: [],
    whale: [],
    pelicans: [
      { path: [[-6400, 100], [-5900, -600], [-5600, -1500], [-7300, -2900]], n: 2 }, // Road Harbour and along to Nanny Cay
      { path: [[-8700, -11100], [-7700, -11350], [-7100, -11500]], n: 1 }, // the Bight
      { path: [[17300, 8900], [18800, 8700], [20000, 8900]], n: 2 }, // North Sound
      { path: [[-22500, 2000], [-21300, 1900], [-20300, 1700]], n: 1 }, // White Bay and Great Harbour
      { path: [[-12600, 500], [-11900, 800], [-11500, 1500]], n: 1 }, // Cane Garden Bay
      { path: [[1200, 3700], [1900, 3550], [2400, 4300]], n: 1 }, // Trellis Bay and Marina Cay
    ],
    cormorants: [],
    perches: [],
    gulls: [
      { x: -8000, y: -9800, r: 260, n: 6, up: 30 }, // the Indians
      { x: -17000, y: 1800, r: 220, n: 4, up: 16 }, // Sandy Cay
      { x: 10230, y: -330, r: 240, n: 5, up: 35 }, // Fallen Jerusalem
      { x: 20000, y: 9150, r: 160, n: 3, up: 14 }, // Saba Rock
      { x: -1300, y: -6100, r: 220, n: 4, up: 40 }, // Dead Chest
    ],
    bait: [
      { x: -8700, y: -9800 }, // off the Indians
      { x: 3300, y: -4600 }, // Salt Island Passage
      { x: 18150, y: 10700 }, // the channel past Colquhoun Reef
      { x: -500, y: -10400 }, // the south end of Peter Island
      { x: -11800, y: -7000 }, // Flanagan Passage
    ],
    guide: {
      pelican: {
        name: 'Brown pelican',
        first: 'Brown pelicans, gliding in line a wing tip off the water. They are here all year and roost on the rocks and in the mangroves. A single bird folding up and dropping means bait fish',
      },
      gull: {
        name: 'Laughing gull',
        first: 'Laughing gulls, the dark-winged gull of the Caribbean, named for the call. Where they gather over the water, tuna or jacks are driving bait fish to the top',
      },
    },
  },
};

// ---- the Gulf of the Farallones (course id `farallones`) -------------------------------------------
// The ocean outside the Golden Gate in mid July, with the animals the game can already draw. Coordinates share the Bay's
// origin. Kept apart from the Bay's list above so the two can be worked on separately.
// Still wanted here, and not drawn yet because they need kinds of their own: blue whales on the krill along the shelf
// edge west of the islands; white sharks at Southeast Farallon (they come for the elephant seals from September, are
// seldom seen and are never a threat to a boat); common murres, which are most of the quarter of a million birds on the
// islands; sooty shearwaters in rafts of thousands offshore; a black-footed albatross now and then west of the islands;
// and sea lions hauled out on the rocks themselves rather than on floats.
FAUNA.farallones = {
  porpoise: [
    // Off Point Bonita and in the Bonita Channel, where the ebb meets the swell.
    { x: -7800, y: -2600, r: 800, n: 3 },
    { x: -9800, y: 400, r: 600, n: 2 },
    // Under the bridge, as on the Bay.
    { x: -2500, y: -1150, r: 800, n: 2 },
    // Off Bodega Head, off Chimney Rock, and round Pillar Point.
    { x: -53500, y: 51500, r: 900, n: 2 },
    { x: -44600, y: 17300, r: 900, n: 2 },
    { x: -5000, y: -38000, r: 800, n: 2 },
  ],
  seals: [
    { x: -20300, y: 8300, r: 350, n: 3 }, // the mouth of Bolinas Lagoon, where they haul out on the sand bar
    { x: -45600, y: 19000, r: 400, n: 2 }, // Drakes Bay, under Chimney Rock
    { x: -52900, y: 53300, r: 250, n: 2 }, // Bodega Harbour, inside the jetties
    { x: -3200, y: -36900, r: 300, n: 2 }, // Pillar Point Harbor
    { x: -2371, y: 278, r: 200, n: 1 }, // Horseshoe Cove
  ],
  quietSeals: true,
  // No floats out here. The sea lions of the islands lie on the rocks, which the game does not draw them on yet.
  haulouts: [],
  sealions: [
    // Round Southeast Farallon, just off the rocks, and in Fisherman Bay.
    { path: [[-47900, -14100], [-48400, -13700], [-49300, -13900], [-49900, -14500], [-49500, -15200], [-48600, -15400], [-47900, -14800], [-47900, -14100]], n: 5 },
    { path: [[-49200, -14050], [-48850, -14150]], n: 2 },
    // The fish dock at Bodega, Pillar Point's breakwater, and Seal Rocks off the Cliff House.
    { path: [[-52700, 55800], [-52300, 55600], [-52000, 55350]], n: 2 },
    { path: [[-3200, -37200], [-3100, -37000], [-2900, -36850]], n: 2 },
    { path: [[-6500, -5800], [-6700, -6300], [-6500, -6700]], n: 3 },
  ],
  // Humpbacks feed on anchovy and krill between the islands and the bar all summer. On the flood one works in toward the channel.
  whale: [[-47000, -18500], [-42000, -14500], [-36000, -11000], [-28000, -8500], [-21000, -7200], [-14500, -6400]],
  pelicans: [
    { path: [[-2520, -1000], [-5600, -2300], [-7400, -2900], [-10000, 300], [-14000, 2900], [-19500, 7000]], n: 2 },
    { path: [[-6300, -5500], [-6200, -12000], [-5500, -21000], [-7600, -26500], [-6500, -33500], [-3600, -37400]], n: 2 },
    { path: [[-44800, 17400], [-46500, 20200], [-43500, 20900], [-40500, 18500]], n: 2 },
    { path: [[-52200, 51900], [-52300, 52800], [-53100, 53300], [-52900, 55300]], n: 1 },
  ],
  cormorants: [
    // The colonies: Southeast Farallon, Bodega Rock, and the cliffs under Point Reyes and Point Bonita.
    { path: [[-48300, -14300], [-47800, -13500], [-48900, -13300], [-50100, -14300], [-49300, -15500], [-48200, -15200], [-48300, -14300]], n: 6 },
    { path: [[-48300, -14300], [-45500, -12500], [-42000, -11000]], n: 3 },
    { path: [[-52500, 51800], [-51500, 52600], [-52700, 52850]], n: 3 },
    { path: [[-50400, 17900], [-51600, 16800], [-49000, 16500], [-45400, 17500]], n: 3 },
    { path: [[-7100, -1900], [-8200, -2600], [-6000, -3900], [-5300, -4100]], n: 2 },
  ],
  // The sea buoy and the channel buoys.
  perches: [{ x: -21342, y: -8896, up: 4.85 }, { x: -11944, y: -5449, up: 4.85 }, { x: -16159, y: -7228, up: 4.85 }],
  gulls: [
    { x: -48800, y: -14500, r: 700, n: 14, up: 70 }, // Southeast Farallon: the biggest western gull colony there is
    { x: -57000, y: -7000, r: 400, n: 6, up: 40 }, // the North Farallones
    { x: -52500, y: 51800, r: 250, n: 5, up: 20 }, // Bodega Rock
    { x: -52100, y: 55400, r: 250, n: 5, up: 14 }, // the fish dock at Bodega
    { x: -2800, y: -36700, r: 250, n: 5, up: 14 }, // Johnson Pier
    { x: -4300, y: -21850, r: 200, n: 4, up: 14 }, // Pacifica Pier
    { x: -6600, y: -6200, r: 250, n: 5, up: 22 }, // Seal Rocks
    { x: -50300, y: 18300, r: 400, n: 5, up: 80 }, // the Point Reyes cliffs
  ],
  bait: [
    { x: -7700, y: -2900 }, // off Point Bonita
    { x: -11900, y: -5300 }, // the edge of the bar, by buoy 8
    { x: -22200, y: 5200 }, // the end of Duxbury Reef
    { x: -44400, y: 17100 }, // off Chimney Rock
    { x: -51800, y: 16600 }, // off Point Reyes
    { x: -47300, y: -13700 }, // north-east of Southeast Farallon
    { x: -50600, y: -15300 }, // and south-west of it
    { x: -53900, y: 51200 }, // off Bodega Head
    { x: -5400, y: -38300 }, // the reef off Pillar Point
  ],
};
// ---- end of the Gulf of the Farallones --------------------------------------------------------------

// ---- small helpers ----------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Time into a repeating cycle, and which turn of it this is. `shift` (0 to 1) staggers one animal against another. */
function cycle(now: number, length: number, shift: number): { turn: number; into: number } {
  const t = now + shift * length;
  const turn = Math.floor(t / length);
  return { turn, into: t - turn * length };
}
function nearestBoat(x: number, y: number, boats: ReadonlyArray<{ x: number; y: number }>): number {
  let best = Infinity;
  for (const b of boats) best = Math.min(best, Math.hypot(b.x - x, b.y - y));
  return best;
}

export function pathLength(path: ReadonlyArray<[number, number]>): number {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return l;
}

const at = { x: 0, y: 0, heading: 0 };
/** The point `s` metres along a path, and the compass heading of the path there. The answer is reused: copy what is needed. */
export function pathPoint(path: ReadonlyArray<[number, number]>, s: number): { x: number; y: number; heading: number } {
  let left = Math.max(0, s);
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    const l = Math.hypot(dx, dy);
    if (left <= l || i === path.length - 1) {
      const u = l > 0 ? Math.min(1, left / l) : 0;
      at.x = path[i - 1][0] + dx * u;
      at.y = path[i - 1][1] + dy * u;
      at.heading = Math.atan2(dx, dy);
      return at;
    }
    left -= l;
  }
  at.x = path[0][0];
  at.y = path[0][1];
  at.heading = 0;
  return at;
}

/** A list that is filled afresh each frame without making new objects. */
export class Sightings {
  readonly list: Animal[] = [];
  count = 0;
  clear(): void {
    this.count = 0;
  }
  add(kind: Kind, pose: Pose, x: number, y: number, heading: number): Animal {
    let a = this.list[this.count];
    if (!a) this.list[this.count] = a = { kind, pose, x, y, heading, up: 0, phase: 0, wing: 0, bank: 0, blow: 0 };
    this.count++;
    a.kind = kind;
    a.pose = pose;
    a.x = x;
    a.y = y;
    a.heading = heading;
    a.up = 0;
    a.phase = 0;
    a.wing = 0;
    a.bank = 0;
    a.blow = 0;
    return a;
  }
  /** Those found, as a plain list. For tests and the console. */
  all(): Animal[] {
    return this.list.slice(0, this.count).map((a) => ({ ...a }));
  }
}

type Boats = ReadonlyArray<{ x: number; y: number }>;
interface Look {
  now: number;
  sea: Sea;
  eye: { x: number; y: number };
  boats: Boats;
  out: Sightings;
}
const inSight = (l: Look, kind: Kind, x: number, y: number, margin = 0) => Math.hypot(x - l.eye.x, y - l.eye.y) <= SIGHT[kind] + margin;

/** Where to look, as it is called from the helm: "On the port bow, 180 m off". */
export function whereAway(x: number, y: number, heading: number, toX: number, toY: number): string {
  const range = Math.hypot(toX - x, toY - y);
  let rel = Math.atan2(toX - x, toY - y) - heading;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const side = rel >= 0 ? 'starboard' : 'port';
  const off = (Math.abs(rel) * 180) / Math.PI;
  const bearing = off < 12 ? 'Dead ahead' : off < 67 ? `On the ${side} bow` : off < 113 ? `Abeam to ${side}` : off < 168 ? `On the ${side} quarter` : 'Right astern';
  const far = range < 95 ? `${Math.max(10, Math.round(range / 10) * 10)} m` : range < 1000 ? `${Math.round(range / 50) * 50} m` : `${(range / 1852).toFixed(1)} nm`;
  return `${bearing}, ${far} off`;
}

// ---- porpoise ---------------------------------------------------------------------------------------

/** A group keeps to one patch of water for this long, then turns up somewhere else in its haunt. */
const PORPOISE_PATCH = 1200;
/** Seconds a roll lasts, and between one roll and the next in a bout. */
const ROLL = 2.4;
const ROLL_GAP = 9;
const ROLLS = 5;
/** Stream, m/s, that brings a second group to a haunt, and twice it a third. */
export const PORPOISE_TIDE = 0.3;
/** They sound when a boat is this close. */
const PORPOISE_SHY = 30;

function porpoises(f: Fauna, l: Look): void {
  const { now, sea } = l;
  f.porpoise.forEach((h, hi) => {
    if (!inSight(l, 'porpoise', h.x, h.y, h.r + 200)) return;
    const run = sea.stream(h.x, h.y);
    for (let g = 0; g < h.n; g++) {
      // One group is about most of the time. More come when the tide runs hard.
      if (g > 0 && run < PORPOISE_TIDE * g) continue;
      const patch = cycle(now, PORPOISE_PATCH, hash01(hi, g, 31));
      if (g === 0 && hash01(hi, patch.turn, 30) > 0.8) continue;
      // Down for the half minute either side of moving on.
      if (patch.into < 30 || patch.into > PORPOISE_PATCH - 30) continue;
      let hx = 0;
      let hy = 0;
      let found = false;
      for (let k = 0; k < 6 && !found; k++) {
        const a = TAU * hash01(hi, g, patch.turn, k, 32);
        const r = h.r * Math.sqrt(hash01(hi, g, patch.turn, k, 33));
        hx = h.x + Math.sin(a) * r;
        hy = h.y + Math.cos(a) * r;
        found = sea.depth(hx, hy) >= 12;
      }
      if (!found) continue;
      // They quarter the patch slowly, a knot or two.
      const t1 = 420 + 120 * hash01(hi, g, 34);
      const t2 = 520 + 160 * hash01(hi, g, 35);
      const p1 = TAU * (now / t1 + hash01(hi, g, 36));
      const p2 = TAU * (now / t2 + hash01(hi, g, 37));
      const cx = hx + 110 * Math.sin(p1);
      const cy = hy + 110 * Math.sin(p2);
      const heading = Math.atan2(Math.cos(p1) / t1, Math.cos(p2) / t2);
      if (!inSight(l, 'porpoise', cx, cy, 20)) continue;
      if (nearestBoat(cx, cy, l.boats) < PORPOISE_SHY) continue;
      const size = 2 + Math.floor(hash01(hi, g, patch.turn, 38) * 4);
      // A bout of rolls, then a couple of minutes down.
      const bout = cycle(now, 100 + 50 * hash01(hi, g, 39), hash01(hi, g, 40));
      for (let i = 0; i < size; i++) {
        const rt = bout.into - i * 0.7 - 0.8 * hash01(hi, g, i, 41);
        if (rt < 0) continue;
        const k = Math.floor(rt / ROLL_GAP);
        const within = rt - k * ROLL_GAP;
        if (k >= ROLLS || within >= ROLL) continue;
        const side = (i - (size - 1) / 2) * 3.5;
        const back = 5 * hash01(hi, g, i, 42);
        const a = l.out.add('porpoise', 'roll', cx + Math.cos(heading) * side - Math.sin(heading) * back, cy - Math.sin(heading) * side - Math.cos(heading) * back, heading);
        a.phase = within / ROLL;
      }
    }
  });
}

// ---- harbor seals -----------------------------------------------------------------------------------

/** A seal lets a boat come this close, then sinks. */
const SEAL_SHY = 28;
/** Quiet-water seals are looked for in squares this size. */
const SEAL_CELL = 600;

function seal(l: Look, key: number, x: number, y: number, r: number, i: number): void {
  const c = cycle(l.now, 80 + 60 * hash01(key, i, 43), hash01(key, i, 44));
  const upFor = 25 + 20 * hash01(key, i, c.turn, 45);
  if (c.into > upFor) return;
  // Each time she comes up it is somewhere new, not far off.
  for (let k = 0; k < 4; k++) {
    const a = TAU * hash01(key, i, c.turn, k, 46);
    const d = r * Math.sqrt(hash01(key, i, c.turn, k, 47));
    const sx = x + Math.sin(a) * d;
    const sy = y + Math.cos(a) * d;
    const depth = l.sea.depth(sx, sy);
    if (depth < 1 || depth > 16) continue;
    if (!inSight(l, 'seal', sx, sy)) return;
    const shy = clamp01((nearestBoat(sx, sy, l.boats) - SEAL_SHY) / 8);
    if (shy <= 0) return;
    // She watches whoever is nearest.
    const s = l.out.add('seal', 'head', sx, sy, Math.atan2(l.eye.x - sx, l.eye.y - sy));
    s.phase = Math.min(1, c.into / 1.5, (upFor - c.into) / 2.5) * shy;
    return;
  }
}

function seals(f: Fauna, l: Look): void {
  f.seals.forEach((h, hi) => {
    if (!inSight(l, 'seal', h.x, h.y, h.r)) return;
    for (let i = 0; i < h.n; i++) seal(l, hi, h.x, h.y, h.r, i);
  });
  if (!f.quietSeals) return;
  // Anywhere shallow and out of the stream may have one.
  const reach = SIGHT.seal + 80;
  for (let ci = Math.floor((l.eye.x - reach) / SEAL_CELL); ci <= Math.floor((l.eye.x + reach) / SEAL_CELL); ci++) {
    for (let cj = Math.floor((l.eye.y - reach) / SEAL_CELL); cj <= Math.floor((l.eye.y + reach) / SEAL_CELL); cj++) {
      if (hash01(ci, cj, 48) > 0.3) continue;
      const x = (ci + 0.15 + 0.7 * hash01(ci, cj, 49)) * SEAL_CELL;
      const y = (cj + 0.15 + 0.7 * hash01(ci, cj, 50)) * SEAL_CELL;
      if (!quietShallows(l.sea, x, y)) continue;
      seal(l, 1000 + ci * 131 + cj, x, y, 70, 0);
    }
  }
}

/** Water a seal likes when nobody has told her where to be: a couple of metres to eight, and little stream. */
export function quietShallows(sea: Sea, x: number, y: number): boolean {
  const d = sea.depth(x, y);
  return d >= 1.5 && d <= 8 && sea.stream(x, y) < 0.35;
}

// ---- sea lions --------------------------------------------------------------------------------------

/** Height of a float's deck above the water. */
export const FLOAT_DECK = 0.4;
export const FLOAT_LENGTH = 7;
export const FLOAT_BEAM = 4;

/** The floats sea lions lie on: three in a row, east and west, for each haul-out. */
export function haulFloats(courseId: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const h of FAUNA[courseId]?.haulouts ?? []) for (let k = -1; k <= 1; k++) out.push({ x: h.x + k * (FLOAT_LENGTH + 2), y: h.y });
  return out;
}

function sealions(f: Fauna, l: Look): void {
  const { now } = l;
  f.haulouts.forEach((h, hi) => {
    if (!inSight(l, 'sealion', h.x, h.y, 20)) return;
    // They come and go by the hour, but the floats are never empty.
    const hour = Math.floor(now / 3600);
    for (let i = 0; i < h.n; i++) {
      if (i > 2 && hash01(hi, i, hour, 51) < 0.25) continue;
      const k = (i % 3) - 1;
      const x = h.x + k * (FLOAT_LENGTH + 2) + (hash01(hi, i, 52) - 0.5) * (FLOAT_LENGTH - 2.2);
      const y = h.y + (hash01(hi, i, 53) - 0.5) * (FLOAT_BEAM - 1.6);
      const a = l.out.add('sealion', 'hauled', x, y, TAU * hash01(hi, i, 54));
      a.up = FLOAT_DECK;
      // Now and then one rears up to bark at its neighbour.
      const bark = cycle(now, 14 + 20 * hash01(hi, i, 55), hash01(hi, i, 56));
      a.phase = bark.into < 3 ? Math.sin((bark.into / 3) * Math.PI) : 0;
    }
  });
  f.sealions.forEach((route, ri) => {
    const len = pathLength(route.path);
    for (let i = 0; i < route.n; i++) {
      // Up and down the front at a walking pace.
      const lap = cycle(now * 1.6, 2 * len, hash01(ri, i, 57));
      const out = lap.into < len;
      const p = pathPoint(route.path, out ? lap.into : 2 * len - lap.into);
      const heading = out ? p.heading : p.heading + Math.PI;
      const off = (hash01(ri, i, 58) - 0.5) * 120;
      const x = p.x + Math.cos(p.heading) * off;
      const y = p.y - Math.sin(p.heading) * off;
      if (!inSight(l, 'sealion', x, y)) continue;
      if (l.sea.depth(x, y) < 2 || nearestBoat(x, y, l.boats) < 30) continue;
      const c = cycle(now, 40 + 30 * hash01(ri, i, 59), hash01(ri, i, 60));
      if (hash01(ri, i, c.turn, 61) < 0.3) {
        // Porpoising: four or five leaps on the trot.
        const k = Math.floor(c.into / 1.6);
        const within = c.into - k * 1.6;
        if (k >= 5 || within > 1.2) continue;
        l.out.add('sealion', 'leap', x, y, heading).phase = within / 1.2;
      } else {
        if (c.into > 11) continue;
        l.out.add('sealion', 'head', x, y, heading).phase = Math.min(1, c.into / 1, (11 - c.into) / 1.5);
      }
    }
  });
}

// ---- the humpback -----------------------------------------------------------------------------------

/** The flood is looked at an hour at a time, and in fewer than a third of those hours a whale is in. */
const WHALE_HOUR = 3600;
export const WHALE_ODDS = 0.3;
/** Rise of tide, metres an hour, that counts as the flood. */
export const WHALE_FLOOD = 0.06;
/** Seconds from one blow to the next, and that a back takes to slide over. */
const BLOW_GAP = 16;
const BACK = 5.5;
const FLUKE = 5;
/** She goes down and stays down when a boat is on top of her. */
const WHALE_SHY = 60;

export interface Whale {
  x: number;
  y: number;
  heading: number;
  /** 0 to 1 through the showing of her back, or -1 while she is under. */
  back: number;
  /** 0 to 1 through a fluke-up dive, or -1. */
  fluke: number;
  /** 1 as she blows, fading to 0. */
  blow: number;
}

const whaleOut: Whale = { x: 0, y: 0, heading: 0, back: -1, fluke: -1, blow: 0 };

/** Where the whale is now, if one is in. Null on the ebb, at slack, and in the hours when none has come. The answer is reused. */
export function whaleAt(courseId: string, now: number, sea: Sea): Whale | null {
  const track = FAUNA[courseId]?.whale;
  if (!track || track.length < 2) return null;
  if (sea.tideRate < WHALE_FLOOD) return null;
  const hour = Math.floor(now / WHALE_HOUR);
  if (hash01(hour, 62) >= WHALE_ODDS) return null;
  const into = now - hour * WHALE_HOUR;
  const len = pathLength(track);
  // She works a mile or so of the channel for the hour, somewhere between the sea buoy side of the bridge and Alcatraz.
  const swing = TAU * (into / WHALE_HOUR + hash01(hour, 63));
  const s = len * (0.12 + 0.76 * hash01(hour, 64)) + 600 * Math.sin(swing);
  const p = pathPoint(track, Math.min(len, Math.max(0, s)));
  const w = whaleOut;
  w.x = p.x;
  w.y = p.y;
  w.heading = Math.cos(swing) >= 0 ? p.heading : p.heading + Math.PI;
  w.back = -1;
  w.fluke = -1;
  w.blow = 0;
  // Under for the two minutes either side of the hour, so she is never seen to arrive.
  if (into < 120 || into > WHALE_HOUR - 120) return w;
  // Four to six blows a quarter of a minute apart, then down for five minutes or so.
  const c = cycle(into, 330 + 120 * hash01(hour, 65), 0);
  const blows = 4 + Math.floor(hash01(hour, c.turn, 66) * 3);
  const k = Math.floor(c.into / BLOW_GAP);
  if (k >= blows) return w;
  const bt = c.into - k * BLOW_GAP;
  if (bt < BACK) w.back = bt / BACK;
  if (bt < 4) w.blow = 1 - bt / 4;
  // About every other time, the last of them ends with her flukes in the air.
  if (k === blows - 1 && hash01(hour, c.turn, 67) < 0.5 && bt >= BACK - 1.5 && bt < BACK - 1.5 + FLUKE) w.fluke = (bt - (BACK - 1.5)) / FLUKE;
  return w;
}

function humpback(courseId: string, l: Look): void {
  const w = whaleAt(courseId, l.now, l.sea);
  if (!w || !inSight(l, 'humpback', w.x, w.y)) return;
  if (nearestBoat(w.x, w.y, l.boats) < WHALE_SHY) return;
  if (w.back >= 0) {
    const a = l.out.add('humpback', 'back', w.x, w.y, w.heading);
    a.phase = w.back;
    a.blow = w.blow;
  }
  if (w.fluke >= 0) l.out.add('humpback', 'fluke', w.x - Math.sin(w.heading) * 2, w.y - Math.cos(w.heading) * 2, w.heading).phase = w.fluke;
}

// ---- bait fish --------------------------------------------------------------------------------------

/** A ball of bait holds together about this long. */
const BAIT_SPELL = 1500;
/** Stream that will pile bait up against a point or a rip, m/s. */
export const BAIT_TIDE = 0.2;
/** Fishing is at its best within this of the birds, and no better for them beyond the second. */
export const BAIT_NEAR = 120;
export const BAIT_FAR = 320;

export interface BaitBall { x: number; y: number; key: number }

/** Where anchovy are balled up at the surface now, with the birds on them. */
export function baitBalls(courseId: string, now: number, sea: Sea): BaitBall[] {
  const f = FAUNA[courseId];
  const out: BaitBall[] = [];
  if (!f) return out;
  f.bait.forEach((b, i) => {
    const c = cycle(now, BAIT_SPELL, hash01(i, 68));
    if (hash01(i, c.turn, 69) >= 0.4) return;
    if (sea.stream(b.x, b.y) < BAIT_TIDE) return;
    const a = TAU * hash01(i, c.turn, 70);
    const r = 150 * hash01(i, c.turn, 71);
    const x = b.x + Math.sin(a) * r;
    const y = b.y + Math.cos(a) * r;
    if (sea.depth(x, y) < 3) return;
    out.push({ x, y, key: i * 1000 + (c.turn % 1000) });
  });
  return out;
}

/** How much the birds say about the fishing at a place, 0 to 1. */
export function baitAt(courseId: string, now: number, sea: Sea, x: number, y: number): number {
  let best = 0;
  for (const b of baitBalls(courseId, now, sea)) best = Math.max(best, clamp01((BAIT_FAR - Math.hypot(b.x - x, b.y - y)) / (BAIT_FAR - BAIT_NEAR)));
  return best;
}

// ---- birds ------------------------------------------------------------------------------------------

/** Air speeds, m/s: a pelican glides at about 22 kt, a cormorant goes at 30. */
const PELICAN_SPEED = 11.5;
const CORMORANT_SPEED = 15;
const GULL_SPEED = 8.5;

/** Birds that fly a route in line: pelicans in threes to sevens, cormorants alone or two or three together. */
function lines(kind: 'pelican' | 'cormorant', routes: Route[], l: Look): void {
  const pelican = kind === 'pelican';
  const speed = pelican ? PELICAN_SPEED : CORMORANT_SPEED;
  const salt = pelican ? 72 : 82;
  const { now } = l;
  routes.forEach((route, ri) => {
    const len = pathLength(route.path);
    const flight = len / speed;
    for (let i = 0; i < route.n; i++) {
      const c = cycle(now, flight + 50 + 190 * hash01(ri, i, salt), hash01(ri, i, salt + 1));
      if (c.into > flight + 4) continue;
      const back = hash01(ri, i, c.turn, salt + 2) < 0.5;
      const count = pelican ? 3 + Math.floor(hash01(ri, i, c.turn, salt + 3) * 5) : 1 + Math.floor(hash01(ri, i, c.turn, salt + 3) * 3);
      const gap = pelican ? 3.2 : 4.5;
      const side = (hash01(ri, i, c.turn, salt + 4) - 0.5) * 90;
      const echelon = hash01(ri, i, c.turn, salt + 5) < 0.5 ? 1 : -1;
      for (let b = 0; b < count; b++) {
        const sb = c.into * speed - b * gap;
        if (sb < 0 || sb > len) continue;
        const p = pathPoint(route.path, back ? len - sb : sb);
        const heading = back ? p.heading + Math.PI : p.heading;
        const off = side + echelon * b * (pelican ? 0.9 : 0.5);
        const x = p.x + Math.cos(heading) * off;
        const y = p.y - Math.sin(heading) * off;
        if (!inSight(l, kind, x, y)) continue;
        if (l.sea.depth(x, y) <= 0) continue;
        const a = l.out.add(kind, 'fly', x, y, heading);
        // Low: a pelican rides the cushion of air a wing's breadth off the water.
        a.up = pelican ? 1.3 + 0.5 * Math.sin(sb / 45 + ri) : 0.9 + 0.2 * Math.sin(sb / 30 + i);
        // They lift over a boat in the way.
        const d = nearestBoat(x, y, l.boats);
        if (d < 60) a.up += ((60 - d) / 60) * 14;
        if (pelican) {
          // A few beats, then a long glide, and each bird takes its time from the one ahead.
          const beat = cycle(now - b * 0.35, 7, hash01(ri, i, salt + 6));
          a.wing = beat.into < 2 ? Math.sin(beat.into * TAU * 2.2) : 0.08;
        } else a.wing = Math.sin(now * TAU * 4.5 + b * 1.7);
      }
    }
  });
}

function wheel(l: Look, kind: 'gull' | 'pelican', key: number, i: number, x: number, y: number, r: number, base: number): Animal | null {
  const cx = x + (hash01(key, i, 90) - 0.5) * 2 * r;
  const cy = y + (hash01(key, i, 91) - 0.5) * 2 * r;
  if (!inSight(l, kind, cx, cy, 50)) return null;
  const radius = 14 + 26 * hash01(key, i, 92);
  const dir = hash01(key, i, 93) < 0.5 ? 1 : -1;
  const a = dir * (l.now * (kind === 'gull' ? GULL_SPEED : PELICAN_SPEED)) / radius + TAU * hash01(key, i, 94);
  const bird = l.out.add(kind, 'fly', cx + Math.sin(a) * radius, cy + Math.cos(a) * radius, a + (dir * Math.PI) / 2);
  bird.up = base * (0.6 + 0.8 * hash01(key, i, 95)) + 3 * Math.sin(l.now / 7 + i);
  bird.bank = dir * 0.4;
  const beat = cycle(l.now, 9 + 5 * hash01(key, i, 96), hash01(key, i, 97));
  bird.wing = beat.into < 1.6 ? Math.sin(beat.into * TAU * 3) : 0.18;
  return bird;
}

/** Seconds a diving pelican circles, falls and then sits swallowing. */
const DIVE_CIRCLE = 17;
const DIVE_FALL = 1.1;
const DIVE_SIT = 7;
const DIVE_HEIGHT = 11;

function gulls(f: Fauna, l: Look): void {
  f.gulls.forEach((h, hi) => {
    if (!inSight(l, 'gull', h.x, h.y, h.r + 60)) return;
    for (let i = 0; i < h.n; i++) wheel(l, 'gull', hi, i, h.x, h.y, h.r, h.up ?? 15);
  });
}

function overBait(courseId: string, l: Look): void {
  for (const ball of baitBalls(courseId, l.now, l.sea)) {
    if (!inSight(l, 'pelican', ball.x, ball.y, 100)) continue;
    for (let i = 0; i < 5; i++) wheel(l, 'gull', 500 + ball.key, i, ball.x, ball.y, 30, 11);
    for (let i = 0; i < 2; i++) {
      const c = cycle(l.now, DIVE_CIRCLE + DIVE_FALL + DIVE_SIT, hash01(ball.key, i, 98));
      const bird = wheel(l, 'pelican', 700 + ball.key, i, ball.x, ball.y, 25, DIVE_HEIGHT);
      if (!bird) continue;
      bird.up = DIVE_HEIGHT;
      const t = c.into - DIVE_CIRCLE;
      if (t < 0) continue;
      bird.bank = 0;
      if (t < DIVE_FALL) {
        // Wings half folded, falling on the fish.
        bird.pose = 'plunge';
        bird.phase = t / DIVE_FALL;
        bird.up = DIVE_HEIGHT * (1 - bird.phase * bird.phase);
      } else {
        bird.pose = 'sit';
        bird.up = 0;
        bird.wing = 0;
      }
    }
  }
}

function perched(f: Fauna, l: Look): void {
  const half = Math.floor(l.now / 1800);
  f.perches.forEach((p, i) => {
    if (!inSight(l, 'cormorant', p.x, p.y)) return;
    if (hash01(i, half, 99) > 0.8) return;
    // It leaves when a boat comes close enough to read the buoy's number.
    if (nearestBoat(p.x, p.y, l.boats) < 25) return;
    const a = l.out.add('cormorant', 'perch', p.x, p.y, TAU * hash01(i, half, 100));
    a.up = p.up;
    a.phase = hash01(i, half, 101) < 0.6 ? 1 : 0;
  });
}

// ---- all of them ------------------------------------------------------------------------------------

/**
 * Every animal within sight of `eye` at season time `now`, written into `out`.
 * `boats` are the hulls on the water (the player's, her kayak, the fleet): animals close to one dive or lift clear.
 */
export function lookAbout(courseId: string, now: number, sea: Sea, eye: { x: number; y: number }, boats: Boats, out: Sightings): Sightings {
  out.clear();
  const f = FAUNA[courseId];
  if (!f) return out;
  const l: Look = { now, sea, eye, boats, out };
  porpoises(f, l);
  seals(f, l);
  sealions(f, l);
  humpback(courseId, l);
  lines('pelican', f.pelicans, l);
  lines('cormorant', f.cormorants, l);
  gulls(f, l);
  overBait(courseId, l);
  perched(f, l);
  return out;
}
