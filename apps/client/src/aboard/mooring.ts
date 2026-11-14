import * as THREE from 'three';
import type { Place } from '../session';
import type { AboardContext, Feature } from './feature';
import { LEAVING_ANGLE, LIMITS, berthStatus, canAnchor, canBerth, canTurnIn, clearerTack, clockText, compassPoint, isBerth, knots, lowWater, nearestBerth, secondsUntilClock } from './mooringRules';

/** Real seconds for each part of the night: the fade down, the dark, and the fade back up. */
const FADE_DOWN = 1.5;
const DARK = 1.6;
const FADE_UP = 1.3;

interface Float {
  mesh: THREE.Object3D;
  x: number;
  y: number;
  seed: number;
}

/**
 * Stopping for a while. X lets go the anchor, picks up a mooring or comes alongside, and gets her under way again.
 * Z turns in for the night once she is held. The holding itself is in the sim (`holdAt`, `release`), and the stowed
 * sails and the rode are drawn by `BoatView` from the sim state, so other boats show them too.
 */
export class Mooring implements Feature {
  readonly id = 'mooring';

  private readonly group = new THREE.Group();
  private readonly buoys: Float[] = [];
  private readonly berths: Place[];
  /** The mooring or dock she is made fast to, kept so it need not be looked up every frame. */
  private berth: Place | null = null;
  /** Seconds each nearby berth has been in range this approach, and whether its hint has been given. */
  private readonly approach = new Map<string, { near: number; said: boolean }>();
  private readonly veil = document.createElement('div');
  private sleep: { phase: 'down' | 'dark' | 'up'; clock: number } | null = null;
  /** What is said on deck in the morning, written in the dark. */
  private waking = '';

