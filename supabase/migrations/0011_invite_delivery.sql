-- ===========================================================================
-- 0011 — Invite delivery
--
-- Until now a code was minted, shown on screen once, and handed over by
-- whatever means the administrator chose. Sending it directly is better for
-- the recipient and worse for the administrator's certainty: the moment a
-- machine sends the mail, "did they get it?" stops being something anybody
-- watched happen.
--
-- So delivery gets recorded. Without this, a bounced invite looks exactly like
-- an invite somebody is ignoring, and the only remedy is to re-issue blindly
-- and hope.
--
-- An invite email carrying a one-time code is, structurally, indistinguishable
-- from phishing. Some will land in spam however clean the DNS is. That is why
-- the code stays visible on screen after sending rather than the screen
-- handing the job entirely to the mail: when delivery fails, the fallback
-- should already be in front of the person who can act on it.
-- ===========================================================================

do $$ begin
  create type public.email_delivery_status as enum (
    -- Never attempted. The administrator is passing the code on themselves.
    'not_sent',
    -- Handed to the provider, which accepted it. Not the same as delivered.
    'sent',
    -- The provider rejected it outright, or the call failed.
    'failed',
    -- The provider told us afterwards that it bounced.
    'bounced'
  );
exception when duplicate_object then null;
end $$;

alter table public.invite_codes
  add column if not exists delivery_status public.email_delivery_status not null default 'not_sent',
  add column if not exists sent_at         timestamptz,
  add column if not exists sent_to         text,
  add column if not exists send_attempts   integer not null default 0,
  add column if not exists delivery_error  text,
  -- The provider's own id, so a message can be found in their dashboard when
  -- somebody swears they never received it.
  add column if not exists provider_message_id text;

create index if not exists invite_codes_delivery_idx
  on public.invite_codes (delivery_status)
  where delivery_status in ('failed', 'bounced');

-- Recording a send is not the same permission as issuing an invite: the app
-- writes this immediately after the provider answers, as the same
-- administrator who pressed the button.
create or replace function public.record_invite_delivery(
  p_invite      uuid,
  p_status      public.email_delivery_status,
  p_to          text,
  p_message_id  text default null,
  p_error       text default null
)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  inv public.invite_codes%rowtype;
begin
  if not app.has_permission('user.invite') then
    raise exception 'You do not have permission to manage invites.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into inv from public.invite_codes where id = p_invite for update;
  if inv.id is null then
    raise exception 'No such invite.' using errcode = 'no_data_found';
  end if;

  update public.invite_codes
  set delivery_status     = p_status,
      sent_at             = case when p_status = 'sent' then now() else sent_at end,
      sent_to             = coalesce(p_to, sent_to),
      send_attempts       = send_attempts + 1,
      delivery_error      = p_error,
      provider_message_id = coalesce(p_message_id, provider_message_id)
  where id = p_invite;

  perform app.record_audit(
    'invite.' || p_status, 'invite_code', p_invite::text,
    case p_status
      when 'sent' then format('Invite emailed to %s', p_to)
      else format('Invite email to %s %s: %s', p_to, p_status, coalesce(p_error, 'no detail'))
    end,
    jsonb_build_object('email', p_to, 'status', p_status)
  );
end;
$$;

grant execute on function public.record_invite_delivery(
  uuid, public.email_delivery_status, text, text, text
) to authenticated;

-- Surface delivery alongside everything else about an invite.
create or replace view public.invite_overview
with (security_invoker = true) as
select
  i.id,
  i.email,
  i.first_name,
  i.last_name,
  trim(coalesce(i.first_name, '') || ' ' || coalesce(i.last_name, '')) as full_name,
  r.key                        as role_key,
  r.name                       as role_name,
  r.level                      as role_level,
  i.note,
  i.created_at,
  i.rotated_at,
  i.expires_at,
  i.rotation_count,
  i.redeemed_at,
  i.redeemed_by,
  i.revoked_at,
  app.invite_rotation_days(i.rotation_days) as rotation_days,
  issuer.email                 as issued_by_email,
  redeemer.email               as redeemed_by_email,
  i.delivery_status,
  i.sent_at,
  i.send_attempts,
  i.delivery_error,
  case
    when i.redeemed_at is not null then 'redeemed'
    when i.revoked_at  is not null then 'revoked'
    when i.expires_at <= now()     then 'expired'
    else 'active'
  end                          as status,
  greatest(0, extract(epoch from (i.expires_at - now()))::bigint / 86400) as days_left
from public.invite_codes i
join public.roles r            on r.id = i.role_id
left join public.profiles issuer   on issuer.id = i.created_by
left join public.profiles redeemer on redeemer.id = i.redeemed_by;

grant select on public.invite_overview to authenticated;
