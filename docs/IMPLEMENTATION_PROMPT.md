# Claude Code Prompt — Check-In & Certificate Issuance

**Repo:** `CyberBoom22/devinjordan-academy-website` · Astro 5 (SSR) · Cloudflare Workers · Supabase · TypeScript

> Save as `docs/IMPLEMENTATION_PROMPT.md`, commit it, then start Claude Code with:
> _"Read docs/IMPLEMENTATION_PROMPT.md. Confirm the constraints in §2 still hold, then begin Phase 1."_

---

## 1. What exists already — read these before writing anything

Do not invent parallel systems. Everything below is already built and must be reused:

| Concern                            | Where it lives                                                                       | How to use it                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Permission registry                | `src/lib/auth/permissions.ts`                                                        | **Source of truth.** Add new keys here, then `npm run db:permissions` and paste the SQL into the new migration |
| Session + permission check         | `src/lib/auth/session.ts`                                                            | `can(session, 'key')`, `canAny()`, `outranks()` — synchronous, resolved once in middleware                     |
| Admin guard, 2FA, security headers | `src/middleware.ts`                                                                  | Guards `/admin/*` automatically. New admin pages are protected the moment they exist                           |
| DB authorisation                   | `app.has_permission(key)` in `0001_rbac.sql`                                         | Every RLS policy calls it. Never write a role-name check in a policy                                           |
| Audit trail                        | `public.audit_log` + `app.record_audit(action, entity, entity_id, summary, details)` | Call it for every issue, void, certify                                                                         |
| Per-person exceptions              | `public.user_permissions` (grant/deny, `reason` required)                            | This is how one instructor gets certificate issuing without becoming an admin — no new mechanism needed        |
| Courses                            | `public.courses` (0002_content.sql)                                                  | **Extend with ALTER TABLE.** Do not create a second courses table                                              |
| Instructors                        | `public.instructors` + `instructor_records`                                          | Session instructor and certificate signatory reference this                                                    |
| Email                              | `src/lib/email/send.ts` — `getMailConfig(runtimeEnv)`, `sendEmail(envelope, config)` | Returns results, never throws. Follow that contract                                                            |
| Invite email as a template example | `src/lib/email/invite.ts`                                                            | Match its html+text shape                                                                                      |
| CSRF for unauthenticated forms     | `src/lib/csrf.ts`                                                                    | See the required change in §2.4                                                                                |
| Design tokens                      | `src/styles/tokens.css`                                                              | `--primary: #9b1b1b`, `--accent: #c5a059`, surfaces, status palette                                            |
| Supabase clients                   | `src/lib/supabase/server.ts`, `browser.ts`, `env.ts`                                 | `Astro.locals.supabase` is already request-scoped                                                              |
| Generated DB types                 | `src/lib/supabase/database.types.ts`                                                 | Regenerate with `npm run db:types` after each migration                                                        |

Last migration is `0011_invite_delivery.sql`. **New migrations start at `0012`.**

Before Phase 1, print a one-page summary of: the `courses` table columns, the RLS policy style used in `0002_content.sql`, and the POST-handling pattern in `src/pages/admin/forms.astro`. Then follow those patterns exactly.

---

## 2. Hard constraints of this deployment — these kill the obvious approaches

### 2.1 No headless browser. PDFs must be made with `pdf-lib`.

This runs on Cloudflare Workers. Puppeteer, Playwright, `@sparticuz/chromium`, and any HTML→PDF service are **not available**. `nodejs_compat` is on but there is no filesystem and no subprocess.

Use **`pdf-lib`** (pure JS, Workers-compatible) plus **`@pdf-lib/fontkit`** if a brand font is needed:

- Store `DJSTA_Certificate_of_Completion_TEMPLATE.pdf` and a generated `DJSTA-STD-003_roster_template.pdf` in a **private Supabase Storage bucket** named `pdf-templates`.
- Load the template with `PDFDocument.load()`, stamp text at measured coordinates, save, upload the result. Do not re-draw the design from scratch — the border, logo and typography come from the template.
- Build a small coordinate map in `src/lib/pdf/certificate-layout.ts` with a comment explaining how each Y value was measured, because the next person to nudge a field will have no other way to know.
- Long names must shrink to fit: measure with `font.widthOfTextAtSize()` and step the size down until it fits the box, rather than overflowing the border.

### 2.2 CSP is `script-src 'self'` with no `'unsafe-inline'` in production.

(`src/lib/security.ts`.) Consequences:

- **No CDN scripts. No inline `<script>` blocks.** Client JS goes in `src/scripts/*.ts` and is imported by the component, matching `src/scripts/ori.ts` and `news.ts`.
- **QR codes are generated server-side as SVG** and rendered inline in the markup. Use the `qrcode` npm package's `toString(text, { type: 'svg' })` on the server. Never a QR image API.
- `img-src 'self' data:` — data URIs are allowed if you prefer a data-URI `<img>` over inline SVG.
- Astro `<style>` blocks are fine (they compile to external stylesheets; `inlineStylesheets: 'never'` is already set).
- `connect-src` already permits the Supabase origin over https and wss, so Realtime works without touching the CSP.

### 2.3 `Permissions-Policy: geolocation=()` blocks location entirely.

Do not build geofenced check-in. The header disables the API site-wide, and weakening it for one route is not worth it — a student with a bad GPS fix being locked out of their own class is a worse failure than a student checking in from the parking lot. Use the rotating token in §7 instead.

### 2.4 `src/lib/csrf.ts` is scoped to `PATH = '/admin'`.

The public check-in form is an unauthenticated POST, which is exactly what that module exists for — but its cookie path won't reach `/check-in`. Refactor `issueCsrfToken(cookies, url)` and `csrfValid(cookies, submitted)` to take an explicit path (`'/admin'` or `'/check-in'`) with separate cookie names, keeping the constant-time compare and the reuse-don't-rotate behaviour. Update the existing login/register callers in the same commit.

### 2.5 `MAX_SESSION_HOURS = 2` will sign the instructor out mid-class.

An 8-hour PTC qualification day outlives the admin session, and the projector view bouncing to a 2FA prompt in front of a room of students is not acceptable. **Do not raise the global cap** — it exists for good reason.

Instead: the live projector view lives **outside `/admin`**, at `/session/[presenterToken]`, where `presenterToken` is a high-entropy token minted from the admin UI when the session opens, stored on `course_sessions`, valid only between `checkin_opens_at` and `checkin_closes_at + 2h`, and revocable with one click. That page is read-only — it shows the QR and the live roster and nothing else. Every state-changing action (verify, certify, score, issue) stays behind `/admin` with the full guard, where a re-auth is merely mildly annoying.

Add `/session/`, `/check-in/` and `/verify/` to the sitemap filter exclusion in `astro.config.mjs` alongside `/admin`.

### 2.6 2FA is mandatory for every admin account.

Instructors who will run sessions need TOTP enrolled before their first class. Add a line about this to the invite email copy and flag it in the Phase 1 report.

---

## 3. Permissions to add — `src/lib/auth/permissions.ts`

Append two groups, matching the existing `PermissionDef` shape and the house commenting style. Then run `npm run db:permissions` and paste its output into `0012`.

```
/* --- Training sessions -------------------------------------------------- */
'session.read'      → ALL_STAFF
'session.write'     → owner, admin, editor, instructor      // Create and run sessions
'session.manage'    → owner, admin        // Edit or delete another instructor's session
'session.certify'   → owner, admin, instructor
   // Signs the roster. This is the signature that turns self-reported scans into
   // an official DJSTA-STD-003 record, so it is deliberately not given to editors.
'attendance.verify' → owner, admin, instructor
'student.read'      → ALL_STAFF
'student.write'     → owner, admin, instructor
'student.merge'     → owner, admin        // Merging duplicate permanent student numbers

/* --- Certificates ------------------------------------------------------- */
'certificate.read'   → ALL_STAFF
'certificate.issue'  → owner, admin ONLY
   // A certificate is a credential. Instructors are given this one at a time via a
   // user_permissions grant with a written reason, not by default and not by role.
'certificate.void'   → owner, admin
'certificate.resend' → owner, admin, instructor

/* --- Packet documents (§9) ---------------------------------------------- */
'document.manage'    → owner, admin
   // Writes a new version of a waiver or agreement. New wording is a new version,
   // never an edit, so this permission changes what future students sign and
   // nothing about what past students already signed.
'document.read'      → ALL_STAFF
'instructor.notes'   → owner, admin      // Reading another instructor's confidential notes
```

`certificate.issue` must be checked in **three** places: the RLS policy on `certificates`, the server-side handler before the transaction, and the button's visibility. The RLS policy is the boundary; the other two are UX.

---

## 4. Migrations

### `supabase/migrations/0012_training_records.sql`

Follow the file-header comment convention of `0010_required_forms.sql`: explain _why_ the schema insists on what it insists on.

