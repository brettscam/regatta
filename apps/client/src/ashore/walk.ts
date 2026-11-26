import * as THREE from 'three';
import type { Dockside } from '../aboard/dock';
import type { AboardContext, Feature } from '../aboard/feature';
import type { Kayak } from '../aboard/kayak';
import { compassWord, gatherFacts, localHour } from '../aboard/residentRules';
import type { Residents } from '../aboard/residents';
import { stamp } from '../aboard/visited';
import { myAvatar, myAvatarCode, onMyAvatar, readAvatar } from '../boat/avatar';
import { VIEWS, type ViewPreset } from '../camera/drone';
import type { RemoteBoat } from '../net/fleet';
import { sunAngles } from '../scene/sun';
import type { Place } from '../session';
import {
  DO_KEY, ITEMS, MENU_KEY, SUNSET_AWARD, SunsetWatch, barLine, claims, gatherLine, groupWords, houseDrink, itemAt, menuFor, nextDance, offersAt, pay,
  roundAward, sightsFrom, sittingWith, viewWords, type BarFacts, type Offer, type Seen,
} from './actions';
import { AshoreCard } from './card';
import { groundOfVenue } from './fromVenue';
import { areaAt, ceilingAt, clearTo, floorAt, floorUnder, standNear, toCourse, toLocal, walkStep, type Footing, type WalkGround } from './ground';
import { Walker } from './people';
import { EMOTE_SECONDS, JOG, WALK, stride } from './pose';
import { EMOTES, Track, mustYield, packAshore, readAshore, stampOf, type AshoreReport, type Emote, type Pose } from './wire';

const KT = 0.514444;
/** The drone's place behind somebody on foot: over her shoulder, a few paces back. */
const WALK_VIEW: ViewPreset = { target: [0, 1.45, 0], yaw: 0, pitch: 0.17, dist: 4.4 };
/** Back over a tender, about as `aboard/kayak.ts` has it. */
const TENDER_VIEW: ViewPreset = { target: [0, 1, -0.4], yaw: -0.5, pitch: 0.26, dist: 11 };
/** The height of the eyes the camera looks at. */
const EYE = 1.45;
/** She steps across to a venue's guest float from a yacht lying within this of it, metres. */
const FLOAT_REACH = 45;
/** A tender on a beach puts her on a deck within this, metres. A yacht alongside a dock puts her on its venue wherever that is. */
const BEACH_REACH = 70;
/** O takes her back aboard from within this of where she came ashore. */
const BACK_REACH = 6;
/** How many other people are drawn ashore at once. */
const MOST = 8;
/** Other people's words are shown over them to anyone within this, metres. */
const EARSHOT = 40;
/** Keys that belong to the boat. On foot they do nothing but say so. */
const BOAT_KEYS = new Set(['KeyP', 'KeyN', 'KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyI', 'Comma', 'Period']);
const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const fits = (pose: Pose, kind: string | undefined): boolean =>
  pose === 'sit' ? kind === 'seat' || kind === 'bench' : pose === 'stool' ? kind === 'bar' : pose === 'lean' ? kind === 'rail' || kind === 'view' : true;

interface Site { ground: WalkGround; kind: string; top: number }

interface Friend {
  peer: string;
  walker: Walker;
  track: Track;
  ground: WalkGround;
  report: AshoreReport;
  heardAt: number;
  hailAt: number;
  avatar: string;
  name: string;
  emoteT: number;
  phase: number;
  clock: number;
  /** A drink handed to her by a round, until she says herself what she holds. */
  mark: string | null;
}

/**
 * Being ashore on foot. Stepping off at a dock, landing the tender at a venue's guest float or on the beach beside
 * one, or lying within a few boat's lengths of a guest float and pressing O, puts the skipper's own figure on the dock
 * with the camera behind her. She walks with W A S D, looks with Q and E or by dragging, and each kind of spot on
 * the place (`ground.ts`) has something to do at it (`actions.ts`): sit, lean on the rail, dance, order at the bar.
 * Everybody else ashore at the same place is drawn in their own kit, from the `as` field of their boat's report
 * (`wire.ts`). O at the dock goes back aboard.
 *
 * The place only has to be a `WalkGround`. A venue is one through `fromVenue.ts`. A town with streets is the same
 * thing with more areas, and is found the same way: by its place's id, in `site`.
 */
export class Ashore implements Feature {
  readonly id = 'ashore';
  /** Walk her without the keys, for play testing from the console: `regatta.features.find(f => f.id === 'ashore').drive = { ahead: 1, side: 0 }`. */
  drive: { ahead: number; side: number; jog?: boolean; look?: number } | null = null;

  private ground: WalkGround | null = null;
  private place: Place | null = null;
  private via: 'dock' | 'tender' | 'float' = 'dock';
  private at: Footing = { x: 0, y: 0, area: 0 };
  private landing = { x: 0, y: 0 };
  private face = 0;
  private speed = 0;
  private phase = 0;
  private clock = 0;
  /** The heading the camera follows: behind her when she walks ahead, hers to turn with Q and E. */
  private camYaw = 0;
  private clip = 1;
  private tooClose = false;

