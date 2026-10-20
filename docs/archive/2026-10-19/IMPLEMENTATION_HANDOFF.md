> Исторический документ. Описывает прежнюю версию или план; для текущей работы используйте [актуальную документацию](../../README.md).

# SAQ QURYLYS — передача следующему разработчику

Дата: 18.10.2026. Это результат аудита, а не выполненная миграция или разрешение немедленно переписывать приложение.
Рабочая директория: `C:/Users/BIGra/codemasters8`.
Проверенный source: `main`, полный SHA `25a805741be6e25ba871c513ea2e7ef8d63ce7a9`.
Remote: `https://github.com/archexis/codemasters8`, public на момент анонимной проверки; remote HEAD/main совпадают с SHA выше.
До аудита working tree чистый. Аудит создал только четыре markdown в `docs/`; source/config/tests не менялись, зависимости не устанавливались, commit/push не выполнялись.

## Что прочитать в первую очередь

1. Оригинал: [ТЗ SAQ, 6 страниц](<C:/Users/BIGra/Downloads/Telegram Desktop/Кейс Codemasters 8.0. SAQ (1).pdf>). Ключевые части: §3–4 с.2 — модули/данные; §5 с.3 — score/факты/A/B/C; §6–7 с.4 — AI/технический минимум; §8–9 с.5 — GitHub/питч; §10–11 с.6 — баллы/дополнительные идеи.
2. `docs/REQUIREMENTS_MATRIX.md` — отдельная строка на каждое условие, статус, source/code reference, трудоёмкость, приоритет. Учесть уточнение: конкурс допускает свободный стек, локальные данные, тестовую подпись аналитика и печатную версию.
3. `docs/CODEBASE_AUDIT.md` — подробный trace, defects A01–A19, browser/Node evidence, проверки и ограничения.
4. `docs/FEATURE_INVENTORY.md` — все major views, controls и data flows с фактическими статусами.

Целевой Svelte 5/TS/Vite/Supabase указан пользователем как требование будущего развития, а не требование самого конкурса. Приоритет конкурса — связанный рабочий сценарий, источники, AI на новом вводе и отсутствие неподкреплённых выводов. OCR/дроны/Risk Web/Time Machine — дополнительные функции. Не подменять ими обязательный MVP.

## Точная структура

```text
C:/Users/BIGra/codemasters8/
  .git/                          # метаданные, не анализировать как source
  .gitignore                     # node_modules/, .env, .DS_Store
  .env.example                   # пример AI config, runtime .env не читает
  .impeccable/
    critique/index-html/2026-10-15-2050.md  # старый дизайн-аудит, не свежий E2E
  index.html                     # shell/topbar/modal/toast и classic scripts
  README.md                      # запуск/тесты/demo, есть устаревшие формулировки
  css/
    styles.css                   # tokens, layout, controls, motion/print/responsive
  js/
    scoring.js                   # 56 строк, pure deterministic domain rules
    data.js                      # 341 строка, synthetic + public snapshot seed
    parser.js                    # 340 строк, entities/PAY/CSV/platform/relations
    ai.js                        # 132 строки, regex fallback + optional browser LLM
    app.js                       # 1084 строки, state/IO/router/views/actions/map
  tests/
    test-scoring.cjs             # 90 assertions с seed/heuristic
    test-parser.cjs              # 57 assertions
    test-sources.cjs             # 31 assertions
  tools/
    verify_ashyq.py              # live CSV check с hardcoded EXPECTED
    __pycache__/
      verify_ashyq.cpython-314.pyc  # закоммиченный generated artifact
  scrollcraft/
    FINGERPRINTS.md              # template/design metadata, не runtime
  docs/                          # результат текущего аудита
    CODEBASE_AUDIT.md
    FEATURE_INVENTORY.md
    IMPLEMENTATION_HANDOFF.md
    REQUIREMENTS_MATRIX.md
```

Других приложений, package.json/lockfile/node_modules, Svelte/TypeScript, SQL/migrations, Supabase/server/API, CI/deploy config и локальных image assets в исходном дереве не обнаружено. Нет скрытого второго frontend, который нужно считать активным. CSS/HTML/JS здесь — фактический продукт.

