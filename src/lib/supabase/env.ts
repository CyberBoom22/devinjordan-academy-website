/**
 * Environment access.
 *
 * Astro exposes build-time values on import.meta.env, but on Cloudflare the
 * deployed Worker receives its bindings at runtime instead. Reading through
 * these helpers means the same code works in `astro dev`, in `wrangler dev`
 * and in production without conditionals scattered through the app.
 */

type EnvSource = Record<string, string | undefined>;

function read(key: string, runtimeEnv?: EnvSource): string | undefined {
  const value = runtimeEnv?.[key] ?? (import.meta.env as EnvSource)[key] ?? process.env?.[key];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

/**
 * Public Supabase credentials, or null when the project has not been connected
 * yet. Returning null rather than throwing is deliberate: the site falls back
 * to its built-in seed content so it renders correctly before the database
 * exists, which keeps the first deploy from being a chicken-and-egg problem.
 */
export function getSupabaseConfig(runtimeEnv?: EnvSource): SupabaseConfig | null {
  const url = read('PUBLIC_SUPABASE_URL', runtimeEnv);
  const anonKey = read('PUBLIC_SUPABASE_ANON_KEY', runtimeEnv);
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Service-role key. Bypasses row level security, so this must only ever be
 * read on the server. Nothing that imports this file may be shipped to the
 * browser.
 */
export function getServiceRoleKey(runtimeEnv?: EnvSource): string | undefined {
  return read('SUPABASE_SERVICE_ROLE_KEY', runtimeEnv);
}

export function getSiteUrl(runtimeEnv?: EnvSource): string {
  return read('PUBLIC_SITE_URL', runtimeEnv) ?? 'http://localhost:4321';
}
