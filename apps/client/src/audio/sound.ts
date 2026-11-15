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

  /** Where another maker of sound joins the game's: the context and the master volume. Null until sound has started. */
  output(): { ctx: AudioContext; node: AudioNode } | null {
    return this.ctx && this.ctx.state === 'running' ? { ctx: this.ctx, node: this.master } : null;
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

  private motor: { gain: GainNode; low: OscillatorNode; high: OscillatorNode; chug: OscillatorNode; chugDepth: GainNode; tone: BiquadFilterNode; rumble: GainNode } | null = null;

  /**
   * The diesel: two saw waves an octave apart under a low-pass, beaten at the firing rate so it chugs at idle and
   * smooths out as the revs rise, with a little exhaust noise. Call every frame; `rpm` 0 is silence.
   * @param rpm what the rev counter shows. Under about 400 it is the starter turning her over.
   * @param load 0 in neutral, 1 flat out in gear
   */
  engine(rpm: number, load: number, paused: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.motor) {
      if (rpm <= 0) return;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 220;
      tone.Q.value = 0.8;
      const low = ctx.createOscillator();
      low.type = 'sawtooth';
      const high = ctx.createOscillator();
      high.type = 'sawtooth';
      high.detune.value = 9;
      const highGain = ctx.createGain();
      highGain.gain.value = 0.45;
      const beat = ctx.createGain();
      beat.gain.value = 0.6;
      const chug = ctx.createOscillator();
      chug.type = 'sine';
      const chugDepth = ctx.createGain();
      chugDepth.gain.value = 0.4;
      chug.connect(chugDepth).connect(beat.gain);
      low.connect(tone);
      high.connect(highGain).connect(tone);
      tone.connect(beat).connect(gain).connect(this.master);
      // Exhaust: low noise, wet and uneven.
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx, 2);
      src.loop = true;
      const wet = ctx.createBiquadFilter();
      wet.type = 'lowpass';
      wet.frequency.value = 380;
      const rumble = ctx.createGain();
      rumble.gain.value = 0;
      src.connect(wet).connect(rumble).connect(beat);
      for (const node of [low, high, chug, src]) node.start();
      this.motor = { gain, low, high, chug, chugDepth, tone, rumble };
    }
    const m = this.motor;
    const now = ctx.currentTime;
    const on = rpm > 0 && !paused;
    // A four-cylinder four-stroke fires twice a turn.
    const fire = Math.max(6, (rpm / 60) * 2);
    const cranking = rpm > 0 && rpm < 400;
    m.low.frequency.setTargetAtTime(cranking ? 46 : fire, now, 0.12);
    m.high.frequency.setTargetAtTime(cranking ? 139 : fire * 2, now, 0.12);
    m.chug.frequency.setTargetAtTime(cranking ? 7 : fire / 4, now, 0.12);
    m.chugDepth.gain.setTargetAtTime(cranking ? 0.6 : Math.max(0.1, 0.45 - rpm / 9000), now, 0.2);
    m.tone.frequency.setTargetAtTime(170 + rpm * 0.11 + load * 160, now, 0.2);
    m.rumble.gain.setTargetAtTime(on ? 0.5 + load * 0.5 : 0, now, 0.2);
    m.gain.gain.setTargetAtTime(on ? (cranking ? 0.2 : 0.16 + 0.2 * load) : 0, now, on ? 0.15 : 0.35);
  }

  /** One hull hitting another: a low thump and the crunch after it. `hard` is 0 for a touch, 1 for a ramming. */
  thud(hard: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const k = Math.min(1, Math.max(0, hard));
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95 - 25 * k, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 + 0.55 * k, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34 + 0.2 * k);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);
    const crunch = ctx.createBufferSource();
    crunch.buffer = this.noiseBuffer(ctx, 0.35);
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 500 + 900 * k;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.25 + 0.6 * k, t + 0.008);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16 + 0.16 * k);
    crunch.connect(body).connect(cg).connect(this.master);
    crunch.start(t);
  }

  /** A sea lion's bark: one short, hoarse honk. `near` is 1 alongside, falling to 0 out of earshot. */
  bark(near: number): void {
    const ctx = this.ctx;
    if (!ctx || !(near > 0)) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(330, t);
    osc.frequency.exponentialRampToValueAtTime(205, t + 0.17);
    const throat = ctx.createBiquadFilter();
    throat.type = 'bandpass';
    throat.frequency.value = 720;
    throat.Q.value = 1.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * Math.min(1, near), t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.21);
    osc.connect(throat).connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.23);
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
