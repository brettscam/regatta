import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Mic, Voice, VoiceHost, VoiceState } from '../platform';
import { TURN } from './config';
import { ANNOUNCE_GAP, CONNECT_WAIT, DROPPED_WAIT, GATHER_WAIT, GONE_WAIT, SIGNAL_GAP, hasRoom, iceServers, offerDelay, unraised, yields } from './voicePlan';

/**
 * The voice radio on the website: push to talk between the boats on one water.
 *
 * Voice goes from browser to browser over WebRTC, one connection for each pair of boats (a mesh), and nowhere else.
 * Nothing is recorded and nothing is stored. Supabase only carries the few messages two browsers need to find each
 * other, on a Realtime channel of its own, `voice:<area>`, apart from the boats' positions.
 *
 * - A page joins that channel but says nothing on it, and opens no connections, until its radio is switched on:
 *   by its player keying up, or by hearing another boat announce (`on`) that she has.
 * - A boat that keys up announces herself if there is a boat on the water she has no connection to. Every radio that
 *   hears it and is not connected to her offers her a connection (`o`), and she answers (`a`). Each of those carries
 *   its own network candidates, so a pair is two messages, with a third or fourth (`c`) only for candidates the
 *   browser found late. A page that already has as many connections as it can carry says so instead (`full`).
 * - Every connection is made with a two-way audio line from the start, with nothing on it. When the player first
 *   keys up the microphone is put on that line, so nothing has to be agreed again. The microphone track is switched
 *   off except while the key is held. Who is keyed goes over the connection itself (a data channel), not over Supabase.
 * - A connection is closed when the far side closes it, when it fails, when it has been down for a few seconds, or
 *   when its boat has been gone from the water for half a minute.
 *   A page hidden for half a minute stops its microphone and leaves altogether.
 *
 * What another page sends is that page's word, so every message is checked before use.
 */

interface Link {
  peer: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  sender: RTCRtpSender | null;
  /** True when this page made the offer. */
  offered: boolean;
  made: number;
  /** When the connection was last seen down, and when its boat was last missed from the water. 0 for neither. */
  downSince: number;
  missedSince: number;
  /** True once the offer or answer has gone, after which a candidate has to be sent on its own. */
  described: boolean;
  late: RTCIceCandidateInit[];
  lateTimer: ReturnType<typeof setTimeout> | null;
  lateSent: number;
  /** Candidates from the far side that arrived before its description. */
  early: RTCIceCandidateInit[];
  keyed: boolean;
  stream: MediaStream | null;
  /** The received stream in the game's audio: its source, its own gate, and the silent element that keeps it running. */
  source: MediaStreamAudioSourceNode | null;
  gate: GainNode | null;
  element: HTMLAudioElement | null;
}

type Signal = { t: string; p: string; to?: string; d?: unknown };

const HIDDEN_LEAVE = 30000;
const REMAKE_AFTER = 15000;
const MAX_SDP = 20000;
const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

export class VoiceMesh implements Voice {
  private host: VoiceHost | null = null;
  private channel: RealtimeChannel | null = null;
  private joined = false;
  private downSince = 0;
  private on = false;
  /** True while the player holds the key, whether or not the microphone is ready yet. */
  private keyDown = false;
  private transmitting = false;
  private mic: Mic = 'unasked';
  private track: MediaStreamTrack | null = null;
  private asking: Promise<Mic> | null = null;
  private crowded = false;
  private readonly links = new Map<string, Link>();
  private readonly told = new Set<string>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly queue: Signal[] = [];
  private pump: ReturnType<typeof setTimeout> | null = null;
  private lastSend = 0;
  private lastAnnounce = 0;
  private wantAnnounce = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** For measuring: signalling messages sent and heard since the page opened, by kind. */
  readonly counts = { sent: {} as Record<string, number>, heard: {} as Record<string, number> };

  constructor(private readonly client: SupabaseClient, readonly area: string, readonly me: string) {}

  // ---- what the game sees ------------------------------------------------------------------------

