import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

/**
 * The one Supabase client for the page. It keeps a signed-in person's session in this browser, renews it by itself,
 * and picks a session up from the address when the page is opened from a sign-in link.
 */
export function makeClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
}
