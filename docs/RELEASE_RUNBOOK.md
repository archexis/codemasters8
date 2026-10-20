# Запуск и эксплуатация

Руководство описывает приложение из текущей рабочей копии. Даты, candidate SHA и результаты прежних выпусков находятся в [архиве](archive/README.md); они не нужны для обычного запуска.

## DEMO

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

Откройте [127.0.0.1:5173](http://127.0.0.1:5173). Без заполненной пары `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` приложение использует локальное хранилище и parser. При ранее заданных переменных удалите обе из окружения/`.env*` и перезапустите Vite. Backend, Docker и LLM для DEMO не требуются.

## Подключённый режим

### 1. Отдельный локальный Supabase

Нужны Docker и Supabase CLI. В репозитории уже есть `supabase/config.toml`; повторный `supabase init` не требуется. Используются API 54321, DB 54322, Studio 54323. Если на машине уже есть проект с тем же `project_id` или портами, настройте отдельную копию конфигурации до запуска.

```sh
npx supabase start
npm run migrate:safe
npx supabase status
```

Это команды для отдельной локальной среды. `migrate:safe` сначала помечает старую миграцию `20261019194027_real_site_demo_reset.sql` применённой, не исполняя её SQL, затем применяет остальные отсутствующие миграции. Пропускаемый файл только менял данные; актуальный seed поставляет `20261020000200_sync_seed_preserve_workspaces.sql`, не меняя пользовательские пространства, квитанции, AI-запуски и задания документов. Исторические SQL-файлы не редактируются.

Для существующей установки сначала сохраните резервную копию БД и Storage. Используйте `npm run migrate:safe` для локальной среды или `npm run migrate:safe -- --linked` для уже привязанного проекта; целевой проект выбирается существующей конфигурацией CLI. `npm run migrate:safe -- --dry-run` показывает команды без обращения к БД. Прямой `migration up`/`db push` со старым reset в списке pending удалит пользовательские данные до новой миграции. Не используйте `db reset` для обновления данных, которые требуется сохранить. Если старый reset уже исполнился, новая миграция не восстанавливает удалённые материалы: требуется прежняя резервная копия.

Миграции из `supabase/migrations/` применяются в порядке версии. Применённые файлы не редактируются; исправления добавляются новыми миграциями. Официальная справка: [локальный запуск](https://supabase.com/docs/reference/cli/supabase-start), [применение миграций](https://supabase.com/docs/reference/cli/supabase-migration-up).

### 2. Переменные приложения

Скопируйте `.env.example` в `.env`: PowerShell — `Copy-Item .env.example .env`, POSIX shell — `cp .env.example .env`. Заполните настройки своего локального Supabase.

| Переменная | Где используется | Значение |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Браузер | URL Supabase API |
| `VITE_SUPABASE_ANON_KEY` | Браузер | Публичный anon key; проект использует совместимый legacy-формат |
| `VITE_API_URL` | Браузер | FastAPI, обычно `http://127.0.0.1:8000` |
| `SUPABASE_URL` | FastAPI | Тот же Supabase URL |
| `SUPABASE_ANON_KEY` | FastAPI | Публичный anon key; доступ определяется JWT пользователя |
| `CORS_ORIGINS` | FastAPI | Разрешённые origin через запятую, без пробелов |

`VITE_*` попадает в frontend bundle. Service role, ключ LLM и административные токены остаются на сервере. `.env.example` — шаблон, `.env*` с реальными значениями остаются вне Git. После изменения frontend env перезапустите Vite; production bundle нужно пересобрать.

### 3. FastAPI

Из корня репозитория, PowerShell:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.lock.txt
backend/.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

POSIX shell:

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.lock.txt
backend/.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

[Health endpoint](http://127.0.0.1:8000/health) доступен без входа; `/api/*` требует Bearer JWT. `supabase_configured=true` означает наличие настроек, а не полную проверку интеграции. OpenAPI доступен по `/docs` у работающего FastAPI.

Для кириллицы в PDF установите DejaVu Sans/Arial или задайте `PDF_FONT_PATH`. Для OCR установите Tesseract с `rus` и `eng`, проверьте `tesseract --list-langs`. Dockerfile backend включает DejaVu и Tesseract. Подробности — [backend/README.md](../backend/README.md).

### 4. Анализ через LLM

Создайте отдельный игнорируемый `.env.edge` с серверными настройками:

```dotenv
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=your-model
LLM_API_KEY=your-provider-key
ALLOWED_ORIGIN=http://127.0.0.1:5173
```

`LLM_THINKING` — необязательная настройка провайдера; совместимость проверяйте для выбранной модели. Supabase runtime предоставляет Edge Function переменные `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Последняя нужна доверенной серверной записи AI-run и не используется FastAPI или браузером.

```sh
npx supabase functions serve analyze --env-file .env.edge
```

Origin должен точно совпадать с frontend. Лимиты и ссылки AI-run описаны в [архитектуре](ARCHITECTURE.md). При недоступном provider сохраняйте материал вручную.

### 5. Учётная запись и frontend

Создайте и подтвердите операторскую учётную запись через административные средства своей Supabase-среды. Нажмите «Войти оператору», введите email и пароль. После входа индикатор показывает «Подключённый режим» и email; «Выйти» возвращает локальный DEMO. Самостоятельной регистрации нет. Если персональное пространство ещё пусто, нажмите «Загрузить демоданные»: `initialize_workspace` создаст его из актуального seed. Без входа доступен локальный DEMO даже при заполненных настройках Supabase.

Запустите frontend командой из DEMO-раздела. Проверьте вход, собственный объект, сохранение материала, reload, создание дела и версию решения. Для настоящей интеграции используйте [live-инструкцию](DEVELOPMENT.md#настройка-live-проверки), а не только HTTP mock.

## Выпуск frontend

```sh
npm run check
npm test
npm run build
npm run preview
```

`dist/` — статическая сборка. `vercel.json` задаёт Vite, `npm ci` и `dist`; `.vercelignore` исключает локальные env, backend и evidence. Проверьте состав пакета и настройки платформы перед публикацией.

Для публичного DEMO обе `VITE_SUPABASE_*` должны быть пустыми **во время сборки**. Публикуйте проверенный commit; после deploy проверьте публичный URL без авторизации, навигацию, карту/список и создание локального дела. Frontend deploy не развёртывает FastAPI, SQL или Edge Function.

Для подключённого выпуска отдельно подготовьте Supabase, HTTPS backend, точные CORS/Edge origin и серверные секреты. Внешний provider и инфраструктура имеют собственные условия и стоимость.

Свежая локальная приёмка UX и настоящего подключённого AI-сценария описана в [архиве 19 октября](archive/2026-10-19/): отчёт и артефакты относятся к зафиксированной в них версии. Для короткой повторной AI-проверки доступен `SAQ_ALLOW_PAID_AI=1 npm run test:deepseek -- --browser-only`: временный пользователь, два внешних запуска (анализ публикации и подготовка дела), файл в private Storage, решение человека, серверный PDF, пересмотр и reload. Перед запуском поднимите локальный Supabase и Edge с `ALLOWED_ORIGIN=http://127.0.0.1:5175`; скрипт сам запускает отдельный FastAPI на 8007. Ключи остаются в серверном env, доказательства — в отчёте запуска.

## Backup, обновление и восстановление

Перед обновлением существующей среды сохраните PostgreSQL и байты Storage с manifest/контрольными суммами в закрытом хранилище. Проверьте восстановление на отдельной среде, затем применяйте проверенные новые миграции.

В приложении: меню аналитика → резервная копия → ZIP. Он содержит JSON, файлы и SHA256 manifest. `/api/export` содержит только JSON и не заменяет полный ZIP.

Прикладное восстановление выполняется в отдельное пустое workspace. Файлы получают нового владельца, импортированные факты требуют повторной проверки, активные решения становятся черновиками. Исходная атрибуция остаётся provenance. Проверьте байты, хеши, связи и возможность нового решения.

При откате остановите запись и используйте совместимую прежнюю версию приложения либо восстановленную отдельную среду. Произвольные down migrations и перезапись рабочего пространства пользовательским restore могут уничтожить историю. Переключайте пользователей после проверки восстановленных данных.
