-- Corrective S4 v2 migration, created with CLI and ordered after review_fixes.
-- service_role is absent only in the isolated PGlite harness.
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
  grant all on public.analysis_runs to service_role;
end if; end $$;
create or replace function public.assert_hypothesis_run_link(command jsonb, all_ads jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  link jsonb; ad jsonb; r public.analysis_runs; h jsonb; snapshot jsonb; code text;
begin
  if command->>'type'='ad' then
    ad:=command->'ad'; link:=command->'hypothesis'; code:=link->>'code';
    if coalesce((ad#>>'{analysis,realAI}')::boolean,false) then
      if coalesce(ad#>>'{analysis,runId}','')='' then raise exception 'TRUSTED_RUN_REQUIRED'; end if;
      select * into r from public.analysis_runs where owner_id=auth.uid() and id=ad#>>'{analysis,runId}';
      if not found then raise exception 'RUN_NOT_FOUND'; end if;
    end if;
  elsif command->>'type'='factor' then
    link:=command->'evidence'; code:=command->>'code';
    select a into ad from jsonb_array_elements(all_ads) a where a->>'id'=link->>'adId';
  end if;
  if link ? 'hypothesisId' and not(link ? 'runId') then raise exception 'ORPHAN_HYPOTHESIS_ID'; end if;
  if link ? 'runId' and not(link ? 'hypothesisId') then raise exception 'DANGLING_RUN_ID'; end if;
  if command->>'type'='ad' and link is not null and coalesce(link->>'code','') not in ('R2','R3') then raise exception 'HYPOTHESIS_CODE_FORBIDDEN'; end if;
  if link ? 'runId' then
    select * into r from public.analysis_runs where owner_id=auth.uid() and id=link->>'runId';
    if not found then raise exception 'RUN_NOT_FOUND'; end if;
    if command->>'type'='ad' and coalesce((ad#>>'{analysis,realAI}')::boolean,false) and ad#>>'{analysis,runId}'<>r.id then raise exception 'RUN_INPUT_MISMATCH'; end if;
    select e into h from jsonb_array_elements(r.hypotheses) e where e->>'id'=link->>'hypothesisId';
    if h is null then raise exception 'HYPOTHESIS_NOT_IN_RUN'; end if;
    if h->>'code' is distinct from code or h->>'quote' is distinct from link->>'quote' then raise exception 'RUN_QUOTE_MISMATCH'; end if;
    if code not in ('R2','R3') then raise exception 'HYPOTHESIS_CODE_FORBIDDEN'; end if;
  end if;
  if r.id is not null then
    if r.status<>'succeeded' then raise exception 'RUN_NOT_SUCCEEDED'; end if;
    if ad is null then raise exception 'AD_NOT_FOUND'; end if;
    if r.zk_id<>ad->>'zkId' or (command->>'type'='factor' and r.zk_id<>command->>'zkId') then raise exception 'RUN_WRONG_OBJECT'; end if;
    snapshot:=jsonb_build_object('text',ad->'text','zkId',ad->'zkId','url',ad->'url','account',ad->'account','date',ad->'date','platform',ad->'platform');
    if (r.input_snapshot - 'attachments') <> snapshot then raise exception 'RUN_INPUT_MISMATCH'; end if;
    if r.input_snapshot ? 'attachments' and r.input_snapshot->'attachments' is distinct from ad#>'{analysis,input,attachments}' then raise exception 'RUN_INPUT_MISMATCH'; end if;
    if h is not null and (coalesce(trim(h->>'quote'),'')='' or position(h->>'quote' in ad->>'text')=0) then raise exception 'UNGROUNDED_QUOTE'; end if;
  end if;
end $$;
revoke all on function public.assert_hypothesis_run_link(jsonb,jsonb) from public,anon,authenticated;

create or replace function public.apply_command(command jsonb, expected_version integer, command_id text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces; d jsonb; z jsonb; item jsonb; factors jsonb; evidence jsonb; factor jsonb; cs jsonb;
  operation text := command->>'type'; zk text; idx integer; code text; status text;
  reviewer text; old_claim jsonb; old_claimed_source jsonb; stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  auto text := ''; r1_had boolean := false; r5_had boolean := false; prev_r5 text := null;
  base_comment text := ''; legal_changed boolean := false;
  rec public.command_receipts; matt jsonb; clean jsonb; before_z jsonb; ver jsonb; ver_arr jsonb; duplicate_ad jsonb; duplicate_idx integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- S2.2. Случайный UUID создаётся один раз на намерение; retry шлёт тот же ID.
  if command_id is null or command_id !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_COMMAND_ID'; end if;
  if octet_length(command::text) > 200000 then raise exception 'COMMAND_TOO_LARGE'; end if;
  select coalesce(email,id::text) into reviewer from auth.users where id=auth.uid();
  -- C1. Автор решения — сервер: присланный reviewer отбрасывается отказом, а не молча.
  if command ? 'reviewer'
    or coalesce((command->'evidence') ? 'reviewer', false)
    or coalesce((command->'ad') ? 'reviewer', false)
    or coalesce((command->'media') ? 'reviewer', false)
    or coalesce((command->'mediaAttachment') ? 'reviewer', false)
    or coalesce((command->'complex') ? 'reviewer', false)
    or coalesce((command->'hypothesis') ? 'reviewer', false)
  then raise exception 'REVIEWER_FORBIDDEN'; end if;
  if operation is null or operation not in ('complex','factor','ad','media','readiness','signal') then raise exception 'UNKNOWN_COMMAND'; end if;
  zk := coalesce(command->>'zkId',command#>>'{ad,zkId}',command#>>'{media,zkId}',command#>>'{complex,id}');
  if zk is not null and zk !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_ID'; end if;
  insert into public.workspaces(owner_id) values(auth.uid()) on conflict do nothing;
  select * into strict w from public.workspaces where owner_id=auth.uid() for update;
  -- C2. Receipt lookup ПРЕДШЕСТВУЕТ stale check: потерянный ответ повторяется
  -- успешно, даже если версия уже выросла. Каноническое сравнение JSONB.
  select * into rec from public.command_receipts r where r.owner_id = auth.uid() and r.command_id = apply_command.command_id for update;
  if found then
    if rec.payload = apply_command.command then
      return jsonb_build_object('data',w.data,'version',w.version,'replayed',true,'appliedVersion',rec.result_version,'commandId',apply_command.command_id);
    else
      raise exception 'COMMAND_ID_REUSED';
    end if;
  end if;
  if expected_version is null or w.version<>expected_version then raise exception 'STALE_VERSION'; end if;
  d := w.data;
  -- S4.2 (C5). Hypothesis-gate до любых мутаций: сиротский hypothesisId,
  -- чужой код гипотезы, run-existence/ownership/input/quote — отказом;
  -- транзакция не стартует, version/audit не двигаются.
  if operation='ad' then
    perform public.assert_hypothesis_run_link(command, jsonb_build_array(command->'ad'));
  elsif operation='factor' then
    perform public.assert_hypothesis_run_link(command, coalesce(d->'ads','[]'::jsonb));
  else
    perform public.assert_hypothesis_run_link(command, '[]'::jsonb);
  end if;
  select (ordinality-1)::integer,value into idx,z from jsonb_array_elements(d->'complexes') with ordinality where value->>'id'=zk;
  if z is null and operation<>'complex' then raise exception 'COMPLEX_NOT_FOUND'; end if;
  before_z := z;
  if operation='complex' then
    item := command->'complex';
    if coalesce(trim(item->>'name'),'')='' or coalesce(trim(item->>'address'),'')='' or coalesce(item->>'id','') !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_COMPLEX'; end if;
    if abs((item->>'lat')::numeric)>90 or abs((item->>'lng')::numeric)>180 then raise exception 'INVALID_COORDINATES'; end if;
    if (item->>'bin') is not null and item->>'bin' !~ '^[0-9]{12}$' then raise exception 'INVALID_BIN'; end if;
    -- C1. Только согласованные пары type/status — варианты продукта.
    if coalesce(item#>>'{legalBasis,type}','') not in ('unknown','absent','guarantee','mio-permit') then raise exception 'INVALID_LEGAL_BASIS'; end if;
    if (item#>>'{legalBasis,type}',item#>>'{legalBasis,status}') not in (('unknown','unknown'),('absent','absent-verified'),('guarantee','verified'),('mio-permit','verified')) then raise exception 'INVALID_LEGAL_BASIS'; end if;
    if item#>>'{legalBasis,status}' <> 'unknown' and coalesce(trim(item#>>'{legalBasis,source}'),'')='' then raise exception 'LEGAL_SOURCE_REQUIRED'; end if;
    if item#>>'{legalBasis,status}' <> 'unknown' and coalesce(trim(item#>>'{legalBasis,reviewText}'),'')='' then raise exception 'LEGAL_REVIEW_REQUIRED'; end if;
    if coalesce(item#>>'{legalBasis,checkedAt}','')='' or not public.is_valid_date(item#>>'{legalBasis,checkedAt}') then raise exception 'INVALID_CHECKED_AT'; end if;
    if (item->>'readinessClaimed')::numeric not between 0 and 100 then raise exception 'INVALID_READINESS'; end if;
    -- C1. Заявленная готовность требует совпадающего источника/даты.
    cs := item->'readinessClaimedSource';
    if item->>'readinessClaimed' is not null then
      if cs is null or cs = 'null'::jsonb
        or (cs->>'value')::numeric is distinct from (item->>'readinessClaimed')::numeric
        or coalesce(trim(cs->>'source'),'')=''
        or coalesce(cs->>'date','')='' or not public.is_valid_date(cs->>'date')
      then raise exception 'INVALID_CLAIMED_SOURCE'; end if;
    end if;
    if z is null then
      z := item || '{"factors":[],"events":[],"sources":[],"readinessSources":[],"readinessConfirmed":null}'::jsonb;
      d := jsonb_set(d,'{complexes}',(d->'complexes') || jsonb_build_array(z));
      select (ordinality-1)::integer into idx from jsonb_array_elements(d->'complexes') with ordinality where value->>'id'=zk;
    else
      old_claim:=z->'readinessClaimed'; old_claimed_source:=z->'readinessClaimedSource';
      -- S1.3. Фиксируем наличие подтверждённых решений до перезаписи.
      select exists(select 1 from jsonb_array_elements(z->'factors') where value->>'code'='R1' and value->>'status'='confirmed') into r1_had;
      select exists(select 1 from jsonb_array_elements(z->'factors') where value->>'code'='R5' and value->>'status'='confirmed') into r5_had;
      z := item || jsonb_build_object('factors',z->'factors','events',z->'events','sources',z->'sources','readinessSources',z->'readinessSources','readinessConfirmed',z->'readinessConfirmed');
      -- C1/S1.3. Смена любого из материалов legalBasis (включая source/
      -- checkedAt/reviewText при прежнем status, смену type/status и новый
      -- legal verified) отзывает старый confirmed R1.
      if (z#>>'{legalBasis,type}',z#>>'{legalBasis,status}',z#>>'{legalBasis,source}',z#>>'{legalBasis,checkedAt}',z#>>'{legalBasis,reviewText}')
        is distinct from
         ((w.data->'complexes'->idx->'legalBasis'->>'type'),(w.data->'complexes'->idx->'legalBasis'->>'status'),(w.data->'complexes'->idx->'legalBasis'->>'source'),(w.data->'complexes'->idx->'legalBasis'->>'checkedAt'),(w.data->'complexes'->idx->'legalBasis'->>'reviewText')) then
        legal_changed := true;
        select coalesce(jsonb_agg(case when value->>'code'='R1' and value->>'status'='confirmed' then value || jsonb_build_object('status','needs-verification','updatedAt',stamp,'reviewer',reviewer) else value end),'[]') into factors from jsonb_array_elements(z->'factors');
        z := jsonb_set(z,'{factors}',factors);
        if r1_had then auto := auto || 'R1 confirmed→needs-verification (legalBasis изменился; новый ' || (z#>>'{legalBasis,type}') || '/' || (z#>>'{legalBasis,status}') || '). '; end if;
      end if;
      -- S1.3. Смена claimed value ИЛИ его source/date при прежнем value
      -- отзывает R5 → needs-verification.
      if old_claim is distinct from z->'readinessClaimed' or old_claimed_source is distinct from z->'readinessClaimedSource' then
        select coalesce(jsonb_agg(case when value->>'code'='R5' then value || jsonb_build_object('status','needs-verification','updatedAt',stamp,'reviewer',reviewer) else value end),'[]') into factors from jsonb_array_elements(z->'factors');
        z := jsonb_set(z,'{factors}',factors);
        if r5_had then auto := auto || 'R5 confirmed→needs-verification (заявленная готовность/источник изменились). '; end if;
      end if;
    end if;
  elsif operation='factor' then
    code:=command->>'code'; status:=command->>'status'; evidence:=command->'evidence';
    if code is null or code not in ('R1','R2','R3','R4','R5','R6') or status is null or status not in ('confirmed','hypothesis','rejected','needs-verification') then raise exception 'INVALID_FACTOR'; end if;
    if coalesce(evidence->>'id','') <> '' and evidence->>'id' !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_ID'; end if;
    if coalesce(evidence->>'zkId','') <> '' and evidence->>'zkId' <> (command->>'zkId') then raise exception 'INVALID_ID'; end if;
  elsif operation='ad' then
    item := command->'ad';
    if coalesce(trim(item->>'text'),'')='' or length(item->>'text')>20000 or item->>'id' is null or item->>'id' !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_AD'; end if;
    if coalesce(item->>'date','') <> '' and not public.is_valid_date(item->>'date') then raise exception 'INVALID_AD_DATE'; end if;
    if coalesce(item->>'captureAt','') <> '' and not public.is_valid_date(item->>'captureAt') then raise exception 'INVALID_AD_DATE'; end if;
    if coalesce(item->>'url','')<>'' and item->>'url' !~ '^https?://' then raise exception 'INVALID_URL'; end if;
    if command->>'decision' not in ('saved','confirmed','rejected') or command->>'decision' is null then raise exception 'INVALID_DECISION'; end if;
    -- S2.1-стык#2 (C4). Дедуп строго в пределах одного ЖК по серверному ключу
    -- zkId+canonicalText (8→+7, пробелы/регистр); одинаковый текст в другом ЖК
    -- допустим. Ключ пересчитывает SQL (ad_dedupe_key из S2.4), присланному не доверяет.
    if exists(select 1 from jsonb_array_elements(d->'ads') a where a->>'id'=item->>'id') then raise exception 'DUPLICATE_AD'; end if;
    select value, (ordinality-1)::integer into duplicate_ad, duplicate_idx
      from jsonb_array_elements(d->'ads') with ordinality
      where value->>'zkId'=zk and public.ad_dedupe_key(zk,value->>'text')=public.ad_dedupe_key(zk,item->>'text') limit 1;
    if duplicate_ad is not null then
      if exists(select 1 from jsonb_array_elements(
        jsonb_build_array(jsonb_build_object('source',duplicate_ad->>'platform','date',duplicate_ad->'date','url',duplicate_ad->>'url')) || coalesce(duplicate_ad->'sightings','[]'::jsonb)) seen
        where coalesce(seen->>'source','')=coalesce(item->>'platform','')
          and (seen->>'date') is not distinct from (item->>'date')
          and coalesce(seen->>'url','')=coalesce(item->>'url','')) then raise exception 'DUPLICATE_AD'; end if;
      duplicate_ad := jsonb_set(duplicate_ad,'{sightings}',coalesce(duplicate_ad->'sightings','[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('source',item->>'platform','date',item->'date','url',coalesce(item->>'url',''),'captureAt',item->>'captureAt')));
      d := jsonb_set(d,array['ads',duplicate_idx::text],duplicate_ad);
      item := item || jsonb_build_object('id',duplicate_ad->>'id');
    else
      d:=jsonb_set(d,'{ads}',jsonb_build_array(item || jsonb_build_object('decision',command->>'decision')) || (d->'ads'));
    end if;
    if command->>'decision' in ('confirmed','rejected') and command->'hypothesis' is not null then
      code:=command#>>'{hypothesis,code}'; status:=command->>'decision';
      if coalesce(trim(command->>'comment'),'')='' then raise exception 'COMMENT_REQUIRED'; end if;
      if code is null or code not in ('R1','R2','R3','R4','R5','R6') then raise exception 'INVALID_FACTOR'; end if;
      if coalesce(trim(command#>>'{hypothesis,quote}'),'')='' or position(command#>>'{hypothesis,quote}' in item->>'text')=0 then raise exception 'UNGROUNDED_QUOTE'; end if;
      evidence:=jsonb_build_object('kind','publication','zkId',zk,'source',coalesce(nullif(item->>'platform',''),'Ручной ввод'),'quote',command#>>'{hypothesis,quote}','adId',item->>'id','date',item->>'captureAt');
      if command#>>'{hypothesis,runId}' is not null then evidence:=evidence || jsonb_build_object('runId',command#>>'{hypothesis,runId}','hypothesisId',command#>>'{hypothesis,hypothesisId}'); end if;
      if command#>>'{hypothesis,evidenceText}' is not null then evidence := evidence || jsonb_build_object('text',command#>>'{hypothesis,evidenceText}'); end if;
    end if;
    -- S2.3 (C3). Вложение: одна команда принимает publication/evidence/media/
    -- решение. Ошибка вложения откатывает и ad (атомарность транзакции).
    if command ? 'mediaAttachment' and command->'mediaAttachment' is not null and command->'mediaAttachment' <> 'null'::jsonb then
      matt := command->'mediaAttachment';
      if coalesce(matt->>'zkId','') <> zk then raise exception 'INVALID_ID'; end if;
      perform public.check_evidence_media(matt, zk);
      -- Храним только известные поля (неизвестные ключи клиента отбрасываем
      -- отказом ниже нет — строгая загрузка состояния их не примет; чистим здесь).
      clean := jsonb_build_object('id',matt->'id','zkId',matt->'zkId','name',matt->'name','kind',matt->'kind','date',matt->'date','note',matt->'note','ready',matt->'ready','path',matt->'path');
      if matt ? 'bytes' and matt->'bytes' <> 'null'::jsonb then clean := clean || jsonb_build_object('bytes',matt->'bytes'); end if;
      if matt ? 'sha256' and matt->'sha256' <> 'null'::jsonb then clean := clean || jsonb_build_object('sha256',matt->'sha256'); end if;
      if matt ? 'capturedAt' and matt->'capturedAt' <> 'null'::jsonb then clean := clean || jsonb_build_object('capturedAt',matt->'capturedAt'); end if;
      d:=jsonb_set(d,'{media}',(d->'media') || jsonb_build_array(clean));
    end if;
  elsif operation='media' then
    item:=command->'media';
    -- S2.3. Проверка metadata/ownership/zkId/размера (зеркало вложений).
    perform public.check_evidence_media(item, zk);
    clean := jsonb_build_object('id',item->'id','zkId',item->'zkId','name',item->'name','kind',item->'kind','date',item->'date','note',item->'note','ready',item->'ready','path',item->'path');
    if item ? 'bytes' and item->'bytes' <> 'null'::jsonb then clean := clean || jsonb_build_object('bytes',item->'bytes'); end if;
    if item ? 'sha256' and item->'sha256' <> 'null'::jsonb then clean := clean || jsonb_build_object('sha256',item->'sha256'); end if;
    if item ? 'capturedAt' and item->'capturedAt' <> 'null'::jsonb then clean := clean || jsonb_build_object('capturedAt',item->'capturedAt'); end if;
    d:=jsonb_set(d,'{media}',(d->'media') || jsonb_build_array(clean));
  elsif operation='readiness' then
    if command->>'value' is null or (command->>'value')::numeric not between 0 and 100 or coalesce(trim(command->>'source'),'')='' or coalesce(command->>'date','')='' then raise exception 'INVALID_OBSERVATION'; end if;
    if not public.is_valid_date(command->>'date') then raise exception 'INVALID_OBSERVATION'; end if;
    -- S1.3. Предыдущий статус R5 фиксируем до перезаписи для аудиторского следа.
    select value->>'status' into prev_r5 from jsonb_array_elements(z->'factors') where value->>'code'='R5' limit 1;
    z:=jsonb_set(z,'{readinessConfirmed}',command->'value');
    z:=jsonb_set(z,'{readinessSources}',(z->'readinessSources') || jsonb_build_array(jsonb_build_object('value',command->'value','source',command->>'source','date',command->>'date')));
    code:='R5'; status:=case when abs((z->>'readinessClaimed')::numeric - (command->>'value')::numeric)>=20 then 'hypothesis' else 'needs-verification' end;
    -- S1.3. Новое наблюдение при confirmed R5: gap<20 → needs-verification
    -- (−10 баллов), gap>=20 → hypothesis (0 баллов до нового решения).
    if prev_r5 = 'confirmed' then auto := auto || 'R5 confirmed→' || status || ' (новое наблюдение: разрыв ' || abs((z->>'readinessClaimed')::numeric - (command->>'value')::numeric)::text || ' п.п.). '; end if;
    evidence:=jsonb_build_object('kind','observation','zkId',zk,'source',command->>'source','date',command->>'date');
  elsif operation='signal' then
    status:=command->>'status';
    if status is null or status not in ('draft','confirmed','returned') or coalesce(trim(command->>'comment'),'')='' then raise exception 'INVALID_SIGNAL'; end if;
    if status='confirmed' and not exists(select 1 from jsonb_array_elements(z->'factors') f where f->>'status'='confirmed') then raise exception 'NO_CONFIRMED_FACTORS'; end if;
    d:=jsonb_set(d,array['signals',zk],jsonb_build_object('status',status,'snapshot',z,'at',stamp,'reviewer',reviewer,'comment',command->>'comment'));
    -- S2.4 (C6). Подтверждение/возврат добавляют append-only SignalVersion
    -- серверным builder (ad_dedupe_key/build_signal_version — S2.4, резолвятся
    -- на вызове). Draft указатель версий не добавляет. Повтор тем же
    -- commandId здесь невозможен: квитанция C2 выше уже вернула replay/отказ.
    if status in ('confirmed','returned') then
      ver_arr := coalesce(d->'signalVersions'->zk,'[]'::jsonb);
      ver := public.build_signal_version(d,z,zk,status,command->>'comment',reviewer,stamp,apply_command.command_id,w.version);
      d := jsonb_set(d,array['signalVersions',zk],ver_arr || jsonb_build_array(ver));
    end if;
  else raise exception 'UNKNOWN_COMMAND'; end if;
  if code is not null then
    -- S1.2. Полный C1-валидатор с публикациями workspace (d->'ads' уже
    -- содержит новую ad транзакции, как transactional copy в TS).
    evidence := public.complete_evidence(evidence,zk,code);
    if operation='ad' and matt is not null then
      evidence := evidence || jsonb_build_object('mediaIds',coalesce(evidence->'mediaIds','[]'::jsonb) || jsonb_build_array(matt->>'id'));
    end if;
    perform public.validate_factor(z,code,status,evidence,d->'ads');
    -- C1. Ручные решения confirmed/rejected/needs-verification требуют комментария
    -- аналитика. Проверка после validate_factor: старые коды ошибок сохраняются.
    if operation='factor' and status in ('confirmed','rejected','needs-verification') and coalesce(trim(command->>'comment'),'')='' then raise exception 'COMMENT_REQUIRED'; end if;
    factor:=jsonb_build_object('code',code,'status',status,'evidence',evidence,'reviewer',reviewer,'updatedAt',stamp);
    select coalesce(jsonb_agg(value),'[]') into factors from jsonb_array_elements(z->'factors') where value->>'code'<>code;
    z:=jsonb_set(z,'{factors}',factors || jsonb_build_array(factor));
  end if;
  d:=jsonb_set(d,array['complexes',idx::text],z);
  if operation<>'signal' and d#>array['signals',zk] is not null then d:=jsonb_set(d,array['signals',zk,'status'],'"draft"'); end if;
  -- S1.3 + S2.2 (C2). Audit: изменение в details (=команда), автоматически
  -- затронутые факторы — в комментарии; квитанция намерения — commandId,
  -- серверный автор — actorId, снимок изменения — before/after/evidence.
  base_comment := coalesce(command->>'comment',command->>'source','');
  if auto <> '' then
    auto := 'Авто-отзыв: ' || auto || 'Повторное подтверждение требуется (баллы только после нового confirm).';
    if base_comment <> '' then base_comment := base_comment || ' · ' || auto; else base_comment := auto; end if;
  end if;
  d:=jsonb_set(d,'{audit}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'commandId',apply_command.command_id,'actorId',reviewer,'zkId',zk,'at',stamp,'reviewer',reviewer,'action',operation,'comment',base_comment,'before',before_z,'after',(d->'complexes'->idx),'evidence',evidence,'details',apply_command.command)) || (d->'audit'));
  update public.workspaces set data=d,version=version+1,updated_at=now() where owner_id=auth.uid();
  -- C2. Квитанция пишется в той же транзакции, что apply/audit.
  insert into public.command_receipts(owner_id,command_id,payload,result_version)
  values (auth.uid(),apply_command.command_id,apply_command.command,w.version+1);
  return jsonb_build_object('data',d,'version',w.version+1,'replayed',false,'appliedVersion',w.version+1,'commandId',apply_command.command_id);
end $$;
revoke all on function public.apply_command(jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.apply_command(jsonb, integer, text) to authenticated;
