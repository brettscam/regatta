import type { SimOutputs, SimState } from '@slack-tide/sim';

const R2D = 180 / Math.PI;
const KT = 0.514444;

export const TIME_RATES = [1, 2, 4, 8, 16, 32];

/** The few things allowed on the screen: one readout, the ship's clock, a line for alarms, and the pointer tag. */
export class Hud {
  private readonly readout = document.getElementById('readout')!;
  private readonly clock = document.getElementById('clock')!;
  private readonly alarm = document.getElementById('alarm')!;
  private readonly tag = document.getElementById('tag')!;
  private readonly fps = document.getElementById('fps')!;
  private readonly cells = new Map<string, HTMLElement>();
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
    for (const [key, label, unit] of [
      ['spd', 'Speed', 'kt'], ['hdg', 'Heading', '°T'], ['dpt', 'Depth', 'm'],
      ['awa', 'App angle', ''], ['aws', 'App wind', 'kt'], ['tws', 'True wind', 'kt'],
    ]) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.innerHTML = `<span class="k">${label}</span><span class="v"><span></span><small>${unit}</small></span>`;
      this.readout.appendChild(cell);
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

  private bindClock(): void {
    let startX = 0;
    let startIndex = 0;
    let moved = false;
    let down = false;
    let index = 0;
    this.clock.addEventListener('pointerdown', (e) => {
      down = true;
      moved = false;
      startX = e.clientX;
      startIndex = index;
      this.clock.setPointerCapture(e.pointerId);
    });
    this.clock.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 6) moved = true;
      // Drag right to run time faster, left to slow it back to real time.
      const next = Math.max(0, Math.min(TIME_RATES.length - 1, startIndex + Math.round(dx / 34)));
      if (moved && next !== index) {
        index = next;
        this.onRate(index);
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

  update(state: SimState, out: SimOutputs, shipTime: Date, timeZone: string, paused: boolean, rate: number, dtReal: number): void {
    this.set('spd', (out.sog / KT).toFixed(1));
    this.set('hdg', String(Math.round(state.heading * R2D) % 360).padStart(3, '0'));
    this.set('dpt', '—');
    const awa = Math.round(Math.abs(out.awa) * R2D);
    this.set('awa', `${awa}° ${out.awa >= 0 ? 'S' : 'P'}`);
    this.set('aws', (out.aws / KT).toFixed(0));
    this.set('tws', (out.tws / KT).toFixed(0));

    const time = shipTime.toLocaleTimeString('en-GB', { timeZone, hour12: false });
    if (this.clockTime.textContent !== time) this.clockTime.textContent = time;
    const sub = paused ? 'Paused' : rate === 1 ? 'Real time' : `${rate}× time`;
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
