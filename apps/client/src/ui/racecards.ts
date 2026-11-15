/**
 * The race roster as pictures: one card for every boat in a race, with her hull in her own colour, her name and sail
 * number, her skipper, and how she stands. A person's card carries the portrait of her skipper's figure; a club pace
 * boat's carries the skipper's initials on her colours and a line about who they are. Shown in the race panel before
 * the gun, during the race and with the results.
 *
 * Everything on a card that came from another page (names, colours, avatars) is checked or escaped here.
 */
import { JACKETS, myAvatar, myAvatarCode, readAvatar, type Avatar } from '../boat/avatar';
import { ORDINAL, clockText, type Standing } from '../race/race';
import { RING } from '../race/startline';
import { figurePreview } from './figurePreview';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const HEX = /^#[0-9a-f]{6}$/i;
const NM = 1852;

/** Whether a colour is light enough to want dark lettering on it. */
function light(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
}

/**
 * A boat from the side, drawn: hull in her colour, mast, main and jib, her number on the main.
 * @param colour topsides as a CSS hex colour; anything else gives the default dark blue
 */
export function boatPicture(colour: string, sail: string): string {
  const hull = HEX.test(colour) ? colour : '#12233d';
  const no = sail.replace(/[^0-9A-Za-z]/g, '').slice(0, 4);
  return `<svg class="boatpic" viewBox="0 0 64 56" aria-hidden="true">
    <path d="M30 4 L30 42 L7 42 Z" fill="#f1eee4" stroke="#7c8288" stroke-width="0.6"/>
    <path d="M33 9 L33 41 L56 41 Z" fill="#e9e5d8" stroke="#7c8288" stroke-width="0.6"/>
    <line x1="31.5" y1="2" x2="31.5" y2="44" stroke="#c9ced2" stroke-width="1.2"/>
    ${no ? `<text x="20.5" y="36" font-size="7" font-weight="700" text-anchor="middle" fill="#12233d" font-family="ui-sans-serif, Arial, sans-serif">${esc(no)}</text>` : ''}
    <path d="M3 44 L61 44 L55 52 Q32 55 9 52 Z" fill="${hull}" stroke="rgba(238,243,244,0.55)" stroke-width="0.8"/>
    <path d="M6.5 49.5 L57 49.5" stroke="rgba(255,255,255,0.35)" stroke-width="0.7"/>
  </svg>`;
}

const faces = new Map<string, string>();
/** A skipper's face as a small picture, drawn once for each look. '' where a second 3D view cannot be made. */
function face(key: string, avatar: () => Avatar): string {
  let url = faces.get(key);
  if (url === undefined) {
    try {
      url = figurePreview()?.portrait(avatar(), 96, 1, 0.3) ?? '';
    } catch {
      url = '';
    }
    if (faces.size > 40) faces.clear();
    faces.set(key, url);
  }
  return url;
}

const initials = (name: string): string => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && w.toLowerCase() !== 'and').slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

/** The round picture on a card: a person's own figure, or a club skipper's initials on her boat's colour. */
function badge(s: Standing): string {
  if (s.pace) {
    // The club's skippers are drawn at the helm on the water; on a card they are a disc in their colours, so a person is never mistaken for one.
    const bg = HEX.test(s.colour) ? s.colour : '#33424d';
    return `<span class="who club" style="background:${bg};color:${light(bg) ? '#12233d' : '#f4f6f6'}">${esc(initials(s.name))}</span>`;
  }
  const url = s.me ? face(myAvatarCode(), myAvatar) : s.avatar ? face(s.avatar, () => readAvatar(s.avatar)) : '';
  if (url) return `<span class="who person"><img src="${url}" alt=""></span>`;
  const jacket = s.me ? myAvatar().jacket : s.avatar ? readAvatar(s.avatar).jacket : 0;
  return `<span class="who person" style="background:#${JACKETS[jacket].hex.toString(16).padStart(6, '0')}">${esc(initials(s.name))}</span>`;
}

