import * as THREE from 'three';
import { Sim, SIM_DT, KT, R2D, type BoatSpec, type SimState } from '@slack-tide/sim';
import { ReplayWorld } from '@slack-tide/world';
import boatJson from '../../../boats/sloop38.json';
import { BoatView, type BoatPose } from './boat/boatView';
import { DroneCamera, VIEWS } from './camera/drone';
import { Controls } from './input/controls';
import { Ocean } from './scene/ocean';
import { SkySystem } from './scene/sky';
import { Buoy, buildBridge, buildTerrain } from './scene/terrain';
import { buildWaves, setSeaState, waveHeight } from './scene/waves';
import { Chart } from './ui/chart';
import { Hud, TIME_RATES } from './ui/hud';
import { Passage } from './ui/passage';
import { Sound } from './audio/sound';
import { loadCourse } from './world/loadCourse';

const boatSpec = boatJson as unknown as BoatSpec;

// ---- session setup ------------------------------------------------------------------------------
// The world is a real past afternoon on San Francisco Bay, replayed: NOAA's model of the wind, tidal stream and tide.
// Overrides for play testing: ?start=2.5 (hours into the season) &x=1300&y=250&hdg=293
const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) ? v : fallback;
};

const data = await loadCourse();
const course = data.course;
// 16:30 local: the afternoon westerly is in and the flood is running through the Gate.
const world = new ReplayWorld(data, num('start', 2.5) * 3600);
const startX = num('x', 1300);
const startY = num('y', 250);
const startWind = world.wind(startX, startY, 0);
const sim = new Sim(boatSpec, world, { x: startX, y: startY, headingDeg: num('hdg', startWind.dir * R2D + 50), speedKt: 5 });
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
// Haze takes the far shore, as it does on the Bay.
const haze = new THREE.Fog(0xb9cbd6, 1200, 30000);
scene.fog = haze;
const sky = new SkySystem(renderer, scene);
const ocean = new Ocean(sky.reflection.texture);
scene.add(ocean.mesh);
scene.add(buildTerrain(course, data.terrain), buildBridge(course));
const buoys = course.marks.filter((m) => m.kind === 'buoy').map((m, i) => new Buoy(m.x, m.y, i % 2 ? 0x2f8f55 : 0xb5332a));
for (const b of buoys) scene.add(b.group);
const boatView = new BoatView(boatSpec);
scene.add(boatView.root);

const drone = new DroneCamera(window.innerWidth / window.innerHeight);
drone.snap(VIEWS.drone, sim.state.heading);
const hud = new Hud();
const sound = new Sound();

// The sea runs with the wind that was blowing when the session began. Its height follows the wind after that.
const waves = buildWaves(startWind.dir, startWind.speed / KT);
let seaKt = startWind.speed / KT;

// ---- passage: the route, the plan from the forecast, and what really happens ----------------------
const passage = new Passage(boatSpec.polar, {
  wind: (x, y, t) => world.wind(x, y, t, 'forecast'),
  current: (x, y, t) => world.current(x, y, t),
});
{
  // A first route round the Central Bay. The player can change every mark on the chart.
  const m = (id: string) => course.marks.find((k) => k.id === id)!;
  passage.setRoute([
    { name: 'Harding Rock', x: m('harding').x, y: m('harding').y - 160 },
    { name: 'Golden Gate', x: m('gate').x + 420, y: m('gate').y },
    { name: 'Point Blunt', x: m('blunt').x + 420, y: m('blunt').y - 520 },
    { name: 'Alcatraz', x: m('alcatraz').x + 620, y: m('alcatraz').y - 260 },
  ], { x: startX, y: startY }, 0);
}
const chart = new Chart({
  world,
  passage,
  polar: boatSpec.polar,
  now: () => sim.state.t,
  boat: () => ({ x: sim.state.x, y: sim.state.y, heading: sim.state.heading, cog: sim.out.cog, sog: sim.out.sog }),
});

