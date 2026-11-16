import { KT, R2D, wrapPi } from '@slack-tide/sim';
import releasesJson from '../data/releases.json';
import { ALL_KEYS } from '../data/keys';
import { alone, onWeb } from '../net/platform';
import { rankOf } from '../xp/score';
import type { AboardContext, Feature } from './feature';
import { TIP_SECONDS, TIP_STORE, TipPicker, busy, emptySnap, readMemory, tipText, unread, whatsNew, writeMemory, type Snap, type Tip, type TipIcon } from './tipRules';
import { TIPS } from './tipTable';
import { VhfLight } from './vhfLight';

/** Release notes, newest first. */
const notes = (releasesJson as { notes: Array<{ id: string; title: string }> }).notes;
/** Where the board keeps the newest release note this person has read. */
const SEEN_NOTE = 'regatta.seen';
/** How often the game is looked at, real seconds. */
const TICK = 0.5;

/** Small line drawings, 24 by 24, drawn in the text colour. */
const ICONS: Record<TipIcon, string> = {
  helm: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22M4.9 4.9l2.5 2.5M16.6 16.6l2.5 2.5M19.1 4.9l-2.5 2.5M7.4 16.6l-2.5 2.5"/>',
  sail: '<path d="M11 3v15M11 3c4 4 6.5 8.5 7.5 14H11M9 6c-2 3.5-3.5 7-4 11h4M3 20.5h18"/>',
  keys: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h1M10 10h1M14 10h1M18 10h.5M7 14h10"/>',
  boats: '<path d="M7 4v9M7 4c2.5 2.5 4 5.5 4.5 9H7M3 16h9l-1.5 3h-6zM17 8v6M17 8c1.6 1.6 2.6 3.6 3 6h-3M13.5 16.5H21L20 19h-5.5z"/>',
  radio: '<rect x="7" y="8" width="10" height="13" rx="2"/><path d="M9.5 8V3M10 12h4M10 15.5h4M13.5 4.5c1.6.4 2.8 1.5 3.3 3M15 2c2.6.7 4.5 2.5 5.2 5"/>',
  flag: '<path d="M5 21V3M5 4h13l-3 4.5 3 4.5H5"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 11h8M4 14c.5 4 3.5 7 8 7s7.5-3 8-7M4 14l-1.5 2M4 14l2.3 1.2M20 14l1.5 2M20 14l-2.3 1.2"/>',
  shore: '<path d="M2 19c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0l2 .5M4 15l5-8 3.5 5 2.5-3 5 6"/><circle cx="17" cy="5.5" r="1.5"/>',
  moon: '<path d="M19 14.5A8 8 0 0 1 9.5 5 8 8 0 1 0 19 14.5zM16 4v3M14.5 5.5h3"/>',
  fish: '<path d="M3 12c3-4 7-5.5 11-4.5 2.5.6 4.5 2.3 6 4.5-1.5 2.2-3.5 3.9-6 4.5-4 1-8-.5-11-4.5zM3 12l-1-3M3 12l-1 3M16 11h.01"/>',
  engine: '<circle cx="12" cy="12" r="2"/><path d="M12 10c-2-3-1.5-6 1-7 2 2 1.5 5-1 7zM13.7 13c3.6-.2 5.9 1.7 5.5 4.4-2.7.7-5-1.2-5.5-4.4zM10.3 13c-1.6 3.2-4.4 4.3-6.5 2.6.7-2.7 3.5-3.7 6.5-2.6z"/>',
  tow: '<path d="M3 15h7l-1.5 4h-4zM6.5 15V8M6.5 8c1.8 1.6 2.8 3.9 3 7M10 16c3-2 6-2 9-1M19 12l2.5 3-3.5 1.5M2 21.5c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/>',
  chart: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14M6 13l2-2M11 10l2 1M17 9.5l1.5-1.5"/>',
  wind: '<path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h8a2.5 2.5 0 1 1-2.5 2.5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z"/>',
  news: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  kayak: '<path d="M2 15c4 3 16 3 20 0-4-1.5-16-1.5-20 0zM12 13.5V9M9.5 10.5a2.5 2.5 0 0 1 5 0M5 6l14 9M4 5l2 2M18 14l2 2"/>',
};

