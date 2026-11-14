import type { Account, Db, Room, UserApi } from '../platform';
import { makeClient } from './client';
import { WebDb } from './db';
import { makeIdentity } from './identity';
import { WebRoom } from './room';

/**
 * The website's backend, on Supabase: `room` on Realtime, `db` on Postgres tables, `user` and `account` on Auth.
 * Only `platform.ts` imports this, and only in builds that carry a backend.
 */
export interface Backend {
  room(area: string): Room;
  db: Db;
  user: UserApi;
  account: Account;
  /** Settles once it is known whether this person is signed in. */
  ready: Promise<void>;
}

let made: Backend | null = null;

export function backend(): Backend {
  return (made ??= make());
}

function make(): Backend {
  // A sign-in link brings its result back in the address. Note it before the client reads it and tidies it away.
  const arrivedWith = location.hash;
  const client = makeClient();
  const identity = makeIdentity(client, arrivedWith);

  // One water at a time: asking for another area leaves the one before.
  let water: WebRoom | null = null;
  const room = (area: string): Room => {
    if (water && water.area !== area) {
      water.close();
      water = null;
    }
    return (water ??= new WebRoom(client, area, identity.uid));
  };

  return { room, db: new WebDb(client), user: identity.user, account: identity.account, ready: identity.ready };
}
