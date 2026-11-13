import type { AboardContext, Feature } from './feature';
import { FlowView } from './flow';

/** Every feature in the game, in the order their hooks run. Add a line here for a new one. */
export function createFeatures(ctx: AboardContext): Feature[] {
  return [
    new FlowView(ctx),
  ];
}
