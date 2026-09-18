-- ===========================================================================
-- 0014 — The student record packet
--
-- The seventeen PDFs in docs/forms, as rows. Until now "the forms" existed as
-- paper and as files in the repository, and the admin screen that listed forms
-- was empty because required_forms is for somebody else's paperwork — the
-- state's — and deliberately seeds nothing. This is the academy's own packet,
-- which is a different thing and needs its own table.
--
-- WHY A CATALOGUE AND NOT A PILE OF COLUMNS
-- -----------------------------------------
-- The obvious shape is one table per form: fifteen tables, each mirroring one
-- PDF. It is also the shape that guarantees the next form added means a
-- migration, a deploy and a screen nobody built. The forms change — a waiver is
-- re-reviewed by counsel, a screening question is added after an incident — and
-- a schema that has to be redeployed to keep up with its own paperwork will
-- fall behind it within a year.
--
-- So the packet is data. packet_forms says what each form IS; the answers live
-- in student_form_records as jsonb, keyed by the field names the PDF uses. A
-- new form is a row. A changed form is a new version, and old records keep
-- pointing at the version they were completed under, because a signature
-- belongs to the wording that was on the screen when it was signed.
--
-- EVERY RECORD IS TIED TO A STUDENT
-- ---------------------------------
-- student_id is NOT NULL and references the permanent register. That is the
-- whole point: searching a name or a DJSTA number has to return every form
-- that person has ever completed, which only works if a form cannot exist
-- without belonging to somebody. There is no "unassigned form" state and no
-- way to create one.
--
-- WHAT IS NOT A FORM
-- ------------------
-- Three of the seventeen are not things anybody fills in, and saying so in the
-- data stops somebody building a screen for them:
--
--   00 is computed. The completion checklist is a view of the other records,
--      never an input — a checklist you can tick independently of the thing it
--      tracks is a checklist that lies.
--   11 is the State Police's. S.P. 182 is linked, never reproduced, for the
--      same reason 0010 refuses to host copies of agency forms.
--   14 is a specification. The data dictionary describes the schema; it is
--      read by whoever extends it, not completed by a student.
-- ===========================================================================

-- What the form is for, which decides whether it gets a screen and whose.
do $$ begin
  create type public.packet_form_kind as enum (
    -- Filled in by a person and stored as a record against a student.
    'record',
    -- Filled in and signed. Produces a signature and a frozen copy of the text.
    'signed_document',
    -- Computed from other records. Never an input.
    'derived',
    -- Hosted by an outside agency. A link and a completion tick, nothing more.
    'external',
    -- Describes the system rather than a student. Reference only.
    'specification',
    -- Stamped and issued to the student, not collected from them.
    'output_template'
  );
exception when duplicate_object then null;
end $$;

-- Who is expected to complete it. Drives which screen it appears on.
do $$ begin
  create type public.packet_filled_by as enum ('student', 'instructor', 'system');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.packet_record_status as enum (
    'not_started', 'in_progress', 'submitted', 'accepted', 'rejected'
  );
exception when duplicate_object then null;
end $$;

