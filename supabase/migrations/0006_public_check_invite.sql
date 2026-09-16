-- ===========================================================================
-- 0006 — Expose the invite check to the registration form
--
-- app.check_invite() does the work, but PostgREST only serves functions in the
-- schemas the project exposes, and `app` is deliberately not one of them —
-- everything else in there is called by RLS policies from inside the database,
-- where exposure would be a liability rather than a feature.
--
-- The registration form is the one caller that has to reach in from outside,
-- and it must do so before an account exists, so the wrapper is granted to
-- `anon`. It answers exactly one question — is this code usable by this
-- address — and returns a reason rather than a row: nothing about the invite,
-- the role it carries or who issued it crosses the boundary.
--
-- Guessing is not a realistic path in: a code is 15 characters from a
-- 32-symbol alphabet, so roughly 3.7e22 possibilities. Worth a rate limit on
-- the page all the same, for the same reason sign-in wants one.
-- ===========================================================================

create or replace function public.check_invite(p_code text, p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app.check_invite(p_code, p_email);
$$;

comment on function public.check_invite(text, text) is
  'Registration pre-flight. Returns ok | invalid | expired | already-used | wrong-email. Does not consume the code — redemption happens in app.handle_new_user() when the account is created.';

-- `public` here is the PUBLIC pseudo-role (everybody), not the schema. Revoke
-- first so the grant below is the whole story rather than an addition to
-- whatever the default happened to be.
revoke all on function public.check_invite(text, text) from public;
grant execute on function public.check_invite(text, text) to anon, authenticated;
