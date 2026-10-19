# Карта требований → код → проверка → спринт

Источник строк: `docs/REQUIREMENTS_MATRIX.md` (исходные §2–§11 ТЗ), дефекты A01–A19
(`docs/CODEBASE_AUDIT.md` §14), пробелы B01–B18 (`docs/sprints/BASELINE.md`).
Полный перечень обязательных package/DoD IDs: `docs/acceptance/criteria.json`.
Проверка строки = профиль EXECUTION (T/U/B/E/C/A/F/L/AI) + конкретный тест/артефакт.
Gate (`npm run gate -- N`) сверяет закрытие по `docs/acceptance/sprint-N.json`.

## 1. Сквозной сценарий и обязательные модули (§2–§3)

| ID | Требование | Code location | Проверка | Спринт |
|---|---|---|---|---|
| UC01 | Городской обзор, risk filter, открыть ЖК | `src/components/RiskMap.svelte`, `src/App.svelte` (обзор) | E: direct route + поиск «Сарыарқа» → 1 запись; L | S0.3 base, S6.2 |
| UC02 | Застройщик, стадия, документальный статус, источники | `src/components/Detail.svelte`, `src/components/ComplexForm.svelte` | E: карточка показывает reviewer/основание/источники; L | S1.1, S5.2 |
| UC03 | Публикация связана с ЖК, предложение денег и фрагмент | `src/components/Analyze.svelte`, `src/lib/parser.ts`, `src/lib/domain.ts` (ad-команда) | U: `tests/unit/extraction.test.ts`; E: новый депозит → гипотеза → ad | S1.2, S3.1 |
| UC04 | Балл, зона, подтверждающие материалы | `src/lib/scoring.ts`, `src/components/Detail.svelte` | U: `tests/fixtures/contracts/scoring.json` TS/Python; E: пересчёт после confirm | S1.5 |
| UC05 | Сигнал, human confirm/return, выгрузка | `src/lib/signal-snapshot.ts`, `src/components/Signal.svelte`, `src/components/Detail.svelte` | U: history/append-only; E: оба перехода + reload; S5.3 PDF | S2.4, S5.1–S5.3 |
| M01 | Список с баллом/цветом, фильтр, метки при координатах | `src/components/RiskMap.svelte`, `src/lib/seed.json` (16 ЖК) | E: 16 ЖК / 14 точек; L | S0.3, S6.2 |
| M02 | Карточка ЖК: поля, ads/events (demo read-flow) | `src/components/Detail.svelte`, `src/lib/seed.json` | E: 8 demo-карточек, БИН/стадия/основание/связи | S0.3, S1.4 |
| M03 | Публикации: лента/площадка/дата/text, ручной ввод, подсветка | `src/components/Analyze.svelte`, `src/lib/parser.ts` | U: extraction/dedupe; E: сохранение нового текста | S3.1–S3.4 |
| M04 | Пересчёт/объяснение/переход к evidence/зона | `src/lib/scoring.ts`, `src/lib/domain.ts`, `src/components/Detail.svelte` | U: `decision-cases.json` I01–I18; E: ad link → конкретное evidence | S1.2 |
| M05 | Отчёт по ЖК: факторы, material links/status, confirm/return, print | `src/components/Signal.svelte`, `src/app.css` (print) | E: `signal-export.spec.ts`; 3 PDF, все страницы просмотрены | S5.3 |

## 2. Данные и доказательства (§4)