  constructor(private readonly ctx: AboardContext) {
    this.berths = ctx.places.filter(isBerth);
    this.group.name = 'moorings';
    for (const place of this.berths) {
      const mesh = place.kind === 'dock' ? dockPile() : mooringBuoy();
      mesh.position.set(place.x, 0, -place.y);
      this.group.add(mesh);
      if (place.kind !== 'dock') this.buoys.push({ mesh, x: place.x, y: place.y, seed: this.buoys.length * 1.7 });
    }
    ctx.stage.scene.add(this.group);
    this.veil.className = 'night';
    this.veil.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.veil);
  }

  // ---- keys -----------------------------------------------------------------------------------

  key(code: string): boolean {
    if (code !== 'KeyX' && code !== 'KeyZ') return false;
    // Asleep, the keys do nothing.
    if (this.sleep) return true;
    if (code === 'KeyZ') this.turnIn();
    else if (this.ctx.sim.state.hold === 'none') this.stop();
    else this.getUnderWay();
    return true;
  }

  /** X while sailing: the mooring or dock if one is in reach, otherwise her own anchor. */
  private stop(): void {
    const { sim, world, spec } = this.ctx;
    const s = sim.state;
    const sogKt = knots(sim.out.sog);
    const stwKt = knots(Math.hypot(s.speed, s.lateral));
    const near = nearestBerth(this.berths, s.x, s.y, LIMITS.berthRange);
    if (near) {
      const place = near.place;
      const verdict = canBerth({ sogKt, stwKt, place });
      if (!verdict.ok) return this.ctx.say(verdict.say, 8);
      // The sim holds her by her middle, so allow half her length for the bow to lie a little off the buoy.
      sim.holdAt('mooring', place.x, place.y, spec.dimensions.loa / 2 + 3);
      this.berth = place;
      this.ctx.say(`${berthStatus(place)}. Sails stowed. X ${place.kind === 'dock' ? 'casts off' : 'slips the mooring'}, Z turns in for the night`, 8);
      return;
    }
    // The anchor goes down from the bow.
    const bowX = s.x + Math.sin(s.heading) * spec.dimensions.loa * 0.45;
    const bowY = s.y + Math.cos(s.heading) * spec.dimensions.loa * 0.45;
    const depth = world.depth(bowX, bowY, s.t);
    const verdict = canAnchor({ sogKt, stwKt, depth, draft: spec.dimensions.draft });
    if (!verdict.ok) return this.ctx.say(verdict.say, 8);
    sim.holdAt('anchor', bowX, bowY, verdict.scope);
    this.berth = null;
    this.ctx.say(`Anchor down in ${depth.toFixed(1)} m, ${verdict.scope} m of cable out. Sails stowed. X weighs anchor, Z turns in for the night`, 8);
  }

  /** X while held: weigh or slip. The sim sets the sails and puts her on a close reach with the pilot holding it. */
  private getUnderWay(): void {
    const { sim, world } = this.ctx;
    const s = sim.state;
    const berth = this.berthNow();
    const was = s.hold;
    sim.release();
    this.berth = null;
    // She does not need telling about the berth she has just left.
    if (berth) this.approach.set(berth.id, { near: 0, said: true });
    // The sim bears away on whichever side the wind happens to be. Take the tack that leads to open water.
    const preferred = sim.out.twa >= 0 ? 1 : -1;
    const side = clearerTack((heading, metres) => world.depth(s.x + Math.sin(heading) * metres, s.y + Math.cos(heading) * metres, s.t), sim.out.twd, preferred);
    if (side !== preferred) sim.setHelm('wind', side * LEAVING_ANGLE);
    const tack = side > 0 ? 'starboard' : 'port';
    const left = was === 'anchor' ? 'Anchor aweigh' : berth?.kind === 'dock' ? `Cast off from ${berth.name}` : `Mooring slipped${berth ? ` at ${berth.name}` : ''}`;
    this.ctx.say(`${left}. Under way on ${tack} tack: sails set, the pilot holding her on a close reach. Take the wheel when you are ready`, 8);
  }

  // ---- the night ------------------------------------------------------------------------------

  /** Z: sleep until 06:30, if it is a night that can be slept through. */
  private turnIn(): void {
    const { sim, world, spec } = this.ctx;
    const s = sim.state;
    const tz = this.ctx.stage.course.timeZone;
    const held = s.hold !== 'none';
    const seconds = secondsUntilClock(world.dateAt(s.t), tz);
    // Low water in the night, against the water she is lying in now. Past the end of the recorded weather the
    // same day comes round again, so look there for the tide.
    const length = world.seasonLength;
    const tideAt = (after: number): number => {
      let season = world.seasonTime(s.t + after);
      while (season >= length - 1 && length > 86400) season -= 86400;
      return world.tide(season - world.startOffset);
    };
    const depthNow = world.depth(s.x, s.y, s.t);
    const low = lowWater(tideAt, seconds);
    const underKeelAtLow = depthNow > 0 ? depthNow - tideAt(0) + low.height - spec.dimensions.draft : null;
    const verdict = canTurnIn({
      held,
      sharing: this.ctx.sharing(),
      windKt: knots(world.wind(s.x, s.y, s.t).speed),
      underKeelAtLow,
      lowClock: clockText(new Date(world.dateAt(s.t).getTime() + low.after * 1000), tz),
    });
    if (!verdict.ok) return this.ctx.say(verdict.say, 8);
    this.sleep = { phase: 'down', clock: 0 };
    this.showVeil('Turning in', this.status());
    this.ctx.say('Anchor light on, hatch closed', 3);
  }

  private showVeil(title: string, small: string): void {
    this.veil.replaceChildren();
    const box = document.createElement('div');
    box.className = 'title';
    const sub = document.createElement('small');
    sub.textContent = small;
    box.append(title, sub);
    this.veil.appendChild(box);
    this.veil.classList.add('on');
  }

  /** Move the clock on to the morning. Called in the dark, so nobody sees the sun jump. */
  private skipNight(): void {
    const { sim, world, passage } = this.ctx;
    const s = sim.state;
    const tz = this.ctx.stage.course.timeZone;
    if (this.ctx.sharing() || s.hold === 'none') {
      // Someone turned up, or she was let go, between the key and the dark.
      this.sleep = { phase: 'up', clock: 0 };
      this.veil.classList.remove('on');
      this.ctx.say(s.hold === 'none' ? 'Back on deck: she is under way' : 'Back on deck: another boat has come in, and the clock is shared now', 6);
      return;
    }
    world.shiftTime(secondsUntilClock(world.dateAt(s.t), tz));
    // The recorded weather may run out before morning. Then the same day comes round again.
    const sameDay = world.wrapSeason(s.t);
    this.ctx.logbook.count('nights');
    // The plan was worked out for yesterday's wind and tide.
    if (passage.marks[passage.nextIndex]) passage.replan({ x: s.x, y: s.y }, s.t);

    const now = world.dateAt(s.t);
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long' }).format(now);
    const wind = world.wind(s.x, s.y, s.t);
    const rate = world.tideRate(s.t);
    const tide = rate > 0.05 ? 'the tide rising' : rate < -0.05 ? 'the tide falling' : 'the tide at a stand';
    const where = s.hold === 'anchor' ? 'at anchor' : this.berthNow()?.kind === 'dock' ? 'alongside' : 'on the mooring';
    const windNow = knots(wind.speed) < 1.5 ? 'No wind to speak of yet' : `Wind ${compassPoint(wind.dir)}, ${Math.round(knots(wind.speed))} kt`;
    this.waking = `${clockText(now, tz)}, ${day} morning. A quiet night ${where}. ${windNow}, ${tide}.${sameDay ? ' The recorded weather ran out in the night, so this is the same day come round again.' : ''} X gets her under way`;
    this.showVeil(clockText(now, tz), `${day} morning`);
    this.sleep = { phase: 'dark', clock: 0 };
  }

  // ---- every frame ----------------------------------------------------------------------------

  update(dt: number, seaTime: number): void {
    // Buoys ride the sea and nod a little.
    for (const b of this.buoys) {
      b.mesh.position.y = this.ctx.stage.seaLevel(b.x, -b.y, seaTime, 4) + 0.08;
      b.mesh.rotation.x = Math.sin(seaTime * 1.3 + b.seed) * 0.09;
      b.mesh.rotation.z = Math.sin(seaTime * 1.1 + b.seed * 2.3) * 0.09;
    }

    const step = Math.min(dt, 0.5);
    const sleep = this.sleep;
    if (sleep) {
      sleep.clock += step;
      if (sleep.phase === 'down' && sleep.clock >= FADE_DOWN) this.skipNight();
      else if (sleep.phase === 'dark' && sleep.clock >= DARK) {
        this.sleep = { phase: 'up', clock: 0 };
        this.veil.classList.remove('on');
        this.ctx.say(this.waking, 12);
      } else if (sleep.phase === 'up' && sleep.clock >= FADE_UP) this.sleep = null;
      return;
    }
    this.hint(step);
  }

  /** Coming slowly up to a mooring or a dock, say once that X picks it up. */
  private hint(dt: number): void {
    const { sim } = this.ctx;
    const s = sim.state;
    const sogKt = knots(sim.out.sog);
    for (const place of this.berths) {
      const d = Math.hypot(place.x - s.x, place.y - s.y);
      const a = this.approach.get(place.id);
      if (d > LIMITS.hintRange * 2) {
        if (a) this.approach.delete(place.id);
        continue;
      }
      if (d > LIMITS.hintRange || s.hold !== 'none') continue;
      const seen = a ?? { near: 0, said: false };
      if (!a) this.approach.set(place.id, seen);
      seen.near += dt;
      // The place is named as she arrives. Let that be read before adding to it.
      if (seen.said || seen.near < 8 || sogKt >= LIMITS.hintKt) continue;
      seen.said = true;
      const dock = place.kind === 'dock';
      const ready = d <= LIMITS.berthRange && sogKt < LIMITS.berthKt;
      if (ready) this.ctx.say(dock ? `X brings her alongside at ${place.name}` : `X picks up the mooring at ${place.name}`, 7);
      else {
        const what = dock ? `The dock at ${place.name}` : `The mooring at ${place.name}`;
        this.ctx.say(`${what} is ${Math.round(d / 10) * 10} m off. Within ${LIMITS.berthRange} m and under ${LIMITS.berthKt} kt, X ${dock ? 'brings her alongside' : 'picks it up'}`, 8);
      }
    }
  }

  // ---- what the others see --------------------------------------------------------------------

  /** The berth she is held at, worked out from the sim so it survives a reload. */
  private berthNow(): Place | null {
    const s = this.ctx.sim.state;
    if (s.hold !== 'mooring') return null;
    if (this.berth && Math.hypot(this.berth.x - s.holdX, this.berth.y - s.holdY) < 1) return this.berth;
    this.berth = nearestBerth(this.berths, s.holdX, s.holdY, 5)?.place ?? null;
    return this.berth;
  }

  status(): string {
    const hold = this.ctx.sim.state.hold;
    if (hold === 'anchor') return 'At anchor';
    if (hold === 'mooring') return berthStatus(this.berthNow());
    return '';
  }

  /** Enough for another page to draw her stowed and lying to her line: how she is held, and to what point. */
  wire(): Record<string, unknown> {
    const s = this.ctx.sim.state;
    if (s.hold === 'none') return { hd: 0 };
    return { hd: s.hold === 'anchor' ? 1 : 2, hx: Math.round(s.holdX * 10) / 10, hy: Math.round(s.holdY * 10) / 10 };
  }

  dispose(): void {
    this.ctx.stage.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.veil.remove();
  }
}

/** A visitor's mooring: a white ball with a blue band and a ring on top. Origin at the waterline. */
function mooringBuoy(): THREE.Object3D {
  const buoy = new THREE.Group();
  const r = 0.45;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), new THREE.MeshStandardMaterial({ color: 0xf1f0ea, roughness: 0.55 }));
  // The band sits above the water, where it shows.
  const band = new THREE.Mesh(
    new THREE.SphereGeometry(r * 1.012, 18, 4, 0, Math.PI * 2, 0.7, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1f4f9c, roughness: 0.6 }),
  );
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8c9296, roughness: 0.5, metalness: 0.7 }));
  ring.position.y = r + 0.06;
  ball.castShadow = true;
  buoy.add(ball, band, ring);
  // She floats a little more than half out.
  for (const part of buoy.children) part.position.y += 0.1;
  return buoy;
}

/** The end of a landing: a timber pile with a white top, for a bow line to lead to. */
function dockPile(): THREE.Object3D {
  const pile = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 6.4, 10), new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }));
  post.position.y = -0.8;
  post.castShadow = true;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0xeeeae0, roughness: 0.7 }));
  cap.position.y = 2.55;
  pile.add(post, cap);
  return pile;
}
