import * as THREE from 'three';
import { KT, SIM_DT } from '@slack-tide/sim';
import { ReelSound } from '../audio/reel';
import { BITE_SPELL, advice, biteIn, prospects, sounderLine, wayOf, whySlow, type Hooked, type Prospect, type Tackle, type Way } from '../fishing/bites';
import { FOUL_ANGLE, PART, SPOOL, endWords, fightCall, phaseWords, startFight, stepFight, type Fight } from '../fishing/fight';
import { PADDY_SIGHT, REPORT_EVERY, SCHOOL_SIGHT, paddiesAt, reportIn, schoolsAt, spooks, spotAt, type Paddy, type School, type Sea, type Spot } from '../fishing/grounds';
import { hereOf } from '../fishing/here';
import { addToCreel, bigness, fishWords, inches, scoreWords, xpFor, type Creel } from '../fishing/points';
import { readLure, readRig, speciesOf, type FishTable, type LureId, type RigId } from '../fishing/table';
import { freshAt, landFish, landedWords, newTrip, workPatch, type Trip } from '../fishing/trip';
import { reservesOf, type Reserve } from '../fishing/zones';
import { ORDINAL } from '../race/race';
import { FishMarks } from '../scene/fishMarks';
import { loadCreel, saveCreel } from '../ui/catchCard';
import { addChartLayer } from '../ui/chartLayers';
import { FishCard } from '../ui/fishcard';
import { fishingLayer, type Known } from '../ui/fishLayer';
import '../ui/fishStyle';
import { DerbyDesk } from './derbyDesk';
import type { AboardContext, Feature } from './feature';

const UP = new THREE.Vector3(0, 1, 0);
const ROD_LENGTH = 2.2;
const ROD_BUTT = 0.3;
const SAVED = 'regatta.tackle';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A direction off the bow in the crew's words. `rel` is radians, positive to starboard. */
function offBow(rel: number): string {
  const a = wrap(rel);
  const side = a >= 0 ? 'starboard' : 'port';
  const m = Math.abs(a);
  if (m < 0.2) return 'dead ahead';
  if (m < 1.2) return `off the ${side} bow`;
  if (m < 1.95) return `to ${side}`;
  if (m < 2.9) return `on the ${side} quarter`;
  return 'astern';
}

const rangeWords = (d: number): string => (d < 1000 ? `${Math.max(50, Math.round(d / 50) * 50)} m` : `${(d / 1852).toFixed(1)} miles`);

/** True for a boat driven by an engine alone: a `power` block in her file, or no mainsail to set. Never by her id. */
export function isPowerboat(spec: unknown): boolean {
  const s = spec as { power?: unknown; sails?: { main?: unknown } };
  return !!s.power || !s.sails?.main;
}

interface Rod { mesh: THREE.Mesh; line: THREE.Line; foot: THREE.Vector3; side: number }

/**
 * Fishing on a water that has its own fishing table (`courses/<id>/fishing.json`). L puts the lines out and brings
 * them in. Making way they tow a lure; stopped they fish a bait, the iron or squid, and cast when birds or a kelp
 * paddy are within reach. A fish that takes has to be fought: hold L to wind when it is not running, slow the boat,
 * and steer to keep the line astern. Shift+L is the fishing card: tackle, what is biting, the catch, tournaments.
 *
 * Everything that decides what bites and how it fights is pure and lives in `src/fishing/`. This class reads the
 * boat and the world, keeps the state of one sail's fishing, and draws it.
 */
