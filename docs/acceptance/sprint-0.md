# S0 — приёмка: PASS (2026-10-18)

Источник: HEAD 406bf6967d6a5162570ad4556cb25f120494bc50 + SHA256-манифест
(86 файлов, см. `sprint-0.json` → source.manifest).
Окружение: node v22.23.1, npm 12.0.2, Python 3.14.8; DEMO (пустые Supabase env)
и локальный стек Supabase в docker (проект saq-qurylys); миграции 001/002.

Пакеты: S0.1/S0.2/S0.3/S0.4/S0.5 — все PASS, артефакты существуют на диске.
Критерии: D0.1–D0.5 — все PASS с файловыми свидетельствами.

Проверки (фактические прогоны, не тексты):
T `npm run check` — 0 errors; U `npm test` — 42/42; B `npm run build` — ok;
E `npm run test:e2e` — 12/12 (chromium+mobile, origin 5176, повторено родителем);
C `npm run test:cloud` — PASS; A backend pytest — 7/7; F edge+deno — PASS;
L `node tools/local-smoke.mjs` — все строки PASS на локальном стеке.
Сид: 16/13/11; сценарии A=35 yellow / B=70 red / C=10 green — сверено родителем
по seed.json (R2+R3 / R1+R2+R3 / R3).

Ремонт S0.2/S1.4 (2026-10-18, стык S1→S2): миграция S2.1
(`20261018121836_s2_1_schema_version.sql`) ввела v3-конверт
(schemaVersion=3 + signalVersions={}) поверх app_seed/initialize_workspace —
пин database.test.ts расширен до 7 файлов (s2_1 валидна, включена),
`buildSeedEnvelope` и `initialState`/`repository` переведены на тот же v3-конверт
(DEMO-состояние совпадает с SQL, не только SQL). Свежий ре-прогон: T 0 errors,
U 130/130 (11 файлов), B ok, A 9/9 (backend/.venv). E/C/F/L — исторические,
ремонтом не затронуты.

Наблюдения (не блокеры): исходный PDF ТЗ недоступен в этом окружении —
действовали по CONTRACTS/BASELINE/S1; 178 legacy assertions из плана не
сходится (в legacy .cjs 127 ok(), остальное — адаптер+expects), зафиксировано
в progress.md. Ad-hoc скрипт маршрутов агента S0.3 удалён им же; маршруты
покрыты durable E-сьютом (navigation/direct links/unknown route/narrow).

Блокеры: нет. Gate: `npm run gate -- 0` → exit 0.
Следующий разрешённый пакет: S1.1.
