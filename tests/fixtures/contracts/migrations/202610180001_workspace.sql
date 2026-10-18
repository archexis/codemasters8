-- Personal analyst workspaces. RPC-only writes keep decisions transactional.
create table public.workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"complexes":[],"ads":[],"media":[],"signals":{},"audit":[]}',
  version integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
create policy own_workspace_read on public.workspaces for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.workspaces from anon, authenticated;
grant select on public.workspaces to authenticated;

create table public.app_seed (id boolean primary key default true check (id), data jsonb not null);
alter table public.app_seed enable row level security;
revoke all on public.app_seed from anon, authenticated;

create table public.ai_usage (owner_id uuid primary key references auth.users(id) on delete cascade, window_start timestamptz not null default now(), count integer not null default 0);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create function public.consume_ai_quota() returns void language plpgsql security definer set search_path = '' as $$
declare usage public.ai_usage;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  insert into public.ai_usage(owner_id) values(auth.uid()) on conflict do nothing;
  select * into usage from public.ai_usage where owner_id=auth.uid() for update;
  if usage.window_start < now() - interval '1 hour' then
    update public.ai_usage set count=1, window_start=now() where owner_id=auth.uid();
  elsif usage.count >= 30 then raise exception 'RATE_LIMIT';
  else update public.ai_usage set count=count+1 where owner_id=auth.uid(); end if;
end $$;

create function public.initialize_workspace() returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.workspaces;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  insert into public.workspaces(owner_id,data,version) select auth.uid(),data,1 from public.app_seed on conflict do nothing;
  select * into strict w from public.workspaces where owner_id=auth.uid();
  return jsonb_build_object('data',w.data,'version',w.version);
end $$;

