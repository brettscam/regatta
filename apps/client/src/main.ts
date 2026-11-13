import type { SimState } from '@slack-tide/sim';
import { ReplayWorld } from '@slack-tide/world';
import startsJson from '../../../courses/sf-bay/starts.json';
import timesJson from '../../../courses/sf-bay/times.json';
import { BOATS, DEFAULT_BOAT, LINEUP, TOPSIDES } from './boat/yard';
import { Lobby } from './lobby';
import { Session } from './session';
import { Stage } from './stage';
import { JoinFlow, type Choice, type StartSpot, type StartTime } from './ui/join';
import { loadCourse } from './world/loadCourse';

// Regatta. The world is a real past afternoon on San Francisco Bay, replayed: NOAA's model of the wind, tidal stream and tide.
// For play testing, the join screen can be skipped: ?go=1 with any of &spot=gate &boat=perf45 &tutorial=1
// &time=evening or &start=8.5 (hours into the season, which begins at 08:00) &x=1300&y=250&hdg=293
const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) ? v : fallback;
};
const spots = startsJson as StartSpot[];
const times = timesJson as StartTime[];
const DEFAULT_TIME = 'afternoon';
const SAVED = 'regatta.join';

function savedChoice(): Partial<Choice> {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? '{}') as Partial<Choice>;
  } catch {
    return {};
  }
}

/** A complete, valid choice from whatever was asked for or remembered. */
function settle(c: Partial<Choice>): Choice {
  const boat = c.boat && BOATS[c.boat] && LINEUP.some((e) => e.id === c.boat && e.status === 'ready') ? c.boat : DEFAULT_BOAT;
  return {
    spot: spots.some((s) => s.id === c.spot) ? c.spot! : spots[0].id,
    time: times.some((t) => t.id === c.time) ? c.time! : DEFAULT_TIME,
    boat,
    colour: TOPSIDES.some((t) => t.hex === c.colour) ? c.colour! : BOATS[boat].topsides ?? TOPSIDES[0].hex,
    name: (c.name ?? '').slice(0, 18) || BOATS[boat].defaultName || 'Slack Tide',
    tutorial: c.tutorial ?? true,
  };
}

const data = await loadCourse();
const world = new ReplayWorld(data, 0);
/** Put the world's clock at the chosen time of day. ?start=hours overrides it for play testing. */
function setClock(choice: Choice): void {
  const t = times.find((k) => k.id === choice.time) ?? times[0];
  world.startOffset = num('start', t.hours) * 3600;
}
setClock(settle({}));
const stage = new Stage(document.getElementById('view') as HTMLCanvasElement, data, world);

let session: Session | null = null;
let lobby: Lobby | null = null;
let chosen: Choice | null = null;

function castOff(choice: Choice, resume?: SimState): void {
  chosen = choice;
  try {
    // Next time, the lesson is not offered by default: they have been aboard before.
    localStorage.setItem(SAVED, JSON.stringify({ ...choice, tutorial: false }));
  } catch { /* private window: nothing to remember */ }
  setClock(choice);
  // The day moved on while the join screen was up.
  if (lobby) {
    world.shiftTime(lobby.elapsed);
    lobby.dispose();
    lobby = null;
  }
  const spot = spots.find((s) => s.id === choice.spot) ?? spots[0];
  document.body.classList.remove('lobby');
  session = new Session(stage, {
    spec: BOATS[choice.boat],
    livery: { topsides: choice.colour, name: choice.name, homePort: BOATS[choice.boat].homePort },
    x: num('x', spot.x),
    y: num('y', spot.y),
    headingDeg: params.has('hdg') ? num('hdg', 0) : undefined,
    route: spot.route,
    tutorial: choice.tutorial && !resume,
    boats: BOATS,
    resume,
  });
  const handles = session.debug();
  Object.assign(window, { regatta: handles, slackTide: handles });
}

// When this page is republished while someone is sailing, hand the boat across so they carry on where they were.
interface HotReload { snapshot?: (fn: () => unknown) => void; ready?: (fn: (data: unknown) => void) => void; data?: unknown }
const hot = (window as unknown as { claude?: { hot?: HotReload } }).claude?.hot;
hot?.snapshot?.(() => (session && chosen ? { sim: session.snapshot(), choice: chosen } : {}));
const resume = (saved: unknown): void => {
  const s = saved as { sim?: SimState; choice?: Partial<Choice> } | undefined;
  if (session || !s?.sim || typeof s.sim.tick !== 'number' || !s.choice) return;
  castOff(settle(s.choice), s.sim);
};

function begin(): void {
  if (session) return;
  if (params.has('go')) {
    castOff(settle({ time: params.get('time') ?? undefined, spot: params.get('spot') ?? undefined, boat: params.get('boat') ?? undefined, colour: params.get('colour') ?? undefined, name: params.get('name') ?? undefined, tutorial: params.get('tutorial') === '1' }));
    return;
  }
  document.body.classList.add('lobby');
  lobby = new Lobby(stage, spots, BOATS);
  new JoinFlow({
    spots,
    times,
    lineup: LINEUP,
    boats: BOATS,
    world,
    initial: settle(savedChoice()),
    onPreview: (choice, step) => {
      setClock(choice);
      lobby?.show(choice, step);
    },
    onCastOff: (choice) => castOff(choice),
  });
}

if (hot?.ready) {
  hot.ready((saved) => { resume(saved); begin(); });
} else {
  resume(hot?.data);
  begin();
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (session) session.frame(dt);
  else lobby?.frame(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  document.getElementById('veil')?.classList.add('gone');
});
