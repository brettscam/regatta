import type { DerbyDesk } from '../aboard/derbyDesk';
import { onWeb } from '../net/platform';
import { ORDINAL } from '../race/race';
import type { Prospect, Tackle } from '../fishing/bites';
import { FORMATS, LENGTHS, derbyLink, formatWords, stageOf, targetOf, type DerbyCall, type Format } from '../fishing/derby';
import { fishWords, poundWords, type Creel } from '../fishing/points';
import { LURES, RIGS, type FishTable, type LureId, type RigId } from '../fishing/table';
import type { Trip } from '../fishing/trip';
import './fishStyle';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** What the card shows and changes. The fishing feature is one. */
export interface FishCardModel {
  table: FishTable;
  water: string;
  desk: DerbyDesk;
  tackle(): Tackle;
  setLure(id: LureId): void;
  setRig(id: RigId): void;
  /** What the line is doing and what is under her, now. */
  now(): { out: boolean; advice: string; sounder: string; biting: Prospect[] };
  trip(): Trip;
  creel(): Creel;
  /** True while other people's boats are on this water. */
  company(): boolean;
}

/**
 * The fishing card (Shift+L): what is biting here and why, the tackle, the day's catch, and tournaments.
 * Choosing tackle and running a tournament are not sailing, so this is a card with buttons. Nothing on it steers,
 * trims, or works the reel.
 */
export class FishCard {
  private readonly el = document.createElement('div');
  private fmt: Format = 'points';
  private len = 40;
  private inMin = 2;
  private rivals: number | null = null;
  private sp = '';
  private when: 'now' | 'later' = 'now';
  private later = 0;
  private note = '';
  private parts: HTMLElement[] | null = null;
  private readonly shown = ['', '', '', ''];
  private tick = 0;

  constructor(private readonly m: FishCardModel) {
    this.el.className = 'fleetpanel fishcard';
    this.el.id = 'fishcard';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Fishing');
    document.body.appendChild(this.el);
    this.sp = m.table.species.find((s) => s.id === 'calico')?.id ?? m.table.species[0]?.id ?? '';
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.toggle(false);
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.isOpen): void {
    this.el.hidden = !open;
    if (open) this.render();
  }

  private rivalsNow(): number {
    return this.rivals ?? (this.m.company() ? 3 : 5);
  }

