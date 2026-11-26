import { KT } from '@slack-tide/sim';
import type { AboardContext, Feature } from './feature';
import { comfortNote, leverShare, runningWords, tankWarning } from './powerRules';
import { TenderSound } from './tenderSound';
import { TenderWake, type WakeMaker } from './tenderWake';

/** Seconds between two lines about a landing that hurt her. */
const HURT_AGAIN = 25;
/** Slams in the last minute that make it "pounding". */
const POUNDING = 5;

/**
 * A powerboat as her skipper meets her, beyond the engine's keys (those are `aboard/engine.ts`, the same I, full stop
 * and comma as a sailing boat's auxiliary). Here: what she is doing in words, the outboard's sound, spray off her
 * chines and the rooster tail astern once she is planing, what is said when a landing hurts her or she buries her
 * bow, and the tank's warnings. The boat herself is in the sim (`Sim.stepPower`); the words are in `powerRules.ts`.
 * Aboard a boat with sails this does nothing at all.
 *
 * For trolling, which comes next: `ctx.underWay()` gives her speed through the water, whether she is under power and
 * planing, and her rod holders as nodes of her model (`rod_port`, `rod_stbd`, `rod_ttop_1` and the rest: see
 * `boat/buildConsole.ts`). `Powerboat.comfortKt()` is the speed the sea allows on this heading.
 */
export class Powerboat implements Feature {
  readonly id = 'powerboat';

  private wake: TenderWake | null = null;
  private readonly sound: TenderSound;
  private readonly maker: WakeMaker = { x: 0, y: 0, heading: 0, speed: 0, plane: 0, throttle: 0, hop: 0, length: 6.7, halfBeam: 1, jet: false };
  private tick: number;
  private stuffs: number;
  private slams: number;
  private damage: number;
  private fuelWas: number;
  private hurtAt = -1e9;
  private clock = 0;
  private welcomed: boolean;
  private stopHearing: (() => void) | null = null;

  constructor(private readonly ctx: AboardContext) {
    const s = ctx.sim.state;
    this.tick = s.tick;
    this.stuffs = s.stuffs;
    this.slams = s.slams;
    this.damage = s.damage;
    this.fuelWas = this.fuelShare();
    this.sound = new TenderSound(ctx.sound);
    // Carrying on after a reload she needs no introduction.
    this.welcomed = s.t > 5 || !ctx.spec.power;
    if (ctx.spec.power) this.fitOut();
  }

  private fitOut(): void {
    const { ctx } = this;
    this.wake ??= new TenderWake(ctx.stage.scene, (x, z, t, n) => ctx.stage.seaLevel(x, z, t, n));
    // A hard landing throws water out from under her forefoot, each side.
    this.stopHearing ??= ctx.seaway.on((event, strength) => {
      if (event !== 'slam' || !ctx.sim.boat.power) return;
      const s = ctx.sim.state;
      const ahead = ctx.spec.dimensions.loa * 0.2;
      this.wake?.splash(s.x + Math.sin(s.heading) * ahead, ctx.stage.seaLevel(s.x, -s.y, s.t, 4), -(s.y + Math.cos(s.heading) * ahead), 0.4 + 0.6 * strength);
    });
  }

  private fuelShare(): number {
    const e = this.ctx.sim.boat.engine;
    return e ? this.ctx.sim.fuel / e.tankL : 1;
  }

  /** True while she is being thrown off the wave tops again and again. */
  get pounding(): boolean {
    return this.ctx.seaway.slamsLately >= POUNDING;
  }

  /** The fastest the sea lets her go on this heading without leaving the water, knots. Her top speed in flat water; 0 aboard a boat with sails. */
  comfortKt(): number {
    return this.ctx.sim.boat.power ? this.ctx.sim.out.comfort / KT : 0;
  }

  /** The sea's verdict on her speed, for the readout's second line. Empty when there is nothing to say. */
  seaNote(): string {
    const p = this.ctx.sim.boat.power;
    return p && this.ctx.sim.state.hold === 'none' ? comfortNote(p, this.ctx.sim.state, this.ctx.sim.out) : '';
  }

