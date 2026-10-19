-- Curriculum snapshots are separate from private workspace documents.
-- Keep forma_private outside the Data API's exposed schemas.
create function forma_private.share_text(value jsonb, maximum integer, required boolean default false)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select case when value is null then not required else
    jsonb_typeof(value) = 'string' and length(value #>> '{}') <= maximum
    and (not required or length(btrim(value #>> '{}')) > 0) end;
$$;
create function forma_private.valid_share_file(file jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare stage jsonb; problem jsonb; identity text[]; memberships integer := 0;
begin
  if file is null or jsonb_typeof(file) <> 'object' or octet_length(file::text) > 5242880
    or file->>'format' is distinct from 'forma-track' or file->'version' is distinct from '1'::jsonb
    or exists(select 1 from jsonb_object_keys(file) k where k not in ('format','version','track'))
    or jsonb_typeof(file->'track') is distinct from 'object' then return false; end if;
  if exists(select 1 from jsonb_object_keys(file->'track') k where k not in ('title','shareDescription','stages'))
    or not forma_private.share_text(file->'track'->'title',240,true)
    or not forma_private.share_text(file->'track'->'shareDescription',5000)
    or jsonb_typeof(file->'track'->'stages') is distinct from 'array' then return false; end if;
  if jsonb_array_length(file->'track'->'stages') > 100 then return false; end if;
  for stage in select value from jsonb_array_elements(file->'track'->'stages') loop
    if jsonb_typeof(stage) <> 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(stage) k where k not in ('title','description','suggestedTime','problems'))
      or not forma_private.share_text(stage->'title',240,true)
      or not forma_private.share_text(stage->'description',5000)
      or not forma_private.share_text(stage->'suggestedTime',240)
      or jsonb_typeof(stage->'problems') is distinct from 'array' then return false; end if;
    memberships := memberships + jsonb_array_length(stage->'problems');
    if memberships > 1000 then return false; end if;
    for problem in select value from jsonb_array_elements(stage->'problems') loop
      if jsonb_typeof(problem) <> 'object' then return false; end if;
      if exists(select 1 from jsonb_object_keys(problem) k where k not in ('title','code','url','rating','hint'))
        or not forma_private.share_text(problem->'title',240,true)
        or not forma_private.share_text(problem->'code',60,true)
        or not forma_private.share_text(problem->'url',2000,true)
        or not forma_private.share_text(problem->'hint',2000)
        then return false; end if;
      -- Direct authenticated RPC calls must obey the same resolved canonical
      -- identities as the application's allowlist serializer. In particular,
      -- a code cannot disagree with its URL, and split indices remain distinct.
      identity := regexp_match(problem->>'url', '^https://codeforces[.]com/problemset/problem/([1-9][0-9]{0,8})/([A-Z][0-9]{0,9})$');
      if identity is null then
        identity := regexp_match(problem->>'url', '^https://codeforces[.]com/gym/([1-9][0-9]{0,8})/problem/([A-Z][0-9]{0,9})$');
      end if;
      if identity is null or (problem->>'code') is distinct from identity[1] || identity[2] then return false; end if;
      if problem->'rating' is distinct from 'null'::jsonb then
        if jsonb_typeof(problem->'rating') is distinct from 'number' then return false; end if;
        if (problem->>'rating')::numeric < 0 or (problem->>'rating')::numeric > 10000
          or trunc((problem->>'rating')::numeric) <> (problem->>'rating')::numeric then return false; end if;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

create table forma_private.shared_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  -- Two independent cryptographically random v4 UUIDs provide 244 random bits.
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    check (token ~ '^[a-f0-9]{64}$'),
  file jsonb not null check (forma_private.valid_share_file(file)),
  published_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(user_id, operation_id)
);
create index shared_tracks_owner_date on forma_private.shared_tracks(user_id,published_at desc);
alter table forma_private.shared_tracks enable row level security;
alter table forma_private.shared_tracks force row level security;
revoke all on forma_private.shared_tracks from public, anon, authenticated, service_role;
grant select on forma_private.shared_tracks to authenticated, service_role;
grant usage on schema forma_private to service_role;
create policy own_shared_tracks on forma_private.shared_tracks for select to authenticated
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt())->>'is_anonymous','false') <> 'true');

