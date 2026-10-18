# SAQ QURYLYS — технический и функциональный аудит

Дата: 18.10.2026 (Asia/Yekaterinburg). Репозиторий: `C:/Users/BIGra/codemasters8`.
Проверенная версия: `main`, `25a805741be6e25ba871c513ea2e7ef8d63ce7a9`.
Все ссылки вида `js/app.js:134` относятся к этой версии и указанному корню.
Аудит не изменяет исходники приложения, зависимости или конфигурацию. Созданы только четыре отчёта в `docs/`.

## 1. Executive summary

Приложение — действующий статический демонстрационный MVP на JavaScript, HTML и CSS, а не Svelte-проект. Svelte, TypeScript, Vite, PostgreSQL и Supabase отсутствуют как в текущем дереве, так и в обнаруженной истории соответствующих файлов. Сборочного конвейера нет. Скрипты загружаются последовательно из `index.html:53–59`, интерфейс строится функциями в одном IIFE `js/app.js` (1084 строки, 96413 байт).

Существуют семь представлений: главная, объекты с картой, карточка ЖК, публикации, проверка, сигнал, реестры. Пять из них доступны из верхней навигации. Источники: seed в `js/data.js` и локальные изменения в localStorage. В seed 16 ЖК: 8 синтетических + 8 публичных записей разрешений; 13 синтетических объявлений; 11 ссылок на реестры; 14 точек с координатами. Начальное распределение: красных 1, жёлтых 3, зелёных 12.

Сильная часть — чистый детерминированный скоринг, сценарии A/B/C, полезный RU/KZ-парсер с координатами фрагментов, различение гипотез и подтверждений, локальный workflow сигнала. Существующие тесты проходят: 90 + 57 + 31 = 178 проверок. В браузере работают карта OSM, поиск, фильтр публикаций, анализ нового текста, сохранение объявления/фактора, подтверждение и возврат сигнала.

Главная блокирующая ошибка: пользователь может подтвердить R1 без доказательства при проверенной гарантии, затем получить красную зону. Воспроизведено на синтетическом SQ-003: 10 → 45 после ручного R1 → 70 после подтверждения R2 из нового объявления; гарантия осталась «проверено». Это ошибка допуска фактов в расчёт, а не арифметики `computeScore`.

По умолчанию «AI» — регулярные выражения, `realAI:false`; внешний LLM-адаптер существует, но реальный вызов провайдера не проверен. Нет серверной аутентификации, RLS, постоянного хранения файлов, общего хранилища решений или полноценного журнала изменения факторов. Отказ от новой гипотезы вообще не сохраняется. Это не готовая многопользовательская аналитическая система.

Авторитетный оригинал конкурсного ТЗ предоставлен пользователем в ходе аудита: [PDF, 6 страниц](<C:/Users/BIGra/Downloads/Telegram Desktop/Кейс Codemasters 8.0. SAQ (1).pdf>). Все страницы прочитаны и визуально проверены. Сопоставление выполнено по разделам §2–§11; полная матрица — `REQUIREMENTS_MATRIX.md`. README и старый дизайн-аудит не считаются независимым доказательством работоспособности.

Ключевое уточнение по оригиналу: §7 разрешает свободный стек и запуск без деплоя; §4 допускает локальный seed и ручной ввод без госAPI; §3 разрешает PDF или печатную версию; текст публикации допустим без screenshot. Auth, Supabase, полный CRUD ЖК и сложные режимы карты не являются обязательными требованиями конкурса. Их отсутствие ниже оценивается как ограничение эксплуатации/цели следующего этапа пользователя. Требования доказательности факторов и содержательного AI на новом вводе обязательны и остаются пробелами.

## 2. Git и состояние репозитория

- До аудита `git status --short` и `git ls-files --others --exclude-standard` пусты: пользовательских незакоммиченных изменений не обнаружено.
- Remote: `https://github.com/archexis/codemasters8`. Анонимный GitHub REST API подтвердил `private:false`, `archived:false`, default branch main. `git ls-remote origin HEAD refs/heads/main` вернул тот же полный SHA, что локальный HEAD. Факт сдачи жюри и доступность до конца оценки — UNVERIFIED.
- Ветка `main`; HEAD `25a8057`, 17.10.2026 20:57:21 +05:00, сообщение: `IA: 5 tabs with Publications, crumbs on detail/signal, counts where they belong`.
- Доступно 28 коммитов от `f0530df` (15.10.2026). Исходный коммит уже содержит статический MVP. Более раннюю архитектуру/работу за пределами этой истории установить нельзя.
- В просмотренных записях Git автор указан как `archexis`; это атрибуция метаданных Git, а не подтверждение личности или единоличного авторства всех решений.
- Между первым коммитом и HEAD: 14 изменённых/добавленных путей, 2165 добавленных и 330 удалённых строк. `js/scoring.js` не изменялся. Манифесты зависимостей и lockfile не появлялись.

