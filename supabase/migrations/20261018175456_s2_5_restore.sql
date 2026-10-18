-- S2.5/S2.6 (C3). Restore из backup-пакета + защита связанных файлов.
-- Ни одна существующая функция/проверка здесь НЕ переписывается: только новые
-- объекты. TypeScript (src/lib/backup.ts) — не граница доверия: SQL повторно
-- проверяет schema/IDs/ссылки/лимиты/C1-поля пакета.
--
-- Поток restore (C3): validate пакета и ссылок → пустое target workspace →
-- staged upload с новым owner-prefix (клиент загружает файлы в Storage ДО
-- вызова и передаёт staged-карту mediaId→path) → единая DB-запись + import
-- event → ACK. Cleanup по C3 здесь не нужен: запись одна, частичного
-- состояния не бывает (ошибка = rollback).
--
-- Документированные преобразования (зеркало backup.applyImportTransform):
-- активные confirmed → needs-verification, сигналы → draft,
-- complexes[].origin → 'imported', история помечается imported (+ import
-- event), receipts/квоты/авторизация не импортируются (в workspace их нет;
-- чужие ключи игнорируются). Непустой target → RESTORE_TARGET_NOT_EMPTY,
-- никакого merge. Отсутствующий staged-файл → RESTORE_MISSING_FILES с
-- перечнем; хеши байтов проверяет клиент до вызова (validateBackupPackage),
-- SQL сверяет bytes/sha формат и соответствие media↔manifest.

-- Связанный файл нельзя удалить обычным пользователем (C3): evidence,
-- ссылающаяся через mediaIds, media-запись или снимок сигнала. Отложенная
-- очистка работает только со своими неподключёнными staged-файлами.
create or replace function public.media_path_referenced(p_path text)
returns boolean language plpgsql stable set search_path = '' as $$
declare has_media boolean; has_evidence boolean; has_snapshot boolean;
begin
  if p_path is null or p_path = '' then return false; end if;
  select exists(
    select 1 from public.workspaces w, jsonb_array_elements(coalesce(w.data->'media','[]'::jsonb)) m
    where w.owner_id = auth.uid() and m->>'path' = p_path
  ) into has_media;
  if has_media then return true; end if;
  -- evidence.mediaIds → id media с этим путём.
  select exists(
    select 1 from public.workspaces w,
      jsonb_array_elements(coalesce(w.data->'media','[]'::jsonb)) m,
      jsonb_array_elements(coalesce(w.data->'complexes','[]'::jsonb)) z,
      jsonb_array_elements(coalesce(z->'factors','[]'::jsonb)) f
    where w.owner_id = auth.uid()
      and m->>'path' = p_path
      and coalesce(f->'evidence'->'mediaIds','[]'::jsonb) @> jsonb_build_array(m->>'id')
  ) into has_evidence;
  if has_evidence then return true; end if;
  -- Снимки сигналов хранят только mediaId/path/hash (C6): грубая проверка
  -- вхождения пути в JSON сигналов того же владельца.
  select exists(
    select 1 from public.workspaces w
    where w.owner_id = auth.uid()
      and position(p_path in coalesce((w.data->'signals')::text,'')) > 0
  ) into has_snapshot;
  return has_snapshot;
end $$;

-- Замена широкой DELETE-policy проверкой ссылок (C3). Свои неподключённые
-- staged-файлы удаляются как раньше; чужие — по-прежнему запрещены префиксом.
drop policy if exists own_evidence_delete on storage.objects;
create policy own_evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.media_path_referenced(name));

