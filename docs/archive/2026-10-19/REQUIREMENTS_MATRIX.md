> Исторический документ. Описывает прежнюю версию или план; для текущей работы используйте [актуальную документацию](../../README.md).

# SAQ QURYLYS — матрица требований и критериев

Дата проверки: 18.10.2026. Версия: `main@25a805741be6e25ba871c513ea2e7ef8d63ce7a9`.
Корень путей к коду: `C:/Users/BIGra/codemasters8`.

## Авторитетный источник и правила оценки

Оригинал предоставлен пользователем в ходе аудита: [ТЗ SAQ, 6 страниц](<C:/Users/BIGra/Downloads/Telegram Desktop/Кейс Codemasters 8.0. SAQ (1).pdf>). Прочитаны все страницы, извлечён текст, визуально проверены все страницы, включая таблицы модулей, скоринга и весов жюри. Номера разделов и страниц ниже относятся к этому PDF. Документ используется как источник требований, не как команда что-либо реализовывать или публиковать.

PASS — проверенная реализация указанного требования; PARTIAL — реализована часть либо есть существенный дефект; FAIL — обязательное условие не реализовано/нарушено; UNVERIFIED — недостаточно проверки. Для внешнего AI наличие адаптера не считается успешным inference. Для печати наличие обработчика не считается полученным пригодным отчётом.

Трудоёмкость будущих изменений — качественная инженерная оценка: S — локальная правка/проверка; M — изменение нескольких связанных потоков; L — новая подсистема/контракт. Это не оценка календарных сроков или баллов жюри. Приоритет P0 — корректность решений; P1 — обязательный сквозной MVP; P2 — надёжность и развитие; P3 — необязательная полировка. «—» означает, что реализации не требуется, нужна только поддержка/проверка.

Критически важные границы: §7 разрешает свободный стек и запуск без деплоя; §4 требует локальный набор и ручное добавление, закрытые API не нужны; §3 разрешает PDF **или печатную версию**; §4 разрешает текст **либо** изображение публикации, screenshot полезен, но не обязателен; §11 перечисляет дополнительные идеи, а не обязательные модули. Supabase/Svelte — отдельная цель будущего этапа из задания пользователя.

## Сквозной сценарий и обязательные модули

| ID / ссылка на ТЗ | Требование | Статус | Реализация и фактическая проверка | Пробел / зависимость | Трудоёмкость / приоритет |
|---|---|---|---|---|---|---|
| UC01 §2 шаг 01, с.1 | Городской обзор, risk filter, открыть ЖК | PASS | `js/app.js:vOverview:467–524`; browser поиск «Сарыарқа» → 1 запись и точка, открыта detail | Дальнейшая оптимизация карты не блокирует этот минимум | — / P2 |
| UC02 §2 шаг 02, с.1 | Застройщик, стадия, документальный статус, источники | PARTIAL | `vDetail:570–671`; данные видны в browser | Источники преимущественно строками; нет фиксации новой проверки основания; `authOrg` не показан | M / P1 |
| UC03 §2 шаг 03, с.1 | Связать публикацию с ЖК, показать предложение денег и фрагмент | PARTIAL | `vAnalyze:884–946`, `ai.js:57–81`; новый депозит 731000 → гипотеза → AD-U01 у SQ-003 | Есть false negative и расхождение parser/heuristic; настоящее AI отдельно ниже | M / P1 |
| UC04 §2 шаг 04, с.1 | Балл, зона, подтверждающие материалы | PARTIAL | `scoring.js:29`, `vDetail:601–629`; пересчёт после confirm проверен | A01: подтверждение без evidence; ссылки на конкретное доказательство неполны | M / P0 |
| UC05 §2 шаг 05, с.1 | Сигнал, human confirm/return, выгрузка | PARTIAL | `vSignal:978–1019`, `setSignal:57`; оба перехода и reload проверены | Печатный результат UNVERIFIED; report без полных ссылок/версии | M / P1 |
| M01 §3 модуль 01, с.2 | Список с баллом/цветом, фильтр/быстрый переход, метки при координатах | PASS | `app.js:467–568`; 16 ЖК, 14 точек, OSM/кластеры видны, две записи без coords пропущены | Полигон/MapLibre не обязателен | — / P2 |
| M02 §3 модуль 02, с.2 | Карточка ЖК с перечисленными полями, ads/events | PASS для исходного demo read-flow | `data.js:12–187`, `app.js:570–671`; 8 demo-карточек, БИН, стадия, основание, связи/events | CRUD сущностей ТЗ явно не требует; source verification остаётся отдельным PARTIAL | — / P1 |
| M03 §3 модуль 03, с.2 | Лента/ссылка/площадка/дата/text, ручной ввод, связь, подсветка | PASS для базового ручного demo | `vAds:715–737`, `vAnalyze:930–944`; фильтр Telegram и сохранение нового текста проверены | Нет live scraping — допустимо; дефекты анализа/metadata см. D05 и AI03 | S–M / P1 |
| M04 §3 модуль 04, с.2 | Пересчёт/объяснение/переход к evidence/зона | PARTIAL | Общий `computeScore`, factor UI и evidence.adId | ad link в `app.js:686` открывает общую ленту; допускаются неподтверждённые источниками факты | M / P0 |
| M05 §3 модуль 05, с.2 | Отчёт по ЖК, факторы, material links/status, confirm/return, print/PDF | PARTIAL | `app.js:978–1019`, `css/styles.css:469–475` | `vSignal:1001` выводит source text, не ссылки на материалы/capture time; печать не инспектировалась | M / P1 |

