import { KT, R2D, polarSpeed } from '@slack-tide/sim';
import type { Waypoint } from '@slack-tide/nav';
import type { ReplayWorld } from '@slack-tide/world';
import { TOPSIDES, type LineupEntry, type YardBoat } from '../boat/yard';

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
}

/** What the player picked on the way in. */
export interface Choice {
  spot: string;
  time: string;
  boat: string;
  colour: string;
  name: string;
  /** What the skipper is called, shown to the rest of the fleet. */
  skipper: string;
  tutorial: boolean;
}

export interface JoinOptions {
  spots: StartSpot[];
  times: StartTime[];
  lineup: LineupEntry[];
  boats: Record<string, YardBoat>;
  world: ReplayWorld;
  initial: Choice;
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

  constructor(private readonly opts: JoinOptions) {
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
    if (d.step) { this.step = Number(d.step); }
    else if (d.spot) this.choice.spot = d.spot;
    else if (d.time) this.choice.time = d.time;
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

  private go(by: number): void {
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
    const w = this.opts.world;
    const cards = this.opts.spots.map((s) => {
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
    const when = this.opts.times.map((t) =>
      `<button type="button" class="chip" data-time="${t.id}" aria-pressed="${t.id === this.choice.time}" title="${esc(t.say)}"><b>${clock.format(new Date(start + t.hours * 3600000))}</b>${esc(t.name)}</button>`).join('');
    const picked = this.opts.times.find((t) => t.id === this.choice.time);
    return `<h2>Where do you want to sail?</h2>
      <div class="when" role="group" aria-label="Time to cast off">${when}</div>
      <p class="soon">${esc(picked?.say ?? '')}. The wind and tide then follow the real day.</p>
      <div class="cards">${cards}</div>
      <p class="soon">More waters are planned: the Farallones, San Francisco to San Diego, the Baja Ha-Ha, Hawaii, the San Juans and the BVI.</p>`;
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
    const start = this.opts.world.dateAt(0);
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: this.opts.world.course.timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(start);
    this.el.innerHTML = `
      <header><h1>Regatta</h1><p>San Francisco Bay, as the wind and tide really were on ${day}</p></header>
      <ol class="join-steps">${STEPS.map((s, i) => `<li><button type="button" data-step="${i}" aria-current="${i === this.step ? 'step' : 'false'}"><i>${i + 1}</i>${s}</button></li>`).join('')}</ol>
      <div class="join-body">${body}</div>
      <footer>${this.step > 0 ? '<button type="button" data-act="back">Back</button>' : '<span></span>'}
        <button type="button" class="primary" data-act="next">${last ? 'Cast off' : 'Next'}</button></footer>`;
  }
}
