import { mercator, type Projection } from '@slack-tide/nav';
import type { CourseData, GridSpec, WindStep } from '@slack-tide/world';
import type { LoadedCourse } from '../world/loadCourse';
import { Land, noise2, type LandMass } from './land';
import { makeWeather, type Sky, type Weather } from './weather';
import type { Voyage } from './voyage';

// The sea a voyage crosses, built from the voyage's data and a seed into the same package a baked course is:
// hourly wind and gust grids, a stream grid, a depth grid, terrain and a tide. `ReplayWorld` and the stage take it
// as they take San Francisco Bay.
//
// It is built in code when the voyage starts rather than baked into `courses/`. Three reasons: there is no recording
// behind it, only a script, so there is nothing a pipeline would add; every passage wants a different seed; and
// megabytes of made-up wind have no business in the repository or the download. It also keeps the sea out of the
// folder the Regatta water picker lists. Building it takes a fraction of a second.

const KT = 0.514444;
/** Metres between wind and stream samples. Weather this size changes over hundreds of kilometres. */
const WIND_DX = 60000;
/** Metres between depth samples. The sim grounds a boat by this grid, so the coast is true to about a kilometre. */
const DEPTH_DX = 1000;
/** Metres between terrain samples, on the patches round each group of islands. */
const LAND_DX_DEFAULT = 500;
const LAND_MAX = 2950;
const DEPTH_SCALE_DEFAULT = 4;

/** What `buildSea` needs of a voyage. A sea that is not a voyage from the record (the Caribbean of `pirates/`) gives just this. */
export type SeaDef = Pick<Voyage, 'id' | 'line' | 'sea' | 'timeZone' | 'dayZero' | 'castOff' | 'days' | 'from' | 'to' | 'islands' | 'rocks' | 'drift'>;

/** A reef or bank: shoal water with patches that will take the bottom out of a ship. The same for every seed. */
export interface Reef {
  name: string;
  x: number;
  y: number;
  /** Metres from its middle to its edge. */
  radius: number;
}

/** Ways a sea may differ from the Scotia Sea. Left out, every one of them gives the Scotia Sea as it was. */
export interface SeaOptions {
  /** The weather, when it is not made from a voyage's day-by-day script. */
  weather?: Weather;
  /** Ground cover the terrain is coloured with, and the words for where it is. */
  landCover?: string;
  where?: string;
  /** Metres between terrain samples, and metres of water to one count of the depth grid. */
  landDx?: number;
  depthScale?: number;
  /** Depth of water in metres at a distance in metres off a coast. */
  shelf?(toCoast: number): number;
  /** Height of the ground in metres. */
  height?(m: LandMass, x: number, y: number): number;
  reefs?: Reef[];
}

/** Depth of water over a reef at a point `d` metres from its middle, or null outside it. Awash in patches, shoal between. */
export function reefDepth(reef: Reef, x: number, y: number): number | null {
  const d = Math.hypot(x - reef.x, y - reef.y);
  if (d >= reef.radius) return null;
  const edge = 1 - d / reef.radius;
  const head = noise2(x / 2300 + reef.x / 9000, y / 2300, 77);
  return head * Math.sqrt(edge) > 0.36 ? 1 : 4 + 16 * (1 - edge);
}

export interface LandPatch {
  grid: GridSpec & { max: number };
  heights: Uint8Array;
}

/** A course made for an expedition, with the few things a made sea knows that a baked one does not. */
export interface ExpeditionSea extends LoadedCourse {
  seed: number;
  projection: Projection;
  land: Land;
  /** Terrain round each group of islands. The first is also the course's own terrain grid. */
  patches: LandPatch[];
  weather: Weather;
  /** Cloud and air temperature at a place and a time in seconds since the season began. */
  sky(x: number, y: number, seasonSeconds: number): Sky;
}

const grid = (x0: number, y0: number, x1: number, y1: number, dx: number): GridSpec => ({
  x0, y0, dx, nx: Math.ceil((x1 - x0) / dx) + 1, ny: Math.ceil((y1 - y0) / dx) + 1,
});

