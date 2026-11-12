import * as THREE from 'three';
import { Sim, type BoatSpec, type Environment } from '@slack-tide/sim';
import { BoatView, type BoatPose } from '../boat/boatView';
import type { Wave } from '../scene/waves';
import { waveHeight } from '../scene/waves';

/**
 * Shared water. Everyone who has the page open at the same time sees everyone else's boat.
 *
 * Each page runs its own boat and tells the room where she is a few times a second. Nothing is stored:
 * leave, and your boat is gone from the others' water. All boats sail in one clock, so they share one wind and tide:
 * whoever is furthest on in the season sets the time and the rest move up to it.
 *
 * The room is the claude.ai artifact runtime's. Anywhere else (a local build, a saved file) there is no room
 * and the game is simply single-handed.
 */

/** What one boat tells the others. Short keys: this goes out many times a second. */
interface Wire {
  x: number; y: number;
  /** heading, heel, rudder, boom, jib: radians x 1000 */
  h: number; l: number; r: number; b: number; j: number;
  /** apparent wind angle (rad x 1000) and speed (m/s x 10) */
  a: number; w: number;
  /** speed over ground (m/s x 100) and course over ground (rad x 1000) */
  s: number; c: number;
  /** main and jib luff, 0..100, and whether each is flogging */
  ml: number; jl: number; mf: number; jf: number;
  furl: number; reef: number;
  /** seconds into the season */
  t: number;
  /** This viewer's id from the platform, where it gives one, for looking up a name. */
  id?: string;
}

interface RoomPeer {
  peer: string;
  by: string | null;
  isMe: boolean;
  sameTab: boolean;
  kind: string;
  guest: boolean;
  presence: Readonly<Record<string, unknown>>;
  updatedAt: number;
}

interface Room {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly RoomPeer[];
  onPeers(handler: (change: { peers: readonly RoomPeer[] }) => void, onError?: (e: { code: string }) => void): () => void;
}

interface UserApi {
  id(): Promise<string | null>;
  profiles(ids: string[]): Promise<Record<string, { name: string }>>;
}

export interface RemoteBoat {
  peer: string;
  name: string;
  x: number;
  y: number;
  heading: number;
  cog: number;
  sog: number;
  /** Seconds into the season on that boat's clock, run forward to now. */
  seasonTime: number;
  guest: boolean;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const TINTS = [0x8f2f2a, 0x1f6b52, 0x6a4a1f, 0x4a2f6e, 0x2a5f7a];

class Remote implements RemoteBoat {
  readonly view: BoatView;
  readonly label = document.createElement('div');
  /** A sim used only as a holder for the state the view reads. It is never stepped. */
  private readonly holder: Sim;
  name = 'Another boat';
  x = 0; y = 0; heading = 0; cog = 0; sog = 0; seasonTime = 0; guest = false;
  private wire: Wire | null = null;
  private heardAt = 0;
  private placed = false;
  private readonly pos = new THREE.Vector3();
  private readonly motion = { heave: 0, pitch: 0 };
  private heel = 0;

  constructor(readonly peer: string, spec: BoatSpec, env: Environment, index: number, scene: THREE.Scene) {
    this.holder = new Sim(spec, env, {});
    this.view = new BoatView(spec);
    // Each visiting boat gets her own topsides colour so the fleet can be told apart.
    const hull = this.view.model.nodes.hull as THREE.Mesh | undefined;
    if (hull) {
      const mat = (hull.material as THREE.MeshStandardMaterial).clone();
      mat.map = null;
      mat.color.setHex(TINTS[index % TINTS.length]);
      mat.needsUpdate = true;
      hull.material = mat;
    }
    scene.add(this.view.root);
    this.label.className = 'boat-label';
    document.body.appendChild(this.label);
  }

  hear(p: RoomPeer, now: number): void {
    const v = p.presence;
    if (typeof v.x !== 'number' || typeof v.y !== 'number') return;
    this.wire = {
      x: num(v.x), y: num(v.y), h: num(v.h), l: num(v.l), r: num(v.r), b: num(v.b), j: num(v.j), a: num(v.a), w: num(v.w),
      s: num(v.s), c: num(v.c), ml: num(v.ml), jl: num(v.jl), mf: num(v.mf), jf: num(v.jf), furl: num(v.furl, 1), reef: num(v.reef), t: num(v.t),
      id: typeof v.id === 'string' ? v.id : undefined,
    };
    this.heardAt = now;
    this.guest = p.guest;
  }

