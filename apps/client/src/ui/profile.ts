import {
  BEARDS, DEFAULT_AVATAR, FACES, GIRTHS, HAIR, HAIR_SHADES, HATS, HAT_SHADES, HEIGHTS, JACKETS, OUTFITS, OUTFIT_HATS, SKINS, SPECS, TROUSERS,
  hasMyAvatar, myAvatar, randomAvatar, readAvatar, setMyAvatar, type Avatar, type Option, type Shade,
} from '../boat/avatar';
import type { Logbook } from '../net/logbook';
import { rankOf } from '../xp/score';
import { db as askDb, user as askUser } from '../net/platform';
import { figurePreview } from './figurePreview';
import { CLOTHS, KITE_COLOURS, KITE_PATTERNS, mySailStyle, saveSailStyle, type SailStyle } from '../boat/sailStyle';
import { kiteSwatch } from '../boat/sails';

/**
 * Who you are: the skipper's name and the figure at the wheel, put together piece by piece with the figure turning
 * beside the choices. One panel, shown as the Profile tab of the board (which adds the website's sign-in under it)
 * and opened from the home screen's card.
 *
 * The avatar is kept by `boat/avatar.ts` and changes on the boat at once. The name is kept with the join choice.
 */

const JOIN = 'regatta.join';
/** Sent on `window` when the name or the avatar changes, so the home screen's card can follow. */
export const PROFILE_CHANGED = 'regatta:profile';

/** The join choice as last saved on this device: whatever is there, unchecked. */
export function savedJoin(): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(JOIN) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The skipper's name as last saved. */
export function savedSkipper(): string {
  const s = savedJoin().skipper;
  return typeof s === 'string' ? s.slice(0, 16) : '';
}

function saveSkipper(name: string): void {
  try {
    localStorage.setItem(JOIN, JSON.stringify({ ...savedJoin(), skipper: name.slice(0, 16) }));
  } catch { /* nothing to keep it in */ }
}

/**
 * A signed-in player on a device that has no avatar yet takes up the one in their profile document.
 * @returns true if one was taken up
 */
