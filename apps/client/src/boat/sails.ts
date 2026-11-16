import * as THREE from 'three';
import type { SloopGeometry } from './buildSloop';
import { CLOTHS, KITE_COLOURS, kiteColourAt, type ClothLook, type SailStyle } from './sailStyle';

const D2R = Math.PI / 180;

/** What the sim reports about one sail, plus where its clew or boom is. */
export interface SailShape {
  /** Signed angle of the boom or clew off the centreline, radians, positive to starboard. */
  angle: number;
  /** 0 drawing, 1 fully luffing. */
  luff: number;
  /** 0 flowing, 1 stalled. */
  stall: number;
  flogging: boolean;
  /** Which way the sail bellies: +1 to starboard, -1 to port, in between while it crosses. */
  belly: number;
  /** Apparent wind speed, m/s. Drives how hard a loose sail shakes. */
  aws: number;
  /** A jib held aback: 0 to 1. It fills hard the wrong way round. */
  backed?: number;
}

type SailKind = 'main' | 'jib';

const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const rgba = (n: number, a: number) => `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Sail textures are drawn once for each look and shared by every boat that wears it. */
const textures = new Map<string, THREE.CanvasTexture>();
function cached(key: string, draw: () => HTMLCanvasElement): THREE.CanvasTexture {
  let tex = textures.get(key);
  if (!tex) {
    tex = new THREE.CanvasTexture(draw());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    textures.set(key, tex);
  }
  return tex;
}

/**
 * Sailcloth drawn on a canvas. Across the canvas is luff to leech, up the canvas is foot to head.
 * Seams, draft stripes, battens and numbers on the main, a sun-cover strip and telltale windows on the furling jib.
 * White dacron is drawn exactly as the sails always were. The other cloths follow the same cut in their own colours,
 * and a laminate or a carbon sail shows the lines of its fibres.
 */
function sailTexture(kind: SailKind, mark: string, cloth: ClothLook, sailNo?: string): THREE.CanvasTexture {
  return cached(`${kind}|${mark}|${sailNo ?? ''}|${cloth.id}`, () => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 1024;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const plain = cloth.id === 'dacron';
    // Canvas y runs down, so height v on the sail is drawn at H * (1 - v).
    const Y = (v: number) => H * (1 - v);
    g.fillStyle = css(cloth.base);
    g.fillRect(0, 0, W, H);
    // Panels: each a hair different in tone, with a stitched seam between.
    const panels = kind === 'main' ? 15 : 13;
    for (let i = 0; i < panels; i++) {
      const y0 = Y((i + 1) / panels);
      g.fillStyle = i % 2 ? `rgba(255,255,255, ${plain ? 0.16 : 0.05})` : rgba(cloth.panel, plain ? 0.16 : 0.4);
      g.fillRect(0, y0, W, H / panels);
      g.strokeStyle = rgba(cloth.seam, cloth.build === 'crosscut' ? 0.42 : 0.25);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, y0 + 8);
      g.lineTo(W, y0 - 6);
      g.stroke();
    }
    if (cloth.build !== 'crosscut') {
      // Fibres laid along the loads: fans from the clew, the head and the tack. Fine and close on a laminate,
      // bolder on carbon, where they are what you see of the sail's shape.
      const bold = cloth.build === 'fibre';
      g.strokeStyle = rgba(cloth.seam, bold ? 0.5 : 0.28);
      g.lineWidth = bold ? 1.6 : 1;
      const fan = (x0: number, y0: number, to: (k: number) => [number, number], n: number) => {
        for (let i = 0; i <= n; i++) {
          const [x1, y1] = to(i / n);
          g.beginPath();
          g.moveTo(x0, y0);
          g.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * 0.06, (y0 + y1) / 2, x1, y1);
          g.stroke();
        }
      };
      fan(W, H, (k) => [0, H * (1 - k * 0.98)], bold ? 26 : 40);
      fan(W * 0.5, 0, (k) => [W * k, H], bold ? 16 : 26);
      fan(0, H, (k) => [W, H * (1 - k * 0.6)], bold ? 10 : 18);
    }
    // Draft stripes: bands across the sail that make its curve easy to read.
    g.strokeStyle = plain && kind === 'jib' ? '#1e3a66' : css(cloth.stripe);
    g.lineWidth = 5;
    for (const v of [0.26, 0.5, 0.74]) {
      g.beginPath();
      g.moveTo(W * 0.03, Y(v));
      g.lineTo(W * 0.97, Y(v));
      g.stroke();
    }
    if (kind === 'main') {
      // Full-length battens in their pockets.
      for (const v of [0.2, 0.38, 0.56, 0.72, 0.87]) {
        g.fillStyle = plain ? 'rgba(232, 228, 214, 1)' : css(cloth.panel);
        g.fillRect(0, Y(v) - 7, W, 14);
        g.strokeStyle = plain ? 'rgba(96, 100, 104, 0.6)' : rgba(cloth.seam, 0.7);
        g.lineWidth = 1.2;
        g.strokeRect(-2, Y(v) - 7, W + 4, 14);
      }
      // Reef points: two rows of patches.
      for (const v of [0.2, 0.38]) {
        for (let i = 1; i < 6; i++) {
          g.fillStyle = plain ? 'rgba(150, 152, 150, 0.7)' : rgba(cloth.seam, 0.8);
          g.fillRect((W * i) / 6 - 5, Y(v) + 16, 10, 12);
        }
      }
      // Sail number, one way round on each side as on a real sail, and a class mark near the head.
      g.fillStyle = css(cloth.ink);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const number = (v: number, flip: number) => {
        g.save();
        g.translate(W * 0.6, Y(v));
        g.scale(flip * 1.9, 1);
        g.font = '700 40px ui-sans-serif, "Helvetica Neue", Arial, sans-serif';
        g.fillText(`USA ${sailNo ? sailNo.replace(/[^0-9A-Za-z ]/g, '').slice(0, 5) : `${mark}${mark}`}`, 0, 0);
        g.restore();
      };
      number(0.655, 1);
      number(0.615, -1);
      g.save();
      g.translate(W * 0.6, Y(0.8));
      g.scale(2.4, 1);
      const badge = cloth.id === 'tanbark' ? css(cloth.ink) : '#b22a35';
      g.strokeStyle = badge;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 0, 15, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = badge;
      g.font = '700 17px ui-sans-serif, Arial, sans-serif';
      g.fillText(mark, 0, 1);
      g.restore();
      // Headboard and tabling.
      g.fillStyle = 'rgba(60, 64, 70, 0.75)';
      g.fillRect(0, Y(1), W, 12);
      g.fillStyle = plain ? 'rgba(190, 186, 172, 0.7)' : rgba(cloth.seam, 0.55);
      g.fillRect(W - 9, 0, 9, H);
      g.fillRect(0, H - 9, W, 9);
    } else {
      // Sun cover: a strip along the leech and foot that is all that shows when the sail is rolled away.
      g.fillStyle = css(sunCover(cloth));
      g.fillRect(W * 0.925, 0, W * 0.075, H);
      g.fillRect(0, Y(0.04), W, H * 0.04);
      // Clew and tack patches.
      g.fillStyle = plain ? 'rgba(205, 200, 186, 0.75)' : rgba(cloth.panel, 0.9);
      g.beginPath();
      g.moveTo(W * 0.925, Y(0.04));
      g.lineTo(W * 0.62, Y(0.04));
      g.lineTo(W * 0.925, Y(0.17));
      g.fill();
      if (!plain) {
        // Windows of clear film behind the telltales, so they can be read through a sail that is not white.
        for (const v of [0.28, 0.5, 0.72]) {
          const w = W * (0.1 + 0.1 * v);
          g.fillStyle = cloth.dark ? 'rgba(196, 208, 214, 0.5)' : 'rgba(236, 240, 240, 0.5)';
          g.fillRect(W * 0.16 - w * 0.25, Y(v) - 16, w, 32);
          g.strokeStyle = rgba(cloth.seam, 0.8);
          g.lineWidth = 1.5;
          g.strokeRect(W * 0.16 - w * 0.25, Y(v) - 16, w, 32);
        }
      }
    }
    // Luff tape.
    g.fillStyle = plain ? 'rgba(40, 60, 90, 0.55)' : rgba(cloth.seam, 0.7);
    g.fillRect(0, 0, 8, H);
    return c;
  });
}

/** The strip of cover cloth on a furling jib's leech: navy on a light sail, sand on a dark one so it still shows. */
export function sunCover(cloth: ClothLook): number {
  return cloth.dark ? 0xb9a37a : 0x1b2d4a;
}

/**
 * Spinnaker cloth: light nylon in the boat's colour, cut in panels that fan out from the three corners,
 * with a white band across the middle so the shape of the sail reads from a distance.
 */
function spinnakerTexture(colour: string): THREE.CanvasTexture {
  return cached(`kite|hull|${colour}`, () => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 1024;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const base = new THREE.Color(colour);
    const dark = `#${base.clone().multiplyScalar(0.72).getHexString()}`;
    g.fillStyle = `#${base.getHexString()}`;
    g.fillRect(0, 0, W, H);
    // A darker head and a white band below the shoulders.
    g.fillStyle = dark;
    g.fillRect(0, 0, W, H * 0.2);
    g.fillStyle = '#f3f1ea';
    g.fillRect(0, H * 0.42, W, H * 0.16);
    g.fillStyle = dark;
    g.fillRect(0, H * 0.9, W, H * 0.1);
    kiteSeams(g, W, H);
    return c;
  });
}

