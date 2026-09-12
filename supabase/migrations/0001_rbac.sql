-- ===========================================================================
-- 0001 — Identity, roles and granular permissions
--
-- The access model has three layers, checked in this order:
--
--   1. Account status   A suspended profile can do nothing, whatever it holds.
--   2. Per-user override A row in user_permissions grants or DENIES one single
--                        permission for one person. A deny always wins.
--   3. Role permissions  Otherwise, the union of everything this user's roles
--                        carry.
--
-- Alongside that sits the HIERARCHY, which permissions deliberately cannot
-- express: roles have a numeric level (lower = more authority) and an account
-- may only administer accounts at a level strictly below its own. That single
-- rule is what stops any holder of `user.manage` from promoting themselves.
--
-- Every policy below calls app.has_permission(), so adding a role in the admin
-- UI changes behaviour everywhere with no migration and no deploy.
-- ===========================================================================

create extension if not exists "uuid-ossp";

-- Helper functions live in their own schema, not exposed through PostgREST, so
-- they can never be called directly by a browser client.
create schema if not exists app;
revoke all on schema app from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared: keep updated_at honest without trusting the client to send it.
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per staff account, mirroring auth.users
-- ---------------------------------------------------------------------------
create type public.account_status as enum ('invited', 'active', 'suspended');

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  avatar_url    text,
  phone         text,
  status        public.account_status not null default 'invited',
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Staff accounts. A row exists for every auth user; status must be ''active'' for any permission to apply.';

create index profiles_status_idx on public.profiles (status);

