import { KT, R2D, type PolarTable } from '@slack-tide/sim';
import { metresToNm } from '@slack-tide/nav';
import type { CourseData, ReplayWorld } from '@slack-tide/world';
import type { Passage } from './passage';
import type { TrafficVessel } from '../scene/traffic';

const D2R = Math.PI / 180;
const NM = 1852;
/** The flood sets about east-north-east through the Gate. Current along this bearing is flood, against it is ebb. */
const FLOOD_AXIS = 65 * D2R;

// A paper chart in daylight: buff land, white deep water, blue shoals, magenta for anything navigational.
const INK = '#1c2b36';
const LAND = '#ecdcae';
const LAND_EDGE = '#8a7a55';
const DEEP = '#f3f8fa';
const MAGENTA = '#b0237a';
const STREAM = '#1d6fb8';
const WIND = '#4a5560';
const TRACK = '#14222c';
const TARGET = '#0d6a5f';
const TARGET_CLOSE = '#c0392b';
/** A target that will pass inside this many metres within ten minutes is drawn as a danger. */
const CLOSE_QUARTERS = 250;

export interface ChartBoat {
  x: number;
  y: number;
  heading: number;
  cog: number;
  sog: number;
}

export interface ChartHost {
  world: ReplayWorld;
  passage: Passage;
  polar: PolarTable;
  /** Sim time now, seconds since the session started. */
  now(): number;
  boat(): ChartBoat;
  /** Other vessels on the water, shown like AIS targets. */
  traffic?: () => TrafficVessel[];
}

interface View {
  cx: number;
  cy: number;
  /** Pixels per metre. */
  scale: number;
}

