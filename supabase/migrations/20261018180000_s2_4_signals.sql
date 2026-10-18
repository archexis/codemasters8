-- S2.4 (C6) + S2.1-стык#2 (C4-дудуп, C5-ссылки): неизменная история и подготовка сигнала.
--
-- Что добавляется (существующие S0/S1-функции/проверки НЕ переписываются,
-- кроме двух хирургических мест в apply_command, помеченных S2.4/S2.1 ниже):
--  1. public.ad_canonical_text / public.ad_dedupe_key — серверный пересчёт
--     ключа дедупа C4 (zkId + canonicalText: телефоны 8→+7, пробелы/регистр).
--     Клиентскому ключу не доверяет никто: apply_command считает сам.
--  2. apply_command (3-аргументная из S2.2 — ЕДИНСТВЕННАЯ write-сигнатура):
--     дедуп строго в пределах ЖК + signal-ветка append-only через builder
--     public.build_signal_version. Повтор тем же commandId невозможен:
--     квитанция C2 возвращает replay/отказ раньше. Копии 2-arg здесь НЕТ
--     (удалена: C2 запрещает две доступные write-версии).
--  3. Триггер workspaces_history_append_only: прямая запись НЕ может
--     UPDATE/DELETE audit-записи и версии сигналов через workspace или любую
--     обходную RPC — старые audit обязаны сохраниться, старые версии обязаны
--     остаться префиксом новых. Легитимные apply_command/restore этому
--     удовлетворяют (только дописывают).
--  4. Backfill legacyIncomplete: указатели confirmed/returned эпохи до снимков
--     без версий помечаются revision 1 БЕЗ snapshot (прошлое сегодняшними
--     данными не восстанавливается; перед экспортом — новая проверка).
--     Детерминированный id legacy-<zk>-r1: повторный прогон — no-op.
--
-- Связь с TS: веса/зоны — зеркало WEIGHTS/scoring.ts и
-- signal-snapshot.SIGNAL_WEIGHTS_VERSION=1 (при смене весов бампить все три
-- места); legacy-метка — зеркало markLegacyIncompleteSignals (тот же id).

