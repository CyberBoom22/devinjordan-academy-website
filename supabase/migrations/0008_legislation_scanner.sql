-- ===========================================================================
-- 0008 — Legislation scanner: sources, findings, status history, settings
--
-- The pipeline this supports:
--
--   fetch → normalise → classify → translate → review → publish
--
-- Each stage has a table, so a run can be resumed, audited, and re-run
-- cheaply. The two ideas the whole design turns on:
--
--   Nothing downstream happens unless the source text actually changed.
--   Every fetched document carries a sha256 of its body; an unchanged hash
--   ends the work there. Without that, every nightly run re-summarises the
--   whole of 27 CFR and bills someone for it.
--
--   A law's identity is its citation within its jurisdiction, not the row it
--   arrived in. Re-scanning an amended statute UPDATES the entry that already
--   exists rather than adding a second one, which is what keeps the public
--   page from growing three copies of the same rule.
-- ===========================================================================

-- --- Where a law applies ---------------------------------------------------
-- public.jurisdictions already exists and is what news_items points at, but
-- its primary key is checked against '^[A-Z]{2}$' — fine for states and the
-- federal government, useless for Bergen County or Newark. The hierarchy gets
-- its own table and links back, rather than loosening a constraint that other
-- tables depend on.
do $$ begin
  create type public.jurisdiction_kind as enum ('federal', 'state', 'county', 'municipality');
exception when duplicate_object then null;
end $$;

