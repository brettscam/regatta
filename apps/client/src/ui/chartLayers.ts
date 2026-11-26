/**
 * Extra layers for the chart, added by whatever knows about them (fishing grounds are the first). The chart draws
 * every layer that is switched on, over the base chart and under the route, and lists them in its side panel with a
 * switch each. A layer is told how to turn sim metres into pixels and draws what it likes.
 */
export interface ChartProjection {
  /** Pixels per metre. */
  scale: number;
  /** The canvas, CSS pixels. */
  w: number;
  h: number;
  /** Sim metres (x east, y north) to canvas pixels. */
  to(x: number, y: number): [number, number];
}

export interface ChartLayer {
  id: string;
  /** On the switch: "Fishing". */
  name: string;
  /** A line under the switch while it is on, saying what the marks mean. */
  legend?: string;
  on: boolean;
  draw(ctx: CanvasRenderingContext2D, p: ChartProjection): void;
}

const SAVED = 'regatta.layers';
const layers: ChartLayer[] = [];

function saved(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Every layer there is, in the order they were added. */
export const chartLayers = (): readonly ChartLayer[] => layers;

/** Add a layer. It comes up as it was last left, or as `layer.on` says the first time. Returns the way to take it away again. */
export function addChartLayer(layer: ChartLayer): () => void {
  const was = saved()[layer.id];
  if (typeof was === 'boolean') layer.on = was;
  layers.push(layer);
  return () => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  };
}

/** Switch a layer on or off, and remember it. */
export function setChartLayer(id: string, on: boolean): void {
  const layer = layers.find((l) => l.id === id);
  if (!layer) return;
  layer.on = on;
  try {
    localStorage.setItem(SAVED, JSON.stringify({ ...saved(), [id]: on }));
  } catch { /* not remembered */ }
}
