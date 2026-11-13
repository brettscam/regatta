import * as THREE from 'three';
import { Sim, KT, R2D, type Environment } from '@slack-tide/sim';
import { BoatView, type BoatPose } from './boat/boatView';
import type { YardBoat } from './boat/yard';
import type { Stage } from './stage';
import type { Choice, StartSpot } from './ui/join';

/**
 * What is on the water behind the join screen: the chosen boat, sailing from the chosen spot, with the camera
 * circling her. High up while picking where to sail, close in while picking the boat.
 */
export class Lobby {
  readonly camera = new THREE.PerspectiveCamera(46, 1, 0.3, 40000);
  /** Seconds the join screen has been up. The sail starts this far into the afternoon, so nothing jumps back. */
  elapsed = 0;
  private boat: { view: BoatView; sim: Sim; key: string } | null = null;
  private yaw = 0.9;
  private dist = 420;
  private pitch = 0.24;
  private step = 0;
  private readonly motion = { heave: 0, pitch: 0 };
  private readonly look = new THREE.Vector3();

  constructor(private readonly stage: Stage, private readonly spots: StartSpot[], private readonly boats: Record<string, YardBoat>) {}

  /** Show a choice. Rebuilds the boat only when something about her or her place has changed. */
  show(choice: Choice, step: number): void {
    this.step = step;
    const key = `${choice.spot}|${choice.time}|${choice.boat}|${choice.colour}|${choice.name}`;
    if (this.boat?.key === key) return;
    const spec = this.boats[choice.boat];
    const spot = this.spots.find((s) => s.id === choice.spot) ?? this.spots[0];
    const moved = !this.boat || !this.boat.key.startsWith(`${choice.spot}|`);
    // Keep her where she has got to unless the place itself changed.
    const at = moved || !this.boat ? { x: spot.x, y: spot.y, heading: NaN } : { x: this.boat.sim.state.x, y: this.boat.sim.state.y, heading: this.boat.sim.state.heading };
    this.clear();
    const world = this.stage.world;
    const base = this.elapsed;
    const env: Environment = { sample: (x, y, t) => world.sample(x, y, t + base) };
    const wind = world.wind(at.x, at.y, base);
    const sim = new Sim(spec, env, { x: at.x, y: at.y, headingDeg: Number.isNaN(at.heading) ? wind.dir * R2D + 50 : at.heading * R2D, speedKt: 5 });
    sim.setCrewTrim(true);
    sim.trimForWind();
    sim.setHelm('wind', Number.isNaN(at.heading) ? undefined : sim.out.twa);
    const view = new BoatView(spec, { topsides: choice.colour, name: choice.name });
    view.setPilot({ engaged: true, mode: 'wind', label: `${Math.round(Math.abs(sim.out.twa) * R2D)}° ${sim.out.twa >= 0 ? 'S' : 'P'}` });
    this.stage.scene.add(view.root);
    this.boat = { view, sim, key };
  }

  private clear(): void {
    if (!this.boat) return;
    this.stage.scene.remove(this.boat.view.root);
    this.boat = null;
  }

  dispose(): void {
    this.clear();
    this.camera.clearViewOffset();
  }

  frame(dt: number): void {
    const b = this.boat;
    if (!b) return;
    this.elapsed += dt;
    const { sim, view } = b;
    sim.advance(Math.min(dt, 0.1));
    const s = sim.state;
    const seaTime = this.elapsed;
    const x = s.x;
    const z = -s.y;
    const half = sim.boat.dimensions.loa * 0.36;
    const fx = Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    const bow = this.stage.seaLevel(x + fx * half, z + fz * half, seaTime, 4);
    const stern = this.stage.seaLevel(x - fx * half, z - fz * half, seaTime, 4);
    const k = Math.min(1, dt * 5);
    this.motion.heave += ((bow + stern) / 2 - this.motion.heave) * k;
    this.motion.pitch += (Math.atan2(bow - stern, half * 2) * 0.8 - this.motion.pitch) * k;
    const pose: BoatPose = { x, z, heading: s.heading, heel: s.heel, pitch: this.motion.pitch, heave: this.motion.heave - 0.03, rudder: s.rudder, boom: s.boomAngle, jib: s.jibAngle };
    view.update(pose, s, sim.out, seaTime, dt);

    // Wide and high to choose the water, closer for the lesson question, alongside to choose the boat.
    const scale = sim.boat.dimensions.loa / 11.6;
    const want = this.step === 0 ? { dist: 330, pitch: 0.2 } : this.step === 1 ? { dist: 78 * scale, pitch: 0.26 } : { dist: 25 * scale, pitch: 0.17 };
    const ease = Math.min(1, dt * 1.6);
    this.dist = Math.exp(Math.log(this.dist) + (Math.log(want.dist) - Math.log(this.dist)) * ease);
    this.pitch += (want.pitch - this.pitch) * ease;
    this.yaw += dt * (this.step === 0 ? 0.035 : 0.07);
    const cp = Math.cos(this.pitch);
    this.look.set(x, 3.5 * scale, z);
    this.camera.position.set(x + Math.sin(this.yaw) * cp * this.dist, Math.max(2.5, 3.5 + Math.sin(this.pitch) * this.dist), z + Math.cos(this.yaw) * cp * this.dist);
    this.camera.lookAt(this.look);

    // Keep the boat clear of the panel: to its right on a wide screen, above it on a narrow one.
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w > 760) this.camera.setViewOffset(w, h, -Math.min(230, w * 0.2), 0, w, h);
    else this.camera.setViewOffset(w, h, 0, h * 0.22, w, h);

    this.stage.frame(dt, 1, this.elapsed, seaTime, this.camera, { x, z, heading: s.heading, speed: s.speed, heel: s.heel }, this.stage.traffic.vessels, sim.out.tws / KT);
  }
}
