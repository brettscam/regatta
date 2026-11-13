import type { BoatSpec } from '@slack-tide/sim';

/** A boat file with the fields the boat picker shows. */
export interface YardBoat extends BoatSpec {
  lengthFt?: number;
  tagline?: string;
  role?: string;
  defaultName?: string;
  homePort?: string;
  topsides?: string;
}

export interface LineupEntry {
  id: string;
  /** "ready" boats can be sailed. "yard" boats are planned and shown greyed out. */
  status: 'ready' | 'yard';
  file?: string;
  name?: string;
  lengthFt?: number;
  role?: string;
}

// Every boat is a data file. Dropping a new one in boats/ and listing it in lineup.json is all it takes.
const files = import.meta.glob('../../../../boats/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export const BOATS: Record<string, YardBoat> = {};
let lineup: LineupEntry[] | null = null;
for (const [path, value] of Object.entries(files)) {
  if (path.endsWith('lineup.json')) lineup = value as LineupEntry[];
  else if ((value as Partial<BoatSpec>).polar) BOATS[(value as BoatSpec).id] = value as YardBoat;
}

/** The picker's list, in order. A boat listed as ready whose file is missing is shown as still in the yard. */
export const LINEUP: LineupEntry[] = (lineup ?? Object.keys(BOATS).map((id) => ({ id, status: 'ready' as const }))).map((e) =>
  e.status === 'ready' && !BOATS[e.id] ? { ...e, status: 'yard' as const } : e,
);

export const DEFAULT_BOAT = BOATS.sloop38 ? 'sloop38' : Object.keys(BOATS)[0];

export const TOPSIDES = [
  { name: 'Navy', hex: '#12233d' },
  { name: 'Flag red', hex: '#8f1d1d' },
  { name: 'Forest green', hex: '#1d4a36' },
  { name: 'Teal', hex: '#1f5c6b' },
  { name: 'Black', hex: '#17191c' },
  { name: 'Ivory', hex: '#e4dfd0' },
];
