import type { SimOutputs, SimState } from '@slack-tide/sim';

const R2D = 180 / Math.PI;
const KT = 0.514444;

export const TIME_RATES = [1, 2, 4, 8, 16, 32, 64];

/** What the water is doing at the boat. */
export interface TideNow {
  /** Direction the stream flows toward, radians clockwise from north. */
  set: number;
  /** Stream speed, m/s. */
  drift: number;
  /** Height of tide, metres. */
  height: number;
  /** Metres per hour, positive rising. */
  rate: number;
  /** Depth of water, metres, or null if unknown. */
  depth: number | null;
}

const DIAL = `
<svg viewBox="-56 -56 112 112" aria-hidden="true">
  <circle r="42" fill="rgba(9,18,24,0.35)" stroke="rgba(238,243,244,0.35)" stroke-width="1.2"/>
  <path d="M -32.2 -27 A 42 42 0 0 1 -17.7 -38.1" fill="none" stroke="#e0584a" stroke-width="4"/>
  <path d="M 17.7 -38.1 A 42 42 0 0 1 32.2 -27" fill="none" stroke="#45b97c" stroke-width="4"/>
  <g stroke="rgba(238,243,244,0.45)" stroke-width="1.2">
    ${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="-42" x2="0" y2="${i % 3 === 0 ? -35 : -38}" transform="rotate(${i * 30})"/>`).join('')}
  </g>
  <path d="M0,-24 Q10,-5 6.5,19 L-6.5,19 Q-10,-5 0,-24 Z" fill="rgba(238,243,244,0.12)" stroke="rgba(238,243,244,0.8)" stroke-width="1.3"/>
  <g data-part="tide"><line x1="0" y1="10" x2="0" y2="-12" stroke="#6cc0ff" stroke-width="2.6" stroke-linecap="round"/><path d="M0,-19 L-5,-10 L5,-10 Z" fill="#6cc0ff"/></g>
  <g data-part="true"><path d="M0,-33 L-6,-46 L6,-46 Z" fill="none" stroke="#eef3f4" stroke-width="1.6" stroke-linejoin="round"/></g>
  <g data-part="app"><path d="M0,-30 L-7,-50 L7,-50 Z" fill="#ffc46b"/></g>
