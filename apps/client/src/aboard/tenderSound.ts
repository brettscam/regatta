import type { Sound } from '../audio/sound';

// The sound of a powered tender, made from two oscillators and some noise and played through the game's own output
// (`Sound.output()`), as the yacht's diesel is in `audio/sound.ts`. An outboard buzzes and burbles; a jet whines and
// roars. Both are quiet at idle. One of these for the player's tender and one for the nearest of anyone else's.

type Kind = 'none' | 'outboard' | 'jet';

interface Voice {
  ctx: AudioContext;
  gain: GainNode;
  low: OscillatorNode;
  high: OscillatorNode;
  highGain: GainNode;
  tone: BiquadFilterNode;
  beat: OscillatorNode;
  beatDepth: GainNode;
  hiss: GainNode;
  hissTone: BiquadFilterNode;
  sources: AudioScheduledSourceNode[];
}

export class TenderSound {
  private voice: Voice | null = null;

  constructor(private readonly sound: Sound) {}

  /**
   * Call every frame.
   * @param kind what is making the noise. 'none' is silence
   * @param revs 0 idling to 1 flat out. Below 0 the engine is stopped
   * @param load 0 out of gear or in the air, 1 pushing hard
   * @param near 1 aboard her, falling to 0 out of earshot
   */
  update(kind: Kind, revs: number, load: number, near = 1): void {
    const out = this.sound.output();
    if (!out) return;
    const running = kind !== 'none' && revs >= 0 && near > 0.01;
    if (!this.voice) {
      if (!running) return;
      this.voice = this.build(out.ctx, out.node);
    }
    const v = this.voice;
    // The game's sound was started again on another context: start over on it.
    if (v.ctx !== out.ctx) {
      this.dispose();
      return;
    }
    const now = v.ctx.currentTime;
    const r = Math.min(1, Math.max(0, revs));
    const l = Math.min(1, Math.max(0, load));
    if (kind === 'jet') {
      // A pump's whine that climbs a long way, and the blast of water under it.
      const f = 62 + 250 * r;
      v.low.frequency.setTargetAtTime(f, now, 0.08);
      v.high.frequency.setTargetAtTime(f * 3.02, now, 0.08);
      v.highGain.gain.setTargetAtTime(0.25 + 0.3 * r, now, 0.1);
      v.tone.frequency.setTargetAtTime(500 + 1900 * r, now, 0.1);
      v.beat.frequency.setTargetAtTime(11 + 20 * r, now, 0.1);
      v.beatDepth.gain.setTargetAtTime(0.12, now, 0.2);
      v.hissTone.frequency.setTargetAtTime(700 + 1500 * r, now, 0.15);
      v.hiss.gain.setTargetAtTime(running ? 0.15 + 1.1 * l : 0, now, 0.12);
      v.gain.gain.setTargetAtTime(running ? near * (0.022 + 0.17 * r * r + 0.05 * l) : 0, now, running ? 0.1 : 0.3);
    } else {
      // A small two-stroke: a buzz at the firing rate that burbles at idle and smooths out as it revs.
      const f = 27 + 165 * r;
      v.low.frequency.setTargetAtTime(f, now, 0.1);
      v.high.frequency.setTargetAtTime(f * 2.01, now, 0.1);
      v.highGain.gain.setTargetAtTime(0.4, now, 0.1);
      v.tone.frequency.setTargetAtTime(320 + 1500 * r, now, 0.12);
      v.beat.frequency.setTargetAtTime(f / 3, now, 0.1);
      v.beatDepth.gain.setTargetAtTime(Math.max(0.08, 0.5 - 0.5 * r), now, 0.2);
      v.hissTone.frequency.setTargetAtTime(500 + 900 * r, now, 0.15);
      v.hiss.gain.setTargetAtTime(running ? 0.2 + 0.5 * l : 0, now, 0.15);
      v.gain.gain.setTargetAtTime(running ? near * (0.03 + 0.15 * r * r + 0.04 * l) : 0, now, running ? 0.12 : 0.3);
    }
  }

  private build(ctx: AudioContext, to: AudioNode): Voice {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 400;
    tone.Q.value = 1.1;
    const low = ctx.createOscillator();
    low.type = 'sawtooth';
    const high = ctx.createOscillator();
    high.type = 'square';
    high.detune.value = 7;
    const highGain = ctx.createGain();
    highGain.gain.value = 0.4;
    const chop = ctx.createGain();
    chop.gain.value = 0.7;
    const beat = ctx.createOscillator();
    beat.type = 'sine';
    const beatDepth = ctx.createGain();
    beatDepth.gain.value = 0.3;
    beat.connect(beatDepth).connect(chop.gain);
    low.connect(tone);
    high.connect(highGain).connect(tone);
    tone.connect(chop).connect(gain).connect(to);
    // Water and exhaust: noise through a band that follows the revs.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const hissTone = ctx.createBiquadFilter();
    hissTone.type = 'bandpass';
    hissTone.frequency.value = 800;
    hissTone.Q.value = 0.6;
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    noise.connect(hissTone).connect(hiss).connect(gain);
    const sources = [low, high, beat, noise];
    for (const s of sources) s.start();
    return { ctx, gain, low, high, highGain, tone, beat, beatDepth, hiss, hissTone, sources };
  }

  dispose(): void {
    const v = this.voice;
    this.voice = null;
    if (!v) return;
    try {
      for (const s of v.sources) s.stop();
      v.gain.disconnect();
    } catch {
      // Already stopped with its context.
    }
  }
}
