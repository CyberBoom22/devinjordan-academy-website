-- ===========================================================================
-- 0007 — Invite rotation, per-person invites, and an invite history
--
-- Three things the invite system was missing:
--
--   1. Every invite names the person it is for, not just an address.
--   2. Codes go stale on a schedule the academy chooses (default: 14 days),
--      and an administrator mints the replacement.
--   3. Every issue, rotation, revocation and redemption is recorded, so the
--      question "who was invited, by whom, and what happened to it" has an
--      answer that does not depend on anyone's memory.
--
-- ---------------------------------------------------------------------------
-- On what "rotates automatically" can honestly mean
-- ---------------------------------------------------------------------------
-- Codes are stored as hashes and nowhere else. That is deliberate — a stolen
-- backup should not be a working key — but it means nothing in the database
-- can quietly mint a new code on a timer: the new code would exist only as a
-- hash, so nobody could ever send it, and the invitee would be left holding a
-- link that stopped working for no visible reason.
--
-- So the two halves are split along the line of what is actually possible:
--
--   Expiry is automatic. Once `expires_at` passes, the code is refused, with
--   no job to run and nothing to go wrong. That is the security property the
--   rotation interval is really buying.
--
--   Minting the replacement is an administrator's action, because it is the
--   only moment the plaintext exists and can be handed to someone. The admin
--   screen shows which invites are due so this is prompted rather than
--   remembered.
-- ===========================================================================

-- --- How often codes go stale ----------------------------------------------
create table if not exists public.invite_settings (
  -- One row, forever. The check constraint is what makes that true rather
  -- than merely intended.
  id            boolean primary key default true check (id),
  rotation_days integer not null default 14 check (rotation_days between 1 and 365),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null
);

insert into public.invite_settings (id) values (true) on conflict (id) do nothing;

comment on table public.invite_settings is
  'Single row. How long a freshly minted invite code stays valid, unless an individual invite overrides it.';

alter table public.invite_settings enable row level security;

drop policy if exists "invite settings readable" on public.invite_settings;
create policy "invite settings readable"
  on public.invite_settings for select
  using (app.has_permission('user.invite') or app.has_permission('settings.read'));

drop policy if exists "invite settings writable" on public.invite_settings;
create policy "invite settings writable"
  on public.invite_settings for update
  using (app.has_permission('settings.write'))
  with check (app.has_permission('settings.write'));

-- --- An invite is for a person ---------------------------------------------
alter table public.invite_codes
  add column if not exists first_name     text,
  add column if not exists last_name      text,
  -- null means "whatever the academy-wide setting says", so changing the
  -- default moves every invite that never asked for something different.
  add column if not exists rotation_days  integer check (rotation_days between 1 and 365),
  add column if not exists rotated_at     timestamptz not null default now(),
  add column if not exists rotation_count integer not null default 0,
  add column if not exists revoked_at     timestamptz,
  add column if not exists revoked_by     uuid references public.profiles (id) on delete set null;

-- Every invite is tied to exactly one address. A bearer code that anybody
-- could redeem was never wanted here, and leaving the column nullable is how
-- one gets created by accident.
update public.invite_codes set email = '' where email is null;
alter table public.invite_codes alter column email set not null;

create index if not exists invite_codes_email_idx on public.invite_codes (lower(email));

comment on column public.invite_codes.rotation_days is
  'Overrides invite_settings.rotation_days for this invite alone. Null follows the academy-wide setting.';

-- --- Generating a code -----------------------------------------------------
create or replace function app.new_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- No O, I, 0 or 1: these get read off a screen and typed by hand, and the
  -- pairs people confuse are not worth the extra two bits.
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw      bytea := extensions.gen_random_bytes(20);
  out      text := '';
  i        integer;
begin
  for i in 0..19 loop
    -- 256 is a whole multiple of 32, so the modulo introduces no bias.
    out := out || substr(alphabet, 1 + (get_byte(raw, i) % 32), 1);
  end loop;

  return substr(out, 1, 5)  || '-' || substr(out, 6, 5) || '-' ||
         substr(out, 11, 5) || '-' || substr(out, 16, 5);
end;
$$;

comment on function app.new_invite_code() is
  '20 characters from a 32-symbol alphabet: 100 bits. Guessing is not a threat model; losing the plaintext is, which is why the caller gets it back exactly once.';

-- --- The interval that applies to one invite -------------------------------
create or replace function app.invite_rotation_days(p_override integer)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(p_override, (select rotation_days from public.invite_settings where id), 14);
$$;

