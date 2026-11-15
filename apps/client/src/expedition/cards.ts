import type { VoyageResult } from './session';
import type { Voyage } from './voyage';

// The two cards of an expedition: the briefing before she sails and the plain account when it is over.
// The briefing uses the join screen's panel. Words here are in the voice of the record: no more than is known.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Briefing {
  private readonly el = document.getElementById('join') as HTMLElement;
  private chosen: Voyage;

  constructor(private readonly opts: { voyages: Voyage[]; onBack(): void; onCastOff(voyage: Voyage): void }) {
    this.chosen = opts.voyages[0];
    this.el.hidden = false;
    this.el.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKey);
    this.render();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    this.go();
  };

  private onClick = (e: MouseEvent): void => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.act === 'back') {
      this.close();
      this.opts.onBack();
    } else if (b.dataset.act === 'next') this.go();
    else if (b.dataset.voyage) {
      this.chosen = this.opts.voyages.find((v) => v.id === b.dataset.voyage) ?? this.chosen;
      this.render();
    }
  };

  private go(): void {
    this.close();
    this.opts.onCastOff(this.chosen);
  }

  close(): void {
    this.el.hidden = true;
    this.el.removeEventListener('click', this.onClick);
    window.removeEventListener('keydown', this.onKey);
  }

  private render(): void {
    const cards = this.opts.voyages.map((v) => `<button type="button" class="card" data-voyage="${v.id}" aria-pressed="${v.id === this.chosen.id}">
      <b>${esc(v.title)}</b><span class="say">${esc(v.line)}</span></button>`).join('');
    this.el.innerHTML = `
      <header><h1>Expedition</h1><p>Voyages from history, sailed with what they had</p></header>
      <div class="join-body">
        <h2>The voyage</h2>
        <div class="cards">${cards}</div>
        ${this.chosen.briefing.map((p) => `<p class="brief">${esc(p)}</p>`).join('')}
        <p class="soon">You have the boat by hand, as any boat here. Enter stands a watch: four hours pass in a quarter of a minute while the helmsman holds your course, until something calls you. M is the chart. The / key lists the rest.</p>
      </div>
      <footer><button type="button" data-act="back">Back</button><button type="button" class="primary" data-act="next">Cast off</button></footer>`;
  }
}

/** The end of a voyage, in a few plain lines. */
export class EndCard {
  private readonly el = document.createElement('section');

  constructor(voyage: Voyage, r: VoyageResult, opts: { onAgain(): void; onLeave(): void }) {
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: voyage.timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(r.date);
    const days = Math.floor(r.days);
    const hours = Math.round((r.days - days) * 24);
    const atSea = `${days} ${days === 1 ? 'day' : 'days'} ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    const arrived = r.outcome === 'arrived';
    const head = arrived ? voyage.to.name : 'Lost';
    const sub = arrived
      ? `The ${voyage.boatName} came in on ${date}.`
      : `The ${voyage.boatName} passed out of the sea she had a chart for on ${date}.`;
    const account = arrived
      ? 'Shackleton\'s boat took sixteen days and came in at dusk on 10 May 1916. The whaling stations were on the other side of the island, over mountains no one had crossed.'
      : 'There is no land to leeward of South Georgia for three thousand miles. Nothing more is known of her six men, or of the twenty-two who were waiting for them on Elephant Island.';
    this.el.className = 'join endcard';
    this.el.setAttribute('aria-label', 'The end of the voyage');
    this.el.innerHTML = `
      <header><h1>${esc(head)}</h1><p>${esc(sub)}</p></header>
      <div class="join-body">
        <dl class="tally">
          <dt>At sea</dt><dd>${atSea}</dd>
          <dt>Sailed</dt><dd>${Math.round(r.miles)} miles</dd>
          <dt>Reckoning</dt><dd>${Math.round(r.errorMiles)} miles out. She was ${esc(r.errorToward)} of where the chart had her</dd>
        </dl>
        <p class="brief">${esc(account)}</p>
      </div>
      <footer><button type="button" data-act="leave">Leave her</button><button type="button" class="primary" data-act="again">Sail her again</button></footer>`;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.close();
      if (b.dataset.act === 'again') opts.onAgain();
      else opts.onLeave();
    });
    document.body.appendChild(this.el);
  }

  close(): void {
    this.el.remove();
  }
}
