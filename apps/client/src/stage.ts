import * as THREE from 'three';
import { KT } from '@slack-tide/sim';
import { SeaState, emptySea, type CourseData, type ReplayWorld, type Sea } from '@slack-tide/world';
import { Ocean } from './scene/ocean';
import { SkySystem } from './scene/sky';
import { Buoy, buildBridge, buildTerrain } from './scene/terrain';
import { Traffic, type TrafficVessel } from './scene/traffic';
import { buildScenery } from './scene/scenery';
import { clearCityNight, setCityNight } from './scene/massing';
import { WakeField } from './scene/wakes';
import { buildWaves, setSea, setSeaState, waveHeight, type Wave } from './scene/waves';
import type { LoadedCourse } from './world/loadCourse';

export interface StageBoat {
  /** Scene coordinates: X east, Z south. */
  x: number;
  z: number;
  heading: number;
  speed: number;
  heel: number;
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
  traffic!: Traffic;
  course!: CourseData;
  world!: ReplayWorld;
  readonly waves: Wave[] = [];
  /** The wakes of the water's ships and ferries. See `scene/wakes.ts`. */
  wakes!: WakeField;
  /** The sea state the water is drawn with: the one where the boat being followed is, eased so it never jumps. */
  readonly sea: Sea = emptySea();
  /** The land and what stands on it, for the course showing. */
  private land: THREE.Group | null = null;
  private readonly haze = new THREE.Fog(0xb9cbd6, 1200, 30000);
  private buoys: Buoy[] = [];
  private readonly focus = new THREE.Vector3();
  private seaKt = 0;
  private seaSet = false;
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
    this.ocean = new Ocean(this.sky.reflection.texture);
    this.scene.add(this.ocean.mesh);
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
    this.wakes = new WakeField(data.traffic);
    land.add(this.wakes.lines);
    // The water gets its sea state here: every sim sailed on this world feels it from now on.
    if (!world.seas) world.seas = new SeaState(world, data.about.sea ?? data.course.sea);
    this.seaSet = false;
    this.scene.add(land);
    this.land = land;

    // The sea runs with the wind of the hour. Its height follows the wind after that.
    const wind = world.wind(0, 0, 0);
    this.waves.splice(0, this.waves.length, ...buildWaves(wind.dir, wind.speed / KT));
    this.seaKt = wind.speed / KT;
  }

  /** Height of the sea at a scene position: the waves that are drawn, and any ship's wake going by. */
  seaLevel(x: number, z: number, seaTime: number, count = 6): number {
    return waveHeight(this.waves, x, z, seaTime, count) + this.wakes.height(x, -z);
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

  /** Hold 60 frames a second: if frames run long for a while, render fewer pixels. It only ever steps down. */
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
    }
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
    // The sea is the sea state where the boat is: wind, fetch, stream and depth (`SeaState`). It is eased over a few
    // seconds so that sailing into a lee lays the water down smoothly.
    const hourly = world.wind(boat.x, -boat.z, t);
    this.seaKt += (hourly.speed / KT - this.seaKt) * Math.min(1, dtReal * rate * 0.004);
    const here = world.seas?.at(boat.x, -boat.z, t);
    if (here) {
      const ease = this.seaSet ? Math.min(1, dtReal * rate * 0.15) : 1;
      const sea = this.sea;
      const height = sea.height + (here.height - sea.height) * ease;
      const steepness = sea.steepness + (here.steepness - sea.steepness) * ease;
      Object.assign(sea, here);
      sea.height = height;
      sea.steepness = steepness;
      this.seaSet = true;
      setSea(this.waves, height, steepness);
    } else setSeaState(this.waves, this.seaKt);
    this.ocean.setWaves(this.waves, hourly.dir, windKt);

    this.wakes.advance(world.seasonTime(t));
    this.wakes.draw(seaTime, this.waves);
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
    this.ocean.setShips(ships);
    this.ocean.update(seaTime, camera, boat);

    this.frameCount++;
    if (!covered || this.frameCount % 6 === 0) this.renderer.render(this.scene, camera);
  }
}