export class Angling implements Feature {
  readonly id = 'fishing';
  readonly desk: DerbyDesk;
  private readonly water: string;
  private readonly reserves: Reserve[];
  private readonly sea: Sea;
  private readonly tackle: Tackle;
  private trip: Trip = newTrip();
  private creel: Creel = loadCreel();
  private out = false;
  private spot: Spot;
  private way: Way = 'iron';
  private ticks = 0;
  private spell = -1;
  /** Game seconds before the next bite can come. */
  private rest = 0;
  private hooked: Hooked | null = null;
  private fight: Fight | null = null;
  private lastHeading = 0;
  private lastLine = 0;
  /** A fish at the rail, waiting to be kept or let go: real seconds left to say, and seconds since it came up. */
  private rail: { hooked: Hooked; left: number; armed: boolean } | null = null;
  /** Real seconds after a fish is lost during which L is not taken as "lines in". */
  private late = 0;
  private atBarge = false;
  private readonly down = new Set<number>();
  private readonly known = new Map<number, Known>();
  private paddies: Paddy[] = [];
  private schools: School[] = [];
  private reportSlot = -1;
  /** What the player was last told the line is doing and why, and how long things have been saying something else. */
  private told = '';
  private toldFor = 0;
  private ringTold = '';

  private readonly card: FishCard;
  private readonly marks: FishMarks;
  private readonly reel: ReelSound;
  private readonly unlayer: () => void;
  private readonly lineEl = document.createElement('div');
  private readonly catchEl = document.createElement('div');
  private catchLeft = 0;
  private hudClock = 0;
  private shownHud = '';

  private readonly rig = new THREE.Group();
  private rods: Rod[] = [];
  private readonly aim = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private stream = 0;
  private dip = 0;
  private clock = 0;

  constructor(private readonly ctx: AboardContext, private readonly table: FishTable) {
    this.water = ctx.stage.course.id;
    this.reserves = reservesOf(this.water);
    this.sea = { depth: (x, y) => ctx.world.chartDepth(x, y) };
    let saved: { lure?: unknown; rig?: unknown } = {};
    try {
      saved = JSON.parse(localStorage.getItem(SAVED) ?? '{}') as typeof saved;
    } catch { /* the first choices, then */ }
    this.tackle = { lure: readLure(saved?.lure), rig: readRig(saved?.rig), bait: 0, rods: isPowerboat(ctx.spec) ? 2 : 1 };
    this.spot = this.look();
    this.lastHeading = ctx.sim.state.heading;

    this.desk = new DerbyDesk(ctx, table, this.water, (place, field, xp, won) => {
      this.creel = { ...this.creel, derbies: this.creel.derbies + 1, derbyWins: this.creel.derbyWins + (won ? 1 : 0) };
      saveCreel(this.creel);
      if (xp > 0) ctx.logbook.earn({ kind: 'fish', points: xp, label: `Tournament: ${ORDINAL[place - 1] ?? place} of ${field}` });
      this.showCatch('Weigh-in', `${ORDINAL[place - 1] ?? place} of ${field}`, xp > 0 ? `Worth ${xp} experience` : 'Nothing at the scale this time', 'The results are on the fishing card, Shift+L', 10);
    });
    this.card = new FishCard({
      table, water: this.water, desk: this.desk,
      tackle: () => this.tackle,
      setLure: (id) => this.setTackle(id, this.tackle.rig),
      setRig: (id) => this.setTackle(this.tackle.lure, id),
      now: () => this.nowWords(),
      trip: () => this.trip,
      creel: () => this.creel,
      company: () => ctx.company().length > 0,
    });
    this.marks = new FishMarks(ctx.stage.scene, (x, z, t) => ctx.stage.seaLevel(x, z, t));
    this.reel = new ReelSound(ctx.sound);
    this.unlayer = addChartLayer(fishingLayer(table, this.reserves, this.sea, () => [...this.known.values()]));

    this.lineEl.className = 'hud fishline';
    this.lineEl.setAttribute('role', 'status');
    this.lineEl.hidden = true;
    this.catchEl.className = 'hud fishcatch';
    this.catchEl.setAttribute('role', 'status');
    this.catchEl.hidden = true;
    document.body.append(this.lineEl, this.catchEl);

    this.rig.name = 'fishing_rods';
    this.rig.visible = false;
    this.buildRods();
  }

  // ---- reading the water ----------------------------------------------------------------------------------

  private look(): Spot {
    const { sim, world, stage } = this.ctx;
    const s = sim.state;
    const here = hereOf(world, stage.course.timeZone, s.x, s.y, s.t, Math.abs(s.speed) / KT, sim.out.sog / KT, s.hold !== 'none');
    return spotAt(this.table, this.reserves, here, this.ctx.seasonNow(), this.sea, this.down);
  }