-- --- Issue -----------------------------------------------------------------
create or replace function public.issue_invite(
  p_email         text,
  p_first_name    text,
  p_last_name     text,
  p_role_key      text,
  p_note          text default null,
  p_rotation_days integer default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role  uuid;
  v_code  text;
  v_days  integer;
  v_id    uuid;
begin
  -- SECURITY DEFINER puts this outside RLS, so the checks RLS would have made
  -- are made here instead, in the same order and for the same reasons.
  if not app.has_permission('user.invite') then
    raise exception 'You do not have permission to invite people.'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_role from public.roles where key = p_role_key;
  if v_role is null then
    raise exception 'No such role: %', p_role_key using errcode = 'invalid_parameter_value';
  end if;

  if not app.can_assign_role(v_role) then
    raise exception 'You cannot invite somebody to a role you do not outrank.'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(trim(p_email), '') = '' then
    raise exception 'An invite needs an email address to be tied to.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_code := app.new_invite_code();
  v_days := app.invite_rotation_days(p_rotation_days);

  insert into public.invite_codes (
    code_hash, email, first_name, last_name, role_id, note,
    created_by, rotation_days, rotated_at, expires_at
  )
  values (
    app.hash_invite_code(v_code), lower(trim(p_email)),
    nullif(trim(coalesce(p_first_name, '')), ''),
    nullif(trim(coalesce(p_last_name, '')), ''),
    v_role, nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(), p_rotation_days, now(), now() + make_interval(days => v_days)
  )
  returning id into v_id;

  perform app.record_audit(
    'invite.issue', 'invite_code', v_id::text,
    format('Invited %s as %s', lower(trim(p_email)), p_role_key),
    jsonb_build_object('email', lower(trim(p_email)), 'role', p_role_key, 'valid_days', v_days)
  );

  -- The only time the plaintext ever leaves this function.
  return v_code;
end;
$$;

-- --- Rotate ----------------------------------------------------------------
create or replace function public.rotate_invite(p_invite uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inv    public.invite_codes%rowtype;
  v_code text;
  v_days integer;
begin
  if not app.has_permission('user.invite') then
    raise exception 'You do not have permission to manage invites.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into inv from public.invite_codes where id = p_invite for update;
  if inv.id is null then
    raise exception 'No such invite.' using errcode = 'no_data_found';
  end if;

  if not app.can_assign_role(inv.role_id) then
    raise exception 'You cannot manage an invite to a role you do not outrank.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A redeemed invite is history. Rotating it would imply the account it
  -- created could be re-made, which is not what anybody means by the button.
  if inv.redeemed_at is not null then
    raise exception 'That invite has already been redeemed. Invite the person again instead.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_code := app.new_invite_code();
  v_days := app.invite_rotation_days(inv.rotation_days);

  update public.invite_codes
  set code_hash      = app.hash_invite_code(v_code),
      rotated_at     = now(),
      expires_at     = now() + make_interval(days => v_days),
      rotation_count = rotation_count + 1,
      revoked_at     = null,
      revoked_by     = null
  where id = p_invite;

  perform app.record_audit(
    'invite.rotate', 'invite_code', p_invite::text,
    format('New code issued for %s', inv.email),
    jsonb_build_object('email', inv.email, 'rotation', inv.rotation_count + 1, 'valid_days', v_days)
  );

  return v_code;
end;
$$;

-- --- Revoke ----------------------------------------------------------------
create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inv public.invite_codes%rowtype;
begin
  if not app.has_permission('user.invite') then
    raise exception 'You do not have permission to manage invites.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into inv from public.invite_codes where id = p_invite for update;
  if inv.id is null then
    raise exception 'No such invite.' using errcode = 'no_data_found';
  end if;

  if not app.can_assign_role(inv.role_id) then
    raise exception 'You cannot manage an invite to a role you do not outrank.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Expired in the past rather than deleted: the history is the point of the
  -- table, and a deleted row answers no questions later.
  update public.invite_codes
  set revoked_at = now(), revoked_by = auth.uid(), expires_at = now() - interval '1 second'
  where id = p_invite;

  perform app.record_audit(
    'invite.revoke', 'invite_code', p_invite::text,
    format('Revoked the invite for %s', inv.email),
    jsonb_build_object('email', inv.email)
  );
end;
$$;

-- --- Redemption gets recorded too ------------------------------------------
-- app.record_audit() writes nothing when auth.uid() has no profile, which is
-- exactly the case during signup, so the redemption is logged directly with
-- the new account as its own actor.
create or replace function app.log_invite_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.redeemed_at is not null and old.redeemed_at is null then
    insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, summary, details)
    values (
      new.redeemed_by, new.email, 'invite.redeem', 'invite_code', new.id::text,
      format('%s registered using their invite', new.email),
      jsonb_build_object('email', new.email, 'rotations_before_use', new.rotation_count)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists invite_codes_log_redemption on public.invite_codes;
create trigger invite_codes_log_redemption
  after update on public.invite_codes
  for each row execute function app.log_invite_redemption();

-- --- The history, per person -----------------------------------------------
-- A view rather than a screenful of joins in the application: "every invite,
-- who it was for, what state it is in and what has happened to it" is one
-- question, and it should be one query.
create or replace view public.invite_overview
with (security_invoker = true) as
select
  i.id,
  i.email,
  i.first_name,
  i.last_name,
  trim(coalesce(i.first_name, '') || ' ' || coalesce(i.last_name, '')) as full_name,
  r.key                        as role_key,
  r.name                       as role_name,
  r.level                      as role_level,
  i.note,
  i.created_at,
  i.rotated_at,
  i.expires_at,
  i.rotation_count,
  i.redeemed_at,
  i.redeemed_by,
  i.revoked_at,
  app.invite_rotation_days(i.rotation_days) as rotation_days,
  issuer.email                 as issued_by_email,
  redeemer.email               as redeemed_by_email,
  case
    when i.redeemed_at is not null then 'redeemed'
    when i.revoked_at  is not null then 'revoked'
    when i.expires_at <= now()     then 'expired'
    else 'active'
  end                          as status,
  greatest(0, extract(epoch from (i.expires_at - now()))::bigint / 86400) as days_left
from public.invite_codes i
join public.roles r            on r.id = i.role_id
left join public.profiles issuer   on issuer.id = i.created_by
left join public.profiles redeemer on redeemer.id = i.redeemed_by;

comment on view public.invite_overview is
  'Every invite with its person, role and current state. security_invoker, so the invite_codes RLS policy decides who sees rows — never the view.';

grant select on public.invite_overview to authenticated;

grant execute on function public.issue_invite(text, text, text, text, text, integer) to authenticated;
grant execute on function public.rotate_invite(uuid) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function app.invite_rotation_days(integer) to authenticated;
