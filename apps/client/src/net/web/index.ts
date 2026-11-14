import type { Account, Db, Room, UserApi } from '../platform';
import { makeClient } from './client';
import { WebRoom } from './room';

/**
 * The website's backend, on Supabase: `room` on Realtime, `db` on Postgres tables, `user` and `account` on Auth.
 * Only `platform.ts` imports this, and only in builds that carry a backend.
 */
export interface Backend {
  room(area: string): Room;
  db: Db | null;
  user: UserApi;
  account: Account | null;
}

let made: Backend | null = null;

export function backend(): Backend {
  return (made ??= make());
}

function make(): Backend {
  const client = makeClient();
  /** The signed-in person's id, kept up to date so that it can be read without waiting. */
  let uid: string | null = null;
  const settled = client.auth.getSession().then(({ data }) => { uid = data.session?.user.id ?? null; }, () => {});
  client.auth.onAuthStateChange((_event, session) => { uid = session?.user.id ?? null; });

  const user: UserApi = {
    id: async () => { await settled; return uid; },
    can: async () => { await settled; return uid !== null; },
    profiles: async () => ({}),
  };

  // One water at a time: asking for another area leaves the one before.
  let water: WebRoom | null = null;
  const room = (area: string): Room => {
    if (water && water.area !== area) {
      water.close();
      water = null;
    }
    return (water ??= new WebRoom(client, area, () => uid));
  };

  return { room, db: null, user, account: null };
}
