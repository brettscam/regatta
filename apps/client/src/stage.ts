import * as THREE from 'three';
import { KT } from '@slack-tide/sim';
import type { CourseData, ReplayWorld } from '@slack-tide/world';
import { Ocean } from './scene/ocean';
import { SkySystem } from './scene/sky';
import { Buoy, buildBridge, buildTerrain } from './scene/terrain';
import { Traffic, type TrafficVessel } from './scene/traffic';
import { buildScenery } from './scene/scenery';
import { clearCityNight, setCityNight } from './scene/massing';
import { buildWaves, setSeaState, waveHeight, type Wave } from './scene/waves';
import { SeaField } from './scene/seaField';
import { Wake, type WakeVessel } from './scene/wake';
import { Spray } from './scene/spray';
import { graphics } from './scene/quality';
import type { LoadedCourse } from './world/loadCourse';

export interface StageBoat {
  /** Scene coordinates: X east, Z south. */
  x: number;
  z: number;
  heading: number;
  speed: number;
  heel: number;
  /** Her size, for the wake she leaves. A 38-footer if not given. */
  length?: number;
  beam?: number;
}

/**
 * Everything that is there whoever is sailing and before anyone is: the renderer, the sea, the sky, the land,
 * the water's traffic. The join screen and the sailing session both draw through this.
 * The sea and sky are made once. The land, marks and traffic belong to the course and are swapped with `setCourse`.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sky: SkySystem;
  readonly ocean: Ocean;
  /** The course's wind and depth as the sea's shader reads them. */
  readonly field = new SeaField();
  /** What every vessel leaves on the water, and the spray off their bows. */
  readonly wake: Wake;
  readonly spray = new Spray();
  private readonly afloat: WakeVessel[] = [];
  private readonly white = new THREE.Color();
  private readonly tint = new THREE.Color();
  private readonly seaAt = (x: number, z: number, count: number) => waveHeight(this.waves, x, z, this.seaTime, count);
  private seaTime = 0;
  private lastSea = 0;
  traffic!: Traffic;
  course!: CourseData;
  world!: ReplayWorld;
  readonly waves: Wave[] = [];
  /** The land and what stands on it, for the course showing. */
  private land: THREE.Group | null = null;
  private readonly haze = new THREE.Fog(0xb9cbd6, 1200, 30000);
  private buoys: Buoy[] = [];
  private readonly focus = new THREE.Vector3();
  private seaKt = 0;
  private pixelRatio = Math.min(window.devicePixelRatio, 2);
  private readonly pace = { time: 0, frames: 0, slowWindows: 0, warmup: 4 };
  private frameCount = 0;
  private camera: THREE.PerspectiveCamera | null = null;

  constructor(readonly canvas: HTMLCanvasElement, data: LoadedCourse, world: ReplayWorld) {
    canvas.tabIndex = 0;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.46;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Haze takes the far shore, as it does on the Bay.
    this.scene.fog = this.haze;
    this.sky = new SkySystem(this.renderer, this.scene);
    this.wake = new Wake(graphics.level);
    this.ocean = new Ocean(this.sky.reflection.texture, this.wake, this.field);
    this.scene.add(this.ocean.mesh, this.spray.points);
    this.applyQuality();
    graphics.watch(() => this.applyQuality());
    this.setCourse(data, world);
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Put a course on the stage: its land, what stands on it, its buoys and its traffic. Whatever was there goes.
   * What stands on the land is named by the course's own `about.json`, so San Francisco's bridge and skyline
   * are only ever built for San Francisco Bay.
   */
  setCourse(data: LoadedCourse, world: ReplayWorld): void {
    if (this.land) {
      this.scene.remove(this.land);
      this.land.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) m.dispose();
      });
    }
    // Whatever followed the shore lights belonged to the land that has just gone.
    clearCityNight();
    this.course = data.course;
    this.world = world;
    this.field.setCourse(data.course, data.depth);
    const scenery = data.about.scenery ?? {};
    const pieces = new Set(scenery.pieces ?? []);
    const land = new THREE.Group();
    land.name = 'course';
    land.add(buildTerrain(this.course, data.terrain, scenery.landCover));
    if (pieces.has('san-francisco')) land.add(buildScenery(this.course, data.terrain, data.depth));
    if (pieces.has('golden-gate-bridge') && this.course.bridge) land.add(buildBridge(this.course.bridge));
    this.sky.setMarineLayer(pieces.has('marine-layer'));
    this.buoys = this.course.marks.filter((m) => m.kind === 'buoy').map((m, i) => new Buoy(m.x, m.y, i % 2 ? 0x2f8f55 : 0xb5332a));
    for (const b of this.buoys) land.add(b.group);
    // Other vessels on the water. Where each one is depends only on the time, so everyone sees the same traffic.
    this.traffic = new Traffic(data.traffic, world);
    land.add(this.traffic.group);
    this.scene.add(land);
    this.land = land;

    // The sea runs with the wind of the hour. Its height follows the wind after that.
    const wind = world.wind(0, 0, 0);
    this.waves.splice(0, this.waves.length, ...buildWaves(wind.dir, wind.speed / KT));
    this.seaKt = wind.speed / KT;
  }

  /** Every vessel's wake into the sea's maps, and spray off the bows near enough to see. */
  private wakes(seaTime: number, camera: THREE.PerspectiveCamera, boat: StageBoat, ships: TrafficVessel[], windFrom: number, windSpeed: number, windKt: number, day: number): void {
    const list = this.afloat;
    const n = ships.length + 1;
    while (list.length < n) list.push({ id: '', x: 0, z: 0, heading: 0, speed: 0, length: 11.6, beam: 3.8, lee: 0 });
    list.length = n;
    const me = list[0];
    me.id = 'own';
    me.x = boat.x; me.z = boat.z; me.heading = boat.heading; me.speed = boat.speed;
    me.length = boat.length ?? 11.6; me.beam = boat.beam ?? 3.8;
    me.lee = THREE.MathUtils.clamp(boat.heel / 0.3, -1, 1);
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      const v = list[i + 1];
      v.id = s.id;
      v.x = s.x; v.z = -s.y; v.heading = s.heading; v.speed = s.sog; v.length = s.length; v.beam = s.beam;
      // A sailing boat heels away from the wind, and her leeward bow wave is the bigger one.
      v.lee = s.kind === 'sail' ? -Math.sign(Math.sin(windFrom - s.heading)) * 0.7 * Math.min(1, s.sog / 2) : 0;
    }
    this.wake.update(this.renderer, seaTime, camera, list);

    const dt = seaTime - this.lastSea;
    this.lastSea = seaTime;
    this.seaTime = seaTime;
    const toward = windFrom + Math.PI;
    for (let i = 0; i < n; i++) {
      const v = list[i];
      const dx = v.x - camera.position.x;
      const dz = v.z - camera.position.z;
      if (dx * dx + dz * dz > 220 * 220 + v.length * v.length * 9) continue;
      this.spray.bow(v.id, seaTime, dt, v.x, v.z, v.heading, v.speed, v.length, v.beam, Math.sign(v.lee), windKt, this.seaAt);
    }
    // White water takes the colour of the light: bright by day, warm at sunset, a grey ghost at night.
    this.white.copy(this.haze.color).multiplyScalar(0.3).add(this.tint.copy(this.sky.sunColor).multiplyScalar(0.62 * day + 0.05));
    this.spray.update(seaTime, camera, this.renderer.domElement.height, Math.sin(toward) * windSpeed, -Math.cos(toward) * windSpeed, this.white);
  }

  /** Height of the sea at a scene position. */
  seaLevel(x: number, z: number, seaTime: number, count = 6): number {
    return waveHeight(this.waves, x, z, seaTime, count);
  }

  resize(camera: THREE.PerspectiveCamera | null = this.camera): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (camera) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  /** Fit what is drawn to the graphics level: everything on high, the cheaper version of each effect on low. */
  private applyQuality(): void {
    const low = graphics.level === 'low';
    this.wake.setDetail(graphics.level);
    this.spray.amount = low ? 0.4 : 1;
  }

  /**
   * Hold 60 frames a second: if frames run long for a while, render fewer pixels, and when that is not enough
   * drop the graphics to low (unless the player has asked for high). It only ever steps down.
   */
  private keepPace(dtReal: number): void {
    const p = this.pace;
    if (p.warmup > 0) { p.warmup -= dtReal; return; }
    if (document.hidden) return;
    p.time += dtReal;
    p.frames++;
    if (p.time < 2) return;
    const avg = p.time / p.frames;
    p.time = 0;
    p.frames = 0;
    p.slowWindows = avg > 1 / 50 ? p.slowWindows + 1 : 0;
    if (p.slowWindows >= 2 && this.pixelRatio > 1) {
      p.slowWindows = 0;
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    } else if (p.slowWindows >= 3 && graphics.fallBack()) p.slowWindows = 0;
  }

  /**
   * Move the world on to a moment and draw it.
   * @param t session time, seconds
   * @param seaTime time the waves are drawn at
   * @param windKt wind at the viewer, with gusts, for the ripples
   * @param covered true when something covers most of the 3D view, so it only needs drawing now and then
   */
  frame(dtReal: number, rate: number, t: number, seaTime: number, camera: THREE.PerspectiveCamera, boat: StageBoat, ships: TrafficVessel[], windKt: number, covered = false): void {
    if (camera !== this.camera) {
      this.camera = camera;
      this.resize(camera);
    }
    if (!covered) this.keepPace(dtReal);
    const world = this.world;
    // The sea follows the hourly wind: slowly, as a real sea does.
    const hourly = world.wind(boat.x, -boat.z, t);
    this.seaKt += (hourly.speed / KT - this.seaKt) * Math.min(1, dtReal * rate * 0.004);
    setSeaState(this.waves, this.seaKt);
    this.ocean.setWaves(this.waves, hourly.dir);
    this.field.update(world, t);

    this.traffic.update(t, seaTime, this.waves);
    for (const b of this.buoys) {
      const c = world.current(b.x, b.y, t);
      b.update(waveHeight(this.waves, b.x, -b.y, seaTime), Math.atan2(c.x, c.y), Math.hypot(c.x, c.y), seaTime);
    }

    this.sky.setTime(world.dateAt(t), this.course.origin.lat, this.course.origin.lon);
    this.focus.set(boat.x, 0, boat.z);
    this.sky.follow(this.focus);
    // Haze takes the colour of the low sky: pale by day, warm toward sunset, dark after.
    const el = this.sky.elevation;
    const up = THREE.MathUtils.clamp(Math.sin(el) * 3, 0, 1);
    this.haze.color.setRGB(0.5 + 0.22 * up, 0.42 + 0.37 * up, 0.38 + 0.46 * up).multiplyScalar(0.25 + 0.75 * THREE.MathUtils.clamp(Math.sin(el) * 6 + 0.3, 0, 1));
    // The lights of the shore come on as the sun goes down: first at two degrees up, all of them by four below.
    setCityNight(1 - THREE.MathUtils.smoothstep(el, -0.07, 0.035));
    this.ocean.setSun(this.sky.sunDir, this.sky.sunColor);
    this.ocean.update(seaTime, camera, boat);
    this.wakes(seaTime, camera, boat, ships, hourly.dir, hourly.speed, windKt, up);

    this.frameCount++;
    if (!covered || this.frameCount % 6 === 0) this.renderer.render(this.scene, camera);
  }
}