/** Seams and tapes of a spinnaker, over whatever colours are under them. */
function kiteSeams(g: CanvasRenderingContext2D, W: number, H: number): void {
  // Seams: across the middle, and fanning from the head and from the two lower corners.
  g.strokeStyle = 'rgba(20, 24, 30, 0.22)';
  g.lineWidth = 1.5;
  for (let i = 1; i < 8; i++) {
    g.beginPath();
    g.moveTo(W / 2, 0);
    g.lineTo((W * i) / 8, H * 0.42);
    g.stroke();
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo((W * i) / 8, H * 0.58);
    g.moveTo(W, H);
    g.lineTo((W * i) / 8, H * 0.58);
    g.stroke();
  }
  for (const y of [0.2, 0.42, 0.5, 0.58, 0.74, 0.9]) {
    g.beginPath();
    g.moveTo(0, H * y);
    g.lineTo(W, H * y);
    g.stroke();
  }
  // Tapes down the luff and the leech.
  g.fillStyle = 'rgba(245, 243, 236, 0.85)';
  g.fillRect(0, 0, 7, H);
  g.fillRect(W - 7, 0, 7, H);
}

/** How wide the flying spinnaker is at height v, as a share of its width at the foot. The designs are drawn to it. */
export const kiteGirth = (v: number): number => Math.min(1, 1.25 * Math.pow(Math.max(0, 1 - v), 0.6));

