import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash01 } from './catch';
import { GROWTH_CELL, noise2, type Fish, type FishShape, type Ground, type Lobster } from './diveRules';

/**
 * What is seen under the water on a dive: the sea floor round the diver with its ledges, boulders and sand channels,
 * kelp or coral on it, the fish and lobster, the surface from below, shafts of light, drifting specks, bubbles, and
 * the gun in her hand. Everything is built once when she goes in, within `RADIUS` of that spot, as instanced meshes
 * moved by their shaders; the water's own haze hides the edge. Nothing is made per frame.
 * All of it shares one small shader, which takes the red out of things with depth and with distance, as water does.
 * The rules it draws from (where rock is, where kelp grows, where each fish is) are in `diveRules.ts`.
 * Scene coordinates: X east, Y up from the surface, Z south.
 */

/** How far from where she went in the bottom is built, metres. */
export const RADIUS = 46;

const PATTERNS: Record<string, number> = { plain: 0, sheephead: 1, yellowtail: 2, mottled: 3, stripes: 4, spotted: 5, sand: 6, parrot: 7 };
const MAX_LOBSTER = 12;

const COMMON = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSun;        // toward the sun
  uniform float uLight;     // how strong the daylight is, 0 to 1
  uniform vec3 uWater;      // the colour of the water at the eye
  uniform float uVis;       // how far she can see, metres
  uniform float uLamp;      // her dive light: 0 off, 1 on
  uniform vec3 uLook;       // the way she is looking
  uniform vec3 uSway;       // which way the surge runs (x, z), and how fast it comes and goes
  uniform float uCaustic;   // how much of the dancing light gets down: less on low graphics, none at night
  uniform float uTropic;    // 1 over coral, 0 on a cold coast: which crust grows on the rock