  private fresh(): number {
    return freshAt(this.trip, this.spot.x, this.spot.y, this.ctx.seasonNow());
  }

  private nowWords(): { out: boolean; advice: string; sounder: string; biting: Prospect[] } {
    return { out: this.out, advice: advice(this.table, this.spot, this.tackle, this.fresh()), sounder: sounderLine(this.table, this.spot, this.tackle), biting: prospects(this.table, this.spot, this.tackle) };
  }

  private setTackle(lure: LureId, rig: RigId): void {
    this.tackle.lure = lure;
    this.tackle.rig = rig;
    try {
      localStorage.setItem(SAVED, JSON.stringify({ lure, rig }));
    } catch { /* not remembered */ }
    this.told = '';
  }

  // ---- keys -----------------------------------------------------------------------------------------------------

  key(code: string, shift: boolean): boolean {
    if (code === 'KeyX') {
      // Nobody anchors inside a platform's ring.
      const p = this.spot.platform;
      if (!p?.inside || this.ctx.sim.state.hold !== 'none') return false;
      this.ctx.say(`No anchoring within ${p.p.keepOff} m of ${p.p.name}. Stand off and drift the up-current side`, 6);
      return true;
    }
    if (code !== 'KeyL') return false;
    if (this.rail) {
      // The hand that was winding has to come off the reel first, so the last turn of the handle does not decide it.
      if (!this.rail.armed) return true;
      const guarded = !!this.rail.hooked.species.protected;
      // L does the ordinary thing: keeps a fish that may be kept, lets a protected one go. Shift+L does the other.
      this.settle(this.rail.hooked, shift !== guarded ? 'release' : 'keep');
      return true;
    }
    if (shift) {
      this.card.toggle();
      return true;
    }
    if (this.fight) return true;
    if (this.out && this.late > 0) {
      this.late = 0;
      return true;
    }
    if (this.out) {
      this.out = false;
      this.rig.visible = false;
      this.ctx.say(this.trip.landed.length ? `Lines in. Today: ${this.trip.landed.length} fish, ${this.trip.points} points` : 'Lines in', 5);
      return true;
    }
    this.spot = this.look();
    if (this.spot.reserve) {
      this.ctx.say(`${this.spot.reserve.say} The line stays in`, 7);
      return true;
    }
    this.out = true;
    this.rig.visible = true;
    this.way = wayOf(this.spot, this.tackle);
    this.stream = this.way === 'troll' || this.way === 'skip' ? 1 : 0;
    this.rest = BITE_SPELL;
    this.spell = Math.floor(this.ctx.seasonNow() / BITE_SPELL);
    this.told = this.tellKey();
    this.toldFor = 0;
    this.ctx.say(`${this.tackle.rods > 1 ? 'Lines' : 'Line'} out. ${advice(this.table, this.spot, this.tackle, this.fresh())}. L brings ${this.tackle.rods > 1 ? 'them' : 'it'} in, Shift+L is the tackle`, 10);
    return true;
  }

  /** What would be said now, boiled down to the part that matters for saying it again. */
  private tellKey(): string {
    return `${wayOf(this.spot, this.tackle)}|${whySlow(this.table, this.spot, this.tackle, this.fresh())}`;
  }

  // ---- the fixed step: bites and the fight --------------------------------------------------------------------------

