-- The backing schema must remain outside Supabase's exposed schemas.
-- Only these two public RPC functions form the account-storage API.
create schema if not exists forma_private;
revoke all on schema forma_private from public, anon;
grant usage on schema forma_private to authenticated;

create table forma_private.workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  -- Transport/canonical JSON is limited to 64 MiB in Forma. JSONB carries
  -- additional internal overhead; this is a defensive database allocation cap.
  constraint bounded_workspace check (pg_column_size(data) <= 134217728)
);
create table forma_private.operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request_digest text not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

alter table forma_private.workspaces enable row level security;
alter table forma_private.workspaces force row level security;
alter table forma_private.operations enable row level security;
alter table forma_private.operations force row level security;
revoke all on forma_private.workspaces, forma_private.operations from public, anon, authenticated;
grant select, insert, update on forma_private.workspaces to authenticated;
grant select, insert on forma_private.operations to authenticated;

create policy own_workspace_read on forma_private.workspaces for select to authenticated
  using ((select auth.uid()) = user_id);
create policy own_workspace_insert on forma_private.workspaces for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy own_workspace_update on forma_private.workspaces for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_operation_read on forma_private.operations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy own_operation_insert on forma_private.operations for insert to authenticated
  with check ((select auth.uid()) = user_id);

create function public.forma_read_workspace()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  current_row forma_private.workspaces%rowtype;
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'An authenticated Forma account is required' using errcode = '42501';
  end if;
  select * into current_row from forma_private.workspaces where user_id = owner_id;
  if not found then return jsonb_build_object('revision', 0, 'data', null); end if;
  return jsonb_build_object('revision', current_row.revision, 'data', current_row.data);
end;
$$;

create function public.forma_commit_workspace(p_data jsonb, p_base_revision bigint, p_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  current_row forma_private.workspaces%rowtype;
  operation_row forma_private.operations%rowtype;
  current_revision bigint := 0;
  request_digest text;
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'An authenticated Forma account is required' using errcode = '42501';
  end if;
  if p_operation_id is null or p_base_revision is null or p_base_revision < 0
    or p_data is null or jsonb_typeof(p_data) <> 'object'
    or pg_column_size(p_data) > 134217728 then
    raise exception 'Invalid or oversized workspace request' using errcode = '22023';
  end if;
  request_digest := encode(sha256(convert_to(p_data::text || ':' || p_base_revision::text, 'UTF8')), 'hex');
  -- Serializes both first creation and updates for this owner. Different owners
  -- proceed independently; the lock is released at transaction end.
  perform pg_advisory_xact_lock(hashtextextended('forma-workspace:' || owner_id::text, 0));
  select * into current_row from forma_private.workspaces where user_id = owner_id for update;
  if found then current_revision := current_row.revision; end if;
  select * into operation_row from forma_private.operations
    where user_id = owner_id and operation_id = p_operation_id;
  if found then
    if operation_row.request_digest <> request_digest then
      return jsonb_build_object('status','operation_mismatch','revision',current_revision,'data',current_row.data);
    end if;
    -- Return the original acknowledged revision and exact validated request.
    -- No write is repeated, even if another device subsequently changed history.
    return jsonb_build_object('status','ok','revision',operation_row.revision,'data',p_data,'replayed',true);
  end if;
  if p_base_revision <> current_revision then
    return jsonb_build_object('status','conflict','revision',current_revision,'data',current_row.data);
  end if;
  if current_revision = 0 then
    insert into forma_private.workspaces(user_id,revision,data) values(owner_id,1,p_data);
    current_revision := 1;
  else
    update forma_private.workspaces set data=p_data,revision=revision+1,updated_at=now()
      where user_id=owner_id returning revision into current_revision;
  end if;
  insert into forma_private.operations(user_id,operation_id,request_digest,revision)
    values(owner_id,p_operation_id,request_digest,current_revision);
  return jsonb_build_object('status','ok','revision',current_revision,'data',p_data,'replayed',false);
end;
$$;

revoke all on function public.forma_read_workspace() from public, anon;
revoke all on function public.forma_commit_workspace(jsonb,bigint,uuid) from public, anon;
grant execute on function public.forma_read_workspace() to authenticated;
grant execute on function public.forma_commit_workspace(jsonb,bigint,uuid) to authenticated;