## Entry points и зависимости

`index.html:53–59` загружает:

1. Leaflet 1.9.4 с unpkg (JS/CSS SRI).
2. Leaflet.markercluster 1.5.3 с unpkg (без SRI).
3. `js/scoring.js` → `window.SQ_Scoring`.
4. `js/data.js` → `window.SQ_SEED`.
5. `js/parser.js` → `window.SQ_Parser`.
6. `js/ai.js` → `window.SQ_AI`.
7. `js/app.js` → IIFE, `loadState`, initial hash handling, `render`.

`scoring/data/parser` также экспортируются CommonJS для Node. `ai.js` экспортирует `{}` в CommonJS, тесты читают через stub `global.window`. Порядок globals важен. Это не ES-module graph, циклических импортов не обнаружено. В браузере доступны Google Fonts; offline есть системные fallbacks. Связь бизнеса с сетью только в explicit LLM fetch; map tiles/fonts/CDN отдельно.

Версии среды аудита: Node v24.18.0, Python 3.11.0. Они не закреплены в проекте. Ни package manager, ни npm scripts не существуют; не запускать install ради статического старта.

## Навигация и состояние

| URL | Функция | Замечание |
|---|---|---|
| `#/home` | `vHome:275` | Hero, counts/donut, quick parser, story, rules, A/B/C, FAQ |
| `#/overview` | `vOverview:467` | Поиск/зоны/карта/list; `overviewFilter` в памяти |
| `#/detail/:zkId` | `vDetail:570` | Fields, factor decisions, ads, media/readiness, timeline |
| `#/ads` | `vAds:715` | Platform filter, related ads, link к ЖК |
| `#/analyze` и `#/analyze/:zkId` | `vAnalyze:739` | Текст/web/shot tabs; новый ad/CSV/AI; prefill только ЖК |
| `#/signal/:zkId` | `vSignal:978` | Текущий score/factors, signal status/history, print |
| `#/registries` | `vRegistries:1032` | 11 внешних ссылок; не интеграция |

`routeFromHash:153`, `nav:161`, `render:182` — границы router. `render` заменяет `page.innerHTML`. Начальный hash `1081` обходит `nav`: title/aria-current остаются исходными; воспроизведено после reload. Не менять URL/ID одновременно с data migration: это полезные existing deep links.

State внутри app closure:

```text
{
  complexes: deepClone(SQ_SEED.COMPLEXES),
  userAds: [],
  signals: {},       # keyed by zkId
  media: {},         # keyed by zkId -> metadata array
  route: {view, zkId?, prefill?}
}
```

`allAds:51` объединяет userAds перед seed ADS; `getZk:52`, `adsOf:53`, `scoreOf:54` и `getSignal:55` используются по всему UI. Score не сохраняется, каждый экран вычисляет его заново.

Storage keys (не environment variables): `sq_state_v1`, `sq_ai_config_v1`, `sq_session_v1`, `sq_reviewer_v1`, `sq_intro_seen`. `persist:35` пишет factors по ЖК, zkExtra readinessConfirmed/readinessSources/events/sources, userAds/signals/media. Основные поля ЖК и legalBasis всегда приходят из seed; их UI не редактирует. `loadState:14` накладывает старые factors целиком и extras на свежий seed без schema validation/version migration. Это важно: изменение seed не заменит подтверждения, уже сохранённые в браузере.

`setFactor:134` upsert одного текущего фактора по code; переписывает status/reviewer/updatedAt и shallow merges evidence. `setSignal:57` append transition history, но не snapshot фактов. Actions не требуют настоящего login. Имя — произвольная локальная подпись, явно demo; не выдавать её за аутентификацию.

## Фактические модели

