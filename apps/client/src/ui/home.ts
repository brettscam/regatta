import { myAvatar } from '../boat/avatar';
import type { YardBoat } from '../boat/yard';
import { alone, platform, room as askRoom, type RoomPeer } from '../net/platform';
import { eventWater, inText, nextEvent, whenText } from '../race/events';
import type { CourseAbout } from '../world/loadCourse';
import { figurePreview } from './figurePreview';
import type { Choice, StartSpot } from './join';
import { PROFILE_CHANGED, savedSkipper } from './profile';

/**
 * The front page: the name, who you are, one button to go sailing, a line on who is out and any race fixed,
 * and small links to the board. It sits over the live water with the player's own boat sailing behind it.
 *
 * A second way to play goes in `modes`: each is drawn as a button under the main one, and picking it closes the
 * home screen and calls its `open`. Nothing else here knows what a mode is.
 */

/** Another way to play, offered beside going sailing. */
export interface HomeMode {
  id: string;
  /** On the button. */
  title: string;
  /** One line under the title. */
  say: string;
  /** Called once the home screen has closed. */
  open(): void;
}

export interface HomeOptions {
  /** The last choices, made whole, for the boat behind the page and for casting off straight away. */
  choice: Choice;
  /** True for someone who has cast off on this device before: the main button then takes them straight out. */
  returning: boolean;
  boats: Record<string, YardBoat>;
  waters: CourseAbout[];
  spots: StartSpot[];
  /** Put this choice on the water behind the page. */
  show(choice: Choice): void;
  /** Go through the way in: where, lesson, boat. */
  onSail(): void;
  /** Cast off now with these choices. */
  onCastOff(choice: Choice): void;
  /** Open a tab of the board. */
  onBoard(tab: 'roadmap' | 'news' | 'keys' | 'profile'): void;
  /** Other ways to play. None today. */
  modes?: HomeMode[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Show the home screen. Returns the way to close it without choosing anything. */
export function openHome(opts: HomeOptions): () => void {
  const el = document.createElement('section');
  el.id = 'home';
  el.className = 'home';
  el.setAttribute('aria-label', 'Regatta');
  document.body.appendChild(el);
  document.body.classList.add('at-home');

  /** Boats out on each water, by course id, as far as this page can tell. */
  const out = new Map<string, number>();
  let counted = false;
  let unhear: () => void = () => {};
  let closed = false;

  const waterName = (id: string): string => opts.waters.find((w) => w.id === id)?.name ?? 'the water';
  const boatsLine = (): string => {
    if (!counted) return '';
    const here = [...out].filter(([, n]) => n > 0);
    if (!here.length) return `Nobody else is out on ${esc(waterName(opts.choice.water))} just now.`;
    return `${here.map(([id, n]) => `<b>${n} ${n === 1 ? 'boat' : 'boats'}</b> out on ${esc(waterName(id))}`).join(', ')} now.`;
  };
  const raceLine = (): string => {
    const event = alone() ? null : nextEvent(null);
    return event ? `<b>${esc(event.name)}</b> on ${esc(waterName(eventWater(event)))}: the gun goes at ${esc(whenText(event))}, ${esc(inText(event))}.` : '';
  };

  const render = (): void => {
    const c = opts.choice;
    const skipper = savedSkipper();
    const spec = opts.boats[c.boat];
    const spot = opts.spots.find((s) => s.id === c.spot);
    const portrait = figurePreview()?.portrait(myAvatar()) ?? '';
    const now = [boatsLine(), raceLine()].filter(Boolean).join(' ');
    const modes = (opts.modes ?? []).map((m) => `<button type="button" class="home-mode" data-mode="${esc(m.id)}"><b>${esc(m.title)}</b><span>${esc(m.say)}</span></button>`).join('');
    el.innerHTML = `
      <header><h1>Regatta</h1><p>Sail a real day on real water. The wind and the tide are as they were, and anyone else out is out there with you.</p></header>
      <button type="button" class="home-me" data-act="profile" title="Your name and your figure">
        ${portrait ? `<img src="${portrait}" alt="" width="72" height="72">` : ''}
        <span><b>${esc(skipper || 'Skipper')}</b><span>${esc(c.name)} · ${esc(spec?.name ?? '')}</span><i>${skipper ? 'Change your figure' : 'Choose a name and build your figure'}</i></span>
      </button>
      <div class="home-go">
        <button type="button" class="primary" data-act="${opts.returning ? 'castoff' : 'sail'}">${opts.returning ? 'Cast off' : 'Go sailing'}</button>
        ${opts.returning ? `<p>${esc(c.name)} from ${esc(spot?.name ?? 'the start')}, ${esc(waterName(c.water))}. <button type="button" class="link" data-act="sail">Somewhere else, or another boat</button></p>` : '<p>Choose your water and your boat. A first lesson is there if you want one.</p>'}
        ${modes}
      </div>
      ${now ? `<p class="home-now">${now}</p>` : ''}
      <nav class="home-links" aria-label="More"><button type="button" data-board="roadmap">Roadmap</button><button type="button" data-board="news">What's new</button><button type="button" data-board="keys">Keys</button></nav>`;
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    unhear();
    clearInterval(tick);
    window.removeEventListener(PROFILE_CHANGED, render);
    window.removeEventListener('keydown', onKey);
    document.body.classList.remove('at-home');
    el.remove();
  };

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.board) opts.onBoard(d.board as 'roadmap' | 'news' | 'keys');
    else if (d.act === 'profile') opts.onBoard('profile');
    else if (d.act === 'sail') {
      close();
      opts.onSail();
    } else if (d.act === 'castoff') {
      close();
      opts.onCastOff({ ...opts.choice, skipper: savedSkipper() || opts.choice.skipper });
    } else if (d.mode) {
      const mode = opts.modes?.find((m) => m.id === d.mode);
      if (!mode) return;
      close();
      mode.open();
    }
  });
  // Enter is the main button, unless something else has the keys.
  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement;
    if (e.key !== 'Enter' || /^(INPUT|TEXTAREA|BUTTON)$/.test(t.tagName) || !document.getElementById('board')?.hidden) return;
    el.querySelector<HTMLButtonElement>('.home-go .primary')?.click();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener(PROFILE_CHANGED, render);
  // The countdown to a race moves on.
  const tick = setInterval(render, 30000);

  // Who is out. The shared page has one room for every water. The website has one for each, and only the one for
  // the water showing is open, so that is the only one counted.
  const count = (peers: readonly RoomPeer[]): void => {
    out.clear();
    for (const p of peers) {
      if (p.sameTab || p.kind !== 'viewer' || typeof p.presence?.x !== 'number') continue;
      const cs = typeof p.presence.cs === 'string' ? p.presence.cs : 'sf-bay';
      if (!opts.waters.some((w) => w.id === cs)) continue;
      if (platform() === 'web' && cs !== opts.choice.water) continue;
      out.set(cs, (out.get(cs) ?? 0) + 1);
    }
    counted = true;
    render();
  };
  void askRoom(opts.choice.water).then((room) => {
    if (!room || closed) return;
    unhear = room.onPeers((change) => count(change.peers), () => {});
    // Give the boats already out a moment to be heard before saying nobody is.
    setTimeout(() => { if (!closed) count(room.peers()); }, 2500);
  }).catch(() => {});

  opts.show(opts.choice);
  render();
  return close;
}