  private pose: Pose = 'stand';
  private spot = -1;
  private since = 0;
  private emote: Emote | '' = '';
  private emoteAt = 0;
  private emoteT = 99;
  private hold = -1;
  private round = 0;
  private roundItem = -1;
  private gather = 0;
  private menu: number[] = [];
  private menuOpen = false;
  private orders = 0;
  private offers: Offer[] = [];
  private think = 0;
  private backUntil = 0;
  private raceUntil = 0;
  private toldBoat = 0;
  /** A place she stepped off at that has nowhere to walk: left as the stamp and the line it always was. */
  private declined: string | null = null;
  private readonly rounded = new Set<string>();
  private readonly sunset = new SunsetWatch();
  private sunClock = 0;
  private sun = { elevation: 1, falling: false };
  private when = '';
  private whenClock = 0;
  private seen: Seen[] = [];

  private readonly me: Walker;
  private readonly card = new AshoreCard();
  private readonly friends = new Map<string, Friend>();
  private readonly sites = new Map<string, Site | null>();
  private readonly marks = new Map<string, { place: Place; until: number }>();
  private readonly sights: HTMLDivElement[] = [];
  private readonly v = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly stopAvatar: () => void;

  constructor(private readonly ctx: AboardContext) {
    this.me = new Walker(ctx.stage.scene, 'me', myAvatar());
    this.stopAvatar = onMyAvatar((a) => this.me.wear(a));
    for (let i = 0; i < 3; i++) {
      const el = document.createElement('div');
      el.className = 'boat-label ashore-sight';
      el.style.display = 'none';
      document.body.appendChild(el);
      this.sights.push(el);
    }
  }

  /** True while she is on foot. */
  get walking(): boolean {
    return this.ground !== null;
  }

  /** The pop-up tips ask this. */
  snap(): { where: string; friends: number; menu: boolean; posed: boolean } | null {
    if (!this.ground) return null;
    return { where: this.ground.name, friends: this.here().length, menu: this.menu.length > 0, posed: this.pose !== 'stand' };
  }

  // ---- where there is to walk --------------------------------------------------------------------

  /** The ground at a place, by the place's id. Whatever draws a place ashore is asked for it here and nowhere else. */
  private siteOf(id: string): Site | null {
    let site = this.sites.get(id);
    if (site !== undefined) return site;
    const spot = this.ctx.stage.shore.find((s) => s.id === id);
    const ground = spot?.layout ? groundOfVenue(spot.layout) : null;
    site = ground && spot ? { ground, kind: spot.kind, top: spot.top } : null;
    this.sites.set(id, site);
    return site;
  }

  private racing(): boolean {
    const race = this.ctx.race;
    return !!race && race.call !== null && race.finish === null;
  }

  /** The dock she is lying alongside, by the rule `aboard/dock.ts` steps ashore by. */
  private alongside(): Place | null {
    const s = this.ctx.sim.state;
    if (s.hold !== 'mooring') return null;
    return this.ctx.places.find((p) => p.kind === 'dock' && p.ashore && Math.hypot(p.x - s.holdX, p.y - s.holdY) < 30) ?? null;
  }

  /** A venue whose guest float she is lying close enough to step across to. */
  private floatInReach(): { place: Place; site: Site } | null {
    const s = this.ctx.sim.state;
    for (const spot of this.ctx.stage.shore) {
      const d = spot.layout?.dock;
      if (!d || Math.hypot(d.x - s.x, d.y - s.y) > FLOAT_REACH) continue;
      const place = this.ctx.places.find((p) => p.id === spot.id && p.ashore);
      const site = this.siteOf(spot.id);
      if (place && site) return { place, site };
    }
    return null;
  }

  // ---- keys ----------------------------------------------------------------------------------------

  /** Aboard: O steps across to a guest float she is lying beside. A race is given up first, and she is asked. */
  key(code: string, shift = false): boolean {
    const { ctx } = this;
    if (this.ground || code !== 'KeyO' || shift) return false;
    if (ctx.sim.state.hold === 'none') return false;
    const kayak = ctx.feature<Kayak>('kayak');
    if (kayak && kayak.mode !== 'stowed') return false;
    const dock = this.alongside();
    const float = dock ? null : this.floatInReach();
    if (!dock && !float) return false;
    if (this.racing()) {
      if (this.clock > this.raceUntil) {
        this.raceUntil = this.clock + 7;
        ctx.say('You are in a race. Leaving the boat retires you from it. Press O again to go ashore all the same', 7);
        return true;
      }
      ctx.race?.leave();
      ctx.say('Retired from the race', 4);
    }
    // At a dock the stepping off is `aboard/dock.ts`'s: it has the stamp and the words, and `update` here sees it.
    if (!float) return false;
    const spawn = this.spawn(float.site.ground, ctx.sim.state.x, ctx.sim.state.y, FLOAT_REACH + 10);
    if (!spawn) return false;
    if (stamp(float.place.id)) ctx.logbook.count('ashore');
    this.enter(float.place, float.site, 'float', spawn);
    return true;
  }

