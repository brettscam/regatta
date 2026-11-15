import { KT, R2D } from '@slack-tide/sim';
import type { RemoteBoat } from '../net/fleet';
import { alone as noHost, onWeb } from '../net/platform';
import { addEvent, eventLink, inText, isOpen, makeEvent, nextEvent, whenText, OPENS_BEFORE } from '../race/events';
import { classText, clockText, type Race, type RaceCourse, type RaceMark } from '../race/race';
import type { YardBoat } from '../boat/yard';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const deg3 = (rad: number) => String(Math.round(((rad * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');

export interface FleetPanelContext {
  race: Race;
  courses: RaceCourse[];
  boats(): RemoteBoat[];
  me(): { x: number; y: number; sog: number; name: string; boatName: string; status: string };
  /** The route on the chart, which can be raced as it stands. */
  chartRoute(): RaceMark[];
  /** The water being sailed: a course id. */
  water: string;
  /** The boats a race can be sailed in, in the picker's order, and the id of the player's own. */
  classes: YardBoat[];
  ownBoat: string;
}

/**
 * Who is on the water, and racing: call a race, join one, watch the countdown and the standings.
 * This is race management, not sailing. Nothing here steers or trims the boat.
 */
export class FleetPanel {
  private readonly el = document.getElementById('fleetpanel') as HTMLElement;
  private readonly bar = document.getElementById('racebar') as HTMLElement;
  private course = '';
  private minutes = 10;
  /** Pace boats asked for. Until the player chooses: two when alone, none with friends, since each player's pace boats sail a little differently. */
  private pace: number | null = null;
  /** The class chosen for a race called or fixed here. Until the player chooses: her own boat. */
  private cls: string | null = null;
  private clock = 0;
  /** The time typed for a race to be fixed at, as HH:MM, and a word on how that went. */
  private atTime = '';
  private fixNote = '';
  private parts: HTMLElement[] | null = null;
  private readonly shown: string[] = ['', '', ''];

  constructor(private readonly ctx: FleetPanelContext) {
    this.course = ctx.courses[0]?.id ?? 'chart';
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.toggle(false);
      // Typing a time is not sailing.
      e.stopPropagation();
    });
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'race-at') this.atTime = t.value;
    });
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
    if (d.act === 'fix') this.fix();
    else if (d.act === 'copylink') void this.copyLink();
    else if (d.course) this.course = d.course;
    else if (d.minutes) this.minutes = Number(d.minutes);
    else if (d.pace) this.pace = Number(d.pace);
    else if (d.cls) this.cls = d.cls;
    else if (d.join) {
      const offer = race.offers.get(d.join);
      if (offer) race.join(offer);
    } else if (d.act === 'leave') race.leave();
    else if (d.act === 'call') {
      const course = this.course === 'chart' ? { name: 'The route on the chart', marks: this.ctx.chartRoute() } : this.ctx.courses.find((c) => c.id === this.course);
      if (course && course.marks.length >= 2) race.callRace(course, this.minutes, this.paceNow(), this.clsNow());
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

  /** Fix a race for a time on the clock. It goes on this page's address, so the address is the invitation. */
  private fix(): void {
    const m = /^(\d{1,2}):(\d{2})$/.exec(this.atTime);
    if (!m) { this.fixNote = 'Type the time for the gun first, like 19:30.'; return; }
    if (this.course === 'chart') { this.fixNote = 'A race fixed for later needs one of the named courses.'; return; }
    const at = new Date();
    at.setHours(Number(m[1]), Number(m[2]), 0, 0);
    // A time already gone today means tomorrow.
    if (at.getTime() < Date.now() + 60e3) at.setDate(at.getDate() + 1);
    const me = this.ctx.me().name.trim();
    const event = makeEvent(this.ctx.water, this.course, at.getTime(), me ? `${me}'s race` : 'Race', this.clsNow());
    addEvent(event);
    try {
      if (onWeb()) history.replaceState(null, '', eventLink(event));
    } catch { /* the address stays as it was; the link below still works */ }
    this.fixNote = '';
  }

  private async copyLink(): Promise<void> {
    const event = nextEvent();
    if (!event) return;
    try {
      await navigator.clipboard.writeText(eventLink(event));
      this.fixNote = 'Link copied. Send it to whoever is racing.';
    } catch {
      this.fixNote = 'Copying is blocked here. Select the link and copy it by hand.';
    }
  }

  private paceNow(): number {
    return this.pace ?? (this.ctx.boats().length ? 0 : 2);
  }

  private clsNow(): string {
    return this.cls ?? this.ctx.ownBoat;
  }

  /** The class of a race, in words for the middle of a sentence: " in 38 ft sloops", or nothing when everyone sails her own boat. */
  private inClass(cls: string | undefined): string {
    const boat = this.ctx.classes.find((b) => b.id === cls);
    return boat ? `, everyone in ${classText(boat)}` : '';
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
    const alone = this.ctx.boats().length ? ''
      : noHost() ? '<p class="lede">Sailing in company is not available in this copy of the game. It works on the website and on the shared page.</p>'
        : '<p class="lede">Nobody else is out right now. Send someone the game link: anyone who opens it while you are sailing appears here, on your chart and on the water.</p>';
    return `<h3>On the water</h3><ul class="roster">${mine}${rows}</ul>${alone}`;
  }

  /** With no race on: what is on offer (which can change by itself), and the form for calling one (which only changes when touched). */
  private setup(): { live: string; form: string } {
    const race = this.ctx.race;
    const offers = [...race.offers.values()].map((o) => `<div class="offer"><p><b>${esc(o.host)}</b> has called <b>${esc(o.name)}</b>. ${esc(String(o.marks.length))} marks, start at ${esc(o.marks[0].name)}${esc(this.inClass(o.cls))}.</p><button type="button" class="primary" data-join="${esc(o.id)}">Join</button></div>`).join('');
    const chart = this.ctx.chartRoute();
    const options = [...this.ctx.courses.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb })), ...(chart.length >= 2 ? [{ id: 'chart', name: 'The route on your chart', blurb: `${chart.length} marks, from ${chart[0].name} to ${chart[chart.length - 1].name}. Plan it on the chart (M), then race it.` }] : [])];
    const courses = options.map((c) => `<button type="button" class="course" data-course="${c.id}" aria-pressed="${c.id === this.course}"><b>${esc(c.name)}</b><span>${esc(c.blurb)}</span></button>`).join('');
    const own = this.ctx.classes.find((b) => b.id === this.clsNow()) ?? this.ctx.classes[0];
    const chips = (label: string, key: string, values: number[], now: number, unit: string) => `<div class="chips"><span>${label}</span>${values.map((v) => `<button type="button" data-${key}="${v}" aria-pressed="${v === now}">${v}${unit}</button>`).join('')}</div>`;
    // A race fixed for later: say when, where to be, and when it opens.
    const event = nextEvent();
    const evCourse = event && this.ctx.courses.find((c) => c.id === event.course);
    // A race a player fixed carries a link to send. The game's own calendar races do not need one.
    const invite = event && event.id.startsWith('r-')
      ? (onWeb()
        ? `<div class="invite"><input type="text" readonly aria-label="Link to this race" value="${esc(eventLink(event))}"><button type="button" class="primary" data-act="copylink">Copy link</button></div><p class="lede">Send this link. Whoever opens it gets this race on the way in. Boats already on the water with you are told as well.</p>`
        : '<p class="lede">Everyone on the water with you is told. A link to send only works on bajaregatta.com.</p>')
      : '';
    const fixed = event && evCourse
      ? `<div class="offer fixed"><p><b>${esc(event.name)}</b>: ${esc(evCourse.name)}${esc(this.inClass(event.cls))}. The gun goes at <b>${esc(whenText(event))}</b>, ${esc(inText(event))}. ${isOpen(event) ? 'It is open: join below.' : `It opens for joining here ${OPENS_BEFORE} minutes before, and joining tows you to the start.`}</p>${invite}</div>`
      : '';
    return { live: `${fixed}${offers}`, form: `
      <h3>Call a race</h3>
      <div class="courses">${courses}</div>
      <div class="chips"><span>Class</span>${this.ctx.classes.map((b) => `<button type="button" data-cls="${esc(b.id)}" aria-pressed="${b.id === this.clsNow()}" title="${esc(b.name)}">${esc(b.lengthFt ? `${b.lengthFt} ft` : b.name)}</button>`).join('')}</div>
      <p class="lede">One design: everyone who joins races the ${esc(own.name)}, whatever boat she came in, and has her own back afterwards.</p>
      ${chips('Gun in', 'minutes', [3, 5, 10, 15, 20], this.minutes, ' min')}
      ${chips('Pace boats', 'pace', [0, 1, 2, 3], this.paceNow(), '')}
      <p class="lede">${noHost() ? 'In this copy of the game other people cannot join a race, so you race the pace boats.' : 'Everyone on the water is told and can join with R.'} Pace boats are sailed by the autopilot in the race's class; with friends racing, leave them at 0 so everyone sees the same race. The first mark is the start: be there at the gun and pass it after.</p>
      <button type="button" class="primary" data-act="call">Call the race</button>
      <h3>Or fix a time and send a link</h3>
      <div class="fixrow"><label for="race-at">Gun at</label><input id="race-at" type="time" value="${esc(this.atTime)}"><button type="button" data-act="fix">Fix the race</button></div>
      <p class="lede">For a race later today: choose the course above, type the time, and you get a link to send. It opens for joining ${OPENS_BEFORE} minutes before the gun.</p>
      ${this.fixNote ? `<p class="lede note">${esc(this.fixNote)}</p>` : ''}` };
  }

  /** In a race: the clock and the standings, which tick, and the way out, which does not. */
  private running(): { live: string; form: string } {
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
    const cls = race.classOf(call);
    return { live: `<h3>${esc(call.name)}${cls ? ` · one design, ${esc(cls.name)}` : ''}</h3>${head}
      <table><thead><tr><th></th><th>Skipper</th><th>Boat</th><th>Marks</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="lede">${esc(call.marks.map((m) => m.name).join(' → '))}</p>`, form: `<button type="button" data-act="leave">${race.finish !== null ? 'Done' : 'Leave the race'}</button>` };
  }

  /**
   * The panel is three parts, each redrawn only when its own words change. The roster and the race clock tick every second;
   * the form does not, so a list being scrolled or a button being pressed is never replaced under the pointer.
   */
  private render(): void {
    if (!this.parts) {
      this.el.innerHTML = '<header><h2>Fleet and racing</h2><button type="button" data-act="close" aria-label="Close">Close</button></header><div class="fleet-body"><div class="part"></div><div class="part"></div><div class="part"></div></div>';
      this.parts = [...this.el.querySelectorAll<HTMLElement>('.part')];
    }
    const race = this.ctx.race.call ? this.running() : this.setup();
    const html = [this.roster(), race.live, race.form];
    html.forEach((h, i) => {
      if (this.shown[i] === h) return;
      this.shown[i] = h;
      this.parts![i].innerHTML = h;
    });
  }
}