`;

const vertex = /* glsl */ `
  ${COMMON}
  attribute vec3 aColor;
  #ifdef INST
    attribute vec3 aTint;
  #endif
  #ifdef KELP
    attribute float aUp;    // metres of plant below this piece
    attribute float aFlex;  // 0 on the stipe, 1 at the tip of a blade
  #endif
  #ifdef FLOOR
    attribute float aRock;
    varying float vRock;
  #endif
  #ifdef FISH
    attribute vec2 aFish;   // how it is marked, and its own beat
    uniform vec2 uWig;      // how it swims: a beat of the tail from side to side, or of the wings up and down
    varying float vMark;
  #endif
  #if defined(FISH) || defined(CORAL)
    varying vec3 vBody;
  #endif
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  void main() {
    vec3 p = position;
    #ifdef FISH
      float beat = uTime * 7.0 + aFish.y * 6.283;
      float aft = clamp(0.25 - p.z, 0.0, 1.0);
      p.x += sin(beat + p.z * 5.0) * uWig.x * aft * aft;
      p.y += sin(beat * 0.45 - abs(p.x) * 4.0) * uWig.y * abs(p.x);
      vMark = aFish.x;
    #endif
    #if defined(FISH) || defined(CORAL)
      vBody = position;
    #endif
    #ifdef INST
      vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
      vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      vColor = aColor * aTint;
      vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #else
      vec4 w = modelMatrix * vec4(p, 1.0);
      vNormal = normalize(mat3(modelMatrix) * normal);
      vColor = aColor;
      vec3 root = w.xyz;
    #endif
    #ifdef KELP
      // The whole plant leans with the surge and comes back, the top of it swinging furthest, and every blade
      // streams the way the water is going.
      float up = aUp + position.y;
      float swing = sin(uTime * uSway.z + dot(root.xz, vec2(0.21, 0.13)) - up * 0.2);
      float lean = swing * 0.6 + 0.3;
      w.xz += uSway.xy * lean * 0.085 * pow(up, 1.15);
      w.xz += uSway.xy * (0.35 + 0.3 * swing) * aFlex * 0.45;
      w.y -= aFlex * (0.12 + 0.08 * swing);
      w.xz += vec2(sin(uTime * 0.9 + root.x + up), cos(uTime * 0.7 + root.z + up * 1.3)) * (0.03 * min(up, 4.0) + 0.05 * aFlex);
    #endif
    #ifdef SWAY
      float swing = sin(uTime * uSway.z + dot(root.xz, vec2(0.37, 0.23)));
      w.xz += uSway.xy * (swing * 0.14 + 0.05) * position.y * position.y;
    #endif
    #ifdef FLOOR
      vRock = aRock;
    #endif
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const LIGHTING = /* glsl */ `
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float caustic(vec2 p, float t) {
    vec2 q = p * 0.9 + vec2(sin(p.y * 1.3 + t * 0.8), cos(p.x * 1.1 - t * 0.6)) * 0.6;
    float a = sin(q.x * 2.1 + t) * sin(q.y * 2.3 - t * 1.2);
    q = p * 1.7 + vec2(cos(p.y * 0.9 - t * 0.5), sin(p.x * 1.2 + t * 0.7));
    a += sin(q.x * 1.9 - t * 1.1) * sin(q.y * 2.2 + t * 0.9);
    return pow(clamp(1.0 - abs(a) * 0.9, 0.0, 1.0), 6.0);
  }
  // What grows on rock: pink and purple coralline crust, patches of orange and strawberry anemone, a green turf in
  // the shallows. Over coral: yellow and lavender sponge and a brown turf.
  vec3 crust(vec3 albedo, vec3 world, float rock) {
    float a = vnoise(world * 1.1);
    float b = vnoise(world * 2.7 + 11.0);
    float c = vnoise(world * 6.0 + 23.0);
    vec3 pink = mix(vec3(0.5, 0.24, 0.34), vec3(0.62, 0.5, 0.26), uTropic);
    vec3 bright = mix(vec3(0.95, 0.42, 0.12), vec3(0.85, 0.72, 0.18), uTropic);
    vec3 berry = mix(vec3(0.8, 0.16, 0.3), vec3(0.55, 0.4, 0.75), uTropic);
    vec3 turf = mix(vec3(0.16, 0.3, 0.1), vec3(0.3, 0.26, 0.14), uTropic);
    vec3 col = mix(albedo, pink, smoothstep(0.5, 0.62, a) * 0.8);
    col = mix(col, turf, smoothstep(0.55, 0.7, b) * smoothstep(-9.0, -3.0, world.y) * 0.85);
    col = mix(col, bright, smoothstep(0.7, 0.74, b * 0.6 + c * 0.4));
    col = mix(col, berry, smoothstep(0.72, 0.76, a * 0.5 + c * 0.5) * step(0.5, b));
    return mix(albedo, col * (0.8 + 0.4 * c), rock);
  }
  // What water does to light: red goes in the first few metres, green lasts, blue lasts longest.
  const vec3 ABSORB = vec3(0.17, 0.04, 0.028);
  vec3 underLight(vec3 albedo, vec3 n, vec3 world, float glow, float keep) {
    float depth = max(0.0, -world.y);
    float dist = length(world - cameraPosition);
    vec3 sun = mix(exp(-depth * ABSORB), vec3(0.8), keep) * uLight;
    float nl = 0.5 + 0.5 * max(dot(n, uSun), 0.0);
    // The dancing light of the surface reaches the shallows and is gone by about ten metres.
    float ca = caustic(world.xz, uTime) * (1.0 - smoothstep(1.0, 11.0, depth)) * uCaustic * max(n.y, 0.0);
    vec3 lit = albedo * sun * (nl + ca * 1.6 + glow);
    // The dive light is white and close: it gives the colours back, for a few metres.
    vec3 ray = normalize(world - cameraPosition);
    float cone = smoothstep(0.8, 0.96, dot(ray, uLook));
    lit += albedo * uLamp * cone * 2.6 / (1.0 + dist * dist * 0.06);
    lit *= exp(-dist * ABSORB * 0.6 * (1.0 - keep));
    float haze = 1.0 - exp(-pow(dist / uVis * 1.9, 1.5));
    return mix(lit, uWater, clamp(haze, 0.0, 1.0));
  }
`;

const fragment = /* glsl */ `
  ${COMMON}
  ${LIGHTING}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  #ifdef FLOOR
    varying float vRock;
  #endif
  #ifdef FISH
    uniform vec4 uForm;     // half the body's depth, then where the eye is along it and up it, and how big
    varying float vMark;
  #endif
  #if defined(FISH) || defined(CORAL)
    varying vec3 vBody;
  #endif
  void main() {
    #ifdef FADE
      // Nothing soft is drawn right against the mask: a blade that close thins out and is gone.
      float near = length(vWorld - cameraPosition);
      if (near < 1.5) {
        float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (smoothstep(0.5, 1.5, near) <= dither) discard;
      }
    #endif
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 c = vColor;
    float glow = 0.0;
    float keep = 0.0;
    #ifdef FLOOR
      // Sand lies in ripples across the surge; rock wears its crust.
      vec2 across = normalize(uSway.xy + vec2(0.001, 0.0));
      float ripple = sin(dot(vWorld.xz, across) * 7.0 + 1.5 * vnoise(vWorld * 0.7));
      c *= 1.0 + 0.09 * ripple * (1.0 - vRock);
      c = crust(c, vWorld, smoothstep(0.35, 0.7, vRock));
    #endif
    #ifdef ROCK
      c = crust(c, vWorld, step(0.06, c.r + c.g + c.b));
    #endif
    #ifdef CORAL
      // Brain coral is a maze of grooves; star coral is a field of little cups.
      float kind = fract(vColor.r * 7.31);
      float maze = sin(vBody.x * 26.0 + 3.0 * sin(vBody.z * 9.0 + vBody.y * 7.0)) * sin(vBody.y * 24.0 + 3.0 * sin(vBody.x * 8.0));
      float cups = length(fract(vBody.xz * 7.0 + vBody.y * 3.0) - 0.5);
      c *= kind < 0.5 ? 0.72 + 0.4 * smoothstep(-0.3, 0.3, maze) : 0.7 + 0.5 * smoothstep(0.15, 0.4, cups);
    #endif
    #ifdef FISH
      float z = vBody.z;
      float y = vBody.y / uForm.x * 0.5;
      int mark = int(vMark + 0.5);
      // Most fish are dark on the back and pale underneath.
      c *= 0.8 + 0.5 * smoothstep(0.15, -0.3, y);
      if (mark == 1) {
        // Sheephead: black head and tail, red between, white chin.
        if (z > 0.17 || z < -0.2) c = vec3(0.05, 0.05, 0.06);
        if (z > 0.3 && y < -0.08) c = vec3(0.85);
      } else if (mark == 2) {
        // Yellowtail: a yellow stripe along the side and a yellow tail, blue-grey above and silver below.
        c = mix(vec3(0.82, 0.84, 0.86), c * 0.8, smoothstep(-0.02, 0.1, y));
        if (abs(y) < 0.05 || z < -0.36) c = vec3(0.9, 0.74, 0.12);
      } else if (mark == 3) {
        // Calico: pale blotches in rows along a brown back.
        c *= 0.65 + 0.7 * smoothstep(0.1, 0.4, sin(z * 26.0) * sin(y * 15.0 + z * 6.0));
      } else if (mark == 4) {
        c *= 0.3 + 0.7 * step(0.45, fract(z * 6.5 + 0.2));
      } else if (mark == 5) {
        c *= 0.5 + 0.5 * step(0.28, length(fract(vec2(z * 11.0, y * 6.0)) - 0.5));
      } else if (mark == 6) {
        c *= 0.82 + 0.36 * step(0.0, sin(z * 53.0 + vBody.x * 41.0) * sin(vBody.x * 47.0));
      } else if (mark == 7) {
        // Parrotfish: green and blue above, a red belly, a yellow spot at the tail.
        c = mix(vec3(0.75, 0.2, 0.25), c, smoothstep(-0.2, -0.04, y));
        if (z < -0.3 && z > -0.36) c = vec3(0.9, 0.8, 0.2);
      }
      // An eye, which is most of what makes a fish a fish.
      float eye = length(vec2(z - uForm.y, vBody.y - uForm.z));
      if (eye < uForm.w) c = eye < uForm.w * 0.55 ? vec3(0.02) : vec3(0.85, 0.8, 0.6);
      // Scales catch the light, and a fish close to keeps more of its colour than the water would leave it.
      glow += 0.3;
      keep = 0.55;
    #endif
    #ifdef KELP
      // Kelp is amber glass with the sun behind it.
      vec3 ray = normalize(vWorld - cameraPosition);
      glow = 1.3 * pow(max(dot(ray, uSun), 0.0), 2.0) + 0.25 * max(ray.y, 0.0);
      keep = 0.25;
    #endif
    #ifdef HAND
      keep = 0.5;
      glow = 0.2;
    #endif
    gl_FragColor = vec4(underLight(c, n, vWorld, glow, keep), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const surfaceFragment = /* glsl */ `
  ${COMMON}
  uniform vec3 uSky;
  uniform vec4 uHull[2];     // x, z from the eye (agent/origin: so it holds wherever the scene's origin is), sin and cos of the heading
  uniform vec2 uHullSize[2]; // half length, half beam
  varying vec3 vWorld;
  float swell(vec2 p, float t) {
    return sin(p.x * 0.9 + t * 0.9) + sin(p.y * 1.3 - t * 0.7 + p.x * 0.5) + 0.5 * sin(p.x * 2.7 - t * 1.6 + p.y * 1.9) + 0.5 * sin(p.y * 3.1 + t * 1.4 - p.x * 1.2);
  }
  void main() {
    vec3 V = normalize(vWorld - cameraPosition);
    vec2 p = vWorld.xz;
    float dist = length(vWorld - cameraPosition);
    // The slope of the moving surface, taken from a height that is smooth at every distance, so it never breaks into dots.
    float soft = 1.0 / (1.0 + dist * 0.06);
    vec2 slope = vec2(swell(p + vec2(0.15, 0.0), uTime) - swell(p - vec2(0.15, 0.0), uTime), swell(p + vec2(0.0, 0.15), uTime) - swell(p - vec2(0.0, 0.15), uTime)) * soft;
    // Snell's window: the whole sky squeezed into a circle overhead. Outside it the surface is a mirror of the deep.
    float c = V.y + dot(slope, V.xz) * 0.22 + (slope.x + slope.y) * 0.02;
    float window = smoothstep(0.63, 0.7, c);
    vec3 sunUnder = normalize(vec3(uSun.x * 0.75, sqrt(max(0.0, 1.0 - 0.5625 * (1.0 - uSun.y * uSun.y))), uSun.z * 0.75));
    vec3 bent = normalize(V + vec3(slope.x, 0.0, slope.y) * 0.12);
    float glare = pow(max(dot(bent, sunUnder), 0.0), 120.0) * 4.0 + pow(max(dot(bent, sunUnder), 0.0), 8.0) * 0.6;
    vec3 sky = uSky * uLight * (0.7 + 0.25 * (slope.x - slope.y)) + vec3(1.0, 0.96, 0.86) * glare * uLight;
    // The mirror: the blue of the deep, moving, with bright streaks where a facet catches the sky.
    float streak = smoothstep(0.55, 0.95, slope.x * 0.9 + slope.y * 0.7 + 0.2);
    vec3 mirror = uWater * (0.82 + 0.14 * slope.x) + uSky * uLight * 0.14 * streak * (1.0 - smoothstep(0.2, 0.62, c));
    vec3 col = mix(mirror, sky, window);
    for (int i = 0; i < 2; i++) {
      vec2 d = p - cameraPosition.xz - uHull[i].xy;
      float along = d.x * uHull[i].z - d.y * uHull[i].w;
      float across = d.x * uHull[i].w + d.y * uHull[i].z;
      float e = (along * along) / max(uHullSize[i].x * uHullSize[i].x, 0.01) + (across * across) / max(uHullSize[i].y * uHullSize[i].y, 0.01);
      col *= 1.0 - 0.8 * (1.0 - smoothstep(0.7, 1.9, e)) * step(0.01, uHullSize[i].x);
    }
    col = mix(col, uWater, clamp(1.0 - exp(-pow(dist / uVis * 1.2, 1.5)), 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const plainVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const rayVertex = /* glsl */ `
  ${COMMON}
  attribute vec4 aRay; // where in its tile (x, z), width, own beat
  varying vec2 vUv;
  varying float vBeat;
  varying float vNear;
  void main() {
    // The shafts stand in a tile that follows the eye, so there are always some about her.
    vec2 at = mod(aRay.xy - cameraPosition.xz + 20.0, 40.0) - 20.0 + cameraPosition.xz;
    vec3 sunUnder = normalize(vec3(uSun.x * 0.75, sqrt(max(0.0, 1.0 - 0.5625 * (1.0 - uSun.y * uSun.y))), uSun.z * 0.75));
    vec3 toEye = vec3(at.x, 0.0, at.y) - vec3(cameraPosition.x, 0.0, cameraPosition.z) + vec3(0.001);
    vec3 side = normalize(cross(sunUnder, normalize(toEye)));
    vec3 w = vec3(at.x, 0.0, at.y) - sunUnder * (uv.y * 17.0) + side * (position.x * aRay.z * (1.0 + uv.y * 0.8));
    vUv = uv;
    vBeat = aRay.w;
    vNear = smoothstep(1.0, 4.0, length(toEye));
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
`;

const rayFragment = /* glsl */ `
  ${COMMON}
  varying vec2 vUv;
  varying float vBeat;
  varying float vNear;
  void main() {
    float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float flick = 0.6 + 0.4 * sin(uTime * 0.9 + vBeat * 40.0) * sin(uTime * 0.37 + vBeat * 17.0);
    float a = edge * edge * edge * (1.0 - vUv.y) * (1.0 - vUv.y) * flick * 0.2 * uLight * uCaustic * vNear;
    gl_FragColor = vec4(vec3(0.7, 1.0, 0.92) * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const speckVertex = /* glsl */ `
  ${COMMON}
  uniform vec3 uDrift;
  uniform float uPixels;
  attribute float aSize;
  varying float vFade;
  void main() {
    vec3 w = mod(position + uDrift - cameraPosition + 7.0, 14.0) - 7.0 + cameraPosition;
    #ifdef BUBBLE
      w = position;
    #endif
    w.y = min(w.y, -0.03);
    vec4 v = viewMatrix * vec4(w, 1.0);
    float dist = -v.z;
    vFade = smoothstep(7.0, 3.0, dist) * smoothstep(0.15, 0.6, dist);
    gl_PointSize = clamp(uPixels * 0.012 * aSize / max(dist, 0.2), 1.0, 26.0);
    gl_Position = projectionMatrix * v;
  }
`;

const speckFragment = /* glsl */ `
  ${COMMON}
  varying float vFade;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    #ifdef BUBBLE
      // A bubble is a bright rim with the water showing through the middle.
      float a = smoothstep(0.5, 0.42, r) * (0.25 + 0.75 * smoothstep(0.25, 0.45, r)) * vFade;
      gl_FragColor = vec4(mix(uWater, vec3(0.92, 1.0, 1.0), 0.85) * (0.3 + 0.7 * uLight + 0.6 * uLamp), a);
    #else
      float a = smoothstep(0.5, 0.1, r) * vFade * 0.5;
      gl_FragColor = vec4(mix(uWater, vec3(0.9, 1.0, 0.95), 0.6) * (0.25 + 0.75 * uLight + 0.6 * uLamp), a);
    #endif
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Give every vertex of a geometry one colour, as the shader's `aColor`. */
function paint(g: THREE.BufferGeometry, r: number, gr: number, b: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gr; c[i * 3 + 2] = b; }
  g.setAttribute('aColor', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Several painted pieces as one geometry, without the attributes the shader does not read. */
function join(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(clean, false)!;
}

/** A flat piece from a list of triangles' corners, painted one shade. */
function sheet(points: number[], shade: number, normal: [number, number, number] = [1, 0, 0]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const n = points.length / 3;
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) normals.set(normal, i * 3);
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return paint(g, shade, shade, shade);
}

/** A fin standing in the fish's own plane, from points (z, y) taken three at a time. */
const fin = (zy: number[], shade = 0.72): THREE.BufferGeometry => {
  const p: number[] = [];
  for (let i = 0; i < zy.length; i += 2) p.push(0, zy[i + 1], zy[i]);
  return sheet(p, shade);
};
/** A fin lying flat, both sides, from points (x, z) taken three at a time, at a height. */
const wing = (xz: number[], y: number, shade = 0.8): THREE.BufferGeometry => {
  const p: number[] = [];
  for (const side of [1, -1]) for (let i = 0; i < xz.length; i += 2) p.push(xz[i] * side, y, xz[i + 1]);
  return sheet(p, shade, [0, 1, 0]);
};

/**
 * A body lofted through stations along its length: at each, how far it stands above and below the middle line and
 * how wide it is. Everything is in body lengths, nose at z = +0.5.
 */
function loft(stations: Array<[number, number, number, number]>, ring = 8): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  stations.forEach(([z, top, bottom, wide], i) => {
    const cy = (top + bottom) / 2;
    const ry = (top - bottom) / 2;
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      pos.push(Math.sin(a) * wide, cy + Math.cos(a) * ry, z);
    }
    if (i === 0) return;
    const a0 = (i - 1) * ring;
    const b0 = i * ring;
    for (let k = 0; k < ring; k++) {
      const k1 = (k + 1) % ring;
      idx.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return paint(g, 1, 1, 1);
}

interface Form {
  geometry: THREE.BufferGeometry;
  /** Half the body's depth, where the eye is (along, up) and its size: for the markings. */
  half: number;
  eye: [number, number, number];
  /** How it swims: a tail beat from side to side, and a beat of wings or flippers up and down. */
  wig: [number, number];
  /** How many of them there may be at once. */
  most: number;
}

/** Every kind of body in the sea here, one unit long, nose toward +Z. Each is recognisable by its outline alone. */
function forms(): Record<FishShape, Form> {
  // A sea bass: deep in the shoulder, a spiny back fin with a step in it, a broad square tail.
  const bass = join([
    loft([[0.5, 0.005, -0.005, 0.004], [0.44, 0.06, -0.05, 0.03], [0.3, 0.125, -0.1, 0.055], [0.08, 0.15, -0.135, 0.07], [-0.14, 0.12, -0.11, 0.055], [-0.3, 0.06, -0.055, 0.026], [-0.38, 0.05, -0.05, 0.014]]),
    fin([-0.37, 0.05, -0.5, 0.17, -0.46, 0, -0.37, -0.05, -0.46, 0, -0.5, -0.17, -0.37, 0.05, -0.46, 0, -0.37, -0.05]),
    fin([0.26, 0.12, 0.2, 0.22, 0.02, 0.15, 0.2, 0.22, 0.0, 0.2, 0.02, 0.15, 0.0, 0.15, -0.1, 0.24, -0.28, 0.07, 0.0, 0.15, -0.28, 0.07, -0.14, 0.11]),
    fin([-0.1, -0.11, -0.2, -0.2, -0.28, -0.06]),
    fin([0.18, -0.11, 0.1, -0.21, 0.06, -0.12]),
  ]);
  // A jack: a blade of a fish with a tail forked like a swallow's.
  const jack = join([
    loft([[0.5, 0.004, -0.004, 0.004], [0.42, 0.05, -0.045, 0.028], [0.22, 0.1, -0.09, 0.052], [0.0, 0.11, -0.1, 0.055], [-0.2, 0.075, -0.07, 0.036], [-0.34, 0.028, -0.028, 0.014], [-0.39, 0.02, -0.02, 0.008]]),
    fin([-0.38, 0.02, -0.5, 0.2, -0.43, 0.0, -0.38, -0.02, -0.43, 0.0, -0.5, -0.2]),
    fin([0.1, 0.1, 0.02, 0.17, -0.02, 0.1, -0.02, 0.1, -0.06, 0.14, -0.32, 0.03]),
    fin([-0.06, -0.09, -0.1, -0.14, -0.32, -0.03]),
  ]);
  // A reef fish: an oval on edge, tall fins top and bottom.
  const disc = join([
    loft([[0.5, 0.005, -0.005, 0.004], [0.43, 0.09, -0.08, 0.03], [0.26, 0.2, -0.18, 0.05], [0.05, 0.24, -0.22, 0.055], [-0.16, 0.19, -0.18, 0.042], [-0.3, 0.07, -0.07, 0.02], [-0.37, 0.05, -0.05, 0.01]]),
    fin([-0.36, 0.05, -0.5, 0.2, -0.44, 0, -0.36, -0.05, -0.44, 0, -0.5, -0.2, -0.36, 0.05, -0.44, 0, -0.36, -0.05]),
    fin([0.24, 0.2, 0.0, 0.33, -0.3, 0.08, 0.24, 0.2, -0.3, 0.08, 0.0, 0.22]),
    fin([0.0, -0.21, -0.14, -0.31, -0.3, -0.08]),
    fin([0.2, -0.18, 0.12, -0.3, 0.08, -0.2]),
  ]);
  // A lionfish: a small body in a mane of long spines, and fans for fins.
  const spines: number[] = [];
  for (let i = 0; i < 9; i++) { const z = 0.28 - i * 0.07; spines.push(z, 0.12, z - 0.05, 0.42 - Math.abs(i - 3) * 0.03, z - 0.045, 0.12); }
  const lion = join([
    loft([[0.5, 0.005, -0.005, 0.004], [0.42, 0.08, -0.07, 0.035], [0.24, 0.14, -0.13, 0.06], [0.02, 0.15, -0.14, 0.06], [-0.2, 0.1, -0.1, 0.035], [-0.36, 0.045, -0.045, 0.012]]),
    fin([-0.35, 0.045, -0.5, 0.16, -0.5, -0.16, -0.35, 0.045, -0.5, -0.16, -0.35, -0.045]),
    fin(spines, 0.85),
    wing([0.06, 0.24, 0.42, 0.1, 0.36, -0.12, 0.06, 0.24, 0.36, -0.12, 0.06, 0.08], -0.04, 0.85),
    fin([0.0, -0.13, -0.08, -0.3, -0.22, -0.1]),
  ]);
  // A halibut: an oval lying flat on the sand, both eyes on top.
  const flat = join([
    loft([[0.5, 0.004, -0.004, 0.01], [0.4, 0.03, -0.012, 0.12], [0.15, 0.04, -0.015, 0.24], [-0.1, 0.035, -0.012, 0.21], [-0.3, 0.02, -0.01, 0.07], [-0.38, 0.012, -0.008, 0.035]]),
    wing([0.035, -0.37, 0.14, -0.5, 0, -0.47], 0.004, 0.75),
    wing([0.12, 0.4, 0.3, 0.12, 0.24, 0.15, 0.3, 0.12, 0.26, -0.12, 0.21, -0.1, 0.26, -0.12, 0.07, -0.3, 0.21, -0.1], 0.012, 0.7),
  ]);
  // A ray: a kite with a whip of a tail.
  const ray = join([
    loft([[0.5, 0.004, -0.004, 0.01], [0.38, 0.045, -0.02, 0.09], [0.2, 0.07, -0.025, 0.12], [-0.05, 0.06, -0.02, 0.1], [-0.25, 0.03, -0.015, 0.05], [-0.4, 0.012, -0.01, 0.014], [-0.95, 0.004, -0.004, 0.004]], 6),
    wing([0.07, 0.42, 0.52, 0.08, 0.1, 0.2, 0.52, 0.08, 0.06, -0.28, 0.1, 0.2, 0.1, 0.2, 0.06, -0.28, 0.0, 0.0], 0.012, 0.9),
  ]);
  // A shark: long, with the top of its tail longer than the bottom, two back fins, and fins held out like wings.
  const shark = join([
    loft([[0.5, 0.012, -0.006, 0.02], [0.42, 0.05, -0.035, 0.05], [0.25, 0.075, -0.06, 0.062], [0.0, 0.07, -0.06, 0.055], [-0.22, 0.04, -0.035, 0.03], [-0.38, 0.018, -0.015, 0.01]]),
    fin([-0.36, 0.018, -0.5, 0.2, -0.43, 0.02, -0.36, -0.015, -0.43, 0.02, -0.45, -0.06]),
    fin([0.16, 0.07, 0.06, 0.18, 0.02, 0.07, -0.16, 0.05, -0.23, 0.12, -0.25, 0.04]),
    wing([0.05, 0.24, 0.22, 0.1, 0.05, 0.12], -0.04, 0.8),
  ]);
  // An eel: a ribbon with a blunt head.
  const eel = join([
    loft([[0.5, 0.012, -0.012, 0.012], [0.46, 0.03, -0.028, 0.022], [0.38, 0.034, -0.03, 0.022], [0.2, 0.03, -0.03, 0.02], [-0.2, 0.028, -0.028, 0.016], [-0.5, 0.004, -0.004, 0.004]], 6),
    fin([0.3, 0.03, -0.1, 0.06, -0.5, 0.004, 0.3, 0.03, -0.5, 0.004, -0.2, 0.028]),
  ]);
  // A seal: a torpedo with a round head, fore flippers and a pair of hind ones held together.
  const seal = join([
    loft([[0.5, 0.02, -0.02, 0.02], [0.46, 0.06, -0.055, 0.05], [0.38, 0.075, -0.07, 0.065], [0.3, 0.075, -0.075, 0.07], [0.1, 0.13, -0.13, 0.13], [-0.1, 0.12, -0.12, 0.12], [-0.3, 0.06, -0.06, 0.06], [-0.4, 0.03, -0.03, 0.03]], 10),
    wing([0.02, -0.38, 0.12, -0.5, 0.0, -0.5], 0.0, 0.7),
    wing([0.11, 0.18, 0.3, 0.06, 0.12, 0.08], -0.07, 0.7),
  ]);
  // A turtle: a shell, a head, and four flippers, the front pair long.
  const turtle = join([
    loft([[0.34, 0.02, -0.02, 0.06], [0.24, 0.1, -0.05, 0.2], [0.0, 0.14, -0.06, 0.27], [-0.25, 0.09, -0.05, 0.2], [-0.4, 0.02, -0.02, 0.05]], 10),
    loft([[0.52, 0.01, -0.01, 0.015], [0.47, 0.045, -0.04, 0.045], [0.38, 0.05, -0.045, 0.05], [0.3, 0.03, -0.03, 0.035]], 6),
    wing([0.2, 0.24, 0.62, 0.02, 0.5, -0.06, 0.2, 0.24, 0.5, -0.06, 0.2, 0.12], -0.02, 0.75),
    wing([0.14, -0.28, 0.3, -0.46, 0.1, -0.4], -0.02, 0.75),
  ]);
  return {
    bass: { geometry: bass, half: 0.14, eye: [0.38, 0.045, 0.02], wig: [0.14, 0], most: 80 },
    big: { geometry: bass.clone(), half: 0.14, eye: [0.39, 0.05, 0.014], wig: [0.08, 0], most: 8 },
    jack: { geometry: jack, half: 0.105, eye: [0.39, 0.02, 0.018], wig: [0.14, 0], most: 520 },
    disc: { geometry: disc, half: 0.23, eye: [0.36, 0.06, 0.028], wig: [0.12, 0], most: 360 },
    lion: { geometry: lion, half: 0.15, eye: [0.38, 0.04, 0.022], wig: [0.04, 0.05], most: 16 },
    flat: { geometry: flat, half: 0.03, eye: [0.36, 0.03, 0.0], wig: [0, 0.08], most: 12 },
    ray: { geometry: ray, half: 0.05, eye: [0.3, 0.05, 0.0], wig: [0, 0.3], most: 8 },
    shark: { geometry: shark, half: 0.07, eye: [0.41, 0.02, 0.01], wig: [0.12, 0], most: 8 },
    eel: { geometry: eel, half: 0.03, eye: [0.45, 0.012, 0.008], wig: [0.05, 0], most: 8 },
    seal: { geometry: seal, half: 0.13, eye: [0.43, 0.03, 0.014], wig: [0.02, 0.1], most: 6 },
    turtle: { geometry: turtle, half: 0.1, eye: [0.45, 0.02, 0.012], wig: [0, 0.22], most: 6 },
  };
}

/** A spiny lobster one unit long from the horns to the tail fan, facing +Z, with feelers longer than itself. */
function lobsterGeometry(): THREE.BufferGeometry {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number], ry = 0, rx = 0): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateX(rx);
    g.rotateY(ry);
    g.translate(x, y, z);
    return paint(g, ...c);
  };
  const shell: [number, number, number] = [0.62, 0.2, 0.08];
  const leg: [number, number, number] = [0.9, 0.48, 0.16];
  const parts = [
    loft([[0.42, 0.14, 0.08, 0.05], [0.3, 0.3, 0.05, 0.13], [0.1, 0.3, 0.04, 0.14], [0.0, 0.26, 0.04, 0.12]], 8),
    loft([[0.0, 0.25, 0.05, 0.11], [-0.14, 0.22, 0.05, 0.1], [-0.3, 0.17, 0.05, 0.09], [-0.4, 0.1, 0.05, 0.08]], 8),
    box(0.3, 0.02, 0.14, 0, 0.07, -0.47, [0.75, 0.3, 0.1]),
  ];
  const body = parts[0].getAttribute('aColor') as THREE.BufferAttribute;
  for (let i = 0; i < body.count; i++) body.setXYZ(i, ...shell);
  const tail = parts[1].getAttribute('aColor') as THREE.BufferAttribute;
  for (let i = 0; i < tail.count; i++) tail.setXYZ(i, 0.5 + 0.2 * (i % 2), 0.17, 0.07);
  for (const side of [-1, 1]) {
    // The feelers sweep forward and out, thick at the root.
    parts.push(box(0.03, 0.03, 1.3, side * 0.32, 0.36, 0.98, leg, side * 0.3, -0.14));
    parts.push(box(0.055, 0.055, 0.22, side * 0.1, 0.24, 0.47, shell, side * 0.3));
    parts.push(box(0.04, 0.04, 0.04, side * 0.07, 0.3, 0.4, [0.03, 0.03, 0.03]));
    for (let i = 0; i < 5; i++) parts.push(box(0.34, 0.025, 0.03, side * 0.25, 0.06, 0.32 - i * 0.09, leg, side * (0.3 - i * 0.18), 0));
  }
  return join(parts);
}

/**
 * One metre of giant kelp: the rope of the stipe, and off it three blades, each a long wrinkled ribbon that tapers
 * to a point, hanging from a gas float the size of a plum. `aFlex` runs from 0 at the stipe to 1 at a blade's tip,
 * which is how far the shader lets the surge take it.
 */
function kelpGeometry(blades: number, steps: number, floats: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const flex: number[][] = [];
  for (const turn of [0, Math.PI / 2]) {
    const s = new THREE.PlaneGeometry(0.035, 1);
    s.translate(0, 0.5, 0);
    s.rotateY(turn);
    parts.push(paint(s, 0.3, 0.22, 0.07));
    flex.push(new Array(6).fill(0));
  }
  for (let i = 0; i < blades; i++) {
    const turn = (i * Math.PI * 2) / blades + 0.4;
    const y0 = 0.18 + (i * 0.75) / blades;
    const long = 0.95;
    const pos: number[] = [];
    const col: number[] = [];
    const fl: number[] = [];
    const at = (u: number, side: number): [number, number, number] => {
      // Out from the stipe, then hanging; widest a quarter of the way along; wrinkled like a washboard.
      const out = 0.07 + long * (u - 0.35 * u * u);
      const drop = -0.5 * long * u * u;
      const wide = 0.085 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.55 + 0.45)), 0.8) * (1 - u * 0.75) * 2.2;
      const wrinkle = 0.012 * Math.sin(u * 28 + side * 2) * side;
      const twist = u * 0.9;
      const x = out;
      const z = side * wide * Math.cos(twist);
      const y = y0 + drop + side * wide * Math.sin(twist) + wrinkle;
      return [x * Math.cos(turn) + z * Math.sin(turn), y, -x * Math.sin(turn) + z * Math.cos(turn)];
    };
    for (let k = 0; k < steps; k++) {
      const u0 = k / steps;
      const u1 = (k + 1) / steps;
      const quad = [at(u0, -1), at(u0, 1), at(u1, -1), at(u0, 1), at(u1, 1), at(u1, -1)];
      const us = [u0, u0, u1, u0, u1, u1];
      quad.forEach((p, q) => {
        pos.push(...p);
        // Olive at the float, running to gold at the tip.
        const u = us[q];
        col.push(0.42 + 0.3 * u, 0.36 + 0.14 * u, 0.09 + 0.02 * u);
        fl.push(u);
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    parts.push(g);
    flex.push(fl);
    if (floats) {
      const bulb = new THREE.OctahedronGeometry(0.03, 0);
      bulb.scale(1, 1.5, 1);
      bulb.translate(0.055 * Math.cos(turn), y0, -0.055 * Math.sin(turn));
      parts.push(paint(bulb, 0.58, 0.5, 0.16));
      flex.push(new Array(bulb.getAttribute('position').count).fill(0.02));
    }
  }
  const out = join(parts);
  out.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex.flat(), 1));
  return out;
}

