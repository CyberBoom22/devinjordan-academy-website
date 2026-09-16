/**
 * One scan: fetch, hash, file, classify, translate, and obey the review policy.
 *
 * The expensive half is guarded by a hash. A document whose body has not
 * changed since the last run is counted and dropped — no reclassification, no
 * write, nothing queued. That single check is the difference between a scanner
 * that costs pennies a month and one that re-reads the whole of 27 CFR every
 * night.
 *
 * Translation is NOT done here. See src/lib/scan/translate.ts: finding a law
 * and explaining it have different costs and different failure modes, and when
 * they shared a step a model outage silently cost the corpus a summary nothing
 * would ever revisit — the source text was unchanged, so its hash never moved
 * again. The scan files what it found and marks it pending; the translation
 * stage drains that queue on its own terms.
 */

import type { Client } from '../supabase/server';
import type { FetchedDoc, ScanOutcome } from './types';
import { ADAPTERS, NOT_YET_IMPLEMENTED } from './sources';

/** Per invocation. A Worker request has a CPU budget; a corpus does not care. */
const DOCUMENTS_PER_RUN = 25;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------- classifying */
/**
 * Which firearm topics a document touches.
 *
 * Statutes name their subject explicitly — they have to, to be enforceable —
 * so keywords over the verbatim text carry most of this, and cost nothing. The
 * residue is what the review queue is for.
 */
const CATEGORY_PATTERNS: [string, RegExp][] = [
  ['handgun', /\bhandgun|\bpistol|\brevolver/i],
  ['rifle', /\brifle\b|\blong gun/i],
  ['shotgun', /\bshotgun/i],
  ['assault_weapon', /assault weapon|assault firearm|\bAR-15\b/i],
  ['sbr', /short[- ]barrel/i],
  ['suppressor', /suppressor|silencer/i],
  ['magazine', /magazine|feeding device|\brounds?\b/i],
  ['ammunition', /ammunition|\bcartridge|\bprimer\b/i],
  ['carry', /\bcarry\b|concealed|\btransport/i],
  ['purchase', /purchase|transfer|background check|\bdealer\b|waiting period/i],
  ['storage', /\bstorage\b|safely stored|child access/i],
  ['prohibited', /prohibited person|may not possess|disqualif/i],
];

function classify(doc: FetchedDoc): string[] {
  const text = `${doc.title}\n${doc.body}`;
  return CATEGORY_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
}