## Данные и доказательства

| ID / ссылка на ТЗ | Требование | Статус | Реализация и доказательство | Пробел / зависимость | Трудоёмкость / приоритет |
|---|---|---|---|---|---|---|
| D01 §4, с.2 | Не менее 8 полноценных demo-карточек | PASS для демонстрационного состава | `data.js:12–187`: 8 synthetic ЖК, все с ID/name/address/developer/bin/stage/legal/sources/events; плюс 8 public-snapshot | Неизвестные readiness/coords показаны честно; полнота не требует выдумывать их | — / P1 |
| D02 §4, с.2 | Не менее 12 публикаций | PASS | `data.js:189–203`, suite: 13 | Все 13 demo; не считать runtime AD-U01 частью воспроизводимого seed | — / P1 |
| D03 §4, с.2 | A/B/C | PASS для seed | `app.js:1022–1030`, `tests/test-scoring.cjs`; 35/yellow,70/red,10/green | Workflow позволяет испортить C неподкреплённым R1; это R01 | — / P0 |
| D04 §4, с.2; §7 достоверность, с.4 | Demo маркировка, факты и гипотезы различимы | PARTIAL | `originChip:89`, `statusChip:84`; test data явно marked; public отдельно | Public permit status «verified» сильнее наличия снимка; R5 manual-rule называется «гипотеза ИИ»; FAQ/README AI неоднозначны | S–M / P1 |
| D05 §4 примечание, с.2 | Сохранённые сведения содержат источник и время фиксации | PARTIAL | ad.url/platform/captureAt, legalBasis.source/checkedAt, signal.history.at | captureAt усечён до даты; часть factors без date/source; form metadata читается после анализа, не immutable input snapshot | M / P1 |
| D06 §4 сущность «Объект», с.2 | ID, ЖК, адрес/coords, developer/BIN, стадия/готовность, basis/status/source, ads | PASS для demo seed | `data.js:14–185`; `getZk`, `adsOf`, `vDetail` | У public BIN null; это отдельный снимок, не замена 8 полным demo | — / P2 |
| D07 §4 сущность «Публикация», с.2 | ID, source/account/date/url, text или image, ЖК, признаки оплаты, capture date | PARTIAL | `data.js:189`, `app.js:934–938`; текст сохраняется и читается после reload | Признаки/AI run не хранятся у ad; screenshot preview не связан с записью | M / P1 |
| D08 §4 сущность «Сигнал», с.2 | ID, объект, score/factors/evidence, createdAt, reviewer/status/export | PARTIAL | `signals[zkId]` + текущие данные ЖК, `setSignal`, `vSignal` | Нет самостоятельного ID/createdAt/снимка факторов или сохранённой версии export; до решения записи signal вообще нет | M / P1 |
| D09 §4 обязательный уровень, с.2 | Локальный seed и ручное добавление без закрытых госAPI | PASS | Seed JS загружается напрямую; новый ad сохранён через UI; сеть госAPI не нужна | Online map не мешает списку; parser local | — / P1 |
| D10 §4 дополнительный уровень, с.2 | Public data/CSV/OCR/Telegram и т.д. | PARTIAL, необязательно | `parser.js:311`, `app.js:852`, `data.js:223`; CSV/связи/public snapshot есть | Live verifier 404; OCR/scraping нет; не требуется реализовывать всё | M / P2 |
| D11 §4, с.2 | Не имитировать действующие официальные интеграции | PARTIAL | Registries UI честно «внешние ссылки», нет network lookup | Permit-number source отображается «Разрешение МИО · проверено» без отдельного applicability review | S–M / P1 |
| D12 §4 примечание, с.2 | Полезно хранить screenshot или локальную копию текста | PASS для текста | Seed и user ad.text persist; browser reload AD-U01 проверен | Binary screenshots не обязательны; текущий screenshot UI ONLY следует честно назвать либо связать/сохранить | S–M / P2 |

