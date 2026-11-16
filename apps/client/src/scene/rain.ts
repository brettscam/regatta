import * as THREE from 'three';
import type { Squall } from './weatherRules';

/**
 * Rain. Close to: streaks falling through a box of air that travels with the eye, slanted by the wind. Far off:
 * each squall is a grey curtain hanging from a dark cloud, which is how a sailor sees one coming from windward.
 * The streaks are moved by the graphics card from the clock alone, so a frame costs nothing but the drawing.
 */

const DROPS = 1500;
const BOX = 44;

const dropVertex = /* glsl */ `
  attribute vec3 aSeed;
  attribute float aTail;
  uniform vec3 uFall;  // metres a second: down, and off with the wind
  uniform vec3 uGone;  // how far the rain has fallen since the start, wrapped into the box
  uniform float uRain;
  varying float vAlpha;
  void main() {
    // Each drop keeps its own place in the world, wrapped into the box round the eye.
    vec3 p = mod(aSeed * ${BOX}.0 + uGone - cameraPosition, ${BOX}.0) - ${BOX / 2}.0;
    float near = length(p);
    p += cameraPosition - uFall * (aTail * 0.045);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = uRain * (1.0 - aTail * 0.7) * smoothstep(0.6, 3.0, near) * (1.0 - smoothstep(${(BOX * 0.36).toFixed(2)}, ${(BOX * 0.5).toFixed(2)}, near));
  }
`;

const dropFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha * 0.5);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const curtainVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const curtainFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uTime;
  uniform vec2 uLean;
  varying vec3 vLocal;
  varying vec3 vWorld;
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  void main() {
    float h = vLocal.y; // 0 at the sea, 1 at the cloud
    float round_ = atan(vLocal.z, vLocal.x);
    // Shafts of heavier rain, slanting the way the wind carries them.
    float shaft = hash(vec2(floor(round_ * 40.0 + h * 5.0), 1.0)) * 0.5 + hash(vec2(floor(round_ * 13.0 + h * 2.0), 7.0)) * 0.5;
    float a = (0.34 + 0.4 * shaft) * smoothstep(0.0, 0.06, h) * mix(0.75, 1.0, h);
    // Seen from far off it is a wall. From close under it, it thins so the boat is not sailing into a painted cylinder.
    float dist = length(vWorld.xz - cameraPosition.xz);
    a *= uStrength * smoothstep(120.0, 900.0, dist);
    gl_FragColor = vec4(uColor * mix(1.0, 0.72, h), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The cloud over a squall: a flattened mound, solid where you look into it and melting to nothing at its rim,
// as the fog mounds are drawn, so it has no hard edge against the sky.
const capVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vUp;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNormal = normalMatrix * normal;
    vUp = position.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const capFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vUp;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float a = smoothstep(0.05, 0.6, facing);
    a *= a * uOpacity;
    // Darkest underneath, a little lighter up its sides.
    gl_FragColor = vec4(uColor * mix(0.85, 1.25, smoothstep(-0.6, 0.8, vUp)), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CELLS = 2;
const TOP = 1500;

export class Rain {
  readonly group = new THREE.Group();
  /** How many streaks to draw at the heaviest: fewer on the low graphics level. */
  detail = 1;
  private readonly drops: THREE.LineSegments;
  private readonly dropUniforms = { uTime: { value: 0 }, uFall: { value: new THREE.Vector3(0, -9, 0) }, uGone: { value: new THREE.Vector3() }, uRain: { value: 0 }, uColor: { value: new THREE.Color(0.7, 0.75, 0.8) } };
  private last = 0;
  private readonly curtains: Array<{ wall: THREE.Mesh; cap: THREE.Mesh; uniforms: { uColor: { value: THREE.Color }; uStrength: { value: number }; uTime: { value: number }; uLean: { value: THREE.Vector2 } } }> = [];
  private readonly capUniforms = { uColor: { value: new THREE.Color(0.2, 0.22, 0.25) }, uOpacity: { value: 0 } };
  private readonly capMaterial = new THREE.ShaderMaterial({ vertexShader: capVertex, fragmentShader: capFragment, uniforms: this.capUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide });

  constructor() {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const seeds = new Float32Array(DROPS * 2 * 3);
    const tail = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const x = rnd();
      const y = rnd();
      const z = rnd();
      seeds.set([x, y, z, x, y, z], i * 6);
      tail[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    g.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));
    this.drops = new THREE.LineSegments(g, new THREE.ShaderMaterial({ vertexShader: dropVertex, fragmentShader: dropFragment, uniforms: this.dropUniforms, transparent: true, depthWrite: false }));
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 6;
    this.drops.visible = false;
    this.group.add(this.drops);

    const wall = new THREE.CylinderGeometry(1, 0.92, 1, 40, 1, true).translate(0, 0.5, 0);
    const cap = new THREE.SphereGeometry(1, 28, 12);
    for (let i = 0; i < CELLS; i++) {
      const uniforms = { uColor: { value: new THREE.Color(0.3, 0.33, 0.36) }, uStrength: { value: 0 }, uTime: this.dropUniforms.uTime, uLean: { value: new THREE.Vector2() } };
      const w = new THREE.Mesh(wall, new THREE.ShaderMaterial({ vertexShader: curtainVertex, fragmentShader: curtainFragment, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      const c = new THREE.Mesh(cap, this.capMaterial);
      for (const m of [w, c]) {
        m.frustumCulled = false;
        m.visible = false;
        m.renderOrder = 2;
        this.group.add(m);
      }
      this.curtains.push({ wall: w, cap: c, uniforms });
    }
    this.group.name = 'rain';
  }

  /**
   * @param time sea time, seconds
   * @param rain how hard it is raining on the eye, 0 to 1
   * @param squalls the squalls on the water now (course metres, y north)
   * @param windX the wind at the viewer blowing toward (x, z), m/s
   * @param day 0 at night, 1 by day: rain and cloud take their light from it
   */
  update(time: number, rain: number, squalls: readonly Squall[], windX: number, windZ: number, day: number): void {
    const u = this.dropUniforms;
    u.uTime.value = time;
    u.uFall.value.set(windX * 0.55, -9.5, windZ * 0.55);
    // Kept wrapped here, in full precision, so the streaks do not judder late in a long sail.
    const dt = Math.min(1, Math.max(0, time - this.last));
    this.last = time;
    const g = u.uGone.value;
    g.set((g.x + u.uFall.value.x * dt) % BOX, (g.y + u.uFall.value.y * dt) % BOX, (g.z + u.uFall.value.z * dt) % BOX);
    u.uRain.value = rain;
    u.uColor.value.setRGB(0.72, 0.77, 0.82).multiplyScalar(0.12 + 0.88 * day);
    this.drops.visible = rain > 0.02;
    this.drops.geometry.setDrawRange(0, Math.round(DROPS * Math.min(1, 0.25 + rain) * this.detail) * 2);
    let caps = 0;
    for (let i = 0; i < CELLS; i++) {
      const c = this.curtains[i];
      const s = squalls[i];
      const on = !!s && s.strength > 0.03;
      c.wall.visible = c.cap.visible = on;
      if (!on) continue;
      const r = s.radius * 0.8;
      c.wall.position.set(s.x, 0, -s.y);
      c.wall.scale.set(r, TOP, r);
      c.cap.position.set(s.x, TOP * 1.02, -s.y);
      c.cap.scale.set(s.radius * 1.9, TOP * 0.2, s.radius * 1.9);
      c.uniforms.uStrength.value = s.strength;
      c.uniforms.uColor.value.setRGB(0.33, 0.36, 0.4).multiplyScalar(0.1 + 0.9 * day);
      caps = Math.max(caps, s.strength);
    }
    this.capUniforms.uOpacity.value = Math.min(0.95, caps * 1.15);
    this.capUniforms.uColor.value.setRGB(0.24, 0.26, 0.29).multiplyScalar(0.1 + 0.9 * day);
  }
}