create function public.validate_factor(z jsonb, code text, status text, evidence jsonb) returns void language plpgsql set search_path = '' as $$
begin
  if code is null or code not in ('R1','R2','R3','R4','R5','R6') or status is null or status not in ('confirmed','hypothesis','rejected','needs-verification') then raise exception 'INVALID_FACTOR'; end if;
  if status <> 'confirmed' then return; end if;
  if coalesce(trim(evidence->>'source'),'') = '' then raise exception 'EVIDENCE_REQUIRED'; end if;
  if code='R1' and coalesce(z#>>'{legalBasis,status}','') <> 'absent-verified' then raise exception 'R1_REQUIRES_VERIFIED_ABSENCE'; end if;
  if code='R2' and coalesce(trim(evidence->>'quote'),'')='' then raise exception 'R2_REQUIRES_QUOTE'; end if;
  if code='R5' and (z->>'readinessClaimed' is null or z->>'readinessConfirmed' is null or abs((z->>'readinessClaimed')::numeric - (z->>'readinessConfirmed')::numeric)<20) then raise exception 'R5_REQUIRES_GAP'; end if;
end $$;

create function public.apply_command(command jsonb, expected_version integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces; d jsonb; z jsonb; item jsonb; factors jsonb; evidence jsonb; factor jsonb;
  operation text := command->>'type'; zk text; idx integer; code text; status text;
  reviewer text; old_claim jsonb; stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if octet_length(command::text) > 200000 then raise exception 'COMMAND_TOO_LARGE'; end if;
  select coalesce(email,id::text) into reviewer from auth.users where id=auth.uid();
  insert into public.workspaces(owner_id) values(auth.uid()) on conflict do nothing;
  select * into strict w from public.workspaces where owner_id=auth.uid() for update;
  if expected_version is null or w.version<>expected_version then raise exception 'STALE_VERSION'; end if;
  d := w.data;
  zk := coalesce(command->>'zkId',command#>>'{ad,zkId}',command#>>'{media,zkId}',command#>>'{complex,id}');
  select (ordinality-1)::integer,value into idx,z from jsonb_array_elements(d->'complexes') with ordinality where value->>'id'=zk;
  if z is null and operation<>'complex' then raise exception 'COMPLEX_NOT_FOUND'; end if;
  if operation='complex' then
    item := command->'complex';
    if coalesce(trim(item->>'name'),'')='' or coalesce(trim(item->>'address'),'')='' or coalesce(item->>'id','') !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_COMPLEX'; end if;
    if abs((item->>'lat')::numeric)>90 or abs((item->>'lng')::numeric)>180 then raise exception 'INVALID_COORDINATES'; end if;
    if (item->>'bin') is not null and item->>'bin' !~ '^[0-9]{12}$' then raise exception 'INVALID_BIN'; end if;
    if coalesce(item#>>'{legalBasis,status}','') not in ('verified','absent-verified','unknown') then raise exception 'INVALID_LEGAL_STATUS'; end if;
    if item#>>'{legalBasis,status}' <> 'unknown' and coalesce(trim(item#>>'{legalBasis,source}'),'')='' then raise exception 'LEGAL_SOURCE_REQUIRED'; end if;
    if (item->>'readinessClaimed')::numeric not between 0 and 100 then raise exception 'INVALID_READINESS'; end if;
    if z is null then
      z := item || '{"factors":[],"events":[],"sources":[],"readinessSources":[],"readinessConfirmed":null}'::jsonb;
      d := jsonb_set(d,'{complexes}',(d->'complexes') || jsonb_build_array(z));
      select (ordinality-1)::integer into idx from jsonb_array_elements(d->'complexes') with ordinality where value->>'id'=zk;
    else
      old_claim:=z->'readinessClaimed';
      z := item || jsonb_build_object('factors',z->'factors','events',z->'events','sources',z->'sources','readinessSources',z->'readinessSources','readinessConfirmed',z->'readinessConfirmed');
      if z#>>'{legalBasis,status}' <> 'absent-verified' then
        select coalesce(jsonb_agg(case when value->>'code'='R1' and value->>'status'='confirmed' then value || jsonb_build_object('status','needs-verification','updatedAt',stamp,'reviewer',reviewer) else value end),'[]') into factors from jsonb_array_elements(z->'factors');
        z := jsonb_set(z,'{factors}',factors);
      end if;
      if old_claim is distinct from z->'readinessClaimed' then
        select coalesce(jsonb_agg(case when value->>'code'='R5' then value || jsonb_build_object('status','needs-verification','updatedAt',stamp,'reviewer',reviewer) else value end),'[]') into factors from jsonb_array_elements(z->'factors');
        z := jsonb_set(z,'{factors}',factors);
      end if;
    end if;
  elsif operation='factor' then
    code:=command->>'code'; status:=command->>'status'; evidence:=command->'evidence';
  elsif operation='ad' then
    item := command->'ad';
    if coalesce(trim(item->>'text'),'')='' or length(item->>'text')>20000 or item->>'id' is null then raise exception 'INVALID_AD'; end if;
    if coalesce(item->>'url','')<>'' and item->>'url' !~ '^https?://' then raise exception 'INVALID_URL'; end if;
    if command->>'decision' not in ('saved','confirmed','rejected') or command->>'decision' is null then raise exception 'INVALID_DECISION'; end if;
    if exists(select 1 from jsonb_array_elements(d->'ads') a where a->>'id'=item->>'id' or lower(regexp_replace(trim(a->>'text'),'\s+',' ','g'))=lower(regexp_replace(trim(item->>'text'),'\s+',' ','g'))) then raise exception 'DUPLICATE_AD'; end if;
    d:=jsonb_set(d,'{ads}',jsonb_build_array(item || jsonb_build_object('decision',command->>'decision')) || (d->'ads'));
    if command->>'decision'='confirmed' and command->'hypothesis' is not null then
      code:=command#>>'{hypothesis,code}'; status:='confirmed';
      if coalesce(trim(command#>>'{hypothesis,quote}'),'')='' or position(command#>>'{hypothesis,quote}' in item->>'text')=0 then raise exception 'UNGROUNDED_QUOTE'; end if;
      evidence:=jsonb_build_object('source',coalesce(nullif(item->>'platform',''),'Ручной ввод'),'quote',command#>>'{hypothesis,quote}','adId',item->>'id','date',item->>'captureAt');
    end if;
  elsif operation='media' then
    item:=command->'media';
    if item->>'path' not like auth.uid()::text || '/' || zk || '/%' then raise exception 'INVALID_STORAGE_PATH'; end if;
    if not exists(select 1 from storage.objects where bucket_id='evidence' and name=item->>'path') then raise exception 'STORAGE_OBJECT_NOT_FOUND'; end if;
    d:=jsonb_set(d,'{media}',(d->'media') || jsonb_build_array(item));
  elsif operation='readiness' then
    if command->>'value' is null or (command->>'value')::numeric not between 0 and 100 or coalesce(trim(command->>'source'),'')='' or coalesce(command->>'date','')='' then raise exception 'INVALID_OBSERVATION'; end if;
    z:=jsonb_set(z,'{readinessConfirmed}',command->'value');
    z:=jsonb_set(z,'{readinessSources}',(z->'readinessSources') || jsonb_build_array(jsonb_build_object('value',command->'value','source',command->>'source','date',command->>'date')));
    code:='R5'; status:=case when abs((z->>'readinessClaimed')::numeric - (command->>'value')::numeric)>=20 then 'hypothesis' else 'needs-verification' end;
    evidence:=jsonb_build_object('source',command->>'source','date',command->>'date');
  elsif operation='signal' then
    status:=command->>'status';
    if status is null or status not in ('draft','confirmed','returned') or coalesce(trim(command->>'comment'),'')='' then raise exception 'INVALID_SIGNAL'; end if;
    if status='confirmed' and not exists(select 1 from jsonb_array_elements(z->'factors') f where f->>'status'='confirmed') then raise exception 'NO_CONFIRMED_FACTORS'; end if;
    d:=jsonb_set(d,array['signals',zk],jsonb_build_object('status',status,'snapshot',z,'at',stamp,'reviewer',reviewer,'comment',command->>'comment'));
  else raise exception 'UNKNOWN_COMMAND'; end if;
  if code is not null then
    perform public.validate_factor(z,code,status,evidence);
    factor:=jsonb_build_object('code',code,'status',status,'evidence',evidence,'reviewer',reviewer,'updatedAt',stamp);
    select coalesce(jsonb_agg(value),'[]') into factors from jsonb_array_elements(z->'factors') where value->>'code'<>code;
    z:=jsonb_set(z,'{factors}',factors || jsonb_build_array(factor));
  end if;
  d:=jsonb_set(d,array['complexes',idx::text],z);
  if operation<>'signal' and d#>array['signals',zk] is not null then d:=jsonb_set(d,array['signals',zk,'status'],'"draft"'); end if;
  d:=jsonb_set(d,'{audit}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'zkId',zk,'at',stamp,'reviewer',reviewer,'action',operation,'comment',coalesce(command->>'comment',command->>'source',''),'details',command)) || (d->'audit'));
  update public.workspaces set data=d,version=version+1,updated_at=now() where owner_id=auth.uid();
  return jsonb_build_object('data',d,'version',w.version+1);
end $$;

revoke all on function public.initialize_workspace(), public.apply_command(jsonb,integer), public.consume_ai_quota(), public.validate_factor(jsonb,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.initialize_workspace(), public.apply_command(jsonb,integer), public.consume_ai_quota() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('evidence','evidence',false,20971520,array['image/jpeg','image/png','image/webp','video/mp4','application/pdf']);
create policy own_evidence_read on storage.objects for select to authenticated using (bucket_id='evidence' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy own_evidence_insert on storage.objects for insert to authenticated with check (bucket_id='evidence' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy own_evidence_delete on storage.objects for delete to authenticated using (bucket_id='evidence' and (storage.foldername(name))[1]=(select auth.uid())::text);
