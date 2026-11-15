import * as THREE from 'three';
import { Figure } from '../boat/crew';
import type { Avatar } from '../boat/avatar';

/**
 * The figure on its own, standing and slowly turning, for the profile. One small renderer of its own, made the first
 * time it is asked for, and drawing only while its canvas is on the page and showing. Drag it to turn the figure.
 * It also takes the still picture of the skipper for the home screen's card.
 */
export class FigurePreview {
  readonly canvas = document.createElement('canvas');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 1, 0.1, 30);
  private readonly figure = new Figure('preview');
  private yaw = 0.5;
  private spin = 0.5;
  /** 0 the whole figure, 1 head and shoulders. Eased. */
  private close = 0;
  private closeWanted = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private dragging: number | null = null;

  constructor() {
    this.canvas.className = 'figure-preview';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xdfeaf2, 0x39424a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
    sun.position.set(-2, 4, -3);
    this.scene.add(sun);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 28), new THREE.MeshStandardMaterial({ color: 0xb8a27a, roughness: 0.9 }));
    deck.position.y = -0.02;
    this.scene.add(deck, this.figure.group);
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = e.clientX;
      this.spin = 0;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging === null) return;
      this.yaw += (e.clientX - this.dragging) * 0.012;
      this.dragging = e.clientX;
    });
    const drop = (): void => { this.dragging = null; };
    this.canvas.addEventListener('pointerup', drop);
    this.canvas.addEventListener('pointercancel', drop);
  }

  wear(avatar: Avatar): void {
    this.figure.wear(avatar);
  }

  /** Look at the whole figure, or come in on the head for the face, hair and hat. */
  focus(on: 'figure' | 'head'): void {
    this.closeWanted = on === 'head' ? 1 : 0;
  }

  /** Start drawing. It stops by itself once the canvas is off the page or hidden. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (!this.canvas.isConnected || this.canvas.offsetParent === null) {
      this.running = false;
      return;
    }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.yaw += this.spin * dt;
    // Left alone for a while, she starts turning again.
    if (this.dragging === null && this.spin < 0.5) this.spin = Math.min(0.5, this.spin + dt * 0.1);
    this.close += (this.closeWanted - this.close) * Math.min(1, dt * 5);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w && h) {
      const size = this.renderer.getSize(new THREE.Vector2());
      if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
      this.draw(w / h, this.yaw, this.close);
    }
    requestAnimationFrame(this.frame);
  };

  /** Stand the figure up, arms easy, weight shifting a little. */
  private pose(yaw: number): void {
    const f = this.figure;
    const t = this.time;
    const sway = Math.sin(t * 0.9) * 0.012;
    f.up.set(0, 1, 0);
    f.right.set(1, 0, 0);
    f.fwd.set(0, 0, -1);
    f.footL.set(-0.13, 0, 0.02);
    f.footR.set(0.13, 0, -0.02);
    f.pelvis.set(sway, 0.9 * f.tall, 0);
    f.neck.set(sway * 1.6, 0.9 * f.tall + 0.54 * f.tall + Math.sin(t * 1.6) * 0.004, -0.02);
    f.kneeHint.set(0, 0.2, -1);
    // One hand on the hip, the other easy at the side.
    f.handL.set(-0.3, f.pelvis.y - 0.1 * f.tall, -0.04);
    f.handR.set(0.25, f.pelvis.y + 0.06, -0.02);
    f.elbowHintL.set(-1, -0.3, 0.4);
    f.elbowHintR.set(1, 0.1, 0.9);
    f.look.set(Math.sin(t * 0.5) * 0.25, 0.02, -1);
    f.apply();
    f.group.rotation.y = yaw;
  }

  private draw(aspect: number, yaw: number, close: number): void {
    this.pose(yaw);
    const tall = this.figure.tall;
    const headY = 1.44 * tall + 0.2;
    const lookY = THREE.MathUtils.lerp(0.98 * tall + 0.06, headY, close);
    const dist = THREE.MathUtils.lerp(4.9, 1.75, close) / Math.min(1, aspect * 1.9);
    this.camera.aspect = aspect;
    this.camera.position.set(0, lookY + 0.25 * (1 - close), -dist);
    this.camera.lookAt(0, lookY, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  /** A still picture of an avatar, head and shoulders, as a data address for an image. */
  portrait(avatar: Avatar, size = 192): string {
    const was = { w: this.canvas.width, h: this.canvas.height };
    const ratio = this.renderer.getPixelRatio();
    this.figure.wear(avatar);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.draw(1, 0.45, 0.82);
    const url = this.canvas.toDataURL('image/png');
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(was.w / ratio, was.h / ratio, false);
    return url;
  }
}

let shared: FigurePreview | null = null;
/** The one preview the page has. Null where a second 3D view cannot be made. */
export function figurePreview(): FigurePreview | null {
  if (shared) return shared;
  try {
    shared = new FigurePreview();
  } catch {
    shared = null;
  }
  return shared;
}
