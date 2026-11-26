// What is on the screen while she is ashore: a small card with the place, the time and the way back, a prompt for
// what can be done where she stands, and the menu at the bar. None of it is a sailing control. The styles live here
// with it, so that nothing of going ashore is in the game's shared stylesheet.

const CSS = `
body.ashore #readout, body.ashore #mini, body.ashore #clock, body.ashore .cheat, body.ashore #hint, body.ashore #racebar, body.ashore .place-label { display: none !important; }
.ashore-card[hidden], .ashore-prompt[hidden], .ashore-menu[hidden] { display: none !important; }
.ashore-card { position: fixed; z-index: 2; left: var(--edge-left, 16px); top: var(--edge-top, 16px); width: min(300px, calc(100% - 32px)); padding: 10px 13px 9px; display: grid; gap: 3px;
  background: rgba(9, 18, 24, 0.78); border: 1px solid rgba(238, 243, 244, 0.16); border-radius: 12px; color: var(--ink, #eef3f4); font-size: 12.5px; line-height: 1.35; pointer-events: none; }
.ashore-card b { font-size: 15px; font-weight: 650; }
.ashore-card .when { opacity: 0.75; }
.ashore-card .who { color: var(--amber, #ffc46b); }
.ashore-card .keys { opacity: 0.7; margin-top: 3px; }
.ashore-card kbd, .ashore-prompt kbd, .ashore-menu kbd { display: inline-block; min-width: 1.5em; padding: 0 4px; margin-right: 3px; text-align: center; font: 600 11px ui-monospace, monospace; color: #0b151c; background: #e8eef0; border-radius: 4px; }
.ashore-prompt { position: fixed; z-index: 3; left: 50%; transform: translateX(-50%); bottom: calc(var(--edge-bottom, 16px) + 150px); display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; max-width: calc(100% - 32px);
  padding: 8px 14px; background: rgba(9, 18, 24, 0.86); border: 1px solid var(--amber, #ffc46b); border-radius: 999px; color: var(--ink, #eef3f4); font-size: 13.5px; pointer-events: none; }
.ashore-menu { position: fixed; z-index: 4; left: 50%; transform: translateX(-50%); bottom: calc(var(--edge-bottom, 16px) + 200px); width: min(330px, calc(100% - 32px)); padding: 12px 14px; display: grid; gap: 5px;
  background: rgba(9, 18, 24, 0.93); border: 1px solid var(--amber, #ffc46b); border-radius: 12px; color: var(--ink, #eef3f4); font-size: 13.5px; pointer-events: none; }
.ashore-menu b { font-size: 14.5px; }
.ashore-menu .round { margin-top: 3px; padding-top: 6px; border-top: 1px solid rgba(238, 243, 244, 0.16); }
.ashore-menu .shut { opacity: 0.6; font-size: 12px; }
.ashore-name { font-weight: 650; }
.ashore-bubble { position: fixed; left: 0; top: 0; z-index: 2; max-width: 240px; padding: 6px 10px; background: #f6f3ea; color: #14232d; border-radius: 12px 12px 12px 3px; font-size: 13px; line-height: 1.3; pointer-events: none; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); overflow-wrap: anywhere; }
.ashore-sight { font-style: italic; }
@media (max-width: 620px) {
  .ashore-card { font-size: 11.5px; width: min(230px, calc(100% - 24px)); padding: 8px 10px; }
  .ashore-card .keys { display: none; }
  .ashore-prompt { bottom: calc(var(--edge-bottom, 12px) + 96px); font-size: 12.5px; }
  .ashore-menu { bottom: calc(var(--edge-bottom, 12px) + 140px); }
}
`;

let styled = false;
function style(): void {
  if (styled) return;
  styled = true;
  const el = document.createElement('style');
  el.textContent = CSS;
  document.head.appendChild(el);
}

const kbd = (key: string): HTMLElement => {
  const k = document.createElement('kbd');
  k.textContent = key;
  return k;
};

/** A line of words with key caps in it: `[['F'], 'sit']` pairs. Words go in as text, never as markup. */
function keyed(el: HTMLElement, parts: ReadonlyArray<readonly [readonly string[], string]>): void {
  el.replaceChildren();
  for (const [keys, words] of parts) {
    const span = document.createElement('span');
    for (const k of keys) span.append(kbd(k));
    span.append(words);
    el.append(span, ' ');
  }
}

