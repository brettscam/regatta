import { ReplayWorld } from '@slack-tide/world';
import type { YardBoat } from '../boat/yard';
import { BAY_SEA } from '../scene/waves';
import type { Stage } from '../stage';
import { Briefing, EndCard, type Offer } from './cards';
import { buildCaribbean, SEA_GAIN } from './pirates/caribbean';
import { fitOut, loadCareer, saveCareer } from './pirates/career';
import { PirateSession } from './pirates/session';
import { PLAYER_CLASS } from './pirates/tables';
import { Cabinet, CruiseCard, type CruiseEnd } from './pirates/ui';
import { buildSea } from './sea';
import { ExpeditionSession, type VoyageResult } from './session';
import { oceanSea } from './swell';
import type { Voyage } from './voyage';
import { VOYAGES } from './voyages/caird';

// Expedition, from the choice screen to the end card. `main.ts` makes one of these when Expedition is chosen and
// hands it the frame. Everything Expedition does to the shared stage is done here and undone in `leave`.
//
// There are two things to do on an expedition. The first card is the pirate game (`pirates/`): the Caribbean of
// 1715, roamed at will. The others are voyages from the record, navigated as they were: so far the James Caird.

export interface ExpeditionHost {
  stage: Stage;
  boats: Record<string, YardBoat>;
  params: URLSearchParams;
  /** Back to the first screen. The stage has been given back as it was found, without a course. */
  onLeave(): void;
}

/** What `start.ts` needs of whatever is being played. */
interface Running {
  frame(dt: number): void;
  dispose(): void;
  castOff(): void;
  debug(): Record<string, unknown>;
}

const PIRATES: Offer = {
  id: 'pirates',
  title: 'On the Account, 1715',
  line: 'The Greater Antilles in a rover\'s sloop. Chase, fight under sail, plunder, and keep what you can',
  briefing: [
    'Port Royal, March 1715. The long war with France and Spain ended two years ago and the privateers\' commissions ended with it. There are a thousand seamen on this beach who know no other trade, and every nation\'s commerce goes by within a day\'s sail.',
    'You have a Jamaica sloop of sixty feet, six four-pounders, thirty-odd men who signed your articles, and no commission at all. She is the fastest thing in these waters on a reach, and she will lie closer to the wind than any square-rigged ship.',
    'Run a trader down and she may strike to a shot across her bow. If she will not, lay your sloop where your guns bear and hers do not, or grapple and carry her by the board. What is in her cabin and her hold is yours. What you bring into port is banked. What is still aboard goes down with you.',
    'Every prize makes your name. The King\'s sloop at Port Royal and the guarda costa of Santiago will come looking for it. Tortuga and the smugglers of Île-à-Vache will not ask.',
  ],
  hint: 'Z fires the larboard broadside and C the starboard, when the enemy is abeam. B boards. G moves the glass to the next sail and F sets the helmsman to chase her. Enter stands a watch: hours pass in seconds until the look-out calls. M is the chart, K the cabinet. The / key lists the rest.',
  go: 'Weigh anchor',
};

const CAIRD_HINT = 'You have the boat by hand, as any boat here. Enter stands a watch: four hours pass in a quarter of a minute while the helmsman holds your course, until something calls you. M is the chart. The / key lists the rest.';

export class Expedition {
  session: Running | null = null;
  private briefing: Briefing | null = null;
  private card: { close(): void } | null = null;
  private cabinet: Cabinet | null = null;
  private readonly offers: Offer[] = [PIRATES, ...VOYAGES.map((v): Offer => ({ id: v.id, title: v.title, line: v.line, briefing: v.briefing, hint: CAIRD_HINT, go: 'Cast off' }))];
  private chosen: string;

  /** @param go begin at once, with no briefing: for play testing with ?mode=expedition&go=1 */
  constructor(private readonly host: ExpeditionHost, go: boolean) {
    document.body.classList.add('expedition', 'lobby');
    // ?voyage=caird goes straight to the boat journey. Anything else, or nothing, is the pirate game.
    const asked = host.params.get('voyage');
    this.chosen = this.offers.find((o) => asked !== null && o.id.startsWith(asked))?.id ?? PIRATES.id;
    this.open(this.seed(true));
    if (go) this.castOff();
    else {
      this.briefing = new Briefing({
        voyages: this.offers,
        chosen: this.chosen,
        onBack: () => this.leave(),
        onPick: (offer) => {
          this.chosen = offer.id;
          this.open(this.seed(true));
        },
        onCastOff: () => this.castOff(),
      });
    }
  }

