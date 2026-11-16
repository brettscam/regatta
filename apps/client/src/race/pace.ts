import * as THREE from 'three';
import { KT, type BoatSpec, type Environment } from '@slack-tide/sim';
import { randomAvatar, type Avatar } from '../boat/avatar';
import { BoatView, type BoatPose } from '../boat/boatView';
import type { Wave } from '../scene/waves';
import { waveHeight } from '../scene/waves';
import { hash01 } from '../aboard/catch';
import { hashText, type Entrant } from './cast';
import { PaceSailor, type Berth, type Mark } from './sailor';

export { paceReef, paceSpinnaker } from './sailor';

/** A club skipper's look: always the same for the same skipper, on every page. */
export function castAvatar(id: string): Avatar {
  const seed = hashText(id);
  let n = 0;
  return randomAvatar(() => hash01(seed, n++));
}

/** Beyond this many metres from the camera a pace boat's sails and crew are only redrawn every few frames. */
const NEAR = 900;

/**
 * A boat sailed by the autopilot, to race against: one of the club's skippers (`cast.ts`), sailed as well as she sails
 * (`sailor.ts`). She is a full sim of her own, in the same wind and tide, in the race's class. This adds what is seen
 * of her: the hull in her colours with her name on the transom and her number on the sail, her crew, and the label over her.
 */
export class PaceBoat extends PaceSailor {
  /** The boat as drawn. Built the first time she is drawn, one boat a frame, so calling a race with nine of them does not stop the game while they are all built at once. */
  view: BoatView | null = null;
  private readonly label = document.createElement('div');
  private readonly pos = new THREE.Vector3();
  private readonly motion = { heave: 0, pitch: 0 };
  private frame = 0;
  private owed = 0;

  constructor(entrant: Entrant, berth: Berth, private readonly spec: BoatSpec, env: Environment, private readonly scene: THREE.Scene, marks: readonly Mark[], private readonly index = 0) {
    super(entrant, berth, spec, env, marks, index);
    const who = entrant.who;
    this.label.className = 'boat-label';
    this.label.title = who.character;
    document.body.appendChild(this.label);
  }

  /**
   * @param build whether she may be built this frame, if she has not been yet
   * @returns true if this call built her
   */
  draw(seaTime: number, waves: Wave[], dt: number, camera: THREE.Camera, width: number, height: number, build = true): boolean {
    let built = false;
    if (!this.view) {
      if (!build) return false;
      const who = this.entrant.who;
      this.view = new BoatView(this.spec, { topsides: who.colour, name: who.boat, sail: who.sail, avatar: castAvatar(who.id) });
      this.scene.add(this.view.root);
      built = true;
    }
    const s = this.sim.state;
    const o = this.sim.out;
    const z = -s.y;
    // A boat a long way off has her sails and crew redrawn every fourth frame, each boat on a different one. Her hull still moves every frame.
    this.frame++;
    this.owed += dt;
    const far = (camera.position.x - s.x) ** 2 + (camera.position.z - z) ** 2 > NEAR * NEAR;
    if (far && !built && (this.frame + this.index) % 4 !== 0) {
      const root = this.view.root;
      root.position.x = s.x;
      root.position.z = z;
      root.rotation.y = -s.heading;
    } else {
      const fx = Math.sin(s.heading);
      const fz = -Math.cos(s.heading);
      const bow = waveHeight(waves, s.x + fx * 4.2, z + fz * 4.2, seaTime);
      const stern = waveHeight(waves, s.x - fx * 4.2, z - fz * 4.2, seaTime);
      const k = Math.min(1, this.owed * 5);
      this.motion.heave += ((bow + stern) / 2 - this.motion.heave) * k;
      this.motion.pitch += (Math.atan2(bow - stern, 8.4) * 0.8 - this.motion.pitch) * k;
      const pose: BoatPose = { x: s.x, z, heading: s.heading, heel: s.heel, pitch: this.motion.pitch, heave: this.motion.heave - 0.03, rudder: s.rudder, boom: s.boomAngle, jib: s.jibAngle };
      this.view.update(pose, s, o, seaTime, this.owed);
      this.owed = 0;
    }
    this.pos.set(s.x, 19, z).project(camera);
    const shown = this.pos.z < 1 && Math.abs(this.pos.x) < 1.1 && Math.abs(this.pos.y) < 1.1;
    this.label.style.display = shown ? 'block' : 'none';
    if (shown) {
      const text = `${this.skipper} · ${this.name} · ${(o.sog / KT).toFixed(1)} kt`;
      if (this.label.textContent !== text) this.label.textContent = text;
      this.label.style.transform = `translate(-50%, -100%) translate(${Math.round(((this.pos.x + 1) / 2) * width)}px, ${Math.round(((1 - this.pos.y) / 2) * height)}px)`;
    }
    return built;
  }

  dispose(): void {
    if (this.view) this.scene.remove(this.view.root);
    this.label.remove();
  }
}
