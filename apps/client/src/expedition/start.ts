import { ReplayWorld } from '@slack-tide/world';
import type { YardBoat } from '../boat/yard';
import { BAY_SEA } from '../scene/waves';
import type { Stage } from '../stage';
import { Briefing, EndCard } from './cards';
import { buildSea } from './sea';
import { ExpeditionSession, type VoyageResult } from './session';
import { oceanSea } from './swell';
import type { Voyage } from './voyage';
import { VOYAGES } from './voyages/caird';

// Expedition, from the choice screen to the end card. `main.ts` makes one of these when Expedition is chosen and
// hands it the frame. Everything Expedition does to the shared stage is done here and undone in `leave`.

export interface ExpeditionHost {
  stage: Stage;
  boats: Record<string, YardBoat>;
  params: URLSearchParams;
  /** Back to the first screen. The stage has been given back as it was found, without a course. */
  onLeave(): void;
}

export class Expedition {
  session: ExpeditionSession | null = null;
  private briefing: Briefing | null = null;
  private card: EndCard | null = null;
  private voyage: Voyage = VOYAGES[0];

  /** @param go cast off at once, with no briefing: for play testing with ?mode=expedition&go=1 */
  constructor(private readonly host: ExpeditionHost, go: boolean) {
    document.body.classList.add('expedition', 'lobby');
    this.open(this.voyage, this.seed(true));
    if (go) this.castOff();
    else {
      this.briefing = new Briefing({
        voyages: VOYAGES,
        onBack: () => this.leave(),
        onCastOff: () => this.castOff(),
      });
    }
  }

  /** ?seed=7 pins the weather for a test. Otherwise every passage gets its own. */
  private seed(first: boolean): number {
    const asked = Number(this.host.params.get('seed'));
    if (first && this.host.params.has('seed') && Number.isFinite(asked)) return Math.floor(asked);
    return Math.floor(Math.random() * 1e9);
  }

  /** Make the voyage's sea, put it on the stage and the boat on it. */
  private open(voyage: Voyage, seed: number): void {
    const { stage, boats, params } = this.host;
    this.session?.dispose();
    this.voyage = voyage;
    const sea = buildSea(voyage, seed);
    const world = new ReplayWorld(sea, voyage.castOff * 3600);
    stage.sea = oceanSea();
    stage.setCourse(sea, world);
    this.session = new ExpeditionSession(stage, {
      voyage, sea, spec: boats[voyage.boat], showTruth: params.get('truth') === '1',
      onEnd: (result) => this.ended(result),
    });
    this.publish();
  }

  private publish(): void {
    const handles = this.session!.debug();
    Object.assign(window, { regatta: handles, slackTide: handles });
  }

  private castOff(): void {
    this.briefing = null;
    document.body.classList.remove('lobby');
    this.session?.castOff();
  }

  private ended(result: VoyageResult): void {
    this.card = new EndCard(this.voyage, result, {
      onAgain: () => {
        this.card = null;
        document.body.classList.add('lobby');
        this.open(this.voyage, this.seed(false));
        this.castOff();
      },
      onLeave: () => this.leave(),
    });
  }

  /** Give the stage back as Regatta expects to find it, and go back to the first screen. */
  private leave(): void {
    const { stage } = this.host;
    this.briefing?.close();
    this.card?.close();
    this.session?.dispose();
    this.session = null;
    stage.sea = BAY_SEA;
    stage.overcast = 0;
    stage.sunPlace = null;
    stage.haze.near = 1200;
    stage.haze.far = 30000;
    stage.sky.bakeGapMs = 0;
    stage.ocean.resetLook();
    document.body.classList.remove('expedition', 'lobby');
    this.host.onLeave();
  }

  frame(dt: number): void {
    this.session?.frame(dt);
  }
}
