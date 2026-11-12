import type { CourseData, ReplayData } from '@slack-tide/world';
import courseJson from '../../../../courses/sf-bay/course.json';
import currentUrl from '../../../../courses/sf-bay/current.bin?url';
import depthUrl from '../../../../courses/sf-bay/depth.bin?url';
import terrainUrl from '../../../../courses/sf-bay/terrain.bin?url';

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

export interface LoadedCourse extends ReplayData {
  /** Land height, uint8 with a square-root scale. */
  terrain: Uint8Array;
}

export async function loadCourse(): Promise<LoadedCourse> {
  const course = courseJson as unknown as CourseData;
  const [current, depth, terrain] = await Promise.all([loadBinary(currentUrl), loadBinary(depthUrl), loadBinary(terrainUrl)]);
  return { course, current: new Int8Array(current), depth: new Uint8Array(depth), terrain: new Uint8Array(terrain) };
}