```sql
-- Extend the existing courses table rather than adding a second one.
alter table public.courses
  add column code text unique check (code ~ '^[A-Z][A-Z0-9-]{1,23}$'),   -- CPR-AED, NJ-PTC-QUAL, SORA
  add column default_duration_minutes integer,
  add column requires_score boolean not null default false,
  add column max_score integer,
  add column passing_score integer,
  add column required_content text[] not null default '{}',  -- drives the roster checkbox list
  add column cert_validity_months integer,
  add column issues_certificate boolean not null default true;

create type public.session_status as enum ('draft','open','in_progress','closed','certified');
create type public.checkin_method as enum ('qr_self','instructor_added','late_add');
create type public.checkin_status  as enum ('pending','verified','rejected','no_show','needs_review');

-- students — one permanent record per human, reused across every course they ever take.
-- djsta_student_no is assigned ONCE and never reissued: the whole point of the
-- returning-student lookup in the check-in flow is to stop a second number being
-- minted for someone who already has one.
create table public.students (
  id uuid primary key default uuid_generate_v4(),
  djsta_student_no text not null unique check (djsta_student_no ~ '^DJSTA-[0-9]{4}-[0-9]{6}$'),
  legal_first text not null, legal_middle text, legal_last text not null,
  prior_names text[], dob date not null,
  email text not null, phone text,
  address_line1 text, address_line2 text, city text, state text, zip text,
  emergency_contact jsonb,          -- { name, relationship, phone }
  preferred_contact text check (preferred_contact in ('email','text','phone')),
  photo_id_type text, photo_id_state text, photo_id_last4 text, photo_id_exp date,
  -- No SSNs, no medical detail, no payment data. Those stay on paper in the packet.
  internal_notes text,
  merged_into uuid references public.students (id),   -- duplicate resolution, never a delete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_name_idx on public.students (lower(legal_last), dob);
create index students_email_idx on public.students (lower(email));

create table public.course_sessions (
  id uuid primary key default uuid_generate_v4(),
  course_id uuid not null references public.courses (id),
  instructor_id uuid references public.instructors (id),
  title text not null,                       -- generated, see §5
  title_is_custom boolean not null default false,
  location text not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null check (ends_at > starts_at),
  course_record_id text not null unique,     -- QR-YYYY-######
  checkin_token   text not null unique,      -- in the QR, rotatable
  presenter_token text not null unique,      -- §2.5, opens /session/[token]
  checkin_opens_at timestamptz not null,
  checkin_closes_at timestamptz not null,
  rotate_token boolean not null default false,
  content_covered text[] not null default '{}',
  status public.session_status not null default 'draft',
  certified_by uuid references public.profiles (id),
  certified_at timestamptz,
  instructor_signature_path text,
  roster_pdf_path text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.session_checkins (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.course_sessions (id) on delete cascade,
  student_id uuid not null references public.students (id),
  time_in timestamptz not null default now(),
  time_out timestamptz,
  method public.checkin_method not null default 'qr_self',
  self_attested_name text,     -- what they typed, kept even after matching to a record
  ip inet, user_agent text,
  instructor_initials text,
  status public.checkin_status not null default 'pending',
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  score integer, possible integer,
  score_percent numeric generated always as
    (case when possible > 0 then round(score::numeric * 100 / possible, 1) end) stored,
  passed boolean,
  scored_by uuid references public.profiles (id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)     -- a second scan reopens, never duplicates
);

-- Sequential record numbers, allocated under a row lock so two concurrent
-- issues can never collide or skip. Never compute the next number in TypeScript.
create table public.record_sequences (
  scope text not null, year integer not null, last_value integer not null default 0,
  primary key (scope, year)
);

create or replace function app.next_record_number(p_scope text, p_prefix text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_year integer := extract(year from pg_catalog.now()); v_next integer;
begin
  insert into public.record_sequences (scope, year, last_value) values (p_scope, v_year, 1)
    on conflict (scope, year) do update set last_value = public.record_sequences.last_value + 1
    returning last_value into v_next;
  return p_prefix || '-' || v_year || '-' || lpad(v_next::text, 6, '0');
end; $$;
```

Add `app.touch_updated_at()` triggers on all three tables, enable RLS on all three, and write policies in the `0002_content.sql` style — e.g.:

```sql
create policy "students readable with permission" on public.students
  for select using (app.has_permission('student.read'));
create policy "students writable with permission" on public.students
  for all using (app.has_permission('student.write')) with check (app.has_permission('student.write'));
```

**Anonymous check-in cannot go through RLS.** The public check-in handler runs server-side with the service role key (already a Worker secret) and does its own validation: valid unexpired token, within the window, one row per student per session. Keep that handler in `src/lib/checkin/` and never import it into anything that ships to the browser. `anon` gets **no** policy on `students` or `session_checkins` — verify this with a test.

### `supabase/migrations/0013_certificates.sql`

