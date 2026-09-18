-- ===========================================================================
-- 0015 — Training sessions and attendance
--
-- A class that happens on a date, and the people who were in the room. This is
-- the spine the rest of the packet hangs from: forms 02, 04, 08, 09 and 10 are
-- all "per session, per student" and have nowhere to attach until a session
-- exists.
--
-- THE SIGNATURE IS WHAT MAKES IT A RECORD, NOT THE SCAN
-- ----------------------------------------------------
-- Every self-reported check-in lands as 'pending' and stays there. A student
-- scanning a QR code has told us they are present; it is the instructor's
-- certification at the end of the day that turns a list of claims into a
-- DJSTA-STD-003 record somebody can be held to. That is why status defaults to
-- pending rather than verified, why certified_at is separate from the check-in
-- times, and why nothing downstream — no certificate, no qualification — reads
-- an uncertified roster. Design the screens around that and the paperwork is
-- honest; design them the other way and the academy is signing for attendance
-- nobody checked.
--
-- WHY TITLES ARE STORED, NOT COMPUTED
-- -----------------------------------
-- The title is generated from the course and the date when the session is
-- created, then kept. Rendering it live would mean a course renamed in 2028
-- silently retitles a class taught in 2026, including on the roster PDF that
-- was filed under the old name. title_is_custom stops a regeneration
-- clobbering a title somebody deliberately overrode.
--
-- THREE TOKENS, THREE DIFFERENT JOBS
-- ----------------------------------
--   course_record_id  is the human-facing reference on paperwork. Sequential,
--                     allocated the same way a student number is.
--   checkin_token     goes in the QR code the room scans. Rotatable, because
--                     a code on a projector is a code that gets photographed.
--   presenter_token   opens the read-only projector view, which lives OUTSIDE
--                     /admin precisely so an eight-hour class does not hit the
--                     two-hour admin session cap in front of the students.
--
-- They are separate so that revoking one does not revoke the others: rotating
-- the check-in code mid-class must not black out the projector.
-- ===========================================================================

-- --- Course training settings ----------------------------------------------
-- Extending the existing table rather than adding a second one. A course is
-- already a catalogue entry with a price and a description; these are the
-- columns that make it teachable.
alter table public.courses
  add column if not exists code text,
  add column if not exists default_duration_minutes integer,
  add column if not exists requires_score boolean not null default false,
  add column if not exists max_score integer,
  add column if not exists passing_score integer,
  -- Drives the checkbox list on the attendance record (form 08).
  add column if not exists required_content text[] not null default '{}',
  add column if not exists cert_validity_months integer,
  add column if not exists issues_certificate boolean not null default true;

do $$ begin
  alter table public.courses add constraint courses_code_format
    check (code is null or code ~ '^[A-Z][A-Z0-9-]{1,23}$');
exception when duplicate_object then null;
end $$;

create unique index if not exists courses_code_idx on public.courses (code)
  where code is not null;

do $$ begin
  create type public.session_status as enum
    ('draft', 'open', 'in_progress', 'closed', 'certified');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.checkin_method as enum ('qr_self', 'instructor_added', 'late_add');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.checkin_status as enum
    ('pending', 'verified', 'rejected', 'no_show', 'needs_review');
exception when duplicate_object then null;
end $$;