</svg>
<div class="legend"><span class="app">app</span><span class="true">true</span><span class="tide">tide</span></div>`;

/** The few things allowed on the screen: one readout, the ship's clock, a line for alarms, and the pointer tag. */
export class Hud {
  private readonly readout = document.getElementById('readout')!;
  private readonly clock = document.getElementById('clock')!;
  private readonly alarm = document.getElementById('alarm')!;
  private readonly tag = document.getElementById('tag')!;
  private readonly fps = document.getElementById('fps')!;
  private readonly cells = new Map<string, HTMLElement>();
  private readonly needles: Record<string, SVGGElement> = {};
  private readonly tideLine: HTMLElement;
  private readonly pilotLine: HTMLElement;
  private readonly sailLine: HTMLElement;
  private readonly clockTime: HTMLElement;
  private readonly clockSub: HTMLElement;
  private alarmTimer = 0;
  private frames = 0;
  private fpsClock = 0;
  private worst = 0;

  /** Called when the player clicks the clock. */
  onPause: () => void = () => {};
  /** Called with a new index into TIME_RATES when the player drags the clock. */
  onRate: (index: number) => void = () => {};

  constructor() {
    // The wind vane: bow up, where the apparent and true wind come from, and which way the tide is setting her.
    const dial = document.createElement('div');
    dial.className = 'dial';
    dial.innerHTML = DIAL;
    this.readout.appendChild(dial);
    for (const g of dial.querySelectorAll<SVGGElement>('[data-part]')) this.needles[g.dataset.part!] = g;
    const cells = document.createElement('div');
    cells.className = 'cells';
    this.readout.appendChild(cells);
    this.sailLine = document.createElement('div');
    this.sailLine.className = 'sailline';
    this.readout.appendChild(this.sailLine);
    this.tideLine = document.createElement('div');
    this.tideLine.className = 'tideline';
    this.readout.appendChild(this.tideLine);
    this.pilotLine = document.createElement('div');
    this.pilotLine.className = 'pilotline';
    this.readout.appendChild(this.pilotLine);
    for (const [key, label, unit] of [
      ['spd', 'Speed', 'kt'], ['hdg', 'Heading', '°T'], ['dpt', 'Depth', 'm'],
      ['awa', 'App angle', ''], ['aws', 'App wind', 'kt'], ['tws', 'True wind', 'kt'],
    ]) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.innerHTML = `<span class="k">${label}</span><span class="v"><span></span><small>${unit}</small></span>`;
      cells.appendChild(cell);
      this.cells.set(key, cell.querySelector('.v > span') as HTMLElement);
    }
    this.readout.addEventListener('click', () => this.toggleReadout());

    this.clock.innerHTML = '<div class="time"></div><div class="sub"></div>';
    this.clockTime = this.clock.querySelector('.time') as HTMLElement;
    this.clockSub = this.clock.querySelector('.sub') as HTMLElement;
    this.bindClock();
  }

  toggleReadout(): void {
    this.readout.classList.toggle('hidden');
  }

  toggleFps(): void {
    this.fps.hidden = !this.fps.hidden;
  }

  private rateIndex = 0;

  /** Set the time rate shown, for when the game changes it itself. */
  setRate(index: number): void {
    this.rateIndex = index;
  }

  private bindClock(): void {
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
    });
    this.clock.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 6) moved = true;
      // Drag right to run time faster, left to slow it back to real time.
      const next = Math.max(0, Math.min(TIME_RATES.length - 1, startIndex + Math.round(dx / 34)));
      if (moved && next !== this.rateIndex) {
        this.rateIndex = next;
        this.onRate(next);
      }
    });
    this.clock.addEventListener('pointerup', () => {
      if (down && !moved) this.onPause();
      down = false;
    });
    this.clock.addEventListener('pointercancel', () => { down = false; });
  }

  private set(key: string, text: string): void {
    const el = this.cells.get(key)!;
    if (el.textContent !== text) el.textContent = text;
  }

  /** The point of sail and the tack, in words. */
  setSail(point: string, tack: string): void {
    const html = `<b>${point}</b>${tack}`;
    if (this.sailLine.dataset.html === html) return;
    this.sailLine.innerHTML = html;
    this.sailLine.dataset.html = html;
  }

  /** Who has the helm and the sheets, as a short line under the instruments. */
  setPilot(html: string): void {
    if (this.pilotLine.dataset.html === html) return;
    this.pilotLine.innerHTML = html;
    this.pilotLine.dataset.html = html;
  }

  get readoutHidden(): boolean {
    return this.readout.classList.contains('hidden');
  }

  update(state: SimState, out: SimOutputs, tide: TideNow, shipTime: Date, timeZone: string, paused: boolean, rate: number, dtReal: number, otherBoats = 0): void {
    this.set('spd', (out.sog / KT).toFixed(1));
    this.set('hdg', String(Math.round(state.heading * R2D) % 360).padStart(3, '0'));
    this.set('dpt', tide.depth === null ? '—' : tide.depth < 20 ? tide.depth.toFixed(1) : tide.depth.toFixed(0));
    this.needles.app.setAttribute('transform', `rotate(${(out.awa * R2D).toFixed(1)})`);
    this.needles.true.setAttribute('transform', `rotate(${(out.twa * R2D).toFixed(1)})`);
    const driftKt = tide.drift / KT;
    const tideG = this.needles.tide;
    tideG.style.opacity = driftKt < 0.1 ? '0.15' : '1';
    // Longer arrow for a stronger stream.
    const scale = Math.min(1.5, 0.55 + driftKt * 0.38);
    tideG.setAttribute('transform', `rotate(${((tide.set - state.heading) * R2D).toFixed(1)}) scale(${scale.toFixed(2)})`);
    const trend = Math.abs(tide.rate) < 0.04 ? 'standing' : tide.rate > 0 ? 'rising' : 'falling';
    const setDeg = String(Math.round((((tide.set * R2D) % 360) + 360) % 360) % 360).padStart(3, '0');
    const line = `Wind <b>${String(Math.round(out.twd * R2D) % 360).padStart(3, '0')}° ${(out.tws / KT).toFixed(0)} kt</b> · Tide <b>${tide.height >= 0 ? '+' : '−'}${Math.abs(tide.height).toFixed(1)} m ${trend}</b> · Stream <b>${driftKt < 0.1 ? 'slack' : `${driftKt.toFixed(1)} kt to ${setDeg}°`}</b>`;
    if (this.tideLine.dataset.html !== line) {
      this.tideLine.innerHTML = line;
      this.tideLine.dataset.html = line;
    }
    const awa = Math.round(Math.abs(out.awa) * R2D);
    this.set('awa', `${awa}° ${out.awa >= 0 ? 'S' : 'P'}`);
    this.set('aws', (out.aws / KT).toFixed(0));
    this.set('tws', (out.tws / KT).toFixed(0));

    const time = shipTime.toLocaleTimeString('en-GB', { timeZone, hour12: false });
    if (this.clockTime.textContent !== time) this.clockTime.textContent = time;
    const sub = otherBoats > 0 ? `Shared water · ${otherBoats + 1} boats` : paused ? 'Paused' : rate === 1 ? 'Real time' : `${rate}× time`;
    if (this.clockSub.textContent !== sub) this.clockSub.textContent = sub;
    this.clock.classList.toggle('paused', paused);
    this.clock.classList.toggle('fast', !paused && rate !== 1);

    if (this.alarmTimer > 0) {
      this.alarmTimer -= dtReal;
      if (this.alarmTimer <= 0) this.alarm.classList.remove('on');
    }

    this.frames++;
    this.fpsClock += dtReal;
    this.worst = Math.max(this.worst, dtReal);
    if (this.fpsClock >= 0.5) {
      if (!this.fps.hidden) this.fps.textContent = `${Math.round(this.frames / this.fpsClock)} fps · worst frame ${(this.worst * 1000).toFixed(0)} ms`;
      this.frames = 0;
      this.fpsClock = 0;
      this.worst = 0;
    }
  }

  /** A short line of text for something that needs the player. */
  raiseAlarm(text: string, seconds = 5): void {
    this.alarm.textContent = text;
    this.alarm.classList.add('on');
    this.alarmTimer = seconds;
  }

  /** Show the tag at the pointer with a part's name and the one number that matters. */
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
