import { describe, expect, it, vi } from 'vitest';

// The layer's styles are added to a page; there is none here.
vi.mock('../src/ui/fishStyle', () => ({}));

import { tableOf } from '../src/fishing/table';
import { reservesOf } from '../src/fishing/zones';
import { addChartLayer, chartLayers, setChartLayer, type ChartProjection } from '../src/ui/chartLayers';
import { fishingLayer, type Known } from '../src/ui/fishLayer';
import { worldOf } from './waters';

const table = tableOf('catalina')!;
const reserves = reservesOf('catalina');
const world = worldOf('catalina', 3);

/** A canvas that only remembers what was written on it. */
function fakeCanvas(): { ctx: CanvasRenderingContext2D; words: string[]; calls: Record<string, number> } {
  const words: string[] = [];
  const calls: Record<string, number> = {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, name: string) {
      if (name in target) return target[name];
      return (...args: unknown[]) => {
        calls[name] = (calls[name] ?? 0) + 1;
        if (name === 'fillText') words.push(String(args[0]));
      };
    },
    set(target, name: string, value) {
      target[name] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, words, calls };
}

/** The whole water on a 1000 px chart. */
const whole: ChartProjection = { scale: 0.014, w: 1000, h: 1000, to: (x, y) => [500 + (x + 3000) * 0.014, 500 - (y + 3000) * 0.014] };
const close = (cx: number, cy: number, scale: number): ChartProjection => ({ scale, w: 1000, h: 1000, to: (x, y) => [500 + (x - cx) * scale, 500 - (y - cy) * scale] });

describe('the fishing layer of the chart', () => {
  it('names the grounds, the platforms and the reserves, and stipples the kelp', () => {
    const layer = fishingLayer(table, reserves, { depth: (x, y) => world.chartDepth(x, y) }, () => []);
    const c = fakeCanvas();
    layer.draw(c.ctx, whole);
    for (const name of ['Hen Rock', 'East End', 'Bait barge']) expect(c.words, name).toContain(name);
    // What the chart itself draws and names from the water's features (the platforms, the oil islands) and the course's own
    // mark at the Horseshoe Kelp are not named a second time by this layer.
    for (const name of ['Horseshoe Kelp', 'Platform Eureka', 'Platform Edith', 'Island Grissom']) expect(c.words, name).not.toContain(name);
    expect(table.platforms.every((p) => p.charted)).toBe(true);
    // Kelp: hundreds of dots along the island, none of them a label.
    expect(c.calls.arc).toBeGreaterThan(300);
    expect(c.calls.setLineDash).toBeGreaterThan(10);
    // The reserves are named once the chart is close enough to read them, and hatched.
    expect(c.words.join('|')).not.toMatch(/no take/);
    const near = fakeCanvas();
    layer.draw(near.ctx, close(-2000, -22600, 0.2));
    expect(near.words).toContain('Casino Point Dive Park: no take');
    expect(near.words).toContain("Lover's Cove: no take");
    expect(near.calls.clip).toBe(2);
  });

  it('shows only the paddies and birds that have been found or reported', () => {
    let known: Known[] = [];
    const layer = fishingLayer(table, reserves, { depth: () => 50 }, () => known);
    const empty = fakeCanvas();
    layer.draw(empty.ctx, whole);
    expect(empty.words.join('|')).not.toMatch(/paddy|Birds|Foamer/);
    known = [
      { key: 1, what: 'paddy', x: 5000, y: 2000, told: true, until: 1e9 },
      { key: 2, what: 'boil', x: 8000, y: 9000, told: false, until: 1e9 },
      { key: 3, what: 'foamer', x: -3000, y: -9000, told: false, until: 1e9 },
    ];
    const c = fakeCanvas();
    layer.draw(c.ctx, whole);
    expect(c.words).toContain('Kelp paddy (reported)');
    expect(c.words).toContain('Birds');
    expect(c.words).toContain('Foamer');
  });

  it('is a layer the chart can list and switch', () => {
    const layer = fishingLayer(table, reserves, { depth: () => 50 }, () => []);
    expect(layer.on).toBe(true);
    const remove = addChartLayer(layer);
    expect(chartLayers().map((l) => l.id)).toContain('fishing');
    setChartLayer('fishing', false);
    expect(layer.on).toBe(false);
    setChartLayer('fishing', true);
    expect(layer.on).toBe(true);
    setChartLayer('no-such-layer', true);
    remove();
    expect(chartLayers().map((l) => l.id)).not.toContain('fishing');
  });
});
