/**
 * What every source hands back, whatever shape it arrived in.
 *
 * Adapters differ wildly — eCFR is a versioned XML tree, OpenStates is a bill
 * feed, the Federal Register is a rulemaking index — so each one's job is to
 * flatten its own world into this, and nothing downstream needs to know which
 * it came from.
 */

export type FetchedDoc = {
  /** The upstream's own identifier. With the source key, this is what makes a
   *  document the same document on the next run rather than a new one. */
  sourceId: string;
  /** Where a person goes to read the actual law. Never generated — always the
   *  canonical link the source itself publishes. */
  url: string;
  title: string;
  /** How the law is cited. Becomes half of the entry's identity. */
  citation: string;
  /** Verbatim. What the summary is checked against when somebody disputes it. */
  body: string;
  /** Matches jurisdiction_nodes.code — 'US', 'NJ', and so on. */
  jurisdictionCode: string;
  stage?: string;
  courtStatus?: string;
  statusLabel?: string;
  introducedAt?: string | null;
  enactedAt?: string | null;
  effectiveAt?: string | null;
};

export type SourceConfig = Record<string, unknown>;

export type FetchContext = {
  config: SourceConfig;
  /** Present only for sources that need one; absent means skip, not fail. */
  apiKey?: string;
  /** Per-run ceiling. A Worker request cannot drain a whole corpus, so a run
   *  takes a bite and the next one continues. */
  limit: number;
};

export type SourceAdapter = {
  key: string;
  /** Sources needing a key report that plainly rather than returning nothing
   *  and looking like a source with no news. */
  requiresKey: boolean;
  fetch: (ctx: FetchContext) => Promise<FetchedDoc[]>;
};

export type ScanOutcome = {
  documentsSeen: number;
  documentsChanged: number;
  entriesCreated: number;
  entriesUpdated: number;
  summariesGenerated: number;
  error?: string;
};
