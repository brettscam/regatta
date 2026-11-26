import { KT, R2D } from '@slack-tide/sim';
import type { RemoteBoat } from '../net/fleet';
import { alone as noHost, onWeb } from '../net/platform';
import { addEvent, eventLink, inText, isOpen, makeEvent, nextEvent, whenText, OPENS_BEFORE } from '../race/events';
import { MIXES, type Mix } from '../race/cast';
import { classText, clockText, type Race, type RaceCourse, type RaceMark } from '../race/race';
import { HOW_A_RACE_WORKS, RING, marginText, shortRange } from '../race/startline';
import type { YardBoat } from '../boat/yard';
import { damageNote } from '../aboard/contactRules';
import { resultsTable, rosterCards } from './racecards';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const HOW = `<h3>How a race works</h3><p class="lede">${HOW_A_RACE_WORKS.join(' ')}</p>`;
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
  /** Pace boats asked for. Until the player chooses: five when alone, none with friends, since each player's pace boats sail a little differently. */
  private pace: number | null = null;
  /** What sort of club fleet they are. The beer can league unless she asks for better. */
  private mix: Mix = 'beer';
  /** The class chosen for a race called or fixed here. Until the player chooses: her own boat. */
  private cls: string | null = null;
  private clock = 0;
  /** Race now (a countdown) or later (a fixed time with a link to send). */
  private when: 'now' | 'later' = 'now';
  /** For later: the gun time picked by a quick choice, in ms; or a typed time and which day. */
  private laterAt: number | null = null;
  private atTime = '';
  private atDay: 0 | 1 = 0;
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
      if (t.id === 'race-at') { this.atTime = t.value; this.laterAt = null; this.fixNote = ''; }
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
    else if (d.when) { this.when = d.when === 'later' ? 'later' : 'now'; this.fixNote = ''; }
    else if (d.later) { this.laterAt = Number(d.later); this.atTime = ''; this.fixNote = ''; }
    else if (d.day) { this.atDay = d.day === '1' ? 1 : 0; this.laterAt = null; }
    else if (d.minutes) this.minutes = Number(d.minutes);
    else if (d.pace) this.pace = Number(d.pace);
    else if (d.mix) this.mix = MIXES.find((m) => m.id === d.mix)?.id ?? 'beer';
    else if (d.cls) this.cls = d.cls;
    else if (d.join) {
      const offer = race.offers.get(d.join);
      if (offer) race.join(offer);
    } else if (d.act === 'leave') race.leave();
    else if (d.act === 'call') {
      const course = this.course === 'chart' ? { name: 'The route on the chart', marks: this.ctx.chartRoute() } : this.ctx.courses.find((c) => c.id === this.course);
      if (course && course.marks.length >= 2) race.callRace(course, this.minutes, this.paceNow(), this.clsNow(), this.mix);
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
    const at = this.laterGun();
    if (at === null) { this.fixNote = 'Pick a time for the gun: one of the quick choices, or type one.'; return; }
    if (this.course === 'chart') { this.fixNote = 'A race fixed for later needs one of the named courses, so everyone sails the same marks.'; return; }
    if (at < Date.now() + 60e3) { this.fixNote = 'That time has already gone. Pick a later one.'; return; }
    const me = this.ctx.me().name.trim();
    const event = makeEvent(this.ctx.water, this.course, at, me ? `${me}'s race` : 'Race', this.clsNow());
    addEvent(event);
    try {
      if (onWeb()) history.replaceState(null, '', eventLink(event));
    } catch { /* the address stays as it was; the link below still works */ }
    this.fixNote = '';
    this.laterAt = null;
  }

  /** The gun time chosen for a race later, in ms, or null if none is chosen yet. */
  private laterGun(): number | null {
    if (this.laterAt !== null) return this.laterAt;
    const m = /^(\d{1,2}):(\d{2})$/.exec(this.atTime);
    if (!m) return null;
    const at = new Date();
    at.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (this.atDay === 1) at.setDate(at.getDate() + 1);
    return at.getTime();
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
    return this.pace ?? (this.ctx.boats().length ? 0 : 5);
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
      // What she is doing, and the state of her hull if it is not sound. Both are her own page's word.
      const hull = damageNote(b.damage);
      const doing = b.damage >= 100 ? hull : [b.status || `${(b.sog / KT).toFixed(1)} kt`, hull].filter(Boolean).join(' · ');
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
    const options = [...this.ctx.courses.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb, marks: c.marks })), ...(chart.length >= 2 ? [{ id: 'chart', name: 'The route on your chart', blurb: `From ${chart[0].name} to ${chart[chart.length - 1].name}. Plan it on the chart (M), then race it.`, marks: chart }] : [])];
    const courses = options.map((c) => `<button type="button" class="course" data-course="${c.id}" aria-pressed="${c.id === this.course}"><b>${esc(c.name)}<em>${esc(courseSize(c.marks))}</em></b><span>${esc(c.blurb)}</span></button>`).join('');
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
    const picked = options.find((c) => c.id === this.course) ?? options[0];
    const gun = this.laterGun();
    const quick = laterChoices();
    const whenPart = this.when === 'now'
      ? chips('Gun in', 'minutes', [3, 5, 10, 15, 20], this.minutes, ' min')
      : `<div class="chips"><span>Gun at</span>${quick.map((q) => `<button type="button" data-later="${q.at}" aria-pressed="${this.laterAt === q.at}">${esc(q.label)}</button>`).join('')}</div>
         <div class="fixrow"><span>Or</span><button type="button" data-day="0" aria-pressed="${this.laterAt === null && this.atDay === 0}">Today</button><button type="button" data-day="1" aria-pressed="${this.laterAt === null && this.atDay === 1}">Tomorrow</button><label class="sr" for="race-at">Time</label><input id="race-at" type="time" step="300" value="${esc(this.atTime)}"></div>`;
    const action = this.when === 'now'
      ? `<button type="button" class="primary go" data-act="call">Call the race: gun in ${this.minutes} min</button>`
      : `<button type="button" class="primary go" data-act="fix" ${gun === null ? 'aria-disabled="true"' : ''}>${gun === null ? 'Pick a time for the gun' : `Fix the race for ${esc(clockAt(gun))} and get the link`}</button>`;
    return { live: `${fixed}${offers}`, form: `
      <h3>1 · Course</h3>
      <div class="courses">${courses}</div>
      <h3>2 · When</h3>
      <div class="chips seg"><button type="button" data-when="now" aria-pressed="${this.when === 'now'}">Now</button><button type="button" data-when="later" aria-pressed="${this.when === 'later'}">Later, with a link to send</button></div>
      ${whenPart}
      ${this.when === 'later' ? `<p class="lede">The race opens for joining ${OPENS_BEFORE} minutes before the gun. Times are your own clock's.</p>` : ''}
      <h3>3 · Boats</h3>
      <div class="chips"><span>Class</span>${this.ctx.classes.map((b) => `<button type="button" data-cls="${esc(b.id)}" aria-pressed="${b.id === this.clsNow()}" title="${esc(b.name)}">${esc(b.lengthFt ? `${b.lengthFt} ft` : b.name)}</button>`).join('')}</div>
      <p class="lede">One design: everyone who joins races the ${esc(own.name)}, whatever boat she came in, and has her own back afterwards.</p>
      ${chips('Club boats', 'pace', [0, 1, 2, 3, 5, 7, 9], this.paceNow(), '')}
      ${this.paceNow() > 0 ? `<div class="chips"><span>Fleet</span>${MIXES.map((m) => `<button type="button" data-mix="${m.id}" aria-pressed="${m.id === this.mix}" title="${esc(m.says)}">${esc(m.name)}</button>`).join('')}</div>
      <p class="lede">${esc(MIXES.find((m) => m.id === this.mix)?.says ?? '')}.</p>` : ''}
      <div class="go-bar"><p class="lede">${esc(picked ? picked.name : 'No course')}${this.when === 'now' ? `, gun in ${this.minutes} min` : gun !== null ? `, gun at ${esc(clockAt(gun))}` : ''}${this.paceNow() ? `, ${this.paceNow()} club boat${this.paceNow() > 1 ? 's' : ''}` : ''}</p>${action}</div>
      ${this.fixNote ? `<p class="lede note">${esc(this.fixNote)}</p>` : ''}
      <p class="lede">${noHost() ? 'In this copy of the game other people cannot join a race, so you race the club boats.' : 'Everyone on the water is told and can join with R.'} Club boats are the yacht club's own skippers, sailed by the autopilot in the race's class. Each player's page sails them itself, so with friends racing their places can differ a little from page to page.</p>
      ${HOW}
      ${document.getElementById('fishcard') ? '<h3>Fishing tournaments</h3><p class="lede">This water has fishing tournaments too: most points, biggest fish, a jackpot. Press <b>Shift+L</b> for the fishing card to call one or join one.</p>' : '' /* fishing: the card is `ui/fishcard.ts` */}` };
  }

  /** In a race: the clock and the standings, which tick, and the way out, which does not. */
  private running(): { live: string; form: string } {
    const race = this.ctx.race;
    const call = race.call!;
    const me = this.ctx.me();
    const table = race.standings();
    const start = call.marks[0];
    const pre = race.preStart();
    const head = pre
      ? `<p class="count">${clockText(race.countdown)}</p><p class="lede">to the gun. ${pre.state === 'inside'
        ? `You are in the start ring round <b>${esc(start.name)}</b>: stay in it or close by, and you start as the gun goes.`
        : `The start ring round <b>${esc(start.name)}</b> is ${esc(shortRange(pre.dist))} off at ${deg3(Math.atan2(start.x - me.x, start.y - me.y))}°, and at this speed you are <b>${esc(marginText(pre))}</b>. Be inside it when the gun goes, or sail into it after.`} The way to it is on your chart and on the water. The course goes on the chart at the gun, and the pilot will steer it (Shift+P to route, then P).</p>`
      : race.finish !== null
        ? `<p class="count">${clockText(race.finish)}</p><p class="lede">Your time. ${table.length > 1 ? `You placed ${table.findIndex((r) => r.me) + 1} of ${table.filter((r) => !r.retired).length}.` : ''}${table.some((r) => r.finish === null && !r.retired) ? ' The boats still out are sailing on to the finish: their times go in as they cross.' : ''}</p>`
        : `<p class="count">${clockText(race.elapsed)}</p><p class="lede">Racing. ${race.leg === 0 ? 'Sail into the start ring round' : 'Next ring:'} <b>${esc(race.nextMark?.name ?? '')}</b>, ${esc(shortRange(Math.max(0, race.toGo - RING)))}.</p>`;
    const cls = race.classOf(call);
    return { live: `<h3>${esc(call.name)}${cls ? ` · one design, ${esc(cls.name)}` : ''}</h3>${head}
      ${race.finish !== null ? `<h3>Results</h3>${resultsTable(table, call.marks.length)}` : ''}
      <h3>${race.finish !== null ? 'The fleet' : pre ? `On the line: ${table.length} ${table.length === 1 ? 'boat' : 'boats'}` : 'The race'}</h3>
      ${rosterCards(table, race.started, call.marks.length)}
      <p class="lede">${esc(call.marks.map((m) => m.name).join(' → '))}</p>`, form: `<button type="button" data-act="leave">${race.finish !== null ? 'Done' : 'Leave the race'}</button>${race.finish !== null ? '' : HOW}` };
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

/** A course's length and marks, in a few words: "8.2 nm · 4 marks". */
function courseSize(marks: ReadonlyArray<{ x: number; y: number }>): string {
  let m = 0;
  for (let i = 1; i < marks.length; i++) m += Math.hypot(marks[i].x - marks[i - 1].x, marks[i].y - marks[i - 1].y);
  return `${(m / 1852).toFixed(m < 18520 ? 1 : 0)} nm · ${marks.length} marks`;
}

/** A gun time on the player's own clock: "7:30 PM", with the day when it is not today. */
function clockAt(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return time;
  if (d.toDateString() === tomorrow.toDateString()) return `${time} tomorrow`;
  return `${time} ${d.toLocaleDateString([], { weekday: 'short' })}`;
}

/** One-tap gun times for a race later: in half an hour and an hour (to the next five minutes), this evening, and tomorrow evening. */
function laterChoices(now = Date.now()): Array<{ label: string; at: number }> {
  const five = (ms: number) => Math.ceil(ms / 300e3) * 300e3;
  const out: Array<{ label: string; at: number }> = [
    { label: 'In 30 min', at: five(now + 30 * 60e3) },
    { label: 'In 1 hour', at: five(now + 60 * 60e3) },
  ];
  const evening = new Date(now);
  evening.setHours(19, 30, 0, 0);
  if (evening.getTime() > now + 75 * 60e3) out.push({ label: `Tonight ${clockAt(evening.getTime())}`, at: evening.getTime() });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);
  out.push({ label: `Tomorrow ${tomorrow.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, at: tomorrow.getTime() });
  return out;
}
