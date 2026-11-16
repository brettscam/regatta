import * as THREE from 'three';
import { shortRange } from '../race/startline';
import type { AboardContext, Feature } from './feature';
import { visited } from './visited';

/** A place's name shows once she is within this of it, metres. */
export const LABEL_RANGE = 1200;
/** No more than this many names on the screen at once: the nearest. */
const MAX = 3;

/** The words on a place's label: a mark for whether the crew has been ashore there yet, its name, and how far. */
export function placeLabel(name: string, metres: number, been: boolean): string {
  return `${been ? '✓' : '○'} ${name} · ${shortRange(metres)}`;
}

/** The nearest few of the spots within range, nearest first. Writes into `out` and returns how many. */
export function nearest<T extends { x: number; y: number }>(spots: readonly T[], x: number, y: number, range: number, out: Array<{ spot: T; d: number }>): number {
  let n = 0;
  for (const spot of spots) {
    const d = Math.hypot(spot.x - x, spot.y - y);
    if (d > range) continue;
    // Insert in order, keeping only as many as `out` holds.
    let k = Math.min(n, out.length - 1);
    if (n === out.length && d >= out[k].d) continue;
    while (k > 0 && out[k - 1].d > d) {
      out[k].spot = out[k - 1].spot;
      out[k].d = out[k - 1].d;
      k--;
    }
    out[k].spot = spot;
    out[k].d = d;
    if (n < out.length) n++;
  }
  return n;
}

/**
 * A name over each place ashore as she comes within three quarters of a mile of it: the venue on the shore
 * (`scene/shoreside.ts`), how far off it is, and a mark for whether the crew has been ashore there. A ring is a
 * place still to visit, a tick one already stamped on the bar-hop card. It takes no keys. H hides the names with
 * the rest of the instruments.
 */
export class Landmarks implements Feature {
  readonly id = 'landmarks';
  private readonly labels: HTMLDivElement[] = [];
  private readonly text: string[] = [];
  private readonly near: Array<{ spot: { id: string; x: number; y: number; top: number }; d: number }> = [];
  private count = 0;
  private think = 0;
  private been = visited();
  private readonly names = new Map<string, string>();
  private readonly pos = new THREE.Vector3();

  constructor(private readonly ctx: AboardContext) {
    for (let i = 0; i < MAX; i++) {
      const el = document.createElement('div');
      el.className = 'boat-label place-label';
      el.style.display = 'none';
      document.body.appendChild(el);
      this.labels.push(el);
      this.text.push('');
      this.near.push({ spot: { id: '', x: 0, y: 0, top: 0 }, d: 0 });
    }
    for (const p of ctx.places) this.names.set(p.id, p.name);
  }

  update(dt: number): void {
    const { ctx } = this;
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.3;
      // From wherever the player is: at the wheel, or away in the kayak.
      const away = ctx.feature<Feature>('kayak')?.focus?.() ?? null;
      const x = away ? away.x : ctx.sim.state.x;
      const y = away ? away.y : ctx.sim.state.y;
      this.count = ctx.hud.readoutHidden ? 0 : nearest(ctx.stage.shore, x, y, LABEL_RANGE, this.near);
      if (this.count) this.been = visited();
      for (let i = 0; i < MAX; i++) {
        if (i >= this.count) continue;
        const { spot, d } = this.near[i];
        const been = this.been.has(spot.id);
        const text = placeLabel(this.names.get(spot.id) ?? '', d, been);
        if (text !== this.text[i]) {
          this.text[i] = text;
          this.labels[i].textContent = text;
          this.labels[i].classList.toggle('new', !been);
        }
      }
    }
    const camera = ctx.drone.camera;
    for (let i = 0; i < MAX; i++) {
      const el = this.labels[i];
      let show = i < this.count;
      if (show) {
        const spot = this.near[i].spot;
        this.pos.set(spot.x, spot.top + 2.5, -spot.y).project(camera);
        show = this.pos.z < 1 && Math.abs(this.pos.x) < 1.05 && Math.abs(this.pos.y) < 1.05;
        if (show) el.style.transform = `translate(-50%, -100%) translate(${Math.round(((this.pos.x + 1) / 2) * window.innerWidth)}px, ${Math.round(((1 - this.pos.y) / 2) * window.innerHeight)}px)`;
      }
      const display = show ? 'block' : 'none';
      if (el.style.display !== display) el.style.display = display;
    }
  }

  dispose(): void {
    for (const el of this.labels) el.remove();
  }
}
