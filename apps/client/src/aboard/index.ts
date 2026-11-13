import type { AboardContext, Feature } from './feature';
import { Fishing } from './fishing';
import { FlowView } from './flow';
import { Mooring } from './mooring';
import { CrabPots } from './pots';

/**
 * Every feature in the game, in the order their hooks run. Add a line here for a new one.
 * The first one with something to say gives the boat's status, so the passing ones (a pot coming up, a fish on) go before anchoring.
 */
export function createFeatures(ctx: AboardContext): Feature[] {
  return [
    new CrabPots(ctx),
    new Fishing(ctx),
    new Mooring(ctx),
    new FlowView(ctx),
  ];
}
