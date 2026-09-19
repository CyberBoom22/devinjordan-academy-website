-- ===========================================================================
-- 0017 — Pre-class intake
--
-- The paperwork a student completes before they arrive: enrolment details, the
-- eligibility screening, and the three documents they sign. On paper this is a
-- clipboard handed out at the door, which is why classes start late and why
-- waivers get signed in a hurry by somebody who wants to be shooting.
--
-- WHY THE LINK IS PER STUDENT PER SESSION
-- ---------------------------------------
-- The obvious shape is one link per class, the same way check-in works. It is
-- also wrong here, and the difference matters: a check-in link only ever lets
-- somebody assert they are present, and an instructor confirms it afterwards.
-- An intake link carries a signature. One shared link would mean anybody
-- holding it could sign a liability waiver under somebody else's name, and
-- nothing downstream would notice, because a signed document is exactly the
-- artefact that is supposed to settle who agreed to what.
--
-- So the token identifies the pair. It is minted for one student in one
-- session, it is unguessable, and it expires.
--
-- WHY IT EXPIRES AT ALL
-- ---------------------
-- A signature is only evidence of what somebody agreed to on the day. A link
-- that still works next March would let a student sign this year's waiver for
-- a class they took last year, and would sit in an inbox as a permanent
-- credential to their own training record. Two hours after the class ends is
-- long enough for somebody finishing paperwork in the car park.
--
-- WHAT THIS TABLE IS NOT
-- ----------------------
-- Not enrolment, and not attendance. It is the key that lets one person fill
-- in their own forms. The answers live in student_form_records, which already
-- knows about students and sessions; deleting an intake row would not delete a
-- signature, and it is not meant to.
-- ===========================================================================

create table if not exists public.session_intakes (
  id uuid primary key default uuid_generate_v4(),

  session_id uuid not null references public.course_sessions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete restrict,

  -- Allocated by the trigger below. Never supplied by a caller, for the same
  -- reason session tokens are not: a token a screen can choose is a token a
  -- bug can duplicate.
  token text not null unique,

  -- Set when every required form has been submitted. Nullable rather than a
  -- boolean so "finished at 7:12pm the night before" is recoverable, which is
  -- the kind of thing that matters when somebody disputes a waiver.
  completed_at timestamptz,

  -- Populated by the trigger from the session's end time. NOT NULL is safe
  -- despite that: a BEFORE INSERT trigger runs before constraints are checked,
  -- so the column is already filled by the time Postgres looks at it.
  expires_at timestamptz not null,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One intake per person per class. A second one would be a second set of
  -- signatures for the same day, and nothing could say which was authoritative.
  unique (session_id, student_id)
);

create index if not exists session_intakes_session_idx
  on public.session_intakes (session_id);

/**
 * Mint the token, and default the expiry from the session it belongs to.
 *
 * Both are derived rather than passed in. The expiry in particular: a caller
 * that computes it gets to choose it, and "this link works for a year" is one
 * forgotten argument away.
 */
create or replace function app.assign_intake_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');

  if new.expires_at is null then
    select s.ends_at + interval '2 hours' into new.expires_at
    from public.course_sessions s
    where s.id = new.session_id;
  end if;

  return new;
end;
$$;

drop trigger if exists session_intakes_assign on public.session_intakes;
create trigger session_intakes_assign
  before insert on public.session_intakes
  for each row execute function app.assign_intake_token();

drop trigger if exists session_intakes_touch on public.session_intakes;
create trigger session_intakes_touch
  before update on public.session_intakes
  for each row execute function app.touch_updated_at();

-- --- Row level security ----------------------------------------------------
alter table public.session_intakes enable row level security;

-- No anon policy. The intake page runs server-side with the service role and
-- validates the token itself, the same way check-in does — a policy that let a
-- browser read this table would let somebody enumerate who is enrolled.
drop policy if exists "intakes readable with permission" on public.session_intakes;
create policy "intakes readable with permission"
  on public.session_intakes for select
  using (app.has_permission('session.read'));

drop policy if exists "intakes writable with permission" on public.session_intakes;
create policy "intakes writable with permission"
  on public.session_intakes for all
  using (app.has_permission('attendance.verify'))
  with check (app.has_permission('attendance.verify'));

comment on table public.session_intakes is
  'Per-student, per-session key for the pre-class forms. Expires; carries no answers itself.';
