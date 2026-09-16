/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    /** Request-scoped Supabase client, or null when Supabase is not configured. */
    supabase: import('./lib/supabase/server').Client | null;
    /** Signed-in user and their effective permissions, resolved once per request. */
    session: import('./lib/auth/session').Session;
  }
}

interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL: string;
  readonly EMAIL_FROM?: string;
  readonly EMAIL_REPLY_TO?: string;
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Cloudflare Worker bindings, mirrored from wrangler.toml. */
interface Env {
  PUBLIC_SITE_URL?: string;
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Resend. A secret, so it is absent in local dev unless one is set. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
}
