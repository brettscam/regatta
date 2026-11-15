import * as THREE from 'three';
import type { AboardContext, Feature } from './feature';

interface Mark { name: string; x: number; y: number }

const MAX_MARKS = 12;
const AMBER = 0xffc46b;

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
 * a big inflatable mark at every mark still to round, a column of light over the next one so it can be found from
 * a mile off, its name and range beside it, and a line of arrowheads on the water from the bow to the mark and on down the next leg.
 * In a race it is on by itself. Following a plain route it is off until asked for. G turns it on and off.
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
    this.ctx.say(on ? 'Course guide on: marks, and a line on the water to the next one. G turns it off' : 'Course guide off', 4);
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

  update(dt: number, seaTime: number): void {
    const marks = this.on() ? this.ahead() : [];
    const { stage, sim, drone } = this.ctx;
    for (let i = 0; i < MAX_MARKS; i++) {
      const b = this.buoys[i];
      const m = marks[i];
      b.visible = !!m;
      if (!m) continue;
      const z = -m.y;
      b.position.set(m.x, stage.seaLevel(m.x, z, seaTime) - 0.25, z);
      b.rotation.set(Math.sin(seaTime * 0.9 + i) * 0.06, i, Math.cos(seaTime * 0.7 + i * 2) * 0.06);
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
    const s = sim.state;
    const d = Math.hypot(next.x - s.x, next.y - s.y);
    if (d > 40) {
      // Start the line a little ahead of the bow, so it does not lie across the cockpit.
      const k = Math.min(0.5, 18 / d);
      this.lay(this.lines[0], s.x + (next.x - s.x) * k, -(s.y + (next.y - s.y) * k), next.x, -next.y, d > 600 ? 4 : 2.6);
    }
    const after = marks[1];
    if (after) this.lay(this.lines[1], next.x, -next.y, after.x, -after.y, 4);

    // Her name and how far, beside the column of light.
    this.pos.set(next.x, 9, -next.y).project(drone.camera);
    if (this.pos.z < 1 && Math.abs(this.pos.x) < 1.05 && Math.abs(this.pos.y) < 1.05) {
      const text = `${next.name} · ${d < 1852 ? `${Math.round(d / 10) * 10} m` : `${(d / 1852).toFixed(1)} nm`}`;
      if (this.label.textContent !== text) this.label.textContent = text;
      this.label.style.display = 'block';
      this.label.style.transform = `translate(-50%, -100%) translate(${Math.round(((this.pos.x + 1) / 2) * window.innerWidth)}px, ${Math.round(((1 - this.pos.y) / 2) * window.innerHeight)}px)`;
    }
  }

  dispose(): void {
    this.ctx.stage.scene.remove(this.group);
    this.label.remove();
    this.tex.dispose();
  }
}
