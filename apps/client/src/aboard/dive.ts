import * as THREE from 'three';
import { KT } from '@slack-tide/sim';
import { hash01 } from './catch';
import { sight } from './sightings';
import type { AboardContext, Feature } from './feature';
import type { EyeView } from '../stage';
import { graphics } from '../scene/quality';
import { myAvatar, onMyAvatar } from '../boat/avatar';
import { divesOf } from './diveData';
import { diveLog, logCatch, logDive, logEntry, logSeen } from './diveLog';
import {
  BREATH, DIVE_POINTS, ENTRY, FLAG, GRAB, GUN, KICK, SHIFT,
  canDive, canFire, castOf, cleanDive, lobsterAwards, diverNear, effortOf, gauge, glide, grab, holdBreath, lobsterShies, lungsFor, nameKey, urge, judge, lightAt, lobsterSeason, lobstersAt, makeGround, newBreath, packDive, populate,
  recover, runOver, siteAt, spook, stepFish, surfaced, surge, underwaterVisibility, zoneAt,
  type Breath, type Lungs, type DiveFile, type DiveSite, type DiveZone, type Fish, type Ground, type Lobster, type Verdict,
} from './diveRules';
import {
  LINE, aimAt, boltholeOf, fightWord, holdOf, huntAwards, leadCue, newFight, newThief, stepFight, strikeOf, targetsOfDive, thiefStep,
  type Fight, type Strike, type TargetPick, type ThiefState,
} from './diveHunt';
import { buoyancy, chaseLength, chaseReach, lockBreaks, lockCandidates, lookToward, nextLock, suitFor, CHASE, type Lockable } from './diveBody';
import { handTargetsAt, takeByHand, type HandThing } from './diveHand';
import { DiveScene, RADIUS, buildDiveFloat } from './diveScene';
import { DiverModel, type DiverPose } from './diveDiver';

const three = (deg: number) => String(Math.round(((deg % 360) + 360) % 360)).padStart(3, '0');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

/** The tender, as much of `aboard/kayak.ts` as the dive needs. */
interface TenderLike { mode: string; kayak: { x: number; y: number; heading: number; speed: number }; drive: { ahead: number; steer: number } | null; spec: { name: string; length?: number; beam?: number } }

/** What she has kept this sail: fish on the stringer, lobster and shellfish in the bag. Fish stay on the float until they are handed aboard. */
interface Kept { id: string; name: string; size: number; unit: 'cm' | 'mm'; fish?: Fish; onFloat: boolean }

/** Something the view can lock on to: a fish, a lobster, or a thing taken by hand. */
interface Mark extends Lockable { fish?: Fish; lobster?: Lobster; thing?: HandThing }

const VIEW_KEY = 'regatta.diveView';

/**
 * Over the side with mask, fins, a speargun and a float with a dive flag. 5 puts her in the water from the yacht at
 * anchor or on a mooring, or from the tender when it is stopped, and 5 beside either one climbs back out.
 * In the water she swims on her fins: each press of the up arrow is a kick (held, an easy rhythm) and she glides
 * between; left and right turn her, down puts her head down for a duck dive, E brings it up, and a drag looks about
 * (over her shoulder, too, at her own fins). W A S D do the same as the arrows. F fires the gun, G takes a lobster or
 * a shellfish by hand. 1 is the view from her mask, 2 a chase view from behind her. Q locks the view on to the fish (or
 * lobster) she is looking at and Q again moves to the next; Shift+Q lets go. While locked, left and right lead the aim.
 * One breath at a time: her lungs (`lungsFor`) grow with clean dives, kept in the logbook as `freedive`.
 * The rules are in `diveRules.ts`, `diveHunt.ts`, `diveBody.ts`, `diveHand.ts` and `diveFlock.ts`; the picture in
 * `diveScene.ts` and `diveDiver.ts`; the sites and fish in each water's `dives.json`.
 */
export class Dive implements Feature {
  readonly id = 'dive';
  /** Aboard, at the surface on her snorkel, or under on one breath. */
  mode: 'aboard' | 'surface' | 'under' = 'aboard';
  /** Where her mask is: sim x and y, depth, and the way her body faces (compass radians, and up from level). */
  readonly diver = { x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, yaw: 0, pitch: 0 };
  /** How far her head is turned from her body, radians: a drag looks over her shoulder. */
  headYaw = 0;
  /** From her mask, or from behind her. Kept on the device. */
  view: 'mask' | 'chase' = 'mask';
  /**
   * Swim her without the keys, for play testing from the console: kicks a second, and turning and nodding from -1 to 1.
   * `regatta.features.find(f => f.id === 'dive').drive = { kick: 1, turn: 0, nod: 0 }`. `still` holds her where she is put.
   */
  drive: { kick?: number; turn?: number; nod?: number } | null = null;
  still = 0;
  /** What her lungs are good for, from the practice in her logbook. Read when she goes in. */
  lungs: Lungs = lungsFor(0);
  private sinceKick = 9;
  private wasUp = false;
  private kickRate = 0;
  /** 1 at a fin stroke, fading: for the roll of the mask with it. And the same for a contraction. */
  private stroke = 0;
  private throb = 0;
  private pulse = 0;
  private heart = 0;
  private urged = false;
  private breathe = 1;
  private crackle = 0;
  private engine = 0;
  private thrash = 0;
  private gained = 0;
  private readonly veil = document.createElement('div');
  private peak = 0;
  private readonly mask = document.createElement('div');
  private readonly bracket = document.createElement('div');
  private wasWet = false;
  /** Her own setting: treat the lobster season as open and the water below as an October night. Nobody else's day changes. */
  practice = false;
  breath: Breath = newBreath();
  fish: Fish[] = [];
  lobsters: Lobster[] = [];
  hand: HandThing[] = [];
  /** What has been kept on this sail: fish on the stringer and lobster and shellfish in the bag. */
  readonly stringer: Kept[] = [];
  /** A fish on the shaft, not yet up at the float. A blackout loses it. */
  inHand: { fish: Fish; verdict: Verdict; strike: Strike } | null = null;
  /** A fish running on the line after a body shot. */
  fight: Fight | null = null;
  site: DiveSite | null = null;
  zone: DiveZone | null = null;
  /** The fish worth a bonus on this dive, true to who is here this half hour. */
  targets: TargetPick[] = [];
  /** What the view is locked on to, by its key, and the lead dialled in on it, radians. */
  lockKey: string | null = null;
  lead = 0;

