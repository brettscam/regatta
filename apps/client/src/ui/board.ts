import releasesJson from '../data/releases.json';
import roadmapJson from '../data/roadmap.json';
import { visited } from '../aboard/visited';
import type { Logbook } from '../net/logbook';
import { account as askAccount, alone, onWeb, type Account } from '../net/platform';
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
/**
 * Every control, in plain words, grouped by what the player is trying to do and in the order a newcomer needs them.
 * Each row: the keys (one string per key cap; "or" and "+" are joiners, anything else long is a gesture), what it is called, what it does.
 * Sailing is done on the boat's own parts or with these keys: there are no sailing buttons.
 */
const KEYS: Array<{ title: string; note?: string; rows: Array<[string[], string, string]> }> = [
  { title: 'Steer and set the sails', note: 'These five are all you need to get going.', rows: [
    [['A', 'D'], 'Steer', 'Turn the wheel left or right. The arrow keys do the same.'],
    [['W', 'S'], 'Mainsail', 'The big sail. W pulls it in, S lets it out.'],
    [['Q', 'E'], 'Jib', 'The front sail. Q pulls it in, E lets it out.'],
    [['T'], 'Tack', 'Turn the boat through the wind onto her other side. The crew swaps the sails over for you.'],
    [['P'], 'Autopilot', 'On or off. While it is on the boat steers herself and the crew looks after the sails.'],
  ] },
  { title: 'Or use the mouse', rows: [
    [['Point and scroll'], 'Grab the boat', 'Point at the wheel, the boom (the pole along the bottom of the mainsail) or a winch, then scroll or drag to move it.'],
    [['Drag'], 'Look around', 'Drag anywhere else to swing the camera. Scroll to move in and out.'],
  ] },
  { title: 'See more', rows: [
    [['1', '2', '3', '4'], 'Camera', 'Jump to a view: the wheel, the mast, the bow, or above the boat.'],
    [['M'], 'Chart', 'The map. Plan a route and see the wind and tide forecast.'],
    [['F'], 'Wind tunnel', 'Shows the air flowing over your sails, and tells you whether they are set right.'],
    [['Shift', '+', 'P'], 'Autopilot mode', 'Choose what the autopilot follows: a compass heading, an angle to the wind, or your route on the chart.'],
    [['C'], 'Coaching', 'Tips on or off.'],
    [['H'], 'Instruments', 'Hide or show the numbers on screen.'],
  ] },
  { title: 'Race and talk', rows: [
    [['R'], 'Fleet and racing', 'See who else is out, start a race, or join one.'],
    [['Enter'], 'Message', 'Type a message to the other boats.'],
  ] },
  { title: 'Stop for a while', rows: [
    [['X'], 'Stop here', 'Slow right down first. Drops the anchor, or ties up if you are at a mooring or a dock. Press X again to set off.'],
    [['Z'], 'Sleep', 'Skip to the morning. Only while stopped, and only when you are alone on the water.'],
    [['O'], 'Go ashore', 'Tied up at a dock, O steps straight ashore. Anywhere else you have stopped, it launches the kayak: paddle with W A S D, press O at a beach or a bar to land, and O beside your boat to climb back aboard.'],
  ] },
  { title: 'Catch supper', rows: [
    [['K'], 'Crab pot', 'Drops a pot with a buoy. Come back in about an hour and press K beside the buoy to pull it up.'],
    [['L'], 'Fishing line', 'Line out or in. When "Fish on" appears, press L quickly to catch it.'],
  ] },
  { title: 'If you get stuck', rows: [
    [['U'], 'Tow', 'Run aground? This tows you back to deep water.'],
    [['Space'], 'Pause', 'Only when you are alone on the water.'],
    [['Drag the clock'], 'Faster time', 'Drag the clock in the corner sideways to speed time up. Only when you are alone.'],
    [['/'], 'Key reminder', 'Shows or hides the strip of main keys at the top of the screen.'],
    [['B'], 'This board', 'Roadmap, what is new, these keys, feedback and your logbook.'],
  ] },
];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The roadmap and the feedback form. Anyone can read the roadmap. Voting and sending feedback need the shared
 * database: the published claude.ai page's, or on the website the site's own, once the person has signed in with their
 * email address. The sign-in form is on the Logbook tab, on the website only. Where there is neither, each tab says so.
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
  /** Signing in, on the website. Null on the shared page, which knows who is looking, and where there is no backend. */
  private account: Account | null = null;
  private email = '';
  private code = '';
  private signing: 'idle' | 'sending' | 'sent' | 'checking' = 'idle';
  private signNote = '';
  private unwatch: () => void = () => {};

  /** The places with somewhere to go ashore, for the bar-hop card. */
  places: Array<{ id: string; name: string; ashore?: { name: string; say: string } }> = [];

  /** Supplies what the boat is doing, to attach to feedback when the sender allows it. */
  context: () => Record<string, unknown> = () => ({});

  constructor(private readonly logbook: Logbook) {
    logbook.onFleet = () => { if (this.isOpen && this.tab === 'logbook') this.render(); };
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLTextAreaElement | HTMLInputElement;
      if (t.id === 'board-text') this.draft = t.value;
      if (t.id === 'board-context') this.withContext = (t as HTMLInputElement).checked;
      if (t.id === 'board-email') this.email = t.value;
      if (t.id === 'board-code') this.code = t.value;
    });
    // Keys typed into the form are not sailing commands.
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.toggle(false);
      const id = (e.target as HTMLElement).id;
      if (e.key === 'Enter' && id === 'board-email') void this.signIn();
      if (e.key === 'Enter' && id === 'board-code') void this.verify();
      e.stopPropagation();
    });
    // Signing in or out on the website changes whose votes and notes these are.
    this.store.onAccount = () => {
      this.unwatch();
      this.unwatch = () => {};
      this.watching = false;
      this.sent = [];
      this.note = '';
      if (this.isOpen) {
        this.start();
        this.render();
      }
    };
    void askAccount().then((a) => {
      this.account = a;
      if (!a) return;
      a.onChange(() => {
        this.signing = 'idle';
        this.code = '';
        this.signNote = a.email() ? '' : 'You are signed out.';
        if (this.isOpen) this.render();
      });
      // Arriving from the link in the sign-in email: say how it went.
      if (a.arrival) {
        this.signNote = a.arrival === 'expired' ? 'That sign-in link had run out or had already been used. Ask for a new one here.' : 'You are signed in.';
        this.toggle(true, 'logbook');
      } else if (this.isOpen) this.render();
    }).catch(() => {});
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
    this.unwatch = this.store.watchVotes((tally) => {
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
    else if (d.act === 'signin') void this.signIn();
    else if (d.act === 'verify') void this.verify();
    else if (d.act === 'again') { this.signing = 'idle'; this.signNote = ''; this.code = ''; this.render(); }
    else if (d.act === 'signout') void this.account?.signOut();
    else if (d.suggest) { this.tab = 'feedback'; this.kind = 'idea'; this.render(); }
  };

  private async castVote(item: string, value: number): Promise<void> {
    const next = this.store.vote(item) === value ? 0 : value;
    const ok = await this.store.setVote(item, next);
    if (!ok) this.note = onWeb() ? 'Your vote could not be saved. Check your connection, and on the Logbook tab that you are still signed in.' : 'Your vote could not be saved. Voting needs the page shared with you as a contributor.';
    this.render();
  }

  /** Ask for the sign-in email. */
  private async signIn(): Promise<void> {
    if (!this.account || this.signing === 'sending') return;
    this.signing = 'sending';
    this.signNote = '';
    this.render();
    const r = await this.account.send(this.email);
    this.signing = r.ok ? 'sent' : 'idle';
    this.signNote = r.ok ? '' : r.reason ?? 'The email could not be sent.';
    this.render();
  }

  /** Sign in with the code from the email, where the email carries one. */
  private async verify(): Promise<void> {
    if (!this.account || this.signing !== 'sent' || !this.code.trim()) return;
    this.signing = 'checking';
    this.signNote = '';
    this.render();
    const r = await this.account.verify(this.email, this.code);
    // When it works, the account says so itself and the form is drawn again signed in.
    if (!r.ok) {
      this.signing = 'sent';
      this.signNote = r.reason ?? 'That did not work.';
      this.render();
    }
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
      this.note = onWeb() ? 'This could not be sent. Check your connection, and on the Logbook tab that you are still signed in. Or copy it and pass it on.' : 'This could not be sent from here. Copy it and pass it on to whoever shared the game with you.';
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
      : onWeb()
        ? this.store.signedIn
          ? 'Your votes cannot be saved just now. Check your connection.'
          : `${this.store.online ? 'You can read the votes. ' : ''}To cast one, sign in with your email address: <button type="button" class="link" data-tab="logbook">the form is on the Logbook tab</button>.`
        : this.store.online
          ? 'You can read the votes. Casting one needs the page shared with you as a contributor.'
          : alone()
            ? 'Voting is not available in this copy of the game. It works on the website and on the shared page.'
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
      ${canSend ? '' : onWeb()
        ? `<p class="note">${this.store.signedIn ? 'Sending is not working just now. Check your connection.' : 'Sending from here needs a sign-in with your email address: <button type="button" class="link" data-tab="logbook">the form is on the Logbook tab</button>.'} Or copy your note and pass it on.</p>`
        : `<p class="note">${this.store.online ? 'Sending from here needs the page shared with you as a contributor.' : alone() ? 'Feedback cannot be sent from this copy of the game.' : 'Sending works on the shared page when you are signed in.'} Until then, copy your note and pass it on.</p>`}
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
    const caps = (keys: string[]): string => keys.map((k) => (k === '+' ? '<i>+</i>' : k.length > 6 ? `<span class="gesture">${esc(k)}</span>` : `<kbd>${esc(k)}</kbd>`)).join('');
    const groups = KEYS.map((g) => `<section class="keygroup"><h3>${esc(g.title)}</h3>${g.note ? `<p class="lede">${esc(g.note)}</p>` : ''}
      <ul class="keylist">${g.rows.map(([keys, name, what]) => `<li><span class="caps">${caps(keys)}</span><span class="what"><b>${esc(name)}</b>${esc(what)}</span></li>`).join('')}</ul></section>`).join('');
    return `<div class="keypage">${groups}</div>`;
  }

  /** Every place there is to go ashore, stamped once the player has been. */
  private barHop(): string {
    const stops = this.places.filter((p) => p.ashore);
    if (!stops.length) return '';
    const been = visited();
    const n = stops.filter((p) => been.has(p.id)).length;
    const cards = stops.map((p) => `<li class="${been.has(p.id) ? 'been' : ''}"><b>${esc(p.name)}</b><span>${esc(p.ashore!.name)}</span><i>${been.has(p.id) ? 'Been' : 'Not yet'}</i></li>`).join('');
    return `<h3>Bar hop · ${n} of ${stops.length}</h3><p class="lede">Stop the boat nearby with X, then O: step ashore at a dock, or take the kayak in. Each place is stamped the first time.</p><ul class="barhop">${cards}</ul>`;
  }

  private log(): string {
    const t = this.logbook.totals;
    const stat = (label: string, value: string) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
    const mine = `<div class="stats">
      ${stat('Miles sailed', t.miles.toFixed(1))}${stat('Hours under way', t.hours.toFixed(1))}${stat('Sails', String(t.sails))}
      ${stat('Marks rounded', String(t.marks))}${stat('Tacks and gybes', String(t.tacks))}${stat('Knockdowns', String(t.knockdowns))}${stat('Top speed', `${t.topKt.toFixed(1)} kt`)}
      ${stat('Crab', String(t.crabs))}${stat('Fish', String(t.fish))}
    </div>`;
    const fleet = this.logbook.fleet;
    const rows = fleet.map((p, i) => `<tr class="${p.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(p.skipper || 'A skipper')}${p.me ? ' (you)' : ''}</td><td>${esc(p.boatName)}</td><td>${p.log.miles.toFixed(1)}</td><td>${p.log.hours.toFixed(1)}</td><td>${p.log.marks}</td></tr>`).join('');
    const table = fleet.length
      ? `<h3>The fleet</h3><table><thead><tr><th></th><th>Skipper</th><th>Boat</th><th>Miles</th><th>Hours</th><th>Marks</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="lede">${this.store.online ? (onWeb() ? 'Nobody has logged a sail here yet. Sign in and yours is the first.' : 'Nobody else has logged a sail yet.') : onWeb() ? 'The fleet\'s logbooks could not be fetched just now.' : alone() ? 'The fleet\'s logbooks are not available in this copy of the game.' : 'On the shared page, when you are signed in, the fleet\'s logbooks show here.'}</p>`;
    const kept = onWeb()
      ? this.account?.email()
        ? 'It is also kept with your sign-in, so it follows you to any device, and the fleet can see it below.'
        : 'Sign in below and it is kept with your email address too, so it follows you to any device.'
      : alone()
        ? 'In this copy of the game it is kept in this browser only.'
        : 'On the shared page it is also kept with your sign-in, so it follows you.';
    return `<p class="lede">Your logbook adds up every sail on this device. ${kept} Experience, ratings and prizes will be built on it.</p>${mine}${this.signInForm()}${this.barHop()}${table}`;
  }

  /** The website's sign-in: an email address, and a link sent to it. Nothing is drawn where the platform has none. */
  private signInForm(): string {
    const a = this.account;
    if (!a) return '';
    const note = this.signNote ? `<p class="note" role="status">${esc(this.signNote)}</p>` : '';
    const address = a.email();
    if (address) {
      return `<section class="signin"><h3>Your account</h3>
        <p class="lede">Signed in as <b>${esc(address)}</b>. Your logbook, your votes and the feedback you send go with this address. Other people are shown only your skipper name, your boat and your logbook.</p>${note}
        <div class="row"><button type="button" data-act="signout">Sign out</button></div></section>`;
    }
    if (this.signing === 'sent' || this.signing === 'checking') {
      const code = a.codes
        ? `<label for="board-code">Or type the code from the email</label>
          <div class="row"><input id="board-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" value="${esc(this.code)}"><button type="button" class="primary" data-act="verify" ${this.signing === 'checking' ? 'disabled' : ''}>${this.signing === 'checking' ? 'Checking' : 'Sign in'}</button></div>`
        : '';
      return `<section class="signin"><h3>Sign in</h3>
        <p class="lede">An email with a sign-in link is on its way to <b>${esc(this.email.trim())}</b>. Open the link on this device and you are signed in. It can take a minute, and it may land in the junk folder.</p>
        ${code}${note}
        <div class="row"><button type="button" data-act="again">Use a different address</button></div></section>`;
    }
    const sending = this.signing === 'sending';
    return `<section class="signin"><h3>Sign in</h3>
      <p class="lede">Sign in with your email address to keep your logbook on any device, vote on the roadmap and send feedback. There is no password: you are sent an email with a link. You can sail, and see the other boats, without signing in.</p>
      <label for="board-email">Email address</label>
      <div class="row"><input id="board-email" type="text" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="254" value="${esc(this.email)}"><button type="button" class="primary" data-act="signin" ${sending ? 'disabled' : ''}>${sending ? 'Sending' : 'Email me a sign-in link'}</button></div>
      ${note}</section>`;
  }

  private render(): void {
    // Keep the caret where it was while votes arrive behind the form.
    const active = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null;
    const typing = active && ['board-text', 'board-email', 'board-code'].includes(active.id) ? active.id : null;
    const caret = typing ? active!.selectionStart : null;
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
    if (typing && caret !== null) {
      const t = document.getElementById(typing) as HTMLTextAreaElement | HTMLInputElement | null;
      t?.focus();
      t?.setSelectionRange(caret, caret);
    }
  }
}
