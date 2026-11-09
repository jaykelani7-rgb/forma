-- The handoff inbox is outside the Data API. A linked browser supplies the
-- owner, and a distinct desktop secret authorizes delivery or withdrawal.
create table forma_private.session_handoffs (
  id uuid primary key,
  account_id uuid not null references auth.users(id) on delete cascade,
  account_label text not null check (length(account_label) between 1 and 320),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  claim_digest text not null check (claim_digest ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('linked', 'ready', 'received', 'cancelled')),
  packet jsonb,
  session_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  check ((state = 'ready') = (packet is not null)),
  check (packet is null or (jsonb_typeof(packet) = 'object' and octet_length(packet::text) <= 262144)),
  check (state not in ('ready', 'received') or session_id is not null)
);

create index session_handoffs_account_date on forma_private.session_handoffs(account_id, created_at desc);
create unique index session_handoffs_one_receipt on forma_private.session_handoffs(account_id, session_id)
  where state = 'received';
alter table forma_private.session_handoffs enable row level security;
alter table forma_private.session_handoffs force row level security;
revoke all on forma_private.session_handoffs from public, anon, authenticated, service_role;
grant usage on schema forma_private to service_role;
grant select, insert, update on forma_private.session_handoffs to service_role;

create function forma_private.handoff_status(row_value forma_private.session_handoffs, include_packet boolean)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('state', row_value.state, 'accountId', row_value.account_id, 'accountLabel', row_value.account_label)
    || case when row_value.session_id is null then '{}'::jsonb else jsonb_build_object('sessionId', row_value.session_id) end
    || case when include_packet and row_value.packet is not null then jsonb_build_object('packet', row_value.packet) else '{}'::jsonb end;
$$;

