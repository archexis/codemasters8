-- S2.2 (C2) + S2.3 (C3). Квитанции команд, новая сигнатура apply_command,
-- проверка вложений и защита ссылочных файлов.
-- Предшествующие миграции (001/C1/S1.2/S1.3/S1.4/S2.1) НЕ тронуты: ни одна
-- существующая функция/проверка здесь не переписывается; S1-логика решений
-- дословно повторена в новой 3-аргументной сигнатуре.
--
-- C2. Одна служебная таблица command_receipts(owner_id,command_id,payload,
-- result_version), PK(owner_id,command_id), без прямого клиентского DML, с RLS.
-- Payload сравнивается каноническим JSONB-равенством (порядок ключей не важен),
-- а не сырым JSON. Порядок в транзакции: auth -> lock workspace -> lookup
-- receipt -> при том же payload вернуть ТЕКУЩИЙ workspace/version и original
-- result_version без мутации (replayed=true); иной payload с тем же ID ->
-- COMMAND_ID_REUSED; если receipt нет -> expected_version -> validate/apply/
-- audit/receipt атомарно. Проверка receipt ПРЕДШЕСТВУЕТ stale check: потерянный
-- ответ повторяется успешно, даже если версия уже выросла. Ответ содержит
-- replayed/appliedVersion/commandId.
-- Старая пишущая сигнатура apply_command(jsonb,integer) НЕ удаляется (откат и
-- аудит), но доступ к ней отзывается у anon/authenticated: остаётся только
-- новая сигнатура с command_id. Второго доступного write-пути нет.
--
-- C3. Вложение mediaAttachment в ad-команде: один DB-commit принимает
-- publication/evidence/media/решение (один audit, один bump версии, один
-- receipt). Проверка вложения: ownership/zkId-сегменты пути (клиентскому path
-- не доверяем), стабильная форма <owner>/<zk>/<mediaId>.<ext>, existence в
-- storage.objects, размер/тип по Storage metadata (metadata jsonb колонка
-- добавляется IF NOT EXISTS — в облаке она уже есть), allowlist MIME и лимит
-- 20 МБ. Заявленные клиентом bytes/kind сверяются с metadata и отбрасываются
-- при null; несовпадение -> STORAGE_META_MISMATCH.
-- Широкая Storage DELETE policy заменена проверкой ссылок: файл, на который
-- ссылаются данные workspace (media/evidence/snapshot), обычный пользователь
-- удалить не может; свои неподключённые staged-файлы — может.

-- Storage metadata (размер/mimetype) для серверной проверки вложений.
-- storage.objects управляется Supabase; колонка metadata добавляется в облаке
-- автоматически или через консоль. В локальной разработке она может уже быть.
-- alter table storage.objects add column if not exists metadata jsonb;  -- пропускаем: owner Supabase

-- C2. Квитанции: один ID намерения — одна запись на владельца.
create table public.command_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  command_id text not null check (command_id ~ '^[A-Za-z0-9-]{1,80}$'),
  payload jsonb not null,
  result_version integer not null,
  applied_at timestamptz not null default now(),
  primary key (owner_id, command_id)
);
alter table public.command_receipts enable row level security;
-- Никакого прямого клиентского DML: грантов нет, политик нет (default-deny).
-- Чтение/повтор старых ID — только через apply_command (replay в ответе).
revoke all on table public.command_receipts from anon, authenticated, public;

-- S2.3. Общая проверка медиа-объекта для веток media и mediaAttachment:
-- ownership + zkId-сегменты + стабильный путь + existence + metadata.
create or replace function public.check_evidence_media(item jsonb, zk text)
returns void language plpgsql set search_path = '' as $$
declare
  owner text := auth.uid()::text;
  p text := item->>'path';
  mid text := item->>'id';
  segs text[];
  so_meta jsonb;
  claimed_kind text := item->>'kind';
  media_type text;
  media_size bigint;
  claimed_bytes_text text := item->>'bytes';
