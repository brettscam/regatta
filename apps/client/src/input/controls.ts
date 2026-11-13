import * as THREE from 'three';
import { D2R, R2D, type ControlBinding, type ControlName, type Sim } from '@slack-tide/sim';
import type { BoatView } from '../boat/boatView';
import { VIEWS, type DroneCamera } from '../camera/drone';
import type { Hud } from '../ui/hud';
import type { Sound } from '../audio/sound';

interface Hover {
  node: string;
  binding: ControlBinding | null;
  view: string;
}

/** Hooks back into the app for things the input layer does not own. */
export interface ControlHost {
  togglePause(): void;
  announce(text: string): void;
  toggleChart(): void;
  closeChart(): void;
  toggleInstruments(): void;
  /** Engage the pilot in its selected mode, or release it. */
  togglePilot(): void;
  /** Step the pilot's mode: heading, wind angle, route. */
  cyclePilotMode(): void;
  /** The player has taken a sheet in hand, so the crew stops trimming. */
  sheetsInHand(): void;
  /** What the pilot is doing, for its tag. */
  pilotTag(): string;
  /** The player moved a control, by any means. */
  controlUsed(control: ControlName): void;
}

/**
 * Hands on the boat. Point at a part and scroll, or drag it, or use its key.
 * Parts are found by node name from the boat's data file, so a new boat needs no new input code.
 * Scrolling or dragging on water or sky moves the camera and never touches the boat.
 */
