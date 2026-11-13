import { KT, R2D } from '@slack-tide/sim';
import type { RemoteBoat } from '../net/fleet';
import { clockText, type Race, type RaceCourse, type RaceMark } from '../race/race';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const deg3 = (rad: number) => String(Math.round(((rad * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');

export interface FleetPanelContext {
  race: Race;
  courses: RaceCourse[];
  boats(): RemoteBoat[];
  me(): { x: number; y: number; sog: number; name: string; boatName: string; status: string };
  /** The route on the chart, which can be raced as it stands. */
  chartRoute(): RaceMark[];
}

/**
 * Who is on the water, and racing: call a race, join one, watch the countdown and the standings.
 * This is race management, not sailing. Nothing here steers or trims the boat.
 */
export class FleetPanel {
  private readonly el = document.getElementById('fleetpanel') as HTMLElement;
  private readonly bar = document.getElementById('racebar') as HTMLElement;
  private course = '';
  private minutes = 3;
  private pace = 2;
  private clock = 0;
  private drawn = '';

  constructor(private readonly ctx: FleetPanelContext) {
    this.course = ctx.courses[0]?.id ?? 'chart';
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.toggle(false); });
    this.bar.addEventListener('click', () => this.toggle(true));
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.isOpen): void {
    this.el.hidden = !open;
    if (open) this.render();
  }

  private onClick = (e: MouseEvent): void => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const d = b.dataset;
    const race = this.ctx.race;
    if (d.act === 'close') return this.toggle(false);
    if (d.course) this.course = d.course;
    else if (d.minutes) this.minutes = Number(d.minutes);
    else if (d.pace) this.pace = Number(d.pace);
    else if (d.join) {
      const offer = race.offers.get(d.join);
      if (offer) race.join(offer);
    } else if (d.act === 'leave') race.leave();
    else if (d.act === 'call') {
      const course = this.course === 'chart' ? { name: 'The route on the chart', marks: this.ctx.chartRoute() } : this.ctx.courses.find((c) => c.id === this.course);
      if (course && course.marks.length >= 2) race.callRace(course, this.minutes, this.pace);
    }
    this.render();
  };

  /** Once a frame. The bar under the clock always shows the race. The panel redraws once a second while open. */
  update(dt: number): void {
    const line = this.ctx.race.line();
    if (this.bar.textContent !== line) this.bar.textContent = line;
    this.bar.hidden = !line;
    if (!this.isOpen) return;
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 1;
      this.render();
    }
  }

  private roster(): string {
    const me = this.ctx.me();
    const rows = this.ctx.boats().map((b) => {
      const d = Math.hypot(b.x - me.x, b.y - me.y);
      const brg = deg3(Math.atan2(b.x - me.x, b.y - me.y));
      const doing = b.status || `${(b.sog / KT).toFixed(1)} kt`;
      return `<li><b>${esc(b.name || 'A skipper')}</b><span>${esc(b.boatName || 'Another boat')}</span><span>${esc(doing)}</span><span>${(d / 1852).toFixed(d < 1852 ? 2 : 1)} nm at ${brg}°</span></li>`;
    }).join('');
    const mine = `<li class="me"><b>${esc(me.name || 'You')}</b><span>${esc(me.boatName)}</span><span>${esc(me.status || `${(me.sog / KT).toFixed(1)} kt`)}</span><span>you</span></li>`;
    const alone = this.ctx.boats().length ? '' : '<p class="lede">Nobody else is out right now. Send someone the game link: anyone who opens it while you are sailing appears here, on your chart and on the water.</p>';
    return `<h3>On the water</h3><ul class="roster">${mine}${rows}</ul>${alone}`;
  }

  private setup(): string {
    const race = this.ctx.race;
    const offers = [...race.offers.values()].map((o) => `<div class="offer"><p><b>${esc(o.host)}</b> has called <b>${esc(o.name)}</b>. ${esc(String(o.marks.length))} marks, start at ${esc(o.marks[0].name)}.</p><button type="button" class="primary" data-join="${esc(o.id)}">Join</button></div>`).join('');
    const chart = this.ctx.chartRoute();
    const options = [...this.ctx.courses.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb })), ...(chart.length >= 2 ? [{ id: 'chart', name: 'The route on your chart', blurb: `${chart.length} marks, from ${chart[0].name} to ${chart[chart.length - 1].name}. Plan it on the chart (M), then race it.` }] : [])];
    const courses = options.map((c) => `<button type="button" class="course" data-course="${c.id}" aria-pressed="${c.id === this.course}"><b>${esc(c.name)}</b><span>${esc(c.blurb)}</span></button>`).join('');
    const chips = (label: string, key: string, values: number[], now: number, unit: string) => `<div class="chips"><span>${label}</span>${values.map((v) => `<button type="button" data-${key}="${v}" aria-pressed="${v === now}">${v}${unit}</button>`).join('')}</div>`;
    return `${offers}
      <h3>Call a race</h3>
      <div class="courses">${courses}</div>
      ${chips('Gun in', 'minutes', [2, 3, 5, 10], this.minutes, ' min')}
      ${chips('Pace boats', 'pace', [0, 1, 2, 3], this.pace, '')}
      <p class="lede">Everyone on the water is told and can join with R. Pace boats are sailed by the autopilot in the same boat as yours. The first mark is the start: be there at the gun and pass it after.</p>
      <button type="button" class="primary" data-act="call">Call the race</button>`;
  }

  private running(): string {
    const race = this.ctx.race;
    const call = race.call!;
    const me = this.ctx.me();
    const table = race.standings();
    const rows = table.map((s, i) => {
      const where = s.finish !== null ? clockText(s.finish) : !race.started ? `${(s.toGo / 1852).toFixed(2)} nm from the start` : `${esc(call.marks[s.leg]?.name ?? '')} in ${(s.toGo / 1852).toFixed(2)} nm`;
      return `<tr class="${s.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(s.name)}${s.pace ? ' <i>pace</i>' : ''}</td><td>${esc(s.boat)}</td><td>${s.finish !== null ? 'Finished' : `${s.leg} of ${call.marks.length}`}</td><td>${where}</td></tr>`;
    }).join('');
    const start = call.marks[0];
    const d = Math.hypot(start.x - me.x, start.y - me.y);
    const head = !race.started
      ? `<p class="count">${clockText(race.countdown)}</p><p class="lede">to the gun. Be at <b>${esc(start.name)}</b> (${(d / 1852).toFixed(2)} nm at ${deg3(Math.atan2(start.x - me.x, start.y - me.y))}°) when it goes, and pass it after. The course is on your chart, and the pilot will steer it (Shift+P to route, then P).</p>`
      : race.finish !== null
        ? `<p class="count">${clockText(race.finish)}</p><p class="lede">Your time. ${table.length > 1 ? `You placed ${race.place} of ${table.length}.` : ''}</p>`
        : `<p class="count">${clockText(race.elapsed)}</p><p class="lede">Racing. Next mark <b>${esc(race.nextMark?.name ?? '')}</b>.</p>`;
    return `<h3>${esc(call.name)}</h3>${head}
      <table><thead><tr><th></th><th>Skipper</th><th>Boat</th><th>Marks</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="lede">${esc(call.marks.map((m) => m.name).join(' → '))}</p>
      <button type="button" data-act="leave">${race.finish !== null ? 'Done' : 'Leave the race'}</button>`;
  }

  private render(): void {
    const html = `
      <header><h2>Fleet and racing</h2><button type="button" data-act="close" aria-label="Close">Close</button></header>
      <div class="fleet-body">${this.roster()}${this.ctx.race.call ? this.running() : this.setup()}</div>`;
    if (html === this.drawn) return;
    this.drawn = html;
    this.el.innerHTML = html;
  }
}