  step(): void {
    const s = this.ctx.sim.state;
    const turn = wrap(s.heading - this.lastHeading) / SIM_DT;
    this.lastHeading = s.heading;
    const f = this.fight;
    if (f && this.hooked) {
      stepFight(f, { reel: this.ctx.held('KeyL'), boatKt: Math.abs(s.speed) / KT, turn }, SIM_DT);
      if (f.result) this.endFight(f, this.hooked);
      return;
    }
    // Twice a game second is often enough to look at the water.
    if (++this.ticks % 30) return;
    const now = this.ctx.seasonNow();
    const spot = this.spot = this.look();
    this.paddies = paddiesAt(this.table, now, this.sea);
    this.schools = schoolsAt(this.table, now, this.sea).filter((k) => !this.down.has(k.key));
    this.lookAbout(spot, now);
    this.takeBait(spot);
    this.hearReport(now);
    if (spot.platform?.inside && this.ringTold !== spot.platform.p.id && s.hold === 'none') {
      this.ringTold = spot.platform.p.id;
      this.ctx.say(`Inside the ${spot.platform.p.keepOff} m ring round ${spot.platform.p.name}. Nobody fishes or anchors in here: stand off`, 7);
    } else if (!spot.platform) this.ringTold = '';
    if (!this.out || this.rail) return;

    this.way = wayOf(spot, this.tackle);
    // Say what the line is doing when the boat settles to something new, and when the reason changes.
    const key = this.tellKey();
    if (key === this.told) this.toldFor = 0;
    else if ((this.toldFor += 0.5) >= 8) {
      this.told = key;
      this.toldFor = 0;
      this.ctx.say(advice(this.table, spot, this.tackle, this.fresh()), 7);
    }
    if (this.rest > 0) this.rest -= 0.5;
    const spell = Math.floor(now / BITE_SPELL);
    if (spell === this.spell) return;
    this.spell = spell;
    if (this.rest > 0) return;
    const bite = biteIn(this.table, spot, this.tackle, spell, this.fresh());
    if (bite) this.strike(bite, spot);
  }

  /** The crew see a paddy on the water, or birds working, and say so once. It goes on the chart. */
  private lookAbout(spot: Spot, now: number): void {
    const daylight = spot.hour > 5 && spot.hour < 21;
    const s = this.ctx.sim.state;
    const call = (what: Known['what'], key: number, x: number, y: number, words: string, until: number): void => {
      const was = this.known.get(key);
      this.known.set(key, { key, what, x, y, told: false, until });
      if (was && !was.told) return;
      const d = Math.hypot(x - s.x, y - s.y);
      this.ctx.say(`${words}, ${rangeWords(d)} ${offBow(Math.atan2(x - s.x, y - s.y) - s.heading)}`, 7);
    };
    if (daylight) {
      for (const p of this.paddies) {
        if (Math.hypot(p.x - s.x, p.y - s.y) < PADDY_SIGHT) call('paddy', p.key, p.x, p.y, p.holding ? 'A kelp paddy, with birds over it' : 'A kelp paddy', now + 3600);
      }
      for (const k of this.schools) {
        const d = Math.hypot(k.x - s.x, k.y - s.y);
        if (d < SCHOOL_SIGHT) call(k.kind, k.key, k.x, k.y, k.kind === 'foamer' ? 'Foamer! White water and birds diving' : 'Birds working', now + 600);
        if (spooks(d, Math.abs(s.speed) / KT)) {
          this.down.add(k.key);
          this.known.delete(k.key);
          this.ctx.say('She ran through the middle of the school and put it down. Next time stop short and cast, or tow the lures past the edge', 8);
        }
      }
    }
    // Things move, and they go: keep what is known true.
    for (const [key, k] of this.known) {
      const live = k.what === 'paddy' ? this.paddies.find((p) => p.key === key) : this.schools.find((c) => c.key === key);
      if (k.until < now || (!live && !k.told) || this.down.has(key)) this.known.delete(key);
      else if (live && !k.told) { k.x = live.x; k.y = live.y; }
    }
  }

  private takeBait(spot: Spot): void {
    if (!spot.barge) { this.atBarge = false; return; }
    if (this.atBarge || spot.speedKt > 1.5) return;
    this.atBarge = true;
    const b = this.table.bait;
    if (this.tackle.bait >= b.most) {
      this.ctx.say(`The bait tank is full: ${this.tackle.bait} ${b.name}`, 5);
      return;
    }
    this.tackle.bait = Math.min(b.most, this.tackle.bait + b.scoop);
    this.ctx.say(`A scoop of ${b.name} from the bait barge: ${this.tackle.bait} in the tank. Shift+L, then Live bait, to fish them`, 8);
  }

