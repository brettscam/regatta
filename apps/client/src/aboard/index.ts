import { CheatStrip } from './cheat';
import { Dockside } from './dock';
import type { AboardContext, Feature } from './feature';
import { Fishing } from './fishing';
import { FlowView } from './flow';
import { Mooring } from './mooring';
import { Kayak } from './kayak';
import { CrabPots } from './pots';
import { Tow } from './tow';

/**
 * Every feature in the game, in the order their hooks run. Add a line here for a new one.
 * Order matters twice over. The first one with something to say gives the boat's status, and the first to take a key keeps it.
 * So stepping ashore at a dock goes first (it takes O only there), then the kayak (while the player is away in her, X must not weigh the yacht's anchor),
 * then the passing ones (a pot coming up, a fish on), then anchoring.
 */
export function createFeatures(ctx: AboardContext): Feature[] {
  return [
    new Dockside(ctx),
    new Kayak(ctx),
    new CrabPots(ctx),
    new Fishing(ctx),
    new Mooring(ctx),
    new Tow(ctx),
    new FlowView(ctx),
    new CheatStrip(ctx),
  ];
}
