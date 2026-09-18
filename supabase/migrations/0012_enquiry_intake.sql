-- ===========================================================================
-- 0012 — Enquiry intake
--
-- The public site had contact details and no form, because the old Wix embed
-- had no server to receive a submission. It has one now, so the form comes
-- back — and the moment a form exists, two things follow that the original
-- `enquiries` table did not need to answer.
--
-- FIRST: an enquiry nobody sees is worse than no form at all.
-- A phone number on a page fails visibly — it rings out, and the caller knows.
-- A form fails silently: the visitor gets a thank-you screen and assumes the
-- academy has their details, while the row sits unread in a table nobody has
-- opened. So every submission is emailed to the people who answer enquiries,
-- and the result of that send is recorded here the way 0011 records invite
-- delivery. A notification that failed must be distinguishable from one nobody
-- has replied to yet, because the remedy is different: one needs re-sending,
-- the other needs a person.
--
-- SECOND: the row is kept even when the email fails.
-- The insert and the send are separate steps and the send is the one that
-- depends on someone else's network being up. Writing the row first means a
-- Resend outage costs a notification, not an enquiry — the back office can
-- still work the list, and the failure is on screen next to it.
--
-- What is NOT collected here is deliberate. No date of birth, no address, no
-- firearms history, no eligibility questions. This is the form a stranger
-- fills in before they are a student; the packet collects the rest once there
-- is a relationship and a record to attach it to. A contact form that opens by
-- asking a member of the public about their criminal history is a contact form
-- nobody completes.
-- ===========================================================================

-- How they would rather be reached. Asking costs one line and saves the call
-- that goes to voicemail three times because the person works nights.
do $$ begin
  create type public.contact_preference as enum ('email', 'text', 'phone');
exception when duplicate_object then null;
end $$;

alter table public.enquiries
  add column if not exists preferred_contact public.contact_preference,

  -- The programme they are asking about. course_id already links to the real
  -- course when they picked one from the list; this holds what they typed when
  -- they did not, which is most of the time — people ask for "the carry class"
  -- long before they know its catalogue name.
  add column if not exists program_interest text,

  -- Their own words about timing. Free text on purpose: "weekends", "after
  -- April", "ASAP" and "when my permit clears" are all real answers and none
  -- of them fit a date picker.
  add column if not exists availability text,

  -- How they found the academy. Optional, and the only marketing question on
  -- the form.
  add column if not exists heard_from text,

  -- --- Notification delivery, mirroring 0011 -------------------------------
  add column if not exists notify_status public.email_delivery_status not null default 'not_sent',
  add column if not exists notified_at timestamptz,
  -- Who it actually went to, captured at send time. The recipient list is
  -- derived from whoever holds the roles today, so it changes; this records
  -- what was true for this enquiry.
  add column if not exists notified_to text,
  add column if not exists notify_error text;

-- Working the queue means "show me what has not been answered", and the
-- existing index is on (status, created_at). This one is for the narrower
-- question the back office asks after an outage: what failed to notify?
create index if not exists enquiries_notify_idx
  on public.enquiries (notify_status, created_at desc)
  where notify_status <> 'sent';

comment on column public.enquiries.program_interest is
  'What the visitor typed when no catalogue course matched. course_id holds the match when there was one.';

-- --- Rate limiting ---------------------------------------------------------
-- A public form with no account behind it is a spam target and a way to make
-- the academy send mail on a stranger's command. The handler counts recent
-- attempts per IP before it writes anything.
--
-- A table rather than Workers KV because the count has to be consistent: KV is
-- eventually consistent across edge locations, so a burst spread over several
-- of them can pass a limit it should have failed. This is a small table with a
-- cheap index and enquiries are not a high-volume path.
create table if not exists public.enquiry_attempts (
  id         uuid primary key default uuid_generate_v4(),
  -- Truncated to a /24 (IPv4) or /64 (IPv6) by the handler before it lands
  -- here. A full address is more precision than rate limiting needs and more
  -- personal data than an abuse counter should hold.
  ip_prefix  text not null,
  created_at timestamptz not null default now()
);

create index if not exists enquiry_attempts_window_idx
  on public.enquiry_attempts (ip_prefix, created_at desc);

alter table public.enquiry_attempts enable row level security;

-- No policy for anon or authenticated at all. The handler touches this table
-- with the service role key exclusively, so a client that could read it could
-- only learn who has been submitting forms.
drop policy if exists "enquiry attempts staff read" on public.enquiry_attempts;
create policy "enquiry attempts staff read"
  on public.enquiry_attempts for select
  using (app.has_permission('enquiry.read'));
