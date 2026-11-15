import * as THREE from 'three';
import { KT } from '@slack-tide/sim';
import type { AboardContext, Feature } from './feature';
import {
  BATTERY_LOW, BATTERY_VERY_LOW, FUEL_LOW, FUEL_VERY_LOW, RACE_NEUTRAL,
  batteryWarning, fuelWarning, panelShown, raceBarsEngine, throttleName, throttleSays, throttleStep,
} from './engineRules';

const PUFFS = 30;
const DROPS = 5;

interface Puff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  age: number;
  life: number;
  size: number;
}

/**
 * The engine as the player meets it. I starts and stops it, full stop and comma step the throttle ahead and astern
 * through neutral, and every change is said in a line. The engine itself is in the sim (`startEngine`, `setThrottle`,
 * fuel and battery in the state). Here are the keys, the rule that bars it in a race, the small panel under the
 * instruments, the propeller's wash and the exhaust water at the stern, and its sound.
 */
export class Engine implements Feature {
  readonly id = 'engine';

  private readonly panel = document.createElement('div');
  private readonly revs: HTMLElement;
  private readonly revsSub: HTMLElement;
  private readonly fuelN: HTMLElement;
  private readonly fuelBar: HTMLElement;
  private readonly fuelBox: HTMLElement;
  private readonly battN: HTMLElement;
  private readonly battBar: HTMLElement;
  private readonly battBox: HTMLElement;
  private shown = '';

  private readonly wash = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private nextPuff = 0;
  private sinceSpawn = 0;
  private readonly exhaust = new THREE.Group();
  private readonly drops: THREE.Mesh[] = [];
  private pulse = 0;

  private wasOn: boolean;
  private wasCranking: boolean;
  private stops: number;
  private trips: number;
  private fuelWas: number;
  private battWas: number;
  private holdWas: string;
  private tick: number;
  /** Seconds until the shore tops her up, once she is alongside. Below 0 there is nothing waiting. */
  private shore = -1;

