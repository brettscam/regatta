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

function sailTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3f0e6';
  g.fillRect(0, 0, c.width, c.height);
  // Cross-cut panel seams and a few battens' worth of shading.
  g.strokeStyle = 'rgba(120,125,130,0.35)';
  g.lineWidth = 2;
  for (let y = 40; y < c.height; y += 78) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(c.width, y - 14);
    g.stroke();
  }
  // Luff tape.
  g.fillStyle = 'rgba(40,60,90,0.5)';
  g.fillRect(0, 0, 7, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let sharedTexture: THREE.CanvasTexture | null = null;

function makeSailMesh(nu: number, nv: number): THREE.Mesh {
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
  sharedTexture ??= sailTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: sharedTexture, color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    // Sailcloth lets some light through. A little glow stops the shaded side going dead.
    emissive: 0x6f6a5c, emissiveIntensity: 0.22,
  });
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
    this.mesh = makeSailMesh(this.nu, this.nv);
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
    this.mesh = makeSailMesh(this.nu, this.nv);
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
