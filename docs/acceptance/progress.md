# Прогресс приёмки S0

## S0.1 — безопасная исходная точка — DONE (2026-10-18)

- Артефакты: `docs/acceptance/baseline.md`, `docs/acceptance/baseline-files.json` (79 файлов),
  `.temp/s0-baseline-backup/manifest.json` (60 + supplement 20, копии проверены).
- D0.1: manifest + проверенный backup; версии (node v22.23.1 / npm 12.0.2 / Python 3.14.8);
  исходный dirty status записан. Открыто: сверка с исходным PDF (§5–7) в этом окружении
  невозможна — действовать по CONTRACTS/BASELINE/S1.

## S0.2 — независимый тестовый стенд — DONE (2026-10-18, ревью родителя: database 7/7 + U 42/42 + check 0 у меня)

- Артефакты: `tests/helpers/database.ts`, `tests/unit/database.test.ts` (7 изолированных),
  `tests/fixtures/contracts/migrations/` (0001/0002 копии + фиктивная 0003; в рабочей схеме её нет).
- Правки ревью: loader исключает временные файлы (.~/.tmp/.bak/.swp); `.vitest/`+`.temp/` в .gitignore.
- Наблюдение (не блокер): 178 legacy assertions из плана не сходится — в legacy .cjs 127 ok();
  остальное — адаптер+unit expects; зафиксировано, D0.2 это не снимает.
Выход: D0.2. Следующий ID: S0.3.

## S0.3 — воспроизводимый baseline — DONE (2026-10-18, ревью родителя)

- T/U/B/C/A/F — PASS (U 42/42, A 7/7); E `npm run test:e2e` 12/12 повторено
  родителем; L local-smoke все строки PASS на локальном стеке docker.
- Маршруты покрыты durable E-сьютом; ad-hoc скрипт агента удалён им же.
Выход: D0.3. S0 ЗАКРЫТ: `docs/acceptance/sprint-0.md` + `sprint-0.json`,
`npm run gate -- 0` → exit 0 (GATE PASS, 5 packages / 5 criteria).
Следующий ID: S1.1.

## S0.4 — gate и карта требований — DONE (2026-10-18, ревью родителя: тесты 9/9 PASS у меня, A/B-находки покрыты)

Есть: `docs/acceptance/criteria.json`, `docs/acceptance/requirements.md`
(не трогать), `tools/check-sprint-gate.mjs`, `tests/unit/sprint-gate.test.ts`.
Выход: D0.4. Следующий ID: S0.3 (ждёт S0.2).

## S0.5 — исходные фикстуры — DONE (2026-10-18)

- Артефакты: `tests/fixtures/contracts/scoring.json` (8 кейсов S1.5 + 5 проверок границ зон),
  `tests/fixtures/contracts/decision-cases.json` (I01–I18 из S1.2).
- Expected зафиксирован из таблиц S1, кодом не вычислялся. Подключение red→green — в S1.
- D0.5: отчёт S0 — ЗАКРЫТ: `docs/acceptance/sprint-0.md` + `sprint-0.json`,
  `npm run gate -- 0` → exit 0 (GATE PASS, 5 packages / 5 criteria, 2026-10-18).

# S1 — инварианты, все пути подтверждения, скоринг

## S1.1 — схема команд и минимальные доказательства — DONE (2026-10-18, ревью родителя)

- Артефакты: `src/lib/validation.ts` (zod strictObject, parseCommand, пары
  legalBasis, reject reviewer/dates/NaN/пар), `tests/unit/validation.test.ts`
  (12/12 у меня), миграция `20261018104408_c1_command_schema.sql` (через CLI),
  правки `types.ts`/`domain.ts` (parseCommand до apply)/`ComplexForm.svelte`.
- Правка ревью: пин списка миграций в `database.test.ts` расширен до 3 файлов
  (намерение S0.2 сохранено); оставлять красным до S1.5 было нельзя —
  итог U 54/54 + check 0 у меня.