  /** On foot the keys are hers before they are the boat's. */
  firstKey(code: string): boolean {
    const { ctx } = this;
    if (!this.ground) return false;
    if (this.menuOpen) {
      if (code === MENU_KEY || code === 'Escape') { this.shut(); return true; }
      const n = /^Digit([1-9])$/.exec(code);
      if (n) { this.order(Number(n[1]) - 1); return true; }
    }
    if (WALK_KEYS.has(code)) return true;
    const digit = /^Digit([1-5])$/.exec(code);
    if (digit) { this.wave(EMOTES[Number(digit[1]) - 1]); return true; }
    if (/^Digit\d$/.test(code)) return true;
    if (code === 'KeyO') { this.back(); return true; }
    if (code === DO_KEY) { this.act(); return true; }
    if (code === MENU_KEY) { this.open(); return true; }
    if (code === 'KeyT') { this.tell(); return true; }
    if (code === 'KeyX' || code === 'KeyZ') { ctx.say('Nobody is aboard. O at the dock takes you back first'); return true; }
    if (BOAT_KEYS.has(code)) {
      if (this.clock > this.toldBoat) { this.toldBoat = this.clock + 20; ctx.say('That is done from the boat. O at the dock takes you back aboard'); }
      return true;
    }
    return false;
  }

  // ---- coming ashore, and going back -------------------------------------------------------------

  /** Where she is put down: on the guest float if the place has one, else the nearest thing to stand on. */
  private spawn(g: WalkGround, x: number, y: number, reach: number): Footing | null {
    const dock = g.spots.find((s) => s.kind === 'dock');
    if (dock && Math.hypot(dock.x - x, dock.y - y) <= reach) {
      const area = areaAt(g, dock.x, dock.y);
      if (area >= 0) return { x: dock.x, y: dock.y, area };
    }
    return standNear(g, x, y, reach);
  }

  private enter(place: Place, site: Site, via: 'dock' | 'tender' | 'float', spawn: Footing): void {
    const { ctx } = this;
    const g = site.ground;
    this.ground = g;
    this.place = place;
    this.via = via;
    this.at = { ...spawn };
    this.landing = { x: spawn.x, y: spawn.y };
    // Facing up the dock, toward the middle of the place.
    const first = g.areas[0].ring;
    let cx = 0;
    let cy = 0;
    for (const p of first) { cx += p[0] / first.length; cy += p[1] / first.length; }
    this.face = Math.hypot(cx - spawn.x, cy - spawn.y) > 1 ? Math.atan2(cx - spawn.x, cy - spawn.y) : g.heading + Math.PI;
    this.camYaw = this.face;
    this.speed = 0;
    this.pose = 'stand';
    this.spot = -1;
    this.emote = '';
    this.emoteT = 99;
    this.hold = -1;
    this.orders = 0;
    this.menu = menuFor(site.kind, ctx.stage.course.id, place.id);
    this.menuOpen = false;
    this.offers = [];
    this.think = 0;
    this.backUntil = 0;
    this.clip = 1;
    this.me.wear(myAvatar());
    this.card.show(true);
    ctx.drone.flyTo(WALK_VIEW, 1.4);
    this.helm(false);
    if (this.racing()) {
      ctx.race?.leave();
      ctx.say('You have left the boat, so you are retired from the race', 6);
    } else {
      ctx.say(`Ashore at ${place.ashore?.name ?? g.name}. ${place.ashore?.say ?? ''} W A S D walks, Q and E look round. O back here takes you ${via === 'tender' ? 'to the tender' : 'aboard'}`, 10);
    }
  }

  /** O: back aboard from where she came ashore. From further off she is told how far it is, and a second O takes her straight there. */
  private back(): void {
    const d = Math.hypot(this.at.x - this.landing.x, this.at.y - this.landing.y);
    if (d <= BACK_REACH || this.clock < this.backUntil) {
      this.leave(true);
      return;
    }
    this.backUntil = this.clock + 6;
    this.ctx.say(`The ${this.via === 'tender' ? 'tender' : 'boat'} is ${Math.round(d)} m back the way you came. Walk back and press O there, or press O again now to go straight to her`, 6);
  }

  private leave(byKey: boolean): void {
    const { ctx } = this;
    const via = this.via;
    this.ground = null;
    this.place = null;
    this.menuOpen = false;
    this.card.order(null);
    this.card.show(false);
    this.me.hide();
    for (const el of this.sights) el.style.display = 'none';
    if (via !== 'tender') this.helm(true);
    if (byKey) {
      // The feature that put her ashore takes her back: it has the words, and the tender.
      if (via === 'dock') ctx.feature<Dockside>('dock')?.key('KeyO');
      else if (via === 'tender') ctx.feature<Kayak>('kayak')?.key('KeyO');
      else ctx.say('Back aboard. X gets her under way', 6);
    }
    ctx.drone.flyTo(via === 'tender' && ctx.feature<Kayak>('kayak')?.mode === 'afloat' ? TENDER_VIEW : VIEWS.drone, 1.4);
  }

  /** Show or hide the figure at the yacht's wheel: she cannot be there and here. */
  private helm(aboard: boolean): void {
    const figure = this.ctx.boatView.model.nodes.crew_helm;
    if (figure) figure.visible = aboard;
  }

  reboat(): void {
    if (this.ground && this.via !== 'tender') this.helm(false);
  }

  // ---- things to do ------------------------------------------------------------------------------

  private setPose(pose: Pose, spot: number): void {
    this.pose = pose;
    this.spot = spot;
    this.since = stampOf(Date.now());
  }

  private standUp(): void {
    if (this.pose === 'stand') return;
    this.setPose('stand', -1);
    this.shut();
  }

