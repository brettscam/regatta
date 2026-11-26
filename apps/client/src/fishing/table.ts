/**
 * A water's fishing as data: the species, the grounds, the oil platforms, where kelp paddies and bird schools turn up.
 * Each water that has its own fishing carries a `courses/<id>/fishing.json`; a water without one keeps the game's
 * first table (`aboard/catch.ts`, written for San Francisco Bay). Adding a water's fishing is adding that file.
 * Lengths in centimetres, positions in flat metres (x east, y north), speeds in knots.
 */
import tackleJson from '../data/tackle.json';

/** What kind of water a fish lives in. A place can be several at once. */
export type Habitat =
  | 'harbor' | 'flats' | 'rocks' | 'reef' | 'platform' | 'kelp' | 'point' | 'cove' | 'channel' | 'offshore'
  | 'paddy' | 'boil' | 'yellows' | 'foamer';

/** What is on the end of the line when she is stopped or drifting. */
export type RigId = 'bait' | 'iron' | 'squid';
/** What is towed when she is making way. */
export type LureId = 'feather' | 'plug' | 'marlin';

export interface FishSpecies {
  id: string;
  name: string;
  /** Smallest and largest likely to be caught, and the biggest there is: one fish in thirty or so runs past the usual range. */
  size: [number, number];
  trophyCm: number;
  /** Weight in kg is this times the length in cm, cubed. */
  kgPerCm3: number;
  /** Legal minimum length, where there is one. Shorter fish go back. */
  minCm?: number;
  /** The most that may be kept in a day. */
  bag?: number;
  /** Set for a fish that may never be kept, with what the crew say as it comes to the rail. Keeping one costs points. */
  protected?: string;
  /** The rule in plain words, for the card. */
  limit: string;
  /** How the length is said, where it is not nose to tail. */
  measure?: string;
  /** Points for the biggest there is. See `fishing/points.ts`. */
  worth: number;
  /** How much it likes each kind of water, 0 to 1. Kinds left out are 0. */
  habitat: Partial<Record<Habitat, number>>;
  /** Depth of water it wants, metres: nothing outside the first and last, best between the middle two. Left out, any depth. */
  depth?: [number, number, number, number];
  /** How well it takes each rig when she is stopped or drifting, 0 to 1. */
  ways: Partial<Record<RigId, number>>;
  /** Trolling: the speed it takes a lure at (nothing outside the first and last, best between the middle two), and how it likes each lure. */
  troll?: { kt: [number, number, number, number]; lures: Partial<Record<LureId, number>> };
  /** The months it is here, 1 to 12. Left out, all year. */
  months?: number[];
  /** Share of the bite left in the middle of the day (1 bites all day), and after dark. */
  light: number;
  night: number;
  /** 'moving' for a fish that feeds on a moving tide and sulks at slack water. */
  tide?: 'moving';
  /** True for a fish that wants the bait covering ground: at anchor it bites less. */
  driftOnly?: boolean;
  /** How it fights, each 0 to 1: how hard it pulls, how long it lasts, how much of the fight is straight down. */
  fight: { power: number; stamina: number; dives: number };
  /** One true thing about finding it, as a skipper would say it. */
  hint: string;
}

export interface Ground {
  id: string;
  name: string;
  kind: Habitat | 'barge';
  /** One of these gives its shape: centre and radius; west, south, east, north; or a line with a width either side. */
  circle?: [number, number, number];
  box?: [number, number, number, number];
  line?: Array<[number, number]>;
  width?: number;
  /** Depth of water that counts as this ground, metres, least and most. */
  depth?: [number, number];
  say: string;
}

/** An oil platform or an oil island: structure that holds fish, with a ring round it nobody fishes or anchors inside. */
export interface Platform {
  id: string;
  name: string;
  kind: 'platform' | 'island';
  x: number;
  y: number;
  /** Radius of the keep-off ring, metres. */
  keepOff: number;
  /** How far out from it fish still hold, metres. */
  reach: number;
}

export interface SchoolArea {
  id: string;
  /** West, south, east, north. */
  area: [number, number, number, number];
  count: number;
  /** A school holds together about this long. */
  minutes: number;
  /** Share of the time a school is up. */
  odds: number;
  /** What it may be, weighted. `boil` is bonito and barracuda on bait, `yellows` yellowtail, `foamer` tuna. */
  kinds: Partial<Record<'boil' | 'yellows' | 'foamer', number>>;
}

export interface FishTable {
  name: string;
  /** The species a jackpot derby is fished for. */
  jackpot: string;
  bait: { name: string; scoop: number; most: number };
  grounds: Ground[];
  platforms: Platform[];
  paddies?: { area: [number, number, number, number]; count: number; hours: number; holding: number; driftKt: number };
  schools: SchoolArea[];
  /** Named places a report on the radio is given from: "three miles south of Queens Gate". */
  refs: Array<{ name: string; x: number; y: number }>;
  /** Made-up boat names for the reports. */
  callers: string[];
  species: FishSpecies[];
  /** What the club skippers bring to a derby's scale, weighted. */
  rivals: Array<{ id: string; w: number }>;
}

const files = import.meta.glob<FishTable>('../../../../courses/*/fishing.json', { eager: true, import: 'default' });

/** A water's own fishing, or null when it keeps the game's first table. */
export function tableOf(courseId: string): FishTable | null {
  return files[`../../../../courses/${courseId}/fishing.json`] ?? null;
}

/** Every water with its own fishing, by course id. */
export function fishingWaters(): Array<{ id: string; table: FishTable }> {
  return Object.entries(files).map(([path, table]) => ({ id: path.split('/').slice(-2)[0], table }));
}

export const speciesOf = (table: FishTable, id: string): FishSpecies | undefined => table.species.find((s) => s.id === id);

export interface Tackle { id: string; name: string; say: string }
const tackle = tackleJson as { lures: Tackle[]; rigs: Tackle[] };
export const LURES = tackle.lures as Array<Tackle & { id: LureId }>;
export const RIGS = tackle.rigs as Array<Tackle & { id: RigId }>;
export const readLure = (v: unknown): LureId => (LURES.find((l) => l.id === v)?.id ?? 'feather');
export const readRig = (v: unknown): RigId => (RIGS.find((r) => r.id === v)?.id ?? 'iron');