  /** A true report from another boat, now and then, written among the hails. What it tells of goes on the chart. */
  private hearReport(now: number): void {
    const slot = Math.floor(now / REPORT_EVERY);
    if (slot === this.reportSlot) return;
    // Nothing in the first breath of a sail: the first report is the next one to come round.
    const first = this.reportSlot < 0;
    this.reportSlot = slot;
    if (first) return;
    const r = reportIn(this.table, slot, this.spot.month, this.sea);
    if (!r || this.known.has(r.key) || this.down.has(r.key)) return;
    this.known.set(r.key, { key: r.key, what: r.what, x: r.x, y: r.y, told: true, until: r.until });
    this.ctx.heard(r.from, `${r.text} It is on your chart.`);
  }

  private strike(hooked: Hooked, spot: Spot): void {
    const now = this.ctx.seasonNow();
    workPatch(this.trip, spot.x, spot.y, now);
    if (hooked.way === 'bait') this.tackle.bait = Math.max(0, this.tackle.bait - 1);
    const lineOut = hooked.way === 'troll' ? 40 : spot.casting ? 35 : Math.min(60, 6 + spot.depth * 0.6);
    this.hooked = hooked;
    this.fight = startFight(hooked.species.fight, bigness(hooked.species, hooked.cm), hooked.seed, lineOut);
    this.lastLine = lineOut;
    const slow = spot.speedKt > 2.5 ? 'Slow the boat. ' : '';
    this.ctx.alarm(`Fish on! ${slow}Hold L to wind when it stops running, and let go when it runs`);
  }

  private endFight(f: Fight, hooked: Hooked): void {
    this.fight = null;
    this.reel.set(0, false);
    if (f.result !== 'landed') {
      this.hooked = null;
      this.trip.lost++;
      this.rest = 45;
      this.late = 2.5;
      this.ctx.say(`${f.t > 25 ? `Gone, after ${Math.round(f.t)} seconds. ` : 'Gone. '}${endWords(f.result!)}`, 9);
      return;
    }
    const aboard = this.trip.aboard.get(hooked.species.id) ?? 0;
    const sp = hooked.species;
    // A short fish, or one over the limit, goes straight back. Anything else, the angler says.
    if (!sp.protected && ((sp.minCm !== undefined && hooked.cm < sp.minCm) || (sp.bag !== undefined && aboard >= sp.bag))) {
      this.settle(hooked, 'release');
      return;
    }
    this.rail = { hooked, left: 14, armed: false };
    this.showCatch('At the rail', fishWords(sp.name, hooked.cm, hooked.kg, sp.measure), sp.protected ? `${sp.protected}` : `${sp.limit.charAt(0).toUpperCase()}${sp.limit.slice(1)}`, sp.protected ? 'L lets her go · Shift+L keeps her, which is poaching' : 'L keeps it · Shift+L lets it go, for a little extra', 14);
  }

  /** The fish is kept or let go: score it, write it down, and get the line back out. */
  private settle(hooked: Hooked, wish: 'keep' | 'release'): void {
    this.rail = null;
    this.hooked = null;
    this.rest = 40;
    const l = landFish(this.trip, this.water, hooked, wish);
    this.creel = addToCreel(this.creel, l);
    saveCreel(this.creel);
    const book = this.ctx.logbook;
    if (l.fate === 'poached') book.earn({ kind: 'lost', points: xpFor(l.points), label: 'Kept a protected fish' });
    else {
      book.totals.fish++;
      book.earn({ kind: 'fish', points: xpFor(l.points), label: l.fate === 'kept' ? 'Fish landed' : 'Fish let go' });
    }
    this.desk.landed(l);
    const title = l.fate === 'kept' ? 'In the box' : l.fate === 'short' ? 'Short: back it goes' : l.fate === 'poached' ? 'Kept, against the law' : l.fate === 'protected' ? 'Let go, as she must be' : 'Let go';
    const tail = landedWords(this.trip, hooked, l).split('. ').slice(1).join('. ');
    this.showCatch(title, scoreWords(hooked.species.name, l.cm, l.kg, l.points, hooked.species.measure), tail, `Today: ${this.trip.landed.length} fish · ${this.trip.points} points${this.desk.call ? ` · ${this.desk.line()}` : ''}`, 8);
  }

