import type { ControlName, Sim } from '@slack-tide/sim';

export interface CoachContext {
  sim: Sim;
  pilotEngaged(): boolean;
  chartOpen(): boolean;
  /** A count that goes up each time the player moves the camera. */
  cameraMoves(): number;
}

interface Step {
  title: string;
  text: string;
  keys: string;
  /** Called once when the step begins, to remember where things stood. */
  begin?(c: Coach): void;
  /** True once the player has done it. */
  done(c: Coach): boolean;
}

const KT = 0.514444;

/**
 * An optional first sail, for players who ask for it. One short prompt at a time, each about something the boat
 * is already showing, and each ticked off by doing it. Nothing is locked: every control works throughout.
 */
export class Coach {
  private readonly el = document.getElementById('coach') as HTMLElement;
  private index = -1;
  private mark = 0;
  private side = 1;
  private readonly usedSince = new Set<ControlName>();
  private hold = 0;
  private finished = false;

  private readonly steps: Step[] = [
    {
      title: 'Look around',
      text: 'Drag the water or the sky to swing the camera round the boat. Scroll there to zoom, right in to a winch or right out to a bird’s view.',
      keys: '1 helm · 2 mast · 3 foredeck · 4 drone',
      begin: (c) => { c.mark = c.ctx.cameraMoves(); },
      done: (c) => c.ctx.cameraMoves() - c.mark >= 4,
    },
    {
      title: 'Find the wind',
      text: 'The dial top left is the boat seen from above. The gold pointer is where the wind is coming from. The vane at the masthead and the flag at the stern show the same thing. She cannot sail closer than about 45° to it.',
      keys: 'Next when you have found it',
      done: () => false,
    },
    {
      title: 'Take the wheel',
      text: 'Point at the wheel and scroll, or drag its rim. The crew has been steering: now it is you. The wheel stays where you leave it, so bring it back to the middle to go straight.',
      keys: 'A and D, or the arrow keys',
      done: (c) => c.usedSince.has('rudder') && c.ctx.sim.state.helmMode === 'hand',
    },
    {
      title: 'Trim the mainsail',
      text: 'Point at the boom and scroll. Ease the sheet until the front of the sail starts to flutter, then haul in until it just stops. That is the right trim on any course.',
      keys: 'W hauls in · S eases',
      done: (c) => c.usedSince.has('mainsheet') && c.ctx.sim.out.main.luff === 0 && c.ctx.sim.out.main.stall < 0.25 && !c.ctx.sim.out.main.flogging,
    },
    {
      title: 'Trim the jib',
      text: 'The jib has a sheet each side. Point at the winch on the side the sail is on and scroll, the same way: ease until it flutters, then in until it stops. The ribbons on the jib stream straight back when it is right.',
      keys: 'Q trims · E eases',
      done: (c) => (c.usedSince.has('jibsheet_port') || c.usedSince.has('jibsheet_stbd')) && c.ctx.sim.out.jib.luff === 0 && c.ctx.sim.out.jib.backed === 0 && !c.ctx.sim.out.jib.flogging,
    },
    {
      title: 'Tack',
      text: 'Turn the wheel toward the wind and keep turning until the wind is on the other side. The jib will be held aback by its old sheet: let that one go and trim the new one. Then centre the wheel.',
      keys: 'T and the crew does all of it',
      begin: (c) => { c.side = c.ctx.sim.out.twa >= 0 ? 1 : -1; },
      done: (c) => {
        const o = c.ctx.sim.out;
        return (o.twa >= 0 ? 1 : -1) !== c.side && Math.abs(o.twa) > 0.6 && o.jib.backed === 0 && !o.jib.flogging && c.ctx.sim.state.speed > 2.5 * KT && !c.ctx.sim.state.maneuver;
      },
    },
    {
      title: 'Hand over',
      text: 'Press P and the autopilot steers while the crew trims. Touch the wheel and she is yours again. The pilot can hold a heading, an angle to the wind, or the route on the chart.',
      keys: 'P on or off · Shift+P changes what it holds',
      begin: (c) => { c.mark = c.ctx.pilotEngaged() ? 1 : 0; },
      done: (c) => c.ctx.pilotEngaged() && c.mark === 0,
    },
    {
      title: 'Plan the passage',
      text: 'Press M for the chart. Your route is already on it, with each leg’s course, wind, tide and arrival time. Click the water to add a mark and drag the timeline to see the tide turn.',
      keys: 'M opens and closes the chart',
      done: (c) => c.ctx.chartOpen(),
    },
  ];

  constructor(readonly ctx: CoachContext) {
    this.el.hidden = false;
    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act === 'next') this.advance();
      else if (act === 'end') this.end();
    });
    this.advance();
  }

  get active(): boolean {
    return !this.finished;
  }

  /** The player moved a control. */
  used(control: ControlName): void {
    this.usedSince.add(control);
  }

  private advance(): void {
    this.index++;
    this.usedSince.clear();
    this.hold = 0;
    const step = this.steps[this.index];
    if (!step) {
      this.el.innerHTML = '<div class="coach-step">That is the boat</div><p>H hides the instruments if you would rather read her from the sails. Fair winds.</p>';
      this.finished = true;
      window.setTimeout(() => { this.el.hidden = true; }, 7000);
      return;
    }
    step.begin?.(this);
    this.el.innerHTML = `
      <div class="coach-step">${this.index + 1} of ${this.steps.length}<b>${step.title}</b></div>
      <p>${step.text}</p>
      <div class="coach-foot"><span>${step.keys}</span><button type="button" data-act="end">End the lesson</button><button type="button" data-act="next" class="primary">${this.index === this.steps.length - 1 ? 'Finish' : 'Next'}</button></div>`;
  }

  private end(): void {
    this.finished = true;
    this.el.hidden = true;
  }

  /** Tick the current step off once it has clearly been done. Call every frame. */
  update(dt: number): void {
    if (this.finished) return;
    const step = this.steps[this.index];
    if (!step) return;
    // Hold for a moment so a sail that flickers into trim and out again does not count.
    this.hold = step.done(this) ? this.hold + dt : 0;
    if (this.hold > 1.2) {
      this.el.classList.add('done');
      window.setTimeout(() => this.el.classList.remove('done'), 600);
      this.advance();
    }
  }
}