| Коммит | Подтверждённое изменение | Влияние |
|---|---|---|
| `86852c9` | Правки кириллических regex, отрицаний, переинициализации карты | Ранние исправления парсинга и Leaflet |
| `dd50663`, `2f9bab2`, `5d9b7cd` | Расширение лендинга/навигации, переход к верхнему меню | UI менялся существенно, доменные модули остались статическими |
| `3512e2d` | Hash routing, тестовый вход | Реальные локальные переходы, но не Auth |
| `603e6ca` | Public-snapshot, расширение parser, verifier | Смешанный seed: вымысел + открытый снимок |
| `ecfa62a` | Убраны два пункта меню и 50 строк представлений | Исторические views не следует восстанавливать как обязательную архитектуру |
| `69e7796` | CSV, связи, площадка/кадры, спутник, быстрый разбор | +548/−59 строк; расширение функций без backend |
| `d965ab1`, `138ca72`, `f861b30` | Печать, motion, текст, CSV-даты, предупреждение дублей | Полировка не закрывает сохранность доказательств |
| `25a8057` | Публикации снова в пяти вкладках, breadcrumbs/counts | Текущее меню имеет приоритет над описаниями четырёх views в старых коммитах |

`git log --all --diff-filter=D --summary` не показал удалённых файлов. Удаление функций внутри файла подтверждено diff `ecfa62a`. В дереве есть закоммиченный Python bytecode `tools/__pycache__/verify_ashyq.cpython-314.pyc`; он не участвует в запуске UI. Незавершённость функций устанавливается по реализациям, а не по наличию WIP-коммитов.

## 3. Текущая архитектура

Один статический сайт; не monorepo. Node v24.18.0 и Python 3.11.0 — версии среды аудита, не закреплённые требования проекта. Package manager/lockfile/`package.json` отсутствуют. Браузерные зависимости: Leaflet 1.9.4, markercluster 1.5.3 с unpkg, Google Fonts. `index.html` закрепляет версии CDN; SRI есть у Leaflet JS/CSS, но не у cluster JS/CSS.

Порядок загрузки: `scoring.js` → `data.js` → `parser.js` → `ai.js` → `app.js`. Контракты — глобальные `window.SQ_Scoring`, `SQ_SEED`, `SQ_Parser`, `SQ_AI`. Для Node у scoring/data/parser есть CommonJS-экспорт; `ai.js` экспортирует пустой объект, тесты обращаются к `global.window.SQ_AI`. Циклических импортов в этой схеме не обнаружено; есть неявная зависимость от порядка глобальных скриптов.

Поток данных: `SQ_SEED` → `loadState()` с deep clone → наложение localStorage → `v*()` → HTML/обработчики → `setFactor`/`setSignal`/добавление объявления или кадра → `persist()` → повторный рендер. Счёт нигде не хранится: каждый экран вызывает общий `computeScore`.

Нет server API, Edge Functions, SQL, миграций, Storage, очередей, realtime, REST-клиента для бизнес-данных, service worker, CI/CD, контейнеров, конфигурации deployment. Статическая раздача — фактический deployment contract (`README.md`, `index.html`). Все 5 JS-файлов активны; тесты, verifier и markdown-дизайн-артефакты UI не импортирует.

## 4. Frontend architecture

Svelte 5 runes, legacy `$:`, props/events Svelte, stores, Svelte lifecycle и strict TypeScript — НЕ ПРИМЕНИМО: `.svelte`, `.ts`, `tsconfig`, Vite отсутствуют. Типы и `any` не проверяются; отсутствие `any` в JS не означает типобезопасность.

`js/app.js:14` хранит единое изменяемое состояние внутри замыкания. `render():182` вызывает нужный view; каждый view заменяет `page.innerHTML`, заново привязывает обработчики. Shared helpers (`esc`, chips, score, parser table, timeline) полезны, но не отделены от DOM и persistence. Наиболее сложные функции: `vHome:275`, `vDetail:570`, `vAnalyze:739`.

Hash router `routeFromHash:153` понимает `#/home`, `#/overview`, `#/ads`, `#/registries`, `#/detail/:id`, `#/signal/:id`, `#/analyze/:id?`. `nav:161` обновляет title/nav, `hashchange:175` поддерживает историю. При начальной загрузке `app.js:1081` присваивает route и вызывает `render`, обходя `nav`. В браузере после reload detail/signal/analyze оставался заголовок «SAQ QURYLYS»; у analyze также описание главной. Контент маршрута грузится правильно. Неизвестный ID даёт empty state; regex не привязан к концу URL, невалидный hash после загрузки игнорируется.

Async: кнопка анализа блокируется на время запроса и разблокируется в `finally:965`. Но нет AbortController, проверки актуальности маршрута и снимка метаданных: text/zkId захватываются до await, platform/account/date/url читаются позже при сохранении (`884–962`). Уход со страницы при LLM-запросе оставляет обращения к отсутствующему `#an-result`; ошибка из catch может повторно обратиться к null. Возврат на другую форму способен показать устаревший результат. Это статически установленный сценарий, runtime с реальным провайдером UNVERIFIED.

Подписок Svelte нет. Глобальные document/hash обработчики регистрируются один раз. `setTimeout` истории (до 4.2 с), `requestAnimationFrame` счётчиков (850 мс) и debounce поиска не отменяются при уходе со view; это ограниченные по времени хвосты, не доказанная неограниченная утечка. Долгоживущие map/blob-ресурсы разобраны ниже.

## 5. Страницы, дизайн и взаимодействия

`index.html:18` — sticky topbar, пять разделов, отдельное меню сеанса; sidebar/drawer отсутствует. `css/styles.css:2–25` задаёт семантические цвета текста/бумаги/карточек/риска, радиус и шрифты. Главный шрифт Inter/Manrope; Georgia для части dossier, системный mono fallback. Загружается также Unbounded, активные переменные используют Inter. Светлая тема, тёмный hero/scene; переключателя темы нет.

