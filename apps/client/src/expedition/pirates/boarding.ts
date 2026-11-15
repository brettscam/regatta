import { roll } from './gunnery';

// Boarding, as pure arithmetic: numbers, how hard each side fights, how much heart each has left, and a seeded roll.
// It is told in rounds, a line each, so the player reads it as it goes. There is nothing to press.
//
// Each round each side loses men in proportion to the other's strength (men x fight x heart), a tenth to a fifth of
// it by the roll. A side gives in when it is down to 35% of the men it began with, or when it is outfought two to
// one and its heart fails the roll. At most six rounds: then whoever has more strength left carries it.

/** Metres within which grapnels will reach, and the most she may be moving through the water relative to the other, m/s. */
export const BOARD_RANGE = 65;
export const BOARD_SPEED = 3.2;
/** Metres within which a boat can be sent to take possession of a ship that has struck. */
export const POSSESS_RANGE = 160;

/** What men fighting on their own deck are worth against men coming over the rail. */
export const OWN_DECK = 1.4;

export interface Party {
  men: number;
  /** How hard they fight, man for man: 1 a plain seaman, 1.3 a man-of-war's crew. */
  fight: number;
  /** Heart, 0 to 1: lowered by the beating the ship has had. */
  heart: number;
}

export interface BoardingRound {
  attackers: number;
  defenders: number;
  line: string;
}

export interface BoardingResult {
  won: boolean;
  rounds: BoardingRound[];
  attackersLeft: number;
  defendersLeft: number;
}

const strength = (p: Party, men: number) => men * p.fight * (0.5 + 0.5 * p.heart);

/** The chance the boarders carry her, by strength alone: for the read-out before the grapnels go over. */
export function boardingOdds(attack: Party, defend: Party): number {
  const a = strength(attack, attack.men);
  const d = strength(defend, defend.men) * OWN_DECK;
  return a <= 0 ? 0 : d <= 0 ? 1 : Math.pow(a, 2.2) / (Math.pow(a, 2.2) + Math.pow(d, 2.2));
}

const WON = ['They are over her rail', 'Her waist is cleared', 'They have her quarterdeck', 'Her people are driven below'];
const LOST = ['They are held at the rail', 'The boarders are thrown back', 'Her people rally round the mainmast', 'Men are falling in the waist'];

/** Fight it out. The same parties and seed always give the same fight. */
export function board(attack: Party, defend: Party, seed: number): BoardingResult {
  let a = attack.men;
  let d = defend.men;
  const rounds: BoardingRound[] = [];
  let won: boolean | null = null;
  for (let r = 0; r < 6 && won === null; r++) {
    const sa = strength(attack, a);
    // Men defending their own deck are worth a little more.
    const sd = strength(defend, d) * OWN_DECK;
    const lossD = Math.min(d, Math.max(1, Math.round((sa / Math.max(0.3, defend.fight)) * (0.1 + 0.1 * roll(seed, r, 11)))));
    const lossA = Math.min(a, Math.max(sd > 0 ? 1 : 0, Math.round((sd / Math.max(0.3, attack.fight)) * (0.1 + 0.1 * roll(seed, r, 12)))));
    a -= lossA;
    d -= lossD;
    const ahead = strength(attack, a) >= strength(defend, d) * OWN_DECK;
    if (d <= defend.men * 0.35 || d <= 0) won = true;
    else if (a <= attack.men * 0.35 || a <= 0) won = false;
    else if (ahead && sa > 2 * sd && roll(seed, r, 13) > defend.heart * 0.8) won = true;
    else if (!ahead && sd > 2 * sa && roll(seed, r, 14) > attack.heart * 0.8) won = false;
    const words = ahead ? WON : LOST;
    rounds.push({ attackers: a, defenders: d, line: words[Math.floor(roll(seed, r, 15) * words.length)] });
  }
  if (won === null) won = strength(attack, a) > strength(defend, d) * OWN_DECK;
  rounds.push({ attackers: a, defenders: d, line: won ? 'She is ours. Her colours come down' : 'They are beaten back to their own deck' });
  return { won, rounds, attackersLeft: a, defendersLeft: d };
}
