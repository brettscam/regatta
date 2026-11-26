import * as THREE from 'three';
import { KT } from '@slack-tide/sim';
import { hash01 } from './catch';
import { sight } from './sightings';
import type { AboardContext, Feature } from './feature';
import type { EyeView } from '../stage';
import { graphics } from '../scene/quality';
import { divesOf } from './diveData';
import { diveLog, logCatch, logDive, logEntry } from './diveLog';
import {
  BREATH, DIVE_POINTS, ENTRY, FLAG, GRAB, GUN, KICK, SHIFT,
  canDive, canFire, cleanDive, lobsterAwards, diverNear, effortOf, fightSeconds, gauge, glide, grab, holdBreath, lungsFor, urge, judge, lightAt, lobsterSeason, lobstersAt, makeGround, newBreath, packDive, populate,
  recover, runOver, shoot, siteAt, spook, stepFish, surfaced, surge, underwaterVisibility, zoneAt,
  type Breath, type Lungs, type DiveFile, type DiveSite, type DiveZone, type Fish, type Ground, type Lobster, type Verdict,
} from './diveRules';
import { DiveScene, RADIUS, buildDiveFloat } from './diveScene';

const three = (deg: number) => String(Math.round(((deg % 360) + 360) % 360)).padStart(3, '0');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The tender, as much of `aboard/kayak.ts` as the dive needs. */
interface TenderLike { mode: string; kayak: { x: number; y: number; heading: number; speed: number }; drive: { ahead: number; steer: number } | null; spec: { name: string; length?: number; beam?: number } }

/**
 * Over the side with mask, fins, a speargun and a float with a dive flag. 5 puts her in the water from the yacht at
 * anchor or on a mooring, or from the tender when it is stopped, and 5 beside either one climbs back out.
 * In the water the view is from her mask and she swims on her fins: each press of the up arrow is a kick (held, an
 * easy rhythm) and she glides between; left and right turn her, down puts her head down for a duck dive, E brings it
 * up, and a drag looks anywhere. W A S D do the same as the arrows. F fires the gun, G takes a lobster by hand.
 * One breath at a time: her lungs (`lungsFor`) grow with clean dives, kept in the logbook as `freedive`.
 * The rules are all in `diveRules.ts`, the picture in `diveScene.ts`, the sites and fish in each water's `dives.json`.
 * Scuba would be a second kind of `Breath`: nothing here builds it.
 */
export class Dive implements Feature {
  readonly id = 'dive';
  /** Aboard, at the surface on her snorkel, or under on one breath. */
  mode: 'aboard' | 'surface' | 'under' = 'aboard';
  /** Where her mask is: sim x and y, depth, and the way she looks (compass radians, and up from level). */
  readonly diver = { x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, yaw: 0, pitch: 0 };
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
  private urged = false;
  private breathe = 1;
  private crackle = 0;
  private gained = 0;
  private readonly veil = document.createElement('div');
  private peak = 0;
  private readonly mask = document.createElement('div');
  private wasWet = false;
  /** Her own setting: treat the lobster season as open and the water below as an October night. Nobody else's day changes. */
  practice = false;
  breath: Breath = newBreath();
  fish: Fish[] = [];
  lobsters: Lobster[] = [];
  /** What has been kept on this sail: fish on the stringer and lobster in the bag. */
  readonly stringer: Array<{ id: string; name: string; size: number; unit: 'cm' | 'mm' }> = [];
  /** A fish on the shaft, not yet up at the float. A blackout loses it. */
  inHand: { fish: Fish; verdict: Verdict } | null = null;
  site: DiveSite | null = null;
  zone: DiveZone | null = null;

