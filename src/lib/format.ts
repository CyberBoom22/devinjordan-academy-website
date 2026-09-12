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
