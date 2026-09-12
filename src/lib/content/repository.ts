/**
 * Content repository — the single door between templates and where content
 * actually lives.
 *
 * Every function follows the same contract: try the database, and fall back to
 * the built-in seed content if Supabase is not configured or the query fails.
 * A failure is logged and swallowed rather than thrown, because a content
 * outage should degrade the page to slightly-stale, not to a 500. The one
 * thing that never falls back is anything behind a permission — that would be
 * a security decision, and security decisions belong to the database.
 */

import type { Client } from '../supabase/server';
import type {
  CourseCategory,
  Instructor,
  Jurisdiction,
  NewsItem,
  OriCounty,
  Pillar,
  SiteSettings,
  Stat,
} from './types';
import { SEED_SETTINGS, SEED_COPY } from '../seed/site';
import { SEED_COURSE_CATEGORIES } from '../seed/courses';
import { SEED_ABOUT_PILLARS, SEED_ABOUT_STATS, SEED_INSTRUCTORS } from '../seed/about';
import { SEED_JURISDICTIONS, SEED_NEWS_ITEMS, SEED_FEED_READY } from '../seed/news';
import { SEED_ORI_COUNTIES } from '../seed/ori';

/**
 * Run a query, falling back to seed content on any failure.
 *
 * The query is typed as PromiseLike rather than Promise because Supabase's
 * query builders are thenables — awaitable, but without .catch or .finally.
 */
async function withFallback<T>(
  label: string,
  fallback: T,
  query: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  map: (data: never) => T,
): Promise<T> {
  try {
    const { data, error } = await query();
    if (error) {
      console.warn(`[content] ${label} failed, using seed content: ${error.message}`);
      return fallback;
    }
    if (!data || (Array.isArray(data) && data.length === 0)) return fallback;
    return map(data as never);
  } catch (cause) {
    console.warn(`[content] ${label} threw, using seed content:`, cause);
    return fallback;
  }
}

/* -------------------------------------------------------------------------
 * Settings and copy
 * ---------------------------------------------------------------------- */

export async function getSettings(supabase: Client | null): Promise<SiteSettings> {
  if (!supabase) return SEED_SETTINGS;

  return withFallback(
    'settings',
    SEED_SETTINGS,
    () => supabase.from('site_settings').select('key, value'),
    (rows: { key: string; value: string | null }[]) => {
      // Seed values stay as defaults so a setting the academy has not filled
      // in yet still renders something sensible.
      const settings: SiteSettings = { ...SEED_SETTINGS };
      for (const row of rows) if (row.value) settings[row.key] = row.value;
      return settings;
    },
  );
}

export async function getCopy(supabase: Client | null): Promise<Record<string, string>> {
  if (!supabase) return SEED_COPY;

  return withFallback(
    'copy blocks',
    SEED_COPY,
    () => supabase.from('content_blocks').select('page_slug, key, value'),
    (rows: { page_slug: string; key: string; value: string | null }[]) => {
      const copy = { ...SEED_COPY };
      for (const row of rows) {
        if (row.value) copy[`${row.page_slug}.${row.key}`] = row.value;
      }
      return copy;
    },
  );
}

/* -------------------------------------------------------------------------
 * Courses
 * ---------------------------------------------------------------------- */

export async function getCourseCategories(supabase: Client | null): Promise<CourseCategory[]> {
  if (!supabase) return SEED_COURSE_CATEGORIES;

  return withFallback(
    'courses',
    SEED_COURSE_CATEGORIES,
    () =>
      supabase
        .from('course_categories')
        .select(
          'id, name, icon, sort_order, courses(id, name, description, price_cents, price_note, cta_label, sort_order, status)',
        )
        .eq('status', 'published')
        .order('sort_order'),
    (
      rows: {
        id: string;
        name: string;
        icon: string | null;
        courses: {
          id: string;
          name: string;
          description: string | null;
          price_cents: number | null;
          price_note: string | null;
          cta_label: string;
          sort_order: number;
          status: string;
        }[];
      }[],
    ) =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        icon: row.icon,
        courses: (row.courses ?? [])
          .filter((course) => course.status === 'published')
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((course) => ({
            id: course.id,
            name: course.name,
            description: course.description ?? '',
            priceCents: course.price_cents,
            priceNote: course.price_note,
            ctaLabel: course.cta_label,
          })),
      })),
  );
}

/* -------------------------------------------------------------------------
 * About page
 * ---------------------------------------------------------------------- */

export async function getStats(supabase: Client | null, pageSlug: string): Promise<Stat[]> {
  if (!supabase) return pageSlug === 'about' ? SEED_ABOUT_STATS : [];

  return withFallback(
    `stats for ${pageSlug}`,
    pageSlug === 'about' ? SEED_ABOUT_STATS : [],
    () =>
      supabase
        .from('stats')
        .select('id, value, label')
        .eq('page_slug', pageSlug)
        .eq('status', 'published')
        .order('sort_order'),
    (rows: Stat[]) => rows,
  );
}

