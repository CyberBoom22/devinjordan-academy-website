-- =============================================================================
-- Roles, permissions and profiles.
--
-- Design note: permissions are enforced HERE, in Postgres, via Row Level
-- Security — not in the browser. Anything checked only in client-side
-- JavaScript can be bypassed by editing the page, so the rules live with the
-- data. The dashboard hides controls a user cannot use, but that is a courtesy;
-- the database is what actually says no.
--
-- Effective permission for a user =
--        role defaults
--      + individual grants
--      - individual revokes            (a revoke always wins)
--   unless the user holds a superuser role, which bypasses the whole thing.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The catalogue of things that can be permitted. Seeded from
-- src/lib/permissions.ts; never edited by application users.
create table if not exists public.permissions (
    key         text primary key,
    category    text not null,
    label       text not null,
    description text not null,
    sort_order  integer not null default 0
);

create table if not exists public.roles (
    id           text primary key,
    label        text not null,
    description  text not null,
    -- A superuser role holds every permission implicitly and cannot be
    -- locked out of its own system.
    is_superuser boolean not null default false,
    -- System roles ship with the app and cannot be deleted.
    is_system    boolean not null default false,
    sort_order   integer not null default 0
);

create table if not exists public.role_permissions (
    role_id        text not null references public.roles(id) on delete cascade,
    permission_key text not null references public.permissions(key) on delete cascade,
    primary key (role_id, permission_key)
);

