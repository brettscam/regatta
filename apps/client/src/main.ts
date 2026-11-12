import * as THREE from 'three';
import { Sim, SIM_DT, KT, type BoatSpec, type SimState } from '@slack-tide/sim';
import { steadyWorld } from '@slack-tide/world';
import boatJson from '../../../boats/sloop38.json';
import { BoatView, type BoatPose } from './boat/boatView';
import { DroneCamera, VIEWS } from './camera/drone';
import { Controls } from './input/controls';
import { Ocean } from './scene/ocean';
import { SkySystem } from './scene/sky';
import { buildWaves, waveHeight } from './scene/waves';
import { Hud, TIME_RATES } from './ui/hud';
import { Sound } from './audio/sound';

const D2R = Math.PI / 180;
const boatSpec = boatJson as unknown as BoatSpec;

// ---- session setup ------------------------------------------------------------------------------
// Milestone 1 world: open water off San Francisco with one steady wind.
// Overrides for play testing: ?wind=18&from=250&hdg=300&time=2024-07-14T23:30:00Z
const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) ? v : fallback;
};
const SITE = { lat: 37.83, lon: -122.47, timeZone: 'America/Los_Angeles' };
const windFromDeg = num('from', 250);
const windKt = num('wind', 14);
const startDate = new Date(params.get('time') ?? '2024-07-15T00:20:00Z'); // 17:20 local, the afternoon westerly

const env = steadyWorld({ fromDeg: windFromDeg, speedKt: windKt });
const sim = new Sim(boatSpec, env, { headingDeg: num('hdg', windFromDeg + 52), speedKt: 5 });
sim.trimForWind();
// Until the player takes the wheel, the boat holds her angle to the wind.
sim.setHelm('wind');

// ---- renderer and scene -------------------------------------------------------------------------
const canvas = document.getElementById('view') as HTMLCanvasElement;
canvas.tabIndex = 0;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.46;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const sky = new SkySystem(renderer, scene);
const ocean = new Ocean(sky.reflection.texture);
scene.add(ocean.mesh);
const boatView = new BoatView(boatSpec);
scene.add(boatView.root);

const drone = new DroneCamera(window.innerWidth / window.innerHeight);
drone.snap(VIEWS.drone, sim.state.heading);
const hud = new Hud();
const sound = new Sound();

const windFrom = windFromDeg * D2R;
const waves = buildWaves(windFrom, windKt);
ocean.setWaves(waves, windFrom, windKt);

let paused = false;
let rateIndex = 0;
hud.onPause = () => { paused = !paused; };
hud.onRate = (i) => { rateIndex = i; };
const controls = new Controls(canvas, drone, boatView, sim, hud, sound, {
  togglePause: () => { paused = !paused; },
  announce: (text) => hud.raiseAlarm(text, 4),
});

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  drone.camera.aspect = w / h;
  drone.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- loop ---------------------------------------------------------------------------------------
type Snapshot = Pick<SimState, 'x' | 'y' | 'heading' | 'heel' | 'rudder' | 'boomAngle' | 'jibAngle'>;
const grab = (s: SimState): Snapshot => ({ x: s.x, y: s.y, heading: s.heading, heel: s.heel, rudder: s.rudder, boomAngle: s.boomAngle, jibAngle: s.jibAngle });
let before = grab(sim.state);
let after = grab(sim.state);
let acc = 0;
let last = performance.now();
const motion = { heave: 0, pitch: 0, roll: 0 };
const boatPos = new THREE.Vector3();
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// Hold 60 frames a second: if frames run long for a while, render fewer pixels. Never below 1x.
// It only ever steps down, so the picture cannot flicker between two sizes.
let pixelRatio = Math.min(window.devicePixelRatio, 2);
const pace = { time: 0, frames: 0, slowWindows: 0, warmup: 4 };
function keepPace(dtReal: number): void {
  if (pace.warmup > 0) { pace.warmup -= dtReal; return; }
  if (document.hidden) return;
  pace.time += dtReal;
  pace.frames++;
  if (pace.time < 2) return;
  const avg = pace.time / pace.frames;
  pace.time = 0;
  pace.frames = 0;
  pace.slowWindows = avg > 1 / 50 ? pace.slowWindows + 1 : 0;
  if (pace.slowWindows >= 2 && pixelRatio > 1) {
    pace.slowWindows = 0;
    pixelRatio = Math.max(1, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio);
    resize();
  }
}