  private readonly file: DiveFile;
  /** A site put under her wherever she is, by `?diveSite=<id>`: for looking at a site's bottom from any water. */
  private readonly forced: string | null;
  private readonly scene: DiveScene;
  private readonly model: DiverModel;
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.08, 400);
  private readonly eye: EyeView;
  private readonly float = buildDiveFloat();
  private readonly flags: THREE.Group[] = [];
  private readonly panel = document.createElement('aside');
  private readonly lines: HTMLElement[] = [];
  private ground: Ground | null = null;
  private centre = { x: 0, y: 0 };
  private from: 'yacht' | 'tender' = 'yacht';
  private pinned = { x: 0, y: 0 };
  private shift = 0;
  private night = false;
  private seen = 18;
  private dawn = false;
  private suitL = 5;
  private readonly told = new Set<string>();
  /** Moments had on this dive: a giant sea bass met is a moment once a dive. */
  private readonly moments = new Set<string>();
  /** Fish and lobster taken out of the water this sail, by place and half hour, so they are not there to take again. */
  private readonly taken = new Set<string>();
  private readonly warned = new Set<string>();
  private reload = 0;
  private shot: { from: THREE.Vector3; dir: THREE.Vector3; range: number; gone: number; hit: Fish | null; near: Fish | null; landed: boolean; spot: number; off: number; radius: number; side: number } | null = null;
  private strike: Strike = 'body';
  private ascending = false;
  private dazed = 0;
  private briefing = 0;
  private dragging = false;
  private readonly drag = { x: 0, y: 0 };
  private eyeDepth = -0.3;
  private aim: Fish | null = null;
  private think = 0;
  private callAt: 'ok' | 'warn' | 'danger' = 'ok';
  private limitTold = false;
  private last = { depth: 0, seconds: 0 };
  private clock = 0;
  private kicks = 0;
  private kickPhase = 0;
  private kickAmp = 0;
  private duck = 0;
  private surgeX = 0;
  private surgeY = 0;
  private recoil = 0;
  private reaching = 0;
  private hauling = 0;
  private puff = 1;
  private turnRate = 0;
  private lastYaw = 0;
  private camYaw = 0;
  private camPitch = 0;
  private camRoll = 0;
  private camSet = false;
  private bead = 0;
  private handedTold = false;
  private thief: ThiefState = newThief();
  private thiefName = '';
  private readonly current = { x: 0, y: 0 };
  private readonly tip = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly heldAt = new THREE.Vector3();
  private readonly floatAt = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly lookVec = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly water = new THREE.Color();
  private readonly sky = new THREE.Color();
  private readonly pose: DiverPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, lookX: 0, lookY: 0, lookZ: -1, kick: 0, kickAmp: 0, arm: 'glide', armK: 0, firstPerson: true, loaded: true, bead: 0 };
  private readonly unwatch: () => void;

  constructor(private readonly ctx: AboardContext) {
    const course = ctx.stage.course.id;
    // Two switches for play testing: another water's fish and rules on this one, and one of its sites under the boat.
    let as: string | null = null;
    let forced: string | null = null;
    try {
      const q = new URLSearchParams(location.search);
      as = q.get('diveAs');
      forced = q.get('diveSite');
    } catch { /* no address to read */ }
    try { if (localStorage.getItem(VIEW_KEY) === 'chase') this.view = 'chase'; } catch { /* the mask, then */ }
    this.file = divesOf(as || course);
    this.forced = forced;
    this.suitL = suitFor(this.file.water.tempC);
    this.scene = new DiveScene(graphics.level === 'low');
    this.scene.group.add(this.scene.gun);
    ctx.stage.scene.add(this.scene.group);
    this.model = new DiverModel(myAvatar());
    this.model.group.visible = false;
    ctx.stage.scene.add(this.model.group);
    this.unwatch = onMyAvatar((a) => this.model.wear(a));
    this.float.visible = false;
    ctx.stage.scene.add(this.float);
    this.eye = { camera: this.camera, wet: false, water: new THREE.Color(), see: 18, light: new THREE.Color(1, 1, 1) };
    this.camera.rotation.order = 'YXZ';

    this.panel.className = 'hud dive';
    this.panel.setAttribute('aria-label', 'Dive');
    this.panel.hidden = true;
    for (const name of ['where', 'gauges', 'breath', 'gun', 'aim', 'catch', 'goal', 'brief']) {
      const el = document.createElement('div');
      el.className = name;
      this.panel.appendChild(el);
      this.lines.push(el);
    }
    for (const label of ['depth', 'dive time', 'max', 'bottom', 'water']) {
      const cell = document.createElement('div');
      cell.append(document.createElement('b'), Object.assign(document.createElement('small'), { textContent: label }));
      this.lines[1].appendChild(cell);
    }
    const bar = document.createElement('i');
    this.lines[2].append(document.createElement('span'), bar);
    bar.appendChild(document.createElement('b'));
    document.body.appendChild(this.panel);
    this.veil.className = 'dive-veil';
    this.mask.className = 'dive-mask';
    this.bracket.className = 'dive-lock';
    this.bracket.hidden = true;
    document.body.append(this.veil, this.mask, this.bracket);
    window.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onUp, true);
  }

  // ---- looking about: the pointer belongs to the mask while she is in the water ------------------------------

  private readonly onDown = (e: PointerEvent): void => {
    if (this.mode === 'aboard' || e.target !== this.ctx.stage.canvas) return;
    this.dragging = true;
    e.stopImmediatePropagation();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.mode === 'aboard' || !this.dragging) return;
    this.drag.x += e.movementX;
    this.drag.y += e.movementY;
    e.stopImmediatePropagation();
  };

  private readonly onUp = (): void => {
    this.dragging = false;
  };

  // ---- keys ---------------------------------------------------------------------------------------------------

  /** In the water the number keys are the dive's views, not the boat's. */
  firstKey(code: string): boolean {
    if (this.mode === 'aboard') return false;
    if (code === 'Digit1' || code === 'Digit2') { this.setView(code === 'Digit1' ? 'mask' : 'chase'); return true; }
    if (code === 'Digit3' || code === 'Digit4') { this.ctx.say('In the water: 1 is the view from your mask, 2 follows you from behind'); return true; }
    return false;
  }

  key(code: string, shift = false): boolean {
    if (code === 'Digit6') {
      this.togglePractice();
      return true;
    }
    if (this.mode === 'aboard') {
      if (code !== 'Digit5') return false;
      this.enter();
      return true;
    }
    // In the water every key is hers: none of them must reach the anchor, the tender or the engine.
    if (code === 'Slash' || code === 'KeyY') return false;
    if (code === 'Digit5') this.climbOut();
    else if (code === 'KeyF') this.fire();
    else if (code === 'KeyG') this.reach();
    else if (code === 'KeyQ') this.lockOn(shift);
    else if (code === 'Digit1' || code === 'Digit2') this.setView(code === 'Digit1' ? 'mask' : 'chase');
    else if (code === 'KeyX' || code === 'KeyO' || code === 'KeyI') this.ctx.say('That is worked from the boat. Swim back and press 5 to climb out first');
    return true;
  }

  setView(v: 'mask' | 'chase'): void {
    if (this.view !== v) this.camSet = false;
    this.view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* for this visit */ }
    this.ctx.say(v === 'mask' ? 'From your mask' : 'Following you from behind. 1 goes back to the mask', 3);
  }

  private tender(): TenderLike | null {
    const k = this.ctx.feature('kayak') as unknown as TenderLike | undefined;
    return k && k.mode === 'afloat' ? k : null;
  }

  /** Month and day on the water's own calendar. */
  private today(): { month: number; day: number; hour: number } {
    const { world, sim, stage } = this.ctx;
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: stage.course.timeZone, month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false }).formatToParts(world.dateAt(sim.state.t));
    const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 1);
    return { month: read('month'), day: read('day'), hour: read('hour') % 24 };
  }

  private season(): { open: boolean; practice: boolean; say: string } | null {
    const rule = this.file.lobster;
    if (!rule) return null;
    const { month, day } = this.today();
    return lobsterSeason(rule, month, day, this.practice);
  }

  private togglePractice(): void {
    const rule = this.file.lobster;
    if (!rule) {
      this.ctx.say('There are no lobster rules for this water');
      return;
    }
    const { month, day } = this.today();
    if (lobsterSeason(rule, month, day, false).open) {
      this.ctx.say(`The ${rule.name.toLowerCase()} season is open today as it is: no need to practise`, 6);
      return;
    }
    this.practice = !this.practice;
    this.ctx.say(this.practice
      ? `${rule.practice ?? 'Practice season'}. On your dives the season is treated as open and the water below as night, when they walk the reef. The day above stays as it is for everyone`
      : `Practice off. ${lobsterSeason(rule, month, day, false).say}`, 9);
    // The reef by night is a different reef: who is out is worked out again.
    if (this.mode !== 'aboard') this.stock();
  }

  // ---- in and out ---------------------------------------------------------------------------------------------

  private enter(): void {
    const { ctx } = this;
    const { sim, world } = ctx;
    const s = sim.state;
    const tender = this.tender();
    const other = ctx.feature('kayak') as unknown as TenderLike | undefined;
    const at = tender ? tender.kayak : s;
    world.current(at.x, at.y, s.t, this.current);
    const depth = world.depth(at.x, at.y, s.t);
    const can = canDive({
      held: s.hold !== 'none', inTender: !!tender, tenderKt: tender ? Math.abs(tender.kayak.speed) / KT : 0, ashore: other?.mode === 'ashore',
      streamKt: Math.hypot(this.current.x, this.current.y) / KT, depth, racing: !!ctx.race && ctx.race.call !== null && ctx.race.finish === null,
    });
    if (!can.ok) {
      ctx.say(can.say, 7);
      return;
    }
    this.from = tender ? 'tender' : 'yacht';
    this.pinned = { x: at.x, y: at.y };
    if (tender) tender.drive = { ahead: 0, steer: 0 };
    // Off the quarter, clear of the hull, facing away from her.
    const off = tender ? 1.6 : ctx.spec.dimensions.beam / 2 + 2.2;
    const h = at.heading + Math.PI / 2;
    const d = this.diver;
    d.x = at.x + Math.sin(h) * off;
    d.y = at.y + Math.cos(h) * off;
    d.d = 0; d.vx = d.vy = d.vd = 0;
    d.yaw = h;
    d.pitch = 0;
    this.headYaw = 0;
    this.mode = 'surface';
    this.breath = newBreath();
    this.lungs = lungsFor(ctx.logbook.totals.freedive);
    this.reload = 0;
    this.shot = null;
    this.inHand = null;
    this.fight = null;
    this.ascending = false;
    this.dazed = 0;
    this.briefing = 40;
    this.eyeDepth = -0.3;
    this.limitTold = false;
    this.lockKey = null;
    this.camSet = false;
    this.thief = newThief();
    this.moments.clear();
    this.settle(d.x, d.y);
    logEntry();
    this.float.visible = true;
    this.model.group.visible = true;
    // The boat's instruments mean nothing in the water: the dive computer stands alone until she climbs out.
    document.body.classList.add('diving');
    this.peak = 0;
    const where = this.site ? `${this.site.name}. ${this.site.say}` : `No named site here: ${Math.round(depth)} m of water`;
    const goal = this.targets.length ? ` Worth looking for today: ${this.targets.map((t) => t.name).join(' and ')}.` : '';
    // An alarm, so that time drops back to real speed: a breath is counted in real seconds.
    ctx.alarm(`Over the side. ${where}${can.say ? `. ${can.say}` : ''}.${goal}`);
  }

  /** Work out the ground about a point and who lives on it, and build the picture of it. */
  private settle(x: number, y: number): void {
    const { ctx, file } = this;
    const t = ctx.sim.state.t;
    const charted = (px: number, py: number) => ctx.world.depth(px, py, t);
    const named = this.forced ? file.sites.find((s) => s.id === this.forced) : undefined;
    if (named) {
      // A site put under the boat for a look at it: it sits in whatever water is there, taken as deep enough for it.
      this.site = { ...named, x, y };
      this.forcedZone = zoneAt(file, named.x, named.y);
      this.ground = makeGround(file, this.site, (px, py) => (charted(px, py) > 0 ? Math.max(charted(px, py), named.depth[1]) : 0));
    } else {
      this.site = siteAt(file, x, y);
      this.ground = makeGround(file, this.site, charted);
    }
    this.centre = { x, y };
    this.stock();
  }

  private forcedZone: DiveZone | null = null;

  /** Who is on this ground for this half hour, less what she has already taken, and the bottom built for them. */
  private stock(): void {
    const { ctx, file } = this;
    if (!this.ground) return;
    const { hour } = this.today();
    this.shift = Math.floor(ctx.seasonNow() / SHIFT);
    this.night = this.practice || ctx.stage.sky.night > 0.5;
    this.dawn = hour >= 5 && hour < 8;
    const key = `${this.site?.id ?? `${Math.floor(this.centre.x / 250)},${Math.floor(this.centre.y / 250)}`}:${this.shift}:${this.night ? 'n' : 'd'}`;
    this.fish = populate(file, this.ground, this.centre.x, this.centre.y, this.shift, { night: this.night, dawn: this.dawn }).filter((f) => !this.taken.has(`${key}:f${f.index}`));
    this.lobsters = lobstersAt(file, this.ground, this.centre.x, this.centre.y, this.shift, this.night).filter((l) => !this.taken.has(`${key}:l${l.index}`));
    this.hand = handTargetsAt(file, this.ground, this.centre.x, this.centre.y, this.shift).filter((h) => !this.taken.has(`${key}:h${h.index}`));
    this.targets = targetsOfDive(this.fish, this.dawn);
    this.stockKey = key;
    const thief = this.site ? castOf(file, this.site).find((s) => s.thief) : undefined;
    this.thiefName = thief?.name ?? '';
    this.lockKey = null;
    // The canopy lies the way the water is going, which is away from where the sea comes from.
    this.scene.build(this.ground, this.centre.x, this.centre.y, this.lobsters, file.water.cover === 'coral', ctx.seaway.sea.dir + Math.PI, this.fish, this.hand);
  }

  private stockKey = '';

  private climbOut(): void {
    const { ctx } = this;
    const d = this.diver;
    if (this.mode === 'under') {
      this.ascending = true;
      ctx.say('Heading up');
      return;
    }
    const home = this.home();
    const range = Math.hypot(home.x - d.x, home.y - d.y);
    if (range > ENTRY.reach + home.half) {
      const bearing = (Math.atan2(home.x - d.x, home.y - d.y) * 180) / Math.PI;
      ctx.say(`The ${this.from === 'tender' ? 'tender' : 'boat'} is ${Math.round(range)} m off, bearing ${three(bearing)}. Swim back to her, then 5 climbs out`, 6);
      return;
    }
    this.handUp();
    this.leave(this.summary());
  }

  /** Where she climbs out: the yacht, or the tender she came in. */
  private home(): { x: number; y: number; half: number } {
    const tender = this.from === 'tender' ? this.tender() : null;
    if (tender) return { x: tender.kayak.x, y: tender.kayak.y, half: 1 };
    const s = this.ctx.sim.state;
    return { x: s.x, y: s.y, half: this.ctx.spec.dimensions.loa / 2 };
  }

  /** The fish on the float are handed up into the boat: safe from any sea lion. */
  private handUp(): number {
    let n = 0;
    for (const k of this.stringer) if (k.onFloat) { k.onFloat = false; n++; }
    return n;
  }

  private summary(): string {
    const n = this.stringer.length;
    const where = this.from === 'tender' ? 'Back in the tender' : 'Back aboard';
    if (!n) return `${where}, with nothing on the stringer`;
    const by = new Map<string, number>();
    for (const c of this.stringer) by.set(c.name, (by.get(c.name) ?? 0) + 1);
    return `${where} with ${[...by].map(([name, k]) => `${k} ${name}`).join(', ')} this sail`;
  }

  private leave(say: string): void {
    const tender = this.ctx.feature('kayak') as unknown as TenderLike | undefined;
    if (tender && this.from === 'tender') tender.drive = null;
    this.mode = 'aboard';
    this.ctx.stage.eye = null;
    this.scene.group.visible = false;
    this.model.group.visible = false;
    this.float.visible = false;
    this.panel.hidden = true;
    this.bracket.hidden = true;
    document.body.classList.remove('diving', 'under');
    this.wasWet = false;
    this.veil.style.opacity = '0';
    this.ctx.sound.duck(1);
    this.dragging = false;
    this.shot = null;
    this.inHand = null;
    this.fight = null;
    this.lockKey = null;
    if (say) this.ctx.say(say, 7);
  }

  // ---- the gun, the hand and the lock -------------------------------------------------------------------------

  /** The way her body faces, as a unit vector east, north and down: the way she swims. */
  private bodyDir(out: { x: number; y: number; d: number }): { x: number; y: number; d: number } {
    const { yaw, pitch } = this.diver;
    const c = Math.cos(pitch);
    out.x = Math.sin(yaw) * c;
    out.y = Math.cos(yaw) * c;
    out.d = -Math.sin(pitch);
    return out;
  }

  /** The way she is looking, as a unit vector east, north and down: the way the gun points. */
  private look(out: { x: number; y: number; d: number }): { x: number; y: number; d: number } {
    const yaw = this.diver.yaw + this.headYaw;
    const c = Math.cos(this.diver.pitch);
    out.x = Math.sin(yaw) * c;
    out.y = Math.cos(yaw) * c;
    out.d = -Math.sin(this.diver.pitch);
    return out;
  }

  private readonly dir = { x: 0, y: 0, d: 0 };
  private readonly swim = { x: 0, y: 0, d: 0 };

  private lobsterMarks(): Array<Lobster & { cm: number; vx: number; vy: number; vd: number; species: { shape: 'bass' } }> {
    return this.lobsters.filter((l) => l.mode === 'there').map((l) => ({ ...l, cm: (l.mm / 10) * 3.2, vx: 0, vy: 0, vd: 0, species: { shape: 'bass' as const } }));
  }

  /** Everything she could lock on to now. */
  private marks(): Mark[] {
    const out: Mark[] = [];
    for (const f of this.fish) {
      if (f.count > 1) continue;
      const sp = f.species;
      out.push({ key: `f${f.index}`, x: f.x, y: f.y, d: f.d, live: f.mode === 'cruise' || f.mode === 'bolt', legal: !sp.protected && !sp.spare && (sp.minCm === undefined || f.cm >= sp.minCm), fish: f });
    }
    const season = this.season();
    for (const l of this.lobsters) out.push({ key: `l${l.index}`, x: l.x, y: l.y, d: l.d, live: l.mode === 'there', legal: !!season?.open && l.mm >= (this.file.lobster?.minMm ?? 0), lobster: l });
    for (const t of this.hand) out.push({ key: `h${t.index}`, x: t.x, y: t.y, d: t.d, live: t.mode === 'there', legal: !t.spec.protected, thing: t });
    return out;
  }

  private locked(): Mark | null {
    if (!this.lockKey) return null;
    return this.marks().find((m) => m.key === this.lockKey) ?? null;
  }

  /** Q: lock on to what she is looking at, or move on to the next; Shift+Q lets go. The lock only does the looking. */
  private lockOn(release: boolean): void {
    const { ctx } = this;
    if (release || this.mode === 'aboard') {
      if (this.lockKey) ctx.say('Lock off', 2);
      this.lockKey = null;
      return;
    }
    const list = lockCandidates(this.diver, this.look(this.dir), this.marks(), this.seen);
    const next = nextLock(this.lockKey, list);
    this.lockKey = next?.key ?? null;
    this.lead = 0;
    if (!next) { ctx.say(list.length ? 'Lock off' : 'Nothing in front of you to lock on to', 2); return; }
    const name = next.fish ? next.fish.species.name : next.lobster ? 'lobster' : next.thing!.spec.name;
    ctx.say(`Locked on: ${name}${list.length > 1 ? '. Q for the next, Shift+Q to let go' : '. Shift+Q to let go'}. Left and right lead the aim`, 4);
  }

  private fire(): void {
    const { ctx } = this;
    const d = this.diver;
    const dir = this.look(this.dir);
    const can = canFire({ under: this.mode === 'under' && this.dazed <= 0, reload: this.reload, inHand: !!this.inHand || !!this.shot || !!this.fight, zone: this.zone, atLobster: !!aimAt(d, dir, this.lobsterMarks()).hit });
    const live = this.fish.filter((f) => (f.mode === 'cruise' || f.mode === 'bolt') && f.count === 1);
    const result = aimAt(d, dir, live);
    const verdict = can.ok ? canFire({ under: true, reload: 0, inHand: false, zone: null, atLobster: false, spare: result.hit?.species.spare }) : can;
    if (!verdict.ok) {
      ctx.say(verdict.say, 6);
      return;
    }
    this.shot = {
      from: new THREE.Vector3(d.x, -d.d, -d.y), dir: new THREE.Vector3(dir.x, -dir.d, -dir.y), range: result.range, gone: 0, hit: result.hit, near: result.near, landed: false,
      spot: result.spot, off: result.off, radius: result.radius, side: result.side,
    };
    ctx.sound.thud(0.25);
    ctx.sound.diving('thunk', 0.8);
    this.recoil = 1;
    this.scene.bubble(this.muzzle.x, this.muzzle.y, this.muzzle.z, 4);
  }

  /** The shaft has got where it was going. */
  private land(): void {
    const { ctx } = this;
    const shot = this.shot!;
    shot.landed = true;
    const f = shot.hit;
    this.tip.copy(shot.from).addScaledVector(shot.dir, shot.range);
    if (!f) {
      const fled = spook(this.fish, this.tip.x, -this.tip.z, -this.tip.y);
      ctx.say(`Missed${shot.near ? `, just wide of the ${shot.near.species.name}` : ''}. ${fled ? 'Everything near has bolted and will be shy of you for a minute. Wait, keep still, and let them come back' : 'Nothing was in range: the shaft is good for three or four metres'}`, 7);
      this.reload = GUN.reload;
      return;
    }
    const strike = this.strike = strikeOf(shot, f.kg);
    spook(this.fish, f.x, f.y, f.d);
    if (strike === 'torn') {
      // Through the thin of it: the shaft will not hold, and the fish is off, hurt and frightened.
      f.mode = 'bolt';
      f.fear = 1;
      f.left = 3;
      shot.hit = null;
      this.reload = GUN.reload;
      ctx.say(`The shaft tore out of the ${f.species.name}: too far, too end-on or too far back for a fish that size. Get closer and take it side-on`, 7);
      return;
    }
    f.mode = 'held';
    if (strike === 'stone') {
      ctx.say(`A stone shot: through the head, and the ${f.species.name} is still at once`, 4);
      this.decide(f, shot.range);
      return;
    }
    if (f.kg < 0.5) { this.decide(f, shot.range); return; }
    const bolt = boltholeOf(f.species);
    const cover = bolt === 'kelp' ? (this.ground?.cover === 'kelp' ? 2 + 4 * hash01(f.index, this.shift, 801) : Infinity) : bolt === 'hole' ? 1.5 + 3 * hash01(f.index, this.shift, 802) : Infinity;
    this.fight = newFight(f.kg, holdOf(f.kg, shot.range, shot.spot, shot.side), Number.isFinite(cover) ? bolt : 'run', cover, hash01(f.index, this.shift, 803));
    ctx.say(`${cap(f.species.name)} on, ${strike === 'tail' ? 'by the tail, and the shaft will not hold much strain' : 'through the body'}! It is running${bolt === 'kelp' ? ' for the kelp' : bolt === 'hole' ? ' for a hole in the reef' : ''}. Give it line while it surges; kick to haul it in when it eases`, 7);
  }

  /** The fish is hers or it is the warden's. */
  private decide(f: Fish, range: number): void {
    const { ctx } = this;
    const aboard = this.stringer.filter((c) => c.id === f.species.id).length;
    const verdict = judge(f, aboard, range, !diveLog().species[f.species.id]);
    this.taken.add(`${this.stockKey}:f${f.index}`);
    this.fight = null;
    if (verdict.keep) {
      verdict.awards.push(...huntAwards(f.species, f.cm, this.strike, this.targets.some((t) => t.id === f.species.id)));
      this.inHand = { fish: f, verdict, strike: this.strike };
      ctx.say(`${verdict.say}. Take it up to the float`, 8);
      return;
    }
    for (const a of verdict.awards) ctx.logbook.earn(a);
    ctx.alarm(verdict.say);
    f.mode = 'gone';
    f.left = 1e9;
    this.shot = null;
    this.reload = GUN.reload;
  }

  /** The fight on the line is over, one way or the other. */
  private fightOver(end: NonNullable<Fight['end']>): void {
    const { ctx } = this;
    const f = this.shot?.hit;
    if (!f) { this.fight = null; return; }
    if (end === 'landed') { this.decide(f, this.shot!.range); return; }
    this.fight = null;
    f.mode = 'bolt';
    f.fear = 1;
    f.left = 3;
    f.shy = 120;
    this.shot!.hit = null;
    this.shot!.landed = true;
    this.reload = GUN.reload;
    ctx.say(end === 'torn' ? `The shaft tore out: you hauled while it surged. Let it run when it pulls, and haul between` : end === 'wrapped' ? `The ${f.species.name} wrapped the line round the kelp and tore free. Haul it out before it gets in there` : `The ${f.species.name} holed up in the reef and you had to let it go. Do not let it reach the rock`, 8);
  }

  /** She is up, with whatever is on the shaft: on to the stringer under the float with it. */
  private string(): void {
    const hand = this.inHand;
    if (!hand) return;
    const { ctx } = this;
    const f = hand.fish;
    this.inHand = null;
    this.shot = null;
    this.reload = 1.5;
    f.mode = 'gone';
    f.left = 1e9;
    const best = diveLog().species[f.species.id]?.best ?? 0;
    this.stringer.push({ id: f.species.id, name: f.species.name, size: f.cm, unit: 'cm', fish: f, onFloat: true });
    logCatch(f.species.id, f.species.name, f.cm, 'cm');
    // A speared fish is a fish landed, and is counted with the ones the line catches.
    ctx.logbook.count('fish');
    ctx.logbook.count('speared');
    for (const a of hand.verdict.awards) ctx.logbook.earn(a);
    const pb = best > 0 && f.cm > best ? ` A personal best: your biggest before was ${best} cm.` : '';
    ctx.say(`On the stringer: ${f.species.name}, ${f.cm} cm.${pb} The gun is loaded again`, 6);
  }

  /** G: a lobster or a shellfish by hand, whichever is nearest within reach. */
  private reach(): void {
    const { ctx } = this;
    const rule = this.file.lobster;
    if (this.mode !== 'under' || this.dazed > 0) {
      ctx.say('Lobster and shellfish live on the bottom. Get down among the rocks, then G');
      return;
    }
    this.reaching = 1;
    const d = this.diver;
    let best: Lobster | null = null;
    let bestD = 1.7;
    for (const l of this.lobsters) {
      const dist = Math.hypot(l.x - d.x, l.y - d.y, l.d - d.d);
      if (l.mode === 'there' && dist < bestD) { best = l; bestD = dist; }
    }
    let thing: HandThing | null = null;
    for (const t of this.hand) {
      const dist = Math.hypot(t.x - d.x, t.y - d.y, t.d - d.d);
      if (t.mode === 'there' && dist < bestD) { thing = t; bestD = dist; best = null; }
    }
    if (thing) { this.takeThing(thing); return; }
    if (!best || !rule) {
      ctx.say('Nothing in reach. Look for the long feelers sticking out from under a ledge, or a scallop\'s lip on the rock', 5);
      return;
    }
    const got = grab(best, d);
    if (got === 'far') ctx.say('Not quite in reach. Closer, and slowly', 4);
    else if (got === 'deep') ctx.say(best.deep ? 'It has backed too far into its hole to reach. They come out to walk the reef after dark' : 'It has backed off into the dark of its hole. Wait in front of it, still, and it will creep back to the mouth', 6);
    else if (got === 'fled') {
      best.mode = 'fled';
      best.left = GRAB.away;
      ctx.say('Gone, backwards, with one flick of its tail. Come at it from the front, slowly, and pin it down', 6);
    } else {
      const season = this.season();
      const bag = this.stringer.filter((c) => c.id === 'lobster').length;
      const g = gauge(best.mm, rule, !!season?.open, bag, this.zone);
      if (!g.keep) {
        best.mode = 'fled';
        best.left = 20;
        ctx.say(`Got it. ${g.say}`, 8);
        return;
      }
      best.mode = 'caught';
      this.taken.add(`${this.stockKey}:l${best.index}`);
      this.stringer.push({ id: 'lobster', name: 'lobster', size: best.mm, unit: 'mm', onFloat: false });
      // One taken in practice is practice: a couple of points, and not a lobster in the logbook or the dive log.
      const practice = !!season?.practice;
      const worth = lobsterAwards(practice, practice ? false : logCatch('lobster', rule.name, best.mm, 'mm'));
      if (worth.counts) ctx.logbook.count('lobsters');
      for (const a of worth.awards) ctx.logbook.earn(a);
      ctx.say(`Got it. ${g.say}${practice ? '. Practice: it is not counted in your logbook' : ''}`, 8);
    }
  }

  private takeThing(t: HandThing): void {
    const { ctx } = this;
    const aboard = this.stringer.filter((c) => c.id === t.spec.id).length;
    const v = takeByHand(t, this.diver, aboard, this.zone, !diveLog().species[t.spec.id]);
    if (v.why === 'protected') {
      for (const a of v.awards) ctx.logbook.earn(a);
      ctx.alarm(v.say);
      return;
    }
    if (!v.ok) { ctx.say(v.say, 5); return; }
    t.mode = 'taken';
    this.taken.add(`${this.stockKey}:h${t.index}`);
    this.stringer.push({ id: t.spec.id, name: t.spec.name, size: t.cm, unit: 'cm', onFloat: false });
    logCatch(t.spec.id, t.spec.name, t.cm, 'cm');
    for (const a of v.awards) ctx.logbook.earn(a);
    this.scene.drawHand();
    ctx.say(v.say, 6);
  }

  private blackout(): void {
    const { ctx } = this;
    const lost = this.inHand || this.fight ? ` The ${(this.inHand?.fish ?? this.shot?.hit)?.species.name ?? 'fish'} is gone with the shaft line cut.` : '';
    this.inHand = null;
    this.shot = null;
    this.fight = null;
    this.dazed = 12;
    this.finishDive();
    this.diver.d = 0;
    this.diver.vx = this.diver.vy = this.diver.vd = 0;
    this.dazed = 12;
    this.reload = GUN.reload;
    ctx.logbook.earn({ kind: 'lost', points: DIVE_POINTS.blackout, label: 'Blackout' });
    ctx.alarm(`Blackout. You came round on the surface, hanging on the float.${lost} Nobody was there to bring you up: never dive alone, and come up with breath to spare`);
  }

  /** She has reached the top. */
  private finishDive(): void {
    this.last = { depth: this.breath.deepest, seconds: this.breath.under };
    logDive(this.breath.deepest, this.breath.under);
    // A dive she came up from with air in hand is practice, and practice is what makes lungs.
    this.gained = this.dazed > 0 ? 0 : cleanDive(this.breath.under, this.breath.deepest, this.breath.air);
    if (this.gained) {
      const was = this.lungs.level;
      this.ctx.logbook.count('freedive', this.gained);
      this.lungs = lungsFor(this.ctx.logbook.totals.freedive);
      if (this.lungs.level > was) this.ctx.alarm(`Your lungs have grown with the practice: freediving level ${this.lungs.level}, ${this.lungs.name}. ${Math.round(this.lungs.hold)} s on a breath, comfortable to ${Math.round(this.lungs.easy)} m`);
    }
    surfaced(this.breath, this.lungs);
    this.mode = 'surface';
    this.ascending = false;
    this.callAt = 'ok';
    this.limitTold = false;
    // The breath let go at the top: a burst of bubbles, and the blow through the snorkel.
    this.scene.bubble(this.camera.position.x, -0.3, this.camera.position.z, 6);
    this.ctx.sound.diving('exhale', 0.7);
  }

  // ---- every frame --------------------------------------------------------------------------------------------

  update(dtReal: number, seaTime: number): void {
    this.flagsOfOthers(seaTime, dtReal);
    if (this.mode === 'aboard') return;
    const { ctx } = this;
    const { stage, world, sim } = ctx;
    const dt = Math.min(dtReal, 0.1);
    this.clock += dt;
    const d = this.diver;
    const bottom = this.scene.floorAt;
    if (this.still > 0) this.still -= dt;

    // The tender she came in lies where she left it.
    const tender = this.tender();
    if (tender && this.from === 'tender') { tender.kayak.x = this.pinned.x; tender.kayak.y = this.pinned.y; tender.kayak.speed = 0; }

    // Looking about: the arrows turn her and put her head down, E brings it up, and a drag turns her head.
    const drive = this.drive;
    const turn = drive?.turn ?? ((ctx.held('ArrowRight') || ctx.held('KeyD') ? 1 : 0) - (ctx.held('ArrowLeft') || ctx.held('KeyA') ? 1 : 0));
    const nod = drive?.nod ?? ((ctx.held('KeyE') ? 1 : 0) - (ctx.held('ArrowDown') || ctx.held('KeyS') ? 1 : 0));
    const locked = this.dazed > 0;
    const lock = this.locked();
    if (lock && !locked) {
      // The lock does the looking: her body turns to keep it in front of her, smoothly. Left and right dial in a lead.
      this.lead = THREE.MathUtils.clamp(this.lead + turn * 0.5 * dt, -0.4, 0.4);
      const want = lookToward(d, lock, this.lead);
      d.yaw += wrap(want.yaw - d.yaw) * Math.min(1, dt * 3.2);
      if (!this.ascending) d.pitch += (THREE.MathUtils.clamp(want.pitch, -1.45, 1.45) - d.pitch) * Math.min(1, dt * 3.2);
      this.headYaw *= 1 - Math.min(1, dt * 4);
      const broke = lockBreaks(d, this.look(this.dir), lock, this.seen);
      if (broke) { this.lockKey = null; ctx.say(broke === 'gone' ? 'Lock lost: it has gone' : broke === 'far' ? 'Lock lost in the murk' : 'Lock lost behind you', 3); }
    } else if (!locked) {
      d.yaw += turn * 1.5 * dt;
      d.pitch = THREE.MathUtils.clamp(d.pitch + nod * 1.1 * dt - this.drag.y * 0.004, -1.45, 1.45);
      // A drag turns her head, as far as over her shoulder; it comes back round to the front as she swims on.
      this.headYaw = THREE.MathUtils.clamp(this.headYaw + this.drag.x * 0.004, -2.6, 2.6);
      if (this.sinceKick < 1 && !this.dragging) this.headYaw *= 1 - Math.min(1, dt * 1.2);
    }
    if (this.lockKey && !lock) this.lockKey = null;
    this.drag.x = this.drag.y = 0;
    // Turned for the surface: head up, and an easy kick all the way.
    if (this.ascending) d.pitch += (1.35 - d.pitch) * Math.min(1, dt * 3);
    // A duck dive: the jackknife at the top, head going down hard for a moment.
    if (this.duck > 0) { this.duck -= dt; d.pitch += (-1.15 - d.pitch) * Math.min(1, dt * 4); }
    this.turnRate += (wrap(d.yaw - this.lastYaw) / Math.max(dt, 1e-3) - this.turnRate) * Math.min(1, dt * 5);
    this.lastYaw = d.yaw;

    // Fins. Each press of the up arrow is one stroke; held, they come in an easy rhythm. Between strokes she glides.
    // With a fish on the line, a stroke is a haul against it.
    const up = ctx.held('ArrowUp') || ctx.held('KeyW');
    this.sinceKick += dt;
    const rhythm = drive?.kick ? 1 / drive.kick : this.ascending ? 1 : up ? KICK.rhythm : Infinity;
    const tapped = up && !this.wasUp && this.sinceKick >= KICK.fastest;
    this.wasUp = up;
    const dir = this.bodyDir(this.swim);
    const fight = this.fight;
    if (!locked && this.still <= 0 && (tapped || this.sinceKick >= rhythm)) {
      // At the surface a stroke with her head down is a duck dive; with it up she swims along the top.
      const flat = this.mode === 'surface' && d.pitch > -0.25;
      const c = flat ? 1 / Math.max(0.2, Math.hypot(dir.x, dir.y)) : 1;
      const thrust = fight ? KICK.thrust * 0.3 : KICK.thrust;
      d.vx += dir.x * c * thrust;
      d.vy += dir.y * c * thrust;
      if (!flat) d.vd += dir.d * thrust;
      this.kickRate = Math.min(3, 1 / Math.max(0.3, this.sinceKick));
      this.sinceKick = 0;
      this.stroke = 1;
      this.kicks++;
      if (this.mode === 'under') ctx.sound.diving('kick', 0.4);
      // A fin stroke close over sand puts up a puff of it.
      if (this.mode === 'under') {
        const fx = d.x - dir.x * 1.6;
        const fy = d.y - dir.y * 1.6;
        const fd = d.d - dir.d * 1.6;
        const floor = bottom(fx, fy);
        if (floor - fd < 0.9 && this.ground && this.ground.rock(fx, fy) < 0.5) this.scene.silt(fx, -floor, -fy, 5, this.clock, 0.4);
      }
    }
    // The kick she can see and feel: the legs sweep half a cycle for each stroke and trail off in the glide.
    const kicking = this.sinceKick < 1.1;
    this.kickAmp += ((kicking ? 1 : 0.12) - this.kickAmp) * Math.min(1, dt * 3);
    this.kickPhase += dt * (kicking ? Math.PI / Math.max(0.35, Math.min(1.2, rhythm === Infinity ? 0.9 : rhythm)) : 1.2);
    // The rate she is kicking at fades as she glides: that, and the depth, is what the breath is spent on.
    this.kickRate = Math.min(this.kickRate, 1 / Math.max(0.3, this.sinceKick));
    if (this.sinceKick > 2.5) this.kickRate = 0;
    this.stroke = Math.max(0, this.stroke - dt * 2.4);
    const effort = effortOf(this.kickRate);
    const speed = Math.hypot(d.vx, d.vy, d.vd);
    const slowed = glide(speed, dt);
    if (speed > 1e-4) { const k = slowed / speed; d.vx *= k; d.vy *= k; d.vd *= k; }
    // A fish on the line: worked between its surges, and when it has run out the line it tows her.
    if (fight && this.shot?.hit) {
      const f = this.shot.hit;
      this.hauling = Math.max(0, this.hauling - dt * 2);
      if (this.sinceKick < 0.5 || up) this.hauling = 1;
      const end = stepFight(fight, dt, this.hauling > 0.5);
      if (fight.out >= LINE.long - 0.05) {
        d.vx += (Math.sin(f.heading) * 0.9 * fight.pull - d.vx) * Math.min(1, dt * 2);
        d.vy += (Math.cos(f.heading) * 0.9 * fight.pull - d.vy) * Math.min(1, dt * 2);
      }
      if ((this.thrash -= dt) <= 0) { this.thrash = 0.35; ctx.sound.diving('thrash', Math.min(1, fight.pull / 2)); }
      if (end) this.fightOver(end);
    } else this.hauling = Math.max(0, this.hauling - dt * 2);
    // Her buoyancy: the air in her lungs and suit floats her near the top and squeezes small down deep.
    // Drifting, she lies broadside to the water and floats up or sinks slowly; finning, she cuts through it.
    if (this.mode === 'under') {
      d.vd += buoyancy(d.d, this.suitL) * dt;
      if (this.sinceKick > 1 && this.duck <= 0) d.vd /= 1 + 2.5 * Math.abs(d.vd) * dt;
    }

    // The water moves too: the stream all the way down, the surge near the top.
    world.current(d.x, d.y, sim.state.t, this.current);
    const sea = ctx.seaway.sea;
    const push = surge(sea.height, sea.swellPeriod > 0 ? sea.swellPeriod : sea.period, d.d, this.clock);
    const sx = this.surgeX = -Math.sin(sea.dir) * push;
    const sy = this.surgeY = -Math.cos(sea.dir) * push;
    if (this.still <= 0) {
      const nx = d.x + (d.vx + this.current.x + sx) * dt;
      const ny = d.y + (d.vy + this.current.y + sy) * dt;
      const floorNew = bottom(nx, ny);
      if (floorNew > 0.7 || floorNew > bottom(d.x, d.y)) { d.x = nx; d.y = ny; } else { d.vx = d.vy = 0; }
    }
    const floor = bottom(d.x, d.y);
    const lungs = this.lungs;

    if (this.dazed > 0) this.dazed -= dt;
    if (this.mode === 'surface') {
      const resting = Math.hypot(d.vx, d.vy) < 0.2;
      const before = this.breath.prep;
      recover(this.breath, dt, resting);
      if (before < 1 && this.breath.prep >= 1) ctx.say('Breathed up: slow and full. This dive will go further on it', 5);
      // Her own breathing, out through the snorkel.
      if ((this.breathe -= dt) <= 0) { this.breathe = this.breath.rest > 0 ? 2.2 : 4; ctx.sound.diving('breath', this.breath.rest > 0 ? 0.8 : 0.35); }
      // Down she goes: a stroke with her head down, and a jackknife that drives her under.
      if (this.dazed <= 0 && d.vd > 0.12 && floor > 1.2) {
        d.d = 0.08;
        d.vd = Math.max(d.vd, 0.95);
        this.duck = 0.7;
        this.mode = 'under';
        this.briefing = 0;
        this.urged = false;
      } else { d.d = 0; d.vd = Math.max(0, d.vd) * 0.5; }
      // Beside the boat, the stringer is handed up and safe.
      const home = this.home();
      if (Math.hypot(home.x - d.x, home.y - d.y) <= ENTRY.reach + home.half) {
        const n = this.handUp();
        if (n && !this.handedTold) { this.handedTold = true; ctx.say(`Handed ${n === 1 ? 'the fish' : `${n} fish`} up into the ${this.from === 'tender' ? 'tender' : 'boat'}: safe from any sea lion`, 5); }
      } else this.handedTold = false;
    } else if (this.still <= 0) {
      d.d += d.vd * dt;
      const deepest = Math.min(lungs.limit, Math.max(0.3, floor - 0.35));
      if (d.d > deepest) {
        d.d = deepest;
        d.vd = Math.min(0, d.vd);
        if (deepest === lungs.limit && !this.limitTold) { this.limitTold = true; ctx.say(`${Math.round(lungs.limit)} m: as deep as your lungs will take you yet, and there is the way back to pay for`, 6); }
      }
      const call = holdBreath(this.breath, lungs, d.d, effort, dt, !!fight);
      if (call === 'blackout') this.blackout();
      else {
        if (call !== this.callAt && (call === 'warn' || call === 'danger')) ctx.alarm(call === 'warn' ? 'Low on breath. Turn for the surface now: 5' : 'Blackout risk: up, now');
        if (call !== 'ok' && !this.urged) {
          this.urged = true;
          ctx.say(`The urge to breathe: the first contractions. There is air left yet${this.breath.deepest > lungs.easy ? ', but from this deep the last metres up take more than you think' : '. How much further is your choice'}`, 7);
        }
        this.callAt = call === 'urge' ? 'ok' : call;
        // Contractions: a thump in the chest that comes quicker as the breath runs down.
        const want = urge(this.breath.air);
        if (want > 0 && (this.pulse -= dt) <= 0) {
          this.pulse = 2.4 - 1.6 * want;
          this.throb = 1;
          ctx.sound.diving('pulse', want);
        }
        if (d.d <= 0.05) {
          d.d = 0;
          const left = this.breath.air;
          this.finishDive();
          this.string();
          if (this.last.seconds > 8) ctx.say(`Up after ${clock(this.last.seconds)}, ${this.last.depth.toFixed(1)} m at the deepest, ${Math.round(left * 100)}% of the breath left. ${this.gained ? `A clean dive: ${this.gained} toward your lungs. ` : left < 0.15 ? 'That was close to the edge: turn sooner. ' : ''}Rest ${Math.round(this.breath.rest)} s, then breathe up on the float`, 8);
        }
      }
    }
    // Under water: her heart in her ears, quickening with the urge to breathe; the reef's crackle; a boat going by.
    if (this.mode === 'under') {
      const want = urge(this.breath.air);
      if ((this.heart -= dt) <= 0) { this.heart = 60 / (52 + 64 * want); ctx.sound.diving('heart', 0.25 + 0.6 * want); }
      if ((this.crackle -= dt) <= 0) { this.crackle = 0.15 + 0.8 * hash01(Math.floor(this.clock * 20), 77); ctx.sound.diving('crackle', 0.3 + 0.5 * hash01(Math.floor(this.clock * 20), 78)); }
      if ((this.engine -= dt) <= 0) {
        this.engine = 1.1;
        let near = Infinity;
        for (const v of stage.traffic.vessels) if (v.sog > 1) near = Math.min(near, Math.hypot(v.x - d.x, v.y - d.y));
        if (near < 400) ctx.sound.diving('engine', Math.min(1, 60 / Math.max(30, near)));
      }
    }

    // Too far from where the bottom was built: build it again about her. A hitch, and a rare one.
    if (!this.forced && Math.hypot(d.x - this.centre.x, d.y - this.centre.y) > RADIUS - 13) this.settle(d.x, d.y);
    this.zone = this.forced ? this.forcedZone : zoneAt(this.file, d.x, d.y);

    // A vessel going over her fast: a fright, and up she comes.
    if (this.mode === 'under' && !this.ascending) {
      const over = runOver(d, stage.traffic.vessels) ?? runOver(d, ctx.company());
      if (over) {
        this.ascending = true;
        ctx.alarm(`A boat is going over the top of you, fast. You are coming up beside your flag: watch for her`);
      }
    }

    this.life(dt);
    this.gun(dt);
    this.robber(dt);
    this.draw(dt, seaTime, floor);
  }

  /** The fish and the lobster, each minding the diver. */
  private life(dt: number): void {
    const d = this.diver;
    const g = this.ground!;
    const diver = this.mode === 'under' ? d : { ...d, d: 0.2 };
    for (const f of this.fish) {
      if (f === this.shot?.hit) continue;
      stepFish(f, diver, dt, this.clock, this.scene.floorAt, g.cover === 'kelp' && g.grows((f.x + d.x) / 2, (f.y + d.y) / 2));
      // A flatfish or a ray lifting off the sand goes up in a cloud of it.
      if (f.kicked) { f.kicked = 0; this.scene.silt(f.x, -this.scene.floorAt(f.x, f.y), -f.y, 16, this.clock, Math.max(0.4, f.cm / 150)); }
    }
    const speed = Math.hypot(d.vx, d.vy, d.vd);
    for (const l of this.lobsters) {
      if (l.mode === 'fled') { l.left -= dt; if (l.left <= 0) l.mode = 'there'; continue; }
      lobsterShies(l, diver, dt);
      // A diver thrashing up to it sends it back into its hole before she is near.
      if (l.mode === 'there' && speed > GRAB.lunge + 0.15 && Math.hypot(l.x - d.x, l.y - d.y, l.d - d.d) < 2.2) { l.mode = 'fled'; l.left = 25; }
    }
    // What she is looking at, named for her, and its rule said the first time she is close to one.
    if ((this.think -= dt) > 0) return;
    this.think = 0.25;
    const dir = this.look(this.dir);
    const lockFish = this.locked()?.fish;
    let best: Fish | null = lockFish ?? null;
    let bestOff = 0.9;
    for (const f of this.fish) {
      if (f.mode !== 'cruise' && f.mode !== 'bolt') continue;
      const rx = f.x - d.x;
      const ry = f.y - d.y;
      const rd = f.d - d.d;
      const along = rx * dir.x + ry * dir.y + rd * dir.d;
      const dist = Math.hypot(rx, ry, rd);
      const sp = f.species;
      // A moment: the first giant sea bass of a dive, come to look at her.
      if (sp.moment && this.mode === 'under' && dist < 6 && !this.moments.has(sp.id)) {
        this.moments.add(sp.id);
        this.ctx.alarm(sp.moment);
        if (sight(`dive-${sp.id}`) === 1) this.ctx.logbook.count('seen');
      }
      if (along < 0.3 || along > Math.min(9, this.seen)) continue;
      const off = Math.hypot(rx - dir.x * along, ry - dir.y * along, rd - dir.d * along) / (1 + along * 0.12);
      if (!lockFish && off < bestOff) { best = f; bestOff = off; }
      const id = f.young ? `${sp.id}-young` : f.male ? `${sp.id}-male` : sp.id;
      if (this.mode === 'under' && along < 5 && off < 1.4 && !this.told.has(id)) {
        this.told.add(id);
        this.told.add(sp.id);
        this.ctx.say(f.young && sp.young ? sp.young.say : f.male && sp.male?.say && this.told.has(`${sp.id}-said`) ? sp.male.say : sp.say, 9);
        this.told.add(`${sp.id}-said`);
        // Every kind met under water goes in the dive log's count; the ones nobody hunts are finds, kept with the
        // wildlife seen from the deck.
        if (logSeen(id)) this.ctx.logbook.earn({ kind: 'dive', points: 3, label: `First ${f.young ? `young ${sp.name}` : sp.name} seen` });
        if ((sp.protected || sp.spare || f.young) && sight(`dive-${id}`) === 1) this.ctx.logbook.count('seen');
      }
    }
    for (const t of this.hand) {
      if (t.mode !== 'there' || this.told.has(t.spec.id) || this.mode !== 'under') continue;
      if (Math.hypot(t.x - d.x, t.y - d.y, t.d - d.d) < 2.5) {
        this.told.add(t.spec.id);
        this.ctx.say(t.spec.say, 8);
        if (logSeen(t.spec.id) && t.spec.protected && sight(`dive-${t.spec.id}`) === 1) this.ctx.logbook.count('seen');
      }
    }
    this.aim = best;
  }

  /** The shaft on its way, a fish running on the line, and the loading of the bands. */
  private gun(dt: number): void {
    const d = this.diver;
    if (this.reload > 0 && !this.shot) this.reload = Math.max(0, this.reload - dt);
    const shot = this.shot;
    if (!shot) return;
    if (!shot.landed) {
      shot.gone += GUN.speed * dt;
      if (shot.gone >= shot.range) this.land();
      return;
    }
    const f = shot.hit;
    const fight = this.fight;
    if (f && fight) {
      // It runs on the line, off the end of the gun, toward its cover, turning as it goes.
      f.heading += Math.sin(this.clock * 1.7) * (0.8 + fight.pull) * dt;
      const out = 0.8 + fight.out;
      f.x = d.x + Math.sin(f.heading) * out;
      f.y = d.y + Math.cos(f.heading) * out;
      f.d = Math.max(0.8, Math.min(this.scene.floorAt(f.x, f.y) - 0.3, d.d + 0.6 * Math.sin(this.clock * 2.3) + (fight.toward === 'hole' ? fight.made * 0.4 : 0)));
      return;
    }
    if (!f) {
      // A miss: the shaft comes back on its line as the bands are loaded.
      this.reload = Math.max(0, this.reload - dt);
      shot.gone = shot.range * Math.min(1, this.reload / GUN.reload);
      if (this.reload <= 0) this.shot = null;
    }
  }

  /** A sea lion after the fish on her float. */
  private robber(dt: number): void {
    if (!this.thiefName || !this.site) return;
    const { ctx } = this;
    const d = this.diver;
    const home = this.home();
    const onFloat = this.stringer.filter((k) => k.onFloat && k.fish).length;
    const r = thiefStep(this.thief, {
      onFloat, fromBoat: Math.hypot(home.x - d.x, home.y - d.y), guarding: this.mode === 'surface' && Math.hypot(this.floatAt.x - d.x, -this.floatAt.z - d.y) < 3,
      thief: true, key: nameKey(this.site.id) + this.shift, t: this.clock, dt,
    });
    if (r === 'warn') ctx.alarm(`A ${this.thiefName} is working along the kelp, eyeing the fish on your float. Get up to the float and stay by it, or get them to the boat`);
    else if (r === 'leave') ctx.say(`The ${this.thiefName} has lost interest and gone`, 5);
    else if (r === 'steal') {
      let i = -1;
      for (let k = this.stringer.length - 1; k >= 0; k--) if (this.stringer[k].onFloat && this.stringer[k].fish) { i = k; break; }
      const lost = i >= 0 ? this.stringer.splice(i, 1)[0] : null;
      ctx.alarm(`The ${this.thiefName} took your ${lost?.name ?? 'fish'} off the stringer and was gone with it. Next time get them to the boat`);
    }
  }

  private draw(dt: number, seaTime: number, floor: number): void {
    const { ctx } = this;
    const { stage } = ctx;
    const d = this.diver;
    const sky = stage.sky;
    const sea = ctx.seaway.sea;
    const chase = this.view === 'chase';

    // Where her eyes are: under, at her depth; at the top, in and out of the water with the waves.
    const wantEye = this.mode === 'under' ? d.d : d.pitch < -0.12 || this.dazed > 0 ? 0.3 : -0.32;
    this.eyeDepth = this.mode === 'under' ? d.d : this.eyeDepth + (wantEye - this.eyeDepth) * Math.min(1, dt * 5);
    const level = stage.seaLevel(d.x, -d.y, seaTime);
    const headY = (this.mode === 'under' ? 0 : level) - this.eyeDepth;
    const cam = this.camera;

    // The view follows the way she looks with a little inertia, rolls into her turns, and nods with each stroke.
    const viewYaw = d.yaw + this.headYaw;
    if (!this.camSet) { this.camYaw = viewYaw; this.camPitch = d.pitch; this.camSet = true; }
    const ease = Math.min(1, dt * (chase ? 5 : 11));
    this.camYaw += wrap(viewYaw - this.camYaw) * ease;
    this.camPitch += (d.pitch - this.camPitch) * ease;
    const fight = this.fight;
    const tug = fight ? Math.min(1, fight.tension / 2) : 0;
    this.camRoll += (THREE.MathUtils.clamp(-this.turnRate * 0.06, -0.12, 0.12) - this.camRoll) * Math.min(1, dt * 3);
    const sway = 0.03 * Math.sin(this.stroke * Math.PI) * (this.kicks % 2 ? 1 : -1);
    const lookX = Math.sin(this.camYaw) * Math.cos(this.camPitch);
    const lookY = Math.sin(this.camPitch);
    const lookZ = -Math.cos(this.camYaw) * Math.cos(this.camPitch);
    this.lookVec.set(lookX, lookY, lookZ);
    const speed = Math.hypot(d.vx, d.vy, d.vd);
    if (!chase) {
      cam.position.set(d.x, headY, -d.y);
      cam.rotation.set(this.camPitch + (this.dazed > 0 ? 0.25 * Math.sin(this.clock * 1.3) : 0) - 0.02 * Math.sin(this.stroke * Math.PI) + tug * 0.03 * Math.sin(this.clock * 13), -this.camYaw, this.camRoll + (this.dazed > 0 ? 0.2 * Math.sin(this.clock * 0.9) : 0) + sway + tug * 0.03 * Math.sin(this.clock * 9));
      if (cam.fov !== 58) { cam.fov = 58; cam.updateProjectionMatrix(); }
    } else {
      // Behind her and a little above, looking past her at the point the shaft would reach; pulled in rather than go
      // into the rock or the kelp, and a little further back the faster she goes.
      // The camera hangs back along half her pitch, so a duck dive is seen from behind and above, not from her fins.
      const want = chaseLength(speed) + (this.mode === 'surface' ? 0.4 : 0);
      const upBy = this.mode === 'surface' ? 1.1 : CHASE.up;
      const half = this.camPitch * 0.3;
      const eyeSim = { x: d.x, y: d.y, d: -headY };
      const under = this.mode === 'under';
      const solid = (x: number, y: number, dd: number) => (dd > this.scene.floorAt(x, y) - 0.2) || (under && dd > 0.6 && this.scene.kelpNear(x, y, 0.15));
      // If the line back is blocked close in, the camera climbs over her rather than come down into her fins.
      let back = { x: 0, y: 0, d: -1 };
      let blen = want;
      let reach = 0;
      for (const climb of [0, 0.5, 1]) {
        const bx = -Math.sin(this.camYaw) * Math.cos(half) * want * (1 - climb * 0.6);
        const by = -Math.sin(half) * want + upBy + climb * want * 0.8;
        const bz = Math.cos(this.camYaw) * Math.cos(half) * want * (1 - climb * 0.6);
        const len = Math.hypot(bx, by, bz);
        const dirB = { x: bx / len, y: -bz / len, d: -by / len };
        const r = chaseReach(eyeSim, dirB, len, solid);
        if (r > reach) { reach = r; back = dirB; blen = len; }
        if (r >= Math.min(len, 1.9)) break;
      }
      this.a.set(d.x + back.x * reach, headY - back.d * reach, -d.y - back.y * reach);
      // Under water the lens stays under water.
      if (under) this.a.y = Math.min(this.a.y, -0.3);
      if (this.camPos.distanceTo(this.a) > 6 || !Number.isFinite(this.camPos.x)) this.camPos.copy(this.a);
      else if (reach < blen - 0.05) this.camPos.copy(this.a);
      else this.camPos.lerp(this.a, Math.min(1, dt * 6));
      cam.position.copy(this.camPos);
      cam.position.x += tug * 0.04 * Math.sin(this.clock * 11);
      cam.position.y += tug * 0.03 * Math.sin(this.clock * 7);
      this.b.set(d.x + lookX * 4, headY + lookY * 4, -d.y + lookZ * 4);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.b);
      cam.rotation.z += this.camRoll * 0.5;
      const fov = 58 + 7 * Math.min(1, speed / 1.4);
      if (Math.abs(cam.fov - fov) > 0.2) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 2); cam.updateProjectionMatrix(); }
    }
    // A contraction darkens the edge of the mask for a moment; a blackout takes it all.
    this.throb = Math.max(0, this.throb - dt * 2.5);
    const dark = this.dazed > 9 ? 1 : this.mode === 'under' ? Math.min(0.85, urge(this.breath.air) * 0.35 + this.throb * 0.4) : 0;
    this.veil.style.opacity = dark.toFixed(2);
    const camDepth = -cam.position.y;
    const wet = chase ? camDepth > 0.02 : this.eyeDepth > 0.02;
    // Head under: the world above goes dull and far off, and the mask's edge closes in.
    if (wet !== this.wasWet) { this.wasWet = wet; document.body.classList.toggle('under', wet && !chase); ctx.sound.duck(wet ? 0.15 : 1); }
    document.body.classList.toggle('chase', chase);
    this.seen = underwaterVisibility(this.file.water.visibility, sea.height, this.night);
    const far = wet ? Math.max(60, this.seen * 3.2) : 40000;
    if (cam.far !== far) { cam.far = far; cam.near = wet ? 0.08 : 0.12; cam.updateProjectionMatrix(); }

    // The light that gets down here, and the colour of the water it gets down through.
    const day = THREE.MathUtils.clamp(Math.sin(sky.elevation) * 3 + 0.2, 0.04, 1) * (1 - 0.92 * sky.night);
    const light = this.night ? Math.min(day, 0.07) : day;
    const depthNow = Math.max(0, chase ? camDepth : this.eyeDepth);
    const [r, gr, bl] = lightAt(depthNow);
    const tint = this.file.water.tint;
    this.water.setRGB(tint[0], tint[1], tint[2]).multiplyScalar(1.75 * light * Math.exp(-depthNow * 0.035));
    this.sky.setRGB(0.62, 0.9, 1).multiplyScalar(2.4);
    this.eye.wet = wet;
    this.eye.see = this.seen;
    this.eye.water.copy(this.water);
    this.eye.light.setRGB(r, gr, bl).multiplyScalar(light / Math.max(day, 0.04));
    stage.eye = this.eye;
    this.scene.group.visible = wet;

    const tender = this.tender();
    const s = ctx.sim.state;
    const hulls = [{ x: s.x, z: -s.y, heading: s.heading, length: ctx.spec.dimensions.loa, beam: ctx.spec.dimensions.beam }];
    if (tender) hulls.push({ x: tender.kayak.x, z: -tender.kayak.y, heading: tender.kayak.heading, length: tender.spec.length ?? 3.4, beam: tender.spec.beam ?? 0.9 });
    const strength = Math.min(2.2, 0.35 + sea.height * 1.4);
    const swellTo = (sea.swellHeight > 0.05 ? sea.swellDir : sea.dir) + Math.PI;
    // The muzzle bead: honest about range, and about whether the lead is right.
    const target = this.locked()?.fish ?? this.aim;
    const look = this.look(this.dir);
    this.bead = 0;
    if (target && this.mode === 'under') {
      const cue = leadCue(d, look, target);
      this.bead = cue.onTarget ? 2 : cue.inRange ? 1 : 0;
    }
    this.scene.update(cam, {
      time: this.clock, sun: sky.sunDir, light, water: this.water, sky: this.sky, see: this.seen, lamp: this.night && this.mode === 'under',
      surgeX: -Math.sin(sea.dir) * strength, surgeZ: Math.cos(sea.dir) * strength, surgePeriod: sea.swellPeriod > 0 ? sea.swellPeriod : Math.max(4, sea.period),
      swellX: Math.sin(swellTo), swellZ: -Math.cos(swellTo), swellLength: sea.swellLength > 1 ? sea.swellLength : Math.max(6, sea.length), swellHeight: Math.max(0.15, sea.swellHeight > 0.05 ? sea.swellHeight : sea.height),
      // The specks go with the stream, and to and fro with the surge.
      driftX: (this.current.x + this.surgeX) * dt, driftZ: -(this.current.y + this.surgeY) * dt, hulls, dt,
      loaded: !this.shot && this.reload <= 0, loading: 1 - Math.min(1, this.reload / GUN.reload), recoil: this.recoil,
      firstPerson: !chase, bead: this.bead, aimLine: chase && this.mode === 'under' && !this.shot,
      bio: this.night ? Math.min(1, speed / 1.2 + this.stroke * 0.4) : 0, sway: Math.sin(this.kickPhase), haul: this.hauling,
    }, stage.renderer.domElement.height);
    this.recoil = Math.max(0, this.recoil - dt * 3.5);
    this.reaching = Math.max(0, this.reaching - dt * 1.6);

    // Her own body: the kick, the glide, the reach, the haul.
    const p = this.pose;
    p.x = d.x; p.y = headY; p.z = -d.y;
    p.yaw = d.yaw;
    p.pitch = this.mode === 'surface' ? Math.min(0.1, d.pitch * 0.3) - 0.05 : d.pitch;
    p.roll = this.camRoll * -4;
    p.lookX = lookX; p.lookY = lookY; p.lookZ = lookZ;
    p.kick = this.kickPhase;
    p.kickAmp = this.kickAmp;
    p.arm = this.reaching > 0 ? 'reach' : this.fight ? 'haul' : this.recoil > 0.05 ? 'recoil' : this.mode === 'surface' ? 'float' : 'glide';
    p.armK = this.reaching > 0 ? 1 - this.reaching : this.fight ? (this.clock * 0.8) % 1 : 1 - this.recoil;
    p.firstPerson = !chase;
    p.loaded = !this.shot && this.reload <= 0;
    p.bead = this.bead;
    this.model.pose(p);

    // The shaft: flying, in a fish, or coming back.
    cam.updateMatrixWorld();
    if (chase) this.muzzle.copy(this.model.muzzle);
    else this.muzzle.set(0.1, -0.15, -1.3).applyMatrix4(cam.matrixWorld);
    this.a.set(look.x, -look.d, -look.y);
    this.scene.drawAim(this.muzzle, this.a, GUN.max, chase && this.mode === 'under' && !this.shot);
    const shot = this.shot;
    if (shot) {
      const f = shot.hit;
      if (shot.landed && f) {
        // Brought in to the hand once the fish is hers, held up broadside for a look; out on the line while it runs.
        if (this.fight) this.tip.set(f.x, -f.d, -f.y);
        else if (chase) this.tip.lerp(this.a.copy(this.model.muzzle).addScaledVector(this.lookVec, 0.4), Math.min(1, dt * 3));
        else this.tip.lerp(this.a.set(0.05, -0.1, -1.25).applyMatrix4(cam.matrixWorld), Math.min(1, dt * 3));
        this.heldAt.copy(this.tip);
        if (!this.fight) f.heading = this.camYaw + Math.PI / 2;
        this.b.copy(this.tip).sub(this.muzzle).normalize();
        this.scene.drawShaft(this.tip, this.b, this.muzzle);
      } else {
        this.tip.copy(shot.from).addScaledVector(shot.dir, Math.min(shot.gone, shot.range));
        this.scene.drawShaft(this.tip, shot.dir, this.muzzle);
      }
    } else this.scene.drawShaft(null, this.b, this.muzzle);
    this.scene.gun.visible = this.dazed <= 0 && !chase;
    // The float rides over her, on its line, with her catch hanging under it.
    const fy = level;
    this.float.position.set(d.x + 0.9 * Math.sin(d.yaw + 2.5), fy, -d.y + 0.9 * -Math.cos(d.yaw + 2.5));
    this.float.rotation.set(0.12 * Math.sin(this.clock * 1.1), d.yaw * 0.2 + 0.3 * Math.sin(this.clock * 0.3), 0.1 * Math.sin(this.clock * 1.4));
    this.floatAt.copy(this.float.position);
    const strung = this.stringer.filter((k) => k.onFloat && k.fish) as Array<Kept & { fish: Fish }>;
    this.scene.drawFish(this.fish, this.clock, dt, shot?.landed ? shot.hit : null, shot?.landed && shot.hit ? this.heldAt : null, cam.position, strung.length ? { at: this.floatAt, list: strung } : null);
    // Her breath going up: a burst as she turns for the top, a trickle on the way, and a little with each contraction.
    if (this.mode === 'under' && (this.puff -= dt) <= 0) {
      this.puff = this.ascending || d.vd < -0.35 ? 0.35 : 2.5 + 3 * hash01(Math.floor(this.clock), 79);
      this.scene.bubble(d.x + Math.sin(d.yaw) * 0.12, headY - 0.1, -d.y - Math.cos(d.yaw) * 0.12, this.ascending || d.vd < -0.35 ? 3 : 2);
    }
    this.scene.drawLobsters(this.lobsters, this.clock);
    this.scene.drawFloatLine(this.a.set(d.x, -Math.max(0.3, d.d) + 0.2, -d.y), this.b.set(this.float.position.x, 0, this.float.position.z));

    this.bracketOn(cam);
    this.readout(dt, floor);
  }

  /** The lock's bracket: four soft corners round what she is locked on to. */
  private bracketOn(cam: THREE.PerspectiveCamera): void {
    const m = this.locked();
    if (!m || this.ctx.hud.readoutHidden) { if (!this.bracket.hidden) this.bracket.hidden = true; return; }
    this.a.set(m.x, -m.d, -m.y).project(cam);
    const behind = this.a.z > 1;
    const canvas = this.ctx.stage.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dist = Math.hypot(m.x - this.diver.x, m.y - this.diver.y, m.d - this.diver.d);
    const size = Math.max(28, Math.min(220, ((m.fish ? m.fish.cm / 100 : 0.35) * h) / Math.max(0.5, dist) * 1.1));
    this.bracket.hidden = behind;
    this.bracket.style.transform = `translate(${((this.a.x + 1) / 2) * w - size / 2}px, ${((1 - this.a.y) / 2) * h - size / 2}px)`;
    this.bracket.style.width = this.bracket.style.height = `${Math.round(size)}px`;
    this.bracket.dataset.state = this.bead === 2 ? 'on' : this.bead === 1 ? 'range' : m.legal ? '' : 'no';
  }

  /** The dive panel: where, how deep, the breath, the gun, what she is looking at, the catch and the day's target. Hidden with H. */
  private readout(dt: number, floor: number): void {
    const { ctx } = this;
    this.panel.hidden = ctx.hud.readoutHidden;
    if (this.panel.hidden) return;
    if (this.briefing > 0) this.briefing -= dt;
    const d = this.diver;
    const [where, depth, breath, gun, aim, caught, goal, brief] = this.lines;
    const b = this.breath;
    const text = (el: HTMLElement, t: string) => { if (el.textContent !== t) el.textContent = t; };
    text(where, `${this.site ? this.site.name : 'Open bottom'}${this.zone ? ' · no-take reserve' : ''}${this.practice ? ' · practice' : ''}${this.view === 'chase' ? ' · chase view' : ''}`);
    this.peak = Math.max(this.peak, d.d);
    const cells = depth.children;
    const set = (i: number, t: string) => text(cells[i].firstElementChild as HTMLElement, t);
    set(0, this.mode === 'under' ? `${d.d.toFixed(1)} m` : '0.0 m');
    set(1, clock(this.mode === 'under' ? b.under : 0));
    set(2, `${this.peak.toFixed(1)} m`);
    set(3, `${Math.round(floor)} m`);
    set(4, `${this.file.water.tempC}° · vis ${Math.round(this.seen)} m`);
    const label = breath.firstElementChild as HTMLElement;
    const fill = (breath.lastElementChild as HTMLElement).firstElementChild as HTMLElement;
    text(label, this.dazed > 0 ? 'Dazed' : this.mode === 'under' ? `Lungs · ${clock(b.under)}${b.air < BREATH.urge ? ' · urge to breathe' : ''}` : b.rest > 0 ? `Recovering · ${Math.ceil(b.rest)} s` : b.air >= 1 && b.prep < 1 ? `Breathing up · ${Math.round(b.prep * 100)}%` : b.prep >= 1 ? 'Lungs · breathed up' : 'Lungs · filling');
    fill.style.width = `${Math.round(b.air * 100)}%`;
    breath.dataset.call = this.mode === 'under' ? (b.air < BREATH.danger ? 'danger' : b.air < BREATH.warn ? 'warn' : b.air < BREATH.urge ? 'urge' : 'ok') : 'ok';
    const fight = this.fight;
    text(gun, this.zone ? 'Gun · on safe: no-take reserve' : fight ? `Line · ${fightWord(fight)} · ${fight.out.toFixed(1)} m out` : this.inHand ? `Gun · ${this.inHand.fish.species.name} on the shaft: take it up` : this.shot || this.reload > 0 ? `Gun · loading${this.reload > 0 ? ` ${Math.ceil(this.reload)} s` : ''}` : 'Gun · loaded (F)');
    const m = this.locked();
    const f = m?.fish ?? (m ? null : this.aim);
    if (this.mode === 'under' && (f || m)) {
      const tx = m ?? f!;
      const range = Math.hypot(tx.x - d.x, tx.y - d.y, tx.d - d.d);
      const lockTag = m ? 'Locked · ' : '';
      if (f) {
        const sp = f.species;
        const rule = sp.protected ? 'PROTECTED, do not shoot' : sp.spare ? 'not for the gun' : sp.encouraged ? 'take it' : sp.minCm ? (f.cm >= sp.minCm ? `legal, over ${sp.minCm} cm` : `short: ${sp.minCm} cm to keep`) : 'no size limit';
        const cue = this.bead === 2 ? ', on target' : range <= GUN.effective ? ', in range' : '';
        const name = f.young ? `young ${sp.name}` : f.male ? `${sp.name}, a big male` : sp.name;
        text(aim, `${lockTag}${name}${f.count > 1 ? ' (school)' : `, about ${Math.round(f.cm / 5) * 5} cm`} · ${rule} · ${range.toFixed(1)} m${cue}${this.zone ? ' · gun on safe' : ''}`);
        aim.dataset.rule = sp.protected ? 'no' : '';
      } else if (m?.lobster) {
        const l = m.lobster;
        text(aim, `${lockTag}lobster · ${m.legal ? 'legal size, in season' : 'look, do not take'} · ${range.toFixed(1)} m${range <= GRAB.reach + 0.3 ? ', come at it from the front: G' : ''}${(l.back ?? 0) > 0.6 ? ' · backed into its hole' : ''}`);
        aim.dataset.rule = '';
      } else if (m?.thing) {
        const t = m.thing;
        text(aim, `${lockTag}${t.spec.name}, about ${t.cm} cm · ${t.spec.protected ? 'PROTECTED, look only' : t.spec.minCm ? `keep over ${t.spec.minCm} cm` : `by hand${t.spec.bag ? `, ${t.spec.bag} a day` : ''}`} · ${range.toFixed(1)} m${range <= 1.1 ? ': G' : ''}`);
        aim.dataset.rule = t.spec.protected ? 'no' : '';
      }
    } else { text(aim, ''); aim.dataset.rule = ''; }
    const fishes = this.stringer.filter((c) => c.unit === 'cm' && c.fish);
    const shells = this.stringer.filter((c) => c.unit === 'cm' && !c.fish);
    const lob = this.stringer.filter((c) => c.unit === 'mm');
    const bag = this.file.lobster?.bag;
    const onFloat = fishes.filter((c) => c.onFloat).length;
    text(caught, this.stringer.length
      ? `Stringer · ${[fishes.length ? `${fishes.map((c) => `${c.name} ${c.size} cm`).slice(-3).join(', ')}${onFloat ? ` (${onFloat} on the float)` : ''}` : '', lob.length ? `${lob.length}${bag ? ` of ${bag}` : ''} lobster` : '', shells.length ? `${shells.length} by hand` : ''].filter(Boolean).join(' · ')}`
      : 'Stringer · empty');
    text(goal, this.targets.length ? `Target of the dive · ${this.targets.map((t) => `${t.name} (${t.why})`).join(', ')}` : '');
    if (this.briefing > 0 && this.mode === 'surface') {
      const season = this.season();
      const offer = this.file.lobster?.practice && season && !season.open ? ` 6: ${this.file.lobster.practice}.` : '';
      text(brief, `${this.file.water.say}. ${this.zone ? `${this.zone.say}. ` : ''}${season ? `${season.say}.` : ''}${offer} Lungs: level ${this.lungs.level}, ${this.lungs.name}, about ${Math.round(this.lungs.hold)} s and ${Math.round(this.lungs.easy)} m in comfort. Up arrow kicks, and glide between kicks; left and right turn; down puts your head down to dive; E turns you up; F fires; G takes a lobster or a shellfish by hand; Q locks on to what you look at (Shift+Q lets go); 1 is your mask, 2 follows you from behind; 5 heads for the surface, and at the boat climbs out. You float near the top and sink below ten metres. Rest on the float before each dive.`);
    } else text(brief, '');
  }

  // ---- other people -------------------------------------------------------------------------------------------

  /** A flag on the water for each of the others who is diving, and a word when this boat comes close to one. */
  private flagsOfOthers(seaTime: number, dt: number): void {
    const { ctx } = this;
    const boats = ctx.company();
    let n = 0;
    for (const boat of boats) {
      if (!boat.diver || n >= 8) continue;
      const flag = this.flags[n] ?? (this.flags[n] = this.addFlag());
      flag.visible = true;
      flag.position.set(boat.diver.x, ctx.stage.seaLevel(boat.diver.x, -boat.diver.y, seaTime), -boat.diver.y);
      flag.rotation.z = 0.1 * Math.sin(this.clock * 1.4 + n);
      n++;
    }
    for (let i = n; i < this.flags.length; i++) this.flags[i].visible = false;
    if (this.mode === 'aboard') this.clock += dt;
    if (!n || this.mode !== 'aboard') return;
    const tender = this.tender();
    const me = tender ? { x: tender.kayak.x, y: tender.kayak.y, sogKt: Math.abs(tender.kayak.speed) / KT } : { x: ctx.sim.state.x, y: ctx.sim.state.y, sogKt: ctx.sim.out.sog / KT };
    for (const boat of boats) {
      if (!boat.diver) { this.warned.delete(boat.peer); continue; }
      const range = Math.hypot(boat.diver.x - me.x, boat.diver.y - me.y);
      if (range > FLAG.warn * 2) this.warned.delete(boat.peer);
      else if (!this.warned.has(boat.peer) && diverNear(me, boat.diver)) {
        this.warned.add(boat.peer);
        const bearing = (Math.atan2(boat.diver.x - me.x, boat.diver.y - me.y) * 180) / Math.PI;
        ctx.alarm(`Diver down: ${boat.name || 'a skipper'} is in the water under the red flag, ${Math.round(range / 10) * 10} m off, bearing ${three(bearing)}. Keep clear and slow`);
      }
    }
  }

  private addFlag(): THREE.Group {
    const flag = buildDiveFloat();
    this.ctx.stage.scene.add(flag);
    return flag;
  }

  // ---- what the session asks ----------------------------------------------------------------------------------

  status(): string {
    if (this.mode === 'aboard') return '';
    const where = this.site ? ` at ${this.site.name}` : '';
    return this.mode === 'under' ? `Diving${where} · ${this.diver.d.toFixed(0)} m` : `In the water${where}, diver's flag up`;
  }

  focus(): { x: number; y: number; heading: number; height: number } | null {
    if (this.mode === 'aboard') return null;
    return { x: this.diver.x, y: this.diver.y, heading: this.diver.yaw, height: 0 };
  }

  /** `dv` is where her flag is while she is in the water (`packDive`). Null when she is aboard. */
  wire(): Record<string, unknown> {
    return { dv: this.mode === 'aboard' ? null : packDive(this.diver.x, this.diver.y) };
  }

  /** What the dive scene costs now: triangles and draws. For the budget, from the console. */
  cost(): { triangles: number; draws: number } {
    return this.scene.stats();
  }

  /** The picture, for play testing from the console. */
  get view3d(): DiveScene {
    return this.scene;
  }

  dispose(): void {
    if (this.mode !== 'aboard') this.leave('');
    window.removeEventListener('pointerdown', this.onDown, true);
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onUp, true);
    this.ctx.stage.eye = null;
    this.unwatch();
    this.scene.dispose();
    this.model.dispose();
    this.float.removeFromParent();
    for (const f of this.flags) f.removeFromParent();
    this.panel.remove();
    this.veil.remove();
    this.mask.remove();
    this.bracket.remove();
  }
}