  constructor(private readonly ctx: AboardContext) {
    const s = ctx.sim.state;
    this.wasOn = s.engineOn;
    this.wasCranking = s.engineCrank > 0;
    this.stops = s.engineStops;
    this.trips = s.batteryTrips;
    this.fuelWas = this.fuelShare();
    this.battWas = ctx.sim.battery;
    this.holdWas = s.hold;
    this.tick = s.tick;

    // The panel is a row of the instrument readout, so it hides with the instruments on H.
    this.panel.className = 'engine';
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <div class="revs"><span class="k">Engine</span><b></b><small></small></div>
      <div class="gauge fuel"><span class="k">Fuel</span><span class="n"></span><div class="bar"><i></i></div></div>
      <div class="gauge batt"><span class="k">Battery</span><span class="n"></span><div class="bar"><i></i></div></div>`;
    this.revs = this.panel.querySelector('.revs b') as HTMLElement;
    this.revsSub = this.panel.querySelector('.revs small') as HTMLElement;
    this.fuelBox = this.panel.querySelector('.fuel') as HTMLElement;
    this.fuelN = this.fuelBox.querySelector('.n') as HTMLElement;
    this.fuelBar = this.fuelBox.querySelector('i') as HTMLElement;
    this.battBox = this.panel.querySelector('.batt') as HTMLElement;
    this.battN = this.battBox.querySelector('.n') as HTMLElement;
    this.battBar = this.battBox.querySelector('i') as HTMLElement;
    document.getElementById('readout')?.appendChild(this.panel);

    // The propeller's wash: patches of white water left astern, each spreading and fading where it was made.
    const disc = new THREE.CircleGeometry(0.5, 14);
    disc.rotateX(-Math.PI / 2);
    for (let i = 0; i < PUFFS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xf2f7f8, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(disc, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.wash.add(mesh);
      this.puffs.push({ mesh, mat, x: 0, z: 0, age: 0, life: 0, size: 1 });
    }
    this.wash.name = 'prop-wash';
    ctx.stage.scene.add(this.wash);

    // Cooling water spat out with the exhaust, low on the port quarter.
    const drop = new THREE.SphereGeometry(0.035, 6, 5);
    const water = new THREE.MeshBasicMaterial({ color: 0xe9f3f6, transparent: true, opacity: 0.85 });
    for (let i = 0; i < DROPS; i++) {
      const m = new THREE.Mesh(drop, water);
      this.exhaust.add(m);
      this.drops.push(m);
    }
    this.exhaust.name = 'exhaust-water';
    this.exhaust.visible = false;
    this.reboat();
  }

  private fuelShare(): number {
    const e = this.ctx.sim.boat.engine;
    return e ? this.ctx.sim.fuel / e.tankL : 1;
  }

  /** True while a race bars the engine: from five minutes before the gun until she finishes or leaves. */
  get barred(): boolean {
    const race = this.ctx.race;
    return raceBarsEngine(race ? { entered: race.call !== null, finished: race.finish !== null, countdown: race.countdown } : null);
  }

  // ---- keys -----------------------------------------------------------------------------------

  key(code: string): boolean {
    if (code !== 'KeyI' && code !== 'Period' && code !== 'Comma') return false;
    const { sim } = this.ctx;
    const s = sim.state;
    const engine = sim.boat.engine;
    if (!engine) {
      this.ctx.say('She has no engine');
      return true;
    }
    if (code === 'KeyI') {
      if (s.engineOn || s.engineCrank > 0) {
        sim.stopEngine();
        this.wasOn = false;
        this.wasCranking = false;
        this.ctx.say(s.hold === 'none' ? 'Engine off. She is under sail alone' : 'Engine off');
        return true;
      }
      const result = sim.startEngine();
      if (result === 'dry') this.ctx.say('The tank is dry, so the engine will not start. A dock fills it: come alongside one with X', 7);
      else if (result === 'flat') this.ctx.say('The battery is too flat to turn the engine over. Come alongside a dock with X to charge it', 7);
      else {
        this.wasCranking = true;
        this.ctx.say('Starting the engine', 3);
      }
      return true;
    }
    const step = throttleStep({ engineOn: s.engineOn, cranking: s.engineCrank > 0, hold: s.hold, notch: s.throttle, barred: this.barred }, code === 'Period' ? 1 : -1);
    if (step.to === undefined) {
      this.ctx.say(step.say ?? '', 6);
      return true;
    }
    sim.setThrottle(step.to);
    this.ctx.say(throttleSays(engine, s.throttle), 4);
    return true;
  }

  // ---- every frame ----------------------------------------------------------------------------

  update(dt: number, seaTime: number): void {
    const { sim } = this.ctx;
    const s = sim.state;
    const o = sim.out;
    const engine = sim.boat.engine;
    if (!engine) {
      this.panel.hidden = true;
      this.exhaust.visible = false;
      this.ctx.sound.engine(0, 0, false);
      return;
    }
    const running = s.tick !== this.tick;
    this.tick = s.tick;
    const step = Math.min(dt, 0.2);

    // What has happened since the last frame, said once.
    if (s.engineOn && !this.wasOn && this.wasCranking) {
      this.ctx.say(s.hold === 'none'
        ? `Engine on, out of gear. Full stop puts her ahead, comma astern${this.barred ? '. Not in this race, though' : ''}`
        : 'Engine on, out of gear, ready to leave. X lets her go', 6);
    }
    if (s.engineStops > this.stops) this.ctx.alarm('Out of fuel. The engine has stopped and she is under sail alone. A dock fills the tank');
    if (s.batteryTrips > this.trips) this.ctx.alarm('The battery is too low for the autopilot. You have the helm. Start the engine with I to charge it');
    this.stops = s.engineStops;
    this.trips = s.batteryTrips;
    this.wasOn = s.engineOn;
    this.wasCranking = s.engineCrank > 0;

    // In a race the engine comes out of gear at five minutes and stays out.
    if (s.throttle !== 0 && this.barred) {
      sim.setThrottle(0);
      this.ctx.alarm(RACE_NEUTRAL);
    }

    const fuel = this.fuelShare();
    const batt = sim.battery;
    const warn = fuelWarning(engine, this.fuelWas, fuel) ?? batteryWarning(this.battWas, batt, s.engineOn);
    if (warn) this.ctx.alarm(warn);
    this.fuelWas = fuel;
    this.battWas = batt;

    // Alongside a dock the shore fills the tank and charges the battery, a few seconds after the lines are on.
    if (s.hold !== this.holdWas) {
      this.holdWas = s.hold;
      const dock = s.hold === 'mooring' && this.ctx.places.some((p) => p.kind === 'dock' && Math.hypot(p.x - s.holdX, p.y - s.holdY) < 5);
      this.shore = dock && (fuel < 0.97 || batt < 0.97) ? 9 : -1;
    }
    if (this.shore >= 0 && s.hold === 'mooring') {
      this.shore -= step;
      if (this.shore < 0) {
        const what = fuel < 0.97 && batt < 0.97 ? 'The tank is filled and the battery charged' : fuel < 0.97 ? 'The tank is filled' : 'The battery is charged';
        sim.provision();
        this.fuelWas = 1;
        this.battWas = 1;
        this.ctx.say(`${what} from the dock`, 6);
      }
    }

    this.drawPanel(fuel, batt);
    const load = s.engineOn ? Math.abs(s.throttle) / 4 : 0;
    this.ctx.sound.engine(o.engineRpm, load, !running);
    this.drawWash(step, seaTime, running);
    this.drawExhaust(step, running);
  }

  private drawPanel(fuel: number, batt: number): void {
    const { sim } = this.ctx;
    const s = sim.state;
    const cranking = s.engineCrank > 0;
    const show = panelShown({ engineOn: s.engineOn, cranking, fuel, battery: batt });
    if (this.panel.hidden === show) this.panel.hidden = !show;
    if (!show) return;
    const litres = Math.round(sim.fuel);
    const key = `${s.engineOn ? s.throttle : cranking ? 'c' : 'x'}|${litres}|${Math.round(batt * 100)}`;
    if (key === this.shown) return;
    this.shown = key;
    this.revs.textContent = s.engineOn ? throttleName(s.throttle) : cranking ? 'Starting' : 'Off';
    this.revsSub.textContent = s.engineOn ? `${sim.out.engineRpm} rpm${s.throttle === 0 ? ' · idling' : ''}` : cranking ? 'turning over' : 'I starts it';
    (this.revs.parentElement as HTMLElement).classList.toggle('off', !s.engineOn);
    this.fuelN.textContent = `${litres} L`;
    this.fuelBar.style.width = `${Math.round(fuel * 100)}%`;
    this.fuelBox.classList.toggle('low', fuel <= FUEL_LOW && fuel > FUEL_VERY_LOW);
    this.fuelBox.classList.toggle('out', fuel <= FUEL_VERY_LOW);
    this.battN.textContent = `${Math.round(batt * 100)}%${s.engineOn && batt < 0.995 ? ' charging' : ''}`;
    this.battBar.style.width = `${Math.round(batt * 100)}%`;
    this.battBox.classList.toggle('low', batt <= BATTERY_LOW && batt > BATTERY_VERY_LOW);
    this.battBox.classList.toggle('out', batt <= BATTERY_VERY_LOW);
  }

  /** White water from the propeller: astern of her going ahead, washed forward along the quarters going astern. */
  private drawWash(dt: number, seaTime: number, running: boolean): void {
    const { sim, stage } = this.ctx;
    const s = sim.state;
    const loa = sim.boat.dimensions.loa;
    if (running && sim.underPower) {
      const push = Math.abs(s.throttle) / 4;
      this.sinceSpawn += dt;
      const every = 0.22 - 0.12 * push;
      if (this.sinceSpawn >= every) {
        this.sinceSpawn = 0;
        const p = this.puffs[this.nextPuff];
        this.nextPuff = (this.nextPuff + 1) % PUFFS;
        // The propeller is under the quarter. Ahead, its race comes up a little way astern; astern, under the hull.
        const back = s.throttle > 0 ? loa * 0.52 : loa * 0.3;
        const side = (Math.random() - 0.5) * 0.5;
        p.x = s.x - Math.sin(s.heading) * back + Math.cos(s.heading) * side;
        p.z = -(s.y - Math.cos(s.heading) * back - Math.sin(s.heading) * side);
        p.age = 0;
        p.life = 2.2 + 2.2 * push;
        p.size = 0.7 + 0.9 * push + Math.random() * 0.3;
        p.mesh.visible = true;
      }
    }
    for (const p of this.puffs) {
      if (!p.mesh.visible) continue;
      if (running) p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.mesh.visible = false;
        continue;
      }
      const size = p.size * (1 + 1.8 * k);
      p.mesh.scale.set(size, 1, size);
      p.mesh.position.set(p.x, stage.seaLevel(p.x, p.z, seaTime, 4) + 0.05, p.z);
      p.mat.opacity = 0.5 * (1 - k) * Math.min(1, p.age * 6);
    }
  }

  /** The exhaust spits its cooling water in beats, quicker as the revs rise. */
  private drawExhaust(dt: number, running: boolean): void {
    const s = this.ctx.sim.state;
    this.exhaust.visible = s.engineOn;
    if (!s.engineOn) return;
    if (running) this.pulse = (this.pulse + dt * (1.6 + this.ctx.sim.out.engineRpm / 1300)) % 1;
    for (let i = 0; i < DROPS; i++) {
      // Each drop leaves the pipe, arcs out and falls to the water.
      const k = (this.pulse + i / DROPS) % 1;
      this.drops[i].position.set(0, -0.9 * k * k, 0.42 * k);
      this.drops[i].scale.setScalar(1 - 0.5 * k);
    }
  }

  // ---- what the others see --------------------------------------------------------------------

  status(): string {
    const { sim } = this.ctx;
    if (!sim.underPower) return '';
    if (sim.state.throttle < 0) return 'Under power, going astern';
    const o = sim.out;
    // With a sail full and pulling as well, she is motor-sailing.
    const sailing = !o.main.flogging && o.main.eff > 0.6 && Math.abs(o.twa) > 0.6 && o.tws > 4 * KT;
    return sailing ? 'Motor-sailing' : 'Under power';
  }

  wire(): Record<string, unknown> {
    return { en: this.ctx.sim.underPower ? 1 : 0 };
  }

  /** Hang the exhaust on the boat she is in now. */
  reboat(): void {
    const { boatView, spec } = this.ctx;
    const d = spec.dimensions;
    this.exhaust.position.set(-d.beam * 0.22, 0.32, d.loa * 0.5);
    boatView.root.add(this.exhaust);
  }

  dispose(): void {
    this.panel.remove();
    this.ctx.stage.scene.remove(this.wash);
    this.exhaust.removeFromParent();
    for (const p of this.puffs) p.mat.dispose();
    this.puffs[0]?.mesh.geometry.dispose();
    this.drops[0]?.geometry.dispose();
    (this.drops[0]?.material as THREE.Material | undefined)?.dispose();
    this.ctx.sound.engine(0, 0, false);
  }
}
