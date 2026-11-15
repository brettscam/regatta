import { onMyAvatar } from '../boat/avatar';
import * as THREE from 'three';
import { VIEWS, type ViewPreset } from '../camera/drone';
import type { Place } from '../session';
import type { AboardContext, Feature } from './feature';
import { stamp } from './visited';
import { KAYAK_HALF_BEAM, KAYAK_LENGTH, KayakModel } from './kayakModel';
import { KAYAK_WAKE, kayakCapsizes } from '../scene/wakeField';
import { call, fendOff, groundHeight, heldBackBy, launchSpot, madeGood, newCraft, placeInReach, rangeAndBearing, stepCraft, touchingShore, BOARD_RANGE, type Craft, type HeightGrid, type Hulk, type Paddling, type Water } from './paddle';

const KT = 0.514444;
/** The drone's place over the kayak: lower and much closer than over the yacht, off her port quarter so the yacht shows beyond her. */
const KAYAK_VIEW: ViewPreset = { target: [0, 0.9, -0.3], yaw: -0.58, pitch: 0.27, dist: 9.5 };
/** Ground this far under the still sea is where she takes the bottom. */
const SHOAL = -0.22;
/** Length of the painter she lies to astern of the yacht. */
const PAINTER = 3.5;
/** Seconds a capsize costs: over she goes, and the paddler gets back in. The first part of it is the roll itself. */
const SWIM = 7;
const ROLL = 1.6;

type Mode = 'stowed' | 'afloat' | 'ashore';
const three = (deg: number): string => `${String(deg).padStart(3, '0')}°`;
const tens = (m: number): number => Math.max(10, Math.round(m / 10) * 10);

/**
 * The kayak kayak. With the yacht at anchor or on a mooring, O launches her, the paddling keys drive her,
 * O lands her at a shore or a dock, and O alongside the yacht brings the player back aboard.
 * The paddling itself and the rules for landing are in `paddle.ts`. The kayak and her paddler are drawn by `kayakModel.ts`.
 */
export class Kayak implements Feature {
  readonly id = 'kayak';
  /** Stowed: nobody in her, lying astern of the yacht or lashed down. Afloat: the player is paddling. Ashore: drawn up, the player gone for a drink. */
  mode: Mode = 'stowed';
  /** Where she is. The numbers only mean something when she is not stowed. */
  readonly kayak: Craft = newCraft(0, 0, 0);
  /** Paddle without the keys, for play testing from the console: `regatta.features.find(f => f.id === 'kayak').drive = { ahead: 1, steer: 0 }`. */
  drive: Paddling | null = null;

