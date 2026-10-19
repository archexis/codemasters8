-- UX: extend the existing owner-scoped command boundary without rewriting history.
-- The legacy implementation remains callable only by the checked facade.
do $$ begin
  execute replace(pg_get_functiondef('public.apply_command(jsonb,integer,text)'::regprocedure),
    'apply_command', 'apply_legacy_command_ux');
end $$;
revoke all on function public.apply_legacy_command_ux(jsonb,integer,text) from public,anon,authenticated;

create function public.ux_assert_keys(value jsonb, allowed text[]) returns void
language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(value) k where not(k=any(allowed))) then raise exception 'INVALID_PAYLOAD_KEYS'; end if;
end $$;
revoke all on function public.ux_assert_keys(jsonb,text[]) from public,anon,authenticated;
create function public.ux_utf16_length(value text) returns integer
language sql immutable strict set search_path='' as $$
  select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(value,'') c where c<>''
$$;
revoke all on function public.ux_utf16_length(text) from public,anon,authenticated;
create function public.ux_period_contains(cover jsonb, required_period jsonb) returns boolean language sql immutable set search_path='' as $$
  select cover is not null and required_period is not null and cover->>'from'<=required_period->>'from' and coalesce(cover->>'to','9999-12-31')>=coalesce(required_period->>'to','9999-12-31')
$$;
create function public.ux_assert_period(value jsonb) returns void language plpgsql set search_path='' as $$
begin
  perform public.ux_assert_keys(value,array['from','to']);
  if jsonb_typeof(value->'from') is distinct from 'string' or not coalesce(public.is_valid_date(value->>'from'),false) or length(value->>'from')<>10 then raise exception 'INVALID_PERIOD'; end if;
  if value ? 'to' and (jsonb_typeof(value->'to')<>'string' or not coalesce(public.is_valid_date(value->>'to'),false) or length(value->>'to')<>10 or value->>'from'>value->>'to') then raise exception 'INVALID_PERIOD'; end if;
end $$;
revoke all on function public.ux_period_contains(jsonb,jsonb), public.ux_assert_period(jsonb) from public,anon,authenticated;

create function public.ux_node_exists(d jsonb, node_id text) returns boolean language sql immutable set search_path='' as $$
  select exists(select 1 from jsonb_array_elements(coalesce(d->'complexes','[]')) z where node_id='complex:'||(z->>'id') or (z->>'bin' is not null and node_id='organization:'||(z->>'bin')))
    or exists(select 1 from jsonb_array_elements(coalesce(d->'phases','[]')) p where node_id='phase:'||(p->>'id'))
    or exists(select 1 from jsonb_array_elements(coalesce(d->'ads','[]')) a where node_id='publication:'||(a->>'id') or node_id='account:'||(a->>'platform')||':'||(a->>'account'))
    or exists(select 1 from jsonb_array_elements(coalesce(d->'artifacts','[]')) a where node_id='document:'||(a->>'id'))
$$;
create function public.ux_validate_relation(d jsonb, r jsonb) returns void language plpgsql set search_path='' as $$
declare aid text;
begin
  perform public.ux_assert_keys(r,array['id','complexId','phaseId','fromId','toId','relationType','sourceArtifactIds','matchMethod']);
  if jsonb_typeof(r->'fromId') is distinct from 'string' or jsonb_typeof(r->'toId') is distinct from 'string' or length(r->>'fromId') not between 1 and 1000 or length(r->>'toId') not between 1 and 1000 or r->>'fromId'=r->>'toId' then raise exception 'INVALID_RELATION_ENDPOINT'; end if;
  if not public.ux_node_exists(d,r->>'fromId') or not public.ux_node_exists(d,r->>'toId') then raise exception 'RELATION_ENDPOINT_NOT_FOUND'; end if;
  if coalesce(r->>'relationType','') not in ('developer_of','authorized_company_of','contractor_of','advertises','covered_by','mentions','same_ad_account','located_on') or coalesce(r->>'matchMethod','') not in ('manual','exact-id','name','address') then raise exception 'INVALID_RELATION_TYPE'; end if;
  if jsonb_typeof(r->'sourceArtifactIds') is distinct from 'array' then raise exception 'RELATION_EVIDENCE_REQUIRED'; end if;
  if exists(select 1 from jsonb_array_elements(r->'sourceArtifactIds') a where jsonb_typeof(a)<>'string') then raise exception 'INVALID_RELATION_EVIDENCE'; end if;
  for aid in select jsonb_array_elements_text(r->'sourceArtifactIds') loop
    if not exists(select 1 from jsonb_array_elements(coalesce(d->'artifacts','[]')) a where a->>'id'=aid and a->>'complexId'=r->>'complexId' and a->>'phaseId' is not distinct from r->>'phaseId') then raise exception 'RELATION_EVIDENCE_SCOPE_MISMATCH'; end if;
  end loop;
end $$;
revoke all on function public.ux_node_exists(jsonb,text),public.ux_validate_relation(jsonb,jsonb) from public,anon,authenticated;

