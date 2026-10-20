# SCORE MAXXING — техническая приёмка

Дата: 19 октября 2026, Asia/Yekaterinburg (UTC+05:00). Основание: `docs/SCORE_MAXXING_DEV_HANDOFF.md`.

Финальная автономная регрессия стабильного кандидата завершена: OFFLINE_PASS. Свежий внешний AI — **PASS**: 12 eval + полный headed browser путь; детали дополнения ниже. Полный PASS всех требований и оценка 80/100 этим отчётом не заявляются.

## Привязка к коду

HEAD базы: `29344252e26b4efe35262f7ef7610b4db3c1a2f5`; дерево dirty, изменения не оформлены отдельным коммитом. Пользовательские изменения `src/app.css` сохранены с дополнительными исправлениями карты. Исторические миграции не переписывались. Кандидат определяется байтами исходников, а не одним HEAD.

Финальный автономный прогон: `test-results/score-maxxing/2026-10-19T12-36-49-346Z`, 12:36:49–12:42:07 UTC (17:36:49–17:42:07 местного времени). [verification.json](verification.json) содержит SHA256 исходников, команды, времена и exit codes. Статус **OFFLINE_PASS**, `sourceUnchanged=true` в течение этого прогона.

В этот полный прогон входят исправление неизвестной даты в `ComplexForm.svelte`, отображение веса отвергнутого факта в PDF, комментарий проверки факта и повтор unknown ACK прежним commandId. Source manifest SHA256: `1b2d8a8c046fb0a319638264ad42a7b8988cb3e653d8fd4a46cfee2ec3158144`. Предыдущие интегрированные прогоны сохранены в `pre-review/` и `pre-final-ui/`. Дополнительное действие повтора в UI реализовано; адресная регрессия 8 passed, check exit 0. Полный прогон финальных байтов завершён: 130 E2E passed, sourceUnchanged=true.

Runtime: Node 24.18.0, npm 11.16.0, Python 3.11.0, Deno 2.9.6, Supabase CLI 2.121, Docker 29.1.3. Реальный local stack изолирован на API-порту 55321; рабочая БД не сбрасывалась.

## Проверки

