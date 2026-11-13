import releasesJson from '../data/releases.json';
import roadmapJson from '../data/roadmap.json';
import type { Logbook } from '../net/logbook';
import { onWeb } from '../net/platform';
import { Store, type FeedbackEntry, type Tally } from '../net/store';

interface RoadmapItem { id: string; status: string; area: string; title: string; text: string }
interface Release { id: string; name: string; theme: string; when: string; blurb: string; items: RoadmapItem[] }
/** The lanes of the board: what part of the game an item belongs to. */
const AREAS: Array<[string, string]> = [
  ['experience', 'Sailing experience'],
  ['multiplayer', 'Multiplayer and racing'],
  ['world', 'Places and life aboard'],
  ['platform', 'Platform'],
  ['progress', 'Progression'],
];
/** The columns: how soon. An item's status puts it in one. */
const COLUMNS: Array<[string, string]> = [
  ['building', 'This sprint'],
  ['next', 'Next sprint'],
  ['later', 'Later'],
  ['idea', 'Ideas'],
  ['shipped', 'Shipped'],
];
const roadmap = roadmapJson as { updated: string; releases: Release[] };
interface Note { id: string; date: string; title: string; items: string[] }
/** Release notes, newest first. */
const notes = (releasesJson as { notes: Note[] }).notes;
const SEEN = 'regatta.seen';

const KINDS: Array<[string, string, string]> = [
  ['feedback', 'Feedback', 'What do you think? What felt right, what felt off?'],
  ['problem', 'Something is broken', 'What happened, and what did you expect?'],
  ['idea', 'An idea', 'What should the game do that it does not?'],
];
type Tab = 'roadmap' | 'news' | 'keys' | 'feedback' | 'logbook';
/** Every control, grouped. Sailing is done on the boat's own parts or with these keys: there are no sailing buttons. */
const KEYS: Array<[string, Array<[string, string]>]> = [
  ['Sailing', [
    ['Point at the wheel, boom or a winch', 'Scroll or drag to turn, ease or trim it'],
    ['A D or ← →', 'Wheel to port or starboard'],
    ['W S', 'Mainsheet in, mainsheet out'],
    ['Q E', 'Trim the working jib sheet, ease the loaded one'],
    ['T', 'Tack or gybe, with the crew on the sheets'],
    ['P, Shift+P', 'Autopilot on or off, and what it holds: heading, wind angle, route'],
  ]],
  ['Seeing', [
    ['Drag, scroll', 'Look around, move in and out'],
    ['1 2 3 4', 'Helm, mast, foredeck and drone views'],
    ['M', 'Chart and passage plan'],
    ['F', 'Wind tunnel: the air over the sails, and what the trim is asking for'],
    ['H', 'Hide or show the instruments'],
    ['C', 'Coaching hints on or off'],
  ]],
  ['With other boats', [
    ['R', 'Fleet and racing: who is out, call a race, join one'],
    ['Enter', 'Hail the fleet'],
  ]],
  ['Stopping', [
    ['X', 'Anchor, pick up a mooring or come alongside. X again to get under way'],
    ['Z', 'At anchor or moored: turn in for the night'],
  ]],
  ['The game', [
    ['Space', 'Pause (alone on the water)'],
    ['Drag the clock', 'Speed time up (alone on the water)'],
    ['B', 'This board: roadmap, what is new, keys, feedback, logbook'],
  ]],
];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The roadmap and the feedback form. Anyone can read the roadmap. Voting and sending feedback need the page's
 * shared database, which only the published claude.ai page has. On the website there is none yet, and each tab says so.
 */
export class Board {
  private readonly el = document.getElementById('board') as HTMLElement;
  private readonly store = new Store();
  private tab: Tab = 'roadmap';
  private tally: Tally = {};
  private watching = false;
  private kind = 'feedback';
  private draft = '';
  private withContext = true;
  private note = '';
  private sent: FeedbackEntry[] = [];
  private busy = false;
  /** Which lane the roadmap is narrowed to, and whether what has shipped is shown. */
  private area = 'all';
  private showShipped = false;
  private readonly link = document.getElementById('boardlink');
  private readonly flash = document.getElementById('newsflash');
  /** The newest release note this person has read. */
  private seen = '';

  /** Supplies what the boat is doing, to attach to feedback when the sender allows it. */
  context: () => Record<string, unknown> = () => ({});