Следующий разрешённый пакет: S1.2.

## S1.2 — общее подтверждение R1–R6 — DONE (2026-10-18, ревью родителя)

- Артефакты: `src/lib/domain.ts` (validateFactor на workspace+target, ad на
  транзакционной копии с откатом), миграция `20261018105750_s1_2_decision_contract.sql`
  (SQL повторяет C1: R2 same-zk ad + точная quote, R3 beforeCommissioning, R4
  collectiveAppeal, R5 два observation + gap, R6 scheduleDeviation),
  `Detail.svelte` (R2/R3 только с выбором публикации, блок без adId),
  `tests/unit/decision-contract.test.ts` + `decision-contract-sql.test.ts`
  (I01–I18 оба, expected TS — из decision-cases.json).
- Проверено родителем: 24/24 корпусов, полный U 78/78, check 0. Правок не нужно.
Следующий разрешённый пакет: S1.3.

## S1.3 — отзыв устаревших решений — DONE (2026-10-18, ревью родителя)

- Артефакты: `domain.ts` (invalidate R1/R5), миграция `20261018111105_s1_3_invalidation.sql`,
  V01–V07 TS + V01–V06 SQL (дописаны, не переписаны), «Снятые решения» в Detail.
- Проверено родителем: U 87/87 (78+7+2 — арифметика агента сошлась), check 0;
  V07 доказывает отсутствие лишних отзывов. Правок не нужно.
Следующий разрешённый пакет: S1.4.

## S1.4 — seed и старые факторы — DONE (2026-10-18, агент упёрся в лимит — добежал родитель)

- Артефакты агента: seed.json (DEMO-материалы A/B/C + verbatim-цитата R3 SQ-001),
  `tools/generate-seed.mjs`, миграция `20261018112607_s1_4_seed_integrity.sql`,
  `tests/unit/seed-integrity.test.ts`.
- Правки ревью родителя: чтение app_seed до login (revoke by design; контракт —
  initialize_workspace), пин миграций расширен до 6 файлов.
- Проверено родителем: seed-integrity 6/6, полный U 93/93, check 0; verbatim
  цитаты и A/B/C 35/70/10 подтверждены скриптом.
Следующий разрешённый пакет: S1.5.

## S1.5 — UI, API и регрессия — DONE (2026-10-18, агент упёрся в лимит — закрыл родитель)

- Артефакты агента: `zoneFor` в scoring.ts, backend golden-тесты на scoring.json,
  `tests/e2e/legal-invariants.spec.ts` (C→R1 блок, R2→35, снятие→10, чужая цитата).
- Фикс родителя: конфликт strict-hypothesis vs Analyze (wire {code,quote} +
  modelReason + обязательный комментарий аналитика в UI); E2E-адаптация —
  только новые обязательные поля.
- Проверено родителем: U 93/93, check 0, backend 9/9, E2E 20/20, build ok.
S1 ЗАКРЫТ: `docs/acceptance/sprint-1.md` + `sprint-1.json`,
`npm run gate -- 1` → exit 0 (GATE PASS, 5 packages / 5 criteria + регрессия S0).
Следующий разрешённый пакет: S2.1.

## S0/S1-REPAIR — стык S1→S2, v3-конверт — DONE (2026-10-18)

- Причина обоих падений: миграция S2.1 (`20261018121836_s2_1_schema_version.sql`)
  добавила schemaVersion=3 + signalVersions={} поверх app_seed/initialize_workspace.
  `database.test.ts`: пин 6 файлов vs 7 на диске; `seed-integrity.test.ts`:
  app_seed с v3-ключами vs конверт генератора без них.
