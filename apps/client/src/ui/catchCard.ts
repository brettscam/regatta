import { creelRows, emptyCreel, fishWords, readCreel, type Creel } from '../fishing/points';
import { fishingWaters } from '../fishing/table';
import { COURSES } from '../world/loadCourse';
import './fishStyle';

const SAVED = 'regatta.creel';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** The fishing book kept on this device. */
export function loadCreel(): Creel {
  try {
    return readCreel(JSON.parse(localStorage.getItem(SAVED) ?? 'null'));
  } catch {
    return emptyCreel();
  }
}

export function saveCreel(c: Creel): void {
  try {
    localStorage.setItem(SAVED, JSON.stringify(c));
  } catch { /* nothing to keep it in */ }
}

/**
 * The fishing card for the Logbook tab: the all-time total, every species landed with the personal best, and for a
 * water with its own fishing the species still to find. Empty until a fish has been landed.
 */
export function catchCard(): string {
  const c = loadCreel();
  if (!c.fish) return '';
  const rows = creelRows(c);
  const cards = rows.map((r) => `<li class="been"><b>${esc(r.name.charAt(0).toUpperCase() + r.name.slice(1))}</b><span>Best: ${esc(fishWords(r.name, r.bestCm, r.bestKg).split(', ').slice(1).join(', '))} · ${r.bestPoints} points</span><i>${r.n} landed${r.water ? ` · ${esc(COURSES.find((w) => w.id === r.water)?.name ?? r.water)}` : ''}</i></li>`).join('');
  // What is still out there, on the waters that list their own fish.
  const missing = fishingWaters().flatMap(({ table }) => table.species.filter((s) => !c.species[s.id]).map((s) => `<li><b>${esc(s.name.charAt(0).toUpperCase() + s.name.slice(1))}</b><span>${esc(s.hint)}</span><i>Not yet</i></li>`)).join('');
  const derbies = c.derbies ? ` Tournaments fished: ${c.derbies}, won: ${c.derbyWins}.` : '';
  return `<section class="catchcard"><h3>Fishing · ${c.points.toLocaleString('en-GB')} points · ${rows.length} species</h3>
    <p class="lede">${c.fish} fish landed, ${c.released} of them let go.${derbies} Every fish scores by its size for its kind, so the best of each is the one to beat. L fishes; Shift+L is the fishing card.</p>
    <ul class="barhop">${cards}${missing}</ul></section>`;
}
