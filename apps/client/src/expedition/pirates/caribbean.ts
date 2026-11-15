import { mercator } from '@slack-tide/nav';
import { ReplayWorld, type Wind } from '@slack-tide/world';
import { Land, hash2, noise2, type LandMass } from '../land';
import { buildSea, type ExpeditionSea, type Reef, type SeaDef } from '../sea';
import type { Island, SW } from '../voyage';
import type { Sky, Weather } from '../weather';
import { LANES, PORTS, type Lane, type Port } from './tables';

// The sea of the pirate game: the middle of the Greater Antilles about 1715. Jamaica, the south-east of Cuba, the
// west of Hispaniola with Tortuga and the Gulf of Gonâve, the Windward Passage, the Caymans and Great Inagua.
// About 990 km east to west and 490 km north to south. Made in code, as the Scotia Sea is (`../sea.ts`).
//
// ALL OF THE GEOGRAPHY IS FROM MEMORY. The outlines are joined-up capes and bays as I recall their positions, good
// to perhaps ten kilometres: enough to recognise the islands and to make the passages between them, not to pilot by.
// Kingston harbour, the Bay of Guantánamo and every small inlet are left out. Cuba and Hispaniola run off the edge of
// the chart and are simply cut there. The reefs and banks are real names put about where I remember them, each drawn
// as a round patch: their true shapes are nothing like round. Heights are the well-known summits and a guessed spine.
// The weather is the trade wind as the pilot books describe it, made by rule: there is no record behind it.

const D2R = Math.PI / 180;
const KT = 0.514444;

/** Degrees north and west, both written positive, to the south-and-west pairs the land is built from. */
const nw = (pairs: Array<[number, number]>): SW[] => pairs.map(([n, w]) => [-n, w]);
const spine = (pts: Array<[number, number, number]>): Array<[number, number, number]> => pts.map(([n, w, h]) => [-n, w, h]);

