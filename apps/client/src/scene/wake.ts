import * as THREE from 'three';

/**
 * The water every vessel leaves behind her, drawn once for all of them.
 *
 * Each vessel drops a point on her track every few metres. From those points three ribbons are built on the
 * graphics card: the churned, foamy track astern, and the two arms of her bow wave, which leave the stem and travel
 * outward as they age, so together they make the V and bend with her when she turns. The ribbons are not put in the
 * scene. They are drawn from straight above into two small maps of the water round the camera (a fine one close to,
 * a coarse one for the middle distance), and the sea's own shader reads the maps: red is foam, green the height of a
 * wave crest, blue water that has been stirred smooth. So a wake is part of the sea, lit and broken up like the
 * rest of it, and one vessel more costs a few dozen triangles.
 *
 * Nothing here allocates once it is built: the points live in one ring of instances per vessel.
 */

/** A vessel as the wake needs her. Scene coordinates: x east, z south. */
export interface WakeVessel {
  id: string;
  x: number;
  z: number;
  /** Compass radians. */
  heading: number;
  /** Metres a second. */
  speed: number;
  length: number;
  beam: number;
  /** Which side her bow wave is bigger on: +1 starboard, -1 port, 0 upright. */
  lee: number;
}

const TRAILS = 20;
/** Segments in one vessel's ring. The last one is the live piece from her newest point to where she is now. */
const SEGMENTS = 56;
const FLOATS = 16;

const ribbonVertex = /* glsl */ `
  attribute vec4 aA;     // one end: x, z, time dropped, speed then
  attribute vec4 aB;     // the other end
  attribute vec4 aDir;   // unit vector to starboard at each end: ax, az, bx, bz
  attribute vec4 aShape; // beam, length, lee, 1 when the segment is in use
  uniform float uTime;
  uniform vec3 uView;    // centre x, centre z, half the width of water the map covers
  varying float vSide;
  varying vec3 vInk;     // foam, crest, smooth

  void main() {
    float t = position.x;
    float side = position.y;
    float ribbon = position.z;
    vec4 P = mix(aA, aB, t);
    vec2 stbd = normalize(mix(aDir.xy, aDir.zw, t) + vec2(1e-5, 0.0));
    vec2 fwd = vec2(stbd.y, -stbd.x);
    float age = max(uTime - P.z, 0.0);
    float sp = P.w;
    float beam = aShape.x;
    float len = aShape.y;
    // A ship's wake lasts longer than a yacht's and is seen from further off.
    float big = clamp((len - 14.0) / 60.0, 0.0, 1.0);
    vec2 p;
    vec3 ink;
    if (ribbon < 0.5) {
      // The track astern: white where the hull and propeller have just been, spreading and breaking up as it ages.
      float life = 22.0 + 7.0 * sp + 45.0 * big;
      float a = clamp(age / life, 0.0, 1.0);
      float halfW = beam * 0.4 + sqrt(age) * (0.32 + 0.07 * sp) * (1.0 + 1.2 * big);
      float way = smoothstep(0.35, 3.2, sp) * (0.8 + 0.6 * big);
      p = P.xy - fwd * (len * 0.5) + stbd * (side * halfW);
      float fresh = pow(1.0 - a, 1.3);
      ink = vec3(way * fresh * mix(1.0, 0.72, smoothstep(0.0, 8.0, age)), 0.0, min(1.0, way * 1.4) * (1.0 - a));
    } else {
      // An arm of the bow wave. It leaves the stem and walks outward at a fixed share of her speed.
      float arm = ribbon < 1.5 ? -1.0 : 1.0;
      float life = 5.0 + 2.6 * sp + 14.0 * big;
      float a = clamp(age / life, 0.0, 1.0);
      float out_ = beam * 0.16 + 0.33 * sp * age * (1.0 - 0.35 * a);
      float halfW = (0.4 + 0.08 * beam + 0.16 * age) * (1.0 + 0.8 * big);
      float bigger = 1.0 + 0.55 * aShape.z * arm;
      float way = smoothstep(0.6, 3.6, sp);
      p = P.xy + fwd * (len * 0.42) + stbd * (arm * out_ + side * halfW);
      // White only where it breaks at the stem, and only at speed. Further out it is a smooth swell.
      float breaking = smoothstep(1.5, 3.6, sp) * (1.0 - smoothstep(0.3, 2.4 + 0.6 * sp, age)) * bigger;
      ink = vec3(breaking * 0.85, min(1.0, way * bigger * pow(1.0 - a, 1.5)), 0.0);
    }
    vSide = side;
    vInk = ink * aShape.w;
    vec2 clip = (p - uView.xy) / uView.z;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`;