Повторно используемые паттерны: `.panel`, `.btn` primary/danger/small, `.zone`, `.st`, `.chip`, `.factor`, `.kv`, `.timeline`, `.empty`, `.loading-line`, таблицы parser/log, modal/toast, галерея. Отступы чаще заданы px и inline styles, единой шкалы spacing нет. Новая реализация может сохранить визуальную систему без редизайна.

Адаптив: breakpoint 1020 px меняет меню и сетки, скрывает вторичные колонки реестра; ≥1600 px увеличивает контейнер до 1560 px (`css:446–479`). В IAB при ширине скриншота 855 px карта и список отображались, мобильное меню работало. Полный набор 390/1440/zoom в этом аудите UNVERIFIED: старый `.impeccable/critique/...` описывает чужие проверки, они не переиспользуются как наши результаты.

Доступность: labels, названия зон словами, focus styles, клавиатурные Enter/Space у строк, Escape у modal, reduced-motion — сохранить. Дефекты: modal без focus trap/возврата фокуса и `aria-labelledby` (`index.html:46`, `app.js:69–75`); tabs без roving tabindex/стрелок; после закрытия mobile nav через выбор раздела `aria-expanded` не сбрасывается (`1047–1054`, воспроизведено); карта с `role=img` скрывает интерактивное поддерево в AX (список остаётся доступен); password/number не включены в общий CSS selector полей (`css:149`). Контрастность и полный WCAG-аудит UNVERIFIED.

## 6. Реализация карты

Leaflet, не MapLibre. Единственная точка интеграции — `js/app.js:initMap:541`; контейнер создаёт `vOverview:487`, данные передаются уже отфильтрованным `list`. OSM raster включён по умолчанию, Esri World Imagery доступен через `L.control.layers`; даты съёмки нет. API-ключи не нужны. Tiles реально отобразились в IAB; переключение Esri и актуальность снимков UNVERIFIED.

`withCoords` проверяет только числовой тип lat/lng, не диапазон/NaN. 14/16 записей на карте; SQ-008 и SQ-R08 пропускаются. Public-snapshot имеет `geoApprox:true`, приблизительность видна в карточке, но не в map popup. Контуры зданий, GeoJSON, risk polygons, hover-логика и side panel отсутствуют.

Каждый объект — DOM marker `L.divIcon`/`L.marker` (`559–560`); markercluster используется при доступности, иначе layerGroup. Popup содержит название и балл, но тот же click сразу уводит в detail (`561–562`), поэтому popup не самостоятельный workflow. Камера fitBounds для >1 точки, zoom 13 для одной. Клик по объекту не синхронизирует выделение на карте: карта заменяется страницей карточки. Нет selectedBuilding store, сохранения камеры, анимации перелёта между объектами или загрузки по bounds.

`initMap:548` вызывает `remove` предыдущей карты перед следующей и исправляет повторную инициализацию. Но `render` сначала заменяет HTML; при уходе на другую страницу `remove` вообще не вызывается до следующего overview. Последняя карта остаётся удержанной `mapInstance`, с ресурсами/обработчиками. Повторные входы на overview удаляют старую карту — бесконечное накопление экземпляров не доказано.

| Будущий режим | Что уже есть | Можно ли добавить без переписывания основы | Недостающая часть |
|---|---|---|---|
| X-Ray | Цветные risk pins, фильтр зон | Да для точек/простых GeoJSON | Геометрии, слои/легенда, управление layer visibility |
| Time Machine | `tlineHtml`, events, signal history | UI времени можно добавить | Нет исторических snapshot факторов/score; историю сейчас восстановить нельзя |
| Investigation | Detail и переход marker → detail | Да, выделив map adapter | Стабильная карта, выбранный объект, панель, двустороннее состояние |
| Risk Web | `relatedAds` по контакту/URL | Да как отдельный граф/overlay | Нормализованные компании/отношения, графовая модель и навигация |
| Drone Intelligence | Локальные media metadata и ручная readiness/R5 | Да для датированных превью | Storage, привязка кадра к evidence, версии наблюдений, геопривязка; computer vision нет |

Обязательного основания срочно менять Leaflet нет: маленькая карта работает и допускает эти расширения. Целевой MapLibre разумно оценивать отдельно под плотность/векторные геометрии и требования пользователя. Текущая связь UI и lifecycle требует разделения при любом выборе библиотеки; сами перечисленные режимы не реализованы.

## 7. Данные и backend