create function forma_private.share_summary(share forma_private.shared_tracks)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id',share.id,'token',share.token,'title',share.file->'track'->>'title',
    'publishedAt',share.published_at,'revokedAt',share.revoked_at);
$$;

-- These narrowly scoped definer helpers enforce quotas/immutability without
-- granting direct writes to clients. They always derive ownership from Auth.
create function forma_private.publish_share(p_file jsonb, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); share forma_private.shared_tracks%rowtype;
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous','false') = 'true' then
    raise exception 'An authenticated owner is required' using errcode = '42501'; end if;
  if p_operation_id is null or not forma_private.valid_share_file(p_file) then
    raise exception 'Invalid shared curriculum' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('forma-shares:' || owner_id::text,0));
  select * into share from forma_private.shared_tracks where user_id=owner_id and operation_id=p_operation_id;
  if found then
    if share.file <> p_file then raise exception 'Publication operation changed' using errcode = '22023'; end if;
    return jsonb_build_object('share',forma_private.share_summary(share),'replayed',true);
  end if;
  if (select count(*) from forma_private.shared_tracks where user_id=owner_id) >= 100
    or (select count(*) from forma_private.shared_tracks where user_id=owner_id and published_at > now()-interval '1 hour') >= 10 then
    raise exception 'Publication limit reached' using errcode = 'P0001'; end if;
  insert into forma_private.shared_tracks(user_id,operation_id,file) values(owner_id,p_operation_id,p_file) returning * into share;
  return jsonb_build_object('share',forma_private.share_summary(share),'replayed',false);
end;
$$;
create function forma_private.revoke_share(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); share forma_private.shared_tracks%rowtype;
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous','false') = 'true' then
    raise exception 'An authenticated owner is required' using errcode = '42501'; end if;
  update forma_private.shared_tracks set revoked_at=coalesce(revoked_at,now()) where id=p_id and user_id=owner_id returning * into share;
  if not found then return null; end if;
  return forma_private.share_summary(share);
end;
$$;
create function public.forma_publish_share(p_file jsonb,p_operation_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select forma_private.publish_share(p_file,p_operation_id);
$$;
create function public.forma_revoke_share(p_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select forma_private.revoke_share(p_id);
$$;
create function public.forma_list_shares()
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false') = 'true' then
    raise exception 'An authenticated owner is required' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(forma_private.share_summary(s) order by s.published_at desc,s.id),'[]'::jsonb)
    from (select * from forma_private.shared_tracks where user_id=auth.uid() order by published_at desc,id limit 100) s);
end;
$$;
-- Only the server's secret-key client can resolve a token. It receives no owner
-- fields. Anonymous Data API callers have neither enumeration nor RPC access.
create function public.forma_resolve_share(p_token text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select file from forma_private.shared_tracks where token=p_token and revoked_at is null and p_token ~ '^[a-f0-9]{64}$';
$$;
revoke all on function forma_private.share_text(jsonb,integer,boolean),forma_private.valid_share_file(jsonb),
  forma_private.share_summary(forma_private.shared_tracks),forma_private.publish_share(jsonb,uuid),forma_private.revoke_share(uuid)
  from public,anon,authenticated,service_role;
grant execute on function forma_private.publish_share(jsonb,uuid),forma_private.revoke_share(uuid),forma_private.share_summary(forma_private.shared_tracks) to authenticated;
revoke all on function public.forma_publish_share(jsonb,uuid),public.forma_revoke_share(uuid),public.forma_list_shares(),public.forma_resolve_share(text)
  from public,anon,authenticated,service_role;
grant execute on function public.forma_publish_share(jsonb,uuid),public.forma_revoke_share(uuid),public.forma_list_shares() to authenticated;
grant execute on function public.forma_resolve_share(text) to service_role;
