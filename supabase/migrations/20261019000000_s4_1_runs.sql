-- S4.1 (C5). Доверенный журнал запусков AI-анализа.
--
-- Таблица НОВАЯ (в s2_5_restore.sql её нет — там только workspaces/media/
-- restore; create-if-not-exists на случай повторного применения).
-- Зеркало клиентской модели src/lib/analysis.ts (AnalysisRun):
-- id, owner_id, zk_id, input_snapshot (точный snapshot), input_hash
-- (хеш по фиксированному порядку полей), provider/model, prompt_version,
-- schema_version, status pending/succeeded/failed, hypotheses
-- [{id,code,quote,reason}], started_at/finished_at, error_code.
-- Токены/сырые ключи здесь НЕ хранятся (секрет — только в серверном
-- окружении Edge).
--
-- Доступ (C5): обычный клиент — только SELECT своих строк; прямые
-- INSERT/UPDATE/DELETE запрещены (revoke + отсутствие write-политик).
-- Пишет только серверный Edge-клиент сервисным ключом (bypass RLS)
-- после проверки пользовательского JWT и принадлежности ЖК.
-- Уникальный (owner_id, id): повтор runId с тем же input — replay
-- сохранённого результата без второго LLM-вызова; иной input с прежним
-- ID — 409 (атомарный insert pending определяет исполнителя).
create table if not exists public.analysis_runs (
  id text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  zk_id text not null,
  input_snapshot jsonb not null,
  input_hash text not null,
  provider text not null default '',
  model text not null default '',
  prompt_version text not null default '',
  schema_version integer not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  hypotheses jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  primary key (owner_id, id)
);

alter table public.analysis_runs enable row level security;

-- Прямой клиентский DML запрещён всем (включая владельца): пишет Edge.
revoke all on table public.analysis_runs from anon, authenticated, public;
grant select on table public.analysis_runs to authenticated;

drop policy if exists own_runs_select on public.analysis_runs;
create policy own_runs_select on public.analysis_runs
  for select to authenticated
  using (owner_id = auth.uid());