  private showCatch(small: string, big: string, line: string, foot: string, seconds: number): void {
    const [what, pts] = big.split(' — ');
    this.catchEl.innerHTML = `<small>${esc(small)}</small><b>${esc(what)}${pts ? ` — <em>${esc(pts)}</em>` : ''}</b>${line ? `<span>${esc(line)}</span>` : ''}<i>${esc(foot)}</i>`;
    this.catchLeft = seconds;
  }

  // ---- once a frame ---------------------------------------------------------------------------------------------

  update(dt: number, seaTime: number): void {
    if (this.late > 0) this.late -= dt;
    this.clock += dt;
    if (this.rail) {
      if (!this.ctx.held('KeyL')) this.rail.armed = true;
      this.rail.left -= dt;
      // Nobody said: an ordinary fish goes in the box, a protected one goes back.
      if (this.rail.left <= 0) this.settle(this.rail.hooked, this.rail.hooked.species.protected ? 'release' : 'keep');
    }
    if (this.catchLeft > 0) this.catchLeft -= dt;
    const hidden = this.ctx.hud.readoutHidden;
    this.catchEl.hidden = this.catchLeft <= 0 || hidden;
    this.desk.update(dt);
    this.card.update(dt);
    const s = this.ctx.sim.state;
    this.marks.update(dt, seaTime, s, this.paddies, this.schools);

    const f = this.fight;
    if (f) {
      // The ratchet sings with the line going out.
      const rate = (f.line - this.lastLine) / Math.max(dt, 1e-3);
      this.lastLine = f.line;
      this.reel.set(rate > 0.2 ? Math.min(1, rate / 6) : 0, this.ctx.held('KeyL'));
    }
    this.hudClock -= dt;
    if (this.hudClock <= 0) {
      this.hudClock = 0.2;
      this.drawHud(hidden);
    }
    if (this.out) this.drawRods(dt, seaTime);
  }

  private drawHud(hidden: boolean): void {
    const f = this.fight;
    const show = !hidden && (f !== null || this.out || this.desk.call !== null);
    this.lineEl.hidden = !show;
    if (!show) return;
    let html: string;
    if (f) {
      const call = fightCall(f, { reel: this.ctx.held('KeyL'), boatKt: Math.abs(this.ctx.sim.state.speed) / KT, turn: 0 });
      const strain = Math.min(1, f.tension / 1.3);
      // Close enough to see what it is.
      const what = f.line < 18 && this.hooked ? this.hooked.species.name : 'Fish on';
      const where = Math.max(0, Math.min(1, 0.5 + (0.32 * f.angle) / FOUL_ANGLE));
      html = `<h4><span>${esc(what.charAt(0).toUpperCase() + what.slice(1))}</span><i>${Math.floor(f.t / 60)}:${String(Math.floor(f.t % 60)).padStart(2, '0')}</i></h4>
        <p class="fishstate">${esc(phaseWords(f).replace(/^./, (c) => c.toUpperCase()))}</p>
        <div class="bar"><span>Line</span><div class="track"><i style="width:${(Math.min(1, f.line / SPOOL) * 100).toFixed(1)}%"></i></div><b>${Math.round(f.line)} m</b></div>
        <div class="bar"><span>Strain</span><div class="track strain"><i style="width:${(strain * 100).toFixed(1)}%"></i></div><b>${f.tension > PART ? 'parting' : f.tension > 0.66 ? 'drag' : f.tension < 0.14 ? 'slack' : 'good'}</b></div>
        <div class="where"><span>Fish</span><div class="arc"><i style="left:${(where * 100).toFixed(1)}%"></i></div></div>
        <p class="call">${esc(call)}</p>
        <p class="dim">Hold L to wind. Port and starboard of the mark is where the fish is off the stern: the red ends are under the boat.</p>`;
    } else {
      const total = `Today ${this.trip.landed.length} fish · ${this.trip.points} points`;
      const derby = this.desk.line();
      if (this.out) {
        const on = prospects(this.table, this.spot, this.tackle);
        const head = this.way === 'troll' ? `Trolling · ${this.spot.speedKt.toFixed(1)} kt` : this.way === 'skip' ? 'Too fast to fish' : this.spot.casting ? 'Casting' : this.spot.held ? 'Fishing at anchor' : 'Drifting';
        const why = whySlow(this.table, this.spot, this.tackle, this.fresh());
        html = `<h4><span>${esc(head)}</span><i>${esc(total)}</i></h4>
          <p>${esc(on.length ? `For ${on.slice(0, 3).map((p) => p.species.name).join(', ')}` : 'Nothing here will take it')}${this.way !== 'troll' && this.way !== 'skip' && this.tackle.rig === 'bait' ? ` · ${this.tackle.bait} live baits` : ''}</p>
          ${why ? `<p class="dim">${esc(why)}</p>` : ''}
          <p class="dim">Sounder: ${esc(sounderLine(this.table, this.spot, this.tackle))}</p>
          ${derby ? `<p class="call">${esc(derby)}</p>` : ''}`;
      } else {
        html = `<h4><span>Lines in</span><i>${esc(total)}</i></h4><p class="call">${esc(derby)}</p>`;
      }
    }
    if (html !== this.shownHud) {
      this.shownHud = html;
      this.lineEl.innerHTML = html;
    }
  }

