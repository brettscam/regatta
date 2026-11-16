import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { moonAngles, sunAngles, sunDirection } from './sun';
import { NightSky } from './nightSky';
import { SF_FOG_PATH, pathLength, pathPoint } from './weatherRules';

// ---- high cloud: thin streaks painted on the dome, by direction from the eye ----------------------
const cirrusVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w; // always behind everything else
  }
`;

const cirrusFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uDay;
  uniform float uDrift;
  uniform sampler2D uDetail;  // the sea's own noise, so the clouds and their shadows on the water agree
  uniform float uCover;       // share of the sky under low cloud
  uniform vec2 uCloudDrift;   // how far the low cloud has blown, metres
  uniform float uCloudBase;   // its height, metres
  varying vec3 vWorld;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vWorld - cameraPosition);
    if (d.y < 0.012) discard;
    // Lay the sky out as a flat deck high overhead.
    vec2 p = d.xz / (d.y + 0.2);
    // Cirrus is combed out along the upper wind, here from the north-west.
    vec2 q = vec2(p.x * 0.7 + p.y * 0.7, (p.y * 0.7 - p.x * 0.7) * 3.4) * 0.6 + vec2(uDrift, 0.0);
    float streak = fbm(q);
    float fibre = fbm(q * vec2(2.2, 5.0) + streak * 2.0);
    // Only a few patches of it, with clear sky between and overhead.
    float patches = smoothstep(0.46, 0.7, fbm(p * 0.33 + vec2(3.7, 11.9) + uDrift * 0.3));
    float cover = smoothstep(0.42, 0.74, streak) * (0.35 + 0.65 * fibre) * patches;
    float alpha = cover * smoothstep(0.012, 0.11, d.y) * 0.8;
    float toSun = max(dot(d, uSunDir), 0.0);
    // Ice cloud scatters light forward, so it brightens toward the sun.
    vec3 col = uSunColor * (0.82 + 0.9 * pow(toSun, 8.0)) + vec3(0.5, 0.58, 0.7) * 0.2;
    // Low cloud: fair-weather cumulus on a flat deck, placed in the world so each one throws its shadow on the sea
    // where the sea's shader expects it.
    if (uCover > 0.01) {
      vec2 P = cameraPosition.xz + d.xz * (uCloudBase / max(d.y, 0.03)) - uCloudDrift;
      float n = texture2D(uDetail, P / 9000.0).b * 0.62 + texture2D(uDetail, P / 2300.0 + 0.37).a * 0.28 + texture2D(uDetail, P / 640.0).b * 0.1;
      float edge = 0.5 + (0.5 - uCover) * 0.42;
      float puff = smoothstep(edge, edge + 0.07, n) * smoothstep(0.025, 0.1, d.y);
      // Bright where the sun is on them, grey in their thick middles and bases.
      float thick = smoothstep(edge + 0.02, edge + 0.2, n);
      vec3 cloud = mix(uSunColor * 1.02 + vec3(0.04, 0.05, 0.07), vec3(0.5, 0.54, 0.6) * (0.55 + 0.45 * uSunColor), thick * 0.75);
      cloud *= 0.85 + 0.5 * pow(toSun, 6.0);
      col = mix(col, cloud, puff);
      alpha = alpha + (0.94 * puff) * (1.0 - alpha);
    }
    gl_FragColor = vec4(col * uDay, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---- the marine layer: a bank of fog built from wide, soft-edged mounds ---------------------------
const fogVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vView = -mv.xyz;
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

const fogFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uHaze;
  uniform float uHazeNear;
  uniform float uHazeFar;
  uniform float uTop;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vNormal);
    float dist = length(vView);
    float facing = abs(dot(n, vView / dist));
    // Solid in the middle, fading to nothing at the rim, so the mounds melt into one another and into the air.
    float alpha = smoothstep(0.02, 0.5, facing);
    alpha *= alpha;
    vec3 nw = normalize((vec4(n, 0.0) * viewMatrix).xyz);
    float sun = clamp(dot(nw, uSunDir) * 0.55 + 0.5, 0.0, 1.0);
    // The top of the bank catches the light. Lower down it is its own shadow.
    float height = smoothstep(0.0, uTop, vWorld.y);
    vec3 col = mix(uShade, uLit, sun * (0.35 + 0.65 * height));
    col = mix(col, uHaze, smoothstep(uHazeNear, uHazeFar, dist) * 0.4);
    gl_FragColor = vec4(col, alpha * 0.96);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Where the fog sits, in course metres east and north of the origin: [x, y, radius, top height]. */
function fogBank(): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  // Repeatable scatter.
  let seed = 90210;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // The main bank lies over the ocean, its edge a few miles outside the Golden Gate.
  for (let y = -17000; y <= 18000; y += 2300) {
    for (let x = -24000; x <= -9800; x += 2600) {
      const edge = THREE.MathUtils.smoothstep(x, -24000, -10500);
      out.push([x + (rnd() - 0.5) * 1500, y + (rnd() - 0.5) * 1500, 2700 + rnd() * 1300, 300 + rnd() * 170 - edge * 70]);
    }
  }
  // It pours over the saddles of the Marin headlands and sits on the ridge above Sausalito.
  for (const [x, y, r, top] of [
    [-9000, 1800, 2000, 470], [-7600, 500, 1500, 430], [-7200, 3000, 1700, 480], [-5700, 700, 1300, 430],
    [-5400, 2300, 1200, 440], [-6600, 3900, 1500, 480], [-8600, 5200, 2300, 520], [-6300, 5800, 1800, 500],
  ] as Array<[number, number, number, number]>) out.push([x, y, r, top]);
  // A tongue comes in through the strait and stops about a kilometre short of the bridge, so the towers stand clear against it.
  for (const [x, y, r, top] of [
    [-8900, -1500, 1700, 270], [-7500, -1700, 1500, 250], [-6200, -1450, 1300, 220], [-5100, -1250, 1000, 185], [-4350, -1200, 750, 150],
  ] as Array<[number, number, number, number]>) out.push([x, y, r, top]);
  // And it lies over the ocean side of the city, up to the foot of the hills.
  for (const [x, y, r, top] of [
    [-8300, -4600, 1900, 300], [-7000, -6400, 2000, 330], [-5200, -8200, 1900, 330], [-7600, -9000, 2400, 360],
    [-4300, -10600, 2200, 350], [-6000, -5000, 1100, 220],
  ] as Array<[number, number, number, number]>) out.push([x, y, r, top]);
  return out;
}

/**
 * Physical sky with the sun placed by date, time and position, a summer marine layer offshore and a little high cloud.
 * Also renders the sky into a cube map for water reflections and into a filtered map that lights the boat.
 */
export class SkySystem {
  readonly sky = new Sky();
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly sunColor = new THREE.Color(1, 1, 1);
  readonly sunLight = new THREE.DirectionalLight(0xffffff, 3);
  readonly fill = new THREE.HemisphereLight(0xbfd7ee, 0x1c3a44, 0.35);
  readonly reflection: THREE.WebGLCubeRenderTarget;
  elevation = 0;
  azimuth = 0;
  /** 0 by day, 1 when the sun is twelve degrees down. */
  night = 0;
  /**
   * How strong the light that `sunDir` and `sunColor` describe is, against full daylight: 1 for the sun, a few
   * hundredths for the moon, nothing in the dark of the moon. After sunset `sunDir` is the moon's direction.
   */
  lightPower = 1;
  /** Where the sun really is, below the horizon included. */
  readonly trueSun = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);
  readonly nightSky = new NightSky();
  private weather = { fog: 0, overcast: 0, cover: 0.2, reach: -1 };
  private readonly fogTongue: Array<{ at: number; meshes: THREE.Mesh[]; r: number; top: number }> = [];
  private baked = { night: -1, fog: -1, overcast: -1, cover: -1 };
  private turn = 0;
  private latDeg = 0;

  private readonly envScene = new THREE.Scene();
  private readonly envSky = new Sky();
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lastBaked = new THREE.Vector3();
  private readonly cirrus: THREE.Mesh;
  private readonly cirrusMaterial: THREE.ShaderMaterial;
  private readonly fogMaterial: THREE.ShaderMaterial;
  private readonly marineLayer: THREE.Group[] = [];
  private readonly lit = new THREE.Color();
  private readonly shade = new THREE.Color();

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene) {
    this.sky.scale.setScalar(18000);
    this.envSky.scale.setScalar(18000);
    this.envSky.material = this.sky.material;
    this.envScene.add(this.envSky);
    const u = this.sky.material.uniforms;
    // A little haze, as on the Bay on a summer afternoon.
    u.turbidity.value = 2.6;
    u.rayleigh.value = 2.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.84;

    this.reflection = new THREE.WebGLCubeRenderTarget(256, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.cubeCamera = new THREE.CubeCamera(1, 40000, this.reflection);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const s = this.sunLight.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.near = 1;
    s.camera.far = 120;
    s.camera.left = -14;
    s.camera.right = 14;
    s.camera.top = 20;
    s.camera.bottom = -8;
    s.bias = -0.0004;
    s.normalBias = 0.03;
    this.sunLight.castShadow = true;

    // High cloud, on a dome that travels with the eye. The same dome goes in the reflection scene.
    this.cirrusMaterial = new THREE.ShaderMaterial({
      vertexShader: cirrusVertex,
      fragmentShader: cirrusFragment,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uSunColor: { value: this.sunColor },
        uDay: { value: 1 },
        uDrift: { value: 0 },
        uDetail: { value: null },
        uCover: { value: 0 },
        uCloudDrift: { value: new THREE.Vector2() },
        uCloudBase: { value: 1400 },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    const dome = new THREE.SphereGeometry(1, 32, 16);
    this.cirrus = new THREE.Mesh(dome, this.cirrusMaterial);
    this.cirrus.scale.setScalar(17000);
    this.cirrus.frustumCulled = false;
    this.cirrus.renderOrder = -5;
    const envCirrus = new THREE.Mesh(dome, this.cirrusMaterial);
    envCirrus.scale.setScalar(17000);
    this.envScene.add(envCirrus);

    // The marine layer: fixed in the world, out past the Golden Gate.
    this.fogMaterial = new THREE.ShaderMaterial({
      vertexShader: fogVertex,
      fragmentShader: fogFragment,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uLit: { value: this.lit },
        uShade: { value: this.shade },
        uHaze: { value: new THREE.Color(0xb9cbd6) },
        uHazeNear: { value: 1200 },
        uHazeFar: { value: 30000 },
        uTop: { value: 420 },
      },
      // Both faces, so a boat that sails into the bank is in fog rather than watching it vanish.
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    const mound = new THREE.SphereGeometry(1, 20, 10);
    const bank = new THREE.Group();
    bank.name = 'marine_layer';
    const envBank = new THREE.Group();
    for (const [x, y, r, top] of fogBank()) {
      for (const parent of [bank, envBank]) {
        const m = new THREE.Mesh(mound, this.fogMaterial);
        // Wide and low, sitting on the sea: the centre is below the surface so only the cap shows.
        m.position.set(x, top * 0.25, -y);
        m.scale.set(r, top * 0.75, r);
        m.frustumCulled = false;
        parent.add(m);
      }
    }
    // The tongue that comes in through the Gate in the afternoon: mounds along its path, each of which swells up
    // as the front of the bank reaches it and sinks away when the bank burns back.
    let seed = 4711;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const length = pathLength(SF_FOG_PATH);
    for (let at = 0.27; at <= 1.0; at += 520 / length) {
      const c = pathPoint(SF_FOG_PATH, at);
      for (let k = 0; k < 2; k++) {
        const x = c.x + (rnd() - 0.5) * 1700;
        const y = c.y + (rnd() - 0.5) * 1500;
        const r = 850 + rnd() * 550;
        const top = 210 - 90 * at + rnd() * 50;
        const meshes: THREE.Mesh[] = [];
        for (const parent of [bank, envBank]) {
          const m = new THREE.Mesh(mound, this.fogMaterial);
          m.position.set(x, top * 0.25, -y);
          m.frustumCulled = false;
          m.visible = false;
          parent.add(m);
          meshes.push(m);
        }
        this.fogTongue.push({ at: at + (rnd() - 0.5) * 0.02, meshes, r, top });
      }
    }
    this.envScene.add(envBank, this.nightSky.envVeil);
    this.marineLayer.push(bank, envBank);

    scene.add(this.sky, this.cirrus, bank, this.sunLight, this.sunLight.target, this.fill, this.nightSky.group);
  }

  /** The fog bank offshore belongs to San Francisco Bay. Other waters do without it. */
  setMarineLayer(on: boolean): void {
    for (const g of this.marineLayer) g.visible = on;
  }

  /** The sea's noise texture, which the low cloud is cut from so that it matches its shadows on the water. */
  setCloudTexture(detail: THREE.Texture): void {
    this.cirrusMaterial.uniforms.uDetail.value = detail;
  }

  /**
   * The weather for this frame, from the rules in `weatherRules.ts`.
   * @param fog how thick the fog is round the eye, 0 to 1
   * @param overcast how far under a squall's cloud the eye is, 0 to 1
   * @param cover share of the sky under fair-weather cloud
   * @param reach how far the fog bank has come in along its path (San Francisco Bay only)
   * @param driftX how far the low cloud has blown, metres east and south
   */
  setWeather(fog: number, overcast: number, cover: number, reach: number, driftX: number, driftZ: number, fogColor: THREE.Color): void {
    const w = this.weather;
    w.fog = fog; w.overcast = overcast; w.cover = cover;
    const cu = this.cirrusMaterial.uniforms;
    cu.uCover.value = cover;
    (cu.uCloudDrift.value as THREE.Vector2).set(driftX, driftZ);
    const v = this.nightSky.veilUniforms;
    v.uFog.value = fog;
    v.uFogColor.value.copy(fogColor);
    v.uOvercast.value = overcast;
    if (Math.abs(reach - w.reach) > 0.0005) {
      w.reach = reach;
      for (const t of this.fogTongue) {
        const k = THREE.MathUtils.smoothstep(reach - t.at, -0.012, 0.05);
        for (const m of t.meshes) {
          m.visible = k > 0.02;
          m.scale.set(t.r * (0.5 + 0.5 * k), t.top * 0.75 * k + 0.001, t.r * (0.5 + 0.5 * k));
        }
      }
    }
  }

  /** Place the sun and moon for a moment in time. Re-bakes the reflection maps only when the light has changed enough to see. */
  setTime(date: Date, latDeg: number, lonDeg: number): void {
    const { azimuth, elevation } = sunAngles(date, latDeg, lonDeg);
    this.azimuth = azimuth;
    this.elevation = elevation;
    this.latDeg = latDeg;
    // The sky's own shader follows the sun a little way below the horizon, which gives the colours of dusk.
    // The veil in `nightSky.ts` then takes the light out of it.
    sunDirection(azimuth, Math.max(elevation, -0.14), this.trueSun);
    this.sky.material.uniforms.sunPosition.value.copy(this.trueSun);
    const night = 1 - THREE.MathUtils.smoothstep(elevation, -0.21, -0.015);
    this.night = night;
    this.nightSky.setNight(night, this.trueSun);
    const moon = moonAngles(date, latDeg, lonDeg);
    sunDirection(moon.azimuth, moon.elevation, this.moonDir);
    // The sky turns once a sidereal day. Near enough: the hour angle of the stars from the clock and the longitude.
    this.turn = ((date.getTime() / 86164090.5) % 1) * Math.PI * 2 + (lonDeg * Math.PI) / 180;

    // Warmer and dimmer as the sun gets low.
    const h = THREE.MathUtils.clamp(Math.sin(Math.max(elevation, 0)), 0, 1);
    const warm = 1 - THREE.MathUtils.smoothstep(h, 0.05, 0.55);
    const dull = 1 - 0.7 * this.weather.overcast;
    if (elevation > -0.05) {
      // The sun is the light, down to a few degrees below the horizon, where it has faded to nothing.
      const left = THREE.MathUtils.smoothstep(elevation, -0.05, 0.03);
      sunDirection(azimuth, Math.max(elevation, 0.035), this.sunDir);
      this.sunColor.setRGB(1, 1 - 0.32 * warm, 1 - 0.62 * warm);
      this.lightPower = left * dull;
      this.sunLight.intensity = (3.4 * THREE.MathUtils.smoothstep(h, 0.0, 0.25) + 0.05) * left * dull;
    } else {
      // After dark the moon is the light, when it is up: weak, cold, and enough to see a sea by.
      const up = THREE.MathUtils.smoothstep(moon.elevation, 0.0, 0.2) * (0.25 + 0.75 * moon.lit) * THREE.MathUtils.smoothstep(elevation, -0.05, -0.16);
      if (moon.elevation > 0.02) sunDirection(moon.azimuth, Math.max(moon.elevation, 0.06), this.sunDir);
      this.sunColor.setRGB(0.62, 0.74, 1);
      this.lightPower = 0.035 * up * dull;
      this.sunLight.intensity = 0.3 * up * dull;
    }
    this.sunLight.color.copy(this.sunColor);
    // Enough left at night to make out the boat by: the eye adapts, and there is always some light off the shore.
    this.fill.intensity = (0.2 + 0.25 * h) * (1 - 0.68 * night) * (1 - 0.3 * this.weather.overcast);

    // Clouds and fog take their light from the same sun: white by day, warm toward sunset, dim after.
    const day = (0.12 + 0.88 * THREE.MathUtils.smoothstep(Math.sin(elevation), -0.05, 0.22)) * (1 - 0.82 * night);
    this.cirrusMaterial.uniforms.uDay.value = day;
    // High cloud drifts a little over an afternoon.
    this.cirrusMaterial.uniforms.uDrift.value = ((date.getTime() / 1000) % 86400) * 0.00006;
    this.lit.copy(this.sunColor).multiplyScalar(0.98 * day);
    this.shade.setRGB(0.6, 0.65, 0.72).lerp(this.sunColor, 0.25).multiplyScalar(0.72 * day);
    // The bank fades into the same haze as the land.
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog?.isFog) {
      const fu = this.fogMaterial.uniforms;
      (fu.uHaze.value as THREE.Color).copy(fog.color);
      fu.uHazeNear.value = fog.near;
      fu.uHazeFar.value = fog.far;
    }

    // The light the boat is lit by comes from the baked sky, so bake again when the sky has changed: the sun has
    // moved, night has come on, or fog or a squall has closed in.
    const w = this.weather;
    const b = this.baked;
    if (this.lastBaked.distanceToSquared(this.trueSun) > 2e-5 || !this.envTarget || Math.abs(b.night - night) > 0.04 || Math.abs(b.fog - w.fog) > 0.08 || Math.abs(b.overcast - w.overcast) > 0.08 || Math.abs(b.cover - w.cover) > 0.06) {
      b.night = night; b.fog = w.fog; b.overcast = w.overcast; b.cover = w.cover;
      this.bake();
    }
  }

  /** Stars, moon and the veil: once a frame, when the camera is known. */
  drawNight(camera: THREE.Camera, pixelsHigh: number): void {
    const moonUp = THREE.MathUtils.smoothstep(this.moonDir.y, -0.02, 0.06) * (0.12 + 0.88 * this.night);
    const clear = (1 - this.weather.fog) * (1 - this.weather.overcast);
    this.nightSky.set(this.night, this.trueSun, this.moonDir, moonUp, clear, this.latDeg, this.turn, camera, pixelsHigh);
    // The squall's cloud takes what light the day has.
    const day = 1 - 0.93 * this.night;
    this.nightSky.veilUniforms.uCloud.value.setRGB(0.3, 0.33, 0.37).multiplyScalar(day);
  }

  /** Keep the shadow box centred on the boat. */
  follow(target: THREE.Vector3): void {
    this.sunLight.target.position.copy(target);
    this.sunLight.position.copy(target).addScaledVector(this.sunDir, 60);
    // The cloud dome is all direction and no place, so it rides along with the boat.
    this.cirrus.position.set(target.x, 0, target.z);
    // So is the sky itself: its colour depends only on the direction looked in. Left at the origin, a boat more than
    // 18 km out (the Farallones are 50) sails out of the dome and the sky goes black.
    this.sky.position.set(target.x, 0, target.z);
    this.nightSky.follow(target.x, target.z);
  }

  private bake(): void {
    this.lastBaked.copy(this.trueSun);
    this.cubeCamera.update(this.renderer, this.envScene);
    const next = this.pmrem.fromScene(this.envScene, 0, 1, 40000);
    this.scene.environment = next.texture;
    this.scene.environmentIntensity = 0.55;
    this.envTarget?.dispose();
    this.envTarget = next;
  }
}