```sql
create type public.certificate_status as enum ('valid','void','superseded');

create table public.certificates (
  id uuid primary key default uuid_generate_v4(),
  certificate_no text not null unique,          -- DJSTA-CERT-YYYY-######
  student_id uuid not null references public.students (id),
  course_id  uuid not null references public.courses (id),
  session_id uuid not null references public.course_sessions (id),
  -- Snapshots, frozen at issue. A later name change or course rename must never
  -- alter what an already-issued certificate says.
  student_name_snapshot text not null,
  course_name_snapshot  text not null,
  completion_date date not null,
  score integer, possible integer, score_percent numeric,
  certifying_instructor_name text not null,
  academy_signatory_name text not null,
  issued_by uuid not null references public.profiles (id),
  issued_at timestamptz not null default now(),
  pdf_path text,
  verify_slug text not null unique,
  status public.certificate_status not null default 'valid',
  void_reason text, voided_by uuid references public.profiles (id), voided_at timestamptz,
  expires_at date,
  email_sent_at timestamptz, email_message_id text, email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.certificates enable row level security;
create policy "certificates readable with permission" on public.certificates
  for select using (app.has_permission('certificate.read'));
create policy "certificates insertable with issue permission" on public.certificates
  for insert with check (app.has_permission('certificate.issue'));
create policy "certificates voidable with permission" on public.certificates
  for update using (app.has_permission('certificate.void'));
-- No delete policy on purpose. A certificate is never deleted, only voided.
```

Public verification reads through a `security definer` function returning **only** certificate number, student name, course, completion date, issue date, status and academy — never DOB, contact details, address or score.

Storage buckets, all private: `pdf-templates`, `certificates`, `rosters`, `signatures`. Staff downloads use short-lived signed URLs.

---

## 5. Auto-titled sessions

Generated on create from course + start/end, stored in `title` (not computed at render, so historical titles stay stable), overridable, with `title_is_custom` preventing regeneration from clobbering an override.

```
{course.name} — {Weekday}, {Month D, YYYY} · {h:mm A}–{h:mm A} {tz}
```

- `CPR / AED Certification — Saturday, March 14, 2026 · 9:00 AM–1:00 PM EDT`
- `NJ Permit to Carry Qualification — Sunday, April 5, 2026 · 8:00 AM–4:00 PM EDT`

Store UTC, render `America/New_York` via `Intl.DateTimeFormat` — no date library, Workers has full ICU. Put the formatter in `src/lib/format.ts` beside the existing helpers. Multi-day sessions render `{Month D}–{Month D, YYYY}`.

The same title drives the session list, the `/session/[token]` heading, the roster PDF header, the email subject, and the export filename `DJSTA-STD-003_CPR-AED_2026-03-14.pdf`.

---

## 6. Routes

**Admin** (auto-guarded by middleware; each page still calls `can()` and redirects to `/admin?error=forbidden` like `admin/forms.astro` does):

```
src/pages/admin/training/index.astro          Dashboard: today's sessions, awaiting certification, issued this month
src/pages/admin/training/sessions/index.astro List + filters
src/pages/admin/training/sessions/new.astro   Create (course, instructor, location, datetime, content covered)
src/pages/admin/training/sessions/[id].astro  Roster: verify/reject, time-out, initials, scores, Certify
src/pages/admin/training/students/index.astro Search by name, number, email, DOB
src/pages/admin/training/students/[id].astro  Profile, history, certificates, merge duplicates
src/pages/admin/training/certificates/index.astro  Issued list, resend, download, void
src/pages/admin/training/courses/[id].astro   Course training settings (code, scoring, required content)
```

**Public:**

```
src/pages/session/[token].astro       Projector view — QR + live roster, read-only, no admin session (§2.5)
src/pages/check-in/[token].astro      Student self check-in, mobile-first
src/pages/intake/[token].astro        Pre-class packet: enrollment, screening, waivers (§9)
src/pages/verify/[slug].astro         Public certificate verification
src/pages/verify/index.astro          Enter a certificate number
src/pages/me/index.astro              Student portal, Supabase magic link to the email on file
```

Add a "Training" section to the admin nav in `src/components/layout/Nav.astro` and `AdminLayout.astro`, gated on `can(session, 'session.read')`.

---

## 7. Check-in flow

### Projector view — `/session/[presenterToken]`

Full-bleed dark layout on `--bg-dark`. Server-rendered QR as inline SVG, minimum 420px, quiet zone intact, encoding `https://devinjordansecuritytrainingacademy.com/check-in/{checkin_token}`. Beneath it: the URL as readable text and a 6-character backup code, because phones fail and the instructor needs a fallback that isn't "come up to the front."

Live roster via Supabase Realtime on `session_checkins` filtered to this session, using the anon key from the browser plus a `security definer` function that returns **only** first name + last initial + time-in for a valid presenter token. A projected screen is visible to the whole room and to anyone walking past; it must not display DOBs, emails or full student numbers. Fall back to 5s polling if the socket drops.

