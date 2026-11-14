import type { AboardContext, Feature } from './feature';

const ROWS: Array<[string[], string]> = [
  [['A', 'D'], 'steer'],
  [['W', 'S'], 'mainsail in, out'],
  [['Q', 'E'], 'jib in, out'],
  [['T'], 'tack'],
  [['P'], 'autopilot'],
  [['R'], 'race'],
  [['B'], 'all keys'],
];

/**
 * The handful of keys a newcomer needs, across the top of the screen for the first minute of a sail.
 * It is a reminder, not a control: nothing on it can be pressed. The / key brings it back or puts it away.
 */
export class CheatStrip implements Feature {
  readonly id = 'cheat';
  private readonly el = document.createElement('aside');
  private left = 75;
  private shown = false;

  constructor(private readonly ctx: AboardContext) {
    this.el.className = 'hud cheat';
    this.el.setAttribute('aria-label', 'The main keys');
    this.el.innerHTML = `${ROWS.map(([keys, what]) => `<span>${keys.map((k) => `<kbd>${k}</kbd>`).join('')}${what}</span>`).join('')}<span class="more"><kbd>/</kbd>hide</span>`;
    this.el.hidden = true;
    document.body.appendChild(this.el);
    void this.ctx;
  }

  key(code: string): boolean {
    if (code !== 'Slash') return false;
    this.show(!this.shown, 600);
    return true;
  }

  private show(on: boolean, seconds: number): void {
    this.shown = on;
    this.left = seconds;
    this.el.hidden = !on;
  }

  update(dt: number): void {
    // Wait for the first lesson, if there is one, to be out of the way.
    const lesson = document.getElementById('coach');
    if (!this.shown && this.left === 75 && (!lesson || lesson.hidden)) this.show(true, 75);
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