  private readonly file: DiveFile;
  /** A site put under her wherever she is, by `?diveSite=<id>`: for looking at a site's bottom from any water. */
  private readonly forced: string | null;
  private readonly view: DiveScene;
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
  private readonly told = new Set<string>();
  /** Fish and lobster taken out of the water this sail, by place and half hour, so they are not there to take again. */
  private readonly taken = new Set<string>();
  private readonly warned = new Set<string>();
  private reload = 0;
  private shot: { from: THREE.Vector3; dir: THREE.Vector3; range: number; gone: number; hit: Fish | null; near: Fish | null; landed: boolean } | null = null;
  private fight = 0;
  private ascending = false;
  private dazed = 0;
  private briefing = 0;
  private dragging = false;
  private drag = { x: 0, y: 0 };
  private eyeDepth = -0.3;
  private aim: Fish | null = null;
  private think = 0;
  private callAt: 'ok' | 'warn' | 'danger' = 'ok';
  private limitTold = false;
  private last = { depth: 0, seconds: 0 };
  private clock = 0;
  private kicks = 0;
  private surgeX = 0;
  private surgeY = 0;
  private recoil = 0;
  private puff = 1;
  private readonly current = { x: 0, y: 0 };
  private readonly tip = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly heldAt = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly water = new THREE.Color();
  private readonly sky = new THREE.Color();

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
    this.file = divesOf(as || course);
    this.forced = forced;
    this.view = new DiveScene(graphics.level === 'low');
    this.view.group.add(this.view.gun);
    ctx.stage.scene.add(this.view.group);
    this.float.visible = false;
    ctx.stage.scene.add(this.float);
    this.eye = { camera: this.camera, wet: false, water: new THREE.Color(), see: 18, light: new THREE.Color(1, 1, 1) };
    this.camera.rotation.order = 'YXZ';

    this.panel.className = 'hud dive';
    this.panel.setAttribute('aria-label', 'Dive');
    this.panel.hidden = true;
    for (const name of ['where', 'gauges', 'breath', 'gun', 'aim', 'catch', 'brief']) {
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
    document.body.append(this.veil, this.mask);
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

  key(code: string): boolean {
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
    else if (code === 'KeyX' || code === 'KeyO' || code === 'KeyI') this.ctx.say('That is worked from the boat. Swim back and press 5 to climb out first');
    return true;
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
    this.mode = 'surface';
    this.breath = newBreath();
    this.lungs = lungsFor(ctx.logbook.totals.freedive);
    this.reload = 0;
    this.shot = null;
    this.inHand = null;
    this.ascending = false;
    this.dazed = 0;
    this.briefing = 40;
    this.eyeDepth = -0.3;
    this.limitTold = false;
    this.settle(d.x, d.y);
    logEntry();
    this.float.visible = true;
    // The boat's instruments mean nothing in the water: the dive computer stands alone until she climbs out.
    document.body.classList.add('diving');
    this.peak = 0;
    const where = this.site ? `${this.site.name}. ${this.site.say}` : `No named site here: ${Math.round(depth)} m of water`;
    // An alarm, so that time drops back to real speed: a breath is counted in real seconds.
    ctx.alarm(`Over the side. ${where}${can.say ? `. ${can.say}` : ''}`);
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
    const key = `${this.site?.id ?? `${Math.floor(this.centre.x / 250)},${Math.floor(this.centre.y / 250)}`}:${this.shift}:${this.night ? 'n' : 'd'}`;
    this.fish = populate(file, this.ground, this.centre.x, this.centre.y, this.shift, { night: this.night, dawn: hour >= 5 && hour < 8 }).filter((f) => !this.taken.has(`${key}:f${f.index}`));
    this.lobsters = lobstersAt(file, this.ground, this.centre.x, this.centre.y, this.shift, this.night).filter((l) => !this.taken.has(`${key}:l${l.index}`));
    this.stockKey = key;
    // The canopy lies the way the water is going, which is away from where the sea comes from.
    this.view.build(this.ground, this.centre.x, this.centre.y, this.lobsters, file.water.cover === 'coral', ctx.seaway.sea.dir + Math.PI);
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
    this.leave(this.summary());
  }

  /** Where she climbs out: the yacht, or the tender she came in. */
  private home(): { x: number; y: number; half: number } {
    const tender = this.from === 'tender' ? this.tender() : null;
    if (tender) return { x: tender.kayak.x, y: tender.kayak.y, half: 1 };
    const s = this.ctx.sim.state;
    return { x: s.x, y: s.y, half: this.ctx.spec.dimensions.loa / 2 };
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
    this.view.group.visible = false;
    this.float.visible = false;
    this.panel.hidden = true;
    document.body.classList.remove('diving', 'under');
    this.wasWet = false;
    this.veil.style.opacity = '0';
    this.ctx.sound.duck(1);
    this.dragging = false;
    this.shot = null;
    this.inHand = null;
    if (say) this.ctx.say(say, 7);
  }

  // ---- the gun and the hand -----------------------------------------------------------------------------------

  /** The way she is looking, as a unit vector east, north and down. */
  private look(out: { x: number; y: number; d: number }): { x: number; y: number; d: number } {
    const { yaw, pitch } = this.diver;
    const c = Math.cos(pitch);
    out.x = Math.sin(yaw) * c;
    out.y = Math.cos(yaw) * c;
    out.d = -Math.sin(pitch);
    return out;
  }

  private readonly dir = { x: 0, y: 0, d: 0 };

  private lobsterMarks(): Array<Lobster & { cm: number; species: { shape: 'bass' } }> {
    return this.lobsters.filter((l) => l.mode === 'there').map((l) => ({ ...l, cm: (l.mm / 10) * 3.2, species: { shape: 'bass' as const } }));
  }

  private fire(): void {
    const { ctx } = this;
    const d = this.diver;
    const dir = this.look(this.dir);
    const can = canFire({ under: this.mode === 'under' && this.dazed <= 0, reload: this.reload, inHand: !!this.inHand || !!this.shot, zone: this.zone, atLobster: !!shoot(d, dir, this.lobsterMarks()).hit });
    const live = this.fish.filter((f) => f.mode === 'cruise' || f.mode === 'bolt');
    const result = shoot(d, dir, live);
    const verdict = can.ok ? canFire({ under: true, reload: 0, inHand: false, zone: null, atLobster: false, spare: result.hit?.species.spare }) : can;
    if (!verdict.ok) {
      ctx.say(verdict.say, 6);
      return;
    }
    this.shot = {
      from: new THREE.Vector3(d.x, -d.d, -d.y), dir: new THREE.Vector3(dir.x, -dir.d, -dir.y), range: result.range, gone: 0, hit: result.hit, near: result.near, landed: false,
    };
    ctx.sound.thud(0.25);
    this.recoil = 1;
    this.view.bubble(this.muzzle.x, this.muzzle.y, this.muzzle.z, 4);
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
      ctx.say(`Missed${shot.near ? `, just wide of the ${shot.near.species.name}` : ''}. ${fled ? 'Everything near has bolted. Wait, keep still, and let them come back' : 'Nothing was in range: the shaft is good for three or four metres'}`, 7);
      this.reload = GUN.reload;
      return;
    }
    f.mode = 'held';
    spook(this.fish, f.x, f.y, f.d);
    if (f.species.strong) {
      this.fight = fightSeconds(f.kg);
      ctx.say(`${f.species.name[0].toUpperCase()}${f.species.name.slice(1)} on! It is running with the line. Hold on and save your breath`, 5);
    } else this.decide(f, shot.range);
  }

