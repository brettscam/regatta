import { compassPoint, degMin, rhumb, type Projection } from '@slack-tide/nav';
import type { CourseData } from '@slack-tide/world';

const NM = 1852;
const R2D = 180 / Math.PI;

// The chart as she had it: the land, the lines of latitude and longitude, and what the navigator has pencilled on.
// No boat symbol where she truly is, no wind, no stream, no other vessels. The pencilled line is her reckoning,
// carried forward from the courses steered and the speeds judged. Regatta's chartplotter (`ui/chart.ts`) is built
// round a route, a forecast and other vessels, none of which exist here, so this is a chart of its own.

const PAPER = '#efe7d2';
const INK = '#2a2620';
const LAND = '#d9c9a0';
const GRID = 'rgba(42, 38, 32, 0.28)';
const PENCIL = '#3c3a36';
const TRUTH = '#b3261e';

export interface TrackPoint {
  x: number;
  y: number;
  /** Seconds since she cast off. */
  t: number;
}

export interface BareChartHost {
  course: CourseData;
  projection: Projection;
  /** Names to letter on the chart, in flat metres. */
  names: Array<{ name: string; x: number; y: number; small?: boolean }>;
  /** Rocks and reefs to mark. */
  dangers: Array<{ x: number; y: number }>;
  from: { name: string; x: number; y: number };
  to: { name: string; x: number; y: number };
  /** The reckoning: its track so far, the last point being where she is thought to be now. */
  reckoned(): TrackPoint[];
  /** Where she really has been. Drawn only with the debug switch. */
  truth(): TrackPoint[];
  showTruth: boolean;
  /** Lines for the side of the chart: the day, the course ordered. */
  notes(): Array<[string, string]>;
}

interface View {
  cx: number;
  cy: number;
  /** Pixels per metre. */
  scale: number;
}

export class BareChart {
  private readonly mini = document.getElementById('mini') as HTMLCanvasElement;
  private readonly overlay = document.getElementById('chart') as HTMLElement;
  private readonly map: HTMLCanvasElement;
  private readonly side: HTMLElement;
  private readonly coast = new Path2D();
  private readonly view: View = { cx: 0, cy: 0, scale: 0.0005 };
  private readonly listeners = new AbortController();
  private open = false;
  private clock = 0;
  private miniClock = 0;
  private drag: { x: number; y: number } | null = null;

