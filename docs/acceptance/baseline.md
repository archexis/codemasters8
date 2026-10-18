# S0.1 — исходная точка (baseline)

Дата: 2026-10-18. Коммит: `406bf69` (`406bf6967d6a5162570ad4556cb25f120494bc50`).
Полный перечень хешей: `docs/acceptance/baseline-files.json` (79 файлов).

## Git status (исходный dirty status)

- `M package.json` — добавлен скрипт `gate` (`node tools/check-sprint-gate.mjs`).
- `?? .temp/` — локальный backup + артефакты (игнорируется, без секретов в отчёте).
- `?? .vitest/` — сгенерированный кэш тестов (игнорируется).
- `?? docs/acceptance/` — собственные файлы приёмки S0 (вне хешируемого scope по EXECUTION).
- `?? tests/unit/sprint-gate.test.ts`, `?? tools/check-sprint-gate.mjs` — работа S0.4, похеширована и забэкаплена.
- Никаких `git clean / reset / stash` не выполнялось.

## Хеши и версии

- Tracked исходников в scope: 77 + 2 untracked + 1 modified (package.json: HEAD-хеш в manifest, worktree-хеш в baseline-files.json).
- Runtime: node v22.23.1, npm 12.0.2, Python 3.14.8.
- Существующий `.temp/s0-baseline-backup/manifest.json` (60 файлов, scope: committed HEAD) проверен:
  все копии на месте и хеши совпадают, кроме ожидаемого расхождения `package.json`
  (manifest хранит HEAD-версию, worktree модифицирована скриптом gate).
- Дописано недостающее: `supplement` (+20 записей: 17 tracked configs/docs, worktree-запись
  package.json, 2 untracked файла S0.4). Проверка всех копий: ALL OK.
- Исключено из backup/scope как generated/dependencies: `graphify-out/`, `.agents/skills`
  (vendored), `**/__pycache__`, `.temp/`, `.vitest/`, `docs/acceptance/`.

## Маршруты (7, hash-router src/App.svelte)

| Маршрут | Экран |
|---|---|
| `#/home` | Главная |
| `#/overview` | Объекты строительства |
| `#/ads` | Публикации |
| `#/analyze` (+ `?text=`, `analyze/<zkId>`) | Проверка (новая публикация) |
| `#/registries` | Реестры и источники |
| `#/detail/<zkId>` | Карточка объекта |
| `#/signal/<zkId>` (+ `missing`) | Сигнал / «Страница не найдена» |

Навигация: home, overview, ads, analyze, registries; detail/signal — по ссылкам из списков.

## Seed counts (src/lib/seed.json)

- COMPLEXES: **16** (8 demo SQ-001–SQ-008 + 8 публичных снимков SQ-R01–SQ-R08).
- ADS: **13** (SQ-001/002/003/005/006/007 по 2, SQ-008 — 1).
- REGISTRIES: **11**.
- Сценарии: A = SQ-001 (R2+R3 = **35**, yellow), B = SQ-002 (R1+R2+R3 = **70**, red),
  C = SQ-003 (R3 = **10**, green). Ожидания из контракта, см. также
  `tests/fixtures/contracts/scoring.json`.

## Исходный PDF ТЗ

Файл `Кейс Codemasters 8.0. SAQ (1).pdf` (§5–7) в доступном окружении не найден
(путь `C:/Users/BIGra/...` — Windows-машина автора; в Linux-окружении отсутствует).
Используются зафиксированные контракты CONTRACTS.md/BASELINE.md/S1.md; сверка с оригиналом
отмечена как открытая проверка, правила по контрактам не переопределялись.

## Восстановление

Адресная копия исходников: `.temp/s0-baseline-backup/` + `manifest.json`
(поля `files[]` + `supplement.entries[]`: path/sha256/git_sha1/origin).
