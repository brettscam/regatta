import * as THREE from 'three';
import { KT, SIM_DT } from '@slack-tide/sim';
import type { AboardContext, Feature } from './feature';
import { BITE_SPELL, STRIKE_SECONDS, biteIn, describeFish, fishingAdvice, fishingMode, fishingReason, withinLimit, type Bite, type FishingMode, type Water } from './catch';
import { baitAt, type Sea } from './fauna';

const UP = new THREE.Vector3(0, 1, 0);

/** The time of day on the course's own clock, in hours. */
function localHour(date: Date, timeZone: string): number {
  const [h, m] = date.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number);
  return (h % 24) + m / 60;
}
const ROD_LENGTH = 2.2;
/** How much of the butt sits down in the rod holder. */
const ROD_BUTT = 0.3;

/**
 * A line over the stern. L puts it out and brings it in. Under sail it trolls, stopped or at anchor it fishes the
 * bottom. When a fish takes it there are a few seconds to press L and strike. What bites is worked out in `catch.ts`,
 * from the state of the tide, the hour, the boat's speed and whether birds are working bait near by (`fauna.ts`).
 */
export class Fishing implements Feature {
  readonly id = 'fishing';
  private out = false;
  private fish: Bite | null = null;
  /** Game seconds left to strike. Counted only once a frame has shown the alarm, so speeded-up time cannot eat them. */
  private left = 0;
  private shown = false;
  /** Game seconds before the next bite can come: the lure has to get down, and the water settle after a fish. */
  private rest = 0;
  private spell = -1;
  private ticks = 0;
  /** What the player was last told the line is doing, and how long the boat has been doing something else. */
  private told: FishingMode = 'still';
  private toldSkip = false;
  private changed = 0;
  private mode: FishingMode = 'still';
  /** Real seconds since a fish got away, during which L is taken as a late strike and not as reeling in. */
  private late = 0;
  private landed = 0;
  /** Fish of each kind kept this sail, against the day's limit. */
  private readonly aboard = new Map<string, number>();
  /** The last thing said about why the fishing is slow, and how long conditions have been saying something else. */
  private toldWhy = '';
  private whyFor = 0;
  private hour = 12;
  private hourAt = -1;
  private readonly tideSet = { x: 0, y: 0 };
  private readonly sea: Sea;

  private readonly rig = new THREE.Group();
  private readonly rod: THREE.Mesh;
  private readonly line: THREE.Line;
  private readonly foot = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  /** 0 with the line straight down, 1 with it streaming astern. */
  private stream = 0;
  private dip = 0;
  private clock = 0;

