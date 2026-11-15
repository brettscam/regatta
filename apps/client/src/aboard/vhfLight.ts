import type { AboardContext } from './feature';

/**
 * What the light needs to know from the radio (`radio.ts`). The radio does not offer this yet, so the light reads
 * what it can from the radio's `debug()` and is told about the ferries' calls by `tips.ts`. If the radio grows an
 * `onAir()` that returns this, the light uses it and the guesswork below goes unused.
 */
export interface OnAir {
  /** This boat is transmitting. */
  tx: boolean;
  /** The boats talking now: names, or ids. Only the number is used. */
  rx: string[];
  /** A ferry's or a ship's call is being spoken. */
  call: boolean;
  /** The ferries' and ships' calls are switched off (Shift+V). */
  quiet?: boolean;
}

interface RadioLike {
  onAir?(): OnAir;
  debug?(): { voice?: { state?(): { transmitting?: boolean } } | null; talkers?: string[] };
}

export interface VhfLightOptions {
  /** True where voice works: the website. */
  voice: boolean;
  /** True while a ferry's or ship's call is thought to be on the air. */
  calling(): boolean;
  /** The light was clicked: say what the radio is. */
  explain(): void;
}

/** Where the radio remembers that the ferries' calls are switched off. */
const TRAFFIC_KEY = 'regatta.radio.traffic';

/**
 * The radio's light: a small "VHF 16" with a V key cap on it, bottom left above the roadmap link, there the whole
 * sail so nobody can miss that the boat has a radio. The lamp lights amber while another boat or a ferry is on the
 * air and red while this boat transmits.
 *
 * Clicking it explains the radio. It never transmits: talking stays on the V key, since a sailing action has no
 * button. Where there is nothing to hear (no voice, and a water with no ferries) it is not shown at all.
 */
export class VhfLight {
  private readonly el = document.createElement('button');
  private readonly state = document.createElement('span');
  private key = '-';
  private clock = 1;

  constructor(private readonly ctx: AboardContext, private readonly opts: VhfLightOptions) {
    const el = this.el;
    el.type = 'button';
    el.className = 'hud vhf';
    const lamp = document.createElement('i');
    const name = document.createElement('b');
    name.textContent = 'VHF 16';
    const cap = document.createElement('kbd');
    cap.textContent = 'V';
    el.append(lamp, name, this.state, cap);
    el.addEventListener('click', () => {
      opts.explain();
      ctx.stage.canvas.focus();
    });
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) el.addEventListener(type, (e) => e.stopPropagation());
    el.hidden = true;
    document.body.appendChild(el);
  }

  update(dt: number): void {
    // Five times a second is plenty for a lamp.
    this.clock += dt;
    if (this.clock < 0.2) return;
    this.clock = 0;
    const here = this.opts.voice || this.ctx.stage.traffic.spec.routes.length > 0;
    if (this.el.hidden === here) this.el.hidden = !here;
    if (!here) return;
    const air = this.read();
    const kind = air.tx ? 'tx' : air.rx.length || air.call ? 'rx' : '';
    const word = air.tx ? 'TX' : kind === 'rx' ? 'RX' : air.quiet && !this.opts.voice ? 'calls off' : '';
    const key = `${kind}|${word}`;
    if (key === this.key) return;
    this.key = key;
    this.el.className = `hud vhf ${kind}`.trim();
    this.state.textContent = word;
    this.el.title = this.opts.voice
      ? 'The radio, channel 16. Hold V to talk to every boat on this water. Click to read about it'
      : 'The radio, channel 16. Ferries and ships call here. Click to read about it';
    this.el.setAttribute('aria-label', `${this.el.title}${word ? `. Now: ${word}` : ''}`);
  }

  dispose(): void {
    this.el.remove();
  }

  /** What is on the air: from the radio if it will say, or else worked out from what it shows for play testing. */
  private read(): OnAir {
    const radio = this.ctx.feature('radio') as unknown as RadioLike | undefined;
    let quiet = false;
    try {
      quiet = localStorage.getItem(TRAFFIC_KEY) === '0';
    } catch { /* no storage: the calls are on */ }
    const call = this.opts.calling() && !quiet;
    try {
      const told = radio?.onAir?.();
      if (told) return { tx: !!told.tx, rx: Array.isArray(told.rx) ? told.rx : [], call: !!told.call, quiet: told.quiet ?? quiet };
      const d = radio?.debug?.();
      return { tx: d?.voice?.state?.().transmitting === true, rx: Array.isArray(d?.talkers) ? d.talkers : [], call, quiet };
    } catch {
      return { tx: false, rx: [], call, quiet };
    }
  }
}
