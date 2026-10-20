> Исторический документ. Описывает прежнюю версию или план; для текущей работы используйте [актуальную документацию](../../README.md).

# Локальный release candidate

Node 24.18.0/npm 11.16.0 и Python 3.11.0 проверены в этом окружении. Python зависимости фиксирует backend/requirements.lock.txt. Docker нужен только для connected Supabase.

## Чистый запуск

1. Проверить RELEASE_MANIFEST.json: у текущего dirty-кандидата candidateSHA=null; воспроизводимое состояние задают baseHead и sourceByteManifest фактических байтов. Старые candidate SHA и отчёты S6 относятся к архиву. Не копировать .env, node_modules, .venv, dist или caches. Для чистой проверки скопировать manifest-файлы в отдельный каталог, сверить SHA256, выполнить npm ci/check/build и Python venv+locked install+pytest. Исторический tools/s6-clean-room.mjs привязан к Windows и пишет в архив docs/acceptance/s6; текущую приёмку им не перезаписывать. Он копирует только выбранные документы, а не весь пакет.
2. `npm ci`, затем `npm run dev -- --port 5173 --strictPort`. Без env работает DEMO. Вход не нужен. Открыть http://127.0.0.1:5173. DEMO parser не является LLM.
3. Для connected создать отдельный локальный Supabase project с уникальным project_id и свободными API/DB/Studio/Auth ports. Сначала `npx supabase start --help`, затем start из его каталога. Не выполнять reset рабочей БД. Применить **все** SQL из supabase/migrations в лексикографическом порядке, включая корректирующие миграции. Исторические миграции не редактировать. Создать операторскую учётку административно; регистрации в UI нет. initialize_workspace загружает seed только для вошедшего пользователя.
4. Скопировать .env.example в игнорируемую .env. VITE_SUPABASE_URL/ANON_KEY — публичные URL/key; SUPABASE_URL/ANON_KEY — FastAPI. CORS_ORIGINS и ALLOWED_ORIGIN должны совпадать с фактическим frontend origin. VITE_API_URL задаёт backend URL. Секреты не имеют префикса VITE_.
5. Создать backend/.venv: `python -m venv backend/.venv`; `backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.lock.txt`; `backend/.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`. На Unix использовать bin/python.
6. Edge env: LLM_API_URL (OpenAI-compatible chat completions), LLM_MODEL, LLM_API_KEY, LLM_THINKING=disabled для DeepSeek Flash, ALLOWED_ORIGIN. SUPABASE_SERVICE_ROLE_KEY нужен только серверному writer analysis_runs, локальная платформа предоставляет его автоматически вместе с SUPABASE_URL/ANON_KEY. `npx supabase functions serve analyze --env-file .env.edge`. Не использовать service_role в FastAPI/браузере. В этом спринте production deploy не выполняется.

## Лимиты и неизвестные данные

AI: 100000 bytes на body; 20000 JS characters текста; 30 запросов/час/пользователь; до 6 R2/R3 hypotheses; provider timeout 30 секунд, Auth/DB 10 секунд. Ошибки 401/403/413/422/429/502/503/504 не превращаются в regex-success. Повтор runId с другим snapshot запрещён; pending/failed требует нового runId. Нет даты/основания/источника — unknown, не сегодняшняя дата и не confirmed. R3 требует независимого датированного материала о невводе. Только human decision начисляет score.

Evidence: private bucket, owner prefix, JPEG/PNG/WebP/MP4/PDF до 20 MiB. Подписанная ссылка краткоживущая. MIME — ограничение заявленного типа, не антивирус/распознавание содержимого. Upload→одна metadata/evidence команда; при неизвестном RPC исходе файл сохраняется до receipt/retry. Referenced evidence не удаляется обычным пользователем.

## Fresh/upgrade/backup/rollback

`npm test` применяет все миграции к отдельным PGlite БД с тестовыми auth/storage и проверяет legacy upgrade. S6 дополнительно проверяет fresh и upgrade на одноразовых PostgreSQL БД внутри локального контейнера: тестовый bootstrap auth/storage, не рабочая Supabase БД. L проверяет реальные Auth/Storage/Edge/API в новых временных аккаунтах и restore в третьем пустом workspace. Это разные уровни проверки, не production rehearsal.

Перед настоящим upgrade снять pg_dump и полный Storage backup с manifest/SHA256; сохранить закрыто вне Git. Восстановление приложения: #/backup → скачать ZIP (JSON+байты+manifest). `/api/export` — только JSON, не полный backup. Restore только в пустое отдельное workspace; paths получают нового owner, confirmed→needs-verification, signals→draft, старая атрибуция только provenance. Проверить bytes/hash, IDs и связи, затем повторные решения аналитика.