/** A float with a diver-down flag on a staff: red with a white stripe from corner to corner. Seen from the boats. */
export function buildDiveFloat(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'dive_float';
  const red = new THREE.MeshStandardMaterial({ color: 0xd42a1e, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 4, 10), red);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.04;
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6), white);
  staff.position.y = 0.6;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.012), red);
  flag.position.set(0.26, 0.93, 0);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.085, 0.018), white);
  stripe.position.copy(flag.position);
  stripe.rotation.z = -Math.atan2(0.4, 0.5);
  g.add(body, staff, flag, stripe);
  return g;
}

export interface UnderLook {
  /** A steady clock for the swaying and the dancing light, and the seconds since the last frame. */
  time: number;
  dt: number;
  sun: THREE.Vector3;
  /** Daylight 0 to 1, the water's colour at the eye, how far she can see, and whether her lamp is lit. */
  light: number;
  water: THREE.Color;
  sky: THREE.Color;
  see: number;
  lamp: boolean;
  /** The way the surge runs, scene x and z, its strength, and its period in seconds. */
  surgeX: number;
  surgeZ: number;
  surgePeriod: number;
  /** What the water has carried the specks along by since last frame, metres, scene axes. */
  driftX: number;
  driftZ: number;
  /** The hulls overhead: scene x and z, heading, length and beam. */
  hulls: Array<{ x: number; z: number; heading: number; length: number; beam: number }>;
  /** The gun: whether the shaft is on it, how far through loading it is (1 loaded), and the kick of a shot just fired, 1 fading to 0. */
  loaded: boolean;
  loading: number;
  recoil: number;
}