| Модель | Поля/связи | Ограничения |
|---|---|---|
| Complex | id, demo/scenario/origin, name/city/address, lat/lng?, geoApprox?, developer/bin?, authOrg?, registryId?, stage, readinessClaimed/Confirmed, readinessSources[], legalBasis, note, factors[], events[], sources[] | 8 scenario + 8 public-snapshot; developer не entity; stage — строка; nullable coords/readiness/BIN сохранить |
| LegalBasis | type unknown/absent/guarantee/mio-permit, status unknown/absent-verified/verified, source, checkedAt | Один вложенный объект; нет validity dates/applicability/document IDs; R1 никак не связан инвариантом |
| Advertisement | id, zkId, platform, account, date, url, captureAt, text, userAdded? | 13 seed; user ID AD-Uxx от длины массива; нет edit/delete или AI run fields |
| Factor | code R1..R6, status confirmed/hypothesis/rejected/needs-verification, evidence, reviewer?, updatedAt? | Единственное текущее значение; нет decision history; duplicate code не валидируется на входе scoring |
| Evidence | adId?, quote?, source?, date? | Один shallow объект, не отдельная сущность, file/url/hash отсутствуют |
| Source/ReadinessSource | title/date/url? либо value/source/date | Произвольные строки; source URL в detail не выводится как clickable |
| Signal | keyed by zkId, status, reviewer, updatedAt, history[] | Нет id/createdAt/version; current display берётся из ЖК; `pending` label есть, перехода pending нет |
| Signal transition | at ISO, reviewer, from, to, comment | Реально persist; журнал только для signal, не для factors/rejected new AI |
| Media metadata | date, note, ready, kind, name | Бинарные файлы отдельно `mediaBlobs[zkId][]` с objectURL, не сохраняются |
| Parser output | engine local-parser-v3, sentences, payment{flagged,quotes,cues}, channel{flagged,quotes}, entities[], counts | Entity type/label/value/quote/span/confidence/valueKzt?; output не persist |
| AI output | engine, realAI, hypotheses[], limitations[], raw? | Hypothesis candidate_factor R2/exact_quote/explanation/confidence/needs_human_review; output/run/model provenance не persist |

Связи сейчас только строковые: ad.zkId→complex.id, evidence.adId→ad.id, signals/media keyed by zkId; phones/accounts/URL связи вычисляются regex при рендере. Нет FK/tenant/ownership. У реестровых companies BIN null, не генерировать фиктивный BIN при нормализации. Одна реальная компания может повторяться между разными ЖК.

## Что сохранить и переиспользовать

- `scoring.js` pure rules и boundary suite: веса 35/25/10/15/10/5; cap100; red только ≥60 с R1+R2; другие ≥25 yellow; hypotheses/unknown/rejected =0. Для валидного unique input это правильно.
- Seed A/B/C и expected 35/yellow,70/red,10/green. `origin`/scenario labels и null значения сохранять; public snapshot не смешивать с вымышленными обвинениями.
- `parser.js`: spans, money/phone normalization, RU/KZ patterns, platform/CSV/related helpers. Исправить известные случаи, не удалять accumulated regressions.
- UI detail/signal dossier, reason→quote→source, human decision до начисления; CSS tokens и components `.panel/.btn/.zone/.st/.chip/.factor/.kv/.timeline/.empty`.
- Hash deep links, удобные presets, independent list при map/CDN failure, отсутствие автоматических госрассылок.
- Leaflet baseline OSM/cluster работает; нет доказательств, что все его слои надо выбросить.

Не считать reusable backend services существующими: repositories/DB clients/Auth/Storage/Edge Functions ещё нет. Чистые parsing/scoring modules — переиспользуемая бизнес-основа; `persist/setFactor/setSignal` — только поведенческий прототип, не безопасные production services.

## Точки подключения карты

`app.js:540 mapInstance`, `initMap:541` получает filtered complexes. DOM `#map` создаётся в `vOverview:487`. Tiles OSM/Esri; `L.divIcon/L.marker` на запись, markercluster fallback group; click → `nav(detail)`; fitBounds; 14 coords из 16. CSS `.pin` pulse.

Проблемы: `remove` только при следующем initMap, не при выходе с overview; HTML контейнер исчезает раньше cleanup. Search 220ms/debounce и zone filter полностью пересоздают карту, сбрасывают камеру/base layer. Нет selected-building state, GeoJSON, footprints/hover requests/temporal layers. Нет бесконечной перерегистрации одних и тех же handlers на одном экземпляре: старый map удаляется при re-init. Нагрузочный профиль не измерялся.

