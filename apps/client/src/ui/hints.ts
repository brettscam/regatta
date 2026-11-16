import { KT, R2D, wrapPi, type Sim } from '@slack-tide/sim';
import { isCapsized, isPressed, placard, reefDue } from '../aboard/pressedRules';
import type { Sea } from '@slack-tide/world';

export interface HintContext {
  sim: Sim;
  /** The next mark on the route, if there is one. */
  nextMark(): { name: string; x: number; y: number } | null;
  /** True while something else has the player's attention: the lesson, the chart, the roadmap. */
  busy(): boolean;
  /** True while she is in a race, where the engine may not be used. */
  racing?(): boolean;
  /** The sea where she is, where the water has one. */
  sea?(): Sea | null;
  /** How many times she has slammed in the last minute. */
  slams?(): number;
  /** What this stretch of water is called when its tide is famous for the sea it raises: "the Golden Gate". Empty anywhere else. */
  tideGate?(): string;
}

interface Rule {
  id: string;
  /** Seconds the condition must hold before saying anything. */
  after: number;
  when(c: HintContext): boolean;
  say(c: HintContext): string;
  /** Said once in a sail and not again. */
  once?: boolean;
}

const SAVED = 'regatta.hints';

/** The name of the point of sail for a wind angle, as a sailor would call it. */
export function pointOfSail(twaRad: number, inIrons: boolean): string {
  const a = Math.abs(twaRad) * R2D;
  if (inIrons) return 'In irons';
  if (a < 33) return 'Head to wind';
  if (a < 52) return 'Close-hauled';
  if (a < 75) return 'Close reach';
  if (a < 108) return 'Beam reach';
  if (a < 152) return 'Broad reach';
  return 'Running';
}

/**
 * Quiet coaching for someone still learning. When something has been wrong for a while, one line says what the boat
 * is already showing and what to do about it. It never interrupts, repeats itself rarely, and can be turned off.
 */
export class Hints {
  enabled = true;
  private readonly el = document.getElementById('hint') as HTMLElement;
  private readonly held = new Map<string, number>();
  private readonly lastSaid = new Map<string, number>();
  private clock = 0;
  private quietUntil = 20;
  private hideAt = 0;

