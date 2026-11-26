/**
 * A fish on the line, from the strike to the rail or the loss. Pure: the fish's moves are drawn from the seed it was
 * hooked with, so the same fish fights the same way for a test or a script as it does on the screen.
 *
 * What the angler has: the reel (wind, or let the drag work), and the boat (slow her down, and steer to keep the line
 * off the stern). What loses a fish: winding against a run until the line parts, a boat still making way so the fish
 * and the boat pull against each other, slack line while the fish rests or shakes its head, the line led forward
 * under the boat, and a spool run empty.
 */
import { hash01 } from '../aboard/catch';

const KT = 0.514444;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Tension at which the drag starts to give line, and at which the line parts if it is held there. Slack is under the last. */
export const DRAG = 0.7;
export const PART = 1;
export const SLACK = 0.12;
/** Seconds over the parting strain before it parts, seconds of slack before the hook falls out, seconds the line may lead forward. */
export const PART_AFTER = 1;
export const SLACK_AFTER = 4;
export const FOUL_AFTER = 3;
/** The line leads forward, towards the keel and the stern gear, past this angle off dead astern, radians. */
export const FOUL_ANGLE = 2;
/** Line on the reel, metres. */
export const SPOOL = 400;
/** Winding adds this much strain against a fish that is going away, and this much on one that is not. */
const HORSE = 0.45;
const WIND = 0.16;
/** Each knot the boat is making adds this much strain. */
const WAY = 0.045;
/** With this much way on, knots, the boat can be steered, and the line can get under her. */
export const STEERAGE_KT = 1;

export type Phase = 'run' | 'sound' | 'shake' | 'rest' | 'beaten';
export type FightEnd = 'landed' | 'broke' | 'pulled' | 'spooled' | 'cut';

export interface Fight {
  seed: number;
  /** Seconds since the strike. */
  t: number;
  /** Metres of line out, and the strain on it: 0 slack, `DRAG` the drag giving, `PART` the line about to go. */
  line: number;
  tension: number;
  /** What the fish has left, 1 to 0. */
  stamina: number;
  phase: Phase;
  /** Seconds left of this move, and how many moves it has made. */
  left: number;
  moves: number;
  /** Where the fish is, off dead astern, radians: positive to starboard. Past `FOUL_ANGLE` the line is under the boat. */
  angle: number;
  /** Seconds of slack, of strain past parting, and of line under the boat, so far in this spell of each. */
  slack: number;
  over: number;
  foul: number;
  /** How hard it pulls (0.1 a mackerel, 1.2 a big tuna), the seconds of hard work in it, and how much of the fight is straight down. */
  power: number;
  staminaS: number;
  dives: number;
  result: FightEnd | null;
}

export interface FightInput {
  /** The angler is winding. */
  reel: boolean;
  /** The boat's speed through the water, knots. */
  boatKt: number;
  /** How fast she is turning, radians a second, positive to starboard. */
  turn: number;
}

/**
 * A fight begun.
 * @param style the species' `fight` numbers
 * @param big how big the fish is for its kind, 0 the smallest to 1 the biggest there is
 * @param lineOut metres of line out at the strike: a towed lure is well astern, a bait is under the boat
 */
export function startFight(style: { power: number; stamina: number; dives: number }, big: number, seed: number, lineOut: number): Fight {
  const f = clamp(big, 0, 1);
  return {
    seed, t: 0, line: lineOut, tension: 0.5, stamina: 1, phase: 'run', left: 3 + 5 * hash01(seed, 341), moves: 0,
    angle: (hash01(seed, 342) - 0.5) * 0.6, slack: 0, over: 0, foul: 0,
    power: Math.min(1.25, style.power * (0.55 + 0.9 * f)), staminaS: Math.min(270, 6 + 220 * style.stamina * (0.4 + f)), dives: style.dives, result: null,
  };
}

const PULL: Record<Phase, number> = { run: 1, sound: 0.9, shake: 0.45, rest: 0.25, beaten: 0.12 };
const going = (p: Phase) => p === 'run' || p === 'sound';

/** How hard the fish itself is pulling now, before the drag, the reel and the boat come into it. */
export function fishPull(f: Fight): number {
  const shake = f.phase === 'shake' ? 0.55 + 0.45 * Math.sin(f.t * 9) : 1;
  return PULL[f.phase] * f.power * (0.35 + 0.65 * f.stamina) * shake;
}

function nextMove(f: Fight): void {
  f.moves++;
  const h = (salt: number) => hash01(f.seed, f.moves, salt);
  if (f.stamina <= 0) { f.phase = 'beaten'; f.left = 1e9; return; }
  if (going(f.phase)) {
    f.phase = h(351) < 0.45 ? 'shake' : 'rest';
    f.left = f.phase === 'shake' ? 2 + 2 * h(352) : 3 + 3 * h(352);
  } else {
    f.phase = h(353) < f.dives * 0.7 ? 'sound' : 'run';
    // A tiring fish makes shorter runs.
    f.left = (f.phase === 'sound' ? 4 + 5 * h(354) : 3 + 5 * h(354)) * (0.4 + 0.6 * f.stamina);
  }
}

