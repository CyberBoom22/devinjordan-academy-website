/**
 * Check-in, server side.
 *
 * SERVER ONLY. Every function here runs with the service role key, which
 * bypasses row level security. Importing this module from anything that reaches
 * the browser is a bug, not a style preference.
 *
 * WHY THE SERVICE ROLE AND NOT A POLICY
 * -------------------------------------
 * A student checking in is signed out and always will be — requiring an account
 * to attend a class you have already paid for is the kind of friction that ends
 * with the instructor taking names on paper. So the anon role has no policy on
 * `students` or `session_checkins` at all, and cannot be given one: a policy
 * loose enough to let a stranger create their own student record is a policy
 * loose enough to let them read everybody else's date of birth.
 *
 * The consequence is that every rule RLS would have enforced has to be enforced
 * here instead, in one place, deliberately:
 *
 *   - the token must exist and the window must be open
 *   - one row per student per session, and a second scan reopens rather than
 *     duplicates
 *   - a returning student is matched, never guessed
 *   - a new student gets a number from the database, never from this file
 *
 * WHAT A MATCH IS ALLOWED TO DO
 * -----------------------------
 * Match on surname plus date of birth, or on the student number. One hit is a
 * match. Zero or several is NOT a match and never falls back to "closest" —
 * it drops into registration and flags the row for the instructor. A wrong
 * match attaches somebody's qualification score to another person's permanent
 * record, and nothing downstream would ever catch it. A duplicate record is
 * visible, annoying and fixable; a wrong match is invisible and permanent.
 *
 * WHAT IS RETURNED TO THE BROWSER
 * -------------------------------
 * Masked, always. The scanner is unauthenticated and could be anybody holding
 * the link, so a lookup confirms "is this you?" with initials and a partial
 * number and never renders the record it matched.
 */

import { createAdminClient } from '../supabase/server';

export type SessionContext = {
  id: string;
  title: string;
  location: string;
  startsAt: string;
  endsAt: string;
  courseName: string;
  instructorName: string | null;
  courseRecordId: string;
  checkinOpensAt: string;
  checkinClosesAt: string;
};

/** Why a check-in page will not accept anybody right now. */
export type WindowState = 'open' | 'too_early' | 'closed' | 'unknown_token';

export type MaskedMatch = {
  studentId: string;
  masked: string;
  maskedNumber: string;
};

export type CheckinOutcome =
  | { ok: true; studentNo: string; fullName: string; timeIn: string; reopened: boolean }
  | { ok: false; error: string };

/** "J••• D••" — enough to recognise yourself, not enough to learn a name. */
function maskName(first: string, last: string): string {
  const head = (value: string): string =>
    value.length <= 1 ? value : `${value[0]}${'•'.repeat(Math.min(value.length - 1, 3))}`;
  return `${head(first)} ${head(last)}`;
}

/** "DJSTA-2024-••1847" — the year is not secret, the sequence mostly is. */
function maskNumber(studentNo: string): string {
  const parts = studentNo.split('-');
  if (parts.length !== 3) return '••••';
  const tail = parts[2]!;
  return `${parts[0]}-${parts[1]}-••${tail.slice(-4)}`;
}

/**
 * Resolve a check-in token to its session, and say whether the window is open.
 *
 * Returns the session even when the window is shut, because the page still has
 * to tell the student which class they scanned rather than a bare error.
 */
export async function resolveCheckinToken(
  token: string,
  runtimeEnv?: Record<string, string | undefined>,
): Promise<{ session: SessionContext | null; state: WindowState }> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin || !/^[0-9a-f]{32}$/.test(token)) {
    return { session: null, state: 'unknown_token' };
  }

  const { data, error } = await admin
    .from('course_sessions')
    .select(
      'id, title, location, starts_at, ends_at, course_record_id, checkin_opens_at, checkin_closes_at, courses(name), instructors(name)',
    )
    .eq('checkin_token', token)
    .maybeSingle();

  if (error || !data) return { session: null, state: 'unknown_token' };

  const row = data as unknown as {
    id: string;
    title: string;
    location: string;
    starts_at: string;
    ends_at: string;
    course_record_id: string;
    checkin_opens_at: string;
    checkin_closes_at: string;
    courses: { name: string } | null;
    instructors: { name: string } | null;
  };

  const session: SessionContext = {
    id: row.id,
    title: row.title,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    courseName: row.courses?.name ?? 'Training',
    instructorName: row.instructors?.name ?? null,
    courseRecordId: row.course_record_id,
    checkinOpensAt: row.checkin_opens_at,
    checkinClosesAt: row.checkin_closes_at,
  };

  const now = Date.now();
  const opens = new Date(session.checkinOpensAt).getTime();
  const closes = new Date(session.checkinClosesAt).getTime();

  const state: WindowState = now < opens ? 'too_early' : now > closes ? 'closed' : 'open';
  return { session, state };
}