  private readonly rules: Rule[] = [
    {
      id: 'aback', after: 6,
      when: (c) => c.sim.out.jib.backed > 0.5 && !c.sim.state.maneuver,
      say: () => 'The jib is aback: its old sheet is holding it on the wrong side. Let that sheet go (hold E), then trim the other winch (hold Q).',
    },
    // A boat that does not heel: a catamaran. She is reefed by the numbers on her placard, because nothing else warns.
    {
      id: 'capsized', after: 6,
      when: (c) => isCapsized(c.sim.boat, c.sim.state),
      say: (c) => `She is capsized and will not come up by herself. Help is righting her. When she is up: ${placard(c.sim.boat)}, and ease the mainsheet (S) the moment she feels pressed.`,
    },
    {
      id: 'pressed', after: 3,
      when: (c) => isPressed(c.sim.boat, c.sim.out) && !isCapsized(c.sim.boat, c.sim.state),
      say: (c) => `She is pressed: ${Math.round(c.sim.out.aws / KT)} kt apparent is more than ${c.sim.boat.sails.main.reefs[c.sim.state.reef]?.name.toLowerCase() ?? 'this sail'} will carry. A bow is digging in and she is slowing, and that is all the warning a catamaran gives. Ease the mainsheet now (hold S) and reef (J).`,
    },
    {
      id: 'reefNumbers', after: 10,
      when: (c) => reefDue(c.sim.boat, c.sim.state, c.sim.out) !== null,
      say: (c) => {
        const due = reefDue(c.sim.boat, c.sim.state, c.sim.out) ?? 1;
        return `${Math.round(c.sim.out.aws / KT)} kt apparent. She will not heel to tell you she has too much sail up, so she is reefed by the numbers: ${placard(c.sim.boat)}. Take in ${due > 1 ? 'the second reef' : 'a reef'} now (J).`;
      },
    },
    {
      // Caught head to wind, a catamaran will not sail herself out the way a sloop does.
      id: 'ironsCat', after: 6,
      when: (c) => !!c.sim.boat.sails.jib.selfTacking && c.sim.out.inIrons && !c.sim.state.maneuver && !c.sim.state.engineOn,
      say: (c) => `In irons. She is slow through the wind and stops if she is tacked without plenty of way on. Press T and the crew holds the jib aback to push her bows round${c.racing?.() ? '' : ', or start the engines (I): with the wheel over they turn her where she lies'}. Next time bear away for speed before you tack.`,
    },
    {
      id: 'irons', after: 8,
      when: (c) => c.sim.out.inIrons && !c.sim.state.maneuver && !c.sim.state.engineOn && !c.sim.boat.sails.jib.selfTacking,
      say: () => 'In irons: she is pointing too close to the wind to sail. Put the wheel over and hold it until the sails fill, about 45° off the wind.',
    },
    {
      id: 'heel', after: 12,
      when: (c) => Math.abs(c.sim.state.heel) * R2D > 26 && !c.sim.boat.pressed,
      say: () => 'She is overpowered and heeling too far to be fast. Ease the mainsheet to stand her up (point at the boom and scroll down, or hold S).',
    },
    {
      id: 'mainLuff', after: 12,
      when: (c) => !c.sim.out.underPower && !c.sim.state.crewTrim && (c.sim.out.main.flogging || c.sim.out.main.luff > 0.4) && Math.abs(c.sim.out.twa) * R2D > 36,
      say: () => 'The mainsail is luffing, so it is not pulling. Haul in the mainsheet until it stops (point at the boom and scroll up, or hold W).',
    },
    {
      id: 'jibLuff', after: 12,
      when: (c) => !c.sim.out.underPower && !c.sim.state.crewTrim && c.sim.state.furl > 0.1 && c.sim.out.jib.backed === 0 && (c.sim.out.jib.flogging || c.sim.out.jib.luff > 0.4) && Math.abs(c.sim.out.twa) * R2D > 36,
      say: (c) => `The jib is luffing. Trim the ${c.sim.out.awa >= 0 ? 'port' : 'starboard'} winch until it stops (point at it and scroll up, or hold Q).`,
    },
    {
      id: 'mainStall', after: 20,
      when: (c) => !c.sim.out.underPower && !c.sim.state.crewTrim && c.sim.out.main.stall > 0.35,
      say: () => 'The main is sheeted too hard for this course: it is stalled and slowing her. Ease it until it just starts to flutter, then bring it back a touch (hold S).',
    },
    {
      id: 'jibStall', after: 20,
      when: (c) => !c.sim.out.underPower && !c.sim.state.crewTrim && c.sim.state.furl > 0.1 && c.sim.out.jib.backed === 0 && c.sim.out.jib.stall > 0.35,
      say: () => 'The jib is sheeted too hard for this course. Ease it until it just starts to flutter, then bring it back a touch (hold E).',
    },
    {
      // Stuck for a good while: in irons, or lying becalmed. Outside a race the engine is the way out. Said after
      // the plain in-irons hint has had its turn, and never while the engine is already running.
      id: 'engine', after: 40,
      when: (c) => {
        const s = c.sim.state;
        const o = c.sim.out;
        if (!c.sim.boat.engine || s.engineOn || s.engineCrank > 0 || s.maneuver || o.aground || (c.racing?.() ?? false)) return false;
        return o.inIrons || (o.tws < 3 * KT && Math.abs(s.speed) < 1 * KT);
      },
      say: (c) => `${c.sim.out.inIrons ? 'Still stuck head to wind' : 'There is not enough wind to sail'}. The engine will get her moving: press I to start it, then the full stop key to put her ahead.`,
    },
    {
      // Slamming: said before the plain chop tip, because it is the more urgent of the two.
      id: 'slamming', after: 2, once: true,
      when: (c) => (c.slams?.() ?? 0) >= 3 && !c.sim.out.underPower,
      say: (c) => `She is slamming: falling off the back of each wave and stopping. Bear away a few degrees to take them on her shoulder${c.sim.state.reef < c.sim.boat.sails.main.reefs.length - 1 ? ', and reef (J) so she goes through them slower' : ''}.`,
    },
    {
      id: 'tideSea', after: 12, once: true,
      when: (c) => {
        const sea = c.sea?.();
        return !!sea && sea.against > 0.5 && sea.streamFactor > 1.15 && sea.windHeight > 0.4;
      },
      say: (c) => {
        const where = c.tideGate?.() ?? '';
        const kt = ((c.sea?.()?.against ?? 0) / KT).toFixed(1);
        return `Wind against tide${where ? ` in ${where}` : ''}: ${kt} kt of ${where ? 'ebb' : 'stream'} is running into the breeze and standing the sea up short and steep. It lies down again when the tide turns, and it is easier out of the strongest stream.`;
      },
    },
    {
      id: 'chop', after: 25, once: true,
      when: (c) => {
        const o = c.sim.out;
        return !o.underPower && !c.sim.state.maneuver && o.seaLoss > 0.035 && Math.abs(o.twa) * R2D < 48 && Math.abs(o.twa) * R2D > 30;
      },
      say: () => 'This chop is stopping her: every wave takes a little speed. Crack off a few degrees and keep her moving. In a sea, speed first and pointing second.',
    },
    {
      id: 'tack', after: 15,
      when: (c) => {
        const m = c.nextMark();
        const s = c.sim.state;
        const o = c.sim.out;
        if (!m || s.helmMode !== 'hand' || s.maneuver || Math.abs(o.twa) * R2D > 58 || s.speed < 2 * KT) return false;
        // Where the mark lies against the wind. If it is well out on the other side, the other tack lays it.
        const off = wrapPi(o.twd - Math.atan2(m.x - s.x, m.y - s.y));
        return Math.sign(off) !== Math.sign(o.twa) && Math.abs(off) * R2D > 50 && Math.abs(off) * R2D < 140;
      },
      say: (c) => `You can lay ${c.nextMark()?.name ?? 'the mark'} on the other tack. Turn through the wind, or press T and the crew handles the sheets.`,
    },
  ];