## Риск и обязательный AI

| ID / ссылка на ТЗ | Требование | Статус | Реализация и проверка | Пробел / зависимость | Трудоёмкость / приоритет |
|---|---|---|---|---|---|---|
| R01 §5 R1 и правовой нюанс, с.3 | +35 только за установленное отсутствие применимого основания; unknown≠R1; гарантия альтернатива МИО | FAIL в ручном workflow | Seed C корректен; `app.js:677–679` подтверждает R1 при verified guarantee и без source. Browser: C 10→45→70 после R2 | Обязательная evidence/legal applicability проверка before confirmed | M / P0 |
| R02 §5 R2, с.3 | +25 за прямое предложение денег с текстом/изображением | PARTIAL | `ai.js:57`, `app.js:940`; новый депозит подтверждён с quote/adId | Manual confirm без evidence; ложные отрицания «Не упустите…депозит» | M / P1 |
| R03 §5 R3, с.3 | +10 за зафиксированную рекламу до ввода | PARTIAL | Seed factors, `app.js:959–963` | Можно подтвердить любой текст/введённый объект; SQ-001/R3 seed quote не подстрока AD-001 | S–M / P1 |
| R04 §5 R4, с.3 | +15 за проверенное коллективное обращение | PARTIAL | `data.js:143`, generic factor UI | Только строка demo-source; manual confirm без обращения/источника | M / P1 |
| R05 §5 R5, с.3 | +10 при gap≥20 п.п.; оба значения с source/date | PARTIAL | `app.js:697–710`, seed B readinessSources | Можно фиксировать без кадра; нет полного evidence binding; старый confirmed R5 остаётся при исчезнувшем gap | M / P1 |
| R06 §5 R6, с.3 | +5 за документированный простой/существенную просрочку | PARTIAL | `data.js:117`, generic factor UI | Нет обязательного документа/порогов review для новых confirmations | M / P1 |
| R07 §5 формула, с.3 | min(100,sum confirmed weights) | PASS для уникальных валидных codes | `scoring.js:5,17–37`, tests PASS | Duplicate R2→50; добавить validation до импорта | S / P2 |
| R08 §5 формула, с.3 | Unknown=0 + «нужна проверка», AI hypothesis≠fact | PASS в расчёте, PARTIAL на уровне входа | `scoring.js:21,40–44`, `app.js:615–622`; гипотеза не даёт баллов | Пользователь может confirmed без доказательств → R01; поля legalBasis и factors независимы | M / P0 |
| R09 §5 зоны, с.3 | Green 0–24, yellow 25–59/60+ без R1+R2, red ≥60 и R1+R2 | PASS | `scoring.js:29–37`, boundary tests | Сохранить формулу, не исправлять проблему R01 изменением thresholds | — / P0 |
| R10 §6, с.4 | Детерминированный score, не юридический вердикт | PASS для scoring/позиционирования | Pure `computeScore`; disclaimers в home/signal; нет госрассылок | Проверять качество входных фактов отдельно | — / P1 |
| AI01 §6 абзац 1, с.4 | Хотя бы один содержательный AI на новых данных | UNVERIFIED для real LLM; default не выполняет AI-условие | `ai.js:85–127` adapter, default `realAI:false`; browser new text обрабатывает regex, не LLM | Реальный provider/model/новый ввод E2E не продемонстрирован; secrets не вводились | M / P1 |
| AI02 §6 bullet 2, с.4 | Гипотеза с подтверждающим фрагментом и по возможности confidence | PARTIAL | `ai.js:107–118`, `app.js:903–918` | Длинная quote обрезана с добавленным «…»; schema принимает string false/empty quote (локальный stub) | S–M / P1 |
| AI03 §6 bullet 2, с.4 | Аналитик принимает/отклоняет результат | PARTIAL | Confirm сохраняет factor/ad; reject `app.js:947` только DOM | Reject/run/author/time не persist; reload утрачивает отказ | M / P1 |
| AI04 §6 bullet 2, с.4 | Недостоверность/неуверенность маркируются | PARTIAL | Confidence badge, limitations, rejected wrong LLM quote | Статусы «встроенный/ИИ» смешаны; провайдерный ответ не имеет полной schema | S / P1 |
| AI05 §6 bullet 3, с.4 | Не передавать LLM безусловный юридический вердикт | PASS по архитектуре | Prompt только extraction R2, human confirmation до scoring; `scoring.js` независим | Сохранить это разделение при server AI | — / P1 |

