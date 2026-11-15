/**
 * The website's Supabase project. Both values are public by design: the key is the publishable one that every
 * visitor's browser is sent, and what protects the data is row-level security in the database
 * (see supabase/migrations). A secret or service-role key must never be put here or anywhere else in the repo.
 *
 * Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY when building to point a build at another project.
 */
const env = import.meta.env;

export const SUPABASE_URL: string = env.VITE_SUPABASE_URL || 'https://aputrtdndagdovdpwstk.supabase.co';
export const SUPABASE_KEY: string = env.VITE_SUPABASE_KEY || 'sb_publishable_jgXQoz0GF4UZ1dve4D_sGg_-J4wejGQ';

/** True when the sign-in email has been set up to carry a code as well as a link, so the form offers a box for it. */
export const SIGNIN_CODE: boolean = env.VITE_SIGNIN_CODE === '1';

/**
 * Realtime messages a second that one sailing area may use, counting each report once as sent and once for every
 * boat it is delivered to. The free plan allows the whole project 100 a second, so 40 leaves room for a second
 * area and for everything else.
 */
export const WATER_BUDGET: number = Number(env.VITE_WATER_BUDGET) > 0 ? Number(env.VITE_WATER_BUDGET) : 40;

/**
 * A TURN relay for the voice radio, for players whose networks will not let two browsers reach each other directly.
 * None is set up: voice uses public STUN servers only, which is enough for most home networks. To add one, set
 * VITE_TURN_URL (one or more `turn:` addresses, comma-separated), VITE_TURN_USER and VITE_TURN_PASS when building.
 * These reach every visitor's browser, so they must be credentials meant for that.
 */
export const TURN = { url: env.VITE_TURN_URL || '', user: env.VITE_TURN_USER || '', pass: env.VITE_TURN_PASS || '' };
