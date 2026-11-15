import { BEAUFORT_WORDS, beaufort, compassPoint, compassWords } from '@slack-tide/nav';

const R2D = 180 / Math.PI;

// What she had to go by: a steering compass, a chronometer, the look of the water going past and the feel of the wind.
// No true wind in knots, no depth, no position. The same corner of the screen the Regatta instruments use, and the
// same clock, so the two ways of playing sit in the same places.

const DIAL = `
<svg viewBox="-56 -56 112 112" aria-hidden="true">
  <circle r="42" fill="rgba(9,18,24,0.35)" stroke="rgba(238,243,244,0.35)" stroke-width="1.2"/>
  <g stroke="rgba(238,243,244,0.45)" stroke-width="1.2">
    ${Array.from({ length: 16 }, (_, i) => `<line x1="0" y1="-42" x2="0" y2="${i % 4 === 0 ? -34 : -38}" transform="rotate(${i * 22.5})"/>`).join('')}
  </g>
  <path d="M0,-25 Q8.5,-9 7,6 Q5,19 0,24 Q-5,19 -7,6 Q-8.5,-9 0,-25 Z" fill="rgba(238,243,244,0.12)" stroke="rgba(238,243,244,0.8)" stroke-width="1.3"/>
  <g data-part="wind"><path d="M0,-30 L-7,-50 L7,-50 Z" fill="#ffc46b"/></g>
</svg>
<div class="legend"><span class="app">wind on the face</span></div>`;

export interface Reading {
  /** Compass heading, radians. */
  heading: number;
  /** Speed through the water as the helmsman judges it, knots, to the half knot. */
  judgedKt: number;
  /** Apparent wind angle, radians, positive on the starboard side. */
  awa: number;
  /** True wind direction (from), radians, and mean speed in knots: shown only as a point of the compass and a force in words. */
  twd: number;
  twsKt: number;
  /** What she is doing, in a word or two: Reaching, Hove to. */
  sailing: string;
  /** The sail she carries. */
  canvas: string;
  /** Who has the tiller and what he is steering. */
  helm: string;
  date: Date;
  timeZone: string;
  /** Days since she cast off, counting the first as 1. */
  day: number;
  /** What the clock is doing: `Real time`, `8× time`, `On watch`, `Paused`. */
  pace: string;
  fast: boolean;
  paused: boolean;
}

const half = (kt: number): string => {
  const whole = Math.floor(kt);
  const frac = kt - whole >= 0.5;
  return whole === 0 && frac ? '½' : `${whole}${frac ? '½' : ''}`;
};

export class PeriodHud {
  private readonly readout = document.getElementById('readout')!;
  private readonly clock = document.getElementById('clock')!;
  private readonly alarm = document.getElementById('alarm')!;
  private readonly tag = document.getElementById('tag')!;
  private readonly fps = document.getElementById('fps')!;
  private readonly cells = new Map<string, HTMLElement>();
  private readonly lines: Record<'sail' | 'wind' | 'helm', HTMLElement>;
  private readonly needle: SVGGElement;
  private readonly clockTime: HTMLElement;
  private readonly clockSub: HTMLElement;
  private readonly listeners = new AbortController();
  private readonly dayFmt = new Map<string, Intl.DateTimeFormat>();
  private alarmTimer = 0;
  private rateIndex = 0;
  private frames = 0;
  private fpsClock = 0;

  /** The clock was clicked. */
  onPause: () => void = () => {};
  /** The clock was dragged: a new index into the time rates. */
  onRate: (index: number) => void = () => {};

  constructor(private readonly rates: number) {
    const signal = this.listeners.signal;
    this.readout.innerHTML = '';
    this.readout.classList.remove('hidden');
    const dial = document.createElement('div');
    dial.className = 'dial';
    dial.innerHTML = DIAL;
    this.readout.appendChild(dial);
    this.needle = dial.querySelector('[data-part="wind"]') as SVGGElement;
    const cells = document.createElement('div');
    cells.className = 'cells period';
    this.readout.appendChild(cells);
    for (const [key, label, unit] of [['hdg', 'Compass', ''], ['spd', 'Speed, by eye', 'kt'], ['frc', 'Wind', '']]) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.innerHTML = `<span class="k">${label}</span><span class="v"><span></span><small>${unit}</small></span>`;
      cells.appendChild(cell);
      this.cells.set(key, cell.querySelector('.v > span') as HTMLElement);
      this.cells.set(`${key}.unit`, cell.querySelector('small') as HTMLElement);
    }
    const line = (cls: string) => {
      const el = document.createElement('div');
      el.className = cls;
      this.readout.appendChild(el);
      return el;
    };
    this.lines = { sail: line('sailline'), wind: line('tideline'), helm: line('pilotline') };
    this.readout.addEventListener('click', () => this.toggleReadout(), { signal });

