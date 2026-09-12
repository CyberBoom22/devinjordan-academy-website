/**
 * Request-scoped Supabase clients for server rendering.
 *
 * A new client is created per request and carries that visitor's auth cookies,
 * so every query runs as the signed-in user and row level security does the
 * access control. There is no shared client and no ambient session, so two
 * requests can never see each other's data.
 */

import { createServerClient, parseCookieHeader, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig, getServiceRoleKey } from './env';
import type { Database } from './database.types';

export type Client = SupabaseClient<Database>;

/** The slice of Astro's cookie API this module needs. */
type CookieJar = {
  set: (key: string, value: string, options: CookieOptions) => void;
};

export type RequestContext = {
  request: Request;
  cookies: CookieJar;
  runtimeEnv?: Record<string, string | undefined>;
};

/**
 * Client acting as the current visitor. Returns null when Supabase has not
 * been connected yet; callers fall back to the built-in seed content so the
 * site still renders.
 */
export function createRequestClient({
  request,
  cookies,
  runtimeEnv,
}: RequestContext): Client | null {
  const config = getSupabaseConfig(runtimeEnv);
  if (!config) return null;

  return createServerClient<Database>(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '').map(({ name, value }) => ({
          name,
          value: value ?? '',
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, {
            ...options,
            path: options?.path ?? '/',
            httpOnly: options?.httpOnly ?? true,
            sameSite: options?.sameSite ?? 'lax',
            secure: options?.secure ?? new URL(request.url).protocol === 'https:',
          });
        }
      },
    },
  });
}

/**
 * Client that BYPASSES row level security. Only for the few operations the
 * database cannot express as a policy — inviting a user, or reading auth.users.
 *
 * Every call site must perform its own permission check first. Reaching for
 * this should prompt the question of whether a policy would do the job instead.
 */
export function createAdminClient(runtimeEnv?: Record<string, string | undefined>): Client | null {
  const config = getSupabaseConfig(runtimeEnv);
  const serviceKey = getServiceRoleKey(runtimeEnv);
  if (!config || !serviceKey) return null;

  return createServerClient<Database>(config.url, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