If `rotate_token` is on, the QR regenerates every 60s from an HMAC of `(checkin_token, 60s bucket)`, accepting the current and previous bucket. That is the answer to a student texting the link to someone at home — not geolocation (§2.3).

### Student page — `/check-in/[token]`

One page, mobile-first at 360px, large tap targets, works on a weak signal. No account.

1. Show session title, instructor, location — so they know they scanned the right class.
2. "Have you trained with DJSTA before?" → Returning / First time.
3. **Returning:** last name + DOB, or their DJSTA number. Matched server-side.
   - One match → masked confirmation ("Is this you? J••• D••, DJSTA-2024-••1847") and one tap to confirm. Never render a full record to an unauthenticated scanner.
   - Zero or multiple matches → **do not guess.** Fall through to registration and set `status = 'needs_review'` so the instructor merges rather than a duplicate number being minted.
4. **First time:** legal first/middle/last, DOB, email, mobile, address, emergency contact, preferred contact. Assign `djsta_student_no` via `app.next_record_number('student','DJSTA')`. One scroll — anything the office can collect later belongs in the paper packet, not here.
5. Confirmation: green check, name, student number, session title, time-in. A **Check Out** button that activates near `ends_at`.
6. A second scan reopens the existing confirmation rather than erroring or duplicating.

Every self-reported row stays `pending`. **The instructor's certification signature, not the scan, is what makes the roster an official record** — that is the design principle behind this whole feature and it should be stated in the file header comment.

Outside the check-in window: a plain "this session is closed, ask your instructor to add you" page.

Rate limit by IP (10 attempts / 10 min) and cap new-student registrations per session. Use a Workers KV namespace or a `checkin_attempts` table; if KV, create the binding in `wrangler.toml` where the commented-out `SESSION` namespace already shows the shape.

### Instructor certification

Signature via a `<canvas>` pad in `src/scripts/signature.ts` (external module — CSP), uploaded to the `signatures` bucket as PNG. Certifying freezes the roster, sets `status = 'certified'`, generates the DJSTA-STD-003 roster PDF into `rosters/`, and calls `app.record_audit('session.certify', 'course_sessions', id, …)`.

---

## 8. Certificate issuance

### Preconditions — all enforced server-side, each with its own error message

1. Caller holds `certificate.issue`.
2. `course_sessions.status = 'certified'`.
3. A `session_checkins` row for that student with `status = 'verified'`.
4. If `courses.requires_score`, `passed = true`.
5. `courses.issues_certificate = true`.
6. No existing `valid` certificate for that (student, session). Re-issue is an explicit supersede that voids the prior one with a reason.
7. Required packet documents are signed and the eligibility screening is cleared (§9): `range_rules`, `liability_waiver` and `student_agreement` each have a `document_signatures` row for this student and session, and the enrollment is not `needs_instructor_review`.

Never partially issue. If PDF generation or upload fails, roll back — a burned certificate number is a permanent gap in a credential series that somebody will have to explain in two years.

### The issue transaction

Allocate `app.next_record_number('certificate','DJSTA-CERT')` → snapshot names → render PDF with `pdf-lib` (§2.1) → upload to `certificates/{YYYY}/{certificate_no}.pdf` → mint `verify_slug` (22+ chars, `crypto.getRandomValues`) → insert row → `app.record_audit('certificate.issue', …)` → queue email.

### Fields stamped on the template

`[STUDENT FULL NAME]` (uppercase, auto-shrink), `[COURSE / PROGRAM NAME]`, completion date, and `Qualification Score: {score}/{possible} ({percent}%)` — **omit the entire score line** for pass/fail courses rather than printing a blank. Signature blocks: certifying instructor from the session, second signatory default `Che' M. Gary, CEO, DJSTA`, both configurable in site settings rather than hardcoded. Footer: certificate number, student record number, course record ID, plus a small QR to `/verify/{slug}`.

### Delivery — both

- **Email** through the existing `sendEmail()` with the PDF as a base64 attachment (add `attachments` support to the `Envelope` type; Resend takes `[{ filename, content }]`). Subject: `Your DJSTA Certificate — {course_name}`. Record `email_message_id` / `email_error`; surface failures with a one-click resend. Preserve the module's no-throw contract.

  **Address the two-domain mismatch in the body copy.** The mail sends from `devinjordansecurity.com` (the domain verified in Resend) while the verification link points at `devinjordansecuritytrainingacademy.com` (the canonical site). This is intentional, but to a student it looks like the two halves of a phishing attempt. So the email must: name Devin Jordan Security Training Academy in full in the first line, state plainly that it was sent from `devinjordansecurity.com` and that certificates are verified at `devinjordansecuritytrainingacademy.com/verify`, and show the verify URL as visible text rather than a bare "click here". Same treatment in the plain-text part. A sender line that explains itself costs two sentences; a student who deletes their own certificate as spam costs a phone call and a reissue.

