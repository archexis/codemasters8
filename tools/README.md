# tools/ — назначение скриптов

Маленькие файлы здесь не мусор: это шимы и сканеры с одной задачей.
Правило: новый скрипт длиннее 100 строк уезжает в свой модуль с тестом,
одноразовые прогоны складываем в `docs/archive/`, а не в `tools/`.

| Скрипт | Строк | Назначение |
| --- | --- | --- |
| `run-api-tests.mjs` | 7 | Шим `npm run test:api`: ищет Python (SAQ_PYTHON, иначе backend/.venv, иначе PATH) и гоняет `pytest backend/tests`. |
| `import-city-buildings.py` | 5 | Шим парсера официальной этажности Өскемена; модуль `building_registry.py`, тесты `tools/tests/test_building_registry.py`. |
| `tile-city-buildings.mjs` | 53 | Подготовка локальных векторных тайлов из полной выгрузки. Источники и обновление: `docs/city-buildings.md`. |
| `source-manifest.mjs` | 13 | Библиотека: sha256-манифест исходников в скоупе (git ls-files, без секретов и артефактов). Используется приёмкой. |
| `verify-no-server-secrets.mjs` | 16 | Байтовый скан: LLM_API_KEY и SERVICE_ROLE_KEY не должны встречаться в трекнутых файлах, бандле dist и отчётах. Пишет PASS в `docs/acceptance/s4-repair/secrets.json`. |
| `migrate-safe.mjs` | 23 | Безопасное применение миграций (порядок, dry-run). |
| `verify-s5-pdfs.py` | 12 | Точечная проверка S5 PDF. |
| `score-maxxing-verify.mjs` | 37 | Проверка витрины score-maxxing. |
| `prepare-construction-images.py` | 42 | Подготовка галереи стройки. |
| `replace-demo-sites.mjs` | 67 | Замена демо-площадок. |
| `local-smoke.mjs` | 88 | Локальный smoke: API + Storage + RLS на локальной Supabase. |
| `verify_ashyq.py` | 90 | Проверка Ашык/egov-источников. |
| `deepseek-smoke.mjs` | 110 | Сквозной smoke внешнего LLM через изолированный API. |
| `check-sprint-gate.mjs` | 257 | Гейт спринтов: закрытие предыдущего, статусы, пути. Есть unit-тест `sprint-gate.test.ts`. |
| `generate-seed.mjs` | 282 | Генератор сида (seed.json → SQL-миграция). Самый большой; при росте — резать на модули. |

Смесь `.mjs`/`.py` — осознанно: `.mjs` для Node-оркестрации (spawn, fetch),
`.py` для проверки Python-мира (PDF, pypdf). Кросс-вызовы идут через
`npm run test:api` / `SAQ_PYTHON`, а не через прямые импорты.