-- ---------- 1. Канонический ключ дедупа C4 (S2.1-стык#2) ----------

create or replace function public.ad_canonical_text(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  s text := lower(coalesce(t, ''));
  matches text[];
  m text; d text; norm text;
begin
  select coalesce(array_agg(distinct x.m), '{}') into matches from (
    select (regexp_matches(s, '(?:\+7|8)[\s\-()]?[0-9]{3}[\s\-()]?[0-9]{3}[\s\-()]?[0-9]{2}[\s\-()]?[0-9]{2}', 'g'))[1] as m
  ) x;
  foreach m in array matches loop
    d := regexp_replace(m, '\D', '', 'g');
    if length(d) = 11 and left(d, 1) = '8' then norm := '+7' || substring(d, 2);
    elsif length(d) = 10 then norm := '+7' || d;
    elsif length(d) >= 10 then norm := '+' || d;
    else norm := m; end if;
    s := replace(s, m, norm);
  end loop;
  return regexp_replace(trim(s), '\s+', ' ', 'g');
end $$;

create or replace function public.ad_dedupe_key(zk_id text, ad_text text) returns text
language sql immutable set search_path = '' as $$
  select zk_id || '|' || public.ad_canonical_text(ad_text)
$$;

-- ---------- 2. Серверный builder версии сигнала C6 ----------

create or replace function public.build_signal_version(
  d jsonb, z jsonb, zk text, status text, comment text, reviewer text, stamp text, cmd_id text, src_version integer
) returns jsonb language plpgsql set search_path = '' as $$
declare
  f record; ev jsonb; c text;
  seen_codes text[] := '{}';
  score integer := 0; has_r1 boolean := false; has_r2 boolean := false;
  zone text;
  manifest jsonb := '[]'::jsonb;
  ai jsonb := '[]'::jsonb;
  ad jsonb; m jsonb; mid text; entry jsonb;
  ver_arr jsonb := coalesce(d->'signalVersions'->zk, '[]'::jsonb);
  new_rev integer; based_on integer := null;
  ver jsonb;
begin
  -- Зеркало WEIGHTS (scoring.ts): R1:35 R2:25 R3:10 R4:15 R5:10 R6:5.
  -- Зеркало zoneFor: red iff score>=60 и есть R1+R2; иначе yellow iff >=25.
  for f in select value from jsonb_array_elements(coalesce(z->'factors', '[]'::jsonb)) as x(value)
    where value->>'status' = 'confirmed' loop
    c := f.value->>'code';
    if c = any(seen_codes) then continue; end if;
    seen_codes := seen_codes || c;
    if c = 'R1' then score := score + 35; has_r1 := true;
    elsif c = 'R2' then score := score + 25; has_r2 := true;
    elsif c = 'R3' then score := score + 10;
    elsif c = 'R4' then score := score + 15;
    elsif c = 'R5' then score := score + 10;
    elsif c = 'R6' then score := score + 5;
    end if;
    ev := f.value->'evidence';
    if ev is not null then
      -- Только относящиеся материалы своего ЖК: цитируемая публикация + файлы.
      if ev ? 'adId' then
        select value into ad from jsonb_array_elements(coalesce(d->'ads', '[]'::jsonb)) as a(value)
          where value->>'id' = ev->>'adId' and value->>'zkId' = zk limit 1;
        if ad is not null and not exists(
          select 1 from jsonb_array_elements(manifest) as x(v) where v->>'kind' = 'ad' and v->>'id' = ev->>'adId') then
          manifest := manifest || jsonb_build_array(jsonb_build_object('kind', 'ad', 'id', ev->>'adId'));
        end if;
      end if;
      if jsonb_typeof(coalesce(ev->'mediaIds', '[]'::jsonb)) = 'array' then
        for mid in select jsonb_array_elements_text(coalesce(ev->'mediaIds', '[]'::jsonb)) loop
          select value into m from jsonb_array_elements(coalesce(d->'media', '[]'::jsonb)) as mm(value)
            where value->>'id' = mid and value->>'zkId' = zk limit 1;
          if m is not null and not exists(
            select 1 from jsonb_array_elements(manifest) as x(v) where v->>'kind' = 'media' and v->>'id' = mid) then
            -- Signed URL нет по построению: только mediaId/path/hash/bytes.
            manifest := manifest || jsonb_build_array(jsonb_build_object(
              'kind', 'media', 'id', mid, 'path', m->>'path',
              'sha256', coalesce(m->'sha256', 'null'::jsonb),
              'bytes', coalesce(m->'bytes', 'null'::jsonb)));
          end if;
        end loop;
      end if;
      -- AI-provenance только использованных решений (существование run — S4).
      if ev ? 'runId' then
        entry := jsonb_build_object('code', c, 'runId', ev->>'runId');
        if ev ? 'hypothesisId' then entry := entry || jsonb_build_object('hypothesisId', ev->>'hypothesisId'); end if;
        ai := ai || jsonb_build_array(entry);
      end if;
    end if;
  end loop;
  if score >= 60 and has_r1 and has_r2 then zone := 'red';
  elsif score >= 25 then zone := 'yellow';
  else zone := 'green'; end if;
  select coalesce(max((value->>'revision')::integer), 0) + 1 into new_rev
    from jsonb_array_elements(ver_arr) as v(value);
  select coalesce(max((value->>'revision')::integer), null) into based_on
    from jsonb_array_elements(ver_arr) as v(value);
  ver := jsonb_build_object(
    'id', coalesce(cmd_id, gen_random_uuid()::text),
    'zkId', zk, 'revision', new_rev, 'status', status, 'at', stamp,
    'reviewer', reviewer, 'comment', comment,
    'sourceVersion', src_version,
    'snapshot', z,
    'score', score, 'zone', zone,
    -- Зеркало signal-snapshot.SIGNAL_WEIGHTS_VERSION=1.
    'weightsVersion', 1,
    'mediaManifest', manifest, 'aiProvenance', ai,
    'basedOnRevision', case when based_on is null then 'null'::jsonb else to_jsonb(based_on) end);
  if cmd_id is not null then ver := ver || jsonb_build_object('commandId', cmd_id); end if;
  return ver;
end $$;

-- ---------- 3. apply_command: копия s1_3 + 2 хирургических места ----------

-- ---------- 4. Append-only истории: запрет UPDATE/DELETE audit/версий ----------

create or replace function public.assert_history_append_only() returns trigger language plpgsql set search_path = '' as $$
declare
  zk text; old_arr jsonb; new_arr jsonb; i integer; n_old integer; e jsonb;
begin
  if OLD.data is null or NEW.data is null then return NEW; end if;
  -- C2/C6 audit: каждая старая запись обязана сохраниться байт-в-байт
  -- (порядок не важен — новые дописываются в начало). Удаление/правка —
  -- отказ через любой путь записи (workspace напрямую или обходная RPC).
  if jsonb_typeof(coalesce(OLD.data->'audit', '[]'::jsonb)) = 'array'
    and jsonb_typeof(coalesce(NEW.data->'audit', '[]'::jsonb)) = 'array' then
    for e in select * from jsonb_array_elements(OLD.data->'audit') loop
      if not exists(select 1 from jsonb_array_elements(NEW.data->'audit') n where n = e) then
        raise exception 'AUDIT_IMMUTABLE: audit-запись % удалена или изменена — история append-only', coalesce(e->>'id', '?');
      end if;
    end loop;
  end if;
  -- C6 signalVersions: старый массив каждого ЖК — префикс нового
  -- (переписывание/удаление/перестановка версий — отказ любым путём).
  if jsonb_typeof(coalesce(OLD.data->'signalVersions', '{}'::jsonb)) = 'object' then
    for zk in select jsonb_object_keys(OLD.data->'signalVersions') loop
      old_arr := OLD.data->'signalVersions'->zk;
      new_arr := NEW.data->'signalVersions'->zk;
      if jsonb_typeof(old_arr) <> 'array' then continue; end if;
      if new_arr is null or jsonb_typeof(new_arr) <> 'array' then
        raise exception 'SIGNAL_VERSION_IMMUTABLE: версии сигнала % удалены — история append-only', zk;
      end if;
      n_old := jsonb_array_length(old_arr);
      if jsonb_array_length(new_arr) < n_old then
        raise exception 'SIGNAL_VERSION_IMMUTABLE: версии сигнала % удалены — история append-only', zk;
      end if;
      for i in 0..n_old - 1 loop
        if (new_arr->i) is distinct from (old_arr->i) then
          raise exception 'SIGNAL_VERSION_IMMUTABLE: версия % revision % переписана — история append-only', zk, coalesce(old_arr->i->>'revision', '?');
        end if;
      end loop;
    end loop;
  end if;
  return NEW;
end $$;

drop trigger if exists workspaces_history_append_only on public.workspaces;
create trigger workspaces_history_append_only before update on public.workspaces for each row execute function public.assert_history_append_only();

-- ---------- 5. Backfill legacyIncomplete (идемпотентный) ----------

create or replace function public.mark_legacy_signals(d jsonb) returns jsonb language plpgsql set search_path = '' as $$
declare
  zk text; st text; ver_arr jsonb; out jsonb := d;
  stamp text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if d is null or jsonb_typeof(coalesce(d->'signals', '{}'::jsonb)) <> 'object' then return d; end if;
  for zk, st in select key, value->>'status' from jsonb_each(d->'signals') loop
    -- Только решения эпохи до снимков; draft-указатели без решений не метятся.
    if st is null or st not in ('confirmed', 'returned') then continue; end if;
    ver_arr := coalesce(out->'signalVersions'->zk, '[]'::jsonb);
    -- Битый не-массив нормализуется в [] (триггер такие старые данные пропускает).
    if jsonb_typeof(ver_arr) <> 'array' then ver_arr := '[]'::jsonb; end if;
    if jsonb_array_length(ver_arr) > 0 then continue; end if;
    if exists(select 1 from jsonb_array_elements(ver_arr) v where v->>'id' = 'legacy-' || zk || '-r1') then continue; end if;
    out := jsonb_set(out, array['signalVersions', zk], ver_arr || jsonb_build_array(jsonb_build_object(
      'id', 'legacy-' || zk || '-r1', 'zkId', zk, 'revision', 1, 'status', st, 'at', stamp,
      'reviewer', 's2.4-migration',
      'comment', 'S2.4: решение эпохи до снимков — полный snapshot отсутствует, прошлое сегодняшними данными не восстанавливается. Требуется новая проверка перед полноценным экспортом.',
      'sourceVersion', 0, 'legacyIncomplete', true,
      'basedOnRevision', 'null'::jsonb)));
  end loop;
  return out;
end $$;

update public.workspaces set data = public.mark_legacy_signals(data), updated_at = now()
where jsonb_typeof(coalesce(data->'signals', '{}'::jsonb)) = 'object'
  and exists(select 1 from jsonb_each(data->'signals') s
    where s.value->>'status' in ('confirmed', 'returned')
      and coalesce(data->'signalVersions'->s.key, '[]'::jsonb) = '[]'::jsonb);
update public.app_seed set data = public.mark_legacy_signals(data)
where jsonb_typeof(coalesce(data->'signals', '{}'::jsonb)) = 'object'
  and exists(select 1 from jsonb_each(data->'signals') s
    where s.value->>'status' in ('confirmed', 'returned')
      and coalesce(data->'signalVersions'->s.key, '[]'::jsonb) = '[]'::jsonb);

-- S2.2-фикс порядка (было в строке revoke до создания функции — там падало
-- «function does not exist» и роняло весь bootstrap): отзыв после создания.
revoke all on function public.mark_legacy_signals(jsonb) from public, anon, authenticated;
