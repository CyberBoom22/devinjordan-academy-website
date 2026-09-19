/**
 * Pre-class intake, server side.
 *
 * SERVER ONLY — service role key. Same rule as service.ts: importing this from
 * anything that reaches the browser is a bug.
 *
 * WHAT A TOKEN BUYS
 * -----------------
 * Exactly one student's forms for exactly one class, until the class has been
 * over for two hours. It is not a login: there is no password, no session and
 * no way to reach anything else with it. That is deliberate — a student should
 * not need an account to sign a waiver — and it is also why the token is
 * per-pair rather than per-class. A shared link would let anybody holding it
 * sign a liability waiver in somebody else's name.
 *
 * ONE RECORD PER STUDENT PER FORM PER SESSION
 * -------------------------------------------
 * Saving is an upsert on that triple, so a student who gets halfway through
 * the screening, closes the browser and comes back finishes the row they
 * started rather than creating a second one. 0016's partial unique indexes
 * enforce the same thing at the database level, which is what actually holds
 * under a double submit.
 *
 * WHAT COUNTS AS DONE
 * -------------------
 * Every form whose `filled_by` is 'student' and which applies to this session.
 * `completed_at` is set only when all of them are `submitted`, and it is a
 * timestamp rather than a flag because "finished at 7:12pm the night before"
 * is the kind of detail that matters if somebody later disputes a signature.
 */

import { createAdminClient } from '../supabase/server';
import type { PacketField, AnswerValue } from '../forms/fields';

export type IntakeContext = {
  intakeId: string;
  sessionId: string;
  studentId: string;
  studentFirstName: string;
  sessionTitle: string;
  courseName: string;
  location: string;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
};

export type IntakeState = 'open' | 'expired' | 'unknown';

export type IntakeForm = {
  code: string;
  title: string;
  purpose: string;
  requiresSignature: boolean;
  sequence: number;
  fields: PacketField[];
  answers: Record<string, AnswerValue> | null;
  status: string;
};

/**
 * Resolve a token to its intake, or say why not.
 *
 * Returns 'unknown' for both a malformed token and one that does not exist —
 * the two are indistinguishable to the caller on purpose, so the page cannot
 * be used to confirm that a given token was ever real.
 */
export async function resolveIntakeToken(
  token: string,
  runtimeEnv?: Record<string, string | undefined>,
): Promise<{ intake: IntakeContext | null; state: IntakeState }> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin || !/^[0-9a-f]{32}$/.test(token)) return { intake: null, state: 'unknown' };

  const { data, error } = await admin
    .from('session_intakes')
    .select(
      'id, session_id, student_id, completed_at, expires_at, students(legal_first), course_sessions(title, location, starts_at, ends_at, courses(name))',
    )
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return { intake: null, state: 'unknown' };

  const row = data as unknown as {
    id: string;
    session_id: string;
    student_id: string;
    completed_at: string | null;
    expires_at: string;
    students: { legal_first: string } | null;
    course_sessions: {
      title: string;
      location: string;
      starts_at: string;
      ends_at: string;
      courses: { name: string } | null;
    } | null;
  };

  const intake: IntakeContext = {
    intakeId: row.id,
    sessionId: row.session_id,
    studentId: row.student_id,
    studentFirstName: row.students?.legal_first ?? 'there',
    sessionTitle: row.course_sessions?.title ?? 'Your class',
    courseName: row.course_sessions?.courses?.name ?? 'Training',
    location: row.course_sessions?.location ?? '',
    startsAt: row.course_sessions?.starts_at ?? '',
    endsAt: row.course_sessions?.ends_at ?? '',
    completedAt: row.completed_at,
  };

  if (Date.now() > new Date(row.expires_at).getTime()) return { intake, state: 'expired' };
  return { intake, state: 'open' };
}

/**
 * The forms this student still has to complete, with their fields and anything
 * already saved.
 *
 * Only `filled_by = 'student'` forms, and only active ones. Form 01 is excluded
 * by the data rather than by a condition here: it is the students table itself,
 * collected at registration, so it has no fields to render.
 */
