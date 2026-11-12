/**
 * All sound is made here from filtered noise, with no audio files: wind in the rig, water on the hull,
 * flogging cloth, winch pawls. Browsers only allow sound after the player touches the page, so it starts on first input.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private wind!: GainNode;
  private windTone!: BiquadFilterNode;
  private water!: GainNode;
  private flog!: GainNode;
  private master!: GainNode;
  private clickBank = 0;

  /** Call from a pointer or key event. Safe to call again. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    const noise = this.noiseBuffer(ctx, 4);
    const loop = () => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.start(0, Math.random() * 3);
      return src;
    };

    // Wind: a band of noise whose pitch rises a little with wind speed.
    this.windTone = ctx.createBiquadFilter();
    this.windTone.type = 'bandpass';
    this.windTone.frequency.value = 500;
    this.windTone.Q.value = 0.7;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    loop().connect(this.windTone).connect(this.wind).connect(this.master);

    // Water: low rushing noise that grows with boat speed.
    const waterLow = ctx.createBiquadFilter();
    waterLow.type = 'lowpass';
    waterLow.frequency.value = 900;
    const waterHigh = ctx.createBiquadFilter();
    waterHigh.type = 'highpass';
    waterHigh.frequency.value = 160;
    this.water = ctx.createGain();
    this.water.gain.value = 0;
    loop().connect(waterLow).connect(waterHigh).connect(this.water).connect(this.master);

    // Flogging cloth: sharper noise chopped at a few beats a second.
    const flogTone = ctx.createBiquadFilter();
    flogTone.type = 'bandpass';
    flogTone.frequency.value = 1500;
    flogTone.Q.value = 0.5;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 7.3;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(chop.gain);
    lfo.start();
    this.flog = ctx.createGain();
    this.flog.gain.value = 0;
    loop().connect(flogTone).connect(chop).connect(this.flog).connect(this.master);
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Pink-ish noise: white noise run through a few leaky sums.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
    }
    return buf;
  }

  /**
   * @param awsKt apparent wind, knots
   * @param speedKt boat speed, knots
   * @param loose 0 to 1, how much cloth is luffing or flogging
   */
  update(awsKt: number, speedKt: number, loose: number, paused: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const quiet = paused ? 0 : 1;
    const w = Math.min(1.4, awsKt / 22);
    this.wind.gain.setTargetAtTime(quiet * 0.42 * w * w, now, 0.4);
    this.windTone.frequency.setTargetAtTime(380 + 420 * w, now, 0.6);
    const s = Math.min(1.3, speedKt / 7);
    this.water.gain.setTargetAtTime(quiet * (0.05 + 0.5 * s * s), now, 0.5);
    this.flog.gain.setTargetAtTime(quiet * 0.55 * loose * Math.min(1.3, 0.3 + awsKt / 18), now, 0.12);
  }

  /** Winch pawls: one click for each couple of degrees of sheet. */
  winch(amountDeg: number, loaded: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.clickBank += Math.abs(amountDeg);
    let n = 0;
    while (this.clickBank >= 1.5 && n < 4) {
      this.clickBank -= 1.5;
      const t = ctx.currentTime + n * 0.035;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1900 - 500 * loaded, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.04);
      n++;
    }
  }
}