## Технические требования, сдача и питч

| ID / ссылка на ТЗ | Требование | Статус | Реализация и проверка | Пробел / зависимость | Трудоёмкость / приоритет |
| T01 §7 работоспособность, с.4 | Запуск по README, сценарий из seed, status/score changes, deploy не обязателен | PASS базовый локальный | Python server/browser, AD-U01+R2 reload, signal confirm/return; тесты 178 PASS | Полный экспорт ещё не проверен; verifier отдельно FAIL | S / P1 |
| T02 §7 архитектура, с.4 | Понятные data/analysis/UI, простой объяснимый свободный стек | PARTIAL | Отдельные scoring/data/parser/ai; `app.js` объединяет 7 views/state/IO | 1084-строчный UI и implicit globals/async/persistence coupling; отсутствие Svelte не нарушение ТЗ | M / P2 |
| T03 §7 интерфейс, с.4 | Быстрый поиск, статусы, причины, понятные действия | PARTIAL | Browser search/filter/detail/confirm/return работают, CSS semantic tokens | Deep-link headings, mobile aria, focus trap, poor evidence jump | S–M / P2 |
| T04 §7 контроль решений, с.4 | Human signal confirm/return; status/author/date/time | PASS локальный demo минимум | `setSignal:57–61`, history UI `1011`; обе операции и reload проверены | Имитация внутреннего маршрута разрешена §11; Auth не обязательна. Версионирование повышает достоверность | M / P1 |
| T05 §7 достоверность, с.4 | Для существенного фактора source/evidence; fact/hypothesis/demo различимы | FAIL для новых произвольных confirmations | A01 browser: R1 confirmed с source «—»; `app.js:134–140,677` | Evidence prerequisites и сохранение решений; не только подпись имени | M / P0 |
| T06 §7 безопасность, с.4 | Нет реальных персональных данных в seed, ключей в GitHub, ошибок unknown и обвинений реальным компаниям | PARTIAL | Demo BIN/контакты, real rows с company names и 0 score; просмотренный код без обнаруженных ключей | Исторический secret scan UNVERIFIED; BYOK storage unsafe для production; real rows допускают ручные неподкреплённые factors | M / P1 |
| G01 §8 исходный код, с.5 | Фактический source показанного продукта | PASS | `index.html`, `css`, `js`; static UI реально запускается | Нет необходимости создавать build только для конкурса | — / P1 |
| G02 §8 README, с.5 | Problem/value/features/stack/architecture/start/demo/limitations | PARTIAL | README содержит эти разделы и тестовые команды | «Все вымышлены» против public-snapshot; 8 против 16 total; AI default описан неоднозначно; env flow не объяснён | S / P1 |
| G03 §8 settings/data, с.5 | Безопасный env example, seed/load/start commands | PARTIAL | `.env.example` с именами SQ_AI_ENDPOINT/MODEL/KEY; seed JS auto-load | Runtime env не читает; UI BYOK — реальный config contract; требуется честная инструкция | S / P1 |
| G04 §8 quality, с.5 | Несколько автотестов важной логики или воспроизводимый check; описание AI | PASS минимальный объём | `tests/test-scoring.cjs` 90, parser 57, sources 31 PASS; README commands | Нет review/persistence/print E2E; online verifier 404; AI docs уточнить | S–M / P1 |
| G05 §8 public GitHub/access, с.5 | Публичный доступ заранее и во время оценки | PASS доступ на момент аудита; будущая доступность UNVERIFIED | Unauthenticated GitHub API: `private:false`, repo `archexis/codemasters8`; `git ls-remote` remote main/HEAD совпали с audit SHA | Нужно сохранять доступ до конца оценки; сам факт repo не даёт 20 баллов | S / P1 |
| G06 §8 зафиксированный commit/отсечка, с.5 | Указать сдаваемую версию, учитывать правила freeze | UNVERIFIED сдача | Audit SHA известен, коммиты 15–17.10 доступны | Факт отправки жюри/сдаваемый SHA неизвестен; recommended cutoff 20.10.2026 23:59, timezone PDF не указан | S / P1 |
| G07 §8, с.5 | Честно указать сторонние libraries/models/templates/AI tools | PARTIAL | Leaflet/OSM/Esri/AI architecture в README; `scrollcraft/FINGERPRINTS.md` есть | Полного attribution перечня нет; используемая real model не определена; понимание кода командой не проверялось | S / P1 |
| P01 §9 problem/user, с.5 | Объяснить, кто ищет вручную и почему трудно | PARTIAL | `README.md`, `app.js:vHome` содержат problem/user framing | Реальный питч не предоставлен, delivery UNVERIFIED | S / P1 |
| P02 §9 value, с.5 | Объяснить ускорение/проверяемость/объединение | PARTIAL | Home и docs описывают workflow; факт связи ad→building→risk есть | Измерений экономии времени нет; не выдумывать их на защите | S / P1 |
| P03 §9 live product, с.5 | Новая публикация→factor→score→signal | PARTIAL | Browser новый текст→AD-U01/R2→score→signal confirm/return | Real AI и пригодный export E2E не подтверждены; исправить evidence control | M / P1 |
| P04 §9 engineering/development, с.5 | Где AI, ошибки и дальнейшие улучшения; backup recording если критичен интернет | PARTIAL | Код/тесты/ограничения есть; offline parser работает | Питч/резервное видео/реальная AI demo отсутствуют среди осмотренных файлов | S–M / P1 |

