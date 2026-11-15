import * as THREE from 'three';

/** How far the lights of the shore have come on: 0 by day, 1 at night. The stage moves it with the sun. */
export const cityNight = { value: 0 };
const hooks: Array<(n: number) => void> = [];
/** Have something outside the building material follow the lights: bridge lamps, floodlights. */
export function onCityNight(fn: (n: number) => void): void {
  hooks.push(fn);
  fn(cityNight.value);
}
/** Forget the followers, when the land is rebuilt. */
export function clearCityNight(): void {
  hooks.length = 0;
}
/** Bring the lights of the shore up or down. */
export function setCityNight(n: number): void {
  if (Math.abs(n - cityNight.value) < 0.004) return;
  cityNight.value = n;
  for (const h of hooks) h(n);
}

/** What a wall is made of, as the shader draws it. */
export const WIN = {
  none: 0,
  /** Office floors: a grid of windows. */
  grid: 1,
  /** Modern glass: a dark band to every floor. */
  ribbon: 2,
  /** Vertical piers and bay windows. */
  fins: 3,
  /** Flats and houses: small windows well apart. */
  homes: 4,
  /** A long shed: one row of openings. */
  shed: 5,
  /** Lit from below at night. */
  floodlit: 8,
  /** A lamp: glows its own colour at night. */
  lamp: 9,
} as const;

type P3 = [number, number, number];

export interface Solid {
  /** Course position of the centre, metres east and north, and the height of the base. */
  x: number;
  y: number;
  base: number;
  h: number;
  /** Footprint along local x and y. */
  w: number;
  d?: number;
  /** Turn about the vertical, radians counter-clockwise from east. */
  turn?: number;
  /** 4 is a box. More is a round or oval tower. */
  sides?: number;
  /** Size of the top as a share of the base: 1 is straight, 0 a point. */
  top?: number;
  color: THREE.Color;
  roof?: THREE.Color;
  win?: number;
}

/**
 * Everything built on the shore, gathered into one mesh: one draw call however many buildings there are.
 * All positions are given in course coordinates (east, north, up) and turned into the scene's as they go in.
 * Each vertex carries where it is on its wall in metres and what the wall is made of, so the windows are drawn
 * by the material and cost no geometry.
 */
export class Massing {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly win: number[] = [];
  private seed = 0;
  /** Each building gets its own pattern of lit windows. */
  next(): void {
    this.seed = (this.seed * 0.618034 + 0.2137) % 1;
  }
  get triangles(): number {
    return this.pos.length / 9;
  }

  private vert(p: P3, n: P3, c: THREE.Color, u: number, v: number, kind: number): void {
    this.pos.push(p[0], p[2], -p[1]);
    this.nor.push(n[0], n[2], -n[1]);
    this.col.push(c.r, c.g, c.b);
    this.win.push(u, v, kind, this.seed);
  }

