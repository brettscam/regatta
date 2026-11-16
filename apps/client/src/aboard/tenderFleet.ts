import { readAvatar } from '../boat/avatar';
import type { AboardContext } from './feature';
import { groundHeight, type HeightGrid } from './paddle';
import { buildTender, type TenderModel } from './tenderModel';
import { TenderTrack } from './tenderTrack';
import { TenderWake } from './tenderWake';
import type { WakeVessel } from '../scene/wake';
import { tenderById, type TenderSpec } from './tenders';

const KT = 0.514444;

/** How a tender sits on the sea, eased from frame to frame. */
export interface Ride {
  heave: number;
  pitch: number;
  heel: number;
  set: boolean;
}

export const newRide = (): Ride => ({ heave: 0, pitch: 0, heel: 0, set: false });

/**
 * Sit a tender on the sea, or on the beach where the ground comes up under her.
 * @param trim bow up, radians, on top of what the waves give her
 * @param lean bank to starboard, radians, likewise
 * @param lift metres clear of the water
 */
export function sit(ctx: AboardContext, ground: HeightGrid | null, model: TenderModel, ride: Ride, x: number, y: number, heading: number, dt: number, seaTime: number, trim = 0, lean = 0, lift = 0): void {
  const z = -y;
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  const under = (px: number, pz: number): number => {
    const sea = ctx.stage.seaLevel(px, pz, seaTime, 6);
    return ground ? Math.max(sea, groundHeight(ground, px, -pz) + 0.1) : sea;
  };
  const half = model.length * 0.36;
  const beam = model.halfBeam * 2;
  const bow = under(x + fx * half, z + fz * half);
  const stern = under(x - fx * half, z - fz * half);
  const mid = under(x, z);
  const port = under(x + fz * beam, z - fx * beam);
  const heave = (bow + stern + 2 * mid) / 4;
  const pitch = Math.atan2(bow - stern, half * 2) * 0.9;
  const heel = Math.atan2(port - mid, beam) * 0.6;
  const ease = ride.set ? Math.min(1, dt * 7) : 1;
  ride.set = true;
  ride.heave += (heave - ride.heave) * ease;
  ride.pitch += (pitch - ride.pitch) * ease;
  ride.heel += (heel - ride.heel) * ease;
  // In the air she has left the sea's slope behind.
  const wet = lift > 0.02 ? 0.3 : 1;
  model.place(x, ride.heave + 0.01 + lift, z, heading, ride.pitch * wet + trim, ride.heel * wet + lean);
}

/** Another boat's tender, as this page has it. */
export interface SeenTender {
  peer: string;
  /** Whose she is, for a line about her. */
  owner: string;
  spec: TenderSpec;
  x: number;
  y: number;
  heading: number;
  speed: number;
  ashore: boolean;
}

interface Entry {
  key: string;
  spec: TenderSpec;
  model: TenderModel;
  wake: TenderWake | null;
  track: TenderTrack;
  ride: Ride;
  at: number;
  avatar: string;
  lean: number;
  seen: SeenTender;
  /** Her in the sea's drawn wakes (`stage.craft`), while she is under way under power. */
  drawn: WakeVessel;
}

/**
 * The other boats' tenders. Each boat says where hers is in `oc` (see `tenders.ts`); the fleet checks it on the way in,
 * and here it is drawn: the right craft in her yacht's colour with her skipper in it, run on between reports
 * (`tenderTrack.ts`), with a wake if she has an engine.
 */
export class TenderFleet {
  /** The tenders out now. Rebuilt in place every frame. */
  readonly out: SeenTender[] = [];
  private readonly entries = new Map<string, Entry>();
  private clock = 0;

  constructor(private readonly ctx: AboardContext, private readonly ground: HeightGrid | null) {}