PDF §8 содержит формулировки о запрете изменений после сдачи и о возможности последующих изменений для финального показа при неизменной оценочной версии. Это условия конкурса: аудит ничего не сдавал/не публиковал и не изменял source. Дату/часовой пояс и конкретный freeze следует подтвердить у организаторов при подготовке сдачи, не трактовать самостоятельно как разрешение менять уже сданный код.

## Дополнительные возможности §11, с.6

| Возможность | Статус реализации | Место | Значение для конкурса |
|---|---|---|---|
| Связанные аккаунты/телефоны | PARTIAL | `parser.js:259–273`, `app.js:727–731` | Полезный существующий дополнительный сценарий; не граф Risk Web |
| OCR | FAIL как наличие функции | Только screenshot preview `app.js:846` | Не обязательный MVP; не приоритизировать до AI/evidence |
| Изменения во времени/журнал | PARTIAL | `tlineHtml:969`, `alertsHtml:248`, signal.history | Полезно, но нет полной истории факторов/Time Machine |
| RU/KZ interface | PARTIAL | `zoneChip:83` bilingual, parser RU/KZ | Полной локализации нет; это дополнительная идея |
| Географические паттерны | PARTIAL | Цветные pins/cluster | Нет spatial analytics; не обязательный отдельный режим |
| Drone Intelligence | PARTIAL | `vDetail:642–710` | Будущая функция из запроса пользователя; PDF не требует дронов |
| X-Ray/Investigation/Time Machine/Risk Web как режимы | FAIL как наличие отдельных modes | Карта/detail/relations — только зачатки | Не обязательные named modes по оригиналу; нельзя подменять ими 5 модулей |

