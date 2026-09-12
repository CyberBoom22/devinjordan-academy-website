/**
 * Database types.
 *
 * PLACEHOLDER — replace with the real generated file once the Supabase project
 * exists:
 *
 *   supabase link --project-ref <ref>
 *   npm run db:types
 *
 * Until then this permissive shape keeps the app type-checking without
 * pretending to know the schema. Every query result is treated as unknown-ish
 * and narrowed by the row types in src/lib/content/types.ts, so replacing this
 * file tightens type safety rather than breaking the build.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: Record<string, { Row: any; Insert: any; Update: any; Relationships: [] }>;
    Views: Record<string, { Row: any; Relationships: [] }>;
    Functions: Record<string, { Args: any; Returns: any }>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, never>;
  };
};