const nm = (m: number): string => `${(m / NM).toFixed(m < NM ? 2 : 1)} nm`;
const place = (i: number): string => ORDINAL[i] ?? `${i + 1}th`;

/** How she stands, in a few words: the line at the foot of her card. */
export function stateText(s: Standing, index: number, started: boolean, marks: number): { text: string; kind: 'wait' | 'racing' | 'done' | 'out' } {
  if (s.damage >= 100 && s.finish === null) return { text: 'Holed', kind: 'out' };
  if (s.retired) return { text: 'Retired', kind: 'out' };
  if (s.finish !== null) return { text: `${place(index)} · ${clockText(s.finish)}${s.gapS ? ` · +${clockText(s.gapS)}` : ''}`, kind: 'done' };
  if (!started) {
    const off = s.toGo - RING;
    return { text: off <= 0 ? 'In the start ring' : off < 500 ? `At the start · ${Math.round(off / 10) * 10} m off` : `Joined · ${nm(off)} from the start`, kind: 'wait' };
  }
  const gap = s.gapM === null ? '' : s.gapM < 15 ? ' · leading' : ` · +${nm(s.gapM)}`;
  return { text: `${place(index)}${gap} · ${s.leg === 0 ? 'not started' : `mark ${s.leg} of ${marks - 1}`}`, kind: 'racing' };
}

/** One boat's card. */
export function entryCard(s: Standing, index: number, started: boolean, marks: number): string {
  const state = stateText(s, index, started, marks);
  const tag = s.me ? 'You' : s.pace ? 'Club boat' : 'Player';
  const about = s.pace ? `${s.level ?? ''}${s.character ? `. ${s.character}` : ''}` : '';
  // The slot for crew: the names of whoever is aboard with the skipper, when crews arrive.
  const crew = s.crew.length ? `<span class="crew">Crew: ${esc(s.crew.join(', '))}</span>` : '';
  return `<li class="entry ${s.me ? 'me' : s.pace ? 'club' : 'person'} ${state.kind}"${about ? ` title="${esc(about)}"` : ''}>
    <span class="pics">${boatPicture(s.colour, s.sail)}${badge(s)}</span>
    <span class="names"><b>${esc(s.boat || 'A boat')}</b><span>${esc(s.name)}${s.sail ? ` · sail ${esc(s.sail)}` : ''}</span>
      <span class="tag ${s.pace ? 'club' : 'person'}">${tag}${s.pace && s.level ? ` · ${esc(s.level)}` : ''}</span>${crew}</span>
    <span class="state">${esc(state.text)}</span>
    ${s.pace && s.character ? `<span class="char">${esc(s.character)}</span>` : ''}
  </li>`;
}

/** Every boat in the race as a card, in the order they stand. */
export function rosterCards(table: Standing[], started: boolean, marks: number): string {
  return `<ul class="entries">${table.map((s, i) => entryCard(s, i, started, marks)).join('')}</ul>`;
}

/** The results, once the player is home: places and times for everyone, and where the boats still out have got to. */
export function resultsTable(table: Standing[], marks: number): string {
  const rows = table.map((s, i) => {
    const out = s.damage >= 100 && s.finish === null ? 'Holed' : s.retired ? 'Retired' : null;
    const time = s.finish !== null ? clockText(s.finish) : out ?? 'Still racing';
    const gap = s.finish !== null ? (s.gapS ? `+${clockText(s.gapS)}` : '') : out ? '' : `mark ${s.leg} of ${marks - 1}, ${nm(s.remaining)} to go`;
    return `<tr class="${s.me ? 'me' : ''}"><td>${s.finish !== null ? i + 1 : ''}</td><td>${esc(s.boat || 'A boat')}</td><td>${esc(s.name)}${s.pace ? ' <i>club</i>' : ''}</td><td>${time}</td><td>${gap}</td></tr>`;
  }).join('');
  return `<table class="results"><thead><tr><th></th><th>Boat</th><th>Skipper</th><th>Time</th><th>Behind</th></tr></thead><tbody>${rows}</tbody></table>`;
}
