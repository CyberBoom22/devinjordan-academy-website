/**
 * One scan: fetch, hash, file, classify, translate, and obey the review policy.
 *
 * The expensive half is guarded by a hash. A document whose body has not
 * changed since the last run is counted and dropped — no reclassification, no
 * model call, no write. That single check is the difference between a scanner
 * that costs pennies a month and one that re-summarises the whole of 27 CFR
 * every night.
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

/* -------------------------------------------------------------- translating */
type AiConfig = { provider: string; model: string | null; apiKey: string; enabled: boolean };

const PROMPT_VERSION = 'v1';

const SYSTEM_PROMPT = [
  'You explain firearms law to people training for security work in the United States.',
  'Summarise the provided text in plain English, in at most four sentences.',
  'State only what the text says. Do not add exceptions, penalties or related rules it does not mention.',
  'Do not give legal advice, do not tell the reader what they may or may not do personally,',
  'and do not speculate about how a court would read it.',
  'If the text is a proposal rather than law in force, say so.',
  'If the text is too fragmentary to summarise, reply exactly: INSUFFICIENT.',
].join(' ');

async function summarise(doc: FetchedDoc, ai: AiConfig): Promise<string | null> {
  // Deliberately capped: statutes are long, the first part carries the operative
  // language, and an unbounded body is an unbounded bill.
  const text = doc.body.slice(0, 12_000);
  if (text.length < 40) return null;

  const user = `Citation: ${doc.citation}\nTitle: ${doc.title}\n\n${text}`;

  try {
    if (ai.provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ai.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ai.model || 'claude-sonnet-5',
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: user }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { content?: { text?: string }[] };
      return payload.content?.[0]?.text?.trim() ?? null;
    }

    if (ai.provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
        body: JSON.stringify({
          model: ai.model || 'gpt-4o-mini',
          max_tokens: 400,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return payload.choices?.[0]?.message?.content?.trim() ?? null;
    }

    if (ai.provider === 'google') {
      const model = ai.model || 'gemini-2.0-flash';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${ai.apiKey}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ parts: [{ text: user }] }],
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      return payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
    }
  } catch {
    // A summary is a convenience. Losing one costs a sentence on a page; losing
    // the run costs the citation and the link, which are the actual product.
    return null;
  }

  return null;
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
    const [{ data: source }, { data: settings }, { data: aiRow }, { data: nodes }] =
      await Promise.all([
        supabase.from('legislation_sources').select('config').eq('key', sourceKey).maybeSingle(),
        supabase.from('scan_settings').select('*').eq('id', true).maybeSingle(),
        supabase
          .from('ai_settings')
          .select('provider, model, api_key, enabled')
          .eq('id', true)
          .maybeSingle(),
        supabase.from('jurisdiction_nodes').select('id, code'),
      ]);

    const nodeIdByCode = new Map(
      ((nodes ?? []) as { id: string; code: string }[]).map((n) => [n.code, n.id]),
    );

    const ai = aiRow as AiConfig | null;
    const canSummarise = Boolean(ai?.enabled && ai?.apiKey);

    const autoPublish = Boolean((settings as { auto_publish?: boolean } | null)?.auto_publish);
    const redraftOnChange =
      (settings as { redraft_on_change?: boolean } | null)?.redraft_on_change !== false;

    if (adapter.requiresKey) {
      // A source that needs a key it has not been given is a configuration
      // problem, not an empty result.
      const { data: keyed } = await supabase
        .from('legislation_sources')
        .select('requires_key')
        .eq('key', sourceKey)
        .maybeSingle();
      void keyed;
    }

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

      let summary: string | null = null;
      if (canSummarise && ai) {
        summary = await summarise(doc, ai);
        if (summary === 'INSUFFICIENT') summary = null;
        if (summary) outcome.summariesGenerated += 1;
      }

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
        plain_summary: summary,
        summary_model: summary ? (ai?.model ?? ai?.provider ?? null) : null,
        summary_prompt_version: summary ? PROMPT_VERSION : null,
        summary_generated_at: summary ? new Date().toISOString() : null,
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