export async function adoptAvatar(): Promise<boolean> {
  if (hasMyAvatar()) return false;
  try {
    const [db, user] = await Promise.all([askDb(), askUser()]);
    const uid = await user?.id();
    if (!db || !uid) return false;
    const kept = (await db.doc(`profiles/${uid}`).get()).data()?.avatar;
    if (typeof kept !== 'string' || hasMyAvatar()) return false;
    setMyAvatar(readAvatar(kept));
    window.dispatchEvent(new Event(PROFILE_CHANGED));
    return true;
  } catch {
    return false;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

type Page = 'outfit' | 'hat' | 'hair' | 'face' | 'build' | 'sails';
const PAGES: Array<[Page, string]> = [['outfit', 'Outfit'], ['hat', 'Hat'], ['hair', 'Hair'], ['face', 'Face'], ['build', 'Build'], ['sails', 'Sails']];

export class ProfilePane {
  readonly el = document.createElement('section');
  private page: Page = 'outfit';
  private readonly stage = document.createElement('div');
  private readonly form = document.createElement('div');

  constructor(private readonly logbook: Logbook) {
    this.el.className = 'profile-pane';
    this.stage.className = 'profile-stage';
    this.form.className = 'profile-form';
    this.el.append(this.stage, this.form);
    this.form.addEventListener('click', this.onClick);
    this.stage.addEventListener('click', this.onClick);
    this.form.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'profile-skipper') {
        saveSkipper(t.value);
        window.dispatchEvent(new Event(PROFILE_CHANGED));
      } else if (t.dataset.range) this.change({ [t.dataset.range]: Number(t.value) } as Partial<Avatar>, false);
    });
    void adoptAvatar().then((took) => { if (took && this.el.isConnected) this.show(); });
  }

  /** Draw the panel and start the figure turning. Call each time the panel goes on the page. */
  show(): void {
    const preview = figurePreview();
    if (preview) {
      if (preview.canvas.parentElement !== this.stage) this.stage.prepend(preview.canvas);
      preview.wear(myAvatar());
      preview.focus(this.page === 'outfit' || this.page === 'build' ? 'figure' : 'head');
      preview.start();
    }
    if (!this.stage.querySelector('.profile-dice')) {
      this.stage.insertAdjacentHTML('beforeend', `<div class="profile-dice"><button type="button" data-act="surprise">Surprise me</button><button type="button" data-act="reset" title="The red jacket and navy cap">Start again</button></div>`);
    }
    this.render();
  }

  private onClick = (e: MouseEvent): void => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.page) {
      this.page = d.page as Page;
      figurePreview()?.focus(this.page === 'outfit' || this.page === 'build' ? 'figure' : 'head');
      this.render();
    } else if (d.sail) {
      const now = mySailStyle();
      const style: SailStyle = { cloth: now.cloth, kite: { pattern: now.kite.pattern, colours: [...now.kite.colours] as SailStyle['kite']['colours'] } };
      if (d.sail === 'cloth') style.cloth = d.value ?? style.cloth;
      else if (d.sail === 'pattern') style.kite.pattern = d.value ?? style.kite.pattern;
      else if (/^c[0-2]$/.test(d.sail)) style.kite.colours[Number(d.sail[1])] = Number(d.value);
      saveSailStyle(style);
      this.render();
    } else if (d.act === 'surprise') this.change(randomAvatar(Math.random));
    else if (d.act === 'reset') this.change({ ...DEFAULT_AVATAR });
    else if (d.set) this.change({ [d.set]: /^\d+$/.test(d.value ?? '') && d.num ? Number(d.value) : d.value } as Partial<Avatar>);
  };

  private change(patch: Partial<Avatar>, redraw = true): void {
    setMyAvatar({ ...myAvatar(), ...patch });
    figurePreview()?.wear(myAvatar());
    window.dispatchEvent(new Event(PROFILE_CHANGED));
    if (redraw) this.render();
  }

  /** The boat's sails: the cloth of the main and jib, and the spinnaker's design and colours. Everyone on the water sees them. */
  private sailsPage(): string {
    const style = mySailStyle();
    const pattern = KITE_PATTERNS.find((k) => k.id === style.kite.pattern) ?? KITE_PATTERNS[0];
    const cloth = `<div class="pick" role="group" aria-label="Sailcloth"><span class="lab">Mainsail and jib</span><div class="chips">${CLOTHS.map((c) =>
      `<button type="button" class="chip" data-sail="cloth" data-value="${c.id}" aria-pressed="${style.cloth === c.id}"><i class="dot" style="background:${css(c.base)}"></i>${esc(c.name)}</button>`).join('')}</div></div>`;
    const kites = `<div class="pick" role="group" aria-label="Spinnaker design"><span class="lab">Spinnaker</span><div class="chips kites">${KITE_PATTERNS.map((k) =>
      `<button type="button" class="chip kite" data-sail="pattern" data-value="${k.id}" aria-pressed="${pattern.id === k.id}" title="${esc(k.name)}"><span data-kite="${k.id}"></span>${esc(k.name)}</button>`).join('')}</div></div>`;
    const colours = Array.from({ length: pattern.colours }, (_, n) =>
      `<div class="pick" role="group" aria-label="Spinnaker colour ${n + 1}"><span class="lab">Colour ${n + 1}</span><div class="swatches">${KITE_COLOURS.map((c, i) =>
        `<button type="button" class="swatch" data-sail="c${n}" data-value="${i}" aria-pressed="${style.kite.colours[n] === i}" aria-label="${c.name}" title="${c.name}" style="background:${css(c.hex)}"></button>`).join('')}</div></div>`).join('');
    const note = pattern.colours === 0 ? '<p class="soon">This one is cut in the colour of your hull.</p>' : '';
    return `${cloth}${kites}${colours}${note}<p class="soon">Everyone on the water sees your sails. N hoists the spinnaker when the wind is aft.</p>`;
  }

  private render(): void {
    const a = myAvatar();
    const words = (key: keyof Avatar, list: Option[], label: string): string =>
      `<div class="pick" role="group" aria-label="${label}"><span class="lab">${label}</span><div class="chips">${list.map((o) => `<button type="button" class="chip" data-set="${key}" data-value="${o.id}" aria-pressed="${a[key] === o.id}">${esc(o.name)}</button>`).join('')}</div></div>`;
    const shades = (key: keyof Avatar, list: Shade[], label: string, note = ''): string =>
      `<div class="pick" role="group" aria-label="${label}"><span class="lab">${label}</span><div class="swatches">${list.map((s, i) => `<button type="button" class="swatch" data-set="${key}" data-num="1" data-value="${i}" aria-pressed="${a[key] === i}" aria-label="${s.name}" title="${s.name}" style="background:${css(s.hex)}"></button>`).join('')}</div>${note ? `<p class="soon">${note}</p>` : ''}</div>`;
    const range = (key: 'height' | 'girth', list: Option[], label: string): string =>
      `<div class="pick"><label class="lab" for="profile-${key}">${label}</label><input id="profile-${key}" type="range" min="0" max="4" step="1" value="${a[key]}" data-range="${key}" aria-valuetext="${list[a[key]].name}"><div class="ends"><span>${list[0].name}</span><span>${list[4].name}</span></div></div>`;

    const costume = a.outfit !== 'own';
    const ownHat = OUTFIT_HATS[a.outfit];
    const body = this.page === 'outfit'
      ? `${words('outfit', OUTFITS, 'Outfit')}
         ${shades('jacket', JACKETS, 'Jacket', costume ? 'The jacket and trousers colours are for Own colours. Every other outfit comes as it is.' : '')}
         ${shades('trousers', TROUSERS, 'Trousers')}`
      : this.page === 'hat'
        ? `${words('hat', HATS, 'Headgear')}${shades('hatShade', HAT_SHADES, 'Colour', ownHat ? `The ${esc(OUTFITS.find((o) => o.id === a.outfit)!.name.toLowerCase())} outfit brings its own headgear. Change the outfit to wear another.` : '')}`
        : this.page === 'hair'
          ? `${words('hair', HAIR, 'Hair')}${shades('hairShade', HAIR_SHADES, 'Hair colour')}${words('beard', BEARDS, 'Facial hair')}`
          : this.page === 'face'
            ? `${shades('skin', SKINS, 'Skin')}${words('face', FACES, 'Mouth')}${words('specs', SPECS, 'Glasses')}`
            : this.page === 'build'
              ? `${range('height', HEIGHTS, 'Height')}${range('girth', GIRTHS, 'Girth')}`
              : this.sailsPage();

    const t = this.logbook.totals;
    const sailing = 'regatta' in window;
    // Keep the caret in the name while the rest is drawn again.
    const typing = document.activeElement?.id === 'profile-skipper';
    this.form.innerHTML = `
      <div class="pick"><label class="lab" for="profile-skipper">Skipper</label>
        <input id="profile-skipper" type="text" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="What the fleet calls you" value="${esc(savedSkipper())}">
        ${sailing ? '<p class="soon">A new name shows to the fleet from your next cast-off. Your figure changes at once, for you and for them.</p>' : ''}</div>
      <nav class="profile-pages" aria-label="Parts of the figure">${PAGES.map(([id, name]) => `<button type="button" data-page="${id}" aria-pressed="${id === this.page}">${name}</button>`).join('')}</nav>
      <div class="profile-picks">${body}</div>
      <p class="profile-log"><span data-profile-rank>${rankOf(t.xp ?? 0).name} · ${Math.round(t.xp ?? 0)} points</span>${t.miles.toFixed(1)} miles · ${t.hours.toFixed(1)} hours · ${t.sails} ${t.sails === 1 ? 'sail' : 'sails'} · ${t.races} ${t.races === 1 ? 'race' : 'races'}, ${t.wins} won. The rest is on the Logbook tab.</p>`;
    // Each spinnaker design drawn small, in the colours chosen.
    for (const slot of this.form.querySelectorAll<HTMLElement>('[data-kite]')) {
      slot.replaceChildren(kiteSwatch({ pattern: slot.dataset.kite!, colours: mySailStyle().kite.colours }, '#c0392b', 44));
    }
    if (typing) {
      const input = this.form.querySelector<HTMLInputElement>('#profile-skipper');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  }
}
