-- S1.2 (C1). SQL повторяет проверки TS: TypeScript — не граница доверия.
-- validate_factor получает весь набор публикаций workspace (all_ads): иначе
-- adId/quote нельзя сверить с публикацией того же ЖК.
-- Материалы C1 кодируются существующими полями evidence (новых колонок нет):
--  R1 — kind legal-review + text (содержание сверки); legalBasis
--    type=absent/status=absent-verified + source/checkedAt/reviewText;
--  R2 — kind publication + adId того же ЖК + точная quote из ad.text;
--  R3 — как R2 + text (beforeCommissioning: source/date/text материала,
--    что объект не введён; source/date — поля evidence);
--  R4 — kind document + text коллективного обращения о привлечении средств
--    (collectiveAppeal) или файл в mediaIds;
--  R5 — два наблюдения claimed+confirmed со source/date каждого, |gap|>=20;
--    подтверждается только отдельной factor-командой;
--  R6 — kind document + text с датированным фактом (цифры срока/периода:
--    минимум plannedDate или idleSince) и объяснением значимости.
-- Вся apply_command — одна транзакция: ошибка отбрасывает и ad, и factor,
-- audit и version не двигаются (проверено корпусом I18).

create or replace function public.validate_factor(z jsonb, code text, status text, evidence jsonb, all_ads jsonb default '[]'::jsonb) returns void language plpgsql set search_path = '' as $$
declare
  ad jsonb;
  claimed text; confirmed_v text; claimed_src jsonb; confirmed_rec jsonb;
