# Локальный release candidate

Node 24.18.0/npm 11.16.0 и Python 3.11.0 проверены в этом окружении. Python зависимости фиксирует backend/requirements.lock.txt. Docker нужен только для connected Supabase.

## Чистый запуск

1. Получить именно candidate SHA из RELEASE_MANIFEST.json. Не копировать .env, node_modules, .venv, dist или caches. `node tools/s6-clean-room.mjs` переносит полный текущий source manifest, нужные untracked и документацию в новую .temp директорию, проверяет SHA256 каждого файла и выполняет npm ci/build/check, Python venv+locked install+pytest. Он не заменяет рабочие env/БД.
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

T/U/B/E/C/A/F/L: команды docs/sprints/EXECUTION.md. `npm run test:local` читает игнорируемый supabase/.temp/status.json, создаёт и удаляет только свои аккаунты/файлы. Чужой порт 5174 не занимать; C использует tools/acceptance.cloud.config.ts и 5184. `npm run test:deepseek` вызывает платный provider; повторять только при изменении AI inputs. Секреты никогда не выводить в логи. `npm run gate -- 6` должен честно остаться ненулевым, пока candidate SHA не доступен адресату.