  private onClick = (e: MouseEvent): void => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const d = b.dataset;
    const desk = this.m.desk;
    if (d.act === 'close') return this.toggle(false);
    if (d.lure) this.m.setLure(d.lure as LureId);
    else if (d.rig) this.m.setRig(d.rig as RigId);
    else if (d.fmt) this.fmt = (FORMATS.find((f) => f.id === d.fmt)?.id ?? 'points');
    else if (d.len) this.len = Number(d.len);
    else if (d.inmin) this.inMin = Number(d.inmin);
    else if (d.rivals) this.rivals = Number(d.rivals);
    else if (d.sp) this.sp = d.sp;
    else if (d.when) { this.when = d.when === 'later' ? 'later' : 'now'; this.note = ''; }
    else if (d.later) this.later = Number(d.later);
    else if (d.join) desk.join(d.join);
    else if (d.act === 'leave') desk.leave();
    else if (d.act === 'call') desk.callNow(this.fmt, this.len, this.inMin, this.rivalsNow(), this.sp);
    else if (d.act === 'fix') {
      const at = Date.now() + this.later * 60e3;
      const call = desk.fix(this.fmt, this.len, Math.ceil(at / 300e3) * 300e3, this.rivalsNow(), this.sp);
      this.note = `Fixed: lines in at ${new Date(call.at!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. It opens for joining 25 minutes before.`;
    } else if (d.act === 'copy') void this.copy();
    this.render();
  };

  private async copy(): Promise<void> {
    const call = this.m.desk.fixed;
    if (!call) return;
    try {
      await navigator.clipboard.writeText(derbyLink(call, `${location.origin}${location.pathname}`));
      this.note = 'Link copied. Send it to whoever is fishing.';
    } catch {
      this.note = 'Copying is blocked here. Select the link and copy it by hand.';
    }
    this.render();
  }

  /** Once a frame. The card redraws once a second while it is open. */
  update(dt: number): void {
    if (!this.isOpen) return;
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 1;
    this.render();
  }

  // ---- the parts ------------------------------------------------------------------------------------

  private here(): string {
    const n = this.m.now();
    const t = this.m.tackle();
    const top = n.biting.slice(0, 4);
    const rows = top.map((p) => `<li><b>${esc(p.species.name)}</b><span>${esc(p.species.limit)}</span><i style="--k:${Math.min(1, p.keen / 0.5).toFixed(2)}"></i></li>`).join('');
    const hint = top[0] ? `<p class="lede">${esc(top[0].species.hint)}</p>` : '';
    const trip = this.m.trip();
    const creel = this.m.creel();
    const last = trip.landed.slice(-5).reverse().map((l) => `<tr><td>${esc(fishWords(l.name, l.cm, l.kg))}</td><td>${l.fate === 'kept' ? 'kept' : l.fate === 'short' ? 'short' : l.fate === 'poached' ? 'kept: penalty' : 'let go'}</td><td>${l.points}</td></tr>`).join('');
    return `<h3>Here and now</h3>
      <p class="lede"><b>${esc(n.out ? n.advice : `Line in. ${n.advice}`)}</b></p>
      <p class="lede">Sounder: ${esc(n.sounder)}</p>
      ${rows ? `<ul class="biting">${rows}</ul>` : ''}${hint}
      <h3>Today · ${trip.landed.length} fish · ${trip.points} points</h3>
      ${last ? `<table><tbody>${last}</tbody></table>` : '<p class="lede">Nothing landed yet. L puts a line over.</p>'}
      <p class="lede">All time: ${creel.fish} fish, ${creel.points.toLocaleString('en-GB')} points. Species and personal bests are on the board (B), Logbook tab. Live bait aboard: <b>${t.bait}</b>.</p>`;
  }

  private tackle(): string {
    const t = this.m.tackle();
    const lure = LURES.find((l) => l.id === t.lure);
    const rig = RIGS.find((r) => r.id === t.rig);
    return `<h3>Tackle</h3>
      <div class="chips"><span>Under way</span>${LURES.map((l) => `<button type="button" data-lure="${l.id}" aria-pressed="${l.id === t.lure}">${esc(l.name)}</button>`).join('')}</div>
      <p class="lede">${esc(lure?.say ?? '')}</p>
      <div class="chips"><span>Stopped</span>${RIGS.map((r) => `<button type="button" data-rig="${r.id}" aria-pressed="${r.id === t.rig}">${esc(r.name)}</button>`).join('')}</div>
      <p class="lede">${esc(rig?.say ?? '')}${t.rig === 'bait' && t.bait <= 0 ? ' <b>The tank is empty</b>: stop at the bait barge for a scoop. Until then this rod fishes the iron.' : ''}</p>
      <p class="lede">L puts the line out and brings it in. Making way it tows the lure; stopped it fishes the other rig, and casts it when birds or a kelp paddy are within reach. When a fish is on, hold L to wind while it rests and let go while it runs.</p>`;
  }

  private leaderboard(call: DerbyCall): string {
    const table = this.m.desk.board(call);
    const rows = table.map((r) => {
      const score = r.score <= 0 ? '—' : r.unit === 'kg' ? poundWords(r.score) : `${r.score}`;
      const best = r.best ? fishWords(r.best.name, r.best.cm, r.best.kg) : '';
      return `<tr class="${r.me ? 'me' : ''}"><td>${r.place}</td><td>${esc(r.name)}${r.rival ? ' <i>club</i>' : ''}</td><td>${esc(r.boat)}</td><td>${esc(best)}</td><td>${r.fish.length}</td><td>${score}</td></tr>`;
    }).join('');
    const unit = table[0]?.unit === 'kg' ? 'Weight' : 'Points';
    return `<table><thead><tr><th></th><th>Skipper</th><th>Boat</th><th>Best fish</th><th>Fish</th><th>${unit}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  private derby(): { live: string; form: string } {
    const desk = this.m.desk;
    const table = this.m.table;
    const call = desk.call;
    if (call) {
      const e = desk.elapsed(call);
      const stage = stageOf(call, e);
      const fmt = FORMATS.find((f) => f.id === call.fmt);
      const head = stage === 'before'
        ? `<p class="count">${clock(-e)}</p><p class="lede">to lines in. Get to your water: nothing landed before then counts.</p>`
        : stage === 'fishing'
          ? `<p class="count">${clock(call.len * 60 - e)}</p><p class="lede">to lines out. A fish counts when it is landed, so one still on the line at the end does not.</p>`
          : `<p class="count">Weigh-in</p><p class="lede">${desk.result ? `You placed <b>${ORDINAL[desk.result.place - 1] ?? desk.result.place} of ${desk.result.field}</b>${desk.result.xp ? `, worth ${desk.result.xp} experience` : ''}.` : 'The last fish are coming to the scale.'}</p>`;
      return {
        live: `<h3>${esc(call.name)} · ${esc(formatWords(call, table))}</h3>${head}<p class="lede">${esc(fmt?.say ?? '')}</p>${this.leaderboard(call)}`,
        form: `<button type="button" data-act="leave">${stage === 'over' ? 'Done' : 'Leave the tournament'}</button>
          <p class="lede">Each boat lands her own fish and tells the others, so a tournament between friends runs on trust, like a race's finish times. What comes from another boat is checked for being possible (the species, the size, the limit, the time), not for being true. Club skippers' catches are the same on every boat.</p>`,
      };
    }
    const offers = [...desk.offers.values()].map((o) => {
      const e = desk.elapsed(o);
      return `<div class="offer"><p><b>${esc(o.host)}</b>: <b>${esc(formatWords(o, table))}</b>. ${e < 0 ? `Lines in in ${clock(-e)}` : `Lines are in, ${clock(o.len * 60 - e)} left`}.</p><button type="button" class="primary" data-join="${esc(o.id)}">Join</button></div>`;
    }).join('');
    const fixed = desk.fixed;
    const fixedPart = fixed && !desk.offers.has(fixed.id)
      ? `<div class="offer fixed"><p><b>${esc(fixed.name)}</b>: ${esc(formatWords(fixed, table))}. Lines in at <b>${esc(new Date(fixed.at ?? 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</b> on your clock. It opens for joining 25 minutes before.</p></div>`
      : '';
    const link = fixed
      ? (onWeb()
        ? `<div class="invite"><input type="text" readonly aria-label="Link to this tournament" value="${esc(derbyLink(fixed, `${location.origin}${location.pathname}`))}"><button type="button" class="primary" data-act="copy">Copy link</button></div>`
        : '<p class="lede">Everyone on the water with you is told. A link to send only works on bajaregatta.com.</p>')
      : '';
    const chips = (label: string, key: string, values: number[], now: number, unit: string) => `<div class="chips"><span>${label}</span>${values.map((v) => `<button type="button" data-${key}="${v}" aria-pressed="${v === now}">${v}${unit}</button>`).join('')}</div>`;
    const f = FORMATS.find((x) => x.id === this.fmt)!;
    const target = targetOf({ fmt: this.fmt, sp: this.sp }, table);
    const species = this.fmt === 'species'
      ? `<div class="chips"><span>Species</span>${table.rivals.slice(0, 8).map((r) => table.species.find((s) => s.id === r.id)).filter((s) => !!s).map((s) => `<button type="button" data-sp="${esc(s!.id)}" aria-pressed="${s!.id === this.sp}">${esc(s!.name)}</button>`).join('')}</div>`
      : '';
    const whenPart = this.when === 'now'
      ? chips('Lines in', 'inmin', [2, 5, 10], this.inMin, ' min')
      : `<div class="chips"><span>Lines in</span>${[30, 60, 120].map((v) => `<button type="button" data-later="${v}" aria-pressed="${this.later === v}">in ${v < 60 ? `${v} min` : `${v / 60} h`}</button>`).join('')}</div>`;
    const action = this.when === 'now'
      ? `<button type="button" class="primary go" data-act="call">Call it: lines in in ${this.inMin} min</button>`
      : `<button type="button" class="primary go" data-act="fix" ${this.later ? '' : 'aria-disabled="true"'}>${this.later ? 'Fix it and get the link' : 'Pick a time'}</button>`;
    return {
      live: `<h3>Tournaments</h3>${offers}${fixedPart}${link}${offers || fixedPart ? '' : '<p class="lede">None on just now. Call one below: the club\'s skippers will fish it with you, and so can anyone on this water.</p>'}`,
      form: `<div class="chips">${FORMATS.map((x) => `<button type="button" data-fmt="${x.id}" aria-pressed="${x.id === this.fmt}">${esc(x.name)}</button>`).join('')}</div>
        <p class="lede">${esc(f.say)}${this.fmt === 'jackpot' && target ? ` Here that is the <b>${esc(target.name)}</b>.` : ''}</p>
        ${species}
        ${chips('Length', 'len', LENGTHS, this.len, ' min')}
        <div class="chips seg"><span>When</span><button type="button" data-when="now" aria-pressed="${this.when === 'now'}">Now</button><button type="button" data-when="later" aria-pressed="${this.when === 'later'}">Later, on the real clock</button></div>
        ${whenPart}
        ${chips('Club skippers', 'rivals', [0, 3, 5, 6], this.rivalsNow(), '')}
        <div class="go-bar">${action}</div>
        ${this.note ? `<p class="lede note">${esc(this.note)}</p>` : ''}
        <p class="lede">${this.when === 'now' ? 'The length is minutes of the game\'s clock, which every boat on this water shares.' : 'A tournament fixed for later runs on the real clock, so everyone starts and stops together wherever their own day has got to.'}</p>`,
    };
  }

  private render(): void {
    if (!this.parts) {
      this.el.innerHTML = '<header><h2>Fishing</h2><button type="button" data-act="close" aria-label="Close">Close</button></header><div class="fleet-body"><div class="part"></div><div class="part"></div><div class="part"></div><div class="part"></div></div>';
      this.parts = [...this.el.querySelectorAll<HTMLElement>('.part')];
    }
    const d = this.derby();
    // In a tournament the clock and the leaderboard come first. Otherwise what is biting, then the tackle.
    const html = this.m.desk.call ? [d.live, this.here(), this.tackle(), d.form] : [this.here(), this.tackle(), d.live, d.form];
    html.forEach((h, i) => {
      if (this.shown[i] === h) return;
      this.shown[i] = h;
      this.parts![i].innerHTML = h;
    });
  }

  dispose(): void {
    this.el.remove();
  }
}