const ribbonFragment = /* glsl */ `
  varying float vSide;
  varying vec3 vInk;
  void main() {
    float d = abs(vSide);
    float soft = 1.0 - d * d * (3.0 - 2.0 * d);
    gl_FragColor = vec4(vInk * soft, 1.0);
  }
`;

class Trail {
  id = '';
  /** Next ring slot to write. */
  head = 0;
  lastSeen = -1;
  /** The newest dropped point. */
  px = 0; pz = 0; pt = 0; ps = 0; sx = 1; sz = 0;
  /** Where she was last frame, to tell sailing from being put somewhere else. */
  cx = 0; cz = 0;
  started = false;
}

export class Wake {
  /** Fine map of the water close to the camera, and a coarse one of the middle distance. */
  readonly near: THREE.WebGLRenderTarget;
  readonly far: THREE.WebGLRenderTarget;
  /** Centre x, centre z and one over the width, for each map. The sea's shader is handed these. */
  readonly nearRect = new THREE.Vector4(0, 0, 1 / 300, 0);
  readonly farRect = new THREE.Vector4(0, 0, 1 / 3600, 0);
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly material: THREE.ShaderMaterial;
  private readonly data = new Float32Array(TRAILS * SEGMENTS * FLOATS);
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private readonly trails: Trail[] = Array.from({ length: TRAILS }, () => new Trail());
  private readonly byId = new Map<string, Trail>();
  private readonly clear = new THREE.Color();
  private readonly forward = new THREE.Vector3();
  private frame = 0;
  private nearWidth = 300;
  private farWidth = 3600;