/** A spinnaker design in three colours, painted point by point so a disc is a disc on the sail and not on the canvas. */
function kiteTexture(pattern: string, colours: readonly [number, number, number]): THREE.CanvasTexture {
  return cached(`kite|${pattern}|${colours.join(',')}`, () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const img = g.createImageData(W, H);
    const rgb = colours.map((i) => KITE_COLOURS[i]?.hex ?? KITE_COLOURS[0].hex);
    // Four samples a pixel, so the edges of the shapes are soft and not stepped.
    const taps = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        let r = 0;
        let gr = 0;
        let b = 0;
        for (const [ox, oy] of taps) {
          const u = (px + ox) / W;
          const v = 1 - (py + oy) / H;
          const k = rgb[kiteColourAt(pattern, (u - 0.5) * kiteGirth(v), v, u)];
          r += (k >> 16) & 255;
          gr += (k >> 8) & 255;
          b += k & 255;
        }
        const o = (py * W + px) * 4;
        img.data[o] = r / 4;
        img.data[o + 1] = gr / 4;
        img.data[o + 2] = b / 4;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    kiteSeams(g, W, H);
    return c;
  });
}

/**
 * A small picture of a spinnaker design as it looks flying, for a chooser: the sail's outline filled with the design,
 * clear round it. `hull` is drawn in `colour`, the boat's own.
 */
