import * as THREE from 'three';
import type { CourseData, ReplayWorld } from '@slack-tide/world';

/**
 * What the sea's shader is told about the course it lies on: the wind over the whole water at this moment, and how
 * deep the water is. Both go to the graphics card as small byte textures, so nothing here needs float textures.
 *
 * The wind is the point. The world's gusts are a known function of place, time and the hourly wind (`gustyWind` in
 * packages/world), so the shader can work out the very same gusts for every bit of water it draws, and darken the
 * water where the sim will find more wind. For that it needs the hourly wind at each point exactly as the world
 * interpolates it: a hundredth of a knot out and, hours into the season, the dark patch is drawn in the wrong place.
 * Hence 24 bits a component, and `puffAt` below, which is the shader's sum written in TypeScript so a test can hold
 * it against the world.
 */

/** Wind components are stored as whole steps of this many metres a second, offset so they are never negative. */
const RANGE = 80;
const STEPS = 16777215;
/** Gust speeds are stored in 16 bits over this many metres a second. */
const GUST_RANGE = 80;

/**
 * How hard it puffs where the hourly wind is `speed` and the record's gust speed is `gust`: the world's own rule
 * (see `gustyWind`). 1 makes the strongest puff 17% over the mean.
 */
export function gustiness(speed: number, gust: number): number {
  const factor = speed > 0.5 ? (gust < 0 ? 1.3 : gust / speed) : 1;
  return Math.min(2.6, Math.max(0.5, (factor - 1) / 0.17));
}

export interface WindGrid {
  x0: number; y0: number; dx: number; nx: number; ny: number;
  /** Metres a second toward east and north at each node, and the gust speed there. */
  u: Float64Array; v: Float64Array; gust: Float64Array;
}

/** The hourly wind at every node of the course's grid for a moment in the season, with the boost applied. */
export function windNodes(course: CourseData, seasonSeconds: number, boost: number, out?: WindGrid): WindGrid {
  const w = course.wind;
  const n = w.nx * w.ny;
  const grid = out ?? { x0: w.x0, y0: w.y0, dx: w.dx, nx: w.nx, ny: w.ny, u: new Float64Array(n), v: new Float64Array(n), gust: new Float64Array(n) };
  const steps = w.truth;
  const pos = Math.min(steps.length - 1, Math.max(0, seasonSeconds / course.season.stepSeconds));
  const k = Math.min(steps.length - 2, Math.floor(pos));
  const ft = pos - k;
  const a = steps[k];
  const b = steps[k + 1];
  for (let i = 0; i < n; i++) {
    const u = (a.u[i] * (1 - ft) + b.u[i] * ft) * w.scale * boost;
    const v = (a.v[i] * (1 - ft) + b.v[i] * ft) * w.scale * boost;
    grid.u[i] = u;
    grid.v[i] = v;
    // Where the record has no gust speed the world takes 1.3 times the mean wind. A negative value says so.
    grid.gust[i] = a.g && b.g ? (a.g[i] * (1 - ft) + b.g[i] * ft) * w.scale * boost : -1;
  }
  return grid;
}

/** The grid's wind at a point, interpolated the way the world does it. */
export function windAt(g: WindGrid, x: number, y: number): { u: number; v: number; gust: number } {
  const gx = Math.min(g.nx - 1.001, Math.max(0, (x - g.x0) / g.dx));
  const gy = Math.min(g.ny - 1.001, Math.max(0, (y - g.y0) / g.dx));
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const fx = gx - i;
  const fy = gy - j;
  const r0 = j * g.nx + i;
  const r1 = r0 + g.nx;
  const mix = (a: ArrayLike<number>) => (a[r0] * (1 - fx) + a[r0 + 1] * fx) * (1 - fy) + (a[r1] * (1 - fx) + a[r1 + 1] * fx) * fy;
  return { u: mix(g.u), v: mix(g.v), gust: mix(g.gust) };
}

/**
 * How much more or less wind than the hourly value there is at a point, as a share of it: +0.2 is a gust a fifth
 * stronger. The same sum as the sea's fragment shader, and the same pattern as `ReplayWorld.gustyWind`.
 * @param u wind toward east, m/s
 * @param v wind toward north, m/s
 * @param gust the record's gust speed here, m/s
 */
export function puffAt(u: number, v: number, gust: number, x: number, y: number, seasonSeconds: number): number {
  const speed = Math.hypot(u, v);
  const dx = u / Math.max(speed, 0.05);
  const dy = v / Math.max(speed, 0.05);
  const along = x * dx + y * dy - speed * 0.7 * seasonSeconds;
  const across = x * dy - y * dx;
  const puff = 0.085 * Math.sin(along / 310 + across / 520) + 0.055 * Math.sin(along / 127 - across / 210 + 1.7) + 0.03 * Math.sin(seasonSeconds / 9.3 + along / 60);
  return puff * gustiness(speed, gust);
}

/** The textures and the numbers that go with them, for one course. */
export class SeaField {
  readonly windU: THREE.DataTexture;
  readonly windV: THREE.DataTexture;
  readonly depth: THREE.DataTexture;
  /** x0, y0 and node spacing of the wind grid; its size in nodes. */
  readonly windGrid = new THREE.Vector3();
  readonly windSize = new THREE.Vector2();
  /** x0, y0, cell size and metres per byte of the depth grid; its size in cells. */
  readonly depthGrid = new THREE.Vector4();
  readonly depthSize = new THREE.Vector2();
  /** Seconds into the season, and the height of tide, at the last update. */
  season = 0;
  tide = 0;
  private nodes: WindGrid | null = null;
  private course: CourseData | null = null;