-- Полный restore пакета в пустое workspace (одна транзакция).
-- backup: {"manifest": {...}, "workspace": {...}, "staged": [{"mediaId","path"}]}.
create or replace function public.restore_workspace(backup jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces; d jsonb; manifest jsonb; staged jsonb; cx jsonb; item jsonb;
  fct jsonb; med jsonb;
  entry jsonb; mid text; mpath text; mbytes bigint; msha text; total bigint := 0;
  n_files integer; reviewer text; stamp text;
  missing text[] := '{}'; bad text[] := '{}'; links text[] := '{}';
  confirmed_n integer := 0; signals_n integer := 0;
  media_ids text[] := '{}'; ad_ids text[] := '{}';
  stamp_iso text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if backup is null or not (backup ? 'manifest' and backup ? 'workspace' and backup ? 'staged') then
    raise exception 'RESTORE_BAD_PACKAGE: нужны manifest, workspace и staged';
  end if;
  manifest := backup->'manifest'; d := backup->'workspace'; staged := backup->'staged';
  if coalesce((manifest->>'version')::integer, -1) <> 1 then
    raise exception 'RESTORE_UNSUPPORTED_VERSION: manifest.version должен быть 1';
  end if;
  if jsonb_typeof(manifest->'files') <> 'array' then raise exception 'RESTORE_BAD_PACKAGE: manifest.files — не список'; end if;
  if jsonb_typeof(staged) <> 'array' then raise exception 'RESTORE_BAD_PACKAGE: staged — не список'; end if;
  n_files := jsonb_array_length(manifest->'files');
  if n_files > 100 then raise exception 'RESTORE_TOO_MANY_FILES: в пакете % файлов, максимум 100', n_files; end if;
  if d is null or jsonb_typeof(d->'complexes') <> 'array' or jsonb_typeof(d->'ads') <> 'array' or jsonb_typeof(d->'media') <> 'array' then
    raise exception 'RESTORE_BAD_PACKAGE: workspace без complexes/ads/media';
  end if;
  if coalesce((d->>'schemaVersion')::integer, 2) > 3 then
    raise exception 'RESTORE_FUTURE_SCHEMA: schemaVersion % не поддерживается', d->>'schemaVersion';
  end if;
  -- Manifest: IDs, пути без ../ и абсолютных, размеры/хеши, лимит 200 МБ.
  for entry in select * from jsonb_array_elements(manifest->'files') loop
    mid := entry->>'mediaId'; mpath := entry->>'archivePath';
    mbytes := coalesce((entry->>'bytes')::bigint, -1); msha := entry->>'sha256';
    if mid is null or mid !~ '^[A-Za-z0-9-]{1,80}$' then bad := bad || coalesce('плохой mediaId ' || mid, 'пустой mediaId'); end if;
    if mpath is null or mpath !~ '^files/[A-Za-z0-9-]{1,80}\.[A-Za-z0-9]{1,10}$' or mpath like '%..%' then
      bad := bad || ('плохой archivePath ' || coalesce(mpath, 'null'));
    end if;
    if mbytes is null or mbytes <= 0 then bad := bad || ('плохой размер ' || coalesce(mid, '?')); end if;
    if msha is null or msha !~ '^[0-9a-f]{64}$' then bad := bad || ('плохой sha256 ' || coalesce(mid, '?')); end if;
    total := total + coalesce(mbytes, 0);
    if total > 209715200 then raise exception 'RESTORE_TOO_LARGE: распакованный размер превышает 209715200 байт'; end if;
  end loop;
  if array_length(bad, 1) is not null then
    raise exception 'RESTORE_BAD_MANIFEST: %', array_to_string(bad, '; ');
  end if;
  -- Каждое media workspace — в manifest; собрать ID для проверки ссылок.
  for med in select * from jsonb_array_elements(d->'media') loop
    mid := med->>'id';
    if mid is null or mid !~ '^[A-Za-z0-9-]{1,80}$' then links := links || ('плохое media.id ' || coalesce(mid, 'null')); end if;
    media_ids := media_ids || mid;
    select e into item from jsonb_array_elements(manifest->'files') e where e->>'mediaId' = mid limit 1;
    if not found then links := links || ('media без manifest: ' || mid); end if;
  end loop;
  for item in select * from jsonb_array_elements(d->'ads') loop
    ad_ids := ad_ids || (item->>'id');
  end loop;
  -- Ссылки evidence: adId/mediaIds существуют в пакете.
  for cx in select * from jsonb_array_elements(d->'complexes') loop
    if (cx->>'id') is null or (cx->>'id') !~ '^[A-Za-z0-9-]{1,80}$' then links := links || 'плохой complex.id'; end if;
    for fct in select * from jsonb_array_elements(coalesce(cx->'factors','[]'::jsonb)) loop
      if (fct->>'code') not in ('R1','R2','R3','R4','R5','R6') then links := links || ('неизвестный code в ' || coalesce(cx->>'id','?')); end if;
      if (fct->'evidence'->>'adId') is not null and not (fct->'evidence'->>'adId' = any(ad_ids)) then
        links := links || ((cx->>'id') || ':' || (fct->>'code') || ' ссылается на отсутствующую публикацию ' || (fct->'evidence'->>'adId'));
      end if;
      for mid in select * from jsonb_array_elements_text(coalesce(fct->'evidence'->'mediaIds','[]'::jsonb)) loop
        if not (mid = any(media_ids)) then
          links := links || ((cx->>'id') || ':' || (fct->>'code') || ' ссылается на отсутствующий файл ' || mid);
        end if;
      end loop;
    end loop;
  end loop;
  if array_length(links, 1) is not null then
    raise exception 'RESTORE_BAD_LINKS: %', array_to_string(links, '; ');
  end if;
  -- Staged-файлы: новый owner-prefix вызывающего + существование объекта.
  -- Отсутствующие/чужие — единый перечень (не раскрываем чужие пути).
  for entry in select * from jsonb_array_elements(staged) loop
    mid := entry->>'mediaId'; mpath := entry->>'path';
    if mid is null or mpath is null or mpath !~ ('^' || auth.uid()::text || '/[^/]+/[^/]+$') then
      missing := missing || coalesce(mid, '?');
      continue;
    end if;
    if not exists(select 1 from storage.objects where bucket_id = 'evidence' and name = mpath) then
      missing := missing || mid;
    end if;
  end loop;
  for item in select * from jsonb_array_elements(d->'media') loop
    if not exists(select 1 from jsonb_array_elements(staged) s where s->>'mediaId' = item->>'id') then
      missing := missing || (item->>'id');
    end if;
  end loop;
  if array_length(missing, 1) is not null then
    raise exception 'RESTORE_MISSING_FILES: %', array_to_string(missing, ', ');
  end if;
  -- Target: пустое отдельное workspace, никакого merge.
  insert into public.workspaces(owner_id) values(auth.uid()) on conflict do nothing;
  select * into strict w from public.workspaces where owner_id = auth.uid() for update;
  if jsonb_array_length(coalesce(w.data->'ads','[]'::jsonb)) > 0
    or jsonb_array_length(coalesce(w.data->'media','[]'::jsonb)) > 0
    or jsonb_array_length(coalesce(w.data->'audit','[]'::jsonb)) > 0
    or exists(select 1 from jsonb_each(coalesce(w.data->'signals','{}'::jsonb)) s where (s.value->>'status') <> 'draft') then
    raise exception 'RESTORE_TARGET_NOT_EMPTY: восстановление — только в пустое workspace, слияние не выполняется';
  end if;
  select coalesce(email, id::text) into reviewer from auth.users where id = auth.uid();
  -- Преобразования C3: confirmed → needs-verification (подсчёт для события).
  select count(*) into confirmed_n from jsonb_array_elements(d->'complexes') cz,
    jsonb_array_elements(coalesce(cz->'factors','[]'::jsonb)) f where f->>'status' = 'confirmed';
  select count(*) into signals_n from jsonb_each(coalesce(d->'signals','{}'::jsonb)) s where (s.value->>'status') <> 'draft';
  with ordered as (
    select c as value from jsonb_array_elements(d->'complexes') with ordinality as arr(c, ord) order by ord
  )
  select coalesce(jsonb_agg(
    value || jsonb_build_object('origin','imported',
      'factors', coalesce((select jsonb_agg(case when f->>'status'='confirmed'
        then f || jsonb_build_object('status','needs-verification','updatedAt',stamp_iso,'reviewer',reviewer)
        else f end) from jsonb_array_elements(coalesce(value->'factors','[]'::jsonb)) f), '[]'::jsonb))
  ), '[]'::jsonb) into item from ordered;
  d := jsonb_set(d, '{complexes}', item);
  -- Сигналы → draft (снимки сохраняются, статус требует нового решения).
  select coalesce(jsonb_object_agg(key, case when value->>'status' = 'draft' then value
    else value || jsonb_build_object('status','draft') end), '{}'::jsonb)
    into item from jsonb_each(coalesce(d->'signals','{}'::jsonb));
  d := jsonb_set(d, '{signals}', item);
  -- Пути media → staged с новым owner-prefix; bytes/sha из manifest.
  for entry in select * from jsonb_array_elements(staged) loop
    mid := entry->>'mediaId'; mpath := entry->>'path';
    select e into item from jsonb_array_elements(manifest->'files') e where e->>'mediaId' = mid limit 1;
    d := jsonb_set(d, '{media}', coalesce((select jsonb_agg(case when m->>'id' = mid
      then m || jsonb_build_object('path', mpath, 'bytes', (item->>'bytes')::bigint, 'sha256', item->>'sha256')
      else m end) from jsonb_array_elements(d->'media') m), '[]'::jsonb));
  end loop;
  -- История помечается imported; reviewer/auth из архива авторизацией не становятся.
  d := jsonb_set(d, '{audit}', coalesce((select jsonb_agg(
      e || jsonb_build_object('details', case when jsonb_typeof(e->'details') = 'object'
        then (e->'details') || '{"origin":"imported"}'::jsonb
        else jsonb_build_object('previous', e->'details', 'origin', 'imported') end))
    from jsonb_array_elements(coalesce(d->'audit','[]'::jsonb)) e), '[]'::jsonb));
  d := jsonb_set(d, '{audit}', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'commandId', 'import-' || stamp_iso,
    'zkId', coalesce((d->'complexes'->0->>'id'), 'import'),
    'actorId', auth.uid(), 'at', stamp_iso, 'reviewer', reviewer,
    'action', 'import',
    'comment', 'Импорт backup (' || confirmed_n || ' confirmed → needs-verification, ' || signals_n ||
      ' сигналов → draft). Исходная атрибуция — provenance, серверных действий старого автора не выдаётся.',
    'details', jsonb_build_object('origin','imported','importedBy',reviewer,'confirmedToVerify',confirmed_n,'signalsToDraft',signals_n)
  )) || coalesce(d->'audit','[]'::jsonb));
  d := jsonb_set(d, '{schemaVersion}', '3');
  update public.workspaces set data = d, version = version + 1, updated_at = now() where owner_id = auth.uid();
  return jsonb_build_object('data', d, 'version', w.version + 1);
end $$;

revoke all on function public.restore_workspace(jsonb), public.media_path_referenced(text) from public, anon, authenticated;
grant execute on function public.restore_workspace(jsonb), public.media_path_referenced(text) to authenticated;
