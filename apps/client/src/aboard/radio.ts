import { KT } from '@slack-tide/sim';
import { Vhf } from '../audio/vhf';
import { castAll, castVoice, describePool, rankVoices, type Caller, type Casting, type Role } from '../audio/voices';
import { onWeb, platform, voice as askVoice, type Voice, type VoiceHost } from '../net/platform';
import type { AboardContext, Feature } from './feature';
import { STATION, broadcasts, bulletin, checkCalls, due, passing, passingText, schedule, spoken, type Departure, type Outlook, type RadioCall } from './radioCalls';
import { compassWord, hasRadio, localHour, type Roster } from './residentRules';

/**
 * The VHF, on channel 16.
 *
 * - Hold V to talk to every boat on this water, let go to listen. Voice goes from browser to browser and is not
 *   recorded or stored (`net/web/voice.ts`). It is on the website only: on claude.ai, and in a copy of the game with
 *   nothing behind it, V says so and does nothing else. The microphone is asked for the first time V is pressed.
 * - Everybody else on the water is heard as well (`radioCalls.ts` has who and when): the ferries and ships, the coast
 *   station's broadcast, a yacht calling for a radio check, and the boats the player hails or sails close to
 *   (`residents.ts`, through `transmit`). The words are written out among the hails and spoken by the browser.
 *   Shift+V turns the speaking off, and the scheduled calls with it, and that is remembered.
 *
 * How a spoken call is made to sound like a radio. The browser's speech cannot be passed through the set's sound
 * (`audio/vhf.ts`): no browser lets a page route it into Web Audio. So everything round the words is done instead:
 * - each caller has a voice of her own, kept for good, picked from the best the browser has (`audio/voices.ts`),
 *   with her own pitch and pace
 * - the wind and the water are turned down while the call lasts
 * - the squelch clicks open as the first word starts, static and a faint carrier lie under the words until the last
 *   one ends, and the squelch tail follows. Start and end come from the speech's own events, with a clock behind them
 *   for browsers that never send them
 * - a caller far away is a little quieter and has more static under her
 * - how loud the words are follows the game's own volume
 * Where the browser has no voice to speak with, the words are still written and the squelch still opens and shuts.
 * One call at a time: a second waits its turn, a third is dropped, and all of them stop for a real voice.
 *
 * On screen there is nothing unless somebody is on the air: then a small light among the hails, "TX 16" while this
 * boat transmits, "RX 16" and the skipper's name while another does.
 */

/** Words for channel 16 from somebody who is not a player. */
export interface Transmission {
  from: string;
  text: string;
  /** What her voice is cast from: her id. The same id is always the same voice. */
  voice: string;
  role: Role;
  /** A voice from this part of the world, if the browser has one: "en-GB". */
  accent?: string;
  /** Where she is, sim metres, for how well she comes through. Left out: a shore station, heard well everywhere. */
  x?: number;
  y?: number;
  /** Said to this boat by somebody close: it goes ahead of anything waiting, and is written out even with the calls switched off. */
  near?: boolean;
  /** What somebody else says straight after. */
  answer?: Transmission;
}

/** How long a spoken call is allowed before the set gives up waiting for the browser to say it has finished, ms. */
export function speechAllowance(text: string, rate: number): number {
  return 2500 + (text.length * 85) / Math.max(0.5, rate);
}

/** How well a caller comes through at a range, metres: how loud the words are and how much static is under them. */
export function reception(range: number | null): { volume: number; hiss: number } {
  if (range === null) return { volume: 0.92, hiss: 0.4 };
  const far = Math.max(0, Math.min(1, (range - 1500) / 9000));
  return { volume: 1 - 0.38 * far, hiss: 0.34 + 0.5 * far };
}

