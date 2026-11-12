import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { sunAngles, sunDirection } from './sun';

/**
 * Physical sky with the sun placed by date, time and position.
 * Also renders the sky into a cube map for water reflections and into a filtered map that lights the boat.
 */
export class SkySystem {
  readonly sky = new Sky();
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly sunColor = new THREE.Color(1, 1, 1);
  readonly sunLight = new THREE.DirectionalLight(0xffffff, 3);
  readonly fill = new THREE.HemisphereLight(0xbfd7ee, 0x1c3a44, 0.35);
  readonly reflection: THREE.WebGLCubeRenderTarget;
  elevation = 0;
  azimuth = 0;

  private readonly envScene = new THREE.Scene();
  private readonly envSky = new Sky();
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lastBaked = new THREE.Vector3();

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene) {
    this.sky.scale.setScalar(18000);
    this.envSky.scale.setScalar(18000);
    this.envSky.material = this.sky.material;
    this.envScene.add(this.envSky);
    const u = this.sky.material.uniforms;
    // A little haze, as on the Bay on a summer afternoon.
    u.turbidity.value = 2.6;
    u.rayleigh.value = 2.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.84;

    this.reflection = new THREE.WebGLCubeRenderTarget(256, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.cubeCamera = new THREE.CubeCamera(1, 40000, this.reflection);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const s = this.sunLight.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.near = 1;
    s.camera.far = 120;
    s.camera.left = -14;
    s.camera.right = 14;
    s.camera.top = 20;
    s.camera.bottom = -8;
    s.bias = -0.0004;
    s.normalBias = 0.03;
    this.sunLight.castShadow = true;

    scene.add(this.sky, this.sunLight, this.sunLight.target, this.fill);
  }

  /** Place the sun for a moment in time. Re-bakes the reflection maps only when the sun has moved enough to see. */
  setTime(date: Date, latDeg: number, lonDeg: number): void {
    const { azimuth, elevation } = sunAngles(date, latDeg, lonDeg);
    this.azimuth = azimuth;
    this.elevation = elevation;
    // Keep a sliver of light after sunset so the scene never goes fully black in this milestone.
    sunDirection(azimuth, Math.max(elevation, -0.03), this.sunDir);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    // Warmer and dimmer as the sun gets low.
    const h = THREE.MathUtils.clamp(Math.sin(Math.max(elevation, 0)), 0, 1);
    const warm = 1 - THREE.MathUtils.smoothstep(h, 0.05, 0.55);
    this.sunColor.setRGB(1, 1 - 0.32 * warm, 1 - 0.62 * warm);
    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = 3.4 * THREE.MathUtils.smoothstep(h, 0.0, 0.25) + 0.05;
    this.fill.intensity = 0.2 + 0.25 * h;

    if (this.lastBaked.distanceToSquared(this.sunDir) > 2e-5 || !this.envTarget) this.bake();
  }

  /** Keep the shadow box centred on the boat. */
  follow(target: THREE.Vector3): void {
    this.sunLight.target.position.copy(target);
    this.sunLight.position.copy(target).addScaledVector(this.sunDir, 60);
  }

  private bake(): void {
    this.lastBaked.copy(this.sunDir);
    this.cubeCamera.update(this.renderer, this.envScene);
    const next = this.pmrem.fromScene(this.envScene, 0, 1, 40000);
    this.scene.environment = next.texture;
    this.scene.environmentIntensity = 0.55;
    this.envTarget?.dispose();
    this.envTarget = next;
  }
}
