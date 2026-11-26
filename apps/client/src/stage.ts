import * as THREE from 'three';
import { KT } from '@slack-tide/sim';
import { SeaState, emptySea, type CourseData, type ReplayWorld, type Sea } from '@slack-tide/world';
import { Ocean } from './scene/ocean';
import { SkySystem } from './scene/sky';
import { Buoy, buildBridge, buildLand, drapeLand, drawnLandHeight, landHeight } from './scene/terrain';
import { Seamarks } from './scene/seamarks';
import { Traffic, type TrafficVessel } from './scene/traffic';
import { buildScenery } from './scene/scenery';
import { buildMooringFields, buildPalms, buildVirginIslands, shoalMap } from './scene/tropics';
import { buildShoreside, type ShoreSpot } from './scene/shoreside';
import { groundHeight, type HeightGrid } from './aboard/paddle';
import { clearCityNight, setCityNight } from './scene/massing';
import { WakeField } from './scene/wakes';
import { buildWaves, setSea, setSeaState, waveHeight, type Wave } from './scene/waves';
import { SeaField } from './scene/seaField';
import { Wake, type WakeVessel } from './scene/wake';
import { Spray } from './scene/spray';
import { rebase, type Origin } from './scene/origin';
import { recentre } from './scene/recentre';
import { graphics } from './scene/quality';
import { NavLights } from './scene/navLights';
import { Rain } from './scene/rain';
import { SF_FOG_PATH, cloudCover, fogAt, fogReach, morningHaze, pathPoint, rainAt, solarHour, squallsAt, visibility, type FogPath, type Squall } from './scene/weatherRules';
import type { LoadedCourse } from './world/loadCourse';
// Long Beach to Catalina: what is built in the sea, kelp, towns to walk in, and the two shores' own scenery.
import { buildStructures } from './scene/structures';
import { buildKelp, kelpCanopy } from './scene/kelp';
import { planTown, townLayouts } from './scene/town';
import { buildLongBeach, type Detail } from './scene/longBeach';
import { buildCatalina } from './scene/catalinaIsland';

/**
 * A view from somewhere other than the drone: the mask of a diver (`aboard/dive.ts`). Whoever owns it sets
 * `stage.eye` each frame it applies and clears it when done. With `wet` set the frame is drawn from under the water:
 * the sea's top, the spray, the rain and the navigation lights are left out, the haze is the water's own, and the
 * light is what is left of the sun at that depth. All of it is put back before the frame ends, so nothing has to be
 * restored on surfacing.
 */
export interface EyeView {
  camera: THREE.PerspectiveCamera;
  wet: boolean;
  /** The colour of the water at the eye, how far it can see through it in metres, and what is left of the sun's red, green and blue. */
  water: THREE.Color;
  see: number;
  light: THREE.Color;
}

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
  /** Under engine and in gear, or lying to an anchor or a mooring: for the lights she shows at night. */
  power?: boolean;
  held?: boolean;
  /**
   * A small open powerboat's lights: the height of the one white light she shows all round, and of her sidelights,
   * metres above the water. Given, she is lit as a launch whenever she is not held. See `NavLights.vessel`.
   */
  launch?: { allRound: number; side: number };
  /**
   * 0 to 1, how far a planing hull is up on the plane. Her stem is clear of the water then, so the spray that a
   * displacement bow throws at that speed is not thrown: what she does throw comes off her chines (`aboard/powerboat.ts`).
   */
  plane?: number;
  /** Half the distance between her two hulls, metres, for a wake from each. Left out, one hull. */
  hulls?: number;
}

/**
 * The ground the city is stood on. A plain course's land is one grid and is handed over as it is. Where the land has
 * insets (the ocean outside the Gate), the city gets one even grid over the Bay's shores, read from the finest land
 * there is at each point, so a building's footing is the ground that is drawn under it.
 */