const ISLANDS: Island[] = [
  {
    name: 'Jamaica', group: 'jamaica', peak: 2256,
    // Morant Point, west along the south side by Port Royal, Portland Point and Black River to Negril, back by the north side.
    outline: nw([
      [17.92, 76.18], [17.87, 76.35], [17.86, 76.55], [17.94, 76.72], [17.93, 76.84], [17.9, 76.95], [17.85, 77.0], [17.73, 77.15],
      [17.8, 77.25], [17.85, 77.45], [17.86, 77.6], [17.87, 77.75], [18.02, 77.85], [18.12, 78.02], [18.2, 78.13], [18.24, 78.36],
      [18.36, 78.34], [18.45, 78.18], [18.5, 77.92], [18.5, 77.65], [18.47, 77.4], [18.41, 77.1], [18.37, 76.89], [18.28, 76.75],
      [18.19, 76.45], [18.15, 76.28], [18.03, 76.25],
    ]),
    // The Blue Mountains in the east, the limestone plateau and the Cockpit Country west of them.
    spine: spine([[18.05, 76.58, 2256], [18.1, 76.78, 1400], [18.15, 77.3, 850], [18.28, 77.75, 600], [18.3, 78.1, 380]]),
  },
  {
    name: 'Cuba', group: 'cuba', peak: 1974,
    // The south coast from where it leaves the chart, by the Gulf of Guacanayabo, Cabo Cruz, the Sierra Maestra shore, Santiago
    // and Guantánamo to Punta de Maisí, then the north coast by Baracoa, Nipe and Gibara until it leaves the chart again.
    outline: nw([
      [21.45, 78.75], [21.1, 78.6], [20.9, 78.3], [20.72, 78.0], [20.6, 77.7], [20.45, 77.3], [20.34, 77.12], [20.1, 77.3],
      [20.05, 77.58], [19.84, 77.73], [19.86, 77.4], [19.9, 77.0], [19.95, 76.7], [19.95, 76.3], [19.97, 75.87], [19.9, 75.5],
      [19.92, 75.15], [20.0, 74.8], [20.07, 74.5], [20.2, 74.13], [20.35, 74.5], [20.6, 74.8], [20.7, 75.3], [20.75, 75.6],
      [21.07, 75.62], [21.12, 76.1], [21.25, 76.6], [21.45, 77.0],
    ]),
    spine: spine([[19.93, 77.4, 900], [19.99, 76.84, 1974], [20.02, 76.3, 1200], [20.08, 75.7, 800], [20.25, 75.2, 700], [20.33, 74.7, 1100]]),
  },
  {
    name: 'Hispaniola', group: 'hispaniola', peak: 2347,
    // The north coast west from the chart's edge by Cap-Haïtien and Port-de-Paix to the Môle, round the Gulf of Gonâve by
    // Gonaïves, Saint-Marc, Port-au-Prince and Petit-Goâve, out along the southern peninsula to Cap Dame Marie and Cape
    // Tiburon, and back east along the south coast by Les Cayes and Jacmel.
    outline: nw([
      [19.85, 72.05], [19.76, 72.2], [19.85, 72.5], [19.95, 72.83], [19.93, 73.15], [19.83, 73.42], [19.65, 73.45], [19.6, 73.1],
      [19.45, 72.72], [19.1, 72.75], [18.8, 72.55], [18.55, 72.35], [18.52, 72.63], [18.43, 72.87], [18.45, 73.1], [18.55, 73.6],
      [18.65, 74.12], [18.62, 74.43], [18.33, 74.47], [18.22, 74.1], [18.19, 73.75], [18.2, 73.4], [18.18, 73.0], [18.23, 72.53],
      [18.2, 72.3], [18.15, 72.05],
    ]),
    // A height of 0 lifts the pen: the southern ranges, then the mountains of the north.
    spine: spine([[18.38, 74.03, 2347], [18.35, 73.5, 1200], [18.36, 72.9, 1000], [18.36, 72.3, 2000], [18.9, 72.2, 0], [19.68, 72.95, 900], [19.3, 72.3, 1200]]),
  },
  { name: 'La Gonâve', group: 'hispaniola', peak: 778, outline: nw([[18.93, 73.3], [19.0, 73.1], [18.9, 72.85], [18.72, 72.78], [18.7, 72.95], [18.8, 73.2]]), spine: spine([[18.9, 73.2, 500], [18.8, 72.95, 778]]) },
  { name: 'Tortuga', group: 'hispaniola', peak: 459, outline: nw([[20.02, 72.97], [20.09, 72.95], [20.1, 72.75], [20.06, 72.62], [20.0, 72.64], [20.01, 72.8]]), spine: spine([[20.06, 72.9, 380], [20.05, 72.7, 459]]) },
  { name: 'Île-à-Vache', group: 'hispaniola', peak: 30, outline: nw([[18.1, 73.72], [18.12, 73.62], [18.08, 73.57], [18.05, 73.6], [18.06, 73.7]]) },
  { name: 'Navassa', group: 'navassa', peak: 77, outline: nw([[18.42, 75.035], [18.42, 75.0], [18.385, 75.0], [18.385, 75.035]]) },
  { name: 'Grand Cayman', group: 'cayman', peak: 18, outline: nw([[19.28, 81.4], [19.38, 81.4], [19.36, 81.25], [19.35, 81.1], [19.3, 81.09], [19.27, 81.2]]) },
  { name: 'Little Cayman', group: 'cayman-brac', peak: 12, outline: nw([[19.66, 80.11], [19.7, 80.1], [19.72, 79.96], [19.69, 79.96]]) },
  { name: 'Cayman Brac', group: 'cayman-brac', peak: 43, outline: nw([[19.69, 79.9], [19.72, 79.88], [19.76, 79.73], [19.73, 79.72]]) },
  { name: 'Great Inagua', group: 'inagua', peak: 33, outline: nw([[20.92, 73.68], [21.1, 73.65], [21.15, 73.3], [21.2, 73.05], [21.0, 73.15], [20.93, 73.4]]) },
];

/** Reefs and banks: name, degrees north and west, and how far across in kilometres. */
const REEFS: Array<[string, number, number, number]> = [
  ['Pedro Cays', 17.0, 77.8, 14],
  ['Morant Cays', 17.4, 75.98, 6],
  ['Formigas Bank', 18.5, 75.75, 7],
  ['The cays off Port Royal', 17.8, 76.98, 3.5],
  ['Gardens of the Queen', 20.5, 78.4, 9],
  ['Gardens of the Queen', 20.72, 78.78, 10],
  ['Gardens of the Queen', 20.97, 79.2, 10],
  ['Cabo Cruz reef', 19.79, 77.8, 4],
  ['Buena Esperanza bank', 20.4, 77.6, 8],
  ['Rochelois Bank', 18.65, 73.2, 6],
  ['North Sound reef', 19.42, 81.3, 4],
  ['Little Cayman reef', 19.64, 80.04, 3],
  ['Inagua reef', 20.88, 73.72, 5],
];

