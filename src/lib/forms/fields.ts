/**
 * Rendering and validating a packet form from its field rows.
 *
 * The forms live in the database (`packet_form_fields`), so no screen hardcodes
 * a question. That buys the thing the schema was shaped for — adding a
 * screening question is an INSERT, not a deploy — and costs the thing a normal
 * form gets for free: the database cannot check that an answer is the right
 * shape, because every answer is a value in one jsonb blob.
 *
 * So validation happens here, once, on the server, against the same rows that
 * rendered the form. Never trust the submitted field names: a form that
 * iterates the POST body and stores what it finds will happily store whatever
 * an attacker invents, including keys that shadow real ones. This module walks
 * the FIELD LIST and pulls each value by name, so anything not in the
 * definition is dropped rather than saved.
 *
 * A note on `initials` and `signature`. Both are consent, not data, and both
 * are stored as what was typed plus when. The point of initialling twelve range
 * rules separately is that twelve deliberate acts are not one act, so each one
 * is its own field and an empty one fails validation like any other required
 * answer.
 */

export type PacketFieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'number'
  | 'boolean'
  | 'choice'
  | 'multi'
  | 'initials'
  | 'signature'
  | 'heading';

export type PacketField = {
  field_key: string;
  sequence: number;
  label: string;
  help: string | null;
  type: PacketFieldType;
  options: string[] | null;
  required: boolean;
  section: string | null;
};

/** One answer, as stored in student_form_records.answers. */
export type AnswerValue = string | number | boolean | string[] | null;

export type ValidationResult = {
  answers: Record<string, AnswerValue>;
  /** Field key → message. Empty when the form is acceptable. */
  errors: Record<string, string>;
};

/** Fields grouped under their section heading, in the PDF's own order. */
export function groupBySection(
  fields: PacketField[],
): { section: string | null; fields: PacketField[] }[] {
  const groups: { section: string | null; fields: PacketField[] }[] = [];
  for (const field of [...fields].sort((a, b) => a.sequence - b.sequence)) {
    const last = groups[groups.length - 1];
    if (last && last.section === (field.section ?? null)) last.fields.push(field);
    else groups.push({ section: field.section ?? null, fields: [field] });
  }
  return groups;
}

/** Did the browser send anything at all under this name? */
function submitted(form: FormData, key: string): boolean {
  const raw = form.get(key);
  return raw !== null && String(raw).trim() !== '';
}

function isBlank(value: AnswerValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Read one field's answer out of submitted form data.
 *
 * Returns null for anything unusable rather than throwing, so a malformed value
 * is reported as a validation error next to its field instead of a 500 that
 * loses the whole submission.
 */
function readField(field: PacketField, form: FormData): AnswerValue {
  const raw = form.get(field.field_key);

  switch (field.type) {
    case 'heading':
      return null;

    case 'boolean':
      // Tri-state on purpose: a screening question that was never answered is
      // different from one answered "no", and only one of them is a problem.
      if (raw === null) return null;
      return String(raw) === 'yes' ? true : String(raw) === 'no' ? false : null;

    case 'multi': {
      const all = form.getAll(field.field_key).map((value) => String(value));
      const allowed = new Set(field.options ?? []);
      return all.filter((value) => allowed.has(value));
    }

    case 'choice': {
      const value = String(raw ?? '').trim();
      if (!value) return null;
      // An option that is not on the list did not come from this form.
      return (field.options ?? []).includes(value) ? value : null;
    }

    case 'number': {
      const value = String(raw ?? '').trim();
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    case 'date': {
      const value = String(raw ?? '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    }

    case 'initials': {
      // Two or three letters. Longer means they typed their whole name, which
      // is fine and gets trimmed rather than rejected.
      const value = String(raw ?? '')
        .trim()
        .slice(0, 8);
      return value || null;
    }

    case 'signature':
    case 'text': {
      const value = String(raw ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400);
      return value || null;
    }

    case 'textarea': {
      const value = String(raw ?? '')
        .trim()
        .slice(0, 8000);
      return value || null;
    }

    default:
      return null;
  }
}

/**
 * Validate a submission against the field definitions.
 *
 * Walks the definitions, not the POST body, so an invented key cannot reach the
 * stored answers.
 */
export function validateSubmission(fields: PacketField[], form: FormData): ValidationResult {
  const answers: Record<string, AnswerValue> = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    if (field.type === 'heading') continue;

    const value = readField(field, form);

    if (field.required && isBlank(value)) {
      errors[field.field_key] =
        field.type === 'initials'
          ? 'Initial this line to confirm you have read it.'
          : field.type === 'signature'
            ? 'A signature is required.'
            : field.type === 'boolean'
              ? 'Answer yes or no.'
              : 'This is required.';
      continue;
    }

    // A choice or number that arrived unusable is an error even when optional —
    // silently storing null for something the student did fill in would lose an
    // answer without telling anybody.
    if (submitted(form, field.field_key) && value === null && field.type !== 'boolean') {
      if (field.type === 'choice') errors[field.field_key] = 'Choose one of the listed options.';
      if (field.type === 'number') errors[field.field_key] = 'Enter a number.';
      if (field.type === 'date') errors[field.field_key] = 'Enter a valid date.';
    }

    answers[field.field_key] = value;
  }

  return { answers, errors };
}

/** How far through a form somebody is, for the packet checklist. */
export function completeness(
  fields: PacketField[],
  answers: Record<string, AnswerValue> | null,
): { answered: number; required: number } {
  const required = fields.filter((field) => field.required && field.type !== 'heading');
  const answered = required.filter((field) => !isBlank((answers ?? {})[field.field_key] ?? null));
  return { answered: answered.length, required: required.length };
}