/**
 * Find a returning student.
 *
 * Exactly one hit is a match. Anything else is not, and the caller registers
 * them fresh with the row flagged for review — see the header for why guessing
 * is the worse failure.
 */
export async function findReturningStudent(
  input: { lastName?: string; dob?: string; studentNo?: string },
  runtimeEnv?: Record<string, string | undefined>,
): Promise<{ match: MaskedMatch | null; ambiguous: boolean }> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin) return { match: null, ambiguous: false };

  let builder = admin
    .from('students')
    .select('id, djsta_student_no, legal_first, legal_last')
    .is('merged_into', null)
    .limit(5);

  if (input.studentNo) {
    builder = builder.eq('djsta_student_no', input.studentNo.toUpperCase());
  } else if (input.lastName && input.dob) {
    builder = builder.ilike('legal_last', input.lastName).eq('dob', input.dob);
  } else {
    return { match: null, ambiguous: false };
  }

  const { data, error } = await builder;
  if (error) return { match: null, ambiguous: false };

  const rows = (data ?? []) as unknown as {
    id: string;
    djsta_student_no: string;
    legal_first: string;
    legal_last: string;
  }[];

  if (rows.length !== 1) return { match: null, ambiguous: rows.length > 1 };

  const row = rows[0]!;
  return {
    match: {
      studentId: row.id,
      masked: maskName(row.legal_first, row.legal_last),
      maskedNumber: maskNumber(row.djsta_student_no),
    },
    ambiguous: false,
  };
}

export type NewStudentInput = {
  legalFirst: string;
  legalMiddle: string | null;
  legalLast: string;
  dob: string;
  email: string;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergencyName: string | null;
  emergencyRelationship: string | null;
  emergencyPhone: string | null;
  preferredContact: 'email' | 'text' | 'phone' | null;
};

/**
 * Register a student who has never trained here.
 *
 * djsta_student_no is absent on purpose. The trigger assigns it, so this
 * function could not mint a duplicate even if it tried to.
 */
export async function registerStudent(
  input: NewStudentInput,
  runtimeEnv?: Record<string, string | undefined>,
): Promise<{ studentId: string; studentNo: string } | { error: string }> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin) return { error: 'Check-in is not configured on this deployment.' };

  const emergency =
    input.emergencyName || input.emergencyPhone
      ? {
          name: input.emergencyName,
          relationship: input.emergencyRelationship,
          phone: input.emergencyPhone,
        }
      : null;

  const { data, error } = await admin
    .from('students')
    .insert({
      legal_first: input.legalFirst,
      legal_middle: input.legalMiddle,
      legal_last: input.legalLast,
      dob: input.dob,
      email: input.email,
      phone: input.phone,
      address_line1: input.addressLine1,
      city: input.city,
      state: input.state,
      zip: input.zip,
      emergency_contact: emergency,
      preferred_contact: input.preferredContact,
    })
    .select('id, djsta_student_no')
    .single();

  if (error || !data) return { error: error?.message ?? 'Could not create that record.' };

  const row = data as unknown as { id: string; djsta_student_no: string };
  return { studentId: row.id, studentNo: row.djsta_student_no };
}

/**
 * Write the attendance row, or reopen the one that is already there.
 *
 * `needsReview` marks the rows an instructor has to look at before certifying:
 * a lookup that matched nothing or matched several people. The row is created
 * either way — turning a student away at the door because the search was
 * ambiguous is the wrong trade when an instructor is standing right there.
 */
export async function recordCheckin(
  args: {
    sessionId: string;
    studentId: string;
    selfAttestedName: string;
    needsReview?: boolean;
    ip?: string | null;
    userAgent?: string | null;
  },
  runtimeEnv?: Record<string, string | undefined>,
): Promise<CheckinOutcome> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin) return { ok: false, error: 'Check-in is not configured on this deployment.' };

  const { data: student } = await admin
    .from('students')
    .select('djsta_student_no, legal_first, legal_last')
    .eq('id', args.studentId)
    .single();

  const person = student as unknown as {
    djsta_student_no: string;
    legal_first: string;
    legal_last: string;
  } | null;

  if (!person) return { ok: false, error: 'That student record could not be found.' };

  // A second scan must reopen, never duplicate — the unique constraint would
  // reject it anyway, but returning the existing row is the useful behaviour.
  const { data: existing } = await admin
    .from('session_checkins')
    .select('id, time_in')
    .eq('session_id', args.sessionId)
    .eq('student_id', args.studentId)
    .maybeSingle();

  if (existing) {
    const row = existing as unknown as { id: string; time_in: string };
    return {
      ok: true,
      studentNo: person.djsta_student_no,
      fullName: `${person.legal_first} ${person.legal_last}`,
      timeIn: row.time_in,
      reopened: true,
    };
  }

  const { data, error } = await admin
    .from('session_checkins')
    .insert({
      session_id: args.sessionId,
      student_id: args.studentId,
      self_attested_name: args.selfAttestedName,
      method: 'qr_self',
      // Always pending. The instructor's certification is what makes this a
      // record; a scan is only a claim.
      status: args.needsReview ? 'needs_review' : 'pending',
      ip: args.ip ?? null,
      user_agent: args.userAgent?.slice(0, 500) ?? null,
    })
    .select('time_in')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Could not record that.' };

  return {
    ok: true,
    studentNo: person.djsta_student_no,
    fullName: `${person.legal_first} ${person.legal_last}`,
    timeIn: (data as unknown as { time_in: string }).time_in,
    reopened: false,
  };
}