/** Build a voyage's sea. The same voyage and seed always give the same sea, byte for byte. */
export function buildSea(voyage: SeaDef, seed: number, opts: SeaOptions = {}): ExpeditionSea {
  const LAND_DX = opts.landDx ?? LAND_DX_DEFAULT;
  const DEPTH_SCALE = opts.depthScale ?? DEPTH_SCALE_DEFAULT;
  const s = voyage.sea;
  const proj = mercator(s.lat0, s.lon0);
  const sw = proj.toXY(s.south, s.west);
  const ne = proj.toXY(s.north, s.east);
  const bounds = { x0: Math.round(sw.x), y0: Math.round(sw.y), x1: Math.round(ne.x), y1: Math.round(ne.y) };
  const land = new Land(voyage.islands, voyage.rocks, proj);
  const from = proj.toXY(voyage.from.lat, voyage.from.lon);
  const to = proj.toXY(voyage.to.lat, voyage.to.lon);
  const weather = opts.weather ?? makeWeather(voyage as Voyage, seed, { x0: from.x, x1: to.x });
  const hours = voyage.days * 24;

  // ---- wind: hourly, tenths of a metre a second -------------------------------------------------
  const wg = grid(bounds.x0, bounds.y0, bounds.x1, bounds.y1, WIND_DX);
  const cells = wg.nx * wg.ny;
  const truth: WindStep[] = [];
  for (let h = 0; h <= hours; h++) {
    const u = new Int16Array(cells);
    const v = new Int16Array(cells);
    const g = new Int16Array(cells);
    for (let j = 0; j < wg.ny; j++) {
      for (let i = 0; i < wg.nx; i++) {
        const w = weather.at(wg.x0 + i * wg.dx, wg.y0 + j * wg.dx, h);
        const k = j * wg.nx + i;
        u[k] = Math.round(w.u * 10);
        v[k] = Math.round(w.v * 10);
        g[k] = Math.round(w.gust * 10);
      }
    }
    // The world reads these by index only, so compact typed arrays stand in for the number lists a baked course has.
    truth.push({ u: u as unknown as number[], v: v as unknown as number[], g: g as unknown as number[] });
  }

  // ---- the stream: steady, one sample a cell, hundredths of a metre a second --------------------
  const current = new Int8Array(2 * cells * 2);
  for (let j = 0; j < wg.ny; j++) {
    for (let i = 0; i < wg.nx; i++) {
      const x = wg.x0 + i * wg.dx;
      const y = wg.y0 + j * wg.dx;
      const rate = (voyage.drift.kt[0] + (voyage.drift.kt[1] - voyage.drift.kt[0]) * noise2(x / 330000, y / 330000, seed + 20)) * KT;
      const toward = (voyage.drift.toward + voyage.drift.spread * (noise2(x / 410000, y / 410000, seed + 21) * 2 - 1)) * (Math.PI / 180);
      for (let step = 0; step < 2; step++) {
        const o = (step * cells + j * wg.nx + i) * 2;
        current[o] = Math.round(Math.sin(toward) * rate * 100);
        current[o + 1] = Math.round(Math.cos(toward) * rate * 100);
      }
    }
  }

  // ---- depth: deep everywhere but round the land -------------------------------------------------
  const dg = grid(bounds.x0, bounds.y0, bounds.x1, bounds.y1, DEPTH_DX);
  const depth = new Uint8Array(dg.nx * dg.ny).fill(255);
  const SHELF = 22000;
  for (const m of land.masses) {
    const i0 = Math.max(0, Math.floor((m.x0 - SHELF - dg.x0) / dg.dx));
    const i1 = Math.min(dg.nx - 1, Math.ceil((m.x1 + SHELF - dg.x0) / dg.dx));
    const j0 = Math.max(0, Math.floor((m.y0 - SHELF - dg.y0) / dg.dx));
    const j1 = Math.min(dg.ny - 1, Math.ceil((m.y1 + SHELF - dg.y0) / dg.dx));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = dg.x0 + i * dg.dx;
        const y = dg.y0 + j * dg.dx;
        const k = j * dg.nx + i;
        if (Land.within(m, x, y)) { depth[k] = 0; continue; }
        // The bottom shelves away from the shore: five fathoms close in, a hundred a few miles off.
        const metres = opts.shelf ? opts.shelf(Land.toCoast(m, x, y)) : 8 + Land.toCoast(m, x, y) * 0.03;
        depth[k] = Math.min(depth[k], Math.max(opts.shelf ? 1 : 2, Math.min(255, Math.round(metres / DEPTH_SCALE))));
      }
    }
  }
  for (const reef of opts.reefs ?? []) {
    const i0 = Math.max(0, Math.floor((reef.x - reef.radius - dg.x0) / dg.dx));
    const i1 = Math.min(dg.nx - 1, Math.ceil((reef.x + reef.radius - dg.x0) / dg.dx));
    const j0 = Math.max(0, Math.floor((reef.y - reef.radius - dg.y0) / dg.dx));
    const j1 = Math.min(dg.ny - 1, Math.ceil((reef.y + reef.radius - dg.y0) / dg.dx));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * dg.nx + i;
        const metres = reefDepth(reef, dg.x0 + i * dg.dx, dg.y0 + j * dg.dx);
        if (metres !== null && depth[k] > 0) depth[k] = Math.min(depth[k], Math.max(1, Math.round(metres / DEPTH_SCALE)));
      }
    }
  }
  for (const r of land.rocks) {
    const i = Math.round((r.x - dg.x0) / dg.dx);
    const j = Math.round((r.y - dg.y0) / dg.dx);
    if (i >= 0 && j >= 0 && i < dg.nx && j < dg.ny) depth[j * dg.nx + i] = 0;
  }

  // ---- terrain: a patch round each group of islands ----------------------------------------------
  const groups = [...new Set(land.masses.map((m) => m.group))];
  // The landfall's group goes first: it is the course's own terrain grid.
  const dest = land.nearest(to.x, to.y, 60000)?.mass.group;
  groups.sort((a, b) => (a === dest ? -1 : 0) - (b === dest ? -1 : 0));
  const patches: LandPatch[] = groups.map((group) => {
    const ms = land.masses.filter((m) => m.group === group);
    const pad = 2500;
    const pg = grid(
      Math.floor((Math.min(...ms.map((m) => m.x0)) - pad) / LAND_DX) * LAND_DX, Math.floor((Math.min(...ms.map((m) => m.y0)) - pad) / LAND_DX) * LAND_DX,
      Math.max(...ms.map((m) => m.x1)) + pad, Math.max(...ms.map((m) => m.y1)) + pad, LAND_DX,
    );
    const heights = new Uint8Array(pg.nx * pg.ny);
    for (const m of ms) {
      const i0 = Math.max(0, Math.floor((m.x0 - pg.x0) / LAND_DX));
      const i1 = Math.min(pg.nx - 1, Math.ceil((m.x1 - pg.x0) / LAND_DX));
      const j0 = Math.max(0, Math.floor((m.y0 - pg.y0) / LAND_DX));
      const j1 = Math.min(pg.ny - 1, Math.ceil((m.y1 - pg.y0) / LAND_DX));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = pg.x0 + i * LAND_DX;
          const y = pg.y0 + j * LAND_DX;
          if (!Land.within(m, x, y)) continue;
          // Square-root scale, as the baked courses use: fine steps near sea level, coarse on the tops.
          heights[j * pg.nx + i] = Math.max(8, Math.round(Math.sqrt((opts.height ? opts.height(m, x, y) : Land.height(m, x, y)) / LAND_MAX) * 255));
        }
      }
    }
    for (const r of land.rocks) {
      const i = Math.round((r.x - pg.x0) / LAND_DX);
      const j = Math.round((r.y - pg.y0) / LAND_DX);
      if (i > 0 && j > 0 && i < pg.nx - 1 && j < pg.ny - 1) heights[j * pg.nx + i] = Math.max(heights[j * pg.nx + i], 14);
    }
    return { grid: { ...pg, max: LAND_MAX }, heights };
  });

  // ---- tide: a small ocean tide, twice a day ----------------------------------------------------
  const tide: number[] = [];
  for (let h = 0; h <= hours; h++) tide.push(Math.round((0.45 * Math.sin((h / 12.42) * Math.PI * 2) + 0.12 * Math.sin((h / 24.8) * Math.PI * 2 + 1)) * 100) / 100);

  const course: CourseData = {
    id: s.id,
    name: s.name,
    origin: { lat: s.lat0, lon: s.lon0 },
    timeZone: voyage.timeZone,
    season: { id: voyage.id, start: voyage.dayZero, hours, stepSeconds: 3600, source: `Made from the record of the voyage, seed ${seed}` },
    forecast: { issued: voyage.dayZero, hours: 0, source: 'None: there was no forecast' },
    current: { ...wg, scale: 0.01, steps: 2, file: '' },
    depth: { ...dg, scale: DEPTH_SCALE, file: '' },
    terrain: { ...patches[0].grid, file: '', source: 'Drawn from the positions of capes and summits' },
    // No forecast was to be had, so the forecast is the truth and nothing on an expedition shows it.
    wind: { ...wg, scale: 0.1, truth, forecast: truth, note: 'Made from the day-by-day script in the voyage file' },
    tide: { station: voyage.to.name, x: to.x, y: to.y, truth: tide, forecast: tide, note: 'A plain ocean tide' },
    marks: [],
    bounds,
    coast: land.masses.map((m) => m.ring.map((n) => Math.round(n))),
  };

  const stepSeconds = course.season.stepSeconds;
  return {
    seed,
    projection: proj,
    land,
    patches,
    lands: patches.slice(1),
    weather,
    sky: (x, y, seasonSeconds) => weather.at(x, y, seasonSeconds / stepSeconds),
    course,
    current,
    depth,
    terrain: patches[0].heights,
    about: { id: s.id, name: s.name, where: opts.where ?? 'Southern Ocean', say: voyage.line, scenery: { landCover: opts.landCover ?? 'ice', pieces: [] } },
    starts: [{ id: 'cast-off', name: voyage.from.name, where: s.name, teaches: '', x: from.x, y: from.y, route: [] }],
    times: [{ id: 'cast-off', name: 'Cast off', hours: voyage.castOff, say: '', default: true }],
    places: [],
    races: [],
    traffic: { referenceHours: 0, routes: [] },
  };
}
