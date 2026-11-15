import type { CourseData, ReplayData } from '@slack-tide/world';
import type { RaceCourse } from '../race/race';
import type { TrafficSpec } from '../scene/traffic';
import type { Place } from '../session';
import type { StartSpot, StartTime } from '../ui/join';

// The waters there are to sail. A course is a folder under `courses/`: adding one adds data, not code.
// Each folder's small `about.json` is read up front, so the join screen can offer every water. Everything else
// (the baked course, its binaries, its starts, places, races and traffic) is fetched only for the water chosen.
// In the single-file build it is all inlined, and the same calls resolve without the network.

/** What the join screen says about a water, and what stands on its land. */
export interface CourseAbout {
  id: string;
  /** As the join screen names it. */
  name: string;
  /** Where it is, in a few words. */
  where: string;
  /** One line on what the sailing is like. */
  say: string;
  /** Place in the list: lowest first. */
  order?: number;
  scenery?: {
    /** Which built-in ground cover colours the land: `sf-bay`, `evergreen` or `tropic`. */
    landCover?: string;
    /** Which built-in water: left out for the Bay's green-grey, `clear` for blue water whose shoals show turquoise. */
    water?: string;
    /**
     * Built-in pieces to place: `golden-gate-bridge`, `san-francisco`, `marine-layer`, and for the tropics `palms`,
     * `mooring-fields` (yachts lying off every place with moorings) and `virgin-islands` (the Baths' boulders, Road Town).
     */
    pieces?: string[];
  };
  /** Which layers are recorded and which are worked out by rule, for the join screen to say. */
  data?: string;
}

export interface LoadedCourse extends ReplayData {
  /** Land height, uint8 with a square-root scale. */
  terrain: Uint8Array;
  about: CourseAbout;
  starts: StartSpot[];
  times: StartTime[];
  places: Place[];
  races: RaceCourse[];
  traffic: TrafficSpec;
}

const ROOT = '../../../../courses/';
const abouts = import.meta.glob<CourseAbout>('../../../../courses/*/about.json', { eager: true, import: 'default' });
/** True in the single-file build (set in `vite.config.ts`). */
declare const __SINGLE__: boolean;
/** Make an already-loaded set of modules look like the load-on-demand kind. */
const ready = <T>(all: Record<string, T>): Record<string, () => Promise<T>> => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, () => Promise.resolve(v)]));
// The single-file build has no network to fetch from, and inlining load-on-demand modules into one script leaves them
// defined after the code that waits for them. So there everything is loaded up front; on the web each water is fetched when chosen.
const json = __SINGLE__
  ? ready(import.meta.glob<unknown>('../../../../courses/*/{course,starts,times,places,races,traffic}.json', { import: 'default', eager: true }))
  : import.meta.glob<unknown>('../../../../courses/*/{course,starts,times,places,races,traffic}.json', { import: 'default' });
const binaries = __SINGLE__
  ? ready(import.meta.glob<string>('../../../../courses/*/*.bin', { query: '?url', import: 'default', eager: true }))
  : import.meta.glob<string>('../../../../courses/*/*.bin', { query: '?url', import: 'default' });

/** Every water on offer, in the order the join screen lists them. */
export const COURSES: CourseAbout[] = Object.values(abouts).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
export const DEFAULT_COURSE = 'sf-bay';
export const hasCourse = (id: string | null | undefined): id is string => !!id && COURSES.some((c) => c.id === id);

/** Read a baked binary. In the single-file build the file is inlined as a data URI, which is decoded here without a network call. */
async function loadBinary(url: string): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) {
    const raw = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out.buffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return res.arrayBuffer();
}

const loaded = new Map<string, Promise<LoadedCourse>>();

async function read(id: string): Promise<LoadedCourse> {
  const about = COURSES.find((c) => c.id === id);
  if (!about) throw new Error(`No course called ${id}`);
  const file = <T>(name: string, fallback?: T): Promise<T> => {
    const get = json[`${ROOT}${id}/${name}.json`];
    if (get) return get() as Promise<T>;
    if (fallback !== undefined) return Promise.resolve(fallback);
    throw new Error(`Course ${id} has no ${name}.json`);
  };
  const binary = async (name: string): Promise<ArrayBuffer> => {
    const get = binaries[`${ROOT}${id}/${name}`];
    if (!get) throw new Error(`Course ${id} has no ${name}`);
    return loadBinary(await get());
  };
  const course = await file<CourseData>('course');
  const [current, depth, terrain, starts, times, places, races, traffic] = await Promise.all([
    binary(course.current.file), binary(course.depth.file), binary(course.terrain.file),
    file<StartSpot[]>('starts'), file<StartTime[]>('times'), file<Place[]>('places', []), file<RaceCourse[]>('races', []),
    // A water with no traffic file simply has none.
    file<TrafficSpec>('traffic', { referenceHours: 0, routes: [] }),
  ]);
  return { about, course, current: new Int8Array(current), depth: new Uint8Array(depth), terrain: new Uint8Array(terrain), starts, times, places, races, traffic };
}

/** A course and everything that goes with it. Asking twice for the same one fetches it once. */
export function loadCourse(id: string = DEFAULT_COURSE): Promise<LoadedCourse> {
  let p = loaded.get(id);
  if (!p) {
    p = read(id);
    loaded.set(id, p);
    p.catch(() => loaded.delete(id));
  }
  return p;
}
