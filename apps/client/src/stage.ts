import * as THREE from 'three';
import { KT } from '@slack-tide/sim';
import type { CourseData, ReplayWorld } from '@slack-tide/world';
import { Ocean } from './scene/ocean';
import { SkySystem } from './scene/sky';
import { Buoy, buildBridge, buildTerrain } from './scene/terrain';
import { Traffic, type TrafficVessel } from './scene/traffic';
import { buildScenery } from './scene/scenery';
import { buildWaves, setSeaState, waveHeight, type Wave } from './scene/waves';
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
 * the Bay's traffic. The join screen and the sailing session both draw through this.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sky: SkySystem;
  readonly ocean: Ocean;
  readonly traffic: Traffic;
  readonly course: CourseData;
  readonly waves: Wave[];
  private readonly haze = new THREE.Fog(0xb9cbd6, 1200, 30000);
  private readonly buoys: Buoy[];
  private readonly focus = new THREE.Vector3();
  private seaKt: number;
  private pixelRatio = Math.min(window.devicePixelRatio, 2);
  private readonly pace = { time: 0, frames: 0, slowWindows: 0, warmup: 4 };
  private frameCount = 0;
  private camera: THREE.PerspectiveCamera | null = null;

  constructor(readonly canvas: HTMLCanvasElement, data: LoadedCourse, readonly world: ReplayWorld) {
    this.course = data.course;
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
    this.scene.add(buildTerrain(this.course, data.terrain), buildBridge(this.course), buildScenery(this.course, data.terrain));
    this.buoys = this.course.marks.filter((m) => m.kind === 'buoy').map((m, i) => new Buoy(m.x, m.y, i % 2 ? 0x2f8f55 : 0xb5332a));
    for (const b of this.buoys) this.scene.add(b.group);
    // Other vessels on the Bay. Where each one is depends only on the time, so everyone sees the same traffic.
    this.traffic = new Traffic(this.course, world);
    this.scene.add(this.traffic.group);

    // The sea runs with the afternoon's wind. Its height follows the wind after that.
    const wind = world.wind(0, 0, 0);
    this.waves = buildWaves(wind.dir, wind.speed / KT);
    this.seaKt = wind.speed / KT;
    window.addEventListener('resize', () => this.resize());
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
    // The sea follows the hourly wind: slowly, as a real sea does.
    const hourly = world.wind(boat.x, -boat.z, t);
    this.seaKt += (hourly.speed / KT - this.seaKt) * Math.min(1, dtReal * rate * 0.004);
    setSeaState(this.waves, this.seaKt);
    this.ocean.setWaves(this.waves, hourly.dir, windKt);

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
    this.ocean.setSun(this.sky.sunDir, this.sky.sunColor);
    this.ocean.setShips(ships);
    this.ocean.update(seaTime, camera, boat);

    this.frameCount++;
    if (!covered || this.frameCount % 6 === 0) this.renderer.render(this.scene, camera);
  }
}
