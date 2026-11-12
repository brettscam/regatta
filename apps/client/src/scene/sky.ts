import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { sunAngles, sunDirection } from './sun';

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

  private readonly envScene = new THREE.Scene();
  private readonly envSky = new Sky();
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lastBaked = new THREE.Vector3();
  private readonly cirrus: THREE.Mesh;
  private readonly cirrusMaterial: THREE.ShaderMaterial;
  private readonly fogMaterial: THREE.ShaderMaterial;
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
    this.envScene.add(envBank);

    scene.add(this.sky, this.cirrus, bank, this.sunLight, this.sunLight.target, this.fill);
  }

  /** Place the sun for a moment in time. Re-bakes the reflection maps only when the sun has moved enough to see. */
  setTime(date: Date, latDeg: number, lonDeg: number): void {
    const { azimuth, elevation } = sunAngles(date, latDeg, lonDeg);
    this.azimuth = azimuth;
    this.elevation = elevation;
    // Keep a sliver of light after sunset so the scene never goes fully black in this milestone.
    sunDirection(azimuth, Math.max(elevation, -0.03), this.sunDir);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    // Warmer and dimmer as the sun gets low.
    const h = THREE.MathUtils.clamp(Math.sin(Math.max(elevation, 0)), 0, 1);
    const warm = 1 - THREE.MathUtils.smoothstep(h, 0.05, 0.55);
    this.sunColor.setRGB(1, 1 - 0.32 * warm, 1 - 0.62 * warm);
    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = 3.4 * THREE.MathUtils.smoothstep(h, 0.0, 0.25) + 0.05;
    this.fill.intensity = 0.2 + 0.25 * h;

    // Clouds and fog take their light from the same sun: white by day, warm toward sunset, dim after.
    const day = 0.12 + 0.88 * THREE.MathUtils.smoothstep(Math.sin(elevation), -0.05, 0.22);
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

    if (this.lastBaked.distanceToSquared(this.sunDir) > 2e-5 || !this.envTarget) this.bake();
  }

  /** Keep the shadow box centred on the boat. */
  follow(target: THREE.Vector3): void {
    this.sunLight.target.position.copy(target);
    this.sunLight.position.copy(target).addScaledVector(this.sunDir, 60);
    // The cloud dome is all direction and no place, so it rides along with the boat.
    this.cirrus.position.set(target.x, 0, target.z);
  }

  private bake(): void {
    this.lastBaked.copy(this.sunDir);
    this.cubeCamera.update(this.renderer, this.envScene);
    const next = this.pmrem.fromScene(this.envScene, 0, 1, 40000);
    this.scene.environment = next.texture;
    this.scene.environmentIntensity = 0.55;
    this.envTarget?.dispose();
    this.envTarget = next;
  }
}