  /** The fish is hers or it is the warden's. */
  private decide(f: Fish, range: number): void {
    const { ctx } = this;
    const aboard = this.stringer.filter((c) => c.id === f.species.id).length;
    const verdict = judge(f, aboard, range, !diveLog().species[f.species.id]);
    this.taken.add(`${this.stockKey}:f${f.index}`);
    if (verdict.keep) {
      this.inHand = { fish: f, verdict };
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
    this.stringer.push({ id: f.species.id, name: f.species.name, size: f.cm, unit: 'cm' });
    logCatch(f.species.id, f.species.name, f.cm, 'cm');
    // A speared fish is a fish landed, and is counted with the ones the line catches.
    ctx.logbook.count('fish');
    ctx.logbook.count('speared');
    for (const a of hand.verdict.awards) ctx.logbook.earn(a);
    ctx.say(`On the stringer: ${f.species.name}, ${f.cm} cm. The gun is loaded again`, 6);
  }

  private reach(): void {
    const { ctx } = this;
    const rule = this.file.lobster;
    if (this.mode !== 'under' || this.dazed > 0) {
      ctx.say('Lobster live on the bottom, under the ledges. Get down among the rocks, then G');
      return;
    }
    let best: Lobster | null = null;
    let bestD = 1.7;
    for (const l of this.lobsters) {
      const dist = Math.hypot(l.x - this.diver.x, l.y - this.diver.y, l.d - this.diver.d);
      if (l.mode === 'there' && dist < bestD) { best = l; bestD = dist; }
    }
    if (!best || !rule) {
      ctx.say('Nothing in reach. Look for the long feelers sticking out from under a ledge', 5);
      return;
    }
    const got = grab(best, this.diver);
    if (got === 'far') ctx.say('Not quite in reach. Closer, and slowly', 4);
    else if (got === 'deep') ctx.say('It has backed too far into its hole to reach. They come out to walk the reef after dark', 6);
    else if (got === 'fled') {
      best.mode = 'fled';
      best.left = GRAB.away;
      ctx.say('Gone, backwards, with one flick of its tail. Come at it from the front, slowly, and pin it down', 6);
    } else {
      const season = this.season();
      const bag = this.stringer.filter((c) => c.unit === 'mm').length;
      const g = gauge(best.mm, rule, !!season?.open, bag, this.zone);
      if (!g.keep) {
        best.mode = 'fled';
        best.left = 20;
        ctx.say(`Got it. ${g.say}`, 8);
        return;
      }
      best.mode = 'caught';
      this.taken.add(`${this.stockKey}:l${best.index}`);
      this.stringer.push({ id: 'lobster', name: 'lobster', size: best.mm, unit: 'mm' });
      // One taken in practice is practice: a couple of points, and not a lobster in the logbook or the dive log.
      const practice = !!season?.practice;
      const worth = lobsterAwards(practice, practice ? false : logCatch('lobster', rule.name, best.mm, 'mm'));
      if (worth.counts) ctx.logbook.count('lobsters');
      for (const a of worth.awards) ctx.logbook.earn(a);
      ctx.say(`Got it. ${g.say}${practice ? '. Practice: it is not counted in your logbook' : ''}`, 8);
    }
  }

  private blackout(): void {
    const { ctx } = this;
    const lost = this.inHand ? ` The ${this.inHand.fish.species.name} is gone with the shaft line cut.` : '';
    this.inHand = null;
    this.shot = null;
    this.fight = 0;
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
    const bottom = this.view.floorAt;
    if (this.still > 0) this.still -= dt;

    // The tender she came in lies where she left it.
    const tender = this.tender();
    if (tender && this.from === 'tender') { tender.kayak.x = this.pinned.x; tender.kayak.y = this.pinned.y; tender.kayak.speed = 0; }

    // Looking about: the arrows turn her and put her head down, E brings it up, and a drag looks anywhere.
    const drive = this.drive;
    const turn = drive?.turn ?? ((ctx.held('ArrowRight') || ctx.held('KeyD') ? 1 : 0) - (ctx.held('ArrowLeft') || ctx.held('KeyA') ? 1 : 0));
    const nod = drive?.nod ?? ((ctx.held('KeyE') ? 1 : 0) - (ctx.held('ArrowDown') || ctx.held('KeyS') ? 1 : 0));
    const locked = this.dazed > 0 || this.fight > 0;
    if (!locked) {
      d.yaw += turn * 1.5 * dt + this.drag.x * 0.004;
      d.pitch = THREE.MathUtils.clamp(d.pitch + nod * 1.1 * dt - this.drag.y * 0.004, -1.45, 1.45);
    }
    this.drag.x = this.drag.y = 0;
    // Turned for the surface: head up, and an easy kick all the way.
    if (this.ascending) d.pitch += (1.35 - d.pitch) * Math.min(1, dt * 3);

    // Fins. Each press of the up arrow is one stroke; held, they come in an easy rhythm. Between strokes she glides.
    const up = ctx.held('ArrowUp') || ctx.held('KeyW');
    this.sinceKick += dt;
    const rhythm = drive?.kick ? 1 / drive.kick : this.ascending ? 1 : up ? KICK.rhythm : Infinity;
    const tapped = up && !this.wasUp && this.sinceKick >= KICK.fastest;
    this.wasUp = up;
    const dir = this.look(this.dir);
    if (!locked && this.still <= 0 && (tapped || this.sinceKick >= rhythm)) {
      // At the surface a stroke with her head down is a duck dive; with it up she swims along the top.
      const flat = this.mode === 'surface' && d.pitch > -0.25;
      const c = flat ? 1 / Math.max(0.2, Math.hypot(dir.x, dir.y)) : 1;
      d.vx += dir.x * c * KICK.thrust;
      d.vy += dir.y * c * KICK.thrust;
      if (!flat) d.vd += dir.d * KICK.thrust;
      this.kickRate = Math.min(3, 1 / Math.max(0.3, this.sinceKick));
      this.sinceKick = 0;
      this.stroke = 1;
      this.kicks++;
      if (this.mode === 'under') ctx.sound.diving('kick', 0.4);
    }
    // The rate she is kicking at fades as she glides: that, and the depth, is what the breath is spent on.
    this.kickRate = Math.min(this.kickRate, 1 / Math.max(0.3, this.sinceKick));
    if (this.sinceKick > 2.5) this.kickRate = 0;
    this.stroke = Math.max(0, this.stroke - dt * 2.4);
    const effort = effortOf(this.kickRate);
    const speed = Math.hypot(d.vx, d.vy, d.vd);
    const slowed = glide(speed, dt);
    if (speed > 1e-4) { const k = slowed / speed; d.vx *= k; d.vy *= k; d.vd *= k; }
    // A strong fish tows her after it for as long as it runs.
    const fighting = this.fight > 0 && this.shot?.hit;
    if (fighting) {
      const f = this.shot!.hit!;
      d.vx += (Math.sin(f.heading) * 0.9 - d.vx) * Math.min(1, dt * 2);
      d.vy += (Math.cos(f.heading) * 0.9 - d.vy) * Math.min(1, dt * 2);
    }
    // A wetsuit floats her near the top and is squeezed flat down deep, where she starts to sink.
    if (this.mode === 'under') d.vd += (d.d < 6 ? -0.1 * (1 - d.d / 6) : d.d > 12 ? 0.08 * Math.min(1, (d.d - 12) / 6) : 0) * dt * 1.5;

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
      // Down she goes: a stroke with her head down.
      if (this.dazed <= 0 && d.vd > 0.12 && floor > 1.2) {
        d.d = 0.5;
        this.mode = 'under';
        this.briefing = 0;
        this.urged = false;
      } else { d.d = 0; d.vd = Math.max(0, d.vd) * 0.5; }
    } else if (this.still <= 0) {
      d.d += d.vd * dt;
      const deepest = Math.min(lungs.limit, Math.max(0.3, floor - 0.35));
      if (d.d > deepest) {
        d.d = deepest;
        d.vd = Math.min(0, d.vd);
        if (deepest === lungs.limit && !this.limitTold) { this.limitTold = true; ctx.say(`${Math.round(lungs.limit)} m: as deep as your lungs will take you yet, and there is the way back to pay for`, 6); }
      }
      const call = holdBreath(this.breath, lungs, d.d, effort, dt, !!fighting);
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
    // The reef snaps and crackles all the time, to an ear under the water.
    if (this.mode === 'under' && (this.crackle -= dt) <= 0) { this.crackle = 0.15 + 0.8 * hash01(Math.floor(this.clock * 20), 77); ctx.sound.diving('crackle', 0.3 + 0.5 * hash01(Math.floor(this.clock * 20), 78)); }

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
    this.draw(dt, seaTime, floor);
  }

  /** The fish and the lobster, each minding the diver. */
  private life(dt: number): void {
    const d = this.diver;
    const g = this.ground!;
    const diver = this.mode === 'under' ? d : { ...d, d: 0.2 };
    for (const f of this.fish) {
      if (f === this.shot?.hit) continue;
      stepFish(f, diver, dt, this.clock, this.view.floorAt, g.cover === 'kelp' && g.grows((f.x + d.x) / 2, (f.y + d.y) / 2));
    }
    const speed = Math.hypot(d.vx, d.vy, d.vd);
    for (const l of this.lobsters) {
      if (l.mode === 'fled') { l.left -= dt; if (l.left <= 0) l.mode = 'there'; continue; }
      // A diver thrashing up to it sends it back into its hole before she is near.
      if (l.mode === 'there' && speed > GRAB.lunge + 0.15 && Math.hypot(l.x - d.x, l.y - d.y, l.d - d.d) < 2.2) { l.mode = 'fled'; l.left = 25; }
    }
    // What she is looking at, named for her, and its rule said the first time she is close to one.
    if ((this.think -= dt) > 0) return;
    this.think = 0.25;
    const dir = this.look(this.dir);
    let best: Fish | null = null;
    let bestOff = 0.9;
    for (const f of this.fish) {
      if (f.mode !== 'cruise' && f.mode !== 'bolt') continue;
      const rx = f.x - d.x;
      const ry = f.y - d.y;
      const rd = f.d - d.d;
      const along = rx * dir.x + ry * dir.y + rd * dir.d;
      if (along < 0.3 || along > Math.min(9, this.seen)) continue;
      const off = Math.hypot(rx - dir.x * along, ry - dir.y * along, rd - dir.d * along) / (1 + along * 0.12);
      if (off < bestOff) { best = f; bestOff = off; }
      if (this.mode === 'under' && along < 5 && off < 1.4 && !this.told.has(f.species.id)) {
        this.told.add(f.species.id);
        this.ctx.say(f.species.say, 9);
        // The animals nobody hunts are finds, kept with the wildlife seen from the deck: the first ever of each is logged.
        if ((f.species.protected || f.species.spare) && sight(`dive-${f.species.id}`) === 1) this.ctx.logbook.count('seen');
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
    if (f && this.fight > 0) {
      // It runs, turning as it goes, a couple of metres off the end of the gun.
      f.heading += Math.sin(this.clock * 1.7) * 1.6 * dt;
      f.x = d.x + Math.sin(f.heading) * 2.4;
      f.y = d.y + Math.cos(f.heading) * 2.4;
      f.d = Math.max(0.8, d.d + 0.4 * Math.sin(this.clock * 2.3));
      this.fight -= dt;
      if (this.fight <= 0) {
        this.fight = 0;
        this.decide(f, shot.range);
      }
      return;
    }
    if (!f) {
      // A miss: the shaft comes back on its line as the bands are loaded.
      this.reload = Math.max(0, this.reload - dt);
      shot.gone = shot.range * Math.min(1, this.reload / GUN.reload);
      if (this.reload <= 0) this.shot = null;
    }
  }

  private draw(dt: number, seaTime: number, floor: number): void {
    const { ctx } = this;
    const { stage } = ctx;
    const d = this.diver;
    const sky = stage.sky;
    const sea = ctx.seaway.sea;

    // Head down she looks through the surface; head up she is out in the air. On one breath she is simply where she is.
    const wantEye = this.mode === 'under' ? d.d : d.pitch < -0.12 || this.dazed > 0 ? 0.3 : -0.32;
    this.eyeDepth = this.mode === 'under' ? d.d : this.eyeDepth + (wantEye - this.eyeDepth) * Math.min(1, dt * 5);
    const wet = this.eyeDepth > 0.02;
    const level = wet ? 0 : stage.seaLevel(d.x, -d.y, seaTime);
    const cam = this.camera;
    cam.position.set(d.x, level - this.eyeDepth, -d.y);
    const sway = 0.035 * Math.sin(this.stroke * Math.PI) * (this.kicks % 2 ? 1 : -1);
    cam.rotation.set(d.pitch + (this.dazed > 0 ? 0.25 * Math.sin(this.clock * 1.3) : 0) - 0.02 * Math.sin(this.stroke * Math.PI), -d.yaw, (this.dazed > 0 ? 0.2 * Math.sin(this.clock * 0.9) : 0) + sway);
    // A contraction darkens the edge of the mask for a moment; a blackout takes it all.
    this.throb = Math.max(0, this.throb - dt * 2.5);
    const dark = this.dazed > 9 ? 1 : this.mode === 'under' ? Math.min(0.85, urge(this.breath.air) * 0.35 + this.throb * 0.4) : 0;
    this.veil.style.opacity = dark.toFixed(2);
    // Head under: the world above goes dull and far off, and the mask's edge closes in.
    if (wet !== this.wasWet) { this.wasWet = wet; document.body.classList.toggle('under', wet); ctx.sound.duck(wet ? 0.15 : 1); }
    this.seen = underwaterVisibility(this.file.water.visibility, sea.height, this.night);
    const far = wet ? Math.max(60, this.seen * 3.2) : 40000;
    if (cam.far !== far) { cam.far = far; cam.near = wet ? 0.08 : 0.12; cam.updateProjectionMatrix(); }

    // The light that gets down here, and the colour of the water it gets down through.
    const day = THREE.MathUtils.clamp(Math.sin(sky.elevation) * 3 + 0.2, 0.04, 1) * (1 - 0.92 * sky.night);
    const light = this.night ? Math.min(day, 0.07) : day;
    const [r, gr, b] = lightAt(this.eyeDepth);
    const tint = this.file.water.tint;
    this.water.setRGB(tint[0], tint[1], tint[2]).multiplyScalar(1.75 * light * Math.exp(-Math.max(0, this.eyeDepth) * 0.035));
    this.sky.setRGB(0.62, 0.9, 1).multiplyScalar(2.4);
    this.eye.wet = wet;
    this.eye.see = this.seen;
    this.eye.water.copy(this.water);
    this.eye.light.setRGB(r, gr, b).multiplyScalar(light / Math.max(day, 0.04));
    stage.eye = this.eye;
    this.view.group.visible = wet;

    const tender = this.tender();
    const s = ctx.sim.state;
    const hulls = [{ x: s.x, z: -s.y, heading: s.heading, length: ctx.spec.dimensions.loa, beam: ctx.spec.dimensions.beam }];
    if (tender) hulls.push({ x: tender.kayak.x, z: -tender.kayak.y, heading: tender.kayak.heading, length: tender.spec.length ?? 3.4, beam: tender.spec.beam ?? 0.9 });
    const strength = Math.min(2.2, 0.35 + sea.height * 1.4);
    this.view.update(cam, {
      time: this.clock, sun: sky.sunDir, light, water: this.water, sky: this.sky, see: this.seen, lamp: this.night && this.mode === 'under',
      surgeX: -Math.sin(sea.dir) * strength, surgeZ: Math.cos(sea.dir) * strength, surgePeriod: sea.swellPeriod > 0 ? sea.swellPeriod : Math.max(4, sea.period),
      // The specks go with the stream, and to and fro with the surge.
      driftX: (this.current.x + this.surgeX) * dt, driftZ: -(this.current.y + this.surgeY) * dt, hulls, dt,
      loaded: !this.shot && this.reload <= 0, loading: 1 - Math.min(1, this.reload / GUN.reload), recoil: this.recoil,
    }, stage.renderer.domElement.height);
    this.recoil = Math.max(0, this.recoil - dt * 3.5);

    // The shaft: flying, in a fish, or coming back.
    cam.updateMatrixWorld();
    this.muzzle.set(0.1, -0.15, -1.3).applyMatrix4(cam.matrixWorld);
    const shot = this.shot;
    if (shot) {
      const f = shot.hit;
      if (shot.landed && f) {
        // Brought in to the hand once the fish is hers; out on the line while it runs.
        if (this.fight > 0) this.tip.set(f.x, -f.d, -f.y);
        else this.tip.lerp(this.a.set(0.02, -0.12, -1.9).applyMatrix4(cam.matrixWorld), Math.min(1, dt * 3));
        this.heldAt.copy(this.tip);
        this.b.copy(this.tip).sub(this.muzzle).normalize();
        this.view.drawShaft(this.tip, this.b, this.muzzle);
      } else {
        this.tip.copy(shot.from).addScaledVector(shot.dir, Math.min(shot.gone, shot.range));
        this.view.drawShaft(this.tip, shot.dir, this.muzzle);
      }
    } else this.view.drawShaft(null, this.b, this.muzzle);
    this.view.gun.visible = this.dazed <= 0;
    this.view.drawFish(this.fish, this.clock, shot?.landed ? shot.hit : null, shot?.landed && shot.hit ? this.heldAt : null, cam.position);
    // Her breath going up: a burst as she turns for the top, a trickle on the way, and a little with each contraction.
    if (this.mode === 'under' && (this.puff -= dt) <= 0) {
      this.puff = this.ascending || d.vd < -0.35 ? 0.35 : 2.5 + 3 * hash01(Math.floor(this.clock), 79);
      this.view.bubble(cam.position.x + Math.sin(d.yaw) * 0.12, cam.position.y - 0.1, cam.position.z - Math.cos(d.yaw) * 0.12, this.ascending || d.vd < -0.35 ? 3 : 2);
    }
    this.view.drawLobsters(this.lobsters, this.clock);

    // The float rides over her, on its line.
    const fy = stage.seaLevel(d.x, -d.y, seaTime);
    this.float.position.set(d.x + 0.9 * Math.sin(d.yaw + 2.5), fy, -d.y + 0.9 * -Math.cos(d.yaw + 2.5));
    this.float.rotation.set(0.12 * Math.sin(this.clock * 1.1), d.yaw * 0.2 + 0.3 * Math.sin(this.clock * 0.3), 0.1 * Math.sin(this.clock * 1.4));
    this.view.drawFloatLine(this.a.set(d.x, -Math.max(0.3, d.d) + 0.2, -d.y), this.b.set(this.float.position.x, 0, this.float.position.z));

    this.readout(dt, floor);
  }

  /** The dive panel: where, how deep, the breath, the gun, what she is looking at, and the catch. Hidden with H. */
  private readout(dt: number, floor: number): void {
    const { ctx } = this;
    this.panel.hidden = ctx.hud.readoutHidden;
    if (this.panel.hidden) return;
    if (this.briefing > 0) this.briefing -= dt;
    const d = this.diver;
    const [where, depth, breath, gun, aim, caught, brief] = this.lines;
    const b = this.breath;
    where.textContent = `${this.site ? this.site.name : 'Open bottom'}${this.zone ? ' · no-take reserve' : ''}${this.practice ? ' · practice' : ''}`;
    this.peak = Math.max(this.peak, d.d);
    const cells = depth.children;
    const set = (i: number, text: string) => { const el = cells[i].firstElementChild as HTMLElement; if (el.textContent !== text) el.textContent = text; };
    set(0, this.mode === 'under' ? `${d.d.toFixed(1)} m` : '0.0 m');
    set(1, clock(this.mode === 'under' ? b.under : 0));
    set(2, `${this.peak.toFixed(1)} m`);
    set(3, `${Math.round(floor)} m`);
    set(4, `${this.file.water.tempC}° · vis ${Math.round(this.seen)} m`);
    const label = breath.firstElementChild as HTMLElement;
    const fill = (breath.lastElementChild as HTMLElement).firstElementChild as HTMLElement;
    label.textContent = this.dazed > 0 ? 'Dazed' : this.mode === 'under' ? `Lungs · ${clock(b.under)}${b.air < BREATH.urge ? ' · urge to breathe' : ''}` : b.rest > 0 ? `Recovering · ${Math.ceil(b.rest)} s` : b.air >= 1 && b.prep < 1 ? `Breathing up · ${Math.round(b.prep * 100)}%` : b.prep >= 1 ? 'Lungs · breathed up' : 'Lungs · filling';
    fill.style.width = `${Math.round(b.air * 100)}%`;
    breath.dataset.call = this.mode === 'under' ? (b.air < BREATH.danger ? 'danger' : b.air < BREATH.warn ? 'warn' : b.air < BREATH.urge ? 'urge' : 'ok') : 'ok';
    gun.textContent = this.zone ? 'Gun · on safe: no-take reserve' : this.inHand ? `Gun · ${this.inHand.fish.species.name} on the shaft: take it up` : this.fight > 0 ? 'Gun · fish running on the line' : this.shot || this.reload > 0 ? `Gun · loading${this.reload > 0 ? ` ${Math.ceil(this.reload)} s` : ''}` : 'Gun · loaded (F)';
    const f = this.aim;
    if (f && this.mode === 'under') {
      const range = Math.hypot(f.x - d.x, f.y - d.y, f.d - d.d);
      const sp = f.species;
      const rule = sp.protected ? 'PROTECTED, do not shoot' : sp.spare ? 'not for the gun' : sp.encouraged ? 'take it' : sp.minCm ? `keep over ${sp.minCm} cm` : 'no size limit';
      aim.textContent = `${sp.name}${f.count > 1 ? ' (school)' : `, about ${Math.round(f.cm / 5) * 5} cm`} · ${rule} · ${range.toFixed(1)} m${range <= GUN.effective ? ', in range' : ''}`;
      aim.dataset.rule = sp.protected ? 'no' : '';
    } else { aim.textContent = ''; aim.dataset.rule = ''; }
    const fishes = this.stringer.filter((c) => c.unit === 'cm');
    const lob = this.stringer.filter((c) => c.unit === 'mm');
    const bag = this.file.lobster?.bag;
    caught.textContent = this.stringer.length
      ? `Stringer · ${[fishes.length ? fishes.map((c) => `${c.name} ${c.size} cm`).slice(-4).join(', ') : '', lob.length ? `${lob.length}${bag ? ` of ${bag}` : ''} lobster (${lob.map((c) => `${c.size}`).slice(-4).join(', ')} mm)` : ''].filter(Boolean).join(' · ')}`
      : 'Stringer · empty';
    if (this.briefing > 0 && this.mode === 'surface') {
      const season = this.season();
      const offer = this.file.lobster?.practice && season && !season.open ? ` 6: ${this.file.lobster.practice}.` : '';
      brief.textContent = `${this.file.water.say}. ${this.zone ? `${this.zone.say}. ` : ''}${season ? `${season.say}.` : ''}${offer} Lungs: level ${this.lungs.level}, ${this.lungs.name}, about ${Math.round(this.lungs.hold)} s and ${Math.round(this.lungs.easy)} m in comfort. Up arrow kicks, and glide between kicks; left and right turn; down puts your head down to dive; E turns you up; F fires; G grabs a lobster; 5 heads for the surface, and at the boat climbs out. Rest on the float before each dive.`;
    } else brief.textContent = '';
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

  dispose(): void {
    if (this.mode !== 'aboard') this.leave('');
    window.removeEventListener('pointerdown', this.onDown, true);
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onUp, true);
    this.ctx.stage.eye = null;
    this.view.dispose();
    this.float.removeFromParent();
    for (const f of this.flags) f.removeFromParent();
    this.panel.remove();
    this.veil.remove();
    this.mask.remove();
  }
}
