// A town as somewhere to walk: the rings `scene/town.ts` plans (a front, a pier, streets in steps, floats), in the
// shape `ground.ts` asks for. Pure. A town has many pieces of ground on several levels, so unlike a venue its areas
// are linked by where they actually meet, and it has more than one way down to the water.
import type { TownLayout } from '../scene/town';
import { BODY } from './fromVenue';
import { inRing, walkKind, type Pt, type Sight, type WalkArea, type WalkBlock, type WalkGround, type WalkSpot } from './ground';

/** The most one piece of ground may stand above the next and still be stepped between: a flight of stairs, a gangway at low water. */
const STEP = 3.6;

/** True when two outlines overlap or share an edge: a corner, an edge point or the middle of one lies in or on the other. */
function meet(a: readonly Pt[], b: readonly Pt[]): boolean {
  const probe = (p: readonly Pt[], q: readonly Pt[]): boolean => {
    const cx = p.reduce((s, c) => s + c[0], 0) / p.length;
    const cy = p.reduce((s, c) => s + c[1], 0) / p.length;
    if (inRing(q, cx, cy)) return true;
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      for (let t = 0; t <= 4; t++) {
        const x = x0 + ((x1 - x0) * t) / 4;
        const y = y0 + ((y1 - y0) * t) / 4;
        if (inRing(q, x + (cx - x) * 0.02, y + (cy - y) * 0.02) || inRing(q, x - (cx - x) * 0.02, y - (cy - y) * 0.02)) return true;
      }
    }
    return false;
  };
  return probe(a, b) || probe(b, a);
}

/** Spot names as words: "pier-end" is "the pier end". */
const words = (name: string): string => `the ${name.replace(/-\d+$/, '').replace(/-/g, ' ')}`;

/**
 * The ground of a town. Every landing of a town gives the same ground, under the town's own id, so two crews who
 * came ashore at different floats are in the same place and can meet.
 */
export function groundOfTown(layout: TownLayout): WalkGround | null {
  if (!layout.walk.length) return null;
  const path = (i: number) => layout.paths.find((p) => i >= p.from && i <= p.to);
  const areas: WalkArea[] = layout.walk.map((ring, i) => ({ ring, z: layout.heights[i] ?? layout.floor, name: path(i)?.name }));
  const links: Array<[number, number]> = [];
  for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) {
    if (Math.abs(areas[i].z - areas[j].z) <= STEP && meet(areas[i].ring, areas[j].ring)) links.push([i, j]);
  }

  const blocks: WalkBlock[] = [];
  const dot = (x: number, y: number, r: number) => blocks.push({ ax: x, ay: y, bx: x, by: y, r: r + BODY });
  const bars: WalkSpot[] = [];
  const sights: Sight[] = [];
  const spots: WalkSpot[] = layout.spots.map((s) => {
    const out: WalkSpot = { name: s.name, kind: walkKind(s.kind), x: s.x, y: s.y, face: s.face };
    const table = /^(table-\d+)-seat-\d+$/.exec(s.name);
    if (table) out.group = table[1];
    else if (s.kind === 'bar') out.group = 'bar';
    if (s.kind === 'table') dot(s.x, s.y, 0.5);
    else if (s.kind === 'seat') dot(s.x, s.y, 0.2);
    else if (s.kind === 'bar') bars.push(out);
    // The fountain stands 2.9 m in front of whoever has stopped to look at it (`scene/townDraw.ts`).
    if (s.name === 'fountain') dot(s.x + Math.sin(s.face) * 2.9, s.y + Math.cos(s.face) * 2.9, 1.5);
    // What there is to say at a spot is said of the thing in front of it.
    const line = layout.says[s.name];
    if (line) sights.push({ name: words(s.name), x: s.x + Math.sin(s.face) * 6, y: s.y + Math.cos(s.face) * 6, line });
    return out;
  });
  if (bars.length) {
    // The counter the bar spots stand at: 0.75 m in front of the middle one, 4.6 m long (`scene/townDraw.ts`).
    const m = bars[Math.floor(bars.length / 2)];
    const fx = Math.sin(m.face);
    const fy = Math.cos(m.face);
    blocks.push({ ax: m.x + fx * 0.75 - fy * 2.3, ay: m.y + fy * 0.75 + fx * 2.3, bx: m.x + fx * 0.75 + fy * 2.3, by: m.y + fy * 0.75 - fx * 2.3, r: 0.3 + BODY });
  }
  return { id: layout.id, name: layout.name, x: layout.x, y: layout.y, heading: layout.heading, areas, links, blocks, walls: [], roofs: [], spots, sights };
}
