import type { AboardContext, Feature } from './feature';
import { Mooring } from './mooring';

/** Every feature in the game, in the order their hooks run. Add a line here for a new one. */
export function createFeatures(ctx: AboardContext): Feature[] {
  return [
    new Mooring(ctx),
  ];
}
