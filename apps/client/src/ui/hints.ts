import { KT, R2D, wrapPi, type Sim } from '@slack-tide/sim';

export interface HintContext {
  sim: Sim;
  /** The next mark on the route, if there is one. */
  nextMark(): { name: string; x: number; y: number } | null;
  /** True while something else has the player's attention: the lesson, the chart, the roadmap. */
  busy(): boolean;
}

interface Rule {
  id: string;
  /** Seconds the condition must hold before saying anything. */
  after: number;
  when(c: HintContext): boolean;
  say(c: HintContext): string;
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
    {
      id: 'irons', after: 8,
      when: (c) => c.sim.out.inIrons && !c.sim.state.maneuver,
      say: () => 'In irons: she is pointing too close to the wind to sail. Put the wheel over and hold it until the sails fill, about 45° off the wind.',
    },
    {
      id: 'heel', after: 12,
      when: (c) => Math.abs(c.sim.state.heel) * R2D > 26,
      say: () => 'She is overpowered and heeling too far to be fast. Ease the mainsheet to stand her up (point at the boom and scroll down, or hold S).',
    },
    {
      id: 'mainLuff', after: 12,
      when: (c) => !c.sim.state.crewTrim && (c.sim.out.main.flogging || c.sim.out.main.luff > 0.4) && Math.abs(c.sim.out.twa) * R2D > 36,
      say: () => 'The mainsail is luffing, so it is not pulling. Haul in the mainsheet until it stops (point at the boom and scroll up, or hold W).',
    },
    {
      id: 'jibLuff', after: 12,
      when: (c) => !c.sim.state.crewTrim && c.sim.state.furl > 0.1 && c.sim.out.jib.backed === 0 && (c.sim.out.jib.flogging || c.sim.out.jib.luff > 0.4) && Math.abs(c.sim.out.twa) * R2D > 36,
      say: (c) => `The jib is luffing. Trim the ${c.sim.out.awa >= 0 ? 'port' : 'starboard'} winch until it stops (point at it and scroll up, or hold Q).`,
    },
    {
      id: 'mainStall', after: 20,
      when: (c) => !c.sim.state.crewTrim && c.sim.out.main.stall > 0.35,
      say: () => 'The main is sheeted too hard for this course: it is stalled and slowing her. Ease it until it just starts to flutter, then bring it back a touch (hold S).',
    },
    {
      id: 'jibStall', after: 20,
      when: (c) => !c.sim.state.crewTrim && c.sim.state.furl > 0.1 && c.sim.out.jib.backed === 0 && c.sim.out.jib.stall > 0.35,
      say: () => 'The jib is sheeted too hard for this course. Ease it until it just starts to flutter, then bring it back a touch (hold E).',
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
      if (this.clock - (this.lastSaid.get(r.id) ?? -1e9) < 150) continue;
      this.lastSaid.set(r.id, this.clock);
      this.quietUntil = this.clock + 25;
      this.hideAt = this.clock + 11;
      this.el.innerHTML = `<p>${r.say(this.ctx)}</p><button type="button" title="Turn coaching hints off. C turns them back on">Hints off</button>`;
      this.el.hidden = false;
      break;
    }
  }
}