/** One step of the fight. Changes `f`. Does nothing once the fight is over. */
export function stepFight(f: Fight, input: FightInput, dt: number): void {
  if (f.result) return;
  f.t += dt;
  f.left -= dt;
  if (f.left <= 0 || (f.stamina <= 0 && f.phase !== 'beaten')) nextMove(f);

  const pull = fishPull(f);
  const away = going(f.phase);
  const boatKt = Math.max(0, input.boatKt);
  // A fish too small to take line against the drag can be wound in whatever it is doing.
  const small = pull < 0.35;
  const want = Math.min(pull, DRAG) + boatKt * WAY + (input.reel ? (away && !small ? HORSE : WIND) : 0);
  f.tension += (want - f.tension) * Math.min(1, dt * 4);

  // Line goes out with the fish and with the boat, and comes in on the reel when the fish lets it.
  if (away) f.line += (f.phase === 'run' ? 1.2 + 2.6 * f.power : 0.8 + 1.5 * f.power) * Math.min(1, pull / DRAG) * (input.reel && small ? 0 : 1) * dt;
  if (boatKt > 0.3 && (away || !input.reel)) f.line += boatKt * KT * 0.7 * dt;
  if (input.reel && (!away || small)) f.line -= 3 * Math.max(0, 1 - f.tension) * dt;

  // Working against the line is what tires it.
  f.stamina = Math.max(0, f.stamina - (1.4 * Math.min(f.tension, PART) * dt) / f.staminaS);

  // Big fish work round the boat when they are close and not running. Way on the boat draws the line astern again, and
  // turning swings the stern. A boat lying stopped is no trouble: the angler walks the rod round the deck.
  const under = boatKt >= STEERAGE_KT;
  if (under && f.power > 0.45 && !away && f.line < 45) {
    const side = hash01(f.seed, f.moves, 361) < 0.5 ? -1 : 1;
    f.angle += side * (0.12 + 0.13 * hash01(f.seed, f.moves, 362)) * Math.min(1.5, 30 / Math.max(8, f.line)) * dt;
  }
  f.angle -= f.angle * Math.min(1, ((boatKt * KT) / Math.max(15, f.line)) * dt);
  f.angle = under ? clamp(f.angle + input.turn * dt, -Math.PI, Math.PI) : f.angle * Math.max(0, 1 - dt);

  if (f.tension > PART) f.over += dt;
  else f.over = Math.max(0, f.over - dt * 2);
  if (f.tension < SLACK && !away) f.slack += f.phase === 'shake' ? dt * 2 : dt;
  else f.slack = 0;
  if (under && Math.abs(f.angle) > FOUL_ANGLE) f.foul += dt;
  else f.foul = Math.max(0, f.foul - dt);

  if (f.over > PART_AFTER) f.result = 'broke';
  else if (f.slack > SLACK_AFTER) f.result = 'pulled';
  else if (f.foul > FOUL_AFTER) f.result = 'cut';
  else if (f.line >= SPOOL) f.result = 'spooled';
  else if (f.line <= 2) {
    // A fish with fight left in it that sees the boat goes again.
    if (f.stamina > 0.35 && f.power > 0.4) {
      f.line = 4;
      f.phase = hash01(f.seed, f.moves, 363) < f.dives ? 'sound' : 'run';
      f.left = 2 + 3 * hash01(f.seed, f.moves, 364);
      f.moves++;
    } else f.result = 'landed';
  }
}

/** What the fish is doing, for the panel. */
export function phaseWords(f: Fight): string {
  if (f.phase === 'run') return 'running';
  if (f.phase === 'sound') return 'sounding';
  if (f.phase === 'shake') return 'shaking its head';
  if (f.phase === 'beaten') return 'beaten: wind it in';
  return f.stamina < 0.4 ? 'tiring' : 'resting: wind';
}

/** The one thing the angler most needs to hear now, or nothing. */
export function fightCall(f: Fight, input: FightInput): string {
  if (Math.abs(f.angle) > FOUL_ANGLE * 0.75) return `Line under the boat. Steer to ${f.angle > 0 ? 'port' : 'starboard'}, away from the fish`;
  if (f.tension > PART * 0.93) return input.boatKt > 2.5 ? 'Slow the boat, the line is about to go' : 'Stop winding, let the drag work';
  if (f.tension < SLACK * 1.4 && f.phase !== 'run' && f.phase !== 'sound') return 'Slack line. Wind';
  if (f.line > SPOOL * 0.75) return 'Nearly out of line. Stop the boat';
  return '';
}

/** How it ended, as the crew say it. */
export function endWords(end: FightEnd): string {
  if (end === 'broke') return 'The line parted. Winding against a running fish, or the boat still making way, will do that';
  if (end === 'pulled') return 'Slack line, and the hook fell out. Keep winding whenever the fish is not taking line';
  if (end === 'spooled') return 'It took all the line and went. Slow the boat as soon as the reel goes off';
  if (end === 'cut') return 'The line went under the boat and chafed through. Steer away from the fish to keep it astern';
  return 'At the rail';
}

/**
 * A sensible angler, for scripts and tests: stops the boat, winds whenever the fish is not taking line, lets the drag
 * work when it is, and steers away from a fish that is working forward.
 */
export function steadyHand(f: Fight): FightInput {
  const small = fishPull(f) < 0.35;
  return { reel: !going(f.phase) || small, boatKt: 0.5, turn: Math.abs(f.angle) > 0.8 ? -Math.sign(f.angle) * 0.25 : 0 };
}
