import * as THREE from 'three';

/**
 * Navigation lights for everything afloat, as the collision regulations have them: red to port and green to
 * starboard, each shown from right ahead to a little abaft the beam; a white sternlight over the arc the sidelights
 * leave dark; a white masthead light over the sidelights' arc on a vessel under power; one all-round white at anchor.
 *
 * Each light is a point that the graphics card shows or hides by where the eye is in relation to the vessel's
 * heading. So at night you see of another vessel exactly what you would see at sea, and can tell which way she is
 * going: red alone, she is crossing right to left; red and green together, she is coming straight at you.
 *
 * One pool for all of them, rewritten each frame from the vessels' positions: a few dozen points.
 */

const POOL = 320;
const D2R = Math.PI / 180;

/** Sectors, as the middle of the arc (clockwise from right ahead) and half its width. */
const SIDE = 56.25 * D2R;
const STERN_HALF = 67.5 * D2R;
const MAST_HALF = 112.5 * D2R;

const RED: [number, number, number] = [1, 0.1, 0.07];
const GREEN: [number, number, number] = [0.1, 1, 0.42];
const WHITE: [number, number, number] = [1, 0.93, 0.78];

const vertex = /* glsl */ `
  attribute vec4 aAim;   // unit vector along her heading (x, z), middle of the arc, half its width
  attribute vec4 aTint;  // colour, and brightness
  uniform float uNight;
  uniform float uScale;  // pixels a metre covers at one metre off
  uniform float uSee;    // how far you can see, metres
  varying vec4 vTint;
  void main() {
    vec3 toEye = cameraPosition - position;
    float dist = length(toEye);
    vec2 v = toEye.xz / max(length(toEye.xz), 1e-3);
    float rel = atan(dot(v, vec2(-aAim.y, aAim.x)), dot(v, aAim.xy));
    float off = abs(atan(sin(rel - aAim.z), cos(rel - aAim.z)));
    float shown = 1.0 - smoothstep(aAim.w - 0.035, aAim.w + 0.035, off);
    // A light is seen a long way: it does not shrink to nothing with distance as the hull does. Fog puts it out.
    float bright = aTint.a * shown * uNight * exp(-1.6 * dist / uSee) * clamp(1.5 - dist / 9000.0, 0.3, 1.0);
    vTint = vec4(aTint.rgb, bright);
    vec4 mv = viewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = bright < 0.01 ? 0.0 : clamp(0.5 * uScale / max(-mv.z, 1.0), 3.0, 26.0) * (0.75 + 0.5 * aTint.a);
  }
`;

const fragment = /* glsl */ `
  varying vec4 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    // A hard bright middle and a soft glow round it.
    float a = (1.0 - smoothstep(0.0, 0.32, d)) + 0.45 * pow(max(1.0 - d, 0.0), 2.0);
    a *= vTint.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(vTint.rgb, vec3(1.0), (1.0 - smoothstep(0.0, 0.22, d)) * 0.6) * a * 1.6, 1.0);
    #include <colorspace_fragment>
  }
`;

/** What she is doing, as far as her lights go. */
export type LightsFor = 'sail' | 'power' | 'ship' | 'anchor';

export class NavLights {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(POOL * 3);
  private readonly aim = new Float32Array(POOL * 4);
  private readonly tint = new Float32Array(POOL * 4);
  private readonly attrs: THREE.BufferAttribute[];
  private readonly uniforms = { uNight: { value: 0 }, uScale: { value: 600 }, uSee: { value: 30000 } };
  private count = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.attrs = [new THREE.BufferAttribute(this.pos, 3), new THREE.BufferAttribute(this.aim, 4), new THREE.BufferAttribute(this.tint, 4)];
    for (const a of this.attrs) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attrs[0]);
    g.setAttribute('aAim', this.attrs[1]);
    g.setAttribute('aTint', this.attrs[2]);
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.points.name = 'nav_lights';
    this.points.renderOrder = 4;
    this.points.visible = false;
  }

  /** True when it is dark enough for lights: nothing need be written otherwise. */
  get lit(): boolean {
    return this.uniforms.uNight.value > 0.01;
  }

  /** Start a frame's lights. */
  begin(night: number, camera: THREE.PerspectiveCamera, pixelsHigh: number, see: number): void {
    this.count = 0;
    this.uniforms.uNight.value = night;
    this.uniforms.uScale.value = camera.projectionMatrix.elements[5] * pixelsHigh * 0.5;
    this.uniforms.uSee.value = see;
  }

  private add(x: number, y: number, z: number, fx: number, fz: number, mid: number, half: number, c: readonly [number, number, number], bright: number): void {
    if (this.count >= POOL) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.aim[i * 4] = fx; this.aim[i * 4 + 1] = fz; this.aim[i * 4 + 2] = mid; this.aim[i * 4 + 3] = half;
    this.tint[i * 4] = c[0]; this.tint[i * 4 + 1] = c[1]; this.tint[i * 4 + 2] = c[2]; this.tint[i * 4 + 3] = bright;
  }

  /**
   * The lights of one vessel. Scene coordinates.
   * @param y height of her waterline now
   * @param mast height of her masthead above the water, for the lights carried there
   */
  vessel(x: number, y: number, z: number, heading: number, length: number, beam: number, mast: number, what: LightsFor): void {
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const sx = -fz;
    const sz = fx;
    if (what === 'anchor') {
      this.add(x, y + mast, z, fx, fz, 0, 4, WHITE, 1);
      return;
    }
    const big = what === 'ship' ? 1.5 : what === 'power' ? 1.2 : 1;
    const bow = length * 0.44;
    const deck = what === 'ship' ? length * 0.055 + 3 : what === 'power' ? 3.2 : 1.5;
    const side = beam * (what === 'sail' ? 0.22 : 0.45);
    // On a yacht the sidelights are on the pulpit. On a ship they are on the bridge wings, well aft.
    const at = what === 'ship' ? -length * 0.3 : what === 'power' ? length * 0.2 : bow;
    this.add(x + fx * at + sx * side, y + deck, z + fz * at + sz * side, fx, fz, SIDE, SIDE, GREEN, big);
    this.add(x + fx * at - sx * side, y + deck, z + fz * at - sz * side, fx, fz, -SIDE, SIDE, RED, big);
    this.add(x - fx * length * 0.49, y + deck * 0.9, z - fz * length * 0.49, fx, fz, Math.PI, STERN_HALF, WHITE, big);
    if (what === 'power') this.add(x + fx * length * 0.15, y + mast, z + fz * length * 0.15, fx, fz, 0, MAST_HALF, WHITE, 1.3);
    if (what === 'ship') {
      // Two masthead lights, the after one higher: their line shows her heading from miles off.
      this.add(x + fx * length * 0.42, y + mast * 0.7, z + fz * length * 0.42, fx, fz, 0, MAST_HALF, WHITE, 1.6);
      this.add(x - fx * length * 0.3, y + mast, z - fz * length * 0.3, fx, fz, 0, MAST_HALF, WHITE, 1.6);
    }
  }

  /** A flashing buoy light, seen all round. `on` is 0 or 1 this instant. */
  buoy(x: number, y: number, z: number, red: boolean, on: number): void {
    if (on > 0) this.add(x, y, z, 1, 0, 0, 4, red ? RED : GREEN, 0.9 * on);
  }

  end(): void {
    this.points.visible = this.lit && this.count > 0;
    this.points.geometry.setDrawRange(0, this.count);
    if (this.points.visible) for (const a of this.attrs) a.needsUpdate = true;
  }
}