  update(dt: number, seaTime: number): void {
    const { ctx } = this;
    const { sim } = ctx;
    const p = sim.boat.power;
    const s = sim.state;
    const o = sim.out;
    if (!p) {
      this.sound.update('none', -1, 0);
      this.wake?.update(null, dt, seaTime);
      return;
    }
    const running = s.tick !== this.tick;
    this.tick = s.tick;
    this.clock += dt;
    const away = !!ctx.feature('kayak')?.focus?.();

    if (!this.welcomed && this.clock > 2.5) {
      this.welcomed = true;
      ctx.say('The engine is running, out of gear. The full stop key opens the throttle a step and the comma key closes it: hold either. A and D turn the wheel. I stops the engine', 12);
    }

    // The outboard: revs from the lever, load from how hard it is pushing, and lighter while she is in the air.
    const revs = p.curve.rpm;
    const share = s.engineOn ? leverShare(p, s.throttle) : 0;
    const note = s.engineOn ? Math.max(0, (o.engineRpm - p.idleRpm) / (revs[revs.length - 1] - p.idleRpm)) : s.engineCrank > 0 ? 0 : -1;
    this.sound.update(running || s.engineOn ? 'outboard' : 'none', running ? note : -1, share * (1 - 0.7 * o.air), away ? 0.35 : 1, true);

    // Spray off the chines once she is planing, and a rooster tail when she is driven hard.
    const m = this.maker;
    m.x = s.x; m.y = s.y; m.heading = s.heading; m.speed = s.speed;
    m.plane = o.plane; m.throttle = share; m.hop = o.air > 0.6 ? 0.3 : 0;
    m.length = sim.boat.dimensions.loa; m.halfBeam = sim.boat.dimensions.beam * 0.42;
    m.jet = o.plane > 0.9 && share > 0.4;
    this.wake?.update(running && s.hold === 'none' ? m : null, running ? dt : 0, seaTime);

    // She has buried her bow in the back of a wave.
    if (s.stuffs > this.stuffs) {
      ctx.stage.spray.kick(1);
      ctx.sound.thud(0.7);
      ctx.drone.shake(0.6);
      this.wake?.splash(s.x + Math.sin(s.heading) * m.length * 0.45, ctx.stage.seaLevel(s.x, -s.y, seaTime, 4), -(s.y + Math.cos(s.heading) * m.length * 0.45), 1);
      ctx.alarm('She has run her bow into the back of a wave and stopped in a wall of water. Going down sea, keep her no faster than the waves ahead will let her climb');
    }
    this.stuffs = s.stuffs;

    // A landing that hurt. Collisions say their own piece (`aboard/contact.ts`): this is for the sea and the bottom.
    const hurt = s.damage - this.damage;
    if (hurt > 0.0005 && s.damage < 1 && (s.slams > this.slams || o.impact > 1.2) && this.clock - this.hurtAt > HURT_AGAIN && !o.aground) {
      this.hurtAt = this.clock;
      ctx.alarm(`That landing hurt her: hull ${Math.max(1, Math.round(s.damage * 100))}% damaged. Ease the throttle with the comma key${o.comfort / KT < 38 ? `: about ${Math.max(6, Math.floor(o.comfort / KT))} kt is what this sea allows on this heading` : ''}`);
    }
    this.damage = s.damage;
    this.slams = s.slams;

    const fuel = this.fuelShare();
    const warn = tankWarning(sim.boat, this.fuelWas, fuel);
    if (warn) {
      if (warn.urgent) ctx.alarm(warn.text);
      else ctx.say(warn.text, 8);
    }
    this.fuelWas = fuel;

    // The rod standing in the starboard holder is the one the fishing line is fished from: not both at once.
    const holder = ctx.boatView.model.nodes.rod_stbd;
    const spare = holder?.getObjectByName('rod');
    if (spare) spare.visible = !(ctx.boatView.root.getObjectByName('fishing_rod')?.visible ?? false);
  }

  status(): string {
    const { sim } = this.ctx;
    const p = sim.boat.power;
    if (!p || sim.state.hold !== 'none') return '';
    return runningWords(p, sim.state, sim.out, this.pounding);
  }

  /** How she is running goes out with her position: tenths on the plane, for whoever draws her. */
  wire(): Record<string, unknown> {
    return this.ctx.sim.boat.power ? { pl: Math.round(this.ctx.sim.out.plane * 10) } : {};
  }

  reboat(): void {
    if (this.ctx.spec.power) this.fitOut();
  }

  dispose(): void {
    this.stopHearing?.();
    this.wake?.dispose();
    this.sound.dispose();
  }
}
