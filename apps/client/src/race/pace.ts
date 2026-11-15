import * as THREE from 'three';
import { Sim, KT, type BoatSpec, type Environment, type SpinnakerSpec } from '@slack-tide/sim';
import { trackFix } from '@slack-tide/nav';
import { BoatView, type BoatPose } from '../boat/boatView';
import type { Wave } from '../scene/waves';
import { waveHeight } from '../scene/waves';
import type { RaceMark } from './race';
import { taken } from './startline';

const R2D = 180 / Math.PI;

/**
 * How much main a pace boat's crew carries for the wind: a reef at about 20 kt, a second at about 26, and each shaken out
 * once the wind has dropped a few knots below where it went in, so they do not reef and unreef in every puff.
 */
export function paceReef(twsKt: number, now: number): number {
  if (twsKt > 25.5) return 2;
  if (twsKt > 19.5) return Math.max(1, twsKt < 22.5 ? 1 : now);
  return twsKt < 16.5 ? 0 : Math.min(now, 1);
}

/**
 * Whether a pace boat's crew wants the spinnaker up. They set it on a leg where the wind is well aft and not too strong,
 * and have it down in good time before a mark whose next leg is to windward.
 * @param legTwaDeg wind angle of the straight course to the next mark, degrees, unsigned
 * @param nextTwaDeg the same for the leg after it, or null on the last leg
 * @param toGo metres to the next mark
 */
export function paceSpinnaker(up: boolean, kite: SpinnakerSpec | undefined, twsKt: number, legTwaDeg: number, nextTwaDeg: number | null, toGo: number): boolean {
  if (!kite) return false;
  // Hysteresis both ways: more margin to set it than to keep it.
  const windOk = twsKt < kite.maxTwsKt - (up ? 2 : 4);
  const angleOk = legTwaDeg > (up ? 98 : 108);
  const roomOk = nextTwaDeg === null || nextTwaDeg > 100 || toGo > (up ? 320 : 700);
  return windOk && angleOk && roomOk;
}
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
    // Once a second the crew looks at the wind and the leg and decides what sail to carry.
    if (s.tick % 60 === 0) this.handleSails(next);
    const fix = trackFix(s, this.legStart, next);
    this.toGo = fix.toGo;
    // The pace boats are judged by the same rule as the player.
    if (taken(fix.toGo, fix.along, Math.hypot(next.x - this.legStart.x, next.y - this.legStart.y))) {
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

  /** The crew reefs for the wind, and sets or douses the spinnaker for the leg. */
  private handleSails(next: RaceMark): void {
    const sim = this.sim;
    const s = sim.state;
    const o = sim.out;
    const twsKt = o.tws / KT;
    const reef = paceReef(twsKt, s.reef);
    if (reef !== s.reef) sim.setControl('reef', reef);
    const angleTo = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const d = o.twd - Math.atan2(to.x - from.x, to.y - from.y);
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * R2D;
    };
    const after = this.marks[this.leg + 1];
    const want = !s.maneuver && paceSpinnaker(s.spin, sim.boat.sails.spinnaker, twsKt, angleTo(s, next), after ? angleTo(next, after) : null, this.toGo);
    if (want !== s.spin) sim.setSpinnaker(want);
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