  /** A flat triangle. `inside` is any point behind the face: the winding is turned to face away from it. */
  tri(a: P3, b: P3, c: P3, color: THREE.Color, inside: P3, kind = 0, uv: number[] = [0, 0, 0, 0, 0, 0]): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    const out = nx * (a[0] - inside[0]) + ny * (a[1] - inside[1]) + nz * (a[2] - inside[2]);
    if (out < 0) {
      const n: P3 = [-nx, -ny, -nz];
      this.vert(a, n, color, uv[0], uv[1], kind);
      this.vert(c, n, color, uv[4], uv[5], kind);
      this.vert(b, n, color, uv[2], uv[3], kind);
    } else {
      const n: P3 = [nx, ny, nz];
      this.vert(a, n, color, uv[0], uv[1], kind);
      this.vert(b, n, color, uv[2], uv[3], kind);
      this.vert(c, n, color, uv[4], uv[5], kind);
    }
  }

  /** A flat face with corners a, b along the bottom and c, d back along the top. u runs a to b, v runs up. */
  quad(a: P3, b: P3, c: P3, d: P3, color: THREE.Color, inside: P3, kind = 0, u0 = 0, u1 = 0, v0 = 0, v1 = 0, u0t = u0, u1t = u1): void {
    this.tri(a, b, c, color, inside, kind, [u0, v0, u1, v0, u1t, v1]);
    this.tri(a, c, d, color, inside, kind, [u0, v0, u1t, v1, u0t, v1]);
  }

  /** A box, a tapered box, a pyramid, or a round tower, standing on its base. */
  solid(o: Solid): void {
    const d = o.d ?? o.w;
    const n = o.sides ?? 4;
    const top = o.top ?? 1;
    const cs = Math.cos(o.turn ?? 0);
    const sn = Math.sin(o.turn ?? 0);
    const ring = (scale: number, z: number): P3[] => {
      const out: P3[] = [];
      for (let k = 0; k < n; k++) {
        let lx: number;
        let ly: number;
        if (n === 4) {
          lx = (k === 0 || k === 3 ? -0.5 : 0.5) * o.w * scale;
          ly = (k < 2 ? -0.5 : 0.5) * d * scale;
        } else {
          const a = (k / n) * Math.PI * 2;
          lx = Math.cos(a) * o.w * 0.5 * scale;
          ly = Math.sin(a) * d * 0.5 * scale;
        }
        out.push([o.x + lx * cs - ly * sn, o.y + lx * sn + ly * cs, z]);
      }
      return out;
    };
    const lo = ring(1, o.base);
    const hi = ring(top, o.base + o.h);
    const inside: P3 = [o.x, o.y, o.base + o.h * 0.4];
    const kind = o.win ?? 0;
    let run = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const edge = Math.hypot(lo[j][0] - lo[k][0], lo[j][1] - lo[k][1]);
      const mid = run + edge / 2;
      this.quad(lo[k], lo[j], hi[j], hi[k], o.color, inside, kind, run, run + edge, 0, o.h, mid - (edge * top) / 2, mid + (edge * top) / 2);
      run += edge;
    }
    if (top > 0.02) {
      const roof = o.roof ?? o.color.clone().multiplyScalar(0.72);
      const c: P3 = [o.x, o.y, o.base + o.h];
      for (let k = 0; k < n; k++) this.tri(c, hi[k], hi[(k + 1) % n], roof, inside);
    }
  }

  /** A shape turned about the vertical: `profile` is a list of [radius, height above the base], bottom to top. */
  lathe(x: number, y: number, base: number, profile: Array<[number, number]>, sides: number, color: THREE.Color, kind = 0, squash = 1, turn = 0): void {
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    const at = (r: number, z: number, k: number): P3 => {
      const a = (k / sides) * Math.PI * 2;
      const lx = Math.cos(a) * r;
      const ly = Math.sin(a) * r * squash;
      return [x + lx * cs - ly * sn, y + lx * sn + ly * cs, base + z];
    };
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, z0] = profile[i];
      const [r1, z1] = profile[i + 1];
      const inside: P3 = [x, y, base + (z0 + z1) / 2 - (r0 > r1 ? 1 : -1) * Math.abs(r0 - r1)];
      const step = (Math.PI * 2 * Math.max(r0, r1)) / sides;
      for (let k = 0; k < sides; k++) {
        this.quad(at(r0, z0, k), at(r0, z0, k + 1), at(r1, z1, k + 1), at(r1, z1, k), color, inside, kind, k * step, (k + 1) * step, z0, z1);
      }
    }
    const [rt, zt] = profile[profile.length - 1];
    if (rt > 0.05) {
      const c: P3 = [x, y, base + zt];
      for (let k = 0; k < sides; k++) this.tri(c, at(rt, zt, k), at(rt, zt, k + 1), color.clone().multiplyScalar(0.75), [x, y, base + zt - 1]);
    }
  }

  /** A straight member between two points: `w` across (level), `t` deep. Bridge steel, masts, legs. */
  beam(a: P3, b: P3, w: number, t: number, color: THREE.Color, kind = 0): void {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    if (len < 1e-6) return;
    dir.multiplyScalar(1 / len);
    const side = new THREE.Vector3(0, 0, 1).cross(dir);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = dir.clone().cross(side).normalize();
    const corner = (p: P3, s: number, u: number): P3 => [p[0] + side.x * s * w * 0.5 + up.x * u * t * 0.5, p[1] + side.y * s * w * 0.5 + up.y * u * t * 0.5, p[2] + side.z * s * w * 0.5 + up.z * u * t * 0.5];
    const inside: P3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const order: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const [s0, u0] = order[k];
      const [s1, u1] = order[(k + 1) % 4];
      this.quad(corner(a, s0, u0), corner(a, s1, u1), corner(b, s1, u1), corner(b, s0, u0), color, inside, kind, 0, k % 2 ? t : w, 0, len);
    }
    this.quad(corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1), color, inside, kind);
    this.quad(corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1), color, inside, kind);
  }

  /** A pitched roof with its ridge along local x. */
  gable(x: number, y: number, base: number, w: number, d: number, h: number, turn: number, color: THREE.Color): void {
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    const at = (lx: number, ly: number, z: number): P3 => [x + lx * cs - ly * sn, y + lx * sn + ly * cs, base + z];
    const inside: P3 = [x, y, base + h * 0.2];
    const e = [at(-w / 2, -d / 2, 0), at(w / 2, -d / 2, 0), at(w / 2, d / 2, 0), at(-w / 2, d / 2, 0)];
    const r0 = at(-w / 2, 0, h);
    const r1 = at(w / 2, 0, h);
    this.quad(e[0], e[1], r1, r0, color, inside);
    this.quad(e[3], e[2], r1, r0, color.clone().multiplyScalar(0.9), inside);
    this.tri(e[0], e[3], r0, color, inside);
    this.tri(e[1], e[2], r1, color, inside);
  }

  /** Walls and a pitched roof together: a pier shed, a warehouse, a boathouse. */
  hall(x: number, y: number, base: number, w: number, d: number, wall: number, roof: number, turn: number, color: THREE.Color, roofColor: THREE.Color, win: number = WIN.none): void {
    this.solid({ x, y, base, w, d, h: wall, turn, color, win, roof: roofColor });
    this.gable(x, y, base + wall, w + 1, d + 1, roof, turn, roofColor);
  }

  /** The finished mesh. */
  build(name: string): THREE.Mesh {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geom.setAttribute('win', new THREE.Float32BufferAttribute(this.win, 4));
    const mesh = new THREE.Mesh(geom, cityMaterial());
    mesh.name = name;
    mesh.frustumCulled = false;
    return mesh;
  }
}