Следующая граница: stable map component, setFeatures/setFilter/setSelection, lifecycle cleanup, camera state; форматы geometry и datasource определить до maplibre migration. Time Machine требует history snapshots, Risk Web — entity relations, drone — ID media/evidence и датированные observations. Эти данные нельзя восстановить только изменением renderer.

## Точки подключения БД и AI

DB integration отсутствует. Присоединять новый repository разумно на границе `loadState/persist` и команд review/save, не встраивать отдельный fetch в каждую `v*` функцию. Создать понятные contracts и transaction для ad+decision+factor state; append-only decisions и signal versions. Разделить seed/demo dataset от user data и public sources.

Предлагаемые сущности будущей Supabase-схемы: buildings, legal_entities/building_parties, advertisements, legal_basis_records, evidence, factor_decisions, signals/signal_versions, observations, ai_runs. Это рекомендация, а не найденные таблицы. Нужны FK, уникальность текущего factor state по building/code, roles/tenant и policies, Storage access и timestamp precision. PostGIS может пригодиться для geographic queries, но его использование пока не реализовано и не обязательно для 14 точек.

AI: `ai.js:85 realAnalyze`, `124 analyzeAdText` — узкая extraction boundary. System prompt только R2, temperature0, JSON response_format. По умолчанию `heuristicAnalyze` regular expressions (`realAI:false`). UI optional config после первого анализа. Key хранится в открытом localStorage, fetch идёт из browser на введённый endpoint. Перенос server AI должен включать schema (boolean строго, quote непустая точная подстрока), timeout/abort, ограничения входа, provenance model/prompt/response/review; scoring оставить отдельно.

Environment variables, существующие в `.env.example`, **только имена**:

- `SQ_AI_ENDPOINT`
- `SQ_AI_MODEL`
- `SQ_AI_KEY`

Эти env variables текущий browser runtime не читает. Реальная настройка — `SQ_AI.saveConfig({endpoint,model,apiKey})` через UI localStorage. Supabase env names в проекте не определены; будущий агент должен ввести их с документацией, не утверждать, что они уже есть. Никакие реальные ключи не использовались в аудите.

## Подтверждённые дефекты: короткие воспроизведения

Проверять на отдельном disposable browser profile/origin. Не очищать localStorage пользователя. Аудит использовал локальный `127.0.0.1:8765`, synthetic SQ-003 и имя AUDIT-LOCAL, не изменял seed/source или реальные company rows. На этом origin могут остаться AD-U01/изменённые факторы/журнал — это тестовые изменения браузера, не изменения репозитория.