| Сущность | Фактическая модель/чтение | Создание/изменение | Удаление и ограничения |
|---|---|---|---|
| ЖК | `data.js:12–187,223–335`, `getZk`, `vOverview/vDetail` | Только seed; UI меняет readiness/events/factors | CRUD ЖК нет; id строковый SQ-* |
| Компания | Встроенные `developer`, `bin`, `authOrg` в ЖК | Нет отдельного сервиса/редактора | Повторяющиеся имена; у публичных BIN null; authOrg в detail не показан |
| Объявление | `ADS:189–203` + `state.userAds`, `allAds:51` | `vAnalyze.saveAd:930`, R3 callback:959 | Нет edit/delete; reset удаляет локальную надстройку |
| Правовое основание | `legalBasis{type,status,source,checkedAt}` в ЖК | UI читает; редактирования и проверки реестров нет | Не связано инвариантом с R1; текст номера, не документ |
| Документ/источник | `sources[]{title,date,url?}`, `readinessSources` | Seed; readiness добавляет строку источника | Нет таблицы документов, бинарных копий/версий; URL sources не выводится как ссылка в detail |
| Фактор/доказательство | `factors[]{code,status,evidence,reviewer,updatedAt}`; evidence `adId?,quote?,source?,date?` | `setFactor:134` upsert по code | Снятие статуса, не delete; evidence один объект, новый shallow merge затирает старый |
| Сигнал | `signals[zkId]{status,reviewer,updatedAt,history[]}` | `setSignal:57` | Один сигнал на ЖК; нет immutable snapshot и workflow pending |
| Действие аналитика | Имя из `sq_session_v1`/`sq_reviewer_v1`; signal.history | Сигнал append, фактор перезаписывается | Нет подтверждённой личности/общего action log |
| Наблюдение/дрон | `media[zkId][]{date,note,ready,kind,name}` + `mediaBlobs[zkId][]` | Detail upload:687; readiness:697 | Метаданные переживают reload, бинарный файл нет; delete нет |
| AI run/hypothesis | Локальный `res` внутри onclick | Анализ нового текста | Не сохраняется; только подтверждённая цитата переносится в фактор |

Source of truth: исходный seed для основных полей и localStorage-надстройка для изменений. Единого серверного источника нет. `loadState:21–30` доверяет структуре JSON и не проверяет enum/ссылки/уникальность. Старые факторы целиком заменяют новые seed-факторы; схема хранения остаётся v1 при расширении формата. Нет cross-tab синхронизации или optimistic concurrency; последняя запись целого состояния побеждает. `persist:44` сообщает о потере сохранения, но действие уже показано/применено в памяти, а последующий toast может скрыть предупреждение.

`tools/verify_ashyq.py` скачивает публичный CSV вручную из CLI, UI его не вызывает. На дату аудита команда вернула HTTP 404 и exit 1. Проверяет хардкод `EXPECTED`, а не автоматически прочитанный `data.js`; даже успешный результат не проверил бы все поля (BIN, координаты, builder). Нельзя утверждать, что текущие 8 строк повторно подтверждены живым источником.

## 8. Статус Supabase и миграционные риски

Supabase НЕ ИНТЕГРИРОВАН: нет клиента, URL/ключей Supabase в конфигурации приложения, Auth, таблиц, migrations, RLS policies, Storage buckets, Edge Functions, PostGIS. Нет backend, чью корректность можно проверить запросом.

Переиспользуемы scoring/parser, seed и ID-связи ad.zkId/evidence.adId, названия статусов и доказательственные UI-паттерны. Для будущей БД потребуются отдельные buildings, legal_entities, advertisements, legal_basis_records, evidence, factor_decisions, signals/signal_versions, observations и AI runs; это предлагаемая граница сущностей, не существующая схема.

Риски переноса: смешанные synthetic/public данные; отсутствие BIN у реестровых компаний; строковые source/даты разной точности; один фактор на code вместо истории решений; непереносимые blob URL; seed/localStorage merge; последовательные AD-Uxx ID дают коллизии между клиентами; отсутствие владельца/tenant; stage и сроки в строке; media и legalBasis не нормализованы. До импорта нужно определить tenant/roles, связи, уникальность `(building_id, factor_code)` для текущего состояния и отдельную историю решений, политику документов/доступа. Не переносить `sq_ai_config_v1` в БД или экспорт данных.

## 9. AI

`js/ai.js:57` — `heuristicAnalyze`, regular expressions, первая найденная фраза → R2 hypothesis с `confidence:low-demo`, `realAI:false`. Новые тексты обрабатывает, но не является языковой моделью. UI использует «встроенный помощник», одновременно чип «гипотеза ИИ»; раздел ограничений честно указывает keywords (`app.js:902–918`). Требование обязательного настоящего AI по умолчанию не выполнено.

`realAnalyze:85–121` — произвольный OpenAI-compatible POST chat/completions. Endpoint/model/key задаёт человек; в форме предложен OpenRouter (`app.js:921`). Модель не закреплена; temperature 0, JSON response_format. System prompt требует только предложение денег, точную подстроку и отсутствие юридических выводов. HTTP и JSON parse errors обрабатываются, несовпадающая цитата отбрасывается.

Нет timeout, retry, abort, server proxy, max token policy или полноценной response schema. `payment_offer_detected` проверяется truthiness, `exact_quote` может быть пустой строкой. В локальном fetch-stub, БЕЗ сети и настоящих ключей, строка `"false"` создала гипотезу, и `true` с пустой цитатой также создало гипотезу. Это проверка адаптера, не доказательство реального inference.

Key и endpoint/model лежат открытым JSON в `sq_ai_config_v1` (`ai.js:6–15`), доступны сторонним JS того же origin. API-запрос и Authorization отправляются из браузера на введённый endpoint; HTTPS/allowlist не валидируются. Masked input не защищает localStorage. Полный реальный LLM-вызов, CORS, биллинг, стабильность модели и внешний SLA — UNVERIFIED; реальные ключи не вводились.

Результаты parser/AI, engine/model/prompt, confidence, отклонения и raw response не сохраняются. Подтверждение создаёт объявление и R2, но provenance модели теряется. `data-hno` в `app.js:947` меняет только DOM и toast. После reload отказ исчез, записи решения/объявления нет. Написанное в UI «решение зафиксировано локально» вводит в заблуждение.