export async function intakeForms(
  sessionId: string,
  studentId: string,
  runtimeEnv?: Record<string, string | undefined>,
): Promise<IntakeForm[]> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin) return [];

  const [{ data: forms }, { data: fields }, { data: records }] = await Promise.all([
    admin
      .from('packet_forms')
      .select('code, title, purpose, requires_signature, sequence')
      .eq('filled_by', 'student')
      .eq('active', true)
      .order('sequence'),
    admin.from('packet_form_fields').select('*').order('sequence'),
    admin
      .from('student_form_records')
      .select('form_code, answers, status')
      .eq('student_id', studentId)
      .eq('session_id', sessionId),
  ]);

  const formRows = (forms ?? []) as unknown as {
    code: string;
    title: string;
    purpose: string;
    requires_signature: boolean;
    sequence: number;
  }[];

  const fieldRows = (fields ?? []) as unknown as (PacketField & { form_code: string })[];
  const recordRows = (records ?? []) as unknown as {
    form_code: string;
    answers: Record<string, AnswerValue> | null;
    status: string;
  }[];

  return (
    formRows
      .map((form) => {
        const record = recordRows.find((entry) => entry.form_code === form.code);
        return {
          code: form.code,
          title: form.title,
          purpose: form.purpose,
          requiresSignature: form.requires_signature,
          sequence: form.sequence,
          fields: fieldRows.filter((field) => field.form_code === form.code),
          answers: record?.answers ?? null,
          status: record?.status ?? 'not_started',
        };
      })
      // A form with no fields defined yet would render as an empty page with a
      // submit button, which is worse than not offering it.
      .filter((form) => form.fields.length > 0)
  );
}

/**
 * Save one form's answers.
 *
 * Upserts on (student, form, session) so a resumed form finishes the row it
 * started. The signature fields are stored inside `answers` like any other
 * value; `signed_at` and `signed_name` are lifted out of them so a query can
 * ask "when did this person sign" without unpacking jsonb.
 */
export async function saveIntakeForm(
  args: {
    sessionId: string;
    studentId: string;
    formCode: string;
    answers: Record<string, AnswerValue>;
    signatureName: string | null;
  },
  runtimeEnv?: Record<string, string | undefined>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin) return { ok: false, error: 'Intake is not configured on this deployment.' };

  const { data: existing } = await admin
    .from('student_form_records')
    .select('id')
    .eq('student_id', args.studentId)
    .eq('session_id', args.sessionId)
    .eq('form_code', args.formCode)
    .maybeSingle();

  const payload = {
    student_id: args.studentId,
    session_id: args.sessionId,
    form_code: args.formCode,
    answers: args.answers,
    status: 'submitted' as const,
    ...(args.signatureName
      ? { signed_name: args.signatureName, signed_at: new Date().toISOString() }
      : {}),
  };

  const { error } = existing
    ? await admin
        .from('student_form_records')
        .update(payload)
        .eq('id', (existing as unknown as { id: string }).id)
    : await admin.from('student_form_records').insert(payload);

  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Mark the intake finished once every student form has been submitted.
 *
 * Recomputed from the records rather than counted as forms are saved: a
 * counter would drift the first time a form is added to the packet, and it
 * would drift silently.
 */
export async function refreshIntakeCompletion(
  intakeId: string,
  sessionId: string,
  studentId: string,
  runtimeEnv?: Record<string, string | undefined>,
): Promise<boolean> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin) return false;

  const forms = await intakeForms(sessionId, studentId, runtimeEnv);
  const allDone = forms.length > 0 && forms.every((form) => form.status === 'submitted');

  await admin
    .from('session_intakes')
    .update({ completed_at: allDone ? new Date().toISOString() : null })
    .eq('id', intakeId);

  return allDone;
}

/**
 * The intake token for a student in a session, creating one if needed.
 *
 * Used by the check-in confirmation to offer "now do your paperwork", and by
 * the admin session screen to hand a link out ahead of the class. Idempotent:
 * a second call returns the existing token rather than minting a rival one,
 * because two live links for the same person is two sets of signatures nobody
 * can rank.
 */
export async function ensureIntake(
  sessionId: string,
  studentId: string,
  createdBy?: string,
  runtimeEnv?: Record<string, string | undefined>,
): Promise<string | null> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin) return null;

  const { data: existing } = await admin
    .from('session_intakes')
    .select('token')
    .eq('session_id', sessionId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (existing) return (existing as unknown as { token: string }).token;

  const { data, error } = await admin
    .from('session_intakes')
    .insert({ session_id: sessionId, student_id: studentId, created_by: createdBy ?? null })
    .select('token')
    .single();

  if (error || !data) return null;
  return (data as unknown as { token: string }).token;
}