/* ------------------------------------------------------------------ the run */
export async function runScan(
  supabase: Client,
  sourceKey: string,
  triggeredBy: string | null,
): Promise<ScanOutcome> {
  const outcome: ScanOutcome = {
    documentsSeen: 0,
    documentsChanged: 0,
    entriesCreated: 0,
    entriesUpdated: 0,
    summariesGenerated: 0,
  };

  if (NOT_YET_IMPLEMENTED.includes(sourceKey)) {
    return { ...outcome, error: `No adapter for "${sourceKey}" yet.` };
  }

  const adapter = ADAPTERS[sourceKey];
  if (!adapter) return { ...outcome, error: `Unknown source "${sourceKey}".` };

  const { data: run } = await supabase
    .from('scan_runs')
    .insert({ source_key: sourceKey, status: 'running', triggered_by: triggeredBy })
    .select('id')
    .single();
  const runId = (run as { id: string } | null)?.id ?? null;

  const finish = async (result: ScanOutcome): Promise<ScanOutcome> => {
    if (runId) {
      await supabase
        .from('scan_runs')
        .update({
          status: result.error ? 'failed' : 'succeeded',
          finished_at: new Date().toISOString(),
          documents_seen: result.documentsSeen,
          documents_changed: result.documentsChanged,
          entries_created: result.entriesCreated,
          entries_updated: result.entriesUpdated,
          summaries_generated: result.summariesGenerated,
          error: result.error ?? null,
        })
        .eq('id', runId);
    }
    await supabase
      .from('legislation_sources')
      .update({ last_run_at: new Date().toISOString() })
      .eq('key', sourceKey);
    return result;
  };

  try {
    // No AI read here at all: the scan does not translate, so it has no
    // business holding a key.
    const [{ data: source }, { data: settings }, { data: nodes }] = await Promise.all([
      supabase.from('legislation_sources').select('config').eq('key', sourceKey).maybeSingle(),
      supabase.from('scan_settings').select('*').eq('id', true).maybeSingle(),
      supabase.from('jurisdiction_nodes').select('id, code'),
    ]);

    const nodeIdByCode = new Map(
      ((nodes ?? []) as { id: string; code: string }[]).map((n) => [n.code, n.id]),
    );

    const autoPublish = Boolean((settings as { auto_publish?: boolean } | null)?.auto_publish);
    const redraftOnChange =
      (settings as { redraft_on_change?: boolean } | null)?.redraft_on_change !== false;

    const docs = await adapter.fetch({
      config: ((source as { config?: Record<string, unknown> } | null)?.config ?? {}) as Record<
        string,
        unknown
      >,
      // Source API keys are not the AI key and are not stored yet; a source
      // needing one returns nothing and says so below.
      apiKey: undefined,
      limit: DOCUMENTS_PER_RUN,
    });

    if (docs.length === 0 && adapter.requiresKey) {
      return finish({
        ...outcome,
        error: `${sourceKey} needs an API key, which is not configured.`,
      });
    }

    for (const doc of docs) {
      outcome.documentsSeen += 1;

      const jurisdictionId = nodeIdByCode.get(doc.jurisdictionCode);
      if (!jurisdictionId || !doc.sourceId || !doc.url) continue;

      const hash = await sha256(doc.body);

      const { data: existingDoc } = await supabase
        .from('raw_documents')
        .select('id, content_hash')
        .eq('source_key', sourceKey)
        .eq('source_id', doc.sourceId)
        .maybeSingle();

      const previousHash = (existingDoc as { content_hash?: string } | null)?.content_hash;

      // The whole economy of the scanner, in one comparison.
      if (previousHash === hash) continue;
      outcome.documentsChanged += 1;

      const { data: savedDoc } = await supabase
        .from('raw_documents')
        .upsert(
          {
            source_key: sourceKey,
            source_id: doc.sourceId,
            url: doc.url,
            title: doc.title,
            body: doc.body,
            content_hash: hash,
            fetched_at: new Date().toISOString(),
            scan_run_id: runId,
          },
          { onConflict: 'source_key,source_id' },
        )
        .select('id')
        .single();

      const { data: existingEntry } = await supabase
        .from('legislation_entries')
        .select('id, status')
        .eq('jurisdiction_id', jurisdictionId)
        .eq('citation', doc.citation)
        .maybeSingle();

      // A published entry whose law has changed goes back to draft unless the
      // academy has said otherwise: otherwise the page keeps serving text that
      // was approved before the amendment.
      const wasPublished = (existingEntry as { status?: string } | null)?.status === 'published';
      const status = autoPublish
        ? 'published'
        : wasPublished && !redraftOnChange
          ? 'published'
          : 'draft';

      const row = {
        jurisdiction_id: jurisdictionId,
        raw_document_id: (savedDoc as { id: string } | null)?.id ?? null,
        citation: doc.citation,
        title: doc.title,
        source_url: doc.url,
        excerpt: doc.body.slice(0, 4000),
        content_hash: hash,
        stage: doc.stage ?? 'proposed',
        court_status: doc.courtStatus ?? 'none',
        status_label: doc.statusLabel ?? null,
        introduced_at: doc.introducedAt ?? null,
        enacted_at: doc.enactedAt ?? null,
        effective_at: doc.effectiveAt ?? null,
        // The text changed, so any summary of the old text is now wrong.
        // Cleared and re-queued rather than left to look current.
        plain_summary: null,
        summary_status: 'pending',
        summary_attempts: 0,
        summary_error: null,
        summary_model: null,
        summary_prompt_version: null,
        summary_generated_at: null,
        status,
        auto_published: autoPublish,
        last_seen_at: new Date().toISOString(),
        ...(status === 'published' && autoPublish
          ? { published_at: new Date().toISOString() }
          : {}),
      };

      const { data: entry } = await supabase
        .from('legislation_entries')
        .upsert(row, { onConflict: 'jurisdiction_id,citation' })
        .select('id')
        .single();

      const entryId = (entry as { id: string } | null)?.id;
      if (!entryId) continue;

      if (existingEntry) outcome.entriesUpdated += 1;
      else outcome.entriesCreated += 1;

      const categories = classify(doc);
      if (categories.length) {
        await supabase.from('legislation_entry_categories').upsert(
          categories.map((key) => ({ entry_id: entryId, category_key: key })),
          { onConflict: 'entry_id,category_key' },
        );
      }

      // The timeline. Written on every change, so "what moved since I last
      // looked" is a query rather than a memory.
      await supabase.from('legislation_status_events').insert({
        entry_id: entryId,
        stage: doc.stage ?? null,
        court_status: doc.courtStatus ?? null,
        note: existingEntry ? 'Source text changed' : 'First seen',
        source_url: doc.url,
        scan_run_id: runId,
      });
    }

    return finish(outcome);
  } catch (error) {
    return finish({ ...outcome, error: error instanceof Error ? error.message : String(error) });
  }
}
