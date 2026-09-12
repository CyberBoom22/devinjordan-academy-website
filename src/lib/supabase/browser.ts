/**
 * Supabase client for code running in the browser (the admin area's
 * interactive forms). Uses the publishable anon key, which is safe to expose:
 * row level security decides what it can actually do.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

let client: SupabaseClient<Database> | null = null;

export function getBrowserClient(): SupabaseClient<Database> {
  if (client) return client;

  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  client = createBrowserClient<Database>(url, anonKey);
  return client;
}
