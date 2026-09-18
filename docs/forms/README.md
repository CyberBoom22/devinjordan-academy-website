# Source forms

The paper record this system replaces. These are reference material for
building the screens, not runtime assets — with two exceptions noted below.

`00`–`14` are the sections of the DJSTA Qualification & Student Record Packet,
split one file per form. `docs/IMPLEMENTATION_PROMPT.md` §9 maps each one to
what it becomes in the application: a table, a signed document, a computed
checklist, or nothing at all.

Read the PDF before building its screen. Field labels, field order and the
wording of anything a student signs come from these files verbatim — never
from a paraphrase.

## Two of these are runtime inputs

The Worker cannot read this repo at runtime, so these must also be uploaded to
the private `pdf-templates` Supabase Storage bucket before Phase 5:

- `DJSTA_Certificate_of_Completion_TEMPLATE.pdf` — stamped with `pdf-lib` at issue time
- `DJSTA-STD-003_roster_template.pdf` — generated from `DJSTA_Classroom_Attendance_Roster.pdf`

## One of these must never be regenerated

`11_Official_NJSP_SP_182_*.pdf` is a New Jersey State Police form. Do not
re-typeset, restyle or pre-fill it. It is a link in `required_forms` plus a
manual completion tick — see §9 of the implementation prompt.
