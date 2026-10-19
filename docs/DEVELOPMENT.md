# Разработка и проверки

## Окружение

- Node.js 24 и npm; зависимости устанавливаются через `npm ci`.
- Python 3.12 используется в CI и Docker; API устанавливается из `backend/requirements.lock.txt`.
- Chromium для Playwright: `npx playwright install chromium`.
- Deno 2 для Edge-проверок.
- Docker и Supabase CLI для локального подключённого стека.
- Tesseract с `rus` и `eng` для реального OCR.

Настройка API и Supabase: [запуск и эксплуатация](RELEASE_RUNBOOK.md).

## Команды

| Команда | Назначение | Условия |
| --- | --- | --- |
| `npm run dev -- --port 5173 --strictPort` | Vite dev server | Node.js |
| `npm run check` | Svelte и TypeScript diagnostics | Node.js |
| `npm test` | Vitest, доменные контракты, SQL в PGlite | Без рабочего Supabase |
| `npm run build` | Production bundle в `dist/` | Node.js |
| `npm run preview` | Просмотр собранного bundle | После build |
| `npm run test:e2e` | DEMO в desktop/mobile Chromium | Chromium; порт 5176 |
| `npm run test:cloud` | Подключённый UI с HTTP mock | Chromium; порт 5184, меняется через `SAQ_CLOUD_PORT` |
| `npm run test:api` | Python API tests | Python-зависимости |
| `npm run test:edge` | Deno tests Edge Function | Deno 2; первая загрузка зависимостей требует сети |
| `npx deno check supabase/functions/analyze/index.ts` | Типизация Edge Function | Deno 2 |
| `npm run verify-all` | Check, unit, build, E2E, mock, API, Edge tests | Зависимости всех проверок |
| `npm run verify:score` | Прогон с manifest и журналом | Также Edge typecheck; вывод в `test-results/score-maxxing/` |
| `npm run test:local` | Интеграция с локальным стеком | Supabase, API, Chromium, status JSON |
| `npm run test:live` | Playwright live-suite | Настроенные `SAQ_LIVE_*`, Supabase и API |
| `npm run test:deepseek` | Платный provider smoke/eval | Согласованный бюджет, credentials, локальный стек |
| `npm run gate -- 6` | Исторический пакет S6 | Не является приёмкой нового кода |

CI в [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) проверяет frontend, HTTP mock, Python API и Edge Function. Платная LLM и настоящий Supabase в этот workflow не входят.

## Выбор проверки

Для документации проверьте ссылки, команды и `git diff --check`. Для домена запустите относящиеся к изменению unit/SQL-тесты и `npm run check`; для UI добавьте соответствующие E2E. Перед сдачей кода выполните check, unit и build; затронутые backend и Edge-проверки запускаются отдельно.

```sh
npx vitest run tests/unit/scoring-attack.test.ts tests/unit/investigation.test.ts
npx playwright test tests/e2e/ux-target.spec.ts tests/e2e/signal-export.spec.ts
```

`test:api` выбирает Python из `backend/.venv`, затем из активного окружения. `SAQ_PYTHON` задаёт явный путь. Playwright пишет в `test-results/e2e`, `test-results/cloud`, `test-results/live`.

## Настройка live-проверки

Настройте отдельный локальный Supabase по runbook. Сохраните его статус в игнорируемый файл. Он содержит ключи и не должен попадать в Git или публичные логи.

PowerShell:

```powershell
npx supabase status -o json | Set-Content -Encoding utf8 supabase/.temp/status.json
npm run test:local
```

POSIX shell:

```sh
npx supabase status -o json > supabase/.temp/status.json
npm run test:local
```

`test:local` создаёт и удаляет собственные временные аккаунты и принимает только локальный URL. Live frontend использует порт 5175, API по умолчанию — 8005; `SAQ_LIVE_API_URL` меняет адрес API. Проверка привязана к seed: при его обновлении сверьте ожидания в `tools/local-smoke.mjs` и `tests/live/` с новой версией набора.

Платный smoke требует `SAQ_ALLOW_PAID_AI=1`. Не задавайте флаг в общем CI и не используйте без бюджета. Сохранённый eval подтверждает только свой прогон.

## Частые проблемы

| Симптом | Проверка |
| --- | --- |
| Вместо DEMO показан вход | Очистить обе `VITE_SUPABASE_*` в окружении и `.env*`, перезапустить Vite |
| Локальная запись блокируется | Проверить Web Locks и запуск через `localhost`/`127.0.0.1` |
| Playwright не стартует | Установить Chromium и проверить порт из config; тесты не переиспользуют чужой сервер |
| API возвращает 503 | Проверить `SUPABASE_URL`, `SUPABASE_ANON_KEY` и доступность Supabase |
| Ошибка CORS | Проверить протокол и порт в `CORS_ORIGINS` API и `ALLOWED_ORIGIN` Edge |
| OCR возвращает 503 | Проверить Tesseract и наличие `rus`, `eng` через `tesseract --list-langs` |
| В PDF нет кириллицы | Задать `PDF_FONT_PATH` или установить DejaVu Sans/Arial |
| Исторический gate не проходит | Сверить код и manifest отчёта; не переписывать старый PASS под новую копию |

## Исторические инструменты

`tools/record-s*-acceptance.mjs`, `tools/s6-*.mjs` и старые manifests относятся к прежним приёмкам. Некоторые скрипты привязаны к Windows и перезаписывают исторические файлы. Для обычной разработки они не нужны. Сохранение `docs/acceptance/` и `docs/sprints/` по прежним путям поддерживает воспроизводимость и fixture-тесты.
