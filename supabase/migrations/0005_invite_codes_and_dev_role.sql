-- ===========================================================================
-- 0005 — Invite-only registration, and the Dev role
--
-- Until now there was no way to create an account at all: the first Owner had
-- to be made by hand in the Supabase dashboard and granted a role with raw
-- SQL. This adds the missing front door, and locks it.
--
-- Three pieces:
--
--   1. A `dev` role at level 1 — above Owner — holding every permission.
--   2. `invite_codes`: single-use, time-limited, optionally bound to one
--      email address, and carrying the role the holder will receive.
--   3. Redemption inside app.handle_new_user(), so the account, its status
--      and its role are created in one transaction with the auth user.
--
-- Why redemption happens in the signup trigger rather than a call the new
-- account makes afterwards:
--
--   * Atomicity. A separate call can fail, leaving an account with no role —
--     locked out, and looking to the administrator like a registration bug.
--   * Email confirmation. app.handle_new_user() set status to 'invited' when
--     the address was unconfirmed, and nothing ever moved it to 'active'
--     afterwards, because the trigger only fires on INSERT. Any account made
--     with confirmation switched on was permanently unable to hold a
--     permission. Redeeming a valid invite now settles the status directly.
--   * 0004's profile guard. A signed-in user cannot change their own
--     `status`, which is exactly what activation would be. Inside the signup
--     trigger there is no signed-in user — auth.uid() is null — so the guard
--     stands down and the account activates cleanly. Handing the new account
--     a way to activate itself would have punched a hole straight through
--     0004.
-- ===========================================================================

-- --- The Dev role ----------------------------------------------------------
-- Level 1: above Owner (10), so it can administer owners. `is_system` so it
-- cannot be deleted or re-levelled from the admin UI and leave nobody able to
-- reach the top of the system.
insert into public.roles (key, name, description, level, is_system) values
  ('dev', 'Dev',
   'Unrestricted. Holds every permission, outranks Owner, and exists for whoever maintains the software itself rather than the academy. Should be held by as few people as possible — ideally one.',
   1, true)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  is_system = excluded.is_system;

-- Every permission there is, and every permission added later: this INSERT is
-- re-runnable and the `npm run db:permissions` generator appends to
-- public.permissions, so re-running 0005 after adding a permission grants it.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.key = 'dev'
on conflict do nothing;

-- --- Invite codes ----------------------------------------------------------
create table if not exists public.invite_codes (
  id          uuid primary key default uuid_generate_v4(),
  -- The code itself is never stored. A stolen database backup should not hand
  -- the thief a working key to the admin area.
  code_hash   text not null unique,
  -- When set, only this address may redeem the code. An unbound code is a
  -- bearer token: whoever holds it gets the role.
  email       text,
  role_id     uuid not null references public.roles (id) on delete restrict,
  note        text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles (id) on delete set null
);

comment on table public.invite_codes is
  'Single-use registration codes. Stored as sha256 hashes; the plaintext exists only in the message that delivered it.';

create index if not exists invite_codes_open_idx
  on public.invite_codes (expires_at) where redeemed_at is null;

alter table public.invite_codes enable row level security;

-- Reading the table is for administrators only, and even they never see a
-- code — only its hash, which is useless to them. Issuing one is gated on
-- user.invite, and on outranking the role being handed out, so an
-- Administrator cannot mint themselves an Owner.
create policy "invites readable with permission"
  on public.invite_codes for select
  using (app.has_permission('user.invite'));

create policy "invites issuable with permission"
  on public.invite_codes for insert
  with check (app.has_permission('user.invite') and app.can_assign_role(role_id));

create policy "invites revocable with permission"
  on public.invite_codes for delete
  using (app.has_permission('user.invite') and app.can_assign_role(role_id));

-- --- Hashing ---------------------------------------------------------------
-- Codes are compared case-insensitively and with surrounding whitespace
-- ignored, because they are typed by hand off a screen or a text message.
create or replace function app.hash_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex');
$$;

-- --- Pre-flight check, callable before an account exists -------------------
-- The registration form calls this before creating anything, so a mistyped
-- code produces a clear message instead of an orphaned auth user with no role.
-- Returns one of: ok, invalid, expired, already-used, wrong-email.
create or replace function app.check_invite(p_code text, p_email text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  inv public.invite_codes%rowtype;
begin
  select * into inv from public.invite_codes
  where code_hash = app.hash_invite_code(p_code);

  if inv.id is null then return 'invalid'; end if;
  if inv.redeemed_at is not null then return 'already-used'; end if;
  if inv.expires_at <= now() then return 'expired'; end if;
  if inv.email is not null and lower(inv.email) is distinct from lower(trim(p_email))
    then return 'wrong-email'; end if;

  return 'ok';
end;
$$;

comment on function app.check_invite(text, text) is
  'Validates a code without consuming it. Callable anonymously — registration has to be able to ask before an account exists. Put a rate limit in front of the page that calls it.';

-- --- Redemption, folded into account creation ------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code   text := nullif(trim(new.raw_user_meta_data ->> 'invite_code'), '');
  v_status public.account_status;
  inv      public.invite_codes%rowtype;
begin
  -- No invite, or a bad one: the account is still created, but it holds no
  -- role, and no role means no permission. Signing up is never, by itself,
  -- a way in.
  v_status := case when new.email_confirmed_at is null then 'invited' else 'active' end;

  if v_code is not null then
    select * into inv from public.invite_codes
    where code_hash = app.hash_invite_code(v_code)
      and redeemed_at is null
      and expires_at > now()
      and (email is null or lower(email) = lower(new.email))
    for update;

    -- A redeemed invite is the vetting, so it settles the status itself
    -- rather than waiting on an email round trip that nothing would react to.
    if inv.id is not null then
      v_status := 'active';
    end if;
  end if;

  insert into public.profiles (id, email, full_name, status)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    v_status
  )
  on conflict (id) do nothing;

  if inv.id is not null then
    insert into public.user_roles (user_id, role_id, granted_by)
    values (new.id, inv.role_id, inv.created_by)
    on conflict do nothing;

    update public.invite_codes
    set redeemed_at = now(), redeemed_by = new.id
    where id = inv.id;
  end if;

  return new;
end;
$$;

grant execute on function app.check_invite(text, text) to anon, authenticated;
grant execute on function app.hash_invite_code(text) to authenticated;
