// Fishes a simulated spell on a water with nobody watching, by a simple scripted angler in several styles, and prints
// the catches, the points and a tournament's result. For tuning: an hour's fishing should be neither empty nor a slot machine.
// Usage: npx vite-node scripts/fishmorning.ts [hours into the season, 0.5 is first light] [minutes, 60] [quiet]
//        npx vite-node scripts/fishmorning.ts day     prints fish and points an hour for each style through the day
import { BITE_SPELL, biteIn, typicalWait, wayOf, type Tackle } from '../apps/client/src/fishing/bites';
import { derbyRivals, makeDerby, rodSkill, rivalFish, standings, FORMATS, formatWords, type DerbyFish, type DerbyRow } from '../apps/client/src/fishing/derby';
import { startFight, stepFight, steadyHand } from '../apps/client/src/fishing/fight';
import { paddiesAt, schoolsAt, spotAt, spooks, type Sea } from '../apps/client/src/fishing/grounds';
import { hereOf } from '../apps/client/src/fishing/here';
import { bigness, fishWords, poundWords } from '../apps/client/src/fishing/points';
import { tableOf } from '../apps/client/src/fishing/table';
import { freshAt, landFish, newTrip, workPatch, type Trip } from '../apps/client/src/fishing/trip';
import { reservesOf } from '../apps/client/src/fishing/zones';
import { worldOf } from '../apps/client/test/waters';

const WATER = 'catalina';
const KT = 0.514444;
const table = tableOf(WATER)!;
const reserves = reservesOf(WATER);
const TZ = 'America/Los_Angeles';

interface Boat { x: number; y: number; speedKt: number; held: boolean; lineIn?: boolean }
interface Ctx { t: number; seasonNow: number; sea: Sea; stream: { x: number; y: number }; down: Set<number> }
interface Style { name: string; say: string; tackle: Tackle; start: Boat; move(b: Boat, c: Ctx, dt: number): void }

const toward = (b: Boat, x: number, y: number, kt: number, dt: number): number => {
  const d = Math.hypot(x - b.x, y - b.y);
  const step = Math.min(d, kt * KT * dt);
  if (d > 1) { b.x += ((x - b.x) / d) * step; b.y += ((y - b.y) / d) * step; }
  b.speedKt = kt;
  return d - step;
};

/** Tows lures down a line at a set speed, turning aside to pass the edge of any paddy or school she comes in sight of. */
function troller(name: string, say: string, lure: Tackle['lure'], rods: number, kt: number, from: [number, number], to: [number, number]): Style {
  let leg = 0;
  let pass: { key: number; n: number } | null = null;
  const done = new Set<number>();
  return {
    name, say, tackle: { lure, rig: 'iron', bait: 0, rods }, start: { x: from[0], y: from[1], speedKt: kt, held: false },
    move(b, c, dt) {
      const things = [...paddiesAt(table, c.seasonNow, c.sea).filter((p) => p.holding).map((p) => ({ ...p, sight: 550 })), ...schoolsAt(table, c.seasonNow, c.sea).map((s) => ({ ...s, sight: 1600 }))]
        .filter((p) => !done.has(p.key) && Math.hypot(p.x - b.x, p.y - b.y) < p.sight);
      const near = things.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
      if (near) {
        if (!pass || pass.key !== near.key) pass = { key: near.key, n: 0 };
        // Round it in a square 110 m off, three times, then on her way.
        const corners = [[110, 110], [110, -110], [-110, -110], [-110, 110]];
        const [ox, oy] = corners[pass.n % 4];
        if (toward(b, near.x + ox, near.y + oy, kt, dt) < 5 && ++pass.n >= 12) done.add(near.key);
        return;
      }
      const target = leg % 2 === 0 ? to : from;
      if (toward(b, target[0], target[1], kt, dt) < 20) leg++;
    },
  };
}

/** Lies or drifts at a place with a rig. Drifting, she is carried by the stream and a little by the wind, and motors back up when she has gone too far. */
function sitter(name: string, say: string, rig: Tackle['rig'], bait: number, at: [number, number], held: boolean, driftKt = 0.5, range = 250): Style {
  return {
    name, say, tackle: { lure: 'feather', rig, bait, rods: 1 }, start: { x: at[0], y: at[1], speedKt: 0, held },
    move(b, c, dt) {
      if (held) return;
      const set = Math.hypot(c.stream.x, c.stream.y) || 1;
      b.x += ((c.stream.x / set) * driftKt * KT + c.stream.x) * dt;
      b.y += ((c.stream.y / set) * driftKt * KT + c.stream.y) * dt;
      b.speedKt = 0.2;
      if (Math.hypot(b.x - at[0], b.y - at[1]) > range) { b.x = at[0]; b.y = at[1]; }
    },
  };
}