- **Download** via signed URL from the certificates screen, plus "download all" for a session and a bulk "issue for all passing students" that still runs all seven preconditions per student.

### Verify and void

`/verify/[slug]` shows certificate number, name, course, completion date, issue date, status, academy. Nothing else. Unknown slug → neutral "No certificate found with that number", rate limited, no enumeration hints. Void requires `certificate.void` and a typed reason; the row and PDF are kept forever and the verify page flips to an unmistakable VOID state.

---

## 9. The student packet — what every PDF becomes

### How the files get to you

Do not paste these into a prompt. **Commit all of them to `docs/forms/` in the repo** and read them from disk as you reach each phase. They are the visual and legal source of truth for the screens you are building; a screen written from a description of a form will not match the form.

```
docs/forms/
  00_Packet_Control_and_Completion_Checklist.pdf
  01_Student_Identification_and_Contact_Information.pdf
  02_Course_Enrollment_and_Prior_Training.pdf
  03_Training_Eligibility_and_Safety_Screening.pdf
  04_Firearm_Ammunition_and_Equipment_Record.pdf
  05_Range_Safety_Rules_and_Student_Acknowledgment.pdf
  06_Liability_Waiver_Assumption_of_Risk_and_Release.pdf
  07_Student_Agreement_Conduct_Privacy_and_Media.pdf
  08_Classroom_Use_of_Force_and_Practical_Attendance_Record.pdf
  09_Live_Fire_Qualification_and_Skills_Evaluation.pdf
  10_Target_and_Evidence_Control_Sheet.pdf
  11_Official_NJSP_SP_182_Safe_Handling_and_Proficiency_Certification.pdf
  12_Certification_Record_Closeout_and_Renewal_Index.pdf
  13_Instructor_Confidential_Notes.pdf
  14_Automation_and_Searchable_Record_Data_Dictionary.pdf
  DJSTA_Certificate_of_Completion_TEMPLATE.pdf
  DJSTA_Classroom_Attendance_Roster.pdf
```

Read each one before building its screen. Extract the exact field labels, the exact order, and the exact wording of anything a student signs. **Never paraphrase legal text.** If a field in the PDF has no home in the schema below, add a column rather than dropping the field — the packet is the record-retention artifact and a missing field is a gap in a permanent record.

Two of these are also runtime inputs, not just references, and must additionally be uploaded to the private `pdf-templates` Supabase bucket (the Worker cannot read the repo at runtime): `DJSTA_Certificate_of_Completion_TEMPLATE.pdf`, and the `DJSTA-STD-003_roster_template.pdf` you generate from `DJSTA_Classroom_Attendance_Roster.pdf`.

### The map

| #   | Form                                           | Becomes                                                                        | Who fills it                                          | Where                                    |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------- |
| 00  | Packet Control & Completion Checklist          | **Derived, not a form.** A live progress panel computed from the other records | nobody — the system                                   | `admin/training/students/[id]`           |
| 01  | Student Identification & Contact               | `public.students`                                                              | student at check-in                                   | `/check-in/[token]` (already in Phase 3) |
| 02  | Course Enrollment & Prior Training             | `student_enrollments`                                                          | student, pre-class                                    | `/intake/[token]`                        |
| 03  | Training Eligibility & Safety Screening        | `eligibility_screenings`                                                       | student answers, **instructor reviews and signs off** | `/intake/[token]` + admin review         |
| 04  | Firearm, Ammunition & Equipment Record         | `session_equipment_records`                                                    | instructor at the range                               | `admin/training/sessions/[id]`           |
| 05  | Range Safety Rules & Acknowledgment            | signed document, template key `range_rules`                                    | student e-signs                                       | `/intake/[token]`                        |
| 06  | Liability Waiver & Assumption of Risk          | signed document, key `liability_waiver`                                        | student e-signs                                       | `/intake/[token]`                        |
| 07  | Student Agreement, Conduct, Privacy & Media    | signed document, key `student_agreement`                                       | student e-signs                                       | `/intake/[token]`                        |
| 08  | Classroom & Use-of-Force Attendance            | DJSTA-STD-003 roster                                                           | students scan, instructor certifies                   | already built, Phases 3–4                |
| 09  | Live-Fire Qualification & Skills Evaluation    | `session_checkins.score/passed` + `qualification_details`                      | instructor                                            | `admin/training/sessions/[id]`           |
| 10  | Target & Evidence Control Sheet                | `session_evidence` + photo upload                                              | instructor                                            | `admin/training/sessions/[id]`           |
| 11  | Official NJSP S.P. 182                         | **Link out only — see below**                                                  | —                                                     | reference link, no screen                |
| 12  | Certification, Record Closeout & Renewal Index | `public.certificates` + renewal dates                                          | system on issue                                       | already built, Phase 5                   |
| 13  | Instructor Confidential Notes                  | `instructor_notes`, restricted                                                 | instructor                                            | `admin/training/sessions/[id]`, gated    |
| 14  | Automation & Searchable Record Data Dictionary | **Specification, not a screen.** Reconcile your column names against it        | —                                                     | inform the schema                        |