export const CARIBBEAN: SeaDef = {
  id: 'antilles-1715',
  line: 'The Greater Antilles, 1715. A sloop, a few guns, and every nation\'s trade going by',
  sea: { id: 'antilles', name: 'The Caribbean Sea', lat0: 19.1, lon0: -76.9, south: 16.9, north: 21.3, west: -81.6, east: -72.2 },
  // The sun's own time at Jamaica.
  timeZone: 'Etc/GMT+5',
  dayZero: '1715-03-02T00:00:00-05:00',
  castOff: 9.5,
  days: 2,
  from: { name: 'Port Royal', lat: 17.84, lon: -76.86, headingDeg: 150 },
  to: { name: 'Port Royal', lat: 17.84, lon: -76.86, radius: 0 },
  islands: ISLANDS,
  rocks: [],
  // The Caribbean current sets west-north-west through the whole sea at half a knot or so.
  drift: { toward: 290, spread: 20, kt: [0.2, 0.7] },
};

/** How high this sea runs against the Southern Ocean's for the same wind: the fetch is short and the trade is steady. */
export const SEA_GAIN = 0.42;

// ---- the trade wind -------------------------------------------------------------------------------------------------

/** Smooth noise along one axis, -1 to 1. */
function wander(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const s = f * f * (3 - 2 * f);
  return (hash2(i, 0, seed) * (1 - s) + hash2(i + 1, 0, seed) * s) * 2 - 1;
}

// A squall is born in one cell of a grid that goes down wind with the trade, lives one slot of time and is gone.
const SQUALL_CELL = 70000;
const SQUALL_HOURS = 3;
const SQUALL_DRIFT = 26000; // metres an hour to the westward: fourteen knots

/**
 * How hard a squall is blowing at a place and time, 0 none to 1 its heart. Pure in place, time and seed.
 * @param hours since the season began
 */
export function squallAt(x: number, y: number, hours: number, seed: number): number {
  const slot = Math.floor(hours / SQUALL_HOURS);
  const life = hours / SQUALL_HOURS - slot;
  const mx = x + SQUALL_DRIFT * hours;
  const ci = Math.floor(mx / SQUALL_CELL);
  const cj = Math.floor(y / SQUALL_CELL);
  let most = 0;
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      // More of them in the afternoon would be truer. One cell in four has one at any time.
      if (hash2(i * 31 + slot, j * 17 - slot, seed + 60) > 0.26) continue;
      const sx = (i + 0.2 + 0.6 * hash2(i, j + slot, seed + 61)) * SQUALL_CELL;
      const sy = (j + 0.2 + 0.6 * hash2(i + slot, j, seed + 62)) * SQUALL_CELL;
      const reach = 5000 + 5000 * hash2(i, j, seed + 63 + slot);
      const d = Math.hypot(mx - sx, y - sy) / reach;
      if (d >= 1) continue;
      const core = (1 - d * d) * Math.sin(Math.PI * life);
      if (core > most) most = core;
    }
  }
  return most;
}

/**
 * The trade wind: east a little north or south of east, twelve to twenty-two knots, freshening every afternoon and easing
 * before dawn, bent on and off the shore of a high island by the day's heating, with squalls going through.
 */