| ID | Требование | Code location | Проверка | Спринт |
|---|---|---|---|---|
| D01 | ≥8 полноценных demo-карточек | `src/lib/seed.json`, `tools/generate-seed.mjs` | U: `seed-integrity.test.ts` | S1.4 |
| D02 | ≥12 публикаций | `src/lib/seed.json` (13 ads) | U: seed-integrity; suite counts | S0.3, S1.4 |
| D03 | A/B/C 35/70/10 | `src/lib/seed.json`, `src/lib/scoring.ts` | U: scoring corpus; `test:api` golden | S1.4–S1.5 |
| D04 | Demo маркировка, факты и гипотезы различимы | `src/components/*.svelte` (origin/status chips), `src/lib/types.ts` | E: чипы origin; ручная проверка формулировок | S1.1, S5.3 |
| D05 | Сохранённые сведения: источник и время фиксации | `src/lib/types.ts` (Evidence), `src/lib/domain.ts` | U: decision-contract; F: `captureAt` не усечён | S1.1–S1.2 |
| D06 | Сущность «Объект» | `src/lib/types.ts`, `supabase/migrations/*_workspace.sql` | U: state-migration; SQL loader | S2.1 |
| D07 | Сущность «Публикация» | `src/lib/types.ts`, `supabase/migrations/*` (ads + AI run link) | U: source-contract; SQL corpus | S3.2, S4.2 |
| D08 | Сущность «Сигнал» (ID, snapshot, версии) | `src/lib/signal-snapshot.ts`, SQL signal_versions | U: history tests; E: reload версий | S2.4, S5.1 |
| D09 | Локальный seed и ручное добавление без госAPI | `src/lib/seed.json`, `src/lib/repository.ts` | L: загрузка seed, новый ad через UI | S0.3, S1.4 |
| D10 | Public data/CSV (доп. уровень, частично) | `src/lib/parser.ts` (parseCsvAds), `src/components/Analyze.svelte` | U+E: `csv-import.spec.ts` | S3.3–S3.4 |
| D11 | Не имитировать официальные интеграции | `src/components/Detail.svelte` (реестры — внешние ссылки) | Ручная проверка формулировок; E | S1.1, S6.2 |
| D12 | Локальная копия текста публикации | `src/lib/domain.ts` (ad.text immutable), SQL ads | U: quote — точная подстрока оригинала | S1.2, S3.1 |

## 3. Риск и обязательный AI (§5–§6)

| ID | Требование | Code location | Проверка | Спринт |
|---|---|---|---|---|
| R01 | +35 только за установленное отсутствие основания; unknown≠R1 | `src/lib/domain.ts` + SQL validate (validateFactor) | U: corpus I01–I03 TS и SQL; E: C 10→45 блок | S1.2 |
| R02 | +25 за прямое предложение денег с материалом | `src/lib/domain.ts`, SQL; `src/components/Analyze.svelte` (выбор ad+quote) | U: corpus I04–I06 TS и SQL | S1.2 |
| R03 | +10 за рекламу до ввода (датированный материал) | `src/lib/domain.ts` (beforeCommissioning), SQL | U: corpus I07–I08 TS и SQL | S1.2 |
| R04 | +15 за коллективное обращение о средствах | `src/lib/domain.ts` (collectiveAppeal + текст/файл), SQL | U: corpus I09–I10 TS и SQL | S1.2 |
| R05 | +10 при gap≥20, оба значения с source/date | `src/lib/domain.ts` (claimed/confirmed observations), SQL | U: corpus I11–I14; invalidate cases | S1.2–S1.3 |
| R06 | +5 за документированный простой/просрочку | `src/lib/domain.ts` (scheduleDeviation), SQL | U: corpus I15–I16 TS и SQL | S1.2 |
| R07 | min(100, sum confirmed), без дублей кода | `src/lib/scoring.ts`, `backend/app/*` (summary) | U+A: golden corpus (repeated R2=25) | S1.5 |
| R08 | Unknown=0, hypothesis≠fact; нет confirm без доказательств | `src/lib/scoring.ts` + `src/lib/domain.ts` (comment обязателен) | U: scoring + decision corpus | S1.2, S1.5 |
| R09 | Зоны 24/25, 59/60, red только при R1+R2 | `src/lib/scoring.ts` | U: boundary tests (24/25, 59/60) | S1.5 |
| R10 | Score — детерминированный риск-признак, не вердикт | `src/lib/scoring.ts` (pure), дисклеймеры в UI | Ручная проверка формулировок | S1.5, S5.3 |
| AI01 | Содержательный AI на новых данных (real LLM) | `supabase/functions/analyze/index.ts`, `src/lib/analysis.ts` | AI: 12 eval-кейсов + новый browser input, отчёт без токенов | S4.4–S4.5 |
| AI02 | Гипотеза с точным фрагментом (±confidence) | Edge prompt/validator; `tests/fixtures/contracts/ai-eval.json` | U: exact quote обязателен; AI eval | S4.1, S4.4 |
| AI03 | Аналитик принимает/отклоняет, отказ сохраняется | `src/lib/domain.ts` (review-команды), SQL apply_command | U+E: `ai-review.spec.ts`; reload отказа | S4.2 |
| AI04 | Недостоверность маркируется | Edge error_code/status; UI badges | U: transport fixtures failed run | S4.1, S4.4 |
| AI05 | Без безусловного юридического вердикта из LLM | Edge prompt (только R2/R3 extraction) | U: AI11 — нет R1/confirmed из модели | S4.1, S4.4 |

