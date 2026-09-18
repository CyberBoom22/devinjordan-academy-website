-- ===========================================================================
-- 0016 — Packet form fields
--
-- 0014 said what each of the seventeen forms IS. This says what is ON them:
-- every question, in the order the PDF asks it, with the exact label the paper
-- uses.
--
-- WHY THE LABELS ARE COPIED VERBATIM
-- ----------------------------------
-- These are the words a student reads before they initial a range rule or sign
-- a waiver. A paraphrase that means the same thing to a developer does not mean
-- the same thing to a court, and a screen that asks a subtly different question
-- from the paper record it replaces produces a file where the signature and the
-- question do not match. So the label text here is lifted from the PDF and is
-- not somebody's summary of it. Changing one is a migration, reviewed the way
-- the paper was reviewed.
--
-- WHY FIELDS ARE ROWS AND ANSWERS ARE JSONB
-- -----------------------------------------
-- The pairing matters. Fields as rows means a screen can render a form it has
-- never seen, and adding a screening question after an incident is an INSERT
-- rather than a schema change, a deploy and a form component. Answers as jsonb
-- keyed by field_key means the answer travels with the question's name rather
-- than a column position, so reordering the form does not silently re-attribute
-- what somebody said.
--
-- The cost is that the database cannot enforce "this answer is an integer" —
-- so the handler validates against this table before writing, and required and
-- the type column exist to make that possible rather than as decoration.
--
-- NOTE ON FORM 11
-- ---------------
-- The NJSP source URL is corrected here to the fillable PDF the packet itself
-- cites, rather than the department's index page. Still a link and still never
-- hosted, but the link now lands where the instructor actually needs to be.
-- ===========================================================================

do $$ begin
  create type public.packet_field_type as enum (
    'text',        -- one line
    'textarea',    -- several
    'date',
    'number',
    'boolean',     -- a single tick
    'choice',      -- one of options
    'multi',       -- any of options
    'initials',    -- a rule acknowledged individually
    'signature',
    'heading'      -- not an input; a section break in the rendered form
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.packet_form_fields (
  id uuid primary key default uuid_generate_v4(),

  form_code text not null references public.packet_forms (code) on delete cascade,
  -- Stable key the answers are stored under. Renaming one orphans an answer,
  -- which is why it is snake_case and boring rather than derived from a label.
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,60}$'),

  sequence integer not null,
  -- Verbatim from the PDF. See the header.
  label    text not null,
  help     text,
  type     public.packet_field_type not null,
  -- For choice and multi. Null otherwise.
  options  text[],
  required boolean not null default false,
  -- Groups fields under a sub-heading when the form has sections.
  section  text,

  created_at timestamptz not null default now(),

  unique (form_code, field_key)
);

create index if not exists packet_form_fields_form_idx
  on public.packet_form_fields (form_code, sequence);

alter table public.packet_form_fields enable row level security;

drop policy if exists "packet fields readable" on public.packet_form_fields;
create policy "packet fields readable"
  on public.packet_form_fields for select
  using (app.has_permission('student.read'));

drop policy if exists "packet fields writable" on public.packet_form_fields;
create policy "packet fields writable"
  on public.packet_form_fields for all
  using (app.has_permission('page.write')) with check (app.has_permission('page.write'));

-- --- Records gain a session --------------------------------------------------
-- Forms flagged once_per_session need to say which session. Nullable because
-- the once-per-student forms (identification) legitimately have none, and a
-- NOT NULL here would force a fake session onto them.
alter table public.student_form_records
  add column if not exists session_id uuid references public.course_sessions (id) on delete set null;

create index if not exists student_form_records_session_idx
  on public.student_form_records (session_id) where session_id is not null;

-- One record per student per form per session. Postgres treats NULLs as
-- distinct in a unique index, so the once-per-student forms need their own
-- partial index to be constrained at all.
create unique index if not exists student_form_records_per_session_idx
  on public.student_form_records (student_id, form_code, session_id)
  where session_id is not null;

create unique index if not exists student_form_records_per_student_idx
  on public.student_form_records (student_id, form_code)
  where session_id is null;

-- --- Correct form 11's link --------------------------------------------------
update public.packet_forms
set external_url = 'https://www.nj.gov/njsp/firearms/pdf/PTC_Safe_Handling_and_Proficiency_Certificate_Fillable.pdf'
where code = '11';

