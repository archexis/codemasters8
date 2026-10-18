-- S2.1 (C2). schemaVersion=3 в persisted workspace; отказ записи при future version.
-- Миграции 001/002/C1/S1.2/S1.3/S1.4 НЕ тронуты: ни одна существующая
-- функция/проверка здесь не переписывается. Отказ future-записи реализован
-- триггером (а не копией apply_command), поэтому вся S1-логика решений
-- дословно прежняя.

-- Дефолт новых workspace: v3-конверт (signalVersions — задел C6, версии
-- появятся с S2.4; Detail до тех пор читает signals через адаптер).
alter table public.workspaces
  alter column data set default '{"schemaVersion":3,"complexes":[],"ads":[],"media":[],"signals":{},"signalVersions":{},"audit":[]}';

-- Backfill существующих workspace: недостающие ключи добавляются,
-- присутствующие НЕ затираются (A || B: правый операнд побеждает).
update public.workspaces
set data = '{"schemaVersion":3,"signalVersions":{}}'::jsonb || data,
    updated_at = now()
where (data->>'schemaVersion') is null or (data->'signalVersions') is null;

-- Seed — источник initialize_workspace: тоже приводим к v3-конверту.
update public.app_seed
set data = '{"schemaVersion":3,"signalVersions":{}}'::jsonb || data
where (data->>'schemaVersion') is null or (data->'signalVersions') is null;

-- initialize_workspace: защита на случай старого seed — нормализация к v3
-- на выходе (семантика S0/S1 не меняется, только конверт).
create or replace function public.initialize_workspace() returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.workspaces;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  insert into public.workspaces(owner_id,data,version)
  select auth.uid(), ('{"schemaVersion":3,"signalVersions":{}}'::jsonb || data), 1 from public.app_seed
  on conflict do nothing;
  select * into strict w from public.workspaces where owner_id=auth.uid();
  return jsonb_build_object('data',w.data,'version',w.version);
end $$;

-- Отказ записи при schemaVersion > 3: workspace от более нового клиента
-- нельзя молча перезаписать старым кодом. Триггер ловит ВСЕ пути записи
-- (apply_command и любые будущие RPC), текст отказа — с версией и путём
-- восстановления (экспорт исходника + обновление приложения).
create or replace function public.reject_future_schema() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce((NEW.data->>'schemaVersion')::integer, 2) > 3 then
    raise exception 'FUTURE_SCHEMA_VERSION: workspace schemaVersion % не поддерживается (максимум 3). Экспортируйте исходник и обновите приложение.', NEW.data->>'schemaVersion';
  end if;
  return NEW;
end $$;

drop trigger if exists workspaces_no_future_schema on public.workspaces;
create trigger workspaces_no_future_schema before insert or update on public.workspaces for each row execute function public.reject_future_schema();
