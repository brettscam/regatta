// The boat yard: one boat on plain ground, for looking at a model without the sea, the Bay or the game around it.
// Open /boat-preview.html?boat=sloop30&colour=%23aa2222&name=Kestrel&view=quarter
// Views: side, quarter, top, cockpit, stern, bow, hull. Add &hauled=1 to stand her upright out of the water.
// Drag to orbit, scroll to zoom.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sim, D2R, KT, type BoatSpec, type Environment } from '@slack-tide/sim';
import { BoatView, type BoatDisplay, type BoatPose, type Livery } from './boat/boatView';

const files = import.meta.glob('../../../boats/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const boats = new Map<string, BoatSpec & Partial<BoatDisplay>>();
for (const [path, json] of Object.entries(files)) {
  const spec = json as BoatSpec & Partial<BoatDisplay>;
  if (spec && typeof spec === 'object' && 'dimensions' in spec) boats.set(path.split('/').pop()!.replace('.json', ''), spec);
}

const params = new URLSearchParams(location.search);
const spec = boats.get(params.get('boat') ?? 'sloop38') ?? boats.get('sloop38')!;
const livery: Livery = {};
if (params.get('colour')) livery.topsides = params.get('colour')!;
if (params.get('name')) livery.name = params.get('name')!;
if (params.get('port')) livery.homePort = params.get('port')!;

const canvas = document.getElementById('yard') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9d3d8);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
sun.position.set(-14, 26, 12);
scene.add(sun, new THREE.HemisphereLight(0xdfeaf2, 0x6f7f86, 0.9));
// A flat sheet at the waterline, so what shows is what would show afloat.
const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x6f8b97, roughness: 0.85 }));
water.rotation.x = -Math.PI / 2;
if (params.get('hauled')) water.position.y = -spec.dimensions.draft - 0.05;
scene.add(water);

// A steady breeze on the port bow, and a sim that is never stepped: it only holds the state the view reads.
const wind: Environment = { sample: () => ({ windDir: -52 * D2R, windSpeed: 13 * KT, currentX: 0, currentY: 0 }) };
const sim = new Sim(spec, wind, { headingDeg: 0, speedKt: 6 });
sim.trimForWind();
sim.state.heel = (params.get('hauled') ? 0 : 12) * D2R;

const view = new BoatView(spec, livery);
view.setPilot({ engaged: true, mode: 'wind', label: '52° P' });
scene.add(view.root);

const L = spec.dimensions.loa;
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
const H = spec.dimensions.mastHeight;
const orbit = { yaw: 0, pitch: 0.2, dist: H * 1.75, target: new THREE.Vector3(0, H * 0.46, 0) };
switch (params.get('view') ?? 'quarter') {
  case 'side': Object.assign(orbit, { yaw: Math.PI / 2, pitch: 0.04, dist: H * 1.6 }); break;
  case 'top': Object.assign(orbit, { yaw: 0, pitch: 1.5, dist: L * 1.9 }); orbit.target.set(0, 1.5, 0); break;
  case 'cockpit': Object.assign(orbit, { yaw: 0.5, pitch: 0.42, dist: Math.max(5.5, L * 0.55) }); orbit.target.set(0, 1.9, L * 0.26); break;
  case 'bow': Object.assign(orbit, { yaw: Math.PI - 0.6, pitch: 0.12, dist: H * 1.7 }); break;
  case 'stern': Object.assign(orbit, { yaw: 0.38, pitch: 0.13, dist: L * 0.95 }); orbit.target.set(0, 1.3, L * 0.32); break;
  case 'hull': Object.assign(orbit, { yaw: 1.05, pitch: 0.16, dist: L * 1.25 }); orbit.target.set(0, 1.4, 0); break;
  default: Object.assign(orbit, { yaw: 0.62, pitch: 0.14, dist: H * 1.7 });
}
if (params.get('hauled')) orbit.target.y -= spec.dimensions.draft * 0.5;

function placeCamera(): void {
  // Yaw 0 looks forward from astern. The boat's bow is toward -Z.
  const cp = Math.cos(orbit.pitch);
  camera.position.set(
    orbit.target.x + Math.sin(orbit.yaw) * cp * orbit.dist,
    orbit.target.y + Math.sin(orbit.pitch) * orbit.dist,
    orbit.target.z + Math.cos(orbit.yaw) * cp * orbit.dist,
  );
  camera.lookAt(orbit.target);
}
let dragging = false;
canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbit.yaw -= e.movementX * 0.006;
  orbit.pitch = Math.max(-0.1, Math.min(1.55, orbit.pitch + e.movementY * 0.005));
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.max(2, Math.min(120, orbit.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let triangles = 0;
view.root.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !(m.material as THREE.Material | THREE.Material[])) return;
  const visible = Array.isArray(m.material) ? true : (m.material as THREE.Material).visible;
  if (!visible) return;
  const g = m.geometry;
  triangles += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
});
document.getElementById('card')!.innerHTML = `<b>${spec.name}</b>${spec.tagline ?? ''}<br>${L} m overall, ${spec.dimensions.beam} m beam, draws ${spec.dimensions.draft} m · ${Math.round(triangles).toLocaleString()} triangles`;

const start = performance.now();
let last = start;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const s = sim.state;
  const pose: BoatPose = { x: 0, z: 0, heading: 0, heel: s.heel, pitch: 0, heave: 0, rudder: s.rudder, boom: s.boomAngle, jib: s.jibAngle };
  view.update(pose, s, sim.out, (now - start) / 1000, dt);
  placeCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

Object.assign(window, { yard: { view, sim, triangles, renderer } });
