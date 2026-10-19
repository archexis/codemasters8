# SAQ QURYLYS API

FastAPI предоставляет авторизованные представления workspace, PDF сохранённых решений и обработку документов. Полная настройка окружения — [запуск и эксплуатация](../docs/RELEASE_RUNBOOK.md); устройство данных — [архитектура](../docs/ARCHITECTURE.md).

## Запуск

Установите зависимости в виртуальное окружение из `backend/requirements.lock.txt`. Из корня репозитория с активным окружением:

```sh
python -m pip install -r backend/requirements.lock.txt
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Нужны `SUPABASE_URL`, `SUPABASE_ANON_KEY` и `CORS_ORIGINS` из `.env` или переменных процесса. API проверяет Bearer JWT через Supabase Auth и передаёт пользовательский токен в PostgREST/Storage. Service role ему не нужен. Примените миграции своей тестовой среды перед использованием API.

`GET /health` доступен без входа. `supabase_configured` проверяет наличие настроек. OpenAPI: [127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). Операции `/api/*` требуют авторизации.

## Основные операции

| Группа | Маршруты |
| --- | --- |
| Сводка и JSON | `GET /api/summary`, `/api/export` |
| Карта и списки | `GET /api/map-summary`, `/api/publications`, `/api/registry` |
| Досье | `GET /api/complexes/{id}/preview`, `/dossier`, `/verification`, `/relations`, `/timeline` |
| Дело | `GET /api/cases/{id}` |
| PDF версии | `GET /api/cases/{caseId}/snapshots/{snapshotId}/pdf` |
| Извлечение текста | `POST /api/import/pdf`, `/api/import/image` |
| Фоновые задания | `POST /api/document-jobs`, `GET /api/document-jobs/{id}`, `POST /api/document-jobs/{id}/retry` |

`phase_id` ограничивает область досье; списки используют `limit` и `cursor`. Сервер читает owner-scoped JSONB workspace целиком. `/api/export` возвращает JSON и не включает байты вложений.

PDF renderer читает сохранённый snapshot. Для кириллицы нужен `PDF_FONT_PATH` или системный DejaVu Sans/Arial. Dockerfile устанавливает DejaVu.

## PDF и OCR

Импорт принимает raw body: PDF до 20 MiB и 100 страниц; JPEG/PNG/WebP до 20 MiB и 25 мегапикселей. Результат — непроверенный candidate с SHA256 и извлечённым текстом. Извлечение не подтверждает факты и не увеличивает score.

OCR требует Tesseract с `rus+eng`; без него API возвращает 503. Dockerfile включает Tesseract. PDF OCR читает встроенные растровые изображения: максимум 20 страниц, до пяти изображений на страницу, с ограничением времени. Это не универсальный PDF renderer; качество на реальных документах проверяется отдельно.

Фоновый импорт `POST /api/document-jobs?complex_id=...&kind=pdf-text|ocr` сохраняет оригинал в private Storage и отвечает 202 с `pollUrl`. Статусы: queued/running/succeeded/failed. Worker обрабатывает два документа одновременно внутри процесса FastAPI. После перезапуска незавершённое задание возобновляется авторизованным retry; JWT в очереди не сохраняется.

## Проверки

```sh
python -m pytest backend/tests -q
```

Из общего npm-окружения: `npm run test:api`. API-тесты используют HTTP mock; они не подтверждают доступность настоящего Supabase или установленного OCR. Настройка интеграционного прогона — [руководство разработчика](../docs/DEVELOPMENT.md).