## 10. Скоринг и правовые основания

`js/scoring.js:5,17–45` точно реализует веса 35/25/10/15/10/5, cap 100, confirmed-only, red при ≥60 + R1 + R2, yellow при ≥25 в остальных случаях, green ниже 25. Unknown/hypothesis/rejected не добавляют баллов. Результат детерминирован. A=35/yellow, B=70/red, C=10/green подтверждены тестами и UI исходного seed.

Отклонения не следует смешивать с корректной формулой:

1. **Нет доказательственного допуска.** `app.js:677–684` позволяет любой ручной confirmed с одним именем. R1 не проверяет legalBasis, отсутствие evidence не запрещено. Runtime SQ-003 10→45→70 при verified guarantee; источник R1 — «—».
2. **Нет уникальности на входе scoring.** `confirmedPoints` суммирует повторный code. Две confirmed R2 дают 50 вместо 25 (Node probe). UI upsert обычно предотвращает дубль; риск актуален для импорта/невалидного localStorage, это не наблюдавшийся дефект seed.
3. **R5 не жизненный цикл.** `app.js:697–710` разрешает readiness без файла; при gap≥20 перезаписывает даже confirmed R5 в hypothesis, при gap<20 оставляет старый confirmed R5. Не фиксирует дату/ссылку обоих сравниваемых источников в структурированной evidence. SQ-007 имеет hypothesis R5 без независимого значения (`data.js:166`), нулевой балл правильно сохраняется, но её можно подтвердить без источника.
4. **История факторов теряется.** `setFactor` хранит только последнего reviewer/time/evidence. Снятые/отклонённые подтверждения исчезают из `tlineHtml:973`; смена источника затирает прошлое. Signal.history этого не восполняет.
5. **Заявленная дословность нарушена.** `ai.js:67`, `parser.js:115–117` обрезают строку с добавленным «…», которой может не быть во входе. На длинном новом предложении оба `text.includes(quote)` false. В seed SQ-001/R3 quote также не является подстрокой AD-001: пропущено название ЖК (`data.js:24,190`).
6. **Два детектора R2 расходятся.** `parser.js:22` распознаёт «Скидывай деньги на каспи 731000 тенге.», `ai.js:22–39` — нет. Parser UI говорит о платеже, гипотезы R2 нет. `NEG` в обоих подавляет всё предложение из-за «Не упустите квартиру, депозит 731000 тенге до договора.» — false negative, воспроизведено.
7. **Сигнал не привязан к версии фактов.** `setSignal` сохраняет статус, а `vSignal` всегда показывает текущие факторы/score. Изменение фактора не снимает confirmed сигнал и меняет содержимое ранее утверждённой карточки. Нет immutable снимка, номера версии и перехода pending.

Публичные записи имеют permit-number → `legalBasis.status=verified` (`data.js:232` и аналоги). Это сильнее оговорки «номер не юридический вывод». Нужно отделить наличие записи в снимке, актуальную применимость документа и итог ручной проверки; правовая актуальность снимка в этом аудите UNVERIFIED. Не следует автоматически добавлять R1/R6 из отсутствия данных или прошедшей строки срока.

## 11. Матрица фактической работоспособности

Статус FULLY FUNCTIONAL относится к явно указанному локальному назначению, не к production. «По коду» не означает успешный browser E2E. Полная детализация — `FEATURE_INVENTORY.md`.

| Страница/поток | Статус | Основание |
|---|---|---|
| Главная, сводка, A/B/C, FAQ/CTA | FULLY FUNCTIONAL локально | Browser + `vHome`, числа исходного seed верны |
| Объекты: поиск/зоны | FULLY FUNCTIONAL локально | Browser: «Сарыарқа» оставил 1 запись/метку; зоны по коду |
| OSM-карта/кластеры | PARTIALLY FUNCTIONAL | Tiles/кластеры видны; состояние/cleanup недостаточны |
| Esri toggle | UNVERIFIED runtime | Реальный layer code есть, не переключался в аудите |
| Detail, источники, factor score | PARTIALLY FUNCTIONAL | Browser; неверный допуск R1, нет редактирования evidence |
| Публикации/фильтр/связи | FULLY FUNCTIONAL локально | Browser Telegram → AD-004/009; связанные аккаунты показаны |
| Monitoring/scraping/OCR | NOT IMPLEMENTED | Только ручной текст/CSV/preview, явно указано в UI |
| Новый текст/эвристика | PARTIALLY FUNCTIONAL | Browser новый депозит 731000, есть ошибки детекторов |
| Внешний LLM | UNVERIFIED | Код/локальные stub-проверки; реального запроса нет |
| Confirm ad/R2 + persistence | PARTIALLY FUNCTIONAL | AD-U01 и R2 сохранились после reload; metadata/evidence неполны |
| Reject новой гипотезы | UI ONLY | Browser + callback `947`, после reload отсутствует |
| CSV | PARTIALLY FUNCTIONAL | Тесты pass; multiline разбивается на две записи, zkHint игнорируется |
| Screenshot attachment | UI ONLY | `846–850` только preview, не привязан к сохранённому объявлению |
| Drone/gallery/readiness | PARTIALLY FUNCTIONAL по коду | Только локальный файл/метаданные, нет durable storage |
| Signal confirm/return/journal | PARTIALLY FUNCTIONAL | Browser и reload pass; нет версии фактов/проверок/прав |
| Print/PDF | UNVERIFIED end-to-end | `window.print`, print CSS; готовый PDF не создан/не инспектирован |
| Реестры | PARTIALLY FUNCTIONAL | Страница/11 ссылок есть; нет lookup/save результата проверки |
| Тестовый вход | MOCKED (явно подписан) | Имя в localStorage; не аутентификация |
| Reset | PARTIALLY FUNCTIONAL по коду | Стирает state, не AI config/session/blob; полный reset не проверялся |