-- --- The fields --------------------------------------------------------------
-- Re-runnable: labels update in place, so fixing wording does not need a new
-- migration file.
insert into public.packet_form_fields
  (form_code, field_key, sequence, label, help, type, options, required, section)
values
  -- 02 — Course Enrollment & Prior Training
  ('02','course_program',1,'Course / Program',null,'choice',
    array['NJ PTC Qualification','CCARE / Safe Handling','Basic Pistol','NRA CCW','Private Instruction','Other'],true,null),
  ('02','course_other',2,'If other, which course?',null,'text',null,false,null),
  ('02','application_type',3,'Application Type',null,'choice',
    array['Initial','Renewal','Practice Only','Remediation'],true,null),
  ('02','previous_training',4,'Previous Formal Training','Provider / course / approximate date.','textarea',null,false,null),
  ('02','experience_level',5,'Experience Level',null,'choice',
    array['New','Limited','Intermediate','Advanced','LE / Military'],true,null),
  ('02','primary_hand',6,'Primary Hand',null,'choice',array['Right','Left','Ambidextrous'],false,null),
  ('02','dominant_eye',7,'Dominant Eye',null,'choice',array['Right','Left','Unknown'],false,null),
  ('02','accommodation',8,'Accommodation Requested',null,'choice',
    array['None','Hearing','Vision','Mobility','Language','Other'],false,null),
  ('02','accommodation_detail',9,'Accommodation detail',
    'Explain only what the instructor needs in order to provide training safely.','textarea',null,false,null),
  ('02','student_objective',10,'Student Objective',null,'textarea',null,false,null),

  -- 03 — Training Eligibility & Safety Screening. Ten questions, verbatim.
  ('03','q1',1,'Are you attending under your true legal identity and completing this packet for yourself?',null,'boolean',null,true,'Screening'),
  ('03','q2',2,'Are you currently impaired by alcohol, cannabis, an illegal drug, a medication, fatigue, or any condition that could make firearm handling unsafe?',null,'boolean',null,true,'Screening'),
  ('03','q3',3,'Are you presently experiencing a medical, emotional, or physical condition that may prevent you from safely following commands or handling a firearm?',null,'boolean',null,true,'Screening'),
  ('03','q4',4,'Have you been instructed by a court, law-enforcement agency, medical provider, or other lawful authority not to possess, handle, or access firearms?',null,'boolean',null,true,'Screening'),
  ('03','q5',5,'Are you aware of any current restraining order, protective order, criminal charge, conviction, juvenile matter, mental-health commitment, immigration restriction, or other circumstance that may affect your lawful ability to possess or carry a firearm?',null,'boolean',null,true,'Screening'),
  ('03','q6',6,'Are you bringing any firearm, ammunition, magazine, holster, or equipment that you do not lawfully own, possess, or have permission to use?',null,'boolean',null,true,'Screening'),
  ('03','q7',7,'Is any firearm you are bringing loaded outside the location and manner specifically authorized by the range and instructor?',null,'boolean',null,true,'Screening'),
  ('03','q8',8,'Have you ever had an accidental or negligent discharge, serious range-rule violation, or firearm-related injury that the instructor should understand for safety planning?',null,'boolean',null,true,'Screening'),
  ('03','q9',9,'Do you understand that passing a training course does not itself grant a permit, license, or legal authority to carry a firearm?',null,'boolean',null,true,'Screening'),
  ('03','q10',10,'Do you agree to immediately stop handling firearms and notify the instructor if your condition, equipment, or legal status changes during training?',null,'boolean',null,true,'Screening'),
  ('03','disposition',11,'Instructor review / disposition',null,'choice',
    array['Cleared','Training restricted','Live fire deferred','Referred for legal/medical clarification'],false,'Instructor review'),
  ('03','disposition_notes',12,'Notes',null,'textarea',null,false,'Instructor review'),
  ('03','student_signature',13,'Student certification',null,'signature',null,true,'Signatures'),
  ('03','instructor_signature',14,'Instructor review',null,'signature',null,false,'Signatures'),

  -- 04 — Firearm, Ammunition & Equipment Record
  ('04','firearms',1,'Firearms presented','Make, model, calibre, last four of the serial, sights and inspection result for each.','textarea',null,true,null),
  ('04','holster_checks',2,'Holster inspection',null,'multi',
    array['Trigger fully covered','Secure retention','Correct belt attachment','Proper orientation','No unsafe modification'],false,null),
  ('04','ammo_brand',3,'Ammunition brand',null,'text',null,false,'Ammunition'),
  ('04','ammo_type',4,'Ammunition type',null,'text',null,false,'Ammunition'),
  ('04','ammo_lot',5,'Lot (optional)',null,'text',null,false,'Ammunition'),
  ('04','factory_required',6,'Factory ammunition required by range?',null,'boolean',null,false,'Ammunition'),
  ('04','equipment_concerns',7,'Equipment concerns / corrections',null,'textarea',null,false,null),

  -- 05 — Range Safety Rules. Initialled one by one, on purpose.
  ('05','rule_01',1,'Treat every firearm as though it is loaded.',null,'initials',null,true,null),
  ('05','rule_02',2,'Keep the muzzle pointed in a safe direction at all times.',null,'initials',null,true,null),
  ('05','rule_03',3,'Keep your finger straight and outside the trigger guard until sights are on target and the decision to fire has been made.',null,'initials',null,true,null),
  ('05','rule_04',4,'Know the target, its surroundings, and the backstop.',null,'initials',null,true,null),
  ('05','rule_05',5,'Eye and hearing protection must remain in place as directed.',null,'initials',null,true,null),
  ('05','rule_06',6,'Firearms may be handled only on command and only in designated areas.',null,'initials',null,true,null),
  ('05','rule_07',7,'Immediately obey "CEASE FIRE," "STOP," or any instructor/range command.',null,'initials',null,true,null),
  ('05','rule_08',8,'Do not attempt to catch a dropped firearm. Step away and notify the instructor.',null,'initials',null,true,null),
  ('05','rule_09',9,'For a malfunction, keep the muzzle safely oriented, finger off trigger, and follow instructor direction.',null,'initials',null,true,null),
  ('05','rule_10',10,'No alcohol, illegal drugs, impairment, horseplay, threats, intimidation, or unauthorized recording.',null,'initials',null,true,null),
  ('05','rule_11',11,'Do not leave the firing line with a firearm until cleared by an instructor.',null,'initials',null,true,null),
  ('05','rule_12',12,'Report any injury, equipment damage, unsafe condition, or possible rule violation immediately.',null,'initials',null,true,null),
  ('05','student_signature',13,'Student',null,'signature',null,true,'Signatures'),
  ('05','witness_signature',14,'Instructor / witness',null,'signature',null,false,'Signatures'),

  -- 06 — Liability Waiver. The body text is the document, not a field; what is
  -- captured is the age branch and the signatures.
  ('06','age_bracket',1,'Participant is',null,'choice',
    array['18 or older','Under 18 (parent/legal guardian must sign and range policy must permit participation)'],true,null),
  ('06','participant_signature',2,'Participant',null,'signature',null,true,'Signatures'),
  ('06','guardian_signature',3,'Parent / legal guardian (if applicable)',null,'signature',null,false,'Signatures'),
  ('06','witness_signature',4,'DJSTA witness / instructor',null,'signature',null,false,'Signatures'),
  ('06','printed_name',5,'Printed name of participant',null,'text',null,true,'Signatures'),

  -- 07 — Student Agreement, Conduct, Privacy & Media
  ('07','conduct_01',1,'I will act professionally and will not threaten, harass, intimidate, or endanger another person.',null,'initials',null,true,null),
  ('07','conduct_02',2,'I understand DJSTA may suspend or dismiss me for unsafe conduct, dishonesty, impairment, failure to follow commands, or disruptive behavior.',null,'initials',null,true,null),
  ('07','conduct_03',3,'I understand completion, attendance, or payment does not guarantee a passing score or issuance of any permit.',null,'initials',null,true,null),
  ('07','conduct_04',4,'I authorize DJSTA to retain this packet, scores, certificates, and necessary identity/contact data for training administration and future record retrieval.',null,'initials',null,true,null),
  ('07','conduct_05',5,'I will promptly notify DJSTA of corrections to my legal name, contact information, or student record.',null,'initials',null,true,null),
  ('07','media_choice',6,'Photo/video choice',
    'Separable from the conduct rules: somebody can agree to those and still decline to be photographed.','choice',
    array['I consent to instructional/marketing use','Internal training documentation only','No photography except target/record evidence'],true,null),
  ('07','student_signature',7,'Student',null,'signature',null,true,'Signatures'),
  ('07','representative_signature',8,'DJSTA representative',null,'signature',null,false,'Signatures'),

  -- 08 — Attendance. The roster itself is session_checkins; this is the
  -- content-covered checklist the instructor ticks.
  ('08','content_covered',1,'Required content / practical skills observed',null,'multi',
    array['Firearm safety rules','Safe loading / unloading','Malfunction response','Holster presentation and reholstering','Storage / transport considerations','Current NJ use-of-force instruction required for course','De-escalation / avoidance principles','Emergency and post-incident considerations'],false,null),

  -- 09 — Live-Fire Qualification & Skills Evaluation
  ('09','protocol',1,'Protocol / Course of Fire',null,'text',null,true,null),
  ('09','target_type',2,'Target Type / ID',null,'text',null,false,null),
  ('09','qualified_at',3,'Qualification Date / Time',null,'date',null,true,null),
  ('09','range_lane',4,'Range / Lane',null,'text',null,false,null),
  ('09','conditions',5,'Weather / Conditions (if applicable)',null,'text',null,false,null),
  ('09','stages',6,'Stages','Distance, rounds, drill, time limit, hits and possible for each stage.','textarea',null,false,null),
  ('09','total_score',7,'Total Score',null,'number',null,true,'Result'),
  ('09','total_possible',8,'Possible',null,'number',null,true,'Result'),
  ('09','required_minimum',9,'Required Minimum',null,'number',null,false,'Result'),
  ('09','overall_result',10,'Overall result',null,'choice',
    array['PASS','FAIL','INCOMPLETE','REMEDIATION REQUIRED'],true,'Result'),
  ('09','safe_handling_eval',11,'Safe-handling evaluation',null,'choice',array['Pass','Fail'],false,'Result'),
  ('09','holster_eval',12,'Holster evaluation',null,'choice',array['Pass','Fail'],false,'Result'),
  ('09','malfunction_eval',13,'Malfunction drill',null,'choice',array['Pass','Fail'],false,'Result'),
  ('09','observations',14,'Instructor observations / remediation',null,'textarea',null,false,null),
  ('09','student_ack_signature',15,'Student acknowledgment of result',null,'signature',null,false,'Signatures'),
  ('09','instructor_signature',16,'Certifying instructor',null,'signature',null,true,'Signatures'),

  -- 10 — Target & Evidence Control Sheet
  ('10','target_id',1,'Target ID / Barcode',null,'text',null,true,null),
  ('10','photo_filename',2,'Photo Filename',null,'text',null,false,null),
  ('10','original_target',3,'Original Target',null,'choice',
    array['Returned to student','Retained','Destroyed after image capture'],true,null),
  ('10','witness',4,'Witness / Verifier',null,'text',null,false,null),

  -- 11 — S.P. 182. Never reproduced; this records that the real one was done.
  ('11','attached',1,'S.P. 182 attached',null,'boolean',null,true,null),
  ('11','not_attached_reason',2,'If not, reason',null,'text',null,false,null),
  ('11','form_revision',3,'Form Revision',
    'Check the revision against the NJSP page before every class. Do not rely on an older local copy.','text',null,true,null),
  ('11','date_signed',4,'Date Signed',null,'date',null,false,null),
  ('11','credential_copy',5,'Instructor Credential Copy',null,'choice',
    array['Attached','Master credential file reference'],false,null),
  ('11','student_copy_delivered',6,'Student Copy Delivered',null,'choice',
    array['Paper','Secure electronic copy'],false,null),

  -- 13 — Instructor Confidential Notes
  ('13','notes',1,'Instructor notes',
    'Objective, factual language. Record observable performance, remediation provided and administrative follow-up. Avoid unsupported diagnoses, conclusions about legal eligibility, or unnecessary sensitive personal information.','textarea',null,true,null)

on conflict (form_code, field_key) do update set
  sequence = excluded.sequence,
  label    = excluded.label,
  help     = excluded.help,
  type     = excluded.type,
  options  = excluded.options,
  required = excluded.required,
  section  = excluded.section;
