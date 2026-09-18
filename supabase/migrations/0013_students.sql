-- ===========================================================================
-- 0013 — Students and the permanent student number
--
-- One row per human, reused for every course they ever take. The number on it
-- is the thing the whole training record hangs from: a certificate, a roster
-- and a qualification score are only findable in two years because they all
-- point at the same student.
--
-- WHY THE NUMBER CANNOT COLLIDE
-- -----------------------------
-- "Unique" is easy to claim and easy to lose. Three separate mechanisms here,
-- because each one covers a failure the others do not:
--
--   1. A UNIQUE constraint on djsta_student_no. This is the only guarantee
--      that actually holds under concurrency, because it is enforced by the
--      index itself. Everything else below is about never reaching it.
--
--   2. Allocation inside the database, under a row lock. The next value comes
--      from an INSERT ... ON CONFLICT DO UPDATE on record_sequences, which
--      takes a row lock for the duration of the transaction. Two registrations
--      landing in the same millisecond queue; neither reads a stale counter.
--      Computing the next number in TypeScript — select max, add one, insert —
--      is precisely the race this avoids, and it fails rarely enough in
--      testing to reach production intact.
--
--   3. A BEFORE INSERT trigger that assigns the number and ignores whatever
--      the caller supplied. This is the one that makes a duplicate impossible
--      rather than merely unlikely: application code cannot pass a number in,
--      so no bug, no copied-and-pasted insert and no compromised client can
--      choose one. There is no code path that sets this column by hand.
--
-- And it is never reissued. A BEFORE UPDATE trigger rejects any change to the
-- number, so a correction to a misspelled name cannot quietly reassign an
-- identity that certificates already point at. Duplicates are resolved by
-- pointing one record at another with merged_into — never by deleting a row
-- and never by freeing its number for reuse. A number that has been issued
-- belongs to that person permanently, including after a merge.
--
-- WHAT IS NOT COLLECTED
-- ---------------------
-- No Social Security numbers, no medical detail, no payment data. The packet
-- says so on its own privacy notice and the schema agrees with it: there is
-- nowhere to put them. Photo ID is recorded as type, state, expiry and the
-- last four characters only — enough to show identity was checked, not enough
-- to be worth stealing.
-- ===========================================================================

-- --- Sequential record numbers ---------------------------------------------
-- Scoped by (kind, year) so student numbers, course record ids and certificate
-- numbers each count independently and restart each January.
create table if not exists public.record_sequences (
  scope      text not null,
  year       integer not null,
  last_value integer not null default 0,
  primary key (scope, year)
);

alter table public.record_sequences enable row level security;

-- No policy for anyone. This table is touched only by the security definer
-- function below, which runs as its owner. A counter that a client can read is
-- a counter that tells them how many students the academy has.

comment on table public.record_sequences is
  'Allocation counters for permanent record numbers. Written only by app.next_record_number().';

/**
 * The next number in a series, allocated atomically.
 *
 * The upsert takes a row lock on (scope, year) and holds it to the end of the
 * transaction, so concurrent callers serialise rather than collide. Numbers are
 * consumed even by a transaction that later rolls back — a gap in the series is
 * the correct trade against two people sharing a number.
 */
create or replace function app.next_record_number(p_scope text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from pg_catalog.now());
  v_next integer;
begin
  insert into public.record_sequences (scope, year, last_value)
  values (p_scope, v_year, 1)
  on conflict (scope, year)
    do update set last_value = public.record_sequences.last_value + 1
  returning last_value into v_next;

  return p_prefix || '-' || v_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

comment on function app.next_record_number(text, text) is
  'Allocates the next number in a series under a row lock. Never call a TypeScript equivalent.';

