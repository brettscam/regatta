import { BadAir } from './badair';
import { ClubBanter } from './banter';
import { CheatStrip } from './cheat';
import { Contact } from './contact';
import { Dive } from './dive';
import { Dockside } from './dock';
import { Engine } from './engine';
import type { AboardContext, Feature } from './feature';
import { Fishing } from './fishing';
import { Angling } from './angling';
import { tableOf } from '../fishing/table';
import { FlowView } from './flow';
import { Mooring } from './mooring';
import { Pilotage } from './pilotage';
import { Guide } from './guide';
import { Kayak } from './kayak';
import { Landmarks } from './landmarks';
import { SeamanshipPoints } from './seamanship';
import { CrabPots } from './pots';
import { Radio } from './radio';
import { Residents } from './residents';
import { Tips } from './tips';
import { Tow } from './tow';
import { Wildlife } from './wildlife';
import { Ashore } from '../ashore/walk'; // ashore

/**
 * Every feature in the game, in the order their hooks run. Add a line here for a new one.
 * Order matters twice over. The first one with something to say gives the boat's status, and the first to take a key keeps it.
 * So stepping ashore at a dock goes first (it takes O only there), then the kayak (while the player is away in her, X must not weigh the yacht's anchor),
 * then the passing ones (a pot coming up, a fish on), then anchoring. The animals come last: they take no keys and give no status.
 * After them, experience points: it only watches, takes N and gives no status.
 */
export function createFeatures(ctx: AboardContext): Feature[] {
  return [
    // Local knowledge comes first only so that it can keep the kayak aboard inside a wildlife refuge. It takes O nowhere else and gives no status.
    new Pilotage(ctx),
    // Over the side with a mask and a speargun. Ahead of the tender and the anchor: while she is in the water every key is hers.
    new Dive(ctx),
    // ashore: on foot at a place. Before the dock and the tender: while she is walking, the keys, the status and the camera are hers.
    new Ashore(ctx),
    new Dockside(ctx),
    new Kayak(ctx),
    new CrabPots(ctx),
    // A water with its own fishing table (`courses/<id>/fishing.json`) fishes by it: trolling, bait, the fight, tournaments.
    // The others keep the game's first fishing. Both answer to L and are the feature called 'fishing'.
    ((table) => (table ? new Angling(ctx, table) : new Fishing(ctx)))(tableOf(ctx.stage.course.id)),
    new Mooring(ctx),
    new Engine(ctx),
    new Tow(ctx),
    new FlowView(ctx),
    new Guide(ctx),
    new CheatStrip(ctx),
    new Radio(ctx),
    new Wildlife(ctx),
    // The boats that live here take no keys. Their status (a race to the next point) comes after everything the player does herself.
    new Residents(ctx),
    // The names over the places ashore: they take no keys either.
    new Landmarks(ctx),
    // Wind shadow and collisions watch the other boats and take no keys. A holed boat's status is given by the session before any other.
    new BadAir(ctx),
    new Contact(ctx),
    new SeamanshipPoints(ctx),
    // The club skippers' remarks during a race. It only listens.
    new ClubBanter(ctx),
    // The pop-up tips and the radio's light. Last: they watch everything, take no keys and give no status.
    new Tips(ctx),
  ];
}