interface Shoal { mesh: THREE.InstancedMesh; tint: THREE.InstancedBufferAttribute; mark: THREE.InstancedBufferAttribute; n: number; most: number }

const BUBBLES = 72;

export class DiveScene {
  /** Everything here hangs off this. It is shown only while she is in the water. */
  readonly group = new THREE.Group();
  /** The gun and the hand that holds it, drawn with the eye. */
  readonly gun = new THREE.Group();
  readonly shaft: THREE.Mesh;
  private readonly line: THREE.Line;
  private readonly floatLine: THREE.Line;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly materials: THREE.Material[] = [];
  private readonly built = new THREE.Group();
  private readonly shoals = {} as Record<FishShape, Shoal>;
  private readonly lobsterMesh: THREE.InstancedMesh;
  private readonly surface: THREE.Mesh;
  private readonly rays: THREE.Mesh;
  private readonly specks: THREE.Points;
  private readonly bubbles: THREE.Points;
  private readonly bubbleAt: THREE.BufferAttribute;
  private readonly bubbleRise = new Float32Array(BUBBLES);
  private nextBubble = 0;
  private readonly gunBody: THREE.Group;
  private readonly gunShaft: THREE.Mesh;
  private readonly gunBands: THREE.Mesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private readonly low: boolean;
  private grid: { x0: number; y0: number; step: number; n: number; depth: Float32Array; ground: Ground } | null = null;

  constructor(low: boolean) {
    this.low = low;
    this.group.name = 'dive';
    this.group.visible = false;
    this.uniforms = {
      uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uLight: { value: 1 }, uWater: { value: new THREE.Color(0.03, 0.2, 0.25) },
      uVis: { value: 18 }, uLamp: { value: 0 }, uLook: { value: new THREE.Vector3(0, 0, -1) }, uSway: { value: new THREE.Vector3(1, 0, 0.9) }, uCaustic: { value: 1 },
      uTropic: { value: 0 }, uSky: { value: new THREE.Color(0.6, 0.85, 0.9) },
      uHull: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uHullSize: { value: [new THREE.Vector2(), new THREE.Vector2()] },
      uDrift: { value: new THREE.Vector3() }, uPixels: { value: 800 },
    };

    // The fish: one mesh for each kind of body, every fish of that body an instance of it, marked by the shader.
    const all = forms();
    for (const shape of Object.keys(all) as FishShape[]) {
      const f = all[shape];
      const most = low ? Math.max(6, Math.round(f.most * 0.45)) : f.most;
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(most * 3), 3);
      const mark = new THREE.InstancedBufferAttribute(new Float32Array(most * 2), 2);
      f.geometry.setAttribute('aTint', tint);
      f.geometry.setAttribute('aFish', mark);
      const material = this.material({ INST: '', FISH: '' }, THREE.DoubleSide, { uForm: { value: new THREE.Vector4(f.half, f.eye[0], f.eye[1], f.eye[2]) }, uWig: { value: new THREE.Vector2(f.wig[0], f.wig[1]) } });
      const mesh = new THREE.InstancedMesh(f.geometry, material, most);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.shoals[shape] = { mesh, tint, mark, n: 0, most };
      this.group.add(mesh);
    }

