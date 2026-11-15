import { KT, R2D, polarSpeed } from '@slack-tide/sim';
import type { Waypoint } from '@slack-tide/nav';
import type { ReplayWorld } from '@slack-tide/world';
import { TOPSIDES, type LineupEntry, type YardBoat } from '../boat/yard';
import { alone, onWeb } from '../net/platform';
import type { CourseAbout } from '../world/loadCourse';
import { inText, nextEvent, whenText } from '../race/events';

export interface StartSpot {
  id: string;
  name: string;
  where: string;
  teaches: string;
  x: number;
  y: number;
  route: Waypoint[];
}

/** A time of day to cast off, as hours into the replayed season. */
export interface StartTime {
  id: string;
  name: string;
  hours: number;
  say: string;
  /** How much harder than the record it blows from this start: 1.5 is half as much again. The day as it was when left out. */
  boost?: number;
  /** The time a newcomer to this water is offered. Early afternoon where no time says so. */
  default?: boolean;
}

export type Weather = 'light' | 'normal' | 'heavy';
/** The weather levels offered on the way in: a multiplier on the recorded wind, and what to tell the skipper. */
export const WEATHER: { id: Weather; name: string; factor: number; say: string }[] = [
  { id: 'light', name: 'Lighter', factor: 0.6, say: 'Lighter: about two thirds of the recorded wind. Gentle, forgiving, good for a first sail. If other boats are out in more, you get their wind' },
  { id: 'normal', name: 'As it was', factor: 1, say: 'As it was: the wind of the real day' },
  { id: 'heavy', name: 'Extreme', factor: 1.5, say: 'Extreme: half as much wind again, 20 knots and more with hard gusts. She can be knocked flat or gybe by accident. Reef early (J) and it will teach you fast' },
];

/** What the player picked on the way in. */
export interface Choice {
  /** Which water: a course id. */
  water: string;
  spot: string;
  time: string;
  /** How hard it blows against the record: lighter, as it was, or heavy. Left out means as it was. */
  weather?: Weather;
  boat: string;
  colour: string;
  name: string;
  /** What the skipper is called, shown to the rest of the fleet. */
  skipper: string;
  tutorial: boolean;
}

/** What changes with the water: where to start, when, and the wind and tide on the cards. */
export interface WaterView {
  about: CourseAbout;
  spots: StartSpot[];
  times: StartTime[];
  world: ReplayWorld;
}

export interface JoinOptions extends WaterView {
  /** Every water on offer. */
  waters: CourseAbout[];
  lineup: LineupEntry[];
  boats: Record<string, YardBoat>;
  initial: Choice;
  /** Another water was picked: load it, put it behind the panel, and say what starts and times it has. */
  onWater(id: string): Promise<WaterView>;
  /** The choice changed, or the step did: show it behind the panel. */
  onPreview(choice: Choice, step: number): void;
  onCastOff(choice: Choice): void;
}

