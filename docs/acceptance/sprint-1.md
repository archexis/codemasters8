# S1 — приёмка: PASS (2026-10-18)

Источник: HEAD + SHA256-манифест (см. sprint-1.json → source.manifest).
Окружение: node v22.23.1, DEMO + локальный Supabase docker; миграции 001/002 +
C1/S1.2/S1.3/S1.4.

Пакеты S1.1–S1.5 — все PASS. Критерии D1.1–D1.5 — все PASS с файловыми
свидетельствами. Регрессия S0 перепроверена и актуальна.

Проверки: U 93/93 (8 файлов), check 0, backend pytest 9/9 (golden corpus
scoring.json — общий с TS), E2E 20/20 (workflows 12 + legal-invariants 8,
chromium+mobile), build ok.

Ремонт S1.4 (2026-10-18, стык S1→S2 п.1): после появления миграции S2.1
JSON seed != initialize_workspace() (v3-конверт только в SQL). Исправлено
на обеих сторонах без выдуманных доказательств: `buildSeedEnvelope`
возвращает канон v3 (schemaVersion=3, signalVersions={}), `initialState` и
серверный fallback `repository.loadState` — тот же конверт; сохранённые
DEMO-состояния мигрируют через loadStateFromText v2→v3 (нуждающиеся confirmed
→ needs-verification с factor.before + audit, marker s2.1-schema-v3).
Старые пользовательские confirmed без материалов по-прежнему снимаются только
миграционным событием (SQL migrate_s1_4_seed / TS groundingReason), цитаты —
verbatim из seed. Свежий ре-прогон: seed-integrity 6/6, database 7/7,
T 0 errors, U 130/130, B ok, A 9/9.

Ключевой фикс спринта (родитель): конфликт strict-валидатора S1.1 с
Analyze-флоу — гипотеза урезается до {code,quote}, reason модели идёт в
modelReason (read-only, в аудит), комментарий аналитика обязателен и вводится
отдельно. E2E-адаптация спеков — только заполнение новых обязательных полей,
assertions не ослаблены.

Блокеры: нет. Gate: `npm run gate -- 1` → exit 0.
Следующий разрешённый пакет: S2.1.