  constructor(private readonly host: BareChartHost) {
    this.overlay.innerHTML = `
      <div class="chart-frame bare">
        <canvas class="chart-map" aria-label="Chart of the passage, with the reckoned track"></canvas>
        <aside class="chart-side"></aside>
      </div>`;
    this.map = this.overlay.querySelector('.chart-map') as HTMLCanvasElement;
    this.side = this.overlay.querySelector('.chart-side') as HTMLElement;
    for (const ring of host.course.coast) {
      this.coast.moveTo(ring[0], -ring[1]);
      for (let i = 2; i < ring.length; i += 2) this.coast.lineTo(ring[i], -ring[i + 1]);
      this.coast.closePath();
    }
    this.mini.hidden = false;
    const signal = this.listeners.signal;
    this.mini.addEventListener('click', () => this.toggle(true), { signal });
    this.overlay.addEventListener('pointerdown', (e) => { if (e.target === this.overlay) this.toggle(false); }, { signal });
    this.map.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      this.map.setPointerCapture(e.pointerId);
    }, { signal });
    this.map.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.view.cx -= (e.clientX - this.drag.x) / this.view.scale;
      this.view.cy += (e.clientY - this.drag.y) / this.view.scale;
      this.drag = { x: e.clientX, y: e.clientY };
      this.clock = 0;
    }, { signal });
    const up = () => { this.drag = null; };
    this.map.addEventListener('pointerup', up, { signal });
    this.map.addEventListener('pointercancel', up, { signal });
    this.map.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.map.getBoundingClientRect();
      const px = e.clientX - r.left - r.width / 2;
      const py = e.clientY - r.top - r.height / 2;
      const before = { x: this.view.cx + px / this.view.scale, y: this.view.cy - py / this.view.scale };
      this.view.scale = Math.max(0.0003, Math.min(0.05, this.view.scale * Math.exp(-e.deltaY * 0.0015)));
      this.view.cx = before.x - px / this.view.scale;
      this.view.cy = before.y + py / this.view.scale;
      this.clock = 0;
    }, { signal, passive: false });
  }

  dispose(): void {
    this.listeners.abort();
    this.overlay.hidden = true;
    this.overlay.innerHTML = '';
    this.mini.hidden = true;
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.overlay.hidden = !this.open;
    if (this.open) {
      this.frameAll();
      this.clock = 0;
    }
  }

  setMiniHidden(hidden: boolean): void {
    this.mini.hidden = hidden;
  }

  /** Fit the whole passage: the departure, the landfall and the reckoning between. */
  private frameAll(): void {
    const { from, to } = this.host;
    const track = this.host.reckoned();
    const here = track[track.length - 1] ?? from;
    const xs = [from.x, to.x, here.x];
    const ys = [from.y, to.y, here.y];
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const r = this.map.getBoundingClientRect();
    this.view.cx = (x0 + x1) / 2;
    this.view.cy = (y0 + y1) / 2;
    this.view.scale = Math.min((r.width || 800) / ((x1 - x0) * 1.35 + 1), (r.height || 600) / ((y1 - y0) * 1.5 + 1));
  }

  update(dt: number): void {
    this.miniClock -= dt;
    if (!this.mini.hidden && this.miniClock <= 0) {
      this.miniClock = 0.7;
      const b = this.host.course.bounds;
      const w = this.mini.clientWidth || 236;
      const h = this.mini.clientHeight || 196;
      const scale = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0)) * 1.25;
      const track = this.host.reckoned();
      const here = track[track.length - 1] ?? this.host.from;
      // The corner chart keeps the reckoned position and the landfall both in view.
      const cx = (here.x + this.host.to.x) / 2;
      const cy = (here.y + this.host.to.y) / 2;
      const fit = Math.min(w / (Math.abs(here.x - this.host.to.x) * 1.5 + 200000), h / (Math.abs(here.y - this.host.to.y) * 1.6 + 200000));
      this.draw(this.mini, { cx, cy, scale: Math.max(scale, fit) }, true);
    }
    if (!this.open) return;
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = 0.4;
    this.draw(this.map, this.view, false);
    this.drawSide();
  }

  private draw(canvas: HTMLCanvasElement, view: View, small: boolean): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d')!;
    const { host } = this;
    const proj = host.projection;
    const X = (x: number) => w / 2 + (x - view.cx) * view.scale;
    const Y = (y: number) => h / 2 - (y - view.cy) * view.scale;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, w, h);

    // The graticule: every degree of latitude and every two of longitude, closer when the chart is drawn large.
    const topLeft = proj.toLatLon(view.cx - w / 2 / view.scale, view.cy + h / 2 / view.scale);
    const bottomRight = proj.toLatLon(view.cx + w / 2 / view.scale, view.cy - h / 2 / view.scale);
    const fine = view.scale > 0.004;
    const latStep = small ? 2 : fine ? 1 / 6 : 1;
    const lonStep = small ? 4 : fine ? 1 / 3 : 2;
    g.strokeStyle = GRID;
    g.lineWidth = 1;
    g.fillStyle = INK;
    g.font = `${small ? 9 : 11}px ui-serif, Georgia, "Times New Roman", serif`;
    g.textBaseline = 'middle';
    for (let lat = Math.ceil(bottomRight.lat / latStep) * latStep; lat <= topLeft.lat; lat += latStep) {
      const y = Math.round(Y(proj.toXY(lat, proj.lon0).y)) + 0.5;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.textAlign = 'left';
      if (!small || Math.abs(lat % 4) < 1e-6) g.fillText(degMin(lat, 'lat').replace(" 00'", ''), 5, y - 7);
    }
    for (let lon = Math.ceil(topLeft.lon / lonStep) * lonStep; lon <= bottomRight.lon; lon += lonStep) {
      const x = Math.round(X(proj.toXY(proj.lat0, lon).x)) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.textAlign = 'center';
      if (!small) g.fillText(degMin(lon, 'lon').replace(" 00'", ''), x, h - 9);
    }

    // The land.
    g.save();
    g.translate(w / 2 - view.cx * view.scale, h / 2 + view.cy * view.scale);
    g.scale(view.scale, view.scale);
    g.fillStyle = LAND;
    g.fill(this.coast);
    g.strokeStyle = INK;
    g.lineWidth = (small ? 1 : 1.2) / view.scale;
    g.stroke(this.coast);
    g.restore();
    // Small islands would vanish at this scale: mark each with a dot so the chart still shows it is there.
    for (const ring of host.course.coast) {
      let x0 = Infinity; let x1 = -Infinity; let sx = 0; let sy = 0;
      for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); sx += ring[i]; sy += ring[i + 1]; }
      if ((x1 - x0) * view.scale < 3) {
        g.fillStyle = INK;
        g.beginPath();
        g.arc(X(sx / (ring.length / 2)), Y(sy / (ring.length / 2)), small ? 1.2 : 1.8, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.strokeStyle = INK;
    g.lineWidth = 1;
    if (!small) {
      for (const d of host.dangers) {
        const x = X(d.x);
        const y = Y(d.y);
        g.beginPath();
        g.moveTo(x - 4, y); g.lineTo(x + 4, y); g.moveTo(x, y - 4); g.lineTo(x, y + 4);
        g.stroke();
      }
      g.fillStyle = INK;
      g.textAlign = 'left';
      for (const n of host.names) {
        if (n.small && view.scale < 0.0012) continue;
        g.font = `italic ${n.small ? 11 : 13}px ui-serif, Georgia, "Times New Roman", serif`;
        g.fillText(n.name, X(n.x) + 8, Y(n.y));
      }
    }

    const line = (pts: TrackPoint[], colour: string, width: number, dash: number[]) => {
      if (pts.length < 2) return;
      g.strokeStyle = colour;
      g.lineWidth = width;
      g.setLineDash(dash);
      g.beginPath();
      g.moveTo(X(pts[0].x), Y(pts[0].y));
      for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i].x), Y(pts[i].y));
      g.stroke();
      g.setLineDash([]);
    };
    const reckoned = host.reckoned();
    if (host.showTruth) {
      const truth = host.truth();
      line(truth, TRUTH, small ? 1.2 : 1.6, []);
      const at = truth[truth.length - 1];
      if (at) {
        g.fillStyle = TRUTH;
        g.beginPath();
        g.arc(X(at.x), Y(at.y), small ? 2.5 : 4, 0, Math.PI * 2);
        g.fill();
      }
    }
    line(reckoned, PENCIL, small ? 1.2 : 1.5, [5, 3]);
    // A tick across the track at each noon, the way a day's run is marked off.
    if (!small) {
      g.strokeStyle = PENCIL;
      g.fillStyle = PENCIL;
      g.font = '10px ui-serif, Georgia, serif';
      g.textAlign = 'left';
      let lastDay = -1;
      for (const p of reckoned) {
        const day = Math.floor((p.t + this.noonOffset) / 86400);
        if (day !== lastDay && lastDay >= 0) {
          g.beginPath();
          g.arc(X(p.x), Y(p.y), 2.2, 0, Math.PI * 2);
          g.fill();
        }
        lastDay = day;
      }
    }
    // Where she is reckoned to be: a cross in a half circle, the mark for a position by account.
    const dr = reckoned[reckoned.length - 1];
    if (dr) {
      const x = X(dr.x);
      const y = Y(dr.y);
      const r = small ? 4 : 7;
      g.strokeStyle = INK;
      g.lineWidth = small ? 1.3 : 1.6;
      g.beginPath();
      g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r);
      g.stroke();
      g.beginPath();
      g.arc(x, y, r + 2, Math.PI, 0);
      g.stroke();
      if (!small) {
        g.fillStyle = INK;
        g.font = 'italic 12px ui-serif, Georgia, serif';
        g.textAlign = 'left';
        g.fillText('by account', x + r + 6, y - r - 4);
      }
    }
    // The landfall.
    g.strokeStyle = INK;
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(X(host.to.x), Y(host.to.y), small ? 3 : 5, 0, Math.PI * 2);
    g.stroke();
  }

  /** Seconds to add to time since cast off so that a whole number of days falls at noon. Set by the session. */
  noonOffset = 0;

  private drawSide(): void {
    const { host } = this;
    const track = host.reckoned();
    const dr = track[track.length - 1] ?? host.from;
    const at = host.projection.toLatLon(dr.x, dr.y);
    const leg = rhumb(host.projection, dr, host.to);
    const deg3 = (rad: number) => String(Math.round(((rad * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');
    let html = `<header><h2>Chart</h2><span class="key">M closes</span></header>
      <section><h3>Position by account</h3>
        <div class="big"><span>Lat</span><b>${degMin(at.lat, 'lat')}</b></div>
        <div class="big"><span>Long</span><b>${degMin(at.lon, 'lon')}</b></div>
        <p class="quiet">Carried on from ${host.from.name} by the courses steered and the speed judged. No sight has been had.</p>
      </section>
      <section><h3>${host.to.name}</h3>
        <div class="big"><span>Bears</span><b>${deg3(leg.course)}° ${compassPoint(leg.course)}</b></div>
        <div class="big"><span>Distant</span><b>${Math.round(leg.metres / NM)} miles</b></div>
      </section>
      <section>${host.notes().map(([k, v]) => `<div class="big"><span>${k}</span><b style="font-size:14px">${v}</b></div>`).join('')}</section>`;
    if (host.showTruth) {
      const truth = host.truth();
      const real = truth[truth.length - 1];
      if (real) {
        const ll = host.projection.toLatLon(real.x, real.y);
        const out = rhumb(host.projection, dr, real);
        html += `<section><h3 style="color:${TRUTH}">Truth (debug switch)</h3>
          <div class="big"><span>Lat</span><b>${degMin(ll.lat, 'lat')}</b></div>
          <div class="big"><span>Long</span><b>${degMin(ll.lon, 'lon')}</b></div>
          <p class="quiet">She is ${Math.round(out.metres / NM)} miles ${compassPoint(out.course)} of her reckoning.</p></section>`;
      }
    }
    html += '<p class="hint">Drag to move the chart, scroll to draw it larger. The broken line is the reckoning; a dot marks each noon.</p>';
    if (this.side.dataset.html !== html) {
      this.side.innerHTML = html;
      this.side.dataset.html = html;
    }
  }
}
