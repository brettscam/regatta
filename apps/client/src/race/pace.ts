import * as THREE from 'three';
import { Sim, KT, type BoatSpec, type Environment } from '@slack-tide/sim';
import { trackFix } from '@slack-tide/nav';
import { BoatView, type BoatPose } from '../boat/boatView';
import type { Wave } from '../scene/waves';
import { waveHeight } from '../scene/waves';
import type { RaceMark } from './race';

const ARRIVAL = 130;
/** Who the pace boats are. They sail the same class as the player, so it is a fair race. */
export const PACERS = [
  { name: 'Wind Dancer', skipper: 'Marin', colour: '#1f4d7a', pace: 0.985 },
  { name: 'Hard Tack', skipper: 'Ines', colour: '#2e5d3a', pace: 0.955 },
  { name: 'Second Wind', skipper: 'Teo', colour: '#6b3a78', pace: 0.925 },
];

/**
 * A boat sailed by the autopilot, to race against. She is a full sim of her own, in the same wind and tide,
 * steering for each mark in turn with the crew trimming.
 */
export class PaceBoat {
  readonly sim: Sim;
  readonly view: BoatView;
  readonly name: string;
  readonly skipper: string;
  readonly length: number;
  /** Marks rounded, metres to the next one, and her time once she has finished. */
  leg = 0;
  toGo = 0;
  finish: number | null = null;
  private started = false;
  private legStart: { x: number; y: number };
  private readonly label = document.createElement('div');
  private readonly pos = new THREE.Vector3();
  private readonly motion = { heave: 0, pitch: 0 };

  constructor(index: number, spec: BoatSpec, env: Environment, private readonly scene: THREE.Scene, private readonly marks: RaceMark[]) {
    const who = PACERS[index % PACERS.length];
    this.name = who.name;
    this.skipper = who.skipper;
    this.length = spec.dimensions.loa;
    // She waits a little way back from the start mark, on the far side from the first leg, fanned out from the others.
    const start = marks[0];
    const next = marks[1] ?? start;
    const along = Math.atan2(next.x - start.x, next.y - start.y);
    const back = 170 + index * 45;
    const side = (index % 2 === 0 ? 1 : -1) * (60 + index * 35);
    const x = start.x - Math.sin(along) * back + Math.cos(along) * side;
    const y = start.y - Math.cos(along) * back - Math.sin(along) * side;
    // Each crew gets a little less out of the same boat than a perfect one would, and each by a different amount.
    const crewed = { ...spec, polar: { ...spec.polar, speeds: spec.polar.speeds.map((row) => row.map((kt) => kt * who.pace)) } };
    this.sim = new Sim(crewed, env, { x, y, headingDeg: (along * 180) / Math.PI, speedKt: 0 });
    this.legStart = { x, y };
    this.toGo = Math.hypot(start.x - x, start.y - y);
    this.view = new BoatView(spec, { topsides: who.colour, name: who.name });
    scene.add(this.view.root);
    this.label.className = 'boat-label';
    document.body.appendChild(this.label);
  }

  /** The gun. She sets off on the player's clock so both feel the same wind at the same moment. */
  start(tick: number): void {
    const s = this.sim.state;
    s.tick = tick;
    s.t = tick * this.sim.dt;
    s.speed = 3.5 * KT;
    this.sim.setRoute(this.marks[0], this.legStart);
    this.sim.setCrewTrim(true);
    this.sim.trimForWind();
    this.started = true;
  }

  /** One fixed step, alongside the player's. */
  step(elapsed: number): void {
    if (!this.started) return;
    this.sim.step();
    if (this.finish !== null) return;
    const s = this.sim.state;
    const next = this.marks[this.leg];
    const fix = trackFix(s, this.legStart, next);
    this.toGo = fix.toGo;
    const legLength = Math.hypot(next.x - this.legStart.x, next.y - this.legStart.y);
    if (fix.toGo < ARRIVAL || (fix.along > legLength && fix.toGo < ARRIVAL * 4)) {
      this.leg++;
      this.legStart = { x: next.x, y: next.y };
      const after = this.marks[this.leg];
      if (after) this.sim.setRoute(after, this.legStart);
      else {
        // Across the line. She rounds up and anchors out of the way.
        this.finish = elapsed;
        this.toGo = 0;
        this.sim.holdAt('anchor', s.x, s.y, 18);
      }
    } else if (s.helmMode === 'hand') {
      // Overpowered and the pilot let go. A crew would take her back.
      this.sim.setRoute(next, this.legStart);
      this.sim.setCrewTrim(true);
    }
  }

  draw(seaTime: number, waves: Wave[], dt: number, camera: THREE.Camera, width: number, height: number): void {
    const s = this.sim.state;
    const o = this.sim.out;
    const z = -s.y;
    const fx = Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    const bow = waveHeight(waves, s.x + fx * 4.2, z + fz * 4.2, seaTime);
    const stern = waveHeight(waves, s.x - fx * 4.2, z - fz * 4.2, seaTime);
    this.motion.heave += ((bow + stern) / 2 - this.motion.heave) * Math.min(1, dt * 5);
    this.motion.pitch += (Math.atan2(bow - stern, 8.4) * 0.8 - this.motion.pitch) * Math.min(1, dt * 5);
    const pose: BoatPose = { x: s.x, z, heading: s.heading, heel: s.heel, pitch: this.motion.pitch, heave: this.motion.heave - 0.03, rudder: s.rudder, boom: s.boomAngle, jib: s.jibAngle };
    this.view.update(pose, s, o, seaTime, dt);
    this.pos.set(s.x, 19, z).project(camera);
    const shown = this.pos.z < 1 && Math.abs(this.pos.x) < 1.1 && Math.abs(this.pos.y) < 1.1;
    this.label.style.display = shown ? 'block' : 'none';
    if (shown) {
      const text = `${this.skipper} · ${this.name} · ${(o.sog / KT).toFixed(1)} kt`;
      if (this.label.textContent !== text) this.label.textContent = text;
      this.label.style.transform = `translate(-50%, -100%) translate(${Math.round(((this.pos.x + 1) / 2) * width)}px, ${Math.round(((1 - this.pos.y) / 2) * height)}px)`;
    }
  }

  dispose(): void {
    this.scene.remove(this.view.root);
    this.label.remove();
  }
}