  get userId(): string | undefined {
    return this.wire?.id;
  }

  /** Seconds since this boat last said anything. */
  silence(now: number): number {
    return (now - this.heardAt) / 1000;
  }

  update(now: number, seaTime: number, waves: Wave[], dt: number, camera: THREE.Camera, width: number, height: number): void {
    const w = this.wire;
    if (!w) {
      this.view.root.visible = false;
      this.label.style.display = 'none';
      return;
    }
    // Run her on from her last report along her course, for a couple of seconds at most.
    const age = Math.min(2.5, (now - this.heardAt) / 1000);
    this.sog = w.s / 100;
    this.cog = w.c / 1000;
    const tx = w.x + Math.sin(this.cog) * this.sog * age;
    const ty = w.y + Math.cos(this.cog) * this.sog * age;
    const k = this.placed ? Math.min(1, dt * 6) : 1;
    this.placed = true;
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    const turn = (to: number, from: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;
    this.heading = turn(w.h / 1000, this.heading);
    this.heel += (w.l / 1000 - this.heel) * k;
    this.seasonTime = w.t + (now - this.heardAt) / 1000;

    const s = this.holder.state;
    const o = this.holder.out;
    s.x = this.x; s.y = this.y; s.heading = this.heading; s.heel = this.heel;
    s.rudder = w.r / 1000; s.boomAngle = w.b / 1000; s.jibAngle = w.j / 1000;
    s.furl = w.furl; s.reef = Math.max(0, Math.min(2, Math.round(w.reef)));
    s.speed = this.sog; s.mainSide = Math.sign(s.boomAngle) || 1;
    o.awa = w.a / 1000; o.aws = w.w / 10; o.sog = this.sog; o.cog = this.cog;
    o.twa = o.awa; o.tws = o.aws;
    o.main.luff = w.ml / 100; o.main.flogging = w.mf > 0; o.main.stall = 0;
    o.jib.luff = w.jl / 100; o.jib.flogging = w.jf > 0; o.jib.stall = 0; o.jib.backed = 0;

    const z = -this.y;
    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const bow = waveHeight(waves, this.x + fx * 4.2, z + fz * 4.2, seaTime);
    const stern = waveHeight(waves, this.x - fx * 4.2, z - fz * 4.2, seaTime);
    this.motion.heave += ((bow + stern) / 2 - this.motion.heave) * Math.min(1, dt * 5);
    this.motion.pitch += (Math.atan2(bow - stern, 8.4) * 0.8 - this.motion.pitch) * Math.min(1, dt * 5);
    const pose: BoatPose = {
      x: this.x, z, heading: this.heading, heel: this.heel, pitch: this.motion.pitch, heave: this.motion.heave - 0.03,
      rudder: s.rudder, boom: s.boomAngle, jib: s.jibAngle,
    };
    this.view.root.visible = true;
    this.view.update(pose, s, o, seaTime, dt);

    // Her name above the masthead.
    this.pos.set(this.x, 19, z).project(camera);
    const shown = this.pos.z < 1 && Math.abs(this.pos.x) < 1.1 && Math.abs(this.pos.y) < 1.1;
    this.label.style.display = shown ? 'block' : 'none';
    if (shown) {
      const text = `${this.name} · ${(this.sog / 0.514444).toFixed(1)} kt`;
      if (this.label.textContent !== text) this.label.textContent = text;
      this.label.style.transform = `translate(-50%, -100%) translate(${Math.round(((this.pos.x + 1) / 2) * width)}px, ${Math.round(((1 - this.pos.y) / 2) * height)}px)`;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.view.root);
    this.label.remove();
  }
}

export class Fleet {
  /** The other boats here now. */
  readonly boats: RemoteBoat[] = [];
  private room: Room | null = null;
  private user: UserApi | null = null;
  private myId: string | null = null;
  private readonly remotes = new Map<string, Remote>();
  private sendClock = 0;
  private nameClock = 0;
  private count = 0;

