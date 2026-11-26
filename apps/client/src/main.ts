import { isSoundState, type SimState } from '@slack-tide/sim';
import { ReplayWorld } from '@slack-tide/world';
import { eventWater, gunTime, nextEvent, setEventWater } from './race/events';
import { BOATS, DEFAULT_BOAT, LINEUP, TOPSIDES, afloat } from './boat/yard';
import { Lobby } from './lobby';
import { Session } from './session';
import { Stage } from './stage';
import { Logbook } from './net/logbook';
import { Board } from './ui/board';
import { myAvatar } from './boat/avatar';
import { mySailStyle, onMySailStyle } from './boat/sailStyle';
import { openHome } from './ui/home';
import { JoinFlow, WEATHER, type Choice, type WaterView } from './ui/join';
import { COURSES, DEFAULT_COURSE, hasCourse, loadCourse } from './world/loadCourse';

// Regatta. The world is a real past day on real water, replayed: NOAA's models of the wind, tidal stream and tide.
// San Francisco Bay unless another water is chosen: ?course=san-juans opens on the San Juan Islands.
// For play testing, the join screen can be skipped: ?go=1 with any of &spot=gate &boat=perf45 &tutorial=1
// &time=evening or &start=8.5 (hours into the season, which begins at 08:00) &x=1300&y=250&hdg=293
const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) ? v : fallback;
};
const DEFAULT_TIME = 'afternoon';
const SAVED = 'regatta.join';

function savedChoice(): Partial<Choice> {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? '{}') as Partial<Choice>;
  } catch {
    return {};
  }
}

/** A fixed race less than an hour and a half off. */
function raceSoon() {
  const event = nextEvent(null);
  return event && gunTime(event) - Date.now() <= 90 * 60e3 ? event : null;
}

/** The water to open on: the one asked for, else where tonight's race is, else where they sailed last, else the Bay. */
function firstWater(): string {
  const asked = params.get('course');
  if (hasCourse(asked)) return asked;
  // A link to a race says which water it is on.
  const linked = params.get('water');
  if (params.has('race') && hasCourse(linked)) return linked;
  // The test parameters have always meant the Bay unless they say otherwise.
  if (params.has('go')) return DEFAULT_COURSE;
  const event = raceSoon();
  if (event && hasCourse(eventWater(event))) return eventWater(event);
  const last = savedChoice().water;
  return hasCourse(last) ? last : DEFAULT_COURSE;
}

let data = await loadCourse(firstWater());
let world = new ReplayWorld(data, 0);
setEventWater(data.about.id);

/** A complete, valid choice for the water showing, from whatever was asked for or remembered. */
function settle(c: Partial<Choice>): Choice {
  const offered = (id: string | undefined): id is string => !!id && !!BOATS[id] && LINEUP.some((e) => e.id === id && afloat(e));
  // Her own choice, else the boat this water suggests (`about.json` `boat`), else the 38.
  const boat = offered(c.boat) ? c.boat : offered(data.about.boat) ? data.about.boat : DEFAULT_BOAT;
  const { starts: spots, times } = data;
  return {
    water: data.about.id,
    spot: spots.some((s) => s.id === c.spot) ? c.spot! : spots[0].id,
    time: times.some((t) => t.id === c.time) ? c.time! : (times.find((t) => t.default) ?? times.find((t) => t.id === DEFAULT_TIME) ?? times[0]).id,
    weather: WEATHER.some((k) => k.id === c.weather) ? c.weather : 'normal',
    boat,
    colour: TOPSIDES.some((t) => t.hex === c.colour) ? c.colour! : BOATS[boat].topsides ?? TOPSIDES[0].hex,
    name: (c.name ?? '').slice(0, 18) || BOATS[boat].defaultName || 'Slack Tide',
    skipper: (c.skipper ?? '').slice(0, 16),
    tutorial: c.tutorial ?? true,
  };
}

/** With a fixed race less than an hour and a half off, the way in starts at its start, in the afternoon breeze. */
function raceNight(c: Choice): Choice {
  const event = raceSoon();
  if (!event || eventWater(event) !== data.about.id) return c;
  // Everyone in the afternoon breeze, and at the race's start if it names one.
  const spot = event.spot;
  return { ...c, spot: spot && data.starts.some((s) => s.id === spot) ? spot : c.spot, time: DEFAULT_TIME, weather: 'normal' };
}

/** Put the world's clock at the chosen time of day. ?start=hours overrides it for play testing. */
function setClock(choice: Choice): void {
  const t = data.times.find((k) => k.id === choice.time) ?? data.times[0];
  world.startOffset = num('start', t.hours) * 3600;
  const level = WEATHER.find((k) => k.id === choice.weather)?.factor ?? 1;
  world.windBoost = Math.min(2, Math.max(0.5, num('boost', (t.boost ?? 1) * level)));
}
setClock(settle({}));
const stage = new Stage(document.getElementById('view') as HTMLCanvasElement, data, world);

/** Change the water: fetch the course if it is not here yet, and put it on the stage with a world of its own. */
async function useCourse(id: string): Promise<void> {
  if (id === data.about.id) return;
  const next = await loadCourse(id);
  data = next;
  world = new ReplayWorld(data, 0);
  setEventWater(id);
  setClock(settle({}));
  stage.setCourse(data, world);
  if (lobby) lobby.spots = data.starts;
}
const waterView = (): WaterView => ({ about: data.about, spots: data.starts, times: data.times, world });

// The roadmap and the feedback form are there from the first screen.
const logbook = new Logbook();
const board = new Board(logbook);
board.places = data.places;
window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName);
  if (e.code === 'KeyB' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) board.toggle();
  else if (e.code === 'Escape' && board.isOpen) board.toggle(false);
});

