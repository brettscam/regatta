import { onMyAvatar } from '../boat/avatar';
import * as THREE from 'three';
import { VIEWS, type ViewPreset } from '../camera/drone';
import type { Place } from '../session';
import { overlap, type Hull } from './contactRules';
import type { AboardContext, Feature } from './feature';
import { stamp } from './visited';
import { KAYAK_WAKE, kayakCapsizes } from '../scene/wakeField';
import type { WakeVessel } from '../scene/wake';
import { BAIL_SECONDS, SHOAL_DEPTH, cruiseThrottle, minutesLeft, newMotor, stepMotor, type Motor, type MotorWater } from './motor';
import { call, fendOff, groundHeight, heldBackBy, launchSpot, madeGood, newCraft, placeInReach, rangeAndBearing, stepCraft, touchingShore, BOARD_RANGE, type Craft, type HeightGrid, type Hulk, type Paddling } from './paddle';
import { TenderFleet, newRide, sit } from './tenderFleet';
import { Swimmer, buildTender, type TenderModel } from './tenderModel';
import { TenderSound } from './tenderSound';
import { TenderWake } from './tenderWake';
import { BUMP_SPEED, HarbourWatch, bumpWord, nextTender, packTender, saveTender, savedTender, speedingPast, tenderFor, tendersFor, type TenderSpec, type Zone } from './tenders';

const KT = 0.514444;
/** The drone's place over each tender: lower and much closer than over the yacht, off her port quarter so the yacht shows beyond her. The fast ones are followed from further astern. */
const TENDER_VIEW: Record<string, ViewPreset> = {
  kayak: { target: [0, 0.9, -0.3], yaw: -0.58, pitch: 0.27, dist: 9.5 },
  skiff: { target: [0, 1.0, -0.4], yaw: -0.42, pitch: 0.25, dist: 12.5 },
  runner: { target: [0, 1.1, -0.6], yaw: -0.3, pitch: 0.22, dist: 14 },
};
/** Length of the painter she lies to astern of the yacht. */
const PAINTER = 3.5;
/** How near another boat's tender is heard. */
const EARSHOT = 260;
/** Seconds a capsize costs: over she goes, and the paddler gets back in. The first part of it is the roll itself. */
const SWIM = 7;
const ROLL = 1.6;
/** Within this of a venue's guest float, metres, a tender can be made fast to it and the crew steps up. */
const GUEST_DOCK = 18;

type Mode = 'stowed' | 'afloat' | 'ashore';
const three = (deg: number): string => `${String(deg).padStart(3, '0')}°`;
const tens = (m: number): number => Math.max(10, Math.round(m / 10) * 10);
const isMotor = (c: Craft): c is Motor => 'throttle' in c;

/**
 * The yacht's tender: a kayak, a skiff with an outboard, or a wave runner on the biggest boats (`tenders.ts` has the table).
 * With the yacht at anchor or on a mooring, O launches her, the steering keys drive her, O lands her at a shore or a dock,
 * and O alongside the yacht brings the player back aboard. Shift+O, aboard, changes which tender she carries.
 * The kayak's paddling and the rules for landing are in `paddle.ts`, the powered ones' going in `motor.ts`. The models are
 * `kayakModel.ts` and `tenderModel.ts`; the other boats' tenders are drawn by `tenderFleet.ts`.
 * The feature keeps the name it had when the kayak was the only one: other features ask for it by `kayak`.
 */
export class Kayak implements Feature {
  readonly id = 'kayak';
  /** Stowed: nobody in her, on the yacht or lying astern. Afloat: the player is in her. Ashore: drawn up, the player gone for a drink. */
  mode: Mode = 'stowed';
  /** Which tender she is. */
  spec: TenderSpec;
  /** Where she is. The numbers only mean something when she is not stowed. Always the same object for one tender. */
  kayak: Craft | Motor;
  /** Drive her without the keys, for play testing from the console: `regatta.features.find(f => f.id === 'kayak').drive = { ahead: 1, steer: 0 }`. */
  drive: Paddling | null = null;
  /** The other boats' tenders. */
  readonly others: TenderFleet;

  private model!: TenderModel;
  private wake: TenderWake | null = null;
  private swimmer: Swimmer | null = null;
  private readonly noise: TenderSound;
  private readonly heard: TenderSound;
  private readonly painter: THREE.Mesh;
  /** The stern platform a wave runner lives on. Hung on the yacht while she carries one. */
  private readonly platform: THREE.Mesh;
  private readonly ground: HeightGrid | null;
  private readonly water: MotorWater;
  /** The place the player is ashore at, or null on a bare beach. */
  private at: Place | null = null;
  /** Where she floated before she was hauled up the beach, to go back to on shoving off. */
  private afloatAt: { x: number; y: number } | null = null;
  /** Places and the yacht, once each has been pointed out on this approach. */
  private told: string | null = null;
  private toldBoat = true;
  private think = 0;
  /** What the hands are doing now, for the remarks. */
  private input: Paddling = { ahead: 0, steer: 0 };
  /** Said once each time she runs out of wind. */
  private toldBlown = false;
  /** Seconds she has been paddling and going astern over the ground, and real seconds until that may be remarked on again. */
  private losing = 0;
  private toldLosing = 0;
  /** What has been said about the powered tender on this trip, so each thing is said once. */
  private readonly said = { plane: false, shoal: false, shipping: false, quarter: false, dry: false, swamped: false, jumps: 0, spills: 0, swamps: 0, grounds: 0, thrown: false };
  private readonly harbour = new HarbourWatch();
  /** The passing of a ship whose wake has been warned of, and the one that last put her over or filled her. */
  private wakeWarned = '';
  private wakeDunked = '';
  /** Seconds left of a capsize. No paddling meanwhile. */
  private swim = 0;
  /** This tender as the drawn wakes and spray see her (`stage.craft`). */
  private readonly drawn: WakeVessel = { id: 'own-tender', x: 0, z: 0, heading: 0, speed: 0, length: 3, beam: 1, lee: 0 };
  private zones: Zone[] = [];
  /** Seconds until another bump may be called. */
  private bumped = 0;
  private readonly ride = newRide();
  private readonly tow = { x: 0, y: 0, heading: 0, out: false };
  /** How the stowed tender is drawn now: on the yacht, astern on her painter, or not at all. */
  private berth: 'deck' | 'platform' | 'astern' | 'none' = 'none';
  private lastTick = -1;
  private stall = 0;
  private clock = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly hullA: Hull = { x: 0, y: 0, heading: 0, length: 1, beam: 1 };
  private readonly hullB: Hull = { x: 0, y: 0, heading: 0, length: 1, beam: 1 };