### 11 — the NJSP form is the one you do not build

`DJSTA_Classroom_Attendance_Roster.pdf` is DJSTA's own form and you may reproduce it. **S.P. 182 is a New Jersey State Police form and you must not regenerate, restyle, re-typeset or pre-fill it.** A recreated government form that looks official and is a revision behind is worse than no form at all — this is exactly the reasoning already written into `0010_required_forms.sql`, which is why `required_forms.source_url` is `NOT NULL` and the academy hosts no copies.

So: add S.P. 182 as a row in the existing `required_forms` table pointing at the NJSP page, and on the student's record show a checkbox — _"S.P. 182 completed"_ with a completion date and the completing instructor. The packet itself says this form is completed **only after successful qualification**, so gate that checkbox on a passing score and surface it as an outstanding item until it is ticked.

### The documents engine — `supabase/migrations/0014_packet_documents.sql`

Forms 05, 06 and 07 are signed agreements, and signed agreements have one requirement that ordinary form data does not: **you must be able to prove what the person actually agreed to, years later, after the wording has changed.** Storing a `waiver_signed: true` boolean is worthless in a dispute. So store the version and a frozen copy of the exact text presented.

```sql
create table public.document_templates (
  id uuid primary key default uuid_generate_v4(),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),  -- range_rules, liability_waiver, student_agreement
  version integer not null,
  title text not null,
  body_markdown text not null,
  requires_guardian_under_18 boolean not null default false,
  effective_from timestamptz not null default now(),
  retired_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (key, version)
);
-- A template row is never edited after anything has been signed against it.
-- Changing the wording means a NEW version, so every historical signature keeps
-- pointing at the words that were on the screen that day.

create table public.document_signatures (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references public.document_templates (id),
  student_id uuid not null references public.students (id),
  session_id uuid references public.course_sessions (id),
  -- The full text as rendered to this person, copied at signing time. Redundant
  -- with the template on purpose: it is the only thing that survives a template
  -- being retired, re-keyed or migrated.
  body_snapshot text not null,
  signature_path text not null,          -- PNG in the `signatures` bucket
  signed_name text not null,
  is_minor boolean not null default false,
  guardian_name text, guardian_signature_path text, guardian_relationship text,
  signed_at timestamptz not null default now(),
  ip inet, user_agent text,
  witness_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (student_id, template_id, session_id)
);
-- No update policy and no delete policy. A signature is corrected by superseding
-- it with a new one, never by editing the old.
```

Form 06 has an explicit 18-or-over / under-18 branch with a parent or guardian signature block. Honour it: if `dob` makes the student a minor at the session date, the guardian fields become required and the student cannot complete intake without them.

Form 07 bundles conduct, privacy **and media release**. Media consent must be a **separate, independently revocable opt-in checkbox** (`students.media_consent`, with a date), not folded into the agreement signature. Someone agreeing to a code of conduct has not thereby agreed to appear in marketing photographs, and a revocation needs somewhere to land.

### `/intake/[token]` — the pre-class student flow

One tokenised link per student per session, emailed on enrollment and also reachable from the check-in confirmation screen so a walk-in can complete it on the spot. Same CSRF-on-a-public-path treatment as `/check-in` (§2.4), same rate limiting, same "never render a full record to an unauthenticated visitor" rule.

Progressive, one section per screen, save-as-you-go so a dropped signal does not lose the lot: enrollment and prior training (02) → eligibility screening (03) → range rules (05) → waiver (06) → student agreement and media opt-in (07) → done. Show a progress indicator; let them resume where they stopped.

**Form 03 is the delicate one.** It asks eligibility questions with legal consequences — the kind of thing where a wrong answer costs someone a permit rather than an afternoon. Present the questions in the packet's exact wording, add no interpretation or guidance of your own, and make clear on the screen that answers are reviewed by an instructor. Answers are visible only to `student.read` holders, never on the projector, never in an email. An answer that flags for review sets the enrollment to `needs_instructor_review` and blocks certificate issuance until an instructor clears it — add that as precondition 7 in §8.