## 12. Производительность

Нагрузочных измерений, FPS/heap/профиля CPU, Core Web Vitals не проводилось. Ниже разделены наблюдение и прогноз.

| Факт | Доказательство | Практическое действие будущего этапа |
|---|---|---|
| Карта пересоздаётся при поиске/фильтре; камера/слой сбрасываются | `vOverview:479,517,519,524`, `initMap:548–566`; фильтр реально работает | Стабильный map component/adapter; менять layer data, сохранять camera/base layer |
| Все ЖК/объявления загружены сразу | `data.js` script; `allAds`, отсутствие API/pagination | Для 16/13 достаточно; при росте bounds queries, пагинация/индексы |
| DOM marker на объект | `559–560`, cluster fallback | Сохранить для малого seed; сравнить canvas/GeoJSON/WebGL на реальном объёме |
| Связи O(n²) с повторным regex parsing | Каждый ad вызывает `relatedAds` для всей коллекции (`app.js:727`, `parser.js:259`) | Индексировать normal phones/accounts/URL при ingestion |
| Blob URL не освобождаются | `app.js:694,849`, `revokeObjectURL` отсутствует | Lifecycle cleanup и устойчивые media IDs, Storage |
| Постоянные motion эффекты | `.pin::after`, `.zone.red`, `.orb`, SVG flow (`css:165,222,352,380`) | Reduced-motion уже есть; ограничить motion вне viewport, измерить CPU до оптимизации |
| Карта удерживается после ухода | `mapInstance` + отсутствие cleanup в router | Cleanup при unmount/смене route, до удаления контейнера |

Нет hover-fetch и периодического опроса: бизнес-network только LLM при запуске; tiles/CDN/fonts — сторонние ресурсы. Cache бизнес-данных отсутствует, обычный HTTP-cache провайдера — вне контроля приложения. Изображения gallery lazy, video preload metadata (`app.js:647`), screenshot preview загружается сразу локально. Утечка blob и удержание одной карты установлены по lifecycle; рост heap в мегабайтах UNVERIFIED. Кластеризация не доказывает готовность к тысячам DOM-точек.

## 13. Безопасность

Подтверждённого секрета в просмотренных исходниках не обнаружено; значения окружения не публиковались. `.env.example` содержит только интерфейс настройки внешнего AI, runtime `.env` не читает. Security scan всей Git-истории специальным сканером не выполнялся: отсутствие всех возможных исторических утечек UNVERIFIED.

- HIGH для реальной эксплуатации: BYOK key в localStorage + browser fetch (`ai.js:6,88–100`), сторонние JS на том же origin, нет серверной границы доверия. Перенести секреты/вызов в защищённую серверную функцию; нужен новый credential workflow, текущая форма не переносится буквально.
- HIGH для многопользовательской эксплуатации: любой посетитель меняет данные/имя, Auth/RLS отсутствуют. В демо это обозначено и не считается взломом существующего Auth. Для production нужны роли, RLS, серверный аудит.
- MEDIUM: `esc()` экранирует HTML (сохранить), но `href`/`window.open` принимают пользовательский URL без protocol/hostname validation (`app.js:638,732,840–843,935–937`). `type=url` не запускает проверку при JS onclick, `<form>`/reportValidity нет. Исполняемость конкретной URL-атаки в данном браузере UNVERIFIED; нельзя утверждать доказанный stored XSS.
- MEDIUM: verifier отключает certificate validation (`tools/verify_ashyq.py:52–54`), источник 404. Это слабая верификация публичных доказательств, не обработка секретов. Исправить доверенную цепочку/официальный источник, не переносить insecure TLS в backend.
- MEDIUM: cluster CDN без SRI и отсутствие CSP в HTML; HTTP headers production UNVERIFIED, hosting config нет. Ограничить зависимости/сетевые назначения после появления server AI.

## 14. Технический долг и приоритеты

Приоритет P0 — до доверия результатам; P1 — обязательный рабочий контур; P2 — надёжность/масштаб; P3 — polish. Severity оценивает последствия, не трудоёмкость. Все дефекты присутствовали до аудита: исходники не менялись.

