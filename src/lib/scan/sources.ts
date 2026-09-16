/**
 * The source adapters.
 *
 * Every one of these talks to a documented public API. None of them scrape:
 * municipal code publishers mostly forbid it in their terms, and a scraper
 * against an unversioned HTML page breaks silently the first time somebody
 * redesigns a template — which on a compliance page means quietly serving
 * yesterday's law.
 *
 * Each adapter takes a per-run limit and respects it. A Worker request cannot
 * drain 27 CFR in one go, so a run takes a bite and the next one continues;
 * nothing here tries to be complete in a single pass.
 */

import type { FetchContext, FetchedDoc, SourceAdapter } from './types';

/** Shared fetch: a timeout, a real user agent, and JSON or text. */
async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      // Several of these APIs ask for identification and rate-limit anonymous
      // callers harder. Being nameless is not anonymity here, just a worse
      // quota.
      'User-Agent': 'devinjordan-academy-legislation-scanner/1.0',
      Accept: 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`${new URL(url).host} answered ${response.status} ${response.statusText}`);
  }
  return response;
}

/** XML to something a person and a language model can both read. */
function stripTags(xml: string): string {
  return xml
    .replace(/<\/(?:P|DIV|HEAD|SECTION)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8212;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/* -------------------------------------------------------------------- eCFR */
/**
 * The ATF's own regulations: 27 CFR 478 (firearms and ammunition) and 479
 * (the NFA). No key needed.
 *
 * The structure endpoint gives the tree of sections with their headings; the
 * full endpoint gives one section's text as XML. Text is fetched per section,
 * which is why the limit matters — the whole of part 478 is several hundred
 * requests and belongs to several runs, not one.
 */
const ecfr: SourceAdapter = {
  key: 'ecfr',
  requiresKey: false,
  async fetch({ config, limit }: FetchContext): Promise<FetchedDoc[]> {
    const base = 'https://www.ecfr.gov/api/versioner/v1';
    const parts = asArray<string>(config.parts).length
      ? asArray<string>(config.parts)
      : ['478', '479'];
    // The versioner is date-addressed. "Today" is the current text.
    const date = new Date().toISOString().slice(0, 10);

    const docs: FetchedDoc[] = [];

    for (const part of parts) {
      if (docs.length >= limit) break;

      const structure = (await (
        await get(`${base}/structure/${date}/title-27.json`)
      ).json()) as Record<string, unknown>;

      // Walk the tree for section nodes belonging to this part. The shape is
      // {identifier, label_description, type, children[]}.
      const sections: { identifier: string; label: string }[] = [];
      const walk = (node: Record<string, unknown>): void => {
        const identifier = String(node.identifier ?? '');
        if (node.type === 'section' && identifier.startsWith(`${part}.`)) {
          sections.push({
            identifier,
            label: String(node.label_description ?? node.label ?? identifier),
          });
        }
        for (const child of asArray<Record<string, unknown>>(node.children)) walk(child);
      };
      walk(structure);

      for (const section of sections) {
        if (docs.length >= limit) break;

        let body = '';
        try {
          const xml = await (
            await get(
              `${base}/full/${date}/title-27.xml?part=${part}&section=${section.identifier}`,
              {
                Accept: 'application/xml',
              },
            )
          ).text();
          body = stripTags(xml);
        } catch {
          // One unreachable section is not a failed run. It keeps its old text
          // and its hash, so the next run tries again.
          continue;
        }

        docs.push({
          sourceId: `27-CFR-${section.identifier}`,
          url: `https://www.ecfr.gov/current/title-27/section-${section.identifier}`,
          citation: `27 CFR § ${section.identifier}`,
          title: section.label,
          body,
          jurisdictionCode: 'US',
          // Codified regulations are, by definition, already in force.
          stage: 'in_force',
        });
      }
    }

    return docs;
  },
};

/* -------------------------------------------------- Federal Register (ATF) */
/**
 * ATF rulemaking — proposed rules, final rules, notices. No key needed. This
 * is where a change to the regulations above shows up before it reaches them.
 */
const federalRegister: SourceAdapter = {
  key: 'federal_register',
  requiresKey: false,
  async fetch({ config, limit }: FetchContext): Promise<FetchedDoc[]> {
    const agencies = asArray<string>(config.agencies).length
      ? asArray<string>(config.agencies)
      : ['alcohol-tobacco-firearms-and-explosives-bureau'];

    const params = new URLSearchParams({
      per_page: String(Math.min(limit, 100)),
      order: 'newest',
    });
    for (const agency of agencies) params.append('conditions[agencies][]', agency);
    for (const field of [
      'document_number',
      'title',
      'html_url',
      'abstract',
      'publication_date',
      'effective_on',
      'type',
      'citation',
    ]) {
      params.append('fields[]', field);
    }

    const payload = (await (
      await get(`https://www.federalregister.gov/api/v1/documents.json?${params}`)
    ).json()) as Record<string, unknown>;

    return asArray<Record<string, unknown>>(payload.results).map((row) => {
      const type = String(row.type ?? '');
      return {
        sourceId: String(row.document_number ?? ''),
        url: String(row.html_url ?? ''),
        citation: String(row.citation ?? `FR ${row.document_number}`),
        title: String(row.title ?? 'Untitled'),
        body: String(row.abstract ?? row.title ?? ''),
        jurisdictionCode: 'US',
        // A proposed rule is not law; a final rule is. Saying so is the
        // difference between informing somebody and misleading them.
        stage: type === 'Rule' ? 'enacted' : 'proposed',
        statusLabel: type || undefined,
        effectiveAt: (row.effective_on as string) ?? null,
      };
    });
  },
};

/* -------------------------------------------------------------- OpenStates */
/**
 * State bills for the launch states. Needs a free key.
 *
 * Bills, not codified statutes: what is moving through a legislature, not
 * what is already on the books. The distinction matters enough that `stage`
 * carries it rather than the page implying every finding is law.
 */
const openstates: SourceAdapter = {
  key: 'openstates',
  requiresKey: true,
  async fetch({ config, apiKey, limit }: FetchContext): Promise<FetchedDoc[]> {
    if (!apiKey) return [];

    const states = asArray<string>(config.states).length
      ? asArray<string>(config.states)
      : ['nj', 'ny', 'pa', 'ct'];
    const query = String(config.query ?? 'firearm');
    const perState = Math.max(1, Math.floor(limit / states.length));
    const docs: FetchedDoc[] = [];

    for (const state of states) {
      const params = new URLSearchParams({
        jurisdiction: state,
        q: query,
        sort: 'updated_desc',
        per_page: String(Math.min(perState, 20)),
      });
      params.append('include', 'abstracts');

      let payload: Record<string, unknown>;
      try {
        payload = (await (
          await get(`https://v3.openstates.org/bills?${params}`, { 'X-API-KEY': apiKey })
        ).json()) as Record<string, unknown>;
      } catch {
        // One state's outage should not cost the other three.
        continue;
      }

      for (const row of asArray<Record<string, unknown>>(payload.results)) {
        const abstracts = asArray<Record<string, unknown>>(row.abstracts);
        const latest = String(row.latest_action_description ?? '');

        docs.push({
          sourceId: String(row.id ?? ''),
          url: String(row.openstates_url ?? ''),
          citation: `${state.toUpperCase()} ${String(row.identifier ?? '')}`,
          title: String(row.title ?? 'Untitled bill'),
          body: String(abstracts[0]?.abstract ?? row.title ?? ''),
          jurisdictionCode: state.toUpperCase(),
          stage: stageFromAction(latest),
          statusLabel: latest.slice(0, 60) || undefined,
          introducedAt: (row.first_action_date as string) ?? null,
        });
      }
    }

    return docs;
  },
};

/**
 * Legislatures describe themselves in prose, so this reads the prose. It is a
 * best guess that a human can correct in the review queue — which is the point
 * of there being a review queue.
 */
function stageFromAction(action: string): string {
  const text = action.toLowerCase();
  if (/signed|chaptered|enacted|became law/.test(text)) return 'enacted';
  if (/passed (both|second)|delivered to governor|to governor/.test(text))
    return 'passed_legislature';
  if (/passed|third reading/.test(text)) return 'passed_one_chamber';
  if (/committee/.test(text)) return 'in_committee';
  return 'proposed';
}

/* ------------------------------------------------------------------------- */
export const ADAPTERS: Record<string, SourceAdapter> = {
  ecfr,
  federal_register: federalRegister,
  openstates,
};

/**
 * Congress.gov and CourtListener are registered as sources and configured, but
 * have no adapter yet. Reporting that plainly beats returning an empty result,
 * which reads as "nothing found" and is a different claim entirely.
 */
export const NOT_YET_IMPLEMENTED = ['congress', 'courtlistener'];
