import * as THREE from 'three';
import { WAVE_COUNT, WAVE_GEOM_COUNT, type Wave } from './waves';

const TRAIL_POINTS = 24;
/** Other vessels whose white water the sea can draw at once. */
const SHIP_SLOTS = 8;

/** Small seeded generator so the water detail is the same on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A tiling ripple texture built from summed sine waves that favour one direction.
 * Red and green hold the surface slope, blue the height, alpha a second pattern for breaking up foam.
 */
function makeDetailTexture(size = 256): THREE.DataTexture {
  const rnd = mulberry32(20240714);
  const comps: Array<{ kx: number; ky: number; a: number; p: number }> = [];
  for (let i = 0; i < 56; i++) {
    // Whole-number wave counts across the tile keep it seamless. Most energy travels along +u, the wind direction.
    const mag = 2 + Math.floor(rnd() * rnd() * 30);
    const ang = (rnd() - 0.5) * (rnd() < 0.75 ? 1.5 : 3.1);
    const kx = Math.round(mag * Math.cos(ang));
    const ky = Math.round(mag * Math.sin(ang));
    if (kx === 0 && ky === 0) continue;
    comps.push({ kx, ky, a: 1 / Math.pow(Math.hypot(kx, ky), 1.15), p: rnd() * Math.PI * 2 });
  }
  const foam: Array<{ kx: number; ky: number; a: number; p: number }> = [];
  for (let i = 0; i < 40; i++) {
    const kx = Math.round((rnd() - 0.5) * 34);
    const ky = Math.round((rnd() - 0.5) * 34);
    if (kx === 0 && ky === 0) continue;
    foam.push({ kx, ky, a: 1 / Math.pow(Math.hypot(kx, ky), 0.8), p: rnd() * Math.PI * 2 });
  }
  const h = new Float32Array(size * size);
  const sx = new Float32Array(size * size);
  const sy = new Float32Array(size * size);
  const f = new Float32Array(size * size);
  let hMax = 1e-6;
  let sMax = 1e-6;
  let fMax = 1e-6;
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let hh = 0;
      let dx = 0;
      let dy = 0;
      for (const c of comps) {
        const ph = tau * (c.kx * u + c.ky * v) + c.p;
        hh += c.a * Math.cos(ph);
        const s = -c.a * Math.sin(ph);
        dx += s * c.kx;
        dy += s * c.ky;
      }
      let ff = 0;
      for (const c of foam) ff += c.a * Math.cos(tau * (c.kx * u + c.ky * v) + c.p);
      const i = y * size + x;
      h[i] = hh;
      sx[i] = dx;
      sy[i] = dy;
      f[i] = ff;
      hMax = Math.max(hMax, Math.abs(hh));
      sMax = Math.max(sMax, Math.abs(dx), Math.abs(dy));
      fMax = Math.max(fMax, Math.abs(ff));
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(255 * (0.5 + 0.5 * (sx[i] / sMax)));
    data[i * 4 + 1] = Math.round(255 * (0.5 + 0.5 * (sy[i] / sMax)));
    data[i * 4 + 2] = Math.round(255 * (0.5 + 0.5 * (h[i] / hMax)));
    data[i * 4 + 3] = Math.round(255 * (0.5 + 0.5 * (f[i] / fMax)));
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Rings of vertices, tight near the centre and stretching to the horizon. Centred under the camera each frame. */
function makeRadialGrid(rings = 230, segments = 288, maxRadius = 16000): THREE.BufferGeometry {
  const pos = new Float32Array((rings * segments + 1) * 3);
  const a = 7.8;
  const norm = Math.exp(a) - 1;
  let p = 3; // vertex 0 is the centre
  for (let i = 1; i <= rings; i++) {
    const r = (maxRadius * (Math.exp((a * i) / rings) - 1)) / norm;
    for (let j = 0; j < segments; j++) {
      const th = (j / segments) * Math.PI * 2;
      pos[p++] = Math.cos(th) * r;
      pos[p++] = 0;
      pos[p++] = Math.sin(th) * r;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < segments; j++) idx.push(0, 1 + ((j + 1) % segments), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segments;
    const b0 = a0 + segments;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const vertexShader = /* glsl */ `
  #define NW ${WAVE_COUNT}
  #define NG ${WAVE_GEOM_COUNT}
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec4 uWaveA[NW]; // dir.x, dir.z, wavenumber, amplitude
  uniform vec4 uWaveB[NW]; // omega, steepness, phase, wavelength
  uniform vec4 uBoat;      // x, z, sin(heading), cos(heading)
  varying vec3 vWorld;
  varying vec2 vBase;

  void main() {
    vec2 base = position.xz + uCenter.xz;
    float r = length(position.xz);
    // Roughly how far apart the vertices are out here. A wave is only drawn where the mesh can carry it.
    float spacing = 0.1 + r * 0.035;

    // The hull presses the short chop flat alongside.
    vec2 rel = base - uBoat.xy;
    vec2 local = vec2(rel.x * uBoat.w + rel.y * uBoat.z, -rel.x * uBoat.z + rel.y * uBoat.w);
    float e = dot(local / vec2(3.0, 7.5), local / vec2(3.0, 7.5));
    float calm = mix(0.35, 1.0, smoothstep(0.4, 1.8, e));

    vec3 p = vec3(base.x, 0.0, base.y);
    for (int i = 0; i < NG; i++) {
      vec4 a = uWaveA[i];
      vec4 b = uWaveB[i];
      float fade = 1.0 - smoothstep(b.w * 0.16, b.w * 0.45, spacing);
      if (i >= 2) fade *= calm;
      float ph = a.z * dot(a.xy, base) - b.x * uTime + b.z;
      p.xz += a.xy * (b.y * a.w * cos(ph) * fade);
      p.y += a.w * sin(ph) * fade;
    }
    vWorld = p;
    vBase = base;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  #define NW ${WAVE_COUNT}
  #define NT ${TRAIL_POINTS}
  #define NS ${SHIP_SLOTS}
  uniform float uTime;
  uniform vec4 uWaveA[NW];
  uniform vec4 uWaveB[NW];
  uniform samplerCube uSky;
  uniform sampler2D uDetail;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunPower;
  uniform vec2 uWind;      // unit vector the wind blows toward, world x and z
  uniform float uWindKt;
  uniform vec3 uDeep;
  uniform vec3 uScatter;
  uniform vec4 uBoat;      // x, z, sin(heading), cos(heading)
  uniform float uBoatSpeed;
  uniform float uBoatHeel;
  uniform vec4 uTrail[NT]; // x, z, age 0..1, strength
  uniform vec4 uShipA[NS]; // x, z, sin(heading), cos(heading)
  uniform vec4 uShipB[NS]; // speed m/s, length, beam, 1 when the slot is in use
  varying vec3 vWorld;
  varying vec2 vBase;

  // Signed distance to a triangle: negative inside.
  float triDist(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 e0 = b - a, e1 = c - b, e2 = a - c;
    vec2 v0 = p - a, v1 = p - b, v2 = p - c;
    vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float sgn = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(q0, q0), sgn * (v0.x * e0.y - v0.y * e0.x)),
                     vec2(dot(q1, q1), sgn * (v1.x * e1.y - v1.y * e1.x))),
                     vec2(dot(q2, q2), sgn * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
  }

  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / dist;

    // Surface slope from every wave, including the ones too short for the mesh.
    vec2 slope = vec2(0.0);
    float pinch = 0.0;
    // How much water one pixel covers. A wave shorter than a couple of pixels is faded out rather than left to shimmer.
    float footprint = max(length(dFdx(vBase)), length(dFdy(vBase)));
    for (int i = 0; i < NW; i++) {
      vec4 a = uWaveA[i];
      vec4 b = uWaveB[i];
      float fade = 1.0 - smoothstep(0.18, 0.5, footprint / b.w);
      float ph = a.z * dot(a.xy, vBase) - b.x * uTime + b.z;
      float ka = a.z * a.w * fade;
      slope += a.xy * (ka * cos(ph));
      pinch += b.y * ka * sin(ph);
    }

    // Wind ripples from the detail texture, laid along the wind and drifting downwind.
    vec2 wUV = vec2(dot(vBase, uWind), dot(vBase, vec2(-uWind.y, uWind.x)));
    float breeze = clamp(uWindKt / 14.0, 0.15, 2.2);
    // Cat's-paws: darker, rougher patches that travel downwind and show where the wind is coming from.
    float paws = texture2D(uDetail, wUV / 310.0 - vec2(uTime * 0.021, 0.0)).b;
    paws = mix(paws, texture2D(uDetail, wUV.yx / 870.0 + vec2(0.0, uTime * 0.004)).a, 0.35);
    float gust = smoothstep(0.34, 0.72, paws);
    vec4 d1 = texture2D(uDetail, wUV / 7.3 - vec2(uTime * 0.11, 0.0));
    vec4 d2 = texture2D(uDetail, wUV.yx / 2.3 + vec2(0.31, uTime * 0.19));
    vec4 d3 = texture2D(uDetail, wUV / 29.0 - vec2(uTime * 0.045, 0.17));
    vec2 rip = (d1.rg - 0.5) * 0.55 + vec2(d2.g - 0.5, d2.r - 0.5) * 0.4 + (d3.rg - 0.5) * 0.5;
    float ripAmt = breeze * mix(0.3, 1.0, gust) / (1.0 + dist * 0.0035);
    slope += (uWind * rip.x + vec2(-uWind.y, uWind.x) * rip.y) * ripAmt;

    vec3 N = normalize(vec3(-slope.x, 1.0 - pinch, -slope.y));
    // Never let the surface face away from the eye, which would show as black speckle at grazing angles.
    float ndv = dot(N, V);
    if (ndv < 0.02) { N = normalize(N + V * (0.02 - ndv)); ndv = 0.02; }

    float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y) + 0.015;
    R = normalize(R);
    // Distant water averages many tiny facets, so it reflects a blurred sky.
    float blur = clamp(1.0 + log2(1.0 + dist * 0.02) + footprint * 0.6, 1.0, 5.5);
    vec3 sky = textureCube(uSky, R, blur).rgb;

    // Light scattered back out of the water, strongest through the thin tops of waves.
    float crest = smoothstep(-0.25, 0.55, vWorld.y / (0.25 * breeze + 0.05));
    float sunUp = clamp(uSunDir.y * 2.5, 0.0, 1.0);
    float through = pow(max(dot(V, -normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
    vec3 body = uDeep * (0.55 + 0.45 * sunUp) + uScatter * sunUp * (0.18 + 0.5 * crest + 0.9 * crest * through);
    body *= mix(1.0, 0.78, gust * 0.6);

    // The boat's shadow on the water: hull and sails thrown down-sun. It dims the light coming up out of the water
    // and the sun's glitter, but not the reflected sky, which is how a shadow on water really looks.
    float shade = 0.0;
    vec2 relB = vBase - uBoat.xy;
    if (uSunDir.y > 0.06 && dot(relB, relB) < 110.0 * 110.0) {
      vec2 lb = vec2(relB.x * uBoat.w + relB.y * uBoat.z, -relB.x * uBoat.z + relB.y * uBoat.w); // x starboard, y astern
      vec2 sunFlat = uSunDir.xz / uSunDir.y;
      // Where a point one metre up throws its shadow, in the boat's frame.
      vec2 thrown = -vec2(sunFlat.x * uBoat.w + sunFlat.y * uBoat.z, -sunFlat.x * uBoat.z + sunFlat.y * uBoat.w);
      float lean = sin(uBoatHeel);
      float up = cos(uBoatHeel);
      vec2 head = vec2(lean * 15.6, -1.2) + thrown * (15.6 * up);
      vec2 stem = vec2(lean * 1.4, -5.6) + thrown * (1.4 * up);
      vec2 clew = vec2(lean * 2.7, 3.4) + thrown * (2.7 * up);
      float soft = 0.5 + length(thrown) * 0.25;
      float sails = 1.0 - smoothstep(-soft, soft, triDist(lb, stem, clew, head));
      vec2 hq2 = (lb - thrown * 0.7) / vec2(1.9, 6.0);
      float hullShade = 1.0 - smoothstep(0.75, 1.25, dot(hq2, hq2));
      shade = max(sails * 0.75, hullShade * 0.9) * clamp(uSunDir.y * 6.0, 0.0, 1.0);
    }
    body *= 1.0 - 0.62 * shade;

    vec3 col = mix(body, sky, fresnel);

    // Sun glitter.
    float rl = max(dot(R, uSunDir), 0.0);
    col += uSunColor * uSunPower * (pow(rl, 1400.0) * 1.0 + pow(rl, 180.0) * 0.045) * (0.25 + 0.75 * fresnel) * sunUp * (1.0 - shade);

    // Whitecaps where the crests pinch, more of them as the wind rises.
    float foamTex = texture2D(uDetail, vBase / 5.5 + vec2(0.0, uTime * 0.02)).a;
    float foamFine = texture2D(uDetail, vBase / 1.7).b;
    float capStart = mix(0.9, 0.42, clamp((uWindKt - 7.0) / 20.0, 0.0, 1.0));
    float caps = smoothstep(capStart, capStart + 0.22, pinch) * smoothstep(0.35, 0.62, foamTex * 0.6 + foamFine * 0.4);
    // Thin streaks of old foam lined up with the wind.
    float streak = texture2D(uDetail, vec2(wUV.x / 90.0, wUV.y / 6.0) - vec2(uTime * 0.01, 0.0)).a;
    float streaks = smoothstep(0.7, 0.95, streak) * smoothstep(0.45, 0.7, foamTex) * clamp((uWindKt - 13.0) / 14.0, 0.0, 0.45) * foamFine;
    float foam = max(caps, streaks);

    // The boat's own white water: along the hull, off the bow, and trailing astern.
    vec2 rel = vBase - uBoat.xy;
    if (dot(rel, rel) < 85.0 * 85.0) {
      vec2 local = vec2(rel.x * uBoat.w + rel.y * uBoat.z, -rel.x * uBoat.z + rel.y * uBoat.w);
      float way = clamp(uBoatSpeed / 3.2, 0.0, 1.3);
      float noise = foamTex * 0.55 + foamFine * 0.45;
      // Heel pushes the leeward side down, so the foam is wider there.
      float lee = local.x * sign(uBoatHeel) * min(abs(uBoatHeel) * 0.5, 0.2);
      vec2 hq = vec2(local.x / (1.72 + lee), (local.y + 0.1) / 5.9);
      float he = dot(hq, hq);
      // A thin collar of foam at the waterline, heavier toward the stern where the flow breaks away.
      float aft = smoothstep(-5.0, 5.5, local.y);
      float alongside = smoothstep(1.5, 1.08, he) * smoothstep(0.38, 0.72, noise + way * 0.12 + aft * 0.12) * way * (0.35 + 0.65 * aft);
      // Bow wave: two short arms sweeping back from the stem.
      float bowZ = local.y + 5.2;
      float arm = abs(abs(local.x) - (0.25 + bowZ * 0.42));
      float bowWave = smoothstep(0.9, 0.0, arm) * smoothstep(-0.6, 0.4, bowZ) * smoothstep(7.5, 1.5, bowZ) * way * way;
      // Wake: a ribbon through where the stern has been.
      float wake = 0.0;
      for (int i = 0; i < NT - 1; i++) {
        vec4 a = uTrail[i];
        vec4 b = uTrail[i + 1];
        if (b.w <= 0.0) break;
        float age = a.z;
        float width = 0.8 + age * 5.5;
        float d = segDist(vBase, a.xy, b.xy);
        float m = smoothstep(width, width * 0.2, d) * (1.0 - age) * (1.0 - age) * a.w * 0.85;
        wake = max(wake, m);
      }
      wake *= smoothstep(0.3, 0.75, noise + wake * 0.25) * 0.8;
      foam = max(foam, clamp(alongside + bowWave * smoothstep(0.3, 0.6, noise) + wake, 0.0, 1.0));
    }
    // Other vessels: white water round the hull, a bow wave, and a wake spreading astern.
    // A fast ferry leaves a long bright one, a yacht a short faint one.
    {
      float shipFoam = 0.0;
      float sNoise = foamTex * 0.55 + foamFine * 0.45;
      for (int i = 0; i < NS; i++) {
        vec4 sb = uShipB[i];
        if (sb.w < 0.5) continue;
        vec4 sa = uShipA[i];
        vec2 sr = vBase - sa.xy;
        float reach = sb.y * 2.2 + sb.x * 34.0;
        if (dot(sr, sr) > (reach + sb.y) * (reach + sb.y)) continue;
        vec2 sl = vec2(sr.x * sa.w + sr.y * sa.z, -sr.x * sa.z + sr.y * sa.w); // x starboard, y astern
        float halfL = sb.y * 0.5;
        float halfB = sb.z * 0.5;
        float sway = clamp(sb.x / 4.0, 0.0, 1.6);
        vec2 q = vec2(sl.x / (halfB * 1.25 + 1.0), sl.y / (halfL * 1.07));
        float collar = smoothstep(1.45, 1.05, dot(q, q)) * smoothstep(0.35, 0.7, sNoise + sway * 0.1) * min(sway, 1.0);
        float bz = sl.y + halfL; // metres aft of the stem
        float armW = 0.6 + halfB * 0.35;
        float arm = abs(abs(sl.x) - (halfB * 0.2 + bz * 0.4));
        float bow = smoothstep(armW, 0.0, arm) * smoothstep(-armW, armW * 0.5, bz) * smoothstep(halfL * 1.2 + sb.x * 2.0, halfL * 0.2, bz) * min(sway * sway, 1.6);
        float d = sl.y - halfL * 0.8; // metres astern of the transom
        float fade = clamp(1.0 - d / reach, 0.0, 1.0);
        float astern = step(0.0, d) * min(sway, 1.3);
        float width = halfB * 0.75 + d * 0.11;
        float core = smoothstep(width, width * 0.25, abs(sl.x)) * fade * fade * astern;
        float kel = abs(abs(sl.x) - (halfB + d * 0.34));
        float arms = smoothstep(1.2 + d * 0.03, 0.0, kel) * fade * fade * fade * astern * 0.55;
        shipFoam = max(shipFoam, collar + bow * smoothstep(0.3, 0.6, sNoise) + (core + arms) * mix(0.5, 1.0, smoothstep(0.28, 0.72, sNoise + core * 0.3)));
      }
      foam = max(foam, clamp(shipFoam, 0.0, 1.0));
    }
    vec3 foamCol = (uSunColor * (0.55 * sunUp + 0.08) + sky * 0.35) * 0.8 * (1.0 - 0.45 * shade);
    col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.92);

    // Melt into the sky at the horizon.
    vec3 hv = normalize(vec3(-V.x, 0.035, -V.z));
    vec3 horizon = textureCube(uSky, hv, 2.5).rgb;
    float haze = 1.0 - exp(-pow(dist / 5200.0, 1.35));
    col = mix(col, horizon, clamp(haze, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface WakeSource {
  /** World position of the stern. */
  x: number;
  z: number;
  speed: number;
}

export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly trail: THREE.Vector4[] = [];
  private readonly trailBorn: number[] = [];
  private lastDrop = new THREE.Vector2(1e9, 1e9);

  constructor(skyCube: THREE.Texture) {
    const vec4s = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());
    this.trail = vec4s(TRAIL_POINTS);
    this.trailBorn = new Array(TRAIL_POINTS).fill(-1e9);
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uWaveA: { value: vec4s(WAVE_COUNT) },
      uWaveB: { value: vec4s(WAVE_COUNT) },
      uSky: { value: skyCube },
      uDetail: { value: makeDetailTexture() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunPower: { value: 55 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uWindKt: { value: 14 },
      // Bay water: green-grey rather than tropical blue.
      uDeep: { value: new THREE.Color(0.012, 0.05, 0.062) },
      uScatter: { value: new THREE.Color(0.03, 0.15, 0.13) },
      uBoat: { value: new THREE.Vector4() },
      uBoatSpeed: { value: 0 },
      uBoatHeel: { value: 0 },
      uTrail: { value: this.trail },
      uShipA: { value: vec4s(SHIP_SLOTS) },
      uShipB: { value: vec4s(SHIP_SLOTS) },
    };
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms });
    this.mesh = new THREE.Mesh(makeRadialGrid(), material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'ocean';
    this.mesh.renderOrder = -1;
  }

  setWaves(waves: Wave[], windFrom: number, twsKt: number): void {
    const a = this.uniforms.uWaveA.value as THREE.Vector4[];
    const b = this.uniforms.uWaveB.value as THREE.Vector4[];
    waves.forEach((w, i) => {
      a[i].set(w.dx, w.dz, w.k, w.amp);
      b[i].set(w.omega, w.q, w.phase, w.length);
    });
    const toward = windFrom + Math.PI;
    (this.uniforms.uWind.value as THREE.Vector2).set(Math.sin(toward), -Math.cos(toward));
    this.uniforms.uWindKt.value = twsKt;
  }

  /**
   * Tell the sea about the other vessels so it can draw their white water. Sim coordinates: x east, y north,
   * heading in compass radians, speed in m/s. Only the nearest few to the camera are drawn.
   */
  setShips(vessels: Array<{ x: number; y: number; heading: number; sog: number; length: number; beam: number }>): void {
    const a = this.uniforms.uShipA.value as THREE.Vector4[];
    const b = this.uniforms.uShipB.value as THREE.Vector4[];
    const c = this.uniforms.uCenter.value as THREE.Vector3;
    const nearest = vessels
      .map((v) => ({ v, d: (v.x - c.x) ** 2 + (-v.y - c.z) ** 2 }))
      .sort((p, q) => p.d - q.d)
      .slice(0, SHIP_SLOTS);
    for (let i = 0; i < SHIP_SLOTS; i++) {
      const n = nearest[i];
      if (!n) { b[i].w = 0; continue; }
      a[i].set(n.v.x, -n.v.y, Math.sin(n.v.heading), Math.cos(n.v.heading));
      b[i].set(n.v.sog, n.v.length, n.v.beam, 1);
    }
  }

  setSun(dir: THREE.Vector3, color: THREE.Color): void {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(dir);
    (this.uniforms.uSunColor.value as THREE.Color).copy(color);
  }

  /**
   * @param time sea time in seconds
   * @param camera the mesh is re-centred under it
   * @param boat world x, world z, heading (radians, compass), speed (m/s), heel (radians)
   */
  update(time: number, camera: THREE.Camera, boat: { x: number; z: number; heading: number; speed: number; heel: number }): void {
    const u = this.uniforms;
    u.uTime.value = time;
    (u.uCenter.value as THREE.Vector3).set(camera.position.x, 0, camera.position.z);
    (u.uBoat.value as THREE.Vector4).set(boat.x, boat.z, Math.sin(boat.heading), Math.cos(boat.heading));
    u.uBoatSpeed.value = boat.speed;
    u.uBoatHeel.value = boat.heel;

    // Drop a wake point at the stern every couple of metres. Newest first.
    const sx = boat.x - Math.sin(boat.heading) * 5.0;
    const sz = boat.z + Math.cos(boat.heading) * 5.0;
    if (Math.hypot(sx - this.lastDrop.x, sz - this.lastDrop.y) > 2.2) {
      this.lastDrop.set(sx, sz);
      for (let i = TRAIL_POINTS - 1; i > 0; i--) {
        this.trail[i].copy(this.trail[i - 1]);
        this.trailBorn[i] = this.trailBorn[i - 1];
      }
      this.trail[0].set(sx, sz, 0, Math.min(1, boat.speed / 2.6));
      this.trailBorn[0] = time;
    } else if (this.trail[0].w > 0) {
      // Keep the newest point pinned to the stern so the wake never detaches.
      this.trail[0].x = sx;
      this.trail[0].y = sz;
    }
    const life = 26;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const age = (time - this.trailBorn[i]) / life;
      this.trail[i].z = THREE.MathUtils.clamp(age, 0, 1);
      if (age >= 1 || age < 0) this.trail[i].w = 0;
    }
  }
}