  // ---- the rods --------------------------------------------------------------------------------------------------

  private buildRods(): void {
    for (const r of this.rods) {
      r.mesh.geometry.dispose();
      (r.mesh.material as THREE.Material).dispose();
      r.line.geometry.dispose();
      (r.line.material as THREE.Material).dispose();
    }
    this.rig.clear();
    this.rods = [];
    const { spec, boatView } = this.ctx;
    const d = spec.dimensions;
    boatView.root.add(this.rig);
    boatView.root.updateWorldMatrix(true, true);
    // In the boat's own rod holders where her model has them, else in holders on the stern rail.
    const holder = (name: string, side: number): THREE.Vector3 => {
      const node = boatView.root.getObjectByName(name);
      if (node) return boatView.root.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
      return new THREE.Vector3(side * d.beam * 0.17, d.freeboard + 0.5, d.loa / 2 - 0.06);
    };
    const sides = this.tackle.rods > 1 ? [1, -1] : [1];
    for (const side of sides) {
      const geo = new THREE.CylinderGeometry(0.005, 0.016, ROD_LENGTH, 6);
      geo.translate(0, ROD_LENGTH / 2 - ROD_BUTT, 0);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.45 }));
      mesh.castShadow = true;
      const foot = holder(side > 0 ? 'rod_stbd' : 'rod_port', side);
      mesh.position.copy(foot);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xeef25a }));
      line.frustumCulled = false;
      this.rig.add(mesh, line);
      this.rods.push({ mesh, line, foot, side });
    }
  }

  private drawRods(dt: number, seaTime: number): void {
    const { stage, boatView } = this.ctx;
    const f = this.fight;
    const towing = this.way === 'troll' || this.way === 'skip';
    this.stream += ((towing ? 1 : 0) - this.stream) * Math.min(1, dt * 1.5);
    this.dip += ((f ? 1 : 0) - this.dip) * Math.min(1, dt * 6);
    this.rods.forEach((rod, i) => {
      // The fish is on the first rod. The other is wound in out of the way while it is fought.
      const hot = f !== null && i === 0;
      rod.line.visible = !f || hot;
      const bend = hot ? this.dip : 0;
      const strain = hot && f ? Math.min(1, f.tension) : 0;
      const lift = 0.9 - (0.35 + 0.4 * strain) * bend + (hot ? Math.sin(this.clock * 17) * 0.05 : 0);
      this.aim.set(rod.side * 0.12, Math.sin(lift), Math.cos(lift)).normalize();
      rod.mesh.quaternion.setFromUnitVectors(UP, this.aim);
      this.tip.copy(this.aim).multiplyScalar(ROD_LENGTH - ROD_BUTT).add(rod.foot);
      let under = 2.2 - 2 * this.stream;
      if (hot && f) {
        // To the fish: off the stern at its angle, as far as the eye can follow the line.
        const r = Math.min(f.line, 45);
        this.end.set(this.tip.x + Math.sin(f.angle) * r, 0, this.tip.z + Math.cos(f.angle) * r);
        under = f.phase === 'sound' ? 3 : 0.4;
      } else if (this.spot.casting && !towing) {
        // Cast towards the fish.
        const t = this.spot.school?.school ?? this.spot.paddy?.paddy;
        this.end.set(t ? t.x : 0, 0, t ? -t.y : 0);
        boatView.root.worldToLocal(this.end);
        const len = Math.hypot(this.end.x - this.tip.x, this.end.z - this.tip.z) || 1;
        const reach = Math.min(len, 28 + i * 6);
        this.end.set(this.tip.x + ((this.end.x - this.tip.x) / len) * reach, 0, this.tip.z + ((this.end.z - this.tip.z) / len) * reach);
        under = 0.3;
      } else {
        this.end.set(this.tip.x + rod.side * (0.15 + 1.2 * this.stream), 0, this.tip.z + 0.9 + (21 + i * 9) * this.stream);
      }
      boatView.root.localToWorld(this.end);
      this.end.y = stage.seaLevel(this.end.x, this.end.z, seaTime) - under;
      boatView.root.worldToLocal(this.end);
      const p = rod.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      p.setXYZ(0, this.tip.x, this.tip.y, this.tip.z);
      p.setXYZ(1, this.end.x, this.end.y, this.end.z);
      p.needsUpdate = true;
    });
  }

  // ---- what the rest of the game asks ----------------------------------------------------------------------------

  status(): string {
    if (this.fight) return 'Fish on';
    if (this.rail) return 'Fish at the rail';
    if (!this.out) return '';
    return this.way === 'troll' ? 'Trolling' : this.way === 'skip' ? '' : 'Fishing';
  }

  wire(): Record<string, unknown> {
    return this.desk.wire();
  }

  /** What the pop-up tips want to know about the fishing. */
  tipState(): { out: boolean; trollWater: boolean; bargeNear: boolean; bait: number; fighting: boolean; offered: boolean; landed: number } {
    const barge = this.table.grounds.find((g) => g.kind === 'barge')?.circle;
    const s = this.ctx.sim.state;
    return {
      out: this.out, trollWater: (this.spot.hab.channel ?? 0) > 0.5 || !!this.spot.hab.reef || !!this.spot.hab.rocks,
      bargeNear: !!barge && Math.hypot(s.x - barge[0], s.y - barge[1]) < 1800, bait: this.tackle.bait,
      fighting: this.fight !== null, offered: this.desk.call === null && this.desk.offers.size > 0, landed: this.trip.landed.length,
    };
  }

  /** For the console and the tests in a browser: what the fishing is doing, and a way to put a fish on the line. */
  debug(): Record<string, unknown> {
    return { out: this.out, way: this.way, spot: this.spot, tackle: this.tackle, trip: this.trip, fight: this.fight, rail: this.rail, known: [...this.known.values()], paddies: this.paddies, schools: this.schools, desk: this.desk, card: this.card };
  }

  debugHook(speciesId: string, cm: number): boolean {
    const species = speciesOf(this.table, speciesId);
    if (!species || this.fight || this.rail) return false;
    if (!this.out) this.key('KeyL', false);
    this.strike({ species, cm, kg: species.kgPerCm3 * cm ** 3, way: wayOf(this.spot, this.tackle), seed: 12345 + inches(cm) }, this.spot);
    return true;
  }

  reboat(): void {
    this.tackle.rods = isPowerboat(this.ctx.spec) ? 2 : 1;
    this.buildRods();
  }

  dispose(): void {
    this.ctx.boatView.root.remove(this.rig);
    this.rods.forEach((r) => {
      r.mesh.geometry.dispose();
      (r.mesh.material as THREE.Material).dispose();
      r.line.geometry.dispose();
      (r.line.material as THREE.Material).dispose();
    });
    this.marks.dispose();
    this.reel.dispose();
    this.unlayer();
    this.card.dispose();
    this.lineEl.remove();
    this.catchEl.remove();
  }
}