  /** F: the thing there is to do here, or getting up from it. */
  private act(): void {
    const g = this.ground;
    if (!g) return;
    if (this.pose === 'dance' || this.pose === 'dance2') {
      this.setPose(nextDance(this.pose), -1);
      return;
    }
    if (this.pose !== 'stand') {
      this.standUp();
      return;
    }
    this.refresh();
    const offer = this.offers.find((o) => o.key === DO_KEY);
    if (!offer?.pose) {
      this.ctx.say('Nothing to do just here. Walk up to a table, the bar, the rail or the dance floor');
      return;
    }
    this.setPose(offer.pose, offer.spot);
    const s = g.spots[offer.spot];
    if (s) {
      // Onto the seat, or up to the rail.
      const area = areaAt(g, s.x, s.y, 1);
      this.at = { x: s.x, y: s.y, area: area >= 0 ? area : this.at.area };
      this.face = s.face;
    } else if (offer.pose === 'warm') {
      const fire = g.spots.find((f) => f.kind === 'fire');
      if (fire) this.face = Math.atan2(fire.x - this.at.x, fire.y - this.at.y);
    }
    this.speed = 0;
    if (offer.pose === 'lean') this.lookOut();
  }

  /** At the rail: what lies out there, by name. */
  private lookOut(): void {
    const g = this.ground;
    if (!g) return;
    const things = [...this.ctx.places.filter((p) => p.id !== g.id && !p.id.startsWith('meet-')).map((p) => ({ name: p.name, x: p.x, y: p.y, line: p.say })), ...(g.sights ?? [])];
    this.seen = sightsFrom(this.at.x, this.at.y, this.face, things);
    const first = this.seen[0];
    this.ctx.say(`${viewWords(this.face, this.seen)}${first?.line ? `. ${first.name}: ${first.line}` : ''}`, 9);
  }

  private open(): void {
    this.refresh();
    if (!this.offers.some((o) => o.key === MENU_KEY)) {
      this.ctx.say(this.menu.length ? 'Nothing to order from here. Walk up to the bar' : 'Nothing is sold here. Bring your own');
      return;
    }
    this.menuOpen = true;
    const n = this.here().length;
    const house = itemAt(houseDrink(this.menu));
    this.card.order(this.ground?.name ?? '', this.menu.map((i) => ITEMS[i].name), house ? (n ? `a round for everyone here (${n + 1} of you)` : 'a round for the house') : '');
  }

