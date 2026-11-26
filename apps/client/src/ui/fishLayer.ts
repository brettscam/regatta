import type { Sea } from '../fishing/grounds';
import type { FishTable, Ground } from '../fishing/table';
import type { Reserve } from '../fishing/zones';
import type { ChartLayer, ChartProjection } from './chartLayers';

/** Something found on the water or heard of on the radio: a paddy, or birds over a school. */
export interface Known { key: number; what: 'paddy' | 'boil' | 'yellows' | 'foamer'; x: number; y: number; told: boolean; until: number }

const GREEN = '#1f7a4d';
const BROWN = '#7a5a14';
const RED = '#b3202a';
const INK = 'rgba(28, 43, 54, 0.85)';

const WHAT: Record<Known['what'], string> = { paddy: 'Kelp paddy', boil: 'Birds', yellows: 'Birds: yellowtail', foamer: 'Foamer' };

/**
 * The fishing layer of the chart: the grounds by name, the oil platforms and islands with their keep-off rings, the
 * kelp line, the reserves hatched as no-take, and whatever paddies and schools this boat has found or been told of
 * today. What has not been found is not shown: finding it is the game.
 * @param known the paddies and schools found or heard of, as they stand now
 */
export function fishingLayer(table: FishTable, reserves: readonly Reserve[], sea: Sea, known: () => Known[]): ChartLayer {
  // The kelp line is wherever a kelp ground's depths are met: found once by sounding the ground on a grid.
  const kelp: Array<[number, number]> = [];
  for (const g of table.grounds) {
    if (g.kind !== 'kelp' || !g.box || !g.depth) continue;
    for (let y = g.box[1]; y <= g.box[3]; y += 150) {
      for (let x = g.box[0]; x <= g.box[2]; x += 150) {
        const d = sea.depth(x, y);
        if (d >= g.depth[0] && d <= g.depth[1]) kelp.push([x, y]);
      }
    }
  }
  const label = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void => {
    ctx.font = 'italic 600 11px ui-serif, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(244, 240, 228, 0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  };
  const outline = (ctx: CanvasRenderingContext2D, p: ChartProjection, g: Ground): [number, number] | null => {
    ctx.beginPath();
    if (g.circle) {
      const [cx, cy] = p.to(g.circle[0], g.circle[1]);
      ctx.arc(cx, cy, g.circle[2] * p.scale, 0, Math.PI * 2);
      return [cx, cy - g.circle[2] * p.scale - 8];
    }
    if (g.line) {
      g.line.forEach(([x, y], i) => {
        const [sx, sy] = p.to(x, y);
        if (i) ctx.lineTo(sx, sy);
        else ctx.moveTo(sx, sy);
      });
      const [mx, my] = p.to((g.line[0][0] + g.line[g.line.length - 1][0]) / 2, (g.line[0][1] + g.line[g.line.length - 1][1]) / 2);
      return [mx, my + 12];
    }
    return null;
  };
  return {
    id: 'fishing',
    name: 'Fishing',
    on: true,
    legend: 'Green is ground that holds fish, by name. Squares are oil platforms and islands, each with a ring nobody fishes or anchors inside. Red hatching is a reserve: take nothing. Paddies and birds are marked once you have seen them or heard of them on the radio.',
    draw(ctx, p) {
      ctx.lineJoin = 'round';
      // Kelp: a stipple of green along the island.
      if (p.scale > 0.012) {
        ctx.fillStyle = 'rgba(31, 122, 77, 0.5)';
        const r = Math.max(1.2, Math.min(4, 60 * p.scale));
        for (const [x, y] of kelp) {
          const [sx, sy] = p.to(x, y);
          if (sx < -5 || sy < -5 || sx > p.w + 5 || sy > p.h + 5) continue;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (const g of table.grounds) {
        // The sand flats are a wide area with no edge worth drawing: a name in the middle of them.
        if (g.box && g.kind === 'flats' && p.scale > 0.02) {
          const [sx, sy] = p.to((g.box[0] + g.box[2]) / 2, (g.box[1] + g.box[3]) / 2 - 900);
          label(ctx, g.name.replace(/^the /, ''), sx, sy, GREEN);
        }
        if (g.box || g.kind === 'offshore') continue;
        const at = outline(ctx, p, g);
        if (!at) continue;
        const barge = g.kind === 'barge';
        ctx.setLineDash(g.line ? [] : [5, 4]);
        ctx.lineWidth = g.line ? 3 : 1.4;
        ctx.strokeStyle = barge ? BROWN : g.line ? 'rgba(31, 122, 77, 0.45)' : GREEN;
        ctx.stroke();
        if (!g.line) {
          ctx.fillStyle = barge ? 'rgba(122, 90, 20, 0.14)' : 'rgba(31, 122, 77, 0.1)';
          ctx.fill();
        }
        ctx.setLineDash([]);
        if (p.scale > 0.012 && at[0] > -80 && at[1] > -20 && at[0] < p.w + 80 && at[1] < p.h + 20) label(ctx, barge ? 'Bait barge' : g.name.replace(/^the /, ''), at[0], at[1], barge ? BROWN : GREEN);
      }
      for (const pl of table.platforms) {
        const [sx, sy] = p.to(pl.x, pl.y);
        if (sx < -60 || sy < -30 || sx > p.w + 60 || sy > p.h + 30) continue;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(5, pl.keepOff * p.scale), 0, Math.PI * 2);
        ctx.strokeStyle = RED;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = INK;
        if (pl.kind === 'platform') ctx.fillRect(sx - 3, sy - 3, 6, 6);
        else { ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill(); }
        if (p.scale > 0.012) label(ctx, pl.name, sx, sy - Math.max(5, pl.keepOff * p.scale) - 8, INK);
      }
      for (const r of reserves) {
        const [sx, sy] = p.to(r.x, r.y);
        const rad = Math.max(4, r.r * p.scale);
        if (sx + rad < 0 || sy + rad < 0 || sx - rad > p.w || sy - rad > p.h) continue;
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.strokeStyle = RED;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.clip();
        ctx.beginPath();
        for (let k = -rad * 2; k <= rad * 2; k += 6) {
          ctx.moveTo(sx + k - rad, sy + rad);
          ctx.lineTo(sx + k + rad, sy - rad);
        }
        ctx.strokeStyle = 'rgba(179, 32, 42, 0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        if (p.scale > 0.03) label(ctx, `${r.name}: no take`, sx, sy + rad + 9, RED);
      }
      for (const k of known()) {
        const [sx, sy] = p.to(k.x, k.y);
        if (sx < -40 || sy < -20 || sx > p.w + 40 || sy > p.h + 20) continue;
        ctx.beginPath();
        if (k.what === 'paddy') {
          ctx.ellipse(sx, sy, 7, 4.5, 0.4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(122, 90, 20, 0.85)';
          ctx.fill();
        } else {
          // Birds: three small ticks.
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.6;
          for (const [ox, oy] of [[-6, 2], [0, -4], [6, 1]]) {
            ctx.moveTo(sx + ox - 4, sy + oy - 2);
            ctx.lineTo(sx + ox, sy + oy + 1);
            ctx.lineTo(sx + ox + 4, sy + oy - 2);
          }
          ctx.stroke();
        }
        label(ctx, `${WHAT[k.what]}${k.told ? ' (reported)' : ''}`, sx, sy + 14, k.what === 'paddy' ? BROWN : INK);
      }
    },
  };
}
