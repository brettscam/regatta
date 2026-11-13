import * as THREE from 'three';
import type { BoatSpec, ControlBinding, SimOutputs, SimState } from '@slack-tide/sim';
import { buildSloop, type Livery, type SloopModel } from './buildSloop';

export type { BoatDisplay, Livery } from './buildSloop';
import { Jib, Mainsail, type SailShape } from './sails';
import { Crew } from './crew';

const R2D = 180 / Math.PI;
const KT = 0.514444;
/** Turns of the wheel per radian of rudder. About 210 degrees of wheel for full rudder. */
export const WHEEL_RATIO = 6;

/** Where the boat is drawn this frame. Sim values, blended between steps, plus the motion the waves add. */
export interface BoatPose {
  x: number;
  z: number;
  heading: number;
  heel: number;
  pitch: number;
  heave: number;
  rudder: number;
  boom: number;
  jib: number;
}

class Rope {
  readonly mesh: THREE.Mesh;
  private static readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  constructor(color: number, radius = 0.011) {
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 5), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    this.mesh.castShadow = true;
  }
  set(a: THREE.Vector3, b: THREE.Vector3): void {
    this.dir.subVectors(b, a);
    const len = this.dir.length() || 1e-4;
    this.mesh.position.copy(a).addScaledVector(this.dir, 0.5);
    this.mesh.scale.set(1, len, 1);
    this.mesh.quaternion.setFromUnitVectors(Rope.up, this.dir.multiplyScalar(1 / len));
  }
}

class Telltale {
  readonly mesh: THREE.Mesh;
  private static readonly x = new THREE.Vector3(1, 0, 0);
  private readonly dir = new THREE.Vector3();
  constructor(color: number, length = 0.34) {
    const g = new THREE.BoxGeometry(1, 0.022, 0.006).translate(0.5, 0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color }));
    this.mesh.scale.x = length;
  }
  /** Stream from `at` along `flow`. `lift` raises it toward vertical, `flutter` shakes it. */
  set(at: THREE.Vector3, flow: THREE.Vector3, lift: number, flutter: number, time: number, seed: number): void {
    const wobble = flutter * (Math.sin(time * 21 + seed * 7) * 0.5 + Math.sin(time * 33 + seed * 3) * 0.3);
    this.dir.copy(flow);
    this.dir.y += lift + wobble;
    this.dir.x += wobble * 0.4;
    this.dir.normalize();
    this.mesh.position.copy(at);
    this.mesh.quaternion.setFromUnitVectors(Telltale.x, this.dir);
  }
}

export class BoatView {
  readonly root: THREE.Group;
  readonly model: SloopModel;
  readonly main: Mainsail;
  readonly jib: Jib;
  /** Everything the pointer can land on. */
  readonly pickables: THREE.Object3D[] = [];
  /** Solid parts the camera keeps out of. */
  readonly solids: THREE.Object3D[];
  /** Thin parts the camera hops across. */
  readonly thin: THREE.Object3D[];

  private readonly bindings = new Map<string, ControlBinding>();
  private readonly glowMeshes = new Map<string, THREE.Mesh[]>();
  private glowNode: string | null = null;
  private glowLevel = 0;
  private belly = 1;
  private windexAngle = 0;
  private winchSpin = { winch_port: 0, winch_stbd: 0 };
  private lastSheet = { winch_port: 0, winch_stbd: 0 };

