import type { Account, Db, Room, UserApi, Voice } from '../platform';
import { makeClient } from './client';
import { WebDb } from './db';
import { makeIdentity } from './identity';
import { WebRoom } from './room';
import { VoiceMesh } from './voice';

/**
 * The website's backend, on Supabase: `room` on Realtime, `db` on Postgres tables, `user` and `account` on Auth.
 * Only `platform.ts` imports this, and only in builds that carry a backend.
 */
export interface Backend {
  room(area: string): Room;
  /** The voice radio of one sailing area. It does nothing until it is opened. */
  voice(area: string): Voice;
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
  const room = (area: string): WebRoom => {
    if (water && water.area !== area) {
      water.close();
      water = null;
    }
    return (water ??= new WebRoom(client, area, identity.uid));
  };

  // One radio at a time as well. It goes by the same id as this page's boat, so that a voice can be given her name.
  let radio: { area: string; mesh: VoiceMesh } | null = null;
  const voice = (area: string): Voice => {
    if (radio && radio.area !== area) {
      radio.mesh.close();
      radio = null;
    }
    return (radio ??= { area, mesh: new VoiceMesh(client, area, room(area).me) }).mesh;
  };

  return { room, voice, db: new WebDb(client), user: identity.user, account: identity.account, ready: identity.ready };
}
