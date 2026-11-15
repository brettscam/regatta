/**
 * The sound of a marine VHF set, made in Web Audio with no audio files.
 *
 * Whatever is connected to `input` (other boats' voices) comes out the way a small loudspeaker on channel 16 gives it:
 * only the band from about 300 Hz to 3 kHz, squeezed by a compressor and a little overdriven. While somebody is on
 * the air there is a bed of static under them. `open` is the click as the squelch lifts, `close` the short rush of
 * noise as it shuts again. Everything ends at the node handed in, which is the game's master volume, so the radio is
 * as loud or as quiet as the rest of the game.
 */
export class Vhf {
  /** Connect received voices here. */
  readonly input: GainNode;
  private readonly hiss: GainNode;
  private readonly gate: GainNode;
  private readonly noise: AudioBuffer;
  private isOpen = false;

  constructor(readonly ctx: AudioContext, private readonly out: AudioNode) {
    this.input = ctx.createGain();
    this.noise = this.makeNoise(2);

    const filter = (type: BiquadFilterType, hz: number, q = 0.71): BiquadFilterNode => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      return f;
    };
    // Two high-passes and two low-passes: about 24 dB an octave each side of the voice band.
    const drive = ctx.createWaveShaper();
    drive.curve = this.softClip(2.2);
    const squeeze = ctx.createDynamicsCompressor();
    squeeze.threshold.value = -30;
    squeeze.knee.value = 8;
    squeeze.ratio.value = 6;
    squeeze.attack.value = 0.004;
    squeeze.release.value = 0.14;
    const level = ctx.createGain();
    level.gain.value = 1.5;
    // Shut while this boat is transmitting: a VHF cannot hear while it talks.
    this.gate = ctx.createGain();
    this.input
      .connect(filter('highpass', 300)).connect(filter('highpass', 320, 1.1))
      .connect(filter('lowpass', 3000)).connect(filter('lowpass', 2900, 1.1))
      .connect(drive).connect(squeeze).connect(level).connect(this.gate).connect(out);

    // Static: the same noise through the same sort of band, silent until somebody keys up.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    src.connect(filter('bandpass', 1700, 0.6)).connect(this.hiss).connect(this.gate);
    src.start();
  }

  /** A carrier has come up: the squelch opens with a click and the static comes in under the voice. */
  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.click(0.2);
    this.hiss.gain.setTargetAtTime(0.045, this.ctx.currentTime, 0.02);
  }

  /** The carrier has gone: a short rush of noise, then quiet. */
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.hiss.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    this.tail();
  }

  /** While true nothing is heard, as on a real set with the key down. */
  transmitting(on: boolean): void {
    this.gate.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.01);
  }

  /** The key going down or coming up: a few milliseconds of noise with a thump under it. */
  click(level = 0.16): void {
    const t = this.ctx.currentTime;
    this.burst(t, 0.022, level, 2200);
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.03);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  /** The squelch tail: open noise for a moment after the carrier drops, cut off sharply. */
  tail(): void {
    const t = this.ctx.currentTime;
    this.burst(t, 0.17, 0.24, 1900, true);
    this.burst(t + 0.17, 0.012, 0.12, 900);
  }

  private burst(at: number, seconds: number, level: number, hz: number, flat = false): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = hz;
    band.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    if (flat) g.gain.setValueAtTime(level, at + seconds - 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    src.connect(band).connect(g).connect(this.out);
    src.start(at, Math.random() * 1.5, seconds + 0.02);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * seconds), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private softClip(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return curve;
  }
}