/**
 * The roster as a projector may show it.
 *
 * First name and last initial only, plus a time. A projected screen is visible
 * to the whole room and to anyone walking past it, so a full name, a date of
 * birth or a complete student number on that screen is a data breach with an
 * audience.
 */
export async function presenterRoster(
  presenterToken: string,
  runtimeEnv?: Record<string, string | undefined>,
): Promise<{ session: SessionContext | null; roster: { name: string; timeIn: string }[] }> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin || !/^[0-9a-f]{32}$/.test(presenterToken)) return { session: null, roster: [] };

  const { data: sessionRow } = await admin
    .from('course_sessions')
    .select(
      'id, title, location, starts_at, ends_at, course_record_id, checkin_token, checkin_opens_at, checkin_closes_at, courses(name), instructors(name)',
    )
    .eq('presenter_token', presenterToken)
    .maybeSingle();

  if (!sessionRow) return { session: null, roster: [] };

  const row = sessionRow as unknown as {
    id: string;
    title: string;
    location: string;
    starts_at: string;
    ends_at: string;
    course_record_id: string;
    checkin_token: string;
    checkin_opens_at: string;
    checkin_closes_at: string;
    courses: { name: string } | null;
    instructors: { name: string } | null;
  };

  // The presenter link dies two hours after check-in closes. A projector view
  // that stays live for ever is a roster anybody who ever saw the URL can keep
  // watching.
  const expiry = new Date(row.checkin_closes_at).getTime() + 2 * 60 * 60 * 1000;
  if (Date.now() > expiry) return { session: null, roster: [] };

  const { data: checkins } = await admin
    .from('session_checkins')
    .select('time_in, students(legal_first, legal_last)')
    .eq('session_id', row.id)
    .order('time_in', { ascending: false })
    .limit(200);

  const roster = (
    (checkins ?? []) as unknown as {
      time_in: string;
      students: { legal_first: string; legal_last: string } | null;
    }[]
  ).map((entry) => ({
    name: `${entry.students?.legal_first ?? 'Student'} ${entry.students?.legal_last?.[0] ?? ''}.`.trim(),
    timeIn: entry.time_in,
  }));

  return {
    session: {
      id: row.id,
      title: row.title,
      location: row.location,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      courseName: row.courses?.name ?? 'Training',
      instructorName: row.instructors?.name ?? null,
      courseRecordId: row.course_record_id,
      checkinOpensAt: row.checkin_opens_at,
      checkinClosesAt: row.checkin_closes_at,
    },
    roster,
  };
}

/** The check-in token for a presenter session, for building the QR. */
export async function checkinTokenFor(
  presenterToken: string,
  runtimeEnv?: Record<string, string | undefined>,
): Promise<string | null> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin || !/^[0-9a-f]{32}$/.test(presenterToken)) return null;

  const { data } = await admin
    .from('course_sessions')
    .select('checkin_token')
    .eq('presenter_token', presenterToken)
    .maybeSingle();

  return (data as unknown as { checkin_token: string } | null)?.checkin_token ?? null;
}

/**
 * Attempts from one /24 in the last ten minutes.
 *
 * Reuses the enquiry_attempts table rather than adding a second one: the shape
 * is identical and the two paths are both "a stranger posting to a public form".
 */
export async function rateLimited(
  ipPrefix: string,
  limit: number,
  windowMinutes: number,
  runtimeEnv?: Record<string, string | undefined>,
): Promise<boolean> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin) return false;

  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count } = await admin
    .from('enquiry_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_prefix', ipPrefix)
    .gte('created_at', since);

  if ((count ?? 0) >= limit) return true;
  await admin.from('enquiry_attempts').insert({ ip_prefix: ipPrefix });
  return false;
}
