import * as THREE from 'three';

/**
 * What goes over the daytime sky to make the rest of the day: a veil that takes the light out of it at dusk, greys it
 * under a squall and whitens it inside fog; the stars; and the moon with its phase.
 * All of it is direction and no place, drawn at the far plane like the high cloud.
 */

const farVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w;
  }
`;

const veilFragment = /* glsl */ `
  uniform vec3 uSunDir;   // where the sun really is, below the horizon included
  uniform float uNight;   // 0 day, 1 full night
  uniform float uGlow;    // how much afterglow is left where the sun went down
  uniform float uOvercast;
  uniform vec3 uCloud;    // the colour of the underside of a squall, in this light
  uniform float uFog;
  uniform vec3 uFogColor;
  varying vec3 vWorld;
  void main() {
    vec3 d = normalize(vWorld - cameraPosition);
    float up = clamp(d.y, 0.0, 1.0);
    // Night comes down from overhead. The last light is low in the sky over where the sun set.
    float toSun = max(dot(normalize(d.xz + vec2(1e-5)), normalize(uSunDir.xz + vec2(1e-5))), 0.0);
    float glow = pow(toSun, 3.0) * pow(1.0 - up, 5.0) * uGlow;
    // Fully dark at full night, the horizon too: the dusk sky underneath is bright, and the sea reflects that band.
    float aN = uNight * (1.0 - 0.6 * glow);
    vec3 col = vec3(0.0035, 0.0065, 0.016);
    float a = aN;
    // A squall's cloud: a grey lid, a little lighter toward the horizon it has not reached.
    float aO = uOvercast * mix(0.72, 0.94, smoothstep(0.02, 0.5, up));
    col = mix(col, uCloud, aO / max(aO + a * (1.0 - aO), 1e-4));
    a = aO + a * (1.0 - aO);
    // Fog: white all round, with a little of the sky left straight overhead.
    float aF = uFog * mix(1.0, 0.7, smoothstep(0.25, 0.95, up));
    col = mix(col, uFogColor, aF / max(aF + a * (1.0 - aF), 1e-4));
    a = aF + a * (1.0 - aF);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const starVertex = /* glsl */ `
  attribute float aMag;
  uniform float uNight;
  uniform float uSize;
  varying float vBright;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 d = normalize(wp.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w;
    // Low stars are dimmed by all the air they are seen through.
    vBright = aMag * uNight * smoothstep(0.0, 0.22, d.y);
    gl_PointSize = uSize * (0.9 + 1.5 * aMag);
  }
`;

const starFragment = /* glsl */ `
  varying float vBright;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.2, 1.0, d)) * vBright;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.9, 0.94, 1.0) * a, 1.0);
    #include <colorspace_fragment>
  }
`;

const moonVertex = /* glsl */ `
  uniform float uSize;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w;
    gl_PointSize = uSize;
  }
`;

const moonFragment = /* glsl */ `
  uniform vec3 uLight;  // toward the sun, in the camera's frame
  uniform float uShow;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    p.y = -p.y;
    // The disc takes up the middle of the point. The rest is its glow.
    vec2 q = p / 0.42;
    float r2 = dot(q, q);
    float halo = exp(-dot(p, p) * 5.0) * 0.22;
    vec3 col = vec3(0.75, 0.82, 1.0) * halo;
    float a = halo;
    if (r2 < 1.0) {
      vec3 n = vec3(q, sqrt(1.0 - r2));
      float lit = smoothstep(-0.04, 0.12, dot(n, normalize(uLight)));
      // A few grey seas, so it is the moon and not a lamp.
      float seas = 0.82 + 0.18 * sin(q.x * 5.0 + 1.3) * sin(q.y * 4.0 - 0.6);
      col = mix(vec3(0.02, 0.025, 0.035), vec3(1.0, 0.97, 0.9) * seas, lit) * 1.5;
      a = 1.0;
    }
    gl_FragColor = vec4(col * uShow, a * uShow);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class NightSky {
  /** For the scene, and a second copy of the veil for the scene the reflections are baked from. */
  readonly group = new THREE.Group();
  readonly envVeil: THREE.Mesh;
  readonly veilUniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uNight: { value: 0 },
    uGlow: { value: 0 },
    uOvercast: { value: 0 },
    uCloud: { value: new THREE.Color(0.2, 0.22, 0.25) },
    uFog: { value: 0 },
    uFogColor: { value: new THREE.Color(0.8, 0.82, 0.85) },
  };
  private readonly stars: THREE.Points;
  private readonly starUniforms = { uNight: { value: 0 }, uSize: { value: 2 } };
  private readonly moon: THREE.Points;
  private readonly moonUniforms = { uLight: { value: new THREE.Vector3(1, 0, 0) }, uShow: { value: 0 }, uSize: { value: 30 } };
  private readonly pole = new THREE.Vector3();
  private readonly tilt = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private static readonly Y = new THREE.Vector3(0, 1, 0);

  constructor(radius = 16000) {
    const dome = new THREE.SphereGeometry(1, 24, 12);
    const veilMaterial = new THREE.ShaderMaterial({ vertexShader: farVertex, fragmentShader: veilFragment, uniforms: this.veilUniforms, side: THREE.BackSide, transparent: true, depthWrite: false });
    const veil = new THREE.Mesh(dome, veilMaterial);
    veil.scale.setScalar(radius);
    veil.frustumCulled = false;
    veil.renderOrder = -6;
    this.envVeil = new THREE.Mesh(dome, veilMaterial);
    this.envVeil.scale.setScalar(radius);

    // Stars: scattered evenly over the whole sphere, a few bright and most faint. They wheel round the pole.
    let seed = 1977;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const count = 1500;
    const pos = new Float32Array(count * 3);
    const mag = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const y = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * r;
      mag[i] = Math.pow(rnd(), 3.2) * 0.85 + 0.15;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: starVertex, fragmentShader: starFragment, uniforms: this.starUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.stars.scale.setScalar(radius * 0.98);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -5.5;

    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.moon = new THREE.Points(mg, new THREE.ShaderMaterial({ vertexShader: moonVertex, fragmentShader: moonFragment, uniforms: this.moonUniforms, transparent: true, depthWrite: false }));
    this.moon.frustumCulled = false;
    this.moon.renderOrder = -5.4;
    this.group.add(veil, this.stars, this.moon);
    this.group.name = 'night_sky';
  }

  /**
   * @param night 0 by day, 1 when the sun is well down
   * @param sunDir toward the sun, wherever it is
   * @param moonDir toward the moon
   * @param moonUp 0 when the moon is down or the sky too bright to matter, 1 when it rides a dark sky
   * @param clear how much of the sky is open: stars and moon fade behind cloud and fog
   * @param turn the sky's turn about the pole, radians (the sidereal time)
   */
  /**
   * How dark the sky is. Called before the reflections are baked, so the sea reflects the same sky that is drawn:
   * a session that starts at night, or a clock that jumps, must not leave a daylit sky in the water.
   */
  setNight(night: number, sunDir: THREE.Vector3): void {
    const v = this.veilUniforms;
    v.uSunDir.value.copy(sunDir);
    v.uNight.value = night;
    // The afterglow lasts through dusk and is gone by full night.
    v.uGlow.value = 1 - THREE.MathUtils.smoothstep(night, 0.55, 1);
  }

  set(night: number, sunDir: THREE.Vector3, moonDir: THREE.Vector3, moonUp: number, clear: number, latDeg: number, turn: number, camera: THREE.Camera, pixelsHigh: number): void {
    this.setNight(night, sunDir);
    this.starUniforms.uNight.value = THREE.MathUtils.smoothstep(night, 0.45, 0.95) * clear;
    this.starUniforms.uSize.value = Math.max(1.6, pixelsHigh / 420);
    this.stars.visible = this.starUniforms.uNight.value > 0.01;
    const lat = (latDeg * Math.PI) / 180;
    this.pole.set(0, Math.sin(lat), -Math.cos(lat));
    this.stars.quaternion.copy(this.tilt.setFromUnitVectors(NightSky.Y, this.pole)).multiply(this.spin.setFromAxisAngle(NightSky.Y, -turn));

    this.moon.visible = moonUp > 0.01 && clear > 0.02;
    this.moon.position.copy(moonDir).multiplyScalar(this.stars.scale.x);
    // Half a degree across would be nine pixels: drawn two and a half times life size, as the eye remembers it.
    // Some phone GPUs draw no point wider than 64 pixels: stay inside that.
    this.moonUniforms.uSize.value = Math.min(64, Math.max(26, pixelsHigh * 0.075));
    this.moonUniforms.uShow.value = moonUp * clear;
    this.moonUniforms.uLight.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  }

  /** Ride along with the eye. */
  follow(x: number, z: number): void {
    this.group.position.set(x, 0, z);
  }
}