/**
 * The standard matt material, with windows. Where a wall has them the glass is darker than the wall by day,
 * and at night a share of the windows is lit. Far off, where a window is smaller than a pixel, the pattern
 * fades to its average so the skyline does not shimmer.
 */
export function cityMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, envMapIntensity: 0.8 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 win;\nvarying vec4 vWin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = win;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vWin;\nuniform float uNight;\nvec3 cityGlow;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        cityGlow = vec3(0.0);
        {
          float kind = floor(vWin.z + 0.5);
          if (kind > 0.5 && kind < 7.5) {
            vec2 cell = vec2(3.4, 3.9);
            vec2 lo = vec2(0.2, 0.28);
            vec2 hi = vec2(0.8, 0.86);
            if (kind > 4.5) { cell = vec2(9.0, 400.0); lo = vec2(0.3, 0.0); hi = vec2(0.7, 1.0); }
            else if (kind > 3.5) { cell = vec2(5.2, 3.3); lo = vec2(0.3, 0.3); hi = vec2(0.72, 0.78); }
            else if (kind > 2.5) { cell = vec2(3.1, 400.0); lo = vec2(0.28, 0.0); hi = vec2(0.86, 1.0); }
            else if (kind > 1.5) { cell = vec2(42.0, 3.9); lo = vec2(0.0, 0.26); hi = vec2(1.0, 0.9); }
            vec2 g = vWin.xy / cell;
            vec2 f = fract(g);
            vec2 id = floor(g);
            vec2 fw = fwidth(g);
            float fine = max(cell.x < 40.0 ? fw.x : 0.0, cell.y < 40.0 ? fw.y : 0.0);
            float sharp = 1.0 - smoothstep(0.3, 0.9, fine);
            vec2 e = max(fw, vec2(0.001));
            vec2 inside = smoothstep(lo - e, lo + e, f) * (1.0 - smoothstep(hi - e, hi + e, f));
            if (cell.x > 40.0) inside.x = 1.0;
            if (cell.y > 40.0) inside.y = 1.0;
            float glass = inside.x * inside.y;
            float mean = (hi.x - lo.x) * (hi.y - lo.y);
            float rnd = fract(sin(dot(id + vWin.w * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
            // Every pane takes the sky a little differently.
            float w = mix(mean, glass * (0.82 + 0.36 * rnd), sharp);
            diffuseColor.rgb *= mix(1.0, kind > 3.5 ? 0.7 : 0.46, w);
            float share = (kind > 3.5 ? 0.22 : 0.3) + 0.3 * fract(vWin.w * 7.31);
            float lit = step(1.0 - share, rnd);
            float glow = mix(mean * share, glass * lit, sharp);
            vec3 tint = mix(vec3(1.0, 0.8, 0.52), vec3(0.86, 0.93, 1.0), step(0.62, fract(rnd * 13.7 + vWin.w)) * sharp);
            cityGlow = tint * glow * uNight * 1.35;
            diffuseColor.rgb *= 1.0 - 0.35 * uNight;
          } else if (kind > 8.5) {
            cityGlow = diffuseColor.rgb * uNight * 2.6;
          } else if (kind > 7.5) {
            cityGlow = diffuseColor.rgb * uNight * 0.5;
          }
        }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cityGlow;');
  };
  return mat;
}
