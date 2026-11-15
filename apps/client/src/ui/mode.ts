// The first question, before anything else: which way to play.
// Regatta is the game as it has been. Expedition is voyages from history (`src/expedition/`).
// Drawn in the join screen's panel and in its manner, so the two read as one way in.

export type Mode = 'regatta' | 'expedition';

const SAVED = 'regatta.mode';

/** The way they played last time, as the join screen remembers its own choices. Regatta for a newcomer. */
export function lastMode(): Mode {
  try {
    return localStorage.getItem(SAVED) === 'expedition' ? 'expedition' : 'regatta';
  } catch {
    return 'regatta';
  }
}

export function rememberMode(mode: Mode): void {
  try {
    localStorage.setItem(SAVED, mode);
  } catch { /* private window: nothing to remember */ }
}

const CARDS: Array<{ mode: Mode; name: string; sub: string; say: string }> = [
  {
    mode: 'regatta', name: 'Regatta', sub: 'Today, on real water',
    say: 'Modern sloops on San Francisco Bay and the San Juan Islands, with the wind and tide as they really were. Learn to sail, cruise in company, race.',
  },
  {
    mode: 'expedition', name: 'Expedition', sub: 'Other seas, other centuries',
    say: 'The Caribbean of 1715 in a rover\'s sloop: chase, fight under sail in the real wind, plunder, and keep what you can. Or Shackleton\'s boat journey, with a compass and a bare chart.',
  },
];

export class ModeChoice {
  private readonly el = document.getElementById('join') as HTMLElement;
  private mode: Mode;

  constructor(private readonly opts: { initial: Mode; onChoose(mode: Mode): void }) {
    this.mode = opts.initial;
    this.el.hidden = false;
    this.el.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKey);
    this.render();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    this.choose();
  };

  private onClick = (e: MouseEvent): void => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.act === 'next') return this.choose();
    if (b.dataset.mode !== 'regatta' && b.dataset.mode !== 'expedition') return;
    this.mode = b.dataset.mode;
    this.render();
  };

  private choose(): void {
    this.close();
    rememberMode(this.mode);
    this.opts.onChoose(this.mode);
  }

  close(): void {
    this.el.removeEventListener('click', this.onClick);
    window.removeEventListener('keydown', this.onKey);
  }

  private render(): void {
    const cards = CARDS.map((c) => `<button type="button" class="card" data-mode="${c.mode}" aria-pressed="${c.mode === this.mode}">
      <b>${c.name}</b><span class="sub">${c.sub}</span><span class="say">${c.say}</span></button>`).join('');
    this.el.innerHTML = `
      <header><h1>Regatta</h1><p>A sailing simulator. Two ways to go to sea</p></header>
      <div class="join-body"><h2>How do you want to sail?</h2><div class="cards">${cards}</div></div>
      <footer><span></span><button type="button" class="primary" data-act="next">Next</button></footer>`;
  }
}