  constructor(private readonly ctx: AboardContext) {
    const d = ctx.spec.dimensions;
    const flow = { x: 0, y: 0 };
    this.sea = {
      depth: (x, y) => ctx.world.chartDepth(x, y),
      stream: (x, y) => {
        ctx.world.current(x, y, ctx.sim.state.t, flow);
        return Math.hypot(flow.x, flow.y);
      },
      tideRate: 0,
    };
    // In a holder on the stern rail, to starboard of the centreline and inboard of the lifebuoy.
    this.foot.set(d.beam * 0.17, d.freeboard + 0.5, d.loa / 2 - 0.06);
    this.stand();
    const carbon = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.45 });
    const geo = new THREE.CylinderGeometry(0.005, 0.016, ROD_LENGTH, 6);
    geo.translate(0, ROD_LENGTH / 2 - ROD_BUTT, 0);
    this.rod = new THREE.Mesh(geo, carbon);
    this.rod.position.copy(this.foot);
    this.rod.castShadow = true;
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10), new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.35, metalness: 0.6 }));
    reel.rotation.z = Math.PI / 2;
    reel.position.set(0, 0.16, -0.05);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 8), new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 }));
    grip.position.y = -0.06;
    this.rod.add(reel, grip);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    // High-visibility yellow line, the kind sold so that it can be seen against the water.
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xeef25a }));
    this.line.frustumCulled = false;
    this.rig.name = 'fishing_rod';
    this.rig.add(this.rod, this.line);
    this.rig.visible = false;
    ctx.boatView.root.add(this.rig);
  }

  /** A boat built with rod holders (`rod_stbd`, see `boat/buildConsole.ts`) has the rod in her starboard one, not on a stern rail she does not have. */
  private stand(): void {
    const holder = this.ctx.boatView.model.nodes.rod_stbd;
    if (!holder) return;
    this.foot.copy(holder.position);
    this.foot.y += 0.1;
  }

  private water(): Water {
    const { sim, world, stage } = this.ctx;
    const s = sim.state;
    const now = this.ctx.seasonNow();
    const held = s.hold !== 'none';
    world.current(s.x, s.y, s.t, this.tideSet);
    // The hour and the tide move slowly: once a game minute is often enough to ask.
    const minute = Math.floor(now / 60);
    if (minute !== this.hourAt) {
      this.hourAt = minute;
      this.hour = localHour(world.dateAt(s.t), stage.course.timeZone);
      this.sea.tideRate = world.tideRate(s.t);
    }
    return {
      x: s.x, y: s.y, depth: world.depth(s.x, s.y, s.t), speedKt: Math.abs(s.speed) / KT, held,
      sogKt: held ? 0 : sim.out.sog / KT,
      streamKt: Math.hypot(this.tideSet.x, this.tideSet.y) / KT,
      tideRate: this.sea.tideRate,
      hour: this.hour,
      bait: baitAt(stage.course.id, now, this.sea, s.x, s.y),
    };
  }

  key(code: string): boolean {
    if (code !== 'KeyL') return false;
    if (this.fish) {
      this.land(this.fish);
      return true;
    }
    if (this.out && this.late > 0) {
      this.late = 0;
      this.ctx.say('Too late, that one is gone. The line is still out', 4);
      return true;
    }
    if (this.out) {
      this.out = false;
      this.rig.visible = false;
      this.ctx.say(this.landed ? `Line in. ${this.landed} fish aboard this sail` : 'Line in', 4);
      return true;
    }
    const w = this.water();
    this.out = true;
    this.rig.visible = true;
    this.mode = this.told = fishingMode(w);
    this.toldSkip = this.mode === 'skip';
    this.changed = 0;
    this.toldWhy = fishingReason(w);
    this.whyFor = 0;
    this.stream = this.mode === 'still' ? 0 : 1;
    this.rest = BITE_SPELL;
    this.spell = Math.floor(this.ctx.seasonNow() / BITE_SPELL);
    this.ctx.say(`Line out. ${fishingAdvice(w)}. L brings it in`, 9);
    return true;
  }

  private land(hooked: Bite): void {
    // One more than the day's limit of its kind goes back, however good a fish.
    const b = withinLimit(hooked, this.aboard.get(hooked.species.id) ?? 0);
    this.fish = null;
    this.rest = 40;
    if (b.keeper) {
      this.landed++;
      this.aboard.set(b.species.id, (this.aboard.get(b.species.id) ?? 0) + 1);
      this.ctx.logbook.count('fish');
    }
    this.ctx.say(`${describeFish(b)}. The line is back out`, 8);
  }

  step(): void {
    if (!this.out) return;
    if (this.fish) {
      if (!this.shown) return;
      this.left -= SIM_DT;
      if (this.left <= 0) {
        this.fish = null;
        this.rest = 45;
        this.late = 2.5;
        this.ctx.say('It threw the hook and is gone. The line is still out', 5);
      }
      return;
    }
    // Twice a game second is often enough to look at the line.
    if (++this.ticks % 30) return;
    const w = this.water();
    const mode = this.mode = fishingMode(w);
    // Say what the line is doing when the boat settles to something new. The lure skipping is said once.
    if (mode === this.told) this.changed = 0;
    else if ((this.changed += 0.5) >= 8) {
      this.told = mode;
      this.changed = 0;
      if (mode !== 'skip' || !this.toldSkip) this.ctx.say(fishingAdvice(w), 6);
      if (mode === 'skip') this.toldSkip = true;
      this.toldWhy = fishingReason(w);
      this.whyFor = 0;
    }
    // And say so when the tide, the light or the birds change what the line can hope for.
    const why = mode === this.told ? fishingReason(w) : this.toldWhy;
    if (why === this.toldWhy) this.whyFor = 0;
    else if ((this.whyFor += 0.5) >= 10) {
      const was = this.toldWhy;
      this.toldWhy = why;
      this.whyFor = 0;
      if (why) this.ctx.say(why, 7);
      else if (was.startsWith('Slack water')) this.ctx.say('The tide is making again, and the bait is fishing', 5);
    }
    if (this.rest > 0) this.rest -= 0.5;
    const spell = Math.floor(this.ctx.seasonNow() / BITE_SPELL);
    if (spell === this.spell) return;
    this.spell = spell;
    if (this.rest > 0 || mode === 'skip') return;
    const bite = biteIn(w, spell);
    if (!bite) return;
    this.fish = bite;
    this.left = STRIKE_SECONDS;
    this.shown = false;
    this.ctx.alarm('Fish on. Press L to strike before it throws the hook');
  }

  update(dt: number, seaTime: number): void {
    if (this.late > 0) this.late -= dt;
    if (!this.out) return;
    this.shown = true;
    this.clock += dt;
    const { stage, boatView } = this.ctx;
    const ease = Math.min(1, dt * 1.5);
    this.stream += ((this.mode === 'still' ? 0 : 1) - this.stream) * ease;
    this.dip += ((this.fish ? 1 : 0) - this.dip) * Math.min(1, dt * 6);

    // The rod leans aft out of its holder. With a fish on it bends over and the tip works.
    const lift = 0.9 - 0.7 * this.dip + (this.fish ? Math.sin(this.clock * 17) * 0.06 : 0);
    this.aim.set(0.12, Math.sin(lift), Math.cos(lift)).normalize();
    this.rod.quaternion.setFromUnitVectors(UP, this.aim);
    this.tip.copy(this.aim).multiplyScalar(ROD_LENGTH - ROD_BUTT).add(this.foot);

    // Where the line meets the water: well astern when she is moving, close under the stern when she is not.
    const astern = 0.9 + 21 * this.stream;
    const under = 2.2 - 2 * this.stream;
    this.end.set(this.tip.x + 0.15 * this.stream, 0, this.tip.z + astern);
    boatView.root.localToWorld(this.end);
    this.end.y = stage.seaLevel(this.end.x, this.end.z, seaTime) - under;
    boatView.root.worldToLocal(this.end);
    const p = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    p.setXYZ(0, this.tip.x, this.tip.y, this.tip.z);
    p.setXYZ(1, this.end.x, this.end.y, this.end.z);
    p.needsUpdate = true;
  }

  status(): string {
    if (!this.out) return '';
    if (this.fish) return 'Fish on';
    return this.mode === 'still' ? 'Fishing' : '';
  }

  reboat(): void {
    // The rod goes to the same place on the new boat's stern rail.
    const d = this.ctx.spec.dimensions;
    this.foot.set(d.beam * 0.17, d.freeboard + 0.5, d.loa / 2 - 0.06);
    this.stand();
    this.rod.position.copy(this.foot);
    this.ctx.boatView.root.add(this.rig);
  }

  dispose(): void {
    this.ctx.boatView.root.remove(this.rig);
    this.rig.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Line)) return;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    });
  }
}