| Дефект | Воспроизведение / причина | Доказательство |
|---|---|---|
| A01 — ложный confirmed R1 | Seed C имеет verified guarantee. Detail → R1 «Подтвердить вручную» → любое имя, без source/comment → 45. Новый текст с депозитом→confirm R2 →70/red, guarantee остаётся verified | Browser + `app.js:677–679,134`; P0 |
| A02 — отказ пропадает | Analyze new deposit → «Нет, отклонить» → reload | Browser: исходный empty result, нет saved rejection; `app.js:947` только innerHTML |
| A03 — audit trail/approved content меняются | Factor confirm/unconfirm перезаписывает f; signal status остаётся confirmed при новых фактах | `setFactor:134`, `setSignal:57`, `vSignal:983–1011`; history factors отсутствует |
| A08 — детекторы расходятся | Новый текст «Скидывай деньги на каспи 731000 тенге.»: parser.payment=true, heuristic.hypotheses=[] | Inline Node; `parser:22`, `ai:22–39` |
| A08 — неверная область отрицания | «Не упустите квартиру, депозит 731000 тенге до договора.» → оба detector false | Inline Node; broad NEG `parser:33`, `ai:43` |
| A09 — quote не дословная | Длинное предложение >280 chars с бронью → quote с добавленным «…», text.includes=false | Inline Node; `parser:115`, `ai:67` |
| Seed quote mismatch | SQ-001/R3→AD-001: пропущено название ЖК в середине quote | Inline Node; `data:24,190` |
| AI schema weak | Local stub returns string `"false"` with quote → creates hypothesis; true+empty quote тоже accepted | Inline Node fetch stub, без сетевого вызова/real inference; `ai:107` |
| Duplicate factor codes | `computeScore([{code:'R2',status:'confirmed'},{code:'R2',status:'confirmed'}])` →50 | Inline Node; `scoring:20–24`; UI upsert обычно защищает, import не защищён |
| CSV corruption | Заголовок `text;platform`, quoted field с переводом строки → 2 ошибочные rows вместо 1 | Inline Node; `parser:314–332`; zkHint результат UI игнорирует |
| Platform spoof | URL `https://attacker.invalid/krisha.kz` определён как Krisha | Inline Node; `parser:221–222`, regex по всей строке |
| Media pairing после reload | Metadata уже есть, blobs пуст. Новый upload push URL[0] и metadata в конец; render связывает URL[0] со старой metadata[0] | Статический trace `app:646,691–694`; runtime upload UNVERIFIED |
| R5 lifecycle | Gap<20 не пересматривает old confirmed R5; gap≥20 заменяет confirmed на hypothesis | `app:697–710`, статический trace; human review нужен |
| Async stale result | Start external AI, уйти со страницы; callback обращается к #an-result/null либо чужой новой форме | Статический trace `app:884–965`; real-provider runtime UNVERIFIED |

URL protocol не валидируется перед сохранением/href/window.open; `esc()` важен, но не заменяет scheme validation. Конкретный browser exploit не проверялся; не заявлять доказанный remote/stored XSS. Map/blob memory growth в MB/FPS не измерялся, говорить о lifecycle defects, не о выдуманных цифрах.

## Безопасная последовательность следующего этапа

Это рекомендации для отдельного implementation agent, в текущем аудите ничего из списка не реализовано.

1. **Зафиксировать scope и сдаваемый SHA.** Проверить status/инструкции и не затереть пользовательские изменения. PDF §8 recommended cutoff 20.10.2026 23:59, timezone не указан; факт сдачи сейчас UNVERIFIED. Не смешивать последующую разработку с уже зафиксированной оценочной версией.
2. **Закрыть P0 достоверность.** Evidence/source/time и совместимость legalBasis обязательны перед confirmed; воспроизводимая защита C от R1 без нового проверенного основания. Сохранить существующие веса/зоны. Сделать осмысленные regression tests для A01 и новых воспроизведённых ошибок.
3. **Сформировать review contracts.** AI run/hypothesis/accept/reject и factor decision журнал; связанные evidence; signal ID/createdAt и snapshot/версия. Изменение фактов должно вести к явному пересмотру утверждённого сигнала. Не стирать историю при отзыве.
4. **Привести parser/AI к одному проверяемому вводу.** Устранить NEG/PAY divergence, exact quote vs display ellipsis, strict schema, source metadata snapshot и async cancellation. Сохранить все RU/KZ passing cases.
5. **Показать настоящий AI на новом тексте.** Защищённый server adapter, реальные timeout/errors и human review; не выдавать regex за LLM. Реальные секреты не в browser/Git. Это обязательный конкурсный blocker независимо от будущего стек-переноса.
6. **Если следующий scope включает Supabase:** нормализованные tables/Auth/RLS/Storage/migrations и repositories с policy checks, migration/export локальных данных. На 14 точках geo storage не требует преждевременной сложной spatial architecture. Demo/public origins и nulls сохранить.
7. **Если требуется целевой стек пользователя:** Svelte5+TS+Vite постепенно вокруг чистого domain/repositories, семь routes и дизайн сохранить, старый работающий MVP не удалять до parity. Типы/validation и корректные lifecycle; не делать одновременный визуальный редизайн.
8. **Довести signal/print E2E.** Материалы с URL/датой/автором/версиями; печать или PDF допустимы. Создать и реально открыть export, проверить русский текст/многостраничность/полноту sources. Один завершаемый сценарий важнее advanced modes.
9. **Map/media lifecycle и удобство.** Stable adapter, cleanup, media IDs вместо параллельных массивов, выбранный объект; подтвердить необходимость MapLibre по объёму/слоям. Проверить narrow screens, keyboard/focus, deep-link heading.
10. **Подготовить сдачу.** README/config/seed/test parity, source attribution, анонимный доступ GitHub и точный commit. Показать пользователю/жюри новый ввод→AI→human decision→score→signal→export. Питч/резервная запись отдельно; баллы себе не присваивать.