- Исправление (expected не подгонялся, skip/only нет): пин расширен до 7 файлов
  (s2_1 валидна — триггер future-write + backfill, включена с обоснованием);
  `tools/generate-seed.mjs:buildSeedEnvelope`, `src/lib/domain.ts:initialState`,
  серверный fallback `src/lib/repository.ts:loadState` возвращают канон v3 —
  DEMO-состояние совпадает с SQL. Сохранённые v2 проходят loadStateFromText
  v2→v3 (нуждающиеся confirmed → needs-verification с factor.before + audit,
  marker s2.1-schema-v3, идемпотентно). Историческая миграция s1_4 не переписана:
  s2_1 патчит её пейлоад на применении (`||`-merge).
- Свежие прогоны: `npm run check` — 0 errors; `npm test` — 130/130 (11 файлов);
  `npm run build` — ok; backend pytest — 9/9 (через backend/.venv; системный
  python3 без fastapi — особенность окружения, не регрессия). E/C/F/L —
  исторические (родитель), ремонтом не затронуты.
- Отчёты: sprint-0.json/sprint-1.json — новые SHA256-манифесты (150 файлов),
  environment.migrations — 7 файлов; S1.4 artifacts += domain.ts/repository.ts;
  регрессия D0.1–D0.5 перепроверена свежим прогоном.
- `npm run gate -- 0` → exit 0; `npm run gate -- 1` → exit 0.
- Следующий разрешённый пакет: S2.1 (не начат; S2.1-миграция существует как
  причина стыка, пакетные тесты state-migration 130/130 зелёные).

## S2 — сохранность, история, файлы и восстановление — DONE (2026-10-18, родитель + 3 воркера muse-spark)

- S2.1: v3-конверт TS+SQL, null-date, sightings[], runId/hypothesisId-ссылки, сиротский hypothesisId срезается с пометкой; state-migration 32/32.
- S2.2: command_receipts + 3-arg apply_command (единственная write-сигнатура, 2-arg DROP), очередь/pending/session, DEMO без логина; idempotency 24/24.
- S2.3: upload→commit, saved после ACK, stable ID, path-first media-check, DELETE-policy по ссылкам; evidence-failures 12/12 (chromium+mobile, F7 две вкладки Web Locks).
- S2.4: signal-snapshot.ts + SQL builder/триггер/backfill legacyIncomplete, append-only, replay; signal-history 7/7.
- S2.5: backup.ts ZIP + restore RPC + BackupPanel на #/backup + export labels; backup 22/22.
- S2.6: PGlite изоляция + live 3/3 (expiry TTL, restore SHA256, fake 0) на локальном Supabase после db reset; DEMO IndexedDB (F7); MediaCard error-state.
- Регистрация убрана: DEMO по умолчанию, вход по выданной учётке, login-wall удалён. CONTRACTS C2/C3/C4/C5/C6 обновлены.
- Проверки: check 0, U 201/201 (14 файлов), build ok, E2E 12/12, live 3/3. S2 ЗАКРЫТ: docs/acceptance/sprint-2.md + sprint-2.json, `npm run gate -- 2` → exit 0. Gates 0/1 перепроверены.
- Следующий разрешённый пакет: S3.1.

## S3 — источники и импорт — DONE (2026-10-18, 2 воркера muse-spark + доводка родителем)

- S3.1: extraction-корпус RU/KZ + legacy; S3.2: единый dedupe adDedupeKey (zk-scope), sightings, undated+dated, source-contract 14/14 TS/SQL.
- S3.3: построчный CSV (BOM/разделители/rowId/дата-null/savedAdId); S3.4: roundtrip + csv-save-note (фиксация vs отказ same-fixation) + Detail-блок источников.
- Доводка: metadata-guard в SQL (PGlite/live), mobile CSS-overlap fix (.csv-row wrap).
- Проверки: check 0, U 215/215 (15), build ok, E2E csv 8/8 + roundtrip 2/2 + evidence 12/12, backend 9/9, live 3/3 (fresh db reset). S3 ЗАКРЫТ: gate 3 exit 0. Gates 0/1/2 перепроверены.
- Следующий разрешённый пакет: S4.1.
