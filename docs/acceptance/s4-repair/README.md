# Восстановление входа S4 v2 — PASS

Дата: 2026-10-18. S4.1–S4.5 / D4.1–D4.5 переприняты. S5/S6 в этом ремонте не выполнялись.

## Рабочий продукт

- `supabase/functions/analyze/index.ts`: настоящий пользовательский JWT, проверка ЖК в own workspace, отдельный server writer, атомарный pending claim `(owner_id,id)`, SHA256 canonical snapshot, replay без квоты/повторного inference, conflict при ином вводе; succeeded только после успешной записи. Failed/pending не становятся успехом и требуют явно нового запуска. Ограничения 100000 байт / 20000 символов / 30 секунд / 30 запросов в час сохранены. Quota exhaustion и quota DB failure различаются.
- `src/lib/analysis.ts`, `src/components/Analyze.svelte`, `src/lib/repository.ts`, `src/App.svelte`: полный snapshot text/zkId/url/account/date/platform и выбранного file manifest; AbortController, supersession/unmount/session guards, повторная проверка snapshot после upload. Серверные runId/hypothesisId идут в команды. Первая публикация и вложение сохраняются одной командой; следующие решения используют существующий adId и независимые комментарии. Review retry сохраняет command ID. История решений доступна после reload; reason модели не подставляется как human comment.
- `src/lib/domain.ts`, `types.ts`, `validation.ts`, две корректирующие миграции `20261019000300_s4_trusted_path.sql` / `20261019000400_s4_commissioning_material.sql`: rejected/confirmed сохраняются раздельно; прямой RPC проверяет полный metadata snapshot, owner, succeeded, код, точную quote, парность и принадлежность hypothesisId для всех решений. Поддельный realAI без доверенного run отклоняется. Подтверждение связанного с run R3 требует beforeCommissioning(source/date/text), независимого материала о вводе. Сам AI материал не подтверждает.
- `supabase/functions/analyze-proxy/index.ts`: ограниченный R2/R3 prompt v3, отрицания оплаты, инструкции внутри текста как данные; R3 требует явного содержания о строительстве/вводе, один представитель каждого кода. Версия повышена после сохранённого реального FAIL AI07.

Ранее существовавшие dirty-изменения, включая BackupPanel, seed/review fixes и diagnostics S5, не откатывались. Архитектура и дизайн не заменялись. Push/production deploy/reset отсутствуют.

## Проверки и команды

| Профиль | Реальная команда | Итог / свидетельство |
|---|---|---|
| T | `npm run check` | 0 errors / warnings; [log](check.log) |
| U | `npm test` | 297/297, 23 файла, включая production handler и прямой SQL; [log](unit.log) |
| B | `npm run build` | PASS; [log](build.log) |
| E | `npm run test:e2e` | 68/68 desktop/mobile; [log](e2e.log) |
| C | `npm run test:cloud` | 1/1; [log](cloud.log) |
| A | `backend/.venv/Scripts/python.exe -m pytest backend/tests -q` | 9/9; [log](api.log) |
| F | `npm run test:edge`; `npx --yes deno check supabase/functions/analyze/index.ts` | 3/3 + typecheck; [tests](edge.log), [types](deno-check.log) |
| L | `npm run test:local` | настоящие Auth/RLS/Storage/API/Edge + 4/4 browser/isolation; [log](local.log) |
| AI | `npm run test:deepseek`; затем ограниченное `--reuse-eval docs/acceptance/s4-repair/ai-1792343450532.json` | 12/12 v3 + новый browser input/reviews/reload; [log](ai.log), [полный итог](ai-1792343710446.json) |
| secrets | `node tools/verify-no-server-secrets.mjs` | реальные server/provider bytes отсутствуют в tracked files, bundle и repair reports; [результат](secrets.json) |
| gates | `npm run gate -- 0` … `npm run gate -- 4` | все exit 0; [gate 4](gate4.log) |

