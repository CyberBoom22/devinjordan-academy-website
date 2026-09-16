-- ===========================================================================
-- 0010 — Required forms
--
-- The paperwork somebody has to complete to work in security in New Jersey:
-- SORA registration, fingerprinting, firearms permits, the employer's half.
-- Students arrive knowing they need "the forms" and not which ones, in what
-- order, or who issues them.
--
-- Two things this schema insists on, both for the same reason — a wrong answer
-- here does not inconvenience somebody, it stops them working or puts them on
-- the wrong side of a licensing rule.
--
--   source_url is NOT NULL. Every form points at the agency that issues it.
--   The academy never hosts a copy: a PDF mirrored here is a PDF that goes
--   stale silently while still looking official, and the one thing worse than
--   no form is last year's form with this year's confidence.
--
--   last_verified_at records when a person last opened that link and checked
--   it still leads to the current form. Agencies renumber and move things.
--   The date is shown publicly, so a visitor can judge for themselves how
--   fresh the list is rather than trusting it uniformly.
--
-- No forms are seeded. Only the categories are, because inventing a form
-- number that looks plausible is precisely the failure this table is shaped to
-- prevent — and the real numbers have to be read off the issuing agency's own
-- page by somebody who can see it.
-- ===========================================================================

create table if not exists public.form_categories (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label       text not null,
  description text,
  sort_order  integer not null default 0
);

-- Who fills it in. A student chasing an employer's form, or an employer
-- chasing a student's, is the commonest way this goes wrong.
do $$ begin
  create type public.form_audience as enum ('student', 'instructor', 'employer');
exception when duplicate_object then null;
end $$;

create table if not exists public.required_forms (
  id               uuid primary key default uuid_generate_v4(),
  category_key     text references public.form_categories (key) on delete set null,
  jurisdiction_code text references public.jurisdictions (code) on delete set null,

  name             text not null,
  -- 'STS-033' and the like. Null where the agency does not number it, which is
  -- commoner than it ought to be.
  form_number      text,
  issuing_agency   text not null,
  description      text,

  -- The agency's own page. Constrained to http(s) at the database level so a
  -- javascript: URL can never reach a link href, whatever the admin form does
  -- — the same guard news_sources already uses.
  source_url       text not null check (source_url ~* '^https?://'),

  audience         public.form_audience not null default 'student',
  -- Some paperwork is required, some merely usual. Saying which is the whole
  -- value of the page.
  is_required      boolean not null default true,
  -- "Bring two forms of ID", "must be notarised", "employer submits this one".
  notes            text,

  last_verified_at date,
  verified_by      uuid references public.profiles (id) on delete set null,

  sort_order       integer not null default 0,
  status           public.content_status not null default 'draft',
  published_at     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null
);

create index if not exists required_forms_status_idx on public.required_forms (status, sort_order);

drop trigger if exists required_forms_touch on public.required_forms;
create trigger required_forms_touch
  before update on public.required_forms
  for each row execute function app.touch_updated_at();

-- Which courses need which paperwork. Optional: a form can be generally
-- required without belonging to any one course.
create table if not exists public.course_required_forms (
  course_id uuid not null references public.courses (id) on delete cascade,
  form_id   uuid not null references public.required_forms (id) on delete cascade,
  primary key (course_id, form_id)
);

-- --- Row level security ----------------------------------------------------
alter table public.form_categories      enable row level security;
alter table public.required_forms       enable row level security;
alter table public.course_required_forms enable row level security;

drop policy if exists "form categories public read" on public.form_categories;
create policy "form categories public read"
  on public.form_categories for select using (true);

drop policy if exists "form categories write" on public.form_categories;
create policy "form categories write"
  on public.form_categories for all
  using (app.has_permission('page.write')) with check (app.has_permission('page.write'));

-- Same shape as every other content table: the public sees what is published,
-- staff with page.read see drafts as well.
drop policy if exists "required forms read" on public.required_forms;
create policy "required forms read"
  on public.required_forms for select
  using (app.can_see(status, 'page.read'));

drop policy if exists "required forms write" on public.required_forms;
create policy "required forms write"
  on public.required_forms for all
  using (app.has_permission('page.write')) with check (app.has_permission('page.write'));

drop policy if exists "course forms read" on public.course_required_forms;
create policy "course forms read"
  on public.course_required_forms for select
  using (exists (
    select 1 from public.required_forms f
    where f.id = form_id and app.can_see(f.status, 'page.read')
  ));

drop policy if exists "course forms write" on public.course_required_forms;
create policy "course forms write"
  on public.course_required_forms for all
  using (app.has_permission('page.write')) with check (app.has_permission('page.write'));

-- --- The categories --------------------------------------------------------
-- Ordered the way somebody actually moves through them, not alphabetically:
-- registration, then the background check, then firearms if the role needs
-- them, then the employer's part, then what comes round again every few years.
insert into public.form_categories (key, label, description, sort_order) values
  ('sora', 'SORA registration',
   'Registration under the Security Officer Registration Act, which is what makes security work lawful in New Jersey.', 10),
  ('background', 'Fingerprinting & background check',
   'Criminal history record checks and the fingerprinting appointment that feeds them.', 20),
  ('firearms', 'Firearms permits',
   'Only for armed roles. Separate from SORA, issued by different authorities, and on their own timetable.', 30),
  ('medical', 'Medical & fitness',
   'Physical and vision requirements where a role or an insurer imposes them.', 40),
  ('employer', 'Employer paperwork',
   'The half an employer completes. A student waiting on these cannot finish alone.', 50),
  ('renewal', 'Renewals',
   'What expires, and when. Most of this list comes round again.', 60)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;