  update(dt: number, seaTime: number): void {
    const { ctx, entries } = this;
    this.clock += dt;
    const now = Date.now() / 1000;
    this.out.length = 0;
    let live = 0;
    for (const boat of ctx.company()) {
      const report = boat.tender;
      const spec = report ? tenderById(report.kind) : undefined;
      if (!report || !spec) continue;
      live++;
      const key = `${spec.id}|${boat.colour}`;
      let e = entries.get(boat.peer);
      if (e && e.key !== key) {
        this.drop(e);
        e = undefined;
      }
      if (!e) {
        const avatar = boat.avatar;
        const model = buildTender(spec, boat.colour || undefined, avatar ? readAvatar(avatar) : undefined);
        ctx.stage.scene.add(model.root);
        e = {
          key, spec, model, avatar, wake: spec.drive === 'paddle' ? null : new TenderWake(ctx.stage.scene, (x, z, t, n) => ctx.stage.seaLevel(x, z, t, n)),
          track: new TenderTrack(), ride: newRide(), at: -1, lean: 0,
          drawn: { id: `tender-${boat.peer}`, x: 0, z: 0, heading: 0, speed: 0, length: model.length, beam: model.halfBeam * 2, lee: 0 },
          seen: { peer: boat.peer, owner: boat.boatName || boat.name || 'another boat', spec, x: 0, y: 0, heading: 0, speed: 0, ashore: false },
        };
        entries.set(boat.peer, e);
      }
      if (boat.avatar !== e.avatar && boat.avatar) e.model.setAvatar(readAvatar((e.avatar = boat.avatar)));
      if (boat.tenderAt !== e.at) {
        e.at = boat.tenderAt;
        e.track.hear(report, boat.tenderAt / 1000);
      }
      const before = e.track.heading;
      e.track.update(now, dt);
      const t = e.track;
      const top = spec.topKt * KT;
      const plane = spec.planeKt ? Math.max(0, Math.min(1, (t.speed - spec.planeKt * KT * 0.8) / (spec.planeKt * KT * 0.3))) : 0;
      // Her bank is not sent: it is read back off how fast she is seen to turn.
      const turning = dt > 0 ? Math.atan2(Math.sin(t.heading - before), Math.cos(t.heading - before)) / dt : 0;
      const bank = Math.max(-0.7, Math.min(0.7, Math.atan2(turning * t.speed, 9.81) * (spec.lean ?? 0)));
      e.lean += (bank - e.lean) * Math.min(1, dt * 4);
      const trim = spec.planeKt ? 0.07 * plane + 0.1 * Math.max(0, Math.min(1, t.speed / (spec.planeKt * KT))) * (1 - plane) : 0;
      e.model.setManned(!t.ashore);
      sit(ctx, this.ground, e.model, e.ride, t.x, t.y, t.heading, dt, seaTime, trim, e.lean);
      const work = t.speed > 0.3 ? Math.min(1, t.speed / (spec.cruiseKt * KT)) : t.speed < -0.2 ? -1 : 0;
      e.model.animate(dt, spec.drive === 'paddle' ? Math.sign(work) : work, Math.abs(turning) > 0.08 ? Math.sign(turning) : 0, this.clock);
      e.wake?.update(t.ashore ? null : { x: t.x, y: t.y, heading: t.heading, speed: t.speed, plane, throttle: Math.min(1, t.speed / top), hop: 0, length: e.model.length, halfBeam: e.model.halfBeam, jet: spec.drive === 'jet' }, dt, seaTime);
      const d = e.drawn;
      const craft = ctx.stage.craft;
      const at = craft.indexOf(d);
      if (spec.drive !== 'paddle' && !t.ashore && t.speed > 0.5) {
        d.x = t.x; d.z = -t.y; d.heading = t.heading; d.speed = t.speed; d.lee = Math.max(-1, Math.min(1, -e.lean / 0.3));
        if (at < 0) craft.push(d);
      } else if (at >= 0) craft.splice(at, 1);
      const s = e.seen;
      s.x = t.x; s.y = t.y; s.heading = t.heading; s.speed = t.speed; s.ashore = t.ashore;
      s.owner = boat.boatName || boat.name || 'another boat';
      this.out.push(s);
    }
    // Whoever has stowed hers, or gone.
    if (entries.size > live) {
      const here = new Set(this.out.map((s) => s.peer));
      for (const [peer, e] of entries) {
        if (here.has(peer)) continue;
        this.drop(e);
        entries.delete(peer);
      }
    }
  }

  private drop(e: Entry): void {
    const at = this.ctx.stage.craft.indexOf(e.drawn);
    if (at >= 0) this.ctx.stage.craft.splice(at, 1);
    e.model.dispose();
    e.wake?.dispose();
  }

  dispose(): void {
    for (const e of this.entries.values()) this.drop(e);
    this.entries.clear();
    this.out.length = 0;
  }
}