/** Runs at speed to the nearest birds or holding paddy she knows of, stops short, and casts until they go down. */
function runAndGun(name: string, say: string, rig: Tackle['rig'], bait: number, from: [number, number]): Style {
  return {
    name, say, tackle: { lure: 'feather', rig, bait, rods: 1 }, start: { x: from[0], y: from[1], speedKt: 0, held: false },
    move(b, c, dt) {
      const things = [...schoolsAt(table, c.seasonNow, c.sea).filter((s) => !c.down.has(s.key)), ...paddiesAt(table, c.seasonNow, c.sea).filter((p) => p.holding)];
      const near = things.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
      if (!near) { b.speedKt = 0; b.lineIn = false; return; }
      const d = Math.hypot(near.x - b.x, near.y - b.y);
      if (d > 75) { toward(b, near.x, near.y, d > 400 ? 20 : 5, dt); b.lineIn = d > 400; } else { b.speedKt = 0.3; b.lineIn = false; }
    },
  };
}

interface Result { trip: Trip; bites: number; fish: DerbyFish[]; log: string[]; fightS: number; wait: number[] }

function fish(style: Style, startHours: number, minutes: number): Result {
  const world = worldOf(WATER, startHours);
  const sea: Sea = { depth: (x, y) => world.chartDepth(x, y) };
  const b: Boat = { ...style.start };
  const tackle = { ...style.tackle };
  const trip = newTrip();
  const down = new Set<number>();
  const out: Result = { trip, bites: 0, fish: [], log: [], fightS: 0, wait: [] };
  let rest = BITE_SPELL;
  const clock = (t: number) => { const d = new Date(world.dateAt(t).getTime()); return d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); };
  for (let t = 0; t < minutes * 60; t++) {
    const seasonNow = world.seasonTime(t);
    const c = world.current(b.x, b.y, t, { x: 0, y: 0 });
    style.move(b, { t, seasonNow, sea, stream: c, down }, 1);
    for (const s of schoolsAt(table, seasonNow, sea)) if (spooks(Math.hypot(s.x - b.x, s.y - b.y), b.speedKt)) down.add(s.key);
    if (rest > 0) rest--;
    if (t % BITE_SPELL || rest > 0 || b.lineIn) continue;
    const spot = spotAt(table, reserves, hereOf(world, TZ, b.x, b.y, t, b.speedKt, b.speedKt, b.held), seasonNow, sea, down);
    const fresh = freshAt(trip, b.x, b.y, seasonNow);
    if (t % 600 === 0) out.wait.push(typicalWait(table, spot, tackle, fresh));
    const hooked = biteIn(table, spot, tackle, Math.floor(seasonNow / BITE_SPELL), fresh);
    if (!hooked) continue;
    out.bites++;
    workPatch(trip, b.x, b.y, seasonNow);
    if (wayOf(spot, tackle) === 'bait') tackle.bait--;
    const f = startFight(hooked.species.fight, bigness(hooked.species, hooked.cm), hooked.seed, hooked.way === 'troll' ? 40 : spot.casting ? 35 : Math.min(60, 6 + spot.depth * 0.6));
    while (!f.result && f.t < 1800) stepFight(f, steadyHand(f), 1 / 20);
    out.fightS += f.t;
    t += Math.round(f.t);
    rest = 40;
    if (f.result !== 'landed') {
      trip.lost++;
      out.log.push(`${clock(t)}  lost a ${hooked.species.name} (${f.result ?? 'gave up'}) after ${Math.round(f.t)} s`);
      continue;
    }
    // The scripted angler keeps what she may and lets the rest go.
    const l = landFish(trip, WATER, hooked, 'keep');
    if (l.fate !== 'poached') out.fish.push({ id: l.id, cm: l.cm, kept: l.fate === 'kept', m: Math.floor(t / 60) });
    out.log.push(`${clock(t)}  ${fishWords(l.name, l.cm, l.kg).padEnd(38)} ${String(l.points).padStart(5)} pts  ${l.fate.padEnd(9)} ${hooked.way.padEnd(6)} fight ${String(Math.round(f.t)).padStart(3)} s  ${spot.platform ? spot.platform.p.name : spot.casting ? (spot.school ? `casting to ${spot.school.school.kind}` : 'casting to a paddy') : spot.ground?.name ?? (spot.paddy && spot.paddy.d < 300 ? 'past a paddy' : spot.school && spot.school.d < 300 ? `past ${spot.school.school.kind}` : 'open water')}`);
  }
  return out;
}

