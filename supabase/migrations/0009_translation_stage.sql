-- ===========================================================================
-- 0009 — Translation as a stage of its own
--
-- The scanner summarised inline: fetch a document, and if a model happened to
-- be configured at that moment, summarise it in the same breath. That couples
-- two jobs with different economics and different failure modes, and it fails
-- in three ways that are invisible until somebody goes looking.
--
--   An entry scanned while no provider was configured never gets a summary.
--   Nothing revisits it, because nothing records that it is owed one.
--
--   A summary that fails — a timeout, a rate limit, a bad key — is lost until
--   the source text changes again. It usually never does. Statutes are stable;
--   that is rather the point of them.
--
--   The prompt cannot be improved. Rewording it helps only documents that
--   happen to change afterwards, so the corpus ends up summarised by whichever
--   prompt was current on the day each entry arrived.
--
-- So translation becomes a queue with state. The scanner files what it found
-- and marks it pending; the translation stage drains that queue on its own
-- schedule, records what happened to each attempt, and can be pointed at the
-- whole corpus again when the prompt or the model changes.
--
-- Between the scan and the public page, which is where it belongs: a summary
-- is not part of finding a law, and the citation and the link — the things
-- that are actually load-bearing — should never wait on a model.
-- ===========================================================================

do $$ begin
  create type public.summary_status as enum (
    -- Owed a summary and has not had one attempted.
    'pending',
    -- Has one.
    'ok',
    -- The model was asked and said the text was too fragmentary to summarise.
    -- A real answer, not a failure: it should not be retried forever.
    'insufficient',
    -- The attempt errored. Retried up to the cap, then left alone.
    'failed',
    -- Deliberately not summarised.
    'skipped'
  );
exception when duplicate_object then null;
end $$;

alter table public.legislation_entries
  add column if not exists summary_status   public.summary_status not null default 'pending',
  add column if not exists summary_attempts integer not null default 0,
  add column if not exists summary_error    text,
  add column if not exists summary_skipped_reason text;

-- Entries that already carry a summary from the inline era are not pending.
update public.legislation_entries
set summary_status = 'ok'
where plain_summary is not null and summary_status = 'pending';

create index if not exists legislation_entries_summary_status_idx
  on public.legislation_entries (summary_status)
  where summary_status in ('pending', 'failed');

-- --- The queue -------------------------------------------------------------
-- What the translation stage should pick up next, and why. Three attempts is
-- the cap: past that a failure is a configuration problem rather than weather,
-- and retrying it forever spends money to keep proving the same point.
create or replace function app.translation_prompt_version()
returns text language sql immutable set search_path = '' as $$ select 'v1'::text $$;

create or replace view public.translation_queue
with (security_invoker = true) as
select
  e.id,
  e.citation,
  e.title,
  e.excerpt,
  e.status,
  e.summary_status,
  e.summary_attempts,
  e.summary_error,
  e.summary_prompt_version,
  j.code as jurisdiction_code,
  case
    when e.summary_status = 'pending' then 'never attempted'
    when e.summary_status = 'failed'  then 'previous attempt failed'
    else 'prompt has changed since this was written'
  end as reason
from public.legislation_entries e
join public.jurisdiction_nodes j on j.id = e.jurisdiction_id
where
  e.excerpt is not null
  and length(e.excerpt) >= 40
  and (
    e.summary_status = 'pending'
    or (e.summary_status = 'failed' and e.summary_attempts < 3)
    -- A summary written by a superseded prompt is stale even though it exists.
    or (e.summary_status = 'ok'
        and coalesce(e.summary_prompt_version, '') <> app.translation_prompt_version())
  );

comment on view public.translation_queue is
  'Entries owed a plain-English summary, and why. security_invoker, so the legislation_entries policy decides who sees rows.';

grant select on public.translation_queue to authenticated;
grant execute on function app.translation_prompt_version() to authenticated;

-- --- Re-running the whole corpus -------------------------------------------
-- Changing the prompt or the model should be able to reach everything already
-- written, not only whatever happens to change next.
create or replace function public.retranslate_all(p_include_ok boolean default true)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  affected integer;
begin
  if not app.has_permission('news.write') then
    raise exception 'You do not have permission to run the translation stage.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.legislation_entries
  set summary_status = 'pending',
      summary_attempts = 0,
      summary_error = null
  where summary_status in ('failed', 'insufficient')
     or (p_include_ok and summary_status = 'ok');

  get diagnostics affected = row_count;

  perform app.record_audit('translation.requeue', 'legislation_entries', 'bulk',
    format('Re-queued %s entries for translation', affected), null);

  return affected;
end;
$$;

grant execute on function public.retranslate_all(boolean) to authenticated;
