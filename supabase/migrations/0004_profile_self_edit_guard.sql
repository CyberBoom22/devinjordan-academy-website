-- ===========================================================================
-- 0004 — Stop an account editing its own status
--
-- `profiles` is the only table with a policy that lets a row edit itself:
--
--     create policy "own profile editable"
--       on public.profiles for update
--       using (id = auth.uid()) with check (id = auth.uid());
--
-- That policy exists so people can change their own name, photo and phone
-- number. But RLS policies are permissive and OR'd together, and a policy
-- cannot restrict which COLUMNS it covers — so it also let an account write
-- its own `status`.
--
-- `status` is the revocation switch. app.has_permission() returns false for
-- anything but 'active', so suspending an account is how the academy takes
-- access away. A suspended user still holds a valid Supabase token, and
-- nothing revoked it, so before this migration they could send:
--
--     PATCH /rest/v1/profiles?id=eq.<their own id>   {"status":"active"}
--
-- and restore every permission they had. Suspension was self-reversible,
-- which is to say it was not suspension.
--
-- A trigger is the fix rather than a narrower policy, because column-level
-- control is not expressible in RLS, and column GRANTs cannot help either:
-- administrators and ordinary staff are both the `authenticated` role, so
-- revoking UPDATE on `status` would disarm the admin screens too.
--
-- The rule mirrors app.can_manage_user(), which already refuses self-
-- management: nobody edits their own authority, owners included. An
-- administrator changes someone else's status; a second administrator
-- changes theirs.
-- ===========================================================================

create or replace function app.guard_profile_self_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- auth.uid() is null for the service role and for migrations, which must
  -- stay able to repair any column. This guard is only about a signed-in
  -- user acting on their own row.
  if auth.uid() is null or old.id <> auth.uid() then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'You cannot change your own account status. Ask another administrator.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.id is distinct from old.id then
    raise exception 'A profile id cannot be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  -- profiles.email mirrors auth.users.email. Editing it here would desync the
  -- two silently; an address change belongs to Supabase Auth.
  if new.email is distinct from old.email then
    raise exception 'Change your email address through your account settings, not your profile.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not editable.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function app.guard_profile_self_edit() is
  'Blocks a signed-in user from changing privileged columns on their own profile row. status is the important one: it is the revocation switch that app.has_permission() reads.';

drop trigger if exists profiles_guard_self_edit on public.profiles;

create trigger profiles_guard_self_edit
  before update on public.profiles
  for each row execute function app.guard_profile_self_edit();