const styles = (): Style[] => [
  troller('Troll, feathers, sail', 'A sailing boat reaching along the breakwater and out past Horseshoe Kelp at 6 kt with feathers on one rod', 'feather', 1, 6, [10500, 18300], [7400, 13300]),
  troller('Troll, plugs, power', 'A powerboat with two rods towing plugs at 7.5 kt from Queens Gate across the channel towards Hen Rock', 'plug', 2, 7.5, [10500, 17500], [-5000, -16000]),
  troller('Troll, marlin lure', 'A powerboat dragging the big lure at 8 kt along the far side, off the East End', 'marlin', 2, 8, [3000, -24000], [-9000, -11000]),
  sitter('Bait, Platform Edith', 'Drifting live bait 170 m off Platform Edith, started on the up-current side', 'bait', 12, [14770 - 120, 5080 + 120], false, 0.25, 330),
  sitter('Squid, Platform Edith', 'The same drift with squid on the bottom', 'squid', 0, [14770 - 120, 5080 + 120], false, 0.25, 330),
  sitter('Bait, kelp, Hen Rock', 'Anchored on the kelp at Hen Rock, just outside the Long Point reserve, with live bait', 'bait', 12, [-6116, -16707], true),
  sitter('Iron, kelp, Hen Rock', 'The same spot with the iron and no bait', 'iron', 0, [-6116, -16707], true),
  sitter('Bait, harbor flats', 'Drifting a live bait over the sand inside the breakwater', 'bait', 12, [14000, 21000], false, 0.5, 500),
  sitter('Squid, Horseshoe Kelp', 'Anchored on Horseshoe Kelp with squid', 'squid', 0, [7400, 13300], true),
  runAndGun('Run and gun, iron', 'A powerboat running to the birds and the paddies in the channel and casting the iron', 'iron', 0, [6000, 6000]),
  runAndGun('Run and gun, bait', 'The same with a tank of live bait', 'bait', 24, [6000, 6000]),
];

const args = process.argv.slice(2);
if (args[0] === 'day') {
  const hours = [0.5, 1.5, 3, 7, 11, 14.5, 17.5];
  console.log(`Fish landed and points in one hour's fishing, by style and time of day (hours into the season; it starts at 05:00). ${table.name}.`);
  console.log(`${'style'.padEnd(26)}${hours.map((h) => `${String(Math.floor(5 + h) % 24).padStart(2, '0')}:${h % 1 ? '30' : '00'}`.padStart(13)).join('')}`);
  for (let i = 0; i < styles().length; i++) {
    const cells = hours.map((h) => { const r = fish(styles()[i], h, 60); return `${r.trip.landed.length}f ${r.trip.lost}l ${r.trip.points}p`.padStart(13); });
    console.log(`${styles()[i].name.padEnd(26)}${cells.join('')}`);
  }
} else {
  const startHours = Number(args[0] ?? 0.5);
  const minutes = Number(args[1] ?? 60);
  const quiet = args[2] === 'quiet';
  const results = styles().map((s) => ({ s, r: fish(s, startHours, minutes) }));
  console.log(`${table.name}: ${minutes} minutes' fishing from ${startHours} h into the season.\n`);
  for (const { s, r } of results) {
    const waits = r.wait.filter(Number.isFinite);
    console.log(`== ${s.name}: ${s.say}`);
    if (!quiet) for (const line of r.log) console.log(`   ${line}`);
    console.log(`   ${r.bites} bites, ${r.trip.landed.length} landed, ${r.trip.lost} lost, ${Math.round(r.fightS / 60)} min on the reel, ${r.trip.points} points${waits.length ? `, bites every ${Math.round(waits.reduce((a, b) => a + b, 0) / waits.length / 60)} min where anything was biting` : ', nothing biting where she looked'}\n`);
  }
  console.log(`${'style'.padEnd(26)} bites landed lost points  best fish`);
  for (const { s, r } of results) {
    const best = [...r.trip.landed].sort((a, b) => b.points - a.points)[0];
    console.log(`${s.name.padEnd(26)} ${String(r.bites).padStart(5)} ${String(r.trip.landed.length).padStart(6)} ${String(r.trip.lost).padStart(4)} ${String(r.trip.points).padStart(6)}  ${best ? `${fishWords(best.name, best.cm, best.kg)}, ${best.points} pts` : ''}`);
  }

  // A tournament over the first 40 minutes: each format, the angler's three best styles against five club skippers.
  const len = Math.min(40, minutes);
  for (const fmt of FORMATS) {
    const call = makeDerby(WATER, 'Script', fmt.id, len, Math.round(startHours * 3600), 5, 'calico');
    const rows: DerbyRow[] = [
      ...results.filter(({ s }) => /kelp, Hen|plugs|Edith|Run and gun, bait/.test(s.name) && !/Iron|Squid/.test(s.name)).map(({ s, r }) => ({ name: `You (${s.name})`, boat: '', me: true, rival: false, fish: r.fish.filter((f) => f.m < len) })),
      ...derbyRivals(call).map((e) => ({ name: `${e.who.skipper} (${e.level.id}, rod ${rodSkill(e).toFixed(2)})`, boat: e.who.boat, me: false, rival: true, fish: rivalFish(call, table, e, len * 60) })),
    ];
    console.log(`\nTournament: ${formatWords(call, table)}`);
    for (const r of standings(call, table, rows)) {
      const score = r.unit === 'kg' ? poundWords(r.score) : `${r.score} pts`;
      console.log(`  ${String(r.place).padStart(2)} ${r.name.padEnd(44)} ${(r.score > 0 ? score : '—').padStart(9)}  ${String(r.fish.length).padStart(2)} fish  ${r.best ? fishWords(r.best.name, r.best.cm, r.best.kg) : ''}`);
    }
  }
}
