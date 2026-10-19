> Исторический документ. Описывает прежнюю версию или план; для текущей работы используйте [актуальную документацию](../../README.md).

# SAQ QURYLYS — инвентаризация функций

Аудит 18.10.2026; `main@25a805741be6e25ba871c513ea2e7ef8d63ce7a9`.
Корень всех путей: `C:/Users/BIGra/codemasters8`.

Статусы: FULLY FUNCTIONAL — проверенное указанное локальное поведение; PARTIALLY FUNCTIONAL — работает часть потока; UI ONLY — только экранный эффект без нужного сохранения; MOCKED — имитация; NOT IMPLEMENTED — реализации нет; BROKEN — воспроизведён дефект; UNVERIFIED — выполнения не подтверждено. Уточнение «по коду» не означает browser E2E. P0 — корректность решения, P1 — обязательный рабочий контур, P2 — надёжность/масштаб, P3 — polish. Подробные риски и доказательства — `CODEBASE_AUDIT.md`, ID A01–A19.

| Feature | Files | Current behavior | Status | Required changes | Priority |
|---|---|---|---|---|---|
| Статический запуск | `index.html:53–59`, `README.md` | Работает через Python HTTP server, без сборки | FULLY FUNCTIONAL | Сохранить воспроизводимый старт; целевой tooling добавить отдельно | P2 |
| Главная/сводка | `js/app.js:vHome:275` | Counts, donut, top priority и лента по текущему state | FULLY FUNCTIONAL | Не смешивать отсутствие проверки с подтверждением безопасности; убрать метрику «разобрано» для просто сохранённых ads | P2 |
| Быстрая проверка фразы | `app.js:392–411`, `parser.js:133` | Новый текст проверяется локально, результат не сохраняется | PARTIALLY FUNCTIONAL | Исправить NEG/PAY; ясный статус rule-based | P1 |
| Переход к полной проверке | `app.js:408` | Переносит phrase в textarea с timeout | FULLY FUNCTIONAL локально по коду | Передавать prefill/state, убрать гонку таймера | P2 |
| Кейсы A/B/C | `app.js:417,811,1022`, `data.js:14,37,66` | Исходные 35/yellow,70/red,10/green; живое сравнение | FULLY FUNCTIONAL | Сохранить независимые fixtures и проверки | P1 |
| FAQ/таблица R1–R6/якоря | `app.js:313,357–386` | Рабочее пояснение, details/anchors | FULLY FUNCTIONAL | Синхронизировать wording AI/legal с реальной реализацией | P3 |
| Пять вкладок навигации | `index.html:23–29`, `app.js:180` | Home/overview/ads/analyze/registries | FULLY FUNCTIONAL | Сохранить маршруты и подписи | P2 |
| Мобильное меню | `app.js:1047–1054`, `css/styles.css:446` | Открывается/закрывается; после выбора пункта aria-expanded остаётся true | PARTIALLY FUNCTIONAL | Синхронизировать aria/body class, проверить узкие экраны | P3 |
| Прямые ссылки и browser history | `app.js:153–179,1081` | Контент открывается по hash; title/nav init обходится | PARTIALLY FUNCTIONAL | Единый nav bootstrap; строгий route parsing; browser history E2E расширить | P2 |
| Неизвестный ЖК/route | `app.js:572,980,153` | Empty для неизвестного id, unknown hash игнорируется | PARTIALLY FUNCTIONAL | Единый not-found и корректная ссылка назад (сейчас первая кнопка nav ведёт home) | P3 |
| Реестр ЖК | `app.js:vOverview:467` | 16 записей, сортировка по счёту, сведения/сигнал | FULLY FUNCTIONAL локально | CRUD, пагинация при росте, assessment coverage | P1 |
| Поиск ЖК | `app.js:470–475,512–518` | Поиск по name/address/developer/id; browser запрос оставил 1 запись | FULLY FUNCTIONAL | Отдельно обновлять список/слои; BIN не входит в поиск | P2 |
| Фильтры риска | `app.js:473,492–494,519` | Пересчёт list и меток по зоне | FULLY FUNCTIONAL по коду | Сохранить фильтр в route/query, стабильная карта | P2 |
| Карта OSM | `app.js:initMap:541`, `index.html:13–15,53–54` | Raster tiles реально видны, fitBounds, 14/16 точек | PARTIALLY FUNCTIONAL | Lifecycle/стабильный контейнер; отдельный map adapter | P2 |
| Кластеризация | `app.js:556` | markercluster, fallback layerGroup | FULLY FUNCTIONAL на малом seed | Нагрузочная проверка перед ростом | P2 |
| Цветные DOM-метки | `app.js:559–560`, `css:220–224` | divIcon, анимированный pulse, цвет общего scoring | FULLY FUNCTIONAL локально | Геовалидатор; renderer по измеренному масштабу | P2 |
| Popup и marker selection | `app.js:561–562` | Popup привязан; click сразу открывает detail | PARTIALLY FUNCTIONAL | Определить selection/popup/panel UX, синхронизация состояния | P2 |
| Спутник Esri | `app.js:552–554` | Layer switch реализован; без даты снимка | UNVERIFIED runtime | Проверить tiles/атрибуцию; не использовать недатированный снимок как confirmed evidence | P2 |
| Координаты/точность | `data.js:221–335`, `app.js:542,590` | Приблизительные public coords, 2 ЖК без точки | PARTIALLY FUNCTIONAL | Сохранить null, диапазоны/accuracy/source, показать approximate в popup | P2 |
| GeoJSON/контуры/зоны | `app.js:initMap` | Отсутствуют | NOT IMPLEMENTED | Хранение геометрии и слои при подтверждённой потребности | P2 |
| X-Ray Mode | `initMap`, `.pin` | Только risk colors, отдельного режима нет | NOT IMPLEMENTED как режим | Layer toggles/геометрии/legend | P2 |
| Time Machine | `app.js:tlineHtml:969` | Список событий; исторического состояния карты нет | NOT IMPLEMENTED как режим | История factor decisions/snapshots, temporal queries | P2 |
| Investigation Mode | `app.js:vDetail:570` | Карточка вместо карты | PARTIALLY FUNCTIONAL | Общий selected-building state, стабильная карта/панель | P2 |
| Risk Web | `parser.js:259`, `app.js:727` | Список связанных ads, графа компаний/объектов нет | PARTIALLY FUNCTIONAL | Нормализованные entities/relationships, граф по проверяемым источникам | P2 |
| Drone Intelligence | `app.js:642–710` | Файлы/ручной процент, без CV/геопривязки | PARTIALLY FUNCTIONAL по коду | Durable observations/evidence/Storage; advanced analysis отдельно | P2 |
| Карточка ЖК | `app.js:vDetail:570` | Поля, факторы, ads, sources, chronology | PARTIALLY FUNCTIONAL | CRUD и проверяемые ссылки на документы; authOrg не отображён | P1 |
| Создание/редактирование/удаление ЖК | `data.js`, `app.js:vDetail` | В UI нет, только seed | NOT IMPLEMENTED | Repository/form/validation/permissions | P1 |
| Реестр компаний | `data.js:developer,bin,authOrg` | Вложенные строковые поля, собственной страницы/ID нет | NOT IMPLEMENTED | Нормализация юрлиц и relation roles, null BIN допустим | P1 |
| Проверка законного основания | `app.js:95–100,597`, `data.js:legalBasis` | Показывает seed-status, нет lookup/form фиксации документа | PARTIALLY FUNCTIONAL | Источник, дата, applicability, reviewer, версия; R1 guard | P0 |
| Чистая формула риска | `scoring.js:5,17–45` | Веса/пороги/confirmed-only корректны, 90 suite checks | FULLY FUNCTIONAL для валидного уникального набора | Сохранить; валидировать уникальность code | P0 |
| Ручное подтверждение фактора | `app.js:677–679,134` | Позволяет confirmed без evidence и при противоречащем основании | BROKEN | Обязательные доказательства/инварианты/права, transactional command | P0 |
| Снятие/отклонение/пересмотр фактора | `app.js:680–684,134` | Меняет status/балл и последний reviewer; история затирается | PARTIALLY FUNCTIONAL | Append-only decision log, причины и version checks | P1 |
| Несколько доказательств одного фактора | `app.js:setFactor:138` | Shallow merge единственного evidence | NOT IMPLEMENTED | evidence relation many-to-many и исторические версии | P1 |
| Лента публикаций | `app.js:vAds:715` | Seed+user ads, текст/дата/источник, переход в ЖК | FULLY FUNCTIONAL локально | Пагинация/редактирование; не заявлять live monitoring | P1 |
| Фильтр по площадке | `app.js:717–718,735` | В browser Telegram оставляет AD-004/009 | FULLY FUNCTIONAL | Хранить canonical platform key отдельно от display label | P2 |
| Подсветка платёжных слов | `app.js:78–80` | Regex highlights, включая отрицания; не verdict | PARTIALLY FUNCTIONAL | Применять span результата parser, сохранить raw text | P2 |
| Ссылка из evidence к ad | `app.js:621,686` | Открывает общую ленту без выбора adId | PARTIALLY FUNCTIONAL | Ad detail/focus anchor по ID | P2 |
| Ручной текст/метаданные | `app.js:774–790,884` | Пустой текст блокируется, остальные поля JS не валидирует | PARTIALLY FUNCTIONAL | URL scheme, даты, snapshot metadata, согласованность selected ЖК | P1 |
| Пресеты/вставить пример | `app.js:803–809,1027` | Подставляют данные, анализ запускается отдельно | FULLY FUNCTIONAL | Сохранить удобный демосценарий | P3 |
| Нормализация площадки | `parser.js:218–229`, `app.js:829–839` | Regex по всей строке URL; `attacker.invalid/krisha.kz` → Krisha | PARTIALLY FUNCTIONAL | Проверять URL.hostname, нормализовать | P2 |
| CSV-предпросмотр | `parser.js:311–334`, `app.js:852–882` | ;/,/tab и quotes в одной строке; первые 20 rows UI | PARTIALLY FUNCTIONAL | Multiline fields/ошибки кавычек; учесть zkHint; page preview | P2 |
| Массовое сохранение CSV | `app.js:870–882` | Каждая строка только подставляется, не импортируется автоматически | NOT IMPLEMENTED как batch persistence | Определить batch-review; не выдавать preview за импорт | P2 |
| Дедуп | `parser.js:276–282`, `app.js:932–943` | Телефон + первые 60 chars, предупреждение, не запрет | PARTIALLY FUNCTIONAL | Проверять источник/хэш/длинный текст; вариант merge/review | P2 |
| Связанные публикации | `parser.js:259–273`, `app.js:727–731` | Shared phone/@account/URL, максимум 3 в UI | PARTIALLY FUNCTIONAL | Индексы/ссылки на связанные ad; учитывать platform у handle, обычные account без @ | P2 |
| Скриншот | `app.js:845–850` | Только object URL preview на форме | UI ONLY | Создать attachment/evidence record, Storage, связать с ad | P1 |
| OCR/забор постов/мессенджеров | `app.js:759–770` | UI прямо предлагает ручной ввод | NOT IMPLEMENTED | Server integrations только после определения источников/доступов | P2 |
| Парсер сущностей | `parser.js:133–201`, `app.js:267` | Деньги/phone/area/readiness/dates/legal/contacts/spans | PARTIALLY FUNCTIONAL | Исправить NEG, длинные quotes, permit regex; сохранить тесты | P1 |
| Default помощник | `ai.js:57–81` | Regex, первая R2 candidate, `realAI:false` | MOCKED как AI; рабочая эвристика | Общие правила с parser; обязательный real-AI сценарий отдельно | P1 |
| Реальный LLM-адаптер | `ai.js:85–127` | Прямой browser POST, JSON и substring guard | UNVERIFIED end-to-end | Server secret, schema, nonempty quote, timeout/abort; провайдерный E2E | P1 |
| BYOK config | `ai.js:6–15`, `app.js:919–958` | Хранит endpoint/model/key в localStorage; форма после анализа | PARTIALLY FUNCTIONAL по коду | Заменить boundary секретов; не считать hasRealAI проверкой соединения | P1 |
| Confirm новой R2 hypothesis | `app.js:930–946` | Создаёт AD-Uxx, confirmed R2; reload проверен | PARTIALLY FUNCTIONAL | AI provenance/decision/evidence/source time, transaction, stale form guard | P1 |
| Reject новой hypothesis | `app.js:947` | DOM+toast; после reload решение потеряно | UI ONLY | Persist rejection/run/reviewer/date, не сохранять ложное заявление UI | P1 |
| Save plain / confirm R3 | `app.js:948,959–963` | Сохраняет ad, опционально R3; реальный JS callback | PARTIALLY FUNCTIONAL по коду | Проверка контекста строящегося жилья и evidence; shared save command | P1 |
| Ошибки/загрузка AI | `app.js:891–901,965` | Disabled button, skeleton/error; нет timeout/route guard | PARTIALLY FUNCTIONAL | Abort/timeout/retry policy, сохранённый draft, актуальность результата | P2 |
| Загрузка фото/видео площадки | `app.js:687–695` | Metadata persist, binaries только session, нет revoke | PARTIALLY FUNCTIONAL по коду | Storage и стабильный media ID, size/type validation, cleanup | P1 |
| Gallery после reload+нового upload | `app.js:646,691–694` | URL index 0 сопоставляется старой metadata index 0 | BROKEN по статическому trace; runtime UNVERIFIED | Отказ от параллельных массивов, ID-based association | P1 |
| Фиксация готовности/R5 | `app.js:697–710` | Процент без файла; hypothesis при abs gap≥20, старый R5 не снимается при меньшем gap | PARTIALLY FUNCTIONAL | Подтверждённое наблюдение с документом и пересмотр решения | P1 |
| Timeline и последние изменения | `app.js:248–265,969–976` | Events+signal history+последние factor confirmations; не полная история | PARTIALLY FUNCTIONAL | Единый audit event log, ISO time sort, история отзывов | P1 |
| Сигнальная карточка | `app.js:vSignal:978` | Текущий score/factors/legal, один signal на ЖК | PARTIALLY FUNCTIONAL | Snapshot version, id, источники/URL/capture timestamps, prerequisites | P1 |
| Подтвердить/вернуть сигнал | `app.js:57–61,1018–1019` | Persist status/history; оба перехода browser проверены | PARTIALLY FUNCTIONAL | Auth/roles, допустимые transitions, возврат с причиной, invalidation при новых facts | P1 |
| Экспорт отчёта | `app.js:1017`, `css:469–475` | `window.print()`, no dedicated PDF generator/download | UNVERIFIED готовый PDF; PARTIALLY FUNCTIONAL по коду | Проверить реальный PDF/пагинацию и полноту evidence | P1 |
| Реестры/внешние ссылки | `data.js:205–216`, `app.js:1032` | 11 ссылок/заметки 15.10; UI работает | PARTIALLY FUNCTIONAL | Record manual check в app; доступность сайтов отдельно проверить | P1 |
| Public snapshot verifier | `tools/verify_ashyq.py:49` | Команда exit 1 HTTP 404; TLS validation off | BROKEN на дату аудита | Проверяемый источник/снимок, корректный TLS, сравнение с data.js | P2 |
| Тестовый вход/выход | `app.js:105–121,1055–1074` | Имя подписывает действия, явно демо, пароль отсутствует | MOCKED | Supabase Auth/roles/RLS, отдельное display name | P1 |
| Сохранение localStorage | `app.js:14–44` | Reload ad/factor/signal работает в одном browser origin | PARTIALLY FUNCTIONAL | Schema/version/concurrency, Supabase repository, миграционный экспорт | P1 |
| Сброс | `app.js:1077` | Удаляет только sq_state_v1; AI/session/blob остаются | PARTIALLY FUNCTIONAL по коду | Определить scope reset; cleanup blobs, тест изолированного state | P2 |
| Toast/modal | `app.js:65–75,122`, `index.html:46` | Действуют, Escape/backdrop close | PARTIALLY FUNCTIONAL | Focus trap/return focus/label, типизированные action forms | P2 |
| Responsive/theme/motion | `css/styles.css:2–25,446–484` | Светлая система, adaptive layouts, reduced motion, без animation lib | PARTIALLY FUNCTIONAL | Проверить 390/zoom/keyboard; сохранить tokens без тотального redesign | P3 |
| Supabase PostgreSQL/Auth/Storage/RLS/Functions | В текущем дереве нет | Никакой интеграции | NOT IMPLEMENTED | Спроектировать/проверить migrations/policies и server AI | P1 |
| Svelte 5/TypeScript/Vite | В текущем дереве нет | Статический JS IIFE | NOT IMPLEMENTED | Отдельный постепенный перенос с parity checks после data contracts | P2 |
| Автотесты/quality checks | `tests/*.cjs`, README | 178 checks PASS; node syntax PASS; online verifier FAIL | PARTIALLY FUNCTIONAL | Доказательственные regression/E2E, CI; typecheck/build после tooling | P1 |

В этой инвентаризации UI ONLY не означает «удалить»: preview и локальные controls полезны, но не выполняют обещание постоянного доказательства или журнала. Оригинал ТЗ предоставлен пользователем и проверен: `C:/Users/BIGra/Downloads/Telegram Desktop/Кейс Codemasters 8.0. SAQ (1).pdf`, 6 страниц. §7 разрешает свободный стек и отсутствие деплоя; §4 допускает локальный seed/ручной текст; §3 — печатную версию вместо отдельного PDF. Supabase/Auth/CRUD и advanced map modes здесь инвентаризованы по цели будущего развития пользователя, а не как обязательные требования конкурса. Соответствие обязательному минимуму и трудоёмкость отдельно приведены в `REQUIREMENTS_MATRIX.md`.
