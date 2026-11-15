/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which backend this build carries: `supabase` on the website, `none` in the single-file artifact build. Set in vite.config.ts. */
  readonly VITE_BACKEND?: string;
  /** The website's Supabase project. The real values are committed as the fallback in net/web/config.ts. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
  /** `1` when the sign-in email carries a code to type in as well as a link. */
  readonly VITE_SIGNIN_CODE?: string;
  /** Realtime messages a second that one sailing area may use. See net/web/pacing.ts. */
  readonly VITE_WATER_BUDGET?: string;
  /** A TURN relay for the voice radio, if there is one. See net/web/config.ts. */
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USER?: string;
  readonly VITE_TURN_PASS?: string;
}