-- --- The catalogue ---------------------------------------------------------
create table if not exists public.packet_forms (
  code text primary key check (code ~ '^[0-9]{2}$|^[A-Z][A-Z0-9_]{1,30}$'),

  sequence    integer not null,
  title       text not null,
  -- Why this form exists, in the words the office would use. Shown as help
  -- text, so it has to read as an explanation rather than a label.
  purpose     text not null,
  kind        public.packet_form_kind not null,
  filled_by   public.packet_filled_by not null,
  -- What it becomes in the system, from §9 of the implementation prompt. Kept
  -- with the row so the mapping survives the document.
  becomes     text,

  -- The file in docs/forms this row was taken from. Not a URL: these are not
  -- served to anybody, they are the reference the screens were built from.
  source_file text,
  -- Only for 'external'. The agency's own page, constrained to http(s) the way
  -- required_forms.source_url is, so a javascript: URL can never reach a href.
  external_url text check (external_url is null or external_url ~* '^https?://'),

  requires_signature boolean not null default false,
  -- Some forms are completed once per student ever (identification); others
  -- once per course session (qualification score). Getting this wrong is how a
  -- student's first waiver gets treated as covering every later class.
  once_per_session   boolean not null default false,
  -- Instructor-only forms never appear in anything student-facing.
  student_visible    boolean not null default true,

  -- Bumped when the wording changes. Records keep the version they were
  -- completed under.
  version     integer not null default 1,
  active      boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists packet_forms_sequence_idx on public.packet_forms (sequence);

drop trigger if exists packet_forms_touch on public.packet_forms;
create trigger packet_forms_touch
  before update on public.packet_forms
  for each row execute function app.touch_updated_at();

-- --- The records -----------------------------------------------------------
create table if not exists public.student_form_records (
  id uuid primary key default uuid_generate_v4(),

  -- NOT NULL on purpose. A form that belongs to nobody cannot be found by the
  -- search this table exists to serve.
  student_id uuid not null references public.students (id) on delete restrict,
  form_code  text not null references public.packet_forms (code) on delete restrict,

  -- The wording that was on screen when it was completed. A later revision of
  -- the form must never change what somebody is recorded as having agreed to.
  form_version integer not null default 1,

  -- The answers, keyed by the field names the PDF uses. jsonb rather than
  -- columns because the forms change faster than a schema can be redeployed —
  -- see the header.
  answers jsonb not null default '{}'::jsonb,

  status public.packet_record_status not null default 'not_started',

  -- Signature, when the form takes one. The image lives in the private
  -- signatures bucket; this is its path plus what was true at signing.
  signature_path text,
  signed_at      timestamptz,
  signed_name    text,

  -- Instructor sign-off, which is separate from the student's signature. Form
  -- 03 needs both: the student answers, the instructor reviews.
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  completed_by uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists student_form_records_student_idx
  on public.student_form_records (student_id, form_code);
create index if not exists student_form_records_status_idx
  on public.student_form_records (status) where status <> 'accepted';

drop trigger if exists student_form_records_touch on public.student_form_records;
create trigger student_form_records_touch
  before update on public.student_form_records
  for each row execute function app.touch_updated_at();

-- --- Row level security ----------------------------------------------------
alter table public.packet_forms         enable row level security;
alter table public.student_form_records enable row level security;

-- The catalogue is readable by any signed-in member of staff: it is a list of
-- form names, not anybody's data.
drop policy if exists "packet forms readable" on public.packet_forms;
create policy "packet forms readable"
  on public.packet_forms for select
  using (app.has_permission('student.read'));

drop policy if exists "packet forms writable" on public.packet_forms;
create policy "packet forms writable"
  on public.packet_forms for all
  using (app.has_permission('page.write')) with check (app.has_permission('page.write'));

-- The records are a student's training file. Same permission as the student
-- record itself, because they are the same sensitivity.
drop policy if exists "student form records readable" on public.student_form_records;
create policy "student form records readable"
  on public.student_form_records for select
  using (app.has_permission('student.read'));

drop policy if exists "student form records writable" on public.student_form_records;
create policy "student form records writable"
  on public.student_form_records for all
  using (app.has_permission('student.write'))
  with check (app.has_permission('student.write'));

-- No anon policy anywhere. The public intake flow reaches these through a
-- server-side handler holding the service role key, never from a browser.

-- --- The packet ------------------------------------------------------------
-- Seeded from the PDFs in docs/forms. Re-runnable: the wording is updated in
-- place so correcting a purpose does not need a new migration.
insert into public.packet_forms
  (code, sequence, title, purpose, kind, filled_by, becomes, source_file,
   external_url, requires_signature, once_per_session, student_visible)
values
  ('00', 0, 'Packet Control & Completion Checklist',
   'Tracks whether the rest of the packet is finished. Computed from the other records rather than ticked by hand — a checklist you can tick independently of the thing it tracks is a checklist that lies.',
   'derived', 'system', 'A live progress panel on the student record', '00_Packet_Control_and_Completion_Checklist.pdf',
   null, false, false, false),

  ('01', 1, 'Student Identification & Contact Information',
   'Establishes who the student is and how to reach them. This is the form that mints the permanent DJSTA number, which is why it is completed once and never again.',
   'record', 'student', 'The students table', '01_Student_Identification_and_Contact_Information.pdf',
   null, false, false, true),

  ('02', 2, 'Course Enrollment & Prior Training',
   'What they are enrolling in and what they have done before. Prior training changes how an instructor plans the day, so it is collected before the class rather than discovered during it.',
   'record', 'student', 'Enrollment record against the session', '02_Course_Enrollment_and_Prior_Training.pdf',
   null, false, true, true),

  ('03', 3, 'Training Eligibility & Safety Screening',
   'Ten yes/no questions about fitness to handle a firearm safely today. A yes, a refusal or any uncertainty requires instructor review before live fire — the student answers, the instructor signs off, and both are recorded.',
   'signed_document', 'student', 'Screening record plus instructor disposition', '03_Training_Eligibility_and_Safety_Screening.pdf',
   null, true, true, true),

  ('04', 4, 'Firearm, Ammunition & Equipment Record',
   'What the student brought and whether it passed inspection. Serial numbers are recorded as the last four only — enough to identify the firearm in a record, not enough to be worth stealing.',
   'record', 'instructor', 'Equipment record against the session', '04_Firearm_Ammunition_and_Equipment_Record.pdf',
   null, false, true, false),

  ('05', 5, 'Range Safety Rules & Student Acknowledgment',
   'The twelve range rules, initialled line by line. Initialling each rule rather than signing once at the bottom is deliberate: it is the difference between having read them and having signed a page.',
   'signed_document', 'student', 'Signed document, template key range_rules', '05_Range_Safety_Rules_and_Student_Acknowledgment.pdf',
   null, true, true, true),

  ('06', 6, 'Liability Waiver, Assumption of Risk & Release',
   'The release the student signs before live fire, including the guardian branch for under-18s. Its wording is never paraphrased and never edited outside a review by the academy''s attorney.',
   'signed_document', 'student', 'Signed document, template key liability_waiver', '06_Liability_Waiver_Assumption_of_Risk_and_Release.pdf',
   null, true, true, true),

  ('07', 7, 'Student Agreement, Conduct, Privacy & Media',
   'Conduct expectations plus the media opt-in. The media consent is separable because somebody can agree to the conduct rules and still decline to be photographed.',
   'signed_document', 'student', 'Signed document, template key student_agreement', '07_Student_Agreement_Conduct_Privacy_and_Media.pdf',
   null, true, true, true),

  ('08', 8, 'Classroom & Use-of-Force Practical Attendance',
   'The attendance roster, DJSTA-STD-003. Students check themselves in; the instructor''s certification signature is what turns those scans into an official record.',
   'record', 'instructor', 'session_checkins plus the certified roster PDF', '08_Classroom_Use_of_Force_and_Practical_Attendance_Record.pdf',
   null, true, true, false),

  ('09', 9, 'Live-Fire Qualification & Skills Evaluation',
   'The score. Recorded by the instructor, and the thing a certificate depends on for any course that requires a pass.',
   'record', 'instructor', 'Score and pass/fail on the check-in row', '09_Live_Fire_Qualification_and_Skills_Evaluation.pdf',
   null, false, true, false),

  ('10', 10, 'Target & Evidence Control Sheet',
   'Which target belongs to which qualification, so a score can still be evidenced years later when the paper target is long gone.',
   'record', 'instructor', 'Evidence record plus target photo', '10_Target_and_Evidence_Control_Sheet.pdf',
   null, false, true, false),

  ('11', 11, 'Official NJSP S.P. 182 — Safe Handling & Proficiency Certification',
   'A New Jersey State Police form. The academy links to it and records that it was completed; it is never regenerated, restyled or pre-filled, because a recreated government form that looks official and is a revision behind is worse than no form at all. Completed only after a successful qualification.',
   'external', 'instructor', 'A required_forms link plus a completion tick', '11_Official_NJSP_SP_182_Safe_Handling_and_Proficiency_Certification.pdf',
   'https://www.nj.gov/njsp/firearms/', false, true, true),

  ('12', 12, 'Certification, Record Closeout & Renewal Index',
   'What was issued and when it expires. Written by the system at the moment a certificate is issued, so the renewal date can never disagree with the certificate.',
   'derived', 'system', 'The certificates table plus renewal dates', '12_Certification_Record_Closeout_and_Renewal_Index.pdf',
   null, false, false, true),

  ('13', 13, 'Instructor Confidential Notes',
   'The instructor''s observations. Restricted to its author and to owners and administrators, never exported and never shown to the student — and labelled in the interface as part of the training record rather than a private space, because it is discoverable.',
   'record', 'instructor', 'Restricted notes on the session', '13_Instructor_Confidential_Notes.pdf',
   null, false, true, false),

  ('14', 14, 'Automation & Searchable Record Data Dictionary',
   'The specification the schema is reconciled against. Reference for whoever extends the system; not a form anybody completes.',
   'specification', 'system', 'Informs the schema', '14_Automation_and_Searchable_Record_Data_Dictionary.pdf',
   null, false, false, false),

  ('CERTIFICATE', 20, 'Certificate of Completion template',
   'The certificate stamped with pdf-lib at issue. An output, not an input: the student receives it rather than filling it in. Must also be uploaded to the private pdf-templates bucket, because the Worker cannot read the repository at runtime.',
   'output_template', 'system', 'The issued certificate PDF', 'DJSTA_Certificate_of_Completion_TEMPLATE.pdf',
   null, false, false, true),

  ('ROSTER', 21, 'Classroom Attendance Roster template (DJSTA-STD-003)',
   'The roster generated when an instructor certifies a session. Also an output, and also needed in the pdf-templates bucket at runtime.',
   'output_template', 'system', 'The certified roster PDF', 'DJSTA_Classroom_Attendance_Roster.pdf',
   null, false, true, false)

on conflict (code) do update set
  sequence           = excluded.sequence,
  title              = excluded.title,
  purpose            = excluded.purpose,
  kind               = excluded.kind,
  filled_by          = excluded.filled_by,
  becomes            = excluded.becomes,
  source_file        = excluded.source_file,
  external_url       = excluded.external_url,
  requires_signature = excluded.requires_signature,
  once_per_session   = excluded.once_per_session,
  student_visible    = excluded.student_visible;
