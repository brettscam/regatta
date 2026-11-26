import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash01 } from './catch';
import { GROWTH_CELL, type Fish, type FishShape, type Ground, type Lobster } from './diveRules';

/**
 * What is seen under the water on a dive: the sea floor round the diver, kelp or coral on it, the fish and lobster,
 * the surface from below, shafts of light, drifting specks, and the gun. Everything is built once when she goes in,
 * within `RADIUS` of that spot, as a handful of instanced meshes; the water's own haze hides the edge.
 * All of it shares one small shader, which takes the red out of things with depth and with distance, as water does.
 * The rules it draws from (where rock is, where kelp grows, where each fish is) are in `diveRules.ts`.
 * Scene coordinates: X east, Y up from the surface, Z south.
 */

/** How far from where she went in the bottom is built, metres. */
export const RADIUS = 46;

const PATTERNS: Record<string, number> = { plain: 0, sheephead: 1, yellowtail: 2, mottled: 3, stripes: 4, spotted: 5, sand: 6, parrot: 7 };
const SHAPES: Record<FishShape, [number, number]> = { bass: [0.16, 0.3], jack: [0.15, 0.24], disc: [0.14, 0.5], flat: [0.55, 0.07], big: [0.3, 0.36] };
const MAX_FISH = 360;
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
  uniform float uCaustic;   // how much of the dancing light gets down: 0 on low graphics and at night
