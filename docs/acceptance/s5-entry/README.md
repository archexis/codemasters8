# Проверка входа S5 — FAIL, 18.10.2026

Это свежая проверка входа, а не переутверждение исторических S0–S4.
Исторические JSON/MD не изменены. Текущее выполнение S5 остановлено **до S5.1**:
SPRINT_PLAN v2 / EXECUTION / S5 требуют актуальный S4 PASS.

## Причина 101 ошибок gate

`npm run gate -- 4`: exit 1, 101 проблема. Gate читает сырые байты и считает SHA256,
не нормализуя LF/CRLF; старые отчёты также включили generated output вопреки
EXECUTION. Это не означает 101 дефект продукта.

`node tools/diagnose-acceptance.mjs` воспроизводит классификацию без изменения отчётов.
Первый результат сохранён в `manifest-diagnosis.json`: 142 записи, 41 точное совпадение,
81 совпадение после **только** замены CRLF на LF, 7 отсутствующих generated/cache файлов,
13 изменений содержимого. 20 записей относятся к исключаемым по контракту generated
каталогам. Кэш после тестов может измениться; первый результат не перезаписывался.

13 изменений содержимого совпали с dirty-файлами на входе: skills-lock.json,
App.svelte, Analyze.svelte, BackupPanel.svelte, analysis.ts, domain.ts, repository.ts,
types.ts, validation.ts, analyze-proxy/index.ts, database.test.ts, generate-seed.mjs,
vite.config.ts. Они сохранены, не исправлялись и не откатывались этим исполнителем.
Непопавшие в исторический манифест новые тесты/миграция также проверяются текущим U.

Обновить исходный манифест по правилам можно лишь после реальных проверок затронутых
профилей. T/U/B/E/A/F пройдены, но C/L и S4 AI не подтверждены. Поэтому новые хеши не
подставлялись в исторический PASS. Gate не изменён и не ослаблен.

## Проверки на текущих файлах

| Проверка | Результат | Свидетельство |
|---|---|---|
| T: npm run check | PASS, 0 errors / 0 warnings | check.log |
| U: npm test | PASS, 283 теста / 21 файл | unit.log |
| B: npm run build | PASS | build.log |
| E: npm run test:e2e | PASS, 48 desktop/mobile | e2e.log |
| A: backend/.venv/Scripts/python.exe -m pytest backend/tests -q | PASS, 9 | api.log |
| F: npm run test:edge | PASS, 3 | edge.log |
| F types: npx --yes deno check supabase/functions/analyze/index.ts | PASS | edge-check.log |
| C: npm run test:cloud | BLOCKED, чужой процесс на 5174 | cloud.log |
| C: тот же suite на 5184 | FAIL, отсутствует старый locator входа | cloud-reproduce.log |
| L: npm run test:local | FAIL, browser login locator; 4 skipped | local.log |
| L: node tools/s5-entry-isolation.mjs | 2 PASS / 1 FAIL, без skips | isolation.log |
| AI | NOT_RUN: preflight S4 не выполнен; платные запросы не делались | аудит ниже |

Для C на отдельном порту используется `npx playwright test --config tools/acceptance.cloud.config.ts`.
Это исходный tests/cloud/supabase.spec.ts с теми же asserts; mock HTTP соответствует
профилю C и **не считается** connected/AI проверкой. Порт 5174 занят Vite другого
проекта `C:/Users/BIGra/Desktop/open_evening/app/frontend`; процесс не останавливался.
В cloud и live locator ищет «Войти в систему», а UI показывает кнопку «Демо-аналитик».
Сохранены cloud-error-context.md и логи; это устаревший тестовый вход, не доказательство
поломки Auth продукта. Последующие assertions этими прогонами не проверены.

Независимая изоляция передаёт SERVICE_KEY только дочернему процессу через env,
запускает ровно backup-isolation.spec.ts на временных local пользователях:
cross-user/anonymous denial и expiry PASS; restore FAIL с PGRST202 — RPC отсутствует.
Свои тестовые пользователи удалены; после обоих прогонов число saq-smoke/saq-isolation
пользователей равно 0. Рабочая БД не сбрасывалась, её миграции не применялись.

## Более глубокий дефект входной приёмки S4

`local-schema.log` воспроизводится read-only:

```powershell
docker exec supabase_db_saq-qurylys psql -U postgres -d postgres -At -c "select version from supabase_migrations.schema_migrations order by version; select to_regclass('public.analysis_runs'); select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname='apply_command';"
```

Применены только `202610180001`, `202610180002`; analysis_runs отсутствует;
доступен только `apply_command(jsonb,integer)`. На диске 13 миграций. Поэтому PASS
старого local-smoke с двухаргументным RPC не проверяет текущие C2/C5/C6.
Это отставание local окружения; оно отдельно от качества кода миграций, которые
проходят PGlite в U.

Сопоставление **содержания** S4.md и sprint-4.json выявляет:

- S4.3 / D4.3 фактически подтверждены scoring-attack, а требуются stale/abort/session.
- S4.4 / D4.4 подтверждены export-gate, а требуются 12 real eval и новый browser input.
- S4.5 / D4.5 ссылаются на stub edge-proxy; это не live provider и не весь T/U/B/E/C/A/F/L/AI.
- tests/fixtures/contracts/ai-eval.json отсутствует. tools/deepseek-smoke.mjs содержит
  6 старых кейсов; docs/DEEPSEEK_TEST_REPORT.json — прежний прогон этих 6, не приёмка S4 v2.
- В рабочем src/lib/analysis.ts `analyze` вызывает функцию `analyze` только с
  `{text, complexName}`. Handler supabase/functions/analyze/index.ts не принимает
  runId/input snapshot и не пишет analysis_runs; допускает R1–R6. Отдельная proxy
  реализация и unit-модель run не подключены в этот end-to-end путь.
- Analyze.svelte stale сравнивает только text/zk, не весь metadata snapshot; run
  не имеет AbortController, catch не защищён generation. Это статические пробелы
  C5/S4, не заявленные здесь результаты exploit-тестов.

Только новая миграция local БД не устранит недостающий trusted AI путь и eval.
Это работа по восстановлению S4 v2, а не механическая смена SHA. Подмена реального AI
mock/fixture и фабрикация run в пользовательской БД не выполнялись.

## Решение и продолжение

Вход S4 не восстановлен, **S5 BLOCKED**. Все S5.1–S5.4 и D5.1–D5.5 — NOT_RUN:
реализация S5, три PDF, визуальный осмотр и полный connected кейс не выполнялись.
Следующий разрешённый шаг — исправить вход S4 (контракт AI, local migrations,
актуальные C/L tests, 12 eval + browser), затем подтвердить регрессию актуальными
свидетельствами и запустить gate 4. Только exit 0 разрешает S5.1. S6 запрещён.

Runtime: Node v24.18.0, npm 11.16.0, Python venv 3.11.0, Supabase CLI 2.121.0,
Docker Engine 29.1.3. Историческое окружение имело другие версии; это записано,
но не объявляется автоматически причиной дефекта.
