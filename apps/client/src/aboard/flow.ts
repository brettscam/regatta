import * as THREE from 'three';
import { KT, R2D, idealBoomDeg, idealJibDeg } from '@slack-tide/sim';
import type { AboardContext, Feature } from './feature';

/** A sail seen from above at one height: a straight chord from luff to leech, and how it is setting. */
interface Chord {
  ax: number; az: number;
  bx: number; bz: number;
  luff: number;
  stall: number;
}

const LEVELS = [0.14, 0.34, 0.56, 0.78];
const SEEDS = 11;
const POINTS = 40;
const STEP = 0.5;
const SMOOTH = new THREE.Color(0x2f8fc4);
const FAST = new THREE.Color(0x9fdcff);
const STALLED = new THREE.Color(0xff3a1c);
const DEAD = new THREE.Color(0x59636b);
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/**
 * The wind tunnel view. Smoke lines run with the apparent wind past the sails at four heights:
 * smooth and pale where the flow follows the sail, red and broken behind a sail that is sheeted too hard,
 * grey and shaking past one that is luffing. A card beside it puts numbers to the same thing,
 * and says what wind angle the sails as set are asking for.
 *
 * The lines are drawn from the sim's own trim state, not from a fluid solver: they show what the sim has
 * decided the sails are doing, in a form that can be read at a glance.
 */
export class FlowView implements Feature {
  readonly id = 'flow';
  private on = false;
  private readonly group = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly ribbons: THREE.Mesh;
  private readonly linePos: Float32Array;
  private readonly lineCol: Float32Array;
  private readonly ribPos: Float32Array;
  private readonly ribCol: Float32Array;
  private readonly card = document.createElement('aside');
  private readonly chords: Chord[] = [];
  private readonly colour = new THREE.Color();
  private clock = 0;
  private cardClock = 0;
  private cardHtml = '';

