-- Atomic delivery of a preview using the existing command validation/audit path.
-- The outer receipt survives a lost API response; workspace version fences stale previews.
-- Align the legacy write guard with LegalBasisSchema: no invented review date
-- for unknown/unknown. Reviewed bases still require a real calendar date.
do $$
declare
  definition text:=pg_get_functiondef('public.apply_legacy_command_ux(jsonb,integer,text)'::regprocedure);
  old_guard text:='if coalesce(item#>>''{legalBasis,checkedAt}'','''')='''' or not public.is_valid_date(item#>>''{legalBasis,checkedAt}'') then raise exception ''INVALID_CHECKED_AT''; end if;';
  new_guard text:='if (coalesce(item#>>''{legalBasis,checkedAt}'','''')='''' and item#>>''{legalBasis,status}''<>''unknown'') or (coalesce(item#>>''{legalBasis,checkedAt}'','''')<>'''' and not public.is_valid_date(item#>>''{legalBasis,checkedAt}'')) then raise exception ''INVALID_CHECKED_AT''; end if;';
begin
  if position(old_guard in definition)=0 then raise exception 'CHECKED_AT_GUARD_NOT_FOUND'; end if;
  execute replace(definition,old_guard,new_guard);
end;
$$;

create or replace function public.apply_registry_import(commands jsonb, expected_version integer, batch_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces%rowtype;
  receipt public.command_receipts%rowtype;
  operation jsonb;
  result jsonb;
  current_version integer;
  i integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if batch_id !~ '^registry-[a-f0-9-]{36}$' or batch_id is null
    or jsonb_typeof(commands) is distinct from 'array' or jsonb_array_length(commands)>400
  then raise exception 'INVALID_IMPORT'; end if;
  select * into w from public.workspaces where owner_id=auth.uid() for update;
  if not found then raise exception 'WORKSPACE_NOT_FOUND'; end if;
  select * into receipt from public.command_receipts where owner_id=auth.uid() and command_id=batch_id;
  if found then
    if receipt.payload is distinct from jsonb_build_object('type','registry.import','commands',commands) then raise exception 'COMMAND_ID_REUSED'; end if;
    return jsonb_build_object('version',w.version,'replayed',true);
  end if;
  if w.version is distinct from expected_version then raise exception 'STALE_VERSION'; end if;
  current_version := w.version;
  for operation in select value from jsonb_array_elements(commands) loop
    if coalesce(operation->>'type','') not in ('complex','artifact.register') then raise exception 'INVALID_IMPORT_COMMAND'; end if;
    -- Imports may add objects, never overwrite an analyst's existing card.
    if operation->>'type'='complex' and exists(select 1 from jsonb_array_elements(w.data->'complexes') z where z->>'id'=operation#>>'{complex,id}') then raise exception 'IMPORT_OBJECT_EXISTS'; end if;
    result := public.apply_command(operation,current_version,batch_id||'-'||i::text);
    current_version := (result->>'version')::integer;
    i := i+1;
  end loop;
  insert into public.command_receipts(owner_id,command_id,payload,result_version)
    values(auth.uid(),batch_id,jsonb_build_object('type','registry.import','commands',commands),current_version);
  return jsonb_build_object('version',current_version,'replayed',false);
end;
$$;
revoke all on function public.apply_registry_import(jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.apply_registry_import(jsonb,integer,text) to authenticated;