    this.clock.innerHTML = '<div class="time"></div><div class="sub"></div>';
    this.clockTime = this.clock.querySelector('.time') as HTMLElement;
    this.clockSub = this.clock.querySelector('.sub') as HTMLElement;
    let startX = 0;
    let startIndex = 0;
    let moved = false;
    let down = false;
    this.clock.addEventListener('pointerdown', (e) => {
      down = true;
      moved = false;
      startX = e.clientX;
      startIndex = this.rateIndex;
      this.clock.setPointerCapture(e.pointerId);
    }, { signal });
    this.clock.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 6) moved = true;
      const next = Math.max(0, Math.min(this.rates - 1, startIndex + Math.round(dx / 34)));
      if (moved && next !== this.rateIndex) {
        this.rateIndex = next;
        this.onRate(next);
      }
    }, { signal });
    this.clock.addEventListener('pointerup', () => {
      if (down && !moved) this.onPause();
      down = false;
    }, { signal });
    this.clock.addEventListener('pointercancel', () => { down = false; }, { signal });
  }

  /** Take everything off the screen and let go of the clock, so another way of playing can have them. */
  dispose(): void {
    this.listeners.abort();
    this.readout.innerHTML = '';
    this.clock.innerHTML = '';
    this.clock.classList.remove('paused', 'fast');
    this.alarm.classList.remove('on');
    this.hideTag();
  }

  toggleReadout(): void {
    this.readout.classList.toggle('hidden');
  }

  get readoutHidden(): boolean {
    return this.readout.classList.contains('hidden');
  }

  toggleFps(): void {
    this.fps.hidden = !this.fps.hidden;
  }

  setRate(index: number): void {
    this.rateIndex = index;
  }

  private set(key: string, text: string): void {
    const el = this.cells.get(key)!;
    if (el.textContent !== text) el.textContent = text;
  }

  private html(el: HTMLElement, html: string): void {
    if (el.dataset.html === html) return;
    el.innerHTML = html;
    el.dataset.html = html;
  }

  update(r: Reading, dtReal: number): void {
    const deg = Math.round(((r.heading * R2D) % 360 + 360) % 360) % 360;
    this.set('hdg', `${String(deg).padStart(3, '0')}°`);
    this.set('hdg.unit', compassPoint(r.heading));
    this.set('spd', half(r.judgedKt));
    const force = beaufort(r.twsKt);
    this.set('frc', compassPoint(r.twd));
    this.set('frc.unit', `force ${force}`);
    this.needle.setAttribute('transform', `rotate(${(r.awa * R2D).toFixed(1)})`);
    this.html(this.lines.sail, `<b>${r.sailing}</b> · ${r.canvas}`);
    this.html(this.lines.wind, `<b>${BEAUFORT_WORDS[force]}</b> from the ${compassWords(r.twd)}`);
    this.html(this.lines.helm, r.helm);

    let fmt = this.dayFmt.get(r.timeZone);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-GB', { timeZone: r.timeZone, day: 'numeric', month: 'long' });
      this.dayFmt.set(r.timeZone, fmt);
    }
    const time = r.date.toLocaleTimeString('en-GB', { timeZone: r.timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
    if (this.clockTime.textContent !== time) this.clockTime.textContent = time;
    const sub = `${fmt.format(r.date)} · day ${r.day} · ${r.pace}`;
    if (this.clockSub.textContent !== sub) this.clockSub.textContent = sub;
    this.clock.classList.toggle('paused', r.paused);
    this.clock.classList.toggle('fast', r.fast);

    if (this.alarmTimer > 0) {
      this.alarmTimer -= dtReal;
      if (this.alarmTimer <= 0) this.alarm.classList.remove('on');
    }
    this.frames++;
    this.fpsClock += dtReal;
    if (this.fpsClock >= 0.5) {
      if (!this.fps.hidden) this.fps.textContent = `${Math.round(this.frames / this.fpsClock)} fps`;
      this.frames = 0;
      this.fpsClock = 0;
    }
  }

  raiseAlarm(text: string, seconds = 5): void {
    this.alarm.textContent = text;
    this.alarm.classList.add('on');
    this.alarmTimer = seconds;
  }

  showTag(x: number, y: number, label: string, value: string): void {
    const html = `${label}<b>${value}</b>`;
    if (this.tag.dataset.html !== html) {
      this.tag.innerHTML = html;
      this.tag.dataset.html = html;
    }
    const w = this.tag.offsetWidth;
    const left = Math.min(window.innerWidth - w - 8, x + 18);
    const top = Math.max(8, y - 38);
    this.tag.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    this.tag.classList.add('on');
  }

  hideTag(): void {
    this.tag.classList.remove('on');
  }
}