  constructor(private readonly ctx: AboardContext) {
    const count = LEVELS.length * SEEDS;
    const segs = count * (POINTS - 1);
    this.linePos = new Float32Array(segs * 2 * 3);
    this.lineCol = new Float32Array(segs * 2 * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    // The same lines again as thin upright ribbons, so they still read when a line is only a pixel wide.
    this.ribPos = new Float32Array(segs * 6 * 3);
    this.ribCol = new Float32Array(segs * 6 * 3);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.ribPos, 3));
    rg.setAttribute('color', new THREE.BufferAttribute(this.ribCol, 3));
    this.ribbons = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    for (const o of [this.lines, this.ribbons]) {
      o.frustumCulled = false;
      o.renderOrder = 5;
      this.group.add(o);
    }
    this.group.visible = false;
    ctx.boatView.root.add(this.group);
    this.card.className = 'hud trimcard';
    this.card.hidden = true;
    this.card.setAttribute('aria-live', 'off');
    document.body.appendChild(this.card);
  }

  key(code: string): boolean {
    if (code !== 'KeyF') return false;
    this.on = !this.on;
    this.group.visible = this.on;
    this.card.hidden = !this.on;
    this.cardClock = 0;
    this.ctx.say(this.on ? 'Wind tunnel on: smoke lines show the air over the sails. F turns it off' : 'Wind tunnel off', 4);
    return true;
  }

  update(dt: number): void {
    if (!this.on) return;
    this.clock += dt;
    this.draw();
    this.cardClock -= dt;
    if (this.cardClock <= 0) {
      this.cardClock = 0.25;
      this.writeCard();
    }
  }

  /** The sails as straight chords at one height above the deck, in the boat's own frame (+x starboard, +z aft). */
  private chordsAt(y: number): Chord[] {
    const { sim, boatView } = this.ctx;
    const g = boatView.rig;
    const s = sim.state;
    const o = sim.out;
    const out = this.chords;
    out.length = 0;
    if (s.hold !== 'none') return out;
    const reef = this.ctx.spec.sails.main.reefs[s.reef]?.luff ?? 1;
    const mv = (y - g.mainTackY) / ((g.mainHeadY - g.mainTackY) * reef);
    if (mv > 0 && mv < 0.97) {
      // The sail narrows toward the head and twists off a little.
      const len = THREE.MathUtils.lerp(g.mainFoot, 0.3, mv) + 0.2 * g.mainFoot * Math.sin(Math.PI * mv) * 0.5;
      const a = s.boomAngle * (1 + 0.22 * mv);
      out.push({ ax: 0, az: g.gooseneck.z, bx: Math.sin(a) * len, bz: g.gooseneck.z + Math.cos(a) * len, luff: o.main.flogging ? 1 : o.main.luff, stall: o.main.stall });
    }
    const jv = (y - g.jibTack.y) / (g.jibHead.y - g.jibTack.y);
    if (s.furl > 0.08 && jv > 0 && jv < 0.95) {
      const len = g.jibFoot * s.furl * (1 - jv) * 0.95 + 0.15;
      const lx = THREE.MathUtils.lerp(g.jibTack.x, g.jibHead.x, jv);
      const lz = THREE.MathUtils.lerp(g.jibTack.z, g.jibHead.z, jv);
      const a = s.jibAngle * (1 + 0.18 * jv);
      out.push({ ax: lx, az: lz, bx: lx + Math.sin(a) * len, bz: lz + Math.cos(a) * len, luff: o.jib.flogging ? 1 : Math.max(o.jib.luff, o.jib.backed), stall: o.jib.stall });
    }
    return out;
  }

  private draw(): void {
    const { sim, boatView } = this.ctx;
    const g = boatView.rig;
    const o = sim.out;
    const ux = -Math.sin(o.awa);
    const uz = Math.cos(o.awa);
    // Across the flow, to the right of it looking downwind.
    const px = -uz;
    const pz = ux;
    const cz = (g.jibTack.z + g.gooseneck.z + g.mainFoot * 0.5) / 2;
    const span = g.mainFoot * 0.85 + 1.2;
    const lead = 6.5;
    const pulse = 2.2 + (o.aws / KT) * 0.28;
    let l = 0;
    let r = 0;
    let line = 0;
    for (const level of LEVELS) {
      const y = g.mainTackY + level * (g.mainHeadY - g.mainTackY);
      const chords = this.chordsAt(y);
      for (let k = 0; k < SEEDS; k++, line++) {
        const off = ((k / (SEEDS - 1)) * 2 - 1) * span;
        let x = px * off - ux * lead;
        let z = cz + pz * off - uz * lead;
        let wake = 0;
        let dead = 0;
        // The air has weight: once turned, it keeps its new direction for a while downstream.
        let vx = ux;
        let vz = uz;
        let lastX = 0;
        let lastY = 0;
        let lastZ = 0;
        for (let i = 0; i < POINTS; i++) {
          let dx = ux;
          let dz = uz;
          let quick = 0;
          for (const c of chords) {
            const ex = c.bx - c.ax;
            const ez = c.bz - c.az;
            const len = Math.hypot(ex, ez) || 1e-6;
            let tx = ex / len;
            let tz = ez / len;
            const t = THREE.MathUtils.clamp(((x - c.ax) * tx + (z - c.az) * tz) / len, 0, 1);
            const qx = c.ax + ex * t;
            const qz = c.az + ez * t;
            const rx = x - qx;
            const rz = z - qz;
            const dist = Math.hypot(rx, rz);
            const reach = 0.42 * len + 0.8;
            const w = Math.exp(-((dist / reach) ** 2));
            if (tx * ux + tz * uz < 0) { tx = -tx; tz = -tz; }
            // A sail that is drawing turns the air along itself. One that is luffing lets it straight through.
            const hold = w * (1 - c.luff) * (1 - 0.6 * c.stall);
            dx += (tx - ux) * hold;
            dz += (tz - uz) * hold;
            // The side the wind does not blow on, where the air speeds up or, stalled, breaks away.
            const lee = rx * ux + rz * uz > 0;
            if (lee && c.stall > 0.05 && t > 0.25) wake = Math.max(wake, c.stall * Math.exp(-dist / (reach * 1.6)));
            if (lee && c.stall < 0.2 && c.luff < 0.2) quick = Math.max(quick, w);
            if (c.luff > 0.08) dead = Math.max(dead, c.luff * w);
            // Air does not go through cloth: ease the line round the sail.
            if (dist < 0.35 && dist > 1e-4 && c.luff < 0.6) { dx += (rx / dist) * 0.5; dz += (rz / dist) * 0.5; }
          }
          vx += (dx - vx) * 0.3;
          vz += (dz - vz) * 0.3;
          const dl = Math.hypot(vx, vz) || 1;
          dx = vx / dl;
          dz = vz / dl;
          // Broken flow wanders and shakes. It carries on downstream of the sail, fading.
          const shake = wake * 0.55 * Math.sin(i * 1.3 + this.clock * 11 + line * 2.1) + dead * 0.22 * Math.sin(i * 2.1 + this.clock * 17 + line);
          const sx = x - dz * shake;
          const sz = z + dx * shake;
          const sy = y + wake * 0.25 * Math.sin(i * 0.9 + this.clock * 7 + line);
          const beat = 0.5 + 0.5 * Math.sin(i * 0.5 - this.clock * pulse + line * 0.7);
          this.colour.copy(SMOOTH).lerp(FAST, quick * 0.8).lerp(DEAD, Math.min(1, dead * 1.2)).lerp(STALLED, Math.min(1, wake * 3));
          // Fade in at the start of the line and out at the end.
          const fade = Math.min(1, i / 5, (POINTS - 1 - i) / 6) * beat;
          const cr = this.colour.r * fade;
          const cg = this.colour.g * fade;
          const cb = this.colour.b * fade;
          if (i > 0) {
            const lp = this.linePos;
            const lc = this.lineCol;
            lp[l] = lastX; lp[l + 1] = lastY; lp[l + 2] = lastZ; lp[l + 3] = sx; lp[l + 4] = sy; lp[l + 5] = sz;
            lc[l] = cr; lc[l + 1] = cg; lc[l + 2] = cb; lc[l + 3] = cr; lc[l + 4] = cg; lc[l + 5] = cb;
            l += 6;
            const h = 0.03;
            const rp = this.ribPos;
            const rc = this.ribCol;
            rp[r] = lastX; rp[r + 1] = lastY - h; rp[r + 2] = lastZ;
            rp[r + 3] = sx; rp[r + 4] = sy - h; rp[r + 5] = sz;
            rp[r + 6] = sx; rp[r + 7] = sy + h; rp[r + 8] = sz;
            rp[r + 9] = lastX; rp[r + 10] = lastY - h; rp[r + 11] = lastZ;
            rp[r + 12] = sx; rp[r + 13] = sy + h; rp[r + 14] = sz;
            rp[r + 15] = lastX; rp[r + 16] = lastY + h; rp[r + 17] = lastZ;
            for (let v = 0; v < 6; v++) { rc[r + v * 3] = cr; rc[r + v * 3 + 1] = cg; rc[r + v * 3 + 2] = cb; }
            r += 18;
          }
          lastX = sx; lastY = sy; lastZ = sz;
          x += dx * STEP;
          z += dz * STEP;
          wake *= 0.955;
          dead *= 0.9;
        }
      }
    }
    for (const o3 of [this.lines, this.ribbons]) {
      const geo = o3.geometry;
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** What one sail is doing, in a line. */
  private sailLine(name: string, now: number, ideal: number, err: number, eff: number, luff: number, stall: number, flogging: boolean): string {
    let verdict: string;
    let tone = 'good';
    if (flogging) { verdict = 'flogging: haul it in'; tone = 'dead'; }
    else if (luff > 0.25 || err > 5) { verdict = `eased ${Math.round(Math.abs(err))}° too far: trim in`; tone = 'dead'; }
    else if (stall > 0.2 || err < -8) { verdict = `sheeted ${Math.round(Math.abs(err))}° too hard: ease`; tone = 'bad'; }
    else verdict = 'in trim';
    return `<div class="row ${tone}"><b>${name}</b><span>${Math.round(now)}° <i>best ${Math.round(ideal)}°</i></span><span>${esc(verdict)}</span><span>${Math.round(Math.max(0, eff) * 100)}%</span></div>`;
  }

  private writeCard(): void {
    const s = this.ctx.sim.state;
    const o = this.ctx.sim.out;
    let html: string;
    if (s.hold !== 'none') {
      html = '<h4>Wind tunnel</h4><p>The sails are stowed. Get under way to see the air over them.</p>';
    } else {
      const awa = Math.abs(o.awa) * R2D;
      const boom = Math.abs(s.boomAngle) * R2D;
      const jib = Math.abs(s.jibAngle) * R2D;
      const rows = this.sailLine('Main', boom, idealBoomDeg(awa), o.main.errDeg, o.main.eff, o.main.luff, o.main.stall, o.main.flogging)
        + (s.furl > 0.08 ? this.sailLine('Jib', jib, idealJibDeg(awa), o.jib.errDeg, o.jib.eff, o.jib.luff, o.jib.stall, o.jib.flogging) : '');
      // Turn the trim rule round: the apparent wind angle these sheet settings are right for.
      const wantMain = THREE.MathUtils.clamp((boom + 14) / 0.62, 24, 155);
      const wantJib = THREE.MathUtils.clamp((jib + 6) / 0.5, 24, 150);
      const want = s.furl > 0.08 ? (wantMain + wantJib) / 2 : wantMain;
      const turn = want - awa;
      let steer: string;
      if (o.jib.backed > 0.3) steer = 'The jib is aback. Let its old sheet go and trim the other.';
      else if (s.furl > 0.08 && Math.abs(wantMain - wantJib) > 14) steer = `The main is set for ${Math.round(wantMain)}° and the jib for ${Math.round(wantJib)}°: they are asking for different courses. Bring one to match the other.`;
      else if (Math.abs(turn) < 4) steer = `Set as they are, the sails want the apparent wind at ${Math.round(want)}°. It is at ${Math.round(awa)}°: she is in the groove.`;
      else steer = `Set as they are, the sails want the apparent wind at ${Math.round(want)}°. It is at ${Math.round(awa)}°: ${turn > 0 ? 'bear away' : 'head up'} ${Math.round(Math.abs(turn))}°, or ${turn > 0 ? 'trim in' : 'ease'} to suit this course.`;
      const pct = o.polarSpeed > 0.2 ? Math.round((s.speed / o.polarSpeed) * 100) : 0;
      html = `<h4>Wind tunnel${s.crewTrim ? ' <i>crew trimming</i>' : ''}</h4>${rows}
        <p>${esc(steer)}</p>
        <p class="speed">${(s.speed / KT).toFixed(1)} kt of a best ${(o.polarSpeed / KT).toFixed(1)} kt for this wind: <b>${pct}%</b></p>
        <p class="key"><i class="k smooth"></i>flowing <i class="k stalled"></i>stalled, sheeted too hard <i class="k dead"></i>luffing, eased too far</p>`;
    }
    if (html === this.cardHtml) return;
    this.cardHtml = html;
    this.card.innerHTML = html;
  }

  dispose(): void {
    this.ctx.boatView.root.remove(this.group);
    this.card.remove();
  }
}