-- --- Students --------------------------------------------------------------
create table if not exists public.students (
  id uuid primary key default uuid_generate_v4(),

  -- Assigned by the trigger below, never by a caller. The format is checked so
  -- that a number which somehow bypassed allocation still cannot be malformed.
  djsta_student_no text not null unique
    check (djsta_student_no ~ '^DJSTA-[0-9]{4}-[0-9]{6}$'),

  legal_first  text not null,
  legal_middle text,
  legal_last   text not null,
  -- Maiden and former names. A certificate issued eight years ago is findable
  -- only if the name it was issued under is still on the record.
  prior_names  text[],
  dob          date not null,

  email text not null,
  phone text,

  address_line1 text,
  address_line2 text,
  city          text,
  state         text,
  zip           text,

  emergency_contact jsonb,
  preferred_contact public.contact_preference,

  -- Identity was checked against something. Last four characters only.
  photo_id_type  text,
  photo_id_state text,
  photo_id_last4 text check (photo_id_last4 is null or length(photo_id_last4) <= 4),
  photo_id_exp   date,

  internal_notes text,

  -- Duplicate resolution. The row stays, the number stays, and reads follow
  -- the pointer to the surviving record.
  merged_into uuid references public.students (id),
  -- A record cannot be merged into itself; that would make lookup loop.
  constraint students_merge_not_self check (merged_into is null or merged_into <> id),

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Search by surname and date of birth is how the office finds a returning
-- student who does not remember their number, which is most of them.
create index if not exists students_name_idx on public.students (lower(legal_last), dob);
create index if not exists students_email_idx on public.students (lower(email));
create index if not exists students_merged_idx on public.students (merged_into)
  where merged_into is not null;

/**
 * Assign the permanent number, ignoring anything the caller passed.
 *
 * Overwriting rather than defaulting is deliberate. A DEFAULT is only applied
 * when the column is omitted, so any insert that names the column — including
 * a mistaken copy of another insert — would set it directly. This cannot be
 * bypassed by naming the column.
 */
create or replace function app.assign_student_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.djsta_student_no := app.next_record_number('student', 'DJSTA');
  return new;
end;
$$;

drop trigger if exists students_assign_number on public.students;
create trigger students_assign_number
  before insert on public.students
  for each row execute function app.assign_student_number();

/**
 * Refuse to change a number that has already been issued.
 *
 * Certificates, rosters and qualification records point at this value. Letting
 * an edit change it would silently re-attribute somebody else's training
 * history, and the damage would not surface until an audit years later.
 */
create or replace function app.freeze_student_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.djsta_student_no is distinct from old.djsta_student_no then
    raise exception
      'The permanent student number cannot be changed (% to %). Merge the duplicate instead.',
      old.djsta_student_no, new.djsta_student_no
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists students_freeze_number on public.students;
create trigger students_freeze_number
  before update on public.students
  for each row execute function app.freeze_student_number();

drop trigger if exists students_touch on public.students;
create trigger students_touch
  before update on public.students
  for each row execute function app.touch_updated_at();

-- --- Row level security ----------------------------------------------------
alter table public.students enable row level security;

-- No policy for anon at all. A student record holds a date of birth, a home
-- address and an emergency contact; the public check-in flow reaches it
-- through a server-side handler holding the service role key, never through a
-- policy a browser could invoke.
drop policy if exists "students readable with permission" on public.students;
create policy "students readable with permission"
  on public.students for select
  using (app.has_permission('student.read'));

drop policy if exists "students insertable with permission" on public.students;
create policy "students insertable with permission"
  on public.students for insert
  with check (app.has_permission('student.write'));

drop policy if exists "students updatable with permission" on public.students;
create policy "students updatable with permission"
  on public.students for update
  using (app.has_permission('student.write'))
  with check (app.has_permission('student.write'));

-- No delete policy, on purpose. A student who has been issued a certificate
-- cannot be deleted without orphaning it; duplicates are merged instead.

-- --- Permissions -----------------------------------------------------------
-- Generated from src/lib/auth/permissions.ts by `npm run db:permissions`.
insert into public.permissions (key, label, "group", description) values
  ('student.read', 'View student records', 'Students', 'Search the permanent student register and open a student’s record, including their date of birth and contact details.'),
  ('student.write', 'Add and edit students', 'Students', 'Register a new student and correct the details on an existing one. The permanent student number is assigned by the database and cannot be typed, chosen or changed by anyone.'),
  ('student.merge', 'Merge duplicate students', 'Students', 'Point one student record at another when the same person has been registered twice. Neither record is deleted, and neither number is ever reused.')
on conflict (key) do update set
  label = excluded.label,
  "group" = excluded."group",
  description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join (values
  ('student.read', array['owner','admin','editor','instructor','viewer']),
  ('student.write', array['owner','admin','instructor']),
  ('student.merge', array['owner','admin'])
) as p(key, roles)
where r.key = any(p.roles)
on conflict do nothing;

-- The dev role holds every permission there is, including the three above.
-- Same statement as 0005, which is re-runnable for exactly this reason.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.key = 'dev'
on conflict do nothing;
