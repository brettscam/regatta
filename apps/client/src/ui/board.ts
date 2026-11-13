import roadmapJson from '../data/roadmap.json';
import { Store, type FeedbackEntry, type Tally } from '../net/store';

interface RoadmapItem { id: string; status: string; title: string; text: string }
interface Release { id: string; name: string; when: string; blurb: string; items: RoadmapItem[] }
const roadmap = roadmapJson as { updated: string; releases: Release[] };

const STATUS: Record<string, string> = { shipped: 'Shipped', building: 'Being built', next: 'Up next', later: 'Planned', idea: 'Idea' };
const KINDS: Array<[string, string, string]> = [
  ['feedback', 'Feedback', 'What do you think? What felt right, what felt off?'],
  ['problem', 'Something is broken', 'What happened, and what did you expect?'],
  ['idea', 'An idea', 'What should the game do that it does not?'],
];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The roadmap and the feedback form. Anyone can read the roadmap. Voting and sending feedback need the page's
 * shared database, which only the published page has.
 */
export class Board {
  private readonly el = document.getElementById('board') as HTMLElement;
  private readonly store = new Store();
  private tab: 'roadmap' | 'feedback' = 'roadmap';
  private tally: Tally = {};
  private watching = false;
  private kind = 'feedback';
  private draft = '';
  private withContext = true;
  private note = '';
  private sent: FeedbackEntry[] = [];
  private busy = false;

  /** Supplies what the boat is doing, to attach to feedback when the sender allows it. */
  context: () => Record<string, unknown> = () => ({});

  constructor() {
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
    for (const link of document.querySelectorAll('[data-open-board]')) link.addEventListener('click', () => this.toggle(true, (link as HTMLElement).dataset.openBoard as 'roadmap' | 'feedback'));
    void this.store.ready.then(() => { if (this.isOpen) this.start(); });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.isOpen, tab?: 'roadmap' | 'feedback'): void {
    if (tab) this.tab = tab;
    this.el.hidden = !open;
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
    else if (d.tab) { this.tab = d.tab as 'roadmap' | 'feedback'; this.note = ''; this.render(); }
    else if (d.kind) { this.kind = d.kind; this.render(); }
    else if (d.vote && d.item) void this.castVote(d.item, Number(d.vote));
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
    const releases = roadmap.releases.map((r) => {
      const items = r.items.map((it) => {
        const t = this.tally[it.id] ?? { up: 0, down: 0 };
        const mine = this.store.vote(it.id);
        const votes = it.status === 'shipped' ? '' : `
          <div class="votes" role="group" aria-label="Vote on ${esc(it.title)}">
            <button type="button" data-item="${it.id}" data-vote="1" aria-pressed="${mine === 1}" aria-label="Vote up" ${canVote ? '' : 'disabled'}>▲</button>
            <b title="${t.up} up, ${t.down} down">${t.up - t.down}</b>
            <button type="button" data-item="${it.id}" data-vote="-1" aria-pressed="${mine === -1}" aria-label="Vote down" ${canVote ? '' : 'disabled'}>▼</button>
          </div>`;
        return `<li class="item ${it.status}">${votes}<div><span class="status">${STATUS[it.status] ?? it.status}</span><b>${esc(it.title)}</b><p>${esc(it.text)}</p></div></li>`;
      }).join('');
      return `<section class="release"><header><h3>${esc(r.name)}</h3><span>${esc(r.when)}</span></header><p class="blurb">${esc(r.blurb)}</p><ul>${items}</ul></section>`;
    }).join('');
    const how = canVote
      ? 'Vote for what you want most. One vote per item, and you can change it.'
      : this.store.online
        ? 'You can read the votes. Casting one needs the page shared with you as a contributor.'
        : 'Voting works on the shared page when you are signed in.';
    return `<p class="lede">${how} <button type="button" class="link" data-suggest="1">Something missing? Suggest it.</button></p>${this.note ? `<p class="note">${esc(this.note)}</p>` : ''}${releases}`;
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
      ${canSend ? '' : `<p class="note">${this.store.online ? 'Sending from here needs the page shared with you as a contributor.' : 'Sending works on the shared page when you are signed in.'} Until then, copy your note and pass it on.</p>`}
      ${this.note ? `<p class="note">${esc(this.note)}</p>` : ''}
      ${earlier}`;
  }

  private render(): void {
    // Keep the caret where it was while votes arrive behind the form.
    const active = document.activeElement as HTMLTextAreaElement | null;
    const caret = active?.id === 'board-text' ? active.selectionStart : null;
    this.el.innerHTML = `
      <div class="board-frame" role="dialog" aria-label="Roadmap and feedback">
        <header>
          <h2>Regatta</h2>
          <nav><button type="button" data-tab="roadmap" aria-pressed="${this.tab === 'roadmap'}">Roadmap</button><button type="button" data-tab="feedback" aria-pressed="${this.tab === 'feedback'}">Feedback</button></nav>
          <button type="button" class="close" data-act="close" aria-label="Close">Close</button>
        </header>
        <div class="board-body ${this.tab}">${this.tab === 'roadmap' ? this.roadmap() : this.feedback()}</div>
      </div>`;
    if (caret !== null) {
      const t = document.getElementById('board-text') as HTMLTextAreaElement | null;
      t?.focus();
      t?.setSelectionRange(caret, caret);
    }
  }
}