  constructor(private readonly spec: BoatSpec, private readonly env: Environment, private readonly scene: THREE.Scene) {}

  /** Join the room if this page is somewhere that has one. Resolves either way. */
  async connect(): Promise<void> {
    try {
      const claude = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
      if (!claude?.use) return;
      const room = (await claude.use('room')) as Room | null;
      if (!room) return;
      this.room = room;
      room.onPeers((change) => this.hear(change.peers), () => { this.room = null; this.clear(); });
      this.user = (await claude.use('user')) as UserApi | null;
      this.myId = (await this.user?.id()) ?? null;
    } catch {
      this.room = null;
    }
  }

  get connected(): boolean {
    return this.room !== null;
  }

  private hear(peers: readonly RoomPeer[]): void {
    const now = Date.now();
    const seen = new Set<string>();
    for (const p of peers) {
      // This tab's own boat is already on screen. A second tab of the same person is a second boat.
      if (p.sameTab || p.kind !== 'viewer') continue;
      if (typeof p.presence?.x !== 'number') continue;
      seen.add(p.peer);
      let r = this.remotes.get(p.peer);
      if (!r) {
        if (this.remotes.size >= 8) continue;
        r = new Remote(p.peer, this.spec, this.env, this.count++, this.scene);
        this.remotes.set(p.peer, r);
        this.nameClock = 0;
      }
      r.hear(p, now);
    }
    for (const [peer, r] of this.remotes) {
      if (!seen.has(peer)) {
        r.dispose(this.scene);
        this.remotes.delete(peer);
      }
    }
    this.boats.length = 0;
    this.boats.push(...this.remotes.values());
  }

  private clear(): void {
    for (const r of this.remotes.values()) r.dispose(this.scene);
    this.remotes.clear();
    this.boats.length = 0;
  }

  /**
   * Tell the room where this boat is, draw the others, and report how far ahead the furthest-on clock is.
   * @returns seconds this boat's season clock is behind the furthest-on boat (0 if none is ahead)
   */
  update(sim: Sim, seasonTime: number, seaTime: number, waves: Wave[], dt: number, camera: THREE.Camera, width: number, height: number): number {
    if (!this.room) return 0;
    const now = Date.now();
    this.sendClock -= dt;
    if (this.sendClock <= 0) {
      this.sendClock = 0.15;
      const s = sim.state;
      const o = sim.out;
      const k = (v: number) => Math.round(v * 1000);
      const wire: Wire = {
        x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10,
        h: k(s.heading), l: k(s.heel), r: k(s.rudder), b: k(s.boomAngle), j: k(s.jibAngle),
        a: k(o.awa), w: Math.round(o.aws * 10), s: Math.round(o.sog * 100), c: k(o.cog),
        ml: Math.round(o.main.luff * 100), jl: Math.round(o.jib.luff * 100), mf: o.main.flogging ? 1 : 0, jf: o.jib.flogging ? 1 : 0,
        furl: Math.round(s.furl * 100) / 100, reef: s.reef, t: Math.round(seasonTime * 10) / 10,
      };
      if (this.myId) wire.id = this.myId;
      this.room.presence(wire as unknown as Record<string, unknown>).catch(() => {});
    }

    let ahead = 0;
    for (const r of this.remotes.values()) {
      r.update(now, seaTime, waves, dt, camera, width, height);
      // A boat that has gone quiet (a hidden tab) does not hold the clock.
      if (r.silence(now) < 5) ahead = Math.max(ahead, r.seasonTime - seasonTime);
    }

    // Names come from the platform, as this viewer is allowed to see them.
    this.nameClock -= dt;
    if (this.nameClock <= 0 && this.user && this.remotes.size) {
      this.nameClock = 20;
      const ids = [...this.remotes.values()].map((r) => r.userId).filter((id): id is string => !!id);
      if (ids.length) {
        this.user.profiles(ids).then((ps) => {
          for (const r of this.remotes.values()) {
            const n = r.userId ? ps[r.userId]?.name : '';
            if (n) r.name = n.split(' ')[0];
          }
        }).catch(() => {});
      }
    }
    return ahead;
  }
}
