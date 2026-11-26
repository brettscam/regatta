import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash01 } from './catch';
import { GROWTH_CELL, noise2, type Fish, type FishShape, type Ground, type Lobster } from './diveRules';
import type { HandThing } from './diveHand';

/**
 * What is seen under the water on a dive: the sea floor round the diver with its ledges, boulders, holes and sand
 * channels, a beach running up out of the water near a shore, kelp or coral on it, the fish (each school one draw,
 * placed fish by fish in the vertex shader, see `diveFlock.ts`), the lobster and what is taken by hand, the swell
 * from below, shafts of light, drifting specks, silt, bubbles, and the gun in her hand. Everything is built once when
 * she goes in, within `RADIUS` of that spot, as instanced meshes moved by their shaders; the water's own haze, a
 * gradient from bright overhead to dark below, hides the edge. Nothing is made per frame.
 * All of it shares one small shader, which takes the red out of things with depth and with distance, as water does.
 * The rules it draws from (where rock is, where kelp grows, where each fish is) are in `diveRules.ts`.
 * Scene coordinates: X east, Y up from the surface, Z south.
 */

/** How far from where she went in the bottom is built, metres. */
export const RADIUS = 46;

const PATTERNS: Record<string, number> = {
  plain: 0, sheephead: 1, yellowtail: 2, mottled: 3, stripes: 4, spotted: 5, sand: 6, parrot: 7, 'sheephead-f': 8, 'garibaldi-young': 9, bonito: 10, barred: 11,
  whitefish: 12, halfmoon: 13, wrasse: 14, hogfish: 15, mutton: 16, tarpon: 17, mola: 18, senorita: 19, opaleye: 20, seabass: 21, leopard: 22, blueshark: 23,
  sealion: 24, barjack: 25, barracuda: 26,
};
/** The pattern a fish wears: its species', or a young one's or a big male's own. */
export function patternOf(f: Pick<Fish, 'species' | 'young' | 'male'>): number {
  const sp = f.species;
  const name = f.young && sp.young ? sp.young.pattern : f.male && sp.male ? sp.male.pattern : sp.pattern ?? 'plain';
  return PATTERNS[name] ?? 0;
}
/** And its colour. */
export function colourOf(f: Pick<Fish, 'species' | 'young' | 'male'>): string {
  const sp = f.species;
  return f.young && sp.young ? sp.young.colour : f.male && sp.male ? sp.male.colour : sp.colour;
}
const MAX_LOBSTER = 12;
const MAX_HAND = 28;
const MAX_STRUNG = 8;

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
  uniform vec4 uSwell;      // the swell overhead: which way it runs (x, z), its wavenumber, and its height
  uniform float uBio;       // 0 by day; at night, how hard she is moving through the plankton
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
    varying float vFlex;
  #endif
  #ifdef FLOOR
    attribute float aRock;
    varying float vRock;
  #endif
  #ifdef FISH
    uniform vec2 uWig;      // how it swims: a beat of the tail from side to side, or of the wings up and down
    varying float vMark;
    #ifdef SCHOOL
      attribute vec4 aSlot; // its own place in the school, and its own beat
      uniform vec4 uLead;   // the leader: scene x, y, z, and compass heading
      uniform vec4 uShape;  // how wide the school is, how tight a ball, how fast it is turning, and a fish's length
      uniform vec4 uThreat; // what it opens round: scene x, y, z, and how wide a hole
      uniform vec2 uBeat;   // the school's beat, and how it is marked
      uniform vec3 uTintS;
    #else
      attribute vec3 aFish; // how it is marked, its beat (run on as it swims), and how hard it is swimming
    #endif
  #endif
  #if defined(FISH) || defined(CORAL)
    varying vec3 vBody;
  #endif
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  void main() {
    vec3 p = position;
    vec3 nrm = normal;
    #ifdef FISH
      #ifdef SCHOOL
        float beat = uBeat.x + aSlot.w * 6.283;
        float amp = 1.0;
        vMark = uBeat.y;
      #else
        float beat = aFish.y;
        float amp = aFish.z;
        vMark = aFish.x;
      #endif
      // A wave runs down the body from head to tail, growing as it goes; the faster it swims, the quicker and wider.
      float aft = clamp(0.3 - p.z, 0.0, 1.0);
      p.x += sin(beat + p.z * 6.0) * uWig.x * amp * aft * aft;
      // Wings and flippers beat up and down, the tips furthest, the wave running back along them.
      p.y += sin(beat * 0.5 - abs(p.x) * 4.0 + p.z * 2.0) * uWig.y * abs(p.x) * (0.4 + 0.6 * amp);
      // Fins held out at the side flutter while it hangs still.
      p.y += sin(uTime * 13.0 + vMark * 1.7) * 0.012 * step(0.07, abs(p.x)) * step(0.05, p.z) * max(0.0, 1.2 - amp) * step(uWig.y, 0.001);
    #endif
    #if defined(FISH) || defined(CORAL)
      vBody = position;
    #endif
    #if defined(FISH) && defined(SCHOOL)
      // Where this one is in its school: the same sums as diveFlock.ts.
      float sp = uShape.x;
      float tight = uShape.y;
      float t = uTime;
      float su = aSlot.x;
      float sv = aSlot.y;
      float sw = aSlot.z;
      float ph = aSlot.w;
      float along = (su - 0.5) * 3.2 * sp + 0.2 * sp * sin(t * 0.9 + ph * 6.283);
      float across = (sv - 0.5) * 2.0 * sp;
      float upk = (sw - 0.5) * 1.2 * sp + 0.1 * sp * sin(t * 1.3 + ph * 9.0);
      float rr = sp * 0.55 * pow(max(su, 1e-4), 1.0 / 3.0);
      float sa = sv * 6.283 + t * 0.9;
      float se = (sw - 0.5) * 2.5;
      along = mix(along, rr * cos(se) * cos(sa), tight);
      across = mix(across, rr * cos(se) * sin(sa), tight);
      upk = mix(upk, rr * sin(se), tight);
      float lag = max(0.0, 1.6 * sp - along) / 2.5;
      float h = uLead.w - uShape.z * lag;
      float fx = sin(h);
      float fy = cos(h);
      vec3 at = vec3(uLead.x + fx * along + fy * across, uLead.y + upk, uLead.z - (fy * along - fx * across));
      float rel = sa + 1.5708;
      float hd = h + tight * atan(sin(rel), cos(rel)) + 0.15 * (1.0 - tight) * sin(t * 0.8 + ph * 6.283);
      vec3 to = at - uThreat.xyz;
      float dist = length(to);
      if (dist < uThreat.w && dist > 1e-4) { at = uThreat.xyz + to * (uThreat.w / dist); hd += 0.8 * (1.0 - dist / uThreat.w); }
      float th = 3.14159265 - hd;
      float cth = cos(th);
      float sth = sin(th);
      vec3 q = p * uShape.w;
      vec4 w = modelMatrix * vec4(vec3(q.x * cth + q.z * sth, q.y, -q.x * sth + q.z * cth) + at, 1.0);
      vNormal = normalize(mat3(modelMatrix) * vec3(nrm.x * cth + nrm.z * sth, nrm.y, -nrm.x * sth + nrm.z * cth));
      vColor = aColor * uTintS;
      vec3 root = at;
    #elif defined(INST)
      vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
      vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * nrm);
      vColor = aColor * aTint;
      vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #else
      vec4 w = modelMatrix * vec4(p, 1.0);
      vNormal = normalize(mat3(modelMatrix) * nrm);
      vColor = aColor;
      vec3 root = w.xyz;
    #endif
    #ifdef KELP
      // The whole plant leans with the surge and comes back, the top of it swinging furthest. The swing runs down
      // the forest the way the swell runs, so neighbouring plants follow one another, and every blade streams.
      float up = aUp + position.y;
      float travel = dot(root.xz, uSwell.xy) * uSwell.z;
      float swing = sin(uTime * uSway.z - travel - up * 0.12);
      float lean = swing * 0.6 + 0.3;
      w.xz += uSway.xy * lean * 0.085 * pow(up, 1.15);
      w.xz += uSway.xy * (0.35 + 0.3 * swing) * aFlex * 0.45;
      w.y -= aFlex * (0.12 + 0.08 * swing);
      w.xz += vec2(sin(uTime * 0.9 + root.x + up), cos(uTime * 0.7 + root.z + up * 1.3)) * (0.03 * min(up, 4.0) + 0.05 * aFlex);
      vFlex = aFlex;
    #endif
    #ifdef SWAY
      float travel = dot(root.xz, uSwell.xy) * uSwell.z;
      float swing = sin(uTime * uSway.z - travel + dot(root.xz, vec2(0.37, 0.23)) * 0.3);
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
    // The pattern rides on the swell: it drifts the way the waves run as well as shimmering.
    p -= uSwell.xy * t * 0.35;
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
  vec3 sunBelow() { return normalize(vec3(uSun.x * 0.75, sqrt(max(0.0, 1.0 - 0.5625 * (1.0 - uSun.y * uSun.y))), uSun.z * 0.75)); }
  // The colour of the water along a ray: brighter looking up and toward the sun, where the light scatters forward;
  // darker and bluer looking down, and the deeper she is.
  vec3 waterAlong(vec3 ray, float depth) {
    float up = clamp(ray.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = uWater * (0.55 + 0.75 * up * up);
    col *= 1.0 + 0.9 * pow(max(dot(ray, sunBelow()), 0.0), 5.0) * uLight;
    return col * mix(1.0, 0.7, smoothstep(4.0, 26.0, depth)) * vec3(0.92 + 0.08 * up, 1.0, 1.0 + 0.06 * (1.0 - up));
  }
  // What water does to light: red goes in the first few metres, green lasts, blue lasts longest.
  const vec3 ABSORB = vec3(0.17, 0.04, 0.028);
  vec3 underLight(vec3 albedo, vec3 n, vec3 world, float glow, float keep, float amber) {
    float depth = max(0.0, -world.y);
    float dist = length(world - cameraPosition);
    // Within a couple of metres the colour comes back: a fish at arm's length is vivid.
    keep = max(keep, smoothstep(2.8, 0.6, dist) * 0.6);
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
    float haze = clamp(1.0 - exp(-pow(dist / uVis * 1.9, 1.5)), 0.0, 1.0);
    // The water tints what is far off; it does not bleach it. Kelp keeps something of its amber into the murk.
    vec3 fog = waterAlong(ray, max(0.0, -cameraPosition.y));
    fog = mix(fog, fog * vec3(1.35, 1.08, 0.55), amber * (1.0 - haze * 0.5));
    return mix(lit, fog, haze * (1.0 - 0.25 * amber));
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
  #ifdef KELP
    varying float vFlex;
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
    float amber = 0.0;
    #if defined(FLOOR) || defined(ROCK)
      // Rock is never smooth: its face turns this way and that under the crust.
      vec3 bump = vec3(vnoise(vWorld * 2.3), vnoise(vWorld * 2.3 + 7.1), vnoise(vWorld * 2.3 + 13.7)) - 0.5;
      bump += (vec3(vnoise(vWorld * 7.0 + 3.0), vnoise(vWorld * 7.0 + 9.0), vnoise(vWorld * 7.0 + 17.0)) - 0.5) * 0.5;
    #endif
    #ifdef FLOOR
      // Sand lies in ripples across the surge, with broken shell in it; rock wears its crust.
      vec2 across = normalize(uSway.xy + vec2(0.001, 0.0));
      float ripple = sin(dot(vWorld.xz, across) * 7.0 + 1.5 * vnoise(vWorld * 0.7));
      c *= 1.0 + 0.11 * ripple * (1.0 - vRock);
      float shell = step(0.965, hash3(floor(vWorld * 11.0))) * (1.0 - vRock);
      c = mix(c, vec3(0.95, 0.92, 0.86), shell * 0.7);
      c = crust(c, vWorld, smoothstep(0.35, 0.7, vRock));
      n = normalize(n + bump * (0.25 + 0.6 * vRock) + vec3(across.x, 0.0, across.y) * 0.12 * cos(dot(vWorld.xz, across) * 7.0) * (1.0 - vRock));
    #endif
    #ifdef ROCK
      c = crust(c, vWorld, step(0.06, c.r + c.g + c.b));
      n = normalize(n + bump * 0.9);
    #endif
    #ifdef CORAL
      // Brain coral is a maze of grooves; star coral is a field of little cups.
      float kind = fract(vColor.r * 7.31);
      float maze = sin(vBody.x * 26.0 + 3.0 * sin(vBody.z * 9.0 + vBody.y * 7.0)) * sin(vBody.y * 24.0 + 3.0 * sin(vBody.x * 8.0));
      float cups = length(fract(vBody.xz * 7.0 + vBody.y * 3.0) - 0.5);
      c *= kind < 0.5 ? 0.72 + 0.4 * smoothstep(-0.3, 0.3, maze) : 0.7 + 0.5 * smoothstep(0.15, 0.4, cups);
      keep = 0.15;
    #endif
    #ifdef FISH
      float z = vBody.z;
      float y = vBody.y / uForm.x * 0.5;
      float x = vBody.x;
      int mark = int(vMark + 0.5);
      // Most fish are dark on the back and pale underneath.
      c *= 0.75 + 0.6 * smoothstep(0.15, -0.3, y);
      if (mark == 1) {
        // Sheephead male: black head and tail, red between, white chin.
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
      } else if (mark == 8) {
        // Sheephead female: rosy pink all over, a white chin.
        c *= 0.9 + 0.2 * vnoise(vBody * 30.0);
        if (z > 0.3 && y < -0.08) c = vec3(0.9, 0.85, 0.82);
      } else if (mark == 9) {
        // A young garibaldi: orange, scattered with electric-blue spots.
        if (length(fract(vec2(z * 9.0 + 0.3 * y, y * 5.5 + 0.2)) - 0.5) < 0.17) c = vec3(0.1, 0.45, 1.0);
      } else if (mark == 10) {
        // Bonito: dark stripes slanting down the back, silver below.
        c = mix(vec3(0.82, 0.86, 0.9), c, smoothstep(-0.05, 0.08, y));
        if (y > 0.05 && fract((z + y * 0.9) * 9.0) < 0.35) c *= 0.35;
      } else if (mark == 11) {
        // Barred: dark bars down the side.
        c *= 0.55 + 0.45 * smoothstep(-0.2, 0.2, sin(z * 30.0));
      } else if (mark == 12) {
        // Whitefish: tan, with a bluish edge to the fins.
        if (abs(y) > 0.42 || z < -0.38) c = mix(c, vec3(0.35, 0.55, 0.85), 0.6);
      } else if (mark == 13) {
        // Halfmoon: blue-grey, dark above, the tail darker.
        if (z < -0.33) c *= 0.5;
      } else if (mark == 14) {
        // Rock wrasse: mottled, with a dark spot behind the eye.
        c *= 0.75 + 0.5 * vnoise(vBody * 40.0);
        if (length(vec2(z - 0.25, y - 0.05)) < 0.045) c = vec3(0.06);
      } else if (mark == 15) {
        // Hogfish: pale pink, a dark snout band.
        if (z > 0.34 && y > -0.05) c *= 0.5;
      } else if (mark == 16) {
        // Mutton snapper: blue lines on the face, a black spot under the back fin.
        if (length(vec2(z + 0.05, y - 0.12)) < 0.05) c = vec3(0.05);
        if (z > 0.3 && fract(y * 14.0) < 0.2) c = vec3(0.3, 0.55, 0.85);
      } else if (mark == 17) {
        // Tarpon: bright silver scales like coins.
        c = vec3(0.78, 0.82, 0.86) * (0.85 + 0.3 * step(0.5, fract(z * 22.0 + step(0.5, fract(y * 8.0)) * 0.5)));
      } else if (mark == 18) {
        // Mola: grey, mottled pale.
        c *= 0.8 + 0.35 * vnoise(vBody * 18.0);
      } else if (mark == 19) {
        // Señorita: a black spot on the tail.
        if (z < -0.32 && z > -0.42 && abs(y) < 0.2) c = vec3(0.04);
      } else if (mark == 20) {
        // Opaleye: a white spot or two on the back.
        if (y > 0.2 && length(fract(vec2(z * 5.0, 0.5)) - 0.5) < 0.12) c = vec3(0.88);
      } else if (mark == 21) {
        // White seabass: dark on the back, silver on the side.
        c = mix(vec3(0.75, 0.78, 0.8), c * 0.7, smoothstep(0.0, 0.15, y));
      } else if (mark == 22) {
        // Leopard shark: dark saddles and spots.
        c *= 0.5 + 0.5 * step(0.3, abs(sin(z * 22.0))) * step(0.25, length(fract(vec2(z * 14.0, y * 7.0)) - 0.5));
      } else if (mark == 23) {
        // Blue shark: indigo back, white belly.
        c = mix(vec3(0.85, 0.87, 0.9), c, smoothstep(-0.25, 0.05, y));
      } else if (mark == 24) {
        // Sea lion: brown, darker when wet along the back.
        c *= 0.8 + 0.3 * smoothstep(0.2, -0.2, y);
      } else if (mark == 25) {
        // Bar jack: a dark line along the back into the lower tail.
        if (abs(y - 0.18 + z * 0.1) < 0.04) c = vec3(0.08);
      } else if (mark == 26) {
        // Great barracuda: dark bars along the back, scattered black blotches low on the side.
        if (y > 0.0) c *= 0.55 + 0.45 * smoothstep(-0.3, 0.3, sin(z * 22.0));
        if (y < -0.1 && hash3(floor(vec3(z * 14.0, y * 8.0, 0.0))) > 0.8) c = vec3(0.06);
      }
      // An eye, which is most of what makes a fish a fish.
      float eye = length(vec2(z - uForm.y, vBody.y - uForm.z));
      if (eye < uForm.w) c = eye < uForm.w * 0.55 ? vec3(0.02) : vec3(0.85, 0.8, 0.6);
      // Scales catch the light in flecks as it turns; a fish close to keeps more of its colour than the water would leave it.
      vec3 V = normalize(cameraPosition - vWorld);
      float glint = pow(max(dot(reflect(-V, n), sunBelow()), 0.0), 18.0) * (0.4 + 0.6 * step(0.55, vnoise(vBody * 70.0)));
      glow += 0.3 + glint * 1.4 * smoothstep(0.1, -0.2, y);
      keep = 0.55;
    #endif
    #ifdef KELP
      // Kelp is amber glass with the sun behind it: the light comes through the blades, most of all at their thin edges.
      vec3 ray = normalize(vWorld - cameraPosition);
      float back = pow(max(dot(ray, sunBelow()), 0.0), 2.0);
      glow = 1.5 * back * (0.6 + 0.6 * vFlex) + 0.35 * max(ray.y, 0.0) + 0.25;
      c *= vec3(1.08, 1.0, 0.78);
      keep = 0.3;
      amber = 0.75;
    #endif
    #ifdef HAND
      keep = 0.5;
      glow = 0.2;
    #endif
    gl_FragColor = vec4(underLight(c, n, vWorld, glow, keep, amber), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SWELL = /* glsl */ `
  // The swell overhead, from below: two trains of waves, the second a little across the first. Height and slope.
  vec3 swellAt(vec2 p, float t) {
    vec2 d1 = uSwell.xy;
    vec2 d2 = vec2(d1.x * 0.83 - d1.y * 0.56, d1.x * 0.56 + d1.y * 0.83);
    float k1 = uSwell.z;
    float k2 = uSwell.z * 1.7;
    float w1 = sqrt(9.81 * k1);
    float w2 = sqrt(9.81 * k2);
    float a1 = uSwell.w * 0.5;
    float a2 = uSwell.w * 0.18;
    float p1 = dot(p, d1) * k1 - w1 * t;
    float p2 = dot(p, d2) * k2 - w2 * t;
    float h = a1 * sin(p1) + a2 * sin(p2);
    vec2 g = d1 * (a1 * k1 * cos(p1)) + d2 * (a2 * k2 * cos(p2));
    return vec3(h, g);
  }
`;

const surfaceVertex = /* glsl */ `
  ${COMMON}
  ${SWELL}
  varying vec3 vWorld;
  varying vec2 vSlope;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 s = swellAt(w.xz, uTime);
    w.y += s.x;
    vSlope = s.yz;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const surfaceFragment = /* glsl */ `
  ${COMMON}
  uniform vec3 uSky;
  uniform vec4 uHull[2];     // x, z, sin and cos of the heading
  uniform vec2 uHullSize[2]; // half length, half beam
  varying vec3 vWorld;
  varying vec2 vSlope;
  float swell(vec2 p, float t) {
    return sin(p.x * 0.9 + t * 0.9) + sin(p.y * 1.3 - t * 0.7 + p.x * 0.5) + 0.5 * sin(p.x * 2.7 - t * 1.6 + p.y * 1.9) + 0.5 * sin(p.y * 3.1 + t * 1.4 - p.x * 1.2);
  }
  void main() {
    vec3 V = normalize(vWorld - cameraPosition);
    vec2 p = vWorld.xz;
    float dist = length(vWorld - cameraPosition);
    // The slope of the moving surface: the swell's own, and a chop on it that stays smooth at every distance.
    float soft = 1.0 / (1.0 + dist * 0.06);
    vec2 slope = vec2(swell(p + vec2(0.15, 0.0), uTime) - swell(p - vec2(0.15, 0.0), uTime), swell(p + vec2(0.0, 0.15), uTime) - swell(p - vec2(0.0, 0.15), uTime)) * soft + vSlope * 3.0;
    // Snell's window: the whole sky squeezed into a circle overhead, its rim wobbling as the waves pass. Outside it
    // the surface is a mirror of the deep.
    float c = V.y + dot(slope, V.xz) * 0.22 + (slope.x + slope.y) * 0.02;
    float window = smoothstep(0.63, 0.7, c);
    vec3 sunUnder = normalize(vec3(uSun.x * 0.75, sqrt(max(0.0, 1.0 - 0.5625 * (1.0 - uSun.y * uSun.y))), uSun.z * 0.75));
    vec3 bent = normalize(V + vec3(slope.x, 0.0, slope.y) * 0.12);
    float glare = pow(max(dot(bent, sunUnder), 0.0), 120.0) * 4.0 + pow(max(dot(bent, sunUnder), 0.0), 8.0) * 0.6;
    vec3 sky = uSky * uLight * (0.7 + 0.25 * (slope.x - slope.y)) + vec3(1.0, 0.96, 0.86) * glare * uLight;
    // The rim of the window is bright, a ring of all the light coming in low.
    sky += uSky * uLight * 0.35 * (1.0 - smoothstep(0.0, 0.05, abs(c - 0.665)));
    // The mirror: the blue of the deep, moving, with bright streaks where a facet catches the sky.
    float streak = smoothstep(0.55, 0.95, slope.x * 0.9 + slope.y * 0.7 + 0.2);
    vec3 mirror = uWater * (0.82 + 0.14 * slope.x) + uSky * uLight * 0.14 * streak * (1.0 - smoothstep(0.2, 0.62, c));
    vec3 col = mix(mirror, sky, window);
    for (int i = 0; i < 2; i++) {
      vec2 d = p - uHull[i].xy;
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

const backVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const backFragment = /* glsl */ `
  ${COMMON}
  ${LIGHTING}
  varying vec3 vWorld;
  void main() {
    vec3 ray = normalize(vWorld - cameraPosition);
    vec3 col = waterAlong(ray, max(0.0, -cameraPosition.y));
    // A shimmer band in the deep, where the cold water lies under the warm.
    float band = smoothstep(0.08, 0.0, abs(ray.y + 0.32)) * 0.04 * (0.6 + 0.4 * sin(vWorld.x * 0.3 + uTime * 0.7));
    gl_FragColor = vec4(col * (1.0 + band), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const rayVertex = /* glsl */ `
  ${COMMON}
  attribute vec4 aRay; // where in its tile (x, z), width, own beat
  varying vec2 vUv;
  varying float vBeat;
  varying float vNear;
  void main() {
    // The shafts stand in a tile that follows the eye, so there are always some about her. They sway as the
    // swell's lenses pass over.
    vec2 at = mod(aRay.xy - cameraPosition.xz + 20.0, 40.0) - 20.0 + cameraPosition.xz;
    at += uSwell.xy * sin(uTime * 0.6 + aRay.w * 30.0) * 0.6;
    vec3 sunUnder = normalize(vec3(uSun.x * 0.75, sqrt(max(0.0, 1.0 - 0.5625 * (1.0 - uSun.y * uSun.y))), uSun.z * 0.75));
    vec3 toEye = vec3(at.x, 0.0, at.y) - vec3(cameraPosition.x, 0.0, cameraPosition.z) + vec3(0.001);
    vec3 side = normalize(cross(sunUnder, normalize(toEye)));
    vec3 w = vec3(at.x, 0.0, at.y) - sunUnder * (uv.y * 19.0) + side * (position.x * aRay.z * (1.0 + uv.y * 1.2));
    vUv = uv;
    vBeat = aRay.w;
    vNear = smoothstep(1.5, 6.0, length(toEye));
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
`;

const rayFragment = /* glsl */ `
  ${COMMON}
  varying vec2 vUv;
  varying float vBeat;
  varying float vNear;
  void main() {
    // Soft-edged and broad, brightest just under the surface, breaking up and fading as they go down.
    float e = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float edge = e * e * (3.0 - 2.0 * e);
    float flick = 0.55 + 0.45 * sin(uTime * 0.9 + vBeat * 40.0) * sin(uTime * 0.37 + vBeat * 17.0);
    float streaks = 0.75 + 0.25 * sin(vUv.x * 9.0 + vBeat * 20.0 + uTime * 0.3);
    float fall = pow(1.0 - vUv.y, 1.6);
    float a = edge * fall * flick * streaks * 0.075 * uLight * uCaustic * vNear;
    gl_FragColor = vec4(vec3(0.75, 1.0, 0.92) * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const speckVertex = /* glsl */ `
  ${COMMON}
  uniform vec3 uDrift;
  uniform float uPixels;
  attribute float aSize;
  #ifdef BUBBLE
    attribute float aStart;  // the depth it was let go at
  #endif
  #ifdef SILT
    attribute float aBorn;   // when it was kicked up
  #endif
  varying float vFade;
  varying float vSoft;
  varying float vLit;
  void main() {
    vec3 w = mod(position + uDrift - cameraPosition + 7.0, 14.0) - 7.0 + cameraPosition;
    float grow = 1.0;
    #ifdef BUBBLE
      w = position;
      // A bubble swells as it rises, as the water's weight on it lifts: by Boyle, twice the size at the top from ten metres.
      grow = pow((1.0 + aStart / 10.0) / (1.0 + max(0.0, -w.y) / 10.0), 0.333);
    #endif
    #ifdef SILT
      w = position;
      float age = uTime - aBorn;
      // It billows out, hangs, drifts with the surge and settles.
      w.y += min(age, 1.2) * 0.25 - max(0.0, age - 1.5) * 0.08;
      w.xz += uSway.xy * 0.05 * sin(uTime * uSway.z) * min(age, 2.0);
      grow = 1.0 + age * 0.9;
      vLit = clamp(1.0 - age / 5.0, 0.0, 1.0);
    #endif
    w.y = min(w.y, -0.03);
    vec4 v = viewMatrix * vec4(w, 1.0);
    float dist = -v.z;
    vFade = smoothstep(7.0, 3.0, dist) * smoothstep(0.15, 0.6, dist);
    #ifdef SILT
      vFade = smoothstep(14.0, 6.0, dist) * smoothstep(0.1, 0.4, dist);
    #endif
    // Close to the mask a speck is out of focus: bigger, softer, fainter.
    vSoft = smoothstep(1.4, 0.3, dist);
    #ifndef SILT
      vec3 ray = normalize(w - cameraPosition);
      vLit = smoothstep(0.82, 0.97, dot(ray, uLook)) / (1.0 + dist * 0.4);
    #endif
    gl_PointSize = clamp(uPixels * 0.012 * aSize * grow * (1.0 + vSoft * 1.5) / max(dist, 0.2), 1.0, 48.0);
    gl_Position = projectionMatrix * v;
  }
`;

const speckFragment = /* glsl */ `
  ${COMMON}
  varying float vFade;
  varying float vSoft;
  varying float vLit;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    #ifdef BUBBLE
      // A bubble is a bright rim with the water showing through the middle.
      float a = smoothstep(0.5, 0.42, r) * (0.25 + 0.75 * smoothstep(0.25, 0.45, r)) * vFade;
      gl_FragColor = vec4(mix(uWater, vec3(0.92, 1.0, 1.0), 0.85) * (0.3 + 0.7 * uLight + 0.6 * uLamp), a);
    #elif defined(SILT)
      float a = smoothstep(0.5, 0.0, r) * vFade * vLit * 0.32;
      gl_FragColor = vec4(mix(uWater, vec3(0.62, 0.56, 0.42), 0.55) * (0.35 + 0.65 * uLight + 0.5 * uLamp), a);
    #else
      float a = smoothstep(0.5, mix(0.1, 0.45, vSoft), r) * vFade * mix(0.5, 0.22, vSoft);
      // In the dive light the plankton sparkles; at night it glows green where she stirs it.
      float twinkle = 0.5 + 0.5 * sin(uTime * 7.0 + gl_FragCoord.x * 0.37 + gl_FragCoord.y * 0.21);
      vec3 col = mix(uWater, vec3(0.9, 1.0, 0.95), 0.6) * (0.25 + 0.75 * uLight) + vec3(1.0, 0.98, 0.9) * uLamp * vLit * (1.2 + 1.5 * twinkle);
      col += vec3(0.2, 0.95, 0.75) * uBio * twinkle * (1.0 - vSoft * 0.5);
      gl_FragColor = vec4(col, a * (1.0 + uLamp * vLit * 2.0 + uBio * 2.0));
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

/** Round a body's sides to this many facets, and smooth its run from nose to tail this many times: set by the graphics level. */
let RING = 10;
let SMOOTH = 1;

/** Cut the corners of a run of stations (Chaikin): the same body, rounder along its length. Ends stay where they are. */
function rounder(st: Array<[number, number, number, number]>, times: number): Array<[number, number, number, number]> {
  let s = st;
  for (let k = 0; k < times; k++) {
    const out: Array<[number, number, number, number]> = [s[0]];
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i];
      const b = s[i + 1];
      out.push(a.map((v, j) => v * 0.75 + b[j] * 0.25) as [number, number, number, number], a.map((v, j) => v * 0.25 + b[j] * 0.75) as [number, number, number, number]);
    }
    out.push(s[s.length - 1]);
    s = out;
  }
  return s;
}

/**
 * A body lofted through stations along its length: at each, how far it stands above and below the middle line and
 * how wide it is. Everything is in body lengths, nose at z = +0.5.
 */
function loft(stations: Array<[number, number, number, number]>, ring = RING, smooth = SMOOTH): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  rounder(stations, smooth).forEach(([z, top, bottom, wide], i) => {
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
  /** How many of them there may be at once, outside the schools. */
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
    wing([0.06, 0.22, 0.17, 0.1, 0.07, 0.14], -0.03, 0.85),
  ]);
  // A jack: a blade of a fish with a tail forked like a swallow's.
  const jack = join([
    loft([[0.5, 0.004, -0.004, 0.004], [0.42, 0.05, -0.045, 0.028], [0.22, 0.1, -0.09, 0.052], [0.0, 0.11, -0.1, 0.055], [-0.2, 0.075, -0.07, 0.036], [-0.34, 0.028, -0.028, 0.014], [-0.39, 0.02, -0.02, 0.008]]),
    fin([-0.38, 0.02, -0.5, 0.2, -0.43, 0.0, -0.38, -0.02, -0.43, 0.0, -0.5, -0.2]),
    fin([0.1, 0.1, 0.02, 0.17, -0.02, 0.1, -0.02, 0.1, -0.06, 0.14, -0.32, 0.03]),
    fin([-0.06, -0.09, -0.1, -0.14, -0.32, -0.03]),
    wing([0.05, 0.25, 0.16, 0.12, 0.05, 0.16], -0.02, 0.85),
  ]);
  // A barracuda: a long thin torpedo with an underslung jaw, two small back fins well apart, and a forked tail.
  const needle = join([
    loft([[0.5, 0.003, -0.008, 0.004], [0.44, 0.022, -0.026, 0.016], [0.3, 0.04, -0.04, 0.026], [0.0, 0.045, -0.045, 0.03], [-0.25, 0.036, -0.036, 0.022], [-0.4, 0.016, -0.016, 0.01], [-0.43, 0.012, -0.012, 0.006]]),
    fin([-0.42, 0.012, -0.5, 0.11, -0.46, 0.0, -0.42, -0.012, -0.46, 0.0, -0.5, -0.11]),
    fin([0.08, 0.044, 0.02, 0.1, -0.02, 0.044]),
    fin([-0.22, 0.036, -0.27, 0.075, -0.31, 0.03]),
    fin([-0.22, -0.036, -0.27, -0.07, -0.31, -0.03]),
  ]);
  // A reef fish: an oval on edge, tall fins top and bottom.
  const disc = join([
    loft([[0.5, 0.005, -0.005, 0.004], [0.43, 0.09, -0.08, 0.03], [0.26, 0.2, -0.18, 0.05], [0.05, 0.24, -0.22, 0.055], [-0.16, 0.19, -0.18, 0.042], [-0.3, 0.07, -0.07, 0.02], [-0.37, 0.05, -0.05, 0.01]]),
    fin([-0.36, 0.05, -0.5, 0.2, -0.44, 0, -0.36, -0.05, -0.44, 0, -0.5, -0.2, -0.36, 0.05, -0.44, 0, -0.36, -0.05]),
    fin([0.24, 0.2, 0.0, 0.33, -0.3, 0.08, 0.24, 0.2, -0.3, 0.08, 0.0, 0.22]),
    fin([0.0, -0.21, -0.14, -0.31, -0.3, -0.08]),
    fin([0.2, -0.18, 0.12, -0.3, 0.08, -0.2]),
    wing([0.05, 0.24, 0.15, 0.1, 0.05, 0.14], 0.0, 0.85),
  ]);
  // A mola: a great disc that ends where a tail should start, with a tall fin above and below at the back.
  const mola = join([
    loft([[0.5, 0.06, -0.06, 0.02], [0.44, 0.22, -0.2, 0.05], [0.3, 0.36, -0.34, 0.07], [0.05, 0.4, -0.4, 0.08], [-0.2, 0.34, -0.34, 0.07], [-0.32, 0.22, -0.22, 0.05], [-0.36, 0.14, -0.14, 0.03]]),
    fin([-0.06, 0.36, -0.2, 0.95, -0.3, 0.3]),
    fin([-0.06, -0.36, -0.2, -0.95, -0.3, -0.3]),
    fin([-0.32, 0.22, -0.42, 0.12, -0.42, -0.12, -0.32, 0.22, -0.42, -0.12, -0.32, -0.22]),
    wing([0.06, 0.24, 0.12, 0.16, 0.05, 0.18], 0.0, 0.8),
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
    loft([[0.5, 0.004, -0.004, 0.01], [0.38, 0.045, -0.02, 0.09], [0.2, 0.07, -0.025, 0.12], [-0.05, 0.06, -0.02, 0.1], [-0.25, 0.03, -0.015, 0.05], [-0.4, 0.012, -0.01, 0.014], [-0.95, 0.004, -0.004, 0.004]], Math.min(RING, 8)),
    wing([0.07, 0.42, 0.52, 0.08, 0.1, 0.2, 0.52, 0.08, 0.06, -0.28, 0.1, 0.2, 0.1, 0.2, 0.06, -0.28, 0.0, 0.0], 0.012, 0.9),
  ]);
  // A shark: long, with the top of its tail longer than the bottom, two back fins, and fins held out like wings.
  const shark = join([
    loft([[0.5, 0.012, -0.006, 0.02], [0.42, 0.05, -0.035, 0.05], [0.25, 0.075, -0.06, 0.062], [0.0, 0.07, -0.06, 0.055], [-0.22, 0.04, -0.035, 0.03], [-0.38, 0.018, -0.015, 0.01]]),
    fin([-0.36, 0.018, -0.5, 0.2, -0.43, 0.02, -0.36, -0.015, -0.43, 0.02, -0.45, -0.06]),
    fin([0.16, 0.07, 0.06, 0.18, 0.02, 0.07, -0.16, 0.05, -0.23, 0.12, -0.25, 0.04]),
    wing([0.05, 0.24, 0.22, 0.1, 0.05, 0.12], -0.04, 0.8),
  ]);
  // An eel: a ribbon with a blunt head and a mouth that works.
  const eel = join([
    loft([[0.5, 0.012, -0.012, 0.012], [0.47, 0.03, -0.028, 0.022], [0.4, 0.036, -0.032, 0.024], [0.2, 0.032, -0.03, 0.021], [-0.2, 0.028, -0.028, 0.016], [-0.5, 0.004, -0.004, 0.004]], Math.min(RING, 8)),
    fin([0.3, 0.03, -0.1, 0.06, -0.5, 0.004, 0.3, 0.03, -0.5, 0.004, -0.2, 0.028]),
  ]);
  // A seal or a sea lion: a sleek torpedo with a round head on a short neck, a muzzle, fore flippers, and the hind pair held together.
  const seal = join([
    loft([[0.5, 0.01, -0.025, 0.015], [0.48, 0.035, -0.045, 0.035], [0.44, 0.065, -0.06, 0.058], [0.39, 0.075, -0.065, 0.068], [0.34, 0.068, -0.068, 0.064], [0.27, 0.085, -0.09, 0.085], [0.12, 0.125, -0.13, 0.125], [-0.06, 0.12, -0.12, 0.118], [-0.22, 0.085, -0.085, 0.08], [-0.34, 0.05, -0.045, 0.045], [-0.41, 0.028, -0.025, 0.025]], Math.max(RING, 10)),
    wing([0.02, -0.38, 0.13, -0.5, 0.02, -0.52, 0.02, -0.38, 0.06, -0.42, 0.13, -0.5], 0.0, 0.62),
    wing([0.1, 0.2, 0.3, 0.06, 0.26, 0.02, 0.1, 0.2, 0.26, 0.02, 0.1, 0.1], -0.08, 0.62),
  ]);
  // A turtle: a shell, a head, and four flippers, the front pair long.
  const turtle = join([
    loft([[0.34, 0.02, -0.02, 0.06], [0.24, 0.1, -0.05, 0.2], [0.0, 0.14, -0.06, 0.27], [-0.25, 0.09, -0.05, 0.2], [-0.4, 0.02, -0.02, 0.05]], Math.max(RING, 10)),
    loft([[0.52, 0.01, -0.01, 0.015], [0.47, 0.045, -0.04, 0.045], [0.38, 0.05, -0.045, 0.05], [0.3, 0.03, -0.03, 0.035]], Math.min(RING, 8)),
    wing([0.2, 0.24, 0.62, 0.02, 0.5, -0.06, 0.2, 0.24, 0.5, -0.06, 0.2, 0.12], -0.02, 0.75),
    wing([0.14, -0.28, 0.3, -0.46, 0.1, -0.4], -0.02, 0.75),
  ]);
  return {
    bass: { geometry: bass, half: 0.14, eye: [0.38, 0.045, 0.02], wig: [0.14, 0], most: 120 },
    big: { geometry: bass.clone(), half: 0.14, eye: [0.39, 0.05, 0.014], wig: [0.08, 0], most: 10 },
    jack: { geometry: jack, half: 0.105, eye: [0.39, 0.02, 0.018], wig: [0.14, 0], most: 80 },
    needle: { geometry: needle, half: 0.045, eye: [0.42, 0.018, 0.012], wig: [0.1, 0], most: 16 },
    disc: { geometry: disc, half: 0.23, eye: [0.36, 0.06, 0.028], wig: [0.12, 0], most: 60 },
    mola: { geometry: mola, half: 0.4, eye: [0.4, 0.08, 0.02], wig: [0.02, 0], most: 3 },
    lion: { geometry: lion, half: 0.15, eye: [0.38, 0.04, 0.022], wig: [0.04, 0.05], most: 24 },
    flat: { geometry: flat, half: 0.03, eye: [0.36, 0.03, 0.0], wig: [0, 0.08], most: 12 },
    ray: { geometry: ray, half: 0.05, eye: [0.3, 0.05, 0.0], wig: [0, 0.3], most: 8 },
    shark: { geometry: shark, half: 0.07, eye: [0.41, 0.02, 0.01], wig: [0.12, 0], most: 8 },
    eel: { geometry: eel, half: 0.03, eye: [0.45, 0.012, 0.008], wig: [0.05, 0], most: 8 },
    seal: { geometry: seal, half: 0.13, eye: [0.44, 0.04, 0.014], wig: [0.02, 0.1], most: 6 },
    turtle: { geometry: turtle, half: 0.1, eye: [0.45, 0.02, 0.012], wig: [0, 0.22], most: 6 },
  };
}

/** A thin rod from `a` to `b` (each [x, y, z]), tapering from `r0` to `r1`, painted one colour. */
function rod(a: [number, number, number], b: [number, number, number], r0: number, r1: number, c: [number, number, number], sides = 5): THREE.BufferGeometry {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(a[0], a[1], a[2]);
  return paint(g, ...c);
}

/**
 * A spiny lobster one unit long from the horns to the tail fan, facing +Z: a spiny carapace, a tail in overlapping
 * segments ending in a fan, five pairs of thin jointed legs, and two whip feelers longer than itself, thick at the root.
 */
function lobsterGeometry(): THREE.BufferGeometry {
  const shell: [number, number, number] = [0.62, 0.22, 0.09];
  const dark: [number, number, number] = [0.42, 0.13, 0.06];
  const leg: [number, number, number] = [0.85, 0.5, 0.2];
  const colour = (g: THREE.BufferGeometry, c: [number, number, number]) => { const a = g.getAttribute('aColor') as THREE.BufferAttribute; for (let i = 0; i < a.count; i++) a.setXYZ(i, ...c); return g; };
  const parts: THREE.BufferGeometry[] = [
    colour(loft([[0.44, 0.15, 0.09, 0.04], [0.38, 0.24, 0.06, 0.1], [0.26, 0.3, 0.04, 0.13], [0.1, 0.3, 0.04, 0.14], [0.0, 0.27, 0.05, 0.12]], 10, 1), shell),
  ];
  // The tail: six plates, each a little smaller, each overlapping the next.
  for (let i = 0; i < 6; i++) {
    const z = -0.02 - i * 0.065;
    const k = 1 - i * 0.07;
    parts.push(colour(loft([[z + 0.02, 0.25 * k, 0.06, 0.115 * k], [z - 0.045, 0.24 * k, 0.06, 0.11 * k], [z - 0.07, 0.2 * k, 0.07, 0.1 * k]], 8, 0), i % 2 ? dark : shell));
  }
  const fan = new THREE.CircleGeometry(0.17, 7, Math.PI + 0.5, Math.PI - 1.0);
  fan.rotateX(-Math.PI / 2);
  fan.translate(0, 0.09, -0.42);
  parts.push(paint(fan, 0.72, 0.32, 0.12));
  for (const side of [-1, 1]) {
    // The feelers sweep forward and out in a long bow, thick and spiny at the root.
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i <= 6; i++) { const u = i / 6; pts.push([side * (0.07 + 0.38 * u + 0.1 * u * u), 0.3 + 0.12 * u - 0.15 * u * u, 0.42 + 1.15 * u]); }
    for (let i = 0; i < 6; i++) parts.push(rod(pts[i], pts[i + 1], 0.03 * (1 - i / 6) + 0.004, 0.03 * (1 - (i + 1) / 6) + 0.003, i ? leg : shell, 5));
    // Horns over the eyes, and the eyes on their stalks.
    parts.push(rod([side * 0.05, 0.27, 0.36], [side * 0.08, 0.36, 0.46], 0.02, 0.004, shell, 4));
    parts.push(paint(new THREE.SphereGeometry(0.022, 6, 4).translate(side * 0.07, 0.29, 0.42), 0.03, 0.03, 0.03));
    // Five walking legs, each with a knee.
    for (let i = 0; i < 5; i++) {
      const z = 0.32 - i * 0.08;
      const knee: [number, number, number] = [side * 0.24, 0.12, z + 0.03 - i * 0.01];
      parts.push(rod([side * 0.1, 0.07, z], knee, 0.014, 0.011, leg, 4));
      parts.push(rod(knee, [side * 0.31, -0.01, z + 0.05 - i * 0.03], 0.011, 0.005, leg, 4));
    }
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

/** A rock scallop, a red urchin, a green abalone and a queen conch, each one unit across, lying on +Y. */
function handGeometry(kind: HandThing['spec']['kind']): THREE.BufferGeometry {
  if (kind === 'urchin') {
    const spikes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 22; i++) {
      const cone = new THREE.ConeGeometry(0.05, 0.55, 3, 1, true);
      cone.translate(0, 0.42, 0);
      cone.rotateX(0.2 + hash01(i, 270) * 1.5);
      cone.rotateY(hash01(i, 271) * 6.28);
      spikes.push(paint(cone, 1, 1, 1));
    }
    const body = new THREE.IcosahedronGeometry(0.3, 1);
    body.scale(1, 0.75, 1);
    spikes.push(paint(body, 0.85, 0.85, 0.85));
    return join(spikes);
  }
  if (kind === 'scallop') {
    // A lumpy crusted shell cemented flat, gaping a little, with the orange lip showing in the gape.
    const top = new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    top.scale(1, 0.32, 0.9);
    top.translate(0, 0.05, 0);
    const bottom = new THREE.CylinderGeometry(0.5, 0.48, 0.06, 10);
    bottom.scale(1, 1, 0.9);
    const lip = new THREE.TorusGeometry(0.46, 0.035, 4, 14);
    lip.rotateX(Math.PI / 2);
    lip.scale(1, 1, 0.9);
    lip.translate(0, 0.05, 0);
    return join([paint(top, 1, 1, 1), paint(bottom, 0.8, 0.8, 0.8), paint(lip, 2.2, 1.0, 0.25)]);
  }
  if (kind === 'abalone') {
    // An ear of a shell, a row of holes along one side, and the green fringe of the foot showing all round.
    const shell = new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    shell.scale(1, 0.3, 0.68);
    shell.translate(0, 0.04, 0);
    const fringe = new THREE.TorusGeometry(0.48, 0.05, 4, 14);
    fringe.rotateX(Math.PI / 2);
    fringe.scale(1, 1, 0.7);
    fringe.translate(0, 0.04, 0);
    const parts = [paint(shell, 1, 1, 1), paint(fringe, 0.5, 0.85, 0.35)];
    for (let i = 0; i < 5; i++) parts.push(paint(new THREE.SphereGeometry(0.035, 5, 3).translate(-0.3 + i * 0.12, 0.14, 0.22 - i * 0.015), 0.05, 0.05, 0.05));
    return join(parts);
  }
  // A conch: a spiral of knobbed whorls, and a flared lip, pink inside.
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const r = 0.32 * (1 - i * 0.17);
    const w = new THREE.SphereGeometry(r, 9, 5);
    w.scale(1, 0.75, 1.1);
    w.translate(0, 0.18 + i * 0.07, -0.1 - i * 0.12);
    parts.push(paint(w, 1, 1, 1));
  }
  const lipShape = new THREE.CircleGeometry(0.42, 8, -0.2, Math.PI * 0.9);
  lipShape.rotateY(Math.PI / 2);
  lipShape.translate(0.22, 0.18, 0.05);
  parts.push(paint(lipShape, 1.4, 0.75, 0.7));
  return join(parts);
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
  /** The swell overhead: the way it runs (scene x and z), its length in metres and its height. */
  swellX: number;
  swellZ: number;
  swellLength: number;
  swellHeight: number;
  /** What the water has carried the specks along by since last frame, metres, scene axes. */
  driftX: number;
  driftZ: number;
  /** The hulls overhead: scene x and z, heading, length and beam. */
  hulls: Array<{ x: number; z: number; heading: number; length: number; beam: number }>;
  /** The gun: whether the shaft is on it, how far through loading it is (1 loaded), and the kick of a shot just fired, 1 fading to 0. */
  loaded: boolean;
  loading: number;
  recoil: number;
  /** Her own gun in the mask's view, or not (the chase view draws the gun in her hand on the figure). */
  firstPerson: boolean;
  /** The bead on the muzzle: 2 a shot let go now would find it, 1 in range, 0 nothing. And whether to draw the faint line of the shot. */
  bead: number;
  aimLine: boolean;
  /** At night, how hard she is stirring the plankton, 0 to 1. */
  bio: number;
  /** The gun arm's sway with the kick, -1 to 1, and how hard she is hauling on a fish, 0 to 1. */
  sway: number;
  haul: number;
}

interface Shoal { mesh: THREE.InstancedMesh; tint: THREE.InstancedBufferAttribute; mark: THREE.InstancedBufferAttribute; n: number; most: number }
interface School { fish: Fish; mesh: THREE.Mesh; u: Record<string, THREE.IUniform>; beat: number; tight: number; spread: number }

const BUBBLES = 72;
const SILT = 96;

export class DiveScene {
  /** Everything here hangs off this. It is shown only while she is in the water. */
  readonly group = new THREE.Group();
  /** The gun and the hand that holds it, drawn with the eye. */
  readonly gun = new THREE.Group();
  readonly shaft: THREE.Mesh;
  /** Where the shaft would go, and the shaft's tip, scene coordinates: read after `update`. */
  readonly aimFrom = new THREE.Vector3();
  private readonly line: THREE.Line;
  private readonly floatLine: THREE.Line;
  private readonly aimLine: THREE.Line;
  private readonly bead: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly materials: THREE.Material[] = [];
  private readonly built = new THREE.Group();
  private readonly shoals = {} as Record<FishShape, Shoal>;
  /** Plainer bodies for the fish in a school: hundreds of them, small, and seen at a distance. */
  private readonly schoolForms: Record<FishShape, Form>;
  private schools: School[] = [];
  private readonly lobsterMesh: THREE.InstancedMesh;
  private readonly handMesh = {} as Record<HandThing['spec']['kind'], THREE.InstancedMesh>;
  private readonly surface: THREE.Mesh;
  private readonly backdrop: THREE.Mesh;
  private readonly rays: THREE.Mesh;
  private readonly specks: THREE.Points;
  private readonly bubbles: THREE.Points;
  private readonly bubbleAt: THREE.BufferAttribute;
  private readonly bubbleStart: THREE.BufferAttribute;
  private readonly bubbleRise = new Float32Array(BUBBLES);
  private nextBubble = 0;
  private readonly silts: THREE.Points;
  private readonly siltAt: THREE.BufferAttribute;
  private readonly siltBorn: THREE.BufferAttribute;
  private nextSilt = 0;
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
  /** Where each kelp plant stands, one to a growth cell, for the chase camera to keep out of. */
  private readonly kelp = new Map<number, [number, number]>();
  private hand: HandThing[] = [];
  private handSeen = -1;

  constructor(low: boolean) {
    this.low = low;
    RING = low ? 6 : 12;
    SMOOTH = low ? 0 : 1;
    this.group.name = 'dive';
    this.group.visible = false;
    this.uniforms = {
      uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uLight: { value: 1 }, uWater: { value: new THREE.Color(0.03, 0.2, 0.25) },
      uVis: { value: 18 }, uLamp: { value: 0 }, uLook: { value: new THREE.Vector3(0, 0, -1) }, uSway: { value: new THREE.Vector3(1, 0, 0.9) }, uCaustic: { value: 1 },
      uTropic: { value: 0 }, uSky: { value: new THREE.Color(0.6, 0.85, 0.9) }, uSwell: { value: new THREE.Vector4(1, 0, 0.1, 0.3) }, uBio: { value: 0 },
      uHull: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uHullSize: { value: [new THREE.Vector2(), new THREE.Vector2()] },
      uDrift: { value: new THREE.Vector3() }, uPixels: { value: 800 },
    };

    // The fish: one mesh for each kind of body, every fish of that body an instance of it, marked by the shader.
    // Schools are their own meshes, made when the reef is built.
    const all = forms();
    RING = low ? 4 : 6;
    SMOOTH = 0;
    this.schoolForms = forms();
    RING = low ? 6 : 12;
    SMOOTH = low ? 0 : 1;
    for (const shape of Object.keys(all) as FishShape[]) {
      const f = all[shape];
      const most = (low ? Math.max(6, Math.round(f.most * 0.6)) : f.most) + MAX_STRUNG;
      const geo = f.geometry.clone();
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(most * 3), 3);
      const mark = new THREE.InstancedBufferAttribute(new Float32Array(most * 3), 3);
      tint.setUsage(THREE.DynamicDrawUsage);
      mark.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aTint', tint);
      geo.setAttribute('aFish', mark);
      const material = this.material({ INST: '', FISH: '' }, THREE.DoubleSide, this.formUniforms(f));
      const mesh = new THREE.InstancedMesh(geo, material, most);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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

    // What is taken by hand: one mesh of each kind.
    for (const kind of ['scallop', 'urchin', 'abalone', 'conch'] as const) {
      const g = handGeometry(kind);
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(MAX_HAND * 3).fill(1), 3));
      const mesh = new THREE.InstancedMesh(g, this.material({ INST: '', HAND: '' }, THREE.DoubleSide), MAX_HAND);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.handMesh[kind] = mesh;
      this.group.add(mesh);
    }

    // The water itself, all round: bright overhead and toward the sun, dark below.
    const backMaterial = new THREE.ShaderMaterial({ vertexShader: backVertex, fragmentShader: backFragment, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false });
    this.materials.push(backMaterial);
    this.backdrop = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), backMaterial);
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -3;

    // The surface, from underneath: a sheet that rises and falls with the swell.
    const cells = low ? 24 : 56;
    const top = new THREE.PlaneGeometry(1, 1, cells, cells);
    top.rotateX(Math.PI / 2);
    const surfaceMaterial = new THREE.ShaderMaterial({ vertexShader: surfaceVertex, fragmentShader: surfaceFragment, uniforms: this.uniforms, side: THREE.DoubleSide });
    this.materials.push(surfaceMaterial);
    this.surface = new THREE.Mesh(top, surfaceMaterial);
    this.surface.frustumCulled = false;
    this.surface.renderOrder = -2;

    // Shafts of sunlight: fewer on low graphics. Broad and soft.
    const shafts = low ? 10 : 34;
    const rayGeo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    rayGeo.index = plane.index;
    rayGeo.setAttribute('position', plane.getAttribute('position'));
    rayGeo.setAttribute('uv', plane.getAttribute('uv'));
    const a = new Float32Array(shafts * 4);
    for (let i = 0; i < shafts; i++) { a[i * 4] = hash01(i, 1, 201) * 40; a[i * 4 + 1] = hash01(i, 2, 201) * 40; a[i * 4 + 2] = 1.4 + 3.4 * hash01(i, 3, 201); a[i * 4 + 3] = hash01(i, 4, 201); }
    rayGeo.setAttribute('aRay', new THREE.InstancedBufferAttribute(a, 4));
    rayGeo.instanceCount = shafts;
    const rayMaterial = new THREE.ShaderMaterial({ vertexShader: rayVertex, fragmentShader: rayFragment, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.materials.push(rayMaterial);
    this.rays = new THREE.Mesh(rayGeo, rayMaterial);
    this.rays.frustumCulled = false;
    this.rays.renderOrder = 3;

    // Specks adrift in the water: they are what tells her she is moving.
    const count = low ? 140 : 700;
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

    // Her bubbles: a small pool, each let go at her mouth and left to rise, swelling as it goes.
    const bubbleGeo = new THREE.BufferGeometry();
    this.bubbleAt = new THREE.BufferAttribute(new Float32Array(BUBBLES * 3).fill(9), 3);
    this.bubbleStart = new THREE.BufferAttribute(new Float32Array(BUBBLES), 1);
    const bubbleSize = new Float32Array(BUBBLES);
    for (let i = 0; i < BUBBLES; i++) bubbleSize[i] = 1.5 + 4 * hash01(i, 7, 202) ** 2;
    bubbleGeo.setAttribute('position', this.bubbleAt);
    bubbleGeo.setAttribute('aStart', this.bubbleStart);
    bubbleGeo.setAttribute('aSize', new THREE.BufferAttribute(bubbleSize, 1));
    const bubbleMaterial = new THREE.ShaderMaterial({ vertexShader: speckVertex, fragmentShader: speckFragment, uniforms: this.uniforms, defines: { BUBBLE: '' }, transparent: true, depthWrite: false });
    this.materials.push(bubbleMaterial);
    this.bubbles = new THREE.Points(bubbleGeo, bubbleMaterial);
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 5;

    // Silt: a cloud kicked up off the sand by a fin or a fish lifting off, billowing and settling. Moved by its shader.
    const siltGeo = new THREE.BufferGeometry();
    this.siltAt = new THREE.BufferAttribute(new Float32Array(SILT * 3).fill(9), 3);
    this.siltBorn = new THREE.BufferAttribute(new Float32Array(SILT).fill(-99), 1);
    const siltSize = new Float32Array(SILT);
    for (let i = 0; i < SILT; i++) siltSize[i] = 6 + 10 * hash01(i, 8, 202);
    siltGeo.setAttribute('position', this.siltAt);
    siltGeo.setAttribute('aBorn', this.siltBorn);
    siltGeo.setAttribute('aSize', new THREE.BufferAttribute(siltSize, 1));
    const siltMaterial = new THREE.ShaderMaterial({ vertexShader: speckVertex, fragmentShader: speckFragment, uniforms: this.uniforms, defines: { SILT: '' }, transparent: true, depthWrite: false });
    this.materials.push(siltMaterial);
    this.silts = new THREE.Points(siltGeo, siltMaterial);
    this.silts.frustumCulled = false;
    this.silts.renderOrder = 4;

    // The gun, in a gloved hand at the lower right of the mask: a slim barrel with a muzzle, the rubber bands
    // stretched back along it, the steel shaft lying on top with its barbed tip out in front, and a pistol grip.
    const steel: [number, number, number] = [0.8, 0.83, 0.86];
    const black: [number, number, number] = [0.06, 0.065, 0.07];
    const rubber: [number, number, number] = [0.7, 0.5, 0.22];
    const tube = (r0: number, r1: number, long: number, z: number, y: number, c: [number, number, number]): THREE.BufferGeometry => {
      const g = new THREE.CylinderGeometry(r1, r0, long, 10);
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
      part(new THREE.SphereGeometry(0.05, 12, 9), [0.07, 0.08, 0.1], 0.004, -0.07, -0.025),
      part(new THREE.CapsuleGeometry(0.022, 0.05, 3, 8), [0.09, 0.1, 0.12], 0, -0.045, -0.06, Math.PI / 2),
      part(new THREE.CapsuleGeometry(0.012, 0.04, 3, 6), [0.09, 0.1, 0.12], -0.03, -0.04, -0.035, Math.PI / 2, 0.5),
      part(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 12), [0.05, 0.06, 0.08], 0.03, -0.3, 0.12, -0.6, -0.1),
      part(new THREE.CylinderGeometry(0.043, 0.043, 0.03, 12), [0.1, 0.35, 0.55], 0.012, -0.14, 0.02, -0.6, -0.1),
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
    // The bead on the muzzle: it shows green when a shot let go now would find the fish, amber when it is in range.
    this.bead = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0x334044, toneMapped: false }));
    this.bead.position.set(0, 0.026, -0.84);
    for (const mesh of [stockMesh, this.gunShaft, this.gunBands, this.bead]) mesh.frustumCulled = false;
    this.gunBody.add(stockMesh, this.gunShaft, this.gunBands, this.bead);
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
    // The faint line of the shot, in the chase view.
    const aimGeo = new THREE.BufferGeometry();
    aimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.aimLine = new THREE.Line(aimGeo, new THREE.LineBasicMaterial({ color: 0xbff5ea, transparent: true, opacity: 0.28, depthWrite: false }));
    this.aimLine.frustumCulled = false;
    this.aimLine.renderOrder = 6;

    this.group.add(this.backdrop, this.built, this.lobsterMesh, this.surface, this.rays, this.specks, this.silts, this.bubbles, this.shaft, this.line, this.floatLine, this.aimLine, this.gun);
  }

  private formUniforms(f: Form): Record<string, THREE.IUniform> {
    return { uForm: { value: new THREE.Vector4(f.half, f.eye[0], f.eye[1], f.eye[2]) }, uWig: { value: new THREE.Vector2(f.wig[0], f.wig[1]) } };
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
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };

  /** True when a kelp stalk stands within `r` metres of a point (sim x, y): for the chase camera. */
  kelpNear(x: number, y: number, r: number): boolean {
    const gx = Math.floor(x / GROWTH_CELL);
    const gy = Math.floor(y / GROWTH_CELL);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const p = this.kelp.get((gx + i) * 100003 + gy + j);
      if (p && Math.hypot(p[0] - x, p[1] - y) < r) return true;
    }
    return false;
  }

  private clearBuilt(): void {
    for (const o of [...this.built.children]) {
      this.built.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !Array.isArray(m)) { m.dispose(); const i = this.materials.indexOf(m); if (i >= 0) this.materials.splice(i, 1); }
    }
    for (const s of this.schools) {
      this.group.remove(s.mesh);
      (s.mesh.material as THREE.Material).dispose();
      const i = this.materials.indexOf(s.mesh.material as THREE.Material);
      if (i >= 0) this.materials.splice(i, 1);
    }
    this.schools = [];
    this.kelp.clear();
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
   * Build the bottom round a point: the floor, a beach where it runs up to a shore, the ledges and boulder piles,
   * a hole for each lobster and each moray, what grows on the rock, what is to be taken by hand, and the schools.
   * @param cx sim x of the middle, and `cy` sim y
   * @param tropic true for pale coral sand, false for the grey-gold sand of a cold coast
   * @param surge the way the water is going, compass radians: the kelp's canopy lies along it
   */
  build(ground: Ground, cx: number, cy: number, lobsters: Lobster[], tropic: boolean, surge = 0, fish: Fish[] = [], hand: HandThing[] = []): void {
    this.clearBuilt();
    this.uniforms.uTropic.value = tropic ? 1 : 0;
    const low = this.low;
    const n = low ? 41 : 93;
    const step = (RADIUS * 2) / (n - 1);
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const rock = new Float32Array(n * n);
    const raw = new Float32Array(n * n);
    const sand = tropic ? [0.95, 0.93, 0.9] : [0.66, 0.6, 0.47];
    const stone = tropic ? [0.44, 0.39, 0.33] : [0.27, 0.25, 0.21];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) raw[j * n + i] = ground.floor(cx - RADIUS + i * step, cy - RADIUS + j * step);
    // How far each point is from the water's edge, metres: out of the water for the beach to rise, in it for the
    // shallows to shelve. Worked out across the grid by two passes of a chamfer.
    const shore = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) shore[k] = 1e6;
    let anyLand = false;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const wet = raw[k] > 0;
      if (!wet) anyLand = true;
      // A point next to one of the other kind is on the edge.
      const edge = (i > 0 && (raw[k - 1] > 0) !== wet) || (j > 0 && (raw[k - n] > 0) !== wet) || (i < n - 1 && (raw[k + 1] > 0) !== wet) || (j < n - 1 && (raw[k + n] > 0) !== wet);
      if (edge) shore[k] = 0;
    }
    if (anyLand) {
      const d1 = step;
      const d2 = step * Math.SQRT2;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (i > 0) shore[k] = Math.min(shore[k], shore[k - 1] + d1);
        if (j > 0) shore[k] = Math.min(shore[k], shore[k - n] + d1);
        if (i > 0 && j > 0) shore[k] = Math.min(shore[k], shore[k - n - 1] + d2);
        if (i < n - 1 && j > 0) shore[k] = Math.min(shore[k], shore[k - n + 1] + d2);
      }
      for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
        const k = j * n + i;
        if (i < n - 1) shore[k] = Math.min(shore[k], shore[k + 1] + d1);
        if (j < n - 1) shore[k] = Math.min(shore[k], shore[k + n] + d1);
        if (i < n - 1 && j < n - 1) shore[k] = Math.min(shore[k], shore[k + n + 1] + d2);
        if (i > 0 && j < n - 1) shore[k] = Math.min(shore[k], shore[k + n - 1] + d2);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = cx - RADIUS + i * step;
        const y = cy - RADIUS + j * step;
        const k3 = (j * n + i) * 3;
        const k = j * n + i;
        const d = raw[k];
        const r = ground.rock(x, y);
        // Rock stands in steps and shelves; sand lies smooth between, a little hollowed where a channel runs.
        const shelf = r > 0.5 ? 0.35 * (noise2(x / 1.9, y / 1.9, 250) > 0.5 ? 1 : 0) + 0.25 * noise2(x / 0.9, y / 0.9, 251) : -0.12 * (1 - r);
        // The outermost row is drawn far out at its own depth, a skirt, so the built ground has no edge to see in the haze.
        const rim = i === 0 || j === 0 || i === n - 1 || j === n - 1;
        const far = rim ? 4 : 1;
        // Near a shore the bottom shelves up as a beach, one in eight, and on out of the water: no flat slab at the edge.
        const beach = 0.12 + shore[k] / 8;
        const y3 = d > 0 ? -Math.min(Math.max(0.12, Math.min(d - (rim ? 0 : shelf), beach)), 40) : Math.min(3.5, 0.08 + shore[k] / 6);
        pos[k3] = cx + (x - cx) * far; pos[k3 + 1] = y3; pos[k3 + 2] = -(cy + (y - cy) * far);
        rock[k] = d > 0 ? r : Math.min(r, 0.3);
        const fleck = 0.88 + 0.24 * hash01(i, j, 203);
        // A pale halo of sand lies round the foot of a reef, where the grazers keep it clean; wet sand at the
        // water's edge is darker.
        const halo = tropic && r > 0.08 && r < 0.5 ? 1.08 : 1;
        const wetSand = d > 0 ? 1 : 0.8 + 0.2 * Math.min(1, shore[k] / 4);
        for (let c = 0; c < 3; c++) col[k3 + c] = (sand[c] * (1 - rock[k]) * halo + stone[c] * rock[k]) * fleck * wetSand;
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

    const morays = fish.filter((f) => f.species.shape === 'eel');
    const clearOfHoles = (x: number, y: number, by: number) => !lobsters.some((l) => Math.hypot(l.x - x, l.y - y) < by) && !morays.some((f) => Math.hypot(f.hx - x, f.hy - y) < by + 0.6);
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
      if (hash01(gx, gy, 205) > (low ? 0.25 : 0.6) || ground.rock(x, y) < 0.55 || !clearOfHoles(x, y, 2.6)) return;
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
    // A hole: a roof it sits under, a wall behind and a stone each side, and the dark at the back.
    const hole = (x: number, y: number, d: number, heading: number, k: number): void => {
      const fx = Math.sin(heading);
      const fy = Math.cos(heading);
      const turn = -heading;
      stones.push({ x: x - fx * 0.3 * k, y: y - fy * 0.3 * k, d: d - 0.5 * k, sx: 0.95 * k, sy: 0.13 * k, sz: 0.62 * k, turn, lean: 0.05, c: shade(0.95) });
      stones.push({ x: x - fx * 0.95 * k, y: y - fy * 0.95 * k, d: d - 0.25 * k, sx: 1.05 * k, sy: 0.6 * k, sz: 0.4 * k, turn, c: shade(0.8) });
      stones.push({ x: x - fx * 0.72 * k, y: y - fy * 0.72 * k, d: d - 0.14 * k, sx: 0.8 * k, sy: 0.3 * k, sz: 0.2 * k, turn, c: [0.012, 0.012, 0.016] });
      for (const side of [-1, 1]) stones.push({ x: x - fx * 0.35 * k + fy * 0.8 * k * side, y: y - fy * 0.35 * k - fx * 0.8 * k * side, d: d - 0.12 * k, sx: 0.36 * k, sy: 0.42 * k, sz: 0.62 * k, turn, c: shade(0.85) });
    };
    for (const l of lobsters) {
      l.d = this.floorAt(l.x, l.y) - 0.02;
      hole(l.x, l.y, l.d, l.heading, 1);
    }
    // A moray's hole is a bigger one, its head and neck out of the mouth, the rest of it back in the rock.
    for (const f of morays) {
      f.hd = f.d = this.floorAt(f.hx, f.hy) - 0.12;
      hole(f.hx, f.hy, f.d + 0.1, f.heading, 1.35);
    }
    if (stones.length) {
      const rawStone = new THREE.IcosahedronGeometry(1, low ? 0 : 1);
      rawStone.deleteAttribute('uv');
      rawStone.deleteAttribute('normal');
      const g = mergeVertices(rawStone);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const k = 0.8 + 0.32 * hash01(Math.round(p.getX(i) * 50), Math.round(p.getY(i) * 50), Math.round(p.getZ(i) * 50), 213) + 0.1 * noise2(p.getX(i) * 3 + p.getZ(i), p.getY(i) * 3, 214);
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      g.computeVertexNormals();
      paint(g, 1, 1, 1);
      this.scatter(g, { ROCK: '' }, stones, (r) => { this.put(r.x, r.y, r.d, r.turn, r.sx, r.sy, r.sz, r.lean ?? 0); return r.c; });
    }

    // Sea stars and small urchins on the rock: small things to find.
    if (!low) {
      const small: Array<{ x: number; y: number; star: boolean; h: number }> = [];
      cells(1.9, (gx, gy, x, y) => {
        const h = hash01(gx, gy, 240);
        if (h < 0.14 && ground.rock(x, y) > 0.55 && this.floorAt(x, y) > 1) small.push({ x, y, star: h < 0.08, h: hash01(gx, gy, 243) });
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
      this.scatter(handGeometry('urchin'), {}, small.filter((q) => !q.star), (q) => {
        this.put(q.x, q.y, this.floorAt(q.x, q.y) - 0.03, q.h * 30, 0.08 + 0.06 * q.h);
        return tropic ? [0.06, 0.05, 0.06] : [0.34, 0.14, 0.44];
      }, THREE.DoubleSide);
    }

    // What grows: one plant to a cell where the rules say so, in stands with clearings between.
    const plants: Array<{ x: number; y: number; d: number; h: number }> = [];
    const thin = low ? 0.45 : 1;
    for (let gy = Math.floor((cy - RADIUS) / GROWTH_CELL); gy <= (cy + RADIUS) / GROWTH_CELL; gy++) {
      for (let gx = Math.floor((cx - RADIUS) / GROWTH_CELL); gx <= (cx + RADIUS) / GROWTH_CELL; gx++) {
        const x = (gx + 0.5) * GROWTH_CELL;
        const y = (gy + 0.5) * GROWTH_CELL;
        if (Math.hypot(x - cx, y - cy) > RADIUS - 1 || !ground.grows(x, y) || hash01(gx, gy, 214) > thin || !clearOfHoles(x, y, 1.8)) continue;
        if (ground.cover === 'kelp' && noise2(x / 9, y / 9, 272) < 0.36) continue;
        const px = x + (hash01(gx, gy, 215) - 0.5) * GROWTH_CELL * 0.7;
        const py = y + (hash01(gx, gy, 216) - 0.5) * GROWTH_CELL * 0.7;
        plants.push({ x: px, y: py, d: this.floorAt(px, py), h: hash01(gx, gy, 217) });
        if (ground.cover === 'kelp') this.kelp.set(Math.floor(px / GROWTH_CELL) * 100003 + Math.floor(py / GROWTH_CELL), [px, py]);
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
        if (d > 0.4 && d < 6.5 && ground.rock(x, y) > 0.5 && hash01(gx, gy, 273) < 0.55 && clearOfHoles(x, y, 1.2)) tufts.push({ x, y, h: hash01(gx, gy, 274) });
      });
      const blades: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const b = new THREE.PlaneGeometry(0.035, 1, 1, 3);
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
    this.placeHand(hand);
    this.makeSchools(fish);
  }

  /** Lay out what is to be taken by hand, each kind in its own mesh. */
  private placeHand(list: HandThing[]): void {
    this.hand = list;
    for (const kind of Object.keys(this.handMesh) as Array<keyof typeof this.handMesh>) {
      const mesh = this.handMesh[kind];
      const tint = mesh.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute;
      let k = 0;
      for (const t of list) {
        if (t.spec.kind !== kind || k >= MAX_HAND) continue;
        t.d = this.floorAt(t.x, t.y) - 0.02;
        const size = t.cm / 100;
        this.e.set(0.15 * Math.sin(t.heading * 3), -t.heading, 0.1 * Math.cos(t.heading * 5));
        this.m.compose(this.v.set(t.x, -t.d, -t.y), this.q.setFromEuler(this.e), this.s.setScalar(t.mode === 'there' ? size : 0.0001));
        mesh.setMatrixAt(k, this.m);
        this.colour.set(t.spec.colour);
        tint.setXYZ(k, this.colour.r, this.colour.g, this.colour.b);
        k++;
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      tint.needsUpdate = true;
    }
    this.handSeen = list.filter((t) => t.mode === 'there').length;
  }

  /** Hand targets taken since they were laid out are taken out of the picture: only when one has gone. */
  drawHand(): void {
    let there = 0;
    for (const t of this.hand) if (t.mode === 'there') there++;
    if (there !== this.handSeen) this.placeHand(this.hand);
  }

  /** One mesh for each school, each fish in it placed by the vertex shader from the leader (see `diveFlock.ts`). */
  private makeSchools(fish: Fish[]): void {
    for (const f of fish) {
      if (f.count <= 1) continue;
      const form = this.schoolForms[f.species.shape] ?? this.schoolForms.jack;
      const n = this.low ? Math.ceil(f.count * 0.4) : f.count;
      const src = form.geometry;
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = src.index;
      for (const name of ['position', 'normal', 'aColor']) geo.setAttribute(name, src.getAttribute(name));
      const slots = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) { slots[k * 4] = hash01(f.index, k, 231); slots[k * 4 + 1] = hash01(f.index, k, 232); slots[k * 4 + 2] = hash01(f.index, k, 233); slots[k * 4 + 3] = hash01(f.index, k, 234); }
      geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 4));
      geo.instanceCount = n;
      this.colour.set(f.species.colour);
      const u: Record<string, THREE.IUniform> = {
        ...this.formUniforms(form),
        uLead: { value: new THREE.Vector4() }, uShape: { value: new THREE.Vector4() }, uThreat: { value: new THREE.Vector4() },
        uBeat: { value: new THREE.Vector2(0, PATTERNS[f.species.pattern ?? 'plain'] ?? 0) }, uTintS: { value: new THREE.Vector3(this.colour.r, this.colour.g, this.colour.b) },
      };
      const mesh = new THREE.Mesh(geo, this.material({ FISH: '', SCHOOL: '' }, THREE.DoubleSide, u));
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.schools.push({ fish: f, mesh, u, beat: 0, tight: 0, spread: 0.4 * Math.cbrt(f.count) * (f.species.bait ? 1.05 : 1) });
    }
  }

  /**
   * Giant kelp. Each plant is a holdfast on the rock and a stipe going up, hung with blades. Most reach the top
   * and spread along it the way the water is going, in a canopy the light comes through; some are young and stop
   * part of the way up.
   */
  private plantKelp(plants: Array<{ x: number; y: number; d: number; h: number }>, surge: number): void {
    const tall = (p: { d: number; h: number }) => (p.h < 0.3 ? Math.max(2, Math.floor(p.d * (0.35 + p.h * 1.6))) : Math.ceil(p.d));
    const pieces: Array<{ p: { x: number; y: number; d: number; h: number }; k: number }> = [];
    // On low graphics a plant is drawn in two-metre pieces.
    const every = this.low ? 2 : 1;
    for (const p of plants) for (let k = 0; k < tall(p); k += every) pieces.push({ p, k });
    if (!pieces.length) return;
    const geo = kelpGeometry(3, this.low ? 2 : 6, !this.low);
    const up = new Float32Array(pieces.length);
    this.scatter(geo, { KELP: '', FADE: '' }, pieces, ({ p, k }, i) => {
      // The blades are bigger and thicker toward the top, where the light is.
      const grow = 0.75 + 0.5 * (k / Math.max(1, p.d));
      this.put(p.x, p.y, p.d - k, p.h * 6.28 + k * 1.1, grow, every, grow);
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

  /** One fish into the mesh for its body. */
  private readonly tints = new Map<string, THREE.Color>();
  private readonly putFish = (f: Fish, x: number, y: number, z: number, heading: number, pitch: number, roll: number, beat: number, amp: number): void => {
    const s = this.shoals[f.species.shape] ?? this.shoals.bass;
    if (s.n >= s.most) return;
    const len = (f.cm / 100) * (f.species.shape === 'big' ? 1.25 : 1);
    this.e.set(pitch, Math.PI - heading, roll);
    this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e), this.s.setScalar(len));
    s.mesh.setMatrixAt(s.n, this.m);
    // Colours are read from their hex once, and kept.
    const hex = colourOf(f);
    let c = this.tints.get(hex);
    if (!c) this.tints.set(hex, (c = new THREE.Color(hex)));
    s.tint.setXYZ(s.n, c.r, c.g, c.b);
    s.mark.setXYZ(s.n, patternOf(f), beat, amp);
    s.n++;
  };

  /**
   * Put every fish where it is, swimming: its body wave as quick and wide as it is going, banked into its turns,
   * a seal rolled over in its corkscrew. A school is one draw: only its leader is written here, and every fish in it
   * is placed by the vertex shader, which draws the school into a tight milling ball when a hunter works it and opens
   * a hole round her when she swims into it. Fish on her stringer hang under the float.
   * @param eye where she is, scene coordinates
   */
  drawFish(fish: Fish[], t: number, dt: number, held: Fish | null, heldAt: THREE.Vector3 | null, eye: THREE.Vector3, strung: { at: THREE.Vector3; list: ReadonlyArray<{ fish?: Fish; onFloat: boolean }> } | null): void {
    for (const shape in this.shoals) this.shoals[shape as FishShape].n = 0;
    const put = this.putFish;
    for (const f of fish) {
      if (f.mode === 'gone' || f.count > 1) continue;
      const len = Math.max(0.08, f.cm / 100);
      if (f === held && heldAt) {
        // On the shaft: thrashing.
        (f as Fish & { beat?: number }).beat = ((f as Fish & { beat?: number }).beat ?? 0) + dt * 6.283 * 5;
        put(f, heldAt.x, heldAt.y, heldAt.z, f.heading, 0.2, 0.5 + 0.4 * Math.sin(t * 9), (f as Fish & { beat?: number }).beat!, 1.6);
        continue;
      }
      if (f.mode === 'held') continue;
      const speed = Math.hypot(f.vx, f.vy, f.vd);
      // The tail beats about once for each body length and a bit it goes; never quite still.
      const freq = Math.min(6, Math.max(0.6, speed / (0.8 * len)));
      const ff = f as Fish & { beat?: number };
      ff.beat = ((ff.beat ?? f.phase) + dt * 6.283 * freq) % 1000;
      const amp = Math.min(1.6, Math.max(0.3, 0.35 + (0.6 * speed) / (1.2 * len)));
      const resting = (f.species.rests || f.species.habitat === 'sand') && f.mode === 'cruise' && f.species.flight !== 'glide';
      if (f.species.shape === 'eel') {
        // A moray is a head and a neck out of a hole, mouth working: the rest of it is back in the rock.
        const fx = Math.sin(f.heading);
        const fy = Math.cos(f.heading);
        put(f, f.hx - fx * len * 0.32, -f.d + 0.16, -(f.hy - fy * len * 0.32), f.heading, 0.42 + 0.08 * Math.sin(t * 0.7 + f.phase), 0, ff.beat * 0.15, 0.3);
        continue;
      }
      const bank = Math.max(-0.6, Math.min(0.6, (f.turn ?? 0) * 0.35));
      put(f, f.x, -f.d, -f.y, f.heading, resting ? 0 : -Math.max(-0.7, Math.min(0.7, f.vd / Math.max(0.2, speed))) * 0.7, bank + (f.roll ?? 0), resting ? ff.beat * 0.1 : ff.beat, resting ? 0.15 : amp);
    }
    // Her catch, hanging head down under the float on its stringer.
    if (strung) {
      let k = 0;
      for (const c of strung.list) {
        if (!c.onFloat || !c.fish) continue;
        put(c.fish, strung.at.x + 0.12 * Math.sin(k * 2.1 + t * 0.5), strung.at.y - 0.45 - k * 0.32, strung.at.z + 0.12 * Math.cos(k * 1.7), c.fish.heading + k, -1.45, 0.1 * Math.sin(t + k), t * 2 + k, 0.2);
        if (++k >= MAX_STRUNG) break;
      }
    }
    for (const shape in this.shoals) {
      const s = this.shoals[shape as FishShape];
      s.mesh.count = s.n;
      if (!s.n) continue;
      s.mesh.instanceMatrix.clearUpdateRanges();
      s.mesh.instanceMatrix.addUpdateRange(0, s.n * 16);
      s.mesh.instanceMatrix.needsUpdate = true;
      s.tint.clearUpdateRanges();
      s.tint.addUpdateRange(0, s.n * 3);
      s.tint.needsUpdate = true;
      s.mark.clearUpdateRanges();
      s.mark.addUpdateRange(0, s.n * 3);
      s.mark.needsUpdate = true;
    }

    // The schools: the leader, how tight, how fast it is turning, and what it opens round.
    for (const sc of this.schools) {
      const f = sc.fish;
      sc.mesh.visible = f.mode !== 'gone';
      if (!sc.mesh.visible) continue;
      let hunter: Fish | null = null;
      for (const h of fish) {
        if (h === f || h.mode === 'gone' || h.mode === 'held' || h.count > 1) continue;
        if (!((h.species.strong && h.species.habitat === 'open') || h.species.flight === 'loop')) continue;
        if (Math.hypot(h.x - f.x, h.y - f.y, h.d - f.d) < 10) { hunter = h; break; }
      }
      const hunted = !!hunter && !!f.species.bait;
      sc.tight += ((hunted ? 1 : 0.15 * f.fear) - sc.tight) * Math.min(1, dt * 1.2);
      sc.beat = (sc.beat + dt * 6.283 * (2.2 + 2.5 * sc.tight + 2 * f.fear)) % 1000;
      (sc.u.uLead.value as THREE.Vector4).set(f.x, -f.d, -f.y, f.heading);
      (sc.u.uShape.value as THREE.Vector4).set(sc.spread * (1 - 0.3 * f.fear), sc.tight, f.turn ?? 0, f.cm / 100);
      if (hunter) (sc.u.uThreat.value as THREE.Vector4).set(hunter.x, -hunter.d, -hunter.y, 1.8);
      else (sc.u.uThreat.value as THREE.Vector4).set(eye.x, eye.y, eye.z, 1.6);
      (sc.u.uBeat.value as THREE.Vector2).x = sc.beat;
    }
  }

  /** Put every lobster where it is: in the mouth of its hole with its feelers out, back inside it, walking, or gone. */
  drawLobsters(list: Lobster[], t: number): void {
    const n = Math.min(MAX_LOBSTER, list.length);
    for (let i = 0; i < n; i++) {
      const l = list[i];
      // A carapace is about a third of the animal.
      const len = (l.mm / 1000) * 3.6;
      const back = l.mode !== 'there' ? 1.2 : l.deep ? 0.5 : l.out ? -0.7 : 0.05 + 0.5 * (l.back ?? 0);
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

  /** The faint line of where a shot would go, from the muzzle out to the end of the shaft's reach. */
  drawAim(from: THREE.Vector3, dir: THREE.Vector3, long: number, show: boolean): void {
    this.aimLine.visible = show;
    if (!show) return;
    const p = this.aimLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    p.setXYZ(0, from.x, from.y, from.z);
    p.setXYZ(1, from.x + dir.x * long, from.y + dir.y * long, from.z + dir.z * long);
    p.needsUpdate = true;
  }

  /** The line from the diver up to her float. */
  drawFloatLine(from: THREE.Vector3, to: THREE.Vector3): void {
    const p = this.floatLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    p.setXYZ(0, from.x, from.y, from.z);
    p.setXYZ(1, to.x, to.y, to.z);
    p.needsUpdate = true;
  }

  /** Let go a few bubbles at a place, scene coordinates. They rise by themselves, swelling as they go. */
  bubble(x: number, y: number, z: number, count: number): void {
    for (let k = 0; k < count; k++) {
      const i = this.nextBubble = (this.nextBubble + 1) % BUBBLES;
      this.bubbleAt.setXYZ(i, x + (hash01(i, k, 290) - 0.5) * 0.25, y - 0.1 * hash01(i, k, 291), z + (hash01(i, k, 292) - 0.5) * 0.25);
      this.bubbleStart.setX(i, Math.max(0, -y));
      this.bubbleRise[i] = 0.35 + 0.4 * hash01(i, k, 293);
    }
    this.bubbleAt.needsUpdate = true;
    this.bubbleStart.needsUpdate = true;
  }

  /** A cloud of silt off the bottom at a place, scene coordinates: `count` puffs of it. */
  silt(x: number, y: number, z: number, count: number, time: number, spread = 0.5): void {
    for (let k = 0; k < count; k++) {
      const i = this.nextSilt = (this.nextSilt + 1) % SILT;
      this.siltAt.setXYZ(i, x + (hash01(i, k, 295) - 0.5) * spread * 2, y + 0.05 + 0.15 * hash01(i, k, 296), z + (hash01(i, k, 297) - 0.5) * spread * 2);
      this.siltBorn.setX(i, time - 0.3 * hash01(i, k, 298));
    }
    this.siltAt.needsUpdate = true;
    this.siltBorn.needsUpdate = true;
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
    u.uBio.value = look.bio;
    camera.getWorldDirection(u.uLook.value as THREE.Vector3);
    (u.uSway.value as THREE.Vector3).set(look.surgeX, look.surgeZ, (Math.PI * 2) / Math.max(3, look.surgePeriod));
    const k = (Math.PI * 2) / Math.max(4, look.swellLength);
    const sl = Math.hypot(look.swellX, look.swellZ) || 1;
    (u.uSwell.value as THREE.Vector4).set(look.swellX / sl, look.swellZ / sl, k, Math.min(1.6, look.swellHeight));
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
    this.backdrop.position.copy(camera.position);
    this.backdrop.scale.setScalar(camera.far * 0.9);

    // Bubbles rise, wobbling, and are gone at the top.
    const at = this.bubbleAt;
    let any = false;
    for (let i = 0; i < BUBBLES; i++) {
      if (this.bubbleRise[i] <= 0) continue;
      any = true;
      const y = at.getY(i) + this.bubbleRise[i] * look.dt;
      // The higher a bubble gets, the bigger it is, the faster it goes and the more it wobbles.
      this.bubbleRise[i] = Math.min(1.1, this.bubbleRise[i] + look.dt * 0.05);
      if (y > -0.04) { this.bubbleRise[i] = 0; at.setXYZ(i, 0, 9, 0); continue; }
      const wob = 0.12 + 0.12 * this.bubbleRise[i];
      at.setXYZ(i, at.getX(i) + Math.sin(look.time * 5 + i) * wob * look.dt, y, at.getZ(i) + Math.cos(look.time * 4 + i * 2) * wob * look.dt);
    }
    if (any) at.needsUpdate = true;

    // The gun rides with the mask, swaying with the kick. A shot kicks it back and up; the bands are off it until
    // it is loaded again; hauling on a fish pulls it in and down.
    this.gun.visible = look.firstPerson;
    this.gun.position.copy(camera.position);
    this.gun.quaternion.copy(camera.quaternion);
    const kick = look.recoil * look.recoil;
    this.gunBody.position.set(0.19 + 0.012 * look.sway, -0.17 + 0.012 * Math.sin(look.time * 1.3) + 0.03 * kick - 0.05 * look.haul, -0.42 + 0.09 * kick + 0.12 * look.haul);
    this.gunBody.rotation.set(0.05 + 0.16 * kick + 0.25 * (1 - look.loading) * (look.loaded ? 0 : 1) - 0.2 * look.haul, 0.1 + 0.03 * look.sway, 0.02 * Math.sin(look.time * 0.9) + 0.05 * look.sway);
    this.gunShaft.visible = look.loaded;
    this.gunBands.visible = look.loaded;
    (this.bead.material as THREE.MeshBasicMaterial).color.setRGB(look.bead >= 2 ? 0.3 : look.bead >= 1 ? 1 : 0.16, look.bead >= 2 ? 1 : look.bead >= 1 ? 0.7 : 0.2, look.bead >= 2 ? 0.45 : look.bead >= 1 ? 0.15 : 0.22);
    this.bead.visible = look.loaded;
    this.aimLine.visible = look.aimLine;
    (this.aimLine.material as THREE.LineBasicMaterial).color.setRGB(look.bead >= 2 ? 0.5 : 0.75, 1, look.bead >= 2 ? 0.6 : 0.92);
  }

  /** The kelp, rock and surface the scene draws: counted for the budget. */
  stats(): { triangles: number; draws: number } {
    let triangles = 0;
    let draws = 0;
    this.group.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry as THREE.BufferGeometry & { instanceCount?: number };
      const per = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const n = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : g.instanceCount ?? 1;
      if (!n) return;
      triangles += per * (Number.isFinite(n) ? n : 1);
      draws++;
    });
    return { triangles: Math.round(triangles), draws };
  }

  dispose(): void {
    this.clearBuilt();
    this.group.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.materials) m.dispose();
    (this.line.material as THREE.Material).dispose();
    (this.floatLine.material as THREE.Material).dispose();
    (this.aimLine.material as THREE.Material).dispose();
    (this.bead.material as THREE.Material).dispose();
  }
}