  /** ?seed=7 pins the weather and the traffic for a test. Otherwise every sailing gets its own. */
  private seed(first: boolean): number {
    const asked = Number(this.host.params.get('seed'));
    if (first && this.host.params.has('seed') && Number.isFinite(asked)) return Math.floor(asked);
    return Math.floor(Math.random() * 1e9);
  }

  /** Make the sea of whatever is chosen, put it on the stage and the boat on it. */
  private open(seed: number): void {
    this.session?.dispose();
    this.session = null;
    document.body.classList.remove('pirates');
    this.host.stage.ocean.resetLook();
    if (this.chosen === PIRATES.id) this.openPirates(seed);
    else this.openVoyage(VOYAGES.find((v) => v.id === this.chosen) ?? VOYAGES[0], seed);
    const handles = this.session!.debug();
    Object.assign(window, { regatta: handles, slackTide: handles });
  }

  private openVoyage(voyage: Voyage, seed: number): void {
    const { stage, boats, params } = this.host;
    const sea = buildSea(voyage, seed);
    const world = new ReplayWorld(sea, voyage.castOff * 3600);
    stage.sea = oceanSea();
    stage.setCourse(sea, world);
    this.session = new ExpeditionSession(stage, {
      voyage, sea, spec: boats[voyage.boat], showTruth: params.get('truth') === '1',
      onEnd: (result) => this.voyageEnded(voyage, result),
    });
  }

  private openPirates(seed: number): void {
    const { stage, boats, params } = this.host;
    // ?fresh=1 forgets the saved career, for a test that must start from nothing.
    const career = fitOut(params.get('fresh') === '1' ? fitOut({ ...loadCareer(), ...FRESH }) : loadCareer());
    saveCareer(career);
    document.body.classList.add('pirates');
    const sea = buildCaribbean(seed);
    stage.sea = oceanSea(SEA_GAIN);
    stage.setCourse(sea.sea, sea.world);
    this.session = new PirateSession(stage, {
      sea, seed, spec: boats[PLAYER_CLASS], career,
      onEnd: (end) => this.cruiseEnded(end),
    });
  }

  private castOff(): void {
    this.briefing = null;
    document.body.classList.remove('lobby');
    this.session?.castOff();
  }

  private again(): void {
    this.card = null;
    document.body.classList.add('lobby');
    this.open(this.seed(false));
    this.castOff();
  }

  private voyageEnded(voyage: Voyage, result: VoyageResult): void {
    this.card = new EndCard(voyage, result, { onAgain: () => this.again(), onLeave: () => this.leave() });
  }

  private cruiseEnded(end: CruiseEnd): void {
    this.card = new CruiseCard(end, {
      onAgain: () => this.again(),
      onLeave: () => this.leave(),
      onCabinet: () => {
        this.cabinet?.close();
        this.cabinet = new Cabinet(end.career, () => { this.cabinet = null; });
      },
    });
  }

  /** Give the stage back as Regatta expects to find it, and go back to the first screen. */
  private leave(): void {
    const { stage } = this.host;
    this.briefing?.close();
    this.card?.close();
    this.cabinet?.close();
    this.session?.dispose();
    this.session = null;
    stage.sea = BAY_SEA;
    stage.overcast = 0;
    stage.sunPlace = null;
    stage.haze.near = 1200;
    stage.haze.far = 30000;
    stage.sky.bakeGapMs = 0;
    stage.ocean.resetLook();
    document.body.classList.remove('expedition', 'lobby', 'pirates');
    this.host.onLeave();
  }

  frame(dt: number): void {
    this.session?.frame(dt);
  }
}

const FRESH = { banked: 150, artifacts: [] as string[], notoriety: 0, prizes: 0, lost: 0, ship: null, port: 'port-royal' };
