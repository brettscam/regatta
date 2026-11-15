import { Vhf } from '../audio/vhf';
import { onWeb, platform, voice as askVoice, type Voice, type VoiceHost } from '../net/platform';
import type { AboardContext, Feature } from './feature';
import { due, passing, passingText, schedule, spoken, type RadioCall } from './radioCalls';

/**
 * The VHF, on channel 16.
 *
 * - Hold V to talk to every boat on this water, let go to listen. Voice goes from browser to browser and is not
 *   recorded or stored (`net/web/voice.ts`). It is on the website only: on claude.ai, and in a copy of the game with
 *   nothing behind it, V says so and does nothing else. The microphone is asked for the first time V is pressed.
 * - The ferries and ships are heard as well: a securite call as one leaves a berth or comes in at the Gate, and a
 *   short call to this boat when one is about to pass close. Their times come from the traffic's own timetable
 *   (`radioCalls.ts`), so everyone hears the same call at the same moment. The words are written out among the hails
 *   and spoken by the browser. Shift+V turns them off, and that is remembered. A water with no traffic has none.
 *
 * On screen there is nothing unless somebody is on the air: then a small light among the hails, "TX 16" while this
 * boat transmits, "RX 16" and the skipper's name while another does.
 */

const TRAFFIC_KEY = 'regatta.radio.traffic';
const SITE = 'bajaregatta.com';

export class Radio implements Feature {
  readonly id = 'radio';
  private readonly web = onWeb();
  private readonly light = document.createElement('div');
  private lightKey = '';
  private voice: Voice | null = null;
  private raising: Promise<Voice | null> | null = null;
  private vhf: Vhf | null = null;
  /** True while V is held. */
  private down = false;
  private introduced = false;
  private toldMic = false;
  private toldCrowded = false;
  private toldAlone = 0;
  private wasTransmitting = false;
  private wasOpen = false;
  /** The boats talking now, by id. */
  private readonly talkers = new Set<string>();

  private readonly calls: RadioCall[];
  private trafficOn = true;
  private lastSeason: number;
  private speaking = false;
  private speakTimer: ReturnType<typeof setTimeout> | null = null;
  private passClock = 0;
  private lastCallAt = -1e9;
  private readonly passed = new Map<string, number>();

  private readonly host: VoiceHost = {
    company: () => this.ctx.company().map((b) => b.peer),
    audio: () => {
      const vhf = this.set();
      return vhf ? { ctx: vhf.ctx, input: vhf.input } : null;
    },
    talking: (peer, on) => this.talking(peer, on),
  };

  constructor(private readonly ctx: AboardContext) {
    this.light.className = 'radio';
    this.light.setAttribute('role', 'status');
    this.calls = schedule(ctx.stage.traffic.spec, ctx.world.seasonLength);
    this.lastSeason = ctx.seasonNow();
    try {
      this.trafficOn = localStorage.getItem(TRAFFIC_KEY) !== '0';
    } catch { /* no storage here: the calls stay on */ }
  }

  key(code: string, shift: boolean): boolean {
    if (code !== 'KeyV') return false;
    if (shift) {
      this.toggleTraffic();
      return true;
    }
    if (!this.web) {
      this.ctx.say(platform() === 'claude'
        ? `The voice radio works on the website, ${SITE}, not here. Press Enter to type a message to the other boats instead`
        : `No voice radio in this copy of the game. It works on the website, ${SITE}`, 7);
      return true;
    }
    this.down = true;
    void this.press();
    return true;
  }

