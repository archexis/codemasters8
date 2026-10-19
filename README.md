# SAQ QURYLYS

Мониторинг рисков долевого строительства для аналитика: публикация → AI-гипотеза → проверка человеком → объяснимый score → неизменная версия сигнала → PDF. Риск не устанавливает факт правонарушения. Synthetic кейсы явно обозначены; публичный снимок не является актуальной юридической проверкой.

Новый UX: **Карта / Публикации / Реестры** → единое досье с вкладками **Обзор / Проверка / Связи / Хронология**. Расследование использует то же досье. Принятие AI-гипотезы не начисляет баллы: факт проверяется отдельным решением в активном деле. [Реализованные изменения, проверки и оставшиеся ограничения](docs/UX_IMPLEMENTATION.md).

## Запуск DEMO

Проверены Node 24.18.0/npm 11.16.0, Python 3.11.0. Из чистой копии:

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

Открыть http://127.0.0.1:5173. Без Supabase env работает DEMO без регистрации. Seed: 16 объектов, 13 публикаций. Решения — localStorage, файлы — IndexedDB. DEMO анализ — локальный RU/KZ parser, не внешний AI. Web Locks сериализует локальные записи; без него запись блокируется. Сброс доступен через «Демо-аналитик». API JSON export не содержит файлы; полный ZIP backup находится на #/backup.

## Connected и настоящий AI

Полная инструкция: [RELEASE_RUNBOOK](docs/RELEASE_RUNBOOK.md). Создать отдельный локальный Supabase (Docker), применить **все** миграции supabase/migrations по имени; не reset рабочей БД. Скопировать .env.example в игнорируемый .env, задать публичные VITE_SUPABASE_URL/ANON_KEY и backend URL. Оператор входит по административно выданной учётке; регистрации в интерфейсе нет. initialize_workspace загружает персональный seed. RLS закрывает чужие данные.

FastAPI: создать backend/.venv, установить `backend/requirements.lock.txt`, запустить `backend/.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`. На Unix использовать bin/python. SUPABASE_URL/ANON_KEY и CORS_ORIGINS — серверная конфигурация API; service_role ему не нужен.

Edge: LLM_API_URL/MODEL/API_KEY, LLM_THINKING, ALLOWED_ORIGIN — только сервер. Локальный runtime предоставляет SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY; последний пишет доверенный analysis_runs. `npx supabase functions serve analyze --env-file .env.edge`. Ключи не имеют префикса VITE_ и не попадают в Git. Внешний provider — OpenAI-compatible; DeepSeek Flash проверялся в архивном прогоне, свежий платный прогон NOT_RUN. Prompt/schema и AI evidence связаны hashes в приёмке. Ошибка LLM не заменяется parser-success.

AI: body ≤100000 bytes, text ≤20000 JS characters, quota 30/час/пользователь, timeout provider 30 секунд. Только R2/R3 extraction с точной цитатой. Подтверждение человеком требует источников/дат/материала; unknown даёт 0. R1/R4/R5/R6 проверяются вручную, R3 требует отдельного материала о вводе. Score — сумма уникальных confirmed факторов, до 100; red требует R1+R2. A/B/C: 35/70/10.

## Доказательства, история и восстановление

Единственный writer RPC apply_command(command, expected_version, command_id); повторы используют receipt. Reviewer/time — серверные. Upload→атомарная metadata/evidence команда; неизвестный исход не удаляет файл. Private Storage: JPEG/PNG/WebP/MP4/PDF до 20 MiB, own prefix, подписанные ссылки; referenced evidence удалять нельзя. MIME проверяет заявленный тип, не заменяет антивирус/OCR.

Signal versions append-only. Исторический PDF читает сохранённый snapshot, включая материалы/provenance, и не подменяет его текущими фактами. Backup ZIP содержит JSON+байты+SHA256 manifest. Restore — в отдельное пустое workspace, confirmed→needs-verification, signals→draft; исходная атрибуция сохраняется как provenance. Перед upgrade снять DB+Storage backup. Rollback — совместимая старая версия либо восстановление в отдельную среду, без произвольных down migrations.

## Проверки и демонстрация

```sh
npm run check
npm test
npm run build
npm run test:e2e
npm run test:cloud
npm run test:edge
npx deno check supabase/functions/analyze/index.ts
npm run test:api
npm run test:local
npm run verify:score
```

`test:local` читает игнорируемый supabase/.temp/status.json и создаёт временные аккаунты. `test:cloud` использует mock HTTP. AI `npm run test:deepseek` требует явного `SAQ_ALLOW_PAID_AI=1` после согласования бюджета (до 13 вызовов: 12 eval + 1 browser), отдельно от unit. `test:api` выбирает backend/.venv, затем активный python; переопределение — SAQ_PYTHON. [Сценарий и резервные материалы](docs/DEMO_SCRIPT.md), [приёмка S6](docs/acceptance/sprint-6.md), [release manifest](docs/RELEASE_MANIFEST.json). Исторический gate6 проверяет архив S6 и не является текущей приёмкой. Текущий dirty-кандидат идентифицируется baseHead и manifest фактических байтов; candidateSHA до отдельного коммита равен null. Production deploy/push/отправка заявки не входят в выполненные действия.

## Стек и ограничения

Svelte 5/TypeScript/Vite/Tailwind, Supabase Auth/PostgreSQL JSONB/RLS/Storage/Edge, FastAPI, MapLibre, Zod, PapaParse; версии и лицензируемые зависимости — package-lock.json и Python lockfile. Разработка и тестирование с AI assistance; решения и материалы проверяет человек.

Нет OCR, скрейпинга, живой сверки госреестров, CV дронов, общих организаций и полного двуязычного UI. Карта зависит от WebGL/OSM/Esri; независимый список остаётся рабочим. Seed содержит synthetic и явно датированный public snapshot. Исторические docs аудита не заменяют текущие CONTRACTS и приёмку.

Текущая передача разработки: [score-maxxing REPORT](docs/acceptance/score-maxxing/REPORT.md). Архивы S4–S6 отражают прежний код и не заменяют эту приёмку.