begin
  if code is null or code not in ('R1','R2','R3','R4','R5','R6') or status is null or status not in ('confirmed','hypothesis','rejected','needs-verification') then raise exception 'INVALID_FACTOR'; end if;
  if status <> 'confirmed' then return; end if;
  if coalesce(trim(evidence->>'source'),'') = '' then raise exception 'EVIDENCE_REQUIRED'; end if;
  if coalesce(evidence->>'date','') <> '' and not public.is_valid_date(evidence->>'date') then raise exception 'INVALID_EVIDENCE_DATE'; end if;
  if code = 'R1' then
    if z#>>'{legalBasis,type}' <> 'absent' or coalesce(z#>>'{legalBasis,status}','') <> 'absent-verified' then raise exception 'R1_REQUIRES_VERIFIED_ABSENCE'; end if;
    if coalesce(trim(z#>>'{legalBasis,source}'),'') = '' or coalesce(trim(z#>>'{legalBasis,checkedAt}'),'') = ''
      or coalesce(trim(z#>>'{legalBasis,reviewText}'),'') = '' then raise exception 'R1_REQUIRES_REVIEW'; end if;
    if coalesce(evidence->>'kind','') <> 'legal-review' then raise exception 'R1_REQUIRES_LEGAL_REVIEW'; end if;
    if coalesce(trim(evidence->>'text'),'') = '' then raise exception 'R1_REQUIRES_REVIEW'; end if;
  elsif code = 'R2' or code = 'R3' then
    if coalesce(trim(evidence->>'quote'),'') = '' then raise exception 'R2_REQUIRES_QUOTE'; end if;
    if coalesce(evidence->>'kind','') <> 'publication' then raise exception 'R2_REQUIRES_PUBLICATION'; end if;
    if coalesce(evidence->>'adId','') = '' then raise exception 'R2_REQUIRES_AD'; end if;
    select a into ad from jsonb_array_elements(coalesce(all_ads,'[]'::jsonb)) a where a->>'id' = evidence->>'adId';
    if ad is null then raise exception 'AD_NOT_FOUND'; end if;
    if ad->>'zkId' <> z->>'id' then raise exception 'FOREIGN_AD'; end if;
    if position(evidence->>'quote' in coalesce(ad->>'text','')) = 0 then raise exception 'UNGROUNDED_QUOTE'; end if;
    if code = 'R3' and coalesce(trim(evidence->>'text'),'') = '' then raise exception 'R3_REQUIRES_MATERIAL'; end if;
  elsif code = 'R4' then
    if coalesce(evidence->>'kind','') <> 'document' then raise exception 'R4_REQUIRES_DOCUMENT'; end if;
    if coalesce(trim(evidence->>'text'),'') = '' and coalesce(jsonb_array_length(evidence->'mediaIds'),0) = 0 then raise exception 'R4_REQUIRES_APPEAL'; end if;
  elsif code = 'R5' then
    claimed := z->>'readinessClaimed'; confirmed_v := z->>'readinessConfirmed'; claimed_src := z->'readinessClaimedSource';
    -- S1.1-порядок сохранён: сначала разрыв, затем происхождение наблюдений.
    if claimed is null or confirmed_v is null or abs(claimed::numeric - confirmed_v::numeric) < 20 then raise exception 'R5_REQUIRES_GAP'; end if;
    select r into confirmed_rec from jsonb_array_elements(coalesce(z->'readinessSources','[]'::jsonb)) r where (r->>'value')::numeric = (confirmed_v)::numeric limit 1;
    if claimed_src is null or claimed_src = 'null'::jsonb
      or coalesce(trim(claimed_src->>'source'),'') = '' or coalesce(claimed_src->>'date','') = ''
      or confirmed_rec is null
      or coalesce(trim(confirmed_rec->>'source'),'') = '' or coalesce(confirmed_rec->>'date','') = ''
    then raise exception 'R5_REQUIRES_OBSERVATIONS'; end if;
  elsif code = 'R6' then
    if coalesce(evidence->>'kind','') <> 'document' then raise exception 'R6_REQUIRES_DOCUMENT'; end if;
    if coalesce(length(trim(evidence->>'text')),0) < 10 or (evidence->>'text') !~ '[0-9]' then raise exception 'R6_REQUIRES_MATERIAL'; end if;
  end if;
end $$;

-- S1.2. apply_command: factor-ветка передаёт публикации workspace в
-- validate_factor; ad-гипотеза строит полное evidence (kind/zkId) и требует
-- comment аналитика; ошибка confirm откатывает и ad (атомарность функции).
create or replace function public.apply_command(command jsonb, expected_version integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces; d jsonb; z jsonb; item jsonb; factors jsonb; evidence jsonb; factor jsonb; cs jsonb;
  operation text := command->>'type'; zk text; idx integer; code text; status text;
  reviewer text; old_claim jsonb; old_claimed_source jsonb; stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if octet_length(command::text) > 200000 then raise exception 'COMMAND_TOO_LARGE'; end if;
  select coalesce(email,id::text) into reviewer from auth.users where id=auth.uid();
  -- C1. Автор решения — сервер: присланный reviewer отбрасывается отказом, а не молча.
  if command ? 'reviewer'
    or coalesce((command->'evidence') ? 'reviewer', false)
    or coalesce((command->'ad') ? 'reviewer', false)
    or coalesce((command->'media') ? 'reviewer', false)
    or coalesce((command->'complex') ? 'reviewer', false)
    or coalesce((command->'hypothesis') ? 'reviewer', false)
  then raise exception 'REVIEWER_FORBIDDEN'; end if;
  if operation is null or operation not in ('complex','factor','ad','media','readiness','signal') then raise exception 'UNKNOWN_COMMAND'; end if;
  zk := coalesce(command->>'zkId',command#>>'{ad,zkId}',command#>>'{media,zkId}',command#>>'{complex,id}');
  if zk is not null and zk !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_ID'; end if;
  insert into public.workspaces(owner_id) values(auth.uid()) on conflict do nothing;
  select * into strict w from public.workspaces where owner_id=auth.uid() for update;
  if expected_version is null or w.version<>expected_version then raise exception 'STALE_VERSION'; end if;
  d := w.data;
  select (ordinality-1)::integer,value into idx,z from jsonb_array_elements(d->'complexes') with ordinality where value->>'id'=zk;
  if z is null and operation<>'complex' then raise exception 'COMPLEX_NOT_FOUND'; end if;
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
      z := item || jsonb_build_object('factors',z->'factors','events',z->'events','sources',z->'sources','readinessSources',z->'readinessSources','readinessConfirmed',z->'readinessConfirmed');
      -- C1. Смена любого из материалов legalBasis отзывает старый confirmed R1.
      if (z#>>'{legalBasis,type}',z#>>'{legalBasis,status}',z#>>'{legalBasis,source}',z#>>'{legalBasis,checkedAt}',z#>>'{legalBasis,reviewText}')
        is distinct from
         ((w.data->'complexes'->idx->'legalBasis'->>'type'),(w.data->'complexes'->idx->'legalBasis'->>'status'),(w.data->'complexes'->idx->'legalBasis'->>'source'),(w.data->'complexes'->idx->'legalBasis'->>'checkedAt'),(w.data->'complexes'->idx->'legalBasis'->>'reviewText')) then
        select coalesce(jsonb_agg(case when value->>'code'='R1' and value->>'status'='confirmed' then value || jsonb_build_object('status','needs-verification','updatedAt',stamp,'reviewer',reviewer) else value end),'[]') into factors from jsonb_array_elements(z->'factors');
        z := jsonb_set(z,'{factors}',factors);
      end if;
      if old_claim is distinct from z->'readinessClaimed' or old_claimed_source is distinct from z->'readinessClaimedSource' then
        select coalesce(jsonb_agg(case when value->>'code'='R5' then value || jsonb_build_object('status','needs-verification','updatedAt',stamp,'reviewer',reviewer) else value end),'[]') into factors from jsonb_array_elements(z->'factors');
        z := jsonb_set(z,'{factors}',factors);
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
    if exists(select 1 from jsonb_array_elements(d->'ads') a where a->>'id'=item->>'id' or lower(regexp_replace(trim(a->>'text'),'\s+',' ','g'))=lower(regexp_replace(trim(item->>'text'),'\s+',' ','g'))) then raise exception 'DUPLICATE_AD'; end if;
    d:=jsonb_set(d,'{ads}',jsonb_build_array(item || jsonb_build_object('decision',command->>'decision')) || (d->'ads'));
    if command->>'decision'='confirmed' and command->'hypothesis' is not null then
      code:=command#>>'{hypothesis,code}'; status:='confirmed';
      if code is null or code not in ('R1','R2','R3','R4','R5','R6') then raise exception 'INVALID_FACTOR'; end if;
      if coalesce(trim(command#>>'{hypothesis,quote}'),'')='' or position(command#>>'{hypothesis,quote}' in item->>'text')=0 then raise exception 'UNGROUNDED_QUOTE'; end if;
      evidence:=jsonb_build_object('kind','publication','zkId',zk,'source',coalesce(nullif(item->>'platform',''),'Ручной ввод'),'quote',command#>>'{hypothesis,quote}','adId',item->>'id','date',item->>'captureAt');
    end if;
  elsif operation='media' then
    item:=command->'media';
    if item->>'id' is null or item->>'id' !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_MEDIA_ID'; end if;
    if coalesce(item->>'date','') <> '' and not public.is_valid_date(item->>'date') then raise exception 'INVALID_MEDIA_DATE'; end if;
    if item->>'path' not like auth.uid()::text || '/' || zk || '/%' then raise exception 'INVALID_STORAGE_PATH'; end if;
    if not exists(select 1 from storage.objects where bucket_id='evidence' and name=item->>'path') then raise exception 'STORAGE_OBJECT_NOT_FOUND'; end if;
    d:=jsonb_set(d,'{media}',(d->'media') || jsonb_build_array(item));
  elsif operation='readiness' then
    if command->>'value' is null or (command->>'value')::numeric not between 0 and 100 or coalesce(trim(command->>'source'),'')='' or coalesce(command->>'date','')='' then raise exception 'INVALID_OBSERVATION'; end if;
    if not public.is_valid_date(command->>'date') then raise exception 'INVALID_OBSERVATION'; end if;
    z:=jsonb_set(z,'{readinessConfirmed}',command->'value');
    z:=jsonb_set(z,'{readinessSources}',(z->'readinessSources') || jsonb_build_array(jsonb_build_object('value',command->'value','source',command->>'source','date',command->>'date')));
    code:='R5'; status:=case when abs((z->>'readinessClaimed')::numeric - (command->>'value')::numeric)>=20 then 'hypothesis' else 'needs-verification' end;
    evidence:=jsonb_build_object('kind','observation','zkId',zk,'source',command->>'source','date',command->>'date');
  elsif operation='signal' then
    status:=command->>'status';
    if status is null or status not in ('draft','confirmed','returned') or coalesce(trim(command->>'comment'),'')='' then raise exception 'INVALID_SIGNAL'; end if;
    if status='confirmed' and not exists(select 1 from jsonb_array_elements(z->'factors') f where f->>'status'='confirmed') then raise exception 'NO_CONFIRMED_FACTORS'; end if;
    d:=jsonb_set(d,array['signals',zk],jsonb_build_object('status',status,'snapshot',z,'at',stamp,'reviewer',reviewer,'comment',command->>'comment'));
  else raise exception 'UNKNOWN_COMMAND'; end if;
  if code is not null then
    -- S1.2. Полный C1-валидатор с публикациями workspace (d->'ads' уже
    -- содержит новую ad транзакции, как transactional copy в TS).
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
  d:=jsonb_set(d,'{audit}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'zkId',zk,'at',stamp,'reviewer',reviewer,'action',operation,'comment',coalesce(command->>'comment',command->>'source',''),'details',command)) || (d->'audit'));
  update public.workspaces set data=d,version=version+1,updated_at=now() where owner_id=auth.uid();
  return jsonb_build_object('data',d,'version',w.version+1);
end $$;
