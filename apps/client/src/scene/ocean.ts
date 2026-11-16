import * as THREE from 'three';
import { WAVE_COUNT, WAVE_GEOM_COUNT, type Wave } from './waves';
import { AIR_GLSL, GUSTINESS_GLSL, type SeaField } from './seaField';
import type { Wake } from './wake';

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
  uniform vec2 uWind;      // unit vector the wind blows toward, world x and z
  uniform sampler2D uDepth;
  uniform vec4 uDepthGrid; // x0, y0, cell size, metres for a full byte
  uniform vec2 uDepthSize;
  ${AIR_GLSL}
  varying vec3 vWorld;
  varying vec2 vBase;
  varying vec3 vAir;       // hourly wind here: toward east, toward north, and the gust speed, m/s
  varying float vLee;      // 1 close under a weather shore, where the wind has had no room to raise a sea

  float landAt(vec2 xz) {
    vec2 uv = ((vec2(xz.x, -xz.y) - uDepthGrid.xy) / uDepthGrid.z + 0.5) / uDepthSize;
    return 1.0 - smoothstep(0.0, 1.2, texture2D(uDepth, uv).r * uDepthGrid.w);
  }

  void main() {
    vec2 base = position.xz + uCenter.xz;
    vAir = airAt(vec2(base.x, -base.y));
    vLee = max(landAt(base - uWind * 140.0), max(landAt(base - uWind * 380.0) * 0.8, landAt(base - uWind * 800.0) * 0.5));
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
  uniform float uTime;
  uniform vec4 uWaveA[NW];
  uniform vec4 uWaveB[NW];
  uniform samplerCube uSky;
  uniform sampler2D uDetail;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunPower;
  uniform vec2 uWind;      // unit vector the wind blows toward, world x and z
  uniform float uSeason;   // seconds into the season: the clock the world's gusts run on
  uniform float uTide;
  uniform float uOvercast; // 0 a clear sky, 1 under a squall
  uniform float uLight;    // how strong the light from uSunDir is: 1 the sun, a few hundredths the moon
  uniform float uNight;    // 0 by day, 1 at full night: the sky the sea reflects goes dark with it
  uniform float uSee;      // how far you can see, metres
  uniform vec3 uFogColor;
  uniform float uFogMix;   // 0 the far water melts into the sky, 1 into fog
  uniform float uRain;     // how hard it is raining on the eye
  uniform float uCover;    // share of the sky under low cloud
  uniform vec3 uCloudShift; // from a point on the sea to the cloud that shades it (x, z), and how dark its shadow is
  uniform sampler2D uWakeNear;
  uniform sampler2D uWakeFar;
  uniform vec4 uWakeNearRect; // centre x, centre z, one over the width, metres a texel
  uniform vec4 uWakeFarRect;
  uniform sampler2D uDepth;
  uniform vec4 uDepthGrid;
  uniform vec2 uDepthSize;
  uniform vec3 uShoal;
  uniform vec3 uDeep;
  uniform vec3 uScatter;
  uniform vec4 uBoat;      // x, z, sin(heading), cos(heading)
  uniform float uBoatSpeed;
  uniform float uBoatHeel;
  varying vec3 vWorld;
  varying vec2 vBase;
  varying vec3 vAir;
  varying float vLee;
  ${GUSTINESS_GLSL}

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

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / dist;

    // Surface slope from every wave, including the ones too short for the mesh.
    vec2 slope = vec2(0.0);
    float pinch = 0.0;
    // Where the four longest waves pile up into a crest, now and a moment ago: -1 to 1.
    float piled = 0.0;
    float piledWas = 0.0;
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
      if (i < 4) {
        piled += sin(ph);
        piledWas += sin(ph + b.x * 1.6);
      }
    }
    piled *= 0.25;
    piledWas *= 0.25;

    // The wind on this piece of water: the hourly wind, and the gust or lull the world has here at this moment.
    // The same sum as ReplayWorld.gustyWind, so dark water is where the sim will find more wind.
    float airSpeed = length(vAir.xy);
    vec2 airDir = vAir.xy / max(airSpeed, 0.05);
    vec2 en = vec2(vBase.x, -vBase.y);
    float along = dot(en, airDir) - airSpeed * 0.7 * uSeason;
    float across = en.x * airDir.y - en.y * airDir.x;
    float puff = 0.085 * sin(along / 310.0 + across / 520.0) + 0.055 * sin(along / 127.0 - across / 210.0 + 1.7) + 0.03 * sin(uSeason / 9.3 + along / 60.0);
    // Too far off for a pixel to hold one puff: let them average out.
    float gustRel = puff * gustiness(airSpeed, vAir.z) * (1.0 - smoothstep(25.0, 160.0, footprint));
    float kt = airSpeed * (1.0 + gustRel) / 0.514444;
    float gust = smoothstep(0.025, 0.2, gustRel);
    float lull = smoothstep(0.025, 0.2, -gustRel);

    // What the vessels have left on the water: foam, the crests of their bow waves, and water stirred smooth.
    vec2 wn = (vBase - uWakeNearRect.xy) * uWakeNearRect.z + 0.5;
    vec2 wf = (vBase - uWakeFarRect.xy) * uWakeFarRect.z + 0.5;
    float inNear = 1.0 - smoothstep(0.44, 0.49, max(abs(wn.x - 0.5), abs(wn.y - 0.5)));
    float inFar = 1.0 - smoothstep(0.44, 0.49, max(abs(wf.x - 0.5), abs(wf.y - 0.5)));
    vec3 wk = texture2D(uWakeFar, wf).rgb * inFar;
    if (inNear > 0.0) {
      vec3 fine = texture2D(uWakeNear, wn).rgb;
      wk = mix(wk, fine, inNear);
      if (fine.g > 0.004) {
        // A bow wave is a real ridge of water: tilt the surface across it so it catches the light.
        float e = uWakeNearRect.w * uWakeNearRect.z;
        float gx = texture2D(uWakeNear, wn + vec2(e, 0.0)).g - texture2D(uWakeNear, wn - vec2(e, 0.0)).g;
        float gz = texture2D(uWakeNear, wn + vec2(0.0, e)).g - texture2D(uWakeNear, wn - vec2(0.0, e)).g;
        slope += vec2(gx, gz) * (0.5 / uWakeNearRect.w) * 0.55 * inNear;
      }
    }

    // Wind ripples from the detail texture, laid along the wind and drifting downwind.
    vec2 wUV = vec2(dot(vBase, uWind), dot(vBase, vec2(-uWind.y, uWind.x)));
    // Under five knots the water goes glassy. In the lee of the land it is smoother than the wind alone would have it.
    float breeze = clamp(kt / 14.0, 0.0, 2.4) * smoothstep(0.8, 6.5, kt);
    // Cat's-paws: finer patchiness inside the gusts, drifting downwind with them.
    float paws = texture2D(uDetail, wUV / 310.0 - vec2(uTime * 0.021, 0.0)).b;
    paws = mix(paws, texture2D(uDetail, wUV.yx / 870.0 + vec2(0.0, uTime * 0.004)).a, 0.35);
    vec4 d1 = texture2D(uDetail, wUV / 7.3 - vec2(uTime * 0.11, 0.0));
    vec4 d2 = texture2D(uDetail, wUV.yx / 2.3 + vec2(0.31, uTime * 0.19));
    vec4 d3 = texture2D(uDetail, wUV / 29.0 - vec2(uTime * 0.045, 0.17));
    vec2 rip = (d1.rg - 0.5) * 0.55 + vec2(d2.g - 0.5, d2.r - 0.5) * 0.4 + (d3.rg - 0.5) * 0.5;
    float ripAmt = breeze * mix(0.75, 1.1, smoothstep(0.34, 0.72, paws)) * (1.0 + 0.45 * gust - 0.3 * lull) * (1.0 - 0.45 * vLee) * (1.0 - 0.7 * wk.b) / (1.0 + dist * 0.0035);
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
    float blur = clamp(1.0 + log2(1.0 + dist * 0.02) + footprint * 0.6 + gust * 0.8, 1.0, 5.5);
    vec3 sky = textureCube(uSky, R, blur).rgb * (1.0 - 0.93 * uNight);

    // Light scattered back out of the water, strongest through the thin tops of waves.
    float crest = smoothstep(-0.25, 0.55, vWorld.y / (0.25 * breeze + 0.05));
    float sunUp = clamp(uSunDir.y * 2.5, 0.0, 1.0) * uLight;
    float through = pow(max(dot(V, -normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
    vec3 body = uDeep * (0.55 + 0.45 * sunUp) + uScatter * sunUp * (0.18 + 0.5 * crest + 0.9 * crest * through);
    // A gust roughens the water and it goes dark. A lull lets it lie smooth and bright.
    body *= mix(1.0, 0.66, gust) * (1.0 + 0.08 * lull);
    // Over a shoal the bottom shows through: paler and greener, most of all at the shore.
    vec2 dUV = ((en - uDepthGrid.xy) / uDepthGrid.z + 0.5) / uDepthSize;
    float deep = texture2D(uDepth, dUV).r * uDepthGrid.w + uTide;
    float shoal = (1.0 - smoothstep(0.4, 7.5, deep)) * step(0.0, dUV.x) * step(dUV.x, 1.0) * step(0.0, dUV.y) * step(dUV.y, 1.0);
    body = mix(body, uShoal * (0.3 + 0.7 * sunUp), shoal * 0.55);
    // Stirred water in a wake is full of air: paler too.
    body += uScatter * (0.1 + 0.5 * sunUp) * wk.b * 1.1;
    body *= 1.0 - 0.35 * uOvercast;

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
    // Cloud shadows: the same clouds the sky draws, thrown down-sun onto the water.
    if (uCloudShift.z > 0.01) {
      vec2 cp = vBase + uCloudShift.xy;
      float cn = texture2D(uDetail, cp / 9000.0).b * 0.62 + texture2D(uDetail, cp / 2300.0 + 0.37).a * 0.28 + 0.05;
      float cedge = 0.5 + (0.5 - uCover) * 0.42;
      shade = max(shade, smoothstep(cedge - 0.03, cedge + 0.09, cn) * uCloudShift.z);
    }
    body *= 1.0 - 0.62 * shade;

    vec3 col = mix(body, sky, fresnel * (1.0 - 0.3 * gust));

    // Sun glitter.
    float rl = max(dot(R, uSunDir), 0.0);
    col += uSunColor * uSunPower * (pow(rl, 1400.0) * 1.0 + pow(rl, 180.0) * 0.045) * (0.25 + 0.75 * fresnel) * sunUp * (1.0 - shade);

    // Whitecaps. None under about ten knots, a few at twelve, and in a hard blow the sea is streaked with them.
    float foamTex = texture2D(uDetail, vBase / 5.5 + vec2(0.0, uTime * 0.02)).a;
    float foamFine = texture2D(uDetail, vBase / 1.7).b;
    float noise = foamTex * 0.55 + foamFine * 0.45;
    float patch_ = texture2D(uDetail, vBase / 23.0 + vec2(uTime * 0.012, 0.0)).a;
    float cover = clamp((kt * (1.0 - 0.3 * vLee) - 9.5) / 22.0, 0.0, 1.0);
    float thr = mix(0.98, 0.2, pow(cover, 0.6));
    // A crest breaks where the long waves pile up and the short ones on their backs pinch to a point: thin white
    // lines along the crests, gathered where the sea is steepest. Behind each, a moment's lace of spent foam.
    float zone = smoothstep(thr - 0.34, thr + 0.06, piled);
    float sharp = mix(0.6, 0.2, pow(cover, 0.7));
    float breaking = smoothstep(sharp, sharp + 0.16, pinch) * zone * smoothstep(0.3, 0.55, noise) * step(0.001, cover);
    float spent = smoothstep(thr - 0.05, thr + 0.2, piledWas) * smoothstep(0.53, 0.66, foamTex * 0.5 + foamFine * 0.5) * smoothstep(0.42, 0.6, patch_) * 0.42 * step(0.001, cover);
    float caps = max(breaking, spent);
    // Far off, single crests are smaller than a pixel: show how white the sea is on average instead.
    caps = mix(caps, cover * cover * 0.3 * (0.6 + 0.8 * patch_), smoothstep(1.5, 9.0, footprint));
    // Streaks of old foam lined up with the wind, and above thirty knots the tops blown off as spindrift.
    float streak = texture2D(uDetail, vec2(wUV.x / 90.0, wUV.y / 6.0) - vec2(uTime * 0.01, 0.0)).a;
    float streaks = smoothstep(0.66, 0.92, streak) * smoothstep(0.42, 0.7, foamTex) * clamp((kt - 17.0) / 13.0, 0.0, 0.75) * (0.4 + 0.6 * foamFine);
    float foam = max(caps, streaks) + 0.07 * smoothstep(27.0, 38.0, kt);

    // The boat's own white water: along the hull, off the bow, and trailing astern.
    vec2 rel = vBase - uBoat.xy;
    if (dot(rel, rel) < 85.0 * 85.0) {
      vec2 local = vec2(rel.x * uBoat.w + rel.y * uBoat.z, -rel.x * uBoat.z + rel.y * uBoat.w);
      float way = clamp(uBoatSpeed / 3.2, 0.0, 1.3);
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
      float bowWave = smoothstep(0.9, 0.0, arm) * smoothstep(-0.6, 0.4, bowZ) * smoothstep(4.6, 1.0, bowZ) * way * way;
      foam = max(foam, clamp(alongside + bowWave * smoothstep(0.3, 0.6, noise), 0.0, 1.0));
    }
    // Wakes. Fresh foam is solid white; as it ages it breaks into lace and then into nothing.
    // From far enough off that the lace is finer than a pixel, a wake is a pale band.
    float lace = clamp((wk.r - (1.0 - noise) * 0.72) * 2.6, 0.0, 1.0);
    foam = max(foam, mix(lace, wk.r * 0.7, smoothstep(0.25, 1.6, footprint)));
    // Out where the fine map does not reach, a bow wave is only a paler line.
    col += sky * 0.07 * wk.g * (1.0 - inNear);
    if (uRain > 0.01) {
      // Rain on the water: close to, each drop's ring shows for an instant; further off it only beats the sea flat and grey.
      float beat = floor(uTime * 10.0);
      float cell = texture2D(uDetail, vBase / 0.8 + vec2(beat * 0.37, beat * 0.61)).a;
      foam += smoothstep(0.78 - 0.1 * uRain, 0.9, cell) * uRain * 0.6 * (1.0 - smoothstep(25.0, 130.0, dist));
      col = mix(col, uFogColor * 0.75, uRain * 0.3 * smoothstep(30.0, 500.0, dist));
    }
    vec3 foamCol = (uSunColor * (0.55 * sunUp + 0.08 * uLight + 0.012) * (1.0 - 0.5 * uOvercast) + sky * 0.35) * 0.8 * (1.0 - 0.45 * shade);
    col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.92);

    // Melt into the sky at the horizon.
    vec3 hv = normalize(vec3(-V.x, 0.035, -V.z));
    vec3 horizon = textureCube(uSky, hv, 2.5).rgb * (1.0 - 0.93 * uNight);
    float haze = 1.0 - exp(-pow(dist / (uSee * 0.1733), 1.35));
    col = mix(col, mix(horizon, uFogColor, uFogMix), clamp(haze, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;

  /**
   * @param wake the maps of what the vessels leave on the water
   * @param field the course's wind and depth, as textures
   */
  constructor(skyCube: THREE.Texture, wake: Wake, private readonly field: SeaField) {
    const vec4s = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());
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
      uSeason: { value: 0 },
      uTide: { value: 0 },
      uOvercast: { value: 0 },
      uLight: { value: 1 },
      uNight: { value: 0 },
      uSee: { value: 30000 },
      uFogColor: { value: new THREE.Color(0.8, 0.82, 0.85) },
      uFogMix: { value: 0 },
      uRain: { value: 0 },
      uCover: { value: 0 },
      uCloudShift: { value: new THREE.Vector3() },
      uWindU: { value: field.windU },
      uWindV: { value: field.windV },
      uWindGrid: { value: field.windGrid },
      uWindSize: { value: field.windSize },
      uDepth: { value: field.depth },
      uDepthGrid: { value: field.depthGrid },
      uDepthSize: { value: field.depthSize },
      uWakeNear: { value: wake.near.texture },
      uWakeFar: { value: wake.far.texture },
      uWakeNearRect: { value: wake.nearRect },
      uWakeFarRect: { value: wake.farRect },
      // Bay water: green-grey rather than tropical blue.
      uDeep: { value: new THREE.Color(0.012, 0.05, 0.062) },
      uScatter: { value: new THREE.Color(0.03, 0.15, 0.13) },
      uShoal: { value: new THREE.Color(0.075, 0.15, 0.115) },
      uBoat: { value: new THREE.Vector4() },
      uBoatSpeed: { value: 0 },
      uBoatHeel: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms });
    this.mesh = new THREE.Mesh(makeRadialGrid(), material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'ocean';
    this.mesh.renderOrder = -1;
  }

  /** @param windFrom where the wind at the viewer comes from: it sets which way the ripples lie */
  setWaves(waves: Wave[], windFrom: number): void {
    const a = this.uniforms.uWaveA.value as THREE.Vector4[];
    const b = this.uniforms.uWaveB.value as THREE.Vector4[];
    waves.forEach((w, i) => {
      a[i].set(w.dx, w.dz, w.k, w.amp);
      b[i].set(w.omega, w.q, w.phase, w.length);
    });
    const toward = windFrom + Math.PI;
    (this.uniforms.uWind.value as THREE.Vector2).set(Math.sin(toward), -Math.cos(toward));
  }

  /** The sea's noise, for the sky to cut its low cloud from so cloud and shadow agree. */
  get detail(): THREE.Texture {
    return this.uniforms.uDetail.value as THREE.Texture;
  }

  /**
   * @param power how strong the light is against full daylight: 1 the sun, a few hundredths the moon
   * @param overcast 0 under a clear sky, 1 under a squall: the water goes dull and dark with it
   */
  setSun(dir: THREE.Vector3, color: THREE.Color, power = 1, overcast = 0, night = 0): void {
    this.uniforms.uNight.value = night;
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(dir);
    (this.uniforms.uSunColor.value as THREE.Color).copy(color);
    this.uniforms.uLight.value = power;
    this.uniforms.uOvercast.value = overcast;
  }

  /**
   * The weather over the water.
   * @param see how far you can see, metres
   * @param fogMix 0 when the far water melts into the sky, 1 when into fog of `fogColor`
   * @param rain how hard it is raining on the eye, 0 to 1
   * @param cover share of the sky under low cloud
   * @param shiftX from a point on the sea to the cloud that shades it, metres east and south
   * @param shadow how dark a cloud's shadow is, 0 none
   */
  setWeather(see: number, fogMix: number, fogColor: THREE.Color, rain: number, cover: number, shiftX: number, shiftZ: number, shadow: number): void {
    const u = this.uniforms;
    u.uSee.value = see;
    u.uFogMix.value = fogMix;
    (u.uFogColor.value as THREE.Color).copy(fogColor);
    u.uRain.value = rain;
    u.uCover.value = cover;
    (u.uCloudShift.value as THREE.Vector3).set(shiftX, shiftZ, shadow);
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

    u.uSeason.value = this.field.season;
    u.uTide.value = this.field.tide;
  }
}