const STEPS = ['Where', 'First sail', 'Your boat'];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const deg3 = (rad: number) => String(Math.round(((rad * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');

/**
 * The way in: where to sail, whether to take a first lesson, and which boat.
 * The water behind the panel is the real thing, so each choice shows straight away.
 */
export class JoinFlow {
  private readonly el = document.getElementById('join') as HTMLElement;
  private readonly choice: Choice;
  private step = 0;
  /** True once the player has typed their own boat name, so changing boats leaves it alone. */
  private named: boolean;
  /** The water showing. Starts as the one the page opened on. */
  private water: WaterView;
  /** A water being fetched: its id, until it is on the stage. */
  private loading: string | null = null;

  constructor(private readonly opts: JoinOptions) {
    this.water = opts;
    this.choice = { ...opts.initial };
    this.named = this.choice.name !== '' && this.choice.name !== this.defaultName(this.choice.boat);
    if (!this.choice.name) this.choice.name = this.defaultName(this.choice.boat);
    this.el.hidden = false;
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('input', this.onInput);
    window.addEventListener('keydown', this.onKey);
    this.render();
    opts.onPreview(this.choice, this.step);
  }

  private defaultName(boat: string): string {
    return this.opts.boats[boat]?.defaultName ?? 'Slack Tide';
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    this.go(1);
  };

  private onInput = (e: Event): void => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'join-skipper') {
      this.choice.skipper = t.value.slice(0, 16);
      return;
    }
    if (t.id !== 'join-boat-name') return;
    this.choice.name = t.value.slice(0, 18);
    this.named = true;
    this.opts.onPreview(this.choice, this.step);
  };

  private onClick = (e: MouseEvent): void => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.act === 'next') return this.go(1);
    if (d.act === 'back') return this.go(-1);
    if (d.water) return void this.changeWater(d.water);
    if (d.step) { this.step = Number(d.step); }
    else if (d.spot) this.choice.spot = d.spot;
    else if (d.time) this.choice.time = d.time;
    else if (d.weather) this.choice.weather = d.weather as Weather;
    else if (d.tutorial) this.choice.tutorial = d.tutorial === '1';
    else if (d.boat) {
      this.choice.boat = d.boat;
      if (!this.named) this.choice.name = this.defaultName(d.boat);
    } else if (d.colour) this.choice.colour = d.colour;
    else return;
    // Show it first, so the conditions on the cards are for the time just picked.
    this.opts.onPreview(this.choice, this.step);
    this.render();
  };

  /** Swap the water: its starts, its times, the conditions on the cards and the scene behind the panel. */
  private async changeWater(id: string): Promise<void> {
    if (this.loading || id === this.choice.water) return;
    this.loading = id;
    this.render();
    try {
      const water = await this.opts.onWater(id);
      this.water = water;
      this.choice.water = id;
      // The time of day this water is best met at, and its first start.
      this.choice.time = (water.times.find((t) => t.default) ?? water.times.find((t) => t.id === 'afternoon') ?? water.times[0]).id;
      this.choice.spot = water.spots[0].id;
    } catch {
      // It could not be fetched: stay where we are.
    }
    this.loading = null;
    if (this.el.hidden) return;
    this.opts.onPreview(this.choice, this.step);
    this.render();
  }

  private go(by: number): void {
    if (this.loading) return;
    if (this.step + by >= STEPS.length) {
      this.close();
      this.opts.onCastOff({ ...this.choice, skipper: this.choice.skipper.trim(), name: this.choice.name.trim() || this.defaultName(this.choice.boat) });
      return;
    }
    this.step = Math.max(0, this.step + by);
    this.render();
    this.opts.onPreview(this.choice, this.step);
  }

  close(): void {
    this.el.hidden = true;
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('input', this.onInput);
    window.removeEventListener('keydown', this.onKey);
  }

  // ---- the three steps --------------------------------------------------------------------------

  private where(): string {
    const w = this.water.world;
    const waters = this.opts.waters.length < 2 ? '' : `<div class="when waters" role="group" aria-label="Water to sail">${this.opts.waters.map((c) => {
      const on = c.id === (this.loading ?? this.choice.water);
      return `<button type="button" class="chip" data-water="${c.id}" aria-pressed="${on}" title="${esc(c.say)}"><b>${esc(c.name)}</b>${esc(this.loading === c.id ? 'Fetching the chart' : c.where)}</button>`;
    }).join('')}</div>`;
    const cards = this.water.spots.map((s) => {
      const wind = w.wind(s.x, s.y, 0);
      const c = w.current(s.x, s.y, 0);
      const drift = Math.hypot(c.x, c.y) / KT;
      const stream = drift < 0.15 ? 'slack water' : `${drift.toFixed(1)} kt of stream setting ${deg3(Math.atan2(c.x, c.y))}°`;
      return `<button type="button" class="card" data-spot="${s.id}" aria-pressed="${s.id === this.choice.spot}">
        <b>${esc(s.name)}</b><span class="sub">${esc(s.where)}</span>
        <span class="say">${esc(s.teaches)}</span>
        <span class="now">${(wind.speed / KT).toFixed(0)} kt from ${deg3(wind.dir)}° · ${stream}</span></button>`;
    }).join('');
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: w.course.timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
    const start = Date.parse(w.course.season.start);
    const when = this.water.times.map((t) =>
      `<button type="button" class="chip" data-time="${t.id}" aria-pressed="${t.id === this.choice.time}" title="${esc(t.say)}"><b>${clock.format(new Date(start + t.hours * 3600000))}</b>${esc(t.name)}</button>`).join('');
    const picked = this.water.times.find((t) => t.id === this.choice.time);
    const level = WEATHER.find((k) => k.id === (this.choice.weather ?? 'normal')) ?? WEATHER[1];
    const weather = WEATHER.map((k) =>
      `<button type="button" class="chip" data-weather="${k.id}" aria-pressed="${k.id === level.id}" title="${esc(k.say)}">${esc(k.name)}</button>`).join('');
    // A race fixed for later today: tell everyone on the way in where to start from.
    const event = alone() ? null : nextEvent(this.choice.water);
    const from = event && this.water.spots.find((sp) => sp.id === event.spot);
    const cls = event?.cls ? this.opts.boats[event.cls] : undefined;
    const race = event
      ? `<p class="racenight"><b>${esc(event.name)}</b> The gun goes at ${esc(whenText(event))}, ${esc(inText(event))}. ${from ? `To race, start from <b>${esc(from.name)}</b>. ` : ''}${cls ? `Everyone races the ${esc(cls.name)}: you are given one for the race, whatever boat you choose here. ` : ''}Once you are sailing, press R: the race opens for joining 25 minutes before the gun, and joining tows you to the start.</p>`
      : '';
    return `${race}<h2>Where do you want to sail?</h2>
      ${waters}
      <div class="when" role="group" aria-label="Time to cast off">${when}</div>
      <p class="soon">${esc(picked?.say ?? '')}. The wind and tide then follow the real day.</p>
      <div class="when weather" role="group" aria-label="How hard it blows"><span class="k">Wind</span>${weather}</div>
      <p class="soon">${esc(level.say)}.</p>
      <div class="cards">${cards}</div>
      <p class="soon">More waters are planned: the Farallones, San Francisco to San Diego, the Baja Ha-Ha, Hawaii and the BVI.</p>`;
  }

  private lesson(): string {
    const card = (on: boolean, title: string, text: string) =>
      `<button type="button" class="card" data-tutorial="${on ? 1 : 0}" aria-pressed="${this.choice.tutorial === on}"><b>${title}</b><span class="say">${text}</span></button>`;
    return `<h2>Want a quick lesson first?</h2><div class="cards">
      ${card(true, 'Show me the ropes', 'A short guided sail: steering, trimming both sails, a tack, the autopilot and the chart. About five minutes. End it whenever you like.')}
      ${card(false, 'I know my way round a boat', 'Straight to sailing. You work her by pointing at the wheel, the boom and the winches and scrolling. The boat shows you what she needs.')}
    </div>`;
  }

  private boat(): string {
    const ready = this.opts.lineup.filter((e) => e.status === 'ready' && this.opts.boats[e.id]);
    const yard = this.opts.lineup.filter((e) => !ready.includes(e));
    const cards = ready.map((e) => {
      const spec = this.opts.boats[e.id];
      const d = spec.dimensions;
      const reach = polarSpeed(spec.polar, 100, 14);
      return `<button type="button" class="card" data-boat="${e.id}" aria-pressed="${e.id === this.choice.boat}">
        <b>${esc(spec.name)}</b><span class="say">${esc(spec.tagline ?? spec.role ?? '')}</span>
        <span class="now">${d.loa.toFixed(1)} m overall · draws ${d.draft.toFixed(1)} m · ${reach.toFixed(1)} kt reaching in 14 kt</span></button>`;
    }).join('');
    const coming = yard.length ? `<p class="soon">Still in the yard: ${yard.map((e) => esc(e.name ?? e.id)).join(' and ')}.</p>` : '';
    const swatches = TOPSIDES.map((c) =>
      `<button type="button" class="swatch" data-colour="${c.hex}" aria-pressed="${c.hex === this.choice.colour}" aria-label="${c.name} topsides" title="${c.name}" style="background:${c.hex}"></button>`).join('');
    return `<h2>Choose your boat</h2><div class="cards">${cards}</div>${coming}
      <div class="fit">
        <label for="join-skipper">Skipper</label>
        <input id="join-skipper" type="text" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="What the fleet calls you" value="${esc(this.choice.skipper)}">
        <label for="join-boat-name">Name on the transom</label>
        <input id="join-boat-name" type="text" maxlength="18" autocomplete="off" spellcheck="false" value="${esc(this.choice.name)}">
        <span class="lab">Topsides</span><div class="swatches">${swatches}</div>
      </div>`;
  }

  private render(): void {
    const last = this.step === STEPS.length - 1;
    const body = this.step === 0 ? this.where() : this.step === 1 ? this.lesson() : this.boat();
    const start = this.water.world.dateAt(0);
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: this.water.world.course.timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(start);
    this.el.innerHTML = `
      <header><h1>Regatta</h1><p>${esc(this.water.about.name)}, as the wind and tide really were on ${day}</p></header>
      <ol class="join-steps">${STEPS.map((s, i) => `<li><button type="button" data-step="${i}" aria-current="${i === this.step ? 'step' : 'false'}"><i>${i + 1}</i>${s}</button></li>`).join('')}</ol>
      <div class="join-body">${body}</div>
      ${onWeb() ? '<p class="soon">Anyone else sailing here now shares the water with you: you see their boats, hear their hails and can race them. To vote on the roadmap, send feedback or keep your logbook on any device, sign in with your email address: press B and choose Logbook.</p>'
        : alone() ? '<p class="soon">This copy of the game is on its own, so you sail single-handed. Sailing in company, votes, sending feedback and the shared logbook are on the website and on the shared page.</p>' : ''}
      <footer>${this.step > 0 ? '<button type="button" data-act="back">Back</button>' : '<span></span>'}
        <button type="button" class="primary" data-act="next">${last ? 'Cast off' : 'Next'}</button></footer>`;
  }
}
