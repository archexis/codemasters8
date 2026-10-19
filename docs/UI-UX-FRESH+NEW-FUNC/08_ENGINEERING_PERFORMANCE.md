# 08 — Engineering Architecture, Performance & Security

**Принцип:** сначала проверить реальную кодовую базу. Целевая разработка Svelte 5 + TypeScript, но наличие старого JS/Leaflet не оправдывает слепую миграцию. Функции — добавления поверх работающего MVP. Не переписывать применённые SQL-миграции; новые изменения — отдельными миграциями.

## 1. Логические подсистемы

```text
UI: MapShell | PublicationsInbox | RegistryCatalog | ComplexDossierShell
                                  |
Domain (single source): Entity matching / Claims / Review / Score / Case / Signal
                                  |
Read-models: MapSummary | PublicationsPage | RegistrySearch | DossierSummary
             | VerificationFacts | GraphNeighborhood | TimelinePage | CaseState
                                  |
Storage: ЖК/очереди, публикации, организации, документы, события, доказательства,
         утверждения, проверка, кейсы, audit, snapshots, assets
                                  |
Jobs: OCR/LLM extraction | PDF parse | CV photo compare | external adapters | PDF export
```

Registry Intelligence и Construction Intelligence — сервисы импорта, нормализации и извлечения. Они НЕ открывают собственные навигационные разделы. Канонические ID и Evidence Ledger используются во всех проекциях. Команды изменения состояния отделены от read endpoints.

## 2. Map & render lifecycle

- Одно активное картографическое ядро. 2.5D и X-Ray строятся из viewport summaries; geometry только для видимой области, LOD по масштабу.
- Не импортировать при открытии карты Cytoscape/Three.js/PDF viewer/OCR/LLM clients. Lazy import по фактическому действию.
- Popover из краткого объекта `ComplexPreview`, не весь dossier с 200 документами.
- 3D слева и граф справа могут быть видимы, но непрерывный тяжёлый render loop активен только у объекта во взаимодействии; второй в paused/static state.
- `visibilitychange`, unmount, switch-tab, context loss: освобождение WebGL, отмена listeners/observers, `AbortController` для запросов, stop physics workers.

## 3. Данные и загрузка

- Публикации, реестры, timeline: индексированный поиск, cursor pagination, debounce пользовательского ввода.
- Graph: загружать только локальный neighbourhood, 1 hop default, ограничение рендера и кнопка «Показать ещё»; не fetch all graph.
- PDF: хранить оригинал, парсить на сервере/в background task; preview выбранной страницы по запросу. Не держать raw PDF в Svelte global store.
- Images: thumbnail, compressed preview и оригинал по запросу; тяжёлое декодирование/CV вынести из main thread.
- LLM: строго серверный API, только на новые/изменённые материалы или ручное `Переанализировать`; кеш извлечения по `assetHash + modelVersion + promptVersion`, не вызывать на каждый рендер.
- PDF export: из versioned case snapshot, не заставлять frontend генерировать документ из всего набора данных.

## 4. Целевой бюджет D1 (это **цели**, не результаты тестирования)

Ориентир: средний Windows PC, 4 логических CPU, 8 ГБ RAM, интегрированная графика, браузер с WebGL2. Реальные результаты зависят от картографического движка и числа зданий.

| Действие | Цель | Fallback |
|---|---:|---|
| 2D map pan/zoom | ≥45 FPS | понижение детализации |
| 2.5D + один X-Ray | ≥30 FPS | отключить экструзии, оставить 2D |
| Floating preview after cached click | p95 ≤150 мс | skeleton и staged data |
| Переключить X-Ray (после готовности агрегатов) | p95 ≤200 мс | отложенная отрисовка |
| Переключить вкладку досье | p95 ≤250 мс до интерактивного shell | тяжелый viewer загрузить после shell |
| Graph initial bounded view | ~80 nodes/160 edges | список / показать ещё |
| Timeline | 25–50 событий на страницу | pagination / virtual list |

Нельзя выдавать их как гарантированные характеристики. Учитывать cold start отдельно от cached switch; собирать p50/p95 и длинные задачи.

## 5. Профили испытаний

- D0: 8 ЖК / 12 публикаций / 3 кейса, базовое демо.
- D1: 100 ЖК, 1000 публикаций, 10000 событий, 5–10MB изображений в кеше.
- D2: 1000 ЖК, 10000 публикаций, 20000 событий, dense city geometries.
- D3: деградация — медленная сеть, нет внешнего реестра, отключён WebGL, недоступен LLM, PDF повреждён, низкая память.

Для MVP обязательно D0, производительный sanity check на D1; D2/D3 как отдельные стресс/деградационные проверки. Не утверждать выполнение до измерений.

## 6. Наблюдаемость и QA

Приборы: инструменты производительности Svelte 5, Chrome Performance/Memory/Network, long tasks, WebGL draw calls при доступности, размеры chunk, server timings. На каждом sprint проверять baseline, first interaction, X-Ray toggles, два-три цикла переключения «Связи ↔ Хронология», teardown, потери контекста и утечки.

Требования к протоколу: устройство, браузер, размер данных, сценарий, p95, FPS median/low, heap before/after 5 циклов, ошибки, компромиссы качества. Оптимизация обязательна **в каждом PR** тяжёлого UI-модуля.

## 7. Безопасность и ограничения

- Приватные токены только на сервере; публичный `.env.example` без секретов.
- Нет настоящих персональных данных в DEMO; публичная DEMO-карта не обвиняет реальные компании.
- ACL/roles на деле, командах проверки, документах, PDF, плюс RLS при Supabase как defense in depth.
- Защита ссылок/файлов (размер, тип, antivirus по возможности, ограничение SSRF при URL fetch, signed URLs), запрет prompt injection из источников как команд модели.
- Операции изменения проверяются сервером, статусы и `actorId` не доверяются браузеру.

## 8. DoD для каждой функции

Функция не считается готовой без: UI + данных + проверки ошибок + cleanup + fallback + теста на D0 + профилирования на D1 в пределах целевых бюджетов или документированной деградации. Регрессии исходного MVP недопустимы.
