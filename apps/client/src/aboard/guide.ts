import * as THREE from 'three';
import type { Sound } from '../audio/sound';
import { RING, marginText, shortRange } from '../race/startline';
import type { AboardContext, Feature } from './feature';

interface Mark { name: string; x: number; y: number }

const MAX_MARKS = 12;
const AMBER = 0xffc46b;
const GREEN = 0x8dffb4;
/** How high the ring's wall of light stands off the water, metres: enough to be seen edge-on from the cockpit. */
const WALL = 7;
/** Seconds the ring of a mark just taken flashes for. */
const FLASH = 2.2;

/** The wall of a ring: bright at the water, gone at the top, with posts of light round it so its curve reads from low down. */
function curtain(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const fade = g.createLinearGradient(0, 64, 0, 0);
  fade.addColorStop(0, 'rgba(255,255,255,0.85)');
  fade.addColorStop(0.35, 'rgba(255,255,255,0.32)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, 64, 64);
  const post = g.createLinearGradient(0, 64, 0, 0);
  post.addColorStop(0, 'rgba(255,255,255,1)');
  post.addColorStop(1, 'rgba(255,255,255,0.15)');
  g.fillStyle = post;
  g.fillRect(29, 0, 6, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(48, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A few notes through the game's own sound: a horn for the gun, a rising chime for a mark, a longer one for the finish. */
function notes(sound: Sound, shape: OscillatorType, tones: Array<[hz: number, at: number, len: number]>, level: number): void {
  const out = sound.output();
  if (!out) return;
  const t0 = out.ctx.currentTime + 0.02;
  for (const [hz, at, len] of tones) {
    const osc = out.ctx.createOscillator();
    osc.type = shape;
    osc.frequency.setValueAtTime(hz, t0 + at);
    const g = out.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(level, t0 + at + 0.03);
    g.gain.setValueAtTime(level, t0 + at + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    const soft = out.ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = shape === 'sine' ? 6000 : 900;
    osc.connect(soft).connect(g).connect(out.node);
    osc.start(t0 + at);
    osc.stop(t0 + at + len + 0.05);
  }
}

/** A strip of arrowheads to lay along the water, pointing the way. */
function chevrons(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(12, 44);
  g.lineTo(32, 20);
  g.lineTo(52, 44);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * What a race committee lays, and what a chartplotter would draw if it could draw on the sea:
 * a big inflatable mark at every mark still to round, a ring on the water round each at the distance that counts as taking it
 * (bright on the next, faint on the rest), a column of light over the next one so it can be found from a mile off,
 * its name and range beside it, and a line of arrowheads on the water from the bow to the ring and on down the next leg.
 * Before the gun the next mark is the start, and its label carries the time-on-distance figure.
 * In a race it is on by itself. Following a plain route it is off until asked for. G turns it on and off.
 *
 * It also sounds the race: a horn at the gun, a chime as each mark is taken. Those are not hidden by G.
 */
export class Guide implements Feature {
  readonly id = 'guide';
  /** The player's choice, once they have made one. Until then: on in a race, off otherwise. */
  private wanted: boolean | null = null;
  private readonly group = new THREE.Group();
  private readonly buoys: THREE.Group[] = [];
  private readonly beacon: THREE.Mesh;
  private readonly lines: THREE.Mesh[] = [];
  private readonly tex = chevrons();
  private readonly label = document.createElement('div');
  private readonly pos = new THREE.Vector3();
  private readonly rings: THREE.Group[] = [];
  private readonly wallTex = curtain();
  private readonly bright: { band: THREE.MeshBasicMaterial; wall: THREE.MeshBasicMaterial };
  /** The ring of the mark just taken, flashing out. */
  private readonly flash: THREE.Mesh;
  private flashFor = 0;
  /** What the race was doing last frame, to hear it change. */
  private seen = { id: '', started: false, leg: 0, finished: false };

  constructor(private readonly ctx: AboardContext) {
    const orange = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.55 });
    const band = new THREE.MeshStandardMaterial({ color: 0xfff1c9, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x20262b, roughness: 0.8 });
    const body = new THREE.CylinderGeometry(1.15, 1.35, 3.0, 14);
    const cap = new THREE.SphereGeometry(1.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const stripe = new THREE.CylinderGeometry(1.2, 1.26, 0.55, 14);
    const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5);
    const flag = new THREE.PlaneGeometry(0.9, 0.6);
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, side: THREE.DoubleSide });
    for (let i = 0; i < MAX_MARKS; i++) {
      const b = new THREE.Group();
      const hull = new THREE.Mesh(body, orange);
      hull.position.y = 1.2;
      const top = new THREE.Mesh(cap, orange);
      top.position.y = 2.7;
      const mid = new THREE.Mesh(stripe, band);
      mid.position.y = 1.7;
      const staff = new THREE.Mesh(pole, dark);
      staff.position.y = 4.6;
      const pennant = new THREE.Mesh(flag, flagMat);
      pennant.position.set(0.47, 5.3, 0);
      b.add(hull, top, mid, staff, pennant);
      b.visible = false;
      this.buoys.push(b);
      this.group.add(b);
    }
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 90, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.beacon.visible = false;
    this.group.add(this.beacon);
    // The rings. Flat on the water for the view from above, and a low wall of light for the view from the cockpit.
    const bandGeo = new THREE.RingGeometry(RING - 3, RING + 3, 128).rotateX(-Math.PI / 2);
    const wallGeo = new THREE.CylinderGeometry(RING, RING, WALL, 128, 1, true).translate(0, WALL / 2, 0);
    const bandMat = (opacity: number) => new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const wallMat = (opacity: number) => new THREE.MeshBasicMaterial({ map: this.wallTex, color: AMBER, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.bright = { band: bandMat(0.9), wall: wallMat(0.9) };
    const faint = { band: bandMat(0.28), wall: wallMat(0.25) };
    for (let i = 0; i < MAX_MARKS; i++) {
      const r = new THREE.Group();
      const band = new THREE.Mesh(bandGeo, i === 0 ? this.bright.band : faint.band);
      band.position.y = 0.4;
      band.renderOrder = 3;
      const wall = new THREE.Mesh(wallGeo, i === 0 ? this.bright.wall : faint.wall);
      wall.position.y = -0.6;
      wall.renderOrder = 3;
      r.add(band, wall);
      r.visible = false;
      this.rings.push(r);
      this.group.add(r);
    }
    this.flash = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.flash.renderOrder = 4;
    this.flash.visible = false;
    // The flash is not part of the guide: a mark taken is shown even with the guide off.
    ctx.stage.scene.add(this.flash);
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
      geo.setIndex([0, 1, 2, 2, 1, 3]);
      // Drawn over the sea whatever the waves are doing: it is a line on a screen, not a thing in the water.
      const mat = new THREE.MeshBasicMaterial({ map: this.tex, color: AMBER, transparent: true, opacity: i === 0 ? 0.8 : 0.35, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 4;
      m.visible = false;
      this.lines.push(m);
      this.group.add(m);
    }
    ctx.stage.scene.add(this.group);
    this.label.className = 'boat-label mark-label';
    this.label.style.display = 'none';
    document.body.appendChild(this.label);
  }

  key(code: string): boolean {
    if (code !== 'KeyG') return false;
    const on = !this.on();
    this.wanted = on;
    this.ctx.say(on ? 'Course guide on: a ring round each mark, and a line on the water to the next one. Sail into the ring to take the mark. G turns it off' : 'Course guide off', on ? 6 : 4);
    return true;
  }

  private racing(): boolean {
    return !!this.ctx.race?.call;
  }

  private on(): boolean {
    return this.wanted ?? this.racing();
  }

  /** The marks still ahead, next first. */
  private ahead(): Mark[] {
    const race = this.ctx.race;
    if (race?.call) return race.finish !== null ? [] : race.call.marks.slice(race.started ? race.leg : 0);
    return this.ctx.passage.ahead();
  }

  /** A flat strip from one point to another, textured so the arrowheads repeat every few metres and point at `to`. */
  private lay(mesh: THREE.Mesh, ax: number, az: number, bx: number, bz: number, width: number): void {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 8) { mesh.visible = false; return; }
    const nx = (-dz / len) * width * 0.5;
    const nz = (dx / len) * width * 0.5;
    const p = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const y = 0.4;
    p.setXYZ(0, ax - nx, y, az - nz);
    p.setXYZ(1, ax + nx, y, az + nz);
    p.setXYZ(2, bx - nx, y, bz - nz);
    p.setXYZ(3, bx + nx, y, bz + nz);
    p.needsUpdate = true;
    const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const reps = len / (width * 2.2);
    uv.setXY(0, 0, reps);
    uv.setXY(1, 1, reps);
    uv.setXY(2, 0, 0);
    uv.setXY(3, 1, 0);
    uv.needsUpdate = true;
    mesh.visible = true;
  }

  /** Hear the race change: the gun, a mark taken, the finish. */
  private listen(): void {
    const race = this.ctx.race;
    const now = { id: race?.call?.id ?? '', started: !!race?.started, leg: race?.leg ?? 0, finished: !!race && race.finish !== null };
    const was = this.seen;
    this.seen = now;
    if (!race?.call || now.id !== was.id) return;
    const sound = this.ctx.sound;
    if (now.started && !was.started) notes(sound, 'sawtooth', [[233, 0, 1.1], [311, 0, 1.1]], 0.16);
    if (now.leg > was.leg) {
      const mark = race.call.marks[now.leg - 1];
      if (mark) {
        this.flash.position.set(mark.x, 0.5, -mark.y);
        this.flashFor = FLASH;
      }
      if (now.finished) notes(sound, 'sine', [[784, 0, 0.22], [988, 0.2, 0.22], [1175, 0.4, 0.22], [1568, 0.6, 0.7]], 0.2);
      else notes(sound, 'sine', [[880, 0, 0.2], [1175, 0.17, 0.5]], 0.2);
    }
  }

  update(dt: number, seaTime: number): void {
    this.listen();
    const race = this.ctx.race;
    // Hiding the guide hides the coaching with it: the calls before the gun go back to the bare time.
    if (race) race.coach = this.on();
    // A mark just taken: its ring goes green, swells and fades.
    this.flashFor = Math.max(0, this.flashFor - dt);
    this.flash.visible = this.flashFor > 0;
    if (this.flash.visible) {
      const k = 1 - this.flashFor / FLASH;
      this.flash.scale.setScalar(1 + k * 0.35);
      (this.flash.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k * k);
    }
    const marks = this.on() ? this.ahead() : [];
    const { stage, sim, drone } = this.ctx;
    // Rings only where a ring is the rule: on the marks of a race. A plain route on the chart has none.
    const ringed = !!race?.call;
    for (let i = 0; i < MAX_MARKS; i++) {
      const b = this.buoys[i];
      const m = marks[i];
      b.visible = !!m;
      this.rings[i].visible = !!m && ringed;
      if (!m) continue;
      const z = -m.y;
      b.position.set(m.x, stage.seaLevel(m.x, z, seaTime) - 0.25, z);
      b.rotation.set(Math.sin(seaTime * 0.9 + i) * 0.06, i, Math.cos(seaTime * 0.7 + i * 2) * 0.06);
      this.rings[i].position.set(m.x, 0, z);
    }
    const next = marks[0];
    this.beacon.visible = !!next;
    this.lines[0].visible = false;
    this.lines[1].visible = false;
    this.label.style.display = 'none';
    if (!next) return;
    this.beacon.position.set(next.x, 45, -next.y);
    // The arrowheads run toward the mark.
    this.tex.offset.y = (this.tex.offset.y + dt * 0.9) % 1;
    // The posts of the ring's wall walk slowly round it, so it is seen to be a thing and not a mark on the lens.
    this.wallTex.offset.x = (this.wallTex.offset.x + dt * 0.04) % 1;
    const s = sim.state;
    const d = Math.hypot(next.x - s.x, next.y - s.y);
    // Inside the next ring (which can only last before the gun) it shows green: this is the place.
    const pre = race?.preStart() ?? null;
    const inside = ringed && d < RING;
    this.bright.band.color.setHex(inside ? GREEN : AMBER);
    this.bright.wall.color.setHex(inside ? GREEN : AMBER);
    // In a race the line stops at the ring, which is what she has to reach.
    const stop = ringed ? RING : 0;
    if (d > 40 + stop) {
      // Start the line a little ahead of the bow, so it does not lie across the cockpit.
      const k = Math.min(0.5, 18 / d);
      const e = 1 - stop / d;
      this.lay(this.lines[0], s.x + (next.x - s.x) * k, -(s.y + (next.y - s.y) * k), s.x + (next.x - s.x) * e, -(s.y + (next.y - s.y) * e), d > 600 ? 4 : 2.6);
    }
    const after = marks[1];
    if (after) this.lay(this.lines[1], next.x, -next.y, after.x, -after.y, 4);

    // Her name and how far, beside the column of light. Before the gun: the start, and early or late.
    this.pos.set(next.x, 9, -next.y).project(drone.camera);
    if (this.pos.z < 1 && Math.abs(this.pos.x) < 1.05 && Math.abs(this.pos.y) < 1.05) {
      const range = shortRange(Math.max(0, d - stop));
      const last = ringed && race!.started && race!.leg === race!.call!.marks.length - 1;
      const text = pre ? `Start · ${next.name} · ${pre.state === 'inside' ? 'you are in the ring' : `${range} · ${marginText(pre)}`}`
        : ringed && race!.leg === 0 ? `Start · ${next.name} · ${range}`
          : `${last ? 'Finish · ' : ''}${next.name} · ${range}`;
      if (this.label.textContent !== text) this.label.textContent = text;
      this.label.style.display = 'block';
      this.label.style.transform = `translate(-50%, -100%) translate(${Math.round(((this.pos.x + 1) / 2) * window.innerWidth)}px, ${Math.round(((1 - this.pos.y) / 2) * window.innerHeight)}px)`;
    }
  }

  dispose(): void {
    this.ctx.stage.scene.remove(this.group);
    this.ctx.stage.scene.remove(this.flash);
    this.wallTex.dispose();
    this.label.remove();
    this.tex.dispose();
  }
}