Конкурсный MVP не требует ждать полного Supabase/стек-переноса: пункты 2–5 и 8 являются главными функциональными задачами. Если пользователь требует всё целевое окружение в одном следующем этапе, разбить на проверяемые этапы, сохраняя работающий demo-flow.

## Команды и уже полученные результаты

PowerShell, cwd корень проекта:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git log -12 --date=iso --format="%h %ad %s"
git diff --stat
git ls-files --others --exclude-standard
git ls-remote origin HEAD refs/heads/main

python -m http.server 8000 --bind 127.0.0.1

node tests/test-scoring.cjs
node tests/test-parser.cjs
node tests/test-sources.cjs

node --check js/app.js
node --check js/ai.js
node --check js/data.js
node --check js/parser.js
node --check js/scoring.js

python tools/verify_ashyq.py
```

HTTP-server — долгоживущий процесс, после проверки остановить только свой процесс. В аудите использовался порт 8765; для нового теста выбрать отдельный origin/profile, чтобы не опираться на AUDIT-LOCAL изменения.

Результаты: scoring 90/PASS/exit0; parser 57/PASS/exit0; sources 31/PASS/exit0; все пять syntax checks exit0. Online verifier exit1 HTTP404, не считать успешным. `tools/verify_ashyq.py:52–54` отключает TLS verification и сравнивает CSV с hardcoded EXPECTED, не с прочитанным data.js: даже после восстановления URL улучшить этот proof contract.

Typecheck/lint/build commands отсутствуют, потому что toolchain отсутствует; не сообщать `npm run build PASS`. Конкурс допускает статическое приложение. После будущей миграции добавить реальные scripts/checks. Существующие suite преимущественно pure logic: не проверяют human workflows, storage failure, versions/rejections, file upload или export.

Chrome DevTools tool не подключился (нет DevToolsActivePort), поэтому browser audit выполнен через IAB. Открыты все 7 views, визуально OSM/cluster, поиск/Telegram filtering, новый текст с депозитом 731000, confirmed factor/ad persistence и signal confirm/return/reload. В доступных browser error/warn logs записей не было на момент проверки. PDF ТЗ прочитан pypdf и все 6 страниц отрендерены Poppler/просмотрены. API GitHub анонимно подтвердил public repo и remote SHA.

## Не закрытые проверки и блокеры

- Реальный LLM provider/CORS/model inference не проверен; backend/credentials отсутствуют. Stub-test не заменяет эту демонстрацию.
- Финальный print/PDF не создан и не просмотрен; `window.print()` и CSS — только наличие реализации. Не ставить export PASS до проверки артефакта.
- Actual upload/reload gallery E2E и Esri toggle не проверены; найденные media defects статические.
- Актуальность 8 public permit rows и внешних реестров не перепроверена: CSV404; не превращать недоступность источника в R1.
- Полные 390/1440/zoom, a11y/контраст, CPU/heap/тысячи markers и production headers UNVERIFIED. Старый `.impeccable` отчёт не наша повторная верификация.
- Факт сдачи жюри, сдаваемый SHA, доступ до конца оценки, питч/слайды/backup recording не установлены.
- Документ ТЗ хранится вне Git в Downloads; его содержание привязано в матрице по разделам/страницам. Не копировать/публиковать PDF автоматически без отдельной необходимости.

При продолжении не повторять весь аудит: сначала проверить drift текущего HEAD/working tree относительно audit SHA, затем следовать проверенным defect reproductions и requirements matrix. Если source изменился, перепроверить соответствующие места, не переносить выводы автоматически.
