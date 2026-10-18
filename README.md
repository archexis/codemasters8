# SAQ QURYLYS — мониторинг рисков долевого строительства

Приложение перенесено на **Svelte 5 + TypeScript + Vite**, **Tailwind CSS**, **MapLibre GL JS**, **Supabase PostgreSQL / Auth / Storage / RLS**, **FastAPI** и **Supabase Edge Functions**. Тесты: **Vitest + Playwright**, pytest и Deno.

Сценарий: объекты → публикация → анализ → доказательства → решение аналитика → сигнальная карточка → печать/PDF. Признаки риска не устанавливают факт правонарушения.

## Быстрый запуск

Нужны Node.js 24 и npm. Python 3.11+ нужен для FastAPI.

```sh
npm ci
npm run dev
```

Открыть http://127.0.0.1:5173. В текущей рабочей копии уже создан игнорируемый Git файл `.env` с публичными ключами локального Supabase; контейнеры и FastAPI запущены. Для входа зарегистрируйтесь, откройте письмо в http://127.0.0.1:54324, подтвердите email и загрузите демоданные в своём пространстве.

В чистом клоне без Supabase-конфигурации включается явно обозначенный DEMO: 16 объектов, 13 публикаций, 11 ссылок на реестры. Восемь объектов вымышлены, восемь взяты из публичного снимка от 15.10.2026; происхождение отмечено в интерфейсе. Публичный снимок не является актуальной правовой проверкой.

В DEMO решения сохраняются в localStorage, фото/видео/PDF — в IndexedDB и переживают перезагрузку. Анализ выполняет локальный парсер RU/KZ, подписанный как демо. DEMO не имитирует серверную авторизацию. Сброс доступен через «Демо-аналитик» и очищает также файлы.

## Подключение Supabase

1. Создать Supabase-проект. Скопировать `.env.example` в `.env`.
2. Задать `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (публичный publishable или legacy anon key), `SUPABASE_URL`, `SUPABASE_ANON_KEY`. Перезапустить Vite после изменения переменных.
3. Применить обе миграции из `supabase/migrations/` в указанном порядке через SQL Editor либо CLI:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

4. В Supabase Auth включить Email/password и настроить Site URL/Redirect URLs под адрес приложения. Зарегистрироваться в приложении и подтвердить email, если подтверждение включено в настройках проекта.
5. После входа создать объект или нажать «Загрузить демоданные». Это отдельное персональное пространство пользователя; чужие данные RLS не показывает.

Для локального Supabase нужны запущенный Docker и CLI:

```sh
npx supabase start
npx supabase db reset
npx supabase status
```

Ключи и URL из `status` нужно внести в `.env`. Для локальной проверки без почтового подтверждения можно изменить `auth.email.enable_confirmations` в `supabase/config.toml` и перезапустить локальный стек.

## AI через Edge Function

В подключённом режиме браузер вызывает только `supabase.functions.invoke('analyze')`. Ключ LLM в браузер не передаётся.

Создать локальный файл `.env.edge` (он игнорируется Git):

```dotenv
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=YOUR_MODEL
LLM_API_KEY=YOUR_SERVER_KEY
ALLOWED_ORIGIN=http://127.0.0.1:5173
```

Провайдер должен поддерживать OpenAI-совместимый Chat Completions API и JSON output. Deploy:

```sh
npx supabase secrets set --env-file .env.edge
npx supabase functions deploy analyze
```

Для локального запуска: `npx supabase functions serve analyze --env-file .env.edge`. При локальном Supabase встроенные `SUPABASE_URL` и `SUPABASE_ANON_KEY` предоставляет платформа.

Gateway JWT check отключён в config.toml для совместимости ключей; **сама функция обязательно проверяет пользовательский Bearer token через Supabase Auth**. Лимит: 30 запросов в час на пользователя, текст до 20 000 символов, таймаут провайдера 30 секунд. Ответ проверяется по схеме и дословному присутствию цитат. Ошибка облачного LLM показывается пользователю; локальный парсер не выдаётся за успешный ответ LLM.

## FastAPI

PowerShell:

```powershell
py -3.11 -m venv backend/.venv
& backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.lock.txt
& backend/.venv/Scripts/python.exe -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Linux/macOS: `python3 -m venv backend/.venv`, затем использовать `backend/.venv/bin/python`.

`GET /health` — состояние сервиса и наличие конфигурации. `GET /api/summary` и `GET /api/export` требуют пользовательский Bearer token. API проверяет его через `/auth/v1/user`, затем обращается к PostgREST с тем же токеном и публичным ключом, сохраняя RLS. Service-role key не используется. Экспорт доступен в меню аккаунта. OpenAPI: http://127.0.0.1:8000/docs.

При другом адресе backend изменить `VITE_API_URL`; разрешённые frontend origins задаёт `CORS_ORIGINS`.

## Структура

- `src/App.svelte`, `src/components/` — Svelte 5 runes, разделы, формы и карта.
- `src/app.css` — Tailwind 4 через Vite, адаптивные стили и печать.
- `src/lib/types.ts`, `scoring.ts`, `parser.ts`, `domain.ts` — контракты, правила, парсер и команды.
- `src/lib/repository.ts`, `supabase.ts`, `analysis.ts` — PostgreSQL/Auth/Storage/Edge и отдельный деморежим.
- `src/lib/seed.json` — перенесённые исходные данные с происхождением.
- `supabase/migrations/` — PostgreSQL, RLS, закрытый bucket `evidence`, транзакционные RPC, серверный seed и лимит AI.
- `supabase/functions/analyze/` — серверный LLM-адаптер и тесты Deno.
- `backend/` — FastAPI, Dockerfile, тесты и зафиксированные Python-зависимости.
- `tests/unit/`, `tests/e2e/`, `tests/cloud/` — доменные, SQL и браузерные проверки.
- `tests/fixtures/` — исходные 178 assertions, выполняемые против новых TypeScript-модулей через Vitest.
- `.github/workflows/ci.yml` — сборка и проверки.

