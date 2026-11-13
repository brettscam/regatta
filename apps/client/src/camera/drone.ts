import * as THREE from 'three';

export interface ViewPreset {
  /** Look-at point in the boat frame. */
  target: [number, number, number];
  /** Angle around the boat, radians. 0 is astern looking forward, positive swings to the starboard side. */
  yaw: number;
  /** Angle above the horizon, radians. */
  pitch: number;
  dist: number;
}

export const VIEWS: Record<string, ViewPreset> = {
  helm: { target: [0, 2.1, 2.2], yaw: 0, pitch: 0.2, dist: 6.2 },
  mast: { target: [0, 3.0, -0.9], yaw: 0.5, pitch: 0.42, dist: 7.5 },
  foredeck: { target: [0, 2.6, -3.9], yaw: 0.35, pitch: 0.38, dist: 6.5 },
  drone: { target: [0, 4.5, 0], yaw: 0.62, pitch: 0.3, dist: 27 },
};

const MIN_DIST = 1.3;
const MAX_DIST = 320;
const MIN_PITCH = -0.12;
const MAX_PITCH = 1.5;

/**
 * A drone that follows the boat. It orbits, zooms and pans around a point in the boat's own frame,
 * turns with the boat, keeps the horizon level, and stays out of the water, the hull and the sails.
 */
export class DroneCamera {
  readonly camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3(0, 4.5, 0);
  private yaw = 0.62;
  private pitch = 0.3;
  private dist = 27;
  private followYaw = 0;
  private fly: { from: ViewPreset; to: ViewPreset; t: number; duration: number } | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly lookAt = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private hop = 0;
  /** How many times the player has moved the camera. */
  moves = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.12, 40000);
  }

  /** Jump straight to a view with no flight. */
  snap(view: ViewPreset, boatHeading: number): void {
    this.target.fromArray(view.target);
    this.yaw = view.yaw;
    this.pitch = view.pitch;
    this.dist = view.dist;
    this.followYaw = boatHeading;
    this.fly = null;
  }

  flyTo(view: ViewPreset, duration = 1.15): void {
    this.moves++;
    const from: ViewPreset = { target: this.target.toArray() as [number, number, number], yaw: this.yaw, pitch: this.pitch, dist: this.dist };
    // Take the short way round.
    let dy = view.yaw - from.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.fly = { from, to: { ...view, yaw: from.yaw + dy }, t: 0, duration };
  }

  orbit(dxPixels: number, dyPixels: number): void {
    this.moves++;
    this.fly = null;
    this.yaw -= dxPixels * 0.0055;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dyPixels * 0.0045, MIN_PITCH, MAX_PITCH);
  }

  /** Positive zooms out. `amount` is in scroll notches. */
  zoom(amount: number): void {
    this.moves++;
    this.fly = null;
    this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(amount * 0.14), MIN_DIST, MAX_DIST);
  }

  zoomBy(factor: number): void {
    this.moves++;
    this.fly = null;
    this.dist = THREE.MathUtils.clamp(this.dist * factor, MIN_DIST, MAX_DIST);
  }

  /** Slide the look-at point across the screen. It stays in the boat's frame, so the camera keeps following. */
  pan(dxPixels: number, dyPixels: number, viewportHeight: number): void {
    this.moves++;
    this.fly = null;
    const scale = (2 * this.dist * Math.tan((this.camera.fov * Math.PI) / 360)) / viewportHeight;
    const a = this.yaw;
    // Screen right and screen up, expressed in the boat frame.
    const rx = Math.cos(a);
    const rz = -Math.sin(a);
    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);
    this.target.x += -dxPixels * scale * rx + dyPixels * scale * -sp * Math.sin(a);
    this.target.z += -dxPixels * scale * rz + dyPixels * scale * -sp * Math.cos(a);
    this.target.y += dyPixels * scale * cp;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -25, 25);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -25, 25);
    this.target.y = THREE.MathUtils.clamp(this.target.y, 0.3, 30);
  }

  /**
   * @param boat world position of the boat's origin
   * @param heading compass heading, radians
   * @param seaLevel height of the water under a given world x, z
   */
  update(
    dt: number,
    boat: THREE.Vector3,
    heading: number,
    seaLevel: (x: number, z: number) => number,
    solids: THREE.Object3D[],
    thin: THREE.Object3D[],
  ): void {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.duration);
      const k = f.t * f.t * (3 - 2 * f.t);
      this.target.set(
        THREE.MathUtils.lerp(f.from.target[0], f.to.target[0], k),
        THREE.MathUtils.lerp(f.from.target[1], f.to.target[1], k),
        THREE.MathUtils.lerp(f.from.target[2], f.to.target[2], k),
      );
      this.yaw = THREE.MathUtils.lerp(f.from.yaw, f.to.yaw, k);
      this.pitch = THREE.MathUtils.lerp(f.from.pitch, f.to.pitch, k);
      // Zoom on a log scale so a long flight does not rush the last few metres.
      this.dist = Math.exp(THREE.MathUtils.lerp(Math.log(f.from.dist), Math.log(f.to.dist), k));
      if (f.t >= 1) this.fly = null;
    }

    // Turn with the boat, a beat behind, so a tack swings the world gently rather than snapping it.
    let dh = heading - this.followYaw;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.followYaw += dh * Math.min(1, dt * 3.2);

    // Boat frame to world: only heading, never heel or pitch, so the horizon stays level.
    const rot = -this.followYaw;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const t = this.target;
    this.lookAt.set(boat.x + t.x * c + t.z * s, boat.y * 0.6 + t.y, boat.z - t.x * s + t.z * c);

    const a = this.yaw;
    const cp = Math.cos(this.pitch);
    const ox = Math.sin(a) * cp;
    const oy = Math.sin(this.pitch);
    const oz = Math.cos(a) * cp;
    this.offset.set(ox * c + oz * s, oy, -ox * s + oz * c);

    let dist = this.dist;
    // Solid parts: never go inside or behind them.
    this.ray.set(this.lookAt, this.offset);
    this.ray.far = dist + 0.4;
    const solidHit = this.ray.intersectObjects(solids, false)[0];
    if (solidHit) dist = Math.max(0.4, Math.min(dist, solidHit.distance - 0.35));
    // Thin parts such as sails: if the lens would sit right on one, hop to the near side.
    this.ray.far = dist + 0.45;
    let hopTarget = 0;
    for (const hit of this.ray.intersectObjects(thin, false)) {
      if (hit.distance > dist - 0.45) { hopTarget = dist - (hit.distance - 0.45); break; }
    }
    this.hop += (hopTarget - this.hop) * Math.min(1, dt * 14);
    dist = Math.max(0.4, dist - this.hop);

    this.camera.position.copy(this.lookAt).addScaledVector(this.offset, dist);
    // Stay dry.
    const floor = seaLevel(this.camera.position.x, this.camera.position.z) + 0.45;
    if (this.camera.position.y < floor) this.camera.position.y = floor;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.tmp.copy(this.lookAt));
  }
}