  private shut(): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.card.order(null);
  }

  /** What the bartender knows: all of it read from the world she is sailing in. */
  private barFacts(): BarFacts {
    const { ctx } = this;
    const place = this.place ?? { x: this.at.x, y: this.at.y };
    const t = ctx.sim.state.t;
    const hour = localHour(ctx.world.dateAt(t), ctx.stage.course.timeZone);
    const facts = gatherFacts(ctx.world, ctx.places.filter((p) => !p.id.startsWith('meet-')), place.x, place.y, t, hour);
    const ahead = ctx.world.wind(place.x, place.y, t + 3 * 3600, 'forecast');
    const inPort: string[] = [];
    for (const b of ctx.company()) if (b.held && Math.hypot(b.x - place.x, b.y - place.y) < 700) inPort.push(b.boatName || `${b.name || 'another'}'s boat`);
    for (const v of ctx.feature<Residents>('residents')?.vessels ?? []) if (v.sog < 0.3 && Math.hypot(v.x - place.x, v.y - place.y) < 600) inPort.push(v.name);
    return { facts, later: Number.isFinite(ahead.speed) ? { kt: ahead.speed / KT, from: compassWord(ahead.dir), hour: hour + 3 } : null, inPort };
  }

  private order(n: number): void {
    const { ctx } = this;
    const g = this.ground;
    if (!g) return;
    if (n === this.menu.length) { this.buyRound(); return; }
    const item = itemAt(this.menu[n] ?? -1);
    if (!item) return;
    this.shut();
    if (!pay(item)) return;
    this.hold = this.menu[n];
    ctx.say(barLine(item, this.barFacts(), this.orders++), 10);
  }

  /** A round: everybody ashore here gets one, and is told who stood it. */
  private buyRound(): void {
    const { ctx } = this;
    const g = this.ground;
    const index = houseDrink(this.menu);
    const item = itemAt(index);
    if (!g || !item) return;
    this.shut();
    const friends = this.here();
    if (!pay(item, friends.length + 1)) return;
    this.hold = index;
    this.round = Math.max(this.round + 1, stampOf(Date.now()));
    this.roundItem = index;
    this.wave('cheers');
    if (!friends.length) {
      ctx.say(`A round for the house. Nobody else is in, so the bartender has ${item.name} with you. Cheers`, 8);
      return;
    }
    const names = friends.map((f) => f.name || 'a friend');
    ctx.say(`A round on you: ${item.name} for ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' and the rest' : ''}. Cheers`, 8);
    const award = this.rounded.has(g.id) ? null : roundAward(friends.length);
    this.rounded.add(g.id);
    if (award) ctx.logbook.earn(award);
  }

  private wave(emote: Emote): void {
    this.emote = emote;
    this.emoteT = 0;
    this.emoteAt = Math.max(this.emoteAt + 1, stampOf(Date.now()));
  }

  /** T: tell every boat on the water where she is. They work out the words, the distance and the bearing themselves. */
  private tell(): void {
    const { ctx } = this;
    if (!this.ground) return;
    if (!ctx.company().length) {
      ctx.say('Nobody else is on this water to tell. When somebody is, T tells them where you are');
      return;
    }
    this.gather = Math.max(this.gather + 1, stampOf(Date.now()));
    ctx.say(`Told the fleet: you are at ${this.place?.ashore?.name ?? this.ground.name}`, 6);
    ctx.heard('You', `told the fleet you are at ${this.place?.ashore?.name ?? this.ground.name}`);
  }

  // ---- the others --------------------------------------------------------------------------------

  /** The other players ashore at the place she is at. */
  private here(): Friend[] {
    const out: Friend[] = [];
    if (this.ground) for (const f of this.friends.values()) if (f.ground === this.ground) out.push(f);
    return out;
  }

  /** She has typed a hail. On foot it is also words over her head, heard by whoever is ashore with her. */
  hail(text: string): boolean {
    if (!this.ground) return false;
    this.me.say(text);
    return this.here().length > 0;
  }

  withinHail(): string | null {
    const here = this.here();
    return here.length ? `${here.map((f) => f.name || 'a friend').slice(0, 3).join(', ')} beside you` : null;
  }

  private hear(): void {
    const { ctx } = this;
    const now = Date.now();
    const seen = new Set<string>();
    for (const boat of ctx.company()) {
      const report = readAshore(boat.ashore);
      const site = report ? this.siteOf(report.venue) : null;
      if (!report || !site) continue;
      const g = site.ground;
      let f = this.friends.get(boat.peer);
      const first = !f;
      if (!f) {
        if (this.friends.size >= MOST) continue;
        f = {
          peer: boat.peer, walker: new Walker(ctx.stage.scene, boat.peer, readAvatar(boat.avatar)), track: new Track(), ground: g, report,
          heardAt: -1, hailAt: boat.hailAt, avatar: boat.avatar, name: '', emoteT: 99, phase: 0, clock: 0, mark: null,
        };
        this.friends.set(boat.peer, f);
      }
      seen.add(boat.peer);
      f.name = boat.name || boat.boatName || 'A friend';
      f.walker.setName(f.name);
      if (boat.avatar !== f.avatar) f.walker.wear(readAvatar((f.avatar = boat.avatar)));
      if (boat.ashoreAt !== f.heardAt) {
        // Where she is: on her spot if her pose is one that has a spot and the spot is that kind of spot, else where she
        // says, so long as that is somewhere there is to stand. Anything else and she is not drawn.
        const spot = claims(report.pose) ? g.spots[report.spot] : undefined;
        const settled = claims(report.pose) && (!spot || !fits(report.pose, spot.kind)) ? { ...report, pose: 'stand' as Pose, spot: -1 } : report;
        const [x, y] = spot && settled === report ? [spot.x, spot.y] : toCourse(g, report.u, report.v);
        const foot = standNear(g, x, y, 1.5);
        if (!foot) {
          f.walker.hide();
          f.heardAt = -1;
          continue;
        }
        const [u, v] = toLocal(g, foot.x, foot.y);
        if (f.ground !== g) f.track = new Track();
        f.track.hear(u, v, spot && settled === report ? spot.face : report.face, now / 1000);
        if (!first && f.heardAt >= 0) {
          if (settled.emoteAt !== f.report.emoteAt && settled.emote) f.emoteT = 0;
          if (settled.round !== f.report.round && settled.round) this.roundFrom(f, settled, g);
          if (settled.gather !== f.report.gather && settled.gather) this.gatherFrom(boat, f, g);
        }
        if (settled.hold !== f.report.hold) f.mark = null;
        f.heardAt = boat.ashoreAt;
        f.ground = g;
        f.report = settled;
      }
      if (boat.hailAt !== f.hailAt) {
        f.hailAt = boat.hailAt;
        // Her words over her head, for anyone near enough to have heard them said.
        const [x, y] = toCourse(g, f.track.u, f.track.v);
        const ear = this.ground ? this.at : ctx.sim.state;
        if (boat.hail && Math.hypot(x - ear.x, y - ear.y) < (this.ground ? EARSHOT : EARSHOT * 4)) f.walker.say(boat.hail);
      }
    }
    for (const [peer, f] of this.friends) {
      if (seen.has(peer)) continue;
      f.walker.dispose(ctx.stage.scene);
      this.friends.delete(peer);
    }
    // A chart mark for somebody who said where she was lasts while she is still ashore there, half an hour at most.
    for (const [peer, m] of this.marks) {
      if (seen.has(peer) && this.clock < m.until) continue;
      const i = ctx.places.indexOf(m.place);
      if (i >= 0) ctx.places.splice(i, 1);
      this.marks.delete(peer);
    }

    // Somebody else in her seat who was there first has it.
    if (this.ground && claims(this.pose)) {
      const others = this.here().filter((f) => claims(f.report.pose)).map((f) => ({ spot: f.report.spot, since: f.report.since, key: f.avatar, name: f.name }));
      if (mustYield({ spot: this.spot, since: this.since, key: myAvatarCode() }, others)) {
        const who = others.find((o) => o.spot === this.spot);
        this.standUp();
        ctx.say(`${who?.name ?? 'Somebody'} had that seat first`, 5);
      }
    }
  }

  private roundFrom(f: Friend, r: AshoreReport, g: WalkGround): void {
    const item = itemAt(r.roundItem);
    if (!item) return;
    // Everybody there is seen with one, the buyer included.
    for (const other of this.friends.values()) if (other.ground === g) other.mark = item.id;
    if (this.ground !== g) return;
    this.hold = r.roundItem;
    this.wave('cheers');
    this.ctx.say(`${f.name} has bought a round: ${item.name} for everyone at ${g.name}. Cheers`, 8);
    this.ctx.heard(f.name, `bought a round at ${g.name}`);
  }

  private gatherFrom(boat: RemoteBoat, f: Friend, g: WalkGround): void {
    const { ctx } = this;
    const from = this.ground ? this.at : ctx.sim.state;
    const place = ctx.places.find((p) => p.id === g.id);
    const venue = place?.ashore?.name ?? g.name;
    const line = gatherLine(f.name, venue, place?.name ?? '', from.x, from.y, g.x, g.y);
    ctx.say(line, 9);
    ctx.heard(f.name, line.slice(f.name.length + 1));
    // On the chart, where the place stands: a ring with her name, which a click makes the next destination.
    // Not when she is at the same place, or lying off it: there is nothing to find.
    if (Math.hypot(g.x - ctx.sim.state.x, g.y - ctx.sim.state.y) < 400) return;
    const old = this.marks.get(boat.peer);
    if (old) {
      const i = ctx.places.indexOf(old.place);
      if (i >= 0) ctx.places.splice(i, 1);
    }
    const mark: Place = { id: `meet-${boat.peer}`.slice(0, 40), name: `${f.name} is here`, x: g.x, y: g.y, say: `${capital(venue)}. Stop off it with X, then O to go ashore` };
    ctx.places.push(mark);
    this.marks.set(boat.peer, { place: mark, until: this.clock + 1800 });
  }

  // ---- every frame -------------------------------------------------------------------------------

  /** What can be done from where she stands, looked at a few times a second. */
  private refresh(): void {
    const g = this.ground;
    if (!g) return;
    const taken = new Set<number>();
    for (const f of this.here()) if (claims(f.report.pose)) taken.add(f.report.spot);
    this.offers = offersAt(g, this.at.x, this.at.y, taken, this.menu.length);
  }

  update(dt: number): void {
    const { ctx } = this;
    this.clock += dt;
    const dock = ctx.feature<Dockside>('dock');
    const kayak = ctx.feature<Kayak>('kayak');
    if (!this.ground) {
      // Has she stepped off, or landed, by the means that were there before there was any walking?
      const stepped = dock?.ashoreAt ?? null;
      const landed = stepped ? null : kayak?.landedAt ?? null;
      const place = stepped ?? landed?.place ?? null;
      if (!place) this.declined = null;
      else if (place.id !== this.declined) {
        const site = this.siteOf(place.id);
        const ref = landed && kayak ? kayak.kayak : ctx.sim.state;
        const spawn = site ? this.spawn(site.ground, ref.x, ref.y, stepped || landed?.float ? 1e6 : BEACH_REACH) : null;
        if (site && spawn) this.enter(place, site, stepped ? 'dock' : 'tender', spawn);
        else this.declined = place.id;
      }
    } else if (
      (this.via === 'dock' && !dock?.ashoreAt) || (this.via === 'tender' && kayak?.mode !== 'ashore') || (this.via === 'float' && ctx.sim.state.hold === 'none')
    ) {
      // The boat is under way, or the feature that had her ashore has her back: she is aboard.
      const float = this.via === 'float';
      this.leave(false);
      if (float) ctx.alarm('The boat is under way. You are back aboard');
    }

    this.hear();
    if (this.ground) this.walk(dt);
    this.draw(dt);
  }

  private walk(dt: number): void {
    const { ctx } = this;
    const g = this.ground;
    if (!g) return;
    const held = (...codes: string[]): number => (codes.some((c) => ctx.held(c)) ? 1 : 0);
    const d = this.drive;
    const typing = this.menuOpen;
    let ahead = d ? d.ahead : typing ? 0 : held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown');
    let side = d ? d.side : typing ? 0 : held('KeyD') - held('KeyA');
    const turn = d?.look ?? held('KeyE', 'ArrowRight') - held('KeyQ', 'ArrowLeft');
    const jog = d ? !!d.jog : ctx.held('ShiftLeft') || ctx.held('ShiftRight');
    this.camYaw = wrap(this.camYaw + turn * 1.9 * dt);

    const moving = ahead !== 0 || side !== 0;
    if (moving && this.pose !== 'stand') this.standUp();
    let target = 0;
    if (moving) {
      // Ahead is away from the camera, whichever way it has been swung.
      ctx.view().camera.getWorldDirection(this.v);
      let fx = this.v.x;
      let fy = -this.v.z;
      const flat = Math.hypot(fx, fy);
      if (flat < 0.05) { fx = Math.sin(this.camYaw); fy = Math.cos(this.camYaw); } else { fx /= flat; fy /= flat; }
      const len = Math.hypot(ahead, side);
      ahead /= len;
      side /= len;
      const mx = fx * ahead + fy * side;
      const my = fy * ahead - fx * side;
      const want = Math.atan2(mx, my);
      this.face = wrap(this.face + wrap(want - this.face) * Math.min(1, dt * 11));
      target = jog ? JOG : WALK;
      this.speed += (target - this.speed) * Math.min(1, dt * 7);
      const step = walkStep(g, this.at, mx * this.speed * dt, my * this.speed * dt);
      const went = Math.hypot(step.x - this.at.x, step.y - this.at.y);
      this.at = { x: step.x, y: step.y, area: step.area };
      // Against a rail or a table she marks time rather than striding on the spot.
      if (dt > 0 && went < this.speed * dt * 0.3) this.speed *= 0.6;
      // The camera comes round behind her as she walks ahead. Walking across the view, or toward it, leaves it alone.
      const lead = Math.cos(wrap(this.face - this.camYaw));
      if (lead > 0.2) this.camYaw = wrap(this.camYaw + wrap(this.face - this.camYaw) * Math.min(1, dt * 0.9 * lead));
      this.shut();
    } else this.speed += (0 - this.speed) * Math.min(1, dt * 9);
    this.phase += stride(this.speed, this.me.figure.tall, dt);
    this.emoteT += dt;
    if (this.emoteT > EMOTE_SECONDS) this.emote = '';

    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.2;
      this.refresh();
      this.prompt();
    }

    // The sun: looked for every couple of seconds, and watched from the rail as it goes.
    this.sunClock -= dt;
    if (this.sunClock <= 0) {
      this.sunClock = 2;
      const o = ctx.stage.course.origin;
      const t = ctx.sim.state.t;
      const now = sunAngles(ctx.world.dateAt(t), o.lat, o.lon).elevation;
      this.sun = { elevation: now, falling: sunAngles(ctx.world.dateAt(t + 300), o.lat, o.lon).elevation < now };
    }
    const wasWatching = this.sunset.watching;
    if (this.sunset.update(dt, this.sun.elevation, this.sun.falling, this.pose === 'lean')) {
      ctx.logbook.earn(SUNSET_AWARD);
      ctx.say('The sun is down, and you watched it go from the rail', 8);
    } else if (!wasWatching && this.sunset.watching) ctx.say('The sun is going down. Stay at the rail and watch it', 7);
  }

  /** The prompt and the card. */
  private prompt(): void {
    const { ctx } = this;
    const g = this.ground;
    if (!g) return;
    const lines: Array<[string, string]> = [];
    const menu = this.offers.find((o) => o.key === MENU_KEY);
    if (this.menuOpen) { /* the menu says what the keys are */ }
    else if (this.pose === 'dance' || this.pose === 'dance2') lines.push(['F', 'the other dance'], ['W', 'walk off']);
    else if (this.pose !== 'stand') {
      lines.push(['F', this.pose === 'lean' || this.pose === 'warm' ? 'step back' : 'get up']);
      if (menu) lines.push(['G', menu.label]);
    } else for (const o of this.offers) lines.push([o.key === DO_KEY ? 'F' : 'G', o.label]);
    const d = Math.hypot(this.at.x - this.landing.x, this.at.y - this.landing.y);
    if (this.pose === 'stand' && d <= BACK_REACH && this.clock > 4) lines.push(['O', this.via === 'tender' ? 'back to the tender' : 'back aboard']);
    this.card.offer(lines);

    this.whenClock -= 0.2;
    if (this.whenClock <= 0) {
      this.whenClock = 5;
      this.when = ctx.world.dateAt(ctx.sim.state.t).toLocaleTimeString('en-GB', { timeZone: ctx.stage.course.timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
    }
    const here = this.here();
    const item = itemAt(this.hold);
    const mates = claims(this.pose) ? sittingWith(g, this.spot, here.map((f) => ({ spot: claims(f.report.pose) ? f.report.spot : -1, name: f.name }))) : [];
    const doing = this.pose === 'lean' ? viewWords(this.face, this.seen)
      : mates.length ? `At ${groupWords(g.spots[this.spot]?.group)} with ${mates.map((m) => m.name).join(' and ')}`
        : this.pose === 'sit' || this.pose === 'stool' ? `At ${groupWords(g.spots[this.spot]?.group) || 'a seat'}${item ? `, with ${item.name}` : ''}`
          : this.pose === 'dance' || this.pose === 'dance2' ? 'Dancing' : this.pose === 'warm' ? 'By the fire' : item ? `Carrying ${item.name}` : '';
    this.card.set({
      place: capital(this.place?.ashore?.name ?? g.name),
      when: `${this.when} · ashore, the boat ${ctx.sim.state.hold === 'anchor' ? 'at anchor' : 'made fast'}`,
      doing,
      who: here.length ? `Here too: ${here.map((f) => f.name).join(', ')}` : '',
      back: d <= BACK_REACH ? (this.via === 'tender' ? 'back to the tender' : 'back aboard') : `at the ${this.via === 'tender' ? 'tender' : 'dock'}, ${Math.round(d)} m back: aboard again`,
      company: ctx.company().length > 0,
    });
    this.card.hide(ctx.hud.readoutHidden);
  }

  private draw(dt: number): void {
    const { ctx } = this;
    const { camera, width, height } = ctx.view();
    const g = this.ground;
    if (g) {
      const item = itemAt(this.hold);
      this.me.draw({
        x: this.at.x, y: this.at.y, z: floorUnder(g, this.at), face: this.face, pose: this.pose, t: this.pose === 'dance' || this.pose === 'dance2' ? beat(this.since) : this.clock,
        phase: this.phase, speed: this.speed, emote: this.emote, emoteT: this.emoteT, held: item?.held ?? 'none', tint: item?.tint ?? '#ffffff',
      }, dt, camera, width, height, !this.tooClose);
    }
    // Everybody else ashore, here or at another place in sight.
    const eye = g ? this.at : ctx.sim.state;
    for (const f of this.friends.values()) {
      if (f.heardAt < 0) continue;
      f.track.update(dt);
      const [x, y] = toCourse(f.ground, f.track.u, f.track.v);
      if (Math.hypot(x - eye.x, y - eye.y) > 900) { f.walker.hide(); continue; }
      const area = areaAt(f.ground, x, y, 2);
      const r = f.report;
      const posed = r.pose !== 'stand';
      f.clock += dt;
      f.emoteT += dt;
      f.phase += stride(f.track.speed, f.walker.figure.tall, dt);
      const item = itemAt(f.mark ? ITEMS.findIndex((i) => i.id === f.mark) : r.hold);
      f.walker.draw({
        x, y, z: area >= 0 ? floorAt(f.ground.areas[area], x, y) : f.ground.areas[0].z, face: f.track.face, pose: r.pose,
        // Dancers keep time by when each began, so two pages see the same step.
        t: r.pose === 'dance' || r.pose === 'dance2' ? beat(r.since) : f.clock,
        phase: f.phase, speed: posed ? 0 : f.track.speed, emote: f.emoteT < EMOTE_SECONDS ? r.emote : '', emoteT: f.emoteT,
        held: item?.held ?? 'none', tint: item?.tint ?? '#ffffff',
      }, dt, camera, width, height);
    }

    // At the rail, the names of what she is looking at, out over the water.
    const looking = g !== null && this.pose === 'lean' && !ctx.hud.readoutHidden;
    for (let i = 0; i < this.sights.length; i++) {
      const el = this.sights[i];
      const s = looking ? this.seen[i] : undefined;
      if (!s) { el.style.display = 'none'; continue; }
      this.v.set(s.x, 14, -s.y).project(camera);
      const shown = this.v.z < 1 && Math.abs(this.v.x) < 1 && Math.abs(this.v.y) < 1;
      el.style.display = shown ? 'block' : 'none';
      if (!shown) continue;
      const text = `${s.name} · ${s.d < 926 ? `${Math.round(s.d / 10) * 10} m` : `${(s.d / 1852).toFixed(1)} nm`}`;
      if (el.textContent !== text) el.textContent = text;
      el.style.transform = `translate(-50%, -100%) translate(${Math.round(((this.v.x + 1) / 2) * width)}px, ${Math.round(((1 - this.v.y) / 2) * height)}px)`;
    }
  }

  // ---- what the session asks ---------------------------------------------------------------------

  status(): string {
    if (!this.ground) return '';
    return `Ashore at ${this.place?.ashore?.name ?? this.ground.name}`;
  }

  focus(): { x: number; y: number; heading: number; height: number; real: boolean } | null {
    const g = this.ground;
    if (!g) return null;
    // The drone looks at six tenths of the height it is given, plus its own view's: it was made for a boat on a swell.
    return { x: this.at.x, y: this.at.y, heading: this.camYaw, height: floorUnder(g, this.at) / 0.6, real: true };
  }

  /** The lens is kept on this side of the building, and she is not drawn when it is inside her head. */
  afterCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    const g = this.ground;
    if (!g) return;
    const z = floorUnder(g, this.at);
    const look = this.look.set(this.at.x, z + EYE, -this.at.y);
    const clear = clearTo(g, this.at.x, this.at.y, z + EYE, camera.position.x, -camera.position.z, camera.position.y);
    // In at once, out again gently.
    this.clip = clear < this.clip ? clear : this.clip + (clear - this.clip) * Math.min(1, dt * 3);
    let moved = this.clip < 0.995;
    if (moved) camera.position.lerpVectors(look, camera.position, Math.max(0.08, this.clip - 0.07));
    // Under an awning, or looking in under one, the lens stays below its edge.
    const roof = Math.min(ceilingAt(g, this.at.x, this.at.y), ceilingAt(g, camera.position.x, -camera.position.z)) - 0.3;
    if (camera.position.y > roof) {
      camera.position.y = roof;
      moved = true;
    }
    if (moved) camera.lookAt(look);
    this.tooClose = camera.position.distanceTo(look) < 0.85;
  }

  wire(): Record<string, unknown> {
    const g = this.ground;
    if (!g) return { as: null };
    const [u, v] = toLocal(g, this.at.x, this.at.y);
    return {
      as: packAshore({
        venue: g.id, u, v, face: this.face, pose: this.pose, spot: this.spot, since: this.since, emote: this.emote, emoteAt: this.emoteAt,
        hold: this.hold, round: this.round, roundItem: this.roundItem, gather: this.gather,
      }),
    };
  }

  dispose(): void {
    const { ctx } = this;
    if (this.ground && this.via !== 'tender') this.helm(true);
    this.stopAvatar();
    this.me.dispose(ctx.stage.scene);
    for (const f of this.friends.values()) f.walker.dispose(ctx.stage.scene);
    this.friends.clear();
    for (const m of this.marks.values()) {
      const i = ctx.places.indexOf(m.place);
      if (i >= 0) ctx.places.splice(i, 1);
    }
    this.marks.clear();
    for (const el of this.sights) el.remove();
    this.card.dispose();
  }
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** Seconds since a stamp (`stampOf`), by the clock on the wall: the same on every page, give or take their clocks. */
const beat = (since: number): number => ((((Date.now() / 1000) % 100000000) - since) % 100000000 + 100000000) % 100000000;