  /** The mainsheet is a four-part tackle between a block on the boom and one on the traveller. */
  private readonly mainsheet = [new Rope(0xe8e4d8, 0.0065), new Rope(0xe8e4d8, 0.0065), new Rope(0xe8e4d8, 0.0065), new Rope(0xe8e4d8, 0.0065)];
  private readonly sheetBlock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }),
  );
  private ensignAngle = Math.PI / 2;
  private readonly pilotCanvas = document.createElement('canvas');
  private readonly pilotTexture: THREE.CanvasTexture;
  private pilotShown = '';
  private readonly vang = new Rope(0x2a2d31, 0.014);
  private readonly sheetPort = [new Rope(0xb5332a), new Rope(0xb5332a), new Rope(0xb5332a)];
  private readonly sheetStbd = [new Rope(0x2f8f55), new Rope(0x2f8f55), new Rope(0x2f8f55)];
  private readonly jibTells: Array<{ v: number; port: Telltale; stbd: Telltale }> = [];
  private readonly leechTells: Array<{ v: number; t: Telltale }> = [];

  private readonly crew: Crew;
  private readonly displayCanvas = document.createElement('canvas');
  private readonly displayTexture: THREE.CanvasTexture;
  private displayClock = 0;

  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();

  constructor(readonly spec: BoatSpec, readonly livery: Livery = {}) {
    this.model = buildSloop(spec, livery);
    this.root = this.model.root;
    this.root.rotation.order = 'YXZ';
    this.main = new Mainsail(this.model.geo, String((spec as BoatSpec & { lengthFt?: number }).lengthFt ?? 38));
    this.jib = new Jib(this.model.geo);
    this.root.add(this.main.mesh, this.jib.mesh);
    this.crew = new Crew(this.model);
    this.model.nodes.main = this.main.mesh;
    this.model.nodes.jib = this.jib.mesh;

    for (const b of spec.controls) this.bindings.set(b.node, b);

    // Give each control part its own materials so it can light up without lighting its neighbours.
    for (const node of this.bindings.keys()) {
      const obj = this.model.nodes[node];
      if (!obj) continue;
      const meshes: THREE.Mesh[] = [];
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.userData.glow) {
          m.material = (m.material as THREE.MeshStandardMaterial).clone();
          meshes.push(m);
        }
      });
      this.glowMeshes.set(node, meshes);
    }

    for (const r of [...this.mainsheet, this.vang, ...this.sheetPort, ...this.sheetStbd]) this.root.add(r.mesh);
    this.sheetBlock.castShadow = true;
    this.root.add(this.sheetBlock);
    for (const v of [0.28, 0.5, 0.72]) {
      const port = new Telltale(0xd8402f);
      const stbd = new Telltale(0x35b56a);
      this.root.add(port.mesh, stbd.mesh);
      this.jibTells.push({ v, port, stbd });
    }
    for (const v of [0.35, 0.6, 0.84]) {
      const t = new Telltale(0xd8402f, 0.42);
      this.root.add(t.mesh);
      this.leechTells.push({ v, t });
    }

    this.displayCanvas.width = 512;
    this.displayCanvas.height = 256;
    this.displayTexture = new THREE.CanvasTexture(this.displayCanvas);
    this.displayTexture.colorSpace = THREE.SRGBColorSpace;
    const display = this.model.nodes.mast_display as THREE.Mesh;
    (display.material as THREE.Material[])[4] = new THREE.MeshBasicMaterial({ map: this.displayTexture, toneMapped: false });

    // The autopilot head's screen.
    this.pilotCanvas.width = 300;
    this.pilotCanvas.height = 220;
    this.pilotTexture = new THREE.CanvasTexture(this.pilotCanvas);
    this.pilotTexture.colorSpace = THREE.SRGBColorSpace;
    const pilotScreen = this.model.nodes.autopilot_screen as THREE.Mesh | undefined;
    if (pilotScreen) pilotScreen.material = new THREE.MeshBasicMaterial({ map: this.pilotTexture, toneMapped: false });
    this.setPilot({ engaged: false, mode: 'heading', label: '' });

    this.pickables.push(...this.model.hitProxies, this.main.mesh, this.jib.mesh, this.model.nodes.hull, this.model.nodes.deck);
    this.solids = [this.model.nodes.hull, this.model.nodes.deck];
    this.thin = [this.main.mesh, this.jib.mesh, ...this.model.solids.filter((s) => s !== this.model.nodes.hull && s !== this.model.nodes.deck)];
  }

  /** Which named part a pointer hit belongs to, and the control bound to it if there is one. */
  resolve(hit: THREE.Intersection): { node: string; binding: ControlBinding | null; view: string } {
    let node = (hit.object.userData.node as string | undefined) ?? '';
    for (let o: THREE.Object3D | null = hit.object; o && !node; o = o.parent) {
      if (o.name && this.model.nodes[o.name] === o) node = o.name;
    }
    const binding = this.bindings.get(node) ?? null;
    // The working view for whatever was pointed at.
    let view = binding?.view ?? '';
    if (!view) {
      if (node === 'main' || node === 'mast') view = 'mast';
      else if (node === 'jib' || node === 'furler') view = 'foredeck';
      else {
        const z = this.root.worldToLocal(this.v1.copy(hit.point)).z;
        view = z > 1.6 ? 'helm' : z > -2.4 ? 'mast' : 'foredeck';
      }
    }
    return { node, binding, view };
  }

  /** Light up one control part, or none. */
  setGlow(node: string | null): void {
    if (node === this.glowNode) return;
    if (this.glowNode) this.applyGlow(this.glowNode, 0);
    this.glowNode = node;
    this.glowLevel = 0;
  }

  private applyGlow(node: string, level: number): void {
    for (const m of this.glowMeshes.get(node) ?? []) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissive.setRGB(1.0, 0.62, 0.18);
      mat.emissiveIntensity = level;
    }
  }

  /** A world-space point on a control part and the direction it moves as the control's value goes up. */
  handle(node: string, state: SimState, point: THREE.Vector3, tangent: THREE.Vector3): { metresPerUnit: number } | null {
    const geo = this.model.geo;
    if (node === 'wheel') {
      // The top of the rim moves to starboard as the wheel turns to starboard.
      const R = geo.wheelRadius;
      this.root.localToWorld(point.copy(geo.wheel).add(this.v1.set(0, R, 0)));
      tangent.set(1, 0, 0).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: R * WHEEL_RATIO };
    }
    if (node === 'boom') {
      // Easing lets the boom end swing further out on the side it is already on.
      const side = Math.sign(state.boomAngle) || state.mainSide;
      const a = state.boomAngle;
      this.root.localToWorld(point.set(Math.sin(a) * geo.boomLength, 0, Math.cos(a) * geo.boomLength).add(geo.gooseneck));
      tangent.set(Math.cos(a) * side, 0, -Math.sin(a) * side).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: geo.boomLength };
    }
    if (node === 'autopilot') {
      // The control head on the cabin bulkhead. Turning its dial to the right raises the value.
      this.model.nodes.autopilot.getWorldPosition(point);
      tangent.set(1, 0, 0).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: 1 };
    }
    if (node === 'winch_port' || node === 'winch_stbd') {
      // Pulling in toward the centreline grinds the sheet in, which lowers the slack.
      const side = node === 'winch_port' ? -1 : 1;
      this.root.localToWorld(point.copy(side < 0 ? geo.winchPort : geo.winchStbd));
      tangent.set(side, 0, 0).transformDirection(this.root.matrixWorld);
      return { metresPerUnit: 2.2 };
    }
    return null;
  }

  update(pose: BoatPose, state: SimState, out: SimOutputs, time: number, dt: number): void {
    const { nodes, geo } = this.model;
    this.root.position.set(pose.x, pose.heave, pose.z);
    this.root.rotation.set(pose.pitch, -pose.heading, -pose.heel);

    nodes.wheel.rotation.z = -pose.rudder * WHEEL_RATIO;
    nodes.rudder.rotation.y = pose.rudder;
    nodes.boom.rotation.y = pose.boom;

    // The sails belly away from the wind. Crossing the wind they pass through flat.
    const windSide = out.awa >= 0 ? 1 : -1;
    const bellyTarget = Math.abs(out.awa) < 0.05 ? 0 : -windSide;
    this.belly += THREE.MathUtils.clamp(bellyTarget - this.belly, -dt * 3.5, dt * 3.5);

    const mainShape: SailShape = { angle: pose.boom, luff: out.main.luff, stall: out.main.stall, flogging: out.main.flogging, belly: this.belly, aws: out.aws };
    this.main.update(mainShape, this.spec.sails.main.reefs[state.reef].luff, time, dt);
    // A loose boom shakes with the sail.
    if (out.main.flogging) nodes.boom.rotation.y += Math.sin(time * 9.5) * 0.035 * Math.min(1.5, out.aws / 8);

    const jibShape: SailShape = { angle: pose.jib, luff: out.jib.luff, stall: out.jib.stall, flogging: out.jib.flogging, belly: this.belly, aws: out.aws };
    this.jib.update(jibShape, state.furl, time);

    // Running rigging.
    const boomA = nodes.boom.rotation.y;
    const onBoom = (dist: number, drop: number, o: THREE.Vector3) =>
      o.set(Math.sin(boomA) * dist, -drop, Math.cos(boomA) * dist).add(geo.gooseneck);
    // Mainsheet: four parts fanned between the boom block and the traveller block.
    const sheetTop = onBoom(geo.boomLength * 0.83, 0.2, this.v1);
    this.sheetBlock.position.copy(sheetTop);
    this.sheetBlock.position.y += 0.07;
    this.sheetBlock.rotation.y = boomA;
    this.mainsheet.forEach((part, i) => {
      const off = (i - 1.5) * 0.022;
      this.v2.set(sheetTop.x + Math.cos(boomA) * off, sheetTop.y + 0.05, sheetTop.z - Math.sin(boomA) * off);
      this.v3.set(geo.traveller.x + off * 1.4, geo.traveller.y + 0.12, geo.traveller.z);
      part.set(this.v2, this.v3);
    });
    this.vang.set(onBoom(geo.boomLength * 0.29, 0.08, this.v1), geo.vangBase);
    const clew = this.jib.clew;
    const jibUp = state.furl > 0.03;
    const leeIsPort = clew.x <= 0;
    const around = this.v2.set((leeIsPort ? -1 : 1) * 0.16, geo.jibClewY - 0.3, geo.mastZ - 0.24);
    const lead = (ropes: Rope[], car: THREE.Vector3, winch: THREE.Vector3, working: boolean) => {
      for (const r of ropes) r.mesh.visible = jibUp;
      if (!jibUp) return;
      if (working) {
        ropes[0].set(clew, car);
        ropes[1].set(car, winch);
        ropes[2].mesh.visible = false;
      } else {
        // The lazy sheet leads round the front of the mast to the other side.
        ropes[0].set(clew, around);
        ropes[1].set(around, car);
        ropes[2].set(car, winch);
      }
    };
    lead(this.sheetPort, geo.carPort, geo.winchPort, leeIsPort);
    lead(this.sheetStbd, geo.carStbd, geo.winchStbd, !leeIsPort);

    // Winch drums turn as their sheets move.
    for (const name of ['winch_port', 'winch_stbd'] as const) {
      const sheet = name === 'winch_port' ? state.jibSheetPort : state.jibSheetStbd;
      this.winchSpin[name] += (sheet - this.lastSheet[name]) * 9;
      this.lastSheet[name] = sheet;
      nodes[`${name}_drum`].rotation.y = this.winchSpin[name];
    }

    // Telltales. The windward one lifts when the sail is starved (too close to the wind or eased too far).
    // The leeward one flutters and droops when the sail is stalled (sheeted too hard).
    const flow = this.v3;
    for (let i = 0; i < this.jibTells.length; i++) {
      const tt = this.jibTells[i];
      tt.port.mesh.visible = tt.stbd.mesh.visible = jibUp;
      if (!jibUp) continue;
      const at = this.jib.surfacePoint(0.16, tt.v, this.v1, flow);
      const nx = flow.z;
      const nz = -flow.x;
      const windwardIsStbd = this.belly < 0;
      const starved = out.jib.flogging ? 1 : out.jib.luff;
      const stalled = Math.max(out.jib.stall, out.jib.backed);
      for (const [tell, isStbd] of [[tt.port, false], [tt.stbd, true]] as const) {
        const off = isStbd ? 0.03 : -0.03;
        this.v2.set(at.x + nx * off, at.y, at.z + nz * off);
        const windward = isStbd === windwardIsStbd;
        const lift = windward ? starved * 1.1 : -stalled * 0.9;
        const flutter = windward ? starved * 0.9 : stalled * 1.0;
        tell.set(this.v2, flow, lift, flutter + 0.04, time, i + (isStbd ? 10 : 0));
      }
    }
    for (let i = 0; i < this.leechTells.length; i++) {
      const lt = this.leechTells[i];
      const at = this.main.leechPoint(lt.v, this.v1);
      const a = boomA;
      flow.set(Math.sin(a), 0, Math.cos(a));
      // A stalled main hides its leech ribbons behind the sail: they curl to leeward and droop.
      const stalled = out.main.stall;
      flow.x += this.belly * stalled * 1.2;
      lt.t.set(at, flow, -stalled * 0.8, out.main.luff * 0.8 + stalled * 0.5 + 0.05, time, 20 + i);
    }

    // Masthead vane points to where the apparent wind comes from.
    const want = -out.awa;
    let dA = want - this.windexAngle;
    dA = Math.atan2(Math.sin(dA), Math.cos(dA));
    this.windexAngle += dA * Math.min(1, dt * 6);
    nodes.windex_arrow.rotation.y = this.windexAngle + Math.sin(time * 5.1) * 0.03;

    this.updateEnsign(out, time, dt);

    if (this.glowNode) {
      this.glowLevel += (1 - this.glowLevel) * Math.min(1, dt * 12);
      this.applyGlow(this.glowNode, this.glowLevel * (1.1 + 0.25 * Math.sin(time * 5)));
    }

    this.crew.update(state, out, pose, time, dt);

    this.displayClock -= dt;
    if (this.displayClock <= 0) {
      this.displayClock = 0.25;
      this.drawDisplay(state, out);
    }
  }

  /** The ensign streams away from the apparent wind, lifts as it freshens and hangs when it is light. */
  private updateEnsign(out: SimOutputs, time: number, dt: number): void {
    const group = this.model.nodes.ensign;
    const flag = this.model.nodes.ensign_flag as THREE.Mesh | undefined;
    if (!group || !flag) return;
    // The fly is the flag's local +X. Turn it to point downwind in the boat's frame.
    const want = Math.atan2(-Math.cos(out.awa), -Math.sin(out.awa));
    let d = want - this.ensignAngle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.ensignAngle += d * Math.min(1, dt * 4);
    group.rotation.y = this.ensignAngle + Math.sin(time * 2.3) * 0.06;
    const fly = flag.userData.fly as number;
    const hoist = flag.userData.hoist as number;
    const wind = Math.min(1.4, out.aws / 7);
    const droop = 1 - Math.min(1, out.aws / 5);
    const pos = flag.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cols = 13;
    for (let i = 0; i < pos.count; i++) {
      const u = (i % cols) / (cols - 1);
      const v = Math.floor(i / cols) / 5;
      const wave = Math.sin(u * 8 - time * (9 + 6 * wind) + v * 1.7) * 0.05 * u * (0.25 + wind)
        + Math.sin(u * 15 - time * 17 + v * 3.1) * 0.016 * u * wind;
      pos.setXYZ(i, u * fly * (1 - 0.4 * droop * u), -v * hoist - droop * 0.8 * u * u * fly, wave);
    }
    pos.needsUpdate = true;
    flag.geometry.computeVertexNormals();
  }

  /**
   * Show the autopilot's state on its control head.
   * Redraws only when something changes.
   */
  setPilot(info: { engaged: boolean; mode: 'heading' | 'wind' | 'route'; label: string }): void {
    const key = `${info.engaged}|${info.mode}|${info.label}`;
    if (key === this.pilotShown) return;
    this.pilotShown = key;
    const g = this.pilotCanvas.getContext('2d')!;
    const W = this.pilotCanvas.width;
    const H = this.pilotCanvas.height;
    const on = info.engaged;
    g.fillStyle = on ? '#0c3b33' : '#071216';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = on ? '#57e6b6' : '#1d3c46';
    g.lineWidth = on ? 6 : 3;
    g.strokeRect(5, 5, W - 10, H - 10);
    const modeName = info.mode === 'heading' ? 'HEADING' : info.mode === 'wind' ? 'WIND ANGLE' : 'ROUTE';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = '700 26px ui-sans-serif, system-ui, sans-serif';
    g.fillStyle = on ? '#9ff5d6' : '#5f8f9b';
    g.fillText(modeName, 20, 38);
    if (on) {
      g.fillStyle = '#57e6b6';
      g.fillRect(W - 96, 20, 78, 36);
      g.fillStyle = '#062019';
      g.textAlign = 'center';
      g.font = '800 24px ui-sans-serif, system-ui, sans-serif';
      g.fillText('AUTO', W - 57, 39);
    }
    // The big line: what she is holding. Shrink long names to fit.
    g.textAlign = 'center';
    const big = on ? info.label || '—' : 'STANDBY';
    let size = on ? 92 : 52;
    g.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
    while (g.measureText(big).width > W - 36 && size > 26) {
      size -= 4;
      g.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
    }
    g.fillStyle = on ? '#f2fffb' : '#4f7480';
    g.fillText(big, W / 2, on ? 128 : 112);
    if (!on && info.label) {
      g.font = '600 30px ui-sans-serif, system-ui, sans-serif';
      g.fillStyle = '#3f616b';
      g.fillText(info.label, W / 2, 168);
    }
    this.pilotTexture.needsUpdate = true;
    // The dial's mark turns with the mode, as a small sign of life.
    const knob = this.model.nodes.autopilot_knob;
    if (knob) knob.rotation.z = info.mode === 'heading' ? 0.5 : info.mode === 'wind' ? 0 : -0.5;
  }

  private drawDisplay(state: SimState, out: SimOutputs): void {
    const g = this.displayCanvas.getContext('2d')!;
    const W = this.displayCanvas.width;
    const H = this.displayCanvas.height;
    g.fillStyle = '#071216';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1d3c46';
    g.lineWidth = 3;
    g.strokeRect(4, 4, W - 8, H - 8);
    g.beginPath();
    g.moveTo(W / 2, 10);
    g.lineTo(W / 2, H - 10);
    g.moveTo(10, H / 2);
    g.lineTo(W - 10, H / 2);
    g.stroke();
    const cell = (cx: number, cy: number, label: string, value: string) => {
      g.fillStyle = '#6fa8b6';
      g.font = '600 24px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(label, cx - 112, cy - 28);
      g.fillStyle = '#eafcff';
      g.font = '700 76px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'right';
      g.fillText(value, cx + 112, cy + 44);
    };
    const awa = Math.abs(out.awa) * R2D;
    cell(W * 0.25, H * 0.25, 'SPD', (state.speed / KT).toFixed(1));
    cell(W * 0.75, H * 0.25, 'HDG', String(Math.round(state.heading * R2D) % 360).padStart(3, '0'));
    cell(W * 0.25, H * 0.75, out.awa >= 0 ? 'AWA S' : 'AWA P', awa.toFixed(0));
    cell(W * 0.75, H * 0.75, 'AWS', (out.aws / KT).toFixed(0));
    this.displayTexture.needsUpdate = true;
  }
}
