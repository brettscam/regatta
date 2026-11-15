import type { BoardingResult } from './boarding';
import type { PortPlace } from './caribbean';
import { riches, type Career } from './career';
import type { PirateGame } from './game';
import { COSTS, holdTons } from './loot';
import { ARTIFACTS, GOODS, PLAYER_LIMITS, type Nation } from './tables';

// The pirate game's panels: the state of the sloop and what the glass shows, the port sheet, the cabinet, the
// boarding read-out and the cards at either end. Plain DOM in the manner of the join screen.
// A port sheet is business ashore, so it has buttons. Nothing here is a sailing action.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const NATION: Record<Nation, string> = { english: 'English', spanish: 'Spanish', french: 'French', dutch: 'Dutch', pirate: 'No flag but its own' };
const bar = (share: number, cls = '') => `<i class="bar ${cls}"><i style="width:${Math.round(Math.max(0, Math.min(1, share)) * 100)}%"></i></i>`;

export interface PanelReading {
  hull: number;
  rigging: number;
  crew: number;
  guns: number;
  served: number;
  reload: { port: number; starboard: number };
  /** Whether each broadside bears on something now. */
  bears: { port: boolean; starboard: boolean };
  /** What heel is doing to each battery: its share of chance left. */
  heel: { port: number; starboard: number };
  hold: number;
  holdMax: number;
  coin: number;
  banked: number;
  notoriety: number;
  /** The spyglass: what is known of the ship the glass is on. */
  glass: { title: string; line: string; hull?: number; rigging?: number; crew?: string; mood?: string; odds?: string } | null;
  chasing: boolean;
}

/** The sloop's state, bottom left, and the spyglass beside it. Hidden with the instruments. */
export class ShipPanel {
  private readonly el = document.createElement('div');
  private readonly glass = document.createElement('div');
  private last = '';
  private lastGlass = '';

  constructor() {
    this.el.className = 'hud rover';
    this.glass.className = 'hud glass';
    document.body.append(this.el, this.glass);
  }

  setHidden(hidden: boolean): void {
    this.el.hidden = hidden;
    this.glass.hidden = hidden || this.lastGlass === '';
  }

  update(r: PanelReading): void {
    const side = (name: 'port' | 'starboard', key: string, label: string) => {
      const t = r.reload[name];
      const state = r.served <= 0 ? 'no hands' : t > 0 ? `loading ${Math.ceil(t)}s` : r.bears[name] ? 'BEARS' : 'ready';
      const cls = r.served <= 0 ? 'off' : t > 0 ? 'wait' : r.bears[name] ? 'hot' : '';
      const lay = r.heel[name] < 0.95 ? ` · ${r.heel[name] <= 0.05 ? 'muzzles in the sea' : `heel ${Math.round(r.heel[name] * 100)}%`}` : '';
      return `<div class="battery ${cls}"><kbd>${key}</kbd><span>${label}</span><b>${state}${lay}</b></div>`;
    };
    const html = `
      <div class="row"><span>Hull</span>${bar(r.hull / 100, r.hull < 35 ? 'low' : '')}<b>${Math.round(r.hull)}</b></div>
      <div class="row"><span>Rigging</span>${bar(r.rigging / 100, r.rigging < 40 ? 'low' : '')}<b>${Math.round(r.rigging)}</b></div>
      <div class="row"><span>Men</span>${bar(r.crew / PLAYER_LIMITS.crew)}<b>${r.crew}</b></div>
      ${side('port', 'Z', `Larboard ${r.served}/${Math.floor(r.guns / 2)}`)}
      ${side('starboard', 'C', `Starboard ${r.served}/${Math.floor(r.guns / 2)}`)}
      <div class="purse"><span>Hold <b>${r.hold}/${r.holdMax} t</b></span><span>Aboard <b>${Math.round(r.coin)}</b></span><span>Ashore <b>${Math.round(r.banked)}</b></span><span>Name <b>${Math.round(r.notoriety)}</b></span></div>`;
    if (html !== this.last) {
      this.el.innerHTML = html;
      this.last = html;
    }
    const g = r.glass;
    const gh = g ? `<h4>${esc(g.title)}${r.chasing ? ' <em>· in chase</em>' : ''}</h4><p>${esc(g.line)}</p>
      ${g.hull !== undefined ? `<div class="row"><span>Hull</span>${bar(g.hull)}</div><div class="row"><span>Rigging</span>${bar(g.rigging ?? 1)}</div>` : ''}
      ${g.crew ? `<p class="k">${esc(g.crew)}${g.odds ? ` · ${esc(g.odds)}` : ''}</p>` : ''}${g.mood ? `<p class="k">${esc(g.mood)}</p>` : ''}` : '';
    if (gh !== this.lastGlass) {
      this.glass.innerHTML = gh;
      this.lastGlass = gh;
      this.glass.hidden = gh === '' || this.el.hidden;
    }
  }

