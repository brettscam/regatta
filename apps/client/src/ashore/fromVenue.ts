// A venue as somewhere to walk: the deck, the walkway and the guest float that `scene/venue.ts` lays out, in the
// shape `ground.ts` asks for. Pure. A town drawn by other means needs its own small file like this one, or none at
// all if its data is already a `WalkGround`.
import type { VenueLayout } from '../scene/venue';
import type { Pt, WalkArea, WalkBlock, WalkGround, WalkRoof, WalkSpot, WalkWall } from './ground';

/** Half the width of a person, which everything standing on the floor is grown by. */
export const BODY = 0.25;

const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const NAMES = ['deck', 'walkway', 'float'];

/** The ground of one venue. Null where it has nothing to stand on. */
export function groundOfVenue(layout: VenueLayout): WalkGround | null {
  if (!layout.walk.length) return null;
  const areas: WalkArea[] = layout.walk.map((ring, i) => {
    const [z0, z1] = layout.levels?.[i] ?? [layout.floor, layout.floor];
    const name = layout.walk.length === 1 ? 'deck' : NAMES[i + (3 - layout.walk.length)] ?? 'deck';
    // The outlines are rectangles, begun at the shore end: a slope runs from the middle of the first edge to the middle of the third.
    return z0 === z1 || ring.length !== 4 ? { ring, z: z0, name } : { ring, z: z0, ramp: { from: mid(ring[0], ring[1]), to: mid(ring[2], ring[3]), z1 }, name };
  });
  // Each opens onto the next: deck, walkway, float.
  const links: Array<[number, number]> = [];
  for (let i = 0; i + 1 < areas.length; i++) links.push([i, i + 1]);

  const blocks: WalkBlock[] = [];
  const dot = (x: number, y: number, r: number) => blocks.push({ ax: x, ay: y, bx: x, by: y, r: r + BODY });
  const bars: WalkSpot[] = [];
  const spots: WalkSpot[] = layout.spots.map((s) => {
    const out: WalkSpot = { name: s.name, kind: s.kind, x: s.x, y: s.y, face: s.face };
    if (s.taken) out.taken = true;
    // "table-3-seat-2" is one of the seats of "table-3". The stools of the bar are together too.
    const table = /^(table-\d+)-seat-\d+$/.exec(s.name);
    if (table) out.group = table[1];
    else if (s.kind === 'bar') out.group = 'bar';
    if (s.kind === 'table') dot(s.x, s.y, 0.5);
    else if (s.kind === 'seat') dot(s.x, s.y, 0.2);
    else if (s.kind === 'fire') dot(s.x, s.y, layout.kind === 'park' ? 0.45 : 0.8);
    else if (s.kind === 'bar') bars.push(out);
    return out;
  });
  if (bars.length) {
    // The counter lies 0.9 m in front of the stools, along them, and a little past each end.
    const a = bars[0];
    const b = bars[bars.length - 1];
    const fx = Math.sin(a.face);
    const fy = Math.cos(a.face);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ex = ((b.x - a.x) / len) * 0.4;
    const ey = ((b.y - a.y) / len) * 0.4;
    blocks.push({ ax: a.x + fx * 0.9 - ex, ay: a.y + fy * 0.9 - ey, bx: b.x + fx * 0.9 + ex, by: b.y + fy * 0.9 + ey, r: 0.3 + BODY });
  }

  // The building stands along the deck's first edge. The camera stays on the deck's side of it.
  const walls: WalkWall[] = [];
  const deck = layout.walk[0];
  if (deck.length >= 2 && layout.kind !== 'park') {
    const [a, b] = deck;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ex = ((b[0] - a[0]) / len) * 6;
    const ey = ((b[1] - a[1]) / len) * 6;
    walls.push({ ax: a[0] - ex, ay: a[1] - ey, bx: b[0] + ex, by: b[1] + ey, top: layout.floor + 3.2 });
  }
  // What `scene/shoreside.ts` hangs over the first of the deck: a bar's awning, 4.4 m out with its valance 2.25 m above
  // the floor, and the porch of a store or a marina's office, 3 m out and a little higher.
  const roofs: WalkRoof[] = [];
  const cover = layout.kind === 'bar' ? { out: 4.6, z: 2.25 } : layout.kind === 'store' || layout.kind === 'marina' ? { out: 3.2, z: 2.4 } : null;
  if (cover && deck.length === 4 && layout.walk.length !== 2) {
    const [a, b, , d] = deck;
    const far = Math.hypot(d[0] - a[0], d[1] - a[1]) || 1;
    const nx = ((d[0] - a[0]) / far) * cover.out;
    const ny = ((d[1] - a[1]) / far) * cover.out;
    roofs.push({ ring: [a, b, [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]], z: layout.floor + cover.z });
  }
  return { id: layout.id, name: layout.name, x: layout.x, y: layout.y, heading: layout.heading, areas, links, blocks, walls, roofs, spots };
}