  constructor(private readonly ctx: AboardContext) {
    this.spec = tenderFor(savedTender(), this.yachtFeet());
    this.kayak = this.fresh(0, 0, 0);
    this.noise = new TenderSound(ctx.sound);
    this.heard = new TenderSound(ctx.sound);
    // The skipper changed her kit on the profile: whoever is in the tender is the same person, and so is the figure at the yacht's wheel.
    if (ctx.livery.avatar) onMyAvatar((a) => { this.model.setAvatar(a); this.swimmer?.setAvatar(a); ctx.boatView.setAvatar(a); });
    this.painter = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5), new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.9 }));
    this.painter.visible = false;
    ctx.stage.scene.add(this.painter);
    this.platform = new THREE.Mesh(new THREE.BoxGeometry(1, 0.07, 1), new THREE.MeshStandardMaterial({ color: 0xb48a55, roughness: 0.7 }));
    this.platform.name = 'tender_platform';
    this.platform.castShadow = this.platform.receiveShadow = true;

    // The shore she stops at is the one that is drawn. The land is drawn from its own, finer grid of heights, and the depth chart's
    // shoreline can be most of a cell away from it, so the tender reads the land's shape and falls back on the chart only without it.
    this.ground = readGround(ctx);
    const world = ctx.world;
    this.water = {
      current: (x, y) => world.current(x, y, ctx.sim.state.t),
      wind: (x, y) => world.gustyWind(x, y, ctx.sim.state.t),
      land: (x, y) => this.land(x, y),
      // The chart's depth with the tide on it. Where the drawn shore reaches out past the chart's, call it a foot of water.
      depth: (x, y) => Math.max(0.3, world.depth(x, y, ctx.sim.state.t)),
      shoal: (x, y) => this.thin(x, y, SHOAL_DEPTH),
      // A ship's wake (the same one every player meets, `scene/wakeField.ts`), or the arms of a yacht's.
      wake: (x, y) => Math.max(Math.min(1, (ctx.stage.wakes.strongest(x, y)?.hit.height ?? 0) / 0.8), this.wakeAt(x, y)),
    };
    this.others = new TenderFleet(ctx, this.ground);
    this.build();
  }

  private yachtFeet(): number {
    return this.ctx.spec.lengthFt ?? this.ctx.spec.dimensions.loa / 0.3048;
  }

  private fresh(x: number, y: number, heading: number): Craft | Motor {
    return this.spec.drive === 'paddle' ? newCraft(x, y, heading) : newMotor(x, y, heading, this.spec.tankL ?? 0);
  }

  /** Build the model for the tender she carries now, and what goes with it. */
  private build(): void {
    const { ctx } = this;
    this.model?.dispose();
    this.wake?.dispose();
    this.wake = null;
    this.swimmer?.dispose();
    this.swimmer = null;
    this.model = buildTender(this.spec, ctx.livery.topsides, ctx.livery.avatar);
    this.model.root.visible = false;
    if (this.spec.drive !== 'paddle') this.wake = new TenderWake(ctx.stage.scene, (x, z, t, n) => ctx.stage.seaLevel(x, z, t, n));
    if (this.spec.spillG) {
      this.swimmer = new Swimmer(ctx.livery.avatar);
      ctx.stage.scene.add(this.swimmer.root);
    }
    this.berth = 'none';
    this.tow.out = false;
    this.hangPlatform();
  }

  /** The platform across the stern that a wave runner sits on, on the boat she is in now. */
  private hangPlatform(): void {
    this.platform.removeFromParent();
    if (this.spec.stow !== 'platform') return;
    const d = this.ctx.spec.dimensions;
    this.platform.scale.set(Math.min(d.beam * 0.78, this.model.length + 0.3), 1, 1.5);
    this.platform.position.set(0, 0.3, d.loa * 0.5 + 0.62);
    this.ctx.boatView.root.add(this.platform);
  }

  /** Change the tender she carries. Only with it stowed. */
  private setTender(spec: TenderSpec): void {
    this.spec = spec;
    this.kayak = this.fresh(0, 0, 0);
    this.build();
  }

  /** Too little water for this tender to float in. */
  private land(x: number, y: number): boolean {
    return this.thin(x, y, this.spec.draught);
  }

  private thin(x: number, y: number, depth: number): boolean {
    if (this.ground) return groundHeight(this.ground, x, y) > -depth;
    // Without the drawn land the chart has to do: its own shoreline for the kayak, and its soundings for anything deeper.
    return depth <= 0.3 ? this.ctx.world.chartDepth(x, y) <= 0 : this.ctx.world.chartDepth(x, y) < depth;
  }

  private yacht(): Hulk {
    const s = this.ctx.sim.state;
    const d = this.ctx.spec.dimensions;
    return { x: s.x, y: s.y, heading: s.heading, loa: d.loa, beam: d.beam };
  }

  /** How steep a wake lies across a point: the two arms trailing from anything moving, a ferry's the steepest. */
  private wakeAt(x: number, y: number): number {
    let most = 0;
    const arm = (vx: number, vy: number, heading: number, sog: number, length: number) => {
      if (sog < 2) return;
      const dx = x - vx;
      const dy = y - vy;
      if (Math.abs(dx) + Math.abs(dy) > 160 + length) return;
      const fx = Math.sin(heading);
      const fy = Math.cos(heading);
      const astern = -(dx * fx + dy * fy) - length * 0.4;
      if (astern < 2 || astern > 110) return;
      const off = Math.abs(dx * fy - dy * fx);
      if (Math.abs(off - astern * 0.34) > 2.5 + astern * 0.03) return;
      most = Math.max(most, Math.min(1, (sog / 8) * (length > 40 ? 1 : 0.6)) * (1 - astern / 140));
    };
    for (const v of this.ctx.stage.traffic.vessels) arm(v.x, v.y, v.heading, v.sog, v.length);
    for (const b of this.ctx.company()) arm(b.x, b.y, b.heading, b.sog, b.length);
    return most;
  }

  // ---- the O key --------------------------------------------------------------------------------

  key(code: string, shift = false): boolean {
    const { ctx } = this;
    const name = this.spec.name.toLowerCase();
    if (code === 'KeyX' && this.mode !== 'stowed') {
      // Nobody is aboard to work the windlass.
      ctx.say(`The anchor is worked from the boat. ${this.spec.drive === 'paddle' ? 'Paddle' : 'Run'} back and come aboard first`);
      return true;
    }
    if (code !== 'KeyO') return false;

    if (shift) {
      this.cycle();
      return true;
    }

    if (this.mode === 'stowed') {
      if (ctx.sim.state.hold === 'none') {
        // The owner's rule: the tender goes once she is anchored or moored, and the yacht waits where she is.
        ctx.say(this.spec.drive === 'paddle'
          ? 'The kayak stays lashed down under way. Anchor or pick up a mooring first (X), then O launches her. Shift+O changes tender'
          : `The ${this.dinghy()} is launched once she is anchored or moored. Stop with X first, then O`, 6);
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
    if (isMotor(c) && c.thrown) {
      ctx.say('You are in the water. She is coming round for you');
      return true;
    }
    // A venue's guest float: made fast alongside it and up the ladder, whatever the beach is like.
    const guest = this.guestDock();
    if (guest && Math.abs(c.speed) <= 1.6 && Math.hypot(c.x - ctx.sim.state.x, c.y - ctx.sim.state.y) > BOARD_RANGE) {
      this.goAshore(guest, true);
      return true;
    }
    const what = call(c, ctx.sim.state, ctx.places, this.water.land);
    if (what.do === 'board') this.comeAboard(this.spec.tankL ? `Back aboard. The ${name} is ${this.stowedWord()} and her tank is filled from the can` : `Back aboard. The ${name} is ${this.stowedWord()}`);
    else if (what.do === 'land') this.goAshore(what.place);
    else if (what.do === 'slow') ctx.say(`Too much way on to land: ${(what.speed / KT).toFixed(1)} kt. ${this.spec.drive === 'paddle' ? 'Let her run off first' : 'Shut the throttle and let her run off first'}`);
    else if (what.far) ctx.say(`Nothing to land on here. The boat is ${tens(what.range)} m off, bearing ${three(what.bearing)}`, 6);
    else ctx.say(`Nothing to land on here. ${this.spec.drive === 'paddle' ? 'Paddle' : 'Run'} in to a shore or a dock, or back alongside the boat`, 6);
    return true;
  }

  /** The place whose guest float she is lying at, if any. */
  private guestDock(): Place | null {
    const c = this.kayak;
    for (const spot of this.ctx.stage.shore ?? []) {
      const d = spot.layout?.dock;
      if (!d || Math.hypot(d.x - c.x, d.y - c.y) > GUEST_DOCK) continue;
      const place = this.ctx.places.find((p) => p.id === spot.id && p.ashore);
      if (place) return place;
    }
    return null;
  }

  /** The tender as the skipper would call her: the skiff is the dinghy. */
  private dinghy(): string {
    return this.spec.id === 'skiff' ? 'dinghy' : this.spec.name.toLowerCase();
  }

  /** For the tips (`tipTable.ts`): the tender she carries, and the others Shift+O would give. */
  tenderName(): string {
    return this.spec.name;
  }

  tenderOthers(): string[] {
    return tendersFor(this.yachtFeet()).filter((t) => t.id !== this.spec.id).map((t) => (t.id === 'skiff' ? 'Dinghy' : t.name));
  }

  private stowedWord(): string {
    return this.spec.stow === 'platform' ? 'back on her platform' : 'made fast astern';
  }

  /** Shift+O: the next tender this yacht carries. Only with her stowed aboard. */
  private cycle(): void {
    const { ctx } = this;
    if (this.mode !== 'stowed') {
      ctx.say('Tenders are changed aboard the boat. Come back alongside and press O first');
      return;
    }
    const feet = this.yachtFeet();
    const list = tendersFor(feet);
    if (list.length < 2) {
      ctx.say(`She carries only the ${this.spec.name.toLowerCase()}`);
      return;
    }
    const next = nextTender(this.spec.id, feet);
    saveTender(next.id);
    this.setTender(next);
    const others = list.filter((t) => t.id !== next.id).map((t) => t.name.toLowerCase());
    ctx.say(`Tender: ${next.name.toLowerCase()}. ${next.say}. Shift+O again for the ${others.join(' or the ')}`, 7);
  }

  private launch(): void {
    const { ctx, spec } = this;
    const spot = launchSpot(this.yacht(), this.water.land);
    Object.assign(this.kayak, this.fresh(spot.x, spot.y, spot.heading));
    this.unberth();
    this.mode = 'afloat';
    this.swim = 0;
    this.at = null;
    this.told = null;
    this.toldBoat = true;
    this.ride.set = false;
    this.model.setManned(true);
    this.model.root.visible = true;
    this.painter.visible = false;
    // Whoever was at the wheel is in the tender now.
    this.helm(false);
    ctx.drone.flyTo(TENDER_VIEW[spec.model] ?? TENDER_VIEW.kayak, 1.6);
    this.toldBlown = false;
    this.losing = 0;
    this.toldLosing = 0;
    const m = this.kayak;
    Object.assign(this.said, { plane: false, shoal: false, shipping: false, quarter: false, dry: false, swamped: false, thrown: false, jumps: 0, spills: 0, swamps: 0, grounds: 0 });
    if (isMotor(m)) Object.assign(this.said, { jumps: m.jumps, spills: m.spills, swamps: m.swamps, grounds: m.grounds });
    if (spec.drive === 'paddle') ctx.say('Kayak away. W paddles, Shift with W sprints for a short while, S backs, A and D steer. O lands her or brings you back aboard', 9);
    else if (spec.drive === 'jet') ctx.say('Wave runner away. W opens the throttle, Shift with W is flat out, S brakes and backs, A and D steer: she only turns with the throttle open. O lands her or brings you back aboard', 10);
    else ctx.say('Skiff away. W opens the throttle, Shift with W is flat out, S goes astern, A and D steer. O lands her or brings you back aboard', 9);
  }

  /** ashore: the place she has landed at, and whether at its guest float, for `ashore/walk.ts` to put her on her feet there. */
  get landedAt(): { place: Place; float: boolean } | null {
    return this.mode === 'ashore' && this.at ? { place: this.at, float: this.atFloat } : null;
  }
  private atFloat = false;

  private goAshore(place: Place | null, float = false): void {
    const { ctx } = this;
    this.mode = 'ashore';
    this.at = place;
    this.atFloat = float; // ashore
    this.kayak.speed = 0;
    this.kayak.turn = 0;
    const m = this.kayak;
    if (isMotor(m)) m.throttle = m.slip = m.plane = 0;
    this.model.setManned(false);
    if (!float) this.haulUp();
    else this.afloatAt = null;
    if (place?.ashore && float) {
      if (stamp(place.id)) ctx.logbook.count('ashore');
      ctx.say(`Made fast to the guest dock at ${place.ashore.name} and up the ladder. ${place.ashore.say}`, 9);
    } else if (place?.ashore) {
      // The first time ever at this place, on this device: a stamp on the bar-hop card and one more in the logbook.
      if (stamp(place.id)) ctx.logbook.count('ashore');
      ctx.say(`Ashore at ${place.ashore.name}. ${place.ashore.say}`, 9);
    } else ctx.say(this.spec.haulUp > 0 ? 'Ashore on the beach. O shoves off' : 'Ashore on the beach, with her left afloat in the shallows. O shoves off', 6);
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

  /** If she came in bow first onto a beach, pull her up it so she is not left to the swell: a kayak a couple of metres, a skiff her bow, a wave runner not at all. */
  private haulUp(): void {
    const { kayak, ground } = this;
    this.afloatAt = null;
    const far = this.spec.haulUp;
    if (!ground || far <= 0) return;
    const fx = Math.sin(kayak.heading);
    const fy = Math.cos(kayak.heading);
    const bow = this.model.length * 0.5;
    if (!this.land(kayak.x + fx * (bow + 0.4), kayak.y + fy * (bow + 0.4))) return;
    let pull = 0;
    for (let d = 0.25; d <= far + 1e-6; d += 0.25) {
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
    this.berth = 'none';
    this.model.setManned(false);
    if (this.swimmer) this.swimmer.root.visible = false;
    // The can aboard fills her tank. The yacht's own fuel is for the yacht.
    Object.assign(this.kayak, this.fresh(this.kayak.x, this.kayak.y, this.kayak.heading));
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
    const { ctx, kayak, spec } = this;
    const sim = ctx.sim;
    this.clock += dt;
    // The session does not say when it is paused, but a paused sim takes no steps.
    if (sim.state.tick !== this.lastTick) {
      this.lastTick = sim.state.tick;
      this.stall = 0;
    } else this.stall += dt;
    const frozen = this.stall > 0.08;
    const held = sim.state.hold !== 'none';
    const live = frozen ? 0 : dt;

    this.others.update(live, seaTime);
    this.listen();

    // If the yacht gets under way with the player off her, the player is put back at the wheel rather than left behind.
    if (this.mode !== 'stowed' && !held) this.comeAboard(`The boat is under way. You are back aboard and the ${spec.name.toLowerCase()} is stowed`, true);

    if (this.mode === 'stowed') {
      // She changed boats for a race, or back: the tender is whatever that boat carries.
      const fit = tenderFor(savedTender(), this.yachtFeet());
      if (fit.id !== spec.id) {
        this.setTender(fit);
        return;
      }
      this.draw(null);
      this.stow(held, live, dt, seaTime);
      this.wake?.update(null, live, seaTime);
      this.noise.update('none', -1, 0);
      return;
    }

    let input: Paddling = { ahead: 0, steer: 0 };
    if (this.mode === 'afloat' && !frozen) {
      this.swim = Math.max(0, this.swim - dt);
      this.wakes();
      input = this.input = this.swim > 0 ? { ahead: 0, steer: 0 } : this.drive ?? this.keys();
      if (isMotor(kayak)) stepMotor(kayak, spec, input, dt, this.water, this.yacht());
      else stepCraft(kayak, input, dt, this.water, this.yacht());
      this.contact(dt);
      this.toldLosing -= dt;
      this.think -= dt;
      if (this.think <= 0) {
        this.think = 0.5;
        this.pointOut();
      }
    }

    if (isMotor(kayak)) {
      this.motoring(kayak, input, live, seaTime);
      return;
    }
    this.draw(null);
    // Capsizing, she goes right round.
    const over = this.mode === 'afloat' && this.swim > SWIM - ROLL ? ((SWIM - this.swim) / ROLL) * Math.PI * 2 : 0;
    sit(ctx, this.ground, this.model, this.ride, kayak.x, kayak.y, kayak.heading, dt, seaTime, 0, over);
    // A sprint is a faster stroke, not a longer one.
    this.model.animate(frozen ? 0 : dt * (input.sprint && input.ahead > 0 && !kayak.blown ? 1.45 : 1), input.ahead, input.steer, this.clock);
  }

  /** A powered tender, away from the yacht: how she is drawn and heard, and what is said about how she is being driven. */
  private motoring(m: Motor, input: Paddling, dt: number, seaTime: number): void {
    const { ctx, spec, said } = this;
    const afloat = this.mode === 'afloat';
    sit(ctx, this.ground, this.model, this.ride, m.x, m.y, m.heading, dt, seaTime, m.trim - 0.12 * m.shipped, m.lean, m.hop);
    const manned = afloat && !m.thrown;
    this.model.setManned(manned);
    this.model.animate(dt, manned ? m.throttle : 0, manned ? Math.sign(input.steer) : 0, this.clock);
    if (this.swimmer) {
      this.swimmer.root.visible = m.thrown;
      if (m.thrown) this.swimmer.place(m.riderX, ctx.stage.seaLevel(m.riderX, -m.riderY, seaTime, 6), -m.riderY, Math.atan2(m.x - m.riderX, m.y - m.riderY), this.clock);
    }
    const top = spec.topKt * KT;
    const working = afloat && m.fuel > 0 && m.swamped <= 0;
    this.draw(afloat && m.hop <= 0.02 ? m : null);
    this.wake?.update(afloat ? { x: m.x, y: m.y, heading: m.heading, speed: m.speed, plane: m.plane, throttle: working ? Math.abs(m.throttle) : 0, hop: m.hop, length: this.model.length, halfBeam: this.model.halfBeam, jet: spec.drive === 'jet' } : null, dt, seaTime);
    // Revs follow the throttle, held back a little until she is moving. In the air a jet screams with nothing to push on.
    const airborne = m.hop > 0.02;
    const revs = !working || dt <= 0 ? -1 : airborne && spec.drive === 'jet' ? 1 : Math.abs(m.throttle) * (0.72 + 0.28 * Math.min(1, Math.abs(m.speed) / top));
    this.noise.update(spec.sound, revs, airborne ? 0 : Math.abs(m.throttle) * (1 - 0.5 * m.plane));
    if (!afloat || dt <= 0) return;

    const sea = ctx.stage.seaLevel(m.x, -m.y, seaTime, 4);
    if (m.jumps > said.jumps) {
      said.jumps = m.jumps;
      this.wake?.splash(m.x + Math.sin(m.heading) * 0.8, sea, -m.y - Math.cos(m.heading) * 0.8, Math.min(1, Math.abs(m.speed) / top));
      ctx.sound.thud(0.08);
    }
    if (m.spills > said.spills) {
      said.spills = m.spills;
      said.thrown = true;
      this.wake?.splash(m.riderX, sea, -m.riderY, 0.8);
      ctx.say('You are off! The kill cord has shut her down, and she is idling round to pick you up', 7);
    } else if (said.thrown && !m.thrown) {
      said.thrown = false;
      ctx.say('Back aboard. She throws you if she is flung round flat out: ease off the Shift before a hard turn', 7);
    }
    if (m.swamps > said.swamps) {
      said.swamps = m.swamps;
      said.swamped = true;
      ctx.say(`Swamped: she has filled over the bow. Bailing her out, about ${BAIL_SECONDS} seconds`, 7);
    } else if (said.swamped && m.swamped <= 0) {
      said.swamped = false;
      said.shipping = false;
      ctx.say('Bailed out and the engine has caught again. Take a sea like this at the ordinary throttle, or run off before it', 8);
    } else if (m.shipped > 0.3 && !said.shipping && m.swamped <= 0) {
      said.shipping = true;
      ctx.say('Green water over the bow. Come off the Shift, or she will fill', 5);
    } else if (m.shipped < 0.05) said.shipping = false;
    if (m.grounds > said.grounds) {
      said.grounds = m.grounds;
      ctx.sound.thud(0.5);
      this.wake?.splash(m.x, sea, -m.y, 0.6);
      ctx.say('She took the ground hard. Nothing broken. Go in gently', 5);
    }
    if (m.plane >= 1 && !said.plane) {
      said.plane = true;
      ctx.say(`Up on the plane at ${(m.speed / KT).toFixed(0)} knots`, 3);
    }
    if (m.governed && m.speed > 1 && !said.shoal) {
      said.shoal = true;
      ctx.say(`Shoal water: she is eased down to five knots to save the ${spec.drive === 'jet' ? 'jet' : 'propeller'}`, 5);
    } else if (!m.governed && m.plane >= 1) said.shoal = false;
    const tank = spec.tankL ?? 0;
    if (tank > 0 && m.fuel <= 0 && !said.dry) {
      said.dry = true;
      ctx.say(spec.drive === 'jet' ? 'Out of fuel. W paddles her along with your hands, slowly. The can is aboard the boat' : 'Out of fuel. W rows her, at about two knots. The can is aboard the boat', 8);
    } else if (tank > 0 && m.fuel < tank * 0.25 && !said.quarter) {
      said.quarter = true;
      ctx.say(`A quarter of a tank left: about ${Math.max(1, Math.round(minutesLeft(spec, m.fuel, cruiseThrottle(spec))))} minutes at the ordinary throttle. The can is aboard the boat`, 7);
    }

    // The harbour's five knots, close to anything that minds a wash.
    const line = this.harbour.watch(dt, speedingPast(m.x, m.y, m.speed, this.zones));
    if (line) ctx.heard('Harbourmaster', line);
  }

  /** Put her in the sea's drawn wakes and spray (`stage.craft`, read by `scene/wake.ts` and `scene/spray.ts`), or take her out. */
  private draw(m: Motor | null): void {
    const list = this.ctx.stage.craft;
    const at = list.indexOf(this.drawn);
    if (!m) {
      if (at >= 0) list.splice(at, 1);
      return;
    }
    const v = this.drawn;
    v.x = m.x;
    v.z = -m.y;
    v.heading = m.heading;
    v.speed = Math.max(0, m.speed);
    v.length = this.model.length;
    v.beam = this.model.halfBeam * 2;
    // Banked into a turn, the outside of it throws the bigger wave.
    v.lee = Math.max(-1, Math.min(1, -m.lean / 0.3));
    if (at < 0) list.push(v);
  }

  /**
   * A ship's wake and the tender. A warning while it is still on its way. A kayak taken beam-on by a big one goes over:
   * a roll, a few seconds in the water, the paddler winded. A dinghy flat out across it ships a lot of water.
   * The wave runner jumps it (`motor.ts`). The wake itself is the same one every player has (`scene/wakeField.ts`).
   */
  private wakes(): void {
    const { ctx, kayak } = this;
    const sw = ctx.seaway;
    if (!sw.wakeId || kayak.beached) return;
    const w = sw.wake;
    if (w.arriveIn > 0 && w.arriveIn < KAYAK_WAKE.warnAhead && w.peak >= KAYAK_WAKE.warn && this.wakeWarned !== sw.wakeId) {
      this.wakeWarned = sw.wakeId;
      ctx.alarm(`Ship's wake coming, ${this.spec.drive === 'jet' ? 'ease off or jump it' : 'turn into it'}: ${sw.wakeFrom}, ${w.peak.toFixed(1)} m, here in ${Math.max(5, Math.round(w.arriveIn / 5) * 5)} s`);
    }
    if (this.swim > 0 || this.wakeDunked === sw.wakeId || !kayakCapsizes(w.height, kayak.heading, w.dirX, w.dirY)) return;
    if (isMotor(kayak)) {
      // Only the dinghy minds it, and only at speed.
      if (!this.spec.swamps || kayak.speed < 4) return;
      this.wakeDunked = sw.wakeId;
      kayak.shipped = Math.min(0.95, kayak.shipped + 0.45);
      kayak.speed *= 0.5;
      ctx.alarm(`${sw.wakeFrom}'s wake broke over her beam. She has shipped a lot of water: ease off and take the next one on the bow`);
      return;
    }
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

  /** The nearest of the other boats' powered tenders can be heard. */
  private listen(): void {
    const at = this.focus() ?? this.ctx.sim.state;
    let best = EARSHOT;
    let who: TenderFleet['out'][number] | null = null;
    for (const t of this.others.out) {
      if (t.spec.sound === 'none' || t.ashore) continue;
      const d = Math.hypot(t.x - at.x, t.y - at.y);
      if (d < best) {
        best = d;
        who = t;
      }
    }
    if (!who) {
      this.heard.update('none', -1, 0);
      return;
    }
    const near = (1 - best / EARSHOT) ** 2;
    const r = Math.min(1, Math.abs(who.speed) / (who.spec.topKt * KT));
    this.heard.update(who.spec.sound, r, r, near);
  }

  /** Running into another boat, a ship or another tender: she is stopped and it is said. Nobody's hull is hurt by a tender. */
  private contact(dt: number): void {
    const { ctx, kayak, hullA, hullB } = this;
    this.bumped = Math.max(0, this.bumped - dt);
    hullA.x = kayak.x; hullA.y = kayak.y; hullA.heading = kayak.heading; hullA.length = this.model.length; hullA.beam = this.model.halfBeam * 2;
    const slip = isMotor(kayak) ? kayak.slip : 0;
    const fx = Math.sin(kayak.heading);
    const fy = Math.cos(kayak.heading);
    const vx = fx * kayak.speed + fy * slip;
    const vy = fy * kayak.speed - fx * slip;
    const against = (x: number, y: number, heading: number, length: number, beam: number, sog: number, name: string, solid: boolean): void => {
      if (Math.abs(x - kayak.x) + Math.abs(y - kayak.y) > length + 12) return;
      hullB.x = x; hullB.y = y; hullB.heading = heading; hullB.length = length; hullB.beam = beam;
      const o = overlap(hullA, hullB);
      if (!o) return;
      // How fast the two were coming together along the line between them.
      const closing = (vx - Math.sin(heading) * sog) * o.nx + (vy - Math.cos(heading) * sog) * o.ny;
      if (solid) {
        kayak.x -= o.nx * o.depth;
        kayak.y -= o.ny * o.depth;
      }
      if (closing < BUMP_SPEED || this.bumped > 0) return;
      this.bumped = 2.5;
      kayak.speed = 0;
      kayak.turn = 0;
      if (isMotor(kayak)) kayak.slip = kayak.throttle = 0;
      ctx.sound.thud(Math.min(1, 0.15 + closing / 14));
      this.wake?.splash(kayak.x + o.nx, ctx.stage.seaLevel(kayak.x, -kayak.y, ctx.sim.state.t, 4), -(kayak.y + o.ny), Math.min(1, closing / 10));
      ctx.say(bumpWord(closing, name), 6);
    };
    // Her own yacht: the step has already fended her off, so this only asks whether she arrived too fast.
    const own = this.yacht();
    against(own.x, own.y, own.heading, own.loa, own.beam + 1.3, 0, 'your own boat', false);
    for (const b of ctx.company()) against(b.x, b.y, b.heading, b.length, b.beam, b.sog, b.boatName || b.name || 'another boat', true);
    for (const v of ctx.stage.traffic.vessels) against(v.x, v.y, v.heading, v.length, v.beam, v.sog, v.name, true);
    for (const t of this.others.out) against(t.x, t.y, t.heading, t.spec.length, t.spec.beam, t.speed, `${t.owner}'s ${t.spec.name.toLowerCase()}`, true);
  }

  private keys(): Paddling {
    const h = this.ctx.held;
    const on = (a: string, b: string) => (h(a) || h(b) ? 1 : 0);
    return { ahead: on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown'), steer: on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft'), sprint: on('ShiftLeft', 'ShiftRight') === 1 };
  }

  /** Drive her for a while without the keys or the frame clock. For play testing from the console. */
  paddle(input: Paddling, seconds: number): void {
    if (this.mode !== 'afloat') return;
    const c = this.kayak;
    for (let t = 0; t < seconds; t += 0.1) {
      if (isMotor(c)) stepMotor(c, this.spec, input, 0.1, this.water, this.yacht());
      else stepCraft(c, input, 0.1, this.water, this.yacht());
    }
  }

  /** A word when the paddler is spent, and when the tide or the wind is more than she can paddle against. */
  private effort(): void {
    const { ctx, kayak, input } = this;
    if (isMotor(kayak)) return;
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

  /** A word when a landing or the yacht comes within reach, once per approach. Twice a second, so the harbour's zones are gathered here too. */
  private pointOut(): void {
    const { ctx, kayak } = this;
    this.effort();
    const guest = this.guestDock();
    const place = guest ?? placeInReach(kayak, ctx.places, kayak.beached || touchingShore(kayak.x, kayak.y, this.water.land));
    if (place?.ashore && place.id !== this.told) ctx.say(guest ? `The guest dock at ${place.ashore.name}. Ease up and press O to make fast and go ashore` : `${capital(place.ashore.name)} is close by. Ease up and press O to go ashore`, 6);
    this.told = place?.id ?? null;

    const off = Math.hypot(kayak.x - ctx.sim.state.x, kayak.y - ctx.sim.state.y);
    if (off > 40) this.toldBoat = false;
    else if (off <= BOARD_RANGE && !this.toldBoat) {
      this.toldBoat = true;
      ctx.say('Alongside. O to come back aboard');
    }

    if (this.spec.drive === 'paddle') return;
    const zones: Zone[] = [];
    for (const p of ctx.places) {
      if (p.kind !== 'dock' && p.kind !== 'mooring') continue;
      if (Math.abs(p.x - kayak.x) + Math.abs(p.y - kayak.y) > 400) continue;
      zones.push({ x: p.x, y: p.y, radius: p.kind === 'dock' ? 110 : 70, what: p.kind === 'dock' ? `the dock at ${p.name}` : `the moorings at ${p.name}` });
    }
    for (const b of ctx.company()) if (b.held) zones.push({ x: b.x, y: b.y, radius: 60, what: `${b.boatName || b.name || 'the boat'} at anchor` });
    for (const t of this.others.out) if (t.spec.drive === 'paddle' && !t.ashore) zones.push({ x: t.x, y: t.y, radius: 50, what: `${t.owner}'s kayak` });
    this.zones = zones;
  }

  // ---- stowed ------------------------------------------------------------------------------------

  /**
   * Where the empty tender lives. The kayak is lashed along the port side deck under way and lies astern at anchor;
   * the skiff is always on her painter astern, towed under way; the wave runner sits on the stern platform.
   */
  private stow(held: boolean, live: number, dt: number, seaTime: number): void {
    const { ctx, spec, model } = this;
    const want = spec.stow === 'platform' ? 'platform' : spec.stow === 'astern' || held ? 'astern' : 'deck';
    if (want !== this.berth) {
      this.unberth();
      this.berth = want;
      const d = ctx.spec.dimensions;
      if (want === 'deck') {
        // On her side against the stanchions, bow forward.
        ctx.boatView.root.add(model.root);
        model.root.position.set(-(d.beam * 0.5 - 0.42), d.freeboard + 0.2, -d.loa * 0.03);
        model.root.rotation.set(0, 0, 1.05);
      } else if (want === 'platform') {
        // Athwartships on the platform, bow to port.
        ctx.boatView.root.add(model.root);
        model.root.position.set(0, 0.52, d.loa * 0.5 + 0.62);
        model.root.rotation.set(0, Math.PI / 2, 0);
      } else {
        this.tow.out = false;
        this.ride.set = false;
      }
    }
    model.root.visible = true;
    this.painter.visible = want === 'astern';
    if (want !== 'astern') return;
    this.trail(live);
    sit(ctx, this.ground, model, this.ride, this.tow.x, this.tow.y, this.tow.heading, dt, seaTime);
    this.rig();
  }

  /** Take the tender off the yacht's model and put her back in the scene. */
  private unberth(): void {
    const root = this.model.root;
    if (root.parent !== this.ctx.stage.scene) {
      root.removeFromParent();
      this.ctx.stage.scene.add(root);
    }
    this.berth = 'none';
  }

  /** The empty tender lies to her painter astern of the yacht, streaming with the tide and the wind as the yacht does, or towed after her. */
  private trail(dt: number): void {
    const { tow } = this;
    const yacht = this.yacht();
    const fx = Math.sin(yacht.heading);
    const fy = Math.cos(yacht.heading);
    const sx = yacht.x - fx * (yacht.loa * 0.5 - 0.2);
    const sy = yacht.y - fy * (yacht.loa * 0.5 - 0.2);
    const reach = PAINTER + this.model.length * 0.5;
    if (!tow.out || Math.hypot(tow.x - sx, tow.y - sy) > reach + 30) {
      tow.out = true;
      tow.x = sx - fx * reach;
      tow.y = sy - fy * reach;
      tow.heading = yacht.heading;
      this.ride.set = false;
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
    fendOff(hull, { ...yacht, beam: yacht.beam + 1.2 + this.model.halfBeam });
    tow.x = hull.x;
    tow.y = hull.y;
    // She points up her painter.
    dx = sx - tow.x;
    dy = sy - tow.y;
    const want = Math.atan2(dx, dy);
    tow.heading += Math.atan2(Math.sin(want - tow.heading), Math.cos(want - tow.heading)) * Math.min(1, dt * 1.5);
  }

  /** Draw the painter from the yacht's stern to the tender's bow. */
  private rig(): void {
    const { ctx, a, b } = this;
    const d = ctx.spec.dimensions;
    ctx.boatView.root.updateMatrixWorld(true);
    this.model.root.updateMatrixWorld(true);
    a.set(0, d.freeboard * 0.85, d.loa * 0.5 - 0.25);
    ctx.boatView.root.localToWorld(a);
    b.copy(this.model.bow);
    this.model.root.localToWorld(b);
    const len = a.distanceTo(b) || 1e-3;
    this.painter.position.copy(a).lerp(b, 0.5);
    this.painter.scale.set(1, len, 1);
    this.painter.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, b.sub(a).multiplyScalar(1 / len));
  }

  // ---- what the session asks -------------------------------------------------------------------

  status(): string {
    const name = this.spec.name.toLowerCase();
    if (this.mode === 'afloat') {
      const m = this.kayak;
      if (!isMotor(m)) return `In the ${name}`;
      if (m.thrown) return `Off the ${name}, in the water`;
      if (m.swamped > 0) return `Bailing out the ${name}`;
      const tank = this.spec.tankL ?? 0;
      return `In the ${name} · ${Math.abs(m.speed / KT).toFixed(0)} kt${tank ? ` · fuel ${Math.round((m.fuel / tank) * 100)}%` : ''}`;
    }
    if (this.mode === 'ashore') return this.at?.ashore ? `Ashore at ${this.at.ashore.name}` : 'Ashore on the beach';
    return '';
  }

  focus(): { x: number; y: number; heading: number; height: number } | null {
    if (this.mode === 'stowed') return null;
    const m = this.kayak;
    // In the water after a spill, the camera stays with the swimmer and watches her come back.
    if (isMotor(m) && m.thrown) return { x: m.riderX, y: m.riderY, heading: Math.atan2(m.x - m.riderX, m.y - m.riderY), height: this.ride.heave };
    return { x: m.x, y: m.y, heading: m.heading, height: this.ride.heave + (isMotor(m) ? m.hop : 0) };
  }

  /** `oc` is the tender when she is away from the yacht, packed by `packTender`. Null when she is not. */
  wire(): Record<string, unknown> {
    if (this.mode === 'stowed') return { oc: null };
    const m = this.kayak;
    return { oc: packTender(this.spec.id, m.x, m.y, m.heading, m.speed, this.mode === 'ashore') };
  }

  /** She has changed boats: what was hung on the old one comes off before it is thrown away, and goes on the new one. */
  reboat(): void {
    this.unberth();
    this.platform.removeFromParent();
    if (this.mode !== 'stowed') this.helm(false);
    const fit = tenderFor(savedTender(), this.yachtFeet());
    if (this.mode === 'stowed' && fit.id !== this.spec.id) {
      this.setTender(fit);
      return;
    }
    this.hangPlatform();
  }

  dispose(): void {
    this.draw(null);
    this.helm(true);
    this.model.dispose();
    this.wake?.dispose();
    this.swimmer?.dispose();
    this.others.dispose();
    this.noise.dispose();
    this.heard.dispose();
    this.platform.removeFromParent();
    this.platform.geometry.dispose();
    (this.platform.material as THREE.Material).dispose();
    this.painter.removeFromParent();
    this.painter.geometry.dispose();
    (this.painter.material as THREE.Material).dispose();
  }
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The heights the land is drawn from, read back off the terrain's own mesh, so the tender grounds exactly where the picture says. */
function readGround(ctx: AboardContext): HeightGrid | null {
  const mesh = ctx.stage.scene.getObjectByName('terrain') as THREE.Mesh | undefined;
  const position = mesh?.geometry?.getAttribute('position');
  const g = ctx.stage.course.terrain;
  if (!position || position.count !== g.nx * g.ny) return null;
  return { x0: g.x0, y0: g.y0, dx: g.dx, nx: g.nx, ny: g.ny, data: position.array, stride: 3, offset: 1 };
}