  open(host: VoiceHost): void {
    this.host = host;
    if (this.ticker !== null || this.closed) return;
    this.join();
    this.ticker = setInterval(() => this.tick(), 1000);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onHide);
    window.addEventListener('pageshow', this.onShow);
  }

  async transmit(down: boolean): Promise<Mic> {
    this.keyDown = down;
    if (!down) {
      this.unkey();
      return this.mic;
    }
    if (this.closed || !this.host) return this.mic;
    this.switchOn();
    this.join();
    // Start raising the other boats while the browser is still asking about the microphone.
    this.announce();
    if (this.mic === 'refused' || this.mic === 'missing') return this.mic;
    if (!this.track) await (this.asking ??= this.ask());
    if (this.keyDown && this.track && !this.transmitting) {
      this.track.enabled = true;
      this.transmitting = true;
      this.tellKeyed();
    }
    return this.mic;
  }

  state(): VoiceState {
    let linked = 0;
    for (const l of this.links.values()) if (l.pc.connectionState === 'connected') linked++;
    const company = this.host?.company() ?? [];
    const raising = this.on ? unraised(company, (p) => this.links.get(p)?.pc.connectionState === 'connected').length : 0;
    return { on: this.on, transmitting: this.transmitting, mic: this.mic, linked, raising, crowded: this.crowded };
  }

  close(): void {
    this.closed = true;
    this.sleep();
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onHide);
    window.removeEventListener('pageshow', this.onShow);
  }

  /** For measuring and for tests: each connection's state, and the connections themselves. */
  debug(): { links: Array<{ peer: string; state: string; keyed: boolean; pc: RTCPeerConnection }>; joined: boolean; micLive: boolean; micOpen: boolean } {
    return {
      links: [...this.links.values()].map((l) => ({ peer: l.peer, state: l.pc.connectionState, keyed: l.keyed, pc: l.pc })),
      joined: this.joined,
      micLive: this.track !== null && this.track.readyState === 'live',
      micOpen: this.track !== null && this.track.enabled,
    };
  }

  // ---- the microphone ----------------------------------------------------------------------------

  private async ask(): Promise<Mic> {
    this.mic = 'asking';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('no microphone here', 'NotFoundError');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new DOMException('no microphone here', 'NotFoundError');
      // Shut until the key is held, and again every time it is let go.
      track.enabled = false;
      if (this.closed || !this.on) {
        track.stop();
        this.mic = 'unasked';
        return this.mic;
      }
      this.track = track;
      this.mic = 'live';
      track.addEventListener('ended', () => {
        if (this.track !== track) return;
        this.unkey();
        this.track = null;
        this.mic = 'unasked';
      });
      for (const l of this.links.values()) void l.sender?.replaceTrack(track).catch(() => {});
    } catch (e) {
      const name = (e as { name?: string } | null)?.name ?? '';
      this.mic = name === 'NotAllowedError' || name === 'SecurityError' ? 'refused' : 'missing';
    } finally {
      this.asking = null;
    }
    return this.mic;
  }

  private unkey(): void {
    if (this.track) this.track.enabled = false;
    if (!this.transmitting) return;
    this.transmitting = false;
    this.tellKeyed();
  }

  private tellKeyed(): void {
    for (const l of this.links.values()) this.sayKeyed(l);
  }

  private sayKeyed(l: Link): void {
    if (l.dc.readyState !== 'open') return;
    try {
      l.dc.send(this.transmitting ? 'k1' : 'k0');
    } catch { /* the connection is going; its closing tells the far side */ }
  }

  private dropMic(): void {
    this.unkey();
    const track = this.track;
    this.track = null;
    if (track) {
      track.stop();
      for (const l of this.links.values()) void l.sender?.replaceTrack(null).catch(() => {});
    }
    if (this.mic === 'live' || this.mic === 'asking') this.mic = 'unasked';
  }

  // ---- the signalling channel --------------------------------------------------------------------

  private join(): void {
    if (this.channel || this.closed || !this.host || document.visibilityState === 'hidden') return;
    const ch = this.client.channel(`voice:${this.area}`, { config: { broadcast: { self: false, ack: false } } });
    this.channel = ch;
    this.downSince = Date.now();
    ch.on('broadcast', { event: 'v' }, (message) => this.hear(message.payload));
    ch.subscribe((status) => {
      if (this.channel !== ch) return;
      this.joined = status === 'SUBSCRIBED';
      if (!this.joined) {
        if (!this.downSince) this.downSince = Date.now();
        return;
      }
      this.downSince = 0;
      if (this.wantAnnounce) this.announce();
      this.plan();
    });
  }

  private leave(): void {
    const ch = this.channel;
    this.channel = null;
    this.joined = false;
    this.queue.length = 0;
    if (this.pump !== null) clearTimeout(this.pump);
    this.pump = null;
    if (ch) void this.client.removeChannel(ch).catch(() => {});
  }

  private post(signal: Signal): void {
    this.queue.push(signal);
    this.plan();
  }

  /** Send what is waiting, one message at a time with a gap between. */
  private plan(): void {
    if (this.pump !== null || !this.queue.length || !this.joined) return;
    this.pump = setTimeout(() => {
      this.pump = null;
      const signal = this.queue.shift();
      if (signal && this.joined && this.channel) {
        this.lastSend = Date.now();
        this.counts.sent[signal.t] = (this.counts.sent[signal.t] ?? 0) + 1;
        void this.channel.send({ type: 'broadcast', event: 'v', payload: signal }).catch(() => {});
      }
      this.plan();
    }, Math.max(0, this.lastSend + SIGNAL_GAP - Date.now()));
  }

  /** Tell the water this radio is on, if there is a boat here it has no connection to. */
  private announce(): void {
    if (!this.on || !this.host) return;
    if (!unraised(this.host.company(), (p) => this.links.has(p)).length) return;
    if (!this.joined) {
      this.wantAnnounce = true;
      return;
    }
    if (Date.now() - this.lastAnnounce < ANNOUNCE_GAP) return;
    this.wantAnnounce = false;
    this.lastAnnounce = Date.now();
    this.post({ t: 'on', p: this.me });
  }

  private switchOn(): void {
    this.on = true;
  }

  private hear(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const { t, p, to, d } = message as { t?: unknown; p?: unknown; to?: unknown; d?: unknown };
    if (typeof t !== 'string' || !okId(p) || p === this.me) return;
    if (to !== undefined && to !== this.me) return;
    this.counts.heard[t] = (this.counts.heard[t] ?? 0) + 1;
    if (t === 'on') this.heardOn(p);
    else if (t === 'o' && to === this.me && typeof d === 'string' && d.length < MAX_SDP) void this.heardOffer(p, d).catch(() => this.drop(p));
    else if (t === 'a' && to === this.me && typeof d === 'string' && d.length < MAX_SDP) void this.heardAnswer(p, d).catch(() => this.drop(p));
    else if (t === 'c' && to === this.me && Array.isArray(d)) this.heardCandidates(p, d.slice(0, 24));
    else if (t === 'full' && to === this.me) this.crowded = true;
  }

  /** Another boat's radio has come on. If this one has no connection to her, offer one, after a moment. */
  private heardOn(peer: string): void {
    // Somebody has keyed up: that switches this radio on too, to listen.
    this.switchOn();
    const have = this.links.get(peer);
    if (have) {
      const state = have.pc.connectionState;
      // She is asking again, so she has no connection to this page: one that is not up by now never will be.
      if (state === 'connected' || Date.now() - have.made < 8000) return;
      this.drop(peer);
    }
    if (this.pending.has(peer)) return;
    if (!hasRoom(this.links.size + this.pending.size)) {
      this.refuse(peer);
      return;
    }
    const wait = offerDelay(this.host?.company().length ?? 1, Math.random());
    this.pending.set(peer, setTimeout(() => {
      this.pending.delete(peer);
      if (this.links.has(peer) || !this.on) return;
      void this.offer(peer).catch(() => this.drop(peer));
    }, wait));
  }

  private refuse(peer: string): void {
    this.crowded = true;
    if (this.told.has(peer)) return;
    this.told.add(peer);
    this.post({ t: 'full', p: this.me, to: peer });
  }

  // ---- one connection ----------------------------------------------------------------------------

  private make(peer: string, offered: boolean): Link {
    const pc = new RTCPeerConnection({ iceServers: iceServers(TURN) });
    // The same channel number agreed on both sides, so it needs no messages of its own.
    const dc = pc.createDataChannel('key', { negotiated: true, id: 0 });
    const link: Link = {
      peer, pc, dc, sender: null, offered, made: Date.now(), downSince: 0, missedSince: 0, described: false,
      late: [], lateTimer: null, lateSent: 0, early: [], keyed: false, stream: null, source: null, gate: null, element: null,
    };
    this.links.set(peer, link);
    pc.onicecandidate = (e) => {
      if (!e.candidate || !link.described || link.lateSent >= 2) return;
      link.late.push(e.candidate.toJSON());
      link.lateTimer ??= setTimeout(() => {
        link.lateTimer = null;
        if (this.links.get(peer) !== link || !link.late.length) return;
        link.lateSent++;
        this.post({ t: 'c', p: this.me, to: peer, d: link.late.splice(0) });
      }, 600);
    };
    pc.ontrack = (e) => {
      link.stream = e.streams[0] ?? new MediaStream([e.track]);
      this.attach(link);
    };
    pc.onconnectionstatechange = () => {
      if (this.links.get(peer) !== link) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(peer);
      // A boat that vanishes with her key down cannot say she has let go.
      else if (pc.connectionState === 'disconnected') this.setKeyed(link, false);
    };
    let opened = false;
    dc.onopen = () => {
      opened = true;
      if (this.transmitting) this.sayKeyed(link);
    };
    dc.onmessage = (e) => {
      if (e.data === 'k1') this.setKeyed(link, true);
      else if (e.data === 'k0') this.setKeyed(link, false);
    };
    // The far side closing its end is how a boat that has left is noticed at once, without waiting for the silence.
    dc.onclose = () => {
      this.setKeyed(link, false);
      if (opened && this.links.get(peer) === link) this.drop(peer);
    };
    return link;
  }

  private async offer(peer: string): Promise<void> {
    const link = this.make(peer, true);
    const line = link.pc.addTransceiver('audio', { direction: 'sendrecv' });
    link.sender = line.sender;
    if (this.track) await line.sender.replaceTrack(this.track);
    await link.pc.setLocalDescription(await link.pc.createOffer());
    await this.gathered(link.pc);
    if (this.links.get(peer) !== link) return;
    link.described = true;
    this.post({ t: 'o', p: this.me, to: peer, d: link.pc.localDescription?.sdp ?? '' });
  }

  private async heardOffer(peer: string, sdp: string): Promise<void> {
    this.switchOn();
    const waiting = this.pending.get(peer);
    if (waiting !== undefined) {
      clearTimeout(waiting);
      this.pending.delete(peer);
    }
    const have = this.links.get(peer);
    if (have) {
      // Both offered at once: one of the two gives way. Any other offer means she has started again, so this side does too.
      if (have.offered && have.pc.signalingState === 'have-local-offer' && !yields(this.me, peer)) return;
      this.drop(peer);
    }
    if (!hasRoom(this.links.size)) {
      this.refuse(peer);
      return;
    }
    const link = this.make(peer, false);
    await link.pc.setRemoteDescription({ type: 'offer', sdp });
    for (const line of link.pc.getTransceivers()) {
      if (line.receiver.track.kind !== 'audio') continue;
      line.direction = 'sendrecv';
      link.sender = line.sender;
      if (this.track) await line.sender.replaceTrack(this.track);
    }
    this.addEarly(link);
    await link.pc.setLocalDescription(await link.pc.createAnswer());
    await this.gathered(link.pc);
    if (this.links.get(peer) !== link) return;
    link.described = true;
    this.post({ t: 'a', p: this.me, to: peer, d: link.pc.localDescription?.sdp ?? '' });
  }

  private async heardAnswer(peer: string, sdp: string): Promise<void> {
    const link = this.links.get(peer);
    if (!link || !link.offered || link.pc.signalingState !== 'have-local-offer') return;
    await link.pc.setRemoteDescription({ type: 'answer', sdp });
    this.addEarly(link);
  }

  private heardCandidates(peer: string, list: unknown[]): void {
    const link = this.links.get(peer);
    if (!link) return;
    for (const c of list) {
      if (!c || typeof c !== 'object' || typeof (c as { candidate?: unknown }).candidate !== 'string') continue;
      link.early.push(c as RTCIceCandidateInit);
    }
    if (link.pc.remoteDescription) this.addEarly(link);
  }

  private addEarly(link: Link): void {
    for (const c of link.early.splice(0)) void link.pc.addIceCandidate(c).catch(() => {});
  }

  /** Resolves when the browser has found its network candidates, or after a short wait with those it has. */
  private gathered(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = (): void => { if (pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, GATHER_WAIT);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  private setKeyed(link: Link, on: boolean): void {
    if (link.keyed === on) return;
    link.keyed = on;
    this.attach(link);
    if (link.gate) link.gate.gain.setTargetAtTime(on ? 1 : 0, link.gate.context.currentTime, 0.012);
    this.host?.talking(link.peer, on);
  }

  /** Put a received voice into the game's sound, once there is both a voice and a sound to put it in. */
  private attach(link: Link): void {
    if (link.source || !link.stream) return;
    const audio = this.host?.audio();
    if (!audio) return;
    // Chrome only runs a received stream while some element is playing it. This one is silent: the sound comes from the graph.
    const element = new Audio();
    element.muted = true;
    element.srcObject = link.stream;
    void element.play().catch(() => {});
    link.element = element;
    link.source = audio.ctx.createMediaStreamSource(link.stream);
    link.gate = audio.ctx.createGain();
    link.gate.gain.value = link.keyed ? 1 : 0;
    link.source.connect(link.gate).connect(audio.input);
  }

  private drop(peer: string): void {
    const waiting = this.pending.get(peer);
    if (waiting !== undefined) clearTimeout(waiting);
    this.pending.delete(peer);
    const link = this.links.get(peer);
    if (!link) return;
    this.links.delete(peer);
    if (link.lateTimer !== null) clearTimeout(link.lateTimer);
    link.pc.onconnectionstatechange = null;
    link.pc.onicecandidate = null;
    link.pc.ontrack = null;
    link.dc.onclose = null;
    link.dc.onmessage = null;
    try {
      link.dc.close();
      link.pc.close();
    } catch { /* already gone */ }
    link.source?.disconnect();
    link.gate?.disconnect();
    if (link.element) link.element.srcObject = null;
    if (link.keyed) {
      link.keyed = false;
      this.host?.talking(peer, false);
    }
  }

  // ---- keeping house -----------------------------------------------------------------------------

  private tick(): void {
    const now = Date.now();
    const company = this.host?.company() ?? [];
    for (const link of [...this.links.values()]) {
      this.attach(link);
      const state = link.pc.connectionState;
      if (state === 'connected') link.downSince = 0;
      else if (!link.downSince) link.downSince = now;
      link.missedSince = company.includes(link.peer) ? 0 : link.missedSince || now;
      const never = state !== 'connected' && now - link.made > CONNECT_WAIT && now - link.downSince > DROPPED_WAIT;
      const dropped = state === 'disconnected' && now - link.downSince > DROPPED_WAIT;
      const gone = link.missedSince > 0 && now - link.missedSince > GONE_WAIT;
      if (never || dropped || gone) this.drop(link.peer);
    }
    for (const peer of this.told) if (!company.includes(peer)) this.told.delete(peer);
    if (this.crowded && hasRoom(this.links.size) && !this.told.size) this.crowded = false;
    // A boat that has arrived, or lost her connection, while this one is talking is raised now rather than at the next key.
    if (this.transmitting || this.keyDown) this.announce();
    // A channel that has not come back by itself is made again. Connections already up do not need it.
    if (this.channel && !this.joined && this.downSince && now - this.downSince > REMAKE_AFTER && document.visibilityState !== 'hidden') {
      this.leave();
      this.join();
    }
  }

  /** Stop the microphone, drop every connection and leave the channel. The radio is off until it is wanted again. */
  private sleep(): void {
    this.keyDown = false;
    this.dropMic();
    for (const peer of [...this.links.keys(), ...this.pending.keys()]) this.drop(peer);
    this.leave();
    this.on = false;
    this.crowded = false;
    this.told.clear();
  }

  private readonly onVisibility = (): void => {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (document.visibilityState === 'hidden') {
      // Nobody talks from a tab they cannot see.
      this.keyDown = false;
      this.unkey();
      this.hideTimer = setTimeout(() => this.sleep(), HIDDEN_LEAVE);
    } else this.join();
  };
  private readonly onHide = (): void => this.sleep();
  private readonly onShow = (): void => { if (document.visibilityState !== 'hidden') this.join(); };
}
