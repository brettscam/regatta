import { BARE, type DiveFile } from './diveRules';

// Each water's dive sites, fish and rules, from its `dives.json`. A few kilobytes each, so they are all loaded up
// front, as the resident boats are. A water without the file has no sites: she can still go over the side there.
const files = import.meta.glob<DiveFile>('../../../../courses/*/dives.json', { eager: true, import: 'default' });

/** True when a file is sound enough to dive on. Anything else is treated as no file at all. */
function sound(f: DiveFile | undefined): f is DiveFile {
  return !!f && !!f.water && Array.isArray(f.water.visibility) && Array.isArray(f.species) && Array.isArray(f.sites) && Array.isArray(f.zones);
}

/** The dive data of a water, by course id. */
export function divesOf(courseId: string): DiveFile {
  const f = files[`../../../../courses/${courseId}/dives.json`];
  return sound(f) ? f : BARE;
}

/** True when the water has dive sites of its own. */
export function hasDives(courseId: string): boolean {
  return sound(files[`../../../../courses/${courseId}/dives.json`]);
}