  dispose(): void {
    this.el.remove();
    this.glass.remove();
  }
}

/** A card in the middle of the screen, built from the join screen's panel. */
class Card {
  protected readonly el = document.createElement('section');
  constructor(cls: string, label: string) {
    this.el.className = `join endcard ${cls}`;
    this.el.setAttribute('aria-label', label);
    document.body.appendChild(this.el);
  }
  close(): void {
    this.el.remove();
  }
  get isOpen(): boolean {
    return this.el.isConnected;
  }
}

/** The port sheet: sell, repair, sign on men, buy guns, hear the talk. */
export class PortSheet extends Card {
  private note = '';

  constructor(private readonly game: PirateGame, private readonly port: PortPlace, private readonly t: () => number, private readonly opts: { onLeave(): void; onCabinet(): void; onRetire(): void }) {
    super('sheet', `In port at ${port.name}`);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || b.disabled) return;
      this.act(b.dataset.act ?? '', b.dataset.arg ?? '');
    });
    this.render();
  }

  private act(act: string, arg: string): void {
    const { game, port } = this;
    const t = this.t();
    if (act === 'leave') { this.close(); return this.opts.onLeave(); }
    if (act === 'cabinet') return this.opts.onCabinet();
    if (act === 'retire') { this.close(); return this.opts.onRetire(); }
    if (act === 'sell') this.note = `Sold for ${game.sell(arg, port, t)}.`;
    else if (act === 'sell-all') {
      let got = 0;
      for (const good of Object.keys(game.own.hold)) got += game.sell(good, port, t);
      this.note = `The whole hold fetched ${got}.`;
    } else if (act === 'repair') this.note = `The yard was paid ${game.repair(port)}.`;
    else if (act === 'recruit') this.note = `${game.recruit(port, t, Number(arg))} men signed the articles.`;
    else if (act === 'guns') this.note = game.buyGuns(port) ? 'A pair of four-pounders swayed aboard.' : 'No guns to be had.';
    else if (act === 'rumour') this.note = game.hearRumour(t)?.text ?? 'Nobody is talking.';
    else if (act === 'pardon') this.note = game.buyPardon(port) ? 'The governor has forgotten a little.' : 'He will not see you.';
    this.render();
  }

  private render(): void {
    const { game, port } = this;
    const t = this.t();
    const own = game.own;
    const c = game.career;
    const goods = Object.entries(own.hold).filter(([, tons]) => tons > 0);
    const rows = goods.map(([good, tons]) => {
      const each = game.priceOf(good, port, t);
      const plain = GOODS.find((g) => g.id === good)!;
      const mark = each > plain.price * 1.08 ? 'dear here' : each < plain.price * 0.92 ? 'cheap here' : '';
      return `<tr><td>${plain.name}</td><td>${tons} t</td><td>${each} a ton <small>${mark}</small></td><td><button type="button" data-act="sell" data-arg="${good}">Sell for ${tons * each}</button></td></tr>`;
    }).join('');
    const bill = game.repairBill(port);
    const men = game.menToHire(port, t);
    const afford = Math.min(men, Math.floor(c.banked / COSTS.man));
    this.el.innerHTML = `
      <header><h1>${esc(port.name)}</h1><p>${esc(NATION[port.nation])}. ${esc(port.say)}</p></header>
      <div class="join-body">
        <dl class="tally">
          <dt>Ashore</dt><dd>${Math.round(c.banked)} coin <small>what she brought in is banked here</small></dd>
          <dt>The sloop</dt><dd>hull ${Math.round(own.hull)}, rigging ${Math.round(own.rigging)}, ${own.crew} men, ${own.guns} guns</dd>
        </dl>
        <h2>Cargo</h2>
        ${goods.length ? `<table class="ledger">${rows}</table><button type="button" data-act="sell-all">Sell the whole hold</button>` : '<p class="soon">The hold is empty.</p>'}
        <h2>The yard and the taverns</h2>
        <div class="trade">
          <button type="button" data-act="repair" ${port.repair <= 0 || bill <= 0 || c.banked <= 0 ? 'disabled' : ''}>${port.repair <= 0 ? 'No yard here' : bill <= 0 ? 'She needs no repair' : `Repair her: ${bill}${bill > c.banked ? ' (as far as the purse goes)' : ''}`}</button>
          <button type="button" data-act="recruit" data-arg="${afford}" ${afford <= 0 ? 'disabled' : ''}>${port.recruits <= 0 ? 'No men will sign here' : men <= 0 ? (own.crew >= PLAYER_LIMITS.crew ? 'She has all the men she can berth' : 'No more men this week') : `Sign on ${afford} of ${men} men: ${afford * COSTS.man}`}</button>
          <button type="button" data-act="guns" ${game.canBuyGuns(port) ? '' : 'disabled'}>${!port.gunsForSale ? 'No guns sold here' : own.guns >= PLAYER_LIMITS.guns ? 'Every port has its gun' : `A pair of guns: ${COSTS.gunPair}`}</button>
          <button type="button" data-act="rumour" ${c.banked < COSTS.rumour ? 'disabled' : ''}>Stand a round and listen: ${COSTS.rumour}</button>
          ${port.pardon > 0 ? `<button type="button" data-act="pardon" ${c.banked < port.pardon || c.notoriety <= 0 ? 'disabled' : ''}>A present for the governor: ${port.pardon}</button>` : ''}
        </div>
        ${this.note ? `<p class="brief note">${esc(this.note)}</p>` : ''}
        <p class="soon">Her name stands at ${Math.round(c.notoriety)} of 100. ${port.shutAt === null ? 'Nobody here will ever ask.' : `This port shuts its gates to her at ${port.shutAt}.`}</p>
      </div>
      <footer><button type="button" data-act="retire">Retire ashore</button><button type="button" data-act="cabinet">The cabinet</button><button type="button" class="primary" data-act="leave">Put to sea</button></footer>`;
  }
}

