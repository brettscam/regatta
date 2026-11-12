import * as THREE from 'three';

const D2R = Math.PI / 180;

/** Where the sun is for a place and moment. Azimuth is clockwise from north, both in radians. */
export function sunAngles(date: Date, latDeg: number, lonDeg: number): { azimuth: number; elevation: number } {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const g = (357.529 + 0.98560028 * d) * D2R;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const e = (23.439 - 0.00000036 * d) * D2R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmstHours = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const ha = (gmstHours * 15 + lonDeg) * D2R - ra;
  const lat = latDeg * D2R;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const azimuth = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  return { azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI), elevation };
}

/** Unit vector toward the sun in world space: X east, Y up, Z south. */
export function sunDirection(azimuth: number, elevation: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(elevation);
  return out.set(Math.sin(azimuth) * c, Math.sin(elevation), -Math.cos(azimuth) * c);
}
