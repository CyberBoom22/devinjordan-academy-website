-- ===========================================================================
-- 0002 — Editable content
--
-- Everything the client can change lives here. The public site reads only
-- rows with status = 'published'; the admin area sees drafts too. That single
-- distinction is expressed once per table in RLS, so a forgotten filter in a
-- template can never leak an unpublished draft to the public.
--
-- Ownership of the read path: the anon key is used by the public site and is
-- covered by these policies, so "what the world can see" is decided by the
-- database rather than by application code.
-- ===========================================================================

create type public.content_status as enum ('draft', 'published', 'archived');

-- Small helper so every content table's read policy reads the same way.
create or replace function app.can_see(p_status public.content_status, p_read_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_status = 'published' or app.has_permission(p_read_permission);
$$;

grant execute on function app.can_see(public.content_status, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- site_settings — contact details and other values that appear site-wide
-- ---------------------------------------------------------------------------
create table public.site_settings (
  key         text primary key,
  value       text,
  label       text not null,
  help        text,
  "group"     text not null default 'General',
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

comment on table public.site_settings is
  'Flat key/value settings rendered as a form in the admin area. Adding a row adds a field — no code change.';

create trigger site_settings_touch
  before update on public.site_settings
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- pages and their copy blocks
-- ---------------------------------------------------------------------------
create table public.pages (
  slug             text primary key check (slug ~ '^[a-z0-9-]+$'),
  title            text not null,
  meta_description text,
  eyebrow          text,
  heading          text,
  heading_accent   text,
  intro            text,
  status           public.content_status not null default 'draft',
  published_at     timestamptz,
  sort_order       integer not null default 0,
  show_in_nav      boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null
);

create trigger pages_touch
  before update on public.pages
  for each row execute function app.touch_updated_at();

create table public.content_blocks (
  id          uuid primary key default uuid_generate_v4(),
  page_slug   text not null references public.pages (slug) on delete cascade,
  key         text not null,
  label       text not null,
  value       text,
  kind        text not null default 'text' check (kind in ('text', 'multiline', 'html')),
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  unique (page_slug, key)
);

comment on table public.content_blocks is
  'Named fragments of copy on a page (hero headline, teaser paragraphs, the creed). Referenced by key from templates.';

create trigger content_blocks_touch
  before update on public.content_blocks
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Courses & tuition
-- ---------------------------------------------------------------------------
create table public.course_categories (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  icon        text,
  sort_order  integer not null default 0,
  status      public.content_status not null default 'published',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger course_categories_touch
  before update on public.course_categories
  for each row execute function app.touch_updated_at();

create table public.courses (
  id           uuid primary key default uuid_generate_v4(),
  category_id  uuid references public.course_categories (id) on delete set null,
  name         text not null,
  description  text,
  -- Stored in cents so arithmetic is exact; price_note carries the "+" in
  -- "$100.00+" and anything else the display needs.
  price_cents  integer check (price_cents >= 0),
  price_note   text,
  cta_label    text not null default 'Enroll Now',
  sort_order   integer not null default 0,
  status       public.content_status not null default 'draft',
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null
);

create index courses_category_idx on public.courses (category_id, sort_order);

create trigger courses_touch
  before update on public.courses
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Instructors
-- ---------------------------------------------------------------------------
create table public.instructors (
  id          uuid primary key default uuid_generate_v4(),
  -- When set, the holder of this account may edit this profile via the
  -- instructor.write.self permission without being able to touch any other.
  user_id     uuid unique references public.profiles (id) on delete set null,
  name        text not null,
  role_title  text,
  badge       text,
  photo_url   text,
  photo_alt   text,
  bio         text,
  sort_order  integer not null default 0,
  status      public.content_status not null default 'draft',
  published_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create trigger instructors_touch
  before update on public.instructors
  for each row execute function app.touch_updated_at();

create table public.instructor_records (
  id            uuid primary key default uuid_generate_v4(),
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  label         text not null,
  value         text not null,
  sort_order    integer not null default 0
);

comment on table public.instructor_records is
  'The label/value rows of the leadership dossier — military service, law enforcement, specialties.';

create index instructor_records_parent_idx on public.instructor_records (instructor_id, sort_order);

-- ---------------------------------------------------------------------------
-- Reusable page furniture: stat strips and pillar cards
-- ---------------------------------------------------------------------------
create table public.stats (
  id          uuid primary key default uuid_generate_v4(),
  page_slug   text not null references public.pages (slug) on delete cascade,
  value       text not null,
  label       text not null,
  sort_order  integer not null default 0,
  status      public.content_status not null default 'published'
);

create table public.pillars (
  id          uuid primary key default uuid_generate_v4(),
  page_slug   text not null references public.pages (slug) on delete cascade,
  icon        text,
  title       text not null,
  body        text not null,
  sort_order  integer not null default 0,
  status      public.content_status not null default 'published'
);

-- ---------------------------------------------------------------------------
-- News & legislation tracker
-- ---------------------------------------------------------------------------
create table public.jurisdictions (
  code          text primary key check (code ~ '^[A-Z]{2}$'),
  name          text not null,
  sort_order    integer not null default 0,
  is_quick_pick boolean not null default false
);

comment on column public.jurisdictions.is_quick_pick is
  'Shown as a pill button above the dropdown — the academy''s own jurisdictions.';

create type public.news_category as enum ('legislation', 'cases');

create table public.news_items (
  id                uuid primary key default uuid_generate_v4(),
  jurisdiction_code text not null references public.jurisdictions (code) on delete cascade,
  category          public.news_category not null,
  title             text not null,
  date_label        text,
  -- Free text rather than an enum: the badge colours key off a known set, but
  -- legislatures invent new stages and the client must not need a developer.
  status_label      text check (status_label is null or length(status_label) <= 40),
  summary           text not null,
  sort_order        integer not null default 0,
  status            public.content_status not null default 'draft',
  published_at      timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null
);

create index news_items_lookup_idx
  on public.news_items (jurisdiction_code, category, status, sort_order);

create trigger news_items_touch
  before update on public.news_items
  for each row execute function app.touch_updated_at();

create table public.news_sources (
  id            uuid primary key default uuid_generate_v4(),
  news_item_id  uuid not null references public.news_items (id) on delete cascade,
  label         text not null,
  url           text not null check (url ~* '^https?://'),
  sort_order    integer not null default 0
);

comment on column public.news_sources.url is
  'Constrained to http(s) at the database level so a javascript: URL can never reach a link href, whatever the admin form does.';

create index news_sources_parent_idx on public.news_sources (news_item_id, sort_order);

-- ---------------------------------------------------------------------------
-- ORI directory
-- ---------------------------------------------------------------------------
create table public.ori_counties (
  fips        text primary key check (fips ~ '^[0-9]{3}$'),
  name        text not null unique,
  sort_order  integer not null default 0
);

create table public.ori_agencies (
  id          uuid primary key default uuid_generate_v4(),
  county_fips text not null references public.ori_counties (fips) on delete cascade,
  name        text not null,
  -- The five characters after the NJ prefix. ORI7 is 'NJ' || core and ORI9 is
  -- that same value with '00' appended — one agency, two field lengths.
  ori_core    text not null check (ori_core ~ '^[A-Z0-9]{5}$'),
  status      public.content_status not null default 'published',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  unique (county_fips, ori_core)
);

create index ori_agencies_county_idx on public.ori_agencies (county_fips, name);

create trigger ori_agencies_touch
  before update on public.ori_agencies
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Course enquiries from the public contact form
-- ---------------------------------------------------------------------------
create type public.enquiry_status as enum ('new', 'contacted', 'enrolled', 'closed', 'spam');

create table public.enquiries (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  email       text,
  phone       text,
  course_id   uuid references public.courses (id) on delete set null,
  message     text not null,
  status      public.enquiry_status not null default 'new',
  notes       text,
  handled_by  uuid references public.profiles (id) on delete set null,
  -- Kept for abuse handling only; never displayed.
  source_ip   inet,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index enquiries_status_idx on public.enquiries (status, created_at desc);

create trigger enquiries_touch
  before update on public.enquiries
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- Row level security
-- ===========================================================================
alter table public.site_settings      enable row level security;
alter table public.pages              enable row level security;
alter table public.content_blocks     enable row level security;
alter table public.course_categories  enable row level security;
alter table public.courses            enable row level security;
alter table public.instructors        enable row level security;
alter table public.instructor_records enable row level security;
alter table public.stats              enable row level security;
alter table public.pillars            enable row level security;
alter table public.jurisdictions      enable row level security;
alter table public.news_items         enable row level security;
alter table public.news_sources       enable row level security;
alter table public.ori_counties       enable row level security;
alter table public.ori_agencies       enable row level security;
alter table public.enquiries          enable row level security;

-- Settings: the public site needs the phone number and address, so reading is
-- open. Writing is not.
create policy "settings public read"   on public.site_settings for select using (true);
create policy "settings write"         on public.site_settings for update
  using (app.has_permission('settings.write')) with check (app.has_permission('settings.write'));

-- Reference data with no draft concept.
create policy "jurisdictions read"     on public.jurisdictions for select using (true);
create policy "jurisdictions write"    on public.jurisdictions for all
  using (app.has_permission('news.write')) with check (app.has_permission('news.write'));

create policy "counties read"          on public.ori_counties for select using (true);
create policy "counties write"         on public.ori_counties for all
  using (app.has_permission('ori.write')) with check (app.has_permission('ori.write'));

-- Published-or-permitted reads.
create policy "pages read"             on public.pages for select using (app.can_see(status, 'page.read'));
create policy "courses read"           on public.courses for select using (app.can_see(status, 'course.read'));
create policy "categories read"        on public.course_categories for select using (app.can_see(status, 'course.read'));
create policy "instructors read"       on public.instructors for select using (app.can_see(status, 'instructor.read'));
create policy "news read"              on public.news_items for select using (app.can_see(status, 'news.read'));
create policy "agencies read"          on public.ori_agencies for select using (app.can_see(status, 'ori.read'));
create policy "stats read"             on public.stats for select using (app.can_see(status, 'page.read'));
create policy "pillars read"           on public.pillars for select using (app.can_see(status, 'page.read'));

-- Children inherit their parent's visibility rather than carrying a status of
-- their own, so a draft item can never leak through its sources or records.
create policy "content blocks read" on public.content_blocks for select
  using (exists (select 1 from public.pages p where p.slug = page_slug and app.can_see(p.status, 'page.read')));

create policy "news sources read" on public.news_sources for select
  using (exists (select 1 from public.news_items n where n.id = news_item_id and app.can_see(n.status, 'news.read')));

create policy "instructor records read" on public.instructor_records for select
  using (exists (select 1 from public.instructors i where i.id = instructor_id and app.can_see(i.status, 'instructor.read')));

-- Writes.
create policy "pages write"          on public.pages for all
  using (app.has_permission('page.write')) with check (app.has_permission('page.write'));
create policy "content blocks write" on public.content_blocks for all
  using (app.has_permission('page.write')) with check (app.has_permission('page.write'));
create policy "stats write"          on public.stats for all
  using (app.has_permission('page.write')) with check (app.has_permission('page.write'));
create policy "pillars write"        on public.pillars for all
  using (app.has_permission('page.write')) with check (app.has_permission('page.write'));

create policy "categories write"     on public.course_categories for all
  using (app.has_permission('course.write')) with check (app.has_permission('course.write'));
create policy "courses insert"       on public.courses for insert
  with check (app.has_permission('course.write'));
create policy "courses update"       on public.courses for update
  using (app.has_permission('course.write')) with check (app.has_permission('course.write'));
create policy "courses delete"       on public.courses for delete
  using (app.has_permission('course.delete'));

-- Instructors: the general permission edits anyone; the .self permission edits
-- only the profile linked to this account. Two policies, because RLS ORs them
-- together and that is exactly the intent.
create policy "instructors write any" on public.instructors for all
  using (app.has_permission('instructor.write')) with check (app.has_permission('instructor.write'));
create policy "instructors write own" on public.instructors for update
  using (user_id = auth.uid() and app.has_permission('instructor.write.self'))
  with check (user_id = auth.uid() and app.has_permission('instructor.write.self'));

create policy "instructor records write" on public.instructor_records for all
  using (exists (
    select 1 from public.instructors i where i.id = instructor_id
      and (app.has_permission('instructor.write')
           or (i.user_id = auth.uid() and app.has_permission('instructor.write.self')))))
  with check (exists (
    select 1 from public.instructors i where i.id = instructor_id
      and (app.has_permission('instructor.write')
           or (i.user_id = auth.uid() and app.has_permission('instructor.write.self')))));

create policy "news insert"  on public.news_items for insert with check (app.has_permission('news.write'));
create policy "news update"  on public.news_items for update
  using (app.has_permission('news.write')) with check (app.has_permission('news.write'));
create policy "news delete"  on public.news_items for delete using (app.has_permission('news.delete'));
create policy "news sources write" on public.news_sources for all
  using (app.has_permission('news.write')) with check (app.has_permission('news.write'));

create policy "agencies write" on public.ori_agencies for all
  using (app.has_permission('ori.write')) with check (app.has_permission('ori.write'));

-- Enquiries: anyone may submit one, only staff may read them. The absence of a
-- public SELECT policy is what keeps enquiries private.
create policy "enquiries public insert" on public.enquiries for insert with check (true);
create policy "enquiries read"          on public.enquiries for select
  using (app.has_permission('enquiry.read'));
create policy "enquiries update"        on public.enquiries for update
  using (app.has_permission('enquiry.write')) with check (app.has_permission('enquiry.write'));