function frame(now: number): void {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  keepPace(dtReal);
  const rate = TIME_RATES[rateIndex];

  controls.update(dtReal, paused);

  // Fixed steps. Faster time just means more of them per frame.
  if (!paused) {
    acc += dtReal * rate;
    let steps = Math.floor(acc / SIM_DT);
    acc -= steps * SIM_DT;
    steps = Math.min(steps, 600);
    for (let i = 0; i < steps; i++) {
      if (i === steps - 1) before = after;
      sim.step();
    }
    if (steps > 0) after = grab(sim.state);
  }
  const alpha = paused ? 1 : acc / SIM_DT;
  const seaTime = sim.state.t + (alpha - 1) * SIM_DT;

  // Blend between the last two steps so motion is smooth at any frame rate.
  const heading = mixAngle(before.heading, after.heading, alpha);
  const x = mix(before.x, after.x, alpha);
  const z = -mix(before.y, after.y, alpha);

  // Let the hull ride the long waves: heave, pitch and a little roll.
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  const hBow = waveHeight(waves, x + fx * 4.2, z + fz * 4.2, seaTime);
  const hStern = waveHeight(waves, x - fx * 4.2, z - fz * 4.2, seaTime);
  const hStbd = waveHeight(waves, x - fz * 1.4, z + fx * 1.4, seaTime);
  const hPort = waveHeight(waves, x + fz * 1.4, z - fx * 1.4, seaTime);
  const hMid = waveHeight(waves, x, z, seaTime);
  const ease = paused ? 0 : Math.min(1, dtReal * 5);
  motion.heave += ((hBow + hStern + 2 * hMid) / 4 - motion.heave) * ease;
  motion.pitch += (Math.atan2(hBow - hStern, 8.4) * 0.8 - motion.pitch) * ease;
  motion.roll += (Math.atan2(hPort - hStbd, 2.8) * 0.5 - motion.roll) * ease;

  const pose: BoatPose = {
    x, z, heading,
    heel: mix(before.heel, after.heel, alpha) + motion.roll,
    pitch: motion.pitch,
    heave: motion.heave - 0.03,
    rudder: mix(before.rudder, after.rudder, alpha),
    boom: mix(before.boomAngle, after.boomAngle, alpha),
    jib: mix(before.jibAngle, after.jibAngle, alpha),
  };
  boatView.update(pose, sim.state, sim.out, seaTime, paused ? 0 : dtReal);
  boatView.root.updateMatrixWorld(true);

  boatPos.set(x, pose.heave, z);
  drone.update(dtReal, boatPos, heading, (px, pz) => waveHeight(waves, px, pz, seaTime, 6), boatView.solids, boatView.thin);

  const shipTime = new Date(startDate.getTime() + sim.state.t * 1000);
  sky.setTime(shipTime, SITE.lat, SITE.lon);
  sky.follow(boatPos);
  ocean.setSun(sky.sunDir, sky.sunColor);
  ocean.update(seaTime, drone.camera, { x, z, heading, speed: sim.state.speed, heel: pose.heel });

  hud.update(sim.state, sim.out, shipTime, SITE.timeZone, paused, rate, dtReal);
  const loose = Math.max(sim.out.main.luff * 0.7 + (sim.out.main.flogging ? 0.3 : 0), sim.state.furl > 0.03 ? sim.out.jib.luff * 0.7 + (sim.out.jib.flogging ? 0.3 : 0) : 0);
  sound.update(sim.out.aws / KT, sim.state.speed / KT, loose, paused);

  renderer.render(scene, drone.camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame((t) => {
  last = t;
  frame(t);
  document.getElementById('veil')?.classList.add('gone');
});

// For play testing from the browser console.
Object.assign(window, { slackTide: { sim, drone, boatView, renderer, views: VIEWS, setPaused: (p: boolean) => { paused = p; } } });