export function makeTrades(seed: number, land: Land): Weather {
  // The pull of a high island on the wind, on a coarse grid made once: which way the shore lies and how strongly it draws.
  const DX = 12000;
  const xs = land.masses.map((m) => m.x0);
  const ys = land.masses.map((m) => m.y0);
  const x0 = Math.min(...xs) - 60000;
  const y0 = Math.min(...ys) - 60000;
  const nx = Math.ceil((Math.max(...land.masses.map((m) => m.x1)) + 60000 - x0) / DX) + 1;
  const ny = Math.ceil((Math.max(...land.masses.map((m) => m.y1)) + 60000 - y0) / DX) + 1;
  const pull = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const near = land.nearest(x0 + i * DX, y0 + j * DX, 45000);
      if (!near || near.mass.peak < 400 || near.metres <= 0) continue;
      const draw = Math.min(1, near.mass.peak / 1500) * Math.max(0, 1 - near.metres / 45000);
      pull[(j * nx + i) * 2] = Math.sin(near.bearing) * draw;
      pull[(j * nx + i) * 2 + 1] = Math.cos(near.bearing) * draw;
    }
  }
  const shore = (x: number, y: number): [number, number] => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - x0) / DX));
    const fy = Math.max(0, Math.min(ny - 1.001, (y - y0) / DX));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const at = (k: number) => (pull[(j * nx + i) * 2 + k] * (1 - u) + pull[(j * nx + i + 1) * 2 + k] * u) * (1 - v) + (pull[((j + 1) * nx + i) * 2 + k] * (1 - u) + pull[((j + 1) * nx + i + 1) * 2 + k] * u) * v;
    return [at(0), at(1)];
  };

  const steady = (hours: number, x: number, y: number) => {
    const hour = ((hours % 24) + 24) % 24;
    // Freshest about three in the afternoon, lightest about four in the morning.
    const daily = Math.cos(((hour - 15) / 24) * Math.PI * 2);
    const kt = Math.max(9, 16 + 3.2 * daily + 3 * wander(hours / 53 + 4.2, seed + 1) + 1.3 * (noise2(x / 210000 + hours / 31, y / 210000, seed + 2) * 2 - 1));
    const from = (88 + 17 * wander(hours / 71 + 1.7, seed + 3) + 7 * (noise2(x / 260000, y / 260000 + hours / 37, seed + 4) * 2 - 1)) * D2R;
    return { kt, from, daily };
  };

  const at = (x: number, y: number, hours: number): Sky => {
    const s = steady(hours, x, y);
    let u = -s.kt * KT * Math.sin(s.from);
    let v = -s.kt * KT * Math.cos(s.from);
    // Sea breeze by day, land breeze by night: up to four knots on or off the shore of a high island.
    const [px, py] = shore(x, y);
    const breeze = (s.daily > 0 ? 4.2 * s.daily : 3.2 * s.daily) * KT;
    u += px * breeze;
    v += py * breeze;
    const squall = squallAt(x, y, hours, seed);
    if (squall > 0) {
      // It blows half as hard again in the heart of it and backs two points.
      const turn = 22 * D2R * squall;
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      const k = 1 + 0.75 * squall;
      [u, v] = [(u * c - v * sn) * k, (u * sn + v * c) * k];
    }
    const speed = Math.hypot(u, v);
    const cloud = Math.max(0, Math.min(1, 0.22 + 0.22 * (noise2(x / 120000 + hours / 9, y / 120000, seed + 5) * 2 - 1) + 0.95 * squall));
    return { u, v, gust: speed * (1.22 + 0.25 * squall), cloud, air: 27 + 2 * s.daily - 4 * squall };
  };
  return { at, scripted: (hours) => at(0, 0, hours) };
}

/**
 * The world of the trade wind. The made sea's hourly wind grid is too coarse and too short for a wind with squalls in
 * it and a voyage with no end, so here the wind is asked of the weather itself. Everything else is `ReplayWorld`.
 */
export class TradeWorld extends ReplayWorld {
  constructor(private readonly made: ExpeditionSea, startOffset = 0) {
    super(made, startOffset);
  }

  override wind(x: number, y: number, t: number): Wind {
    const w = this.made.weather.at(x, y, (this.startOffset + t) / 3600);
    return { dir: (Math.atan2(-w.u, -w.v) + Math.PI * 2) % (Math.PI * 2), speed: Math.hypot(w.u, w.v) };
  }

  override gust(x: number, y: number, t: number): number {
    return this.made.weather.at(x, y, (this.startOffset + t) / 3600).gust;
  }
}

// ---- the land's height ----------------------------------------------------------------------------------------------

