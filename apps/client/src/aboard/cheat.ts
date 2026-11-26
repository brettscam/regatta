import { STRIPS, stripContext, type StripContext } from '../data/keys';
import type { AboardContext, Feature } from './feature';

/** Seconds the strip stays up at the start of a sail, when she first does something new, and when asked for. */
const FIRST = 75;
const CHANGE = 25;
const ASKED = 600;

/**
 * The handful of keys that matter now, across the top of the screen: for the first minute of a sail, and again for
 * a short while the first time she does something with keys of its own (a race, lying at anchor, the kayak).
 * It is a reminder, not a control: nothing on it can be pressed. The / key brings it back or puts it away.
 * The rows are data, in `data/keys.ts`.
 */
export class CheatStrip implements Feature {
  readonly id = 'cheat';
  private readonly el = document.createElement('aside');
  private left = FIRST;
  private shown = false;
  private begun = false;
  private context: StripContext = 'sailing';
  private readonly met = new Set<StripContext>(['sailing']);
  private clock = 0;

  constructor(private readonly ctx: AboardContext) {
    this.el.className = 'hud cheat';
    this.el.setAttribute('aria-label', 'The main keys');
    this.el.hidden = true;
    this.draw();
    document.body.appendChild(this.el);
  }

  key(code: string): boolean {
    if (code !== 'Slash') return false;
    this.begun = true;
    this.show(!this.shown, ASKED);
    return true;
  }

  private draw(): void {
    this.el.innerHTML = `${STRIPS[this.context].map(([keys, what]) => `<span>${keys.map((k) => `<kbd>${k}</kbd>`).join('')}${what}</span>`).join('')}<span class="more"><kbd>/</kbd>hide</span>`;
  }

  private show(on: boolean, seconds: number): void {
    this.shown = on;
    this.left = seconds;
    this.el.hidden = !on;
  }

  /** What she is doing now, looked at twice a second. */
  private look(): void {
    const { sim, race } = this.ctx;
    const context = stripContext({
      away: !!this.ctx.feature('kayak')?.focus?.(),
      diving: !!this.ctx.feature('dive')?.focus?.(),
      racing: !!race && race.call !== null && race.finish === null,
      held: sim.state.hold !== 'none',
    });
    if (context === this.context) return;
    this.context = context;
    this.draw();
    // The first time on this sail, the new keys are put in front of her for a little while.
    if (this.met.has(context)) return;
    this.met.add(context);
    if (!this.shown || this.left < CHANGE) this.show(true, CHANGE);
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.clock >= 0.5) {
      this.clock = 0;
      this.look();
    }
    // Wait for the first lesson, if there is one, to be out of the way.
    const lesson = document.getElementById('coach');
    if (!this.begun && (!lesson || lesson.hidden)) {
      this.begun = true;
      this.show(true, FIRST);
    }
    if (!this.shown) return;
    this.left -= dt;
    if (this.left <= 0) {
      this.show(false, 0);
      this.ctx.say('Press / to see the main keys again, or B for all of them', 6);
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