function sceneryGround(course: CourseData, terrain: Uint8Array): [CourseData, Uint8Array] {
  const main = course.terrain;
  if (!main.insets?.length) return [course, terrain];
  const height = landHeight(course, terrain);
  const dx = 80;
  const x0 = Math.max(main.x0, -9000);
  const y0 = Math.max(main.y0, -12400);
  const nx = Math.floor((Math.min(main.x0 + (main.nx - 1) * main.dx, 14000) - x0) / dx) + 1;
  const ny = Math.floor((Math.min(main.y0 + (main.ny - 1) * main.dx, 13200) - y0) / dx) + 1;
  const cells = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cells[j * nx + i] = Math.round(Math.sqrt(Math.min(1, height(x0 + i * dx, y0 + j * dx) / main.max)) * 255);
  return [{ ...course, terrain: { ...main, x0, y0, dx, nx, ny, insets: undefined } }, cells];
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
  /** Small craft afloat this frame (the tenders, `aboard/kayak.ts`), drawn in the same wakes and spray as every vessel. Filled and emptied by their owners. */
  readonly craft: WakeVessel[] = [];
  private readonly afloat: WakeVessel[] = [];
  /** What white water looks like in this light: bright by day, warm at sunset, a grey ghost at night. Set each frame. */
  readonly white = new THREE.Color(1, 1, 1);
  private readonly tint = new THREE.Color();
  private readonly seaAt = (x: number, z: number, count: number) => waveHeight(this.waves, x, z, this.seaTime, count);
  private seaTime = 0;
  private lastSea = 0;
  /** Lights on everything afloat, and rain. */
  readonly navLights = new NavLights();
  readonly rain = new Rain();
  /** The weather that can be seen, worked out each frame from the season's clock. For the curious and for tests. */
  readonly weather = { fog: 0, haze: 0, rain: 0, cover: 0, reach: 0, see: 30000, squalls: [] as Squall[] };
  private fogPath: FogPath | null = null;
  private hazy = false;
  private readonly fogColor = new THREE.Color();
  traffic!: Traffic;
  course!: CourseData;
  world!: ReplayWorld;
  readonly waves: Wave[] = [];
  /** The wakes of the water's ships and ferries. See `scene/wakes.ts`. */
  wakes!: WakeField;
  /** The sea state the water is drawn with: the one where the boat being followed is, eased so it never jumps. */
  readonly sea: Sea = emptySea();
  /** The venue standing on the shore at each place there is to go ashore: where it is, and its deck, dock and named spots. */
  shore: ShoreSpot[] = [];
  /** Scenery that is only worth drawing from near by, each with where it is and how far off it is hidden. See `frame`. */
  private detail: Detail[] = [];
  /** What the water's own scenery came to, for the curious and for tests: counts of things, and triangles. */
  readonly built: Record<string, number> = {};
  /** The land and what stands on it, for the course showing. */
  private land: THREE.Group | null = null;
  private readonly haze = new THREE.Fog(0xb9cbd6, 1200, 30000);
  private buoys: Buoy[] = [];
  /** Lighthouses and lit marks, on a water that has them. */
  private seamarks: Seamarks | null = null;
  /** Where the charted lights are, course metres. */
  private litMarks: Array<[number, number]> = [];
  private readonly focus = new THREE.Vector3();
  private seaKt = 0;
  private seaSet = false;
  private pixelRatio = Math.min(window.devicePixelRatio, 2);
  private readonly pace = { time: 0, frames: 0, slowWindows: 0, warmup: 4 };
  private frameCount = 0;
  private camera: THREE.PerspectiveCamera | null = null;
  /** Set while the frame is to be drawn from somewhere other than the drone. See `EyeView`. */
  eye: EyeView | null = null;
  /**
   * The scene's floating origin, scene metres: a point near the eye, moved in whole steps of a few kilometres as she
   * goes (`scene/origin.ts`). Every object keeps its true position; only the drawing is done about this point, so the
   * graphics card's single precision is spent near the eye and nothing far out on a big water shakes.
   * See `draw`. Read it, never set it.
   */
  readonly origin: Origin = { x: 0, z: 0 };
  /** How many times the origin has moved, for the curious and for tests. */
  rebases = 0;
  private readonly keptColor = new THREE.Color();
  private readonly keptSun = new THREE.Color();
  private readonly keptFill = new THREE.Color();

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
    this.scene.add(this.ocean.mesh, this.spray.points, this.navLights.points, this.rain.group);
    this.sky.setCloudTexture(this.ocean.detail);
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
        (o.userData.picture as THREE.Texture | undefined)?.dispose();
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
    const terrain = buildLand(this.course, data.terrain, scenery.landCover);
    // A water with a picture of its land from above (Catalina: a satellite scene) wears it, lit like the rest of the
    // land. On low graphics it goes without the fine grain close to; until it has loaded the land wears its colours by rule.
    if (data.landImage) {
      new THREE.TextureLoader().load(data.landImage, (picture) => {
        if (this.land !== land) { picture.dispose(); return; }
        picture.colorSpace = THREE.SRGBColorSpace;
        picture.anisotropy = graphics.level === 'low' ? 1 : 8;
        drapeLand(terrain, picture, graphics.level !== 'low');
        terrain.userData.picture = picture;
      });
    }
    land.add(terrain);
    this.seamarks = data.features?.lights.length ? new Seamarks(data.features.lights, landHeight(this.course, data.terrain)) : null;
    if (this.seamarks) land.add(this.seamarks.group);
    this.litMarks = (data.features?.lights ?? []).map((l): [number, number] => [l.x, l.y]);
    if (pieces.has('golden-gate-bridge') && this.course.bridge) land.add(buildBridge(this.course.bridge));
    this.sky.setMarineLayer(pieces.has('marine-layer'));
    // The weather that belongs to this water: the Bay's fog bank, the islands' morning haze.
    this.fogPath = pieces.has('marine-layer') ? SF_FOG_PATH : null;
    this.hazy = pieces.has('morning-haze');
    // Something to steer for at every place there is to go ashore. They stand on the shore as it is drawn, so the
    // heights are read back off the land's own mesh, as the kayak reads them.
    // One land grid is one mesh, read back exactly; land with insets is read through the same lookup the seamarks use.
    const t = this.course.terrain;
    const heightAt = terrain instanceof THREE.Mesh
      ? ((drawn: HeightGrid) => (x: number, y: number) => groundHeight(drawn, x, y))({ x0: t.x0, y0: t.y0, dx: t.dx, nx: t.nx, ny: t.ny, data: terrain.geometry.getAttribute('position').array, stride: 3, offset: 1 })
      // Land with insets: the finest grid at each place, with the sea below zero as it is drawn, so a shoreline can be found on it.
      : drawnLandHeight(this.course, data.terrain);
    const shore = buildShoreside(this.course.depth, data.depth, heightAt, (x, y) => world.chartDepth(x, y), data.places, scenery.landCover);
    land.add(shore.group);
    this.shore = shore.spots;
    // The moored boats of the scenery keep out of the way in to each guest dock.
    const approaches: Array<[number, number, number]> = [];
    for (const spot of shore.spots) {
      const { dock, berth } = spot.layout;
      if (dock) approaches.push([dock.x, dock.y, 170]);
      if (berth) approaches.push([berth.x, berth.y, 170]);
    }
    for (const place of data.places) approaches.push([place.x, place.y, 150]);
    const plots = shore.spots.map((spot): [number, number, number] => [spot.x + Math.sin(spot.layout.heading) * 8, spot.y + Math.cos(spot.layout.heading) * 8, 44]);
    if (pieces.has('san-francisco')) land.add(buildScenery(...sceneryGround(this.course, data.terrain), data.depth, approaches, plots));
    if (pieces.has('palms')) land.add(buildPalms(this.course, data.terrain));
    if (pieces.has('mooring-fields')) land.add(buildMooringFields(this.course, data.terrain, data.depth, data.places, approaches));
    if (pieces.has('virgin-islands')) land.add(buildVirginIslands(this.course, data.terrain));
    // ---- added for Long Beach to Catalina; each part is drawn on any water whose data has it -----------------
    this.detail = [];
    for (const k of Object.keys(this.built)) delete this.built[k];
    const tally = (name: string, counts: Record<string, number>, triangles: number) => {
      this.built[`${name}Triangles`] = triangles;
      for (const [k, v] of Object.entries(counts)) this.built[k] = v;
    };
    const sceneGround = { height: heightAt, depth: (x: number, y: number) => world.chartDepth(x, y) };
    // What is built in the sea: breakwaters, platforms, oil islands (`features.json` structures). Solid through the chart's depth.
    if (data.features?.structures?.length) {
      const built = buildStructures(data.features.structures);
      land.add(built.group);
      tally('structures', { structures: built.placed.length }, built.triangles);
    }
    // Kelp at the surface, a mesh to each bed so a bed far off is not drawn.
    if (data.features?.kelp?.length) {
      const patches = kelpCanopy(data.features.kelp, sceneGround.depth);
      for (const bed of data.features.kelp) {
        const own = patches.filter((p) => p.bed === bed.id);
        if (!own.length) continue;
        const mesh = buildKelp(own);
        land.add(mesh);
        const mid = bed.line[Math.floor(bed.line.length / 2)];
        const span = Math.hypot(bed.line[0][0] - bed.line[bed.line.length - 1][0], bed.line[0][1] - bed.line[bed.line.length - 1][1]);
        this.detail.push({ object: mesh, x: mid[0], y: mid[1], far: 5000 + span });
      }
      tally('kelp', { kelpPatches: patches.length }, patches.length * 8);
    }
    // Towns to walk about in (`towns.json`). Each landing of a town is an entry of `shore` under its place's id, with
    // the whole town as its layout: see `TownLayout` in `scene/town.ts`. The ground itself is drawn with the town.
    const townGround = { ...sceneGround, sailable: () => true };
    const plans = (data.towns ?? []).map((t) => planTown(t, townGround));
    for (const plan of plans) {
      townLayouts(plan, townGround).forEach(({ place, layout }, n) => {
        const at = n === 0 || !layout.dock ? layout : layout.dock;
        this.shore.push({ id: place, kind: layout.kind, x: at.x, y: at.y, top: layout.floor + (n === 0 ? 16 : 9), layout });
      });
    }
    if (pieces.has('long-beach')) {
      const built = buildLongBeach(this.course, sceneGround, data.places.map((p): [number, number, number] => [p.x, p.y, 90]));
      land.add(built.group);
      this.detail.push(...built.detail);
      tally('longBeach', built.counts, built.triangles);
    }
    if (pieces.has('catalina-island')) {
      const built = buildCatalina(sceneGround, plans, data.places);
      land.add(built.group);
      this.detail.push(...built.detail);
      tally('catalina', built.counts, built.triangles);
    }
    // ---- end of the Long Beach to Catalina additions ----------------------------------------------------
    // The water itself. Clear tropical water is blue where it is deep and shows its bottom where it is not.
    if (scenery.water === 'clear') {
      const shoals = shoalMap(this.course, data.depth);
      this.ocean.setWater(new THREE.Color(0.006, 0.035, 0.085), new THREE.Color(0.02, 0.14, 0.2));
      this.ocean.setShoals(shoals.texture, shoals.x, shoals.z, shoals.width, shoals.depth);
    } else {
      this.ocean.setWater();
      this.ocean.setShoals(null);
    }
    this.buoys = this.course.marks.filter((m) => m.kind === 'buoy').map((m, i) => new Buoy(m.x, m.y, i % 2 ? 0x2f8f55 : 0xb5332a));
    for (const b of this.buoys) land.add(b.group);
    // Other vessels on the water. Where each one is depends only on the time, so everyone sees the same traffic.
    this.traffic = new Traffic(data.traffic, world);
    land.add(this.traffic.group);
    // What a ship's wake does to the water a boat sails through. It is drawn by `scene/wake.ts` with every other wake,
    // so its own crest lines are not added.
    this.wakes = new WakeField(data.traffic);
    // The water gets its sea state here: every sim sailed on this world feels it from now on.
    if (!world.seas) world.seas = new SeaState(world, data.about.sea ?? data.course.sea);
    this.seaSet = false;
    // Whatever was built from course positions straight into its vertices or instances is given a nearby origin of its
    // own, so the card does not subtract one large number from another at every vertex. Nothing moves.
    this.built.recentred = recentre(land);
    this.scene.add(land);
    this.land = land;

    // The sea runs with the wind of the hour. Its height follows the wind after that.
    const wind = world.wind(0, 0, 0);
    this.waves.splice(0, this.waves.length, ...buildWaves(wind.dir, wind.speed / KT));
    this.seaKt = wind.speed / KT;
  }

  /**
   * The weather that can be seen, at the eye, now. Every rule is a function of the season's clock, the place and the
   * recorded wind (`scene/weatherRules.ts`), so all players see the same.
   */
  private forecast(t: number, camera: THREE.Camera): typeof this.weather {
    const world = this.world;
    const w = this.weather;
    const hour = solarHour(world.dateAt(t).getTime(), this.course.origin.lon);
    const boost = world.windBoost;
    const ex = camera.position.x;
    const ey = -camera.position.z;
    w.fog = 0;
    w.reach = 0;
    if (this.fogPath) {
      // The recorded breeze in the Gate, whatever anyone has boosted it to: the fog is the same for all.
      const gate = pathPoint(this.fogPath, 0.38);
      w.reach = fogReach(hour, world.wind(gate.x, gate.y, t).speed / boost / KT);
      w.fog = fogAt(this.fogPath, w.reach, ex, ey);
    }
    w.haze = this.hazy ? morningHaze(hour) : 0;
    const b = this.course.bounds;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const mid = world.wind(cx, cy, t);
    const toward = mid.dir + Math.PI;
    squallsAt(world.seasonTime(t), boost, Math.sin(toward) * mid.speed, Math.cos(toward) * mid.speed, cx, cy, w.squalls);
    w.rain = rainAt(w.squalls, ex, ey);
    w.cover = cloudCover(hour, boost);
    w.see = Math.min(visibility(w.fog), 30000 - 21000 * w.haze, 30000 * Math.pow(2600 / 30000, w.rain));
    return w;
  }

  /** Navigation lights on everything afloat, and the buoys' flashes. Nothing is drawn until the sun is nearly down. */
  private lights(seaTime: number, camera: THREE.PerspectiveCamera, boat: StageBoat, ships: TrafficVessel[]): void {
    const lights = this.navLights;
    lights.begin(1 - THREE.MathUtils.smoothstep(this.sky.elevation, -0.1, 0.02), camera, this.renderer.domElement.height, this.weather.see);
    if (lights.lit) {
      const len = boat.length ?? 11.6;
      if (boat.launch) lights.vessel(boat.x, this.seaAt(boat.x, boat.z, 4), boat.z, boat.heading, len, boat.beam ?? 3.8, boat.launch.allRound, boat.held ? 'anchor' : 'launch', boat.launch.side);
      else lights.vessel(boat.x, this.seaAt(boat.x, boat.z, 4), boat.z, boat.heading, len, boat.beam ?? 3.8, len * 1.4, boat.held ? 'anchor' : boat.power ? 'power' : 'sail');
      for (const s of ships) {
        const y = this.seaAt(s.x, -s.y, 4);
        if (s.kind === 'sail') lights.vessel(s.x, y, -s.y, s.heading, s.length, s.beam, s.length * 1.4, s.sog < 0.25 ? 'anchor' : 'sail');
        else if (s.kind === 'ship') lights.vessel(s.x, y, -s.y, s.heading, s.length, s.beam, s.length * 0.12 + 14, 'ship');
        // A paddler carries only a white light, seen all round.
        else if (s.kind === 'paddle') lights.vessel(s.x, y, -s.y, s.heading, s.length, s.beam, 1.2, 'anchor');
        else lights.vessel(s.x, y, -s.y, s.heading, s.length, s.beam, s.length * 0.2 + 5, 'power');
      }
      // Buoys flash every four seconds, each a little out of step with the next.
      // A mark that is also a charted light is shown by `Seamarks` in its own rhythm, so it is not lit twice.
      this.buoys.forEach((b, i) => {
        if (!this.litMarks.some(([x, y]) => Math.hypot(x - b.x, y - b.y) < 120)) lights.buoy(b.x, 2.6, -b.y, i % 2 === 0, ((seaTime + i * 1.3) % 4) < 0.7 ? 1 : 0);
      });
    }
    lights.end();
  }

  /** Every vessel's wake into the sea's maps, and spray off the bows near enough to see. */
  private drawWakes(seaTime: number, camera: THREE.PerspectiveCamera, boat: StageBoat, ships: TrafficVessel[], windFrom: number, windSpeed: number, windKt: number, day: number): void {
    const list = this.afloat;
    // A catamaran leaves a wake from each hull, each about its own centreline.
    const hulls = boat.hulls && boat.hulls > 0 ? 2 : 1;
    const n = ships.length + hulls + this.craft.length;
    while (list.length < n) list.push({ id: '', x: 0, z: 0, heading: 0, speed: 0, length: 11.6, beam: 3.8, lee: 0 });
    list.length = n;
    for (let h = 0; h < hulls; h++) {
      const me = list[h];
      const off = hulls === 2 ? (h === 0 ? -1 : 1) * boat.hulls! : 0;
      me.id = h === 0 ? 'own' : 'own-stbd';
      me.x = boat.x + Math.cos(boat.heading) * off;
      me.z = boat.z + Math.sin(boat.heading) * off;
      me.heading = boat.heading; me.speed = boat.speed;
      me.length = boat.length ?? 11.6;
      me.beam = hulls === 2 ? Math.max(1.2, (boat.beam ?? 3.8) * 0.28) : boat.beam ?? 3.8;
      me.lee = hulls === 2 ? 0 : THREE.MathUtils.clamp(boat.heel / 0.3, -1, 1);
    }
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      const v = list[i + hulls + this.craft.length];
      v.id = s.id;
      v.x = s.x; v.z = -s.y; v.heading = s.heading; v.speed = s.sog; v.length = s.length; v.beam = s.beam;
      // A sailing boat heels away from the wind, and her leeward bow wave is the bigger one.
      v.lee = s.kind === 'sail' ? -Math.sign(Math.sin(windFrom - s.heading)) * 0.7 * Math.min(1, s.sog / 2) : 0;
    }
    // The tenders, as they are, straight after her own hull so a busy water never crowds them out of the wakes.
    for (let i = 0; i < this.craft.length; i++) Object.assign(list[hulls + i], this.craft[i]);
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
      const drives = v.id === 'own' ? 1 - 0.65 * (boat.plane ?? 0) : 1;
      this.spray.bow(v.id, seaTime, dt, v.x, v.z, v.heading, v.speed * drives, v.length, v.beam, Math.sign(v.lee), windKt, this.seaAt);
    }
    // White water takes the colour of the light: bright by day, warm at sunset, a grey ghost at night.
    this.white.copy(this.haze.color).multiplyScalar(0.3).add(this.tint.copy(this.sky.sunColor).multiplyScalar(0.62 * day + 0.05));
    this.spray.update(seaTime, camera, this.renderer.domElement.height, Math.sin(toward) * windSpeed, -Math.cos(toward) * windSpeed, this.white);
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

  /** Fit what is drawn to the graphics level: everything on high, the cheaper version of each effect on low. */
  private applyQuality(): void {
    const low = graphics.level === 'low';
    this.wake.setDetail(graphics.level);
    this.spray.amount = low ? 0.4 : 1;
    this.rain.detail = low ? 0.4 : 1;
    // The draped land's fine grain close to.
    const picture = this.land?.getObjectByName('land')?.userData.picture ?? this.land?.getObjectByName('terrain')?.userData.picture;
    if (this.land && picture) drapeLand(this.land, picture as THREE.Texture, !low);
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
    if (this.eye) camera = this.eye.camera;
    if (camera !== this.camera) {
      this.camera = camera;
      this.resize(camera);
    }
    if (!covered) this.keepPace(dtReal);
    if (rebase(this.origin, camera.position.x, camera.position.z)) this.rebases++;
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
    this.ocean.setWaves(this.waves, hourly.dir);
    // Whitecaps follow how steep and broken the sea is, as well as the wind on it.
    this.ocean.setSea(here ? this.sea.steepness : 0.045, here ? this.sea.breaking : 0);
    this.field.update(world, t);

    this.wakes.advance(world.seasonTime(t));
    this.traffic.update(t, seaTime, this.waves);
    for (const b of this.buoys) {
      const c = world.current(b.x, b.y, t);
      b.update(waveHeight(this.waves, b.x, -b.y, seaTime), Math.atan2(c.x, c.y), Math.hypot(c.x, c.y), seaTime);
    }

    this.seamarks?.update(world.seasonTime(t), camera);
    const sky = this.sky;
    const w = this.forecast(t, camera);
    sky.setTime(world.dateAt(t), this.course.origin.lat, this.course.origin.lon);
    this.focus.set(boat.x, 0, boat.z);
    sky.follow(this.focus);
    // Haze takes the colour of the low sky: pale by day, warm toward sunset, dark after. Fog and rain are their own grey.
    const el = sky.elevation;
    const up = THREE.MathUtils.clamp(Math.sin(el) * 3, 0, 1);
    const dayLight = (0.25 + 0.75 * THREE.MathUtils.clamp(Math.sin(el) * 6 + 0.3, 0, 1)) * (1 - 0.9 * sky.night);
    this.haze.color.setRGB(0.5 + 0.22 * up, 0.42 + 0.37 * up, 0.38 + 0.46 * up).multiplyScalar(dayLight);
    const thick = Math.max(w.fog, w.rain * 0.8);
    this.fogColor.setRGB(0.8, 0.82, 0.85).lerp(this.tint.setRGB(0.42, 0.46, 0.5), w.rain * 0.8).multiplyScalar((0.2 + 0.8 * up) * (1 - 0.9 * sky.night) * (1 - 0.25 * w.rain));
    this.haze.color.lerp(this.fogColor, Math.min(1, thick * 1.5));
    this.haze.far = w.see;
    this.haze.near = Math.min(1200, w.see * 0.08);
    // Low cloud blows over from the west. Its shadow falls down-sun of it.
    const season = world.seasonTime(t);
    const driftX = season * 7;
    const driftZ = season * -1.5;
    const veil = THREE.MathUtils.smoothstep(7000 - w.see, 0, 6500) * 0.96;
    const overcast = Math.min(1, w.rain * 1.7);
    // The sky's clouds are placed from the eye, which is drawn about the origin: they are given the drift less the origin.
    sky.setWeather(veil, overcast, w.cover * (1 - veil), w.reach, driftX - this.origin.x, driftZ - this.origin.z, this.fogColor);
    sky.drawNight(camera, this.renderer.domElement.height);
    // The eye opens up in the dark: enough to find the wheel and the winches by.
    this.renderer.toneMappingExposure = 0.46 * (1 + 0.9 * sky.night);
    const base = 1400;
    const lean = Math.min(5, 1 / Math.max(sky.sunDir.y, 0.05));
    const shadow = graphics.level === 'low' ? 0 : 0.72 * THREE.MathUtils.clamp(sky.lightPower * 1.5, 0, 1) * (1 - veil) * (1 - overcast);
    this.ocean.setWeather(w.see, veil, this.fogColor, w.rain, w.cover, sky.sunDir.x * lean * base - driftX, sky.sunDir.z * lean * base - driftZ, shadow);
    // The lights of the shore come on as the sun goes down: first at two degrees up, all of them by four below.
    setCityNight(1 - THREE.MathUtils.smoothstep(el, -0.07, 0.035));
    this.ocean.setSun(sky.sunDir, sky.sunColor, sky.lightPower, overcast, sky.night);
    this.drawWakes(seaTime, camera, boat, ships, hourly.dir, hourly.speed, windKt, up * (1 - 0.9 * sky.night));
    // After the wakes, whose maps it reads where they have just been placed.
    this.ocean.update(seaTime, camera, boat, this.origin);
    this.lights(seaTime, camera, boat, ships);
    const toward = hourly.dir + Math.PI;
    this.rain.update(seaTime, w.rain, w.squalls, Math.sin(toward) * hourly.speed, -Math.cos(toward) * hourly.speed, (0.15 + 0.85 * up) * (1 - 0.9 * sky.night));

    // Scenery that is only worth drawing from near by is hidden when the eye is far from it. It comes back inside its
    // distance and goes a little beyond it, so an eye that hovers about the line does not make it blink.
    for (let i = 0; i < this.detail.length; i++) {
      const d = this.detail[i];
      const dx = camera.position.x - d.x;
      const dz = camera.position.z + d.y;
      const r2 = dx * dx + dz * dz;
      const reach = d.object.visible ? d.far * 1.06 : d.far;
      d.object.visible = r2 < reach * reach;
    }
    this.frameCount++;
    if (covered && this.frameCount % 6 !== 0) return;
    if (this.eye?.wet) this.drawUnder(camera, this.eye);
    else this.draw(camera);
  }

  /**
   * Draw the scene about the floating origin. Every object's world matrix is worked out as usual, in double precision on
   * the CPU, and then, for the length of the draw only, moved by minus the origin, and the eye with it. So every matrix
   * the graphics card is handed (model, view, model-view, shadow) holds small numbers, and the shift itself costs
   * nothing in precision. Straight after, each is moved back, so picking, labels and anything else that reads a world
   * matrix between frames sees true scene positions as before. Moving a matrix is two additions: much cheaper than
   * working the scene's matrices out a second time.
   */
  private draw(camera: THREE.PerspectiveCamera): void {
    const { x, z } = this.origin;
    const { scene, renderer } = this;
    if (x === 0 && z === 0) {
      renderer.render(scene, camera);
      return;
    }
    // A camera that hangs in the scene is moved with it; one on its own is moved here.
    const loose = !camera.parent;
    scene.updateMatrixWorld();
    this.shiftWorld(-x, -z);
    if (loose) {
      camera.position.x -= x;
      camera.position.z -= z;
      camera.updateMatrixWorld();
    } else camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    scene.matrixWorldAutoUpdate = false;
    renderer.render(scene, camera);
    scene.matrixWorldAutoUpdate = true;
    this.shiftWorld(x, z);
    if (loose) {
      camera.position.x += x;
      camera.position.z += z;
      camera.updateMatrixWorld();
    } else camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  }

  private shiftX = 0;
  private shiftZ = 0;
  private readonly shiftOne = (o: THREE.Object3D): void => {
    const e = o.matrixWorld.elements;
    e[12] += this.shiftX;
    e[14] += this.shiftZ;
    // None today, but a skinned mesh bound where it stands keeps the inverse of that matrix too.
    const skin = o as THREE.SkinnedMesh;
    if (skin.isSkinnedMesh && skin.bindMode === 'attached') skin.bindMatrixInverse.copy(skin.matrixWorld).invert();
  };

  /** Move every world matrix in the scene by so much east and south. */
  private shiftWorld(dx: number, dz: number): void {
    this.shiftX = dx;
    this.shiftZ = dz;
    this.scene.traverse(this.shiftOne);
  }

  /** One frame seen from under the water. What is changed for it is put back straight after. */
  private drawUnder(camera: THREE.PerspectiveCamera, eye: EyeView): void {
    const { haze, scene, sky } = this;
    const near = haze.near;
    const far = haze.far;
    const background = scene.background;
    const hidden = [this.ocean.mesh, this.spray.points, this.navLights.points, this.rain.group, ...sky.backdrop].filter((o) => o.visible);
    this.keptColor.copy(haze.color);
    this.keptSun.copy(sky.sunLight.color);
    this.keptFill.copy(sky.fill.color);
    for (const o of hidden) o.visible = false;
    haze.color.copy(eye.water);
    haze.near = 0.2;
    haze.far = eye.see * 1.5;
    scene.background = eye.water;
    sky.sunLight.color.multiply(eye.light);
    sky.fill.color.copy(eye.water).multiplyScalar(4);
    this.draw(camera);
    for (const o of hidden) o.visible = true;
    haze.color.copy(this.keptColor);
    haze.near = near;
    haze.far = far;
    scene.background = background;
    sky.sunLight.color.copy(this.keptSun);
    sky.fill.color.copy(this.keptFill);
  }
}