## 4. Технические требования, сдача и питч (§7–§9)

| ID | Требование | Code location | Проверка | Спринт |
|---|---|---|---|---|
| T01 | Запуск по README, сценарий из seed | `README.md`, `package.json`, `tools/local-smoke.mjs` | T/U/B/E/C/A/F + L PASS | S0.3 |
| T02 | Понятные data/analysis/UI, свободный стек | `src/lib/*`, `backend/app/*`, `supabase/functions/analyze/*` | T: `npm run check`; ревью структуры | S0.3, S6.2 |
| T03 | Быстрый поиск, статусы, причины, понятные действия | `src/components/*`, `src/app.css` | E: поиск/фильтры/ошибки у полей; keyboard | S6.2 |
| T04 | Human confirm/return со status/author/date/time | `src/lib/domain.ts`, SQL audit, Signal UI | E: обе операции + reload; U: audit snapshot | S2.4, S5.1 |
| T05 | Source/evidence для существенного фактора | `src/lib/domain.ts` + SQL (prerequisites до confirmed) | U: corpus отказов; A01 regression | S1.2 |
| T06 | Нет PII в seed, ключей в Git, обвинений реальным компаниям | весь scope; `docs/acceptance/security.md` | Secret scan; F: dist/storage/network | S6.1 |
| G01 | Фактический source показанного продукта | релизный commit, `docs/RELEASE_MANIFEST.json` | S6.4 gate: SHA доступен адресату | S6.4 |
| G02 | README: problem/value/features/stack/start/demo/limitations | `README.md` | Ручная сверка с runtime; clean-room | S6.3 |
| G03 | Безопасный env example, seed/load/start commands | `.env.example`, `tools/generate-seed.mjs` | Clean-room install по lockfiles | S6.3 |
| G04 | Автотесты важной логики, описание AI | `tests/unit/*`, `backend/tests/*`, Edge tests | T/U/B/E/C/A/F PASS | S0.2–S0.3 |
| G05 | Публичный доступ заранее и во время оценки | внешний repo (шаг вне плана) | Анонимная проверка наличия сдаваемого SHA | S6.4 |
| G06 | Зафиксированный commit/отсечка | релизный commit (не `git add .` вслепую) | Gate: SHA создан, иначе BLOCKED | S6.4 |
| G07 | Честные сторонние libraries/models/templates/AI | `README.md`, `docs/DEMO_SCRIPT.md`, package lockfiles | Аудит зависимостей (`npm audit`) | S6.1, S6.4 |
| P01 | Problem/user | `README.md`, `docs/DEMO_SCRIPT.md` | Проверка сценария демо | S6.4 |
| P02 | Value без выдуманных измерений | `docs/DEMO_SCRIPT.md` | Тот же кейс, что live E2E | S6.4 |
| P03 | Live: публикация→factor→score→signal | `tests/live/investigation.spec.ts` | L + нужный live AI кейс | S5.4 |
| P04 | Engineering-ошибки, улучшения, backup запись | код/тесты + резервные PDF/скриншоты | Наличие резервного комплекта | S5.3, S6.4 |