create or replace function public.apply_command(command jsonb, expected_version integer, command_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  op text:=command->>'type'; w public.workspaces; receipt public.command_receipts;
  d jsonb; obj jsonb; z jsonb; phase jsonb; artifact jsonb; claim jsonb; cs jsonb; ev jsonb; item jsonb;
  collection text; target text; zk text; pid text; idx integer; cidx integer; actor text; code text;
  stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  selected jsonb; materials jsonb; factors jsonb; snapshot jsonb; score integer; zone text; codes text[];
  revision integer; limitations jsonb; before_value jsonb;
  legacy_result jsonb; original_data jsonb; current_z jsonb; assertion jsonb; needs_legal boolean; needs_readiness boolean;
  snapshot_ads jsonb; media_manifest jsonb;
  field text; allowed text[]; ring jsonb; point jsonb; vertex_count integer; quote_start integer; effective_period jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if op in ('complex','factor','ad','media','readiness','signal') then
    if op='complex' and command#>'{complex,legalBasis}' ? 'period' then perform public.ux_assert_period(command#>'{complex,legalBasis,period}'); end if;
    select data into original_data from public.workspaces where owner_id=auth.uid() for update;
    zk:=coalesce(command->>'zkId',command#>>'{ad,zkId}',command#>>'{complex,id}');
    -- A complex opts into the new review boundary at its first investigation.
    -- Historical workspaces remain readable/reviewable through legacy commands;
    -- receipts created before the opt-in must still replay safely.
    if exists(select 1 from jsonb_array_elements(coalesce(original_data->'cases','[]')) c where c->>'complexId'=zk)
      and ((op='factor' and command->>'status'='confirmed') or (op='ad' and command->>'decision'='confirmed' and command ? 'hypothesis') or (op='signal' and command->>'status'='confirmed'))
      and not exists(select 1 from public.command_receipts r where r.owner_id=auth.uid() and r.command_id=apply_command.command_id and r.payload=command)
    then raise exception 'CASE_REVIEW_REQUIRED: use fact.review and case.decide'; end if;
    legacy_result:=public.apply_legacy_command_ux(command,expected_version,command_id);
    if coalesce((legacy_result->>'replayed')::boolean,false) or op not in ('complex','readiness') then return legacy_result; end if;
    zk:=coalesce(command->>'zkId',command#>>'{complex,id}');
    select value into z from jsonb_array_elements(coalesce(original_data->'complexes','[]')) where value->>'id'=zk;
    d:=legacy_result->'data';
    select value into current_z from jsonb_array_elements(d->'complexes') where value->>'id'=zk;
    needs_legal:=z->'legalBasis' is distinct from current_z->'legalBasis';
    needs_readiness:=(z->'readinessClaimed',z->'readinessClaimedSource',z->'readinessConfirmed',z->'readinessSources') is distinct from (current_z->'readinessClaimed',current_z->'readinessClaimedSource',current_z->'readinessConfirmed',current_z->'readinessSources');
    select coalesce(email,id::text) into actor from auth.users where id=auth.uid();
    for assertion in select a from (
      select distinct on (a->>'caseId',a->>'claimId') a from jsonb_array_elements(coalesce(d->'assertions','[]')) with ordinality x(a,ord) order by a->>'caseId',a->>'claimId',ord desc
    ) latest join jsonb_array_elements(coalesce(d->'cases','[]')) c on c->>'id'=a->>'caseId'
      where c->>'complexId'=zk and a->>'status'='verified' and ((needs_legal and a->>'code'='R1' and not(c ? 'phaseId')) or (needs_readiness and a->>'code'='R5' and not(c ? 'phaseId'))) loop
      d:=jsonb_set(d,'{assertions}',d->'assertions'||jsonb_build_array(assertion||jsonb_build_object('id',gen_random_uuid(),'status','candidate','actor',actor,'at',stamp,'comment','Исходные данные изменились: требуется повторная проверка')));
      select (ordinality-1)::integer,value into cidx,cs from jsonb_array_elements(d->'cases') with ordinality where value->>'id'=assertion->>'caseId';
      d:=jsonb_set(d,array['cases',cidx::text],cs||jsonb_build_object('status','draft','updatedAt',stamp));
    end loop;
    update public.workspaces set data=d where owner_id=auth.uid();
    return jsonb_set(legacy_result,'{data}',d);
  end if;
  if op is null or op not in ('relation.register','relation.review','geometry.register','phase.create','phase.update','artifact.register','case.create','case.attach','claim.propose','ai.review','fact.review','case.decide','case.reopen') then raise exception 'UNKNOWN_COMMAND'; end if;
  if jsonb_typeof(command)<>'object' or octet_length(command::text)>200000 then raise exception 'INVALID_COMMAND'; end if;
  if command_id is null or command_id !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_COMMAND_ID'; end if;
  if command ?| array['reviewer','actor','actorId','at','owner','snapshot'] then raise exception 'REVIEWER_FORBIDDEN'; end if;
  allowed:=case op when 'relation.register' then array['type','relation'] when 'relation.review' then array['type','relationId','status','comment'] when 'geometry.register' then array['type','geometry'] when 'phase.create' then array['type','phase'] when 'phase.update' then array['type','phase'] when 'artifact.register' then array['type','artifact'] when 'claim.propose' then array['type','claim'] when 'case.create' then array['type','id','complexId','phaseId','title','period'] when 'case.attach' then array['type','caseId','artifactId'] when 'ai.review' then array['type','claimId','decision','comment'] when 'fact.review' then array['type','caseId','claimId','status','evidence','comment'] when 'case.decide' then array['type','caseId','status','comment'] else array['type','caseId','comment'] end;
  perform public.ux_assert_keys(command,allowed);
  foreach field in array array['caseId','claimId','artifactId','comment','status','decision'] loop
    if command ? field and jsonb_typeof(command->field)<>'string' then raise exception 'INVALID_FIELD_TYPE'; end if;
  end loop;
  select coalesce(email,id::text) into actor from auth.users where id=auth.uid();
  insert into public.workspaces(owner_id) values(auth.uid()) on conflict do nothing;
  select * into strict w from public.workspaces where owner_id=auth.uid() for update;
  select * into receipt from public.command_receipts r where r.owner_id=auth.uid() and r.command_id=apply_command.command_id;
  if found then
    if receipt.payload<>command then raise exception 'COMMAND_ID_REUSED'; end if;
    return jsonb_build_object('data',w.data,'version',w.version,'replayed',true,'appliedVersion',receipt.result_version,'commandId',command_id);
  end if;
  if expected_version is null or expected_version<>w.version then raise exception 'STALE_VERSION'; end if;
  d:=w.data;
  foreach collection in array array['relations','geometries','phases','artifacts','claims','assertions','cases','caseSnapshots'] loop
    if not(d ? collection) then d:=jsonb_set(d,array[collection],'[]'); end if;
  end loop;
  if op in ('case.attach','fact.review','case.decide','case.reopen') then
    select value,(ordinality-1)::integer into cs,cidx from jsonb_array_elements(d->'cases') with ordinality where value->>'id'=command->>'caseId';
    if cs is null then raise exception 'CASE_NOT_FOUND'; end if;
    zk:=cs->>'complexId'; pid:=cs->>'phaseId'; before_value:=cs;
    if op<>'case.reopen' and cs->>'status'<>'draft' then raise exception 'CASE_REOPEN_REQUIRED'; end if;
  elsif op='relation.review' then
    select value,(ordinality-1)::integer into item,idx from jsonb_array_elements(d->'relations') with ordinality where value->>'id'=command->>'relationId';
    if item is null then raise exception 'RELATION_NOT_FOUND'; end if;
    zk:=item->>'complexId'; pid:=item->>'phaseId'; before_value:=item;
  elsif op='ai.review' then
    select value,(ordinality-1)::integer into claim,idx from jsonb_array_elements(d->'claims') with ordinality where value->>'id'=command->>'claimId';
    if claim is null then raise exception 'CLAIM_NOT_FOUND'; end if;
    zk:=claim->>'complexId'; pid:=claim->>'phaseId'; before_value:=claim;
  else
    obj:=case op when 'relation.register' then command->'relation' when 'geometry.register' then command->'geometry' when 'phase.create' then command->'phase' when 'phase.update' then command->'phase' when 'artifact.register' then command->'artifact' when 'claim.propose' then command->'claim' else command end;
    if jsonb_typeof(obj)<>'object' then raise exception 'INVALID_PAYLOAD'; end if;
    if obj ?| array['reviewer','actor','owner','capturedAt','sha256','bytes','triage','triagedBy','triagedAt'] then raise exception 'SERVER_FIELDS_FORBIDDEN'; end if;
    allowed:=case when op='relation.register' then array['id','complexId','phaseId','fromId','toId','relationType','sourceArtifactIds','matchMethod'] when op='geometry.register' then array['id','complexId','phaseId','source','verified','coordinates','heightMeters'] when op in ('phase.create','phase.update') then array['id','complexId','name','legalBasis','period','readinessClaimed','readinessClaimedSource','readinessConfirmed','readinessSources'] when op='artifact.register' then array['id','complexId','phaseId','kind','source','text','date','adId','mediaId','url','origin','availability','pageNumber'] when op='claim.propose' then array['id','complexId','phaseId','artifactId','code','quote','reason','runId','hypothesisId','period'] else array['type','id','complexId','phaseId','title','period'] end;
    perform public.ux_assert_keys(obj,allowed);
    if obj ? 'period' then perform public.ux_assert_period(obj->'period'); end if;
    foreach field in array array['id','complexId','phaseId','name','kind','source','text','date','adId','mediaId','url','origin','availability','artifactId','code','quote','reason','runId','hypothesisId','title'] loop
      if obj ? field and jsonb_typeof(obj->field)<>'string' then raise exception 'INVALID_FIELD_TYPE'; end if;
    end loop;
    foreach field in array array['id','complexId','phaseId','adId','mediaId','artifactId','runId','hypothesisId'] loop
      if obj ? field and obj->>field !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_ID'; end if;
    end loop;
    zk:=obj->>'complexId'; pid:=obj->>'phaseId';
  end if;
  select value into z from jsonb_array_elements(d->'complexes') where value->>'id'=zk;
  if z is null then raise exception 'COMPLEX_NOT_FOUND'; end if;
  if pid is not null then
    select value into phase from jsonb_array_elements(d->'phases') where value->>'id'=pid and value->>'complexId'=zk;
    if phase is null then raise exception 'PHASE_NOT_FOUND'; end if;
    if op in ('case.create','claim.propose') and phase ? 'period' and obj ? 'period' and not public.ux_period_contains(phase->'period',obj->'period') then raise exception 'PHASE_PERIOD_MISMATCH'; end if;
  end if;
  if op in ('relation.register','geometry.register','phase.create','phase.update','artifact.register','claim.propose','case.create') then
    target:=obj->>'id';
    if target is null or target !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_ID'; end if;
    collection:=case op when 'relation.register' then 'relations' when 'geometry.register' then 'geometries' when 'phase.create' then 'phases' when 'phase.update' then 'phases' when 'artifact.register' then 'artifacts' when 'claim.propose' then 'claims' else 'cases' end;
    if op<>'phase.update' and exists(select 1 from jsonb_array_elements(d->collection) x where x->>'id'=target) then raise exception 'DUPLICATE_ID'; end if;
    if op='relation.register' then
      perform public.ux_validate_relation(d,obj);
      item:=obj||jsonb_build_object('verificationStatus','candidate','capturedAt',stamp,'actor',actor);
    elsif op='geometry.register' then
      if coalesce(length(trim(obj->>'source')),0) not between 1 and 2000 or jsonb_typeof(obj->'verified') is distinct from 'boolean' or jsonb_typeof(obj->'coordinates') is distinct from 'array' then raise exception 'INVALID_GEOMETRY'; end if;
      if jsonb_array_length(obj->'coordinates') not between 1 and 100 then raise exception 'INVALID_GEOMETRY'; end if;
      if obj ? 'heightMeters' and (jsonb_typeof(obj->'heightMeters')<>'number' or (obj->>'heightMeters')::numeric not between 0 and 1000) then raise exception 'INVALID_GEOMETRY'; end if;
      vertex_count:=0;
      for ring in select value from jsonb_array_elements(obj->'coordinates') loop
        if jsonb_typeof(ring)<>'array' or jsonb_array_length(ring)<4 then raise exception 'INVALID_GEOMETRY'; end if;
        vertex_count:=vertex_count+jsonb_array_length(ring);
        if vertex_count>10000 or ring->0 is distinct from ring->(jsonb_array_length(ring)-1) then raise exception 'INVALID_GEOMETRY'; end if;
        for point in select value from jsonb_array_elements(ring) loop
          if jsonb_typeof(point)<>'array' or jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number' or (point->>0)::numeric not between -180 and 180 or (point->>1)::numeric not between -85.051129 and 85.051129 then raise exception 'INVALID_GEOMETRY'; end if;
        end loop;
      end loop;
      item:=obj;
    elsif op in ('phase.create','phase.update') then
      if op='phase.update' then
        select value,(ordinality-1)::integer into phase,idx from jsonb_array_elements(d->'phases') with ordinality where value->>'id'=target and value->>'complexId'=zk;
        if phase is null then raise exception 'PHASE_NOT_FOUND'; end if;
        before_value:=phase;
        obj:=phase||obj;
        if obj ? 'period' and (exists(select 1 from jsonb_array_elements(d->'cases') c where c->>'phaseId'=target and c ? 'period' and not public.ux_period_contains(obj->'period',c->'period')) or exists(select 1 from jsonb_array_elements(d->'claims') c where c->>'phaseId'=target and c ? 'period' and not public.ux_period_contains(obj->'period',c->'period'))) then raise exception 'PHASE_PERIOD_MISMATCH'; end if;
        if (obj->'legalBasis',obj->'period') is distinct from (phase->'legalBasis',phase->'period') and exists(select 1 from (
          select distinct on (a->>'caseId',a->>'claimId') a from jsonb_array_elements(d->'assertions') with ordinality x(a,ord) order by a->>'caseId',a->>'claimId',ord desc
        ) latest join jsonb_array_elements(d->'cases') c on c->>'id'=a->>'caseId' where a->>'code'='R1' and a->>'status'='verified' and c->>'phaseId'=target) then raise exception 'REVIEW_R1_FIRST'; end if;
      end if;
      if coalesce(trim(obj->>'name'),'')='' then raise exception 'PHASE_NAME_REQUIRED'; end if;
      item:=jsonb_build_object('id',target,'complexId',zk,'name',obj->>'name');
      foreach field in array array['readinessClaimed','readinessConfirmed'] loop
        if obj ? field and obj->field<>'null'::jsonb and (jsonb_typeof(obj->field)<>'number' or (obj->>field)::numeric not between 0 and 100) then raise exception 'INVALID_READINESS'; end if;
        if obj ? field then item:=item||jsonb_build_object(field,obj->field); end if;
      end loop;
      if obj ? 'readinessClaimedSource' and obj->'readinessClaimedSource'<>'null'::jsonb then
        perform public.ux_assert_keys(obj->'readinessClaimedSource',array['value','source','date']);
        if jsonb_typeof(obj#>'{readinessClaimedSource,source}') is distinct from 'string' or jsonb_typeof(obj#>'{readinessClaimedSource,date}') is distinct from 'string' then raise exception 'INVALID_CLAIMED_SOURCE'; end if;
        if jsonb_typeof(obj#>'{readinessClaimedSource,value}') is distinct from 'number' or (obj#>>'{readinessClaimedSource,value}')::numeric not between 0 and 100 or coalesce(trim(obj#>>'{readinessClaimedSource,source}'),'')='' or not coalesce(public.is_valid_date(obj#>>'{readinessClaimedSource,date}'),false) then raise exception 'INVALID_CLAIMED_SOURCE'; end if;
      end if;
      if obj->>'readinessClaimed' is not null and (obj->>'readinessClaimed')::numeric is distinct from (obj#>>'{readinessClaimedSource,value}')::numeric then raise exception 'INVALID_CLAIMED_SOURCE'; end if;
      if obj ? 'readinessClaimedSource' then item:=item||jsonb_build_object('readinessClaimedSource',obj->'readinessClaimedSource'); end if;
      if obj ? 'readinessSources' then
        if jsonb_typeof(obj->'readinessSources')<>'array' then raise exception 'INVALID_READINESS_SOURCES'; end if;
        for current_z in select value from jsonb_array_elements(obj->'readinessSources') loop
          perform public.ux_assert_keys(current_z,array['value','source','date']);
          if jsonb_typeof(current_z->'source') is distinct from 'string' or jsonb_typeof(current_z->'date') is distinct from 'string' then raise exception 'INVALID_READINESS_SOURCES'; end if;
          if jsonb_typeof(current_z->'value') is distinct from 'number' or (current_z->>'value')::numeric not between 0 and 100 or coalesce(trim(current_z->>'source'),'')='' or not coalesce(public.is_valid_date(current_z->>'date'),false) then raise exception 'INVALID_READINESS_SOURCES'; end if;
        end loop;
        if op='phase.update' and exists(select 1 from jsonb_array_elements(coalesce(phase->'readinessSources','[]')) with ordinality old(v,n) where obj->'readinessSources'->(n::integer-1) is distinct from v) then raise exception 'READINESS_HISTORY_APPEND_ONLY'; end if;
        item:=item||jsonb_build_object('readinessSources',obj->'readinessSources');
      end if;
      if obj->>'readinessConfirmed' is not null and ((obj->>'readinessConfirmed')::numeric is distinct from (obj->'readinessSources'->-1->>'value')::numeric) then raise exception 'INVALID_READINESS_SOURCES'; end if;
      if obj ? 'period' then item:=item||jsonb_build_object('period',obj->'period'); end if;
      if obj ? 'legalBasis' then
        perform public.ux_assert_keys(obj->'legalBasis',array['type','status','source','checkedAt','reviewText','period']);
        if obj->'legalBasis' ? 'period' then perform public.ux_assert_period(obj#>'{legalBasis,period}'); end if;
        foreach field in array array['type','status','source','checkedAt','reviewText'] loop
          if jsonb_typeof(obj->'legalBasis'->field) is distinct from 'string' then raise exception 'INVALID_LEGAL_BASIS'; end if;
        end loop;
        if (coalesce(obj#>>'{legalBasis,type}',''),coalesce(obj#>>'{legalBasis,status}','')) not in (('unknown','unknown'),('absent','absent-verified'),('guarantee','verified'),('mio-permit','verified')) then raise exception 'INVALID_LEGAL_BASIS'; end if;
        if obj#>>'{legalBasis,status}'<>'unknown' and (coalesce(trim(obj#>>'{legalBasis,source}'),'')='' or coalesce(trim(obj#>>'{legalBasis,reviewText}'),'')='' or not coalesce(public.is_valid_date(obj#>>'{legalBasis,checkedAt}'),false)) then raise exception 'LEGAL_REVIEW_REQUIRED'; end if;
        item:=item || jsonb_build_object('legalBasis',obj->'legalBasis');
      end if;
      if op='phase.update' and (phase->'readinessClaimed',phase->'readinessClaimedSource',phase->'readinessConfirmed',phase->'readinessSources') is distinct from (item->'readinessClaimed',item->'readinessClaimedSource',item->'readinessConfirmed',item->'readinessSources') then
        for assertion in select a from (
          select distinct on (a->>'caseId',a->>'claimId') a from jsonb_array_elements(d->'assertions') with ordinality x(a,ord) order by a->>'caseId',a->>'claimId',ord desc
        ) latest join jsonb_array_elements(d->'cases') c on c->>'id'=a->>'caseId' where c->>'phaseId'=target and a->>'code'='R5' and a->>'status'='verified' loop
          d:=jsonb_set(d,'{assertions}',d->'assertions'||jsonb_build_array(assertion||jsonb_build_object('id',gen_random_uuid(),'status','candidate','actor',actor,'at',stamp,'comment','Наблюдения готовности очереди изменились: требуется повторная проверка')));
          select (ordinality-1)::integer,value into cidx,current_z from jsonb_array_elements(d->'cases') with ordinality where value->>'id'=assertion->>'caseId';
          d:=jsonb_set(d,array['cases',cidx::text],current_z||jsonb_build_object('status','draft','updatedAt',stamp));
        end loop;
      end if;
    elsif op='artifact.register' then
      if coalesce(obj->>'kind','') not in ('publication','document','relationship','event','observation','legal-review') or coalesce(trim(obj->>'source'),'')='' or coalesce(trim(obj->>'text'),'')='' then raise exception 'INVALID_ARTIFACT'; end if;
      if coalesce(obj->>'origin','manual') not in ('manual','import','demo') or coalesce(obj->>'availability','ok') not in ('ok','unavailable','needs_auth') then raise exception 'INVALID_ARTIFACT_PROVENANCE'; end if;
      if obj ? 'pageNumber' and (jsonb_typeof(obj->'pageNumber')<>'number' or (obj->>'pageNumber')::numeric not between 1 and 100000 or (obj->>'pageNumber')::numeric<>trunc((obj->>'pageNumber')::numeric)) then raise exception 'INVALID_PAGE_NUMBER'; end if;
      if obj ? 'date' and not coalesce(public.is_valid_date(obj->>'date'),false) then raise exception 'INVALID_DATE'; end if;
      if obj ? 'url' and coalesce(obj->>'url','') !~ '^https?://' then raise exception 'INVALID_URL'; end if;
      if obj ? 'adId' and not exists(select 1 from jsonb_array_elements(d->'ads') a where a->>'id'=obj->>'adId' and a->>'zkId'=zk and a->>'text'=obj->>'text') then raise exception 'ARTIFACT_AD_MISMATCH'; end if;
      if obj ? 'mediaId' and not exists(select 1 from jsonb_array_elements(d->'media') m where m->>'id'=obj->>'mediaId' and m->>'zkId'=zk) then raise exception 'MEDIA_NOT_FOUND'; end if;
      item:=(obj - array['capturedAt']) || jsonb_build_object('origin',coalesce(obj->>'origin','manual'),'availability',coalesce(obj->>'availability','ok'),'capturedAt',stamp,'sha256',encode(sha256(convert_to(obj->>'text','UTF8')),'hex'),'bytes',octet_length(convert_to(obj->>'text','UTF8')));
    elsif op='claim.propose' then
      select value into artifact from jsonb_array_elements(d->'artifacts') where value->>'id'=obj->>'artifactId' and value->>'complexId'=zk and value->>'phaseId' is not distinct from pid;
      if artifact is null then raise exception 'ARTIFACT_SCOPE_MISMATCH'; end if;
      if coalesce(obj->>'code','') not in ('R1','R2','R3','R4','R5','R6') or coalesce(trim(obj->>'quote'),'')='' or position(obj->>'quote' in artifact->>'text')=0 then raise exception 'UNGROUNDED_QUOTE'; end if;
      ev:=jsonb_build_object('quote',obj->>'quote','adId',artifact->>'adId') || (obj - array['id','complexId','phaseId','artifactId','reason','code','quote']);
      perform public.assert_hypothesis_run_link(jsonb_build_object('type','factor','zkId',zk,'code',obj->>'code','evidence',ev),d->'ads');
      quote_start:=public.ux_utf16_length(substr(artifact->>'text',1,position(obj->>'quote' in artifact->>'text')-1));
      item:=obj||jsonb_build_object('quoteStart',quote_start,'quoteEnd',quote_start+public.ux_utf16_length(obj->>'quote'));
    else
      item:=jsonb_build_object('id',target,'complexId',zk,'owner',actor,'status','draft','artifactIds','[]'::jsonb,'createdAt',stamp,'updatedAt',stamp);
      if pid is not null then item:=item || jsonb_build_object('phaseId',pid); end if;
      if obj ? 'title' then item:=item || jsonb_build_object('title',obj->>'title'); end if;
      if obj ? 'period' then item:=item || jsonb_build_object('period',obj->'period'); end if;
    end if;
    if op='phase.update' then d:=jsonb_set(d,array['phases',idx::text],item);
    else d:=jsonb_set(d,array[collection],(d->collection)||jsonb_build_array(item)); end if;
  elsif op='relation.review' then
    if coalesce(command->>'status','') not in ('verified','rejected') or coalesce(trim(command->>'comment'),'')='' then raise exception 'INVALID_REVIEW'; end if;
    perform public.ux_validate_relation(d,item-array['verificationStatus','capturedAt','actor','reviewedBy','reviewedAt','reviewComment']);
    if command->>'status'='verified' and jsonb_array_length(item->'sourceArtifactIds')=0 then raise exception 'RELATION_EVIDENCE_REQUIRED'; end if;
    item:=item||jsonb_build_object('verificationStatus',command->>'status','reviewedBy',actor,'reviewedAt',stamp,'reviewComment',command->>'comment');
    d:=jsonb_set(d,array['relations',idx::text],item);
  elsif op='case.attach' then
    select value into artifact from jsonb_array_elements(d->'artifacts') where value->>'id'=command->>'artifactId' and value->>'complexId'=zk and value->>'phaseId' is not distinct from pid;
    if artifact is null then raise exception 'ARTIFACT_SCOPE_MISMATCH'; end if;
    if not (cs->'artifactIds' ? (artifact->>'id')) then cs:=jsonb_set(cs,'{artifactIds}',cs->'artifactIds'||jsonb_build_array(artifact->>'id')); end if;
  elsif op='ai.review' then
    if coalesce(command->>'decision','') not in ('accepted','rejected') or coalesce(trim(command->>'comment'),'')='' then raise exception 'INVALID_REVIEW'; end if;
    if command->>'decision'='accepted' and not exists(select 1 from jsonb_array_elements(d->'artifacts') a where a->>'id'=claim->>'artifactId' and position(claim->>'quote' in a->>'text')>0) then raise exception 'UNGROUNDED_QUOTE'; end if;
    claim:=claim||jsonb_build_object('triage',command->>'decision','triagedBy',actor,'triagedAt',stamp,'triageComment',command->>'comment');
    d:=jsonb_set(d,array['claims',idx::text],claim);
  elsif op='fact.review' then
    if coalesce(command->>'status','') not in ('verified','rejected') or coalesce(trim(command->>'comment'),'')='' then raise exception 'INVALID_REVIEW'; end if;
    select value into claim from jsonb_array_elements(d->'claims') where value->>'id'=command->>'claimId' and value->>'complexId'=zk and value->>'phaseId' is not distinct from pid;
    if claim is null then raise exception 'CLAIM_SCOPE_MISMATCH'; end if;
    effective_period:=coalesce(cs->'period',claim->'period');
    if command->>'status'='verified' and cs ? 'period' and not coalesce(public.ux_period_contains(claim->'period',cs->'period'),false) then raise exception 'CLAIM_PERIOD_MISMATCH'; end if;
    if not(cs->'artifactIds' ? (claim->>'artifactId')) then raise exception 'ARTIFACT_NOT_ATTACHED'; end if;
    select value into artifact from jsonb_array_elements(d->'artifacts') where value->>'id'=claim->>'artifactId';
    code:=claim->>'code'; ev:=command->'evidence';
    if jsonb_typeof(ev)<>'object' or ev ?| array['actor','reviewer','actorId'] then raise exception 'INVALID_EVIDENCE'; end if;
    perform public.ux_assert_keys(ev,array['id','zkId','kind','source','date','adId','quote','text','mediaIds','runId','hypothesisId','beforeCommissioning']);
    if coalesce(trim(ev->>'source'),'')='' then raise exception 'EVIDENCE_REQUIRED'; end if;
    foreach field in array array['id','zkId','kind','source','date','adId','quote','text','runId','hypothesisId'] loop
      if ev ? field and jsonb_typeof(ev->field)<>'string' then raise exception 'INVALID_EVIDENCE'; end if;
    end loop;
    foreach field in array array['id','zkId','adId','runId','hypothesisId'] loop
      if ev ? field and ev->>field !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_ID'; end if;
    end loop;
    if ev ? 'kind' and ev->>'kind' not in ('publication','legal-review','observation','document') then raise exception 'INVALID_EVIDENCE'; end if;
    if ev ? 'date' and not coalesce(public.is_valid_date(ev->>'date'),false) then raise exception 'INVALID_EVIDENCE_DATE'; end if;
    if ev ? 'beforeCommissioning' then
      perform public.ux_assert_keys(ev->'beforeCommissioning',array['source','date','text']);
      foreach field in array array['source','date','text'] loop
        if jsonb_typeof(ev->'beforeCommissioning'->field) is distinct from 'string' then raise exception 'INVALID_EVIDENCE'; end if;
      end loop;
      if not coalesce(public.is_valid_date(ev#>>'{beforeCommissioning,date}'),false) then raise exception 'INVALID_EVIDENCE_DATE'; end if;
    end if;
    if ev ? 'mediaIds' and (jsonb_typeof(ev->'mediaIds')<>'array' or exists(select 1 from jsonb_array_elements(ev->'mediaIds') m where jsonb_typeof(m)<>'string')) then raise exception 'INVALID_EVIDENCE'; end if;
    if ev ? 'mediaIds' and exists(select 1 from jsonb_array_elements_text(ev->'mediaIds') m where m !~ '^[A-Za-z0-9-]{1,80}$') then raise exception 'INVALID_ID'; end if;
    if ev ? 'zkId' and ev->>'zkId'<>zk then raise exception 'EVIDENCE_SCOPE_MISMATCH'; end if;
    ev:=ev || jsonb_build_object('quote',claim->>'quote');
    if artifact ? 'adId' then ev:=ev||jsonb_build_object('adId',artifact->>'adId'); else ev:=ev-'adId'; end if;
    if claim ? 'runId' then ev:=ev||jsonb_build_object('runId',claim->>'runId','hypothesisId',claim->>'hypothesisId'); else ev:=ev-array['runId','hypothesisId']; end if;
    if not(ev ? 'date') and artifact ? 'date' then ev:=ev||jsonb_build_object('date',artifact->>'date'); end if;
    if not(ev ? 'kind') then ev:=ev||jsonb_build_object('kind',case when artifact->>'kind' in ('publication','legal-review') then artifact->>'kind' else 'document' end); end if;
    if command->>'status'='verified' and not coalesce(public.is_valid_date(ev->>'date'),false) then raise exception 'EVIDENCE_DATE_REQUIRED'; end if;
    ev:=public.complete_evidence(ev,zk,code);
    if command->>'status'='verified' then
      if coalesce(ev->>'quote',claim->>'quote')<>claim->>'quote' then raise exception 'RUN_QUOTE_MISMATCH'; end if;
      if artifact ? 'adId' and ev->>'adId' is distinct from artifact->>'adId' then raise exception 'ARTIFACT_AD_MISMATCH'; end if;
      if pid is not null then z:=jsonb_set(z,'{legalBasis}',coalesce(phase->'legalBasis','{"type":"unknown","status":"unknown","source":"","checkedAt":"","reviewText":""}'::jsonb))||jsonb_build_object('readinessClaimed',coalesce(phase->'readinessClaimed','null'::jsonb),'readinessConfirmed',coalesce(phase->'readinessConfirmed','null'::jsonb),'readinessClaimedSource',coalesce(phase->'readinessClaimedSource','null'::jsonb),'readinessSources',coalesce(phase->'readinessSources','[]'::jsonb)); end if;
      if code='R1' and effective_period is not null and not coalesce(public.ux_period_contains(z#>'{legalBasis,period}',effective_period),false) then raise exception 'LEGAL_PERIOD_MISMATCH'; end if;
      if code='R3' and effective_period is not null then
        if left(ev->>'date',10)<effective_period->>'from' or left(ev->>'date',10)>coalesce(effective_period->>'to','9999-12-31') or not exists(select 1 from jsonb_array_elements(d->'ads') a where a->>'id'=artifact->>'adId' and a->>'date' is not null and left(a->>'date',10)>=effective_period->>'from' and left(a->>'date',10)<=coalesce(effective_period->>'to','9999-12-31')) then raise exception 'R3_PERIOD_MISMATCH'; end if;
      end if;
      perform public.validate_factor(z,code,'confirmed',ev,d->'ads');
      perform public.assert_hypothesis_run_link(jsonb_build_object('type','factor','zkId',zk,'code',code,'evidence',ev),d->'ads');
      if claim ? 'runId' and (ev->>'runId' is distinct from claim->>'runId' or ev->>'hypothesisId' is distinct from claim->>'hypothesisId') then raise exception 'RUN_INPUT_MISMATCH'; end if;
      for target in select jsonb_array_elements_text(coalesce(ev->'mediaIds','[]')) loop
        if not exists(select 1 from jsonb_array_elements(d->'media') m where m->>'id'=target and m->>'zkId'=zk) then raise exception 'MEDIA_NOT_FOUND'; end if;
      end loop;
    end if;
    item:=jsonb_build_object('id',command_id,'caseId',cs->>'id','claimId',claim->>'id','code',code,'status',command->>'status','evidence',ev,'actor',actor,'at',stamp,'comment',command->>'comment');
    if effective_period is not null then item:=item||jsonb_build_object('period',effective_period); end if;
    d:=jsonb_set(d,'{assertions}',d->'assertions'||jsonb_build_array(item));
  elsif op in ('case.decide','case.reopen') then
    if coalesce(trim(command->>'comment'),'')='' then raise exception 'COMMENT_REQUIRED'; end if;
    if op='case.reopen' then
      cs:=jsonb_set(cs,'{status}','"draft"');
    else
      if coalesce(command->>'status','') not in ('confirmed','returned') then raise exception 'INVALID_SIGNAL_STATUS'; end if;
      select coalesce(jsonb_agg(v order by ord),'[]') into selected from (
        select distinct on (v->>'claimId') v,ord from jsonb_array_elements(d->'assertions') with ordinality a(v,ord) where v->>'caseId'=cs->>'id' order by v->>'claimId',ord desc
      ) latest;
      select array_agg(distinct v->>'code') into codes from jsonb_array_elements(selected) v where v->>'status'='verified';
      if command->>'status'='confirmed' and coalesce(array_length(codes,1),0)=0 then raise exception 'VERIFIED_FACT_REQUIRED'; end if;
      -- Revalidate present legal/readiness/publication state before freezing a new decision.
      if pid is not null then z:=jsonb_set(z,'{legalBasis}',coalesce(phase->'legalBasis','{"type":"unknown","status":"unknown","source":"","checkedAt":"","reviewText":""}'::jsonb))||jsonb_build_object('readinessClaimed',coalesce(phase->'readinessClaimed','null'::jsonb),'readinessConfirmed',coalesce(phase->'readinessConfirmed','null'::jsonb),'readinessClaimedSource',coalesce(phase->'readinessClaimedSource','null'::jsonb),'readinessSources',coalesce(phase->'readinessSources','[]'::jsonb)); end if;
      if command->>'status'='confirmed' then
        for item in select v from jsonb_array_elements(selected) v where v->>'status'='verified' loop
          select value into claim from jsonb_array_elements(d->'claims') where value->>'id'=item->>'claimId';
          if cs ? 'period' and not coalesce(public.ux_period_contains(claim->'period',cs->'period'),false) then raise exception 'CLAIM_PERIOD_MISMATCH'; end if;
          effective_period:=coalesce(cs->'period',claim->'period');
          if item->>'code'='R1' and item ? 'period' and not coalesce(public.ux_period_contains(z#>'{legalBasis,period}',item->'period'),false) then raise exception 'LEGAL_PERIOD_MISMATCH'; end if;
          if item->>'code'='R3' and effective_period is not null then
            if left(item#>>'{evidence,date}',10)<effective_period->>'from' or left(item#>>'{evidence,date}',10)>coalesce(effective_period->>'to','9999-12-31') or not exists(select 1 from jsonb_array_elements(d->'ads') a where a->>'id'=item#>>'{evidence,adId}' and a->>'date' is not null and left(a->>'date',10)>=effective_period->>'from' and left(a->>'date',10)<=coalesce(effective_period->>'to','9999-12-31')) then raise exception 'R3_PERIOD_MISMATCH'; end if;
          end if;
          perform public.validate_factor(z,item->>'code','confirmed',item->'evidence',d->'ads');
        end loop;
      end if;
      select coalesce(jsonb_agg(jsonb_build_object('code',a->>'code','status',case when a->>'status'='verified' then 'confirmed' when a->>'status'='candidate' then 'needs-verification' else 'rejected' end,'evidence',a->'evidence','reviewer',a->>'actor','updatedAt',a->>'at')),'[]') into factors from jsonb_array_elements(selected) a;
      z:=jsonb_set(z,'{factors}',factors);
      select coalesce(sum(case c when 'R1' then 35 when 'R2' then 25 when 'R3' then 10 when 'R4' then 15 when 'R5' then 10 when 'R6' then 5 else 0 end),0) into score from unnest(codes) c;
      score:=least(100,score); zone:=case when score>=60 and codes @> array['R1','R2'] then 'red' when score>=25 then 'yellow' else 'green' end;
      select coalesce(jsonb_agg(a),'[]') into materials from jsonb_array_elements(d->'artifacts') a where cs->'artifactIds' ? (a->>'id');
      select coalesce(jsonb_agg(a),'[]') into snapshot_ads from jsonb_array_elements(d->'ads') a where exists(select 1 from jsonb_array_elements(materials) m where m->>'adId'=a->>'id') or exists(select 1 from jsonb_array_elements(selected) f where f#>>'{evidence,adId}'=a->>'id');
      select coalesce(jsonb_agg(jsonb_build_object('kind','media','id',m->>'id','name',m->>'name','mediaKind',m->>'kind','path',m->>'path','sha256',m->'sha256','bytes',m->'bytes','capturedAt',coalesce(m->>'capturedAt',m->>'date'),'note',m->>'note')),'[]') into media_manifest from jsonb_array_elements(d->'media') m where exists(select 1 from jsonb_array_elements(materials) a where a->>'mediaId'=m->>'id') or exists(select 1 from jsonb_array_elements(selected) a where coalesce(a#>'{evidence,mediaIds}','[]') ? (m->>'id'));
      select coalesce(max((s->>'revision')::integer),0)+1 into revision from jsonb_array_elements(d->'caseSnapshots') s where s->>'caseId'=cs->>'id';
      limitations:='[]';
      if not(cs ? 'period') then limitations:=limitations||'"Период применимости не установлен"'::jsonb; end if;
      if z#>>'{legalBasis,status}'='unknown' then limitations:=limitations||'"Правовое основание не установлено"'::jsonb; end if;
      if z->>'bin' is null then limitations:=limitations||'"БИН не указан"'::jsonb; end if;
      if pid is not null and z->>'readinessConfirmed' is null then limitations:=limitations||'"Наблюдения готовности конкретной очереди не установлены"'::jsonb; end if;
      if exists(select 1 from jsonb_array_elements(d->'claims') c where c->>'complexId'=zk and c->>'phaseId' is not distinct from pid and not exists(select 1 from jsonb_array_elements(selected) a where a->>'claimId'=c->>'id')) then limitations:=limitations||'"Есть непроверенные утверждения"'::jsonb; end if;
      if exists(select 1 from jsonb_array_elements(selected) a where a->>'status'='candidate') then limitations:=limitations||'"Импортированные факты требуют повторной проверки"'::jsonb; end if;
      snapshot:=jsonb_build_object('id',command_id,'caseId',cs->>'id','complexId',zk,'revision',revision,'status',command->>'status','actor',actor,'at',stamp,'comment',command->>'comment','complex',z,'assertions',selected,'artifacts',materials,'relations',coalesce((select jsonb_agg(r) from jsonb_array_elements(d->'relations') r where r->>'complexId'=zk and r->>'phaseId' is not distinct from pid and exists(select 1 from jsonb_array_elements_text(r->'sourceArtifactIds') aid where cs->'artifactIds' ? aid)),'[]'),'ads',snapshot_ads,'mediaManifest',media_manifest,'score',score,'zone',zone,'weightsVersion',1,'limitations',limitations,'demo',coalesce((z->>'demo')::boolean,false) or z->>'origin'='demo');
      if pid is not null then snapshot:=snapshot||jsonb_build_object('phaseId',pid,'phase',phase); end if;
      if cs ? 'period' then snapshot:=snapshot||jsonb_build_object('period',cs->'period'); end if;
      d:=jsonb_set(d,'{caseSnapshots}',d->'caseSnapshots'||jsonb_build_array(snapshot));
      cs:=jsonb_set(cs,'{status}',command->'status');
    end if;
  end if;
  if cs is not null then
    cs:=jsonb_set(cs,'{updatedAt}',to_jsonb(stamp)); d:=jsonb_set(d,array['cases',cidx::text],cs);
  end if;
  d:=jsonb_set(d,'{audit}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'commandId',command_id,'actorId',actor,'reviewer',actor,'at',stamp,'zkId',zk,'action',op,'comment',coalesce(command->>'comment',''),'before',before_value,'after',coalesce(snapshot,item,cs,claim),'details',command))||coalesce(d->'audit','[]'));
  update public.workspaces set data=d,version=version+1,updated_at=now() where owner_id=auth.uid();
  insert into public.command_receipts(owner_id,command_id,payload,result_version) values(auth.uid(),apply_command.command_id,command,w.version+1);
  return jsonb_build_object('data',d,'version',w.version+1,'replayed',false,'appliedVersion',w.version+1,'commandId',command_id);
end $$;
revoke all on function public.apply_command(jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.apply_command(jsonb,integer,text) to authenticated;

-- Restore keeps imported history but never imports active verification authority.
do $$ begin
  execute replace(pg_get_functiondef('public.restore_workspace(jsonb)'::regprocedure),
    'restore_workspace', 'restore_workspace_legacy_ux');
end $$;
revoke all on function public.restore_workspace_legacy_ux(jsonb) from public,anon,authenticated;
create or replace function public.restore_workspace(backup jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb:=backup->'workspace'; result jsonb; item jsonb; collection text; actor text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Match browser empty-target semantics, including investigation records.
  perform 1 from public.workspaces where owner_id=auth.uid() for update;
  if exists(select 1 from public.workspaces w where w.owner_id=auth.uid() and (
    jsonb_array_length(coalesce(w.data->'cases','[]'))>0 or jsonb_array_length(coalesce(w.data->'artifacts','[]'))>0 or jsonb_array_length(coalesce(w.data->'claims','[]'))>0 or jsonb_array_length(coalesce(w.data->'assertions','[]'))>0 or jsonb_array_length(coalesce(w.data->'caseSnapshots','[]'))>0
  )) then raise exception 'RESTORE_TARGET_NOT_EMPTY'; end if;
  foreach collection in array array['relations','geometries','phases','artifacts','claims','assertions','cases','caseSnapshots'] loop
    if d ? collection and jsonb_typeof(d->collection)<>'array' then raise exception 'RESTORE_INVALID_INVESTIGATION'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(d->collection,'[]')) a where coalesce(a->>'id','') !~ '^[A-Za-z0-9-]{1,80}$') then raise exception 'RESTORE_INVALID_ID'; end if;
    if exists(select a->>'id' from jsonb_array_elements(coalesce(d->collection,'[]')) a group by a->>'id' having count(*)>1) then raise exception 'RESTORE_DUPLICATE_ID'; end if;
  end loop;
  foreach collection in array array['relations','geometries','phases','artifacts','claims','cases','caseSnapshots'] loop
    for item in select value from jsonb_array_elements(coalesce(d->collection,'[]')) loop
      if not exists(select 1 from jsonb_array_elements(coalesce(d->'complexes','[]')) z where z->>'id'=item->>'complexId') then raise exception 'RESTORE_COMPLEX_NOT_FOUND'; end if;
      if item ? 'phaseId' and not exists(select 1 from jsonb_array_elements(coalesce(d->'phases','[]')) p where p->>'id'=item->>'phaseId' and p->>'complexId'=item->>'complexId') then raise exception 'RESTORE_PHASE_SCOPE_MISMATCH'; end if;
    end loop;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(d->'claims','[]')) loop
    if not exists(select 1 from jsonb_array_elements(coalesce(d->'artifacts','[]')) a where a->>'id'=item->>'artifactId' and a->>'complexId'=item->>'complexId' and a->>'phaseId' is not distinct from item->>'phaseId' and coalesce(trim(item->>'quote'),'')<>'' and position(item->>'quote' in a->>'text')>0) then raise exception 'RESTORE_CLAIM_SCOPE_MISMATCH'; end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(d->'assertions','[]')) loop
    if coalesce(item->>'status','') not in ('candidate','verified','rejected') or not exists(select 1 from jsonb_array_elements(coalesce(d->'cases','[]')) c join jsonb_array_elements(coalesce(d->'claims','[]')) cl on cl->>'id'=item->>'claimId' and cl->>'complexId'=c->>'complexId' and cl->>'phaseId' is not distinct from c->>'phaseId' where c->>'id'=item->>'caseId' and cl->>'code'=item->>'code') then raise exception 'RESTORE_ASSERTION_SCOPE_MISMATCH'; end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(d->'relations','[]')) loop
    perform public.ux_validate_relation(d,item-array['verificationStatus','capturedAt','actor','reviewedBy','reviewedAt','reviewComment']);
  end loop;
  result:=public.restore_workspace_legacy_ux(backup);
  d:=result->'data';
  select coalesce(email,id::text) into actor from auth.users where id=auth.uid();
  if d ? 'assertions' then d:=jsonb_set(d,'{assertions}',coalesce((select jsonb_agg(case when a->>'status'='verified' then a||'{"status":"candidate"}'::jsonb else a end) from jsonb_array_elements(d->'assertions') a),'[]')); end if;
  if d ? 'cases' then d:=jsonb_set(d,'{cases}',coalesce((select jsonb_agg(c||jsonb_build_object('status','draft','owner',actor)) from jsonb_array_elements(d->'cases') c),'[]')); end if;
  if d ? 'geometries' then d:=jsonb_set(d,'{geometries}',coalesce((select jsonb_agg(g||'{"verified":false}'::jsonb) from jsonb_array_elements(d->'geometries') g),'[]')); end if;
  if d ? 'relations' then d:=jsonb_set(d,'{relations}',coalesce((select jsonb_agg(r||'{"verificationStatus":"candidate"}'::jsonb) from jsonb_array_elements(d->'relations') r),'[]')); end if;
  if d ? 'caseSnapshots' then d:=jsonb_set(d,'{caseSnapshots}',coalesce((select jsonb_agg(s||'{"imported":true}'::jsonb) from jsonb_array_elements(d->'caseSnapshots') s),'[]')); end if;
  update public.workspaces set data=d where owner_id=auth.uid();
  return jsonb_set(result,'{data}',d);
end $$;
revoke all on function public.restore_workspace(jsonb) from public,anon,authenticated;
grant execute on function public.restore_workspace(jsonb) to authenticated;

-- Durable queue metadata. Extraction output has no verification authority;
-- accepted facts still require apply_command/fact.review and original grounding.
create table public.document_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  complex_id text not null,
  kind text not null check (kind in ('pdf-text','ocr')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  input_path text not null,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  check (input_path like owner_id::text || '/%')
);
create index document_jobs_owner_status_created_idx on public.document_jobs(owner_id,status,created_at);
alter table public.document_jobs enable row level security;
create policy own_document_jobs_select on public.document_jobs for select to authenticated using(owner_id=(select auth.uid()));
create policy own_document_jobs_insert on public.document_jobs for insert to authenticated with check(owner_id=(select auth.uid()));
create policy own_document_jobs_update on public.document_jobs for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on public.document_jobs from public,anon;
grant select,insert,update on public.document_jobs to authenticated;

create function public.guard_document_job() returns trigger language plpgsql set search_path='' as $$
begin
  if auth.uid() is null or new.owner_id<>auth.uid() then raise exception 'AUTH_REQUIRED'; end if;
  if tg_op='INSERT' then
    if new.status<>'queued' or new.result is not null or new.error is not null then raise exception 'JOB_MUST_START_QUEUED'; end if;
    if new.input_path<>new.owner_id::text||'/'||new.complex_id||'/'||new.id::text||'.pdf' then raise exception 'INVALID_JOB_PATH'; end if;
    if not exists(select 1 from public.workspaces w,jsonb_array_elements(w.data->'complexes') z where w.owner_id=auth.uid() and z->>'id'=new.complex_id) then raise exception 'COMPLEX_NOT_FOUND'; end if;
  else
    if (new.id,new.owner_id,new.complex_id,new.kind,new.input_path,new.created_at) is distinct from (old.id,old.owner_id,old.complex_id,old.kind,old.input_path,old.created_at) then raise exception 'JOB_IDENTITY_IMMUTABLE'; end if;
    if not((old.status in ('queued','failed','running') and new.status='running') or (old.status='running' and new.status in ('succeeded','failed'))) then raise exception 'INVALID_JOB_TRANSITION'; end if;
    if new.status='succeeded' and (jsonb_typeof(new.result)<>'object' or new.result->>'status' is distinct from 'candidate') then raise exception 'JOB_RESULT_MUST_BE_CANDIDATE'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_document_job() from public,anon,authenticated;
create trigger guard_document_job before insert or update on public.document_jobs for each row execute function public.guard_document_job();