/** Break a call into sentences. Some browsers stop speaking part way through a long passage; none do on a sentence. */
export function sentences(text: string): string[] {
  const out = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  return out.map((p) => p.trim()).filter(Boolean);
}

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
  private wasLeaning = false;
  /** The boats talking now, by id. */
  private readonly talkers = new Set<string>();

  private calls: RadioCall[] | null = null;
  private trafficOn = true;
  private lastSeason: number;
  /** The call being spoken now, if any. `bed` is true once its static is on. */
  private speaking: { words: SpeechSynthesisUtterance[]; bed: boolean; hiss: number; then?: Transmission } | null = null;
  private speakTimer: ReturnType<typeof setTimeout> | null = null;
  private bedTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  /** Calls waiting for the channel. Never more than two. */
  private readonly waiting: Transmission[] = [];
  private pool: SpeechSynthesisVoice[] | null = null;
  private readonly casts = new Map<string, Casting<SpeechSynthesisVoice>>();
  private readonly onVoices = (): void => {
    this.pool = null;
    this.casts.clear();
  };
  private bulletins = 0;
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
    this.lastSeason = ctx.seasonNow();
    // The list of voices often arrives after the page has loaded, and can change when a voice is installed.
    try {
      window.speechSynthesis?.addEventListener?.('voiceschanged', this.onVoices);
    } catch { /* no speech here */ }
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
    this.sync();
    if (state?.crowded && !this.toldCrowded) {
      this.toldCrowded = true;
      this.ctx.say('This water is too crowded for voice to reach everyone: the radio carries 8 boats at most, so some will not hear you', 9);
    }
    this.traffic(dt);
    this.show(state);
  }

  /**
   * Make the set sound the way things stand: the click of this boat's key, and the squelch open while anything is on
   * the air, a voice or a ferry's call. Called when something changes as well as every frame, so the sound does not
   * wait on the picture.
   */
  private sync(): void {
    const transmitting = this.voice?.state().transmitting ?? false;
    if (transmitting !== this.wasTransmitting) {
      this.wasTransmitting = transmitting;
      const vhf = this.set();
      vhf?.click();
      vhf?.transmitting(transmitting);
      if (transmitting) this.hush();
    }
    const voices = this.talkers.size > 0;
    const open = voices || (this.speaking?.bed ?? false);
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      if (open) this.set()?.open(voices ? 1 : this.speaking?.hiss ?? 0.4);
      else this.vhf?.close();
    }
    // The wind and the water give way to whoever is on the air, from the moment a call is on its way.
    const lean = open || this.speaking !== null;
    if (lean !== this.wasLeaning) {
      this.wasLeaning = lean;
      this.ctx.sound.duck(lean ? 0.38 : 1);
    }
  }

  dispose(): void {
    this.down = false;
    this.voice?.close();
    this.hush();
    try {
      window.speechSynthesis?.removeEventListener?.('voiceschanged', this.onVoices);
    } catch { /* nothing to remove */ }
    this.ctx.sound.duck(1);
    this.light.remove();
  }

  /** The voice side, for looking at from the console while play testing. */
  debug(): Record<string, unknown> {
    return {
      voice: this.voice, calls: this.schedule(), talkers: [...this.talkers], vhf: this.vhf, pool: describePool(this.voices()),
      cast: (key: string, role: Role = 'skipper', accent?: string) => this.cast({ key, role, accent }),
      speaking: () => this.speaking !== null, bed: () => this.speaking?.bed ?? false, waiting: () => this.waiting.length,
      outlook: () => this.outlook(),
    };
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
    if (!this.introduced) {
      this.introduced = true;
      this.ctx.say('Radio on, channel 16. Hold V to talk, let go to listen. Every boat on this water hears you while V is held. Nothing is recorded', 10);
      // A tap that was over before the radio was ready: the line above says what to do next time.
      if (!this.down) return;
    } else if (!this.down) return;
    else if (!this.ctx.company().length && performance.now() - this.toldAlone > 15000) {
      this.toldAlone = performance.now();
      this.ctx.say('Nobody else is on this water to hear you', 4);
    }
    const mic = await v.transmit(true);
    this.sync();
    if (this.toldMic || (mic !== 'refused' && mic !== 'missing')) return;
    this.toldMic = true;
    this.ctx.say(mic === 'refused'
      ? 'The browser was not allowed to use the microphone, so you can listen on the radio but not talk. To talk, allow the microphone for this site and reload'
      : 'No microphone was found, so you can listen on the radio but not talk', 9);
  }

  private talking(peer: string, on: boolean): void {
    if (on) this.talkers.add(peer);
    else this.talkers.delete(peer);
    // A voice has the air: the ferry's call gives way to it.
    if (on) this.hush();
    this.sync();
    if (!on) return;
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
      // Short, so the light stays clear of the line of text beside it.
      note = state.raising > 0 ? `raising ${state.raising} ${state.raising === 1 ? 'boat' : 'boats'}` : '';
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

  // ---- everybody who is not a player ------------------------------------------------------------

  private station(): string {
    return this.ctx.stage.traffic.spec.station ?? STATION;
  }

  /** The season's scheduled calls, worked out the first time they are wanted: by then the residents are aboard. */
  private schedule(): RadioCall[] {
    if (this.calls) return this.calls;
    const { ctx } = this;
    const { world, stage } = ctx;
    const station = this.station();
    const roster = ctx.feature<Feature & { roster: Roster }>('residents')?.roster;
    const leaving: Departure[] = [];
    for (const d of roster?.departures() ?? []) {
      const spec = roster!.boats[d.index].spec;
      // The small fry do not call in: a kayak has no radio, and a daysailer is out and back all afternoon.
      if (!hasRadio(spec.kind) || spec.kind === 'daysailer') continue;
      leaving.push({ t: d.t, id: spec.id, name: spec.name, sort: spec.kind === 'cruiser' ? 'sailing vessel' : spec.kind === 'fisher' ? 'fishing vessel' : 'motor vessel', from: d.from, to: d.to, accent: spec.accent });
    }
    const startHour = localHour(world.course.season.start, world.course.timeZone);
    this.calls = schedule(stage.traffic.spec, world.seasonLength, undefined, broadcasts(station, world.seasonLength, startHour), checkCalls(station, leaving));
    return this.calls;
  }

  private toggleTraffic(): void {
    this.trafficOn = !this.trafficOn;
    try {
      localStorage.setItem(TRAFFIC_KEY, this.trafficOn ? '1' : '0');
    } catch { /* not remembered, then */ }
    if (!this.trafficOn) this.hush();
    this.ctx.say(this.trafficOn ? 'Calls on the radio: on' : 'Calls on the radio: off. Boats you hail still answer in writing. Shift+V turns the radio calls back on', 5);
  }

  /** What the coast station's broadcast is made from: the wind over the water's named places now and in three hours, and the tide. */
  private outlook(): Outlook {
    const { ctx } = this;
    const { world, sim } = ctx;
    const t = sim.state.t;
    const spots = ctx.places.length ? ctx.places : [{ x: sim.state.x, y: sim.state.y }];
    const mean = (at: number, source: 'truth' | 'forecast'): { kt: number; from: string } => {
      let u = 0;
      let v = 0;
      let speed = 0;
      for (const p of spots) {
        const w = world.wind(p.x, p.y, at, source);
        u += Math.sin(w.dir) * w.speed;
        v += Math.cos(w.dir) * w.speed;
        speed += w.speed;
      }
      return { kt: speed / spots.length / KT, from: compassWord(Math.atan2(u, v)) };
    };
    const now = mean(t, 'truth');
    const later = mean(t + 3 * 3600, 'forecast');
    let gust = 0;
    for (const p of spots) gust += world.gust(p.x, p.y, t);
    let turn: Outlook['turn'] = null;
    const rising = world.tideRate(t) > 0;
    for (let m = 5; m <= 360; m += 5) {
      if (world.tideRate(t + m * 60) > 0 !== rising) {
        turn = { high: rising, minutes: m };
        break;
      }
    }
    return {
      station: this.station(), area: ctx.stage.course.name, hour: localHour(world.dateAt(t), ctx.stage.course.timeZone),
      windKt: now.kt, windFrom: now.from, gustKt: gust / spots.length / KT, laterKt: later.kt, laterFrom: later.from, turn,
    };
  }

  /** Where a caller is, if she is on the water: a ferry or a ship by her route's id, a resident by her own. */
  private whereIs(id: string): { x: number; y: number } | null {
    for (const v of this.ctx.stage.traffic.vessels) if (v.id === id) return v;
    const residents = this.ctx.feature<Feature & { vessels: Array<{ id: string; x: number; y: number }> }>('residents')?.vessels ?? [];
    for (const v of residents) if (v.id === `resident-${id}`) return v;
    return null;
  }

  private traffic(dt: number): void {
    const { sim, stage } = this.ctx;
    const now = this.ctx.seasonNow();
    const from = this.lastSeason;
    this.lastSeason = now;
    if (!this.trafficOn) return;
    const calls = this.schedule();
    // The timetable: whatever fell due since the last frame. A jump in the clock (a night slept through, joining
    // another boat's time of day) is not played back.
    if (now - from > 0 && now - from < 20) {
      const fallen = due(calls, from, now);
      const c = fallen[fallen.length - 1];
      if (c) {
        const at = this.whereIs(c.vessel);
        const text = c.kind === 'bulletin' ? bulletin(this.outlook(), this.bulletins++) : c.text;
        this.air({
          from: c.from, text, voice: c.vessel, role: c.role, accent: c.accent, x: at?.x, y: at?.y,
          answer: c.answer ? { from: c.answer.from, text: c.answer.text, voice: c.answer.vessel, role: c.answer.role } : undefined,
        });
      }
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
    const n = (this.passed.size + Math.floor(t / 600)) % 3;
    this.air({ from: near.vessel.name, text: passingText(near, this.ctx.livery.name ?? '', n / 3 + 0.01), voice: near.vessel.id, role: near.vessel.kind === 'ship' ? 'pilot' : 'master', x: near.vessel.x, y: near.vessel.y, near: true });
  }

  /**
   * Put somebody's words on channel 16: one of the boats that live here answering a hail, say. Written among the
   * hails, and spoken if the browser can and the channel is clear.
   */
  transmit(tx: Transmission): void {
    this.air(tx);
  }

  // ---- voices --------------------------------------------------------------------------------------

  /** The voices worth using, best first. Looked up again whenever the browser's list changes. */
  private voices(): SpeechSynthesisVoice[] {
    if (this.pool) return this.pool;
    let all: SpeechSynthesisVoice[] = [];
    try {
      all = window.speechSynthesis?.getVoices() ?? [];
    } catch { /* no speech here */ }
    const pool = rankVoices(all);
    // An empty list may only mean the browser has not fetched it yet: ask again next time.
    if (!all.length) return pool;
    this.pool = pool;
    this.casts.clear();
    // The callers known beforehand are cast together, so the ship's pilot, the station and each ferry differ.
    const routes = this.ctx.stage.traffic.spec.routes.filter((r) => r.kind === 'ferry' || r.kind === 'ship');
    const known: Caller[] = [
      ...routes.filter((r) => r.kind === 'ship').map((r): Caller => ({ key: r.id, role: 'pilot' })),
      { key: 'station', role: 'station' },
      ...routes.filter((r) => r.kind === 'ferry').map((r): Caller => ({ key: r.id, role: 'master' })),
    ];
    for (const [key, cast] of castAll(pool, known)) this.casts.set(key, cast);
    return pool;
  }

  private cast(caller: Caller): Casting<SpeechSynthesisVoice> {
    const pool = this.voices();
    let cast = this.casts.get(caller.key);
    if (!cast) {
      cast = castVoice(pool, caller);
      if (this.pool) this.casts.set(caller.key, cast);
    }
    return cast;
  }

  // ---- on the air ----------------------------------------------------------------------------------

  /** A call wants the channel. It goes out now if the channel is clear, waits if another call is being spoken, and is only written if a real voice has it. */
  private air(tx: Transmission): void {
    if (!this.trafficOn && !tx.near) return;
    this.lastCallAt = this.ctx.sim.state.t;
    if (this.speaking || this.nextTimer !== null) {
      // One may wait, two at the most. Words meant for this boat go first; a scheduled call that finds the queue full is let go.
      if (tx.near) this.waiting.unshift(tx);
      else if (this.waiting.length < 2) this.waiting.push(tx);
      if (this.waiting.length > 2) this.waiting.length = 2;
      return;
    }
    this.send(tx);
  }

  private send(tx: Transmission): void {
    const { ctx } = this;
    ctx.heard(tx.from, tx.text);
    const vhf = this.set();
    // No sound yet means the player has not touched the page, and then the browser will not speak either.
    // A real voice has the channel: the words are written and that is all.
    if (!vhf || !this.trafficOn || this.talkers.size || this.wasTransmitting) {
      this.follow(tx.answer);
      return;
    }
    const s = ctx.sim.state;
    const { volume, hiss } = reception(tx.x === undefined || tx.y === undefined ? null : Math.hypot(tx.x - s.x, tx.y - s.y));
    const loud = volume * ctx.sound.level();
    const synth = window.speechSynthesis;
    const cast = this.cast({ key: tx.voice, role: tx.role, accent: tx.accent });
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined' || !cast.voice || loud <= 0.01) {
      // Nothing to speak with: the set still opens and shuts, so the line among the hails is heard to arrive.
      this.speaking = { words: [], bed: true, hiss, then: tx.answer };
      this.sync();
      this.speakTimer = setTimeout(() => this.finish(), 700);
      return;
    }
    const parts = sentences(spoken(tx.text));
    const words = parts.map((part) => {
      const u = new SpeechSynthesisUtterance(part);
      u.voice = cast.voice;
      u.lang = cast.lang;
      u.pitch = cast.pitch;
      u.rate = cast.rate;
      u.volume = Math.min(1, loud);
      return u;
    });
    const call = { words, bed: false, hiss, then: tx.answer };
    this.speaking = call;
    const begin = (): void => {
      if (this.speaking !== call || call.bed) return;
      call.bed = true;
      this.sync();
    };
    const end = (): void => {
      if (this.speaking === call) this.finish();
    };
    words[0].onstart = begin;
    words[words.length - 1].onend = end;
    for (const u of words) u.onerror = end;
    // If the browser never says it has started, or never says it has finished, the set carries on by the clock.
    this.bedTimer = setTimeout(begin, 600);
    this.speakTimer = setTimeout(() => {
      if (this.speaking !== call) return;
      try {
        synth.cancel();
      } catch { /* nothing to stop */ }
      this.finish();
    }, words.reduce((ms, u) => ms + speechAllowance(u.text, cast.rate), 0));
    this.sync();
    try {
      // A browser left paused by another page says nothing until it is told to carry on.
      synth.resume();
      for (const u of words) synth.speak(u);
    } catch {
      this.finish();
    }
  }

  /** The call is over: the squelch shuts, and whoever is next has the channel after a breath. */
  private finish(): void {
    const call = this.speaking;
    this.clearTimers();
    this.speaking = null;
    this.sync();
    this.follow(call?.then);
  }

  private follow(answer?: Transmission): void {
    if (answer) this.waiting.unshift(answer);
    if (!this.waiting.length || this.nextTimer !== null) return;
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      const next = this.waiting.shift();
      if (next) this.send(next);
    }, 650);
  }

  private clearTimers(): void {
    if (this.speakTimer !== null) clearTimeout(this.speakTimer);
    if (this.bedTimer !== null) clearTimeout(this.bedTimer);
    this.speakTimer = null;
    this.bedTimer = null;
  }

  /** Stop a call that is being spoken, and let go of any that were waiting: a real voice has the channel. */
  private hush(): void {
    this.waiting.length = 0;
    if (this.nextTimer !== null) clearTimeout(this.nextTimer);
    this.nextTimer = null;
    if (!this.speaking) return;
    const had = this.speaking.words.length > 0;
    this.speaking = null;
    this.clearTimers();
    if (had) {
      try {
        window.speechSynthesis?.cancel();
      } catch { /* nothing to stop */ }
    }
    this.sync();
  }
}