Дополнительно §11 (OCR, скрейпинг, Drone, Risk Web, Time Machine, полные RU/KZ режимы):
out-of-scope MVP, не реализовывать ради gate (см. EXECUTION «При неудаче»).

## 5. Дефекты старого аудита A01–A19

| ID | Дефект | Code location | Проверка | Спринт |
|---|---|---|---|---|
| A01 | Confirm фактора без evidence / при verified guarantee | `src/lib/domain.ts`, SQL validateFactor | U: I01–I03 TS+SQL; E: ручной R1 блокирован | S1.2 |
| A02 | Reject гипотезы — только DOM, не сохраняется | `src/lib/domain.ts` (reject-команда), SQL | E: `ai-review.spec.ts` + reload | S4.2 |
| A03 | История факторов перезаписывается, сигнал изменяем | `src/lib/domain.ts` (audit before/after), `src/lib/signal-snapshot.ts` | U: confirm→reject→confirm = 3 события | S2.4 |
| A04 | Бинарные доказательства не переживают reload | `src/lib/repository.ts` (upload/remove), Storage policies | E: `evidence-failures.spec.ts` fault cases | S2.3 |
| A05 | Настоящий AI не продемонстрирован | `supabase/functions/analyze/index.ts` | AI: eval 12 + browser run, журнал provenance | S4.4–S4.5 |
| A06 | Нет Auth/общей БД/RLS | Supabase Auth, SQL RLS, `src/lib/supabase.ts` | C: SDK-тесты; L: two-user изоляция | S2.6 |
| A07 | BYOK secret в browser storage | Edge server writer, удаление browser key flow | F: секретов нет в bundle/storage/Git | S4.1, S6.1 |
| A08 | Parser/heuristic расходятся, общий NEG давит платёж | `src/lib/parser.ts` + Edge validator (общий контракт) | U: extraction corpus RU/KZ regression | S3.1 |
| A09 | Цитата с «…», нет строгой AI schema | `src/lib/parser.ts` (raw span vs display), Edge schema | U: span `text.slice(start,end)`; AI02 | S3.1, S4.1 |
| A10 | R5 устаревает/понижается молча, readiness без файла | `src/lib/domain.ts` (R5 lifecycle), SQL | U: invalidate cases S1.3 | S1.3 |
| A11 | Async результат после route change, mutable metadata | `src/components/Analyze.svelte` (AbortController, immutable snapshot) | E: stale/abort/session cases | S4.3 |
| A12 | Нет schema/concurrency localStorage, duplicate score | `src/lib/state-migrations.ts`, `src/lib/scoring.ts` (уникальность кода) | U: state-migration; scoring dup test | S2.1, S1.5 |
| A13 | CSV multiline ломается, zkHint игнорируется | `src/lib/parser.ts` (parseCsvAds), Analyze selectRow | U+E: `csv-import.spec.ts` | S3.3 |
| A14 | Map re-create/lifecycle, blob index mismatch | `src/components/RiskMap.svelte`, `src/components/MediaCard.svelte` | E: reload/навигация; media by stable ID | S2.3, S6.2 |
| A15 | PDF без URL/ad dates/immutable content | `src/components/Signal.svelte`, print CSS | E: `signal-export.spec.ts`, 3 PDF | S5.3 |
| A16 | Source verifier 404 и TLS off | проверяемый provenance snapshot, удаление insecure TLS | L: snapshot check; ревью backend | S2.6, S6.1 |
| A17 | Нет legal review/document form | `src/components/ComplexForm.svelte`, Evidence types | U: S1.1 pairs type/status; E: форма | S1.1 |
| A18 | Deep-link title, mobile aria, modal keyboard | `src/App.svelte` (router init), компоненты | E: 7 маршрутов, mobile, keyboard-only | S6.2 |
| A19 | README расходится с runtime, pyc в Git | `README.md`, `.gitignore` | Clean-room по README | S6.3 |

