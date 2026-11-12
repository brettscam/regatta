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
function sailTexture(kind: SailKind): THREE.CanvasTexture {
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
      g.fillText('USA 3838', 0, 0);
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
    g.fillText('38', 0, 1);
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

function makeSailMesh(nu: number, nv: number, kind: SailKind): THREE.Mesh {
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
    map: sailTexture(kind), color: 0xffffff, roughness: 0.88, metalness: 0, side: THREE.DoubleSide,
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

  constructor(private readonly geo: SloopGeometry) {
    this.mesh = makeSailMesh(this.nu, this.nv, 'main');
    this.mesh.name = 'main';
  }

  /** Width of the sail at height v (0 foot, 1 head) for the full sail. */
  private chord(v: number): number {
    const foot = this.geo.mainFoot;
    return THREE.MathUtils.lerp(foot, 0.22, v) + 0.95 * Math.sin(Math.PI * v) * (0.45 + 0.2 * (1 - v));
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
    this.mesh = makeSailMesh(this.nu, this.nv, 'jib');
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
