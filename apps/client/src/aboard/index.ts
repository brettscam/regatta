import type { AboardContext, Feature } from './feature';
import { Fishing } from './fishing';
import { CrabPots } from './pots';

/** Every feature in the game, in the order their hooks run. Add a line here for a new one. */
export function createFeatures(ctx: AboardContext): Feature[] {
  return [
    new CrabPots(ctx),
    new Fishing(ctx),
  ];
}