let session: Session | null = null;
/** Stops the current sail from following the Profile tab's sail choices. */
let stopSails: (() => void) | undefined;
let lobby: Lobby | null = null;
let chosen: Choice | null = null;

function castOff(choice: Choice, resume?: SimState, clock?: number): void {
  chosen = choice;
  try {
    // Next time, the lesson is not offered by default: they have been aboard before.
    localStorage.setItem(SAVED, JSON.stringify({ ...choice, tutorial: false }));
  } catch { /* private window: nothing to remember */ }
  setClock(choice);
  // Carrying on after a republish: the clock goes back to where it was, a night at anchor included.
  if (resume && typeof clock === 'number' && Number.isFinite(clock)) world.startOffset = clock;
  // The day moved on while the join screen was up.
  if (lobby) {
    world.shiftTime(lobby.elapsed);
    lobby.dispose();
    lobby = null;
  }
  const spot = data.starts.find((s) => s.id === choice.spot) ?? data.starts[0];
  document.body.classList.remove('lobby');
  // The bar-hop card lists the places of the water she is on.
  board.places = data.places;
  session = new Session(stage, {
    spec: BOATS[choice.boat],
    livery: { topsides: choice.colour, name: choice.name, homePort: BOATS[choice.boat].homePort, avatar: myAvatar(), sails: mySailStyle() },
    x: num('x', spot.x),
    y: num('y', spot.y),
    headingDeg: params.has('hdg') ? num('hdg', 0) : undefined,
    route: spot.route,
    // The lesson is a sailing lesson: there is none for a boat with no sails.
    tutorial: choice.tutorial && !resume && !BOATS[choice.boat].power,
    skipper: choice.skipper,
    logbook,
    places: data.places,
    features: data.features,
    races: data.races,
    boardOpen: () => board.isOpen,
    boats: BOATS,
    classes: Object.fromEntries(LINEUP.filter((e) => e.status === 'ready').map((e) => [e.id, BOATS[e.id]])),
    resume,
  });
  // Sails chosen on the Profile tab go up at once. The livery keeps them, since a class race rebuilds her from it.
  stopSails?.();
  stopSails = onMySailStyle((style) => {
    session?.setSailStyle(style);
  });
  board.context = () => ({ ...session!.report(), spot: choice.spot, startTime: choice.time });
  const handles = session.debug();
  Object.assign(handles, { stage });
  Object.assign(window, { regatta: handles, slackTide: handles });
}

// When this page is republished while someone is sailing, hand the boat across so they carry on where they were.
interface HotReload { snapshot?: (fn: () => unknown) => void; ready?: (fn: (data: unknown) => void) => void; data?: unknown }
const hot = (window as unknown as { claude?: { hot?: HotReload } }).claude?.hot;
hot?.snapshot?.(() => (session && chosen ? { sim: session.snapshot(), choice: chosen, clock: world.startOffset } : {}));
const resume = async (saved: unknown): Promise<void> => {
  const s = saved as { sim?: SimState; choice?: Partial<Choice>; clock?: number } | undefined;
  // Only carry on from a state that is whole. Anything else starts again from the join screen.
  if (session || !isSoundState(s?.sim) || !s?.choice) return;
  // She carries on in the water she was in. A boat handed over from before there was a choice was on the Bay.
  const water = hasCourse(s.choice.water) ? s.choice.water : DEFAULT_COURSE;
  try {
    await useCourse(water);
  } catch {
    return;
  }
  if (session) return;
  castOff(settle(s.choice), s.sim, s.clock);
};

let begun = false;
function begin(): void {
  if (session || begun) return;
  begun = true;
  if (params.has('go')) {
    castOff(settle({ time: params.get('time') ?? undefined, spot: params.get('spot') ?? undefined, boat: params.get('boat') ?? undefined, colour: params.get('colour') ?? undefined, name: params.get('name') ?? undefined, skipper: params.get('skipper') ?? undefined, tutorial: params.get('tutorial') === '1' }));
    return;
  }
  document.body.classList.add('lobby');
  lobby = new Lobby(stage, data.starts, BOATS);
  // The front page first. A link to a race goes straight to the way in, as it always has.
  if (params.has('race')) return wayIn();
  const last = savedChoice();
  openHome({
    choice: raceNight(settle(last)),
    returning: typeof last.spot === 'string' && typeof last.boat === 'string',
    boats: BOATS,
    waters: COURSES,
    spots: data.starts,
    show: (choice) => {
      setClock(choice);
      lobby?.show(choice, -1);
    },
    onSail: wayIn,
    onCastOff: (choice) => castOff(choice),
    onBoard: (tab) => board.toggle(true, tab),
    // A second way to play is added here: { id, title, say, open }. See `HomeMode` in ui/home.ts.
    modes: [],
  });
}

/** The way in: where, lesson, boat. */
function wayIn(): void {
  new JoinFlow({
    ...waterView(),
    waters: COURSES,
    lineup: LINEUP,
    boats: BOATS,
    initial: raceNight(settle(savedChoice())),
    onWater: async (id) => {
      await useCourse(id);
      return waterView();
    },
    onPreview: (choice, step) => {
      setClock(choice);
      lobby?.show(choice, step);
    },
    onCastOff: (choice) => castOff(choice),
  });
}

if (hot?.ready) {
  hot.ready((saved) => { void resume(saved).then(begin); });
  // If the hand-over never answers, start anyway.
  setTimeout(begin, 2500);
} else {
  await resume(hot?.data);
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