  private readonly model: KayakModel;
  private readonly painter: THREE.Mesh;
  private readonly ground: HeightGrid | null;
  private readonly water: Water;
  /** The place the player is ashore at, or null on a bare beach. */
  private at: Place | null = null;
  /** Where she floated before she was hauled up the beach, to go back to on shoving off. */
  private afloatAt: { x: number; y: number } | null = null;
  /** Places and the yacht, once each has been pointed out on this approach. */
  private told: string | null = null;
  private toldBoat = true;
  private think = 0;
  /** What the paddler is doing now, for the remarks. */
  private input: Paddling = { ahead: 0, steer: 0 };
  /** Said once each time she runs out of wind. */
  private toldBlown = false;
  /** Seconds she has been paddling and going astern over the ground, and real seconds until that may be remarked on again. */
  private losing = 0;
  private toldLosing = 0;
  /** The passing of a ship whose wake has been warned of, and the one that last put her over. */
  private wakeWarned = '';
  private wakeDunked = '';
  /** Seconds left of a capsize. No paddling meanwhile. */
  private swim = 0;
  private readonly motion = { heave: 0, pitch: 0, heel: 0, set: false };
  private readonly tow = { x: 0, y: 0, heading: 0, out: false };
  private lastTick = -1;
  private stall = 0;
  private clock = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(private readonly ctx: AboardContext) {
    this.model = new KayakModel(ctx.livery.topsides, ctx.livery.avatar);
    // The skipper changed her kit on the profile: the paddler is the same person, and so is the figure at the yacht's wheel.
    if (ctx.livery.avatar) onMyAvatar((a) => { this.model.setAvatar(a); ctx.boatView.setAvatar(a); });
    this.model.root.visible = false;
    ctx.stage.scene.add(this.model.root);
    this.painter = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5), new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.9 }));
    this.painter.visible = false;
    ctx.stage.scene.add(this.painter);

    // The shore she stops at is the one that is drawn. The land is drawn from its own, finer grid of heights, and the depth chart's
    // shoreline can be most of a cell away from it, so the kayak reads the land's shape and falls back on the chart only without it.
    this.ground = readGround(ctx);
    const world = ctx.world;
    this.water = {
      current: (x, y) => world.current(x, y, ctx.sim.state.t),
      wind: (x, y) => world.gustyWind(x, y, ctx.sim.state.t),
      land: (x, y) => this.land(x, y),
      // The chart's depth with the tide on it. Where the drawn shore reaches out past the chart's, call it a foot of water.
      depth: (x, y) => Math.max(0.3, world.depth(x, y, ctx.sim.state.t)),
    };
  }

  private land(x: number, y: number): boolean {
    return this.ground ? groundHeight(this.ground, x, y) > SHOAL : this.ctx.world.chartDepth(x, y) <= 0;
  }

  private yacht(): Hulk {
    const s = this.ctx.sim.state;
    const d = this.ctx.spec.dimensions;
    return { x: s.x, y: s.y, heading: s.heading, loa: d.loa, beam: d.beam };
  }

  // ---- the O key --------------------------------------------------------------------------------

  key(code: string): boolean {
    const { ctx } = this;
    if (code === 'KeyX' && this.mode !== 'stowed') {
      // Nobody is aboard to work the windlass.
      ctx.say('The anchor is worked from the boat. Paddle back and come aboard first');
      return true;
    }
    if (code !== 'KeyO') return false;

    if (this.mode === 'stowed') {
      if (ctx.sim.state.hold === 'none') {
        ctx.say('The kayak stays lashed down under way. Anchor or pick up a mooring first, then O launches her', 6);
        return true;
      }
      this.launch();
      return true;
    }

    if (this.mode === 'ashore') {
      this.shoveOff();
      return true;
    }

    const c = this.kayak;
    const what = call(c, ctx.sim.state, ctx.places, this.water.land);
    if (what.do === 'board') this.comeAboard('Back aboard. The kayak is made fast astern');
    else if (what.do === 'land') this.goAshore(what.place);
    else if (what.do === 'slow') ctx.say(`Too much way on to land: ${(what.speed / KT).toFixed(1)} kt. Let her run off first`);
    else if (what.far) ctx.say(`Nothing to land on here. The boat is ${tens(what.range)} m off, bearing ${three(what.bearing)}`, 6);
    else ctx.say('Nothing to land on here. Paddle in to a shore or a dock, or back alongside the boat', 6);
    return true;
  }

  private launch(): void {
    const { ctx } = this;
    const spot = launchSpot(this.yacht(), this.water.land);
    Object.assign(this.kayak, newCraft(spot.x, spot.y, spot.heading));
    this.mode = 'afloat';
    this.at = null;
    this.told = null;
    this.toldBoat = true;
    this.motion.set = false;
    this.model.setManned(true);
    this.model.root.visible = true;
    this.painter.visible = false;
    // Whoever was at the wheel is in the kayak now.
    this.helm(false);
    ctx.drone.flyTo(KAYAK_VIEW, 1.6);
    this.toldBlown = false;
    this.swim = 0;
    this.losing = 0;
    this.toldLosing = 0;
    ctx.say('Kayak away. W paddles, Shift with W sprints for a short while, S backs, A and D steer. O lands her or brings you back aboard', 9);
  }

  private goAshore(place: Place | null): void {
    const { ctx } = this;
    this.mode = 'ashore';
    this.at = place;
    this.kayak.speed = 0;
    this.kayak.turn = 0;
    this.model.setManned(false);
    this.haulUp();
    if (place?.ashore) {
      // The first time ever at this place, on this device: a stamp on the bar-hop card and one more in the logbook.
      if (stamp(place.id)) ctx.logbook.count('ashore');
      ctx.say(`Ashore at ${place.ashore.name}. ${place.ashore.say}`, 9);
    } else ctx.say('Ashore on the beach. O shoves off', 6);
  }

  private shoveOff(): void {
    const { ctx } = this;
    const from = this.at?.ashore?.name;
    this.mode = 'afloat';
    this.at = null;
    if (this.afloatAt) Object.assign(this.kayak, this.afloatAt);
    this.afloatAt = null;
    // The place she has just left needs no pointing out.
    this.told = placeInReach(this.kayak, ctx.places, true)?.id ?? null;
    this.model.setManned(true);
    const back = rangeAndBearing(this.kayak.x, this.kayak.y, ctx.sim.state.x, ctx.sim.state.y);
    ctx.say(`Shoved off${from ? ` from ${from}` : ''}. The boat is ${tens(back.range)} m off, bearing ${three(back.bearing)}`, 6);
  }

  /** If she came in bow first onto a beach, pull her a couple of metres up it so she is not left to the swell. */
  private haulUp(): void {
    const { kayak, ground } = this;
    this.afloatAt = null;
    if (!ground) return;
    const fx = Math.sin(kayak.heading);
    const fy = Math.cos(kayak.heading);
    const bow = KAYAK_LENGTH * 0.5;
    if (!this.land(kayak.x + fx * (bow + 0.4), kayak.y + fy * (bow + 0.4))) return;
    let pull = 0;
    for (let d = 0.25; d <= 2.5; d += 0.25) {
      // Not up a bank or a sea wall.
      if (groundHeight(ground, kayak.x + fx * (bow + d), kayak.y + fy * (bow + d)) > 1.1) break;
      pull = d;
    }
    if (pull === 0) return;
    this.afloatAt = { x: kayak.x, y: kayak.y };
    kayak.x += fx * pull;
    kayak.y += fy * pull;
  }

  private comeAboard(words: string, urgent = false): void {
    const { ctx } = this;
    this.mode = 'stowed';
    this.at = null;
    this.afloatAt = null;
    this.tow.out = false;
    this.model.setManned(false);
    this.helm(true);
    ctx.drone.flyTo(VIEWS.drone, 1.6);
    if (urgent) ctx.alarm(words);
    else ctx.say(words);
  }

  /** Show or hide the figure at the yacht's wheel. */
  private helm(aboard: boolean): void {
    const figure = this.ctx.boatView.model.nodes.crew_helm;
    if (figure) figure.visible = aboard;
  }

  // ---- every frame ------------------------------------------------------------------------------

  update(dt: number, seaTime: number): void {
    const { ctx, kayak } = this;
    const sim = ctx.sim;
    this.clock += dt;
    // The session does not say when it is paused, but a paused sim takes no steps.
    if (sim.state.tick !== this.lastTick) {
      this.lastTick = sim.state.tick;
      this.stall = 0;
    } else this.stall += dt;
    const frozen = this.stall > 0.08;
    const held = sim.state.hold !== 'none';

    // If the yacht gets under way with the player off her, the player is put back at the wheel rather than left behind.
    if (this.mode !== 'stowed' && !held) this.comeAboard('The boat is under way. You are back aboard and the kayak is stowed', true);

    if (this.mode === 'stowed') {
      this.model.root.visible = held;
      this.painter.visible = held;
      if (!held) {
        this.tow.out = false;
        return;
      }
      this.trail(frozen ? 0 : dt);
      this.float(this.tow.x, this.tow.y, this.tow.heading, dt, seaTime);
      this.rig();
      return;
    }

    let input: Paddling = { ahead: 0, steer: 0 };
    if (this.mode === 'afloat' && !frozen) {
      this.swim = Math.max(0, this.swim - dt);
      this.wakes();
      input = this.input = this.swim > 0 ? { ahead: 0, steer: 0 } : this.drive ?? this.keys();
      stepCraft(kayak, input, dt, this.water, this.yacht());
      this.toldLosing -= dt;
      this.think -= dt;
      if (this.think <= 0) {
        this.think = 0.5;
        this.pointOut();
      }
    }
    this.float(kayak.x, kayak.y, kayak.heading, dt, seaTime);
    // A sprint is a faster stroke, not a longer one.
    this.model.animate(frozen ? 0 : dt * (input.sprint && input.ahead > 0 && !kayak.blown ? 1.45 : 1), input.ahead, input.steer, this.clock);
  }

  /**
   * A ship's wake and the kayak. A warning while it is still on its way, and if it is big and she takes it beam-on,
   * over she goes: a roll, a few seconds in the water, and the paddler winded. Bow or stern to it, she rides over.
   * The wake itself is the same one every player has (`scene/wakeField.ts`); it lifts and rolls her through `stage.seaLevel`.
   */
  private wakes(): void {
    const { ctx, kayak } = this;
    const sw = ctx.seaway;
    if (!sw.wakeId || kayak.beached) return;
    const w = sw.wake;
    if (w.arriveIn > 0 && w.arriveIn < KAYAK_WAKE.warnAhead && w.peak >= KAYAK_WAKE.warn && this.wakeWarned !== sw.wakeId) {
      this.wakeWarned = sw.wakeId;
      ctx.alarm(`Ship's wake coming, turn into it: ${sw.wakeFrom}, ${w.peak.toFixed(1)} m, here in ${Math.max(5, Math.round(w.arriveIn / 5) * 5)} s`);
    }
    if (this.swim > 0 || this.wakeDunked === sw.wakeId || !kayakCapsizes(w.height, kayak.heading, w.dirX, w.dirY)) return;
    this.wakeDunked = sw.wakeId;
    this.swim = SWIM;
    kayak.speed = 0;
    kayak.turn = 0;
    kayak.puff = 0;
    kayak.blown = true;
    // Blown is said here, in the same breath.
    this.toldBlown = true;
    ctx.alarm(`Capsized. ${sw.wakeFrom}'s wake caught her beam-on, ${w.height.toFixed(1)} m of it. You are back in her, soaked and winded. Next time turn her bow into it`);
  }

  private keys(): Paddling {
    const h = this.ctx.held;
    const on = (a: string, b: string) => (h(a) || h(b) ? 1 : 0);
    return { ahead: on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown'), steer: on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft'), sprint: on('ShiftLeft', 'ShiftRight') === 1 };
  }

  /** Paddle for a while without the keys or the frame clock. For play testing from the console. */
  paddle(input: Paddling, seconds: number): void {
    if (this.mode !== 'afloat') return;
    for (let t = 0; t < seconds; t += 0.1) stepCraft(this.kayak, input, 0.1, this.water, this.yacht());
  }

  /** A word when the paddler is spent, and when the tide or the wind is more than she can paddle against. */
  private effort(): void {
    const { ctx, kayak, input } = this;
    if (kayak.blown && !this.toldBlown) ctx.say('You are blown. Drop back to a cruising stroke and get your wind back', 6);
    this.toldBlown = kayak.blown;
    // Paddling ahead and going astern over the ground, for a few seconds together.
    if (input.ahead > 0 && !kayak.beached && madeGood(kayak, this.water) < -0.05) this.losing += 0.5;
    else this.losing = 0;
    if (this.losing < 4 || this.toldLosing > 0) return;
    this.toldLosing = 90;
    if (heldBackBy(kayak, this.water) === 'tide') {
      const s = this.water.current(kayak.x, kayak.y);
      ctx.say(`The tide is running ${(Math.hypot(s.x, s.y) / KT).toFixed(1)} kt against you, more than she can paddle: she is going astern over the ground. Work the eddies close inshore, or wait for it to ease`, 9);
    } else ctx.say('This wind is more than she can be paddled into. Get under the lee of the land, or turn and run back', 8);
  }

  /** A word when a landing or the yacht comes within reach, once per approach. */
  private pointOut(): void {
    const { ctx, kayak } = this;
    this.effort();
    const place = placeInReach(kayak, ctx.places, kayak.beached || touchingShore(kayak.x, kayak.y, this.water.land));
    if (place?.ashore && place.id !== this.told) ctx.say(`${capital(place.ashore.name)} is close by. Ease up and press O to go ashore`, 6);
    this.told = place?.id ?? null;

    const off = Math.hypot(kayak.x - ctx.sim.state.x, kayak.y - ctx.sim.state.y);
    if (off > 40) this.toldBoat = false;
    else if (off <= BOARD_RANGE && !this.toldBoat) {
      this.toldBoat = true;
      ctx.say('Alongside. O to come back aboard');
    }
  }

  /** The empty kayak lies to her painter astern of the yacht, streaming with the tide and the wind as the yacht does. */
  private trail(dt: number): void {
    const { tow } = this;
    const yacht = this.yacht();
    const fx = Math.sin(yacht.heading);
    const fy = Math.cos(yacht.heading);
    const sx = yacht.x - fx * (yacht.loa * 0.5 - 0.2);
    const sy = yacht.y - fy * (yacht.loa * 0.5 - 0.2);
    const reach = PAINTER + KAYAK_LENGTH * 0.5;
    if (!tow.out) {
      tow.out = true;
      tow.x = sx - fx * reach;
      tow.y = sy - fy * reach;
      tow.heading = yacht.heading;
      this.motion.set = false;
    }
    const stream = this.water.current(tow.x, tow.y);
    const cx = stream.x;
    const cy = stream.y;
    const wind = this.water.wind(tow.x, tow.y);
    tow.x += (cx - Math.sin(wind.dir) * wind.speed * 0.03) * dt;
    tow.y += (cy - Math.cos(wind.dir) * wind.speed * 0.03) * dt;
    // The painter comes taut.
    let dx = tow.x - sx;
    let dy = tow.y - sy;
    const d = Math.hypot(dx, dy) || 1;
    if (d > reach) {
      tow.x = sx + (dx / d) * reach;
      tow.y = sy + (dy / d) * reach;
    }
    const hull = { x: tow.x, y: tow.y, heading: tow.heading, speed: 0, turn: 0, beached: false };
    fendOff(hull, { ...yacht, beam: yacht.beam + 1.2 });
    tow.x = hull.x;
    tow.y = hull.y;
    // She points up her painter.
    dx = sx - tow.x;
    dy = sy - tow.y;
    const want = Math.atan2(dx, dy);
    tow.heading += Math.atan2(Math.sin(want - tow.heading), Math.cos(want - tow.heading)) * Math.min(1, dt * 1.5);
  }

  /** Draw the painter from the yacht's stern to the kayak's bow. */
  private rig(): void {
    const { ctx, a, b } = this;
    const d = ctx.spec.dimensions;
    ctx.boatView.root.updateMatrixWorld(true);
    this.model.root.updateMatrixWorld(true);
    a.set(0, d.freeboard * 0.85, d.loa * 0.5 - 0.25);
    ctx.boatView.root.localToWorld(a);
    b.set(0, 0.3, -KAYAK_LENGTH * 0.5 + 0.12);
    this.model.root.localToWorld(b);
    const len = a.distanceTo(b) || 1e-3;
    this.painter.position.copy(a).lerp(b, 0.5);
    this.painter.scale.set(1, len, 1);
    this.painter.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, b.sub(a).multiplyScalar(1 / len));
  }

  /** Sit her on the sea, or on the beach where the ground comes up under her. */
  private float(x: number, y: number, heading: number, dt: number, seaTime: number): void {
    const { ctx, motion, ground } = this;
    const z = -y;
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const under = (px: number, pz: number): number => {
      const sea = ctx.stage.seaLevel(px, pz, seaTime, 6);
      return ground ? Math.max(sea, groundHeight(ground, px, -pz) + 0.1) : sea;
    };
    const half = KAYAK_LENGTH * 0.36;
    const bow = under(x + fx * half, z + fz * half);
    const stern = under(x - fx * half, z - fz * half);
    const mid = under(x, z);
    const port = under(x + fz * KAYAK_HALF_BEAM * 2, z - fx * KAYAK_HALF_BEAM * 2);
    const heave = (bow + stern + 2 * mid) / 4;
    const pitch = Math.atan2(bow - stern, half * 2) * 0.9;
    const heel = Math.atan2(port - mid, KAYAK_HALF_BEAM * 2) * 0.6;
    const ease = motion.set ? Math.min(1, dt * 7) : 1;
    motion.set = true;
    motion.heave += (heave - motion.heave) * ease;
    motion.pitch += (pitch - motion.pitch) * ease;
    motion.heel += (heel - motion.heel) * ease;
    // Capsizing, she goes right round.
    const over = this.mode === 'afloat' && this.swim > SWIM - ROLL ? ((SWIM - this.swim) / ROLL) * Math.PI * 2 : 0;
    this.model.place(x, motion.heave + 0.01, z, heading, motion.pitch, motion.heel + over);
  }

  // ---- what the session asks -------------------------------------------------------------------

  status(): string {
    if (this.mode === 'afloat') return 'In the kayak';
    if (this.mode === 'ashore') return this.at?.ashore ? `Ashore at ${this.at.ashore.name}` : 'Ashore on the beach';
    return '';
  }

  focus(): { x: number; y: number; heading: number; height: number } | null {
    if (this.mode === 'stowed') return null;
    return { x: this.kayak.x, y: this.kayak.y, heading: this.kayak.heading, height: this.motion.heave };
  }

  /** `oc` is the kayak when she is away from the yacht: metres east, metres north, heading in thousandths of a radian. Null when she is not. */
  wire(): Record<string, unknown> {
    if (this.mode === 'stowed') return { oc: null };
    return { oc: [Math.round(this.kayak.x), Math.round(this.kayak.y), Math.round(this.kayak.heading * 1000)] };
  }

  dispose(): void {
    this.helm(true);
    this.model.dispose();
    this.painter.removeFromParent();
    this.painter.geometry.dispose();
    (this.painter.material as THREE.Material).dispose();
  }
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The heights the land is drawn from, read back off the terrain's own mesh, so the kayak grounds exactly where the picture says. */
function readGround(ctx: AboardContext): HeightGrid | null {
  const mesh = ctx.stage.scene.getObjectByName('terrain') as THREE.Mesh | undefined;
  const position = mesh?.geometry?.getAttribute('position');
  const g = ctx.stage.course.terrain;
  if (!position || position.count !== g.nx * g.ny) return null;
  return { x0: g.x0, y0: g.y0, dx: g.dx, nx: g.nx, ny: g.ny, data: position.array, stride: 3, offset: 1 };
}