  constructor(private readonly ctx: HintContext) {
    try {
      this.enabled = localStorage.getItem(SAVED) !== 'off';
    } catch { /* no storage: hints stay on */ }
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.toggle(false);
    });
  }

  toggle(on = !this.enabled): string {
    this.enabled = on;
    this.el.hidden = true;
    try {
      localStorage.setItem(SAVED, on ? 'on' : 'off');
    } catch { /* nothing to remember */ }
    return on ? 'Coaching hints on' : 'Coaching hints off. C turns them back on';
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.el.hidden && this.clock > this.hideAt) this.el.hidden = true;
    // At anchor or on a mooring nothing is being sailed, so there is nothing to coach.
    if (!this.enabled || this.ctx.busy() || this.ctx.sim.state.hold !== 'none') {
      this.held.clear();
      return;
    }
    for (const r of this.rules) {
      const held = r.when(this.ctx) ? (this.held.get(r.id) ?? 0) + dt : 0;
      this.held.set(r.id, held);
      if (held < r.after || this.clock < this.quietUntil) continue;
      if (this.clock - (this.lastSaid.get(r.id) ?? -1e9) < (r.once ? Infinity : 150)) continue;
      this.lastSaid.set(r.id, this.clock);
      this.quietUntil = this.clock + 25;
      this.hideAt = this.clock + 11;
      this.el.innerHTML = `<p>${r.say(this.ctx)}</p><button type="button" title="Turn coaching hints off. C turns them back on">Hints off</button>`;
      this.el.hidden = false;
      break;
    }
  }
}