  constructor(detail: 'high' | 'low' = 'high') {
    const size = detail === 'high' ? 1024 : 512;
    const make = (n: number) => new THREE.WebGLRenderTarget(n, n, { depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.near = make(size);
    this.far = make(size / 2);

    // One short strip of three ribbons, drawn once for every segment of every trail.
    const strip: number[] = [];
    const index: number[] = [];
    for (let ribbon = 0; ribbon < 3; ribbon++) {
      const o = ribbon * 4;
      strip.push(0, -1, ribbon, 0, 1, ribbon, 1, -1, ribbon, 1, 1, ribbon);
      index.push(o, o + 1, o + 2, o + 2, o + 1, o + 3);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3));
    g.setIndex(index);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, FLOATS);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    g.setAttribute('aB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    g.setAttribute('aDir', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    g.setAttribute('aShape', new THREE.InterleavedBufferAttribute(this.buffer, 4, 12));
    g.instanceCount = TRAILS * SEGMENTS;
    this.material = new THREE.ShaderMaterial({
      vertexShader: ribbonVertex,
      fragmentShader: ribbonFragment,
      uniforms: { uTime: { value: 0 }, uView: { value: new THREE.Vector3(0, 0, 150) } },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Where wakes cross, the stronger one shows: nothing adds up to a glare.
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(g, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** A ring for a vessel that has none: one nobody is using, or else the one whose vessel has been gone longest. */
  private slot(id: string): Trail | null {
    let best: Trail | null = null;
    for (const c of this.trails) {
      if (c.id && c.lastSeen >= this.frame - 1) continue;
      if (!best || c.lastSeen < best.lastSeen) best = c;
    }
    return best ? this.claim(best, id) : null;
  }

  private claim(t: Trail, id: string): Trail {
    if (t.id) this.byId.delete(t.id);
    const base = this.trails.indexOf(t) * SEGMENTS * FLOATS;
    this.data.fill(0, base, base + SEGMENTS * FLOATS);
    t.id = id;
    t.head = 0;
    t.started = false;
    if (id) this.byId.set(id, t);
    return t;
  }

  private write(trail: Trail, slot: number, v: WakeVessel, time: number, stbdX: number, stbdZ: number): void {
    const o = (this.trails.indexOf(trail) * SEGMENTS + slot) * FLOATS;
    const d = this.data;
    d[o] = trail.px; d[o + 1] = trail.pz; d[o + 2] = trail.pt; d[o + 3] = trail.ps;
    d[o + 4] = v.x; d[o + 5] = v.z; d[o + 6] = time; d[o + 7] = v.speed;
    d[o + 8] = trail.sx; d[o + 9] = trail.sz; d[o + 10] = stbdX; d[o + 11] = stbdZ;
    d[o + 12] = v.beam; d[o + 13] = v.length; d[o + 14] = v.lee; d[o + 15] = 1;
  }

  /**
   * Move the wakes on and draw the maps.
   * @param time sea time, seconds: the same clock the waves run on
   * @param vessels everything afloat that moves. The list and its objects are only read.
   */
  update(renderer: THREE.WebGLRenderer, time: number, camera: THREE.Camera, vessels: readonly WakeVessel[]): void {
    this.frame++;
    for (let i = 0; i < vessels.length; i++) {
      const v = vessels[i];
      const trail = this.byId.get(v.id) ?? this.slot(v.id);
      if (!trail) continue;
      const stbdX = Math.cos(v.heading);
      const stbdZ = Math.sin(v.heading);
      const jump = Math.hypot(v.x - trail.cx, v.z - trail.cz);
      // Towed, mustered at a start or wound on in time: the old track does not lead here. Start a new one.
      const moved = trail.started && trail.lastSeen === this.frame - 1 && jump < 12 + v.speed * 1.5;
      if (!moved || time < trail.pt) {
        trail.px = v.x; trail.pz = v.z; trail.pt = time; trail.ps = v.speed; trail.sx = stbdX; trail.sz = stbdZ;
        trail.started = true;
      } else {
        // Far enough apart to cover the whole of a wake's life with the ring, close enough to follow a turn.
        const spacing = Math.max(1.6, v.speed * (0.45 + v.length * 0.012));
        if (Math.hypot(v.x - trail.px, v.z - trail.pz) > spacing) {
          this.write(trail, trail.head, v, time, stbdX, stbdZ);
          trail.head = (trail.head + 1) % (SEGMENTS - 1);
          trail.px = v.x; trail.pz = v.z; trail.pt = time; trail.ps = v.speed; trail.sx = stbdX; trail.sz = stbdZ;
        }
      }
      // The live piece keeps the wake fast to her stern between points.
      this.write(trail, SEGMENTS - 1, v, time, stbdX, stbdZ);
      trail.cx = v.x; trail.cz = v.z;
      trail.lastSeen = this.frame;
    }
    // A vessel that has gone leaves her wake to fade, without a live piece.
    for (const t of this.trails) {
      if (t.id && t.lastSeen !== this.frame && t.lastSeen === this.frame - 1) {
        this.data[(this.trails.indexOf(t) * SEGMENTS + SEGMENTS - 1) * FLOATS + 15] = 0;
      }
    }
    this.buffer.needsUpdate = true;

    // The fine map sits ahead of the camera, where it is looking. Both move a whole texel at a time so nothing swims.
    camera.getWorldDirection(this.forward);
    const flat = Math.hypot(this.forward.x, this.forward.z) || 1;
    const lead = this.nearWidth * 0.36 * Math.min(1, flat * 1.6);
    this.place(this.nearRect, camera.position.x + (this.forward.x / flat) * lead, camera.position.z + (this.forward.z / flat) * lead, this.nearWidth, this.near.width);
    this.place(this.farRect, camera.position.x, camera.position.z, this.farWidth, this.far.width);

    const u = this.material.uniforms;
    u.uTime.value = time;
    const target = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    renderer.setClearColor(0x000000, 0);
    const view = u.uView.value as THREE.Vector3;
    view.set(this.nearRect.x, this.nearRect.y, this.nearWidth / 2);
    renderer.setRenderTarget(this.near);
    renderer.render(this.scene, this.camera);
    view.set(this.farRect.x, this.farRect.y, this.farWidth / 2);
    renderer.setRenderTarget(this.far);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(target);
    renderer.setClearColor(this.clear, alpha);
  }

  /** Finer or coarser maps. */
  setDetail(detail: 'high' | 'low'): void {
    const size = detail === 'high' ? 1024 : 512;
    if (this.near.width === size) return;
    this.near.setSize(size, size);
    this.far.setSize(size / 2, size / 2);
  }

  private place(rect: THREE.Vector4, x: number, z: number, width: number, pixels: number): void {
    const texel = width / pixels;
    rect.set(Math.round(x / texel) * texel, Math.round(z / texel) * texel, 1 / width, texel);
  }

  dispose(): void {
    this.near.dispose();
    this.far.dispose();
    this.material.dispose();
  }
}
