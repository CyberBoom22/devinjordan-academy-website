/**
 * Presentation helpers shared by templates.
 *
 * The escaping here matters: copy comes from the database, which means it
 * comes from whatever the academy typed into the admin area. Anything passed
 * to `set:html` must be escaped by these functions first — they escape, THEN
 * add the small amount of markup the design needs, so a stray `<script>` in a
 * headline ends up as visible text rather than a tag.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Render copy that may contain two authoring conventions:
 *   a newline      → a line break
 *   {{like this}}  → the phrase wrapped in `highlightClass`
 *
 * Both exist so the academy can control emphasis and line breaks in a headline
 * without being handed an HTML editor. The class is a parameter because the
 * same convention picks out gold on one page and maroon on another.
 */
export function renderCopy(text: string | null | undefined, highlightClass = 'accent'): string {
  const cls = escapeHtml(highlightClass);
  return escapeHtml(text)
    .replace(/\{\{(.+?)\}\}/g, `<span class="${cls}">$1</span>`)
    .replace(/\n/g, '<br />');
}

/** Same conventions, with the maroon highlight used in the hero. */
export function renderCopyPrimary(text: string | null | undefined): string {
  return renderCopy(text, 'highlight-red');
}

/** Split a copy block on blank lines into paragraphs. */
export function paragraphs(text: string | null | undefined): string[] {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * Format a price held in cents.
 * `priceCents: null` means "call for pricing" rather than free.
 */
export function formatPrice(priceCents: number | null, note?: string | null): string {
  if (priceCents === null) return 'Call for pricing';
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(priceCents / 100);
  return note ? `${formatted}${note}` : formatted;
}

/** "3 agencies" / "1 agency" — used in the ORI tallies. */
export function pluralAgencies(count: number): string {
  return `${count} ${count === 1 ? 'agency' : 'agencies'}`;
}

/**
 * Map a free-text status such as "Pending" onto one of the badge colours.
 * Unknown values fall back to the neutral badge rather than being dropped, so
 * a legislature inventing a new stage never breaks the page.
 */
export function statusBadgeClass(statusLabel: string | null | undefined): string {
  const known = ['enacted', 'pending', 'decided', 'closed'];
  const normalised = String(statusLabel ?? '').toLowerCase();
  return known.includes(normalised) ? normalised : '';
}

/** Only ever emit http(s) links, whatever the stored value says. */
export function safeUrl(url: string | null | undefined): string {
  const value = String(url ?? '');
  return /^https?:\/\//i.test(value) ? value : '#';
}

/* -------------------------------------------------------------------------
 * Training sessions
 *
 * Everything below renders in America/New_York regardless of where the Worker
 * runs. Cloudflare Workers ship full ICU, so Intl does the whole job and no
 * date library is needed — which matters, because a bundled tzdata is one more
 * thing to keep current for a site that only ever means "New Jersey time".
 * ---------------------------------------------------------------------- */

const ACADEMY_TZ = 'America/New_York';

function parts(date: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: ACADEMY_TZ, ...options });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

/** "9:00 AM" — no leading zero, which is how a person writes a class time. */
export function sessionTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ACADEMY_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** "Saturday, March 14, 2026" */
export function sessionDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ACADEMY_TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** "EDT" or "EST" — whichever was actually in force on that date. */
export function sessionZone(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return parts(date, { timeZoneName: 'short' }).timeZoneName ?? '';
}

/** True when two instants land on different calendar days in New Jersey. */
function differentDays(a: Date, b: Date): boolean {
  const key = (date: Date): string => {
    const p = parts(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
    return `${p.year}-${p.month}-${p.day}`;
  };
  return key(a) !== key(b);
}

/**
 * The generated session title.
 *
 *   CPR / AED Certification — Saturday, March 14, 2026 · 9:00 AM–1:00 PM EDT
 *
 * Generated once on create and STORED, never recomputed at render. A course
 * renamed in 2028 must not retitle a class taught in 2026 — including on the
 * roster PDF already filed under the old name.
 *
 * A session spanning midnight renders both dates and drops the times, because
 * "March 14 · 9:00 PM–1:00 AM" reads as a four-hour class that ends before it
 * starts.
 */
export function sessionTitle(
  courseName: string,
  startsAt: Date | string,
  endsAt: Date | string,
): string {
  const start = typeof startsAt === 'string' ? new Date(startsAt) : startsAt;
  const end = typeof endsAt === 'string' ? new Date(endsAt) : endsAt;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return courseName;

  if (differentDays(start, end)) {
    const from = parts(start, { month: 'long', day: 'numeric' });
    const to = parts(end, { month: 'long', day: 'numeric', year: 'numeric' });
    return `${courseName} — ${from.month} ${from.day}–${to.month} ${to.day}, ${to.year}`;
  }

  return `${courseName} — ${sessionDate(start)} · ${sessionTime(start)}–${sessionTime(end)} ${sessionZone(start)}`;
}

/**
 * The export filename stem: DJSTA-STD-003_CPR-AED_2026-03-14.
 *
 * Built from the course code rather than its name so the filename stays stable
 * when marketing renames the course, and sortable by date rather than by
 * whatever the browser decides.
 */
export function rosterFilename(
  courseCode: string | null,
  courseName: string,
  startsAt: Date | string,
): string {
  const date = typeof startsAt === 'string' ? new Date(startsAt) : startsAt;
  const p = parts(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const slug = (courseCode ?? courseName)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
  return `DJSTA-STD-003_${slug}_${p.year}-${p.month}-${p.day}`;
}
