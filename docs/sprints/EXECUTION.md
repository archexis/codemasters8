# Протокол исполнения

## Один пакет за раз

Перед пакетом `Sx.y` прочитать этот файл, CONTRACTS, текущий Sx и перечисленные файлы кода. Пути считаются от `C:/Users/BIGra/codemasters8`.

1. Проверить входной gate и изменения в затрагиваемых файлах.
2. Для исправления поведения сначала воспроизвести дефект указанным тестом. Падение должно быть по нужной причине.
3. Исправить только нужный контракт. Необходимую правку за пределами списка объяснить в журнале.
4. Прогнать целевые проверки. Не подгонять expected, не использовать skip/only/xfail для критериев приёмки.
5. Записать результат и следующий ID в `docs/acceptance/progress.md`.
6. На границе спринта выполнить его DoD и накопленную регрессию. Если PASS — продолжать без лишнего подтверждения пользователя.

## Профили проверок

| ID | Команда | Назначение |
|---|---|---|
| T | `npm run check` | TS/Svelte |
| U | `npm test` | Unit и PGlite |
| B | `npm run build` | Production build |
| E | `npm run test:e2e` | DEMO desktop/mobile, origin 5176 |
| C | `npm run test:cloud` | SDK с mock HTTP, не настоящий cloud |
| A | `backend/.venv/Scripts/python.exe -m pytest backend/tests -q` | API; Linux: `.venv/bin/python` |
| F | `npm run test:edge`; отдельно `npx --yes deno check supabase/functions/analyze/index.ts` | Edge tests и типы |
| L | `npm run test:local` | Настоящие локальные Auth/RPC/Storage/API/browser |
| AI | `npm run test:deepseek` | Платный inference после preflight S4 |

Целевой unit: `npx vitest run tests/unit/ИМЯ.test.ts`. Новые файлы из пакетов ещё нужно создать. Общий corpus используется TS/SQL; Python читает scoring fixtures. Expected фиксируется по контракту, не вычисляется тестируемой функцией.

Перед L прочитать `tools/local-smoke.mjs`, проверить Docker, Supabase/Edge, venv, порты. Локальный status.json содержит секреты и остаётся в игнорируемой `.temp`; не печатать его. Не делать db reset рабочей базы. Upgrade проверять на одноразовой базе. CLI flags сначала сверять с `--help`.

## Отчёт и версия

Создавать `docs/acceptance/sprint-N.md` и `.json` с полями:

```text
sprint, status: NOT_RUN|IN_PROGRESS|FAIL|BLOCKED|PASS
source: HEAD + SHA256-манифест исходников
environment: runtime versions, DEMO/local, migrations
packages: ID/status/checks/artifacts
criteria: DoD ID/status/evidence
regression: previous criteria/current result
blockers: defect ID/reproducer
next: следующий разрешённый пакет
```

Манифест включает tracked и untracked src, migrations/functions, backend/app, tests, tools, configs/lockfiles; исключает secrets, dependencies, generated output и acceptance (чтобы отчёт не менял собственный хеш). Изменившиеся исходники требуют повторной проверки соответствующих профилей.

В S0 создать `tools/check-sprint-gate.mjs` / `npm run gate -- N`. Он проверяет наличие всех обязательных ID, PASS каждого, существование артефактов, отсутствие блокеров и актуальность проверок по хешам. Для N>0 требует PASS predecessor и актуальное подтверждение регрессии. Нельзя засчитывать один текст «PASS» без свидетельства.

Старый SHA не обязан совпадать с новым вечно: хранить историческую приёмку и отдельное актуальное подтверждение регрессии прежних критериев. Gate предотвращает пропуски, но не доказывает истинность ручного осмотра PDF или защищает от сознательной подделки отчётов.

## При неудаче

- Дефект продукта → FAIL, reproducer, исправление в этом спринте.
- Нет runtime/сервиса/ключа → BLOCKED; допустимы независимые пакеты текущего спринта, следующий запрещён.
- После 2–3 одинаковых ошибок сменить подход, не повторять вслепую.
- Неясное правило → CONTRACTS и первичный PDF; противоречие описать пользователю, не придумывать правило.
- После потери контекста → progress.md → проверка артефактов → первый незакрытый ID.
- Падение прежнего критерия снимает актуальный PASS; исправить и повторить затронутую регрессию до продолжения.
- Не сокращать DoD ради дедлайна. Не внедрять OCR/скрейпинг/общие организации/новый дизайн.

Отчёт пользователю после спринта: статус, закрытые ID, проверки, ссылка на приёмку, блокеры и следующий разрешённый пакет. «Реализовано» без результата проверки не является DONE.