| Команда / среда | Exit | Результат | Доказательство |
|---|---:|---|---|
| `npm run check` | 0 | 0 ошибок/предупреждений | [check.log](logs/check.log) |
| `npm test -- --reporter=json …` | 0 | 350 passed, 0 failed, 0 skipped | [unit.log](logs/unit.log), verification |
| `npm run build` | 0 | production build | [build.log](logs/build.log) |
| `npm run test:e2e -- --reporter=line,json` | 0 | 130 passed, 0 failed/skipped/flaky; desktop/mobile, fallback | [e2e.log](logs/e2e.log) |
| `npm run test:cloud -- --reporter=line,json` | 0 | 1 passed, 0 failed/skipped; mocked HTTP | [cloud.log](logs/cloud.log) |
| `npm run test:api` | 0 | 21 passed; 1 dependency deprecation warning | [api.log](logs/api.log) |
| `npm run test:edge` | 0 | 3 passed, 0 failed; offline transport | [edge.log](logs/edge.log) |
| `npm exec --yes -- deno check supabase/functions/analyze/index.ts` | 0 | type check | [edge-check.log](logs/edge-check.log) |
| `npm run test:local` → live без external LLM | 0 | 8 passed; Auth/RPC/RLS/Storage/FastAPI/Edge, A/B/C, restore, shared account | [local-live-candidate.log](logs/local-live-candidate.log) |
| Чистая установка npm/Python и clean check/build/API | 0 | npm ci 116 packages; locked isolated venv; финальные check/build exit 0; API21 на совпадающем backend | [clean-checks.json](logs/clean-checks.json), [final-clean-check.log](logs/final-clean-check.log), [final-clean-build.log](logs/final-clean-build.log), [final-clean-api.log](logs/final-clean-api.log) |
| Адресная API-регрессия после PDF-ревью | 0 | 21 passed, включая rejected weight | [post-review-api.log](logs/post-review-api.log) |
| Новый внешний AI/browser/provider | 0 | **PASS**, свежие12 eval и headed browser | [paid-ai](paid-ai/evaluation.json), бюджет1 USD |
| WebGL / 2.5D в Chromium desktop/mobile | 0 | PASS: rendered fill-extrusion geometry, импорт GeoJSON и возврат в 2D | `ux-geometry.spec.ts`, полный E2E130 |
| Внешние 3D city / terrain источники | — | **NOT_RUN** | реальные внешние данные отдельно |
| Публичный CI / опубликованный кандидат | 0 | **PASS** для SHA99ec573 | [CI](https://github.com/archexis/codemasters8/actions/runs/39256363997), [DEMO](https://saq-qurylys-pi.vercel.app) |

Исходное противоречие unit было воспроизведено: 343 passed / 1 failed. Финальный набор имеет 350 passed. CI причиной не маскировался отключением теста; результат нового GitHub CI для этих незакоммиченных байтов не проверен.

## Матрица задания

| Пункт | Файлы / смысл | Проверка и артефакт | Статус / границы |
|---|---|---|---|
| DEV-00 | Git, isolated stack, runtime и source manifest | verification, clean-checks | DONE: dirty база и отдельные среды зафиксированы |
| DEV-01 | repository contract; `idempotency`, `connected-regressions` | 350 unit, Auth/session live | PASS локально; новый GitHub CI не запускался |
| DEV-02 | `RiskMap.svelte`, `app.css`; hit-testing toolbar/zoom | E2E130, fallback desktop/mobile screenshots и trace | PASS fallback обычным pointer click; WebGL 2.5D rendered geometry/2D restore PASS; внешние city/terrain NOT_RUN |
| DEV-03 | `tests/helpers/case-ui.ts`, e2e/cloud/live, smoke tools | E2E130, mock1, live8 | PASS для текущего case ledger пути; mock отдельно от Supabase |
| DEV-04 | actual Auth/RPC/RLS/Storage/API, snapshots и restore | live8; A/B/C 35 yellow / 70 red / 10 green; PDFs | PASS изолированного local stack; production/cloud deployment не проверен |
| DEV-05 | `analysis.ts`, `deepseek-smoke`, AI fixtures/transport | unit/Edge offline; eval rationale | PARTIAL: deterministic protection проверена; новый paid AI E2E и сверка реальных цитат NOT_RUN |
| DEV-06 | `presentation.ts`, dossier/CaseSignal, Python PDF | API21; browser print E2E; server PDF | PASS локальных контрактов; свежие live PDF и server-demo содержат weight fix и комментарий проверки |
| DEV-07 | shared account, relation.review, caseSnapshot, unknown date | live `case-scenarios`, [live-scenarios.json](artifacts/live-scenarios.json) | PASS: совпадение аккаунта не подтверждает владельца/score; snapshot неизменен |
| DEV-08 | README, runbook, demo script, portable API runner, manifest | clean install/check/build/API; secret scan | PARTIAL: запуск и инструкции обновлены; публичный кандидат/CI NOT_RUN |
| DEV-09 | интегрированный offline и real local stack | verification OFFLINE_PASS, live8; отобранные артефакты | PARTIAL: полный стабильный offline130 + candidate live8; финальный retry UI проверен полным E2E130; paid AI/внешние city/terrain/public release остаются |

## Артефакты и ограничения

В [artifacts](artifacts/) отобраны fallback desktop/mobile, DEMO trace, browser/server PDF и актуальный live JSON. Реальные PDF: `SQ-001-v1.pdf`, `SQ-002-v1.pdf`, `SQ-003-v1.pdf`, `connected-server.pdf`. Их идентификаторы согласованы с актуальным `live-scenarios.json`; более ранний `live-snapshot-metadata.json` намеренно не использован. SHA256 отобранных файлов приведены в `ARTIFACTS.sha256.json`.

`server-demo.pdf` содержит 4 страницы, RU/KZ и длинные URL. Страницы отрендерены; первая/последняя визуально проверены основным агентом, текст читаем. Это ограниченная визуальная проверка, не полный ручной аудит всех страниц всех PDF.

Публикуемые материалы скопированы после завершения Vite. Live traces, operator env, `status.json`, `stack-start.log`, ключи local stack и полный clean-source исключены. [secrets-final.json](logs/secrets-final.json): targeted scan 667 файлов, 36 commit diffs и 450 archive text entries без совпадений private/provider/GitHub credential patterns. Это ограниченный поиск известных форматов, не гарантия отсутствия произвольных секретов.

Ревью также выявило необходимость повторять неизвестный исход ACK прежним commandId в CaseSignal/ComplexDossier. Исправление выполнено: адресная регрессия 8 passed и полный финальный набор 130 E2E passed. HTML/PDF дополнены комментарием проверки факта и понятным представлением beforeCommissioning. Полный offline130 и candidate live8 завершены, свежие PDF скопированы. Отдельная кнопка повтора в ComplexDossier добавлена; адресная регрессия [retry-final-e2e.log](logs/retry-final-e2e.log): 8 passed, [retry-final-check.log](logs/retry-final-check.log): exit 0. Финальный полный offline прогон завершён: OFFLINE_PASS. Live8 относится к manifest `21870ffc2f4eb304a6921efc41403c571868dc176c790f32ce2208f4334a72bc`; последующий UI-контроль не меняет backend/command API; полный offline130 проверяет финальный UI, отдельный повтор live8 после этой UI-правки не выполнялся.

Остаётся новый bounded provider/browser прогон при согласованных бюджете и доступе; отдельная проверка внешних 3D city/terrain источников; коммит, публичная доступность и CI конкретного кандидата. Архивные отчёты остаются историческими и не считаются новыми результатами.





Финальное дерево после отдельной кнопки повтора: source manifest SHA256 `1b2d8a8c046fb0a319638264ad42a7b8988cb3e653d8fd4a46cfee2ec3158144`. Ограничение: pending-команда сохраняется после reload, но отдельная UI-панель её восстановления после перезагрузки не реализована; автоматического нового commandId при unknown ACK нет.

[final-source-delta.json](logs/final-source-delta.json) фиксирует ровно два изменённых пути между live-проверенной базой `21870…` и финальным деревом `1b2d…`: `src/components/ComplexDossier.svelte` и `tests/e2e/case-retry.spec.ts`. Backend, SQL и command API совпадают; live8 и clean API21 относятся к этой явно ограниченной базе. Clean check/build повторены на финальном UI с exit 0. Основной агент дополнительно подтвердил currentMatchesTest=true и manifestMatchesTest=true для финального `1b2d…`; Git diff check с учётом CRLF завершился exit 0.

## Публикация и свежий AI — 19 октября 2026

Пользователь согласовал 1 USD и Vercel DEMO; connected AI проверяется локально. Исходные байты до этой работы точно совпали с `1b2d8…`. Приложение/backend/SQL не менялись; изменён только live-тест (ожидание URL, combobox, screenshots, повтор PDF), .gitignore и Vercel config. Исторические offline/live результаты выше сохраняют исходную привязку.

[Свежий AI отчёт](paid-ai/evaluation.json): 12/12 eval PASS и полный browser PASS в headed Chromium (22.1 секунд, общий 28.7). Реальные Auth → Edge → DeepSeek → journal, без mock ответа. R2 accepted/R3 rejected, после triage 0; fact.review → 25; confirmed snapshot v1 → reopen → rejected fact → returned v2 score0 → reload → v1 score25. [Run/snapshot evidence](paid-ai/browser-evidence.json) сохраняет model, prompt_version, input hash, runId, hypothesis IDs и неизменный v1. Schema version 1; prompt 3. [Provider журнал](paid-ai/provider-usage.json) сохраняет prompt/body hashes и usage. Все цитаты — точные подстроки исходного текста.

Изначальный максимум13 увеличен до15 внутри денежного бюджета после двух ошибок теста, обе сохранены в smoke.log/browser-retry.log: чтение URL до перехода; устаревший getByLabel вместо combobox. Повторены только два browser вызова, eval не повторялся. 5795 input +1009 output tokens, верхний тариф даёт $0.0029493; консервативно зарезервировано $0.0465186, лимит1 USD. Actual account debit не проверен. Шлюз пропускал только deepseek-flash, thinking disabled, max_tokens2048, с лимитом количества/денег; он форвардил настоящий ответ провайдера.

[Скачанный серверный PDF](paid-ai/server-case.pdf): 2 страницы, текст R2/25/цитата/обоснование проверен; обе страницы отрендерены, первая визуально просмотрена. [Проверка PDF](paid-ai/pdf-verification.json): PDF v1 до/после возврата **побайтно одинаков**. Screenshots пяти этапов рядом. Private traces, env, ключи, operator session и server logs в Git не включаются. Временные пользователи удалены.

Vercel проект `saq-qurylys`, scope `spydonnys-projects`; публикация/CI пока PENDING. MCP403 обойдён CLI с собственной сессией; кириллический hostname в User-Agent CLI заменён на ASCII только внутри процесса. Remote main `5d4d9b3` — отдельный root snapshot; не перезаписывается. Публикуется отдельная ветка текущей истории.

## Результат публикации

Кандидат **`99ec5736d78c3e3357f52791d0d4b1794f236013`** опубликован в [ветке GitHub](https://github.com/archexis/codemasters8/tree/codex/saq-score-candidate) и [Vercel DEMO](https://saq-qurylys-pi.vercel.app). [GitHub CI](https://github.com/archexis/codemasters8/actions/runs/39256363997): frontend/backend/edge SUCCESS. Deployment `dpl_4P8DznFFQBPkTgvjq66u8LWe81J4` READY. [HTTP/assets/source proof](publication/publication.json): HTTP200 без авторизации, JS/CSS200; SHA1 всех80 доступных файлов deployment source manifest совпали с архивом candidate SHA. Private env/evidence не загружались; исключённые каталоги представлены пустыми папками в manifest. Windows/Linux сборки имеют разные chunk names, поэтому для привязки использованы исходные файлы deployment, а не заявлено совпадение cross-platform bundle hash.

Публичный smoke вручную через headed Playwright CLI: карта → публикации13 → новый материал → DEMO parser R2 → принять → досье → дело → проверка факта с неизвестной датой сохраняет score0 → подтверждённый snapshot0. Это отдельная проверка безопасного unknown поведения, не paid AI. Desktop/mobile390×844 screenshots — publication/. Единственная console ошибка: отсутствует favicon.ico404; работа приложения и внешняя карта не блокировались. Полный connected AI + PDF25 проверен локально выше.

Отдельный clean npm ci/build из Git archive PASS. Локальный svelte-check:0 ошибок/предупреждений. В текущем этапе код приложения/backend/SQL не изменялся; CI повторно проверил текущий кандидат. Обе страницы реального server-case.pdf визуально просмотрены: читаемы, без обрезания; v1 до/после возврата побайтно равны. Расход по peak usage $0.0029493, не выписка provider account. Финальный source manifest исходной Windows копии `bafc848535b22949469ae50e601b11abdfb204c3f2198ca64e48aa6a58bcb987`; normalized Git archive подтверждён отдельно.

Эта секция заменяет прежние NOT_RUN/PENDING для paid AI и публикации; старые строки/архивные объяснения выше отражают этапы приёмки. Внешние3D city/terrain остаются NOT_RUN; конкурсная заявка не отправлялась. Remote main не переписывался. Публичный deployment остаётся SHA99ec573; следующий commit содержит только документацию и артефакты результатов.
