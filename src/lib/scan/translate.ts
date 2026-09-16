/**
 * The translation stage: between finding a law and showing it to anybody.
 *
 * Kept apart from the scan on purpose. Finding a law and explaining it have
 * different economics — one is a cheap conditional GET, the other costs money
 * per document — and different failure modes. Coupling them meant a model
 * outage silently cost the corpus a summary that nothing would ever revisit,
 * because the source text was unchanged and the hash never moved again.
 *
 * Now the scanner files what it found and marks it pending. This drains that
 * queue, records what happened to every attempt, and can be pointed at
 * everything already written when the prompt or the model changes.
 *
 * What it never does is block the citation and the link. Those are the
 * load-bearing parts of an entry; the summary is a convenience laid on top.
 */

import type { Client } from '../supabase/server';

/** Bumped when the prompt changes materially. Must match
 *  app.translation_prompt_version() in migration 0009, which is what decides
 *  that an existing summary has gone stale. */
export const PROMPT_VERSION = 'v1';

/** Per invocation. Each item is a model call, so this is a bill as well as a
 *  CPU budget. */
const ENTRIES_PER_RUN = 10;

export type AiConfig = {
  provider: string;
  model: string | null;
  apiKey: string;
  enabled: boolean;
};

export type TranslationOutcome = {
  attempted: number;
  written: number;
  insufficient: number;
  failed: number;
  error?: string;
};

/**
 * Narrow on purpose.
 *
 * Every instruction here exists because its absence is a way for a summary of
 * a firearms statute to mislead somebody who is about to act on it. The model
 * is asked to report the text, not to interpret it, not to apply it to the
 * reader, and to say so plainly when the text does not support a summary at
 * all rather than producing a confident one anyway.
 */
const SYSTEM_PROMPT = [
  'You explain United States firearms law to people training for security work.',
  'Summarise the provided text in plain English, in at most four sentences.',
  'State only what the text itself says.',
  'Do not add exceptions, penalties, definitions or related rules it does not mention.',
  'Do not give legal advice and do not tell the reader what they personally may or may not do.',
  'Do not speculate about how a court would read it or whether it is likely to change.',
  'If the text is a proposal rather than law in force, say so in the first sentence.',
  'If the text is too fragmentary to summarise honestly, reply with exactly: INSUFFICIENT',
].join(' ');

type Attempt = { summary: string | null; error: string | null };

async function callModel(
  citation: string,
  title: string,
  body: string,
  ai: AiConfig,
): Promise<Attempt> {
  // Statutes run long and the operative language is at the front. An unbounded
  // body is an unbounded bill.
  const text = body.slice(0, 12_000);
  const user = `Citation: ${citation}\nTitle: ${title}\n\n${text}`;

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
      if (!response.ok) return { summary: null, error: `Anthropic returned ${response.status}` };
      const payload = (await response.json()) as { content?: { text?: string }[] };
      return { summary: payload.content?.[0]?.text?.trim() ?? null, error: null };
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
      if (!response.ok) return { summary: null, error: `OpenAI returned ${response.status}` };
      const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      return { summary: payload.choices?.[0]?.message?.content?.trim() ?? null, error: null };
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
      if (!response.ok) return { summary: null, error: `Google returned ${response.status}` };
      const payload = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      return {
        summary: payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null,
        error: null,
      };
    }

    return { summary: null, error: `Unknown provider "${ai.provider}"` };
  } catch (error) {
    return { summary: null, error: error instanceof Error ? error.message : String(error) };
  }
}

type QueueRow = {
  id: string;
  citation: string;
  title: string;
  excerpt: string;
  summary_attempts: number;
};

export async function runTranslation(
  supabase: Client,
  limit: number = ENTRIES_PER_RUN,
): Promise<TranslationOutcome> {
  const outcome: TranslationOutcome = { attempted: 0, written: 0, insufficient: 0, failed: 0 };

  const { data: aiRow } = await supabase
    .from('ai_settings')
    .select('provider, model, api_key, enabled')
    .eq('id', true)
    .maybeSingle();

  const ai = aiRow as {
    provider: string;
    model: string | null;
    api_key: string | null;
    enabled: boolean;
  } | null;

  if (!ai?.enabled) {
    return {
      ...outcome,
      error: 'No AI provider is switched on. Entries keep their citation and link.',
    };
  }
  if (!ai.api_key) {
    return { ...outcome, error: 'The AI provider has no API key configured.' };
  }

  const config: AiConfig = {
    provider: ai.provider,
    model: ai.model,
    apiKey: ai.api_key ?? '',
    enabled: ai.enabled,
  };

  const { data: queue, error: queueError } = await supabase
    .from('translation_queue')
    .select('id, citation, title, excerpt, summary_attempts')
    .limit(limit);

  if (queueError) return { ...outcome, error: queueError.message };

  for (const row of (queue ?? []) as unknown as QueueRow[]) {
    outcome.attempted += 1;

    const { summary, error } = await callModel(row.citation, row.title, row.excerpt, config);
    const attempts = (row.summary_attempts ?? 0) + 1;

    if (error || !summary) {
      outcome.failed += 1;
      await supabase
        .from('legislation_entries')
        .update({
          summary_status: 'failed',
          summary_attempts: attempts,
          summary_error: error ?? 'The model returned nothing.',
        })
        .eq('id', row.id);
      continue;
    }

    // A refusal to summarise is an answer, not a failure — and retrying it
    // would spend money to be told the same thing.
    if (summary.trim().toUpperCase().startsWith('INSUFFICIENT')) {
      outcome.insufficient += 1;
      await supabase
        .from('legislation_entries')
        .update({
          summary_status: 'insufficient',
          summary_attempts: attempts,
          summary_error: null,
          summary_skipped_reason: 'The model judged the text too fragmentary to summarise.',
        })
        .eq('id', row.id);
      continue;
    }

    outcome.written += 1;
    await supabase
      .from('legislation_entries')
      .update({
        plain_summary: summary,
        summary_status: 'ok',
        summary_attempts: attempts,
        summary_error: null,
        summary_model: config.model ?? config.provider,
        summary_prompt_version: PROMPT_VERSION,
        summary_generated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
  }

  return outcome;
}