-- One row per auth.users row.
create table if not exists public.profiles (
    id         uuid primary key references auth.users(id) on delete cascade,
    email      text,
    full_name  text,
    role_id    text not null references public.roles(id),
    is_active  boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists profiles_role_id_idx on public.profiles(role_id);

-- The granular layer: per-person overrides on top of the role.
do $$ begin
    create type public.permission_effect as enum ('grant', 'revoke');
exception when duplicate_object then null;
end $$;

create table if not exists public.user_permissions (
    user_id        uuid not null references public.profiles(id) on delete cascade,
    permission_key text not null references public.permissions(key) on delete cascade,
    effect         public.permission_effect not null,
    note           text,
    granted_by     uuid references public.profiles(id) on delete set null,
    granted_at     timestamptz not null default now(),
    primary key (user_id, permission_key)
);

create index if not exists user_permissions_user_idx on public.user_permissions(user_id);

-- Append-only record of who changed what.
-- Deliberately NO foreign key on actor_id. An audit row is written by an
-- AFTER trigger; when the row being audited IS a profile deletion, a foreign
-- key would fire against the row that has just gone and abort the delete —
-- meaning the audit log could veto the very operation it exists to record.
-- The email is snapshotted so the entry stays readable after an account goes.
create table if not exists public.audit_log (
    id          bigserial primary key,
    actor_id    uuid,
    actor_email text,
    action     text not null,
    entity     text not null,
    entity_id  text,
    detail     jsonb,
    created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log(created_at desc);

-- ---------------------------------------------------------------------------
-- The permission check
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so that a user can be asked "may you?" without being able
-- to read the permission tables directly. search_path is pinned so that a
-- caller cannot shadow `public` with their own schema.
create or replace function public.has_permission(
    p_key  text,
    p_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select
        -- An inactive or unknown account holds nothing at all.
        exists (select 1 from profiles p where p.id = p_user and p.is_active)
        and (
            -- Superuser bypass, deliberately checked before any revoke, so the
            -- owner cannot be locked out of their own system.
            exists (
                select 1
                from profiles p
                join roles r on r.id = p.role_id
                where p.id = p_user and p.is_active and r.is_superuser
            )
            or (
                -- An explicit revoke beats everything below it.
                not exists (
                    select 1 from user_permissions up
                    where up.user_id = p_user
                      and up.permission_key = p_key
                      and up.effect = 'revoke'
                )
                and (
                    exists (
                        select 1 from user_permissions up
                        where up.user_id = p_user
                          and up.permission_key = p_key
                          and up.effect = 'grant'
                    )
                    or exists (
                        select 1
                        from profiles p
                        join role_permissions rp on rp.role_id = p.role_id
                        where p.id = p_user
                          and p.is_active
                          and rp.permission_key = p_key
                    )
                )
            )
        );
$$;

comment on function public.has_permission is
    'True if the user holds the permission. Revokes beat grants; superuser roles bypass both.';

-- Every permission a user effectively holds. Powers the dashboard UI.
create or replace function public.my_permissions()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.key from permissions p where public.has_permission(p.key);
$$;

create or replace function public.is_superuser(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from profiles p join roles r on r.id = p.role_id
        where p.id = p_user and p.is_active and r.is_superuser
    );
$$;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- There must always be at least one active owner, or nobody can ever grant
-- anything again. Blocks the last one being demoted, deactivated or deleted.
-- True only inside bootstrap_owner(), which sets a transaction-local flag and
-- refuses to run once an active owner exists. Nothing else sets it.
create or replace function public.is_bootstrapping()
returns boolean
language sql
stable
as $$
    select coalesce(current_setting('app.bootstrap', true), 'off') = 'on';
$$;

create or replace function public.guard_last_superuser()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    remaining integer;
    was_super boolean;
begin
    if public.is_bootstrapping() then
        return coalesce(new, old);
    end if;

    select r.is_superuser into was_super from roles r where r.id = old.role_id;
    if not coalesce(was_super, false) or not old.is_active then
        return coalesce(new, old);
    end if;

    -- Still a superuser after this change? Then nothing to protect against.
    if tg_op = 'UPDATE' then
        if new.is_active and exists (
            select 1 from roles r where r.id = new.role_id and r.is_superuser
        ) then
            return new;
        end if;
    end if;

    select count(*) into remaining
    from profiles p join roles r on r.id = p.role_id
    where r.is_superuser and p.is_active and p.id <> old.id;

    if remaining = 0 then
        raise exception
            'Refusing to remove the last active owner — the site would have nobody who can manage access.'
            using errcode = 'raise_exception';
    end if;

    return coalesce(new, old);
end;
$$;

drop trigger if exists guard_last_superuser_update on public.profiles;
create trigger guard_last_superuser_update
    before update on public.profiles
    for each row execute function public.guard_last_superuser();

drop trigger if exists guard_last_superuser_delete on public.profiles;
create trigger guard_last_superuser_delete
    before delete on public.profiles
    for each row execute function public.guard_last_superuser();

-- Nobody promotes themselves. Column-level rules are clearer as a trigger than
-- as an RLS policy, because RLS is row-level and this is about one column.
create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    new.updated_at := now();

    if public.is_bootstrapping() then
        return new;
    end if;

    if new.role_id is distinct from old.role_id then
        if new.id = auth.uid() and not public.is_superuser() then
            raise exception 'You cannot change your own role.'
                using errcode = 'insufficient_privilege';
        end if;
        if not public.has_permission('roles.manage') then
            raise exception 'You do not have permission to assign roles.'
                using errcode = 'insufficient_privilege';
        end if;
    end if;

    if new.is_active is distinct from old.is_active
       and not public.has_permission('users.deactivate') then
        raise exception 'You do not have permission to activate or deactivate accounts.'
            using errcode = 'insufficient_privilege';
    end if;

    return new;
end;
$$;

drop trigger if exists guard_profile_changes on public.profiles;
create trigger guard_profile_changes
    before update on public.profiles
    for each row execute function public.guard_profile_changes();

-- You cannot hand out what you do not hold. Without this, anyone with
-- permissions.manage could grant themselves everything, which makes every
-- other permission decorative.
create or replace function public.guard_permission_grant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.has_permission('permissions.manage') then
        raise exception 'You do not have permission to manage individual permissions.'
            using errcode = 'insufficient_privilege';
    end if;

    if tg_op in ('INSERT', 'UPDATE')
       and new.effect = 'grant'
       and not public.has_permission(new.permission_key) then
        raise exception
            'You cannot grant "%" because you do not hold it yourself.', new.permission_key
            using errcode = 'insufficient_privilege';
    end if;

    if tg_op in ('INSERT', 'UPDATE') then
        new.granted_by := auth.uid();
        new.granted_at := now();
        return new;
    end if;
    return old;
end;
$$;

drop trigger if exists guard_permission_grant on public.user_permissions;
create trigger guard_permission_grant
    before insert or update or delete on public.user_permissions
    for each row execute function public.guard_permission_grant();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create or replace function public.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into audit_log (actor_id, actor_email, action, entity, entity_id, detail)
    values (
        auth.uid(),
        (select email from profiles where id = auth.uid()),
        lower(tg_op),
        tg_table_name,
        coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'),
                 (to_jsonb(new) ->> 'user_id'), (to_jsonb(old) ->> 'user_id')),
        case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
    );
    return coalesce(new, old);
end;
$$;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles
    after insert or update or delete on public.profiles
    for each row execute function public.write_audit();

drop trigger if exists audit_user_permissions on public.user_permissions;
create trigger audit_user_permissions
    after insert or update or delete on public.user_permissions
    for each row execute function public.write_audit();

drop trigger if exists audit_role_permissions on public.role_permissions;
create trigger audit_role_permissions
    after insert or update or delete on public.role_permissions
    for each row execute function public.write_audit();

-- ---------------------------------------------------------------------------
-- New sign-ups get a profile automatically, with the least-privileged role.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into public.profiles (id, email, full_name, role_id, is_active)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', ''),
        -- Deliberately the weakest role, and inactive: an account has to be
        -- switched on by someone who already holds users.deactivate. Sign-up
        -- alone must never grant access.
        'staff',
        false
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Bootstrap: creating the very first owner
--
-- Assigning a role requires roles.manage, which only an owner holds — so on a
-- fresh database nobody could ever become one. This is the way out, and it is
-- deliberately narrow:
--   * it refuses outright once any active owner exists, so the window is
--     exactly the empty-system state and closes permanently after first use;
--   * EXECUTE is revoked from anon and authenticated, so it is reachable only
--     with the service key or from the SQL editor — never from a browser.
--
-- Usage, once the person has signed up and has an auth.users row:
--   select public.bootstrap_owner('che@devinjordansecuritytrainingacademy.com');
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_owner(p_email text)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_profile public.profiles;
begin
    if exists (
        select 1 from profiles p join roles r on r.id = p.role_id
        where r.is_superuser and p.is_active
    ) then
        raise exception
            'An active owner already exists. Assign roles from the dashboard instead.'
            using errcode = 'insufficient_privilege';
    end if;

    select * into v_profile from profiles where lower(email) = lower(p_email);
    if v_profile.id is null then
        raise exception 'No account found for %. They must sign up first.', p_email
            using errcode = 'no_data_found';
    end if;

    perform set_config('app.bootstrap', 'on', true);   -- transaction-local
    update profiles set role_id = 'owner', is_active = true where id = v_profile.id
        returning * into v_profile;
    perform set_config('app.bootstrap', 'off', true);

    insert into audit_log (actor_id, actor_email, action, entity, entity_id, detail)
    values (v_profile.id, v_profile.email, 'bootstrap', 'profiles', v_profile.id::text,
            jsonb_build_object('note', 'first owner created via bootstrap_owner()'));

    return v_profile;
end;
$$;

revoke all on function public.bootstrap_owner(text) from public;
revoke all on function public.bootstrap_owner(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.permissions      enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles         enable row level security;
alter table public.user_permissions enable row level security;
alter table public.audit_log        enable row level security;

-- The catalogue is readable by any signed-in user; the dashboard needs it to
-- render. It is never writable from the application — only by migrations.
drop policy if exists permissions_read on public.permissions;
create policy permissions_read on public.permissions
    for select to authenticated using (true);

drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles
    for select to authenticated using (true);

drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions
    for select to authenticated using (true);

drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions
    for all to authenticated
    using (public.has_permission('permissions.manage'))
    with check (public.has_permission('permissions.manage'));

-- You can always see yourself. Seeing everyone else needs users.read.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
    for select to authenticated
    using (id = auth.uid() or public.has_permission('users.read'));

-- Row-level write access; the column-level rules are in guard_profile_changes.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
    for update to authenticated
    using (id = auth.uid() or public.has_permission('users.update'))
    with check (id = auth.uid() or public.has_permission('users.update'));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
    for insert to authenticated
    with check (public.has_permission('users.invite'));

drop policy if exists user_permissions_read on public.user_permissions;
create policy user_permissions_read on public.user_permissions
    for select to authenticated
    using (user_id = auth.uid() or public.has_permission('users.read'));

drop policy if exists user_permissions_write on public.user_permissions;
create policy user_permissions_write on public.user_permissions
    for all to authenticated
    using (public.has_permission('permissions.manage'))
    with check (public.has_permission('permissions.manage'));

-- The audit log is append-only from the application's point of view: readable
-- with audit.read, and never updatable or deletable by anyone. Rows are written
-- by SECURITY DEFINER triggers, which bypass RLS.
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
    for select to authenticated using (public.has_permission('audit.read'));

commit;
