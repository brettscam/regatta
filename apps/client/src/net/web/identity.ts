import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config';
import type { Account, AccountResult, UserApi } from '../platform';
import { SIGNIN_CODE } from './config';

/**
 * Who this person is on the website: Supabase Auth, signing in with an email address and no password.
 *
 * Asking to sign in sends an email with a link. Opening the link brings the browser back to this page signed in,
 * and the session is then kept in this browser. Nobody has to sign in to sail or to see other boats.
 * `user.id()` is the Supabase user id. Names for other people come from their saved logbook (the skipper name
 * they typed on the join screen). Email addresses are never read here, except this person's own to show them.
 */

export interface Identity {
  user: UserApi;
  account: Account;
  /** The signed-in person's id as it stands, without waiting. */
  uid(): string | null;
  /** Settles once the session kept in this browser, or brought by a sign-in link, has been read. */
  ready: Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A sentence for the player from whatever the sign-in service said. */
function reason(error: { code?: string; status?: number; message?: string }, sending: boolean): string {
  const code = error.code ?? '';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || error.status === 429) return 'Too many sign-in emails have been asked for just now. Wait a few minutes and try again.';
  if (code === 'email_address_not_authorized') return 'Sign-in emails cannot be sent to that address yet. The site\'s email is still being set up.';
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'That does not look like an email address.';
  if (code === 'signup_disabled' || code === 'email_provider_disabled') return 'Signing in is switched off at the moment.';
  if (code === 'otp_expired' || code === 'otp_disabled') return 'That code is wrong or has run out. Ask for a new email.';
  return sending ? 'The email could not be sent. Check your connection and try again in a minute.' : 'That did not work. Check the code and try again.';
}

export function makeIdentity(client: SupabaseClient, arrivedWith: string): Identity {
  let uid: string | null = null;
  let email: string | null = null;
  let settled = false;
  const listeners = new Set<() => void>();
  const take = (session: { user: { id: string; email?: string } } | null): void => {
    const before = uid;
    uid = session?.user.id ?? null;
    email = session?.user.email ?? null;
    if (settled && uid !== before) for (const l of [...listeners]) l();
  };
  const ready = client.auth.getSession().then(({ data }) => take(data.session), () => {}).then(() => { settled = true; });
  client.auth.onAuthStateChange((_event, session) => take(session));

  // Which other ways of signing in the project has switched on. Asked once, quietly: until it answers, only email is offered.
  let google = false;
  void fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { external?: Record<string, boolean> } | null) => {
      // The answer is here long before anyone opens the sign-in form, so nothing needs telling.
      if (d?.external?.google) google = true;
    })
    .catch(() => { /* email it is */ });

  // A link that had run out, or had been used already, comes back with the reason in the address. Tidy it away.
  const expired = /(^|[#&])error(_code|_description)?=/.test(arrivedWith);
  const fromLink = /(^|[#&])access_token=/.test(arrivedWith);
  if (expired) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch { /* the address stays as it is */ }
  }

  const user: UserApi = {
    id: async () => { await ready; return uid; },
    // On the website, writing is for anyone who has signed in. The database checks it again on every write.
    can: async (name) => { await ready; return name === 'data.write' ? uid !== null : null; },
    profiles: async (ids) => {
      const wanted = [...new Set(ids)].filter((id) => UUID.test(id)).slice(0, 100);
      const out: Record<string, { name: string }> = {};
      if (!wanted.length) return out;
      const { data, error } = await client.from('profiles').select('uid, name:doc->>skipper').in('uid', wanted);
      if (error) throw { code: error.code ?? 'unavailable' };
      for (const row of (data ?? []) as Array<{ uid: string; name: string | null }>) {
        const name = (row.name ?? '').trim().slice(0, 20);
        if (name) out[row.uid] = { name };
      }
      return out;
    },
  };

  const account: Account = {
    email: () => email,
    codes: SIGNIN_CODE,
    get arrival() {
      return expired ? 'expired' as const : fromLink && uid ? 'signed-in' as const : null;
    },
    send: async (to): Promise<AccountResult> => {
      const address = to.trim();
      if (!ADDRESS.test(address) || address.length > 254) return { ok: false, reason: 'That does not look like an email address.' };
      try {
        // The link comes back to this page, wherever the game is being served from.
        const { error } = await client.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
        return error ? { ok: false, reason: reason(error, true) } : { ok: true };
      } catch {
        return { ok: false, reason: reason({}, true) };
      }
    },
    google: () => google,
    withGoogle: async (): Promise<AccountResult> => {
      try {
        // Google sends the player back to this page, wherever the game is being served from.
        const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
        return error ? { ok: false, reason: 'Google sign-in could not be started. Try the email link instead.' } : { ok: true };
      } catch {
        return { ok: false, reason: 'Google sign-in could not be started. Try the email link instead.' };
      }
    },
    verify: async (to, code): Promise<AccountResult> => {
      const token = code.replace(/\s/g, '');
      if (!/^\d{6,10}$/.test(token)) return { ok: false, reason: 'The code is the row of digits in the email.' };
      try {
        const { error } = await client.auth.verifyOtp({ email: to.trim(), token, type: 'email' });
        return error ? { ok: false, reason: reason(error, false) } : { ok: true };
      } catch {
        return { ok: false, reason: reason({}, false) };
      }
    },
    signOut: async () => {
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
    },
    onChange: (handler) => {
      listeners.add(handler);
      return () => { listeners.delete(handler); };
    },
  };

  return { user, account, uid: () => uid, ready };
}
