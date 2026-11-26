import { prospects } from './bites';
import { spotAt } from './grounds';
import { hereOf, type FishWorld } from './here';
import type { FishTable } from './table';
import type { Reserve } from './zones';

/**
 * Where something is biting now, for a boat that lives here to pass on when hailed: the best of the named grounds,
 * fished stopped with a live bait or with squid. True by the same rules the player's own line follows, so the tip can
 * be acted on. Null when nothing much is biting anywhere.
 * @param t session time, seconds; `seasonNow` the same moment on the season's clock
 */
export function fishTip(table: FishTable, reserves: readonly Reserve[], world: FishWorld, timeZone: string, t: number, seasonNow: number): { species: string; place: string; how: string } | null {
  let best: { species: string; place: string; how: string } | null = null;
  let most = 0.25;
  for (const g of table.grounds) {
    if (!g.circle || g.kind === 'barge') continue;
    const spot = spotAt(table, reserves, hereOf(world, timeZone, g.circle[0], g.circle[1], t, 0.4, 0.4, false), seasonNow);
    for (const rig of ['bait', 'squid'] as const) {
      const top = prospects(table, spot, { lure: 'feather', rig, bait: 1, rods: 1 })[0];
      if (top && top.keen > most) {
        most = top.keen;
        best = { species: top.species.name, place: g.name, how: rig === 'bait' ? 'with a live bait' : 'with a bait on the bottom' };
      }
    }
  }
  return best;
}