| ID / severity / priority | Дефект, место, последствие | Что делать | Риск исправления |
|---|---|---|---|
| A01 CRITICAL P0 | R1/другой фактор без evidence и при verified guarantee; `app:134,677` → ложная red, browser proof | Валидировать evidence/источники и совместимость legal basis до confirmed, серверные инварианты | Средний: старые подтверждения потребуют review |
| A02 HIGH P1 | Reject новой гипотезы — DOM only; `app:947` | Сохранять AI run, отказ, автора/дату/причину | Низкий для UI, средний при новой модели |
| A03 HIGH P1 | История факторов перезаписывается, сигнал изменяем; `app:134–140,978–1019` | Append-only decisions и versioned signal snapshot, повторный review после новых фактов | Высокий для migration/workflow |
| A04 HIGH P1 развития | Нет постоянного хранения загруженных бинарных доказательств; `app:49,646,694,846–850` | Storage + evidence IDs; screenshot связать с ad; metadata сохранить независимо. Для конкурсного минимума допустим сохраняемый текст без screenshot | Средний: текущие бинарные файлы восстановить после reload нельзя |
| A05 HIGH P1 | Настоящий AI не продемонстрирован; `ai:124–127` | Серверный LLM на новом вводе + human review + журнал provenance | Средний, сохранить offline parser |
| A06 HIGH P1 развития | Нет Auth/общей БД/RLS; `app:14–60,105–130`; блокер многопользовательской эксплуатации, не формальное нарушение конкурса | Supabase data/auth policies по цели пользователя, экспорт локального состояния перед переносом | Высокий, tenant/roles и ID |
| A07 HIGH P1 | BYOK секрет в browser storage; `ai:6–15,88` | Серверная граница хранения и вызовов | Средний, заменяется credential flow |
| A08 MEDIUM P1 | Parser/heuristic расходятся, общий NEG подавляет платёж; `parser:14–34`, `ai:22–52` | Общие правила/negation scope + контрпримеры | Средний: сохранить существующие RU/KZ regression cases |
| A09 MEDIUM P1 | Цитата с вымышленным «…», нет строгой AI schema; `parser:115`, `ai:67,107` | Raw exact span отдельно от display truncation; строгая schema/nonempty quote | Низкий, проверить длинные фразы |
| A10 MEDIUM P1 | R5 устаревает/понижается, готовность без файла; `app:697–710` | Связанные dated observations и решение о пересмотре R5 при новом наблюдении | Средний, не отменять человеческое решение молча |
| A11 MEDIUM P2 | Async результат после route change, mutable metadata; `app:884–965` | Abort/run identity + immutable input snapshot + явные errors | Низкий/средний |
| A12 MEDIUM P2 | Нет schema/concurrency localStorage, duplicate score; `app:18–43`, `scoring:20–24` | Validate/migrate payload, unique code constraint, revisions | Средний: совместимость старых данных |
| A13 MEDIUM P2 | CSV multiline ломается, zkHint не используется; `parser:314–332`, `app:870–880` | Stateful CSV reader и явное сопоставление ЖК/ошибки | Низкий, сохранить подтверждение каждой строки |
| A14 MEDIUM P2 | Map re-create/lifecycle, blob index mismatch; `app:548,646,691–694` | Cleanup, update layers; map media by stable ID | Средний: camera/filters, существующие metadata |
| A15 MEDIUM P1 | PDF без доказательных URL/ad dates/immutable content; `app:1001–1017` | Полная трассировка и проверка печати на многостраничной карточке | Низкий/средний, сохранить dossier layout |
| A16 MEDIUM P2 | Source verifier 404 и TLS off; `tools/verify_ashyq.py` | Восстановить проверяемый provenance и reproducible snapshot | Средний, не превращать недоступность в R1 |
| A17 MEDIUM P2 | Нет legal review/document form; `vDetail` только read + status buttons; полный CRUD ЖК — дополнительная потребность, не прямое требование ТЗ | Нормализованная форма источника/основания; entity CRUD по отдельному scope | Средний/высокий, доменные инварианты |
| A18 LOW P3 | Deep-link title, mobile aria, modal keyboard; `app:1081,1047`, `69–75` | Единая route initialization и доступный modal/tab primitive | Низкий |
| A19 LOW P3 | README говорит «все вымышлены»/8 ЖК, env не работает автоматически, pyc в Git | Синхронизировать docs/artefacts позже, в этом аудите не изменялись | Низкий |

Blob index mismatch A14: после reload `state.media` содержит старые элементы, а `mediaBlobs` пуст. Следующий upload помещает новый URL в индекс 0, хотя metadata добавляется в конец. `gallery:646` показывает новый файл с первой старой подписью, новый элемент без файла. Это статически установленный дефект целостности, runtime upload в этом аудите UNVERIFIED. Reset не очищает `mediaBlobs`, что также создаёт несоответствие при следующих upload.

## 15. Пробелы требований конкурса

По оригиналу §3 все пять модулей представлены. Карта/обзор, чтение demo-карточек и базовый ручной monitoring отвечают минимальному demo-flow; risk-scoring как сквозной процесс и сигнальная карточка PARTIAL. Формула/пороги PASS на валидном наборе факторов, но допуск неподкреплённого R1 — FAIL §5 и §7. Число 8 ЖК/12 объявлений выполнено (8 synthetic карточек/13 synthetic ads); неизвестные readiness/coords не следует подменять выдуманными значениями. §3 прямо требует геометки при наличии координат. Постоянные screenshots не обязательны: §4 допускает текст, который приложение сохраняет.

§6 требует содержательный AI на новых данных: default keywords не закрывает AI-условие, внешний provider end-to-end UNVERIFIED. Human confirm/return сигнала со status/author/time работает локально, что допустимо для demo §11. Evidence и журнал отказов/изменений PARTIAL; PDF/печатный результат UNVERIFIED, причём отдельный PDF generator по §3 не обязателен. Source/seed/автотесты и доступ GitHub на дату проверки PASS; README и пример окружения PARTIAL (описание расходится с runtime).

