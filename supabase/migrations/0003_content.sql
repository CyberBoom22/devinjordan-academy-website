-- =============================================================================
-- Content tables — what the staff dashboard edits and the public site reads.
--
-- Read access for the anonymous role is deliberately narrow: published content
-- only. Drafts are invisible to anon even though the site is public, so an
-- unfinished legislation entry cannot leak by guessing a URL.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Site settings — a singleton row
-- ---------------------------------------------------------------------------
create table if not exists public.site_settings (
    id              boolean primary key default true check (id),  -- exactly one row
    name            text not null,
    short_name      text not null,
    tagline         text not null,
    description     text not null,
    address_street  text not null,
    address_city    text not null,
    address_state   text not null,
    address_zip     text not null,
    copyright_year  integer not null,
    updated_at      timestamptz not null default now(),
    updated_by      uuid references public.profiles(id) on delete set null
);

create table if not exists public.contact_methods (
    id         uuid primary key default gen_random_uuid(),
    label      text not null,
    detail     text not null,
    icon       text not null,
    href       text,
    sort_order integer not null default 0,
    is_visible boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Courses and tuition
-- ---------------------------------------------------------------------------
create table if not exists public.course_categories (
    id         text primary key,
    title      text not null,
    icon       text not null,
    sort_order integer not null default 0
);

create table if not exists public.courses (
    id          text primary key,
    category_id text not null references public.course_categories(id) on delete cascade,
    name        text not null,
    blurb       text not null,
    -- Display text, not a number: the academy quotes "$100.00+" for firearms
    -- qualification and no numeric type represents that honestly.
    price       text not null,
    cta         text not null default 'ENROLL NOW',
    sort_order  integer not null default 0,
    is_visible  boolean not null default true,
    updated_at  timestamptz not null default now(),
    updated_by  uuid references public.profiles(id) on delete set null
);

create index if not exists courses_category_idx on public.courses(category_id);

-- ---------------------------------------------------------------------------
-- News & legislation
-- ---------------------------------------------------------------------------
create table if not exists public.news_jurisdictions (
    code       text primary key,
    name       text not null,
    is_quick   boolean not null default false,  -- shown as a pill, not just in the dropdown
    sort_order integer not null default 0
);

do $$ begin
    create type public.news_status as enum ('Pending', 'Enacted', 'Closed', 'Decided');
exception when duplicate_object then null;
end $$;

do $$ begin
    create type public.news_category as enum ('legislation', 'cases');
exception when duplicate_object then null;
end $$;

create table if not exists public.news_entries (
    id              uuid primary key default gen_random_uuid(),
    jurisdiction    text not null references public.news_jurisdictions(code) on delete cascade,
    category        public.news_category not null,
    title           text not null,
    date_label      text not null default '',
    status          public.news_status,
    summary         text not null,
    is_published    boolean not null default false,
    published_at    timestamptz,
    created_at      timestamptz not null default now(),
    created_by      uuid references public.profiles(id) on delete set null,
    updated_at      timestamptz not null default now(),
    updated_by      uuid references public.profiles(id) on delete set null
);

create index if not exists news_entries_lookup_idx
    on public.news_entries(jurisdiction, category, is_published);

create table if not exists public.news_sources (
    id       uuid primary key default gen_random_uuid(),
    entry_id uuid not null references public.news_entries(id) on delete cascade,
    label    text not null,
    url      text not null,
    sort_order integer not null default 0,
    -- Defence in depth: the renderer also validates, but a javascript: URL
    -- should never reach the database in the first place.
    constraint news_sources_url_is_http check (url ~* '^https?://')
);

create index if not exists news_sources_entry_idx on public.news_sources(entry_id);

-- The feed-wide "is the automatic tracker connected yet" switch.
create table if not exists public.news_feed_state (
    id         boolean primary key default true check (id),
    is_ready   boolean not null default false,
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ORI directory
-- ---------------------------------------------------------------------------
create table if not exists public.ori_counties (
    name       text primary key,
    fips       text not null check (fips ~ '^[0-9]{3}$'),
    sort_order integer not null default 0
);

create table if not exists public.ori_agencies (
    id          uuid primary key default gen_random_uuid(),
    county_name text not null references public.ori_counties(name) on delete cascade,
    name        text not null,
    -- The five characters after the NJ prefix. ORI7 is 'NJ' || code;
    -- ORI9 is ORI7 || '00'. The length check is not cosmetic: a dropped
    -- character produces a code that silently routes paperwork to nowhere.
    code        text not null check (length(code) = 5),
    is_active   boolean not null default true,
    updated_at  timestamptz not null default now(),
    updated_by  uuid references public.profiles(id) on delete set null,
    unique (county_name, code)
);

create index if not exists ori_agencies_county_idx on public.ori_agencies(county_name);
create index if not exists ori_agencies_search_idx on public.ori_agencies(upper(name));

-- ---------------------------------------------------------------------------
-- Media library
-- ---------------------------------------------------------------------------
create table if not exists public.media_assets (
    id           uuid primary key default gen_random_uuid(),
    storage_path text not null unique,
    alt_text     text not null default '',
    width        integer,
    height       integer,
    byte_size    integer,
    mime_type    text,
    uploaded_by  uuid references public.profiles(id) on delete set null,
    uploaded_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Touch updated_at / updated_by on write
-- ---------------------------------------------------------------------------
create or replace function public.touch_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    new.updated_at := now();
    begin
        new.updated_by := auth.uid();
    exception when undefined_column then
        null;
    end;
    return new;
end;
$$;

do $$
declare t text;
begin
    foreach t in array array['site_settings','courses','news_entries','ori_agencies']
    loop
        execute format('drop trigger if exists touch_%1$s on public.%1$s;', t);
        execute format(
            'create trigger touch_%1$s before update on public.%1$s
             for each row execute function public.touch_row();', t);
    end loop;
end $$;

-- Audit every content change, same as the access tables.
do $$
declare t text;
begin
    foreach t in array array['site_settings','contact_methods','courses','news_entries','ori_agencies']
    loop
        execute format('drop trigger if exists audit_%1$s on public.%1$s;', t);
        execute format(
            'create trigger audit_%1$s after insert or update or delete on public.%1$s
             for each row execute function public.write_audit();', t);
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.site_settings      enable row level security;
alter table public.contact_methods    enable row level security;
alter table public.course_categories  enable row level security;
alter table public.courses            enable row level security;
alter table public.news_jurisdictions enable row level security;
alter table public.news_entries       enable row level security;
alter table public.news_sources       enable row level security;
alter table public.news_feed_state    enable row level security;
alter table public.ori_counties       enable row level security;
alter table public.ori_agencies       enable row level security;
alter table public.media_assets       enable row level security;

-- --- public read (anon + authenticated) ---
drop policy if exists site_settings_public_read on public.site_settings;
create policy site_settings_public_read on public.site_settings
    for select to anon, authenticated using (true);

drop policy if exists contact_methods_public_read on public.contact_methods;
create policy contact_methods_public_read on public.contact_methods
    for select to anon, authenticated using (is_visible or public.has_permission('content.site.read'));

drop policy if exists course_categories_public_read on public.course_categories;
create policy course_categories_public_read on public.course_categories
    for select to anon, authenticated using (true);

drop policy if exists courses_public_read on public.courses;
create policy courses_public_read on public.courses
    for select to anon, authenticated using (is_visible or public.has_permission('content.courses.read'));

drop policy if exists news_jurisdictions_public_read on public.news_jurisdictions;
create policy news_jurisdictions_public_read on public.news_jurisdictions
    for select to anon, authenticated using (true);

drop policy if exists news_feed_state_public_read on public.news_feed_state;
create policy news_feed_state_public_read on public.news_feed_state
    for select to anon, authenticated using (true);

-- Drafts stay invisible to the public.
drop policy if exists news_entries_public_read on public.news_entries;
create policy news_entries_public_read on public.news_entries
    for select to anon, authenticated
    using (is_published or public.has_permission('content.news.read'));

drop policy if exists news_sources_public_read on public.news_sources;
create policy news_sources_public_read on public.news_sources
    for select to anon, authenticated
    using (
        exists (
            select 1 from public.news_entries e
            where e.id = entry_id
              and (e.is_published or public.has_permission('content.news.read'))
        )
    );

drop policy if exists ori_counties_public_read on public.ori_counties;
create policy ori_counties_public_read on public.ori_counties
    for select to anon, authenticated using (true);

drop policy if exists ori_agencies_public_read on public.ori_agencies;
create policy ori_agencies_public_read on public.ori_agencies
    for select to anon, authenticated
    using (is_active or public.has_permission('content.ori.read'));

drop policy if exists media_assets_public_read on public.media_assets;
create policy media_assets_public_read on public.media_assets
    for select to anon, authenticated using (true);

-- --- writes, gated on the matching permission ---
drop policy if exists site_settings_write on public.site_settings;
create policy site_settings_write on public.site_settings
    for all to authenticated
    using (public.has_permission('content.site.write'))
    with check (public.has_permission('content.site.write'));

drop policy if exists contact_methods_write on public.contact_methods;
create policy contact_methods_write on public.contact_methods
    for all to authenticated
    using (public.has_permission('content.site.write'))
    with check (public.has_permission('content.site.write'));

drop policy if exists course_categories_write on public.course_categories;
create policy course_categories_write on public.course_categories
    for all to authenticated
    using (public.has_permission('content.courses.write'))
    with check (public.has_permission('content.courses.write'));

drop policy if exists courses_write on public.courses;
create policy courses_write on public.courses
    for all to authenticated
    using (public.has_permission('content.courses.write'))
    with check (public.has_permission('content.courses.write'));

drop policy if exists news_jurisdictions_write on public.news_jurisdictions;
create policy news_jurisdictions_write on public.news_jurisdictions
    for all to authenticated
    using (public.has_permission('content.news.write'))
    with check (public.has_permission('content.news.write'));

-- Writing an entry and publishing it are separate permissions, so an
-- instructor can draft without being able to put it in front of the public.
drop policy if exists news_entries_insert on public.news_entries;
create policy news_entries_insert on public.news_entries
    for insert to authenticated
    with check (
        public.has_permission('content.news.write')
        and (not is_published or public.has_permission('content.news.publish'))
    );

drop policy if exists news_entries_update on public.news_entries;
create policy news_entries_update on public.news_entries
    for update to authenticated
    using (public.has_permission('content.news.write'))
    with check (
        public.has_permission('content.news.write')
        and (not is_published or public.has_permission('content.news.publish'))
    );

drop policy if exists news_entries_delete on public.news_entries;
create policy news_entries_delete on public.news_entries
    for delete to authenticated
    using (public.has_permission('content.news.write'));

drop policy if exists news_sources_write on public.news_sources;
create policy news_sources_write on public.news_sources
    for all to authenticated
    using (public.has_permission('content.news.write'))
    with check (public.has_permission('content.news.write'));

drop policy if exists news_feed_state_write on public.news_feed_state;
create policy news_feed_state_write on public.news_feed_state
    for all to authenticated
    using (public.has_permission('content.news.publish'))
    with check (public.has_permission('content.news.publish'));

drop policy if exists ori_counties_write on public.ori_counties;
create policy ori_counties_write on public.ori_counties
    for all to authenticated
    using (public.has_permission('content.ori.write'))
    with check (public.has_permission('content.ori.write'));

drop policy if exists ori_agencies_write on public.ori_agencies;
create policy ori_agencies_write on public.ori_agencies
    for all to authenticated
    using (public.has_permission('content.ori.write'))
    with check (public.has_permission('content.ori.write'));

drop policy if exists media_assets_insert on public.media_assets;
create policy media_assets_insert on public.media_assets
    for insert to authenticated with check (public.has_permission('media.upload'));

drop policy if exists media_assets_delete on public.media_assets;
create policy media_assets_delete on public.media_assets
    for delete to authenticated using (public.has_permission('media.delete'));

commit;