FAIL в этой дополнительной таблице не означает несоответствия обязательному MVP.

## Критерии жюри: точные веса §10, с.6

| Критерий | Максимум | Проверенная база | Основные риски по аудиту | Что проверить/закрыть |
|---|---:|---|---|---|
| Работающий MVP и сквозной сценарий | 25 | Семь routes, seed, local save/reload, confirm/return | Evidence bypass, неполные material links, export UNVERIFIED | Один надёжный demo E2E на новом вводе, включая печать |
| ИИ, данные и объяснимость | 20 | Детерминированный score, цитаты, rule parser, labels | Default не LLM, real AI UNVERIFIED, R1 без source, lost rejections | Реальный AI + строгие facts/evidence/review |
| Качество кода и GitHub | 20 | Public repo доступен, start/test воспроизводимы, 178 checks PASS | UI coupling, schema/async errors, key storage, drift docs/verifier | Поддерживаемость, regression по найденным дефектам, README/config parity |
| UX и удобство аналитика | 10 | Search, цвет+текст статуса, cards, фильтры, кнопки review | Evidence navigation, deep-link title, keyboard/modal/mobile aria | Проверить целевой demo и narrow screens/keyboard |
| Питч и раскрытие ценности | 20 | Problem/value в home/README, можно показать текущий продукт | Сам питч, слайды/запись не предоставлены | Подготовить рассказ и показать новый ввод без обещаний за пределами кода |
| Инициатива и оригинальность | 5 | Связи phone/account, CSV preview, датированные наблюдения | Дополнительные экраны могут отвлечь от обязательного flow | Выбрать один сильный проверенный bonus, не реализовывать все |
| Итого | 100 | — | — | Баллы не присваивались: это аудит доказательств, не решение жюри |

При недоступном GitHub §10 прямо задаёт 0/20 за качество кода и GitHub. Сейчас анонимный доступ подтверждён; будущую доступность и факт сдачи этот аудит не гарантирует. Деплой сам по себе обязательным критерием не является.

## Отдельные требования пользователя к будущему стеку

| Целевой компонент | Сейчас | Оценка | Зависимости / приоритет |
|---|---|---|---|
| Svelte 5 + TypeScript + Vite | HTML/CSS/JS без package.json | FAIL относительно будущей цели; не нарушение конкурса | Поэтапный parity перенос после contracts; L / P2 |
| Supabase PostgreSQL | localStorage + seed | FAIL относительно будущей цели | Схема/импорт/relations/transactions; L / P1 развития |
| Supabase Auth/RLS | Demo name/session | FAIL относительно будущей цели | Roles/tenant model и policy tests; L / P1 развития |
| Supabase Storage | Blob URLs + metadata | FAIL относительно будущей цели | Evidence/media IDs и lifecycle; M–L / P1 развития |
| Supabase Edge Functions | Browser LLM fetch | FAIL относительно будущей цели | Server credentials, validation/timeout/provenance; M / P1 |
| MapLibre GL JS либо обоснованная альтернатива | Leaflet 1.9.4 + cluster 1.5.3 | PARTIAL: альтернатива работает, решение не принято | Не менять библиотеку до критериев объёма/geometry; M–L / P2 |

Обязательный минимум конкурса можно довести на текущем стеке. Если следующий агент обязан реализовать целевой стек пользователя, это отдельный согласованный scope; его отсутствие нельзя выдавать за формальный FAIL конкурса.