export class Controls {
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly held = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private hover: Hover | null = null;
  private pointer = { x: -1, y: -1, inside: false };
  private drag:
    | { kind: 'part'; binding: ControlBinding; id: number; slop: number }
    | { kind: 'orbit' | 'pan'; id: number; slop: number }
    | { kind: 'pinch'; dist: number; cx: number; cy: number }
    | null = null;
  /** After a key moves a control, its tag shows at the part for a moment. */
  private keyTag: { binding: ControlBinding; ttl: number } | null = null;
  private repick = 0;
  private mouse = false;
  private readonly p = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly s0 = new THREE.Vector3();
  private readonly s1 = new THREE.Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly drone: DroneCamera,
    private readonly boat: BoatView,
    private readonly sim: Sim,
    private readonly hud: Hud,
    private readonly sound: Sound,
    private readonly host: ControlHost,
  ) {
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', () => { this.pointer.inside = false; if (!this.drag) this.setHover(null); });
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  // ---- picking --------------------------------------------------------------------------------

  private pick(clientX: number, clientY: number): Hover | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.drone.camera);
    const hits = this.ray.intersectObjects(this.boat.pickables, false);
    if (!hits.length) return null;
    // A control part wins if it is at, or just behind, the first thing under the pointer.
    for (const h of hits) {
      if (h.distance > hits[0].distance + 0.6) break;
      const res = this.boat.resolve(h);
      if (res.binding) return res;
    }
    return this.boat.resolve(hits[0]);
  }

  private setHover(h: Hover | null): void {
    this.hover = h;
    const bound = h?.binding ?? null;
    this.boat.setGlow(bound ? bound.node : null);
    this.canvas.style.cursor = this.drag?.kind === 'part' ? 'grabbing' : bound ? 'grab' : 'default';
    if (!bound) this.hud.hideTag();
  }

  // ---- changing a control ---------------------------------------------------------------------

  private nudge(binding: ControlBinding, delta: number): void {
    const before = this.sim.getControl(binding.control);
    this.sim.nudgeControl(binding.control, delta);
    const moved = this.sim.getControl(binding.control) - before;
    if (moved !== 0) this.host.controlUsed(binding.control);
    if (binding.control === 'pilot') return;
    if (binding.control !== 'rudder') this.host.sheetsInHand();
    if (moved !== 0 && binding.control !== 'rudder') {
      const load = binding.control === 'mainsheet' ? this.sim.out.main.loadKg : this.sim.out.jib.loadKg;
      this.sound.winch(moved * R2D, Math.min(1, load / 400));
    }
  }

  /** The one number that matters for a control, as text. */
  private tagFor(binding: ControlBinding): [string, string] {
    const out = this.sim.out;
    const s = this.sim.state;
    switch (binding.control) {
      case 'rudder': {
        const deg = Math.round(s.rudderCmd * R2D);
        return ['Rudder', deg === 0 ? 'amidships' : `${Math.abs(deg)}° ${deg > 0 ? 'starboard' : 'port'}`];
      }
      case 'mainsheet':
        return [binding.label, out.main.flogging ? 'slack' : `${Math.round(out.main.loadKg)} kg`];
      case 'jibsheet_port':
      case 'jibsheet_stbd': {
        const loaded = this.sim.loadedJibSheet() === binding.control && !out.jib.flogging && s.furl > 0.02;
        return [binding.label, loaded ? `${Math.round(out.jib.loadKg)} kg` : 'slack'];
      }
      case 'pilot':
        return [binding.label, this.host.pilotTag()];
      default:
        return [binding.label, ''];
    }
  }

  private bindingFor(control: ControlName): ControlBinding | null {
    return this.boat.spec.controls.find((b) => b.control === control) ?? null;
  }

  // ---- pointer --------------------------------------------------------------------------------

  private onPointerDown = (e: PointerEvent): void => {
    this.sound.start();
    this.canvas.focus();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.canvas.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) {
      // Two fingers: pinch to zoom, drag together to pan.
      const [a, b] = [...this.pointers.values()];
      this.drag = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.setHover(null);
      return;
    }
    const hit = this.pick(e.clientX, e.clientY);
    if (e.button === 0 && hit?.binding) {
      this.drag = { kind: 'part', binding: hit.binding, id: e.pointerId, slop: 0 };
      this.setHover(hit);
    } else {
      this.drag = { kind: e.button === 0 ? 'orbit' : 'pan', id: e.pointerId, slop: 0 };
      this.canvas.style.cursor = 'grabbing';
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.inside = true;
    this.mouse = e.pointerType !== 'touch';
    const prev = this.pointers.get(e.pointerId);
    const dx = prev ? e.clientX - prev.x : 0;
    const dy = prev ? e.clientY - prev.y : 0;
    if (prev) { prev.x = e.clientX; prev.y = e.clientY; }

    const d = this.drag;
    if (!d) {
      if (e.pointerType !== 'touch') this.setHover(this.pick(e.clientX, e.clientY));
      return;
    }
    if (d.kind === 'pinch') {
      const pts = [...this.pointers.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      if (dist > 1 && d.dist > 1) this.drone.zoomBy(d.dist / dist);
      this.drone.pan(cx - d.cx, cy - d.cy, this.canvas.clientHeight);
      d.dist = dist;
      d.cx = cx;
      d.cy = cy;
      return;
    }
    // A click is not a drag. Wait for the pointer to travel a few pixels before anything moves.
    if (d.slop < 4) {
      d.slop += Math.abs(dx) + Math.abs(dy);
      return;
    }
    if (d.kind === 'orbit') {
      this.drone.orbit(dx, dy);
    } else if (d.kind === 'pan') {
      this.drone.pan(dx, dy, this.canvas.clientHeight);
    } else if (d.kind === 'part') {
      this.dragPart(d.binding, dx, dy);
    }
  };

  /** Turn a drag in pixels into a change of the control, following the way the part moves on screen. */
  private dragPart(binding: ControlBinding, dx: number, dy: number): void {
    const h = this.boat.handle(binding.node, this.sim.state, this.p, this.t);
    if (!h) return;
    const cam = this.drone.camera;
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    this.s0.copy(this.p).project(cam);
    this.s1.copy(this.p).addScaledVector(this.t, 0.25).project(cam);
    let gx = ((this.s1.x - this.s0.x) * w) / 2 / 0.25;
    let gy = (-(this.s1.y - this.s0.y) * hgt) / 2 / 0.25;
    let pxPerMetre = Math.hypot(gx, gy);
    if (pxPerMetre < 12) {
      // Seen end-on, the part barely moves on screen. Fall back to a plain sideways or downward drag.
      gx = binding.control === 'rudder' ? 1 : 0;
      gy = binding.control === 'rudder' ? 0 : 1;
      pxPerMetre = 140;
    } else {
      gx /= pxPerMetre;
      gy /= pxPerMetre;
      pxPerMetre = Math.max(pxPerMetre, 40);
    }
    const metres = (dx * gx + dy * gy) / pxPerMetre;
    this.nudge(binding, metres / h.metresPerUnit);
  }

  private onPointerUp = (e: PointerEvent): void => {
    // A click on the pilot head, with no drag, steps its mode.
    const d = this.drag;
    if (d && d.kind === 'part' && d.slop < 4 && d.binding.control === 'pilot') this.host.cyclePilotMode();
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.drag = null;
    this.setHover(e.pointerType === 'touch' ? null : this.pick(e.clientX, e.clientY));
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.sound.start();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    // Shift turns a vertical wheel into a horizontal one on some systems. Take whichever axis moved.
    const raw = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
    const notches = THREE.MathUtils.clamp(raw / 100, -3, 3);
    const b = this.hover?.binding;
    // A pinch on a trackpad arrives as a wheel event with ctrl held. That always zooms.
    if (!b || e.ctrlKey) {
      this.drone.zoom(e.ctrlKey ? notches * 2.5 : notches);
      return;
    }
    const step = (b.stepDeg ?? 2) * D2R * (e.shiftKey ? 5 : 1);
    // Wheel: scroll up or right steers to starboard. Sheets: scroll up hauls in, scroll down eases.
    // The pilot's dial turns the same way as the wheel.
    const sign = b.control === 'rudder' || b.control === 'pilot' ? -1 : 1;
    const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.shiftKey;
    this.nudge(b, b.control === 'rudder' && sideways ? notches * step : sign * notches * step);
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const hit = this.pick(e.clientX, e.clientY);
    if (hit && VIEWS[hit.view]) this.drone.flyTo(VIEWS[hit.view]);
  };

  // ---- keys -----------------------------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    this.sound.start();
    this.held.add(e.code);
    if (e.repeat) { if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); return; }
    switch (e.code) {
      case 'Space': this.host.togglePause(); e.preventDefault(); break;
      case 'KeyP': if (e.shiftKey) this.host.cyclePilotMode(); else this.host.togglePilot(); break;
      case 'KeyT': this.host.announce(this.sim.tack() === 'tack' ? 'Ready about. Helm’s a-lee' : 'Stand by to gybe. Gybe-oh'); break;
      case 'Digit1': this.drone.flyTo(VIEWS.helm); break;
      case 'Digit2': this.drone.flyTo(VIEWS.mast); break;
      case 'Digit3': this.drone.flyTo(VIEWS.foredeck); break;
      case 'Digit4': this.drone.flyTo(VIEWS.drone); break;
      case 'KeyH': this.host.toggleInstruments(); break;
      case 'KeyM': this.host.toggleChart(); break;
      case 'Escape': this.host.closeChart(); break;
      case 'Backquote': this.hud.toggleFps(); break;
      default: if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  };

  /** Apply held keys and keep the pointer tag current. Call once a frame. */
  update(dt: number, paused: boolean): void {
    // The boat and camera move under a still pointer, so look again a few times a second.
    this.repick -= dt;
    if (this.repick <= 0 && !this.drag && this.mouse && this.pointer.inside && this.pointers.size === 0) {
      this.repick = 0.15;
      this.setHover(this.pick(this.pointer.x, this.pointer.y));
    }
    const fast = this.held.has('ShiftLeft') || this.held.has('ShiftRight') ? 2.5 : 1;
    if (!paused) {
      for (const b of this.boat.spec.controls) {
        if (!b.keys) continue;
        const dir = (b.keys.inc.some((k) => this.held.has(k)) ? 1 : 0) - (b.keys.dec.some((k) => this.held.has(k)) ? 1 : 0);
        if (dir === 0) continue;
        const rate = (b.control === 'rudder' ? 24 : 16) * D2R * fast;
        this.nudge(b, dir * rate * dt);
        this.keyTag = { binding: b, ttl: 1.2 };
      }
      // Q trims the leeward jib sheet. E eases whichever jib sheet is holding the sail.
      if (this.held.has('KeyQ')) {
        const b = this.bindingFor(this.sim.workingJibSheet());
        if (b) { this.nudge(b, -16 * D2R * fast * dt); this.keyTag = { binding: b, ttl: 1.2 }; }
      }
      if (this.held.has('KeyE')) {
        const b = this.bindingFor(this.sim.loadedJibSheet());
        if (b) { this.nudge(b, 30 * D2R * fast * dt); this.keyTag = { binding: b, ttl: 1.2 }; }
      }
    }

    const active = this.drag?.kind === 'part' ? this.drag.binding : this.hover?.binding ?? null;
    if (active && this.pointer.inside) {
      const [label, value] = this.tagFor(active);
      this.hud.showTag(this.pointer.x, this.pointer.y, label, value);
      this.keyTag = null;
    } else if (this.keyTag) {
      // Keys have no pointer, so the tag sits on the part itself.
      this.keyTag.ttl -= dt;
      const b = this.keyTag.binding;
      const h = this.boat.handle(b.node, this.sim.state, this.p, this.t);
      if (h && this.keyTag.ttl > 0) {
        this.s0.copy(this.p).project(this.drone.camera);
        const r = this.canvas.getBoundingClientRect();
        const [label, value] = this.tagFor(b);
        if (this.s0.z < 1) this.hud.showTag(r.left + ((this.s0.x + 1) / 2) * r.width, r.top + ((1 - this.s0.y) / 2) * r.height, label, value);
        this.boat.setGlow(b.node);
      } else {
        this.keyTag = null;
        this.hud.hideTag();
        this.boat.setGlow(this.hover?.binding?.node ?? null);
      }
    }
  }
}
