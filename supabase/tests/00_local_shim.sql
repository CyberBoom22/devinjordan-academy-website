-- Minimal stand-ins for what Supabase provides, so the migrations can be run
-- and exercised locally exactly as they will run in production.
create extension if not exists pgcrypto;
create schema if not exists auth;

create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb default '{}'::jsonb
);

-- Supabase derives auth.uid() from the request JWT. Locally we drive it from a
-- session setting so each test can act as a different person.
create or replace function auth.uid() returns uuid
language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role app_user login; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;
grant authenticated, anon to app_user;
