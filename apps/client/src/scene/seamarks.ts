import * as THREE from 'three';
import { lightShows, type Light } from '../world/features';
import { cityNight } from './massing';

/**
 * Lighthouses and lit marks, from a water's `features.json`. Each is a white tower on the land at its place (or on a
 * rock of its own, for one that stands in the sea), with a lamp that shows after dark in the light's own rhythm:
 * a flash every five seconds for Point Reyes, three seconds on and one off for Point Bonita.
 * The rhythm is a pure function of the season's clock, so every boat sees the same flash at the same moment.
 */
export class Seamarks {
  readonly group = new THREE.Group();
  private readonly lamps: Array<{ light: Light; glow: THREE.Sprite; lens: THREE.Mesh; y: number }> = [];

  /** @param heightAt height of the land at a course position, metres */
  constructor(lights: Light[], heightAt: (x: number, y: number) => number) {
    this.group.name = 'seamarks';
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.7 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.95 });
    const glare = glowTexture();
    for (const l of lights) {
      const at = new THREE.Group();
      at.position.set(l.x, 0, -l.y);
      let lampY = l.focal;
      if (l.on !== 'buoy') {
        // The tower stands so its lamp is at the charted height. Where the land under it is lower than that, it stands on
        // the land and the lamp comes out where it comes out; where the baked land is higher or missing, the chart wins.
        const ground = l.on === 'rock' ? 0 : heightAt(l.x, l.y);
        let base = Math.max(0, l.focal - l.tower);
        if (ground > 0.5 && Math.abs(ground - base) < 30) base = ground;
        if (l.on === 'rock' || ground <= 0.5) {
          // A rock of its own to stand on: black, wave-washed, a little wider than the tower.
          const rock = new THREE.Mesh(new THREE.CylinderGeometry(l.on === 'rock' ? 9 : 5, l.on === 'rock' ? 15 : 8, base + 6, 9), stone);
          rock.position.y = (base + 6) / 2 - 6;
          at.add(rock);
        }
        const r = Math.max(1.6, l.tower * 0.16);
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r, l.tower, 12), white);
        tower.position.y = base + l.tower / 2;
        const gallery = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.5, 12), dark);
        gallery.position.y = base + l.tower;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.8, r * 0.9, 12), dark);
        cap.position.y = base + l.tower + 2.4 + r * 0.45;
        at.add(tower, gallery, cap);
        lampY = base + l.tower + 1.2;
      }
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 10), new THREE.MeshBasicMaterial({ color: 0x3a3d40 }));
      lens.position.y = lampY;
      if (l.on !== 'buoy') at.add(lens);
      // The loom of the light: a sprite that keeps its size on the screen, so a light twenty miles off is still a point of light.
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glare, color: l.colour ?? '#fff3d0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, fog: false }));
      glow.position.y = lampY;
      glow.visible = false;
      at.add(glow);
      at.traverse((o) => { o.castShadow = true; });
      glow.castShadow = false;
      this.group.add(at);
      this.lamps.push({ light: l, glow, lens, y: lampY });
    }
  }

  /** @param seasonTime seconds into the season */
  update(seasonTime: number, camera: THREE.Camera): void {
    const night = cityNight.value;
    for (const { light, glow, lens } of this.lamps) {
      const lit = night > 0.05 && lightShows(light, seasonTime);
      (lens.material as THREE.MeshBasicMaterial).color.setHex(lit ? 0xfff6d8 : 0x3a3d40);
      glow.visible = lit;
      if (!lit) continue;
      // Brighter close to, never smaller than a star; gone beyond the light's range.
      const away = Math.hypot(camera.position.x - light.x, camera.position.z + light.y);
      const reach = light.range * 1852;
      const size = THREE.MathUtils.clamp(0.05 * (1500 / Math.max(300, away)) ** 0.5, 0.012, 0.07);
      glow.scale.setScalar(size);
      (glow.material as THREE.SpriteMaterial).opacity = night * THREE.MathUtils.clamp(1.4 - away / reach, 0, 1);
    }
  }
}

/** A soft round glare with a bright centre. */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
