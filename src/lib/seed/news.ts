/**
 * News & legislation tracker.
 *
 * FEED_READY gates the whole board. While it is false the jurisdiction and
 * category pickers stay live but the entry list shows a "still being connected"
 * state instead of content — visitors never see placeholder legislation, which
 * on a compliance page would be worse than showing nothing.
 *
 * Flip it to true once real entries exist. Once the database is connected this
 * is derived from whether any published item exists, so the flag becomes
 * self-managing.
 */

import type { Jurisdiction, NewsItem } from '../content/types';

export const SEED_FEED_READY = false;

export const SEED_JURISDICTIONS: Jurisdiction[] = [
  { code: 'NJ', name: 'New Jersey', isQuickPick: true },
  { code: 'NY', name: 'New York', isQuickPick: true },
  { code: 'US', name: 'Federal', isQuickPick: true },
];

export const SEED_NEWS_ITEMS: NewsItem[] = [];