  constructor() {
    const tex = (w: number, h: number, format: THREE.PixelFormat, filter: THREE.MagnificationTextureFilter) => {
      const t = new THREE.DataTexture(new Uint8Array(w * h * (format === THREE.RedFormat ? 1 : 4)), w, h, format, THREE.UnsignedByteType);
      t.magFilter = filter;
      t.minFilter = filter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      // Rows of bytes that are not a multiple of four long.
      t.unpackAlignment = 1;
      t.needsUpdate = true;
      return t;
    };
    this.windU = tex(2, 2, THREE.RGBAFormat, THREE.NearestFilter);
    this.windV = tex(2, 2, THREE.RGBAFormat, THREE.NearestFilter);
    this.depth = tex(2, 2, THREE.RedFormat, THREE.LinearFilter);
  }

  /** Take up a course: its wind grid and its depths. The textures keep their identity, so the shader's uniforms stay put. */
  setCourse(course: CourseData, depth: Uint8Array): void {
    this.course = course;
    this.nodes = null;
    const w = course.wind;
    for (const t of [this.windU, this.windV]) {
      t.image = { data: new Uint8Array(w.nx * w.ny * 4), width: w.nx, height: w.ny };
      t.dispose();
    }
    this.windGrid.set(w.x0, w.y0, w.dx);
    this.windSize.set(w.nx, w.ny);
    const d = course.depth;
    this.depth.image = { data: depth, width: d.nx, height: d.ny };
    this.depth.dispose();
    this.depth.needsUpdate = true;
    this.depthGrid.set(d.x0, d.y0, d.dx, d.scale * 255);
    this.depthSize.set(d.nx, d.ny);
  }

  /** Bring the wind up to a moment. Cheap: a few hundred nodes. */
  update(world: ReplayWorld, t: number): void {
    const course = this.course;
    if (!course) return;
    this.season = world.seasonTime(t);
    this.tide = world.tide(t);
    const g = (this.nodes = windNodes(course, this.season, world.windBoost, this.nodes ?? undefined));
    const du = this.windU.image.data as Uint8Array;
    const dv = this.windV.image.data as Uint8Array;
    for (let i = 0; i < g.u.length; i++) {
      const nu = Math.round(((Math.max(-RANGE / 2, Math.min(RANGE / 2, g.u[i])) + RANGE / 2) / RANGE) * STEPS);
      const nv = Math.round(((Math.max(-RANGE / 2, Math.min(RANGE / 2, g.v[i])) + RANGE / 2) / RANGE) * STEPS);
      const o = i * 4;
      du[o] = nu & 255; du[o + 1] = (nu >> 8) & 255; du[o + 2] = (nu >> 16) & 255;
      // The gust speed rides in the two alphas. All ones means the record has none.
      const ng = g.gust[i] < 0 ? 65535 : Math.min(65534, Math.round((g.gust[i] / GUST_RANGE) * 65534));
      du[o + 3] = ng & 255;
      dv[o] = nv & 255; dv[o + 1] = (nv >> 8) & 255; dv[o + 2] = (nv >> 16) & 255; dv[o + 3] = ng >> 8;
    }
    this.windU.needsUpdate = true;
    this.windV.needsUpdate = true;
  }
}

/**
 * GLSL that reads the wind textures above. `vec3 airAt(vec2 eastNorth)` gives u, v and the gust speed in m/s
 * (for the vertex shader: it is cheap there and the wind changes slowly over the water). `float gustiness(speed, gust)`
 * is the rule above.
 */
export const AIR_GLSL = /* glsl */ `
  uniform sampler2D uWindU;
  uniform sampler2D uWindV;
  uniform vec3 uWindGrid;
  uniform vec2 uWindSize;
  vec3 airNode(vec2 ij) {
    vec2 uv = (ij + 0.5) / uWindSize;
    vec4 a = floor(texture2D(uWindU, uv) * 255.0 + 0.5);
    vec4 b = floor(texture2D(uWindV, uv) * 255.0 + 0.5);
    float u = (a.r + a.g * 256.0 + a.b * 65536.0) * (${RANGE}.0 / ${STEPS}.0) - ${RANGE / 2}.0;
    float v = (b.r + b.g * 256.0 + b.b * 65536.0) * (${RANGE}.0 / ${STEPS}.0) - ${RANGE / 2}.0;
    float n = a.a + b.a * 256.0;
    return vec3(u, v, n > 65534.5 ? 1.3 * length(vec2(u, v)) : n * (${GUST_RANGE}.0 / 65534.0));
  }
  vec3 airAt(vec2 p) {
    vec2 g = clamp((p - uWindGrid.xy) / uWindGrid.z, vec2(0.0), uWindSize - 1.001);
    vec2 i = floor(g);
    vec2 f = g - i;
    return mix(mix(airNode(i), airNode(i + vec2(1.0, 0.0)), f.x), mix(airNode(i + vec2(0.0, 1.0)), airNode(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

export const GUSTINESS_GLSL = /* glsl */ `
  float gustiness(float speed, float gust) {
    float factor = speed > 0.5 ? gust / speed : 1.0;
    return clamp((factor - 1.0) / 0.17, 0.5, 2.6);
  }
`;