/** The cabinet: every artifact there is, found or not. */
export class Cabinet extends Card {
  constructor(career: Career, onClose: () => void) {
    super('cabinet', 'The cabinet');
    const cells = ARTIFACTS.map((a) => {
      const have = career.artifacts.includes(a.id);
      return `<li class="${have ? 'have' : 'want'}"><b>${have ? esc(a.name) : 'Not yet found'}</b><span>${have ? esc(a.line) : '&nbsp;'}</span>${have ? `<i>${a.worth}</i>` : ''}</li>`;
    }).join('');
    this.el.innerHTML = `
      <header><h1>The cabinet</h1><p>${career.artifacts.length} of ${ARTIFACTS.length} found. Kept ashore: they are not lost with the sloop.</p></header>
      <div class="join-body"><ul class="curios">${cells}</ul></div>
      <footer><span></span><button type="button" class="primary" data-act="close">Close</button></footer>`;
    this.el.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button')) return;
      this.close();
      onClose();
    });
  }
}

/** A boarding, told a line at a time. */
export class BoardingRead {
  private readonly el = document.createElement('div');
  private shown = 0;
  private clock = 0;

  constructor(private readonly result: BoardingResult, private readonly mine: boolean, who: string, odds: number, private readonly onDone: () => void) {
    this.el.className = 'hud boarding';
    this.el.innerHTML = `<h4>${mine ? `Boarders away: the ${esc(who)}` : `The ${esc(who)} is boarding us`}</h4><p class="k">${mine ? 'Our' : 'Their'} chance, by the numbers: ${Math.round(odds * 100)} in 100</p><ol></ol>`;
    document.body.appendChild(this.el);
  }

