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

/** Where the moon is, and how much of its face is lit (0 new, 1 full). Good to a degree or two, which is plenty to light a sea by. */
export function moonAngles(date: Date, latDeg: number, lonDeg: number): { azimuth: number; elevation: number; lit: number } {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const d = jd - 2451543.5;
  const N = (125.1228 - 0.0529538083 * d) * D2R;
  const i = 5.1454 * D2R;
  const w = (318.0634 + 0.1643573223 * d) * D2R;
  const a = 60.2666;
  const e = 0.0549;
  const M = (115.3654 + 13.0649929509 * d) * D2R;
  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i));
  const yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i));
  const zh = r * Math.sin(v + w) * Math.sin(i);
  const ecl = (23.4393 - 3.563e-7 * d) * D2R;
  const ye = yh * Math.cos(ecl) - zh * Math.sin(ecl);
  const ze = yh * Math.sin(ecl) + zh * Math.cos(ecl);
  const ra = Math.atan2(ye, xh);
  const dec = Math.atan2(ze, Math.hypot(xh, ye));
  const dj = jd - 2451545.0;
  const gmstHours = (((18.697374558 + 24.06570982441908 * dj) % 24) + 24) % 24;
  const ha = (gmstHours * 15 + lonDeg) * D2R - ra;
  const lat = latDeg * D2R;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const azimuth = (Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha)) + 2 * Math.PI) % (2 * Math.PI);
  // How far round from the sun it is tells how much of the lit half faces us.
  const sun = sunAngles(date, latDeg, lonDeg);
  const cosApart = Math.sin(elevation) * Math.sin(sun.elevation) + Math.cos(elevation) * Math.cos(sun.elevation) * Math.cos(azimuth - sun.azimuth);
  return { azimuth, elevation, lit: (1 - cosApart) / 2 };
}