Rollback: остановить запись; запустить совместимую прежнюю версию либо восстановить DB+Storage backup в отдельной среде и проверить; затем переключить пользователей. Произвольные down migrations с удалением истории запрещены. Не перезаписывать рабочие данные пользовательским restore.

## Проверка

Offline: `npm run verify:score` последовательно запускает check/unit/build/E2E/mocked HTTP/API/Edge tests/Edge typecheck и записывает verification.json с исходным manifest и sourceUnchanged. Он не запускает live Supabase или платный provider. Команды и буквы T/U/B/E/C/A/F/L в docs/sprints/EXECUTION.md относятся к историческому S6. `npm run test:local` читает игнорируемый supabase/.temp/status.json, создаёт и удаляет только свои аккаунты/файлы. Порты смотреть в актуальных playwright*.config.ts; не занимать чужие процессы. `npm run test:cloud` использует playwright.cloud.config.ts. tools/acceptance.cloud.config.ts относится к отдельной исторической приёмке. `npm run test:deepseek` вызывает платный provider и требует отдельного согласованного бюджета и SAQ_ALLOW_PAID_AI=1. Без согласования статус NOT_RUN. Секреты никогда не выводить в логи. `npm run gate -- 6` проверяет архивные S6 artifacts; его результат не сертифицирует текущий dirty-кандидат.


## Приёмка score-maxxing (19 октября 2026)

Текущие результаты: [REPORT](../../acceptance/score-maxxing/REPORT.md). `npm run test:cloud` — mocked HTTP; `npm run test:local` — настоящий локальный стек. Не смешивать эти статусы.
`npm run test:api` использует backend/.venv (Scripts/python.exe на Windows, bin/python на Unix), иначе активный python. SAQ_PYTHON задаёт явный исполняемый файл.
Live frontend: 127.0.0.1:5175, API: 127.0.0.1:8005; SAQ_LIVE_API_URL меняет API адрес. FastAPI CORS_ORIGINS и Edge ALLOWED_ORIGIN должны включать точный frontend origin.
Runtime артефакты — только test-results/. Обычный E2E пишет в test-results/e2e; cloud/live имеют отдельные каталоги. Отобранный пакет копируется после остановки Vite.
Платный AI: установить SAQ_ALLOW_PAID_AI=1 только после согласования не более 13 вызовов. --reuse-eval явно оставляет eval архивным и не даёт нового полного PASS.
Dirty-кандидат идентифицируется baseHead и sourceByteManifest; candidateSHA отсутствует до отдельного коммита (null). Публикация этого состояния не выполняется автоматически.

Чистая установка зависимостей проверена отдельно. Ранний clean-room snapshot предшествовал последним исправлениям; его PASS нельзя переносить на итоговый sourceByteManifest без сверки файлов. Runtime текущей среды: Node 24.18.0, npm 11.16.0, Python 3.11.0, Deno 2.9.6, Supabase CLI 2.121, Docker 29.1.3.

`npm run test:local` сохраняет успешный summary в test-results/score-maxxing/local-live-<UTC-run-id>/live-test-report.json. Trace/screenshots Playwright остаются в test-results/live; terminal log следует сохранить рядом с summary.

## Публикация Vercel DEMO

Пользователь выбрал публичный DEMO; connected AI остаётся локальным. `vercel.json` задаёт Vite/npm ci/dist. Загружать только отслеживаемые исходники отдельного candidate SHA; `.vercelignore` исключает env, evidence, test-results, docs и backend. Публичные env VITE_SUPABASE_URL/ANON_KEY должны быть пустыми. Никогда не загружать .env.edge. В Vercel использовать проект saq-qurylys / spydonnys-projects. После deploy проверить HTTP без авторизации и UI конкретного SHA.
Свежий paid AI PASS и ограничения — REPORT/paid-ai. 1 USD согласован, выполнено15 запросов с двумя исправлениями test harness; следующий запуск требует нового лимита количества и остатка бюджета.

Опубликованная версия: SHA `99ec5736d78c3e3357f52791d0d4b1794f236013`, https://saq-qurylys-pi.vercel.app, deployment dpl_4P8DznFFQBPkTgvjq66u8LWe81J4. CI39256363997 SUCCESS. Созданный по умолчанию immutable deployment URL защищён Vercel SSO; публичен production alias выше. Проверить source SHA1 по docs/acceptance/score-maxxing/publication/deployed-files.json и Git archive кандидата. Для CLI50 на Windows с Unicode hostname можно в отдельном процессе preload переопределить os.hostname на ASCII; ключи не менять/не печатать.