function saved(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/**
 * Pop-up tips: one small card at a time that says what a key does at the moment it is useful. Another boat turns
 * up, and the card says to hold V. It blows hard, and the card says J reefs. The tips are rows in `tipTable.ts`
 * and the choosing is `tipRules.ts`; this class looks at the game twice a second, draws the card, and remembers on
 * the device what has been shown and what the player has already done.
 *
 * The card has two buttons, "Got it" and "Don't show tips". Neither is a sailing control. It is hidden with the
 * instruments (H), goes away by itself, and goes away at once when the player presses the key it is about.
 * It also keeps the radio's light, bottom left (`vhfLight.ts`): clicking that explains the radio.
 *
 * From the console: `regatta.features.find((f) => f.id === 'tips').show('reef')` puts any tip up.
 */
export class Tips implements Feature {
  readonly id = 'tips';
  private readonly el = document.createElement('aside');
  private readonly picker: TipPicker;
  private readonly light: VhfLight;
  private readonly voice = onWeb();
  private readonly shared = !alone();
  private snap: Snap = emptySnap();
  private acc = 0;
  /** Real seconds sailed, not counting time paused. */
  private clock = 0;
  private lastSimT: number;
  private showing: Tip | null = null;
  private left = 0;
  private upFor = 0;
  /** A tip put up by hand (the radio light, the console) is not counted or remembered. */
  private byHand = false;

  private readonly xpAtStart: number;
  private readonly knockAtStart: number;
  private lessonSeen = false;
  private news: number;
  private trafficCalls = 0;
  private callAt = -1e9;
  private callFor = 0;
  private raceDone = 0;
  private wasFinished = false;
  private stuck = 0;
  private heldFor = 0;
  private damage: number;
  private hitAt = -1e9;
  private night = false;
  private nightAt = -1e9;

  constructor(private readonly ctx: AboardContext) {
    this.picker = new TipPicker(TIPS, readMemory(saved(TIP_STORE)));
    this.lastSimT = ctx.sim.state.t;
    this.xpAtStart = ctx.logbook.totals.xp;
    this.knockAtStart = ctx.sim.state.knockdowns;
    this.damage = ctx.sim.state.damage;
    // Someone back after an update, who has not read the notes and has not had this card for them.
    this.news = notes.length && this.picker.memory.news !== notes[0].id ? unread(notes, saved(SEEN_NOTE)).length : 0;

    this.el.className = 'hud tip';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    this.el.addEventListener('click', this.onClick);
    // A click on the card is not a click on the sea.
    for (const type of ['pointerdown', 'mousedown', 'wheel', 'touchstart']) this.el.addEventListener(type, (e) => e.stopPropagation());
    document.body.appendChild(this.el);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('regatta:tips', this.onSwitch);

    // The radio's words come through `heard`. Listening in here is how a ferry's call is noticed, without the radio knowing.
    const heard = ctx.heard;
    ctx.heard = (from, text) => {
      heard(from, text);
      if (!ctx.stage.traffic.vessels.some((v) => v.name === from)) return;
      this.trafficCalls++;
      this.callAt = performance.now();
      // About as long as the words take to say.
      this.callFor = 3000 + text.length * 70;
    };
    this.light = new VhfLight(ctx, {
      voice: this.voice,
      calling: () => performance.now() - this.callAt < this.callFor,
      explain: () => this.show('radio-about'),
    });
  }

  /** Put a tip up now, whatever the pacing says. Nothing is remembered about it. For the radio light, and for play testing. */
  show(id: string, snap: Partial<Snap> = {}): boolean {
    const tip = TIPS.find((t) => t.id === id);
    if (!tip) return false;
    if (this.showing) this.take(false);
    this.snap = { ...this.look(), ...snap };
    this.put(tip, true);
    return true;
  }

  /** What the picker sees, and what it remembers, for the console. */
  debug(): { snap: Snap; picker: TipPicker; showing: string | null } {
    return { snap: this.snap, picker: this.picker, showing: this.showing?.id ?? null };
  }

  update(dt: number): void {
    this.light.update(dt);
    if (this.showing) {
      this.left -= dt;
      this.upFor += dt;
    }
    this.acc += dt;
    if (this.acc < TICK) return;
    const step = Math.min(this.acc, 2);
    this.acc = 0;
    const s = this.snap = this.look(step);
    const due = this.picker.next(s, step, this.showing !== null);
    const now = this.showing;
    if (now) {
      // Done, timed out, or something more pressing is going on.
      if (!this.byHand && this.picker.memory.done[now.id]) this.take(true);
      else if (this.left <= 0) this.take(true);
      else if (busy(s)) this.take(this.upFor >= 4 || this.byHand);
    } else if (due) this.put(due, false);
    this.save();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('regatta:tips', this.onSwitch);
    this.light.dispose();
    this.el.remove();
  }

  // ---- the card --------------------------------------------------------------------------------

  private put(tip: Tip, byHand: boolean): void {
    this.showing = tip;
    this.byHand = byHand;
    this.left = tip.secs ?? TIP_SECONDS;
    this.upFor = 0;
    this.draw(tip);
    this.place();
    if (!byHand) {
      this.picker.showed(tip);
      if (tip.list === 'news' && notes.length) {
        this.picker.memory.news = notes[0].id;
        this.news = 0;
      }
      this.save();
    }
    this.el.hidden = false;
  }

  /** Take the card down. `seen` is false when it was up too briefly to have been read. */
  private take(seen: boolean): void {
    const tip = this.showing;
    if (!tip) return;
    this.showing = null;
    this.el.hidden = true;
    if (this.byHand) return;
    if (seen) this.picker.ended(this.snap);
    else this.picker.withdrew(tip);
    this.save();
  }

  /**
   * On a phone the card goes straight under the instruments, however tall they are just now (the engine's and the
   * damage's rows come and go). On a wide screen the stylesheet puts it on the right, under the clock.
   */
  private place(): void {
    const readout = document.getElementById('readout');
    const narrow = window.innerWidth <= 760;
    this.el.style.top = narrow && readout ? `${Math.round(readout.getBoundingClientRect().bottom + 10)}px` : '';
  }

  private draw(tip: Tip): void {
    const head = document.createElement('header');
    if (tip.icon) {
      head.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[tip.icon]}</svg>`);
    }
    const title = document.createElement('b');
    title.textContent = tip.title;
    head.append(title);
    if (tip.keys.length) head.append(caps(tip.keys));

    // Other boats' names are other people's words: text, never markup.
    const text = document.createElement('p');
    text.textContent = tipText(tip, this.snap);
    const parts: HTMLElement[] = [head, text];

    if (tip.list === 'news') {
      const list = document.createElement('ul');
      for (const line of whatsNew(notes, saved(SEEN_NOTE), ALL_KEYS)) {
        const li = document.createElement('li');
        const what = document.createElement('span');
        what.textContent = line.title;
        li.append(what);
        if (line.keys.length) li.append(caps(line.keys));
        list.append(li);
      }
      if (list.children.length) parts.push(list);
    }

    const foot = document.createElement('footer');
    const button = (act: string, label: string, cls = ''): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.act = act;
      b.className = cls;
      b.textContent = label;
      foot.append(b);
      return b;
    };
    button('got', 'Got it', 'primary');
    if (tip.list === 'news') button('news', 'See what changed');
    button('off', 'Don\'t show tips', 'quiet').title = 'No more of these. The Keys tab of the board (B) turns them back on';
    parts.push(foot);
    this.el.replaceChildren(...parts);
  }

  private readonly onClick = (e: MouseEvent): void => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (!act) return;
    const tip = this.showing;
    if (act === 'off') {
      this.picker.setOff(true);
      this.take(true);
      this.ctx.say('No more tips. The Keys tab of the board (B) turns them back on', 6);
    } else if (tip) {
      if (!this.byHand) this.picker.finish(tip.id);
      this.take(true);
      if (act === 'news') window.dispatchEvent(new CustomEvent('regatta:board', { detail: 'news' }));
    }
    this.save();
    // Back to the boat, so the keys go on working.
    this.ctx.stage.canvas.focus();
  };

  /** Every key the player presses, to notice when she does the thing a tip is about. Typing a hail does not count. */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement | null)?.tagName ?? '')) return;
    const hit = this.picker.pressed(e.code, e.shiftKey, this.byHand ? null : this.showing);
    if (hit) this.take(true);
    this.save();
  };

  /** The board's Keys tab has switched tips on or off. */
  private readonly onSwitch = (e: Event): void => {
    const off = (e as CustomEvent<{ off?: boolean }>).detail?.off === true;
    this.picker.setOff(off);
    if (off && this.showing) this.take(true);
    this.save();
  };

  private save(): void {
    if (!this.picker.dirty) return;
    this.picker.dirty = false;
    try {
      localStorage.setItem(TIP_STORE, writeMemory(this.picker.memory));
    } catch { /* nothing kept, then: the tips still pace themselves within a sail */ }
  }

  // ---- looking at the game ---------------------------------------------------------------------

  /** Take the snapshot. `dt` is the real seconds since the last one. */
  private look(dt = 0): Snap {
    const ctx = this.ctx;
    const sim = ctx.sim;
    const s = sim.state;
    const o = sim.out;
    const totals = ctx.logbook.totals;
    const paused = dt > 0 && s.t === this.lastSimT;
    this.lastSimT = s.t;
    if (!paused) this.clock += dt;

    const visible = (id: string): boolean => {
      const el = document.getElementById(id);
      return !!el && !el.hidden;
    };
    const lesson = visible('coach');
    if (lesson) this.lessonSeen = true;
    const hiddenHud = document.getElementById('readout')?.classList.contains('hidden') ?? false;
    const panel = paused || lesson || hiddenHud || visible('chart') || visible('board') || visible('fleetpanel') || visible('hail');

    const boats = ctx.company();
    let nearBoat = Infinity;
    let boatName = '';
    for (const b of boats) {
      const d = Math.hypot(b.x - s.x, b.y - s.y);
      if (d < nearBoat) {
        nearBoat = d;
        boatName = (b.boatName || b.name || '').slice(0, 24);
      }
    }

    const race = ctx.race;
    const racing = !!race && race.call !== null && race.finish === null;
    const finished = !!race && race.call !== null && race.finish !== null;
    if (finished && !this.wasFinished) this.raceDone++;
    this.wasFinished = finished;

    const windKt = o.tws / KT;
    const speedKt = Math.abs(s.speed) / KT;
    const held = s.hold !== 'none';
    const becalmed = o.inIrons || (windKt < 3 && speedKt < 1);
    this.stuck = becalmed && !held && !s.engineOn && !o.aground ? this.stuck + dt : 0;
    this.heldFor = held ? this.heldFor + dt : 0;
    if (s.damage > this.damage + 0.001) this.hitAt = this.clock;
    this.damage = s.damage;
    const twa = Math.abs(o.twa) * R2D;
    const loose = (sail: { luff: number; stall: number; flogging: boolean }): boolean => sail.flogging || sail.luff > 0.4 || sail.stall > 0.35;
    const mistrim = !s.crewTrim && !o.underPower && !held && twa > 36 && (loose(o.main) || (s.furl > 0.1 && o.jib.backed === 0 && loose(o.jib)));

    // The hour moves slowly: asked for every twenty seconds.
    if (this.clock - this.nightAt > 20) {
      this.nightAt = this.clock;
      const hour = Number(ctx.world.dateAt(s.t).toLocaleTimeString('en-GB', { timeZone: ctx.stage.course.timeZone, hour: '2-digit', hour12: false }).slice(0, 2));
      this.night = Number.isFinite(hour) && (hour >= 21 || hour < 5);
    }

    let berth: Snap['berth'] = null;
    let ashore: Snap['ashore'] = null;
    for (const p of ctx.places) {
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (p.kind && (!berth || d < berth.d)) berth = { name: p.name, kind: p.kind, d };
      if (p.ashore && (!ashore || d < ashore.d)) ashore = { name: p.name, where: p.ashore.name, d, dock: p.kind === 'dock' && s.hold === 'mooring' && d < 200 };
    }

    const passage = ctx.passage;
    const next = passage.marks[passage.nextIndex] ?? null;
    let mark: Snap['mark'] = null;
    if (next) {
      const off = Math.abs(wrapPi(o.twd - Math.atan2(next.x - s.x, next.y - s.y))) * R2D;
      mark = { d: Math.hypot(next.x - s.x, next.y - s.y), upwind: off < 40 };
    }

    return {
      t: this.clock,
      voice: this.voice, shared: this.shared,
      sails: totals.sails, hours: totals.hours, races: totals.races, rank: rankOf(totals.xp).index, xpGained: totals.xp - this.xpAtStart,
      lesson: this.lessonSeen, news: this.news,
      company: boats.length, nearBoat, boatName, trafficCalls: this.trafficCalls,
      racing, raceOffered: !!race && race.call === null && race.offers.size > 0, countdown: racing ? race.countdown : null, raceDone: this.raceDone,
      windKt, twaDeg: twa, heelDeg: Math.abs(s.heel) * R2D, speedKt,
      reef: s.reef, reefs: Math.max(0, ctx.spec.sails.main.reefs.length - 1), hasSpin: !!ctx.spec.sails.spinnaker, spin: s.spin,
      hasEngine: !!sim.boat.engine, engine: s.engineOn,
      hand: s.helmMode === 'hand', mistrim, aground: o.aground, stuck: this.stuck, knockdowns: s.knockdowns - this.knockAtStart,
      manoeuvre: s.maneuver !== null, knocked: o.knockedDown || s.knock > 0.05, hitAgo: this.clock - this.hitAt, panel,
      hold: s.hold, heldFor: this.heldFor, berth, ashore,
      tender: !!ctx.feature('kayak')?.focus?.(), night: this.night,
      depth: o.underKeel === null ? 99 : o.underKeel + ctx.spec.dimensions.draft,
      marks: passage.marks.length - passage.nextIndex, mark,
    };
  }
}

/** Key caps for a card. "+" joins two. */
function caps(keys: string[]): HTMLElement {
  const row = document.createElement('span');
  row.className = 'caps';
  for (const k of keys) {
    const cap = document.createElement(k === '+' ? 'i' : 'kbd');
    cap.textContent = k;
    row.append(cap);
  }
  return row;
}