-- --- Sessions --------------------------------------------------------------
create table if not exists public.course_sessions (
  id uuid primary key default uuid_generate_v4(),

  course_id     uuid not null references public.courses (id),
  instructor_id uuid references public.instructors (id),

  title           text not null,
  title_is_custom boolean not null default false,

  location  text not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  constraint course_sessions_ends_after_start check (ends_at > starts_at),

  -- Allocated by trigger, like a student number. Never supplied by a caller.
  course_record_id text not null unique,
  checkin_token    text not null unique,
  presenter_token  text not null unique,

  checkin_opens_at  timestamptz not null,
  checkin_closes_at timestamptz not null,
  constraint course_sessions_window check (checkin_closes_at > checkin_opens_at),

  -- When on, the QR rotates on a 60-second bucket. The answer to a student
  -- texting the link to somebody at home — geolocation is disabled site-wide
  -- by Permissions-Policy and is the wrong tool anyway.
  rotate_token boolean not null default false,

  content_covered text[] not null default '{}',

  status public.session_status not null default 'draft',

  certified_by uuid references public.profiles (id),
  certified_at timestamptz,
  instructor_signature_path text,
  roster_pdf_path text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_sessions_when_idx on public.course_sessions (starts_at desc);
create index if not exists course_sessions_status_idx on public.course_sessions (status, starts_at desc);

/**
 * Allocate the record id and both tokens on insert.
 *
 * Same reasoning as the student number: a caller cannot supply these, so no
 * bug and no crafted request can pick a token or collide with an existing one.
 * The tokens are 32 hex characters from gen_random_bytes — unguessable, which
 * is the only thing protecting the projector view, since it sits outside the
 * admin guard by design.
 */
create or replace function app.assign_session_identifiers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.course_record_id := app.next_record_number('course_session', 'QR');
  new.checkin_token    := encode(pg_catalog.gen_random_bytes(16), 'hex');
  new.presenter_token  := encode(pg_catalog.gen_random_bytes(16), 'hex');
  return new;
end;
$$;

drop trigger if exists course_sessions_assign on public.course_sessions;
create trigger course_sessions_assign
  before insert on public.course_sessions
  for each row execute function app.assign_session_identifiers();

/**
 * The record id is permanent; the check-in token is not.
 *
 * course_record_id appears on the roster PDF and on certificates, so it is
 * frozen the same way a student number is. checkin_token is deliberately NOT
 * frozen — rotating it is a feature.
 */
create or replace function app.freeze_session_record_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.course_record_id is distinct from old.course_record_id then
    raise exception 'The course record id cannot be changed once allocated.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists course_sessions_freeze on public.course_sessions;
create trigger course_sessions_freeze
  before update on public.course_sessions
  for each row execute function app.freeze_session_record_id();

drop trigger if exists course_sessions_touch on public.course_sessions;
create trigger course_sessions_touch
  before update on public.course_sessions
  for each row execute function app.touch_updated_at();

-- --- Attendance ------------------------------------------------------------
create table if not exists public.session_checkins (
  id uuid primary key default uuid_generate_v4(),

  session_id uuid not null references public.course_sessions (id) on delete cascade,
  student_id uuid not null references public.students (id),

  time_in  timestamptz not null default now(),
  time_out timestamptz,

  method public.checkin_method not null default 'qr_self',
  -- What they typed, kept even after it is matched to a record. If a student
  -- is later merged into another, this is the evidence of what was claimed on
  -- the day.
  self_attested_name text,

  ip inet,
  user_agent text,
  instructor_initials text,

  -- Always starts pending. See the header.
  status public.checkin_status not null default 'pending',
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,

  score integer,
  possible integer,
  score_percent numeric generated always as
    (case when possible > 0 then round(score::numeric * 100 / possible, 1) end) stored,
  passed boolean,
  scored_by uuid references public.profiles (id),

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A second scan reopens the existing row rather than creating a duplicate.
  unique (session_id, student_id)
);

create index if not exists session_checkins_session_idx
  on public.session_checkins (session_id, status);
create index if not exists session_checkins_student_idx
  on public.session_checkins (student_id);

drop trigger if exists session_checkins_touch on public.session_checkins;
create trigger session_checkins_touch
  before update on public.session_checkins
  for each row execute function app.touch_updated_at();

-- --- Row level security ----------------------------------------------------
alter table public.course_sessions  enable row level security;
alter table public.session_checkins enable row level security;

drop policy if exists "sessions readable with permission" on public.course_sessions;
create policy "sessions readable with permission"
  on public.course_sessions for select
  using (app.has_permission('session.read'));

drop policy if exists "sessions writable with permission" on public.course_sessions;
create policy "sessions writable with permission"
  on public.course_sessions for all
  using (app.has_permission('session.write'))
  with check (app.has_permission('session.write'));

drop policy if exists "checkins readable with permission" on public.session_checkins;
create policy "checkins readable with permission"
  on public.session_checkins for select
  using (app.has_permission('session.read'));

drop policy if exists "checkins writable with permission" on public.session_checkins;
create policy "checkins writable with permission"
  on public.session_checkins for all
  using (app.has_permission('attendance.verify'))
  with check (app.has_permission('attendance.verify'));

-- Anon gets NO policy on either table. The public check-in handler runs
-- server-side with the service role key and does its own validation: a valid
-- unexpired token, inside the window, one row per student per session.

-- --- Permissions -----------------------------------------------------------
insert into public.permissions (key, label, "group", description) values
  ('session.read', 'View training sessions', 'Training', 'See the class schedule, rosters and attendance.'),
  ('session.write', 'Create and run sessions', 'Training', 'Schedule a class, open check-in and run it on the day.'),
  ('session.manage', 'Manage any session', 'Training', 'Edit or delete a session belonging to another instructor.'),
  ('session.certify', 'Certify a roster', 'Training', 'Sign the attendance record. This is the signature that turns self-reported scans into an official DJSTA-STD-003 record, so it is deliberately not given to editors.'),
  ('attendance.verify', 'Verify attendance', 'Training', 'Confirm or reject a student''s check-in, record time out, and enter qualification scores.')
on conflict (key) do update set
  label = excluded.label,
  "group" = excluded."group",
  description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join (values
  ('session.read',      array['owner','admin','editor','instructor','viewer']),
  ('session.write',     array['owner','admin','editor','instructor']),
  ('session.manage',    array['owner','admin']),
  ('session.certify',   array['owner','admin','instructor']),
  ('attendance.verify', array['owner','admin','instructor'])
) as p(key, roles)
where r.key = any(p.roles)
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.key = 'dev'
on conflict do nothing;
