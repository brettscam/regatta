import * as THREE from 'three';
import { Track, type TrafficSpec } from './traffic';
import { waveHeight, type Wave } from './waves';
import { WAKE, emptyHit, findPassings, wakeAt, type Passing, type TrackState, type WakeHit, type WakeSource } from './wakeField';

interface Lane {
  track: Track;
  name: string;
  beam: number;
  passings: Passing[];
}

/** A wake that matters at the point being followed just now. `x`, `y` are where a ship on a straight course would be. */
export interface ActiveWake extends WakeSource {
  /** The vessel's id in the traffic file, and the season time she passes closest: together they name one passing. */
  id: string;
  passedAt: number;
  px: number;
  py: number;
}

const MAX_WAKES = 4;
const CRESTS = 7;
const SEGS = 14;

/**
 * The wakes of the water's ferries and ships, for whoever is being followed (the yacht, or the kayak when the player
 * is away in her). The rules are in `wakeField.ts`. Here they are put to the traffic's own tracks, which are pure
 * functions of season time, so every player gets the same wake at the same moment.
 *
 * `refresh` finds who has passed or is about to (a few times a second is plenty), `advance` moves the wakes on to
 * a moment, `height` is the water they add at a point, and `strongest` is what is passing a point now.
 * A thin line along each crest is drawn so the waves can be seen coming. Proper drawing belongs to the ocean.
 */
export class WakeField {
  readonly active: ActiveWake[] = [];
  /** Crest lines. In world coordinates: add it to the scene as it is. */
  readonly lines: THREE.LineSegments;
  private readonly lanes: Lane[] = [];
  private readonly hit = emptyHit();
  private readonly best = emptyHit();
  private readonly position: THREE.BufferAttribute;
  private readonly colour: THREE.BufferAttribute;
  private focusX = 0;
  private focusY = 0;

  constructor(spec: TrafficSpec) {
    // Yachts throw nothing worth the name.
    for (const r of spec.routes) if (r.kind !== 'sail') this.lanes.push({ track: new Track(r, spec.referenceHours * 3600), name: r.name, beam: r.beam, passings: [] });
    const n = MAX_WAKES * CRESTS * SEGS * 2;
    const g = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.colour = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    g.setAttribute('position', this.position);
    g.setAttribute('color', this.colour);
    g.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.lines.name = 'wake-crests';
    this.lines.frustumCulled = false;
  }

  /**
   * Work out whose wake is, or soon will be, at a point.
   * @param seasonTime seconds into the season
   */
  refresh(seasonTime: number, x: number, y: number): void {
    this.focusX = x;
    this.focusY = y;
    this.active.length = 0;
    for (const lane of this.lanes) {
      findPassings((t: number, out: TrackState) => lane.track.state(t, out), seasonTime, x, y, lane.passings);
      for (const p of lane.passings) {
        if (this.active.length >= MAX_WAKES) break;
        this.active.push({ id: lane.track.route.id, passedAt: p.t, px: p.x, py: p.y, x: p.x, y: p.y, heading: p.heading, speed: p.speed, beam: lane.beam, name: lane.name });
      }
    }
    this.advance(seasonTime);
    // Keep only the ones with something still to come or still going by.
    for (let i = this.active.length - 1; i >= 0; i--) {
      const h = wakeAt(this.active[i], x, y, this.hit);
      if (h.peak < 0.04 || h.arriveIn > 240 || h.waves > 9) this.active.splice(i, 1);
    }
  }

  /** Move every wake on to a moment of the season. Cheap: call it every frame. */
  advance(seasonTime: number): void {
    for (const w of this.active) {
      const run = w.speed * (seasonTime - w.passedAt);
      w.x = w.px + Math.sin(w.heading) * run;
      w.y = w.py + Math.cos(w.heading) * run;
    }
  }

  /** Height the wakes add to the water at a point, metres. Sim coordinates. */
  height(x: number, y: number): number {
    let eta = 0;
    for (const w of this.active) eta += wakeAt(w, x, y, this.hit).eta;
    return eta;
  }

  /**
   * The wake that matters most at a point: the one passing now, or failing that the next to arrive.
   * @returns the wake and what it is doing there, or null when there is none. The hit is reused by the next call
   */
  strongest(x: number, y: number): { wake: ActiveWake; hit: WakeHit } | null {
    let pick: ActiveWake | null = null;
    let score = 0;
    for (const w of this.active) {
      const h = wakeAt(w, x, y, this.hit);
      // One going by now outranks one still on its way, and a nearer arrival a later one.
      const s = h.height > 0.02 ? 10 + h.height : h.arriveIn > 0 ? h.peak / (1 + h.arriveIn / 30) : 0;
      if (s > score) {
        score = s;
        pick = w;
        Object.assign(this.best, h);
      }
    }
    return pick ? { wake: pick, hit: this.best } : null;
  }

  /** Lay a thin line along each crest near the point being followed, riding the sea that is drawn. */
  draw(seaTime: number, waves: Wave[]): void {
    const pos = this.position.array as Float32Array;
    const col = this.colour.array as Float32Array;
    let v = 0;
    const cos = Math.cos(WAKE.theta);
    const sin = Math.sin(WAKE.theta);
    const tan = Math.tan(WAKE.half);
    for (const w of this.active) {
      const fx = Math.sin(w.heading);
      const fy = Math.cos(w.heading);
      const rx = this.focusX - w.x;
      const ry = this.focusY - w.y;
      const lat = rx * fy - ry * fx;
      const sgn = lat >= 0 ? 1 : -1;
      const side0 = Math.abs(lat);
      const h0 = wakeAt(w, this.focusX, this.focusY, this.hit);
      if (h0.peak < 0.08 || h0.arriveIn > 60) continue;
      const k = (2 * Math.PI) / h0.length;
      // The first crest behind the arm of the V at this distance off, then the ones after it.
      const phaseAtArm = k * (side0 * sin - (side0 / tan) * cos);
      const first = Math.floor((phaseAtArm - Math.PI / 2) / (2 * Math.PI));
      for (let c = 0; c < CRESTS; c++) {
        const phase = Math.PI / 2 + 2 * Math.PI * (first - c);
        let prev: { x: number; y: number; z: number; a: number } | null = null;
        for (let i = 0; i <= SEGS; i++) {
          const side = Math.max(4, side0 + (i / SEGS - 0.5) * 320);
          const back = (side * sin - phase / k) / cos;
          const x = w.x - fx * back + sgn * fy * side;
          const y = w.y - fy * back - sgn * fx * side;
          const h = wakeAt(w, x, y, this.hit);
          const here = { x, y: waveHeight(waves, x, -y, seaTime) + h.height * 0.5 + 0.05, z: -y, a: Math.min(0.55, h.height * 1.1) };
          if (prev && v < pos.length / 3 - 1) {
            pos.set([prev.x, prev.y, prev.z, here.x, here.y, here.z], v * 3);
            col.set([prev.a, prev.a, prev.a, here.a, here.a, here.a], v * 3);
            v += 2;
          }
          prev = here;
        }
      }
    }
    this.lines.geometry.setDrawRange(0, v);
    this.position.needsUpdate = true;
    this.colour.needsUpdate = true;
  }
}
