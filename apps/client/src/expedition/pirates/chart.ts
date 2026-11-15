import { compassPoint, degMin, type Projection } from '@slack-tide/nav';
import type { CourseData } from '@slack-tide/world';
import type { Reef } from '../sea';
import type { PortPlace } from './caribbean';
import type { Nation } from './tables';

const NM = 1852;
const R2D = 180 / Math.PI;

// The rover's chart. The same paper as the Caird's bare chart (`../bareChart.ts`), but a man who has worked these
// waters knows where he is: the sloop is drawn where she lies, with the ports, the reefs he knows of, the lane a
// rumour spoke of, and the sails in sight. It shows nothing over the horizon.
//
// SEAM, more of the Caribbean: the chart draws whatever coast, ports and reefs the sea has. A bigger sea is a bigger chart.
// SEAM, treasure hunts: a mark from an artifact chart would be one more thing in `marks()`.

const PAPER = '#efe7d2';
const INK = '#2a2620';
const LAND = '#d9c9a0';
const GRID = 'rgba(42, 38, 32, 0.22)';
const SHOAL = 'rgba(70, 150, 150, 0.35)';
const RED = '#a3261e';
const FLAG: Record<Nation, string> = { english: '#a3201c', spanish: '#c9a227', french: '#27407a', dutch: '#d2691e', pirate: '#121212' };

export interface ChartSail { x: number; y: number; heading: number; nation: Nation | null; label: string; chosen: boolean }

export interface PirateChartHost {
  course: CourseData;
  projection: Projection;
  names: Array<{ name: string; x: number; y: number; small?: boolean }>;
  ports: PortPlace[];
  reefs: Reef[];
  /** Where she is, how she heads, and where she has been. */
  ship(): { x: number; y: number; heading: number };
  track(): Array<{ x: number; y: number }>;
  sails(): ChartSail[];
  /** The lane a rumour spoke of. */
  rumour(): { path: Array<{ x: number; y: number }>; text: string } | null;
  shut(port: PortPlace): boolean;
  notes(): Array<[string, string]>;
}

interface View { cx: number; cy: number; scale: number }

export class PirateChart {
  private readonly mini = document.getElementById('mini') as HTMLCanvasElement;
  private readonly overlay = document.getElementById('chart') as HTMLElement;
  private readonly map: HTMLCanvasElement;
  private readonly side: HTMLElement;
  private readonly coast = new Path2D();
  private readonly view: View = { cx: 0, cy: 0, scale: 0.001 };
  private readonly listeners = new AbortController();
  private open = false;
  private clock = 0;
  private miniClock = 0;
  private drag: { x: number; y: number } | null = null;