  /** @param dt real seconds. Returns false when it is over and gone. */
  update(dt: number): boolean {
    this.clock -= dt;
    if (this.clock > 0) return true;
    if (this.shown >= this.result.rounds.length) {
      this.el.remove();
      this.onDone();
      return false;
    }
    const r = this.result.rounds[this.shown++];
    const last = this.shown === this.result.rounds.length;
    const ours = this.mine ? r.attackers : r.defenders;
    const theirs = this.mine ? r.defenders : r.attackers;
    const li = document.createElement('li');
    li.className = last ? (this.result.won === this.mine ? 'won' : 'lost') : '';
    li.innerHTML = `<span>${esc(r.line)}</span><b>${ours} of ours · ${theirs} of theirs</b>`;
    this.el.querySelector('ol')!.appendChild(li);
    this.clock = last ? 3.2 : 1.15;
    return true;
  }

  dispose(): void {
    this.el.remove();
  }
}

export interface CruiseEnd {
  why: 'sunk' | 'taken' | 'wrecked' | 'retired';
  days: number;
  prizes: number;
  coin: number;
  artifacts: string[];
  sunk: number;
  career: Career;
  date: Date;
}

const ENDS: Record<CruiseEnd['why'], [string, string]> = {
  sunk: ['Sunk', 'She went down with her colours flying. Those who could swim were picked up, and hanged or pressed, as the fancy took their captors.'],
  taken: ['Taken', 'They carried her deck. The sloop is a prize of the Crown, and her people are in irons in the hold of the ship that took her.'],
  wrecked: ['Wrecked', 'The coral took the bottom out of her. Her people got ashore on a raft of spars with what they could carry, which was not the plunder.'],
  retired: ['Ashore', 'She was sold out of the service. Her captain bought a plantation under another name, and was never asked where the money came from.'],
};

/** The end of a cruise, tallied. */
export class CruiseCard extends Card {
  constructor(end: CruiseEnd, opts: { onAgain(): void; onLeave(): void; onCabinet(): void }) {
    super('', 'The end of the cruise');
    const [head, account] = ENDS[end.why];
    const lost = end.why !== 'retired';
    const found = end.artifacts.map((id) => ARTIFACTS.find((a) => a.id === id)?.name).filter(Boolean).join('; ');
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Etc/GMT+5', day: 'numeric', month: 'long', year: 'numeric' }).format(end.date);
    this.el.innerHTML = `
      <header><h1>${head}</h1><p>${date}, ${Math.max(1, Math.round(end.days))} ${Math.round(end.days) <= 1 ? 'day' : 'days'} out.</p></header>
      <div class="join-body">
        <dl class="tally">
          <dt>This cruise</dt><dd>${end.prizes} ${end.prizes === 1 ? 'prize' : 'prizes'} taken${end.sunk ? `, ${end.sunk} sunk` : ''}, ${Math.round(end.coin)} coin out of their cabins</dd>
          <dt>For the cabinet</dt><dd>${found ? esc(found) : 'Nothing this time'}</dd>
          <dt>Riches</dt><dd>${Math.round(riches(end.career))} <small>${Math.round(end.career.banked)} coin ashore, and ${end.career.artifacts.length} of ${ARTIFACTS.length} artifacts</small></dd>
          <dt>Her name</dt><dd>${Math.round(end.career.notoriety)} of 100 · ${end.career.prizes} ${end.career.prizes === 1 ? 'prize' : 'prizes'} and ${end.career.lost} ${end.career.lost === 1 ? 'sloop' : 'sloops'} lost in all</dd>
        </dl>
        <p class="brief">${esc(account)}</p>
        ${lost ? '<p class="soon">What she had aboard went with her. Half of what was banked ashore buys the next sloop and pays the dead men\'s shares. The cabinet is kept.</p>' : ''}
      </div>
      <footer><button type="button" data-act="leave">Leave it there</button><button type="button" data-act="cabinet">The cabinet</button><button type="button" class="primary" data-act="again">${lost ? 'Fit out another sloop' : 'Go to sea again'}</button></footer>`;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.act === 'cabinet') return opts.onCabinet();
      this.close();
      if (b.dataset.act === 'again') opts.onAgain();
      else opts.onLeave();
    });
  }
}

export { holdTons };
