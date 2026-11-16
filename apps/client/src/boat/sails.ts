import * as THREE from 'three';
import type { SloopGeometry } from './buildSloop';

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
}

type SailKind = 'main' | 'jib';

/**
 * Sailcloth drawn on a canvas. Across the canvas is luff to leech, up the canvas is foot to head.
 * Seams, draft stripes, battens and numbers on the main, a sun-cover strip on the furling jib.
 */
function sailTexture(kind: SailKind, mark: string, sailNo?: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  // Canvas y runs down, so height v on the sail is drawn at H * (1 - v).
  const Y = (v: number) => H * (1 - v);
  g.fillStyle = '#f4f1e7';
  g.fillRect(0, 0, W, H);
  // Panels: each a hair different in tone, with a stitched seam between.
  const panels = kind === 'main' ? 15 : 13;
  for (let i = 0; i < panels; i++) {
    const y0 = Y((i + 1) / panels);
    g.fillStyle = `rgba(${i % 2 ? '255,255,255' : '205,200,186'}, 0.16)`;
    g.fillRect(0, y0, W, H / panels);
    g.strokeStyle = 'rgba(120, 124, 128, 0.42)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, y0 + 8);
    g.lineTo(W, y0 - 6);
    g.stroke();
  }
  // Draft stripes: dark bands across the sail that make its curve easy to read.
  g.strokeStyle = kind === 'main' ? '#1f2a36' : '#1e3a66';
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
      g.fillStyle = 'rgba(232, 228, 214, 1)';
      g.fillRect(0, Y(v) - 7, W, 14);
      g.strokeStyle = 'rgba(96, 100, 104, 0.6)';
      g.lineWidth = 1.2;
      g.strokeRect(-2, Y(v) - 7, W + 4, 14);
    }
    // Reef points: two rows of patches.
    for (const v of [0.2, 0.38]) {
      for (let i = 1; i < 6; i++) {
        g.fillStyle = 'rgba(150, 152, 150, 0.7)';
        g.fillRect((W * i) / 6 - 5, Y(v) + 16, 10, 12);
      }
    }
    // Sail number, one way round on each side as on a real sail, and a class mark near the head.
    g.fillStyle = '#12233d';
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
    g.strokeStyle = '#b22a35';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 15, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#b22a35';
    g.font = '700 17px ui-sans-serif, Arial, sans-serif';
    g.fillText(mark, 0, 1);
    g.restore();
    // Headboard and tabling.
    g.fillStyle = 'rgba(60, 64, 70, 0.75)';
    g.fillRect(0, Y(1), W, 12);
    g.fillStyle = 'rgba(190, 186, 172, 0.7)';
    g.fillRect(W - 9, 0, 9, H);
    g.fillRect(0, H - 9, W, 9);
  } else {
    // Sun cover: a dark strip along the leech and foot that is all that shows when the sail is rolled away.
    g.fillStyle = '#1b2d4a';
    g.fillRect(W * 0.925, 0, W * 0.075, H);
    g.fillRect(0, Y(0.04), W, H * 0.04);
    // Clew and tack patches.
    g.fillStyle = 'rgba(205, 200, 186, 0.75)';
    g.beginPath();
    g.moveTo(W * 0.925, Y(0.04));
    g.lineTo(W * 0.62, Y(0.04));
    g.lineTo(W * 0.925, Y(0.17));
    g.fill();
  }
  // Luff tape.
  g.fillStyle = 'rgba(40, 60, 90, 0.55)';
  g.fillRect(0, 0, 8, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Spinnaker cloth: light nylon in the boat's colour, cut in panels that fan out from the three corners,
 * with a white band across the middle so the shape of the sail reads from a distance.
 */
function spinnakerTexture(colour: string): THREE.CanvasTexture {
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
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeSailMesh(nu: number, nv: number, kind: SailKind | THREE.CanvasTexture, mark: string, sailNo?: string): THREE.Mesh {
  const count = (nu + 1) * (nv + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const uv = new Float32Array(count * 2);
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    uv[(j * (nu + 1) + i) * 2] = i / nu;
    uv[(j * (nu + 1) + i) * 2 + 1] = j / nv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i;
    const b = a + nu + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  g.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({
    map: typeof kind === 'string' ? sailTexture(kind, mark, sailNo) : kind, color: 0xffffff, roughness: 0.88, metalness: 0, side: THREE.DoubleSide,
    emissive: 0x6f6a5c, emissiveIntensity: 0.1,
  });
  // Sailcloth lets light through. When the sun is behind the sail, the side you are looking at glows with it.
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      #if NUM_DIR_LIGHTS > 0
        float sailBacklight = max(dot(-normal, directionalLights[0].direction), 0.0);
        totalEmissiveRadiance += diffuseColor.rgb * directionalLights[0].color * (0.03 + 0.1 * sailBacklight);
      #endif`,
    );
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Draft-forward camber curve: zero at luff and leech, 1 at about 40% of the chord. */
function camberCurve(u: number): number {
  return 3.08 * u * (1 - u) * (1.25 - 0.5 * u);
}

/** How a loose sail moves at chord position u and height v. Returns a sideways offset as a share of chord. */
function shake(u: number, v: number, time: number, luff: number, flogging: boolean, aws: number): number {
  if (luff <= 0) return 0;
  const wind = Math.min(1.6, 0.35 + aws / 9);
  // Luffing starts as a soft bubble behind the luff, then the whole sail lifts.
  const bubble = Math.sin(Math.PI * Math.min(1, u / 0.5)) * (1 - u) * -0.11 * luff;
  const ripple = Math.sin(u * 13 - time * 17 * wind + v * 5.3) * 0.03 * luff * Math.min(1, u * 3);
  if (!flogging) return bubble + ripple;
  const flap = (Math.sin(u * 9 - time * 23 * wind + v * 7) * 0.09 + Math.sin(u * 17 - time * 37 * wind - v * 11) * 0.04) * u * wind;
  return ripple + flap;
}

export class Mainsail {
  readonly mesh: THREE.Mesh;
  private readonly nu = 14;
  private readonly nv = 24;
  /** Share of the luff hoisted, eased toward the reef setting. */
  private hoist = 1;

  /**
   * @param mark the boat's length in feet, for the class mark and sail number
   * @param sailNo her own sail number, in place of the class's
   */
  constructor(private readonly geo: SloopGeometry, mark = '38', sailNo?: string) {
    this.mesh = makeSailMesh(this.nu, this.nv, 'main', mark, sailNo);
    this.mesh.name = 'main';
  }

  /** Share of the luff that is up the mast right now: 1 full sail, 0 down on the boom. */
  get hoisted(): number {
    return this.hoist;
  }

  /** Width of the sail at height v (0 foot, 1 head) for the full sail. */
  private chord(v: number): number {
    const foot = this.geo.mainFoot;
    // Roach in proportion to the foot, so a small main and a big one have the same shape.
    return THREE.MathUtils.lerp(foot, 0.22, v) + 0.2135 * foot * Math.sin(Math.PI * v) * (0.45 + 0.2 * (1 - v));
  }

  update(shape: SailShape, hoistTarget: number, time: number, dt: number): void {
    const { nu, nv, geo } = this;
    this.hoist += (hoistTarget - this.hoist) * Math.min(1, dt * 1.5);
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const luffLen = (geo.mainHeadY - geo.mainTackY) * this.hoist;
    const boomDeg = Math.abs(shape.angle) / D2R;
    // More twist the further the sheet is eased. An over-sheeted sail closes its leech.
    const twist = (7 + 0.16 * boomDeg) * D2R * (1 - 0.6 * shape.stall) * Math.sign(shape.angle || shape.belly || 1);
    const depth = (0.105 + 0.03 * shape.stall) * (1 - 0.85 * shape.luff);
    let p = 0;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      // A reefed sail is the top of the full sail, lowered.
      const vFull = 1 - this.hoist + v * this.hoist;
      const c = this.chord(vFull) * (j === 0 ? Math.min(1, geo.mainFoot / this.chord(vFull)) : 1);
      const a = shape.angle + twist * Math.pow(v, 1.3);
      const sx = Math.sin(a);
      const cz = Math.cos(a);
      const y = geo.mainTackY + v * luffLen;
      const footHold = Math.min(1, v * 9 + 0.12); // the boom holds the foot nearly flat
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const side = shape.belly * depth * camberCurve(u) * footHold + shake(u, v, time, shape.luff, shape.flogging, shape.aws) * footHold;
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
  private readonly nu = 12;
  private readonly nv = 22;

  constructor(private readonly geo: SloopGeometry) {
    this.mesh = makeSailMesh(this.nu, this.nv, 'jib', '');
    this.mesh.name = 'jib';
  }

  update(shape: SailShape, furl: number, time: number): void {
    const { nu, nv, geo } = this;
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const foot = geo.jibFoot * Math.max(0.02, furl);
    const T = geo.jibTack;
    const H = geo.jibHead;
    // Loose, the clew lifts and shakes.
    const lift = shape.flogging ? 0.35 + 0.12 * Math.sin(time * 19) : 0.25 * shape.luff;
    this.clew.set(Math.sin(shape.angle) * foot, geo.jibClewY + lift, T.z + Math.cos(shape.angle) * foot);
    const C = this.clew;
    const depth = (0.11 + 0.03 * shape.stall) * (1 - 0.85 * shape.luff);
    this.mesh.visible = furl > 0.03;
    let p = 0;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const lx = THREE.MathUtils.lerp(T.x, H.x, v);
      const ly = THREE.MathUtils.lerp(T.y, H.y, v);
      const lz = THREE.MathUtils.lerp(T.z, H.z, v);
      // The leech runs from clew to head with a little hollow, and opens to leeward higher up.
      const hollow = -0.035 * Math.sin(Math.PI * v) * foot;
      let kx = THREE.MathUtils.lerp(C.x, H.x, v);
      const ky = THREE.MathUtils.lerp(C.y, H.y, v);
      let kz = THREE.MathUtils.lerp(C.z, H.z, v) + hollow;
      const twist = shape.belly * 0.045 * Math.sin(Math.PI * v) * foot * (1 - 0.6 * shape.stall);
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
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const side = (shape.belly * depth * camberCurve(u) * edge + shake(u, v, time, shape.luff, shape.flogging, shape.aws) * (0.4 + 0.6 * (1 - v))) * c;
        arr[p++] = lx + dx * u + nx * side;
        arr[p++] = ly + dy * u;
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
  private readonly nu = 14;
  private readonly nv = 20;
  /** How full it is, eased toward what the sim reports so it fills and empties over a moment, not in one frame. */
  private fill = 0;

  constructor(private readonly geo: SloopGeometry, colour: string) {
    this.mesh = makeSailMesh(this.nu, this.nv, spinnakerTexture(colour), '');
    this.mesh.name = 'spinnaker';
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    mat.roughness = 0.7;
    mat.emissive.set(colour);
    mat.emissiveIntensity = 0.16;
    this.mesh.visible = false;
    // The tack is on a short sprit ahead of the stem, the head just under the masthead.
    this.tack.set(0, geo.jibTack.y + 0.25, geo.jibTack.z - 0.85);
    this.head.set(0, geo.mastTopY - 0.25, geo.mastZ - 0.3);
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
    const depth = 0.07 + 0.25 * fill * (1 - 0.35 * shape.luff);
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
        // The curl: the first third of the sail behind the luff folds back to windward and trembles.
        const curl = shape.luff * fill * Math.max(0, 1 - u / 0.38) * Math.sin(Math.PI * Math.min(1, u / 0.38 + 0.25)) * (0.2 + 0.035 * Math.sin(time * 15 + v * 9));
        const flap = shake(u, v, time, Math.max(shape.luff * 0.4, 1 - fill), fill < 0.4, shape.aws) * (0.5 + 0.5 * arch);
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