  constructor(private readonly host: PirateChartHost) {
    this.overlay.innerHTML = `
      <div class="chart-frame bare">
        <canvas class="chart-map" aria-label="Chart of the Greater Antilles, with the sloop's position"></canvas>
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
      this.view.scale = Math.max(0.0005, Math.min(0.08, this.view.scale * Math.exp(-e.deltaY * 0.0015)));
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
      // The whole sea, as a chart is first unrolled.
      const b = this.host.course.bounds;
      const r = this.map.getBoundingClientRect();
      this.view.cx = (b.x0 + b.x1) / 2;
      this.view.cy = (b.y0 + b.y1) / 2;
      this.view.scale = Math.min((r.width || 900) / (b.x1 - b.x0), (r.height || 600) / (b.y1 - b.y0)) * 0.98;
      this.clock = 0;
    }
  }

  setMiniHidden(hidden: boolean): void {
    this.mini.hidden = hidden;
  }

  update(dt: number): void {
    this.miniClock -= dt;
    if (!this.mini.hidden && this.miniClock <= 0) {
      this.miniClock = 0.7;
      const at = this.host.ship();
      // The corner chart: forty miles round the sloop.
      const w = this.mini.clientWidth || 236;
      this.draw(this.mini, { cx: at.x, cy: at.y, scale: w / 150000 }, true);
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
    const serif = 'ui-serif, Georgia, "Times New Roman", serif';

    // The graticule, every degree.
    const topLeft = proj.toLatLon(view.cx - w / 2 / view.scale, view.cy + h / 2 / view.scale);
    const bottomRight = proj.toLatLon(view.cx + w / 2 / view.scale, view.cy - h / 2 / view.scale);
    const step = view.scale > 0.006 ? 0.25 : 1;
    g.strokeStyle = GRID;
    g.lineWidth = 1;
    g.fillStyle = INK;
    g.font = `${small ? 9 : 11}px ${serif}`;
    g.textBaseline = 'middle';
    for (let lat = Math.ceil(bottomRight.lat / step) * step; lat <= topLeft.lat; lat += step) {
      const y = Math.round(Y(proj.toXY(lat, proj.lon0).y)) + 0.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      g.textAlign = 'left';
      if (!small) g.fillText(degMin(lat, 'lat').replace(" 00'", ''), 5, y - 7);
    }
    for (let lon = Math.ceil(topLeft.lon / step) * step; lon <= bottomRight.lon; lon += step) {
      const x = Math.round(X(proj.toXY(proj.lat0, lon).x)) + 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.textAlign = 'center';
      if (!small) g.fillText(degMin(lon, 'lon').replace(" 00'", ''), x, h - 9);
    }

    // Reefs and banks: stippled shoal, with the crosses a chart marks rocks awash by.
    for (const reef of host.reefs) {
      const x = X(reef.x);
      const y = Y(reef.y);
      const r = Math.max(3, reef.radius * view.scale);
      if (x < -r || y < -r || x > w + r || y > h + r) continue;
      g.fillStyle = SHOAL;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      for (let k = 0; k < 3; k++) {
        const cx = x + Math.cos(k * 2.1 + reef.x) * r * 0.45;
        const cy = y + Math.sin(k * 2.1 + reef.x) * r * 0.45;
        g.beginPath(); g.moveTo(cx - 3, cy); g.lineTo(cx + 3, cy); g.moveTo(cx, cy - 3); g.lineTo(cx, cy + 3); g.stroke();
      }
      if (!small && view.scale > 0.0012) {
        g.fillStyle = INK;
        g.font = `italic 10px ${serif}`;
        g.textAlign = 'center';
        g.fillText(reef.name, x, y + r + 8);
      }
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
    if (!small) {
      g.fillStyle = INK;
      g.textAlign = 'center';
      for (const n of host.names) {
        if (n.small && view.scale < 0.002) continue;
        g.font = `italic ${n.small ? 11 : 15}px ${serif}`;
        g.fillText(n.small ? n.name : n.name.toUpperCase(), X(n.x), Y(n.y));
      }
    }

    // The lane a rumour spoke of.
    const rumour = host.rumour();
    if (rumour && rumour.path.length > 1) {
      g.strokeStyle = RED;
      g.lineWidth = small ? 1.2 : 1.8;
      g.setLineDash([7, 5]);
      g.beginPath();
      g.moveTo(X(rumour.path[0].x), Y(rumour.path[0].y));
      for (const p of rumour.path.slice(1)) g.lineTo(X(p.x), Y(p.y));
      g.stroke();
      g.setLineDash([]);
    }

    // Ports: an anchor ring, the name, the colours they fly. Barred when shut to her.
    for (const port of host.ports) {
      const x = X(port.x);
      const y = Y(port.y);
      g.fillStyle = FLAG[port.nation];
      g.strokeStyle = INK;
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, y, small ? 3 : 5, 0, Math.PI * 2); g.fill(); g.stroke();
      if (host.shut(port)) {
        g.strokeStyle = RED;
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - 7, y - 7); g.lineTo(x + 7, y + 7); g.moveTo(x + 7, y - 7); g.lineTo(x - 7, y + 7); g.stroke();
      }
      g.fillStyle = INK;
      g.font = `${small ? 10 : 13}px ${serif}`;
      g.textAlign = 'left';
      g.fillText(port.name, x + (small ? 6 : 9), y - (small ? 6 : 8));
    }

    // Where she has been, and where she is.
    const track = host.track();
    if (track.length > 1) {
      g.strokeStyle = 'rgba(42, 38, 32, 0.55)';
      g.lineWidth = small ? 1 : 1.3;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(X(track[0].x), Y(track[0].y));
      for (const p of track.slice(1)) g.lineTo(X(p.x), Y(p.y));
      g.stroke();
      g.setLineDash([]);
    }
    const hull = (x: number, y: number, heading: number, size: number, fill: string) => {
      g.save();
      g.translate(x, y);
      g.rotate(heading);
      g.fillStyle = fill;
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, -size); g.quadraticCurveTo(size * 0.6, -size * 0.2, size * 0.45, size * 0.8); g.lineTo(-size * 0.45, size * 0.8); g.quadraticCurveTo(-size * 0.6, -size * 0.2, 0, -size);
      g.fill(); g.stroke();
      g.restore();
    };
    for (const s of host.sails()) {
      const x = X(s.x);
      const y = Y(s.y);
      hull(x, y, s.heading, small ? 5 : 7, s.nation ? FLAG[s.nation] : '#8a8474');
      if (s.chosen) {
        g.strokeStyle = RED;
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, small ? 9 : 12, 0, Math.PI * 2); g.stroke();
      }
      if (!small) {
        g.fillStyle = INK;
        g.font = `italic 11px ${serif}`;
        g.textAlign = 'left';
        g.fillText(s.label, x + 11, y + 4);
      }
    }
    const at = host.ship();
    hull(X(at.x), Y(at.y), at.heading, small ? 7 : 9, '#121212');
  }

  private drawSide(): void {
    const { host } = this;
    const at = host.ship();
    const ll = host.projection.toLatLon(at.x, at.y);
    const deg3 = (rad: number) => String(Math.round(((rad * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');
    const ports = host.ports.map((p) => {
      const b = (Math.atan2(p.x - at.x, p.y - at.y) + Math.PI * 2) % (Math.PI * 2);
      const miles = Math.hypot(p.x - at.x, p.y - at.y) / NM;
      return `<div class="big"><span>${p.name}${host.shut(p) ? ' · <i style="color:' + RED + '">shut</i>' : ''}</span><b style="font-size:14px">${deg3(b)}° ${compassPoint(b)} · ${Math.round(miles)} mi</b></div>`;
    }).join('');
    const rumour = host.rumour();
    const html = `<header><h2>Chart</h2><span class="key">M closes</span></header>
      <section><h3>The sloop</h3>
        <div class="big"><span>Lat</span><b>${degMin(ll.lat, 'lat')}</b></div>
        <div class="big"><span>Long</span><b>${degMin(ll.lon, 'lon')}</b></div>
      </section>
      <section><h3>Ports</h3>${ports}</section>
      <section>${host.notes().map(([k, v]) => `<div class="big"><span>${k}</span><b style="font-size:14px">${v}</b></div>`).join('')}</section>
      ${rumour ? `<section><h3 style="color:${RED}">Tavern talk</h3><p class="quiet">${rumour.text}</p></section>` : ''}
      <p class="hint">Drag to move the chart, scroll to draw it larger. Stippled rings are reefs and banks. The broken red line is the lane the talk was of. Sails are shown only while they are in sight.</p>`;
    if (this.side.dataset.html !== html) {
      this.side.innerHTML = html;
      this.side.dataset.html = html;
    }
  }
}