### The packet checklist (form 00), computed

Render it on the student record as a live checklist, each item ticked by evidence rather than by hand:

identity verified (instructor confirms photo ID) · profile complete (01) · emergency contact present (01) · eligibility screening reviewed (03, instructor signed) · range rules signed (05) · waiver signed (06) · agreement signed (07) · equipment recorded (04) · classroom attendance certified (08) · qualification score recorded (09) · S.P. 182 completed (11, manual tick) · target/evidence retained (10) · certificate issued (12)

Two of these stay manual because no system can observe them — identity verified against photo ID, and S.P. 182 completed. Both record who ticked them and when. Everything else derives from a record and must never be tickable by hand, or the checklist becomes a second, disagreeing source of truth.

### Retention

Signed documents, certified rosters and certificates are **permanent** and have no delete path anywhere in the UI or the policies. Form 13 (instructor confidential notes) is the exception in the other direction: readable only by its author and by `owner`/`admin` via a new `instructor.notes` permission, never exported, never included in a student-facing view, and clearly labelled in the UI as part of the training record rather than a private space.

---

## 10. House style — match it or the diff will look foreign

- Every file opens with a block comment explaining **why** the thing is shaped that way, not what the code does. Read `src/lib/csrf.ts` and `0010_required_forms.sql` for the register: plain English, the failure being prevented, and the tradeoff taken. This is the most distinctive thing about the codebase.
- Admin pages POST to themselves with an `action` field and set a `notice: { kind, message }` — copy `admin/forms.astro`.
- TypeScript, no `any`. Validate every form value server-side; never trust a client-supplied session id, student id or permission.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. If it can reach the browser bundle, that is a bug.
- New secrets via `wrangler secret put`; new non-secret vars go in `wrangler.toml` `[vars]` — anything set only in the dashboard is wiped on the next deploy.
- Run `npm run verify` (format:check + lint + check + build) before declaring any phase done. Run `npm run db:types` after each migration.

---

## 11. Build order — stop after each phase and tell me what to click

1. **Migrations + permissions.** `0012`, `0013`, permission registry, `db:permissions`, `db:types`, storage buckets. Prove with a test that an anon client reads zero rows from `students` and `session_checkins`.
2. **Course training settings + session CRUD + auto-titling.** Admin list/detail/new.
3. **CSRF refactor (§2.4), QR generation, `/session/[token]` projector view, `/check-in/[token]`** both paths, live roster.
4. **Verify/reject, time-out, scores, signature pad, certify, DJSTA-STD-003 roster PDF.**
5. **Certificate issue + `pdf-lib` + storage + Resend attachment + download + `/verify` + void.**
6. **Packet documents (§9).** `0014`, the versioned template/signature engine, `/intake/[token]`, forms 02/03/05/06/07, guardian branch, media opt-in.
7. **Instructor range records.** Forms 04, 09, 10, 13 on the session screen; the computed packet checklist (form 00) on the student record; S.P. 182 as a `required_forms` row plus a manual tick.
8. **`/me` student portal, bulk issue, training dashboard, audit filtering.**

---

## 12. Definition of done

- [ ] `npm run verify` passes
- [ ] An instructor creates a CPR class for next Saturday and the title generates correctly
- [ ] The projector view stays live for 8 hours without an auth redirect, and shows no DOB, email or full student number
- [ ] A returning student finds themselves by last name + DOB; a new student registers; neither creates a duplicate student number
- [ ] Both appear on the projector within seconds, no refresh
- [ ] Certifying produces a roster PDF matching DJSTA-STD-003
- [ ] An instructor without `certificate.issue` gets a clear refusal; granting it via `user_permissions` with a reason makes the same button work, with no deploy
- [ ] The issued PDF matches the template with a correctly fitted long name, the student receives it, staff can download it, `/verify/{slug}` shows it valid
- [ ] Voiding flips the verify page and leaves row and PDF intact
- [ ] A student completes `/intake` on a phone, signs all three documents, and the signatures store a frozen copy of the exact wording shown
- [ ] Publishing a new waiver version leaves every previously signed record pointing at the old text
- [ ] A student whose DOB makes them a minor cannot finish intake without guardian signature fields
- [ ] Media consent can be revoked without touching the student agreement signature
- [ ] Certificate issuance is blocked while a packet document is missing or a screening is unreviewed, with a message naming which
- [ ] S.P. 182 appears as a link to the NJSP page and nowhere as a regenerated form
- [ ] Every issue, void and certify appears in `audit_log` with the actor
- [ ] Nothing in the production bundle violates `script-src 'self'` (check the deployed console for CSP errors)

---