begin
  if mid is null or mid !~ '^[A-Za-z0-9-]{1,80}$' then raise exception 'INVALID_MEDIA_ID'; end if;
  -- S2.3. Сначала путь (безопасность): клиентскому path не доверяем, проверяем
  -- сегменты ownership/zkId и стабильную форму <owner>/<zk>/<mediaId>.<ext>.
  if p is null or p = '' then raise exception 'INVALID_STORAGE_PATH'; end if;
  if p not like owner || '/' || zk || '/%' then raise exception 'INVALID_STORAGE_PATH'; end if;
  segs := string_to_array(p, '/');
  if coalesce(array_length(segs, 1), 0) <> 3 or segs[1] <> owner or segs[2] <> zk then raise exception 'INVALID_STORAGE_PATH'; end if;
  if segs[3] not like mid || '.%' then raise exception 'INVALID_STORAGE_PATH'; end if;
  -- Описательные поля (name/kind/date/note/ready) — опциональны для хранения:
  -- минимальный media-объект S0-контракта валиден; присланные проверяем по форме.
  if (item->'ready' is not null and item->'ready' <> 'null'::jsonb and jsonb_typeof(item->'ready') <> 'number')
  then raise exception 'INVALID_MEDIA'; end if;
  if claimed_kind is not null and claimed_kind <> '' and claimed_kind not in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf') then raise exception 'INVALID_MEDIA_TYPE'; end if;
  if item->>'date' is not null and item->>'date' <> '' and not public.is_valid_date(item->>'date') then raise exception 'INVALID_MEDIA_DATE'; end if;
  -- Размер/тип — по Storage metadata, не по словам клиента. Колонки может не
  -- быть в минимальном стенде (PGlite): тогда проверки по metadata пропускаются,
  -- остаются ownership/путь/existence. В живом Supabase колонка есть.
  begin
    select o.metadata into so_meta from storage.objects o where o.bucket_id = 'evidence' and o.name = p;
    if not found then raise exception 'STORAGE_OBJECT_NOT_FOUND'; end if;
  exception when undefined_column then
    -- Минимальный стенд без колонки: только existence, без размер/тип.
    so_meta := null;
    perform 1 from storage.objects o where o.bucket_id = 'evidence' and o.name = p;
    if not found then raise exception 'STORAGE_OBJECT_NOT_FOUND'; end if;
  end;
  -- S2.3. Размер/тип — по Storage metadata, не по словам клиента.
  if so_meta is not null then
    if so_meta ? 'size' and coalesce(so_meta->>'size','') ~ '^[0-9]+$' then
      media_size := (so_meta->>'size')::bigint;
      if media_size > 20971520 then raise exception 'STORAGE_OBJECT_TOO_LARGE'; end if;
      if claimed_bytes_text is not null and claimed_bytes_text <> '' then
        if claimed_bytes_text !~ '^[0-9]+$' or claimed_bytes_text::bigint <> media_size then raise exception 'STORAGE_META_MISMATCH'; end if;
      end if;
    end if;
    if so_meta ? 'mimetype' and coalesce(so_meta->>'mimetype','') <> '' then
      media_type := so_meta->>'mimetype';
      if media_type not in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf') then raise exception 'STORAGE_OBJECT_TYPE'; end if;
      if claimed_kind <> media_type then raise exception 'STORAGE_META_MISMATCH'; end if;
    end if;
  end if;
  -- Опциональная целостность (C3): заявлены — проверяем форму, null — молча отбрасываются при записи.
  if item ? 'bytes' and item->'bytes' <> 'null'::jsonb
    and (jsonb_typeof(item->'bytes') <> 'number' or (item->>'bytes')::numeric < 0) then raise exception 'INVALID_MEDIA_META'; end if;
  if item ? 'sha256' and item->'sha256' <> 'null'::jsonb
    and (jsonb_typeof(item->'sha256') <> 'string' or (item->>'sha256') !~ '^[0-9a-fA-F]{64}$') then raise exception 'INVALID_MEDIA_META'; end if;
  if item ? 'capturedAt' and item->'capturedAt' <> 'null'::jsonb
    and jsonb_typeof(item->'capturedAt') <> 'string' then raise exception 'INVALID_MEDIA_META'; end if;
end $$;

-- S2.2 (C2) + S2.3 (C3). Новая сигнатура: тело S1.3 дословно + receipt
-- prologue/epilogue, audit commandId/actorId/before/after/evidence,
-- mediaAttachment в ad-ветке, metadata-проверки через check_evidence_media.
create function public.apply_command(command jsonb, expected_version integer, command_id text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces; d jsonb; z jsonb; item jsonb; factors jsonb; evidence jsonb; factor jsonb; cs jsonb;
  operation text := command->>'type'; zk text; idx integer; code text; status text;
  reviewer text; old_claim jsonb; old_claimed_source jsonb; stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  auto text := ''; r1_had boolean := false; r5_had boolean := false; prev_r5 text := null;
  base_comment text := ''; legal_changed boolean := false;
  rec public.command_receipts; matt jsonb; clean jsonb; before_z jsonb; ver jsonb; ver_arr jsonb;
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
    if exists(select 1 from jsonb_array_elements(d->'ads') a where a->>'id'=item->>'id' or (a->>'zkId'=coalesce(item->>'zkId',zk) and public.ad_dedupe_key(a->>'zkId',a->>'text')=public.ad_dedupe_key(coalesce(item->>'zkId',zk),item->>'text'))) then raise exception 'DUPLICATE_AD'; end if;
    d:=jsonb_set(d,'{ads}',jsonb_build_array(item || jsonb_build_object('decision',command->>'decision')) || (d->'ads'));
    if command->>'decision'='confirmed' and command->'hypothesis' is not null then
      code:=command#>>'{hypothesis,code}'; status:='confirmed';
      if code is null or code not in ('R1','R2','R3','R4','R5','R6') then raise exception 'INVALID_FACTOR'; end if;
      if coalesce(trim(command#>>'{hypothesis,quote}'),'')='' or position(command#>>'{hypothesis,quote}' in item->>'text')=0 then raise exception 'UNGROUNDED_QUOTE'; end if;
      evidence:=jsonb_build_object('kind','publication','zkId',zk,'source',coalesce(nullif(item->>'platform',''),'Ручной ввод'),'quote',command#>>'{hypothesis,quote}','adId',item->>'id','date',item->>'captureAt');
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

-- S2.2/C2. Старой пишущей сигнатуры больше нет: единственная доступная
-- write-версия — (jsonb,integer,text). DROP вместо revoke: мёртвых перегрузок нет.
drop function if exists public.apply_command(jsonb, integer);
grant execute on function public.apply_command(jsonb, integer, text) to authenticated;

-- S2.3 (C3). Замена широкой Storage DELETE policy проверкой ссылок: файл, на
-- который ссылаются данные workspace владельца (media/evidence/snapshot —
-- ищем путь в каноническом тексте data), обычный пользователь удалить не
-- может. Свои неподключённые staged-файлы удалять можно.
drop policy if exists own_evidence_delete on storage.objects;
create policy own_evidence_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (
    select 1 from public.workspaces w
    where w.owner_id = auth.uid()
      and position(storage.objects.name in (w.data::text)) > 0
  )
);