let paused = false;
let rateIndex = 0;
hud.onPause = () => { paused = !paused; };
hud.onRate = (i) => { rateIndex = i; };
const controls = new Controls(canvas, drone, boatView, sim, hud, sound, {
  togglePause: () => { paused = !paused; },
  announce: (text) => hud.raiseAlarm(text, 4),
  toggleChart: () => chart.toggle(),
  closeChart: () => chart.toggle(false),
  toggleInstruments: () => {
    hud.toggleReadout();
    chart.setMiniHidden(hud.readoutHidden);
  },
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

// ---- alarms: a line of text when something needs the player, and time drops back to real speed ----
const watch = { shallow: false, aground: false, marksReached: 0 };
function alarm(text: string): void {
  hud.raiseAlarm(text, 6);
  rateIndex = 0;
  hud.setRate(0);
}
function checkAlarms(): void {
  const o = sim.out;
  if (o.aground && !watch.aground) alarm('Aground. Get her head round to deeper water');
  else if (!o.aground && o.underKeel !== null && o.underKeel < 2.5 && !watch.shallow) alarm(`Shallow water: ${o.underKeel.toFixed(1)} m under the keel`);
  watch.aground = o.aground;
  watch.shallow = o.underKeel !== null && o.underKeel < (watch.shallow ? 4 : 2.5);
  const reached = passage.nextIndex;
  if (reached > watch.marksReached) {
    const done = passage.marks[reached - 1];
    const next = passage.marks[reached];
    if (next) {
      // Work out the rest of the route again from here, so the plan stays honest.
      passage.replan({ x: sim.state.x, y: sim.state.y }, sim.state.t);
      const brg = Math.round((Math.atan2(next.x - sim.state.x, next.y - sim.state.y) * R2D + 360) % 360);
      alarm(`${done.name} astern. Next mark ${next.name}, bearing ${String(brg).padStart(3, '0')}°`);
    } else {
      alarm(`${done.name} reached. Route complete`);
    }
  }
  watch.marksReached = reached;
}

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
let frameCount = 0;
const pace = { time: 0, frames: 0, slowWindows: 0, warmup: 4 };
function keepPace(dtReal: number): void {
  if (pace.warmup > 0) { pace.warmup -= dtReal; return; }
  if (document.hidden || chart.isOpen) return;
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
      // Keep the track and mark arrivals honest at high time rates.
      if (i % 30 === 0) passage.update(sim.state, sim.state.t);
    }
    if (steps > 0) {
      after = grab(sim.state);
      passage.update(sim.state, sim.state.t);
      checkAlarms();
    }
  }
  const alpha = paused ? 1 : acc / SIM_DT;
  const seaTime = sim.state.t + (alpha - 1) * SIM_DT;

  // Blend between the last two steps so motion is smooth at any frame rate.
  const heading = mixAngle(before.heading, after.heading, alpha);
  const x = mix(before.x, after.x, alpha);
  const z = -mix(before.y, after.y, alpha);

  // The sea follows the hourly wind: slowly, as a real sea does.
  const hourly = world.wind(sim.state.x, sim.state.y, sim.state.t);
  seaKt += (hourly.speed / KT - seaKt) * Math.min(1, dtReal * rate * 0.004);
  setSeaState(waves, seaKt);
  ocean.setWaves(waves, hourly.dir, sim.out.tws / KT);

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

  for (const b of buoys) {
    const c = world.current(b.x, b.y, sim.state.t);
    b.update(waveHeight(waves, b.x, -b.y, seaTime), Math.atan2(c.x, c.y), Math.hypot(c.x, c.y), seaTime);
  }

  boatPos.set(x, pose.heave, z);
  drone.update(dtReal, boatPos, heading, (px, pz) => waveHeight(waves, px, pz, seaTime, 6), boatView.solids, boatView.thin);

  const shipTime = world.dateAt(sim.state.t);
  sky.setTime(shipTime, course.origin.lat, course.origin.lon);
  sky.follow(boatPos);
  // Haze takes the colour of the low sky: pale by day, warm toward sunset, dark after.
  const up = THREE.MathUtils.clamp(Math.sin(sky.elevation) * 3, 0, 1);
  haze.color.setRGB(0.5 + 0.22 * up, 0.42 + 0.37 * up, 0.38 + 0.46 * up).multiplyScalar(0.25 + 0.75 * THREE.MathUtils.clamp(Math.sin(sky.elevation) * 6 + 0.3, 0, 1));
  ocean.setSun(sky.sunDir, sky.sunColor);
  ocean.update(seaTime, drone.camera, { x, z, heading, speed: sim.state.speed, heel: pose.heel });

  const stream = world.current(sim.state.x, sim.state.y, sim.state.t);
  hud.update(sim.state, sim.out, {
    set: Math.atan2(stream.x, stream.y),
    drift: Math.hypot(stream.x, stream.y),
    height: world.tide(sim.state.t),
    rate: world.tideRate(sim.state.t),
    depth: sim.out.underKeel === null ? null : sim.out.underKeel + boatSpec.dimensions.draft,
  }, shipTime, course.timeZone, paused, rate, dtReal);
  chart.update(dtReal);
  const loose = Math.max(sim.out.main.luff * 0.7 + (sim.out.main.flogging ? 0.3 : 0), sim.state.furl > 0.03 ? sim.out.jib.luff * 0.7 + (sim.out.jib.flogging ? 0.3 : 0) : 0);
  sound.update(sim.out.aws / KT, sim.state.speed / KT, loose, paused);

  // With the chart open the 3D view is mostly covered, so draw it only now and then.
  frameCount++;
  if (!chart.isOpen || frameCount % 6 === 0) renderer.render(scene, drone.camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame((t) => {
  last = t;
  frame(t);
  document.getElementById('veil')?.classList.add('gone');
});

// When this page is republished while someone is sailing, hand the boat across so they carry on where they were.
interface HotReload { snapshot?: (fn: () => unknown) => void; ready?: (fn: (data: unknown) => void) => void; data?: unknown }
const hot = (window as unknown as { claude?: { hot?: HotReload } }).claude?.hot;
const resume = (saved: unknown): void => {
  const state = (saved as { sim?: SimState } | undefined)?.sim;
  if (!state || typeof state.tick !== 'number') return;
  sim.restore(state);
  before = after = grab(sim.state);
  passage.replan({ x: sim.state.x, y: sim.state.y }, sim.state.t);
};
hot?.snapshot?.(() => ({ sim: sim.snapshot() }));
if (hot?.ready) hot.ready(resume);
else resume(hot?.data);

// For play testing from the browser console.
Object.assign(window, { slackTide: { sim, world, passage, chart, drone, boatView, renderer, views: VIEWS, setPaused: (p: boolean) => { paused = p; } } });