export interface CardText {
  place: string;
  when: string;
  /** What she is doing or looking at, if anything. */
  doing: string;
  /** Who else is here. */
  who: string;
  back: string;
  /** Whether there is anyone to tell where she is. */
  company: boolean;
}

export class AshoreCard {
  private readonly card = document.createElement('aside');
  private readonly prompt = document.createElement('div');
  private readonly menu = document.createElement('div');
  private readonly title = document.createElement('b');
  private readonly when = document.createElement('div');
  private readonly doing = document.createElement('div');
  private readonly who = document.createElement('div');
  private readonly keys = document.createElement('div');
  private readonly back = document.createElement('div');
  private last = '';
  private lastPrompt = '';

  constructor() {
    style();
    this.card.className = 'ashore-card';
    this.card.setAttribute('aria-label', 'Ashore');
    this.when.className = 'when';
    this.who.className = 'who';
    this.keys.className = 'keys';
    this.card.append(this.title, this.when, this.doing, this.who, this.keys, this.back);
    this.prompt.className = 'ashore-prompt';
    this.menu.className = 'ashore-menu';
    this.card.hidden = this.prompt.hidden = this.menu.hidden = true;
    document.body.append(this.card, this.prompt, this.menu);
  }

  /** Ashore or not: the instruments go while she is, and come back when she is aboard. */
  show(on: boolean): void {
    document.body.classList.toggle('ashore', on);
    this.card.hidden = !on;
    if (!on) {
      this.prompt.hidden = this.menu.hidden = true;
      this.last = this.lastPrompt = '';
    }
  }

  /** H hides the card with the rest of the instruments. The prompt stays: it is how anything is done. */
  hide(hidden: boolean): void {
    this.card.style.display = hidden ? 'none' : '';
  }

  set(t: CardText): void {
    const all = JSON.stringify(t);
    if (all === this.last) return;
    this.last = all;
    this.title.textContent = t.place;
    this.when.textContent = t.when;
    this.doing.textContent = t.doing;
    this.doing.style.display = t.doing ? '' : 'none';
    this.who.textContent = t.who;
    this.who.style.display = t.who ? '' : 'none';
    keyed(this.keys, [[['W', 'A', 'S', 'D'], 'walk'], [['Shift'], 'jog'], [['Q', 'E'], 'or drag: look'], [['1', '–', '5'], 'wave, cheers, point, shrug, laugh'], ...(t.company ? [[['T'], 'tell the fleet where you are'] as const] : [])]);
    keyed(this.back, [[['O'], t.back]]);
  }

  /** What can be done here: each a key and a few words. Empty hides it. */
  offer(offers: ReadonlyArray<readonly [string, string]>): void {
    const all = offers.map((o) => o.join(':')).join('|');
    if (all === this.lastPrompt) return;
    this.lastPrompt = all;
    this.prompt.hidden = offers.length === 0;
    keyed(this.prompt, offers.map(([key, words]) => [[key], words] as const));
  }

  /** The menu: numbered things to order, and a round for everyone as the last of them. Null shuts it. */
  order(title: string | null, items: readonly string[] = [], round = ''): void {
    this.menu.hidden = title === null;
    if (title === null) return;
    this.menu.replaceChildren();
    const head = document.createElement('b');
    head.textContent = title;
    this.menu.append(head);
    items.forEach((name, i) => {
      const row = document.createElement('div');
      row.append(kbd(String(i + 1)), name);
      this.menu.append(row);
    });
    if (round) {
      const row = document.createElement('div');
      row.className = 'round';
      row.append(kbd(String(items.length + 1)), round);
      this.menu.append(row);
    }
    const shut = document.createElement('div');
    shut.className = 'shut';
    shut.textContent = 'On the house for now. G or Esc shuts the menu';
    this.menu.append(shut);
  }

  dispose(): void {
    document.body.classList.remove('ashore');
    this.card.remove();
    this.prompt.remove();
    this.menu.remove();
  }
}