const pad3 = (rad: number) => String(Math.round(((rad * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');

/** Closest point of approach if both hold course and speed, looking no more than ten minutes ahead. */
function approach(boat: ChartBoat, v: TrafficVessel): { cpa: number; tcpa: number; range: number; bearing: number } {
  const px = v.x - boat.x;
  const py = v.y - boat.y;
  const wx = Math.sin(v.heading) * v.sog - Math.sin(boat.cog) * boat.sog;
  const wy = Math.cos(v.heading) * v.sog - Math.cos(boat.cog) * boat.sog;
  const w2 = wx * wx + wy * wy;
  const tcpa = w2 < 1e-6 ? 0 : Math.max(0, Math.min(600, -(px * wx + py * wy) / w2));
  return { cpa: Math.hypot(px + wx * tcpa, py + wy * tcpa), tcpa, range: Math.hypot(px, py), bearing: Math.atan2(px, py) };
}

function minutes(seconds: number): string {
  const m = Math.round(Math.abs(seconds) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

/**
 * The chartplotter. A small preview sits in the corner. Opened full size it is where the passage is planned:
 * drop and drag waypoints, read each leg's course, wind, tide and ETA from the forecast, scrub the forecast ahead,
 * and compare the plan with the track actually sailed.
 */
export class Chart {
  private readonly course: CourseData;
  private readonly mini = document.getElementById('mini') as HTMLCanvasElement;
  private readonly overlay = document.getElementById('chart') as HTMLElement;
  private readonly map: HTMLCanvasElement;
  private readonly strip: HTMLCanvasElement;
  private readonly side: HTMLElement;
  private readonly depthLayer: HTMLCanvasElement;
  private readonly coast = new Path2D();
  private readonly view: View = { cx: 0, cy: 0, scale: 0.05 };
  private readonly timeFmt: Intl.DateTimeFormat;
  private readonly dayFmt: Intl.DateTimeFormat;
  private open = false;
  /** Time the chart is showing. Null means live. */
  private viewTime: number | null = null;
  private miniClock = 0;
  private mapClock = 0;
  private sideClock = 0;
  private notice = { text: '', ttl: 0 };
  private pointer:
    | { kind: 'pan'; x: number; y: number; moved: number }
    | { kind: 'mark'; index: number; moved: number }
    | null = null;

  constructor(private readonly host: ChartHost) {
    this.course = host.world.course;
    this.timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: this.course.timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
    this.dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: this.course.timeZone, weekday: 'short', day: 'numeric', month: 'short' });
    this.overlay.innerHTML = `
      <div class="chart-frame">
        <canvas class="chart-map" aria-label="Chart. Click water to add a waypoint, drag a waypoint to move it, double-click one to remove it."></canvas>
        <aside class="chart-side"></aside>
        <canvas class="chart-strip" aria-label="Forecast timeline. Drag to look ahead, double-click to return to now."></canvas>
      </div>`;
    this.map = this.overlay.querySelector('.chart-map') as HTMLCanvasElement;
    this.strip = this.overlay.querySelector('.chart-strip') as HTMLCanvasElement;
    this.side = this.overlay.querySelector('.chart-side') as HTMLElement;
    this.depthLayer = this.buildDepthLayer();
    for (const ring of this.course.coast) {
      this.coast.moveTo(ring[0], -ring[1]);
      for (let i = 2; i < ring.length; i += 2) this.coast.lineTo(ring[i], -ring[i + 1]);
      this.coast.closePath();
    }
    this.bind();
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.overlay.hidden = !this.open;
    if (this.open) {
      // Open on the whole route and the boat.
      this.frameRoute();
      this.viewTime = null;
      this.mapClock = 0;
      this.sideClock = 0;
    }
  }

  setMiniHidden(hidden: boolean): void {
    this.mini.hidden = hidden;
  }

  // ---- setup ----------------------------------------------------------------------------------

  private buildDepthLayer(): HTMLCanvasElement {
    const g = this.course.depth;
    const c = document.createElement('canvas');
    c.width = g.nx;
    c.height = g.ny;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(g.nx, g.ny);
    // Depth bands as on a chart: the shallower, the bluer. Land is left clear for the coastline layer.
    const bands: Array<[number, [number, number, number]]> = [
      [2, [143, 196, 170]], [5, [157, 203, 230]], [10, [186, 220, 238]], [20, [217, 236, 245]], [1e9, [243, 248, 250]],
    ];
    const cells = new Uint8Array(g.nx * g.ny);
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) cells[j * g.nx + i] = Math.round(this.host.world.chartDepth(g.x0 + i * g.dx, g.y0 + j * g.dx) / g.scale);
    }
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const d = cells[j * g.nx + i] * g.scale;
        const o = ((g.ny - 1 - j) * g.nx + i) * 4;
        const col = bands.find((b) => d <= b[0])![1];
        img.data[o] = col[0];
        img.data[o + 1] = col[1];
        img.data[o + 2] = col[2];
        img.data[o + 3] = d <= 0 ? 0 : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private bind(): void {
    this.mini.addEventListener('click', () => this.toggle(true));
    this.overlay.addEventListener('pointerdown', (e) => { if (e.target === this.overlay) this.toggle(false); });

    const m = this.map;
    m.addEventListener('pointerdown', (e) => {
      m.setPointerCapture(e.pointerId);
      const hit = this.markAt(e.offsetX, e.offsetY);
      this.pointer = hit >= 0 ? { kind: 'mark', index: hit, moved: 0 } : { kind: 'pan', x: e.offsetX, y: e.offsetY, moved: 0 };
    });
    m.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (!p) {
        m.style.cursor = this.markAt(e.offsetX, e.offsetY) >= 0 ? 'grab' : 'crosshair';
        return;
      }
      p.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (p.moved < 4) return;
      if (p.kind === 'pan') {
        this.view.cx -= e.movementX / this.view.scale;
        this.view.cy += e.movementY / this.view.scale;
      } else {
        const w = this.fromScreen(m, e.offsetX, e.offsetY);
        if (this.host.world.chartDepth(w.x, w.y) > 0) this.host.passage.moveMark(p.index, w, this.host.boat(), this.host.now());
      }
      this.mapClock = 0;
    });
    m.addEventListener('pointerup', (e) => {
      const p = this.pointer;
      this.pointer = null;
      if (!p || p.moved >= 4 || p.kind !== 'pan') return;
      // A plain click on water drops a waypoint at the end of the route.
      const w = this.fromScreen(m, e.offsetX, e.offsetY);
      if (this.host.world.chartDepth(w.x, w.y) <= 0) {
        this.notice = { text: 'That is dry land. Pick a spot on the water', ttl: 3 };
      } else {
        this.host.passage.addMark(w, this.host.boat(), this.host.now());
      }
      this.mapClock = 0;
      this.sideClock = 0;
    });
    m.addEventListener('dblclick', (e) => {
      const hit = this.markAt(e.offsetX, e.offsetY);
      if (hit >= 0) {
        this.host.passage.removeMark(hit, this.host.boat(), this.host.now());
        this.mapClock = 0;
        this.sideClock = 0;
      }
    });
    m.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.fromScreen(m, e.offsetX, e.offsetY);
      const k = Math.exp(-Math.max(-300, Math.min(300, e.deltaY)) * 0.0016);
      this.view.scale = Math.max(0.012, Math.min(0.9, this.view.scale * k));
      const after = this.fromScreen(m, e.offsetX, e.offsetY);
      this.view.cx += before.x - after.x;
      this.view.cy += before.y - after.y;
      this.mapClock = 0;
    }, { passive: false });

    const s = this.strip;
    let scrubbing = false;
    const scrub = (e: PointerEvent) => {
      const r = this.stripRange();
      const t = r.t0 + ((e.offsetX - r.left) / r.width) * (r.t1 - r.t0);
      this.viewTime = Math.max(r.t0, Math.min(r.t1, t));
      this.mapClock = 0;
      this.sideClock = 0;
    };
    s.addEventListener('pointerdown', (e) => { scrubbing = true; s.setPointerCapture(e.pointerId); scrub(e); });
    s.addEventListener('pointermove', (e) => { if (scrubbing) scrub(e); });
    s.addEventListener('pointerup', () => { scrubbing = false; });
    s.addEventListener('dblclick', () => { this.viewTime = null; this.mapClock = 0; this.sideClock = 0; });
  }

  // ---- geometry -------------------------------------------------------------------------------

  private size(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  private fromScreen(c: HTMLCanvasElement, sx: number, sy: number): { x: number; y: number } {
    return { x: this.view.cx + (sx - c.clientWidth / 2) / this.view.scale, y: this.view.cy - (sy - c.clientHeight / 2) / this.view.scale };
  }

  private markAt(sx: number, sy: number): number {
    const marks = this.host.passage.marks;
    for (let i = marks.length - 1; i >= 0; i--) {
      if (marks[i].reachedAt !== null) continue;
      const px = this.map.clientWidth / 2 + (marks[i].x - this.view.cx) * this.view.scale;
      const py = this.map.clientHeight / 2 - (marks[i].y - this.view.cy) * this.view.scale;
      if (Math.hypot(px - sx, py - sy) < 14) return i;
    }
    return -1;
  }

  private frameRoute(): void {
    const b = this.host.boat();
    let x0 = b.x, x1 = b.x, y0 = b.y, y1 = b.y;
    for (const m of this.host.passage.marks) {
      x0 = Math.min(x0, m.x); x1 = Math.max(x1, m.x); y0 = Math.min(y0, m.y); y1 = Math.max(y1, m.y);
    }
    const w = Math.max(200, this.map.clientWidth || 800);
    const h = Math.max(200, this.map.clientHeight || 500);
    this.view.cx = (x0 + x1) / 2;
    this.view.cy = (y0 + y1) / 2;
    this.view.scale = Math.max(0.02, Math.min(0.25, Math.min(w / (x1 - x0 + 3200), h / (y1 - y0 + 3200))));
  }

  private clock(t: number): string {
    return this.timeFmt.format(this.host.world.dateAt(t));
  }

  // ---- frame ----------------------------------------------------------------------------------

  /** Call every frame with real seconds elapsed. */
  update(dt: number): void {
    this.notice.ttl -= dt;
    this.miniClock -= dt;
    if (this.miniClock <= 0 && !this.mini.hidden) {
      this.miniClock = 0.25;
      this.drawMini();
    }
    if (!this.open) return;
    this.mapClock -= dt;
    if (this.mapClock <= 0) {
      this.mapClock = 0.12;
      this.drawMap();
      this.drawStrip();
    }
    this.sideClock -= dt;
    if (this.sideClock <= 0) {
      this.sideClock = 0.5;
      this.drawSide();
    }
  }

  // ---- shared drawing -------------------------------------------------------------------------

  private drawBase(ctx: CanvasRenderingContext2D, w: number, h: number, v: View): void {
    ctx.fillStyle = DEEP;
    ctx.fillRect(0, 0, w, h);
    const g = this.course.depth;
    ctx.save();
    ctx.translate(w / 2 - v.cx * v.scale, h / 2 + v.cy * v.scale);
    ctx.scale(v.scale, v.scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.depthLayer, g.x0 - g.dx / 2, -(g.y0 + (g.ny - 1) * g.dx) - g.dx / 2, g.nx * g.dx, g.ny * g.dx);
    ctx.fillStyle = LAND;
    ctx.fill(this.coast, 'evenodd');
    ctx.strokeStyle = LAND_EDGE;
    ctx.lineWidth = 1.1 / v.scale;
    ctx.stroke(this.coast);
    // The bridge.
    const [sx, sy] = this.course.bridge.south;
    const [nx, ny] = this.course.bridge.north;
    const len = Math.hypot(nx - sx, ny - sy);
    const ux = (nx - sx) / len;
    const uy = (ny - sy) / len;
    ctx.strokeStyle = '#b3402e';
    ctx.lineWidth = Math.max(2.4 / v.scale, 27);
    ctx.beginPath();
    ctx.moveTo(sx - ux * 343, -(sy - uy * 343));
    ctx.lineTo(nx + ux * 343, -(ny + uy * 343));
    ctx.stroke();
    ctx.restore();
  }

  private screen(w: number, h: number, v: View, x: number, y: number): [number, number] {
    return [w / 2 + (x - v.cx) * v.scale, h / 2 - (y - v.cy) * v.scale];
  }

  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, toward: number, len: number, head: number): void {
    const dx = Math.sin(toward);
    const dy = -Math.cos(toward);
    const ex = x + dx * len;
    const ey = y + dy * len;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - dx * head - dy * head * 0.55, ey - dy * head + dx * head * 0.55);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - dx * head + dy * head * 0.55, ey - dy * head - dx * head * 0.55);
    ctx.stroke();
  }

  private drawRoute(ctx: CanvasRenderingContext2D, w: number, h: number, v: View, labels: boolean): void {
    const p = this.host.passage;
    const boat = this.host.boat();
    const now = this.host.now();
    // The track actually sailed.
    if (p.track.length >= 4) {
      ctx.strokeStyle = TRACK;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < p.track.length; i += 2) {
        const [sx, sy] = this.screen(w, h, v, p.track[i], p.track[i + 1]);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      const [bx, by] = this.screen(w, h, v, boat.x, boat.y);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    // The planned route.
    const ahead = p.ahead();
    if (p.plan && ahead.length) {
      ctx.strokeStyle = MAGENTA;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      const [x0, y0] = this.screen(w, h, v, p.plan.start.x, p.plan.start.y);
      ctx.moveTo(x0, y0);
      for (const m of ahead) ctx.lineTo(...this.screen(w, h, v, m.x, m.y));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    p.marks.forEach((m, i) => {
      const [sx, sy] = this.screen(w, h, v, m.x, m.y);
      const done = m.reachedAt !== null;
      ctx.beginPath();
      ctx.arc(sx, sy, labels ? 9 : 5, 0, Math.PI * 2);
      ctx.fillStyle = done ? '#d9c4d2' : '#fff';
      ctx.fill();
      ctx.strokeStyle = MAGENTA;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (labels) {
        ctx.fillStyle = MAGENTA;
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), sx, sy + 0.5);
        ctx.textAlign = 'left';
        ctx.fillText(m.name, sx + 13, sy + 2);
        if (m.leg && !done) {
          ctx.fillStyle = INK;
          ctx.font = '500 10.5px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText(`${pad3(m.leg.bearing)}°  ${metresToNm(m.leg.distance).toFixed(2)} nm  ${this.clock(m.plannedEta ?? 0)}`, sx + 13, sy + 15);
          ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
        }
      }
    });
    // Where the plan says the boat should be now.
    const st = p.status(boat, now);
    if (st.planned && st.next) {
      const [gx, gy] = this.screen(w, h, v, st.planned.x, st.planned.y);
      ctx.strokeStyle = MAGENTA;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(gx, gy, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (labels) {
        ctx.fillStyle = MAGENTA;
        ctx.textAlign = 'left';
        ctx.fillText('plan', gx + 10, gy);
      }
    }
  }

  /** Other vessels as AIS targets: heading, a three-minute course vector, and on the full chart a name and speed. */
  private drawTraffic(ctx: CanvasRenderingContext2D, w: number, h: number, v: View, labels: boolean): void {
    const vessels = this.host.traffic?.();
    if (!vessels) return;
    const boat = this.host.boat();
    for (const t of vessels) {
      const [x, y] = this.screen(w, h, v, t.x, t.y);
      if (x < -60 || y < -60 || x > w + 60 || y > h + 60) continue;
      const ap = approach(boat, t);
      const close = ap.cpa < CLOSE_QUARTERS + t.length / 2 && ap.range < 3000;
      const colour = close ? TARGET_CLOSE : TARGET;
      if (t.sog > 0.3) {
        const len = t.sog * 180 * v.scale;
        ctx.strokeStyle = colour;
        ctx.lineWidth = labels ? 1.3 : 1;
        ctx.setLineDash(labels ? [4, 3] : []);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.sin(t.heading) * len, y - Math.cos(t.heading) * len);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t.heading);
      ctx.strokeStyle = colour;
      ctx.fillStyle = close ? 'rgba(192, 57, 43, 0.25)' : 'rgba(255, 255, 255, 0.82)';
      ctx.lineWidth = labels ? 1.7 : 1.3;
      ctx.lineJoin = 'round';
      const L = t.length * v.scale;
      const B = t.beam * v.scale;
      ctx.beginPath();
      if (labels && L > 16) {
        // Big enough on screen to draw to scale: a ship's outline.
        ctx.moveTo(0, -L / 2);
        ctx.lineTo(B / 2, -L / 2 + B * 0.9);
        ctx.lineTo(B / 2, L / 2);
        ctx.lineTo(-B / 2, L / 2);
        ctx.lineTo(-B / 2, -L / 2 + B * 0.9);
      } else {
        const s = labels ? 8 : 5;
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.55, s * 0.7);
        ctx.lineTo(-s * 0.55, s * 0.7);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (labels) {
        ctx.fillStyle = colour;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '600 10.5px ui-sans-serif, system-ui, sans-serif';
        const off = Math.max(11, Math.min(L, 60) / 2 + 6);
        ctx.fillText(t.name, x + off, y - 6);
        ctx.font = '500 10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(t.sog < 0.3 ? 'stopped' : `${(t.sog / KT).toFixed(1)} kt  ${pad3(t.heading)}°`, x + off, y + 6);
      }
    }
  }

  private drawBoat(ctx: CanvasRenderingContext2D, w: number, h: number, v: View, size: number): void {
    const b = this.host.boat();
    const [x, y] = this.screen(w, h, v, b.x, b.y);
    // Course over ground: where she will be in three minutes.
    if (b.sog > 0.3) {
      const len = b.sog * 180 * v.scale;
      ctx.strokeStyle = TRACK;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(b.cog) * len, y - Math.cos(b.cog) * len);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.heading);
    ctx.fillStyle = '#0f1c26';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.quadraticCurveTo(size * 0.62, -size * 0.1, size * 0.42, size * 0.8);
    ctx.lineTo(-size * 0.42, size * 0.8);
    ctx.quadraticCurveTo(-size * 0.62, -size * 0.1, 0, -size);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ---- the corner preview ---------------------------------------------------------------------

  private drawMini(): void {
    const { ctx, w, h } = this.size(this.mini);
    const b = this.host.boat();
    const now = this.host.now();
    const v: View = { cx: b.x, cy: b.y, scale: w / 4600 };
    // Look a little ahead of the boat toward the next mark.
    const st = this.host.passage.status(b, now);
    if (st.next) {
      const d = Math.hypot(st.next.x - b.x, st.next.y - b.y) || 1;
      const lead = Math.min(900, d * 0.4);
      v.cx += ((st.next.x - b.x) / d) * lead;
      v.cy += ((st.next.y - b.y) / d) * lead;
    }
    this.drawBase(ctx, w, h, v);
    this.drawRoute(ctx, w, h, v, false);
    this.drawTraffic(ctx, w, h, v, false);
    this.drawBoat(ctx, w, h, v, 8);

    // Wind and tide at the boat, north up.
    const wind = this.host.world.wind(b.x, b.y, now);
    const cur = this.host.world.current(b.x, b.y, now);
    const drift = Math.hypot(cur.x, cur.y);
    ctx.lineCap = 'round';
    ctx.strokeStyle = WIND;
    ctx.lineWidth = 2.2;
    this.arrow(ctx, 24 - Math.sin(wind.dir + Math.PI) * 11, 26 + Math.cos(wind.dir + Math.PI) * 11, wind.dir + Math.PI, 22, 7);
    if (drift > 0.05) {
      ctx.strokeStyle = STREAM;
      const set = Math.atan2(cur.x, cur.y);
      this.arrow(ctx, 24 - Math.sin(set) * 9, 62 + Math.cos(set) * 9, set, 18, 6);
    }
    ctx.font = '600 9.5px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = WIND;
    ctx.fillText(`${(wind.speed / KT).toFixed(0)} kt`, 44, 26);
    ctx.fillStyle = STREAM;
    ctx.fillText(`${(drift / KT).toFixed(1)} kt`, 44, 62);

    // Next mark and how the plan is going.
    ctx.fillStyle = 'rgba(12, 22, 30, 0.82)';
    ctx.fillRect(0, h - 22, w, 22);
    ctx.fillStyle = '#eef3f4';
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    let line = 'Chart  ·  M';
    if (st.next && st.fix) {
      line = `${st.next.name}  ${pad3(st.fix.bearing)}°  ${metresToNm(st.fix.toGo).toFixed(2)} nm`;
      if (st.behind !== null && Math.abs(st.behind) >= 30) line += `  ·  ${minutes(st.behind)} ${st.behind > 0 ? 'behind' : 'ahead'}`;
    }
    ctx.fillText(line, 8, h - 11);
  }

  // ---- the full chart -------------------------------------------------------------------------

  private drawMap(): void {
    const { ctx, w, h } = this.size(this.map);
    const v = this.view;
    const now = this.host.now();
    const t = this.viewTime ?? now;
    const ahead = t > now + 1;
    const world = this.host.world;
    this.drawBase(ctx, w, h, v);

    // Latitude and longitude, one minute apart.
    const mLat = (Math.PI / 180) * 6371008.8;
    const mLon = mLat * Math.cos(this.course.origin.lat * D2R);
    const tl = this.fromScreen(this.map, 0, 0);
    const br = this.fromScreen(this.map, w, h);
    const every = v.scale > 0.11 ? 0.5 : v.scale > 0.035 ? 1 : 2;
    ctx.strokeStyle = 'rgba(28, 43, 54, 0.16)';
    ctx.fillStyle = 'rgba(28, 43, 54, 0.7)';
    ctx.lineWidth = 1;
    ctx.font = '500 10.5px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    const latMin0 = Math.ceil(((this.course.origin.lat + br.y / mLat) * 60) / every) * every;
    for (let m = latMin0; (m / 60 - this.course.origin.lat) * mLat < tl.y; m += every) {
      const y = h / 2 - ((m / 60 - this.course.origin.lat) * mLat - v.cy) * v.scale;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.floor(m / 60)}°${(m % 60).toFixed(every < 1 ? 1 : 0).padStart(every < 1 ? 4 : 2, '0')}′N`, 6, y - 3);
    }
    const lonMin0 = Math.ceil(((this.course.origin.lon + tl.x / mLon) * 60) / every) * every;
    for (let m = lonMin0; (m / 60 - this.course.origin.lon) * mLon < br.x; m += every) {
      const x = w / 2 + ((m / 60 - this.course.origin.lon) * mLon - v.cx) * v.scale;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      const a = Math.abs(m);
      ctx.fillText(`${Math.floor(a / 60)}°${(a % 60).toFixed(every < 1 ? 1 : 0).padStart(every < 1 ? 4 : 2, '0')}′W`, x + 4, h - 6);
    }

    // Soundings: depth in metres at the time shown, tide included.
    const sound = Math.max(300, Math.round(92 / v.scale / 100) * 100);
    ctx.fillStyle = 'rgba(28, 43, 54, 0.42)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 10px ui-serif, Georgia, serif';
    const tide = world.tide(t, ahead ? 'forecast' : 'truth');
    for (let y = Math.ceil(br.y / sound) * sound; y < tl.y; y += sound) {
      for (let x = Math.ceil(tl.x / sound) * sound + ((Math.round(y / sound) & 1) ? sound / 2 : 0); x < br.x; x += sound) {
        const d = world.chartDepth(x, y);
        if (d <= 0 || d > 55) continue;
        const [sx, sy] = this.screen(w, h, v, x, y);
        ctx.fillText((d + tide).toFixed(d + tide < 10 ? 1 : 0), sx, sy);
      }
    }

    // Tidal stream arrows.
    const cs = Math.max(200, Math.round(52 / v.scale / 100) * 100);
    ctx.strokeStyle = STREAM;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (let y = Math.ceil(br.y / cs) * cs; y < tl.y; y += cs) {
      for (let x = Math.ceil(tl.x / cs) * cs; x < br.x; x += cs) {
        if (world.chartDepth(x, y) <= 0) continue;
        const c = world.current(x, y, t);
        const sp = Math.hypot(c.x, c.y);
        if (sp < 0.06) continue;
        const [sx, sy] = this.screen(w, h, v, x, y);
        const len = Math.min(34, 5 + (sp / KT) * 12);
        const set = Math.atan2(c.x, c.y);
        ctx.globalAlpha = Math.min(1, 0.35 + sp * 0.7);
        this.arrow(ctx, sx - Math.sin(set) * len / 2, sy + Math.cos(set) * len / 2, set, len, 4.5);
      }
    }
    ctx.globalAlpha = 1;

    // Wind arrows with speed, from the forecast when looking ahead.
    const ws = Math.max(800, Math.round(190 / v.scale / 200) * 200);
    ctx.strokeStyle = WIND;
    ctx.fillStyle = WIND;
    ctx.lineWidth = 2;
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    for (let y = Math.ceil(br.y / ws) * ws + ws / 2; y < tl.y; y += ws) {
      for (let x = Math.ceil(tl.x / ws) * ws + ws / 2; x < br.x; x += ws) {
        const wd = world.wind(x, y, t, ahead ? 'forecast' : 'truth');
        const [sx, sy] = this.screen(w, h, v, x, y);
        const toward = wd.dir + Math.PI;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 2.4;
        this.arrow(ctx, sx - Math.sin(toward) * 14, sy + Math.cos(toward) * 14, toward, 28, 8);
        // Speed in a small flag at the tail, where the wind comes from.
        const tx = sx - Math.sin(toward) * 26;
        const ty = sy + Math.cos(toward) * 26;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(tx, ty, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = WIND;
        ctx.textAlign = 'center';
        ctx.fillText((wd.speed / KT).toFixed(0), tx, ty + 0.5);
      }
    }
    ctx.globalAlpha = 1;

    // Named places and marks.
    for (const m of this.course.marks) {
      const [sx, sy] = this.screen(w, h, v, m.x, m.y);
      if (sx < -40 || sy < -20 || sx > w + 40 || sy > h + 20) continue;
      ctx.textBaseline = 'middle';
      if (m.kind === 'buoy') {
        ctx.fillStyle = MAGENTA;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 6); ctx.lineTo(sx + 5, sy); ctx.lineTo(sx, sy + 6); ctx.lineTo(sx - 5, sy);
        ctx.closePath();
        ctx.fill();
        ctx.textAlign = 'right';
        ctx.font = '600 10.5px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(m.name, sx - 9, sy);
      } else {
        ctx.fillStyle = m.kind === 'bridge' ? '#8f2f20' : 'rgba(28, 43, 54, 0.78)';
        ctx.textAlign = 'center';
        ctx.font = `${m.kind === 'point' ? 'italic 500 10.5px' : '600 11.5px'} ui-serif, Georgia, serif`;
        ctx.fillText(m.name, sx, sy + (m.kind === 'bridge' ? -12 : 0));
      }
    }

    this.drawRoute(ctx, w, h, v, true);
    this.drawTraffic(ctx, w, h, v, true);
    this.drawBoat(ctx, w, h, v, 11);

    // Scale bar.
    const barNm = [0.1, 0.25, 0.5, 1, 2].find((n) => n * NM * v.scale > 70) ?? 2;
    const barPx = barNm * NM * v.scale;
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(16, h - 30); ctx.lineTo(16, h - 24); ctx.lineTo(16 + barPx, h - 24); ctx.lineTo(16 + barPx, h - 30);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '600 10.5px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${barNm} nm`, 16 + barPx / 2, h - 36);

    // What moment the chart is showing.
    const label = ahead ? `Forecast for ${this.clock(t)}` : this.viewTime !== null && t < now - 1 ? `As it was at ${this.clock(t)}` : `Now ${this.clock(now)}`;
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = ahead ? 'rgba(176, 35, 122, 0.92)' : 'rgba(12, 22, 30, 0.82)';
    ctx.fillRect(w - tw - 28, 10, tw + 18, 24);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(label, w - tw - 19, 22.5);
    if (this.notice.ttl > 0) {
      const nw = ctx.measureText(this.notice.text).width;
      ctx.fillStyle = 'rgba(12, 22, 30, 0.85)';
      ctx.fillRect(w / 2 - nw / 2 - 10, 10, nw + 20, 24);
      ctx.fillStyle = '#fff';
      ctx.fillText(this.notice.text, w / 2 - nw / 2, 22.5);
    }
  }

  // ---- the forecast timeline ------------------------------------------------------------------

  private stripRange(): { left: number; width: number; t0: number; t1: number } {
    const w = this.strip.clientWidth;
    return { left: 64, width: w - 64 - 14, t0: 0, t1: this.host.world.seasonSeconds };
  }

  private drawStrip(): void {
    const { ctx, w, h } = this.size(this.strip);
    const world = this.host.world;
    const now = this.host.now();
    const r = this.stripRange();
    const b = this.host.boat();
    const gate = this.course.marks.find((m) => m.id === 'gate') ?? { x: 0, y: 0 };
    const X = (t: number) => r.left + ((t - r.t0) / (r.t1 - r.t0)) * r.width;
    ctx.fillStyle = '#0d1820';
    ctx.fillRect(0, 0, w, h);

    const lanes = [
      { label: 'Wind', y0: 20, y1: h * 0.4 },
      { label: 'Tide', y0: h * 0.4 + 6, y1: h * 0.68 },
      { label: 'Gate', y0: h * 0.68 + 6, y1: h - 6 },
    ];
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // Hours along the top, in local time.
    const startMs = world.dateAt(0).getTime();
    const firstHour = Math.ceil(startMs / 3600000) * 3600000;
    for (let ms = firstHour; (ms - startMs) / 1000 <= r.t1; ms += 3600000) {
      const t = (ms - startMs) / 1000;
      const x = X(t);
      const hour = Number(this.timeFmt.format(new Date(ms)).slice(0, 2));
      ctx.strokeStyle = hour === 0 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.09)';
      ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, h - 4); ctx.stroke();
      if (hour % 3 === 0) {
        ctx.fillStyle = 'rgba(238,243,244,0.65)';
        ctx.textAlign = 'center';
        ctx.fillText(hour === 0 ? this.dayFmt.format(new Date(ms)) : `${String(hour).padStart(2, '0')}:00`, x, 9);
      }
    }
    // Everything to the right of now is forecast.
    ctx.fillStyle = 'rgba(176, 35, 122, 0.10)';
    ctx.fillRect(X(now), 16, r.left + r.width - X(now), h - 20);

    const N = Math.max(60, Math.floor(r.width / 3));
    const series = (fn: (t: number, future: boolean) => number): number[] => {
      const out: number[] = [];
      for (let i = 0; i <= N; i++) {
        const t = r.t0 + ((r.t1 - r.t0) * i) / N;
        out.push(fn(t, t > now));
      }
      return out;
    };
    const wind = series((t, f) => world.wind(b.x, b.y, t, f ? 'forecast' : 'truth').speed / KT);
    const tide = series((t, f) => world.tide(t, f ? 'forecast' : 'truth'));
    const gateFlow = series((t) => {
      const c = world.current(gate.x, gate.y, t);
      return (c.x * Math.sin(FLOOD_AXIS) + c.y * Math.cos(FLOOD_AXIS)) / KT;
    });

    const lane = (i: number, data: number[], lo: number, hi: number, color: string, fill: string | null, zero: boolean) => {
      const L = lanes[i];
      const Y = (val: number) => L.y1 - ((val - lo) / (hi - lo)) * (L.y1 - L.y0);
      ctx.fillStyle = 'rgba(238,243,244,0.6)';
      ctx.textAlign = 'left';
      ctx.fillText(L.label, 8, (L.y0 + L.y1) / 2 - 6);
      if (zero) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.moveTo(r.left, Y(0)); ctx.lineTo(r.left + r.width, Y(0)); ctx.stroke();
      }
      ctx.beginPath();
      data.forEach((val, k) => {
        const x = r.left + (r.width * k) / N;
        if (k === 0) ctx.moveTo(x, Y(val));
        else ctx.lineTo(x, Y(val));
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (fill) {
        ctx.lineTo(r.left + r.width, Y(zero ? 0 : lo));
        ctx.lineTo(r.left, Y(zero ? 0 : lo));
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
      return Y;
    };
    const windMax = Math.max(18, ...wind) + 2;
    lane(0, wind, 0, windMax, '#e8edf0', 'rgba(232,237,240,0.10)', false);
    const tideLo = Math.min(...tide) - 0.1;
    const tideHi = Math.max(...tide) + 0.1;
    lane(1, tide, tideLo, tideHi, '#7fc4ee', 'rgba(127,196,238,0.16)', false);
    const flowMax = Math.max(1.5, ...gateFlow.map(Math.abs)) + 0.2;
    lane(2, gateFlow, -flowMax, flowMax, '#f2b866', 'rgba(242,184,102,0.16)', true);

    // Wind direction arrows every two hours.
    ctx.strokeStyle = '#e8edf0';
    ctx.lineWidth = 1.5;
    for (let t = 1800; t < r.t1; t += 7200) {
      const wd = world.wind(b.x, b.y, t, t > now ? 'forecast' : 'truth');
      const toward = wd.dir + Math.PI;
      const x = X(t);
      const y = lanes[0].y1 - 8;
      this.arrow(ctx, x - Math.sin(toward) * 6, y + Math.cos(toward) * 6, toward, 12, 4);
    }

    // Values at the time being looked at.
    const t = this.viewTime ?? now;
    const future = t > now;
    const wNow = world.wind(b.x, b.y, t, future ? 'forecast' : 'truth');
    const cNow = world.current(gate.x, gate.y, t);
    const flow = (cNow.x * Math.sin(FLOOD_AXIS) + cNow.y * Math.cos(FLOOD_AXIS)) / KT;
    const rate = world.tideRate(t, future ? 'forecast' : 'truth');
    ctx.fillStyle = '#e8edf0';
    ctx.textAlign = 'left';
    ctx.fillText(`${(wNow.speed / KT).toFixed(0)} kt ${pad3(wNow.dir)}°`, 8, (lanes[0].y0 + lanes[0].y1) / 2 + 7);
    ctx.fillStyle = '#7fc4ee';
    ctx.fillText(`${world.tide(t, future ? 'forecast' : 'truth').toFixed(2)} m ${Math.abs(rate) < 0.04 ? '–' : rate > 0 ? '↑' : '↓'}`, 8, (lanes[1].y0 + lanes[1].y1) / 2 + 7);
    ctx.fillStyle = '#f2b866';
    ctx.fillText(Math.abs(flow) < 0.15 ? 'slack' : `${Math.abs(flow).toFixed(1)} ${flow > 0 ? 'flood' : 'ebb'}`, 8, (lanes[2].y0 + lanes[2].y1) / 2 + 7);

    // Planned arrival at each mark.
    ctx.fillStyle = MAGENTA;
    for (const m of this.host.passage.marks) {
      const when = m.reachedAt ?? m.plannedEta;
      if (when === null) continue;
      const x = X(when);
      ctx.beginPath(); ctx.moveTo(x, 15); ctx.lineTo(x - 4, 21); ctx.lineTo(x, 27); ctx.lineTo(x + 4, 21); ctx.closePath();
      ctx.fill();
    }

    // Now, and the time being looked at.
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(X(now), 14); ctx.lineTo(X(now), h - 3); ctx.stroke();
    if (this.viewTime !== null) {
      ctx.strokeStyle = '#ffc46b';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(t), 14); ctx.lineTo(X(t), h - 3); ctx.stroke();
      ctx.fillStyle = '#ffc46b';
      ctx.textAlign = X(t) > w - 70 ? 'right' : 'left';
      ctx.fillText(this.clock(t), X(t) + (X(t) > w - 70 ? -5 : 5), h - 10);
    }
  }

  // ---- the passage plan -----------------------------------------------------------------------

  private drawSide(): void {
    const p = this.host.passage;
    const world = this.host.world;
    const now = this.host.now();
    const boat = this.host.boat();
    const st = p.status(boat, now);
    const rows = p.marks.map((m, i) => {
      const leg = m.leg;
      const done = m.reachedAt !== null;
      let actual = '';
      if (done && m.plannedEta !== null) {
        const late = m.reachedAt! - m.plannedEta;
        const cls = Math.abs(late) < 60 ? 'ok' : late > 0 ? 'late' : 'early';
        actual = `${this.clock(m.reachedAt!)} <span class="${cls}">${Math.abs(late) < 30 ? 'on time' : `${minutes(late)} ${late > 0 ? 'late' : 'early'}`}</span>`;
      } else if (i === st.nextIndex && st.etaNext !== null) {
        actual = `<span class="live">${this.clock(st.etaNext)}</span>`;
      }
      const stream = leg ? (Math.abs(leg.streamKt) < 0.1 ? 'slack' : `${Math.abs(leg.streamKt).toFixed(1)} ${leg.streamKt > 0 ? 'fair' : 'foul'}`) : '';
      return `<tr class="${done ? 'done' : i === st.nextIndex ? 'next' : ''}">
        <td>${i + 1}</td><td class="name">${m.name}</td>
        <td>${leg ? `${pad3(leg.bearing)}°` : ''}</td><td>${leg ? metresToNm(leg.distance).toFixed(2) : ''}</td>
        <td>${leg ? `${leg.twsKt.toFixed(0)} kt ${leg.sail}` : ''}</td><td>${stream}</td>
        <td>${leg ? leg.sogKt.toFixed(1) : ''}</td><td>${m.plannedEta !== null ? this.clock(m.plannedEta) : ''}</td><td>${actual}</td></tr>`;
    }).join('');

    let live = '<p class="quiet">No route yet. Click the water to drop a waypoint.</p>';
    if (st.next && st.fix) {
      const off = Math.abs(st.fix.crossTrack);
      const offText = off < 25 ? 'on the track' : `${off < 300 ? `${Math.round(off / 5) * 5} m` : `${metresToNm(off).toFixed(2)} nm`} to ${st.fix.crossTrack > 0 ? 'starboard' : 'port'} of track`;
      const pace = st.behind === null ? '' : Math.abs(st.behind) < 30 ? 'on plan' : `${minutes(st.behind)} ${st.behind > 0 ? 'behind plan' : 'ahead of plan'}`;
      live = `
        <div class="big"><span>Next</span><b>${st.next.name}</b></div>
        <div class="pair"><span>Bearing</span><b>${pad3(st.fix.bearing)}°</b><span>Distance</span><b>${metresToNm(st.fix.toGo).toFixed(2)} nm</b></div>
        <div class="pair"><span>Track</span><b>${offText}</b></div>
        <div class="pair"><span>Plan</span><b class="${st.behind !== null && st.behind > 60 ? 'late' : st.behind !== null && st.behind < -60 ? 'early' : ''}">${pace}</b>
          <span>ETA</span><b>${st.etaNext !== null ? this.clock(st.etaNext) : '—'}</b></div>`;
    } else if (p.marks.length) {
      live = '<p class="quiet">Route complete. Click the water to add another waypoint.</p>';
    }

    const plan = p.plan;
    const total = plan ? `<div class="pair"><span>To sail</span><b>${metresToNm(plan.distance).toFixed(1)} nm</b><span>Planned</span><b>${minutes(plan.seconds)}</b>
      <span>Finish</span><b>${this.clock(plan.startTime + plan.seconds)}</b></div>` : '';

    const t = this.viewTime ?? now;
    const future = t > now + 1;
    const w = world.wind(boat.x, boat.y, t, future ? 'forecast' : 'truth');
    const c = world.current(boat.x, boat.y, t);
    const drift = Math.hypot(c.x, c.y) / KT;
    const rate = world.tideRate(t, future ? 'forecast' : 'truth');
    const depth = world.chartDepth(boat.x, boat.y);
    const issued = new Date(this.course.forecast.issued);
    // The nearest few vessels, as an AIS list: range, bearing and how close they will pass.
    let traffic = '';
    const vessels = this.host.traffic?.();
    if (vessels && vessels.length) {
      const near = vessels.map((v) => ({ v, a: approach(boat, v) })).sort((p, q) => p.a.range - q.a.range).slice(0, 3);
      const trs = near.map(({ v, a }) => {
        const danger = a.cpa < CLOSE_QUARTERS + v.length / 2 && a.range < 3000;
        const cpa = a.cpa < 1000 ? `${Math.round(a.cpa / 10) * 10} m` : `${metresToNm(a.cpa).toFixed(1)} nm`;
        // A target already past its closest point is opening: nothing to wait for.
        const when = a.tcpa < 20 ? (danger ? 'now' : 'opening') : a.tcpa >= 599 ? '10+ min' : `${Math.max(1, Math.round(a.tcpa / 60))} min`;
        return `<tr class="${danger ? 'next' : ''}"><td class="name">${v.name}</td><td>${metresToNm(a.range).toFixed(2)} nm</td><td>${pad3(a.bearing)}°</td>
          <td>${(v.sog / KT).toFixed(0)} kt</td><td class="${danger ? 'late' : ''}">${cpa}</td><td>${when}</td></tr>`;
      }).join('');
      traffic = `<section class="traffic"><h3>Traffic</h3></section>
        <table><thead><tr><th class="name">Vessel</th><th>Range</th><th>Bearing</th><th>Speed</th><th>Closest</th><th>In</th></tr></thead><tbody>${trs}</tbody></table>`;
    }
    this.side.innerHTML = `
      <header><h2>Passage plan</h2><span class="key">M or Esc closes</span></header>
      <section class="live">${live}${total}</section>
      <table>
        <thead><tr><th></th><th class="name">Mark</th><th>Course</th><th>nm</th><th>Wind</th><th>Tide</th><th>SOG</th><th>Plan</th><th>Actual</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <section class="wx">
        <h3>${future ? `Forecast for ${this.clock(t)}` : `Conditions at ${this.clock(t)}`}, at the boat</h3>
        <div class="pair"><span>Wind</span><b>${(w.speed / KT).toFixed(0)} kt from ${pad3(w.dir)}°</b></div>
        <div class="pair"><span>Stream</span><b>${drift < 0.1 ? 'slack' : `${drift.toFixed(1)} kt setting ${pad3(Math.atan2(c.x, c.y))}°`}</b></div>
        <div class="pair"><span>Tide</span><b>${world.tide(t, future ? 'forecast' : 'truth').toFixed(2)} m, ${Math.abs(rate) < 0.04 ? 'standing' : rate > 0 ? 'rising' : 'falling'}</b>
          <span>Depth</span><b>${depth > 0 ? `${(depth + world.tide(t)).toFixed(0)} m` : '—'}</b></div>
      </section>
      ${traffic}
      <p class="hint">Click water to add a waypoint. Drag one to move it, double-click to remove it. Drag the timeline to look ahead, double-click it to come back to now. Plan times use the boat's polar with the forecast wind and tidal stream.</p>
      <p class="source">Wind, stream and tide: NOAA SFBOFS, replayed from ${this.dayFmt.format(world.dateAt(0))} 2024. Forecast issued ${this.timeFmt.format(issued)} ${this.dayFmt.format(issued)}. Depths and coast from open elevation data. Not for navigation.</p>`;
  }
}