    const lobGeo = lobsterGeometry();
    lobGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(MAX_LOBSTER * 3).fill(1), 3));
    this.lobsterMesh = new THREE.InstancedMesh(lobGeo, this.material({ INST: '', HAND: '' }), MAX_LOBSTER);
    this.lobsterMesh.count = 0;
    this.lobsterMesh.frustumCulled = false;

    // The surface, from underneath.
    const top = new THREE.PlaneGeometry(1, 1);
    top.rotateX(Math.PI / 2);
    const surfaceMaterial = new THREE.ShaderMaterial({ vertexShader: plainVertex, fragmentShader: surfaceFragment, uniforms: this.uniforms, side: THREE.DoubleSide });
    this.materials.push(surfaceMaterial);
    this.surface = new THREE.Mesh(top, surfaceMaterial);
    this.surface.frustumCulled = false;
    this.surface.renderOrder = -2;

    // Shafts of sunlight: fewer on low graphics.
    const shafts = low ? 12 : 52;
    const rayGeo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    rayGeo.index = plane.index;
    rayGeo.setAttribute('position', plane.getAttribute('position'));
    rayGeo.setAttribute('uv', plane.getAttribute('uv'));
    const a = new Float32Array(shafts * 4);
    for (let i = 0; i < shafts; i++) { a[i * 4] = hash01(i, 1, 201) * 40; a[i * 4 + 1] = hash01(i, 2, 201) * 40; a[i * 4 + 2] = 0.5 + 1.8 * hash01(i, 3, 201); a[i * 4 + 3] = hash01(i, 4, 201); }
    rayGeo.setAttribute('aRay', new THREE.InstancedBufferAttribute(a, 4));
    rayGeo.instanceCount = shafts;
    const rayMaterial = new THREE.ShaderMaterial({ vertexShader: rayVertex, fragmentShader: rayFragment, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.materials.push(rayMaterial);
    this.rays = new THREE.Mesh(rayGeo, rayMaterial);
    this.rays.frustumCulled = false;
    this.rays.renderOrder = 3;

    // Specks adrift in the water: they are what tells her she is moving.
    const count = low ? 160 : 620;
    const specks = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count * 3; i++) specks[i] = hash01(i, 5, 202) * 14;
    for (let i = 0; i < count; i++) sizes[i] = 0.5 + 1.2 * hash01(i, 6, 202) ** 3;
    const speckGeo = new THREE.BufferGeometry();
    speckGeo.setAttribute('position', new THREE.BufferAttribute(specks, 3));
    speckGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const speckMaterial = new THREE.ShaderMaterial({ vertexShader: speckVertex, fragmentShader: speckFragment, uniforms: this.uniforms, transparent: true, depthWrite: false });
    this.materials.push(speckMaterial);
    this.specks = new THREE.Points(speckGeo, speckMaterial);
    this.specks.frustumCulled = false;
    this.specks.renderOrder = 4;

    // Her bubbles: a small pool, each let go at her mouth and left to rise.
    const bubbleGeo = new THREE.BufferGeometry();
    this.bubbleAt = new THREE.BufferAttribute(new Float32Array(BUBBLES * 3).fill(9), 3);
    const bubbleSize = new Float32Array(BUBBLES);
    for (let i = 0; i < BUBBLES; i++) bubbleSize[i] = 1.5 + 4 * hash01(i, 7, 202) ** 2;
    bubbleGeo.setAttribute('position', this.bubbleAt);
    bubbleGeo.setAttribute('aSize', new THREE.BufferAttribute(bubbleSize, 1));
    const bubbleMaterial = new THREE.ShaderMaterial({ vertexShader: speckVertex, fragmentShader: speckFragment, uniforms: this.uniforms, defines: { BUBBLE: '' }, transparent: true, depthWrite: false });
    this.materials.push(bubbleMaterial);
    this.bubbles = new THREE.Points(bubbleGeo, bubbleMaterial);
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 5;

    // The gun, in a gloved hand at the lower right of the mask: a slim barrel with a muzzle, the rubber bands
    // stretched back along it, the steel shaft lying on top with its barbed tip out in front, and a pistol grip.
    const steel: [number, number, number] = [0.8, 0.83, 0.86];
    const black: [number, number, number] = [0.06, 0.065, 0.07];
    const rubber: [number, number, number] = [0.7, 0.5, 0.22];
    const tube = (r0: number, r1: number, long: number, z: number, y: number, c: [number, number, number]): THREE.BufferGeometry => {
      const g = new THREE.CylinderGeometry(r1, r0, long, 8);
      g.rotateX(-Math.PI / 2);
      g.translate(0, y, z - long / 2);
      return paint(g, ...c);
    };
    const part = (g: THREE.BufferGeometry, c: [number, number, number], x: number, y: number, z: number, rx = 0, rz = 0): THREE.BufferGeometry => {
      g.rotateX(rx);
      g.rotateZ(rz);
      g.translate(x, y, z);
      return paint(g, ...c);
    };
    const stock = join([
      tube(0.014, 0.012, 0.86, 0, 0, [0.1, 0.14, 0.17]),
      tube(0.022, 0.02, 0.07, -0.84, 0, black),
      part(new THREE.BoxGeometry(0.03, 0.12, 0.045), black, 0, -0.07, -0.02, 0.35),
      part(new THREE.BoxGeometry(0.008, 0.008, 0.07), black, 0, -0.045, -0.09),
      tube(0.02, 0.016, 0.1, 0.1, 0, black),
      // The hand: a glove round the grip, knuckles forward, and the forearm coming up from the corner of the mask.
      part(new THREE.SphereGeometry(0.05, 10, 8), [0.07, 0.08, 0.1], 0.004, -0.07, -0.025),
      part(new THREE.BoxGeometry(0.075, 0.03, 0.05), [0.09, 0.1, 0.12], 0, -0.045, -0.06),
      part(new THREE.BoxGeometry(0.024, 0.024, 0.06), [0.09, 0.1, 0.12], -0.03, -0.04, -0.035, 0, 0.5),
      part(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 8), [0.05, 0.06, 0.08], 0.03, -0.3, 0.12, -0.6, -0.1),
      part(new THREE.CylinderGeometry(0.043, 0.043, 0.03, 8), [0.1, 0.35, 0.55], 0.012, -0.14, 0.02, -0.6, -0.1),
    ]);
    const hand = this.material({ HAND: '' });
    this.gunBody = new THREE.Group();
    const stockMesh = new THREE.Mesh(stock, hand);
    this.gunShaft = new THREE.Mesh(join([
      tube(0.004, 0.004, 1.02, 0.02, 0.02, steel),
      part(new THREE.ConeGeometry(0.009, 0.05, 6), steel, 0, 0.02, -1.02, -Math.PI / 2),
      part(new THREE.BoxGeometry(0.003, 0.012, 0.06), steel, 0, 0.03, -0.95, 0.2),
    ]), hand);
    this.gunBands = new THREE.Mesh(join([
      part(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 6), rubber, 0.017, 0.012, -0.6, Math.PI / 2),
      part(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 6), rubber, -0.017, 0.012, -0.6, Math.PI / 2),
      part(new THREE.BoxGeometry(0.04, 0.006, 0.01), steel, 0, 0.022, -0.35),
    ]), hand);
    for (const mesh of [stockMesh, this.gunShaft, this.gunBands]) mesh.frustumCulled = false;
    this.gunBody.add(stockMesh, this.gunShaft, this.gunBands);
    this.gunBody.position.set(0.19, -0.17, -0.42);
    this.gunBody.rotation.set(0.05, 0.1, 0);
    this.gun.add(this.gunBody);

    // The shaft in flight, and its line.
    this.shaft = new THREE.Mesh(join([
      tube(0.004, 0.004, 1.05, 0.52, 0, steel),
      part(new THREE.ConeGeometry(0.01, 0.06, 6), steel, 0, 0, -0.55, -Math.PI / 2),
    ]), hand);
    this.shaft.geometry.rotateY(Math.PI);
    this.shaft.frustumCulled = false;
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xe9ecec }));
    this.line.frustumCulled = false;
    const floatGeo = new THREE.BufferGeometry();
    floatGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.floatLine = new THREE.Line(floatGeo, new THREE.LineBasicMaterial({ color: 0xe6c22e }));
    this.floatLine.frustumCulled = false;

    this.group.add(this.built, this.lobsterMesh, this.surface, this.rays, this.specks, this.bubbles, this.shaft, this.line, this.floatLine, this.gun);
  }

  private material(defines: Record<string, string>, side: THREE.Side = THREE.FrontSide, own?: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    // Each material reads the same holders, so one write a frame reaches them all. A few carry numbers of their own.
    const m = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: own ? { ...this.uniforms, ...own } : this.uniforms, defines, side });
    this.materials.push(m);
    return m;
  }

  /**
   * Depth of the bottom as it is drawn, metres: read back off the floor that was built, so a lobster, a halibut or the
   * diver's own fins meet the picture exactly. Beyond what was built it is the rule's own answer.
   */
  readonly floorAt = (x: number, y: number): number => {
    const g = this.grid;
    if (!g) return 0;
    const fx = (x - g.x0) / g.step;
    const fy = (y - g.y0) / g.step;
    if (!(fx >= 0 && fy >= 0 && fx < g.n - 1 && fy < g.n - 1)) return g.ground.floor(x, y);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const at = (a: number, b: number) => g.depth[b * g.n + a];
    return Math.max(0, (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v);
  };

  private clearBuilt(): void {
    for (const o of [...this.built.children]) {
      this.built.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
    }
  }

  /** Many copies of one shape, each placed by `place`, which also says its colour. */
  private scatter<T>(geometry: THREE.BufferGeometry, defines: Record<string, string>, list: T[], place: (item: T, i: number) => [number, number, number], side: THREE.Side = THREE.FrontSide): void {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geometry, this.material({ INST: '', ...defines }, side), list.length);
    const tint = new Float32Array(list.length * 3);
    list.forEach((item, i) => {
      const c = place(item, i);
      mesh.setMatrixAt(i, this.m);
      tint.set(c, i * 3);
    });
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    mesh.frustumCulled = false;
    this.built.add(mesh);
  }

  private put(x: number, y: number, depth: number, turn: number, sx: number, sy = sx, sz = sx, lean = 0): void {
    this.e.set(lean, turn, 0);
    this.m.compose(this.v.set(x, -depth, -y), this.q.setFromEuler(this.e), this.s.set(sx, sy, sz));
  }

  /**
   * Build the bottom round a point: the floor, the ledges and boulder piles, what grows on them, and a hole for
   * each lobster.
   * @param cx sim x of the middle, and `cy` sim y
   * @param tropic true for pale coral sand, false for the grey-gold sand of a cold coast
   * @param surge the way the water is going, compass radians: the kelp's canopy lies along it
   */
  build(ground: Ground, cx: number, cy: number, lobsters: Lobster[], tropic: boolean, surge = 0): void {
    this.clearBuilt();
    this.uniforms.uTropic.value = tropic ? 1 : 0;
    const low = this.low;
    const n = low ? 51 : 93;
    const step = (RADIUS * 2) / (n - 1);
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const rock = new Float32Array(n * n);
    const sand = tropic ? [0.95, 0.93, 0.9] : [0.66, 0.6, 0.47];
    const stone = tropic ? [0.44, 0.39, 0.33] : [0.27, 0.25, 0.21];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = cx - RADIUS + i * step;
        const y = cy - RADIUS + j * step;
        const k = (j * n + i) * 3;
        const d = ground.floor(x, y);
        const r = ground.rock(x, y);
        // Rock stands in steps and shelves; sand lies smooth between, a little hollowed where a channel runs.
        const shelf = r > 0.5 ? 0.35 * (noise2(x / 1.9, y / 1.9, 250) > 0.5 ? 1 : 0) + 0.25 * noise2(x / 0.9, y / 0.9, 251) : -0.12 * (1 - r);
        // The outermost row is drawn far out at its own depth, a skirt, so the built ground has no edge to see in the haze.
        const rim = i === 0 || j === 0 || i === n - 1 || j === n - 1;
        const far = rim ? 4 : 1;
        pos[k] = cx + (x - cx) * far; pos[k + 1] = d > 0 ? -Math.min(Math.max(0.3, d - (rim ? 0 : shelf)), 40) : 0.4; pos[k + 2] = -(cy + (y - cy) * far);
        rock[j * n + i] = r;
        const fleck = 0.88 + 0.24 * hash01(i, j, 203);
        // A pale halo of sand lies round the foot of a reef, where the grazers keep it clean.
        const halo = tropic && r > 0.08 && r < 0.5 ? 1.08 : 1;
        for (let c = 0; c < 3; c++) col[k + c] = (sand[c] * (1 - r) * halo + stone[c] * r) * fleck;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n); }
    this.grid = { x0: cx - RADIUS, y0: cy - RADIUS, step, n, depth: Float32Array.from({ length: n * n }, (_, i) => -pos[i * 3 + 1]), ground };
    const floorGeo = new THREE.BufferGeometry();
    floorGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    floorGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    floorGeo.setAttribute('aRock', new THREE.BufferAttribute(rock, 1));
    floorGeo.setIndex(idx);
    floorGeo.computeVertexNormals();
    const floor = new THREE.Mesh(floorGeo, this.material({ FLOOR: '' }, THREE.DoubleSide));
    floor.frustumCulled = false;
    this.built.add(floor);

    const clearOfHoles = (x: number, y: number, by: number) => !lobsters.some((l) => Math.hypot(l.x - x, l.y - y) < by);
    const cells = (size: number, each: (gx: number, gy: number, x: number, y: number) => void): void => {
      for (let gy = Math.floor((cy - RADIUS) / size); gy <= (cy + RADIUS) / size; gy++) {
        for (let gx = Math.floor((cx - RADIUS) / size); gx <= (cx + RADIUS) / size; gx++) {
          const x = (gx + hash01(gx, gy, 206)) * size;
          const y = (gy + hash01(gx, gy, 207)) * size;
          if (Math.hypot(x - cx, y - cy) < RADIUS - 1) each(gx, gy, x, y);
        }
      }
    };

    // Boulders, in piles of two or three, and long flat shelves that stand proud of the reef with a shadow under them.
    interface Stone { x: number; y: number; d: number; sx: number; sy: number; sz: number; turn: number; lean?: number; c: [number, number, number] }
    const stones: Stone[] = [];
    const shade = (k: number): [number, number, number] => [stone[0] * k, stone[1] * k, stone[2] * k];
    cells(3.1, (gx, gy, x, y) => {
      if (hash01(gx, gy, 205) > (low ? 0.3 : 0.6) || ground.rock(x, y) < 0.55 || !clearOfHoles(x, y, 2.6)) return;
      const d = this.floorAt(x, y);
      if (d < 0.8) return;
      const size = 0.25 + 0.7 * hash01(gx, gy, 208) ** 2;
      const turn = hash01(gx, gy, 211) * 6.28;
      if (hash01(gx, gy, 252) < 0.22) {
        // A shelf: a slab on two feet, dark underneath.
        const long = 1.1 + 1.2 * hash01(gx, gy, 253);
        stones.push({ x, y, d: d - 0.62, sx: long, sy: 0.17, sz: 0.7, turn, lean: 0.06, c: shade(1) });
        stones.push({ x, y, d: d - 0.2, sx: long * 0.8, sy: 0.3, sz: 0.4, turn, c: [0.02, 0.02, 0.025] });
        for (const end of [-1, 1]) stones.push({ x: x + Math.cos(turn) * long * 0.8 * end, y: y - Math.sin(turn) * long * 0.8 * end, d: d - 0.2, sx: 0.4, sy: 0.5, sz: 0.6, turn, c: shade(0.85) });
        return;
      }
      stones.push({ x, y, d: d - size * 0.25, sx: size * (0.8 + 0.6 * hash01(gx, gy, 209)), sy: size * (0.55 + 0.4 * hash01(gx, gy, 210)), sz: size, turn, c: shade(0.75 + 0.5 * hash01(gx, gy, 212)) });
      const more = low ? 0 : Math.floor(hash01(gx, gy, 254) * 3);
      for (let k = 0; k < more; k++) {
        const a = hash01(gx, gy, 255 + k) * 6.28;
        const s2 = size * (0.4 + 0.4 * hash01(gx, gy, 258 + k));
        const px = x + Math.sin(a) * size * 1.1;
        const py = y + Math.cos(a) * size * 1.1;
        stones.push({ x: px, y: py, d: this.floorAt(px, py) - s2 * 0.3, sx: s2, sy: s2 * 0.75, sz: s2 * 0.9, turn: a * 3, c: shade(0.7 + 0.5 * hash01(gx, gy, 261 + k)) });
      }
    });
    for (const l of lobsters) {
      l.d = this.floorAt(l.x, l.y) - 0.02;
      const fx = Math.sin(l.heading);
      const fy = Math.cos(l.heading);
      const turn = -l.heading;
      // Its hole: a roof it sits under with its feelers out, a wall behind and a stone each side, and the dark at the back.
      stones.push({ x: l.x - fx * 0.3, y: l.y - fy * 0.3, d: l.d - 0.5, sx: 0.95, sy: 0.13, sz: 0.62, turn, lean: 0.05, c: shade(0.95) });
      stones.push({ x: l.x - fx * 0.95, y: l.y - fy * 0.95, d: l.d - 0.25, sx: 1.05, sy: 0.6, sz: 0.4, turn, c: shade(0.8) });
      stones.push({ x: l.x - fx * 0.72, y: l.y - fy * 0.72, d: l.d - 0.14, sx: 0.8, sy: 0.3, sz: 0.2, turn, c: [0.012, 0.012, 0.016] });
      for (const side of [-1, 1]) stones.push({ x: l.x - fx * 0.35 + fy * 0.8 * side, y: l.y - fy * 0.35 - fx * 0.8 * side, d: l.d - 0.12, sx: 0.36, sy: 0.42, sz: 0.62, turn, c: shade(0.85) });
    }
    if (stones.length) {
      const raw = new THREE.IcosahedronGeometry(1, 1);
      raw.deleteAttribute('uv');
      raw.deleteAttribute('normal');
      const g = mergeVertices(raw);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const k = 0.82 + 0.36 * hash01(Math.round(p.getX(i) * 50), Math.round(p.getY(i) * 50), Math.round(p.getZ(i) * 50), 213);
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      g.computeVertexNormals();
      paint(g, 1, 1, 1);
      this.scatter(g, { ROCK: '' }, stones, (r) => { this.put(r.x, r.y, r.d, r.turn, r.sx, r.sy, r.sz, r.lean ?? 0); return r.c; });
    }

    // Sea stars and urchins on the rock: small things to find.
    if (!low) {
      const small: Array<{ x: number; y: number; star: boolean; h: number }> = [];
      cells(1.9, (gx, gy, x, y) => {
        const h = hash01(gx, gy, 240);
        if (h < 0.18 && ground.rock(x, y) > 0.55 && this.floorAt(x, y) > 1) small.push({ x, y, star: h < 0.08, h: hash01(gx, gy, 243) });
      });
      const shape = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.4 : 1; const a = (i * Math.PI) / 5; if (i) shape.lineTo(Math.sin(a) * r, Math.cos(a) * r); else shape.moveTo(0, 1); }
      const star = new THREE.ShapeGeometry(shape);
      star.rotateX(-Math.PI / 2);
      star.deleteAttribute('uv');
      this.scatter(paint(star, 1, 1, 1), {}, small.filter((q) => q.star), (q) => {
        this.put(q.x, q.y, this.floorAt(q.x, q.y) - 0.04, q.h * 30, 0.1 + 0.09 * q.h);
        return tropic ? [0.9, 0.5, 0.2] : q.h > 0.5 ? [0.9, 0.45, 0.16] : [0.6, 0.3, 0.68];
      }, THREE.DoubleSide);
      // An urchin is a ball of spines: a spiky little star of cones.
      const spikes: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 14; i++) {
        const cone = new THREE.ConeGeometry(0.12, 1.1, 3, 1, true);
        cone.translate(0, 0.55, 0);
        cone.rotateX(hash01(i, 270) * 1.4);
        cone.rotateY(hash01(i, 271) * 6.28);
        spikes.push(paint(cone, 1, 1, 1));
      }
      spikes.push(paint(new THREE.IcosahedronGeometry(0.45, 0), 0.8, 0.8, 0.8));
      this.scatter(join(spikes), {}, small.filter((q) => !q.star), (q) => {
        this.put(q.x, q.y, this.floorAt(q.x, q.y) - 0.03, q.h * 30, 0.07 + 0.06 * q.h);
        return tropic ? [0.06, 0.05, 0.06] : q.h > 0.6 ? [0.5, 0.12, 0.2] : [0.34, 0.14, 0.44];
      }, THREE.DoubleSide);
    }

    // What grows: one plant to a cell where the rules say so, in stands with clearings between.
    const plants: Array<{ x: number; y: number; d: number; h: number }> = [];
    const thin = low ? 0.5 : 1;
    for (let gy = Math.floor((cy - RADIUS) / GROWTH_CELL); gy <= (cy + RADIUS) / GROWTH_CELL; gy++) {
      for (let gx = Math.floor((cx - RADIUS) / GROWTH_CELL); gx <= (cx + RADIUS) / GROWTH_CELL; gx++) {
        const x = (gx + 0.5) * GROWTH_CELL;
        const y = (gy + 0.5) * GROWTH_CELL;
        if (Math.hypot(x - cx, y - cy) > RADIUS - 1 || !ground.grows(x, y) || hash01(gx, gy, 214) > thin || !clearOfHoles(x, y, 1.8)) continue;
        if (ground.cover === 'kelp' && noise2(x / 9, y / 9, 272) < 0.36) continue;
        const px = x + (hash01(gx, gy, 215) - 0.5) * GROWTH_CELL * 0.7;
        const py = y + (hash01(gx, gy, 216) - 0.5) * GROWTH_CELL * 0.7;
        plants.push({ x: px, y: py, d: this.floorAt(px, py), h: hash01(gx, gy, 217) });
      }
    }
    if (ground.cover === 'kelp') this.plantKelp(plants, surge);
    else if (ground.cover === 'coral') this.plantCoral(plants);
    if (ground.site?.bottom === 'wreck') this.layWreck(ground.site.x, ground.site.y);

    // Surfgrass and low weed in the shallows of a cold coast: bright green tufts that lie over with the surge.
    if (!low && !tropic) {
      const tufts: Array<{ x: number; y: number; h: number }> = [];
      cells(1.3, (gx, gy, x, y) => {
        const d = this.floorAt(x, y);
        if (d > 0.8 && d < 6.5 && ground.rock(x, y) > 0.5 && hash01(gx, gy, 273) < 0.55 && clearOfHoles(x, y, 1.2)) tufts.push({ x, y, h: hash01(gx, gy, 274) });
      });
      const blades: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const b = new THREE.PlaneGeometry(0.035, 1, 1, 2);
        b.translate(0, 0.5, 0);
        b.rotateZ((hash01(i, 275) - 0.5) * 0.9);
        b.rotateY(i * 1.1);
        blades.push(paint(b, 0.8 + 0.4 * hash01(i, 276), 1, 0.8));
      }
      this.scatter(join(blades), { SWAY: '', FADE: '' }, tufts, (q) => {
        this.put(q.x, q.y, this.floorAt(q.x, q.y) - 0.02, q.h * 20, 0.5, 0.35 + 0.5 * q.h, 0.5);
        return q.h > 0.75 ? [0.42, 0.12, 0.14] : [0.2, 0.5, 0.14];
      }, THREE.DoubleSide);
    }

    this.lobsterMesh.count = Math.min(MAX_LOBSTER, lobsters.length);
  }

  /**
   * Giant kelp. Each plant is a holdfast on the rock and a stipe going up, hung with blades. Most reach the top
   * and spread along it the way the water is going, in a canopy the light comes through; some are young and stop
   * part of the way up.
   */
  private plantKelp(plants: Array<{ x: number; y: number; d: number; h: number }>, surge: number): void {
    const tall = (p: { d: number; h: number }) => (p.h < 0.3 ? Math.max(2, Math.floor(p.d * (0.35 + p.h * 1.6))) : Math.ceil(p.d));
    const pieces: Array<{ p: { x: number; y: number; d: number; h: number }; k: number }> = [];
    for (const p of plants) for (let k = 0; k < tall(p); k++) pieces.push({ p, k });
    if (!pieces.length) return;
    const geo = kelpGeometry(3, this.low ? 3 : 6, !this.low);
    const up = new Float32Array(pieces.length);
    this.scatter(geo, { KELP: '', FADE: '' }, pieces, ({ p, k }, i) => {
      // The blades are bigger and thicker toward the top, where the light is.
      const grow = 0.75 + 0.5 * (k / Math.max(1, p.d));
      this.put(p.x, p.y, p.d - k, p.h * 6.28 + k * 1.1, grow, 1, grow);
      up[i] = k;
      const shade = 0.75 + 0.5 * hash01(i, 218);
      return [shade, shade, shade * 0.9];
    }, THREE.DoubleSide);
    geo.setAttribute('aUp', new THREE.InstancedBufferAttribute(up, 1));

    // Holdfasts: a knot of brown roots on the rock at the foot of every plant.
    const knot = new THREE.ConeGeometry(1, 1, 7, 1);
    knot.translate(0, 0.5, 0);
    knot.deleteAttribute('uv');
    this.scatter(paint(knot, 1, 1, 1), {}, plants, (p) => { this.put(p.x, p.y, p.d + 0.03, p.h * 9, 0.16 + 0.1 * p.h, 0.2, 0.16 + 0.1 * p.h); return [0.3, 0.22, 0.1]; });

    // The canopy: the tops of the grown plants, laid over along the surface, all streaming one way.
    const grown = plants.filter((p) => p.h >= 0.3);
    const per = this.low ? 2 : 4;
    const fronds: Array<{ p: { x: number; y: number; d: number; h: number }; k: number }> = [];
    for (const p of grown) for (let k = 0; k < per; k++) fronds.push({ p, k });
    if (!fronds.length) return;
    const frond = kelpGeometry(4, this.low ? 2 : 4, !this.low);
    // A metre of plant lying on its side, away along +Z.
    frond.rotateX(Math.PI / 2);
    const cUp = new Float32Array(fronds.length);
    this.scatter(frond, { KELP: '', FADE: '' }, fronds, ({ p, k }, i) => {
      const along = surge + (hash01(i, 219) - 0.5) * 0.9;
      const out = 0.2 + k * 0.95;
      this.e.set(0, -along + Math.PI, 0);
      this.m.compose(this.v.set(p.x + Math.sin(along) * out, -0.12 - 0.06 * hash01(i, 220), -(p.y + Math.cos(along) * out)), this.q.setFromEuler(this.e), this.s.set(1.5, 1, 1.05));
      cUp[i] = Math.max(0, p.d - 1);
      const shade = 0.8 + 0.4 * hash01(i, 221);
      return [shade, shade, shade];
    }, THREE.DoubleSide);
    frond.setAttribute('aUp', new THREE.InstancedBufferAttribute(cUp, 1));
  }

  /**
   * A tropical reef: brain coral in grooved domes and star coral in lumpy mounds, purple sea fans and tall sea
   * rods that lean with the surge, and barrel and tube sponges.
   */
  private plantCoral(plants: Array<{ x: number; y: number; d: number; h: number }>): void {
    if (!plants.length) return;
    const rawHead = new THREE.IcosahedronGeometry(1, 3);
    rawHead.deleteAttribute('uv');
    rawHead.deleteAttribute('normal');
    const head = mergeVertices(rawHead);
    const hp = head.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i);
      const y = hp.getY(i);
      const z = hp.getZ(i);
      // A dome sitting on the rock, with a few lobes to it.
      const lobes = 1 + 0.16 * Math.sin(x * 4.1 + 1) * Math.sin(z * 3.7 + 2) + 0.1 * Math.sin(y * 6 + x * 5);
      hp.setXYZ(i, x * lobes, Math.max(-0.12, y * lobes * 0.85), z * lobes);
    }
    head.computeVertexNormals();
    paint(head, 1, 1, 1);
    const kind = (p: { h: number }) => (p.h < 0.5 ? 'head' : p.h < 0.68 ? 'fan' : p.h < 0.86 ? 'rod' : 'sponge');
    // The red of the colour also says which coral it is, to the shader: see CORAL.
    const palette: Array<[number, number, number]> = [[0.74, 0.62, 0.3], [0.63, 0.52, 0.34], [0.55, 0.6, 0.3], [0.72, 0.5, 0.4], [0.78, 0.7, 0.44]];
    this.scatter(head, { CORAL: '' }, plants.filter((p) => kind(p) === 'head'), (p, i) => {
      const size = 0.2 + 0.75 * (p.h / 0.5) ** 2;
      this.put(p.x, p.y, p.d - size * 0.1, p.h * 40, size, size * (0.6 + 0.45 * hash01(i, 223)), size * (0.8 + 0.4 * hash01(i, 224)));
      return palette[Math.floor(hash01(i, 225) * palette.length)];
    });

    // A sea fan: a flat net on a short stalk, drawn as a fan of ribs.
    const ribs: THREE.BufferGeometry[] = [];
    for (let i = -5; i <= 5; i++) {
      const a = i * 0.21;
      for (let k = 0; k < 2; k++) {
        const r = new THREE.PlaneGeometry(0.035 - k * 0.012, 0.95 - Math.abs(i) * 0.04 - k * 0.3);
        r.translate(0, (0.95 - Math.abs(i) * 0.04 - k * 0.3) / 2 + k * 0.3, 0);
        r.rotateZ(a + (k ? 0.1 : 0));
        ribs.push(paint(r, 1, 1, 1));
      }
    }
    const web = new THREE.CircleGeometry(0.86, 10, Math.PI / 2 - 1.12, 2.24);
    ribs.push(paint(web, 0.55, 0.55, 0.55));
    this.scatter(join(ribs), { SWAY: '', FADE: '' }, plants.filter((p) => kind(p) === 'fan'), (p, i) => {
      const size = 0.45 + 0.6 * hash01(i, 226);
      this.put(p.x, p.y, p.d - 0.05, p.h * 50, size);
      return hash01(i, 227) < 0.7 ? [0.5, 0.26, 0.62] : [0.78, 0.55, 0.2];
    }, THREE.DoubleSide);

    // Sea rods: a clump of fingers standing up from one foot.
    const fingers: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const f = new THREE.CylinderGeometry(0.018, 0.03, 1, 5, 3);
      f.translate(0, 0.5, 0);
      f.scale(1, 0.6 + 0.4 * hash01(i, 277), 1);
      f.rotateZ((hash01(i, 278) - 0.5) * 0.7);
      f.rotateY(i * 0.9);
      fingers.push(paint(f, 0.85 + 0.3 * hash01(i, 279), 1, 1));
    }
    this.scatter(join(fingers), { SWAY: '' }, plants.filter((p) => kind(p) === 'rod'), (p, i) => {
      const size = 0.6 + 0.9 * hash01(i, 280);
      this.put(p.x, p.y, p.d - 0.03, p.h * 60, size);
      return hash01(i, 281) < 0.5 ? [0.5, 0.36, 0.22] : [0.45, 0.3, 0.5];
    });

    // Sponges: a barrel you could sit in, or a cluster of yellow tubes.
    const barrel = new THREE.CylinderGeometry(0.5, 0.34, 1, 9, 2, true);
    barrel.translate(0, 0.5, 0);
    const tubes: THREE.BufferGeometry[] = [paint(barrel, 1, 1, 1)];
    const dark = new THREE.CircleGeometry(0.47, 9);
    dark.rotateX(-Math.PI / 2);
    dark.translate(0, 0.7, 0);
    tubes.push(paint(dark, 0.08, 0.08, 0.08));
    this.scatter(join(tubes), {}, plants.filter((p) => kind(p) === 'sponge'), (p, i) => {
      const slim = hash01(i, 282) < 0.5;
      const size = slim ? 0.12 + 0.1 * hash01(i, 283) : 0.3 + 0.4 * hash01(i, 283);
      this.put(p.x, p.y, p.d - 0.02, p.h * 70, size, slim ? size * 4 : size * 1.2, size);
      return slim ? [0.85, 0.7, 0.14] : [0.5, 0.2, 0.2];
    }, THREE.DoubleSide);
  }

  /** The bones of a steamer: frames standing out of the sand in two rows, a boiler, deck plating and a fallen mast. */
  private layWreck(x0: number, y0: number): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.deleteAttribute('uv');
    paint(box, 1, 1, 1);
    const pieces: Array<{ x: number; y: number; up: number; sx: number; sy: number; sz: number; lean: number; turn: number }> = [];
    const head = 0.6;
    const along = (a: number, b: number) => ({ x: x0 + Math.sin(head) * a + Math.cos(head) * b, y: y0 + Math.cos(head) * a - Math.sin(head) * b });
    for (let i = -9; i <= 9; i++) {
      const half = 3.6 * Math.sqrt(Math.max(0.05, 1 - (i / 10.5) ** 2));
      for (const side of [-1, 1]) {
        const p = along(i * 2.1, side * half);
        const tall = 1.4 + 2.2 * hash01(i, side, 228);
        pieces.push({ ...p, up: tall / 2 - 0.2, sx: 0.16, sy: tall, sz: 0.28, lean: side * 0.28, turn: head });
        if (i % 3 === 0) pieces.push({ ...along(i * 2.1 + 1, side * half * 0.95), up: 0.7, sx: 0.06, sy: 1.3, sz: 2.2, lean: side * 0.28, turn: head });
      }
      pieces.push({ ...along(i * 2.1, 0), up: 0.1, sx: 0.5, sy: 0.3, sz: 2.2, lean: 0, turn: head });
    }
    pieces.push({ ...along(-4, 0.4), up: 1.3, sx: 2.8, sy: 2.6, sz: 3.6, lean: 0, turn: head + 0.1 });
    pieces.push({ ...along(6, 2.5), up: 0.25, sx: 0.4, sy: 0.4, sz: 15, lean: 0, turn: head + 1.1 });
    pieces.push({ ...along(-12, 0), up: 1.2, sx: 0.3, sy: 2.4, sz: 0.3, lean: 0.2, turn: head });
    this.scatter(box, { ROCK: '' }, pieces, (p, i) => {
      this.e.set(0, -p.turn, p.lean);
      this.m.compose(this.v.set(p.x, -this.floorAt(p.x, p.y) + p.up, -p.y), this.q.setFromEuler(this.e), this.s.set(p.sx, p.sy, p.sz));
      const rust = 0.7 + 0.5 * hash01(i, 229);
      return [0.34 * rust, 0.22 * rust, 0.15 * rust];
    });
  }

  /**
   * Put every fish where it is. A school is drawn as many small fish that all turn the way the school is going,
   * draw together when a hunter is near, and open to let the diver through.
   * @param eye where she is, scene coordinates
   */
  drawFish(fish: Fish[], t: number, held: Fish | null, heldAt: THREE.Vector3 | null, eye: THREE.Vector3): void {
    for (const shape in this.shoals) this.shoals[shape as FishShape].n = 0;
    const put = (f: Fish, x: number, y: number, z: number, heading: number, phase: number, roll: number, pitch: number): void => {
      const s = this.shoals[f.species.shape] ?? this.shoals.bass;
      if (s.n >= s.most) return;
      const len = (f.cm / 100) * (f.species.shape === 'big' ? 1.25 : 1);
      this.e.set(pitch, Math.PI - heading, roll);
      this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e), this.s.setScalar(len));
      s.mesh.setMatrixAt(s.n, this.m);
      this.colour.set(f.species.colour);
      s.tint.setXYZ(s.n, this.colour.r, this.colour.g, this.colour.b);
      s.mark.setXY(s.n, PATTERNS[f.species.pattern ?? 'plain'] ?? 0, phase);
      s.n++;
    };
    // Is anything hunting? A school with a hunter near is a ball.
    let hunterX = 1e9;
    let hunterY = 1e9;
    for (const f of fish) if (f.species.strong && f.mode !== 'gone') { hunterX = f.x; hunterY = f.y; break; }
    for (const f of fish) {
      if (f.mode === 'gone') continue;
      if (f === held && heldAt) { put(f, heldAt.x, heldAt.y, heldAt.z, f.heading, f.phase, 0.5, 0.2); continue; }
      if (f.mode === 'held') continue;
      if (f.count > 1) {
        const hunted = f.species.bait && Math.hypot(hunterX - f.x, hunterY - f.y) < 9;
        const spread = (f.species.bait ? 2.6 : 1.9) * (hunted ? 0.5 : 1) * (1 - 0.35 * f.fear);
        const many = this.low ? Math.ceil(f.count * 0.45) : f.count;
        const fx = Math.sin(f.heading);
        const fz = -Math.cos(f.heading);
        for (let k = 0; k < many; k++) {
          // Each keeps its own place in the school, and the school turns as one, slowly rolling on itself.
          const a = hash01(f.index, k, 230) * 6.28 + t * (hunted ? 0.9 : 0.2);
          const r = spread * Math.cbrt(hash01(f.index, k, 232));
          const up = (hash01(f.index, k, 233) - 0.5) * spread * (hunted ? 1.6 : 0.9);
          let x = f.x + Math.sin(a) * r * 1.3;
          let y = -f.d + up;
          let z = -(f.y + Math.cos(a) * r * 1.3);
          // They open round her as she swims in among them.
          const dx = x - eye.x;
          const dy = y - eye.y;
          const dz = z - eye.z;
          const near = Math.hypot(dx, dy, dz);
          if (near < 1.5 && near > 1e-3) { const push = (1.5 - near) / near; x += dx * push; y += dy * push; z += dz * push; }
          const swim = hunted ? a + Math.PI / 2 : Math.atan2(fx, -fz) + 0.15 * Math.sin(t * 0.8 + k);
          put(f, x, Math.min(-0.3, y), z, swim, hash01(f.index, k, 234), 0, 0);
        }
      } else {
        const resting = f.species.rests && f.mode === 'cruise';
        // A moray is a head and a neck out of a hole: the rest of it is in the rock.
        const eel = f.species.shape === 'eel';
        put(f, f.x, -f.d + (eel ? 0.1 : 0), -f.y, f.heading, f.phase / 6.28, 0, eel ? 0.5 + 0.1 * Math.sin(t * 0.7 + f.phase) : resting ? 0 : -f.vd * 0.6);
      }
    }
    for (const shape in this.shoals) {
      const s = this.shoals[shape as FishShape];
      s.mesh.count = s.n;
      s.mesh.instanceMatrix.needsUpdate = true;
      s.tint.needsUpdate = true;
      s.mark.needsUpdate = true;
    }
  }

  /** Put every lobster where it is: in the mouth of its hole with its feelers out, back inside it, walking, or gone. */
  drawLobsters(list: Lobster[], t: number): void {
    const n = Math.min(MAX_LOBSTER, list.length);
    for (let i = 0; i < n; i++) {
      const l = list[i];
      // A carapace is about a third of the animal.
      const len = (l.mm / 1000) * 3.6;
      const back = l.mode !== 'there' ? 1.2 : l.deep ? 0.5 : l.out ? -0.7 : 0.05;
      const x = l.x - Math.sin(l.heading) * back;
      const y = l.y - Math.cos(l.heading) * back;
      this.e.set(0, Math.PI - l.heading + 0.1 * Math.sin(t * 0.9 + i), 0);
      this.m.compose(this.v.set(x, -l.d, -y), this.q.setFromEuler(this.e), this.s.setScalar(l.mode === 'caught' ? 0.0001 : len));
      this.lobsterMesh.setMatrixAt(i, this.m);
    }
    this.lobsterMesh.count = n;
    this.lobsterMesh.instanceMatrix.needsUpdate = true;
  }

  /** The shaft and the line back to the gun. `tip` is where the point is, scene coordinates. Hidden with `null`. */
  drawShaft(tip: THREE.Vector3 | null, dir: THREE.Vector3, muzzle: THREE.Vector3): void {
    this.shaft.visible = this.line.visible = tip !== null;
    if (!tip) return;
    this.shaft.position.copy(tip).addScaledVector(dir, -0.55);
    this.shaft.lookAt(this.v.copy(tip).add(dir));
    const p = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    p.setXYZ(0, muzzle.x, muzzle.y, muzzle.z);
    p.setXYZ(1, tip.x - dir.x * 1.1, tip.y - dir.y * 1.1, tip.z - dir.z * 1.1);
    p.needsUpdate = true;
  }

  /** The line from the diver up to her float. */
  drawFloatLine(from: THREE.Vector3, to: THREE.Vector3): void {
    const p = this.floatLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    p.setXYZ(0, from.x, from.y, from.z);
    p.setXYZ(1, to.x, to.y, to.z);
    p.needsUpdate = true;
  }

  /** Let go a few bubbles at a place, scene coordinates. They rise by themselves. */
  bubble(x: number, y: number, z: number, count: number): void {
    for (let k = 0; k < count; k++) {
      const i = this.nextBubble = (this.nextBubble + 1) % BUBBLES;
      this.bubbleAt.setXYZ(i, x + (hash01(i, k, 290) - 0.5) * 0.25, y - 0.1 * hash01(i, k, 291), z + (hash01(i, k, 292) - 0.5) * 0.25);
      this.bubbleRise[i] = 0.35 + 0.4 * hash01(i, k, 293);
    }
    this.bubbleAt.needsUpdate = true;
  }

  /** Once a frame while she is in the water. */
  update(camera: THREE.PerspectiveCamera, look: UnderLook, pixels: number): void {
    const u = this.uniforms;
    u.uTime.value = look.time;
    (u.uSun.value as THREE.Vector3).copy(look.sun);
    u.uLight.value = look.light;
    (u.uWater.value as THREE.Color).copy(look.water);
    (u.uSky.value as THREE.Color).copy(look.sky);
    u.uVis.value = look.see;
    u.uLamp.value = look.lamp ? 1 : 0;
    camera.getWorldDirection(u.uLook.value as THREE.Vector3);
    (u.uSway.value as THREE.Vector3).set(look.surgeX, look.surgeZ, (Math.PI * 2) / Math.max(3, look.surgePeriod));
    u.uCaustic.value = this.low ? 0.5 * look.light : look.light;
    (u.uDrift.value as THREE.Vector3).x += look.driftX;
    (u.uDrift.value as THREE.Vector3).z += look.driftZ;
    u.uPixels.value = pixels;
    const hulls = u.uHull.value as THREE.Vector4[];
    const sizes = u.uHullSize.value as THREE.Vector2[];
    for (let i = 0; i < 2; i++) {
      const h = look.hulls[i];
      // agent/origin: from the eye, not the scene's zero, which the stage moves to follow the boat.
      if (h) { hulls[i].set(h.x - camera.position.x, h.z - camera.position.z, Math.sin(h.heading), Math.cos(h.heading)); sizes[i].set(h.length * 0.5, h.beam * 0.55); } else sizes[i].set(0, 0);
    }
    const reach = look.see * 5;
    this.surface.position.set(camera.position.x, 0, camera.position.z);
    this.surface.scale.set(reach, 1, reach);

    // Bubbles rise, wobbling, and are gone at the top.
    const at = this.bubbleAt;
    let any = false;
    for (let i = 0; i < BUBBLES; i++) {
      if (this.bubbleRise[i] <= 0) continue;
      any = true;
      const y = at.getY(i) + this.bubbleRise[i] * look.dt;
      if (y > -0.04) { this.bubbleRise[i] = 0; at.setXYZ(i, 0, 9, 0); continue; }
      at.setXYZ(i, at.getX(i) + Math.sin(look.time * 5 + i) * 0.12 * look.dt, y, at.getZ(i) + Math.cos(look.time * 4 + i * 2) * 0.12 * look.dt);
    }
    if (any) at.needsUpdate = true;

    // The gun rides with the mask. A shot kicks it back and up; the bands are off it until it is loaded again.
    this.gun.position.copy(camera.position);
    this.gun.quaternion.copy(camera.quaternion);
    const kick = look.recoil * look.recoil;
    this.gunBody.position.set(0.19, -0.17 + 0.012 * Math.sin(look.time * 1.3) + 0.03 * kick, -0.42 + 0.09 * kick);
    this.gunBody.rotation.set(0.05 + 0.16 * kick + 0.25 * (1 - look.loading) * (look.loaded ? 0 : 1), 0.1, 0.02 * Math.sin(look.time * 0.9));
    this.gunShaft.visible = look.loaded;
    this.gunBands.visible = look.loaded;
  }

  dispose(): void {
    this.clearBuilt();
    this.group.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.materials) m.dispose();
    (this.line.material as THREE.Material).dispose();
    (this.floatLine.material as THREE.Material).dispose();
  }
}