## 6. Пробелы текущего кода B01–B18

| ID | Пробел | Code location | Проверка | Спринт |
|---|---|---|---|---|
| B01 | Ручной R2 не проверяет публикацию и её ЖК | `src/lib/domain.ts`, SQL validate_factor | U: I04–I06 TS+SQL | S1.2 |
| B02 | type/status legalBasis несогласованы, нет полной даты | `src/components/ComplexForm.svelte`, complex-команда | U: guarantee+absent-verified reject | S1.1 |
| B03 | Замена источника отсутствия не отзывает R1 | `src/lib/domain.ts` (complex/readiness invalidate) | U: invalidate cases | S1.3 |
| B04 | R3/R4/R6 со строкой source; R5 без двух источников | `src/lib/domain.ts` (validateFactor), SQL | U: I07–I16 TS+SQL | S1.2–S1.3 |
| B05 | Нет полной runtime-схемы команд; TS/SQL расходятся | `src/lib/validation.ts` (нов.), SQL validator | U: `validation.test.ts`; URL/ID cases | S1.1, S3.2 |
| B06 | Нет commandId/receipt для повтора | `src/lib/domain.ts` (envelope), SQL `command_receipts` | U: `idempotency.test.ts`; E: retry | S2.2 |
| B07 | Нет schemaVersion/миграции вложенных данных | `src/lib/state-migrations.ts`, SQL migration | U: `state-migration.test.ts` | S2.1 |
| B08 | Ad/решение сохраняются до загрузки файла | `src/components/Analyze.svelte`, SQL atomic ad bundle | E: fault cases upload/commit/cleanup | S2.3 |
| B09 | Signal перезаписывается; нет снимка решения | `src/lib/signal-snapshot.ts`, SQL signal_versions | U: snapshot deepEqual после фактов | S2.4, S5.1 |
| B10 | Header/score берутся из live, а не из версии | `src/components/Signal.svelte`, `src/components/Detail.svelte` | E: v1 byte-equivalent после новых фактов | S5.1–S5.2 |
| B11 | Дедup глобальный; SQL слабее TS (телефоны) | `src/lib/parser.ts` (dedupeKey), SQL canonical | U: `source-contract.test.ts` TS+SQL | S3.2 |
| B12 | zkHint наследует ЖК; дата наследует предыдущую | `src/components/Analyze.svelte` (selectRow) | E: CSV unknown → null, save disabled | S3.3 |
| B13 | Snapshot только text/zk; нет abort | `src/components/Analyze.svelte`, `src/lib/analysis.ts` | E: stale/abort/session cases | S4.3 |
| B14 | Один decision на ad блокирует остальные гипотезы | `src/lib/domain.ts`, SQL apply_command, Ad types | E: R2 confirm + R3 unresolved + reload | S4.2 |
| B15 | Нет runId/inputHash/promptVersion; quota→429 | `supabase/functions/analyze/index.ts`, SQL analysis_runs | U: `analysis-run.test.ts` (429 vs 503) | S4.1 |
| B16 | database.test: hardcoded миграции, зависимость тестов | `tests/unit/database.test.ts`, `tests/helpers/database.ts` | U: каждый SQL-тест отдельно и вместе; 178 assertions | S0.2 |
| B17 | Seed не валидирован; R3 SQ-001 vs AD-001 | `src/lib/seed.json`, `tools/generate-seed.mjs` | U: seed-integrity; quote — подстрока ad | S1.4 |
| B18 | Формула Python отдельно от TS | `backend/app/*`, `tests/fixtures/contracts/scoring.json` | A+U: общий golden corpus совпадает | S1.5 |


## Итог S6

Полная построчная сверка: [requirements-results.json](s6/requirements-results.json). G01/G05 BLOCKED до публикации candidate SHA; остальные обязательные строки PASS по S6 profiles + сохранённой предметной приёмке S0–S5. §11 — out-of-scope. Локальная готовность не означает отправку заявки.