Критерии §10: MVP/сквозной сценарий 25, AI/данные/объяснимость 20, код/GitHub 20, UX 10, питч/ценность 20, инициатива/оригинальность 5. Баллы жюри в аудите не моделировались. Питч не предоставлен. §8 указывает рекомендуемую отсечку 20.10.2026 23:59 без часового пояса; факт сдачи/зафиксированная для жюри версия неизвестны. Аудит ничего не публиковал и не менял source. Детальная матрица с ссылками на страницы, зависимостями и трудоёмкостью — `REQUIREMENTS_MATRIX.md`.

## 16. Рекомендуемые архитектурные решения следующего этапа

1. Сохранить domain scoring отдельно от UI; добавить уникальность кода и входные инварианты, не менять веса/пороги для подгонки интерфейса.
2. Сначала определить evidence/decision/signal version contracts и безопасный импорт localStorage; затем создавать таблицы/Auth/RLS/Storage. Выдуманные и публичные данные оставить различимыми.
3. Серверный AI с проверкой точной непустой цитаты и записью run; browser parser оставить доступным и честно обозначенным.
4. При будущей работе с обязательным целевым Svelte 5/TS/Vite переносить экраны постепенно, с parity criteria для семи routes, seed и scoring; сохранить существующий сайт до проверки нового. Это рекомендация отдельному implementation agent, миграция здесь не выполнялась.
5. Изолировать map adapter и lifecycle; решение Leaflet/MapLibre принять после критериев масштаба/геометрий. Не переписывать карту ради названия библиотеки.

## 17. Что сохранить

`js/scoring.js` и boundary cases; seed A/B/C, `origin`, неизвестные значения, координаты только при наличии; `js/parser.js` как основу с RU/KZ regression tests, spans и нормализацией денег/телефонов; human review до начисления баллов; layout detail/signal и CSS tokens/chips; карта OSM + clustering и независимый список; hash deep links и явные offline/empty states; предупреждение о неюридическом характере карточки.

## 18. Что переработать

`app.js` разделить на state/repositories, review actions, screens, map и UI primitives при будущем целевом переносе. Parser PAY/NEG и heuristic объединить по проверенному контракту, исправив конкретные ошибки. Persistence, signal history, media IDs, source forms и async lifecycle требуют новых границ ответственности. CSS сохранить, точечно выровнять поля/spacing/a11y.

## 19. Что может потребовать замены

localStorage как главное хранилище → Supabase repository; имитация входа → Supabase Auth; BYOK browser fetch → Edge Function/server AI adapter; blob arrays → Storage-backed evidence; перезаписываемый factor record → решения с историей. `v*` DOM renderer заменяется постепенно при реализации обязательного Svelte stack. Scoring, fixtures, parser semantics и визуальная система не требуют тотальной замены. Leaflet — условное решение, а не выявленная фундаментальная непригодность.

## 20. Проверки, блокеры и неопределённости

| Команда/проверка | Результат |
|---|---|
| `git status --short`, branch/log/rev-parse/diff/log deleted/ls-files | Exit 0; чисто до аудита; 28 commits, main/HEAD выше |
| `node --version`, `python --version` | Exit 0: v24.18.0 / 3.11.0 |
| `node tests/test-scoring.cjs` | Exit 0, PASS 90 |
| `node tests/test-parser.cjs` | Exit 0, PASS 57 |
| `node tests/test-sources.cjs` | Exit 0, PASS 31 |
| `node --check` для пяти `js/*.js` | Все exit 0, syntax errors нет |
| `python tools/verify_ashyq.py` | Exit 1, `HTTP Error 404: Not Found`; независимый network check не прошёл |
| `python -m http.server 8765 --bind 127.0.0.1` | Сайт поднят; HTTP/browser просмотр прошёл |
| Chrome DevTools `new_page` | Не подключился: Chrome без доступного DevToolsActivePort; использован IAB |
| IAB | Все 7 views открыты; карта OSM/кластеры, поиск, Telegram filter, новый текст, reload persistence ad/factor/signal, confirm/return проверены |
| IAB dev.logs error/warn | Пусто в доступном журнале на момент чтения; не утверждение о всех возможных ошибках |
| Дополнительные inline Node probes | Подтверждены duplicate score, NEG false negative, detector divergence, quote truncation, multiline CSV split, spoofed platform, некорректная seed quote, AI schema stubs |
| Typecheck/lint/production build | НЕДОСТУПНО как скрипты проекта: toolchain отсутствует; `npm run build` не имитировался; для статического сайта это не доказательство неработоспособности |
| Оригинал PDF | 6 страниц: текст извлечён pypdf, все страницы отрендерены Poppler и просмотрены; pypdf сообщил о двух неверных object offsets, чтение/рендер завершились |
| GitHub public API / `git ls-remote` | Анонимное чтение успешно; public repository и совпадение remote main/HEAD с audit SHA подтверждены |

Inline probes не добавлены в source/tests, они не являются прошедшим regression suite. Browser тесты использовали только synthetic SQ-003 и имя AUDIT-LOCAL на локальном origin, без внешнего inference/рассылок/реальных документов. Никаких зависимостей не установлено, lock/config не менялись, generated build не создавался.

UNVERIFIED: актуальность разрешений и 11 внешних реестров, Esri runtime, реальный LLM/CORS, готовый PDF и пагинация, upload/reload media E2E, полный responsive/a11y, performance/heap под нагрузкой, production headers/deployment, факт сдачи GitHub/питч/резервная запись. Оригинал ТЗ теперь доступен и проверен; прежняя неопределённость по требованиям снята. Не принимать старый дизайн-аудит за повторное прохождение runtime-проверок.
