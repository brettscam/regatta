import type { ResidentFile } from './residentRules';

// Each water's resident boats, from its `residents.json`. A few kilobytes each, so they are all loaded up front:
// the logbook lists the boats of every water, not only the one being sailed.
const files = import.meta.glob<ResidentFile>('../../../../courses/*/residents.json', { eager: true, import: 'default' });

const NONE: ResidentFile = { boats: [] };

/** The boats that live on a water. A water with no file has none. */
export function residentsOf(courseId: string): ResidentFile {
  return files[`../../../../courses/${courseId}/residents.json`] ?? NONE;
}

/** Every water that has residents, by course id. */
export function residentWaters(): Array<{ id: string; file: ResidentFile }> {
  return Object.entries(files).map(([path, file]) => ({ id: path.split('/').slice(-2)[0], file }));
}
