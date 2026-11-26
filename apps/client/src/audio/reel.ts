import type { Sound } from './sound';

/**
 * A fishing reel: the ratchet screaming as a fish takes line, and the slower tick of winding it back.
 * Made from one square wave through a filter, joined to the game's sound where `Sound.output()` gives it.
 * Silent until the player has touched the page, like everything else.
 */
export class ReelSound {
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private ctx: AudioContext | null = null;

  constructor(private readonly sound: Sound) {}

  private start(): boolean {
    if (this.osc) return true;
    const out = this.sound.output();
    if (!out) return false;
    this.ctx = out.ctx;
    this.osc = out.ctx.createOscillator();
    this.osc.type = 'square';
    this.osc.frequency.value = 40;
    const click = out.ctx.createBiquadFilter();
    click.type = 'highpass';
    click.frequency.value = 1800;
    this.gain = out.ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(click).connect(this.gain).connect(out.node);
    this.osc.start();
    return true;
  }

  /**
   * @param out how fast line is going out, 0 to 1: the scream
   * @param winding the angler is winding
   */
  set(out: number, winding: boolean): void {
    if (out <= 0.02 && !winding && !this.osc) return;
    if (!this.start() || !this.ctx || !this.osc || !this.gain) return;
    const t = this.ctx.currentTime;
    const run = Math.min(1, Math.max(0, out));
    this.osc.frequency.setTargetAtTime(run > 0.02 ? 60 + 260 * run : 14, t, 0.05);
    this.gain.gain.setTargetAtTime(run > 0.02 ? 0.05 + 0.09 * run : winding ? 0.035 : 0, t, 0.04);
  }

  dispose(): void {
    try {
      this.osc?.stop();
      this.osc?.disconnect();
      this.gain?.disconnect();
    } catch { /* already stopped */ }
    this.osc = null;
    this.gain = null;
  }
}