/** Height of the ground: a low shore and a coastal plain, hills behind, and the high spine where the island has one. */
function tropicHeight(m: LandMass, x: number, y: number): number {
  const d = Land.toCoast(m, x, y);
  const rough = 0.7 + 0.6 * (0.6 * noise2(x / 5200, y / 5200, 7) + 0.4 * noise2(x / 1900, y / 1900, 11));
  let high = 0;
  for (let i = 0; i < m.spine.length - 1; i++) {
    const a = m.spine[i];
    const b = m.spine[i + 1];
    if (a.h === 0 || b.h === 0) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    const off = Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
    const crest = a.h + (b.h - a.h) * t;
    const width = 5000 + crest * 4;
    high = Math.max(high, crest * Math.exp(-(off * off) / (2 * width * width)));
  }
  const low = m.spine.length ? 90 : Math.min(m.peak, 60);
  const plain = low * (1 - Math.exp(-d / 5000));
  return Math.max(3, Math.min(m.peak, (4 + plain + high * (1 - Math.exp(-d / 2500))) * rough));
}

// ---- the whole thing ------------------------------------------------------------------------------------------------

export interface PortPlace extends Port {
  /** The town on the shore, and the anchorage off it, flat metres. */
  townX: number;
  townY: number;
  x: number;
  y: number;
  /** The bearing of the open sea from the town, radians. */
  seaward: number;
}

export interface LanePath extends Lane {
  /** The turns in flat metres, and the length of the whole lane. */
  path: Array<{ x: number; y: number }>;
  metres: number;
}

export interface Caribbean {
  sea: ExpeditionSea;
  world: TradeWorld;
  ports: PortPlace[];
  lanes: LanePath[];
  reefs: Reef[];
}

/** Metres within which a ship lying still is in a port's anchorage. */
export const PORT_REACH = 1500;

/** Make the Caribbean for a seed: the same seed, the same sea, weather and traffic. The land and the reefs are the same for every seed. */
export function buildCaribbean(seed: number): Caribbean {
  // The projection is needed before the sea is made, to put the reefs down. The sea makes the same one.
  const probe = buildSeaProjection();
  const reefs: Reef[] = REEFS.map(([name, n, w, km]) => ({ name, ...probe.toXY(n, -w), radius: km * 1000 }));
  const land = new Land(CARIBBEAN.islands, [], probe);
  const sea = buildSea(CARIBBEAN, seed, {
    weather: makeTrades(seed, land),
    landCover: 'tropic',
    where: 'West Indies',
    landDx: 1000,
    depthScale: 1,
    // Coral sand shelving slowly: three fathoms a mile off, deep water at five miles.
    shelf: (d) => (d < 9000 ? 3 + d * 0.0045 : 44 + (d - 9000) * 0.05),
    height: tropicHeight,
    reefs,
  });
  const world = new TradeWorld(sea, CARIBBEAN.castOff * 3600);

  const ports = PORTS.map((p): PortPlace => {
    const town = sea.projection.toXY(p.lat, -p.lonW);
    // Which way is the sea? Away from the nearest land if the town is on it, else where it is.
    const mass = sea.land.masses.reduce((a, b) => (Land.toCoast(a, town.x, town.y) < Land.toCoast(b, town.x, town.y) ? a : b));
    let best = { x: town.x, y: town.y, seaward: 0, score: -Infinity };
    for (let k = 0; k < 24; k++) {
      const bearing = (k / 24) * Math.PI * 2;
      for (let r = 1500; r <= 9000; r += 500) {
        const x = town.x + Math.sin(bearing) * r;
        const y = town.y + Math.cos(bearing) * r;
        if (sea.land.on(x, y)) break;
        // Room to swing: six metres of water here and all round.
        let ok = world.chartDepth(x, y) >= 6;
        for (let q = 0; q < 8 && ok; q++) ok = world.chartDepth(x + Math.sin(q * 0.785) * 1300, y + Math.cos(q * 0.785) * 1300) >= 4.5;
        if (!ok) continue;
        const open = Land.toCoast(mass, town.x + Math.sin(bearing) * 20000, town.y + Math.cos(bearing) * 20000);
        const score = open * 0.2 - r;
        if (score > best.score) best = { x, y, seaward: bearing, score };
        break;
      }
    }
    return { ...p, townX: town.x, townY: town.y, x: best.x, y: best.y, seaward: best.seaward };
  });

  const lanes = LANES.map((lane): LanePath => {
    const path = lane.turns.map(([n, w]) => sea.projection.toXY(n, -w));
    let metres = 0;
    for (let i = 1; i < path.length; i++) metres += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    return { ...lane, path, metres };
  });
  return { sea, world, ports, lanes, reefs };
}

function buildSeaProjection() {
  return mercator(CARIBBEAN.sea.lat0, CARIBBEAN.sea.lon0);
}