create trigger profiles_touch
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Create the profile automatically whenever Supabase Auth creates a user, so
-- an invited account is never left without one.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, status)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    case when new.email_confirmed_at is null then 'invited' else 'active' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- roles / permissions / the joins between them
-- ---------------------------------------------------------------------------
create table public.roles (
  id          uuid primary key default uuid_generate_v4(),
  key         text not null unique check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text not null,
  description text,
  -- Lower number = more authority. Used for "who may administer whom".
  level       integer not null check (level between 1 and 999),
  -- System roles cannot be deleted or have their level changed, so the site
  -- can never be locked out by removing the last way back in.
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.roles.level is
  'Authority rank, lower is higher. An account may only manage accounts and roles at a level strictly greater than its own best level.';

create trigger roles_touch
  before update on public.roles
  for each row execute function app.touch_updated_at();

create table public.permissions (
  key         text primary key,
  label       text not null,
  "group"     text not null,
  description text
);

comment on table public.permissions is
  'Canonical action list. Mirrors src/lib/auth/permissions.ts — regenerate with `npm run db:permissions`.';

create table public.role_permissions (
  role_id        uuid not null references public.roles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.user_roles (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete cascade,
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index user_roles_user_idx on public.user_roles (user_id);

create type public.permission_effect as enum ('grant', 'deny');

create table public.user_permissions (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  effect         public.permission_effect not null,
  -- Why this person is an exception. Required, because an unexplained override
  -- is the kind of thing nobody dares remove three years later.
  reason         text not null,
  granted_by     uuid references public.profiles (id) on delete set null,
  granted_at     timestamptz not null default now(),
  primary key (user_id, permission_key)
);

comment on table public.user_permissions is
  'Per-person exceptions layered over role permissions. A ''deny'' row beats every role the user holds.';

-- ---------------------------------------------------------------------------
-- The authorisation functions every policy in the system is built on
-- ---------------------------------------------------------------------------

-- Best (lowest) role level held by a user. 999 means "no role at all".
create or replace function app.user_level(p_user uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(min(r.level), 999)
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = p_user;
$$;

-- The single authorisation question the whole application asks.
create or replace function app.has_permission(p_key text, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user is not null
    and exists (
      select 1 from public.profiles p
      where p.id = p_user and p.status = 'active'
    )
    and coalesce(
      -- Layer 2: a per-user override short-circuits the roles entirely.
      (
        select up.effect = 'grant'
        from public.user_permissions up
        where up.user_id = p_user and up.permission_key = p_key
      ),
      -- Layer 3: otherwise, anything one of their roles carries.
      exists (
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        where ur.user_id = p_user and rp.permission_key = p_key
      )
    );
$$;

comment on function app.has_permission(text, uuid) is
  'True when the user may perform the action. Checks account status, then per-user overrides (deny wins), then role permissions.';

-- May the current user administer this other account? Requires user.manage AND
-- strict authority over the target. Self-management is excluded so that nobody
-- can edit their own roles, even an owner.
create or replace function app.can_manage_user(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_target is not null
    and p_target <> auth.uid()
    and app.has_permission('user.manage')
    and app.user_level() < app.user_level(p_target);
$$;

-- May the current user assign or remove this role? Same rule, applied to the
-- role itself: you can never hand out authority you do not outrank.
create or replace function app.can_assign_role(p_role uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.roles r
    where r.id = p_role and r.level > app.user_level()
  );
$$;

grant usage on schema app to authenticated;
grant execute on function app.has_permission(text, uuid) to authenticated;
grant execute on function app.user_level(uuid) to authenticated;
grant execute on function app.can_manage_user(uuid) to authenticated;
grant execute on function app.can_assign_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log — append only, readable by administrators, editable by no one
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigserial primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_email text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  summary     text,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

create or replace function app.record_audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_summary text,
  p_details jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, summary, details)
  select auth.uid(), p.email, p_action, p_entity, p_entity_id, p_summary, p_details
  from public.profiles p where p.id = auth.uid();
end;
$$;

grant execute on function app.record_audit(text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.roles             enable row level security;
alter table public.permissions       enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.user_roles        enable row level security;
alter table public.user_permissions  enable row level security;
alter table public.audit_log         enable row level security;

-- profiles: everyone sees their own; user.read sees all; managers may edit
-- accounts below them, and anyone may update their own name and avatar.
create policy "own profile readable"
  on public.profiles for select
  using (id = auth.uid());

create policy "staff readable with permission"
  on public.profiles for select
  using (app.has_permission('user.read'));

create policy "own profile editable"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "manage subordinate profiles"
  on public.profiles for update
  using (app.can_manage_user(id))
  with check (app.can_manage_user(id));

-- roles & permissions: any signed-in staff member may READ the catalogue (the
-- admin UI needs it to render), but only role.manage may change it.
create policy "roles readable by staff"
  on public.roles for select
  using (app.has_permission('admin.access'));

create policy "roles writable with permission"
  on public.roles for all
  using (app.has_permission('role.manage') and not is_system)
  with check (app.has_permission('role.manage') and level > app.user_level());

create policy "permissions readable by staff"
  on public.permissions for select
  using (app.has_permission('admin.access'));

create policy "role permissions readable by staff"
  on public.role_permissions for select
  using (app.has_permission('admin.access'));

-- A role's permissions may only be changed by someone who outranks that role.
-- Without the level check, an administrator could grant `role.manage` to a
-- role they hold and become an owner in two clicks.
create policy "role permissions writable with permission"
  on public.role_permissions for all
  using (
    app.has_permission('role.manage')
    and exists (select 1 from public.roles r where r.id = role_id and r.level > app.user_level())
  )
  with check (
    app.has_permission('role.manage')
    and exists (select 1 from public.roles r where r.id = role_id and r.level > app.user_level())
  );

-- user_roles: visible to the account itself and to anyone with user.read;
-- writable only over subordinates, and only for roles you outrank.
create policy "own roles readable"
  on public.user_roles for select
  using (user_id = auth.uid());

create policy "user roles readable with permission"
  on public.user_roles for select
  using (app.has_permission('user.read'));

create policy "user roles writable over subordinates"
  on public.user_roles for all
  using (app.can_manage_user(user_id) and app.can_assign_role(role_id))
  with check (app.can_manage_user(user_id) and app.can_assign_role(role_id));

-- user_permissions: same shape. An override is an administrative act on
-- another person, so the subordinate rule applies unchanged.
create policy "own overrides readable"
  on public.user_permissions for select
  using (user_id = auth.uid());

create policy "overrides readable with permission"
  on public.user_permissions for select
  using (app.has_permission('user.read'));

create policy "overrides writable over subordinates"
  on public.user_permissions for all
  using (app.can_manage_user(user_id))
  with check (app.can_manage_user(user_id));

-- audit_log: readable with audit.read, and writable by nobody. Rows arrive
-- only through app.record_audit(), which is security definer.
create policy "audit readable with permission"
  on public.audit_log for select
  using (app.has_permission('audit.read'));

-- ---------------------------------------------------------------------------
-- Guard rail: the academy must never be able to lock itself out.
-- ---------------------------------------------------------------------------
create or replace function app.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_role uuid;
  remaining  integer;
begin
  select id into owner_role from public.roles where key = 'owner';
  if owner_role is null or old.role_id <> owner_role then
    return old;
  end if;

  select count(*) into remaining
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.role_id = owner_role
    and ur.user_id <> old.user_id
    and p.status = 'active';

  if remaining = 0 then
    raise exception 'Cannot remove the last active owner. Promote another account to Owner first.'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

create trigger protect_last_owner
  before delete on public.user_roles
  for each row execute function app.protect_last_owner();