`;

const vertex = /* glsl */ `
  ${COMMON}
  attribute vec3 aColor;
  #ifdef INST
    attribute vec3 aTint;
  #endif
  #ifdef KELP
    attribute float aUp;    // metres of plant below this piece
  #endif
  #ifdef FISH
    attribute vec2 aFish;   // how it is marked, and its own beat
    varying vec3 vBody;
    varying float vMark;
  #endif
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  void main() {
    vec3 p = position;
    #ifdef FISH
      // The tail beats: more of it the further aft.
      float aft = clamp(0.25 - p.z, 0.0, 1.0);
      p.x += sin(uTime * 7.0 + aFish.y * 6.283 + p.z * 5.0) * 0.16 * aft * aft;
      vBody = position;
      vMark = aFish.x;
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
      // A kelp plant leans with the surge and comes back, the top of it swinging furthest.
      float up = aUp + position.y;
      float beat = sin(uTime * uSway.z + dot(root.xz, vec2(0.37, 0.23)) - up * 0.2);
      w.xz += uSway.xy * (beat * 0.6 + 0.3) * 0.085 * pow(up, 1.15);
      w.xz += vec2(sin(uTime * 0.9 + root.x + up), cos(uTime * 0.7 + root.z + up * 1.3)) * 0.03 * min(up, 4.0);
    #endif
    #ifdef SWAY
      float beat = sin(uTime * uSway.z + dot(root.xz, vec2(0.37, 0.23)));
      w.xz += uSway.xy * beat * 0.12 * position.y;
    #endif
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const LIGHTING = /* glsl */ `
  float caustic(vec2 p, float t) {
    vec2 q = p * 0.9 + vec2(sin(p.y * 1.3 + t * 0.8), cos(p.x * 1.1 - t * 0.6)) * 0.6;
    float a = sin(q.x * 2.1 + t) * sin(q.y * 2.3 - t * 1.2);
    q = p * 1.7 + vec2(cos(p.y * 0.9 - t * 0.5), sin(p.x * 1.2 + t * 0.7));
    a += sin(q.x * 1.9 - t * 1.1) * sin(q.y * 2.2 + t * 0.9);
    return pow(clamp(1.0 - abs(a) * 0.9, 0.0, 1.0), 6.0);
  }
  // What water does to light: red goes in the first few metres, green lasts, blue lasts longest.
  const vec3 ABSORB = vec3(0.17, 0.04, 0.028);
  vec3 underLight(vec3 albedo, vec3 n, vec3 world, float glow, float keep) {
    float depth = max(0.0, -world.y);
    float dist = length(world - cameraPosition);
    vec3 sun = mix(exp(-depth * ABSORB), vec3(0.8), keep) * uLight;
    float nl = 0.5 + 0.5 * max(dot(n, uSun), 0.0);
    float ca = caustic(world.xz, uTime) * exp(-depth * 0.11) * uCaustic * max(n.y, 0.0);
    vec3 lit = albedo * sun * (nl + ca * 1.5 + glow);
    // The dive light is white and close: it gives the colours back, for a few metres.
    vec3 ray = normalize(world - cameraPosition);
    float cone = smoothstep(0.84, 0.97, dot(ray, uLook));
    lit += albedo * uLamp * cone * 2.2 / (1.0 + dist * dist * 0.07);
    lit *= exp(-dist * ABSORB * 0.6 * (1.0 - keep));
    float haze = 1.0 - exp(-pow(dist / uVis * 1.7, 1.5));
    return mix(lit, uWater, clamp(haze, 0.0, 1.0));
  }
`;

const fragment = /* glsl */ `
  ${COMMON}
  ${LIGHTING}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  #ifdef FISH
    varying vec3 vBody;
    varying float vMark;
  #endif
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 c = vColor;
    float glow = 0.0;
    #ifdef FISH
      float z = vBody.z;
      float y = vBody.y;
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
        if (abs(y) < 0.05 || z < -0.34) c = vec3(0.9, 0.74, 0.12);
      } else if (mark == 3) {
        c *= 0.7 + 0.6 * step(0.0, sin(z * 31.0) * sin(y * 37.0 + z * 9.0));
      } else if (mark == 4) {
        c *= 0.35 + 0.65 * step(0.45, fract(z * 6.5 + 0.2));
      } else if (mark == 5) {
        c *= 0.55 + 0.45 * step(0.25, length(fract(vec2(z * 9.0, y * 9.0)) - 0.5));
      } else if (mark == 6) {
        c *= 0.85 + 0.3 * step(0.0, sin(z * 53.0 + vBody.x * 41.0) * sin(vBody.x * 47.0));
      } else if (mark == 7) {
        // Parrotfish: green and blue above, a red belly, a yellow spot at the tail.
        c = mix(vec3(0.75, 0.2, 0.25), c, smoothstep(-0.16, -0.02, y));
        if (z < -0.3 && z > -0.36) c = vec3(0.9, 0.8, 0.2);
      }
    #endif
    #ifdef KELP
      // Kelp lights up gold when the sun is behind it.
      vec3 ray = normalize(vWorld - cameraPosition);
      glow = 0.9 * pow(max(dot(ray, uSun), 0.0), 2.0);
    #endif
    #ifdef FISH
      // Scales catch the light: a fish is a little brighter than the rock behind it.
      glow += 0.35;
    #endif
    float keep = 0.0;
    #ifdef FISH
      // A fish close to keeps more of its colour than the water would leave it: it is how she knows one from another.
      keep = 0.55;
    #endif
    gl_FragColor = vec4(underLight(c, n, vWorld, glow, keep), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const surfaceFragment = /* glsl */ `
  ${COMMON}
  uniform vec3 uSky;
  uniform vec4 uHull[2];     // x, z, sin and cos of the heading
  uniform vec2 uHullSize[2]; // half length, half beam
  varying vec3 vWorld;
  void main() {
    vec3 V = normalize(vWorld - cameraPosition);
    vec2 p = vWorld.xz;
    vec2 rip = vec2(sin(p.x * 1.3 + uTime * 1.1) + sin(p.y * 2.1 - uTime * 0.9 + p.x * 0.7), sin(p.y * 1.7 + uTime * 1.3) + sin(p.x * 2.3 + uTime * 0.7 - p.y * 0.6));
    rip += 0.5 * vec2(sin(p.x * 5.1 - uTime * 2.3 + p.y * 3.3), sin(p.y * 4.7 + uTime * 2.1 - p.x * 2.9));
    // Snell's window: the whole sky squeezed into a circle overhead. Outside it the surface is a mirror of the deep.
    float fine = sin(p.x * 9.0 + uTime * 2.6 + p.y * 4.0) * sin(p.y * 11.0 - uTime * 2.2);
    float c = V.y + dot(rip, vec2(0.012, 0.01)) + fine * 0.012;
    float window = smoothstep(0.62, 0.7, c);
    vec3 sunUnder = normalize(vec3(uSun.x * 0.75, sqrt(max(0.0, 1.0 - 0.5625 * (1.0 - uSun.y * uSun.y))), uSun.z * 0.75));
    float glare = pow(max(dot(normalize(V + vec3(rip.x, 0.0, rip.y) * 0.05), sunUnder), 0.0), 90.0) * 3.0;
    float bright = 0.75 + 0.08 * rip.y + 0.5 * pow(max(dot(V, sunUnder), 0.0), 6.0);
    vec3 col = mix(uWater * (0.6 + 0.06 * rip.x), uSky * uLight * bright + vec3(1.0, 0.95, 0.85) * glare * uLight, window);
    for (int i = 0; i < 2; i++) {
      vec2 d = p - uHull[i].xy;
      float along = d.x * uHull[i].z - d.y * uHull[i].w;
      float across = d.x * uHull[i].w + d.y * uHull[i].z;
      float e = (along * along) / max(uHullSize[i].x * uHullSize[i].x, 0.01) + (across * across) / max(uHullSize[i].y * uHullSize[i].y, 0.01);
      col *= 1.0 - 0.8 * (1.0 - smoothstep(0.7, 1.9, e)) * step(0.01, uHullSize[i].x);
    }
    float dist = length(vWorld - cameraPosition);
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
  void main() {
    // The shafts stand in a tile that follows the eye, so there are always some about her.
    vec2 at = mod(aRay.xy - cameraPosition.xz + 18.0, 36.0) - 18.0 + cameraPosition.xz;
    vec3 sunUnder = normalize(vec3(uSun.x * 0.75, sqrt(max(0.0, 1.0 - 0.5625 * (1.0 - uSun.y * uSun.y))), uSun.z * 0.75));
    vec3 side = normalize(cross(sunUnder, normalize(vec3(at.x, 0.0, at.y) - vec3(cameraPosition.x, 0.0, cameraPosition.z) + vec3(0.001))));
    vec3 w = vec3(at.x, 0.0, at.y) - sunUnder * (uv.y * 15.0) + side * (position.x * aRay.z);
    vUv = uv;
    vBeat = aRay.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
`;

const rayFragment = /* glsl */ `
  ${COMMON}
  varying vec2 vUv;
  varying float vBeat;
  void main() {
    float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float flick = 0.55 + 0.45 * sin(uTime * 0.9 + vBeat * 40.0) * sin(uTime * 0.37 + vBeat * 17.0);
    float a = edge * edge * (1.0 - vUv.y) * flick * 0.11 * uLight * uCaustic;
    gl_FragColor = vec4(vec3(0.75, 1.0, 0.95) * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const speckVertex = /* glsl */ `
  ${COMMON}
  uniform vec3 uDrift;
  uniform float uPixels;
  varying float vFade;
  void main() {
    vec3 w = mod(position + uDrift - cameraPosition + 7.0, 14.0) - 7.0 + cameraPosition;
    w.y = min(w.y, -0.05);
    vec4 v = viewMatrix * vec4(w, 1.0);
    float dist = -v.z;
    vFade = smoothstep(7.0, 3.0, dist) * smoothstep(0.15, 0.6, dist);
    gl_PointSize = clamp(uPixels * 0.012 / max(dist, 0.2), 1.0, 9.0);
    gl_Position = projectionMatrix * v;
  }
`;

const speckFragment = /* glsl */ `
  ${COMMON}
  varying float vFade;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, r) * vFade * 0.5;
    gl_FragColor = vec4(mix(uWater, vec3(0.9, 1.0, 0.95), 0.6) * (0.25 + 0.75 * uLight + 0.6 * uLamp), a);
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

/** A fish one unit long, head toward +Z, as tall and as wide as it is long: each kind is squeezed to its own shape. */
function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 10, 8);
  const p = body.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    // Fullest a little ahead of the middle, drawn down to the root of the tail.
    const girth = z > 0.12 ? Math.sqrt(Math.max(0, 1 - ((z - 0.12) / 0.38) ** 2)) : 0.22 + 0.78 * Math.max(0, 1 - ((0.12 - z) / 0.5) ** 1.6);
    const r = Math.hypot(p.getX(i), p.getY(i)) || 1;
    const dirX = p.getX(i) / r;
    const dirY = p.getY(i) / r;
    p.setXYZ(i, dirX * 0.5 * girth, dirY * 0.5 * girth, z * 0.86 + 0.07);
  }
  body.computeVertexNormals();
  paint(body, 1, 1, 1);
  const fin = (pts: number[], shade: number): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const n = pts.length / 3;
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(n).fill([1, 0, 0]).flat(), 3));
    return paint(g, shade, shade, shade);
  };
  const tail = fin([0, 0, -0.33, 0, 0.42, -0.5, 0, 0.05, -0.43, 0, 0, -0.33, 0, -0.05, -0.43, 0, -0.42, -0.5], 0.75);
  const dorsal = fin([0, 0.4, 0.2, 0, 0.62, -0.02, 0, 0.3, -0.25], 0.7);
  return join([body, tail, dorsal]);
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
  const shell: [number, number, number] = [0.5, 0.17, 0.08];
  const leg: [number, number, number] = [0.75, 0.38, 0.14];
  const parts = [
    box(0.26, 0.22, 0.42, 0, 0.16, 0.2, shell),
    box(0.22, 0.16, 0.2, 0, 0.14, -0.1, [0.44, 0.15, 0.07]),
    box(0.19, 0.13, 0.18, 0, 0.12, -0.28, shell),
    box(0.3, 0.03, 0.16, 0, 0.08, -0.44, [0.6, 0.25, 0.1]),
  ];
  for (const side of [-1, 1]) {
    // The feelers sweep forward and out, thick at the root.
    parts.push(box(0.035, 0.035, 1.25, side * 0.3, 0.3, 0.92, leg, side * 0.3, -0.12));
    parts.push(box(0.05, 0.05, 0.2, side * 0.1, 0.22, 0.44, shell, side * 0.3));
    for (let i = 0; i < 4; i++) parts.push(box(0.3, 0.025, 0.03, side * 0.24, 0.07, 0.3 - i * 0.1, leg, side * (0.25 - i * 0.2), 0));
  }
  return join(parts);
}

/** One metre of kelp: the stipe and three blades hanging off it. Stacked to make a plant. */
function kelpGeometry(blades: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const turn of [0, Math.PI / 2]) {
    const s = new THREE.PlaneGeometry(0.05, 1);
    s.translate(0, 0.5, 0);
    s.rotateY(turn);
    parts.push(paint(s, 0.36, 0.28, 0.08));
  }
  for (let i = 0; i < blades; i++) {
    const b = new THREE.PlaneGeometry(0.16, 0.8, 1, 2);
    b.translate(0, -0.4, 0);
    // Each blade hangs out and down from its float on the stipe.
    b.rotateZ(1.0);
    b.translate(0.02, 0.25 + (i * 0.7) / blades, 0);
    b.rotateY((i * Math.PI * 2) / blades + 0.4);
    parts.push(paint(b, 0.52 + 0.06 * i, 0.43, 0.1));
  }
  return join(parts);
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
  /** Sim time for the swaying and the dancing light. */
  time: number;
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
}

export class DiveScene {
  /** Everything here hangs off this. It is shown only while she is in the water. */
  readonly group = new THREE.Group();
  /** The gun, the shaft and its line, drawn with the eye. */
  readonly gun = new THREE.Group();
  readonly shaft: THREE.Mesh;
  private readonly line: THREE.Line;
  private readonly floatLine: THREE.Line;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly materials: THREE.Material[] = [];
  private readonly built = new THREE.Group();
  private readonly fishMesh: THREE.InstancedMesh;
  private readonly fishTint: THREE.InstancedBufferAttribute;
  private readonly fishMark: THREE.InstancedBufferAttribute;
  private readonly lobsterMesh: THREE.InstancedMesh;
  private readonly surface: THREE.Mesh;
  private readonly rays: THREE.Mesh | null;
  private readonly specks: THREE.Points;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private readonly low: boolean;

  constructor(low: boolean) {
    this.low = low;
    this.group.name = 'dive';
    this.group.visible = false;
    this.uniforms = {
      uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uLight: { value: 1 }, uWater: { value: new THREE.Color(0.03, 0.2, 0.25) },
      uVis: { value: 18 }, uLamp: { value: 0 }, uLook: { value: new THREE.Vector3(0, 0, -1) }, uSway: { value: new THREE.Vector3(1, 0, 0.9) }, uCaustic: { value: 1 },
      uSky: { value: new THREE.Color(0.6, 0.85, 0.9) },
      uHull: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uHullSize: { value: [new THREE.Vector2(), new THREE.Vector2()] },
      uDrift: { value: new THREE.Vector3() }, uPixels: { value: 800 },
    };

    // The fish: one mesh for all of them, each squeezed to its own shape and marked by the shader.
    const fishGeo = fishGeometry();
    this.fishTint = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FISH * 3), 3);
    this.fishMark = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FISH * 2), 2);
    fishGeo.setAttribute('aTint', this.fishTint);
    fishGeo.setAttribute('aFish', this.fishMark);
    this.fishMesh = new THREE.InstancedMesh(fishGeo, this.material({ INST: '', FISH: '' }, THREE.DoubleSide), MAX_FISH);
    this.fishMesh.count = 0;
    this.fishMesh.frustumCulled = false;

    const lobGeo = lobsterGeometry();
    const lobTint = new Float32Array(MAX_LOBSTER * 3).fill(1);
    lobGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(lobTint, 3));
    this.lobsterMesh = new THREE.InstancedMesh(lobGeo, this.material({ INST: '' }), MAX_LOBSTER);
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

    // Shafts of sunlight, on anything but the lowest graphics.
    if (low) this.rays = null;
    else {
      const n = 30;
      const rayGeo = new THREE.InstancedBufferGeometry();
      const plane = new THREE.PlaneGeometry(1, 1);
      rayGeo.index = plane.index;
      rayGeo.setAttribute('position', plane.getAttribute('position'));
      rayGeo.setAttribute('uv', plane.getAttribute('uv'));
      const a = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { a[i * 4] = hash01(i, 1, 201) * 36; a[i * 4 + 1] = hash01(i, 2, 201) * 36; a[i * 4 + 2] = 0.5 + 1.4 * hash01(i, 3, 201); a[i * 4 + 3] = hash01(i, 4, 201); }
      rayGeo.setAttribute('aRay', new THREE.InstancedBufferAttribute(a, 4));
      rayGeo.instanceCount = n;
      const rayMaterial = new THREE.ShaderMaterial({ vertexShader: rayVertex, fragmentShader: rayFragment, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      this.materials.push(rayMaterial);
      this.rays = new THREE.Mesh(rayGeo, rayMaterial);
      this.rays.frustumCulled = false;
      this.rays.renderOrder = 3;
    }

    // Specks adrift in the water: they are what tells her she is moving.
    const count = low ? 160 : 520;
    const specks = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) specks[i] = hash01(i, 5, 202) * 14;
    const speckGeo = new THREE.BufferGeometry();
    speckGeo.setAttribute('position', new THREE.BufferAttribute(specks, 3));
    const speckMaterial = new THREE.ShaderMaterial({ vertexShader: speckVertex, fragmentShader: speckFragment, uniforms: this.uniforms, transparent: true, depthWrite: false });
    this.materials.push(speckMaterial);
    this.specks = new THREE.Points(speckGeo, speckMaterial);
    this.specks.frustumCulled = false;
    this.specks.renderOrder = 4;

    // The gun: a barrel, a grip and the bands, held out ahead and to the right of the mask.
    const dark: [number, number, number] = [0.12, 0.13, 0.14];
    const barrel = paint(new THREE.BoxGeometry(0.022, 0.028, 0.85), ...dark);
    barrel.translate(0, 0, -0.5);
    const band = paint(new THREE.BoxGeometry(0.034, 0.008, 0.4), 0.45, 0.33, 0.2);
    band.translate(0, 0.02, -0.7);
    const gunMesh = new THREE.Mesh(join([barrel, band]), this.material({}));
    gunMesh.position.set(0.2, -0.2, -0.62);
    gunMesh.rotation.set(0.03, 0.06, 0);
    gunMesh.frustumCulled = false;
    this.gun.add(gunMesh);
    const shaftGeo = paint(new THREE.CylinderGeometry(0.006, 0.006, 1.1, 5), 0.75, 0.78, 0.8);
    shaftGeo.rotateX(Math.PI / 2);
    this.shaft = new THREE.Mesh(shaftGeo, this.material({}));
    this.shaft.frustumCulled = false;
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xd8dadb }));
    this.line.frustumCulled = false;
    const floatGeo = new THREE.BufferGeometry();
    floatGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.floatLine = new THREE.Line(floatGeo, new THREE.LineBasicMaterial({ color: 0xe6c22e }));
    this.floatLine.frustumCulled = false;

    this.group.add(this.built, this.fishMesh, this.lobsterMesh, this.surface, this.specks, this.shaft, this.line, this.floatLine);
    if (this.rays) this.group.add(this.rays);
  }

  private material(defines: Record<string, string>, side: THREE.Side = THREE.FrontSide): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, defines, side });
    this.materials.push(m);
    return m;
  }

  private grid: { x0: number; y0: number; step: number; n: number; depth: Float32Array; ground: Ground } | null = null;

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

  /**
   * Build the bottom round a point: the floor, the rocks, the kelp or coral, and a ledge over each lobster.
   * @param cx sim x of the middle, and `cy` sim y
   * @param tropic true for pale coral sand, false for the grey-gold sand of a cold coast
   */
  build(ground: Ground, cx: number, cy: number, lobsters: Lobster[], tropic: boolean): void {
    this.clearBuilt();
    const low = this.low;
    const n = low ? 45 : 71;
    const step = (RADIUS * 2) / (n - 1);
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const sand = tropic ? [0.95, 0.93, 0.9] : [0.62, 0.57, 0.44];
    const stone = tropic ? [0.42, 0.36, 0.3] : [0.27, 0.25, 0.2];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = cx - RADIUS + i * step;
        const y = cy - RADIUS + j * step;
        const k = (j * n + i) * 3;
        const d = ground.floor(x, y);
        pos[k] = x; pos[k + 1] = d > 0 ? -Math.min(d, 40) : 0.4; pos[k + 2] = -y;
        const r = ground.rock(x, y);
        const fleck = 0.85 + 0.3 * hash01(i, j, 203);
        // Rock under a cold sea grows pink coralline crust and green weed; coral rock is paler.
        const crust = hash01(Math.floor(x / 1.7), Math.floor(y / 1.7), 204);
        const tint = r > 0.5 && crust > 0.72 ? (tropic ? [0.6, 0.5, 0.28] : [0.5, 0.26, 0.3]) : r > 0.5 && crust < 0.2 ? [0.2, 0.3, 0.14] : stone;
        for (let c = 0; c < 3; c++) col[k + c] = (sand[c] * (1 - r) + tint[c] * r) * fleck;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n); }
    this.grid = { x0: cx - RADIUS, y0: cy - RADIUS, step, n, depth: Float32Array.from({ length: n * n }, (_, i) => -pos[i * 3 + 1]), ground };
    const floorGeo = new THREE.BufferGeometry();
    floorGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    floorGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    floorGeo.setIndex(idx);
    floorGeo.computeVertexNormals();
    const floor = new THREE.Mesh(floorGeo, this.material({}, THREE.DoubleSide));
    floor.frustumCulled = false;
    this.built.add(floor);

    // Boulders on the rock, and a slab over each lobster's hole.
    const rocks: Array<{ x: number; y: number; d: number; sx: number; sy: number; sz: number; turn: number; shade: number; tint?: [number, number, number] }> = [];
    const cell = 2.6;
    for (let gy = Math.floor((cy - RADIUS) / cell); gy <= (cy + RADIUS) / cell; gy++) {
      for (let gx = Math.floor((cx - RADIUS) / cell); gx <= (cx + RADIUS) / cell; gx++) {
        if (hash01(gx, gy, 205) > (low ? 0.3 : 0.55)) continue;
        const x = (gx + hash01(gx, gy, 206)) * cell;
        const y = (gy + hash01(gx, gy, 207)) * cell;
        if (ground.rock(x, y) < 0.55) continue;
        const d = ground.floor(x, y);
        if (d < 0.8) continue;
        if (lobsters.some((l) => Math.hypot(l.x - x, l.y - y) < 2.4)) continue;
        const size = 0.22 + 0.75 * hash01(gx, gy, 208) ** 2;
        rocks.push({ x, y, d: this.floorAt(x, y) - size * 0.2, sx: size * (0.8 + 0.6 * hash01(gx, gy, 209)), sy: size * (0.5 + 0.4 * hash01(gx, gy, 210)), sz: size, turn: hash01(gx, gy, 211) * 6.28, shade: 0.75 + 0.5 * hash01(gx, gy, 212) });
      }
    }
    for (const l of lobsters) {
      l.d = this.floorAt(l.x, l.y) - 0.02;
      // A ledge behind it, and the dark of the hole at the ledge's foot. The lobster sits in the mouth of it.
      const bx = l.x - Math.sin(l.heading) * 0.62;
      const by = l.y - Math.cos(l.heading) * 0.62;
      rocks.push({ x: bx, y: by, d: l.d - 0.22, sx: 0.95, sy: 0.5, sz: 0.6, turn: -l.heading, shade: 0.9 });
      rocks.push({ x: l.x - Math.sin(l.heading) * 0.36, y: l.y - Math.cos(l.heading) * 0.36, d: l.d - 0.02, sx: 0.36, sy: 0.2, sz: 0.3, turn: -l.heading, shade: 1, tint: [0.015, 0.015, 0.02] });
    }
    if (rocks.length) {
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
      const tint = new Float32Array(rocks.length * 3);
      const mesh = new THREE.InstancedMesh(g, this.material({ INST: '' }), rocks.length);
      rocks.forEach((r, i) => {
        this.e.set(0, r.turn, 0);
        this.m.compose(this.v.set(r.x, -r.d, -r.y), this.q.setFromEuler(this.e), this.s.set(r.sx, r.sy, r.sz));
        mesh.setMatrixAt(i, this.m);
        const c = r.tint ?? stone;
        tint[i * 3] = c[0] * r.shade; tint[i * 3 + 1] = c[1] * r.shade; tint[i * 3 + 2] = c[2] * r.shade;
      });
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
      mesh.frustumCulled = false;
      this.built.add(mesh);
    }

    // Sea stars and urchins on the rock: small things to find.
    const small: Array<{ x: number; y: number; star: boolean; h: number }> = [];
    for (let gy = Math.floor((cy - RADIUS) / 1.9); gy <= (cy + RADIUS) / 1.9 && !low; gy++) {
      for (let gx = Math.floor((cx - RADIUS) / 1.9); gx <= (cx + RADIUS) / 1.9; gx++) {
        const h = hash01(gx, gy, 240);
        if (h > 0.16) continue;
        const x = (gx + hash01(gx, gy, 241)) * 1.9;
        const y = (gy + hash01(gx, gy, 242)) * 1.9;
        if (ground.rock(x, y) > 0.55 && this.floorAt(x, y) > 1) small.push({ x, y, star: h < 0.07, h: hash01(gx, gy, 243) });
      }
    }
    for (const star of [true, false]) {
      const list = small.filter((q) => q.star === star);
      if (!list.length) continue;
      let g: THREE.BufferGeometry;
      if (star) {
        const shape = new THREE.Shape();
        for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.4 : 1; const a = (i * Math.PI) / 5; if (i) shape.lineTo(Math.sin(a) * r, Math.cos(a) * r); else shape.moveTo(0, 1); }
        g = new THREE.ShapeGeometry(shape);
        g.rotateX(-Math.PI / 2);
      } else {
        g = new THREE.ConeGeometry(1, 0.9, 7, 1);
      }
      g.deleteAttribute('uv');
      paint(g, 1, 1, 1);
      const mesh = new THREE.InstancedMesh(g, this.material({ INST: '' }, THREE.DoubleSide), list.length);
      const tint = new Float32Array(list.length * 3);
      list.forEach((q, i) => {
        const size = star ? 0.09 + 0.08 * q.h : 0.06 + 0.05 * q.h;
        this.e.set(0, q.h * 30, 0);
        this.m.compose(this.v.set(q.x, -this.floorAt(q.x, q.y) + (star ? 0.03 : size * 0.4), -q.y), this.q.setFromEuler(this.e), this.s.setScalar(size));
        mesh.setMatrixAt(i, this.m);
        const c = star ? (tropic ? [0.85, 0.45, 0.2] : q.h > 0.5 ? [0.8, 0.42, 0.18] : [0.55, 0.3, 0.6]) : tropic ? [0.07, 0.06, 0.07] : [0.3, 0.12, 0.38];
        tint[i * 3] = c[0]; tint[i * 3 + 1] = c[1]; tint[i * 3 + 2] = c[2];
      });
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
      mesh.frustumCulled = false;
      this.built.add(mesh);
    }

    // What grows: one plant to a cell where the rules say so.
    const plants: Array<{ x: number; y: number; d: number; h: number }> = [];
    const thin = low ? 0.5 : 1;
    for (let gy = Math.floor((cy - RADIUS) / GROWTH_CELL); gy <= (cy + RADIUS) / GROWTH_CELL; gy++) {
      for (let gx = Math.floor((cx - RADIUS) / GROWTH_CELL); gx <= (cx + RADIUS) / GROWTH_CELL; gx++) {
        const x = (gx + 0.5) * GROWTH_CELL;
        const y = (gy + 0.5) * GROWTH_CELL;
        if (Math.hypot(x - cx, y - cy) > RADIUS - 1 || !ground.grows(x, y) || hash01(gx, gy, 214) > thin) continue;
        if (lobsters.some((l) => Math.hypot(l.x - x, l.y - y) < 1.8)) continue;
        const px = x + (hash01(gx, gy, 215) - 0.5) * GROWTH_CELL * 0.7;
        const py = y + (hash01(gx, gy, 216) - 0.5) * GROWTH_CELL * 0.7;
        plants.push({ x: px, y: py, d: this.floorAt(px, py), h: hash01(gx, gy, 217) });
      }
    }
    if (ground.cover === 'kelp') this.plantKelp(plants);
    else if (ground.cover === 'coral') this.plantCoral(plants);
    if (ground.site?.bottom === 'wreck') this.layWreck(ground.site.x, ground.site.y);

    this.lobsterMesh.count = Math.min(MAX_LOBSTER, lobsters.length);
  }

  /** Giant kelp: a stipe from each holdfast up to the surface, hung with blades, and a mat of fronds lying on top. */
  private plantKelp(plants: Array<{ x: number; y: number; d: number; h: number }>): void {
    let pieces = 0;
    for (const p of plants) pieces += Math.ceil(p.d);
    if (!pieces) return;
    const geo = kelpGeometry(this.low ? 2 : 3);
    const mesh = new THREE.InstancedMesh(geo, this.material({ INST: '', KELP: '' }, THREE.DoubleSide), pieces);
    const up = new Float32Array(pieces);
    const tint = new Float32Array(pieces * 3);
    let i = 0;
    for (const p of plants) {
      const n = Math.ceil(p.d);
      for (let k = 0; k < n; k++, i++) {
        this.e.set(0, p.h * 6.28 + k * 1.1, 0);
        this.m.compose(this.v.set(p.x, -p.d + k, -p.y), this.q.setFromEuler(this.e), this.s.set(1, 1, 1));
        mesh.setMatrixAt(i, this.m);
        up[i] = k;
        const shade = 0.75 + 0.5 * hash01(i, 218);
        tint[i * 3] = shade; tint[i * 3 + 1] = shade; tint[i * 3 + 2] = shade * 0.9;
      }
    }
    geo.setAttribute('aUp', new THREE.InstancedBufferAttribute(up, 1));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    mesh.frustumCulled = false;
    this.built.add(mesh);

    // The canopy: fronds that have reached the top and lie along it.
    const per = this.low ? 2 : 4;
    const frond = new THREE.PlaneGeometry(0.55, 2.4, 1, 3);
    frond.rotateX(-Math.PI / 2);
    frond.translate(0, 0, -1.2);
    frond.deleteAttribute('uv');
    paint(frond, 0.5, 0.4, 0.09);
    const canopy = new THREE.InstancedMesh(frond, this.material({ INST: '', KELP: '' }, THREE.DoubleSide), plants.length * per);
    const cUp = new Float32Array(plants.length * per);
    const cTint = new Float32Array(plants.length * per * 3);
    let c = 0;
    for (const p of plants) {
      for (let k = 0; k < per; k++, c++) {
        this.e.set(0, p.h * 6.28 + (k * 6.28) / per + hash01(c, 219), 0);
        this.m.compose(this.v.set(p.x, -0.1 - 0.05 * k, -p.y), this.q.setFromEuler(this.e), this.s.set(1, 1, 0.7 + 0.6 * hash01(c, 220)));
        canopy.setMatrixAt(c, this.m);
        cUp[c] = Math.max(0, p.d - 1);
        const shade = 0.8 + 0.4 * hash01(c, 221);
        cTint[c * 3] = shade; cTint[c * 3 + 1] = shade; cTint[c * 3 + 2] = shade;
      }
    }
    frond.setAttribute('aUp', new THREE.InstancedBufferAttribute(cUp, 1));
    frond.setAttribute('aTint', new THREE.InstancedBufferAttribute(cTint, 3));
    canopy.frustumCulled = false;
    this.built.add(canopy);
  }

  /** A tropical reef: coral heads in rounds and mounds, and purple sea fans that lean with the surge. */
  private plantCoral(plants: Array<{ x: number; y: number; d: number; h: number }>): void {
    if (!plants.length) return;
    const rawHead = new THREE.IcosahedronGeometry(1, 2);
    rawHead.deleteAttribute('uv');
    rawHead.deleteAttribute('normal');
    const head = mergeVertices(rawHead);
    const hp = head.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < hp.count; i++) {
      const k = 0.9 + 0.2 * hash01(Math.round(hp.getX(i) * 40), Math.round(hp.getY(i) * 40), Math.round(hp.getZ(i) * 40), 222);
      hp.setXYZ(i, hp.getX(i) * k, Math.max(-0.2, hp.getY(i) * k), hp.getZ(i) * k);
    }
    head.computeVertexNormals();
    paint(head, 1, 1, 1);
    const fans = plants.filter((p) => p.h > 0.62);
    const heads = plants.filter((p) => p.h <= 0.62);
    const palette: Array<[number, number, number]> = [[0.72, 0.6, 0.3], [0.62, 0.5, 0.36], [0.5, 0.56, 0.3], [0.7, 0.42, 0.4], [0.75, 0.68, 0.45]];
    if (heads.length) {
      const mesh = new THREE.InstancedMesh(head, this.material({ INST: '' }), heads.length);
      const tint = new Float32Array(heads.length * 3);
      heads.forEach((p, i) => {
        const size = 0.22 + 0.7 * (p.h / 0.62) ** 2;
        this.e.set(0, p.h * 40, 0);
        this.m.compose(this.v.set(p.x, -p.d + size * 0.15, -p.y), this.q.setFromEuler(this.e), this.s.set(size, size * (0.55 + 0.5 * hash01(i, 223)), size * (0.8 + 0.4 * hash01(i, 224))));
        mesh.setMatrixAt(i, this.m);
        const c = palette[Math.floor(hash01(i, 225) * palette.length)];
        tint[i * 3] = c[0]; tint[i * 3 + 1] = c[1]; tint[i * 3 + 2] = c[2];
      });
      head.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
      mesh.frustumCulled = false;
      this.built.add(mesh);
    }
    if (fans.length) {
      const fan = new THREE.CircleGeometry(1, 9, 0.35, Math.PI - 0.7);
      fan.deleteAttribute('uv');
      paint(fan, 1, 1, 1);
      const mesh = new THREE.InstancedMesh(fan, this.material({ INST: '', SWAY: '' }, THREE.DoubleSide), fans.length);
      const tint = new Float32Array(fans.length * 3);
      fans.forEach((p, i) => {
        const size = 0.5 + 0.7 * hash01(i, 226);
        this.e.set(0, p.h * 50, 0);
        this.m.compose(this.v.set(p.x, -p.d + 0.1, -p.y), this.q.setFromEuler(this.e), this.s.set(size, size, size));
        mesh.setMatrixAt(i, this.m);
        const purple = hash01(i, 227) < 0.7;
        tint[i * 3] = purple ? 0.5 : 0.75; tint[i * 3 + 1] = purple ? 0.25 : 0.5; tint[i * 3 + 2] = purple ? 0.62 : 0.2;
      });
      fan.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
      mesh.frustumCulled = false;
      this.built.add(mesh);
    }
  }

  /** The bones of a steamer: frames standing out of the sand in two rows, a boiler, and a fallen mast. */
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
      }
      const k = along(i * 2.1, 0);
      pieces.push({ ...k, up: 0.1, sx: 0.5, sy: 0.3, sz: 2.2, lean: 0, turn: head });
    }
    const b = along(-4, 0.4);
    pieces.push({ ...b, up: 1.3, sx: 2.8, sy: 2.6, sz: 3.6, lean: 0, turn: head + 0.1 });
    const mast = along(6, 2.5);
    pieces.push({ ...mast, up: 0.25, sx: 0.4, sy: 0.4, sz: 15, lean: 0, turn: head + 1.1 });
    const mesh = new THREE.InstancedMesh(box, this.material({ INST: '' }), pieces.length);
    const tint = new Float32Array(pieces.length * 3);
    pieces.forEach((p, i) => {
      this.e.set(0, -p.turn, p.lean);
      this.m.compose(this.v.set(p.x, -this.floorAt(p.x, p.y) + p.up, -p.y), this.q.setFromEuler(this.e), this.s.set(p.sx, p.sy, p.sz));
      mesh.setMatrixAt(i, this.m);
      const rust = 0.7 + 0.5 * hash01(i, 229);
      tint[i * 3] = 0.34 * rust; tint[i * 3 + 1] = 0.22 * rust; tint[i * 3 + 2] = 0.15 * rust;
    });
    box.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    mesh.frustumCulled = false;
    this.built.add(mesh);
  }

  /** Put every fish where it is. A school is drawn as many small fish turning about one point. */
  drawFish(fish: Fish[], t: number, held: Fish | null, heldAt: THREE.Vector3 | null): void {
    let i = 0;
    const put = (f: Fish, x: number, y: number, z: number, heading: number, phase: number, roll: number): void => {
      if (i >= MAX_FISH) return;
      const len = f.cm / 100;
      let [wide, tall] = SHAPES[f.species.shape];
      if (f.species.spare && f.species.shape === 'flat') wide = 0.95;
      if (f.species.rests && f.species.speed < 0.1) { wide = 0.07; tall = 0.07; }
      this.e.set(0, Math.PI - heading, roll);
      this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e), this.s.set(len * wide, len * tall, len));
      this.fishMesh.setMatrixAt(i, this.m);
      this.colour.set(f.species.colour);
      this.fishTint.setXYZ(i, this.colour.r, this.colour.g, this.colour.b);
      this.fishMark.setXY(i, PATTERNS[f.species.pattern ?? 'plain'] ?? 0, phase);
      i++;
    };
    for (const f of fish) {
      if (f.mode === 'gone') continue;
      if (f === held && heldAt) { put(f, heldAt.x, heldAt.y, heldAt.z, f.heading, f.phase, 1.2); continue; }
      if (f.mode === 'held') continue;
      if (f.count > 1) {
        const spread = f.species.bait ? 1.9 : 1.3;
        const tight = 1 - 0.45 * f.fear;
        for (let k = 0; k < f.count; k++) {
          const a = hash01(f.index, k, 230) * 6.28 + t * 0.25 * (hash01(f.index, k, 231) > 0.5 ? 1 : -1);
          const r = spread * tight * Math.sqrt(hash01(f.index, k, 232));
          const up = (hash01(f.index, k, 233) - 0.5) * spread * tight;
          put(f, f.x + Math.sin(a) * r, -f.d + up, -(f.y + Math.cos(a) * r), f.heading + 0.25 * Math.sin(t * 0.8 + k), hash01(f.index, k, 234), 0);
        }
      } else put(f, f.x, -f.d, -f.y, f.heading, f.phase / 6.28, 0);
    }
    this.fishMesh.count = i;
    this.fishMesh.instanceMatrix.needsUpdate = true;
    this.fishTint.needsUpdate = true;
    this.fishMark.needsUpdate = true;
  }

  /** Put every lobster where it is: at the mouth of its hole, back inside it, or gone. */
  drawLobsters(list: Lobster[], t: number): void {
    const n = Math.min(MAX_LOBSTER, list.length);
    for (let i = 0; i < n; i++) {
      const l = list[i];
      // A carapace is about a third of the animal.
      const len = (l.mm / 1000) * 3.6;
      const back = l.mode !== 'there' ? 1.4 : l.deep ? 0.55 : l.out ? -0.5 : 0.12;
      const x = l.x - Math.sin(l.heading) * back;
      const y = l.y - Math.cos(l.heading) * back;
      this.e.set(0, Math.PI - l.heading + 0.08 * Math.sin(t * 0.9 + i), 0);
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
      if (h) { hulls[i].set(h.x, h.z, Math.sin(h.heading), Math.cos(h.heading)); sizes[i].set(h.length * 0.5, h.beam * 0.55); } else sizes[i].set(0, 0);
    }
    const reach = look.see * 5;
    this.surface.position.set(camera.position.x, 0, camera.position.z);
    this.surface.scale.set(reach, 1, reach);
    this.gun.position.copy(camera.position);
    this.gun.quaternion.copy(camera.quaternion);
  }

  dispose(): void {
    this.clearBuilt();
    this.group.removeFromParent();
    this.gun.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.gun.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.materials) m.dispose();
    (this.line.material as THREE.Material).dispose();
    (this.floatLine.material as THREE.Material).dispose();
  }
}
