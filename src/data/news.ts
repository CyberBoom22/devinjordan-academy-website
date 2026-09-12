import type { NewsFeed } from '@lib/types';

/* --------------------------------------------------------------------------
   NEWS & LEGISLATION

   TO ADD OR EDIT AN ENTRY: edit the `states` array below and merge to main.
   The site rebuilds and publishes automatically through GitHub — there is no
   separate deploy step.

   Each entry needs: title, date, status, summary, sources[].
   `status` must be one of: Pending | Enacted | Closed | Decided

   `ready` gates the display. While it is false the page keeps its state and
   category pickers live but shows a loading animation in place of entries, so
   visitors never see placeholder content. Flip it to true once real entries
   are in place.
   -------------------------------------------------------------------------- */
export const newsFeed: NewsFeed = {
    updated: '2026-08-14T19:00:00-04:00',
    ready: false,
    states: [
        {
            code: 'NJ',
            name: 'New Jersey',
            categories: {
                legislation: [
                    {
                        id: 'nj-example',
                        title: 'EXAMPLE ENTRY — replace before publishing',
                        date: 'Introduced August 1, 2026',
                        status: 'Pending',
                        summary:
                            'Placeholder showing where a plain-language note about a bill appears. Replace this text with a real entry, or delete the entry entirely.',
                        sources: [
                            { label: 'NJ Legislature', url: 'https://www.njleg.state.nj.us/' },
                        ],
                    },
                ],
                cases: [],
            },
        },
        {
            code: 'NY',
            name: 'New York',
            categories: { legislation: [], cases: [] },
        },
        {
            code: 'US',
            name: 'Federal',
            categories: { legislation: [], cases: [] },
        },
    ],
};

/** Quick-pick pills; the dropdown covers every jurisdiction in the feed. */
export const newsQuickCodes = ['NJ', 'NY', 'US'];
