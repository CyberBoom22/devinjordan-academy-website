/**
 * Content models.
 *
 * These are the shapes templates render. They are deliberately separate from
 * the database row types: a template asks for a `Course`, not for whatever
 * columns `public.courses` happens to have today. That indirection is what
 * lets the schema change without touching markup — and what lets the site
 * render from built-in seed content before the database exists at all.
 */

export type ContentStatus = 'draft' | 'published' | 'archived';

export type CourseCategory = {
  id: string;
  name: string;
  /** Font Awesome class, e.g. 'fa-solid fa-shield-halved'. */
  icon: string | null;
  courses: Course[];
};

export type Course = {
  id: string;
  name: string;
  description: string;
  /** Null means "call for pricing" rather than free. */
  priceCents: number | null;
  /** Suffix such as '+' for "from this price". */
  priceNote: string | null;
  ctaLabel: string;
};

export type InstructorRecord = {
  label: string;
  value: string;
};

export type Instructor = {
  id: string;
  name: string;
  roleTitle: string | null;
  badge: string | null;
  photoUrl: string | null;
  photoAlt: string | null;
  bio: string | null;
  records: InstructorRecord[];
};

export type Stat = {
  id: string;
  value: string;
  label: string;
};

export type Pillar = {
  id: string;
  icon: string | null;
  title: string;
  body: string;
};

export type Jurisdiction = {
  code: string;
  name: string;
  isQuickPick: boolean;
};

export type NewsSource = {
  label: string;
  url: string;
};

export type NewsItem = {
  id: string;
  jurisdictionCode: string;
  category: 'legislation' | 'cases';
  title: string;
  dateLabel: string | null;
  statusLabel: string | null;
  summary: string;
  sources: NewsSource[];
};

export type OriAgency = {
  name: string;
  /** The five characters after the NJ prefix. */
  core: string;
};

export type OriCounty = {
  fips: string;
  name: string;
  agencies: OriAgency[];
};

/** Flat key/value settings shown across the site. */
export type SiteSettings = Record<string, string>;

export type ContactMethod = {
  icon: string;
  /** Bold first line — the number, street or headline. */
  primary: string;
  /** Second line — the person's name or supporting detail. */
  secondary: string;
  /** Present when the line should be a link (tel:, mailto:). */
  href?: string;
};