Исходный runtime `js/*.js` и Leaflet удалены. Hash-маршруты сохранены: `#/home`, `#/overview`, `#/detail/SQ-002`, `#/ads`, `#/analyze`, `#/signal/SQ-002`, `#/registries`.

## Данные и контроль доступа

Рабочее пространство хранится в PostgreSQL как версионированный JSONB-документ (`workspaces`, одна строка на пользователя). Для текущего объёма это сохраняет атомарность связанных решений. Это не нормализованная многопользовательская CRM; общие организации/роли и масштабирование по отдельным таблицам потребуют отдельной миграции.

Прямые записи клиента в таблицы запрещены. Команды выполняет `apply_command` в транзакции с блокировкой строки и проверкой `expected_version`. Reviewer берётся из Auth на сервере. История решений дополняется с полным содержимым команды. Изменение фактов возвращает сигнал в черновик; подтверждённый сигнал содержит снимок объекта.

R1 нельзя подтвердить без проверенного отсутствия основания; R2 требует источника и цитаты; R5 — подтверждённого разрыва ≥20 п.п. Пересмотр готовности снимает старое подтверждение R5. Только подтверждённые уникальные факторы дают баллы; красная зона требует R1+R2. Контрольные кейсы A/B/C: 35/70/10.

Файлы Supabase хранятся в закрытом bucket, путь начинается с UUID пользователя. RLS ограничивает чтение/создание/удаление своим префиксом. Ссылки подписываются на 5 минут. Допустимы JPEG, PNG, WebP, MP4, PDF до 20 МБ. При ошибке сохранения метаданных загрузка откатывается.

## Проверки

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:cloud
npm run test:edge
```

Повторная проверка настоящего локального стека после `supabase start`:

```sh
npx supabase status -o json > supabase/.temp/status.json
npm run test:local
```

Этот тест создаёт два временных аккаунта, проверяет настоящие Auth/RLS/RPC/Storage/подписанные ссылки/FastAPI/Edge и запускает браузерный тест, затем удаляет только собственные тестовые аккаунты и файлы. Статус содержит локальные секреты и остаётся в игнорируемой `supabase/.temp/`. Для остановки локальных контейнеров: `npx supabase stop`.

API: `backend/.venv/Scripts/python.exe -m pytest backend/tests -q` (либо `npm run test:api` в активированном venv).

`npm test` включает настоящий PostgreSQL через PGlite: обе миграции, два пользователя, RLS, Storage policies, атомарность, устаревшие версии, доказательства, сигналы и лимит AI. Схемы Auth/Storage в этих тестах минимальные тестовые аналоги Supabase.

`test:e2e` проверяет desktop/mobile: карту, поиск, анализ, сохранение/отклонение, файлы после reload, готовность, создание/редактирование объектов, прямые ссылки и печать PDF. `test:cloud` использует реальный Supabase JS SDK с имитированными HTTP-ответами; он не подтверждает доступность конкретного облачного проекта. Deno-тесты используют имитацию Auth/LLM HTTP.

Результаты переноса: `docs/STACK_MIGRATION.md`. Предыдущие `docs/CODEBASE_AUDIT.md`, `FEATURE_INVENTORY.md`, `IMPLEMENTATION_HANDOFF.md`, `REQUIREMENTS_MATRIX.md` описывают старую версию до переноса.

## Ограничения проверки

Настоящий локальный Docker-стек Supabase успешно проверен: Auth, PostgreSQL-миграции/RLS/RPC, Storage, подписанные ссылки, Edge runtime и браузерный сценарий после reload. FastAPI с реальным пользовательским токеном получил данные из Supabase. Временные аккаунты и их файлы удалены после тестов.

Внешний DeepSeek подключён и проверен через настоящий Edge runtime: 6 проверок RU/KZ, отрицаний оплаты и встроенных инструкций, затем браузерный анализ → подтверждение → сохранение → reload. Используется `deepseek-flash`, JSON output, `max_tokens=2048`, thinking disabled. Отчёт: `docs/DEEPSEEK_TEST_REPORT.json`. Облачный Supabase-проект, production-развёртывание и доставка внешних email пока не проверены.

Нет автоматического скрейпинга, OCR, CV-анализа дронов и живой сверки государственных реестров. Карта требует доступа к OSM/Esri, а WebGL — поддержки браузера; при ошибке остаётся рабочий список объектов. Старый localStorage `sq_state_v1` автоматически не импортируется; исходный seed перенесён полностью. `tools/verify_ashyq.py` — старый независимый сетевой verifier, не входит в проверку новой сборки и не доказывает актуальность снимка.

## Повторить тесты DeepSeek

Ключ хранится только в игнорируемом `.env.edge`; он не попадает в Vite или Git.
Серверная конфигурация:

```dotenv
LLM_API_URL=https://api.deepseek.com/chat/completions
LLM_MODEL=deepseek-flash
LLM_API_KEY=YOUR_DEEPSEEK_KEY
LLM_THINKING=disabled
ALLOWED_ORIGIN=http://127.0.0.1:5173
```

```sh
npx supabase functions serve analyze --env-file .env.edge
# В другом терминале (настоящие платные запросы к провайдеру):
npm run test:deepseek
```

Тест создаёт отдельного временного пользователя, выполняет 6 запросов через Edge,
проверяет дословные цитаты и R2, затем проходит реальный браузерный сценарий
с ещё одним запросом к DeepSeek. В конце удаляет свой аккаунт и файлы.
Обычный `npm test` не вызывает внешнюю модель.
