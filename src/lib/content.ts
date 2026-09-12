/* ==========================================================================
   CONTENT ACCESS LAYER

   Every component reads content through these functions and never imports a
   data file directly. That indirection is the whole point: in phase 2 the
   bodies below swap from local modules to Supabase queries, and not one
   component or page has to change.

   The functions are async today even though the local implementations are
   synchronous — so that adding a real database later does not turn into a
   breaking signature change across the codebase.
   ========================================================================== */
import type {
    CourseCategory,
    NewsFeed,
    OriCounty,
    SiteSettings,
} from './types';

import { site } from '@data/site';
import { courseCategories } from '@data/courses';
import { newsFeed, newsQuickCodes } from '@data/news';
import { oriDirectory, oriTotals } from '@data/ori';

export async function getSiteSettings(): Promise<SiteSettings> {
    return site;
}

export async function getCourseCategories(): Promise<CourseCategory[]> {
    return courseCategories;
}

export async function getNewsFeed(): Promise<NewsFeed> {
    return newsFeed;
}

export async function getNewsQuickCodes(): Promise<string[]> {
    return newsQuickCodes;
}

export async function getOriDirectory(): Promise<OriCounty[]> {
    return oriDirectory;
}

export async function getOriTotals(): Promise<{ counties: number; agencies: number }> {
    return oriTotals;
}