create table if not exists public.jurisdiction_nodes (
  id          uuid primary key default uuid_generate_v4(),
  kind        public.jurisdiction_kind not null,
  -- 'US', 'NJ', 'NJ-003' (county FIPS), 'NJ-003-51000' (place FIPS).
  code        text not null unique,
  name        text not null,
  parent_id   uuid references public.jurisdiction_nodes (id) on delete cascade,
  -- Set on states and below, so a query can reach the existing news tables.
  state_code  text references public.jurisdictions (code) on delete set null,
  fips        text,
  -- Most states preempt local firearms regulation (New Jersey does, at
  -- N.J.S. 2C:1-5d). Recording it stops the scanner hunting for municipal
  -- ordinances that cannot legally exist, and stops the page implying a town
  -- has rules of its own when the state has occupied the field.
  preempts_local boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists jurisdiction_nodes_parent_idx on public.jurisdiction_nodes (parent_id);
create index if not exists jurisdiction_nodes_state_idx  on public.jurisdiction_nodes (state_code);

-- --- What a law is about ---------------------------------------------------
create table if not exists public.firearm_categories (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label       text not null,
  description text,
  sort_order  integer not null default 0
);

-- --- Where findings come from ----------------------------------------------
do $$ begin
  create type public.legislation_source_kind as enum (
    'ecfr', 'federal_register', 'congress', 'openstates', 'courtlistener', 'manual'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.legislation_sources (
  key           text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  kind          public.legislation_source_kind not null,
  label         text not null,
  base_url      text not null check (base_url ~* '^https?://'),
  -- Query shape, jurisdiction filters, search terms. Config rather than code
  -- so adding a state does not need a deploy.
  config        jsonb not null default '{}'::jsonb,
  requires_key  boolean not null default false,
  enabled       boolean not null default true,
  last_run_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- --- A scan ----------------------------------------------------------------
do $$ begin
  create type public.scan_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.scan_runs (
  id                  uuid primary key default uuid_generate_v4(),
  source_key          text references public.legislation_sources (key) on delete set null,
  status              public.scan_status not null default 'queued',
  -- Null when a schedule started it; set when a person pressed the button.
  triggered_by        uuid references public.profiles (id) on delete set null,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  documents_seen      integer not null default 0,
  documents_changed   integer not null default 0,
  entries_created     integer not null default 0,
  entries_updated     integer not null default 0,
  summaries_generated integer not null default 0,
  error               text
);

create index if not exists scan_runs_started_idx on public.scan_runs (started_at desc);

-- --- What a scan fetched ---------------------------------------------------
create table if not exists public.raw_documents (
  id           uuid primary key default uuid_generate_v4(),
  source_key   text not null references public.legislation_sources (key) on delete cascade,
  -- The upstream's own identifier. With source_key it is what makes a document
  -- the same document on the next run instead of a new one.
  source_id    text not null,
  url          text not null check (url ~* '^https?://'),
  title        text,
  body         text,
  content_hash text not null,
  fetched_at   timestamptz not null default now(),
  scan_run_id  uuid references public.scan_runs (id) on delete set null,
  unique (source_key, source_id)
);

create index if not exists raw_documents_hash_idx on public.raw_documents (content_hash);

-- --- A finding -------------------------------------------------------------
-- Where a law is in its life. An enum because the application computes on it:
-- "is this in force" is not a question to answer by string-matching a label.
do $$ begin
  create type public.legislation_stage as enum (
    'proposed', 'in_committee', 'passed_one_chamber', 'passed_legislature',
    'enacted', 'in_force', 'amended', 'repealed', 'superseded'
  );
exception when duplicate_object then null;
end $$;

-- Litigation runs on its own track. A statute can be enacted, in force, and
-- enjoined in part, all at once — which is ordinary for firearms law since
-- Bruen, and collapsing it into one status is how a page ends up telling
-- somebody a rule applies to them when a court has said it does not.
do $$ begin
  create type public.legislation_court_status as enum (
    'none', 'challenged', 'enjoined_preliminary', 'enjoined_permanent',
    'stayed', 'upheld', 'struck_down', 'on_appeal'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.legislation_entries (
  id                uuid primary key default uuid_generate_v4(),
  jurisdiction_id   uuid not null references public.jurisdiction_nodes (id) on delete cascade,
  raw_document_id   uuid references public.raw_documents (id) on delete set null,

  citation          text not null,
  title             text not null,
  source_url        text not null check (source_url ~* '^https?://'),
  -- Verbatim. Never paraphrased, never replaced by the summary: it is what the
  -- summary is checked against when somebody disputes it.
  excerpt           text,
  content_hash      text,

  stage             public.legislation_stage not null default 'proposed',
  court_status      public.legislation_court_status not null default 'none',
  -- Free text beside the enums, following news_items.status_label: the badge
  -- colours key off the enum, but legislatures invent stages faster than
  -- anyone can ship a migration.
  status_label      text check (status_label is null or length(status_label) <= 60),

  introduced_at     date,
  enacted_at        date,
  effective_at      date,
  repealed_at       date,

  plain_summary     text,
  summary_model     text,
  summary_prompt_version text,
  summary_generated_at timestamptz,

  status            public.content_status not null default 'draft',
  auto_published    boolean not null default false,
  approved_by       uuid references public.profiles (id) on delete set null,
  approved_at       timestamptz,
  published_at      timestamptz,

  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- The identity rule. One law per citation per jurisdiction, so a re-scan
  -- updates rather than duplicates.
  unique (jurisdiction_id, citation)
);

create index if not exists legislation_entries_status_idx on public.legislation_entries (status);
create index if not exists legislation_entries_juris_idx  on public.legislation_entries (jurisdiction_id);

drop trigger if exists legislation_entries_touch on public.legislation_entries;
create trigger legislation_entries_touch
  before update on public.legislation_entries
  for each row execute function app.touch_updated_at();

-- --- How a finding got where it is -----------------------------------------
-- "Updates on those laws" as a timeline rather than a column that forgets.
-- Every change of stage or court posture appends here, with the source that
-- reported it, so the public page can show a history and an editor can see
-- what moved since they last approved it.
create table if not exists public.legislation_status_events (
  id            uuid primary key default uuid_generate_v4(),
  entry_id      uuid not null references public.legislation_entries (id) on delete cascade,
  occurred_at   date,
  recorded_at   timestamptz not null default now(),
  stage         public.legislation_stage,
  court_status  public.legislation_court_status,
  note          text,
  source_url    text check (source_url is null or source_url ~* '^https?://'),
  scan_run_id   uuid references public.scan_runs (id) on delete set null
);

create index if not exists legislation_status_events_entry_idx
  on public.legislation_status_events (entry_id, recorded_at desc);

create table if not exists public.legislation_entry_categories (
  entry_id     uuid not null references public.legislation_entries (id) on delete cascade,
  category_key text not null references public.firearm_categories (key) on delete cascade,
  primary key (entry_id, category_key)
);

-- --- Settings: the schedule is the dev's, the review gate is the academy's --
create table if not exists public.scan_settings (
  id                     boolean primary key default true check (id),
  enabled                boolean not null default false,
  -- "How many times the scan is run" — per day, spread evenly by the cron.
  runs_per_day           integer not null default 1 check (runs_per_day between 1 and 24),
  -- How often a published presentation is refreshed from its entry.
  refresh_interval_hours integer not null default 24 check (refresh_interval_hours between 1 and 720),
  -- Off by default, deliberately. Turning it on publishes an AI summary of a
  -- firearms statute to the public site with nobody having read it.
  auto_publish           boolean not null default false,
  -- When an in-force law changes and auto_publish is off, the entry drops back
  -- to draft rather than silently serving the old text as if still checked.
  redraft_on_change      boolean not null default true,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles (id) on delete set null
);

insert into public.scan_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.ai_settings (
  id          boolean primary key default true check (id),
  provider    text not null default 'anthropic'
                check (provider in ('anthropic', 'openai', 'google')),
  model       text,
  -- A secret in a table rather than a Worker secret, because the dev asked to
  -- set it from the admin UI and `wrangler secret put` cannot be driven from a
  -- browser. The trade: anyone with database access can read it. It is kept
  -- off every read path the application uses — see ai_settings_safe — and the
  -- RLS below admits only level 1.
  api_key     text,
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

insert into public.ai_settings (id) values (true) on conflict (id) do nothing;

-- Everything about the AI configuration except the one thing that must never
-- reach a browser.
create or replace view public.ai_settings_safe
with (security_invoker = true) as
select
  provider,
  model,
  enabled,
  updated_at,
  api_key is not null and length(api_key) > 0 as has_key,
  case when api_key is null or length(api_key) < 4
       then null else right(api_key, 4) end   as key_last4
from public.ai_settings where id;

-- ===========================================================================
-- Row level security
-- ===========================================================================
alter table public.jurisdiction_nodes           enable row level security;
alter table public.firearm_categories           enable row level security;
alter table public.legislation_sources          enable row level security;
alter table public.scan_runs                    enable row level security;
alter table public.raw_documents                enable row level security;
alter table public.legislation_entries          enable row level security;
alter table public.legislation_status_events    enable row level security;
alter table public.legislation_entry_categories enable row level security;
alter table public.scan_settings                enable row level security;
alter table public.ai_settings                  enable row level security;

-- Reference data the public page needs to render at all.
drop policy if exists "jurisdiction nodes public read" on public.jurisdiction_nodes;
create policy "jurisdiction nodes public read" on public.jurisdiction_nodes for select using (true);

drop policy if exists "firearm categories public read" on public.firearm_categories;
create policy "firearm categories public read" on public.firearm_categories for select using (true);

-- Findings follow the same rule as every other content table: the public sees
-- what is published, staff with news.read see drafts too.
drop policy if exists "legislation entries read" on public.legislation_entries;
create policy "legislation entries read" on public.legislation_entries for select
  using (app.can_see(status, 'news.read'));

drop policy if exists "legislation entries write" on public.legislation_entries;
create policy "legislation entries write" on public.legislation_entries for all
  using (app.has_permission('news.write')) with check (app.has_permission('news.write'));

drop policy if exists "legislation events read" on public.legislation_status_events;
create policy "legislation events read" on public.legislation_status_events for select
  using (exists (
    select 1 from public.legislation_entries e
    where e.id = entry_id and app.can_see(e.status, 'news.read')
  ));

drop policy if exists "legislation categories read" on public.legislation_entry_categories;
create policy "legislation categories read" on public.legislation_entry_categories for select
  using (exists (
    select 1 from public.legislation_entries e
    where e.id = entry_id and app.can_see(e.status, 'news.read')
  ));

-- Machinery. Staff only: raw bodies and scan errors are not public interest,
-- and a fetch error can quote an API key back in its message.
drop policy if exists "sources readable by staff" on public.legislation_sources;
create policy "sources readable by staff" on public.legislation_sources for select
  using (app.has_permission('news.read'));

drop policy if exists "scan runs readable by staff" on public.scan_runs;
create policy "scan runs readable by staff" on public.scan_runs for select
  using (app.has_permission('news.read'));

drop policy if exists "raw documents readable by staff" on public.raw_documents;
create policy "raw documents readable by staff" on public.raw_documents for select
  using (app.has_permission('news.read'));

drop policy if exists "scan settings readable by staff" on public.scan_settings;
create policy "scan settings readable by staff" on public.scan_settings for select
  using (app.has_permission('news.read'));

-- The schedule belongs to whoever maintains the software; the review gate
-- belongs to whoever is responsible for what the site says. Writes go through
-- the functions below rather than a policy, because those two live on one row
-- and RLS cannot split a row by column.
drop policy if exists "ai settings dev only" on public.ai_settings;
create policy "ai settings dev only" on public.ai_settings for select
  using (app.user_level() <= 1);

-- ===========================================================================
-- Setters
-- ===========================================================================
create or replace function public.set_scan_schedule(
  p_enabled boolean,
  p_runs_per_day integer,
  p_refresh_interval_hours integer
)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.user_level() > 1 then
    raise exception 'Only a Dev may change the scan schedule.' using errcode = 'insufficient_privilege';
  end if;
  update public.scan_settings
  set enabled = p_enabled,
      runs_per_day = p_runs_per_day,
      refresh_interval_hours = p_refresh_interval_hours,
      updated_at = now(), updated_by = auth.uid()
  where id;
  perform app.record_audit('scan.schedule', 'scan_settings', 'singleton',
    format('Scan schedule set to %s run(s) a day, refresh every %sh, enabled=%s',
           p_runs_per_day, p_refresh_interval_hours, p_enabled), null);
end;
$$;

create or replace function public.set_scan_review_policy(
  p_auto_publish boolean,
  p_redraft_on_change boolean
)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.has_permission('news.publish') then
    raise exception 'You do not have permission to change the review policy.'
      using errcode = 'insufficient_privilege';
  end if;
  update public.scan_settings
  set auto_publish = p_auto_publish,
      redraft_on_change = p_redraft_on_change,
      updated_at = now(), updated_by = auth.uid()
  where id;
  perform app.record_audit('scan.review_policy', 'scan_settings', 'singleton',
    case when p_auto_publish
      then 'Auto-publish turned ON: scanned summaries go public without review'
      else 'Auto-publish turned OFF: scanned summaries wait for review' end, null);
end;
$$;

create or replace function public.set_ai_provider(
  p_provider text, p_model text, p_api_key text, p_enabled boolean
)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.user_level() > 1 then
    raise exception 'Only a Dev may change the AI provider.' using errcode = 'insufficient_privilege';
  end if;
  update public.ai_settings
  set provider = p_provider,
      model = nullif(trim(coalesce(p_model, '')), ''),
      -- Null means "leave it alone", so the form can be saved without
      -- re-typing a key it is never shown.
      api_key = coalesce(nullif(trim(coalesce(p_api_key, '')), ''), api_key),
      enabled = p_enabled,
      updated_at = now(), updated_by = auth.uid()
  where id;
  -- Deliberately records no part of the key, not even its length.
  perform app.record_audit('ai.settings', 'ai_settings', 'singleton',
    format('AI provider set to %s (enabled=%s)', p_provider, p_enabled), null);
end;
$$;

grant execute on function public.set_scan_schedule(boolean, integer, integer) to authenticated;
grant execute on function public.set_scan_review_policy(boolean, boolean) to authenticated;
grant execute on function public.set_ai_provider(text, text, text, boolean) to authenticated;
grant select on public.ai_settings_safe to authenticated;

-- ===========================================================================
-- Seed: the four launch states, and what a law can be about
-- ===========================================================================
-- public.jurisdictions was created in 0002 and never seeded: US, NJ and NY
-- existed only as TypeScript in src/lib/seed/news.ts, so the table was empty
-- and the foreign key below had nothing to point at. Seeded here, in full,
-- rather than adding only the two new states to a table that turned out not to
-- contain the other three.
insert into public.jurisdictions (code, name, sort_order, is_quick_pick) values
  ('US', 'Federal',      0, true),
  ('NJ', 'New Jersey',   1, true),
  ('NY', 'New York',     2, true),
  ('PA', 'Pennsylvania', 3, true),
  ('CT', 'Connecticut',  4, true)
on conflict (code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_quick_pick = excluded.is_quick_pick;

insert into public.jurisdiction_nodes (kind, code, name, state_code, preempts_local) values
  ('federal', 'US', 'United States', null, false),
  ('state',   'NJ', 'New Jersey',   'NJ', true),
  ('state',   'NY', 'New York',     'NY', false),
  ('state',   'PA', 'Pennsylvania', 'PA', true),
  ('state',   'CT', 'Connecticut',  'CT', false)
on conflict (code) do nothing;

update public.jurisdiction_nodes child
set parent_id = parent.id
from public.jurisdiction_nodes parent
where parent.code = 'US' and child.kind = 'state' and child.parent_id is null;

insert into public.firearm_categories (key, label, description, sort_order) values
  ('handgun',    'Handguns',            'Pistols and revolvers.', 10),
  ('rifle',      'Rifles',              'Long guns with a rifled barrel, including semi-automatic rifles.', 20),
  ('shotgun',    'Shotguns',            'Smooth-bore long guns.', 30),
  ('assault_weapon', 'Assault weapons', 'Whatever the jurisdiction in question defines by that term — the definitions differ sharply between states.', 40),
  ('sbr',        'Short-barrelled',     'Short-barrelled rifles and shotguns, NFA-regulated federally.', 50),
  ('suppressor', 'Suppressors',         'Silencers and suppressors.', 60),
  ('magazine',   'Magazines',           'Capacity limits and feeding devices.', 70),
  ('ammunition', 'Ammunition',          'Ammunition sales, types and record-keeping.', 80),
  ('carry',      'Carry & transport',   'Permits to carry, concealed carry, and transport rules.', 90),
  ('purchase',   'Purchase & transfer', 'Background checks, waiting periods, private transfers and dealers.', 100),
  ('storage',    'Storage',             'Safe storage and child access prevention.', 110),
  ('prohibited', 'Prohibited persons',  'Who may not possess a firearm, and restoration of rights.', 120)
on conflict (key) do nothing;

insert into public.legislation_sources (key, kind, label, base_url, requires_key, config) values
  ('ecfr', 'ecfr', 'eCFR — ATF regulations',
   'https://www.ecfr.gov/api/versioner/v1', false,
   '{"titles": [27], "parts": ["478", "479"], "jurisdiction": "US"}'::jsonb),
  ('federal_register', 'federal_register', 'Federal Register — ATF rulemaking',
   'https://www.federalregister.gov/api/v1', false,
   '{"agencies": ["alcohol-tobacco-firearms-and-explosives-bureau"], "jurisdiction": "US"}'::jsonb),
  ('congress', 'congress', 'Congress.gov — federal bills',
   'https://api.congress.gov/v3', true,
   '{"query": "firearm OR ammunition OR handgun", "jurisdiction": "US"}'::jsonb),
  ('openstates', 'openstates', 'OpenStates — state bills',
   'https://v3.openstates.org', true,
   '{"states": ["nj", "ny", "pa", "ct"], "query": "firearm"}'::jsonb),
  ('courtlistener', 'courtlistener', 'CourtListener — challenges in the courts',
   'https://www.courtlistener.com/api/rest/v4', true,
   '{"query": "Second Amendment firearm", "states": ["nj", "ny", "pa", "ct"]}'::jsonb)
on conflict (key) do nothing;