export function kiteSwatch(kite: SailStyle['kite'], colour = '#d8402f', width = 72): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round(width * 1.35);
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  const img = g.createImageData(W, H);
  const own = new THREE.Color(colour);
  const plain = [own.getHex(THREE.SRGBColorSpace), 0xf3f1ea, own.clone().multiplyScalar(0.72).getHex(THREE.SRGBColorSpace)];
  const rgb = kite.pattern === 'hull' ? plain : kite.colours.map((i) => KITE_COLOURS[i]?.hex ?? KITE_COLOURS[0].hex);
  for (let py = 0; py < H; py++) {
    const v = 1 - (py + 0.5) / H;
    const girth = kiteGirth(v) * 0.96;
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) / W - 0.5;
      if (Math.abs(x) > girth / 2) continue;
      const u = x / girth + 0.5;
      // The plain one: a darker head and foot, and the white band.
      const k = kite.pattern === 'hull' ? rgb[v > 0.8 || v < 0.1 ? 2 : v > 0.42 && v < 0.58 ? 1 : 0] : rgb[kiteColourAt(kite.pattern, x, v, u)];
      const o = (py * W + px) * 4;
      img.data[o] = (k >> 16) & 255;
      img.data[o + 1] = (k >> 8) & 255;
      img.data[o + 2] = k & 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function makeSailMesh(nu: number, nv: number, map: THREE.CanvasTexture, glow: number): THREE.Mesh {
  const count = (nu + 1) * (nv + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const uv = new Float32Array(count * 2);
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    uv[(j * (nu + 1) + i) * 2] = i / nu;
    uv[(j * (nu + 1) + i) * 2 + 1] = j / nv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i;
    const b = a + nu + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  g.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({
    map, color: 0xffffff, roughness: 0.88, metalness: 0, side: THREE.DoubleSide,
    emissive: 0x6f6a5c, emissiveIntensity: 0.1,
  });
  // How much light the cloth lets through. Kept where `dress` can change it.
  const through = { value: glow };
  mat.userData.through = through;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uThrough = through;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uThrough;')
      // The curve of a sail is hard to see on evenly lit white cloth. Cloth that turns away from the eye is drawn
      // a little darker, so the belly reads from the helm whatever the sun is doing.
      .replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb *= 0.8 + 0.2 * abs(dot(normalize(vNormal), normalize(vViewPosition)));`)
      // Sailcloth lets light through. When the sun is behind the sail, the side you are looking at glows with it.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #if NUM_DIR_LIGHTS > 0
        float sailBacklight = max(dot(-normal, directionalLights[0].direction), 0.0);
        totalEmissiveRadiance += diffuseColor.rgb * directionalLights[0].color * (0.03 + 0.1 * sailBacklight) * uThrough;
      #endif`);
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Put a cloth on a white sail's material: its texture, how it glows and how it shines. */
function dress(mesh: THREE.Mesh, kind: SailKind, mark: string, cloth: ClothLook, sailNo?: string): void {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.map = sailTexture(kind, mark, cloth, sailNo);
  if (cloth.id === 'dacron') mat.emissive.set(0x6f6a5c);
  else mat.emissive.set(cloth.base).multiplyScalar(0.45);
  // Film and carbon have a sheen that woven cloth has not. On a black sail it is what shows the shape.
  mat.roughness = cloth.build === 'fibre' ? 0.42 : cloth.build === 'laminate' ? 0.6 : 0.88;
  (mat.userData.through as { value: number }).value = cloth.glow;
  mat.needsUpdate = true;
}

/**
 * The curve of a sail across its chord: zero at luff and leech, 1 at the deepest point, which is `draft` of the
 * way aft. Smooth through the deepest point.
 */
function camber(u: number, draft: number): number {
  return u < draft ? Math.sin((0.5 * Math.PI * u) / draft) : Math.cos((0.5 * Math.PI * (u - draft)) / (1 - draft));
}

/** What a loose sail is doing at one point, as shares of the chord. */
const loose = { bubble: 0, wave: 0 };

/**
 * How a sail that is not drawing moves at chord position u and height v.
 * `bubble` is cloth pushed through to the wrong side behind the luff, which is the first thing a helmsman sees when
 * she is pinched or the sheet is eased too far. `wave` is everything that shakes: a shiver down the luff, the leech
 * fluttering, and when the whole sail has let go, the flogging.
 */
function slack(u: number, v: number, time: number, luff: number, flogging: boolean, aws: number): void {
  loose.bubble = 0;
  loose.wave = 0;
  if (luff <= 0.01 && !flogging) return;
  const wind = Math.min(1.8, 0.4 + aws / 8);
  const b = Math.min(1, luff * 1.5);
  // The bubble sits in the first third and breathes.
  const front = Math.sin(Math.PI * Math.min(1, u / 0.42)) * (1 - u);
  loose.bubble = b * front * 0.2 * (0.72 + 0.28 * Math.sin(time * 5.3 * wind + v * 6.1));
  const shiver = Math.sin(u * 22 - time * 26 * wind + v * 9) * 0.011 * b * (1 - u);
  const leech = Math.sin(u * 40 - time * 44 * wind + v * 13) * 0.02 * luff * smooth(0.55, 1, u);
  const lifting = Math.sin(u * 5 - time * 7 * wind + v * 4) * 0.045 * smooth(0.6, 1, luff) * Math.sin(Math.PI * u);
  loose.wave = shiver + leech + lifting;
  if (flogging) {
    // Head to wind or let fly: the cloth cracks from luff to leech and the leech snaps.
    const flap = (Math.sin(u * 7 - time * 19 * wind + v * 6) * 0.11 + Math.sin(u * 13 - time * 31 * wind - v * 9) * 0.05) * (0.25 + 0.75 * u) * wind;
    loose.wave += flap + Math.sin(time * 27 * wind + v * 17) * 0.045 * u * u * u * wind;
    loose.bubble *= 0.4;
  }
}

export class Mainsail {
  readonly mesh: THREE.Mesh;
  private readonly nu = 18;
  private readonly nv = 30;
  /** Share of the luff hoisted, eased toward the reef setting. */
  private hoist = 1;
  private uvHoist = -1;

  /** @param mark the boat's length in feet, for the class mark and sail number */
  /**
   * @param sailNo her own sail number, in place of the class's
   */
  constructor(private readonly geo: SloopGeometry, private readonly mark = '38', cloth: ClothLook = CLOTHS[0], private readonly sailNo?: string) {
    this.mesh = makeSailMesh(this.nu, this.nv, sailTexture('main', mark, cloth, sailNo), cloth.glow);
    this.mesh.name = 'main';
    dress(this.mesh, 'main', mark, cloth, sailNo);
  }

  /** Change the cloth she is cut from. */
  setCloth(cloth: ClothLook): void {
    dress(this.mesh, 'main', this.mark, cloth, this.sailNo);
  }

  /** Share of the luff that is up the mast right now: 1 full sail, 0 down on the boom. */
  get hoisted(): number {
    return this.hoist;
  }

  /** Width of the sail at height v (0 foot, 1 head) for the full sail. */
  private chord(v: number): number {
    const foot = this.geo.mainFoot;
    // Roach in proportion to the foot, so a small main and a big one have the same shape.
    return THREE.MathUtils.lerp(foot, this.geo.mainHeadWidth ?? 0.22, v) + 0.2135 * foot * Math.sin(Math.PI * v) * (0.45 + 0.2 * (1 - v));
  }

  /**
   * @param hoistTarget share of the luff to have up: the reef, or 0 to lower her
   * @param rate how fast the halyard moves, shares of the luff a second
   */
  update(shape: SailShape, hoistTarget: number, time: number, dt: number, rate = 1.5): void {
    const { nu, nv, geo } = this;
    this.hoist += (hoistTarget - this.hoist) * Math.min(1, dt * rate);
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const hoist = this.hoist;
    const luffLen = (geo.mainHeadY - geo.mainTackY) * hoist;
    const boomDeg = Math.abs(shape.angle) / D2R;
    const eased = smooth(4, 58, boomDeg);
    // More twist the further the sheet is eased. An over-sheeted sail closes its leech.
    const twist = (7 + 0.16 * boomDeg) * D2R * (1 - 0.6 * shape.stall) * Math.sign(shape.angle || shape.belly || 1);
    // Sheeted hard she is flat, eased she is full. A breeze flattens her, a stalled sail hooks deeper.
    const depth = (0.078 + 0.07 * eased) * (1 - 0.2 * smooth(9, 18, shape.aws)) * (1 + 0.25 * shape.stall) * (1 - 0.9 * shape.luff);
    const draft = 0.37 + 0.09 * eased + 0.05 * shape.stall;
    // A reefed sail keeps the cloth of the upper part: the picture on it must not squash.
    if (Math.abs(hoist - this.uvHoist) > 0.002) {
      this.uvHoist = hoist;
      const uv = this.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
      for (let j = 0; j <= nv; j++) {
        const vFull = 1 - hoist + (j / nv) * hoist;
        for (let i = 0; i <= nu; i++) uv.setY(j * (nu + 1) + i, vFull);
      }
      uv.needsUpdate = true;
    }
    let p = 0;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      // A reefed sail is the top of the full sail, lowered.
      const vFull = 1 - hoist + v * hoist;
      const c = this.chord(vFull) * (j === 0 ? Math.min(1, geo.mainFoot / this.chord(vFull)) : 1);
      const a = shape.angle + twist * Math.pow(v, 1.3);
      const sx = Math.sin(a);
      const cz = Math.cos(a);
      const y = geo.mainTackY + v * luffLen;
      const footHold = Math.min(1, v * 9 + 0.12); // the boom holds the foot nearly flat
      // Fuller low down, flatter toward the head.
      const full = depth * (1.08 - 0.3 * v);
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        slack(u, v, time, shape.luff, shape.flogging, shape.aws);
        const side = (shape.belly * (full * camber(u, draft) - loose.bubble) + loose.wave) * footHold;
        const along = u * c;
        arr[p++] = sx * along + cz * side * c;
        arr[p++] = y - u * 0.05 * (1 - v);
        arr[p++] = geo.gooseneck.z + 0.02 + cz * along - sx * side * c;
      }
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  /** A point on the leech at height v, for hanging telltales. Boat frame. */
  leechPoint(v: number, out: THREE.Vector3): THREE.Vector3 {
    const arr = (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const j = Math.round(v * this.nv);
    const k = (j * (this.nu + 1) + this.nu) * 3;
    return out.set(arr[k], arr[k + 1], arr[k + 2]);
  }
}

export class Jib {
  readonly mesh: THREE.Mesh;
  readonly clew = new THREE.Vector3();
  private readonly nu = 16;
  private readonly nv = 26;
  private uvFurl = -1;

  constructor(private readonly geo: SloopGeometry, cloth: ClothLook = CLOTHS[0]) {
    this.mesh = makeSailMesh(this.nu, this.nv, sailTexture('jib', '', cloth), cloth.glow);
    this.mesh.name = 'jib';
    dress(this.mesh, 'jib', '', cloth);
  }

  setCloth(cloth: ClothLook): void {
    dress(this.mesh, 'jib', '', cloth);
  }

  update(shape: SailShape, furl: number, time: number): void {
    const { nu, nv, geo } = this;
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const out = Math.max(0.02, furl);
    const foot = geo.jibFoot * out;
    const T = geo.jibTack;
    const H = geo.jibHead;
    // Loose, the clew lifts and shakes.
    const lift = shape.flogging ? 0.35 + 0.12 * Math.sin(time * 19) : 0.25 * shape.luff;
    this.clew.set(Math.sin(shape.angle) * foot, geo.jibClewY + lift, T.z + Math.cos(shape.angle) * foot);
    const C = this.clew;
    const backed = shape.backed ?? 0;
    const eased = smooth(0.14, 0.8, Math.abs(shape.angle));
    // Sheeted hard she is flat, eased she is full. Aback she is pressed deep the wrong way round.
    const depth = (0.085 + 0.075 * eased) * (1 - 0.18 * smooth(9, 18, shape.aws)) * (1 + 0.25 * shape.stall + 0.45 * backed) * (1 - 0.9 * shape.luff);
    const draft = 0.34 + 0.1 * eased;
    this.mesh.visible = furl > 0.03;
    // Rolled in, what is left out is the after part of the cloth: the sun cover stays on the leech.
    if (Math.abs(out - this.uvFurl) > 0.004) {
      this.uvFurl = out;
      const uv = this.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) uv.setX(j * (nu + 1) + i, 1 - out + (i / nu) * out);
      uv.needsUpdate = true;
    }
    // The forestay is not a bar. Loaded, it sags off to leeward and aft, most in the middle, and the luff goes with it.
    const luffLen = Math.hypot(H.x - T.x, H.y - T.y, H.z - T.z);
    const sag = (0.006 + 0.016 * smooth(3, 13, shape.aws)) * luffLen * (1 - 0.7 * shape.luff) * out;
    const fx = C.x - T.x;
    const fz = C.z - T.z;
    const fl = Math.hypot(fx, fz) || 1e-6;
    let p = 0;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const bow = Math.sin(Math.PI * v);
      const lx = THREE.MathUtils.lerp(T.x, H.x, v) + (fz / fl) * shape.belly * sag * bow;
      const ly = THREE.MathUtils.lerp(T.y, H.y, v);
      const lz = THREE.MathUtils.lerp(T.z, H.z, v) + (-(fx / fl) * shape.belly * sag + 0.35 * sag) * bow;
      // The leech runs from clew to head with a little hollow, and opens to leeward higher up.
      const hollow = -0.035 * bow * foot;
      let kx = THREE.MathUtils.lerp(C.x, H.x, v);
      const ky = THREE.MathUtils.lerp(C.y, H.y, v);
      let kz = THREE.MathUtils.lerp(C.z, H.z, v) + hollow;
      const twist = shape.belly * (0.045 + 0.04 * eased) * bow * foot * (1 - 0.6 * shape.stall);
      kx += twist;
      kz -= Math.abs(twist) * 0.3;
      const dx = kx - lx;
      const dy = ky - ly;
      const dz = kz - lz;
      const c = Math.hypot(dx, dz) || 1e-6;
      // Horizontal unit normal to the chord, pointing to starboard for a sail lying fore and aft.
      const nx = dz / c;
      const nz = -dx / c;
      const edge = Math.sin(Math.PI * Math.min(1, v * 1.15 + 0.08));
      const free = 0.4 + 0.6 * (1 - v);
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        slack(u, v, time, shape.luff, shape.flogging, shape.aws);
        const side = (shape.belly * (depth * camber(u, draft) * edge - loose.bubble * free) + loose.wave * free) * c;
        arr[p++] = lx + dx * u + nx * side;
        // The foot is cut round and hangs a little below the straight line from tack to clew.
        arr[p++] = ly + dy * u - (j === 0 ? 0.035 * foot * Math.sin(Math.PI * u) : 0);
        arr[p++] = lz + dz * u + nz * side;
      }
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  /** A point on the sail at chord u and height v, with the local chord direction. Boat frame. */
  surfacePoint(u: number, v: number, out: THREE.Vector3, tangent?: THREE.Vector3): THREE.Vector3 {
    const arr = (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const j = Math.round(v * this.nv);
    const i = Math.max(0, Math.min(this.nu - 1, Math.round(u * this.nu)));
    const k = (j * (this.nu + 1) + i) * 3;
    out.set(arr[k], arr[k + 1], arr[k + 2]);
    if (tangent) tangent.set(arr[k + 3] - arr[k], arr[k + 4] - arr[k + 1], arr[k + 5] - arr[k + 2]).normalize();
    return out;
  }
}

/**
 * A spinnaker colour to go with a hull: the hull's own hue made bright, since a spinnaker is the loudest thing on the water.
 * A black, grey or white hull has no hue to speak of, so she flies red.
 */
export function spinnakerColour(topsides: string | undefined): string {
  const c = new THREE.Color();
  try {
    c.setStyle(topsides ?? '');
  } catch {
    return '#d8402f';
  }
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (!topsides || hsl.s < 0.18) return '#d8402f';
  return `#${c.setHSL(hsl.h, Math.max(0.72, hsl.s), 0.5).getHexString()}`;
}

/**
 * An asymmetric spinnaker: tacked down ahead of the bow, hoisted to the masthead, its clew flying out to leeward.
 * Much fuller than the white sails. It curls at the luff when it is eased too far or she is sailed too high for it,
 * and when it collapses it hangs and shakes.
 */
export class Spinnaker {
  readonly mesh: THREE.Mesh;
  readonly clew = new THREE.Vector3();
  readonly tack = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly nu = 16;
  private readonly nv = 22;
  /** How full it is, eased toward what the sim reports so it fills and empties over a moment, not in one frame. */
  private fill = 0;

  /**
   * @param colour the colour a plain one is cut in: the hull's, made bright
   * @param kite a design of the owner's choosing. Left out, or `hull`, it is the plain one
   */
  constructor(private readonly geo: SloopGeometry, colour: string, kite?: SailStyle['kite']) {
    this.mesh = makeSailMesh(this.nu, this.nv, spinnakerTexture(colour), 1);
    this.mesh.name = 'spinnaker';
    (this.mesh.material as THREE.MeshStandardMaterial).roughness = 0.7;
    this.setDesign(colour, kite);
    this.mesh.visible = false;
    // The tack is on a short sprit ahead of the stem, the head just under the masthead.
    this.tack.set(0, geo.jibTack.y + 0.25, geo.jibTack.z - 0.85);
    this.head.set(0, geo.mastTopY - 0.25, geo.mastZ - 0.3);
  }

  /** Change the design. Thin nylon glows in its own colours, so the picture lights the sail as well as painting it. */
  setDesign(colour: string, kite?: SailStyle['kite']): void {
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    if (!kite || kite.pattern === 'hull') {
      mat.map = spinnakerTexture(colour);
      mat.emissiveMap = null;
      mat.emissive.set(colour);
    } else {
      mat.map = kiteTexture(kite.pattern, kite.colours);
      mat.emissiveMap = mat.map;
      mat.emissive.set(0xffffff);
    }
    mat.emissiveIntensity = 0.16;
    mat.needsUpdate = true;
  }

  /** @param hoist 0 in its bag, 1 all the way up */
  update(shape: SailShape, hoist: number, time: number, dt: number): void {
    const { nu, nv, geo } = this;
    this.mesh.visible = hoist > 0.02;
    const drawing = shape.flogging ? 0 : 1;
    this.fill += (drawing - this.fill) * Math.min(1, dt * 2.2);
    if (!this.mesh.visible) return;
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const T = this.tack;
    // Going up, the head climbs the mast and the sail comes out of the bag behind it.
    const hx = T.x + (this.head.x - T.x) * hoist;
    const hy = T.y + (this.head.y - T.y) * hoist;
    const hz = T.z + (this.head.z - T.z) * hoist;
    const foot = geo.jibFoot * 1.75 * (0.35 + 0.65 * hoist);
    const fill = this.fill;
    // Empty, the clew drops and swings in toward the boat.
    const a = shape.angle * (0.45 + 0.55 * fill);
    const side = Math.sign(shape.belly || shape.angle || 1);
    this.clew.set(Math.sin(a) * foot, geo.jibClewY + 0.5 + 0.5 * fill + (shape.flogging ? 0.15 * Math.sin(time * 13) : 0), T.z + Math.cos(a) * foot * (0.8 + 0.2 * fill));
    const C = this.clew;
    const luffLen = Math.hypot(hx - T.x, hy - T.y, hz - T.z);
    // It breathes a little even when it is drawing well: nylon is never still.
    const breath = 1 + 0.03 * Math.sin(time * 1.7) * fill;
    const depth = (0.07 + 0.25 * fill * (1 - 0.35 * shape.luff)) * breath;
    const wind = Math.min(1.8, 0.4 + shape.aws / 8);
    let p = 0;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const arch = Math.sin(Math.PI * v);
      // The luff stands forward and to leeward of the straight line from tack to head when the sail is full.
      const lx = T.x + (hx - T.x) * v + side * arch * luffLen * 0.07 * fill;
      const ly = T.y + (hy - T.y) * v;
      const lz = T.z + (hz - T.z) * v - arch * luffLen * 0.06 * fill;
      // The leech runs from the clew to the head, with shoulders that stand out wide of the straight line.
      const shoulder = Math.sin(Math.PI * Math.min(1, v * 1.25)) * foot * 0.2 * (0.3 + 0.7 * fill);
      const kx = C.x + (hx - C.x) * v + Math.sin(a) * shoulder;
      const ky = C.y + (hy - C.y) * v - (1 - fill) * arch * luffLen * 0.05;
      const kz = C.z + (hz - C.z) * v + Math.cos(a) * shoulder * 0.5;
      const dx = kx - lx;
      const dy = ky - ly;
      const dz = kz - lz;
      const c = Math.hypot(dx, dz) || 1e-6;
      const nx = dz / c;
      const nz = -dx / c;
      const edge = Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.96 + 0.04)), 0.6);
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const belly = Math.sin(Math.PI * u) * (1 + 0.25 * (0.5 - u));
        // The curl: the first third of the sail behind the luff folds back to windward and trembles. It starts at
        // the shoulder and runs down the luff as it gets worse.
        const reach = smooth(1 - shape.luff * 1.3, 1.15 - shape.luff * 0.9, v * 0.9 + 0.2);
        const curl = shape.luff * fill * reach * Math.max(0, 1 - u / 0.38) * Math.sin(Math.PI * Math.min(1, u / 0.38 + 0.25)) * (0.24 + 0.05 * Math.sin(time * 15 * wind + v * 9));
        slack(u, v, time, Math.max(shape.luff * 0.4, 1 - fill), fill < 0.4, shape.aws);
        const flap = (loose.wave - side * loose.bubble * 0.4) * (0.5 + 0.5 * arch);
        const off = (side * (depth * belly * edge - curl * arch) + flap) * c;
        arr[p++] = lx + dx * u + nx * off;
        // A full spinnaker lifts in the middle of its foot. Empty, the cloth sags.
        arr[p++] = ly + dy * u + Math.sin(Math.PI * u) * ((1 - v) * 0.5 * fill - (1 - fill) * 0.9 * (1 - v) * hoist);
        arr[p++] = lz + dz * u + nz * off;
      }
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}