  constructor(private readonly logbook: Logbook) {
    logbook.onFleet = () => { if (this.isOpen && this.tab === 'logbook') this.render(); };
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLTextAreaElement | HTMLInputElement;
      if (t.id === 'board-text') this.draft = t.value;
      if (t.id === 'board-context') this.withContext = (t as HTMLInputElement).checked;
    });
    // Keys typed into the form are not sailing commands.
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.toggle(false);
      e.stopPropagation();
    });
    for (const link of document.querySelectorAll('[data-open-board]')) link.addEventListener('click', () => this.toggle(true, (link as HTMLElement).dataset.openBoard as Tab));
    void this.store.ready.then(() => { if (this.isOpen) this.start(); });
    this.announce();
  }

  /** True when there is a release note this person has not opened. */
  get hasNews(): boolean {
    return notes.length > 0 && this.seen !== notes[0].id;
  }

  /** Tell someone who has sailed before that the game has changed since. A first-time sailor is not told: all of it is new. */
  private announce(): void {
    let returning = false;
    try {
      this.seen = localStorage.getItem(SEEN) ?? '';
      returning = this.seen !== '' || localStorage.getItem('regatta.join') !== null;
    } catch { /* no storage: nothing is remembered, so nothing is announced */ }
    if (!returning) return this.markSeen();
    if (!this.hasNews) return;
    this.link?.classList.add('new');
    if (this.flash) {
      this.flash.innerHTML = `<b>New in Regatta</b><span>${esc(notes[0].title)}</span><i>See what changed</i>`;
      this.flash.hidden = false;
      this.flash.addEventListener('click', () => this.toggle(true, 'news'));
      setTimeout(() => { if (this.flash) this.flash.hidden = true; }, 20000);
    }
  }

  private markSeen(): void {
    if (!notes.length) return;
    this.seen = notes[0].id;
    this.link?.classList.remove('new');
    if (this.flash) this.flash.hidden = true;
    try {
      localStorage.setItem(SEEN, this.seen);
    } catch { /* nothing to remember */ }
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.isOpen, tab?: Tab): void {
    if (tab) this.tab = tab;
    else if (open && this.hasNews) this.tab = 'news';
    this.el.hidden = !open;
    if (this.flash) this.flash.hidden = true;
    if (open) {
      this.start();
      this.render();
    }
  }

  /** Begin following votes and load this person's earlier notes, once. */
  private start(): void {
    if (this.watching || !this.store.online) return;
    this.watching = true;
    this.store.watchVotes((tally) => {
      this.tally = tally;
      if (this.isOpen && this.tab === 'roadmap') this.render();
    });
    void this.store.myFeedback().then((items) => {
      this.sent = items;
      if (this.isOpen && this.tab === 'feedback') this.render();
    });
  }

  private onClick = (e: MouseEvent): void => {
    if (e.target === this.el) return this.toggle(false);
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.act === 'close') this.toggle(false);
    else if (d.tab) { this.tab = d.tab as Tab; this.note = ''; this.render(); }
    else if (d.kind) { this.kind = d.kind; this.render(); }
    else if (d.vote && d.item) void this.castVote(d.item, Number(d.vote));
    else if (d.area) { this.area = d.area; this.render(); }
    else if (d.act === 'shipped') { this.showShipped = !this.showShipped; this.render(); }
    else if (d.act === 'send') void this.send();
    else if (d.act === 'copy') void this.copy();
    else if (d.suggest) { this.tab = 'feedback'; this.kind = 'idea'; this.render(); }
  };

  private async castVote(item: string, value: number): Promise<void> {
    const next = this.store.vote(item) === value ? 0 : value;
    const ok = await this.store.setVote(item, next);
    if (!ok) this.note = 'Your vote could not be saved. Voting needs the page shared with you as a contributor.';
    this.render();
  }

  private async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.busy) return;
    this.busy = true;
    this.render();
    const entry: FeedbackEntry = { kind: this.kind, text: text.slice(0, 4000), at: new Date().toISOString() };
    if (this.withContext) entry.context = this.context();
    const ok = await this.store.sendFeedback(entry);
    this.busy = false;
    if (ok) {
      this.sent = [...this.sent, entry];
      this.draft = '';
      this.note = 'Sent. Thank you: it goes straight to the people building Regatta.';
    } else {
      this.note = 'This could not be sent from here. Copy it and pass it on to whoever shared the game with you.';
    }
    this.render();
  }

  private async copy(): Promise<void> {
    const text = `${this.kind}: ${this.draft.trim()}${this.withContext ? `\n\n${JSON.stringify(this.context())}` : ''}`;
    try {
      await navigator.clipboard.writeText(text);
      this.note = 'Copied.';
    } catch {
      this.note = 'Copying is blocked here. Select the text and copy it by hand.';
    }
    this.render();
  }

  // ---- drawing ---------------------------------------------------------------------------------

  private roadmap(): string {
    const canVote = this.store.canWrite;
    const all = roadmap.releases.flatMap((r) => r.items.map((it) => ({ ...it, theme: r.theme })));
    const score = (id: string) => { const t = this.tally[id]; return t ? t.up - t.down : 0; };
    const shipped = all.filter((it) => it.status === 'shipped').length;
    const columns = COLUMNS.filter(([id]) => id !== 'shipped' || this.showShipped);
    const lanes = AREAS.filter(([id]) => this.area === 'all' || this.area === id);
    const card = (it: (typeof all)[number]): string => {
      const t = this.tally[it.id] ?? { up: 0, down: 0 };
      const mine = this.store.vote(it.id);
      const votes = it.status === 'shipped' ? '' : `
        <div class="votes" role="group" aria-label="Vote on ${esc(it.title)}">
          <button type="button" data-item="${it.id}" data-vote="1" aria-pressed="${mine === 1}" aria-label="Vote up" ${canVote ? '' : 'disabled'}>▲</button>
          <b title="${t.up} up, ${t.down} down">${t.up - t.down}</b>
          <button type="button" data-item="${it.id}" data-vote="-1" aria-pressed="${mine === -1}" aria-label="Vote down" ${canVote ? '' : 'disabled'}>▼</button>
        </div>`;
      return `<li class="item card ${it.status} area-${it.area}">${votes}<div><b>${esc(it.title)}</b><p>${esc(it.text)}</p>${it.theme ? `<span class="theme">${esc(it.theme)}</span>` : ''}</div></li>`;
    };
    const head = `<div class="rm-corner"></div>${columns.map(([id, name]) => `<div class="rm-head ${id}">${name}<i>${all.filter((it) => it.status === id && (this.area === 'all' || it.area === this.area)).length}</i></div>`).join('')}`;
    const rows = lanes.map(([area, name]) => {
      const cells = columns.map(([status, colName]) => {
        const items = all.filter((it) => it.area === area && it.status === status).sort((a, b) => score(b.id) - score(a.id));
        return `<ul class="rm-cell ${items.length ? '' : 'empty'}" data-col="${colName}">${items.map(card).join('')}</ul>`;
      }).join('');
      return `<div class="rm-lane area-${area}"><span>${name}</span></div>${cells}`;
    }).join('');
    const chips = [['all', 'Everything'] as [string, string], ...AREAS].map(([id, name]) => `<button type="button" class="chip area-${id}" data-area="${id}" aria-pressed="${this.area === id}">${name}</button>`).join('');
    const how = canVote
      ? 'Vote for what you want most. One vote per item, and you can change it. The most wanted rise to the top of each box.'
      : this.store.online
        ? 'You can read the votes. Casting one needs the page shared with you as a contributor.'
        : onWeb()
          ? 'Voting is not available on this website yet. It needs accounts, which have not been built here.'
          : 'Voting works on the shared page when you are signed in.';
    return `<p class="lede">${how} <button type="button" class="link" data-suggest="1">Something missing? Suggest it.</button></p>${this.note ? `<p class="note">${esc(this.note)}</p>` : ''}
      <div class="rm-filter">${chips}<button type="button" class="chip shipped" data-act="shipped" aria-pressed="${this.showShipped}">Shipped · ${shipped}</button></div>
      <div class="rm-scroll"><div class="rm-board" style="--cols:${columns.length}">${head}${rows}</div></div>`;
  }

  private feedback(): string {
    const prompt = KINDS.find((k) => k[0] === this.kind)![2];
    const kinds = KINDS.map(([id, label]) => `<button type="button" data-kind="${id}" aria-pressed="${id === this.kind}">${label}</button>`).join('');
    const canSend = this.store.canWrite;
    const earlier = this.sent.length
      ? `<h3>What you have sent</h3><ul class="sent">${[...this.sent].reverse().slice(0, 12).map((s) => `<li><span>${esc(s.kind)} · ${esc(new Date(s.at).toLocaleString())}</span>${esc(s.text)}</li>`).join('')}</ul>`
      : '';
    return `
      <div class="kinds" role="group" aria-label="What kind of note">${kinds}</div>
      <label for="board-text">${prompt}</label>
      <textarea id="board-text" rows="6" maxlength="4000" placeholder="Write as much or as little as you like">${esc(this.draft)}</textarea>
      <label class="check"><input id="board-context" type="checkbox" ${this.withContext ? 'checked' : ''}> Include which boat I am sailing, where she is and what the wind is doing. It helps find problems.</label>
      <div class="row">
        ${canSend ? `<button type="button" class="primary" data-act="send" ${this.busy ? 'disabled' : ''}>${this.busy ? 'Sending' : 'Send'}</button>` : ''}
        <button type="button" data-act="copy">Copy it instead</button>
      </div>
      ${canSend ? '' : `<p class="note">${this.store.online ? 'Sending from here needs the page shared with you as a contributor.' : onWeb() ? 'Feedback cannot be sent from this website yet.' : 'Sending works on the shared page when you are signed in.'} Until then, copy your note and pass it on${onWeb() ? ' to whoever gave you the link' : ''}.</p>`}
      ${this.note ? `<p class="note">${esc(this.note)}</p>` : ''}
      ${earlier}`;
  }

  private news(): string {
    const unread = this.hasNews ? notes[0].id : '';
    const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    const list = notes.map((n) => `<section class="release ${n.id === unread ? 'unread' : ''}"><header><h3>${esc(n.title)}</h3><span>${n.id === unread ? 'New · ' : ''}${esc(day(n.date))}</span></header><ul class="notes">${n.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>`).join('');
    return `<p class="lede">What has changed, newest first. The game updates under you while you sail: your boat carries on where she was.</p>${list}`;
  }

  private keys(): string {
    return KEYS.map(([group, rows]) => `<section class="release"><header><h3>${esc(group)}</h3></header><dl class="keys">${rows.map(([k, what]) => `<dt>${esc(k)}</dt><dd>${esc(what)}</dd>`).join('')}</dl></section>`).join('');
  }

  private log(): string {
    const t = this.logbook.totals;
    const stat = (label: string, value: string) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
    const mine = `<div class="stats">
      ${stat('Miles sailed', t.miles.toFixed(1))}${stat('Hours under way', t.hours.toFixed(1))}${stat('Sails', String(t.sails))}
      ${stat('Marks rounded', String(t.marks))}${stat('Tacks and gybes', String(t.tacks))}${stat('Knockdowns', String(t.knockdowns))}${stat('Top speed', `${t.topKt.toFixed(1)} kt`)}
    </div>`;
    const fleet = this.logbook.fleet;
    const rows = fleet.map((p, i) => `<tr class="${p.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(p.skipper || 'A skipper')}${p.me ? ' (you)' : ''}</td><td>${esc(p.boatName)}</td><td>${p.log.miles.toFixed(1)}</td><td>${p.log.hours.toFixed(1)}</td><td>${p.log.marks}</td></tr>`).join('');
    const table = fleet.length
      ? `<h3>The fleet</h3><table><thead><tr><th></th><th>Skipper</th><th>Boat</th><th>Miles</th><th>Hours</th><th>Marks</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="lede">${this.store.online ? 'Nobody else has logged a sail yet.' : onWeb() ? 'The fleet\'s logbooks are not available on this website yet.' : 'On the shared page, when you are signed in, the fleet\'s logbooks show here.'}</p>`;
    const kept = onWeb()
      ? 'On this website it is kept in this browser only: there are no accounts here yet, so it does not follow you to another device.'
      : 'On the shared page it is also kept with your sign-in, so it follows you.';
    return `<p class="lede">Your logbook adds up every sail on this device. ${kept} Experience, ratings and prizes will be built on it.</p>${mine}${table}`;
  }

  private render(): void {
    // Keep the caret where it was while votes arrive behind the form.
    const active = document.activeElement as HTMLTextAreaElement | null;
    const caret = active?.id === 'board-text' ? active.selectionStart : null;
    this.el.innerHTML = `
      <div class="board-frame ${this.tab === 'roadmap' ? 'wide' : ''}" role="dialog" aria-label="Roadmap and feedback">
        <header>
          <h2>Regatta</h2>
          <nav><button type="button" data-tab="roadmap" aria-pressed="${this.tab === 'roadmap'}">Roadmap</button><button type="button" data-tab="news" aria-pressed="${this.tab === 'news'}">What's new</button><button type="button" data-tab="keys" aria-pressed="${this.tab === 'keys'}">Keys</button><button type="button" data-tab="feedback" aria-pressed="${this.tab === 'feedback'}">Feedback</button><button type="button" data-tab="logbook" aria-pressed="${this.tab === 'logbook'}">Logbook</button></nav>
          <button type="button" class="close" data-act="close" aria-label="Close">Close</button>
        </header>
        <div class="board-body ${this.tab}">${this.tab === 'roadmap' ? this.roadmap() : this.tab === 'news' ? this.news() : this.tab === 'keys' ? this.keys() : this.tab === 'feedback' ? this.feedback() : this.log()}</div>
      </div>`;
    // Reading the notes is what marks them read, after they have been drawn as new once.
    if (this.tab === 'news' && this.hasNews) this.markSeen();
    if (caret !== null) {
      const t = document.getElementById('board-text') as HTMLTextAreaElement | null;
      t?.focus();
      t?.setSelectionRange(caret, caret);
    }
  }
}
