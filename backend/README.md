# Сервер SAQ QURYLYS

Установка: `python -m pip install -r backend/requirements.lock.txt`. Запуск из корня: `python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`.

Нужны `SUPABASE_URL`, `SUPABASE_ANON_KEY`; пользовательский Bearer JWT проверяется через Auth, запросы в PostgREST и Storage выполняются с тем же токеном и RLS. Service role ключ серверу не нужен. До использования новых команд и jobs примените новую миграцию обычным процессом выпуска; в этой работе удалённая база не изменялась.

Сохранены `/health`, `/api/summary`, `/api/export`. Небольшие представления: `/api/map-summary`, `/api/publications`, `/api/registry`, `/api/complexes/{id}/preview`, `/dossier`, `/verification`, `/relations`, `/timeline`, `/api/cases/{id}`. У представлений досье `phase_id` ограничивает область. Списки используют `limit` и `cursor`; граф ограничен одним переходом. Backend пока читает JSONB workspace целиком внутри сервера; перенос физического хранения в отдельные индексированные сущности не выполнен.

PDF сохранённого решения: `GET /api/cases/{caseId}/snapshots/{snapshotId}/pdf`. Renderer использует только сохранённый snapshot. Для кириллицы нужен `PDF_FONT_PATH` или системный DejaVu Sans/Arial; Docker устанавливает DejaVu Sans.

`POST /api/import/pdf` принимает raw `application/pdf` до 20 МБ/100 страниц и возвращает непроверенный candidate с постраничным текстом и SHA256. Изображения: `POST /api/import/image`, JPG/PNG/WebP до 20 МБ/25 мегапикселей. OCR использует локальный Tesseract с `rus+eng`; отсутствие возвращает 503. Docker устанавливает Tesseract, однако его OCR качество на реальных документах отдельно не проверено. Текст OCR всегда требует сверки с оригиналом.

Фоновый вариант PDF: `POST /api/document-jobs?complex_id=...&kind=pdf-text|ocr`, тот же raw PDF. Оригинал сохраняется в приватном Storage, metadata — в `document_jobs`, ответ 202 с `pollUrl`. Worker обрабатывает максимум два документа одновременно. PDF OCR читает встроенные растровые изображения, максимум 20 страниц/5 изображений на страницу и ограничивает время; это не универсальный PDF renderer. Статусы: queued/running/succeeded/failed. После перезапуска незавершённую задачу можно возобновить авторизованным `POST /api/document-jobs/{id}/retry`: токены не сохраняются в очереди. Автоматического перезапуска без пользовательского токена нет. Queue output не подтверждает факты и не влияет на риск.

Проверки: `python -m pytest backend/tests -q`; SQL boundary: `npx vitest run tests/unit/investigation-sql.test.ts`. Тесты используют локальный HTTP mock/PGlite; это не проверка развёрнутого Supabase, Docker или установленного OCR.

Переход старого workspace выполняется без потери истории. После первого нового дела по ЖК сервер отклоняет подтверждения старых команд `factor`, `ad+hypothesis`, `signal`: решения выполняются через `fact.review`/`case.decide`. Старые квитанции продолжают безопасно повторяться. ЖК без новых дел сохраняют legacy путь для совместимости. Изменение исходных правовых/строительных данных отзывает зависимые текущие утверждения в `candidate`, возвращает дело в draft; исторические snapshots сохраняются. При restore активные verified становятся candidate, дела draft, геометрия verified=false, исторические snapshots получают imported=true.

Очереди используют собственные readiness observations: история `readinessSources` добавляется только в конец; сведения всего ЖК не подтверждают R5 отдельной очереди. `period` задаёт включительный интервал `{from,to?}`; известный период дела должен покрываться утверждением, для R1 — применимым основанием, для R3 — датами публикации/доказательства. Snapshot сохраняет период и собственные наблюдения очереди.

Типизированные контекстные связи хранятся в `relations`: `relation.register` создаёт candidate, отдельный `relation.review` сохраняет human review. Проверяются канонические узлы, область первичных материалов, отсутствие self-edge. Подтверждение требует непустого списка материалов и комментария; связи не добавляют риск-баллы. Backend graph возвращает сохранённые рёбра, статусы и ссылки на первоисточники; для legacy без связей остаётся отдельно помеченная identity-проекция реестра.