Новые отрицательные сценарии — `tests/unit/analyze-handler.test.ts`, `ai-provenance-sql.test.ts`, transport fixtures; тесты вызывают рабочий handler, подменяя только внешний транспорт. Проверены ошибка финальной записи, pending/failed replay, одновременный runId, конфигурация, ownership/forged owner, входные лимиты, provider JSON/schema/quote/code/max count, quota 429 vs DB 503. SQL отказы не изменяют workspace/version/audit. DML analysis_runs запрещён обычному клиенту. Browser матрица меняет все семь полей snapshot, проверяет отмену/поздний success/error/unmount/session и независимый R2/R3 с одной публикацией.

Старые live/cloud locators заменены под текущую форму, ожидание входа теперь проверяет настоящую сессию и connected workspace. Cloud порт — `SAQ_CLOUD_PORT`, default 5184, чужой 5174 не трогался. Local smoke использует 3-arg RPC с command_id, передаёт isolation env и исполняет четыре обязательных теста без skips. Платный browser тест запускается отдельным профилем, не выдаётся за выполненный в бесплатном local.

## Реальный AI и сохранённые неудачи

1. [Первая попытка](ai-1792343366666.json): 11/12; AI07 ошибочно получил R3 по общему рекламному призыву. Expected не менялся.
2. [Prompt v3](ai-1792343450532.json): 12/12. Browser остановился до inference с ORIGIN_FORBIDDEN: исходный env разрешал 5173, live работал на 5175.
3. Точный live origin добавлен в игнорируемую `.temp/s4-repair/edge.env`, исходный `.env.edge` не изменён. Kong самостоятельно отвечает OPTIONS с `*`; preflight скрипта проверяет реальные POST: own origin доходит до AUTH_REQUIRED, чужой получает ORIGIN_FORBIDDEN. [Лог диагностической ошибки preflight](ai-preflight-gateway.log).
4. [Browser успешно выполнил анализ/review/reload](ai-post-browser-harness.log), затем harness неправильно предполагал наличие уже созданного signal в seed. Исправлено ожидание реального контракта: отсутствие сигнала означает draft; подтверждённых SignalVersion нет.
5. [Итог](ai-1792343710446.json): повторена только browser часть, 12 уже успешных eval не вызывались повторно. Реальный server run, R2 confirmed / R3 rejected, одна публикация, обе причины после reload; signal не подтверждён. В отчёте сохранены run IDs/model/prompt/input hash/status/latency. Временные пользователи удаляются в finally.

Это контрольный корпус, не заявление об общей точности модели. Бесконечного подбора prompt не было: одна содержательная коррекция, два полных eval-набора; последующие повторы касались локальной инфраструктуры/проверочного скрипта и browser части.

## Локальная БД и сохранность

До изменения: custom `pg_dump` всей БД и raw-копия Storage volume `/mnt` в игнорируемой `.temp/s4-repair`; [SHA256/размеры и список миграций](local-upgrade.json). Детальный backup manifest остаётся приватным в `.temp/s4-repair/backup-manifest.json`. После сверки CLI `--help` применены отсутствующие миграции через `migration up --local --include-all`, затем новая material migration через `migration up --local`. Нет db reset или удаления пользовательских данных. Restore проверен на временных пользователях, не на рабочем workspace. Local Edge запущен на исправленных исходниках с существующими серверными ключами и точным тестовым CORS origin.

## Отчёты, источники, граница работы

Исторические S0–S4 сохранены побайтно в [history](../history/s4-before-repair/manifest.json). Основные sprint-0…4.json содержат отдельную актуальную переприёмку с полной накопленной регрессией. `tools/source-manifest.mjs` включает tracked и untracked src/functions/migrations/backend/app+tests/tests/tools/configs/lockfiles; исключает секреты, dependencies, generated/cache и acceptance. SHA256 считается по точным байтам, включая CRLF; 81 прежнее CRLF-only расхождение не объявлялось продуктовым багом. Gate freshness не отключалась и код gate не менялся.

`node tools/record-s4-acceptance.mjs` формирует отчёты только при завершённых успешных profile logs и 12/12 + browser PASS. `npm run gate -- 4` — exit 0. Незакрытых критериев S4 нет. Следующий разрешённый пакет — S5.1; S5/S6 и их существующие NOT_RUN/BLOCKED отчёты этим ремонтом не выполнялись и не переписывались.