  update(dt: number): void {
    // The key hook only says when a key goes down. This is where its coming up is noticed.
    if (this.down && !this.ctx.held('KeyV')) {
      this.down = false;
      void this.voice?.transmit(false);
    }
    if (this.web && !this.raising && this.ctx.company().length > 0) void this.raise();

    const state = this.voice?.state();
    const transmitting = state?.transmitting ?? false;
    if (transmitting !== this.wasTransmitting) {
      this.wasTransmitting = transmitting;
      const vhf = this.set();
      vhf?.click();
      vhf?.transmitting(transmitting);
      if (transmitting) this.hush();
    }
    if (state?.crowded && !this.toldCrowded) {
      this.toldCrowded = true;
      this.ctx.say('This water is too crowded for voice to reach everyone: the radio carries 8 boats at most, so some will not hear you', 9);
    }
    // The squelch: open while anything is on the air, a voice or a ferry's call.
    const open = this.talkers.size > 0 || this.speaking;
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      if (open) this.set()?.open();
      else this.vhf?.close();
    }
    this.traffic(dt);
    this.show(state);
  }

  dispose(): void {
    this.down = false;
    this.voice?.close();
    this.hush();
    this.light.remove();
  }

  /** The voice side, for looking at from the console while play testing. */
  debug(): { voice: Voice | null; calls: RadioCall[]; talkers: string[] } {
    return { voice: this.voice, calls: this.calls, talkers: [...this.talkers] };
  }

  // ---- voice -------------------------------------------------------------------------------------

  /** Fetch the radio and have it listen. Asked for once: when another boat first turns up, or when V is first pressed. */
  private raise(): Promise<Voice | null> {
    return (this.raising ??= askVoice(this.ctx.stage.course.id).then((v) => {
      v?.open(this.host);
      this.voice = v;
      return v;
    }).catch(() => null));
  }

  private async press(): Promise<void> {
    const v = await this.raise();
    if (!v) {
      this.ctx.say('The radio could not be switched on. Press Enter to type a message instead', 6);
      return;
    }
    if (!this.down) return;
    if (!this.introduced) {
      this.introduced = true;
      this.ctx.say('Radio on, channel 16. Hold V to talk, let go to listen. Every boat on this water hears you while V is held. Nothing is recorded', 10);
    } else if (!this.ctx.company().length && performance.now() - this.toldAlone > 15000) {
      this.toldAlone = performance.now();
      this.ctx.say('Nobody else is on this water to hear you', 4);
    }
    const mic = await v.transmit(true);
    if (this.toldMic || (mic !== 'refused' && mic !== 'missing')) return;
    this.toldMic = true;
    this.ctx.say(mic === 'refused'
      ? 'The browser was not allowed to use the microphone, so you can listen on the radio but not talk. To talk, allow the microphone for this site and reload'
      : 'No microphone was found, so you can listen on the radio but not talk', 9);
  }

  private talking(peer: string, on: boolean): void {
    if (on) this.talkers.add(peer);
    else this.talkers.delete(peer);
    if (!on) return;
    // A voice has the air: the ferry's call gives way to it.
    this.hush();
    if (!this.introduced) {
      this.introduced = true;
      this.ctx.say('Channel 16: another boat is on the radio. Hold V to answer. Every boat on this water hears you while V is held', 9);
    }
  }

  private nameOf(peer: string): string {
    const boat = this.ctx.company().find((b) => b.peer === peer);
    return boat?.name || boat?.boatName || 'Another boat';
  }

  /** The set's sound, once the game's own sound is running. */
  private set(): Vhf | null {
    if (this.vhf) return this.vhf;
    const out = this.ctx.sound.output();
    if (out) this.vhf = new Vhf(out.ctx, out.node);
    return this.vhf;
  }

  // ---- the light ---------------------------------------------------------------------------------

  private show(state: ReturnType<Voice['state']> | undefined): void {
    let kind = '';
    let label = '';
    let note = '';
    if (state?.transmitting) {
      kind = 'tx';
      label = 'TX 16';
      const here = this.ctx.company().length;
      note = here === 0 ? 'nobody else on this water' : state.raising > 0 ? `raising ${state.raising} ${state.raising === 1 ? 'boat' : 'boats'}` : '';
    } else if (this.talkers.size) {
      kind = 'rx';
      label = 'RX 16';
      note = [...this.talkers].map((p) => this.nameOf(p)).join(', ');
    } else if (this.down && state?.mic === 'asking') {
      kind = 'rx';
      label = '16';
      note = 'waiting for the microphone';
    }
    const key = `${kind}|${label}|${note}`;
    const hails = document.getElementById('hails');
    if (!kind) {
      if (this.lightKey) this.light.remove();
      this.lightKey = '';
      return;
    }
    // The hails box drops its oldest line when it is full, which can be this one: put it back.
    if (hails && this.light.parentNode !== hails) hails.appendChild(this.light);
    if (key === this.lightKey) return;
    this.lightKey = key;
    this.light.className = `radio ${kind}`;
    const lamp = document.createElement('i');
    const name = document.createElement('b');
    name.textContent = label;
    // Names are other people's words: text, never markup.
    const rest = document.createElement('span');
    rest.textContent = note;
    this.light.replaceChildren(lamp, name, ...(note ? [rest] : []));
  }

  // ---- the ferries and ships ---------------------------------------------------------------------

  private toggleTraffic(): void {
    if (!this.calls.length) {
      this.ctx.say('There are no ferries or ships calling on this water', 4);
      return;
    }
    this.trafficOn = !this.trafficOn;
    try {
      localStorage.setItem(TRAFFIC_KEY, this.trafficOn ? '1' : '0');
    } catch { /* not remembered, then */ }
    if (!this.trafficOn) this.hush();
    this.ctx.say(this.trafficOn ? 'Ferry and ship calls on the radio: on' : 'Ferry and ship calls on the radio: off. Shift+V turns them back on', 5);
  }

  private traffic(dt: number): void {
    if (!this.calls.length) return;
    const { sim, stage } = this.ctx;
    const now = this.ctx.seasonNow();
    const from = this.lastSeason;
    this.lastSeason = now;
    if (!this.trafficOn) return;
    // The timetable: whatever fell due since the last frame. A jump in the clock (a night slept through, joining
    // another boat's time of day) is not played back.
    if (now - from > 0 && now - from < 20) {
      const fallen = due(this.calls, from, now);
      if (fallen.length) this.air(fallen[fallen.length - 1].from, fallen[fallen.length - 1].text);
    }
    // A ferry or a ship about to pass close calls this boat by name. Looked at every couple of seconds.
    this.passClock -= dt;
    if (this.passClock > 0) return;
    this.passClock = 2;
    const t = sim.state.t;
    if (sim.state.hold !== 'none' || t - this.lastCallAt < 60) return;
    const near = passing({ x: sim.state.x, y: sim.state.y, heading: sim.state.heading, cog: sim.out.cog, sog: sim.out.sog }, stage.traffic.vessels);
    if (!near || t - (this.passed.get(near.vessel.id) ?? -1e9) < 600) return;
    this.passed.set(near.vessel.id, t);
    this.air(near.vessel.name, passingText(near, this.ctx.livery.name ?? ''));
  }

  /** Put a call on the air: written among the hails, and spoken if the browser can and the channel is clear. */
  private air(from: string, text: string): void {
    this.lastCallAt = this.ctx.sim.state.t;
    this.ctx.heard(from, text);
    const synth = window.speechSynthesis;
    // No sound yet means the player has not touched the page, and then the browser will not speak either.
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined' || !this.set()) return;
    if (this.speaking || this.talkers.size || this.wasTransmitting) return;
    const words = new SpeechSynthesisUtterance(spoken(text));
    const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
    const plain = voices.find((v) => v.localService && v.lang === 'en-US') ?? voices.find((v) => v.localService) ?? voices[0];
    if (plain) words.voice = plain;
    words.lang = plain?.lang ?? 'en-US';
    words.rate = 1.15;
    words.pitch = 0.9;
    words.volume = 0.85;
    const done = (): void => {
      if (this.speakTimer !== null) clearTimeout(this.speakTimer);
      this.speakTimer = null;
      this.speaking = false;
    };
    words.onend = done;
    words.onerror = done;
    this.speaking = true;
    // If the browser never says it has finished, close the squelch anyway.
    this.speakTimer = setTimeout(done, 3000 + text.length * 90);
    synth.speak(words);
  }

  /** Stop a call that is being spoken. */
  private hush(): void {
    if (!this.speaking) return;
    window.speechSynthesis?.cancel();
    if (this.speakTimer !== null) clearTimeout(this.speakTimer);
    this.speakTimer = null;
    this.speaking = false;
  }
}