-- This RPC is called only by the application's server. Browser actions reach
-- it after token verification, while native actions carry the separate key.
create function public.forma_manage_handoff(
  p_action text, p_id uuid, p_account_id uuid default null, p_account_label text default null,
  p_source_digest text default null, p_claim_digest text default null, p_packet jsonb default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare ticket forma_private.session_handoffs%rowtype;
begin
  if p_id is null or p_action is null or p_action not in ('link', 'destination-status', 'source-status', 'source-send', 'source-cancel') then
    raise exception 'invalid_handoff' using errcode = '22023';
  end if;

  if p_action = 'link' then
    if p_account_id is null or p_account_label is null or length(p_account_label) not between 1 and 320
      or p_claim_digest is null or p_claim_digest !~ '^[a-f0-9]{64}$'
      or p_source_digest is null or p_source_digest !~ '^[a-f0-9]{64}$'
      or p_source_digest = p_claim_digest then
      raise exception 'invalid_handoff' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('forma-handoff-owner:' || p_account_id::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('forma-handoff-ticket:' || p_id::text, 0));
    -- Expiration leaves a tombstone for the source, without keeping its notes.
    update forma_private.session_handoffs set state = 'cancelled', packet = null
      where account_id = p_account_id and state in ('linked', 'ready') and expires_at <= clock_timestamp();
  end if;

  select * into ticket from forma_private.session_handoffs where id = p_id for update;
  if not found then
    if p_action <> 'link' then return jsonb_build_object('state', 'missing'); end if;
    if (select count(*) from forma_private.session_handoffs where account_id = p_account_id
        and created_at > now() - interval '1 hour') >= 12
      or (select count(*) from forma_private.session_handoffs where account_id = p_account_id
        and state in ('linked', 'ready')) >= 3 then
      raise exception 'handoff_limit' using errcode = 'P0001';
    end if;
    insert into forma_private.session_handoffs(id, account_id, account_label, source_digest, claim_digest, state)
      values(p_id, p_account_id, p_account_label, p_source_digest, p_claim_digest, 'linked') returning * into ticket;
    return forma_private.handoff_status(ticket, false);
  end if;

  if p_action in ('link', 'destination-status') then
    if ticket.account_id is distinct from p_account_id or ticket.claim_digest is distinct from p_claim_digest
      or (p_action = 'link' and ticket.source_digest is distinct from p_source_digest) then
      return jsonb_build_object('state', 'missing');
    end if;
  elsif ticket.source_digest is distinct from p_source_digest then
    return jsonb_build_object('state', 'missing');
  end if;

  if ticket.state in ('linked', 'ready') and ticket.expires_at <= clock_timestamp() then
    update forma_private.session_handoffs set state = 'cancelled', packet = null
      where id = p_id returning * into ticket;
  end if;

  if p_action = 'source-cancel' and ticket.state in ('linked', 'ready') then
    update forma_private.session_handoffs set state = 'cancelled', packet = null
      where id = p_id returning * into ticket;
  elsif p_action = 'source-send' then
    if ticket.account_id is distinct from p_account_id then
      raise exception 'handoff_account_changed' using errcode = '22023';
    end if;
    if ticket.state = 'linked' then
      if p_packet is null or jsonb_typeof(p_packet) <> 'object'
        or jsonb_typeof(p_packet->'session'->'id') is distinct from 'string'
        or length(p_packet->'session'->>'id') not between 1 and 200
        or octet_length(p_packet::text) > 262144 then
        raise exception 'invalid_handoff' using errcode = '22023';
      end if;
      update forma_private.session_handoffs
        set state = 'ready', packet = p_packet, session_id = p_packet->'session'->>'id'
        where id = p_id returning * into ticket;
    elsif ticket.state = 'ready' and ticket.packet is distinct from p_packet then
      raise exception 'handoff_packet_changed' using errcode = '22023';
    end if;
  end if;

  return forma_private.handoff_status(ticket, p_action in ('link', 'destination-status'));
end;
$$;

-- Keep the mutating helper out of the exposed schema. A ready ticket and its
-- workspace update are resolved together, with the original operation ID
-- and a row lock shared by the desktop cancel/status path.
create function forma_private.receive_handoff(p_id uuid, p_claim_digest text, p_data jsonb, p_base_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  ticket forma_private.session_handoffs%rowtype;
  workspace jsonb;
  saved jsonb;
  incoming_session jsonb;
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'An authenticated Forma account is required' using errcode = '42501';
  end if;
  select * into ticket from forma_private.session_handoffs
    where id = p_id and account_id = owner_id and claim_digest = p_claim_digest for update;
  if not found then return jsonb_build_object('state', 'missing'); end if;

  if ticket.state in ('linked', 'ready') and ticket.expires_at <= clock_timestamp() then
    update forma_private.session_handoffs set state = 'cancelled', packet = null
      where id = p_id returning * into ticket;
  end if;
  if ticket.state <> 'ready' then return forma_private.handoff_status(ticket, false); end if;
  if exists(select 1 from forma_private.session_handoffs
    where account_id = owner_id and session_id = ticket.session_id and state = 'received') then
    return jsonb_build_object('state', 'ready', 'error', 'session_received');
  end if;

  workspace := public.forma_read_workspace();
  if (workspace->>'revision')::bigint is distinct from p_base_revision then
    return jsonb_build_object('state', 'ready', 'error', 'workspace_changed');
  end if;
  if jsonb_typeof(workspace->'data'->'session') = 'object' then
    return jsonb_build_object('state', 'ready', 'error', 'session_open');
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(workspace->'data'->'attempts', '[]'::jsonb)) item
    where item->>'id' = ticket.session_id) then
    return jsonb_build_object('state', 'ready', 'error', 'session_received');
  end if;

  incoming_session := p_data->'session';
  if incoming_session->'id' is distinct from ticket.packet->'session'->'id'
    or incoming_session->'elapsedMs' is distinct from ticket.packet->'session'->'elapsedMs'
    or incoming_session->'targetMinutes' is distinct from ticket.packet->'session'->'targetMinutes'
    or incoming_session->'startedAt' is distinct from ticket.packet->'session'->'startedAt'
    or incoming_session->'runningSince' is distinct from 'null'::jsonb
    or incoming_session->>'phase' is distinct from 'focus' then
    raise exception 'invalid_handoff' using errcode = '22023';
  end if;
  saved := public.forma_commit_workspace(p_data, p_base_revision, p_id);
  if saved->>'status' is distinct from 'ok' then
    return jsonb_build_object('state', 'ready', 'error', 'workspace_changed');
  end if;
  update forma_private.session_handoffs set state = 'received', packet = null
    where id = p_id returning * into ticket;
  return forma_private.handoff_status(ticket, false);
end;
$$;

create function public.forma_receive_handoff(p_id uuid, p_claim_digest text, p_data jsonb, p_base_revision bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select forma_private.receive_handoff(p_id, p_claim_digest, p_data, p_base_revision);
$$;

revoke all on function forma_private.handoff_status(forma_private.session_handoffs,boolean)
  from public, anon, authenticated, service_role;
grant execute on function forma_private.handoff_status(forma_private.session_handoffs,boolean) to service_role;
revoke all on function public.forma_manage_handoff(text,uuid,uuid,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.forma_manage_handoff(text,uuid,uuid,text,text,text,jsonb) to service_role;
revoke all on function forma_private.receive_handoff(uuid,text,jsonb,bigint), public.forma_receive_handoff(uuid,text,jsonb,bigint)
  from public, anon, authenticated, service_role;
grant execute on function forma_private.receive_handoff(uuid,text,jsonb,bigint), public.forma_receive_handoff(uuid,text,jsonb,bigint) to authenticated;