export async function getPillars(supabase: Client | null, pageSlug: string): Promise<Pillar[]> {
  if (!supabase) return pageSlug === 'about' ? SEED_ABOUT_PILLARS : [];

  return withFallback(
    `pillars for ${pageSlug}`,
    pageSlug === 'about' ? SEED_ABOUT_PILLARS : [],
    () =>
      supabase
        .from('pillars')
        .select('id, icon, title, body')
        .eq('page_slug', pageSlug)
        .eq('status', 'published')
        .order('sort_order'),
    (rows: Pillar[]) => rows,
  );
}

export async function getInstructors(supabase: Client | null): Promise<Instructor[]> {
  if (!supabase) return SEED_INSTRUCTORS;

  return withFallback(
    'instructors',
    SEED_INSTRUCTORS,
    () =>
      supabase
        .from('instructors')
        .select(
          'id, name, role_title, badge, photo_url, photo_alt, bio, instructor_records(label, value, sort_order)',
        )
        .eq('status', 'published')
        .order('sort_order'),
    (
      rows: {
        id: string;
        name: string;
        role_title: string | null;
        badge: string | null;
        photo_url: string | null;
        photo_alt: string | null;
        bio: string | null;
        instructor_records: { label: string; value: string; sort_order: number }[];
      }[],
    ) =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        roleTitle: row.role_title,
        badge: row.badge,
        photoUrl: row.photo_url,
        photoAlt: row.photo_alt,
        bio: row.bio,
        records: (row.instructor_records ?? [])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(({ label, value }) => ({ label, value })),
      })),
  );
}

/* -------------------------------------------------------------------------
 * News & legislation
 * ---------------------------------------------------------------------- */

export async function getJurisdictions(supabase: Client | null): Promise<Jurisdiction[]> {
  if (!supabase) return SEED_JURISDICTIONS;

  return withFallback(
    'jurisdictions',
    SEED_JURISDICTIONS,
    () => supabase.from('jurisdictions').select('code, name, is_quick_pick').order('sort_order'),
    (rows: { code: string; name: string; is_quick_pick: boolean }[]) =>
      rows.map(({ code, name, is_quick_pick }) => ({ code, name, isQuickPick: is_quick_pick })),
  );
}

export async function getNewsItems(supabase: Client | null): Promise<NewsItem[]> {
  if (!supabase) return SEED_NEWS_ITEMS;

  return withFallback(
    'news items',
    SEED_NEWS_ITEMS,
    () =>
      supabase
        .from('news_items')
        .select(
          'id, jurisdiction_code, category, title, date_label, status_label, summary, news_sources(label, url, sort_order)',
        )
        .eq('status', 'published')
        .order('sort_order'),
    (
      rows: {
        id: string;
        jurisdiction_code: string;
        category: 'legislation' | 'cases';
        title: string;
        date_label: string | null;
        status_label: string | null;
        summary: string;
        news_sources: { label: string; url: string; sort_order: number }[];
      }[],
    ) =>
      rows.map((row) => ({
        id: row.id,
        jurisdictionCode: row.jurisdiction_code,
        category: row.category,
        title: row.title,
        dateLabel: row.date_label,
        statusLabel: row.status_label,
        summary: row.summary,
        sources: (row.news_sources ?? [])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(({ label, url }) => ({ label, url })),
      })),
  );
}

/**
 * Whether the news board shows entries or its "being connected" state.
 *
 * Derived rather than configured: once a single published item exists the
 * board goes live by itself, so nobody has to remember to flip a switch.
 */
export async function isNewsFeedReady(supabase: Client | null): Promise<boolean> {
  if (!supabase) return SEED_FEED_READY;

  try {
    const { count, error } = await supabase
      .from('news_items')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published');
    if (error) return SEED_FEED_READY;
    return (count ?? 0) > 0;
  } catch {
    return SEED_FEED_READY;
  }
}

/* -------------------------------------------------------------------------
 * ORI directory
 * ---------------------------------------------------------------------- */

export async function getOriCounties(supabase: Client | null): Promise<OriCounty[]> {
  if (!supabase) return SEED_ORI_COUNTIES;

  return withFallback(
    'ORI directory',
    SEED_ORI_COUNTIES,
    () =>
      supabase
        .from('ori_counties')
        .select('fips, name, sort_order, ori_agencies(name, ori_core, status)')
        .order('sort_order'),
    (
      rows: {
        fips: string;
        name: string;
        ori_agencies: { name: string; ori_core: string; status: string }[];
      }[],
    ) =>
      rows.map((row) => ({
        fips: row.fips,
        name: row.name,
        agencies: (row.ori_agencies ?? [])
          .filter((agency) => agency.status === 'published')
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((agency) => ({ name: agency.name, core: agency.ori_core })),
      })),
  );
}
